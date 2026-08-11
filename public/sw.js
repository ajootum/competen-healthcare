/*
 * Competen Practice — offline app shell. CP-OFFLINE-SURVEY-001 s3.3 step 4.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ ITS ONLY JOB IS TO LET THE PAGE BOOT. NO API RESPONSE EVER ENTERS THIS CACHE.
 *
 * The whole reason phase one caches an assembled read model in IndexedDB rather than HTTP responses in a
 * service worker is that a cached HTTP response cannot be labelled, cannot be scoped to a workspace,
 * cannot be expired at the end of the clinic day and cannot be purged when a practice switches the
 * feature off. A cached /practice/today document would render its own "Live" badge — it would ACTIVELY
 * ASSERT freshness it does not have, which is the exact failure this whole feature exists to prevent.
 *
 * So this file caches two things and refuses everything else:
 *
 *   1. /practice/offline  — one HTML document that contains NO patient data at all. It is a client
 *                           component that reads the encrypted IndexedDB store after it boots. Caching
 *                           it discloses nothing, because there is nothing in it.
 *   2. /_next/static/*    — hashed, immutable build assets. A new build produces new URLs, so these can
 *                           never go stale.
 *
 * Everything else — every /api/ route, every other document, every cross-origin request — is passed
 * straight to the network and its response is NEVER stored. `cachePolicy` below is the single place that
 * decides, and it is exported on `self` so that a harness can call it directly and can also drive the
 * fetch handler with a real /api/ request and assert that nothing was written.
 *
 * ⚠ THERE IS NO BACKGROUND SYNC, NO PERIODIC SYNC AND NO PUSH HANDLER HERE, deliberately. Phase one is
 * read-only: it accepts no input it cannot deliver, so there is nothing to deliver later. Registering a
 * sync handler would create the appearance of a queue that does not exist.
 */

/*
 * ⚠ BUMP THIS WHENEVER WHAT IS PRECACHED CHANGES, AND IT IS NOT BOOKKEEPING.
 *
 * `activate` deletes every cache whose key is not this one, so the name is the only eviction mechanism
 * there is. v1 held a shell and none of its assets; leaving the name alone would have left every device
 * that ever installed v1 holding that broken set for ever, because a worker with an unchanged script
 * and an unchanged cache name has no reason to rebuild anything.
 *
 * ⚠ AND CHANGING THE SCRIPT IS NOT ENOUGH ON ITS OWN. A browser keeps the OLD worker active until every
 * controlled tab is gone -- unregister() does not evict a worker that is still controlling a page. That
 * caught this change during verification: the logic was correct and the cache stayed empty, because the
 * v1 worker was still the one running.
 */
const CACHE = "competen-practice-shell-v2";
const SHELL = "/practice/offline";

/*
 * ⚠⚠ WHY THE SHELL ALONE WAS NOT ENOUGH, AND HOW THAT WAS FOUND.
 *
 * install used to do cache.add(SHELL) -- ONE HTML DOCUMENT -- and leave its stylesheet, its twenty-odd
 * JavaScript chunks and its font to be cached opportunistically, if and when they happened to be
 * requested while this worker was already running.
 *
 * Measured in a real browser on 2026-08-11: after install the cache held exactly one entry, and the page
 * needed TWENTY-ONE assets, of which TWENTY-ONE were missing. Offline that renders as the shell HTML with
 * no CSS and no JavaScript: unstyled serif text, and a client component that never boots, so the screen
 * sits on "Reading what is stored on this device..." for ever. Which is precisely what the owner saw.
 *
 * ⚠ AND IT GETS WORSE AFTER A REBUILD, WHICH IS THE STEADY STATE. The shell is fetched NETWORK-FIRST, so
 * it updates; the assets are cache-first-on-demand, so they lag. A new build changes every chunk URL, so
 * the cache ends up holding a fresh document that points at assets it does not have. The page was in that
 * state for as long as it has existed.
 *
 * So install now reads the shell it just cached, pulls the asset URLs out of it, and caches those too.
 * No build manifest is involved -- the document is the manifest, and it is the one this page will
 * actually be served.
 */
