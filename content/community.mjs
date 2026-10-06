export const communityFounders = [
  { name: 'InnOSeed lab', image: '/images/community-founders/innoseed.png', mark: 'innoseed', width: 500, height: 500 },
  { name: '小米实验室', image: '/images/community-founders/xiaomi-source.png', mark: 'xiaomi', width: 1000, height: 647 },
  { name: '华为智能基座', image: '/images/community-founders/huawei.jpg', mark: 'huawei', width: 627, height: 589 },
];
export const communityChannels = [
  { name: '抖音', account: 'NanoCamp', label: '抖音号', id: '32909058309', href: 'https://www.douyin.com/user/MS4wLjABAAAATk819gTiNcRVjSH_Jkgwv9HM1GYXDsx60geCRl_pTSxQNzb2RYFhIhsf6vIaNhtt' },
  { name: '小红书', account: 'NanoCamp', label: '小红书号', id: '95929963754', href: 'https://www.xiaohongshu.com/user/profile/6ab796c80000000013032803' },
  { name: 'B站', account: 'NanoCamp', label: 'UID', id: '3632309624376033', href: 'https://space.bilibili.com/3632309624376033' },
];
export const communityContact = { name: 'NanoCamp', qq: '3675906985' };

export const programs = [
  { id: 'minicamp', category: 'hackathon', label: '年度黑客松', name: 'minicamp', en: 'THE ANNUAL CAMP', tone: 'blue', icon: 'camp', status: '首届已结束', description: '一年一度，把好奇心带到同一个现场。组队、尝试、做出原型，让想法拥有第一次被看见的机会。', tags: ['跨专业组队', '动手创造', '作品展示'], href: '/minicamp/', action: '回看首届 minicamp' },
  { id: 'sharing', category: 'sharing', label: '技术交流', name: '分享一点新发现', en: 'PASS IT ON', tone: 'mint', icon: 'talk', status: '全年社区方向', description: '一个工具、一次踩坑、一段探索。把自己的发现讲给伙伴听，也从别人的经验里找到下一步。', tags: ['技术分享', '学习交流', '经验复盘'], href: '/community/#share', action: '了解如何发起分享' },
  { id: 'building', category: 'building', label: '日常共创', name: '一起做个小实验', en: 'MAKE A LITTLE PROGRESS', tone: 'lilac', icon: 'build', status: '全年社区方向', description: '给一个小问题留出专注的时间。找伙伴、拆任务、做一个能体验的版本，让创造融入日常。', tags: ['共创工作坊', '项目讨论', 'Demo 交流'], href: '/community/#build', action: '找到共创的起点' },
  { id: 'exchange', category: 'exchange', label: '校企交流', name: '让连接走得更远', en: 'OPEN NEW DOORS', tone: 'amber', icon: 'connect', status: '全年社区方向', description: '连接校园里的不同社群，与企业和实践者交换问题、经验与视角，一起探索真实世界的可能。', tags: ['校园联动', '行业对话', '实践交流'], href: '/partners/', action: '了解交流方向' },
];
export const faqCategories = [
  ['all', '全部问题'], ['community', '认识社区'], ['events', '活动参与'], ['projects', '作品与共创'], ['collaboration', '交流合作'],
];
export const faqs = [
  { id: 'what-is-nanocamp', category: 'community', question: 'NanoCamp 和 minicamp 是什么关系？', answer: 'NanoCamp 是面向学生的创造者社区；minicamp 是社区一年一度的黑客松。我们从首届 minicamp 出发，希望把活动现场的相遇延续为全年的分享、共创和交流。', href: '/about/', link: '认识 NanoCamp' },
  { id: 'who-can-join', category: 'community', question: '只有计算机专业的学生才能参与吗？', answer: '不限专业。我们欢迎代码、设计、产品、艺术，以及各种不同的兴趣。你可以带着问题来，也可以带着一个还不完整的想法来。具体活动若有参与范围或准备要求，会在活动说明中单独写明。', href: '/community/', link: '看看适合你的参与方式' },
  { id: 'starting-from-zero', category: 'community', question: '没有经验、没有作品，可以从哪里开始？', answer: '先从一次交流、一个问题或一个小任务开始。介绍一下你正在好奇的事、愿意尝试的方向和可投入的时间；在共创中边做边学，也可以从记录、调研、设计或展示开始贡献。', href: '/community/#start', link: '查看第一次参与指南' },
  { id: 'join-channel', category: 'community', question: '在哪里加入社区、获取后续消息？', answer: '社区页的「联系我们」提供 QQ 联系方式，搜索号码并添加好友即可发起交流。「关注社区动态」整理了抖音、小红书与 B站账号；活动总览会整理已确认的活动信息。', href: '/community/#contact', link: '查看联系方式' },
  { id: 'next-minicamp', category: 'events', question: '下一届 minicamp 什么时候开始？现在能报名吗？', answer: '首届 minicamp 已结束。下一届的时间、地点、参与规则与报名方式尚未公布，当前没有开放的报名入口。确认后会在官网活动页面更新。', href: '/minicamp/', link: '回看首届 minicamp' },
  { id: 'year-round', category: 'events', question: '除了年度黑客松，社区还会做什么？', answer: '技术交流分享、日常共创，以及与其他学校、企业的交流，是 NanoCamp 的全年社区方向。活动总览中的介绍说明这些形式；实际场次、时间与参与方式以之后的活动公告为准。', href: '/activities/#formats', link: '探索活动形式' },
  { id: 'team-and-preparation', category: 'events', question: '要先组好队伍、准备成熟的点子吗？', answer: '认识伙伴本身就是社区参与的一部分。可以先整理自己的兴趣、技能和一个想探索的问题，再寻找互补的伙伴。具体黑客松是否接受个人报名、组队规模及准备要求，以该届规则为准。' },
  { id: 'event-costs', category: 'events', question: '活动是否收费，是否提供交通和住宿？', answer: '这些安排需要按每场活动分别确认。当前官网尚未公布下一届的费用、交通或住宿政策，不能默认免费或提供补助；正式公告会列明已确认的支持与需要自行安排的部分。' },
  { id: 'project-showcase', category: 'projects', question: '作品展示可以包含哪些内容？', answer: '一个便于理解的作品介绍，通常包括：想解决的问题、目标使用者、核心体验、团队贡献与下一步。可以附上演示链接、Demo、代码仓库或设计稿；未完成的探索也可以坦诚说明当前进度。', href: '/projects/', link: '浏览作品空间' },
  { id: 'host-a-session', category: 'projects', question: '我想发起分享或共创，先准备什么？', answer: '准备一个清楚的小主题：你想分享或探索什么、适合谁、大家需要提前准备什么、预计用多久，以及希望参与者带走什么。无需包装成完整课程，一次具体的经验也值得分享。', href: '/resources/host-a-sharing/', link: '阅读轻量分享指南' },
  { id: 'collaborate', category: 'collaboration', question: '学校社团或企业可以怎样与 NanoCamp 交流？', answer: '可以从技术分享、校园联合交流、真实问题讨论、实践经验介绍等具体形式开始。先说明双方期待、参与人群、所需支持和大致时间，再共同确认合适的范围。官网目前没有公布已确认的合作伙伴名单。', href: '/partners/', link: '了解交流合作方向' },
  { id: 'sharing-etiquette', category: 'collaboration', question: '分享作品、代码和现场照片时要注意什么？', answer: '尊重创作者与参与者。注明引用和团队贡献，先征得同意再公开他人的照片、联系方式或未发布的作品；涉及第三方素材时遵循其授权条件。对作品给出具体、友善的反馈，把讨论聚焦在问题与改进上。', href: '/community/#principles', link: '阅读我们的共创约定' },
];
