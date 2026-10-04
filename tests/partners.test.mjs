import test from 'node:test';
import assert from 'node:assert/strict';
import { partnersPage } from '../src/partners.mjs';

const fixture = { cases: [], formats: [], offers: [], requests: [], email: null };

test('a configured cooperation email becomes a usable mail link', () => {
  const html = partnersPage({ ...fixture, email: 'team+hello@example.org' });
  assert.match(html, /href="mailto:team\+hello@example\.org\?subject=/);
  assert.match(html, />team\+hello@example\.org</);
  assert.doesNotMatch(html, /合作邮箱待补充/);
});

test('unfilled or malformed cooperation emails do not create misleading mail links', () => {
  for (const email of [null, '', '待补充', 'hello@example.org?bcc=elsewhere@example.org', 'hello@example.org\nBcc:elsewhere@example.org']) {
    const html = partnersPage({ ...fixture, email });
    assert.match(html, /合作邮箱待补充/);
    assert.doesNotMatch(html, /href="mailto:/);
  }
});

test('editable case copy stays literal and unsafe destinations stay inactive', () => {
  const item = { id: 'test-case', name: '<Team & "Friends">', summary: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)', theme: 'mint' };
  const html = partnersPage({ ...fixture, cases: [item] });
  assert.match(html, /&lt;Team &amp; &quot;Friends&quot;&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /href="javascript:|<img src=x/);
});
