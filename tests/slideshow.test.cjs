'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { create, FADE_MS } = require('../app/components/slideshow');
const { SEATS, quantityView } = require('../app/components/map');

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const log = [], fades = [];
  const tour = create({ render: (row, pos, total) => log.push({ row, pos, total }), fade: out => fades.push(out) });
  const tick = ms => t.mock.timers.tick(ms);
  const advance = (ms = 5000) => { tick(ms - FADE_MS); tick(FADE_MS); };
  return { tour, log, fades, tick, advance };
}

test('TV: cartões → todas as sedes do mapa, incluindo zeros e sem consulta → cartões, a cada 5 s', t => {
  const { tour, log, fades, tick, advance } = setup(t);
  const rows = quantityView(Object.values(SEATS).reverse().map(code => ({ code, produced: 0, pending: null }))).rows;
  tour.setRows(rows);
  tour.start();
  assert.equal(log.at(-1).row, null);
  tick(5000 - FADE_MS - 1); assert.equal(fades.at(-1), false);
  tick(1); assert.equal(fades.at(-1), true); assert.equal(log.length, 1);
  tick(FADE_MS); assert.equal(fades.at(-1), false);
  for (let i = 1; i <= rows.length; i++) advance();
  assert.deepEqual(log.map(s => s.row?.code), [undefined, ...Object.values(SEATS), undefined]);
  assert.deepEqual(log.slice(1, 3).map(s => [s.pos, s.total, s.row.code]), [[1, 11, 'MAP-C'], [2, 11, 'MAT']]);
});

test('TV: a actualização dos dados conserva a sede e o tempo que falta; 15 s e pausa não duplicam o relógio', t => {
  const { tour, log, tick, advance } = setup(t);
  tour.setRows([{ code:'MAT', produced:1 }, { code:'XAI', produced:0 }]); tour.start(); advance();
  tick(2000); tour.setRows([{ code:'MAT', produced:27 }, { code:'XAI', produced:3 }]);
  assert.equal(log.at(-1).row.produced, 27);
  advance(3000); assert.equal(log.at(-1).row.code, 'XAI');
  tour.setSeconds(0); const count = log.length; tick(60000); assert.equal(log.length, count);
  tour.setSeconds(15); tick(15000 - FADE_MS); assert.equal(log.length, count);
  tick(FADE_MS); assert.equal(log.at(-1).row, null);
});

test('TV: sem mapa não avança para um slide vazio; sair ou ocultar a página cancela até o fade em curso', t => {
  const { tour, log, fades, tick, advance } = setup(t);
  tour.start(); tick(60000); assert.equal(log.length, 1);
  tour.setRows([{ code:'PEM' }]); advance(); assert.equal(log.at(-1).row.code, 'PEM');
  tick(5000 - FADE_MS); assert.equal(fades.at(-1), true);
  tour.setVisible(false); tick(30000); assert.equal(fades.at(-1), false); assert.equal(log.at(-1).row.code, 'PEM');
  tour.setVisible(true); advance(); assert.equal(log.at(-1).row, null);
  tick(5000 - FADE_MS); tour.stop(); const count = log.length;
  tick(30000); assert.equal(log.length, count); assert.equal(fades.at(-1), false);
  tour.start(); tour.start(); advance(); assert.equal(log.at(-1).row.code, 'PEM');
  tour.setRows([]); assert.equal(log.at(-1).row, null); tick(60000); assert.equal(log.at(-1).row, null);
});
