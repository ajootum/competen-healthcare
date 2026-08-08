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

const CACHE = "competen-practice-shell-v1";
const SHELL = "/practice/offline";

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
      .then((cache) => cache.add(SHELL))
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
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(SHELL, copy));
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
