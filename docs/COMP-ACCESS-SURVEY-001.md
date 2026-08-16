# COMP-ACCESS-SURVEY-001 — The access-door specs against the deployed truth

**Survey first, build second.** This document records what COMP-ACCESS-ARCH-001, COMP-ACCESS-IMP-001
and COMP-STAFF-ACCESS-001 ask for, verdict by verdict, against what this repository actually runs —
and then names the safe first slice that was built from it (the door registry, the Enterprise door
page, and the Staff Access gateway end-to-end). Everything else stays surveyed, not faked.

Verdicts: **EXISTS** (with evidence) · **PARTIAL** (how far) · **ABSENT** · **PLATFORM-DEFERRED**
(needs infrastructure this repo cannot reach: DNS, a second auth client, a token minter) ·
**DECISION-NEEDED** (conflicts with a decision of record, or the owner must choose).

---

## 0. Provenance and method

| | |
|---|---|
| Specs read | the full text of all three .docx (word/document.xml extraction). The comp PNGs were looked at and deliberately **not** treated as structure — comp pictures have been wrong about structure five times in this repo's recorded history |
| Repo read | `src/lib/supabase/*`, `src/lib/roles.ts`, `src/lib/platform-membership.ts`, `src/lib/hq/context.ts`, `src/lib/hq/governance-context.ts`, `src/lib/workspace-links.ts`, `src/lib/oauth-providers.ts`, `src/lib/ogs/lifecycle.ts`, `src/lib/enterprise-constants.ts`, `src/app/login/page.tsx`, `src/app/practice/sign-in/*`, `src/app/individual/sign-in/page.tsx`, `src/app/recruitment/sign-in/page.tsx`, `src/app/enterprise/layout.tsx`, `src/app/super-admin/layout.tsx`, `src/app/platform/control-plane/layout.tsx`, `src/app/platform/staff/layout.tsx`, `src/app/dashboard/launcher/page.tsx`, `src/app/api/governance/contexts/route.ts`, `scripts/sso-harness.ts`, `scripts/public-disclosure-harness.ts` |
| Not done | no migration, no DNS, no auth-server configuration change, no commit or push |

**The one-sentence finding.** The IMP pack's claim that this is "compose existing components, no
re-implementation" is *half* true: identity, gate 1, gate 2, appointments, capability grants,
context resolution and per-plane server-side enforcement all genuinely exist and are reused here.
What does **not** exist — per-door token audiences, per-door registered auth clients, subdomains,
staff MFA, a cross-product entitlement registry, a unified access audit stream — is platform
infrastructure the pack assumes into being. The highest-value section is §3: what exists but is
weaker than the pack claims.

---

## 1. COMP-ACCESS-ARCH-001, element by element

### 1.1 Shared identity foundation (s3)

