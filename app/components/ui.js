/*
 * Conta Carta · peças de interface
 *
 * O pouco que todas as vistas usam: criar elementos sem escrever HTML,
 * encher um contentor, o 🛈 da ajuda, os carimbos de data e as tiras de
 * números grandes. Sem estado e sem rede: só desenho.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../lib/core.js'));
  else root.ContaCartaUI = factory(root.ContaCartaCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  /** Cria elementos sem HTML escrito à mão: textos nunca viram markup. */
  function el(tag, props, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of [].concat(children === undefined ? [] : children)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const fill = (node, ...children) => node.replaceChildren(...children.filter(Boolean));

  /** O ícone do 🛈 é sempre o mesmo: um SVG da marca, nunca um emoji. */
  const INFO_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="6.7" r="1.15" fill="currentColor"/><path d="M10 9.6v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  /** Botão de ajuda: a chave diz qual das frases do core ele mostra. */
  function infoButton(key) {
    const button = el('button', { class: 'info', type: 'button', 'data-info': key, 'aria-label': 'Mais informação' });
    button.innerHTML = INFO_ICON;
    return button;
  }

  const pad2 = (value) => String(value).padStart(2, '0');

  /** Hoje, no fuso deste computador, em «AAAA-MM-DD». */
  const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  };

  /** Carimbo «dd/mm/yyyy, HH:MM» — dd/mm/yyyy em todo o lado, como no resto do sistema. */
  const stampFor = (now) => `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()}, ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const stamp = () => stampFor(new Date());

  /** Data e hora de uma gravação, em «dd/mm/yyyy, HH:MM»; aceita ISO ou a forma já escrita. */
  function shortStamp(value) {
    if (!value) return '';
    const written = /^(\d{2})\/(\d{2})\/(\d{4})[,\s]+(\d{2}):(\d{2})/.exec(String(value));
    if (written) return `${written[1]}/${written[2]}/${written[3]}, ${written[4]}:${written[5]}`;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : stampFor(date);
  }

  /** O que se escreve num campo de data é dd/mm/aaaa; o que fica guardado é ISO. */
  const dateText = (iso) => (core.isDate(iso) ? core.shortDate(iso) : '');
  const monthText = (month) => (core.isMonth(month) ? core.monthLabel(month) : '');

  /** A leitura de uma taxa de aprovação: verde a partir de 90 %, amarelo a partir de 80 %. */
  const rateClass = (rate) => (rate === null || rate === undefined ? '' : rate >= 90 ? 'is-ok' : rate >= 80 ? 'is-warn' : 'is-bad');

  /** Uma tira de números grandes: as mesmas proporções do painel, para se ler de longe. */
  function stripCard(label, value, hint, tone) {
    return el('div', { class: 'strip-card' }, [
      el('span', { class: 'strip-label', text: label }),
      el('strong', { class: `strip-value ${tone || ''}`.trim(), text: value }),
      el('span', { class: 'strip-hint', text: hint }),
    ]);
  }

  /**
   * Descarrega uma vez o JPEG achatado do logótipo oficial (pronto a embutir no
   * PDF, que não lê PNG transparente). Se falhar, o PDF sai com o nome da
   * instituição em texto — nunca sem identificação.
   */
  function loadLogo() {
    return fetch('inatro-letterhead.jpg', { cache: 'force-cache' })
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error('sem logótipo'))))
      .then((buffer) => ({ bytes: new Uint8Array(buffer), pixelWidth: 979, pixelHeight: 319 }))
      .catch(() => null);
  }

  /**
   * A tabela do período vive em table.js e liga-se aqui (`linkTable`): esta
   * peça é a dona das ferramentas de desenho, por isso é ela quem as empresta.
   * Se a tabela ainda não estiver ligada, é um erro de arranque — não um
   * `undefined` a meio de um clique.
   */
  let dataTable = null;
  function linkTable(module) {
    if (!module || typeof module.dataTable !== 'function') throw new Error('A tabela do período não foi ligada ao ui.js.');
    dataTable = module.dataTable;
  }
  const buildTable = (summary, withActions, options) => dataTable(summary, withActions, options, { el, fmt: core.format, rateClass });

  /**
   * Uma caixa de data com calendário: a mesma peça em todos os sítios onde se
   * escolhe um dia ou um mês (pickdate.js). Ligada uma vez, aqui.
   */
  let pickDate = null;
  function linkPickDate(module) {
    if (!module || typeof module.attach !== 'function') throw new Error('A caixa de data não foi ligada ao ui.js.');
    pickDate = module;
  }
  const dateBox = (options) => pickDate.attach({ el, ...options });

  return { el, fill, infoButton, infoIcon: INFO_ICON, pad2, today, stamp, stampFor, shortStamp, dateText, monthText, rateClass,
    stripCard, buildTable, dateBox, linkTable, linkPickDate, loadLogo };
});
