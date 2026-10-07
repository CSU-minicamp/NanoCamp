import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCover, projectCoverDataUri, coverRatios } from '../src/coverArt.mjs';

test('same project always renders the same cover', () => {
  const a = projectCover({ id: '02', title: '校园雷达', ratio: '4:3' });
  const b = projectCover({ id: '02', title: '校园雷达', ratio: '4:3' });
  assert.equal(a, b);
  assert.notEqual(a, projectCover({ id: '04', title: 'SuperNote', ratio: '4:3' }));
});

test('covers adapt to 1:1 and 16:9 without overflowing the canvas', () => {
  for (const ratio of ['1:1', '16:9']) {
    const svg = projectCover({ id: '12', title: '电动车大学跑路app', ratio });
    const [, w, h] = svg.match(/viewBox="0 0 (\d+) (\d+)"/).map(Number);
    const expected = { '1:1': [640, 640], '16:9': [640, 360] }[ratio];
    assert.deepEqual([w, h], expected);
    for (const [, x, y] of svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"/g)) {
      assert.ok(Number(x) < w && Number(y) < h, `text out of canvas at ${ratio}`);
    }
  }
  assert.ok(coverRatios.includes('1:1') && coverRatios.includes('16:9'));
});

test('missing logo degrades to the NC mark instead of a broken image', () => {
  const svg = projectCover({ id: '17', title: '智能衣柜', logo: '' });
  assert.doesNotMatch(svg, /<image/);
  assert.match(svg, />NC</);
});

test('every cover is deterministic, labelled and escapes injected markup', () => {
  const svg = projectCover({ id: '<script>', title: '<img src=x onerror=alert(1)>', logo: '" onerror="x' });
  assert.match(svg, /role="img"/);
  assert.match(svg, /<title id="cover-[^"]+">作品封面：/);
  assert.doesNotMatch(svg, /<script>|<img src=x|onerror="x/);
  assert.doesNotMatch(svg, /&(?!amp;|lt;|gt;|quot;|apos;|#)/);
});

test('data uri variant keeps the cover self-contained', () => {
  const uri = projectCoverDataUri({ id: '20', title: 'AI 智能桌宠助手', ratio: '1:1' });
  assert.match(uri, /^data:image\/svg\+xml,/);
  assert.doesNotMatch(decodeURIComponent(uri.slice('data:image/svg+xml,'.length)), /<image/);
});
