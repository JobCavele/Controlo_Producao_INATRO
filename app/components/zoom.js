/*
 * Conta Carta · lupa do gráfico
 *
 * A folha cheia com o gráfico ampliado: abrir e fechar, arrastar, roda do
 * rato e pinça. Só desenho e gestos: os pontos vêm do painel ou do relatório.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/core.js'), require('../lib/dom.js'));
  else root.ContaCartaZoom = factory(root.ContaCartaCore, root.ContaCartaDom);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, dom) {
  'use strict';

  // o elemento pelo id vem da peça única do ecrã
  const $ = dom.byId;
  let app = null;
  let reports = null;
  let chartBars = null;
  let dashboardChart = () => ({ title: '', points: [], metric: 'produced', unit: 'registo' });
  let deps = {};

  /** O que a lupa precisa de fora: o estado, a série do painel e a do relatório. */
  function attach(incoming) {
    deps = incoming;
    ({ app, reports, chartBars, dashboardChart } = deps);
  }


  const ZOOM_MIN = 1, ZOOM_MAX = 6, ZOOM_NATURAL_W = 1160, ZOOM_NATURAL_H = 576;
  const zoomState = { scale: 1, x: 0, y: 0, pointers: new Map(), lastDistance: 0, lastMiddle: null };
  let zoomSource = 'panel';          // 'panel' — painel; 'report' — pré-visualização do relatório
  let zoomLastTrigger = null;

  const chartZoomNode = () => $('chartZoom');

  /** O que a lupa mostra, conforme o botão que a abriu. */
  function currentZoomChart() {
    if (zoomSource === 'report' && app.generated) {
      const { comparison, rejection } = app.generated;
      const title = comparison ? reports.comparisonTitle() : core.seriesFor(rejection).title;
      return { title, points: deps.reportChartPoints(), metric: deps.paperChartMetric(),
        unit: comparison ? 'período' : 'registo' };
    }
    const { title, points, unit } = dashboardChart();
    return { title, points, metric: app.metric, unit };
  }

  /** Recria o gráfico em tamanho grande dentro do palco da lupa. */
  function renderZoomedChart() {
    const { points, metric, unit } = currentZoomChart();
    const stage = $('chartZoomStage');
    stage.replaceChildren(chartBars(points, metric, {
      width: ZOOM_NATURAL_W - 36, height: ZOOM_NATURAL_H - 36, fontScale: 1.5, unit, radius: 4,
    }));
  }

  /** Mantém o palco dentro dos limites: sem o gráfico fugir nem murchar. */
  function clampZoom() {
    const body = $('chartZoomBody');
    const scaledW = ZOOM_NATURAL_W * zoomState.scale, scaledH = ZOOM_NATURAL_H * zoomState.scale;
    const slack = 48;
    zoomState.x = scaledW + slack * 2 >= body.clientWidth
      ? Math.min(slack, Math.max(body.clientWidth - scaledW - slack, zoomState.x))
      : (body.clientWidth - scaledW) / 2;
    zoomState.y = scaledH + slack * 2 >= body.clientHeight
      ? Math.min(slack, Math.max(body.clientHeight - scaledH - slack, zoomState.y))
      : (body.clientHeight - scaledH) / 2;
  }

  /** Aplica as coordenadas de translação e a escala ao palco da lupa. */
  function applyZoom() {
    $('chartZoomStage').style.transform = `translate(${zoomState.x}px, ${zoomState.y}px) scale(${zoomState.scale})`;
    $('zoomLevel').textContent = `${Math.round(zoomState.scale * 100)}%`;
  }

  /** Amplia/reduz mantendo o ponto (px, py) do rato parado no ecrã. */
  function zoomBy(factor, px, py) {
    const before = zoomState.scale;
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, before * factor));
    if (next === before) return;
    zoomState.x = px - ((px - zoomState.x) * next) / before;
    zoomState.y = py - ((py - zoomState.y) * next) / before;
    zoomState.scale = next;
    clampZoom();
    applyZoom();
  }

  const zoomToCenter = (factor) => {
    const body = $('chartZoomBody');
    zoomBy(factor, body.clientWidth / 2, body.clientHeight / 2);
  };

  /** Repõe a escala em 100% (1:1) e centraliza o gráfico no palco. */
  function resetZoom() {
    zoomState.scale = 1;
    zoomState.x = 0;
    zoomState.y = 0;
    clampZoom();
    applyZoom();
  }

  /** Abre a lupa com o gráfico actual do painel ou do relatório. */
  function openChartZoom(source) {
    zoomSource = source === 'report' ? 'report' : 'panel';
    zoomLastTrigger = $(zoomSource === 'report' ? 'reportChartZoom' : 'chartZoomOpen');
    $('chartZoomTitle').textContent = currentZoomChart().title;
    renderZoomedChart();
    resetZoom();
    chartZoomNode().hidden = false;
    document.body.style.overflow = 'hidden';
    const close = $('zoomClose');
    if (close && close.focus) close.focus();
  }

  function closeChartZoom() {
    chartZoomNode().hidden = true;
    document.body.style.overflow = '';
    zoomState.pointers.clear();
    $('chartZoomBody').classList.remove('is-dragging');
    if (zoomLastTrigger && zoomLastTrigger.focus) zoomLastTrigger.focus();
  }

  /** Ponteiros dentro da lupa: um arrasta, dois fazem pinça. */
  function zoomPointerDown(event) {
    const body = $('chartZoomBody');
    if (body.setPointerCapture) body.setPointerCapture(event.pointerId);
    zoomState.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (zoomState.pointers.size === 2) {
      const [a, b] = [...zoomState.pointers.values()];
      zoomState.lastDistance = Math.hypot(a.x - b.x, a.y - b.y);
    }
    body.classList.add('is-dragging');
  }

  function zoomPointerMove(event) {
    if (!zoomState.pointers.has(event.pointerId)) return;
    const previous = zoomState.pointers.get(event.pointerId);
    zoomState.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (zoomState.pointers.size === 2) {
      const [a, b] = [...zoomState.pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const body = $('chartZoomBody').getBoundingClientRect();
      const middleX = (a.x + b.x) / 2 - body.left, middleY = (a.y + b.y) / 2 - body.top;
      if (zoomState.lastDistance > 0 && distance > 0) zoomBy(distance / zoomState.lastDistance, middleX, middleY);
      zoomState.lastDistance = distance;
      return;
    }
    const deltaX = event.clientX - previous.x, deltaY = event.clientY - previous.y;
    zoomState.x += deltaX;
    zoomState.y += deltaY;
    clampZoom();
    applyZoom();
  }

  function zoomPointerEnd(event) {
    zoomState.pointers.delete(event.pointerId);
    if (zoomState.pointers.size < 2) zoomState.lastDistance = 0;
    if (!zoomState.pointers.size) $('chartZoomBody').classList.remove('is-dragging');
  }

  /** Roda do rato: amplia a partir do ponteiro, não do centro. */
  function zoomWheel(event) {
    event.preventDefault();
    const body = $('chartZoomBody').getBoundingClientRect();
    zoomBy(Math.exp(-event.deltaY * 0.0016), event.clientX - body.left, event.clientY - body.top);
  }

  /** O painel e o relatório pedem isto quando os dados mudam com a lupa aberta. */
  function refreshZoom(source) {
    if (chartZoomNode().hidden || zoomSource !== source) return;
    $('chartZoomTitle').textContent = currentZoomChart().title;
    renderZoomedChart();
  }

  /** O ecrã mudou de tamanho: o palco volta para dentro dos limites. */
  function resize() {
    if (chartZoomNode().hidden) return;
    clampZoom();
    applyZoom();
  }

  return { attach, openChartZoom, closeChartZoom, resetZoom, zoomToCenter, zoomBy, zoomState, chartZoomNode, refreshZoom, resize,
    zoomPointerDown, zoomPointerMove, zoomPointerEnd, zoomWheel };
});
