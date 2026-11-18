/*
 * Conta Carta · os movimentos acompanham o estado
 *
 * Os movimentos pertencem aos lotes e aos artigos do armazém. Quando o estado
 * é gravado, ficam de acordo com ele, na mesma transacção: uma cópia
 * importada traz os seus, o exemplo entra e sai com os seus, e um lote ou um
 * artigo que deixa de existir leva os que eram dele.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const core = require('../../app/lib/core');
const { db } = require('../shared/database');
const { day, failure } = require('../shared/http');
const { TYPES, STOCK, store } = require('./operations');

/** O artigo do armazém em que um movimento somou (fica nos dados do movimento). */
const ITEM = "json_extract(metadata, '$.stockId')";
const SAMPLE_FILE = path.resolve(__dirname, '../../app/sample.json');
const MAX_COPY = 200_000;

/**
 * Confere os movimentos de uma cópia (ou do exemplo) antes de entrarem na
 * base: só a forma de cada um. Os saldos não se voltam a conferir, porque
 * foram conferidos quando cada movimento foi registado.
 */
function fromCopy(list) {
  if (!Array.isArray(list) || list.length > MAX_COPY) failure(422, 'A cópia não traz os movimentos em condições.');
  const seen = new Set();
  return list.map((move, index) => {
    const where = `Movimento ${index + 1} da cópia`;
    const bad = (what) => failure(422, `${where}: ${what}.`);
    if (!move || typeof move !== 'object') bad('formato inválido');
    if (typeof move.id !== 'string' || !move.id || move.id.length > 64) bad('identificador inválido');
    if (seen.has(move.id)) bad('identificador repetido');
    seen.add(move.id);
    if (!TYPES.includes(move.type)) bad('tipo de movimento desconhecido');
    const ofLot = !STOCK.includes(move.type);
    if (ofLot ? typeof move.batchId !== 'string' || !move.batchId || move.batchId.length > 64 : Boolean(move.batchId)) bad('o lote não está em condições');
    if (!Number.isSafeInteger(move.quantity) || move.quantity <= 0) bad('a quantidade tem de ser um inteiro positivo');
    try { day(move.date); } catch { bad('a data não é um dia válido (AAAA-MM-DD)'); }
    const metadata = move.metadata === undefined ? {} : move.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || JSON.stringify(metadata).length > 2000) bad('os dados do movimento não estão em condições');
    if (move.delegation !== undefined && (typeof move.delegation !== 'string' || move.delegation.length > 80)) bad('a delegação está inválida');
    if (move.createdAt !== undefined && (typeof move.createdAt !== 'string' || move.createdAt.length > 40)) bad('a hora do registo está inválida');
    return {
      id: move.id, type: move.type, batchId: ofLot ? move.batchId : null, delegation: move.delegation || '',
      date: move.date, quantity: move.quantity, metadata, createdAt: move.createdAt || `${move.date}T00:00:00.000Z`,
    };
  });
}

