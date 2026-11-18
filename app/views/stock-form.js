/*
 * Conta Carta · formulário do material
 *
 * O diálogo do armazém. O material escolhe-se na lista do contrato: o nome,
 * o tipo, a unidade e o contratado vêm de lá e ficam trancados (a fechadura
 * de components/lock.js), como num artigo que já existe; «Editar» abre-os.
 * Só o material fora do contrato se escreve à mão.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/core.js'), require('../lib/dom.js'));
  else root.ContaCartaStockForm = factory(root.ContaCartaCore, root.ContaCartaDom);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, dom) {
  'use strict';

  const KIND_LABELS = core.STOCK_KIND_LABELS;

  /**
   * `ui`, `form` e a lista do armazém; `submit` grava o material lido; `lock`
   * é a peça da fechadura. As duas datas do material são caixas de data
   * (`ui.dateBox`), como no resto.
   */
  function create({ ui, form, submit, stock, lock }) {
    const { el, fill, today, dateBox } = ui;
    const $ = dom.byId;
    // o diálogo e a barra de erro deste formulário (os ids do index.html)
    const dialog = { dialog: 'stockDialog', error: 'stockError' };

    /** O material em edição (ou `null`). */
    const draft = { editing: null };
    // as duas datas do material: a entrega e o último movimento
    const boxes = {};
    // o nome, o tipo, a unidade e o contratado: trancados quando vêm do contrato ou de um artigo que já existe
    const identity = lock.create({ set: 'stockIdentity', toggle: 'stockEdit', wrap: 'stockEditWrap', onChange: () => note() });

    /** A linha por baixo dos dados do material: de onde vêm, e o que «Editar» corrige. */
    function note() {
      const line = $('stockLockNote');
      line.hidden = !identity.guarded();
      line.classList.toggle('is-warn', identity.editing());
      line.textContent = identity.editing() ? 'Estás a corrigir os dados deste material: confere-os com o contrato antes de guardar.'
        : draft.editing ? 'Para corrigir o nome, o tipo, a unidade ou o contratado, liga «Editar».'
          : 'São os dados do contrato. Para os corrigir, liga «Editar».';
    }

    /** Os dados do material no formulário: os de um artigo, os de um item do contrato, ou em branco. */
    function setIdentity(from) {
      $('stockName').value = from ? from.name : '';
      $('stockFormKind').value = from ? from.kind : 'tonner';
      $('stockUnit').value = from ? from.unit : 'un.';
      $('stockContracted').value = from && from.contracted ? from.contracted : '';
      identity.guard(Boolean(from));
      note();
    }

    /**
     * Escolher um item do contrato preenche o material sem se escrever nada,
     * e tranca-o; «fora do contrato» devolve os campos para se escreverem.
     */
    function pickCatalogueItem(id) {
      const gap = core.catalogueGaps(stock()).find((entry) => entry.id === id);
      setIdentity(gap || null);
      if (gap && !$('stockMinimum').value) $('stockMinimum').value = core.stockSuggestedMinimum(gap.contracted);
    }

    /** Abre o diálogo vazio ou com um material para actualizar. */
    function open(itemId) {
      const item = itemId ? stock().find((entry) => entry.id === itemId) : null;
      if (!item && itemId) return null;
      draft.editing = item ? item.id : null;
      // a lista do contrato evita escrever nomes; um artigo que já existe não se escolhe outra vez
      const gaps = core.catalogueGaps(stock());
      $('stockPickWrap').hidden = Boolean(item) || !gaps.length;
      fill($('stockPick'), el('option', { value: '', text: 'Material fora do contrato (escrever o nome)' }),
        ...gaps.map((gap) => el('option', { value: gap.id, text: `${gap.index + 1}. ${gap.name}` })));
      fill($('stockFormKind'), ...core.STOCK_KINDS.map((kind) => el('option', { value: kind, text: KIND_LABELS[kind] })));
      setIdentity(item);
      $('stockReceived').value = item ? item.received : '';
      $('stockIssued').value = item ? item.issued : '';
      $('stockMinimum').value = item && item.minimum ? item.minimum : '';
      boxes.delivered.set(item ? item.delivered : '');
      boxes.updated.set(item ? item.updated : today());
      form.open(dialog, {
        title: item ? 'Actualizar material' : 'Novo material',
        titleId: 'stockDialogTitle',
        save: item ? 'Guardar alterações' : 'Guardar material',
        saveId: 'stockSave',
        focusId: item ? 'stockReceived' : (gaps.length ? 'stockPick' : 'stockName'),
      });
      return draft.editing;
    }

    /** Lê o formulário e devolve o material (ou o erro do core). O que o formulário não mostra — as notas — fica como estava. */
    function read() {
      const kept = draft.editing ? stock().find((entry) => entry.id === draft.editing) : null;
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
        notes: kept ? kept.notes : '',
      });
    }

    const error = (message) => form.error(dialog, message);
    const close = () => { form.close(dialog); draft.editing = null; };

    /** Liga o formulário do material e os seus botões. */
    function wire() {
      // as duas datas do material, ligadas uma vez (são campos do index.html)
      boxes.delivered = dateBox({ id: 'stockDelivered', label: 'Data da entrega' });
      boxes.updated = dateBox({ id: 'stockUpdated', label: 'Data do movimento' });
      identity.wire();
      $('stockForm').addEventListener('submit', (event) => form.submit(event, dialog, read, submit));
      $('stockPick').addEventListener('change', (event) => pickCatalogueItem(event.target.value));
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
