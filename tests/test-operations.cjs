/*
 * Testes do servidor e da base de dados: movimentos por quantidades, saldos,
 * delegações, exemplo, cópias e o próprio ficheiro SQLite. Correm com
 * `npm test`, cada vez numa base temporária: nada toca em `dados/`.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'backend', 'server.js');
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'inatro-ops-'));
const DB = path.join(TEMP, 'test.sqlite3');
process.env.CONTACARTA_DB = DB;
const server = require('../backend/server.js');
const catalogue = require('../app/lib/delegations.js');
const core = require('../app/lib/core.js');
const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'sample.json'), 'utf8'));

let base;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function request(route, method = 'GET', data, origin = base) {
  const response = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
  return { status: response.status, body: await response.json() };
}

/** Um lote como os do quadro, com as quatro fases por fazer. */
function lotOf(id, reference, delegation, quantity) {
  const lot = { id, reference, delegation, quantity, start: '2026-11-01', stages: {}, notes: '', closed: false };
  for (const stage of ['personalizacao', 'impressao', 'qualidade', 'despacho']) lot.stages[stage] = { stage, state: 'pendente', quantity: 0, updated: '', note: '' };
  return lot;
}

/** Um artigo do armazém, como os da lista: o que já entrou e o que já saiu. */
const itemOf = (id, name, received = 0) => ({ id, name, kind: 'outro', unit: 'un.', contracted: 0, received, issued: 0, minimum: 0, delivered: '', updated: '', notes: '' });

/** Um lote apontado num dia, e o dia com os seus lotes. */
const entryOf = (id, lotId, produced, more = {}) => ({ id, lotId, reference: 'escrito à mão', delegation: 'Tete', machine: 0, planned: 5, produced, rejected: 0, qualityRejected: 0, reasons: [], done: true, updated: '', notes: '', ...more });
const dayOf = (date, entries) => ({ id: `dia-${date}`, period: 'day', start: date, end: date, entries, closed: false, notes: '' });
/** Uma fase de um lote, só com o que os movimentos e os dias decidem: estado, cartas e data. */
const stageOf = (state, id, name) => {
  const stage = state.lots.find((lot) => lot.id === id).stages[name];
  return [stage.state, stage.quantity, stage.updated];
};

/** Grava um estado novo por cima do que lá está (com a revisão actual) e devolve a resposta. */
async function save(change, extra) {
  const current = (await request('/api/state')).body;
  return request('/api/state', 'PUT', { revision: current.revision, state: { ...current.state, ...change }, ...extra });
}

/** Base limpa: sem registos, lotes, material nem movimentos. */
async function reset() {
  assert.equal((await save({ records: [], lots: [], stock: [] }, { operations: [] })).status, 200);
}

const dashboard = async (query = '') => (await request(`/api/operations${query}`)).body;
const rowOf = (data, delegation) => data.delegations.find((row) => row.delegation === delegation);

test('conservação das quantidades e despacho parcial', async () => {
  assert.equal((await save({ lots: [lotOf('batch-1', 'LT-001', 'Matola', 100)] })).status, 200);
  const op = async (type, quantity, extra = {}) => request('/api/operations', 'POST', { type, quantity, date: '2026-11-10', batchId: 'batch-1', ...extra });
  assert.equal((await op('printed', 40, { machine: 'Máquina 1' })).status, 422);
  assert.equal((await op('personalized', 100)).status, 201);
  assert.equal((await op('printed', 40, { machine: 'Máquina 1' })).status, 201);
  assert.equal((await op('qc_approved', 30)).status, 201);
  assert.equal((await op('transfer', 30)).status, 201);
  assert.equal((await op('dispatch', 20, { reference: 'GUIA-01' })).status, 201);
  assert.equal((await op('dispatch', 11, { reference: 'GUIA-02' })).status, 422);
  let lot = (await dashboard()).batches[0];
  assert.equal(lot.toPrint, 60);
  assert.equal(lot.toQC, 10);
  assert.equal(lot.toDispatch, 10);
  assert.equal(lot.dispatch, 20);
  assert.equal((await op('qc_rejected', 10, { reason: 'material-riscos' })).status, 201);
  assert.equal((await op('printed', 70, { machine: 'Máquina 2' })).status, 201);
  lot = (await dashboard()).batches[0];
  assert.equal(lot.toPrint, 0);
  assert.equal(lot.toQC, 70);
  assert.equal((await op('qc_approved', 70)).status, 201);
  assert.equal((await op('transfer', 70)).status, 201);
  assert.equal((await op('dispatch', 80, { reference: 'GUIA-03' })).status, 201);
  lot = (await dashboard()).batches[0];
  assert.equal(lot.dispatch, 100);
  assert.equal(lot.toDispatch, 0);
  assert.equal((await op('dispatch', 1, { reference: 'GUIA-04' })).status, 422);
});

test('armazém: o movimento escolhe o artigo da lista, soma nele, e é o saldo dele que conta', async () => {
  await reset();
  assert.equal((await save({ stock: [itemOf('cartoes', 'Cartões em branco'), itemOf('fita', 'Fita', 4)] })).status, 200);
  const op = (type, quantity, extra = {}) => request('/api/operations', 'POST', { type, quantity, date: '2026-11-10', reference: 'REF001', stockId: 'cartoes', ...extra });
  const stored = async (id) => (await request('/api/state')).body.state.stock.find((item) => item.id === id);

  // o material é um artigo da lista: um nome escrito à mão, ou um artigo que não existe, não serve
  for (const loose of [{ stockId: undefined, material: 'Cartões em branco' }, { stockId: 'nenhum' }]) {
    const answer = await op('stock_in', 5, loose);
    assert.equal(answer.status, 422);
    assert.equal(answer.body.error, 'Escolhe o material na lista do armazém.');
  }
  assert.equal((await op('stock_out', 5)).body.error, 'Stock insuficiente: 0.');

  const revision = (await request('/api/state')).body.revision;
  const entered = await op('stock_in', 10, { serialStart: '0001', serialEnd: '0010' });
  assert.equal(entered.status, 201);
  assert.equal(entered.body.revision, revision + 1, 'o movimento e o artigo gravam-se juntos, numa revisão nova');
  assert.deepEqual([entered.body.stock.id, entered.body.stock.received, entered.body.stock.issued, entered.body.stock.delivered, entered.body.stock.updated],
    ['cartoes', 10, 0, '2026-11-10', '2026-11-10'], 'a entrada soma ao recebido e fica como a última entrega');
  assert.deepEqual(await stored('cartoes'), entered.body.stock, 'o que o servidor responde é o que ficou guardado');
  assert.equal(entered.body.lot, undefined);

  assert.equal((await op('stock_in', 5, { serialStart: '0008', serialEnd: '0012' })).body.error, 'Intervalo de séries repetido neste tipo de movimento.');
  assert.equal((await stored('cartoes')).received, 10, 'um movimento recusado não soma nada');
  assert.equal((await request('/api/state')).body.revision, revision + 1);

  const left = await op('stock_out', 5, { serialStart: '0001', serialEnd: '0005', date: '2026-11-12' });
  assert.equal(left.status, 201);
  assert.deepEqual([left.body.stock.received, left.body.stock.issued, left.body.stock.delivered, left.body.stock.updated], [10, 5, '2026-11-10', '2026-11-12'],
    'a saída soma ao que saiu; a data da entrega é a da última entrada');
  assert.equal((await op('stock_out', 6)).body.error, 'Stock insuficiente: 5.');
  // um movimento mais antigo não puxa as datas do artigo para trás
  assert.equal((await op('stock_in', 2, { date: '2026-11-01' })).body.stock.delivered, '2026-11-10');

  // o saldo é o do artigo — o que lá foi escrito à mão também conta —, e cada artigo tem o seu
  assert.equal((await op('stock_out', 4, { stockId: 'fita' })).status, 201);
  assert.equal((await op('stock_out', 1, { stockId: 'fita' })).body.error, 'Stock insuficiente: 0.');
  assert.equal((await op('stock_in', 10, { stockId: 'fita', serialStart: '0001', serialEnd: '0010' })).status, 201, 'as mesmas séries noutro artigo não são repetição');
  const moves = (await dashboard()).operations;
  assert.deepEqual(moves.map((move) => [move.type, move.metadata.stockId, move.metadata.material]), [
    ['stock_in', 'cartoes', 'Cartões em branco'], ['stock_in', 'cartoes', 'Cartões em branco'], ['stock_out', 'fita', 'Fita'], ['stock_in', 'fita', 'Fita'], ['stock_out', 'cartoes', 'Cartões em branco'],
  ], 'cada movimento guarda o artigo a que pertence, pela ordem das datas');
  assert.deepEqual([(await stored('cartoes')).received, (await stored('cartoes')).issued, (await stored('fita')).received, (await stored('fita')).issued], [12, 5, 14, 4]);
});

