const C='bt-v16';const A=['./','./index.html','./manifest.json','./telepites.html','./icon-192.png','./icon-512.png','https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>Promise.allSettled(A.map(u=>c.add(new Request(u,{cache:'reload'}))))));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const same=new URL(e.request.url).origin===location.origin;const req=same?new Request(e.request,{cache:'no-cache'}):e.request;
e.respondWith(fetch(req).then(r=>{if(e.request.method==='GET'&&r.ok){const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));}return r;}).catch(()=>caches.match(e.request,{ignoreSearch:true})));});
