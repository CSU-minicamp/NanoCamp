// 钉住 backend/forum 内部的依赖方向。
//
// 头注释里画的图（index.mjs 顶部）是给人看的，这里把它变成断言 —— 否则改一次 import
// 图就悄悄过期了（2026-10-29 就是这样：注释说 index 认识 dm，实际上 index 根本没 import 它）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const DIR = new URL('../backend/forum/', import.meta.url);

/** 允许的同目录边：谁可以 import 谁。`routes.mjs` 是唯一的组装层，所以只有它能指向全部。 */
const ALLOWED = {
  'base.mjs': [],
  'dm.mjs': ['base.mjs'],
  'index.mjs': ['base.mjs'],
  'read.mjs': ['base.mjs', 'index.mjs'],
  'images.mjs': ['base.mjs', 'index.mjs'],
  'routes.mjs': ['base.mjs', 'dm.mjs', 'index.mjs', 'read.mjs', 'images.mjs']
};

/** 一个文件里所有 `from './x.mjs'` 的同目录依赖。 */
function localImports(file){
  const source = readFileSync(new URL(file, DIR), 'utf8');
  return [...source.matchAll(/from '\.\/([\w-]+\.mjs)'/g)].map(match => match[1]);
}

test('forum 内部只允许「往下」的依赖，没有环', () => {
  for(const [file, allowed] of Object.entries(ALLOWED)){
    const actual = localImports(file);
    for(const dependency of actual)
      assert.ok(ALLOWED[dependency], `${file} 依赖了不认识的 ${dependency}`);
    const extra = actual.filter(dependency => !allowed.includes(dependency));
    assert.deepEqual(extra, [], `${file} 不该 import ${extra.join(', ')}`);
  }
});

test('dm 与论坛写路径互不相识：base 是它们之间唯一的共同依赖', () => {
  // 私信只用 base 的成员校验；论坛的写路径也不读私信。真正的「论坛 → 私信」只在 routes.mjs。
  assert.deepEqual(localImports('dm.mjs'), ['base.mjs']);
  assert.ok(!localImports('index.mjs').includes('dm.mjs'), 'index.mjs 不该 import dm.mjs');
  assert.ok(localImports('routes.mjs').includes('dm.mjs'), '消息页在 routes.mjs，那里才该 import dm');
});

test('read / images 依赖 index，index 不反向依赖它们', () => {
  for(const file of ['read.mjs', 'images.mjs']){
    assert.ok(localImports(file).includes('index.mjs'), `${file} 需要 index 的投票/限流原语`);
    assert.ok(!localImports('index.mjs').includes(file), `index.mjs 不该 import ${file}`);
  }
});
