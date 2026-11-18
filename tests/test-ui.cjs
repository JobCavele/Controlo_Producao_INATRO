/*
 * Testes da interface: correm o app.js contra o index.html real, dentro de um
 * mini-DOM. Não substituem um navegador, mas apanham contratos partidos
 * (ids que faltam, eventos, desenho de tabela/gráfico, erros de validação).
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDocument } = require('./dom.cjs');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const fixture = JSON.parse(read('tests/fixtures/synthetic.json'));

/* ----------------------------------------------- ambiente do navegador --- */

const document = createDocument(read('app/index.html'));
const store = new Map();

let context;
const contextBlobCapture = (blob) => { if (context) context.__exported = blob; };

context = {
  document,
  window: null,
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
  __exported: null,
  Blob,
  listeners: [],
  addEventListener(type, handler) { context.listeners.push([type, handler]); },
  removeEventListener() {},
  location: { reload() { context.reloaded = true; } },
  print() { context.printed = true; },
  URL: { createObjectURL: (blob) => { contextBlobCapture(blob); return 'blob:fake'; }, revokeObjectURL: () => {} },
  Image: class { set src(value) { this._src = value; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._src; } },
  fetch: async (url) => {
    if (url === 'inatro-letterhead.jpg') {
      const bytes = fs.readFileSync(path.join(ROOT, 'app', 'inatro-letterhead.jpg'));
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return { ok: true, arrayBuffer: async () => buffer };
    }
    if (url === 'sample.json') return { ok: true, json: async () => JSON.parse(read('app/sample.json')) };
    return { ok: false, status: 404, json: async () => ({}) };
  },
  navigator: { sendBeacon: () => true },
  Intl,
  console,
  setTimeout,
  clearTimeout,
  crypto: globalThis.crypto,
};
context.window = context;
context.globalThis = context;

const sandboxKeys = Object.keys(context);
const run = (source) => {
  const runner = new Function(...sandboxKeys, `${source}\n//# sourceURL=test`);
  return runner(...sandboxKeys.map((key) => context[key]));
};

// carrega os scripts pela ordem do index.html: a mesma ordem do navegador, sem listas à mão
const pageScripts = [...read('app/index.html').matchAll(/<script src="([^"]+)"><\/script>/g)]
  .map((match) => match[1])
  .filter((src) => src !== 'config.js');
// config primeiro (a app decide pelo config se guarda no servidor), depois os dados e a app
context.window.CONTACARTA_CONFIG = { storage: 'browser' };
const dataScripts = pageScripts.filter((src) => src !== 'app.js');
dataScripts.forEach((src) => run(read(`app/${src}`)));

/* dados fictícios partilhados com os testes de lógica */
store.set('contacarta-registos-v4', JSON.stringify(fixture));
run(read('app/app.js'));


const wait = (ms = 6) => new Promise((resolve) => setTimeout(resolve, ms));
const $ = (id) => document.getElementById(id);
const text = (node) => (node ? node.textContent.replace(/[ⓘ🛈]/g, ' ').replace(/\s+/g, ' ').trim() : '');
const has = (node, ...patterns) => patterns.forEach((pattern) => assert.match(text(node), pattern));

