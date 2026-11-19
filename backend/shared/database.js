'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { prepareDates } = require('./dates');

const file = path.resolve(process.env.CONTACARTA_DB || path.join(__dirname, '../../dados/contacarta.sqlite3'));
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new DatabaseSync(file);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS delegations (
    code TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, province TEXT NOT NULL,
    lat REAL, lng REAL
  );

  CREATE TABLE IF NOT EXISTS pending_snapshots (
    date TEXT NOT NULL, delegation_code TEXT NOT NULL REFERENCES delegations(code),
    quantity INTEGER NOT NULL CHECK(quantity >= 0),
    revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
    PRIMARY KEY(date, delegation_code)
  );

  CREATE TABLE IF NOT EXISTS production_entries (
    date TEXT NOT NULL, delegation_code TEXT NOT NULL REFERENCES delegations(code),
    machine INTEGER NOT NULL CHECK(machine IN (1,2)),
    produced INTEGER NOT NULL CHECK(produced >= 0),
    rejected INTEGER NOT NULL CHECK(rejected >= 0 AND rejected <= produced),
    qc_rejected INTEGER CHECK(qc_rejected >= 0 AND qc_rejected <= produced),
    revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
    PRIMARY KEY(date, delegation_code, machine)
  );
  CREATE TABLE IF NOT EXISTS quality_entries (
    date TEXT NOT NULL, delegation_code TEXT NOT NULL REFERENCES delegations(code),
    machine INTEGER NOT NULL DEFAULT 0 CHECK(machine IN (0,1,2)),
    approved INTEGER NOT NULL CHECK(approved >= 0),
    rejected INTEGER NOT NULL CHECK(rejected >= 0),
    revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
    PRIMARY KEY(date, delegation_code, machine)
  );
  CREATE TABLE IF NOT EXISTS dispatch_entries (
    date TEXT NOT NULL, delegation_code TEXT NOT NULL REFERENCES delegations(code),
    quantity INTEGER NOT NULL CHECK(quantity >= 0),
    revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
    PRIMARY KEY(date, delegation_code)
  );

  CREATE TABLE IF NOT EXISTS users (
    role TEXT PRIMARY KEY CHECK(role IN ('pca', 'fabrica')),
    salt TEXT NOT NULL, password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, role TEXT NOT NULL REFERENCES users(role),
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL,
    action TEXT NOT NULL, category TEXT NOT NULL,
    record_key TEXT NOT NULL, old_value TEXT, new_value TEXT,
    created_at TEXT NOT NULL
  );
`);

// A coluna anulável distingue os registos antigos do novo registo conjunto.
// Nunca deduzimos o QC histórico a partir das rejeições da máquina.
if (!db.prepare('PRAGMA table_info(production_entries)').all().some((column) => column.name === 'qc_rejected')) {
  db.exec('ALTER TABLE production_entries ADD COLUMN qc_rejected INTEGER CHECK(qc_rejected >= 0 AND qc_rejected <= produced)');
}

prepareDates(db);

module.exports = { db, file };
