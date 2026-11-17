/*
 * Conta Carta · o ecrã
 *
 * A única leitura do documento em toda a aplicação: o elemento pelo id.
 * Antes, cada módulo escrevia a sua própria linha; passa a haver uma só,
 * para o dia em que for preciso mudar a forma de procurar um elemento.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ContaCartaDom = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** O elemento com este id (ou `null`, como o `getElementById`). */
  const byId = (id) => document.getElementById(id);

  return { byId };
});
