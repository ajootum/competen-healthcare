# COMP-ACCESS-URL-001 — hostname inventory and canonical registry

**Spec:** COMP-ACCESS-URL-001, *Competen Domain, Product Gateway & Access Routing*.
**This document covers §13 steps 1 and 2 only.** Steps 3–11 are listed at the end with their owners.
**Measured:** 2026-08-24. Every figure below came from a command run on that date, not from recall.

---

## 1. What was actually built here

| Spec item | State |
|---|---|
| §13 step 1 — inventory of hostname references | **Done** — this document |
| §13 step 2 — canonical hostname registry in one shared configuration source | **Done** — `src/lib/identity/domains.ts` |
| §8 — regression check so the deprecated recruitment host cannot re-enter | **Done** — `scripts/domain-registry-harness.ts` 5g |
| §12 "Regression" — no independent Enterprise-module login domain | **Done** — same harness, 6c |
| §9 — DNS, TLS, deployment mapping, auth callback allowlists | **Not done. Owner action.** See §6 below |

`scripts/domain-registry-harness.ts` — 45/45, registered in `scripts/ci-harnesses.ts`, six controls
break-tested (plant, red, restore by `sha256sum -c`).

**What this work does not do:** it does not make a single hostname resolve. That is the honest headline
and it is stated in the registry and the harness as well as here.

---

## 2. DNS and TLS as measured

`curl -s -o /dev/null -m 12 -w "%{http_code}" https://<host>/`, 2026-08-24T12:21Z.

| Hostname | Result |
|---|---|
| `www.competenhealthcare.com` | **HTTP 200** |
| `competenhealthcare.com` (apex) | **HTTP 200** |
| `practice.competenhealthcare.com` | does not resolve (curl rc=6) |
| `enterprise.competenhealthcare.com` | does not resolve |
| `individual.competenhealthcare.com` | does not resolve |
| `recruitment.competenhealthcare.com` | does not resolve |
| `staff.competenhealthcare.com` | does not resolve |
| `platform.competenhealthcare.com` | does not resolve |
| `recruit.competenhealthcare.com` (deprecated) | does not resolve |

Two of the seven canonical names answer. §12's first acceptance row — "All canonical production
hostnames resolve over TLS to the intended gateway" — fails at DNS and cannot be closed from this repo.

**One consequence worth stating plainly:** `staff.competenhealthcare.com` has had a working resolver in
code since COMP-HQ-ACCESS-001 (`src/lib/identity/staff-host.ts`), and that resolver has never once run
in production, because the host has never resolved. Written machinery is not a live gateway.

---

## 3. Hostname references before this work

Scanned `src/`, `scripts/`, `docs/`, `supabase/`, `next.config.ts`. The stale worktree copy under
`.claude/worktrees/` was excluded — it is a duplicate tree, not this codebase.

### 3.1 Executable — code that compares against or emits a hostname

Three files. That was the entire executable surface.

| File | Value | Now |
|---|---|---|
| `src/lib/identity/staff-host.ts:34` | `STAFF_HOSTS = ["staff.competenhealthcare.com", "staff.localhost"]` | **Derived from the registry.** Values unchanged |
| `src/lib/marketing/site.ts:25` | `SITE_URL` default `https://www.competenhealthcare.com` | Allowlisted, unchanged — see §5.2 |
| `src/lib/practice/identity-service.ts:122` | `identityHost()` default `https://competenhealthcare.com` | Allowlisted, unchanged — see §5.1 |

`STAFF_DOOR_PATH` and `normaliseHost` also moved: the door path is now derived from the registry's
`staff.route`, and `normaliseHost` moved down into `domains.ts` (re-exported from `staff-host.ts`, so
every existing import still works) because the registry and the staff door must normalise a Host header
the same way or they can disagree about the same request.

### 3.2 Prose — comments and documentation, no behaviour

~30 references across 9 source files and 8 docs. Left as they are; they are history and reasoning, and
several record *why* an address was chosen. Two are worth knowing about because they describe the past,
not the present:

- `src/app/practice/book/[handle]/page.tsx:13` records that PIS-000 §8 originally named
  `practice.competenhealthcare.com/@handle` and that the address moved to the apex path form.