| Element | Verdict | Evidence |
|---|---|---|
| One canonical identity directory | **EXISTS** | one Supabase GoTrue project authenticates every surface: `src/lib/supabase/server.ts:5-36`, `src/lib/supabase/client.ts`. There is no second credential store anywhere |
| Credential service (password) | **EXISTS** | `POST /api/auth/login` (`src/app/api/auth/login/route.ts`) and `supabase.auth.signInWithPassword` in the Practice form (`src/app/practice/sign-in/SignInForm.tsx:34`) — same GoTrue either way |
| Federated auth (SSO) | **EXISTS, dormant by design** | start route `/api/auth/oauth/[provider]`, callback `/auth/callback`, gate module `src/lib/oauth-providers.ts`. `NEXT_PUBLIC_OAUTH_PROVIDERS` empty renders the row disabled-and-explained; the start route re-checks GoTrue's live settings. Pinned by `scripts/sso-harness.ts` |
| MFA service | **PARTIAL — practice plane only** | Practice two-factor (`src/app/practice/two-factor/`, shell state `MFA_REQUIRED` in `src/app/practice/select-workspace/page.tsx:21`). Estate/staff TOTP was **decided and not built** (recorded decision). Landlord strong MFA **ABSENT** |
| Entitlement service | **PARTIAL** | gate 1 `platform_membership` (mig 279, reader `src/lib/platform-membership.ts`), practice membership (`src/lib/practice/shell.ts`), enterprise membership (`src/lib/enterprise-membership.ts`). No product-entitlement registry for Individual/Recruitment — those products do not exist |
| Tenant membership + role resolution | **EXISTS** | `estateRolesOf` / `orgRolesOf` / `platformRolesOf`, `src/lib/roles.ts:59-235` — the three folds, centralised, equivalence-proven by `scripts/identity-resolver-harness.ts` |
| Appointment service | **EXISTS** | OGS: `ogs_offices` + `ogs_office_appointments`, allowlist `appointmentGrantsAccess` (`src/lib/ogs/lifecycle.ts:63-65`), HQ resolution `resolveHqPositions` (`src/lib/hq/context.ts:100-153`) |
| Capability service | **PARTIAL — per plane, not cross-product** | HQ: `hq_position` + `hq_position_capability` + `activeGrants` (`src/lib/hq/spaces.ts`). Practice: its own capability catalog. No single registry spanning products |
| Session service | **PARTIAL** | one GoTrue session, cookie-carried. Revocation and idle enforcement exist on the practice plane (`SESSION_REVOKED`, 30-min idle — CPR-370); estate-wide 12h absolute lifetime is a **deferred owner decision**. No per-application session issuance |
| Audit service | **PARTIAL** | `hq_access_observation` (HQ decisions incl. refusals, `src/lib/hq/context.ts:172-183`), `audit_log` `governance_context_switched` (`src/lib/hq/governance-context.ts:139-166`), `practice_audit_event` (append-only since mig 247). **No unified per-door login success/failure stream** |

**NO AUTHORITY BY EMAIL (s3): EXISTS as an enforced fact.** Nothing in the codebase grants anything
from an email domain, job title text, or route knowledge; every admission reads a table
(roles/membership/appointment). The staff gateway built in this slice keeps that property.

### 1.2 The six doors (s5–s10)

| Door | Verdict | Deployed truth |
|---|---|---|
| Practice | **EXISTS** | `/practice/sign-in` — flag-gated (`practice_sign_in`, off = honest "not open yet" page, on = real form into the one identity), `src/app/practice/sign-in/page.tsx`. Post-auth routing via `resolvePracticeShell` (home / onboarding / chooser / access-status), which is exactly the spec's resolve-context step |
| Enterprise | **PARTIAL → door page built in this slice** | `/enterprise` already renders a public gate page with `Sign in → /login?next=/enterprise` (`src/app/enterprise/layout.tsx:27-48`) and a membership-gated shell (Workforce read-only is the one live sub-product, `src/lib/enterprise-constants.ts:16`). The spec's named entry path `/enterprise/sign-in` did not exist — **built** as a thin branded wrapper that funnels to the one identity; no duplicated credential logic |
| Individual | **EXISTS as an honest door onto a room being built** | `/individual/sign-in` renders `ProductComingSoon` — deliberately **no password field** (`src/app/individual/sign-in/page.tsx`). `/login?next=/individual` shows the BUILDING notice before the password is typed (`src/app/login/page.tsx:53-62`) |
| Recruitment | **EXISTS as an honest door onto a room being built** | `/recruitment/sign-in`, same pattern (`src/app/recruitment/sign-in/page.tsx`) |
| Staff | **ABSENT → BUILT in this slice** | the footer's "Competen Staff Access" pointed **directly at `/super-admin`** (`src/lib/marketing/home-content.ts:62`) — a destination, not a gateway. No staff sign-in surface, no appointment check between authentication and routing, no selector, no no-access states. Now: `/staff` + `/staff/workspaces`, see §4 |
| Landlord | **PARTIAL, correctly unadvertised** | `/platform/control-plane` exists and is gated on the landlord axis (`getLandlordCaller`, `src/app/platform/control-plane/layout.tsx`), refusal is a sentence not a dead end. No separate sign-in surface, no privileged session, no strong MFA — see §3. It is not linked from any public page, which s10 requires |

