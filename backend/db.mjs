// MySQL 连接与表结构。
//
// 只做两件事：给 auth.mjs 提供 select / execute，以及建表（migrate）。
// 没有中间的 store 抽象层 —— SQL 直接写在 auth.mjs 里，改一条查询不用在三层之间对照。
//
// 三条约定：
//   1. 时间列一律由 Node 算好再作为参数写进去，SQL 里不出现 NOW()。
//      连接设 timezone:'Z'，Date 按 UTC 序列化 —— 应用与库时区不一致会静默错 8 小时。
//   2. 所有语句都用 execute()（预处理），参数绑定，不拼字符串。
//   3. 没有 db.database 就视为没配数据库：这里直接拒绝工作，由上层转成 503。
import mysql from 'mysql2/promise';

import {dbConfig} from './config.mjs';

/** @type {import('mysql2/promise').Pool | null} */
let pool = null;

/**
 * 是否配置了数据库。只判断「配没配」，不代表连得通。
 * @returns {boolean} 有 database 字段即为 true。
 */
export function dbReady(){
  return Boolean(dbConfig().database);
}

/**
 * 取连接池，首次调用时创建。
 * @returns {import('mysql2/promise').Pool} 连接池。
 */
function getPool(){
  if(pool)
    return pool;
  const config = dbConfig();
  if(!config.database)
    throw new Error('data/config.json 里没有配置 db.database');
  pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: config.connectionLimit,
    waitForConnections: true,
    // 库挂掉时别把请求挂在那里等默认的 60 秒；3 秒内连不上就当不可用。
    connectTimeout: 3000,
    charset: 'utf8mb4',
    // 时间统一按 UTC 序列化；配合「时间只由 Node 计算」，库里不会出现 NOW()。
    timezone: 'Z'
  });
  return pool;
}

/**
 * 探活：连一次库执行 SELECT 1，并带回版本与耗时。
 *
 * 只在启动检查/运维脚本里用，**不放在请求路径上** —— 每个请求多一次往返不划算，
 * 真正的失败由调用处的错误映射处理（见 isUnavailable）。
 * @returns {Promise<{ok: boolean, version?: string, ms: number, error?: string}>} 探活结果。
 */
export async function ping(){
  const started = Date.now();
  try{
    const rows = await select('SELECT VERSION() AS version');
    return {ok: true, version: rows[0]?.version, ms: Date.now() - started};
  }
  catch(error){
    return {ok: false, ms: Date.now() - started, error: error.message};
  }
}

/**
 * 这个错误是不是「数据库连不上」，而不是 SQL 写错了。
 *
 * 用来把不可用映射成 503（稍后再试），而不是 500（我们的 bug）——
 * 对调用方来说这两件事完全不同：一个该退避重试，一个该报警修代码。
 * @param {Error} error 捕获到的错误。
 * @returns {boolean} 是否属于连接层面的失败。
 */
export function isUnavailable(error){
  const code = error?.code || '';
  return [
    'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH',
    'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_SEQUENCE_TIMEOUT', 'ER_CON_COUNT_ERROR',
    'ER_SERVER_SHUTDOWN', 'ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR'
  ].includes(code);
}

/**
 * 连通性缓存：`/api/session` 要能反映「库现在还活着吗」，但又不能每个请求都探一次。
 * 60 秒内复用上次结论；任何一次查询失败会立刻把缓存置为不可用（见 markUnhealthy）。
 */
const HEALTH_TTL_MS = 60 * 1000;
let health = {ok: true, at: 0};

/**
 * 把缓存标记为不可用。只对连接类错误生效 —— SQL 写错不该被当成库挂了。
 * @param {Error} error 捕获到的错误。
 * @returns {void}
 */
function markUnhealthy(error){
  if(isUnavailable(error))
    health = {ok: false, at: Date.now()};
}

/**
 * 数据库当前是否可用（带 10 秒缓存）。
 * @returns {Promise<boolean>} 可用为 true。
 */
export async function dbHealthy(){
  if(Date.now() - health.at < HEALTH_TTL_MS)
    return health.ok;
  const result = await ping();
  health = {ok: result.ok, at: Date.now()};
  if(result.ok)
    console.error(`[db] 恢复连接（${result.ms} ms）`);
  else
    console.error(`[db] 不可用：${result.error}`);
  return result.ok;
}

/**
 * 查询多行（SELECT）。
 * @param {string} sql 带 ? 占位符的语句。
 * @param {Array} [params] 参数。
 * @returns {Promise<Array<object>>} 结果行。
 */
