'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function screen(dependencies = {}) {
  const nodes = new Map();
  function makeNode(tag = 'div') {
    return {
      tag, value: '', textContent: '', hidden: false, disabled: false, required: false,
      children: [], attributes: {}, firstChild: { textContent: '' }, style: { setProperty() {} },
      parentElement: { firstChild: { textContent: '' } }, classList: { toggle() {}, contains() { return false; } },
      setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; },
      append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
      addEventListener() {}, dispatchEvent() {}, querySelector() { return makeNode('option'); }, reset() {}, focus() {},
      setCustomValidity(message) { this.validationMessage = message; },
    };
  }
  const $ = (id) => { if (!nodes.has(id)) nodes.set(id, makeNode()); return nodes.get(id); };
  const context = {
    window: { ContaCartaDates: require('../app/components/dates'),
      ContaCartaSlideshow: { FADE_MS: 0, create: () => ({ stop() {}, setRows() {}, setSeconds() {}, setVisible() {} }) },
      addEventListener() {}, scrollTo() {},
    },
    document: { getElementById: $, createElement: makeNode, createElementNS: (space, tag) => makeNode(tag), querySelectorAll: () => [], addEventListener() {} },
    Intl, Date, Number, Map, URLSearchParams, setInterval() {}, setTimeout() {}, clearTimeout() {}, Event: class {}, ...dependencies,
  };
  vm.createContext(context);
  const script = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8')
    .replace('  boot();', '  window.testFlow = { state, entryPayload, updateEntryForm, updateProductionPreview, editEntry, resetEntry, renderHistory, renderChart, saveEntry, updateRole, announceSaved, chartScale, qcYield };');
  vm.runInContext(script, context);
  return { $, flow: context.window.testFlow };
}

test('mensagens da Fábrica não passam para o perfil PCA', () => {
  const { $, flow } = screen();
  $('notice').hidden = false;
  $('notice').textContent = 'Registo guardado.';
  flow.updateRole('pca');
  assert.equal($('notice').hidden, true);
  assert.equal($('notice').textContent, '');
});

test('confirmação de registo aparece temporariamente apenas para a Fábrica', () => {
  let expire, delay;
  const { $, flow } = screen({
    setTimeout(callback, milliseconds) { expire = callback; delay = milliseconds; return 1; },
    clearTimeout() {},
  });
  flow.state.role = 'pca';
  flow.announceSaved();
  assert.equal($('notice').hidden, true);
  assert.equal(expire, undefined);

  flow.state.role = 'fabrica';
  flow.announceSaved();
  assert.equal($('notice').hidden, false);
  assert.equal($('notice').textContent, 'Registo guardado.');
  assert.equal(delay, 4000);
  expire();
  assert.equal($('notice').hidden, true);
  assert.equal($('notice').textContent, '');
});

test('escala do gráfico cobre as quantidades com intervalos legíveis', () => {
  const { flow } = screen();
  assert.deepEqual({ ...flow.chartScale(0) }, { intervals: 4, step: 1, max: 4 });
  assert.deepEqual({ ...flow.chartScale(90) }, { intervals: 4, step: 25, max: 100 });
  assert.deepEqual({ ...flow.chartScale(700) }, { intervals: 4, step: 200, max: 800 });
  assert.deepEqual({ ...flow.chartScale(11000) }, { intervals: 4, step: 3000, max: 12000 });
});

test('aproveitamento geral usa os totais aprovados e reprovados no QC', () => {
  const { flow } = screen();
  assert.equal(flow.qcYield(900, 100), 90);
  assert.equal(flow.qcYield(45, 5), 90);
  assert.equal(flow.qcYield(0, 0), null);
});

test('gráfico desenha eixos, quantidades, barras e linhas para o período', () => {
  const { $, flow } = screen();
  flow.state.dashboard = {
    start: '01/01/2026', end: '03/01/2026',
    series: [
      { date: '01/01/2026', produced: 20, dispatched: 5 },
      { date: '03/01/2026', produced: 10, dispatched: 8 },
    ],
  };
  const all = (node) => [node, ...node.children.flatMap(all)];
  $('chartType').value = 'bar';
  flow.renderChart();
  let nodes = all($('productionChart').children[0]);
  assert.equal(nodes.filter((node) => node.attributes.class?.includes('chart-bar')).length, 6);
  assert.equal(nodes.filter((node) => node.attributes.class?.includes('chart-value')).length, 4);
  assert.ok(nodes.some((node) => node.textContent === 'Quantidade'));
  assert.ok(nodes.some((node) => node.textContent === 'Dia'));
  assert.match($('productionChart').attributes['aria-label'], /barras.*horizontal: dia.*vertical: quantidade/i);

  $('chartType').value = 'line';
  flow.renderChart();
  nodes = all($('productionChart').children[0]);
  assert.equal(nodes.filter((node) => node.tag === 'polyline').length, 2);
  assert.equal(nodes.filter((node) => node.tag === 'circle').length, 6);
  assert.match($('productionChart').attributes['aria-label'], /linhas/);
});