- `src/lib/practice/identity-service.ts:108` lists all three candidate booking addresses that were in
  play before the decision.

### 3.3 Not hostnames at all

`competenhealthcare@gmail.com` (`patient-access-constants.ts:237`, the booking fallback address) and
`hello@competenhealthcare.com` (`login/page.tsx:261`). A naive `competenhealthcare\.com` ban fires on
both. The containment scan in §8 of the harness excludes an `@`-prefixed match for exactly this reason,
and assertion 8d proves the exclusion works.

### 3.4 Environment variables that carry a hostname

| Variable | Consumer | Default if unset |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `marketing/site.ts`, `practice/subscription-gateway.ts` | `https://www.competenhealthcare.com` |
| `NEXT_PUBLIC_PRACTICE_IDENTITY_HOST` | `practice/identity-service.ts` | `https://competenhealthcare.com` |
| `TEST_BASE` | four ad-hoc `.mjs` scripts | **production** — see §5.3 |

There is no `.env.example` in the repo, so the deployed values are visible only in the Vercel project.

### 3.5 Routes present on the main domain (§2)

`/practice` `/enterprise` `/individual` `/recruitment` `/staff` `/platform` — all present.
`/super-admin` present. **`/hq` absent** — see §4.1.

---

## 4. Two conflicts, recorded rather than resolved

Both are decisions for whoever owns both documents. Neither was settled by picking the more convenient
reading, and the harness pins the current answer so that changing it is deliberate.

### 4.1 §2 names `/hq`; the application serves `/staff`

COMP-HQ-ACCESS-001 §5 froze `STAFF_DOOR_PATH = "/staff"` and built `staff-host.ts` around it. There is
no `/hq` route and never has been. Adopting §2's name would mean **building a second entrance to a
privileged plane**, which is a security decision, not a rename.

The registry records `/staff` with the disagreement written next to it. Harness 2b asserts every route
the registry names is actually served, 2c asserts the staff route is `/staff`, and 2d asserts `/hq` does
not exist. Break-tested: changing the registry to `/hq` turns 2b, 2c and 2e red.

> **RULED — this conflict is closed.** The owner decided on 2026-08-17 to mount the HQ behaviours on
> the existing `/super-admin` estate rather than build a parallel `/hq/*` family, with `/hq` paths as
> later aliases if ever wanted. The decision had been in force since then and shaped the rest of the HQ
> arc, but the rationale had never been written down — enforced in four places in the code, recorded in
> none. It is now **[ADR-014](./adr/ADR-014-hq-mounts-on-super-admin.md)**, which supersedes
> COMP-ACCESS-URL-001 §2's `/hq` row by name. `/staff` is the Staff/HQ gateway's main-domain route
> equivalent, and a future `/hq` would be a rewrite onto the existing estate, never a second route tree.

### 4.2 §1 lists `practice.competenhealthcare.com`; the booking address is the apex

§4's last bullet carves this out itself: *"Public patient/self-booking URLs remain governed by the
Practice handle/booking-address architecture and must not be conflated with practitioner
authentication."* The booking address is `https://competenhealthcare.com/practice/book/@handle`, chosen
after three candidates were in play.

**That string is printed on cards and posters.** Repointing it because the registry lists a `practice.`
host would break every card already in a patient's hand, and a patient holding a dead link has no other
way to reach their practitioner. The apex is therefore registered as a **non-gateway** with the reason
attached. Harness 7b/7c pin the default; break-tested by repointing it, which turns both red.

---

## 5. Findings the inventory turned up

### 5.1 The deprecated recruitment host was never published

`recruit.competenhealthcare.com` does not resolve and appears nowhere in the repository. §8's "if
already exposed, implement a permanent redirect" therefore has **no work in it** — there is nothing
published to redirect. What §8 asks for that was genuinely missing is the regression check, which now
exists. If the name is ever provisioned by mistake, the redirect becomes real work again.

### 5.2 §3's Enterprise-module rule held by never having been violated

No `workforce.` / `assessment.` / `learning.` / `quality.` hostname appears anywhere. That was true
before this work and nothing enforced it. Harness 6c enforces it now.

### 5.3 Four ad-hoc test scripts default to production

