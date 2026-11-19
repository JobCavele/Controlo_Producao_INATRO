'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contacarta-test-'));
process.env.CONTACARTA_DB = path.join(directory, 'test.sqlite3');
const server = require('../backend/server');
const auth = require('../backend/modules/auth');
let base;
const sessions = {};
const accounts = [['pca', 'p'.repeat(6)], ['fabrica', 'f'.repeat(200)]];

test.before(async () => {
  for (const [role, password] of accounts) auth.setPassword(role, password);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  require('../backend/shared/database').db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
async function request(pathname, method = 'GET', data, role) {
  const result = await fetch(base + pathname, {
    method,
    headers: { ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(sessions[role] ? { Cookie: sessions[role] } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: result.status, data: await result.json(), headers: result.headers };
}
const pathTo = (start, end) => '/api/dashboard?' + new URLSearchParams({ start, end });

test('a configuração rejeita palavras-passe fora dos limites de 6 a 200 caracteres', () => {
  for (const length of [5, 201]) {
    assert.throws(() => auth.setPassword('pca', 'p'.repeat(length)), {
      status: 422, message: 'A palavra-passe deve ter entre 6 e 200 caracteres.',
    });
  }
});

test('sessões, permissões e armazenamento centralizado', async () => {
  assert.equal((await request('/api/dashboard')).status, 401);
  assert.equal((await request('/api/setup-status')).data.ready, true);
  for (const [role, password] of accounts) {
    const login = await request('/api/login', 'POST', { role, password });
    assert.equal(login.status, 200);
    sessions[role] = login.headers.get('set-cookie').split(';')[0];
    assert.equal(login.data.role, role);
  }
  assert.equal((await request('/api/entries?start=01/11/2026&end=30/11/2026', 'GET', undefined, 'pca')).status, 403);
  assert.equal((await request('/api/entries/pending', 'PUT', {
    date: '18/11/2026', delegationCode: 'MAT', quantity: 30, revision: null,
  }, 'pca')).status, 403);
  assert.equal((await request(pathTo('01/11/2026', '30/11/2026'), 'GET', undefined, 'pca')).status, 200);
});

test('as 11 sedes de uma base nova correspondem entre o catálogo, o painel e o mapa', () => {
  const { all } = require('../backend/modules/delegations');
  const { dashboard } = require('../backend/modules/dashboard');
  const { quantityView } = require('../app/components/map');
  const codes = (rows) => rows.map((row) => row.code).sort();
  const seats = codes(all());
  const { delegations } = dashboard(new URLSearchParams({ start: '01/04/2026', end: '30/04/2026' }));
  assert.equal(seats.length, 11);
  assert.deepEqual(codes(delegations), seats);
  assert.deepEqual(codes(quantityView(delegations).rows), seats);
});

test('INCAPE: valores diários substituem-se no resumo, não se somam', async () => {
  const first = await request('/api/entries/pending', 'PUT', {
    date: '17/11/2026', delegationCode: 'MAT', quantity: 200, revision: null,
  }, 'fabrica');
  assert.equal(first.status, 200);
  const second = await request('/api/entries/pending', 'PUT', {
    date: '18/11/2026', delegationCode: 'MAT', quantity: 175, revision: null,
  }, 'fabrica');
  assert.equal(second.status, 200);
  let view = (await request(pathTo('01/11/2026', '30/11/2026'), 'GET', undefined, 'pca')).data;
  assert.equal(view.totals.pending, 175);
  assert.equal(view.totals.pendingCoverage, 1);
  assert.equal(view.delegations.find((row) => row.code === 'MAT').pendingDate, '18/11/2026');
  view = (await request(pathTo('01/11/2026', '17/11/2026'), 'GET', undefined, 'pca')).data;
  assert.equal(view.totals.pending, 200);
  assert.ok(view.updatedAt.pending);
});

test('INCAPE desconta apenas produções criadas depois da consulta', async () => {
  const date = '01/12/2026', delegationCode = 'MAT';
  const production = (machine, produced, revision = null) => ({
    date, delegationCode, machine, produced, rejected: 0, qcRejected: 0, revision,
  });
  const pending = (quantity, revision = null) => ({ date, delegationCode, quantity, revision });
  const balance = async () => {
    const view = (await request(pathTo(date, date), 'GET', undefined, 'pca')).data;
    return view.delegations.find((row) => row.code === delegationCode).pending;
  };

  assert.equal((await request('/api/entries/production', 'PUT', production(1, 40), 'fabrica')).status, 200);
  assert.equal((await request('/api/entries/pending', 'PUT', pending(100), 'fabrica')).status, 200);
  assert.equal(await balance(), 100, 'produção anterior à consulta não é descontada');

  assert.equal((await request('/api/entries/production', 'PUT', production(2, 30), 'fabrica')).status, 200);
  assert.equal(await balance(), 70, 'produção criada depois da consulta é descontada');

  assert.equal((await request('/api/entries/production', 'PUT', production(1, 50, 1), 'fabrica')).status, 200);
  assert.equal(await balance(), 70, 'corrigir produção anterior não a transforma em produção posterior');
  assert.equal((await request('/api/entries/production', 'PUT', production(2, 20, 1), 'fabrica')).status, 200);
  assert.equal(await balance(), 80, 'corrigir produção posterior ajusta o desconto');

  assert.equal((await request('/api/entries/pending', 'PUT', pending(120, 1), 'fabrica')).status, 200);
  assert.equal(await balance(), 100, 'corrigir o valor INCAPE conserva a ordem original da consulta');
  assert.equal((await request('/api/entries/production', 'DELETE', production(2, 20, 2), 'fabrica')).status, 200);
  assert.equal(await balance(), 120, 'eliminar a produção posterior devolve-a ao saldo');
  assert.equal((await request('/api/entries/production', 'PUT', production(2, 10), 'fabrica')).status, 200);
  assert.equal(await balance(), 110, 'recriar a produção estabelece uma nova ordem de criação');
});

test('produção e QC no mesmo registo, despacho por delegação e máquina', async () => {
  const operations = [
    ['production', { date: '18/11/2026', delegationCode: 'MAT', machine: 1, produced: 50, rejected: 10, qcRejected: 5, revision: null }],
    ['production', { date: '18/11/2026', delegationCode: 'MAT', machine: 2, produced: 65, rejected: 2, qcRejected: 4, revision: null }],
    ['quality', { date: '18/11/2026', delegationCode: 'BEI', machine: 2, approved: 15, rejected: 1, revision: null }],
    ['dispatch', { date: '18/11/2026', delegationCode: 'MAT', quantity: 100, revision: null }],
  ];
  for (const [kind, row] of operations) {
    const result = await request('/api/entries/' + kind, 'PUT', row, 'fabrica');
    assert.equal(result.status, 200, JSON.stringify(result.data));
  }
  const view = (await request(pathTo('18/11/2026', '18/11/2026'), 'GET', undefined, 'pca')).data;
  assert.equal(view.totals.produced, 115);
  assert.equal(view.totals.machineRejected, 12);
  assert.equal(view.totals.qcApproved, 121); // Inclui 15 aprovadas do QC histórico da Beira.
  assert.equal(view.totals.qcRejected, 10);
  assert.equal(view.totals.dispatched, 100);
  assert.equal(view.machines[0].produced, 50);
  assert.equal(view.machines[0].qcApproved, 45);
  assert.equal(view.machines[0].qcRejected, 5);
  assert.equal(view.machines[1].rejected, 2);
  assert.equal(view.machines[1].qcApproved, 76);
  assert.deepEqual([view.series[0].qcApproved, view.series[0].qcRejected], [121, 10]);
  assert.equal(view.delegations.find((row) => row.code === 'MAT').dispatched, 100);
  assert.ok(view.updatedAt.quality);
  assert.ok(view.updatedAt.dispatch);
});

test('QC definitivo é obrigatório, validado e independente das rejeições da máquina', async () => {
  const row = { date: '20/11/2026', delegationCode: 'MAT', machine: 1, produced: 50, rejected: 10, revision: null };
  for (const qcRejected of [undefined, null, -1, 1.5, 51, '5']) {
    assert.equal((await request('/api/entries/production', 'PUT', { ...row, qcRejected }, 'fabrica')).status, 422);
  }
  for (const [machine, produced, rejected, qcRejected] of [[1, 50, 10, 15], [2, 0, 0, 0]]) {
    assert.equal((await request('/api/entries/production', 'PUT', { ...row, machine, produced, rejected, qcRejected }, 'fabrica')).status, 200);
  }
  const view = (await request(pathTo(row.date, row.date), 'GET', undefined, 'pca')).data;
  assert.deepEqual([view.totals.produced, view.totals.machineRejected, view.totals.qcApproved, view.totals.qcRejected], [50, 10, 35, 15]);
  const listed = (await request('/api/entries?' + new URLSearchParams({ start: row.date, end: row.date }), 'GET', undefined, 'fabrica')).data.production;
  assert.deepEqual(listed.map((item) => [item.machine, item.qcRejected, item.qcApproved]), [[1, 15, 35], [2, 0, 0]]);
});

test('QC antigo é preservado e conflitos com o registo conjunto exigem resolução explícita', async () => {
  const key = { date: '21/11/2026', delegationCode: 'MAT', machine: 1, revision: null };
  const quality = { ...key, approved: 45, rejected: 5 };
  const production = { ...key, produced: 50, rejected: 10, qcRejected: 5 };
  assert.equal((await request('/api/entries/quality', 'PUT', quality, 'fabrica')).status, 200);
  assert.equal((await request('/api/entries/production', 'PUT', production, 'fabrica')).status, 409);
  let entries = (await request('/api/entries?' + new URLSearchParams({ start: key.date, end: key.date }), 'GET', undefined, 'fabrica')).data;
  assert.equal(entries.production.length, 0);
  assert.equal(entries.quality.length, 1);
  assert.deepEqual([entries.quality[0].approved, entries.quality[0].rejected], [45, 5]);
  assert.equal((await request('/api/entries/quality', 'DELETE', { ...key, revision: 1 }, 'fabrica')).status, 200);
  assert.equal((await request('/api/entries/production', 'PUT', production, 'fabrica')).status, 200);
  assert.equal((await request('/api/entries/quality', 'PUT', quality, 'fabrica')).status, 409);
  assert.equal((await request('/api/entries/quality', 'PUT', { ...quality, machine: 0 }, 'fabrica')).status, 409);
  assert.equal((await request('/api/entries/quality', 'PUT', { ...quality, machine: 2, approved: 9, rejected: 1 }, 'fabrica')).status, 200);
  const view = (await request(pathTo(key.date, key.date), 'GET', undefined, 'pca')).data;
  assert.deepEqual([view.totals.qcApproved, view.totals.qcRejected], [54, 6]);
  // Um QC Geral histórico também impede converter uma produção da mesma data/delegação.
  const general = { ...quality, date: '22/11/2026', machine: 0 };
  assert.equal((await request('/api/entries/quality', 'PUT', general, 'fabrica')).status, 200);
  for (const machine of [1, 2]) {
    assert.equal((await request('/api/entries/production', 'PUT', { ...production, date: general.date, machine }, 'fabrica')).status, 409);
  }
});

test('painel usa o QC integrado uma única vez e conserva o QC histórico na base', async () => {
  const { db } = require('../backend/shared/database');
  const stamp = '23/11/2026 10:00:00.000';
  // Simula uma base histórica/importada com fontes sobrepostas sem as reescrever.
  db.prepare('INSERT INTO production_entries(date,delegation_code,machine,produced,rejected,qc_rejected,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run('23/11/2026', 'MAT', 1, 50, 10, 5, stamp);
  const legacy = db.prepare('INSERT INTO quality_entries(date,delegation_code,machine,approved,rejected,updated_at) VALUES(?,?,?,?,?,?)');
  legacy.run('23/11/2026', 'MAT', 1, 45, 5, stamp);
  legacy.run('23/11/2026', 'MAT', 0, 45, 5, stamp);
  legacy.run('23/11/2026', 'MAT', 2, 8, 2, stamp);
  const view = (await request(pathTo('23/11/2026', '23/11/2026'), 'GET', undefined, 'pca')).data;
  assert.deepEqual([view.totals.qcApproved, view.totals.qcRejected], [53, 7]);
  assert.deepEqual(view.machines.map((row) => [row.qcApproved, row.qcRejected]), [[45, 5], [8, 2]]);
  assert.deepEqual([view.series[0].qcApproved, view.series[0].qcRejected], [53, 7]);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM quality_entries WHERE date='23/11/2026'").get().total, 3);
});

test('produção antiga mantém QC não informado e usa os resultados históricos registados', async () => {
  const { db } = require('../backend/shared/database');
  const date = '24/11/2026', stamp = date + ' 10:00:00.000';
  db.prepare('INSERT INTO production_entries(date,delegation_code,machine,produced,rejected,updated_at) VALUES(?,?,?,?,?,?)')
    .run(date, 'MAT', 1, 50, 10, stamp);
  db.prepare('INSERT INTO quality_entries(date,delegation_code,machine,approved,rejected,updated_at) VALUES(?,?,?,?,?,?)')
    .run(date, 'MAT', 1, 45, 5, stamp);
  const entries = (await request('/api/entries?' + new URLSearchParams({ start: date, end: date }), 'GET', undefined, 'fabrica')).data;
  assert.deepEqual([entries.production[0].qcRejected, entries.production[0].qcApproved], [null, null]);
  const view = (await request(pathTo(date, date), 'GET', undefined, 'pca')).data;
  assert.deepEqual([view.totals.produced, view.totals.machineRejected, view.totals.qcApproved, view.totals.qcRejected], [50, 10, 45, 5]);
  assert.equal((await request('/api/entries/production', 'PUT', {
    date, delegationCode: 'MAT', machine: 1, produced: 50, rejected: 10, qcRejected: 5, revision: 1,
  }, 'fabrica')).status, 409);
  assert.equal(db.prepare('SELECT qc_rejected FROM production_entries WHERE date=?').get(date).qc_rejected, null);
});

test('conflitos, validação, correcção, eliminação e auditoria', async () => {
  const row = { date: '19/11/2026', delegationCode: 'XAI', machine: 1, produced: 20, rejected: 25, qcRejected: 2, revision: null };
  assert.equal((await request('/api/entries/production', 'PUT', row, 'fabrica')).status, 422);
  assert.equal((await request('/api/entries/production', 'PUT', { ...row, rejected: 3 }, 'fabrica')).status, 200);
  assert.equal((await request('/api/entries/production', 'PUT', { ...row, rejected: 3 }, 'fabrica')).status, 409);
  const list = await request('/api/entries?start=19/11/2026&end=19/11/2026', 'GET', undefined, 'fabrica');
  const saved = list.data.production[0];
  assert.equal(saved.revision, 1);
  assert.deepEqual([saved.produced, saved.rejected, saved.qcRejected, saved.qcApproved], [20, 3, 2, 18]);
  const corrected = await request('/api/entries/production', 'PUT', { ...row, produced: 21, rejected: 2, qcRejected: 4, revision: saved.revision }, 'fabrica');
  assert.equal(corrected.status, 200);
  assert.equal(corrected.data.revision, 2);
  const view = (await request(pathTo(row.date, row.date), 'GET', undefined, 'pca')).data;
  assert.deepEqual([view.totals.produced, view.totals.machineRejected, view.totals.qcApproved, view.totals.qcRejected], [21, 2, 17, 4]);
  assert.equal((await request('/api/entries/production', 'PUT', { ...row, produced: 10, rejected: 1, revision: 1 }, 'fabrica')).status, 409);
  assert.equal((await request('/api/entries/production', 'DELETE', { ...row, revision: 1 }, 'fabrica')).status, 409);
  assert.equal((await request('/api/entries/production', 'DELETE', { ...row, revision: 2 }, 'fabrica')).status, 200);
  assert.equal((await request('/api/entries?start=19/11/2026&end=19/11/2026', 'GET', undefined, 'fabrica')).data.production.length, 0);
  const empty = (await request(pathTo(row.date, row.date), 'GET', undefined, 'pca')).data;
  assert.deepEqual([empty.totals.produced, empty.totals.qcApproved, empty.totals.qcRejected], [0, 0, 0]);
  const audits = (await request('/api/audit', 'GET', undefined, 'fabrica')).data;
  assert.ok(audits.some((item) => item.action === 'delete' && item.category === 'production'));
  assert.equal((await request('/api/audit', 'GET', undefined, 'pca')).status, 403);
});

test('persistência física e ausência de fallback no navegador', async () => {
  const independent = new DatabaseSync(process.env.CONTACARTA_DB);
  const row = independent.prepare("SELECT quantity FROM pending_snapshots WHERE date='18/11/2026' AND delegation_code='MAT'").get();
  assert.equal(row.quantity, 175);
  assert.equal(independent.prepare("SELECT COUNT(*) AS total FROM quality_entries WHERE date='18/11/2026'").get().total, 1);
  independent.close();
  const js = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  assert.doesNotMatch(js, /localStorage|sessionStorage/);
  assert.equal((await request('/api/state', 'GET', undefined, 'fabrica')).status, 404);
  assert.equal((await request('/api/operations', 'GET', undefined, 'fabrica')).status, 404);
});

test('os períodos, o histórico e o último INCAPE seguem a cronologia, não a ordem do texto', async () => {
  const dates = ['30/12/2023', '31/12/2023', '01/01/2024', '01/02/2024'];
  for (const [index, date] of dates.entries()) {
    const key = { date, delegationCode: 'NAM', revision: null };
    for (const [kind, fields] of [['pending', { quantity: index }], ['production', { machine: 1, produced: index, rejected: 0, qcRejected: 0 }]]) {
      const result = await request('/api/entries/' + kind, 'PUT', { ...key, ...fields }, 'fabrica');
      assert.equal(result.status, 200);
      assert.match(result.data.updatedAt, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    }
  }
  const { db } = require('../backend/shared/database');
  const changed = db.prepare("UPDATE production_entries SET updated_at=? WHERE date=? AND delegation_code='NAM'");
  changed.run('31/12/2023 23:59:59.999', dates[1]);
  changed.run('01/01/2024 00:00:00.000', dates[2]);
  const result = await request(pathTo(dates[1], dates[2]), 'GET', undefined, 'pca');
  assert.equal(result.status, 200);
  const view = result.data;
  assert.deepEqual([view.start, view.end], dates.slice(1, 3));
  assert.deepEqual(view.series.map((row) => row.date), [dates[1], dates[2]]);
  assert.equal(view.totals.produced, 3);
  assert.equal(view.updatedAt.production, '01/01/2024 00:00:00.000');
  assert.equal(view.delegations.find((row) => row.code === 'NAM').pendingDate, dates[2]);
  const fromBefore = await request(pathTo('02/01/2024', '31/01/2024'), 'GET', undefined, 'pca');
  assert.equal(fromBefore.data.totals.pending, 0);
  const records = await request('/api/entries?' + new URLSearchParams({ start: dates[1], end: dates[2] }), 'GET', undefined, 'fabrica');
  assert.deepEqual(records.data.production.map((row) => row.date), [dates[2], dates[1]]);
  const audit = (await request('/api/audit', 'GET', undefined, 'fabrica')).data[0];
  assert.equal(audit.record_key, '01/02/2024|NAM|1');
  assert.match(audit.created_at, /^\d{2}\/\d{2}\/\d{4} /);
  for (const bad of [pathTo(dates[2], dates[1]), pathTo('31/04/2026', '01/05/2026'), pathTo('12/31/2023', dates[2])]) {
    assert.equal((await request(bad, 'GET', undefined, 'pca')).status, 422);
  }
});

test('datas em todas as categorias: registo, painel, histórico, auditoria e colunas SQLite', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-04-02T23:04:05.678Z'));
  for (const [role, password] of accounts) {
    const { token } = auth.login(role, password, 'calendário');
    sessions['data-' + role] = 'cc_session=' + token;
  }
  const date = '03/04/2020', stamp = '03/04/2026 01:04:05.678';
  const cases = [
    ['pending', 'pending_snapshots', { quantity: 5 }],
    ['production', 'production_entries', { machine: 1, produced: 4, rejected: 0, qcRejected: 1 }],
    ['quality', 'quality_entries', { machine: 2, approved: 3, rejected: 1 }],
    ['dispatch', 'dispatch_entries', { quantity: 2 }],
  ];
  for (const [kind, , fields] of cases) {
    const put = await request('/api/entries/' + kind, 'PUT', { date, delegationCode: 'MAP-C', revision: null, ...fields }, 'data-fabrica');
    assert.equal(put.status, 200);
    assert.equal(put.data.updatedAt, stamp);
  }
  const view = (await request(pathTo(date, date), 'GET', undefined, 'data-pca')).data;
  const capital = view.delegations.find((row) => row.code === 'MAP-C');
  assert.deepEqual([view.start, view.end, view.series[0].date, capital.pendingDate], Array(4).fill(date));
  assert.deepEqual([view.generatedAt, capital.pendingUpdatedAt, ...Object.values(view.updatedAt)], Array(6).fill(stamp));
  const current = (await request('/api/dashboard', 'GET', undefined, 'data-pca')).data;
  assert.deepEqual([current.start, current.end], ['01/04/2026', '03/04/2026']);
  const history = (await request('/api/entries?' + new URLSearchParams({ start: date, end: date }), 'GET', undefined, 'data-fabrica')).data;
  const audits = (await request('/api/audit', 'GET', undefined, 'data-fabrica')).data;
  const { db } = require('../backend/shared/database');
  for (const [kind, table, fields] of cases) {
    assert.deepEqual([history[kind][0].date, history[kind][0].updatedAt], [date, stamp]);
    const raw = db.prepare(`SELECT date, updated_at FROM ${table} WHERE date=? AND delegation_code='MAP-C'`).get(date);
    assert.deepEqual([raw.date, raw.updated_at], [date, stamp]);
    const key = [date, 'MAP-C', ...('machine' in fields ? [fields.machine] : [])].join('|');
    assert.equal(audits.find((row) => row.category === kind && row.record_key === key).created_at, stamp);
    const snapshot = JSON.parse(db.prepare('SELECT new_value FROM audit_log WHERE category=? AND record_key=?').get(kind, key).new_value);
    assert.deepEqual([snapshot.date, snapshot.updated_at], [date, stamp]);
  }
});

test('as sessões conservam as 12 horas mesmo na passagem de ano em Maputo', (t) => {
  const start = Date.parse('2026-12-31T18:00:00.001Z');
  let now = start;
  t.mock.method(Date, 'now', () => now);
  const { token } = auth.login(...accounts[0], 'teste-datas');
  const req = { headers: { cookie: 'cc_session=' + token } };
  assert.equal(auth.session(req).role, 'pca');
  now = start + 12 * 3600_000 - 1;
  assert.equal(auth.session(req).role, 'pca');
  now += 1;
  assert.equal(auth.session(req), null);
});
