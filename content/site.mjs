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
  title: '首届 minicamp',
  edition: '01',
  date: null,
  location: null,
  theme: null,
  status: '已结束',
  intro: '一场黑客松，是一次相遇的开始。活动告一段落，一起创造的故事还在继续。',
  summary: [],
  cover: null,
};

export const projects = [
  { id: '01', title: '项目名称', description: '关于这个作品的一句话介绍。', cover: null, coverAlt: '', category: null, members: [], introUrl: null, demoUrl: null, theme: 'blue' },
  { id: '02', title: '项目名称', description: '关于这个作品的一句话介绍。', cover: null, coverAlt: '', category: null, members: [], introUrl: null, demoUrl: null, theme: 'orange' },
  { id: '03', title: '项目名称', description: '关于这个作品的一句话介绍。', cover: null, coverAlt: '', category: null, members: [], introUrl: null, demoUrl: null, theme: 'mint' },
];

export const moments = [
  { id: '01', src: null, alt: 'minicamp 活动现场', caption: '相遇的瞬间', theme: 'blue' },
  { id: '02', src: null, alt: 'minicamp 共创现场', caption: '一起动手的时候', theme: 'orange' },
  { id: '03', src: null, alt: 'minicamp 作品展示', caption: '想法被看见', theme: 'mint' },
  { id: '04', src: null, alt: 'minicamp 交流现场', caption: '新的连接', theme: 'sand' },
];