test('um lado só: os dias dizem do lote o que o lote diz, e as fases dizem o que os dias e os movimentos dizem', async () => {
  await reset();
  const entries = (state) => state.records.flatMap((record) => record.entries).sort((a, b) => a.id.localeCompare(b.id)).map((entry) => [entry.id, entry.reference, entry.delegation, entry.planned]);

  // 1 · um dia aponta um lote do quadro: a entrada fica com a referência e a delegação do lote, e planeia o que o lote ainda tinha por fazer
  const first = await save({
    lots: [lotOf('um', 'LT-UM', 'Beira', 1000), lotOf('dois', 'LT-DOIS', 'Pemba', 300)],
    records: [dayOf('2026-11-03', [entryOf('e1', 'um', 600, { qualityRejected: 50, done: false })]), dayOf('2026-11-04', [entryOf('e2', 'um', 400), entryOf('e3', '', 70)])],
  });
  assert.equal(first.status, 200);
  let current = (await request('/api/state')).body;
  assert.deepEqual(first.body, { revision: current.revision, state: current.state }, 'o que ficou guardado não é o que veio: quem gravou recebe-o de volta');
  assert.deepEqual(entries(current.state), [['e1', 'LT-UM', 'Beira', 1000], ['e2', 'LT-UM', 'Beira', 450], ['e3', 'escrito à mão', 'Tete', 5]],
    'o lote que não é do quadro fica como foi escrito');
  // a impressão são as cartas boas dos dias; a qualidade, as das entradas concluídas
  assert.deepEqual(stageOf(current.state, 'um', 'impressao'), ['em-curso', 950, '2026-11-04']);
  assert.deepEqual(stageOf(current.state, 'um', 'qualidade'), ['em-curso', 400, '2026-11-04']);
  assert.equal(stageOf(current.state, 'um', 'personalizacao')[0], 'pendente', 'os dias não sabem nada das outras fases');
  assert.equal(stageOf(current.state, 'dois', 'impressao')[0], 'pendente');

  // 2 · gravar o que já está de acordo não muda nada, e a resposta é só a revisão
  const again = await save({});
  assert.deepEqual(again.body, { revision: current.revision + 1 });

  // 3 · corrigir o lote corrige os dias em que foi apontado
  current = (await request('/api/state')).body;
  const fixed = await save({ lots: current.state.lots.map((lot) => (lot.id === 'um' ? { ...lot, reference: 'LT-UM-B', delegation: 'Nampula', quantity: 1200 } : lot)) });
  assert.deepEqual(entries(fixed.body.state), [['e1', 'LT-UM-B', 'Nampula', 1200], ['e2', 'LT-UM-B', 'Nampula', 650], ['e3', 'escrito à mão', 'Tete', 5]]);
  assert.deepEqual(rowOf(await dashboard(), 'Nampula').produced, 1000, 'e a produção desses dias passa para a delegação nova');
  assert.deepEqual(rowOf(await dashboard(), 'Beira').produced, 0);

  // 4 · a impressão e o teste de um lote apontado nos dias já estão ditos lá: os movimentos lêem-nos, não os pedem outra vez
  const op = (batchId, type, quantity, extra = {}) => request('/api/operations', 'POST', { type, quantity, date: '2026-11-10', batchId, ...extra });
  const balance = async (id) => { const lot = (await dashboard()).batches.find((item) => item.id === id); return [lot.byDays, lot.toPrint, lot.toQC, lot.toTransfer, lot.toDispatch, lot.dispatch]; };
  assert.deepEqual(await balance('um'), [true, 250, 550, 400, 0, 0], 'faltam 250 boas ao lote, 550 esperam a conclusão do dia e 400 aprovadas estão prontas para mover — sem movimento nenhum');
  assert.deepEqual(await balance('dois'), [false, 0, 0, 0, 0, 0], 'o lote que nenhum dia aponta espera pelos seus movimentos');
  for (const [type, extra] of [['printed', { machine: 'Máquina 1' }], ['print_rejected'], ['qc_approved'], ['qc_rejected', { reason: 'material-riscos' }]]) {
    const twice = await op('um', type, 10, extra);
    assert.deepEqual([twice.status, twice.body.error], [422, 'O lote LT-UM-B está apontado nos dias de produção: a impressão e o teste de qualidade dele registam-se em Registos.'], type);
  }
  // a personalização, que os dias não dizem, regista-se aqui; e o movimento grava-se junto com a fase do lote
  let revision = (await request('/api/state')).body.revision;
  const personalised = await op('um', 'personalized', 1200);
  assert.equal(personalised.status, 201);
  assert.equal(personalised.body.revision, revision + 1, 'o movimento e a fase do lote gravam-se juntos');
  assert.deepEqual(stageOf({ lots: [personalised.body.lot] }, 'um', 'personalizacao'), ['feito', 1200, '2026-11-10']);
  assert.deepEqual(stageOf({ lots: [personalised.body.lot] }, 'um', 'impressao'), ['em-curso', 950, '2026-11-04'], 'a impressão continua a ser a dos dias');
  current = (await request('/api/state')).body;
  assert.deepEqual(current.state.lots.find((lot) => lot.id === 'um'), personalised.body.lot, 'o lote que o servidor responde é o que ficou guardado');

  // as aprovadas nos dias movem-se e despacham-se, até onde os dias chegam
  assert.equal((await op('um', 'transfer', 401)).body.error, 'Quantidade superior à disponível (400).');
  revision = (await request('/api/state')).body.revision;
  const moved = await op('um', 'transfer', 400);
  assert.deepEqual([moved.status, moved.body.revision, moved.body.lot], [201, revision, undefined], 'mover para despacho não mexe em fase nenhuma do quadro: o estado fica como estava');
  const sentPart = await op('um', 'dispatch', 150, { reference: 'GUIA-1', date: '2026-11-11' });
  assert.deepEqual(stageOf({ lots: [sentPart.body.lot] }, 'um', 'despacho'), ['em-curso', 150, '2026-11-11']);
  assert.deepEqual(await balance('um'), [true, 250, 550, 0, 250, 150]);
  assert.deepEqual((await dashboard()).batches.map((lot) => [lot.id, lot.driven, lot.byMoves]), [['um', ['personalizacao', 'despacho'], false], ['dois', [], false]]);
  const nampula = rowOf(await dashboard(), 'Nampula');
  assert.deepEqual([nampula.produced, nampula.approved, nampula.dispatched], [1000, 400, 150], 'e a lista por delegação diz o mesmo que o lote: produzidas e aprovadas dos dias, despachadas dos movimentos');
  assert.deepEqual((await dashboard('?start=2026-11-03&end=2026-11-03')).summary, { produced: 600, approved: 0, dispatched: 0 }, 'no dia 3 saíram 600 cartas e a entrada ficou por concluir');
  assert.deepEqual((await dashboard('?start=2026-11-04&end=2026-11-04')).summary, { produced: 470, approved: 400, dispatched: 0 }, 'no dia 4, as 400 do lote ficaram aprovadas; o lote escrito só no dia conta as produzidas');

  // os dias não ficam com menos aprovadas do que as que já foram movidas; subir, ou mexer noutra coisa, nunca é travado
  current = (await request('/api/state')).body;
  const withEntry = (id, change) => save({ records: current.state.records.map((record) => ({ ...record, entries: record.entries.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)) })) });
  const less = await withEntry('e2', { done: false });
  assert.deepEqual([less.status, less.body.error], [422, 'O lote LT-UM-B já tem 400 cartas movidas para despacho: os dias de produção não podem ficar com menos aprovadas.']);
  assert.equal((await request('/api/state')).body.revision, current.revision, 'a gravação recusada não deixou nada para trás');
  assert.equal((await withEntry('e2', { produced: 399 })).status, 422);
  assert.equal((await withEntry('e3', { produced: 71 })).status, 200);
  current = (await request('/api/state')).body;
  assert.equal((await withEntry('e1', { done: true })).status, 200, 'concluir a outra entrada sobe as aprovadas');
  assert.deepEqual(await balance('um'), [true, 250, 0, 550, 250, 150]);

  // um lote só com a personalização nos movimentos: a impressão e a qualidade estão por fazer até um dia o apontar, e aí passam a ser as do dia
  current = (await request('/api/state')).body;
  assert.equal((await save({ lots: [...current.state.lots, lotOf('tres', 'LT-TRES', 'Tete', 80)] })).status, 200);
  assert.equal((await op('tres', 'personalized', 80)).status, 201);
  assert.deepEqual((await dashboard()).batches.find((lot) => lot.id === 'tres').driven, core.LOT_STAGES);
  current = (await request('/api/state')).body;
  const pointed = await save({ records: [...current.state.records, dayOf('2026-11-11', [entryOf('e7', 'tres', 80)])] });
  assert.deepEqual(['impressao', 'qualidade'].map((name) => stageOf(pointed.body.state, 'tres', name)), [['feito', 80, '2026-11-11'], ['feito', 80, '2026-11-11']]);
  let three = (await dashboard()).batches.find((lot) => lot.id === 'tres');
  assert.deepEqual([three.driven, three.byDays, three.toPrint, three.toQC, three.toTransfer], [['personalizacao', 'despacho'], true, 0, 0, 80]);
  // … e se o dia deixar de o apontar, volta ao que os movimentos dizem: por fazer
  current = (await request('/api/state')).body;
  const unpointed = await save({ records: current.state.records.filter((record) => record.start !== '2026-11-11') });
  assert.deepEqual(['impressao', 'qualidade'].map((name) => stageOf(unpointed.body.state, 'tres', name)[0]), ['pendente', 'pendente']);
  three = (await dashboard()).batches.find((lot) => lot.id === 'tres');
  assert.deepEqual([three.driven, three.byDays, three.toPrint, three.toTransfer], [core.LOT_STAGES, false, 80, 0]);

  // um lote apontado nos dias que só se move e despacha: a personalização, que os movimentos não registaram, continua a ser a que se marcou no lote
  current = (await request('/api/state')).body;
  const marked = core.makeLot({ id: 'quatro', reference: 'LT-QUATRO', delegation: 'Pemba', quantity: 60, start: '2026-11-01', stages: { personalizacao: { state: 'feito', updated: '2026-11-02' } } });
  assert.equal((await save({ lots: [...current.state.lots, marked], records: [...current.state.records, dayOf('2026-11-08', [entryOf('e8', 'quatro', 60)])] })).status, 200);
  const sentOn = await op('quatro', 'transfer', 60);
  assert.equal(sentOn.status, 201);
  const afterMove = (await request('/api/state')).body.state;
  assert.deepEqual(core.LOT_STAGES.map((name) => stageOf(afterMove, 'quatro', name)[0]), ['feito', 'feito', 'feito', 'pendente']);
  assert.deepEqual((await dashboard()).batches.find((lot) => lot.id === 'quatro').driven, ['despacho']);

  // uma cópia entra como está, mesmo que as contas dela não fechem (mais cartas movidas do que os dias aprovaram):
  // esse lote não trava as gravações seguintes — só não pode ficar com ainda menos aprovadas
  current = (await request('/api/state')).body;
  const moves = (await dashboard()).operations;
  const fewer = current.state.records.map((record) => ({ ...record, entries: record.entries.map((entry) => (entry.id === 'e8' ? { ...entry, produced: 40 } : entry)) }));
  assert.equal((await save({ records: fewer }, { operations: moves })).status, 200);
  assert.deepEqual(await balance('quatro'), [true, 20, 0, -20, 60, 0]);
  current = (await request('/api/state')).body;
  assert.equal((await withEntry('e3', { produced: 72 })).status, 200, 'gravar outra coisa continua a funcionar');
  current = (await request('/api/state')).body;
  assert.equal((await withEntry('e8', { produced: 39 })).status, 422);
  assert.equal((await withEntry('e8', { produced: 60 })).status, 200, 'e corrige-se nos dias, pondo o que realmente saiu');
  assert.deepEqual(await balance('quatro'), [true, 0, 0, 0, 60, 0]);

  // 5 · o ecrã não consegue dizer outra coisa de uma fase que os movimentos ou os dias dizem
  current = (await request('/api/state')).body;
  const lie = { state: 'feito', quantity: 1200, updated: '2026-12-25' };
  const forced = await save({ lots: current.state.lots.map((lot) => (lot.id === 'um' ? { ...lot, stages: { ...lot.stages, personalizacao: { ...lot.stages.personalizacao, state: 'pendente', updated: '' }, impressao: { ...lot.stages.impressao, ...lie }, despacho: { ...lot.stages.despacho, ...lie } } } : lot)) });
  assert.equal(forced.status, 200);
  assert.deepEqual(['personalizacao', 'impressao', 'despacho'].map((name) => stageOf(forced.body.state, 'um', name)), [['feito', 1200, '2026-11-10'], ['em-curso', 950, '2026-11-04'], ['em-curso', 150, '2026-11-11']]);

  // 6 · um movimento que não mexe em fase nenhuma (um erro de lote) guarda-se sem tocar no estado
  revision = (await request('/api/state')).body.revision;
  const mistake = await op('um', 'batch_error', 3, { reason: 'documentacao', date: '2026-11-12' });
  assert.deepEqual([mistake.status, mistake.body.revision, mistake.body.lot, mistake.body.stock], [201, revision, undefined, undefined]);

  // 7 · o lote que nenhum dia aponta faz o caminho todo pelos movimentos. Assim que tem o primeiro, segue-os em tudo:
  //     o que ainda não tem movimento está por fazer, mesmo que alguém o tivesse marcado à mão no lote
  current = (await request('/api/state')).body;
  const byHand = { state: 'feito', quantity: 300, updated: '2026-11-01' };
  assert.equal((await save({ lots: current.state.lots.map((lot) => (lot.id === 'dois' ? { ...lot, stages: { ...lot.stages, impressao: { ...lot.stages.impressao, ...byHand }, despacho: { ...lot.stages.despacho, ...byHand } } } : lot)) })).status, 200);
  assert.deepEqual(stageOf((await request('/api/state')).body.state, 'dois', 'impressao'), ['feito', 300, '2026-11-01'], 'sem movimentos nem dias, vale o que se marca no lote');
  const begun = await op('dois', 'personalized', 300);
  assert.deepEqual(core.LOT_STAGES.map((name) => stageOf({ lots: [begun.body.lot] }, 'dois', name)[0]), ['feito', 'pendente', 'pendente', 'pendente']);
  assert.equal(begun.body.lot.closed, false, 'e o lote deixa de estar fechado: os movimentos ainda não despacharam nada');
  let row = (await dashboard()).batches.find((lot) => lot.id === 'dois');
  assert.deepEqual([row.driven, row.byMoves, row.byDays], [core.LOT_STAGES, false, false], 'ainda sem impressão nos movimentos: pode apontar-se num dia');
  assert.equal((await op('dois', 'printed', 300, { machine: 'Máquina 2' })).status, 201);
  row = (await dashboard()).batches.find((lot) => lot.id === 'dois');
  assert.deepEqual([row.driven, row.byMoves, row.byDays], [core.LOT_STAGES, true, false], 'com a impressão nos movimentos, já não se aponta nos dias');
  assert.deepEqual(stageOf({ lots: [(await op('dois', 'qc_rejected', 20, { reason: 'material-riscos' })).body.lot] }, 'dois', 'impressao'), ['em-curso', 280, '2026-11-10']);
  assert.equal((await op('dois', 'printed', 20, { machine: 'Máquina 1' })).status, 201);
  for (const type of ['qc_approved', 'transfer']) assert.equal((await op('dois', type, 300)).status, 201);
  const sent = await op('dois', 'dispatch', 300, { reference: 'GUIA-9', date: '2026-11-12' });
  assert.deepEqual(core.LOT_STAGES.map((name) => stageOf({ lots: [sent.body.lot] }, 'dois', name)),
    [['feito', 300, '2026-11-10'], ['feito', 300, '2026-11-10'], ['feito', 300, '2026-11-10'], ['feito', 300, '2026-11-12']]);
  assert.equal(sent.body.lot.closed, true);

  // 8 · um lote que já tem a impressão nos movimentos e depois aparece apontado num dia (uma base antiga, uma cópia):
  //     mandam os movimentos, e o dia fica como registo da produção
  current = (await request('/api/state')).body;
  assert.equal((await save({ records: [...current.state.records, dayOf('2026-11-12', [entryOf('e9', 'dois', 120)])] })).status, 200);
  assert.deepEqual(await balance('dois'), [false, 0, 0, 0, 0, 300]);
  assert.deepEqual(stageOf((await request('/api/state')).body.state, 'dois', 'impressao'), ['feito', 300, '2026-11-10']);
  assert.deepEqual((await dashboard()).batches.find((lot) => lot.id === 'dois').driven, core.LOT_STAGES);
  assert.equal((await op('dois', 'batch_error', 1, { reason: 'documentacao', date: '2026-11-13' })).status, 201, 'e continua a aceitar os seus movimentos');
});

