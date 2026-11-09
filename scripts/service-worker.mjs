// Activate a prepared bundle without reloading an open manuscript. Old bundles
// remain available until every open editor has reported the current version.
export function workerSource(cache,assets,appVersion){return `const CACHE=${JSON.stringify(cache)},ASSETS=${JSON.stringify(assets)},APP=${JSON.stringify(appVersion)},readyClients=new Set();
self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open(CACHE);await c.addAll(ASSETS.map(p=>new Request(new URL(p,self.registration.scope),{cache:'reload'})));await self.skipWaiting();})()));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('message',e=>{if(e.data?.type!=='K_FOUNTAIN_READY'||e.data.version!==APP||!e.source?.id)return;readyClients.add(e.source.id);e.waitUntil((async()=>{const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});const editors=clients.filter(c=>c.url.startsWith(self.registration.scope));if(editors.length&&editors.every(c=>readyClients.has(c.id)))await Promise.all((await caches.keys()).filter(k=>k.startsWith('k-fountain-')&&k!==CACHE).map(k=>caches.delete(k)));})());});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url),root=new URL(self.registration.scope);if(e.request.method!=='GET'||u.origin!==root.origin||!u.pathname.startsWith(root.pathname))return;
if(e.request.mode==='navigate'){e.respondWith((async()=>{try{return await fetch(e.request,{cache:'no-cache'});}catch(error){if(u.pathname===root.pathname||u.pathname===new URL('./index.html',root).pathname)return await (await caches.open(CACHE)).match('./index.html');throw error;}})());return;}
e.respondWith((async()=>await caches.match(e.request)||fetch(e.request))());});
`;}
