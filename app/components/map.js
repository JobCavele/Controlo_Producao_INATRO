/*
 * Conta Carta · mapa de Moçambique
 *
 * As onze províncias vêm de mocambique.svg: o mapa da simplemaps.com, guardado
 * tal como eles o publicam (uso livre; a licença vai no cabeçalho do ficheiro).
 * Esta peça lê esse desenho, pinta cada província pelo que produziu e pousa um
 * ponto por delegação. O ficheiro traz três pontos de referência com latitude
 * e longitude: é por eles que se sabe onde cai cada delegação, sem adivinhar.
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
  /** O id de cada província no ficheiro e o nome que as delegações lhe dão. */
  const PROVINCES = {
    MZP: 'Cabo Delgado', MZA: 'Niassa', MZN: 'Nampula', MZQ: 'Zambézia', MZT: 'Tete', MZB: 'Manica',
    MZS: 'Sofala', MZI: 'Inhambane', MZG: 'Gaza', MZL: 'Maputo', MZMPM: 'Maputo Cidade',
  };

  /**
   * O nome que se lê no ecrã. Há delegações com o nome da sua província (Tete,
   * Nampula, Inhambane, Manica): «Província de Tete» nunca se confunde com elas.
   */
  const LINK = { Niassa: 'do', Zambézia: 'da' };
  const provinceLabel = (name) => (name === 'Maputo Cidade' ? 'Cidade de Maputo' : `Província ${LINK[name] || 'de'} ${name}`);

  /** A latitude na escala de Mercator, a projecção em que o ficheiro está desenhado. */
  const mercator = (latitude) => Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));

  /** A recta que melhor passa pelos pares [origem, destino]: devolve a função que converte. */
  function line(pairs) {
    const mean = (index) => pairs.reduce((sum, pair) => sum + pair[index], 0) / pairs.length;
    const from = mean(0);
    const to = mean(1);
    const slope = pairs.reduce((sum, pair) => sum + (pair[0] - from) * (pair[1] - to), 0)
      / pairs.reduce((sum, pair) => sum + (pair[0] - from) ** 2, 0);
    return (value) => to + slope * (value - from);
  }

  /**
   * A projecção do desenho, tirada dos pontos de referência (cada um com a
   * latitude, a longitude e o x e o y no ficheiro): devolve a função que põe
   * uma longitude e uma latitude no sítio certo do desenho.
   */
  function projection(marks) {
    const toX = line(marks.map((mark) => [mark.longitude, mark.x]));
    const toY = line(marks.map((mark) => [mercator(mark.latitude), mark.y]));
    return (longitude, latitude) => [toX(longitude), toY(mercator(latitude))];
  }

  /**
   * Lê o ficheiro: o contorno de cada província e a projecção. Cada ponto de
   * referência traz «latitude|longitude» na classe e o x e o y no desenho.
   */
  function read(text) {
    const file = new DOMParser().parseFromString(text, 'image/svg+xml');
    const provinces = [...file.querySelectorAll('#features path')]
      .map((path) => ({ name: PROVINCES[path.id], d: path.getAttribute('d') }))
      .filter((province) => province.name);
    const marks = [...file.querySelectorAll('#points circle')].map((mark) => {
      const [latitude, longitude] = mark.getAttribute('class').split('|').map(Number);
      return { latitude, longitude, x: Number(mark.getAttribute('cx')), y: Number(mark.getAttribute('cy')) };
    });
    if (provinces.length !== Object.keys(PROVINCES).length || marks.length < 2) {
      throw new Error('O ficheiro do mapa não traz as onze províncias e os pontos de referência.');
    }
    return { provinces, project: projection(marks) };
  }

  /**
   * Monta o mapa em `host` e devolve `paint`, que o actualiza com números
   * novos. `el` e `fmt` são emprestados por quem desenha; `onPick` recebe
   * { province } ou { point } quando se escolhe com o rato ou com o teclado.
   */
  function create(host, text, { el, fmt, onPick }) {
    const { provinces, project } = read(text);
    const shape = (tag, attributes) => {
      const node = document.createElementNS(SVG_SPACE, tag);
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
      return node;
    };
    const button = (tag, attributes) => shape(tag, { ...attributes, role: 'button', tabindex: '0' });

    const outlines = new Map();
    const land = shape('g', {});
    for (const province of provinces) {
      const outline = button('path', { d: province.d, class: 'map-province', 'data-province': province.name });
      outlines.set(province.name, outline);
      land.append(outline);
    }
    // o contorno da província escolhida desenha-se por cima de todas: as vizinhas não o tapam
    const chosen = shape('path', { class: 'map-chosen', d: '', 'aria-hidden': 'true' });
    const points = shape('g', {});
    const svg = shape('svg', { viewBox: FRAME, class: 'map-svg' });
    svg.append(land, chosen, points);

    // por cima do mar, no canto do mapa: o que está debaixo do rato (ou do foco) e a escala dos tons.
    // Quem ouve o ecrã já tem o mesmo texto no nome de cada província e de cada ponto.
    const readout = el('p', { class: 'map-readout', 'aria-hidden': 'true' });
    const legend = el('p', { class: 'map-legend', 'aria-hidden': 'true' }, [
      'menos', ...Array.from({ length: TOP_LEVEL + 1 }, (_, level) => el('i', { 'data-level': level })), 'mais',
    ]);
    host.replaceChildren(svg, readout, legend);

    const hit = (event) => event.target.closest('[data-province], [data-point]');
    const hush = () => readout.replaceChildren();
    const tell = (event) => {
      const node = hit(event);
      if (!node) { hush(); return; }
      const name = node.dataset.point || provinceLabel(node.dataset.province);
      readout.replaceChildren(el('strong', { text: name }), `${node.dataset.produced} cartas produzidas`);
    };
    const pick = (event) => {
      const node = hit(event);
      if (!node) return;
      event.preventDefault();
      onPick(node.dataset.point ? { point: node.dataset.point } : { province: node.dataset.province });
    };
    svg.addEventListener('click', pick);
    svg.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') pick(event); });
    svg.addEventListener('pointerover', tell);
    svg.addEventListener('focusin', tell);
    svg.addEventListener('pointerleave', hush);
    svg.addEventListener('focusout', hush);

    /**
     * `totals` é um Map de província → cartas produzidas; `delegations` traz o
     * nome, as coordenadas e a produção de cada ponto; `active` diz o que está
     * escolhido ({ province } ou { point }).
     */
    function paint({ totals, delegations, active }) {
      const top = Math.max(0, ...totals.values());
      for (const [name, outline] of outlines) {
        const produced = totals.get(name) || 0;
        outline.setAttribute('data-level', top ? Math.ceil((produced / top) * TOP_LEVEL) : 0);
        outline.setAttribute('data-produced', fmt(produced));
        outline.setAttribute('aria-label', `${provinceLabel(name)}: ${fmt(produced)} cartas produzidas`);
        outline.setAttribute('aria-pressed', String(name === active.province));
      }
      const picked = outlines.get(active.province);
      chosen.setAttribute('d', picked ? picked.getAttribute('d') : '');

      // os pontos maiores vão por baixo e o escolhido por cima: os pequenos continuam ao alcance do rato
      const most = Math.max(1, ...delegations.map((delegation) => delegation.produced));
      const order = [...delegations].sort((a, b) => (a.name === active.point) - (b.name === active.point) || b.produced - a.produced);
      // redesenhar os pontos não pode tirar o foco a quem anda pelo teclado
      const held = document.activeElement;
      const focused = held && held.dataset ? held.dataset.point : '';
      points.replaceChildren(...order.map((delegation) => {
        const [x, y] = project(delegation.lng, delegation.lat);
        return button('circle', {
          cx: x.toFixed(1),
          cy: y.toFixed(1),
          r: (5 + 7 * Math.sqrt(delegation.produced / most)).toFixed(1),
          class: 'map-point',
          'data-point': delegation.name,
          'data-produced': fmt(delegation.produced),
          'aria-label': `${delegation.name}: ${fmt(delegation.produced)} cartas produzidas`,
          'aria-pressed': String(delegation.name === active.point),
        });
      }));
      const again = focused && [...points.children].find((node) => node.dataset.point === focused);
      if (again) again.focus();
    }

    return { paint };
  }

  return { create, read, projection, provinceLabel, PROVINCES, FRAME };
});
