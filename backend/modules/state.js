/*
 * Conta Carta · o estado guardado
 *
 * Os registos, os lotes e o material vivem num documento só, com um número de
 * revisão. Quem grava diz que revisão leu: se outra janela gravou entretanto,
 * a gravação é recusada em vez de passar por cima do que lá está.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const core = require('../../app/lib/core');
const { db, prepare, transaction, unreadable } = require('../shared/database');
const { failure } = require('../shared/http');

const SEED = path.resolve(__dirname, '../../app/seed.json');
const now = () => new Date().toISOString();

/**
 * Abre o estado no arranque e diz se a base ficou num ficheiro só. Uma base
 * nova recebe o estado inicial; uma que ficou de uma versão anterior é
 * convertida; uma que não se consegue ler trava o arranque com uma frase
 * clara, antes de se escrever seja o que for.
 */
function open() {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_state'").get();
  const row = exists ? db.prepare('SELECT revision, document FROM app_state WHERE id = 1').get() : null;
  let stored = null;
  let state = null;
  if (row) {
    try {
      stored = JSON.parse(row.document);
    } catch {
      throw unreadable('O documento guardado na base de dados está truncado ou ilegível. Nada foi alterado.');
    }
    try {
      state = core.validate(stored && stored.version === core.VERSION ? stored : core.migrate(stored));
    } catch (error) {
      throw unreadable(`Os registos guardados não passam na verificação: ${error.message} Nada foi alterado.`);
    }
  }
  const single = prepare();
  if (!row) {
    const seed = fs.existsSync(SEED) ? core.validate(JSON.parse(fs.readFileSync(SEED, 'utf8'))) : core.emptyState();
    db.prepare('INSERT INTO app_state(id, revision, document, updated_at) VALUES(1, 1, ?, ?)').run(JSON.stringify(seed), now());
  } else if (stored.version !== core.VERSION) {
    db.prepare('UPDATE app_state SET revision = ?, document = ?, updated_at = ? WHERE id = 1').run(row.revision + 1, JSON.stringify(state), now());
  }
  return single;
}

/** O que está guardado: a revisão, o estado e a hora da última gravação. */
function read() {
  const row = db.prepare('SELECT revision, document, updated_at FROM app_state WHERE id = 1').get();
  try {
    return { revision: row.revision, state: core.validate(JSON.parse(row.document)), savedAt: row.updated_at };
  } catch (error) {
    return failure(500, `Os registos guardados não passam na verificação: ${error.message}`);
  }
}

/**
 * Muda o estado numa transacção. `build` recebe o que está guardado e devolve
 * o que fica; tudo o que ele fizer na base (os movimentos que acompanham os
 * lotes, por exemplo) entra na mesma gravação. Quando devolve o próprio
 * estado guardado não há nada para escrever, e a revisão fica a que era.
 * Devolve a revisão e o estado que ficaram.
 */
function apply(build, guard) {
  return transaction(() => {
    const current = read();
    if (guard) guard(current.revision);
    const next = build(current.state);
    if (next === current.state) return { revision: current.revision, state: next };
    db.prepare('UPDATE app_state SET revision = ?, document = ?, updated_at = ? WHERE id = 1').run(current.revision + 1, JSON.stringify(next), now());
    return { revision: current.revision + 1, state: next };
  });
}

/** Grava o que o ecrã enviou, se a revisão que ele leu ainda for a que está guardada. */
const write = (revision, build) => apply(build, (stored) => {
  if (revision !== stored) failure(409, 'Outra janela guardou dados. Recarrega a página.');
});

/** Muda o estado por conta do próprio servidor (um movimento que mexe num lote ou num artigo). */
const change = (build) => apply(build);

module.exports = { open, read, write, change };
