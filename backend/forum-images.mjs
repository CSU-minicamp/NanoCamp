import sharp from 'sharp';
import {createHash,randomUUID} from 'node:crypto';
import {select,transaction} from './db.mjs';
import {loadConfig} from './config.mjs';
import {write,checkMember,fail} from './forum.mjs';
import {forumImageStore} from './forum-image-storage.mjs';

export const FORUM_IMAGE_MAX_BYTES=5*1024*1024;
export const FORUM_IMAGE_DRAFT_DAYS=7;
const cutoff=()=>new Date(Date.now()-FORUM_IMAGE_DRAFT_DAYS*86400000);
export async function uploadForumImage(user,key,input,type){
  await transaction(c=>checkMember(c,user));
  if(!/^[\w-]{8,80}$/.test(String(key??'')))fail('idempotency_required');
  if(!Buffer.isBuffer(input)||!input.length)fail('invalid_image',422);
  if(input.length>FORUM_IMAGE_MAX_BYTES)fail('image_too_large',413);
  const expected={'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'}[String(type).split(';')[0].trim().toLowerCase()];
  if(!expected)fail('unsupported_image_type',415);
  let output;
  try{
    const image=sharp(input,{limitInputPixels:16*1024*1024,failOn:'warning'}),meta=await image.metadata();
    if(meta.format!==expected||(meta.pages||1)>1)fail('invalid_image',422);
    output=await image.rotate().resize({width:1920,height:1920,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer({resolveWithObject:true});
  }catch(error){if(error.code==='invalid_image')throw error;fail('invalid_image',422);}
  const id=randomUUID(),driver=loadConfig().forumImageStorage?.driver||'mysql',store=forumImageStore(driver),bytes=output.data;
  const digest=createHash('sha256').update(input).digest('hex');let result;
  try{
    await store.put({key:id,bytes,contentType:'image/webp'});
    result=await write(user,key,'image.upload',{digest,type:expected},async c=>{
      const [[{n}]]=await c.execute("SELECT COUNT(*) AS n FROM forum_write_requests WHERE user_id=? AND action='image.upload' AND created_at>?",[user.id,new Date(Date.now()-3600000)]);
      if(n>=20)fail('rate_limited',429);
      await c.execute('INSERT INTO forum_images(id,owner_id,storage_driver,storage_key,content_type,byte_size,width,height,etag,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[id,user.id,driver,id,'image/webp',bytes.length,output.info.width,output.info.height,createHash('sha256').update(bytes).digest('hex'),new Date()]);
      return {id,url:'/api/forum/images/'+id,contentType:'image/webp',size:bytes.length,width:output.info.width,height:output.info.height};
    });
  }catch(error){try{await store.delete(id);}catch(cleanup){console.error('[forum:image:cleanup]',id,cleanup.code||'',cleanup.message);}throw error;}
  if(result.id!==id)try{await store.delete(id);}catch(error){console.error('[forum:image:duplicate-cleanup]',id,error.message);}
  return result;
}
export async function readForumImage(id,viewer=0){
  const [meta]=await select('SELECT i.*,t.status AS topic_status FROM forum_images i LEFT JOIN forum_topics t ON t.id=i.topic_id WHERE i.id=?',[id]);
  if(!meta)fail('not_found',404);
  if(meta.topic_id){if(meta.topic_status!=='published')fail('not_found',404);}
  else if(Number(meta.owner_id)!==Number(viewer)||new Date(meta.created_at)<cutoff())fail('not_found',404);
  const bytes=await forumImageStore(meta.storage_driver).get(meta.storage_key);
  if(!bytes){console.error('[forum:image:missing-object]',id,meta.storage_driver);fail('unavailable',503);}
  return {meta,bytes};
}
export async function cleanupDraftImages(limit=100,ownerId=null){
  const batch=Math.min(1000,Math.max(1,Number.parseInt(limit,10)||100));
  return transaction(async c=>{
    const [images]=await c.query(`SELECT * FROM forum_images WHERE topic_id IS NULL AND created_at<? ${ownerId?'AND owner_id=?':''} ORDER BY created_at LIMIT ${batch} FOR UPDATE`,ownerId?[cutoff(),ownerId]:[cutoff()]);
    for(const image of images){await forumImageStore(image.storage_driver).delete(image.storage_key);await c.execute('DELETE FROM forum_images WHERE id=? AND topic_id IS NULL',[image.id]);}
    return images.length;
  });
}