### 1.3 Subdomains and token audiences (s12, s13) — **PLATFORM-DEFERRED, and here are the honest mechanics**

The spec asks for per-door origins (`practice.<domain>`, `staff.<domain>`, …) and sessions that
"carry or resolve an intended application audience", with APIs rejecting wrong-audience tokens
("aud: competen-practice").

**Neither is buildable from this repository today, and faking them would be worse than deferring:**

- **One GoTrue project mints one audience.** Every token this product issues says
  `aud: authenticated`. Per-product audiences require separate registered auth clients or a token
  service in front of GoTrue — deployment/platform work, not repo work. Writing an `aud` claim check
  into API routes against a value GoTrue never mints would be a check that can never fire: security
  theatre. **Not built.**
- **No DNS access exists yet** (recorded owner constraint). Subdomain-per-door is a deployment
  mapping decision for the day the domain estate exists. The spec itself concedes this: s13 — "Exact
  domains remain configurable; the architecture requires separation, not these literal hostnames."
- **The repo-buildable equivalent is PATH-BASED DOORS, and it is what exists:** `/login`,
  `/practice/sign-in`, `/individual/sign-in`, `/recruitment/sign-in`, `/enterprise/sign-in`,
  `/staff`, with `/platform/control-plane` unadvertised. The registry (`src/lib/access-doors.ts`)
  records each door's path so the subdomain mapping later is configuration, not archaeology.
- **What actually enforces plane isolation today — and genuinely satisfies s12's "logical
  application/session isolation … from the first implementation":** every protected surface
  re-resolves authority server-side per request from its own store. Practice: `requirePracticeContext`.
  Estate: gate 1 (`admitToEstate`) + gate 2 (role gates in eleven layouts). HQ:
  `requireHqCapability` + one-active-appointment. Landlord: `getLandlordCaller`. Enterprise:
  `resolveEnterpriseShell`. A Practice session presented to an HQ page is refused by the HQ gate
  reading HQ tables — the *authorisation* boundary holds even though the *token* boundary does not
  exist. ROUTE IS NOT AUTHORITY (IMP s9) is already this codebase's operating rule.

### 1.4 Context selector (s14) and the PW-014 conflict — **DECISION-NEEDED**

The ARCH spec's decision flow (s11 step 5) puts a context selector after every sign-in with multiple
valid contexts. **This estate has a decision of record that says otherwise:** PW-014 §1 / PW-AC-01 —
universal landing — "every authenticated user lands in the Personal Workspace … functional portals
are reached from there via the Workspace Launcher, not at login" (`src/app/login/page.tsx:99-102`,
launcher at `src/app/dashboard/launcher/page.tsx`).

**Resolution taken in this slice — not a silent override:**
- **Product-plane sign-ins keep universal landing, unchanged.** `/login` still lands on `/dashboard`;
  the harness pins it.
