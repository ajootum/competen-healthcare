# PLAT-ARCH-SURVEY-001 — Survey of six platform architecture specifications

Survey only. No code, no migration, no file changed except this one. Date: 2026-08-08.

Companions: `docs/CNE-SURVEY-001.md` (**[CNE]**), `docs/COMP-SECURITY-SURVEY-001.md` (**[SEC]**),
`docs/ENT-REVIEW-001-three-enterprise-specs.md` (**[ENT]**), `docs/CPR-BUILD-000-product-setup-plan.md`.

---

## 0. Provenance — bodies, not byte sizes

All six `.docx` are ~38–40 KB on disk and **that number means nothing**: `styles.xml` is ~349 KB
uncompressed in every one of them. The bodies are what follow.

| Document | `document.xml` md5 (12) | body bytes | text bytes | text lines | `styles.xml` |
|---|---|---|---|---|---|
| CP-ROUTE-001 Practitioner Identity, Handles & Tenant Routing | `a01005b64d95` | 11,832 | 3,352 | 74 | 349,726 |
| HQ-ARCH-001 Competen HQ & Governance Context Architecture | `b3bea8d3a6ba` | 17,324 | 4,961 | 113 | 349,726 |
| IAM-CTX-001 SSO, Multi-Product Governance & Context Switching | `8a8784f5b852` | 9,948 | 3,236 | 59 | 349,726 |
| PLAT-CAP-001 Platform Capability Registry & Composition Framework | `be54528e4ef6` | 13,475 | 3,277 | 104 | 349,538 |
| PLAT-CONFIG-001 Product Registry, Workspace Templates & No-Code | `8cc94ad1da3d` | 11,638 | 3,071 | 81 | 349,538 |
| PLAT-ROUTE-002 Product-Owner Routes & Reserved Namespaces | `7a607c5a7c17` | 10,764 | 2,942 | 74 | 349,726 |

Six distinct bodies. **They are two batches, not one.** Four (`CP-ROUTE-001`, `HQ-ARCH-001`,
`IAM-CTX-001`, `PLAT-ROUTE-002`) share `styles.xml` `349,726`, carry the `COMPETEN PLATFORM` banner
and the line *"Version 1.0 | Developer Specification | Status: Approved Direction"*. The two
`PLAT-*` documents share `styles.xml` `349,538`, have **no banner, no version line and no status
line at all**. `PLAT-CAP-001` says only *"Developer Specification"*; `PLAT-CONFIG-001` says nothing.

That matters for scheduling: **the four routing/identity documents declare themselves approved
direction; the two PLAT framework documents declare nothing.** Treat the latter as drafts.

Longest body is 17 KB of XML → **5 KB of prose**. None of the six contains a data model beyond a
two-column field table, an API surface, an error contract, a state machine, a permission matrix, or
a single number. **Every one of them is a page of headings.** Cross-check with the density of what
they propose to change and the mismatch is the central risk in this report.

**No comp was consulted for any finding below.** Every quotation is from the extracted body text.

---

# 1. ⚠ THE ROUTING MIGRATION

**The shape is decided and this section scopes it, not re-argues it.**

> Each practitioner gets their own URL. Competen Practice is multi-tenant; tenants own their
> practice, so they own their address.

**The tenant segment resolves against whichever identifier exists:**

| State | URL |
|---|---|
| Before a handle is claimed | `/practice/cp-000123-4/today` |
| After a handle is claimed | `/practice/dr-eokaisu/today`, the number form **redirecting** to it |
| After a handle change | the old handle redirects too — `practice_handle_history` already guarantees a retired handle never 404s and never routes to a stranger (`cdea8622`) |

Public booking stays **handle-only** at `/practice/book/@handle`. The number is sequential and leaks
count and ordering, so it must never become a public address; a practice with no handle simply has
no public page, which is already true and already correct.

§1.1 records what the specification's own text requires, because it constrains the design. §1.2
onward is the migration.

## 1.1 What CP-ROUTE-001's text requires — quoted

The text is unambiguous, and it requires the handle in the **authenticated** route.

§2 Canonical Route:

> *"Internal practitioner workspace route: `/practice/{practice-handle}/{workspace}/{module?}/{resource?}/{action?}`"*

§3 Examples names `/practice/dr-eokaisu/today`, `/practice/dr-eokaisu/patients`,
`/practice/dr-eokaisu/calendar`, `/practice/dr-eokaisu/encounters/8f3a...`, `/practice/dr-eokaisu/setup`.

§8 Legacy Route Migration:

> *"Existing routes such as `/practice/today` should remain temporarily supported as redirectors.
> After authentication, the system resolves the active practice and redirects to
> `/practice/{handle}/today`. New internal links must use the canonical handle-aware route."*

§10 Acceptance Criteria:

> *"All CP private workspace links preserve the handle."* … *"Legacy `/practice/today` redirects to
> canonical handle route."*

**Answer to (1): the text requires the handle in authenticated practitioner routes, not only the
public one.** It is stated in four places, including an acceptance criterion, in the word
"internal"/"private" each time. There is no reading on which this is public-only.

⚠ And note the text **separates** the two, which protects the settled booking URL. §9:

> *"Public booking should use a clean patient-facing namespace such as `/book/{practice-handle}`.
> The practice handle may be shared across internal practitioner routing and public booking
> identity, while access rules remain completely separate."*

The repo's settled address is `/practice/book/@handle` (`cdea8622`), i.e. the same handle under a
different prefix. **CP-ROUTE-001 §9 permits exactly that** — it says "such as", and it explicitly
allows one handle to serve both. **No conflict with the printed business cards.** See §1.7.

## 1.2 The route inventory and the cost — counted, from the build manifest

`.next/app-path-routes-manifest.json` is the authority here, not a `find`. It lists **1,326 app
routes** for the whole application, of which **64 URL patterns are under `/practice`**.

| Thing | Count | Source |
|---|---|---|
| `/practice` URL patterns in the build manifest | **64** | `app-path-routes-manifest.json` |
| …inside `(shell)` — **these gain the tenant segment** | **48** | manifest keys containing `(shell)` |
| …outside the shell — **these do not move** | **16** | `/practice`, `/practice/[area]`, `access-status`, `book`, `book/[handle]`, `book/[handle]/print`, `join`, `login`, `offline`, `onboarding`, `patient-booking`, `patient-login`, `select-workspace`, `sign-in`, `sign-up`, `start` |
| Route files under `src/app/practice/` | **65** (64 `page.tsx` + 1 `layout.tsx`) | `find` |
| API routes matching `src/app/api/**practice**` | **104** | `find` — ⚠ **unaffected**, see below |
| Literal `/practice/...` string sites in `src/` | **681** | `grep` over `.ts`/`.tsx` |
| Files containing a `/practice/` literal | **395** | `grep -l` |
| `href:` entries in `src/lib/practice/navigation.ts` | **24** (23 `/practice/*`) | `grep` |
| `ok()` assertions in `practice-current-activity-harness.ts` | **94** | counted |
| …in the route/navigation block | **18** (§9 block + `7d`/`10j`) | see below |
| …that **actually have to change** | ⚠ **2** | see below |
| Harness files containing a `"/practice/` literal | **26** of `scripts/*.ts` | `grep -l` |
| Redirects required to keep every live URL alive | **48** | one per shell pattern |

