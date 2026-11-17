/*
 * Conta Carta · formulário do lote
 *
 * O diálogo de um lote: referência, delegação, cartas e o estado das quatro
 * fases (data e quantidade em cada uma). A etiqueta da fase vem de
 * components/chips.js, a mesma do quadro dos lotes.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/core.js'), require('../lib/dom.js'));
  else root.ContaCartaLotForm = factory(root.ContaCartaCore, root.ContaCartaDom);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, dom) {
  'use strict';

  /**
   * `ui`, `form`, `chips` e a lista de lotes; `submit` grava o lote lido.
   * Todas as datas do lote são caixas de data (`ui.dateBox`), como no resto.
   */
  function create({ ui, form, chips, submit, lots }) {
    const { el, fill, today, dateBox } = ui;
    // o elemento pelo id vem da peça única do ecrã
  const $ = dom.byId;
    // o diálogo e a barra de erro deste formulário (os ids do index.html)
    const dialog = { dialog: 'lotDialog', error: 'lotError' };

    /** O lote em edição (ou `null`). */
    const draft = { editing: null };
    // as caixas de data do lote: a de abertura e as quatro das fases
    const boxes = { start: null, stages: {} };

    /** Um campo de uma fase: rótulo e controlo (estado, data ou cartas). */
    const field = (label, control) => el('label', { class: 'field' }, [label, control]);

    /** O bloco de uma fase: nome, etiqueta do estado e três campos alinhados. */
    function stageBlock(stage, index, lot) {
      const entry = lot?.stages?.[stage] || { state: 'pendente', updated: '', quantity: '' };
      // a linha nasce a cada abertura do diálogo, por isso o campo e a caixa
      // nascem aqui (não vêm do index.html, esse já não tem estes campos)
      const updatedField = el('input', {
        id: `ls-${stage}-updated`, type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', placeholder: 'dd/mm/aaaa',
      });
      const updated = dateBox({ input: updatedField, label: `Data de ${core.LOT_STAGE_LABELS[stage]}`, value: entry.updated || '' });
      boxes.stages[stage] = updated;
      return el('div', { class: 'lot-stage-row', role: 'listitem' }, [
        el('div', { class: 'lot-stage-head' }, [
          el('span', { class: 'lot-stage-step', text: String(index + 1) }),
          el('span', { class: 'lot-stage-name', text: core.LOT_STAGE_LABELS[stage] }),
          chips.stage(entry),
        ]),
        el('div', { class: 'lot-stage-fields' }, [
          field('Estado', el('select', { id: `ls-${stage}-state` },
            core.LOT_STATUS.map((state) => el('option', { value: state, text: core.LOT_STATUS_LABELS[state], selected: state === entry.state })))),
          field('Data', updated.node),
          field('Cartas', el('input', { id: `ls-${stage}-quantity`, type: 'number', min: 0, step: 1, inputmode: 'numeric', value: entry.quantity || '' })),
        ]),
      ]);
    }

    /** Abre o diálogo vazio ou com um lote para editar. */
    function open(lotId) {
      const lot = lotId ? lots().find((item) => item.id === lotId) : null;
      if (!lot && lotId) return null;
      draft.editing = lot ? lot.id : null;
      $('lotReference').value = lot ? lot.reference : '';
      $('lotDelegation').value = lot ? lot.delegation : '';
      $('lotQuantity').value = lot ? lot.quantity : '';
      boxes.start.set(lot ? lot.start : today());
      $('lotNotes').value = lot ? lot.notes || '' : '';
      // as delegações já usadas ficam na lista, para não se escreverem duas vezes
      // A delegação é escolhida no catálogo central.
      fill($('lotStages'), ...core.LOT_STAGES.map((stage, index) => stageBlock(stage, index, lot)));
      form.open(dialog, {
        title: lot ? `Lote ${lot.reference}` : 'Novo lote',
        titleId: 'lotDialogTitle',
        save: lot ? 'Guardar alterações' : 'Guardar lote',
        saveId: 'lotSave',
        focusId: 'lotReference',
      });
      return draft.editing;
    }

    /** Lê as quatro fases e devolve o lote (ou o erro do core). */
    function read() {
      const stages = {};
      for (const stage of core.LOT_STAGES) {
        stages[stage] = {
          stage,
          state: $(`ls-${stage}-state`).value,
          updated: boxes.stages[stage].value(),
          quantity: $(`ls-${stage}-quantity`).value,
          note: '',
        };
      }
      return core.makeLot({
        id: draft.editing,
        reference: $('lotReference').value,
        delegation: $('lotDelegation').value,
        quantity: $('lotQuantity').value,
        start: boxes.start.value(),
        stages,
        notes: $('lotNotes').value,
      });
    }

    const error = (message) => form.error(dialog, message);
    const close = () => { form.close(dialog); draft.editing = null; };

    /** Liga o formulário do lote e os seus botões. */
    function wire() {
      // a abertura do lote é um campo fixo do index.html: liga-se uma vez
      boxes.start = dateBox({ id: 'lotStart', label: 'Abertura do lote' });
      $('lotForm').addEventListener('submit', (event) => form.submit(event, dialog, read, submit));
      $('lotClose').addEventListener('click', close);
      $('lotCancel').addEventListener('click', close);
      $('lotDialog').addEventListener('close', () => { draft.editing = null; });
    }

    /** O id do registo/lote/material em edição (ou `null`). */
    const editing = () => draft.editing;

    return { open, close, read, error, wire, editing };
  }

  return { create };
});
