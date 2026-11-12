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

const document = createDocument(read('dist/index.html'));
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
    if (url === 'conta-carta-mark.svg') return { ok: true, blob: async () => '' };
    if (url === 'sample.json') return { ok: true, json: async () => JSON.parse(read('dist/sample.json')) };
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

run(read('dist/core.js'));
run(read('dist/pdf.js'));
context.window.CONTACARTA_CONFIG = { storage: 'browser' };

/* dados fictícios partilhados com os testes de lógica */
store.set('contacarta-registos-v3', JSON.stringify(fixture));
run(read('dist/app.js'));


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
  has($('filterScope'), /Outubro de 2026/);
  console.log('· arranque: estado lido do armazenamento e painel desenhado');

  /* 2 · KPIs, máquinas e gráfico reflectem o período escolhido */
  const kpis = document.querySelectorAll('.kpi');
  assert.equal(kpis.length, 4);
  has(kpis[0], /Produzidas/, /600/, /cartas no período/);
  has(kpis[1], /Aprovadas/, /590/, /taxa 98,3%/);
  has(kpis[2], /Rejeitadas/, /10/, /taxa 1,7%/);
  has(kpis[3], /Cobertura/, /31\/31/, /dias com registo/);
  const machines = document.querySelectorAll('.machine');
  assert.equal(machines.length, 2);
  has(machines[0], /Máquina 1/, /96,7% aprovadas/, /Produzidas/, /120/, /Aprovadas/, /116/, /Rejeitadas/, /4/);
  has(machines[1], /Máquina 2/, /98,8% aprovadas/, /480/, /474/);
  assert.match($('chart').innerHTML, /<svg/);
  assert.equal($('chart').innerHTML.match(/<rect/g).length, 24, 'doze pares de barras lado a lado (aprovadas e rejeitadas)');
  assert.match($('chart').innerHTML, />Dez</, 'o gráfico percorre o ano inteiro');
  console.log('· painel: KPIs, cartões por máquina e gráfico mensal');

  /* 3 · tabela do painel com o total do período */
  const tableRows = $('panelTable').querySelectorAll('tbody tr');
  assert.equal(tableRows.length, 2);
  has($('panelTable'), /Total do período/);
  const groups = $('panelTable').querySelectorAll('thead tr.is-groups th');
  assert.deepEqual(groups.map((node) => node.textContent.trim()), ['Período', 'Máquina 1', 'Máquina 2', 'Totais do período', 'Notas'],
    'o cabeçalho da tabela agrupa as colunas por máquina');
  assert.equal(groups[1].attributes.get('colspan'), '2', 'cada máquina cobre duas colunas');
  assert.equal($('panelTable').querySelectorAll('thead tr')[1].querySelectorAll('th').length, 7);
  console.log('· painel: tabela com registos e linha de total');

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
  assert.equal($('stepGroup').hidden, false, 'as setas também correm anos');
  assert.equal(text($('viewContext')), 'Ano de 2026');
  assert.equal($('kpis').querySelectorAll('.kpi').length, 4);
  const yearly = $('kpis').querySelector('.kpi-value');
  assert.equal(yearly.textContent.replace(/\u00a0/g, ' '), '840', 'o ano soma os dois meses apontados');
  assert.equal($('kpis').querySelectorAll('.kpi-delta').length, 0, 'sem ano anterior apontado não há variação a mostrar');
  assert.match(text($('kpis')), /Produzidas no ano 840\s*média 70 por mês/, 'no ano o primeiro KPI passa a mostrar a média mensal');
  assert.match(text($('kpis')), /Meses com registo 2\/12/, 'e a cobertura passa a contar meses');
  assert.match($('chartTitle').textContent, /Evolução em 2026/, 'o gráfico do ano abre os doze meses');
  assert.match($('chart').outerHTML, />Set<\/text>[\s\S]*>Out<\/text>/, 'o painel em modo ano desenha os doze meses');
  assert.equal($('chart').outerHTML.match(/>[A-Z][a-z]{2}<\/text>/g).length, 12, 'um rótulo por mês do ano');
  modeButtons[2].click();
  assert.equal($('filterPeriodField').hidden, false);
  assert.equal($('stepGroup').hidden, true);
  modeButtons[0].click();
  assert.equal($('filterPeriodField').hidden, true);
  assert.equal($('filterMonthField').hidden, false);
  assert.equal($('stepGroup').hidden, false);
  const deltaLine = $('kpis').querySelector('.kpi-delta');
  assert.ok(deltaLine, 'no mês com anterior apontado há linha de variação');
  assert.match(text(deltaLine), /\+360 face ao mês anterior/, 'a variação é medida contra o mês do mesmo tamanho');
  console.log('· filtro: alternar entre mês, ano e intervalo de datas, com variação');

  /* 6 · navegação entre vistas */
  document.querySelectorAll('.nav-item')[1].click();
  assert.equal($('view-panel').hidden, true);
  assert.equal($('view-records').hidden, false);
  assert.equal($('viewTitle').textContent, 'Registos');
  assert.equal($('recordsTable').querySelectorAll('tbody tr').length, 3);
  console.log('· registos: lista com as linhas guardadas');

  /* 7 · formulário: novo registo, cálculo em direto e erros específicos */
  document.querySelectorAll('.nav-item')[0].click();
  $('newRecord').click();
  assert.equal($('recordDialog').open, true);
  has($('dialogTitle'), /Novo registo/);
  const tabs = $('periodTabs').querySelectorAll('button');
  assert.equal(tabs.length, 3);
  $('recordDate').value = '2026-11-16';
  $('m0p').value = '500';
  $('m0r').value = '100';
  $('m1p').value = '300';
  $('m1r').value = '20';
  $('machineInputs').dispatch('input');
  has($('liveResult'), /Aprovadas/, /680/);
  has($('liveResult'), /Rejeitadas/, /120/);
  has($('liveResult'), /Aprovação/, /85,0%/);
  assert.equal($('formError').hidden, true);

  $('m0r').value = '900';
  $('machineInputs').dispatch('input');
  assert.equal($('formError').hidden, false);
  has($('formError'), /Máquina 1: 900 rejeitadas não cabem em 500 produzidas/);
  $('m0r').value = '100';
  $('machineInputs').dispatch('input');

  $('recordForm').dispatch('submit');
  await wait(30);
  assert.equal($('recordDialog').open, false, 'o diálogo fecha depois de guardar');
  const saved = JSON.parse(store.get('contacarta-registos-v3'));
  assert.equal(saved.records.length, fixture.records.length + 1);
  const added = saved.records[saved.records.length - 1];
  assert.deepEqual(added.machines, [{ produced: 500, rejected: 100 }, { produced: 300, rejected: 20 }]);
  assert.equal(added.period, 'day');
  console.log('· formulário: cálculo em direto, validação e gravação');

  /* 8 · o painel passa a mostrar o dia novo */
  $('filterMonth').value = '2026-11';
  $('filterMonth').dispatch('change');
  await wait(10);
  has($('filterScope'), /Novembro de 2026/);
  has($('kpis'), /Produzidas/, /800/);
  has($('panelTable'), /16 nov\. 2026/);
  console.log('· painel: filtro do mês mostra o registo acabado de guardar');

  /* 9 · sobreposição é recusada com mensagem clara */
  $('newRecord').click();
  $('recordDate').value = '2026-11-16';
  $('m0p').value = '10';
  $('m0r').value = '0';
  $('machineInputs').dispatch('input');
  $('recordForm').dispatch('submit');
  await wait(20);
  assert.equal($('recordDialog').open, true, 'não se guarda por cima de outro registo');
  has($('formError'), /Já existe um registo entre 16 nov\. 2026/);
  $('dialogClose').click();
  console.log('· duplicados: recusa com indicação do registo que ocupa o dia');

  /* 10 · registo mensal usa o mês completo */
  $('newRecord').click();
  $('periodTabs').querySelectorAll('button')[1].click();
  $('recordMonth').value = '2026-12';
  $('m0p').value = '1000';
  $('m0r').value = '40';
  $('machineInputs').dispatch('input');
  $('recordForm').dispatch('submit');
  await wait(20);
  const withMonth = JSON.parse(store.get('contacarta-registos-v3'));
  const monthRecord = withMonth.records.find((record) => record.start === '2026-12-01');
  assert.equal(monthRecord.period, 'month');
  assert.deepEqual([monthRecord.start, monthRecord.end], ['2026-12-01', '2026-12-31']);
  assert.deepEqual(monthRecord.machines, [{ produced: 1000, rejected: 40 }, { produced: 0, rejected: 0 }]);
  console.log('· formulário: registo mensal cobre o mês inteiro');

  /* 11 · edição e eliminação a partir da tabela */
  document.querySelectorAll('.nav-item')[1].click();
  const editButton = $('recordsTable').querySelectorAll('[data-edit]').find((node) => node.textContent.includes('16 nov'));
  editButton.click();
  has($('dialogTitle'), /Editar registo/);
  assert.equal($('recordDate').value, '2026-11-16');
  $('m1r').value = '120';
  $('machineInputs').dispatch('input');
  $('recordForm').dispatch('submit');
  await wait(20);
  const edited = JSON.parse(store.get('contacarta-registos-v3')).records.find((record) => record.start === '2026-11-16');
  assert.equal(edited.machines[1].rejected, 120);
  assert.equal(edited.machines[1].produced, 300);

  const deleteButton = $('recordsTable').querySelectorAll('[data-delete]').find((node) => node.parentNode.parentNode.textContent.includes('16 nov'));
  deleteButton.click();
  assert.equal($('confirmDialog').open, true);
  has($('confirmText'), /Vai apagar o registo de 16 nov\. 2026/);
  $('confirmYes').click();
  await wait(20);
  const afterDelete = JSON.parse(store.get('contacarta-registos-v3'));
  assert.equal(afterDelete.records.some((record) => record.start === '2026-11-16'), false);
  console.log('· registos: editar e eliminar (com confirmação explícita)');

  /* 12 · relatórios: gerar, pré-visualizar e exportar */
  document.querySelectorAll('.nav-item')[2].click();
  assert.equal($('view-reports').hidden, false);
  assert.equal($('reportWrap').hidden, false, 'o relatório do mês é mostrado ao entrar');
  has($('reportHint'), /registos somados|registo somado/);
  has($('paper'), /Relatório de produção/, /INATRO, IP/, /Instituto Nacional dos Transportes Rodoviários/);
  has($('paper'), /Total/);
  assert.equal($('paper').querySelectorAll('.paper-kpi').length, 4, 'o papel mostra os mesmos quatro indicadores do PDF');
  assert.equal($('paper').querySelectorAll('.paper-kpi.is-bad').length, 1, 'as rejeições aparecem a vermelho no papel');
  assert.match($('paper').innerHTML, /<svg/, 'a pré-visualização leva o gráfico, como o PDF');
  assert.equal($('paper').querySelectorAll('.paper-table').length, 2, 'tabela por máquina e tabela de registos');
  has($('reportHint'), /1 registo somado/, /1 de 31 dias com registo/);
  assert.equal($('reportHint').classList.contains('is-error'), false, 'o gerador não pode estar a queixar-se');
  const kinds = $('reportKind');
  kinds.value = 'week';
  kinds.dispatch('change');
  assert.equal($('reportDates').querySelectorAll('input').length, 1);
  $('reportDates').querySelectorAll('input')[0].value = '2026-11-16';
  $('reportDates').querySelectorAll('input')[0].dispatch('change');
  await wait(10);
  has($('paper'), /Semana de 16 nov\. 2026/, /Não há registos somados neste período/);
  console.log('· relatórios: gerador, pré-visualização e semanais');

  /* 13 · comparação de meses e de anos, com variação e leitura */
  const kindsForCompare = $('reportKind');
  kindsForCompare.value = 'months';
  kindsForCompare.dispatch('change');
  await wait(10);
  const compareInputs = $('reportDates').querySelectorAll('input');
  assert.equal(compareInputs.length, 3, 'dois meses e a caixa de extremos');
  assert.equal(compareInputs[0].type, 'month');
  compareInputs[0].value = '2026-09';
  compareInputs[0].dispatch('change');
  await wait(10);
  compareInputs[1].value = '2026-10';
  compareInputs[1].dispatch('change');
  await wait(10);
  has($('reportHint'), /2 períodos comparados/, /2 registos somados/, /2 com produção/);
  const compareTable = $('paper').querySelectorAll('.paper-table')[1];
  const compareRows = compareTable.querySelectorAll('tbody tr');
  assert.equal(compareRows.length, 3, 'setembro, Outubro e a linha de total');
  assert.match(text(compareRows[0]), /Setembro de 2026.*240.*96,7%/);
  assert.match(text(compareRows[1]), /Outubro de 2026.*600.*98,3%.*\+360/);
  assert.match(text(compareRows[2]), /Total comparado.*840/);
  assert.ok(compareRows[1].classList.contains('is-ok') && compareRows[0].classList.contains('is-bad'),
    'a melhor e a pior taxa são marcadas na comparação');
  has($('paper'), /Comparação de meses/, /diferença de 1,6 pontos/);
  assert.match($('paper').outerHTML, /Set 26[\s\S]*Out 26/, 'o gráfico da comparação usa as etiquetas curtas dos períodos');
  kindsForCompare.value = 'years';
  kindsForCompare.dispatch('change');
  await wait(10);
  const yearInputs = $('reportDates').querySelectorAll('input');
  yearInputs[0].value = '2025';
  yearInputs[0].dispatch('change');
  await wait(10);
  yearInputs[1].value = '2026';
  yearInputs[1].dispatch('change');
  await wait(10);
  has($('reportHint'), /2 períodos comparados/);
  const yearRows = $('paper').querySelectorAll('.paper-table')[1].querySelectorAll('tbody tr');
  assert.equal(yearRows.length, 3, '2025, 2026 e o total');
  assert.match(text(yearRows[0]), /2025.*0.*—/, 'o ano sem registos mostra traço, não zero a percentagem');
  has($('paper'), /Só 2026 tem produção/);
  // extremos: comparar só o primeiro e o último de uma sequência longa
  kindsForCompare.value = 'months';
  kindsForCompare.dispatch('change');
  await wait(10);
  const extremesInputs = $('reportDates').querySelectorAll('input');
  extremesInputs[0].value = '2026-07';
  extremesInputs[0].dispatch('change');
  await wait(10);
  extremesInputs[1].value = '2026-10';
  extremesInputs[1].dispatch('change');
  await wait(10);
  assert.equal($('paper').querySelectorAll('.paper-table')[1].querySelectorAll('tbody tr').length, 5,
    'Julho a Outubro são quatro meses mais o total');
  const onlyEnds = $('reportDates').querySelector('input[type=checkbox]');
  onlyEnds.checked = true;
  onlyEnds.dispatch('change');
  await wait(10);
  assert.equal($('paper').querySelectorAll('.paper-table')[1].querySelectorAll('tbody tr').length, 3,
    'com «só extremos» ficam Julho, Outubro e o total');
  has($('reportHint'), /2 períodos comparados/);

  // o PDF da comparação leva a tabela, a leitura e a paginação de duas páginas
  kindsForCompare.value = 'months';
  kindsForCompare.dispatch('change');
  await wait(10);
  const pdfInputs = [...$('reportDates').querySelectorAll('input')].filter((node) => node.type !== 'checkbox');
  pdfInputs[0].value = '2026-07';
  pdfInputs[0].dispatch('change');
  await wait(10);
  pdfInputs[1].value = '2026-10';
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
  assert.match(compareReadable, /Variação/);
  assert.match(compareReadable, /Total comparado/);
  assert.match(compareReadable, /Leitura da comparação/);
  assert.match(compareReadable, /Página 1 de 2/, 'quatro meses comparados precisam de duas páginas');
  assert.match(document.lastDownload, /comparacao\.pdf$/, 'o nome do ficheiro diz que é uma comparação');

  // e volta ao relatório simples, para as secções seguintes
  const endsBox = $('reportDates').querySelector('input[type=checkbox]');
  endsBox.checked = false;
  endsBox.dispatch('change');
  kindsForCompare.value = 'week';
  kindsForCompare.dispatch('change');
  await wait(10);
  $('reportDates').querySelectorAll('input')[0].value = '2026-11-16';
  $('reportDates').querySelectorAll('input')[0].dispatch('change');
  await wait(10);
  has($('paper'), /Semana de 16 nov\. 2026/);
  console.log('· comparação: meses e anos, variação face ao anterior, leitura e PDF de duas páginas');

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
  const csvInputs = $('reportDates').querySelectorAll('input');
  csvInputs[0].value = '2026-09';
  csvInputs[0].dispatch('change');
  await wait(10);
  csvInputs[1].value = '2026-10';
  csvInputs[1].dispatch('change');
  await wait(10);
  context.__exported = null;
  $('exportCsv').click();
  await wait(30);
  const compareCsv = (await context.__exported.text()).replace(/^\uFEFF/, '');
  assert.match(compareCsv, /^"Sistema";"Conta Carta · INATRO, IP"/);
  assert.match(compareCsv, /"Comparação";"Comparação de meses · Setembro de 2026 – Outubro de 2026"/);
  assert.ok(compareCsv.includes('"Período";"Registos";"Produzidas"'), 'cabeçalho próprio da comparação');
  assert.ok(compareCsv.includes('"Total comparado";"2";"840";"822";"18";"97.9"'), 'linha de total na comparação');
  assert.match(compareCsv, /^"Outubro de 2026";"1";"600";"590";"10";"98\.3";"1\.6";"19";"31";"31"$/m, 'a variação vai em pontos para o CSV');
  assert.match(compareCsv, /^"Setembro de 2026";"1";"240";"232";"8";"96\.7";"";/m, 'o primeiro período não tem variação');
  assert.match(document.lastDownload, /comparacao\.csv$/, 'o CSV da comparação tem nome próprio');
  console.log('· exportações: PDF válido (A4), CSV com total e CSV de comparação');

  /* 15 · cópia de segurança: exportar, corromper, importar de volta */
  const storedBefore = JSON.parse(store.get('contacarta-registos-v3'));
  context.__exported = null;
  $('exportCopy').click();
  await wait(20);
  assert.ok(context.__exported, 'exportar cópia cria ficheiro');
  const copyText = await context.__exported.text();
  const copy = JSON.parse(copyText);
  assert.equal(copy.version, 3, 'a cópia declara a versão dos dados');
  assert.equal(copy.records.length, storedBefore.records.length, 'a cópia tem exactamente os registos guardados');
  assert.ok(copy.records.some((record) => record.period === 'month'), 'os tipos de registo passam intactos');
  assert.deepEqual(copy, storedBefore, 'exportar é a foto fiel do armazenamento');
  console.log('· cópias: exportação JSON fiel, com a versão actual');

  /* 16 · importar ficheiro inválido: recusa com mensagem e dados intactos */
  const untouched = store.get('contacarta-registos-v3');
  const pickFile = (file) => {
    $('fileInput').files = [file];
    $('fileInput').dispatch('change');
  };
  pickFile({ size: 20, name: 'copia.json', text: async () => '{ não é json' });
  await wait(30);
  has($('toast'), /não é JSON válido/);
  assert.equal(store.get('contacarta-registos-v3'), untouched, 'importação má nunca altera os dados');

  pickFile({ size: 40, name: 'velho.json', text: async () => JSON.stringify({ version: 3, registos: [] }) });
  await wait(30);
  has($('toast'), /não tem uma lista de registos/);
  assert.equal(store.get('contacarta-registos-v3'), untouched, 'JSON sem o campo certo é recusado');

  /* 17 · round-trip: uma cópia vazia apaga tudo, a original traz os dados de volta */
  pickFile({ size: 30, name: 'vazia.json', text: async () => JSON.stringify({ version: 3, records: [] }) });
  await wait(30);
  $('confirmYes').click();
  await wait(40);
  assert.equal(JSON.parse(store.get('contacarta-registos-v3')).records.length, 0, 'a cópia vazia foi aplicada');
  has($('panelTable'), /Ainda sem registos neste período/);
  assert.equal($('panelTable').querySelectorAll('p').length, 0, 'o estado vazio não leva texto de ajuda');
  pickFile({ size: copyText.length, name: 'copia.json', text: async () => copyText });
  await wait(30);
  assert.equal($('confirmDialog').open, true, 'importar pede confirmação antes de substituir');
  has($('confirmText'), /vai substituir os actuais/);
  $('confirmYes').click();
  await wait(40);
  assert.deepEqual(JSON.parse(store.get('contacarta-registos-v3')), copy, 'a cópia importada volta a ser a original');
  has($('toast'), /Cópia importada/);
  has($('navCount'), new RegExp(String(copy.records.length)));
  console.log('· cópias: exportar → limpar → importar devolve os mesmos registos');

  /* 18 · dados fictícios: juntam-se ao que existe e saem a pedido */
  document.querySelectorAll('.nav-item')[0].click();
  const beforeSample = JSON.parse(store.get('contacarta-registos-v3')).records.length;
  const sampleCount = JSON.parse(read('dist/sample.json')).records.length;
  assert.ok(sampleCount > 40, 'o exemplo tem de ter volume suficiente para demonstrar o painel');
  $('loadSample').click();
  await wait(20);
  assert.equal($('confirmDialog').open, true, 'carregar o exemplo também pede confirmação');
  has($('confirmText'), /ao lado dos teus/);
  $('confirmYes').click();
  await wait(40);
  const withSample = JSON.parse(store.get('contacarta-registos-v3'));
  assert.equal(withSample.records.length, beforeSample + sampleCount, 'o exemplo acrescenta, nunca substitui');
  assert.ok(withSample.records.some((record) => record.id.startsWith('exemplo-')), 'exemplo carregado');
  has($('sampleLabel'), /Remover dados fict/);
  has($('toast'), /Exemplo carregado/);
  assert.equal($('loadSample').hidden, false, 'o exemplo está sempre acessível');
  has($('filterScope'), /Dezembro de 2026/);
  has($('kpis'), /Produzidas/, /Rejeitadas/);
  assert.ok(/\d/.exec(text($('kpis'))), 'o painel mostra números com o exemplo carregado');
  has($('recordsTable'), /exemplo|set\.|out\.|ago\./);

  $('loadSample').click();
  assert.equal($('confirmDialog').open, true, 'retirar o exemplo pede confirmação');
  has($('confirmText'), /Saem só os registos de exemplo/);
  $('confirmYes').click();
  await wait(40);
  const cleaned = JSON.parse(store.get('contacarta-registos-v3'));
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
  console.log('· ajuda: ícone ⓘ abre e fecha a caixa de explicação');

  /* 20 · todos os ids usados por app.js existem no HTML */
  const html = read('dist/index.html');
  const used = [...read('dist/app.js').matchAll(/\$\('([\w-]+)'\)/g)].map((match) => match[1]);
  const missing = [...new Set(used)].filter((id) => !new RegExp(`id="${id}"`).test(html));
  assert.deepEqual(missing, [], 'todos os elementos procurados têm de existir no HTML');
  console.log(`· contratos: ${new Set(used).size} ids usados pelo código existem no HTML`);

  console.log('\nInterface verificada: painel, filtros, formulário, validações, relatórios, PDF, CSV, cópias e ajuda.');
}()).catch((error) => {
  console.error('FALHOU:', error && error.message);
  process.exitCode = 1;
});
