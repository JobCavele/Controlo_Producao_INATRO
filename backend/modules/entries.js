'use strict';

const { db } = require('../shared/database');
const { orderKey, timestamp, sqlOrder } = require('../shared/dates');
const { day, count, failure } = require('../shared/http');

const TYPES = Object.freeze({
  pending: { table: 'pending_snapshots', fields: ['quantity'], machine: false },
  production: { table: 'production_entries', fields: ['produced', 'rejected'], machine: true },
  quality: { table: 'quality_entries', fields: ['approved', 'rejected'], machine: true },
  dispatch: { table: 'dispatch_entries', fields: ['quantity'], machine: false },
});

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
        ...Object.fromEntries(type.fields.map((field) => [field, row[field]])),
        revision: row.revision, updatedAt: row.updated_at,
      }));
  }
  return result;
}

function write(kind, input, role) {
  const type = kindOf(kind);
  const key = keyOf(kind, input);
  const fields = Object.fromEntries(type.fields.map((field) => [field, count(input[field], field)]));
  if (kind === 'production' && fields.rejected > fields.produced) failure(422, 'As rejeitadas pela máquina não podem exceder as produzidas.');
  if (input.revision !== null && (!Number.isSafeInteger(input.revision) || input.revision < 1)) failure(422, 'Revisão inválida.');
  if (!Object.hasOwn(input, 'revision')) failure(422, 'É obrigatório indicar a revisão do registo (null para novo).');
  const columns = ['date', 'delegation_code', ...(type.machine ? ['machine'] : []), ...type.fields];
  const values = [key.date, key.delegationCode, ...(type.machine ? [key.machine] : []), ...type.fields.map((field) => fields[field])];
  const now = timestamp();
  db.exec('BEGIN IMMEDIATE');
  try {
    const old = db.prepare(`SELECT * FROM ${type.table} WHERE ${key.where}`).get(...key.params);
    if (old && old.revision !== input.revision || !old && input.revision !== null) failure(409, 'Este registo foi alterado por outra pessoa. Actualiza os dados antes de o guardar.');
    if (old) {
      const setters = [...type.fields.map((field) => `${field}=?`), 'revision=revision+1', 'updated_at=?'];
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
    db.prepare(`DELETE FROM ${type.table} WHERE ${key.where}`).run(...key.params);
    db.prepare('INSERT INTO audit_log(role,action,category,record_key,old_value,new_value,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(role, 'delete', kind, key.params.join('|'), JSON.stringify(old), null, timestamp());
    db.exec('COMMIT');
    return { ok: true };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

module.exports = { TYPES, list, write, remove };
