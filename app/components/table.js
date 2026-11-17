/*
 * Conta Carta · tabela dos registos do período
 *
 * A mesma tabela serve o painel (só leitura) e a vista Registos (com acções).
 * Recebe as peças de desenho de quem a usa, para não puxar pelo app inteiro.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/core.js'));
  else root.ContaCartaTable = factory(root.ContaCartaCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  const fmt = core.format;

  /**
   * A tabela do período. `ui` traz el, fmt e rateClass; `withActions` acrescenta
   * os botões de editar e eliminar; `rawTotals` troca a aprovação pelas rejeições.
   */
  function dataTable(summary, withActions, options, ui) {
    const el = ui.el;
    const percent = ui.percent || core.formatPercent;
    const rate = ui.rateClass || (() => '');
    const settings = options || {};
    if (!summary.records.length) {
      return el('div', { class: 'empty' }, [el('strong', { text: withActions ? 'Ainda sem registos' : 'Ainda sem registos neste período' })]);
    }
    const numberColumn = (label) => el('th', { class: 'is-number', text: label });
    const head = el('tr', { class: 'is-groups' }, [
      el('th', { rowspan: 2, text: 'Período' }),
      el('th', { class: 'is-group', colspan: 3, text: core.MACHINES[0] }),
      el('th', { class: 'is-group', colspan: 3, text: core.MACHINES[1] }),
      el('th', { class: 'is-group', colspan: 3, text: 'Totais do período' }),
      el('th', { rowspan: 2, text: 'Notas' }),
      withActions ? el('th', { class: 'is-actions', rowspan: 2, text: '' }) : null,
    ].filter(Boolean));
    // o painel mostra só produção e rejeições; os registos mantêm a aprovação
    const totalColumns = settings.rawTotals
      ? [numberColumn('produzidas'), numberColumn('rej. máquina'), numberColumn('rej. qualidade')]
      : [numberColumn('produzidas'), numberColumn('aprovadas'), numberColumn('aprovação')];
    const columns = el('tr', {}, [
      numberColumn('produzidas'), numberColumn('rej. máquina'), numberColumn('rej. qualidade'),
      numberColumn('produzidas'), numberColumn('rej. máquina'), numberColumn('rej. qualidade'),
      ...totalColumns,
    ]);
    const rows = summary.records.map((record) => {
      const totals = core.totals(record);
      const cells = [el('td', {}, el('button', { class: 'link', type: 'button', 'data-edit': record.id, text: core.periodLabel(record.start, record.end) }))];
      totals.machines.forEach((machine) => {
        cells.push(el('td', { class: 'is-number', text: fmt(machine.produced) }));
        cells.push(el('td', { class: `is-number${machine.rejected ? ' is-bad' : ''}`, text: fmt(machine.rejected) }));
        cells.push(el('td', { class: `is-number${machine.qualityRejected ? ' is-bad' : ''}`, text: fmt(machine.qualityRejected) }));
      });
      cells.push(el('td', { class: 'is-number is-strong', text: fmt(totals.produced) }));
      if (settings.rawTotals) {
        cells.push(el('td', { class: `is-number${totals.rejected ? ' is-bad' : ''}`, text: fmt(totals.rejected) }));
        cells.push(el('td', { class: `is-number${totals.qualityRejected ? ' is-bad' : ''}`, text: fmt(totals.qualityRejected) }));
      } else {
        cells.push(el('td', { class: 'is-number', text: fmt(totals.approved) }));
        cells.push(el('td', { class: 'is-number' }, el('span', { class: `rate ${rate(totals.approvalRate)}`, text: percent(totals.approvalRate) })));
      }
      cells.push(el('td', { class: 'is-note', text: record.notes || '—' }));
      if (withActions) {
        cells.push(el('td', { class: 'is-actions' }, [
          el('button', { class: 'row-btn', type: 'button', 'data-edit': record.id, text: 'Editar' }),
          el('button', { class: 'row-btn is-danger', type: 'button', 'data-delete': record.id, text: 'Eliminar' }),
        ]));
      }
      return el('tr', {}, cells);
    });
    const total = el('tr', { class: 'is-total' }, [
      el('td', { text: 'Total do período' }),
      ...summary.machines.flatMap((machine) => [
        el('td', { class: 'is-number', text: fmt(machine.produced) }),
        el('td', { class: `is-number${machine.rejected ? ' is-bad' : ''}`, text: fmt(machine.rejected) }),
        el('td', { class: `is-number${machine.qualityRejected ? ' is-bad' : ''}`, text: fmt(machine.qualityRejected) }),
      ]),
      ...(settings.rawTotals ? [
        el('td', { class: 'is-number', text: fmt(summary.produced) }),
        el('td', { class: `is-number${summary.rejected ? ' is-bad' : ''}`, text: fmt(summary.rejected) }),
        el('td', { class: `is-number${summary.qualityRejected ? ' is-bad' : ''}`, text: fmt(summary.qualityRejected) }),
      ] : [
        el('td', { class: 'is-number', text: fmt(summary.produced) }),
        el('td', { class: 'is-number', text: fmt(summary.approved) }),
        el('td', { class: 'is-number' }, el('span', { class: `rate ${rate(summary.approvalRate)}`, text: percent(summary.approvalRate) })),
      ]),
      el('td', { class: 'is-note', text: `${fmt(summary.records.length)} ${summary.records.length === 1 ? 'registo' : 'registos'}` }),
    ]);
    if (withActions) { total.append(el('td', {})); }
    return el('table', {}, [el('thead', {}, [head, columns]), el('tbody', {}, [...rows, total])]);
  }

  return { dataTable };
});
