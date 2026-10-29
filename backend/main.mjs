// NanoCamp 后端入口：零依赖的 Node HTTP 服务器。
//
// 启动（在项目根目录）：
//   npm run dev    # 改文件自动重启（node --watch）
//   npm start
//
// 监听地址与端口只从一个地方读：data/config.json（该目录不进 git）
//
// 文件不存在、字段缺失或类型写错时都用默认值，服务照样能起。
// 默认 0.0.0.0:8080 —— 绑本机所有网卡，部署到服务器就能直接访问；
// 本机开发不想对局域网开放，就在 data/config.json 里写 "host": "127.0.0.1"。
//
// 可选的 "url" 覆盖版本库里的正式域名（content/site.mjs 的 site.url），canonical、Open Graph、
// sitemap 与 robots 会整体跟着变。多实例部署时每个实例写自己的地址 —— 否则测试站会把 canonical 指向生产域名。
//
// 日志全部走 stdout / stderr，每行带 [name] 前缀（name 同样来自 data/config.json），
// 同一台机器上跑多个实例时靠它区分。长久运行靠外部接管这两条流：
// systemd 会自动收进 journald（journalctl -u <服务名> -f）；裸后台运行则要自己重定向
// （node backend/main.mjs >> logs/app.log 2>&1），否则输出随会话一起消失。
//
// 路由与渲染逻辑都在 backend/app.mjs，本文件只负责读配置、监听与收发字节。

import http from 'node:http';
import {existsSync} from 'node:fs';

import {assetRoot} from './base.mjs';
import {handleRequest, routeInfo} from './app.mjs';
import {authConfig, configPath, serverSettings, SERVER_DEFAULTS} from './config.mjs';
import {site} from '../content/site.mjs';
import {AVATAR_MAX_BYTES} from './avatar/index.mjs';
import {FORUM_IMAGE_MAX_BYTES} from '../common/forum.mjs';

/** 优雅退出的兜底时限：超过这个时间还有连接没释放就强制退出。 */
const SHUTDOWN_GRACE_MS = 5000;

/** 日志前缀。配置读出来之前先用默认名，读完之后换成 config.json 里的 name。 */
let tag = `[${SERVER_DEFAULTS.name}]`;

/** 信息输出，走 stdout。 */
const log = (...args) => console.log(tag, ...args);

/** 错误输出，走 stderr —— journald 会按优先级分流，重定向到文件时也方便单独筛出来。 */
const fail = (...args) => console.error(tag, ...args);

// 监听配置统一由 config.mjs 读取，这里只把解析告警打到带实例名前缀的 stderr 上。
const settings = serverSettings();
const {host, port, name, url} = settings;
tag = `[${name}]`;
for(const warning of settings.warnings)
  fail(warning);
// 域名是部署属性而不是内容属性：版本库里的 site.url 是生产域名，本实例若在 config 里写了 url 就以它为准。
// site 是模块级单例对象，这里改属性对 src/metadata.mjs 的 canonicalUrl 立即生效（两边是同一个对象引用）。
if(url)
  site.url = url;

/**
 * 读取请求体（只有 POST 这类方法才需要）。
 *
 * 超过上限的请求直接丢弃并返回 null —— 登录接口只收一两个字段，没有理由让一个 10 MB 的请求体把内存吃掉。
 * @param {import('node:http').IncomingMessage} req 请求对象。
 * @param {number} [limit=65536] 允许的最大字节数。
 * @returns {Promise<Buffer|null>} 请求体；超限或读取出错时为 null。
 */
/** 请求体超过上限时抛这个，由 server 回调转成 413。 */
class BodyTooLargeError extends Error {}

function readBody(req, limit = 64 * 1024){
  // 先看声明长度：能直接拒就不用读一个字节。
  const declared = Number(req.headers['content-length'] || 0);
  if(declared > limit)
    return Promise.reject(new BodyTooLargeError());
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (error, value) => {
      if(settled) return;
      settled = true;
      if(error) reject(error);
      else resolve(value);
    };
    req.on('data', chunk => {
      size += chunk.length;
      if(size > limit){
        // 别再读（pause 后 socket 背压），也别在这里destroy；先让上层把 413 写回去，再断开，否则客户端只会看到「连接被重置」。
        req.pause();
        finish(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(null, Buffer.concat(chunks)));
    // 读流出错（客户端中断上传）：当成「没有请求体」，交给接口层判 400，不当成服务端故障。
    req.on('error', () => finish(null, null));
  });
}

/**
 * 取来源地址用于限流。
 *
 * 只有显式开了 auth.trustProxy（生产走 nginx 反代）才采信 x-forwarded-for，否则客户端随手加一个头就能绕过来源级限额。
 * @param {import('node:http').IncomingMessage} req 请求对象。
 * @returns {string} 来源地址。
 */
function clientIp(req){
  if(authConfig().trustProxy){
    const forwarded = req.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded)? forwarded[0]: String(forwarded || '').split(',')[0];
    if(first.trim()) return first.trim();
  }
  return req.socket.remoteAddress || '';
}

