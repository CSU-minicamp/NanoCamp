// 测试用最小 DOM：只实现 base.js 需要的部分，并支持序列化与 HTML 解析，
// 便于把客户端渲染结果和构建期 HTML 做逐节点比对。
import vm from 'node:vm';

export const VOID_TAGS = new Set(['circle', 'path', 'input', 'img', 'br', 'meta', 'link']);

export function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// 与真实 DOM 一致：插入 DocumentFragment 时展开它的子节点，而不是插入 fragment 本身。
export function flatten(nodes) {
  return nodes.flatMap(node => (node && node.nodeName === '#fragment' ? flatten(node.children) : node));
}

export class FakeNode {
  constructor(name) {
    this.nodeName = name;
    this.attributes = new Map();
    this.children = [];
    this.text = '';
  }

  // 与真实 DOM 一致：布尔属性由 property 反映到 attribute 上。
  get hidden() { return this.attributes.has('hidden'); }
  set hidden(value) { if (value) this.attributes.set('hidden', ''); else this.attributes.delete('hidden'); }
  get open() { return this.attributes.has('open'); }
  set open(value) { if (value) this.attributes.set('open', ''); else this.attributes.delete('open'); }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  get textContent() { return this.text; }
  set textContent(value) { this.text = String(value); this.children = []; }
  append(...nodes) { this.children.push(...flatten(nodes)); }
  replaceChildren(...nodes) { this.children = flatten(nodes); }
  addEventListener() {}
  focus() {}
  contains(node) { return node === this || this.children.includes(node); }
  get className() { return this.getAttribute('class') || ''; }
  matches(selector) { return matchSelector(this, selector); }
  querySelector(selector) { return findFirst(this, selector); }
  querySelectorAll(selector) {
    const found = [];
    collect(this, selector, found);
    return found;
  }

  serialize() {
    if (this.nodeName === '#text') return escapeText(this.text);
    const attributes = [...this.attributes]
      .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
      .sort()
      .join('');
    if (VOID_TAGS.has(this.nodeName)) return `<${this.nodeName}${attributes}/>`;
    const body = this.children.map(child => child.serialize()).join('') + escapeText(this.text);
    return `<${this.nodeName}${attributes}>${body}</${this.nodeName}>`;
  }
}

export function findFirst(node, selector) {
  for (const child of node.children) {
    if (!(child instanceof FakeNode)) continue;
    if (child.matches(selector)) return child;
    const nested = findFirst(child, selector);
    if (nested) return nested;
  }
  return null;
}

function collect(node, selector, found) {
  for (const child of node.children) {
    if (!(child instanceof FakeNode)) continue;
    if (child.matches(selector)) found.push(child);
    collect(child, selector, found);
  }
}

function matchSelector(node, selector) {
  if (selector.startsWith('.')) return node.className.split(/\s+/).includes(selector.slice(1));
  if (selector.startsWith('#')) return node.getAttribute('id') === selector.slice(1);
  const attribute = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
  if (attribute) {
    const value = node.getAttribute(attribute[1]);
    if (value === null) return false;
    return attribute[2] === undefined || value === attribute[2];
  }
  return node.nodeName === selector;
}

export function parseAttributes(source) {
  const attributes = new Map();
  const pattern = /([\w:-]+)(?:="([^"]*)")?/g;
  let match;
  // 布尔属性（如 hidden）在 HTML 里可以省略值，统一成 "" 便于与 DOM 序列化比较。
  while ((match = pattern.exec(source))) attributes.set(match[1], match[2] === undefined ? '' : match[2]);
  return attributes;
}

// 解析 HTML 片段，返回与 FakeNode.serialize() 同构的规范形式。
export function parse(html) {
  const pattern = /<!--[\s\S]*?-->|<\/([\w-]+)\s*>|<([\w-]+)((?:"[^"]*"|'[^']*'|[^>"'])*)\/?>|([^<]+)/g;
  const root = { nodeName: '#root', attributes: new Map(), children: [], text: '' };
  const stack = [root];
  let match;
  while ((match = pattern.exec(html))) {
    const [, closing, opening, attributeText, text] = match;
    if (closing) { stack.pop(); continue; }
    if (opening) {
      const node = { nodeName: opening, attributes: parseAttributes(attributeText), children: [], text: '' };
      stack[stack.length - 1].children.push(node);
      if (!VOID_TAGS.has(opening)) stack.push(node);
      continue;
    }
    if (text) stack[stack.length - 1].text += text;
  }
  return root;
}

// 把 parse() 的结果转成 FakeNode 树，用于在最小 DOM 里复现真实页面的局部结构。
export function toFakeNodes(parsed, document) {
  if (parsed.nodeName === '#text') {
    const node = document.createTextNode(parsed.text);
    return node;
  }
  const node = parsed.nodeName.startsWith('#')
    ? document.createDocumentFragment()
    : document.createElement(parsed.nodeName);
  for (const [name, value] of parsed.attributes) node.setAttribute(name, value);
  for (const child of parsed.children) node.append(toFakeNodes(child, document));
  node.text = parsed.text;
  return node;
}

export function canonical(node) {
  const attributes = [...node.attributes]
    .map(([name, value]) => ` ${name}="${value}"`)
    .sort()
    .join('');
  const body = node.children.map(canonical).join('') + node.text;
  return `<${node.nodeName}${attributes}>${body}</${node.nodeName}>`;
}

export function createDocument() {
  const body = new FakeNode('body');
  const document = {
    body,
    documentElement: new FakeNode('html'),
    createElement: name => new FakeNode(name),
    createElementNS: (_namespace, name) => new FakeNode(name),
    createTextNode: text => {
      const node = new FakeNode('#text');
      node.text = String(text);
      return node;
    },
    createDocumentFragment: () => new FakeNode('#fragment'),
    querySelector: selector => findFirst(body, selector) || findFirst(document.documentElement, selector),
    querySelectorAll: selector => body.querySelectorAll(selector),
    addEventListener() {}
  };
  return document;
}

// 在最小 DOM 里执行 public/base.js，返回它挂到 window 上的接口。
export function runBase(source, document, window = { document }) {
  const context = vm.createContext({ window, document, console });
  vm.runInContext(source, context, { filename: 'public/base.js' });
  return window.NanoCampBase;
}
