'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
const script = fs.readFileSync(path.join(ROOT, 'app/app.js'), 'utf8');

test('os controlos utilizados pelo JavaScript existem no HTML', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const used = [...script.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]);
  const missing = [...new Set(used.filter((id) => !ids.has(id)))];
  assert.deepEqual(missing, []);
});

test('aplicação sem dependências antigas nem armazenamento no navegador', () => {
  assert.doesNotMatch(script, /localStorage|sessionStorage|Lote|stock|python/i);
  assert.doesNotMatch(html, /lote|material de consumo|movimento de lote/i);
  for (const name of ['server.py', 'iniciar.sh', 'Iniciar_Windows.bat', 'Compilar_Windows.bat', 'app/config.js'])
    assert.equal(fs.existsSync(path.join(ROOT, name)), false, name);
});

test('mapa local e servidores JS disponíveis', () => {
  assert.ok(fs.statSync(path.join(ROOT, 'app/mocambique.svg')).size > 10000);
  assert.ok(fs.statSync(path.join(ROOT, 'app/components/map.js')).size > 1000);
});
