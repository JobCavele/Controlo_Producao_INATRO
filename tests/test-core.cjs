/*
 * Testes do núcleo de dados (dist/core.js).
 * Correm com `node tests/test-core.cjs` — sem dependências externas.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../dist/core.js');

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
assert.equal(core.isDate('1899-12-31'), false, 'antes de 1900 não se aceita');
assert.equal(core.isDate('2201-01-01'), false, 'depois de 2200 não se aceita');
assert.equal(core.isDate(null), false);
assert.equal(core.isMonth('2026-11'), true);
assert.equal(core.isMonth('2026-11-02'), false);
assert.equal(core.isMonth('2026-00'), false);
assert.equal(core.addDays('2026-12-30', 3), '2027-01-02', 'passa o ano sem deslizar');
assert.equal(core.addDays('2026-02-27', 2), '2026-03-01');
assert.equal(core.daysBetween('2026-10-01', '2026-10-31'), 31);
assert.equal(core.daysBetween('2026-10-05', '2026-10-05'), 1);
assert.equal(core.weekday('2026-11-12'), 3, 'quinta-feira');
assert.equal(core.weekday('2026-11-15'), 6, 'domingo é o último dia da semana');
console.log('· datas válidas, bissexto, limites e semana de segunda a domingo');

/* 2 · meses e semanas completos */
assert.deepEqual(core.monthRange('2026-02'), { start: '2026-02-01', end: '2026-02-28', days: 28, label: 'Fevereiro de 2026' });
assert.equal(core.monthRange('2028-02').days, 29);
assert.equal(core.monthRange('2026-12').end, '2026-12-31');
assert.equal(core.daysInMonth('2026-04'), 30);
assert.equal(core.shiftMonth('2026-12', 1), '2027-01');
assert.equal(core.shiftMonth('2027-01', -1), '2026-12');
assert.equal(core.shiftMonth('2026-01', -12), '2025-01');
assert.deepEqual(core.weekRange('2026-11-12'), { start: '2026-11-09', end: '2026-11-15', days: 7, label: 'Semana de 9 nov. 2026' });
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
assert.equal(core.shortDate('2026-10-05'), '5 out. 2026');
assert.equal(core.longDate('2026-10-05'), '5 de outubro de 2026');
assert.equal(core.monthLabel('2026-01'), 'Janeiro de 2026');
assert.equal(core.periodLabel('2026-10-05', '2026-10-05'), '5 out. 2026');
assert.equal(core.periodLabel('2026-10-01', '2026-10-31'), 'Outubro de 2026', 'mês inteiro aparece pelo nome');
assert.equal(core.periodLabel('2026-10-25', '2026-11-03'), '25 out. 2026 – 3 nov. 2026');
assert.equal(core.weekLabel('2026-11-12'), 'Quinta, 12 nov. 2026');
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

/* 5 · registo construído a partir do formulário */
const day = record({ machines: [{ produced: '500', rejected: '100' }, { produced: '', rejected: '' }] });
assert.equal(day.period, 'day');
assert.equal(day.end, day.start, 'um dia começa e acaba na mesma data');
assert.deepEqual(day.machines, [{ produced: 500, rejected: 100 }, { produced: 0, rejected: 0 }]);
assert.equal(day.notes, '');
assert.match(day.id, /.+/, 'todo o registo nasce com identificador');
const monthlyRecord = core.makeRecord({ period: 'month', start: '2026-02', machines: [{ produced: 10, rejected: 1 }] });
assert.deepEqual(
  { period: monthlyRecord.period, start: monthlyRecord.start, end: monthlyRecord.end, machines: monthlyRecord.machines, notes: monthlyRecord.notes },
  { period: 'month', start: '2026-02-01', end: '2026-02-28', machines: [{ produced: 10, rejected: 1 }, { produced: 0, rejected: 0 }], notes: '' },
);
assert.notEqual(monthlyRecord.id, core.makeRecord({ period: 'month', start: '2026-02' }).id, 'identificadores não se repetem');
assert.equal(core.makeRecord({ period: 'range', start: '2026-10-05', end: '2026-10-09' }).period, 'range');
assert.equal(core.makeRecord({ period: 'dia-solto', start: '2026-10-05' }).period, 'day', 'período desconhecido volta a dia');
throws(() => core.makeRecord({ period: 'month', start: '2026-10-05' }), /Escolhe o mês do registo na lista de meses/);
throws(() => core.makeRecord({ period: 'day', start: 'não' }), /Escolhe uma data de início válida/);
throws(() => core.makeRecord({ period: 'range', start: '2026-10-09', end: '2026-10-05' }), /data final não pode ser anterior/);
throws(() => record({ machines: [{ produced: 100, rejected: 120 }] }),
  /Máquina 1: 120 rejeitadas não cabem em 100 produzidas\. Corrige uma das duas quantidades\./);
