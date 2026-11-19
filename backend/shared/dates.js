'use strict';

// Reutiliza o calendário público (sem DOM). Só a adaptação ao SQLite fica no servidor.
const { fromIsoDay, validDay, timestamp, instant, today, firstOfMonth, orderKey } = require('../../app/components/dates');

// Equivalente SQL a orderKey(). Só usa funções nativas, inclusive nos índices:
// a base continua legível em qualquer ferramenta SQLite, sem extensões da aplicação.
const sqlOrder = (col) => `(substr(${col},7,4)||'-'||substr(${col},4,2)||'-'||substr(${col},1,2)||substr(${col},11))`;
const tables = ['pending_snapshots', 'production_entries', 'quality_entries', 'dispatch_entries'];

function localDay(value) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? fromIsoDay(value) : value;
  if (!validDay(day)) throw new Error(`Data de registo inválida: ${value}`);
  return day;
}
function localStamp(value) {
  if (/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(value)) {
    const ms = instant(value);
    if (Number.isFinite(ms) && timestamp(ms) === value) return value;
  } else if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && validDay(fromIsoDay(value))) {
    // Date.parse normaliza alguns dias impossíveis. Não corrija a data de auditoria por adivinhação.
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) {
      const local = timestamp(ms);
      if (validDay(local.slice(0, 10))) return local;
    }
  }
  throw new Error(`Data/hora inválida: ${value}`);
}
function auditSnapshot(text) {
  if (text === null) return null;
  const row = JSON.parse(text);
  if (!row || typeof row !== 'object') return text;
  if (Object.hasOwn(row, 'date')) row.date = localDay(row.date);
  if (Object.hasOwn(row, 'updated_at')) row.updated_at = localStamp(row.updated_at);
  return JSON.stringify(row);
}

function prepareDates(db) {
  const version = () => db.prepare('PRAGMA user_version').get().user_version;
  if (version() >= 1) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    if (version() < 1) {
      // Em Node 22.13, exec() pode não propagar a excepção de uma função SQLite.
      // Guarde o primeiro erro e aborte em JS antes do COMMIT, mesmo em colunas anuláveis.
      let invalid;
      const checked = (convert) => (value) => {
        if (!invalid) {
          try { return convert(value); } catch (error) { invalid = error; }
        }
        return value;
      };
      db.function('cc_day', checked(localDay));
      db.function('cc_stamp', checked(localStamp));
      db.function('cc_snapshot', checked(auditSnapshot));
      for (const table of tables) {
        db.exec(`UPDATE ${table} SET date=cc_day(date), updated_at=cc_stamp(updated_at);
          CREATE INDEX idx_${table}_period ON ${table}(${sqlOrder('date')});`);
      }
      db.exec(`UPDATE sessions SET expires_at=cc_stamp(expires_at);
        UPDATE audit_log SET created_at=cc_stamp(created_at),
          record_key=CASE WHEN record_key GLOB '????-??-??|*' THEN cc_day(substr(record_key,1,10))||substr(record_key,11) ELSE record_key END,
          old_value=cc_snapshot(old_value), new_value=cc_snapshot(new_value);
        DROP INDEX IF EXISTS idx_pending_date;
        CREATE INDEX idx_pending_latest ON pending_snapshots(delegation_code, ${sqlOrder('date')});`);
      if (invalid) throw invalid;
      db.exec('PRAGMA user_version = 1');
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw new Error(`A conversão das datas foi anulada; os registos foram preservados. ${error.message}`, { cause: error });
  }
}
module.exports = { validDay, today, firstOfMonth, orderKey, timestamp, sqlOrder, prepareDates };
