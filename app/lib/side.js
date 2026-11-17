/*
 * Conta Carta · barra lateral recolhível
 *
 * A barra fecha-se para o painel ficar sozinho na TV. Aqui vive só a regra:
 * recolhida ou aberta, e o rótulo que o botão mostra — para o app.js não
 * crescer com decisões que se testam sozinhas.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ContaCartaSide = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** O que a interface precisa de saber: recolher ou não, e o rótulo do botão. */
  function sideState(open) {
    const isOpen = open !== false;
    return {
      open: isOpen,
      collapsed: !isOpen,
      label: isOpen ? 'Recolher a barra lateral' : 'Abrir a barra lateral',
      next: !isOpen,
    };
  }

  return { sideState };
});
