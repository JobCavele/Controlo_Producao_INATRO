/*
 * Testes do núcleo de dados (app/lib/core.js) e dos módulos da interface.
 * Correm com `node tests/test-core.cjs` — sem dependências externas.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../app/lib/core.js');

const ROOT = path.join(__dirname, '..');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));

const record = (fields) => core.makeRecord({ period: 'day', start: '2026-10-05', ...fields });
const throws = (fn, pattern, label) => assert.throws(fn, pattern, label);

/* 1 · datas: só calendários reais, sem horas nem fusos pelo meio */
assert.equal(core.isDate('2026-02-28'), true);
assert.equal(core.isDate('2026-02-29'), false, '2026 não é bissexto');
assert.equal(core.isDate('2024-02-29'), true);
assert.equal(core.isDate('2026-13-01'), false);
assert.equal(core.isDate('2026-1-1'), false, 'exige dois dígitos por campo');
assert.equal(core.isDate('05/10/2026'), false, 'isDate é a forma interna; o que se escreve passa por parseDate');
assert.equal(core.parseDate('05/10/2026'), '2026-10-05', 'dd/mm/yyyy é o formato escrito em todo o lado');
assert.equal(core.parseDate('5/10/2026'), '2026-10-05', 'um dígito também se aceita e fica completo');
assert.equal(core.parseDate('2026-10-05'), '2026-10-05', 'ISO continua a entrar, para cópias antigas');
assert.equal(core.parseDate('30/02/2026'), null, '30 de Fevereiro não existe');
assert.equal(core.parseDate('32/01/2026'), null);
assert.equal(core.parseDate('05-10-2026'), null, 'com hífenes não é o formato do sistema');
assert.equal(core.parseDate('1899-12-31'), null, 'antes de 1900 não se aceita');
assert.equal(core.isDate('2201-01-01'), false, 'depois de 2200 não se aceita');
assert.equal(core.isDate(null), false);
assert.equal(core.isMonth('2026-11'), true);
assert.equal(core.isMonth('2026-11-02'), false);
assert.equal(core.isMonth('2026-00'), false);
assert.equal(core.parseMonth('11/2026'), '2026-11');
assert.equal(core.parseMonth('2026-11'), '2026-11');
assert.equal(core.parseMonth('13/2026'), null);
assert.equal(core.parseMonth('11/26'), null, 'o ano vai inteiro');
assert.equal(core.addDays('2026-12-30', 3), '2027-01-02', 'passa o ano sem deslizar');
assert.equal(core.addDays('2026-02-27', 2), '2026-03-01');
assert.equal(core.daysBetween('2026-10-01', '2026-10-31'), 31);
assert.equal(core.daysBetween('2026-10-05', '2026-10-05'), 1);
assert.equal(core.weekday('2026-11-12'), 3, 'quinta-feira');
assert.equal(core.weekday('2026-11-15'), 6, 'domingo é o último dia da semana');
console.log('· datas válidas, bissexto, limites e semana de segunda a domingo');

/* 2 · meses e semanas completos */
assert.deepEqual(core.monthRange('2026-02'), { start: '2026-02-01', end: '2026-02-28', days: 28, label: '02\/2026' });
assert.equal(core.monthRange('2028-02').days, 29);
assert.equal(core.monthRange('2026-12').end, '2026-12-31');
assert.equal(core.daysInMonth('2026-04'), 30);
assert.equal(core.shiftMonth('2026-12', 1), '2027-01');
assert.equal(core.shiftMonth('2027-01', -1), '2026-12');
assert.equal(core.shiftMonth('2026-01', -12), '2025-01');
assert.deepEqual(core.weekRange('2026-11-12'), { start: '2026-11-09', end: '2026-11-15', days: 7, label: 'Semana de 09/11\/2026' });
assert.equal(core.weekRange('2026-12-31').start, '2026-12-28', 'a semana pode atravessar o ano');
console.log('· meses e semanas: princípios, fins e mudança de ano');

/* 3 · rótulos lidos por pessoas, não por programadores */
const group = (value) => new Intl.NumberFormat('pt-PT').format(value);
assert.equal(core.format(1234567), group(1234567));
assert.equal(core.format(null), '—');
assert.equal(core.format(0), '0');
assert.equal(core.percent(1, 3), 33.3, 'uma decimal');
assert.equal(core.percent(2, 3), 66.7);
assert.equal(core.percent(0, 0), null, 'sem produção não há taxa');
assert.equal(core.percent(1, -1), null);
assert.equal(core.formatPercent(null), '—');
assert.equal(core.formatPercent(80), '80,0%');
assert.equal(core.shortDate('2026-10-05'), '05/10\/2026');
assert.equal(core.longDate('2026-10-05'), '05/10\/2026');
assert.equal(core.monthLabel('2026-01'), '01\/2026');
assert.equal(core.periodLabel('2026-10-05', '2026-10-05'), '05/10\/2026');
assert.equal(core.periodLabel('2026-10-01', '2026-10-31'), '10\/2026', 'mês inteiro aparece pelo nome');
assert.equal(core.periodLabel('2026-10-25', '2026-11-03'), '25/10\/2026 – 03/11\/2026');
assert.equal(core.weekLabel('2026-11-12'), 'Quinta, 12/11\/2026');
console.log('· números, percentagens e datas em português europeu');

/* 4 · quantidades escritas à mão */
assert.equal(core.readQuantity('', 'Máquina 1', 'as cartas produzidas'), 0, 'vazio é zero, não erro');
assert.equal(core.readQuantity('  57 ', 'Máquina 1', 'as cartas produzidas'), 57);
assert.equal(core.readQuantity('1.250', 'Máquina 1', 'as cartas produzidas'), 1250, 'ponto de milhar');
assert.equal(core.readQuantity('1\u00a0250', 'Máquina 1', 'as cartas produzidas'), 1250, 'espaço fino');
assert.equal(core.readQuantity('0', 'Máquina 1', 'as cartas produzidas'), 0);
throws(() => core.readQuantity('12,5', 'Máquina 2', 'as cartas rejeitadas'), /^Error: Máquina 2: escreve as cartas rejeitadas em números inteiros/, 'dízimas fora');
throws(() => core.readQuantity('12abc', 'Máquina 1', 'as cartas produzidas'), /sem letras nem casas decimais/);
throws(() => core.readQuantity('-5', 'Máquina 1', 'as cartas produzidas'), /inteiros/);
throws(() => core.readQuantity(String(core.MAX_QUANTITY + 1), 'Máquina 1', 'as cartas produzidas'), /tem de ser no máximo/);
console.log('· quantidades: espaços, ponto de milhar e recusa de texto');

/* 5 · o dia constrói-se a partir dos lotes, não de totais por máquina */
const entry = (fields) => core.makeEntry({ planned: '600', produced: '500', ...fields });
const day = core.makeRecord({
  period: 'day', start: '05/10/2026',
  entries: [
    { reference: 'L-2026-001', delegation: 'Maple', machine: 0, planned: '600', produced: '500', rejected: '100', qualityRejected: '40' },
    { reference: 'L-2026-002', delegation: 'Beira', machine: 1, planned: '300', produced: '300', rejected: '20', qualityRejected: '10' },
  ],
});
assert.equal(day.period, 'day');
assert.equal(day.end, day.start, 'um dia começa e acaba na mesma data');
assert.equal(day.entries.length, 2, 'um dia guarda os lotes, não os totais');
assert.deepEqual([day.entries[0].machine, day.entries[0].produced], [0, 500]);
assert.equal(day.entries[0].updated, '2026-10-05', 'a data do lote é a do dia');
assert.equal(day.entries[1].reference, 'L-2026-002');
assert.match(day.id, /.+/, 'todo o dia nasce com identificador');
const dayTotals = core.totals(day);
assert.deepEqual([dayTotals.produced, dayTotals.approved, dayTotals.rejected, dayTotals.qualityRejected], [800, 750, 120, 50],
  'os totais do dia somam os lotes: 500+300 produzidas, 460+290 aprovadas');
assert.equal(dayTotals.lots, 2, 'o dia sabe quantos lotes tem');
assert.deepEqual(dayTotals.machines.map((machine) => machine.produced), [500, 300], 'e continua a haver conta por máquina');
assert.equal(core.makeRecord({ period: 'day', start: '05/10/2026', entries: [] }).entries.length, 0, 'um dia pode estar vazio');
throws(() => core.makeEntry({ planned: '', produced: '10' }), /diz quantas cartas tem o lote/);
throws(() => core.makeEntry({ planned: '50', produced: '10', rejected: '20' }), /rejeitadas pela máquina não cabem em 10 produzidas/);
throws(() => core.makeEntry({ planned: '50', produced: '10', qualityRejected: '11' }), /chumbadas no teste não cabem em 10/);
throws(() => core.makeEntry({ planned: '50', produced: '10', qualityRejected: '2', reasons: [{ code: 'bio-foto', quantity: '3' }] }),
  /3 cartas justificadas não cabem em 2 chumbadas/, 'os motivos não podem exceder as chumbadas');
assert.equal(core.makeEntry({ planned: '50', produced: '40', qualityRejected: '5', reasons: [{ code: 'bio-foto', quantity: '1' }, { code: 'inventado', quantity: '9' }] }).reasons.length, 1,
  'só entram motivos do INCAPE (e o inventado é descartado)');
// a forma antiga (totais por máquina) continua a entrar: cada máquina é um lote concluído
const oldShape = core.makeRecord({ period: 'day', start: '05/10/2026', machines: [{ produced: '500', rejected: '100', qualityRejected: '40' }, { produced: '', rejected: '', qualityRejected: '' }] });
assert.equal(oldShape.entries.length, 1, 'a máquina que não produziu não inventa um lote');
assert.deepEqual([oldShape.entries[0].produced, oldShape.entries[0].rejected, oldShape.entries[0].qualityRejected], [500, 100, 40]);
assert.equal(core.totals(oldShape).approved, 460, 'a conta é a mesma de sempre');
assert.equal(core.makeRecord({ period: 'month', start: '02/2026', machines: [{ produced: 10, rejected: 1 }] }).period, 'month');
assert.equal(core.makeRecord({ period: 'day', start: '05/10/2026', machines: [{ produced: 1 }] }).start, '2026-10-05',
  'o formulário escreve dd/mm/yyyy e o dia fica em ISO');
