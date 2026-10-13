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
// 日志全部走 stdout / stderr，每行带 [name] 前缀（name 同样来自 data/config.json），
// 同一台机器上跑多个实例时靠它区分。长久运行靠外部接管这两条流：
// systemd 会自动收进 journald（journalctl -u <服务名> -f）；裸后台运行则要自己重定向
// （node backend/main.mjs >> logs/app.log 2>&1），否则输出随会话一起消失。
//
// 路由与渲染逻辑都在 backend/app.mjs，本文件只负责读配置、监听与收发字节。

import http from 'node:http';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

import {assetRoot} from './base.mjs'
import {handleRequest, routeInfo} from './app.mjs';

/** 实例配置文件的绝对路径。整个 data/ 目录不进版本库，每台机器各写一份。 */
const configPath = fileURLToPath(new URL('../data/config.json', import.meta.url));

/** 内置默认值：绑本机所有网卡，便于部署后直接访问。 */
const DEFAULTS = Object.freeze({host: '0.0.0.0', port: 8080, name: 'Nanocamp'});

/** 优雅退出的兜底时限：超过这个时间还有连接没释放就强制退出。 */
const SHUTDOWN_GRACE_MS = 5000;

/** 日志前缀。配置读出来之前先用默认名，读完之后换成 config.json 里的 name。 */
let tag = `[${DEFAULTS.name}]`;

/** 信息输出，走 stdout。 */
const log = (...args) => console.log(tag, ...args);

/** 错误输出，走 stderr —— journald 会按优先级分流，重定向到文件时也方便单独筛出来。 */
const fail = (...args) => console.error(tag, ...args);

/**
 * 读取实例配置，只认 host / port / name 三个字段，其余键一律忽略。
 *
 * 容错原则是「绝不因为配置问题起不来」：文件不存在（正常情况）、读不动、不是合法 JSON、字段缺失或类型写错，都用默认值兜住，最多打一行日志。
 *
 * @returns {{host: string, port: number, name: string}} 合并默认值后的监听地址、端口与实例名。
 */
function readSettings(){
  const settings = {...DEFAULTS};
  let raw;
  try{
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  }
  catch(error){
    if(error.code !== 'ENOENT')  // 文件不存在是正常情况（用默认值）；存在但读不动或不是合法 JSON 才提示。
      fail(`${configPath} 读取失败，改用默认值：${error.message}`);
    return settings;
  }
  // 有效才赋值
  if(typeof raw?.host === 'string' && raw.host.trim())
    settings.host = raw.host.trim();
  if(Number.isInteger(raw?.port) && raw.port > 0 && raw.port < 65536)
    settings.port = raw.port;
  if(typeof raw?.name === 'string' && raw.name.trim())
    settings.name = raw.name.trim();
  return settings;
}

const {host, port, name} = readSettings();
tag = `[${name}]`;

/**
 * HTTP 请求处理：把请求交给 app.mjs 的 handleRequest，再把结果写回 socket。
 *
 * 这里只做两件渲染层不该操心的事：捕获渲染异常转成可读的 500（避免连接悬着），以及 HEAD 请求只发响应头不写正文。
 */
const server = http.createServer(async (req, res) => {
  let response;
  try{
    response = await handleRequest(req);
  }
  catch(error){
    // 渲染函数报错时返回可读的 500，而不是把连接悬在那里；堆栈进 stderr，由 journald 或重定向的文件收着。
    fail(`${req.method} ${req.url} 渲染失败：`, error);
    response = {
      status: 500,
      headers: {'content-type': 'text/plain; charset=utf-8', 'x-nanocamp-source': 'error'},
      body: Buffer.from('页面错误\n', 'utf8'),
    };
  }
  res.writeHead(response.status, response.headers);
  res.end(req.method === 'HEAD' ? undefined : response.body);
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
 * 启动成功后打印访问地址与迁移进度快照。
 *
 * 绑「本机所有网卡」时额外提示一次，避免在本机无意中对局域网开放；未迁移的路由会逐条列出 —— 这份清单就是当前的迁移待办。
 */
server.listen(port, host, () => {
  const allInterfaces = host === '0.0.0.0' || host === '::';
  log(`已启动：http://${allInterfaces ? '<本机所有地址>' : host}:${port}`);
  if(allInterfaces)
    log('  对局域网开放；本机开发想只对自己开放，在 data/config.json 里写 "host": "127.0.0.1"');
  log(`  配置：${existsSync(configPath) ? configPath : `${configPath}（不存在，使用默认值）`}`);
  log(`  静态资源：${assetRoot}`);
  log(`  已迁移：${routeInfo.migrated.join('、')}`);
  log(`  未迁移：${routeInfo.pending.length} 个（访问返回 404，用于直观查看进度）`);
  for(const route of routeInfo.pending)
    log(`    · ${route}`);
});
