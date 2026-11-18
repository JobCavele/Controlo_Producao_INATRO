/*
 * Conta Carta · mapa de Moçambique
 *
 * As onze províncias vêm de mocambique.svg: o mapa da simplemaps.com, guardado
 * tal como eles o publicam (uso livre; a licença vai no cabeçalho do ficheiro).
 * Há uma delegação por província, por isso o mapa e a lista ao lado dizem o
 * mesmo: cada província leva o tom e o número do que a sua delegação produziu.
 * O sítio de cada número também vem do ficheiro, que traz um ponto por província.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ContaCartaMap = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SVG_SPACE = 'http://www.w3.org/2000/svg';
  /** O país ocupa o meio da tela de 1000 × 1000 do ficheiro: a moldura deixa as margens vazias de fora. */
  const FRAME = '208 32 584 936';
  /** Cinco tons por província, do «sem produção» (0) ao máximo do período (4). As cores são do CSS. */
  const TOP_LEVEL = 4;
  /** O id de cada província no ficheiro e o nome que o catálogo das delegações lhe dá. */
  const PROVINCES = {
    MZP: 'Cabo Delgado', MZA: 'Niassa', MZN: 'Nampula', MZQ: 'Zambézia', MZT: 'Tete', MZB: 'Manica',
    MZS: 'Sofala', MZI: 'Inhambane', MZG: 'Gaza', MZL: 'Maputo', MZMPM: 'Maputo Cidade',
  };
  /**
   * Onde o número se afasta do ponto que o ficheiro dá, em unidades do desenho.
   * Manica e Sofala são vizinhas estreitas: cada número chega-se para o seu
   * lado. A Cidade de Maputo é pequena de mais para se ver o tom ou caber o
   * número: lêem-se ao lado, sobre o mar, com um traço até ela.
   */
  const NUDGE = { Manica: [-14, 4], Sofala: [18, 10], Maputo: [-6, -12], 'Maputo Cidade': [46, 12] };
  const ASIDE = 'Maputo Cidade';

  /** O tom de uma província: 0 sem produção, e de 1 a 4 conforme a parte que tem do máximo do período. */
  const tone = (produced, top) => (top && produced ? Math.ceil((produced / top) * TOP_LEVEL) : 0);

  /** O nome que se lê no ecrã: «Província de Tete» nunca se confunde com a delegação de Tete. */
  const LINK = { Niassa: 'do', Zambézia: 'da' };
  const provinceLabel = (name) => (name === 'Maputo Cidade' ? 'Cidade de Maputo' : `Província ${LINK[name] || 'de'} ${name}`);

  /** Lê o ficheiro: o contorno de cada província e o ponto onde se escreve o seu número. */
  function read(text) {
    const file = new DOMParser().parseFromString(text, 'image/svg+xml');
    const spots = new Map([...file.querySelectorAll('#label_points circle')]
      .map((spot) => [spot.getAttribute('id'), [Number(spot.getAttribute('cx')), Number(spot.getAttribute('cy'))]]));
    const provinces = [...file.querySelectorAll('#features path')]
      .map((path) => ({ name: PROVINCES[path.getAttribute('id')], d: path.getAttribute('d'), spot: spots.get(path.getAttribute('id')) }))
      .filter((province) => province.name && province.spot);
    if (provinces.length !== Object.keys(PROVINCES).length) throw new Error('O ficheiro do mapa não traz as onze províncias.');
    return provinces;
  }

  /**
   * Monta o mapa em `host` e devolve `paint`, que o actualiza com números
   * novos. `el` e `fmt` são emprestados por quem desenha; `onPick` recebe o
   * nome da província quando se escolhe com o rato ou com o teclado.
   */
  function create(host, text, { el, fmt, onPick }) {
    const shape = (tag, attributes) => {
      const node = document.createElementNS(SVG_SPACE, tag);
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
      return node;
    };

    const outlines = new Map();
    const numbers = new Map();
    const land = shape('g', {});
    const labels = shape('g', { class: 'map-labels', 'aria-hidden': 'true' });
    // o que acompanha o número que se lê ao lado: o traço até à cidade e o quadrado com o tom dela
    const aside = shape('g', {});
    const chip = shape('rect', { class: 'map-chip', width: 18, height: 18, rx: 3 });
    for (const province of read(text)) {
      const outline = shape('path', { d: province.d, class: 'map-province', 'data-province': province.name, role: 'button', tabindex: '0' });
      outlines.set(province.name, outline);
      land.append(outline);
      const [dx, dy] = NUDGE[province.name] || [0, 0];
      const [x, y] = [province.spot[0] + dx, province.spot[1] + dy];
      const apart = province.name === ASIDE;
      if (apart) {
        chip.setAttribute('x', x);
        chip.setAttribute('y', y - 9);
        aside.append(shape('line', { class: 'map-leader', x1: province.spot[0], y1: province.spot[1], x2: x - 5, y2: y }), chip);
        labels.append(aside);
      }
      const number = shape('text', { class: apart ? 'map-label is-aside' : 'map-label', x: apart ? x + 25 : x, y });
      numbers.set(province.name, number);
      labels.append(number);
    }
    // o contorno da província escolhida desenha-se por cima de todas: as vizinhas não o tapam
    const chosen = shape('path', { class: 'map-chosen', d: '', 'aria-hidden': 'true' });
    const svg = shape('svg', { viewBox: FRAME, class: 'map-svg' });
    svg.append(land, chosen, labels);

    // por cima do mar, no canto do mapa: o que está debaixo do rato (ou do foco) e a escala dos tons.
    // Quem ouve o ecrã já tem o mesmo texto no nome de cada província.
    const readout = el('p', { class: 'map-readout', 'aria-hidden': 'true' });
    const legend = el('p', { class: 'map-legend', 'aria-hidden': 'true' }, [
      'menos', ...Array.from({ length: TOP_LEVEL + 1 }, (_, level) => el('i', { 'data-level': level })), 'mais',
    ]);
    host.replaceChildren(svg, readout, legend);

    let shown = new Map();
    const hit = (event) => event.target.closest('[data-province]');
    const hush = () => readout.replaceChildren();
    const tell = (event) => {
      const node = hit(event);
      const row = node && shown.get(node.dataset.province);
      if (!row) { hush(); return; }
      readout.replaceChildren(
        el('strong', { text: row.delegation }),
        ...(row.delegation === node.dataset.province ? [] : [el('span', { text: provinceLabel(node.dataset.province) })]),
        el('span', { text: `${fmt(row.produced)} produzidas` }),
        el('span', { text: `${fmt(row.approved)} aprovadas · ${fmt(row.dispatched)} despachadas` }),
      );
    };
    const pick = (event) => {
      const node = hit(event);
      if (!node) return;
      event.preventDefault();
      onPick(node.dataset.province);
    };
    svg.addEventListener('click', pick);
    svg.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') pick(event); });
    svg.addEventListener('pointerover', tell);
    svg.addEventListener('focusin', tell);
    svg.addEventListener('pointerleave', hush);
    svg.addEventListener('focusout', hush);

    /**
     * `rows` é um Map de província → { delegation, produced, approved,
     * dispatched }; `active` é a província escolhida, ou '' quando não há.
     */
    function paint({ rows, active }) {
      shown = rows;
      const top = Math.max(0, ...[...rows.values()].map((row) => row.produced));
      for (const [name, outline] of outlines) {
        const row = rows.get(name) || { delegation: name, produced: 0, approved: 0, dispatched: 0 };
        const level = tone(row.produced, top);
        outline.setAttribute('data-level', level);
        if (name === ASIDE) {
          chip.setAttribute('data-level', level);
          aside.style.display = row.produced ? '' : 'none';
        }
        outline.setAttribute('aria-label', `${provinceLabel(name)}, delegação ${row.delegation}: ${fmt(row.produced)} cartas produzidas, ${fmt(row.approved)} aprovadas, ${fmt(row.dispatched)} despachadas`);
        outline.setAttribute('aria-pressed', String(name === active));
        numbers.get(name).textContent = row.produced ? fmt(row.produced) : '';
      }
      const picked = outlines.get(active);
      chosen.setAttribute('d', picked ? picked.getAttribute('d') : '');
    }

    return { paint };
  }

  return { create, read, tone, provinceLabel, PROVINCES, FRAME };
});
