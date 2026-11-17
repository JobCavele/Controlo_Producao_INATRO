/*
 * Conta Carta · retorno ao utilizador
 *
 * Tudo o que a aplicação diz a quem está a usá-la: o aviso curto de baixo
 * (`toast`), a barra de erro, o registo curto do servidor, a caixa de
 * confirmação, o download de um ficheiro e a dica do 🛈. Estava tudo no
 * app.js, espalhado por três mil linhas; passa a estar aqui uma vez, com um
 * contrato só: cada acção passa por `guard` e fala por estas funções.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ContaCartaFeedback = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Fábrica ligada ao documento, à ajuda e à rede.
   * `onServer` decide se os erros também vão para `dados/contacarta.log`;
   * `help` é o mapa de frases do core (o 🛈 só mostra, não inventa texto).
   */
  function create({ $, el, fill, help, sendLog }) {
    /* ------------------------------------------------------ avisos --- */

    /** Aviso curto no fundo do ecrã; o temporizador é um só, o último manda. */
    function toast(message) {
      const node = $('toast');
      node.textContent = message;
      node.hidden = false;
      clearTimeout(toast.timer);
      toast.timer = setTimeout(() => { node.hidden = true; }, 5400);
    }

    /** A barra de erro do topo (arranque): uma frase que se percebe. */
    function showError(message) {
      const bar = $('loadError');
      bar.textContent = message;
      bar.hidden = false;
    }
    const clearError = () => { $('loadError').hidden = true; };

    /** O detalhe técnico vai para o registo; a pessoa vê uma frase curta. */
    function reportError(detail) {
      if (window.console) console.warn('[Conta Carta]', detail);
      if (sendLog) sendLog(detail);
    }

    /**
     * Nenhum botão pode falhar em silêncio: o erro aparece e fica em registo.
     * Devolve a função embrulhada — as acções passam todas por aqui.
     */
    function guard(name, run) {
      const fail = (error) => {
        reportError(`${name}: ${error && error.message}`);
        toast('Não foi possível completar essa acção. Tenta outra vez.');
        return undefined;
      };
      return (...args) => {
        let result;
        try {
          result = run(...args);
        } catch (error) {
          return fail(error);
        }
        return result && typeof result.catch === 'function' ? result.catch(fail) : result;
      };
    }

    /* ------------------------------------------------- confirmações --- */

    // a acção da confirmação aberta; uma de cada vez, como o <dialog> mostra
    let confirmed = null;

    /** Pergunta antes de apagar ou substituir: título, consequência e verbo. */
    function confirm(title, text, actionLabel, action) {
      $('confirmTitle').textContent = title;
      $('confirmText').textContent = text;
      $('confirmYes').textContent = actionLabel;
      confirmed = action;
      $('confirmDialog').showModal();
    }

    /** O «Sim» do diálogo: fecha primeiro e só depois corre a acção. */
    function confirmYes() {
      const action = confirmed;
      confirmed = null;
      $('confirmDialog').close();
      if (action) guard('confirmação', action)();
    }

    const confirmNo = () => $('confirmDialog').close();

    /* ----------------------------------------------------- ficheiros --- */

    /** Entrega um ficheiro ao navegador (JSON, PDF, CSV) sem sair da página. */
    function download(name, data, type) {
      const url = URL.createObjectURL(new Blob([data], { type }));
      const link = el('a', { href: url, download: name });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    /* ---------------------------------------------------------- ajuda --- */

    /** A caixa do 🛈: abre ao pé do botão premido e fecha se for o mesmo. */
    function tip(button) {
      const node = $('tip');
      const key = button.dataset.info;
      if (!node.hidden && node.dataset.owner === key) { node.hidden = true; return; }
      node.dataset.owner = key;
      fill(node, el('p', { text: help[key] || key }));
      node.hidden = false;
      const box = button.getBoundingClientRect();
      const width = Math.min(300, window.innerWidth - 24);
      node.style.width = `${width}px`;
      node.style.left = `${Math.max(12, Math.min(box.left, window.innerWidth - width - 12))}px`;
      node.style.top = `${box.bottom + 8}px`;
    }

    const hideTip = () => { $('tip').hidden = true; };

    return { toast, showError, clearError, reportError, guard, confirm, confirmYes, confirmNo, download, tip, hideTip };
  }

  return { create };
});
