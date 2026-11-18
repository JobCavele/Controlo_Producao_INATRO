/* Conta Carta: interface única, exclusivamente ligada à API SQLite. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const f = (value) => new Intl.NumberFormat('pt-MZ').format(value || 0);
  const dateFmt = new Intl.DateTimeFormat('pt-MZ', { timeZone: 'Africa/Maputo', dateStyle: 'short' });
  const timeFmt = new Intl.DateTimeFormat('pt-MZ', { timeZone: 'Africa/Maputo', dateStyle: 'short', timeStyle: 'short' });
  const nowDate = () => new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Africa/Maputo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const today = nowDate();
  const state = {
    role: null, dashboard: null, delegations: [], records: null, editing: null,
    map: null, activeMap: {}, view: 'dashboard', updating: false, requestId: 0,
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
  function readableDate(value) { return value ? dateFmt.format(new Date(value + 'T12:00:00Z')) : '—'; }
  function readableTime(value) { return value ? timeFmt.format(new Date(value)) : 'Sem registos'; }
  function freshness(value) {
    if (!value) return 'Ainda sem actualização';
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
    const ago = minutes < 1 ? 'há menos de 1 minuto' : minutes < 60 ? `há ${minutes} min` : minutes < 1440 ? `há ${Math.floor(minutes / 60)} h` : `há ${Math.floor(minutes / 1440)} dias`;
    return `Actualizado ${ago} · ${readableTime(value)}`;
  }
  const options = (select, items, placeholder) => {
    select.replaceChildren(...(placeholder ? [el('option', { value: '', text: placeholder })] : []),
      ...items.map(([value, label]) => el('option', { value, text: label })));
  };
  function updateRole(role) {
    state.role = role;
    $('loginScreen').hidden = true;
    $('application').hidden = false;
    $('activeRole').textContent = role === 'pca' ? 'PCA · Leitura' : 'Fábrica · Edição';
    document.querySelectorAll('.staff-only').forEach((node) => { node.hidden = role !== 'fabrica'; });
    showView('dashboard');
  }
  function showLogin(message = '') {
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
    state.view = name;
    for (const view of ['dashboard', 'entry', 'history']) $('view-' + view).hidden = view !== name;
    document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
    const titles = { dashboard: ['Visão geral', 'Indicadores por período e delegação'], entry: ['Introduzir dados', 'Registo das quantidades recolhidas na fábrica e no INCAPE'], history: ['Histórico e correcções', 'Consulta, edição e auditoria dos registos'] };
    $('viewTitle').textContent = titles[name][0];
    $('viewDescription').textContent = titles[name][1];
    if (name === 'history') loadEntries();
    if (name === 'entry') $('entryDate').focus();
  }

  function datesForFilter() {
    const mode = $('filterType').value;
    if (mode === 'month') {
      const month = $('filterMonth').value;
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Escolha um mês válido.');
      const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
      return { start: month + '-01', end: month + '-' + String(last).padStart(2, '0') };
    }
    if (mode === 'year') {
      const year = Number($('filterYear').value);
      if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new Error('Escolha um ano válido.');
      return { start: year + '-01-01', end: year + '-12-31' };
    }
    const start = $('filterStart').value, end = $('filterEnd').value;
    if (!start || !end || start > end) throw new Error('Seleccione um intervalo de datas válido.');
    return { start, end };
  }
  function updateFilterFields() {
    const mode = $('filterType').value;
    $('monthWrap').hidden = mode !== 'month';
    $('yearWrap').hidden = mode !== 'year';
    $('startWrap').hidden = mode !== 'range';
    $('endWrap').hidden = mode !== 'range';
  }
  async function refreshDashboard() {
    if (!state.role || state.updating) return;
    state.updating = true;
    const seq = ++state.requestId;
    $('connectionStatus').textContent = '● A actualizar…';
    try {
      const { start, end } = datesForFilter();
      const dashboard = await api('/api/dashboard?' + new URLSearchParams({ start, end }));
      if (seq !== state.requestId) return;
      state.dashboard = dashboard;
      $('connectionStatus').textContent = '● Dados sincronizados';
      $('connectionStatus').classList.remove('offline');
      $('periodCaption').textContent = `${readableDate(start)} — ${readableDate(end)}`;
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
    $('kpiGrid').replaceChildren(...cards.map(([title, value, hint, kind, colour]) => el('article', { class: 'card kpi ' + colour }, [
      el('span', { class: 'label', text: title }),
      el('strong', { text: kind === 'pending' && !t.pendingCoverage ? '—' : f(value) }),
      el('p', { class: 'hint', text: hint }),
      el('span', { class: 'freshness', text: freshness(updated[kind]) }),
    ])));
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
    const span = (Date.parse(data.end) - Date.parse(data.start)) / 86400000;
    const monthly = span > 61;
    const slots = new Map();
    if (monthly) {
      for (let month = data.start.slice(0, 7); month <= data.end.slice(0, 7);) {
        slots.set(month, { produced: 0, dispatched: 0 });
        const [y, m] = month.split('-').map(Number);
        month = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
      }
    } else {
      for (let time = Date.parse(data.start + 'T00:00:00Z'); time <= Date.parse(data.end + 'T00:00:00Z'); time += 86400000)
        slots.set(new Date(time).toISOString().slice(0, 10), { produced: 0, dispatched: 0 });
    }
    for (const row of data.series) {
      const key = monthly ? row.date.slice(0, 7) : row.date;
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
        el('small', { text: monthly ? key.slice(5) + '/' + key.slice(2, 4) : key.slice(8) }),
      ]);
    });
    $('productionChart').replaceChildren(...columns);
  }

  async function loadMap() {
    try {
      const response = await fetch('/mocambique.svg');
      if (!response.ok) throw new Error('Não foi possível abrir o mapa.');
      const svg = await response.text();
      state.map = window.ContaCartaMap.create($('mozambiqueMap'), svg, {
        el, fmt: f,
        onPick: (choice) => {
          state.activeMap = JSON.stringify(choice) === JSON.stringify(state.activeMap) ? {} : choice;
          renderMap();
        },
      });
      renderMap();
    } catch {
      $('mozambiqueMap').textContent = 'Mapa indisponível; consulte a tabela de delegações.';
    }
  }
  function renderMap() {
    if (!state.dashboard) return;
    $('mapUpdate').textContent = `INCAPE: ${readableTime(state.dashboard.updatedAt.pending)} · Produção: ${readableTime(state.dashboard.updatedAt.production)} · QC: ${readableTime(state.dashboard.updatedAt.quality)} · Despacho: ${readableTime(state.dashboard.updatedAt.dispatch)}`;
    const places = state.dashboard.delegations;
    if (state.map) {
      const totals = new Map();
      for (const place of places) totals.set(place.province, (totals.get(place.province) || 0) + place.produced);
      state.map.paint({ totals, active: state.activeMap, delegations: places });
    }
    const active = state.activeMap;
    const rows = places.filter((place) => (!active.province || place.province === active.province) && (!active.point || place.name === active.point));
    $('delegationTitle').textContent = active.point || active.province || 'Todas as delegações';
    $('delegationCount').textContent = `${rows.length} delegações`;
    $('delegationRows').replaceChildren(...rows.map((place) => {
      const tr = el('tr', { title: place.pendingDate ? `INCAPE de ${readableDate(place.pendingDate)}; ${freshness(place.pendingUpdatedAt)}` : 'Sem consulta INCAPE' });
      tr.append(cell(place.name), cell(place.pending === null ? '—' : f(place.pending), true), cell(f(place.produced), true), cell(f(place.qcApproved), true), cell(f(place.dispatched), true));
      return tr;
    }));
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
  function resetEntry(keepSelection = false) {
    const previous = keepSelection ? {
      type: $('entryType').value, date: $('entryDate').value, machine: $('entryMachine').value,
    } : null;
    state.editing = null;
    $('entryForm').reset();
    $('entryType').value = previous?.type || 'pending';
    $('entryDate').value = previous?.date || nowDate();
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
    $('entryDate').value = row.date;
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
    const start = $('historyStart').value, end = $('historyEnd').value;
    if (!start || !end || start > end) throw new Error('Introduza datas de pesquisa válidas.');
    return { start, end };
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
        if (!window.confirm(`Eliminar o registo de ${names.get(row.delegationCode)} de ${readableDate(row.date)}? Esta acção ficará na auditoria.`)) return;
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
      tr.append(cell(readableDate(row.date)), cell(names.get(row.delegationCode) || row.delegationCode));
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
    const link = el('a', { href: URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' })), download: `conta-carta-${kind}-${nowDate()}.csv` });
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
    $('filterMonth').value = today.slice(0, 7);
    $('filterYear').value = today.slice(0, 4);
    $('filterStart').value = today.slice(0, 7) + '-01';
    $('filterEnd').value = today;
    $('historyStart').value = today.slice(0, 7) + '-01';
    $('historyEnd').value = today;
    $('entryDate').value = today;
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
  $('filterForm').addEventListener('submit', (event) => { event.preventDefault(); refreshDashboard(); });
  $('printDashboard').addEventListener('click', () => window.print());
  $('refreshButton').addEventListener('click', () => { refreshDashboard(); if (state.view === 'history') loadEntries(); });
  $('clearMap').addEventListener('click', () => { state.activeMap = {}; renderMap(); });
  $('entryType').addEventListener('change', () => { state.editing = null; $('formTitle').textContent = 'Novo registo'; $('editState').textContent = ''; updateEntryForm(); });
  $('resetEntry').addEventListener('click', () => resetEntry(true));
  $('entryForm').addEventListener('submit', saveEntry);
  $('historyForm').addEventListener('submit', (event) => { event.preventDefault(); loadEntries(); });
  $('historyType').addEventListener('change', renderHistory);
  $('exportCsv').addEventListener('click', exportCsv);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.role) refreshDashboard(); });
  setInterval(() => { if (state.role) { if (!document.hidden) refreshDashboard(); else if (state.dashboard) renderDashboard(); } }, 60_000);
  boot();
})();
