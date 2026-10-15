import {readFileSync} from 'node:fs';

// 所有实际资料都在这里维护。图片放在 public/images/，路径填 /images/文件名。
export const site = {
  name: 'NanoCamp',
  // 正式域名，用于 canonical、Open Graph、结构化数据、sitemap.xml 与 robots.txt。
  // 部署到别的地址时不要改这里，而是在本实例的 data/config.json 里写 url 覆盖。
  url: 'https://nanocamp.club/',
  slogan: 'Meet. Build. Make something together.',
  chineseSlogan: '让有趣的人相遇，让相遇的人一起创造。',
  description: 'NanoCamp 是一个面向跨专业学生的创造者社区。从 minicamp 黑客松开始，让有趣的人相遇，一起把想法做出来。',
  logo: '/images/nanocamp-wordmark.png',
  symbol: '/images/nanocamp-symbol.png',
  // 原图保留不变，以下矩形只控制网页显示范围：[x, y, 宽, 高, 原图宽]。
  logoCrop: [48, 438, 1170, 290, 1254],
  signatureCrop: [48, 438, 1170, 355, 1254],
  join: { qrCode: null, contact: null, contactLabel: '联系社区', description: '和有好奇心的伙伴，一起开始。' },
};

export const event = {
  title: 'minicamp 2026',
  edition: '01',
  officialUrl: 'https://minicamp.flipperusc.work/',
  date: '2026 年 9 月 26–27 日',
  location: '中南大学潇湘校区 外语楼 635',
  theme: ['Build for Humans', 'Reimagine Campus', 'Create the Unexpected'],
  status: '已结束 · 可回顾',
  intro: '两天里，我们从擦肩而过的陌生人，变成坐在一起、为同一件事忙碌的伙伴；也把心里尚未成形的念头，做成了一个可以打开、可以分享的作品。',
  summary: [
    '2026 年 9 月 26 日，来自不同专业的同学陆续走进潇湘校区外语楼 635。有人带着一个尚未成形的想法，有人带着一项愿意分享的本领，也有人只是抱着“先来看看”的心情。两天时间，约九十个人在这里相遇，这场由三个社团联合发起的首届 minicamp，便从一句自我介绍、一次点头回应开始了。',
    '现场没有人要求你一开始就准备好答案。有人在白板前一遍遍推敲方案，有人守着屏幕调试到深夜，也有人在关键时刻递来一句提醒、一道思路，或是一杯让人重新振作的水。原本互不相识的人，就这样在一次次商量和并肩忙碌里熟悉起来，渐渐有了共同要完成的事情。',
    '最后呈现出来的，有网站、App、小程序、游戏，也有硬件和数据项目。它们未必已经圆满，却都留下了亲手做过的痕迹。活动会结束，但那两天认识的人、尚未完成的事情，以及“下次还想一起做点什么”的念头，还会沿着各自的生活继续向前。',
  ],
  cover: '/images/minicamp-group-photo.jpg',
  coverFull: '/images/minicamp-group-photo.jpg',
  coverAlt: 'minicamp 2026 活动结束合照',
};

// 作品数据放在 content/minicamp2026.json 里维护 —— 用 JSON 而不是源码，改内容不用碰代码。
// 该文件由 scripts/sync-minicamp-projects.mjs 从 minicamp 官方接口整理，人工核对后写入。
// slug 决定详情页地址 /projects/<slug>/，填写后应尽量保持稳定；缺失字段保持 null，
// 页面会显示「待补充」而不是编造内容。外部地址必须是完整 http 或 https。
const minicamp2026 = JSON.parse(readFileSync(new URL('./minicamp2026.json', import.meta.url), 'utf8'));
const rawProjects = minicamp2026.projects;

// 统一为每条作品补上「分类」维度：minicamp 作品默认归 'minicamp'，
// 社区作品 / 成员个人作品后续从 communityProjects / personalProjects 取数（见下）。
export const projects = rawProjects.map(project => ({ ...project, category: project.category || 'minicamp' }));

// 社区作品与成员个人作品：当前暂无数据，先占位，后续从对应渠道填充。
// 二者与 minicamp 作品共用同一套卡片 / 详情渲染。
export const communityProjects = [];
export const personalProjects = [];

// Published on the official minicamp activity site. These entries stay scoped to the annual recap.
export const featuredProjects = minicamp2026.featuredProjectIds.map(id => projects.find(project => project.id === id)).filter(Boolean);

export const moments = [
  { id: '01', src: '/images/minicamp-group-photo.jpg', alt: 'minicamp 2026 活动结束合照', caption: '活动结束合照', theme: 'blue' },
  { id: '02', src: null, alt: 'minicamp 共创现场', caption: '一起动手的时候', theme: 'orange' },
  { id: '03', src: null, alt: 'minicamp 作品展示', caption: '想法被看见', theme: 'mint' },
  { id: '04', src: null, alt: 'minicamp 交流现场', caption: '新的连接', theme: 'sand' },
];
