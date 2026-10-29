import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {handleRequest} from '../backend/app.mjs';
import {select,execute,closePool,dbReady} from '../backend/db.mjs';
import {hashPassword} from '../backend/auth.mjs';
import {loadConfig} from '../backend/config.mjs';
import {AVATAR_MAX_BYTES} from '../backend/avatar/index.mjs';
import {migrateSchema} from '../backend/schema.mjs';
import {registerAvatarStore} from '../backend/avatar/index.mjs';

// 造一个两帧 GIF：sharp 不能凭空生成多帧图，所以拿两张单帧 GIF 拼字节 ——
// 第二帧的图描述符里打开「局部色表」位，带上自己的调色板。只用于验证动图是否被原样保留。
async function twoFrameGif(){
  const single = color => sharp({create: {width: 32, height: 32, channels: 3, background: color}}).gif().toBuffer();
  const parse = buffer => {
    const gctSize = 3 * (1 << ((buffer[10] & 0x07) + 1));
    let i = 13 + gctSize;
    const gceStart = i;
    while(buffer[i] !== 0x2C){
      i += 2;
      while(buffer[i] !== 0)i += buffer[i] + 1;
      i += 1;
    }
    const desc = buffer.subarray(i, i + 10);
    let j = i + 11;
    while(buffer[j] !== 0)j += buffer[j] + 1;
    j += 1;
    return {head: buffer.subarray(0, gceStart), gct: buffer.subarray(13, 13 + gctSize), gctSize, gce: buffer.subarray(gceStart, i), desc, lzw: buffer.subarray(i + 10, j)};
  };
  const first = parse(await single('#e03a3a')), second = parse(await single('#3a7ae0'));
  const desc = Buffer.from(second.desc);
  desc[9] = 0x80 | (Math.log2(second.gctSize / 3) - 1);
  return Buffer.concat([first.head, first.gce, first.desc, first.lzw, second.gce, desc, second.gct, second.lzw, Buffer.from([0x3B])]);
}

