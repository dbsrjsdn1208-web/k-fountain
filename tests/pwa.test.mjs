import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('install manifest, versioned entry files and PNG icons support standalone launch',async()=>{
  const m=JSON.parse(await readFile('dist/manifest.webmanifest','utf8'));assert.equal(m.name,'K-파운틴');assert.equal(m.display,'standalone');assert.equal(m.start_url,'./');
  for(const icon of m.icons){const png=await readFile('dist/'+icon.src.slice(2));assert.equal(png.readUInt32BE(16),parseInt(icon.sizes));}
  const html=await readFile('dist/index.html','utf8');const script=html.match(/src="\.\/(app-[\w-]+\.js)"/)[1],style=html.match(/href="\.\/(app-[\w-]+\.css)"/)[1];assert.ok((await readFile('dist/'+script)).length);assert.ok((await readFile('dist/'+style)).length);assert.ok(html.includes(`name="k-fountain-version" content="${script}"`));
});

async function worker(){
  const handlers={},stores=new Map(),origin='https://example.test/k-fountain/';let network=()=>{throw Error('offline');},claimed=false,waiting=0,clients=[];const requests=[];
  const path=request=>new URL(typeof request==='string'?request:request.url,origin).pathname;
  const self={registration:{scope:origin},clients:{async claim(){claimed=true;},async matchAll(){return clients;}},async skipWaiting(){waiting++;},addEventListener(name,callback){handlers[name]=callback;}};
  const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const map=stores.get(name);return {async addAll(urls){for(const request of urls){requests.push(request);map.set(path(request),await readFile('dist/'+(path(request)===new URL(origin).pathname?'index.html':path(request).slice(new URL(origin).pathname.length))));}},async match(request){return map.get(path(request));}};},async match(request){for(const map of stores.values()){const value=map.get(path(request));if(value)return value;}},async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);}};
  vm.runInNewContext(await readFile('dist/sw.js','utf8'),{self,caches,URL,Request,fetch:(...args)=>network(...args)});
  const event=async(name,data={})=>{let pending;handlers[name]({...data,waitUntil(p){pending=p;}});await pending;};
  const fetch=async(p,mode='cors')=>{let response;handlers.fetch({request:{method:'GET',url:new URL(p,origin).href,mode},respondWith(p){response=p;}});return response;};
  return {stores,requests,origin,event,fetch,set network(fn){network=fn;},set clients(value){clients=value;},get waiting(){return waiting;},get claimed(){return claimed;}};
}

test('worker prepares fresh assets and activates without reloading any editor',async()=>{
  const w=await worker();await w.event('install');await w.event('activate');assert.equal(w.waiting,1);assert.equal(w.claimed,true);assert.ok(w.requests.every(r=>r.cache==='reload'));
});

test('installed editor and DOCX chunks remain available offline under the repository path',async()=>{
  const w=await worker();await w.event('install');const paths=[...w.stores.values()][0];assert.ok([...paths.keys()].some(p=>/exports-.*\.js/.test(p)));
  for(const path of paths.keys()){const result=await w.fetch(path,path===new URL(w.origin).pathname?'navigate':'cors');assert.ok(result.length,path);}
});

test('online navigation bypasses the old cached document and standalone downloads',async()=>{
  const w=await worker();await w.event('install');const calls=[];w.network=async(request,options)=>{calls.push(options);return 'new document';};assert.equal(await w.fetch('./','navigate'),'new document');assert.equal(await w.fetch('./K-파운틴.html','navigate'),'new document');assert.ok(calls.every(o=>o.cache==='no-cache'));
});

test('old editor assets survive activation until all clients report the current entry version',async()=>{
  const w=await worker();w.stores.set('k-fountain-old',new Map([['/k-fountain/chunks/old.js',Buffer.from('old chunk')]]));await w.event('install');await w.event('activate');assert.equal((await w.fetch('./chunks/old.js')).toString(),'old chunk');
  w.clients=[{id:'old',url:w.origin},{id:'new',url:w.origin}];const html=await readFile('dist/index.html','utf8'),version=html.match(/name="k-fountain-version" content="([^"]+)"/)[1];
  await w.event('message',{data:{type:'K_FOUNTAIN_READY',version},source:{id:'new'}});assert.ok(w.stores.has('k-fountain-old'));
  await w.event('message',{data:{type:'K_FOUNTAIN_READY',version:'older-entry.js'},source:{id:'old'}});assert.ok(w.stores.has('k-fountain-old'));
  await w.event('message',{data:{type:'K_FOUNTAIN_READY',version},source:{id:'old'}});assert.ok(!w.stores.has('k-fountain-old'));
});

test('offline unrelated navigation never substitutes the editor for an HTML download',async()=>{
  const w=await worker();await w.event('install');await assert.rejects(w.fetch('./K-파운틴.html','navigate'),/offline/);assert.ok((await w.fetch('./index.html','navigate')).length);
});
