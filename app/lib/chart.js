/*
 * Conta Carta · gráfico de barras do período (SVG, sem dependências)
 *
 * Constrói o <svg> como texto e devolve o cartão pronto a encaixar na vista,
 * no relatório em papel e na lupa. As cores são as mesmas da folha de estilos
 * e do PDF, por isso os três nunca divergem.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.ContaCartaChart = factory(root.ContaCartaCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  const fmt = core.format;
  const round = (value) => Math.round(value * 10) / 10;
  /** O gráfico devolve um nó; cria-o sem depender do resto da interface. */
  const el = (tag, props, children) => {
    const node = document.createElement(tag);
    Object.assign(node, props || {});
    (children || []).forEach((child) => child && node.append(child));
    return node;
  };

const CHART_METRICS = {
  produced: { label: 'Cartas produzidas (compostas das três saídas)', color: '#0e7a2e' },
  approved: { label: 'Cartas aprovadas', color: '#0e7a2e' },
  rejected: { label: 'Rejeitadas pela máquina', color: '#b4362d' },
  qualityRejected: { label: 'Rejeitadas no teste de qualidade', color: '#a46a12' },
};
const CHART_NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** Menor múltiplo de um passo «agradável» que cobre `peak`, com quatro intervalos. */
function niceApex(peak) {
  if (!(peak > 0)) return { step: 5, apex: 20 };
  const rough = peak / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / magnitude;
  const factor = CHART_NICE_STEPS.find((candidate) => candidate >= normalized) || 10;
  const step = factor * magnitude;
  return { step, apex: step * 4 };
}

