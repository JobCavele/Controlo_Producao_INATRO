/*
 * Mini-DOM para os testes da interface.
 *
 * Não é um navegador: só o necessário para correr `app.js` contra o
 * `index.html` real, clicar em botões e verificar o que foi desenhado.
 * Sem dependências externas, para «correr os testes» ser só `node tests/...`.
 */
'use strict';

const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'path', 'rect', 'circle', 'line', 'use']);
const ATTR = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

class ClassList {
  constructor(node) { this.node = node; }
  get set() { return new Set(String(this.node.className || '').split(/\s+/).filter(Boolean)); }
  write(value) { this.node.className = [...value].join(' '); }
  add(...names) { const set = this.set; names.forEach((n) => set.add(n)); this.write(set); }
  remove(...names) { const set = this.set; names.forEach((n) => set.delete(n)); this.write(set); }
  toggle(name, force) {
    const set = this.set;
    const on = force === undefined ? !set.has(name) : !!force;
    if (on) set.add(name); else set.delete(name);
    this.write(set);
    return on;
  }
  contains(name) { return this.set.has(name); }
}

class Node {
  constructor(tag, document) {
    this.tagName = String(tag).toUpperCase();
    this.tag = String(tag).toLowerCase();
    this.ownerDocument = document;
    this.attributes = new Map();
    this.dataset = {};
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.listeners = new Map();
    this.className = '';
    this._text = '';
    this._html = '';
    this.disabled = false;
    this._value = undefined;
    this.files = [];
    this.nodeType = 1;
    this.classList = new ClassList(this);
    this.open = false;
  }

  /** `.value` reflecte o atributo até alguém escrever no campo (como no DOM). */
  get value() { return this._value === undefined ? (this.attributes.get('value') || '') : this._value; }
  set value(next) { this._value = next === null || next === undefined ? '' : String(next); }

  /* `.hidden` também reflecte o atributo, como no DOM real. */
  get hidden() { return this.attributes.has('hidden'); }
  set hidden(value) { if (value) this.attributes.set('hidden', ''); else this.attributes.delete('hidden'); }

  /* `.type` e `.checked` também reflectem o marcado, como no DOM real. */
  get type() { return this._type !== undefined ? this._type : this.attributes.get('type'); }
  set type(next) { this._type = next === null || next === undefined ? undefined : String(next); }
  get checked() { return this._checked === undefined ? this.attributes.has('checked') : Boolean(this._checked); }
  set checked(next) { this._checked = Boolean(next); }

  /* atributos */
  setAttribute(name, value) {
    if (name === 'class') { this.className = String(value); return; }
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[key] = String(value);
    }
    this.attributes.set(name, String(value));
  }
  getAttribute(name) { return name === 'class' ? this.className : (this.attributes.has(name) ? this.attributes.get(name) : null); }
  hasAttribute(name) { return this.getAttribute(name) !== null; }
  removeAttribute(name) { this.attributes.delete(name); }

  /* árvore */
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] || null; }
  append(...nodes) { for (const node of nodes) { const child = typeof node === 'string' ? new TextNode(node, this.ownerDocument) : node; child.parentNode = this; this.children.push(child); } }
  appendChild(node) { this.append(node); return node; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  get textContent() {
    if (this.children.length === 0) return this._text;
    if (this._html) return this._html.replace(/<[^>]*>/g, ' ');
    return this.children.map((child) => child.textContent).join('');
  }
  set textContent(value) { this.children = []; this._html = null; this._text = String(value); }
  set innerHTML(value) { this._html = String(value); this.children = []; this._text = ''; }
  get innerHTML() { return this._html || this.children.map((child) => child.outerHTML).join(''); }
  get outerHTML() {
    if (this._html) return this._html;
    const attributes = [...this.attributes].map(([name, value]) => ` ${name}="${value}"`).join('');
    const inner = this._text || this.children.map((child) => child.outerHTML).join('');
    return this.tag ? `<${this.tag}${attributes}>${inner}</${this.tag}>` : inner;
  }

  /* selecção */
  matches(selector) {
    return selector.split(',').some((part) => this.matchesChain(part.trim().split(/\s+/)));
  }
  /** Cadeia de selectores com descendentes: «.filter .segmented button». */
  matchesChain(chain) {
    if (!this.matchesOne(chain[chain.length - 1])) return false;
    if (chain.length === 1) return true;
    let node = this.parentNode;
    for (let index = chain.length - 2; index >= 0; index -= 1) {
      let matched = false;
      while (node) {
        if (node.matchesOne && node.matchesOne(chain[index])) { matched = true; node = node.parentNode; break; }
        node = node.parentNode;
      }
      if (!matched) return false;
    }
    return true;
  }
  matchesOne(part) {
    const tokens = part.match(/(^[a-zA-Z][\w-]*)|(#[\w-]+)|(\.[\w-]+)|(\[[^\]]+\])/g) || [];
    return tokens.every((token) => {
      if (token.startsWith('#')) return this.id === token.slice(1);
      if (token.startsWith('.')) return this.classList.contains(token.slice(1));
      if (token.startsWith('[')) {
        const [, name, value] = token.slice(1, -1).match(/^([\w-]+)(?:=["']?([^"'\]]*)["']?)?$/) || [];
        if (!name) return false;
        if (value === undefined) return this.hasAttribute(name) || (name.startsWith('data-') && this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] !== undefined);
        return String(this.getAttribute(name)) === value;
      }
      return this.tag === token.toLowerCase();
    });
  }
  walk(visit) { for (const child of this.children) { if (child.nodeType === 1) { visit(child); child.walk(visit); } } }
  querySelectorAll(selector) { return selector === '*' ? this.walkAll() : this.find(selector); }
  walkAll() { const out = []; this.walk((node) => out.push(node)); return out; }
  find(selector) { const out = []; this.walk((node) => { if (node.matches(selector)) out.push(node); }); return out; }
  querySelector(selector) { return selector === '*' ? this.walkAll()[0] || null : this.find(selector)[0] || null; }
  closest(selector) { let node = this; while (node) { if (node.matches && node.matches(selector)) return node; node = node.parentNode; } return null; }

  /* eventos */
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(handler); }
  /** Dispara no alvo e sobe pelos pais, como um evento do DOM a sério. */
  dispatch(type, event = {}) {
    let stopped = false;
    const document = this.ownerDocument;
    const detail = {
      type, target: this, currentTarget: this,
      preventDefault() { detail.defaultPrevented = true; },
      stopPropagation() { stopped = true; },
      ...event,
    };
    const path = [];
    let node = this;
    while (node) { path.push(node); node = node.parentNode; }
    if (path[path.length - 1] !== document.root) path.push(document.root);
    for (const target of path) {
      if (stopped) break;
      detail.currentTarget = target;
      for (const handler of (target.listeners && target.listeners.get(type)) || []) handler.call(target, detail);
    }
    if (!stopped) {
      detail.currentTarget = document;
      for (const handler of document.listeners.get(type) || []) handler(detail);
    }
    return detail;
  }
  /** Um <a download> clicado fica visível para os testes (nome do ficheiro exportado). */
  click() {
    if (this.tag === 'a') {
      const name = this.getAttribute('download');
      if (name && this.ownerDocument) this.ownerDocument.lastDownload = name;
    }
    return this.dispatch('click');
  }
  change() { return this.dispatch('change'); }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; }
  show() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
  getBoundingClientRect() { return { left: 40, top: 40, right: 120, bottom: 70, width: 80, height: 30 }; }
  getContext() { return null; }   // sem canvas: o PDF usa as larguras aproximadas
}

