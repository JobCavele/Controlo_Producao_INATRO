/*
 * Conta Carta · vista Lotes
 *
 * Os números dos lotes abertos e o quadro das quatro fases. A etiqueta de
 * cada fase vem do componente `chips`, para ser a mesma no quadro e no
 * formulário do lote; as contas vivem no core.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/core.js'), require('../lib/dom.js'));
  else root.ContaCartaLotsView = factory(root.ContaCartaCore, root.ContaCartaDom);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, dom) {
  'use strict';

  const fmt = core.format;

  /**
   * `ui` traz `el`, `fill` e `stripCard`; `chips` a etiqueta da fase; `board`
   * lê os lotes; `lots` é a lista gravada; `filter` guarda a fase escolhida.
   */
  function create({ ui, chips, board, lots, filter }) {
    const { el, fill, stripCard } = ui;
    // o elemento pelo id vem da peça única do ecrã
  const $ = dom.byId;

    /** Os quatro números do topo: abertos, por despachar, despachados e cartas. */
    function kpis() {
      const state = board();
      fill($('lotKpis'),
        stripCard('Lotes abertos', fmt(state.total), 'em produção ou à espera', ''),
        stripCard('Por despachar', fmt(state.toDispatch), 'ainda não saíram do armazém', state.toDispatch ? 'is-warn' : 'is-ok'),
        stripCard('Despachados', fmt(state.dispatched), 'lotes já entregues', 'is-ok'),
        stripCard('Cartas em lotes', fmt(state.cards), 'somatório de todos os lotes', ''));
    }

    /** A linha de um lote: referência, delegação, cartas e as quatro fases. */
    function row(lot) {
      return el('tr', {}, [
        el('td', {}, [
          el('span', { class: 'cell-main', text: lot.reference }),
          el('span', { class: 'cell-sub', text: `aberto em ${core.shortDate(lot.start)}` }),
        ]),
        el('td', { text: lot.delegation || '—' }),
        el('td', { class: 'is-number is-strong', text: fmt(lot.quantity) }),
        ...core.LOT_STAGES.map((stage) => el('td', {}, chips.stage(lot.stages[stage], { showDate: true }))),
        el('td', { class: 'is-actions' }, [
          el('button', { class: 'row-btn', type: 'button', 'data-lot-edit': lot.id, text: 'Abrir' }),
          el('button', { class: 'row-btn is-danger', type: 'button', 'data-lot-delete': lot.id, text: 'Eliminar' }),
        ]),
      ]);
    }

    /** Desenha a vista inteira (filtro de fase, números e quadro). */
    function render() {
      const stages = ['', ...core.LOT_STAGES];
      if (!stages.includes(filter.lotsStage)) filter.lotsStage = '';
      fill($('lotsStage'), ...stages.map((stage) => el('option', {
        value: stage, text: stage ? core.LOT_STAGE_LABELS[stage] : 'Todas as fases', selected: stage === filter.lotsStage,
      })));
      kpis();
      const shown = lots()
        .filter((lot) => !filter.lotsStage || lot.stages[filter.lotsStage].state !== 'feito')
        .slice()
        // o lote mais recente fica em cima
        .sort((a, b) => (a.start > b.start ? -1 : a.start < b.start ? 1 : 0));
      if (!shown.length) {
        fill($('lotsTable'), el('div', { class: 'empty' }, [el('strong', { text: filter.lotsStage ? 'Não há lotes nesta fase' : 'Ainda sem lotes' })]));
        return;
      }
      const head = el('tr', {}, ['Lote', 'Delegação', 'Cartas', ...core.LOT_STAGES.map((stage) => core.LOT_STAGE_LABELS[stage]), '']
        .map((name, index) => el('th', { class: index === 2 ? 'is-number' : (index === 6 ? 'is-actions' : ''), text: name })));
      fill($('lotsTable'), el('table', {}, [el('thead', {}, head), el('tbody', {}, shown.map(row))]));
    }

    return { render };
  }

  return { create };
});