`scripts/coe-test.mjs`, `coe-shift-test.mjs`, `interaction-test.mjs`, `workforce-test.mjs` each read
`.env.local` and set `const BASE = process.env.TEST_BASE || "https://competenhealthcare.com"`.

§9 requires explicit production/staging/local separation and says a staging hostname must not route
production traffic or the reverse. A test script that reaches for production when a variable is unset is
one automated invocation away from being that. **Nothing invokes them today** — they appear in neither
`ci-harnesses.ts` nor `package.json` — and harness assertion 8f is what keeps that true. They are
allowlisted individually rather than exempted as a class, so a fifth one fails the harness and somebody
has to look.

This is recorded as an open item, not fixed: rewriting four throwaway scripts is not what §13 step 2 is
for, and the owner may prefer to delete them.

### 5.4 Auth callbacks are origin-relative, which helps and creates one dependency

Every callback in the codebase composes from the request origin — `req.nextUrl.origin`,
`window.location.origin` (`api/auth/oauth/[provider]/route.ts`, `forgot-password/page.tsx`,
`api/super-admin/users/route.ts`). Nothing hardcodes a callback hostname.

That means a reset link generated on a product gateway returns to **that** gateway with no code change
— §12's "Callback URLs" row is satisfied by construction. **But** Supabase rejects a redirect that is
not in its allowlist, so each gateway origin must be added to the hosted project's redirect allowlist as
it is provisioned, or auth flows on that gateway will fail after DNS starts working. There is no
`supabase/config.toml`; that setting lives in the hosted dashboard and is owner-only.

---

## 6. What remains, by §13 step

| Step | State | Owner |
|---|---|---|
| 1. Inventory | **Done** — this document | — |
| 2. Canonical registry in one shared source | **Done** — `src/lib/identity/domains.ts` | — |
| 3. Freeze `recruitment.`, identify `recruit.*` | **Done** — frozen in the registry, zero references found | — |
| 4. Configure DNS / TLS / deployment routing | **Vercel side DONE** (2026-08-24) — all six subdomains added to project `competen-healthcare`, ownership verified, awaiting DNS. **DNS records outstanding** | **Owner** — WebHostBox DNS |
| 5. Wire gateway-aware product context and branding | Not started. `gatewayForHost()` exists and returns null for six of seven names until step 4 | Dev, after step 4 |
| 6. Verify entitlement routing independent of hostname | **Largely already true** — `src/lib/identity/product-resolution.ts` (COMP-ID-ROUTE-001) resolves from server-side membership tables only | Dev — verification, not build |
| 7. Wrong-door behaviour | **Already built** — `product-resolution.ts`: one destination redirects, several render a chooser, none renders a controlled no-product state | Dev — verification |
| 8. Auth callbacks, verification/reset emails, deep links | Origin-relative in code; Supabase allowlist pending | **Owner** (dashboard) |
| 9. Redirects for deprecated aliases | **No work** — nothing published. §5.1 | — |
| 10. End-to-end gateway/isolation tests in staging | Blocked on step 4 | Dev, after step 4 |
| 11. Publish production DNS only after staging acceptance | Blocked on step 4 | **Owner** |

The critical path is step 4, and it is not code. Steps 6 and 7 are the pleasant surprise: an adjacent
spec already built them, so the entitlement and wrong-door halves of §14's Definition of Done are
closer than the domain half.

---

## 7. How to re-run the evidence

```bash
npx --yes tsx scripts/domain-registry-harness.ts
```

DNS, which no test can assert:

```bash
for h in www practice enterprise individual recruitment staff platform; do printf "%-40s" "$h.competenhealthcare.com"; curl -s -o /dev/null -m 12 -w "%{http_code}\n" "https://$h.competenhealthcare.com/" || echo "NO RESOLVE"; done
```

---

## 8. Activation record — §9 DNS/TLS (added 2026-08-24)

### 8.1 What the DNS actually is

`vercel domains inspect` and a live NS lookup, both 2026-08-24:

- **Registrar/DNS: third party.** Nameservers are `ns1.bh-65.webhostbox.net` and `ns2.bh-65.webhostbox.net`
  — WebHostBox, a cPanel-style zone editor. Vercel's own nameservers (`ns1/ns2.vercel-dns.com`) are
  listed as "intended" and are **not** in use. That is a supported configuration; records are created
  at WebHostBox and Vercel serves the traffic.
