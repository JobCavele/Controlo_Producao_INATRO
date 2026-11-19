/* Conta Carta · mapa operacional das delegações, a partir do SVG local. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ContaCartaMap = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SVG_SPACE = 'http://www.w3.org/2000/svg';
  const FRAME = '208 32 584 936';
  // Correspondência geográfica no ficheiro original. A apresentação de Maputo é tratada no desenho.
  const SEATS = Object.freeze({
    MZMPM: 'MAP-C', MZL: 'MAT', MZG: 'XAI', MZI: 'INH', MZS: 'BEI', MZB: 'CHI-S',
    MZQ: 'QUE', MZT: 'TET', MZN: 'NAM', MZA: 'LIC', MZP: 'PEM',
  });
  const OFFSET = { 'CHI-S': [-22, 4], BEI: [18, 8], 'MAP-C': [2, -34], INH: [10, -4] };
  const NEUTRAL = '#e3e7e3';
  const INDICATORS = {
    produced: { label: 'Produzidas', empty: 'Sem produção no período' },
    pending: { label: 'Pendentes (INCAPE)', empty: 'Zero pendentes nas consultas disponíveis' },
    qcApproved: { label: 'QC aprovadas', empty: 'Sem aprovações no período' },
    dispatched: { label: 'Despachadas', empty: 'Sem despachos no período' },
  };

  // Escala fixa por quantidade: a mesma contagem mantém a cor noutro mês ou se for a única sede activa.
  // Comprimimos as ordens de grandeza para que tanto dezenas como milhares sejam legíveis.
  function heat(quantity) {
    if (!(quantity > 0)) return { fill: NEUTRAL, lightText: false };
    const decades = Math.log10(quantity);
    const lightness = 80 - 75 * decades / (decades + 2);
    return { fill: `hsl(140, 48%, ${lightness.toFixed(2)}%)`, lightText: lightness < 35.5 };
  }

  // O rato ou o foco mostram uma prévia; ao sair, a caixa volta à delegação escolhida.
  const readoutRow = (shown, inspected, selected) => shown.get(inspected) ?? shown.get(selected);

  // Uma só coluna alimenta o preenchimento, o número no mapa e a amostra de cor na tabela.
  function quantityView(delegations, indicator = 'produced') {
    if (!Object.hasOwn(INDICATORS, indicator)) indicator = 'produced';
    const byCode = new Map(delegations.map((row) => [row.code, row]));
    const seats = Object.values(SEATS).map((code) => byCode.get(code)).filter(Boolean);
    const link = { Niassa: 'do', Zambézia: 'da' };
    const rows = seats.map((row) => {
      const value = row[indicator];
      const quantity = Number.isSafeInteger(value) && value >= 0 ? value : null;
      return {
        ...row, name: row.code === 'MAP-C' ? 'Maputo' : row.name,
        region: row.code === 'MAP-C' ? 'Capital do país' : `Província ${link[row.province] || 'de'} ${row.province}`,
        quantity, ...heat(quantity),
      };
    });
    // A legenda exemplifica a escala com contagens que existem neste período (não são escalões).
    const values = [...new Set(rows.map((row) => row.quantity).filter((n) => n > 0))].sort((a, b) => a - b);
    const samples = values.length <= 3 ? values : [values[0], values[Math.floor(values.length / 2)], values.at(-1)];
    return { rows, indicator, samples };
  }

  function read(text) {
    const file = new DOMParser().parseFromString(text, 'image/svg+xml');
    // No original, cada ID existe tanto em #features como em #label_points.
    const spots = new Map([...file.querySelectorAll('#label_points circle')].map((spot) => [
      spot.id, [parseFloat(spot.getAttribute('cx')), parseFloat(spot.getAttribute('cy'))],
    ]));
    const regions = [...file.querySelectorAll('#features path')].map((path) => ({
      code: SEATS[path.id], d: path.getAttribute('d'), spot: spots.get(path.id),
    })).filter((region) => region.code);
    if (regions.length !== Object.keys(SEATS).length || new Set(regions.map((region) => region.code)).size !== regions.length ||
        regions.some(({ d, spot }) => !d || !spot || !spot.every(Number.isFinite))) {
      throw new Error('O mapa não contém os contornos e as legendas das onze delegações.');
    }
    return regions;
  }

  function create(host, text, { el, fmt, onPick }) {
    function shape(tag, attributes = {}) {
      const node = document.createElementNS(SVG_SPACE, tag);
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
      return node;
    }
    const svg = shape('svg', { viewBox: FRAME, class: 'map-svg', role: 'group', 'aria-label': 'Delegações de Moçambique' });
    const land = shape('g', { fill: NEUTRAL });
    // As províncias vizinhas nunca pintam por cima do contorno em destaque.
    const outlines = shape('g', { 'aria-hidden': 'true', 'pointer-events': 'none' });
    const labels = shape('g', { 'aria-hidden': 'true' });
    svg.append(land, outlines, labels);
    const regions = new Map(read(text).map((region) => [region.code, region]));
    const provincial = regions.get('MAT');
    const parts = new Map();
    for (const code of Object.values(SEATS)) {
      const region = regions.get(code);
      const capital = code === 'MAP-C', aside = code === 'MAT';
      const [x, y] = capital ? provincial.spot : region.spot;
      const [dx, dy] = OFFSET[code] || [0, 0];
      let tx = x + dx, ty = y + dy;
      const control = shape('g', {
        class: 'map-region', 'data-delegation': code, role: 'button', tabindex: '0', 'aria-controls': 'delegationRows',
      });
      // Em Maputo a mancha principal (os dois contornos do sul) representa MAP-C.
      // MAT tem uma área lateral própria: não se somam nem se trocam os valores das duas sedes.
      let area;
      if (aside) {
        tx = x + 128;
        ty = y + 28;
        control.append(shape('path', { class: 'map-leader', d: `M${x} ${y} h25 l28 28 H${tx - 16}` }),
          shape('circle', { class: 'map-anchor', cx: x, cy: y, r: 4 }));
        area = shape('rect', { class: 'map-province map-callout', x: tx - 16, y: ty - 23, width: 142, height: 62, rx: 8 });
      } else {
        area = shape('path', { class: 'map-province', d: capital ? `${provincial.d} ${region.d}` : region.d });
      }
      control.append(area);
      land.append(control);
      const outline = area.cloneNode(false);
      outline.setAttribute('class', 'map-outline');
      outlines.append(outline);
      const label = shape('g', { class: 'map-labels' + (capital ? ' is-capital' : aside ? ' is-aside' : ''), 'data-delegation': code });
      const name = shape('text', { class: 'map-name', x: tx, y: ty });
      const value = shape('text', { class: 'map-value', x: tx, y: ty + 24, lengthAdjust: 'spacingAndGlyphs' });
      label.append(name, value);
      labels.append(label);
      parts.set(code, { control, area, outline, name, value, label });
    }
    const readout = el('div', { class: 'map-readout', 'aria-hidden': 'true' });
    const caption = el('span');
    const scale = el('span', { class: 'map-scale', title: 'Exemplos de quantidades e respectivas cores' });
    const plot = el('div', { class: 'map-plot' }, [svg, readout]);
    host.replaceChildren(plot, el('div', { class: 'map-legend' }, [caption, scale]));

    let shown = new Map(), inspected = '', selected = '';
    const hit = (target) => target?.closest?.('[data-delegation]')?.dataset.delegation || '';
    const metrics = (row) => [
      ['Produzidas', fmt(row.produced)], ['QC aprovadas', fmt(row.qcApproved)],
      ['Despachadas', fmt(row.dispatched)], ['Pendentes', row.pending == null ? '—' : fmt(row.pending)],
    ];
    function tell() {
      const row = readoutRow(shown, inspected, selected);
      if (!row) { readout.replaceChildren(); return; }
      readout.replaceChildren(el('strong', { text: row.name }), el('small', { text: row.region }),
        el('dl', {}, metrics(row).map(([key, amount]) => el('div', {}, [el('dt', { text: key }), el('dd', { text: amount })]))));
    }
    function inspect(code) {
      if (inspected === code) return;
      parts.get(inspected)?.outline.classList.remove('is-inspected');
      inspected = code;
      parts.get(inspected)?.outline.classList.add('is-inspected');
      readout.hidden = false;
      tell();
    }
    const keyboardFocus = () => hit(svg.querySelector('.map-region:focus-visible'));
    function pick(event) {
      const code = hit(event.target);
      if (!shown.has(code)) return;
      event.preventDefault();
      parts.get(code).control.focus({ preventScroll: true });
      const tap = event.type === 'click' && (event.pointerType ? event.pointerType === 'touch' : matchMedia('(hover: none)').matches);
      inspect(tap && code === selected ? '' : code);
      onPick(code);
    }
    plot.addEventListener('click', pick);
    plot.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') pick(event); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && inspected) readout.hidden = true; });
    const point = (event) => { if (event.pointerType !== 'touch') inspect(hit(event.target) || keyboardFocus()); };
    plot.addEventListener('pointerover', point);
    plot.addEventListener('pointermove', point);
    plot.addEventListener('pointerleave', (event) => { if (event.pointerType !== 'touch') inspect(keyboardFocus()); });
    plot.addEventListener('focusin', (event) => inspect(hit(event.target)));
    plot.addEventListener('focusout', () => inspect(''));

    // Repinta todas as áreas, incluindo as que voltaram a zero, sem recriar os controlos focados.
    function paint({ rows, indicator, samples }, active) {
      shown = new Map(rows.map((row) => [row.code, row]));
      if (active && active !== selected) readout.hidden = false;
      selected = active || '';
      for (const [code, part] of parts) {
        const row = shown.get(code);
        part.area.setAttribute('fill', row?.fill ?? NEUTRAL);
        part.label.classList.toggle('on-dark', Boolean(row?.lightText));
        part.outline.classList.toggle('is-selected', code === selected);
        part.control.setAttribute('aria-pressed', String(code === selected));
        part.control.setAttribute('aria-label', row ? `${row.name}, ${row.region}. ${metrics(row).map(([k, v]) => `${k}: ${v}`).join('. ')}` : 'Sem dados');
        const name = row ? (code === 'MAT' || code === 'MAP-C' ? row.name : row.province) : '';
        let number = row?.quantity > 0 ? fmt(row.quantity) : '';
        if (row && indicator === 'pending') number = row.quantity == null ? '—' : fmt(row.quantity);
        part.label.classList.toggle('no-value', !number);
        if (part.name.textContent !== name) part.name.textContent = name;
        if (part.value.textContent !== number) part.value.textContent = number;
        if (number.length > 8) part.value.setAttribute('textLength', 104);
        else part.value.removeAttribute('textLength');
      }
      const { label, empty } = INDICATORS[indicator];
      caption.textContent = label;
      if (!samples.length) {
        const noSnapshot = indicator === 'pending' && rows.every((row) => row.quantity == null);
        const others = Object.keys(INDICATORS).filter((key) => key !== indicator && rows.some((row) => row[key] > 0));
        caption.textContent = (noSnapshot ? 'Sem consulta INCAPE até à data final' : empty)
          + (others.length ? `. Com valores: ${others.map((key) => INDICATORS[key].label).join(', ')}.` : '');
      }
      scale.hidden = !samples.length;
      scale.replaceChildren(...[0, ...samples].map((n) => el('span', {}, [
        el('i', { style: `background-color:${heat(n).fill}`, 'aria-hidden': 'true' }), fmt(n),
      ])));
      tell();
    }
    // Destaque apenas visual da TV: não mexe na selecção manual, no hover nem nas cores da métrica.
    function spotlight(code) {
      for (const [key, part] of parts) {
        part.outline.classList.toggle('tv-focus', key === code);
        part.label.classList.toggle('tv-focus', key === code);
      }
    }
    return { paint, spotlight };
  }

  return { create, read, quantityView, readoutRow, INDICATORS, SEATS };
});
