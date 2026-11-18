/*
 * Conta Carta · movimentos por quantidades
 *
 * Cada movimento de um lote (personalização, impressão, qualidade, despacho)
 * e do armazém fica numa linha, e o saldo de cada fase tira-se da soma das
 * linhas. Antes de guardar, o servidor confere o que há disponível: nenhuma
 * fase recebe mais cartas do que as que a anterior lhe passou.
 *
 * Nada se escreve duas vezes. O movimento de um lote actualiza as fases desse
 * lote no quadro; o do armazém soma ao artigo escolhido na lista do armazém.
 * Tudo na mesma gravação, para o quadro, o armazém e os movimentos dizerem
 * sempre o mesmo. E a impressão e o teste de um lote apontado nos dias de
 * produção lêem-se dos dias: não se pedem outra vez como movimentos, e as
 * cartas aprovadas lá ficam logo prontas para mover e despachar.
 */
'use strict';

const crypto = require('node:crypto');
const catalogue = require('../../app/lib/delegations');
const core = require('../../app/lib/core');
const { db } = require('../shared/database');
const { qty, day, failure } = require('../shared/http');

const STOCK = ['stock_in', 'stock_out'];
/** Os movimentos que levam as cartas de um lote de fase em fase, pela ordem do caminho. */
const CHAIN = ['personalized', 'printed', 'print_rejected', 'qc_approved', 'qc_rejected', 'transfer', 'dispatch'];
const TYPES = [...STOCK, ...CHAIN, 'batch_error', 'batch_error_resolved'];

/** Todos os movimentos, pela ordem em que aconteceram (no mesmo dia, pela ordem em que foram escritos). */
function records() {
  return db.prepare('SELECT id, type, batch_id AS batchId, delegation, event_date AS date, quantity, metadata, created_at AS createdAt FROM operations ORDER BY event_date, created_at, rowid')
    .all().map((row) => ({ ...row, metadata: JSON.parse(row.metadata) }));
}

const lotOf = (state, id) => (state.lots || []).find((lot) => lot.id === id || lot.reference === id);

/**
 * As cartas de um lote somadas por tipo de movimento, e quem diz a impressão
 * e o teste dele — um lado só:
 *  - `byMoves`: os movimentos, se o lote tem algum de impressão ou de teste;
 *  - `byDays`: senão, os dias de produção em que está apontado (`days`, de
 *    `core.lotDays`): as cartas que saíram, as chumbadas e as aprovadas.
 */
function values(moves, days) {
  const sums = Object.fromEntries(CHAIN.map((type) => [type, 0]));
  for (const move of moves) if (sums[move.type] !== undefined) sums[move.type] += move.quantity;
  const byMoves = moves.some((move) => core.DAY_MOVES.includes(move.type));
  const byDays = Boolean(days) && !byMoves;
  if (byDays) Object.assign(sums, { printed: days.produced, qc_rejected: days.failed, qc_approved: days.approved });
  return { ...sums, byMoves, byDays };
}

/** O que cada fase ainda tem para fazer: as impressões rejeitadas e as reprovadas voltam à fila da impressão. */
function available(v, lot) {
  const effective = v.printed - v.print_rejected;
  // um lote apontado nos dias imprime-se sem esperar pelos movimentos de personalização: falta-lhe o que ainda não saiu bom
  const ready = v.byDays && !v.personalized ? lot.quantity : Math.min(v.personalized, lot.quantity);
  const left = ready - (effective - v.qc_rejected);
  return {
    toPersonalize: lot.quantity - v.personalized,
    toPrint: v.byDays ? Math.max(0, left) : left,
    toQC: effective - v.qc_approved - v.qc_rejected,
    toTransfer: v.qc_approved - v.transfer,
    toDispatch: v.transfer - v.dispatch,
  };
}

/** Os movimentos agrupados pelo lote a que pertencem. */
function grouped(moves) {
  const byLot = new Map();
  for (const move of moves) {
    if (!move.batchId) continue;
    if (!byLot.has(move.batchId)) byLot.set(move.batchId, []);
    byLot.get(move.batchId).push(move);
  }
  return byLot;
}

