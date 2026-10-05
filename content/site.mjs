// 所有实际资料都在这里维护。图片放在 public/images/，路径填 /images/文件名。
export const site = {
  name: 'NanoCamp',
  url: 'https://nanocamp-community.zjun27256.chatgpt.site/',
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
  intro: '两天时间，现场组队，借助 AI Coding，把想法做成能演示的作品。',
  summary: [
    'minicamp 2026 是中南大学首个三社团联合发起的校园黑客松，面向全校同学开放。活动于 2026 年 9 月 26–27 日在潇湘校区外语楼 635 举行，约有 90 位同学参加。',
    '这里不要求你来自计算机专业，也不要求提前组队或带着完整创意到场。现场公布主题、现场组队，在伙伴、导师和 AI Coding 的帮助下，把一个想法推进到可以演示的版本。',
    '作品可以是网站、App、小程序、游戏、硬件、数据项目或有趣的交互实验。活动结束后，作品仍然可以继续完善，新的连接也会在 NanoCamp 社区里延续。',
  ],
  cover: '/images/minicamp-group-photo.jpg',
  coverFull: '/images/minicamp-group-photo.jpg',
  coverAlt: 'minicamp 2026 活动结束合照',
};

export const projects = [
  { id: '01', title: '项目名称', description: '关于这个作品的一句话介绍。', cover: null, coverAlt: '', category: null, members: [], introUrl: null, demoUrl: null, theme: 'blue' },
  { id: '02', title: '项目名称', description: '关于这个作品的一句话介绍。', cover: null, coverAlt: '', category: null, members: [], introUrl: null, demoUrl: null, theme: 'orange' },
  { id: '03', title: '项目名称', description: '关于这个作品的一句话介绍。', cover: null, coverAlt: '', category: null, members: [], introUrl: null, demoUrl: null, theme: 'mint' },
];

// Published on the official minicamp activity site. These entries stay scoped to the annual recap.
export const featuredProjects = [
  { id: 'TEAM-06', title: '收藏夹不吃灰计划', description: '防止收藏夹里的链接和视频吃灰，让收藏真正回到日常使用中。', cover: null, coverAlt: '收藏夹不吃灰计划作品封面', category: 'Build for Humans', members: ['于政霖', '路和鑫', '刘森', '段旭冉'], introUrl: null, demoUrl: null, theme: 'blue' },
  { id: 'TEAM-04', title: 'Build to Taste：报寝助手 × 麓光', description: '用自动化解决生活部每晚的报寝，用 HD-2D 像素游戏还原中南大学的来路。', cover: null, coverAlt: 'Build to Taste 报寝助手作品封面', category: 'Build for Humans', members: ['罗景涛', '鲍渐', '田鑫源', '郭亿瑞'], introUrl: null, demoUrl: 'https://zhigao.me/#projects', theme: 'mint' },
  { id: 'TEAM-11', title: '中国龙能飞', description: '解决奶龙不会飞的问题，也让传统游戏交互变得更有沉浸感。', cover: null, coverAlt: '中国龙能飞作品封面', category: 'Create the Unexpected', members: ['陈一鸣', '肖子涵', '肖贞怡', '辛俐庆', '古钰蓥'], introUrl: null, demoUrl: 'https://flylong666.netlify.app/', theme: 'orange' },
];

export const moments = [
  { id: '01', src: '/images/minicamp-group-photo.jpg', alt: 'minicamp 2026 活动结束合照', caption: '活动结束合照', theme: 'blue' },
  { id: '02', src: null, alt: 'minicamp 共创现场', caption: '一起动手的时候', theme: 'orange' },
  { id: '03', src: null, alt: 'minicamp 作品展示', caption: '想法被看见', theme: 'mint' },
  { id: '04', src: null, alt: 'minicamp 交流现场', caption: '新的连接', theme: 'sand' },
];
