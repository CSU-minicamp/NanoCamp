// MySQL 连接、执行，以及「库还活着吗」。
//
// 四件事：
//   1. 连接池：全项目只有这里 createPool（唯一 import mysql2 的地方）；
//   2. select() / execute()：池级读写原语，各业务模块直接用；
//   3. transaction(work)：回调共享同一个连接与事务，死锁自动重试两次；
//   4. ping() / dbHealthy() / isUnavailable() / closePool()：探活、错误分类与收尾。
//
// **DDL 不在这个文件里** —— 建表/改表全在 `backend/schema.mjs`（一张表一段，按 git tag 分版本）。
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