test('movimentos fora de ordem, erros de lote e pedidos mal feitos são recusados com uma frase', async () => {
  await reset();
  assert.equal((await save({ lots: [lotOf('lote-a', 'LT-A', 'Beira', 50)] })).status, 200);
  const op = (data) => request('/api/operations', 'POST', { batchId: 'lote-a', date: '2026-11-10', ...data });
  assert.equal((await op({ type: 'personalized', quantity: 50 })).status, 201);
  const early = await op({ type: 'printed', quantity: 10, machine: 'Máquina 1', date: '2026-11-09' });
  assert.deepEqual([early.status, early.body.error], [422, 'Registe os movimentos pela ordem das datas para preservar o histórico.']);
  assert.equal((await op({ type: 'printed', quantity: 50 })).body.error, 'Indica a máquina.');
  assert.equal((await op({ type: 'printed', quantity: 50, machine: 'Máquina 2' })).status, 201);
  assert.equal((await op({ type: 'qc_rejected', quantity: 5, reason: 'porque sim' })).body.error, 'Escolhe um motivo INCAPE válido.');
  assert.equal((await op({ type: 'qc_approved', quantity: 50 })).status, 201);
  assert.equal((await op({ type: 'transfer', quantity: 50 })).status, 201);
  assert.equal((await op({ type: 'batch_error', quantity: 3, reason: 'documentacao' })).status, 201);
  assert.equal((await op({ type: 'dispatch', quantity: 10 })).body.error, 'Referência da guia obrigatória.');
  assert.equal((await op({ type: 'dispatch', quantity: 10, reference: 'G-1' })).body.error, 'Este lote possui erros por resolver.');
  assert.equal((await op({ type: 'batch_error_resolved', quantity: 4 })).body.error, 'Apenas 3 erros por resolver.');
  assert.equal((await op({ type: 'batch_error_resolved', quantity: 3 })).status, 201);
  assert.equal((await op({ type: 'dispatch', quantity: 10, reference: 'G-1' })).status, 201);
  for (const bad of [{ type: 'voar', quantity: 1 }, { type: 'printed', quantity: 0, machine: 'Máquina 1' }, { type: 'printed', quantity: 1.5, machine: 'Máquina 1' },
    { type: 'printed', quantity: 1, machine: 'Máquina 1', date: '2026-02-30' }, { type: 'printed', quantity: 1, machine: 'Máquina 1', batchId: 'não existe' }]) {
    const answer = await op(bad);
    assert.equal(answer.status, 422, JSON.stringify(bad));
    assert.ok(answer.body.error.length > 10, 'a recusa diz o que corrigir');
  }
  assert.equal((await dashboard()).operations.length, 7, 'os pedidos recusados não deixaram nada na base');
});

