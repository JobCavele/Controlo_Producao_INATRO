'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { validDay, validFilterYear, monthRange, timestamp, instant } = require('../app/components/dates');
const { prepareDates } = require('../backend/shared/dates');

test('calendário dia/mês/ano, anos bissextos e meia-noite de Maputo', () => {
  for (const value of ['03/04/2026', '31/12/2026', '29/02/2000']) assert.ok(validDay(value));
  for (const value of ['3/4/2026', '04/03/26', '11/18/2026', '2026-11-18', '29/02/2100', '31/04/2026', '00/11/2026', null]) assert.ok(!validDay(value));
  assert.deepEqual(monthRange('02/2024'), { start: '01/02/2024', end: '29/02/2024' });
  assert.equal(monthRange('02/2100').end, '28/02/2100');
  const utc = Date.parse('2026-12-31T22:00:00.012Z');
  assert.equal(timestamp(utc), '01/01/2027 00:00:00.012');
  assert.equal(instant(timestamp(utc)), utc);
});

test('o filtro anual aceita apenas quatro algarismos, dentro do intervalo anunciado', () => {
  for (const year of ['2000', '2026', '2200']) assert.ok(validFilterYear(year));
  for (const year of ['26', '2e03', '20/26', '', '1999', '2201']) assert.ok(!validFilterYear(year));
});

// Recorte das tabelas da versão anterior com chaves, revisões e auditoria reais.
function legacyDb(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  for (const table of ['pending_snapshots', 'production_entries', 'quality_entries', 'dispatch_entries']) {
    db.exec(`CREATE TABLE ${table} (date TEXT, delegation_code TEXT, revision INTEGER, quantity INTEGER, updated_at TEXT, PRIMARY KEY(date, delegation_code));
      INSERT INTO ${table} VALUES('2024-02-29','MAT',7,42,'2024-02-29T22:15:30.123Z');`);
  }
  db.exec(`CREATE TABLE sessions (expires_at TEXT);
    INSERT INTO sessions VALUES('2025-01-01T00:15:30.123Z');
    CREATE TABLE audit_log (created_at TEXT, record_key TEXT, old_value TEXT, new_value TEXT);`);
  const before = { date: '2024-02-29', updated_at: '2024-02-29T22:15:30.123Z', quantity: 42, revision: 7 };
  db.prepare('INSERT INTO audit_log VALUES(?,?,?,?)').run('2024-03-01T08:00:00.000Z', '2024-02-29|MAT|1', JSON.stringify(before), JSON.stringify({ ...before, revision: 8 }));
  return db;
}

test('conversão única das datas anteriores: preserva dias, instantes, revisões e chaves de auditoria', (t) => {
  const db = legacyDb(t);
  prepareDates(db);
  prepareDates(db);
  for (const table of ['pending_snapshots', 'production_entries', 'quality_entries', 'dispatch_entries']) {
    assert.deepEqual({ ...db.prepare(`SELECT * FROM ${table}`).get() }, {
      date: '29/02/2024', delegation_code: 'MAT', revision: 7, quantity: 42, updated_at: '01/03/2024 00:15:30.123',
    });
  }
  assert.equal(db.prepare('SELECT expires_at FROM sessions').get().expires_at, '01/01/2025 02:15:30.123');
  const audit = db.prepare('SELECT * FROM audit_log').get();
  assert.equal(audit.created_at, '01/03/2024 10:00:00.000');
  assert.equal(audit.record_key, '29/02/2024|MAT|1');
  const before = { date: '29/02/2024', updated_at: '01/03/2024 00:15:30.123', quantity: 42, revision: 7 };
  assert.deepEqual(JSON.parse(audit.old_value), before);
  assert.deepEqual(JSON.parse(audit.new_value), { ...before, revision: 8 });
});

test('uma colisão de datas anula toda a conversão sem substituir registos', (t) => {
  const db = legacyDb(t);
  db.exec("INSERT INTO dispatch_entries VALUES('29/02/2024','MAT',1,10,'2024-02-29T10:00:00.000Z')");
  assert.throws(() => prepareDates(db), /conversão das datas foi anulada/);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
  assert.equal(db.prepare('SELECT date FROM pending_snapshots').get().date, '2024-02-29');
  assert.equal(db.prepare('SELECT SUM(quantity) AS total FROM dispatch_entries').get().total, 52);
});

test('não desloca para Março um instante impossível da auditoria de uma base anterior', (t) => {
  const db = legacyDb(t);
  db.exec("UPDATE audit_log SET created_at='2023-02-29T12:00:00.000Z'");
  assert.throws(() => prepareDates(db), /conversão das datas foi anulada/);
  assert.equal(db.prepare('SELECT created_at FROM audit_log').get().created_at, '2023-02-29T12:00:00.000Z');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
});
