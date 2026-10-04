import test from 'node:test';
import assert from 'node:assert/strict';
import { projects, moments } from '../content/site.mjs';
import { renderPage } from '../src/pages.mjs';

test('real projects appended after unfilled slots appear in the annual recap',()=>{
  projects.push({...projects[0],id:'real-demo',title:'校园开放地图',description:'真实作品的测试资料'});
  try {
    for(const route of ['/','/minicamp/','/projects/']){
      assert.match(renderPage(route),/校园开放地图/);
      assert.doesNotMatch(renderPage(route),/首届作品资料待补充/);
    }
  } finally { projects.pop(); }
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
