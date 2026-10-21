import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../src/pages.mjs';
import { site } from '../content/site.mjs';

for (const fixture of [
  { name: 'no channel', qrCode: '', contact: '', notice: '加入渠道尚未公布，可先阅读参与指南。' },
  { name: 'contact channel', qrCode: '', contact: 'camp@example.test', notice: '欢迎每一份好奇心。' },
  { name: 'QR channel', qrCode: '/images/join-qr.png', contact: '', notice: '欢迎每一份好奇心。' }
]) {
  test(`home invitation explains joining availability for ${fixture.name}`, () => {
    const original = { qrCode: site.join.qrCode, contact: site.join.contact };
    try {
      Object.assign(site.join, { qrCode: fixture.qrCode, contact: fixture.contact });
      const html = renderPage('/');
      const joins = [...html.matchAll(/<section\b[^>]*aria-labelledby="join-heading"[^>]*>[\s\S]*?<\/section>/g)];
      assert.equal(joins.length, 1, 'home should render one invitation');
      const invitation = joins[0][0];
      assert.match(invitation, /有想做的，<br>就会有人一起。/);
      const paper = invitation.match(/<div class="join-paper">[\s\S]*?<\/div>/)?.[0];
      assert.ok(paper, 'home invitation should include its joining paper');
      assert.ok(paper.includes(fixture.notice), 'joining paper should explain whether channels are available');
      assert.match(paper, /data-join/);
    } finally {
      Object.assign(site.join, original);
    }
  });
}
