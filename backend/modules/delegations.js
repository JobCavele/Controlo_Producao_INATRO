'use strict';

const { db } = require('../shared/database');

// Uma sede por província. A Cidade de Maputo e a Matola têm códigos distintos.
const catalogue = [
  ['MAP-C', 'Maputo Cidade', 'Maputo Cidade', -25.965, 32.583],
  ['MAT', 'Matola', 'Maputo', -25.962, 32.459],
  ['XAI', 'Xai-Xai', 'Gaza', -25.052, 33.645],
  ['INH', 'Inhambane', 'Inhambane', -23.87, 35.39],
  ['BEI', 'Beira', 'Sofala', -19.84, 34.84],
  ['CHI-S', 'Chimoio', 'Manica', -19.12, 33.48],
  ['TET', 'Tete', 'Tete', -16.16, 33.59],
  ['QUE', 'Quelimane', 'Zambézia', -17.88, 36.89],
  ['NAM', 'Nampula', 'Nampula', -15.12, 39.27],
  ['LIC', 'Lichinga', 'Niassa', -13.31, 35.24],
  ['PEM', 'Pemba', 'Cabo Delgado', -12.97, 40.52],
];
const insert = db.prepare('INSERT OR IGNORE INTO delegations(code,name,province,lat,lng) VALUES(?,?,?,?,?)');
for (const row of catalogue) insert.run(...row);

function all() {
  return db.prepare('SELECT code,name,province,lat,lng FROM delegations ORDER BY province,name').all();
}

module.exports = { all };
