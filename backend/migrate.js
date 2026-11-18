'use strict';

// Importação voluntária: os valores antigos podem ter sido registados em lotes
// e em movimentos ao mesmo tempo. Nunca se presume que representam cartas distintas.
const { backup } = require('node:sqlite');
const path = require('node:path');
const { db, file } = require('./shared/database');
require('./modules/delegations');
const entries = require('./modules/entries');

const available = (name) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
const delegations = db.prepare('SELECT code,name FROM delegations').all();
const nameToCode = new Map(delegations.map((row) => [row.name.toLowerCase(), row.code]));
const normal = (name) => String(name || '').trim().toLowerCase();
const grouped = new Map();
const skipped = [];
const collisions = [];
const validDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') &&
  !Number.isNaN(Date.parse(value + 'T00:00:00Z')) &&
  new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const validQty = (value) => Number.isSafeInteger(value) && value >= 0;

function add(kind, data, source) {
  const key = [kind, data.date, data.delegationCode, data.machine ?? ''].join('|');
  if (grouped.has(key) && grouped.get(key).source !== source) {
    collisions.push(`A mesma data/delegação aparece em origens diferentes: ${key}`);
    return;
  }
  const prev = grouped.get(key);
  if (prev) {
    for (const field of Object.keys(data).filter((name) => !['date', 'delegationCode', 'machine'].includes(name)))
      prev.data[field] += data[field];
  } else grouped.set(key, { kind, data: { ...data }, source });
}

if (available('app_state')) {
  const old = db.prepare('SELECT document FROM app_state WHERE id=1').get();
  const document = old?.document ? JSON.parse(old.document) : {};
  const lots = new Map((document.lots || []).map((lot) => [lot.id, lot.delegation]));
  for (const record of document.records || []) {
    for (const entry of record.entries || []) {
      const code = nameToCode.get(normal(entry.delegation || lots.get(entry.lotId)));
      const date = record.start;
      if (date !== record.end || !validDay(date) || !code || ![0, 1].includes(entry.machine) ||
          !validQty(entry.produced) || !validQty(entry.rejected) || entry.rejected > entry.produced) {
        skipped.push('Registo antigo sem dia, delegação, máquina ou quantidade clara: ' + (entry.id || record.id || 'desconhecido'));
        continue;
      }
      add('production', { date, delegationCode: code, machine: entry.machine + 1,
        produced: entry.produced, rejected: entry.rejected }, 'registos');
      if (entry.qualityRejected) skipped.push('QC antigo não importado automaticamente: ' + (entry.id || date));
    }
  }
}

if (available('operations')) {
  const operations = db.prepare('SELECT * FROM operations ORDER BY event_date').all();
  for (const operation of operations) {
    const code = nameToCode.get(normal(operation.delegation));
    const date = operation.event_date;
    if (!['printed', 'qc_approved', 'qc_rejected', 'dispatch'].includes(operation.type)) {
      skipped.push('Movimento de lote não importado: ' + operation.type);
      continue;
    }
    if (!code || !validDay(date) || !validQty(operation.quantity)) {
      skipped.push('Movimento sem delegação/data/quantidade válida: ' + operation.id);
      continue;
    }
    const meta = JSON.parse(operation.metadata || '{}');
    if (operation.type === 'printed') {
      const machine = meta.machine === 'Máquina 1' ? 1 : meta.machine === 'Máquina 2' ? 2 : 0;
      if (!machine) { skipped.push('Impressão sem máquina identificada: ' + operation.id); continue; }
      // A antiga tabela de movimentos não permite associar rejeições a cada
      // máquina: estas serão verificadas manualmente antes de usar os totais.
      add('production', { date, delegationCode: code, machine, produced: operation.quantity, rejected: 0 }, 'movimentos');
    }
    if (operation.type === 'qc_approved' || operation.type === 'qc_rejected') {
      add('quality', { date, delegationCode: code, machine: 0,
        approved: operation.type === 'qc_approved' ? operation.quantity : 0,
        rejected: operation.type === 'qc_rejected' ? operation.quantity : 0 }, 'movimentos');
    }
    if (operation.type === 'dispatch') add('dispatch', { date, delegationCode: code, quantity: operation.quantity }, 'movimentos');
  }
  if (operations.some((operation) => operation.type === 'print_rejected')) {
    collisions.push('Existem rejeições na impressão sem máquina associada. Reconcilie-as antes de migrar.');
  }
}

for (const row of grouped.values()) {
  if (Object.entries(row.data).some(([key, value]) => !['date', 'delegationCode', 'machine'].includes(key) && (!validQty(value) || value > 1_000_000_000)))
    collisions.push('Soma de quantidades inválida: ' + JSON.stringify(row.data));
  const old = entries.list(row.data.date, row.data.date)[row.kind].find((entry) =>
    entry.date === row.data.date && entry.delegationCode === row.data.delegationCode && (entry.machine ?? 0) === (row.data.machine ?? 0));
  if (old) collisions.push('Já existe um registo novo correspondente a: ' + JSON.stringify(row.data));
}
const counts = {};
for (const row of grouped.values()) counts[row.kind] = (counts[row.kind] || 0) + 1;
console.log(JSON.stringify({
  origem: file, previstos: counts, ignorados: skipped.length, exemplosIgnorados: skipped.slice(0, 25),
  conflitos: collisions.length, exemplosConflitos: collisions.slice(0, 25),
}, null, 2));
if (!process.argv.includes('--apply')) {
  console.log('\nPré-visualização apenas. Confirme o relatório antes de executar npm run migrate:apply.');
} else if (collisions.length) {
  console.error('Importação cancelada. É necessário reconciliar os conflitos sem alterar a base.');
  process.exitCode = 1;
} else if (!grouped.size) {
  console.log('Não existem registos compatíveis para importar.');
} else {
  (async () => {
    const backupFile = path.join(path.dirname(file), 'contacarta-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite3');
    await backup(db, backupFile);
    db.exec('BEGIN IMMEDIATE');
    try {
      const table = {
        production: ['production_entries', ['date', 'delegation_code', 'machine', 'produced', 'rejected']],
        quality: ['quality_entries', ['date', 'delegation_code', 'machine', 'approved', 'rejected']],
        dispatch: ['dispatch_entries', ['date', 'delegation_code', 'quantity']],
      };
      const now = new Date().toISOString();
      for (const row of grouped.values()) {
        const [name, cols] = table[row.kind];
        const values = {
          date: row.data.date, delegation_code: row.data.delegationCode, machine: row.data.machine,
          produced: row.data.produced, rejected: row.data.rejected, approved: row.data.approved, quantity: row.data.quantity,
        };
        db.prepare(`INSERT INTO ${name}(${cols.join(',')},updated_at) VALUES(${cols.map(() => '?').join(',')},?)`)
          .run(...cols.map((column) => values[column]), now);
        db.prepare('INSERT INTO audit_log(role,action,category,record_key,old_value,new_value,created_at) VALUES(?,?,?,?,?,?,?)')
          .run('migracao', 'insert', row.kind, [row.data.date, row.data.delegationCode, row.data.machine ?? ''].join('|'),
            null, JSON.stringify(row.data), now);
      }
      db.exec('COMMIT');
      console.log(`Importados ${grouped.size} totais diários. Cópia de segurança: ${backupFile}`);
      if (skipped.length) console.warn('Existem registos não importados. Consulte a pré-visualização para os reconciliar.');
    } catch (error) {
      db.exec('ROLLBACK');
      console.error('Falha na importação:', error.message, 'Cópia de segurança:', backupFile);
      process.exitCode = 1;
    }
  })();
}