test('formulário envia um único registo de produção e calcula 50 - QC 5 = 45', () => {
  const { $, flow } = screen();
  $('entryType').value = 'production'; $('entryDate').value = '18/11/2026';
  $('entryDelegation').value = 'MAT'; $('entryMachine').value = '1';
  $('entryPrimary').value = '50'; $('entrySecondary').value = '10'; $('entryQcRejected').value = '5';
  flow.updateEntryForm();
  assert.equal($('entryQcWrap').hidden, false);
  assert.equal($('entryApproved').value, '45');
  const { kind, data } = flow.entryPayload();
  assert.equal(kind, 'production'); assert.equal(data.produced, 50);
  assert.equal(data.rejected, 10); assert.equal(data.qcRejected, 5);
  assert.equal(Object.hasOwn(data, 'approved'), false);
  assert.equal(data.revision, null);
  $('entrySecondary').value = '20'; flow.updateProductionPreview();
  assert.equal($('entryApproved').value, '45', 'A indicação da máquina não deve ser descontada das aprovadas.');
  $('entryQcRejected').value = '12'; flow.updateProductionPreview();
  assert.equal($('entryApproved').value, '38');
  $('entryQcRejected').value = '51'; flow.updateProductionPreview();
  assert.equal($('entryApproved').value, ''); assert.match($('entryQcRejected').validationMessage, /exceder/);
});

test('INCAPE e despacho continuam sem campos de QC nem cálculo da produção', () => {
  const { $, flow } = screen();
  for (const kind of ['pending', 'dispatch']) {
    $('entryType').value = kind; $('entryDate').value = '18/11/2026';
    $('entryDelegation').value = 'MAT'; $('entryPrimary').value = '125';
    flow.updateEntryForm();
    assert.equal($('entryQcWrap').hidden, true); assert.equal($('entryQcRejected').disabled, true);
    assert.equal($('entryQcRejected').required, false); assert.equal($('entryApproved').value, '');
    const { data } = flow.entryPayload();
    assert.equal(data.quantity, 125); assert.equal(Object.hasOwn(data, 'qcRejected'), false);
  }
});

test('correcção carrega QC e mantém a revisão; QC antigo não passa a novo registo', () => {
  const { $, flow } = screen();
  flow.state.role = 'fabrica';
  flow.editEntry('production', { date: '18/11/2026', delegationCode: 'MAT', machine: 2, produced: 50, rejected: 10, qcRejected: 5, revision: 3 });
  assert.equal($('entryQcRejected').value, '5'); assert.equal($('entryApproved').value, '45');
  assert.equal(flow.entryPayload().data.revision, 3);
  flow.editEntry('quality', { date: '17/11/2026', delegationCode: 'MAT', machine: 0, approved: 45, rejected: 5, revision: 1 });
  assert.equal($('legacyQualityOption').hidden, false); assert.equal($('entryQcWrap').hidden, true);
  flow.resetEntry(true);
  assert.equal($('entryType').value, 'pending'); assert.equal($('legacyQualityOption').disabled, true);
});

test('despacho recusado mostra o saldo informado pelo servidor e conserva o formulário', async () => {
  const calls = [];
  const message = 'Só existem 100 cartas disponíveis para esta delegação.';
  const { $, flow } = screen({ fetch: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: false, status: 422, json: async () => ({ error: message }) };
  } });
  flow.state.role = 'fabrica';
  $('entryType').value = 'dispatch'; $('entryDate').value = '19/11/2026';
  $('entryDelegation').value = 'MAP-C'; $('entryPrimary').value = '5000';
  await flow.saveEntry({ preventDefault() {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/entries/dispatch');
  assert.equal(calls[0].body.quantity, 5000);
  assert.equal($('notice').textContent, message);
  assert.equal($('entryPrimary').value, '5000');
  assert.equal($('entryDelegation').value, 'MAP-C');
});

test('histórico alinha cabeçalhos e quantidades e formata milhares sem alterar os dados', () => {
  const { $, flow } = screen();
  flow.state.delegations = [{ code: 'MAT', name: 'Matola' }];
  const row = { date: '19/11/2026', delegationCode: 'MAT', machine: 1, produced: 5000, rejected: 100, qcRejected: 50, qcApproved: 4950, updatedAt: '19/11/2026 10:30:00.000', revision: 1 };
  flow.state.records = { production: [row], quality: [{ ...row, approved: 4950 }], pending: [{ ...row, quantity: 5000 }], dispatch: [{ ...row, quantity: 100 }] };
  for (const [kind, columns, quantityIndex] of [['production', 9, 3], ['quality', 7, 3], ['pending', 5, 2], ['dispatch', 5, 2]]) {
    $('historyType').value = kind; flow.renderHistory();
    const headers = $('historyHead').children[0].children;
    const cells = $('historyRows').children[0].children;
    assert.equal(headers.length, columns); assert.equal(cells.length, columns);
    assert.match(headers[quantityIndex].className, /num/); assert.match(cells[quantityIndex].className, /num/);
    assert.equal(headers[quantityIndex].attributes.scope, 'col');
    assert.equal(cells.at(-2).children[0].textContent, '19/11/2026');
    assert.equal(cells.at(-2).children[1].textContent, '10:30');
  }
  $('historyType').value = 'production'; flow.renderHistory();
  assert.match($('historyRows').children[0].children[3].textContent, /5\s000/);
  assert.equal(row.produced, 5000);
});
