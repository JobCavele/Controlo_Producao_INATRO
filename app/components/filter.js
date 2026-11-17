/*
 * Conta Carta · filtro do período do painel
 *
 * O filtro do topo (mês, ano ou intervalo de datas). Em cada modo há **uma
 * caixa só**: o mês traz as setas ‹ › coladas e o calendário ao lado; o
 * intervalo traz o calendário em cada data. Não há lista de meses a repetir
 * o que a caixa já diz — a caixa é o controlo, o calendário é a ajuda.
 *
 * A regra dos meses que existem e das setas vive em period.js; aqui só se
 * liga essa regra ao ecrã. Cada função mexe no `filter` que recebe e devolve
 * o desenho (ou `false`, quando não aceitou o que foi escrito).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/core.js'), require('../lib/period.js'), require('../lib/dom.js'));
  else root.ContaCartaFilter = factory(root.ContaCartaCore, root.ContaCartaPeriod, root.ContaCartaDom);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, periods, dom) {
  'use strict';

  /**
   * `ui` traz o desenho (`dateText`, `monthText`, `dateBox`, `toast`);
   * `onChange` é o redesenho do painel; `today` é o dia de hoje em ISO.
   */
  function create({ ui, filter, onChange, today }) {
    const { dateText, monthText, dateBox, toast } = ui;
    const $ = dom.byId;
    // as três caixas de data do filtro, ligadas uma vez (setas e calendário)
    const boxes = {};

    /** O período que o filtro aponta, em ISO. */
    function period() {
      if (filter.mode === 'month') return core.monthRange(filter.month);
      if (filter.mode === 'year') return core.yearRange(filter.year);
      return { start: filter.start, end: filter.end };
    }

    /** «10/2026», «Ano de 2026» ou «01/09/2026 a 30/09/2026». */
    function label() {
      if (filter.mode === 'month') return core.monthLabel(filter.month);
      if (filter.mode === 'year') return `Ano de ${filter.year}`;
      return core.periodLabel(filter.start, filter.end);
    }

    /** Pinta o filtro (modo, campos e o que cada caixa mostra). */
    function render() {
      const monthMode = filter.mode === 'month';
      const yearMode = filter.mode === 'year';
      $('filterMonthField').hidden = !monthMode;
      $('filterYearField').hidden = !yearMode;
      $('filterPeriodField').hidden = monthMode || yearMode;
      // as setas vivem dentro do campo do mês (ou do ano) e só aí têm sentido
      for (const [field, unit] of [['filterMonthField', 'Mês'], ['filterYearField', 'Ano']]) {
        document.querySelectorAll(`#${field} [data-step]`).forEach((node) => {
          const text = `${unit} ${Number(node.dataset.step) < 0 ? 'anterior' : 'seguinte'}`;
          node.setAttribute('aria-label', text);
          node.title = text;
        });
      }
      document.querySelectorAll('.filter .segmented button').forEach((button) => button.classList.toggle('is-on', button.dataset.filter === filter.mode));
      boxes.month.set(filter.month);
      boxes.start.set(filter.start);
      boxes.end.set(filter.end);
      $('filterYear').value = filter.year;
    }

    /** O filtro mudou de período: acerta o início e o fim e redesenha. */
    function commit() {
      ({ start: filter.start, end: filter.end } = period());
      render();
      onChange();
    }

    /** O mês escolhido (calendário ou escrito): arruma o ano e o intervalo. */
    function setMonth(month) {
      if (!month) return false;
      filter.month = month;
      filter.year = month.slice(0, 4);
      ({ start: filter.start, end: filter.end } = core.monthRange(month));
      render();
      onChange();
      return true;
    }

    /** Uma data do intervalo: as duas andam juntas e a final nunca é antes da inicial. */
    function setRange(which, iso) {
      const next = { start: filter.start, end: filter.end, [which]: iso };
      if (!next.start || !next.end) { toast('Escreve as duas datas do intervalo em dd/mm/aaaa.'); return false; }
      if (next.end < next.start) { toast('A data final não pode ser anterior à inicial.'); return false; }
      filter.start = next.start;
      filter.end = next.end;
      filter.month = filter.start.slice(0, 7);
      render();
      onChange();
      return true;
    }

    /** Mudar de modo (Mês / Ano / Intervalo) a partir dos botões segmentados. */
    function setMode(mode) {
      filter.mode = mode;
      if (filter.mode === 'period' && !filter.start) ({ start: filter.start, end: filter.end } = core.monthRange(filter.month));
      if (filter.mode === 'year') filter.year = (filter.month || today().slice(0, 7)).slice(0, 4);
      commit();
    }

    /** O ano escrito à mão: entre 1900 e 2200, senão fica o que estava. */
    function setYear(event) {
      const year = Math.trunc(Number(event.target.value));
      if (!Number.isInteger(year) || year < 1900 || year > 2200) {
        toast('Escolhe um ano entre 1900 e 2200.');
        event.target.value = filter.year;
        return;
      }
      filter.year = String(year);
      filter.month = `${year}-01`;
      ({ start: filter.start, end: filter.end } = core.yearRange(filter.year));
      render();
      onChange();
    }

    /** As setas ‹ › correm meses ou anos, conforme o modo do painel. */
    function step(offset) {
      Object.assign(filter, periods.stepPeriod(filter, offset));
      commit();
    }

    /** Liga as caixas de data e os botões do filtro. */
    function wire() {
      boxes.month = dateBox({ id: 'filterMonth', kind: 'month', label: 'Mês', onPick: setMonth });
      boxes.start = dateBox({ id: 'filterStart', kind: 'date', label: 'Data inicial', onPick: (iso) => setRange('start', iso) });
      boxes.end = dateBox({ id: 'filterEnd', kind: 'date', label: 'Data final', onPick: (iso) => setRange('end', iso) });
      document.querySelectorAll('.filter .segmented button').forEach((node) => node.addEventListener('click', () => setMode(node.dataset.filter)));
      $('filterYear').addEventListener('change', setYear);
    }

    return { period, label, render, commit, step, setMode, setYear, wire, boxes };
  }

  return { create };
});