const longNotes = 'a'.repeat(600);
assert.equal(core.makeRecord({ period: 'day', start: '2026-10-05', notes: longNotes }).notes.length, 500, 'notas cortadas no limite');
console.log('· formulário: dia, mês, intervalo e erros de digitação');

/* 6 · totais derivados: aprovadas nunca se digitam */
const totals = core.totals({ start: '2026-10-01', end: '2026-10-04', machines: [{ produced: 300, rejected: 30 }, { produced: 200, rejected: 50 }] });
assert.deepEqual(
  { produced: totals.produced, rejected: totals.rejected, approved: totals.approved, days: totals.days, perDay: totals.perDay },
  { produced: 500, rejected: 80, approved: 420, days: 4, perDay: 125 },
);
assert.equal(totals.approvalRate, 84);
assert.equal(totals.rejectionRate, 16);
assert.deepEqual(totals.machines[0], { produced: 300, rejected: 30, approved: 270, approvalRate: 90 });
assert.equal(core.totals({ start: '2026-10-01', end: '2026-10-01', machines: [{ produced: 0, rejected: 0 }, { produced: 0, rejected: 0 }] }).approvalRate, null);
assert.equal(core.totals({ start: '2026-10-01', end: '2026-10-01', machines: [] }).machines.length, 2, 'faltam as duas máquinas na conta');
console.log('· totais: aprovadas, taxas por máquina e por dia');

/* 7 · um registo só conta se couber inteiro no período */
const state = {
  version: core.VERSION,
  records: [
    { id: 'fora-antes', period: 'range', start: '2026-09-20', end: '2026-09-30', machines: [{ produced: 100, rejected: 10 }, { produced: 0, rejected: 0 }], notes: '' },
    { id: 'fora-depois', period: 'range', start: '2026-11-01', end: '2026-11-20', machines: [{ produced: 100, rejected: 10 }, { produced: 0, rejected: 0 }], notes: '' },
    { id: 'dentro-dia', period: 'day', start: '2026-10-05', end: '2026-10-05', machines: [{ produced: 500, rejected: 100 }, { produced: 300, rejected: 20 }], notes: '' },
    { id: 'meio', period: 'range', start: '2026-10-20', end: '2026-11-10', machines: [{ produced: 900, rejected: 90 }, { produced: 0, rejected: 0 }], notes: '' },
  ],
};
const chosen = core.selectRecords(state.records, '2026-10-01', '2026-10-31');
assert.deepEqual(chosen.included.map((item) => item.id), ['dentro-dia'], 'só entra o que está inteiro no mês');
assert.deepEqual(chosen.partial.map((item) => item.id), ['meio'], 'só se avisa quem toca o período');
assert.deepEqual(chosen.included.concat(chosen.partial).map((item) => item.id).sort(), ['dentro-dia', 'meio'], 'o que está longe nem aparece');
const summary = core.summarise(state, '2026-10-01', '2026-10-31');
assert.deepEqual({ produced: summary.produced, approved: summary.approved, rejected: summary.rejected }, { produced: 800, approved: 680, rejected: 120 });
assert.equal(summary.approvalRate, 85);
assert.equal(summary.records.length, 1);
assert.equal(summary.outside.length, 1, 'avisa-se que há um registo a tocar o período');
assert.deepEqual({ start: summary.start, end: summary.end, days: summary.days, daysCovered: summary.daysCovered }, { start: '2026-10-01', end: '2026-10-31', days: 31, daysCovered: 1 });
assert.deepEqual(summary.machines[1], { produced: 300, rejected: 20, approved: 280, approvalRate: 93.3 });
assert.equal(core.summarise(core.emptyState(), '2026-10-01', '2026-10-31').empty, true);
assert.equal(core.summarise(state, '2026-10-05', '2026-10-05').daysCovered, 1, 'cobertura nunca ultrapassa o período');
console.log('· período: inclusão total, fora-do-período e cobertura de dias');

