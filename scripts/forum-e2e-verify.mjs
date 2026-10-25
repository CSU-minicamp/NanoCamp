// HTTP readiness checks; leaves manual-test content and interaction state untouched.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {loadConfig} from '../backend/config.mjs';
const config=loadConfig();
if(config.db?.database!=='nanocamp_local'||config.db?.host!=='127.0.0.1'||Number(config.db?.port)!==3318||config.host!=='127.0.0.1'||config.port!==4187)throw Error('Only isolated local E2E environment is allowed');
const m=JSON.parse(await readFile(new URL('../data/forum-e2e.json',import.meta.url),'utf8'));
assert.equal(m.base,'http://127.0.0.1:4187');
const results=[];
async function client(){
  const jar=new Map();
  return async(path,data)=>{
    const response=await fetch(m.base+path,{method:data?'POST':'GET',redirect:'manual',signal:AbortSignal.timeout(8000),headers:{origin:m.base,cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),'content-type':'application/json','x-nc-csrf':jar.get('nc_csrf')||'','idempotency-key':randomUUID()},body:data?JSON.stringify(data):undefined});
    for(const cookie of response.headers.getSetCookie()){const [key,...value]=cookie.split(';')[0].split('=');if(value.join('='))jar.set(key,value.join('='));else jar.delete(key);}
    const text=await response.text();return {status:response.status,location:response.headers.get('location'),text,json:response.headers.get('content-type')?.includes('json')?JSON.parse(text):null};
  };
}
const anon=await client();
assert.equal((await anon('/forum/')).status,200);
assert.equal((await anon('/forum/me/')).status,303);
for(const [key,account]of Object.entries(m.accounts)){
  const call=await client();await call('/api/session');
  assert.equal((await call('/api/auth/login',{email:account.email,password:m.password})).status,200,`${key} login`);
  const session=await call('/api/session');assert.equal(session.json.user.id,account.id,`${key} identity`);
  const compose=await call('/forum/new/');
  if(key==='incomplete'){assert.equal(compose.status,303);assert.match(compose.location,/profile\/force/);}
  else assert.equal(compose.status,200,`${key} composer`);
  if(key==='muted')assert.equal((await call(`/api/forum/topics/${m.topics.main.id}/vote`,{value:1})).status,403);
  assert.equal((await call('/forum/messages/')).status,200);
  assert.equal((await call('/api/auth/logout',{})).status,200);
  results.push({role:key,login:true,privatePages:true,restrictionChecked:['muted','incomplete'].includes(key)});
}
for(const topic of Object.values(m.topics))assert.equal((await anon(new URL(topic.url).pathname)).status,200);
assert.equal((await anon(`/api/forum/topics/${m.topics.pages.id}?page=2`)).json.replies.length,1);
const avatar=await fetch(m.base+'/images/default-account-avatar.png');assert.equal(avatar.status,200);assert.ok((await avatar.arrayBuffer()).byteLength>0);
await writeFile(new URL('../data/forum-e2e-readiness.json',import.meta.url),JSON.stringify({run:m.run,verifiedAt:new Date().toISOString(),accounts:results,topics:6,pagination:true,defaultAvatar:true},null,2)+'\n');
console.log('PASS: HTTP login and private pages for all 6 roles; incomplete-profile redirect; muted write rejection; 6 topics; pagination; avatar. Manual interaction state retained.');
