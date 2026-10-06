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

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatchEvent(event) {
      event.target ??= this;
      for (const listener of [...(listeners.get(event.type) || [])]) listener.call(this, event);
      return !event.defaultPrevented;
    }
  };
}

export class FakeNode {
  constructor(name) {
    this.nodeName = name;
    this.attributes = new Map();
    this.children = [];
    this.text = '';
    this.parentNode = null;
    Object.assign(this, eventTarget());
  }

  // 与真实 DOM 一致：布尔属性由 property 反映到 attribute 上。
  get hidden() { return this.attributes.has('hidden'); }
  set hidden(value) { if (value) this.attributes.set('hidden', ''); else this.attributes.delete('hidden'); }
  get open() { return this.attributes.has('open'); }
  set open(value) { if (value) this.attributes.set('open', ''); else this.attributes.delete('open'); }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  // 真实 DOM 的 Element 同时提供这两个方法；补上以免 base.js 里正常的属性操作在
  // 测试环境里抛 TypeError。toggleAttribute 的第二个参数与规范一致：给了就按它设定。
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  toggleAttribute(name, force) {
    const next = force === undefined ? !this.attributes.has(name) : Boolean(force);
    if (next) this.attributes.set(name, '');
    else this.attributes.delete(name);
    return next;
  }
  get textContent() { return this.text; }
  set textContent(value) { this.text = String(value); this.children = []; }
  append(...nodes) {
    for (const node of flatten(nodes)) {
      if (node.parentNode) {
        const siblings = node.parentNode.children;
        siblings.splice(siblings.indexOf(node), 1);
      }
      node.parentNode = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.children.forEach(node => { node.parentNode = null; });
    this.children = [];
    this.append(...nodes);
  }
  focus() { this.focused = true; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  get className() { return this.getAttribute('class') || ''; }
  matches(selector) { return matchSelector(this, selector); }
  querySelector(selector) { return findFirst(this, selector); }
  querySelectorAll(selector) {
    const found = [];
    collect(this, selector, found);
    return found;
  }

  // 与浏览器 outerHTML 对应的序列化：只输出元素自身，不带上父节点里的空白文本。
  get outerHTML() { return this.serialize(); }

  serialize() {
    if (this.nodeName === '#text') return escapeText(this.text);
    const attributes = [...this.attributes]
      .map(([name, value]) => ` ${name}="${escapeAttribute(name === 'class' ? value.trim().replace(/\s+/g, ' ') : value)}"`)
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
// 纯空白文本节点会被忽略：构建期模板里的换行缩进对渲染没有影响。
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
    if (text && !/^\s*$/.test(text)) stack[stack.length - 1].text += text;
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
    .map(([name, value]) => ` ${name}="${name === 'class' ? String(value).trim().replace(/\s+/g, ' ') : value}"`)
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
    // JS 里的布尔判断会用到，测试里默认可见。
    hidden: false,
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
    ...eventTarget()
  };
  return document;
}

// 最小 window：base.js 会用到 scrollY、innerHeight、requestAnimationFrame 与事件订阅。
export function createWindow(document) {
  return {
    document,
    scrollY: 0,
    innerHeight: 900,
    requestAnimationFrame: callback => { callback(); return 1; },
    cancelAnimationFrame() {},
    ...eventTarget()
  };
}

// 在最小 DOM 里执行 public/base.js，返回它挂到 window 上的接口。
export function runBase(source, document, window = createWindow(document)) {
  vm.runInContext(source, vm.createContext({ window, document, console }), { filename: 'public/base.js' });
  return window.NanoCampBase;
}

// 通用版本：把浏览器里可以直接裸用的全局（matchMedia / getComputedStyle / requestAnimationFrame …）
// 一并放进 context，方便测试那些按浏览器全局写法写的脚本。
export function runScript(source, document, window = createWindow(document), globals = {}, filename = 'client-script.js') {
  vm.runInContext(source, vm.createContext({ window, document, console, ...globals }), { filename });
  return window;
}
