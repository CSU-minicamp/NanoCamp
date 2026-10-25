import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {handleRequest} from '../backend/app.mjs';
import {execute,select,closePool,dbReady} from '../backend/db.mjs';
import {hashPassword} from '../backend/auth.mjs';
import {migrateForum} from '../backend/forum-schema.mjs';
import {FORUM_IMAGE_MAX_BYTES,cleanupDraftImages} from '../backend/forum-images.mjs';
import {registerForumImageStore} from '../backend/forum-image-storage.mjs';
import {loadConfig} from '../backend/config.mjs';
import {renderMarkdown} from '../backend/forum-markdown.mjs';

test('帖子图片仅渲染站内资源，评论与外链图片不渲染',()=>{
  const url='/api/forum/images/'+randomUUID();
  assert.ok(renderMarkdown(`![图片](${url})`,{images:true}).includes('<img'));
  assert.ok(!renderMarkdown(`![图片](${url})`).includes('<img'));
  assert.ok(!renderMarkdown('![图](https://example.test/tracker.png)',{images:true}).includes('<img'));
  assert.ok(!renderMarkdown('<img src=x onerror=alert(1)>',{images:true}).includes('<img'));
});

test('帖子图片 MySQL 存储、发布绑定、可见性和迁移适配器',{skip:!dbReady()},async t=>{
  await migrateForum();const users=[],jars=new Map(),objects=new Map(),password='Forum-image-test-2026';
  async function call(actor,url,{method='GET',body=null,type='application/json',csrf=true,key=randomUUID(),extra={}}={}){
    const jar=jars.get(actor)||new Map();const headers={host:'localhost:4187',origin:'http://localhost:4187',cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),'content-type':type,'idempotency-key':key,...extra};
    if(csrf)headers['x-nc-csrf']=jar.get('nc_csrf');
    const r=await handleRequest({method,url,headers,body:body&&!Buffer.isBuffer(body)&&typeof body==='object'?JSON.stringify(body):body,ip:'127.0.0.1'});
    for(const raw of [r.headers['set-cookie']||[]].flat()){const [name,...value]=raw.split(';')[0].split('=');if(value.join('='))jar.set(name,value.join('='));else jar.delete(name);}jars.set(actor,jar);
    return {...r,json:r.headers['content-type']?.includes('json')?JSON.parse(r.body.toString()):null};
  }
  const png=await sharp({create:{width:2560,height:1280,channels:3,background:'#618ae3'}}).withMetadata().png().toBuffer();
  const upload=(user,body=png,options={})=>call(user,'/api/forum/images',{method:'POST',body,type:'image/png',...options});
  const publish=(user,body)=>call(user,'/api/forum/topics',{method:'POST',body:{title:'带图片的测试讨论',category:'projects',body}});
  let a,b,photo,topic;
  try{
    for(const label of ['a','b']){const now=new Date(),email='forum-image-'+randomUUID()+'@example.test';const r=await execute('INSERT INTO users(email,nickname,password_hash,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,?,?)',[email,'图片测试'+label,await hashPassword(password),now,now,now]);users.push(r.insertId);await call(r.insertId,'/api/session');assert.equal((await call(r.insertId,'/api/auth/login',{method:'POST',body:{email,password}})).status,200);}[a,b]=users;
    await call(0,'/api/session');
    await t.test('上传权限、CSRF、类型、体积、实际解码与像素限制',async()=>{
      assert.equal((await upload(0)).status,401);assert.equal((await upload(a,png,{csrf:false})).status,403);
      assert.equal((await upload(a,Buffer.from('<svg/>'),{type:'image/svg+xml'})).status,415);
      assert.equal((await upload(a,Buffer.from('not image'))).status,422);
      assert.equal((await upload(a,png,{type:'image/jpeg'})).status,422);
      assert.equal((await upload(a,Buffer.alloc(FORUM_IMAGE_MAX_BYTES+1))).status,413);
      const huge=await sharp({create:{width:4097,height:4097,channels:3,background:'#fff'}}).png().toBuffer();assert.equal((await upload(a,huge)).status,422);
      await execute('INSERT INTO forum_members(user_id,suspended_until) VALUES (?,?)',[b,new Date(Date.now()+60000)]);assert.equal((await upload(b)).status,403);await execute('DELETE FROM forum_members WHERE user_id=?',[b]);
    });
    await t.test('MySQL二进制、比例缩放、去元数据、幂等与草稿隔离',async()=>{
      const key=randomUUID(),r=await upload(a,png,{key});assert.equal(r.status,201);photo=r.json;assert.equal((await upload(a,png,{key})).json.id,photo.id);
      assert.equal(photo.width,1920);assert.equal(photo.height,960);assert.equal((await call(0,photo.url)).status,404);assert.equal((await call(b,photo.url)).status,404);
      const image=await call(a,photo.url);assert.equal(image.status,200);const meta=await sharp(image.body).metadata();assert.equal(meta.format,'webp');assert.ok(!meta.exif);
      const [blob]=await select('SELECT b.content FROM forum_images i JOIN forum_image_blobs b ON b.storage_key=i.storage_key WHERE i.id=?',[photo.id]);assert.deepEqual(blob.content,image.body);
      assert.equal((await call(a,photo.url,{method:'HEAD'})).body.length,0);assert.equal((await call(a,photo.url,{extra:{'if-none-match':image.headers.etag}})).status,304);
    });
    await t.test('发布只绑定自己的草稿，不能引用他人、外链、过期或超量图片',async()=>{
      assert.equal((await publish(b,`![图](${photo.url})`)).status,422);
      assert.equal((await publish(a,'![图](https://example.test/external.png)')).status,422);
      assert.equal((await publish(a,Array(10).fill(`![图](${photo.url})`).join('\n'))).json.error,'too_many_images');
      const r=await publish(a,`正文图片测试。\n\n![图](${photo.url})`);assert.equal(r.status,200);topic=r.json.id;
      assert.equal((await call(0,photo.url)).status,200);
      const page=await call(0,r.json.href);assert.ok(page.body.toString().includes(`<img src="${photo.url}"`));
      assert.equal((await publish(a,`![图](${photo.url})`)).status,422);
      const expired=(await upload(a)).json;await execute('UPDATE forum_images SET created_at=? WHERE id=?',[new Date(Date.now()-8*86400000),expired.id]);
      assert.equal((await call(a,expired.url)).status,404);assert.equal((await publish(a,`![图](${expired.url})`)).status,422);
      assert.ok(await cleanupDraftImages(100,a)>0);assert.equal((await select('SELECT id FROM forum_images WHERE id=?',[expired.id])).length,0);
    });
    await t.test('隐藏、恢复和作者撤回后图片按帖子状态访问',async()=>{
      await execute("UPDATE forum_topics SET status='hidden' WHERE id=?",[topic]);assert.equal((await call(a,photo.url)).status,404);assert.equal((await call(0,photo.url)).status,404);
      await execute("UPDATE forum_topics SET status='published' WHERE id=?",[topic]);assert.equal((await call(0,photo.url)).status,200);
      assert.equal((await call(a,`/api/forum/topics/${topic}/withdraw`,{method:'POST',body:{}})).status,200);assert.equal((await call(0,photo.url)).status,404);
    });
    await t.test('JPEG和WebP也会按实际格式校验并保存为WebP',async()=>{
      for(const format of ['jpeg','webp']){const bytes=await sharp(png).toFormat(format).toBuffer();const r=await upload(a,bytes,{type:'image/'+format});assert.equal(r.status,201);assert.equal((await sharp((await call(a,r.json.url)).body).metadata()).format,'webp');}
    });
    await t.test('按记录读取旧存储，切换适配器不改图片URL；存储失败无脏记录',async()=>{
      registerForumImageStore('image-test-object',{put:async({key,bytes})=>objects.set(key,bytes),get:async key=>objects.get(key)||null,delete:async key=>objects.delete(key)});
      const config=loadConfig(),previous=config.forumImageStorage;
      try{config.forumImageStorage={driver:'image-test-object'};const r=await upload(a);assert.equal(r.status,201);assert.equal((await call(a,r.json.url)).status,200);config.forumImageStorage={driver:'mysql'};assert.equal((await call(a,r.json.url)).status,200);
        registerForumImageStore('image-test-failure',{put:async()=>{throw Error('Expected image store failure');},get:async()=>null,delete:async()=>{}});config.forumImageStorage={driver:'image-test-failure'};
        const [{n:before}]=await select('SELECT COUNT(*) AS n FROM forum_images WHERE owner_id=?',[a]);assert.equal((await upload(a)).status,500);assert.equal((await select('SELECT COUNT(*) AS n FROM forum_images WHERE owner_id=?',[a]))[0].n,before);
      }finally{config.forumImageStorage=previous;}
    });
    await t.test('超出上传频率不留下新文件',async()=>{
      for(let i=0;i<20;i++)await execute('INSERT INTO forum_write_requests(user_id,request_key,digest,action,result,created_at) VALUES (?,?,?,?,?,?)',[a,randomUUID(),'a'.repeat(64),'image.upload','{}',new Date()]);
      const [{n:before}]=await select('SELECT COUNT(*) AS n FROM forum_image_blobs');assert.equal((await upload(a)).status,429);assert.equal((await select('SELECT COUNT(*) AS n FROM forum_image_blobs'))[0].n,before);
    });
  }finally{
    for(const user of users){const images=await select('SELECT storage_driver,storage_key FROM forum_images WHERE owner_id=?',[user]);for(const image of images)if(image.storage_driver==='mysql')await execute('DELETE FROM forum_image_blobs WHERE storage_key=?',[image.storage_key]);await execute('DELETE FROM forum_images WHERE owner_id=?',[user]);await execute('DELETE FROM forum_topics WHERE author_id=?',[user]);await execute('DELETE FROM users WHERE id=?',[user]);}await closePool();
  }
});
