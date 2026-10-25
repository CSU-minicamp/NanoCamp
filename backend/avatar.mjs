import sharp from 'sharp';
import {createHash,randomUUID} from 'node:crypto';
import {select,transaction} from './db.mjs';
import {loadConfig} from './config.mjs';
import {avatarStore} from './avatar-storage.mjs';

export const AVATAR_MAX_BYTES=2*1024*1024;
export const DEFAULT_AVATAR_URL='/images/default-account-avatar.png';
export class AvatarError extends Error{constructor(code,status){super(code);this.code=code;this.status=status;}}
const fail=(code,status)=>{throw new AvatarError(code,status);};
export const avatarUrl=id=>`/api/users/${id}/avatar`;
const idOf=value=>{if(!/^[1-9]\d{0,14}$/.test(String(value)))fail('not_found',404);return Number(value);};
export const avatarSchema=[
  `CREATE TABLE IF NOT EXISTS avatar_blobs (storage_key VARCHAR(80) PRIMARY KEY,content MEDIUMBLOB NOT NULL) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS user_avatars (user_id BIGINT UNSIGNED PRIMARY KEY,storage_driver VARCHAR(32) NOT NULL,storage_key VARCHAR(80) NOT NULL,content_type VARCHAR(32) NOT NULL,byte_size INT UNSIGNED NOT NULL,width SMALLINT UNSIGNED NOT NULL,height SMALLINT UNSIGNED NOT NULL,etag CHAR(64) NOT NULL,updated_at DATETIME NOT NULL,UNIQUE KEY uniq_avatar_object(storage_driver,storage_key),FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB`
];
export async function migrateAvatars(){await transaction(async c=>{
  const [[lock]]=await c.query("SELECT GET_LOCK('nanocamp_avatar_schema',15) AS ok");if(!lock.ok)throw Error('Avatar schema migration locked');
  try{for(const sql of avatarSchema)await c.query(sql);}finally{await c.query("SELECT RELEASE_LOCK('nanocamp_avatar_schema')");}
});}
export async function avatarMetadata(id){
  id=idOf(id);const [user]=await select('SELECT id FROM users WHERE id=?',[id]);if(!user)fail('not_found',404);
  const [meta]=await select('SELECT * FROM user_avatars WHERE user_id=?',[id]);return meta||null;
}
export function avatarResult(id,meta){return {url:avatarUrl(id),isDefault:!meta,version:meta?.etag||null,contentType:meta?.content_type||'image/png',width:meta?.width||256,height:meta?.height||256,size:meta?.byte_size||null,updatedAt:meta?.updated_at||null};}
async function clean(driver,key){try{await avatarStore(driver).delete(key);}catch(error){console.error('[avatar:cleanup]',driver,key,error.code||'',error.message);}}
async function lockedUser(c,id){const [[u]]=await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[id]);if(!u)fail('unauthenticated',401);}
async function rate(c,id){
  const subject=String(id);const [[r]]=await c.execute("SELECT COUNT(*) AS n FROM rate_events WHERE kind='avatar_write' AND subject=? AND at>?",[subject,new Date(Date.now()-60000)]);
  if(r.n>=5)fail('rate_limited',429);
  await c.execute("INSERT INTO rate_events(kind,subject,at) VALUES ('avatar_write',?,?)",[subject,new Date()]);
}
export async function replaceAvatar(userId,input,contentType){
  userId=idOf(userId);
  if(!Buffer.isBuffer(input)||!input.length)fail('invalid_image',422);
  if(input.length>AVATAR_MAX_BYTES)fail('avatar_too_large',413);
  const expected={'image/png':'png','image/jpeg':'jpeg','image/webp':'webp'}[String(contentType).split(';')[0].trim().toLowerCase()];
  if(!expected)fail('unsupported_image_type',415);
  let bytes;
  try{
    const image=sharp(input,{limitInputPixels:16*1024*1024,failOn:'warning'});
    const meta=await image.metadata();if(meta.format!==expected||(meta.pages||1)>1)fail('invalid_image',422);
    bytes=await image.rotate().resize(256,256,{fit:'cover'}).webp({quality:85}).toBuffer();
  }catch(error){if(error instanceof AvatarError)throw error;fail('invalid_image',422);}
  const driver=loadConfig().avatarStorage?.driver||'mysql',store=avatarStore(driver),key=randomUUID();
  const meta={storage_driver:driver,storage_key:key,content_type:'image/webp',byte_size:bytes.length,width:256,height:256,etag:createHash('sha256').update(bytes).digest('hex'),updated_at:new Date()};
  // Write new bytes before publishing the reference. Existing avatars survive failures.
  try{await store.put({key,bytes,contentType:meta.content_type});}catch(error){await clean(driver,key);throw error;}
  let old;
  try{await transaction(async c=>{
    await lockedUser(c,userId);await rate(c,userId);
    const [[current]]=await c.execute('SELECT * FROM user_avatars WHERE user_id=? FOR UPDATE',[userId]);old=current;
    await c.execute(`INSERT INTO user_avatars(user_id,storage_driver,storage_key,content_type,byte_size,width,height,etag,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE storage_driver=VALUES(storage_driver),storage_key=VALUES(storage_key),content_type=VALUES(content_type),byte_size=VALUES(byte_size),width=VALUES(width),height=VALUES(height),etag=VALUES(etag),updated_at=VALUES(updated_at)`,[userId,driver,key,meta.content_type,meta.byte_size,256,256,meta.etag,meta.updated_at]);
  });}catch(error){await clean(driver,key);throw error;}
  if(old)await clean(old.storage_driver,old.storage_key);
  return avatarResult(userId,meta);
}
export async function removeAvatar(userId){
  userId=idOf(userId);let old;
  await transaction(async c=>{await lockedUser(c,userId);await rate(c,userId);const [[row]]=await c.execute('SELECT * FROM user_avatars WHERE user_id=? FOR UPDATE',[userId]);old=row;await c.execute('DELETE FROM user_avatars WHERE user_id=?',[userId]);});
  if(old)await clean(old.storage_driver,old.storage_key);return avatarResult(userId,null);
}
export async function readAvatar(id){
  // A concurrent replacement may remove the first object after its reference was read.
  for(let attempt=0;attempt<2;attempt++){
    const meta=await avatarMetadata(id);if(!meta)return null;
    const bytes=await avatarStore(meta.storage_driver).get(meta.storage_key);
    if(bytes)return {meta,bytes};
  }
  fail('avatar_unavailable',503);
}