**The 104 API routes are unaffected.** `requirePracticeContext()` takes the workspace from the
session plus the active-workspace cookie; no `/api/v1/practice/*` path contains a workspace
identifier. They should later accept an explicit workspace (§1.6 #3), but nothing about them breaks.

### ⚠ Only 2 of the 18 assertions change, and the reason matters

The 18 are `7b`, `7c`, `7d`, `10h`, `10i`, `10j`, `9a`, `9b-order`, `9c`, `9e-control`, `9g`,
`9g-b`, `9f-b`, `9f-b-control`, `9h`, `9h-b`, `9f`, `9i` (+ `9i-control`).

Sixteen of them compare `PRACTICE_NAV` against `V5_ORDER`, `PRIMARY_ORDER`, parent/child structure,
or assert `href.startsWith("/practice/")`. **If the catalogue keeps module-relative hrefs
(`/practice/home`) and the sidebar component prefixes the tenant at render time, all sixteen pass
unchanged.** Do not rewrite the catalogue's hrefs into tenant-aware functions — that would touch all
18, plus every consumer, for no gain.

The two that must change both read the **filesystem**:

```
// 9f: nav href /practice/{name}  ->  src/app/practice/(shell)/{name}/page.tsx
// 9i: readdirSync(join(cwd,"src","app","practice","(shell)"))
//       .filter(d => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("_"))
```

⚠ **`9i`'s scan skips any directory beginning with `[`.** Move the shell to
`src/app/practice/[tenant]/(shell)/` and that scan returns **zero** directories, so `9i` passes
**vacuously**. Only `9i-control` (`shellDirs.length >= 15`) fails and catches it. **The control
assertion is the entire safety net for this migration. Do not weaken it to get a commit green.**

### The real cost is the 681 link sites, not the 48 pages

Moving 48 directories is one `git mv`. Prefixing 681 literals is the work, and it is the part that
fails silently — a missed `href="/practice/patients"` inside a tenant page still resolves (to the
legacy redirector), so it *works* while quietly losing the tenant and re-deriving it from the
cookie. **That is the wrong-practice bug wearing a working link.**

The enforceable fix: one `practiceHref(tenant, path)` helper (mirroring how
`identity-service.ts` already forces every booking link through one `bookingUrl()` — *"a second
composition anywhere is a card printed pointing at an address the application does not serve"*),
plus a harness assertion that **no raw `/practice/` string literal appears anywhere under
`src/app/practice/[tenant]/` or `src/components/practice/`**. That assertion is greppable, exhaustive
and cheap, and it is the only thing that can prove the 681 were all converted.

## 1.3 ⚠ The two identifier namespaces cannot collide — verified

This is the property that makes the decided shape safe, and it is already true by construction.

| | Handle | Practitioner number |
|---|---|---|
| Live format | `^[a-z][a-z0-9]{2,29}$` (`HANDLE_RE`, and the same regex as a DB `check`) | `CP-000123-4` — prefix `CP`, 6 digits, separator `-`, Damm check digit (`DEFAULT_FORMAT`, mig 220) |
| Contains hyphens | ❌ **forbidden** | ✅ **always two** |
| Live rows | **0 claimed** | **32 — every identity has one, none null** |
| Source | claimed deliberately (`bfc73de9`) | `practice_practitioner_number_seq`, a real Postgres sequence: *"permanent, never reused"* |

⚠ **A handle can never look like a number, because the number contains hyphens and the handle
regex forbids them.** No reserved word contains a hyphen either (32 rows probed). So
`parseTenantSegment(segment)` is total and unambiguous:

1. contains `-` → try `parsePractitionerNumber` → **Damm-validate offline**; invalid check digit is a
   deterministic 404 **with no database read at all**;
2. matches `HANDLE_RE` → handle lookup;
3. neither → 404.

Two consequences worth naming:

- ⚠ **Case.** Numbers are stored uppercase (`CP-000123-4`); the URL form is lowercase
  (`cp-000123-4`). Pick one canonical casing and 301 the other, or every tenant has two addresses and
  every analytic, log and audit line splits in half.
- ✅ **The Damm digit is a free tenant-segment validator.** A typo'd or probed number is rejected
  before any query — which matters because the segment sits in front of 48 pages and the sequence
  leaks ordering. Rate-limiting enumeration is still worth doing; the check digit makes blind
  guessing 10× harder for free.

## 1.4 ⚠ The handle is on the PRACTITIONER; the workspace is the tenant

The decided shape resolves the claim/route tension. It does **not** resolve this, and it is the one
structural thing the specification does not know about.

- Live: `practice_practitioner_identity` = one row **per person** (`user_id` unique-per-person,
  `handle` unique, `practitioner_number` unique, `primary_workspace_id` nullable pointer).
- Live: `practice_workspace` = one row **per practice** (`id, type, name, owner_person_id, status,
  country, timezone, default_practice_type, profession_code, primary_specialty_code`) — **no
  `handle`, no `practitioner_number`, no `subscription_id`, no `branding`, no `booking_enabled`.**
- CP-ROUTE-001 §4's "Practice Identity Object" is neither: it is a merge, and 3 of its 8 fields have
  no home today.

Probed: **30 of 32 identities have `primary_workspace_id = null`.** The pointer exists and is
almost never set. So `/practice/cp-000123-4/today` resolves *a person*, and then has to find *their
workspace* — through `primary_workspace_id` (usually null) or through `practice_membership`.

⚠ **When a person holds two memberships, a person-scoped segment cannot name a practice.** The
segment is doing tenant work with a person's identifier. It works today and it works for every
single-practice practitioner, which is everyone. It stops working the first time somebody joins a
second practice — and §1.5 shows the product already expects that.

**This does not block the migration.** It means the resolver must be written as
`segment → identity → workspace` with an explicit, named rule for the two-workspace case (most
likely: fall through to `/practice/select-workspace`, which exists), and it means
`primary_workspace_id` must actually be **set at provisioning** rather than left null — a one-line
fix in `issueIdentity`'s caller, worth doing before anything routes on it.

## 1.5 ⚠ Does anything today assume exactly ONE practice? — probed

**No. And that changes the ordering of this programme.**

Every site that could assume one, probed across `src/`:

| Site | What it does |
|---|---|
| `src/lib/practice/api-context.ts:22` | `if (access.workspaces.length === 1) workspaceId = access.workspaces[0].id;` — **the single-workspace case is a *fallback branch*.** `=== 0` → 403; `> 1` → **409 `WORKSPACE_CHOICE_REQUIRED`** |
| `src/lib/practice/shell.ts:103` | identical shape; `> 1` → **`CHOOSER_REQUIRED`**, carrying the full workspace list |
| `src/app/practice/select-workspace/page.tsx` | exists, and its own copy says *"You belong to more than one. Which are you working in now?"* |
| `src/app/dashboard/layout.tsx:44` | `workspaces[0]` — but this is the **platform** dashboard, not Practice. Unrelated. |
| `identity-service.ts` `primary_workspace_id` | a nullable **pointer**, null in 30 of 32 rows |
| `practice_membership` unique index | `(workspace_id, user_id, role_code) where status='active'` — constrains duplicates *within* a workspace, **says nothing across workspaces** |
| Live data | `USERS BY DISTINCT WORKSPACE COUNT: [1, 1]` — nobody holds two **yet** |

**So the app is already multi-practice. It resolves the practice from an ambient cookie**, and
`access.ts` says so in its own words: *"The cookie is a PREFERENCE, not an authority."*

⚠ **That reframes the whole migration.** The tenant segment is not cosmetic and it is not merely an
ownership gesture — **it fixes a latent defect that exists in the code today**: two practices, one
cookie, means a second tab silently renders whichever practice the cookie was last set to, under a
URL that says nothing. It is latent only because `[1, 1]`. The first practitioner who joins a
colleague's practice makes it real, and in a clinical product "the wrong patient list under the
right-looking URL" is not a broken link.

**Ordering consequence: the tenant segment should be scheduled ahead of the other five specifications**,
not after them. It is the only item in this survey that closes a correctness hole rather than adding
a capability.

## 1.6 ⚠ Can `src/proxy.ts` resolve the tenant before the page renders?

⚠ **Correction to an earlier draft of this report: `src/proxy.ts` exists.** It is Next 16's renamed
middleware, 104 lines, and its matcher covers everything except static assets — so it runs on all
1,326 routes. It already mints a per-request `x-trace-id`, forwards `x-pathname`, refreshes the
Supabase session, and plants the practice device cookie. `083a5770` restructured it so **the response
is built once at the end** and every cookie is collected into `pending` until then.

**Answer: it can do the syntactic half, and it must not do the database half.** Three reasons, one
of them fatal:

1. ⚠ **FATAL — it cannot read the tables.** The proxy builds its client with
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `practice_practitioner_identity`, `practice_handle_history` and
   `practice_reserved_handle` are all `enable row level security` with **no policies at all**
   (mig 218 §6, deliberately: *"A policy that let anon select the row would expose
   primary_workspace_id and user_id"*). Probed live with the anon key: both
   `practice_practitioner_identity` and `practice_workspace` return **0 rows, no error** — the
   silent kind of failure, which would resolve every tenant to "not found". Giving the proxy a
   service-role key would put the service-role key in the request-path of all 1,326 routes,
   including every public marketing page. **Do not.**
2. ⚠ **It would break the single-response invariant `083a5770` created.** A tenant resolution that
   ends in `NextResponse.redirect(...)` returns a *different* response object from the one the
   `pending` loop writes onto — so it would ship a redirect carrying **none of the refreshed auth
   cookies**. That is the silent-sign-out bug the file's own comment warns about
   (*"a stale snapshot drops a refreshed session and silently signs people out"*), reintroduced
   through a new door. If any redirect is ever added here, it must be built by the same
   `for (const c of pending) response.cookies.set(...)` tail.
3. **Cost.** A database round trip in the proxy is a round trip on every request to every route in
   the application, ~95% of which are not Practice.

**What the proxy *should* do — free, safe, and useful:** the classification in §1.3 is pure
computation. `parseTenantSegment()` needs no I/O: hyphen + Damm check, or `HANDLE_RE`, or neither.
The proxy can reject a malformed segment and forward a resolved `x-practice-tenant` header
**exactly the way it already forwards `x-pathname`** — same mechanism, same `withTrace()` call, no
new response shape, no query.

**Where the authorised lookup belongs: the layout.** `src/app/practice/[tenant]/(shell)/layout.tsx`
already calls `resolvePracticeShell()`, which already holds a service-role admin client and already
runs eight guards including `resolvePracticeAccess()` — **which already returns the full workspace
list**. Matching the URL segment against that list is a comparison over data the layout has already
fetched. **Cost: one array comparison. No extra query. No extra latency.**

That also puts the tenant check *inside* the guard order rather than in front of it, which is what
`api-context.ts` already insists on for APIs (*"API enforcement must not rely on the sidebar having
hidden a button"*). A proxy-level tenant check would be a second authorisation site to keep in sync
with the first — the exact bug class [SEC] catalogues.

⚠ One caveat the layout imposes: **a layout does not re-render on client-side navigation.**
`proxy.ts` says so itself. So the tenant must be read from `params` (which *is* per-navigation), not
from the `x-pathname` header. The header is safe only for the server-render redirect guard, as the
existing comment states.

## 1.7 ⚠ How the redirect layer is proven exhaustive rather than assumed

**A half-done routing migration does not degrade — it leaves live URLs dead.** So the question is
what *assertion* can prove no route was missed.

### The route-manifest diff works here, and it is already available

`.next/app-path-routes-manifest.json` exists in this repo's build output and is machine-readable:
1,326 app routes, 64 under `/practice`, with `(shell)` visible in the keys so shell and non-shell
split cleanly (48 / 16, both counted above from it).

**The assertion:** capture the 64 `/practice` URL patterns from a build of the current `HEAD` as a
committed baseline. After the migration, build again and assert that **every pattern in the baseline
either still exists in the new manifest, or is named by an entry in an enumerable redirect table.**
Nothing is hand-listed; both sides are derived from the build.

Why it is genuinely exhaustive rather than a checklist:

- It is derived from the **compiler's own output**, so a route cannot be absent from it and present
  in the app, or vice versa.
- It covers dynamic patterns correctly. `/practice/patients/[patientId]` is one entry covering every
  patient, and a redirect rule operates on the pattern, so pattern-level coverage *is*
  instance-level coverage.
- It fails **loudly and specifically**: the diff names the missing pattern.

### Three conditions, without which it proves nothing

1. ⚠ **The redirect table must be data, not control flow.** If redirects are `if` statements inside
   48 layouts, no harness can enumerate them. One exported `LEGACY_PRACTICE_ROUTES` array that both
   the redirectors and the harness read is what makes the assertion possible at all. This is the
   same discipline `BOOKING_PATH` already applies to the booking link, and for the same stated
   reason.
2. ⚠ **The handle-less routes must keep working and redirect — not be deleted in the same change.**
   A deleted route is indistinguishable from a migrated one in a `find`; it is distinguishable in
   the manifest diff only if the baseline is committed *first*. **Commit the baseline before the
   first page moves.**
3. **Pair it with `9i-control`.** The manifest diff proves no URL died. `9i-control` proves the
   filesystem scan still sees the tree. Neither catches the other's failure.

### What the manifest diff cannot see

It sees URL *patterns the app serves*. It cannot see URLs *that exist in the world*: bookmarks, QR
codes, printed cards, links stored in database rows, links pasted into WhatsApp. Those are §1.8.

## 1.8 What breaks that is not a route

**✅ The booking URL and everything printed from it are completely safe.** Verified:

- `BOOKING_PATH = "/practice/book/"` and `bookingUrl(handle) = ${identityHost()}${BOOKING_PATH}@${handle}`
  are single constants in `identity-service.ts`, with a comment stating that a second composition
  anywhere *"is a card printed pointing at an address the application does not serve, and unlike a
  screen you cannot redeploy a poster."* The harness asserts the constant against the route file.
- `book` is a **static** segment, so Next gives it precedence over a sibling `[tenant]` — and
  `book` **and** `booking` are both already rows in `practice_reserved_handle` (probed), and the
  number form starts `cp-`, so no tenant can ever be `book`.
- `bookingQr()` encodes `bookingUrl(handle)` locally (no external service) → **QR codes on printed
  cards are unaffected**.
- `shareTemplates()` (WhatsApp / SMS / email / printed card) all compose from `bookingUrl()` →
  **unaffected**.
- `bookingPath(handle)` is used for in-application redirects → **unaffected**.

⚠ **So the business cards can go to print.** Nothing in this migration touches them. The one live
defect remains that **zero handles are claimed**, so no card can be printed with a working address
yet (§1.9).

**What is at risk:**

| Artefact | Risk | Mitigation |
|---|---|---|
| **Bookmarks** of `/practice/today`, `/practice/patients`, etc. | Die unless the legacy pattern redirects | The 48 redirectors, kept indefinitely (§1.10 phase 5) |
| **Absolute URLs stored in rows** | Frozen at the shape they were written with; no redeploy fixes them | ⚠ **Audit before moving anything.** Notifications, tasks, messages and audit payloads are the candidates. Any stored `/practice/...` needs the redirectors to survive permanently, not temporarily |
| **`practice_configuration.letterhead_*`** (six columns, live) | If a URL ever reached a letterhead it is on paper | Check whether any letterhead field contains a path |
| **Deep links inside computed payloads** — panel `href`s (`7d`), glance tile `href`s (`10j`) | These are computed per render, so they follow the code | Safe, provided §1.2's `practiceHref` rule is enforced |
| **`identitySetupView`'s live preview** | Shows the booking address; unaffected | — |
| **External inbound links** (a practitioner emailing a colleague a patient link) | Invisible to every tool | Redirectors, permanently |

⚠ **The rule that follows: the 48 redirectors are permanent infrastructure, not scaffolding.**
Retiring one requires evidence that nothing hit it — which requires counting hits, which nothing
does today.

## 1.9 ⚠ Does anything break today because there is no tenant segment? — probed

| Probe | Result |
|---|---|
| `practice_practitioner_identity` rows | **32** |
| …with a `practitioner_number` | **32** — none null |
| …with a claimed `handle` | **0** |
| …status / discovery | all 32 `created` / `hidden` |
| …with `primary_workspace_id` set | **2** |
| `practice_workspace` rows | **2** (`Trial`, `Dr Lifecycle`, both `individual_practice`, `ACTIVE`) |
| `practice_membership` rows | **4** — 2 owners + 2 practitioners |
| distinct workspaces per user | `[1, 1]` |
| `practice_handle_history` / `practice_booking_access` | **0** / **0** |

**Nothing in the authenticated app breaks today** — the cookie path works, and the wrong-practice
defect (§1.5) is latent because nobody holds two memberships.

⚠ **One thing does break, and it is public.** `/practice/book/@handle` resolves through
`resolveHandle()`. With **zero claimed handles and all 32 identities `hidden`**, the public booking
page cannot resolve for any practitioner alive. `bookingUrl()` composes an address; **no address
currently works.**

**That is a handle-claiming defect, not a routing defect** — and under the decided shape it is
independent of the migration, because the tenant segment falls back to the number. So it can and
should be fixed first, in parallel, without waiting for a single route to move.

## 1.10 ⚠ What a half-done routing migration destroys

Beyond the obvious (live URLs 404, bookmarks die):

1. **Two sources of workspace truth.** For the duration, some pages read the path and some read the
   `active workspace` cookie. A practitioner switches workspace in one tab, the cookie changes, and
   an **un-migrated tab silently starts rendering the other practice's patients** — with the old URL
   still in the address bar. This is a clinical-safety failure, not a cosmetic one: the header says
   one practice, the list is another's.
2. **`9i` passes vacuously** while the tree is half-moved (its scan skips `[`-prefixed dirs), so the
   "every built page has a way in" guarantee evaporates without going red. Only `9i-control` catches
   it. Do not disable that control to "get the migration green".
3. **Capability checks split.** `requirePracticeContext(capability)` resolves the workspace before
   checking the capability. If the path becomes authoritative for some routes and the cookie for
   others, a capability is evaluated against workspace A while the page renders workspace B.
4. **Printed and shared artefacts.** `bookingQr()` renders SVG/PNG QR codes; those are physical.
   Any internal URL that reached a QR, a PDF letterhead (`practice_configuration.letterhead_*`) or
   an email dies silently — nothing tests a printed page.
5. **Deep links in stored data.** Panel and tile `href`s are computed (`7d`, `10j` assert they start
   with `/practice/`), but notifications, tasks and messages may carry stored URLs. Any stored
   absolute path is frozen at the shape it was written with.
6. **Redirect loops.** `/practice/today → /practice/{tenant}/today` plus the shell's existing
   redirects (`select-workspace → /practice/home`, `WORKSPACE_REQUIRED → /practice`) can cycle if
   the tenant cannot be resolved. ⚠ `src/proxy.ts` DOES exist (§1.6) but must not own this — the redirect
   belongs in the layout, where the workspace list is already in hand.
7. **The 409 `WORKSPACE_CHOICE_REQUIRED` contract becomes wrong** for path-addressed routes: the
   choice is in the URL, so a 409 asking the client to choose is a bug the client cannot satisfy.

**Sequencing rule that avoids all seven:** make the **path authoritative and the cookie derived**
before moving a single page — i.e. teach `resolveWorkspaceContext`/`requirePracticeContext` to
accept an explicit workspace and treat the cookie as fallback, land that alone, then move the tree
in one commit with `9i-control` green.

---

# 2. ⚠ COMPETEN HQ — a governance platform with graduated positions

**Confirmed by the user, and it supersedes "a rename with the same gate":**

> *"hq is the Competen Governance platform. Not everyone here has to be super admin. Platform
> ownership will be one or two accounts only. So we need the hierarchy to be clear."*

So HQ is `identity → positions → contexts → products`, matching HQ-ARCH-001 §5/§6 and IAM-CTX-001 §3.
⚠ **`IAM-001A` is not in `docs/`, not in the repo, and not in `~/Downloads`** — I could not read it.
Everything below is from the six bodies plus the live system.

## 2.0 ⚠ SAY IT PLAINLY: THIS IS A SECURITY IMPROVEMENT, NOT AN ORG CHART

**Today every super-admin has every power.** `src/app/super-admin/layout.tsx` is one binary test —
`if (!userRoles.includes("super_admin"))` — in front of **204 URL patterns and 31 modules**. There is
no gradation inside it. A person appointed to review Practice governance and a person who can
deprovision a tenant pass exactly the same check and see exactly the same estate.

Live: **47 profiles, 3 hold `super_admin`.** Splitting that into scoped positions is least privilege
applied to the most privileged surface in the product. **It reduces standing authority; it does not
merely relabel it.**

## 2.1 ⚠ THE RISK INVERTS — and both directions must be closed by the same design

| # | Danger | Why the obvious design concedes it |
|---|---|---|
| **1** | **Granting more than intended.** A Practice Product Director reaching Executive, Quality, or Learning governance. | A lift-and-shift of `/super-admin`'s binary gate into `/hq` hands full platform power to every governance user the split was meant to scope. The gate has no vocabulary for "this context only" — it has one word. |
| **2** | **Locking the real owners out.** One or two accounts. | If the model is wrong on the day it ships, the people who could fix it are the people who cannot get in. ⚠ **This product has already shipped one control whose enforcement had no enrolment path behind it** — the MFA policy in CPR-370/mig 213, live with `session_idle_minutes: null` and no enrolment surface. A positions model with no break-glass repeats that with the door locked instead of open. |

**A design that closes one by conceding the other is not a design.** What closes both:

- ⚠ **`super_admin` remains, unchanged, as the break-glass anchor.** It is the RLS anchor
  (`current_user_is_super_admin()`, **39 references across 10+ migrations**, `search_path` pinned in
  mig 252) and the column migrations **249** and **250** closed two escalation paths against this
  week. **Platform ownership IS that role.** The governance positions are the *new thing beside it*,
  not a replacement for it. Renaming it stays out of scope — and nothing in the six bodies asks for
  it: the string `super_admin` **does not appear in any of the six documents**.
- **Every HQ position is additive and scoped.** A position grants a context; it never grants the
  anchor. Removing every position leaves the two owners still able to sign in.
- **Ship the positions model in OBSERVE before ENFORCE.** The repo already has this idiom —
  `755c76b8` kept every live practice in OBSERVE while the lock screen shipped. Run the position
  matrix in log-only mode, compare against what people actually reach, then enforce.

## 2.2 ⚠ Where the hierarchy should live — and it is largely already built

Four candidate homes were probed. **Two of the four already exist and are empty.**

### (a) `profiles.platform_role` / `platform_roles[]` — the landlord axis. EXISTS, unenforceable.

`src/lib/platform/landlord.ts` implements a **genuinely graduated** model already:

```ts
export function landlordCan(caller: LandlordCaller, ...required: PlatformRole[]): boolean {
  if (caller.isOwner) return true;                              // super_admin OR platform_owner
  if (required.length === 0) return caller.platformRoles.length > 0;   // ⚠ see below
  return caller.platformRoles.some(r => required.includes(r));
}
```

Migration 040 documents an **11-value vocabulary — in a column COMMENT, not a CHECK constraint**:
`platform_owner | platform_operations | customer_success | support | product_manager | engineer |
ai_operator | finance | content_manager | quality_officer | security_operator`.

It has **8 live call sites**, all API routes, all genuinely scoped — e.g.
`/api/platform/tenants/[id]/subscription → ["platform_operations","platform_super_admin","finance"]`,
`/api/platform/support/tickets → [… ,"support","customer_success"]`. It writes to
`plat_audit_events` via `landlordAudit()`.

⚠ **Three defects found, all live:**

1. **No CHECK constraint.** `platform_role` is a bare `text` column (mig 040 line 54). Any string is
   accepted. The 11-value vocabulary is a comment, and comments do not reject writes.
2. ⚠ **A vocabulary mismatch that nothing catches.** All 8 call sites pass **`platform_super_admin`**
   — a value that is **not in the documented 11**. With no constraint and no union check at the DB,
   it is a string nobody can hold, so it contributes nothing to any of the 8 gates. Whether that is a
   typo for `platform_owner` or a fourth spelling of the anchor, **nothing in the system can tell**.
3. ⚠ **`required.length === 0` defaults to reachable.** A route that calls `getLandlordCaller()`
   and forgets `landlordCan(...)` is reachable by **every** position holder. That is exactly the
   quiet-failure mode named below, and it is already the shape of the code.

Live usage: **46 of 47 profiles have `platform_role = null`; all 47 have an empty `platform_roles[]`;
one holds `content_manager`.** The tier exists and is essentially unused.

### (b) ⚠ `ogs_offices` + `ogs_office_appointments` — the POSITION model, already built, **0 rows**

This is the finding that matters most for HQ's shape. The Office Governance System already
implements HQ-ARCH-001 §6 "Position-Driven Provisioning" almost line for line:

| HQ-ARCH-001 §6 / §8 | Live |
|---|---|
| `position` — *"enduring organisational office/role"* | `ogs_offices` |
| `position_assignment` — *"person-to-position appointment with dates"* | `ogs_office_appointments` |
| *"Create or activate enterprise position"* | `ogs_activation_checklist`, `ogs_lifecycle_transitions` |
| `role_template` | `ogs_office_charters` |
| `approval_authority`, decisions, votes, e-sign | `ogs_decisions`, `ogs_votes`, `ogs_signatures` |
| `audit_event` | `ogs_meetings`, `ogs_office_actions`, + `plat_audit_events` |

And it is **already load-bearing**: `holdsOfficeAppointment(admin, key, hid, isSuper, userId)` gates
**CMO, QAW and HEX** today (`f514fcd`), with keys `competency`, `quality`, `executive` — *contexts*,
in HQ-ARCH-001's exact sense.

⚠ **Probed live: `ogs_offices` = 0 rows, `ogs_office_appointments` = 0 rows.** The position machinery
is built, wired into three workspaces, and **nobody has ever been appointed to anything.**

### (c) Practice-style membership + capability — the best *permission* model in the repo

`practice_membership` + `practice_role_assignment` gives per-membership, **time-bound**
(`effective_from`/`effective_to`), **source-attributed** (`role_default` / `explicit_grant` /
`delegation`) capability grants, with a partial unique index and a live vocabulary of **50 codes**
(probed — the memory index's "47" is stale). It satisfies IAM-CTX-001 §8's *"explicit, time-bound and
auditable"* delegation requirement **today**, for one product.

### (d) A new table — ❌ not recommended

⚠ It would make **three** entitlement engines. There are already two.

### THE RECOMMENDATION

**Compose (b) + (c). Keep (a) as the plane discriminator, not the hierarchy.**

```
super_admin (AppRole)        →  break-glass anchor. 1–2 accounts. UNCHANGED. RLS depends on it.
platform_role                →  WHICH PLANE you are on (landlord vs tenant). Not the hierarchy.
ogs_offices                  →  the POSITION      (CEO, Platform Council Member, CP Product Director…)
ogs_office_appointments      →  the APPOINTMENT   (person → position, with dates)
ogs_office_charters          →  the ROLE TEMPLATE (what the position may do)
<new> platform capability    →  the ENTITLEMENT   — copy practice_role_assignment's shape exactly
```

**What it takes to make it enforceable rather than a string comparison** — five concrete items:

1. ⚠ **A CHECK constraint on `platform_role`**, with the 11 documented values, and resolve
   `platform_super_admin` first (it is currently unconstrained and unheld).
2. ⚠ **A platform capability catalogue.** There is none — see §2.3.
3. **Close `landlordCan`'s empty-`required` branch** so a missing argument denies rather than admits.
4. **Seed `ogs_offices`** with the five positions the user named (CEO, Platform Council Member,
   Practice Product Director, Learning Product Director, Quality Council Member) — the table exists
   and is empty, so this is rows, not a migration.
5. **Resolve entitlements server-side per request**, the way `resolveWorkspaceContext` already does
   for Practice, so the answer is data and not a `.includes()` on a string in a layout.

## 2.3 ⚠ The platform side has NO capability catalogue — and PLAT-CAP-001 does not supply one

Confirmed against the live matrix (`src/lib/access/matrix.generated.json`, **321 entries generated
from the real gates**):

| Gate kind | Count |
|---|---|
| `role-list` (a list of role strings) | **199** |
| `auth-only` (signed in, no role test) | **85** |
| `single-role` (one role string) | **23** |
| `platform-role` (`landlordCan`) | **8** |
| `unknown` / `service` / `none` | 3 / 2 / 1 |

**222 of 321 gates are a string comparison against a role name. Zero non-practice routes gate on a
capability.** [SEC]'s finding stands, with the count corrected: the capability codes number **50**,
not 47, and every one is practice-scoped.

⚠ **Does PLAT-CAP-001 supply the model HQ needs? No.** Its §3 registry is a catalogue of
**product features** (`Booking`, `Encounters`, `Documents`, `Governance`) with `dependencies`,
`workspace_support`, `tenant_support`, `version` and a lifecycle. What HQ needs is a
**permission entitlement** (`governance.practice.roadmap.approve`) resolved per person per context.
PLAT-CAP-001 mentions `permission_template` as **one field** of a capability row and says nothing
about resolution, scoping, delegation or time bounds.

⚠ **And PLAT-CAP-001 is the same document family as the already-surveyed PCS-CAP-001** — see §3.3:
104 lines vs 114, 10 sections vs 17, a strict content subset except its §7 Composition Engine, and it
drops the activation lifecycle, the four editions, the activation scopes, the eight health signals
and the §7 dependency gate. **It is a lower-resolution re-issue, not a second specification.** Build
against PCS-CAP-001; take §7 from PLAT-CAP-001; and note that **neither of them contains HQ's
permission model.** That model has to be built, and the shape to copy is
`practice_role_assignment` — which exists, works, and is already time-bound and delegable.

## 2.4 ⚠ THE ASSERTION: proving each `/hq/*` route is reachable by exactly the intended positions

### The machinery already exists — and its granularity is the problem

`scripts/gen-access-matrix.ts` walks `src/app`, classifies the gate on every route with
`src/lib/access/scan.ts`, and writes `src/lib/access/matrix.generated.json`. **It is already
staleness-checked** by `scripts/umw-permissions-harness.ts` — its own header says *"a gate that
changes without the matrix being regenerated fails a test rather than silently showing a manager an
out-of-date picture of who can reach what."* It reads role groups from `api-auth.ts` rather than
restating them, *"so the two can never quietly disagree."*

**That is exactly the "asserted against the live catalogue rather than a hand-written list"
requirement — already built, and already relied upon by a live page
(`/unit-manager/administration/permissions`).**

⚠ **But `routeOf()` strips only `/(layout|route).tsx?$`, so the matrix is at LAYOUT and API
granularity, not page granularity.** Probed: **`/super-admin` has exactly ONE entry in the matrix**
(`kind: "single-role"`), standing for all **204** URL patterns. The matrix currently cannot express
"this position reaches this module and not that one", because it cannot see modules at all.

### What has to change — three things, all small

1. **Extend the walker to `page.tsx`.** Then `/super-admin` becomes 204 rows instead of 1, and the
   matrix can carry a position axis.
2. **Add a position axis to the entry shape.** Today an entry is
   `{path, kind, gate:{kind, roles[], appointment, evidence}}`. It already carries
   `appointment: boolean` (from `holdsOfficeAppointment`) — so the *hook for positions is already
   there*; it needs to become `appointment: string[]` (which office keys) rather than a boolean.
3. **Assert the matrix against an intent declaration** — a committed `POSITION_ROUTE_INTENT` map of
   position → allowed route prefixes. The harness proves: every `/hq/*` route's *scanned* gate is a
   subset of its *declared* intent, and every declared intent has at least one route.

### ⚠ The control that proves the matrix can say NO

Without this, the whole thing is decoration. Three controls, and all three are needed:

- **A negative fixture.** Assert that a specific position (e.g. `cp_product_director`) is proven
  **unable** to reach a specific route (`/hq/executive`). If the assertion cannot produce a `false`,
  it is not testing anything. This is the same break-test discipline `bfc73de9` used for retired
  handles (*"with retirement disabled, a second practitioner successfully claimed the first one's
  released handle"*).
- **A count control.** `hqEntries.length === <baseline>` — because a walker that silently reads
  nothing makes every subset assertion pass. This is `9i-control`'s exact lesson from the tenant
  migration (§1.2).
- **A gate-kind control.** Assert **zero** `/hq/*` entries classify as `auth-only` or `none`. Today
  85 routes application-wide are `auth-only`; not one of them may be under `/hq`.

### ⚠ WHAT HAPPENS WHEN A ROUTE IS ADDED AND NOBODY ADDS IT TO THE MATRIX

**This is the failure mode, and the current code already has it.** Two independent defaults must
both be flipped:

1. **In the harness: an unmatched route must FAIL, not pass.** The assertion must be *"every scanned
   `/hq/*` route appears in `POSITION_ROUTE_INTENT`"*, not *"every intent entry has a route"*. The
   first direction catches a new route; the second does not. **Both directions, or the new route is
   invisible.** (This is precisely the `9f` / `9i` pair in the practice harness: `9f` proves every
   nav entry has a page, and `9i` was written *afterwards* because nothing proved the other
   direction — and a whole workspace had shipped unreachable in the gap.)
2. ⚠ **In the code: the resolver must deny an unknown route.** `landlordCan`'s
   `required.length === 0 → platformRoles.length > 0` is **default-to-reachable today**. A new HQ
   route that resolves a caller and forgets to name its positions must return 403, not 200. This is
   a five-line change and it is the single most important line of code in the HQ programme.

**Defaulting to reachable is how this fails quietly, and both halves are currently set that way.**

## 2.5 The estate, counted

| Thing | Count | Source |
|---|---|---|
| `/super-admin` URL patterns | **204** | build manifest |
| Top-level modules | **31** | `ai, assessment-methods, assistant, assurance, audit, cgr, ckp, command-centre, competencies, content, delivery, enterprise, governance, hospitals, import, knowledge-graph, metadata, organisations, performance, platform-ops, policy-manager, priorities, quality-intelligence, reports, schedules, scoring, settings, studio, system, users, workflows` |
| `page.tsx` under `src/app/super-admin/` | **204** | walk |
| …with their own role check | **170 (83%)** | scan |
| …⚠ relying on the layout alone | **34 (17%)** | all 12 `ai/services/*`, most of `priorities/*`, and `assessment-methods`, `competencies`, `content`, `content/[frameworkId]`, `hospitals`, `import`, `organisations`, `policy-manager` |
| `/super-admin` literals in `src/` | **1,032** across **277** files | grep |
| …**outside** `src/app/super-admin/` | **68 files** | ⚠ the cross-estate links |
| Sidebar | `_components/WorkspaceSidebar.tsx` — 271 lines, **125 `href`s**, client component | read |

⚠ **The 34 layout-only pages are the immediate exposure**, and Next 16's own documentation says why.
`node_modules/next/dist/docs/01-app/02-guides/authentication.md` line 1446:

> *"A common pattern in SPAs is to `return null` in a layout or a top-level component if a user is
> not authorized. This pattern is **not recommended** since Next.js applications have multiple entry
> points, which will not prevent nested route segments and Server Actions from being accessed."*

and line 1350: *"…Layouts … don't re-render on navigation, meaning the user session won't be checked
on every route change."* The proxy is not the fix either —
`.../16-proxy.md` line 29: *"Proxy … should not be used as a full session management or authorization
solution."*

**So the gate must become a per-page call to one named function.** That refactor — 204 pages through
one `requireHqContext(position…)` — is the actual deliverable, and it is what makes §2.4's assertion
sound rather than textual.

## 2.6 Dead URLs and stored paths

Same property as §1.8 — a route rename does not degrade, it dies.

| Artefact | Risk |
|---|---|
| Staff bookmarks of `/super-admin/*` | 204 patterns; every holder is someone whose job is the platform |
| `loadHeaderContext(admin, id, { currentHref: "/super-admin" })` | hard-coded literal in the layout |
| `GlobalHeader workspaceHref="/super-admin"` | second literal, same file |
| `src/lib/workspace-links.ts` + dashboard | where the 68 out-of-tree references live |
| Stored absolute paths in rows | notifications (mig 161), `plat_audit_events`, approvals, `ppe_audit` payloads — **audit before renaming; a stored path is frozen** |
| ⚠ **`configuration_registry_objects.route`** | **a column that stores routes, 80 live rows** (3 `WORKSPACE`, 25 `MODULE`, 27 `NAVIGATION_SECTION`). **This is where a route rename becomes a DATA migration** — a find-and-replace over `src/` misses it entirely, and WCE-002's resolution engine keeps serving the old path |

## 2.7 ⚠ `hq` is NOT reserved today — a live gap, closing

PLAT-ROUTE-002 §9: *"A user cannot create practice handle 'gov' or another reserved word."* Probed
`practice_reserved_handle` (32 rows):

| Reserved today | Missing |
|---|---|
| `admin`, `api`, `system`, `support`, `help`, `login`, `security` (**7 of 10**) | ⚠ **`gov`, `docs`, `hq`** |

Against PLAT-ROUTE-002's full list of 21: 7 present, 14 absent — of which `sign-in` and `sign-out`
are unreachable anyway (the DB check `handle ~ '^[a-z][a-z0-9]{2,29}$'` forbids hyphens), leaving
**12 genuine one-word inserts**.

⚠ **Exploitable? Not yet — the window is open and closing.** **0 handles are claimed**, and
`claimHandle` shipped in `bfc73de9`. Nothing stops the first practitioner reaching the setup console
from claiming `hq`, `gov` or `docs` — and because `changeHandle` retires a released handle into
`practice_handle_history` **for ever**, a claimed `hq` can never be reclaimed, not by an admin and
not by a migration that respects the retirement rule.

**Twelve rows in a table that already exists, before the first claim. The cheapest,
most-irreversible-if-missed item in this survey, and it should not wait for any of the six documents.**

## 2.8 Ordering and efficiency

**Sequence, do not parallelise.** Both migrations touch routing, `proxy.ts` and the harnesses.

| | Tenant routing | HQ |
|---|---|---|
| Routes | 48 | 204 |
| Link sites | 681 | 1,032 |
| Failure mode | wrong practice rendered (correctness) | ⚠ **over-grant or owner lockout** (security, both directions) |
| Closes an existing defect? | ✅ the ambient-cookie defect (§1.5) | ✅ **standing full authority for every super-admin** |
| Blocked on a decision? | D1, D2 | the positions vocabulary (D10) |

**Recommended order: the 12 reserved words → tenant routing → HQ.** Tenant routing is a third the
size and proves the manifest-baseline and redirect-table machinery on the smaller migration first.

⚠ **But HQ's prerequisite work is independent of routing and should start immediately in parallel**,
because none of it touches a URL: `requireHqContext()` across 204 pages, the page-granularity matrix,
the CHECK constraint on `platform_role`, closing `landlordCan`'s empty-`required` branch, and seeding
`ogs_offices`. **All of that can land under the existing `/super-admin` path.** By the time the
rename happens, every page carries its own scoped guard and the layout is no longer the only thing
standing there — **so no window exists in which `/hq/*` is reachable ungated.**

**Efficiency, honestly, per layer:**

| Layer | Mechanical? |
|---|---|
| Directory move | ✅ `git mv src/app/super-admin src/app/hq` — one command, 204 routes, history preserved |
| The 1,032 literals | ✅ one find-and-replace; the string is distinctive enough to have no false positives (checked — every hit is a path). ⚠ Read the diff: two hits are the semantically-loaded `workspaceHref` / `currentHref` props |
| Redirect table | ✅ **generated from the committed manifest baseline**, 204 rules from one script — exhaustive by construction, not by review |
| Sidebar | ✅ 125 `href`s in one file, same replace |
| `configuration_registry_objects.route` | ⚠ **data migration**, 80 rows to audit |
| ❌ **`requireHqContext()` across 204 pages** | **by hand — the real work.** 34 have no guard to start from, and a guard inserted in the wrong place reads as present to a textual assertion while protecting nothing |
| ❌ Positions, capabilities, the intent matrix | by hand — this is the programme, not the rename |

**~90% of the rename is mechanical and 100% of the risk is in the other 10%.** The move, the replace
and the redirect table are an afternoon. The guard refactor, the positions model and the intent
matrix are the work.

---

# 3. What already exists — the 50–70% prior, tested

The prior holds. Roughly, by document: **PLAT-ROUTE-002 ~55%**, **PLAT-CONFIG-001 ~60%**,
**PLAT-CAP-001 ~25%** (and duplicative — see §4), **IAM-CTX-001 ~35%**, **HQ-ARCH-001 ~15%**,
**CP-ROUTE-001 ~40%** (identity, handles, history, reservation, resolution all built; only the
route shape is missing).

## 3.1 PLAT-ROUTE-002 reserved namespaces vs `practice_reserved_handle` (mig 218)

**Yes — the table already exists and already reserves a third of the list.** Probed live: 32 rows.

| PLAT-ROUTE-002 asks to reserve | Already reserved? |
|---|---|
| `admin`, `api`, `system`, `support`, `help`, `login`, `billing` | ✅ **7 of 21 already there** |
| `gov`, `docs`, `sign-in`, `sign-out`, `logout`, `auth`, `oauth`, `callback`, `status`, `health`, `webhooks`, `internal`, `staff`, `hq` | ❌ **14 missing** |

⚠ **But four of the fourteen can never be handles anyway**: `sign-in` and `sign-out` contain a
hyphen, which the shipped `check (handle ~ '^[a-z][a-z0-9]{2,29}$')` forbids at the database level.
So the genuine gap is **twelve one-word inserts into an existing table**, plus a note that `hq` and
`gov` matter only if HQ and `/practice/gov` are actually built.

The table also reserves 25 words PLAT-ROUTE-002 never thought of (`competen`, `competenpractice`,
`practice`, `root`, `security`, `legal`, `privacy`, `nurse`, `midwife`, `surgeon`, `pharmacist`,
`dentist`, `doctor`, `hospital`, `clinic`, `book`, `booking`, `search`, `signin`, `signup`,
`account`, `settings`, `info`, `contact`, `sales`) — impersonation and routing hazards the
specification misses. **The existing table is the better artefact.** Do not replace it; extend it.

PLAT-ROUTE-002 §4 "Resolution Precedence" (explicit product routes → reserved → handle → controlled
404/403, *"never silently fall through to tenant data"*) is **already how Next.js segment
precedence works** in this app, and `book/[handle]/page.tsx` already documents the reasoning at
length. The only unimplemented part is a server-side precedence check, which needs the
`middleware.ts` that does not exist.

## 3.2 PLAT-CONFIG-001 Product Registry vs WCE-002 (mig 092) + releases (mig 099)

**Substantially built, under two names.**

| PLAT-CONFIG-001 registry field | Exists as | Where |
|---|---|---|
| `product_id`, `product_code`, `display_name` | `plat_products(code, name, description, is_core, default_on, sort)` — **7 rows live** | mig 042 |
| `route_root` | `configuration_registry_objects.route` | mig 092 |
| `governance_enabled` | — | ❌ nothing |
| `tenant_model` | `plat_org_templates.spec.tenant_type` (7 templates) + `practice_workspace.type` | migs 042, 191 |
| `workspace_template` | `plat_workspaces(key, config, audience, …)` — **0 rows** | mig 053 |
| `governance_template` | — | ❌ nothing (OGS charters are adjacent, not templates) |
| `role_templates` | `plat_org_templates.spec` (roles/departments/frameworks/workspaces/branding) | mig 042 |
| `permission_template` | `configuration_registry_objects` `PERMISSION` object type | mig 092 |
| `feature_flags` | `plat_feature_flags` + `plat_feature_flag_assignments` — **6 flags, 0 assignments** | mig 042 |
| `status` (active/beta/retired) | `configuration_registry_objects.status` — **9 values**, richer | mig 092 |

`configuration_registry_objects` declares **32 object types** and **80 rows are live**, distributed:
`NAVIGATION_SECTION 27, MODULE 25, WIDGET 16, METRIC 6, WORKSPACE 3, PLATFORM 1, PRODUCT_SUITE 1,
DASHBOARD 1`. Its type list already includes `PLATFORM`, `PRODUCT_SUITE`, `WORKSPACE`,
`NAVIGATION_SECTION`, `MODULE`, `PAGE`, `VIEW`, `TEMPLATE`, `PERMISSION`, `FEATURE_FLAG`,
`AI_CAPABILITY`, `POLICY_CONTROL`. **PLAT-CONFIG-001's "Product Registry" is `object_type =
'PRODUCT_SUITE'` in a registry that already exists, is governed, versioned, released
(`configuration_releases`, 8 statuses, 5 channels, 4 rollout modes, checkpoint/rollback) and
audited.**

⚠ `configuration_releases` has **0 rows** and `plat_workspaces` has **0 rows** — the machinery is
built and unexercised. That is the real gap, and it is a seeding job, not a framework job.

**PLAT-CONFIG-001 §7 "Metadata-Driven Routing"** — *"Registering a product with route_root='practice'
automatically enables /practice and, where configured, /practice/gov without product-specific
routing code"* — is the **only genuinely new** thing in the document, and it is the largest single
claim in all six: it means a route table that Next.js's file-system router does not have. In a
Next.js App Router app this is a catch-all segment plus a resolver, i.e. exactly the greenfield
`middleware.ts`. **Do not accept "configuration, not code" at face value here.**

## 3.3 PLAT-CAP-001 vs `plat_feature_flags` / `plat_plans` / `plat_products` — and vs PCS-CAP-001

**⚠ PLAT-CAP-001 and PCS-CAP-001 are the same document family, and PLAT-CAP-001 is the weaker
member.** See §4 for the ID analysis. Substantively:

`docs/CNE-SURVEY-001.md` (2026-08-07) surveyed **PCS-CAP-001 "Platform Capability & Activation
Framework v1.0"** — 114 lines, 3,655 bytes, **17 numbered sections** — and found it *"~22% built …
a unification job not greenfield"*, with six parts existing under six names.

**PLAT-CAP-001 is 104 lines, 3,277 bytes, 10 sections.** It is *shorter and thinner*: it has the
registry table (13 fields vs PCS-CAP-001's 13 mandatory metadata fields — near-identical), the
categories, the composition model and a lifecycle, but it **drops** PCS-CAP-001's 8-state lifecycle
detail, the four editions (`Free/Professional/Premium/Enterprise`), the activation scopes, the eight
health signals, the §7 dependency-health gate, the Capability Manager UI and the §15 standard
template. Its §6 lifecycle is seven bullets where PCS-CAP-001 §4 is a state machine.

Field-by-field, PLAT-CAP-001 §3 ⊂ PCS-CAP-001 §5 with two additions (`workspace_support`,
`tenant_support`) and one loss (no activation state). **Verdict: PLAT-CAP-001 is a re-issue of
PCS-CAP-001 at lower resolution, plus a Composition Engine section (§7) that PCS-CAP-001 does not
have.** Build against PCS-CAP-001 and take only §7 from PLAT-CAP-001.

Live state, re-probed (**trust no count** — these are today's numbers):

| PLAT-CAP-001 asks for | Live | Rows |
|---|---|---|
| Capability registry table | ❌ **no `plat_capabilities` / `capability_registry` / `platform_capabilities` table exists** | — |
| `feature_flags` per capability | `plat_feature_flags` | **6** (`simulation_engine`, `executive_intelligence`, `ai_copilot`, `clinical_operations`, `marketplace`, `practice_offline_cache`) |
| flag scoping | `plat_feature_flag_assignments` (`global/tenant/country/plan/cohort`) | **0** ⚠ |
| Products as compositions | `plat_products` | **7** (`competency, mclip, lms, simulation, passport, coe, pce`) |
| Editions/plans | `plat_plans` with `entitlements` jsonb | **6** (`starter…unlimited`) |
| `configuration_schema` / metadata model | `configuration_registry_objects.dependencies` + schema fields | 80 |
| Dependency resolution | `configuration_registry_objects.dependencies` jsonb + release validation | built |
| Versioning | `configuration_version_snapshots`, `schema_version` | built |

⚠ **`plat_products` names seven products and not one of them is Competen Practice.** The seven are
the competency-platform estate. PLAT-CAP-001 §5's worked example is *"Competen Practice: Identity +
Calendar + Booking + Patient Registry + Encounters + Documents + Practice Intelligence +
Governance"* — a product that **is not in the product table it composes from.** That is the
cheapest, most useful single row anybody could insert, and it is a decision (§8, D5) because
`plat_products.code` is a primary key other tables reference.

`flagState()` still has **one live caller** — `src/app/api/v1/practice/offline/day/route.ts`
(`88eff7c1`), plus the control-plane UI and `scripts/platform-flag-gate-harness.ts`.
`practice_offline_cache` is now seeded (it was the unseeded key [CNE] flagged). `flagEnabled()` has
one further caller via `patient-access.ts`. **So the flag engine has two real gates, up from one.**

## 3.4 IAM-CTX-001 vs `profiles`' six role columns, `practice_membership`, `practice_role_assignment`

`profiles` (probed) has **26 columns**, of which **six are role-bearing**:
`role`, `roles`, `org_role`, `org_roles`, `platform_role`, `platform_roles` — plus `is_senior_assessor`,
`position_id`, `line_manager_id`, `account_status`. [SEC] already covers the singular/plural pairs.

IAM-CTX-001 §3 asks for `user`, `position`, `position_assignment`, `role_template`, `context`,
`entitlement`, `delegation`.

| IAM-CTX-001 object | Live |
|---|---|
| `user` | ✅ `profiles` (and `auth.users`) |
| `position` | ⚠ **`profiles.position_id` exists**; a `positions` surface exists at `/admin/positions`; **`ogs_offices` is the nearest real table** |
| `position_assignment` | ✅ **`ogs_office_appointments`** — and it is already load-bearing: `holdsOfficeAppointment(admin, key, hid, isSuper, userId)` gates CMO, QAW and HEX (`f514fcd`) |
| `role_template` | ⚠ partial — `plat_org_templates.spec` |
| `context` | ❌ nothing named a context; workspaces are the de-facto contexts |
| `entitlement` | ✅ **`practice_role_assignment.capability_code`** (per-membership, `role_default`/`explicit_grant`/`delegation`, `effective_from`/`effective_to`) — **this is the best entitlement model in the repo** |
| `delegation` | ✅ `practice_role_assignment.source = 'delegation'` + `src/lib/practice/delegation.ts`; and `ogs_*` at the office layer |

⚠ **`practice_role_assignment` already implements time-bound, source-attributed, revocable
entitlements — exactly IAM-CTX-001 §8's "explicit, time-bound and auditable" delegation** — but
scoped to Practice only. `ogs_office_appointments` implements the same idea for offices. **The
platform has two entitlement engines and IAM-CTX-001 is asking for a third.** The honest build is
to generalise one, not add one.

Not built anywhere: MFA for staff, step-up authentication, context-scoped AI (§7 — *"prior product
data must not leak into the next context"*), one-SSO-session-many-contexts.

## 3.5 HQ-ARCH-001 vs any existing `/hq`

**There is no `/hq` route. There is no `/executive`. There is no `/platform/gov` and no
`/practice/gov`.** Probed: `find src/app -type d -name hq|gov|executive` returns only
`src/app/admin/executive`, `src/app/educator/ai/executive`, `src/app/super-admin/cgr/executive` —
three unrelated pages.

`src/app/super-admin/` has **38 entries (≈34 module sections)**. `src/app/platform/`,
`src/app/platform-admin/`, `src/app/enterprise-governance/` and `src/app/office-governance/` also
exist. So four of HQ-ARCH-001's six entry points are unbuilt and the other two are the public site.

**Is HQ a new product or a renaming of `/super-admin`?** See §9.3.

## 3.6 CP-ROUTE-001 vs what is built

| CP-ROUTE-001 §5 handle rule | Live |
|---|---|
| Lowercase letters, digits **and hyphens** | ⚠ **letters and digits only** — `^[a-z][a-z0-9]{2,29}$` — conflict (§1.7) |
| Globally unique in `/practice` | ✅ `unique` column + unique index; the claim is atomic and race-tested |
| Suggested during onboarding, editable before publication | ✅ `identitySetupView` + suggestion list (`HANDLE_RE.test` filtered) |
| Published handles are stable identifiers | ✅ `HANDLE_PERMANENCE_NOTICE` |
| Handle change creates **redirect aliases and audit records** | ✅ **`practice_handle_history`** — returns `{kind:"redirect", to}` and permanently retires the old name |
| Reserved namespaces cannot be selected | ✅ `practice_reserved_handle`, and a failed read **refuses** the claim rather than allowing it |
| §7 route resolution: reserved → handle → immutable id → membership → context | ⚠ steps 5–7 built (`resolveWorkspaceContext`); steps 1–4 need `middleware.ts` |
| §6 locations are children, not tenants | ✅ `practice_location`, 4 rows live, with `facility_id`/`travel_buffer_minutes` |
| §4 identity object as one table | ❌ split across `practice_practitioner_identity` + `practice_workspace`; 3 of 8 fields homeless |

---

# 4. Dependency order, from the documents' own text

The documents state their dependencies only implicitly, so this is derived from what each one
*requires to exist* before its own acceptance criteria can be met.

```
PLAT-CONFIG-001  (product registry: route_root, tenant_model, governance_enabled)
        │  §7 routing is generated from product metadata
        ├────────────────► PLAT-ROUTE-002  (reserved namespaces, resolution precedence)
        │                          │  §2 defines what /practice/{segment} may mean
        │                          └────────► CP-ROUTE-001  (handle occupies that segment)
        │
        └────────────────► PLAT-CAP-001  (capabilities compose into registered products)
                                   │  §7 Composition Engine "reads the Product Registry"
                                   ▼
                          IAM-CTX-001  (contexts + entitlements per product)
                                   │  §4 "HQ home displays allowed contexts"
                                   ▼
                          HQ-ARCH-001  (the shell those contexts are switched inside)
```

Evidence for each edge:
- **PLAT-CAP-001 → PLAT-CONFIG-001**: §7 *"The Composition Engine reads the Product Registry,
  Capability Registry and configuration metadata"*. It cannot run without the product registry.
- **PLAT-ROUTE-002 → PLAT-CONFIG-001**: PLAT-CONFIG-001 §3 `governance_enabled` — *"Creates /gov
  workspace"* — is the flag PLAT-ROUTE-002's whole §6 route family depends on.
- **CP-ROUTE-001 → PLAT-ROUTE-002**: CP-ROUTE-001 §7 step 3 — *"If second segment is a reserved
  product route, invoke product-owner route handler"* — and §5 *"Reserved namespaces cannot be
  selected as handles"*. CP-ROUTE-001 cannot resolve a segment without the reserved list.
- **HQ-ARCH-001 → IAM-CTX-001**: HQ-ARCH-001 §4 *"shows only contexts the authenticated user is
  authorised to access"*; the resolver is IAM-CTX-001 §4. HQ-ARCH-001 §10 phase 3 is literally
  *"Build role resolver and context switcher"*.
- **IAM-CTX-001 ↔ HQ-ARCH-001 are near-duplicates.** HQ-ARCH-001 §8's eight data objects and
  IAM-CTX-001 §3's seven overlap in six (`position`, `position_assignment`, `role_template`,
  `context`/`governance_context`, `delegation`, `user`/`enterprise_user`). Both define a context
  switcher (HQ §7, IAM §5). **Read them as one specification in two files.**

⚠ **The stated order is the opposite of the achievable order.** Nothing in PLAT-CONFIG-001 or
PLAT-CAP-001 is reachable today because both are unexercised registries needing seed rows; whereas
PLAT-ROUTE-002's reserved words are twelve inserts into a live table. **Build order should be
value-first, not dependency-first**: PLAT-ROUTE-002 reservations → CP-ROUTE-001 handle claiming
(fixes the live booking defect) → PLAT-CONFIG-001 product row for Practice → the rest.

---

# 5. ⚠ Document-ID collisions

Checked every ID against `docs/` and the whole repo (`grep -rhoE` over `docs/ src/ scripts/ supabase/`).

| ID | Status |
|---|---|
| **`PLAT-CAP-001`** | ⚠ **Content collision with `PCS-CAP-001`.** Different prefix, same subject, **same document family**. `PCS-CAP-001 "Platform Capability & Activation Framework v1.0"` was surveyed 2026-08-07 (`docs/CNE-SURVEY-001.md`), 17 sections; `PLAT-CAP-001 "Platform Capability Registry & Composition Framework"` is 10 sections and a strict content subset except its §7. **They are not two specifications; they are two drafts of one.** [CNE] §1.1 also notes *"the `PCS-*` series is one the codebase already recognises"* — so `PCS-` has precedent and `PLAT-` does not. |
| **`PLAT-ROUTE-002`** | ⚠ **`PLAT-ROUTE-001` does not exist anywhere** — not in `docs/`, not in `src/`, not in `scripts/`, not in `supabase/`. In fact **no `PLAT-*-nnn` ID appears anywhere in the repo at all**; `PLAT-CAP-001`, `PLAT-CONFIG-001` and `PLAT-ROUTE-002` are the first three. The `-002` implies a `-001` that has never been written or has been written under another prefix (most likely candidate by subject: `CPR-IAM-001 §1/§6`, which is what actually settled `/practice` as the route namespace — see `docs/CPR-BUILD-000-product-setup-plan.md` §1). **Ask for PLAT-ROUTE-001 before building against -002.** |
| **`COMP-SEC-001`** | ⚠ **Confirmed already two documents**, as the brief says. Surveyed in `docs/COMP-SECURITY-SURVEY-001.md` (10 references), where it is *"Competen Platform Security Framework"* and judged *"⚠ Mostly prose … Do not schedule it as a build."* Unrelated to this six. No new collision introduced here. |
| **`IAM-CTX-001`** | ⚠ **Third IAM document.** `IAM-000` (platform architecture standard, [ENT] §5 — *"no product shall implement its own authentication or authorization stack"*) and `CPR-IAM-001` / `IAM-001` (Practice identity, URLs, routing — the spec that set `/practice` and `IAM-ADR-04 "roles are derived from memberships"`) both already exist and are both cited in shipped code and docs. `IAM-CTX-001` is a **fourth-generation** name in a family that already has an umbrella (`IAM-000`) and a product instance (`CPR-IAM-001`). ⚠ **`IAM-000` explicitly forbids per-product auth stacks — and `IAM-CTX-001` proposes a staff identity model distinct from the existing one.** Reconcile before building. |
| **`HQ-ARCH-001`** | ✅ **No collision.** No `HQ-*` ID exists in the repo. New family. |
| **`CP-ROUTE-001`** | ✅ **No ID collision** — `CP-` is an established prefix (`CP-DATA-001`, `CP-OFF-001`, `CP-SYNC-001`, `CP-XXX-001`, all in `docs/CP-OFFLINE-SURVEY-001.md`). ⚠ **But a content collision with `PIS-000` (Frozen) and `CPB-002`**, both of which are cited by name inside shipped code (`identity-service.ts` cites `PIS-000 s5/s8/s10/s11/s12/s14`, `CPB-002` s3/s7/s8). CP-ROUTE-001 §4/§5 restates PIS-000's handle rules **with one changed rule** (hyphens, §1.7). Restating a *frozen* spec with a silent change is the dangerous kind of duplication. |
| **`PLAT-CONFIG-001`** | ⚠ **Content collision with `WCE-001`/`WCE-002`** (mig 076, mig 092), the shipped Workspace Configuration Engine and Platform Configuration Registry, which already do most of §3, §4, §8 and §9. No ID clash; substantial overlap. |

**Net: four of six IDs have a collision of some kind, and two of them (`PLAT-CAP-001`,
`CP-ROUTE-001`) restate an existing document with a changed rule.**

---

# 6. Capability codes — probed live, not counted from a document

`practice_role_assignment` holds **120 rows** across **4 memberships**.

**Distinct `capability_code` values: 50.** (The memory index says "47 codes"; **the live number is
50** — `practice_calendar.view` did not exist when that was written, and three more were added since.
Trust 50 as of this probe, and re-probe before relying on it.)

```
access.review          appointment.manage     comm.record            data.export
diagnosis.record       document.author        document.sign          document.view
encounter.create       encounter.edit         encounter.list         encounter.sign
followup.manage        followup.view          inbox.record           inbox.review
medication.override    medication.record      medication.view        message.use
pack.install           parameter.configure    parameter.record       parameter.view
pathway.assign         pathway.design         pathway.view           patient.create
patient.edit           patient.list           patient.merge          patient.view
practice.archive       practice.calendar.view practice.home.view     practice.lifecycle.view
practice.locations.manage                     practice.members.manage
practice.restore       practice.settings.manage                      practice.suspend
procedure.manage       procedure.record       queue.manage           report.view
search.use             task.manage            task.view              template.manage
treatment.record
```

Five role codes (`practice_membership.role_code` check constraint): `practice_owner`,
`practitioner`, `practice_assistant`, `billing_reporting`, `read_only_auditor`. Live memberships use
two of the five (`practice_owner` ×2, `practitioner` ×2).

⚠ **These 50 are the platform's only working capability model, and PLAT-CAP-001 does not mention
them.** PLAT-CAP-001's "capabilities" are *product features* (`Booking`, `Encounters`, `Documents`);
`practice_role_assignment`'s are *permissions* (`document.sign`). **The word "capability" means two
different things in this repo already, and PLAT-CAP-001 makes it three.** Naming decision, §8 D4.

`configuration_registry_objects` also has an `AI_CAPABILITY` object type — a fourth sense.

---

# 7. Is any of this reachable without the routing change?

**Yes. All of it. The routing change is orthogonal to five of the six documents.**

| Document | Needs the routing change? |
|---|---|
| PLAT-CAP-001 capability registry | **No.** A registry table + composition resolver. Nothing about it is addressed by URL. |
| PLAT-CONFIG-001 product registry | **No** for §3–§6 and §8–§9 (registry, templates, inheritance — mostly built). ⚠ **Yes** for §7 metadata-driven routing, which is the same greenfield `middleware.ts` the handle needs. |
| IAM-CTX-001 context switching | **No.** Contexts can be switched by state, exactly as `/practice/select-workspace` switches workspace today. Putting the context in the URL is a nicety. |
| HQ-ARCH-001 | **No.** `/hq` is a new static route tree; it does not interact with `/practice/{segment}`. |
| PLAT-ROUTE-002 reservations | **No.** Twelve inserts. |
| CP-ROUTE-001 | **Yes** — it *is* the routing change. |

⚠ **But they share one dependency: there is no `middleware.ts` in this repo at all.** Both
CP-ROUTE-001 §7 and PLAT-CONFIG-001 §7 need it. Build it once, for the handle, and PLAT-CONFIG-001
§7 inherits it. That is the only real coupling.

**Recommended: do the capability registry and reserved-namespace work first.** They are cheap,
they are unblocked, and they carry no migration risk — while the routing change is a
908-page-app-wide move that should not be the first thing attempted.

---

# 8. What needs a user decision before any code

| # | Decision | Why it cannot be inferred |
|---|---|---|
| **D1** | ⚠ **Hyphens in handles: yes or no?** CP-ROUTE-001 §5 and every example say yes (`dr-eokaisu`); the shipped DB constraint and `HANDLE_RE` say no, and `CPB-002`'s own spec uses `@dreokaisu`. | Changing it later re-points `normaliseHandle` and changes what an already-claimed handle means. It is a one-line change *now* and a data migration *later*. |
| **D2** | ⚠ **Can one person hold two practices?** `practice_membership` permits it, `select-workspace` and the 409 exist for it, but CP-ROUTE-001 §6 assumes one practice per practitioner. | This decides whether the path segment is a *person* handle or a *practice* slug — i.e. whether a two-membership practitioner gets an ambiguous URL or the chooser (§1.4). |
| **D3** | **Canonical casing of the number segment** — `CP-000123-4` or `cp-000123-4`? | Without one canonical form plus a 301, every tenant has two addresses and every log, analytic and audit line splits in half (§1.3). |
| **D4** | **What does "capability" mean?** It now has four senses: permission code (50 live), product feature (PLAT-CAP-001), `AI_CAPABILITY` registry object, `plat_feature_flags` key. | Every permission check in the app reads the first sense. A registry that uses the word for the second sense will be read as the first by the next person. |
| **D5** | **Is Competen Practice a row in `plat_products`?** It is not one today; the seven rows are the competency estate. | `plat_products.code` is a primary key referenced by `plat_feature_flags.product_code`. Adding it retro-fits Practice into the platform control plane; not adding it keeps two parallel worlds. |
| **D6** | ⚠ **RESOLVED by the user: HQ is the Competen Governance platform over the `/super-admin` estate, with graduated positions and 1–2 owner accounts.** The open part is §2.2's recommendation — compose `ogs_offices` + a new platform capability table, keep `platform_role` as the plane discriminator, keep `super_admin` as the break-glass anchor. | Decides which of three existing entitlement models HQ uses, rather than becoming a fourth. |
| **D7** | **Does `PLAT-ROUTE-001` exist?** | `-002` cites a precedence model that a `-001` would define. |
| **D8** | **`PLAT-CAP-001` or `PCS-CAP-001`?** One must be retired. | Two specifications for one registry produces two registries. |
| **D9** | **Staff MFA** (HQ §9, IAM §9, ROUTE-002 §8 all require it). Not built. | Infrastructure and policy, not a feature. ⚠ CPR-370/mig 213 already shipped an MFA policy with no enrolment path behind it — do not repeat that under HQ, where the locked-out party is the owner. |
| **D10** | ⚠ **The HQ position vocabulary.** The user named five (CEO, Platform Council Member, Practice Product Director, Learning Product Director, Quality Council Member); mig 040's column comment names eleven `platform_role` values; the code passes a twelfth (`platform_super_admin`) that is in neither. **Three vocabularies, no CHECK constraint.** | `ogs_offices` is empty, so this is seed data today and a migration once anybody is appointed. Nothing can enforce a vocabulary nobody has written down. |
| **D11** | ⚠ **Is `platform_super_admin` a fourth spelling of the anchor, or a typo for `platform_owner`?** All 8 `landlordCan` call sites pass it; the documented vocabulary omits it; no constraint rejects it; nobody holds it. | Until answered, 8 live gates contain a string that contributes nothing, and no test can tell whether that is intended. |

---

# 9. Build vs mapping document, and the direct questions

## 9.1 Genuine build vs mapping document

| Document | Verdict |
|---|---|
| **CP-ROUTE-001** | ⚠ **Genuine build, and the largest and riskiest of the six.** But ~40% exists (identity, handles, history, reservation, atomic claim, location model, context resolution). What is new is the *route shape* + `middleware.ts`. Its §4 identity object is a **mapping** onto two existing tables. |
| **PLAT-ROUTE-002** | ⚠ **Mostly a mapping document, with one small genuine build.** The reserved list is 12 inserts. `/practice/gov` (§5, §6 — ten routes) is a genuine build **but is really HQ-ARCH-001's `/practice/gov` context** — build it once, under whichever document wins. |
| **PLAT-CONFIG-001** | ⚠ **Mapping document over WCE-001/WCE-002**, except §7. It has **no version, no status line and no author**. Adopt it as the charter for the registry that already exists; schedule only §7 and `governance_enabled`. |
| **PLAT-CAP-001** | ⚠ **Neither — it is a duplicate.** Retire it in favour of `PCS-CAP-001`, keep §7 (Composition Engine), and build **the unification [CNE] already scoped** (`plat_feature_flags` + WCE-002 + releases + dependencies + `plat_plans` + the CGR-028 readiness gate). |
| **IAM-CTX-001** | **Genuine build (~35% exists), but half of it is HQ-ARCH-001.** Merge them. The entitlement half is largely built twice already (`practice_role_assignment`, `ogs_office_appointments`) and wants generalising, not rebuilding. |
| **HQ-ARCH-001** | ⚠ **The most genuine build of the six — and the least specified.** 113 lines for an entire internal enterprise environment with MFA, step-up auth, positions, delegations, approval thresholds, an immutable audit log and a cross-product portfolio. **Do not schedule this from this document.** It needs a real specification first. |

## 9.2 ⚠ What a half-built version destroys

**Routing** — the seven consequences in §1.6, of which the sharpest is #1: **during a partial
migration a stale tab renders another practice's patients under the old URL**, because the path is
authoritative for some pages and the cookie for others. In a clinical product that is not a broken
link, it is a wrong record.

**Capability registry** — a partial one leaves permission checks reading from two places. Concretely:
`hasCapability(ctx, "document.sign")` reads `practice_role_assignment`; a new capability registry
would hold `Documents` as an enabled product capability. **Revoking one does not revoke the other.**
A capability disabled at product level while `document.sign` is still granted means the button is
hidden and the API still signs — [SEC]'s exact bug class, and `api-context.ts` was written to
prevent it (*"API enforcement must not rely on the sidebar having hidden a button"*). ⚠ **If a
capability registry ships, `requirePracticeContext` must consult it in the same call as
`hasCapability`, or not at all.**

**Product registry** — half-seeded means `flagState()` returns `unresolved` for real flags. The
engine is honest about that (it withholds and says so, `no_such_flag`), so the failure is visible
rather than silent — but a feature that withholds is still a feature that does not work.

**Reserved namespaces** — a partial list is the worst kind, because it *looks* enforced. If `gov`
is added but `hq` is not, `/practice/hq` becomes claimable and then permanently un-reclaimable
(`practice_handle_history` retires names for ever). ⚠ **Reserve the full list before any handle is
claimed** — with 0 handles claimed today, this window is open and free, and it closes the moment
the first practitioner claims one.

## 9.3 Is HQ a new product or a renaming of `/super-admin`? — ANSWERED, and it is neither

**The user settled it: HQ is the Competen Governance platform, over the `/super-admin` estate, with
graduated positions and one or two owner accounts.** Not a second estate, and not a pure rename.

HQ-ARCH-001 §4 agrees, in its own words:

> *"The HQ home is role-aware and shows only contexts the authenticated user is authorised to
> access. **It is not a generic super-admin page.**"*

That sentence is the document knowing `/super-admin` exists and refusing to be it — and the reason is
exactly the user's: role-aware, showing only what you are authorised to see. The current estate is
the opposite: **one binary test in front of 204 patterns.**

⚠ **So the substance is the positions model, not the URL.** The rename is the cheap 90% (§2.8); the
governance layer is the product. §2 covers it in full.

**Three of HQ-ARCH-001's six routes are relocations of live estate**: `/executive` ≈
`/hospital-executive` + `/super-admin/cgr/executive`; `/platform/gov` ≈ `/super-admin/governance` +
`/enterprise-governance`; `/hq/operations` ≈ `/super-admin/platform-ops`. **Link into those rather
than moving them** — HQ-ARCH-001 §10 phases 1–3 are all achievable that way, and phase 4 ("Connect
/executive, /platform/gov and /practice/gov") becomes *link*, not *relocate*.

And the position machinery already exists: `ogs_offices` + `ogs_office_appointments` +
`holdsOfficeAppointment()` already gate CMO, QAW and HEX (`f514fcd`) on context keys
(`competency`, `quality`, `executive`) — HQ-ARCH-001 §6 "Position-Driven Provisioning", already
implemented for three workspaces. ⚠ **Both tables hold zero rows.**

---

# 10. Recommended sequence

**Two route migrations and one governance programme. Sequence the routing; run the programme beside it.**

1. ⚠ **Reserve the missing 12 words in `practice_reserved_handle` — including `hq`, `gov`, `docs` —
   this week, while zero handles are claimed** (§2.7). Rows in a table that already exists, gating
   nothing. The cheapest and most irreversible-if-missed item in the survey.
2. **Commit both manifest baselines** from today's `HEAD`: the 64 `/practice` patterns and the 204
   `/super-admin` patterns with their gate map (§1.7, §2.4). After either migration there is nothing
   left to compare against — the entire exhaustiveness argument rests on this and it is 30 seconds.
3. **Fix the live defect**: get handles claimed so `/practice/book/@handle` resolves for somebody
   (§1.9). Independent of routing, because the tenant segment falls back to the number.
4. **Settle D1, D2, D3, D10, D11.** No routing or positions code before these.
5. ⚠ **Start HQ's guard work now, under the existing `/super-admin` path** — none of it touches a
   URL: `requireHqContext()` across 204 pages, page-granularity in `gen-access-matrix.ts`, a CHECK
   constraint on `platform_role`, closing `landlordCan`'s empty-`required` branch, seeding
   `ogs_offices`. **This is the long pole and it is unblocked today.**
6. **Tenant routing**: context resolution first (path-authoritative, cookie-derived, no pages move,
   94 assertions green), then the 48 shell pages in one commit leaving 48 redirectors, with
   `9i-control` untouched (§1.2, §1.10).
7. **Then the HQ rename** — by which time every page carries its own scoped guard, so no window
   exists in which `/hq/*` is reachable ungated (§2.8). Ship the position matrix in **OBSERVE before
   ENFORCE**, the idiom `755c76b8` already established.
8. In parallel and independent of all routing: the **PCS-CAP-001 unification** ([CNE] scoped it), the
   `plat_products` row for Practice (D5), and the `configuration_registry_objects.route` audit (§2.6).
9. ⚠ **Do not schedule HQ-ARCH-001 or IAM-CTX-001 as builds from these documents** — 113 and 59 lines
   for an internal enterprise environment with MFA, step-up auth, delegations, approval thresholds
   and an immutable audit log. Ask for real specifications, reconcile them against `IAM-000` and
   `CPR-IAM-001`, and ask for **`IAM-001A`, which is not in `docs/`, not in the repo and not in
   `~/Downloads`** — so nothing in this report could be checked against it.
