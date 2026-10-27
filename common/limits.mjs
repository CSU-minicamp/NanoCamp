// 跨层共用的上限值。后端用它校验，模板用它渲染计数器和 maxlength，
// 浏览器端再通过模板写进 HTML 的 data-* 读取 —— 因此每项只有这一处默认值。
//
// 论坛帖子的长度（标题 4–80、正文 10–15000、回复 1–3000、私信 1–2000）暂时仍写在
// backend/forum/ 里：它们只在后端用，模板不渲染对应计数，等真需要时再搬。

/** 昵称最多几个字符（按码点，一个 emoji 算 1）。 */
export const NICKNAME_MAX = 24;

/** 一句话介绍最多几个字符。 */
export const BIO_MAX = 160;

/** 密码长度下限（字符）。 */
export const PASSWORD_MIN = 8;

/** 密码长度上限（字符）。 */
export const PASSWORD_MAX = 72;

/** 头像原图大小上限：2 MB（压缩后固定 256×256 WebP）。 */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
