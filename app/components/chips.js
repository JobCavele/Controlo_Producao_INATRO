/*
 * Conta Carta · etiquetas de fase
 *
 * A etiqueta de uma fase de lote (feito / em curso / por fazer) aparece no
 * quadro dos lotes e no formulário, com o mesmo texto e a mesma cor. A regra
 * está aqui uma vez; quem desenha empresta só a função de criar elementos.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ContaCartaChips = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Classes e textos por estado de uma fase: a mesma cor no quadro e no formulário. */
  const STAGE_TONES = { feito: 'done', 'em-curso': 'live', pendente: 'todo' };
  const STAGE_TEXTS = { feito: 'feito', 'em-curso': 'em curso', pendente: 'por fazer' };

  /**
   * A fase de um lote como dados (tom e texto). `showDate` é para o quadro —
   * uma fase feita mostra o dia em que ficou feita; no formulário diz «feito».
   */
  function stageParts(entry, { showDate = false, shortDate = String } = {}) {
    const done = entry.state === 'feito';
    return {
      tone: STAGE_TONES[entry.state] || 'todo',
      text: showDate && done && entry.updated ? shortDate(entry.updated) : STAGE_TEXTS[entry.state] || STAGE_TEXTS.pendente,
    };
  }

  /** A mesma etiqueta já desenhada, com a função `el` de quem a usa. */
  function create({ el, shortDate }) {
    return {
      stage: (entry, { showDate = false } = {}) => {
        const { tone, text } = stageParts(entry, { showDate, shortDate });
        return el('span', { class: `stage-chip is-${tone}`, text });
      },
    };
  }

  return { create, stageParts, STAGE_TONES };
});
