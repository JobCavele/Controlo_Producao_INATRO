/* Conta Carta: interface única, exclusivamente ligada à API SQLite. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const f = (value) => new Intl.NumberFormat('pt-MZ').format(value || 0);
  const { orderKey, fromIsoDay, midnight, validDay, validFilterYear, instant, timestamp, today: nowDate, firstOfMonth, monthRange } = window.ContaCartaDates;
  const state = {
    role: null, dashboard: null, delegations: [], records: null, editing: null,
    map: null, activeMap: '', view: 'dashboard', updating: false, requestId: 0,
  };
  const KINDS = {
    pending: { title: 'Cartas por produzir', hint: 'Quantidade total pendente na delegação segundo a consulta ao INCAPE.', primary: 'Cartas por produzir' },
    production: { title: 'Produção por máquina', hint: 'Total de impressões e rejeições pela máquina nessa data. As rejeitadas estão incluídas no total produzido.', primary: 'Cartas produzidas', secondary: 'Rejeitadas pela máquina' },
    quality: { title: 'Controlo de qualidade', hint: 'Aprovações e reprovações do QC na data da verificação, independentemente da data da impressão.', primary: 'Aprovadas no QC', secondary: 'Reprovadas no QC' },
    dispatch: { title: 'Cartas despachadas', hint: 'Quantidade total de cartas enviadas para a delegação nessa data.', primary: 'Cartas despachadas' },
  };

  function el(tag, attributes = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === 'text') node.textContent = String(value);
      else if (key === 'class') node.className = value;
      else node.setAttribute(key, String(value));
    }
    for (const child of (Array.isArray(children) ? children : [children])) {
      if (child !== null && child !== undefined && child !== '') node.append(child);
    }
    return node;
  }
  const cell = (value, numeric = false) => el('td', { text: value, class: numeric ? 'num' : '' });
  function announce(message, error = false) {
    const node = $('notice');
    node.hidden = !message;
    node.classList.toggle('error', error);
    node.textContent = message || '';
  }
  async function api(url, options = {}) {
    const response = await fetch(url, {
      cache: 'no-store', credentials: 'same-origin',
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && state.role) showLogin('A sessão expirou. Entre novamente.');
      throw new Error(data.error || 'Não foi possível contactar o servidor.');
    }
    return data;
  }
  const payload = (method, data) => ({ method, body: JSON.stringify(data) });
  function readableTime(value) { return value ? value.slice(0, 16) : 'Sem registos'; }
  function freshness(value) {
    if (!value) return 'Ainda sem actualização';
    const minutes = Math.max(0, Math.floor((Date.now() - instant(value)) / 60000));
    const ago = minutes < 1 ? 'há menos de 1 minuto' : minutes < 60 ? `há ${minutes} min` : minutes < 1440 ? `há ${Math.floor(minutes / 60)} h` : `há ${Math.floor(minutes / 1440)} dias`;
    return `Actualizado ${ago} · ${readableTime(value)}`;
  }
  const options = (select, items, placeholder) => {
    select.replaceChildren(...(placeholder ? [el('option', { value: '', text: placeholder })] : []),
      ...items.map(([value, label]) => el('option', { value, text: label })));
  };
  function setMenu(open) {
    const toggle = $('menuToggle');
    const label = open ? 'Recolher a barra lateral' : 'Abrir a barra lateral';
    $('application').classList.toggle('is-collapsed', !open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  }
  const slideshow = window.ContaCartaSlideshow.create({
    fade: (out) => $('application').classList.toggle('tv-fading', out),
    render: (row, position, total) => {
      $('application').classList.toggle('tv-map-slide', Boolean(row));
      state.map?.spotlight(row?.code);
      if (!row) return;
      $('tvProvinceStep').textContent = `Mapa de Moçambique · ${position} de ${total}`;
      $('tvProvinceName').textContent = row.code === 'MAP-C' ? 'Cidade de Maputo' : row.region;
      $('tvSeat').textContent = `Delegação: ${row.name}`;
      const indicator = $('mapMetric').value;
      $('tvFigures').replaceChildren(...Object.entries(window.ContaCartaMap.INDICATORS).map(([key, { label }]) => {
        const amount = row[key] == null ? '—' : f(row[key]);
        return el('div', { class: key === indicator ? 'tv-metric-active' : '' }, [
          el('dt', { text: label }), el('dd', { text: amount, style: `--value-length:${amount.length}` }),
        ]);
      }));
      $('tvSnapshot').textContent = row.pendingDate ? `Última consulta INCAPE: ${row.pendingDate}` : 'Sem consulta INCAPE até ao fim do período';
    },
  });
  $('view-dashboard').style.setProperty('--slide-fade', `${window.ContaCartaSlideshow.FADE_MS}ms`);
  async function setTvMode(on) {
    const app = $('application');
    app.classList.toggle('tv-mode', on);
    $('mozambiqueMap').inert = on;
    if (on) slideshow.start(Number($('tvPace').value)); else slideshow.stop();
    $('tvToggle').setAttribute('aria-pressed', String(on));
    $('tvLabel').textContent = on ? 'Sair do modo TV' : 'Modo TV';
    // A apresentação também funciona quando o navegador não autoriza o ecrã inteiro.
    try {
      if (on) {
        window.scrollTo(0, 0);
        if (document.fullscreenEnabled && !document.fullscreenElement) await app.requestFullscreen();
      }
      // A sessão ou o modo TV podem ter terminado enquanto se aguardava o navegador.
      if (!app.classList.contains('tv-mode') && document.fullscreenElement === app) await document.exitFullscreen();
    } catch { /* Mantém a apresentação na janela. */ }
  }
  function updateRole(role) {
    state.role = role;
    $('loginScreen').hidden = true;
    $('application').hidden = false;
    $('activeRole').textContent = role === 'pca' ? 'PCA · Leitura' : 'Fábrica · Edição';
    document.querySelectorAll('.staff-only').forEach((node) => { node.hidden = role !== 'fabrica'; });
    showView('dashboard');
  }
  function showLogin(message = '') {
    setTvMode(false);
    slideshow.setRows([]);
    $('tvPace').value = '5';
    setMenu(true);
    if ($('calendarDialog').open) $('calendarDialog').close();
    state.role = null;
    state.records = null;
    state.dashboard = null;
    $('loginScreen').hidden = false;
    $('application').hidden = true;
    $('loginPassword').value = '';
    $('loginMessage').textContent = message;
  }
  function showView(name) {
    if (!state.role) return;
    if (state.role === 'pca' && name !== 'dashboard') return;
    if (name !== 'dashboard' && $('application').classList.contains('tv-mode')) setTvMode(false);
    state.view = name;
    $('tvToggle').hidden = name !== 'dashboard';
    for (const view of ['dashboard', 'entry', 'history']) $('view-' + view).hidden = view !== name;
    document.querySelectorAll('[data-view]').forEach((button) => {
      const active = button.dataset.view === name;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    const titles = { dashboard: ['Visão geral', 'Indicadores por período e delegação'], entry: ['Introduzir dados', 'Registo das quantidades recolhidas na fábrica e no INCAPE'], history: ['Histórico e correcções', 'Consulta, edição e auditoria dos registos'] };
    $('viewTitle').textContent = titles[name][0];
    $('viewDescription').textContent = titles[name][1];
    if (name === 'history') loadEntries();
    if (name === 'entry') $('entryDate').focus();
  }

  function dateRange(start, end) {
    if (!validDay(start) || !validDay(end)) throw new Error('Data inválida. Use dd/mm/aaaa.');
    if (orderKey(start) > orderKey(end)) throw new Error('A data inicial deve ser anterior ou igual à final.');
    return { start, end };
  }
  function datesForFilter() {
    const mode = $('filterType').value;
    if (mode === 'month') return monthRange($('filterMonth').value);
    if (mode === 'year') {
      const year = $('filterYear').value;
      if (!validFilterYear(year)) throw new Error('Indique um ano de 2000 a 2200 (aaaa).');
      return { start: '01/01/' + year, end: '31/12/' + year };
    }
    return dateRange($('filterStart').value, $('filterEnd').value);
  }
  function updateFilterFields() {
    const mode = $('filterType').value;
    for (const [id, type] of [['monthWrap', 'month'], ['yearWrap', 'year'], ['startWrap', 'range'], ['endWrap', 'range']]) {
      const wrap = $(id);
      wrap.hidden = type !== mode;
      for (const field of wrap.querySelectorAll('input,button')) field.disabled = wrap.hidden;
    }
  }
  async function refreshDashboard() {
    if (!state.role || state.updating) return;
    // Na TV, actualiza o período que está no ecrã, não as edições ainda por aplicar no formulário oculto.
    const presenting = $('application').classList.contains('tv-mode');
    let range;
    try { range = presenting && state.dashboard ? state.dashboard : datesForFilter(); } catch (error) { announce(error.message, true); return; }
    state.updating = true;
    const seq = ++state.requestId;
    $('connectionStatus').textContent = '● A actualizar…';
    try {
      const { start, end } = range;
      const dashboard = await api('/api/dashboard?' + new URLSearchParams({ start, end }));
      if (seq !== state.requestId) return;
      state.dashboard = dashboard;
      $('connectionStatus').textContent = '● Dados sincronizados';
      if (presenting && $('connectionStatus').classList.contains('offline')) announce('');
      $('connectionStatus').classList.remove('offline');
      $('periodCaption').textContent = `Período: ${start} — ${end}`;
      renderDashboard();
    } catch (error) {
      $('connectionStatus').textContent = '● Sem ligação';
      $('connectionStatus').classList.add('offline');
      announce(error.message, true);
    } finally { state.updating = false; }
  }

  function renderDashboard() {
    const data = state.dashboard;
    if (!data) return;
    const t = data.totals, updated = data.updatedAt;
    const cards = [
      ['Por produzir', t.pending, `Último INCAPE · ${t.pendingCoverage} de ${t.delegations} delegações`, 'pending', ''],
      ['Produzidas', t.produced, 'Total impresso nas duas máquinas', 'production', ''],
      ['Rej. máquina', t.machineRejected, 'Incluídas nas produzidas', 'production', 'is-red'],
      ['Aprovadas no QC', t.qcApproved, 'Verificadas e aprovadas', 'quality', 'is-green'],
      ['Reprovadas no QC', t.qcRejected, 'Chumbadas no controlo de qualidade', 'quality', 'is-red'],
      ['Despachadas', t.dispatched, 'Enviadas às delegações', 'dispatch', 'is-green'],
    ];
    $('kpiGrid').replaceChildren(...cards.map(([title, value, hint, kind, colour]) => {
      const amount = kind === 'pending' && !t.pendingCoverage ? '—' : f(value);
      return el('article', { class: 'card kpi ' + colour }, [
        el('span', { class: 'label', text: title }),
        el('strong', { text: amount, style: `--value-length:${amount.length}` }),
        el('p', { class: 'hint', text: hint }),
        el('span', { class: 'freshness', text: freshness(updated[kind]) }),
      ]);
    }));
    $('machineUpdate').textContent = freshness(updated.production);
    $('chartUpdate').textContent = `Produção: ${readableTime(updated.production)} · Despacho: ${readableTime(updated.dispatch)}`;
    $('machineGrid').replaceChildren(...data.machines.map((machine) => el('article', { class: 'machine' }, [
      el('h3', { text: 'Máquina ' + machine.machine }),
      el('dl', {}, [
        ['Produzidas', machine.produced], ['Rej. máquina', machine.rejected],
        ['QC aprovadas*', machine.qcApproved], ['QC reprovadas*', machine.qcRejected],
      ].map(([label, value]) => el('div', {}, [
        el('dt', { text: label }), el('dd', { text: f(value), class: label.includes('Rej.') || label.includes('reprovadas') ? 'bad' : '' }),
      ]))),
    ])));
    const withoutMachineApproved = t.qcApproved - data.machines.reduce((total, machine) => total + machine.qcApproved, 0);
    const withoutMachineRejected = t.qcRejected - data.machines.reduce((total, machine) => total + machine.qcRejected, 0);
    $('qcGeneral').textContent = `QC sem máquina identificada: ${f(withoutMachineApproved)} aprovadas e ${f(withoutMachineRejected)} reprovadas. Estas quantidades constam dos totais gerais.`;
    renderChart();
    renderMap();
  }

  function renderChart() {
    const data = state.dashboard;
    const start = midnight(data.start), end = midnight(data.end);
    const monthly = end - start > 61 * 86400000;
    const slots = new Map();
    const slotKey = (date) => monthly ? date.slice(3) : date;
    const cursor = new Date(start);
    if (monthly) cursor.setUTCDate(1);
    while (cursor.getTime() <= end) {
      slots.set(slotKey(fromIsoDay(cursor.toISOString())), { produced: 0, dispatched: 0 });
      if (monthly) cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      else cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    for (const row of data.series) {
      const key = slotKey(row.date);
      if (!slots.has(key)) continue;
      slots.get(key).produced += row.produced;
      slots.get(key).dispatched += row.dispatched;
    }
    const max = Math.max(1, ...[...slots.values()].flatMap((row) => [row.produced, row.dispatched]));
    const columns = [...slots].map(([key, row]) => {
      const tooltip = `${key}: ${f(row.produced)} produzidas · ${f(row.dispatched)} despachadas`;
      return el('div', { class: 'bar-column', title: tooltip }, [
        el('div', { class: 'bars' }, [
          el('div', { class: 'bar production', style: `height:${row.produced / max * 100}%` }),
          el('div', { class: 'bar dispatch', style: `height:${row.dispatched / max * 100}%` }),
        ]),
        el('small', { text: key }),
      ]);
    });
    $('productionChart').replaceChildren(...columns);
  }

  function pickDelegation(code) {
    state.activeMap = state.activeMap === code ? '' : code;
    renderMap();
  }
  async function loadMap() {
    try {
      const response = await fetch('/mocambique.svg');
      if (!response.ok) throw new Error('Não foi possível abrir o mapa.');
      state.map = window.ContaCartaMap.create($('mozambiqueMap'), await response.text(), {
        el, fmt: f, onPick: pickDelegation,
      });
      renderMap();
    } catch {
      $('mozambiqueMap').textContent = 'Mapa indisponível; consulte a tabela de delegações.';
    }
  }
  function renderMap() {
    if (!state.dashboard) return;
    $('mapUpdate').textContent = `INCAPE: ${readableTime(state.dashboard.updatedAt.pending)} · Produção: ${readableTime(state.dashboard.updatedAt.production)} · QC: ${readableTime(state.dashboard.updatedAt.quality)} · Despacho: ${readableTime(state.dashboard.updatedAt.dispatch)}`;
    const view = window.ContaCartaMap?.quantityView(state.dashboard.delegations, $('mapMetric').value) ?? { rows: state.dashboard.delegations };
    const rows = view.rows;
    const selected = rows.find((row) => row.code === state.activeMap);
    state.map?.paint(view, selected?.code);
    slideshow.setRows(state.map ? rows : []);
    $('clearMap').disabled = !selected;
    $('delegationTitle').textContent = selected ? `Em destaque: ${selected.name}` : 'Todas as delegações';
    $('delegationCount').textContent = rows.length === 1 ? '1 delegação' : `${rows.length} delegações`;
    const body = $('delegationRows');
    const focused = body.contains(document.activeElement) && document.activeElement.dataset.delegation;
    body.replaceChildren(...rows.map((place) => {
      const tr = el('tr', { class: place === selected ? 'map-picked' : '', title: place.pendingDate ? `INCAPE de ${place.pendingDate}; ${freshness(place.pendingUpdatedAt)}` : 'Sem consulta INCAPE' });
      const seat = el('button', {
        class: 'map-seat', type: 'button', 'data-delegation': place.code,
        'aria-pressed': String(place === selected), 'aria-controls': 'delegationRows mozambiqueMap',
      }, [el('i', { class: 'map-swatch', style: place.fill ? `background-color:${place.fill}` : '', 'aria-hidden': 'true' }),
        el('span', {}, [el('strong', { text: place.name }), el('small', { text: place.region ?? place.province })])]);
      tr.append(el('th', { scope: 'row' }, [seat]), cell(place.pending === null ? '—' : f(place.pending), true), cell(f(place.produced), true), cell(f(place.qcApproved), true), cell(f(place.dispatched), true));
      return tr;
    }));
    const sum = (field) => rows.reduce((total, row) => total + (row[field] ?? 0), 0);
    const coverage = rows.filter((row) => row.pending != null).length;
    const pending = cell(coverage ? f(sum('pending')) : '—', true);
    pending.title = `Consulta INCAPE em ${coverage} de ${rows.length} delegações`;
    $('delegationTotal').replaceChildren(el('th', { scope: 'row', text: 'Total' }), pending,
      ...['produced', 'qcApproved', 'dispatched'].map((field) => cell(f(sum(field)), true)));
    if (focused) [...body.querySelectorAll('button')].find((node) => node.dataset.delegation === focused)?.focus({ preventScroll: true });
  }

  function fillDelegations() {
    options($('entryDelegation'), state.delegations.map((item) => [item.code, item.name + ' · ' + item.province]), 'Escolher delegação');
  }
  function updateEntryForm() {
    const type = $('entryType').value;
    const config = KINDS[type];
    $('entryMachineWrap').hidden = type !== 'production' && type !== 'quality';
    $('entryMachine').querySelector('[value="0"]').hidden = type === 'production';
    if (type === 'production' && $('entryMachine').value === '0') $('entryMachine').value = '1';
    $('secondaryWrap').hidden = !config.secondary;
    $('entryPrimary').parentElement.firstChild.textContent = config.primary;
    $('secondaryLabel').textContent = config.secondary || '';
    $('entryHint').textContent = config.hint;
  }
  function setEntryDate(value) {
    const input = $('entryDate');
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }
  function resetEntry(keepSelection = false) {
    const previous = keepSelection ? {
      type: $('entryType').value, date: $('entryDate').value, machine: $('entryMachine').value,
    } : null;
    state.editing = null;
    $('entryForm').reset();
    $('entryType').value = previous?.type || 'pending';
    setEntryDate(validDay(previous?.date) ? previous.date : nowDate());
    $('entryDelegation').value = '';
    $('entryPrimary').value = '';
    $('entrySecondary').value = '';
    $('entryMachine').value = previous?.machine || '1';
    $('formTitle').textContent = 'Novo registo';
    $('editState').textContent = '';
    updateEntryForm();
  }
  function editEntry(kind, row) {
    showView('entry');
    $('entryType').value = kind;
    setEntryDate(row.date);
    $('entryDelegation').value = row.delegationCode;
    $('entryMachine').value = String(row.machine ?? '1');
    updateEntryForm();
    const config = { pending: ['quantity'], production: ['produced', 'rejected'], quality: ['approved', 'rejected'], dispatch: ['quantity'] }[kind];
    $('entryPrimary').value = String(row[config[0]]);
    $('entrySecondary').value = config[1] ? String(row[config[1]]) : '';
    state.editing = { kind, ...row };
    $('formTitle').textContent = 'Corrigir registo';
    $('editState').textContent = `Revisão ${row.revision} · ${readableTime(row.updatedAt)}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function entryPayload() {
    const kind = $('entryType').value;
    const data = { date: $('entryDate').value, delegationCode: $('entryDelegation').value, revision: state.editing?.revision ?? null };
    if (kind === 'production' || kind === 'quality') data.machine = Number($('entryMachine').value);
    const value = (id) => {
      const raw = $(id).value;
      return raw !== '' && /^\d+$/.test(raw) ? Number(raw) : NaN;
    };
    if (kind === 'pending' || kind === 'dispatch') data.quantity = value('entryPrimary');
    if (kind === 'production') { data.produced = value('entryPrimary'); data.rejected = value('entrySecondary'); }
    if (kind === 'quality') { data.approved = value('entryPrimary'); data.rejected = value('entrySecondary'); }
    return { kind, data };
  }
  async function saveEntry(event) {
    event.preventDefault();
    const { kind, data } = entryPayload();
    if (!validDay(data.date)) return announce('Data do registo inválida. Use dd/mm/aaaa.', true);
    if (state.editing && (kind !== state.editing.kind || data.date !== state.editing.date ||
      data.delegationCode !== state.editing.delegationCode ||
      ((kind === 'production' || kind === 'quality') && data.machine !== state.editing.machine))) {
      announce('Ao corrigir um registo não altere a sua data, delegação ou máquina. Crie outro registo e elimine o incorrecto.', true);
      return;
    }
    try {
      await api('/api/entries/' + kind, payload('PUT', data));
      resetEntry(true);
      announce('Dados gravados na base SQLite. O painel já pode apresentar estes números.');
      await Promise.all([refreshDashboard(), loadEntries()]);
    } catch (error) { announce(error.message, true); }
  }

  function historyQuery() {
    return dateRange($('historyStart').value, $('historyEnd').value);
  }
  async function loadEntries() {
    if (state.role !== 'fabrica') return;
    try {
      const { start, end } = historyQuery();
      state.records = await api('/api/entries?' + new URLSearchParams({ start, end }));
      if (state.view === 'history') renderHistory();
    } catch (error) { announce(error.message, true); }
  }
  function renderHistory() {
    const kind = $('historyType').value;
    const rows = state.records?.[kind] || [];
    const headers = ['Data', 'Delegação', ...(['production', 'quality'].includes(kind) ? ['Máquina'] : []),
      ...(kind === 'production' ? ['Produzidas', 'Rej. máquina'] : kind === 'quality' ? ['QC aprovadas', 'QC reprovadas'] : ['Quantidade']),
      'Actualizado', 'Acções'];
    $('historyHead').replaceChildren(el('tr', {}, headers.map((label) => el('th', { text: label }))));
    const names = new Map(state.delegations.map((item) => [item.code, item.name]));
    $('historyRows').replaceChildren(...rows.map((row) => {
      const actions = el('div', { class: 'action-group' });
      const edit = el('button', { class: 'btn btn-quiet', type: 'button', text: 'Corrigir' });
      edit.addEventListener('click', () => editEntry(kind, row));
      const remove = el('button', { class: 'btn btn-danger', type: 'button', text: 'Eliminar' });
      remove.addEventListener('click', async () => {
        if (!window.confirm(`Eliminar o registo de ${names.get(row.delegationCode)} de ${row.date}? Esta acção ficará na auditoria.`)) return;
        try {
          await api('/api/entries/' + kind, payload('DELETE', {
            date: row.date, delegationCode: row.delegationCode, machine: row.machine, revision: row.revision,
          }));
          announce('Registo eliminado e alteração guardada para auditoria.');
          await Promise.all([loadEntries(), refreshDashboard()]);
        } catch (error) { announce(error.message, true); }
      });
      actions.append(edit, remove);
      const tr = el('tr');
      tr.append(cell(row.date), cell(names.get(row.delegationCode) || row.delegationCode));
      if (kind === 'production' || kind === 'quality') tr.append(cell(row.machine ? 'Máquina ' + row.machine : 'Geral'));
      for (const field of kind === 'production' ? ['produced', 'rejected'] : kind === 'quality' ? ['approved', 'rejected'] : ['quantity'])
        tr.append(cell(f(row[field]), true));
      tr.append(cell(readableTime(row.updatedAt)), el('td', {}, actions));
      return tr;
    }));
    $('historyEmpty').hidden = Boolean(rows.length);
  }
  function exportCsv() {
    const kind = $('historyType').value;
    const rows = state.records?.[kind] || [];
    if (!rows.length) return announce('Não existem registos a exportar.', true);
    const cols = Object.keys(rows[0]);
    const escape = (value) => '"' + String(value ?? '').replaceAll('"', '""') + '"';
    const body = '\uFEFF' + [cols.join(';'), ...rows.map((row) => cols.map((col) => escape(row[col])).join(';'))].join('\r\n');
    const link = el('a', { href: URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' })), download: `conta-carta-${kind}-${nowDate().replaceAll('/', '-')}.csv` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function initializeData(role) {
    updateRole(role);
    const [delegations] = await Promise.all([api('/api/delegations'), refreshDashboard()]);
    state.delegations = delegations;
    fillDelegations();
    if (role === 'fabrica') await loadEntries();
    if (!state.map) await loadMap();
  }
  async function boot() {
    const today = nowDate();
    $('filterMonth').value = today.slice(3);
    $('filterYear').value = today.slice(6);
    $('filterStart').value = firstOfMonth(today);
    $('filterEnd').value = today;
    $('historyStart').value = firstOfMonth(today);
    $('historyEnd').value = today;
    $('entryDate').value = today;
    if (window.ContaCartaMap) {
      options($('mapMetric'), Object.entries(window.ContaCartaMap.INDICATORS).map(([key, { label }]) => [key, label]));
    } else $('mapMetric').disabled = true;
    window.ContaCartaCalendar({ $, el });
    updateFilterFields();
    updateEntryForm();
    try {
      const session = await api('/api/session');
      if (session.role) await initializeData(session.role);
      else {
        const setup = await api('/api/setup-status');
        showLogin(setup.ready ? '' : 'Antes de entrar, configure as contas no terminal: npm run setup');
      }
    } catch (error) { showLogin('Não foi possível abrir o servidor. Inicie a aplicação com npm start. ' + error.message); }
  }

  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('loginMessage').textContent = '';
    try {
      const result = await api('/api/login', payload('POST', { role: $('loginRole').value, password: $('loginPassword').value }));
      await initializeData(result.role);
    } catch (error) { $('loginMessage').textContent = error.message; }
  });
  $('logoutButton').addEventListener('click', async () => {
    try { await api('/api/logout', payload('POST', {})); }
    catch (error) { announce(error.message, true); }
    showLogin();
  });
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
  $('filterType').addEventListener('change', updateFilterFields);
  $('filterForm').addEventListener('submit', (event) => { event.preventDefault(); announce(''); refreshDashboard(); });
  window.addEventListener('beforeprint', () => {
    $('printStamp').textContent = `Impresso em ${readableTime(timestamp())} (hora de Maputo)`;
  });
  $('menuToggle').addEventListener('click', () => setMenu($('application').classList.contains('is-collapsed')));
  $('tvToggle').addEventListener('click', () => setTvMode(!$('application').classList.contains('tv-mode')));
  $('tvPace').addEventListener('change', () => slideshow.setSeconds(Number($('tvPace').value)));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && $('application').classList.contains('tv-mode')) setTvMode(false);
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && $('application').classList.contains('tv-mode')) setTvMode(false);
  });
  $('printDashboard').addEventListener('click', () => window.print());
  $('refreshButton').addEventListener('click', () => { refreshDashboard(); if (state.view === 'history') loadEntries(); });
  $('delegationRows').addEventListener('click', (event) => {
    const seat = event.target.closest('button[data-delegation]');
    if (seat) pickDelegation(seat.dataset.delegation);
  });
  $('mapMetric').addEventListener('change', renderMap);
  $('clearMap').addEventListener('click', () => pickDelegation(''));
  $('entryType').addEventListener('change', () => { state.editing = null; $('formTitle').textContent = 'Novo registo'; $('editState').textContent = ''; updateEntryForm(); });
  $('resetEntry').addEventListener('click', () => resetEntry(true));
  $('entryForm').addEventListener('submit', saveEntry);
  $('historyForm').addEventListener('submit', (event) => { event.preventDefault(); announce(''); loadEntries(); });
  $('historyType').addEventListener('change', renderHistory);
  $('exportCsv').addEventListener('click', exportCsv);
  document.addEventListener('visibilitychange', () => {
    slideshow.setVisible(!document.hidden);
    if (!document.hidden && state.role) refreshDashboard();
  });
  setInterval(() => { if (state.role) { if (!document.hidden) refreshDashboard(); else if (state.dashboard) renderDashboard(); } }, 60_000);
  boot();
})();