test('delegações: uma por província, e o servidor usa o catálogo do ecrã', async () => {
  const list = (await request('/api/delegations')).body;
  assert.equal(list.length, 11);
  assert.deepEqual(list.map((entry) => [entry.code, entry.name, entry.province]), catalogue.LIST.map((entry) => [entry.code, entry.name, entry.province]));
  assert.equal(new Set(list.map((entry) => entry.province)).size, 11, 'uma delegação por província');
  assert.deepEqual(list.filter((entry) => entry.province.startsWith('Maputo')).map((entry) => entry.name), ['Maputo Cidade', 'Matola'], 'em Maputo: a cidade e a Matola');
});

test('produção por delegação: as onze linhas, nomes antigos somados e nomes desconhecidos à parte', async () => {
  await reset();
  let data = await dashboard();
  assert.deepEqual(data.delegations.map((row) => row.delegation).sort(), catalogue.LIST.map((entry) => entry.name), 'as onze delegações aparecem sempre, mesmo a zero');
  assert.ok(data.delegations.every((row) => row.province && row.produced === 0 && row.approved === 0 && row.dispatched === 0));

  const entry = (id, delegation, produced, lotId = '') => ({ id, lotId, reference: '', delegation, machine: 0, planned: produced, produced, rejected: 0, qualityRejected: 0, reasons: [], done: true, updated: '', notes: '' });
  const day = (date, entries) => ({ id: `dia-${date}`, period: 'day', start: date, end: date, entries, closed: false, notes: '' });
  assert.equal((await save({
    lots: [lotOf('l-nacala', 'LT-N', 'Nacala', 500), lotOf('l-beira', 'LT-B', 'Delegação da Beira', 400), lotOf('l-fora', 'LT-F', 'Lisboa', 300), lotOf('l-tete', 'LT-T', 'Tete', 200)],
    records: [
      day('2026-10-05', [entry('e1', 'Nampula', 100), entry('e2', 'Boane', 40), entry('e3', '', 999)]),
      day('2026-11-03', [entry('e4', 'Delegação de Maputo', 60), entry('e6', 'Lisboa', 5)]),
    ],
  })).status, 200);
  const op = (batchId, type, quantity, date, extra = {}) => request('/api/operations', 'POST', { batchId, type, quantity, date, ...extra });
  for (const [batchId, quantity] of [['l-nacala', 500], ['l-beira', 400], ['l-fora', 300], ['l-tete', 200]]) {
    assert.equal((await op(batchId, 'personalized', quantity, '2026-11-01')).status, 201);
  }
  assert.equal((await op('l-nacala', 'printed', 300, '2026-11-02', { machine: 'Máquina 1' })).status, 201);
  assert.equal((await op('l-nacala', 'qc_approved', 250, '2026-11-04')).status, 201);
  assert.equal((await op('l-beira', 'printed', 150, '2026-11-02', { machine: 'Máquina 2' })).status, 201);
  assert.equal((await op('l-fora', 'printed', 80, '2026-11-02', { machine: 'Máquina 2' })).status, 201);
  assert.equal((await op('l-tete', 'printed', 90, '2026-11-03', { machine: 'Máquina 1' })).status, 201);
  // uma base antiga pode trazer o mesmo lote com a impressão nos movimentos e também apontado no dia
  const early = (await request('/api/state')).body.state;
  assert.equal((await save({ records: early.records.map((record) => (record.start === '2026-11-03' ? { ...record, entries: [...record.entries, entry('e5', '', 70, 'l-tete')] } : record)) })).status, 200);

  data = await dashboard();
  assert.equal(data.delegations.length, 12, 'as onze do catálogo e a linha do nome que não se reconhece');
  assert.deepEqual(rowOf(data, 'Nampula'), { delegation: 'Nampula', province: 'Nampula', produced: 400, approved: 250, dispatched: 0 }, '«Nacala» soma em Nampula, com o registo do dia');
  assert.equal(rowOf(data, 'Beira').produced, 150, '«Delegação da Beira» é a Beira');
  assert.equal(rowOf(data, 'Matola').produced, 40, '«Boane» conta para a Matola');
  assert.equal(rowOf(data, 'Maputo Cidade').produced, 60, '«Delegação de Maputo» é a cidade');
  assert.equal(rowOf(data, 'Tete').produced, 90, 'o lote do dia já tem a impressão registada nesse dia: a mesma carta não conta duas vezes');
  assert.deepEqual(rowOf(data, 'Lisboa'), { delegation: 'Lisboa', province: '', produced: 85, approved: 0, dispatched: 0 }, 'um nome desconhecido fica à parte, sem província');
  assert.equal(rowOf(data, 'Nacala'), undefined, 'o nome antigo não ganha linha própria');
  assert.deepEqual(data.delegations.slice(0, 3).map((row) => row.delegation), ['Nampula', 'Beira', 'Tete'], 'pela ordem do que produziram');
  assert.equal(data.batches.find((lot) => lot.id === 'l-nacala').delegation, 'Nacala', 'o saldo do lote mostra a delegação tal como está escrita no lote');
  const totals = (rows) => ({ produced: rows.reduce((sum, row) => sum + row.produced, 0), approved: rows.reduce((sum, row) => sum + row.approved, 0), dispatched: rows.reduce((sum, row) => sum + row.dispatched, 0) });
  assert.deepEqual(data.summary, { produced: 825, approved: 250, dispatched: 0 }, 'o resumo conta o mesmo que as linhas, com os registos do dia');
  assert.deepEqual(data.summary, totals(data.delegations));

  // o período filtra os movimentos e os registos
  data = await dashboard('?start=2026-11-03&end=2026-11-30');
  assert.deepEqual([rowOf(data, 'Nampula').produced, rowOf(data, 'Nampula').approved, rowOf(data, 'Tete').produced, rowOf(data, 'Maputo Cidade').produced], [0, 250, 90, 60]);
  assert.deepEqual(data.summary, totals(data.delegations), 'e o resumo acompanha o período');
  assert.equal(data.summary.produced, 155);

  // mudar a delegação de um lote leva os seus números para a delegação nova
  const current = (await request('/api/state')).body.state;
  assert.equal((await save({ lots: current.lots.map((lot) => (lot.id === 'l-fora' ? { ...lot, delegation: 'Pemba' } : lot)) })).status, 200);
  data = await dashboard();
  assert.equal(rowOf(data, 'Pemba').produced, 80);
  assert.equal(rowOf(data, 'Lisboa').produced, 5, 'fica só o registo do dia escrito com esse nome');
});