- **There is no proxy layer.** WebHostBox DNS is plain authoritative DNS. The "proxied / DNS-only"
  distinction is a Cloudflare concept and does not exist here, so there is nothing to disable. If the
  zone is ever moved to Cloudflare, the records must be **DNS-only (grey cloud)** at least until
  Vercel has issued certificates, or the ACME challenge cannot complete.

### 8.2 Existing records, which are NOT being changed

| Host | Type | Value |
|---|---|---|
| `competenhealthcare.com` (apex) | A | `64.29.17.1`, `216.198.79.1` |
| `www` | CNAME | `competen-v5-semacast.vercel.app` |

Both work and both predate the current Vercel recommendation. **They are deliberately left alone** —
§13 step 2 is a registry, not a migration, and the apex is the patient booking address (§4).

### 8.3 Vercel side — done

All six subdomains added to project `competen-healthcare`; `attached: true`, `verified: true` (ownership).
Each reports `invalid-configuration` only because no DNS record exists yet. The project now holds eight
domains. Required record for all six, from `vercel domains verify`:

**CNAME → `fe965000d36362fc.vercel-dns-017.com`**

⚠ That target is **per-domain, not generic**. It is not `cname.vercel-dns.com`; it was read from Vercel
for each of the six individually and is identical across them because it is scoped to
`competenhealthcare.com`. Do not substitute a value remembered from another project.

### 8.4 Verifying

```
node scripts/domain-activation-check.mjs
```

Reports four distinct states per host — `NO DNS`, `DNS, NO TLS`, `WRONG TARGET`, `LIVE` — because they
have different fixes and look identical in a browser. `www` and the apex are included as **controls**:
they already work, so if they do not report `LIVE` the check itself is broken.

Baseline before any records existed: **0/6 gateways live, both controls live.**

### 8.5 ⚠ What DNS will NOT give you

A hostname answering 200 means the address works. It does **not** mean the product gateway behind it is
wired. §13 step 5 (gateway-aware product context and branding) is not built: of the six, only `staff`
has host-aware routing today (`staffEntryRewrite`, COMP-HQ-ACCESS-001 §5). The other five will serve the
application's ordinary root — the marketing home — until step 5 is built.

That is the honest sequence and it is not a defect: hostname is navigation, and §5 of the spec requires
authorization to stay entitlement-driven regardless of host.

---

## 9. §9 CLOSED and §12 partially accepted — 2026-08-26

### 9.1 The six gateways are live

DNS records created by the owner at WebHostBox; all six CNAME to
`fe965000d36362fc.vercel-dns-017.com`. Verified three independent ways on 2026-08-26:

| Check | Result |
|---|---|
| Records in the zone (asked authoritatively) | 6/6 correct target |
| Vercel domain status | 6/6 `configured-correctly`, `ok=true` |
| TLS + HTTPS (connected by edge IP with SNI) | 6/6 **HTTP 200** |

**§12's first acceptance row — "All canonical production hostnames resolve over TLS to the intended
gateway" — now passes.** It is also the first time `staff-host.ts`'s resolver has had a live host to
run against, a week after it shipped.

Mail DNS was completed in the same pass: SPF single and valid, DKIM published, MX unchanged, and DMARC
added in monitor mode (`p=none`).

### 9.2 ⚠ A caching resolver produced a confidently wrong answer

`mail-dns-check.mjs` reported DMARC `MISSING` for a record that had been created **correctly**. It used
the system resolver, which still held the NXDOMAIN cached from before the record existed, and the owner
was sent looking for a double-domain mistake they had not made.

Negative DNS answers are cached for the zone's SOA minimum, so a checker whose only question is *"did
the record I just created land?"* is **guaranteed** to read stale data at the moment it runs. Both
checkers now query the zone's own nameservers and print which path they used; if the authoritative
servers are unreachable they fall back and say so, because a degraded run that looks identical to a
good one is how the wrong advice was produced.

It also split one state in two. TLS and HTTP still go through the system resolver, because that is what
a browser does — so a record can be right in the zone while the local machine has not caught up. That
is **`PROPAGATING`**, not `NO DNS`, and its answer is *wait*, not *go back to the DNS panel*.

