/*
 * Conta Carta · formulário do dia e do lote
 *
 * O diálogo que se abre em «Adicionar lote»: primeiro o dia (uma caixa de data
 * só, a de hoje), depois o lote — o lote preparado do quadro ou um novo, a
 * máquina, as cartas planeadas, as produzidas e as rejeições. Guardar deixa o
 * diálogo aberto, limpo, para o lote seguinte; o dia pode ser apontado lote a
 * lote, sem sair daqui. A validação e as contas são todas do core.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/core.js'), require('../lib/dom.js'));
  else root.ContaCartaRecordForm = factory(root.ContaCartaCore, root.ContaCartaDom);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, dom) {
  'use strict';

  const fmt = core.format;

  /**
   * `ui` traz o desenho (el, fill, today, rateClass) e a caixa de data;
   * `form` é o componente dos diálogos; `submit` grava o lote no dia;
   * `day` diz qual o dia à vista; `lots` são os lotes preparados do quadro.
   */
  function create({ ui, form, submit, day, lots }) {
    const { el, fill, today, rateClass, dateBox } = ui;
    const $ = dom.byId;
    const dialog = { dialog: 'recordDialog', error: 'formError' };

    /** O que está a ser apontado: o dia, o lote em edição e o dia fechado. */
    const draft = { date: today(), editing: null, closed: false };
    let datePicker = null;

    /* ---------------------------------------------------- desenho --- */

    /** As máquinas: duas, como no resto do sistema. */
    function machineOptions() {
      fill($('entryMachine'), ...core.MACHINES.map((name, index) => el('option', { value: String(index), text: name })));
    }

    /** Os lotes preparados do quadro: os que ainda não foram apontados no dia. */
    function lotOptions() {
      const used = new Set((day()?.entries || []).map((entry) => entry.lotId).filter(Boolean));
      const open = (lots() || []).filter((lot) => !used.has(lot.id));
      fill($('entryLot'),
        el('option', { value: '', text: open.length ? 'Lote novo (escrever a referência)' : 'Sem lotes preparados por apontar' }),
        ...open.map((lot) => el('option', {
          value: lot.id,
          text: `${lot.reference} · ${lot.delegation || 'sem delegação'} · ${fmt(lot.quantity)} cartas`,
        })));
      fill($('lotDelegations'), ...[...new Set((lots() || []).map((lot) => lot.delegation).filter(Boolean))]
        .map((name) => el('option', { value: name })));
    }

    /** Os motivos do INCAPE: uma linha por motivo, com a quantidade do lote. */
    function reasonFields(entry) {
      const valueOf = (code) => (entry?.reasons || []).find((reason) => reason.code === code)?.quantity || '';
      return core.REASONS.map((reason) => el('label', { class: 'reason-row', 'data-reason': reason.code }, [
        el('span', { class: 'reason-name' }, [el('span', { class: 'reason-group', text: reason.group }), el('span', { class: 'cell-sub', text: reason.label })]),
        el('span', { class: 'reason-field' }, [
          'Cartas',
          el('input', {
            id: `rf-${reason.code}`, type: 'number', min: 0, max: core.MAX_QUANTITY, step: 1, inputmode: 'numeric',
            value: valueOf(reason.code), placeholder: '0', 'aria-label': reason.label,
            'data-reason-input': reason.code,
          }),
        ]),
        el('strong', { class: 'reason-total', id: `rt-${reason.code}`, text: valueOf(reason.code) || '—' }),
      ]));
    }

    /** Preenche o lote a partir de um lote do quadro (referência, delegação, cartas). */
    function fromLot(lotId) {
      const lot = (lots() || []).find((item) => item.id === lotId);
      if (!lot) return;
      $('entryReference').value = lot.reference;
      $('entryDelegation').value = lot.delegation || '';
      $('entryPlanned').value = lot.quantity;
      // cartas já produzidas no dia para este lote, se houver um lote em curso
      $('m0p').value = '';
      $('m0r').value = '';
      $('m0q').value = '';
      updateLive();
    }

    /** Limpa o lote, deixando o dia e a data como estão. */
    function clearEntry() {
      draft.editing = null;
      $('entryLot').value = '';
      $('entryReference').value = '';
      $('entryDelegation').value = '';
      $('entryPlanned').value = '';
      $('m0p').value = '';
      $('m0r').value = '';
      $('m0q').value = '';
      fill($('reasonInputs'), ...reasonFields(null));
      $('reasonsFilter').value = '';
      $('entryDone').checked = true;
      updateLive();
    }

    /** Os campos ficam em leitura quando o dia está terminado. */
    function lockFields(locked) {
      draft.closed = locked;
      for (const id of ['entryLot', 'entryReference', 'entryDelegation', 'entryMachine', 'entryPlanned', 'm0p', 'm0r', 'm0q', 'reasonsFilter', 'entryDone']) {
        const node = $(id);
        if (!node) continue;
        if (locked) node.setAttribute('disabled', ''); else node.removeAttribute('disabled');
      }
      $('reasonInputs').querySelectorAll('input').forEach((input) => {
        if (locked) input.setAttribute('disabled', ''); else input.removeAttribute('disabled');
      });
      if (locked) $('dialogSave').setAttribute('disabled', ''); else $('dialogSave').removeAttribute('disabled');
      $('entryHint').textContent = locked
        ? 'O dia está terminado: reabre-o na vista Registos para apontar mais lotes.'
        : 'Escolhe um lote preparado ou escreve um novo.';
    }

    /** Abre o diálogo: num dia já registado (o à vista) ou num dia novo. */
    function open(date) {
      const record = day();
      // o dia que se abre é o que se pediu, ou o que está à vista, ou hoje
      draft.date = date || (record ? record.start : today());
      const editingDay = record && record.start === draft.date ? record : null;
      clearEntry();
      datePicker.set(draft.date);
      lockFields(Boolean(editingDay && editingDay.closed));
      lotOptions();
      machineOptions();
      form.open(dialog, {
        title: `Lote de ${core.shortDate(draft.date)}`,
        titleId: 'dialogTitle',
        save: 'Adicionar lote',
        saveId: 'dialogSave',
        focusId: 'entryReference',
      });
    }

    /** Abre o diálogo num lote que já está no dia, para corrigir. */
    function edit(entryId) {
      const record = day();
      const entry = ((record && record.entries) || []).find((item) => item.id === entryId);
      if (!entry) return null;
      draft.editing = entry.id;
      draft.date = record.start;
      datePicker.set(record.start);
      lotOptions();
      machineOptions();
      $('entryLot').value = entry.lotId || '';
      $('entryReference').value = entry.reference || '';
      $('entryDelegation').value = entry.delegation || '';
      $('entryMachine').value = String(entry.machine);
      $('entryPlanned').value = entry.planned;
      $('m0p').value = entry.produced;
      $('m0r').value = entry.rejected;
      $('m0q').value = entry.qualityRejected;
      $('entryDone').checked = entry.done !== false;
      fill($('reasonInputs'), ...reasonFields(entry));
      $('reasonsFilter').value = '';
      lockFields(Boolean(record.closed));
      updateLive();
      form.open(dialog, {
        title: `Lote ${entry.reference || ''} de ${core.shortDate(record.start)}`.replace('Lote  de', 'Lote de'),
        titleId: 'dialogTitle',
        save: 'Guardar lote',
        saveId: 'dialogSave',
        focusId: 'entryReference',
      });
      return draft.editing;
    }

    /**
     * A data do dia: a que está na caixa (escrita ou escolhida no calendário).
     * Não se guarda à parte — a caixa é a única dona da data, como no resto.
     */
    function dayDate() {
      const written = datePicker ? datePicker.value() : '';
      return written || draft.date;
    }

    /** Lê o que está no formulário e devolve a entrada (ou o erro do core). */
    function read() {
      return core.makeEntry({
        id: draft.editing,
        lotId: $('entryLot').value,
        reference: $('entryReference').value,
        delegation: $('entryDelegation').value,
        machine: Number($('entryMachine').value),
        planned: $('entryPlanned').value,
        produced: $('m0p').value,
        rejected: $('m0r').value,
        qualityRejected: $('m0q').value,
        reasons: core.REASONS.map((reason) => ({ code: reason.code, quantity: $(`rf-${reason.code}`)?.value || '' })),
        done: $('entryDone').checked,
        updated: dayDate(),
      });
    }

    /** Motivos: o total de cada um e quantas chumbadas ainda não têm motivo. */
    function syncReasons(entry, totals) {
      let justified = 0;
      for (const reason of core.REASONS) {
        const total = (entry.reasons || []).find((item) => item.code === reason.code)?.quantity || 0;
        justified += total;
        $(`rt-${reason.code}`).textContent = total ? fmt(total) : '—';
        $(`rt-${reason.code}`).classList.toggle('is-zero', !total);
      }
      const missing = Math.max(0, totals.qualityRejected - justified);
      const extra = Math.max(0, justified - totals.qualityRejected);
      $('reasonsSum').textContent = missing
        ? `${fmt(missing)} por justificar`
        : extra ? `${fmt(extra)} a mais do que as chumbadas` : justified ? 'todas justificadas' : '';
      $('reasonsSum').classList.toggle('is-bad', Boolean(missing || extra));
    }

    /** O cálculo em direto do lote: aprovadas, rejeições e taxa, enquanto se escreve. */
    function updateLive() {
      try {
        const entry = read();
        const approved = Math.max(0, entry.produced - entry.qualityRejected);
        const rate = core.percent(approved, entry.produced);
        form.clearError(dialog);
        fill($('liveResult'), ...[
          { label: 'Aprovadas', value: fmt(approved), tone: 'is-ok' },
          { label: 'Rej. máquina', value: fmt(entry.rejected), tone: entry.rejected ? 'is-bad' : '' },
          { label: 'Chumbadas no teste', value: fmt(entry.qualityRejected), tone: entry.qualityRejected ? 'is-bad' : '' },
          { label: 'Aprovação', value: core.formatPercent(rate), tone: rateClass(rate) },
        ].map((cell) => el('div', {}, [el('span', { text: cell.label }), el('strong', { class: cell.tone, text: cell.value })])));
        const missing = core.entryMissing(entry);
        $('entryLive').textContent = `${fmt(entry.produced)} de ${fmt(entry.planned)} cartas${missing ? ` · faltam ${fmt(missing)}` : ' · lote completo'}`;
        $('entryLive').classList.toggle('is-warn', missing > 0);
        syncReasons(entry, entry);
        // a data do dia manda no carimbo; avisa-se quando o dia já tem registo
        const record = day();
        $('dayOpenHint').textContent = record && record.start === dayDate()
          ? 'Este dia já está aberto: cada lote que guardares soma-se ao que lá está.'
          : 'O dia abre-se na data de hoje; muda-a se estiveres a fechar um dia anterior.';
      } catch (error) {
        fill($('liveResult'), el('p', { class: 'live-empty', text: error.message }));
        $('entryLive').textContent = '';
        form.error(dialog, error.message);
      }
    }

    const error = (message) => form.error(dialog, message);

    /** Fecha o diálogo e esquece o lote em edição. */
    function close() {
      form.close(dialog);
      draft.editing = null;
    }

    /** Depois de guardar: limpa o lote e mantém o diálogo para o próximo. */
    function again() {
      clearEntry();
      lotOptions();
      form.clearError(dialog);
    }

    /** Liga a caixa da data, o lote preparado, os botões e a pré-visualização. */
    function wire(liveBound) {
      machineOptions();
      datePicker = dateBox({ id: 'recordDate', label: 'Dia', onPick: liveBound });
      $('recordForm').addEventListener('input', liveBound);
      $('entryLot').addEventListener('change', () => {
        if ($('entryLot').value) fromLot($('entryLot').value);
        else updateLive();
      });
      $('reasonsFilter').addEventListener('input', () => {
        const term = $('reasonsFilter').value.trim().toLowerCase();
        $('reasonInputs').querySelectorAll('[data-reason]').forEach((row) => {
          row.hidden = Boolean(term) && !row.textContent.toLowerCase().includes(term);
        });
      });
      $('dialogClose').addEventListener('click', close);
      $('dialogCancel').addEventListener('click', close);
      $('recordDialog').addEventListener('close', () => { draft.editing = null; form.clearError(dialog); });
      $('recordForm').addEventListener('submit', (event) => {
        form.submit(event, dialog, read, (entry) => submit(entry, entry.updated));
      });
    }

    /** O identificador do lote em edição (ou `null`). */
    const editing = () => draft.editing;
    /** A data do dia que o diálogo está a apontar (a da caixa). */
    const date = () => dayDate();

    return { open, edit, close, read, error, updateLive, wire, editing, date, again, clearEntry };
  }

  return { create };
});