class TextNode {
  constructor(text, document) { this.nodeType = 3; this._text = String(text); this.parentNode = null; this.children = []; this.ownerDocument = document; }
  get textContent() { return this._text; }
  get outerHTML() { return this._text; }
  walk() {}
}

/** Parseia o HTML da aplicação: suficiente para o markup do Conta Carta. */
function parseHtml(html, document) {
  const root = new Node('#document', document);
  const stack = [root];
  const source = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!doctype[^>]*>/i, '');
  const tokens = source.match(/<\/?[A-Za-z][^>]*>|[^<]+/g) || [];
  for (const token of tokens) {
    if (!token.startsWith('<')) {
      const text = token.replace(/\s+/g, ' ');
      if (text.trim()) stack[stack.length - 1].append(text.trim());
      continue;
    }
    if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
    const name = token.match(/^<([A-Za-z][\w-]*)/)[1].toLowerCase();
    const node = document.createElement(name);
    const attributes = token.slice(1, -1);
    for (const match of attributes.matchAll(ATTR)) {
      const value = match[2] ?? match[3] ?? match[4] ?? '';
      if (match[1] === 'class') node.className = value;
      else if (match[1] === 'id') node.id = value;
      else node.setAttribute(match[1], value);
    }
    stack[stack.length - 1].append(node);
    if (!VOID.has(name) && !token.endsWith('/>')) stack.push(node);
  }
  return root;
}

function createDocument(html) {
  const document = {
    readyState: 'complete',
    listeners: new Map(),
    byId: new Map(),
    createElement(tag) {
      const node = new Node(tag, document);
      return node;
    },
    createTextNode(text) { return new TextNode(text, document); },
    createDocumentFragment() { const node = new Node('#fragment', document); node.nodeType = 11; return node; },
    addEventListener(type, handler) { if (!document.listeners.has(type)) document.listeners.set(type, []); document.listeners.get(type).push(handler); },
    dispatch(type, event) { for (const handler of document.listeners.get(type) || []) handler({ type, target: document.body, ...event }); },
    getElementById(id) { return document.byId.get(id) || null; },
    querySelectorAll(selector) { return document.root.querySelectorAll(selector); },
    querySelector(selector) { return document.querySelectorAll(selector)[0] || null; },
  };
  document.root = parseHtml(html || '', document);
  document.root.walk((node) => { if (node.id) document.byId.set(node.id, node); });
  document.body = document.root.querySelector('body') || document.root;
  document.documentElement = document.root;
  // elementos criados por JS recebem id próprio; garantimos que getElementById os encontra
  const create = document.createElement.bind(document);
  document.createElement = (tag) => {
    const node = create(tag);
    const originalSet = node.setAttribute.bind(node);
    node.setAttribute = (name, value) => { if (name === 'id') { node.id = value; document.byId.set(value, node); } originalSet(name, value); };
    const idDescriptor = {
      get() { return node._id || ''; },
      set(value) { node._id = value; document.byId.set(value, node); },
      configurable: true,
    };
    Object.defineProperty(node, 'id', idDescriptor);
    if (node.id) { /* noop */ }
    return node;
  };
  return document;
}

module.exports = { createDocument, Node, TextNode, parseHtml };
