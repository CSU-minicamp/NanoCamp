// 论坛相关文件的语法自检（`npm run forum:test` 会先跑它）。
//
// 这里只列"改论坛时一定会碰"的文件：后端五块（community / dm / forum 四件）、页面模板、
// 前端脚本、以及那几个运维脚本。语法错的话先在这里报出来，比等到启动时才炸更省时间。
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const files = [
  // 后端：社区公共层 → 私信 → 论坛（写/读/图片/路由）→ 头像
  'backend/forum/base.mjs',
  'backend/forum/dm.mjs',
  'backend/forum/index.mjs',
  'backend/forum/read.mjs',
  'backend/forum/images.mjs',
  'backend/forum/routes.mjs',
  'backend/avatar/index.mjs',
  'backend/avatar/routes.mjs',
  // 页面模板与渲染
  'src/forum.mjs',
  'src/messages.mjs',
  'src/markdown.mjs',
  'src/account.mjs',
  // 前端脚本
  'public/forum.js',
  'public/forum-nav.js',
  'public/messages.js',
  'public/account.js',
  // 运维脚本
  'scripts/forum-moderate.mjs',
  'scripts/forum-e2e-prepare.mjs',
  'scripts/forum-e2e-verify.mjs',
  'scripts/forum-image-cleanup.mjs',
  // 全部 DDL 都在这一个文件里
  'backend/schema.mjs'
];

for(const file of files)
  execFileSync(process.execPath, ['--check', fileURLToPath(new URL('../' + file, import.meta.url))], {stdio: 'inherit'});
console.log('PASS: forum modules syntax');