assert.equal(core.makeRecord({ period: 'dia-solto', start: '2026-10-05' }).period, 'day', 'período desconhecido volta a dia');
throws(() => core.makeRecord({ period: 'month', start: '31/12/2026' }), /Escolhe o mês do registo, em mm\/aaaa/, 'o mês não leva dia');
throws(() => core.makeRecord({ period: 'range', start: '2026-10-09', end: '2026-10-05' }), /data final não pode ser anterior/);
const monthShape = core.makeRecord({ period: 'month', start: '02/2026', machines: [{ produced: 10, rejected: 1 }] });
assert.deepEqual([monthShape.start, monthShape.end], ['2026-02-01', '2026-02-28'], 'um mês cobre o mês inteiro');
assert.equal(core.makeRecord({ period: 'day', start: '2026-10-05', notes: 'a'.repeat(600) }).notes.length, 500, 'notas cortadas no limite');

/* 5a · o estado de cada lote: por começar, em curso e concluído */
const fresh = entry({ produced: '', rejected: '' });
assert.equal(core.entryState(fresh).key, 'pendente', 'sem cartas, o lote ainda não começou');
assert.equal(core.entryState(fresh).label, 'Por começar');
const running = entry({ produced: '300', done: false });
assert.equal(core.entryState(running).key, 'em-curso');
assert.equal(core.entryMissing(running), 300, 'faltam 300 cartas para o lote de 600');
assert.equal(core.entryState({ ...running, done: true }).key, 'feito');
assert.equal(core.entryMissing({ ...running, produced: '700' }), 0, 'o que passou do plano não conta como falta');
const status = core.dayStatus(day);
assert.deepEqual([status.entries, status.done, status.open, status.lots, status.planned], [2, 2, 0, 2, 900]);
assert.equal(status.missing, 0, 'os dois lotes estão completos');
assert.equal(status.closed, false, 'o dia está aberto');
const halfDay = core.makeRecord({ period: 'day', start: '06/10/2026', entries: [
  { machine: 0, planned: '50', produced: '20', done: false },
  { machine: 1, planned: '50', produced: '50' },
] });
assert.equal(core.dayStatus(halfDay).done, 1);
assert.equal(core.dayStatus(halfDay).open, 1);
assert.equal(core.dayStatus(halfDay).missing, 30, 'o que falta é o plano do lote em curso menos o que saiu');
assert.equal(core.openEntries(halfDay).length, 1, 'só o lote por concluir está aberto');
assert.equal(core.dayStatus(core.makeRecord({ period: 'day', start: '07/10/2026' })).empty, true);
console.log('· dia: lotes com referência, máquina, cartas e estado; totais somados dos lotes');

/* ---- helper: a forma antiga (máquinas) passa a entradas, só nos testes ---- */
const asEntries = (machines) => machines.map((machine, index) => ({
  id: `e-${Math.random().toString(36).slice(2, 9)}`, lotId: '', reference: '', delegation: '', machine: index,
  planned: machine.produced || 0, produced: machine.produced || 0, rejected: machine.rejected || 0, qualityRejected: machine.qualityRejected || 0,
  reasons: [], done: true, updated: '', notes: '',
}));

/* 7 · um registo só conta se couber inteiro no período */
const state = {
  version: core.VERSION,
  records: [
    { id: 'fora-antes', period: 'range', start: '2026-09-20', end: '2026-09-30', entries: asEntries([{ produced: 100, rejected: 10, qualityRejected: 5 }, { produced: 0, rejected: 0, qualityRejected: 0 }]), notes: '' },
    { id: 'fora-depois', period: 'range', start: '2026-11-01', end: '2026-11-20', entries: asEntries([{ produced: 100, rejected: 10, qualityRejected: 5 }, { produced: 0, rejected: 0, qualityRejected: 0 }]), notes: '' },
    { id: 'dentro-dia', period: 'day', start: '2026-10-05', end: '2026-10-05', entries: asEntries([{ produced: 500, rejected: 100, qualityRejected: 50 }, { produced: 300, rejected: 20, qualityRejected: 10 }]), notes: '' },
    { id: 'meio', period: 'range', start: '2026-10-20', end: '2026-11-10', entries: asEntries([{ produced: 900, rejected: 90, qualityRejected: 30 }, { produced: 0, rejected: 0, qualityRejected: 0 }]), notes: '' },
  ],
};
const chosen = core.selectRecords(state.records, '2026-10-01', '2026-10-31');
assert.deepEqual(chosen.included.map((item) => item.id), ['dentro-dia'], 'só entra o que está inteiro no mês');
assert.deepEqual(chosen.partial.map((item) => item.id), ['meio'], 'só se avisa quem toca o período');
assert.deepEqual(chosen.included.concat(chosen.partial).map((item) => item.id).sort(), ['dentro-dia', 'meio'], 'o que está longe nem aparece');
const summary = core.summarise(state, '2026-10-01', '2026-10-31');
assert.deepEqual({ produced: summary.produced, approved: summary.approved, rejected: summary.rejected, qualityRejected: summary.qualityRejected }, { produced: 800, approved: 740, rejected: 120, qualityRejected: 60 });
assert.equal(summary.approvalRate, 92.5);
assert.equal(summary.qualityRejectionRate, 7.5);
assert.equal(summary.records.length, 1);
assert.equal(summary.outside.length, 1, 'avisa-se que há um registo a tocar o período');
assert.deepEqual({ start: summary.start, end: summary.end, days: summary.days, daysCovered: summary.daysCovered }, { start: '2026-10-01', end: '2026-10-31', days: 31, daysCovered: 1 });
assert.deepEqual(summary.machines[1], { produced: 300, rejected: 20, qualityRejected: 10, approved: 290, reworked: 10, approvalRate: 96.7, rejectionRate: 6.7, qualityRejectionRate: 3.3 });
assert.equal(core.summarise(core.emptyState(), '2026-10-01', '2026-10-31').empty, true);
assert.equal(core.summarise(state, '2026-10-05', '2026-10-05').daysCovered, 1, 'cobertura nunca ultrapassa o período');
console.log('· período: inclusão total, fora-do-período e cobertura de dias');

/* 8 · séries do gráfico */
const monthly = core.series(state, '2026-09-01', '2026-11-30', 'month');
assert.deepEqual(monthly.map((point) => point.label), ['09/2026', '10/2026', '11/2026'], 'cada barra leva o mês e o ano inteiro');
assert.equal(monthly[1].produced, 800);
assert.equal(monthly[1].qualityRejected, 60, 'as rejeições de qualidade acompanham as barras');
assert.equal(monthly[1].qualityRejectionRate, 7.5);
assert.equal(monthly[2].produced, 100, 'o mês a meio de um registo conta o que coube');
assert.equal(monthly[0].full, '09\/2026');
const perRecord = core.series(state, '2026-10-01', '2026-10-31', 'record');
assert.deepEqual(perRecord.map((point) => point.full), ['05/10\/2026']);
assert.deepEqual(perRecord.map((point) => point.produced), [800]);
assert.deepEqual(core.series(state, '2026-12-01', '2026-12-31', 'month'), [
  { full: '12\/2026', label: '12/2026', produced: 0, approved: 0, rejected: 0, qualityRejected: 0,
    approvalRate: null, rejectionRate: null, qualityRejectionRate: null },
]);
console.log('· gráfico: visão mensal e visão por registo');

/* 9 · validação: cada erro diz o que corrigir */
throws(() => core.validate(null), /Os dados não foram reconhecidos\. Importa uma cópia exportada pelo Conta Carta\./);
throws(() => core.validate({ version: 2, records: [] }), /versão anterior \(v2\)/);
throws(() => core.validate({ version: 3, records: [] }), /versão anterior \(v3\)/, 'a cópia v3 pede conversão, não entra directa');
throws(() => core.validate({ version: core.VERSION }), /A cópia não tem uma lista de registos\./);
throws(() => core.validate({ version: core.VERSION, records: [42] }), /Registo 1: formato inválido\./);
const twin = core.normalize(day);
throws(() => core.validate({ version: core.VERSION, records: [twin, { ...twin, id: twin.id, notes: 'outro' }] }),
  /Registo 2: o identificador está repetido na cópia\./, 'mesmo identificador duas vezes');
throws(() => core.validate({ version: core.VERSION, records: [{ ...day, id: '' }] }), /identificador inválido/);
throws(() => core.validate({ version: core.VERSION, records: [{ ...day, id: 'x'.repeat(65) }] }), /identificador inválido/);
throws(() => core.validate({ version: core.VERSION, records: [{ ...day, period: 'ano' }] }), /tipo de período desconhecido \(ano\)/);
throws(() => core.validate({ version: core.VERSION, records: [{ ...day, start: '2026-02-30' }] }), /datas fora do intervalo aceite/);
throws(() => core.validate({ version: core.VERSION, records: [{ ...day, start: '2026-10-06', end: '2026-10-05' }] }), /data final é anterior à inicial/);
throws(() => core.validate({ version: core.VERSION, records: [{ ...day, period: 'day', start: '2026-10-01', end: '2026-10-05' }] }), /registo diário tem de ter a mesma data/);
throws(() => core.validate({ version: core.VERSION, records: [{ ...day, period: 'month', start: '2026-10-01', end: '2026-10-30' }] }), /mês completo/);
throws(() => core.validate({ version: core.VERSION, records: [{ ...day, entries: [{ ...day.entries[0], machine: 5 }] }] }), /tem de indicar a máquina/,
  'um lote tem de dizer em que máquina saiu');
