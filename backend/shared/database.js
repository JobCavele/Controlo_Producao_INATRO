/*
 * Conta Carta · a base de dados
 *
 * Um ficheiro SQLite em `dados/`. Cada gravação fica inteira nesse ficheiro
 * antes de ser dada como feita: não há ficheiros ao lado com dados por
 * arrumar, e copiar `contacarta.sqlite3` com o programa fechado leva tudo.
 * O que mexe em mais de uma coisa (o estado e os movimentos) grava-se numa
 * transacção: ou entra tudo, ou não entra nada.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA = path.resolve(__dirname, '../../dados');

/** Um erro que se explica a quem abre o programa: a frase chega, sem pilha de código. */
function unreadable(message) {
  return Object.assign(new Error(message), { readable: true });
}

/** O ficheiro dos dados: o que for pedido, o habitual ou, nas instalações antigas, `cartas.sqlite3`. */
function locate() {
  if (process.env.CONTACARTA_DB) return path.resolve(process.env.CONTACARTA_DB);
  const usual = path.join(DATA, 'contacarta.sqlite3');
  const former = path.join(DATA, 'cartas.sqlite3');
  return !fs.existsSync(usual) && fs.existsSync(former) ? former : usual;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, document TEXT NOT NULL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, type TEXT NOT NULL, batch_id TEXT, delegation TEXT, event_date TEXT NOT NULL, quantity INTEGER NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_operations_batch ON operations(batch_id,event_date);
CREATE INDEX IF NOT EXISTS idx_operations_date ON operations(event_date,type);
CREATE TABLE IF NOT EXISTS delegations (code TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, province TEXT NOT NULL, lat REAL, lng REAL);
`;

const file = locate();
let db;
try {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 5000');
  const health = db.prepare('PRAGMA quick_check').get().quick_check;
  if (health !== 'ok') throw new Error(health);
} catch (error) {
  throw unreadable(`O ficheiro ${file} não se consegue abrir como base de dados (${error.message}). Nada foi alterado nele.`);
}

/**
 * Deixa a base pronta a gravar. Só se chama depois de se confirmar que o que
 * lá está se consegue ler: até aí, abrir o programa não escreve nada.
 * Devolve `false` se outro programa tiver a base aberta e ela não puder ficar
 * num ficheiro só.
 */
function prepare() {
  // Um ficheiro só. Uma base que vinha a guardar ao lado (em «-wal») é arrumada aqui, de uma vez:
  // o que lá estava passa para o ficheiro principal e o ficheiro do lado desaparece.
  let single = false;
  try {
    single = db.prepare('PRAGMA journal_mode = DELETE').get().journal_mode === 'delete';
  } catch (error) {
    // com a base aberta noutro programa a arrumação não se pode fazer agora: fica para o próximo arranque
    if (error.errcode !== 5) throw error;
  }
  db.exec('PRAGMA synchronous = FULL');
  db.exec(SCHEMA);
  // as bases mais antigas não guardavam a hora da gravação
  if (!db.prepare('PRAGMA table_info(app_state)').all().some((column) => column.name === 'updated_at')) {
    db.exec('ALTER TABLE app_state ADD COLUMN updated_at TEXT');
  }
  return single;
}

/** Corre `work` numa transacção e devolve o que ele devolver; se falhar, nada do que fez fica gravado. */
function transaction(work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    // se o próprio SQLite já desfez a transacção (disco cheio, por exemplo), o erro que interessa é o primeiro
    try { db.exec('ROLLBACK'); } catch { /* já não havia transacção aberta */ }
    throw error;
  }
}

/** Fecha o ficheiro ao sair do programa. */
let open = true;
function close() {
  if (!open) return;
  open = false;
  db.close();
}
process.once('exit', close);

module.exports = { db, file, prepare, transaction, close, unreadable };
