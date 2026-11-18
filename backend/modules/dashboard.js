'use strict';

const { db } = require('../shared/database');
const { period } = require('../shared/http');
const { orderKey, timestamp, sqlOrder } = require('../shared/dates');

const newer = (a, b) => !a || orderKey(b) > orderKey(a) ? b : a;
const sum = (rows, field) => rows.reduce((total, row) => total + (row[field] || 0), 0);

function dashboard(params) {
  const { start, end } = period(params);
  const delegations = db.prepare('SELECT code,name,province,lat,lng FROM delegations ORDER BY name').all();
  const byCode = new Map(delegations.map((place) => [place.code, {
    ...place, produced: 0, machineRejected: 0, qcApproved: 0,
    qcRejected: 0, dispatched: 0, pending: null, pendingDate: null, pendingUpdatedAt: null,
  }]));
  const bounds = [orderKey(start), orderKey(end)];
  const within = `${sqlOrder('date')} BETWEEN ? AND ?`;
  const production = db.prepare(`SELECT * FROM production_entries WHERE ${within}`).all(...bounds);
  const unified = production.filter((row) => row.qc_rejected !== null);
  const unifiedDays = new Set(unified.map((row) => `${row.date}|${row.delegation_code}`));
  const unifiedMachines = new Set(unified.map((row) => `${row.date}|${row.delegation_code}|${row.machine}`));
  const quality = db.prepare(`SELECT * FROM quality_entries WHERE ${within}`).all(...bounds)
    .filter((row) => row.machine === 0
      ? !unifiedDays.has(`${row.date}|${row.delegation_code}`)
      : !unifiedMachines.has(`${row.date}|${row.delegation_code}|${row.machine}`));
  const dispatch = db.prepare(`SELECT * FROM dispatch_entries WHERE ${within}`).all(...bounds);
  // O valor pendente é um instantâneo do INCAPE, nunca uma soma de dias.
  // Para uma consulta histórica, usa-se o último valor conhecido até ao fim do período.
  const pending = db.prepare(`
    SELECT p.* FROM delegations d
    JOIN pending_snapshots p ON p.delegation_code = d.code AND p.date = (
      SELECT p2.date FROM pending_snapshots p2
      WHERE p2.delegation_code = d.code AND ${sqlOrder('p2.date')} <= ?
      ORDER BY ${sqlOrder('p2.date')} DESC LIMIT 1
    )
  `).all(bounds[1]);

  const machineTotals = [1, 2].map((machine) => ({
    machine, produced: 0, rejected: 0, qcApproved: 0, qcRejected: 0,
  }));
  const times = { pending: null, production: null, quality: null, dispatch: null };
  const series = new Map();
  function dayPoint(date) {
    if (!series.has(date)) series.set(date, { date, produced: 0, machineRejected: 0, qcApproved: 0, qcRejected: 0, dispatched: 0 });
    return series.get(date);
  }
  for (const row of pending) {
    const place = byCode.get(row.delegation_code);
    if (!place) continue;
    place.pending = row.quantity;
    place.pendingDate = row.date;
    place.pendingUpdatedAt = row.updated_at;
    times.pending = newer(times.pending, row.updated_at);
  }
  for (const row of production) {
    const place = byCode.get(row.delegation_code);
    if (!place) continue;
    place.produced += row.produced;
    place.machineRejected += row.rejected;
    machineTotals[row.machine - 1].produced += row.produced;
    machineTotals[row.machine - 1].rejected += row.rejected;
    const point = dayPoint(row.date);
    point.produced += row.produced;
    point.machineRejected += row.rejected;
    times.production = newer(times.production, row.updated_at);
    if (row.qc_rejected !== null) {
      const approved = row.produced - row.qc_rejected;
      place.qcApproved += approved;
      place.qcRejected += row.qc_rejected;
      machineTotals[row.machine - 1].qcApproved += approved;
      machineTotals[row.machine - 1].qcRejected += row.qc_rejected;
      point.qcApproved += approved;
      point.qcRejected += row.qc_rejected;
      times.quality = newer(times.quality, row.updated_at);
    }
  }
  for (const row of quality) {
    const place = byCode.get(row.delegation_code);
    if (!place) continue;
    place.qcApproved += row.approved;
    place.qcRejected += row.rejected;
    if (row.machine) {
      machineTotals[row.machine - 1].qcApproved += row.approved;
      machineTotals[row.machine - 1].qcRejected += row.rejected;
    }
    const point = dayPoint(row.date);
    point.qcApproved += row.approved;
    point.qcRejected += row.rejected;
    times.quality = newer(times.quality, row.updated_at);
  }
  for (const row of dispatch) {
    const place = byCode.get(row.delegation_code);
    if (!place) continue;
    place.dispatched += row.quantity;
    dayPoint(row.date).dispatched += row.quantity;
    times.dispatch = newer(times.dispatch, row.updated_at);
  }
  const places = [...byCode.values()];
  return {
    start, end, generatedAt: timestamp(), updatedAt: times,
    totals: {
      pending: sum(pending, 'quantity'), pendingCoverage: pending.length,
      delegations: delegations.length,
      produced: sum(production, 'produced'), machineRejected: sum(production, 'rejected'),
      qcApproved: sum(places, 'qcApproved'), qcRejected: sum(places, 'qcRejected'),
      dispatched: sum(dispatch, 'quantity'),
    },
    machines: machineTotals,
    delegations: places.sort((a, b) => b.produced - a.produced || a.name.localeCompare(b.name, 'pt')),
    series: [...series.values()].sort((a, b) => orderKey(a.date).localeCompare(orderKey(b.date))),
  };
}

module.exports = { dashboard };
