/*
 * Conta Carta · interface (painel, registos, relatórios) e armazenamento
 *
 * A persistência passa só por duas funções: `loadState` e `persist`.
 * Com o servidor (SQLite) os dados vivem em `dados/`; sem servidor ficam no
 * armazenamento deste navegador. Nenhum regito sai deste computador.
 */
(function () {
  'use strict';

  const core = window.ContaCartaCore;
  const pdf = window.ContaCartaPdf;
  const $ = (id) => document.getElementById(id);
  const config = window.CONTACARTA_CONFIG || { storage: 'browser' };
  const onServer = config.storage === 'sqlite';
  const STORAGE_KEY = 'contacarta-registos-v3';
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
    report: { kind: 'month', date: '', month: '', start: '', end: '', compareFrom: '', compareTo: '',
      yearsFrom: '', yearsTo: '', extremes: false },
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
  const stamp = () => new Intl.DateTimeFormat('pt-PT', { dateStyle: 'long', timeStyle: 'short' }).format(new Date());
  const shortStamp = (iso) => (iso ? new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : '');

  /** Um erro de desenho nunca deixa a tela a meio: avisa e regista. */
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
    panel: 'Escolhe um mês ou um intervalo de datas. Só entram na conta os registos cujo período cabe por inteiro na selecção.',
    machines: 'Registas à mão: quanto produziu a máquina e quanto ela deitou fora. Aprovadas = produzidas − rejeitadas.',
    approval: 'Percentagem de cartas aprovadas sobre tudo o que foi produzido no período.',
    rejection: 'Cartas deitadas fora pela máquina: impressão defeituosa, dados ilegíveis ou erro de personalização.',
    coverage: 'Dias com registo não são dias de trabalho: um dia sem registo não conta como produção zero.',
    period: 'Dia para apontar um turno; Mês para fechar um mês; Vários dias para uma semana ou outra pausa.',
    report: 'O relatório soma os registos do período escolhido. Pode ser guardado em PDF (A4), em CSV ou impresso.',
    pdf: 'O PDF é gerado neste computador, com o cabeçalho do INATRO pronto a arquivar ou imprimir.',
    copy: 'Exporta um ficheiro .json com todos os registos. Serve para backup e para levar os dados para outro computador.',
    import: 'Importar substitui os registos actuais pelos do ficheiro. Exporta uma cópia antes, se quiseres voltar atrás.',
    sample: 'Carrega um período fictício para veres o painel a trabalhar. Nada é enviado para fora deste computador.',
    outside: 'Há registos que começam antes ou acabam depois deste período. Ficam de fora para não contar cartas duas vezes.',
    year: 'A visão de ano soma os doze meses de uma vez. Serve para fechar um ano e para o comparar com o anterior.',
    compare: 'A comparação soma cada mês (ou cada ano) em separado e mostra a variação face ao período anterior. Nada é guardado: é a mesma leitura, partida.',
    delta: 'A variação é sempre medida contra o período imediatamente anterior, do mesmo tamanho. Sem registos nesse período, não há comparação.',
  };

  const infoButton = (key) => el('button', {
    class: 'info', type: 'button', 'data-info': key, 'aria-label': 'Mais informação', text: '🛈',
  });

  /* --------------------------------------------------- armazenamento --- */

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
    app.report.compareTo = app.report.compareTo || app.filter.month;
    app.report.compareFrom = app.report.compareFrom || core.shiftMonth(app.report.compareTo, -5);
    app.report.yearsTo = app.report.yearsTo || app.filter.month.slice(0, 4);
    app.report.yearsFrom = app.report.yearsFrom || String(+app.report.yearsTo - 4);
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
    try { draw(); } catch (error) { reportError(`desenho: ${error.message}`); showError('Não foi possível mostrar os registos. Recarrega a página.'); }
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
    renderChart(summary);
    fill($('panelTable'), dataTable(summary, false));
  }

  /** Variação face ao período anterior do mesmo tamanho; só faz sentido em mês e ano. */
  function previousDelta(summary) {
    if (app.filter.mode !== 'month' && app.filter.mode !== 'year') return null;
    const period = filterPeriod();
    const delta = core.compareWithPrevious(app.state, period.start, period.end);
    if (!delta) return null;
    delta.unit = app.filter.mode === 'month' ? 'mês anterior' : 'ano anterior';
    delta.shown = !delta.empty && (summary.produced > 0 || delta.produced !== 0);
    return delta;
  }

  const signed = (value, suffix) => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${fmt(Math.abs(value))}${suffix || ''}`;

  function renderKpis(summary) {
    const delta = previousDelta(summary);
    const versus = delta && delta.shown
      ? el('div', { class: `kpi-delta ${delta.produced > 0 ? 'is-up' : delta.produced < 0 ? 'is-down' : ''}`.trim() }, [
        el('span', { text: `${signed(delta.produced)} face ao ${delta.unit}` }),
        delta.rate !== null ? el('span', { class: 'kpi-delta-rate', text: `${signed(delta.rate, ' p.')} na taxa` }) : '',
        infoButton('delta'),
      ])
      : '';
    const cards = [
      { label: 'Produzidas', value: fmt(summary.produced), hint: 'cartas no período', help: 'machines', delta },
      { label: 'Aprovadas', value: fmt(summary.approved), hint: `taxa ${core.formatPercent(summary.approvalRate)}`, help: 'approval' },
      { label: 'Rejeitadas', value: fmt(summary.rejected), hint: `taxa ${core.formatPercent(summary.rejectionRate)}`, help: 'rejection', tone: summary.rejected ? 'is-bad' : '' },
      { label: 'Cobertura', value: `${fmt(summary.daysCovered)}/${fmt(summary.days)}`, hint: 'dias com registo', help: 'coverage' },
    ];
    // em modo ano, o número de «cartas produzidas» é mais útil como média mensal
    if (app.filter.mode === 'year' && summary.days >= 360) {
      const avg = Math.round(summary.produced / 12);
      cards[0] = { label: 'Produzidas no ano', value: fmt(summary.produced), hint: `média ${fmt(avg)} por mês`, help: 'year' };
      cards[3] = { label: 'Meses com registo', value: `${fmt(summary.records.length)}/12`,
        hint: summary.records.length ? 'registos somados no ano' : 'ainda nenhum registo neste ano', help: 'coverage' };
    }
    fill($('kpis'), ...cards.map((card) => el('article', { class: 'kpi' }, [
      el('div', { class: 'kpi-top' }, [el('span', { text: card.label }), infoButton(card.help)]),
      el('div', { class: `kpi-value ${card.tone || ''}`.trim(), text: card.value }),
      el('div', { class: 'kpi-hint', text: card.hint }),
      card.delta ? versus : '',
    ])));
  }

  function renderMachines(summary) {
    const cards = summary.machines.map((machine, index) => {
      const rate = core.percent(machine.approved, machine.produced);
      const tone = rate === null ? '' : rate >= 90 ? 'is-ok' : rate >= 80 ? 'is-warn' : 'is-bad';
      return el('div', { class: 'machine' }, [
        el('div', { class: 'machine-head' }, [
          el('h3', { text: core.MACHINES[index] }),
          el('span', { class: `chip ${tone}`.trim(), text: rate === null ? 'sem produção' : `${core.formatPercent(rate)} aprovadas` }),
        ]),
        el('div', { class: 'machine-grid' }, [
          { label: 'Produzidas', value: machine.produced, tone: '' },
          { label: 'Aprovadas', value: machine.approved, tone: 'is-ok' },
          { label: 'Rejeitadas', value: machine.rejected, tone: machine.rejected ? 'is-bad' : '' },
        ].map((cell) => el('div', {}, [
          el('span', { text: cell.label }),
          el('strong', { class: cell.tone, text: fmt(cell.value) }),
        ]))),
        el('div', { class: 'bar', role: 'img', 'aria-label': `${core.formatPercent(rate)} aprovadas` }, [
          el('i', { class: 'ok', style: `width:${round(rate || 0)}%` }),
          el('i', { class: 'bad', style: `width:${round(rate === null ? 0 : 100 - rate)}%` }),
        ]),
      ]);
    });
    fill($('machineCards'), ...cards);
  }

  function renderChart(summary) {
    const mode = app.filter.mode;
    if (mode === 'year') {
      const year = String(app.filter.year || new Date().getFullYear());
      $('chartTitle').textContent = `Evolução em ${year}`;
      const points = core.series(app.state, `${year}-01-01`, `${year}-12-31`, 'month')
        .map((point) => ({ ...point, label: point.short || point.label }));
      fill($('chart'), chartBars(points));
      return;
    }
    const monthMode = mode === 'month';
    const year = app.filter.month.slice(0, 4);
    $('chartTitle').textContent = monthMode ? `Evolução em ${year}` : 'Evolução do período';
    const points = monthMode
      ? core.series(app.state, `${year}-01-01`, `${year}-12-31`, 'month')
      : core.series(app.state, summary.start, summary.end, 'record');
    fill($('chart'), chartBars(points));
  }

  /** Barras em SVG: no indicador de produção, lado a lado para aprovadas e rejeitadas. */
  function chartBars(points, metric) {
    const shown = points.slice(-14);
    if (!shown.length || shown.every((point) => !point.produced && !point.rejected)) {
      return el('div', { class: 'empty' }, [el('strong', { text: 'Sem números para desenhar' })]);
    }
    const shownMetric = metric || app.metric;
    const isSideBySide = shownMetric === 'produced';
    const width = 640, height = 210, left = 10, bottom = 24, top = 28;
    const plotHeight = height - bottom - top;
    const value = (point) => (shownMetric === 'produced' ? point.produced : shownMetric === 'approved' ? point.approved : point.rejected);
    const peak = Math.max(1, ...shown.map((point) => (isSideBySide ? Math.max(point.produced, point.approved, point.rejected) : value(point))));
    const slot = (width - left * 2) / shown.length;
    const parts = [`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${metric === 'rejected' ? 'Rejeições' : metric === 'approved' ? 'Cartas aprovadas' : 'Cartas produzidas (aprovadas e rejeitadas lado a lado)'} por ${app.filter.mode === 'month' ? 'mês' : 'registo'}">`];

    if (isSideBySide) {
      parts.push(`<g class="chart-legend" font-size="9" fill="#2d3f33" font-weight="500">`
        + `<circle cx="${left + 5}" cy="13" r="3.5" fill="#0e7a2e"/>`
        + `<text x="${left + 13}" y="16">Aprovadas</text>`
        + `<circle cx="${left + 74}" cy="13" r="3.5" fill="#b4362d"/>`
        + `<text x="${left + 82}" y="16">Rejeitadas</text>`
        + `</g>`);
    }

    for (let line = 0; line <= 3; line += 1) {
      const y = height - bottom - (line * plotHeight) / 3;
      parts.push(`<line x1="${left}" y1="${round(y)}" x2="${width - left}" y2="${round(y)}" stroke="${line ? '#e9efe7' : '#0b3d1f'}" stroke-width="${line ? 1 : 1.2}"/>`);
      parts.push(`<text x="${width - left}" y="${round(y - 5)}" text-anchor="end" font-size="9" fill="#7f8c81">${fmt(Math.round((peak * line) / 3))}</text>`);
    }

    if (isSideBySide) {
      const gap = Math.max(2, Math.min(4, Math.round(slot * 0.06)));
      const pairWidth = Math.min(46, Math.max(14, slot - 10));
      const subWidth = Math.max(5, Math.floor((pairWidth - gap) / 2));
      const effectivePairWidth = subWidth * 2 + gap;

      shown.forEach((point, index) => {
        const groupX = left + index * slot + (slot - effectivePairWidth) / 2;
        const xApproved = groupX;
        const xRejected = groupX + subWidth + gap;

        const hApproved = point.approved ? Math.max(3, (point.approved / peak) * plotHeight) : 0;
        const yApproved = height - bottom - hApproved;

        const hRejected = point.rejected ? Math.max(3, (point.rejected / peak) * plotHeight) : 0;
        const yRejected = height - bottom - hRejected;

        const summary = `${escapeHtml(point.full)} — Produzidas: ${fmt(point.produced)} · Aprovadas: ${fmt(point.approved)} · Rejeitadas: ${fmt(point.rejected)}${point.produced ? ` (${core.formatPercent(point.approvalRate)} de aprovação)` : ''}`;

        parts.push(`<g><title>${summary}</title>`
          + `<rect x="${round(xApproved)}" y="${round(yApproved)}" width="${round(subWidth)}" height="${round(hApproved)}" rx="2" fill="#0e7a2e"/>`
          + `<rect x="${round(xRejected)}" y="${round(yRejected)}" width="${round(subWidth)}" height="${round(hRejected)}" rx="2" fill="#b4362d"/>`
          + (hApproved ? `<text x="${round(xApproved + subWidth / 2)}" y="${round(yApproved - 4)}" text-anchor="middle" font-size="${subWidth < 14 ? 8 : 9}" font-weight="600" fill="#0e7a2e">${fmt(point.approved)}</text>` : '')
          + (hRejected ? `<text x="${round(xRejected + subWidth / 2)}" y="${round(yRejected - 4)}" text-anchor="middle" font-size="${subWidth < 14 ? 8 : 9}" font-weight="600" fill="#b4362d">${fmt(point.rejected)}</text>` : '')
          + `<text x="${round(groupX + effectivePairWidth / 2)}" y="${height - 7}" text-anchor="middle" font-size="10" fill="#5b6b5f">${escapeHtml(point.label)}</text></g>`);
      });
    } else {
      const barWidth = Math.min(38, Math.max(10, slot - 14));
      shown.forEach((point, index) => {
        const amount = value(point);
        const x = left + index * slot + (slot - barWidth) / 2;
        const barHeight = amount ? Math.max(3, (amount / peak) * plotHeight) : 0;
        const y = height - bottom - barHeight;
        const color = shownMetric === 'rejected' ? '#b4362d' : '#0e7a2e';
        parts.push(`<g><title>${escapeHtml(point.full)} — ${fmt(amount)}</title>`
          + `<rect x="${round(x)}" y="${round(y)}" width="${round(barWidth)}" height="${round(barHeight)}" rx="3" fill="${color}"/>`
          + (barHeight ? `<text x="${round(x + barWidth / 2)}" y="${round(y - 6)}" text-anchor="middle" font-size="10" font-weight="600" fill="#16241b">${fmt(amount)}</text>` : '')
          + `<text x="${round(x + barWidth / 2)}" y="${height - 7}" text-anchor="middle" font-size="10" fill="#5b6b5f">${escapeHtml(point.label)}</text></g>`);
      });
    }

    parts.push('</svg>');
    const holder = el('div', { class: 'chart-holder' });
    holder.innerHTML = parts.join('');
    return holder;
  }

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  const rateClass = (rate) => (rate === null ? '' : rate >= 90 ? 'is-ok' : rate >= 80 ? 'is-warn' : 'is-bad');

  /** Tabela usada no painel (leitura) e nos registos (com acções). */
  function dataTable(summary, withActions) {
    if (!summary.records.length) {
      return el('div', { class: 'empty' }, [el('strong', { text: withActions ? 'Ainda sem registos' : 'Ainda sem registos neste período' })]);
    }
    const numberColumn = (label) => el('th', { class: 'is-number', text: label });
    const head = el('tr', { class: 'is-groups' }, [
      el('th', { rowspan: 2, text: 'Período' }),
      el('th', { class: 'is-group', colspan: 2, text: core.MACHINES[0] }),
      el('th', { class: 'is-group', colspan: 2, text: core.MACHINES[1] }),
      el('th', { class: 'is-group', colspan: 3, text: 'Totais do período' }),
      el('th', { rowspan: 2, text: 'Notas' }),
      withActions ? el('th', { class: 'is-actions', rowspan: 2, text: '' }) : null,
    ].filter(Boolean));
    const columns = el('tr', {}, [
      numberColumn('produzidas'), numberColumn('rejeitadas'),
      numberColumn('produzidas'), numberColumn('rejeitadas'),
      numberColumn('produzidas'), numberColumn('aprovadas'), numberColumn('aprovação'),
    ]);
    const rows = summary.records.map((record) => {
      const totals = core.totals(record);
      const cells = [el('td', {}, el('button', { class: 'link', type: 'button', 'data-edit': record.id, text: core.periodLabel(record.start, record.end) }))];
      totals.machines.forEach((machine) => {
        cells.push(el('td', { class: 'is-number', text: fmt(machine.produced) }));
        cells.push(el('td', { class: `is-number${machine.rejected ? ' is-bad' : ''}`, text: fmt(machine.rejected) }));
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
        el('td', { class: 'is-number is-bad', text: fmt(machine.rejected) }),
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
    if (kind === 'range') {
      fields.push(dateField('De', 'reportStart', app.report.start, 'date', core.FIRST, core.LAST));
      fields.push(dateField('Até', 'reportEnd', app.report.end, 'date', core.FIRST, core.LAST));
    }
    const comparing = kind === 'months' || kind === 'years';
    if (kind === 'months') {
      fields.push(pickField('De', 'compareFrom', 'month', '1900-01', '2200-12'));
      fields.push(pickField('Até', 'compareTo', 'month', '1900-01', '2200-12'));
    }
    if (kind === 'years') {
      fields.push(pickField('De', 'yearsFrom', 'number', 1900, 2200));
      fields.push(pickField('Até', 'yearsTo', 'number', 1900, 2200));
    }
    if (comparing) {
      fields.push(el('label', { class: 'field field-check' }, [
        el('input', {
          type: 'checkbox', checked: app.report.extremes, 'aria-label': 'Só o primeiro e o último período',
          onchange: (event) => { app.report.extremes = event.target.checked; renderReport(); },
        }),
        el('span', { text: 'Só o primeiro e o último' }),
        infoButton('compare'),
      ]));
    }
    fill($('reportDates'), ...fields);
  }

  /** Meses ou anos que entram na comparação. */
  function reportComparison() {
    const options = { onlyExtremes: app.report.extremes };
    return app.report.kind === 'years'
      ? core.comparePeriods('years', app.report.yearsFrom, app.report.yearsTo, options)
      : core.comparePeriods('months', app.report.compareFrom, app.report.compareTo, options);
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

  function buildReport() {
    const kind = kindOfReport();
    const comparing = kind === 'months' || kind === 'years';
    let period, comparison = null;
    try {
      if (comparing) {
        comparison = core.compare(app.state, reportComparison());
        period = { start: comparison.start, end: comparison.end };
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
    return {
      summary,
      comparison,
      notes: noteList(summary),
      series: comparison ? comparison.series : core.series(app.state, period.start, period.end, kind === 'month' ? 'month' : 'record'),
      generated: stamp(),
    };
  }
  const kindOfReport = () => app.report.kind;

  /** Cada tipo de relatório pede o seu próprio rótulo legível. */
  function reportLabel(kind, period, comparison) {
    if (kind === 'day') return core.longDate(period.start);
    if (kind === 'week') return `Semana de ${core.shortDate(period.start)}`;
    if (kind === 'month') return core.monthLabel(period.start.slice(0, 7));
    if (kind === 'months' || kind === 'years') {
      const rows = comparison ? comparison.rows : [];
      const span = rows.length > 1 ? `${rows[0].label} – ${rows[rows.length - 1].label}` : (rows[0] || {}).label;
      return `${kind === 'years' ? 'Comparação de anos' : 'Comparação de meses'} · ${span || core.periodLabel(period.start, period.end)}`;
    }
    return core.periodLabel(period.start, period.end);
  }

  function renderReport() {
    app.generated = buildReport();
    $('reportWrap').hidden = !app.generated;
    if (app.generated) renderPaper();
  }

  const noteList = (summary) => summary.records.filter((record) => record.notes)
    .map((record) => `${core.periodLabel(record.start, record.end)} — ${record.notes}`);

  function renderPaper() {
    const { summary, notes, comparison } = app.generated;
    $('reportHint').textContent = comparison
      ? `${fmt(comparison.rows.length)} ${comparison.rows.length === 1 ? 'período comparado' : 'períodos comparados'} · `
        + `${fmt(comparison.total.records)} ${comparison.total.records === 1 ? 'registo somado' : 'registos somados'} · `
        + `${fmt(comparison.measured)} com produção`
      : summary.records.length
        ? `${fmt(summary.records.length)} ${summary.records.length === 1 ? 'registo somado' : 'registos somados'} · ${fmt(summary.daysCovered)} de ${fmt(summary.days)} dias com registo`
        : 'Sem registos neste período: o relatório mostra só os zeros do cabeçalho.';
    $('reportWrap').hidden = false;
    fill($('paper'),
      el('div', { class: 'paper-head' }, [
        el('div', { class: 'paper-brand' }, [
          el('img', { class: 'paper-logo', src: 'conta-carta-mark.svg', alt: '', width: 72, height: 44 }),
          el('div', {}, [
            el('p', { class: 'paper-name', text: 'INATRO, IP' }),
            el('p', { class: 'paper-org', text: 'Instituto Nacional dos Transportes Rodoviários' }),
            el('p', { class: 'paper-sub', text: 'Registo de produção de cartas de condução' }),
          ]),
        ]),
        el('div', { class: 'paper-meta' }, [
          el('h3', { text: 'Relatório de produção' }),
          el('p', { text: summary.label }),
          el('p', { class: 'is-muted', text: `Gerado em ${app.generated.generated}` }),
        ]),
      ]),
      el('div', { class: 'paper-kpis' }, [
        { label: 'Produzidas', value: fmt(summary.produced) },
        { label: 'Aprovadas', value: fmt(summary.approved), tone: 'is-ok' },
        { label: 'Rejeitadas', value: fmt(summary.rejected), tone: summary.rejected ? 'is-bad' : '' },
        { label: 'Aprovação', value: core.formatPercent(summary.approvalRate) },
      ].map((card) => el('div', { class: `paper-kpi ${card.tone || ''}`.trim() }, [
        el('span', { text: card.label }), el('strong', { text: card.value }),
      ]))),
      paperTable('Por máquina', ['Origem', 'Produzidas', 'Aprovadas', 'Rejeitadas', 'Aprovação'], [
        ...summary.machines.map((machine, index) => [
          core.MACHINES[index], fmt(machine.produced), fmt(machine.approved), fmt(machine.rejected), core.formatPercent(machine.approvalRate),
        ]),
        ['Total', fmt(summary.produced), fmt(summary.approved), fmt(summary.rejected), core.formatPercent(summary.approvalRate)],
      ], { totalLast: true }),
      comparison ? paperTable(comparisonTitle(),
        ['Período', 'Registos', 'Produzidas', 'Aprovadas', 'Rejeitadas', 'Aprovação', 'Variação'],
        comparison.rows.map((row) => [row.label, fmt(row.records), fmt(row.produced), fmt(row.approved),
          fmt(row.rejected), core.formatPercent(row.approvalRate),
          row.delta ? `${signed(row.delta.produced)} · ${signed(row.delta.rate, ' p.')}` : '—']),
        {
          total: ['Total comparado', fmt(comparison.total.records), fmt(comparison.total.produced),
            fmt(comparison.total.approved), fmt(comparison.total.rejected), core.formatPercent(comparison.total.approvalRate),
            `${fmt(comparison.periods)} ${comparison.periods === 1 ? 'período' : 'períodos'}`],
          marks: comparison.rows.map((row) => (comparison.best && row.key === comparison.best.key ? 'is-ok'
            : comparison.worst && row.key === comparison.worst.key ? 'is-bad' : '')),
        }) : '',
      comparison && core.compareReading(comparison)
        ? el('p', { class: 'paper-note', text: core.compareReading(comparison) }) : '',
      el('h4', { class: 'paper-title', text: comparison ? comparisonTitle() : 'Evolução' }),
      // na comparação o gráfico recebe a etiqueta curta do período («Set 26»), que cabe sob a barra
      el('div', { class: 'paper-chart' }, chartBars((comparison
        ? comparison.series.map((point, index) => ({
          ...point, label: (comparison.rows[index] && comparison.rows[index].short) || point.label,
        }))
        : app.generated.series) || [], 'produced')),
      summary.records.length
        ? paperTable('Registos somados', ['Período', 'Produzidas', 'Aprovadas', 'Rejeitadas', 'Aprovação'], summary.records.map((record) => {
          const totals = core.totals(record);
          return [core.periodLabel(record.start, record.end), fmt(totals.produced), fmt(totals.approved), fmt(totals.rejected), core.formatPercent(totals.approvalRate)];
        }))
        : el('p', { class: 'paper-empty', text: 'Não há registos somados neste período.' }),
      summary.outside.length
        ? el('p', { class: 'paper-note' }, [
          el('span', { text: `${fmt(summary.outside.length)} registos ficaram fora deste período e não foram somados.` }),
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
        { key: 'produced', label: 'Produzidas', suffix: 'p' },
        { key: 'rejected', label: 'Rejeitadas', suffix: 'r' },
      ].map((field) => el('label', {}, [
        field.label,
        el('input', {
          id: `m${index}${field.suffix}`, type: 'number', min: 0, max: core.MAX_QUANTITY, step: 1, inputmode: 'numeric',
          value: record ? record.machines[index][field.key] : '', placeholder: '0',
          'aria-label': `${name} — ${field.label.toLowerCase()}`,
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
      machines: core.MACHINES.map((_, index) => ({ produced: $(`m${index}p`).value, rejected: $(`m${index}r`).value })),
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
        { label: 'Rejeitadas', value: fmt(totals.rejected), tone: totals.rejected ? 'is-bad' : '' },
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
    download(`contacarta-registos-${today()}.json`, `${JSON.stringify(app.state, null, 2)}\n`, 'application/json;charset=utf-8');
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
    confirmDialog('Ver com dados fictícios?',
      `Vão entrar ${fmt(sample.records.length)} registos fictícios, ao lado dos teus.`,
      'Carregar',
      () => tryPersist({ version: core.VERSION, records: [...app.state.records, ...sample.records] },
        'Exemplo carregado. Podes removê-lo quando quiseres.').then(lookAtLatest));
  });

  /* --------------------------------------------------------- exportações --- */

  const exportPdf = guard('exportar PDF', async () => {
    const report = app.generated || buildReport();
    if (!report) { toast('Escolhe o período do relatório primeiro.'); return; }
    const { summary, comparison } = report;
    const scope = [`${fmt(summary.records.length)} ${summary.records.length === 1 ? 'registo somado' : 'registos somados'} · ${fmt(summary.daysCovered)} de ${fmt(summary.days)} dias com registo · ${app.filter.mode === 'month' ? 'visão mensal' : 'visão de período'}`];
    if (comparison && comparison.rows.length > 1) scope.push(`${fmt(comparison.rows.length)} períodos comparados em separado`);
    if (summary.outside.length) scope.push(`${fmt(summary.outside.length)} registos fora deste período não foram somados.`);
    const bytes = pdf.build({
      summary,
      label: summary.label,
      generated: report.generated,
      scope: scope.join(' — '),
      series: report.series || core.series(app.state, summary.start, summary.end, 'record'),
      comparison,
      comparisonTitle: comparison ? comparisonTitle() : null,
      notes: report.notes,
    });
    download(`contacarta-${summary.start}-${summary.end}${comparison ? '-comparacao' : ''}.pdf`, bytes, 'application/pdf');
    toast('Relatório em PDF guardado.');
  });

  const exportCsv = guard('exportar CSV', () => {
    const report = app.generated || buildReport();
    if (!report) { toast('Escolhe o período do relatório primeiro.'); return; }
    const { summary, comparison } = report;
    const data = comparison ? core.buildCompareCSV(comparison, summary.label) : core.buildCSV(summary);
    download(`contacarta-${summary.start}-${summary.end}${comparison ? '-comparacao' : ''}.csv`, data, 'text/csv;charset=utf-8');
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
      app.metric = node.dataset.metric;
      document.querySelectorAll('[data-metric]').forEach((other) => other.classList.toggle('is-on', other === node));
      render();
    }));

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
      if (app.report.kind === 'range') {
        app.report.start = app.report.start || app.filter.start;
        app.report.end = app.report.end || app.filter.end;
      }
      renderReportControls();
      renderReport();
    });
    $('reportGenerate').addEventListener('click', guard('gerar relatório', () => { renderReport(); if (app.generated) toast('Relatório actualizado.'); }));
    $('exportPdf').addEventListener('click', () => exportPdf());
    $('exportCsv').addEventListener('click', () => exportCsv());
    $('printReport').addEventListener('click', guard('imprimir', () => window.print()));

    $('exportCopy').addEventListener('click', exportCopy);
    $('importCopy').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', (event) => importCopy(event.target.files[0]));
    $('loadSample').addEventListener('click', toggleSample);
    $('reloadNow').addEventListener('click', () => window.location.reload());

    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') $('tip').hidden = true; });
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
