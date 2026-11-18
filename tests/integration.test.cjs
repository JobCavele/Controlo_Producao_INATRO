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

test.before(async () => {
  auth.setPassword('pca', 'Pca-somente-leitura-123');
  auth.setPassword('fabrica', 'Fabrica-edicao-456');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
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

test('sessões, permissões e armazenamento centralizado', async () => {
  assert.equal((await request('/api/dashboard')).status, 401);
  assert.equal((await request('/api/setup-status')).data.ready, true);
  for (const [role, password] of [['pca', 'Pca-somente-leitura-123'], ['fabrica', 'Fabrica-edicao-456']]) {
    const login = await request('/api/login', 'POST', { role, password });
    assert.equal(login.status, 200);
    sessions[role] = login.headers.get('set-cookie').split(';')[0];
    assert.equal(login.data.role, role);
  }
  assert.equal((await request('/api/entries?start=2026-11-01&end=2026-11-30', 'GET', undefined, 'pca')).status, 403);
  assert.equal((await request('/api/entries/pending', 'PUT', {
    date: '2026-11-18', delegationCode: 'MAT', quantity: 30, revision: null,
  }, 'pca')).status, 403);
  assert.equal((await request(pathTo('2026-11-01', '2026-11-30'), 'GET', undefined, 'pca')).status, 200);
});

test('INCAPE: valores diários substituem-se no resumo, não se somam', async () => {
  const first = await request('/api/entries/pending', 'PUT', {
    date: '2026-11-17', delegationCode: 'MAT', quantity: 200, revision: null,
  }, 'fabrica');
  assert.equal(first.status, 200);
  const second = await request('/api/entries/pending', 'PUT', {
    date: '2026-11-18', delegationCode: 'MAT', quantity: 175, revision: null,
  }, 'fabrica');
  assert.equal(second.status, 200);
  let view = (await request(pathTo('2026-11-01', '2026-11-30'), 'GET', undefined, 'pca')).data;
  assert.equal(view.totals.pending, 175);
  assert.equal(view.totals.pendingCoverage, 1);
  assert.equal(view.delegations.find((row) => row.code === 'MAT').pendingDate, '2026-11-18');
  view = (await request(pathTo('2026-11-01', '2026-11-17'), 'GET', undefined, 'pca')).data;
  assert.equal(view.totals.pending, 200);
  assert.ok(view.updatedAt.pending);
});

test('produção, QC independente, despacho por delegação e máquina', async () => {
  const operations = [
    ['production', { date: '2026-11-18', delegationCode: 'MAT', machine: 1, produced: 100, rejected: 8, revision: null }],
    ['production', { date: '2026-11-18', delegationCode: 'MAT', machine: 2, produced: 65, rejected: 2, revision: null }],
    ['quality', { date: '2026-11-18', delegationCode: 'MAT', machine: 0, approved: 220, rejected: 12, revision: null }],
    ['quality', { date: '2026-11-18', delegationCode: 'BEI', machine: 2, approved: 15, rejected: 1, revision: null }],
    ['dispatch', { date: '2026-11-18', delegationCode: 'MAT', quantity: 180, revision: null }],
  ];
  for (const [kind, row] of operations) {
    const result = await request('/api/entries/' + kind, 'PUT', row, 'fabrica');
    assert.equal(result.status, 200, JSON.stringify(result.data));
  }
  const view = (await request(pathTo('2026-11-18', '2026-11-18'), 'GET', undefined, 'pca')).data;
  assert.equal(view.totals.produced, 165);
  assert.equal(view.totals.machineRejected, 10);
  assert.equal(view.totals.qcApproved, 235); // O QC pode exceder a produção diária.
  assert.equal(view.totals.qcRejected, 13);
  assert.equal(view.totals.dispatched, 180);
  assert.equal(view.machines[0].produced, 100);
  assert.equal(view.machines[1].rejected, 2);
  assert.equal(view.machines[1].qcApproved, 15);
  assert.equal(view.delegations.find((row) => row.code === 'MAT').dispatched, 180);
  assert.ok(view.updatedAt.quality);
  assert.ok(view.updatedAt.dispatch);
});

test('conflitos, validação, correcção, eliminação e auditoria', async () => {
  const row = { date: '2026-11-19', delegationCode: 'XAI', machine: 1, produced: 20, rejected: 25, revision: null };
  assert.equal((await request('/api/entries/production', 'PUT', row, 'fabrica')).status, 422);
  assert.equal((await request('/api/entries/production', 'PUT', { ...row, rejected: 3 }, 'fabrica')).status, 200);
  assert.equal((await request('/api/entries/production', 'PUT', { ...row, rejected: 3 }, 'fabrica')).status, 409);
  const list = await request('/api/entries?start=2026-11-19&end=2026-11-19', 'GET', undefined, 'fabrica');
  const saved = list.data.production[0];
  assert.equal(saved.revision, 1);
  const corrected = await request('/api/entries/production', 'PUT', { ...row, produced: 21, rejected: 2, revision: saved.revision }, 'fabrica');
  assert.equal(corrected.status, 200);
  assert.equal(corrected.data.revision, 2);
  assert.equal((await request('/api/entries/production', 'PUT', { ...row, produced: 10, rejected: 1, revision: 1 }, 'fabrica')).status, 409);
  assert.equal((await request('/api/entries/production', 'DELETE', { ...row, revision: 1 }, 'fabrica')).status, 409);
  assert.equal((await request('/api/entries/production', 'DELETE', { ...row, revision: 2 }, 'fabrica')).status, 200);
  assert.equal((await request('/api/entries?start=2026-11-19&end=2026-11-19', 'GET', undefined, 'fabrica')).data.production.length, 0);
  const audits = (await request('/api/audit', 'GET', undefined, 'fabrica')).data;
  assert.ok(audits.some((item) => item.action === 'delete' && item.category === 'production'));
  assert.equal((await request('/api/audit', 'GET', undefined, 'pca')).status, 403);
});

test('persistência física e ausência de fallback no navegador', async () => {
  const independent = new DatabaseSync(process.env.CONTACARTA_DB);
  const row = independent.prepare("SELECT quantity FROM pending_snapshots WHERE date='2026-11-18' AND delegation_code='MAT'").get();
  assert.equal(row.quantity, 175);
  assert.equal(independent.prepare('SELECT COUNT(*) AS total FROM quality_entries').get().total, 2);
  independent.close();
  const js = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
  assert.doesNotMatch(js, /localStorage|sessionStorage/);
  assert.equal((await request('/api/state', 'GET', undefined, 'fabrica')).status, 404);
  assert.equal((await request('/api/operations', 'GET', undefined, 'fabrica')).status, 404);
});
