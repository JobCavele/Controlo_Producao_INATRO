/*
 * Conta Carta · gerador de PDF do relatório (A4, sem dependências externas)
 *
 * Escreve um PDF 1.4 à mão: texto em Helvetica/Helvetica-Bold (fontes base do
 * PDF), cartões em rectângulos arredondados, barras de qualidade e tabela
 * paginada. A marca do Conta Carta é desenhada com caminhos vectoriais, com as
 * mesmas medidas do logótipo da instituição, por isso o relatório não depende
 * de imagens nem de tipos de letra instalados.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.ContaCartaPdf = factory(root.ContaCartaCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  const PAGE = { width: 595.28, height: 841.89, margin: 46 };
  const BOTTOM = PAGE.margin + 46;            // rodapé reservado
  /** Cores da marca em valores 0–1; os hexágono são os mesmos da folha de estilos. */
  const tone = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const COLORS = {
    white: [1, 1, 1],
    green: tone('#0e7a2e'),
    dark: tone('#0b3d1f'),
    ink: tone('#16241b'),
    muted: tone('#5b6b5f'),
    line: tone('#e4eae2'),
    tint: tone('#eaf4ec'),
    red: tone('#b4362d'),
    amber: tone('#a46a12'),
  };
  const CONTENT = PAGE.width - PAGE.margin * 2;

  /* -------------------------------------------------- nomes de ficheiro --- */

  /**
   * Nome e título do ficheiro exportado. Uma só regra para PDF, CSV e cópia:
   * os nomes levam dd-mm-yyyy (a barra não cabe num ficheiro) e o sufixo diz
   * de que relatório se trata.
   */
  function meta(report, { rejectionTitle, rejectionSuffix, kind }) {
    const { comparison, rejection, summary } = report;
    const fileDate = (iso) => (core.isDate(iso) ? core.shortDate(iso).replaceAll('/', '-') : iso);
    const fileKey = (key) => (key.split('-').length === 2 ? `${key.slice(5, 7)}-${key.slice(0, 4)}` : key);
    if (report.kind === 'stock') return { suffix: '-armazem', title: 'Armazém e material', base: `contacarta-armazem-${fileDate(summary.start)}` };
    if (report.kind === 'reasons') return { suffix: '-motivos', title: 'Motivos de rejeição (INCAPE)', base: `contacarta-motivos-${fileDate(summary.start)}-a-${fileDate(summary.end)}` };
    if (report.kind === 'lots') return { suffix: '-lotes', title: 'Lotes por despachar', base: `contacarta-lotes-${fileDate(summary.start)}-a-${fileDate(summary.end)}` };
    if (comparison) {
      return { suffix: '-comparacao', title: 'Relatório de produção',
        base: `contacarta-${fileKey(comparison.rows[0].key)}-vs-${fileKey(comparison.rows[1].key)}` };
    }
    if (rejection) return { suffix: `-${rejectionSuffix(rejection)}`, title: rejectionTitle(rejection),
      base: `contacarta-${fileDate(summary.start)}-a-${fileDate(summary.end)}` };
    return { suffix: '', title: 'Relatório de produção',
      base: `contacarta-${fileDate(summary.start)}-a-${fileDate(summary.end)}` };
  }

  /* ------------------------------------------------------- medição --- */

  const NARROW = "ijlt.,:;'!|()[]{}/\\-";
  const WIDE = 'MWmw@';

  /** Aproximação usada apenas quando não há canvas disponível (testes em Node). */
  function fallbackWidth(text, size, bold) {
    let units = 0;
    for (const char of String(text)) {
      if (NARROW.includes(char)) units += 250;
      else if (WIDE.includes(char)) units += 870;
      else if (char >= '0' && char <= '9') units += 556;
      else units += 580;
    }
    return (units / 1000) * size * (bold ? 1.05 : 1);
  }

  let measure = fallbackWidth;
  /** A aplicação instala um medidor de canvas (métricas compatíveis com Helvetica). */
  function setMeasurer(fn) { measure = typeof fn === 'function' ? fn : fallbackWidth; }

  /** Trunca texto com reticências se exceder a largura máxima permitida. */
  function fit(text, size, maxWidth, bold) {
    const value = String(text ?? '');
    if (!maxWidth || measure(value, size, bold) <= maxWidth) return value;
    let cut = value;
    while (cut.length > 1 && measure(cut + '…', size, bold) > maxWidth) cut = cut.slice(0, -1);
    return cut.replace(/[\s,;-]+$/, '') + '…';
  }

  /** Divide texto em múltiplas linhas respeitando a largura máxima disponível. */
  function wrap(text, size, maxWidth, bold) {
    const lines = [];
    let current = '';
    for (const word of String(text ?? '').split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && measure(candidate, size, bold) > maxWidth) { lines.push(current); current = word; }
      else current = candidate;
    }
    if (current) lines.push(current);
    return lines.length ? lines : [''];
  }

  /* ------------------------------------------------- escrita de PDF --- */

  const round = (value) => Math.round(value * 100) / 100;
  const rgb = (color) => color.map(round).join(' ');
  const octal = (byte) => '\\' + byte.toString(8).padStart(3, '0');

  /** ASCII directo, acentos portugueses em WinAnsi, o resto varia «?». */
  const WINANSI = new Map(Object.entries({
    'ç': 0xe7, 'á': 0xe1, 'é': 0xe9, 'í': 0xed, 'ó': 0xf3, 'ú': 0xfa, 'à': 0xe0, 'è': 0xe8,
    'ê': 0xea, 'ô': 0xf4, 'ã': 0xe3, 'õ': 0xf5, 'â': 0xe2, 'î': 0xee, 'û': 0xfb, 'ù': 0xf9,
    'ë': 0xcb, 'ï': 0xef, 'ü': 0xfc, 'Ç': 0xc7, 'Á': 0xc1, 'É': 0xc9, 'Í': 0xcd, 'Ó': 0xd3,
    'Ú': 0xda, 'À': 0xc0, 'Ê': 0xca, 'Ô': 0xd4, 'Ã': 0xc3, 'Õ': 0xd5, 'Â': 0xc2,
    '«': 0xab, '»': 0xbb, '“': 0x93, '”': 0x94, '‘': 0x91, '’': 0x92, '–': 0x96, '—': 0x97,
    '…': 0x85, '·': 0xb7, '•': 0x95, '°': 0xb0, '€': 0x80, '\u00a0': 0x20,
    '×': 0xd7, '±': 0xb1, '−': 0x2d, '÷': 0xf7, 'ª': 0xaa, 'º': 0xba, '£': 0xa3, '½': 0xbd,
  }).map(([char, byte]) => [char.charCodeAt(0), byte]));

  /** Codifica texto para strings literais do PDF usando a tabela WinAnsiEncoding. */
  function encodeText(input) {
    let out = '';
    for (const char of String(input ?? '')) {
      const code = char.codePointAt(0);
      if (char === '(' || char === ')' || char === '\\') out += '\\' + char;
      else if (code < 32 || code === 127) out += ' ';
      else if (code < 128) out += char;
      else out += octal(WINANSI.get(code) ?? 0x3f);
    }
    return out;
  }

  /** Gera caminho vetorial em sintaxe PDF com curvas de Bézier para rectângulos de cantos arredondados. */
  function roundedPath(x, y, width, height, radius) {
    const k = radius * 0.5523;
    const right = x + width, top = y + height;
    return [
      `${round(x + radius)} ${round(y)} m`, `${round(right - radius)} ${round(y)} l`,
      `${round(right - radius + k)} ${round(y)} ${round(right)} ${round(y + radius - k)} ${round(right)} ${round(y + radius)} c`,
      `${round(right)} ${round(top - radius)} l`,
      `${round(right)} ${round(top - radius + k)} ${round(right - radius + k)} ${round(top)} ${round(right - radius)} ${round(top)} c`,
      `${round(x + radius)} ${round(top)} l`,
      `${round(x + radius - k)} ${round(top)} ${round(x)} ${round(top - radius + k)} ${round(x)} ${round(top - radius)} c`,
      `${round(x)} ${round(y + radius)} l`,
      `${round(x)} ${round(y + radius - k)} ${round(x + radius - k)} ${round(y)} ${round(x + radius)} ${round(y)} c`, 'h',
    ].join(' ');
  }

  const latin1 = (text) => {
    const bytes = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
    return bytes;
  };

  class PdfWriter {
    constructor() {
      this.store = new Map();
      this.next = 1;
      this.catalog = this.alloc();
      this.pagesRoot = this.alloc();
      this.fontRegular = this.alloc();
      this.fontBold = this.alloc();
      this.logoDef = null;     // definido em build() quando há bytes de JPEG
      this.header = null;      // definido pelo layout para abrir páginas novas
      this.pages = [];
      this.ops = [];
      this.y = 0;
      this.footerNote = 'Conta Carta · INATRO, IP';
    }

    alloc() { const id = this.next; this.next += 1; return id; }
    put(id, body, stream) { this.store.set(id, { body, stream }); }

    newPage() { this.ops = []; this.pages.push({ ops: this.ops }); this.y = PAGE.height - PAGE.margin; return this; }

    nextPage() {
      this.newPage();
      if (this.header) this.header(this, false);
      return this;
    }

    /* ------------------------------------------------------- desenho --- */

    text(value, x, y, size, options = {}) {
      const { bold = false, color = COLORS.ink, align = 'left', maxWidth = 0 } = options;
      const placed = (value, width) => (align === 'right' ? x - width : align === 'center' ? x - width / 2 : x);
      let text = fit(value, size, maxWidth, bold);
      let width = measure(text, size, bold);
      let at = placed(text, width);
      // nada pode sair da folha: se a linha passar da margem, encolhe até caber
      const limit = PAGE.width - 18;
      if (at + width > limit) {
        text = fit(text, size, Math.max(12, limit - at), bold);
        width = measure(text, size, bold);
        at = placed(text, width);
      }
      this.ops.push('BT', `/F${bold ? 2 : 1} ${round(size)} Tf`, `${rgb(color)} rg`,
        `${round(at)} ${round(y)} Td`, `(${encodeText(text)}) Tj`, 'ET');
      return width;
    }

    /** Um caminho: recebe operadores `m`/`l`/`c` e traça ou preenche. */
    path(operators, options = {}) {
      const { stroke = null, fill = null, width = 1, dash = null, cap = 0 } = options;
      const ops = [];
      if (stroke) ops.push(`${rgb(stroke)} RG`, `${round(width)} w`, `${cap} J`, `${cap} j`, dash ? `[${dash.map(round).join(' ')}] 0 d` : '[] 0 d');
      if (fill) ops.push(`${rgb(fill)} rg`);
      ops.push(...operators, stroke && fill ? 'B' : stroke ? 'S' : 'f');
      this.ops.push(...ops);
      return this;
    }

    fillBox(x, y, width, height, color) {
      if (width <= 0 || height <= 0) return;
      this.ops.push(`${rgb(color)} rg`, `${round(x)} ${round(y)} ${round(width)} ${round(height)} re f`);
    }

    /** Desenha o logótipo registado (JPEG) no rectângulo dado. */
    image(x, y, width, height) {
      if (!this.logoDef) return;
      this.ops.push('q', `${round(width)} 0 0 ${round(height)} ${round(x)} ${round(y)} cm`, '/Im1 Do', 'Q');
    }

    card(x, y, width, height, radius, fill, border) {
      this.ops.push(`${rgb(fill)} rg`, roundedPath(x, y, width, height, radius), 'f');
      if (border) this.ops.push(`${rgb(border)} RG`, '0.7 w', roundedPath(x, y, width, height, radius), 'S');
    }

    rule(x1, y1, x2, y2, color = COLORS.line, width = 0.6) {
      this.ops.push(`${rgb(color)} RG`, `${round(width)} w`, `${round(x1)} ${round(y1)} m`, `${round(x2)} ${round(y2)} l`, 'S');
    }

    /* --------------------------------------------------------- saída --- */

    /** Fecha as páginas (rodapé com paginação) e devolve os bytes do ficheiro. */
    finish() {
      const total = this.pages.length;
      const xobjects = this.logoDef ? ` /XObject << /Im1 ${this.logoDef.id} 0 R >>` : '';
      this.pages.forEach((page, index) => {
        page.ops.push(...footerOps(index + 1, total, this.footerNote));
        const contentId = this.alloc();
        const pageId = this.alloc();
        page.id = pageId;
        this.put(contentId, '<< /Length * >>', page.ops.join('\n'));
        this.put(pageId, `<< /Type /Page /Parent ${this.pagesRoot} 0 R `
          + `/MediaBox [0 0 ${round(PAGE.width)} ${round(PAGE.height)}] `
          + `/Resources << /Font << /F1 ${this.fontRegular} 0 R /F2 ${this.fontBold} 0 R >>${xobjects}`
          + ` >> /Contents ${contentId} 0 R >>`);
      });
      if (this.logoDef) {
        // JPEG embutido tal e qual: o PDF só transporta os bytes, quem descodifica é o leitor
        let binary = '';
        for (let index = 0; index < this.logoDef.bytes.length; index += 1) binary += String.fromCharCode(this.logoDef.bytes[index]);
        this.put(this.logoDef.id, `<< /Type /XObject /Subtype /Image /Width ${this.logoDef.pixelWidth} /Height ${this.logoDef.pixelHeight}`
          + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length * >>', binary);
      }

      this.put(this.fontRegular, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      this.put(this.fontBold, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      this.put(this.catalog, `<< /Type /Catalog /Pages ${this.pagesRoot} 0 R >>`);
      this.put(this.pagesRoot, `<< /Type /Pages /Count ${total} /Kids [${this.pages.map((page) => `${page.id} 0 R`).join(' ')}] >>`);

      const encoder = new TextEncoder();
      const chunks = [];
      let offset = 0;
      const append = (bytes) => { chunks.push(bytes); offset += bytes.length; };
      append(encoder.encode('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n'));

      const offsets = new Map();
      for (let id = 1; id < this.next; id += 1) {
        offsets.set(id, offset);
        const entry = this.store.get(id);
        append(encoder.encode(`${id} 0 obj\n`));
        if (entry && typeof entry.stream === 'string') {
          const bytes = latin1(entry.stream);
          append(encoder.encode(`${entry.body.replace('/Length *', `/Length ${bytes.length}`)}\nstream\n`));
          append(bytes);
          append(encoder.encode('\nendstream\nendobj\n'));
        } else {
          append(encoder.encode(`${entry ? entry.body : '<< >>'}\nendobj\n`));
        }
      }

      const start = offset;
      let xref = `xref\n0 ${this.next}\n0000000000 65535 f \n`;
      for (let id = 1; id < this.next; id += 1) xref += `${String(offsets.get(id)).padStart(10, '0')} 00000 n \n`;
      xref += `trailer\n<< /Size ${this.next} /Root ${this.catalog} 0 R >>\nstartxref\n${start}\n%%EOF\n`;
      append(latin1(xref));

      const bytes = new Uint8Array(offset);
      let at = 0;
      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
      return bytes;
    }
  }

  function footerOps(page, total, note) {
    return [
      `${rgb(COLORS.line)} RG`, '0.6 w', `${PAGE.margin} 44 m ${PAGE.width - PAGE.margin} 44 l S`,
      'BT', '/F1 8 Tf', `${rgb(COLORS.muted)} rg`, `${PAGE.margin} 30 Td`, `(${encodeText(note)}) Tj`, 'ET',
      'BT', '/F1 8 Tf', `${rgb(COLORS.muted)} rg`,
      `${round(PAGE.width - PAGE.margin - measure(`Página ${page} de ${total}`, 8, false))} 30 Td`,
      `(${encodeText(`Página ${page} de ${total}`)}) Tj`, 'ET',
    ];
  }

  /* ------------------------------------------------------- relatório --- */

  const COLUMNS = [
    { key: 'period', title: 'Período', x: 0, width: 126, align: 'left' },
    { key: 'produced', title: 'Produzidas', x: 132, width: 64, align: 'right' },
    { key: 'approved', title: 'Aprovadas', x: 202, width: 56, align: 'right' },
    { key: 'rejected', title: 'Rej. máquina', x: 264, width: 70, align: 'right' },
    { key: 'qualityRejected', title: 'Rej. qualidade', x: 340, width: 74, align: 'right' },
    { key: 'rate', title: 'Aprovação', x: 420, width: CONTENT - 420, align: 'right' },
  ];

  /** Colunas da comparação lado a lado: o 1.º e o 2.º período, e a diferença entre eles. */
  const SIDE_COLUMNS = [
    { key: 'metric', title: 'Métrica', x: 0, width: 172, align: 'left' },
    { key: 'first', title: '', x: 172, width: 128, align: 'right' },
    { key: 'second', title: '', x: 300, width: 128, align: 'right' },
    { key: 'diff', title: 'Diferença', x: 428, width: CONTENT - 428, align: 'right' },
  ];

  /** Colunas do «Por máquina» da comparação: uma linha por máquina e por período. */
  const SIDE_MACHINE_COLUMNS = [
    { key: 'tag', title: 'Período', x: 0, width: 50, align: 'left' },
    { key: 'machine', title: 'Origem', x: 50, width: 108, align: 'left' },
    { key: 'produced', title: 'Produzidas', x: 158, width: 64, align: 'right' },
    { key: 'approved', title: 'Aprovadas', x: 222, width: 64, align: 'right' },
    { key: 'rejected', title: 'Rej. máquina', x: 286, width: 70, align: 'right' },
    { key: 'qualityRejected', title: 'Rej. qualidade', x: 356, width: 74, align: 'right' },
    { key: 'rate', title: 'Aprovação', x: 430, width: CONTENT - 430, align: 'right' },
  ];

  /** Colunas dos motivos do INCAPE: uma linha por motivo, com as duas máquinas. */
  const REASON_COLUMNS = [
    { key: 'group', title: 'Categoria', x: 0, width: 104, align: 'left' },
    { key: 'label', title: 'Motivo', x: 108, width: 219, align: 'left' },
    { key: 'm1', title: core.MACHINES[0], x: 331, width: 56, align: 'right' },
    { key: 'm2', title: core.MACHINES[1], x: 391, width: 56, align: 'right' },
    { key: 'total', title: 'Total', x: 451, width: CONTENT - 451, align: 'right' },
  ];

  /** Colunas dos lotes: identificação, delegação, cartas e a data de cada fase. */
  const LOT_COLUMNS = [
    { key: 'reference', title: 'Lote', x: 0, width: 86, align: 'left' },
    { key: 'delegation', title: 'Delegação', x: 90, width: 146, align: 'left' },
    { key: 'quantity', title: 'Cartas', x: 238, width: 46, align: 'right' },
    ...['personalizacao', 'impressao', 'qualidade', 'despacho'].map((stage, index) => ({
      key: stage, title: core.LOT_STAGE_LABELS[stage].slice(0, 10), x: 286 + index * 54.5, width: 54, align: 'right',
    })),
  ];

  /** Colunas do armazém: o que entrou, o que saiu e o que resta. */
  const STOCK_COLUMNS = [
    { key: 'name', title: 'Material', x: 0, width: 146, align: 'left' },
    { key: 'contracted', title: 'Contratado', x: 150, width: 44, align: 'right' },
    { key: 'pending', title: 'Por entregar', x: 196, width: 46, align: 'right' },
    { key: 'received', title: 'Entregue', x: 244, width: 42, align: 'right' },
    { key: 'issued', title: 'Dado', x: 288, width: 34, align: 'right' },
    { key: 'balance', title: 'Em armazém', x: 324, width: 62, align: 'right' },
    { key: 'minimum', title: 'Mínimo', x: 388, width: 36, align: 'right' },
    { key: 'delivered', title: 'Entrega', x: 426, width: 42, align: 'right' },
    { key: 'updated', title: 'Movimento', x: 470, width: CONTENT - 470, align: 'right' },
  ];

  /**
   * Monta o PDF do relatório.
   * `input` = { summary, label, title, rejection, generated, scope, series, seriesTitle,
   *             seriesMetric, notes, comparison, comparisonTitle }
   * `rejection` = 'machine' | 'quality' abre a folha do relatório de rejeição;
   * em qualquer outro caso, é a folha do relatório de produção (com ou sem comparação).
   */
  function build(input) {
    const pdf = new PdfWriter();
    if (input.logo && input.logo.bytes && input.logo.bytes.length) {
      pdf.logoDef = {
        id: pdf.alloc(),
        bytes: input.logo.bytes,
        pixelWidth: input.logo.pixelWidth || 979,
        pixelHeight: input.logo.pixelHeight || 319,
      };
    }
    pdf.footerNote = 'Conta Carta · INATRO, IP — registo de produção de cartas de condução';
    pdf.header = (target, withLogo) => letterhead(target, input, withLogo);
    pdf.newPage();
    pdf.header(pdf, true);

    if (input.comparison) {
      comparisonTable(pdf, input.comparison, input.comparisonTitle || 'Comparação');
      machineCompareBlock(pdf, input.comparison);
    } else if (input.stock) {
      stockFigures(pdf, input);
    } else if (input.reasons) {
      keyFigures(pdf, input);
      reasonTable(pdf, input);
    } else if (input.lots) {
      keyFigures(pdf, input);
      lotTable(pdf, input);
    } else {
      keyFigures(pdf, input);
      machineBlock(pdf, input.summary);
    }
    if (input.scope) note(pdf, input.scope, COLORS.tint, null);
    if (input.notes && input.notes.length) note(pdf, input.notes.join('\n'), COLORS.white, 'Notas dos registos');
    if (!input.stock && !input.reasons && !input.lots) seriesBlock(pdf, input);
    if (input.stock) stockTable(pdf, input);
    if (!input.comparison && !input.stock && !input.reasons && !input.lots) recordTable(pdf, input);
    return pdf.finish();
  }

  /** Os quatro ou cinco indicadores grandes da folha, conforme o tipo de relatório. */
  function keyFigureCards(input) {
    const summary = input.summary;
    if (input.stock) {
      const items = input.stock.items || [];
      const pending = input.stock.pending || [];
      return [
        ['Cartões em armazém', core.format(input.stock.cards), 'cartões em branco disponíveis', input.stock.cards ? COLORS.green : COLORS.red],
        ['Material em alerta', core.format(input.stock.low.length), 'no mínimo ou abaixo dele', input.stock.low.length ? COLORS.red : COLORS.muted],
        ['Por entregar', core.format(pending.length), 'do contrato, ainda em falta', pending.length ? COLORS.amber : COLORS.green],
        ['Material controlado', core.format(items.length), 'artigos no armazém', COLORS.ink],
        ['Retrato', core.shortDate(summary.start), 'última posição do armazém', COLORS.ink],
      ];
    }
    if (input.reasons) {
      const top = input.reasons.reduce((best, reason) => (reason.total > (best ? best.total : 0) ? reason : best), null);
      return [
        ['Cartas chumbadas', core.format(summary.qualityRejected), 'no teste de qualidade', summary.qualityRejected ? COLORS.red : COLORS.muted],
        ['Motivos diferentes', core.format(input.reasons.filter((reason) => reason.total).length), 'dos motivos do INCAPE', COLORS.ink],
        ['Motivo principal', top && top.total ? top.group : '—', top && top.total ? top.label : 'sem chumbadas no período', COLORS.ink],
        ['Cartas produzidas', core.format(summary.produced), 'no período', COLORS.dark],
        ['Aprovação', core.formatPercent(summary.approvalRate), `${core.format(summary.approved)} de ${core.format(summary.produced)} cartas`, COLORS.green],
      ];
    }
    if (input.lots) {
      const board = input.lotBoard || { toDispatch: 0, dispatched: 0, cards: 0 };
      const delegations = new Set(input.lots.map((lot) => lot.delegation).filter(Boolean));
      return [
        ['Lotes', core.format(input.lots.length), 'no período', COLORS.dark],
        ['Por despachar', core.format(board.toDispatch), 'ainda no armazém', board.toDispatch ? COLORS.amber : COLORS.green],
        ['Despachados', core.format(board.dispatched), 'já entregues', COLORS.green],
        ['Cartas em lotes', core.format(board.cards), 'somatório dos lotes', COLORS.ink],
        ['Delegações', core.format(delegations.size), 'destinos diferentes', COLORS.ink],
      ];
    }
    if (input.rejection === 'machine' || input.rejection === 'quality') {
      const isMachine = input.rejection === 'machine';
      const chosen = isMachine ? summary.rejected : summary.qualityRejected;
      const chosenRate = isMachine ? summary.rejectionRate : summary.qualityRejectionRate;
      const totalScrapped = summary.rejected + summary.qualityRejected;
      const share = core.rejectionShare(summary, input.rejection);
      return [
        ['Produzidas', core.format(summary.produced), 'cartas no período', COLORS.dark],
        [isMachine ? 'Rej. máquina' : 'Rej. qualidade', core.format(chosen), `taxa ${core.formatPercent(chosenRate)}`, chosen ? COLORS.red : COLORS.muted],
        ['Do total rejeitado', share === null ? '—' : core.formatPercent(share), share === null ? 'sem rejeições no período' : `${core.format(chosen)} de ${core.format(totalScrapped)} rejeições`, COLORS.ink],
        ['Aprovação', core.formatPercent(summary.approvalRate), 'taxa final', COLORS.green],
        ['Registos', core.format(summary.records.length), `${core.format(summary.daysCovered)} de ${core.format(summary.days)} dias`, COLORS.ink],
      ];
    }
    return [
      ['Produzidas', core.format(summary.produced), 'cartas no período', COLORS.dark],
      ['Aprovadas', core.format(summary.approved), `taxa ${core.formatPercent(summary.approvalRate)}`, COLORS.green],
      ['Rej. máquina', core.format(summary.rejected), `taxa ${core.formatPercent(summary.rejectionRate)}`, summary.rejected ? COLORS.red : COLORS.muted],
      ['Rej. qualidade', core.format(summary.qualityRejected), `taxa ${core.formatPercent(summary.qualityRejectionRate)}`, summary.qualityRejected ? COLORS.red : COLORS.muted],
      ['Registos', core.format(summary.records.length), `${core.format(summary.daysCovered)} de ${core.format(summary.days)} dias`, COLORS.ink],
    ];
  }

  /** Cabeçalho institucional; deixa `pdf.y` na primeira linha útil. */
  function letterhead(pdf, input, withLogo) {
    const top = PAGE.height - PAGE.margin;
    const height = withLogo ? 66 : 42;
    pdf.fillBox(PAGE.margin, top - height, CONTENT, height, COLORS.tint);
    pdf.fillBox(PAGE.margin, top - height, 4, height, COLORS.green);
    if (pdf.logoDef) {
      // logótipo oficial no canto superior esquerdo; a caixa mantém-se só como faixa
      const logoHeight = withLogo ? 46 : 22;
      const logoWidth = logoHeight * (pdf.logoDef.pixelWidth / pdf.logoDef.pixelHeight);
      pdf.image(PAGE.margin + 14, top - height / 2 - logoHeight / 2, logoWidth, logoHeight);
    } else {
      const x = PAGE.margin + 18;
      pdf.text('INATRO, IP', x, top - 26, 12.5, { bold: true, color: COLORS.dark });
      pdf.text('Instituto Nacional dos Transportes Rodoviários', x, top - 39, 8, { color: COLORS.muted });
      pdf.text('Registo de produção de cartas de condução', x, top - 50, 8, { color: COLORS.muted });
    }
    const right = PAGE.width - PAGE.margin - 18;
    const label = input.label || core.periodLabel(input.summary.start, input.summary.end);
    const brandSpace = measure('Instituto Nacional dos Transportes Rodoviários', 8, false) + 24;
    pdf.text(input.title || 'Relatório de produção', right, top - 24, 11, { bold: true, align: 'right', maxWidth: CONTENT * 0.45 });
    if (measure(label, 9.5, false) <= CONTENT - brandSpace) {
      pdf.text(label, right, top - 37, 9.5, { align: 'right', color: COLORS.dark });
      pdf.text(`Gerado em ${input.generated}`, right, top - 49, 8, { align: 'right', color: COLORS.muted, maxWidth: 240 });
      pdf.y = top - height - 26;
    } else {
      // etiqueta mais larga do que a coluna: sobe com o «Gerado em» e ganha linha inteira
      pdf.text(`Gerado em ${input.generated}`, right, top - 37, 8, { align: 'right', color: COLORS.muted, maxWidth: 240 });
      pdf.y = Math.min(top - height, top - 54) - 6;   // fica abaixo da terceira linha da marca
      pdf.text(label, PAGE.margin, pdf.y, 9, { color: COLORS.dark, maxWidth: CONTENT });
      pdf.y -= 22;
    }
    return pdf;
  }

  function keyFigures(pdf, input) {
    const cards = keyFigureCards(input);
    const gap = 8, width = (CONTENT - gap * (cards.length - 1)) / cards.length, height = 62;
    cards.forEach((card, index) => {
      const x = PAGE.margin + index * (width + gap);
      pdf.card(x, pdf.y - height, width, height, 6, COLORS.white, COLORS.line);
      pdf.text(card[0], x + 10, pdf.y - 17, 7, { bold: true, color: COLORS.muted, maxWidth: width - 20 });
      pdf.text(card[1], x + 10, pdf.y - 39, 17, { bold: true, color: card[3], maxWidth: width - 20 });
      pdf.text(card[2], x + 10, pdf.y - 52, 7.5, { color: COLORS.muted, maxWidth: width - 20 });
    });
    pdf.y -= height + 20;
  }

  /** Colunas do bloco «Por máquina»: produzidas, duas rejeições e taxa. */
  const MACHINE_CELLS = (machine) => [
    ['Produzidas', core.format(machine.produced), COLORS.ink],
    ['Aprovadas', core.format(machine.approved), COLORS.green],
    ['Rej. máquina', core.format(machine.rejected), machine.rejected ? COLORS.red : COLORS.muted],
    ['Rej. qualidade', core.format(machine.qualityRejected), machine.qualityRejected ? COLORS.amber : COLORS.muted],
    ['Aprovação', core.formatPercent(machine.approvalRate), COLORS.ink],
  ];
  const machineCellX = (cell) => PAGE.margin + 108 + cell * 79;

  function machineBlock(pdf, summary) {
    pdf.text('Por máquina', PAGE.margin, pdf.y - 6, 9.5, { bold: true, color: COLORS.dark });
    pdf.y -= 22;
    summary.machines.forEach((machine, index) => {
      const height = 32, y = pdf.y - height;
      pdf.text(core.MACHINES[index], PAGE.margin + 2, y + 15, 10, { bold: true, color: COLORS.ink });
      MACHINE_CELLS(machine).forEach(([label, value, color], cell) => {
        const x = machineCellX(cell);
        pdf.text(label, x, y + 19, 7, { color: COLORS.muted });
        pdf.text(value, x, y + 8, 10.5, { bold: true, color });
      });
      // barra no fundo da linha: verde aprova, vermelho rejeição da máquina, âmbar qualidade
      const produced = machine.produced || 1;
      const approvedShare = (machine.approved || 0) / produced;
      const rejectedShare = (machine.rejected || 0) / produced;
      const qualityShare = (machine.qualityRejected || 0) / produced;
      pdf.fillBox(PAGE.margin, y, CONTENT, 3, COLORS.line);
      pdf.fillBox(PAGE.margin, y, CONTENT * approvedShare, 3, COLORS.green);
      pdf.fillBox(PAGE.margin + CONTENT * approvedShare, y, CONTENT * rejectedShare, 3, COLORS.red);
      pdf.fillBox(PAGE.margin + CONTENT * (approvedShare + rejectedShare), y, CONTENT * qualityShare, 3, COLORS.amber);
      pdf.y = y - 12;
    });
    // linha de total, igual à pré-visualização no ecrã
    const totalY = pdf.y - 26;
    pdf.fillBox(PAGE.margin, totalY, CONTENT, 26, COLORS.tint);
    pdf.text('Total', PAGE.margin + 2, totalY + 9, 10, { bold: true, color: COLORS.dark });
    [
      ['produced', core.format(summary.produced)], ['approved', core.format(summary.approved)],
      ['rejected', core.format(summary.rejected)], ['qualityRejected', core.format(summary.qualityRejected)],
      ['rate', core.formatPercent(summary.approvalRate)],
    ].forEach(([key, value], cell) => {
      const color = (key === 'rejected' && summary.rejected) ? COLORS.red
        : (key === 'qualityRejected' && summary.qualityRejected) ? COLORS.amber : COLORS.dark;
      pdf.text(value, machineCellX(cell) + 66, totalY + 9, 10.5, { bold: true, align: 'right', color });
    });
    pdf.y = totalY - 16;
  }

  /** Caixa de aviso/nota com texto ajustado à largura. */
  function note(pdf, text, background, title) {
    const lines = [];
    String(text).split('\n').forEach((line) => lines.push(...wrap(line, 8.5, CONTENT - 26)));
    const height = lines.length * 11 + (title ? 14 : 0) + 16;
    if (pdf.y - height < BOTTOM) pdf.nextPage();
    pdf.card(PAGE.margin, pdf.y - height, CONTENT, height, 5, background, COLORS.line);
    let y = pdf.y - 16;
    if (title) { pdf.text(title, PAGE.margin + 13, y, 8.5, { bold: true, color: COLORS.dark }); y -= 13; }
    lines.forEach((line) => { pdf.text(line, PAGE.margin + 13, y, 8.5, { color: COLORS.ink, maxWidth: CONTENT - 26 }); y -= 11; });
    pdf.y -= height + 16;
  }

  /**
   * Barras do período. `seriesMetric: 'produced'` desenha três barras lado a
   * lado por ponto: aprovadas (verde), rejeitadas pela máquina (vermelho) e
   * rejeitadas no teste de qualidade (âmbar); 'rejected' / 'qualityRejected'
   * desenham só essa rejeição, em barras próprias.
   */
  function seriesBlock(pdf, input) {
    const metric = input.seriesMetric || 'produced';
    const metricValue = (point) => (metric === 'approved' ? point.approved
      : metric === 'rejected' ? point.rejected
      : metric === 'qualityRejected' ? (point.qualityRejected || 0)
      : point.produced);
    const grouped = metric === 'produced';
    const barValue = (point) => Math.max(point.approved || 0, point.rejected || 0, point.qualityRejected || 0);
    const points = (input.series || []).filter((point) => (grouped ? barValue(point) : metricValue(point)) > 0).slice(-18);
    if (!points.length) return;
    const needed = 18 + 82 + 26;               // título + barras + legenda/espaço
    if (pdf.y - needed < BOTTOM) pdf.nextPage();
    pdf.text(input.seriesTitle || 'Evolução', PAGE.margin, pdf.y - 6, 9.5, { bold: true, color: COLORS.dark });
    pdf.y -= 18;
    const area = 82, labelSpace = 24;             // barras + rótulos por cima
    const baseline = pdf.y - area;
    const peak = Math.max(1, ...points.map((point) => (grouped ? barValue(point) : metricValue(point))));
    const slot = CONTENT / points.length;
    const metricColor = metric === 'qualityRejected' ? COLORS.amber : metric === 'rejected' ? COLORS.red : COLORS.green;
    const trio = [['approved', COLORS.green], ['rejected', COLORS.red], ['qualityRejected', COLORS.amber]];
    const few = points.length <= 4;
    const barWidth = grouped ? (few ? Math.min(26, Math.max(10, (slot - 8) / 3.35)) : Math.min(11, Math.max(3, (slot - 6) / 3.35))) : Math.min(24, Math.max(7, slot - 10));
    const gap = grouped ? Math.max(1.5, barWidth * 0.22) : 0;
    const groupWidth = grouped ? trio.length * barWidth + (trio.length - 1) * gap : barWidth;
    const labelSize = few ? 6.5 : 5.5;
    const showValues = grouped ? (barWidth + gap) >= (few ? 21 : 15) : true;
    const labelEvery = Math.max(1, Math.ceil(points.length / 12));
    points.forEach((point, index) => {
      const xCenter = PAGE.margin + (index + 0.5) * slot;
      if (grouped) {
        const x0 = xCenter - groupWidth / 2;
        trio.forEach(([key, color], barIndex) => {
          const value = point[key] || 0;
          if (!value) return;
          const height = (value / peak) * (area - labelSpace);
          const x = x0 + barIndex * (barWidth + gap);
          pdf.fillBox(x, baseline, barWidth, height, color);
          if (showValues) pdf.text(core.format(value), x + barWidth / 2, baseline + height + 6, labelSize, { align: 'center', bold: true, color: COLORS.ink });
        });
      } else {
        const amount = metricValue(point);
        const height = (amount / peak) * (area - labelSpace);
        pdf.fillBox(xCenter - barWidth / 2, baseline, barWidth, height, metricColor);
        pdf.text(core.format(amount), xCenter, baseline + height + 6, 7.5, { align: 'center', bold: true, color: COLORS.ink });
      }
      if (index % labelEvery === 0) pdf.text(point.label, xCenter, baseline - 11, 7.5, { align: 'center', color: COLORS.muted });
    });
    pdf.rule(PAGE.margin, baseline, PAGE.margin + CONTENT, baseline, COLORS.dark, 0.8);
    if (grouped) {
      const legendY = baseline + area + 4;
      pdf.fillBox(PAGE.margin, legendY, 8, 3, COLORS.green);
      pdf.text('Aprovadas', PAGE.margin + 12, legendY - 1, 7, { color: COLORS.muted });
      pdf.fillBox(PAGE.margin + 72, legendY, 8, 3, COLORS.red);
      pdf.text('Rej. máquina', PAGE.margin + 84, legendY - 1, 7, { color: COLORS.muted });
      pdf.fillBox(PAGE.margin + 164, legendY, 8, 3, COLORS.amber);
      pdf.text('Rej. qualidade', PAGE.margin + 176, legendY - 1, 7, { color: COLORS.muted });
    }
    pdf.y = baseline - 26;
  }

  function tableColumns(pdf, columns = COLUMNS) {
    pdf.fillBox(PAGE.margin, pdf.y - 22, CONTENT, 22, COLORS.dark);
    columns.forEach((column) => {
      const right = column.align === 'right';
      pdf.text(column.title, right ? PAGE.margin + column.x + column.width - 6 : PAGE.margin + column.x + 6,
        pdf.y - 15, 8, { bold: true, color: COLORS.white, align: right ? 'right' : 'left', maxWidth: column.width - 12 });
    });
    pdf.y -= 22;
  }

  function recordTable(pdf, input) {
    const summary = input.summary;
    pdf.text('Registos somados', PAGE.margin, pdf.y - 6, 9.5, { bold: true, color: COLORS.dark });
    pdf.y -= 16;
    tableColumns(pdf, COLUMNS);
    if (!summary.records.length) {
      pdf.text('Sem registos neste período.', PAGE.margin + 8, pdf.y - 15, 9, { color: COLORS.muted });
      pdf.y -= 30;
      return;
    }
    const row = (values, colors = {}) => {
      COLUMNS.forEach((column) => {
        const right = column.align === 'right';
        pdf.text(values[column.key], right ? PAGE.margin + column.x + column.width - 6 : PAGE.margin + column.x + 6,
          pdf.y - 15, 9, { align: right ? 'right' : 'left', maxWidth: column.width - 12, color: colors[column.key] || COLORS.ink });
      });
    };
    summary.records.forEach((record) => {
      if (pdf.y - 30 < BOTTOM) { pdf.nextPage(); tableColumns(pdf, COLUMNS); }
      const totals = core.totals(record);
      row({
        period: core.periodLabel(record.start, record.end),
        produced: core.format(totals.produced), approved: core.format(totals.approved),
        rejected: core.format(totals.rejected), qualityRejected: core.format(totals.qualityRejected),
        rate: core.formatPercent(totals.approvalRate),
      }, { ...(totals.rejected ? { rejected: COLORS.red } : {}), ...(totals.qualityRejected ? { qualityRejected: COLORS.amber } : {}) });
      pdf.rule(PAGE.margin, pdf.y - 24, PAGE.margin + CONTENT, pdf.y - 24);
      pdf.y -= 26;
    });
    pdf.fillBox(PAGE.margin, pdf.y - 26, CONTENT, 26, COLORS.tint);
    COLUMNS.forEach((column) => {
      const right = column.align === 'right';
      const value = column.key === 'period' ? 'Total do período'
        : column.key === 'rate' ? core.formatPercent(summary.approvalRate) : core.format(summary[column.key]);
      pdf.text(value, right ? PAGE.margin + column.x + column.width - 10 : PAGE.margin + column.x + 8, pdf.y - 17, 9,
        { bold: true, align: right ? 'right' : 'left', color: COLORS.dark, maxWidth: column.width - 12 });
    });
    pdf.y -= 36;
  }

  /** Faixa de indicadores do armazém: cabe em cinco cartões, mas sem a mesma altura da produção. */
  function stockFigures(pdf, input) {
    keyFigures(pdf, input);
  }

  /** Uma tabela genérica: cabeçalho, linhas com quebra de página e a nota do fim. */
  function genericTable(pdf, { columns, title, rows, noteText, totalRow, emptyText, mark }) {
    pdf.text(title, PAGE.margin, pdf.y - 6, 9.5, { bold: true, color: COLORS.dark });
    pdf.y -= 16;
    tableColumns(pdf, columns);
    const at = (column) => (column.align === 'right' ? PAGE.margin + column.x + column.width - 6 : PAGE.margin + column.x + 6);
    const line = (values, options = {}) => {
      if (pdf.y - 24 < BOTTOM) { pdf.nextPage(); tableColumns(pdf, columns); }
      if (options.tint) pdf.fillBox(PAGE.margin, pdf.y - 24, CONTENT, 24, COLORS.tint);
      columns.forEach((column, index) => {
        const value = values[column.key] === undefined ? '' : String(values[column.key]);
        pdf.text(value, at(column), pdf.y - 15, 8.5, {
          align: column.align === 'right' ? 'right' : 'left',
          bold: Boolean(options.bold) || index === 0,
          color: (options.colors && options.colors[column.key]) || (options.bold ? COLORS.dark : COLORS.ink),
          maxWidth: column.width - 10,
        });
      });
      pdf.rule(PAGE.margin, pdf.y - 24, PAGE.margin + CONTENT, pdf.y - 24);
      pdf.y -= 24;
    };
    if (!rows.length) {
      pdf.text(emptyText || 'Sem dados no período.', PAGE.margin + 8, pdf.y - 14, 9, { color: COLORS.muted });
      pdf.y -= 28;
    } else {
      rows.forEach((values) => line(values, { colors: mark ? mark(values) : {} }));
      if (totalRow) line(totalRow, { tint: true, bold: true });
    }
    if (noteText) {
      pdf.y -= 6;
      note(pdf, noteText, COLORS.white, null);
    }
  }

  /** Cartas chumbadas por motivo, com as duas máquinas e o total. */
  function reasonTable(pdf, input) {
    const reasons = (input.reasons || []).filter((reason) => reason.total).slice().sort((a, b) => b.total - a.total);
    genericTable(pdf, {
      columns: REASON_COLUMNS, title: 'Cartas chumbadas por motivo', rows: reasons,
      emptyText: 'Nenhuma carta chumbada no período.',
      totalRow: {
        group: '', label: 'Total',
        m1: core.format(reasons.reduce((sum, reason) => sum + reason.m1, 0)),
        m2: core.format(reasons.reduce((sum, reason) => sum + reason.m2, 0)),
        total: core.format(reasons.reduce((sum, reason) => sum + reason.total, 0)),
      },
    });
  }

  /** Lotes do período com a data de cada fase; o que falta despachar fica escrito por baixo. */
  function lotTable(pdf, input) {
    const lots = (input.lots || []).slice().sort((a, b) => (a.start > b.start ? -1 : 1));
    const board = input.lotBoard || { toDispatch: 0, dispatched: 0, cards: 0 };
    const toDispatch = board.toDispatch;
    genericTable(pdf, {
      columns: LOT_COLUMNS, title: 'Lotes no período', rows: lots,
      emptyText: 'Nenhum lote aberto neste período.',
      mark: (lot) => ({ reference: lot.closed ? COLORS.muted : COLORS.ink, despacho: lot.closed ? COLORS.green : COLORS.amber }),
      noteText: toDispatch
        ? `${core.format(toDispatch)} ${toDispatch === 1 ? 'lote falta' : 'lotes faltam'} despachar.`
        : 'Todos os lotes do período foram despachados.',
    });
    // o quadro de fases resume onde está o trabalho
    if (!lots.length) return;
    pdf.text('Onde está o trabalho', PAGE.margin, pdf.y - 6, 9.5, { bold: true, color: COLORS.dark });
    pdf.y -= 16;
    core.LOT_STAGES.forEach((stage) => {
      const row = (input.lotBoardRows || []).find((entry) => entry.stage === stage) || {};
      const done = row.done || 0, open = row.open || 0, total = done + open || 1;
      if (pdf.y - 22 < BOTTOM) pdf.nextPage();
      pdf.text(core.LOT_STAGE_LABELS[stage], PAGE.margin + 2, pdf.y - 12, 9, { bold: true, color: COLORS.ink });
      pdf.text(`${core.format(done)} feito${done === 1 ? '' : 's'} · ${core.format(open)} por fazer`, PAGE.margin + 108, pdf.y - 12, 8.5, { color: COLORS.muted });
      const barX = PAGE.margin + 268, barW = CONTENT - 268;
      pdf.fillBox(barX, pdf.y - 14, barW, 6, COLORS.line);
      pdf.fillBox(barX, pdf.y - 14, barW * (done / total), 6, COLORS.green);
      pdf.y -= 22;
    });
    pdf.y -= 6;
  }

  /** Material em armazém: uma linha por artigo, os que estão no mínimo em vermelho. */
  function stockTable(pdf, input) {
    const items = (input.stock.items || []).slice().sort((a, b) => (b.low - a.low) || (a.name < b.name ? -1 : 1));
    const low = input.stock.low || [];
    genericTable(pdf, {
      columns: STOCK_COLUMNS, title: 'Material em armazém',
      rows: items.map((item) => ({
        name: item.name,
        kind: core.STOCK_KIND_LABELS[item.kind] || core.STOCK_KIND_LABELS.outro,
        contracted: item.contracted ? core.format(item.contracted) : '—',
        pending: item.pending ? core.format(item.pending) : '—',
        received: core.format(item.received), issued: core.format(item.issued),
        balance: `${core.format(item.balance)} ${item.unit}`,
        minimum: item.minimum ? core.format(item.minimum) : '—',
        delivered: item.delivered ? core.shortDate(item.delivered) : '—',
        updated: item.updated ? core.shortDate(item.updated) : '—',
      })),
      emptyText: 'Ainda sem material no armazém.',
      mark: (row) => (low.some((item) => item.name === row.name) ? { balance: COLORS.red, name: COLORS.red }
        : (row.pending && row.pending !== '—' ? { pending: COLORS.amber } : {})),
      noteText: low.length
        ? `${core.format(low.length)} ${low.length === 1 ? 'material está' : 'materiais estão'} no mínimo ou abaixo dele: ${low.slice(0, 4).map((item) => item.name).join(', ')}${low.length > 4 ? '…' : ''}.`
        : 'Todo o material está acima do mínimo definido.',
    });
  }

  /** O sinal do core, com o traço do papel quando não há valor. */
  const signed = (value, suffix) => (value === null || value === undefined ? '—' : core.signed(value, suffix));

  /**
   * Comparação lado a lado: o 1.º e o 2.º período um ao lado do outro,
   * com a diferença (2.º − 1.º) — verde quando o movimento é bom, vermelho quando não é.
   */
  function comparisonTable(pdf, comparison, title) {
    const [a, b] = comparison.rows;
    const tags = core.compareTags(comparison);
    const at = (column) => (column.align === 'right' ? PAGE.margin + column.x + column.width - 6 : PAGE.margin + column.x + 6);
    const row = (label, first, second, diff, diffColor) => {
      if (pdf.y - 26 < BOTTOM) { pdf.nextPage(); tableColumns(pdf, SIDE_COLUMNS); }
      pdf.text(label, at(SIDE_COLUMNS[0]), pdf.y - 15, 9, { color: COLORS.ink });
      pdf.text(String(first), at(SIDE_COLUMNS[1]), pdf.y - 15, 9, { align: 'right', color: COLORS.ink });
      pdf.text(String(second), at(SIDE_COLUMNS[2]), pdf.y - 15, 9, { align: 'right', color: COLORS.ink });
      pdf.text(String(diff), at(SIDE_COLUMNS[3]), pdf.y - 15, 9, { align: 'right', bold: true, color: diffColor });
      pdf.rule(PAGE.margin, pdf.y - 23, PAGE.margin + CONTENT, pdf.y - 23);
      pdf.y -= 24;
    };
    pdf.text(title, PAGE.margin, pdf.y - 6, 9.5, { bold: true, color: COLORS.dark });
    pdf.y -= 8;
    tableColumns(pdf, [
      SIDE_COLUMNS[0],
      { ...SIDE_COLUMNS[1], title: a.label },
      { ...SIDE_COLUMNS[2], title: b.label },
      SIDE_COLUMNS[3],
    ]);
    // as dez linhas vêm do core, as mesmas que o papel do ecrã desenha
    core.comparisonRows(comparison).forEach((line) => {
      const flat = line.diff.startsWith('±0');
      row(line.label, line.first, line.second, line.diff, flat ? COLORS.muted : line.good ? COLORS.green : COLORS.red);
    });
    pdf.y -= 8;
    const reading = core.compareReading(comparison);
    if (reading) note(pdf, reading, COLORS.white, 'Leitura da comparação');
  }

  /** Máquina a máquina nos dois lados: duas linhas por período, com os totais. */
  function machineCompareBlock(pdf, comparison) {
    const [a, b] = comparison.rows;
    const tags = core.compareTags(comparison);
    pdf.text(`Por máquina — ${tags[0]} × ${tags[1]}`, PAGE.margin, pdf.y - 6, 9.5, { bold: true, color: COLORS.dark });
    pdf.y -= 14;
    tableColumns(pdf, SIDE_MACHINE_COLUMNS);
    const at = (column) => (column.align === 'right' ? PAGE.margin + column.x + column.width - 6 : PAGE.margin + column.x + 6);
    const line = (values, tint) => {
      if (pdf.y - 26 < BOTTOM) { pdf.nextPage(); tableColumns(pdf, SIDE_MACHINE_COLUMNS); }
      if (tint) pdf.fillBox(PAGE.margin, pdf.y - 26, CONTENT, 26, COLORS.tint);
      SIDE_MACHINE_COLUMNS.forEach((column, index) => {
        pdf.text(String(values[index]), at(column), pdf.y - 16, 8.5, {
          align: column.align === 'right' ? 'right' : 'left',
          bold: tint === true || index === 1,
          color: tint === true ? COLORS.dark : index >= 2 && index <= 3 ? COLORS.ink : index === 4 && values[4] !== '0' ? COLORS.red : index === 5 && values[5] !== '0' ? COLORS.amber : COLORS.ink,
          maxWidth: column.width - 10,
        });
      });
      pdf.y -= 26;
    };
    [a, b].forEach((period, index) => {
      period.machines.forEach((machine, machineIndex) => {
        line([tags[index], core.MACHINES[machineIndex], core.format(machine.produced), core.format(machine.approved),
          core.format(machine.rejected), core.format(machine.qualityRejected), core.formatPercent(machine.approvalRate)], false);
      });
      line([tags[index], 'Total', core.format(period.produced), core.format(period.approved),
        core.format(period.rejected), core.format(period.qualityRejected), core.formatPercent(period.approvalRate)], true);
    });
    pdf.y -= 8;
  }

  return {
    PAGE, COLORS, COLUMNS, SIDE_COLUMNS, SIDE_MACHINE_COLUMNS, BOTTOM, CONTENT, tone,
    REASON_COLUMNS, LOT_COLUMNS, STOCK_COLUMNS,
    setMeasurer, measure: (text, size, bold) => measure(text, size, bold),
    encodeText, wrap, fit, build, comparisonTable, machineCompareBlock, signed, PdfWriter, roundedPath, latin1, rgb,
    reasonTable, lotTable, stockTable, meta,
  };
});
