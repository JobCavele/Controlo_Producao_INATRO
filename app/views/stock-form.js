/*
 * Conta Carta · formulário do material
 *
 * O diálogo do armazém. O material escolhe-se na lista do contrato (nada é
 * digitado à mão); o nome só vira campo quando se pede «Corrigir o nome»,
 * para material fora do contrato.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/core.js'), require('../lib/dom.js'));
  else root.ContaCartaStockForm = factory(root.ContaCartaCore, root.ContaCartaDom);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, dom) {
  'use strict';

  const KIND_LABELS = core.STOCK_KIND_LABELS;

  /**
   * `ui`, `form` e a lista do armazém; `submit` grava o material lido.
   * As duas datas do material são caixas de data (`ui.dateBox`), como no resto.
   */
  function create({ ui, form, submit, stock }) {
    const { el, fill, today, dateBox } = ui;
    // o elemento pelo id vem da peça única do ecrã
  const $ = dom.byId;
    // o diálogo e a barra de erro deste formulário (os ids do index.html)
    const dialog = { dialog: 'stockDialog', error: 'stockError' };

    /** O material em edição (ou `null`). */
    const draft = { editing: null };
    // as duas datas do material: a entrega e o último movimento
    const boxes = {};

    /** O nome é lido em voz baixa: só é um campo quando o botão o pede. */
    function setNameEditing(on) {
      const editing = Boolean(on);
      $('stockName').hidden = !editing;
      $('stockNameView').hidden = editing;
      $('stockNameToggle').setAttribute('aria-expanded', String(editing));
      $('stockNameToggle').textContent = editing ? 'Usar a lista do contrato' : 'Corrigir o nome';
      if (editing && $('stockName').focus) $('stockName').focus();
    }

    /** A linha de leitura acompanha o nome escolhido, sem parecer um campo por preencher. */
    function syncNameView() {
      const name = $('stockName').value.trim();
      $('stockNameView').textContent = name
        ? name
        : 'Escolhe o material na lista de cima — ou corrige o nome, se for material fora do contrato.';
      $('stockNameView').classList.toggle('is-empty', !name);
    }

    /** Preenche o formulário com um item do contrato: nada se escreve à mão. */
    function pickCatalogueItem(id) {
      const gap = core.CATALOGUE
        .map((entry, index) => ({ ...entry, id: `contrato-${String(index + 1).padStart(2, '0')}` }))
        .find((entry) => entry.id === id);
      if (!gap) return;
      $('stockName').value = gap.name;
      syncNameView();
      $('stockUnit').value = gap.unit;
      $('stockFormKind').value = gap.kind;
      $('stockContracted').value = gap.contracted;
      if (!$('stockMinimum').value) $('stockMinimum').value = core.stockSuggestedMinimum(gap.contracted);
    }

    /** Abre o diálogo vazio ou com um material para actualizar. */
    function open(itemId) {
      const item = itemId ? stock().find((entry) => entry.id === itemId) : null;
      if (!item && itemId) return null;
      draft.editing = item ? item.id : null;
      // a lista do contrato evita escrever nomes: escolher já preenche tipo, unidade e contratado
      const gaps = core.catalogueGaps(stock());
      fill($('stockPick'), el('option', { value: '', text: item ? `Manter «${item.name}»` : 'Escolher da lista do contrato…' }),
        ...gaps.map((gap) => el('option', { value: gap.id, text: `${gap.index + 1}. ${gap.name}` })));
      fill($('stockFormKind'), ...core.STOCK_KINDS.map((kind) => el('option', {
        value: kind, text: KIND_LABELS[kind], selected: item ? item.kind === kind : kind === 'tonner',
      })));
      $('stockName').value = item ? item.name : '';
      $('stockUnit').value = item ? item.unit : 'un.';
      $('stockContracted').value = item && item.contracted ? item.contracted : '';
      $('stockReceived').value = item ? item.received : '';
      $('stockIssued').value = item ? item.issued : '';
      $('stockMinimum').value = item && item.minimum ? item.minimum : '';
      boxes.delivered.set(item ? item.delivered : '');
      boxes.updated.set(item ? item.updated : today());
      setNameEditing(false);
      syncNameView();
      form.open(dialog, {
        title: item ? 'Actualizar material' : 'Novo material',
        titleId: 'stockDialogTitle',
        save: item ? 'Guardar alterações' : 'Guardar material',
        saveId: 'stockSave',
        focusId: 'stockPick',
      });
      return draft.editing;
    }

    /** Lê o formulário e devolve o material (ou o erro do core). */
    function read() {
      return core.makeStockItem({
        id: draft.editing,
        name: $('stockName').value,
        kind: $('stockFormKind').value,
        unit: $('stockUnit').value,
        contracted: $('stockContracted').value,
        received: $('stockReceived').value,
        issued: $('stockIssued').value,
        minimum: $('stockMinimum').value,
        delivered: boxes.delivered.value(),
        updated: boxes.updated.value(),
      });
    }

    const error = (message) => form.error(dialog, message);
    const close = () => { form.close(dialog); draft.editing = null; };

    /** Liga o formulário do material e os seus botões. */
    function wire() {
      // as duas datas do material, ligadas uma vez (são campos do index.html)
      boxes.delivered = dateBox({ id: 'stockDelivered', label: 'Data da entrega' });
      boxes.updated = dateBox({ id: 'stockUpdated', label: 'Data do movimento' });
      $('stockForm').addEventListener('submit', (event) => form.submit(event, dialog, read, submit));
      $('stockPick').addEventListener('change', (event) => pickCatalogueItem(event.target.value));
      $('stockNameToggle').addEventListener('click', () => setNameEditing($('stockName').hidden));
      $('stockName').addEventListener('input', syncNameView);
      $('stockClose').addEventListener('click', close);
      $('stockCancel').addEventListener('click', close);
      $('stockDialog').addEventListener('close', () => { draft.editing = null; });
    }

    /** O id do registo/lote/material em edição (ou `null`). */
    const editing = () => draft.editing;

    return { open, close, read, error, wire, editing };
  }

  return { create };
});
