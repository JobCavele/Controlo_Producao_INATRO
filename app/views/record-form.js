/*
 * Conta Carta · formulário do dia e do lote
 *
 * O diálogo que se abre em «Adicionar lote»: primeiro o dia (uma caixa de data
 * só, a de hoje), depois o lote — o lote preparado do quadro ou um novo, a
 * máquina, as cartas planeadas, as produzidas e as rejeições. Guardar deixa o
 * diálogo aberto, limpo, para o lote seguinte; o dia pode ser apontado lote a
 * lote, sem sair daqui. A validação e as contas são todas do core.
 *
 * O lote tem um lado só: com um lote preparado, a referência, a delegação e
 * as cartas vêm dele e ficam trancadas (components/lock.js). «Editar» abre-as
 * para corrigir o próprio lote — a correcção fica no lote, não só neste dia.
 * As cartas que o dia planeia também não se escrevem: são as que o lote ainda
 * tinha por fazer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/core.js'), require('../lib/dom.js'), require('../lib/delegations.js'));
  else root.ContaCartaRecordForm = factory(root.ContaCartaCore, root.ContaCartaDom, root.ContaCartaDelegations);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, dom, delegations) {
  'use strict';

  const fmt = core.format;

  /**
   * `ui` traz o desenho (el, fill, today, rateClass) e a caixa de data;
   * `form` é o componente dos diálogos; `submit(entry, date, fix)` grava o
   * lote no dia e, com `fix`, corrige o lote preparado; `day` diz qual o dia
   * à vista; `lots` são os lotes do quadro e `records` os dias já registados;
   * `lock` é a fechadura; `refusal(lote)` diz porque é que um lote não se
   * aponta nos dias ('' quando se pode).
   */
  function create({ ui, form, submit, day, lots, records, lock, refusal }) {
    const { el, fill, today, rateClass, dateBox, options } = ui;
    const $ = dom.byId;
    const dialog = { dialog: 'recordDialog', error: 'formError' };

    /** O que está a ser apontado: o dia, o lote em edição (e as notas dele, que o formulário não mostra), o dia fechado e os lotes que a lista oferece. */
    const draft = { date: today(), editing: null, notes: '', closed: false, offered: [] };
    let datePicker = null;
    // o que é do lote: trancado quando vem de um lote preparado, até se ligar «Editar»
    const identity = lock.create({ set: 'entryIdentity', toggle: 'entryEdit', wrap: 'entryEditWrap', onChange: () => note() });
    const lotById = (id) => (id && (lots() || []).find((item) => item.id === id)) || null;
    const lotByReference = (text) => {
      const typed = String(text).trim().toLowerCase();
      return (typed && (lots() || []).find((item) => item.reference.trim().toLowerCase() === typed)) || null;
    };

    /* ---------------------------------------------------- desenho --- */

    /** A delegação escolhe-se do catálogo; a de um lote antigo que lá não esteja fica na lista, para não se perder. */
    const setDelegation = (name) => options($('entryDelegation'), delegations.choices(name), name);

    /** As máquinas: duas, como no resto do sistema. */
    function machineOptions() {
      fill($('entryMachine'), ...core.MACHINES.map((name, index) => el('option', { value: String(index), text: name })));
    }

    /** O dia que a caixa da data diz, se já tiver registo. */
    const dated = () => (records() || []).find((record) => record.start === dayDate()) || null;

    /**
     * Os lotes preparados do quadro: os que ainda têm cartas por imprimir,
     * não foram apontados no dia da caixa e não registam a impressão nos
     * movimentos. `keep` é o lote que tem de lá estar: o que já está
     * escolhido, o da entrada que se corrige ou o que foi escrito pela
     * referência.
     */
    function lotOptions(keep = $('entryLot').value) {
      const used = new Set((dated()?.entries || []).map((entry) => entry.lotId).filter(Boolean));
      const open = (lots() || []).filter((lot) => lot.id === keep
        || (!used.has(lot.id) && !lot.closed && lot.stages.impressao.state !== 'feito' && !refusal(lot)));
      draft.offered = open.map((lot) => lot.id);
      fill($('entryLot'),
        el('option', { value: '', text: open.length ? 'Lote novo (escrever a referência)' : 'Sem lotes preparados por apontar' }),
        ...open.map((lot) => el('option', {
          value: lot.id,
          text: `${lot.reference} · ${lot.delegation || 'sem delegação'} · ${fmt(lot.quantity)} cartas`,
        })));
      $('entryLot').value = draft.offered.includes(keep) ? keep : '';
    }

    /** A linha por baixo dos dados do lote: de onde vêm, e o que acontece a quem os corrige. */
    function note() {
      const lot = lotById($('entryLot').value);
      $('entryLockNote').hidden = !lot;
      $('entryLockNote').classList.toggle('is-warn', identity.editing());
      $('entryLockNote').textContent = !lot ? ''
        : identity.editing() ? `Estás a corrigir o lote ${lot.reference}: o que mudares fica no lote e nos dias em que ele já foi apontado.`
          : `São os dados do lote ${lot.reference}. Para os corrigir, liga «Editar».`;
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

    /**
     * Puxa um lote do quadro: a referência, a delegação e as cartas são as
     * dele, e ficam trancadas — o lote tem um lado só.
     */
    function fromLot(lotId) {
      const lot = lotById(lotId);
      if (!lot) return;
      // um lote que a lista não oferece (já apontado neste dia, ou já impresso) entra nela para poder ficar escolhido
      if (!draft.offered.includes(lot.id)) lotOptions(lot.id);
      $('entryLot').value = lot.id;
      $('entryReference').value = lot.reference;
      setDelegation(lot.delegation || '');
      $('entryPlanned').value = lot.quantity;
      identity.guard(true);
      note();
      updateLive();
    }

    /** Deixa de haver lote preparado: os dados do lote voltam a escrever-se à mão. */
    function freeLot() {
      $('entryLot').value = '';
      $('entryReference').value = '';
      setDelegation('');
      $('entryPlanned').value = '';
      identity.guard(false);
      note();
    }

    /** Limpa o lote, deixando o dia e a data como estão. */
    function clearEntry() {
      draft.editing = null;
      draft.notes = '';
      freeLot();
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
      identity.freeze(locked);
      for (const id of ['entryLot', 'entryMachine', 'm0p', 'm0r', 'm0q', 'reasonsFilter', 'entryDone']) {
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
      draft.notes = entry.notes || '';
      draft.date = record.start;
      datePicker.set(record.start);
      lotOptions(entry.lotId);
      machineOptions();
      freeLot();
      // um lote do quadro diz ele próprio a referência, a delegação e as cartas; só o que não é do quadro vem da entrada
      if (lotById(entry.lotId)) fromLot(entry.lotId);
      else {
        $('entryReference').value = entry.reference || '';
        setDelegation(entry.delegation || '');
        $('entryPlanned').value = entry.planned;
      }
      $('entryMachine').value = String(entry.machine);
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
        focusId: $('entryLot').value ? 'm0p' : 'entryReference',
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

    /**
     * O que «Editar» mudou no lote preparado (ou `null`): a referência, a
     * delegação ou as cartas que ficaram diferentes das do lote. Quem grava
     * corrige o próprio lote, e os dias em que ele foi apontado seguem-no.
     */
    function correction() {
      const lot = lotById($('entryLot').value);
      if (!lot || !identity.editing()) return null;
      const fix = { id: lot.id, reference: $('entryReference').value.trim(), delegation: $('entryDelegation').value, quantity: Number($('entryPlanned').value) };
      return fix.reference !== lot.reference || fix.delegation !== lot.delegation || fix.quantity !== lot.quantity ? fix : null;
    }

    /** As cartas boas que o lote preparado já tinha antes desta entrada (zero sem lote preparado). */
    const madeBefore = () => ($('entryLot').value ? core.lotGoodBefore(records(), $('entryLot').value, dayDate(), draft.editing) : 0);

    /** Lê o que está no formulário e devolve a entrada (ou o erro do core). */
    function read() {
      const cards = $('entryPlanned').value;
      // com um lote do quadro, o dia planeia as cartas que o lote ainda tinha por fazer
      const total = $('entryLot').value && /^\d+$/.test(String(cards).trim()) ? Number(cards) : 0;
      return core.makeEntry({
        id: draft.editing,
        lotId: $('entryLot').value,
        reference: $('entryReference').value,
        delegation: $('entryDelegation').value,
        machine: Number($('entryMachine').value),
        planned: total ? Math.max(1, total - madeBefore()) : cards,
        produced: $('m0p').value,
        rejected: $('m0r').value,
        qualityRejected: $('m0q').value,
        reasons: core.REASONS.map((reason) => ({ code: reason.code, quantity: $(`rf-${reason.code}`)?.value || '' })),
        done: $('entryDone').checked,
        updated: dayDate(),
        notes: draft.notes,
      });
    }

    /**
     * Ao guardar: uma referência escrita à mão que é a de um lote do quadro
     * puxa esse lote e pára, para se conferir — senão nascia uma cópia do
     * lote com outra delegação ou outras cartas.
     */
    function readToSave() {
      const known = $('entryLot').value ? null : lotByReference($('entryReference').value);
      if (!known) return read();
      if (refusal(known)) throw new Error(refusal(known));
      fromLot(known.id);
      throw new Error(`${known.reference} é um lote do quadro: a delegação e as cartas passaram a ser as dele. Confere e guarda outra vez.`);
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
        const before = madeBefore();
        $('entryLive').textContent = `${fmt(entry.produced)} de ${fmt(entry.planned)} cartas${
          before ? ` por fazer (o lote já tinha ${fmt(before)} boas)` : ''}${missing ? ` · faltam ${fmt(missing)}` : ' · lote completo'}`;
        $('entryLive').classList.toggle('is-warn', missing > 0);
        syncReasons(entry, entry);
        // a data do dia manda no carimbo; avisa-se quando o dia já tem registo
        $('dayOpenHint').textContent = dated()
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
      // mudar o dia muda os lotes que ele ainda pode apontar e o que cada um já tinha feito:
      // a caixa fica logo com o dia escolhido, e o resto lê-o de lá
      datePicker = dateBox({
        id: 'recordDate', label: 'Dia',
        onPick: (picked) => { if (picked) datePicker.set(picked); lotOptions(); liveBound(); },
      });
      $('recordForm').addEventListener('input', liveBound);
      identity.wire();
      $('entryLot').addEventListener('change', () => {
        if ($('entryLot').value) fromLot($('entryLot').value);
        else { freeLot(); updateLive(); }
      });
      // a referência de um lote do quadro puxa esse lote, em vez de nascer uma cópia dele com outros dados
      $('entryReference').addEventListener('change', () => {
        const known = $('entryLot').value ? null : lotByReference($('entryReference').value);
        if (!known) return;
        if (refusal(known)) error(refusal(known)); else fromLot(known.id);
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
        form.submit(event, dialog, readToSave, (entry) => submit(entry, entry.updated, correction()));
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