function chartBars(points, metric, options) {
  const settings = options || {};
  const width = settings.width || 640, height = settings.height || 210;
  const bottom = settings.bottom || 24, top = settings.top || 26, left = 10;
  const fontScale = settings.fontScale || 1;
  const font = (size) => Math.round(size * fontScale * 10) / 10;
  const shown = points.slice(-(settings.maxPoints || 14));
  // com muitos pontos, só um rótulo de cada tantos aparece sob a barra
  const labelEvery = Math.max(1, Math.ceil(shown.length / 12));
  const shownMetric = metric || 'produced';
  const unit = settings.unit || 'período';
  if (!shown.length || shown.every((point) => !point.produced && !point.approved && !point.rejected && !point.qualityRejected)) {
    return el('div', { class: 'empty' }, [el('strong', { text: 'Sem números para desenhar' })]);
  }
  const grouped = shownMetric === 'produced';
  const metricValue = (point) => (shownMetric === 'produced' ? point.produced
    : shownMetric === 'approved' ? point.approved
    : shownMetric === 'qualityRejected' ? (point.qualityRejected || 0)
    : point.rejected);
  const essentialPeak = Math.max(1, ...shown.map((point) => (grouped
    ? Math.max(point.approved || 0, point.rejected || 0, point.qualityRejected || 0)
    : metricValue(point))));
  const { step, apex } = niceApex(essentialPeak);
  const plotHeight = height - bottom - top;
  const slot = (width - left * 2) / shown.length;
  const parts = [`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(CHART_METRICS[shownMetric].label)} por ${unit}">`];

  if (grouped) {
    const legend = [['Aprovadas', '#0e7a2e'], ['Rej. máquina', '#b4362d'], ['Rej. qualidade', '#a46a12']];
    let cursor = left + 2;
    parts.push(`<g class="chart-legend" font-size="${font(9)}" fill="#2d3f33" font-weight="500">`);
    for (const [label, color] of legend) {
      parts.push(`<circle cx="${round(cursor + fontScale * 3.5)}" cy="${font(12)}" r="${fontScale * 3.5}" fill="${color}"/>`);
      parts.push(`<text x="${round(cursor + fontScale * 10)}" y="${font(15)}">${label}</text>`);
      cursor += (label.length * fontScale * 5.6) + fontScale * 22;
    }
    parts.push('</g>');
  }

  for (let line = 0; line <= 4; line += 1) {
    const value = Math.round(step * line);
    const y = height - bottom - (line * plotHeight) / 4;
    parts.push(`<line x1="${left}" y1="${round(y)}" x2="${width - left}" y2="${round(y)}" stroke="${line ? '#e9efe7' : '#0b3d1f'}" stroke-width="${line ? 1 : 1.2}"/>`);
    parts.push(`<text x="${width - left}" y="${round(y - font(5))}" text-anchor="end" font-size="${font(9)}" fill="#7f8c81">${fmt(value)}</text>`);
  }

  const barLabel = settings.showValues !== false;
  if (grouped) {
    // três barras lado a lado: aprovadas, rejeitadas pela máquina e no teste de qualidade
    const trio = [['approved', '#0e7a2e'], ['rejected', '#b4362d'], ['qualityRejected', '#a46a12']];
    const barCap = shown.length <= 4 ? 34 * fontScale : 18 * fontScale;
    const barWidth = Math.min(barCap, Math.max(3, (slot - 10) / 3.35));
    const gap = Math.max(1.5, barWidth * 0.22);
    const groupWidth = trio.length * barWidth + (trio.length - 1) * gap;
    const showValues = barLabel && (barWidth + gap) >= 19;
    shown.forEach((point, index) => {
      const x0 = left + index * slot + (slot - groupWidth) / 2;
      const produced = point.produced || 0;
      const rejected = point.rejected || 0;
      const quality = point.qualityRejected || 0;
      const summary = `${escapeHtml(point.full)} — Produzidas: ${fmt(produced)} · Aprovadas: ${fmt(point.approved)} · Rej. máquina: ${fmt(rejected)} · Rej. qualidade: ${fmt(quality)}${produced ? ` (${core.formatPercent(point.approvalRate)} de aprovação)` : ''}`;
      parts.push(`<g><title>${summary}</title>`);
      trio.forEach(([key, color], barIndex) => {
        const value = point[key] || 0;
        if (!value) return;
        const barHeight = Math.max(2.5, (value / apex) * plotHeight);
        const x = x0 + barIndex * (barWidth + gap);
        const y = height - bottom - barHeight;
        parts.push(`<rect x="${round(x)}" y="${round(y)}" width="${round(barWidth)}" height="${round(barHeight)}" rx="${Math.min(2.5, settings.radius || 3)}" fill="${color}"/>`);
        if (showValues) {
          parts.push(`<text x="${round(x + barWidth / 2)}" y="${round(y - font(5))}" text-anchor="middle" font-size="${font(8)}" font-weight="600" fill="#16241b">${fmt(value)}</text>`);
        }
      });
      if (index % labelEvery === 0) {
        parts.push(`<text x="${round(left + index * slot + slot / 2)}" y="${height - font(7)}" text-anchor="middle" font-size="${font(10)}" fill="#5b6b5f">${escapeHtml(point.label)}</text>`);
      }
      parts.push('</g>');
    });
  } else {
    const color = CHART_METRICS[shownMetric].color;
    const barWidth = Math.min(40 * fontScale, Math.max(10, slot - 14));
    shown.forEach((point, index) => {
      const amount = metricValue(point);
      const x = left + index * slot + (slot - barWidth) / 2;
      const barHeight = amount ? Math.max(2.5, (amount / apex) * plotHeight) : 0;
      const y = height - bottom - barHeight;
      parts.push(`<g><title>${escapeHtml(point.full)} — ${escapeHtml(CHART_METRICS[shownMetric].label)}: ${fmt(amount)}${point.produced ? ` de ${fmt(point.produced)} produzidas` : ''}</title>`
        + `<rect x="${round(x)}" y="${round(y)}" width="${round(barWidth)}" height="${round(barHeight)}" rx="${settings.radius || 3}" fill="${color}"/>`
        + (barHeight && barLabel ? `<text x="${round(x + barWidth / 2)}" y="${round(y - font(6))}" text-anchor="middle" font-size="${font(10)}" font-weight="600" fill="#16241b">${fmt(amount)}</text>` : '')
        + (index % labelEvery === 0 ? `<text x="${round(x + barWidth / 2)}" y="${height - font(7)}" text-anchor="middle" font-size="${font(10)}" fill="#5b6b5f">${escapeHtml(point.label)}</text>` : '')
        + '</g>');
    });
  }

  parts.push('</svg>');
  const holder = el('div', { class: 'chart-holder' });
  holder.innerHTML = parts.join('');
  return holder;
}

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));


  return { chartBars, CHART_METRICS, niceApex, escapeHtml };
});
