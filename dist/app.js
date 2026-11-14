/*
 * Conta Carta · interface (painel, registos, relatórios) e armazenamento
 *
 * A persistência passa só por duas funções: `loadState` e `persist`.
 * Com o servidor (SQLite) os dados vivem em `dados/`; sem servidor ficam no
 * armazenamento deste navegador. Nenhum registo sai deste computador.
 *
 * Cada máquina tem três quantidades: produzidas, rejeitadas pela máquina e
 * rejeitadas no teste de qualidade. As aprovadas são calculadas.
 */
(function () {
  'use strict';

  const core = window.ContaCartaCore;
  const pdf = window.ContaCartaPdf;
  const $ = (id) => document.getElementById(id);
  const config = window.CONTACARTA_CONFIG || { storage: 'browser' };
  const onServer = config.storage === 'sqlite';
  const STORAGE_KEY = 'contacarta-registos-v4';
  const SAMPLE_PREFIX = 'exemplo-';
  const PERIOD_NAMES = { day: 'Dia', month: 'Mês', range: 'Vários dias' };

  const app = {
    state: core.emptyState(),
    revision: 0,
    ready: false,
    saving: false,
    view: 'panel',
    filter: { mode: 'month', month: '', start: '', end: '', year: '' },
    metric: 'produced',
    recordsYear: '',
    report: { kind: 'month', date: '', month: '', start: '', end: '', compareA: '', compareB: '',
      yearsA: '', yearsB: '' },
    generated: null,
    editing: null,
    formPeriod: 'day',
    savedAt: null,
  };

  /* ------------------------------------------------------- utilidades --- */

  /** Cria elementos sem HTML escrito à mão: textos nunca viram markup. */
  function el(tag, props, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of [].concat(children === undefined ? [] : children)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const fill = (node, ...children) => node.replaceChildren(...children.filter(Boolean));
  const fmt = core.format;
  const round = (value) => Math.round(value * 10) / 10;
  const today = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const thisMonth = () => today().slice(0, 7);
  const pad2 = (value) => String(value).padStart(2, '0');
  /** Carimbo «dd/mm/yyyy, HH:MM» — dd/mm/yyyy em todo o lado, como no resto do sistema. */
  /** Carimbo «dd/mm/yyyy, HH:MM» — dd/mm/yyyy em todo o lado, como no resto do sistema. */
  const stampFor = (now) => `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()}, ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const stamp = () => stampFor(new Date());
  const shortStamp = (iso) => (iso ? stampFor(new Date(iso)) : '');

  /** Um erro de desenho nunca deixa a folha a meio: avisa e regista. */
  /** Nenhum botão pode falhar em silêncio: o erro aparece e fica em registo curto. */
  function guard(name, run) {
    const fail = (error) => {
      reportError(`${name}: ${error && error.message}`);
      toast('Não foi possível completar essa acção. Tenta outra vez.');
      return undefined;
    };
    return (...args) => {
      let result;
      try {
        result = run(...args);
      } catch (error) {
        return fail(error);
      }
      return result && typeof result.catch === 'function' ? result.catch(fail) : result;
    };
  }

  function toast(message) {
    const node = $('toast');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.hidden = true; }, 5400);
  }

  function showError(message) {
    const bar = $('loadError');
    bar.textContent = message;
    bar.hidden = false;
  }
  const clearError = () => { $('loadError').hidden = true; };

  /** O detalhe técnico vai para dados/contacarta.log; a pessoa vê uma frase curta. */
  function reportError(detail) {
    if (window.console) console.warn('[Conta Carta]', detail);
    if (!onServer) return;
    try {
      navigator.sendBeacon('/api/log', new Blob([JSON.stringify({ message: String(detail).slice(0, 280) })], { type: 'application/json' }));
    } catch (_) { /* o registo de erros nunca pode bloquear a aplicação */ }
  }

  /* --------------------------------------------------- textos de ajuda --- */

  const HELP = {
    panel: 'Escolhe um mês ou um intervalo de datas. Só entram na conta os registos cujo período cabe por inteiro na selecção. O botão da lupa amplia o gráfico.',
    machines: 'Registas à mão: quanto produziu a máquina, o que ela deitou fora e o que saiu no teste de qualidade. Aprovadas = produzidas − rejeitadas − rejeitadas no teste de qualidade.',
    approval: 'Percentagem de cartas aprovadas sobre tudo o que foi produzido, depois das duas rejeições.',
    rejection: 'Cartas deitadas fora pela máquina: impressão defeituosa, dados ilegíveis ou erro de personalização.',
    qualityRejection: 'Cartas que passaram a máquina e caíram no teste de qualidade: erro de dados, foto ou chip. Conta separada das rejeições da máquina.',
    coverage: 'Dias com registo não são dias de trabalho: um dia sem registo não conta como producção zero.',
    period: 'Dia para apontar um turno; Mês para fechar um mês; Vários dias para uma semana ou outra pausa.',
    report: 'O relatório soma os registos do período escolhido. Os relatórios de rejeição detalham as rejeições da máquina e as do teste de qualidade. Pode ser guardado em PDF (A4), em CSV ou impresso.',
    pdf: 'O PDF é gerado neste computador, com o cabeçalho do INATRO pronto a arquivar ou imprimir.',
    copy: 'Exporta um ficheiro .json com todos os registos. Serve para backup e para levar os dados para outro computador.',
    import: 'Importar substitui os registos actuais pelos do ficheiro. Exporta uma cópia antes, se quiseres voltar atrás.',
    sample: 'Carrega um período fictício para veres o painel a trabalhar. Nada é enviado para fora deste computador.',
    outside: 'Há registos que começam antes ou acabam depois deste período. Ficam de fora para não contar cartas duas vezes.',
    year: 'A visão de ano soma os doze meses de uma vez. Serve para fechar um ano e para o comparar com o anterior.',
    compare: 'A comparação põe dois meses (ou dois anos) lado a lado e mostra a diferença entre eles. Para somar um intervalo inteiro seguido, usa Período.',
    delta: 'A variação é sempre medida contra o período imediatamente anterior, do mesmo tamanho. Sem registos nesse período, não há comparação.',
  };

  const infoIcon = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="6.7" r="1.15" fill="currentColor"/><path d="M10 9.6v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const infoButton = (key) => {
    const button = el('button', { class: 'info', type: 'button', 'data-info': key, 'aria-label': 'Mais informação' });
    button.innerHTML = infoIcon;
    return button;
  };

  /* ------------------------------------------- logótipo para o PDF --- */

  /**
   * Descarrega uma vez o JPEG achatado do logótipo oficial (pronto a embutir no
   * PDF, que não lê PNG transparente). Se falhar, o PDF sai com o nome da
   * instituição em texto — nunca sem identificação.
   */
  const logoPreload = fetch('inatro-letterhead.jpg', { cache: 'force-cache' })
    .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error('sem logótipo'))))
    .then((buffer) => { app.logo = { bytes: new Uint8Array(buffer), pixelWidth: 979, pixelHeight: 319 }; })
    .catch(() => { app.logo = null; });

  /* --------------------------------------------------- armazenamento --- */

  /**
   * Carrega o estado dos registos: do servidor SQLite via /api/state (quando disponível)
   * ou do localStorage do navegador como modo offline.
   */
  async function loadState() {
    if (onServer) {
      const response = await fetch('/api/state', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Não foi possível abrir a base de dados. Confirma que a janela do programa está aberta.');
      return { state: core.validate(body.state), revision: body.revision || 0, savedAt: body.savedAt || null };
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { state: core.emptyState(), revision: 0, savedAt: null };
    return { state: normaliseImport(JSON.parse(stored)), revision: 0, savedAt: null };
  }

  /** Valida, convertendo primeiro cópias de versões anteriores. */
  function normaliseImport(payload) {
    return core.validate(payload && payload.version === core.VERSION ? payload : core.migrate(payload));
  }

  /**
   * Persiste o estado atualizado com validação e gestão de concorrência.
   * No servidor, usa controlo de revisão optimista contra conflitos.
   */
  async function persist(next) {
    if (app.saving) return false;
    app.saving = true;
    try {
      core.validate(next);
      if (onServer) {
        const response = await fetch('/api/state', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: app.revision, state: next }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 409) $('conflictBar').hidden = false;
          throw new Error(body.error || 'Não foi possível guardar neste computador. Tenta outra vez.');
        }
        app.revision = body.revision;
        app.savedAt = new Date().toISOString();
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }
      app.state = next;
      return true;
    } catch (error) {
      reportError(`gravação: ${error.message}`);
      throw error;
    } finally {
      app.saving = false;
    }
  }

  async function tryPersist(next, successMessage) {
    try {
      if (await persist(next)) {
        render();
        if (successMessage) toast(successMessage);
        return true;
      }
    } catch (error) {
      showFormError(error.message);
      toast(error.message);
    }
    return false;
  }

  /* ---------------------------------------------------------- arranque --- */

  async function boot() {
    installMeasurer();
    wireInterface();
    try {
      const loaded = await loadState();
      app.state = loaded.state;
      app.revision = loaded.revision;
      app.savedAt = loaded.savedAt;
      app.ready = true;
      clearError();
      seedFilters();
      syncFilterControls();
      render();
    } catch (error) {
      reportError(`arranque: ${error.message}`);
      showError(`${error.message} Os registos já guardados não foram alterados.`);
      $('storageText').textContent = 'Sem acesso aos registos';
      document.querySelectorAll('.nav-item, .btn, .side-action').forEach((node) => { node.disabled = true; });
      $('reloadNow').disabled = false;
    }
  }

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

  /* -------------------------------------------------------- navegação --- */

  const VIEWS = {
    panel: { title: 'Painel', context: () => panelScopeLabel() },
    records: { title: 'Registos', context: () => `${fmt(app.state.records.length)} ${app.state.records.length === 1 ? 'registo guardado' : 'registos guardados'} neste computador` },
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
    render();
  }

  /* ------------------------------------------------------------ render --- */

  function render() {
    if (!app.ready) return;
    try {
      draw();
      refreshOpenZoom('panel');
    } catch (error) { reportError(`desenho: ${error.message}`); showError('Não foi possível mostrar os registos. Recarrega a página.'); }
  }

  function draw() {
    $('navCount').textContent = app.state.records.length;
    $('navCount').hidden = app.state.records.length === 0;
    $('viewContext').textContent = VIEWS[app.view].context();
    $('storageText').textContent = onServer
      ? (app.savedAt ? `Guardado às ${shortStamp(app.savedAt)}` : 'Guardado neste computador')
      : 'Guardado neste navegador';
    $('sampleLabel').textContent = hasSample() ? 'Remover dados fictícios' : 'Ver com dados fictícios';

    const summary = currentSummary();
    renderFilter(summary);
    renderPanel(summary);
    renderRecords();
    renderReportControls();
    if (app.view === 'reports') renderReport(summary);
  }

  /** O que o painel está a mostrar, conforme o modo de consulta. */
  function filterPeriod() {
    if (app.filter.mode === 'month') return core.monthRange(app.filter.month);
    if (app.filter.mode === 'year') return core.yearRange(app.filter.year);
    return { start: app.filter.start, end: app.filter.end };
  }

  function panelScopeLabel() {
    if (app.filter.mode === 'month') return core.monthLabel(app.filter.month);
    if (app.filter.mode === 'year') return `Ano de ${app.filter.year}`;
    return core.periodLabel(app.filter.start, app.filter.end);
  }

  function currentSummary() {
    const period = filterPeriod();
    const summary = core.summarise(app.state, period.start, period.end);
    summary.label = panelScopeLabel();
    return summary;
  }

  function renderFilter(summary) {
    const scope = [el('strong', { text: summary.label }), el('span', { text: `${fmt(summary.records.length)} ${summary.records.length === 1 ? 'registo' : 'registos'}` })];
    if (summary.outside.length) {
      scope.push(el('span', { class: 'warn' }, [el('span', { text: `${fmt(summary.outside.length)} fora do período` }), infoButton('outside')]));
    }
    fill($('filterScope'), ...scope);
  }

  function renderPanel(summary) {
    renderKpis(summary);
    renderMachines(summary);
    renderChart();
    fill($('panelTable'), dataTable(summary, false));
  }

  /** Variação face ao período anterior do mesmo tamanho; só faz sentido em mês e ano. */
  /** Data de hoje no fuso deste computador, em «AAAA-MM-DD». */
  const todayLocal = () => {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  };

  function previousDelta(summary) {
    if (app.filter.mode !== 'month' && app.filter.mode !== 'year') return null;
    const period = filterPeriod();
    const today = todayLocal();
    let delta;
    if (period.end > today) {
      // mês ou ano ainda a decorrer: a comparação certa é com o mesmo arco do período anterior
      if (app.filter.mode === 'month') {
        const previous = core.shiftMonth(period.start.slice(0, 7), -1);
        if (previous.slice(0, 4) < '1900') return null;
        const elapsed = Number(today.slice(8, 10)) - Number(period.start.slice(8, 10)) + 1;
        const cap = Number(core.monthRange(previous).end.slice(8, 10));
        const length = Math.min(elapsed, cap);
        delta = core.compareWindows(app.state,
          { start: period.start, end: today },
          { start: `${previous}-01`, end: `${previous}-${String(length).padStart(2, '0')}` });
      } else {
        const previous = String(Number(period.start.slice(0, 4)) - 1);
        if (Number(previous) < 1900) return null;
        const sameDay = `${previous}-${today.slice(5)}`;
        // 29/02 não existe em todos os anos: nesse caso, o 28
        const monthDay = core.monthRange(sameDay.slice(0, 7));
        const previousEnd = sameDay <= monthDay.end ? sameDay : monthDay.end;
        delta = core.compareWindows(app.state,
          { start: period.start, end: today },
          { start: `${previous}-01-01`, end: previousEnd });
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

  const signed = (value, suffix) => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${fmt(Math.abs(value))}${suffix || ''}`;

  function renderKpis(summary) {
    const delta = previousDelta(summary);
    const deltaReady = !!(delta && delta.shown);
    const versus = el('div', {
      class: `kpi-delta${deltaReady ? ` ${delta.produced > 0 ? 'is-up' : delta.produced < 0 ? 'is-down' : ''}` : ' is-empty'}`.trim(),
      'aria-hidden': deltaReady ? 'false' : 'true',
    }, deltaReady ? [
      el('span', { class: 'kpi-delta-line', text: `${signed(delta.produced)} face ao ${delta.unit}` }),
      el('span', { class: 'kpi-delta-sub' }, [
        delta.qualifier ? el('span', { class: 'kpi-delta-qualifier', text: delta.qualifier }) : '',
        delta.rate !== null ? el('span', { class: 'kpi-delta-rate', text: `${signed(delta.rate, ' p.')} na taxa` }) : '',
        infoButton('delta'),
      ]),
    ] : [
      el('span', { class: 'kpi-delta-line', text: '\u00a0' }),
      el('span', { class: 'kpi-delta-line', text: '\u00a0' }),
    ]);
    const cards = [
      { label: 'Produzidas', value: fmt(summary.produced), hint: 'cartas no período', help: 'machines' },
      { label: 'Aprovadas', value: fmt(summary.approved), hint: `taxa ${core.formatPercent(summary.approvalRate)}`, help: 'approval' },
      { label: 'Rej. máquina', value: fmt(summary.rejected), hint: `taxa ${core.formatPercent(summary.rejectionRate)}`, help: 'rejection', tone: summary.rejected ? 'is-bad' : '' },
      { label: 'Rej. qualidade', value: fmt(summary.qualityRejected), hint: `taxa ${core.formatPercent(summary.qualityRejectionRate)}`, help: 'qualityRejection', tone: summary.qualityRejected ? 'is-bad' : '' },
      { label: 'Cobertura', value: `${fmt(summary.daysCovered)}/${fmt(summary.days)}`, hint: 'dias com registo', help: 'coverage' },
    ];
    // em modo ano, o número de «cartas produzidas» é mais útil como média mensal
    if (app.filter.mode === 'year' && summary.days >= 360) {
      const avg = Math.round(summary.produced / 12);
      // «meses com registo» = meses tocados por pelo menos um registo somado
      const monthsCovered = new Set();
      for (const record of summary.records) {
        let cursor = record.start.slice(0, 7);
        const limit = record.end.slice(0, 7);
        while (cursor <= limit) { monthsCovered.add(cursor); cursor = core.shiftMonth(cursor, 1); }
      }
      cards[0] = { label: 'Produzidas no ano', value: fmt(summary.produced), hint: `média ${fmt(avg)} por mês`, help: 'year' };
      cards[4] = { label: 'Meses com registo', value: `${fmt(monthsCovered.size)}/12`,
        hint: monthsCovered.size ? 'meses com pelo menos um registo' : 'ainda nenhum registo neste ano', help: 'coverage' };
    }
    fill($('kpis'), ...cards.map((card, index) => el('article', { class: 'kpi' }, [
      el('div', { class: 'kpi-top' }, [el('span', { text: card.label }), infoButton(card.help)]),
      el('div', { class: `kpi-value ${card.tone || ''}`.trim(), text: card.value }),
      el('div', { class: 'kpi-hint', text: card.hint }),
      index === 0 ? versus : '',
    ])));
  }

  function renderMachines(summary) {
    const cards = summary.machines.map((machine, index) => {
      const rate = core.percent(machine.approved, machine.produced);
      const tone = rate === null ? '' : rate >= 90 ? 'is-ok' : rate >= 80 ? 'is-warn' : 'is-bad';
      return el('div', { class: 'machine' }, [
        el('div', { class: 'machine-head' }, [
          el('h3', { text: core.MACHINES[index] }),
          el('span', { class: `chip ${tone}`.trim(), text: rate === null ? 'sem producção' : `${core.formatPercent(rate)} aprovadas` }),
        ]),
        el('div', { class: 'machine-grid' }, [
          { label: 'Produzidas', value: machine.produced, tone: '' },
          { label: 'Aprovadas', value: machine.approved, tone: 'is-ok' },
          { label: 'Rej. máquina', value: machine.rejected, tone: machine.rejected ? 'is-bad' : '' },
          { label: 'Rej. qualidade', value: machine.qualityRejected, tone: machine.qualityRejected ? 'is-bad' : '' },
        ].map((cell) => el('div', {}, [
          el('span', { text: cell.label }),
          el('strong', { class: cell.tone, text: fmt(cell.value) }),
        ]))),
        el('div', { class: 'bar', role: 'img', 'aria-label': `${core.formatPercent(rate)} aprovadas` }, [
          el('i', { class: 'ok', style: `width:${round(rate || 0)}%` }),
          el('i', { class: 'bad', style: `width:${round(machine.rejectionRate || 0)}%` }),
          el('i', { class: 'warn', style: `width:${round(machine.qualityRejectionRate || 0)}%` }),
        ]),
      ]);
    });
    fill($('machineCards'), ...cards);
  }

  /** Pontos, título e unidade do gráfico conforme o modo do painel. */
  function dashboardChart() {
    const mode = app.filter.mode;
    if (mode === 'year' || mode === 'month') {
      const year = mode === 'year' ? String(app.filter.year || new Date().getFullYear()) : app.filter.month.slice(0, 4);
      // «09/26» cabe sob a barra numa série de doze meses
      const points = core.series(app.state, `${year}-01-01`, `${year}-12-31`, 'month');
      return { title: `Evolução em ${year}`, points, unit: 'mês' };
    }
    const period = filterPeriod();
    return { title: 'Evolução do período', points: core.series(app.state, period.start, period.end, 'record'), unit: 'registo' };
  }

  function renderChart() {
    const { title, points, unit } = dashboardChart();
    $('chartTitle').textContent = title;
    fill($('chart'), chartBars(points, app.metric, { unit }));
  }

  /**
   * Barras em SVG. `produced` desenha três barras lado a lado por período
   * (aprovadas, rejeitadas pela máquina e rejeitadas no teste de qualidade);
   * os outros indicadores desenham uma barra por período. O topo do eixo é
   * sempre um número redondo (1 / 1,2 / 1,5 / 2 / 2,5 / 3 / 4 / 5 / 6 / 8
   * × 10ⁿ), para as linhas de grelha ficarem legíveis.
   */
  const CHART_METRICS = {
    produced: { label: 'Cartas produzidas (compostas das três saídas)', color: '#0e7a2e' },
    approved: { label: 'Cartas aprovadas', color: '#0e7a2e' },
    rejected: { label: 'Rejeitadas pela máquina', color: '#b4362d' },
    qualityRejected: { label: 'Rejeitadas no teste de qualidade', color: '#a46a12' },
  };
  const CHART_NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

  /** Menor múltiplo de um passo «agradável» que cobre `peak`, com quatro intervalos. */
  function niceApex(peak) {
    if (!(peak > 0)) return { step: 5, apex: 20 };
    const rough = peak / 4;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    const normalized = rough / magnitude;
    const factor = CHART_NICE_STEPS.find((candidate) => candidate >= normalized) || 10;
    const step = factor * magnitude;
    return { step, apex: step * 4 };
  }

  function chartBars(points, metric, options) {
    const settings = options || {};
    const width = settings.width || 640, height = settings.height || 210;
    const bottom = settings.bottom || 24, top = settings.top || 26, left = 10;
    const fontScale = settings.fontScale || 1;
    const font = (size) => Math.round(size * fontScale * 10) / 10;
    const shown = points.slice(-(settings.maxPoints || 14));
    // com muitos pontos, só um rótulo de cada tantos aparece sob a barra
    const labelEvery = Math.max(1, Math.ceil(shown.length / 12));
    const shownMetric = metric || app.metric;
    const unit = settings.unit || 'período';
    if (!shown.length || shown.every((point) => !point.produced && !point.approved && !point.rejected && !point.qualityRejected)) {
      return el('div', { class: 'empty' }, [el('strong', { text: 'Sem números para desenhar' })]);
    }
    const grouped = shownMetric === 'produced';
    const metricValue = (point) => (shownMetric === 'produced' ? point.produced
      : shownMetric === 'approved' ? point.approved
      : shownMetric === 'qualityRejected' ? (point.qualityRejected || 0)
      : point.rejected);
    const essentialPeak = Math.max(1, ...shown.map((point) => (grouped
      ? Math.max(point.approved || 0, point.rejected || 0, point.qualityRejected || 0)
      : metricValue(point))));
    const { step, apex } = niceApex(essentialPeak);
    const plotHeight = height - bottom - top;
    const slot = (width - left * 2) / shown.length;
    const parts = [`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(CHART_METRICS[shownMetric].label)} por ${unit}">`];

    if (grouped) {
      const legend = [['Aprovadas', '#0e7a2e'], ['Rej. máquina', '#b4362d'], ['Rej. qualidade', '#a46a12']];
      let cursor = left + 2;
      parts.push(`<g class="chart-legend" font-size="${font(9)}" fill="#2d3f33" font-weight="500">`);
      for (const [label, color] of legend) {
        parts.push(`<circle cx="${round(cursor + fontScale * 3.5)}" cy="${font(12)}" r="${fontScale * 3.5}" fill="${color}"/>`);
        parts.push(`<text x="${round(cursor + fontScale * 10)}" y="${font(15)}">${label}</text>`);
        cursor += (label.length * fontScale * 5.6) + fontScale * 22;
      }
      parts.push('</g>');
    }

    for (let line = 0; line <= 4; line += 1) {
      const value = Math.round(step * line);
      const y = height - bottom - (line * plotHeight) / 4;
      parts.push(`<line x1="${left}" y1="${round(y)}" x2="${width - left}" y2="${round(y)}" stroke="${line ? '#e9efe7' : '#0b3d1f'}" stroke-width="${line ? 1 : 1.2}"/>`);
      parts.push(`<text x="${width - left}" y="${round(y - font(5))}" text-anchor="end" font-size="${font(9)}" fill="#7f8c81">${fmt(value)}</text>`);
    }

    const barLabel = settings.showValues !== false;
    if (grouped) {
      // três barras lado a lado: aprovadas, rejeitadas pela máquina e no teste de qualidade
      const trio = [['approved', '#0e7a2e'], ['rejected', '#b4362d'], ['qualityRejected', '#a46a12']];
      const barCap = shown.length <= 4 ? 34 * fontScale : 18 * fontScale;
      const barWidth = Math.min(barCap, Math.max(3, (slot - 10) / 3.35));
      const gap = Math.max(1.5, barWidth * 0.22);
      const groupWidth = trio.length * barWidth + (trio.length - 1) * gap;
      const showValues = barLabel && (barWidth + gap) >= 19;
      shown.forEach((point, index) => {
        const x0 = left + index * slot + (slot - groupWidth) / 2;
        const produced = point.produced || 0;
        const rejected = point.rejected || 0;
        const quality = point.qualityRejected || 0;
        const summary = `${escapeHtml(point.full)} — Produzidas: ${fmt(produced)} · Aprovadas: ${fmt(point.approved)} · Rej. máquina: ${fmt(rejected)} · Rej. qualidade: ${fmt(quality)}${produced ? ` (${core.formatPercent(point.approvalRate)} de aprovação)` : ''}`;
        parts.push(`<g><title>${summary}</title>`);
        trio.forEach(([key, color], barIndex) => {
          const value = point[key] || 0;
          if (!value) return;
          const barHeight = Math.max(2.5, (value / apex) * plotHeight);
          const x = x0 + barIndex * (barWidth + gap);
          const y = height - bottom - barHeight;
          parts.push(`<rect x="${round(x)}" y="${round(y)}" width="${round(barWidth)}" height="${round(barHeight)}" rx="${Math.min(2.5, settings.radius || 3)}" fill="${color}"/>`);
          if (showValues) {
            parts.push(`<text x="${round(x + barWidth / 2)}" y="${round(y - font(5))}" text-anchor="middle" font-size="${font(8)}" font-weight="600" fill="#16241b">${fmt(value)}</text>`);
          }
        });
        if (index % labelEvery === 0) {
          parts.push(`<text x="${round(left + index * slot + slot / 2)}" y="${height - font(7)}" text-anchor="middle" font-size="${font(10)}" fill="#5b6b5f">${escapeHtml(point.label)}</text>`);
        }
        parts.push('</g>');
      });
    } else {
      const color = CHART_METRICS[shownMetric].color;
      const barWidth = Math.min(40 * fontScale, Math.max(10, slot - 14));
      shown.forEach((point, index) => {
        const amount = metricValue(point);
        const x = left + index * slot + (slot - barWidth) / 2;
        const barHeight = amount ? Math.max(2.5, (amount / apex) * plotHeight) : 0;
        const y = height - bottom - barHeight;
        parts.push(`<g><title>${escapeHtml(point.full)} — ${escapeHtml(CHART_METRICS[shownMetric].label)}: ${fmt(amount)}${point.produced ? ` de ${fmt(point.produced)} produzidas` : ''}</title>`
          + `<rect x="${round(x)}" y="${round(y)}" width="${round(barWidth)}" height="${round(barHeight)}" rx="${settings.radius || 3}" fill="${color}"/>`
          + (barHeight && barLabel ? `<text x="${round(x + barWidth / 2)}" y="${round(y - font(6))}" text-anchor="middle" font-size="${font(10)}" font-weight="600" fill="#16241b">${fmt(amount)}</text>` : '')
          + (index % labelEvery === 0 ? `<text x="${round(x + barWidth / 2)}" y="${height - font(7)}" text-anchor="middle" font-size="${font(10)}" fill="#5b6b5f">${escapeHtml(point.label)}</text>` : '')
          + '</g>');
      });
    }

    parts.push('</svg>');
    const holder = el('div', { class: 'chart-holder' });
    holder.innerHTML = parts.join('');
    return holder;
  }

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  /* ------------------------------------------------------ lupa do gráfico --- */

  const ZOOM_MIN = 1, ZOOM_MAX = 6, ZOOM_NATURAL_W = 1160, ZOOM_NATURAL_H = 576;
  const zoomState = { scale: 1, x: 0, y: 0, pointers: new Map(), lastDistance: 0, lastMiddle: null };
  let zoomSource = 'panel';          // 'panel' — painel; 'report' — pré-visualização do relatório
  let zoomLastTrigger = null;

  const chartZoomNode = () => $('chartZoom');

  /** O que a lupa mostra, conforme o botão que a abriu. */
  function currentZoomChart() {
    if (zoomSource === 'report' && app.generated) {
      const { comparison, rejection } = app.generated;
      const title = comparison ? comparisonTitle()
        : rejection === 'machine' ? 'Evolução das rejeições da máquina'
        : rejection === 'quality' ? 'Evolução das rejeições no teste de qualidade'
        : 'Evolução';
      return { title, points: reportChartPoints(), metric: paperChartMetric(),
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

  const rateClass = (rate) => (rate === null ? '' : rate >= 90 ? 'is-ok' : rate >= 80 ? 'is-warn' : 'is-bad');

  /** Tabela usada no painel (leitura) e nos registos (com acções). */
  function dataTable(summary, withActions) {
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
    const columns = el('tr', {}, [
      numberColumn('produzidas'), numberColumn('rej. máquina'), numberColumn('rej. qualidade'),
      numberColumn('produzidas'), numberColumn('rej. máquina'), numberColumn('rej. qualidade'),
      numberColumn('produzidas'), numberColumn('aprovadas'), numberColumn('aprovação'),
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
      cells.push(el('td', { class: 'is-number', text: fmt(totals.approved) }));
      cells.push(el('td', { class: 'is-number' }, el('span', { class: `rate ${rateClass(totals.approvalRate)}`, text: core.formatPercent(totals.approvalRate) })));
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
      el('td', { class: 'is-number', text: fmt(summary.produced) }),
      el('td', { class: 'is-number', text: fmt(summary.approved) }),
      el('td', { class: 'is-number' }, el('span', { class: `rate ${rateClass(summary.approvalRate)}`, text: core.formatPercent(summary.approvalRate) })),
      el('td', { class: 'is-note', text: `${fmt(summary.records.length)} ${summary.records.length === 1 ? 'registo' : 'registos'}` }),
    ]);
    if (withActions) { total.append(el('td', {})); }
    return el('table', {}, [el('thead', {}, [head, columns]), el('tbody', {}, [...rows, total])]);
  }

  /* ------------------------------------------------------- vista registos --- */

  function renderRecords() {
    const years = [...new Set(app.state.records.map((record) => record.start.slice(0, 4)))].sort().reverse();
    if (!years.includes(app.recordsYear)) app.recordsYear = years[0] || today().slice(0, 4);
    fill($('recordsYear'), ...[
      el('option', { value: '', text: 'Todos os anos', selected: app.recordsYear === '' }),
      ...years.map((year) => el('option', { value: year, text: year, selected: year === app.recordsYear })),
    ]);
    const records = app.recordsYear ? app.state.records.filter((record) => record.start.slice(0, 4) === app.recordsYear) : app.state.records;
    const state = { version: core.VERSION, records };
    const start = records.length ? records.reduce((min, record) => (record.start < min ? record.start : min), records[0].start) : today();
    const end = records.length ? records.reduce((max, record) => (record.end > max ? record.end : max), records[0].end) : today();
    const summary = core.summarise(state, start, end);
    summary.label = app.recordsYear || 'Todos os registos';
    fill($('recordsTable'), dataTable(summary, true));
  }

  /* ----------------------------------------------------- vista relatórios --- */


  function renderReportControls() {
    const kind = app.report.kind;
    const dateField = (label, id, value, type, min, max) => el('label', { class: 'field' }, [
      label,
      el('input', { type, id, value, min, max, onchange: (event) => { app.report[id.replace('report', '').toLowerCase()] = event.target.value; renderReport(); } }),
    ]);
    /** Campo da comparação: escreve directo no estado, sem depender do id. */
    const pickField = (label, key, type, min, max) => el('label', { class: 'field' }, [
      label,
      el('input', {
        type, value: app.report[key], min, max, 'aria-label': label,
        onchange: (event) => { app.report[key] = event.target.value; renderReport(); },
      }),
    ]);
    const fields = [];
    if (kind === 'day' || kind === 'week') {
      fields.push(dateField(kind === 'week' ? 'Data da semana' : 'Dia', 'reportDate', app.report.date, 'date', core.FIRST, core.LAST));
    }
    if (kind === 'month') fields.push(dateField('Mês', 'reportMonth', app.report.month, 'month', '1900-01', '2200-12'));
    if (kind === 'range' || kind === 'rejectionMachine' || kind === 'rejectionQuality') {
      fields.push(dateField('De', 'reportStart', app.report.start, 'date', core.FIRST, core.LAST));
      fields.push(dateField('Até', 'reportEnd', app.report.end, 'date', core.FIRST, core.LAST));
    }
    const comparing = kind === 'months' || kind === 'years';
    if (kind === 'months') {
      fields.push(pickField('Mês 1', 'compareA', 'month', '1900-01', '2200-12'));
      fields.push(pickField('Mês 2', 'compareB', 'month', '1900-01', '2200-12'));
    }
    if (kind === 'years') {
      fields.push(pickField('Ano 1', 'yearsA', 'number', 1900, 2200));
      fields.push(pickField('Ano 2', 'yearsB', 'number', 1900, 2200));
    }
    if (comparing) fields.push(el('span', { class: 'report-info' }, [infoButton('compare')]));
    fill($('reportDates'), ...fields);
  }

  /** Os dois períodos da comparação, pela ordem escolhida: Mês 1 e Mês 2 (ou Ano 1 e Ano 2). */
  function reportComparison() {
    return app.report.kind === 'years'
      ? core.comparePeriods('years', app.report.yearsA, app.report.yearsB)
      : core.comparePeriods('months', app.report.compareA, app.report.compareB);
  }

  const comparisonTitle = () => (app.report.kind === 'years' ? 'Comparação de anos' : 'Comparação de meses');

  function reportPeriod() {
    const { kind } = app.report;
    if (kind === 'week') return core.weekRange(app.report.date);
    if (kind === 'month') return core.monthRange(app.report.month);
    if (kind === 'range') {
      if (!core.isDate(app.report.start) || !core.isDate(app.report.end)) throw new Error('Escolhe as duas datas do período.');
      if (app.report.end < app.report.start) throw new Error('A data final não pode ser anterior à data de início.');
      return { start: app.report.start, end: app.report.end };
    }
    if (!core.isDate(app.report.date)) throw new Error('Escolhe o dia do relatório.');
    return { start: app.report.date, end: app.report.date };
  }

  const rejectionKind = (kind) => (kind === 'rejectionMachine' ? 'machine' : kind === 'rejectionQuality' ? 'quality' : null);
  const rejectionTitle = (type) => (type === 'machine' ? 'Relatório de rejeição da máquina' : 'Relatório de rejeição no teste de qualidade');
  const rejectionSuffix = (type) => (type === 'machine' ? 'rejeicao-maquina' : 'rejeicao-qualidade');

  function buildReport() {
    const kind = kindOfReport();
    const comparing = kind === 'months' || kind === 'years';
    const rejection = rejectionKind(kind);
    let period, comparison = null;
    try {
      if (comparing) {
        comparison = core.compare(app.state, reportComparison());
        period = { start: comparison.start, end: comparison.end };
      } else if (rejection) {
        if (!core.isDate(app.report.start) || !core.isDate(app.report.end)) throw new Error('Escolhe as duas datas do período.');
        if (app.report.end < app.report.start) throw new Error('A data final não pode ser anterior à data de início.');
        period = { start: app.report.start, end: app.report.end };
      } else {
        period = reportPeriod();
      }
    } catch (error) {
      $('reportHint').textContent = error.message;
      $('reportHint').classList.add('is-error');
      return null;
    }
    $('reportHint').classList.remove('is-error');
    const summary = core.summarise(app.state, period.start, period.end);
    summary.label = reportLabel(kind, period, comparison);
    // na comparação, as notas e os registos vêm de cada lado em separado — nunca do intervalo entre eles
    const periodSummaries = comparing ? comparison.rows.map((row) => core.summarise(app.state, row.start, row.end)) : null;
    const tags = comparing ? core.compareTags(comparison) : null;
    const comparisonNotes = periodSummaries ? periodSummaries
      .flatMap((periodSummary, index) => periodSummary.records
        .filter((record) => record.notes)
        .map((record) => {
          const span = core.periodLabel(record.start, record.end);
          // um registo de mês inteiro não precisa de repetir o período — o nome do período já o diz
          const sameMonth = /^\d{2}\/\d{4}$/.test(span) && span === core.monthLabel(record.start.slice(0, 7));
          return sameMonth ? `${tags[index]} — ${record.notes}` : `${tags[index]} · ${span} — ${record.notes}`;
        })) : null;
    return {
      summary,
      comparison,
      periodSummaries,
      rejection,
      notes: comparisonNotes || noteList(summary),
      outsideCount: comparing ? comparison.rows.reduce((total, row) => total + row.outside, 0) : summary.outside.length,
      // períodos longos leem-se melhor por mês; até 45 dias cabe um registo por barra
      series: comparison ? comparison.series : core.series(app.state, period.start, period.end, (kind === 'month' || core.daysBetween(period.start, period.end) > 45) ? 'month' : 'record'),
      generated: stamp(),
    };
  }
  const kindOfReport = () => app.report.kind;

  /** Cada tipo de relatório pede o seu próprio rótulo legível. */
  function reportLabel(kind, period, comparison) {
    if (kind === 'day') return core.longDate(period.start);
    if (kind === 'week') return `Semana de ${core.shortDate(period.start)}`;
    if (kind === 'month') return core.monthLabel(period.start.slice(0, 7));
    if (rejectionKind(kind)) return core.periodLabel(period.start, period.end);
    if (kind === 'months' || kind === 'years') {
      const rows = comparison ? comparison.rows : [];
      const vs = rows.length === 2 ? `${rows[0].name || rows[0].label} × ${rows[1].name || rows[1].label}` : (rows[0] || {}).label;
      return `${kind === 'years' ? 'Comparação de anos' : 'Comparação de meses'} · ${vs || core.periodLabel(period.start, period.end)}`;
    }
    return core.periodLabel(period.start, period.end);
  }

  function renderReport() {
    app.generated = buildReport();
    $('reportWrap').hidden = !app.generated;
    if (app.generated) renderPaper();
    refreshOpenZoom('report');
  }

  /** Refaz o gráfico da lupa quando os dados mudam com ela aberta. */
  function refreshOpenZoom(source) {
    if (chartZoomNode().hidden || zoomSource !== source) return;
    $('chartZoomTitle').textContent = currentZoomChart().title;
    renderZoomedChart();
  }

  const noteList = (summary) => summary.records.filter((record) => record.notes)
    .map((record) => `${core.periodLabel(record.start, record.end)} — ${record.notes}`);

  /** Indicador do gráfico do relatório: a rejeição quando é relatório de rejeição. */
  const paperChartMetric = () => {
    const { rejection } = app.generated || {};
    return rejection === 'machine' ? 'rejected' : rejection === 'quality' ? 'qualityRejected' : 'produced';
  };

  /** Série do gráfico do relatório; na comparação, com as etiquetas curtas dos períodos. */
  function reportChartPoints() {
    const { comparison, series } = app.generated;
    if (!comparison) return series || [];
    return comparison.series.map((point, index) => ({
      ...point, label: (comparison.rows[index] && comparison.rows[index].short) || point.label,
    }));
  }

  /** Indicadores da folha: producção (5) ou rejeição (5), conforme o relatório. */
  function paperCards() {
    const { summary, rejection } = app.generated;
    if (rejection === 'machine' || rejection === 'quality') {
      const chosen = rejection === 'machine' ? summary.rejected : summary.qualityRejected;
      const chosenRate = rejection === 'machine' ? summary.rejectionRate : summary.qualityRejectionRate;
      const totalScrapped = summary.rejected + summary.qualityRejected;
      const share = core.percent(chosen, totalScrapped);
      return [
        { label: 'Produzidas', value: fmt(summary.produced) },
        { label: rejection === 'machine' ? 'Rej. máquina' : 'Rej. qualidade', value: fmt(chosen),
          tone: chosen ? 'is-bad' : '' },
        { label: 'Taxa desta rejeição', value: core.formatPercent(chosenRate) },
        { label: 'Do total rejeitado', value: share === null ? '—' : core.formatPercent(share) },
        { label: 'Aprovação', value: core.formatPercent(summary.approvalRate), tone: 'is-ok' },
      ];
    }
    return [
      { label: 'Produzidas', value: fmt(summary.produced) },
      { label: 'Aprovadas', value: fmt(summary.approved), tone: 'is-ok' },
      { label: 'Rej. máquina', value: fmt(summary.rejected), tone: summary.rejected ? 'is-bad' : '' },
      { label: 'Rej. qualidade', value: fmt(summary.qualityRejected), tone: summary.qualityRejected ? 'is-bad' : '' },
      { label: 'Registos', value: fmt(summary.records.length) },
    ];
  }

  /** Tabela «lado a lado» da comparação: Mês 1, Mês 2 e a diferença (2.º − 1.º). */
  function comparisonSideBySide(comparison) {
    const [a, b] = comparison.rows;
    const tags = core.compareTags(comparison);
    const rate = (value) => (value === null || value === undefined ? '—' : core.formatPercent(value));
    const gap = (key) => {
      const first = a[key], second = b[key];
      if (first === null || second === null || first === undefined || second === undefined) return null;
      return Math.round((second - first) * 10) / 10;
    };
    const numGap = (key) => b[key] - a[key];
    // verde quando o movimento é bom (mais producção, menos rejeição), vermelho quando não é
    const tone = (diff, invert) => (diff === null || diff === undefined || diff === 0
      ? '' : diff > 0 ? (invert ? 'is-bad' : 'is-good') : (invert ? 'is-good' : 'is-bad'));
    const rateGapText = (value) => (value === null ? '—' : signed(value, ' p.'));
    const metricRow = (label, aText, bText, diffText, diffTone) => el('tr', {}, [
      el('td', { text: label }),
      el('td', { class: 'is-number', text: aText }),
      el('td', { class: 'is-number', text: bText }),
      el('td', { class: `is-number${diffTone ? ' ' + diffTone : ''}`.trim(), text: diffText }),
    ]);
    const rows = [
      metricRow('Registos', fmt(a.records), fmt(b.records), signed(numGap('records')), tone(numGap('records'), false)),
      metricRow('Produzidas', fmt(a.produced), fmt(b.produced), signed(numGap('produced')), tone(numGap('produced'), false)),
      metricRow('Aprovadas', fmt(a.approved), fmt(b.approved), signed(numGap('approved')), tone(numGap('approved'), false)),
      metricRow('Rej. máquina', fmt(a.rejected), fmt(b.rejected), signed(numGap('rejected')), tone(numGap('rejected'), true)),
      metricRow('Rej. qualidade', fmt(a.qualityRejected), fmt(b.qualityRejected), signed(numGap('qualityRejected')), tone(numGap('qualityRejected'), true)),
      metricRow('Taxa rej. máquina', rate(a.rejectionRate), rate(b.rejectionRate), rateGapText(gap('rejectionRate')), tone(gap('rejectionRate'), true)),
      metricRow('Taxa rej. qualidade', rate(a.qualityRejectionRate), rate(b.qualityRejectionRate), rateGapText(gap('qualityRejectionRate')), tone(gap('qualityRejectionRate'), true)),
      metricRow('Aprovação', rate(a.approvalRate), rate(b.approvalRate), rateGapText(gap('approvalRate')), tone(gap('approvalRate'), false)),
      metricRow('Cartas por dia', fmt(a.perDay), fmt(b.perDay), signed(numGap('perDay')), tone(numGap('perDay'), false)),
      metricRow('Dias com registo', `${fmt(a.daysCovered)} de ${fmt(a.days)}`, `${fmt(b.daysCovered)} de ${fmt(b.days)}`,
        signed(numGap('daysCovered'), ' dias'), tone(numGap('daysCovered'), false)),
    ];
    const head = el('tr', {}, ['Métrica', a.label, b.label, 'Diferença'].map((label, index) =>
      el('th', { class: index ? 'is-number' : '', text: label })));
    return el('div', {}, [
      el('h4', { class: 'paper-title', text: `Lado a lado — ${tags[0]} e ${tags[1]}` }),
      el('table', { class: 'paper-table is-compare' }, [el('thead', {}, head), el('tbody', {}, rows)]),
    ]);
  }

  /** Máquina a máquina, cada lado do seu lado: duas linhas por período, com os totais. */
  function comparisonMachines(comparison) {
    const tags = core.compareTags(comparison);
    const [a, b] = comparison.rows;
    const rows = [];
    [a, b].forEach((period, index) => {
      period.machines.forEach((machine, machineIndex) => {
        rows.push([tags[index], core.MACHINES[machineIndex], fmt(machine.produced), fmt(machine.approved),
          fmt(machine.rejected), fmt(machine.qualityRejected), core.formatPercent(machine.approvalRate)]);
      });
      rows.push([tags[index], 'Total', fmt(period.produced), fmt(period.approved),
        fmt(period.rejected), fmt(period.qualityRejected), core.formatPercent(period.approvalRate)]);
    });
    return paperTable(`Por máquina — ${tags.join(' × ')}`,
      ['Período', 'Origem', 'Produzidas', 'Aprovadas', 'Rej. máquina', 'Rej. qualidade', 'Aprovação'],
      rows,
      { marks: rows.map((row) => (row[1] === 'Total' ? 'is-total' : '')) });
  }

    /** Cartões com rótulo pequeno por baixo do valor, quando se justifica. */
  const MACHINE_HEADERS = ['Origem', 'Produzidas', 'Aprovadas', 'Rej. máquina', 'Rej. qualidade', 'Aprovação'];
  const RECORD_HEADERS = ['Período', ...MACHINE_HEADERS.slice(1)];

  function renderPaper() {
    const { summary, notes, comparison, rejection, outsideCount } = app.generated;
    const comparisonRecords = comparison ? comparison.rows.reduce((total, row) => total + row.records, 0) : 0;
    $('reportHint').textContent = comparison
      ? `${fmt(comparison.rows.length)} períodos lado a lado · `
        + `${fmt(comparisonRecords)} ${comparisonRecords === 1 ? 'registo somado' : 'registos somados'} · `
        + `${fmt(comparison.measured)} com producção`
      : summary.records.length
        ? `${fmt(summary.records.length)} ${summary.records.length === 1 ? 'registo somado' : 'registos somados'} · ${fmt(summary.daysCovered)} de ${fmt(summary.days)} dias com registo`
        : 'Sem registos neste período: o relatório mostra só os zeros do cabeçalho.';
    $('reportWrap').hidden = false;
    fill($('paper'),
      el('div', { class: 'paper-head' }, [
        el('div', { class: 'paper-brand' }, [
          el('img', { class: 'paper-logo', src: 'inatro.png', alt: 'INATRO, IP — Instituto Nacional dos Transportes Rodoviários', width: 196, height: 64 }),
        ]),
        el('div', { class: 'paper-meta' }, [
          el('h3', { text: rejection ? rejectionTitle(rejection) : 'Relatório de producção' }),
          el('p', { text: summary.label }),
          el('p', { class: 'is-muted', text: `Gerado em ${app.generated.generated}` }),
        ]),
      ]),
      comparison ? '' : el('div', { class: 'paper-kpis' }, paperCards().map((card) => el('div', { class: `paper-kpi ${card.tone || ''}`.trim() }, [
        el('span', { text: card.label }), el('strong', { text: card.value }),
      ]))),
      comparison ? el('div', { class: 'compare-block' }, [comparisonSideBySide(comparison), comparisonMachines(comparison)])
        : paperTable('Por máquina', MACHINE_HEADERS, [
          ...summary.machines.map((machine, index) => [
            core.MACHINES[index], fmt(machine.produced), fmt(machine.approved), fmt(machine.rejected), fmt(machine.qualityRejected), core.formatPercent(machine.approvalRate),
          ]),
          ['Total', fmt(summary.produced), fmt(summary.approved), fmt(summary.rejected), fmt(summary.qualityRejected), core.formatPercent(summary.approvalRate)],
        ], { totalLast: true }),
      comparison && core.compareReading(comparison)
        ? el('p', { class: 'paper-note', text: core.compareReading(comparison) }) : '',
      // título e gráfico viajam juntos: sem isto o título fica órfão numa página e o gráfico vai na seguinte
      el('div', { class: 'paper-block' }, [
        el('h4', { class: 'paper-title',
          text: comparison ? comparisonTitle()
            : rejection === 'machine' ? 'Evolução das rejeições da máquina'
            : rejection === 'quality' ? 'Evolução das rejeições no teste de qualidade'
            : 'Evolução' }),
        el('div', { class: 'paper-chart' }, chartBars(reportChartPoints(), paperChartMetric(), { unit: comparison ? 'período' : 'registo', maxPoints: Infinity })),
      ]),
      !comparison && summary.records.length
        ? paperTable('Registos somados', RECORD_HEADERS, summary.records.map((record) => {
          const recordTotals = core.totals(record);
          return [core.periodLabel(record.start, record.end), fmt(recordTotals.produced), fmt(recordTotals.approved), fmt(recordTotals.rejected), fmt(recordTotals.qualityRejected), core.formatPercent(recordTotals.approvalRate)];
        }))
        : !comparison ? el('p', { class: 'paper-empty', text: 'Não há registos somados neste período.' }) : '',
      outsideCount
        ? el('p', { class: 'paper-note' }, [
          el('span', { text: `${fmt(outsideCount)} ${outsideCount === 1 ? 'registo ficou' : 'registos ficaram'} fora ${comparison ? 'destes períodos' : 'deste período'} e não foram somados.` }),
          infoButton('outside'),
        ])
        : '',
      notes.length ? el('div', { class: 'paper-notes' }, [el('h4', { text: 'Notas' }), el('ul', {}, notes.map((line) => el('li', { text: line })))]) : '',
    );
  }

  /** Tabela do relatório em papel: título, cabeçalho e linhas de texto. */
  function paperTable(title, headers, rows, options = {}) {
    const body = options.total ? [...rows, options.total] : rows;
    const isLast = (index) => (options.totalLast || options.total) && index === body.length - 1;
    const head = el('tr', {}, headers.map((label, index) => el('th', { class: index ? 'is-number' : '', text: label })));
    return el('div', {}, [
      el('h4', { class: 'paper-title', text: title }),
      el('table', { class: 'paper-table' }, [
        el('thead', {}, head),
        el('tbody', {}, body.map((cells, index) => el('tr', {
          class: `${isLast(index) ? 'is-total' : ''} ${(options.marks && options.marks[index]) || ''}`.trim(),
        }, cells.map((value, cell) => el('td', { class: cell ? 'is-number' : '', text: value }))))),
      ]),
    ]);
  }

  /* --------------------------------------------------------- formulário --- */

  function openForm(period, recordId, presetDate) {
    if (!app.ready) { toast('Aguarda que os registos sejam abertos.'); return; }
    const record = recordId ? app.state.records.find((item) => item.id === recordId) : null;
    app.editing = record ? record.id : null;
    app.formPeriod = record ? record.period : (period in PERIOD_NAMES ? period : 'day');
    $('dialogTitle').textContent = record ? 'Editar registo' : 'Novo registo';
    $('dialogSave').textContent = record ? 'Guardar alterações' : 'Guardar registo';
    showFormError('');
    $('recordNotes').value = record ? record.notes || '' : '';
    const source = record || { start: presetDate || today(), end: presetDate || today() };

    fill($('periodTabs'), ...core.PERIODS.map((key) => el('button', {
      type: 'button', class: key === app.formPeriod ? 'is-on' : '', dataset: { period: key }, text: PERIOD_NAMES[key],
    })));
    $('recordDate').value = app.formPeriod === 'day' ? source.start : today();
    $('recordMonth').value = app.formPeriod === 'month' ? source.start.slice(0, 7) : thisMonth();
    $('recordStart').value = app.formPeriod === 'range' ? source.start : today();
    $('recordEnd').value = app.formPeriod === 'range' ? source.end : today();

    fill($('machineInputs'), ...core.MACHINES.map((name, index) => el('div', { class: 'machine-input' }, [
      el('span', { class: 'machine-name', text: name }),
      ...[
        { key: 'produced', label: 'Produzidas', suffix: 'p', aria: 'produzidas', placeholder: '0' },
        { key: 'rejected', label: 'Rej. máquina', suffix: 'r', aria: 'rejeitadas pela máquina', placeholder: '0' },
        { key: 'qualityRejected', label: 'Rej. qualidade', suffix: 'q', aria: 'rejeitadas no teste de qualidade', placeholder: '0' },
      ].map((field) => el('label', {}, [
        field.label,
        el('input', {
          id: `m${index}${field.suffix}`, type: 'number', min: 0, max: core.MAX_QUANTITY, step: 1, inputmode: 'numeric',
          value: record ? record.machines[index][field.key] : '', placeholder: field.placeholder,
          'aria-label': `${name} — ${field.aria}`,
        }),
      ])),
    ])));

    syncFormFields();
    updateLive();
    $('recordDialog').showModal();
    const focusTarget = app.formPeriod === 'day' ? $('recordDate') : $(`m0p`);
    if (focusTarget && focusTarget.focus) focusTarget.focus();
  }

  function syncFormFields() {
    $('dateDay').hidden = app.formPeriod !== 'day';
    $('recordMonthField').hidden = app.formPeriod !== 'month';
    $('recordStartField').hidden = app.formPeriod !== 'range';
    $('recordEndField').hidden = app.formPeriod !== 'range';
    document.querySelectorAll('#periodTabs button').forEach((button) => button.classList.toggle('is-on', button.dataset.period === app.formPeriod));
  }

  function readForm() {
    const start = app.formPeriod === 'day' ? $('recordDate').value
      : app.formPeriod === 'month' ? $('recordMonth').value : $('recordStart').value;
    return core.makeRecord({
      id: app.editing,
      period: app.formPeriod,
      start,
      end: $('recordEnd').value,
      machines: core.MACHINES.map((_, index) => ({ produced: $(`m${index}p`).value, rejected: $(`m${index}r`).value, qualityRejected: $(`m${index}q`).value })),
      notes: $('recordNotes').value,
    });
  }

  function showFormError(message) {
    const node = $('formError');
    if (!node) return;
    node.textContent = message || '';
    node.hidden = !message;
  }

  function updateLive() {
    try {
      const record = readForm();
      const totals = core.totals(record);
      showFormError('');
      fill($('liveResult'), ...[
        { label: 'Aprovadas', value: fmt(totals.approved), tone: 'is-ok' },
        { label: 'Rej. máquina', value: fmt(totals.rejected), tone: totals.rejected ? 'is-bad' : '' },
        { label: 'Rej. qualidade', value: fmt(totals.qualityRejected), tone: totals.qualityRejected ? 'is-bad' : '' },
        { label: 'Aprovação', value: core.formatPercent(totals.approvalRate), tone: rateClass(totals.approvalRate) },
      ].map((cell) => el('div', {}, [el('span', { text: cell.label }), el('strong', { class: cell.tone, text: cell.value })])));
    } catch (error) {
      fill($('liveResult'), el('p', { class: 'live-empty', text: error.message }));
      showFormError(error.message);
    }
  }
  const liveBound = guard('pré-visualização', () => updateLive());

  async function submitForm(event) {
    event.preventDefault();
    let record;
    try {
      record = readForm();
    } catch (error) {
      showFormError(error.message);
      return;
    }
    const clash = core.overlapping(app.state.records, record);
    if (clash) {
      showFormError(`Já existe um registo entre ${core.periodLabel(clash.start, clash.end)}. Edita-o, em vez de criar outro, ou ajusta as datas.`);
      return;
    }
    const next = { version: core.VERSION, records: [...app.state.records.filter((item) => item.id !== record.id), record] };
    try {
      core.validate(next);
    } catch (error) {
      showFormError(error.message);
      return;
    }
    if (await tryPersist(next, app.editing ? 'Registo actualizado.' : 'Registo guardado.')) {
      $('recordDialog').close();
      app.editing = null;
      focusPeriod(record);
      showView('panel');
    }
  }

  /** Põe o filtro do painel em cima do registo que acabou de ser guardado. */
  function focusPeriod(record) {
    app.filter.mode = record.period === 'month' ? 'month' : 'period';
    app.filter.month = record.start.slice(0, 7);
    app.filter.start = record.start;
    app.filter.end = record.end;
    syncFilterControls();
  }

  function deleteRecord(record) {
    confirmDialog('Eliminar registo?',
      `Vai apagar o registo de ${core.periodLabel(record.start, record.end)}. Exporta uma cópia antes, se precisares de o recuperar.`,
      'Eliminar',
      () => tryPersist({ version: core.VERSION, records: app.state.records.filter((item) => item.id !== record.id) }, 'Registo eliminado.'));
  }

  /* ------------------------------------------------------- confirmações --- */

  let confirmAction = null;
  function confirmDialog(title, text, actionLabel, action) {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmYes').textContent = actionLabel;
    confirmAction = action;
    $('confirmDialog').showModal();
  }

  /* ------------------------------------------------- cópias e exemplo --- */

  function download(name, data, type) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const link = el('a', { href: url, download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  const exportCopy = guard('exportar cópia', () => {
    download(`contacarta-registos-${fileDate(today())}.json`, `${JSON.stringify(app.state, null, 2)}\n`, 'application/json;charset=utf-8');
    toast('Cópia exportada com os registos deste computador.');
  });

  async function importCopy(file) {
    try {
      if (!file) return;
      if (file.size > 5_000_000) throw new Error('A cópia é grande de mais (limite de 5 MB).');
      const text = await file.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (_) {
        throw new Error('O ficheiro não é JSON válido. Escolhe uma cópia exportada pelo Conta Carta.');
      }
      const state = normaliseImport(payload);
      confirmDialog('Importar cópia?',
        `O ficheiro tem ${fmt(state.records.length)} ${state.records.length === 1 ? 'registo' : 'registos'} e vai substituir os actuais.`,
        'Importar',
        () => tryPersist(state, 'Cópia importada.').then(lookAtLatest));
    } catch (error) {
      reportError(`importação: ${error.message}`);
      toast(error.message);
    } finally {
      $('fileInput').value = '';
    }
  }

  const hasSample = () => app.state.records.some((record) => record.id.startsWith(SAMPLE_PREFIX));

  /** Depois de importar ou carregar o exemplo, mostra logo o mês onde há dados. */
  function lookAtLatest() {
    app.filter.mode = 'month';
    seedFilters(true);
    syncFilterControls();
    render();
  }

  const toggleSample = guard('dados fictícios', async () => {
    if (hasSample()) {
      confirmDialog('Remover dados fictícios?', 'Saem só os registos de exemplo; os teus ficam.', 'Remover',
        () => tryPersist({ version: core.VERSION, records: app.state.records.filter((record) => !record.id.startsWith(SAMPLE_PREFIX)) }, 'Dados fictícios removidos.').then(lookAtLatest));
      return;
    }
    const response = await fetch('sample.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Não foi possível ler o exemplo incluído na aplicação.');
    const sample = core.validate(await response.json());
    // os dias já ocupados pelos teus registos nunca são tocados: o exemplo entra ao lado, menos o que coincide
    const occupied = (record) => app.state.records.some((own) => record.start <= own.end && own.start <= record.end);
    const fresh = sample.records.filter((record) => !occupied(record));
    const skipped = sample.records.length - fresh.length;
    const skippedNote = skipped ? ` ${fmt(skipped)} coincidem com registos que já tens e ficam de fora.` : '';
    if (!fresh.length) {
      toast('Nada a acrescentar: todos os registos fictícios coincidem com os teus.');
      return;
    }
    confirmDialog('Ver com dados fictícios?',
      `Vão entrar ${fmt(fresh.length)} registos fictícios, ao lado dos teus.${skippedNote}`,
      'Carregar',
      () => tryPersist({ version: core.VERSION, records: [...app.state.records, ...fresh] },
        `Exemplo carregado${skipped ? ` (${fmt(fresh.length)} de ${fmt(sample.records.length)})` : ''}. Podes removê-lo quando quiseres.`).then(lookAtLatest));
  });

  /* --------------------------------------------------------- exportações --- */

  /** Datas em nomes de ficheiro: dia-mês-ano com hífenes (as barras não são permitidas). */
  const fileDate = (iso) => iso.split('-').reverse().join('-');
  const fileKey = (key) => (key.split('-').length === 2 ? `${key.slice(5, 7)}-${key.slice(0, 4)}` : key);

  /** Nome e título do ficheiro exportado, conforme o tipo de relatório. */
  const exportMeta = (report) => {
    const { comparison, rejection, summary } = report;
    if (comparison) {
      return { suffix: '-comparacao', title: 'Relatório de producção',
        base: `contacarta-${fileKey(comparison.rows[0].key)}-vs-${fileKey(comparison.rows[1].key)}` };
    }
    if (rejection) return { suffix: `-${rejectionSuffix(rejection)}`, title: rejectionTitle(rejection),
      base: `contacarta-${fileDate(summary.start)}-a-${fileDate(summary.end)}` };
    return { suffix: '', title: 'Relatório de producção',
      base: `contacarta-${fileDate(summary.start)}-a-${fileDate(summary.end)}` };
  };

  /** Monta o PDF do relatório (o mesmo ficheiro para exportar e para imprimir). */
  async function buildReportPdf(report) {
    await logoPreload;
    const { summary, comparison, rejection } = report;
    const meta = exportMeta(report);
    const comparisonRecords = comparison ? comparison.rows.reduce((total, row) => total + row.records, 0) : 0;
    const scope = [comparison
      ? `${fmt(comparisonRecords)} ${comparisonRecords === 1 ? 'registo somado' : 'registos somados'} · ${comparison.rows.map((row) => row.name || row.label).join(' × ')}`
      : `${fmt(summary.records.length)} ${summary.records.length === 1 ? 'registo somado' : 'registos somados'} · ${fmt(summary.daysCovered)} de ${fmt(summary.days)} dias com registo`];
    const SCOPE_NAMES = { day: 'relatório diário', week: 'visão semanal', month: 'visão mensal', range: 'visão de período' };
    if (rejection) scope.push(meta.title.toLowerCase());
    else if (!comparison) scope.push(SCOPE_NAMES[kindOfReport()] || 'visão de período');
    if (comparison) {
      const outside = comparison.rows.reduce((total, row) => total + row.outside, 0);
      if (outside) scope.push(`${fmt(outside)} registos fora destes períodos não foram somados.`);
    }
    else if (summary.outside.length) scope.push(`${fmt(summary.outside.length)} registos fora deste período não foram somados.`);
    const bytes = pdf.build({
      summary,
      label: summary.label,
      title: meta.title,
      rejection,
      generated: report.generated,
      scope: scope.join(' — '),
      series: report.series || core.series(app.state, summary.start, summary.end, 'record'),
      seriesTitle: rejection === 'machine' ? 'Evolução das rejeições da máquina' : rejection === 'quality' ? 'Evolução das rejeições no teste de qualidade' : 'Evolução',
      seriesMetric: rejection === 'machine' ? 'rejected' : rejection === 'quality' ? 'qualityRejected' : 'produced',
      comparison,
      comparisonTitle: comparison ? comparisonTitle() : null,
      notes: report.notes,
      logo: app.logo || undefined,
    });
    return { bytes, fileName: `${meta.base}${meta.suffix}.pdf` };
  }

  const exportPdf = guard('exportar PDF', async () => {
    const report = app.generated || buildReport();
    if (!report) { toast('Escolhe o período do relatório primeiro.'); return; }
    const { bytes, fileName } = await buildReportPdf(report);
    download(fileName, bytes, 'application/pdf');
    toast('Relatório em PDF guardado.');
  });

  /**
   * Imprime o PDF gerado pela aplicação — nunca a página do navegador. O
   * diálogo de impressão do navegador carimba no papel a data, o endereço
   * («localhost:…») e o número da página, e não há CSS que o impeça; o PDF
   * imprime exactamente o que foi desenhado, sem carimbos por cima.
   */
  const printReport = guard('imprimir', async () => {
    const report = app.generated || buildReport();
    if (!report) { toast('Escolhe o período do relatório primeiro.'); return; }
    const { bytes, fileName } = await buildReportPdf(report);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) {
      // pop-up bloqueada: descarrega o PDF — o papel sai na mesma, só muda o caminho
      download(fileName, bytes, 'application/pdf');
      toast('Pop-up bloqueada; o PDF foi guardado para imprimir.');
      return;
    }
    try { win.addEventListener('load', () => setTimeout(() => win.print(), 300), { once: true }); } catch (error) { /* alguns leitores não disparam «load» */ }
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
  });

  const exportCsv = guard('exportar CSV', () => {
    const report = app.generated || buildReport();
    if (!report) { toast('Escolhe o período do relatório primeiro.'); return; }
    const { summary, comparison, rejection } = report;
    const meta = exportMeta(report);
    const data = comparison ? core.buildCompareCSV(comparison, summary.label)
      : rejection ? core.buildRejectionCSV(summary, meta.title)
      : core.buildCSV(summary);
    download(`${meta.base}${meta.suffix}.csv`, data, 'text/csv;charset=utf-8');
    toast('CSV guardado.');
  });

  /* ------------------------------------------------------------ eventos --- */

  function syncFilterControls() {
    const monthMode = app.filter.mode === 'month';
    const yearMode = app.filter.mode === 'year';
    $('filterMonthField').hidden = !monthMode;
    $('filterYearField').hidden = !yearMode;
    $('filterPeriodField').hidden = monthMode || yearMode;
    $('stepGroup').hidden = !(monthMode || yearMode);
    document.querySelectorAll('#stepGroup button').forEach((node) => {
      const offset = Number(node.dataset.step);
      node.setAttribute('aria-label', yearMode
        ? (offset < 0 ? 'Ano anterior' : 'Ano seguinte')
        : (offset < 0 ? 'Mês anterior' : 'Mês seguinte'));
    });
    document.querySelectorAll('.filter .segmented button').forEach((button) => button.classList.toggle('is-on', button.dataset.filter === app.filter.mode));
    $('filterMonth').value = app.filter.month;
    $('filterYear').value = app.filter.year;
    $('filterStart').value = app.filter.start;
    $('filterEnd').value = app.filter.end;
  }

  /** As setas ‹ › correm meses ou anos, conforme o modo do painel. */
  function stepPeriod(offset) {
    if (app.filter.mode === 'year') {
      const year = Math.min(2200, Math.max(1900, (+app.filter.year || +today().slice(0, 4)) + offset));
      app.filter.year = String(year);
      app.filter.month = `${app.filter.year}-01`;
    } else {
      app.filter.month = core.shiftMonth(app.filter.month || thisMonth(), offset);
    }
    ({ start: app.filter.start, end: app.filter.end } = filterPeriod());
    syncFilterControls();
    render();
  }

  function wireInterface() {
    document.querySelectorAll('.nav-item').forEach((node) => node.addEventListener('click', guard('navegação', () => showView(node.dataset.view))));
    $('newRecord').addEventListener('click', () => openForm('day', null, today()));
    $('recordsAdd').addEventListener('click', () => openForm('day', null, today()));

    document.querySelectorAll('.filter .segmented button').forEach((node) => node.addEventListener('click', () => {
      app.filter.mode = node.dataset.filter;
      if (app.filter.mode === 'period' && !app.filter.start) ({ start: app.filter.start, end: app.filter.end } = core.monthRange(app.filter.month));
      if (app.filter.mode === 'year') app.filter.year = (app.filter.month || today().slice(0, 7)).slice(0, 4);
      syncFilterControls();
      render();
    }));

    $('filterMonth').addEventListener('change', (event) => {
      if (!core.isMonth(event.target.value)) { toast('Escolhe um mês válido (ano-mês).'); event.target.value = app.filter.month; return; }
      app.filter.month = event.target.value;
      ({ start: app.filter.start, end: app.filter.end } = core.monthRange(app.filter.month));
      render();
    });

    $('filterYear').addEventListener('change', (event) => {
      const year = Math.trunc(Number(event.target.value));
      if (!Number.isInteger(year) || year < 1900 || year > 2200) { toast('Escolhe um ano entre 1900 e 2200.'); event.target.value = app.filter.year; return; }
      app.filter.year = String(year);
      app.filter.month = `${year}-01`;
      ({ start: app.filter.start, end: app.filter.end } = filterPeriod());
      render();
    });

    ['filterStart', 'filterEnd'].forEach((id) => $(id).addEventListener('change', () => {
      const start = $('filterStart').value;
      const end = $('filterEnd').value;
      if (!core.isDate(start) || !core.isDate(end) || end < start) { toast('Escolhe um intervalo de datas válido.'); return; }
      app.filter.start = start;
      app.filter.end = end;
      app.filter.month = start.slice(0, 7);
      render();
    }));

    document.querySelectorAll('#stepGroup button').forEach((node) => node.addEventListener('click', guard('correr o período', () => stepPeriod(Number(node.dataset.step)))));

    document.querySelectorAll('[data-metric]').forEach((node) => node.addEventListener('click', () => {
      if (app.metric === node.dataset.metric) return;
      app.metric = node.dataset.metric;
      document.querySelectorAll('[data-metric]').forEach((other) => other.classList.toggle('is-on', other === node));
      // só o gráfico muda: o resto do painel fica quieto (nada de saltos de layout)
      renderChart();
      refreshOpenZoom('panel');
    }));

    // lupa do gráfico: abrir (botões e duplo clique), fechar e operar
    $('chartZoomOpen').addEventListener('click', guard('ampliar gráfico', () => openChartZoom('panel')));
    $('reportChartZoom').addEventListener('click', guard('ampliar gráfico', () => openChartZoom('report')));
    $('chart').addEventListener('dblclick', guard('ampliar gráfico', () => openChartZoom('panel')));
    $('zoomIn').addEventListener('click', () => zoomToCenter(1.35));
    $('zoomOut').addEventListener('click', () => zoomToCenter(1 / 1.35));
    $('zoomReset').addEventListener('click', resetZoom);
    $('zoomClose').addEventListener('click', closeChartZoom);
    document.querySelectorAll('[data-zoom-close]').forEach((node) => node.addEventListener('click', closeChartZoom));
    const zoomBody = $('chartZoomBody');
    zoomBody.addEventListener('pointerdown', zoomPointerDown);
    zoomBody.addEventListener('pointermove', zoomPointerMove);
    zoomBody.addEventListener('pointerup', zoomPointerEnd);
    zoomBody.addEventListener('pointercancel', zoomPointerEnd);
    zoomBody.addEventListener('wheel', zoomWheel, { passive: false });
    zoomBody.addEventListener('dblclick', (event) => {
      const body = zoomBody.getBoundingClientRect();
      zoomBy(zoomState.scale > 1.5 ? 1 / zoomState.scale : 2.4, event.clientX - body.left, event.clientY - body.top);
    });
    window.addEventListener('resize', () => { if (!chartZoomNode().hidden) { clampZoom(); applyZoom(); } });

    $('recordForm').addEventListener('submit', submitForm);
    $('periodTabs').addEventListener('click', (event) => {
      const button = event.target && event.target.closest ? event.target.closest('button[data-period]') : null;
      if (!button) return;
      app.formPeriod = button.dataset.period;
      syncFormFields();
      liveBound();
    });
    ['recordDate', 'recordMonth', 'recordStart', 'recordEnd'].forEach((id) => {
      const node = $(id);
      if (node) node.addEventListener('change', liveBound);
    });
    $('machineInputs').addEventListener('input', liveBound);
    $('dialogClose').addEventListener('click', () => $('recordDialog').close());
    $('dialogCancel').addEventListener('click', () => $('recordDialog').close());
    $('recordDialog').addEventListener('close', () => { app.editing = null; showFormError(''); });
    $('confirmNo').addEventListener('click', () => $('confirmDialog').close());
    $('confirmYes').addEventListener('click', () => {
      const action = confirmAction;
      confirmAction = null;
      $('confirmDialog').close();
      if (action) guard('confirmação', action)();
    });

    document.addEventListener('click', guard('interacção', (event) => {
      const target = event.target;
      if (!target || !target.closest) return;
      const edit = target.closest('[data-edit]');
      if (edit) {
        const record = app.state.records.find((item) => item.id === edit.dataset.edit);
        if (record) openForm(record.period, record.id);
        return;
      }
      const remove = target.closest('[data-delete]');
      if (remove) {
        const record = app.state.records.find((item) => item.id === remove.dataset.delete);
        if (record) deleteRecord(record);
        return;
      }
      const info = target.closest('[data-info]');
      if (info) { showTip(info); return; }
      $('tip').hidden = true;
    }));

    $('recordsYear').addEventListener('change', (event) => { app.recordsYear = event.target.value; render(); });
    $('reportKind').addEventListener('change', (event) => {
      app.report.kind = event.target.value;
      seedFilters();
      if (app.report.kind === 'range' || rejectionKind(app.report.kind)) {
        app.report.start = app.report.start || app.filter.start;
        app.report.end = app.report.end || app.filter.end;
      }
      renderReportControls();
      renderReport();
    });
    $('reportGenerate').addEventListener('click', guard('gerar relatório', () => { renderReport(); if (app.generated) toast('Relatório actualizado.'); }));
    $('exportPdf').addEventListener('click', () => exportPdf());
    $('exportCsv').addEventListener('click', () => exportCsv());
    $('printReport').addEventListener('click', () => printReport());

    $('exportCopy').addEventListener('click', exportCopy);
    $('importCopy').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', (event) => importCopy(event.target.files[0]));
    $('loadSample').addEventListener('click', toggleSample);
    $('reloadNow').addEventListener('click', () => window.location.reload());

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!chartZoomNode().hidden) { closeChartZoom(); return; }
      $('tip').hidden = true;
    });
    window.addEventListener('resize', () => { $('tip').hidden = true; });
    window.addEventListener('error', (event) => reportError(`janela: ${event.message}`));
    window.addEventListener('unhandledrejection', (event) => reportError(`promessa: ${event.reason && event.reason.message}`));
  }

  /** Mostra a caixa de ajuda ao pé do botão 🛈 premido (e volta a escondê-la). */
  function showTip(button) {
    const tip = $('tip');
    const key = button.dataset.info;
    if (!tip.hidden && tip.dataset.owner === key) { tip.hidden = true; return; }
    tip.dataset.owner = key;
    fill(tip, el('p', { text: HELP[key] || key }));
    tip.hidden = false;
    const box = button.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 24);
    tip.style.width = `${width}px`;
    tip.style.left = `${Math.max(12, Math.min(box.left, window.innerWidth - width - 12))}px`;
    tip.style.top = `${box.bottom + 8}px`;
  }

  const start = () => { boot(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
