import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { header } from '../src/components.mjs';
import { communityPage } from '../src/community.mjs';
import { createDocument, createWindow, parse, runScript, toFakeNodes } from './helpers/fake-dom.mjs';

const source = readFileSync(new URL('../public/community.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const text = node => node.text + node.children.map(text).join('');

function fixture(hash = '#contact') {
  const document = createDocument();
  document.body.append(toFakeNodes(parse(header('community') + communityPage()), document));
  const location = new URL('https://nanocamp.example/community/' + hash);
  const window = createWindow(document);
  window.matchMedia = () => ({ matches: true });
  const decorate = node => {
    node.closest = selector => {
      for (let current = node; current; current = current.parentNode) {
        if (selector === 'a[href]' ? current.nodeName === 'a' && current.hasAttribute('href') : current.matches(selector)) return current;
      }
      return null;
    };
    node.classList = {
      contains: value => node.className.split(/\s+/).includes(value),
      add: value => node.classList.toggle(value, true),
      toggle(value, force) {
        const values = new Set(node.className.split(/\s+/).filter(Boolean));
        const add = force ?? !values.has(value);
        add ? values.add(value) : values.delete(value);
        node.setAttribute('class', [...values].join(' '));
        return add;
      },
    };
    node.focus = () => { document.activeElement = node; };
    node.children.forEach(decorate);
  };
  decorate(document.body);
  decorate(document.documentElement);
  runScript(source, document, window, {
    location, URL,
    getComputedStyle: () => ({ transform: 'none', left: '0px', top: '80px', width: '340px', height: '360px' }),
  }, 'public/community.js');
  const papers = document.querySelectorAll('[data-contact-paper]');
  const tabs = papers.map(paper => paper.querySelector('.contact-paper-tab'));
  const contactLink = document.querySelectorAll('a').find(link => link.getAttribute('href') === '#contact');
  const dispatch = (target, type, properties = {}) => {
    const event = {
      type, target, button: 0, detail: 1, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...properties,
    };
    // Native DOM events bubble from the target to the document.
    for (let node = target; node; node = node.parentNode) node.dispatchEvent(event);
    document.dispatchEvent(event);
    return event;
  };
  return { document, window, location, papers, tabs, contactLink, dispatch };
}

function assertSelected(papers, selected) {
  papers.forEach((paper, index) => {
    assert.equal(paper.classList.contains('is-active'), index === selected, `paper ${index} active state`);
    assert.equal(paper.querySelector('.contact-paper-body').inert, index !== selected, `paper ${index} accessible body`);
    assert.equal(paper.querySelector('.contact-paper-tab').getAttribute('aria-expanded'), String(index === selected));
  });
}

test('repeated contact-link activation restores QQ while the fragment is already #contact', async () => {
  const { papers, contactLink, dispatch, location } = fixture();
  assertSelected(papers, 5);
  for (const other of [1, 3, 0]) {
    dispatch(papers[other], 'click');
    await settle();
    assertSelected(papers, other);
    const event = dispatch(contactLink, 'click');
    await settle();
    assert.equal(event.defaultPrevented, false, 'keep native anchor navigation and scrolling');
    assert.equal(location.hash, '#contact');
    assertSelected(papers, 5);
  }
});

test('keyboard card navigation and native Enter link activation expose the requested contact', async () => {
  const { document, papers, tabs, contactLink, dispatch } = fixture();
  const home = dispatch(tabs[5], 'keydown', { key: 'Home' });
  await settle();
  assert.equal(home.defaultPrevented, true);
  assert.equal(document.activeElement, tabs[0]);
  assertSelected(papers, 0);
  dispatch(tabs[0], 'keydown', { key: 'ArrowLeft' });
  await settle();
  assert.equal(document.activeElement, tabs[5]);
  assertSelected(papers, 5);
  dispatch(tabs[5], 'keydown', { key: 'ArrowRight' });
  await settle();
  assert.equal(document.activeElement, tabs[0]);
  assertSelected(papers, 0);
  dispatch(tabs[0], 'keydown', { key: 'End' });
  await settle();
  assert.equal(document.activeElement, tabs[5]);
  assertSelected(papers, 5);
  dispatch(tabs[5], 'keydown', { key: 'Home' });
  await settle();
  assertSelected(papers, 0);
  // A native <a> activated with Enter emits click with detail=0.
  contactLink.focus();
  const event = dispatch(contactLink, 'click', { detail: 0 });
  await settle();
  assert.equal(event.defaultPrevented, false);
  assertSelected(papers, 5);
  assert.equal(document.activeElement, contactLink);
});

test('hash navigation still selects both contact and group cards', async () => {
  const { window, location, papers } = fixture('');
  assertSelected(papers, 0);
  location.hash = '#groups';
  window.dispatchEvent({ type: 'hashchange' });
  await settle();
  assertSelected(papers, 3);
  location.hash = '#contact';
  window.dispatchEvent({ type: 'hashchange' });
  await settle();
  assertSelected(papers, 5);
});

test('modified contact-link clicks keep the current card available', async () => {
  const { papers, contactLink, dispatch } = fixture('');
  dispatch(contactLink, 'click', { ctrlKey: true });
  await settle();
  assertSelected(papers, 0);
});

test('QQ group retains its readable manual-join number and original-image link without JavaScript', () => {
  const document = createDocument();
  document.body.append(toFakeNodes(parse(communityPage()), document));
  const group = document.querySelectorAll('[data-contact-paper]')[4];
  assert.match(text(group), /1126393930/);
  assert.match(group.querySelector('img').getAttribute('src'), /social\/qq\.png$/);
  const qr = group.querySelector('.contact-paper-qr');
  assert.equal(qr.getAttribute('href'), '/images/community-groups/qq-qr.png');
  assert.match(qr.querySelector('img').getAttribute('alt'), /1126393930/);
  assert.equal(group.querySelector('.contact-paper-body').hasAttribute('hidden'), false);
  assert.equal(group.querySelector('.contact-paper-body').hasAttribute('inert'), false);
});

test('unchanged WeChat QR retains its expiry warning and reachable QQ alternative', async () => {
  const { papers, dispatch } = fixture('#groups');
  const wechat = papers[3];
  assert.match(text(wechat), /10 月 12 日/);
  const qr = wechat.querySelector('.contact-paper-qr');
  assert.equal(qr.getAttribute('href'), '/images/community-groups/wechat-qr.png');
  assert.match(qr.querySelector('img').getAttribute('alt'), /10 月 12 日前有效/);
  const alternative = wechat.querySelectorAll('a').find(link => link.getAttribute('href') === '#contact');
  assert.ok(alternative, 'expired-code guidance must lead to QQ contact');
  assert.match(text(alternative), /QQ/);
  dispatch(alternative, 'click');
  await settle();
  assertSelected(papers, 5);
});