(async function main() {
  await wait(20);

  /* 1 · arranque: dados carregados e painel desenhado */
  assert.equal($('loadError').hidden, true, 'o arranque não pode mostrar erros');
  has($('viewTitle'), /Painel/);
  has($('storageText'), /neste navegador/);
  assert.equal($('navCount').textContent, String(fixture.records.length));
  has($('filterScope'), /10\/2026/);
  console.log('· arranque: estado lido do armazenamento e painel desenhado');

  /* 2 · KPIs, máquinas e gráfico reflectem o período escolhido */
  const kpis = document.querySelectorAll('.kpi');
  assert.equal(kpis.length, 4, 'quatro indicadores no topo: produzidas, aprovadas e as duas rejeições');
  has(kpis[0], /Produzidas/, /600/, /cartas no período/);
  has(kpis[1], /Aprovadas/, /590/, /taxa 98,3%/);
  assert.match(kpis[1].textContent, /Aprovadas/, 'as aprovadas têm o mesmo peso das rejeições');
  has(kpis[2], /Rej\. máquina/, /10/, /taxa 1,7%/);
  has(kpis[3], /Rej\. qualidade/, /10/, /taxa 1,7%/);
  const machines = document.querySelectorAll('.machine');
  assert.equal(machines.length, 2);
  has(machines[0], /Máquina 1/, /Produzidas/, /120/, /Rej\. máquina/, /4/, /Rej\. qualidade/, /2/);
  has(machines[1], /Máquina 2/, /480/, /6/, /8/);
  assert.match($('chart').innerHTML, /<svg/);
  assert.equal($('chart').innerHTML.match(/<rect/g).length, 6, 'só setembro e Outubro têm produção: duas barras compostas de três segmentos');
  assert.match($('chart').innerHTML, />12\/2026</, 'o gráfico percorre o ano inteiro');
  console.log('· painel: KPIs, cartões por máquina e gráfico mensal');

  /* 2b · a acção de cada vista é o único verde; o painel só consulta */
  assert.equal($('newRecord'), null, 'o botão genérico do cabeçalho desapareceu');
  assert.equal(document.querySelector('.top .btn-primary'), null, 'o cabeçalho não guarda nenhum botão verde');
  assert.equal($('panelAdd'), null, 'o painel não cria registos: isso é no menu Registos');
  const primaries = [...document.querySelectorAll('.btn-primary')].filter((node) => !node.closest('dialog'));
  assert.deepEqual(primaries.map((node) => node.id), ['stockAdd', 'lotsAdd', 'dayAdd', 'dayFinish', 'exportPdf'],
    'um botão verde por menu: armazém, lotes, registos e o exportar dos relatórios');
  assert.deepEqual([...new Set(primaries.map((node) => node.closest('.view').id))],
    ['view-stock', 'view-lots', 'view-records', 'view-reports'],
    'cada vista tem o seu verde, e nenhum manda nas outras');

  /* 2c · uma caixa por data, com o calendário do sistema e as setas no mês */
  const stepBtns = $('filterMonthField').querySelectorAll('[data-step]');
  assert.equal(stepBtns.length, 2, 'as setas vivem dentro do campo do mês');
  // a ordem que se vê: seta ‹, a caixa do mês, seta ›
  const line = $('filterMonthField').querySelector('.period-line');
  assert.deepEqual([...line.children].map((node) => node.className || node.tag || node.id), ['step-btn', 'date-pick', 'step-btn'],
    'as setas ficam de fora, uma de cada lado da caixa');
  assert.equal($('filterMonthPick'), null, 'não há uma segunda escolha do mês por baixo da caixa');
  assert.equal($('filterYearPick'), null, 'nem uma segunda escolha do ano');
  assert.equal(document.querySelectorAll('.filter .date-pick').length, 3, 'as três datas do filtro são caixas de data');
  assert.equal($('filterMonth').value, '10/2026', 'a caixa abre no mês à vista, em mm/aaaa');
  assert.equal($('filterMonthField').querySelector('.date-native').type, 'month', 'o calendário do mês é o do sistema');
  $('filterMonthField').querySelector('[data-step="1"]').click();
  await wait(5);
  assert.equal($('filterMonth').value, '11/2026', 'as setas correm os meses');
  $('filterMonthField').querySelector('[data-step="-1"]').click();
  await wait(5);
  assert.equal($('filterMonth').value, '10/2026', 'e voltam atrás sem se perder');
  const monthNative = $('filterMonthField').querySelector('.date-native');
  monthNative.value = '2026-01';
  monthNative.dispatch('change');
  await wait(5);
  assert.equal($('filterMonth').value, '01/2026', 'escolher no calendário escreve o mês na caixa');
  $('filterMonth').value = '10/2026';
  $('filterMonth').dispatch('change');
  await wait(5);
  assert.equal(monthNative.value, '2026-10', 'e escrever na caixa acerta o calendário');
  document.querySelectorAll('.filter .segmented button')[2].click();
  await wait(5);
  assert.equal($('filterPeriodField').hidden, false, 'o modo período mostra as duas caixas de dia');
  const startNative = $('filterPeriodField').querySelectorAll('.date-native')[0];
  assert.equal($('filterStart').value, '01/10/2026', 'as datas do intervalo abrem no início e no fim do mês');
  startNative.value = '2026-10-10';
  startNative.dispatch('change');
  await wait(5);
  assert.equal($('filterStart').value, '10/10/2026', 'o calendário escreve a data inicial em dd/mm/aaaa');
  assert.equal($('filterEnd').value, '31/10/2026', 'e a final fica onde estava');
  $('filterStart').value = '20/11/2026';
  $('filterStart').dispatch('change');
  await wait(5);
  assert.equal($('filterStart').value, '10/10/2026', 'uma data inicial depois da final não entra');
  document.querySelectorAll('.filter .segmented button')[1].click();
  await wait(5);
  const yearSteps = $('filterYearField').querySelectorAll('[data-step]');
  assert.equal(yearSteps.length, 2, 'as setas servem o ano no modo ano');
  document.querySelectorAll('.filter .segmented button')[0].click();
  await wait(5);
  assert.equal($('filterMonth').value, '10/2026', 'voltar ao mês não perde a escolha');
  console.log('· filtro: uma caixa por data, calendário do sistema e setas no mês');

  /* 3 · tabela do painel com o total do período */
  const tableRows = $('panelTable').querySelectorAll('tbody tr');
  assert.equal(tableRows.length, 2);
  has($('panelTable'), /Total do período/);
  const groups = $('panelTable').querySelectorAll('thead tr.is-groups th');
  assert.deepEqual(groups.map((node) => node.textContent.trim()), ['Período', 'Máquina 1', 'Máquina 2', 'Totais do período', 'Notas'],
    'o cabeçalho da tabela agrupa as colunas por máquina');
  assert.equal(groups[1].attributes.get('colspan'), '3', 'cada máquina cobre três colunas');
  assert.equal($('panelTable').querySelectorAll('thead tr')[1].querySelectorAll('th').length, 9);
  console.log('· painel: tabela com registos e linha de total');

  /* 3a · o painel também se arquiva em PDF: mesmo período, mesmo nome de ficheiro */
  context.__exported = null;
  $('panelExport').click();
  await wait(160);
  assert.ok(context.__exported, 'o botão do painel exporta um PDF');
  const panelPdf = Buffer.from(await context.__exported.arrayBuffer());
  assert.equal(panelPdf.subarray(0, 5).toString('latin1'), '%PDF-', 'assinatura de PDF');
  assert.match(document.lastDownload, /^contacarta-\d{2}-\d{2}-\d{4}-a-\d{2}-\d{2}-\d{4}\.pdf$/,
    'o nome do painel segue a regra dos restantes relatórios');
  console.log('· painel: exportação em PDF do período à vista');

  /* 3b · separadores do detalhe: começam nas máquinas, trocam e voltam, com dicas */
  const panelTabs = [...document.querySelectorAll('#panelDetail [role="tab"]')];
  assert.deepEqual(panelTabs.map((tab) => tab.dataset.tab), ['machines', 'chart', 'table'], 'três separadores pela ordem certa');
  assert.equal(panelTabs[0].getAttribute('aria-selected'), 'true', 'o painel abre nas máquinas');
  assert.equal($('tab-machines').hidden, false);
  assert.equal($('tab-chart').hidden, true);
  assert.equal($('tab-table').hidden, true);
  assert.match(text($('tabMachinesHint')), /\d/, 'a dica do separador diz o que lá está');
  panelTabs[2].click();
  assert.equal($('tab-table').hidden, false, 'clicar em Registos mostra a tabela');
  assert.equal($('tab-machines').hidden, true);
  assert.equal(panelTabs[2].getAttribute('aria-selected'), 'true');
  assert.equal(panelTabs[0].getAttribute('aria-selected'), 'false');
  assert.equal(panelTabs[0].tabIndex, -1, 'só o separador activo entra na ordem do teclado');
  panelTabs[0].dispatch('keydown', { key: 'ArrowRight' });
  assert.equal($('tab-chart').hidden, false, 'a seta direita anda para o separador seguinte');
  panelTabs[0].dispatch('keydown', { key: 'End' });
  panelTabs[0].dispatch('keydown', { key: 'Home' });
  assert.equal($('tab-machines').hidden, false, 'Home volta ao primeiro separador');
  // os indicadores e o filtro ficam sempre fora dos separadores
  assert.equal($('kpis').closest('#panelDetail'), null, 'os indicadores não entram nos separadores');
  assert.equal($('view-panel').querySelector('.filter').closest('#panelDetail'), null, 'o filtro também fica de fora');
  console.log('· painel: três separadores, com teclado e dicas');

  /* 3c · o primeiro ecrã do painel é o da TV: período, indicadores, avisos e separadores; o resto vem depois */
  const firstScreen = $('view-panel').children.filter((node) => node.nodeType === 1).map((node) => node.id || node.className);
  assert.deepEqual(firstScreen, ['card filter', 'kpis', 'panelAlerts', 'panelDetail'], 'dentro do painel só há o que cabe no primeiro ecrã, por esta ordem');
  const below = $('panelMore');
  assert.equal($('view-panel').nextElementSibling, below, 'o mapa e os movimentos vêm logo a seguir ao painel, fora dele');
  for (const id of ['mozambiqueMap', 'delegationTotals', 'operationForm', 'opsMessage', 'opsBalances', 'opsHistory']) {
    assert.equal($(id).closest('#panelMore'), below, `${id} vive no bloco de baixo`);
    assert.equal($(id).closest('#view-panel'), null, `${id} não entra no primeiro ecrã`);
  }
  assert.equal(below.hidden, true, 'sem servidor não há delegações nem movimentos: o bloco nem aparece');
  console.log('· painel: o primeiro ecrã fica só com o período, os indicadores e os separadores');

  /* 4 · mudança de métrica do gráfico */
  const metricButtons = document.querySelectorAll('[data-metric]');
  metricButtons[2].click();
  assert.match($('chart').innerHTML, /<svg/);
  metricButtons[0].click();
  console.log('· painel: troca de indicador no gráfico');

  /* 5 · filtro: mês, ano e intervalo de datas */
  const modeButtons = document.querySelectorAll('.filter .segmented button');
  assert.deepEqual([...modeButtons].map((node) => node.dataset.filter), ['month', 'year', 'period']);
  modeButtons[1].click();
  assert.equal($('filterYearField').hidden, false, 'o modo ano mostra o campo do ano');
  assert.equal($('filterMonthField').hidden, true);
  assert.equal($('filterPeriodField').hidden, true);
  assert.equal($('filterYearField').hidden, false, 'no ano as setas acompanham o campo do ano');
  assert.equal(text($('viewContext')), 'Ano de 2026');
  assert.equal($('kpis').querySelectorAll('.kpi').length, 4);
  const yearly = $('kpis').querySelector('.kpi-value');
  assert.equal(yearly.textContent.replace(/\u00a0/g, ' '), '840', 'o ano soma os dois meses apontados');
  assert.equal($('kpis').querySelectorAll('.kpi-delta').filter((node) => !node.classList.contains('is-empty')).length, 0, 'sem ano anterior apontado não há variação a mostrar');
  assert.match(text($('kpis')), /Produzidas no ano\s*840\s*média 70 por mês/, 'no ano o primeiro KPI passa a mostrar a média mensal');
  assert.match($('chartTitle').textContent, /Evolução em 2026/, 'o gráfico do ano abre os doze meses');
  assert.match($('chart').outerHTML, />09\/2026<\/text>[\s\S]*>10\/2026<\/text>/, 'o painel em modo ano desenha os doze meses');
  assert.equal($('chart').outerHTML.match(/>\d{2}\/\d{4}<\/text>/g).length, 12, 'um rótulo por mês do ano, sempre com o ano inteiro');
  modeButtons[2].click();
  assert.equal($('filterPeriodField').hidden, false);
  assert.equal($('filterMonthField').hidden, true, 'no intervalo não há setas de mês');
  modeButtons[0].click();
  assert.equal($('filterPeriodField').hidden, true);
  assert.equal($('filterMonthField').hidden, false);
  assert.equal($('filterMonthField').hidden, false);
  const deltaLine = $('kpis').querySelector('.kpi-delta');
  assert.ok(deltaLine, 'no mês com anterior apontado há linha de variação');
  assert.match(text(deltaLine), /\+360 face ao mês anterior/, 'a variação é medida contra o mês do mesmo tamanho');
  console.log('· filtro: alternar entre mês, ano e intervalo de datas, com variação');

  /* 6 · navegação: o dia de produção é a vista dos registos */
  document.querySelectorAll('.nav-item')[3].click();
  assert.equal($('view-panel').hidden, true, 'a vista anterior fecha');
  assert.equal($('view-records').hidden, false, 'a vista do dia abre');
  assert.equal($('viewTitle').textContent, 'Dia de produção');
  has($('dayHead'), /Hoje, \d{2}\/\d{2}\/\d{4}/, /Dia por terminar|Dia a decorrer/);
  has($('dayHead'), /Lotes/, /Planeadas/, /Produzidas/, /Aprovadas/, /Rej\. máquina/, /Rej\. qualidade/);
  assert.equal($('dayEntries').querySelectorAll('table').length, 0, 'um dia novo abre sem lotes');
  has($('dayEntries'), /Ainda não há lotes neste dia/);
  has($('dayFoot'), /Ainda não há nada para terminar/);
  assert.equal($('dayFinish').disabled, true, 'sem lotes não há dia para terminar');
  // a lista dos dias mostra os registos guardados, com o dia à frente marcado
  const dayRows = $('recordsTable').querySelectorAll('tbody tr');
  assert.equal(dayRows.length, fixture.records.length, 'a lista tem um dia por registo guardado');
  has($('recordsTable'), /09\/2026/, /10\/2026/, /terminado|por terminar|a decorrer/);
  console.log('· dia: cabeçalho, lista de lotes vazia e dias registados');

  /* 7 · adicionar o primeiro lote do dia: cálculo em direto, erro e gravação */
  $('dayAdd').click();
  assert.equal($('recordDialog').open, true, 'o diálogo abre no dia');
  assert.match(text($('dialogTitle')), /Lote de \d{2}\/\d{2}\/\d{4}/);
  assert.match($('recordDate').value, /^\d{2}\/\d{2}\/\d{4}$/, 'a data do dia é uma caixa única, dd/mm/aaaa');
  assert.equal($('recordDate').closest('.date-pick') !== null, true, 'com o calendário do sistema');
  const dayChoices = $('entryDelegation').querySelectorAll('option').map((option) => option.textContent);
  assert.equal(dayChoices.length, 12, 'a delegação escolhe-se do catálogo (uma por província), mesmo sem servidor');
  assert.deepEqual([dayChoices[0], dayChoices[1], dayChoices[5]], ['Escolher delegação', 'Beira (Sofala)', 'Maputo Cidade']);
  $('recordDate').value = '16/11/2026';
  $('recordDate').dispatch('change');
  await wait(5);
  // o lote: a referência, a máquina e as cartas
  // a lista só oferece os lotes do quadro que ainda têm cartas por imprimir: os dois deste exemplo já as têm todas
  assert.deepEqual($('entryLot').querySelectorAll('option').map((option) => option.textContent), ['Sem lotes preparados por apontar']);
  assert.equal($('entryIdentity').disabled, false, 'sem lote preparado, os dados do lote escrevem-se');
  assert.equal($('entryEditWrap').hidden, true, 'e não há nada para destrancar');
  $('entryReference').value = 'L-2026-901';
  $('entryDelegation').value = 'Delegação de Maputo';
  $('entryMachine').value = '0';
  $('entryPlanned').value = '600';
  $('m0p').value = '500';
  $('m0r').value = '100';
  $('m0q').value = '40';
  $('entryPlanned').dispatch('input');
  has($('liveResult'), /Aprovadas/, /460/, /Rej\. máquina/, /100/, /Chumbadas no teste/, /40/, /Aprovação/, /92,0%/);
  has($('entryLive'), /500 de 600 cartas/, /faltam 100/);
  assert.equal($('formError').hidden, true);

  $('m0r').value = '900';
  $('entryPlanned').dispatch('input');
  assert.equal($('formError').hidden, false, 'rejeitar mais do que se produziu é recusado');
  has($('formError'), /Máquina 1: 900 rejeitadas pela máquina não cabem em 500 produzidas/);
  $('m0r').value = '100';
  $('entryPlanned').dispatch('input');

  $('recordForm').dispatch('submit');
  await wait(30);
  assert.equal($('recordDialog').open, true, 'o diálogo fica aberto para o lote seguinte');
  assert.equal($('entryReference').value, '', 'e o lote fica limpo');
  assert.equal($('m0p').value, '', 'as quantidades também');
  has($('toast'), /Lote guardado no dia 16\/11\/2026/);
  const saved = JSON.parse(store.get('contacarta-registos-v4'));
  const day16 = saved.records.find((record) => record.start === '2026-11-16');
  assert.equal(day16.period, 'day');
  assert.equal(day16.entries.length, 1);
  assert.deepEqual([day16.entries[0].reference, day16.entries[0].machine, day16.entries[0].planned], ['L-2026-901', 0, 600]);
  assert.deepEqual([day16.entries[0].produced, day16.entries[0].rejected, day16.entries[0].qualityRejected], [500, 100, 40]);
  assert.equal(day16.entries[0].done, true, 'por omissão o lote entra concluído');
  console.log('· dia: primeiro lote gravado dentro do dia, diálogo pronto para o próximo');

  /* 7a · um lote ainda a sair da máquina entra em curso e conclui-se depois */
  $('entryReference').value = 'L-2026-901-B';
  $('entryMachine').value = '0';
  $('entryPlanned').value = '400';
  $('m0p').value = '120';
  $('entryDone').checked = false;
  $('entryPlanned').dispatch('input');
  $('recordForm').dispatch('submit');
  await wait(30);
  const withOpenLot = JSON.parse(store.get('contacarta-registos-v4')).records.find((record) => record.start === '2026-11-16');
  const openLot = withOpenLot.entries.find((entry) => entry.reference === 'L-2026-901-B');
  assert.equal(openLot.done, false, 'o lote por concluir fica gravado em curso');
  assert.equal(openLot.produced, 120);
  has($('dayHead'), /por concluir/);
  const finishOpen = [...$('dayEntries').querySelectorAll('[data-entry-done]')].find((node) => node.dataset.entryDone === openLot.id);
  assert.ok(finishOpen, 'a linha do lote em curso tem «Concluir»');
  finishOpen.click();
  await wait(25);
  const afterFinish = JSON.parse(store.get('contacarta-registos-v4')).records.find((record) => record.start === '2026-11-16');
  assert.equal(afterFinish.entries.find((entry) => entry.id === openLot.id).done, true, 'concluir o lote grava o novo estado');
  assert.equal($('entryDone').checked, true, 'o formulário volta à omissão: o lote seguinte entra concluído');
  // a linha extra sai do dia para os números seguintes continuarem a ser os do teste
  const removeOpen = [...$('dayEntries').querySelectorAll('[data-entry-delete]')].find((node) => node.dataset.entryDelete === openLot.id);
  removeOpen.click();
  await wait(10);
  $('confirmYes').click();
  await wait(25);
  const backToTwo = JSON.parse(store.get('contacarta-registos-v4')).records.find((record) => record.start === '2026-11-16');
  assert.equal(backToTwo.entries.length, 1, 'o lote de prova saiu do dia');
  console.log('· dia: o lote em curso entra por concluir e conclui-se na linha do dia');

  /* 7b · o segundo lote do mesmo dia entra na mesma lista, noutra máquina */
  $('entryReference').value = 'L-2026-902';
  $('entryDelegation').value = 'Delegação da Matola';
  $('entryMachine').value = '1';
  $('entryPlanned').value = '300';
  $('m0p').value = '300';
  $('m0r').value = '20';
  $('m0q').value = '10';
  $('entryPlanned').dispatch('input');
  $('recordForm').dispatch('submit');
  await wait(30);
  const twoLots = JSON.parse(store.get('contacarta-registos-v4')).records.find((record) => record.start === '2026-11-16');
  assert.equal(twoLots.entries.length, 2, 'o dia tem os dois lotes, e não dois registos');
  assert.equal(twoLots.entries[1].machine, 1);
  const totalDay = twoLots.entries.reduce((sum, entry) => sum + entry.produced, 0);
  assert.equal(totalDay, 800, 'as cartas do dia são a soma dos lotes');
  $('dialogClose').click();
  console.log('· dia: segundo lote entra na mesma lista, com a sua máquina');

  /* 7c · o dia desenhado: dois lotes, um total e o botão de terminar */
  const dayRowsNow = $('dayEntries').querySelectorAll('tbody tr');
  assert.equal(dayRowsNow.length, 2, 'um lote por linha');
  has($('dayEntries'), /L-2026-901/, /L-2026-902/, /Máquina 1/, /Máquina 2/, /800/);
  has($('dayEntries'), /Concluído|Em curso/);
  has($('dayHead'), /16\/11\/2026/, /800/, /750/, /93,8%/);
  assert.equal($('dayFinish').disabled, false, 'com lotes já se pode terminar o dia');
  console.log('· dia: a tabela dos lotes e o total do dia');

  /* 7d · concluir um lote reflecte-se em todo o lado, sem passos extra */
  $('dayEntries').querySelector('[data-entry-reopen]') && $('dayEntries').querySelector('[data-entry-reopen]').click();
  await wait(20);
  const reopened = JSON.parse(store.get('contacarta-registos-v4')).records.find((record) => record.start === '2026-11-16');
  assert.ok(reopened.entries.some((entry) => entry.done === false), 'reabrir um lote deixa-o por concluir');
  const doneButton = [...$('dayEntries').querySelectorAll('[data-entry-done]')][0];
  assert.ok(doneButton, 'há um lote por concluir para concluir');
  doneButton.click();
  await wait(25);
  const closedLot = JSON.parse(store.get('contacarta-registos-v4')).records.find((record) => record.start === '2026-11-16');
  assert.equal(closedLot.entries.filter((entry) => entry.done).length, 2, 'concluir grava o estado do lote');
  // e o painel do mês conta o dia, sem tocar em mais nada
  document.querySelectorAll('.nav-item')[0].click();
  $('filterMonth').value = '11/2026';
  $('filterMonth').dispatch('change');
  await wait(10);
  has($('kpis'), /Produzidas/, /800/);
  has($('panelTable'), /16\/11\/2026/);
  console.log('· dia: concluir um lote chega para o painel contar o dia');

  /* 8 · terminar o dia fecha-o; reabrir volta a deixar apontar */
  document.querySelectorAll('.nav-item')[3].click();
  await wait(5);
  $('dayFinish').click();
  await wait(25);
  const ended = JSON.parse(store.get('contacarta-registos-v4')).records.find((record) => record.start === '2026-11-16');
  assert.equal(ended.closed, true, 'terminar o dia fica gravado');
  assert.equal($('dayAdd').disabled, true, 'um dia terminado não aceita lotes novos');
  has($('dayHead'), /Dia terminado/);
  has($('dayFoot'), /Cada lote está aprovado/);
  $('dayHead').querySelector('#dayReopen').click();
  await wait(25);
  const reopenedDay = JSON.parse(store.get('contacarta-registos-v4')).records.find((record) => record.start === '2026-11-16');
  assert.equal(reopenedDay.closed, false, 'reabrir o dia volta a deixá-lo aberto');
  assert.equal($('dayAdd').disabled, false);
  console.log('· dia: terminar fecha, reabrir volta a abrir');

  /* 9 · um dia novo na data do dia anterior e a lista dos dias */
  $('dayAdd').click();
  await wait(5);
  $('recordDate').value = '17/11/2026';
  $('recordDate').dispatch('change');
  $('entryReference').value = 'L-2026-903';
  $('entryPlanned').value = '50';
  $('m0p').value = '50';
  $('entryPlanned').dispatch('input');
  $('recordForm').dispatch('submit');
  await wait(25);
  $('dialogClose').click();
  await wait(5);
  const withSecondDay = JSON.parse(store.get('contacarta-registos-v4'));
  assert.equal(withSecondDay.records.filter((record) => record.period === 'day').length, 2, 'são dois dias, não um');
  // a lista dos dias abre o dia escolhido
  const openDayButton = $('recordsTable').querySelectorAll('[data-day-open]').find((node) => /17\/11\/2026/.test(node.textContent));
  assert.ok(openDayButton, 'a lista tem o dia novo');
  openDayButton.click();
  await wait(20);
  // só a data: o «Hoje, » à frente depende do dia em que o teste corre (só existia a 17/11/2026)
  has($('dayHead'), /17\/11\/2026/, /50/);
  assert.equal($('dayEntries').querySelectorAll('tbody tr').length, 1, 'o dia 17 tem um lote');
  console.log('· dia: abrir um dia da lista mostra os seus lotes');

  /* 10 · eliminar o lote do dia: o dia que fica vazio desaparece */
  $('dayEntries').querySelector('[data-entry-delete]').click();
  await wait(5);
  assert.equal($('confirmDialog').open, true);
  has($('confirmText'), /Vai apagar «L-2026-903» \(50 cartas produzidas\) do dia 17\/11\/2026/);
  $('confirmYes').click();
  await wait(25);
  const afterEntryDelete = JSON.parse(store.get('contacarta-registos-v4'));
  assert.equal(afterEntryDelete.records.some((record) => record.start === '2026-11-17'), false, 'o dia que fica sem lotes desaparece');
  console.log('· dia: eliminar o último lote apaga o dia vazio');

  /* 11 · a lista dos dias apaga um dia inteiro, com confirmação */
  await wait(10);
  assert.equal($('confirmDialog').open, false, 'a confirmação anterior já fechou');
  const day16Record = JSON.parse(store.get('contacarta-registos-v4')).records.find((record) => record.start === '2026-11-16');
  const deleteDay = $('recordsTable').querySelectorAll('[data-day-delete]').find((node) => node.dataset.dayDelete === day16Record.id);
  assert.ok(deleteDay, 'a lista dos dias tem o dia 16/11 para apagar');
  deleteDay.click();
  await wait(20);
  has($('confirmText'), /Vai apagar o dia 16\/11\/2026 com 2 lotes e 800 cartas/);
  $('confirmYes').click();
  await wait(25);
  const afterDayDelete = JSON.parse(store.get('contacarta-registos-v4'));
  assert.equal(afterDayDelete.records.some((record) => record.start === '2026-11-16'), false, 'o dia inteiro foi apagado');
  assert.equal(afterDayDelete.records.length, fixture.records.length, 'os outros dias ficam');
  console.log('· dias: apagar um dia inteiro, com os lotes e as cartas à vista');

  /* 12 · relatórios: gerar, pré-visualizar e exportar */
  document.querySelectorAll('.nav-item')[4].click();
  assert.equal($('view-reports').hidden, false);
  assert.equal($('reportWrap').hidden, false, 'o relatório do mês é mostrado ao entrar');
  has($('reportHint'), /registos somados|registo somado/);
  has($('paper'), /Relatório de produção/);
  assert.match($('paper').outerHTML, /src="inatro\.png"/, 'o papel mostra o logótipo oficial do INATRO');
  assert.match($('paper').outerHTML, /alt="INATRO, IP/, 'o logótipo do papel diz o que é');
  has($('paper'), /Total/);
  assert.equal($('paper').querySelectorAll('.paper-kpi').length, 5, 'o papel mostra os mesmos cinco indicadores do PDF');
  assert.equal($('paper').querySelectorAll('.paper-kpi.is-bad').length, 2, 'as duas rejeições aparecem a vermelho no papel');
  has($('paper'), /Rej\. qualidade/);
  assert.match($('paper').innerHTML, /<svg/, 'a pré-visualização leva o gráfico, como o PDF');
  assert.equal($('paper').querySelectorAll('.paper-table').length, 2, 'tabela por máquina e tabela de registos');
  has($('reportHint'), /1 registo somado/, /1 de 31 dias com registo/);
  assert.equal($('reportHint').classList.contains('is-error'), false, 'o gerador não pode estar a queixar-se');
  const kinds = $('reportKind');
  kinds.value = 'week';
  kinds.dispatch('change');
  assert.equal($('reportDates').querySelectorAll('.date-pick').length, 1, 'o dia da semana é uma caixa de data só');
  const weekField = $('reportDates').querySelectorAll('input')[0];
  assert.equal(weekField.type, 'text', 'a data do relatório é escrita em dd/mm/aaaa, não em ISO');
  assert.match(weekField.value, /^\d{2}\/\d{2}\/\d{4}$/);
  weekField.value = '16/11/2026';
  weekField.dispatch('change');
  await wait(10);
  has($('paper'), /Semana de 16\/11\/2026/, /Não há registos somados neste período/);
  console.log('· relatórios: gerador, pré-visualização e semanais');

  /* 13 · comparação: dois períodos lado a lado, com a diferença */
  const kindsForCompare = $('reportKind');
  kindsForCompare.value = 'months';
  kindsForCompare.dispatch('change');
  await wait(10);
  const compareBoxes = $('reportDates').querySelectorAll('.date-pick');
  assert.equal(compareBoxes.length, 2, 'Mês 1 e Mês 2 — uma caixa de data cada, sem extremos');
  const compareInputs = compareBoxes.map((box) => box.querySelector('input'));
  assert.equal(compareInputs[0].type, 'text', 'os meses comparados escrevem-se em mm/aaaa, não em ISO');
  assert.equal(compareInputs[0].getAttribute('placeholder'), 'mm/aaaa');
  assert.equal(compareInputs[0].getAttribute('aria-label'), 'Mês 1');
  assert.equal(compareInputs[1].getAttribute('aria-label'), 'Mês 2');
  assert.equal(compareBoxes[0].querySelector('.date-native').type, 'month', 'e trazem o calendário do mês');
  compareInputs[0].value = '09/2026';
  compareInputs[0].dispatch('change');
  await wait(10);
  compareInputs[1].value = '10/2026';
  compareInputs[1].dispatch('change');
  await wait(10);
  has($('reportHint'), /2 períodos lado a lado/, /2 registos somados/, /2 com produção/);
  assert.equal($('paper').querySelectorAll('.paper-kpi').length, 0, 'na comparação não há faixa de indicadores solta — manda o lado a lado');
  const compareTables = $('paper').querySelectorAll('.paper-table');
  assert.equal(compareTables.length, 2, 'a tabela lado a lado e a tabela por máquina');
  const sideTable = compareTables[0];
  const sideHead = sideTable.querySelectorAll('thead th');
  assert.match(text(sideHead[0]), /Métrica/);
  assert.match(text(sideHead[1]), /09\/2026/);
  assert.match(text(sideHead[2]), /10\/2026/);
  assert.match(text(sideHead[3]), /Diferença/);
  const sideRows = sideTable.querySelectorAll('tbody tr');
  assert.equal(sideRows.length, 10, 'registos, produzidas, aprovadas, rejeições com taxas, aprovação, por dia e dias com registo');
  assert.match(text(sideRows[0]), /Registos/, /1.*1.*±0/);
  assert.match(text(sideRows[1]), /Produzidas/, /240.*600.*\+360/);
  assert.match(text(sideRows[2]), /Aprovadas/, /236.*590.*\+354/);
  assert.match(text(sideRows[3]), /Rej\. máquina/, /8.*10.*\+2/);
  assert.match(text(sideRows[4]), /Rej\. qualidade/, /4.*10.*\+6/);
  assert.match(text(sideRows[7]), /Aprovação/, /98,3%.*98,3%.*±0 p\./);
  assert.ok(sideRows[1].querySelectorAll('td')[3].classList.contains('is-good'), 'mais produção aparece a verde');
  assert.ok(sideRows[3].querySelectorAll('td')[3].classList.contains('is-bad'), 'mais rejeição aparece a vermelho');
  const machineCompare = compareTables[1];
  has(machineCompare, /Setembro de 2026/, /Outubro de 2026/, /Máquina 2/, /Total/, /Período/);
  const machineRows = machineCompare.querySelectorAll('tbody tr');
  assert.equal(machineRows.length, 6, 'dois períodos × (duas máquinas + total)');
  assert.match(text(machineRows[2]), /Setembro de 2026.*Total/);
  assert.match(text(machineRows[5]), /Outubro de 2026.*Total/);
  has($('paper'), /produziu mais 360 cartas do que Setembro de 2026/, /98,3% para 98,3%/);
  has($('paper'), /Lado a lado — Setembro de 2026 e Outubro de 2026/);
  assert.match($('paper').outerHTML, /09\/2026[\s\S]*10\/2026/, 'o gráfico da comparação usa as etiquetas dos períodos, com o ano inteiro');
  kindsForCompare.value = 'years';
  kindsForCompare.dispatch('change');
  await wait(10);
  const yearInputs = $('reportDates').querySelectorAll('input');
  assert.equal(yearInputs.length, 2, 'Ano 1 e Ano 2');
  assert.equal(yearInputs[0].type, 'number');
  yearInputs[0].value = '2025';
  yearInputs[0].dispatch('change');
  await wait(10);
  yearInputs[1].value = '2026';
  yearInputs[1].dispatch('change');
  await wait(10);
  has($('reportHint'), /2 períodos lado a lado/);
  assert.equal($('paper').querySelectorAll('.paper-kpi').length, 0);
  has($('paper'), /Só 2026 tem produção/);
  const yearSide = $('paper').querySelectorAll('.paper-table')[0];
  const yearHead = yearSide.querySelectorAll('thead th');
  assert.match(text(yearHead[1]), /2025/);
  assert.match(text(yearHead[2]), /2026/);
  assert.equal($('paper').querySelectorAll('input[type=checkbox]').length, 0, 'não há caixa de extremos: são só dois');

  // o PDF da comparação leva a tabela lado a lado, a leitura e cabe numa página
  kindsForCompare.value = 'months';
  kindsForCompare.dispatch('change');
  await wait(10);
  const pdfInputs = [...$('reportDates').querySelectorAll('input')].filter((node) => node.type !== 'checkbox' && !node.classList.contains('date-native'));
  pdfInputs[0].value = '09/2026';
  pdfInputs[0].dispatch('change');
  await wait(10);
  pdfInputs[1].value = '10/2026';
  pdfInputs[1].dispatch('change');
  await wait(10);
  context.__exported = null;
  $('exportPdf').click();
  await wait(160);
  const comparePdf = Buffer.from(await context.__exported.arrayBuffer());
  const compareReadable = comparePdf.toString('latin1')
    .replace(/\\(\d{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
  assert.equal(comparePdf.subarray(0, 8).toString('latin1').trim(), '%PDF-1.4');
  assert.ok(comparePdf.subarray(-16).toString('latin1').includes('%%EOF'), 'o PDF da comparação termina em %%EOF');
  assert.match(compareReadable, /Comparação de meses/, 'o título da comparação vai para o papel');
  assert.match(compareReadable, /Métrica/, 'a tabela lado a lado vai para o papel');
  assert.match(compareReadable, /Diferença/);
  assert.match(compareReadable, /Leitura da comparação/);
  assert.match(compareReadable, /Subtype \/Image/, 'o logótipo oficial vai embutido no PDF');
  assert.match(compareReadable, /DCTDecode/, 'o logótipo viaja como JPEG');
  assert.match(compareReadable, /Página 1 de [12]/, 'a comparação sai paginada, sem conteúdo cortado');
  assert.match(document.lastDownload, /09-2026-vs-10-2026-comparacao\.pdf$/, 'o nome do ficheiro diz que são dois, e quais');
  // e não leva as notas dos registos lá pelo meio do intervalo
  assert.ok(!compareReadable.includes('Total comparado'), 'a linha de total comparado ficou para trás');

  // e volta ao relatório simples, para as secções seguintes
  kindsForCompare.value = 'week';
  kindsForCompare.dispatch('change');
  await wait(10);
  $('reportDates').querySelectorAll('input')[0].value = '16/11/2026';
  $('reportDates').querySelectorAll('input')[0].dispatch('change');
  await wait(10);
  has($('paper'), /Semana de 16\/11\/2026/);
  assert.ok($('paper').outerHTML.includes('inatro.png'), 'o papel mostra o logótipo oficial do INATRO');
  console.log('· comparação: dois períodos lado a lado, diferença, leitura e PDF');

  /* 13a · o botão do painel continua a exportar o período do filtro, não o do relatório */
  const panelReportKind = $('reportKind').value;
  $('panelExport').click();
  await wait(160);
  assert.equal($('reportKind').value, panelReportKind, 'exportar o painel não mexe na escolha do relatório');
  assert.match(document.lastDownload, /-a-.*\.pdf$/, 'o painel exporta o período do filtro');
  assert.match(text(document.body), /Painel em PDF guardado/, 'o aviso diz o que foi guardado');
  console.log('· painel: exportação independente do relatório');

  /* 14 · PDF e CSV de um relatório simples */
  $('exportPdf').click();
  await wait(140);
  const exportedFile = context.__exported;
  assert.ok(exportedFile, 'a exportação tem de criar um ficheiro');
  const pdfBytes = Buffer.from(await exportedFile.arrayBuffer());
  assert.equal(pdfBytes.subarray(0, 8).toString('latin1').trim(), '%PDF-1.4');
  const readable = pdfBytes.toString('latin1').replace(/\\(\d{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
  assert.match(readable, /\/Type \/Pages \/Count [1-9]/);
  assert.equal(pdfBytes.subarray(-10).toString('latin1').includes('%%EOF'), true);
  assert.match(readable, /INATRO, IP/);
  assert.match(readable, /Subtype \/Image/, 'o logótipo oficial vai embutido no relatório simples');
  assert.match(readable, /Relatório de produção/);
  assert.match(readable, /Página 1 de 1/);
  assert.match(readable, /Período|Variação/);
  assert.match(readable, /Total do período|Total/);
  assert.ok(pdfBytes.length > 2500, 'o relatório tem de ter conteúdo');

  context.__exported = null;
  $('exportCsv').click();
  await wait(30);
  const csv = (await context.__exported.text()).replace(/^\uFEFF/, '');
  const lines = csv.split('\r\n');
  assert.match(lines[0], /^"Sistema";"Conta Carta · INATRO, IP"$/);
  assert.ok(lines.some((line) => line.startsWith('"Total";')), 'tem de haver linha de total');
  assert.equal(lines.filter((line) => line.startsWith('"Origem"')).length, 1);

  // e o CSV da comparação, com a variação e o total comparado
  const kindForCsv = $('reportKind');
  kindForCsv.value = 'months';
  kindForCsv.dispatch('change');
  await wait(10);
  const csvInputs = [...$('reportDates').querySelectorAll('input')].filter((node) => node.type === 'text');
  assert.equal(csvInputs.length, 2, `dois meses comparados (${csvInputs.length})`);
  csvInputs[0].value = '09/2026';
  csvInputs[0].dispatch('change');
  await wait(10);
  csvInputs[1].value = '10/2026';
  csvInputs[1].dispatch('change');
  await wait(10);
  context.__exported = null;
  $('exportCsv').click();
  await wait(30);
  assert.ok(context.__exported, 'o CSV saiu');
  const compareCsv = (await context.__exported.text()).replace(/^\uFEFF/, '');
  assert.match(compareCsv, /^"Sistema";"Conta Carta · INATRO, IP"/);
  assert.match(compareCsv, /"Comparação";"Comparação de meses · Setembro de 2026 × Outubro de 2026"/);
  assert.ok(compareCsv.includes('"Período";"Nome";"Registos";"Produzidas"'), 'cabeçalho próprio da comparação');
  assert.ok(compareCsv.includes('"Diferença (2.º menos 1.º)";"";"0";"360";"354";"2";"6";"0"'),'linha da diferença: segundo menos primeiro');
  assert.ok(!compareCsv.includes('Total comparado'), 'a comparação já não soma tudo numa linha só');
  assert.ok(compareCsv.includes('"10/2026";"Outubro de 2026";"1";"600";"590";"10";"10";"98.3";"0";"19";"31";"31"'), 'a variação vai em pontos para o CSV');
  assert.ok(compareCsv.includes('"09/2026";"Setembro de 2026";"1";"240";"236";"8";"4";"98.3";"";"8";"30";"30"'), 'o primeiro período não tem variação');
  assert.match(document.lastDownload, /comparacao\.csv$/, 'o CSV da comparação tem nome próprio');
  console.log('· exportações: PDF válido (A4), CSV com total e CSV de comparação');

  /* 15 · cópia de segurança: exportar, corromper, importar de volta */
  const storedBefore = JSON.parse(store.get('contacarta-registos-v4'));
  context.__exported = null;
  $('exportCopy').click();
  await wait(20);
  assert.ok(context.__exported, 'exportar cópia cria ficheiro');
  const copyText = await context.__exported.text();
  const copy = JSON.parse(copyText);
  assert.equal(copy.version, 6, 'a cópia declara a versão dos dados');
  assert.deepEqual([copy.lots.length, copy.stock.length], [fixture.lots.length, fixture.stock.length], 'a cópia leva lotes e material junto com os registos');
  assert.equal(copy.records.length, storedBefore.records.length, 'a cópia tem exactamente os registos guardados');
  assert.ok(copy.records.some((record) => record.period === 'month'), 'os tipos de registo passam intactos');
  assert.deepEqual(copy, storedBefore, 'exportar é a foto fiel do armazenamento');
  console.log('· cópias: exportação JSON fiel, com a versão actual');

  /* 16 · importar ficheiro inválido: recusa com mensagem e dados intactos */
  const untouched = store.get('contacarta-registos-v4');
  const pickFile = (file) => {
    $('fileInput').files = [file];
    $('fileInput').dispatch('change');
  };
  pickFile({ size: 20, name: 'copia.json', text: async () => '{ não é json' });
  await wait(30);
  has($('toast'), /não é JSON válido/);
  assert.equal(store.get('contacarta-registos-v4'), untouched, 'importação má nunca altera os dados');

  pickFile({ size: 40, name: 'velho.json', text: async () => JSON.stringify({ version: 3, registos: [] }) });
  await wait(30);
  has($('toast'), /não tem registos para converter/);
  assert.equal(store.get('contacarta-registos-v4'), untouched, 'JSON sem o campo certo é recusado');

  /* 17 · round-trip: uma cópia vazia apaga tudo, a original traz os dados de volta */
  pickFile({ size: 30, name: 'vazia.json', text: async () => JSON.stringify({ version: 4, records: [] }) });
  await wait(30);
  $('confirmYes').click();
  await wait(60);
  assert.equal(JSON.parse(store.get('contacarta-registos-v4')).records.length, 0, 'a cópia vazia foi aplicada');
  document.querySelectorAll('.nav-item')[0].click();
  await wait(10);
  has($('panelTable'), /Ainda sem registos neste período/);
  assert.equal($('panelTable').querySelectorAll('p').length, 0, 'o estado vazio não leva texto de ajuda');
  pickFile({ size: copyText.length, name: 'copia.json', text: async () => copyText });
  await wait(30);
  assert.equal($('confirmDialog').open, true, 'importar pede confirmação antes de substituir');
  has($('confirmText'), /vai substituir os actuais/);
  $('confirmYes').click();
  await wait(40);
  assert.deepEqual(JSON.parse(store.get('contacarta-registos-v4')), copy, 'a cópia importada volta a ser a original');
  has($('toast'), /Cópia importada/);
  has($('navCount'), new RegExp(String(copy.records.length)));
  console.log('· cópias: exportar → limpar → importar devolve os mesmos registos');

  /* 17b · uma cópia com movimentos, aberta onde não há onde os guardar: a pergunta diz que ficam de fora */
  const move = (id) => ({ id, type: 'stock_in', batchId: null, delegation: '', date: '2026-11-10', quantity: 5, metadata: { reference: 'GR-1', material: 'Papel' } });
  const withMoves = (list) => { const text = JSON.stringify({ ...copy, operations: list }); return { size: text.length, name: 'com-movimentos.json', text: async () => text }; };
  pickFile(withMoves([move('m1')]));
  await wait(30);
  has($('confirmText'), /vai substituir os actuais\. Traz também 1 movimento, que fica de fora: esta versão do programa não os guarda\.$/);
  $('confirmNo').click();
  await wait(20);
  pickFile(withMoves([]));
  await wait(30);
  has($('confirmText'), /vai substituir os actuais\.$/);
  $('confirmNo').click();
  await wait(20);
  pickFile(withMoves([move('m1'), move('m2')]));
  await wait(30);
  has($('confirmText'), /Traz também 2 movimentos, que ficam de fora/);
  $('confirmYes').click();
  await wait(40);
  assert.deepEqual(JSON.parse(store.get('contacarta-registos-v4')), copy, 'os registos entram; os movimentos não se misturam neles');
  console.log('· cópias: os movimentos de uma cópia nunca somem em silêncio');

  /* 18 · dados fictícios: juntam-se ao que existe e saem a pedido */
  document.querySelectorAll('.nav-item')[0].click();
  const beforeRecords = JSON.parse(store.get('contacarta-registos-v4')).records;
  const beforeSample = beforeRecords.length;
  const sampleCount = JSON.parse(read('app/sample.json')).records.length;
  assert.ok(sampleCount > 40, 'o exemplo tem de ter volume suficiente para demonstrar o painel');
  // o exemplo nunca pisa dias já ocupados: entra só o que não coincide
  const overlaps = (record) => beforeRecords.some((own) => record.start <= own.end && own.start <= record.end);
  const expectedAdd = JSON.parse(read('app/sample.json')).records.filter((record) => !overlaps(record)).length;
  assert.ok(expectedAdd > 0 && expectedAdd < sampleCount, 'o exemplo cobre dias já ocupados pelos registos do teste: só alguns entram');
  $('loadSample').click();
  await wait(20);
  assert.equal($('confirmDialog').open, true, 'carregar o exemplo também pede confirmação');
  has($('confirmText'), /ao lado dos teus/, /coincidem com registos/);
  $('confirmYes').click();
  await wait(40);
  const withSample = JSON.parse(store.get('contacarta-registos-v4'));
  assert.equal(withSample.records.length, beforeSample + expectedAdd, 'o exemplo acrescenta o que não coincide, nunca substitui');
  assert.ok(withSample.records.some((record) => record.id.startsWith('exemplo-')), 'exemplo carregado');
  has($('sampleLabel'), /Remover dados fict/);
  has($('toast'), /Exemplo carregado/);
  assert.equal($('loadSample').hidden, false, 'o exemplo está sempre acessível');
  // o painel abre no mês mais recente com dados; o exemplo vai até Dezembro de 2026
  has($('filterScope'), /\d{2}\/2026/);
  has($('kpis'), /Produzidas/, /Rej\. máquina/, /Rej\. qualidade/);
  assert.ok(/\d/.exec(text($('kpis'))), 'o painel mostra números com o exemplo carregado');
  has($('recordsTable'), /\d{2}\/2026/);

  $('loadSample').click();
  assert.equal($('confirmDialog').open, true, 'retirar o exemplo pede confirmação');
  has($('confirmText'), /Saem só os registos de exemplo/);
  $('confirmYes').click();
  await wait(40);
  const cleaned = JSON.parse(store.get('contacarta-registos-v4'));
  assert.equal(cleaned.records.some((record) => record.id.startsWith('exemplo-')), false, 'exemplo removido');
  assert.equal(cleaned.records.length, beforeSample, 'os registos reais ficam todos');
  console.log('· exemplo: juntar e retirar dados fictícios sem tocar nos reais');

  /* 19 · ajuda: cada ⓘ mostra um texto e fecha com Esc */
  const info = document.querySelector('[data-info="machines"]');
  info.click();
  assert.equal($('tip').hidden, false);
  assert.ok(text($('tip')).length > 30, 'a ajuda tem de explicar alguma coisa');
  assert.match(text($('tip')), /produziu a máquina/, 'o botão 🛈 mostra o texto do mapa de ajuda');
  document.dispatch('keydown', { key: 'Escape' });
  assert.equal($('tip').hidden, true);
  console.log('· ajuda: o ícone abre e fecha a caixa de explicação');

  /* 21 · lupa: ampliar o gráfico do painel e do relatório */
  const chartZoom = $('chartZoom');
  assert.equal(chartZoom.hidden, true, 'a lupa começa fechada');
  $('chartZoomOpen').click();
  assert.equal(chartZoom.hidden, false, 'o botão da lupa abre o ampliador');
  assert.equal($('chartZoomTitle').textContent, 'Evolução em 2026');
  assert.match($('chartZoomStage').innerHTML, /<svg/, 'a lupa desenha o mesmo tipo de gráfico');
  $('zoomIn').click();
  assert.equal($('zoomLevel').textContent, '135%');
  $('zoomIn').click();
  assert.equal($('zoomLevel').textContent, '182%');
  $('zoomOut').click();
  assert.equal($('zoomLevel').textContent, '135%');
  $('zoomReset').click();
  assert.equal($('zoomLevel').textContent, '100%');
  document.dispatch('keydown', { key: 'Escape' });
  assert.equal(chartZoom.hidden, true, 'o Escape fecha a lupa');
  document.querySelectorAll('.nav-item')[2].click();
  // volta ao relatório semanal simples (a secção anterior deixou uma comparação aberta)
  $('reportKind').value = 'week';
  $('reportKind').dispatch('change');
  await wait(10);
  $('reportDates').querySelectorAll('input')[0].value = '2026-11-16';
  $('reportDates').querySelectorAll('input')[0].dispatch('change');
  await wait(10);
  $('reportChartZoom').click();
  assert.equal(chartZoom.hidden, false, 'o relatório também abre a lupa');
  assert.equal($('chartZoomTitle').textContent, 'Evolução');
  $('zoomClose').click();
  assert.equal(chartZoom.hidden, true, 'o botão de fechar devolve o foco');
  document.querySelectorAll('.nav-item')[2].click();
  console.log('· lupa: abrir, ampliar, repor e fechar (Escape e botão)');

  /* 22 · relatórios de rejeição: máquina e teste de qualidade */
  const kindForRejection = $('reportKind');
  kindForRejection.value = 'rejectionMachine';
  kindForRejection.dispatch('change');
  await wait(10);
  const rejInputs = [...$('reportDates').querySelectorAll('input')].filter((node) => node.type === 'text');
  assert.equal(rejInputs.length, 2, 'os relatórios de rejeição pedem o período');
  assert.equal($('reportDates').querySelectorAll('.date-pick').length, 2, 'cada data do período é uma caixa de data');
  rejInputs[0].value = '2026-09-01';
  rejInputs[0].dispatch('change');
  await wait(10);
  rejInputs[1].value = '2026-10-31';
  rejInputs[1].dispatch('change');
  await wait(10);
  has($('paper'), /Relatório de rejeição da máquina/);
  has($('paper'), /Evolução das rejeições da máquina/);
  has($('paper'), /Rej\. qualidade/);
  assert.match($('paper').innerHTML, /<svg/, 'o papel da rejeição leva o seu gráfico');
  context.__exported = null;
  $('exportCsv').click();
  await wait(30);
  const rejectionCsv = (await context.__exported.text()).replace(/^\uFEFF/, '');
  assert.match(rejectionCsv, /"Relatório";"Relatório de rejeição da máquina"/);
  assert.ok(rejectionCsv.includes('"Origem";"Produzidas";"Rej. máquina";"Rej. no teste de qualidade"'),
    'o CSV da rejeição tem cabeçalho próprio');
  assert.ok(rejectionCsv.includes('"Total";"840";"18";"14"'), 'o CSV da rejeição soma as duas rejeições');
  assert.match(document.lastDownload, /rejeicao-maquina\.csv$/);
  context.__exported = null;
  $('exportPdf').click();
  await wait(160);
  const rejectionPdf = Buffer.from(await context.__exported.arrayBuffer());
  const rejectionReadable = rejectionPdf.toString('latin1').replace(/\\(\d{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
  assert.equal(rejectionPdf.subarray(0, 8).toString('latin1').trim(), '%PDF-1.4');
  assert.match(rejectionReadable, /Relatório de rejeição da máquina/, 'o título vai para o papel da rejeição');
  assert.match(rejectionReadable, /Rej\. qualidade/, 'as duas rejeições aparecem no PDF');
  assert.match(document.lastDownload, /rejeicao-maquina\.pdf$/, 'o PDF da rejeição tem nome próprio');

  kindForRejection.value = 'rejectionQuality';
  kindForRejection.dispatch('change');
  await wait(10);
  has($('paper'), /Relatório de rejeição no teste de qualidade/);
  has($('paper'), /Evolução das rejeições no teste de qualidade/);
  context.__exported = null;
  $('exportCsv').click();
  await wait(30);
  const qualityCsv = (await context.__exported.text()).replace(/^\uFEFF/, '');
  assert.match(qualityCsv, /"Relatório";"Relatório de rejeição no teste de qualidade"/);
  assert.match(document.lastDownload, /rejeicao-qualidade\.csv$/);
  kindForRejection.value = 'week';
  kindForRejection.dispatch('change');
  await wait(10);
  console.log('· rejeição: relatórios, pré-visualização, PDF e CSV próprios');

  /* 20a · a barra de alertas do Painel fala do que há a tratar */
  document.querySelectorAll('.nav-item')[0].click();
  await wait(10);
  assert.equal($('panelAlerts').hidden, false, 'há material e lotes a tratar');
  has($('panelAlerts'), /A tratar:/, /2 materiais no mínimo/, /2 materiais por entregar/, /1 lote por despachar/);
  $('panelAlerts').querySelector('[data-alert-view="lots"]').click();
  await wait(10);
  assert.equal($('view-lots').hidden, false, 'o alerta leva à vista certa');
  // o mini-DOM não reflecte `selected` em `.value`: a marca fica no atributo da opção
  const marked = [...$('lotsStage').querySelectorAll('option')].filter((option) => option.hasAttribute('selected'));
  assert.deepEqual(marked.map((option) => text(option)), ['Despacho'], 'e já com a fase escolhida');
  assert.equal($('lotsTable').querySelectorAll('tbody tr').length, 1, 'a lista mostra só o lote que falta despachar');
  $('panelAlerts') && document.querySelectorAll('.nav-item')[0].click();
  await wait(5);
  console.log('· painel: barra de alertas com o material e os lotes a tratar');

  /* 20b · armazém: tira de KPIs, tabela, filtro por tipo e diálogo do material */
  document.querySelectorAll('.nav-item')[1].click();
  await wait(10);
  assert.equal($('view-stock').hidden, false);
  has($('viewTitle'), /Armazém/);
  has($('stockKpis'), /Cartões em armazém/, /3000/, /Material em alerta/, /2/, /Por entregar/, /2/, /Material controlado/);
  const stockRows = $('stockTable').querySelectorAll('tbody tr');
  assert.equal(stockRows.length, 3, 'três materiais na fixture');
  has(stockRows[0], /Cartão em branco/, /cartões/);
  assert.ok(stockRows[0].classList.contains('is-low'), 'o que está no mínimo fica assinalado');
  const cardRow = stockRows.find((row) => /Cartão em branco/.test(text(row)));
  has(cardRow, /130 000/, /10 000/, /120 000/, /3000 cartões/, /entregue em 06\/10\/2026/);
  const stockHead = [...$('stockTable').querySelectorAll('thead th')].map((cell) => text(cell));
  assert.deepEqual(stockHead, ['Material', 'Tipo', 'Contratado', 'Por entregar', 'Recebido', 'Dado', 'Em armazém', 'Mínimo', '']);
  $('stockKind').value = 'tonner';
  $('stockKind').dispatch('change');
  await wait(5);
  assert.equal($('stockTable').querySelectorAll('tbody tr').length, 1, 'o filtro por tipo deixa só os tinteiros');
  $('stockKind').value = '';
  $('stockKind').dispatch('change');
  await wait(5);

  const recordsBefore = JSON.parse(store.get('contacarta-registos-v4')).records.length;
  $('stockAdd').click();
  assert.equal($('stockDialog').open, true);
  // um material novo, fora do contrato, escreve-se: os dados estão livres e não há nada para destrancar
  assert.equal($('stockIdentity').disabled, false, 'num material novo os dados escrevem-se');
  assert.equal($('stockEditWrap').hidden, true, 'e o interruptor «Editar» não aparece');
  assert.equal($('stockPickWrap').hidden, false, 'a lista do contrato está à mão');
  assert.equal($('stockDelivered').closest('.date-pick') !== null, true, 'a data da entrega é uma caixa de data');
  assert.equal($('stockUpdated').closest('.date-pick').querySelector('.date-native').type, 'date', 'com o calendário do sistema');
  $('stockName').value = 'Álcool';
  $('stockReceived').value = '4';
  $('stockIssued').value = '5';
  $('stockDialog').querySelector('form').dispatch('submit');
  await wait(10);
  assert.equal($('stockError').hidden, false, 'dar mais do que se recebeu é recusado');
  has($('stockError'), /não cabem em 4 recebidos/);
  $('stockIssued').value = '3';
  $('stockReceived').value = '4';
  $('stockDialog').querySelector('form').dispatch('submit');
  await wait(10);
  assert.equal($('stockDialog').open, false, 'material válido fecha o diálogo');
  assert.equal($('stockTable').querySelectorAll('tbody tr').length, 4, 'e aparece na tabela');
  has($('stockTable'), /Álcool/);
  const savedStock = JSON.parse(store.get('contacarta-registos-v4'));
  assert.equal(savedStock.stock.length, 4, 'o material novo fica gravado com o resto');
  assert.equal(savedStock.records.length, recordsBefore, 'gravar material não mexe nos registos');
  console.log('· armazém: KPIs, tabela, filtro por tipo e material novo validado');

  /* 20d · a barra lateral recolhe para a TV e o botão diz o que faz */
  const appShell = document.querySelector('.app');
  assert.equal($('sideToggle').getAttribute('aria-expanded'), 'true');
  assert.equal(appShell.classList.contains('is-collapsed'), false);
  $('sideToggle').click();
  assert.equal(appShell.classList.contains('is-collapsed'), true, 'recolhida, a barra deixa a TV só com os números');
  assert.equal($('sideToggle').getAttribute('aria-expanded'), 'false');
  assert.match($('sideToggle').getAttribute('aria-label'), /Abrir/);
  $('sideToggle').click();
  assert.equal(appShell.classList.contains('is-collapsed'), false, 'volta a abrir e a aplicação inteira continua lá');
  console.log('· barra lateral: abre e fecha, com o rótulo certo');

  /* 20e · o armazém parte da lista do contrato: nada de escrever nomes */
  $('stockAdd').click();
  const pick = $('stockPick');
  const contractOptions = pick.querySelectorAll('option');
  assert.ok(contractOptions.length >= 2, 'o formulário oferece os itens do contrato');
  assert.match(pick.querySelectorAll('option')[0].textContent, /fora do contrato/, 'a primeira opção é a do material que o contrato não tem');
  const firstItem = contractOptions[1].value;
  pick.value = firstItem;
  pick.dispatch('change');
  const picked = contractOptions[1].textContent.replace(/^\d+\.\s*/, '');
  assert.equal($('stockName').value, picked, 'escolher o item preenche o nome');
  assert.ok(Number($('stockContracted').value) > 0, 'e traz a quantidade contratada do papel');
  assert.ok(Number($('stockMinimum').value) > 0, 'e um mínimo de alerta sugerido (10 %)');
  // o que vem do contrato lê-se: fica trancado, e só o interruptor o abre
  assert.equal($('stockIdentity').disabled, true, 'o nome, o tipo, a unidade e o contratado ficam trancados');
  assert.deepEqual(['stockName', 'stockFormKind', 'stockUnit', 'stockContracted'].map((id) => $(id).closest('fieldset').id), Array(4).fill('stockIdentity'));
  assert.deepEqual(['stockReceived', 'stockIssued', 'stockMinimum'].map((id) => $(id).closest('fieldset')), [null, null, null], 'as quantidades do armazém nunca ficam trancadas');
  assert.deepEqual([$('stockEditWrap').hidden, $('stockEdit').checked], [false, false], 'o interruptor aparece, desligado');
  has($('stockLockNote'), /São os dados do contrato/, /liga «Editar»/);
  $('stockEdit').checked = true;
  $('stockEdit').dispatch('change');
  assert.equal($('stockIdentity').disabled, false, '«Editar» abre os dados');
  has($('stockLockNote'), /Estás a corrigir/);
  // escolher outro item volta a trancar, com o interruptor outra vez desligado
  pick.value = contractOptions[2].value;
  pick.dispatch('change');
  assert.deepEqual([$('stockIdentity').disabled, $('stockEdit').checked], [true, false]);
  pick.value = '';
  pick.dispatch('change');
  assert.deepEqual([$('stockIdentity').disabled, $('stockEditWrap').hidden, $('stockName').value, $('stockContracted').value], [false, true, '', ''],
    'voltar a «fora do contrato» devolve os campos, em branco');
  $('stockDialog').close();

  // um artigo que já existe abre com os dados trancados e sem a lista do contrato
  const stockBefore = JSON.parse(store.get('contacarta-registos-v4')).stock;
  $('stockTable').querySelector('[data-stock-edit]').click();
  await wait(5);
  const opened = stockBefore.find((item) => item.name === $('stockName').value);
  assert.ok(opened, 'o diálogo abre o artigo da linha');
  assert.deepEqual([$('stockIdentity').disabled, $('stockPickWrap').hidden, $('stockEditWrap').hidden, $('stockEdit').checked], [true, true, false, false]);
  has($('stockLockNote'), /liga «Editar»/);
  $('stockReceived').value = String(opened.received + 5);
  $('stockDialog').querySelector('form').dispatch('submit');
  await wait(10);
  assert.equal($('stockDialog').open, false);
  const stockAfter = JSON.parse(store.get('contacarta-registos-v4')).stock.find((item) => item.id === opened.id);
  assert.deepEqual([stockAfter.name, stockAfter.kind, stockAfter.unit, stockAfter.contracted, stockAfter.received], [opened.name, opened.kind, opened.unit, opened.contracted, opened.received + 5],
    'actualizar as quantidades não mexe no que está trancado');
  // com «Editar», o nome corrige-se — e fica corrigido
  $('stockTable').querySelector('[data-stock-edit]').click();
  await wait(5);
  $('stockEdit').checked = true;
  $('stockEdit').dispatch('change');
  $('stockName').value = `${opened.name} (corrigido)`;
  $('stockDialog').querySelector('form').dispatch('submit');
  await wait(10);
  assert.equal(JSON.parse(store.get('contacarta-registos-v4')).stock.find((item) => item.id === opened.id).name, `${opened.name} (corrigido)`);
  // e o teste deixa o artigo como estava
  $('stockTable').querySelector('[data-stock-edit]').click();
  await wait(5);
  assert.equal($('stockEdit').checked, false, 'o interruptor volta sempre desligado');
  $('stockEdit').checked = true;
  $('stockEdit').dispatch('change');
  $('stockName').value = opened.name;
  $('stockReceived').value = String(opened.received);
  $('stockDialog').querySelector('form').dispatch('submit');
  await wait(10);
  const byId = (list) => list.slice().sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(byId(JSON.parse(store.get('contacarta-registos-v4')).stock), byId(stockBefore));
  console.log('· armazém: o contrato preenche o formulário, e o que vem de lá só se muda com «Editar»');


  /* 20c · lotes: quadro de fases, filtro e lote novo até ao despacho */
  document.querySelectorAll('.nav-item')[2].click();
  await wait(10);
  // o alerta deixou o filtro na fase do despacho: aqui vê-se o quadro todo
  $('lotsStage').value = '';
  $('lotsStage').dispatch('change');
  await wait(5);
  assert.equal($('view-lots').hidden, false);
  has($('viewTitle'), /Lotes/);
  has($('lotKpis'), /Lotes abertos/, /2/, /Por despachar/, /Despachados/, /Cartas em lotes/, /840/);
  const lotRows = $('lotsTable').querySelectorAll('tbody tr');
  assert.equal(lotRows.length, 2);
  has(lotRows[0], /L-2026-102/, /Delegação da Matola/, /600/, /em curso/, /por fazer/);
  has(lotRows[1], /L-2026-101/, /Maputo/, /240/, /06\/09\/2026/);
  $('lotsStage').value = 'despacho';
  $('lotsStage').dispatch('change');
  await wait(5);
  assert.equal($('lotsTable').querySelectorAll('tbody tr').length, 1, 'só falta despachar um lote');
  $('lotsStage').value = '';
  $('lotsStage').dispatch('change');
  await wait(5);

  $('lotsAdd').click();
  // cada fase encabeça o próprio bloco e os campos alinham-se por baixo
  const stageRows = $('lotStages').querySelectorAll('.lot-stage-row');
  assert.equal(stageRows.length, 4, 'as quatro fases continuam lá');
  assert.equal(stageRows[0].querySelector('.lot-stage-name').textContent, 'Personalização');
  assert.equal(stageRows[0].querySelectorAll('.lot-stage-fields .field').length, 3, 'estado, data e cartas alinhados');
  assert.ok(stageRows[0].querySelector('.stage-chip'), 'o estado também se lê como etiqueta');
  assert.equal(stageRows[0].querySelectorAll('.date-pick').length, 1, 'a data da fase é uma caixa de data só');
  assert.equal(stageRows[0].querySelector('.date-native').type, 'date', 'com o calendário do sistema');
  assert.match($('lotStart').value, /^\d{2}\/\d{2}\/\d{4}$/, 'a abertura do lote mostra dd/mm/aaaa (hoje)');
  assert.equal($('lotDialog').open, true);
  assert.equal($('lotDelegation').querySelectorAll('option').length, 12, 'um lote novo escolhe a delegação do catálogo');
  assert.equal($('lotDelegation').value, '', 'e começa por escolher');
  $('lotReference').value = 'L-2026-103';
  $('lotDelegation').value = 'Delegação da Beira';
  $('lotQuantity').value = '320';
  $('lotStart').value = '16/11/2026';
  $('lotDialog').querySelector('form').dispatch('submit');
  await wait(10);
  assert.equal($('lotDialog').open, false, 'lote válido fecha o diálogo');
  assert.equal($('lotsTable').querySelectorAll('tbody tr').length, 3);
  has($('lotsTable'), /L-2026-103/, /Delegação da Beira/, /320/);
  const savedLots = JSON.parse(store.get('contacarta-registos-v4'));
  assert.equal(savedLots.lots.length, 3, 'o lote novo fica gravado com o resto');
  assert.equal(savedLots.stock.length, 4, 'gravar o lote não perde o material');
  assert.equal(savedLots.records.length, recordsBefore, 'nem mexe nos registos');

  // marcar as fases todas despacha o lote: o quadro diminui nos por despachar
  $('lotsTable').querySelector('[data-lot-edit]').click();
  await wait(10);
  assert.equal($('lotDialog').open, true);
  // este lote foi gravado com um nome que não é do catálogo: ao abri-lo, o nome continua lá, escolhido
  const keptDelegation = $('lotDelegation').value;
  assert.ok(keptDelegation && !/^(Beira|Matola|Maputo Cidade)$/.test(keptDelegation), 'o lote aberto tem uma delegação escrita à antiga');
  const lotChoices = $('lotDelegation').querySelectorAll('option');
  assert.equal(lotChoices.length, 13, 'as onze do catálogo, a escolha vazia e o nome antigo');
  assert.deepEqual([lotChoices[12].value, lotChoices[12].textContent], [keptDelegation, `${keptDelegation} (registo anterior)`]);
  const stageSelects = $('lotStages').querySelectorAll('select');
  assert.equal(stageSelects.length, 4, 'uma fase por linha');
  for (const select of stageSelects) { select.value = 'feito'; }
  $('lotDialog').querySelector('form').dispatch('submit');
  await wait(10);
  assert.equal($('lotDialog').open, false);
  const afterDispatch = JSON.parse(store.get('contacarta-registos-v4')).lots.find((lot) => lot.reference === 'L-2026-103');
  assert.equal(afterDispatch.closed, true, 'o lote fica fechado quando todas as fases estão feitas');
  assert.equal(JSON.parse(store.get('contacarta-registos-v4')).lots.find((lot) => lot.delegation === keptDelegation) !== undefined, true,
    'guardar um lote antigo não lhe tira a delegação');
  console.log('· lotes: quadro de fases, filtro por fase e lote novo gravado com as quatro fases');
  document.querySelectorAll('.nav-item')[4].click();
  await wait(5);

  /* 20d · os três relatórios novos desenham tabela própria e exportam CSV */
  const kindsNew = $('reportKind');
  kindsNew.value = 'reasons';
  kindsNew.dispatch('change');
  await wait(10);
  const reasonDates = [...$('reportDates').querySelectorAll('input')].filter((node) => node.type === 'text');
  assert.equal(reasonDates.length, 2, 'motivos pede o intervalo De/Até');
  assert.equal($('reportDates').querySelectorAll('.date-pick').length, 2, 'e cada data é uma caixa só');
  reasonDates[0].value = '2026-09-01';
  reasonDates[0].dispatch('change');
  reasonDates[1].value = '2026-10-31';
  reasonDates[1].dispatch('change');
  await wait(10);
  has($('paper'), /Motivos de rejeição \(INCAPE\)/, /Cartas chumbadas por motivo/, /Categoria/, /Motivo/, /Total/);
  has($('paper'), /Material: riscos/, /Total/);
  assert.ok(!/Nenhuma carta chumbada/.test(text($('paper'))), 'o período tem chumbadas');
  kindsNew.value = 'lots';
  kindsNew.dispatch('change');
  await wait(10);
  has($('paper'), /Lotes por despachar/, /L-2026-10[12]/, /Delegação da Matola/, /Personalização|Impressão/);
  assert.match(text($('reportDates').querySelectorAll('input')[0] || { textContent: '' }), /.*/);
  kindsNew.value = 'stock';
  kindsNew.dispatch('change');
  await wait(10);
  assert.equal($('reportDates').querySelectorAll('input').length, 0, 'o armazém não tem período');
  has($('paper'), /Armazém e material/, /Material em armazém/, /Cartão em branco/, /Em armazém/);
  has($('reportHint'), /artigos no armazém/);
  $('exportCsv').click();
  await wait(30);
  const stockCsv = (await context.__exported.text()).replace(/^\uFEFF/, '');
  assert.match(stockCsv, /"Relatório";"Armazém e material"/);
  assert.match(stockCsv, /"Material";"Tipo";"Unidade";"Contratado";"Por entregar";"Entregue";"Dado";"Em armazém";"Mínimo";"Data da entrega";"Actualizado"/);
  assert.ok(stockCsv.includes('"Cartão em branco";"Cartão em branco";"cartões";"130000";"10000";"120000";"117000";"3000"'), 'o saldo vai calculado');
  assert.match(document.lastDownload, /armazem\.csv$/, 'o CSV do armazém tem nome próprio');
  // cada um dos três também sai em PDF: páginas válidas, com a tabela própria
  const pdfFor = async (kind, pattern) => {
    kindsNew.value = kind;
    kindsNew.dispatch('change');
    await wait(10);
    if (kind === 'reasons' || kind === 'lots') {
      const inputs = [...$('reportDates').querySelectorAll('input')].filter((node) => node.type === 'text');
      inputs[0].value = '2026-09-01';
      inputs[0].dispatch('change');
      inputs[1].value = '2026-10-31';
      inputs[1].dispatch('change');
      await wait(10);
    }
    context.__exported = null;
    $('exportPdf').click();
    await wait(200);
    const bytes = Buffer.from(await context.__exported.arrayBuffer());
    const raw = bytes.toString('latin1');
    assert.equal(raw.slice(0, 5), '%PDF-', `${kind}: assinatura de PDF`);
    assert.match(raw, /%%EOF/, `${kind}: ficheiro fechado`);
    assert.ok(bytes.length > 3000, `${kind}: o PDF tem conteúdo (${bytes.length} bytes)`);
    const pages = Number((raw.match(/\/Count (\d+)/) || [])[1]);
    assert.ok(pages >= 1 && pages <= 8, `${kind}: ${pages} página(s)`);
    assert.ok(raw.includes(pattern), `${kind}: a tabela própria aparece no documento`);
    return { bytes, pages };
  };
  await pdfFor('stock', 'Material em armaz');
  const reasonsPdf = await pdfFor('reasons', 'Cartas chumbadas por motivo');
  const lotsPdf = await pdfFor('lots', 'Lotes no per');
  assert.ok(lotsPdf.pages >= reasonsPdf.pages, 'o relatório de lotes leva tabela e quadro de fases');
  kindsNew.value = 'month';
  kindsNew.dispatch('change');
  await wait(5);
  console.log('· relatórios novos: motivos, lotes e armazém com tabela, CSV, PDF e nome próprios');


  /* 22a · motivos por carta dentro do lote: quantidades, totais, filtro e gravação */
  const beforeReasons = JSON.parse(store.get('contacarta-registos-v4'));
  document.querySelectorAll('.nav-item')[3].click();
  await wait(5);
  $('dayAdd').click();
  await wait(5);
  $('recordDate').value = '17/11/2026';
  $('recordDate').dispatch('change');
  $('entryReference').value = 'L-2026-904';
  $('entryPlanned').value = '140';
  $('m0p').value = '140';
  $('m0r').value = '20';
  $('m0q').value = '20';
  $('entryPlanned').dispatch('input');
  assert.match(text($('reasonsSum')), /20 por justificar/, 'o formulário diz quantas chumbadas ainda não têm motivo');
  $('rf-material-lamina').value = '12';
  $('rf-bio-foto').value = '8';
  $('reasonInputs').dispatch('input');
  assert.equal(text($('rt-material-lamina')), '12', 'cada motivo mostra o próprio total');
  assert.equal(text($('rt-bio-foto')), '8');
  assert.equal(text($('rt-outro')), '—', 'os motivos sem cartas ficam a traço');
  assert.equal(text($('reasonsSum')), 'todas justificadas', 'quando a soma bate certo, diz-se');
  $('reasonsFilter').value = 'laminado';
  $('reasonsFilter').dispatch('input');
  assert.equal($('reasonInputs').querySelectorAll('[data-reason]').filter((row) => !row.hidden).length, 1, 'filtrar deixa só o motivo que interessa');
  assert.equal($('rf-material-lamina').value, '12', 'filtrar não estraga o que foi escrito');
  $('reasonsFilter').value = '';
  $('reasonsFilter').dispatch('input');
  assert.equal($('reasonInputs').querySelectorAll('[data-reason]').filter((row) => !row.hidden).length, 7, 'há uma saída «Outro» além dos seis do INCAPE');
  $('recordForm').dispatch('submit');
  await wait(30);
  $('dialogClose').click();
  const withReasons = JSON.parse(store.get('contacarta-registos-v4')).records
    .find((record) => record.start === '2026-11-17').entries.find((entry) => entry.reference === 'L-2026-904').reasons;
  assert.deepEqual(withReasons.map((entry) => [entry.code, entry.quantity]), [['bio-foto', 8], ['material-lamina', 12]],
    'os motivos ficam gravados no lote, com a quantidade');
  // o painel mostra os motivos por carta quando se pede
  document.querySelectorAll('.nav-item')[0].click();
  $('filterMonth').value = '11/2026';
  $('filterMonth').dispatch('change');
  await wait(10);
  $('panelReasonsBtn').click();
  assert.equal($('panelReasons').hidden, false, 'o botão abre os motivos por carta');
  has($('panelReasons'), /Material/, /12/);
  $('panelReasonsBtn').click();
  assert.equal($('panelReasons').hidden, true, 'e volta a fechar');
  // repõe o estado para o que falte correr depois
  store.set('contacarta-registos-v4', JSON.stringify(beforeReasons));
  console.log('· motivos por carta: quantidades no lote, totais, filtro, gravação e painel');
  /* 22b · sem chumbadas no teste, o painel dos motivos não aparece (menos um scroll) */
  document.querySelectorAll('.nav-item')[0].click();
  $('filterMonth').value = '08/2026';
  $('filterMonth').dispatch('change');
  await wait(5);
  assert.equal($('reasonsDrawer').hidden, true, 'um mês sem chumbadas no teste não mostra o bloco dos motivos');
  // e com o bloco fora, a máquina e a sua produção continuam à vista
  has($('machineCards'), /Máquina 1/, /0/);
  // Outubro, no fixture, tem chumbadas: aí o bloco volta
  $('filterMonth').value = '10/2026';
  $('filterMonth').dispatch('change');
  await wait(5);
  assert.equal($('reasonsDrawer').hidden, false, 'com chumbadas, o botão dos motivos volta');
  console.log('· motivos: o bloco só existe quando há chumbadas no teste');


  /* 22c · o exemplo entra mesmo quando já existe um lote com a referência de um dos seus */
  const sampleFile = JSON.parse(read('app/sample.json'));
  document.querySelectorAll('.nav-item')[2].click();
  await wait(5);
  $('lotsAdd').click();
  $('lotReference').value = sampleFile.lots[0].reference;
  $('lotDelegation').value = 'Beira';
  $('lotQuantity').value = '10';
  $('lotStart').value = '16/11/2026';
  $('lotDialog').querySelector('form').dispatch('submit');
  await wait(10);
  assert.equal($('lotDialog').open, false, 'o lote com a referência do exemplo fica gravado');
  const ownState = JSON.parse(store.get('contacarta-registos-v4'));
  $('loadSample').click();
  await wait(20);
  has($('confirmText'), new RegExp(`${sampleFile.lots.length - 1} lotes`), /ao lado dos teus/);
  $('confirmYes').click();
  await wait(40);
  const withClash = JSON.parse(store.get('contacarta-registos-v4'));
  assert.ok(withClash.records.some((item) => item.id.startsWith('exemplo-')), 'o exemplo entrou, em vez de esbarrar no lote repetido');
  assert.equal(withClash.lots.length, ownState.lots.length + sampleFile.lots.length - 1, 'entram os lotes do exemplo menos o que já existia');
  assert.equal(withClash.lots.filter((lot) => lot.reference === sampleFile.lots[0].reference).length, 1, 'e o teu lote fica como estava');
  $('loadSample').click();
  await wait(20);
  $('confirmYes').click();
  await wait(40);
  const afterClash = JSON.parse(store.get('contacarta-registos-v4'));
  assert.deepEqual([afterClash.records.length, afterClash.lots.length, afterClash.stock.length], [ownState.records.length, ownState.lots.length, ownState.stock.length],
    'retirar o exemplo deixa os teus registos, os teus lotes e o teu material');
  console.log('· exemplo: entra ao lado de um lote com a mesma referência e sai sem levar o que é teu');

  /* 22d · um lado só: o lote puxado para um dia vem trancado, e o que se corrige fica no lote */
  const stateNow = () => JSON.parse(store.get('contacarta-registos-v4'));
  const lotNow = (reference) => stateNow().lots.find((lot) => lot.reference === reference);
  const stageNow = (reference, stage) => { const now = lotNow(reference).stages[stage]; return [now.state, now.quantity, now.updated]; };
  const pointedNow = () => stateNow().records.filter((record) => record.start >= '2026-12-01' && record.start <= '2026-12-09')
    .sort((a, b) => a.start.localeCompare(b.start))
    .flatMap((record) => record.entries.map((entry) => [record.start, entry.reference, entry.delegation, entry.planned, entry.produced]));
  const flip = (id, on) => { $(id).checked = on; $(id).dispatch('change'); };
  const showLot = async (reference) => {
    document.querySelectorAll('.nav-item')[2].click();
    await wait(5);
    $('lotsStage').value = '';
    $('lotsStage').dispatch('change');
    await wait(5);
    [...$('lotsTable').querySelectorAll('tbody tr')].find((line) => text(line).includes(reference)).querySelector('[data-lot-edit]').click();
    await wait(5);
  };

  // um lote novo no quadro: os dados escrevem-se, não há nada para destrancar
  document.querySelectorAll('.nav-item')[2].click();
  await wait(5);
  $('lotsAdd').click();
  assert.deepEqual([$('lotIdentity').disabled, $('lotEditWrap').hidden], [false, true], 'num lote novo os dados escrevem-se');
  assert.deepEqual($('lotStages').querySelectorAll('.lot-stage-fields').map((set) => set.disabled), [false, false, false, false]);
  $('lotReference').value = 'L-2026-200';
  $('lotDelegation').value = 'Beira';
  $('lotQuantity').value = '500';
  $('lotStart').value = '30/11/2026';
  $('lotDialog').querySelector('form').dispatch('submit');
  await wait(10);
  assert.equal($('lotDialog').open, false);
  const prepared = lotNow('L-2026-200');

  // no dia, a lista oferece-o — e só os lotes que ainda têm cartas por imprimir
  document.querySelectorAll('.nav-item')[3].click();
  await wait(5);
  $('dayAdd').click();
  $('recordDate').value = '01/12/2026';
  $('recordDate').dispatch('change');
  await wait(5);
  const offered = $('entryLot').querySelectorAll('option').map((option) => option.textContent);
  assert.ok(offered.includes('L-2026-200 · Beira · 500 cartas'), 'o lote preparado está na lista, com a delegação e as cartas à vista');
  assert.ok(!offered.some((label) => /L-2026-10[123]/.test(label)), 'um lote já todo impresso não se oferece');

  // escolhê-lo traz os dados dele, trancados
  $('entryLot').value = prepared.id;
  $('entryLot').dispatch('change');
  assert.deepEqual([$('entryReference').value, $('entryDelegation').value, $('entryPlanned').value], ['L-2026-200', 'Beira', '500']);
  assert.equal($('entryIdentity').disabled, true, 'a referência, a delegação e as cartas ficam trancadas');
  assert.deepEqual(['entryReference', 'entryDelegation', 'entryPlanned'].map((id) => $(id).closest('fieldset').id), Array(3).fill('entryIdentity'));
  assert.deepEqual(['entryMachine', 'm0p', 'm0r', 'm0q'].map((id) => $(id).closest('fieldset')), [null, null, null, null], 'o que é do dia (a máquina, as quantidades) nunca fica trancado');
  assert.deepEqual([$('entryEditWrap').hidden, $('entryEdit').checked], [false, false], 'o interruptor «Editar» aparece, desligado');
  has($('entryLockNote'), /São os dados do lote L-2026-200/, /liga «Editar»/);
  $('m0p').value = '200';
  $('m0q').value = '10';
  $('m0p').dispatch('input');
  has($('entryLive'), /200 de 500 cartas/, /faltam 300/);
  $('recordForm').dispatch('submit');
  await wait(30);
  assert.deepEqual(pointedNow(), [['2026-12-01', 'L-2026-200', 'Beira', 500, 200]]);
  assert.equal(stateNow().records.find((record) => record.start === '2026-12-01').entries[0].lotId, prepared.id, 'a entrada fica ligada ao lote do quadro');
  // o quadro acompanha sozinho: boas as que saíram menos as chumbadas; aprovadas as das entradas concluídas
  assert.deepEqual(stageNow('L-2026-200', 'impressao'), ['em-curso', 190, '2026-12-01']);
  assert.deepEqual(stageNow('L-2026-200', 'qualidade'), ['em-curso', 190, '2026-12-01']);
  assert.equal(stageNow('L-2026-200', 'personalizacao')[0], 'pendente', 'as fases que o dia não conhece ficam como estavam');
  // já apontado nesse dia, o lote sai da lista; noutro dia volta a estar
  assert.ok(!$('entryLot').querySelectorAll('option').some((option) => option.value === prepared.id), 'no mesmo dia o lote não se aponta duas vezes');
  $('recordDate').value = '02/12/2026';
  $('recordDate').dispatch('change');
  await wait(5);
  assert.ok($('entryLot').querySelectorAll('option').some((option) => option.value === prepared.id), 'noutro dia o lote volta à lista');

  // escrever à mão a referência de um lote do quadro não cria um segundo lote: puxa o do quadro e pára, para se conferir
  $('entryReference').value = 'l-2026-200';
  $('entryDelegation').value = 'Tete';
  $('entryPlanned').value = '77';
  $('m0p').value = '100';
  $('recordForm').dispatch('submit');
  await wait(30);
  assert.equal($('formError').hidden, false);
  has($('formError'), /L-2026-200 é um lote do quadro/, /Confere e guarda outra vez/);
  assert.deepEqual([$('entryLot').value, $('entryReference').value, $('entryDelegation').value, $('entryPlanned').value, $('entryIdentity').disabled],
    [prepared.id, 'L-2026-200', 'Beira', '500', true], 'os dados passam a ser os do lote, trancados');
  assert.equal(pointedNow().length, 1, 'e nada se grava antes de se conferir');
  $('m0p').dispatch('input');
  has($('entryLive'), /100 de 310 cartas por fazer/, /o lote já tinha 190 boas/, /faltam 210/);

  // «Editar» abre os dados, e o que se corrige fica no lote — e em todos os dias em que ele foi apontado
  flip('entryEdit', true);
  assert.equal($('entryIdentity').disabled, false, '«Editar» abre os dados do lote');
  has($('entryLockNote'), /Estás a corrigir o lote L-2026-200/);
  $('entryDelegation').value = 'Nampula';
  $('entryPlanned').value = '600';
  $('recordForm').dispatch('submit');
  await wait(30);
  has($('toast'), /O lote L-2026-200 ficou corrigido no quadro e em todos os dias/);
  assert.deepEqual([lotNow('L-2026-200').delegation, lotNow('L-2026-200').quantity], ['Nampula', 600], 'a correcção ficou no lote');
  assert.deepEqual(pointedNow(), [['2026-12-01', 'L-2026-200', 'Nampula', 600, 200], ['2026-12-02', 'L-2026-200', 'Nampula', 410, 100]],
    'os dois dias dizem o que o lote diz, e cada um planeia o que o lote ainda tinha por fazer');
  assert.deepEqual(stageNow('L-2026-200', 'impressao'), ['em-curso', 290, '2026-12-02']);
  assert.deepEqual([$('entryEdit').checked, $('entryIdentity').disabled, $('entryEditWrap').hidden], [false, false, true], 'o formulário volta limpo, com o interruptor desligado');
  $('dialogClose').click();
  await wait(5);

  // no quadro, o lote abre com os dados trancados, e as duas fases que os dias dizem só se lêem
  await showLot('L-2026-200');
  assert.deepEqual([$('lotIdentity').disabled, $('lotEditWrap').hidden, $('lotEdit').checked, $('lotLockNote').hidden], [true, false, false, true]);
  assert.deepEqual(['lotReference', 'lotDelegation', 'lotQuantity', 'lotStart'].map((id) => $(id).closest('fieldset').id), Array(4).fill('lotIdentity'));
  assert.deepEqual($('lotStages').querySelectorAll('.lot-stage-fields').map((set) => [set.disabled, set.getAttribute('data-source')]),
    [[false, ''], [true, 'dias'], [true, 'dias'], [false, '']], 'a impressão e a qualidade vêm dos dias; a personalização e o despacho marcam-se aqui');
  assert.deepEqual($('lotStages').querySelectorAll('.lot-stage-source').map((node) => node.textContent), ['segue os dias de produção', 'segue os dias de produção']);
  // marcar uma fase não mexe nos dados do lote nem no que os dias dizem
  $('ls-personalizacao-state').value = 'feito';
  $('lotDialog').querySelector('form').dispatch('submit');
  await wait(10);
  assert.equal($('lotDialog').open, false);
  assert.deepEqual([lotNow('L-2026-200').delegation, lotNow('L-2026-200').quantity, stageNow('L-2026-200', 'personalizacao')[0], stageNow('L-2026-200', 'impressao')],
    ['Nampula', 600, 'feito', ['em-curso', 290, '2026-12-02']]);
  // com «Editar», a correcção feita no lote segue para os dias
  await showLot('L-2026-200');
  flip('lotEdit', true);
  assert.deepEqual([$('lotIdentity').disabled, $('lotLockNote').hidden], [false, false], '«Editar» abre os dados e avisa até onde chega a correcção');
  $('lotReference').value = 'L-2026-200-B';
  $('lotDelegation').value = 'Pemba';
  $('lotDialog').querySelector('form').dispatch('submit');
  await wait(10);
  assert.deepEqual(pointedNow().map((line) => line.slice(1, 3)), [['L-2026-200-B', 'Pemba'], ['L-2026-200-B', 'Pemba']], 'os dias seguem o lote');
  await showLot('L-2026-200-B');
  assert.deepEqual([$('lotEdit').checked, $('lotIdentity').disabled], [false, true], 'e o interruptor volta sempre desligado');
  $('lotDialog').close();

  // corrigir o dia de um lote já apontado muda-o de dia, em vez de o copiar
  document.querySelectorAll('.nav-item')[3].click();
  await wait(5);
  $('recordsTable').querySelectorAll('[data-day-open]').find((node) => /02\/12\/2026/.test(node.textContent)).click();
  await wait(10);
  $('dayEntries').querySelector('[data-entry-edit]').click();
  await wait(5);
  assert.deepEqual([$('entryLot').value, $('entryReference').value, $('entryIdentity').disabled, $('m0p').value], [prepared.id, 'L-2026-200-B', true, '100'], 'a linha abre com o lote do quadro, trancado');
  $('recordDate').value = '03/12/2026';
  $('recordDate').dispatch('change');
  await wait(5);
  $('recordForm').dispatch('submit');
  await wait(30);
  has($('toast'), /Lote passado para o dia 03\/12\/2026/);
  assert.deepEqual(pointedNow().map((line) => [line[0], line[3], line[4]]), [['2026-12-01', 600, 200], ['2026-12-03', 410, 100]], 'o dia 2 ficou sem lotes e desapareceu; o lote está uma vez só');
  // e apontá-lo outra vez num dia onde já está é recusado
  $('recordDate').value = '01/12/2026';
  $('recordDate').dispatch('change');
  await wait(5);
  $('entryReference').value = 'L-2026-200-B';
  $('entryReference').dispatch('change');
  assert.equal($('entryLot').value, prepared.id, 'a referência escrita puxa o lote assim que se sai do campo');
  $('m0p').value = '5';
  $('recordForm').dispatch('submit');
  await wait(30);
  has($('formError'), /O lote L-2026-200-B já está apontado no dia 01\/12\/2026/);
  $('dialogClose').click();
  await wait(5);

  // tirar o lote dos dias devolve ao quadro as duas fases que os dias lhe davam
  for (const date of ['01/12/2026', '03/12/2026']) {
    $('recordsTable').querySelectorAll('[data-day-delete]').find((node) => node.closest('tr').textContent.includes(date)).click();
    await wait(10);
    $('confirmYes').click();
    await wait(25);
  }
  assert.equal(pointedNow().length, 0);
  assert.deepEqual([stageNow('L-2026-200-B', 'impressao')[0], stageNow('L-2026-200-B', 'qualidade')[0], stageNow('L-2026-200-B', 'personalizacao')[0]], ['pendente', 'pendente', 'feito'],
    'a impressão e a qualidade voltam ao princípio; o que se marcou no lote fica');
  await showLot('L-2026-200-B');
  assert.deepEqual($('lotStages').querySelectorAll('.lot-stage-fields').map((set) => set.disabled), [false, false, false, false], 'sem dias a apontá-lo, as fases voltam a marcar-se no lote');
  $('lotDialog').close();

  // apagar um lote que está apontado num dia: a pergunta diz o que acontece ao dia, e a entrada fica sem ligação
  document.querySelectorAll('.nav-item')[3].click();
  await wait(5);
  $('dayAdd').click();
  $('recordDate').value = '04/12/2026';
  $('recordDate').dispatch('change');
  await wait(5);
  $('entryLot').value = prepared.id;
  $('entryLot').dispatch('change');
  $('m0p').value = '40';
  $('recordForm').dispatch('submit');
  await wait(30);
  $('dialogClose').click();
  await wait(5);
  document.querySelectorAll('.nav-item')[2].click();
  await wait(5);
  [...$('lotsTable').querySelectorAll('tbody tr')].find((line) => text(line).includes('L-2026-200-B')).querySelector('[data-lot-delete]').click();
  await wait(10);
  has($('confirmText'), /Vai apagar o lote L-2026-200-B \(600 cartas\) e os seus movimentos\. O dia em que foi apontado continua a contar a produção, já sem lote no quadro\./);
  $('confirmYes').click();
  await wait(25);
  assert.equal(lotNow('L-2026-200-B'), undefined, 'o lote saiu do quadro');
  const orphan = stateNow().records.find((record) => record.start === '2026-12-04').entries[0];
  assert.deepEqual([orphan.lotId, orphan.reference, orphan.delegation, orphan.produced], ['', 'L-2026-200-B', 'Pemba', 40], 'a entrada fica com o que tinha, sem ligação a lote nenhum');
  document.querySelectorAll('.nav-item')[3].click();
  await wait(5);
  $('recordsTable').querySelectorAll('[data-day-delete]').find((node) => node.closest('tr').textContent.includes('04/12/2026')).click();
  await wait(10);
  $('confirmYes').click();
  await wait(25);
  assert.equal(pointedNow().length, 0);
  // e o artigo do armazém leva os seus movimentos: a pergunta di-lo
  document.querySelectorAll('.nav-item')[1].click();
  await wait(5);
  $('stockTable').querySelector('[data-stock-delete]').click();
  await wait(10);
  has($('confirmText'), /do armazém e os seus movimentos\./);
  $('confirmNo').click();
  await wait(10);
  // o que os formulários não mostram fica como estava: a nota de uma entrada e a de uma fase passam por uma correcção sem se perderem
  document.querySelectorAll('.nav-item')[2].click();
  await wait(5);
  $('lotsAdd').click();
  $('lotReference').value = 'L-2026-210';
  $('lotDelegation').value = 'Tete';
  $('lotQuantity').value = '300';
  $('lotStart').value = '30/11/2026';
  $('lotDialog').querySelector('form').dispatch('submit');
  await wait(10);
  document.querySelectorAll('.nav-item')[3].click();
  await wait(5);
  $('dayAdd').click();
  $('recordDate').value = '06/12/2026';
  $('recordDate').dispatch('change');
  await wait(5);
  $('entryLot').value = lotNow('L-2026-210').id;
  $('entryLot').dispatch('change');
  $('m0p').value = '120';
  $('recordForm').dispatch('submit');
  await wait(30);
  $('dialogClose').click();
  await wait(5);
  const annotated = stateNow();
  const notedDay = (state) => state.records.find((record) => record.start === '2026-12-06').entries[0];
  notedDay(annotated).notes = 'trocar o tonner antes do lote seguinte';
  annotated.lots.find((lot) => lot.reference === 'L-2026-210').stages.despacho.note = 'aguarda a guia da delegação';
  const annotatedText = JSON.stringify(annotated);
  pickFile({ size: annotatedText.length, name: 'com-notas.json', text: async () => annotatedText });
  await wait(30);
  $('confirmYes').click();
  await wait(40);
  assert.equal(notedDay(stateNow()).notes, 'trocar o tonner antes do lote seguinte', 'a cópia trouxe a nota da entrada');
  document.querySelectorAll('.nav-item')[3].click();
  await wait(5);
  $('recordsTable').querySelectorAll('[data-day-open]').find((node) => /06\/12\/2026/.test(node.textContent)).click();
  await wait(5);
  $('dayEntries').querySelector('[data-entry-edit]').click();
  await wait(5);
  $('m0p').value = '130';
  $('recordForm').dispatch('submit');
  await wait(30);
  $('dialogClose').click();
  await wait(5);
  assert.deepEqual([notedDay(stateNow()).produced, notedDay(stateNow()).notes], [130, 'trocar o tonner antes do lote seguinte'], 'corrigir a linha do dia não lhe apaga a nota');
  await showLot('L-2026-210');
  $('lotNotes').value = 'ver com Tete';
  $('lotDialog').querySelector('form').dispatch('submit');
  await wait(10);
  assert.deepEqual([lotNow('L-2026-210').notes, lotNow('L-2026-210').stages.despacho.note], ['ver com Tete', 'aguarda a guia da delegação'], 'guardar o lote não apaga a nota de uma fase');
  // arruma: o dia e o lote saem
  document.querySelectorAll('.nav-item')[3].click();
  await wait(5);
  $('recordsTable').querySelectorAll('[data-day-delete]').find((node) => node.closest('tr').textContent.includes('06/12/2026')).click();
  await wait(10);
  $('confirmYes').click();
  await wait(25);
  document.querySelectorAll('.nav-item')[2].click();
  await wait(5);
  [...$('lotsTable').querySelectorAll('tbody tr')].find((line) => text(line).includes('L-2026-210')).querySelector('[data-lot-delete]').click();
  await wait(10);
  $('confirmYes').click();
  await wait(25);
  assert.equal(lotNow('L-2026-210'), undefined);
  assert.equal(pointedNow().length, 0);

  // uma escolha desligada fica à vista, com o porquê no texto, mas não se escolhe (o lote apontado nos dias, nos movimentos de impressão)
  const choice = document.createElement('select');
  const pairs = [['', 'Escolher lote'], ['a', 'LT-A — Beira'], ['b', 'LT-B — Tete (regista-se nos dias de produção)', true]];
  context.ContaCartaUI.options(choice, pairs, 'b');
  assert.deepEqual(choice.querySelectorAll('option').map((option) => [option.getAttribute('value'), option.disabled]), [['', false], ['a', false], ['b', true]]);
  assert.equal(choice.value, '', 'a escolha desligada não fica escolhida: volta a primeira');
  context.ContaCartaUI.options(choice, pairs, 'a');
  assert.equal(choice.value, 'a');
  context.ContaCartaUI.options(choice, pairs.map(([key, label]) => [key, label]), 'b');
  assert.equal(choice.value, 'b', 'ligada outra vez, escolhe-se');
  console.log('· um lado só: o lote puxado vem trancado, «Editar» corrige o próprio lote e o quadro segue os dias');

  /* 23 · todos os ids usados pelo código existem no HTML */
  const html = read('app/index.html');
  // o código está partido por módulos: os ids contam-se em todos os ficheiros da página
  const used = pageScripts.flatMap((src) => [...read(`app/${src}`).matchAll(/\$\('([\w-]+)'\)/g)].map((match) => match[1]));
  const missing = [...new Set(used)].filter((id) => !new RegExp(`id="${id}"`).test(html));
  assert.deepEqual(missing, [], 'todos os elementos procurados têm de existir no HTML');
  console.log(`· contratos: ${new Set(used).size} ids usados pelo código existem no HTML`);

  console.log('\nInterface verificada: painel, armazém, lotes, filtros, formulário, validações, relatórios (incluindo motivos e lotes), PDF, CSV, lupa, cópias e ajuda.');
}()).catch((error) => {
  console.error('FALHOU:', error && error.message);
  console.error(error && error.stack);
  process.exitCode = 1;
});