throws(() => core.validate({ version: core.VERSION, records: [{ ...day, entries: [{ ...day.entries[0], produced: 10, rejected: 20 }] }] }), /rejeitou mais cartas do que produziu/);
throws(() => core.validate({ version: core.VERSION, records: [{ ...day, entries: [{ ...day.entries[0], planned: 0 }] }] }), /diz quantas cartas tem o lote/);
throws(() => core.validate({ version: core.VERSION, records: [{ ...day, entries: [{ ...day.entries[0], id: day.entries[1].id }, day.entries[1]] }] }), /está repetido/);
throws(() => core.validate({ version: core.VERSION, records: [{ ...day, entries: [{ ...day.entries[0], produced: 1.5 }] }] }), /as cartas produzidas tem de ser um número inteiro/);
throws(() => core.validate({ version: core.VERSION, records: [{ ...day, entries: [{ ...day.entries[0], produced: -1 }] }] }), /as cartas produzidas tem de ser um número inteiro/);
throws(() => core.validate({ version: core.VERSION, records: [{ ...day, entries: [{ ...day.entries[0], planned: core.MAX_QUANTITY + 1 }] }] }), /ultrapassa o limite de/);
throws(() => core.validate({ version: core.VERSION, records: [{ ...day, entries: [{ ...day.entries[0], produced: 10, rejected: 11, qualityRejected: 0 }] }] }), /rejeitou mais cartas do que produziu/);
throws(() => core.validate({ version: core.VERSION, records: [{ ...day, entries: [{ ...day.entries[0], produced: 10, rejected: 0, qualityRejected: 11 }] }] }), /chumbou no teste mais cartas do que produziu/);
assert.equal(core.validate({ version: core.VERSION, records: [{ ...day, machines: [{ produced: 10, rejected: 6, qualityRejected: 5 }, { produced: 0, rejected: 0, qualityRejected: 0 }] }] }).records.length, 1,
  'as duas rejeições já não se somam: o teste olha para as rejeitadas');
throws(() => core.validate({ version: core.VERSION, records: [{ ...day, entries: [{ ...day.entries[0], qualityRejected: undefined }] }] }), /as chumbadas no teste tem de ser um número inteiro/, 'falta a rejeição de qualidade: recusada');
throws(() => core.validate({ version: core.VERSION, records: [{ ...day, notes: 'x'.repeat(501) }] }), /as notas não podem ter mais de 500 caracteres/);
throws(() => core.validate({ version: core.VERSION, records: Array.from({ length: 5001 }, () => day) }), /Só são aceites 5000 registos por ficheiro/);
throws(() => core.validate({ version: core.VERSION, records: [day, { ...day, id: 'outro', period: 'range', end: '2026-10-06' }] }),
  /«05\/10\/2026» e «05\/10\/2026 – 06\/10\/2026» partilham dias\. Cada carta só pode ser contada uma vez\./, 'dias em comum');
assert.equal(core.validate({ version: core.VERSION, records: [day, { ...day, id: 'outro', start: '2026-10-06', end: '2026-10-06' }] }).records.length, 2, 'dias seguidos não chocam');
assert.deepEqual(core.validate({ version: core.VERSION, records: [day] }).records, [day], 'dados bons passam sem alterações');
assert.equal(core.validate({ version: core.VERSION, records: [] }).records.length, 0, 'estado vazio é legítimo');
console.log('· validação: 20 formas de estar errado, 20 frases específicas');

/* 10 · sobreposições: o registo em edição não choca consigo próprio */
const stored = [{ id: 'um', period: 'day', start: '2026-10-05', end: '2026-10-05', machines: [], notes: '' }];
assert.equal(core.overlapping(stored, { id: 'um', start: '2026-10-05', end: '2026-10-05' }), null);
assert.equal(core.overlapping(stored, { id: 'dois', start: '2026-10-05', end: '2026-10-07' }).id, 'um');
assert.equal(core.overlapping(stored, { id: 'dois', start: '2026-10-06', end: '2026-10-07' }), null, 'o dia a seguir é livre');
assert.equal(core.firstConflict(stored), null);
assert.equal(core.firstConflict([...stored, { id: 'dois', start: '2026-10-04', end: '2026-10-05' }]).length, 2);
console.log('· sobreposição: editar não bloqueia, invadir o vizinho sim');

/* 11 · cópias das versões 1 e 2 */
const v2 = core.migrate({
  version: 2,
  records: [
    { id: 'r1', kind: 'report', name: 'Outubro', start: '2026-10-01', end: '2026-10-31', notes: 'mês antigo', values: [{ p: 120, r: 4 }, { p: 480, r: 6 }, { p: 600, r: 10 }] },
    { id: 'r2', kind: 'daily', name: 'Dia', start: '2026-11-03', end: '2026-11-03', values: [{ p: null, r: null }, { p: 240, r: 8 }, { p: 240, r: 8 }] },
    { id: 'r3', kind: 'report', name: 'Só totais', start: '2026-12-01', end: '2026-12-31', values: [{ p: 0, r: 0 }, { p: 0, r: 0 }, { p: 900, r: 40 }] },
    { id: 'r4', kind: 'daily', name: 'Invasão', start: '2026-10-15', end: '2026-10-20', values: [{ p: 50, r: 1 }, { p: 0, r: 0 }] },
  ],
});
assert.equal(v2.version, core.VERSION);
assert.equal(v2.records.length, 3, 'o registo que invadia outro ficou de fora');
const first = v2.records[0];
assert.deepEqual({ period: first.period, start: first.start, end: first.end },
  { period: 'month', start: '2026-10-01', end: '2026-10-31' }, 'o mês antigo fica mês');
assert.deepEqual(first.entries.map((entry) => [entry.machine, entry.produced, entry.rejected, entry.qualityRejected]),
  [[0, 120, 4, 0], [1, 480, 6, 0]], 'o total declarado não é somado às máquinas: cada máquina é um lote concluído');
assert.equal(first.entries.every((entry) => entry.done), true, 'a conversão não deixa lotes por concluir');
assert.match(first.notes, /Tinha também/, 'a sobreposição fica escrita nas notas para revisão');
assert.equal(v2.records[1].period, 'day');
assert.deepEqual(v2.records[1].entries.map((entry) => [entry.machine, entry.produced, entry.rejected, entry.qualityRejected]),
  [[1, 240, 8, 0]], 'a máquina sem valores não inventa um lote');
const converted = v2.records.find((item) => item.id === 'r3');
assert.deepEqual(converted.entries.map((entry) => [entry.machine, entry.produced, entry.rejected]),
  [[0, 900, 40]], 'o total declarado entra como um lote');
assert.match(converted.notes, /Convertido do total declarado/);
assert.deepEqual(core.migrate({ version: 1, demo: false, records: [{ id: 'a', kind: 'daily', start: '2026-10-05', end: '2026-10-05', values: [{ p: 10, r: 1 }] }] }).records[0].entries
  .map((entry) => [entry.machine, entry.produced, entry.rejected, entry.qualityRejected]),
  [[0, 10, 1, 0]], 'também a versão 1 chega');
assert.throws(() => core.migrate({ version: 1, demo: true, records: [] }), /cópia é de demonstração/);
assert.throws(() => core.migrate({ version: 9, records: [] }), /versões 1, 2, 3, 4 e 5/);
assert.throws(() => core.migrate({ version: 3 }), /não tem registos para converter/);
assert.deepEqual(core.migrate('{"version":3,"records":[]}'), { version: core.VERSION, records: [], lots: [], stock: [], sideOpen: true }, 'aceita o ficheiro como texto');
assert.equal(core.migrate({ version: 5, records: [], sideOpen: false }).sideOpen, false, 'a barra recolhida é uma preferência que a cópia leva consigo');
const travada = core.migrate({ version: 3, records: [{ id: 'x', period: 'day', start: '2026-10-05', end: '2026-10-05', machines: [{ produced: 5, rejected: 9 }, { produced: 0, rejected: 0 }], notes: 'y'.repeat(70) }] }).records[0].entries[0];
assert.deepEqual([travada.produced, travada.rejected, travada.qualityRejected], [5, 5, 0], 'rejeições impossíveis são travadas na conversão');
assert.equal(core.migrate({ version: 3, records: [{ id: 'x', period: 'day', start: '2026-10-05', end: '2026-10-05', machines: [{ produced: 5, rejected: 2 }], notes: '' }] }).records[0].entries[0].qualityRejected, 0,
  'a cópia v3 não tinha rejeição de qualidade: entra a zero, não se perde nada');
assert.equal(core.migrate({ version: 5, records: [{ id: 'x', period: 'day', start: '2026-10-05', end: '2026-10-05', machines: [{ produced: 5, rejected: 1, qualityRejected: 1 }], notes: '' }] }).records[0].entries[0].qualityRejected, 1,
  'a cópia v5 conserva a rejeição de qualidade');
// e um dia já na forma nova atravessa a migração sem perder os lotes
const v6Day = core.migrate({ version: core.VERSION, records: [day] });
assert.deepEqual(v6Day.records[0].entries.map((entry) => entry.reference), ['L-2026-001', 'L-2026-002'], 'a forma nova fica como está');
console.log('· migração: v1 e v2 convertidos em lotes, sobreposições e totais declarados resolvidos');
console.log('· migração: v1 e v2 convertidos, sobreposições e totais declarados resolvidos');

/* 12 · normalizar nunca inventa números */
assert.deepEqual(core.normalize({ start: '06/10/2026', end: '01/10/2026' }).start, '2026-10-01', 'datas trocadas são postas em ordem');
assert.deepEqual([core.normalize({ start: '05/10/2026', end: '09/10/2026' }).start, core.normalize({ start: '05/10/2026', end: '09/10/2026' }).end],
  ['2026-10-05', '2026-10-09'], 'uma cópia com datas escritas é lida e convertida');
assert.equal(core.normalize({ start: '2026-10-06', end: '2026-10-01' }).period, 'range');
assert.deepEqual(core.normalize({ id: 'a', period: 'day', start: '2026-10-05', end: '2026-10-09' }), {
  id: 'a', period: 'range', start: '2026-10-05', end: '2026-10-09',
  entries: [], closed: false, notes: '',
}, 'um registo sem lotes normaliza sem inventar cartas');
assert.equal(core.normalize({ period: 'month', start: '2026-10-01', end: '2026-10-15' }).period, 'range', 'meio mês não é mês');
assert.equal(core.normalize({ start: '2026-10-05', notes: 42 }).notes, '');
assert.equal(core.normalize({ start: 'x' }).start, core.FIRST, 'data ilegível vai para o início do calendário');
console.log('· normalização: forma interna garantida a partir de qualquer origem');

