/*
 * Conta Carta · delegações
 *
 * O catálogo é o de `app/lib/delegations.js`, o mesmo que o ecrã usa: uma
 * delegação por província e a da Cidade de Maputo. A tabela da base é o seu
 * espelho e refaz-se a cada arranque, para não ficar com nomes de outra versão.
 */
'use strict';

const catalogue = require('../../app/lib/delegations');
const { db, transaction } = require('../shared/database');

/** Refaz a tabela a partir do catálogo (no arranque, depois de a base estar pronta). */
function sync() {
  transaction(() => {
    db.exec('DELETE FROM delegations');
    const insert = db.prepare('INSERT INTO delegations(code, name, province) VALUES(?, ?, ?)');
    for (const entry of catalogue.LIST) insert.run(entry.code, entry.name, entry.province);
  });
}

/** As delegações, por ordem alfabética: código, nome e província. */
function all() {
  return db.prepare('SELECT code, name, province FROM delegations ORDER BY name').all();
}

module.exports = { sync, all };