/* 8 · séries do gráfico */
const monthly = core.series(state, '2026-09-01', '2026-11-30', 'month');
assert.deepEqual(monthly.map((point) => point.label), ['Set', 'Out', 'Nov']);
assert.equal(monthly[1].produced, 800);
assert.equal(monthly[2].produced, 100, 'o mês a meio de um registo conta o que coube');
assert.equal(monthly[0].full, 'Setembro de 2026');
const perRecord = core.series(state, '2026-10-01', '2026-10-31', 'record');
assert.deepEqual(perRecord.map((point) => point.full), ['5 out. 2026']);
assert.deepEqual(perRecord.map((point) => point.produced), [800]);
assert.deepEqual(core.series(state, '2026-12-01', '2026-12-31', 'month'), [
  { full: 'Dezembro de 2026', label: 'Dez', produced: 0, approved: 0, rejected: 0, approvalRate: null },
]);
console.log('· gráfico: visão mensal e visão por registo');

/* 9 · validação: cada erro diz o que corrigir */
throws(() => core.validate(null), /Os dados não foram reconhecidos\. Importa uma cópia exportada pelo Conta Carta\./);
throws(() => core.validate({ version: 2, records: [] }), /versão anterior \(v2\)/);
throws(() => core.validate({ version: 3 }), /A cópia não tem uma lista de registos\./);
throws(() => core.validate({ version: 3, records: [42] }), /Registo 1: formato inválido\./);
const twin = core.normalize(day);
throws(() => core.validate({ version: 3, records: [twin, { ...twin, id: twin.id, notes: 'outro' }] }),
  /Registo 2: o identificador está repetido na cópia\./, 'mesmo identificador duas vezes');
throws(() => core.validate({ version: 3, records: [{ ...day, id: '' }] }), /identificador inválido/);
throws(() => core.validate({ version: 3, records: [{ ...day, id: 'x'.repeat(65) }] }), /identificador inválido/);
throws(() => core.validate({ version: 3, records: [{ ...day, period: 'ano' }] }), /tipo de período desconhecido \(ano\)/);
throws(() => core.validate({ version: 3, records: [{ ...day, start: '2026-02-30' }] }), /datas fora do intervalo aceite/);
throws(() => core.validate({ version: 3, records: [{ ...day, start: '2026-10-06', end: '2026-10-05' }] }), /data final é anterior à inicial/);
throws(() => core.validate({ version: 3, records: [{ ...day, period: 'day', start: '2026-10-01', end: '2026-10-05' }] }), /registo diário tem de ter a mesma data/);
throws(() => core.validate({ version: 3, records: [{ ...day, period: 'month', start: '2026-10-01', end: '2026-10-30' }] }), /mês completo/);
throws(() => core.validate({ version: 3, records: [{ ...day, machines: [{ produced: 1, rejected: 0 }] }] }), /são necessários valores das 2 máquinas/);
throws(() => core.validate({ version: 3, records: [{ ...day, machines: [{ produced: 1.5, rejected: 0 }, { produced: 0, rejected: 0 }] }] }), /valor de produção inválido \(1\.5\)/);
throws(() => core.validate({ version: 3, records: [{ ...day, machines: [{ produced: -1, rejected: 0 }, { produced: 0, rejected: 0 }] }] }), /valor de produção inválido \(-1\)/);
throws(() => core.validate({ version: 3, records: [{ ...day, machines: [{ produced: core.MAX_QUANTITY + 1, rejected: 0 }, { produced: 0, rejected: 0 }] }] }), /ultrapassa o limite de/);
throws(() => core.validate({ version: 3, records: [{ ...day, machines: [{ produced: 10, rejected: 11 }, { produced: 0, rejected: 0 }] }] }), /Máquina 1 rejeitou mais cartas do que produziu/);
throws(() => core.validate({ version: 3, records: [{ ...day, notes: 'x'.repeat(501) }] }), /as notas não podem ter mais de 500 caracteres/);
throws(() => core.validate({ version: 3, records: Array.from({ length: 5001 }, () => day) }), /Só são aceites 5000 registos por ficheiro/);
throws(() => core.validate({ version: 3, records: [day, { ...day, id: 'outro', period: 'range', end: '2026-10-06' }] }),
  /«5 out\. 2026» e «5 out\. 2026 – 6 out\. 2026» partilham dias\. Cada carta só pode ser contada uma vez\./, 'dias em comum');