/* 13 · ordenações usadas nas listas */
const list = [{ id: 'a', start: '2026-01-01' }, { id: 'b', start: '2026-03-01' }, { id: 'c', start: '2026-02-01' }];
assert.deepEqual(core.byDateDesc(list).map((item) => item.id), ['b', 'c', 'a']);
assert.deepEqual(core.byDateDesc(list).map((item) => item.id), ['b', 'c', 'a'], 'ordenar não mexe no original');
assert.equal(core.mostRecent(list).id, 'b');
assert.equal(core.mostRecent([]), null);
console.log('· listas: mais recente primeiro, sem alterar a origem');

/* 14 · CSV abre no Excel sem surpresas */
assert.equal(core.csvCell('olá'), '"olá"');
assert.equal(core.csvCell('d"e'), '"d""e"');
assert.equal(core.csvCell('=1+1'), '"\'=1+1"', 'fórmula neutralizada');
assert.equal(core.csvCell('+9'), '"\'+9"');
assert.equal(core.csvCell(null), '""');
const csv = core.buildCSV(core.summarise(state, '2026-10-01', '2026-10-31')).replace(/^\uFEFF/, '');
const lines = csv.split('\r\n');
assert.equal(lines[0], `"Sistema";"Conta Carta · INATRO, IP"`);
assert.match(lines[1], /"Período";"01\/10\/2026 a 31\/10\/2026"/);
assert.match(lines[2], /"Etiqueta";"10\/2026"/);
assert.match(lines[3], /"Nome";"Outubro de 2026"/);
assert.match(lines[4], /"Registos somados";"1"/);
assert.equal(lines[8], '"Origem";"Produzidas";"Aprovadas";"Rej. máquina";"Rej. no teste de qualidade";"Taxa de aprovação (%)"');
assert.equal(lines[9], `"Máquina 1";"500";"450";"100";"50";"90"`, 'aprovadas = 500 − 50 chumbadas no teste');
assert.equal(lines[10], '"Máquina 2";"300";"290";"20";"10";"96.7"', 'números como o Excel espera, sem separadores de milhares');
assert.equal(lines[11], '"Total";"800";"740";"120";"60";"92.5"');
assert.equal(lines[12], '');
assert.equal(lines[13], '"05/10\/2026";"800";"740";"120";"60";"92.5"');
assert.equal(lines[14], `"  Máquina 1";"500";"450";"100";"50";"90"`);
assert.equal(lines[15], `"  Máquina 2";"300";"290";"20";"10";"96.7"`);
assert.equal(core.buildCSV(core.summarise(core.emptyState(), '2026-10-01', '2026-10-31')).includes('"Total";"0";"0";"0";"0";""'), true, 'período vazio exporta linhas a zero, não as omite');
assert.ok(core.buildCSV(summary).startsWith('\uFEFF'), 'BOM para o Excel reconhecer UTF-8');
/* CSV do relatório de rejeição: mesmas linhas de cabeçalho, colunas de rejeição à frente */
const rejectionCsv = core.buildRejectionCSV(summary, 'Relatório de rejeição da máquina').replace(/^\uFEFF/, '').split('\r\n');
assert.equal(rejectionCsv[1], '"Relatório";"Relatório de rejeição da máquina"');
assert.equal(rejectionCsv[3], '"Etiqueta";"10/2026"');
assert.equal(rejectionCsv[4], '"Nome";"Outubro de 2026"');
assert.equal(rejectionCsv[9], '"Origem";"Produzidas";"Rej. máquina";"Rej. no teste de qualidade";"Taxa de rejeição da máquina (%)";"Taxa de rejeição no teste de qualidade (%)";"Taxa de aprovação (%)"');
assert.equal(rejectionCsv[10], '"Máquina 1";"500";"100";"50";"20";"10";"90"');
assert.equal(rejectionCsv[12], '"Total";"800";"120";"60";"15";"7.5";"92.5"');
assert.equal(rejectionCsv[14], '"05/10\/2026";"800";"120";"60";"15";"7.5";"92.5"');
console.log('· CSV: cabeçalho institucional, totais, taxa vazia quando não há produção');

/* 15 · ficheiros incluídos na aplicação */
assert.deepEqual(read('app/seed.json'), { version: core.VERSION, records: [], lots: [], stock: [] }, 'instalação nova começa sem registos');
const sample = read('app/sample.json');
core.validate(sample);
assert.ok(sample.records.length >= 40, 'o exemplo tem de encher o gráfico');
assert.ok(sample.records.every((item) => item.id.startsWith('exemplo-')), 'tudo o que é fictício se reconhece pelo identificador');
assert.ok(sample.records.some((item) => item.period === 'month'), 'o exemplo tem registos mensais');
assert.ok(sample.records.some((item) => item.period === 'day'), 'o exemplo tem registos diários');
const sampleTotals = sample.records.reduce((sum, item) => sum + core.totals(item).produced, 0);
assert.ok(sampleTotals > 10000, 'e volume suficiente para as percentagens fazerem sentido');
assert.equal(core.firstConflict(sample.records), null, 'o exemplo não se sobrepõe a si próprio');
console.log('· seed.json vazio e sample.json válido, com ' + sample.records.length + ' registos fictícios');

/* 15b · delegações: uma por província, e os nomes antigos encontram a sua */
const delegations = require('../app/lib/delegations.js');
assert.equal(delegations.LIST.length, 11, 'dez províncias e a Cidade de Maputo');
for (const field of ['code', 'name', 'province']) {
  assert.equal(new Set(delegations.LIST.map((entry) => entry[field])).size, 11, `nenhuma delegação repete ${field}: há uma por província`);
}
assert.deepEqual(delegations.LIST.map((entry) => entry.name), delegations.LIST.map((entry) => entry.name).sort(), 'por ordem alfabética, como se lêem numa lista');
const placeOf = (name) => { const entry = delegations.find(name); return entry ? `${entry.name} · ${entry.province}` : null; };
assert.equal(placeOf('Matola'), 'Matola · Maputo', 'na província de Maputo a delegação é a da Matola');
assert.equal(placeOf('Maputo Cidade'), 'Maputo Cidade · Maputo Cidade');
for (const entry of delegations.LIST) assert.equal(delegations.find(entry.name), entry, 'o nome do catálogo encontra-se a si próprio');
// os nomes por que as delegações já foram escritas
assert.equal(placeOf('Delegação da Beira'), 'Beira · Sofala');
assert.equal(placeOf('  DELEGAÇÃO DE XAI-XAI '), 'Xai-Xai · Gaza', 'maiúsculas, acentos e espaços não contam');
assert.equal(placeOf('Delegação de Maputo'), 'Maputo Cidade · Maputo Cidade', '«Maputo» sozinho é a cidade');
assert.equal(placeOf('Delegação Provincial de Maputo'), 'Matola · Maputo', 'a delegação provincial é a da província');
assert.equal(placeOf('Maputo Província'), 'Matola · Maputo');
assert.equal(placeOf('Província de Sofala'), 'Beira · Sofala', 'o nome da província serve');
assert.equal(placeOf('Zambezia'), 'Quelimane · Zambézia');
// os lugares que estiveram no catálogo anterior contam para a delegação da sua província
for (const [former, now] of [['Nacala', 'Nampula'], ['Boane', 'Matola'], ['Maxixe', 'Inhambane'], ['Mocuba', 'Quelimane'], ['Moatize', 'Tete'], ['Manica', 'Chimoio'], ['Dondo', 'Beira'], ['Montepuez', 'Pemba'], ['Cuamba', 'Lichinga'], ['Chibuto', 'Xai-Xai']]) {
  assert.equal(delegations.find(former).name, now, `${former} conta para ${now}`);
}
for (const unknown of ['', null, undefined, 42, 'Lisboa', 'Delegação', 'Delegação Central']) assert.equal(delegations.find(unknown), null, 'o que não se reconhece não se inventa');
// a lista de um formulário: a escolha vazia, as onze e, se for preciso, o nome antigo que já lá estava
assert.equal(delegations.choices('').length, 12);
assert.deepEqual(delegations.choices('')[0], ['', 'Escolher delegação']);
assert.ok(delegations.choices('').some(([value, text]) => value === 'Beira' && text === 'Beira (Sofala)'), 'a província vai entre parênteses');
assert.ok(delegations.choices('').some(([value, text]) => value === 'Tete' && text === 'Tete'), 'menos quando o nome já a diz');
assert.equal(delegations.choices('Beira').length, 12, 'um nome do catálogo não se repete');
assert.deepEqual(delegations.choices('Nacala')[12], ['Nacala', 'Nacala (registo anterior)'], 'abrir um registo antigo não lhe tira a delegação');
// o exemplo usa o catálogo: lotes para as onze delegações e movimentos só de lotes do exemplo
assert.deepEqual([...new Set(sample.lots.map((lot) => lot.delegation))].sort(), delegations.LIST.map((entry) => entry.name), 'o exemplo tem lotes das onze delegações');
const sampleDays = sample.records.filter((item) => item.period === 'day').flatMap((item) => item.entries);
assert.ok(sampleDays.every((entry) => delegations.LIST.some((item) => item.name === entry.delegation)), 'os lotes do dia do exemplo são de delegações do catálogo');
assert.equal(new Set(sampleDays.map((entry) => entry.delegation)).size, 11, 'e passam pelas onze');
assert.ok(sample.lots.every((lot) => lot.id.startsWith(core.SAMPLE_PREFIX)) && sample.stock.every((item) => item.id.startsWith(core.SAMPLE_PREFIX)), 'lotes e material do exemplo reconhecem-se pelo identificador');
assert.ok(sample.operations.length > 40, 'o exemplo traz movimentos para os saldos e o histórico terem que mostrar');
const sampleLotIds = new Set(sample.lots.map((lot) => lot.id));
for (const move of sample.operations) {
  assert.ok(move.id.startsWith(core.SAMPLE_PREFIX), 'os movimentos do exemplo também se reconhecem pelo identificador');
  assert.ok(move.batchId === null ? ['stock_in', 'stock_out'].includes(move.type) : sampleLotIds.has(move.batchId), 'cada movimento é do armazém ou de um lote do exemplo');
}
assert.equal(new Set(sample.operations.map((move) => move.id)).size, sample.operations.length, 'sem identificadores repetidos');
console.log('· delegações: uma por província, nomes antigos reconhecidos e o exemplo a cobrir as onze');

