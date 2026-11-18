/*
 * Conta Carta · exportações (PDF, CSV e impressão)
 *
 * Os quatro botões de saída do relatório e do painel. O nome do ficheiro
 * vem do pdf.js, a folha desenha-se a partir do relatório de reports.js e a
 * impressão usa o mesmo PDF — nunca a página do navegador, que carimba a
 * data, o endereço e o número da página no papel.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/core.js'), require('../lib/dom.js'));
  else root.ContaCartaExport = factory(root.ContaCartaCore, root.ContaCartaDom);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, dom) {
  'use strict';

  const fmt = core.format;

  /**
   * `pdf`, `reports` (R) e `feedback`; `state` lê o estado actual;
   * `generated` diz o relatório à vista; `logo` espera pelo logótipo.
   */
  function create({ pdf, reports, feedback, app, generated, logo, reportKind }) {
    const { toast, guard, download } = feedback;
    // o elemento pelo id vem da peça única do ecrã
  const $ = dom.byId;

    /** Nome e título do ficheiro exportado: a regra vive no pdf.js, aqui só se aplica. */
    const meta = (report) => pdf.meta(report, { rejectionTitle: reports.rejectionTitle, rejectionSuffix: reports.rejectionSuffix });

    /** A linha do âmbito: o que o documento cobre, em português corrido. */
    function scopeLine(report, summary, comparison) {
      const parts = [report.kind === 'stock'
        ? `retrato do armazém em ${core.shortDate(summary.start)} · ${fmt(report.stock.items.length)} artigos · ${fmt(report.stock.pending.length)} por entregar`
        : report.kind === 'reasons'
          ? `${fmt(summary.qualityRejected)} cartas chumbadas no teste · ${fmt(report.reasons.filter((reason) => reason.total).length)} motivos`
          : report.kind === 'lots'
            ? `${fmt(report.lots.length)} lotes · ${fmt(report.lotBoard.toDispatch)} por despachar · ${fmt(report.lotBoard.cards)} cartas`
            : comparison
              ? `${fmt(comparison.rows.reduce((total, row) => total + row.records, 0))} ${comparison.rows.reduce((total, row) => total + row.records, 0) === 1 ? 'registo somado' : 'registos somados'} · ${comparison.rows.map((row) => row.name || row.label).join(' × ')}`
              : `${fmt(summary.records.length)} ${summary.records.length === 1 ? 'registo somado' : 'registos somados'} · ${fmt(summary.daysCovered)} de ${fmt(summary.days)} dias com registo`];
      const names = { day: 'relatório diário', week: 'visão semanal', month: 'visão mensal', range: 'visão de período' };
      if (report.rejection) parts.push(meta(report).title.toLowerCase());
      else if (!comparison) parts.push(report.scopeName || names[reportKind()] || 'visão de período');
      if (comparison) {
        const outside = comparison.rows.reduce((total, row) => total + row.outside, 0);
        if (outside) parts.push(`${fmt(outside)} registos fora destes períodos não foram somados.`);
      } else if (summary.outside.length) {
        parts.push(`${fmt(summary.outside.length)} registos fora deste período não foram somados.`);
      }
      return parts.join(' — ');
    }

    /** Monta o PDF do relatório (o mesmo ficheiro para exportar e para imprimir). */
    async function buildPdf(report) {
      await logo();
      const { summary, comparison, rejection } = report;
      const info = meta(report);
      // o quadro de fases vai por linha: o PDF desenha-o sem ter de recalcular nada
      const lotBoardRows = report.kind === 'lots' ? core.lotBoard(report.lots, report.summary.end).rows.map((row) => ({ ...row })) : null;
      const bytes = pdf.build({
        summary,
        label: summary.label,
        title: info.title,
        stock: report.kind === 'stock' ? report.stock : null,
        reasons: report.kind === 'reasons' ? report.reasons : null,
        lots: report.kind === 'lots' ? report.lots : null,
        lotBoard: report.kind === 'lots' ? report.lotBoard : null,
        lotBoardRows,
        rejection,
        generated: report.generated,
        scope: scopeLine(report, summary, comparison),
        series: report.series || core.series(app.state, summary.start, summary.end, 'record'),
        seriesTitle: core.seriesFor(rejection).title,
        seriesMetric: core.seriesFor(rejection).metric,
        comparison,
        comparisonTitle: comparison ? reports.comparisonTitle() : null,
        notes: report.notes,
        logo: app.logo || undefined,
      });
      return { bytes, fileName: `${info.base}${info.suffix}.pdf` };
    }

    /** O relatório à vista (ou o que os controlos dizem agora). */
    const current = () => generated() || reports.buildReport();

    const exportPdf = guard('exportar PDF', async () => {
      const report = current();
      if (!report) { toast('Escolhe o período do relatório primeiro.'); return; }
      const { bytes, fileName } = await buildPdf(report);
      download(fileName, bytes, 'application/pdf');
      toast('Relatório em PDF guardado.');
    });

    /**
     * Imprime o PDF gerado pela aplicação — nunca a página do navegador. O
     * diálogo do navegador carimba no papel a data, o endereço e a página;
     * o PDF imprime exactamente o que foi desenhado.
     */
    const printReport = guard('imprimir', async () => {
      const report = current();
      if (!report) { toast('Escolhe o período do relatório primeiro.'); return; }
      const { bytes, fileName } = await buildPdf(report);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const win = window.open(url, '_blank');
      if (!win) {
        // pop-up bloqueada: descarrega o PDF — o papel sai na mesma, só muda o caminho
        download(fileName, bytes, 'application/pdf');
        toast('Pop-up bloqueada; o PDF foi guardado para imprimir.');
        return;
      }
      try { win.addEventListener('load', () => setTimeout(() => win.print(), 300), { once: true }); } catch (_) { /* alguns leitores não disparam «load» */ }
      setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
    });

    const exportPanel = guard('exportar o painel', async () => {
      const { bytes, fileName } = await buildPdf(reports.panelReport());
      download(fileName, bytes, 'application/pdf');
      toast('Painel em PDF guardado.');
    });

    /** O CSV certo para o relatório à vista (cada tipo tem o seu no core). */
    const exportCsv = guard('exportar CSV', () => {
      const report = current();
      if (!report) { toast('Escolhe o período do relatório primeiro.'); return; }
      const { summary, comparison, rejection } = report;
      const info = meta(report);
      const data = comparison ? core.buildCompareCSV(comparison, summary.label)
        : rejection ? core.buildRejectionCSV(summary, info.title)
        : report.kind === 'reasons' ? core.buildReasonsCSV(report.reasons, summary.start, summary.end)
        : report.kind === 'lots' ? core.buildLotsCSV(report.lots, summary.start, summary.end)
        : report.kind === 'stock' ? core.buildStockCSV(report.stock, core.shortDate(summary.start))
        : core.buildCSV(summary);
      download(`${info.base}${info.suffix}.csv`, data, 'text/csv;charset=utf-8');
      toast('CSV guardado.');
    });

    /** Liga os quatro botões de saída. */
    function wire() {
      $('panelExport').addEventListener('click', () => exportPanel());
      $('exportPdf').addEventListener('click', () => exportPdf());
      $('exportCsv').addEventListener('click', () => exportCsv());
      $('printReport').addEventListener('click', () => printReport());
    }

    return { wire, buildPdf, exportPdf, printReport, exportPanel, exportCsv };
  }

  return { create };
});
