/*
 * Conta Carta · diálogo de formulário
 *
 * Os três formulários (registo, lote, material) abrem, mostram erros e fecham
 * da mesma maneira, e cada um tem o seu id e a sua barra de erro. Esta peça
 * recebe esse par (`{ dialog, error }`) e faz sempre o mesmo — quem chama só
 * diz em que diálogo está a trabalhar.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ContaCartaForm = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Fábrica ligada ao documento e ao aviso curto de quem usa. */
  function create({ document, $, toast }) {
    /**
     * Abre um <dialog> já limpo, com título, rótulo do botão e foco certos.
     * `fields` traz os pares id-do-título / id-do-botão que este diálogo usa.
     */
    function open({ dialog, error }, { title, titleId, save, saveId, focusId }) {
      if (titleId && title) $(titleId).textContent = title;
      if (saveId && save) $(saveId).textContent = save;
      clearError({ error });
      const node = $(dialog);
      node.showModal();
      const focus = focusId && $(focusId);
      if (focus && focus.focus) focus.focus();
      return node;
    }

    /** O erro de um formulário: a mensagem à vista e anunciada. */
    function error({ error: errorId }, message) {
      const node = errorId && $(errorId);
      if (!node) return;
      node.textContent = message || '';
      node.hidden = !message;
    }

    const clearError = (descriptor) => error(descriptor, '');

    /** Fecha o diálogo e limpa o erro, para a próxima abertura ser limpa. */
    function close(descriptor) {
      clearError(descriptor);
      $(descriptor.dialog).close();
    }

    /** Um formulário só se submete com dados válidos: valida e devolve o erro. */
    function submit(event, descriptor, read, run) {
      event.preventDefault();
      let value;
      try {
        value = read();
      } catch (caught) {
        error(descriptor, caught.message);
        return false;
      }
      return run(value);
    }

    /** Um formulário só abre com os dados carregados; senão avisa e não abre. */
    function ready(isReady) {
      if (isReady) return true;
      toast('Aguarda que os registos sejam abertos.');
      return false;
    }

    return { open, close, error, clearError, submit, ready };
  }

  return { create };
});
