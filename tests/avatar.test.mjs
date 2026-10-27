import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {handleRequest} from '../backend/app.mjs';
import {select,execute,closePool,dbReady} from '../backend/db.mjs';
import {hashPassword} from '../backend/auth.mjs';
import {loadConfig} from '../backend/config.mjs';
import {migrateAvatars,AVATAR_MAX_BYTES} from '../backend/avatar/index.mjs';
import {registerAvatarStore} from '../backend/avatar/index.mjs';

test('头像真实 MySQL 上传、读取、替换、删除及失败保护',{skip:!dbReady()},async t=>{
  await migrateAvatars();const users=[],jars=new Map(),host='localhost:4187',password='Avatar-test-password-2026';
  async function call(path,{actor=0,method='GET',body=null,type='application/json',csrf=true,headers:extra={}}={}){
    const jar=jars.get(actor)||new Map(),headers={host,origin:'http://'+host,cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),'content-type':type,...extra};
    if(csrf)headers['x-nc-csrf']=jar.get('nc_csrf');
    const r=await handleRequest({method,url:path,headers,body:body&&(!Buffer.isBuffer(body)&&typeof body==='object'?JSON.stringify(body):body),ip:'127.0.0.1'});
    for(const raw of [r.headers['set-cookie']||[]].flat()){const [name,...rest]=raw.split(';')[0].split('=');if(rest.join('='))jar.set(name,rest.join('='));else jar.delete(name);}jars.set(actor,jar);
    return {...r,json:r.headers['content-type']?.includes('json')?JSON.parse(r.body.toString()):null};
  }
  let a,b;
  const png=await sharp({create:{width:320,height:160,channels:3,background:'#618ae3'}}).withMetadata().png().toBuffer();
  const jpeg=await sharp({create:{width:160,height:320,channels:3,background:'#79c8ab'}}).jpeg().toBuffer();
  const upload=(actor,body=png,options={})=>call('/api/profile/avatar',{actor,method:'PUT',body,type:'image/png',...options});
  try{
    for(const name of ['a','b']){const email=`avatar-${randomUUID()}@example.test`,now=new Date();const r=await execute('INSERT INTO users(email,nickname,password_hash,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,?,?)',[email,'头像测试'+name,await hashPassword(password),now,now,now]);users.push(r.insertId);await call('/api/session',{actor:r.insertId});assert.equal((await call('/api/auth/login',{actor:r.insertId,method:'POST',body:{email,password}})).status,200);}
    [a,b]=users;
    await t.test('身份、方法、CSRF和默认头像',async()=>{
      assert.equal((await upload(0)).status,401);
      assert.equal((await upload(a,png,{csrf:false})).status,403);
      assert.equal((await call('/api/profile/avatar',{actor:a,method:'POST',body:png})).status,405);
      assert.equal((await call('/api/profile/avatar',{actor:a})).json.isDefault,true);
      assert.equal((await call(`/api/users/${a}/avatar`)).status,302);
      assert.equal((await call('/api/users/not-an-id/avatar',{actor:a})).status,404);
      assert.equal((await call('/api/users/999999999999/avatar')).status,404);
    });
    await t.test('文件类型、伪造内容、体积和像素上限',async()=>{
      assert.equal((await upload(a,Buffer.from('<svg/>'),{type:'image/svg+xml'})).status,415);
      assert.equal((await upload(a,Buffer.from('not an image'))).status,422);
      assert.equal((await upload(a,png,{type:'image/jpeg'})).status,422);
      assert.equal((await upload(a,Buffer.alloc(AVATAR_MAX_BYTES+1))).status,413);
      const large=await sharp({create:{width:4097,height:4097,channels:3,background:'red'}}).png().toBuffer();
      assert.equal((await upload(a,large)).status,422);
    });
    let firstKey,firstEtag;
    await t.test('重新编码、元数据清理、MySQL内容与缓存验证',async()=>{
      const saved=await upload(a);assert.equal(saved.status,200);assert.equal(saved.json.contentType,'image/webp');assert.equal(saved.json.width,256);
      const image=await call(saved.json.url);assert.equal(image.status,200);assert.equal(image.headers['x-content-type-options'],'nosniff');assert.equal(image.headers['cache-control'],'public, no-cache');
      const meta=await sharp(image.body).metadata();assert.equal(meta.width,256);assert.equal(meta.height,256);assert.equal(meta.format,'webp');assert.ok(!meta.exif);
      const [row]=await select('SELECT a.storage_driver,a.storage_key,b.content FROM user_avatars a JOIN avatar_blobs b ON b.storage_key=a.storage_key WHERE a.user_id=?',[a]);assert.equal(row.storage_driver,'mysql');assert.deepEqual(row.content,image.body);firstKey=row.storage_key;firstEtag=image.headers.etag;
      assert.equal((await call(saved.json.url,{headers:{'if-none-match':firstEtag}})).status,304);
      const head=await call(saved.json.url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.body.length,0);
      assert.equal((await call('/api/profile/avatar',{actor:b})).json.isDefault,true);
    });
    await t.test('替换只改变当前用户，旧文件清理、旧缓存失效',async()=>{
      const saved=await upload(a,jpeg,{type:'image/jpeg'});assert.equal(saved.status,200);
      const image=await call(saved.json.url,{headers:{'if-none-match':firstEtag}});assert.equal(image.status,200);assert.notEqual(image.headers.etag,firstEtag);
      assert.equal((await select('SELECT storage_key FROM avatar_blobs WHERE storage_key=?',[firstKey])).length,0);
      assert.equal((await call('/api/profile/avatar',{actor:b})).json.isDefault,true);
    });
    await t.test('存储失败和限流失败不破坏原头像，不留下未引用新文件',async()=>{
      const original=(await call('/api/profile/avatar',{actor:a})).json.version;
      const [{n:before}]=await select('SELECT COUNT(*) n FROM avatar_blobs');
      registerAvatarStore('test-failure',{put:async()=>{throw Error('Expected fixture storage failure');},get:async()=>null,delete:async()=>{}});
      const config=loadConfig(),previous=config.avatarStorage;config.avatarStorage={driver:'test-failure'};
      try{assert.equal((await upload(a)).status,500);}finally{config.avatarStorage=previous;}
      for(let i=0;i<5;i++)await execute("INSERT INTO rate_events(kind,subject,at) VALUES ('avatar_write',?,?)",[String(a),new Date()]);
      assert.equal((await upload(a)).status,429);
      assert.equal((await call('/api/profile/avatar',{actor:a})).json.version,original);
      assert.equal((await select('SELECT COUNT(*) n FROM avatar_blobs'))[0].n,before);
      await execute("DELETE FROM rate_events WHERE kind='avatar_write' AND subject=?",[String(a)]);
    });
    await t.test('切换适配器后旧记录仍按自身驱动读取，URL不变',async()=>{
      const objects=new Map();registerAvatarStore('test-object',{put:async({key,bytes})=>objects.set(key,bytes),get:async key=>objects.get(key)||null,delete:async key=>objects.delete(key)});
      const config=loadConfig(),previous=config.avatarStorage;config.avatarStorage={driver:'test-object'};
      let saved;try{saved=await upload(a);assert.equal(saved.status,200);}finally{config.avatarStorage=previous;}
      assert.equal(saved.json.url,`/api/users/${a}/avatar`);
      assert.equal((await select('SELECT storage_driver FROM user_avatars WHERE user_id=?',[a]))[0].storage_driver,'test-object');
      assert.equal((await call(saved.json.url)).status,200,'读取记录驱动，不依赖当前默认写入驱动');
      assert.equal(objects.size,1);
    });
    await t.test('删除恢复默认，重复删除与用户隔离',async()=>{
      const [old]=await select('SELECT storage_key FROM user_avatars WHERE user_id=?',[a]);
      assert.equal((await call('/api/profile/avatar',{actor:a,method:'DELETE'})).json.isDefault,true);
      assert.equal((await select('SELECT storage_key FROM avatar_blobs WHERE storage_key=?',[old.storage_key])).length,0);
      assert.equal((await call(`/api/users/${a}/avatar`)).status,302);
      assert.equal((await call('/api/profile/avatar',{actor:a,method:'DELETE'})).status,200);
    });
  }finally{
    for(const id of users){const avatars=await select('SELECT storage_key FROM user_avatars WHERE user_id=?',[id]);for(const row of avatars)await execute('DELETE FROM avatar_blobs WHERE storage_key=?',[row.storage_key]);await execute("DELETE FROM rate_events WHERE kind='avatar_write' AND subject=?",[String(id)]);await execute('DELETE FROM users WHERE id=?',[id]);}
    await closePool();
  }
});
