'use strict';

const { db } = require('../shared/database');
const { orderKey, timestamp, sqlOrder } = require('../shared/dates');
const { day, count, failure } = require('../shared/http');

const TYPES = Object.freeze({
  pending: { table: 'pending_snapshots', fields: ['quantity'], machine: false },
  production: { table: 'production_entries', fields: ['produced', 'rejected', 'qcRejected'], machine: true },
  quality: { table: 'quality_entries', fields: ['approved', 'rejected'], machine: true },
  dispatch: { table: 'dispatch_entries', fields: ['quantity'], machine: false },
});

const columnOf = (field) => field === 'qcRejected' ? 'qc_rejected' : field;

function kindOf(kind) {
  const type = TYPES[kind];
  if (!type) failure(404, 'Tipo de registo desconhecido.');
  return type;
}

function keyOf(kind, value) {
  const type = kindOf(kind);
  const date = day(value.date);
  if (typeof value.delegationCode !== 'string' ||
      !db.prepare('SELECT code FROM delegations WHERE code=?').get(value.delegationCode)) failure(422, 'Escolhe uma delegação da lista.');
  let machine;
  if (type.machine) {
    machine = value.machine;
    if (!Number.isInteger(machine) || ![1, 2, ...(kind === 'quality' ? [0] : [])].includes(machine)) failure(422, 'Escolhe uma máquina válida.');
  }
  const where = 'date=? AND delegation_code=?' + (type.machine ? ' AND machine=?' : '');
  const params = [date, value.delegationCode, ...(type.machine ? [machine] : [])];
  return { date, delegationCode: value.delegationCode, machine, where, params };
}

function list(start, end) {
  const result = {};
  const ordered = sqlOrder('date');
  for (const [kind, type] of Object.entries(TYPES)) {
    result[kind] = db.prepare(`SELECT * FROM ${type.table} WHERE ${ordered} BETWEEN ? AND ? ORDER BY ${ordered} DESC, delegation_code${type.machine ? ', machine' : ''}`).all(orderKey(start), orderKey(end))
      .map((row) => ({
        date: row.date, delegationCode: row.delegation_code,
        ...(type.machine ? { machine: row.machine } : {}),
        ...Object.fromEntries(type.fields.map((field) => [field, row[columnOf(field)]])),
        ...(kind === 'production' ? { qcApproved: row.qc_rejected === null ? null : row.produced - row.qc_rejected } : {}),
        revision: row.revision, updatedAt: row.updated_at,
      }));
  }
  return result;
}

function approvedValue(kind, row) {
  if (!row) return 0;
  if (kind === 'quality') return row.approved;
  if (kind !== 'production') return 0;
  const qcRejected = Object.hasOwn(row, 'qcRejected') ? row.qcRejected : row.qc_rejected;
  return qcRejected === null ? 0 : row.produced - qcRejected;
}

// Uma alteração afecta o saldo desta data em diante. Verifica também os
// despachos posteriores para não gastar cartas aprovadas de que eles já dependem.
// Défices antigos ficam preservados, mas nunca podem surgir nem aumentar.
function validateDispatchBalance(kind, key, old, next) {
  if (!['production', 'quality', 'dispatch'].includes(kind)) return;
  const delta = kind === 'dispatch'
    ? (next?.quantity ?? 0) * -1 + (old?.quantity ?? 0)
    : approvedValue(kind, next) - approvedValue(kind, old);
  if (delta >= 0) return;
  const days = new Map([[key.date, 0]]);
  const changes = db.prepare(`
    SELECT date, SUM(produced-qc_rejected) AS quantity
    FROM production_entries
    WHERE delegation_code=? AND qc_rejected IS NOT NULL
    GROUP BY date
    UNION ALL
    SELECT q.date, SUM(q.approved) AS quantity
    FROM quality_entries q
    WHERE q.delegation_code=? AND (
      (q.machine=0 AND NOT EXISTS (
        SELECT 1 FROM production_entries p
        WHERE p.date=q.date AND p.delegation_code=q.delegation_code AND p.qc_rejected IS NOT NULL
      )) OR
      (q.machine<>0 AND NOT EXISTS (
        SELECT 1 FROM production_entries p
        WHERE p.date=q.date AND p.delegation_code=q.delegation_code
          AND p.machine=q.machine AND p.qc_rejected IS NOT NULL
      ))
    )
    GROUP BY q.date
    UNION ALL
    SELECT date, -quantity AS quantity FROM dispatch_entries WHERE delegation_code=?
  `).all(key.delegationCode, key.delegationCode, key.delegationCode);
  for (const row of changes) days.set(row.date, (days.get(row.date) ?? 0) + row.quantity);
  let balance = 0, available = Infinity, worsened = false;
  for (const [date, change] of [...days].sort(([a], [b]) => orderKey(a).localeCompare(orderKey(b)))) {
    balance += change;
    if (orderKey(date) < orderKey(key.date)) continue;
    available = Math.min(available, Math.max(0, balance));
    if (Math.max(0, -(balance + delta)) > Math.max(0, -balance)) worsened = true;
  }
  if (!worsened) return;
  if (kind === 'dispatch') {
    failure(422, `O despacho excede as cartas aprovadas disponíveis. Disponível para este despacho: ${(old?.quantity ?? 0) + available} cartas, considerando os despachos já registados nesta e nas datas seguintes.`);
  }
  failure(422, `Este registo suporta despachos já guardados e não pode reduzir as cartas aprovadas para esse valor. Quantidade mínima aprovada neste registo: ${approvedValue(kind, old) - available} cartas.`);
}

