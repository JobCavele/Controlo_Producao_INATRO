/*
 * Conta Carta · servidor local
 *
 * Serve a aplicação de `app/` e guarda os dados em SQLite, só para este
 * computador (127.0.0.1). As rotas:
 *   GET/PUT  /api/state        o estado (registos, lotes, material), com revisão
 *   GET      /api/delegations  o catálogo das delegações
 *   GET/POST /api/operations   os movimentos por quantidades e os seus saldos
 */
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const MAIN = require.main === module;
const [major, minor] = process.versions.node.split('.').map(Number);
if (MAIN && (major < 22 || (major === 22 && minor < 13))) {
  console.error(`O Conta Carta precisa do Node.js 22.13 ou superior; este computador tem o ${process.versions.node}.`);
  console.error('Instala a versão actual a partir de https://nodejs.org/ e volta a abrir o programa.');
  process.exit(1);
}

const core = require('../app/lib/core');
const { send, readJson, failure } = require('./shared/http');

let database;
let state;
let delegations;
let operations;
let follow;
let single = true;
try {
  database = require('./shared/database');
  state = require('./modules/state');
  delegations = require('./modules/delegations');
  operations = require('./modules/operations');
  follow = require('./modules/follow');
  single = state.open();
  delegations.sync();
  // o que ficou guardado por uma versão anterior fica de acordo logo ao abrir: os dias com os lotes, as fases com os movimentos
  state.change(operations.settle);
} catch (error) {
  // aberto por quem trabalha, o programa diz o que se passa e pára; nos testes, o erro segue para quem o chamou
  if (!MAIN || !error.readable) throw error;
  console.error(`Não foi possível abrir os dados. ${error.message}`);
  console.error('Os registos continuam no ficheiro original. Recupera uma cópia exportada ou fala com o técnico.');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '../app');
const PORT = Number(process.env.PORT || 8000);
const TYPES = { html: 'text/html', css: 'text/css', js: 'text/javascript', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', ico: 'image/x-icon' };

/** O que o pedido diz que é a sua origem, ou '' se não se percebe. */
function hostOf(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return '';
  }
}

async function route(req, res) {
  let url;
  let pathname;
  try {
    url = new URL(req.url, 'http://localhost');
    pathname = decodeURIComponent(url.pathname);
  } catch {
    failure(400, 'Endereço inválido.');
  }
  if (!['GET', 'HEAD', 'POST', 'PUT'].includes(req.method)) failure(405, 'Método não autorizado.');
  if (['POST', 'PUT'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin && hostOf(origin) !== req.headers.host) failure(403, 'Origem não autorizada.');
  }

  if (pathname === '/api/state' && req.method === 'GET') {
    return send(res, 200, { ...state.read(), storage: 'sqlite', fileName: path.basename(database.file) });
  }
  if (pathname === '/api/state' && req.method === 'PUT') {
    const payload = await readJson(req);
    let sent;
    try {
      sent = core.validate(payload.state);
    } catch (error) {
      failure(422, error.message);
    }
    // uma cópia importada traz os seus movimentos: entram com o estado, na mesma gravação
    const copy = payload.operations === undefined ? null : follow.fromCopy(payload.operations);
    const stored = state.write(payload.revision, (previous) => {
      follow.state(previous, sent, copy);
      return operations.settle(sent);
    });
    // quando o que ficou guardado não é o que veio (uma fase que os movimentos dizem de outra maneira), quem gravou recebe-o de volta
    return send(res, 200, stored.state === sent ? { revision: stored.revision } : stored);
  }
  if (pathname === '/api/delegations' && req.method === 'GET') return send(res, 200, delegations.all());
  if (pathname === '/api/operations' && req.method === 'GET') {
    return send(res, 200, operations.dashboard(state.read().state, url.searchParams.get('start'), url.searchParams.get('end')));
  }
  if (pathname === '/api/operations' && req.method === 'POST') {
    const data = await readJson(req);
    let made;
    // o movimento e o que ele muda no quadro ou no armazém ficam gravados juntos, ou não fica nada
    const stored = state.change((current) => {
      made = operations.insert(data, current);
      return made.state;
    });
    return send(res, 201, { id: made.id, revision: stored.revision, lot: made.lot, stock: made.stock });
  }
  if (pathname === '/api/log' && req.method === 'POST') return send(res, 200, { ok: true });
  if (pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end('window.CONTACARTA_CONFIG={storage:"sqlite"};');
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') failure(404, 'Rota inexistente.');
  const file = path.resolve(ROOT, pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) failure(404, 'Ficheiro não encontrado.');
  // «no-cache»: o navegador confirma sempre que tem a versão actual, para não ficar com o ecrã de uma versão e o servidor de outra
  res.writeHead(200, {
    'Content-Type': `${TYPES[path.extname(file).slice(1)] || 'application/octet-stream'}; charset=utf-8`,
    'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    // 5 e 6 são os códigos do SQLite para «base ocupada»: outro programa tem o ficheiro preso a meio de uma escrita
    const busy = !error.status && (error.errcode === 5 || error.errcode === 6);
    const status = error.status || (busy ? 503 : 500);
    const message = error.status ? error.message
      : busy ? 'A base de dados está ocupada por outro programa. Fecha-o e tenta outra vez; nada foi alterado.' : 'Erro interno do servidor.';
    if (!res.headersSent) send(res, status, { error: message });
    // na consola fica a frase que o ecrã recebeu; de um erro que ninguém previu, fica o próprio erro, para se perceber
    console.error(status === 500 ? error.message : message);
  });
});

if (MAIN) {
  server.on('error', (error) => {
    if (error.code !== 'EADDRINUSE') throw error;
    console.error(`A porta ${PORT} já está ocupada: o Conta Carta já deve estar aberto noutra janela (http://localhost:${PORT}).`);
    console.error('Fecha essa janela primeiro, ou escolhe outra porta com a variável PORT.');
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Conta Carta: http://localhost:${PORT}`);
    console.log(`Dados: ${database.file}`);
    if (!single) console.log('Aviso: outro programa tem a base de dados aberta; fecha-o para os dados ficarem todos no mesmo ficheiro.');
  });
  // sair com Ctrl+C fecha o ficheiro dos dados em ordem
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => process.exit(0));
}

module.exports = server;