/**
 * As fases de um lote que os movimentos dizem: [fase, cartas, dia do último
 * movimento]. Um lote que já anda pelos movimentos segue-os em tudo — o
 * que ainda não tem movimento está por fazer —, com duas excepções:
 *  - a impressão e a qualidade de um lote apontado nos dias são as dos dias;
 *  - a personalização só é dos movimentos quando eles a registam (um lote
 *    apontado nos dias move-se e despacha-se sem a registar aqui).
 * As fases que não aparecem escrevem-se no lote, ou vêm dos dias.
 */
function driven(moves, days) {
  const v = values(moves, days);
  const last = (...types) => moves.reduce((date, move) => (types.includes(move.type) && move.date > date ? move.date : date), '');
  const moving = moves.some((move) => CHAIN.includes(move.type));
  return [
    ['personalizacao', v.personalized, last('personalized'), v.personalized > 0],
    // as reprovadas voltam à fila da impressão: deixam de contar como impressas
    ['impressao', v.printed - v.print_rejected - v.qc_rejected, last('printed', 'print_rejected'), moving && !v.byDays],
    ['qualidade', v.qc_approved, last('qc_approved', 'qc_rejected'), moving && !v.byDays],
    ['despacho', v.dispatch, last('dispatch'), moving],
  ].filter(([, , , told]) => told).map(([stage, cards, date]) => [stage, cards, date]);
}

/**
 * O estado tal como fica guardado: os dias e os lotes de acordo (a regra é
 * do core) e cada fase com movimentos a dizer o que eles dizem. Devolve o
 * mesmo estado quando já estava tudo certo.
 */
function settle(state) {
  const days = core.lotDays(state.records);
  const facts = new Map([...grouped(records())].map(([id, moves]) => [id, driven(moves, days.get(id))]));
  const base = core.settle(state, (id, stage) => (facts.get(id) || []).some(([name]) => name === stage));
  const lots = (base.lots || []).map((lot) => core.lotWithStages(lot, facts.get(lot.id) || []));
  return lots.some((lot, index) => lot !== base.lots[index]) ? { ...base, lots } : base;
}

/** Os erros de um lote que ainda estão por resolver. */
const openErrors = (moves) => moves.reduce((sum, move) => sum + (move.type === 'batch_error' ? move.quantity : move.type === 'batch_error_resolved' ? -move.quantity : 0), 0);