assert.equal(core.validate({ version: 3, records: [day, { ...day, id: 'outro', start: '2026-10-06', end: '2026-10-06' }] }).records.length, 2, 'dias seguidos não chocam');
assert.deepEqual(core.validate({ version: 3, records: [day] }).records, [day], 'dados bons passam sem alterações');
assert.equal(core.validate({ version: 3, records: [] }).records.length, 0, 'estado vazio é legítimo');
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
assert.deepEqual({ period: first.period, start: first.start, end: first.end, machines: first.machines },
  { period: 'month', start: '2026-10-01', end: '2026-10-31', machines: [{ produced: 120, rejected: 4 }, { produced: 480, rejected: 6 }] },
  'o total declarado não é somado às máquinas');
assert.match(first.notes, /Tinha também/, 'a sobreposição fica escrita nas notas para revisão');
assert.equal(v2.records[1].period, 'day');
assert.deepEqual(v2.records[1].machines, [{ produced: 0, rejected: 0 }, { produced: 240, rejected: 8 }], 'desconhecido deixa de ser número');
const converted = v2.records.find((item) => item.id === 'r3');
assert.deepEqual(converted.machines, [{ produced: 900, rejected: 40 }, { produced: 0, rejected: 0 }]);
assert.match(converted.notes, /Convertido do total declarado/);
assert.deepEqual(core.migrate({ version: 1, demo: false, records: [{ id: 'a', kind: 'daily', start: '2026-10-05', end: '2026-10-05', values: [{ p: 10, r: 1 }] }] }).records[0].machines,
  [{ produced: 10, rejected: 1 }, { produced: 0, rejected: 0 }], 'também a versão 1 chega');
assert.throws(() => core.migrate({ version: 1, demo: true, records: [] }), /cópia é de demonstração/);
assert.throws(() => core.migrate({ version: 9, records: [] }), /versões 1, 2 e 3/);
assert.throws(() => core.migrate({ version: 3 }), /não tem registos para converter/);
assert.deepEqual(core.migrate('{"version":3,"records":[]}'), { version: 3, records: [] }, 'aceita o ficheiro como texto');
assert.deepEqual(core.migrate({ version: 3, records: [{ id: 'x', period: 'day', start: '2026-10-05', end: '2026-10-05', machines: [{ produced: 5, rejected: 9 }, { produced: 0, rejected: 0 }], notes: 'y'.repeat(70) }] }).records[0].machines[0],
  { produced: 5, rejected: 5 }, 'rejeições impossíveis são travadas na conversão');
console.log('· migração: v1 e v2 convertidos, sobreposições e totais declarados resolvidos');

/* 12 · normalizar nunca inventa números */
assert.deepEqual(core.normalize({ start: '2026-10-06', end: '2026-10-01' }).start, '2026-10-01', 'datas trocadas são postas em ordem');
assert.equal(core.normalize({ start: '2026-10-06', end: '2026-10-01' }).period, 'range');
assert.deepEqual(core.normalize({ id: 'a', period: 'day', start: '2026-10-05', end: '2026-10-09' }), {
  id: 'a', period: 'range', start: '2026-10-05', end: '2026-10-09',
  machines: [{ produced: 0, rejected: 0 }, { produced: 0, rejected: 0 }], notes: '',
});
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
assert.match(lines[1], /"Período";"2026-10-01 a 2026-10-31"/);
assert.match(lines[2], /"Etiqueta";"Outubro de 2026"/);
assert.match(lines[3], /"Registos somados";"1"/);
assert.equal(lines[7], '"Origem";"Produzidas";"Aprovadas";"Rejeitadas";"Taxa de aprovação (%)"');
assert.equal(lines[8], `"Máquina 1";"500";"400";"100";"80"`);
assert.equal(lines[9], '"Máquina 2";"300";"280";"20";"93.3"', 'números como o Excel espera, sem separadores de milhares');
assert.equal(lines[10], '"Total";"800";"680";"120";"85"');
assert.equal(lines[11], '');
assert.equal(lines[12], '"5 out. 2026";"800";"680";"120";"85"');
assert.equal(lines[13], `"  Máquina 1";"500";"400";"100";"80"`);
assert.equal(core.buildCSV(core.summarise(core.emptyState(), '2026-10-01', '2026-10-31')).includes('"Total";"0";"0";"0";""'), true, 'período vazio exporta linhas a zero, não as omite');
assert.ok(core.buildCSV(summary).startsWith('\uFEFF'), 'BOM para o Excel reconhecer UTF-8');
console.log('· CSV: cabeçalho institucional, totais, taxa vazia quando não há produção');

