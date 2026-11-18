'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
const script = fs.readFileSync(path.join(ROOT, 'app/app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'app/style.css'), 'utf8');

test('os controlos utilizados pelo JavaScript existem no HTML', () => {
  const allIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const ids = new Set(allIds);
  assert.equal(ids.size, allIds.length, 'Os identificadores do HTML devem ser únicos.');
  const calendar = fs.readFileSync(path.join(ROOT, 'app/components/calendar.js'), 'utf8');
  const used = [...(script + calendar).matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]);
  const missing = [...new Set(used.filter((id) => !ids.has(id)))];
  assert.deepEqual(missing, []);
});

test('aplicação sem dependências antigas nem armazenamento no navegador', () => {
  assert.doesNotMatch(script, /localStorage|sessionStorage|Lote|stock|python/i);
  assert.doesNotMatch(html, /lote|material de consumo|movimento de lote/i);
  for (const name of ['server.py', 'iniciar.sh', 'Iniciar_Windows.bat', 'Compilar_Windows.bat', 'app/config.js'])
    assert.equal(fs.existsSync(path.join(ROOT, name)), false, name);
});

test('a seta pertence à barra lateral; o botão de saída da TV continua no cabeçalho', () => {
  const side = html.match(/<aside\b[^>]*\bid="sideMenu"[^>]*>([\s\S]*?)<\/aside>/)[1];
  const header = html.match(/<header class="page-head">([\s\S]*?)<\/header>/)[1];
  const toggle = side.match(/<button\b([^>]*\bid="menuToggle"[^>]*)>([\s\S]*?)<\/button>/);
  assert.ok(toggle);
  assert.match(toggle[1], /aria-controls="sideMenu"/);
  assert.match(toggle[1], /aria-expanded="true"/);
  assert.match(toggle[1], /aria-label="Recolher a barra lateral"/);
  assert.match(toggle[2].trim(), /^<svg\b[\s\S]*<\/svg>$/);
  assert.doesNotMatch(header, /id="menuToggle"/);
  const tv = header.match(/<button\b[^>]*\bid="tvToggle"[^>]*>/)[0];
  assert.match(tv, /aria-controls="view-dashboard"/);
  assert.match(tv, /aria-pressed="false"/);
});

test('recolher deixa uma faixa de 68 px com a seta virada para reabrir', () => {
  assert.match(css, /\.app\.is-collapsed\s*\{[^}]*grid-template-columns:\s*68px\s+minmax\(0,\s*1fr\)/);
  assert.match(css, /\.is-collapsed \.side-toggle svg\s*\{[^}]*transform:\s*scaleX\(-1\)/);
});

test('cada delegação tem um contorno e um ponto de legenda no SVG local', () => {
  const { SEATS } = require('../app/components/map');
  const svg = fs.readFileSync(path.join(ROOT, 'app/mocambique.svg'), 'utf8');
  for (const group of ['features', 'label_points']) {
    const content = svg.split(`<g id="${group}">`)[1].split('</g>')[0];
    const ids = [...content.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(ids.sort(), Object.keys(SEATS).sort());
  }
  assert.equal(new Set(Object.values(SEATS)).size, 11);
  assert.equal(SEATS.MZMPM, 'MAP-C');
  assert.equal(SEATS.MZL, 'MAT');
});

test('a caixa de valores fica ancorada à direita do mapa sem interceptar o rato', () => {
  assert.match(css, /\.map-plot\s*\{[^}]*position:\s*relative\b/);
  const rule = css.match(/\.map-readout\s*\{([^}]*)\}/)[1];
  assert.match(rule, /position:\s*absolute\b/);
  assert.match(rule, /right:\s*0;/);
  assert.match(rule, /bottom:\s*18%;/);
  assert.match(rule, /pointer-events:\s*none\b/);
});

test('o clique mantém os valores depois do hover ou do foco, até limpar a selecção', () => {
  const { readoutRow } = require('../app/components/map');
  const beira = { code: 'BEI', produced: 10 }, matola = { code: 'MAT', produced: 0 };
  const rows = new Map([[beira.code, beira], [matola.code, matola]]);
  assert.equal(readoutRow(rows, 'BEI', ''), beira);     // Apenas hover
  assert.equal(readoutRow(rows, '', 'BEI'), beira);     // Saiu depois de clicar
  assert.equal(readoutRow(rows, 'MAT', 'BEI'), matola); // Prévia sem trocar a selecção
  assert.equal(readoutRow(rows, '', ''), undefined);    // Limpou a selecção
});

test('mapa e tabela usam os valores de cada sede sem misturar Maputo e Matola', () => {
  const { quantityView } = require('../app/components/map');
  const records = [
    { code: 'BOA', name: 'Boane', province: 'Maputo', produced: 90 },
    { code: 'MAT', name: 'Matola', province: 'Maputo', produced: 20, pending: null },
    { code: 'MAP-C', name: 'Maputo Cidade', province: 'Maputo Cidade', produced: 1, pending: 7 },
  ];
  const { rows, samples } = quantityView(records);
  assert.deepEqual(rows.map(({ code, name, region, quantity }) => [code, name, region, quantity]), [
    ['MAP-C', 'Maputo', 'Capital do país', 1], ['MAT', 'Matola', 'Província de Maputo', 20],
  ]);
  assert.deepEqual(samples, [1, 20]);
  assert.notEqual(rows[0].fill, rows[1].fill);
  assert.equal(records[2].name, 'Maputo Cidade');
});

test('a intensidade acompanha a contagem, mesmo numa única sede ou no antigo escalão de 0–25%', () => {
  const { quantityView } = require('../app/components/map');
  const solo = (n) => quantityView([{ code: 'BEI', produced: n }]).rows[0].fill;
  const quantities = [0, 1, 10, 40, 200, 500, 10000];
  assert.equal(new Set(quantities.map(solo)).size, quantities.length);
  const lightness = quantities.slice(1).map((n) => Number(solo(n).match(/([\d.]+)%\)$/)[1]));
  assert.ok(lightness.every((value, i) => i === 0 || value < lightness[i - 1]));
  const { rows, samples } = quantityView(Object.entries({ XAI: 10, BEI: 40, LIC: 40, TET: 200 }).map(([code, produced]) => ({ code, produced })));
  for (const row of rows) assert.equal(row.fill, solo(row.produced));
  assert.deepEqual(samples, [10, 40, 200]);
  assert.deepEqual(quantityView([]).samples, []);
});

test('a coluna escolhida determina a quantidade e a cor; uma consulta INCAPE em falta não é zero', () => {
  const { quantityView } = require('../app/components/map');
  const data = [{ code: 'MAT', produced: 0, pending: 70, dispatched: 15, qcApproved: 30 }];
  for (const key of ['produced', 'pending', 'dispatched', 'qcApproved']) {
    const view = quantityView(data, key);
    assert.equal(view.rows[0].quantity, data[0][key]);
    assert.equal(view.rows[0].fill, quantityView([{ code: 'BEI', produced: data[0][key] }]).rows[0].fill);
    assert.deepEqual(view.samples, data[0][key] ? [data[0][key]] : []);
  }
  const { rows, samples } = quantityView([{ code: 'MAT', pending: null }, { code: 'LIC', pending: 0 }], 'pending');
  assert.deepEqual(rows.map((row) => row.quantity), [null, 0]);
  assert.equal(rows[0].fill, rows[1].fill);
  assert.deepEqual(samples, []);
});
