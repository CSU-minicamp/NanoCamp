// 从 minicamp 官方接口同步「已发布」作品，整理成 NanoCamp 作品页的数据。
// 用法：
//   node scripts/sync-minicamp-projects.mjs                 只打印整理结果（默认，不改动任何文件）
//   node scripts/sync-minicamp-projects.mjs --write-images   额外把封面导出到 public/images/projects/
//   API=https://minicamp.flipperusc.work node scripts/sync-minicamp-projects.mjs
//
// 约定：只搬运接口里真实存在的字段，缺失字段一律留 null（页面显示「待补充」），不做编造。
// 输出的 JS 片段需要人工核对后粘贴进 content/site.mjs 的 projects 数组。

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const api = process.env.API || 'https://minicamp.flipperusc.work';
const writeImages = process.argv.includes('--write-images');
const imageDir = path.join(root, 'public', 'images', 'projects');

const slugify = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const clean = value => String(value ?? '').trim() || null;
const isHttp = value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } };
// aiTools 是人工填写的自由文本，分隔符混用了中英文逗号、顿号、分号和 &&。
const splitTools = value => (Array.isArray(value) ? value : [value]).flatMap(item => String(item ?? '').split(/[,，、;；]+|\s*&&\s*|\s*以及\s*|\s*\/\s*/)).map(item => item.trim()).filter(Boolean);

// 同一个工具在上游被写成 Codex / codex / CODEX 等多种形式，统一成一种写法，避免标签重复。
// 键为小写形式；只做写法归一，不新增或删除工具。
const canonicalTools = {
  codex: 'Codex', claudecode: 'Claude Code', 'claude code': 'Claude Code', claude: 'Claude',
  deepseek: 'DeepSeek', dsh: 'DeepSeek Harness', 'deepseek harness': 'DeepSeek Harness',
  chatgpt: 'ChatGPT', chatgppt: 'ChatGPT', devin: 'Devin', workbuddy: 'WorkBuddy', 'cc switch': 'CC Switch',
};
const canonicalTool = value => {
  const text = String(value ?? '').trim();
  return canonicalTools[text.toLowerCase()] || text;
};
const normalizeTools = value => [...new Set(splitTools(value).map(canonicalTool))];

const themeOrder = ['Build for Humans', 'Reimagine Campus', 'Create the Unexpected'];
const teamNumber = value => Number(String(value ?? '').replace(/\D/g, '')) || Number.MAX_SAFE_INTEGER;

const response = await fetch(`${api}/api/projects`);
if (!response.ok) throw new Error(`接口返回 HTTP ${response.status}`);
const payload = await response.json();

const source = (payload.projects || [])
  .filter(project => project.status === 'published')
  .filter(project => !project.testFixture && !project.team?.testFixture)
  .sort((a, b) => {
    const theme = (themeOrder.indexOf(a.theme) + 1 || themeOrder.length + 1) - (themeOrder.indexOf(b.theme) + 1 || themeOrder.length + 1);
    return theme || teamNumber(a.teamId) - teamNumber(b.teamId) || String(a.id).localeCompare(String(b.id));
  });

const used = new Set();
const entries = source.map((project, index) => {
  const id = String(index + 1).padStart(2, '0');
  const name = clean(project.projectName) || `未命名作品 ${id}`;
  // 中文标题 slugify 后为空，或只剩「app / ai」这类碎片时，回退到稳定的队伍编号式 slug。
  const fromName = slugify(name);
  let slug = fromName.length >= 3 ? fromName : `project-${id}`;
  while (used.has(slug)) slug = `${slug}-${id}`;
  used.add(slug);

  let cover = null;
  const raw = clean(project.coverUrl);
  if (raw?.startsWith('data:image/')) {
    const [, meta, body] = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i) || [];
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[String(meta).toLowerCase()] || 'jpg';
    cover = `/images/projects/${slug}.${extension}`;
    project.__cover = { file: path.join(imageDir, `${slug}.${extension}`), body, mime: meta };
  } else if (raw) {
    cover = isHttp(raw);
  }

  return {
    id, slug, title: name,
    description: clean(project.tagline),
    problem: clean(project.problem),
    solution: clean(project.solution),
    theme: clean(project.theme),
    team: clean(project.teamId),
    tools: normalizeTools(project.aiTools),
    members: (project.members || []).map(member => ({ name: clean(member.name), role: clean(member.role) })).filter(member => member.name),
    repoUrl: isHttp(project.githubUrl),
    demoUrl: isHttp(project.demoUrl),
    cover,
    sourceId: clean(project.id),
    __cover: project.__cover || null,
  };
});

if (writeImages) {
  await mkdir(imageDir, { recursive: true });
  for (const entry of entries.filter(item => item.__cover)) {
    await writeFile(entry.__cover.file, Buffer.from(entry.__cover.body, 'base64'));
    console.log(`封面已导出：${path.relative(root, entry.__cover.file)}`);
  }
}

// problem / solution 里可能带换行，必须转义，否则拼出来的 JS 字面量会断行。
const quote = value => value === null ? 'null' : `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r\n?|\n/g, '\\n').replace(/\t/g, '\\t')}'`;
const block = entries.map(entry => {
  const members = entry.members.map(member => `{ name: ${quote(member.name)}, role: ${quote(member.role)} }`).join(', ');
  const tools = entry.tools.map(quote).join(', ');
  return `  {
    id: ${quote(entry.id)}, slug: ${quote(entry.slug)}, title: ${quote(entry.title)},
    description: ${quote(entry.description)},
    problem: ${quote(entry.problem)}, solution: ${quote(entry.solution)},
    theme: ${quote(entry.theme)}, team: ${quote(entry.team)}, year: '2026', category: 'minicamp',
    tools: [${tools}], members: [${members}],
    cover: ${quote(entry.cover)}, coverAlt: ${quote(`${entry.title} 作品封面`)}, coverFull: null,
    repoUrl: ${quote(entry.repoUrl)}, demoUrl: ${quote(entry.demoUrl)},
    sourceId: ${quote(entry.sourceId)},
  },`;
}).join('\n');

console.log(`\n共 ${entries.length} 条已发布作品（接口原始 ${(payload.projects || []).length} 条）`);
console.log(`有封面 ${entries.filter(e => e.cover).length} · 有 GitHub ${entries.filter(e => e.repoUrl).length} · 有 Demo ${entries.filter(e => e.demoUrl).length}`);
console.log('\n--- 粘贴到 content/site.mjs 的 projects 数组 ---\n');
console.log(block);
