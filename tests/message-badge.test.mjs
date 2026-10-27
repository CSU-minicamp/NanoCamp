import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/forum-nav.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const events=new Map(),requests=[],badges=[{hidden:true},{hidden:true}],attributes={};
 const link={classList:{contains:()=>true},querySelector:selector=>selector==='[data-account-label]'?{textContent:'测试用户'}:badges[1],setAttribute:(key,value)=>{attributes[key]=value;}};
 const document={hidden:false,querySelector:()=>link,querySelectorAll:()=>badges,addEventListener:()=>{}};
 const window={addEventListener:(type,listener)=>events.set(type,listener),dispatchEvent:()=>{}};
 runInNewContext(source,{document,window,localStorage:{},console,CustomEvent:class{},setInterval:()=>{},fetch:()=>new Promise(resolve=>requests.push(data=>resolve({ok:true,json:async()=>data})))});
 return {badges,attributes,requests,emit:(type,detail)=>events.get(type)({detail})};
}
test('私信角标与列表一致，不混入关注、回复和系统通知',async()=>{
 const f=fixture();f.requests.shift()({dm_unread:1,activity_unread:16,system_unread:1,total_unread:18});await tick();
 assert.deepEqual(f.badges.map(b=>[b.textContent,b.hidden]),[[1,false],[1,false]]);
 assert.match(f.attributes['aria-label'],/1 条未读消息/);
 f.emit('forum-notifications-changed');f.requests.shift()({dm_unread:0,activity_unread:16,system_unread:1,total_unread:17});await tick();
 assert.ok(f.badges.every(b=>b.hidden));
});
test('统计请求期间发生已读更新，不丢失刷新也不显示旧计数',async()=>{
 const f=fixture();f.emit('forum-notifications-changed');
 f.requests.shift()({dm_unread:2,total_unread:20});await tick();
 assert.equal(f.requests.length,1);assert.ok(f.badges.every(b=>b.hidden));
 f.requests.shift()({dm_unread:0,total_unread:18});await tick();
 assert.ok(f.badges.every(b=>b.hidden));
});
test('99+显示和退出登录时两个角标同时清除',async()=>{
 const f=fixture();f.requests.shift()({dm_unread:101,total_unread:120});await tick();
 assert.ok(f.badges.every(b=>b.textContent==='99+'&&!b.hidden));
 f.emit('nanocamp-session',{signedIn:false});await tick();
 assert.ok(f.badges.every(b=>b.hidden));assert.doesNotMatch(f.attributes['aria-label'],/未读消息/);
});
