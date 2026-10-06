import test from 'node:test';
import assert from 'node:assert/strict';
import { projects, moments } from '../content/site.mjs';
import { renderPage } from '../src/pages.mjs';

test('a filled-in project appears in the catalogue and the annual recap',()=>{
  projects.push({...projects[0],id:'real-demo',slug:'real-demo',title:'校园开放地图',description:'真实作品的测试资料'});
  try {
    for(const route of ['/','/minicamp/','/projects/']){
      assert.doesNotMatch(renderPage(route),/首届作品，待补充/);
    }
    assert.match(renderPage('/projects/'),/校园开放地图/);
    assert.match(renderPage('/projects/'),/href="\/projects\/real-demo\/"/);
  } finally { projects.pop(); }
});

test('project detail paths keep only URL-safe characters',async()=>{
  const { projectPath } = await import('../src/projects.mjs');
  assert.equal(projectPath({ id:'07', slug:'校园 Open Map' }),'/projects/open-map/');
  assert.equal(projectPath({ id:'演示/42', slug:null }),'/projects/project-42/');
  assert.equal(projectPath({ id:'<script>', slug:'..' }),'/projects/project-script/');
});

test('a filled-in project card links to its own detail page and rejects unsafe links',async()=>{
  const { projects } = await import('../content/site.mjs');
  const { projectCard, projectPath } = await import('../src/projects.mjs');
  const original={...projects[0]};
  try {
    Object.assign(projects[0],{title:'校园开放地图',slug:'campus-open-map',tools:['React','Mapbox']});
    assert.equal(projectPath(projects[0]),'/projects/campus-open-map/');
    const html=projectCard(projects[0]);
    assert.match(html,/<h3><a href="\/projects\/campus-open-map\/">校园开放地图<\/a><\/h3>/);
    assert.match(html,/React/);
    assert.doesNotMatch(projectCard({...projects[0],repoUrl:'javascript:alert(1)'}),/javascript:/);
  } finally { Object.assign(projects[0],original); }
});

// 作品数据来自 minicamp 接口，字段必须保持一致，否则列表页与详情页会出现空块。
test('every migrated minicamp project keeps a uniform field shape',async()=>{
  const { projectPath } = await import('../src/projects.mjs');
  const paths=new Set();
  for(const project of projects){
    assert.match(project.id,/^\d{2}$/,`作品 ${project.title} 的编号应为两位数字`);
    assert.ok(project.title?.trim(),'作品必须有名称');
    assert.ok(project.description?.trim(),`作品 ${project.title} 缺少一句话简介`);
    assert.ok(Array.isArray(project.tools),`作品 ${project.title} 的 tools 必须是数组`);
    assert.ok(Array.isArray(project.members),`作品 ${project.title} 的 members 必须是数组`);
    assert.ok(project.members.every(member=>typeof member?.name==='string'),`作品 ${project.title} 的成员缺少姓名`);
    for(const key of ['cover','coverFull','repoUrl','demoUrl']){
      if(project[key]===null||project[key]===undefined) continue;
      assert.match(project[key],key==='cover'||key==='coverFull'?/^\/images\//:/^https?:\/\//,`作品 ${project.title} 的 ${key} 不是合法地址`);
    }
    const path=projectPath(project);
    assert.doesNotMatch(path,/[^a-z0-9/-]/,'详情页地址只能包含小写字母、数字与短横线');
    assert.ok(!paths.has(path),`详情页地址重复：${path}`);
    paths.add(path);
  }
});

test('photos can be published before projects without contradictory empty states',()=>{
  const original=moments[0].src;
  const listed=projects.splice(0,projects.length);
  try {
    moments[0].src='/images/real-event-photo.jpg';
    const html=renderPage('/');
    // 首页不再展示现场相册（.moments-grid 已移除），但文案不能和已发布的照片互相矛盾。
    assert.doesNotMatch(html,/moments-grid/);
    assert.match(html,/一起回看 2026 届 minicamp 的现场瞬间。/);
    assert.doesNotMatch(html,/2026 届活动照片待补充/);
    assert.match(html,/作品介绍与 Demo 链接待补充/);
  } finally { moments[0].src=original; projects.push(...listed); }
});

test('minicamp page keeps confirmed event content and omits footer utility controls',()=>{
  const html=renderPage('/minicamp/');
  assert.match(html,/2026 年 9 月 26–27 日/);
  assert.match(html,/中南大学潇湘校区 外语楼 635/);
  assert.match(html,/minicamp-group-photo\.jpg/);
  assert.match(html,/<h2 id="camp-projects-title">2026 届优秀作品<\/h2>/);
  assert.match(html,/收藏夹不吃灰计划|Build to Taste|中国龙能飞/);
  assert.match(html,/event-theme-list/);
  assert.doesNotMatch(html,/先读一份 Demo 指南|回到顶部|back-to-top|暂停全站动效|复制页面链接|data-site-motion-toggle|data-share-page/);
  assert.doesNotMatch(html,/加入渠道尚未公布，可先阅读参与指南。/);
});

test('minicamp page links to the official activity site',()=>{
  const html=renderPage('/minicamp/');
  assert.match(html,/href="https:\/\/minicamp\.flipperusc\.work\/"/);
  assert.match(html,/target="_blank" rel="noopener noreferrer"/);
  assert.match(html,/进入 minicamp 活动官网/);
});
