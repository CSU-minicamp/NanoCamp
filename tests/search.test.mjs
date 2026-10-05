import test from 'node:test';
import assert from 'node:assert/strict';
import { searchRecords, searchTerms, excerpt, resultExcerpt } from '../public/search-core.js';
const records = [
  { id:'a',title:'Demo 分享指南',description:'把作品讲清楚',text:'团队与设计',type:'guide',href:'/resources/demo-story/' },
  { id:'b',title:'如何组队',description:'一起准备 Demo 分享',text:'遇见伙伴',type:'faq',href:'/faq/#team' },
  { id:'c',title:'年度 minicamp',description:'学生黑客松，首届已结束',text:'现场照片',type:'event',href:'/minicamp/' },
];
test('normalizes full-width text and collapses repeated search terms',()=>{assert.deepEqual(searchTerms(' ＤＥＭＯ  demo 分享 '),['demo','分享']);});
test('ranks title matches before descriptions while enforcing all terms',()=>{assert.deepEqual(searchRecords(records,'DEMO 分享','all').map(x=>x.id),['a','b']);assert.deepEqual(searchRecords(records,'Demo 设计','all').map(x=>x.id),['a']);});
test('combines category with query and handles empty results',()=>{assert.deepEqual(searchRecords(records,'demo','faq').map(x=>x.id),['b']);assert.equal(searchRecords(records,'不存在','all').length,0);assert.equal(searchRecords(records,'','all').length,3);});
test('ignores unsafe result destinations and malformed records',()=>{const bad=[...records,{id:'x',title:'Demo',text:'',href:'javascript:alert(1)',type:'guide'},{id:'y',title:'Demo',href:'//evil.test',type:'guide'},null];assert.equal(searchRecords(bad,'demo','all').length,2);});
test('treats markup and regex syntax literally',()=>{assert.equal(searchRecords(records,'<img .*','all').length,0);assert.equal(searchRecords(records,'[','all').length,0);});
test('community format labels lead to the relevant activity destination',async()=>{
  const {createSearchIndex}=await import('../src/search.mjs');
  const {pageSummaries}=await import('../src/pages.mjs');
  const found=searchRecords(createSearchIndex(pageSummaries()),'校企交流','event');
  assert.ok(found.some(record=>record.href==='/partners/' && record.id.startsWith('format:')));
});
test('excerpt includes a late match and stays bounded',()=>{const text='前文'.repeat(140)+'独特关键词'+'后文'.repeat(120);const found=excerpt(text,['独特关键词'],120);assert.ok(found.includes('独特关键词'));assert.ok(found.length<=122);assert.equal(excerpt('',[],120),'');});

test('a matching title keeps the useful summary instead of repeating a full template',()=>{
  const item={title:'Demo 分享提纲',description:'带走一份作品介绍与现场演示提纲。',text:'Demo 分享提纲：作品名称、团队成员、项目背景与演示步骤。'};
  assert.equal(resultExcerpt(item,searchTerms('ＤＥＭＯ')),item.description);
});
test('a body-only search term stays visible even when another term matches the title',()=>{
  const item={title:'Demo 分享指南',description:'把作品讲清楚。',text:'前文'.repeat(120)+'把核心体验路径写下来。'+'后文'.repeat(80)};
  const summary=resultExcerpt(item,searchTerms('demo 体验路径'));
  assert.ok(summary.includes('体验路径'));
  assert.ok(summary.length<=102);
});
test('search summaries handle empty descriptions and preserve literal user content',()=>{
  assert.equal(resultExcerpt({title:'指南',text:'<img> 是一段字面说明。'},[]),'<img> 是一段字面说明。');
  assert.equal(resultExcerpt({title:'指南'},[]),'');
});
test('real content enters the search index and inline JSON safely retains literal markup', async()=>{
  const { projects } = await import('../content/site.mjs');
  const { createSearchIndex, searchPage } = await import('../src/search.mjs');
  const { pageSummaries } = await import('../src/pages.mjs');
  const original = {...projects[0]};
  try {
    projects[0].id='演示-42';
    projects[0].title='</script><img src=x onerror=alert(1)> & Demo';
    projects[0].description='这是包含 < 与 > 字符的字面内容。';
    const records=createSearchIndex(pageSummaries());
    const project=records.find(record=>record.id==='project:演示-42');
    assert.ok(project.href.startsWith('/projects/'));
    assert.doesNotMatch(project.href,/[<>"']|\.\./);
    const rendered=searchPage(records);
    const raw=rendered.match(/<script type="application\/json" data-search-index>([\s\S]*?)<\/script>/)[1];
    assert.ok(!raw.includes('<'));
    assert.equal(JSON.parse(raw).find(record=>record.id===project.id).title,projects[0].title);
    assert.ok(!rendered.includes('</script><img src=x'));
  } finally {Object.assign(projects[0],original);}
});
// members 是 {name, role} 对象，直接展开会变成 "[object Object]"，让作品搜索失效。
test('project search text carries real words instead of object placeholders',async()=>{
  const { createSearchIndex } = await import('../src/search.mjs');
  for(const record of createSearchIndex([]).filter(item=>item.type==='project')){
    assert.doesNotMatch(record.text,/\[object Object\]/,`作品 ${record.title} 的搜索文本混入了对象占位符`);
    assert.ok(record.text.trim().length>20,`作品 ${record.title} 的搜索文本过短`);
    assert.ok(record.text.includes(record.title)||record.text.length>0);
  }
});
test('structured metadata serializes literal FAQ content without ending its script',async()=>{
  const {faqs}=await import('../content/community.mjs');
  const {metadata}=await import('../src/metadata.mjs');
  const original=faqs[0].answer;
  try {
    faqs[0].answer='</script><b>按字面显示 & 保留文本</b>';
    const head=metadata({title:'测试',description:'测试',route:'/faq/'});
    const raw=head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    assert.ok(!raw.includes('<'));
    assert.equal(JSON.parse(raw).mainEntity[0].acceptedAnswer.text,faqs[0].answer);
  } finally {faqs[0].answer=original;}
});
