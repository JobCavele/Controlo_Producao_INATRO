'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contacarta-dispatch-'));
process.env.CONTACARTA_DB = path.join(directory, 'test.sqlite3');
const server = require('../backend/server');
const { db } = require('../backend/shared/database');
const entries = require('../backend/modules/entries');
const auth = require('../backend/modules/auth');
let base, cookie;

test.before(async () => {
  auth.setPassword('fabrica', 'teste-despachos');
  auth.setPassword('pca', 'teste-consulta');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  const login = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'fabrica', password: 'teste-despachos' }),
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
  await login.json();
});
test.beforeEach(() => db.exec('DELETE FROM dispatch_entries; DELETE FROM quality_entries; DELETE FROM production_entries; DELETE FROM audit_log;'));
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

const production = (date, produced, options = {}) => ({
  date, delegationCode: 'MAT', machine: 1, produced, rejected: 0, qcRejected: 0, revision: null, ...options,
});
const dispatch = (date, quantity, options = {}) => ({ date, delegationCode: 'MAT', quantity, revision: null, ...options });
const put = (kind, row) => entries.write(kind, row, 'fabrica');
const snapshot = () => JSON.stringify(['production_entries', 'quality_entries', 'dispatch_entries', 'audit_log']
  .map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
function rejected(operation, message) {
  const before = snapshot();
  assert.throws(operation, (error) => {
    assert.equal(error.status, 422);
    if (message) assert.match(error.message, message);
    return true;
  });
  assert.equal(snapshot(), before, 'O erro não pode alterar valores, revisões ou auditoria.');
}

test('API limita o despacho às cartas aprovadas, não às produzidas', async () => {
  put('production', production('01/01/2025', 100, { rejected: 80, qcRejected: 60 }));
  const before = snapshot();
  const send = (quantity) => fetch(base + '/api/entries/dispatch', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(dispatch('01/01/2025', quantity)),
  });
  const excessive = await send(5000);
  assert.equal(excessive.status, 422);
  assert.match((await excessive.json()).error, /cartas aprovadas disponíveis.*Disponível para este despacho: 40 cartas/);
  assert.equal(snapshot(), before);
  const exact = await send(40);
  assert.equal(exact.status, 200);
  assert.equal((await exact.json()).revision, 1);
  assert.equal(db.prepare('SELECT quantity FROM dispatch_entries').get().quantity, 40);
});

test('produção sem QC não financia despacho; QC antigo aprovado financia e fica protegido', () => {
  db.prepare('INSERT INTO production_entries(date,delegation_code,machine,produced,rejected,updated_at) VALUES(?,?,?,?,?,?)')
    .run('01/01/2025', 'MAT', 1, 100, 0, '01/01/2025 10:00:00.000');
  rejected(() => put('dispatch', dispatch('01/01/2025', 1)), /Disponível para este despacho: 0 cartas/);
  const quality = { date: '02/01/2025', delegationCode: 'MAT', machine: 1, approved: 60, rejected: 10, revision: null };
  put('quality', quality);
  put('dispatch', dispatch('02/01/2025', 60));
  rejected(() => put('quality', { ...quality, approved: 59, revision: 1 }), /Quantidade mínima aprovada neste registo: 60 cartas/);
  rejected(() => entries.remove('quality', { ...quality, revision: 1 }, 'fabrica'), /Quantidade mínima aprovada neste registo: 60 cartas/);
});

test('saldo soma ambas as máquinas e dias anteriores, desconta despachos e isola delegações', () => {
  put('production', production('31/12/2024', 60));
  put('production', production('01/01/2025', 40, { machine: 2 }));
  put('production', production('01/01/2025', 100, { delegationCode: 'BEI' }));
  put('dispatch', dispatch('01/01/2025', 70));
  rejected(() => put('dispatch', dispatch('02/01/2025', 31)), /Disponível para este despacho: 30 cartas/);
  put('dispatch', dispatch('02/01/2025', 30));
  rejected(() => put('dispatch', dispatch('03/01/2025', 1)), /Disponível para este despacho: 0 cartas/);
  put('dispatch', dispatch('02/01/2025', 100, { delegationCode: 'BEI' }));
});

test('produção futura não financia despacho anterior, mesmo havendo saldo total', () => {
  put('production', production('03/01/2025', 100));
  rejected(() => put('dispatch', dispatch('02/01/2025', 1)), /Disponível para este despacho: 0 cartas/);
  put('dispatch', dispatch('03/01/2025', 100));
});

