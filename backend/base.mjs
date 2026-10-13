import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** 项目根目录（本文件位于 <root>/backend/ 下）。 */
const root = fileURLToPath(new URL('../', import.meta.url));

/** 站点资源目录：URL 路径直接对应 public/ 下的文件，不需要再往 dist/ 里复制一份。 */
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