### 9.3 What §12 acceptance now covers

`scripts/gateway-acceptance-check.mjs` — 21 rows, all passing, run against the live hosts. It connects
by edge IP with SNI so a propagating record cannot skew the result.

- **Privileged boundaries.** `/super-admin` is refused on all six gateways, including `platform` and
  `staff`. A hostname buys nothing.
- **Isolation.** `/practice/home` is refused on all six.
- **⚠ And the property, not just the per-host results.** The refusals are compared for *identical
  shape* across all six hosts. A gateway that refused **differently** would pass every per-host check
  while proving §5 false — that authorization is host-independent. Both comparisons collapse to one
  shape. The comparison was proven to discriminate against synthetic differing responses, so the
  single-shape result is a finding rather than an artefact of normalisation.
- **Staff host rewrite**, live: root serves the staff door, `www` root is untouched (fail-open), and
  `/login` on the staff host resolves normally — only the root is rewritten.

### 9.4 What is still NOT verified

- **§6/§7 authenticated routing** — one entitled destination lands directly, several render the
  chooser, none renders the controlled no-product state. This needs a real signed-in identity.
  `resolveProductDestinations` is unit-covered by `access-doors-harness`; **the live authenticated pass
  is the owner's** and has never been done.
- **§13 step 5** — five of six gateways serve the marketing root, because host-aware product context is
  not built. Expected: hostname is navigation, and §5 keeps authorization entitlement-driven regardless.
  Only `staff` has host-aware routing today.

---

## 10. §6/§7 human acceptance — 2026-08-26

Run against `*.localhost:3000` (production Supabase) and `localhost:3100` (staging Supabase). Every
result came from an in-page recorder polling every 120–200ms, not from reading the screen afterwards —
the "one" state performs a full navigation and the first recorder attempt was destroyed by it
(`ticks: 0`), so the second was moved to `sessionStorage`, which survives same-origin navigation.

| Test | State | Evidence |
|---|---|---|
| 1 — one destination lands directly | **PASS** | `state:"one"` · "Taking you to Competen Platform" · `sawChooser:false` over 318 ticks |
| 2 — several render the chooser | **PASS** | `state:"many"` · "Where would you like to go?" · Platform + Practice · `disabledCards:0` |
| 3 — no entitlement, controlled state | **PASS** | `state:"none"` · "Your Competen account is active" · no cards · **no redirect** |
| 4 — wrong door explains, no expansion | **PASS** | On the recruitment host: `recruitmentOffered:false`, offered set identical to test 2 |

### 10.1 ⚠ The zero-destination state is structurally unreachable

Test 3 needed an identity nobody could produce. Creating an auth user in staging **automatically
created a `profiles` row** — the `on_auth_user_created` trigger running `handle_new_user()` (bootstrapped
in the baseline, replaced by migrations 171 and then 249). A `profiles` row alone grants the Platform
destination, so **every account that has ever signed up holds at least one**.

The row had to be DELETED to produce the state at all. That is why no zero-destination identity exists
in production: not an accident, a consequence of the trigger.

So §7's controlled no-product state is correct, now proven to render, and **cannot occur for a normally
created account**. It is reachable only by removing a profiles row or by a future product whose
entitlement is separate from profile existence. Whether that is the intended design is a question for
whoever owns §7 — nothing was changed.

The staging identity is kept for regression: `noproduct.probe@staging.competen.invalid`
(`77c9bdb5-ea42-43fa-83a2-3761babdbd11`), staging project `ezhvpgtcqcdsgylrxgdb`, `.invalid` domain so
it can never receive mail. Its password was rotated into a gitignored file and that file deleted.

### 10.2 Findings captured, not acted on

- **Products serve under other products' hostnames.** Chooser cards use relative hrefs, so selecting
  Practice on the Recruitment gateway lands at `recruitment.../practice/home`. No access expansion —
  entitlement decided — but it touches §10 branding and §11 canonical URLs.
- **`/platform`, `/dashboard` and `/super-admin` carry the generic root title.** Three routes with no
  page-level metadata.
- **`/login` shows the sign-in form even when a valid session exists** for that host.
