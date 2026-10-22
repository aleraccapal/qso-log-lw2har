/* QSO Log v1.5 — red preferida para actualizaciones; caché como respaldo offline.
 * Solo recursos propios. No guarda tokens, mapas ni llamadas a Google en CacheStorage.
 */
const CACHE='qso-lw2har-offline-v1-5';
const FILES=['./','./index.html','./styles.css','./app.js','./adif.js','./sync-config.js','./sync.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)));
 self.skipWaiting();
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('qso-lw2har-')&&key!==CACHE).map(key=>caches.delete(key)))));
 self.clients.claim();
});
self.addEventListener('fetch',event=>{
 const request=event.request,u=new URL(request.url);
 if(request.method!=='GET'||u.origin!==self.location.origin)return;
 if(request.mode==='navigate'||['.html','.js','.css','.webmanifest'].some(ext=>u.pathname.endsWith(ext))){
   event.respondWith(fetch(request).then(response=>{
     if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});}
     return response;
   }).catch(()=>caches.match(request).then(hit=>hit||caches.match('./index.html'))));
 }else{
   event.respondWith(caches.match(request).then(hit=>hit||fetch(request).then(response=>{
     if(response.ok)caches.open(CACHE).then(cache=>cache.put(request,response.clone())).catch(()=>{});
     return response;
   })));
 }
});
