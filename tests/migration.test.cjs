'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

test('migração: simulação, cópia de segurança e importação sem duplicação', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'contacarta-migration-'));
  const file = path.join(directory, 'legacy.sqlite3');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE app_state (id INTEGER PRIMARY KEY,document TEXT);');
  const legacy = {
    records: [{ id: 'dia-1', start: '2026-11-17', end: '2026-11-17',
      entries: [{ id: 'r-1', delegation: 'Matola', machine: 0, produced: 88, rejected: 4, qualityRejected: 2 }] }],
    lots: [],
  };
  db.prepare('INSERT INTO app_state(id,document) VALUES(1,?)').run(JSON.stringify(legacy));
  db.close();
  const run = (args) => spawnSync(process.execPath, [path.resolve(__dirname, '../backend/migrate.js'), ...args],
    { env: { ...process.env, CONTACARTA_DB: file }, encoding: 'utf8' });
  try {
    let result = run([]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"production": 1/);
    result = run(['--apply']);
    assert.equal(result.status, 0, result.stderr);
    const check = new DatabaseSync(file);
    assert.deepEqual({ ...check.prepare('SELECT produced,rejected FROM production_entries').get() }, { produced: 88, rejected: 4 });
    assert.equal(check.prepare('SELECT COUNT(*) AS total FROM app_state').get().total, 1);
    check.close();
    assert.ok(fs.readdirSync(directory).some((name) => name.includes('backup-')));
    result = run(['--apply']);
    assert.equal(result.status, 1, 'A repetição da migração deve ser recusada.');
    assert.match(result.stderr, /cancelada/i);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
