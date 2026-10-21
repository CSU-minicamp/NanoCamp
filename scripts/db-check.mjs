// 体检：库连得上吗？表建全了吗？行数大概多少？
//
//   npm run db:check
//
// 只读，不改任何数据。上线后怀疑「登录挂了」时先跑这个：能把
// 「库没起来 / 密码错 / 库名不对 / 忘了建表」四种情况一次分开。
import {dbReady, ping, select, closePool, schemaStatements, isUnavailable} from '../backend/db.mjs';
import {dbConfig} from '../backend/config.mjs';

if(!dbReady()){
  console.error('✗ data/config.json 里没有 db.database —— 认证会被禁用（接口 503）。');
  process.exit(1);
}

const config = dbConfig();
console.log(`目标：${config.user}@${config.host}:${config.port}/${config.database}`);

const health = await ping();
if(!health.ok){
  console.error(`✗ 连不上（${health.ms} ms）：${health.error}`);
  if(isUnavailable({code: 'ECONNREFUSED'}))
    console.error('  先确认：systemctl status mysql、ss -ltnp | grep 3306、账号密码与库名。');
  process.exit(1);
}
console.log(`✓ 连接正常（${health.ms} ms，MySQL ${health.version}）`);

// 表是否存在：information_schema 一次问完，不用逐张 SHOW。
const names = [...schemaStatements.map(statement => /CREATE TABLE IF NOT EXISTS (\w+)/.exec(statement)?.[1])].filter(Boolean);
// execute() 不会把数组展开成 IN (?,?,?) —— 占位符要自己拼（数量来自代码里的常量，不是用户输入）。
const placeholders = names.map(() => '?').join(', ');
const rows = await select(
  `SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})`,
  names
);
const existing = new Set(rows.map(row => row.name));

let missing = 0;
for(const name of names){
  if(!existing.has(name)){
    console.log(`✗ ${name} 不存在`);
    missing += 1;
    continue;
  }
  const [{total}] = await select(`SELECT COUNT(*) AS total FROM \`${name}\``);
  console.log(`✓ ${name}（${total} 行）`);
}
if(missing){
  console.error(`\n缺 ${missing} 张表：npm run db:migrate（没有 DDL 权限时用 --print | sudo mysql）`);
  process.exitCode = 1;
}

await closePool();