/* 16 · comparação: dois períodos lado a lado, e mais nada */
const pAgosto = core.comparePeriods('months', '2026-08', '2026-10');
assert.deepEqual(pAgosto.map((period) => period.short), ['08/2026', '10/2026'], 'a comparação são exactamente os dois, pela ordem escolhida, com o ano inteiro');
assert.equal(pAgosto[0].start, '2026-08-01');
assert.equal(pAgosto[1].end, '2026-10-31');
assert.deepEqual(core.comparePeriods('months', '2026-10', '2026-08').map((period) => period.key), ['2026-10', '2026-08'], 'a ordem escolhida manda: Mês 1 primeiro');
assert.throws(() => core.comparePeriods('months', '2026-09', '2026-09'), /dois meses diferentes/, 'o mesmo mês duas vezes não é comparação');
assert.throws(() => core.comparePeriods('years', 2026, 2026), /dois anos diferentes/, 'o mesmo ano duas vezes também não');
assert.throws(() => core.comparePeriods('years', 1800, 2026), /ano entre 1900 e 2200/);
assert.throws(() => core.comparePeriods('months', '2026-13', '2026-08'), /meses da comparação/);
assert.deepEqual(core.comparePeriods('years', 2025, 2026).map((period) => period.key), ['2025', '2026']);
assert.equal(core.comparePeriods('years', 2025, 2026)[0].start, '2025-01-01');
assert.equal(core.comparePeriods('years', 2025, 2026)[1].end, '2026-12-31');
assert.equal('maxCompare' in core, false, 'não há limite de sequência: não há sequência');
assert.ok(!('monthsBetween' in core) && !('yearsBetween' in core), 'a enumeração de intervalos ficou para o Período');

const compareState = {
  version: core.VERSION,
  records: [
    { id: 'c1', period: 'month', start: '2026-09-01', end: '2026-09-30', entries: asEntries([{ produced: 240, rejected: 8, qualityRejected: 2 }, { produced: 0, rejected: 0, qualityRejected: 0 }]), notes: '' },
    { id: 'c2', period: 'month', start: '2026-10-01', end: '2026-10-31', entries: asEntries([{ produced: 120, rejected: 4, qualityRejected: 1 }, { produced: 480, rejected: 6, qualityRejected: 3 }]), notes: '' },
    { id: 'c3', period: 'day', start: '2025-10-05', end: '2025-10-05', entries: asEntries([{ produced: 100, rejected: 20, qualityRejected: 5 }, { produced: 0, rejected: 0, qualityRejected: 0 }]), notes: '' },
  ],
};
const result = core.compare(compareState, core.comparePeriods('months', '2026-09', '2026-10'));
assert.equal(result.rows.length, 2);
assert.deepEqual(result.rows.map((row) => row.produced), [240, 600]);
assert.equal(result.rows[0].records, 1);
assert.equal(result.rows[0].delta, null, 'o primeiro período não tem diferença');
assert.equal(result.rows[0].qualityRejected, 2);
assert.equal(result.rows[1].delta.produced, 360);
assert.equal(result.rows[1].delta.rate, 0.1, 'a diferença da taxa são pontos percentuais, não percentagem de percentagem');
assert.equal(result.delta, result.rows[1].delta);
assert.equal(result.best.key, '2026-10');
assert.equal(result.worst.key, '2026-09');
assert.equal(result.measured, 2);
assert.equal(result.empty, false, 'a flag `empty` diz se não há nada medido em lado nenhum');
assert.deepEqual(result.series.map((point) => point.produced), [240, 600], 'duas barras, dois lados');

// o que está entre os dois não entra na conta, mesmo que lá haja registos
const farApart = core.compare(compareState, core.comparePeriods('years', 2025, 2026));
assert.deepEqual(farApart.rows.map((row) => row.produced), [100, 840], '2025 e 2026, e nada entre eles inventado');
assert.equal(farApart.series.length, 2, 'dois períodos, duas barras');
assert.equal(farApart.rows[1].delta.produced, 740);
assert.equal(farApart.rows[0].approvalRate, 95, 'só chumbam as que o teste rejeitou');
assert.equal(farApart.rows[1].approvalRate, 99.3);
assert.deepEqual(core.compareTags(farApart), ['2025', '2026']);
assert.deepEqual(core.compareTags(result), ['Setembro de 2026', 'Outubro de 2026']);

const sparse = core.compare(compareState, core.comparePeriods('months', '2026-07', '2026-10'));
assert.equal(sparse.rows.length, 2);
assert.equal(sparse.rows[0].produced, 0, 'Julho não tem nada apontado');
assert.equal(sparse.rows[0].empty, true);
assert.equal(sparse.empty, false, 'mas a comparação como um todo tem leitura');
assert.equal(sparse.rows[0].approvalRate, null, 'ausência não é zero por cento');
assert.equal(sparse.rows[1].delta.produced, 600, 'a diferença é sempre do segundo para o primeiro');
assert.equal(sparse.rows[1].delta.rate, null, 'não se mede diferença de taxa a partir do nada');
assert.equal(sparse.measured, 1);
assert.equal(sparse.worst, null, 'com um só período medido não há pior nem melhor');
assert.match(core.compareReading(sparse), /Só Outubro de 2026 tem produção/);
assert.match(core.compareReading(result), /Outubro de 2026 produziu mais 360 cartas do que Setembro de 2026; a aprovação foi de 99,2% para 99,3% \(\+0,1 p\.\)\./);
assert.match(core.compareReading(core.compare(compareState, core.comparePeriods('months', '2026-10', '2026-09'))),
  /Setembro de 2026 produziu menos 360 cartas do que Outubro de 2026/, 'a leitura acompanha a ordem escolhida');
assert.equal(core.compareReading(core.compare(core.emptyState(), core.comparePeriods('months', '2026-07', '2026-09'))), '',
  'sem nada medido, nenhuma leitura se escreve');

const previous = core.compareWithPrevious(compareState, '2026-10-01', '2026-10-31');
assert.deepEqual([previous.start, previous.end], ['2026-08-31', '2026-09-30'], 'o período anterior tem o mesmo tamanho e acaba um dia antes');
assert.equal(previous.produced, 360, 'é a diferença: 600 de Outubro menos 240 de Setembro');
assert.equal(previous.rate, 0.1, 'e a taxa também vai em pontos');
const beforeSeptember = core.compareWithPrevious(compareState, '2026-09-01', '2026-09-30');
assert.equal(beforeSeptember.empty, true, 'Agosto não tem nada apontado');
assert.equal(beforeSeptember.produced, 240, 'a diferença, sozinha, não serve para mostrar ao utilizador');
assert.equal(core.compareWithPrevious(core.emptyState(), '2026-10-01', '2026-10-31').empty, true, 'sem registos, nada há a comparar');
assert.equal(core.compareWithPrevious(core.emptyState(), '1900-01-01', '1900-01-31'), null, 'e antes da primeira data aceite não há anterior');

const compareCsv = core.buildCompareCSV(result, 'Comparação de meses · 09\/2026 × 10\/2026').replace(/^\uFEFF/, '').split('\r\n');
assert.equal(compareCsv[1], '"Comparação";"Comparação de meses · 09\/2026 × 10\/2026"');
assert.equal(compareCsv[3], '"Com registos";"2"');
assert.equal(compareCsv[5], '"Período";"Nome";"Registos";"Produzidas";"Aprovadas";"Rej. máquina";"Rej. no teste de qualidade";"Taxa de aprovação (%)";'
  + '"Variação da taxa (pontos)";"Cartas por dia";"Dias com registo";"Dias do período"');
assert.equal(compareCsv[6], '"09\/2026";"Setembro de 2026";"1";"240";"238";"8";"2";"99.2";"";"8";"30";"30"');
assert.equal(compareCsv[7], '"10\/2026";"Outubro de 2026";"1";"600";"596";"10";"4";"99.3";"0.1";"19";"31";"31"');
assert.equal(compareCsv[8], '"Diferença (2.º menos 1.º)";"";"0";"360";"358";"2";"2";"0.1";"";"11";"1";""',
  'a linha da diferença é o segundo menos o primeiro');
console.log('· comparação: dois períodos lado a lado, diferença, melhor/pior, leitura e CSV próprio');

/* 17 · os dados usados pelos testes de interface são coerentes com o núcleo */
const fixture = read('tests/fixtures/synthetic.json');
core.validate(fixture);
assert.equal(fixture.records.every((item) => typeof item.notes === 'string'), true);
console.log('· fixtures: também eles passam na validação');

/* 18 · motivos do INCAPE: só os seis que existem, só com chumbadas */
const comMotivos = core.makeRecord({
  period: 'day', start: '05/10/2026',
  entries: [{
    machine: 0, planned: '500', produced: '500', rejected: '10', qualityRejected: '5',
    reasons: [{ code: 'material-riscos', quantity: '3' }, { code: 'bio-foto', quantity: '2' }, { code: 'inventado', quantity: '9' }],
  }],
});
assert.deepEqual(comMotivos.entries[0].reasons, [{ code: 'material-riscos', quantity: 3 }, { code: 'bio-foto', quantity: 2 }],
  'só entram motivos do INCAPE e com alguma chumbada');
assert.equal(core.REASON_CODES.length, 7, 'as seis razões do INCAPE mais a saída «Outro»');
assert.ok(core.REASON_CODES.includes('outro'), 'há sempre onde registar o que não cabe nos seis');
const porMotivo = core.reasonTotals([comMotivos]);
assert.deepEqual(porMotivo.filter((reason) => reason.total).map((reason) => [reason.code, reason.total]).sort(),
  [['bio-foto', 2], ['material-riscos', 3]]);
throws(() => core.validate({ version: core.VERSION, records: [{ ...comMotivos, entries: [{ ...comMotivos.entries[0], reasons: [{ code: 'inventado', quantity: 1 }] }] }] }),
  /não é um motivo de rejeição do INCAPE/, 'motivo inventado é recusado');
console.log('· motivos: seis razões do INCAPE e «Outro», somadas por motivo e validadas');

