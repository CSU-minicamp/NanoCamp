// 论坛与私信的「公共设置」：长度、每页条数、限流、图片上限。
//
// 放这里的判据和 limits.mjs 一样 —— 这些值**两侧都要用，而且只能有一份**：
// 后端拿它校验，模板渲染进 HTML（`maxlength` / `data-*`）给浏览器预检。
//
// 不放这里的两类：
//   · 部署配置（`data/config.json` 的 host / db / secret / 邮件）—— 那是部署属性，
//     而且读文件有副作用，会破坏 common「零 import、零副作用」的契约；
//   · 词表与文案（分类名、举报理由、指南正文）—— 那些是内容，在 `content/`。
//
// ⚠️ `public/` 是浏览器端，**不能 import 这个目录**：数字一律由模板渲染进 HTML 再读
// （`data-max` / `maxlength` / 文案），见 common/README.md。

/** 帖子标题（字数，按码点）。 */
export const POST_TITLE_MIN = 4;
export const POST_TITLE_MAX = 80;

/** 帖子正文（字符数）。发布后不可编辑，所以上限给得比较宽。 */
export const POST_BODY_MIN = 10;
export const POST_BODY_MAX = 15000;

/** 回复正文。 */
export const REPLY_MIN = 1;
export const REPLY_MAX = 3000;

/** 私信正文。 */
export const DM_BODY_MIN = 1;
export const DM_BODY_MAX = 2000;

/** 每页条数：列表类（帖子、通知、我的内容、举报、会话）20 条。 */
export const PAGE_SIZE = 20;

/** 帖子详情里的回复一页 30 条。 */
export const REPLY_PAGE_SIZE = 30;

/** 一条私信会话里的消息一页 30 条（往下翻与增量的口径相同）。 */
export const DM_MESSAGE_PAGE = 30;

/** 一个帖子最多挂几张图（前端文案里的数字也是它）。 */
export const POST_IMAGES_MAX = 20;

/** 论坛图片原图上限；超过直接 413，不落对象存储。 */
export const FORUM_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** 草稿图保留几天：发布时只认这段时间内、没挂到帖子上的图。 */
export const FORUM_IMAGE_DRAFT_DAYS = 7;

/** 论坛图片每小时的写入上限（解码前先粗判一次，事务里再权威计数）。 */
export const IMAGE_UPLOAD_PER_HOUR = 20;

/** 私信：一个人一分钟最多几条。 */
export const DM_MESSAGES_PER_MINUTE = 20;

/** 举报：一个人一小时最多几条（帖子/回复与私信各自计数）。 */
export const REPORTS_PER_HOUR = 10;

/** 每个动作每小时的默认上限。`write()` 没列出的动作按 `RATE_LIMIT_DEFAULT` 走。 */
export const RATE_LIMITS = {post_create: 3, reply_create: 20, report: REPORTS_PER_HOUR, image_upload: IMAGE_UPLOAD_PER_HOUR};

/** 兜底上限：投票、收藏、关注这类高频动作。 */
export const RATE_LIMIT_DEFAULT = 120;
