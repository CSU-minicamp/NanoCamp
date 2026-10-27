// MySQL 连接、执行，以及「库还活着吗」。
//
// 五件事：
//   1. 连接池：全项目只有这里 createPool（唯一 import mysql2 的地方）；
//   2. select() / execute()：池级读写原语，各业务模块直接用；
//   3. transaction(work)：回调共享同一个连接与事务，死锁自动重试两次；
//   4. schemaStatements / migrate()：只建账号那 4 张表（论坛、私信、头像的 DDL 在各自模块里）；
//   5. ping() / dbHealthy() / isUnavailable() / closePool()：探活、错误分类与收尾。
//
// **没有 store 抽象层** —— SQL 直接写在 auth.mjs、forum/ 与 avatar/ 里，改一条查询不用在三层之间对照。
// 这一层只管「怎么连、怎么执行、连不上算什么错误」，不管业务。
//
// 四条约定：
//   1. 时间列一律由 Node 算好再作为参数写进去，SQL 里不出现 NOW()。
//      连接设 timezone:'Z'，Date 按 UTC 序列化 —— 应用与库时区不一致会静默错 8 小时。
//   2. 所有语句都走 execute()（预处理），参数绑定，不拼字符串。
//      注意它**不会**把数组展开成 IN (?,?,?)（那是 query() 的行为），占位符要自己拼。
//   3. 没有 db.database 就视为没配数据库：这里直接拒绝工作，由上层转成 503。
//   4. 探活不放在请求路径上：dbHealthy() 有 10 秒缓存，任何一次连接类失败会立刻把缓存置为不可用。
import mysql from 'mysql2/promise';

import {dbConfig} from './config.mjs';

/** @type {import('mysql2/promise').Pool | null} */
let pool = null;

/**
 * 是否**配置**了数据库 —— 只判断配没配，不代表连得通（连通性看 dbHealthy）。
 * 用它决定「认证功能要不要对外报 503」，不要用它判断健康。
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
 * 在一个连接上开事务：`work(connection)` 里的语句共用同一个连接、同一个事务。
 *
 * 死锁与锁等待超时自动重试（最多 3 次），其它错误原样抛出并回滚 —— 靠 isUnavailable() 区分「库挂了」。
 * @param {(connection: object) => Promise<any>} work 事务体：收连接，返回要带出事务的结果。
 * @returns {Promise<any>} work 的返回值。
 */
export async function transaction(work){
  for(let attempt=0; ;attempt++){
    const connection = await getPool().getConnection();
    try{
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    }
    catch(error){
      await connection.rollback();
      if(attempt >= 2 || !['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code))
        throw error;
      console.warn('[db:transaction] retry', error.code, 'attempt', attempt + 1);
    }
    finally{
      connection.release();
    }
  }
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
 * 数据库当前是否可用（结论缓存 60 秒，见 HEALTH_TTL_MS）。
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
// 这是**当前完整**的表结构，不是迁移历史：改这里只影响「新建的库」。
// 已经建过表的库要靠 ALTER 升级（见 backend/README 的「从旧结构升级」）。
//
// 写在 JS 数组里而不是 .sql 文件：避免「按分号切语句」把注释里的分号切坏。
// 全部 IF NOT EXISTS，可反复执行；用 `node scripts/migrate.mjs --print` 可导出成 SQL。
//
// 时间列不带数据库侧默认值（不用 CURRENT_TIMESTAMP / NOW()），原因见文件头。
// 邮箱列用 utf8mb4_0900_ai_ci（大小写不敏感）+ 唯一索引：
// 大小写不同的同一个邮箱建不出两个账号，比「应用层记得转小写」可靠。
export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    email VARCHAR(254) NOT NULL COMMENT '规范化为小写后的邮箱',
    password_hash VARCHAR(255) NULL DEFAULT NULL COMMENT 'scrypt$N$r$p$salt$hash；只用验证码登录过的账号为 NULL',
    email_verified_at DATETIME NULL DEFAULT NULL COMMENT '首次通过验证码验证的时间；NULL 表示还没验证过',
    nickname VARCHAR(24) NOT NULL DEFAULT '' COMMENT '必填项；空字符串表示还没填',
    bio VARCHAR(160) NOT NULL DEFAULT '' COMMENT '一句话介绍，可选',
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL COMMENT '资料更新时间；登录不改这一列',
    PRIMARY KEY (id),
    UNIQUE KEY uniq_users_email (email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='社区用户（邮箱唯一）'`,

  // 一行 = 一个浏览器的登录流程。challenge 唯一，所以「重发」是替换而不是新增：
  // 同一浏览器同一邮箱只认最近一次被接受的发送，多设备各占一行、互不影响。
  `CREATE TABLE IF NOT EXISTS login_email_captcha (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    challenge CHAR(24) NOT NULL COMMENT 'base64url 随机串，放在 HttpOnly cookie nc_chal 里',
    email VARCHAR(254) NOT NULL,
    code_hmac CHAR(64) NOT NULL COMMENT 'HMAC-SHA256(secret, challenge:emailCaptcha)；没填 emailCaptcha 时是占位空串',
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '已猜错次数；达到 auth.maxAttempts 后整枚作废',
    consumed_at DATETIME NULL DEFAULT NULL COMMENT '被成功消费的时间；NULL 表示还没用掉',
    expires_at DATETIME NOT NULL COMMENT '过期时间（auth.codeMinutes，默认 10 分钟）',
    created_at DATETIME NOT NULL,
    ip_hash CHAR(64) NOT NULL DEFAULT '' COMMENT '来源 IP 的 HMAC，仅用于审计',
    PRIMARY KEY (id),
    UNIQUE KEY uniq_captcha_challenge (challenge),
    KEY idx_captcha_email (email, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='邮箱验证码挑战（一行 = 一个浏览器的登录流程）'`,

  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) NOT NULL COMMENT 'sha256(会话令牌)，令牌原文只在 cookie nc_sid 里',
    user_id BIGINT UNSIGNED NOT NULL COMMENT '外键 → users.id；删号时这条会话跟着删',
    created_at DATETIME NOT NULL,
    last_seen_at DATETIME NOT NULL COMMENT '最近一次活跃；最多每小时写一次',
    expires_at DATETIME NOT NULL COMMENT '绝对到期；空闲到期另按 last_seen_at 判定',
    ua_hash CHAR(64) NOT NULL DEFAULT '' COMMENT 'UA 的 sha256，多设备时用于区分',
    PRIMARY KEY (token_hash),
    KEY idx_sessions_user (user_id),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='登录会话（只存令牌哈希，7 天绝对 + 24 小时空闲）'`,

  // 限流的唯一存储：subject 存 HMAC 后的邮箱或 IP，库表与日志里都不出现明文邮箱。
  // 放数据库而不是进程内存，是为了重启、多实例、改配置时计数不清零。
  `CREATE TABLE IF NOT EXISTS rate_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    kind VARCHAR(16) NOT NULL COMMENT 'send 发码 / verify_fail 猜错码 / login_fail 猜错密码',
    subject CHAR(64) NOT NULL COMMENT 'HMAC(email) 或 HMAC(ip)，不存明文',
    at DATETIME NOT NULL COMMENT '事件时间；所有窗口都按它算',
    PRIMARY KEY (id),
    KEY idx_rate_lookup (kind, subject, at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='发信与猜错频率，登录成功会清空该邮箱的记录'`
];

/**
 * 建表。可反复执行（全部 IF NOT EXISTS），但**不会改动已存在的表** ——
 * 加列/改名/加外键要单独写 ALTER（见 backend/README 的「从旧结构升级」）。
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