/* 19b · peças de interface e lupa do gráfico: módulos com contrato próprio */
const ui = require(path.join(__dirname, '..', 'app', 'components', 'ui.js'));
assert.deepEqual(Object.keys(ui).sort(), ['buildTable', 'dateBox', 'dateText', 'el', 'fill', 'infoButton', 'infoIcon',
  'linkPickDate', 'linkTable', 'loadLogo', 'monthText', 'options', 'pad2', 'rateClass', 'shortStamp', 'stamp', 'stampFor', 'stripCard', 'today'].sort(),
  'o ui.js exporta só as peças de desenho');
assert.equal(ui.rateClass(null), '', 'sem taxa não há cor');
assert.equal(ui.rateClass(95), 'is-ok', 'a partir de 90 % é verde');
assert.equal(ui.rateClass(85), 'is-warn', 'entre 80 e 90 % é amarelo');
assert.equal(ui.rateClass(70), 'is-bad', 'abaixo de 80 % é vermelho');
assert.equal(ui.dateText('2026-11-16'), '16/11/2026', 'as datas escrevem-se dd/mm/aaaa');
assert.equal(ui.monthText('2026-11'), '11/2026', 'os meses escrevem-se mm/aaaa');
assert.equal(ui.shortStamp('17/11/2026, 00:14'), '17/11/2026, 00:14', 'o carimbo já escrito fica como está');
assert.match(ui.shortStamp('2026-11-17T00:14:00'), /^17\/11\/2026, 00:14$/, 'o carimbo ISO passa a dd/mm/aaaa, HH:MM');
assert.match(ui.infoIcon, /^<svg/, 'o 🛈 é o mesmo SVG em toda a aplicação');
const zoom = require(path.join(__dirname, '..', 'app', 'components', 'zoom.js'));
assert.deepEqual(Object.keys(zoom).sort(), ['attach', 'chartZoomNode', 'closeChartZoom', 'openChartZoom', 'refreshZoom',
  'resetZoom', 'resize', 'zoomBy', 'zoomPointerDown', 'zoomPointerEnd', 'zoomPointerMove', 'zoomState', 'zoomToCenter', 'zoomWheel'].sort(),
  'a lupa só mostra o gráfico e trata dos gestos');
assert.equal(zoom.zoomState.scale, 1, 'a lupa abre sempre em 100%');
const pickdate = require(path.join(__dirname, '..', 'app', 'components', 'pickdate.js'));
assert.deepEqual(Object.keys(pickdate).sort(), ['CALENDAR_ICON', 'attach', 'display', 'read'],
  'a caixa de data é uma peça só, com uma API pequena');
assert.equal(pickdate.display('date', '2026-11-16'), '16/11/2026', 'a caixa mostra o dia em dd/mm/aaaa');
assert.equal(pickdate.display('month', '2026-11'), '11/2026', 'e o mês em mm/aaaa');
assert.equal(pickdate.read('date', '16/11/2026'), '2026-11-16', 'o que se escreve volta a ISO por dentro');
assert.equal(pickdate.read('month', '11/2026'), '2026-11');
assert.equal(pickdate.read('date', '2026-11-16'), '2026-11-16', 'e a forma ISO escrita à mão também entra');
assert.equal(pickdate.read('date', '30/02/2026'), null, 'uma data que não existe é recusada');
assert.equal(pickdate.read('month', '13/2026'), null, 'um mês que não existe é recusado');
assert.match(pickdate.CALENDAR_ICON, /^<svg/, 'o ícone é o mesmo em todas as caixas');
const reportsModule = require(path.join(__dirname, '..', 'app', 'views', 'reports.js'));
['attach', 'renderReportControls', 'renderReport', 'buildReport', 'buildStockReport', 'panelReport',
  'rejectionKind', 'rejectionTitle', 'rejectionSuffix', 'reportLabel', 'comparisonTitle'].forEach((name) => {
  assert.equal(typeof reportsModule[name], 'function', `o reports.js exporta ${name}`);
});
assert.deepEqual(reportsModule.DATE_REPORTS, ['range', 'rejectionMachine', 'rejectionQuality', 'reasons', 'lots']);
assert.equal(typeof reportsModule.usePaper, 'function', 'a folha liga-se depois de construída');
console.log('· módulos: ui, caixa de data, lupa e relatórios com contrato próprio');

/* 19c · as peças novas: base, chips, form, filtro, retorno ao utilizador */
const base = require(path.join(__dirname, '..', 'app', 'lib', 'base.js'));
assert.deepEqual(Object.keys(base), ['create'], 'a base só liga módulos');
const linked = base.create('teste', { peça: 1, outra: () => 2 }, (deps) => ({ soma: deps.peça + deps.outra() }));
assert.equal(linked.soma, 3, 'liga e devolve a API do módulo com as peças já ligadas');
throws(() => base.create('falta', { peça: 1, ausente: null }, () => ({})), /«falta» ficou sem ausente/,
  'uma peça em falta é dita pelo nome, no arranque');

const chips = require(path.join(__dirname, '..', 'app', 'components', 'chips.js'));
assert.deepEqual(chips.STAGE_TONES, { feito: 'done', 'em-curso': 'live', pendente: 'todo' },
  'o tom de cada fase é o mesmo em toda a aplicação');
assert.deepEqual(chips.stageParts({ state: 'feito', updated: '2026-10-06' }, { showDate: true }), { tone: 'done', text: '2026-10-06' },
  'no quadro, uma fase feita mostra o dia em que ficou feita');
assert.deepEqual(chips.stageParts({ state: 'pendente' }), { tone: 'todo', text: 'por fazer' });
const chipsWithEl = chips.create({ el: (tag, props) => ({ tag, props }), shortDate: core.shortDate });
assert.equal(chipsWithEl.stage({ state: 'em-curso' }).props.text, 'em curso', 'a etiqueta diz «em curso»');

const formFactory = require(path.join(__dirname, '..', 'app', 'components', 'form.js'));
assert.deepEqual(Object.keys(formFactory), ['create'], 'o formulário é uma fábrica');
const formApi = formFactory.create({ document: {}, $: () => ({ hidden: false }), toast: () => {} });
assert.deepEqual(Object.keys(formApi).sort(), ['clearError', 'close', 'error', 'open', 'ready', 'submit'],
  'os três diálogos usam o mesmo contrato');
assert.equal(formApi.ready(true), true, 'com os dados abertos, o formulário abre');
assert.equal(formApi.ready(false), false, 'sem dados, o formulário não abre');

const filterModule = require(path.join(__dirname, '..', 'app', 'components', 'filter.js'));
assert.deepEqual(Object.keys(filterModule), ['create'], 'o filtro é uma fábrica ligada ao estado');
const filterState = { mode: 'month', month: '2026-10', start: '2026-10-01', end: '2026-10-31', year: '2026' };
// a caixa de data é emprestada: aqui basta um duplo que se lembra do valor
const fakeBox = (state) => {
  const box = { value: state, set: (next) => { box.value = next; }, node: { nodeType: 1 } };
  return box;
};
const fakeUi = {
  el: () => ({ nodeType: 1, append() {} }), fill: () => {}, dateText: () => '', monthText: () => '', toast: () => {},
  dateBox: (options) => fakeBox(options.value || ''),
};
const filterApi = filterModule.create({ ui: fakeUi, filter: filterState, records: () => [], onChange: () => {}, today: () => '2026-11-16' });
assert.deepEqual(Object.keys(filterApi).sort(), ['boxes', 'commit', 'label', 'period', 'render', 'setMode', 'setYear', 'step', 'wire'],
  'o filtro expõe exactamente o que a interface liga');
const filterRange = filterApi.period();
assert.deepEqual([filterRange.start, filterRange.end], ['2026-10-01', '2026-10-31'], 'o período sai em ISO, como o core o quer');
assert.equal(filterApi.label(), core.monthLabel('2026-10'), 'o rótulo é o mesmo do core, sem duplicar a regra');
assert.equal(filterApi.label(), '10/2026', 'no mês, o rótulo é mm/aaaa');

const feedback = require(path.join(__dirname, '..', 'app', 'components', 'feedback.js'));
assert.deepEqual(Object.keys(feedback), ['create'], 'o retorno ao utilizador é uma fábrica');
console.log('· peças novas: base, chips, form, filtro e retorno com contrato próprio');

/* 19d · uma regra, um sítio: fase, parte do total rejeitado e linhas da comparação */
assert.equal(core.stageText({ state: 'feito', updated: '2026-10-06' }), '06/10/2026', 'a fase feita diz o dia');
assert.equal(core.stageText({ state: 'em-curso' }), 'em curso');
assert.equal(core.stageText({ state: 'pendente' }), '—', 'o que ainda não começou fica a traço');
assert.equal(core.stageText(null), '', 'sem fase, sem texto');
const shareSource = core.summarise(fixture, '2026-10-01', '2026-10-31');
assert.equal(core.rejectionShare(shareSource, 'machine'), 50, 'metade das rejeições são da máquina');
assert.equal(core.rejectionShare(shareSource, 'quality'), 50);
assert.equal(core.rejectionShare(core.summarise(fixture, '2026-08-01', '2026-08-31'), 'machine'), null,
  'sem rejeições não há parte nenhuma a mostrar');
const compareRows = core.comparisonRows(core.compare(fixture, core.comparePeriods('months', '2026-09', '2026-10')));
assert.deepEqual(compareRows.map((row) => row.label), ['Registos', 'Produzidas', 'Aprovadas', 'Rej. máquina', 'Rej. qualidade',
  'Taxa rej. máquina', 'Taxa rej. qualidade', 'Aprovação', 'Cartas por dia', 'Dias com registo'],
  'as dez linhas da comparação, pela ordem do papel');
assert.deepEqual([compareRows[1].first, compareRows[1].second, compareRows[1].diff], ['240', '600', '+360'], 'o segundo menos o primeiro');
assert.equal(compareRows[1].good, true, 'mais produção é boa notícia');
assert.equal(compareRows[3].good, false, 'mais rejeição não é');
assert.equal(compareRows[8].diff, '+11', 'as cartas por dia também levam sinal');
console.log('· regras partilhadas: fase, parte do total rejeitado e as dez linhas da comparação');

/* 20 · o filtro do período: as setas que correm meses e anos, num módulo próprio */
const period = require(path.join(__dirname, '..', 'app', 'lib', 'period.js'));
assert.deepEqual(Object.keys(period), ['stepPeriod'], 'o período só guarda a aritmética das setas');
assert.deepEqual(period.stepPeriod({ mode: 'month', month: '2026-12' }, 1, '2026-11-16'), { month: '2027-01' },
  'a seta vira o ano quando o mês acaba');
