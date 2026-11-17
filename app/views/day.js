/*
 * Conta Carta · o dia de produção
 *
 * A vista Registos é um dia: o cabeçalho diz que dia é e quanto já saiu, a
 * tabela mostra os lotes apontados e o pé fecha o dia. Tudo o que aqui se lê
 * vem das entradas do dia; os totais são a soma delas (core.entryTotals).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/core.js'), require('../lib/dom.js'));
  else root.ContaCartaDayView = factory(root.ContaCartaCore, root.ContaCartaDom);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, dom) {
  'use strict';

  const fmt = core.format;

  /**
   * `ui` traz o desenho; `chips` a etiqueta de cada estado; `day` diz qual o
   * registo à vista (ou `null`); `records` é a lista gravada; `actions` leva
   * as acções do app (abrir o lote, concluir, reabrir, terminar o dia, ver um dia).
   */
  function create({ ui, chips, day, records, actions }) {
    const { el, fill, today } = ui;
    // o elemento pelo id vem da peça única do ecrã
    const $ = dom.byId;

    /** O dia à vista, já como o core o lê, ou um dia vazio de hoje. */
    function current() {
      const record = day();
      if (record) return record;
      const iso = today();
      return { start: iso, end: iso, period: 'day', entries: [], closed: false, notes: '', id: '' };
    }

    /** O nome do dia: «Hoje, 16/11/2026» ou só a data, quando é outro dia. */
    function dayName(record) {
      const iso = core.shortDate(record.start);
      return record.start === today() ? `Hoje, ${iso}` : iso;
    }

    /* --------------------------------------------------- cabeçalho --- */

    /** A tira do topo: que dia é, quantos lotes e o que já saiu. */
    function renderHead() {
      const record = current();
      const status = core.dayStatus(record);
      const closed = status.closed;
      const parts = [
        el('div', { class: 'day-title' }, [
          el('strong', { class: 'day-date', text: dayName(record) }),
          el('span', { class: `stage-chip is-${closed ? 'done' : status.open ? 'live' : 'todo'}`, text: closed ? 'Dia terminado' : status.open ? 'Dia a decorrer' : 'Dia por terminar' }),
        ]),
        el('div', { class: 'day-numbers' }, [
          ...[{ label: 'Lotes', value: fmt(status.lots), hint: status.open ? `${fmt(status.open)} por concluir` : 'todos concluídos' },
          { label: 'Planeadas', value: fmt(status.planned), hint: `${fmt(status.entries)} ${status.entries === 1 ? 'entrada' : 'entradas'}` },
          { label: 'Produzidas', value: fmt(status.totals.produced), hint: status.missing ? `faltam ${fmt(status.missing)}` : 'todas contadas' },
          { label: 'Aprovadas', value: fmt(status.totals.approved), hint: `taxa ${core.formatPercent(status.totals.approvalRate)}`, tone: 'is-ok' },
          { label: 'Rej. máquina', value: fmt(status.totals.rejected), hint: 'falhas da impressão', tone: status.totals.rejected ? 'is-bad' : '' },
          { label: 'Rej. qualidade', value: fmt(status.totals.qualityRejected), hint: 'chumbadas no teste', tone: status.totals.qualityRejected ? 'is-bad' : '' },
          ].map((cell) => el('div', { class: 'day-number' }, [
            el('span', { class: 'day-number-label', text: cell.label }),
            el('strong', { class: `day-number-value ${cell.tone || ''}`.trim(), text: cell.value }),
            el('span', { class: 'day-number-hint', text: cell.hint }),
          ])),
        ]),
      ];
      if (closed) {
        parts.push(el('p', { class: 'day-closed' }, [
          el('span', { text: `Dia terminado com ${fmt(status.totals.lots)} ${status.totals.lots === 1 ? 'lote' : 'lotes'} e ${fmt(status.totals.produced)} cartas produzidas.` }),
          el('button', { class: 'link-btn', type: 'button', id: 'dayReopen', text: 'Reabrir o dia' }),
        ]));
      }
      fill($('dayHead'), ...parts);
      if (closed) $('dayAdd').setAttribute('disabled', '');
      else $('dayAdd').removeAttribute('disabled');
      $('dayAdd').title = closed ? 'O dia está terminado: reabre-o para apontar mais lotes.' : '';
    }

    /* ----------------------------------------------------- tabela --- */

    /** Uma linha da tabela: o lote, a máquina, as cartas e o estado. */
    function row(record, entry, index) {
      const state = core.entryState(entry);
      const closed = record.closed === true;
      const missing = core.entryMissing(entry);
      return el('tr', { class: entry.done ? '' : 'is-open' }, [
        el('td', {}, [
          el('span', { class: 'cell-main', text: entry.reference || `Lote ${index + 1}` }),
          el('span', { class: 'cell-sub', text: entry.delegation || (entry.lotId ? 'lote do quadro' : 'sem delegação') }),
        ]),
        el('td', { text: core.MACHINES[entry.machine] }),
        el('td', { class: 'is-number', text: fmt(entry.planned) }),
        el('td', { class: 'is-number', text: fmt(entry.produced) }),
        el('td', { class: `is-number${entry.rejected ? ' is-bad' : ''}`, text: fmt(entry.rejected) }),
        el('td', { class: `is-number${entry.qualityRejected ? ' is-bad' : ''}`, text: fmt(entry.qualityRejected) }),
        el('td', { class: 'is-number is-strong', text: fmt(Math.max(0, entry.produced - entry.qualityRejected)) }),
        el('td', {}, [
          el('span', { class: `stage-chip is-${state.tone}`, text: state.label }),
          !entry.done && missing ? el('span', { class: 'cell-sub', text: `faltam ${fmt(missing)}` }) : null,
        ]),
        el('td', { class: 'is-actions' }, [
          entry.done
            ? (closed ? el('span', { class: 'cell-sub', text: 'terminado' })
              : el('button', { class: 'row-btn', type: 'button', dataset: { entryReopen: entry.id }, 'data-entry-reopen': entry.id, text: 'Reabrir' }))
            : el('button', { class: 'row-btn is-primary', type: 'button', dataset: { entryDone: entry.id }, 'data-entry-done': entry.id, text: 'Concluir' }),
          el('button', { class: 'row-btn', type: 'button', dataset: { entryEdit: entry.id }, 'data-entry-edit': entry.id, text: 'Editar' }),
          closed ? null : el('button', { class: 'row-btn is-danger', type: 'button', dataset: { entryDelete: entry.id }, 'data-entry-delete': entry.id, 'aria-label': 'Eliminar o lote', text: '×' }),
        ]),
      ]);
    }

    /** A tabela dos lotes do dia (ou o convite a apontar o primeiro). */
    function renderTable() {
      const record = current();
      if (!record.entries.length) {
        fill($('dayEntries'), el('div', { class: 'empty' }, [
          el('strong', { text: record.closed ? 'O dia está terminado, sem lotes apontados' : 'Ainda não há lotes neste dia' }),
          el('p', { class: 'cell-sub', text: record.closed ? 'Reabre o dia para acrescentar produção.' : 'Clica em «Adicionar lote» quando o primeiro lote sair da máquina.' }),
        ]));
        return;
      }
      const head = el('tr', {}, ['Lote', 'Máquina', 'Planeadas', 'Produzidas', 'Rej. máquina', 'Rej. qualidade', 'Aprovadas', 'Estado', '']
        .map((name, index) => el('th', { class: index >= 2 && index <= 6 ? 'is-number' : index === 8 ? 'is-actions' : '', text: name })));
      const totals = core.entryTotals(record);
      const foot = el('tr', { class: 'is-total' }, [
        el('td', { text: `${fmt(record.entries.length)} ${record.entries.length === 1 ? 'lote' : 'lotes'}` }),
        el('td', {}),
        el('td', { class: 'is-number', text: fmt(record.entries.reduce((total, entry) => total + entry.planned, 0)) }),
        el('td', { class: 'is-number is-strong', text: fmt(totals.produced) }),
        el('td', { class: `is-number${totals.rejected ? ' is-bad' : ''}`, text: fmt(totals.rejected) }),
        el('td', { class: `is-number${totals.qualityRejected ? ' is-bad' : ''}`, text: fmt(totals.qualityRejected) }),
        el('td', { class: 'is-number', text: fmt(totals.approved) }),
        el('td', {}),
        el('td', {}),
      ]);
      fill($('dayEntries'), el('table', {}, [
        el('thead', {}, head),
        el('tbody', {}, record.entries.map((entry, index) => row(record, entry, index))),
        el('tfoot', {}, foot),
      ]));
    }

    /* -------------------------------------------------------- pé --- */

    /** O pé: o aviso do que falta e o botão que fecha o dia. */
    function renderFoot() {
      const record = current();
      const status = core.dayStatus(record);
      const parts = [];
      if (status.closed) {
        parts.push(el('p', { class: 'day-foot-note', text: 'Cada lote está aprovado e somado ao painel. Para corrigir, reabre o dia.' }));
      } else if (status.open) {
        parts.push(el('p', { class: 'day-foot-note is-warn', text: `Há ${fmt(status.open)} ${status.open === 1 ? 'lote' : 'lotes'} por concluir. Conclui-os antes de terminar o dia — ou termina assim, e eles ficam por concluir.` }));
      } else {
        parts.push(el('p', { class: 'day-foot-note', text: status.entries ? 'Todos os lotes estão concluídos. Termina o dia para fechar a conta.' : 'Ainda não há nada para terminar.' }));
      }
      // o aviso do pé muda; o botão é o mesmo do index.html e só muda de estado
      $('dayFootNote').textContent = parts[0].textContent;
      $('dayFootNote').classList.toggle('is-warn', Boolean(status.open) && !status.closed);
      $('dayFinish').textContent = status.closed ? 'Dia terminado' : 'Terminar dia';
      if (status.closed || !status.entries) $('dayFinish').setAttribute('disabled', '');
      else $('dayFinish').removeAttribute('disabled');
    }

    /* -------------------------------------------- dias registados --- */

    /** Os anos que têm registos, do mais recente para o mais antigo. */
    const years = () => [...new Set(records().map((record) => record.start.slice(0, 4)))].sort().reverse();

    /** O filtro do ano: todos ou um dos que têm registos. Devolve o ano em vigor. */
    function renderYearPicker(filter) {
      const list = years();
      // sem escolha, abre no ano mais recente com dias (a lista não fica vazia à toa)
      if (!filter.recordsYear && !years().includes(filter.recordsYear)) filter.recordsYear = list[0] || '';
      if (filter.recordsYear !== '' && !list.includes(filter.recordsYear)) filter.recordsYear = '';
      const chosen = filter.recordsYear;
      fill($('recordsYear'), ...[
        el('option', { value: '', text: 'Todos os anos', selected: chosen === '' }),
        ...list.map((year) => el('option', { value: year, text: year, selected: year === chosen })),
      ]);
      return chosen;
    }

    /** A lista dos dias, do mais recente para o mais antigo, com o que cada um tem. */
    function renderDays(year) {
      const shown = records()
        .filter((record) => !year || record.start.slice(0, 4) === year)
        .slice()
        .sort((a, b) => (a.start > b.start ? -1 : a.start < b.start ? 1 : 0));
      if (!shown.length) {
        fill($('recordsTable'), el('div', { class: 'empty' }, [el('strong', { text: 'Ainda sem dias registados estes anos' })]));
        return;
      }
      const head = el('tr', {}, ['Dia', 'Lotes', 'Produzidas', 'Aprovadas', 'Rej. máquina', 'Rej. qualidade', 'Estado', '']
        .map((name, index) => el('th', { class: index >= 1 && index <= 5 ? 'is-number' : index === 7 ? 'is-actions' : '', text: name })));
      const rows = shown.map((record) => {
        const status = core.dayStatus(record);
        const totals = status.totals;
        return el('tr', { class: record.id === (day() || {}).id ? 'is-current' : '' }, [
          el('td', {}, el('button', { class: 'link', type: 'button', dataset: { dayOpen: record.id }, 'data-day-open': record.id, text: core.periodLabel(record.start, record.end) })),
          el('td', { class: 'is-number', text: fmt(status.lots) }),
          el('td', { class: 'is-number is-strong', text: fmt(totals.produced) }),
          el('td', { class: 'is-number', text: fmt(totals.approved) }),
          el('td', { class: `is-number${totals.rejected ? ' is-bad' : ''}`, text: fmt(totals.rejected) }),
          el('td', { class: `is-number${totals.qualityRejected ? ' is-bad' : ''}`, text: fmt(totals.qualityRejected) }),
          el('td', {}, el('span', { class: `stage-chip is-${status.closed ? 'done' : status.open ? 'live' : 'todo'}`, text: status.closed ? 'terminado' : status.open ? 'a decorrer' : 'por terminar' })),
          el('td', { class: 'is-actions' }, [
            el('button', { class: 'row-btn', type: 'button', dataset: { dayOpen: record.id }, 'data-day-open': record.id, text: 'Ver' }),
            el('button', { class: 'row-btn is-danger', type: 'button', dataset: { dayDelete: record.id }, 'data-day-delete': record.id, text: 'Eliminar' }),
          ]),
        ]);
      });
      fill($('recordsTable'), el('table', {}, [el('thead', {}, head), el('tbody', {}, rows)]));
    }

    /** Desenha a vista inteira: o dia à frente e, por baixo, os dias registados. */
    function render(filter) {
      renderHead();
      renderTable();
      renderFoot();
      renderDays(renderYearPicker(filter));
    }

    return { render, dayName, current, years };
  }

  return { create };
});