test('um lote ou um artigo apagado leva os seus movimentos; os dos outros ficam', async () => {
  await reset();
  assert.equal((await save({ lots: [lotOf('fica', 'LT-1', 'Beira', 10), lotOf('sai', 'LT-2', 'Tete', 10)], stock: [itemOf('papel', 'Papel'), itemOf('tinta', 'Tinta')],
    records: [dayOf('2026-11-09', [entryOf('e1', 'sai', 4), entryOf('e2', 'fica', 3)])] })).status, 200);
  for (const batchId of ['fica', 'sai']) {
    assert.equal((await request('/api/operations', 'POST', { batchId, type: 'personalized', quantity: 10, date: '2026-11-10' })).status, 201);
  }
  for (const stockId of ['papel', 'tinta']) {
    assert.equal((await request('/api/operations', 'POST', { type: 'stock_in', quantity: 7, date: '2026-11-10', reference: 'GR-1', stockId })).status, 201);
  }
  assert.equal((await dashboard()).operations.length, 4);
  const named = (data) => data.operations.map((move) => move.batchId || move.metadata.material).sort();

  let current = (await request('/api/state')).body.state;
  assert.equal((await save({ lots: current.lots.filter((lot) => lot.id !== 'sai') })).status, 200);
  let data = await dashboard();
  assert.deepEqual(named(data), ['Papel', 'Tinta', 'fica']);
  assert.equal(rowOf(data, 'Tete').approved + rowOf(data, 'Tete').dispatched, 0, 'sem movimentos de lotes que já não existem');
  // o dia em que o lote apagado foi apontado continua a contar a produção, já sem ligação a lote nenhum
  current = (await request('/api/state')).body.state;
  assert.deepEqual(current.records[0].entries.map((entry) => [entry.id, entry.lotId, entry.reference, entry.delegation, entry.produced]),
    [['e1', '', 'LT-2', 'Tete', 4], ['e2', 'fica', 'LT-1', 'Beira', 3]]);
  assert.equal(rowOf(data, 'Tete').produced, 4);

  // o artigo do armazém: sai, e as entradas e saídas que somaram nele saem com ele
  assert.equal((await save({ stock: current.stock.filter((item) => item.id !== 'tinta') })).status, 200);
  data = await dashboard();
  assert.deepEqual(named(data), ['Papel', 'fica']);
  // um movimento antigo do armazém, de quando o material se escrevia à mão, não é de artigo nenhum: fica no histórico
  const old = { id: 'antigo-1', type: 'stock_in', batchId: null, date: '2026-01-05', quantity: 9, metadata: { reference: 'GR-0', material: 'Fita' } };
  current = (await request('/api/state')).body.state;
  assert.equal((await save(current, { operations: [...data.operations, old] })).status, 200);
  assert.equal((await save({ stock: [] })).status, 200);
  assert.deepEqual(named(await dashboard()), ['Fita', 'fica']);
});

test('um lote não encolhe para menos do que já tem personalizado; o resto grava-se como sempre', async () => {
  await reset();
  assert.equal((await save({ lots: [lotOf('a', 'LT-A', 'Beira', 500), lotOf('b', 'LT-B', 'Tete', 300)] })).status, 200);
  assert.equal((await request('/api/operations', 'POST', { batchId: 'a', type: 'personalized', quantity: 200, date: '2026-11-10' })).status, 201);
  assert.equal((await request('/api/operations', 'POST', { batchId: 'a', type: 'personalized', quantity: 150, date: '2026-11-11' })).status, 201);
  const withQuantity = async (id, quantity, more = {}) => {
    const current = (await request('/api/state')).body.state;
    return save({ lots: current.lots.map((lot) => (lot.id === id ? { ...lot, quantity, ...more } : lot)) });
  };

  const before = (await request('/api/state')).body;
  const refused = await withQuantity('a', 349);
  assert.equal(refused.status, 422);
  assert.equal(refused.body.error, 'O lote LT-A já tem 350 cartas personalizadas: a quantidade não pode ser inferior.');
  const after = (await request('/api/state')).body;
  assert.equal(after.revision, before.revision, 'a gravação recusada não deixou nada para trás');
  assert.equal(after.state.lots.find((lot) => lot.id === 'a').quantity, 500);

  assert.equal((await withQuantity('a', 350)).status, 200, 'até ao que já está personalizado pode baixar');
  let lot = (await dashboard()).batches.find((entry) => entry.id === 'a');
  assert.deepEqual([lot.quantity, lot.toPersonalize, lot.toPrint], [350, 0, 350]);
  assert.equal((await withQuantity('a', 900, { delegation: 'Pemba' })).status, 200, 'subir, ou mudar outra coisa, nunca é travado');
  assert.equal((await withQuantity('b', 1)).status, 200, 'um lote sem movimentos baixa à vontade');

  // uma cópia traz os lotes e os movimentos como estavam: entra mesmo que as contas dela não fechem,
  // e esse lote não trava as gravações seguintes — só não pode encolher ainda mais
  const copy = (await request('/api/state')).body.state;
  const moves = (await dashboard()).operations;
  assert.equal((await save({ lots: copy.lots.map((entry) => (entry.id === 'a' ? { ...entry, quantity: 100 } : entry)) }, { operations: moves })).status, 200);
  lot = (await dashboard()).batches.find((entry) => entry.id === 'a');
  assert.deepEqual([lot.quantity, lot.personalized], [100, 350]);
  assert.equal((await save({ stock: [] })).status, 200, 'gravar outra coisa continua a funcionar');
  assert.equal((await withQuantity('b', 2)).status, 200);
  assert.equal((await withQuantity('a', 99)).status, 422);
  assert.equal((await withQuantity('a', 400)).status, 200, 'e corrige-se subindo a quantidade');
});

