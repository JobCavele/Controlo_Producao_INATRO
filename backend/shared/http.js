/*
 * Conta Carta · pedidos e respostas
 *
 * O que todas as rotas usam: responder em JSON, recusar com uma frase que
 * diga o que corrigir, ler o corpo de um pedido e conferir quantidades e datas.
 */
'use strict';

const MAX_BODY = 5_000_000;   // 5 MB de cópia JSON

function send(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(payload));
}

/** Recusa o pedido: o estado HTTP e a frase que o ecrã mostra a quem está a trabalhar. */
function failure(status, message) {
  throw Object.assign(new Error(message), { status });
}

/**
 * Lê o corpo de um pedido como JSON. Os bocados juntam-se em bytes e só no
 * fim se lêem como texto: um «ç» ou um «é» que chegue partido entre dois
 * bocados fica inteiro.
 */
async function readJson(req) {
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) failure(413, 'Pedido demasiado grande.');
    parts.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
  } catch {
    return failure(400, 'JSON inválido.');
  }
}

/** Uma quantidade: inteiro positivo (ou zero, quando se aceita). */
function qty(value, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) failure(422, 'A quantidade deve ser um inteiro positivo.');
  return value;
}

/** Um dia em AAAA-MM-DD que exista no calendário. */
function day(text) {
  const real = typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`))
    && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
  if (!real) failure(422, 'Data inválida (AAAA-MM-DD).');
  return text;
}

module.exports = { send, failure, readJson, qty, day };
