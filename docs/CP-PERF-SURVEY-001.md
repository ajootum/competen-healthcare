# CP-PERF-SURVEY-001 — Making Competen Practice load on a slow link

**Question asked:** *"How do we make the pages easy and fast load, so they work even when we have poor data speeds?"*
**Deployment context that governs every answer:** a shared Android phone on 2G/3G in a Ugandan clinic — not a laptop on fibre. `docs/CP-OFFLINE-SURVEY-001.md:977-979` already settled this and chose PWA-first for exactly that reason.

**Date:** 2026-08-08. **Build measured:** Next.js 16.2.9 (Turbopack), `next build` exit 0, 489 pages generated, TypeScript clean.
**Nothing in this survey was written to the repository except this file.** No code change, no migration, no commit, no staging.

---

## 0. How to read this document

Three registers, never blurred:

- **MEASURED** — a number I produced by running something or reading a file. Every one names the command or the file:line it came from.
- **INFERRED** — arithmetic or reasoning over a measured number, with the assumption stated.
- **RECOMMENDED** — a change I am proposing. Nothing here has been made.

⚠ **A failed read is never a zero**, and neither is an unmeasurable one. Where I could not measure something, §11 says so and why.

### 0.1 Two things that limit every number below

**(a) The practice I measured against is nearly empty.** There are exactly two `practice_workspace` rows in this database. I used `b7c5dbc1-…7135b` ("Trial", `Africa/Kampala`), which holds **2 patients and 1 encounter** (measured — `practice_patient`/`practice_encounter` count with `count: "exact"`). Round-trip **counts** and **serialisation depth** are structural and do not depend on data volume; **response sizes** and anything that fans out per row will be larger in a real practice. Each figure below says which kind it is.

**(b) ⚠ Another process was editing this repository while I surveyed it.** `git status` at the end of the session showed five modified files I did not touch (`availability-config.ts`, `booking-rules.ts`, `booking-rule-constants.ts`, `patient-booking.ts`, `scheduling.ts`) plus an untracked `scripts/_probe-tmp.ts`, with mtimes of 22:41–22:59 — inside my session window. I re-verified every line number I cite in those files immediately before writing this (§9 lists the re-verified ones), but the `next build` output in §2 was produced at 22:11–22:31 and therefore describes a slightly earlier tree. Treat booking-related line numbers as needing a fresh `grep` before anyone acts on them.

---

## 1. ⚠ Three things in the brief are wrong. Evidence first.

### 1.1 `next build` no longer reports route size or First Load JS. This is deliberate, in this version.

The brief asked for "route sizes, First Load JS per route" from the build. **The real output contains no size columns at all** — `grep -c "kB" build.log` returns **0** across 1,367 lines. This is not a truncated build; it is the documented behaviour of Next 16:

> `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md:1000` — "**Next.js 16** removes the `size` and `First Load JS` metrics from the `next build` output. We found these to be inaccurate in server-driven architectures using React Server Components."

So I reconstructed the numbers from the build artefacts instead — `.next/server/app/**/page_client-reference-manifest.js` (the per-route client module → chunk map) joined to the real bytes of each chunk on disk, gzipped at level 9. That is §2, and it is a stronger measurement than the removed column ever was because it is the actual files.

### 1.2 The guess "lots of sequential Supabase reads per render" is **half right**, and the wrong half matters.

The reads are real and numerous (§3). But **Next 16 memoises identical `GET` and `HEAD` fetches within a single server render pass**, unconditionally, and Supabase's PostgREST client is plain `fetch`:

- `node_modules/next/dist/server/lib/dedupe-fetch.js:84-140` — `createDedupeFetch`, keyed on method + all headers (bar `traceparent`/`tracestate`) + mode/redirect/credentials/referrer/referrerPolicy/integrity, backed by `React.cache`.
- `node_modules/next/dist/server/lib/patch-fetch.js:960-968` — `patchFetch()` wraps `globalThis.fetch` with it.
- `node_modules/next/dist/server/app-render/app-render.js:1328` — `ComponentMod.patchFetch()` is called on **every** App Router render. It is not gated on `cacheComponents`.
- `node_modules/@supabase/postgrest-js/dist/index.mjs:296-301` — the request is `_fetch(url, { method, headers, body, signal })`, and `signal` is `undefined` unless `.abortSignal()` is used. `dedupe-fetch.js:88` only opts out when `options.signal` is **truthy**. So Supabase reads are deduped.

**Measured consequence.** For a full load of `/practice/home` my harness issued **110** Supabase requests; **79** of them are distinct `(method, url)` pairs. Inside a real render pass the other **31 never leave the server**. The single worst-looking N+1 in the product (§4.1) collapses from **34 requests to 6**.

