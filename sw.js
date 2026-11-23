/* 춘해보건대학교 앵커사업단 앱 서비스 워커 — 항상 최신 홈페이지를 먼저 불러오고, 인터넷이 끊겼을 때만 안내 화면을 보여 줌 */
const C='anchor-app-v1';
const PRE=['/offline.html','/img/app/icon-192.png','/img/app/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(PRE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  if(e.request.mode!=='navigate')return;
  e.respondWith(fetch(e.request).catch(()=>caches.match('/offline.html')));
});
