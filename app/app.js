/*
 * Conta Carta · arranque e ligação da aplicação
 *
 * Este ficheiro não desenha nada: abre os dados, guarda-os e liga as peças.
 * Cada pedaço da interface vive no seu módulo:
 *
 *   lib/         regras e dados (core, pdf, chart, period, side, base)
 *   components/  peças reutilizáveis (ui, chips, form, table, filter, feedback, zoom)
 *   views/       cada ecrã e cada formulário (panel, stock, lots, records, forms, export)
 *
 * A persistência passa só por duas funções: `loadState` e `persist`. Com o
 * servidor (SQLite) os dados vivem em `dados/`; sem servidor ficam no
 * armazenamento deste navegador. Nenhum registo sai deste computador.
 *
 * Cada máquina tem três quantidades: produzidas, rejeitadas pela máquina e
 * rejeitadas no teste de qualidade. As aprovadas são calculadas.
 */
(function () {
  'use strict';

  const core = window.ContaCartaCore;
  const pdf = window.ContaCartaPdf;
  const chart = window.ContaCartaChart;
  // liga um módulo: confere as peças e devolve a API (nunca fica meio ligado)
  const link = window.ContaCartaModule.create;
  const UI = window.ContaCartaUI;
  // as peças que vivem em módulos próprios ligam-se ao ui.js (dono das ferramentas)
  UI.linkTable(window.ContaCartaTable);
  UI.linkPickDate(window.ContaCartaPickDate);
  const { el, fill, dateText, monthText, infoButton, stripCard, buildTable, dateBox, rateClass } = UI;
  const { today, stamp, shortStamp } = UI;
  /** O logótipo do PDF é descarregado uma vez, no arranque (as exportações esperam por ele). */
  const logoPreload = UI.loadLogo().then((logo) => { app.logo = logo; });

  const config = window.CONTACARTA_CONFIG || { storage: 'browser' };

  /** O elemento pelo id, em todo o ficheiro: a única leitura do ecrã que aqui se faz. */
  // o elemento pelo id vem da peça única do ecrã
  const $ = window.ContaCartaDom.byId;

  // o retorno ao utilizador (aviso, erro, confirmação, dicas) num componente só
  const Feedback = window.ContaCartaFeedback.create({
    $, el, fill, help: core.HELP,
    sendLog: (detail) => {
      try {
        navigator.sendBeacon('/api/log', new Blob([JSON.stringify({ message: String(detail).slice(0, 280) })], { type: 'application/json' }));
      } catch (_) { /* o registo de erros nunca pode bloquear a aplicação */ }
    },
  });
  const Form = window.ContaCartaForm.create({ $, toast: Feedback.toast });
  const Chips = window.ContaCartaChips.create({ el, shortDate: core.shortDate });

  /** O estado que todas as vistas lêem e escrevem. */
  const app = {
    state: core.emptyState(),
    revision: 0,
    ready: false,
    saving: false,
    view: 'panel',
    panelTab: 'machines',
    reasonsOpen: false,
    sideOpen: true,
    filter: { mode: 'month', month: '', start: '', end: '', year: '' },
    metric: 'produced',
    recordsYear: '',
    dayId: '',
    stockKind: '',
    lotsStage: '',
    rma: '',
    report: { kind: 'month', date: '', month: '', start: '', end: '', compareA: '', compareB: '', yearsA: '', yearsB: '' },
    generated: null,
    savedAt: null,
    logo: null,
  };

  /* ------------------------------------------------ leitura do estado --- */

  /** O armazém, os lotes de hoje e o período à vista: uma leitura para todos. */
  const stockOverview = () => core.stockOverview(app.state.stock);
  const lotsToday = () => core.lotBoard(app.state.lots, today());

  /** O dia à vista: o escolhido na lista ou, por omissão, o de hoje. */
  const currentDay = () => DayBook.day();

  // abrir e gravar os dados vive em lib/store.js (servidor SQLite ou este navegador)
  const Store = window.ContaCartaStore.create({
    app, config, stamp, toast: Feedback.toast, render: () => render(), onError: Feedback.reportError,
    driven: (lotId, stage) => LotBook.driven(lotId, stage),
  });
  const { nextState, normalise: normaliseImport } = Store;

  /** Grava e redesenha (o mesmo caminho para todas as vistas e formulários); as operações relêem os números. */
  const tryPersist = async (...args) => {
    const saved = await Store.save(...args);
    if (saved) Operations.sync();
    return saved;
  };

  /* ---------------------------------------------- período e âmbito --- */

  /** O período que o filtro aponta; o rótulo é o que a pessoa lê. */
  const scope = { period: () => Filter.period(), label: () => Filter.label() };

  /** O resumo do período à vista, com o rótulo que as vistas mostram. */
  function currentSummary() {
    const period = Filter.period();
    const summary = core.summarise(app.state, period.start, period.end);
    summary.label = Filter.label();
    return summary;
  }

  /** Preenche filtros e relatórios; com `force` volta a apontar para o mês mais recente. */
  function seedFilters(force) {
    const latest = core.mostRecent(app.state.records);
    const month = (latest ? latest.start : today()).slice(0, 7);
    if (force) app.filter.month = month;
    app.filter.month = app.filter.month || month;
    if (app.filter.mode === 'month' || !app.filter.start) {
      ({ start: app.filter.start, end: app.filter.end } = core.monthRange(app.filter.month));
    }
    app.report.date = app.report.date || today();
    app.report.month = (force ? month : app.report.month) || app.filter.month;
    app.report.start = app.report.start || app.filter.start;
    app.report.end = app.report.end || app.filter.end;
    app.filter.year = app.filter.year || app.filter.month.slice(0, 4);
    app.report.compareB = app.report.compareB || app.filter.month;
    app.report.compareA = app.report.compareA || core.shiftMonth(app.report.compareB, -1);
    app.report.yearsB = app.report.yearsB || app.filter.month.slice(0, 4);
    app.report.yearsA = app.report.yearsA || String(+app.report.yearsB - 1);
    if (force) app.recordsYear = latest ? latest.start.slice(0, 4) : today().slice(0, 4);
    app.recordsYear = app.recordsYear || (latest ? latest.start.slice(0, 4) : today().slice(0, 4));
  }

  /** Depois de importar ou carregar o exemplo, mostra logo o mês onde há dados. */
  function lookAtLatest() {
    app.filter.mode = 'month';
    seedFilters(true);
    Filter.render();
    render();
  }

  /* ---------------------------------------------------- navegação --- */

  const VIEWS = {
    panel: { title: 'Painel', context: () => Filter.label() },
    stock: { title: 'Armazém', context: () => `${core.format(stockOverview().items.length)} ${stockOverview().items.length === 1 ? 'material controlado' : 'materiais controlados'} · ${core.format(stockOverview().low.length)} em alerta` },
    lots: { title: 'Lotes', context: () => `${core.format(app.state.lots.length)} ${app.state.lots.length === 1 ? 'lote' : 'lotes'} · ${core.format(lotsToday().toDispatch)} por despachar` },
    records: {
      title: 'Dia de produção',
      context: () => {
        const record = currentDay();
        const status = core.dayStatus(record || { entries: [] });
        return `${record ? core.shortDate(record.start) : 'Hoje'} · ${core.format(status.lots)} ${status.lots === 1 ? 'lote' : 'lotes'} · ${core.format(status.totals.produced)} cartas`;
      },
    },
    reports: { title: 'Relatórios', context: () => 'Documento para arquivo, impressão ou envio à direcção' },
  };

  function showView(name) {
    app.view = name in VIEWS ? name : 'panel';
    for (const key of Object.keys(VIEWS)) $(`view-${key}`).hidden = app.view !== key;
    document.querySelectorAll('.nav-item').forEach((node) => {
      const active = node.dataset.view === app.view;
      node.classList.toggle('is-active', active);
      if (active) node.setAttribute('aria-current', 'page');
      else node.removeAttribute('aria-current');
    });
    $('viewTitle').textContent = VIEWS[app.view].title;
    if (!app.ready) return;
    render();
  }

  /** Barra lateral aberta ou recolhida, com o rótulo certo no botão. */
  function applySide() {
    const state = window.ContaCartaSide.sideState(app.sideOpen);
    document.querySelector('.app').classList.toggle('is-collapsed', state.collapsed);
    const button = $('sideToggle');
    button.setAttribute('aria-expanded', String(app.sideOpen));
    button.setAttribute('aria-label', state.label);
    button.title = state.label;
  }

  /* ------------------------------------------------------- desenho --- */

  /** Refaz o gráfico da lupa quando os dados mudam com ela aberta. */
  const refreshOpenZoom = (source) => Zoom.refreshZoom(source);

  function render() {
    if (!app.ready) return;
    try {
      draw();
      refreshOpenZoom('panel');
    } catch (error) {
      Feedback.reportError(`desenho: ${error.message}`);
      Feedback.showError('Não foi possível mostrar os registos. Recarrega a página.');
    }
  }

  function draw() {
    // um contador por entrada do menu, sempre com o mesmo critério da vista
    const counters = {
      navCount: app.state.records.length,
      stockCount: stockOverview().low.length,
      lotsCount: lotsToday().toDispatch,
    };
    for (const [id, value] of Object.entries(counters)) {
      $(id).textContent = core.format(value);
      $(id).hidden = !value;
    }
    $('viewContext').textContent = VIEWS[app.view].context();
    $('storageText').textContent = Store.onServer
      ? (app.savedAt ? `Guardado às ${shortStamp(app.savedAt)}` : 'Guardado neste computador')
      : 'Guardado neste navegador';
    $('sampleLabel').textContent = Files.hasSample() ? 'Remover dados fictícios' : 'Ver com dados fictícios';

    const summary = currentSummary();
    // o botão dos motivos só existe quando o período tem chumbadas no teste
    const withReasons = summary.qualityRejected > 0;
    $('reasonsDrawer').hidden = !withReasons;
    if (!withReasons) app.reasonsOpen = false;
    // os contadores do menu (acima) já leram armazém e lotes; só se desenha a vista à frente
    if (app.view === 'panel') { Panel.renderScope(summary); Panel.render(summary); }
    if (app.view === 'stock') StockView.render();
    if (app.view === 'lots') LotsView.render();
    if (app.view === 'records') DayView.render(app.filter);
    if (app.view === 'reports') { Reports.renderReportControls(); Reports.renderReport(summary); }
  }

  /* ------------------------------------------------------- módulos --- */

  // o livro dos lotes e do material: as gravações de um lote ou de um artigo, e de onde vem cada fase
  const LotBook = link('livro dos lotes', { app, save: (...args) => tryPersist(...args), nextState, confirm: Feedback.confirm, render: () => render() },
    (deps) => window.ContaCartaLotBook.create(deps));
  // o livro do dia: todas as gravações de um dia, num sítio só
  const DayBook = link('livro do dia', {
    app, save: (next, message, onError) => tryPersist(next, message, onError),
    confirm: Feedback.confirm, toast: Feedback.toast, today, driven: LotBook.driven,
    setDay: (id) => { app.dayId = id; }, redraw: () => render(),
  }, (deps) => window.ContaCartaDayBook.create(deps));
  // as peças de desenho que todas as vistas recebem (o app empresta, não duplica)
  const ui = { el, fill, infoButton, dateText, monthText, today, rateClass, stripCard, buildTable, dateBox, options: UI.options };
  // só as vistas que guardam o filtro o recebem
  const filter = app.filter;

  const Zoom = window.ContaCartaZoom;
  const Filter = link('filtro', { ui: { ...ui, toast: Feedback.toast }, filter, onChange: () => render(), today, records: () => app.state.records },
    ({ ui: parts, filter: state, onChange, today: day, records }) =>
      window.ContaCartaFilter.create({ ui: parts, filter: state, records, onChange, today: day }));
  const Panel = link('painel', { ui, chartBars: chart.chartBars, scope, overview: stockOverview, board: lotsToday, app },
    (deps) => window.ContaCartaPanelView.create(deps));
  const StockView = link('vista armazém', { ui, overview: stockOverview, filter: app }, (deps) => window.ContaCartaStockView.create(deps));
  const LotsView = link('vista lotes', { ui, chips: Chips, board: lotsToday, lots: () => app.state.lots, filter: app }, (deps) => window.ContaCartaLotsView.create(deps));
  const dayActions = {
    closeEntry: DayBook.closeEntry, reopenEntry: DayBook.reopenEntry,
    finishDay: DayBook.finishDay, reopenDay: DayBook.reopenDay,
    deleteEntry: DayBook.deleteEntry, openDay: DayBook.openDay, deleteRecord: DayBook.deleteDay,
    editEntry: (id) => { if (Form.ready(app.ready)) RecordForm.edit(id); },
    add: (date) => openForm('record', date),
  };
  const DayView = link('vista do dia', { ui, day: currentDay, records: () => app.state.records },
    (deps) => window.ContaCartaDayView.create(deps));
  const lock = window.ContaCartaLock;
  const RecordForm = link('formulário do dia', { ui, form: Form, lock, submit: DayBook.addEntry, day: currentDay, lots: () => app.state.lots, records: () => app.state.records, refusal: LotBook.refusal },
    (deps) => window.ContaCartaRecordForm.create(deps));
  // o livro do dia precisa do formulário para mostrar os erros e limpar depois de guardar
  DayBook.attachForm(RecordForm);
  const LotForm = link('formulário do lote', { ui, form: Form, lock, chips: Chips, submit: LotBook.saveLot, lots: () => app.state.lots, source: LotBook.source },
    (deps) => window.ContaCartaLotForm.create(deps));
  const StockForm = link('formulário do material', { ui, form: Form, lock, submit: LotBook.saveStock, stock: () => app.state.stock },
    (deps) => window.ContaCartaStockForm.create(deps));
  LotBook.attachForms(LotForm, StockForm);

  const Reports = link('relatórios', { app, ui, today, stamp, scope, stockOverview, refreshOpenZoom },
    ({ app: state, ui: parts, today: day, stamp: now, scope: label, stockOverview: stock, refreshOpenZoom: refreshZoom }) => {
      const reports = window.ContaCartaReports;
      reports.attach({
        app: state, ui: parts, today: day, stamp: now,
        refreshOpenZoom: refreshZoom, filterPeriod: () => Filter.period(),
        stockOverview: stock, scopeLabel: () => label.label(),
      });
      return reports;
    });

  // a folha do relatório recebe o estado e desenha (reports.js constrói, esta imprime)
  const Paper = link('folha do relatório', { app, ui, chartBars: chart.chartBars, comparisonTitle: Reports.comparisonTitle,
    rejectionTitle: Reports.rejectionTitle },
    (deps) => window.ContaCartaReportPaper.create(deps));
  Reports.usePaper(Paper);

  const Files = link('cópias', { ui, feedback: Feedback, state: () => app.state, normalise: normaliseImport, latest: lookAtLatest,
    save: tryPersist, movements: () => Operations.copy() },
  (deps) => window.ContaCartaFiles.create(deps));
  // a lupa precisa do painel (dashboardChart) e do relatório; liga-se depois de ambos
  link('lupa', { app, reports: Reports, chartBars: chart.chartBars, dashboardChart: () => Panel.dashboardChart(),
    reportChartPoints: () => Paper.reportChartPoints(), paperChartMetric: () => Paper.paperChartMetric() },
  (deps) => Zoom.attach(deps));

  const Export = link('exportações', { pdf, reports: Reports, feedback: Feedback, app,
    generated: () => app.generated, logo: () => logoPreload, reportKind: () => app.report.kind },
  (deps) => window.ContaCartaExport.create(deps));

  // por baixo do painel: o mapa por delegação e os movimentos (só com o servidor)
  const Operations = link('operações', { ui, map: window.ContaCartaMap, stock: () => app.state.stock, onData: LotBook.track, onMove: LotBook.adopt },
    (deps) => window.ContaCartaOperations.create(deps));

  /* ------------------------------------------------------ arranque --- */

  /** Medidas de texto para o PDF, com métricas compatíveis com Helvetica. */
  function installMeasurer() {
    if (!pdf || typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    pdf.setMeasurer((text, size, bold) => {
      ctx.font = `${bold ? 'bold ' : ''}${size}px Helvetica, Arial, sans-serif`;
      return ctx.measureText(String(text)).width;
    });
  }

  async function boot() {
    installMeasurer();
    wireInterface();
    // os 🛈 escritos no HTML levam o mesmo ícone dos que nascem no código
    document.querySelectorAll('.info').forEach((node) => { if (!node.firstChild) node.innerHTML = UI.infoIcon; });
    try {
      const loaded = await Store.load();
      // uma base antiga pode não trazer lotes nem material: o ecrã nunca rebenta por isso
      app.state = { ...core.emptyState(), ...loaded.state };
      app.sideOpen = app.state.sideOpen !== false;
      applySide();
      app.revision = loaded.revision;
      app.savedAt = loaded.savedAt;
      app.ready = true;
      Feedback.clearError();
      seedFilters();
      Filter.render();
      render();
      if (Store.onServer) Operations.start();
    } catch (error) {
      Feedback.reportError(`arranque: ${error.message}`);
      Feedback.showError(`${error.message} Os registos já guardados não foram alterados.`);
      $('storageText').textContent = 'Sem acesso aos registos';
      document.querySelectorAll('.nav-item, .btn, .side-action').forEach((node) => { node.disabled = true; });
      $('reloadNow').disabled = false;
    }
  }

  /* --------------------------------------------------- formulários --- */

  /** Abre um formulário do registo, do lote ou do material, com os dados carregados. */
  function openForm(kind, ...args) {
    const forms = { record: RecordForm, lot: LotForm, stock: StockForm };
    if (!Form.ready(app.ready)) return;
    forms[kind].open(...args);
  }

  /* ------------------------------------------------------- eventos --- */

  /** Entrega as peças ao módulo de eventos (views/wiring.js) e liga tudo. */
  function wireInterface() {
    window.ContaCartaWiring.wire({
      app, feedback: Feedback, filter: Filter, panel: Panel,
      stockView: StockView, lotsView: LotsView, reports: Reports, zoom: Zoom,
      recordForm: RecordForm, lotForm: LotForm, stockForm: StockForm,
      exportView: Export, files: Files, forms: Form, refreshOpenZoom,
      actions: { openForm, showView, deleteLot: LotBook.deleteLot, deleteStockItem: LotBook.deleteStock, persist: tryPersist,
        nextState, render, seedFilters, currentSummary, applySide, ...dayActions },
    });
  }

  /* -------------------------------------------------------- arranque --- */

  const start = () => { boot(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
