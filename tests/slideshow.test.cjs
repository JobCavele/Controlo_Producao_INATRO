'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { create, FADE_MS } = require('../app/components/slideshow');
const { SEATS, quantityView } = require('../app/components/map');

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const log = [], fades = [];
  const tour = create({ render: (row, pos, total, phase) => log.push({ row, pos, total, phase }), fade: out => fades.push(out) });
  const tick = ms => t.mock.timers.tick(ms);
  const advance = (ms = 5000) => { tick(ms - FADE_MS); tick(FADE_MS); };
  return { tour, log, fades, tick, advance };
}

test('TV: cartões → por máquina → todas as sedes do mapa → cartões, a cada 5 s', t => {
  const { tour, log, fades, tick, advance } = setup(t);
  const rows = quantityView(Object.values(SEATS).reverse().map(code => ({ code, produced: 0, pending: null }))).rows;
  tour.setRows(rows);
  tour.start();
  assert.equal(log.at(-1).row, null);
  assert.equal(log.at(-1).phase, 'summary');
  tick(5000 - FADE_MS - 1); assert.equal(fades.at(-1), false);
  tick(1); assert.equal(fades.at(-1), true); assert.equal(log.length, 1);
  tick(FADE_MS); assert.equal(fades.at(-1), false);
  assert.deepEqual(log.at(-1), { row: null, pos: 0, total: 11, phase: 'machines' });
  for (let i = 0; i <= rows.length; i++) advance();
  assert.deepEqual(log.map(s => s.phase), ['summary', 'machines', ...rows.map(() => 'delegation'), 'summary']);
  assert.deepEqual(log.map(s => s.row?.code), [undefined, undefined, ...Object.values(SEATS), undefined]);
  assert.deepEqual(log.slice(2, 4).map(s => [s.pos, s.total, s.row.code]), [[1, 11, 'MAP-C'], [2, 11, 'MAT']]);
});

test('TV: a actualização dos dados conserva a sede e o tempo que falta; 15 s e pausa não duplicam o relógio', t => {
  const { tour, log, tick, advance } = setup(t);
  tour.setRows([{ code:'MAT', produced:1 }, { code:'XAI', produced:0 }]); tour.start(); advance(); advance();
  tick(2000); tour.setRows([{ code:'MAT', produced:27 }, { code:'XAI', produced:3 }]);
  assert.equal(log.at(-1).row.produced, 27);
  advance(3000); assert.equal(log.at(-1).row.code, 'XAI');
  tour.setSeconds(0); const count = log.length; tick(60000); assert.equal(log.length, count);
  tour.setSeconds(15); tick(15000 - FADE_MS); assert.equal(log.length, count);
  tick(FADE_MS); assert.equal(log.at(-1).row, null); assert.equal(log.at(-1).phase, 'summary');
});

test('TV: sem mapa alterna resumo e máquinas, sem mostrar uma delegação vazia', t => {
  const { tour, log, advance } = setup(t);
  tour.start();
  for (let i = 0; i < 4; i++) advance();
  assert.deepEqual(log.map(s => s.phase), ['summary', 'machines', 'summary', 'machines', 'summary']);
  assert.ok(log.every(s => s.row === null && s.pos === 0 && s.total === 0));
});

test('TV: actualizar dados conserva resumo ou máquinas e o tempo restante, mesmo sem sedes', t => {
  const { tour, log, tick, advance } = setup(t);
  tour.start();
  tick(2000); tour.setRows([{ code:'MAT' }]);
  assert.equal(log.at(-1).phase, 'summary');
  advance(3000); assert.equal(log.at(-1).phase, 'machines');
  tick(2000); tour.setRows([]);
  assert.equal(log.at(-1).phase, 'machines');
  advance(3000); assert.equal(log.at(-1).phase, 'summary');
  advance(); assert.equal(log.at(-1).phase, 'machines');
  tick(2000); tour.setRows([{ code:'XAI' }]);
  assert.equal(log.at(-1).phase, 'machines');
  advance(3000); assert.equal(log.at(-1).row.code, 'XAI');
  tour.setRows([]); assert.equal(log.at(-1).phase, 'summary');
  advance(); assert.equal(log.at(-1).phase, 'machines');
});

test('TV: sair ou ocultar a página cancela até o fade em curso', t => {
  const { tour, log, fades, tick, advance } = setup(t);
  tour.setRows([{ code:'PEM' }]); tour.start(); advance(); advance(); assert.equal(log.at(-1).row.code, 'PEM');
  tick(5000 - FADE_MS); assert.equal(fades.at(-1), true);
  tour.setVisible(false); tick(30000); assert.equal(fades.at(-1), false); assert.equal(log.at(-1).row.code, 'PEM');
  tour.setVisible(true); advance(); assert.equal(log.at(-1).phase, 'summary');
  tick(5000 - FADE_MS); tour.stop(); const count = log.length;
  assert.equal(log.at(-1).phase, 'summary');
  tick(30000); assert.equal(log.length, count); assert.equal(fades.at(-1), false);
  tour.start(); tour.start(); advance(); assert.equal(log.at(-1).phase, 'machines');
  advance(); assert.equal(log.at(-1).row.code, 'PEM');
});