test('editar despacho substitui o valor anterior sem descontá-lo duas vezes; reduzir e eliminar liberta saldo', () => {
  put('production', production('01/01/2025', 100));
  put('dispatch', dispatch('01/01/2025', 40));
  put('dispatch', dispatch('02/01/2025', 20));
  assert.equal(put('dispatch', dispatch('01/01/2025', 80, { revision: 1 })).revision, 2);
  rejected(() => put('dispatch', dispatch('01/01/2025', 81, { revision: 2 })), /Disponível para este despacho: 80 cartas/);
  assert.equal(put('dispatch', dispatch('01/01/2025', 80, { revision: 2 })).revision, 3);
  put('dispatch', dispatch('01/01/2025', 50, { revision: 3 }));
  put('dispatch', dispatch('02/01/2025', 50, { revision: 1 }));
  entries.remove('dispatch', dispatch('02/01/2025', 50, { revision: 2 }), 'fabrica');
  put('dispatch', dispatch('03/01/2025', 50));
});

test('despacho retroactivo novo ou aumentado não gasta aprovações de despachos posteriores', () => {
  put('production', production('01/01/2025', 100));
  put('dispatch', dispatch('03/01/2025', 100));
  rejected(() => put('dispatch', dispatch('02/01/2025', 1)), /Disponível para este despacho: 0 cartas/);
  put('dispatch', dispatch('03/01/2025', 80, { revision: 1 }));
  put('dispatch', dispatch('02/01/2025', 20));
  rejected(() => put('dispatch', dispatch('02/01/2025', 21, { revision: 1 })), /Disponível para este despacho: 20 cartas/);
  put('production', production('04/01/2025', 100));
  rejected(() => put('dispatch', dispatch('02/01/2025', 21, { revision: 1 })), /Disponível para este despacho: 20 cartas/);
});

test('aprovação consumida não pode ser reduzida ou eliminada; aprovação disponível pode', () => {
  const first = production('01/01/2025', 100), second = production('01/01/2025', 50, { machine: 2 });
  put('production', first);
  put('production', second);
  put('dispatch', dispatch('02/01/2025', 120));
  put('production', { ...first, produced: 70, revision: 1 });
  rejected(() => put('production', { ...first, produced: 69, revision: 2 }), /Quantidade mínima aprovada neste registo: 70 cartas/);
  rejected(() => entries.remove('production', { ...first, revision: 2 }, 'fabrica'), /Quantidade mínima aprovada neste registo: 70 cartas/);
  rejected(() => entries.remove('production', { ...second, revision: 1 }, 'fabrica'), /Quantidade mínima aprovada neste registo: 50 cartas/);
  put('dispatch', dispatch('02/01/2025', 70, { revision: 1 }));
  entries.remove('production', { ...second, revision: 1 }, 'fabrica');
  entries.remove('dispatch', dispatch('02/01/2025', 70, { revision: 2 }), 'fabrica');
  entries.remove('production', { ...first, revision: 2 }, 'fabrica');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM production_entries').get().count, 0);
});

test('redução da produção respeita a data dos despachos, não apenas o total final', () => {
  const first = production('01/01/2025', 100);
  put('production', first);
  put('production', production('04/01/2025', 100));
  put('dispatch', dispatch('03/01/2025', 100));
  rejected(() => put('production', { ...first, produced: 99, revision: 1 }), /Quantidade mínima aprovada neste registo: 100 cartas/);
  rejected(() => entries.remove('production', { ...first, revision: 1 }, 'fabrica'));
  put('production', production('02/01/2025', 10));
  put('production', { ...first, produced: 90, revision: 1 });
});

test('inconsistência histórica de aprovadas não é reescrita: permite reparações e rejeita agravamentos', () => {
  const first = production('01/01/2025', 100);
  put('production', first);
  // Simula um despacho antigo/importado que já excedia as aprovações nessa data.
  db.prepare('INSERT INTO dispatch_entries(date,delegation_code,quantity,updated_at) VALUES(?,?,?,?)')
    .run('02/01/2025', 'MAT', 120, '02/01/2025 10:00:00.000');
  put('production', production('03/01/2025', 100));
  put('dispatch', dispatch('04/01/2025', 80));
  put('dispatch', dispatch('02/01/2025', 110, { revision: 1 }));
  rejected(() => put('dispatch', dispatch('02/01/2025', 111, { revision: 2 })), /Disponível para este despacho: 110 cartas/);
  put('dispatch', dispatch('02/01/2025', 110, { revision: 2 }));
  rejected(() => put('production', { ...first, produced: 99, revision: 1 }));
  put('production', production('01/01/2025', 5, { machine: 2 }));
  rejected(() => put('production', { ...first, qcRejected: 5, revision: 1 }));
  put('dispatch', dispatch('02/01/2025', 100, { revision: 3 }));
  put('production', { ...first, qcRejected: 5, revision: 1 });
  put('dispatch', dispatch('05/01/2025', 20));
  rejected(() => put('dispatch', dispatch('06/01/2025', 1)), /Disponível para este despacho: 0 cartas/);
  assert.equal(db.prepare("SELECT quantity FROM dispatch_entries WHERE date='02/01/2025'").get().quantity, 100);
});
