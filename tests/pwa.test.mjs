import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('install manifest and PNG icons support standalone launch',async()=>{
  const m=JSON.parse(await readFile('dist/manifest.webmanifest','utf8'));assert.equal(m.name,'K-파운틴');assert.equal(m.display,'standalone');assert.equal(m.start_url,'./');
  for(const icon of m.icons){const png=await readFile('dist/'+icon.src.slice(2));assert.equal(png.readUInt32BE(16),parseInt(icon.sizes));}
});
test('installed worker serves the app and DOCX chunks offline without forcing an update',async()=>{
  const handlers={},stores=new Map();let claimed=false;
  const origin='https://example.test/',self={location:new URL(origin),registration:{scope:origin},clients:{async claim(){claimed=true;}},addEventListener(name,callback){handlers[name]=callback;}};
  const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const map=stores.get(name);return {async addAll(urls){for(const url of urls)map.set(new URL(url,origin).pathname,await readFile('dist/'+(url==='./'?'index.html':url.slice(2))));},async match(request){return map.get(new URL(typeof request==='string'?request:request.url,origin).pathname);}};},async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);}};
  vm.runInNewContext(await readFile('dist/sw.js','utf8'),{self,caches,URL,fetch(){throw Error('offline');}});
  let task;handlers.install({waitUntil(p){task=p;}});await task;handlers.activate({waitUntil(p){task=p;}});await task;assert.ok(claimed);
  const paths=[...stores.values()][0];assert.ok([...paths.keys()].some(p=>/exports-.*\.js/.test(p)));
  for(const path of ['/','/app.js','/app.css',...paths.keys()].filter(p=>!p.endsWith('.woff2'))){let response;handlers.fetch({request:{method:'GET',url:origin.slice(0,-1)+path,mode:path==='/'?'navigate':'cors'},respondWith(p){response=p;}});assert.ok((await response).length,path);}
  assert.equal(typeof self.skipWaiting,'undefined');
});
