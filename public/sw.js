// FireLine service worker (installable app, user 10 Nov 2026). Kept small on purpose:
//  - build files: cache first (their names change with every build); icons and pictures: from cache, refreshed behind;
//  - pages: always from the network; without a connection the field report page opens from its last copy, anything
//    else shows /offline.html;
//  - data and API calls (/fire/…): never cached, so hotspots and reports are always current.
const VERSION = "fl-v1";
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC)
      .then((c) => c.addAll([OFFLINE, "/favicon.svg", "/brand/fireline-mark.svg", "/icons/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// build files carry a hash in their name: cache first. Icons, pictures and the map mask keep their names: answer from the
// cache and refresh it in the background, so a changed picture shows from the next visit.
const isBuild = (p) => p.startsWith("/assets/");
const isStatic = (p) => p.startsWith("/icons/") || p.startsWith("/brand/") || p.startsWith("/img/") || p === "/geo/idn-mask.json" || p === "/favicon.svg";

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isBuild(url.pathname) || isStatic(url.pathname)) {
    const build = isBuild(url.pathname);
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        const fresh = fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        });
        if (hit) {
          if (!build) event.waitUntil(fresh.catch(() => {}));
          return hit;
        }
        return fresh;
      }),
    );
    return;
  }

  if (req.mode === "navigate") {
    // a field report link opened once still opens without signal (the draft itself lives in the page's storage)
    const keep = url.pathname === "/fire/verify";
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (keep && res.ok) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => (keep && (await caches.match(req, { cacheName: PAGES }))) || (await caches.match(OFFLINE))),
    );
  }
});

// Fire notifications (10 Nov 2026): the server sends { title, body, url, tag } (src/lib/push.server.ts). They arrive
// while FireLine is closed; tapping one opens the case (an open FireLine window is reused).
self.addEventListener("push", (event) => {
  let msg = { title: "FireLine", body: "", url: "/", tag: "fl" };
  try {
    msg = { ...msg, ...event.data.json() };
  } catch {
    if (event.data) msg.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: msg.tag,
      renotify: true,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-maskable-192.png",
      data: { url: msg.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && "focus" in c) {
          return c.navigate(target).then((w) => (w || c).focus()).catch(() => c.focus());
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
