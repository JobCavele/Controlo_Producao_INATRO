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
    if (url === 'inatro-letterhead.jpg') {
      const bytes = fs.readFileSync(path.join(ROOT, 'dist', 'inatro-letterhead.jpg'));
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return { ok: true, arrayBuffer: async () => buffer };
    }
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
store.set('contacarta-registos-v4', JSON.stringify(fixture));
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
  has($('filterScope'), /10\/2026/);
  console.log('· arranque: estado lido do armazenamento e painel desenhado');

  /* 2 · KPIs, máquinas e gráfico reflectem o período escolhido */
  const kpis = document.querySelectorAll('.kpi');
  assert.equal(kpis.length, 5, 'cinco indicadores: produzidas, aprovadas e as duas rejeições, mais a cobertura');
  has(kpis[0], /Produzidas/, /600/, /cartas no período/);
  has(kpis[1], /Aprovadas/, /580/, /taxa 96,7%/);
  has(kpis[2], /Rej\. máquina/, /10/, /taxa 1,7%/);
  has(kpis[3], /Rej\. qualidade/, /10/, /taxa 1,7%/);
  has(kpis[4], /Cobertura/, /31\/31/, /dias com registo/);
  const machines = document.querySelectorAll('.machine');
  assert.equal(machines.length, 2);
  has(machines[0], /Máquina 1/, /95,0% aprovadas/, /Produzidas/, /120/, /Aprovadas/, /114/, /Rej\. máquina/, /4/, /Rej\. qualidade/, /2/);
  has(machines[1], /Máquina 2/, /97,1% aprovadas/, /480/, /466/, /6/, /8/);
  assert.match($('chart').innerHTML, /<svg/);
  assert.equal($('chart').innerHTML.match(/<rect/g).length, 6, 'só setembro e Outubro têm producção: duas barras compostas de três segmentos');
  assert.match($('chart').innerHTML, />12\/26</, 'o gráfico percorre o ano inteiro');
  console.log('· painel: KPIs, cartões por máquina e gráfico mensal');

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
  assert.equal($('kpis').querySelectorAll('.kpi').length, 5);
  const yearly = $('kpis').querySelector('.kpi-value');
  assert.equal(yearly.textContent.replace(/\u00a0/g, ' '), '840', 'o ano soma os dois meses apontados');
  assert.equal($('kpis').querySelectorAll('.kpi-delta').filter((node) => !node.classList.contains('is-empty')).length, 0, 'sem ano anterior apontado não há variação a mostrar');
  assert.match(text($('kpis')), /Produzidas no ano\s*840\s*média 70 por mês/, 'no ano o primeiro KPI passa a mostrar a média mensal');
  assert.match(text($('kpis')), /Meses com registo\s*2\/12/, 'e a cobertura passa a contar meses');
  assert.match($('chartTitle').textContent, /Evolução em 2026/, 'o gráfico do ano abre os doze meses');
  assert.match($('chart').outerHTML, />09\/26<\/text>[\s\S]*>10\/26<\/text>/, 'o painel em modo ano desenha os doze meses');
  assert.equal($('chart').outerHTML.match(/>\d{2}\/26<\/text>/g).length, 12, 'um rótulo curto por mês do ano');
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
  $('m0q').value = '40';
  $('m1q').value = '10';
  $('machineInputs').dispatch('input');
  has($('liveResult'), /Aprovadas/, /630/);
  has($('liveResult'), /Rej\. máquina/, /120/);
  has($('liveResult'), /Rej\. qualidade/, /50/);
  has($('liveResult'), /Aprovação/, /78,8%/);
  assert.equal($('formError').hidden, true);

  $('m0r').value = '900';
  $('machineInputs').dispatch('input');
  assert.equal($('formError').hidden, false);
  has($('formError'), /Máquina 1: 900 da máquina \+ 40 do teste de qualidade não cabem em 500 produzidas/);
  $('m0r').value = '100';
  $('machineInputs').dispatch('input');

  $('recordForm').dispatch('submit');
  await wait(30);
  assert.equal($('recordDialog').open, false, 'o diálogo fecha depois de guardar');
  const saved = JSON.parse(store.get('contacarta-registos-v4'));
  assert.equal(saved.records.length, fixture.records.length + 1);
  const added = saved.records[saved.records.length - 1];
  assert.deepEqual(added.machines, [{ produced: 500, rejected: 100, qualityRejected: 40 }, { produced: 300, rejected: 20, qualityRejected: 10 }]);
  assert.equal(added.period, 'day');
  console.log('· formulário: cálculo em direto, validação e gravação');

  /* 8 · o painel passa a mostrar o dia novo */
  $('filterMonth').value = '2026-11';
  $('filterMonth').dispatch('change');
  await wait(10);
  has($('filterScope'), /11\/2026/);
  has($('kpis'), /Produzidas/, /800/);
  has($('panelTable'), /16\/11\/2026/);
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
  has($('formError'), /Já existe um registo entre 16\/11\/2026/);
  $('dialogClose').click();
  console.log('· duplicados: recusa com indicação do registo que ocupa o dia');

  /* 10 · registo mensal usa o mês completo */
  $('newRecord').click();
  $('periodTabs').querySelectorAll('button')[1].click();
  $('recordMonth').value = '2026-12';
  $('m0p').value = '1000';
  $('m0r').value = '40';
  $('m0q').value = '25';
  $('machineInputs').dispatch('input');
  $('recordForm').dispatch('submit');
  await wait(20);
  const withMonth = JSON.parse(store.get('contacarta-registos-v4'));
  const monthRecord = withMonth.records.find((record) => record.start === '2026-12-01');
  assert.equal(monthRecord.period, 'month');
  assert.deepEqual([monthRecord.start, monthRecord.end], ['2026-12-01', '2026-12-31']);
  assert.deepEqual(monthRecord.machines, [{ produced: 1000, rejected: 40, qualityRejected: 25 }, { produced: 0, rejected: 0, qualityRejected: 0 }]);
  console.log('· formulário: registo mensal cobre o mês inteiro');

  /* 11 · edição e eliminação a partir da tabela */
  document.querySelectorAll('.nav-item')[1].click();
  const editButton = $('recordsTable').querySelectorAll('[data-edit]').find((node) => node.textContent.includes('16/11\/2026'));
  editButton.click();
  has($('dialogTitle'), /Editar registo/);
  assert.equal($('recordDate').value, '2026-11-16');
  $('m1r').value = '120';
  $('machineInputs').dispatch('input');
  $('recordForm').dispatch('submit');
  await wait(20);
  const edited = JSON.parse(store.get('contacarta-registos-v4')).records.find((record) => record.start === '2026-11-16');
  assert.equal(edited.machines[1].rejected, 120);
  assert.equal(edited.machines[1].produced, 300);
  assert.equal(edited.machines[1].qualityRejected, 10, 'editar conserva a rejeição de qualidade');

  const deleteButton = $('recordsTable').querySelectorAll('[data-delete]').find((node) => node.parentNode.parentNode.textContent.includes('16/11\/2026'));
  deleteButton.click();
  assert.equal($('confirmDialog').open, true);
  has($('confirmText'), /Vai apagar o registo de 16\/11\/2026/);
  $('confirmYes').click();
  await wait(20);
  const afterDelete = JSON.parse(store.get('contacarta-registos-v4'));
  assert.equal(afterDelete.records.some((record) => record.start === '2026-11-16'), false);
  console.log('· registos: editar e eliminar (com confirmação explícita)');

  /* 12 · relatórios: gerar, pré-visualizar e exportar */
  document.querySelectorAll('.nav-item')[2].click();
  assert.equal($('view-reports').hidden, false);
  assert.equal($('reportWrap').hidden, false, 'o relatório do mês é mostrado ao entrar');
  has($('reportHint'), /registos somados|registo somado/);
  has($('paper'), /Relatório de producção/);
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
  assert.equal($('reportDates').querySelectorAll('input').length, 1);
  $('reportDates').querySelectorAll('input')[0].value = '2026-11-16';
  $('reportDates').querySelectorAll('input')[0].dispatch('change');
  await wait(10);
  has($('paper'), /Semana de 16\/11\/2026/, /Não há registos somados neste período/);
  console.log('· relatórios: gerador, pré-visualização e semanais');

  /* 13 · comparação: dois períodos lado a lado, com a diferença */
  const kindsForCompare = $('reportKind');
  kindsForCompare.value = 'months';
  kindsForCompare.dispatch('change');
  await wait(10);
  const compareInputs = $('reportDates').querySelectorAll('input');
  assert.equal(compareInputs.length, 2, 'Mês 1 e Mês 2 — sem caixas nem extremos');
  assert.equal(compareInputs[0].type, 'month');
  assert.equal(compareInputs[0].getAttribute('aria-label'), 'Mês 1');
  assert.equal(compareInputs[1].getAttribute('aria-label'), 'Mês 2');
  compareInputs[0].value = '2026-09';
  compareInputs[0].dispatch('change');
  await wait(10);
  compareInputs[1].value = '2026-10';
  compareInputs[1].dispatch('change');
  await wait(10);
  has($('reportHint'), /2 períodos lado a lado/, /2 registos somados/, /2 com producção/);
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
  assert.match(text(sideRows[2]), /Aprovadas/, /228.*580.*\+352/);
  assert.match(text(sideRows[3]), /Rej\. máquina/, /8.*10.*\+2/);
  assert.match(text(sideRows[4]), /Rej\. qualidade/, /4.*10.*\+6/);
  assert.match(text(sideRows[7]), /Aprovação/, /95,0%.*96,7%.*\+1,7 p\./);
  assert.ok(sideRows[1].querySelectorAll('td')[3].classList.contains('is-good'), 'mais producção aparece a verde');
  assert.ok(sideRows[3].querySelectorAll('td')[3].classList.contains('is-bad'), 'mais rejeição aparece a vermelho');
  const machineCompare = compareTables[1];
  has(machineCompare, /Setembro de 2026/, /Outubro de 2026/, /Máquina 2/, /Total/, /Período/);
  const machineRows = machineCompare.querySelectorAll('tbody tr');
  assert.equal(machineRows.length, 6, 'dois períodos × (duas máquinas + total)');
  assert.match(text(machineRows[2]), /Setembro de 2026.*Total/);
  assert.match(text(machineRows[5]), /Outubro de 2026.*Total/);
  has($('paper'), /produziu mais 360 cartas do que Setembro de 2026/, /95,0% para 96,7%/);
  has($('paper'), /Lado a lado — Setembro de 2026 e Outubro de 2026/);
  assert.match($('paper').outerHTML, /09\/26[\s\S]*10\/26/, 'o gráfico da comparação usa as etiquetas curtas dos períodos');
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
  has($('paper'), /Só 2026 tem producção/);
  const yearSide = $('paper').querySelectorAll('.paper-table')[0];
  const yearHead = yearSide.querySelectorAll('thead th');
  assert.match(text(yearHead[1]), /2025/);
  assert.match(text(yearHead[2]), /2026/);
  assert.equal($('paper').querySelectorAll('input[type=checkbox]').length, 0, 'não há caixa de extremos: são só dois');

  // o PDF da comparação leva a tabela lado a lado, a leitura e cabe numa página
  kindsForCompare.value = 'months';
  kindsForCompare.dispatch('change');
  await wait(10);
  const pdfInputs = [...$('reportDates').querySelectorAll('input')].filter((node) => node.type !== 'checkbox');
  pdfInputs[0].value = '2026-09';
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
  $('reportDates').querySelectorAll('input')[0].value = '2026-11-16';
  $('reportDates').querySelectorAll('input')[0].dispatch('change');
  await wait(10);
  has($('paper'), /Semana de 16\/11\/2026/);
  assert.ok($('paper').outerHTML.includes('inatro.png'), 'o papel mostra o logótipo oficial do INATRO');
  console.log('· comparação: dois períodos lado a lado, diferença, leitura e PDF');

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
  assert.match(readable, /Relatório de producção/);
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
  assert.match(compareCsv, /"Comparação";"Comparação de meses · Setembro de 2026 × Outubro de 2026"/);
  assert.ok(compareCsv.includes('"Período";"Nome";"Registos";"Produzidas"'), 'cabeçalho próprio da comparação');
  assert.ok(compareCsv.includes('"Diferença (2.º menos 1.º)";"";"0";"360";"352";"2";"6";"1.7"'),'linha da diferença: segundo menos primeiro');
  assert.ok(!compareCsv.includes('Total comparado'), 'a comparação já não soma tudo numa linha só');
  assert.match(compareCsv, /^"10\/2026";"Outubro de 2026";"1";"600";"580";"10";"10";"96\.7";"1\.7";"19";"31";"31"$/m, 'a variação vai em pontos para o CSV');
  assert.match(compareCsv, /^"09\/2026";"Setembro de 2026";"1";"240";"228";"8";"4";"95";"";/m, 'o primeiro período não tem variação');
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
  assert.equal(copy.version, 4, 'a cópia declara a versão dos dados');
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
  await wait(40);
  assert.equal(JSON.parse(store.get('contacarta-registos-v4')).records.length, 0, 'a cópia vazia foi aplicada');
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

  /* 18 · dados fictícios: juntam-se ao que existe e saem a pedido */
  document.querySelectorAll('.nav-item')[0].click();
  const beforeRecords = JSON.parse(store.get('contacarta-registos-v4')).records;
  const beforeSample = beforeRecords.length;
  const sampleCount = JSON.parse(read('dist/sample.json')).records.length;
  assert.ok(sampleCount > 40, 'o exemplo tem de ter volume suficiente para demonstrar o painel');
  // o exemplo nunca pisa dias já ocupados: entra só o que não coincide
  const overlaps = (record) => beforeRecords.some((own) => record.start <= own.end && own.start <= record.end);
  const expectedAdd = JSON.parse(read('dist/sample.json')).records.filter((record) => !overlaps(record)).length;
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
  has($('filterScope'), /12\/2026/);
  has($('kpis'), /Produzidas/, /Rej\. máquina/, /Rej\. qualidade/);
  assert.ok(/\d/.exec(text($('kpis'))), 'o painel mostra números com o exemplo carregado');
  has($('recordsTable'), /12\/2026/);

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
  const rejInputs = $('reportDates').querySelectorAll('input');
  assert.equal(rejInputs.length, 2, 'os relatórios de rejeição pedem o período');
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

  /* 23 · todos os ids usados por app.js existem no HTML */
  const html = read('dist/index.html');
  const used = [...read('dist/app.js').matchAll(/\$\('([\w-]+)'\)/g)].map((match) => match[1]);
  const missing = [...new Set(used)].filter((id) => !new RegExp(`id="${id}"`).test(html));
  assert.deepEqual(missing, [], 'todos os elementos procurados têm de existir no HTML');
  console.log(`· contratos: ${new Set(used).size} ids usados pelo código existem no HTML`);

  console.log('\nInterface verificada: painel, filtros, formulário, validações, relatórios (incluindo as duas rejeições), PDF, CSV, lupa, cópias e ajuda.');
}()).catch((error) => {
  console.error('FALHOU:', error && error.message);
  process.exitCode = 1;
});
