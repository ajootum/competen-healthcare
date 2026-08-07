# CP-OFFLINE-SURVEY-001 — Offline-First for Competen Practice

**Date:** 2026-08-08 · **Mode:** survey only, no code, no migration · **Source:** 15 documents in
`C:\Users\elish\Downloads\CP Offline\`, plus 4 referenced documents found elsewhere.

**Decision already taken by the user, and the reason this document is weighted the way it is:** phase one
is the **read-only offline cache**. §3 is scoped to be built from directly. Everything else exists to stop
phase one being built in a way that blocks phase two.

---

## 0. Provenance, and the duplicate that was not a duplicate

The warning was correct, and in the direction that matters.

| File | File size | **Body text** | styles.xml |
|---|---|---|---|
| `COMP-OFF-001_v1.0_Developer_Specification.docx` | 37.8 KB | **2,259 chars** | 349,458 |
| `COMP-OFF-001 v1.0.docx` | 14.7 KB | **7,699 chars** | 27,124 |

The 14.7 KB file has **3.4× the body** of the 37.8 KB one. Every "Developer_Specification" in this set
carries the same 349,458-byte `styles.xml`, which is ~92% of each file. Byte size ranks these documents
almost exactly backwards. Bodies were diffed, not sizes.

The two COMP-OFF-001 files are **not duplicates and neither supersedes the other**: the large-bodied one is
the *architectural* specification (12 sections, six-layer model, capability profiles); the small-bodied one
is its *implementation companion* and says so. Both are needed. Keep both.

**Total specification content across all 15 documents: ~31,000 characters** — about 12 pages. These are
scope-defining outlines, not implementable specifications. No schema, no endpoint contract beyond five URL
strings, no algorithm, no field list, no acceptance threshold with a number in it. This matters for
planning: the specs authorise the work, they do not describe it.

**Five documents are referenced but absent from the folder. Three of them exist one directory up:**

| Referenced as | Status |
|---|---|
| `COMP-DESK-001` | ✅ found at `~/Downloads/COMP-DESK-001_v1.0_Developer_Specification.docx` — read |
| `COMP-PWA-001` | ✅ found at `~/Downloads/COMP-PWA-001_v1.0_Developer_Specification.docx` — read |
| `COMP-TEST-001` | ✅ found at `~/Downloads/COMP-TEST-001_v1.0_Developer_Specification.docx` |
| `HWW-OFF-001` | ❌ does not exist — named as a future capability profile |
| `QA-OFF-001` | ❌ does not exist — named as a future capability profile |

⚠ **`COMP-DESK-001` §3 specifies Tauri, not Electron.** "Desktop Framework: Tauri (recommended)", with
SQLite and a signed auto-updater. Electron appears nowhere in any of the nineteen documents read.

⚠ **A section reference in the brief needs correcting.** CP-OFF-001 §5 is *Synchronization Rules*. The
clinical tools — BMI, growth charts, PEWS, drug dose calculators, age calculations, cached guidelines —
are **§7, "Offline Clinical Tools"**. It is seven lines long and that is the entirety of what the specs say
about offline clinical calculation.

---

## 1. ⚠ The architectural gap, measured

Everything below is a count from this repository, not a characterisation.

### How data reaches a page today

| Measure | Count |
|---|---|
| `src/app/**/page.tsx` total | **908** |
| Server components (`export default async function`) | **899 (98.9%)** |
| `"use client"` pages | **9 (1.0%)** — login, signup, reset/forgot password, 2 audit, OSCE, 2 admin |
| Files containing `"use client"` anywhere | **496** |
| …of those, that fetch their own data | **388 (78.2%)**, via **577 raw `fetch(` call sites** |
| `useSWR` / `useQuery` / `axios` | **0 / 0 / 0** |
| Files importing `createAdminClient` (service-role, RLS-bypassing) | **722** |
| `createAdminClient()` call sites | **730** — incl. **550 page components**, 92 route handlers |
| Route handlers `src/app/api/**/route.ts` | **410**, of which **102** under `/api/v1/practice/` |
| Next.js | **16.2.9**, React 19.2.4, Turbopack implicit (Next 16 default; not configured) |

Your "roughly 717 files using the service-role client" is confirmed at **722 files / 730 call sites**.

### Is there a client-side data layer?

**No. Not partially — not at all.** All sixteen candidate libraries were checked against `package.json`
*and* against actual imports in `src/`:

> `zustand, redux, jotai, recoil, @tanstack/query, react-query, swr, valtio, mobx, @apollo, dexie, idb,
> localforage, pouchdb, rxdb, watermelondb` → **0 in package.json, 0 imported.**

The entire runtime dependency list is **nine packages**: `@anthropic-ai/sdk`, `@supabase/ssr`,
`@supabase/supabase-js`, `@types/qrcode`, `mammoth`, `next`, `qrcode`, `react`, `react-dom`.

Browser persistence in use: `localStorage` in **7 files** (sidebar state, a range picker, theme),
`sessionStorage` in **1**, `indexedDB` in **0**.

### The plain answer

**Offline-first is a second architecture, not an addition.** The current shape is: request → server
component → `createAdminClient()` → PostgREST → HTML. There is no point in that chain where a client-side
cache could be inserted, because **the client never receives data — it receives markup**.

What "second architecture" costs, concretely:

1. **Every offline-capable screen needs a second data path.** The server render stays (it is the online
   path and it is faster). The offline path needs the same figures as JSON. Two paths to the same screen is
   the *definition* of the "second implementation" that this codebase's own CORE-001 §16 rule forbids —
   "no widget independently calculates a conflicting version of a shared metric".
2. **The 730 service-role call sites cannot move.** A service-role key must never reach a browser. Every
   offline read must pass through a route handler that re-derives authorisation. 102 already do.
3. **Two rendering modes to maintain per screen forever**, and a class of bug that only appears in one.

**But — and this is the finding that makes phase one small —** the repository has already, for its own
reasons, built the exact bridge this requires on the one screen that matters most. See §3.

---

## 2. What already exists

Looking hard was right. It is not 50-70% here, but it is not greenfield either, and the parts that exist
are the *load-bearing* parts.

### Genuinely absent — zero evidence, confirmed by grep

| Thing | Status |
|---|---|
| Service worker (`sw.js`, `serviceWorker.register`, Workbox, `next-pwa`) | **ABSENT — 0 matches** |
| PWA manifest (`manifest.json`, `app/manifest.ts`, `<link rel="manifest">`) | **ABSENT — 0 files** |
| IndexedDB / `idb` / Dexie | **ABSENT — 0 matches** |
| Web Crypto / AES / PBKDF2 / SQLCipher | **ABSENT** — 2 hits, both *disclaimers* saying the app does **not** make an AES-256 claim |
| Sync / delta / cursor endpoints | **ABSENT** — no `/sync`, no mutation envelope |
| Conflict merge, CRDT, vector clocks, tombstones | **ABSENT** |
| Electron / Capacitor / React Native | **ABSENT** (10 apparent hits were the word "electronic") |
| Web push / VAPID / `PushManager` | **ABSENT** |

`public/` contains 49 images and no JavaScript.

### Present, and directly reusable

| Thing | Where | Why it matters |
|---|---|---|
| **Two outbox tables, already designed** | `102-domain-events.sql` (`status pending/processed/failed/dead_letter`, `attempts int`, unique idempotency index on `(subject_type, subject_id, aggregate_version)`); `233-practice-domain-events.sql` (`practice_domain_event`, **34-type closed CHECK catalogue**, `version`, `occurred_at` vs `recorded_at`, `published_at` with a partial index `where published_at is null`) | Phase two's outbox is **schema-complete and undrained**. Both migrations state in writing that the dispatcher is not built. This is the single largest piece of pre-existing work. |
| **Device registry** | `practice_session` (`213-practice-security-control.sql`): `device_id`, `device_label`, `user_agent`, `trusted`, `first_seen_at`, `last_seen_at`, `revoked_at`, `revoked_by`, `revoked_reason`. Heartbeat at `/api/v1/practice/security/session`. Idle policy in `practice_security_policy.session_idle_minutes`. | COMP-SEC-001 §5 (register / name / approve / suspend / revoke) is **substantially built already**. Note: `device_id` is a cookie value, and `src/lib/practice/device-register.ts` refuses fingerprinting on principle. No `ip` column, no `device_fingerprint`. |
| **Optimistic concurrency is the house convention** | `recordVersion` / `expectedVersion` on patients, scheduling, booking rules, documents, schedule exceptions; `VERSION_CONFLICT` 409s | COMP-CONF-001 §4 "compare object version numbers" extends this rather than inventing it. No `ETag`/`If-Match` anywhere — versions travel in the body. |
| **Audit spine** | `practice_audit_event` (`191`): `workspace_id`, `actor_id`, `event_type`, `source`, `payload`, **`payload_hash`**, `correlation_id`, `occurred_at`. 10 call sites, funnelled through `audit()` in `provisioning.ts:122` | COMP-SEC-001 §9 and COMP-CONF-001 §7 land here. `payload_hash` exists and **nothing computes it** — a reserved slot for the integrity hashing COMP-API-001 §4 wants. |
| **Feature flags, two engines** | `plat_feature_flags` + assignments (`042`): scope precedence tenant > cohort > plan > country > global > default, **fail-closed**, `src/lib/platform/feature-flags.ts`. 5 flags, **1 wired gate**. Separately `practice_platform_flags` (`191`): `practice_sign_in`, `practice_public_signup`, `practice_pilot_provisioning` | A real engine. **Server-side only — no client evaluation, no bootstrap payload.** See §3.7. |
| **SSE event stream** | `/api/v1/practice/stream` + `LiveRefresh.tsx` | See §3 — this is the finding that changes phase one. |
| **`notif_deliveries`** | `056-notification-delivery.sql`: `channel`, `status queued/sent/failed/skipped`, `provider`, `error` | ⚠ **Not an outbox.** No `attempts` column, no retry, no backoff, nothing drains `queued`. `dispatch.ts` is a single fire-and-forget insert inside `try{}catch{}`. Do not mistake this for delivery infrastructure. |

### `/api/v1/*` versus COMP-END-001's catalogue

COMP-END-001 §3 names 14 endpoint groups. The existing 102 routes under `/api/v1/practice/` cover
**11 of them already** — Users & Devices, Patients, Encounters, Appointments & Calendar, Tasks &
Follow-ups, Documents & Attachments, Configuration, Notifications, Authentication, Organizations, and a
read-model surface the catalogue does not anticipate.

**The three that do not exist are the three that are the actual work:**

| COMP-END-001 §5 | Status |
|---|---|
| `POST /api/v1/sync/upload` | ABSENT |
| `POST /api/v1/sync/download` | ABSENT |
| `POST /api/v1/sync/ack` | ABSENT |
| `POST /api/v1/sync/conflict` | ABSENT |
| `GET /api/v1/sync/status` | ABSENT |
| §6 chunked / resumable attachment upload | ABSENT |

So the *versioned REST surface* COMP-END-001 asks for is largely built; the *synchronization protocol* is
entirely absent. The naming convention already matches, which removes a whole category of argument.

### The product already promises this in public

`src/lib/marketing/practice-content.ts:452-466` describes an offline patient cache, an encounter queue, a
sync centre and conflict resolution. Line 701 says, in the product's own words, that it is *specified and
not yet built* and "it does not work today". There is a marketing asset at
`public/images/practice/mobile-offline.webp`. `super-admin/delivery` lists CDP-012 "Offline & Mobile
Learning" with `status: "gap"`. **The honesty is currently intact and phase one must not break it.**

---

## 3. ⚠ PHASE ONE — the read-only offline cache, scoped to build from

### 3.1 Does any of it already exist? — **Definitively: no, and one thing that changes everything: yes.**

**No service worker. No manifest. No IndexedDB. No client store.** Answered flatly, with greps, in §2.
Nothing downstream is constrained by an existing service-worker scope or strategy, because there is none.
Phase one starts from a blank `public/` and picks its own scope.

**But there is already a client-side freshness system, and it is better than most things built for this
purpose deliberately.**

`src/app/practice/(shell)/LiveRefresh.tsx` is a `"use client"` component that:
- opens an `EventSource` on `/api/v1/practice/stream`;
- runs a **45-second poll alongside it, permanently**, because "a stream that is connected but silently
  dropping events — a proxy buffering, a tab throttled in the background — is invisible from in here";
- renders a **three-state badge**: `live` (green) / `polling` — "Updating every 45s" (amber) /
  `connecting` (grey), each with a `title` explaining what it means;
- exists, in its own words, because **"A DASHBOARD WHOSE STREAM DIED LOOKS EXACTLY LIKE A QUIET MORNING."**

That sentence is the staleness problem, already identified, already solved once, already on screen.
**Phase one adds a fourth state to an existing indicator. It does not invent an indicator system.**

⚠ And note *how* it refreshes: `router.refresh()` — a **server re-render**. The comment is explicit that a
client-side reducer applying events to cards was rejected as "a SECOND implementation of every metric —
exactly what s16 forbids, only now in the browser where nothing can test it." **This is a binding
constraint on phase one** (see 3.3).

### 3.2 Exactly what to cache

CP-OFF-001 §3 lists nine offline workspaces and §4 lists nine data-capture classes. Ranked here by what a
practitioner in a Ugandan clinic on intermittent connectivity actually loses when the link drops — not by
spec order.

| # | What | Value when offline | Cost to hold | Endpoint exists? | Phase 1? |
|---|---|---|---|---|---|
| **1** | **Today's assembled day** — plan, session, queue, timeline, follow-ups due, alerts, drafts, 12 metrics | **Highest.** This is "who is in front of me and who is next". Losing it stops the clinic. | One JSON payload per workspace-day. Kilobytes. | ✅ `GET /api/v1/practice/dashboard` | ✅ **YES** |
| **2** | **The open patient's record** — the few patients seen today: demographics, identifiers, allergies (display-only), current treatments, recent encounters | **Very high.** Continuity for the person in the room. | Small if scoped to *today's cohort*. Unbounded if scoped to "the patient list". | ⚠ Partial — per-patient routes exist | ⚠ **Scoped: today's cohort only** |
| **3** | **Cached practice guidance** (CP-OFF-001 §7 "cached practice guidelines") | **High and underrated.** Static, safe, never conflicts, no staleness risk beyond a version label. The cheapest real value in the whole programme. | Small. Read-only by nature. | ✅ `GET /api/v1/practice/knowledge` | ✅ **YES — and it is the safest thing here** |
| **4** | **Calendar beyond today** (next 7 days) | Medium. Answers "when can I see you again". | Small. | ✅ `GET /api/v1/practice/appointments`, `/planner` | ➕ cheap add-on |
| **5** | **The patient register / search** | Medium-high **but see the warning below** | ⚠ **Unbounded** | ❌ **NO — see 3.2.1** | ❌ **NO** |
| 6 | Offline full-text search (COMP-DATA-001 §7) | Medium | Needs a client index — a whole subsystem | ❌ | ❌ |
| 7 | Attachments / documents | Low-medium | Large binaries, quota pressure | — | ❌ |
| 8 | Any write path | — | — | — | ❌ **§3.5** |

#### 3.2.1 ⚠ "The patient list" does not exist as a thing that can be cached

This contradicts the brief's instinct and it is the most important scoping correction in this document.

`GET /api/v1/practice/patients?q=` is **a ranked search, not a list**. It calls `searchPatients(admin,
workspaceId, q)` and returns `{ results, complete, incompleteDetail }`. There is no list-all endpoint, no
pagination cursor, and no "my patients" collection anywhere in the 102 routes.

Three consequences:

1. **Caching search results caches answers to questions already asked.** Offline, the practitioner asks a
   *new* question and gets nothing. Near-zero value.
2. **Caching the whole register is a different and much worse proposition.** It means shipping a
   workspace's entire patient population — names, identifiers, phone numbers — into browser storage. That
   is the largest privacy exposure in the whole programme, it grows without bound, and COMP-SEC-001 §7
   ("restrict sensitive datasets from offline storage when required") is aimed squarely at it.
3. **The right scope is the cohort, not the register.** Today's appointments name today's patients. Cache
   *those* records. It is bounded (a clinic day), it is exactly the set that will be needed, and it needs
   no new collection semantics.

The payload already carries this cohort: `DashboardReadModel.plan` and `.queue` name today's patients.

**Revised phase-one target: today's assembled day + the patients it names + cached guidance.**

### 3.3 ⚠ How the data gets to the client — pages or a data store?

This is the crux and the answer is neither of the two options as posed. **It is a third option that the
repository has already built most of.**

#### Why not a service-worker HTTP page cache

Caching rendered HTML fails on all three counts:

- **It is not a step toward the outbox.** A cached document is opaque. Phase two needs *records* with
  versions, not markup. Everything built here would be thrown away.
- **Server components mean the HTML is fully personalised and fully authorised.** A cached
  `/practice/today` document is one user's clinic day sitting in a shared browser cache. `practice_session`
  revocation cannot reach it.
- **It cannot be labelled.** A cached HTML page renders its original "Live" badge. The page would
  *actively assert freshness it does not have* — the exact failure mode of §3.4.

#### Why not a general client-side data store either

A store that holds normalised entities and re-derives the dashboard figures in the browser is precisely the
"second implementation of every metric" that `LiveRefresh` and `dashboard.ts` both explicitly reject. It
would also be an enormous amount of work for a read-only phase.

#### ✅ What to actually do: **cache the assembled read model, verbatim, and re-render it with the same components**

`src/lib/practice/dashboard.ts` exports `dashboardReadModel()`, and `/practice/today` and
`/practice/home` and `GET /api/v1/practice/dashboard` **all three call the same function**. The route
handler's own comment says it exists "for the OTHER consumers the spec anticipates — s12's polling
fallback, a mobile surface, and the eventual event-driven refresh".

**An offline cache is exactly one of those anticipated consumers.** The bridge is already built.

The `DashboardReadModel` type is, remarkably, already shaped for this:

```ts
export type DashboardReadModel = {
  asOf: string;          // s12: "Every dashboard response must include an as_of timestamp and timezone."
  timezone: string;
  scope: { date, kind: "session" | "day", sessionId, fromIso, toIso };
  plan; session; glance; brief; operations; metrics; queue; timeline;
  followUps; alerts; drafts;
  feeders: Record<string, FeederState>;   // "ok" | "unavailable", PER CARD
  unavailable: boolean;                   // true only when EVERY feeder failed
};
```

It already carries **its own timestamp**, **its own timezone**, **its own scope**, and **per-card
degradation state**. It was designed so that a consumer can render partial truth honestly. An offline cache
is a fourth degradation mode on a model that already has three.

**Concrete phase-one shape:**

1. A small client module (~150 lines, no dependency) wrapping IndexedDB with one object store,
   `dashboard`, keyed `${workspaceId}:${date}`, holding `{ payload, cachedAt, asOf }`.
2. A `"use client"` component that, **on successful online render only**, `fetch`es
   `/api/v1/practice/dashboard` once and writes the payload. Online rendering is untouched — the server
   render remains the source of truth and the cache is a by-product.
3. An offline route (`/practice/today/offline` or an in-page swap on `navigator.onLine === false`) that
   reads the cached payload and renders it through **the same presentational components** the server page
   uses, in a forced-degraded mode.
4. A service worker whose **only** job is to keep the app shell and static assets available so the page can
   boot at all. **No API responses in the SW cache** — data lives in IndexedDB where it can be labelled,
   scoped and deleted. This keeps the SW trivial and prevents it from ever serving a stale clinical fact.

This is genuinely small — the payload assembly, the authorisation, the timestamps and the degradation
semantics all already exist. And it is a real step toward phase two, because the same IndexedDB module and
the same `asOf`/version discipline become the local data engine COMP-DATA-001 asks for.

⚠ **The one refactor phase one requires:** the presentational components under
`src/app/practice/(shell)/today/` currently receive props from a server render. They must accept the same
props from a cached payload. Check each for a **function passed in props** — this repository has already
been bitten by exactly that (a function on a payload passed to a client component: `tsc` clean, API fine,
page dead). Walk the payload in the harness.

### 3.4 ⚠ The staleness problem — the safety question for a read-only cache

Your instinct is right and the specs agree, but neither goes far enough. Stating it precisely:

> **A cached clinical fact rendered without its age is a false clinical fact.** The failure is not that the
> data is old; it is that the screen *asserts currency it does not have*. A cancelled appointment shown at
> 16:00 from an 08:00 cache is not "slightly stale" — it is wrong, and it looks exactly like right.

CP-OFF-UI-001 §4 asks for five indicators (persistent connectivity indicator, pending counter, background
progress, last-successful-sync timestamp, offline banner) and §3 names five connectivity states. That is
the right list and it is **not sufficient on its own**, because §4's indicators are *global* — one badge in
a corner — and staleness is *per-datum*.

#### What MUST be shown alongside any cached clinical data

1. **An absolute, local-time capture stamp, in the content area, not the chrome.** "Showing the day as it
   stood at **08:14**" — using `asOf` and `timezone`, which the payload already carries. Not "cached", not
   "offline mode", not a relative "2 hours ago" that a glance misreads.
2. **Elapsed time, and it must escalate.** Under ~15 minutes a clinic day is materially accurate. By an
   hour it is not. The visual weight must grow with age; the same grey badge at 8 minutes and 8 hours is
   the failure this is meant to prevent.
3. **A hard expiry after which the cache is withheld rather than shown.** ⚠ **This is the single most
   important rule in phase one.** Beyond a threshold, render *nothing* plus "This device has not reached
   the practice since 08:14. Today's list is not shown because it may be wrong." **An empty screen with a
   reason is safe; a stale screen is not.** A cache with no expiry is not a cache, it is a fork.
4. **The fourth `LiveRefresh` state**, extending the existing three: `offline — showing 08:14`, in a tone
   distinct from `polling`. `polling` means *degraded but current*; offline means *not current at all*.
   These must never look alike.
5. **Per-card honesty preserved.** `feeders: Record<string, FeederState>` was captured at cache time. A
   card that was already `unavailable` at 08:14 must not render as populated-but-old.
6. **Every action that requires the server must be visibly disabled**, with a reason. Not hidden —
   disabled and explained. A greyed "Start encounter" that says "needs a connection" teaches the state; a
   missing button teaches nothing.

#### ⚠ What must NEVER be served from cache

Your line — "anything that would be read as a current clinical fact" — is right. Made operational:

| Never cache | Why |
|---|---|
| **The queue as a live count** | "3 waiting" is a claim about *now*. Cache the day's plan; show the queue only as "as it stood at 08:14", or not at all. |
| **Anything answering "is this safe right now"** | Allergies, current medications, alerts. These are the fields where staleness converts directly into harm. If shown, they must carry the stamp *at the field*, not the page. |
| **Any computed clinical figure** | See §4. |
| **Any authorisation decision** | Capabilities and `practice_session.revoked_at` are server facts. A cached payload must be re-validated on reconnect, and a revoked device must lose its cache. |
| **The patient register** | §3.2.1. |
| **Anything a `feeder` reported `unavailable`** | Caching a hole and rendering it as content. |

**Honest statement, per the instruction not to soften:** a read-only cache of clinical data **can** be made
safe here — but *only* because `asOf`, `timezone`, `feeders` and a three-state freshness indicator already
exist. **If they did not, the honest answer would be that phase one was not safe to build yet.** The
indicator system is ~80% present. What is missing is: the fourth state, the per-datum stamp, the escalating
age treatment, and the hard expiry. **That is a real piece of work and it is not optional decoration — it
is the safety mechanism, and it should be built before the cache, not after.**

### 3.5 What phase one must NOT do

The line, stated exactly: **the moment a screen accepts input it cannot deliver, the product has taken a
clinical record and lost it.** A practitioner who types an encounter note into a box that accepts it has
discharged their duty as far as they can tell. If it never arrives, nobody finds out — not the author, not
the patient, not the next clinician. That is worse than the note never being written, because the writing
of it stops anyone writing it elsewhere.

Phase one must therefore contain, with no exceptions:

- ❌ **No write of any kind.** No form submission, no PATCH, no draft-save.
- ❌ **No queue, no outbox, no `pending` state.** Not even one "we'll send this later".
- ❌ **No optimistic UI.** Nothing rendered as done that is not done.
- ❌ **No editable field on any offline screen.** Inputs disabled, not merely un-submittable — a disabled
  input cannot be typed into and then lost.
- ❌ **No "retry" or "sync now" affordance.** There is nothing to sync. Offering it implies there is.
- ❌ **No local mutation of the cached payload**, including sort/filter that writes back.
- ❌ **No caching of authorisation.** Capability checks re-run on reconnect.

**Positive test for the harness:** in offline mode, the number of enabled controls that could produce a
mutation must be **zero**. Assert it; do not review for it.

### 3.6 Encryption — what is genuinely achievable

COMP-SEC-001 §6 and COMP-DATA-001 §9 both say "AES-256 encrypted local database". ⚠ **For a browser, this
promise cannot be kept as written, and the repository already knows it** — `src/lib/practice/security.ts`
and `practice/privacy/security/page.tsx` both carry disclaimers stating that "AES-256" describes a
*deployment* claim the application does not make. **Do not remove those disclaimers in phase one.**

The honest position:

**What Web Crypto + a key in IndexedDB actually defends against:**
- Casual inspection via DevTools by someone at the machine who is not attacking it.
- Another origin — but *only* because same-origin policy already provides that; encryption adds nothing.
- A file-level backup or forensic image of the profile directory that is not accompanied by script
  execution on the origin.

**What it does not defend against — which is most of the realistic threat model:**
- **Any XSS on the origin.** Script on the page can read the key from IndexedDB and decrypt everything.
  The key and the ciphertext live in the same trust domain; this is the whole problem.
- **A compromised or malware-bearing device.** Same reason.
- **A shared clinic computer where the next user is a different clinician.** The browser profile persists;
  the key persists; the data opens.
- **A stolen unlocked device.**

Non-extractable `CryptoKey` handles (`extractable: false`) genuinely stop the *key bytes* being exfiltrated
— but not the *plaintext*, because the page can still call `decrypt()`. It raises cost; it does not change
the category.

**Recommendation for phase one — the controls that actually work here:**

1. **Minimise, do not encrypt.** Cache the smallest useful set (today's day + today's cohort). Not caching
   the register is worth more than encrypting it would be.
2. **Bound the lifetime.** Purge at the hard-expiry threshold from §3.4, and on sign-out, and on
   `practice_session.revoked_at`. Short-lived data is the strongest available control.
3. **Encrypt anyway, with AES-GCM via Web Crypto and a non-extractable key** — it is cheap, it raises the
   floor, and it makes the eventual desktop story (where OS keychains make the claim *true*) a
   continuation rather than a rewrite.
4. ⚠ **Do not let it change what the UI claims.** Encrypting in the browser must not become "your data is
   encrypted on your device" in copy. Where it is stated, state the limit with it. The shared-clinic-machine
   case is the realistic one in the target deployment and encryption does not address it.

The full COMP-SEC-001 §6 promise becomes honest on **desktop** (Tauri + SQLCipher + OS keystore, per
COMP-DESK-001 §6). That is an argument about *sequencing*, not a reason to make the claim early.

### 3.7 Gating

Both available mechanisms should be used, for different jobs:

- **`plat_feature_flags`** (`src/lib/platform/feature-flags.ts`) for **rollout**. It is a real engine —
  precedence tenant > cohort > plan > country > global > default, and **fail-closed** on unreadable
  tables, which is the correct default for this feature. Add `practice_offline_cache`, default off. Its
  scope model means a single pilot practice can be enabled by `tenant`, which is exactly the pilot shape.
  ⚠ It has **five flags and one wired gate** (`executive_intelligence`) and **no client-side evaluation
  path**. Phase one needs the flag resolved **server-side and passed into the client component as a prop**
  — do not build a client evaluator. Another agent is wiring its first gate now; coordinate rather than
  duplicating.
- **Capability**: `practice.home.view`. Already the gate on `/practice/today` and on
  `GET /api/v1/practice/dashboard`. Nothing new is needed and **no new capability code should be invented**
  (see §8).

A device dimension is also available and worth using: only cache on a device where
`practice_session.trusted` is true. That reuses the existing register rather than adding policy.

---

## 3.8 ⚠ SAFEST-BUILD WEIGHTING — the governing rule applied to phase one

Standing rule: *"our approach should be safest and most secure builds."* Applied below. Where two designs
are defensible the safer one is recommended **and its cost is stated**, because a control whose cost is
hidden gets removed later by someone who never saw it.

⚠ **And the counter-rule is taken seriously: safest ≠ most restrictive.** A cache so thin or so short-lived
that the practitioner ignores it and works from paper has *increased* risk — it spent the privacy budget
and bought no safety, and it teaches the team that the offline feature does not work. That line is located
explicitly in 3.8.7.

### 3.8.1 Cache the least that is useful — the minimum field set

Agreed without reservation, and it is the highest-leverage control here. **A cache holding less is a
smaller breach**, and unlike encryption (3.8.5) it works against every threat model including a fully
compromised device.

The `DashboardReadModel` is rich. **Do not cache it whole.** Project it to a deliberate subset at write
time — in the client, before it touches IndexedDB — so the store physically cannot contain what was never
selected.

**Recommended minimum set, per appointment on today's plan, each field justified:**

| Field | Earns its place because | Verdict |
|---|---|---|
| Appointment **start time** | The entire ordering of the clinic. Useless without it. | ✅ cache |
| **Duration / slot length** | Lets the practitioner see what fits before the next patient. | ✅ cache |
| **Status** (booked / arrived / in progress / done) | Distinguishes "waiting" from "seen" — the second-most-used fact in a clinic day. | ✅ cache |
| **Patient display name** | ⚠ The disclosive one, and it still earns its place: it is the key a human uses to match the person in front of them to the right record. Getting this wrong is a clinical safety event, not an inconvenience. | ✅ cache — see 3.8.7 |
| **Practice patient identifier** (one, not the full list) | Disambiguates namesakes. This product already treats duplicate registration as a named hazard. | ✅ cache one |
| **Age** (years, derived) | Needed to sanity-check that the record matches the person. Far less disclosive than a date of birth. | ✅ cache **age, not DOB** |
| **Encounter/visit id** | The key to open the right record on reconnect. Opaque, non-disclosive. | ✅ cache |
| Date of birth | Age carries the clinical utility; the full date is a strong identifier and a standard credential-reset answer. | ❌ **derive age, drop DOB** |
| Phone / email / address | Not used to run a clinic day. Directly enables contact and re-identification. | ❌ **drop** |
| Full identifier list (national ID, insurer, other hospital numbers) | One identifier disambiguates; the set is an identity dossier. | ❌ **drop** |
| **Free-text reason for visit / clinical note** | ⚠ Highest-sensitivity free text in the payload, and not needed to know who is next. | ❌ **drop** |
| Sex | Rarely needed to run the list; adds a re-identification attribute. | ❌ drop from the list view |
| Allergies, current medications, diagnoses | ⚠ See 3.8.4 — current clinical facts, and the staleness risk is a harm risk. | ❌ **not in phase one** |
| The 12 metrics, brief, alerts, drafts | Management information. Zero value to a practitioner mid-clinic without a connection. | ❌ **drop** — a large, free reduction |
| Queue as a live count | A claim about *now*. | ❌ drop (already 3.4) |

**Estimated result: roughly 8 fields per appointment, ~25 appointments — a few kilobytes.** Against the
full read model this is perhaps a tenth of the payload and a much smaller fraction of its sensitivity.

⚠ **Project at write time, not at render time.** A cache that stores everything and renders a subset has
stored everything. The projection function is the security control, and it should be a single pure
function with a harness asserting the output has no keys outside the allow-list — **an allow-list, never a
deny-list**, so a new field added upstream is excluded by default rather than included by accident.

### 3.8.2 ⚠ Revocation cannot reach an offline device — so lifetime is the real control

**This is correct, it is the most important security observation in the brief, and the specs are wrong
about it in writing.**

The mechanism: `practice_session.revoked_at` is checked server-side. A device holding a local cache and
never reconnecting **never learns**. The stolen device is precisely the device that will not connect —
and if the thief is sophisticated, connecting is the one thing they will prevent. Revocation is a control
that works exactly when it is not needed.

**⚠ The sentences that promise otherwise, quoted — each will end up on a screen if not caught now:**

| Doc | Sentence | Why it is unkeepable offline |
|---|---|---|
| **COMP-SEC-001 (offline) §11** | *"Unauthorized devices cannot access synchronized data."* | ⚠ **The most dangerous one — it is an acceptance criterion.** A revoked device with a local cache *can* access already-synchronized data. As written, this criterion cannot be signed off honestly. |
| **COMP-SEC-001 (offline) §5** | *"Remote deauthorization for lost or stolen devices."* | Implies reach-out. There is none. Only refusal of *future* sync. |
| **COMP-SEC-001 (offline) §10** | *"Secure cache cleanup on policy violation."* | Requires code to run on the device. An offline device runs nothing on the server's behalf. |
| **COMP-OFF-001 §7** | *"Secure handling of revoked devices."* | Ambiguous enough to be read as remote wipe. |
| **COMP-SEC-001 (offline) §2** | *"Ensure only authorized users can access offline information."* | True at cache time; not enforceable afterwards. |

**Recommended honest formulation, for the spec and for any UI copy:**

> Revoking a device prevents it from synchronising again and blocks all future access. **Data already
> cached on that device expires on its own within [N] hours and cannot be erased remotely** — revocation
> stops the next read, it does not reach back.

This product has already had to rewrite two promises it could not keep (the AES-256 claim, and the
percentile bands). **This is the third, and it is being caught before it ships rather than after.**

#### The concrete maximum age

Because expiry is the *only* control that acts on a device that never reconnects, it must be self-executing:
an absolute timestamp compared against the device clock, evaluated **on every read**, with the record
deleted — not hidden — when it fails.

**Recommendation: hard expiry at the earlier of (a) the end of the cached clinic day in the practice's
timezone, or (b) 12 hours from `asOf`. Escalating staleness labels from 60 minutes. Immediate purge on
sign-out, on observed revocation, on flag-off, and on workspace switch.**

⚠ **Why 12 hours and not 4, under a safest-build rule — this is a deliberate choice, not a relaxation.**

- **What a shorter expiry buys is small.** It only helps in the narrow case of a device stolen and examined
  between hours 4 and 12. A device stolen *during* the clinic day is compromised under either setting, and
  one examined next week is protected by both. The marginal disclosure window is thin.
- **What it costs is large and clinical.** A practitioner in a long clinic with no signal loses the list
  mid-session. At 4 hours, an 08:00 start goes dark at 12:00 — the middle of the working day. They fall
  back to paper *and stop trusting the feature*, which is the failure mode of 3.8.7.
- **End-of-day is the stronger half of the rule anyway.** It is what stops the cache persisting overnight
  or over a weekend, which is where the real long-tail exposure lives. Twelve hours is the backstop for a
  clinic that runs late or a device whose day boundary is ambiguous.
- ⚠ **The device clock is attacker-controlled.** Rolling it back defeats any expiry. Mitigate by also
  storing `asOf` and refusing to render if the device clock is *earlier* than it — cheap, and it catches
  casual tampering. It does not defeat a determined local attacker, and nothing at this layer does.
  **Do not present expiry as a defence against a competent adversary; it is a defence against time.**

**Cost, stated plainly:** a practitioner with no signal for a full working day loses the cached list at the
day's end and must work from paper for any later clinic. That is the accepted cost, and it is the right
one — a list from yesterday is exactly the artefact that gets someone seen against a cancelled appointment.

### 3.8.3 The indicator is part of "done"

Agreed, and already argued in §3.4. Restating as a build rule: **the freshness indicator, the escalating
age treatment and the hard expiry ship in the same change as the cache, or the cache does not ship.** They
are not follow-up polish; they are the mechanism that makes cached clinical data safe to look at. A cache
merged "with the indicator to follow" is the unsafe artefact, live.

### 3.8.4 Current clinical facts

Agreed, and phase one errs further than asked: allergies, current medications and diagnoses are **excluded
entirely** (3.8.1), not merely age-labelled. Rationale: for the appointment list they are not needed, and
these are precisely the fields where staleness converts into harm — a discontinued drug or a since-added
allergy read as current is a medication error with a clean audit trail behind it. **When they are cached
later (phase two, the open patient record), each must carry its own capture stamp at the field, not at the
page.**

### 3.8.5 Encryption, plainly

Full analysis at §3.6; the plain statement, so nothing downstream claims more:

> **Web Crypto with a non-extractable AES-GCM key in IndexedDB defends against:** casual inspection of the
> browser store by someone at the machine; another origin reading it (though same-origin policy already
> does that); and a file-level copy of the browser profile or a disk image taken without script execution
> on the origin.
>
> **It does not defend against:** any XSS on the origin; a compromised or malware-bearing device; a
> determined local attacker with the profile *and* the ability to run script as the origin; a shared clinic
> computer where the next user opens the same browser profile; or a stolen unlocked device. The key and the
> ciphertext live in the same trust domain, so anything that can run as the page can decrypt.

**Recommendation: implement it anyway** — it is cheap, it raises the floor, it makes the desktop path a
continuation rather than a rewrite. ⚠ **But it must not change one word of what the UI claims**, and the
existing disclaimers in `security.ts` and `practice/privacy/security/page.tsx` stay exactly as they are.
The honest summary for a practice is: *"this reduces casual exposure; it does not make a lost laptop safe."*

### 3.8.6 Flag, default off, practice-controllable

Agreed, and the engine already supports it (§3.7). Three requirements:

1. **`plat_feature_flags`, default off**, tenant-scoped for pilot rollout. The engine is already
   fail-closed on unreadable tables — the correct default for this feature.
2. **A practice-level off switch that a practice administrator can operate**, not only a super-admin.
   ⚠ Being able to say *"do not hold my patients' data on that laptop"* is itself a security control, and
   it is worthless if it requires a support ticket. `practice_platform_flags` is the natural home.
3. ⚠ **Turning it off must purge, not merely stop caching.** A flag that disables writing while leaving
   yesterday's cache on the device has not honoured the request. Purge on the next load after the flag
   resolves false — and note honestly that this, too, requires the device to come online, which is why
   3.8.2's self-executing expiry remains the primary control.

### 3.8.7 ⚠ Should phase one cache nothing patient-identifiable? — **The challenge, and it cuts both ways**

The proposal: cache times and appointment types, no names. Genuinely useful, far less dangerous.

**I do not think this is the safer design, and I think the risk is partly inverted. Two objections.**

**Objection 1 — ⚠ the appointment type is often *more* disclosive than the name.**

A list reading `10:00 HIV clinic · 10:20 HIV clinic · 10:40 ART refill` on a device in a waiting room where
those patients are physically present, in sequence, is **a re-identifying disclosure of the most sensitive
category of health data there is** — and it is worse in a small community clinic, which is the target
deployment. The name tells you *who*; the service label tells you *what is wrong with them*, and the clinic
context supplies the who for free. Stripping names while keeping clinical service labels swaps a moderate
identifier for a high-sensitivity attribute and *feels* safer because the obvious identifier is gone.

**So if anything is dropped first, it is the clinical service label and the free-text reason, not the
name.** That is already the recommendation in 3.8.1 — reason-for-visit is dropped, and a clinical service
label should be treated as sensitive and either omitted or reduced to a non-clinical kind (new /
follow-up / procedure).

**Objection 2 — a nameless list is not usable enough to be safe.**

A practitioner cannot confirm the record in front of them belongs to the person in front of them without an
identifier. The failure mode is not "mild inconvenience" — it is opening the wrong patient's record, which
is a clinical safety event and one this product already guards against elsewhere (duplicate-registration
detection, `complete` on the search payload). A cache that makes mis-identification *easier* has traded a
privacy risk for a safety risk, which is not a good trade.

**And a nameless list would be ignored.** Two patients at 10:00 and no way to tell which is which means the
practitioner reaches for paper. Then the cache holds data, carries risk, and delivers nothing. **That is
where the "so restrictive it made things worse" line falls**, and a nameless schedule is on the wrong side
of it.

**Recommendation — the middle position, which I believe is genuinely the safest *workable* design:**

> Cache **name + one identifier + age + time + duration + status + encounter id**. Drop **date of birth,
> contact details, the identifier set, free-text reason, clinical service labels, allergies, medications,
> diagnoses, and all management metrics.**

This keeps the two things that make the list clinically usable (who, when) and removes essentially
everything that makes a breach *interesting*: no contact details to exploit, no condition disclosed, no
identity dossier, no clinical narrative. A device lost with this cache discloses **that these named people
had an appointment at this practice today** — a real disclosure, not a trivial one, and materially smaller
than either the full payload or, in the sensitive-clinic case, the nameless-but-typed alternative.

⚠ **One case where the nameless design is right, and it should be offered:** a practice whose service
labels are inherently disclosing — an HIV, mental health, TB or reproductive-health clinic. For those,
"cache nothing patient-identifiable, or do not cache at all" is the correct answer, and 3.8.6's
practice-level off switch is how they exercise it. **Recommend making that switch prominent in onboarding
rather than buried in settings**, and defaulting the whole feature off (3.8.6) so this is an opt-in
decision a practice takes knowingly.

**Where the line falls, stated once:** a cache is too thin when a practitioner cannot use it to run the
clinic and reaches for paper — at which point it carries risk and delivers nothing. It is too fat when it
holds anything not needed to answer *who is next, and is that the right record*. The set in 3.8.1 is
deliberately the narrowest set that clears the first bar.

---

## 4. ⚠ The clinical safety question

**Where offline clinical calculation is safe, and where it is not.** This does not affect phase one — which
computes nothing — but it decides whether CP-OFF-001 §7 is buildable at all.

The three collisions are real. One is worse than described, one is already fully handled, and one rests on
a premise that is not in the specification.

### 4.1 Drug dosing — ⚠ the collision is worse offline, and for a reason not yet named

The state online, verified in code:

- `doseArithmetic()` in `src/lib/practice/clinical-calculators.ts` **is built** — mg/kg, mg/kg/day, mg/m²,
  fixed — returning `working: string[]`, every step, never empty.
- MED-001 §4's checks **are deferred**, and *nine* of them are enumerated machine-readably in
  `DEFERRED_SAFETY_CHECKS` (`medication-constants.ts:216-282`): max single dose, max daily dose, underdose,
  overdose, age validation, duplicate therapy, allergy, interaction, renal/hepatic adjustment.
- The refusal is architectural, not pending: `NO_WARNING_STORE` records that `practice_medication_rule` and
  `practice_medication_warning` were **proposed and declined**, because "the rule table would be an empty
  drug knowledge base" and "an empty rule table makes every check return nothing to say, **which a
  clinician reads as safe**".
- The mitigation is that a check that cannot run **says "not checked"** by name, via `doseSafetyNotice()`,
  and no screen may print a dose without it.
- `clinical-calculators.ts:24`: of the four original preconditions, **"EXACTLY ZERO OF THE FOUR HAVE BEEN
  MET."**

**Why offline is strictly worse, and it is not the missing server checks.** Read the parameter contract:

> `@param weightKg  from a recorded measurement. NOT typed, NOT remembered, NOT carried forward.`

The dose calculator's entire safety argument is that the weight is a *cited, timestamped, current* recorded
measurement — and it **returns `ok:false` rather than a number** when there is none. Migration 246 made
weight citable, and that is what unlocked the arithmetic.

**A cached weight breaks precisely that property.** Offline, the weight is *remembered* — the exact thing
the contract forbids. For an adult over a day this is usually immaterial. For a dehydrated infant on
fluids, weight is the variable that moves fastest and is the denominator of the dose. A cached weight from
a previous visit, multiplied by a mg/kg rate, produces a confident, fully-worked, wrongly-scaled dose —
**with all its working shown**, which is what makes it persuasive.

The second breakage is quieter: `toCanonical()` converts units **from the `unit_conversions` table** — by
data, not by code. Offline that table is a cache. A stale or absent conversion row is a factor-of-1000
error in a dose.

**Verdict:**

| | |
|---|---|
| ✅ **Safe offline** | Arithmetic on numbers **the practitioner types in the same session** — BMI, BSA, MAP, age. Self-contained, no cited state, no reference data. eGFR too, on typed creatinine. |
| ⚠ **Safe only with a hard constraint** | Weight-based dosing, **if and only if** the weight was recorded in *this* offline session, or the cached measurement is within a stated recency window **and its capture date is printed beside the dose**. Reuse the existing `ok:false` refusal path rather than inventing one — it is already the right shape. |
| ❌ **Not safe offline** | A dose from a cached weight of unstated age. Any unit conversion against a cached conversion table without a version check. |
| ❌ **Not safe anywhere, offline or on** | The nine deferred checks. Offline changes nothing here — they are absent online too, and honestly labelled. **Offline must not silently drop `doseSafetyNotice()`.** |

### 4.2 Growth charts — ✅ **already resolved; no collision remains**

Migration 246 does not merely lack a percentile column; it **refuses one in writing**, lines 613-625:

> "A percentile computed against an unnamed population is not an approximation. It is a fabricated clinical
> figure that looks exactly like a real one, and it would be read by a clinician deciding whether a child is
> failing to thrive."

And the refusal is not confined to the schema — it is **in the API payload**
(`parameters.ts:2515` `percentileBands: null`, `percentileBandsRefusal: PERCENTILE_REFUSAL_TEXT`, naming
WHO 2006 and CDC 2000), and it is **enforced by a harness**
(`scripts/practice-parameters-harness.ts:438`, `const CENTILE = /(percentile|centile|z_?score|lms_)/i`,
plus a `CENTILE_ASSIGNED` scan). There is no `practice_growth_reference` table and no LMS coefficient set
anywhere.

**So an offline growth chart is safe, because the only thing it can draw is the raw measurement series —
and that is all it can draw online too.** CP-OFF-001 §7's "Growth charts" is already satisfied at the level
the product supports. **Do not treat offline as an opportunity to add bands.** The one requirement is that
`percentileBandsRefusal` travels **with the cached payload**; a cached chart that dropped the refusal text
would read as an ordinary chart with the bands merely not drawn yet.

### 4.3 PEWS — ✅ **safe, and the premise needs correcting**

`src/lib/hww/instruments.ts:5-6`: **"Competen records the ALREADY-CALCULATED total — it never computes PEWS
from vitals."** The clinician types the total (validated 0-15) and `classifyPews()` bands it against a
hardcoded `PEWS_BANDS` array.

So "PEWS offline" is **data capture, not calculation**. Banding a number the clinician supplies is a lookup
against five constants — no reference data, no server dependency, deterministic. **Safe offline.**

⚠ Two cautions:
- CP-OFF-001 §7 says "PEWS calculations". If that means *deriving* PEWS from vitals, it is a **new
  capability that does not exist online**, and building it first in the offline client would put an
  uncomputed-anywhere clinical score in the least testable place in the system. Do not.
- The bands are a hardcoded TypeScript `const`, described as "the Competen DEFAULT profile" and intended
  to be lifted into governed configuration later. Once configurable, an offline client caches a *policy*,
  and a stale policy silently mis-bands. Version the profile before making it configurable.

### 4.4 ⚠ COMP-CONF-001 §6 — the quoted rule is **not in the specification**

The brief states COMP-CONF-001 §6 says medication conflicts are "Server Wins + Always Require Review".
**It does not.** Grepped across all nineteen extracted documents:

- `"server wins"` — **0 occurrences, anywhere.**
- `"medication"` — **0 occurrences, anywhere.** The only drug reference in the entire set is one line,
  CP-OFF-001 §7: "Drug dose calculators".
- COMP-CONF-001 §6 "Clinical Safety Rules" reads, in full: *never silently overwrite clinically significant
  data; preserve both values until resolved when required; display clear comparison to the user; record all
  decisions in the audit log.* Four bullets. No per-entity matrix, no named strategy, no medication rule.

This matters in both directions:

1. **The good news:** there is no specified rule that presumes a review surface. §5's strategies
   ("last-write policy (configurable where appropriate)") are a menu, not an assignment. **You are free to
   choose the policy** rather than obliged to implement one you cannot support.
2. **The bad news, unchanged:** §6's *actual* text — "display clear comparison to the user" — still
   requires a review surface, and **there is none.** No `needs_review` / `requires_review` / `review_queue`
   / `pending_review` column or table exists anywhere in the repository (all four tokens: zero hits). The
   only adjacent things are the **medication reconciliation worklist** (`medications/page.tsx` — which
   currently renders "The medication store is not in this deployment", because its migration is unapplied)
   and **booking-rule conflict resolution**, which is scheduling, not clinical merge.

⚠ **Recommend correcting the working note that carries the "Server Wins" quote**, so a decision is not
attributed to a specification that does not contain it. As a *chosen* policy for medications it is
defensible — but it must be recorded as the team's decision, not as a spec requirement.

### 4.5 A live hazard, in passing

`src/lib/practice/medication.ts` is written against a migration that **has not been applied**, and
`MEDICATION_MIGRATION` names it `257-practice-medication` — while `257-guidance-archived-reason-not-blank.sql`
**already exists on disk**. A migration-number collision. Flagged only; the directory belongs to another
agent and was not touched.

---

## 5. ⚠ What a half-built offline mode would destroy

Stated as one line, then the boundary:

> **A client that accepts a write it cannot later deliver has taken a clinical record and destroyed it —
> and destroyed it silently, which is the part that matters.**

The silence is the harm. A crashed app loses a note *visibly*; the practitioner rewrites it. A queued note
that never syncs is *believed to be saved* by the only person who could rewrite it. The record is gone and
no one is looking for it. Worse, the belief that it was written suppresses the paper backup that a
practitioner in an intermittent-connectivity clinic would otherwise have kept.

**Where the line is, exactly:**

> The line is crossed the moment **any UI accepts input that the user reasonably believes is recorded**
> — and it is crossed by the *acceptance*, not by the failure. A queue that works 99% of the time has
> crossed it; it just has not collected yet.

Below the line (phase one): rendering data the server already produced, labelled with its age. Nothing is
accepted. The worst failure is showing something old — bounded, visible, and mitigated by §3.4.

Above the line: any accepted mutation.

**What makes it safe to cross — all six, not a subset:**

1. **Durable local persistence that survives tab close, crash and OS restart, proven by test.** IndexedDB
   with an explicit transaction commit, not an in-memory queue with a `beforeunload` flush.
2. **A visible, per-record delivery state the user cannot miss** — pending / syncing / **failed**. The
   third is the one that matters and the one most implementations render as the second.
3. **Idempotent server acceptance.** COMP-API-001 §5 and COMP-EVT-001 §7. The schema is already here:
   `domain_events`' unique index on `(subject_type, subject_id, aggregate_version)` and
   `practice_domain_event`'s `published_at`. A retry must not create a second encounter.
4. **A bounded failure path that escalates to a human.** After N attempts or T hours, the queue must
   *shout* — not retry forever in silence. This is the single most-skipped requirement in offline builds
   and the one that converts a delay into a loss.
5. **A conflict surface that exists.** §4.4: it does not. Until "display clear comparison to the user" has
   a screen, any write whose conflict policy is anything other than a deterministic automatic rule is a
   write with no defined outcome.
6. **A recovery path for the undeliverable.** When a queued write genuinely cannot be applied — the patient
   was merged, the encounter signed, the device revoked — it must be **exportable and readable by a human**,
   not discarded. COMP-OFF-001 Principle 4: "No accepted user action shall be silently discarded."

Until all six hold, **not writing is the safe engineering decision**, and phase one is correctly scoped.

⚠ **One phase-one-specific way to cross the line by accident:** an offline screen that renders a form
because the component was reused from the online page, and merely fails on submit. The user typed. The
input was accepted. §3.5's harness assertion — zero enabled mutating controls in offline mode — exists to
catch exactly this.

---

## 6. Navigation — what the specs' text says

Reported from text only. No comp was opened, and none should be.

**Across all nineteen documents, the total navigation-structural content is:**

- `sidebar`, `menu`, `nav item`, `left rail`, `breadcrumb` — **0 occurrences.**
- `navigation` — **1 occurrence**, CP-OFF-TEST-001 §7: "Responsive offline navigation." A *performance*
  target, not a structure.

**The specs propose no navigation change whatsoever.** They ask for two things, both additive:

1. **CP-OFF-UI-001 §4, "Global UI Indicators"** — persistent connectivity indicator, pending
   synchronization counter, background progress, last successful synchronization timestamp, offline banner.
   **Chrome, not navigation.** Four of the five are satisfied by extending `LiveRefresh`; the pending
   counter is phase two and must not appear in phase one (§3.5).
2. **CP-OFF-UI-001 §7, "Synchronization Centre"** — view pending items, view history, resolve conflicts,
   retry failed items, manual Sync Now. **This is the one new surface**, and **all five of its functions
   are write-path.** It is a phase-two/three artefact and must not be built in phase one — an empty Sync
   Centre implies a queue that does not exist.

**Against the live nav:** `src/lib/practice/navigation.ts` is under a design freeze (CPR-V5-002: "no
further structural navigation changes should be made unless validated by practitioner usability testing"),
and the file records that it is on its **third** navigation — V3-002 named nine, V5-001 named eight, V5-002
is the freeze. **Nothing in the offline set disturbs it**, which is the cleanest possible outcome:
offline is chrome plus, later, one item.

When the Sync Centre eventually lands, the freeze's own convention applies — it is supporting information,
so it declares a `parent` (`/practice/setup`, beside Security and Activity Log) rather than taking a
primary slot. `orphanedNav()` already fails the harness on any built module with no way in.

---

## 7. ⚠ Document ID collisions

### Confirmed: `COMP-SEC-001` is two different documents

| | |
|---|---|
| **A** | `COMP-SEC-001 v1` — **"Competen Platform Security Framework"** (`~/Downloads/COMP-SEC-001_v1_Competen_Platform_Security_Framework.docx`). Enterprise security charter: MFA, SSO, RBAC, break-glass, CSRF/XSS/SQLi, key rotation. Surveyed 2026-08-07 in `docs/COMP-SECURITY-SURVEY-001.md`. |
| **B** | `COMP-SEC-001 v1.0` — **"Competen Offline Security, Encryption & Device Management"** (`~/Downloads/CP Offline/COMP-SEC-001_v1.0_Developer_Specification.docx`). Offline-specific: local AES-256, device trust, offline RBAC, offline session validity. |

Different titles, different scopes, no shared content. **A is already load-bearing in the repository:**
`supabase/migrations/252-pin-search-path-and-enable-rls.sql:3` is titled "COMP-SEC-001", and
`docs/COMP-SECURITY-SURVEY-001.md` cites the ID ~17 times. A future reader resolving "COMP-SEC-001" against
migration 252 will reach the wrong document.

**Recommendation:** renumber **B** — it has no dependants yet, whereas A has a migration and a survey.
`COMP-OSEC-001` fits the set's own convention (OFF/SYNC/DATA/DB/CONF/EVT/API/END). Record the supersession
rather than silently retitling, per the house convention visible in `navigation.ts`.

### The other IDs — checked, and clean

All twelve remaining IDs were grepped across the repository and against every `COMP-*`/`CP-*` document in
`~/Downloads`. **No other collision.** `COMP-OFF-001`, `COMP-SYNC-001`, `COMP-DATA-001`, `COMP-DB-001`,
`COMP-API-001`, `COMP-END-001`, `COMP-EVT-001`, `COMP-CONF-001`, `CP-OFF-001`, `CP-DATA-001`,
`CP-SYNC-001`, `CP-OFF-UI-001`, `CP-OFF-TEST-001` each appear exactly once as a title, and **none of them
appears anywhere in the repository today** — this is their first survey.

⚠ **Two near-misses worth recording:**

1. **`CP-DATA-001` vs `COMP-DATA-001`** are different documents differing by two characters — the CP one is
   Practice's local data model, the COMP one the platform local data engine. In a filename list they sort
   adjacently. Cite them with their titles.
2. **`COMP-OFF-001` names two files** (§0). Not an ID collision but the same hazard on disk.

**Structural note:** this set introduces a **fourth numbering register** for Practice, alongside the three
already recorded in `docs/CPR-V3-SOURCE-OF-TRUTH` and `cpr-v3-source-of-truth` memory (bare `CPR-nnn` =
v1.0, `CPR-V2-nnn`, `CPR-V3-nnn`). The offline set uses `COMP-XXX-001` / `CP-XXX-001` — a *prefix* scheme
rather than a numeric one, so it does not collide, but `src/lib/practice/spec-numbering.ts` should learn
about it before anything cites these IDs in code.

---

## 8. Capability codes — probed, not counted

Method: parsed every `insert into practice_role_capabilities` block across all 257 migrations for the
canonical set; independently walked all `.ts`/`.tsx` in `src/` for referenced codes; diffed.

**Canonical (seeded): 47 codes**, across 16 migrations (191-200, 202, 239, 246, 247, 248).

```
access.review        appointment.manage   comm.record          data.export
diagnosis.record     document.author      document.sign        document.view
encounter.create     encounter.edit       encounter.list       encounter.sign
followup.manage      followup.view        inbox.record         inbox.review
message.use          pack.install         parameter.configure  parameter.record
parameter.view       pathway.assign       pathway.design       pathway.view
patient.create       patient.edit         patient.list         patient.merge
patient.view         practice.archive     practice.calendar.view
practice.home.view   practice.lifecycle.view                   practice.locations.manage
practice.members.manage                   practice.restore     practice.settings.manage
practice.suspend     procedure.manage     procedure.record     queue.manage
report.view          search.use           task.manage          task.view
template.manage      treatment.record
```

**Referenced but not seeded: 3** — `medication.view`, `medication.record`, `medication.override`.

⚠ **These are not invented.** `medication-constants.ts:40-45` declares the situation in its own words:
*"ALL THREE ARE SEEDED BY THE MIGRATION IN medication.ts's HEADER, WHICH IS NOT YET APPLIED. Until it is,
the harness assertion that they exist is expected to report them absent and says so in those words rather
than failing silently."* A known, labelled, harness-covered pending state.

**So: 47 real, 3 pending-and-declared, 0 invented.** The Practice capability space is currently clean.

**For phase one: introduce no new capability code.** `practice.home.view` already gates `/practice/today`
and `GET /api/v1/practice/dashboard`, and offline is the same read by the same user. A
`practice.offline.use` code would be a seventh invention. Gate rollout with the **flag** (§3.7); gate access
with the **existing capability**.

---

## 9. Direct answers

### Is PWA-only the honest first target?

**Yes — decisively, and more so than the framing suggests.**

- The specs agree on sequencing in principle but not in emphasis: COMP-OFF-001 §"Recommended Development
  Order" puts **Desktop Client at 7 and PWA Client at 8**, and COMP-DESK-001 calls desktop "the flagship
  offline client". ⚠ **Recommend departing from that order, deliberately and on the record.**
- Desktop is **Tauri, not Electron** (COMP-DESK-001 §3) — but the distribution problem is the same and
  larger than it looks: code signing, an update channel with rollback, version-compatibility checking, and
  a second local database engine (SQLite) behind the same repository interface. COMP-DESK-001 §9 asks for
  all of it.
- The repository has **zero** native-shell traces. Desktop is not a port; it is a new artefact.
- **The decisive argument is the target deployment.** In a Ugandan clinic, the device is far more likely to
  be a shared or personal Android phone than a managed Windows desktop. Desktop-first would build the
  flagship client for the environment that needs it least.
- The one honest cost of PWA-only, stated plainly: **the AES-256 local-encryption promise cannot be kept in
  a browser** (§3.6). Desktop is where it becomes true. That is a reason to keep the claim off the UI now —
  not a reason to build desktop first.

### Which offline capability would a real practitioner miss most, in a Ugandan clinic on intermittent connectivity?

Ranked by felt loss, not spec order:

1. **Today's list — who is here, who is next, who is waiting.** Without it the clinic does not run. This is
   the whole of phase one's value and it is correct to start here.
2. **The record of the patient in the room** — allergies, current treatments, what happened last visit.
   Second only because the person is present and can often tell you.
3. **Writing the encounter note.** ⚠ Ranked third by *felt* loss but it is **the highest-value capability in
   the entire programme**, and it is phase two. A practitioner who cannot record loses the consultation
   permanently; note-writing is the reason offline-first exists. It is third here only because §5 says it
   must not be attempted until all six preconditions hold. **This ranking is a sequencing statement, not a
   priority statement.**
4. **Cached practice guidance.** ⚠ Under-ranked by everyone including the spec, which buries it in §7. It
   is static, safe, conflict-free, and in a setting with intermittent connectivity a clinician who cannot
   look something up simply does not look it up. **Cheapest real value in the programme — include it in
   phase one.**
5. **Booking the follow-up.** A patient who leaves without a date often does not return. Write path;
   phase two.
6. Offline search across the register — high perceived value, disproportionate cost and privacy exposure
   (§3.2.1).
7. Attachments and photographs — real, but quota-bound and last.

### What needs a user decision before any code?

1. ⚠ **The hard-expiry threshold** (§3.8.2). This is the only control that acts on a device that never
   reconnects, and it is a clinical-risk judgement, not an engineering one. **Proposal to accept or
   change: expire at the earlier of end-of-clinic-day (practice timezone) or 12 hours from `asOf`;
   escalating labels from 60 minutes.** The reasoning for 12 rather than 4 is in §3.8.2 and the trade is
   explicit.
2. ⚠ **The cached field set** (§3.8.1) — the single biggest security decision in phase one. **Proposal:
   name, one identifier, age, time, duration, status, encounter id. Drop DOB, contact details, the
   identifier set, free-text reason, clinical service labels, allergies, medications, diagnoses, and all
   metrics.** §3.8.7 argues against the nameless alternative and explains why it may be *less* safe.
3. ⚠ **Whether clinical service labels may be cached at all**, and whether sensitive-service practices
   (HIV, mental health, TB, reproductive health) should be defaulted to no-cache (§3.8.7).
4. ⚠ **Correct COMP-SEC-001 (offline) §11's acceptance criterion** — *"Unauthorized devices cannot access
   synchronized data"* is not achievable for a cached offline device and cannot be signed off as written
   (§3.8.2). Four further sentences need the same treatment before any of them reaches a screen.
5. **Whether the queue is shown at all offline.** A cached waiting-list is a claim about *now* and is the
   most staleness-prone item in the payload. Cleanest option: show the day's plan, suppress the live queue
   entirely offline.
6. **Who can turn the cache off** (§3.8.6) — recommend a practice administrator, not only a super-admin,
   and prominent at onboarding rather than buried in settings.
7. **Renumber `COMP-SEC-001` (offline) → `COMP-OSEC-001`?** (§7) Cheap now, expensive after it is cited.
8. **Confirm PWA-first over the specs' desktop-first order** (§9), recorded as a deliberate departure.
9. **Correct the "Server Wins + Always Require Review" attribution** (§4.4) — adopt it as a decision, or
   drop it, but do not leave it credited to a spec that does not contain it.
10. **Is a weight-based dose permitted offline at all?** (§4.1) Three options: forbid entirely offline;
    permit only on a weight recorded in the same session; permit on a cached weight within a stated window
    with its capture date printed. **Recommend option two for phase two**, but it is a clinical call.
11. **Cache on untrusted devices?** Reusing `practice_session.trusted` is free; the question is whether a
    pilot practice's devices are marked trusted today.
12. **Which pilot practice** gets the `plat_feature_flags` tenant-scoped rollout first.

---

## Appendix — sources

**Read in full (19 documents):** all 15 in `~/Downloads/CP Offline/` (both COMP-OFF-001 variants), plus
`COMP-DESK-001`, `COMP-PWA-001`, `COMP-TEST-001`, and `COMP-SEC-001_v1_Competen_Platform_Security_Framework`
from `~/Downloads/`. Bodies extracted from `word/document.xml` and diffed as text.

**No comp (`.png`) was opened.** Fifteen accompany the specs; §6 is from text only.

**Repository: read-only.** No file under `supabase/migrations/**` was modified. `navigation.ts`,
`palette.ts`, `parameters.ts`, `messaging.ts`, `src/lib/notifications/**`, `patient-*`, `medication*`,
`knowledge*.ts`, `scheduling.ts`, `booking-rules*.ts` were read but not written. The only file created is
this one.

**Key code references for the build agent:**
`src/lib/practice/dashboard.ts` (the read model, `asOf`/`feeders`) ·
`src/app/api/v1/practice/dashboard/route.ts` (the JSON bridge, already built) ·
`src/app/practice/(shell)/LiveRefresh.tsx` (the three-state indicator to extend) ·
`src/app/practice/(shell)/today/page.tsx` (the components to reuse) ·
`src/lib/platform/feature-flags.ts` (rollout gate) ·
`src/lib/practice/security.ts` + `device-register.ts` (device trust) ·
`src/lib/practice/clinical-calculators.ts` (the dose safety argument) ·
`supabase/migrations/246-practice-clinical-parameters.sql:613-625` (the percentile refusal).
