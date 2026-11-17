/*
 * Conta Carta · vista Armazém
 *
 * Os três números do armazém, a tabela do material e o filtro por tipo. A
 * regra dos saldos e dos mínimos vive no core; aqui só se desenha o que ele
 * devolve.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/core.js'), require('../lib/dom.js'));
  else root.ContaCartaStockView = factory(root.ContaCartaCore, root.ContaCartaDom);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, dom) {
  'use strict';

  const fmt = core.format;
  const KIND_LABELS = core.STOCK_KIND_LABELS;

  /** `ui` traz o desenho (`el`, `fill`, `stripCard`); `overview` lê o armazém. */
  function create({ ui, overview, filter }) {
    const { el, fill, stripCard } = ui;
    // o elemento pelo id vem da peça única do ecrã
  const $ = dom.byId;

    /** Os quatro números grandes do topo da vista. */
    function kpis() {
      const board = overview();
      const low = board.low.length;
      const pending = board.pending.length;
      fill($('stockKpis'),
        stripCard('Cartões em armazém', fmt(board.cards), 'cartões em branco disponíveis', board.cards ? '' : 'is-bad'),
        stripCard('Material em alerta', fmt(low), low ? 'no mínimo ou abaixo dele' : 'tudo acima do mínimo', low ? 'is-bad' : 'is-ok'),
        stripCard('Por entregar', fmt(pending), pending ? 'do contrato, ainda em falta' : 'contrato todo entregue', pending ? 'is-warn' : 'is-ok'),
        stripCard('Material controlado', fmt(board.items.length), 'artigos no armazém', ''));
    }

    /** A linha de um material: nome, tipo, contrato, saldo e as duas acções. */
    function row(item) {
      return el('tr', { class: item.low ? 'is-low' : '' }, [
        el('td', {}, [
          el('span', { class: 'cell-main', text: item.name }),
          item.delivered ? el('span', { class: 'cell-sub', text: `entregue em ${core.shortDate(item.delivered)}` })
            : item.updated ? el('span', { class: 'cell-sub', text: `movimento em ${core.shortDate(item.updated)}` }) : '',
        ]),
        el('td', { class: 'is-kind', text: KIND_LABELS[item.kind] || KIND_LABELS.outro }),
        el('td', { class: 'is-number', text: item.contracted ? fmt(item.contracted) : '—' }),
        el('td', { class: `is-number${item.pending ? ' is-warn' : ''}`, text: item.pending ? fmt(item.pending) : '—' }),
        el('td', { class: 'is-number', text: fmt(item.received) }),
        el('td', { class: 'is-number', text: fmt(item.issued) }),
        el('td', { class: `is-number is-strong${item.low ? ' is-bad' : ''}` }, el('span', { text: `${fmt(item.balance)} ${item.unit}` })),
        el('td', { class: 'is-number', text: item.minimum ? fmt(item.minimum) : '—' }),
        el('td', { class: 'is-actions' }, [
          el('button', { class: 'row-btn', type: 'button', 'data-stock-edit': item.id, text: 'Actualizar' }),
          el('button', { class: 'row-btn is-danger', type: 'button', 'data-stock-delete': item.id, text: 'Eliminar' }),
        ]),
      ]);
    }

    /** Desenha a vista inteira (filtro, números e tabela). */
    function render() {
      const board = overview();
      const kinds = ['', ...core.STOCK_KINDS];
      if (!kinds.includes(filter.stockKind)) filter.stockKind = '';
      fill($('stockKind'), ...kinds.map((kind) => el('option', {
        value: kind, text: kind ? KIND_LABELS[kind] : 'Todo o material', selected: kind === filter.stockKind,
      })));
      kpis();
      const shown = board.items
        .filter((item) => !filter.stockKind || item.kind === filter.stockKind)
        // o que está no mínimo vem primeiro; depois, por nome
        .sort((a, b) => (b.low - a.low) || (a.name < b.name ? -1 : 1) || 0);
      if (!shown.length) {
        fill($('stockTable'), el('div', { class: 'empty' }, [el('strong', { text: filter.stockKind ? 'Não há material desse tipo no armazém' : 'Ainda sem material no armazém' })]));
        return;
      }
      const head = el('tr', {}, ['Material', 'Tipo', 'Contratado', 'Por entregar', 'Recebido', 'Dado', 'Em armazém', 'Mínimo', '']
        .map((name, index) => el('th', { class: index >= 2 && index <= 7 ? 'is-number' : (index === 8 ? 'is-actions' : ''), text: name })));
      fill($('stockTable'), el('table', {}, [el('thead', {}, head), el('tbody', {}, shown.map(row))]));
    }

    return { render };
  }

  return { create };
});
