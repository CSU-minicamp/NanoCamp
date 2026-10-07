import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { header, footer } from '../src/components.mjs';
import { createDocument, createWindow, parse, runBase, toFakeNodes } from './helpers/fake-dom.mjs';

const source = readFileSync(new URL('../public/base.js', import.meta.url), 'utf8');

function fixture() {
  const document = createDocument();
  document.body.setAttribute('data-page', 'projects');
  document.body.append(toFakeNodes(parse(header('projects') + footer('projects')), document));
  const window = createWindow(document);
  const mediaListeners = new Set();
  const mobile = {
    matches: true,
    addEventListener: (_type, callback) => mediaListeners.add(callback),
    removeEventListener: (_type, callback) => mediaListeners.delete(callback)
  };
  window.matchMedia = query => query.includes('max-width') ? mobile : { matches: false };
  const frames = new Map();
  let nextFrame = 0;
  window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  window.cancelAnimationFrame = id => frames.delete(id);
  const scrolls = [];
  window.scrollTo = options => scrolls.push(options);
  const api = runBase(source, document, window);
  const flush = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback());
  };
  return { api, document, window, scrolls, flush, mobile, mediaListeners };
}

test('mobile navigation still toggles once after repeated mount calls', () => {
  const { api, document } = fixture();
  const button = document.querySelector('[data-menu-toggle]');
  const menu = document.querySelector('[data-nav="mobile"]');
  for (let count = 0; count < 2; count++) {
    api.mount();
    button.dispatchEvent({ type: 'click' });
    assert.equal(menu.hidden, false);
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    button.dispatchEvent({ type: 'click' });
    assert.equal(menu.hidden, true);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
  }
});

test('mobile navigation closes on Escape and desktop resize after remount', () => {
  const { api, document, mobile, mediaListeners } = fixture();
  api.mount();
  const button = document.querySelector('[data-menu-toggle]');
  const menu = document.querySelector('[data-nav="mobile"]');
  button.dispatchEvent({ type: 'click' });
  assert.equal(menu.hidden, false);
  document.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(menu.hidden, true);
  assert.equal(button.focused, true);
  button.dispatchEvent({ type: 'click' });
  mobile.matches = false;
  mediaListeners.forEach(callback => callback());
  assert.equal(menu.hidden, true);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
});

test('back-to-top mounts one button and one click action after repeated calls', () => {
  const { api, document, window, scrolls, flush } = fixture();
  api.mount();
  api.backToTop();
  const buttons = document.querySelectorAll('[data-back-to-top]');
  assert.equal(buttons.length, 1);
  window.scrollY = 600;
  window.dispatchEvent({ type: 'scroll' });
  flush();
  assert.equal(buttons[0].hasAttribute('data-visible'), true);
  buttons[0].dispatchEvent({ type: 'click' });
  assert.equal(scrolls.length, 1);
  assert.equal(scrolls[0].top, 0);
  assert.equal(scrolls[0].behavior, 'smooth');
  window.scrollY = 0;
  window.dispatchEvent({ type: 'scroll' });
  flush();
  assert.equal(buttons[0].hasAttribute('data-visible'), false);
});

test('remounted navigation keeps cooperation and search available without a More menu', () => {
  const { api, document } = fixture();
  api.mount();
  const links = document.querySelector('[data-nav="desktop"]').children;
  assert.equal(document.querySelector('.nav-more'), null);
  assert.equal(links[5].getAttribute('href'), '/partners/');
  assert.equal(links[6].getAttribute('href'), '/search/');
  assert.equal(links[6].getAttribute('data-search-shortcut'), '');
});
