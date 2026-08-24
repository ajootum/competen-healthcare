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

> **This may already have been decided, and if so the decision is not written down anywhere in this
> repository.** During the COMP-HQ-ACCESS-001 arc on 2026-08-17 the owner chose to mount the HQ
> behaviours on the existing `/super-admin` estate rather than build a parallel `/hq/*` family —
> "`/hq` paths are later aliases if ever wanted" — on the grounds that duplicating a 33-section estate
> contradicts one-canonical-home, and that the spec's definition of done is behavioural and names no
> path. A grep of `docs/`, `docs/adr/` and `src/` finds no record of that ruling; it survives only in
> an assistant memory file, which is a point-in-time note and not authoritative. **If the ruling is
> real, COMP-ACCESS-URL-001 §2's `/hq` row is already superseded and this conflict is closed** — but
> it should be written into `docs/adr/` before anyone relies on it, because a decision that lives
> outside the repository is one session away from being re-litigated.

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
| 4. Configure DNS / TLS / deployment routing | **Not started** | **Owner** — registrar + Vercel |
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
