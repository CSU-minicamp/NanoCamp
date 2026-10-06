import { mkdir, writeFile, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { routePaths, renderPage, renderNotFound } from '../src/pages.mjs';
import { renderIntroPage } from '../src/intro.mjs';
import { guides } from '../content/guides.mjs';
import { canonicalUrl } from '../src/metadata.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
await mkdir(output, { recursive: true });
for (const route of routePaths) {
  const dir = path.join(output, route);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), renderPage(route), 'utf8');
}
// 首页首屏的海报是独立文档，但不属于站点路由：不进 sitemap、不进搜索索引。
await mkdir(path.join(output, 'intro'), { recursive: true });
await writeFile(path.join(output, 'intro', 'index.html'), renderIntroPage(), 'utf8');
await cp(path.join(root, 'public'), output, { recursive: true });
await mkdir(path.join(output, 'downloads'), { recursive: true });
for (const guide of guides) {
  await writeFile(path.join(output, 'downloads', `${guide.slug}-template.txt`), '\uFEFF' + guide.template + '\n\nNanoCamp 共创指南\n', 'utf8');
}
await writeFile(path.join(output, '404.html'), renderNotFound(), 'utf8');
const xml = value => String(value).replace(/[&<>"']/g, char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${routePaths.filter(route => route !== '/search/').map(route => `  <url><loc>${xml(canonicalUrl(route))}</loc></url>`).join('\n')}\n</urlset>\n`;
await writeFile(path.join(output, 'sitemap.xml'), sitemap, 'utf8');
await writeFile(path.join(output, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${canonicalUrl('/sitemap.xml')}\n`, 'utf8');
console.log(`Built ${routePaths.length} NanoCamp pages in ${output}`);
