import {select,execute} from './db.mjs';

// Each record stores its driver: old MySQL objects and future cloud objects can coexist.
const stores=new Map([['mysql',{
  async put({key,bytes}){await execute('INSERT INTO forum_image_blobs(storage_key,content) VALUES (?,?)',[key,bytes]);},
  async get(key){const [row]=await select('SELECT content FROM forum_image_blobs WHERE storage_key=?',[key]);return row?.content||null;},
  async delete(key){await execute('DELETE FROM forum_image_blobs WHERE storage_key=?',[key]);}
}]]);
export function registerForumImageStore(name,adapter){
  if(!/^[a-z][a-z0-9_-]{0,31}$/.test(name)||stores.has(name)||!['put','get','delete'].every(k=>typeof adapter?.[k]==='function'))throw Error('Invalid or duplicate forum image storage adapter');
  stores.set(name,adapter);
}
export function forumImageStore(name){const store=stores.get(name);if(!store)throw Error(`Forum image storage adapter is not registered: ${name}`);return store;}