assert.deepEqual(period.stepPeriod({ mode: 'month', month: '2026-01' }, -1, '2026-11-16'), { month: '2025-12' },
  'e volta atrás da mesma maneira');
assert.deepEqual(period.stepPeriod({ mode: 'year', year: '2026' }, -1, '2026-11-16'), { year: '2025', month: '2025-01' });
assert.deepEqual(period.stepPeriod({ mode: 'year', year: '2200' }, 1, '2026-11-16'), { year: '2200', month: '2200-01' },
  'o ano não sai dos limites da casa');
assert.deepEqual(period.stepPeriod({ mode: 'month', month: '' }, 0, '2026-11-16'), { month: '2026-11' },
  'sem período, a seta parte do mês em que se está');
console.log('· período: setas que correm meses e anos e viram a casa');

/* 20b · a barra lateral: o que o botão faz e o que mostra */
const side = require(path.join(__dirname, '..', 'app', 'lib', 'side.js'));
assert.deepEqual(side.sideState(true), { open: true, collapsed: false, label: 'Recolher a barra lateral', next: false });
assert.deepEqual(side.sideState(false), { open: false, collapsed: true, label: 'Abrir a barra lateral', next: true });
console.log('· barra lateral: recolhe e abre, com o rótulo certo');

/* 19 · lotes: personalização → impressão → qualidade → despacho */
const lote = core.makeLot({
  reference: 'L-2026-014', delegation: 'Delegação de Maputo', quantity: '1200', start: '05/10/2026',
  stages: {
    personalizacao: { state: 'feito' },
    impressao: { state: 'feito', quantity: '1180', updated: '06/10/2026' },
    qualidade: { state: 'em-curso', updated: '07/10/2026' },
  },
});
assert.equal(lote.quantity, 1200);
assert.equal(lote.stages.personalizacao.quantity, 1200, 'sem quantidade própria, a fase vale as cartas do lote');
assert.equal(lote.stages.personalizacao.updated, '2026-10-05', 'uma fase feita sem data fica com a data de abertura');
assert.equal(lote.stages.impressao.quantity, 1180);
assert.equal(lote.closed, false);
assert.equal(core.lotNextStage(lote), 'qualidade', 'a próxima fase é a primeira por fazer');
const quadro = core.lotBoard([lote, { ...lote, id: 'outro', reference: 'L-2026-015', closed: true,
  stages: { ...lote.stages, despacho: { stage: 'despacho', state: 'feito', quantity: 1200, updated: '2026-10-09', note: '' } } }], '2026-10-10');
assert.deepEqual(quadro.rows.map((row) => row.open), [0, 0, 2, 1], 'quantos lotes faltam em cada fase');
assert.equal(quadro.dispatched, 1);
assert.equal(quadro.toDispatch, 1);
throws(() => core.makeLot({ reference: '', delegation: 'x', quantity: 10, start: '05/10/2026' }), /referência do lote/);
throws(() => core.makeLot({ reference: 'L-1', delegation: '', quantity: 10, start: '05/10/2026' }), /delegação do lote/);
throws(() => core.makeLot({ reference: 'L-1', delegation: 'Maputo', quantity: '0', start: '05/10/2026' }), /pelo menos uma carta/);
throws(() => core.makeLot({ reference: 'L-1', delegation: 'Maputo', quantity: '10', start: 'ontem' }), /data de abertura do lote/);
const repetido = { version: core.VERSION, records: [], lots: [lote, { ...lote, id: 'b' }], stock: [] };
throws(() => core.validate(repetido), /referência «L-2026-014» está repetida/);
console.log('· lotes: quatro fases, quantidades por fase, quadro de trabalho e referências distintas');

/* 20 · armazém: entradas, saídas, mínimo e o que está a acabar */
const tonner = core.makeStockItem({ name: 'Tonner amarelo', kind: 'tonner', unit: 'un.', received: '22', issued: '15', minimum: '5', updated: '16/10/2026' });
assert.equal(core.stockBalance(tonner), 7);
assert.equal(core.stockLow(tonner), false, '7 acima do mínimo de 5');
const quase = core.makeStockItem({ name: 'Tonner preto', kind: 'tonner', received: '4', issued: '3', minimum: '2' });
assert.equal(core.stockLow(quase), true, '1 no armazém é alerta para um mínimo de 2');
const visao = core.stockOverview([tonner, quase, core.makeStockItem({ name: 'Cartão em branco', kind: 'cartao', received: '120000', issued: '120000' })]);
assert.deepEqual(visao.low.map((item) => item.name), ['Tonner preto']);
assert.equal(visao.cards, 0, 'os cartões em branco contam à parte');
// o quadro do contrato: contratado, entregue e o que falta entregar
const doContrato = core.makeStockItem({ name: 'Tonner amarelo', kind: 'tonner', contracted: '22', received: '15', delivered: '17/07/2026' });
assert.equal(core.stockPending(doContrato), 7, '22 contratados, 15 entregues: faltam 7');
assert.equal(core.stockPending(core.makeStockItem({ name: 'Álcool', contracted: '30', received: '30' })), 0, 'entregue tudo: nada em falta');
assert.equal(core.stockPending(core.makeStockItem({ name: 'Sem contrato', received: '5' })), 0, 'sem contratado não há nada em falta');
assert.equal(core.stockOverview([doContrato]).pending.length, 1, 'o artigo entra na lista dos que faltam chegar');
assert.equal(doContrato.delivered, '2026-07-17', 'a data da entrega fica em ISO, como as outras');
throws(() => core.makeStockItem({ name: 'Álcool', received: '1', delivered: 'ontem' }), /dd\/mm\/aaaa/);
throws(() => core.makeStockItem({ name: 'Álcool', received: '4', issued: '5' }), /não cabem em 4 recebidos/);
throws(() => core.makeStockItem({ name: '', received: '1' }), /nome do material/);
throws(() => core.makeStockItem({ name: 'Álcool', received: '1', updated: 'ontem' }), /dd\/mm\/aaaa/);
throws(() => core.validate({ version: core.VERSION, records: [], stock: [tonner, { ...tonner, id: 'b' }] }), /está repetido/);
console.log('· armazém: saldo, mínimo de alerta, cartões à parte e quantidades coerentes');

/* 21 · uma cópia v4 sobe para v6 com lotes e material vazios */
const subida = core.migrate({ version: 4, records: [{ id: 'x', period: 'day', start: '05/10/2026', end: '05/10/2026', machines: [{ produced: 10, rejected: 1, qualityRejected: 1 }], notes: '' }] });
assert.deepEqual([subida.version, subida.lots, subida.stock], [core.VERSION, [], []], 'a cópia antiga sobe sem perder registos');
assert.equal(subida.records[0].entries.length, 1, 'as máquinas da cópia v4 entram como lotes concluídos');
assert.equal(subida.records[0].start, '2026-10-05');
console.log('· migração: v4 sobe para v6 e traz lotes e material vazios');

/* 22 · um lado só: o que se repete entre os lotes e os dias fica de acordo pela mesma regra */
assert.deepEqual(core.DAY_STAGES, ['impressao', 'qualidade'], 'um dia de produção conhece duas fases: a carta sai da máquina e passa no teste');
const lado = core.makeLot({ id: 'lado', reference: 'L-LADO', delegation: 'Beira', quantity: '1000', start: '01/11/2026' });
// uma fase a partir das cartas que já passaram por ela — a mesma regra para os dias e para os movimentos
assert.deepEqual(core.stageFrom(lado, 'impressao', 0, '2026-11-03'), { stage: 'impressao', state: 'pendente', quantity: 1000, updated: '', note: '' }, 'sem cartas, a fase está por fazer e não tem data');
assert.deepEqual(core.stageFrom(lado, 'impressao', 400, '2026-11-03'), { stage: 'impressao', state: 'em-curso', quantity: 400, updated: '2026-11-03', note: '' });
assert.deepEqual(core.stageFrom(lado, 'impressao', 1000, '2026-11-04'), { stage: 'impressao', state: 'feito', quantity: 1000, updated: '2026-11-04', note: '' });
assert.equal(core.stageFrom(lado, 'impressao', 1200, '2026-11-04').quantity, 1000, 'uma fase nunca tem mais cartas do que o lote');
assert.equal(core.stageFrom({ ...lado, stages: { ...lado.stages, qualidade: { ...lado.stages.qualidade, note: 'ver com a Beira' } } }, 'qualidade', 5, '2026-11-04').note, 'ver com a Beira', 'a nota da fase fica');
assert.equal(core.makeLot({ ...lado, stages: { impressao: { state: 'em-curso', quantity: '5000' } } }).stages.impressao.quantity, 1000, 'nem quando é escrita à mão');

const apontado = (id, lotId, produced, more = {}) => core.makeEntry({ id, lotId, reference: 'escrito à mão', delegation: 'Tete', machine: 0, planned: '7', produced: String(produced), ...more });
const diaDe = (date, entries) => ({ id: `d-${date}`, period: 'day', start: date, end: date, entries, closed: false, notes: '' });
const porAcertar = {
  version: core.VERSION, sideOpen: true, stock: [],
  lots: [lado, core.makeLot({ id: 'outro', reference: 'L-OUTRO', delegation: 'Pemba', quantity: '300', start: '01/11/2026' })],
  // os dias fora de ordem, de propósito: a conta segue a ordem das datas, não a da lista
  records: [
    diaDe('2026-11-04', [apontado('e2', 'lado', 400), apontado('e3', '', 70), apontado('e4', 'já-não-existe', 30)]),
    diaDe('2026-11-03', [apontado('e1', 'lado', 600, { qualityRejected: '50', done: false })]),
  ],
};
const acertado = core.settle(porAcertar);
const linhas = (state) => state.records.flatMap((record) => record.entries).sort((a, b) => a.id.localeCompare(b.id)).map((entry) => [entry.id, entry.reference, entry.delegation, entry.planned]);
assert.deepEqual(linhas(acertado), [['e1', 'L-LADO', 'Beira', 1000], ['e2', 'L-LADO', 'Beira', 450], ['e3', 'escrito à mão', 'Tete', 7], ['e4', 'escrito à mão', 'Tete', 7]],
  'a entrada ligada a um lote diz a referência e a delegação dele e planeia o que ele ainda tinha por fazer; as outras ficam como foram escritas');