test('os movimentos do exemplo entram e saem com os lotes do exemplo, inteiros', async () => {
  await reset();
  assert.equal((await save({ lots: [lotOf('meu', 'LT-MEU', 'Beira', 10)], stock: [itemOf('papel', 'Papel')] })).status, 200);
  assert.equal((await request('/api/operations', 'POST', { type: 'stock_in', quantity: 7, date: '2026-11-10', reference: 'GR-1', stockId: 'papel' })).status, 201);
  assert.equal((await request('/api/operations', 'POST', { batchId: 'meu', type: 'personalized', quantity: 10, date: '2026-11-10' })).status, 201);

  // carregar: o ecrã só grava o estado com os lotes do exemplo; os movimentos chegam na mesma gravação
  let current = (await request('/api/state')).body.state;
  const loaded = await save({ records: sample.records, lots: [...current.lots, ...sample.lots], stock: [...current.stock, ...sample.stock] });
  assert.deepEqual(Object.keys(loaded.body), ['revision'], 'o exemplo já vem de acordo: o servidor guarda-o tal como está escrito');
  let data = await dashboard();
  const fromSample = (list) => list.filter((move) => move.id.startsWith('exemplo-'));
  assert.equal(fromSample(data.operations).length, sample.operations.length);
  assert.equal(data.operations.length, sample.operations.length + 2, 'os que já lá estavam continuam');
  assert.deepEqual(fromSample(data.operations).map((move) => move.id), sample.operations.map((move) => move.id), 'pela ordem em que aconteceram');
  for (const lot of data.batches) {
    for (const key of ['toPersonalize', 'toPrint', 'toQC', 'toTransfer', 'toDispatch', 'unresolvedErrors']) assert.ok(lot[key] >= 0, `${lot.reference}: ${key} não pode ser negativo`);
  }
  assert.ok(data.delegations.every((row) => row.province), 'todas as delegações do exemplo são do catálogo');
  assert.ok(data.delegations.every((row) => row.produced > 0), 'e todas as províncias ficam com produção no mapa');
  assert.ok(data.batches.some((lot) => lot.unresolvedErrors > 0) && data.batches.some((lot) => lot.toPersonalize === lot.quantity) && data.batches.some((lot) => lot.dispatch === lot.quantity),
    'há um lote com erro por resolver, um por começar e um todo despachado, para experimentar cada caso');
  const blocked = await request('/api/operations', 'POST', { batchId: data.batches.find((lot) => lot.unresolvedErrors > 0).id, type: 'dispatch', quantity: 1, date: '2026-12-01', reference: 'G-9' });
  assert.equal(blocked.body.error, 'Este lote possui erros por resolver.');

  // gravar outra vez não duplica; um movimento do utilizador num lote do exemplo é aceite
  assert.equal((await save({})).status, 200);
  assert.equal(fromSample((await dashboard()).operations).length, sample.operations.length);
  assert.equal((await request('/api/operations', 'POST', { batchId: sample.lots[8].id, type: 'printed', quantity: 50, date: '2026-12-01', machine: 'Máquina 1' })).status, 201);

  // … e no armazém do exemplo também: soma no artigo, e fica com ele
  const cards = sample.stock[0];
  assert.equal((await request('/api/operations', 'POST', { type: 'stock_out', quantity: 5, date: '2026-12-01', reference: 'REQ-9', stockId: cards.id })).status, 201);

  // uma base da versão anterior traz movimentos do armazém do exemplo sem artigo (o material era escrito à mão)
  current = (await request('/api/state')).body.state;
  const oldStyle = { id: 'exemplo-movimento-antigo', type: 'stock_in', batchId: null, date: '2026-09-01', quantity: 5, metadata: { reference: 'GR-0', material: 'Cartões em branco' } };
  assert.equal((await save(current, { operations: [...(await dashboard()).operations, oldStyle] })).status, 200);
  assert.ok((await dashboard()).operations.some((move) => move.id === oldStyle.id));

  // remover: saem os lotes e os artigos do exemplo, e com eles todos os seus movimentos — os do exemplo e os feitos à mão; o que é do utilizador fica
  current = (await request('/api/state')).body.state;
  assert.equal(current.stock.find((item) => item.id === cards.id).issued, cards.issued + 5);
  const own = (list) => list.filter((item) => !item.id.startsWith('exemplo-'));
  assert.equal((await save({ records: own(current.records), lots: own(current.lots), stock: own(current.stock) })).status, 200);
  data = await dashboard();
  assert.deepEqual(data.operations.map((move) => move.batchId || move.metadata.material).sort(), ['Papel', 'meu']);
  assert.deepEqual(data.batches.map((lot) => lot.id), ['meu']);

  // o exemplo que entra sem um dos seus artigos (o utilizador já tinha um com esse nome) não traz os movimentos desse artigo
  current = (await request('/api/state')).body.state;
  const withoutCards = sample.stock.filter((item) => item.id !== cards.id);
  assert.equal((await save({ records: sample.records, lots: [...current.lots, ...sample.lots], stock: [...current.stock, ...withoutCards] })).status, 200);
  const arrived = fromSample((await dashboard()).operations);
  const ofCards = sample.operations.filter((move) => move.metadata.stockId === cards.id).length;
  assert.ok(ofCards > 0);
  assert.equal(arrived.length, sample.operations.length - ofCards);
  assert.ok(arrived.every((move) => move.batchId || withoutCards.some((item) => item.id === move.metadata.stockId)), 'cada movimento do armazém tem o seu artigo');
});

test('cada movimento do exemplo seria aceite pelo servidor, e deixa os lotes e o armazém como o exemplo os traz', async () => {
  await reset();
  const twin = (id) => id.replace('exemplo-', 'gemeo-');
  // os lotes e os artigos como estavam antes dos movimentos e dos dias: só com as fases que alguém marcou no próprio lote
  // (as que não têm movimentos nem são dos dias), e o armazém sem as entradas e saídas que o exemplo regista
  const moved = (id, type) => sample.operations.filter((move) => move.type === type && move.metadata.stockId === id).reduce((sum, move) => sum + move.quantity, 0);
  const withMoves = new Set(sample.operations.map((move) => move.batchId).filter(Boolean));
  const typed = (lot) => (withMoves.has(lot.id) ? {} : Object.fromEntries(core.LOT_STAGES.filter((stage) => !core.DAY_STAGES.includes(stage)).map((stage) => [stage, lot.stages[stage]])));
  const lots = sample.lots.map((lot) => core.makeLot({ id: twin(lot.id), reference: lot.reference, delegation: lot.delegation, quantity: lot.quantity, start: lot.start, notes: lot.notes, stages: typed(lot) }));
  const stock = sample.stock.map((item) => ({ ...item, id: twin(item.id), received: item.received - moved(item.id, 'stock_in'), issued: item.issued - moved(item.id, 'stock_out'), delivered: '', updated: '' }));
  const days = sample.records.map((record) => ({ ...record, id: twin(record.id), entries: record.entries.map((entry) => ({ ...entry, id: twin(entry.id), lotId: entry.lotId && twin(entry.lotId) })) }));
  const begun = await save({ records: days, lots, stock });
  assert.equal(begun.status, 200, begun.body.error);
  assert.equal((await dashboard()).operations.length, 0, 'lotes com outro identificador não trazem os movimentos do exemplo');

  for (const move of sample.operations) {
    const answer = await request('/api/operations', 'POST', {
      type: move.type, batchId: move.batchId ? twin(move.batchId) : null, date: move.date, quantity: move.quantity,
      ...move.metadata, ...(move.metadata.stockId ? { stockId: twin(move.metadata.stockId) } : {}),
    });
    assert.equal(answer.status, 201, `${move.id} (${move.type} ${move.quantity} em ${move.date}): ${answer.body.error}`);
  }

  // o que o servidor calculou é o que o exemplo traz escrito: as quatro fases de cada lote e o saldo de cada artigo
  const state = (await request('/api/state')).body.state;
  for (const lot of sample.lots) {
    const made = state.lots.find((item) => item.id === twin(lot.id));
    for (const name of core.LOT_STAGES) assert.deepEqual(stageOf(state, made.id, name), stageOf(sample, lot.id, name), `${lot.reference}: ${name}`);
    assert.equal(made.closed, lot.closed, `${lot.reference}: fechado`);
  }
  for (const item of sample.stock) {
    const made = state.stock.find((entry) => entry.id === twin(item.id));
    assert.deepEqual([made.received, made.issued], [item.received, item.issued], item.name);
    if (moved(item.id, 'stock_in')) assert.equal(made.delivered, item.delivered, `${item.name}: a última entrega`);
  }
  assert.ok(sample.operations.some((move) => move.metadata.stockId), 'o exemplo tem movimentos do armazém');
  assert.ok(sample.operations.filter((move) => !move.batchId).every((move) => sample.stock.some((item) => item.id === move.metadata.stockId && item.name === move.metadata.material)),
    'e cada um aponta para um artigo do armazém do exemplo');
  // os dias do exemplo que apontam um lote do quadro dizem dele o que ele diz
  const pointed = sample.records.flatMap((record) => record.entries).filter((entry) => entry.lotId);
  assert.ok(pointed.length > 0, 'o exemplo tem um lote apontado nos dias');
  for (const entry of pointed) {
    const lot = sample.lots.find((item) => item.id === entry.lotId);
    assert.deepEqual([entry.reference, entry.delegation], [lot.reference, lot.delegation]);
  }
  assert.equal(core.settle(sample), sample, 'o exemplo já está de acordo: a regra da casa não lhe muda nada');
});

