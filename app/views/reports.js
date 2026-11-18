/*
 * Conta Carta · relatórios (pré-visualização e folha de papel)
 *
 * Os controlos dos relatórios, a escolha do período, os indicadores da folha,
 * a tabela e a comparação lado a lado. Desenha para o ecrã e para o PDF a
 * partir das mesmas peças; quem manda nos dados é o app.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/core.js'), require('../lib/dom.js'));
  else root.ContaCartaReports = factory(root.ContaCartaCore, root.ContaCartaDom);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, dom) {
  'use strict';

  /** Tudo o que os relatórios precisam do resto da aplicação. */
  let app = null;
  let el = null;
  let fill = null;
  let infoButton = null;
  let dateBox = null;
  let today = null;
  let stamp = null;
  // o elemento pelo id vem da peça única do ecrã
  const $ = dom.byId;
  let refreshZoom = () => {};
  let filterPeriod = null;
  let stockOverview = () => { throw new Error('stockOverview por ligar'); };
  let scopeLabel = null;


  /** O app empresta o estado e as peças de desenho; o módulo não guarda mais nada. */
  function attach(deps) {
    app = deps.app;
    ({ el, fill, infoButton, dateBox } = deps.ui);
    today = deps.today;
    stamp = deps.stamp;
    refreshZoom = deps.refreshOpenZoom || refreshZoom;
    filterPeriod = deps.filterPeriod;
    stockOverview = deps.stockOverview;
    scopeLabel = deps.scopeLabel;
  }


  /**
   * Uma caixa de data dos relatórios: `id` liga-a ao estado (`reportDate`,
   * `reportMonth`, …) e `kind` diz se é um dia ou um mês. A caixa é a mesma
   * peça do resto da aplicação (`ui.dateBox`): `dd/mm/aaaa` à vista, o
   * calendário do sistema ao lado. O campo nasce aqui, dentro da caixa —
   * estes controlos são feitos em JS e não existem no index.html.
   */
  function dateField(label, id, kind, value) {
    const key = id.replace('report', '').toLowerCase();
    const input = el('input', {
      id, type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false',
      'aria-label': label, placeholder: kind === 'month' ? 'mm/aaaa' : 'dd/mm/aaaa',
    });
    const box = dateBox({ input, kind, value, label, onPick: (iso) => { app.report[key] = iso; renderReport(); } });
    return el('label', { class: 'field' }, [label, box.node]);
  }

  /**
   * Campo da comparação: escreve directo no estado, sem depender do id (os
   * dois meses e os dois anos têm de escrever em chaves diferentes).
   */
  function pickField(label, key, period) {
    if (period === 'year') {
      // os anos não são datas: são números de quatro dígitos
      return el('label', { class: 'field' }, [
        label,
        el('input', { type: 'number', value: app.report[key], min: 1900, max: 2200, step: 1, 'aria-label': label,
          onchange: (event) => { app.report[key] = event.target.value; renderReport(); } }),
      ]);
    }
    const input = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false',
      'aria-label': label, placeholder: 'mm/aaaa' });
    const box = dateBox({ input, kind: 'month', value: app.report[key], label, onPick: (iso) => { app.report[key] = iso; renderReport(); } });
    return el('label', { class: 'field' }, [label, box.node]);
  }

  function renderReportControls() {
    const kind = app.report.kind;
    const fields = [];
    if (kind === 'day' || kind === 'week') {
      fields.push(dateField(kind === 'week' ? 'Data da semana' : 'Dia', 'reportDate', 'date', app.report.date));
    }
    if (kind === 'month') fields.push(dateField('Mês', 'reportMonth', 'month', app.report.month));
    if (DATE_REPORTS.includes(kind)) {
      fields.push(dateField('De', 'reportStart', 'date', app.report.start));
      fields.push(dateField('Até', 'reportEnd', 'date', app.report.end));
    }
    const comparing = kind === 'months' || kind === 'years';
    if (kind === 'months') {
      fields.push(pickField('Mês 1', 'compareA', 'month'));
      fields.push(pickField('Mês 2', 'compareB', 'month'));
    }
    if (kind === 'years') {
      fields.push(pickField('Ano 1', 'yearsA', 'year'));
      fields.push(pickField('Ano 2', 'yearsB', 'year'));
    }
    if (comparing) fields.push(el('span', { class: 'report-info' }, [infoButton('compare')]));
    fill($('reportDates'), ...fields);
  }

  /** Os relatórios que se escolhem por intervalo de dias. */
  const DATE_REPORTS = ['range', 'rejectionMachine', 'rejectionQuality', 'reasons', 'lots'];

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
    if (DATE_REPORTS.includes(kind)) {
      if (!core.isDate(app.report.start) || !core.isDate(app.report.end)) throw new Error('Escreve as duas datas do período em dd/mm/aaaa.');
      if (app.report.end < app.report.start) throw new Error('A data final não pode ser anterior à data de início.');
      return { start: app.report.start, end: app.report.end };
    }
    if (!core.isDate(app.report.date)) throw new Error('Escreve o dia do relatório em dd/mm/aaaa.');
    return { start: app.report.date, end: app.report.date };
  }

  const rejectionKind = (kind) => (kind === 'rejectionMachine' ? 'machine' : kind === 'rejectionQuality' ? 'quality' : null);
  const rejectionTitle = (type) => (type === 'machine' ? 'Relatório de rejeição da máquina' : 'Relatório de rejeição no teste de qualidade');
  const rejectionSuffix = (type) => (type === 'machine' ? 'rejeicao-maquina' : 'rejeicao-qualidade');

  /** As notas dos registos, por período — o que vai para o fim da folha. */
  const noteList = (summary) => summary.records.filter((record) => record.notes)
    .map((record) => `${core.periodLabel(record.start, record.end)} — ${record.notes}`);

  function buildReport() {
    const kind = kindOfReport();
    const comparing = kind === 'months' || kind === 'years';
    const rejection = rejectionKind(kind);
    // o armazém não é um período: é o retrato de agora
    if (kind === 'stock') return buildStockReport();
    if (kind === 'lots' || kind === 'reasons') {
      const period = reportPeriod();
      const inRange = (item) => (item.start || item.updated || today()) >= period.start && (item.start || item.updated || today()) <= period.end;
      const summary = core.summarise(app.state, period.start, period.end);
      summary.label = core.periodLabel(period.start, period.end);
      if (kind === 'reasons') {
        return {
          kind: 'reasons', summary, comparison: null, rejection: null, periodSummaries: null,
          reasons: core.reasonTotals(summary.records),
          notes: noteList(summary),
          outsideCount: summary.outside.length,
          series: core.series(app.state, period.start, period.end, 'month'),
          generated: stamp(),
        };
      }
      const lots = app.state.lots.filter(inRange);
      return {
        kind: 'lots', summary, comparison: null, rejection: null, periodSummaries: null,
        lots, lotBoard: core.lotBoard(lots, period.end),
        notes: [], outsideCount: 0,
        series: core.series(app.state, period.start, period.end, 'month'),
        generated: stamp(),
      };
    }
    let period, comparison = null;
    try {
      if (comparing) {
        comparison = core.compare(app.state, reportComparison());
        period = { start: comparison.start, end: comparison.end };
      } else if (rejection) {
        if (!core.isDate(app.report.start) || !core.isDate(app.report.end)) throw new Error('Escreve as duas datas do período em dd/mm/aaaa.');
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
  /** Retrato do armazém: não depende de período, é o que está na prateleira hoje. */
  function buildStockReport() {
    const overview = stockOverview();
    const period = { start: today(), end: today() };
    const summary = core.summarise(app.state, period.start, period.end);
    summary.label = `Armazém em ${core.shortDate(period.start)}`;
    return {
      kind: 'stock', summary, comparison: null, rejection: null, periodSummaries: null,
      stock: overview, notes: [], outsideCount: 0,
      series: core.series(app.state, period.start, period.end, 'record'),
      generated: stamp(),
    };
  }

  /** O painel também se arquiva: mesmo período do filtro, mesmo PDF do relatório. */
  function panelReport() {
    const period = filterPeriod();
    const summary = core.summarise(app.state, period.start, period.end);
    summary.label = scopeLabel();
    return {
      kind: 'panel', summary, comparison: null, rejection: null, periodSummaries: null,
      notes: noteList(summary), outsideCount: summary.outside.length,
      series: core.series(app.state, period.start, period.end, app.filter.mode === 'period' ? 'record' : 'month'),
      scopeName: app.filter.mode === 'month' ? 'visão mensal' : app.filter.mode === 'year' ? 'visão anual' : 'visão de período',
      generated: stamp(),
    };
  }

  const kindOfReport = () => app.report.kind;

  /** Cada tipo de relatório pede o seu próprio rótulo legível. */
  function reportLabel(kind, period, comparison) {
    if (kind === 'reasons') return `Motivos de rejeição · ${core.periodLabel(period.start, period.end)}`;
    if (kind === 'lots') return `Lotes por despachar · ${core.periodLabel(period.start, period.end)}`;
    if (kind === 'stock') return `Armazém · ${core.shortDate(today())}`;
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

  /** A folha (impressão e pré-visualização) é um módulo próprio: aqui só se guarda. */
  let paper = { render() {}, paperChartMetric: () => 'produced', reportChartPoints: () => [] };

  function renderReport() {
    app.generated = buildReport();
    $('reportWrap').hidden = !app.generated;
    if (app.generated) paper.render();
    refreshZoom('report');
  }

  return {
    attach,
    usePaper: (sheet) => { paper = sheet; },
    renderReportControls, renderReport,
    buildReport, buildStockReport, panelReport,
    rejectionKind, rejectionTitle, rejectionSuffix,
    reportLabel, DATE_REPORTS, comparisonTitle, reportPeriod,
  };
});
