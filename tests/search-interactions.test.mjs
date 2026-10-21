import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchPage } from '../src/search.mjs';
import * as searchCore from '../public/search-core.js';
import { createDocument, createWindow, FakeNode, parse, runScript, toFakeNodes } from './helpers/fake-dom.mjs';

const source = readFileSync(new URL('../public/search.js', import.meta.url), 'utf8').replace(/^import[^\n]+\n/, '');
const records = [
  ...Array.from({ length: 8 }, (_, i) => ({ id: `camp-${i + 1}`, type: 'project', title: `minicamp ${i + 1}`, href: `/projects/camp-${i + 1}/`, description: 'Camp project' })),
  { id: 'share-1', type: 'guide', title: '分享指南', href: '/resources/share-one/', description: '分享经验' },
  { id: 'share-2', type: 'event', title: '分享活动', href: '/activities/share-two/', description: '分享作品' }
];
const campHrefs = ['/projects/camp-1/', '/projects/camp-2/', '/projects/camp-3/', '/projects/camp-4/', '/projects/camp-5/', '/projects/camp-6/', '/projects/camp-7/', '/projects/camp-8/'];

function fixture({ query = 'minicamp', missingReplaceChildren = false } = {}) {
  const document = createDocument();
  document.body.dataset = {};
  document.createElement = name => {
    const node = new FakeNode(name);
    Object.defineProperties(node, {
      className: { get: () => node.getAttribute('class') || '', set: value => node.setAttribute('class', value) },
      childElementCount: { get: () => node.children.length },
      dataset: { get: () => Object.fromEntries([...node.attributes].filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase()), value])) }
    });
    node.scrollIntoView = () => {};
    return node;
  };
  document.body.append(toFakeNodes(parse(searchPage(records)), document));
  const root = document.querySelector('[data-site-search]');
  const input = root.querySelector('#site-query');
  const results = root.querySelector('[data-search-results]');
  if (missingReplaceChildren) results.replaceChildren = undefined;
  const location = new URL('https://example.test/search/');
  if (query) location.searchParams.set('q', query);
  const window = createWindow(document);
  window.scrollX = 0;
  window.scrollY = 240;
  const scrolls = [];
  window.scrollTo = options => scrolls.push(options);
  const history = { replaceState: (_state, _title, url) => { location.href = url.href; } };
  runScript(source, document, window, { ...searchCore, location, history, URL, clearTimeout }, 'public/search.js');
  const dispatch = (node, type, detail = {}) => node.dispatchEvent({ type, ...detail, preventDefault() { this.defaultPrevented = true; } });
  return { root, input, results, document, location, scrolls, dispatch, hrefs: () => results.children.map(item => item.querySelector('a').href) };
}

test('pagination keeps the submitted query while a different query is being typed', () => {
  const { root, input, location, dispatch, hrefs } = fixture();
  assert.deepEqual(hrefs(), campHrefs.slice(0, 6));
  input.value = '分享';
  dispatch(input, 'input');
  assert.deepEqual(hrefs(), campHrefs.slice(0, 6));
  dispatch(root.querySelector('[data-search-more]'), 'click');
  assert.deepEqual(hrefs(), campHrefs);
  assert.equal(input.value, '分享');
  assert.equal(location.searchParams.get('q'), 'minicamp');
});

for (const method of ['clear button', 'Escape', 'backspace']) {
  test(`pagination keeps existing results after ${method} clears the input`, () => {
    const { root, input, document, location, dispatch, hrefs } = fixture();
    if (method === 'clear button') dispatch(root.querySelector('[data-query-clear]'), 'click');
    else if (method === 'Escape') dispatch(input, 'keydown', { key: 'Escape' });
    else { input.value = ''; dispatch(input, 'input'); }
    assert.equal(input.value, '');
    assert.deepEqual(hrefs(), campHrefs.slice(0, 6));
    dispatch(root.querySelector('[data-search-more]'), 'click');
    assert.deepEqual(hrefs(), campHrefs);
    assert.equal(document.body.dataset.searchState, 'results');
    assert.equal(location.searchParams.get('q'), 'minicamp');
  });
}

test('a nonempty submission commits the new query and preserves scroll position', () => {
  const { root, input, location, scrolls, dispatch, hrefs } = fixture();
  input.value = '分享';
  dispatch(input, 'input');
  dispatch(root.querySelector('form'), 'submit');
  assert.deepEqual(hrefs(), ['/resources/share-one/', '/activities/share-two/']);
  assert.equal(location.searchParams.get('q'), '分享');
  assert.equal(scrolls.length, 1);
  assert.equal(scrolls[0].left, 0);
  assert.equal(scrolls[0].top, 240);
  assert.equal(scrolls[0].behavior, 'instant');
  input.value = '';
  dispatch(root.querySelector('form'), 'submit');
  assert.deepEqual(hrefs(), ['/resources/share-one/', '/activities/share-two/']);
  assert.equal(location.searchParams.get('q'), '分享');
});

test('an enhancement failure clears the landing state and restores the static directory', () => {
  const { root, document } = fixture({ query: '', missingReplaceChildren: true });
  assert.equal(document.body.dataset.searchState, undefined);
  assert.equal(root.querySelector('[data-search-ui]').hidden, true);
  assert.equal(root.querySelector('[data-search-fallback]').hidden, false);
  assert.equal(root.querySelector('[data-search-error]').hidden, false);
});