export async function select(sql, params = []){
  try{
    const [rows] = await getPool().execute(sql, params);
    return rows;
  }
  catch(error){
    markUnhealthy(error);
    throw error;
  }
}

/**
 * 执行写操作（INSERT / UPDATE / DELETE）。
 * @param {string} sql 带 ? 占位符的语句。
 * @param {Array} [params] 参数。
 * @returns {Promise<{affectedRows: number, insertId: number}>} 影响行数与自增 id。
 */
export async function execute(sql, params = []){
  try{
    const [result] = await getPool().execute(sql, params);
    return {affectedRows: result.affectedRows, insertId: result.insertId};
  }
  catch(error){
    markUnhealthy(error);
    throw error;
  }
}

/**
 * 关闭连接池（脚本退出、测试收尾）。
 * @returns {Promise<void>} 无。
 */
export async function closePool(){
  if(!pool)
    return;
  const current = pool;
  pool = null;
  await current.end();
}

// ======================= 表结构 =======================
//
// 写在 JS 数组里而不是 .sql 文件：避免「按分号切语句」把注释里的分号切坏。
// 全部 IF NOT EXISTS，可反复执行；改结构时往后追加新的迁移，不要改历史语句。
//
// 时间列不带数据库侧默认值（不用 CURRENT_TIMESTAMP / NOW()），原因见文件头。
// 邮箱列用 utf8mb4_0900_ai_ci（大小写不敏感）+ 唯一索引：
// 大小写不同的同一个邮箱建不出两个账号，比「应用层记得转小写」可靠。
export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    email VARCHAR(254) NOT NULL COMMENT '规范化为小写后的邮箱',
    password_hash VARCHAR(255) NULL DEFAULT NULL COMMENT 'scrypt$N$r$p$salt$hash；只用验证码登录过的账号为 NULL',
    email_verified_at DATETIME NULL DEFAULT NULL,
    nickname VARCHAR(24) NOT NULL DEFAULT '' COMMENT '必填；空字符串表示还没填',
    bio VARCHAR(160) NOT NULL DEFAULT '' COMMENT '一句话介绍，可选',
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_users_email (email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='社区用户'`,

  // 一行 = 一个浏览器的登录流程。challenge 唯一，所以「重发」是替换而不是新增：
  // 同一浏览器同一邮箱只认最近一次被接受的发送，多设备各占一行、互不影响。
  `CREATE TABLE IF NOT EXISTS login_email_captcha (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    challenge CHAR(24) NOT NULL COMMENT 'base64url 随机串，放在 HttpOnly cookie 里',
    email VARCHAR(254) NOT NULL,
    code_hmac CHAR(64) NOT NULL COMMENT 'HMAC-SHA256(secret, challenge:code)，不存明文码',
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    consumed_at DATETIME NULL DEFAULT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL,
    ip_hash CHAR(64) NOT NULL DEFAULT '',
    PRIMARY KEY (id),
    UNIQUE KEY uniq_captcha_challenge (challenge),
    KEY idx_captcha_email (email, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='邮箱验证码挑战（一行 = 一个浏览器的登录流程）'`,

  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) NOT NULL COMMENT 'sha256(会话令牌)，令牌原文只在 cookie 里',
    user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL,
    last_seen_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL COMMENT '绝对到期；空闲到期另按 last_seen_at 判定',
    ua_hash CHAR(64) NOT NULL DEFAULT '',
    PRIMARY KEY (token_hash),
    KEY idx_sessions_user (user_id),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='登录会话'`,

  // 限流的唯一存储：subject 存 HMAC 后的邮箱或 IP，库表与日志里都不出现明文邮箱。
  // 放数据库而不是进程内存，是为了重启、多实例、改配置时计数不清零。
  `CREATE TABLE IF NOT EXISTS rate_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    kind VARCHAR(16) NOT NULL COMMENT 'send / verify_fail / login_fail',
    subject CHAR(64) NOT NULL COMMENT 'HMAC(email) 或 HMAC(ip)',
    at DATETIME NOT NULL,
    PRIMARY KEY (id),
    KEY idx_rate_lookup (kind, subject, at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='发信与验证频率记录'`
];

/**
 * 建表。可反复执行（全部 IF NOT EXISTS）。
 *
 * 用 query 而不是 execute：DDL 在 MySQL 的预处理协议里支持不完整，走文本协议更稳。
 * @returns {Promise<number>} 执行的语句数。
 */
export async function migrate(){
  const connection = getPool();
  for(const statement of schemaStatements)
    await connection.query(statement);
  return schemaStatements.length;
}
