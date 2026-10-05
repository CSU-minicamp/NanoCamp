import test from 'node:test';
import assert from 'node:assert/strict';
import { projects, moments } from '../content/site.mjs';
import { renderPage } from '../src/pages.mjs';

test('real projects appended after unfilled slots appear in the annual recap',()=>{
  projects.push({...projects[0],id:'real-demo',title:'校园开放地图',description:'真实作品的测试资料'});
  try {
    for(const route of ['/','/projects/']){
      assert.match(renderPage(route),/校园开放地图/);
      assert.doesNotMatch(renderPage(route),/首届作品资料待补充/);
    }
    assert.match(renderPage('/minicamp/'),/2026 届优秀作品。/);
  } finally { projects.pop(); }
});

test('minicamp page keeps confirmed event content and omits footer utility controls',()=>{
  const html=renderPage('/minicamp/');
  assert.match(html,/2026 年 9 月 26–27 日/);
  assert.match(html,/中南大学潇湘校区 外语楼 635/);
  assert.match(html,/minicamp-group-photo\.jpg/);
  assert.match(html,/2026 届优秀作品。/);
  assert.match(html,/收藏夹不吃灰计划|Build to Taste|中国龙能飞/);
  assert.match(html,/event-theme-list/);
  assert.doesNotMatch(html,/先读一份 Demo 指南|回到顶部|back-to-top|暂停全站动效|复制页面链接|data-site-motion-toggle|data-share-page/);
  assert.doesNotMatch(html,/加入渠道尚未公布，可先阅读参与指南。/);
});

test('photos can be published before projects without contradictory empty states',()=>{
  const original=moments[0].src;
  try {
    moments[0].src='/images/real-event-photo.jpg';
    const html=renderPage('/');
    assert.match(html,/src="\/images\/real-event-photo.jpg"/);
    assert.doesNotMatch(html,/首届活动照片待补充/);
    assert.match(html,/作品介绍与 Demo 链接待补充/);
  } finally { moments[0].src=original; }
});

test('minicamp page links to the official activity site',()=>{
  const html=renderPage('/minicamp/');
  assert.match(html,/href="https:\/\/minicamp\.flipperusc\.work\/"/);
  assert.match(html,/target="_blank" rel="noopener noreferrer"/);
  assert.match(html,/进入 minicamp 活动官网/);
});
