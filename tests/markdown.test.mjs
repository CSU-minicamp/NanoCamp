import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMarkdown,postImageSources} from '../src/markdown.mjs';

const IMAGE='/api/forum/images/123e4567-e89b-12d3-a456-426614174000';
// 与 src/markdown.mjs 的 allowedTags 保持同步：渲染结果里出现别的标签就算失守。
const allowedTags=['p','br','strong','em','s','blockquote','ul','ol','li','h1','h2','h3','h4','h5','h6','hr','pre','code','a','img','table','thead','tbody','tr','th','td'];

test('原文 HTML 一律转义成文本，不存在标签注入',()=>{
  const html=renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<b onclick="x">hi</b>');
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('&lt;b'));
});

test('危险协议不会被渲染成链接',()=>{
  for(const source of ['[x](javascript:alert(1))','[x](JaVaScRiPt:alert(1))','[x](&#106;avascript:alert(1))','[x](data:text/html,<b>)','[x](vbscript:msgbox)']){
    const html=renderMarkdown(source);
    assert.ok(!/<a [^>]*href/i.test(html),source);
  }
});

test('协议相对地址保留标签但去掉 href',()=>{
  assert.equal(renderMarkdown('[x](//evil.test/a)'),'<p><a rel="nofollow ugc noopener noreferrer">x</a></p>\n');
});

test('站内相对路径、锚点与 mailto 保留，外部链接带 rel 且丢掉 title',()=>{
  assert.match(renderMarkdown('[x](/forum/topics/1/)'),/<a href="\/forum\/topics\/1\/" rel="nofollow ugc noopener noreferrer">/);
  assert.match(renderMarkdown('[x](#reply-3)'),/<a href="#reply-3" rel=/);
  assert.match(renderMarkdown('[x](mailto:a@b.test)'),/<a href="mailto:a@b.test" rel=/);
  const html=renderMarkdown('[x](https://a.test "标题")');
  assert.match(html,/<a href="https:\/\/a.test" rel="nofollow ugc noopener noreferrer">/);
  assert.ok(!html.includes('title='));
});

test('外站图片退回 alt 文本，任何情况下都不产生 img',()=>{
  for(const source of ['![外站图](https://x.test/a.png)','![协议相对](//x.test/a.png)','![假站内路径](/api/forum/images/not-a-uuid.png)']){
    for(const images of [false,true]){
      const html=renderMarkdown(source,{images});
      assert.ok(!html.includes('<img'),source);
    }
  }
  assert.equal(renderMarkdown('![外站图](https://x.test/a.png)',{images:true}),'<p>外站图</p>\n');
});

test('站内图片只在 images:true 时渲染，且带惰性加载属性',()=>{
  assert.equal(renderMarkdown(`![站内图](${IMAGE})`),'<p>站内图</p>\n');
  const html=renderMarkdown(`![站内图](${IMAGE})`,{images:true});
  assert.match(html,/<img src="\/api\/forum\/images\/123e4567-e89b-12d3-a456-426614174000" alt="站内图" loading="lazy" decoding="async" \/>/);
});

test('围栏代码块的语言名只能是合法标识符',()=>{
  assert.match(renderMarkdown('~~~js\nx\n~~~'),/<code class="language-js">/);
  assert.match(renderMarkdown('~~~c++\nx\n~~~'),/<code class="language-c\+\+">/);
  const weird=renderMarkdown('~~~js" onmouseover=alert(1)\nx\n~~~');
  assert.ok(!weird.includes('onmouseover'));
  assert.match(weird,/<code>x\n<\/code>/);
});

test('表格、列表、引用、删除线与一到六级标题都能渲染',()=>{
  assert.match(renderMarkdown('|a|b|\n|-|-|\n|1|2|'),/<td>1<\/td>/);
  assert.match(renderMarkdown('- a\n  - b'),/<ul>\n<li>a\n<ul>\n<li>b<\/li>/);
  assert.match(renderMarkdown('> 引用'),/<blockquote>\n<p>引用<\/p>/);
  assert.match(renderMarkdown('~~x~~'),/<s>x<\/s>/);
  for(const level of [1,2,3,4,5,6]){
    const html=renderMarkdown(`${'#'.repeat(level)} 标题`);
    assert.match(html,new RegExp(`<h${level}>标题</h${level}>`),`h${level}`);
  }
});

test('渲染结果里只出现白名单内的标签',()=>{
  const corpus=[
    '<script>alert(1)</script>','![a](https://x.test/a.png)',`![b](${IMAGE})`,'[x](javascript:alert(1))','[x](//e.test)',
    '|a|b|\n|-|-|\n|<b>1</b>|2|','~~~js\n<img onerror=1>\n~~~','###### 六级','---','> 引用\n> 两行','1. a\n2. b','**粗** _斜_ ~~删~~'
  ];
  for(const source of corpus){
    for(const images of [false,true]){
      const html=renderMarkdown(source,{images});
      for(const [,tag] of html.matchAll(/<([a-z][a-z0-9]*)/gi))
        assert.ok(allowedTags.includes(tag.toLowerCase()),`${tag} 出现在渲染结果里：${source}`);
    }
  }
});

test('postImageSources 从 token 里取图片地址，不受是否渲染影响',()=>{
  assert.deepEqual(postImageSources(`![a](${IMAGE})`),[IMAGE]);
  assert.deepEqual(postImageSources('![b](https://x.test/b.png)'),['https://x.test/b.png']);
  assert.deepEqual(postImageSources(`文字 ![a](${IMAGE}) 与 [链接](https://x.test)`),[IMAGE]);
  assert.deepEqual(postImageSources('没有图片'),[]);
});