- **The STAFF door gets the selector**, because the staff/governance plane was never covered by
  PW-014 (an HQ appointee's contexts are governance appointments, not personal-workspace portals),
  and COMP-STAFF-ACCESS-001 explicitly requires it there.
- **The conflict itself goes to the owner:** if the six-door architecture's per-door selectors should
  ever replace universal landing on the product plane, that reverses PW-014 and must be decided, not
  drifted into. Recorded in §6.

Selector rules s14 measured against what was built: only authorised destinations are listed (from
the same resolver the launcher uses — `workspaceLinksForUser`, so the two cannot drift); no disabled
teasers; data comes from resolvers, not hard-coded menus; "remember choice" is **not implemented**
(HQ's context cookie already exists on its own plane and is revalidated every request —
`src/lib/hq/governance-context.ts:13-16`).

### 1.5 Failure and no-access states (s20)

| State | Verdict |
|---|---|
| Authenticated, no product entitlement | **EXISTS per plane**: Practice `/practice/no-account`; Enterprise `NO_TENANT` sentence (`src/app/enterprise/layout.tsx:50-60`); estate non-members are routed to their own product (`NO_MEMBERSHIP_DESTINATION`, `src/lib/platform-membership.ts:94`) |
| Staff with no appointment | **ABSENT → BUILT**: `/staff/workspaces` no-appointment state, sentence-true, no privileged fallback |
| Revoked appointment | **EXISTS server-side** (allowlist admits only `active`); **BUILT** as a rendered state at the staff gateway |
| Expired/suspended entitlement | **EXISTS**: practice `ACCESS_RESTRICTED`/`access-status`; appointment statuses off the allowlist stop granting immediately |
| Wrong door | **PARTIAL**: `signInPageFor` sends practice people to the practice door (`src/lib/oauth-providers.ts:65-67`); the staff gateway now sends practice-only identities to `/practice/home` without elevating |

### 1.6 API/service expectations (s18) — **PARTIAL**

`GET /access/contexts` exists **for the HQ plane** as `GET /api/governance/contexts`
(self-scoped, authenticated-only — `src/app/api/governance/contexts/route.ts`), with
`POST /api/governance/context/switch` beside it. A generic cross-product `/access/*` family is
**ABSENT**; building it before a second product exists would be an interface with one caller.
DECISION-NEEDED only when Enterprise modules or Individual ship.

---

## 2. COMP-STAFF-ACCESS-001, element by element

| Spec element | Verdict | Evidence / what was done |
|---|---|---|
| `/staff` dedicated gateway | **ABSENT → BUILT** | `src/app/staff/page.tsx` — staff-branded sign-in surface over the one identity (posts to `/api/auth/login`; SSO buttons render only when a provider is enabled, same gate as every other door). Already-authenticated visitors go straight to resolution |
| `/staff/mfa` | **ABSENT — not faked** | no TOTP/MFA machinery exists on the estate plane (decided, not built). A fake challenge screen would be a painted door. The gateway renders **no** MFA step and **claims none** |
| Staff identity validation | **PARTIAL, composed from what exists** | there is no `StaffIdentity` table. The deployed equivalents, in gate order: gate 1 `platform_membership` (`admitToEstate` — practice-only identities are refused the staff environment and pointed to their own product), gate 2 estate/platform roles, OGS appointments. A dedicated staff-identity object is a **DECISION-NEEDED** (see §6) |
| Appointment resolver | **EXISTS — reused verbatim** | `resolveHqPositions` + `listGovernanceContexts` + `appointmentGrantsAccess` allowlist. The gateway adds no second spelling of any of it |
| Workspace registry | **EXISTS in-repo; DB registry not built** | `WORKSPACE_CATALOGUE` (`src/lib/roles.ts:136-148`) + the HQ workspace + capability map (`src/lib/hq/spaces.ts`). This slice adds `src/lib/access-doors.ts` as the typed in-repo **door** registry — see §5 for why in-repo, not a table |
| `/staff/workspaces` selector | **BUILT** | `src/app/staff/workspaces/page.tsx` over a pure resolver (`src/lib/staff/selector.ts`) fed by the SAME `workspaceLinksForUser` the launcher and header use — the selector cannot offer what the gates refuse, and cannot drift from the estate's own switchers |
| No-access states | **BUILT, each reachable and true** | no active appointment / access withdrawn (rows exist, none `active`) / appointment grants no workspace / practice-only account. Each is a distinct sentence with a real exit; none falls back to an admin surface |
| Session & context switching (s12) | **PARTIAL** | HQ context switching exists with audit (`recordContextSwitch`); staff idle/absolute timeout **ABSENT** on the estate plane (deferred decision); device/session visibility exists practice-plane only |
| Rate limiting / lockout on staff auth | **PARTIAL** | GoTrue's own rate limits apply (shared identity); no additional staff-door limiter. Honest note, not a claim |
| Audit (s16) | **PARTIAL** | HQ refusals land in `hq_access_observation`; context switches in `audit_log`. Staff-gateway sign-in events ride the shared GoTrue auth logs; no dedicated staff-auth event stream |
| Destination-side enforcement (s4 route hardening) | **EXISTS — the strongest part of this estate** | every destination the selector offers re-authorises itself: `/super-admin` layout gate + per-page `requireHqCapability` (205 pages enforce), workspace layouts' own `ALLOWED` gates, gate 1 in all eleven estate layouts. The gateway routes; it grants nothing |
| Footer entry routes only to the gateway | **DECISION-NEEDED — deliberately not flipped** | `STAFF_ACCESS.href` is still `/super-admin` (`src/lib/marketing/home-content.ts:62`), and `scripts/public-disclosure-harness.ts:338-340` pins that. The spec's own go-live rule (s25) forbids enabling the footer→gateway link before acceptance; the flip is a one-line change to the constant that exists for exactly this, plus the 7b pin. Owner's call, listed in §6 |

---

## 3. What exists but is WEAKER than the IMP pack claims (s2's reuse table, audited)

| Claimed component | Pack's treatment | Measured truth |
|---|---|---|
| IAM-000 "shared identity, authentication, authorisation and trust foundation" | REUSE | identity + authentication: yes, one GoTrue. Authorisation: **per-plane resolvers, not a foundation service**. There is no registered-client/audience layer at all |
| IAM-SES-001 "session timeout, automatic logout and session controls" | REUSE | **practice plane only** (30-min idle, revocation, device list). The estate has no idle timeout, no absolute lifetime, no session console. Reusing it for the staff door would be reusing a thing that is not there |
| PLAT-ROUTE-001/002 routing | REUSE | routing conventions and reserved namespaces exist **as code and as the access matrix**, not as an engine. `STAFF_ACCESS` is the one configured entry constant |
| PPE-004 "personalisation and context resolution engine" | REUSE | **PPE is a priority/execution read model (mig 107), not a login context resolver.** The real context resolvers are `resolvePracticeShell`, `resolveEnterpriseShell`, `resolveActiveGovernance`, `workspaceLinksForUser`. The pack cites the wrong engine; the right ones were reused |
| PLAT-CAP-001 capability registry | REUSE | per-plane registries (HQ capability grants; practice capability catalog). **No cross-product composition framework** |
| PLAT-GOV-001 appointments/governance | REUSE | **fully real** — migs 281+282, one-active-appointment doctrine, allowlist lifecycle. Reused verbatim |
| LCP-001 landlord foundation | REUSE | the surface and the landlord-axis gate exist; **privileged session, strong MFA, step-up and privileged audit do not**. LCP-001's own transitional bridge admits a tenant super_admin |
| CPR-IAM-001 practice identity | REUSE FOR PRACTICE | real and flag-gated; reused untouched |
| COMP-STAFF-ACCESS-001 | REUSE FOR STAFF | was a spec, not a component — **this slice is its first machinery** |

---

## 4. What was built (the safe first slice)

1. **`src/lib/access-doors.ts`** — the typed in-repo door registry (the spec's AccessDoorConfig,
   s5 of the IMP pack): door code, name, entry path, source file, plane, status, and the sentence
   that must stay true of each door. No imports, so harnesses read it without dragging a server graph.
2. **`src/app/enterprise/sign-in/page.tsx`** — the Enterprise door at the spec's named path: a thin
   branded wrapper that funnels to `/login?next=/enterprise` (the one identity). No credential field
   of its own, no claimed entitlements; says honestly what Enterprise is today.
3. **The Staff Access gateway, end-to-end:**
   - `src/app/staff/page.tsx` + `StaffSignInForm.tsx` — dedicated staff sign-in surface, shared
     identity (`/api/auth/login`, shared SSO gate), visibly distinct from customer sign-in, with the
     trust boundary stated.
   - `src/lib/staff/selector.ts` — the PURE gateway decision (fixture-testable): gate 1 outranks
     offers; destinations come from the launcher's own resolver; four no-access states.
   - `src/lib/staff/gateway.ts` — the server loader composing `admitToEstate` +
     `workspaceLinksForUser` + `listGovernanceContexts` + the appointment-status read. No fold
     respelled, no second appointment resolver.
   - `src/app/staff/workspaces/page.tsx` — the selector: only held contexts, grouped, the active
     identity named, every destination re-gated on arrival, sign-out and support paths on every state.
4. **`scripts/access-doors-harness.ts`** — pins in §7 of the final report; break-tested.

**Not built, with reasons:** subdomains/audiences (§1.3), staff MFA (§2 — no machinery, no fakes),
landlord door hardening (needs MFA + privileged sessions first — a "landlord sign-in" page in front
of the same session would claim isolation it does not have), DB-backed workspace registry (§5),
generic `/access/*` APIs (§1.6), footer repoint (§2, owner's go-live call).

---

## 5. The AccessDoorConfig choice, recorded

IMP s5 asks for a configuration model per door; s10 of the staff spec asks for a config-driven
workspace registry. **Implemented as a typed in-repo registry (`src/lib/access-doors.ts`), not a
database table.** The spec text says "configuration-driven wherever possible" — it does not require
*runtime* reconfigurability, and every consumer of this configuration is a code surface that ships
with the repo. A table would add a read to every door render, a failure mode ("doors unreadable"),
and a second place for door truth to drift from door code — for zero current callers who could
change it at runtime. The registry keys deliberately mirror the spec's (`door_code`,
`display_name`, `entry path`, `plane`, `status`) so a later migration to `plat_*` config, if the
owner ever wants one, is a transcription rather than a redesign.

---

## 6. DECISION-NEEDED — the owner's list

1. **Subdomain-per-door + per-door token audiences** (ARCH s12/s13): platform work — DNS estate,
   auth-client registration or a token service. Path-based doors are the deployed equivalent until
   then. Nothing in the repo pretends otherwise.
2. **The PW-014 conflict** (ARCH s11 step 5 vs universal landing): selector built for the staff
   plane only. Extending per-door selectors to the product plane reverses a decision of record.
3. **Footer repoint** `STAFF_ACCESS.href` `/super-admin` → `/staff`: one line in
   `src/lib/marketing/home-content.ts` + the 7b pin in `scripts/public-disclosure-harness.ts`. The
   staff spec's own go-live gate (s25) says not before acceptance — so it is the owner's flip, not mine.
4. **Staff-plane MFA**: the spec mandates it; the estate has none and the TOTP arc was decided and
   not built. Until it exists, the staff door is honest about being password(+SSO)-only.
5. **A dedicated StaffIdentity/staff-appointment store** (STAFF s6): today "Competen staff" is
   composed from platform_membership + roles + OGS appointments. Sufficient for the current
   headcount; a real employment-status source of truth is an organisational decision.
6. **Estate session policy** (idle/absolute/device console) — the deferred 12h decision; the staff
   spec depends on it (s12).
7. **Landlord hardening** (ARCH s10): strong MFA, privileged session lifetime, step-up, privileged
   audit — all absent; the landlord surface leans on the same session as everything else plus the
   landlord-axis gate. Ordered after MFA exists at all.

---

## 7. Comp elements REFUSED, each with its specific reason

| Comp element | Refusal reason |
|---|---|
| "Use backup code" link | recovery codes **do not exist** in this product — no generator, no store, no verifier (a recorded gap). Rendering the link would 404 a person locked out of their account at the worst possible moment |
| "Trust this device for 30 days" | device trust exists **practice-plane only** (`src/app/practice/(shell)/privacy/security/SecurityConsole.tsx`); no estate/staff surface has the machinery. A checkbox that stores nothing is a fake control |
| "Remember me" | the Supabase session **already persists** across browser restarts; the checkbox would either claim to do what happens anyway or imply a session-length control that does not exist |
| Dashboard figures ($1.24M revenue, 92%, 99.8% uptime, 8.4% no-shows) | fabrications — no engine serves any of them. HQ Mission Control exists and renders its own honest widgets; no new figure was invented anywhere in this slice. (No-show *rates* are additionally forbidden on the practice plane by the honesty rules) |
| Workspace selector for every sign-in | conflicts with PW-014 universal landing, a decision of record — staff door only, conflict recorded in §6 |
| Per-door `aud` claims in tokens | one GoTrue project cannot mint them; a checker that can never fire is security theatre (§1.3) |