/* 15 · ficheiros incluídos na aplicação */
assert.deepEqual(read('dist/seed.json'), { version: core.VERSION, records: [] }, 'instalação nova começa sem registos');
const sample = read('dist/sample.json');
core.validate(sample);
assert.ok(sample.records.length >= 40, 'o exemplo tem de encher o gráfico');
assert.ok(sample.records.every((item) => item.id.startsWith('exemplo-')), 'tudo o que é fictício se reconhece pelo identificador');
assert.ok(sample.records.some((item) => item.period === 'month'), 'o exemplo tem registos mensais');
assert.ok(sample.records.some((item) => item.period === 'day'), 'o exemplo tem registos diários');
const sampleTotals = sample.records.reduce((sum, item) => sum + core.totals(item).produced, 0);
assert.ok(sampleTotals > 10000, 'e volume suficiente para as percentagens fazerem sentido');
assert.equal(core.firstConflict(sample.records), null, 'o exemplo não se sobrepõe a si próprio');
console.log('· seed.json vazio e sample.json válido, com ' + sample.records.length + ' registos fictícios');

/* 16 · comparação de meses e de anos */
assert.deepEqual(core.monthsBetween('2026-10', '2026-08'), ['2026-08', '2026-09', '2026-10'], 'a ordem dos campos não altera a sequência');
assert.equal(core.monthsBetween('2026-01', '2026-12').length, 12);
assert.throws(() => core.monthsBetween('2023-01', '2026-12'), /Compara no máximo 36/, 'a comparação longa demais é recusada');
assert.deepEqual(core.yearsBetween(2027, 2025), [2025, 2026, 2027]);
assert.throws(() => core.yearsBetween(2010, 2025), /no máximo 12/, 'no máximo doze anos de cada vez');
assert.throws(() => core.yearRange(1800), /ano/);
const periods = core.comparePeriods('months', '2026-08', '2026-10', {});
assert.deepEqual(periods.map((period) => period.short), ['Ago 26', 'Set 26', 'Out 26']);
assert.equal(periods[1].start, '2026-09-01');
assert.equal(periods[2].end, '2026-10-31');
assert.equal(core.comparePeriods('months', '2026-07', '2026-10', { onlyExtremes: true }).map((period) => period.key).join(), '2026-07,2026-10',
  'só as duas pontas do intervalo');
assert.equal(core.comparePeriods('months', '2026-09', '2026-09', { onlyExtremes: true }).length, 1, 'um mês só, comparado consigo mesmo, é um período');

const compareState = {
  version: 3,
  records: [
    { id: 'c1', period: 'month', start: '2026-09-01', end: '2026-09-30', machines: [{ produced: 240, rejected: 8 }, { produced: 0, rejected: 0 }], notes: '' },
    { id: 'c2', period: 'month', start: '2026-10-01', end: '2026-10-31', machines: [{ produced: 120, rejected: 4 }, { produced: 480, rejected: 6 }], notes: '' },
    { id: 'c3', period: 'day', start: '2025-10-05', end: '2025-10-05', machines: [{ produced: 100, rejected: 20 }, { produced: 0, rejected: 0 }], notes: '' },
  ],
};
const result = core.compare(compareState, core.comparePeriods('months', '2026-09', '2026-10', {}));
assert.equal(result.rows.length, 2);
assert.deepEqual(result.rows.map((row) => row.produced), [240, 600]);
assert.equal(result.rows[0].records, 1);
assert.equal(result.rows[0].delta, null, 'o primeiro período não tem anterior');
assert.equal(result.rows[1].delta.produced, 360);
assert.equal(result.rows[1].delta.rate, 1.6, 'a variação da taxa são pontos percentuais, não percentagem de percentagem');
assert.equal(result.total.produced, 840);
assert.equal(result.total.records, 2);
assert.equal(result.total.daysCovered, 61, 'os dias com registo somam-se, sem contar o mesmo dia duas vezes');
assert.equal(result.best.key, '2026-10');
assert.equal(result.worst.key, '2026-09');
assert.equal(result.measured, 2);
assert.equal(result.empty, false, 'a flag `empty` diz se não há nada medido em lado nenhum');
assert.deepEqual(result.series.map((point) => point.produced), [240, 600]);

