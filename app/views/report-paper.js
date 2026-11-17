/*
 * Conta Carta · folha do relatório (pré-visualização e papel)
 *
 * O que se imprime: a marca do INATRO, os indicadores, as tabelas próprias de
 * cada relatório (armazém, motivos, lotes), a comparação lado a lado, o
 * gráfico e as notas. Recebe o relatório já construído em reports.js — aqui
 * só se desenha.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/core.js'), require('../lib/dom.js'));
  else root.ContaCartaReportPaper = factory(root.ContaCartaCore, root.ContaCartaDom);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, dom) {
  'use strict';

  const fmt = core.format;
  const KIND_LABELS = core.STOCK_KIND_LABELS;
  // o elemento pelo id vem da peça única do ecrã
  const $ = dom.byId;

  /**
   * `app` é o estado (com o relatório gerado), `ui` as peças de desenho,
   * `chartBars` o gráfico e os títulos que vêm de reports.js.
   */
  function create({ app, ui, chartBars, comparisonTitle, rejectionTitle }) {
    const { el, fill, infoButton, today } = ui;

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

    /** Indicadores da folha: produção (5) ou rejeição (5), conforme o relatório. */
    function paperCards() {
      const { summary, rejection, kind, stock, lots } = app.generated;
      if (kind === 'stock') {
        return [
          { label: 'Cartões em armazém', value: fmt(stock.cards), tone: stock.cards ? 'is-ok' : 'is-bad' },
          { label: 'Material em alerta', value: fmt(stock.low.length), tone: stock.low.length ? 'is-bad' : '' },
          { label: 'Sem stock', value: fmt(stock.empty.length), tone: stock.empty.length ? 'is-bad' : '' },
          { label: 'Artigos', value: fmt(stock.items.length) },
          { label: 'Actualizado', value: core.shortDate(today()) },
        ];
      }
      if (kind === 'reasons') {
        const top = app.generated.reasons.reduce((best, reason) => (reason.total > (best?.total || 0) ? reason : best), null);
        return [
          { label: 'Cartas chumbadas', value: fmt(summary.qualityRejected), tone: summary.qualityRejected ? 'is-bad' : '' },
          { label: 'Motivos diferentes', value: fmt(app.generated.reasons.filter((reason) => reason.total).length) },
          { label: 'Motivo principal', value: top && top.total ? top.group : '—' },
          { label: 'Cartas produzidas', value: fmt(summary.produced) },
          { label: 'Aprovação', value: core.formatPercent(summary.approvalRate), tone: 'is-ok' },
        ];
      }
      if (kind === 'lots') {
        return [
          { label: 'Lotes', value: fmt(lots.length) },
          { label: 'Por despachar', value: fmt(app.generated.lotBoard.toDispatch), tone: app.generated.lotBoard.toDispatch ? 'is-bad' : 'is-ok' },
          { label: 'Despachados', value: fmt(app.generated.lotBoard.dispatched), tone: 'is-ok' },
          { label: 'Cartas em lotes', value: fmt(app.generated.lotBoard.cards) },
          { label: 'Delegações', value: fmt(new Set(lots.map((lot) => lot.delegation).filter(Boolean)).size) },
        ];
      }
      if (rejection === 'machine' || rejection === 'quality') {
        const chosen = rejection === 'machine' ? summary.rejected : summary.qualityRejected;
        const chosenRate = rejection === 'machine' ? summary.rejectionRate : summary.qualityRejectionRate;
        const share = core.rejectionShare(summary, rejection);
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

    /** Tabela «lado a lado» da comparação: as dez linhas do core, já com sinal e cor. */
    function comparisonSideBySide(comparison) {
      const [a, b] = comparison.rows;
      const tags = core.compareTags(comparison);
      const rows = core.comparisonRows(comparison).map((line) => el('tr', {}, [
        el('td', { text: line.label }),
        el('td', { class: 'is-number', text: line.first }),
        el('td', { class: 'is-number', text: line.second }),
        // verde quando o movimento é bom (mais produção, menos rejeição), vermelho quando não é
        el('td', { class: `is-number${line.diff === '±0' || line.diff === '±0 p.' ? '' : line.good ? ' is-good' : ' is-bad'}`.trim(), text: line.diff }),
      ]));
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
      const { summary, notes, comparison, rejection, outsideCount, kind } = app.generated;
      const paperTitle = kind === 'stock' ? 'Armazém e material'
        : kind === 'reasons' ? 'Motivos de rejeição (INCAPE)'
        : kind === 'lots' ? 'Lotes por despachar'
        : rejection ? rejectionTitle(rejection) : 'Relatório de produção';
      const comparisonRecords = comparison ? comparison.rows.reduce((total, row) => total + row.records, 0) : 0;
      $('reportHint').textContent = kind === 'stock'
        ? `${fmt(app.generated.stock.items.length)} artigos no armazém · ${fmt(app.generated.stock.low.length)} em alerta`
        : kind === 'lots'
          ? `${fmt(app.generated.lots.length)} lotes no período · ${fmt(app.generated.lotBoard.toDispatch)} por despachar`
          : kind === 'reasons'
            ? `${fmt(app.generated.reasons.filter((reason) => reason.total).length)} motivos com chumbadas · ${fmt(summary.qualityRejected)} cartas`
            : comparison
        ? `${fmt(comparison.rows.length)} períodos lado a lado · `
          + `${fmt(comparisonRecords)} ${comparisonRecords === 1 ? 'registo somado' : 'registos somados'} · `
          + `${fmt(comparison.measured)} com produção`
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
            el('h3', { text: paperTitle }),
            el('p', { text: summary.label }),
            el('p', { class: 'is-muted', text: `Gerado em ${app.generated.generated}` }),
          ]),
        ]),
        comparison ? '' : el('div', { class: 'paper-kpis' }, paperCards().map((card) => el('div', {
          // a coluna estica quando o valor é texto (o nome do motivo principal, por exemplo)
          class: `paper-kpi ${card.tone || ''}${String(card.value).length > 12 ? ' is-wide' : ''}`.trim(),
        }, [el('span', { text: card.label }), el('strong', { text: card.value })]))),
        kind === 'stock' ? stockPaperTable() : '',
        kind === 'reasons' ? reasonsPaperTable() : '',
        kind === 'lots' ? lotsPaperTable() : '',
        kind !== 'stock' && kind !== 'reasons' && kind !== 'lots' && comparison ? el('div', { class: 'compare-block' }, [comparisonSideBySide(comparison), comparisonMachines(comparison)])
          : kind === 'stock' || kind === 'reasons' || kind === 'lots' ? ''
          : paperTable('Por máquina', MACHINE_HEADERS, [
            ...summary.machines.map((machine, index) => [
              core.MACHINES[index], fmt(machine.produced), fmt(machine.approved), fmt(machine.rejected), fmt(machine.qualityRejected), core.formatPercent(machine.approvalRate),
            ]),
            ['Total', fmt(summary.produced), fmt(summary.approved), fmt(summary.rejected), fmt(summary.qualityRejected), core.formatPercent(summary.approvalRate)],
          ], { totalLast: true }),
        comparison && core.compareReading(comparison)
          ? el('p', { class: 'paper-note', text: core.compareReading(comparison) }) : '',
        // título e gráfico viajam juntos: sem isto o título fica órfão numa página e o gráfico vai na seguinte
        kind === 'stock' || kind === 'lots' || kind === 'reasons' ? '' : el('div', { class: 'paper-block' }, [
          el('h4', { class: 'paper-title',
            text: comparison ? comparisonTitle()
              : rejection === 'machine' ? 'Evolução das rejeições da máquina'
              : rejection === 'quality' ? 'Evolução das rejeições no teste de qualidade'
              : 'Evolução' }),
          el('div', { class: 'paper-chart' }, chartBars(reportChartPoints(), paperChartMetric(), { unit: comparison ? 'período' : 'registo', maxPoints: Infinity })),
        ]),
        kind === 'stock' || kind === 'reasons' || kind === 'lots' ? ''
          : !comparison && summary.records.length
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

    /** Armazém em papel: uma linha por material, o que resta em destaque. */
    function stockPaperTable() {
      const { items, low } = app.generated.stock;
      const rows = items
        .slice()
        .sort((a, b) => (b.low - a.low) || (a.name < b.name ? -1 : 1))
        .map((item) => [item.name, KIND_LABELS[item.kind] || KIND_LABELS.outro, fmt(item.received), fmt(item.issued),
          `${fmt(item.balance)} ${item.unit}`, item.minimum ? fmt(item.minimum) : '—']);
      return paperTable('Material em armazém', ['Material', 'Tipo', 'Recebido', 'Dado', 'Em armazém', 'Mínimo'], rows,
        { marks: items.map((item) => (item.low ? 'is-bad' : '')).slice(0, rows.length),
          note: low.length ? `${fmt(low.length)} ${low.length === 1 ? 'material está' : 'materiais estão'} no mínimo ou abaixo dele.` : '' });
    }

    /** Motivos do INCAPE: quantas cartas chumbaram em cada um, por máquina. */
    function reasonsPaperTable() {
      const reasons = app.generated.reasons;
      const rows = reasons
        .filter((reason) => reason.total)
        .sort((a, b) => b.total - a.total)
        .map((reason) => [reason.group, reason.label, fmt(reason.m1), fmt(reason.m2), fmt(reason.total)]);
      const total = reasons.reduce((sum, reason) => sum + reason.total, 0);
      return paperTable('Cartas chumbadas por motivo', ['Categoria', 'Motivo', core.MACHINES[0], core.MACHINES[1], 'Total'],
        rows.length ? rows : [['—', 'Nenhuma carta chumbada neste período', '', '', '']],
        rows.length ? ['', 'Total', fmt(reasons.reduce((sum, reason) => sum + reason.m1, 0)),
          fmt(reasons.reduce((sum, reason) => sum + reason.m2, 0)), fmt(total)] : {},
        { totalLast: true });
    }

    /** Lotes: referência, delegação, cartas e a data de cada fase. */
    function lotsPaperTable() {
      const { lots, lotBoard } = app.generated;
      const rows = lots
        .slice()
        .sort((a, b) => (a.start > b.start ? -1 : 1))
        .map((lot) => [lot.reference, lot.delegation || '—', fmt(lot.quantity),
          ...core.LOT_STAGES.map((stage) => {
            const entry = lot.stages[stage];
            if (entry.state === 'feito') return entry.updated ? core.shortDate(entry.updated) : 'feito';
            return entry.state === 'em-curso' ? 'em curso' : '—';
          })]);
      return paperTable('Lotes no período', ['Lote', 'Delegação', 'Cartas', ...core.LOT_STAGES.map((stage) => core.LOT_STAGE_LABELS[stage])],
        rows.length ? rows : [['—', 'Nenhum lote neste período', '', '', '', '', '']],
        { note: lotBoard.toDispatch ? `${fmt(lotBoard.toDispatch)} ${lotBoard.toDispatch === 1 ? 'lote falta' : 'lotes faltam'} despachar.` : 'Todos os lotes do período foram despachados.' });
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
        options.note ? el('p', { class: 'paper-note', text: options.note }) : '',
      ]);
    }

    return { render: renderPaper, renderPaper, paperCards, paperChartMetric, reportChartPoints };
  }

  return { create };
});