/**
 * HTTP 请求处理：把请求交给 app.mjs 的 handleRequest，再把结果写回 socket。
 *
 * 这里只做两件渲染层不该操心的事：捕获渲染异常转成可读的 500（避免连接悬着），以及 HEAD 请求只发响应头不写正文。
 */
const server = http.createServer(async (req, res) => {
  let response;
  let closeAfter = false;
  try{
    // 页面只有 GET/HEAD，请求体留空；POST 才会去读流。
    const bodyPath = new URL(req.url,'http://localhost').pathname;
    const bodyLimit = bodyPath === '/api/profile/avatar'? AVATAR_MAX_BYTES: (bodyPath==='/api/forum/images'? FORUM_IMAGE_MAX_BYTES: 64*1024);
    const body = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' ? await readBody(req, bodyLimit): null;
    response = await handleRequest({method: req.method, url: req.url, headers: req.headers, body, ip: clientIp(req)});
  }
  catch(error){
    if(error instanceof BodyTooLargeError){
      // 413：请求体太大。回一句话再断开（客户端还在上传，不能复用这条连接）。
      response = {
        status: 413,
        headers: {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', connection: 'close', 'x-nanocamp-source': 'error'},
        body: Buffer.from('请求体过大\n', 'utf8'),
      };
      closeAfter = true;
    }
    else{
      // 渲染函数报错时返回可读的 500，而不是把连接悬在那里；堆栈进 stderr，由 journald 或重定向的文件收着。
      fail(`${req.method} ${req.url} 渲染失败：`, error);
      response = {
        status: 500,
        headers: {'content-type': 'text/plain; charset=utf-8', 'x-nanocamp-source': 'error'},
        body: Buffer.from('页面错误\n', 'utf8'),
      };
    }
  }
  res.writeHead(response.status, response.headers);
  res.end(req.method === 'HEAD'? undefined: response.body);
  if(closeAfter)
    req.destroy();
});

// 反向代理 / systemd 停止服务时先停止接收新连接，再把在途请求处理完。
for(const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log(`收到 ${signal}，正在停止服务…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();  // 兜底：连接迟迟不释放时强制退出，避免进程卡住。
  });
}

/** 启动失败时给出可操作的提示，而不是抛出原始栈。 */
server.on('error', error => {
  if(error.code === 'EADDRINUSE')
    fail(`端口 ${port} 已被占用，改一下 data/config.json。`);
  else if(error.code === 'EACCES')
    fail(`没有权限绑定 ${host}:${port}，1024 以下端口需要提权或改用反向代理。`);
  else
    fail('服务启动失败：', error);
  process.exitCode = 1;
});

/**
 * 启动成功后打印访问地址与内容规模快照。
 *
 * 绑「本机所有网卡」时额外提示一次，避免在本机无意中对局域网开放。
 */
server.listen(port, host, () => {
  const allInterfaces = host === '0.0.0.0' || host === '::';
  log(`已启动：http://${allInterfaces ? '<本机所有地址>' : host}:${port}`);
  if(allInterfaces)
    log('  对局域网开放；本机开发想只对自己开放，在 data/config.json 里写 "host": "127.0.0.1"');
  log(`  配置：${existsSync(configPath) ? configPath : `${configPath}（不存在，使用默认值）`}`);
  log(`  站点域名：${site.url}${url ? '（来自 data/config.json 的 url 覆盖）' : '（来自 content/site.mjs）'}`);
  log(`  静态资源：${assetRoot}`);
  log(`  请求期渲染：${routeInfo.pages} 个页面，另有 ${routeInfo.derived.length} 个不落磁盘的派生文件（sitemap、robots、404 页、指南模板下载）`);
});
