/* EGO service worker — réseau d'abord (toujours la dernière version quand tu es en ligne),
   cache de secours quand tu es hors-ligne. Les appels API (Gemini, géocodage) passent directement. */
const CACHE = 'ego-v1';

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  var url = new URL(req.url);
  // On ne touche qu'aux GET de même origine (l'app elle-même). Les API externes passent normalement.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(function (resp) {
      try { var cp = resp.clone(); caches.open(CACHE).then(function (c) { c.put(req, cp); }); } catch (err) {}
      return resp;
    }).catch(function () {
      return caches.match(req).then(function (r) { return r || caches.match('./index.html') || caches.match('index.html'); });
    })
  );
});