⚠ This does not make the loops harmless — it makes them a *code-clarity* problem rather than a *latency* problem, and it changes which fixes are worth doing. It also does **not** apply to Route Handlers: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/fetch.md:95` — "Memoization does not apply in Route Handlers." Every `/api/v1/practice/*` route pays the un-deduped count.

### 1.3 On this product, on 2G, **the JavaScript is the problem and the data is not.**

Measured, same practice, same moment:

| | gzip bytes |
|---|---|
| `/practice/home` client JavaScript | **259.1 kB** |
| `/practice/encounters/[encounterId]` client JavaScript | **410.5 kB** |
| The entire `dashboardReadModel` payload that drives `/practice/home` and `/practice/today` | **3.7 kB** |
| The entire `patientsWorkspace` payload that drives `/practice/patients` | **3.4 kB** |

The data a practitioner actually needs is **1.4 %** of what the browser downloads to display it. Any plan that starts with the queries is optimising the small number.

---

## 2. MEASURED — what the browser downloads

### 2.1 Method

`page_client-reference-manifest.js` for all **1,345** app routes → union of chunk URLs → real file sizes from `.next/static/chunks/` → gzip level 9. Baseline = `build-manifest.json` `rootMainFiles` + `polyfillFiles`, which every route pays.

### 2.2 Client JavaScript per practice route

**Baseline every route pays:** 6 files, 556.4 kB raw / **167.7 kB gzip**.

| route | chunks | total gzip | total raw | route's own (excl. baseline) |
|---|---:|---:|---:|---:|
| `/practice/encounters/[encounterId]` | 13 | **410.5 kB** | 1,426.2 kB | 242.8 kB |
| `/practice/patients` | 13 | **409.8 kB** | 1,416.7 kB | 242.0 kB |
| `/practice/settings` | 13 | 382.8 kB | 1,316.0 kB | 215.0 kB |
| `/practice/activity` | 12 | 378.7 kB | 1,298.3 kB | 211.0 kB |
| `/practice/setup/availability-booking` | 12 | 284.6 kB | 1,006.1 kB | 116.8 kB |
| `/practice/patients/[patientId]` | 11 | 272.8 kB | 950.3 kB | 105.0 kB |
| `/practice/calendar` | 12 | 271.2 kB | 949.9 kB | 103.5 kB |
| `/practice/today` | 11 | 261.4 kB | 906.0 kB | 93.6 kB |
| `/practice/home` | 11 | 259.1 kB | 894.4 kB | 91.3 kB |
| *lightest practice shell route* (e.g. `/practice/setup`) | 10 | 255.0 kB | 881.9 kB | 87.3 kB |

Across all 1,345 routes: min 167.7 kB, median 189.2 kB, max 410.5 kB gzip. `.next/static/chunks` holds 6,060.5 kB raw in total.

**Read that as:** the floor for any screen behind the practice login is **255 kB gzip of JavaScript**, and two of the most-used clinical screens are **410 kB**.

### 2.3 ⚠ 120.7 kB gzip of that is a Node crypto polyfill nobody asked for

Chunk `0-n2l_mrry_hx.js` is **415,131 bytes raw / 120,706 bytes gzip**. Fingerprinting its contents (identifier-frequency scan) shows `readable-stream`, `createCipheriv`/`createDecipheriv`, `asn1.js` (`subjectPrivateKey`), `elliptic` (`recoveryParam`) — i.e. the browserified Node `crypto` stack — plus one recognisable string of ours, `practice_audit_event`.

It is carried by exactly **four** routes (scan of all 1,345 client-reference manifests): `/practice/activity`, `/practice/encounters/[encounterId]`, `/practice/patients`, `/practice/settings`.

**Why.** A client component imports a *constant* from a module whose first line reaches a server-only module:

| route | client file | imports | which imports | which imports |
|---|---|---|---|---|
| `/practice/patients` | `src/app/practice/(shell)/patients/RegistryConsole.tsx:6` — `import { steps } from "@/lib/practice/registration-workspace"` | → `registration-config.ts:1` | `import { audit } from "@/lib/practice/provisioning"` | `provisioning.ts:1` — `import { createHash } from "node:crypto"` |
| `/practice/encounters/[encounterId]` | `.../encounters/[encounterId]/DocumentationTools.tsx:5` — `import { ATTACHMENT_KINDS } from "@/lib/practice/documentation-tools"` | → `documentation-tools.ts:1` | same | same |
| `/practice/settings` | `.../settings/SettingsConsole.tsx:5` — `import { FACILITY_TYPES } from "@/lib/practice/facilities"` | → `facilities.ts:1` | same | same |
| `/practice/activity` | `.../activity/ActivityConsole.tsx:5` — `import { ACTIVITY_KINDS, PARTICIPATION } from "@/lib/practice/clinical-activity"` | → `clinical-activity.ts:1` | same | same |

`provisioning.ts` has exactly one import line, and it is `node:crypto`. Four constant lists cost **120.7 kB gzip each time**, on four screens including the two heaviest clinical ones.

### 2.4 The other big shared chunk

`0_yc-u7rwr7cc.js` — 221,485 bytes raw / **55.7 kB gzip** — contains `supabase-js` including the realtime WebSocket client. **Every** practice shell route carries it (it is in `/practice/home` too). No practice screen surveyed opens a realtime channel; the only `realtime` channel in the repo is `src/app/educator/studio/frameworks/Authoring.tsx` (per `next.config.ts:47-50`).

### 2.5 CSS, fonts, favicon

Measured on disk and over the wire from a real `next start` on port 3111.

| asset | raw | gzip | header measured |
|---|---:|---:|---|
| `.next/static/chunks/3cc_fbve9-vkh.css` (Tailwind v4 + `globals.css`) | 239,433 B | **33,897 B** | `Content-Encoding: gzip`, `Cache-Control: public, max-age=31536000, immutable` |
| `.next/static/chunks/2ip0zcebnm0-n.css` (`@font-face` only) | 1,711 B | 690 B | same |
| `caa3a2e1cccd8315-s.p.…woff2` (Geist, latin) | **29,288 B** | (already compressed) | `<link rel="preload" as="font">` |
| `favicon.…ico` | **25,931 B** | not compressed (`Content-Length: 25931`) | |

- **CSS is one global file for every route in the whole product** — all 13 prerendered HTML files reference the same two stylesheets. It is `<link rel="stylesheet">` in `<head>`, therefore render-blocking.
- **Fonts are self-hosted** (`13-fonts.md:13,96`), `font-display: swap`, one subset preloaded. Not render-blocking for text.
- ⚠ **The preloaded font is never used inside `/practice/(shell)`.** `src/app/layout.tsx:53` puts `geist.variable` on `<html>`, which only defines `--font-geist-sans`. `src/app/globals.css:122` sets `body { font-family: Arial, Helvetica, sans-serif; }`. `globals.css:299` defines `--cp-font-base: var(--font-geist-sans), …` and **`grep -rn "cp-font-base" src/` returns that one line and no consumer**. `src/app/practice/(shell)/layout.tsx:113` uses `className="cp-surface min-h-screen bg-gray-50 flex"` and never sets a font family. `.next/server/next-font-manifest.json` nonetheless lists the woff2 against `[project]/src/app/practice/(shell)/*/page`, so the preload fires. **29,288 bytes downloaded at high priority and thrown away on every authenticated practice screen.**
- `globals.css:109` declares `--font-mono: var(--font-geist-mono)`; no `Geist_Mono` is imported anywhere. That variable is undefined.

### 2.6 Images and icons — clean, with one caveat

- `next/image` usages in `src/`: **0**. Raw `<img>`: **24**.
- **The authenticated practice app renders no images at all.** The only `/images/` strings under `src/app/practice/` are OpenGraph metadata (never fetched by a browser). The two real `<img>` tags are on the *public* marketing page `src/app/practice/page.tsx:134,167` — webp, 73,836 B and 122,294 B, both with explicit `width`/`height`.
- `public/` holds 63 files / 13,950,078 B. **26 of them (10,588,678 B, 76 %) are referenced from nowhere in `src/`** — all nine multi-megabyte PNGs, the eight `serve-*.png`, the ten `professions/*.webp`. They ship in the deployment and are publicly fetchable; no browser requests them.
- **No icon library is installed** (`package.json:12-22`). Icons are single Unicode glyphs held as strings — `src/lib/practice/navigation.ts:64` types `icon: string`, values at `:125` `"⌂"`, `:129` `"◷"`, `:134` `"↻"`, `:143` `"✧"`, `:147` `"⚙"` etc.; rendered bare at `SidebarNav.tsx:79,101`. **Zero network bytes.**
- ⚠ But those glyphs (U+2302, U+25F7, U+21BB, U+25A6, U+2727, U+2699, U+2611, U+270E, U+2315, U+25C8, U+25EB, U+2767, U+25CD, U+2687, U+26BF, U+26E8, U+21C4) fall outside **every** `unicode-range` in the emitted `@font-face` set, so they render from the device's fallback font. On a stripped-down Android build several will be tofu boxes. Free, but not risk-free.

### 2.7 ⚠ A correction to my own framing: the JS is downloaded once per build, not once per visit

Measured over the wire: every `/_next/static/*` asset is served `Cache-Control: public, max-age=31536000, immutable`. So a second visit **on the same device, on the same build, with the cache intact** re-uses them.

That softens the story and sharpens it at the same time:
- the 255–410 kB is paid on **first visit after every deploy**, and
- on a shared low-storage Android phone the HTTP cache is evicted aggressively, and
- the service worker that would make this durable is **shipped and switched off** (§6).

---

## 3. MEASURED — Supabase round trips per render

### 3.1 Method

An out-of-repo TypeScript harness patched `globalThis.fetch`, called the **exact loader sequence each page's server component runs**, and recorded method, URL, start and end for every request to the Supabase host. Run against the live "Trial" workspace with the service-role key. **`logAccess`, `touchSession` and `recordAuthEvent` were excluded** so the survey performed no writes — their cost is counted from code in §3.4.

"Serial depth" = the length of the longest chain of non-overlapping requests, i.e. how many round trips must happen one after another. **That is the number that multiplies by RTT.**

Measured per-request latency from this workstation: **median ≈ 200 ms** (visible in the trace deltas in §4.1). ⚠ That is a home link with Avast TLS interception in the path; a Vercel-and-Supabase-co-located deployment would be far lower, and **I could not measure the production figure**. Counts and depth are deployment-independent; wall-clock is not.

### 3.2 Results

| route (page body only) | raw requests | **deduped** | serial depth | wall (this machine) |
|---|---:|---:|---:|---:|
| `/practice/home` | 85 | **70** | 17 | 4,208 ms |
| `/practice/today` | 62 | — | 8 | 1,856 ms |
| `/practice/setup/availability-booking` | 61 | — | **26** | 5,390 ms |
| `/practice/encounters/[encounterId]` | 37 | — | 8 | 1,969 ms |
| `/practice/patients/[patientId]` | 30 | — | **16** | 3,316 ms |
| `/practice/patients` | 27 | — | 4 | 861 ms |
| `/practice/calendar` | 13 | — | 6 | 1,267 ms |
| `(shell)/layout.tsx` body, after the shell | 9 | — | 4 | 977 ms |
| read half of `resolvePracticeShell()` | 8 | — | 6 | 1,277 ms |

**Full navigation to `/practice/home`** — shell (layout) + layout body + shell (page) + page body, in order:
**110 raw → 79 deduped, serial depth 33, 7,823 ms on this machine.**

### 3.3 ⚠ `resolvePracticeShell()` runs twice per page load, and nothing memoises it

`src/app/practice/(shell)/layout.tsx:32` and `src/app/practice/(shell)/home/page.tsx:71` both call it. **63 files under `src/app/` call `resolvePracticeShell`.** There is no memoisation of our own:

- `grep -rn 'from "react"' src/lib | grep -i cache` → **no hits**. React `cache()` is used **nowhere** in this codebase.
- `grep -rn "unstable_cache|revalidateTag|revalidatePath|cacheLife|cacheTag|\"use cache\"" src` → **no hits**.

The GETs inside it are rescued by Next's fetch dedupe (§1.2). The **writes are not** — `dedupe-fetch.js:110-116` refuses anything that is not GET or HEAD. So on every page load:

- `touchSession` (`src/lib/practice/security.ts:257` read, `:281` update) — the **update runs twice**.
- `recordAuthEvent` (`src/lib/practice/auth-audit.ts:172` read, `:187` insert) — the read dedupes, the insert would run twice were it not for the `dedupeKey`.

The layout also duplicates page work outright: `layout.tsx:64` calls `todaysPlan`, and `dashboardReadModel` calls `todaysPlan` again (`src/lib/practice/dashboard.ts:169`); `layout.tsx:65` calls `resolvePreferences`, and `home/page.tsx:78` calls it again. Measured repeats inside one full load:

```
x6  practice_workspace?select=id,name,type,status,timezone,default_practice_type,country&id=eq.…
x6  practice_configuration?select=*&workspace_id=eq.…&is_effective=eq.true
x4  practice_membership?select=id,role_code,workspace_id,practice_workspace!workspace_id(…)
x3  practice_workspace?select=timezone&id=eq.…
x3  practice_user_preference?select=*&workspace_id=eq.…&user_id=eq.…
```

### 3.4 What the harness could not run, counted from code

Per shell resolution, i.e. **twice** per page load:
- `supabase.auth.getUser()` — `src/lib/practice/shell.ts:79`. `node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:2588-2612` shows it **always** issues `GET /auth/v1/user` over the network; there is no cache. Same URL and headers both times, so Next dedupes it to one per render.
- `src/proxy.ts:66` calls `auth.getUser()` **again**, in middleware — a separate runtime with no render pass, therefore **not deduped**. So **two GoTrue round trips per navigation**, minimum.
- `touchSession` read + write; `recordAuthEvent` read + conditional insert.

And two page bodies await a **write** before they can continue rendering:
- `src/app/practice/(shell)/encounters/[encounterId]/page.tsx:90` — `await logAccess(...)`
- `src/app/practice/(shell)/patients/[patientId]/page.tsx:84` — `await logAccess(...)`

### 3.5 ⚠ Nothing streams. Every practice page is one blocking server render.

- `loading.tsx` under `src/app/practice/`: **0** files (there are 5 elsewhere in `src/app`).
- `<Suspense` under `src/app/practice/`: **0** occurrences.
- `export const dynamic = "force-dynamic"` in `src/app/practice/`: **71** files (839 app-wide).

So TTFB for `/practice/home` is the whole of §3.2 — all 79 deduped round trips at depth 33 — before the first byte of HTML. `next build` marks every practice route `ƒ Dynamic` except four: `/practice/book`, `/practice/offline`, `/practice/patient-login` and `/practice` are `○ Static`.

Note that `force-dynamic` is largely **redundant** rather than harmful: these pages read `cookies()` and `headers()` through `resolvePracticeShell` and would be dynamic anyway. Its real cost is that it forecloses the static-shell option described in `cacheComponents.md`.

### 3.6 The two screens that re-fetch themselves for ever

`src/app/practice/(shell)/LiveRefresh.tsx` is mounted on `/practice/home` (`home/page.tsx:156`) and `/practice/today` (`today/page.tsx:91`). It does two things:

1. `LiveRefresh.tsx:124` — opens `new EventSource("/api/v1/practice/stream")`. That route (`src/app/api/v1/practice/stream/route.ts:33,34,37`) polls the outbox every **2 s** server-side, sends a `:heartbeat` comment every **25 s** down the wire, and force-reconnects every **10 minutes**.
2. `LiveRefresh.tsx:55,148` — `POLL_MS = 45_000`, `setInterval(() => router.refresh(), POLL_MS)`.

**Every 45 seconds, on a 2G phone, the command centre re-runs the entire server render** (the 70 deduped round trips of §3.2) and ships a fresh RSC payload down the link, whether or not anything changed. It does this for as long as the tab is open. Route Handlers get no fetch dedupe (`fetch.md:95`), so the SSE route's own reads are un-deduped too.

I could not measure the byte size of one `router.refresh()` RSC payload — that needs an authenticated session (§11).

---

## 4. MEASURED — repeated and fanned-out reads

### 4.1 The one real N+1, and why it costs less than it looks

`src/lib/practice/availability-config.ts:1116` — `for (const slot of ((slots ?? []) as any[]))`, and at `:1120` inside the loop, `const rule = await resolveBookingRule(admin, ctx.workspaceId, slot.location_id ?? null, appointmentType)`. `resolveBookingRule` (`:689`) issues an **unfiltered** read of every active booking rule in the workspace — the same query, every iteration.

Traced live, `bookingPreview` over a 14-day window:

```
### bookingPreview(14d): 19 trips, 3700ms
   +  399ms GET practice_booking_rule?select=location_id,appointment_type,lead_time_minutes,…
   +  837ms GET practice_booking_rule?select=location_id,…      <- identical
   + 1059ms GET practice_booking_rule?select=location_id,…      <- identical
   … 15 identical requests in all, strictly sequential, ~200ms apart …
```

**34 raw requests → 6 deduped.** ⚠ So inside a real page render this costs roughly **one** round trip, not fifteen: the loop still iterates sequentially but iterations 2–15 resolve from `React.cache`. It is O(slots) in *code shape* and O(1) in *network*. It is worth fixing for clarity and for the API route (`/api/v1/practice/availability-config`, no dedupe), not for the page.

### 4.2 The other loops-with-awaits

A scan of `src/lib/practice/**` and `src/app/practice/**` for an awaited PostgREST call lexically inside `for`/`while`/`.map`/`.forEach`/`.reduce` found **20** sites. **None of them is wrapped in `Promise.all`.** Sixteen are on write/mutation paths (`patients.ts:199,241,282,312`, `provisioning.ts:231,274,302,304`, `team.ts:151,369`, `follow-up-plans.ts:237,280`, `availability-config.ts:967,977`, `identity-service.ts:346`, `documentation-tools.ts:218`). Three are on render paths:

- `src/lib/practice/availability-config.ts:1116` — §4.1.
- `src/lib/practice/schedule-exceptions.ts:413` — a per-id `practice_location` read inside a loop, reached by `scheduleChanges` on `/practice/setup/availability-booking`. Different ids → **not** deduped. Live trace showed `practice_location x9` on that route.
- `src/lib/practice/metrics.ts:270-282` — `readIn()`, which chunks an `.in()` filter into batches of `IN_CHUNK = 100` (`:168`) and awaits them **sequentially**. Reached from `/practice/home` and `/practice/today`. Today that is 1 batch; at 400 appointments in a day it is 4 sequential round trips per call, and it is called at `:800`, `:910` and `:913`.

### 4.3 The genuinely serial page: `/practice/patients/[patientId]`

`src/app/practice/(shell)/patients/[patientId]/page.tsx` awaits, one after another with no `Promise.all` anywhere: `getPatient` (`:44`) → `patientTimeline` (`:53`) → `listFollowUps` (`:65`) → `patientFollowUps` (`:68`) → `listContacts` (`:73`) → `patientCorrespondence` (`:77`) → **`logAccess` write** (`:84`) → `patientAccessHistory` (`:89`) → `monitoringPlan` → `patientMedications`.

**Measured: 30 requests at serial depth 16** — the worst ratio on the product. `/practice/patients`, by contrast, does the right thing (`patients/page.tsx:87` — one `Promise.all` of five branches) and comes in at **27 requests, depth 4**.

`/practice/setup/availability-booking` is depth **26** for 61 requests: a `Promise.all` of six workspaces (`page.tsx:117`) followed by a serial `bookingPreview` (`page.tsx:157`).

---

## 5. MEASURED — what is cached today

**Nothing.** Not in the "we made a decision and it was no" sense — there is no caching layer at all.

| primitive | occurrences in `src/` |
|---|---|
| React `cache()` | **0** |
| `unstable_cache` | **0** |
| `"use cache"` / `cacheLife` / `cacheTag` | **0** |
| `export const revalidate` | **0** |
| `revalidatePath` / `revalidateTag` | **0** |
| `next.config.ts` `cacheComponents` | absent |
| `next.config.ts` `experimental.staleTimes` | absent |
| `export const dynamic = "force-dynamic"` under `src/app/practice` | **71** |

Two consequences worth naming:

- **`experimental.staleTimes.dynamic` defaults to 0 seconds** (`staleTimes.md:31`). Every dynamic practice route is dropped from the client Router cache immediately, so navigating away and back re-fetches the whole RSC payload from the server.
- Dynamic routes with no `loading.js` **are not prefetched at all** (`prefetching.md:29`). With zero `loading.tsx` files under `/practice`, the sidebar's `<Link>`s cost nothing in prefetch traffic — which is the correct behaviour for 2G, and it happened by accident.

### 5.1 What is safely cacheable, and what is not

⚠ **Most of this data is per-practice and per-patient and must never be cached across users.** The line is not subtle, so here it is drawn explicitly.

**Safe to cache across every user and every practice** — measured, `workspace_id IS NULL`, no tenant dimension:

| table | rows | full JSON | what a render actually transfers |
|---|---:|---:|---|
| `practice_parameter_definition` | **53**, all `workspace_id IS NULL` | 47,313 B | **17,829 B on `/practice/encounters/[encounterId]`** — the single largest response body on that render path, out of 17.8 kB total for `encounterParameters` |
| `practice_follow_up_interval` | 8 | 464 B | small |
| `practice_procedure_type` | 10 | 3,957 B | small |
| `practice_note_template` | 4 | 1,854 B | small |

These are the "53 platform parameter definitions" the brief names. They are the same bytes for every practitioner in Uganda, re-fetched on every encounter render.

**Safe to memoise per request only** (React `cache()`, never a shared cache): `resolvePracticeShell`, `resolveWorkspaceContext`, `resolvePracticeAccess`, `getSecurityPolicy`, `todaysPlan`, `resolvePreferences`. These are per-user and per-request by definition; the win is removing the duplicate work inside one render, not across renders.

**Must not be cached at all:** every `practice_patient`, `practice_encounter`, `practice_appointment`, `practice_queue_entry`, `practice_follow_up`, `practice_medication`, `practice_diagnosis`, `practice_parameter_measurement` read. A stale waiting queue or a stale medication list is a clinical hazard, not a performance win.

---

## 6. MEASURED — the offline cache that already exists and is switched off

This is the one lever already built and unused. It is **narrower than "offline mode"** and much more useful than it sounds.

**Switch state (measured):** `supabase/migrations/260-offline-cache-flag.sql:37-42` seeds `plat_feature_flags` key `practice_offline_cache` with **`default_on = false`** and no assignment rows. `:9-11` — "default_on IS FALSE AND MUST STAY FALSE". Resolution runs through `src/lib/practice/offline-gate.ts:59` → `feature-flags.ts:182-188`, fail-closed. **Effective state today: off for every practice, decided by `flag_default`.**

**What it covers today — three entities and one screen:**
1. Today's non-cancelled appointments, 10 fields each (`src/lib/practice/offline-projection.ts:55-72`), from `offline-day.ts:68-101`.
2. The practitioner's planned activity blocks for that day, 5 fields (`offline-projection.ts:75-83`).
3. Day metadata — `date`, `timezone`, `asOf`, `expiresAt`, the feeder map minus the queue (`offline-projection.ts:85-109,416-424`).

One screen renders it: `/practice/offline`, via `src/app/practice/offline/OfflineReader.tsx`. It is deliberately **outside** the `(shell)` route group (`offline/page.tsx:13-19`) because the guard chain is all database reads — with the stated cost that the route performs no server-side authorisation. Storage is IndexedDB, AES-GCM sealed (`offline-crypto.ts:61`), expiring at the next midnight in the practice's timezone (`offline-projection.ts:174-176`) and **deleting rather than hiding** on expiry (`offline-store.ts:141-144`).

**⚠ There is no outbox and nothing writes back.** `offline-store.ts:29-31`, `public/sw.js:26-28`, `OfflineCacheWriter.tsx:21-26` all say so explicitly. The brief's question about outbox expiry does not arise: nothing is queued. `PracticeSignOut.tsx:19` purges the whole database before sign-out.

### 6.1 ⚠ The service worker is the part that matters for "fast pages", and it is real

`docs/CP-OFFLINE-SURVEY-001.md:119-120` records the service worker as ABSENT. **That is now stale.** `public/sw.js` exists, 122 lines:

- `sw.js:51` — `/_next/static/` is cached **cache-first**, stored when `res.ok && res.type === "basic"` (`:87-100`).
- `sw.js:50,54` — `/practice/offline` is precached (one entry, `:61-71`) and any failed `/practice` navigation 302-redirects to it (`:113-119`).
- `sw.js:48-49` — **anything under `/api/` is `never` cached**, checked first and unconditionally. Default is `never` (`:55`).
- `sw.js:73-79` — `activate` drops every non-current cache, so a new build re-downloads.

Registration: `src/app/practice/(shell)/OfflineCacheWriter.tsx:74` — `navigator.serviceWorker.register("/sw.js", { scope: "/practice/", updateViaCache: "none" })`, reached **only after the gate returns `allowed`** (`:56-66`). One hit repo-wide.

**So turning the flag on would give a practitioner on 2G, in order of value:**
1. **The 255–410 kB JavaScript bundle stops being re-downloaded**, durably, independent of the browser's HTTP cache eviction. On a shared low-storage Android phone this is the single biggest change available. It is a side effect of the offline flag, not its stated purpose.
2. A failed navigation lands on a real screen with today's list instead of the browser's error page.
3. Today's appointment list — time · name · one identifier · age · status — readable with no network until midnight.

**What it would still not cover:** every other practice screen. Patient records, encounter creation and notes, the diary beyond today, patient search and the register, documents, tasks, follow-ups, messaging, guidance, settings, and **every write of any kind** — `offlineControls()` (`offline-projection.ts:317-342`) renders "Start the consultation" and "Mark as arrived" permanently disabled with a reason. Allergies, current medicines and diagnoses are **deliberately excluded** (`offline-projection.ts:132-137`) because a stale one is a medication error.

**Two limits worth stating plainly:**
- The worker registers in a `useEffect` after hydration on **only** `/practice/today` and `/practice/home` (the only two mount points of `OfflineCacheWriter`). A practitioner who lands anywhere else never installs it.
- **There is no web app manifest.** `find public src -iname "manifest*"` returns nothing; there is no `src/app/manifest.ts`. `next.config.ts` sets `manifest-src 'self'` in the CSP but nothing is served. So there is no install prompt, no home-screen icon, no standalone display — **this is not an installable PWA today**, despite `docs/CP-OFFLINE-SURVEY-001.md` choosing PWA-first.

---

## 7. MEASURED — the 1,000-row cap, tested rather than assumed

The brief said the PostgREST cap is documented here from experience. I tested it against this project:

```
practice_audit_event  exact count = 22550  | rows returned with .limit(5000) = 1000
practice_session      exact count = 13117  | rows returned with .limit(5000) = 1000
practice_access_log   exact count =    64  | rows returned with .limit(5000) =   64
```

**The cap is exactly 1,000 and `.limit(5000)` returns 1,000 with no error.** Confirmed.

`src/lib/practice/**` contains **28** read sites with `.limit(N ≥ 1000)`: nine at 5000, seven at 2000, twelve at 1000.

⚠ **Reachable is not executed.** My static call-graph walk flagged sites in `security.ts:668` and `relationships.ts:423` as on the render path of most routes; the live traces show `practice_consent` and `practice_relationship` never requested. Those are false positives of the static walk and I am not reporting them as findings. Two survive the runtime check:

**(a) `/practice/home` — a live fetch-to-count-in-TypeScript.**
`src/lib/practice/command-centre.ts:298-299`:
```ts
? await admin.from("practice_diagnosis")
    .select("label, patient_id").eq("workspace_id", ctx.workspaceId).limit(5000)
```
Confirmed executed in the live trace (`GET practice_diagnosis?select=label,patient_id&workspace_id=eq.…&limit=5000`). The rows are then counted in TypeScript into a `Map<string, Set<string>>` at `:302-309` to produce a top-five cohort list and an "and N more" figure. Past 1,000 diagnosis rows the cohort counts silently stop growing and the page shows them as current. This is exactly the shape `docs/PLAT-OVERSIGHT-SURVEY-001.md:585` names, and `command-centre.ts:170` and `session.ts:272` are comments recording that the *same* bug was fixed elsewhere in this very file. It is also a payload cost: up to 1,000 rows transferred to compute five numbers.

**(b) `src/lib/practice/metrics.ts` — an overflow detector that can never fire.**
`:167` `const ROW_CAP = 2000;` and `:266` `return { rows, error: null, overflowed: rows.length >= cap };`. Since the server caps at 1,000, `rows.length >= 2000` is **always false**. A truncated read reports `overflowed: false`, i.e. a silently truncated metric is presented as a complete one. `metrics.ts` feeds the twelve figures on `/practice/home` and `/practice/today`. The same constant is used at `:281` in `readIn`.

Also observed in the traces, under the cap but worth knowing: `practice_parameter_measurement?…&limit=500` fires on both `/practice/encounters/[encounterId]` and `/practice/patients/[patientId]`, and `practice_follow_up?…&limit=500` on `/practice/setup/availability-booking`.

---

## 8. INFERRED — what this costs on 2G

⚠ **This section is arithmetic over a stated assumption, not measurement.** I did not test on a real 2G link (§11). The throughput figures are the conventional ones for the bearer; substitute your own and the ratios hold.

Assumed useful throughput: GPRS ≈ 5 kB/s, EDGE ≈ 25 kB/s, HSPA ≈ 150 kB/s.

**First visit after a deploy, measured bytes** (§2.2 + §2.5): `/practice/home` = 259.1 (JS) + 33.8 (CSS) + 28.6 (font) + 25.3 (favicon) ≈ **347 kB**. `/practice/encounters/[encounterId]` ≈ **498 kB**.

| | GPRS | EDGE | HSPA |
|---|---:|---:|---:|
| `/practice/home` first visit, 347 kB | ~69 s | ~14 s | ~2.3 s |
| `/practice/encounters/[encounterId]` first visit, 498 kB | ~100 s | ~20 s | ~3.3 s |
| The 120.7 kB crypto polyfill alone (§2.3) | ~24 s | ~5 s | ~0.8 s |
| The unused 29.3 kB font (§2.5) | ~6 s | ~1.2 s | ~0.2 s |
| The `dashboardReadModel` data itself, 3.7 kB | ~0.7 s | ~0.15 s | ~0.02 s |

**Server round trips are a different axis.** They land on TTFB, and the link between the phone and Vercel is not the link between Vercel and Supabase. At the ~200 ms/request I measured from this workstation, `/practice/home` at depth 33 is ~6.6 s of TTFB. At a co-located 10 ms it is ~0.33 s. **I could not measure production RTT.** What is deployment-independent is that depth 33 means 33 sequential waits, whatever each one costs.

**The 45-second refresh** (§3.6) is the one recurring cost. Every 45 s the phone pays a fresh RSC payload plus the server pays 70 round trips, for as long as the tab is open.

---

## 9. RECOMMENDED — ranked by benefit against cost

**Nothing below has been done.** Benefit is stated as what it does on a slow link. "Safe" means no user-visible behaviour change; "changes behaviour" means somebody sees something different, or sees it at a different time.

### Tier 1 — large benefit, no behaviour change

**R1. Break the four accidental imports of `provisioning.ts` from client components.**
Move `steps`, `ATTACHMENT_KINDS`, `FACILITY_TYPES`, `ACTIVITY_KINDS`/`PARTICIPATION` into `*-constants.ts` modules that import nothing, or move `audit` out of `provisioning.ts` into its own module.
*Benefit:* removes **120.7 kB gzip** from `/practice/patients`, `/practice/encounters/[encounterId]`, `/practice/settings`, `/practice/activity` — ~30 % of the two heaviest clinical screens. ~24 s on GPRS, ~5 s on EDGE, per first visit.
*Cost:* four import lines and possibly four small new files. *Safe* — no runtime behaviour changes; the polyfill was never executed.
*Evidence:* §2.3.

**R2. Turn on `practice_offline_cache` for the pilot tenant.**
*Benefit:* installs the service worker, which makes the 255–410 kB bundle **stop being re-downloaded** durably on a phone whose HTTP cache is evicted, and turns a failed navigation into a readable screen. It is the only lever that is already built, already reviewed, and already refuses to cache anything under `/api/`.
*Cost:* one `plat_feature_flag_assignments` row. Zero code.
*Changes behaviour* — deliberately, and the behaviour it adds is the honest one: `/practice/offline` shows today's list with an ageing banner and two permanently disabled buttons. That is a product decision, not a performance one, and it is already specified.
*Evidence:* §6. ⚠ Note `docs/CP-OFFLINE-SURVEY-001.md:119-120` is stale on this point and should be corrected.

**R3. Wrap `resolvePracticeShell` and the five loaders the layout and page both call in React `cache()`.**
`resolvePracticeShell`, `resolveWorkspaceContext`, `resolvePracticeAccess`, `getSecurityPolicy`, `todaysPlan`, `resolvePreferences`.
*Benefit:* removes the duplicated **writes** (`touchSession` update runs twice today) and the duplicated non-fetch work; makes the intent explicit rather than relying on Next's fetch dedupe, which is invisible and could change. Modest network win because the GETs already dedupe — a real win on TTFB by removing duplicated compute and duplicated write round trips.
*Cost:* six one-line wrappers. `React.cache` is per-request only (`fetching-data.md:724`), so **no cross-user leak is possible**.
*Safe.* *Evidence:* §3.3, §5.

**R4. Stop preloading Geist inside the practice shell.**
Either apply `--font-geist-sans` in `(shell)/layout.tsx` (so the 29.3 kB buys something), or stop putting `geist.variable` on `<html>` for practice routes (so it is not downloaded).
*Benefit:* 29,288 B on every first visit to every authenticated practice screen — ~6 s on GPRS.
*Cost:* one line. *Changes behaviour only if you choose the "apply it" branch* — the app would render in Geist instead of Arial. The "remove it" branch is *safe*.
*Evidence:* §2.5.

**R5. Shrink the favicon.**
25,931 B, uncompressed, on every page load.
*Benefit:* ~25 kB per first visit. *Cost:* a file swap. *Safe.*

**R6. Parallelise `/practice/patients/[patientId]`.**
Depth 16 for 30 requests. Six of the awaits at `page.tsx:44-77` are independent of each other once `getPatient` has returned, and `logAccess` at `:84` need not block the render at all.
*Benefit:* depth 16 → about 3. On a 200 ms link that is ~2.6 s of TTFB; on a 10 ms one it is ~130 ms.
*Cost:* one `Promise.all`. *Safe* if and only if the refusal semantics are preserved — see §10.
*Evidence:* §4.3.

### Tier 2 — real benefit, needs a decision

**R7. Make the 45-second auto-refresh opt-in, or back it off, on a metered link.**
*Benefit:* stops a full server render plus an RSC payload every 45 s for the life of the tab. On 2G this is the difference between a page that loads once and a page that keeps costing.
*Cost:* small. ⚠ **Changes behaviour, and this is the tension the brief asks about.** `LiveRefresh` exists so the badge cannot claim "live" over a page that has not been re-read. Slowing it down is fine; *removing the badge's honesty* is not. The correct shape is: keep the badge, keep the SSE stream (which is nearly free while healthy), lengthen or make user-controlled the blind 45 s poll, and let the badge say how old the page is. `offlineFreshness()` already exists for exactly this.
*Evidence:* §3.6.

**R8. Cache the platform reference data.**
The 53 `practice_parameter_definition` rows are `workspace_id IS NULL` and identical for everyone; the encounter console transfers **17,829 B** of them per render.
*Benefit:* removes the largest single response body on the encounter render path and one round trip.
*Cost:* small. ⚠ **The query is `or=(workspace_id.is.null,workspace_id.eq.<ws>)` — it mixes platform rows with workspace rows.** Only the `workspace_id IS NULL` half is cacheable. Splitting the query is a prerequisite, and getting it wrong leaks one practice's parameter definitions into another's console. *Do not cache the combined query.* Same applies to `practice_follow_up_interval`, `practice_procedure_type`, `practice_note_template`.
*Evidence:* §5.1.

**R9. Replace the fetch-to-count at `command-centre.ts:298-299` with a grouped count.**
*Benefit:* correctness first — the cohort figures on `/practice/home` silently stop counting at 1,000 diagnosis rows today. Secondarily, it stops transferring up to 1,000 rows to compute five numbers.
*Cost:* an RPC or a `count … group by label` view; the codebase already knows the pattern (`operations.ts:130-145` paginates with `.range()` and reports `countsTruncated`).
⚠ **Changes what the user sees, in the right direction:** a practice past the cap is currently shown a wrong number with no warning. *Evidence:* §7(a).

**R10. Fix `ROW_CAP = 2000` in `metrics.ts:167`.**
Set it to 1000 so `overflowed` can fire, or paginate. *Benefit:* correctness — a truncated metric currently reports as complete on the two most-read screens. *Cost:* one constant, plus deciding what the surface says when `overflowed` is true. ⚠ **Changes what the user sees:** some figures will start saying "1,000+" or "could not be counted". That is the product's own rule working. *Evidence:* §7(b).

**R11. Collapse the seven `practice_follow_up` HEAD counts on `/practice/home` into one grouped read.**
The live trace shows seven back-to-back `HEAD practice_follow_up?…` requests with different filters (overdue, due today, investigation results, completed, scheduled, open-from-today, open-this-week). They are distinct URLs, so **dedupe does not help them**.
*Benefit:* 7 round trips → 1. *Cost:* one query plus TypeScript bucketing — but ⚠ **the bucketing must preserve "could not be read" per lens**, which is why they are seven reads today. This is a real trade against the honesty rule and may not be worth it.

**R12. Hoist `resolveBookingRule` out of the slot loop** (`availability-config.ts:1116-1120`), and pass the resolved rule set in.
*Benefit:* small in the page (dedupe already absorbs it) but real in `/api/v1/practice/*`, where **no dedupe applies**. *Cost:* small. *Safe.* ⚠ Re-`grep` the line numbers — this file was being edited during the survey.

**R13. Same for `schedule-exceptions.ts:413`** — batch the per-id `practice_location` reads into one `.in()`. Different ids, so dedupe does not help. *Safe.*

### Tier 3 — worth knowing, low priority

**R14.** Delete the 26 unreferenced files in `public/` (10,588,678 B). No browser downloads them; it is deployment weight and public exposure, not page weight.
**R15.** Consider `experimental.staleTimes.dynamic` so navigating back to a screen does not always re-fetch. ⚠ **This is a direct trade against the product's rule**: a stale waiting queue rendered as current is exactly what the rule forbids. If it is used at all it should be seconds, not minutes, and probably only for `/practice/setup/*` and `/practice/knowledge-studio/*` — never for the clinical surfaces.
**R16.** Add a web app manifest so the app is installable to an Android home screen (§6). Cheap; the value is adoption, not bytes.
**R17.** Test the 20 sidebar glyphs on a low-end Android build (§2.6). Zero bytes; possible tofu.

---

## 10. ⚠ Where speed and honesty pull against each other

This product's rule is that a screen shows only what a store can answer. Three of the changes above touch it, and each needs a deliberate answer.

1. **Parallelising `/practice/patients/[patientId]` (R6).** The current serial chain is not accidental everywhere: `patients/page.tsx:97-101` documents that a filtered worklist must resolve *before* the cohort, because filtering by an empty id set would render the whole practice as "nobody is waiting". Before any `Promise.all` is applied, each await must be checked for that shape. A parallelisation that turns a failed read into an empty list is a regression that looks like a speed-up.

2. **Any cross-request cache (R8, R15).** A cached figure rendered without saying it is cached is exactly the failure `dashboard.ts:234-252` and `home/page.tsx:150-160` were built to prevent — the page distinguishes "nothing here" from "could not tell", and a cache introduces a third state, "true a while ago", that no card currently has words for. If reference data is cached, cache **only** the `workspace_id IS NULL` rows, which cannot go stale in a way that misleads.

3. **Backing off the 45-second refresh (R7).** `LiveRefresh` exists so the page cannot claim to be live when it is not. Slowing the poll is fine; the badge must then say the page is older. `offlineFreshness()` already produces those words. Removing the poll and leaving the badge saying "Live" would be the worst of the three outcomes.

---

## 11. What could not be measured, and why

- **Real 2G/3G behaviour.** No device and no throttled link were available. §8 is arithmetic over stated assumptions, labelled as such.
- **Production server→Supabase RTT.** Measured ≈ 200 ms median from this workstation, which has Avast TLS interception in the path (see `scripts/dev-ca-preload.cjs`). A co-located deployment would be far lower. Counts and depth are deployment-independent; wall-clock is not.
- **The RSC payload size of an authenticated practice page, and of one `router.refresh()`.** Both need a signed-in session; I have the service-role key but not a user password, and the survey is read-only. What I could measure is the *data* those payloads carry: 3.7 kB gzip for `dashboardReadModel`, 3.4 kB for `patientsWorkspace`.
- **Whether the layout re-executes on a client-side navigation within `(shell)`.** `staleTimes.md:38` says shared layouts are not refetched on every navigation, only the changed page segment — so the double shell resolution of §3.3 is proven for a **full page load** and I could not measure it for a soft navigation.
- **Whether the production host serves brotli.** `next start` locally serves gzip (measured). Vercel's edge would normally do better; not measurable from the repo.
- **Round-trip counts at realistic data volumes.** The practice has 2 patients and 1 encounter. Per-row fan-outs (`metrics.ts:270` batching, `bookingPreview` over a published fortnight) will be larger; I have named where, but not by how much.

---

## 12. What a harness could assert

This codebase already asserts route granularity and boundary rules; a query budget is the same idea. All five are runnable without a signed-in session.

1. **Per-route Supabase round-trip budget.** Run each surveyed route's loader sequence behind a patched `fetch` and assert `distinct(method+url) <= N` and `serialDepth <= D`, with the numbers in §3.2 as the starting ceilings. Fails when someone adds a loader to a page. *This is the one that would have caught everything in §3.*
2. **Client-bundle budget per route.** Sum the chunk bytes from `page_client-reference-manifest.js` after a build and assert a gzip ceiling per practice route. Would have caught the 120.7 kB crypto polyfill the day it arrived, and will catch the next one.
3. **Server-only-module containment.** Walk the client import closure from each route's `"use client"` boundaries (as §2.3 did) and assert that no bare `node:*` package and no module importing `@supabase/supabase-js` server helpers appears. Cheap, static, no build needed.
4. **Row-cap conformance.** Assert that no `.limit(N)` in `src/lib/practice/**` exceeds 1000 unless the call site also paginates with `.range()`, and that any constant named `*ROW_CAP*` is `<= 1000`. Would have caught `metrics.ts:167` and the nine `.limit(5000)` sites.
5. **No awaited write on a render path.** Assert that no `page.tsx` under `src/app/practice/` awaits a function that issues a non-GET request before its last data read. Would have caught both `logAccess` calls.

---

## 13. ⚠ What I would NOT do

- **I would not add `loading.tsx` / Suspense skeletons to the clinical surfaces.** A skeleton is a promise that data is coming. On this product a card is allowed to resolve into "this could not be read" (`home/page.tsx:150-160`, `dashboard.ts:234-252`), and a skeleton that resolves into a refusal is worse than a slower honest page — it has already told the practitioner to expect a number. If streaming is used anywhere, use it on `/practice/setup/*` and `/practice/knowledge-studio/*`, where a delayed panel is an inconvenience rather than a claim.
- **I would not add optimistic UI.** `offline-projection.ts:317-347` goes out of its way to render mutating controls disabled with a reason, and `enabledMutatingControls()` "MUST BE EMPTY". Optimism is the opposite of that decision and it was made deliberately.
- **I would not enable `cacheComponents` / PPR yet.** It is the right long-term shape — a static shell served instantly with dynamic content streaming in — but it changes rendering semantics across 839 `force-dynamic` files and it brings `<Activity>`-based state preservation on navigation (`cacheComponents.md:36-50`), which interacts with the session guard and the dismissal semantics in ways nobody has surveyed. It is a project, not a change.
- **I would not chase the N+1 loops first.** §1.2 and §4.1 show the worst of them costs about one round trip inside a real render. Fixing them is tidy; it is not the answer to the question that was asked.
- **I would not add a cross-user cache to anything with a `workspace_id` or a `patient_id` in the query.** No exceptions.
- **I would not use `unstable_cache` here.** Every candidate is either per-request (use `React.cache`) or genuinely global reference data (which wants an explicit, small, versioned cache with a stated staleness, not an opaque one).

---

## 14. Reproducing every number

All tooling was written outside the repository, under the session scratchpad, and nothing was added to `src/` or `scripts/`.

| § | How |
|---|---|
| 2.2 | Parse `.next/server/app/**/page_client-reference-manifest.js`, union the `chunks` arrays, `fs.statSync` + `zlib.gzipSync(level 9)` each file; baseline from `.next/build-manifest.json` `rootMainFiles` + `polyfillFiles`. |
| 2.3 | Same manifests, scanned for the chunk name; import-closure walk from each route's `"use client"` boundaries following value imports only. |
| 2.5 | `curl -D-` against `npx next start -p 3111`; `.next/server/next-font-manifest.json`; `grep -rn "cp-font-base" src/`. |
| 3.2 | `npx tsx` harness patching `globalThis.fetch`, calling the loaders each page calls, against workspace `b7c5dbc1-…7135b`. Writes excluded. Run with `NODE_OPTIONS="--require ./scripts/dev-ca-preload.cjs"`. |
| 3.3 | Same harness, running the layout sequence and the page sequence back to back; dedupe modelled as `distinct(method + url)` over GET/HEAD. |
| 4.1 | Same harness with per-request logging of URL and offset-from-start. |
| 5 | `grep -rn` for each primitive across `src/`. |
| 7 | `select("id", { count: "exact", head: true })` vs `select("id").limit(5000)` on `practice_audit_event` and `practice_session`. |
| 2 (build) | `npx next build` — exit 0, 77 s compile, 2.9 min TypeScript, 489 pages. Log retained in the scratchpad. |

⚠ On the PostgREST trap the house standards name: `select("*", { head: true, count: "exact" })` returns no error for a table that does not exist and reports it PRESENT. Every table named in this survey was confirmed by a read that returned rows or a documented count, never by a head-only probe.