const ASSET_IN_HTML = /["'(]([^"'()\s]*\/_next\/static\/[^"'()\s]+)["')]/g;

/** The /_next/static/ URLs a document references. Deduped, same-origin, absolute. */
function assetsReferencedBy(html, origin) {
  const found = new Set();
  let m;
  while ((m = ASSET_IN_HTML.exec(html)) !== null) {
    try {
      // ⚠ TRAILING BACKSLASHES STRIPPED. Next embeds asset URLs inside the RSC payload with ESCAPED
      // quotes, so a naive capture ends at the backslash and yields ".../x.woff2\" -- which new URL
      // normalises to a path with a trailing slash. That caches a 404 and, worse, misses the real asset.
      const u = new URL(m[1].replace(/\\+$/, ""), origin);
      if (u.origin === origin) found.add(u.href);
    } catch {
      // A malformed match is skipped rather than allowed to abort the precache.
    }
  }
  return [...found];
}
self.__assetsReferencedBy = assetsReferencedBy;

/**
 * "shell" | "static" | "never" — the ONLY decision this worker makes.
 *
 * `never` is the default and every unlisted case falls into it, so a route added to the product tomorrow
 * is excluded rather than included by accident.
 */
function cachePolicy(request, selfOrigin) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return "never";
  }
  if (url.origin !== selfOrigin) return "never";
  // ⚠ FIRST, AND UNCONDITIONALLY. Nothing below may ever reach an /api/ path.
  if (url.pathname.startsWith("/api/")) return "never";
  if (url.pathname === SHELL) return "shell";
  if (url.pathname.startsWith("/_next/static/")) return "static";
  // A navigation anywhere inside Practice is answered from the shell when the network is gone. The
  // RESPONSE is not cached — only the shell document already in the cache is served.
  if (request.mode === "navigate" && url.pathname.startsWith("/practice")) return "shell";
  return "never";
}

// The testing seam. A policy asserted only by reading this file would be a policy nobody had run.
self.__cachePolicy = cachePolicy;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) =>
        // ⚠ THE DOCUMENT FIRST, THEN WHAT IT NEEDS IN ORDER TO BE MORE THAN A DOCUMENT.
        fetch(SHELL, { cache: "reload" })
          .then((res) => {
            if (!res || !res.ok) throw new Error("shell unavailable");
            const copy = res.clone();
            return res.text().then((html) => cache.put(SHELL, copy).then(() => html));
          })
          .then((html) => {
            const assets = assetsReferencedBy(html, self.location.origin);
            // ⚠ addAll would abort the WHOLE precache if any single asset 404s, leaving the shell cached
            // and nothing else -- the exact state this replaces. Each is allowed to fail on its own.
            return Promise.all(assets.map((u) =>
              fetch(u).then((r) => (r && r.ok && r.type === "basic" ? cache.put(u, r) : null)).catch(() => null)));
          }))
      // ⚠ A precache that fails must not stop the worker installing. The consequence is that the offline
      // page is unavailable until the next successful load — which is honest — whereas a rejected install
      // leaves the previous worker in place with no way to say why.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const policy = cachePolicy(event.request, self.location.origin);
  // ⚠ THE DEFAULT PATH DOES NOT CALL event.respondWith AT ALL. The request goes to the network exactly as
  // it would with no service worker installed, and no response object is ever handed to a cache.
  if (policy === "never") return;

  if (policy === "static") {
    event.respondWith(
      caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
        // Only a real, complete, same-origin success is stored. An opaque or partial response cached here
        // would be served back as though it were the asset.
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })),
    );
    return;
  }

  // policy === "shell": NETWORK FIRST, so an online device never sees a cached document.
  const isShellItself = new URL(event.request.url).pathname === SHELL;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (isShellItself && res && res.ok && res.type === "basic") {
          // ⚠ THE DOCUMENT AND ITS ASSETS ARE REFRESHED TOGETHER, OR NOT AT ALL.
          //
          // This used to cache the new HTML alone. The precache that captures its stylesheet and chunks
          // runs at INSTALL, and install does not re-run for a worker whose script has not changed -- so
          // after a deploy the cache would hold a FRESH document pointing at assets it did not have, and
          // the next offline visit would be the unstyled skeleton this whole file exists to prevent.
          // That state was reached for real on 2026-08-11.
          //
          // A normal page load happens to request the new assets, and the `static` branch catches them.
          // A refresh that is NOT a full page load -- a prefetch, an RSC fetch, a background update --
          // does not, and leaves the two out of step silently.
          const forCache = res.clone();
          const forScan = res.clone();
          caches.open(CACHE).then((cache) =>
            cache.put(SHELL, forCache).then(() =>
              forScan.text().then((html) =>
                Promise.all(assetsReferencedBy(html, self.location.origin).map((u) =>
                  // Already-cached assets are re-fetched cheaply from the HTTP cache; a miss is what
                  // this is for. Each may fail alone -- see install.
                  fetch(u).then((r) => (r && r.ok && r.type === "basic" ? cache.put(u, r) : null))
                    .catch(() => null))))))
            // ⚠ Never allowed to affect the response. The practitioner gets their page whether or not
            // the cache could be brought up to date behind it.
            .catch(() => undefined);
        }
        return res;
      })
      .catch(() => (isShellItself
        ? caches.match(SHELL).then((hit) => hit || Response.error())
        // ⚠ A REDIRECT, NOT THE SHELL BODY SERVED AT SOMEBODY ELSE'S URL. Answering /practice/today with
        // the offline document would leave the address bar claiming a page the browser is not showing,
        // and would hand the client router a route it did not ask for. The browser is sent to
        // /practice/offline instead, which this worker then answers from the cache.
        : Promise.resolve(Response.redirect(new URL(SHELL, self.location.origin).href, 302)))),
  );
});
