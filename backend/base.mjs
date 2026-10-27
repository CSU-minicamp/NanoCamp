// backend/ 内部共用的基础件，只服务于 backend/ 里的脚本：
//   · escapeHtml —— 转义任意文本，供手写标签输出的地方使用（当前是 sitemap.xml）；
//   · parseCookies / sameOrigin —— HTTP 层的两个小工具，认证接口、头像接口、论坛接口都要用。
//   · 站点资源目录、后缀到 Content-Type 的映射，以及限定在目录内读取文件的辅助函数 —— 站点的唯一文件系统出口。
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {esc} from '../common/text.mjs';

/**
 * 转义文本里会破坏标记结构的五个字符。
 *
 * 五个实体在 HTML 与 XML 里都合法，所以同一份实现可以同时喂给两种输出，其中撇号统一用 &#39。
 *
 * @param {unknown} value 待转义的值，会先转成字符串。
 * @returns {string} 转义后的字符串。
 */
// 转义只有一份实现，在 common/text.mjs（前后端都要用）。这里保留 escapeHtml 这个名字给既有调用方。
export const escapeHtml = esc;

/** 项目根目录（本文件位于 <root>/backend/ 下）。 */
const root = fileURLToPath(new URL('../', import.meta.url));

/** 站点资源目录：URL 路径直接对应 public/ 下的文件。 */
export const assetRoot = path.join(root, 'public');

/** 后缀到 Content-Type 的映射。不在表里的后缀不会被当作静态资源返回。 */
export const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

/**
 * 在指定目录内安全地读取一个文件。
 * 路径用 path.resolve 展开后必须仍落在 baseDir 之内，否则返回 null —— 这样 '/../package.json'、'/images/../../x' 之类的越界请求读不到目录外的文件。
 * @param {string} baseDir 允许读取的根目录（绝对路径）。
 * @param {string} pathname 以 '/' 开头的请求路径。
 * @returns {Promise<Buffer|null>} 文件内容；越界、是目录、不存在都返回 null。
 */
export async function readFileWithin(baseDir, pathname){
  const target = path.resolve(baseDir, '.' + pathname);
  if(target !== baseDir && !target.startsWith(baseDir + path.sep))
    return null;
  try{
    if(!(await stat(target)).isFile())
      return null;
  }
  catch{
    return null;
  }
  return readFile(target);
}

/**
 * 从 public/ 读取静态资源。
 * 后缀不在 MIME 表里的一律当作不存在，避免把源码或无关文件暴露出去。
 * @param {string} pathname 请求路径，例如 '/styles.css'。
 * @returns {Promise<{type: string, body: Buffer}|null>} 资源内容与类型；不存在返回 null。
 */
export async function readAsset(pathname){
  const body = await readFileWithin(assetRoot, pathname);
  if(!body)
    return null;
  const type = types[path.extname(pathname).toLowerCase()];
  return type? {type, body}: null;
}

/**
 * 解析 cookie 头。
 * @param {string} [header] 原始 Cookie 头。
 * @returns {Record<string,string>} 名称到值的映射。
 */
export function parseCookies(header = ''){
  const cookies = {};
  for(const part of String(header).split(';')){
    const index = part.indexOf('=');
    if(index < 0)
      continue;
    const name = part.slice(0, index).trim();
    if(name)
      cookies[name] = part.slice(index + 1).trim();
  }
  return cookies;
}

/**
 * 同源校验：POST 必须带 Origin，且主机与请求的 Host 一致。
 * 只比主机不比协议 —— 同一台机器上 http/https 都可能出现，比协议只会误伤本机调试。
 * @param {object} headers 请求头。
 * @returns {boolean} 是否同源。
 */
export function sameOrigin(headers){
  const source = headers.origin || headers.referer;
  if(!source)
    return false;
  try{
    return new URL(source).host === headers.host;
  }
  catch{
    return false;
  }
}