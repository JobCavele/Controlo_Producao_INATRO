/*
 * Conta Carta · vista Painel
 *
 * O ecrã que está na TV: o âmbito do período, os quatro indicadores, a barra
 * de alertas, os cartões por máquina, os motivos por carta, o gráfico e a
 * tabela. Só lê o estado que recebe; quem manda nos dados é o app.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/core.js'), require('../lib/dom.js'));
  else root.ContaCartaPanelView = factory(root.ContaCartaCore, root.ContaCartaDom);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, dom) {
  'use strict';

  const fmt = core.format;

  /**
   * `ui` traz o desenho (el, fill, infoButton, buildTable); `chartBars`
   * desenha o gráfico; `scope` diz o período e o resumo à vista; `board` e
   * `overview` lêem lotes e armazém para a barra de alertas.
   */
  function create({ ui, chartBars, scope, overview, board, app }) {
    const { el, fill, infoButton, buildTable, today } = ui;
    // o elemento pelo id vem da peça única do ecrã
  const $ = dom.byId;

    /* ------------------------------------------------------ âmbito --- */

    /** O âmbito do período: rótulo e quantos registos entraram. */
    function renderScope(summary) {
      const parts = [el('strong', { text: summary.label }), el('span', { text: `${fmt(summary.records.length)} ${summary.records.length === 1 ? 'registo' : 'registos'}` })];
      if (summary.outside.length) {
        parts.push(el('span', { class: 'warn' }, [el('span', { text: `${fmt(summary.outside.length)} fora do período` }), infoButton('outside')]));
      }
      fill($('filterScope'), ...parts);
    }

    /* ------------------------------------------- variação e cartões --- */

    /** Data de hoje no fuso deste computador, em «AAAA-MM-DD». */
    const todayLocal = () => today();

    /**
     * Variação face ao período anterior do mesmo tamanho. Quando o mês (ou o
     * ano) ainda está a decorrer, compara o mesmo arco: até hoje contra os
     * mesmos dias do período anterior.
     */
    function previousDelta(summary) {
      if (app.filter.mode !== 'month' && app.filter.mode !== 'year') return null;
      const period = scope.period();
      const today = todayLocal();
      let delta;
      if (period.end > today) {
        if (app.filter.mode === 'month') {
          const previous = core.shiftMonth(period.start.slice(0, 7), -1);
          if (previous.slice(0, 4) < '1900') return null;
          const elapsed = Number(today.slice(8, 10)) - Number(period.start.slice(8, 10)) + 1;
          const cap = Number(core.monthRange(previous).end.slice(8, 10));
          const length = Math.min(elapsed, cap);
            delta = core.compareWindows(app.state, { start: period.start, end: today },
            { start: `${previous}-01`, end: `${previous}-${String(length).padStart(2, '0')}` });
        } else {
          const previous = String(Number(period.start.slice(0, 4)) - 1);
          if (Number(previous) < 1900) return null;
          const sameDay = `${previous}-${today.slice(5)}`;
          // 29/02 não existe em todos os anos: nesse caso, o 28
          const monthDay = core.monthRange(sameDay.slice(0, 7));
          const previousEnd = sameDay <= monthDay.end ? sameDay : monthDay.end;
          delta = core.compareWindows(app.state, { start: period.start, end: today }, { start: `${previous}-01-01`, end: previousEnd });
        }
        delta.unit = app.filter.mode === 'month' ? 'mês anterior' : 'ano anterior';
        delta.qualifier = app.filter.mode === 'month' ? 'no mesmo arco' : 'à mesma data';
      } else {
        delta = core.compareWithPrevious(app.state, period.start, period.end);
        if (!delta) return null;
        delta.unit = app.filter.mode === 'month' ? 'mês anterior' : 'ano anterior';
        delta.qualifier = '';
      }
      delta.shown = !delta.empty && (summary.produced > 0 || delta.produced !== 0);
      return delta;
    }

    /** A linha de variação debaixo do primeiro indicador. */
    function deltaLine(delta) {
      const ready = !!(delta && delta.shown);
      return el('div', {
        class: `kpi-delta${ready ? ` ${delta.produced > 0 ? 'is-up' : delta.produced < 0 ? 'is-down' : ''}` : ' is-empty'}`.trim(),
        'aria-hidden': ready ? 'false' : 'true',
      }, ready ? [
        el('span', { class: 'kpi-delta-line', text: `${core.signed(delta.produced)} face ao ${delta.unit}` }),
        el('span', { class: 'kpi-delta-sub' }, [
          delta.qualifier ? el('span', { class: 'kpi-delta-qualifier', text: delta.qualifier }) : '',
          delta.rate !== null ? el('span', { class: 'kpi-delta-rate', text: `${core.signed(delta.rate, ' p.')} na taxa` }) : '',
          infoButton('delta'),
        ]),
      ] : [
        el('span', { class: 'kpi-delta-line', text: '\u00a0' }),
        el('span', { class: 'kpi-delta-line', text: '\u00a0' }),
      ]);
    }

    /** Os quatro números grandes: produzidas, aprovadas e as duas rejeições. */
    function renderKpis(summary) {
      const versus = deltaLine(previousDelta(summary));
      const cards = [
        { label: 'Produzidas', value: fmt(summary.produced), hint: 'cartas no período', help: 'machines' },
        { label: 'Aprovadas', value: fmt(summary.approved), hint: `taxa ${core.formatPercent(summary.approvalRate)}`, help: 'approval', tone: summary.produced ? 'is-ok' : '' },
        { label: 'Rej. máquina', value: fmt(summary.rejected), hint: `taxa ${core.formatPercent(summary.rejectionRate)}`, help: 'rejection', tone: summary.rejected ? 'is-bad' : '' },
        { label: 'Rej. qualidade', value: fmt(summary.qualityRejected), hint: `taxa ${core.formatPercent(summary.qualityRejectionRate)}`, help: 'qualityRejection', tone: summary.qualityRejected ? 'is-bad' : '' },
      ];
      // em modo ano, o número de «cartas produzidas» é mais útil como média mensal
      if (app.filter.mode === 'year' && summary.days >= 360) {
        cards[0] = { label: 'Produzidas no ano', value: fmt(summary.produced), hint: `média ${fmt(Math.round(summary.produced / 12))} por mês`, help: 'year' };
      }
      fill($('kpis'), ...cards.map((card, index) => el('article', { class: 'kpi' }, [
        el('div', { class: 'kpi-top' }, [el('span', { text: card.label }), infoButton(card.help)]),
        el('div', { class: `kpi-value ${card.tone || ''}`.trim(), text: card.value }),
        el('div', { class: 'kpi-hint', text: card.hint }),
        index === 0 ? versus : '',
      ])));
    }

    /* ------------------------------------------------- alertas --- */

    /** Uma etiqueta da barra de alertas: número grande e o que ele conta. */
    function alertChip(count, phrase, tone, dataset) {
      return el('button', { class: `alert-chip is-${tone}`, type: 'button', ...dataset }, [
        el('strong', { text: fmt(count) }),
        ` ${count === 1 ? phrase[0] : phrase[1]}`,
      ]);
    }

    /**
     * A barra de alertas: só aparece quando há alguma coisa concreta a
     * tratar — material no mínimo, por entregar ou sem stock, e lotes por
     * despachar. Cada etiqueta leva à vista que resolve o assunto.
     */
    function renderAlerts() {
      const stock = overview();
      const lots = board();
      const chips = [];
      if (stock.low.length) chips.push(alertChip(stock.low.length, ['material no mínimo', 'materiais no mínimo'], 'bad', { 'data-alert-view': 'stock', 'data-alert-kind': 'low' }));
      if (stock.pending.length) chips.push(alertChip(stock.pending.length, ['material por entregar', 'materiais por entregar'], 'warn', { 'data-alert-view': 'stock', 'data-alert-kind': 'pending' }));
      if (lots.toDispatch) chips.push(alertChip(lots.toDispatch, ['lote por despachar', 'lotes por despachar'], 'warn', { 'data-alert-view': 'lots', 'data-alert-stage': 'despacho' }));
      if (stock.empty.length) chips.push(alertChip(stock.empty.length, ['material sem stock', 'materiais sem stock'], 'bad', { 'data-alert-view': 'stock', 'data-alert-kind': 'empty' }));
      $('panelAlerts').hidden = !chips.length;
      if (chips.length) fill($('panelAlerts'), el('span', { class: 'alert-label', text: 'A tratar:' }), ...chips);
    }

    /* --------------------------------------- motivos e máquinas --- */

    /**
     * Motivos por carta debaixo das chumbadas: quanto do total vem de cada
     * motivo do INCAPE, com barra, para se ver de relance qual pesa mais.
     */
    function renderReasons(summary) {
      const wrap = $('panelReasons');
      wrap.hidden = !app.reasonsOpen;
      $('panelReasonsBtn').setAttribute('aria-expanded', String(app.reasonsOpen));
      $('panelReasonsBtn').textContent = app.reasonsOpen ? 'Ocultar motivos' : 'Ver motivos por carta';
      if (!app.reasonsOpen) return;
      const totals = core.reasonTotals(summary.records);
      const missing = Math.max(0, summary.qualityRejected - totals.reduce((sum, reason) => sum + reason.total, 0));
      if (!totals.some((reason) => reason.total)) {
        fill(wrap, el('p', { class: 'empty-line', text: 'Ainda sem motivos apontados neste período.' }));
        return;
      }
      const peak = Math.max(1, ...totals.map((reason) => reason.total));
      fill(wrap, ...totals.map((reason) => el('div', { class: `reason-line${reason.total ? '' : ' is-zero'}` }, [
        el('span', { class: 'reason-label' }, [el('span', { class: 'reason-group', text: reason.group }), el('span', { class: 'cell-sub', text: reason.label })]),
        el('span', { class: 'reason-bar' }, el('span', { style: `width:${Math.round((reason.total / peak) * 100)}%` })),
        el('strong', { text: fmt(reason.total) }),
      ])));
      if (missing) wrap.append(el('p', { class: 'empty-line is-warn', text: `${fmt(missing)} chumbadas sem motivo indicado.` }));
    }

    /** Os cartões por máquina: produzidas e as duas rejeições, lado a lado. */
    function renderMachines(summary) {
      const cards = summary.machines.map((machine, index) => el('div', { class: 'machine' }, [
        el('h3', { text: core.MACHINES[index] }),
        el('div', { class: 'machine-grid' }, [
          { label: 'Produzidas', value: machine.produced, tone: '' },
          { label: 'Rej. máquina', value: machine.rejected, tone: machine.rejected ? 'is-bad' : '' },
          { label: 'Rej. qualidade', value: machine.qualityRejected, tone: machine.qualityRejected ? 'is-bad' : '' },
        ].map((cell) => el('div', {}, [el('span', { text: cell.label }), el('strong', { class: cell.tone, text: fmt(cell.value) })]))),
      ]));
      fill($('machineCards'), ...cards);
    }

    /* ------------------------------------------------- gráfico --- */

    /** Pontos, título e unidade do gráfico conforme o modo do painel. */
    function dashboardChart() {
      if (app.filter.mode === 'year' || app.filter.mode === 'month') {
        const year = app.filter.mode === 'year' ? String(app.filter.year || new Date().getFullYear()) : app.filter.month.slice(0, 4);
        // «09/26» cabe sob a barra numa série de doze meses
        const points = core.series(app.state, `${year}-01-01`, `${year}-12-31`, 'month');
        return { title: `Evolução em ${year}`, points, unit: 'mês' };
      }
      const period = scope.period();
      return { title: 'Evolução do período', points: core.series(app.state, period.start, period.end, 'record'), unit: 'registo' };
    }

    function renderChart() {
      const { title, points, unit } = dashboardChart();
      $('chartTitle').textContent = title;
      fill($('chart'), chartBars(points, app.metric, { unit }));
    }

    /* --------------------------------------------- separadores --- */

    /**
     * Separadores do detalhe: o filtro e os indicadores ficam sempre à vista
     * e só o bloco de baixo troca, para o painel caber num ecrã sem scroll.
     */
    function selectTab(name) {
      const current = core.PANEL_TABS.includes(name) ? name : core.PANEL_TABS[0];
      if (app.panelTab === current) return;
      app.panelTab = current;
      document.querySelectorAll('#panelDetail [role="tab"]').forEach((tab) => {
        const active = tab.dataset.tab === current;
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        tab.tabIndex = active ? 0 : -1;
        $(tab.getAttribute('aria-controls')).hidden = !active;
      });
    }

    /** Desenha o painel inteiro para o período à vista. */
    function render(summary) {
      renderKpis(summary);
      // cada separador diz o que lá está antes de abrir
      $('tabMachinesHint').textContent = `${fmt(summary.produced)} cartas`;
      $('tabChartHint').textContent = dashboardChart().title.replace(/^Evolução( em)?\s*/, '');
      $('tabTableHint').textContent = `${fmt(summary.records.length)} ${summary.records.length === 1 ? 'registo' : 'registos'}`;
      renderAlerts();
      renderMachines(summary);
      renderReasons(summary);
      renderChart();
      fill($('panelTable'), buildTable(summary, false, { rawTotals: true }));
    }

    return { render, renderScope, dashboardChart, renderChart, renderAlerts, renderReasons, selectTab };
  }

  return { create };
});
