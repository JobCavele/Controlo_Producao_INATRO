'use strict';

function send(res, status, data, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers,
  });
  res.end(JSON.stringify(data));
}
function failure(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
async function readJson(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) failure(415, 'O pedido deve ser JSON.');
  let length = 0;
  const parts = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 50_000) failure(413, 'Pedido demasiado grande.');
    parts.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); }
  catch { failure(400, 'JSON inválido.'); }
}
function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) failure(422, `${label} deve ser um número inteiro entre 0 e 1 000 000 000.`);
  return value;
}
function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) failure(422, 'Data inválida.');
  return value;
}
function period(params) {
  const now = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Maputo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const start = day(params.get('start') || `${now.slice(0, 7)}-01`);
  const end = day(params.get('end') || now);
  if (start > end) failure(422, 'A data inicial deve ser anterior ou igual à final.');
  return { start, end };
}
module.exports = { send, failure, readJson, count, day, period };
