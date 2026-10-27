// 帖子的 Markdown 渲染：一处实现，页面模板与接口预览共用。
//
// 放在 src/ 而不是 backend/ 的原因：它产出的是最终插入页面的 HTML，和模板属于同一层；
// 而 backend/forum/ 要引用页面模板，把渲染器留在 backend 就会让两边互相 import。
//
// 三道闸都不在 HTML 字符串上做：html:false 把原文 HTML 转义成文本，core 规则丢掉白名单外的标签，
// 链接与图片由 renderer 规则重写属性。输出始终由 markdown-it 自己生成，所以结构一定合法。
import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({html: false, linkify: false, typographer: false, breaks: true});

/** 本站图片地址。正文里只认这种形态，外链图片一律不渲染。 */
export const forumImagePath = /^\/api\/forum\/images\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/;

// 渲染结果里允许出现的标签，与 markdown-it 默认预设能产出的标签一一对应。
// 这一层替代原先 sanitize-html 的 allowedTags：html:false 已经把原文 HTML 转义成文本，这里再兜一层，
// 防的是「以后有人改配置、加插件、升级引入新语法」时标签悄悄扩散。
// 判据用 token.tag（markdown-it 在这里存真实标签名：paragraph_open → p、fence → code），不是 token.type。
const allowedTags = new Set(['p', 'br', 'strong', 'em', 's', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'pre', 'code', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);
const escapeHtml = markdown.utils.escapeHtml;
const LINK_REL = 'nofollow ugc noopener noreferrer';
const schemes = new Set(['http', 'https', 'mailto']);

/** 丢掉白名单外的标签 token（成对丢弃，inline 的 children 也要过一遍）。 */
const keepAllowed = tokens => tokens.filter(token => {
  const tag = String(token.tag || '').toLowerCase();
  return !tag || allowedTags.has(tag);
});

markdown.core.ruler.push('tag_allowlist', state => {
  state.tokens = keepAllowed(state.tokens);
  for(const token of state.tokens)
    if(token.children)
      token.children = keepAllowed(token.children);
});

// 围栏代码块的语言名只留严格合法的标识符，别让它把任意字符串带进 class 属性。
markdown.core.ruler.push('fence_language', state => {
  for(const token of state.tokens)
    if(token.type === 'fence')
      token.info = /^[a-z0-9+#._-]{1,24}$/i.test(token.info.trim())? token.info.trim(): '';
});

/**
 * 校验链接目标，判据与 backend/api.mjs 的 safeNext() 一致：只放行 http/https/mailto、站内锚点和相对路径。
 * @param {unknown} value markdown 解析出的 href。
 * @returns {string} 可用的 href；不安全时返回空串（标签保留，只丢掉属性）。
 */
function safeHref(value){
  const href = String(value ?? '').trim();
  if(!href || href.length > 2000)
    return '';
  if(/[\\\u0000-\u001f\u007f\s]/.test(href))
    return '';                                    // 反斜杠、控制字符、空白一律拒绝
  if(href.startsWith('//'))
    return '';                                    // 协议相对地址等于外站
  if(href.startsWith('#'))
    return href;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href);
  if(scheme && !schemes.has(scheme[1].toLowerCase()))
    return '';
  return href;
}

// 属性集整体重写：只留 href 与 rel，title 之类的装饰属性不再透传。
markdown.renderer.rules.link_open = (tokens, index) => {
  const href = safeHref(tokens[index].attrGet('href'));
  return href? `<a href="${escapeHtml(href)}" rel="${LINK_REL}">`: `<a rel="${LINK_REL}">`;
};

// 图片只认本站上传过的地址，且正文页要显式开启；渲染不了就退回 alt 文本，不静默吞掉用户写的内容。
markdown.renderer.rules.image = (tokens, index, options, env) => {
  const token = tokens[index];
  const src = token.attrGet('src') || '';
  const alt = token.content || '';
  if(!(env && env.images === true) || !forumImagePath.test(src))
    return escapeHtml(alt);
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" />`;
};

/**
 * 摘出正文里引用到的图片地址（发帖时校验"是不是自己的草稿图"）。
 * @param {string} value markdown 原文。
 * @returns {string[]} 图片地址列表（允许重复，调用方去重）。
 */
export function postImageSources(value){
  const sources = [];
  const visit = tokens => {
    for(const token of tokens){
      if(token.type === 'image')
        sources.push(token.attrGet('src'));
      if(token.children)
        visit(token.children);
    }
  };
  visit(markdown.parse(String(value), {}));
  return sources;
}

/**
 * 把帖子正文渲染成安全的 HTML。
 *
 * 三道闸都不在 HTML 字符串上做：`html:false` 把原文 HTML 转义成文本，core 规则丢掉白名单外的标签，
 * 链接与图片由 renderer 规则重写属性。输出始终由 markdown-it 自己生成，所以结构一定合法。
 * @param {string} [value] markdown 原文。
 * @param {{images?: boolean}} [options] images 为 true 时才渲染本站上传的图片。
 * @returns {string} 可直接插入页面的 HTML。
 */
export function renderMarkdown(value = '', {images = false} = {}){
  return markdown.render(String(value), {images: images === true});
}
