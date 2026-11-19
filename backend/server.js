'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { db } = require('./shared/database');
const { send, failure, readJson, period } = require('./shared/http');
const auth = require('./modules/auth');
const delegations = require('./modules/delegations');
const entries = require('./modules/entries');
const { dashboard } = require('./modules/dashboard');

const APP = path.resolve(__dirname, '../app');
const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '127.0.0.1';
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
const security = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
};

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  if (!['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(req.method)) failure(405, 'Método não autorizado.');
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin) {
      let incomingHost;
      try { incomingHost = new URL(origin).host; } catch { failure(403, 'Origem não autorizada.'); }
      if (incomingHost !== req.headers.host) failure(403, 'Origem não autorizada.');
    }
  }

  if (pathname === '/api/setup-status' && req.method === 'GET') return send(res, 200, { ready: auth.isConfigured() });
  if (pathname === '/api/session' && req.method === 'GET') return send(res, 200, { role: auth.session(req)?.role || null });
  if (pathname === '/api/login' && req.method === 'POST') {
    if (!auth.isConfigured()) failure(503, 'Configure as duas contas com npm run setup.');
    const body = await readJson(req);
    const user = auth.login(body.role, body.password, req.socket.remoteAddress);
    return send(res, 200, { role: user.role }, { 'Set-Cookie': auth.cookie(user.token, req) });
  }
  if (pathname === '/api/logout' && req.method === 'POST') {
    await readJson(req);
    auth.logout(req);
    return send(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
  }
  if (pathname === '/api/dashboard' && req.method === 'GET') {
    auth.requireRole(req);
    return send(res, 200, dashboard(url.searchParams));
  }
  if (pathname === '/api/delegations' && req.method === 'GET') {
    auth.requireRole(req);
    return send(res, 200, delegations.all());
  }
  if (pathname === '/api/entries' && req.method === 'GET') {
    auth.requireRole(req, 'fabrica');
    const { start, end } = period(url.searchParams);
    return send(res, 200, entries.list(start, end));
  }
  if (pathname === '/api/audit' && req.method === 'GET') {
    auth.requireRole(req, 'fabrica');
    return send(res, 200, db.prepare('SELECT role,action,category,record_key,created_at FROM audit_log ORDER BY id DESC LIMIT 80').all());
  }
  const entryMatch = pathname.match(/^\/api\/entries\/(pending|production|quality|dispatch)$/);
  if (entryMatch && ['PUT', 'DELETE'].includes(req.method)) {
    auth.requireRole(req, 'fabrica');
    const body = await readJson(req);
    const result = req.method === 'PUT' ? entries.write(entryMatch[1], body, 'fabrica') : entries.remove(entryMatch[1], body, 'fabrica');
    return send(res, 200, result);
  }

  if (pathname.startsWith('/api/')) failure(404, 'Rota inexistente.');
  if (req.method !== 'GET' && req.method !== 'HEAD') failure(405, 'Método não autorizado.');
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(APP, relative);
  if (!file.startsWith(APP + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) failure(404, 'Ficheiro inexistente.');
  res.writeHead(200, {
    'Content-Type': (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8',
    'Cache-Control': relative === 'index.html' ? 'no-store' : 'public, max-age=3600',
    ...security,
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : 'Erro interno do servidor.' });
    if (!error.status) console.error(error);
  });
});
if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`Conta Carta: http://${HOST}:${PORT}\nContas: ${auth.isConfigured() ? 'configuradas' : 'execute npm run setup antes de entrar'}`));
}
module.exports = server;