/** Guarda um movimento; um que já lá esteja, com o mesmo identificador, não entra outra vez. */
function store(move) {
  db.prepare('INSERT OR IGNORE INTO operations(id, type, batch_id, delegation, event_date, quantity, metadata, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
    .run(move.id, move.type, move.batchId || null, move.delegation || '', move.date, move.quantity, JSON.stringify(move.metadata), move.createdAt);
}

/**
 * Confere um movimento novo contra o que há disponível e guarda-o. Devolve o
 * identificador e o estado que fica: o lote com as fases que os movimentos
 * agora dizem, ou o artigo do armazém com a entrada ou a saída somada
 * (`lot` e `stock` trazem o que mudou, para o ecrã não ter de reler tudo).
 */
function insert(data, state) {
  if (!data || !TYPES.includes(data.type)) failure(422, 'Tipo de movimento desconhecido.');
  const type = data.type;
  const amount = qty(data.quantity);
  const eventDate = day(data.date);
  const all = records();
  const meta = {};
  let lot = null;
  let item = null;

  if (STOCK.includes(type)) {
    if (typeof data.reference !== 'string' || !data.reference.trim()) failure(422, 'Referência obrigatória.');
    // o material escolhe-se na lista do armazém: o saldo é o do artigo, e é nele que o movimento soma
    const found = (state.stock || []).find((entry) => entry.id === data.stockId);
    if (!found) failure(422, 'Escolhe o material na lista do armazém.');
    meta.reference = data.reference.trim();
    meta.stockId = found.id;
    meta.material = found.name;
    if (data.serialStart || data.serialEnd) {
      const first = String(data.serialStart || '');
      const last = String(data.serialEnd || '');
      if (!/^\d+$/.test(first) || !/^\d+$/.test(last)) failure(422, 'As séries devem ser numéricas.');
      if (BigInt(last) < BigInt(first) || BigInt(last) - BigInt(first) + 1n !== BigInt(amount)) failure(422, 'O intervalo não corresponde à quantidade.');
      meta.serialStart = first;
      meta.serialEnd = last;
    }
    const balance = found.received - found.issued;
    if (type === 'stock_out' && amount > balance) failure(422, `Stock insuficiente: ${balance}.`);
    if (meta.serialStart) {
      for (const move of all) {
        if (move.type !== type || move.metadata.stockId !== found.id || !move.metadata.serialStart) continue;
        if (BigInt(meta.serialStart) <= BigInt(move.metadata.serialEnd) && BigInt(move.metadata.serialStart) <= BigInt(meta.serialEnd)) {
          failure(422, 'Intervalo de séries repetido neste tipo de movimento.');
        }
      }
    }
    const later = (date) => (date > eventDate ? date : eventDate);
    try {
      item = core.makeStockItem({
        ...found,
        ...(type === 'stock_in' ? { received: found.received + amount, delivered: later(found.delivered || '') } : { issued: found.issued + amount }),
        updated: later(found.updated || ''),
      });
    } catch (error) {
      failure(422, error.message);
    }
  } else {
    lot = lotOf(state, data.batchId);
    if (!lot) failure(422, 'Escolhe um lote existente.');
    const previous = all.filter((move) => move.batchId === lot.id);
    // Um movimento com data anterior aos que já estão confirmados daria saldos impossíveis no histórico.
    if (previous.some((move) => move.date > eventDate)) failure(422, 'Registe os movimentos pela ordem das datas para preservar o histórico.');
    const v = values(previous, core.lotDays(state.records).get(lot.id));
    // a impressão e o teste de um lote apontado nos dias já estão ditos lá: aqui só se move e se despacha
    if (v.byDays && core.DAY_MOVES.includes(type)) {
      failure(422, `O lote ${lot.reference} está apontado nos dias de produção: a impressão e o teste de qualidade dele registam-se em Registos.`);
    }
    const a = available(v, lot);
    const limits = {
      personalized: a.toPersonalize, printed: a.toPrint, print_rejected: v.printed - v.print_rejected - v.qc_approved - v.qc_rejected,
      qc_approved: a.toQC, qc_rejected: a.toQC, transfer: a.toTransfer, dispatch: a.toDispatch,
    };
    if (type in limits && amount > limits[type]) failure(422, `Quantidade superior à disponível (${limits[type]}).`);
    if (type === 'printed') {
      if (!core.MACHINES.includes(data.machine)) failure(422, 'Indica a máquina.');
      meta.machine = data.machine;
    }
    if (type === 'qc_rejected') {
      if (!core.REASON_CODES.includes(data.reason)) failure(422, 'Escolhe um motivo INCAPE válido.');
      meta.reason = data.reason;
    }
    if (type === 'dispatch') {
      if (!data.reference || !String(data.reference).trim()) failure(422, 'Referência da guia obrigatória.');
      meta.reference = String(data.reference).trim();
    }
    if (type === 'batch_error') {
      if (!data.reason || !String(data.reason).trim()) failure(422, 'Indica o tipo de erro.');
      meta.reason = String(data.reason).slice(0, 100);
    }
    const unresolved = openErrors(previous);
    if (type === 'batch_error_resolved' && amount > unresolved) failure(422, `Apenas ${unresolved} erros por resolver.`);
    if (type === 'dispatch' && unresolved > 0) failure(422, 'Este lote possui erros por resolver.');
  }

  const id = crypto.randomUUID();
  store({ id, type, batchId: lot ? lot.id : null, delegation: lot ? lot.delegation : '', date: eventDate, quantity: amount, metadata: meta, createdAt: new Date().toISOString() });
  if (item) return { id, stock: item, state: { ...state, stock: state.stock.map((entry) => (entry.id === item.id ? item : entry)) } };
  const next = settle(state);
  const now = next.lots.find((entry) => entry.id === lot.id);
  return { id, state: next, ...(now === lot ? {} : { lot: now }) };
}

/**
 * Os números do período: produzidas, aprovadas e despachadas por delegação,
 * os saldos de cada lote e os movimentos. Cada delegação do catálogo tem a
 * sua linha, mesmo a zero; um nome escrito de outra maneira soma na delegação
 * a que pertence, e um que não se reconhece fica com linha própria, sem província.
 */
function dashboard(state, start, end) {
  const all = records();
  const within = (date) => (!start || date >= start) && (!end || date <= end);
  const filtered = all.filter((move) => within(move.date));
  const lots = new Map((state.lots || []).map((lot) => [lot.id, lot]));
  const byLot = grouped(all);
  const days = core.lotDays(state.records);
  /** Os números do lote: os dos movimentos, com a impressão e o teste lidos dos dias quando é lá que estão. */
  const valuesOf = (id) => values(byLot.get(id) || [], lots.has(id) ? days.get(id) : null);

  const rows = new Map();
  const rowOf = (name) => {
    const entry = catalogue.find(name);
    const key = entry ? entry.name : String(name).trim();
    if (!rows.has(key)) rows.set(key, { delegation: key, province: entry ? entry.province : '', produced: 0, approved: 0, dispatched: 0 });
    return rows.get(key);
  };
  for (const entry of catalogue.LIST) rowOf(entry.name);
  for (const lot of lots.values()) if (lot.delegation && lot.delegation.trim()) rowOf(lot.delegation);

  for (const move of filtered) {
    // a delegação que o lote tem hoje; a que ficou escrita no movimento só serve se o lote já não existir
    const name = (lots.get(move.batchId) || {}).delegation || move.delegation;
    if (!name || !name.trim()) continue;
    const row = rowOf(name);
    if (move.type === 'printed') row.produced += move.quantity;
    if (move.type === 'qc_approved') row.approved += move.quantity;
    if (move.type === 'dispatch') row.dispatched += move.quantity;
  }

  // Os dias de produção contam como produzidas. De um lote do quadro apontado nos dias, as boas das
  // entradas concluídas são as aprovadas dele; um lote escrito só no dia não está no quadro: não se move nem se despacha.
  for (const record of state.records || []) {
    if ((start && record.end < start) || (end && record.start > end)) continue;
    for (const entry of record.entries || []) {
      const name = (lots.get(entry.lotId) || {}).delegation || entry.delegation;
      if (!name || !name.trim()) continue;
      const row = rowOf(name);
      // se o lote já tem impressões registadas nesses dias, são elas que contam: a mesma carta não entra duas vezes
      const printed = (byLot.get(entry.lotId) || []).some((move) => move.type === 'printed' && move.date >= record.start && move.date <= record.end);
      if (!printed) row.produced += entry.produced || 0;
      if (entry.done && lots.has(entry.lotId) && valuesOf(entry.lotId).byDays) row.approved += Math.max(0, entry.produced - entry.qualityRejected);
    }
  }

  const batches = [...lots.values()].map((lot) => {
    const moves = byLot.get(lot.id) || [];
    const v = valuesOf(lot.id);
    return {
      id: lot.id, reference: lot.reference, delegation: lot.delegation, quantity: lot.quantity, ...v, ...available(v, lot),
      unresolvedErrors: openErrors(moves), driven: driven(moves, days.get(lot.id)).map(([stage]) => stage),
    };
  });
  // o resumo é a soma das linhas: o total que o ecrã mostra por baixo da lista, e nenhum outro
  const sum = (field) => [...rows.values()].reduce((total, row) => total + row[field], 0);
  return {
    delegations: [...rows.values()].sort((a, b) => b.produced - a.produced || Boolean(b.province) - Boolean(a.province) || a.delegation.localeCompare(b.delegation, 'pt')),
    batches,
    operations: filtered,
    summary: { produced: sum('produced'), approved: sum('approved'), dispatched: sum('dispatched') },
  };
}

module.exports = { TYPES, STOCK, store, insert, dashboard, settle };