/** Os movimentos do exemplo, tal como vêm em `app/sample.json` (lidos uma vez). */
let sampleMoves = null;
function sample() {
  if (!sampleMoves) {
    try {
      sampleMoves = fromCopy(JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8')).operations || []);
    } catch {
      sampleMoves = [];   // sem exemplo em condições não há movimentos fictícios; o resto funciona na mesma
    }
  }
  return sampleMoves;
}

/**
 * Põe os movimentos de acordo com o estado que acabou de ser gravado. Corre
 * na transacção da gravação, com o estado anterior e o novo:
 *  - `copy`, quando vem uma cópia importada, substitui todos os movimentos;
 *  - um lote não baixa a quantidade para menos do que já tem personalizado;
 *  - os lotes do exemplo que chegam trazem os movimentos do exemplo, e sem
 *    lotes do exemplo não fica nenhum movimento do exemplo;
 *  - um lote ou um artigo do armazém que não existe não tem movimentos: os
 *    do que foi apagado saem com ele, e os do exemplo não ficam sem o artigo
 *    em que somam.
 */
function state(previous, next, copy) {
  const lots = new Map((next.lots || []).map((lot) => [lot.id, lot]));
  const items = new Set((next.stock || []).map((item) => item.id));
  if (copy) {
    db.exec('DELETE FROM operations');
    for (const move of copy) store(move);
  } else {
    // um lote não pode encolher para menos do que os seus movimentos já personalizaram: os saldos ficavam negativos.
    // Só se confere o lote cuja quantidade esta gravação baixa; os outros gravam-se como sempre.
    const earlier = new Map((previous.lots || []).map((lot) => [lot.id, lot.quantity]));
    const personalized = db.prepare("SELECT COALESCE(SUM(quantity), 0) AS total FROM operations WHERE batch_id = ? AND type = 'personalized'");
    for (const lot of lots.values()) {
      if (!earlier.has(lot.id) || lot.quantity >= earlier.get(lot.id)) continue;
      const done = personalized.get(lot.id).total;
      if (lot.quantity < done) failure(422, `O lote ${lot.reference} já tem ${done} cartas personalizadas: a quantidade não pode ser inferior.`);
    }
    // e os dias de um lote não ficam com menos cartas aprovadas do que as que os movimentos já levaram para despacho.
    // Também aqui só trava a gravação que as baixa (um lote com a impressão nos movimentos não depende dos dias).
    const was = core.lotDays(previous.records);
    const now = core.lotDays(next.records);
    const told = new Set(db.prepare(`SELECT DISTINCT batch_id AS id FROM operations WHERE type IN (${core.DAY_MOVES.map(() => '?').join()})`).all(...core.DAY_MOVES).map((row) => row.id));
    for (const { id, moved } of db.prepare("SELECT batch_id AS id, SUM(quantity) AS moved FROM operations WHERE type = 'transfer' GROUP BY batch_id").all()) {
      const lot = lots.get(id);
      const before = was.get(id);
      if (!lot || !before || told.has(id)) continue;
      const approved = (now.get(id) || { approved: 0 }).approved;
      if (approved < before.approved && approved < moved) {
        failure(422, `O lote ${lot.reference} já tem ${moved} cartas movidas para despacho: os dias de produção não podem ficar com menos aprovadas.`);
      }
    }
  }
  const before = new Set((previous.lots || []).map((lot) => lot.id));
  const arrived = new Set([...lots.keys()].filter((id) => id.startsWith(core.SAMPLE_PREFIX) && !before.has(id)));
  if (arrived.size) {
    for (const move of sample()) {
      if (!move.batchId || arrived.has(move.batchId)) store({ ...move, delegation: move.batchId ? lots.get(move.batchId).delegation : '' });
    }
  }
  if (![...lots.keys()].some((id) => id.startsWith(core.SAMPLE_PREFIX))) {
    db.prepare('DELETE FROM operations WHERE substr(id, 1, ?) = ?').run(core.SAMPLE_PREFIX.length, core.SAMPLE_PREFIX);
  }
  // o que não existe não tem movimentos: o lote, e o artigo do armazém em que eles somaram
  // (um movimento antigo do armazém, de quando o material se escrevia à mão, não é de artigo nenhum: fica)
  const ofLot = db.prepare('DELETE FROM operations WHERE batch_id = ?');
  for (const row of db.prepare('SELECT DISTINCT batch_id AS id FROM operations WHERE batch_id IS NOT NULL').all()) {
    if (!lots.has(row.id)) ofLot.run(row.id);
  }
  const ofItem = db.prepare(`DELETE FROM operations WHERE batch_id IS NULL AND ${ITEM} = ?`);
  for (const row of db.prepare(`SELECT DISTINCT ${ITEM} AS id FROM operations WHERE batch_id IS NULL AND ${ITEM} IS NOT NULL`).all()) {
    if (!items.has(row.id)) ofItem.run(row.id);
  }
}

module.exports = { fromCopy, state };