test('a cópia leva e traz os movimentos com o estado; uma cópia estragada não muda nada', async () => {
  await reset();
  assert.equal((await save({ lots: [lotOf('c1', 'LT-C1', 'Chimoio', 20)], stock: [itemOf('toner', 'Tóner')] })).status, 200);
  assert.equal((await request('/api/operations', 'POST', { batchId: 'c1', type: 'personalized', quantity: 20, date: '2026-11-10' })).status, 201);
  assert.equal((await request('/api/operations', 'POST', { type: 'stock_in', quantity: 9, date: '2026-11-11', reference: 'GR-2', stockId: 'toner' })).status, 201);
  const copy = { ...(await request('/api/state')).body.state, operations: (await dashboard()).operations };
  assert.equal(copy.operations.length, 2);

  await reset();
  assert.equal((await dashboard()).operations.length, 0);
  const { operations, ...state } = copy;
  assert.equal((await save(state, { operations })).status, 200);
  const restored = await dashboard();
  assert.deepEqual(restored.operations, copy.operations, 'os movimentos voltam tal e qual: identificador, datas, quantidades e dados');
  assert.equal(restored.batches[0].toPrint, 20);
  // a cópia traz o artigo já com a entrada somada: voltar a entrar não a soma outra vez
  assert.deepEqual((await request('/api/state')).body.state, state, 'e o estado volta tal e qual, com a fase do lote e o saldo do artigo que os movimentos deixaram');
  assert.deepEqual([state.stock[0].received, stageOf(state, 'c1', 'personalizacao')], [9, ['feito', 20, '2026-11-10']]);

  // uma cópia com um movimento que não se reconhece é recusada inteira: nem o estado nem os movimentos mudam
  const before = (await request('/api/state')).body;
  for (const broken of [[{ ...operations[0], type: 'voar' }], [operations[0], operations[0]], [{ ...operations[0], quantity: -1 }], [{ ...operations[0], date: '2026-13-40' }], 'texto', [{ ...operations[1], batchId: 'c1' }]]) {
    const answer = await request('/api/state', 'PUT', { revision: before.revision, state: { ...before.state, lots: [] }, operations: broken });
    assert.equal(answer.status, 422, JSON.stringify(broken).slice(0, 80));
  }
  const after = (await request('/api/state')).body;
  assert.equal(after.revision, before.revision);
  assert.equal(after.state.lots.length, 1);
  assert.deepEqual((await dashboard()).operations, copy.operations);

  // uma cópia antiga, sem movimentos, não mexe nos movimentos dos lotes que continuam a existir
  assert.equal((await save(state)).status, 200);
  assert.equal((await dashboard()).operations.length, 2);
});

test('gravação do estado: revisão antiga e estado inválido são recusados, e nada muda', async () => {
  await reset();
  const before = (await request('/api/state')).body;
  const good = { ...before.state, lots: [lotOf('g1', 'LT-G1', 'Gaza', 5)] };
  const stale = await request('/api/state', 'PUT', { revision: before.revision - 1, state: good });
  assert.deepEqual([stale.status, stale.body.error], [409, 'Outra janela guardou dados. Recarrega a página.']);
  assert.equal((await request('/api/state', 'PUT', { state: good })).status, 409, 'sem revisão não se grava');
  for (const bad of [undefined, null, 'texto', { version: 5, records: [] }, { ...good, records: [{ id: 'x' }] }, { ...good, lots: [{ ...good.lots[0], quantity: 0 }] }]) {
    const answer = await request('/api/state', 'PUT', { revision: before.revision, state: bad });
    assert.equal(answer.status, 422, JSON.stringify(bad));
    assert.ok(answer.body.error && answer.body.error !== 'Erro interno do servidor.', 'a recusa diz o que está mal');
  }
  const after = (await request('/api/state')).body;
  assert.deepEqual([after.revision, after.state.lots.length], [before.revision, 0]);
  // duas janelas com a mesma revisão: a primeira grava, a segunda é recusada e não passa por cima
  const [first, second] = await Promise.all([request('/api/state', 'PUT', { revision: before.revision, state: good }), request('/api/state', 'PUT', { revision: before.revision, state: before.state })]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  const bad = await fetch(`${base}/api/state`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"revision": 1, "state": ' });
  assert.equal(bad.status, 400);
  const foreign = await fetch(`${base}/api/state`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'http://outro.sitio' }, body: '{}' });
  assert.equal(foreign.status, 403, 'outra página não grava nesta base');
});

test('base presa por outro programa: a gravação é recusada com uma frase, e depois de libertada grava como sempre', async () => {
  await reset();
  assert.equal((await save({ lots: [lotOf('a', 'LT-A', 'Beira', 50)] })).status, 200);
  const { db } = require('../backend/shared/database.js');
  db.exec('PRAGMA busy_timeout = 150');   // o programa espera cinco segundos pelo outro; no teste chega muito menos
  const other = new DatabaseSync(DB);
  const before = (await request('/api/state')).body;
  try {
    other.exec('BEGIN IMMEDIATE');        // outro programa a meio de uma escrita no mesmo ficheiro
    assert.equal((await request('/api/state')).status, 200, 'ler continua a ser possível');
    const refused = await request('/api/state', 'PUT', { revision: before.revision, state: { ...before.state, lots: [] } });
    assert.equal(refused.status, 503);
    assert.equal(refused.body.error, 'A base de dados está ocupada por outro programa. Fecha-o e tenta outra vez; nada foi alterado.');
    const move = await request('/api/operations', 'POST', { batchId: 'a', type: 'personalized', quantity: 10, date: '2026-11-10' });
    assert.equal(move.status, 503);
    assert.match(move.body.error, /ocupada por outro programa/);
  } finally {
    other.exec('ROLLBACK');
    other.close();
    db.exec('PRAGMA busy_timeout = 5000');
  }
  const after = (await request('/api/state')).body;
  assert.deepEqual([after.revision, after.state.lots.length, (await dashboard()).operations.length], [before.revision, 1, 0], 'nada mudou enquanto a base esteve presa');
  assert.equal((await request('/api/operations', 'POST', { batchId: 'a', type: 'personalized', quantity: 10, date: '2026-11-10' })).status, 201, 'libertada a base, o movimento entra');
  assert.equal((await save({ stock: [] })).status, 200, 'e o estado grava-se');
});

test('os acentos chegam inteiros mesmo quando o pedido se parte a meio de uma letra', async () => {
  await reset();
  const before = (await request('/api/state')).body;
  const notes = 'Zambézia — ção, à espera de reposição. '.repeat(30);
  const lot = { ...lotOf('acentos', 'LT-Ç', 'Quelimane', 5), notes: notes.slice(0, 500) };
  const body = Buffer.from(JSON.stringify({ revision: before.revision, state: { ...before.state, lots: [lot] } }), 'utf8');
  const cut = body.indexOf(Buffer.from('é', 'utf8')) + 1;   // a meio dos dois bytes do «é»
  const status = await new Promise((resolve, reject) => {
    const url = new URL(base);
    const req = http.request({ host: url.hostname, port: url.port, path: '/api/state', method: 'PUT', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.write(body.subarray(0, cut));
    setTimeout(() => req.end(body.subarray(cut)), 120);
  });
  assert.equal(status, 200);
  const saved = (await request('/api/state')).body.state.lots[0];
  assert.equal(saved.notes, lot.notes);
  assert.equal(saved.reference, 'LT-Ç');
});

test('a base fica num ficheiro só, completo depois de cada gravação', async () => {
  await reset();
  assert.equal((await save({ lots: [lotOf('f1', 'LT-F1', 'Pemba', 5)] })).status, 200);
  assert.deepEqual(fs.readdirSync(TEMP).filter((name) => name.startsWith('test.sqlite3')), ['test.sqlite3'], 'sem ficheiros ao lado com dados por arrumar');
  // uma cópia do ficheiro, tirada com o programa aberto mas sem gravações a meio, traz tudo
  const copy = path.join(TEMP, 'copia.sqlite3');
  fs.copyFileSync(DB, copy);
  const db = new DatabaseSync(copy);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(JSON.parse(db.prepare('SELECT document FROM app_state WHERE id = 1').get().document).lots[0].reference, 'LT-F1');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM delegations').get().n, 11, 'a tabela das delegações é o espelho do catálogo');
  db.close();
});

/* ------------------------------------------------ bases de outras versões --- */

/** Arranca o servidor noutro processo, sobre o ficheiro dado; devolve o processo e o endereço. */
function launch(file) {
  return new Promise((resolve, reject) => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], { env: { ...process.env, PORT: String(port), CONTACARTA_DB: file } });
    let output = '';
    child.stdout.on('data', (data) => { output += data; if (output.includes('Dados:')) resolve({ child, origin: `http://127.0.0.1:${port}`, output: () => output }); });
    child.stderr.on('data', (data) => { output += data; });
    child.on('exit', (code) => reject(Object.assign(new Error(output), { code })));
  });
}
const stop = (child) => new Promise((resolve) => { child.once('exit', resolve); child.kill('SIGINT'); });

