/*
 * Conta Carta · ligação dos eventos
 *
 * Todo o `addEventListener` da aplicação vive aqui: o menu, o filtro, os
 * separadores, o gráfico e a lupa, os três formulários, a confirmação, o 🛈,
 * os relatórios e as cópias. O app.js só chama `wire()` no arranque.
 *
 * Cada acção passa pelo guarda do componente de retorno ao utilizador: um
 * clique que falhe avisa e fica em registo, nunca morre em silêncio.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/core.js'), require('../lib/dom.js'));
  else root.ContaCartaWiring = factory(root.ContaCartaCore, root.ContaCartaDom);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, dom) {
  'use strict';

  /**
   * Todas as peças da aplicação: `app` (estado), `feedback`, o filtro, as
   * vistas, os formulários, a lupa, os relatórios, as exportações e as
   * cópias. Liga-as ao ecrã e devolve-as todas ligadas.
   */
  function wire(deps) {
    const { app, feedback, filter, panel, stockView, lotsView, reports, zoom, recordForm, lotForm, stockForm,
      exportView, files, forms, actions, refreshOpenZoom } = deps;
    // o elemento pelo id vem da peça única do ecrã
  const $ = dom.byId;
    const { guard } = feedback;

    // menu e barra lateral
    document.querySelectorAll('.nav-item').forEach((node) => node.addEventListener('click', () => actions.showView(node.dataset.view)));
    // a barra lateral recolhe-se: na TV os registos é que interessam
    $('sideToggle').addEventListener('click', () => {
      app.sideOpen = !app.sideOpen;
      actions.applySide();
      // fica no estado: a barra mantém-se como estava na próxima abertura
      actions.persist(actions.nextState({ sideOpen: app.sideOpen }), null);
    });

    // o botão de cada vista é o único verde; o painel não cria nada
    $('dayAdd').addEventListener('click', () => actions.openForm('record', null));
    $('dayToday').addEventListener('click', () => { app.recordsYear = ''; actions.openDay(''); });
    $('recordsYear').addEventListener('change', (event) => { app.recordsYear = event.target.value; actions.render(); });
    $('lotsAdd').addEventListener('click', () => actions.openForm('lot', null));
    $('stockAdd').addEventListener('click', () => actions.openForm('stock', null));
    $('lotsStage').addEventListener('change', (event) => { app.lotsStage = event.target.value; lotsView.render(); });
    $('stockKind').addEventListener('change', (event) => { app.stockKind = event.target.value; stockView.render(); });

    // filtro do período (as peças de dentro vivem em components/filter.js)
    filter.wire();
    document.querySelectorAll('#filterMonthField [data-step], #filterYearField [data-step]')
      .forEach((node) => node.addEventListener('click', guard('correr o período', () => filter.step(Number(node.dataset.step)))));

    // separadores do detalhe: clique e teclado (setas, Home, End)
    const tabs = [...document.querySelectorAll('#panelDetail [role="tab"]')];
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', guard('mudar de separador', () => panel.selectTab(tab.dataset.tab)));
      tab.addEventListener('keydown', (event) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
          : step ? (index + step + tabs.length) % tabs.length : NaN;
        if (Number.isNaN(next)) return;
        event.preventDefault();
        panel.selectTab(tabs[next].dataset.tab);
        tabs[next].focus();
      });
    });

    // o indicador do gráfico: só o gráfico muda (nada de saltos de layout)
    document.querySelectorAll('[data-metric]').forEach((node) => node.addEventListener('click', () => {
      if (app.metric === node.dataset.metric) return;
      app.metric = node.dataset.metric;
      document.querySelectorAll('[data-metric]').forEach((other) => other.classList.toggle('is-on', other === node));
      panel.renderChart();
      refreshOpenZoom('panel');
    }));

    // a lupa do gráfico vive em components/zoom.js
    $('chartZoomOpen').addEventListener('click', guard('ampliar gráfico', () => zoom.openChartZoom('panel')));
    $('reportChartZoom').addEventListener('click', guard('ampliar gráfico', () => zoom.openChartZoom('report')));
    $('chart').addEventListener('dblclick', guard('ampliar gráfico', () => zoom.openChartZoom('panel')));
    $('zoomIn').addEventListener('click', () => zoom.zoomToCenter(1.35));
    $('zoomOut').addEventListener('click', () => zoom.zoomToCenter(1 / 1.35));
    $('zoomReset').addEventListener('click', zoom.resetZoom);
    $('zoomClose').addEventListener('click', zoom.closeChartZoom);
    document.querySelectorAll('[data-zoom-close]').forEach((node) => node.addEventListener('click', zoom.closeChartZoom));
    const zoomBody = $('chartZoomBody');
    zoomBody.addEventListener('pointerdown', zoom.zoomPointerDown);
    zoomBody.addEventListener('pointermove', zoom.zoomPointerMove);
    zoomBody.addEventListener('pointerup', zoom.zoomPointerEnd);
    zoomBody.addEventListener('pointercancel', zoom.zoomPointerEnd);
    zoomBody.addEventListener('wheel', zoom.zoomWheel, { passive: false });
    zoomBody.addEventListener('dblclick', (event) => {
      const body = zoomBody.getBoundingClientRect();
      zoom.zoomBy(zoom.zoomState.scale > 1.5 ? 1 / zoom.zoomState.scale : 2.4, event.clientX - body.left, event.clientY - body.top);
    });
    window.addEventListener('resize', () => zoom.resize());

    // os três formulários
    recordForm.wire(guard('pré-visualização', () => recordForm.updateLive()));
    lotForm.wire();
    stockForm.wire();

    // confirmação, 🛈 e filtro do ano dos registos
    $('confirmNo').addEventListener('click', feedback.confirmNo);
    $('confirmYes').addEventListener('click', feedback.confirmYes);
    document.addEventListener('click', guard('interacção', (event) => onDocumentClick(event, deps)));
    $('panelReasonsBtn').addEventListener('click', () => {
      app.reasonsOpen = !app.reasonsOpen;
      panel.renderReasons(actions.currentSummary());
    });

    // relatórios, exportações e cópias
    $('reportKind').addEventListener('change', (event) => {
      app.report.kind = event.target.value;
      actions.seedFilters();
      // os relatórios de período só precisam de datas; quem as decide é o core, aqui só se herdam do filtro
      if (app.report.kind === 'range' || reports.rejectionKind(app.report.kind)) {
        ({ start: app.report.start, end: app.report.end } = reports.reportPeriod());
      }
      reports.renderReportControls();
      reports.renderReport();
    });
    exportView.wire();
    files.wire(feedback.reportError);
    $('reloadNow').addEventListener('click', () => window.location.reload());

    // teclado e rede: o Escape fecha a lupa e a dica; os erros ficam em registo
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!zoom.chartZoomNode().hidden) { zoom.closeChartZoom(); return; }
      feedback.hideTip();
    });
    window.addEventListener('resize', () => feedback.hideTip());
    window.addEventListener('error', (event) => feedback.reportError(`janela: ${event.message}`));
    window.addEventListener('unhandledrejection', (event) => feedback.reportError(`promessa: ${event.reason && event.reason.message}`));
    return forms;
  }

  /**
   * O clique em qualquer sítio da página. Os botões das tabelas levam a
   * editar, a eliminar ou à vista que resolve o alerta; o 🛈 abre a dica.
   */
  function onDocumentClick(event, { app, feedback, actions }) {
    const target = event.target;
    if (!target || !target.closest) return;
    const jump = target.closest('[data-alert-view]');
    if (jump) {
      app.lotsStage = jump.dataset.alertStage || '';
      app.stockKind = '';
      actions.showView(jump.dataset.alertView);
      if (jump.dataset.alertKind === 'pending') {
        // a lista já vem ordenada pelo que falta chegar do contrato
        const first = core.stockOverview(app.state.stock).pending[0];
        if (first) feedback.toast(`Por entregar: ${first.name} — faltam ${core.format(first.pending)} ${first.unit}.`);
      }
      return;
    }
    // os botões do dia nascem a cada desenho: o clique é apanhado aqui, sem voltar a ligar nada
    const dayButtons = [
      ['[data-day-open]', 'dayOpen', (id) => actions.openDay(id)],
      ['[data-day-delete]', 'dayDelete', (id) => {
        const record = app.state.records.find((item) => item.id === id);
        if (record) actions.deleteRecord(record);
      }],
      ['[data-entry-done]', 'entryDone', (id) => actions.closeEntry(id)],
      ['[data-entry-reopen]', 'entryReopen', (id) => actions.reopenEntry(id)],
      ['[data-entry-edit]', 'entryEdit', (id) => actions.editEntry(id)],
      ['[data-entry-delete]', 'entryDelete', (id) => {
        const record = app.state.records.find((own) => own.entries.some((entry) => entry.id === id));
        const entry = record && record.entries.find((item) => item.id === id);
        if (entry) actions.deleteEntry(entry);
      }],
    ];
    for (const [selector, key, run] of dayButtons) {
      const node = target.closest(selector);
      if (!node) continue;
      run(node.dataset[key]);
      return;
    }
    if (target.closest('#dayFinish')) { actions.finishDay(); return; }
    if (target.closest('#dayReopen')) { actions.reopenDay(); return; }

    // cada botão de uma linha diz que objecto edita ou elimina
    const rowActions = {
      '[data-lot-edit]': ['lot', 'edit'], '[data-lot-delete]': ['lot', 'delete'],
      '[data-stock-edit]': ['stock', 'edit'], '[data-stock-delete]': ['stock', 'delete'],
    };
    for (const [selector, [kind, action]] of Object.entries(rowActions)) {
      const node = target.closest(selector);
      if (!node) continue;
      const id = Object.values(node.dataset)[0];
      const list = kind === 'record' ? app.state.records : kind === 'lot' ? app.state.lots : app.state.stock;
      const entry = list.find((item) => item.id === id);
      if (!entry) return;
      if (action === 'edit') actions.openForm(kind, kind === 'record' ? entry.period : entry.id, kind === 'record' ? entry.id : undefined);
      else if (kind === 'record') actions.deleteRecord(entry);
      else if (kind === 'lot') actions.deleteLot(entry);
      else actions.deleteStockItem(entry);
      return;
    }
    const info = target.closest('[data-info]');
    if (info) { feedback.tip(info); return; }
    feedback.hideTip();
  }

  return { wire };
});