test('头像真实 MySQL 上传、读取、替换、删除及失败保护', {skip: !dbReady()}, async t => {
  await migrateSchema();const users=[],jars=new Map(),host='localhost:4187',password='Avatar-test-password-2026';
  async function call(path,{actor=0,method='GET',body=null,type='application/json',csrf=true,headers:extra={}}={}){
    const jar=jars.get(actor)||new Map(),headers={host,origin:'http://'+host,cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),'content-type':type,...extra};
    if(csrf)headers['x-nc-csrf']=jar.get('nc_csrf');
    const r=await handleRequest({method,url:path,headers,body:body&&(!Buffer.isBuffer(body)&&typeof body==='object'?JSON.stringify(body):body),ip:'127.0.0.1'});
    for(const raw of [r.headers['set-cookie']||[]].flat()){const [name,...rest]=raw.split(';')[0].split('=');if(rest.join('='))jar.set(name,rest.join('='));else jar.delete(name);}jars.set(actor,jar);
    return {...r,json:r.headers['content-type']?.includes('json')?JSON.parse(r.body.toString()):null};
  }
  let a,b;
  // 不带元数据的干净 PNG：这一条用例要验证「原图一个字节都不改」，元数据剥离另有专门用例
  const png=await sharp({create:{width:320,height:160,channels:3,background:'#618ae3'}}).png().toBuffer();
  const jpeg=await sharp({create:{width:160,height:320,channels:3,background:'#79c8ab'}}).jpeg().toBuffer();
  const gif=await twoFrameGif();
  // contentType 按数组里声明的那份走：gif 用例会自己覆盖 type
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
      assert.equal((await call(`/api/users/${a}/avatar/full`)).status,302);
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
    await t.test('原图原样存、缩略图派生、缓存验证',async()=>{
      const saved=await upload(a);assert.equal(saved.status,200);
      // 只返回地址与版本：宽高/格式都是常量，原图格式看 /avatar/full 的 Content-Type 头
      for(const field of ['width','height','contentType'])
        assert.equal(field in saved.json,false,`不该再返回 ${field}`);
      assert.equal(saved.json.fullUrl,`/api/users/${a}/avatar/full`);

      // 缩略图：256×256 webp，元数据已被剥掉
      const thumb=await call(saved.json.url);assert.equal(thumb.status,200);
      assert.equal(thumb.headers['x-content-type-options'],'nosniff');assert.equal(thumb.headers['cache-control'],'public, no-cache');
      const thumbMeta=await sharp(thumb.body).metadata();
      assert.equal(thumbMeta.width,256);assert.equal(thumbMeta.height,256);assert.equal(thumbMeta.format,'webp');assert.ok(!thumbMeta.exif);

      // 原图：字节与上传的一模一样（不转码、不重编码），Content-Type 用上传的类型
      const full=await call(saved.json.fullUrl);assert.equal(full.status,200);
      assert.equal(full.headers['content-type'],'image/png');assert.deepEqual(full.body,png);
      // 两个地址共用一个 etag（原图哈希）
      assert.equal(full.headers.etag,thumb.headers.etag);

      const [row]=await select('SELECT u.avatar_storage_driver AS storage_driver,u.avatar_storage_key AS storage_key FROM users u WHERE u.id=?',[a]);assert.equal(row.storage_driver,'mysql');
      const stored=await select('SELECT storage_key,content_type FROM avatar_blobs WHERE storage_key IN (?,?)',[row.storage_key,row.storage_key+':thumb']);
      assert.equal(stored.length,2,'原图与缩略图各一行');
      assert.equal(stored.find(r=>r.storage_key===row.storage_key).content_type,'image/png');
      assert.equal(stored.find(r=>r.storage_key!==row.storage_key).content_type,'image/webp');
      firstKey=row.storage_key;firstEtag=thumb.headers.etag;

      assert.equal((await call(saved.json.url,{headers:{'if-none-match':firstEtag}})).status,304);
      assert.equal((await call(saved.json.fullUrl,{headers:{'if-none-match':firstEtag}})).status,304);
      const head=await call(saved.json.url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.body.length,0);
      assert.equal((await call('/api/profile/avatar',{actor:b})).json.isDefault,true);
    });
    await t.test('GIF：原图保留动画，缩略图取首帧',async()=>{
      const saved=await upload(a,gif,{type:'image/gif'});assert.equal(saved.status,200);
      const full=await call(saved.json.fullUrl);assert.equal(full.status,200);
      assert.equal(full.headers['content-type'],'image/gif');assert.deepEqual(full.body,gif);
      const fullMeta=await sharp(full.body,{animated:true}).metadata();
      assert.equal(fullMeta.format,'gif');assert.equal(fullMeta.pages,2,'原图的动画帧要完整保留');
      const thumb=await call(saved.json.url);assert.equal(thumb.status,200);
      const thumbMeta=await sharp(thumb.body,{animated:true}).metadata();
      assert.equal(thumbMeta.format,'webp');assert.equal(thumbMeta.width,256);
      assert.ok(!thumbMeta.pages||thumbMeta.pages===1,'缩略图只取首帧');
    });
    await t.test('上传时剥掉 EXIF/GPS，像素不变',async()=>{
      const tagged=await sharp(png).jpeg({quality:92}).withExif({IFD0:{Copyright:'NanoCamp',Software:'secret-camera'}}).toBuffer();
      assert.ok((await sharp(tagged).metadata()).exif,'前置条件：这张图确实带 EXIF');
      const saved=await upload(a,tagged,{type:'image/jpeg'});assert.equal(saved.status,200);
      const full=await call(saved.json.fullUrl);assert.equal(full.status,200);
      assert.equal((await sharp(full.body).metadata()).exif,undefined,'落库的原图里不该再有 EXIF');
      assert.ok(full.body.length<tagged.length,'元数据段应被摘掉');
      assert.deepEqual(await sharp(full.body).raw().toBuffer(),await sharp(tagged).raw().toBuffer(),'像素必须完全一致');
      const thumb=await call(saved.json.url);assert.equal(thumb.status,200);
      assert.equal((await sharp(thumb.body).metadata()).exif,undefined,'缩略图同样不该带元数据');
    });
    await t.test('替换只改变当前用户，旧文件清理、旧缓存失效',async()=>{
      const saved=await upload(a,jpeg,{type:'image/jpeg'});assert.equal(saved.status,200);
      const image=await call(saved.json.url,{headers:{'if-none-match':firstEtag}});assert.equal(image.status,200);assert.notEqual(image.headers.etag,firstEtag);
      // 替换后旧的原图与缩略图都该消失
      assert.equal((await select('SELECT storage_key FROM avatar_blobs WHERE storage_key IN (?,?)',[firstKey,firstKey+':thumb'])).length,0);
      assert.equal((await call('/api/profile/avatar',{actor:b})).json.isDefault,true);
    });
    await t.test('存储失败和限流失败不破坏原头像，不留下未引用新文件',async()=>{
      const original=(await call('/api/profile/avatar',{actor:a})).json.version;
      const [{n:before}]=await select('SELECT COUNT(*) n FROM avatar_blobs');
      registerAvatarStore('test-failure',{put:async()=>{throw Error('Expected fixture storage failure');},get:async()=>null,delete:async()=>{}});
      const config=loadConfig(),previous=config.avatarStorage;config.avatarStorage={driver:'test-failure'};
      try{assert.equal((await upload(a)).status,500);}finally{config.avatarStorage=previous;}
      for(let i=0;i<5;i++)await execute("INSERT INTO rate_events(kind,subject,at) VALUES ('avatar_write',?,?)",[String(a),new Date()]);
      // 内容非法的图也应该是 429 而不是 422 —— 说明限流在解码之前就拦下了（否则会先撞 invalid_image）。
      assert.equal((await upload(a,Buffer.from('not-an-image'))).status,429,'限流预检应早于解码');
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
      assert.equal((await select('SELECT avatar_storage_driver AS storage_driver FROM users WHERE id=?',[a]))[0].storage_driver,'test-object');
      assert.equal((await call(saved.json.url)).status,200,'读取记录驱动，不依赖当前默认写入驱动');
      assert.equal((await call(saved.json.fullUrl)).status,200);
      assert.equal(objects.size,2,'原图 + 缩略图都写进了这个驱动');
    });
    await t.test('删除恢复默认，重复删除与用户隔离',async()=>{
      const [old]=await select('SELECT avatar_storage_key AS storage_key FROM users WHERE id=?',[a]);
      assert.equal((await call('/api/profile/avatar',{actor:a,method:'DELETE'})).json.isDefault,true);
      assert.equal((await select('SELECT storage_key FROM avatar_blobs WHERE storage_key IN (?,?)',[old.storage_key,old.storage_key+':thumb'])).length,0);
      assert.equal((await call(`/api/users/${a}/avatar`)).status,302);
      assert.equal((await call(`/api/users/${a}/avatar/full`)).status,302);
      assert.equal((await call('/api/profile/avatar',{actor:a,method:'DELETE'})).status,200);
    });
  }finally{
    for(const id of users){const avatars=await select('SELECT avatar_storage_key AS storage_key FROM users WHERE id=?',[id]);for(const row of avatars)await execute('DELETE FROM avatar_blobs WHERE storage_key IN (?,?)',[row.storage_key,row.storage_key+':thumb']);await execute("DELETE FROM rate_events WHERE kind='avatar_write' AND subject=?",[String(id)]);await execute('DELETE FROM users WHERE id=?',[id]);}
    await closePool();
  }
});
