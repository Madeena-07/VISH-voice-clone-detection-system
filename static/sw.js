const CACHE='vish-working-premium-v4-callfix';
const ASSETS=['/','/static/styles.css','/static/app.js','/static/manifest.json','/static/logo.svg'];
self.addEventListener('install',e=>e.waitUntil((async()=>{await caches.open(CACHE).then(c=>c.addAll(ASSETS));await self.skipWaiting()})()));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{if(e.request.method==='GET'&&new URL(e.request.url).origin===location.origin)e.respondWith(fetch(e.request,{cache:'no-store'}).catch(()=>caches.match(e.request)))});