const faseDe = (state, id, stage) => { const now = state.lots.find((lot) => lot.id === id).stages[stage]; return [now.state, now.quantity, now.updated]; };
assert.deepEqual(faseDe(acertado, 'lado', 'impressao'), ['em-curso', 950, '2026-11-04'], 'impressas: as que saíram menos as chumbadas no teste');
assert.deepEqual(faseDe(acertado, 'lado', 'qualidade'), ['em-curso', 400, '2026-11-04'], 'aprovadas: as boas das entradas concluídas');
assert.deepEqual([faseDe(acertado, 'lado', 'personalizacao')[0], faseDe(acertado, 'lado', 'despacho')[0]], ['pendente', 'pendente'], 'os dias não sabem nada das outras fases');
assert.deepEqual(acertado.records.flatMap((record) => record.entries).sort((a, b) => a.id.localeCompare(b.id)).map((entry) => entry.lotId), ['lado', 'lado', '', ''],
  'a entrada que apontava um lote que já não existe fica sem ligação: continua a contar o que produziu');
assert.equal(acertado.lots[1], porAcertar.lots[1], 'um lote que nenhum dia aponta fica o mesmo objecto');
assert.equal(porAcertar.records[0].entries[0].planned, 7, 'o estado que entrou não foi alterado');
assert.equal(core.settle(acertado), acertado, 'o que já está de acordo volta tal e qual: a regra pode correr em todas as gravações');
core.validate(acertado);

// o lote completo: a impressão fica feita com a data do último dia em que saíram cartas
const completo = core.settle({ ...acertado, records: [...acertado.records, diaDe('2026-11-05', [apontado('e5', 'lado', 60, { qualityRejected: '10' })])] });
assert.deepEqual(faseDe(completo, 'lado', 'impressao'), ['feito', 1000, '2026-11-05']);
assert.equal(completo.records.find((record) => record.start === '2026-11-05').entries[0].planned, 50, 'faltavam 50 cartas boas ao lote');
// corrigir o lote corrige os dias: outra delegação e mais cartas
const corrigido = core.settle({ ...acertado, lots: acertado.lots.map((lot) => (lot.id === 'lado' ? core.makeLot({ ...lot, delegation: 'Nampula', quantity: 1200 }) : lot)) });
assert.deepEqual(linhas(corrigido).slice(0, 2), [['e1', 'L-LADO', 'Nampula', 1200], ['e2', 'L-LADO', 'Nampula', 650]]);
// uma fase com movimentos é do servidor: os dias não lhe mexem
const comMovimentos = core.settle(porAcertar, (id, stage) => id === 'lado' && stage === 'impressao');
assert.deepEqual([faseDe(comMovimentos, 'lado', 'impressao')[0], faseDe(comMovimentos, 'lado', 'qualidade')], ['pendente', ['em-curso', 400, '2026-11-04']]);
assert.deepEqual(linhas(comMovimentos).slice(0, 2), linhas(acertado).slice(0, 2), 'mas a entrada continua a dizer do lote o que o lote diz');

// o que os dias dizem de cada lote apontado neles: é daqui que o quadro e os movimentos lêem a impressão e o teste
assert.deepEqual(core.DAY_MOVES, ['printed', 'print_rejected', 'qc_approved', 'qc_rejected'], 'os movimentos que diriam o mesmo que um dia de produção');
assert.deepEqual([...core.lotDays(acertado.records)], [['lado', { produced: 1000, failed: 50, good: 950, approved: 400, printed: '2026-11-04', checked: '2026-11-04' }]],
  'saíram 1000, chumbaram 50, e só as 400 da entrada concluída estão aprovadas; as entradas sem lote do quadro não entram');
assert.equal(core.lotDays([]).size, 0);
assert.equal(core.lotDays(undefined).size, 0);

// o livro dos lotes sabe de onde vem cada fase, pelo que o servidor lhe diz dos movimentos
const lotBook = require(path.join(__dirname, '..', 'app', 'lib', 'lotbook.js')).create({ app: { state: acertado }, save: async () => true, nextState: (change) => change, confirm: () => {}, render: () => {} });
const [ladoNow, outroNow] = acertado.lots;
assert.deepEqual(core.LOT_STAGES.map((stage) => lotBook.source(ladoNow, stage)), ['', 'dias', 'dias', ''], 'sem movimentos: a impressão e a qualidade do lote apontado são as dos dias, o resto escreve-se');
assert.deepEqual(core.LOT_STAGES.map((stage) => lotBook.source(outroNow, stage)), ['', '', '', '']);
assert.deepEqual([lotBook.refusal(ladoNow), lotBook.refusal(outroNow)], ['', ''], 'e qualquer um se pode apontar num dia');
lotBook.track([{ id: 'lado', driven: ['personalizacao', 'despacho'], byMoves: false }, { id: 'outro', driven: core.LOT_STAGES, byMoves: true }]);
assert.deepEqual(core.LOT_STAGES.map((stage) => lotBook.source(ladoNow, stage)), ['movimentos', 'dias', 'dias', 'movimentos']);
assert.deepEqual(core.LOT_STAGES.map((stage) => lotBook.source(outroNow, stage)), ['movimentos', 'movimentos', 'movimentos', 'movimentos']);
assert.equal(lotBook.refusal(ladoNow), '');
assert.equal(lotBook.refusal(outroNow), 'O lote L-OUTRO regista a impressão nos movimentos do Painel: não se aponta outra vez nos dias de produção.',
  'um lote com a impressão nos movimentos não se aponta nos dias: a mesma carta não se regista duas vezes');
lotBook.track(null);
assert.equal(lotBook.refusal(outroNow), '', 'sem servidor que guarde movimentos, nada fica travado');

// as cartas boas que o lote já tinha antes de uma entrada, ou antes de uma nova no fim de um dia
assert.equal(core.lotGoodBefore(acertado.records, 'lado', '2026-11-03', 'e1'), 0);
assert.equal(core.lotGoodBefore(acertado.records, 'lado', '2026-11-04', 'e2'), 550);
assert.equal(core.lotGoodBefore(acertado.records, 'lado', '2026-11-04', null), 950, 'uma entrada nova conta com tudo o que o lote fez até ao fim desse dia');
assert.equal(core.lotGoodBefore(acertado.records, 'lado', '2026-11-03', null), 550);
assert.equal(core.lotGoodBefore(acertado.records, 'lado', '2026-11-02', null), 0, 'antes do primeiro dia o lote não tinha nada');
assert.equal(core.lotGoodBefore(acertado.records, 'outro', '2026-11-30', null), 0);

// o contrato: o mesmo material escrito de outra maneira é o mesmo material
const meuArmazem = [{ name: 'cartão em branco — carta de condução' }, { name: 'TONNER AMARELO (MB-Ink-E-WF-alf-H-D-Y-yellow)' }, { name: 'Álcool' }];
const porOferecer = core.catalogueGaps(meuArmazem);
assert.equal(porOferecer.length, core.CATALOGUE.length - 2, 'os dois que já lá estão não se oferecem outra vez, mesmo com outras maiúsculas e outros sinais');
assert.ok(porOferecer.some((entry) => entry.name === 'Álcool (Garrafa de 1L)'), 'um nome parecido não é o mesmo material');
assert.deepEqual([porOferecer[0].id, porOferecer[0].index, porOferecer[0].name], ['contrato-03', 2, core.CATALOGUE[2].name]);
assert.equal(core.catalogueGaps([]).length, 25);

// a fechadura: o que vem de uma lista abre trancado, e só o interruptor o abre
const lockPieces = { set: { disabled: false }, toggle: { checked: false, disabled: false, addEventListener(type, run) { this.run = run; } }, wrap: { hidden: false } };
const previousDocument = globalThis.document;
globalThis.document = { getElementById: (id) => lockPieces[id] };
const lockModule = require(path.join(__dirname, '..', 'app', 'components', 'lock.js'));
assert.deepEqual(Object.keys(lockModule), ['create'], 'a fechadura é uma fábrica: uma peça para os três formulários');
const changes = [];
const fechadura = lockModule.create({ set: 'set', toggle: 'toggle', wrap: 'wrap', onChange: (on) => changes.push(on) });
assert.deepEqual(Object.keys(fechadura).sort(), ['editing', 'freeze', 'guard', 'guarded', 'wire']);
fechadura.wire();
const lockState = () => [lockPieces.set.disabled, lockPieces.wrap.hidden, lockPieces.toggle.checked, lockPieces.toggle.disabled];
fechadura.guard(false);
assert.deepEqual(lockState(), [false, true, false, false], 'sem nada vindo de uma lista, os campos escrevem-se e o interruptor não aparece');
fechadura.guard(true);
assert.deepEqual(lockState(), [true, false, false, false], 'o que vem de uma lista fica trancado, com o interruptor à vista e desligado');
lockPieces.toggle.checked = true;
lockPieces.toggle.run();
assert.deepEqual([lockState(), fechadura.editing(), changes], [[false, false, true, false], true, [true]], 'ligar o interruptor abre os campos e avisa quem usa');
fechadura.guard(true);
assert.deepEqual([lockState(), fechadura.editing()], [[true, false, false, false], false], 'trancar outra vez desliga sempre o interruptor');
lockPieces.toggle.checked = true;
lockPieces.toggle.run();
fechadura.freeze(true);
assert.deepEqual(lockState(), [true, false, true, true], 'num dia terminado fica tudo parado, interruptor incluído');
fechadura.freeze(false);
assert.deepEqual(lockState(), [false, false, true, false], 'e volta ao que estava');
fechadura.guard(false);
lockPieces.toggle.checked = true;
assert.equal(fechadura.editing(), false, 'sem nada trancado não há correcção nenhuma, esteja o interruptor como estiver');
globalThis.document = previousDocument;
console.log('· um lado só: dias e lotes de acordo pela mesma regra, contrato sem repetidos e fechadura');

console.log('\nNúcleo verificado: datas, cálculos, validação, migração, exportação e comparação.');
