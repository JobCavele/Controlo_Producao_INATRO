/*
 * Conta Carta · núcleo de dados (INATRO, IP)
 *
 * Módulo sem dependências nem acesso ao DOM: é usado pela aplicação no
 * navegador e pelos testes em Node. Contém o modelo de dados, a validação,
 * a migração de cópias antigas e todos os cálculos (totais, percentagens,
 * agregações por mês e exportação CSV).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ContaCartaCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 3;
  const MACHINES = ['Máquina 1', 'Máquina 2'];
  const PERIODS = ['day', 'month', 'range'];
  const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const WEEK_NAMES = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
  const FIRST = '1900-01-01';
  const LAST = '2200-12-31';
  const MAX_QUANTITY = 1000000000;
  const MAX_RECORDS = 5000;

  /* ------------------------------------------------- datas --- */

  const DAY_MS = 86400000;
  const asUtc = (iso) => Date.parse(iso + 'T00:00:00Z');
  const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

  function isDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    if (value < FIRST || value > LAST) return false;
    const ms = asUtc(value);
    return Number.isFinite(ms) && fromUtc(ms) === value; // rejeita 2026-02-30 e afins
  }

  function isMonth(value) {
    return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
      && +value.slice(0, 4) >= 1900 && +value.slice(0, 4) <= 2200;
  }

  function addDays(iso, count) { return fromUtc(asUtc(iso) + count * DAY_MS); }
  function daysBetween(start, end) { return Math.round((asUtc(end) - asUtc(start)) / DAY_MS) + 1; }
  function weekday(iso) { return (new Date(asUtc(iso)).getUTCDay() + 6) % 7; }

  /** Intervalo completo de um mês dado em `YYYY-MM`. */
  function monthRange(month) {
    const [year, index] = month.split('-').map(Number);
    const start = `${month}-01`;
    const end = fromUtc(Date.UTC(index === 12 ? year + 1 : year, index === 12 ? 0 : index, 0));
    return { start, end, days: daysBetween(start, end), label: monthLabel(month) };
  }

  function shiftMonth(month, offset) {
    const [year, index] = month.split('-').map(Number);
    const total = year * 12 + (index - 1) + offset;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
  }

  /** Semana de segunda a domingo que contém a data. */
  function weekRange(iso) {
    const start = addDays(iso, -weekday(iso));
    return { start, end: addDays(start, 6), days: 7, label: `Semana de ${shortDate(start)}` };
  }

  /* ---------------------------------------------- formatação --- */

  const number = new Intl.NumberFormat('pt-PT');
  const format = (value) => (value === null || value === undefined ? '—' : number.format(value));

  function percent(part, total) {
    if (typeof part !== 'number' || typeof total !== 'number' || total <= 0) return null;
    return Math.round((part / total) * 1000) / 10;
  }

  function formatPercent(value) {
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value) + '%';
  }

  function shortDate(iso) {
    const [y, m, d] = iso.split('-');
    return `${+d} ${MONTH_NAMES[+m - 1].slice(0, 3).toLowerCase()}. ${y}`;
  }

  function longDate(iso) {
    const [y, m, d] = iso.split('-');
    return `${+d} de ${MONTH_NAMES[+m - 1].toLowerCase()} de ${y}`;
  }

  const monthLabel = (month) => `${MONTH_NAMES[+month.slice(5, 7) - 1]} de ${month.slice(0, 4)}`;

  /** Rótulo legível de um registo: «5 out. 2026» ou «Outubro de 2026». */
  function periodLabel(start, end) {
    if (start === end) return shortDate(start);
    if (isMonth(start.slice(0, 7)) && start.slice(8) === '01' && monthRange(start.slice(0, 7)).end === end) {
      return monthLabel(start.slice(0, 7));
    }
    return `${shortDate(start)} – ${shortDate(end)}`;
  }

  function weekLabel(iso) { return `${WEEK_NAMES[weekday(iso)]}, ${shortDate(iso)}`; }

  /* ---------------------------------------------- registos --- */

  const clean = (value) => String(value ?? '').trim();

  /**
   * Lê uma quantidade digitada. Vazio conta como zero; só se aceitam inteiros
   * não negativos («1 250» e «1.250» contam como 1250; vírgulas são rejeitadas).
   */
  function readQuantity(raw, machineName, field) {
    const text = clean(raw).replace(/[\s\u00a0]/g, '');
    if (text === '') return 0;
    const digits = /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replaceAll('.', '') : text;
    if (!/^\d+$/.test(digits)) {
      throw new Error(`${machineName}: escreve ${field} em números inteiros, sem letras nem casas decimais.`);
    }
    const value = Number(digits);
    if (value > MAX_QUANTITY) {
      throw new Error(`${machineName}: ${field} tem de ser no máximo ${format(MAX_QUANTITY)}.`);
    }
    return value;
  }

  /** Constrói um registo a partir dos campos do formulário. */
  function makeRecord(input) {
    const period = PERIODS.includes(input.period) ? input.period : 'day';
    let start = clean(input.start);
    let end = clean(input.end);
    if (period === 'day') end = start;
    if (period === 'month') {
      if (!isMonth(start)) throw new Error('Escolhe o mês do registo na lista de meses.');
      ({ start, end } = monthRange(start));
    }
    if (!isDate(start)) throw new Error('Escolhe uma data de início válida.');
    if (!isDate(end)) throw new Error('Escolhe uma data final válida.');
    if (end < start) throw new Error('A data final não pode ser anterior à data de início.');

    const machines = MACHINES.map((name, index) => {
      const source = input.machines?.[index] || {};
      const produced = readQuantity(source.produced, name, 'as cartas produzidas');
      const rejected = readQuantity(source.rejected, name, 'as cartas rejeitadas');
      if (rejected > produced) {
        throw new Error(`${name}: ${format(rejected)} rejeitadas não cabem em ${format(produced)} produzidas. Corrige uma das duas quantidades.`);
      }
      return { produced, rejected };
    });

    const notes = clean(input.notes).slice(0, 500);
    return { id: clean(input.id) || generateId(), period, start, end, machines, notes };
  }

  function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* ------------------------------------------------ cálculo --- */

  /** Totais de um registo: aprovadas = produzidas − rejeitadas. */
  function totals(record) {
    const perMachine = (record.machines || []).map((machine) => {
      const produced = machine.produced || 0;
      const rejected = machine.rejected || 0;
      return { produced, rejected, approved: produced - rejected, approvalRate: percent(produced - rejected, produced) };
    });
    while (perMachine.length < MACHINES.length) {
      perMachine.push({ produced: 0, rejected: 0, approved: 0, approvalRate: null });
    }
    const sum = (key) => perMachine.reduce((total, machine) => total + machine[key], 0);
    const produced = sum('produced');
    const rejected = sum('rejected');
    const approved = sum('approved');
    const days = daysBetween(record.start, record.end);
    return {
      machines: perMachine, produced, rejected, approved, days,
      approvalRate: percent(approved, produced),
      rejectionRate: percent(rejected, produced),
      perDay: produced > 0 && days > 0 ? Math.round(produced / days) : 0,
    };
  }

  /** Registos totalmente contidos no intervalo e os que apenas o tocam. */
  function selectRecords(records, start, end) {
    const included = [], partial = [];
    for (const record of records) {
      if (record.start >= start && record.end <= end) included.push(record);
      else if (record.start <= end && record.end >= start) partial.push(record);
    }
    const byDate = (a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
    return { included: included.sort(byDate), partial: partial.sort(byDate) };
  }

  /**
   * Sumário de um intervalo: números por máquina, totais e percentagens.
   * Nada é repartido por dia — um registo só conta se estiver inteiro no período.
   */
  function summarise(state, start, end) {
    const { included, partial } = selectRecords(state.records, start, end);
    const machines = MACHINES.map(() => ({ produced: 0, rejected: 0, approved: 0 }));
    let daysCovered = 0;
    for (const record of included) {
      const totalsOf = totals(record);
      totalsOf.machines.forEach((machine, index) => {
        machines[index].produced += machine.produced;
        machines[index].rejected += machine.rejected;
        machines[index].approved += machine.approved;
      });
      daysCovered += totalsOf.days;
    }
    const totalsOf = (machine) => ({ ...machine, approvalRate: percent(machine.approved, machine.produced) });
    const produced = machines.reduce((sum, machine) => sum + machine.produced, 0);
    const rejected = machines.reduce((sum, machine) => sum + machine.rejected, 0);
    const approved = machines.reduce((sum, machine) => sum + machine.approved, 0);
    return {
      start, end,
      records: included,
      outside: partial,
      machines: machines.map(totalsOf),
      produced, rejected, approved,
      approvalRate: percent(approved, produced),
      rejectionRate: percent(rejected, produced),
      days: daysBetween(start, end),
      daysCovered: Math.min(daysCovered, daysBetween(start, end)),
      empty: included.length === 0,
    };
  }

  /**
   * Série para o gráfico do painel.
   * `month` — um ponto por mês do intervalo (visão mensal);
   * `record` — um ponto por registo somado (visão de período).
   */
  function series(state, start, end, groupBy) {
    if (groupBy === 'month') {
      const points = [];
      let cursor = start.slice(0, 7);
      const limit = end.slice(0, 7);
      while (cursor <= limit) {
        const { start: mStart, end: mEnd } = monthRange(cursor);
        points.push(point(monthLabel(cursor), MONTH_NAMES[+cursor.slice(5, 7) - 1].slice(0, 3), summarise(state, mStart, mEnd)));
        cursor = shiftMonth(cursor, 1);
      }
      return points;
    }
    return selectRecords(state.records, start, end).included
      .map((record) => point(periodLabel(record.start, record.end), record.start === record.end
        ? String(+record.start.slice(8))
        : shortDate(record.start), totals(record)));
  }

  const point = (full, label, totalsOf) => ({
    full, label,
    produced: totalsOf.produced, approved: totalsOf.approved, rejected: totalsOf.rejected,
    approvalRate: totalsOf.approvalRate,
  });

  /* ----------------------------------------------- estado --- */

  function emptyState() { return { version: VERSION, records: [] }; }

  const fail = (message) => { throw new Error(message); };

  /** Validação integral do estado. Todas as mensagens dizem o corrigir. */
  function validate(state) {
    if (!state || typeof state !== 'object') fail('Os dados não foram reconhecidos. Importa uma cópia exportada pelo Conta Carta.');
    if (state.version !== VERSION) fail(`A cópia é de uma versão anterior (v${state.version ?? '?'}). Usa «Importar cópia» para a converter.`);
    if (!Array.isArray(state.records)) fail('A cópia não tem uma lista de registos.');
    if (state.records.length > MAX_RECORDS) fail(`Só são aceites ${format(MAX_RECORDS)} registos por ficheiro.`);

    const ids = new Set();
    for (const [index, record] of state.records.entries()) {
      const where = `Registo ${index + 1}`;
      if (!record || typeof record !== 'object') fail(`${where}: formato inválido.`);
      if (typeof record.id !== 'string' || !record.id || record.id.length > 64) fail(`${where}: identificador inválido.`);
      if (ids.has(record.id)) fail(`${where}: o identificador está repetido na cópia.`);
      ids.add(record.id);
      if (!PERIODS.includes(record.period)) fail(`${where}: tipo de período desconhecido (${record.period}).`);
      if (!isDate(record.start) || !isDate(record.end)) fail(`${where}: datas fora do intervalo aceite (entre ${shortDate(FIRST)} e ${shortDate(LAST)}).`);
      if (record.end < record.start) fail(`${where}: a data final é anterior à inicial.`);
      if (record.period === 'day' && record.start !== record.end) fail(`${where}: um registo diário tem de ter a mesma data de início e fim.`);
      if (record.period === 'month' && (record.start.slice(8) !== '01' || monthRange(record.start.slice(0, 7)).end !== record.end)) {
        fail(`${where}: um registo mensal tem de corresponder a um mês completo.`);
      }
      if (!Array.isArray(record.machines) || record.machines.length !== MACHINES.length) fail(`${where}: são necessários valores das ${MACHINES.length} máquinas.`);
      record.machines.forEach((machine, machineIndex) => {
        const name = MACHINES[machineIndex];
        if (!machine || typeof machine !== 'object') fail(`${where}: ${name} sem valores.`);
        for (const key of ['produced', 'rejected']) {
          const value = machine[key];
          const label = key === 'produced' ? 'produção' : 'rejeição';
          if (!Number.isSafeInteger(value) || value < 0) fail(`${where}: ${name} tem um valor de ${label} inválido (${value}). Usa números inteiros a partir de zero.`);
          if (value > MAX_QUANTITY) fail(`${where}: ${name} ultrapassa o limite de ${format(MAX_QUANTITY)} cartas.`);
        }
        if (machine.rejected > machine.produced) fail(`${where}: ${name} rejeitou mais cartas do que produziu.`);
      });
      if (record.notes !== undefined && (typeof record.notes !== 'string' || record.notes.length > 500)) fail(`${where}: as notas não podem ter mais de 500 caracteres.`);
    }

    const conflict = firstConflict(state.records);
    if (conflict) {
      const [a, b] = conflict;
      fail(`«${periodLabel(a.start, a.end)}» e «${periodLabel(b.start, b.end)}» partilham dias. Cada carta só pode ser contada uma vez.`);
    }
    return state;
  }

  /** Par de registos com dias em comum, se existir (a base não permite duplicar contagens). */
  function firstConflict(records) {
    const ordered = records.slice().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    for (let i = 0; i < ordered.length - 1; i += 1) {
      if (ordered[i].end >= ordered[i + 1].start) return [ordered[i], ordered[i + 1]];
    }
    return null;
  }

  /** Registo já guardado que invade o período candidato (ignora o próprio `candidate`). */
  function overlapping(records, candidate) {
    return records.find((record) => record.id !== candidate.id
      && record.start <= candidate.end && candidate.start <= record.end) || null;
  }

  /* ---------------------------------------------- migração --- */

  /**
   * Traz cópias v1/v2 para o modelo actual. As quantidades por máquina são
   * conservadas; quando só existiam totais declarados, o registo é marcado
   * nas notas para que alguém confira a origem.
   */
  function migrate(input) {
    const data = typeof input === 'string' ? JSON.parse(input) : input;
    if (!data || typeof data !== 'object' || !Array.isArray(data.records)) fail('O ficheiro não tem registos para converter.');
    if (data.version === VERSION) return { version: VERSION, records: data.records.map((record) => normalize(record)) };
    if (data.version !== 1 && data.version !== 2) fail('Só se podem converter cópias das versões 1, 2 e 3 do Conta Carta.');
    if (data.version === 1 && data.demo) fail('Essa cópia é de demonstração. Exporta os teus registos reais e importa-os de novo.');

    const records = [];
    for (const legacy of data.records) {
      const values = Array.isArray(legacy.values) ? legacy.values : [];
      const pick = (index) => {
        const row = values[index] || {};
        return { produced: Number.isInteger(row.p) && row.p > 0 ? row.p : 0, rejected: Number.isInteger(row.r) && row.r > 0 ? row.r : 0 };
      };
      const machines = [pick(0), pick(1)];
      const declared = values[2] || {};
      let notes = clean(legacy.notes);
      if (machines.every((machine) => !machine.produced && !machine.rejected) && Number.isInteger(declared.p) && declared.p > 0) {
        // Registo antigo sem divisão por máquina: evita perder a produção.
        machines[0] = { produced: declared.p, rejected: Math.min(Number.isInteger(declared.r) ? declared.r : 0, declared.p) };
        notes = clean([notes, 'Convertido do total declarado; divide as quantidades pelas máquinas.'].join(' '));
      }
      const start = isDate(legacy.start) ? legacy.start : FIRST;
      const end = isDate(legacy.end) ? legacy.end : start;
      records.push(normalize({
        id: legacy.id,
        period: legacy.kind === 'daily' || start === end ? 'day' : (legacy.kind === 'report' && start.slice(8) === '01' && monthRange(start.slice(0, 7)).end === end ? 'month' : 'range'),
        start, end, machines, notes,
      }));
    }
    // Registos antigos podiam sobrepor-se; mantém-se o mais completo e o resto
    // fica registado nas notas para revisão manual.
    const kept = [];
    for (const record of records.sort((a, b) => (a.start < b.start ? -1 : 1))) {
      const clash = kept.find((other) => other.start <= record.end && record.start <= other.end);
      if (clash) {
        clash.notes = clean([clash.notes, `Tinha também «${periodLabel(record.start, record.end)}», que ficou de fora por sobreposição.`].join(' '));
        continue;
      }
      kept.push(record);
    }
    return { version: VERSION, records: kept };
  }

  /** Garante a forma interna de um registo, independentemente da origem. */
  function normalize(record) {
    let start = isDate(record.start) ? record.start : FIRST;
    let end = isDate(record.end) ? record.end : start;
    if (end < start) [start, end] = [end, start]; // cópias antigas vinham por vezes às avessas
    const machines = MACHINES.map((_, index) => {
      const machine = record.machines?.[index] || {};
      const produced = Number.isInteger(machine.produced) && machine.produced >= 0 ? Math.min(machine.produced, MAX_QUANTITY) : 0;
      const rejected = Number.isInteger(machine.rejected) && machine.rejected >= 0 ? Math.min(machine.rejected, produced) : 0;
      return { produced, rejected };
    });
    const period = PERIODS.includes(record.period)
      ? (record.period === 'day' && start !== end ? 'range' : record.period)
      : (start === end ? 'day' : 'range');
    return {
      id: typeof record.id === 'string' && record.id ? record.id.slice(0, 64) : generateId(),
      period: period === 'month' && (start.slice(8) !== '01' || monthRange(start.slice(0, 7)).end !== end) ? 'range' : period,
      start, end, machines,
      notes: typeof record.notes === 'string' ? record.notes.slice(0, 500) : '',
    };
  }

  /** Ordena por data decrescente (o mais recente em primeiro) para as listas. */
  function byDateDesc(records) { return records.slice().sort((a, b) => (a.start > b.start ? -1 : a.start < b.start ? 1 : 0)); }
  function mostRecent(records) { return byDateDesc(records)[0] || null; }

  /* ------------------------------------ comparação e análise --- */

  /** Quantos períodos uma comparação pode abraçar de cada vez. */
  const MAX_COMPARE = { months: 36, years: 12 };
  const COMPARE_KINDS = ['months', 'years'];

  /** Intervalo completo de um ano. */
  function yearRange(year) {
    const number = Math.trunc(Number(year));
    if (!Number.isInteger(number) || number < 1900 || number > 2200) {
      throw new Error('Escolhe um ano entre 1900 e 2200.');
    }
    const start = `${number}-01-01`;
    const end = `${number}-12-31`;
    return { start, end, days: daysBetween(start, end), label: String(number) };
  }

  /** Meses (inclusive) entre dois `YYYY-MM`; a ordem é normalizada. */
  function monthsBetween(from, to) {
    if (!isMonth(from) || !isMonth(to)) throw new Error('Escolhe os dois meses da comparação.');
    let first = from <= to ? from : to;
    const last = from <= to ? to : from;
    const months = [];
    while (first <= last) {
      months.push(first);
      first = shiftMonth(first, 1);
    }
    if (months.length > MAX_COMPARE.months) {
      throw new Error(`São ${format(months.length)} meses. Compara no máximo ${MAX_COMPARE.months} de cada vez.`);
    }
    return months;
  }

  /** Anos (inclusive) entre dois anos. */
  function yearsBetween(from, to) {
    const firstNumber = Math.trunc(Number(from)), lastNumber = Math.trunc(Number(to));
    if (!Number.isInteger(firstNumber) || !Number.isInteger(lastNumber)) throw new Error('Escolhe os dois anos da comparação.');
    const low = Math.min(firstNumber, lastNumber), high = Math.max(firstNumber, lastNumber);
    if (low < 1900 || high > 2200) throw new Error('Os anos têm de estar entre 1900 e 2200.');
    const years = [];
    for (let year = low; year <= high; year += 1) years.push(year);
    if (years.length > MAX_COMPARE.years) {
      throw new Error(`São ${format(years.length)} anos. Compara no máximo ${MAX_COMPARE.years} de cada vez.`);
    }
    return years;
  }

  /**
   * Períodos que entram numa comparação. `onlyExtremes` deixa só o primeiro e o
   * último, que é o que se quer quando se comparam dois meses afastados.
   */
  function comparePeriods(kind, from, to, options = {}) {
    if (kind === 'years') {
      return yearsBetween(from, to).map((year) => {
        const range = yearRange(year);
        return { key: range.label, label: range.label, short: range.label, start: range.start, end: range.end, days: range.days };
      });
    }
    const months = monthsBetween(from, to).map((month) => {
      const range = monthRange(month);
      const abbr = MONTH_NAMES[+month.slice(5, 7) - 1].slice(0, 3);
      return { key: month, label: range.label, short: `${abbr} ${month.slice(2, 4)}`, start: range.start, end: range.end, days: range.days };
    });
    if (options.onlyExtremes && months.length > 2) return [months[0], months[months.length - 1]];
    return months;
  }

  /**
   * Comparação entre períodos: um resumo por período e a variação face ao
   * anterior. É leitura por cima dos mesmos registos — nada é guardado nem
   * repartido: um registo conta no período em que couber inteiro.
   */
  function compare(state, periods) {
    const rows = periods.map((period) => {
      const summary = summarise(state, period.start, period.end);
      return {
        key: period.key, label: period.label, short: period.short || period.label,
        start: summary.start, end: summary.end, days: summary.days, daysCovered: summary.daysCovered,
        produced: summary.produced, approved: summary.approved, rejected: summary.rejected,
        approvalRate: summary.approvalRate, rejectionRate: summary.rejectionRate,
        machines: summary.machines, records: summary.records.length, outside: summary.outside.length,
        perDay: summary.produced > 0 && summary.days > 0 ? Math.round(summary.produced / summary.days) : 0,
        empty: summary.empty, delta: null,
      };
    });
    rows.forEach((row, index) => {
      const previous = rows[index - 1];
      if (!previous) return;
      row.delta = {
        produced: row.produced - previous.produced,
        approved: row.approved - previous.approved,
        rejected: row.rejected - previous.rejected,
        rate: row.approvalRate !== null && previous.approvalRate !== null
          ? Math.round((row.approvalRate - previous.approvalRate) * 10) / 10
          : null,
      };
    });
    const add = (key) => rows.reduce((total, row) => total + row[key], 0);
    const measured = rows.filter((row) => !row.empty);
    const ordered = measured.slice().sort((a, b) => b.approvalRate - a.approvalRate);
    const span = rows.length ? summarise(state, rows[0].start, rows[rows.length - 1].end) : null;
    const produced = add('produced');
    return {
      rows,
      start: rows.length ? rows[0].start : null,
      end: rows.length ? rows[rows.length - 1].end : null,
      periods: rows.length,
      measured: measured.length,
      empty: measured.length === 0,
      total: {
        produced, approved: add('approved'), rejected: add('rejected'),
        records: add('records'), days: add('days'), daysCovered: add('daysCovered'),
        approvalRate: percent(add('approved'), produced),
        rejectionRate: percent(add('rejected'), produced),
      },
      span,
      best: ordered[0] || null,
      worst: ordered.length > 1 ? ordered[ordered.length - 1] : null,
      series: rows.map((row) => ({
        label: row.short, full: row.label,
        produced: row.produced, approved: row.approved, rejected: row.rejected, approvalRate: row.approvalRate,
      })),
    };
  }

  /** Frase de leitura da comparação: a mesma no ecrã e no papel. */
  function compareReading(result) {
    if (!result || !result.best) return '';
    if (!result.worst) {
      return `Só ${result.best.label} tem produção: ${formatPercent(result.best.approvalRate)} de aprovação.`;
    }
    const gap = Math.round((result.best.approvalRate - result.worst.approvalRate) * 10) / 10;
    return `Melhor aprovação em ${result.best.label} (${formatPercent(result.best.approvalRate)}); a mais baixa é `
      + `${result.worst.label} (${formatPercent(result.worst.approvalRate)}) — diferença de ${format(gap)} pontos.`;
  }

  /** Comparação entre dois períodos vizinhos — o «vs. anterior» do painel. */
  function compareWithPrevious(state, start, end) {
    const length = daysBetween(start, end);
    const previousEnd = addDays(start, -1);
    if (!isDate(previousEnd)) return null;
    const previousStart = addDays(previousEnd, -(length - 1));
    if (previousStart < FIRST) return null;
    const now = summarise(state, start, end), before = summarise(state, previousStart, previousEnd);
    const rate = (row) => row.approvalRate;
    return {
      start: previousStart, end: previousEnd,
      produced: now.produced - before.produced,
      approved: now.approved - before.approved,
      rejected: now.rejected - before.rejected,
      rate: rate(now) !== null && rate(before) !== null ? Math.round((rate(now) - rate(before)) * 10) / 10 : null,
      empty: before.empty,
    };
  }

  /* -------------------------------------------------- CSV --- */

  /** Célula segura para o Excel: texto escapado e fórmulas neutralizadas. */
  function csvCell(value) {
    const text = value === null || value === undefined ? '' : String(value);
    const guarded = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
    return '"' + guarded.replaceAll('"', '""') + '"';
  }

  /** CSV do sumário: cabeçalho institucional, totais e um linha por registo. */
  function buildCSV(summary) {
    const rows = [
      ['Sistema', 'Conta Carta · INATRO, IP'],
      ['Período', `${summary.start} a ${summary.end}`],
      ['Etiqueta', summary.label || periodLabel(summary.start, summary.end)],
      ['Registos somados', summary.records.length],
      ['Dias do período', summary.days],
      ['Dias com registo', summary.daysCovered],
      [],
      ['Origem', 'Produzidas', 'Aprovadas', 'Rejeitadas', 'Taxa de aprovação (%)'],
      ...summary.machines.map((machine, index) => [MACHINES[index], machine.produced, machine.approved, machine.rejected, machine.approvalRate ?? '']),
      ['Total', summary.produced, summary.approved, summary.rejected, summary.approvalRate ?? ''],
      [],
    ];
    for (const record of summary.records) {
      const totalsOf = totals(record);
      rows.push([periodLabel(record.start, record.end), totalsOf.produced, totalsOf.approved, totalsOf.rejected, totalsOf.approvalRate ?? '']);
      totalsOf.machines.forEach((machine, index) => rows.push([`  ${MACHINES[index]}`, machine.produced, machine.approved, machine.rejected, machine.approvalRate ?? '']));
    }
    return '\uFEFF' + rows.map((row) => (row.length ? row.map(csvCell) : ['']).join(';')).join('\r\n');
  }

  /** CSV da comparação: uma linha por período, com a variação face ao anterior. */
  function buildCompareCSV(result, title) {
    const rows = [
      ['Sistema', 'Conta Carta · INATRO, IP'],
      ['Comparação', title || 'Períodos comparados'],
      ['Intervalo', result.start ? `${result.start} a ${result.end}` : '—'],
      ['Períodos', result.periods],
      ['Com registos', result.measured],
      [],
      ['Período', 'Registos', 'Produzidas', 'Aprovadas', 'Rejeitadas', 'Taxa de aprovação (%)',
        'Variação da taxa (pontos)', 'Cartas por dia', 'Dias com registo', 'Dias do período'],
    ];
    for (const row of result.rows) {
      rows.push([row.label, row.records, row.produced, row.approved, row.rejected, row.approvalRate ?? '',
        row.delta && row.delta.rate !== null ? row.delta.rate : '', row.perDay, row.daysCovered, row.days]);
    }
    const total = result.total;
    rows.push(['Total comparado', total.records, total.produced, total.approved, total.rejected, total.approvalRate ?? '',
      '', '', total.daysCovered, total.days], []);
    return '\uFEFF' + rows.map((row) => (row.length ? row.map(csvCell) : ['']).join(';')).join('\r\n');
  }

  return {
    VERSION, MACHINES, PERIODS, MONTH_NAMES, FIRST, LAST, MAX_QUANTITY, MAX_COMPARE, COMPARE_KINDS,
    isDate, isMonth, addDays, daysBetween, daysInMonth: (month) => monthRange(month).days,
    monthRange, shiftMonth, weekRange, weekday,
    format, percent, formatPercent, shortDate, longDate, monthLabel, periodLabel, weekLabel,
    readQuantity, makeRecord, generateId, totals, selectRecords, summarise, series,
    emptyState, validate, firstConflict, overlapping, migrate, normalize, byDateDesc, mostRecent,
    yearRange, monthsBetween, yearsBetween, comparePeriods, compare, compareWithPrevious, compareReading,
    buildCompareCSV,
    csvCell, buildCSV,
  };
});
