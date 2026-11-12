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
    logo: { green: tone('#4cb050'), grey: tone('#808080'), dark: tone('#4a4a4a') },
  };
  const CONTENT = PAGE.width - PAGE.margin * 2;

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

  function fit(text, size, maxWidth, bold) {
    const value = String(text ?? '');
    if (!maxWidth || measure(value, size, bold) <= maxWidth) return value;
    let cut = value;
    while (cut.length > 1 && measure(cut + '…', size, bold) > maxWidth) cut = cut.slice(0, -1);
    return cut.replace(/[\s,;-]+$/, '') + '…';
  }

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
  }).map(([char, byte]) => [char.charCodeAt(0), byte]));

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

  const moveTo = (x, y) => `${round(x)} ${round(y)} m`;
  const lineTo = (x, y) => `${round(x)} ${round(y)} l`;

  /**
   * Arco em curvas de Bézier: o PDF não tem operador de arco. Com `radiusY`
   * diferente, desenha uma elipse — é o que o anel do logótipo precisa.
   */
  function arcPath(cx, cy, radius, from, to, radiusY) {
    const degrees = Math.PI / 180;
    const ry = radiusY === undefined ? radius : radiusY;
    const parts = Math.max(1, Math.ceil(Math.abs(to - from) / 90));
    const step = (to - from) / parts;
    const handle = ((radius * 4) / 3) * Math.tan((step * degrees) / 4);
    const handleY = ((ry * 4) / 3) * Math.tan((step * degrees) / 4);
    const at = (angle) => [cx + radius * Math.cos(angle * degrees), cy + ry * Math.sin(angle * degrees)];
    const sideways = (angle) => [-handle * Math.sin(angle * degrees), handleY * Math.cos(angle * degrees)];
    const ops = [];
    const [startX, startY] = at(from);
    ops.push(moveTo(startX, startY));
    for (let part = 1; part <= parts; part += 1) {
      const begin = at(from + (part - 1) * step);
      const end = at(from + part * step);
      const beginTilt = sideways(from + (part - 1) * step);
      const endTilt = sideways(from + part * step);
      ops.push(`${round(begin[0] + beginTilt[0])} ${round(begin[1] + beginTilt[1])} `
        + `${round(end[0] - endTilt[0])} ${round(end[1] - endTilt[1])} ${round(end[0])} ${round(end[1])} c`);
    }
    return ops;
  }

  // geometria do logótipo, na grelha 100 × 61.2 (y a crescer para cima).
  // os números são as medidas do símbolo da instituição, na mesma grelha do SVG
  const MARK = {
    height: 61.2,                       // grelha 100 × 61,2 — a proporção do SVG
    ring: { cx: 50.17, cy: 17.39, outX: 31.1, outY: 43.81, inX: 20.4, inY: 33.11 },
    ticks: [
      [35.82, 24.59, 32.62, 26.72, 34.74, 29.92, 37.95, 27.8, '#4cb050'],
      [35.07, 30.22, 32.4, 32.99, 35.16, 35.66, 37.84, 32.9, '#63bb57'],
      [36.1, 34.79, 33.95, 37.98, 37.14, 40.13, 39.29, 36.94, '#7dc44f'],
      [38.34, 38.76, 36.75, 42.26, 40.25, 43.85, 41.84, 40.35, '#94cd28'],
      [41.77, 41.8, 40.8, 45.52, 44.52, 46.5, 45.49, 42.78, '#a8d637'],
      [45.92, 43.23, 45.57, 47.06, 49.4, 47.41, 49.75, 43.57, '#bcdf4b'],
      [50.9, 43.6, 51.29, 47.43, 55.12, 47.04, 54.73, 43.21, '#f6d542'],
      [55.16, 42.8, 56.18, 46.51, 59.89, 45.49, 58.87, 41.78, '#f7cd3a'],
      [58.97, 40.23, 60.63, 43.7, 64.1, 42.04, 62.44, 38.57, '#f8c33a'],
      [61.53, 36.83, 63.75, 39.97, 66.89, 37.75, 64.68, 34.61, '#ef6a3a'],
      [62.83, 32.78, 65.55, 35.5, 68.27, 32.78, 65.55, 30.06, '#ea453c'],
      [62.9, 27.69, 66.15, 29.74, 68.2, 26.49, 64.95, 24.44, '#e5262f'],
    ],
    road: [
      [40.47, 25.75, 44.82, 25.75, 18.06, 0.0, 0.0, 0.0], [100.0, 0.0, 81.94, 0.0, 55.18, 25.75, 59.53, 25.75],
    ],
    dashes: [
      [48.83, 25.75, 51.51, 25.75, 51.84, 23.08, 48.49, 23.08],
      [48.33, 19.73, 52.01, 19.73, 53.18, 14.38, 47.16, 14.38],
      [45.65, 9.03, 54.68, 9.03, 57.19, 0.0, 43.14, 0.0],
    ],
    needle: [51.41, 28.91, 46.53, 38.94, 45.78, 38.65, 48.92, 27.95],
    hub: { x: 50.17, y: 28.43, r: 1.81 },
    grey: '#808080', dark: '#4a4a4a',
  };

  /**
   * Marca do Conta Carta: o velocímetro do INATRO com a estrada a correr para o
   * horizonte. Desenhada com os mesmos números do SVG, para que a folha de
   * estilo, a pré-visualização e o PDF mostrem sempre o mesmo símbolo.
   * `width` é a largura em pontos; a altura segue a proporção do desenho.
   */
  function contaCartaMark(pdf, x, y, width) {
    const u = width / 100;
    const px = (value) => x + value * u;
    const py = (value) => y + value * u;
    const quad = (numbers) => [
      moveTo(px(numbers[0]), py(numbers[1])), lineTo(px(numbers[2]), py(numbers[3])),
      lineTo(px(numbers[4]), py(numbers[5])), lineTo(px(numbers[6]), py(numbers[7])), 'h',
    ];
    pdf.ops.push('q');                          // espessura e cor são só desta marca
    const ring = MARK.ring;
    const outer = arcPath(px(ring.cx), py(ring.cy), ring.outX * u, 0, 180, ring.outY * u);
    const inner = arcPath(px(ring.cx), py(ring.cy), ring.inX * u, 180, 0, ring.inY * u);
    pdf.path([...outer, ...inner.slice(1), 'h'], { fill: COLORS.logo.green });
    for (const tick of MARK.ticks) pdf.path(quad(tick.slice(0, 8)), { fill: tone(tick[8]) });
    for (const shape of [...MARK.road, ...MARK.dashes]) pdf.path(quad(shape), { fill: COLORS.logo.grey });
    pdf.path(quad(MARK.needle), { fill: COLORS.logo.dark });
    pdf.path(arcPath(px(MARK.hub.x), py(MARK.hub.y), MARK.hub.r * u, 0, 360), { fill: COLORS.logo.dark });
    pdf.ops.push('Q');
    return width * (MARK.height / 100);
  }

  class PdfWriter {
    constructor() {
      this.store = new Map();
      this.next = 1;
      this.catalog = this.alloc();
      this.pagesRoot = this.alloc();
      this.fontRegular = this.alloc();
      this.fontBold = this.alloc();
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
      this.pages.forEach((page, index) => {
        page.ops.push(...footerOps(index + 1, total, this.footerNote));
        const contentId = this.alloc();
        const pageId = this.alloc();
        page.id = pageId;
        this.put(contentId, '<< /Length * >>', page.ops.join('\n'));
        this.put(pageId, `<< /Type /Page /Parent ${this.pagesRoot} 0 R `
          + `/MediaBox [0 0 ${round(PAGE.width)} ${round(PAGE.height)}] `
          + `/Resources << /Font << /F1 ${this.fontRegular} 0 R /F2 ${this.fontBold} 0 R >>`
          + ` >> /Contents ${contentId} 0 R >>`);
      });

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
    { key: 'period', title: 'Período', x: 0, width: 176, align: 'left' },
    { key: 'produced', title: 'Produzidas', x: 182, width: 78, align: 'right' },
    { key: 'approved', title: 'Aprovadas', x: 266, width: 78, align: 'right' },
    { key: 'rejected', title: 'Rejeitadas', x: 350, width: 78, align: 'right' },
    { key: 'rate', title: 'Aprovação', x: 434, width: CONTENT - 434, align: 'right' },
  ];

  /** Colunas da comparação: os mesmos números por período, mais a variação. */
  const COMPARE_COLUMNS = [
    { key: 'period', title: 'Período', x: 0, width: 116, align: 'left' },
    { key: 'records', title: 'Registos', x: 120, width: 52, align: 'right' },
    { key: 'produced', title: 'Produzidas', x: 176, width: 66, align: 'right' },
    { key: 'approved', title: 'Aprovadas', x: 246, width: 66, align: 'right' },
    { key: 'rejected', title: 'Rejeitadas', x: 316, width: 62, align: 'right' },
    { key: 'rate', title: 'Aprovação', x: 382, width: 58, align: 'right' },
    { key: 'delta', title: 'Variação', x: 444, width: CONTENT - 444, align: 'right' },
  ];

  /**
   * Monta o PDF do relatório.
   * `input` = { summary, label, generated, scope, series, notes, comparison, comparisonTitle }
   */
  function build(input) {
    const pdf = new PdfWriter();
    pdf.footerNote = 'Conta Carta · INATRO, IP — registo de produção de cartas de condução';
    pdf.header = (target, withLogo) => letterhead(target, input, withLogo);
    pdf.newPage();
    pdf.header(pdf, true);

    keyFigures(pdf, input.summary);
    machineBlock(pdf, input.summary);
    if (input.comparison) comparisonTable(pdf, input.comparison, input.comparisonTitle || 'Comparação');
    if (input.scope) note(pdf, input.scope, COLORS.tint, null);
    if (input.notes && input.notes.length) note(pdf, input.notes.join('\n'), COLORS.white, 'Notas dos registos');
    seriesBlock(pdf, input);
    recordTable(pdf, input);
    return pdf.finish();
  }

  /** Cabeçalho institucional; deixa `pdf.y` na primeira linha útil. */
  function letterhead(pdf, input, withLogo) {
    const top = PAGE.height - PAGE.margin;
    const height = withLogo ? 66 : 42;
    pdf.fillBox(PAGE.margin, top - height, CONTENT, height, COLORS.tint);
    pdf.fillBox(PAGE.margin, top - height, 4, height, COLORS.green);
    const left = PAGE.margin + 18;
    let x = left;
    if (withLogo) {
      const markWidth = 58;
      contaCartaMark(pdf, left, top - height + (height - markWidth * 0.612) / 2 - 2, markWidth);
      x = left + markWidth + 14;
    }
    pdf.text('INATRO, IP', x, top - 26, 12.5, { bold: true, color: COLORS.dark });
    pdf.text('Instituto Nacional dos Transportes Rodoviários', x, top - 39, 8, { color: COLORS.muted });
    pdf.text('Registo de produção de cartas de condução', x, top - 50, 8, { color: COLORS.muted });
    const right = PAGE.width - PAGE.margin - 18;
    pdf.text('Relatório de produção', right, top - 24, 11, { bold: true, align: 'right' });
    pdf.text(input.label || core.periodLabel(input.summary.start, input.summary.end), right, top - 37, 9.5, { align: 'right', color: COLORS.dark });
    pdf.text(`Gerado em ${input.generated}`, right, top - 49, 8, { align: 'right', color: COLORS.muted, maxWidth: 240 });
    pdf.y = top - height - 26;
    return pdf;
  }

  function keyFigures(pdf, summary) {
    const cards = [
      ['Produzidas', core.format(summary.produced), 'cartas no período', COLORS.dark],
      ['Aprovadas', core.format(summary.approved), `taxa ${core.formatPercent(summary.approvalRate)}`, COLORS.green],
      ['Rejeitadas', core.format(summary.rejected), `taxa ${core.formatPercent(summary.rejectionRate)}`, COLORS.red],
      ['Registos', core.format(summary.records.length), `${core.format(summary.daysCovered)} de ${core.format(summary.days)} dias`, COLORS.ink],
    ];
    const gap = 9, width = (CONTENT - gap * 3) / 4, height = 62;
    cards.forEach((card, index) => {
      const x = PAGE.margin + index * (width + gap);
      pdf.card(x, pdf.y - height, width, height, 6, COLORS.white, COLORS.line);
      pdf.text(card[0], x + 12, pdf.y - 18, 7.5, { bold: true, color: COLORS.muted });
      pdf.text(card[1], x + 12, pdf.y - 40, 18, { bold: true, color: card[3] });
      pdf.text(card[2], x + 12, pdf.y - 53, 7.5, { color: COLORS.muted, maxWidth: width - 24 });
    });
    pdf.y -= height + 20;
  }

  function machineBlock(pdf, summary) {
    pdf.text('Por máquina', PAGE.margin, pdf.y - 6, 9.5, { bold: true, color: COLORS.dark });
    pdf.y -= 22;
    summary.machines.forEach((machine, index) => {
      const height = 32, y = pdf.y - height;
      pdf.text(core.MACHINES[index], PAGE.margin + 2, y + 15, 10, { bold: true, color: COLORS.ink });
      [
        ['Produzidas', core.format(machine.produced), COLORS.ink],
        ['Aprovadas', core.format(machine.approved), COLORS.green],
        ['Rejeitadas', core.format(machine.rejected), machine.rejected ? COLORS.red : COLORS.muted],
        ['Aprovação', core.formatPercent(machine.approvalRate), COLORS.ink],
      ].forEach(([label, value, color], cell) => {
        const x = PAGE.margin + 128 + cell * 80;
        pdf.text(label, x, y + 19, 7, { color: COLORS.muted });
        pdf.text(value, x, y + 8, 10.5, { bold: true, color });
      });
      // barra de qualidade no fundo da linha: verde aprova, vermelho rejeita
      const rate = (machine.approvalRate || 0) / 100;
      pdf.fillBox(PAGE.margin, y, CONTENT, 3, COLORS.red);
      pdf.fillBox(PAGE.margin, y, CONTENT * rate, 3, COLORS.green);
      pdf.y = y - 12;
    });
    // linha de total, igual à pré-visualização no ecrã
    const totalY = pdf.y - 26;
    pdf.fillBox(PAGE.margin, totalY, CONTENT, 26, COLORS.tint);
    pdf.text('Total', PAGE.margin + 2, totalY + 9, 10, { bold: true, color: COLORS.dark });
    [
      ['produced', core.format(summary.produced)], ['approved', core.format(summary.approved)],
      ['rejected', core.format(summary.rejected)], ['rate', core.formatPercent(summary.approvalRate)],
    ].forEach(([key, value], cell) => {
      pdf.text(value, PAGE.margin + 130 + cell * 92 + 86, totalY + 9, 10.5, { bold: true, align: 'right', color: key === 'rejected' && summary.rejected ? COLORS.red : COLORS.dark });
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

  /** Barras de produção (verde) com a fatia rejeitada em vermelho. */
  function seriesBlock(pdf, input) {
    const points = (input.series || []).filter((point) => point.produced > 0).slice(-18);
    if (!points.length) return;
    pdf.text('Evolução', PAGE.margin, pdf.y - 6, 9.5, { bold: true, color: COLORS.dark });
    pdf.y -= 18;
    const area = 82, labelSpace = 24;             // barras + rótulos por cima
    const baseline = pdf.y - area;
    const peak = Math.max(1, ...points.map((point) => point.produced));
    const slot = CONTENT / points.length;
    const barWidth = Math.min(24, Math.max(7, slot - 10));
    points.forEach((point, index) => {
      const x = PAGE.margin + (index + 0.5) * slot;
      const produced = (point.produced / peak) * (area - labelSpace);
      const rejected = (point.rejected / peak) * (area - labelSpace);
      pdf.fillBox(x - barWidth / 2, baseline, barWidth, produced, COLORS.green);
      if (rejected > 0.4) pdf.fillBox(x - barWidth / 2, baseline, barWidth, Math.min(rejected, produced), COLORS.red);
      pdf.text(core.format(point.produced), x, baseline + produced + 6, 7.5, { align: 'center', bold: true, color: COLORS.ink });
      pdf.text(point.label, x, baseline - 11, 7.5, { align: 'center', color: COLORS.muted });
    });
    pdf.rule(PAGE.margin, baseline, PAGE.margin + CONTENT, baseline, COLORS.dark, 0.8);
    pdf.y = baseline - 26;
  }

  function tableColumns(pdf, columns = COLUMNS) {
    pdf.fillBox(PAGE.margin, pdf.y - 22, CONTENT, 22, COLORS.dark);
    columns.forEach((column) => {
      const right = column.align === 'right';
      pdf.text(column.title, right ? PAGE.margin + column.x + column.width - 10 : PAGE.margin + column.x + 8,
        pdf.y - 15, 8, { bold: true, color: COLORS.white, align: right ? 'right' : 'left', maxWidth: column.width - 18 });
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
        pdf.text(values[column.key], right ? PAGE.margin + column.x + column.width - 10 : PAGE.margin + column.x + 8,
          pdf.y - 15, 9, { align: right ? 'right' : 'left', maxWidth: column.width - 18, color: colors[column.key] || COLORS.ink });
      });
    };
    summary.records.forEach((record) => {
      if (pdf.y - 30 < BOTTOM) { pdf.nextPage(); tableColumns(pdf, COLUMNS); }
      const totals = core.totals(record);
      row({
        period: core.periodLabel(record.start, record.end),
        produced: core.format(totals.produced), approved: core.format(totals.approved),
        rejected: core.format(totals.rejected), rate: core.formatPercent(totals.approvalRate),
      }, totals.rejected ? { rejected: COLORS.red } : {});
      pdf.rule(PAGE.margin, pdf.y - 24, PAGE.margin + CONTENT, pdf.y - 24);
      pdf.y -= 26;
    });
    pdf.fillBox(PAGE.margin, pdf.y - 26, CONTENT, 26, COLORS.tint);
    COLUMNS.forEach((column) => {
      const right = column.align === 'right';
      const value = column.key === 'period' ? 'Total do período'
        : column.key === 'rate' ? core.formatPercent(summary.approvalRate) : core.format(summary[column.key]);
      pdf.text(value, right ? PAGE.margin + column.x + column.width - 10 : PAGE.margin + column.x + 8, pdf.y - 17, 9,
        { bold: true, align: right ? 'right' : 'left', color: COLORS.dark, maxWidth: column.width - 18 });
    });
    pdf.y -= 36;
  }

  const signed = (value, suffix) => (value === null || value === undefined
    ? '—'
    : `${value > 0 ? '+' : value < 0 ? '-' : '±'}${core.format(Math.abs(value))}${suffix || ''}`);

  /** Comparação período a período: uma linha por período e a variação face ao anterior. */
  function comparisonTable(pdf, comparison, title) {
    pdf.text(title, PAGE.margin, pdf.y - 6, 9.5, { bold: true, color: COLORS.dark });
    pdf.y -= 16;
    tableColumns(pdf, COMPARE_COLUMNS);
    const at = (column, offset) => (column.align === 'right'
      ? PAGE.margin + column.x + column.width - 10
      : PAGE.margin + column.x + offset);
    comparison.rows.forEach((item) => {
      if (pdf.y - 30 < BOTTOM) { pdf.nextPage(); tableColumns(pdf, COMPARE_COLUMNS); }
      const best = comparison.best && item.key === comparison.best.key;
      const worst = comparison.worst && item.key === comparison.worst.key;
      const values = {
        period: item.label,
        records: core.format(item.records),
        produced: core.format(item.produced),
        approved: core.format(item.approved),
        rejected: core.format(item.rejected),
        rate: core.formatPercent(item.approvalRate),
        delta: item.delta ? `${signed(item.delta.produced)} · ${signed(item.delta.rate, ' p.')}` : '—',
      };
      COMPARE_COLUMNS.forEach((column) => {
        const color = column.key === 'rejected' && item.rejected ? COLORS.red
          : column.key === 'delta' && item.delta && item.delta.produced
            ? (item.delta.produced > 0 ? COLORS.green : COLORS.red)
            : column.key === 'rate' && (best || worst) ? (best ? COLORS.green : COLORS.red) : COLORS.ink;
        pdf.text(values[column.key], at(column, 8), pdf.y - 15, 9, {
          align: column.align === 'right' ? 'right' : 'left',
          maxWidth: column.width - 18,
          bold: best || worst,
          color,
        });
      });
      pdf.rule(PAGE.margin, pdf.y - 24, PAGE.margin + CONTENT, pdf.y - 24);
      pdf.y -= 26;
    });
    const total = comparison.total;
    pdf.fillBox(PAGE.margin, pdf.y - 26, CONTENT, 26, COLORS.tint);
    const values = {
      period: 'Total comparado', records: core.format(total.records), produced: core.format(total.produced),
      approved: core.format(total.approved), rejected: core.format(total.rejected),
      rate: core.formatPercent(total.approvalRate),
      delta: `${comparison.periods} ${comparison.periods === 1 ? 'período' : 'períodos'}`,
    };
    COMPARE_COLUMNS.forEach((column) => {
      pdf.text(values[column.key], at(column, 8), pdf.y - 17, 9,
        { bold: true, align: column.align === 'right' ? 'right' : 'left', color: COLORS.dark, maxWidth: column.width - 18 });
    });
    pdf.y -= 36;
    const reading = core.compareReading(comparison);
    if (reading) note(pdf, reading, COLORS.white, 'Leitura da comparação');
  }

  return {
    PAGE, COLORS, COLUMNS, COMPARE_COLUMNS, BOTTOM, CONTENT, tone,
    setMeasurer, measure: (text, size, bold) => measure(text, size, bold),
    encodeText, wrap, fit, build, contaCartaMark, comparisonTable, signed, MARK, arcPath, moveTo, lineTo, PdfWriter, roundedPath, latin1, rgb,
  };
});