/** Cria uma base à mão, como a de uma versão anterior. */
function build(name, sql, rows) {
  const file = path.join(TEMP, name);
  const db = new DatabaseSync(file);
  db.exec(sql);
  for (const [query, values] of rows) db.prepare(query).run(...values);
  db.close();
  return file;
}
const STATE_TABLE = 'CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, document TEXT NOT NULL, updated_at TEXT)';
const emptyState = { version: 6, records: [], lots: [], stock: [] };

test('uma base que a versão anterior deixou com os dados ao lado (WAL) é arrumada sem perder nada', async () => {
  const file = path.join(TEMP, 'wal.sqlite3');
  // outro processo escreve em WAL e é morto sem fechar a base: os dados ficam todos no ficheiro «-wal»
  const state = JSON.stringify({ ...emptyState, lots: [lotOf('w1', 'LT-WAL', 'Niassa', 77)] });
  const writer = `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(file)});
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
    db.exec(${JSON.stringify(STATE_TABLE)});
    db.prepare('INSERT INTO app_state VALUES(1, 41, ?, ?)').run(${JSON.stringify(state)}, '2026-11-17T08:00:00.000Z');
    process.kill(process.pid, 'SIGKILL');`;
  spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', writer]);
  assert.ok(fs.statSync(`${file}-wal`).size > 0, 'a versão anterior deixou os dados no ficheiro do lado');
  const small = fs.statSync(file).size;

  const { child, origin } = await launch(file);
  try {
    const saved = (await request('/api/state', 'GET', undefined, origin)).body;
    assert.deepEqual([saved.revision, saved.state.lots[0].reference, saved.state.lots[0].quantity], [41, 'LT-WAL', 77]);
    assert.deepEqual(fs.readdirSync(TEMP).filter((name) => name.startsWith('wal.sqlite3')), ['wal.sqlite3'], 'o ficheiro do lado desapareceu');
    assert.ok(fs.statSync(file).size > small, 'e o que lá estava passou para o ficheiro principal');
  } finally {
    await stop(child);
  }
});

test('bases antigas abrem: sem a coluna da hora, e com o documento de uma versão anterior', async () => {
  const noColumn = build('sem-coluna.sqlite3', 'CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, document TEXT NOT NULL)',
    [['INSERT INTO app_state VALUES(1, 7, ?)', [JSON.stringify(emptyState)]]]);
  let running = await launch(noColumn);
  try {
    const before = (await request('/api/state', 'GET', undefined, running.origin)).body;
    assert.equal(before.revision, 7);
    const put = await request('/api/state', 'PUT', { revision: 7, state: { ...before.state, lots: [lotOf('n1', 'LT-N1', 'Gaza', 3)] } }, running.origin);
    assert.deepEqual([put.status, put.body.revision], [200, 8], 'gravar funciona numa base que não guardava a hora');
    assert.match((await request('/api/state', 'GET', undefined, running.origin)).body.savedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await stop(running.child);
  }

  const v4 = { version: 4, records: [{ id: 'r1', period: 'day', start: '2026-03-02', end: '2026-03-02', machines: [{ produced: 120, rejected: 6, qualityRejected: 2 }, { produced: 80, rejected: 3, qualityRejected: 1 }], notes: 'Zambézia' }] };
  const old = build('v4.sqlite3', STATE_TABLE, [['INSERT INTO app_state VALUES(1, 3, ?, ?)', [JSON.stringify(v4), '02/03/2026, 10:00:00']]]);
  running = await launch(old);
  try {
    const converted = (await request('/api/state', 'GET', undefined, running.origin)).body;
    assert.deepEqual([converted.revision, converted.state.version, converted.state.records.length], [4, 6, 1], 'o documento antigo é convertido uma vez, com revisão nova');
    assert.deepEqual([converted.state.records[0].entries.length, converted.state.records[0].notes], [2, 'Zambézia'], 'as máquinas da versão 4 entram como lotes do dia');
    assert.equal((await request('/api/operations', 'GET', undefined, running.origin)).body.delegations.length, 11);
  } finally {
    await stop(running.child);
  }
});

test('uma base da versão anterior fica de acordo ao abrir: uma vez, e sem perder nada', async () => {
  // a versão anterior deixava a entrada do dia com a sua própria delegação e as suas cartas, e a fase do lote por marcar
  const left = { ...emptyState,
    lots: [lotOf('v1', 'LT-V1', 'Beira', 500)],
    records: [dayOf('2026-11-05', [entryOf('a', 'v1', 200, { delegation: 'Pemba', planned: 999 })]), dayOf('2026-11-06', [entryOf('b', 'v1', 300, { reference: 'LT-V1', qualityRejected: 10 })])] };
  const file = build('desacertada.sqlite3', STATE_TABLE, [['INSERT INTO app_state VALUES(1, 12, ?, ?)', [JSON.stringify(left), '2026-11-06T16:00:00.000Z']]]);
  let running = await launch(file);
  try {
    const opened = (await request('/api/state', 'GET', undefined, running.origin)).body;
    assert.equal(opened.revision, 13, 'acertar o que estava guardado é uma gravação');
    assert.deepEqual(opened.state.records.flatMap((record) => record.entries).map((entry) => [entry.id, entry.reference, entry.delegation, entry.planned, entry.produced]),
      [['a', 'LT-V1', 'Beira', 500, 200], ['b', 'LT-V1', 'Beira', 300, 300]], 'os dias passam a dizer do lote o que o lote diz; o que foi produzido não muda');
    assert.deepEqual(stageOf(opened.state, 'v1', 'impressao'), ['em-curso', 490, '2026-11-06']);
    assert.deepEqual(stageOf(opened.state, 'v1', 'qualidade'), ['em-curso', 490, '2026-11-06']);
    assert.equal(rowOf((await request('/api/operations', 'GET', undefined, running.origin)).body, 'Beira').produced, 500);
  } finally {
    await stop(running.child);
  }
  running = await launch(file);
  try {
    assert.equal((await request('/api/state', 'GET', undefined, running.origin)).body.revision, 13, 'da segunda vez já está tudo de acordo: não se grava nada');
  } finally {
    await stop(running.child);
  }
});

test('uma base que não se consegue ler trava o arranque com uma frase, sem alterar o ficheiro', async () => {
  const broken = build('ilegivel.sqlite3', STATE_TABLE, [['INSERT INTO app_state VALUES(1, 3, ?, ?)', ['{"version": 6, "records": [', 'x']]]);
  const text = path.join(TEMP, 'texto.sqlite3');
  fs.writeFileSync(text, 'isto não é uma base de dados, é um ficheiro de texto com mais de cem caracteres para não haver dúvidas.\n'.repeat(40));
  for (const [file, pattern] of [[broken, /truncado ou ilegível/], [text, /não se consegue abrir como base de dados/]]) {
    const before = fs.readFileSync(file);
    const failure = await launch(file).then(({ child }) => stop(child).then(() => null), (error) => error);
    assert.ok(failure, 'o programa não arranca sobre uma base ilegível');
    assert.equal(failure.code, 1);
    assert.match(failure.message, /Não foi possível abrir os dados/);
    assert.match(failure.message, pattern);
    assert.doesNotMatch(failure.message, /\n\s+at /, 'uma frase para quem trabalha, não uma pilha de código');
    assert.ok(before.equals(fs.readFileSync(file)), 'o ficheiro fica exactamente como estava');
  }
});

test('abrir o programa duas vezes: a segunda janela explica-se e sai', async () => {
  const file = path.join(TEMP, 'duas.sqlite3');
  const first = await launch(file);
  try {
    const port = new URL(first.origin).port;
    const second = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], { env: { ...process.env, PORT: port, CONTACARTA_DB: file }, encoding: 'utf8', timeout: 20000 });
    assert.equal(second.status, 1);
    assert.match(second.stderr, /já está ocupada/);
    assert.equal((await request('/api/state', 'GET', undefined, first.origin)).status, 200, 'a primeira continua a trabalhar');
  } finally {
    await stop(first.child);
  }
});
