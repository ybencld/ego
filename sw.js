/* ===================================================================
   EGO — service worker
   CACHE D'ABORD : la coquille (index.html) est servie depuis le cache
   INSTANTANÉMENT. Plus jamais d'attente réseau avant le premier pixel,
   donc plus jamais d'écran blanc au lancement depuis l'écran d'accueil.
   La nouvelle version est téléchargée en arrière-plan
   (stale-while-revalidate) ; quand elle diffère, on prévient la page
   qui affiche la pastille « Nouvelle version — recharger ».
   Les appels API (Gemini, Wikipédia, géocodage, tuiles carto) ne sont
   jamais interceptés : ils passent directement au réseau.
   =================================================================== */
var CACHE = 'ego-v2';
var SHELL = ['./', './index.html'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL).catch(function () {}); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
                               .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* empreinte rapide d'un texte : sert à savoir si la version a changé */
function fingerprint(txt) {
  var h = 5381, i = txt.length;
  while (i) { h = (h * 33) ^ txt.charCodeAt(--i); }
  return (h >>> 0) + ':' + txt.length;
}

function notifyUpdate() {
  return self.clients.matchAll({ type: 'window' }).then(function (cs) {
    cs.forEach(function (c) { c.postMessage({ type: 'EGO_UPDATE' }); });
  });
}

function isShell(url) {
  return url.pathname.slice(-1) === '/' || /index\.html$/.test(url.pathname);
}

/* met à jour le cache en arrière-plan et prévient si le contenu a bougé */
function revalidate(req, cached, shell) {
  return fetch(req, { cache: 'no-store' }).then(function (fresh) {
    if (!fresh || !fresh.ok || fresh.type === 'opaque') return;
    return caches.open(CACHE).then(function (c) {
      if (!shell || !cached) return c.put(req, fresh.clone());
      return Promise.all([cached.clone().text(), fresh.clone().text()]).then(function (r) {
        var changed = fingerprint(r[0]) !== fingerprint(r[1]);
        return c.put(req, fresh.clone()).then(function () {
          if (changed) return notifyUpdate();
        });
      });
    });
  }).catch(function () { /* hors ligne : on garde le cache, c'est tout */ });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  /* on ne touche QU'À l'app elle-même : Gemini, Wikipédia, géocodage, tuiles = réseau direct */
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(req, { ignoreSearch: true }).then(function (cached) {
        var nav = (req.mode === 'navigate') || isShell(url);

        if (!cached && nav) {
          /* la navigation retombe toujours sur la coquille en cache */
          return c.match('./index.html', { ignoreSearch: true }).then(function (shellHit) {
            if (shellHit) { e.waitUntil(revalidate(req, shellHit, true)); return shellHit; }
            return fromNetwork(c, req, nav);
          });
        }
        if (cached) {
          /* PREMIER PIXEL IMMÉDIAT : on rend le cache, on revalide derrière */
          e.waitUntil(revalidate(req, cached, nav));
          return cached;
        }
        return fromNetwork(c, req, nav);
      });
    })
  );
});

function fromNetwork(c, req, nav) {
  return fetch(req).then(function (resp) {
    if (resp && resp.ok && resp.type === 'basic') {
      try { c.put(req, resp.clone()); } catch (err) {}
    }
    return resp;
  }).catch(function () {
    return c.match('./index.html', { ignoreSearch: true }).then(function (r) {
      return r || new Response('', { status: 504, statusText: 'hors ligne' });
    });
  });
}

self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
