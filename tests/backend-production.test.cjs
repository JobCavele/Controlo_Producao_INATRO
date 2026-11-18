'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

test('actualização aditiva preserva produção, QC e auditoria antigos sem inventar aprovadas', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contacarta-production-'));
  let actual;
  t.after(() => {
    actual?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const file = path.join(directory, 'legacy.sqlite3');
  const legacy = new DatabaseSync(file);
  legacy.exec(`
    PRAGMA user_version=1;
    CREATE TABLE production_entries (
      date TEXT NOT NULL, delegation_code TEXT NOT NULL,
      machine INTEGER NOT NULL, produced INTEGER NOT NULL, rejected INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
      PRIMARY KEY(date,delegation_code,machine)
    );
    CREATE TABLE quality_entries (
      date TEXT NOT NULL, delegation_code TEXT NOT NULL, machine INTEGER NOT NULL,
      approved INTEGER NOT NULL, rejected INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
      PRIMARY KEY(date,delegation_code,machine)
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL,
      action TEXT NOT NULL, category TEXT NOT NULL, record_key TEXT NOT NULL,
      old_value TEXT, new_value TEXT, created_at TEXT NOT NULL
    );
    INSERT INTO production_entries VALUES('01/11/2026','MAT',1,50,10,7,'01/11/2026 10:00:00.000');
    INSERT INTO quality_entries VALUES('01/11/2026','MAT',1,45,5,3,'01/11/2026 11:00:00.000');
    INSERT INTO audit_log(role,action,category,record_key,old_value,new_value,created_at)
      VALUES('fabrica','insert','production','01/11/2026|MAT|1',NULL,'{"produced":50,"rejected":10}','01/11/2026 10:00:00.000');
  `);
  legacy.close();
  const modulePath = path.resolve(__dirname, '../backend/shared/database');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(modulePath)}).db.close()`], {
      env: { ...process.env, CONTACARTA_DB: file }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  }
  actual = new DatabaseSync(file);
  const columns = actual.prepare('PRAGMA table_info(production_entries)').all();
  assert.equal(columns.filter((column) => column.name === 'qc_rejected').length, 1);
  assert.deepEqual({ ...actual.prepare('SELECT * FROM production_entries').get() }, {
    date: '01/11/2026', delegation_code: 'MAT', machine: 1, produced: 50, rejected: 10,
    revision: 7, updated_at: '01/11/2026 10:00:00.000', qc_rejected: null,
  });
  assert.deepEqual({ ...actual.prepare('SELECT * FROM quality_entries').get() }, {
    date: '01/11/2026', delegation_code: 'MAT', machine: 1, approved: 45, rejected: 5,
    revision: 3, updated_at: '01/11/2026 11:00:00.000',
  });
  assert.equal(actual.prepare('SELECT new_value FROM audit_log').get().new_value, '{"produced":50,"rejected":10}');
  assert.throws(() => actual.exec('UPDATE production_entries SET qc_rejected=-1'));
  assert.throws(() => actual.exec('UPDATE production_entries SET qc_rejected=51'));
  actual.exec('UPDATE production_entries SET qc_rejected=15');
  assert.equal(actual.prepare('SELECT produced-qc_rejected AS approved FROM production_entries').get().approved, 35);
});
