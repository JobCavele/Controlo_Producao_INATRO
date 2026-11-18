/*
 * Conta Carta · a fechadura
 *
 * O que vem de uma lista — o lote escolhido, o material do contrato — lê-se,
 * não se reescreve: os campos ficam trancados e o interruptor «Editar»
 * abre-os, de propósito. Uma peça só, para os três formulários (o lote, o
 * dia e o material) fazerem o mesmo da mesma maneira.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/dom.js'));
  else root.ContaCartaLock = factory(root.ContaCartaDom);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (dom) {
  'use strict';

  /**
   * `set` é o <fieldset> com os campos que vêm da lista; `toggle` o
   * interruptor; `wrap` o rótulo que o embrulha (só aparece quando há o que
   * trancar); `onChange` avisa quem usa de que o interruptor mudou.
   */
  function create({ set, toggle, wrap, onChange }) {
    const $ = dom.byId;
    let guarded = false;   // há dados que vieram de uma lista
    let frozen = false;    // o formulário inteiro está só de leitura (o dia terminado)

    const editing = () => guarded && Boolean($(toggle).checked);

    function apply() {
      $(set).disabled = frozen || (guarded && !editing());
      $(toggle).disabled = frozen;
      $(wrap).hidden = !guarded;
    }

    /** Tranca (os campos vieram de uma lista) ou liberta (escreve-se à mão); o interruptor volta sempre a desligado. */
    function guard(on) {
      guarded = Boolean(on);
      $(toggle).checked = false;
      apply();
    }

    /** Pára tudo, interruptor incluído, ou devolve-o ao que estava. */
    function freeze(on) {
      frozen = Boolean(on);
      apply();
    }

    /** Liga o interruptor, uma vez. */
    function wire() {
      $(toggle).addEventListener('change', () => {
        apply();
        if (onChange) onChange(editing());
      });
    }

    return { guard, freeze, wire, editing, guarded: () => guarded };
  }

  return { create };
});