function write(kind, input, role) {
  const type = kindOf(kind);
  const key = keyOf(kind, input);
  const fields = Object.fromEntries(type.fields.map((field) => [field, count(input[field], field)]));
  if (kind === 'production' && fields.rejected > fields.produced) failure(422, 'As rejeitadas pela máquina não podem exceder as produzidas.');
  if (input.revision !== null && (!Number.isSafeInteger(input.revision) || input.revision < 1)) failure(422, 'Revisão inválida.');
  if (!Object.hasOwn(input, 'revision')) failure(422, 'É obrigatório indicar a revisão do registo (null para novo).');
  if (kind === 'production' && fields.qcRejected > fields.produced) failure(422, 'As reprovadas no QC não podem exceder as produzidas.');
  const columns = ['date', 'delegation_code', ...(type.machine ? ['machine'] : []), ...type.fields.map(columnOf)];
  const values = [key.date, key.delegationCode, ...(type.machine ? [key.machine] : []), ...type.fields.map((field) => fields[field])];
  const now = timestamp();
  db.exec('BEGIN IMMEDIATE');
  try {
    if (kind === 'production' && db.prepare('SELECT 1 FROM quality_entries WHERE date=? AND delegation_code=? AND machine IN (0,?)').get(...key.params)) {
      failure(409, 'Já existe QC antigo para esta data e delegação. Confere e elimina esse registo antes de guardar o QC junto da produção.');
    }
    if (kind === 'quality' && db.prepare('SELECT 1 FROM production_entries WHERE date=? AND delegation_code=? AND qc_rejected IS NOT NULL AND (?=0 OR machine=?)').get(key.date, key.delegationCode, key.machine, key.machine)) {
      failure(409, 'O QC já está incluído no registo de produção. Corrige-o no registo de produção para evitar duplicações.');
    }
    const old = db.prepare(`SELECT * FROM ${type.table} WHERE ${key.where}`).get(...key.params);
    if (old && old.revision !== input.revision || !old && input.revision !== null) failure(409, 'Este registo foi alterado por outra pessoa. Actualiza os dados antes de o guardar.');
    validateDispatchBalance(kind, key, old, fields);
    if (old) {
      const setters = [...type.fields.map((field) => `${columnOf(field)}=?`), 'revision=revision+1', 'updated_at=?'];
      db.prepare(`UPDATE ${type.table} SET ${setters.join(',')} WHERE ${key.where}`)
        .run(...type.fields.map((field) => fields[field]), now, ...key.params);
    } else {
      db.prepare(`INSERT INTO ${type.table}(${columns.join(',')},updated_at) VALUES(${columns.map(() => '?').join(',')},?)`).run(...values, now);
    }
    const next = db.prepare(`SELECT * FROM ${type.table} WHERE ${key.where}`).get(...key.params);
    db.prepare('INSERT INTO audit_log(role,action,category,record_key,old_value,new_value,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(role, old ? 'update' : 'insert', kind, key.params.join('|'), old ? JSON.stringify(old) : null, JSON.stringify(next), now);
    db.exec('COMMIT');
    return { revision: next.revision, updatedAt: next.updated_at };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function remove(kind, input, role) {
  const type = kindOf(kind);
  const key = keyOf(kind, input);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) failure(422, 'Revisão inválida.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const old = db.prepare(`SELECT * FROM ${type.table} WHERE ${key.where}`).get(...key.params);
    if (!old || old.revision !== input.revision) failure(409, 'O registo foi alterado ou eliminado entretanto. Actualiza os dados.');
    validateDispatchBalance(kind, key, old, null);
    db.prepare(`DELETE FROM ${type.table} WHERE ${key.where}`).run(...key.params);
    db.prepare('INSERT INTO audit_log(role,action,category,record_key,old_value,new_value,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(role, 'delete', kind, key.params.join('|'), JSON.stringify(old), null, timestamp());
    db.exec('COMMIT');
    return { ok: true };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

module.exports = { TYPES, list, write, remove };