const sparse = core.compare(compareState, core.comparePeriods('months', '2026-07', '2026-10', { onlyExtremes: true }));
assert.equal(sparse.rows.length, 2);
assert.equal(sparse.rows[0].produced, 0, 'Julho não tem nada apontado');
assert.equal(sparse.rows[0].empty, true);
assert.equal(sparse.empty, false, 'mas a comparação como um todo tem leitura');
assert.equal(sparse.rows[0].approvalRate, null, 'ausência não é zero por cento');
assert.equal(sparse.rows[1].delta.produced, 600, 'a variação é sempre face ao período anterior da sequência');
assert.equal(sparse.rows[1].delta.rate, null, 'não se mede variação de taxa a partir do nada');
assert.equal(sparse.measured, 1);
assert.equal(sparse.worst, null, 'com um só período medido não há pior nem melhor');
assert.match(core.compareReading(sparse), /Só Outubro de 2026 tem produção/);
assert.match(core.compareReading(result), /Melhor aprovação em Outubro de 2026 \(98,3%\); a mais baixa é Setembro de 2026 \(96,7%\) — diferença de 1,6 pontos\./);
assert.equal(core.compareReading(core.compare(core.emptyState(), core.comparePeriods('months', '2026-07', '2026-09', {}))), '',
  'sem nada medido, nenhuma leitura se escreve');

const yearly = core.compare(compareState, core.comparePeriods('years', 2025, 2026, {}));
assert.deepEqual(yearly.rows.map((row) => row.produced), [100, 840]);
assert.equal(yearly.rows[1].delta.produced, 740);
assert.equal(yearly.rows[0].approvalRate, 80);
assert.equal(yearly.rows[1].approvalRate, 97.9);

const previous = core.compareWithPrevious(compareState, '2026-10-01', '2026-10-31');
assert.deepEqual([previous.start, previous.end], ['2026-08-31', '2026-09-30'], 'o período anterior tem o mesmo tamanho e acaba um dia antes');
assert.equal(previous.produced, 360, 'é a diferença: 600 de Outubro menos 240 de Setembro');
assert.equal(previous.rate, 1.6, 'e a taxa também vai em pontos');
const beforeSeptember = core.compareWithPrevious(compareState, '2026-09-01', '2026-09-30');
assert.equal(beforeSeptember.empty, true, 'Agosto não tem nada apontado');
assert.equal(beforeSeptember.produced, 240, 'a diferença, sozinha, não serve para mostrar ao utilizador');
assert.equal(core.compareWithPrevious(core.emptyState(), '2026-10-01', '2026-10-31').empty, true, 'sem registos, nada há a comparar');
assert.equal(core.compareWithPrevious(core.emptyState(), '1900-01-01', '1900-01-31'), null, 'e antes da primeira data aceite não há anterior');

const compareCsv = core.buildCompareCSV(result, 'Comparação de meses · Setembro de 2026 – Outubro de 2026').replace(/^\uFEFF/, '').split('\r\n');
assert.equal(compareCsv[1], '"Comparação";"Comparação de meses · Setembro de 2026 – Outubro de 2026"');
assert.equal(compareCsv[3], '"Períodos";"2"');
assert.equal(compareCsv[6], '"Período";"Registos";"Produzidas";"Aprovadas";"Rejeitadas";"Taxa de aprovação (%)";'
  + '"Variação da taxa (pontos)";"Cartas por dia";"Dias com registo";"Dias do período"');
assert.equal(compareCsv[7], '"Setembro de 2026";"1";"240";"232";"8";"96.7";"";"8";"30";"30"');
assert.equal(compareCsv[8], '"Outubro de 2026";"1";"600";"590";"10";"98.3";"1.6";"19";"31";"31"');
assert.equal(compareCsv[9], '"Total comparado";"2";"840";"822";"18";"97.9";"";"";"61";"61"');
console.log('· comparação: sequências, variação, melhor/pior, leitura e CSV próprio');

/* 17 · os dados usados pelos testes de interface são coerentes com o núcleo */
const fixture = read('tests/fixtures/synthetic.json');
core.validate(fixture);
assert.equal(fixture.records.every((item) => typeof item.notes === 'string'), true);
console.log('· fixtures: também eles passam na validação');

console.log('\nNúcleo verificado: datas, cálculos, validação, migração, exportação e comparação.');
