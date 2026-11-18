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

  const VERSION = 6;
  const MACHINES = ['Máquina 1', 'Máquina 2'];
  const PERIODS = ['day', 'month', 'range'];
  const WEEK_NAMES = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
  // Nomes por extenso usados apenas em rótulos para leitura humana («Setembro de 2026»); guardar e ordenar é sempre numérico
  const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho',
    'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  /**
   * Os motivos de rejeição que o INCAPE usa no teste de qualidade. O código é o
   * que fica guardado; o rótulo é o que se lê no ecrã, no papel e no CSV.
   */
  const REASONS = [
    { code: 'bio-foto', group: 'Bio data', label: 'Biometria: foto ou assinatura errada' },
    { code: 'bio-outra', group: 'Bio data', label: 'Biometria: outro erro nos dados' },
    { code: 'scan-foto', group: 'Scan', label: 'Digitalização: qualidade da foto inaceitável' },
    { code: 'material-lamina', group: 'Material', label: 'Material: laminado defeituoso' },
    { code: 'material-riscos', group: 'Material', label: 'Material: riscos' },
    { code: 'cartao-reutilizado', group: 'Cartão reutilizado', label: 'Cartão reutilizado: leitura fraca («bad vision»)' },
    // saída para o que não cabe nos seis: fica contado, não fica no esquecimento
    { code: 'outro', group: 'Outro', label: 'Outro motivo (dizer nas notas)' },
  ];
  const REASON_CODES = REASONS.map((reason) => reason.code);
  const MACHINE_KEYS = ['m1', 'm2'];
  // Um lote anda sempre por esta ordem: personalizado → impresso → verificado → enviado.
  const LOT_STAGES = ['personalizacao', 'impressao', 'qualidade', 'despacho'];
  const LOT_STAGE_LABELS = {
    personalizacao: 'Personalização', impressao: 'Impressão',
    qualidade: 'Qualidade', despacho: 'Despacho',
  };
  const LOT_STATUS = ['pendente', 'em-curso', 'feito'];
  const LOT_STATUS_LABELS = { pendente: 'Por fazer', 'em-curso': 'Em curso', feito: 'Feito' };
  /**
   * Os 25 itens do contrato CT/45A001341/AD/0035/2025 (estágio de entrega de
   * consumíveis). É a lista de onde o armazém parte: em vez de escrever o nome
   * do material, escolhe-se daqui e só se preenchem as quantidades.
   */
  const CATALOGUE = [
    { name: 'Cartão em Branco - Carta de Condução', kind: 'cartao', unit: 'un.', contracted: 120000 },
    { name: 'Tonner Amarelo (MB-Ink-E-WF-alf-H-D-Y-yellow)', kind: 'tonner', unit: 'un.', contracted: 22 },
    { name: 'Tonner Magenta (MB-Ink-E-WF-alf-H-D-M-magenta)', kind: 'tonner', unit: 'un.', contracted: 27 },
    { name: 'Tonner Ciano (MB-Ink-E-WF-alf-H-D-cyan)', kind: 'tonner', unit: 'un.', contracted: 26 },
    { name: 'Tonner Preto (MB-Ink-E-WF-alf-H-D-Black)', kind: 'tonner', unit: 'un.', contracted: 4 },
    { name: 'Tinteiro de Revestimento de Cartões', kind: 'tinteiro', unit: 'un.', contracted: 5 },
    { name: 'Lenço de Limpeza de Impressora de Sera (Pacote)', kind: 'limpeza', unit: 'pacote', contracted: 30 },
    { name: 'Cotonetes (Pacote)', kind: 'limpeza', unit: 'pacote', contracted: 10 },
    { name: 'Caixa de Manutenção', kind: 'manutencao', unit: 'caixa', contracted: 40 },
    { name: 'Papel para Impressora Seiko (rolo)', kind: 'papel', unit: 'rolo', contracted: 30 },
    { name: 'Black Tonner for Brother HL-L2310D Printer', kind: 'tonner', unit: 'un.', contracted: 10 },
    { name: 'Trituradora de Cartões (Shredder)', kind: 'manutencao', unit: 'un.', contracted: 1 },
    { name: 'Tinteiro Preto HP 410A', kind: 'tinteiro', unit: 'un.', contracted: 25 },
    { name: 'Tinteiro Amarelo HP 410A', kind: 'tinteiro', unit: 'un.', contracted: 2 },
    { name: 'Tinteiro Magenta HP 410A', kind: 'tinteiro', unit: 'un.', contracted: 2 },
    { name: 'Tinteiro Ciano HP 410A', kind: 'tinteiro', unit: 'un.', contracted: 2 },
    { name: 'Tinteiro Preto HP 136A', kind: 'tinteiro', unit: 'un.', contracted: 13 },
    { name: 'Caixa de Papel para empacotamento de Cartas de Condução', kind: 'papel', unit: 'caixa', contracted: 5000 },
    { name: 'Água destilada (Garrafa 1L)', kind: 'outro', unit: 'garrafa', contracted: 30 },
    { name: 'Luvas Descartáveis (Pacote de 20un)', kind: 'limpeza', unit: 'pacote', contracted: 8 },
    { name: 'Cotonetes (Pacote de 200un)', kind: 'limpeza', unit: 'pacote', contracted: 50 },
    { name: 'Resma de Papel A4 (caixa de 5resmas)', kind: 'papel', unit: 'caixa', contracted: 6 },
    { name: 'Fita Cola (rolo)', kind: 'outro', unit: 'rolo', contracted: 50 },
    { name: 'Pano Multiuso de Limpeza de Máquina (Azul)', kind: 'limpeza', unit: 'un.', contracted: 30 },
    { name: 'Álcool (Garrafa de 1L)', kind: 'outro', unit: 'garrafa', contracted: 15 },
  ];

  // A prateleira do armazém: cartões em branco e material de consumo, como no mapa do contrato.
  const STOCK_KINDS = ['cartao', 'tonner', 'tinteiro', 'limpeza', 'manutencao', 'papel', 'outro'];
  const STOCK_KIND_LABELS = {
    cartao: 'Cartão em branco', tonner: 'Tonner', tinteiro: 'Tinteiro',
    limpeza: 'Limpeza', manutencao: 'Manutenção', papel: 'Papel', outro: 'Outro',
  };
  const FIRST = '1900-01-01';
  const LAST = '2200-12-31';
  const MAX_QUANTITY = 1000000000;
  const MAX_RECORDS = 5000;
  const MAX_ENTRIES = 300;

  /* ------------------------------------------------- datas --- */

  const DAY_MS = 86400000;
  const asUtc = (iso) => Date.parse(iso + 'T00:00:00Z');
  const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
  const two = (value) => String(value).padStart(2, '0');

  /**
   * Lê uma data tal como é escrita no sistema — `dd/mm/yyyy` — e também em ISO
   * (`yyyy-mm-dd`, a forma interna). Devolve sempre ISO, ou `null` se a data não
   * existir. É a única porta de entrada de datas escritas à mão.
   */
  function parseDate(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    const written = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const iso = written ? `${written[3]}-${two(written[2])}-${two(written[1])}` : text;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso < FIRST || iso > LAST) return null;
    const ms = asUtc(iso);
    return Number.isFinite(ms) && fromUtc(ms) === iso ? iso : null; // rejeita 30/02/2026 e afins
  }

  /** Data interna (ISO) válida? Só a forma guardada; o que se escreve passa por `parseDate`. */
  function isDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && parseDate(value) === value;
  }

  const monthNameOf = (month) => `${MONTH_NAMES[+month.slice(5, 7) - 1]} de ${month.slice(0, 4)}`;

  /** Lê um mês escrito `mm/yyyy` (ou em ISO `yyyy-mm`) e devolve `yyyy-mm`, ou `null`. */
  function parseMonth(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    const written = text.match(/^(\d{1,2})\/(\d{4})$/);
    const iso = written ? `${written[2]}-${two(written[1])}` : text;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(iso)) return null;
    return +iso.slice(0, 4) >= 1900 && +iso.slice(0, 4) <= 2200 ? iso : null;
  }

  /** Mês interno (ISO `yyyy-mm`) válido? */
  function isMonth(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) && parseMonth(value) === value;
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

  /** Um número com sinal à frente («+360», «−12», «±0»), opcionalmente com sufixo. */
  const signed = (value, suffix) => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${format(Math.abs(value))}${suffix || ''}`;

  /**
   * Quanto do total rejeitado vem de uma das rejeições (a da máquina ou a do
   * teste). Devolve `null` quando não há nada rejeitado — nesse caso escreve-se
   * um traço, não um zero.
   */
  function rejectionShare(summary, type) {
    const chosen = type === 'machine' ? summary.rejected : summary.qualityRejected;
    const total = summary.rejected + summary.qualityRejected;
    return total > 0 ? percent(chosen, total) : null;
  }

  /**
   * As dez linhas da comparação lado a lado, já como texto e sinal. O papel
   * do ecrã e o PDF desenham esta mesma lista: uma regra, dois desenhos.
   * `good` diz se a diferença é uma boa notícia (mais produção) ou má (mais
   * rejeição), para cada um pintar com a cor da casa.
   */
  function comparisonRows(comparison) {
    const [a, b] = comparison.rows;
    const rate = (value) => (value === null || value === undefined ? '—' : formatPercent(value));
    const gap = (key) => (a[key] === null || b[key] === null || a[key] === undefined || b[key] === undefined
      ? null : Math.round((b[key] - a[key]) * 10) / 10);
    const line = (label, first, second, diff, good) => ({ label, first: String(first), second: String(second), diff: String(diff), good });
    const num = (label, key) => line(label, format(a[key]), format(b[key]), signed(b[key] - a[key]), b[key] >= a[key]);
    const scrap = (label, key) => line(label, format(a[key]), format(b[key]), signed(b[key] - a[key]), b[key] <= a[key]);
    const rateLine = (label, key, invert) => {
      const diff = gap(key);
      return line(label, rate(a[key]), rate(b[key]), diff === null ? '—' : signed(diff, ' p.'), diff !== null && (invert ? diff <= 0 : diff >= 0));
    };
    const days = line('Dias com registo', `${format(a.daysCovered)} de ${format(a.days)}`, `${format(b.daysCovered)} de ${format(b.days)}`,
      signed(b.daysCovered - a.daysCovered, ' dias'), b.daysCovered >= a.daysCovered);
    return [
      num('Registos', 'records'), num('Produzidas', 'produced'), num('Aprovadas', 'approved'),
      scrap('Rej. máquina', 'rejected'), scrap('Rej. qualidade', 'qualityRejected'),
      rateLine('Taxa rej. máquina', 'rejectionRate', true), rateLine('Taxa rej. qualidade', 'qualityRejectionRate', true),
      rateLine('Aprovação', 'approvalRate', false),
      line('Cartas por dia', format(a.perDay), format(b.perDay), signed(b.perDay - a.perDay), b.perDay >= a.perDay),
      days,
    ];
  }

  /**
   * O título e o indicador do gráfico quando o relatório é de uma rejeição.
   * Uma só regra, para o papel, a lupa e o PDF dizerem o mesmo.
   */
  function seriesFor(rejection) {
    if (rejection === 'machine') return { title: 'Evolução das rejeições da máquina', metric: 'rejected' };
    if (rejection === 'quality') return { title: 'Evolução das rejeições no teste de qualidade', metric: 'qualityRejected' };
    return { title: 'Evolução', metric: 'produced' };
  }

  function formatPercent(value) {
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value) + '%';
  }

  /** Data completa em dd/mm/yyyy — o formato que a sala lê sem tropeçar. */
  function shortDate(iso) {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  function longDate(iso) { return shortDate(iso); }

  /** Rótulo de um mês: «MM/AAAA» — a regra do sistema é sempre dia, mês, ano; o que falta, omite-se, sem trocar a ordem. */
  const monthLabel = (month) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;

  /** Rótulo legível de um registo: «05/10/2026» ou «10/2026». */
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
   */  function readQuantity(raw, machineName, field) {
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
    let start = clean(input.period === 'month' ? parseMonth(input.start) : parseDate(input.start));
    let end = clean(input.period === 'month' ? parseMonth(input.end) : parseDate(input.end));
    if (period === 'day') end = start;
    if (period === 'month') {
      if (!isMonth(start)) throw new Error('Escolhe o mês do registo, em mm/aaaa.');
      ({ start, end } = monthRange(start));
    }
    if (!isDate(start)) throw new Error('Escolhe uma data de início válida, em dd/mm/aaaa.');
    if (!isDate(end)) throw new Error('Escolhe uma data final válida, em dd/mm/aaaa.');
    if (end < start) throw new Error('A data final não pode ser anterior à data de início.');

    // uma lista de lotes é a forma nova; as máquinas soltas são a forma antiga,
    // que continua a entrar (cópias e registos mensais) e é convertida em lotes
    const entries = Array.isArray(input.entries)
      ? input.entries.map((entry) => makeEntry({ updated: period === 'day' ? start : '', ...entry }))
      : entriesFromMachines(input);
    const notes = clean(input.notes).slice(0, 500);
    return { id: clean(input.id) || generateId(), period, start, end, entries, closed: input.closed === true, notes };
  }

  /**
   * A produção de um período sem lotes (cópia antiga ou registo mensal) entra
   * como um lote por máquina. Nada se perde e a conta é a mesma de antes.
   */
  function entriesFromMachines(input) {
    const reasons = normalizeReasons(input.reasons);
    const entries = [];
    MACHINES.forEach((name, index) => {
      const source = input.machines?.[index] || {};
      const produced = readQuantity(source.produced, name, 'as cartas produzidas');
      // Vazio não é erro: as rejeições que não foram indicadas contam como zero,
      // e as aprovadas são sempre o que sobra das produzidas.
      const optional = (value, field) => (clean(value) === '' ? 0 : readQuantity(value, name, field));
      const rejected = optional(source.rejected, 'as cartas rejeitadas pela máquina');
      const qualityRejected = optional(source.qualityRejected, 'as cartas rejeitadas no teste de qualidade');
      if (rejected > produced) {
        throw new Error(`${name}: ${format(rejected)} rejeitadas pela máquina não cabem em ${format(produced)} produzidas. Corrige uma das quantidades.`);
      }
      if (qualityRejected > produced) {
        throw new Error(`${name}: ${format(qualityRejected)} chumbadas no teste de qualidade não cabem em ${format(produced)} produzidas. Corrige uma das quantidades.`);
      }
      if (!produced && !rejected && !qualityRejected) return;
      const key = MACHINE_KEYS[index];
      entries.push({
        id: generateId(), lotId: '', reference: '', delegation: '', machine: index,
        planned: produced, produced, rejected, qualityRejected,
        reasons: reasons.filter((reason) => (reason[key] || 0) > 0).map((reason) => ({ code: reason.code, quantity: reason[key] })),
        done: true, updated: '', notes: '',
      });
    });
    return entries;
  }

  /**
   * Os motivos do INCAPE de um registo: só entram os que têm alguma chumbada.
   * `input` pode vir do formulário (texto) ou de uma cópia (números).
   */
  function normalizeReasons(input) {
    const source = Array.isArray(input) ? input : [];
    const read = (value) => {
      const number = typeof value === 'string' && clean(value) !== '' ? readQuantity(value, '', 'os motivos') : value;
      return Number.isInteger(number) && number > 0 ? Math.min(number, MAX_QUANTITY) : 0;
    };
    return source.map((entry) => ({
      code: typeof entry?.code === 'string' ? entry.code : '',
      m1: read(entry?.m1), m2: read(entry?.m2),
    })).filter((entry) => REASON_CODES.includes(entry.code) && (entry.m1 > 0 || entry.m2 > 0));
  }

  /* ------------------------------------------ entradas de lote --- */

  /**
   * Uma entrada é a produção de um lote numa máquina, dentro do dia: quantas
   * cartas saíram, quantas falharam, quantas chumbaram no teste e porquê.
   * É a unidade que os operadores registam; os totais do dia saem da soma.
   */
  function makeEntry(input) {
    const machine = Number(input.machine) === 1 ? 1 : 0;
    const name = MACHINES[machine];
    const planned = readQuantity(input.planned, name, 'as cartas do lote');
    const produced = readQuantity(input.produced, name, 'as cartas produzidas');
    const optional = (value, field) => (clean(value) === '' ? 0 : readQuantity(value, name, field));
    const rejected = optional(input.rejected, 'as cartas rejeitadas pela máquina');
    const qualityRejected = optional(input.qualityRejected, 'as cartas chumbadas no teste');
    if (!planned) throw new Error(`${name}: diz quantas cartas tem o lote.`);
    if (rejected > produced) {
      throw new Error(`${name}: ${format(rejected)} rejeitadas pela máquina não cabem em ${format(produced)} produzidas. Corrige uma das quantidades.`);
    }
    if (qualityRejected > produced) {
      throw new Error(`${name}: ${format(qualityRejected)} chumbadas no teste não cabem em ${format(produced)} produzidas. Corrige uma das quantidades.`);
    }
    const reasons = normalizeEntryReasons(input.reasons);
    const justified = reasons.reduce((total, reason) => total + reason.quantity, 0);
    if (justified > qualityRejected) {
      throw new Error(`${name}: ${format(justified)} cartas justificadas não cabem em ${format(qualityRejected)} chumbadas. Corrige os motivos.`);
    }
    const reference = clean(input.reference).slice(0, 40);
    if (reference.length > 40) throw new Error('A referência do lote não pode ter mais de 40 caracteres.');
    const updated = clean(input.updated) ? parseDate(input.updated) : '';
    if (clean(input.updated) && !updated) throw new Error('A data do lote tem de ser dd/mm/aaaa.');
    return {
      id: clean(input.id) || generateId(),
      lotId: clean(input.lotId).slice(0, 64),
      reference, delegation: clean(input.delegation).slice(0, 80),
      machine, planned, produced, rejected, qualityRejected,
      reasons,
      // um lote só está concluído quando sai alguma carta e alguém o dá por concluído
      done: input.done !== false && produced > 0,
      updated: updated || '',
      notes: clean(input.notes).slice(0, 300),
    };
  }

  /** Os motivos de uma entrada: código do INCAPE, quantidade e mais nada. */
  function normalizeEntryReasons(input) {
    const source = Array.isArray(input) ? input : [];
    const read = (value) => {
      const number = typeof value === 'string' && clean(value) !== '' ? readQuantity(value, '', 'os motivos') : value;
      return Number.isInteger(number) && number > 0 ? Math.min(number, MAX_QUANTITY) : 0;
    };
    return source.map((entry) => ({
      code: typeof entry?.code === 'string' ? entry.code : '',
      quantity: read(entry?.quantity),
    })).filter((entry) => REASON_CODES.includes(entry.code) && entry.quantity > 0);
  }

  /**
   * Os totais de um dia saem das entradas: cada lote soma o que produziu e o
   * que falhou; a máquina e o motivo são só a forma de agrupar a mesma conta.
   */
  function entryTotals(record) {
    const machines = MACHINES.map((name, index) => {
      const mine = (record.entries || []).filter((entry) => entry.machine === index);
      const produced = mine.reduce((total, entry) => total + entry.produced, 0);
      const rejected = mine.reduce((total, entry) => total + entry.rejected, 0);
      const qualityRejected = mine.reduce((total, entry) => total + entry.qualityRejected, 0);
      const approved = Math.max(0, produced - Math.min(qualityRejected, produced));
      return {
        name, lots: mine.length, produced, rejected, qualityRejected, approved,
        reworked: Math.max(0, Math.min(rejected, produced) - qualityRejected),
        approvalRate: percent(approved, produced),
        rejectionRate: percent(rejected, produced),
        qualityRejectionRate: percent(qualityRejected, produced),
      };
    });
    const sum = (key) => machines.reduce((total, machine) => total + machine[key], 0);
    const produced = sum('produced');
    const rejected = sum('rejected');
    const qualityRejected = sum('qualityRejected');
    const approved = sum('approved');
    return {
      machines, produced, rejected, qualityRejected, approved, reworked: sum('reworked'),
      lots: sum('lots'),
      approvalRate: percent(approved, produced),
      rejectionRate: percent(rejected, produced),
      qualityRejectionRate: percent(qualityRejected, produced),
    };
  }

  /**
   * O estado de uma entrada: por fazer, em curso ou concluída, com as cartas
   * que ainda faltam (o lote planeado menos o que já saiu).
   */
  function entryState(entry) {
    if (entry.done) return { key: 'feito', label: 'Concluído', tone: 'done' };
    if (entry.produced > 0 || entry.rejected > 0) return { key: 'em-curso', label: 'Em curso', tone: 'live' };
    return { key: 'pendente', label: 'Por começar', tone: 'todo' };
  }

  /** O que falta produzir numa entrada (nunca negativo). */
  const entryMissing = (entry) => Math.max(0, (entry.planned || 0) - (entry.produced || 0));

  /**
   * O dia por dentro: o que está registado, o que está a decorrer e quanto
   * ainda falta. É o painel que se abre ao clicar em «Novo registo».
   */
  function dayStatus(record) {
    const entries = record?.entries || [];
    const totals = entryTotals(record || { entries: [] });
    const open = entries.filter((entry) => !entry.done);
    const closed = record ? record.closed === true : false;
    const missing = open.reduce((total, entry) => total + entryMissing(entry), 0);
    return {
      closed, entries: entries.length, open: open.length, done: entries.length - open.length,
      lots: new Set(entries.map((entry) => entry.lotId || entry.id)).size,
      planned: entries.reduce((total, entry) => total + entry.planned, 0),
      missing, totals,
      empty: !entries.length,
    };
  }

  /** As entradas de um registo que ainda não foram concluídas. */
  const openEntries = (record) => (record?.entries || []).filter((entry) => !entry.done);

  /** Total de chumbadas por motivo, para o painel e os relatórios. */
  function reasonTotals(records) {
    const perMachine = MACHINE_KEYS.map(() => REASONS.map(() => 0));
    for (const record of records || []) {
      // um dia guarda os motivos dentro de cada lote; uma cópia antiga trazia-os por máquina
      const rows = (record.entries || []).length
        ? (record.entries || []).flatMap((entry) => (entry.reasons || []).map((reason) => ({
          code: reason.code, m1: entry.machine === 0 ? reason.quantity : 0, m2: entry.machine === 1 ? reason.quantity : 0,
        })))
        : record.reasons || [];
      for (const entry of rows) {
        const index = REASON_CODES.indexOf(entry.code);
        if (index < 0) continue;
        perMachine[0][index] += entry.m1 || 0;
        perMachine[1][index] += entry.m2 || 0;
      }
    }
    return REASONS.map((reason, index) => ({
      ...reason,
      m1: perMachine[0][index], m2: perMachine[1][index],
      total: perMachine[0][index] + perMachine[1][index],
    }));
  }

  /**
   * Gera um identificador único para novos registos (UUID v4 se disponível no ambiente,
   * ou identificador alfanumérico aleatório com base temporal).
   */
  function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* ------------------------------------------------ cálculo --- */

  /**
   * Totais de um registo: somam-se os lotes do dia. Aprovadas = produzidas
   * − rejeitadas no teste (as rejeitadas pela máquina que passam voltam a contar).
   */
  function totals(record) {
    const summed = entryTotals(record);
    const perMachine = summed.machines.map((machine) => ({
      produced: machine.produced, rejected: machine.rejected, qualityRejected: machine.qualityRejected,
      approved: machine.approved, reworked: machine.reworked, lots: machine.lots,
      approvalRate: machine.approvalRate, rejectionRate: machine.rejectionRate,
      qualityRejectionRate: machine.qualityRejectionRate,
    }));
    const days = daysBetween(record.start, record.end);
    return {
      ...summed, machines: perMachine, days,
      perDay: summed.produced > 0 && days > 0 ? Math.round(summed.produced / days) : 0,
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
    const machines = MACHINES.map(() => ({ produced: 0, rejected: 0, qualityRejected: 0, approved: 0, reworked: 0 }));
    let daysCovered = 0;
    for (const record of included) {
      const totalsOf = totals(record);
      totalsOf.machines.forEach((machine, index) => {
        machines[index].produced += machine.produced;
        machines[index].rejected += machine.rejected;
        machines[index].qualityRejected += machine.qualityRejected;
        machines[index].approved += machine.approved;
        machines[index].reworked += machine.reworked;
      });
      daysCovered += totalsOf.days;
    }
    const totalsOf = (machine) => ({
      ...machine,
      approvalRate: percent(machine.approved, machine.produced),
      rejectionRate: percent(machine.rejected, machine.produced),
      qualityRejectionRate: percent(machine.qualityRejected, machine.produced),
    });
    const produced = machines.reduce((sum, machine) => sum + machine.produced, 0);
    const rejected = machines.reduce((sum, machine) => sum + machine.rejected, 0);
    const qualityRejected = machines.reduce((sum, machine) => sum + machine.qualityRejected, 0);
    const approved = machines.reduce((sum, machine) => sum + machine.approved, 0);
    const reworked = machines.reduce((sum, machine) => sum + machine.reworked, 0);
    return {
      start, end,
      records: included,
      outside: partial,
      machines: machines.map(totalsOf),
      produced, rejected, qualityRejected, approved, reworked,
      approvalRate: percent(approved, produced),
      rejectionRate: percent(rejected, produced),
      qualityRejectionRate: percent(qualityRejected, produced),
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
        // «09/2026» cabe sob a barra numa série de doze meses e diz o ano inteiro
        const month = point(monthLabel(cursor), monthLabel(cursor), summarise(state, mStart, mEnd));
        points.push(month);
        cursor = shiftMonth(cursor, 1);
      }
      return points;
    }
    return selectRecords(state.records, start, end).included
      .map((record) => point(periodLabel(record.start, record.end), shortDate(record.start), totals(record)));
  }

  const point = (full, label, totalsOf) => ({
    full, label,
    produced: totalsOf.produced, approved: totalsOf.approved,
    rejected: totalsOf.rejected, qualityRejected: totalsOf.qualityRejected || 0,
    approvalRate: totalsOf.approvalRate,
    rejectionRate: totalsOf.rejectionRate,
    qualityRejectionRate: totalsOf.qualityRejectionRate,
  });

  /* ----------------------------------------------- estado --- */

  function emptyState() { return { version: VERSION, records: [], lots: [], stock: [], sideOpen: true }; }

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
      if (!Array.isArray(record.entries)) fail(`${where}: os lotes do dia não estão em lista.`);
      if (record.entries.length > MAX_ENTRIES) fail(`${where}: um dia tem no máximo ${MAX_ENTRIES} lotes.`);
      const entryIds = new Set();
      record.entries.forEach((entry, entryIndex) => {
        const label = `lote ${entryIndex + 1}`;
        if (!entry || typeof entry !== 'object') fail(`${where}: o ${label} está vazio.`);
        if (typeof entry.id !== 'string' || !entry.id || entry.id.length > 64) fail(`${where}: o ${label} tem um identificador inválido.`);
        if (entryIds.has(entry.id)) fail(`${where}: o ${label} está repetido.`);
        entryIds.add(entry.id);
        if (entry.machine !== 0 && entry.machine !== 1) fail(`${where}: o ${label} tem de indicar a máquina (1 ou 2).`);
        const machineName = MACHINES[entry.machine];
        for (const key of ['planned', 'produced', 'rejected', 'qualityRejected']) {
          const value = entry[key];
          const field = key === 'planned' ? 'as cartas planeadas' : key === 'produced' ? 'as cartas produzidas'
            : key === 'rejected' ? 'as rejeitadas pela máquina' : 'as chumbadas no teste';
          if (!Number.isSafeInteger(value) || value < 0) fail(`${where}: ${label}, ${machineName}: ${field} tem de ser um número inteiro a partir de zero.`);
          if (value > MAX_QUANTITY) fail(`${where}: ${label}, ${machineName}: ultrapassa o limite de ${format(MAX_QUANTITY)} cartas.`);
        }
        if (!entry.planned) fail(`${where}: ${label}, ${machineName}: diz quantas cartas tem o lote.`);
        if (entry.rejected > entry.produced) fail(`${where}: ${label}, ${machineName}: rejeitou mais cartas do que produziu.`);
        if (entry.qualityRejected > entry.produced) fail(`${where}: ${label}, ${machineName}: chumbou no teste mais cartas do que produziu.`);
        if (entry.done !== true && entry.done !== false) fail(`${where}: ${label}: o estado do lote tem de dizer se está concluído.`);
        if (entry.reference !== undefined && (typeof entry.reference !== 'string' || entry.reference.length > 40)) fail(`${where}: ${label}: a referência do lote não pode ter mais de 40 caracteres.`);
        if (entry.updated && !isDate(entry.updated)) fail(`${where}: ${label}: a data do lote não é uma data válida.`);
        if (!Array.isArray(entry.reasons)) fail(`${where}: ${label}: os motivos das chumbadas não estão em lista.`);
        entry.reasons.forEach((reason, reasonIndex) => {
          const name = `motivo ${reasonIndex + 1}`;
          if (!reason || typeof reason !== 'object') fail(`${where}: ${label}, ${name} está vazio.`);
          if (!REASON_CODES.includes(reason.code)) fail(`${where}: ${label}: ${name} não é um motivo de rejeição do INCAPE.`);
          if (!Number.isSafeInteger(reason.quantity) || reason.quantity < 0) fail(`${where}: ${label}, ${name}: usa números inteiros a partir de zero.`);
        });
      });
      if (record.closed !== undefined && typeof record.closed !== 'boolean') fail(`${where}: o fecho do dia não está em condições.`);
      if (record.notes !== undefined && (typeof record.notes !== 'string' || record.notes.length > 500)) fail(`${where}: as notas não podem ter mais de 500 caracteres.`);
    }

    validateLots(state.lots);
    validateStock(state.stock);

    const conflict = firstConflict(state.records);
    if (conflict) {
      const [a, b] = conflict;
      fail(`«${periodLabel(a.start, a.end)}» e «${periodLabel(b.start, b.end)}» partilham dias. Cada carta só pode ser contada uma vez.`);
    }
    return state;
  }

  /** Lotes: referências distintas, delegação e datas legíveis, fases conhecidas. */
  function validateLots(lots) {
    if (lots === undefined) return;
    if (!Array.isArray(lots)) fail('A cópia não traz a lista de lotes em condições.');
    if (lots.length > MAX_RECORDS) fail(`Só são aceites ${format(MAX_RECORDS)} lotes por ficheiro.`);
    const seen = new Set();
    for (const [index, lot] of lots.entries()) {
      const where = `Lote ${index + 1}`;
      if (!lot || typeof lot !== 'object') fail(`${where}: formato inválido.`);
      if (typeof lot.id !== 'string' || !lot.id || lot.id.length > 64) fail(`${where}: identificador inválido.`);
      const reference = clean(lot.reference);
      if (!reference) fail(`${where}: sem referência. Cada lote tem de ter a sua.`);
      const key = reference.toLowerCase();
      if (seen.has(key)) fail(`${where}: a referência «${reference}» está repetida. Cada lote tem de ter a sua.`);
      seen.add(key);
      if (typeof lot.delegation !== 'string' || lot.delegation.length > 80) fail(`${where}: a delegação está inválida.`);
      if (!Number.isSafeInteger(lot.quantity) || lot.quantity <= 0) fail(`${where}: as cartas do lote têm de ser um número inteiro maior do que zero.`);
      if (!isDate(lot.start)) fail(`${where}: a data de abertura tem de estar entre ${shortDate(FIRST)} e ${shortDate(LAST)}.`);
      if (!lot.stages || typeof lot.stages !== 'object') fail(`${where}: faltam as fases do lote.`);
      for (const stage of LOT_STAGES) {
        const entry = lot.stages[stage];
        if (!entry || typeof entry !== 'object') fail(`${where}: falta a fase de ${LOT_STAGE_LABELS[stage].toLowerCase()}.`);
        if (!LOT_STATUS.includes(entry.state)) fail(`${where}: estado desconhecido na fase de ${LOT_STAGE_LABELS[stage].toLowerCase()}.`);
        if (entry.updated && !isDate(entry.updated)) fail(`${where}: a data da fase de ${LOT_STAGE_LABELS[stage].toLowerCase()} não é uma data válida.`);
        if (!Number.isSafeInteger(entry.quantity) || entry.quantity < 0) fail(`${where}: as cartas da fase de ${LOT_STAGE_LABELS[stage].toLowerCase()} têm de ser um número inteiro a partir de zero.`);
      }
    }
  }

  /** Material do armazém: nomes distintos, quantidades coerentes. */
  function validateStock(stock) {
    if (stock === undefined) return;
    if (!Array.isArray(stock)) fail('A cópia não traz o material em condições.');
    if (stock.length > MAX_RECORDS) fail(`Só são aceites ${format(MAX_RECORDS)} artigos de material.`);
    const seen = new Set();
    for (const [index, item] of stock.entries()) {
      const where = `Material ${index + 1}`;
      if (!item || typeof item !== 'object') fail(`${where}: formato inválido.`);
      if (typeof item.id !== 'string' || !item.id || item.id.length > 64) fail(`${where}: identificador inválido.`);
      const name = clean(item.name);
      if (!name) fail(`${where}: sem nome.`);
      const key = name.toLowerCase();
      if (seen.has(key)) fail(`${where}: o material «${name}» está repetido. Actualiza o que já existe.`);
      seen.add(key);
      for (const key2 of ['contracted', 'received', 'issued', 'minimum']) {
        // `contracted` e `delivered` vieram depois: uma cópia antiga pode não os trazer
        if (item[key2] === undefined) continue;
        if (!Number.isSafeInteger(item[key2]) || item[key2] < 0) fail(`${where}: as quantidades têm de ser números inteiros a partir de zero.`);
      }
      if (item.issued > item.received) fail(`${where}: «${name}» deu mais do que recebeu. Corrige uma das quantidades.`);
      if (item.updated && !isDate(item.updated)) fail(`${where}: a data do movimento não é uma data válida.`);
      if (item.delivered && !isDate(item.delivered)) fail(`${where}: a data da entrega não é uma data válida.`);
    }
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

  /* -------------------------------------------------- lotes --- */


  /**
   * O que uma fase diz por escrito: o dia em que ficou feita, «em curso», ou
   * «—» quando ainda não começou. O papel, o PDF e o CSV dizem o mesmo.
   */
  const stageText = (entry) => {
    if (!entry) return '';
    if (entry.state === 'feito') return entry.updated ? shortDate(entry.updated) : 'feito';
    return entry.state === 'em-curso' ? 'em curso' : '—';
  };

  /** Lê uma quantidade escrita à mão, sem rebentar com uma cópia antiga. */
  const readCount = (value) => {
    if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? Math.min(value, MAX_QUANTITY) : 0;
    if (typeof value !== 'string' || !clean(value)) return 0;
    try { return Math.min(readQuantity(value, '', 'as cartas'), MAX_QUANTITY); } catch (_) { return 0; }
  };

  const readStage = (input, fallback) => {
    const source = input && typeof input === 'object' ? input : {};
    const stage = LOT_STAGES.includes(source.stage) ? source.stage : 'personalizacao';
    const state = LOT_STATUS.includes(source.state) ? source.state : 'pendente';
    const quantity = clean(source.quantity) === '' || source.quantity === undefined ? (fallback || 0) : readCount(source.quantity);
    return { stage, state, quantity, updated: parseDate(source.updated) || '', note: clean(source.note).slice(0, 300) };
  };

  /**
   * Constrói um lote a partir do formulário. Um lote é a unidade de trabalho:
   * é personalizado (por delegação), impresso, verificado no teste de qualidade
   * e despachado. Cada fase guarda a data e o estado em que está.
   */
  function makeLot(input) {
    const reference = clean(input.reference);
    if (!reference) throw new Error('Escreve a referência do lote (ex.: L-2026-014).');
    if (reference.length > 40) throw new Error('A referência do lote não pode ter mais de 40 caracteres.');
    const delegation = clean(input.delegation);
    if (!delegation) throw new Error('Escolhe a delegação do lote.');
    if (delegation.length > 80) throw new Error('O nome da delegação não pode ter mais de 80 caracteres.');
    const quantity = readQuantity(input.quantity, 'Lote', 'as cartas do lote');
    if (!quantity) throw new Error('O lote tem de ter pelo menos uma carta.');
    const start = parseDate(input.start);
    if (!start) throw new Error('Escreve a data de abertura do lote em dd/mm/aaaa.');
    const stages = {};
    for (const stage of LOT_STAGES) {
      // quando a fase é dada como «feita» sem data, a data é a de abertura: nada fica sem carimbo
      const source = { stage, ...(input.stages?.[stage] || {}) };
      if (source.state === 'feito' && !source.updated) source.updated = start;
      // sem quantidade própria, a fase vale as cartas do lote
      stages[stage] = readStage(source, quantity);
    }
    const closed = stages.despacho.state === 'feito' && Boolean(stages.despacho.updated);
    return {
      id: clean(input.id) || generateId(),
      reference, delegation, quantity, start,
      stages,
      notes: clean(input.notes).slice(0, 500),
      closed,
    };
  }

  /** Só a leitura de uma cópia: nada de mensagens, tudo o que é inválido volta ao início. */
  function normalizeLot(lot) {
    const stages = {};
    const quantity = readCount(lot?.quantity);
    for (const stage of LOT_STAGES) stages[stage] = readStage({ stage, ...(lot?.stages?.[stage] || {}) }, quantity);
    const start = parseDate(lot?.start) || FIRST;
    return {
      id: typeof lot?.id === 'string' && lot.id ? lot.id.slice(0, 64) : generateId(),
      reference: clean(lot?.reference).slice(0, 40) || 'Sem referência',
      delegation: clean(lot?.delegation).slice(0, 80),
      quantity, start, stages,
      notes: typeof lot?.notes === 'string' ? lot.notes.slice(0, 500) : '',
      closed: stages.despacho.state === 'feito' && Boolean(stages.despacho.updated),
    };
  }

  /** As fases que ainda faltam a um lote, pela ordem do trabalho. */
  const lotNextStage = (lot) => LOT_STAGES.find((stage) => lot.stages[stage].state !== 'feito') || null;

  /** Quadro de trabalho: quantos lotes estão em cada fase e quantos estão parados. */
  function lotBoard(lots, todayIso) {
    const today = parseDate(todayIso) || null;
    const rows = LOT_STAGES.map((stage) => {
      const open = (lots || []).filter((lot) => lot.stages[stage].state !== 'feito');
      const waiting = open.filter((lot) => !lot.stages[stage].updated);
      const cards = open.reduce((total, lot) => total + lot.quantity, 0);
      const done = (lots || []).filter((lot) => lot.stages[stage].state === 'feito');
      const doneCards = done.reduce((total, lot) => total + lot.quantity, 0);
      const late = today ? open.filter((lot) => lot.stages[stage].updated && lot.stages[stage].updated < today) : [];
      return { stage, label: LOT_STAGE_LABELS[stage], open: open.length, waiting: waiting.length, late: late.length, cards, done: done.length, doneCards };
    });
    const dispatched = (lots || []).filter((lot) => lot.closed).length;
    return {
      rows,
      total: (lots || []).length,
      dispatched,
      toDispatch: (lots || []).filter((lot) => lot.stages.despacho.state !== 'feito').length,
      cards: (lots || []).reduce((total, lot) => total + lot.quantity, 0),
    };
  }

  /* ----------------------------------------------- material --- */

  /** Constrói um artigo do armazém com o que já entrou e o que já saiu. */
  function makeStockItem(input) {
    const name = clean(input.name);
    if (!name) throw new Error('Escreve o nome do material (ex.: Tonner amarelo).');
    if (name.length > 120) throw new Error('O nome do material não pode ter mais de 120 caracteres.');
    const kind = STOCK_KINDS.includes(input.kind) ? input.kind : 'outro';
    const unit = clean(input.unit).slice(0, 20) || 'un.';
    const received = readQuantity(input.received, 'Armazém', 'as quantidades recebidas');
    const issued = readQuantity(input.issued, 'Armazém', 'as quantidades dadas');
    if (issued > received) {
      throw new Error(`«${name}»: ${format(issued)} dados não cabem em ${format(received)} recebidos. Corrige uma das quantidades.`);
    }
    const minimum = readQuantity(input.minimum, 'Armazém', 'o mínimo de alerta');
    // o contratado só existe no quadro do contrato: quando não é dito, é zero
    const contracted = readQuantity(input.contracted, 'Armazém', 'as quantidades contratadas');
    const delivered = clean(input.delivered) ? parseDate(input.delivered) : '';
    if (clean(input.delivered) && !delivered) throw new Error('A data da entrega do material tem de ser dd/mm/aaaa.');
    const updated = clean(input.updated) ? parseDate(input.updated) : '';
    if (clean(input.updated) && !updated) throw new Error('A data do movimento do material tem de ser dd/mm/aaaa.');
    return {
      id: clean(input.id) || generateId(), name, kind, unit,
      contracted, received, issued, minimum,
      delivered: delivered || '',
      updated: updated || '',
      notes: clean(input.notes).slice(0, 300),
    };
  }

  function normalizeStockItem(item) {
    const clamp = (value) => (Number.isInteger(value) && value >= 0 ? Math.min(value, MAX_QUANTITY) : 0);
    const received = clamp(item?.received);
    const issued = clamp(item?.issued);
    return {
      id: typeof item?.id === 'string' && item.id ? item.id.slice(0, 64) : generateId(),
      name: clean(item?.name).slice(0, 120) || 'Material sem nome',
      kind: STOCK_KINDS.includes(item?.kind) ? item.kind : 'outro',
      unit: clean(item?.unit).slice(0, 20) || 'un.',
      contracted: clamp(item?.contracted),
      received, issued: Math.min(issued, received), minimum: clamp(item?.minimum),
      delivered: parseDate(item?.delivered) || '',
      updated: parseDate(item?.updated) || '',
      notes: typeof item?.notes === 'string' ? item.notes.slice(0, 300) : '',
    };
  }

  const stockBalance = (item) => Math.max(0, (item.received || 0) - (item.issued || 0));
  const stockLow = (item) => (item.minimum || 0) > 0 && stockBalance(item) <= item.minimum;
  /** Do contrato: o que ainda falta entregar (nunca negativo, se vier mais do que o contratado). */
  const stockPending = (item) => Math.max(0, (item.contracted || 0) - (item.received || 0));

  /** Leitura do armazém: o que está em falta e o que está a acabar. */
  /** Mínimo de alerta sugerido: 10 % do contratado, arredondado para cima. */
  function stockSuggestedMinimum(contracted) {
    const value = Number(contracted) || 0;
    return value ? Math.ceil(value / 10) : 0;
  }

  /**
   * O armazém começa pelo contrato: devolve os itens do catálogo que ainda não
   * estão na lista, para o utilizador escolher e criar sem escrever nada.
   */
  function catalogueGaps(items) {
    const taken = new Set((items || []).map((item) => clean(item.name).toLowerCase()));
    return CATALOGUE
      .map((entry, index) => ({ ...entry, index, id: `contrato-${String(index + 1).padStart(2, '0')}` }))
      .filter((entry) => !taken.has(entry.name.toLowerCase()));
  }

  function stockOverview(items) {
    const list = (items || []).map((item) => ({
      ...item, balance: stockBalance(item), low: stockLow(item), pending: stockPending(item),
    }));
    return {
      items: list,
      low: list.filter((item) => item.low),
      empty: list.filter((item) => item.balance === 0),
      pending: list.filter((item) => item.pending > 0),
      cards: list.filter((item) => item.kind === 'cartao').reduce((total, item) => total + item.balance, 0),
    };
  }

  /* ---------------------------------------------- migração --- */

  /**
   * Traz cópias v1/v2/v3 para o modelo actual. As quantidades por máquina são
   * conservadas; quando só existiam totais declarados, o registo é marcado
   * nas notas para que alguém confira a origem. Rejeições de qualidade não
   * existiam antes da versão 4; entram a zero.
   */
  function migrate(input) {
    const data = typeof input === 'string' ? JSON.parse(input) : input;
    if (!data || typeof data !== 'object' || !Array.isArray(data.records)) fail('O ficheiro não tem registos para converter.');
    // lotes e material existem desde a v5; nas cópias anteriores ficam vazios
    const lots = Array.isArray(data.lots) ? data.lots.map(normalizeLot) : [];
    const stock = Array.isArray(data.stock) ? data.stock.map(normalizeStockItem) : [];
    if (data.version === VERSION) {
      return { version: VERSION, records: data.records.map((record) => normalize(record)), lots, stock,
        sideOpen: data.sideOpen !== false };
    }
    // v3, v4 e v5 traziam os registos por máquina: cada máquina entra como um lote
    // concluído (ver `normalize`), e a conta do dia fica igual à que era.
    if ([3, 4, 5].includes(data.version)) {
      return { version: VERSION, records: data.records.map((record) => normalize(record)), lots, stock,
        sideOpen: data.sideOpen !== false };
    }
    if (![1, 2].includes(data.version)) fail('Só se podem converter cópias das versões 1, 2, 3, 4 e 5 do Conta Carta.');
    if (data.version === 1 && data.demo) fail('Essa cópia é de demonstração. Exporta os teus registos reais e importa-os de novo.');

    const records = [];
    for (const legacy of data.records) {
      const values = Array.isArray(legacy.values) ? legacy.values : [];
      const pick = (index) => {
        const row = values[index] || {};
        return {
          produced: Number.isInteger(row.p) && row.p > 0 ? row.p : 0,
          rejected: Number.isInteger(row.r) && row.r > 0 ? row.r : 0,
          qualityRejected: Number.isInteger(row.q) && row.q > 0 ? row.q : 0,
        };
      };
      const machines = [pick(0), pick(1)];
      const declared = values[2] || {};
      let notes = clean(legacy.notes);
      if (machines.every((machine) => !machine.produced && !machine.rejected) && Number.isInteger(declared.p) && declared.p > 0) {
        // Registo antigo sem divisão por máquina: evita perder a produção.
        machines[0] = { produced: declared.p, rejected: Math.min(Number.isInteger(declared.r) ? declared.r : 0, declared.p), qualityRejected: 0 };
        notes = clean([notes, 'Convertido do total declarado; divide as quantidades pelas máquinas.'].join(' '));
      }
      const start = parseDate(legacy.start) || FIRST;
      const end = parseDate(legacy.end) || start;
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
    return { version: VERSION, records: kept, lots, stock, sideOpen: data.sideOpen !== false };
  }

  /** Garante a forma interna de um registo, independentemente da origem (dd/mm/yyyy ou ISO). */
  function normalize(record) {
    let start = parseDate(record.start) || FIRST;
    let end = parseDate(record.end) || start;
    if (end < start) [start, end] = [end, start]; // cópias antigas vinham por vezes às avessas
    const entries = Array.isArray(record.entries)
      ? record.entries.map((entry) => normalizeEntry(entry, record.start))
      : [];
    // uma cópia antiga trazia só os totais por máquina: entram como um lote cada
    if (!entries.length && Array.isArray(record.machines)) {
      const reasons = normalizeReasons(record.reasons);
      record.machines.forEach((machine, index) => {
        const produced = Number.isInteger(machine?.produced) && machine.produced >= 0 ? Math.min(machine.produced, MAX_QUANTITY) : 0;
        const rejected = Number.isInteger(machine?.rejected) && machine.rejected >= 0 ? Math.min(machine.rejected, produced) : 0;
        const qualityRejected = Number.isInteger(machine?.qualityRejected) && machine.qualityRejected >= 0 ? Math.min(machine.qualityRejected, produced) : 0;
        if (!produced && !rejected && !qualityRejected) return;
        const key = MACHINE_KEYS[index];
        entries.push({
          id: generateId(), lotId: '', reference: '', delegation: '', machine: index,
          planned: produced, produced, rejected, qualityRejected,
          reasons: reasons.filter((reason) => (reason[key] || 0) > 0).map((reason) => ({ code: reason.code, quantity: reason[key] })),
          done: true, updated: '', notes: '',
        });
      });
    }
    const period = PERIODS.includes(record.period)
      ? (record.period === 'day' && start !== end ? 'range' : record.period)
      : (start === end ? 'day' : 'range');
    return {
      id: typeof record.id === 'string' && record.id ? record.id.slice(0, 64) : generateId(),
      period: period === 'month' && (start.slice(8) !== '01' || monthRange(start.slice(0, 7)).end !== end) ? 'range' : period,
      start, end, entries,
      closed: record.closed === true,
      notes: typeof record.notes === 'string' ? record.notes.slice(0, 500) : '',
    };
  }

  /** A forma interna de uma entrada, sem mensagens: o que vier torto fica a zero. */
  function normalizeEntry(entry, day) {
    const source = entry && typeof entry === 'object' ? entry : {};
    const clamp = (value) => (Number.isInteger(value) && value >= 0 ? Math.min(value, MAX_QUANTITY) : 0);
    const produced = clamp(source.produced);
    const planned = clamp(source.planned) || produced;
    return {
      id: typeof source.id === 'string' && source.id ? source.id.slice(0, 64) : generateId(),
      lotId: typeof source.lotId === 'string' ? source.lotId.slice(0, 64) : '',
      reference: typeof source.reference === 'string' ? source.reference.slice(0, 40) : '',
      delegation: typeof source.delegation === 'string' ? source.delegation.slice(0, 80) : '',
      machine: source.machine === 1 ? 1 : 0,
      planned, produced,
      rejected: Math.min(clamp(source.rejected), produced),
      qualityRejected: Math.min(clamp(source.qualityRejected), produced),
      reasons: normalizeEntryReasons(source.reasons),
      done: source.done !== false,
      updated: parseDate(source.updated) || day || '',
      notes: typeof source.notes === 'string' ? source.notes.slice(0, 300) : '',
    };
  }

  /** Ordena por data decrescente (o mais recente em primeiro) para as listas. */
  function byDateDesc(records) { return records.slice().sort((a, b) => (a.start > b.start ? -1 : a.start < b.start ? 1 : 0)); }
  /** Retorna o registo mais recente da lista de registos. */
  function mostRecent(records) { return byDateDesc(records)[0] || null; }

  /* ------------------------------------ comparação e análise --- */

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

  /** Mês reduzido a um período comparável, com a etiqueta curta «MM/AA». */
  function monthPeriod(month) {
    const range = monthRange(month);
    // rótulo curto sempre «mm/aaaa»: o ano inteiro, como no resto do sistema
    return { key: month, label: range.label, short: range.label, name: monthNameOf(month), start: range.start, end: range.end, days: range.days };
  }

  /** Ano reduzido a um período comparável. */
  function yearPeriod(year) {
    const range = yearRange(year);
    return { key: range.label, label: range.label, short: range.label, name: String(year), start: range.start, end: range.end, days: range.days };
  }

  /**
   * Os períodos de uma comparação: sempre exactamente dois, pela ordem escolhida
   * (Mês 1 e Mês 2, ou Ano 1 e Ano 2). A sequência completa é trabalho do «Período».
   */
  function comparePeriods(kind, first, second) {
    if (kind === 'years') {
      const a = Math.trunc(Number(first)), b = Math.trunc(Number(second));
      if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error('Escolhe os dois anos da comparação.');
      if (a === b) throw new Error('Escolhe dois anos diferentes.');
      yearRange(a);
      yearRange(b);
      return [yearPeriod(a), yearPeriod(b)];
    }
    if (!isMonth(first) || !isMonth(second)) throw new Error('Escolhe os dois meses da comparação.');
    if (first === second) throw new Error('Escolhe dois meses diferentes.');
    return [monthPeriod(first), monthPeriod(second)];
  }

  /**
   * Comparação entre exactamente dois períodos: um resumo de cada um e a
   * diferença do segundo para o primeiro. É leitura por cima dos mesmos
   * registos — nada é guardado nem repartido: um registo conta no período em
   * que couber inteiro.
   */
  function compare(state, periods) {
    const rows = periods.map((period) => {
      const summary = summarise(state, period.start, period.end);
      return {
        key: period.key, label: period.label, short: period.short || period.label, name: period.name || period.label,
        start: summary.start, end: summary.end, days: summary.days, daysCovered: summary.daysCovered,
        produced: summary.produced, approved: summary.approved, rejected: summary.rejected,
        qualityRejected: summary.qualityRejected,
        approvalRate: summary.approvalRate, rejectionRate: summary.rejectionRate, qualityRejectionRate: summary.qualityRejectionRate,
        machines: summary.machines, records: summary.records.length, outside: summary.outside.length,
        perDay: summary.produced > 0 && summary.days > 0 ? Math.round(summary.produced / summary.days) : 0,
        empty: summary.empty, delta: null,
      };
    });
    if (rows.length === 2) {
      const [first, second] = rows;
      second.delta = {
        produced: second.produced - first.produced,
        approved: second.approved - first.approved,
        rejected: second.rejected - first.rejected,
        rate: second.approvalRate !== null && first.approvalRate !== null
          ? Math.round((second.approvalRate - first.approvalRate) * 10) / 10
          : null,
      };
    }
    const measured = rows.filter((row) => !row.empty);
    const ordered = measured.slice().sort((a, b) => b.approvalRate - a.approvalRate);
    return {
      rows,
      start: rows.length ? rows[0].start : null,
      end: rows.length ? rows[rows.length - 1].end : null,
      periods: rows.length,
      measured: measured.length,
      empty: measured.length === 0,
      delta: rows.length === 2 ? rows[1].delta : null,
      best: ordered[0] || null,
      worst: ordered.length > 1 ? ordered[ordered.length - 1] : null,
      series: rows.map((row) => ({
        label: row.short, full: row.label,
        produced: row.produced, approved: row.approved, rejected: row.rejected, qualityRejected: row.qualityRejected,
        approvalRate: row.approvalRate,
        rejectionRate: row.rejectionRate, qualityRejectionRate: row.qualityRejectionRate,
      })),
    };
  }

  /** O nome de cada lado: meses por extenso («Setembro de 2026»); nos anos, o próprio ano. */
  function compareTags(result) {
    const rows = result && Array.isArray(result.rows) ? result.rows : [];
    return rows.map((row) => row.name || row.label);
  }

  /** Frase de leitura da comparação: a mesma no ecrã e no papel. */
  function compareReading(result) {
    if (!result || !Array.isArray(result.rows) || result.rows.length !== 2) return '';
    const [a, b] = result.rows;
    if (a.empty && b.empty) return '';
    const nameOf = (row) => row.name || row.label;
    if (a.empty) return `Só ${nameOf(b)} tem produção: ${formatPercent(b.approvalRate)} de aprovação.`;
    if (b.empty) return `Só ${nameOf(a)} tem produção: ${formatPercent(a.approvalRate)} de aprovação.`;
    const gap = Math.round((b.approvalRate - a.approvalRate) * 10) / 10;
    const diff = b.produced - a.produced;
    const direction = diff > 0 ? `mais ${format(diff)} cartas do que`
      : diff < 0 ? `menos ${format(Math.abs(diff))} cartas do que`
      : 'as mesmas cartas de';
    return `${nameOf(b)} produziu ${direction} ${nameOf(a)}; a aprovação foi de ${formatPercent(a.approvalRate)} para ${formatPercent(b.approvalRate)} (${gap >= 0 ? '+' : '−'}${format(Math.abs(gap))} p.).`;
  }

  /** Comparação entre dois períodos vizinhos — o «vs. anterior» do painel. */
  /** Dois períodos quaisquer, lado a lado: o resultado de hoje menos o de antes. */
  function compareWindows(state, now, before) {
    const current = summarise(state, now.start, now.end), previous = summarise(state, before.start, before.end);
    const rate = (row) => row.approvalRate;
    return {
      start: before.start, end: before.end,
      produced: current.produced - previous.produced,
      approved: current.approved - previous.approved,
      rejected: current.rejected - previous.rejected,
      rate: rate(current) !== null && rate(previous) !== null ? Math.round((rate(current) - rate(previous)) * 10) / 10 : null,
      empty: previous.empty,
    };
  }

  /**
   * Compara o período especificado com a janela temporal imediatamente anterior
   * de duração idêntica.
   */
  function compareWithPrevious(state, start, end) {
    const length = daysBetween(start, end);
    const previousEnd = addDays(start, -1);
    if (!isDate(previousEnd)) return null;
    const previousStart = addDays(previousEnd, -(length - 1));
    if (previousStart < FIRST) return null;
    return compareWindows(state, { start, end }, { start: previousStart, end: previousEnd });
  }

  /* -------------------------------------------------- CSV --- */

  /** Célula segura para o Excel: texto escapado e fórmulas neutralizadas. */
  function csvCell(value) {
    const text = value === null || value === undefined ? '' : String(value);
    const guarded = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
    return '"' + guarded.replaceAll('"', '""') + '"';
  }

  /** O nome de um período inteiro (mês completo → «Outubro de 2026»); senão, vazio. */
  function nameOfRange(start, end) {
    if (!isDate(start) || !isDate(end) || start.slice(0, 7) !== end.slice(0, 7)) return '';
    const range = monthRange(start.slice(0, 7));
    return range.start === start && range.end === end ? monthNameOf(start.slice(0, 7)) : '';
  }

  /** Envelope comum dos CSV: BOM para o Excel, `;` de separador, CRLF. */
  const csvDocument = (rows) => '\uFEFF'
    + rows.map((row) => (row.length ? row.map(csvCell) : ['']).join(';')).join('\r\n');

  /** CSV do sumário: cabeçalho institucional, totais e um linha por registo. */
  function buildCSV(summary) {
    const rows = [
      ['Sistema', 'Conta Carta · INATRO, IP'],
      ['Período', `${shortDate(summary.start)} a ${shortDate(summary.end)}`],
      ['Etiqueta', summary.label || periodLabel(summary.start, summary.end)],
      ['Nome', nameOfRange(summary.start, summary.end)],
      ['Registos somados', summary.records.length],
      ['Dias do período', summary.days],
      ['Dias com registo', summary.daysCovered],
      [],
      ['Origem', 'Produzidas', 'Aprovadas', 'Rej. máquina', 'Rej. no teste de qualidade', 'Taxa de aprovação (%)'],
      ...summary.machines.map((machine, index) => [MACHINES[index], machine.produced, machine.approved, machine.rejected, machine.qualityRejected, machine.approvalRate ?? '']),
      ['Total', summary.produced, summary.approved, summary.rejected, summary.qualityRejected, summary.approvalRate ?? ''],
      [],
    ];
    for (const record of summary.records) {
      const totalsOf = totals(record);
      rows.push([periodLabel(record.start, record.end), totalsOf.produced, totalsOf.approved, totalsOf.rejected, totalsOf.qualityRejected, totalsOf.approvalRate ?? '']);
      totalsOf.machines.forEach((machine, index) => rows.push([`  ${MACHINES[index]}`, machine.produced, machine.approved, machine.rejected, machine.qualityRejected, machine.approvalRate ?? '']));
      // o dia explica-se lote a lote: é a mesma conta, aberta como no ecrã
      (record.entries || []).forEach((entry) => {
        const sealed = entry.done ? '' : ' (em curso)';
        const name = entry.reference || `${MACHINES[entry.machine]}${sealed}`;
        rows.push([`    ${name}`, entry.produced, Math.max(0, entry.produced - entry.qualityRejected), entry.rejected, entry.qualityRejected, '']);
      });
    }
    return csvDocument(rows);
  }

  /**
   * CSV do relatório de rejeição (máquina ou teste de qualidade). Mesma
   * estrutura do sumário, mas as colunas da rejeição vêm primeiro.
   */
  function buildRejectionCSV(summary, title) {
    const rows = [
      ['Sistema', 'Conta Carta · INATRO, IP'],
      ['Relatório', title || 'Relatório de rejeição'],
      ['Período', `${shortDate(summary.start)} a ${shortDate(summary.end)}`],
      ['Etiqueta', summary.label || periodLabel(summary.start, summary.end)],
      ['Nome', nameOfRange(summary.start, summary.end)],
      ['Registos somados', summary.records.length],
      ['Dias do período', summary.days],
      ['Dias com registo', summary.daysCovered],
      [],
      ['Origem', 'Produzidas', 'Rej. máquina', 'Rej. no teste de qualidade',
        'Taxa de rejeição da máquina (%)', 'Taxa de rejeição no teste de qualidade (%)', 'Taxa de aprovação (%)'],
      ...summary.machines.map((machine, index) => [MACHINES[index], machine.produced, machine.rejected, machine.qualityRejected,
        machine.rejectionRate ?? '', machine.qualityRejectionRate ?? '', machine.approvalRate ?? '']),
      ['Total', summary.produced, summary.rejected, summary.qualityRejected,
        summary.rejectionRate ?? '', summary.qualityRejectionRate ?? '', summary.approvalRate ?? ''],
      [],
    ];
    for (const record of summary.records) {
      const totalsOf = totals(record);
      rows.push([periodLabel(record.start, record.end), totalsOf.produced, totalsOf.rejected, totalsOf.qualityRejected,
        totalsOf.rejectionRate ?? '', totalsOf.qualityRejectionRate ?? '', totalsOf.approvalRate ?? '']);
      totalsOf.machines.forEach((machine, index) => rows.push([`  ${MACHINES[index]}`, machine.produced, machine.rejected, machine.qualityRejected,
        machine.rejectionRate ?? '', machine.qualityRejectionRate ?? '', machine.approvalRate ?? '']));
    }
    return csvDocument(rows);
  }

  /** CSV da comparação: uma linha por período e a linha da diferença (2.º menos 1.º). */
  function buildCompareCSV(result, title) {
    const rows = [
      ['Sistema', 'Conta Carta · INATRO, IP'],
      ['Comparação', title || 'Períodos comparados'],
      ['Períodos', result.periods],
      ['Com registos', result.measured],
      [],
      ['Período', 'Nome', 'Registos', 'Produzidas', 'Aprovadas', 'Rej. máquina', 'Rej. no teste de qualidade', 'Taxa de aprovação (%)',
        'Variação da taxa (pontos)', 'Cartas por dia', 'Dias com registo', 'Dias do período'],
    ];
    for (const row of result.rows) {
      rows.push([row.label, row.name || '', row.records, row.produced, row.approved, row.rejected, row.qualityRejected, row.approvalRate ?? '',
        row.delta && row.delta.rate !== null ? row.delta.rate : '', row.perDay, row.daysCovered, row.days]);
    }
    if (result.rows.length === 2) {
      const [first, second] = result.rows;
      const diff = (key) => second[key] - first[key];
      const rateGap = first.approvalRate !== null && second.approvalRate !== null
        ? Math.round((second.approvalRate - first.approvalRate) * 10) / 10
        : '';
      rows.push(['Diferença (2.º menos 1.º)', '', diff('records'), diff('produced'), diff('approved'), diff('rejected'), diff('qualityRejected'),
        rateGap, '', diff('perDay'), diff('daysCovered'), ''], []);
    } else {
      rows.push([]);
    }
    return csvDocument(rows);
  }

  /* ---------------------------------------- CSV do armazém e dos lotes --- */

  /** CSV do armazém: o contrato primeiro, depois o que está na prateleira. */
  function buildStockCSV(overview, dateLabel) {
    const rows = [
      ['Sistema', 'Conta Carta · INATRO, IP'],
      ['Relatório', 'Armazém e material'],
      ['Retrato', dateLabel || ''],
      [],
      ['Material', 'Tipo', 'Unidade', 'Contratado', 'Por entregar', 'Entregue', 'Dado', 'Em armazém', 'Mínimo', 'Data da entrega', 'Actualizado'],
      ...overview.items.map((item) => [item.name, STOCK_KIND_LABELS[item.kind] || STOCK_KIND_LABELS.outro, item.unit,
        item.contracted, item.pending, item.received, item.issued, item.balance, item.minimum,
        item.delivered ? shortDate(item.delivered) : '', item.updated ? shortDate(item.updated) : '']),
    ];
    return csvDocument(rows);
  }

  /** CSV dos lotes: uma linha por lote, com a data de cada fase. */
  function buildLotsCSV(lots, start, end) {
    const stageCell = (entry) => (entry.state === 'pendente' ? '' : stageText(entry));
    const rows = [
      ['Sistema', 'Conta Carta · INATRO, IP'],
      ['Relatório', 'Lotes por despachar'],
      ['Período', `${shortDate(start)} a ${shortDate(end)}`],
      [],
      ['Lote', 'Delegação', 'Cartas', 'Aberto em', ...LOT_STAGES.map((stage) => LOT_STAGE_LABELS[stage])],
      ...lots.map((lot) => [lot.reference, lot.delegation, lot.quantity, shortDate(lot.start),
        ...LOT_STAGES.map((stage) => stageCell(lot.stages[stage]))]),
    ];
    return csvDocument(rows);
  }

  /** CSV dos motivos: uma linha por motivo, com as duas máquinas. */
  function buildReasonsCSV(reasons, start, end) {
    const rows = [
      ['Sistema', 'Conta Carta · INATRO, IP'],
      ['Relatório', 'Motivos de rejeição (INCAPE)'],
      ['Período', `${shortDate(start)} a ${shortDate(end)}`],
      [],
      ['Categoria', 'Motivo', 'Código', MACHINES[0], MACHINES[1], 'Total'],
      ...reasons.map((reason) => [reason.group, reason.label, reason.code, reason.m1, reason.m2, reason.total]),
      ['', 'Total', '', reasons.reduce((sum, reason) => sum + reason.m1, 0),
        reasons.reduce((sum, reason) => sum + reason.m2, 0), reasons.reduce((sum, reason) => sum + reason.total, 0)],
    ];
    return csvDocument(rows);
  }

  /** Texto dos botões 🛈: uma frase por sítio, sem marcação, sempre a fechar a frase. */
  const HELP = {
    panel: 'Escreve o mês (mm/aaaa) ou escolhe-o na lista dos que têm registos; as setas ‹ › andam um mês de cada vez. Um mês fora da lista escolhe-se em «Outro mês…». Só entram na conta os registos cujo período cabe por inteiro na selecção.',
    chart: 'Cada barra é um mês e cada cor é uma métrica: produzidas, rejeitadas pela máquina ou chumbadas no teste. O selector no topo troca a métrica; o botão Ampliar abre o gráfico em tamanho de sala.',
    machines: 'Registas à mão: quanto produziu a máquina, quanto ela rejeitou e quantas dessas chumbaram no teste de qualidade. As aprovadas são as produzidas menos as chumbadas: as que a máquina rejeitou e passaram no teste voltam a contar.',
    approval: 'As cartas que seguem para personalização: produzidas menos as chumbadas no teste de qualidade. A taxa é essa conta sobre o total produzido no período.',
    rejection: 'Cartas deitadas fora pela máquina: impressão defeituosa, dados ilegíveis ou erro de personalização. Estas vão todas ao teste de qualidade.',
    qualityRejection: 'As cartas que a máquina pôs de parte e chumbaram no teste de qualidade, por um dos motivos do INCAPE. São essas as que se perdem: as restantes voltam ao lote.',
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
    reasons: 'As razões do INCAPE para uma carta chumbar no teste de qualidade, com uma saída «Outro» para o que não cabe nelas. Cada motivo conta as cartas que o teste rejeitou; o que escapa ao teste volta a contar como aprovada.',
    stock: 'O armazém guarda o que entra e o que sai: cartões em branco, tonners, tinteiros e material de limpeza. O mínimo de alerta marca o que tem de ser requisitado outra vez.',
    lots: 'Cada lote é personalizado para uma delegação, impresso, verificado no teste de qualidade e despachado. O quadro mostra em que fase está cada lote e quantos faltam despachar.',
    day: 'Um dia de produção, lote a lote. «Concluir» dá o lote por fechado (e marca a fase da qualidade no quadro dos lotes); «Reabrir» devolve-o ao trabalho. Enquanto houver lotes por concluir, o dia avisa no fundo.',
    lotEntry: 'Um lote sai inteiro de uma máquina. As planeadas são as cartas do lote (normalmente 50); as produzidas incluem as que a máquina rejeitou. Desmarca «Lote concluído» se o lote ainda estiver a sair — conclui-se depois, na linha do dia.',
    delegations: 'Quanto mais escura a província, mais cartas produziu no período, e cada ponto é uma delegação. Escolhe uma província ou um ponto para ver ao lado as produzidas, as aprovadas e as despachadas. Só entram no mapa as delegações da lista oficial: um nome antigo aparece apenas na lista. Desenho das províncias: simplemaps.com.',
    operations: 'Cada movimento regista uma quantidade numa etapa do lote, com a sua data: personalização, impressão, qualidade, passagem ao despacho e despacho. As entradas e saídas do armazém não pedem lote, mas pedem a referência. O sistema confere o que há disponível antes de guardar e diz porquê quando recusa.',
  };

  /** Os três separadores do detalhe do painel, pela ordem em que aparecem. */
  const PANEL_TABS = ['machines', 'chart', 'table'];

  return {
    HELP, PANEL_TABS, CATALOGUE,
    VERSION, MACHINES, PERIODS, FIRST, LAST, MAX_QUANTITY, MAX_ENTRIES,
    REASONS, REASON_CODES, MACHINE_KEYS, LOT_STAGES, LOT_STAGE_LABELS, LOT_STATUS, LOT_STATUS_LABELS,
    STOCK_KINDS, STOCK_KIND_LABELS,
    reasonTotals, normalizeReasons, normalizeEntryReasons,
    makeEntry, entryTotals, entryState, entryMissing, dayStatus, openEntries, normalizeEntry,
    makeLot, normalizeLot, lotNextStage, lotBoard, LOT_STAGES,
    makeStockItem, normalizeStockItem, stockBalance, stockLow, stockPending, stockOverview, catalogueGaps, stockSuggestedMinimum,
    parseDate, parseMonth, isDate, isMonth, addDays, daysBetween, daysInMonth: (month) => monthRange(month).days,
    monthRange, shiftMonth, weekRange, weekday,
    format, percent, formatPercent, signed, seriesFor, comparisonRows, rejectionShare, stageText, shortDate, longDate, monthLabel, periodLabel, weekLabel,
    readQuantity, makeRecord, generateId, totals, selectRecords, summarise, series,
    emptyState, validate, firstConflict, overlapping, migrate, normalize, byDateDesc, mostRecent,
    yearRange, comparePeriods, compare, compareTags, compareWithPrevious, compareWindows, compareReading,
    monthNameOf,
    buildCSV, buildCompareCSV, buildRejectionCSV,
    buildStockCSV, buildLotsCSV, buildReasonsCSV,
    csvCell, csvDocument,
  };
});
