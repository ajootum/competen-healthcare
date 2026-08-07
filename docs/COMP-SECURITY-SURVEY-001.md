# COMP-SECURITY-SURVEY-001 — Survey of COMP-AUTH-001, COMP-IDENTITY-001, COMP-SEC-001

Survey only. No code was changed. Date: 2026-08-07.

## Provenance of the three documents

All three were supplied twice. **The copies are byte-identical** (MD5 verified: `2a424087…` AUTH,
`dfcd0de9…` IDENTITY, `87933dd7…` SEC). No "(1)" revision. No diff was needed.

All three are **very short**: 60, 72 and 72 lines of extracted text respectively — roughly 2 KB each.
They are bullet-list charters, not build specs. There is no numbered section scheme, no data model,
no API surface, no acceptance-test detail beyond a five-line list, **no navigation section in any of
the three**, and **no capability codes named anywhere**. Every "s-number" cited below is my own
paragraph-heading reference, because the documents do not number their own sections.

They are also **`COMP-*`, i.e. platform-wide**, and explicitly cross-product: COMP-AUTH-001 opens
"a shared authentication and session-management engine for all Competen products (CP, AFCAN,
Competen Platform, etc.)". This is the first spec set this week that is not scoped to `/practice`.

---

# ⚠ SECTION 0 — WHAT THE SURVEY FOUND FIRST

The brief asked me to assume more live vulnerabilities of the class found in `fc2de9a2`. There are.
These are ordered by severity and every one was confirmed **against the live database or the live
auth server**, not inferred from source.

## 0.1 ⚠⚠⚠ CRITICAL — unauthenticated remote privilege escalation to `super_admin`

Three facts, each independently verified, compose into a complete platform takeover.

**Fact 1 — the live signup trigger copies a client-supplied role verbatim.**
Read back from the deployed database via `plat_function_registry` (not from the migration file):

```sql
-- LIVE body of public.handle_new_user(), security definer, no search_path pin
insert into public.profiles (id, full_name, email, role)
values (new.id, …, new.email,
        coalesce(nullif(trim(new.raw_user_meta_data->>'role'), ''), 'nurse'))
on conflict (id) do update set full_name = excluded.full_name,
                               email = excluded.email,
                               role  = excluded.role;
```

There is **no allow-list**. `raw_user_meta_data.role` is whatever the caller put in the signup
payload. Source of record: `supabase/migrations/171-handle-new-user-writeback.sql:32-50`; trigger
`on_auth_user_created AFTER INSERT ON auth.users` at `supabase/schema.sql:220-223`.

Migration 171's own header flags the default-role question ("Anyone who can sign up gets a clinical
role by default") but **not** this one — it treats the value as always defaulting, and does not
observe that the caller controls it.

**Fact 2 — the API route's allow-list is not the only door.**
`src/app/api/auth/signup/route.ts:38` correctly clamps to `PUBLIC_ROLES = ["nurse","assessor",
"educator"]`. That clamp is irrelevant. The trigger fires on `auth.users`, so it also fires for a
direct call to GoTrue with the **public anon key that ships to every browser**
(`NEXT_PUBLIC_SUPABASE_ANON_KEY`):

```
POST https://<project>.supabase.co/auth/v1/signup
apikey: <the public anon key>
{"email":"…","password":"…","data":{"role":"super_admin"}}
```

**Fact 3 — signup is open and email confirmation is off.**
Live read of `/auth/v1/settings`:

```json
{ "disable_signup": false, "mailer_autoconfirm": true, "external_email": true }
```

`mailer_autoconfirm: true` means the signup call **returns a usable session immediately**. There is
no verification step to slow this down.

**Blast radius.** `profiles.role` is what every workspace gate reads
(`(profile.roles?.length ? profile.roles : [profile.role])`) — super-admin, platform-admin,
hospital-executive, unit-manager, supervisor, healthcare-worker, quality-accreditation,
competency-office, competency-studio, office-governance, human-resources, enterprise-governance,
organisation-admin, admin. It is also what RLS reads: the live body of
`current_user_is_super_admin()` is `select exists (select 1 from profiles where id = auth.uid() and
role = 'super_admin')`. So the escalation clears the application gates **and** the database policies
in one step.

I did **not** exploit this. Creating a privileged account is not a read-only act, and the three
facts above are conclusive without it. Verify in a non-production project if you want the
demonstration.

**The fix is small and carries no lockout risk** — see §6.1.

## 0.1b ⚠⚠⚠ CRITICAL — a second, independent escalation path: any signed-in user can rewrite their own role

This one does not need signup at all. It works from an ordinary existing `nurse` account.

Read back live from `plat_rls_registry()`:

```
table=profiles  cmd=UPDATE  policy="Users update own profile"
    USING      = (auth.uid() = id)
    WITH CHECK = null          ← nothing
```

Postgres reuses `USING` as the check when `WITH CHECK` is absent. `auth.uid() = id` is still true
*after* the row changes, so the policy permits a user to update **every column of their own row** —
including `role`, `roles[]`, `platform_role`, `platform_roles[]`, `org_role`, `hospital_id`,
`organisation_id` and `tenant_id`. A single PostgREST `PATCH /rest/v1/profiles?id=eq.<self>` with
the browser's anon key and the user's own session sets `role = 'super_admin'`.

`'super_admin'` is inside the live CHECK constraint set
(`profiles_role_check`, migration 008: `nurse, assessor, educator, hospital_admin, country_admin,
group_admin, super_admin`), so the constraint does not stop it.

Source: `supabase/schema.sql:165`. The policy is **never dropped or replaced** anywhere in the 247
migrations — `grep -rn "Users update own profile"` returns exactly one hit. Migration 174 audited
anon *reads*; migration 189 dropped blanket reads. **Nothing has ever audited anon or authenticated
*writes*.**

Fix: add `with check (auth.uid() = id AND role = (select role from profiles where id = auth.uid()))`
— or, more simply, revoke `UPDATE` on the privileged columns and route profile edits through an API
route. ⚠ Column-level revocation is safer than a clever policy here. **This fix has no lockout risk**
for the same reason as §6.1: it only constrains writes nobody legitimately makes.

⚠ Note the interaction: fixing §0.1 alone does **not** close §0.1b, and vice versa. Both are
required.

## 0.2 ⚠⚠ HIGH — the practice device register is generating a new device on every request, which kills two controls

Live count: **`practice_session` holds 13,092 rows for 3 workspaces and 6 memberships.** In the
newest 1,000 rows there are **1,000 distinct `device_id` values, all for one user**, two of them
created in the same millisecond (`09:12:47.72826` and `09:12:47.727585` — one page load, two calls
to `resolvePracticeShell`).

Cause, at `src/lib/practice/shell.ts:107-120`: `readOrIssueDeviceId()` tries `cookies().set` and
falls back to `crypto.randomUUID()` on throw. In a Server Component `cookies().set` **always**
throws. The comment says "the cookie is planted by the API the client calls" — **that API does not
exist**. `grep -rn practice_device src/ scripts/` returns three hits, all inside `shell.ts` itself.
Nothing anywhere ever plants the cookie.

Consequences, all live:

- **"Sign out this device" does nothing.** `revokeSession` marks a row whose `device_id` will never
  be presented again. `securityPosture()` advertises the guarantee *"A revoked device is refused by
  this practice on its next request."* That guarantee is currently false. This is precisely the
  failure mode `security.ts:16-20` says would be "the most dangerous thing this module could ship".
- **The idle-timeout control can never fire.** `touchSession` gates it on
  `if (existing && policy.session_idle_minutes)` (`security.ts:133`). `existing` is never found,
  because the device id is new. `session_idle_minutes` is dead code today.
- **The device list is unusable.** `listSessions` takes the 100 most recent rows; those are ~100
  ghosts from the last few minutes.
- **Unbounded table growth**, already 13k rows on a near-empty dev tenant.

Note this is *not* the same bug as a missing `secure` flag — the cookie options at `shell.ts:112-115`
are correct. The write simply never lands.

## 0.3 ⚠ MEDIUM-HIGH — three fail-open error discards in the security path

Same class as the four in `fc2de9a2`. All in code the shell runs on every request.

1. **`shell.ts:88-92` — the MFA check fails open on a discarded error.**
   ```ts
   const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
   if (aal && aal.currentLevel !== "aal2") { … }
   ```
   The `error` is discarded. If the call fails, `aal` is `null`, the `aal &&` short-circuits, and
   the function falls through to `{ state: "READY" }`. **An MFA-required practice opens without
   MFA whenever that call errors.** Should refuse, not proceed.

2. **`security.ts:55-68` — `getSecurityPolicy` returns `mfa_required: false` on a read failure.**
   The `select` discards its error; on failure `data` is null, the code attempts an insert, and if
   that also fails returns a hardcoded default with `mfa_required: false, break_glass_enabled: true`.
   A transient database error therefore **turns MFA off and break-glass on** for that request. The
   comment justifies the default as "a migration must never lock a practice out" — correct for a
   *missing* row, wrong for a *failed read*. Those two cases need separating.

3. **`security.ts:195-197` — the revoke write is unchecked.** `revokeSession` discards the error
   from the `update`, then audits the revocation and returns `{ revoked: true }`. A failed write is
   reported to the user as a successful lockout. Identical in shape to hole #3 of `fc2de9a2`
   ("consume was unchecked").

`touchSession`'s own `catch { return { allowed: true } }` (`security.ts:157-160`) is a deliberate,
documented fail-open and I am not calling it a bug — but note that with 0.2 unfixed it is doing all
the work anyway.

## 0.4 ⚠ MEDIUM — RLS is broken on the core platform tables, so nothing backstops the service role

An anonymous probe with the public anon key returns, for `profiles`, `hospitals`, `assessments` and
`competency_scores`:

```
infinite recursion detected in policy for relation …
```

The policies error out rather than deny. `src/app/api/auth/login/route.ts:11` already works around
it: *"Use admin client to bypass RLS (avoids infinite recursion in profiles policies)"*.

The practice tables are clean — every `practice_*` table returned 0 rows to anon, no leak. But for
the platform tables, RLS is not an enforcement layer at all. Combined with **717 files importing
`createAdminClient`, 576 of them `.tsx` server components under `src/app`**, the position is: the
service role is the normal read path, in-code checks are the only control, and there is no database
backstop if one is forgotten. COMP-SEC-001's "RBAC enforced platform-wide" is not currently true at
the database layer.

### 0.4b ⚠ Six tables have RLS switched off entirely

`plat_rls_registry()` (the repo's own migration-172 tool, queried live) reports **6 of 623 policy
rows with `rls_enabled = false`**:

```
department_frameworks   content_approvals   framework_versions
framework_rules         cycle_assessors     practice_clinic
```

Supabase grants `SELECT/INSERT/UPDATE/DELETE` on public tables to `anon` and `authenticated` by
default, so these are readable **and writable** with the browser anon key. I verified anon reads
succeed on all six.

**All six are currently empty (0 rows), so nothing is leaking today.** The exposure is the *write*
side: `cycle_assessors` is an authority table — an anonymous `INSERT` there is an attempt to grant
assessment authority over a competency cycle. `framework_rules` and `content_approvals` are
similarly governance objects.

`practice_clinic` (migration 230) is the notable one because it breaks the invariant every
`practice_*` migration since 191 declares in its header ("RLS: ENABLED WITH ZERO POLICIES ON EVERY
TABLE"). Migration 230 creates four tables and contains no `enable row level security` statement at
all; the other three were rescued incidentally by later migrations that happened to touch them
(240/241, 242/243, 244/245). `practice_clinic` was never touched again.

⚠ Migration 172 built `plat_rls_registry()` **specifically to catch this class of bug**, and it
works — I used it. Nothing in CI asserts against it, which is why a gap introduced 58 migrations
later went unnoticed. Wiring that registry into a harness is a cheap, high-value fix.

## 0.5 ⚠ MEDIUM — the public marketing site makes three security claims the product does not keep

`src/lib/marketing/practice-site.ts:246-252`, `PRACTICE_LOGIN.security`, rendered publicly:

| Claim | Reality |
|---|---|
| "Account lockout and brute-force protection" | **Nothing.** No lockout, no failed-attempt counter, no backoff, no CAPTCHA on any auth endpoint. |
| "Every sign-in recorded" | **Nothing.** No sign-in/sign-out/lock/refresh event type exists. I dumped every distinct `event_type` in `practice_audit_event` (2,480 rows) — there is no auth event among them. |
| "Session timeout" | Dead — see §0.2. |

The same file's header (lines 26-28) rejects a HIPAA badge and a false practice count on exactly
this principle. These three slipped through.

## 0.6 LOWER — assorted

- **No security headers whatsoever.** `next.config.ts` is `const nextConfig: NextConfig = {};` —
  five lines, no `headers()`. No CSP, HSTS, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`. `vercel.json` has crons only. A patient-data application is clickjacking-
  exposed and has no CSP.
- **No CSRF defence** anywhere — no token, no double-submit, no Origin/Referer check. JSON-POST
  preflight is incidental cover only.
- **`active_role` cookie is missing `secure`** (`src/app/api/auth/switch-role/route.ts:28-33`),
  unlike the practice cookies. The role *value* is correctly checked against roles held (403
  otherwise) — the flag is the only defect.
- ⚠ **Seven of nine `SECURITY DEFINER` functions have no `set search_path` pin** — and it is
  precisely the seven that touch identity or authorization: `handle_new_user()` (171),
  `current_user_is_super_admin()` (005), `current_user_is_group_admin_for()` (008),
  `current_user_is_country_admin_for()` (008), `current_user_is_hospital_admin_for()`
  (**not in any migration** — only in the unnumbered `supabase/fix-rls-recursion.sql`),
  `recalculate_competency_score()` and `recalculate_domain_score()` (010). The only two that pin it
  (`practice_next_practitioner_number/sequence`, migrations 219/220) are sequence allocators that
  make no authorization decision. Pin all seven.
- **`current_user_is_country_admin_for()` has `or p.managed_country is null`** — a `country_admin`
  whose `managed_country` is NULL matches **every** hospital in the organisation. Probably
  intentional as "all countries", but it is an authorization default that reads as an oversight.
- **`platform_role`, `platform_roles[]`, `roles[]`, `org_role`, `org_roles[]` have no CHECK
  constraint** (migration 040 deferred it deliberately — "a VALIDATED constraint can follow once
  values are known-clean" — and it was never written). The landlord authorization axis
  (`getLandlordCaller` passes if `platformRoles.length > 0`) accepts any string the database is
  handed.
- ⚠ **Migration 247's header is factually wrong about eleven immutability guards.** It states
  guards are "deployed ... migrations 027, 034, 051, 067, 084, 085, 091, 092, 093, 096, 107". None
  of those files contains a `create trigger` or `raise exception` — they use the word "immutable"
  only in prose. Only **nine** files in the whole repo create triggers (194–198, 200–202, 247).
  So `configuration_governance_audit`, `configuration_registry_audit`, `op_form_events`,
  `evidence_integrity_events`, `audit_log`, `plat_audit_events` and ~24 other tables **described in
  their own migrations as immutable audit trails accept UPDATE and DELETE**. Exposure is to
  service-role code — which is exactly the scope an audit trail exists to cover.
- **`practice_last_owner_guard` does not cover DELETE** (documented as deliberate, to keep
  workspaces deletable). A targeted `DELETE FROM practice_membership` on the last owner produces the
  permanently-unadministrable workspace the trigger exists to prevent. Migration 202 solved this
  exact cascade-vs-targeted-delete problem correctly for `practice_access_log`; the technique was
  not retrofitted.
- **`practice_membership.user_id` has no foreign key** to `auth.users` or `profiles` — nor do
  `practice_workspace.owner_person_id`, `practice_audit_event.actor_id`,
  `practice_access_log.actor_id`. The two identity planes are joined only by application convention.
- ⚠ **The repo cannot be rebuilt from `migrations/` alone.** There is no `001`. The baseline is
  `supabase/schema.sql`, alongside four unnumbered hand-applied scripts (`fix-profile.sql`,
  `fix-rls-recursion.sql`, `fix-super-admin-rls-recursion.sql`, `rls-updates.sql`) and seventeen
  `RUN-ME-*.sql` duplicates. The `profiles` UPDATE and INSERT policies (§0.1b) and
  `current_user_is_hospital_admin_for()` exist **only** in those files. A clean rebuild produces
  policies calling a function that does not exist.
- **`/dashboard` has authentication but no role gate** — any signed-in user.
- **93 of 398 API route handlers call `auth.getUser()` directly**, skipping `getCaller()` and its
  scope asserts.
- Workspace layout gates **render a "🔒 Access restricted" element rather than `redirect()`**, so
  the refusal happens after the layout has run.
- **Password policy is `length >= 8` and nothing else** (`api/auth/signup/route.ts:35`,
  `reset-password/page.tsx:35`).

---

# 1. COMP-AUTH-001 — Unified Authentication, Session Management & Security Engine

## 1.1 What already exists

**Authentication core: built, and genuinely centralised.** Supabase Auth is the single credential
store for every workspace including Practice — `SignInForm.tsx` header: *"this signs into the same
Supabase auth as every other workspace; what makes it 'Practice' is the destination routing, not the
credential store"* (IAM-ADR-01). The spec's core premise is already satisfied.

**Token refresh: built.** `src/proxy.ts` — Next 16 renamed `middleware.ts` to `proxy.ts`, which is
why a `middleware.ts` search comes back empty. It calls `supabase.auth.getUser()` on every matched
request (line 59) purely to refresh, and correctly re-derives headers *inside* `setAll` so a
refreshed session is not dropped. Matcher covers everything but static assets. Cookies are `HttpOnly`
and `Secure` via `@supabase/ssr`.

**Server-side session validation: built**, per request, in `resolvePracticeShell` (8 ordered guards).

**Device management: built for `/practice` only, and currently broken (§0.2).** `practice_session`
carries `device_id, device_label, user_agent, trusted, first_seen_at, last_seen_at, revoked_at,
revoked_by, revoked_reason`, unique on `(workspace_id, user_id, device_id)`. Listing at
`security.ts:163-185` (deliberately strips `device_id` from output — "a list that showed it would be
a list of credentials"). Revoke at `:187-205`, trust/label at `:208-229`. UI at
`src/app/practice/(shell)/privacy/security/SecurityConsole.tsx`. The design explicitly refuses
fingerprinting in favour of a cookie the product set — a good decision that survives the fix.

**Idle logout: designed, configurable, and dead.** `practice_security_policy.session_idle_minutes`,
bounds 5 min–30 days, default `null`. Enforcement at `security.ts:133-143`, never reached (§0.2).

**MFA gate: built for `/practice` only, and fails open (§0.3.1).** `shell.ts:86-92`.

**Per-tenant policy: built for `/practice` only.** `practice_security_policy` with an audited update
path (`updateSecurityPolicy`, which records both old and new values).

## 1.2 What is genuinely missing

| Spec item | State |
|---|---|
| "Idle Lock: default 5 min inactivity → lock workspace" | **Absent everywhere.** No lock screen, no locked state. |
| "Idle Logout: default 30 min" | Practice-only, default off, and dead (§0.2). Absent platform-wide. |
| "Absolute Session Lifetime: default 12 hours" | **Absent.** Nothing anywhere caps total session age. |
| "Token Refresh every 20 minutes" | Refresh works, but the *interval is not this product's* — it is GoTrue's expiry. Not configurable per tenant. |
| "60-second warning before idle logout" / "'Stay Logged In' button" | **Absent.** Zero client-side session UX: `grep` for `onAuthStateChange`, `refreshSession`, `TOKEN_REFRESHED`, `visibilitychange`, `idleTimer`, `autoLogout` returns **nothing** across the whole repo. |
| "Resume from lock with PIN, biometrics, Windows Hello or device authentication" | **Absent.** No WebAuthn, no PIN. |
| "Restore exact workspace after unlock" | **Absent** (no lock to restore from). |
| **Clinical Pause Mode** — one-click pause, immediately hide patient information, resume to same patient | **Absent, entirely.** The single largest genuinely-new build in this spec. |
| "Activity Detection" — reset timer on typing/click/touch/scroll/navigation/save/API/upload/AI | **Absent.** Only server-side `last_seen_at` on page load exists. |
| "Trusted devices with configurable validity" | Trust flag exists; **no validity period**, no expiry. |
| "Remote logout of individual or all sessions" | Individual: practice-only and broken. **All sessions: absent** — no `signOut({scope:'global'})` anywhere. |
| "Overrides by tenant, organization, product, role and user" | Only workspace-level, practice-only. No product/role/user axis. |
| "Audit all login, logout, lock, unlock, refresh and timeout events" | **0% built** (§0.5). |
| "CSRF protection" | **Absent** (§0.6). |
| "Configurable browser-close behavior" | **Absent.** |
| "Shared engine consumed by all Competen applications" | Not a package; practice-only code in `src/lib/practice/`. |

## 1.3 Where the spec's control exists but is broken or weaker than claimed

§0.2 (device register / idle timeout / remote logout), §0.3.1 and §0.3.2 (MFA fail-open twice),
§0.3.3 (unchecked revoke), §0.5 ("session timeout" and "every sign-in recorded" advertised).

## 1.4 Blast radius

The **session engine, lock screen and Clinical Pause Mode are client-side and would wrap every
workspace**, not one. Concretely:

- `src/app/layout.tsx` — the only place a global idle/lock provider can mount.
- `src/proxy.ts` — the only correct place to plant a device cookie (it can set response cookies;
  Server Components cannot).
- `src/lib/supabase/client.ts` — where an `onAuthStateChange` listener belongs.
- Every workspace layout that would need to render a lock overlay: `super-admin`, `platform-admin`,
  `hospital-executive`, `unit-manager`, `supervisor`, `healthcare-worker`, `quality-accreditation`,
  `competency-office`, `competency-studio`, `office-governance`, `human-resources`,
  `enterprise-governance`, `organisation-admin`, `admin`, `educator`, `assessor`, `dashboard`,
  `practice/(shell)`, `platform/control-plane`, `platform/staff`.
- `src/lib/practice/shell.ts` (49 callers of `resolvePracticeShell`), `src/lib/practice/security.ts`.
- `next.config.ts` for headers.
- New migration(s) for a platform-level session/device/auth-audit store.

Clinical Pause Mode additionally touches every patient-data surface in `/practice` **and** in
`healthcare-worker`, `supervisor` and `unit-manager` (patient operations), because "immediately hide
patient information" is a claim about rendered DOM, not about a route.

---

# 2. COMP-IDENTITY-001 — Identity & Account Management Engine

## 2.1 What already exists

**Single identity across products: built and already true.** One Supabase `auth.users`; Practice and
every workspace share it.

**Account lifecycle: substantially built, at platform level.**
`src/app/api/super-admin/users/actions/route.ts` implements `suspend` / `unsuspend` / `send_reset` /
`resend_invite`. Suspension uses GoTrue's real ban mechanism (`ban_duration: "876000h"`), not a
status flag — the file says so and it is correct. Self-suspension is refused. Every action writes to
`audit_log`. Deletion exists at `src/app/api/super-admin/users/route.ts:117`.

**Multi-tenancy: built, and messier than the spec imagines.** `hospitals` (11 rows), `tenants`,
`departments` (15). `organizations` **does not exist** (verified by GET, not HEAD — the missing-table
trap). Practice has its own parallel tenancy: `practice_workspace` (3) / `practice_membership` (6).

**Roles & permissions: two disjoint systems, both live.**
- Platform: a string on `profiles`. Live histogram over 47 profiles:
  `nurse 36, hospital_admin 4, super_admin 3, educator 3, assessor 1`.
- Practice: a real RBAC catalogue — see §2.5.

**Cross-organisation membership: built for Practice only.** `practice_membership` is many-to-many
over `(workspace_id, user_id)`. `profiles.hospital_id` is a single scalar, so the *platform* side is
one-tenant-per-user.

**Trusted devices: §1.1** (practice-only, broken).

**Profile management:** `profiles` already carries `full_name, email, phone, avatar_url, country,
specialization, staff_number, employment_type, position_id, unit_id, department_id, line_manager_id,
is_senior_assessor, account_status`.

**Audit: built.** `audit_log` (378 rows) platform-side, `practice_audit_event` (2,480) practice-side.

**Invitations:** `practice_invitation` exists (0 rows); `invitations` does not.
`resend_invite` uses `auth.admin.inviteUserByEmail` with a recovery-email fallback.

**`practice_last_owner_guard`:** present in the practice lifecycle layer, protecting against removing
the last owner of a workspace.

## 2.2 What is genuinely missing

| Spec item | State |
|---|---|
| "One user may belong to multiple organizations and teams" | Practice: yes. Platform: **no** — `profiles.hospital_id` is scalar. |
| **Teams** (a first-class concept in the Identity Model list) | **Absent.** No teams table on either side. |
| **Licenses & Subscriptions** in the identity model | Practice has entitlements; **no platform-wide licence model**. |
| "Identity is independent of product subscriptions" | Contradicted today: the platform's *identity* row carries a clinical role. |
| Roles: "Organization Administrator", "Manager", **"Custom roles"** | **Absent.** Practice has 5 fixed roles, no custom-role authoring. |
| "Registration → email/phone verification" | **Email verification is OFF** (`mailer_autoconfirm: true`). Phone: `external_phone: false`. The practice signup route's "check your email to confirm" branch (`api/v1/practice/signup/route.ts:106-118`) is **dead code** — a session is always returned. |
| "Organization join request" | **Absent.** No request/approve flow. |
| "Deletion with retention policy" | Delete exists; **no retention policy**. `securityPosture()` already lists "How long data must be kept" under `notKnowableFromHere`. |
| "Passkeys/WebAuthn roadmap" | Absent (the spec says roadmap). |
| "OAuth2/OpenID Connect/SAML SSO" | **Absent.** `external_email` only; no social or enterprise provider configured. |
| "Tenant-level branding" | Absent. |
| "Track … login, device registration" in audit | Absent (§0.5). |

## 2.3 Where the spec's control exists but is broken or weaker than claimed

- **§0.1 is a COMP-IDENTITY-001 finding above all.** "Registration" is the section whose
  implementation hands out `super_admin`.
- **The identity model has already fragmented, badly.** `profiles` live columns include
  **`role`, `roles`, `org_role`, `org_roles`, `platform_role`, `platform_roles`** — six overlapping
  role columns — plus **`hospital_id`, `organisation_id`, `tenant_id`** — three overlapping tenant
  columns. Different gates read different ones. COMP-IDENTITY-001's "single identity model" is the
  right instinct, and this is the concrete debt it would have to pay off. Any consolidation here is
  a lockout risk (§6.2).
- **"Multi-tenant isolation enforced"** (an acceptance criterion) is not currently enforced *by the
  database* for platform tables — see §0.4. It is enforced by `api-auth.ts` on the 219 routes that
  use it, and not at all on the 93 that don't or the 576 server components.
- ⚠ **`profiles.account_status` is enforced nowhere, and the two suspension mechanisms do not know
  about each other.** The column (migration 052, values `active|invited|suspended|deactivated|left`,
  **no timestamps** — you cannot ask *when* or *by whom*) has 25 references in `src/`, and I traced
  every one: all are display or dashboard-aggregation reads
  (`lib/profile-identity.ts`, `lib/super-admin/sys-identity.ts`, `sys-soc.ts`, `system.ts`,
  `lib/enterprise/{facilities,organisations,people}.ts`). The single write is
  `src/app/api/enterprise/people/route.ts:37,50`. **No auth path, proxy or workspace gate reads it.**
  So: setting a user to `deactivated` via the enterprise API changes what dashboards show and
  **does not stop them signing in**; and the super-admin ban that genuinely does stop them
  (`ban_duration`) **never updates the column**, so a banned user still reads `active` everywhere.
  Two sources of truth, drifting, and the column is the one a reader would trust.
- **There is no user delete** — no `deleted_at`, no soft delete, no hard-delete route on `profiles`
  (the super-admin route deletes the auth login and competency records, not a lifecycle state).
  COMP-IDENTITY-001's "Deletion with retention policy" has neither half.
- **Practice-workspace lifecycle is the one place this is done well** — migration 247's
  `practice_lifecycle_transition` (append-only) plus the archive/suspend/restore capabilities, and
  it deliberately refuses to add delete, naming why (anonymisation undefined, authorization
  unnamed, no email channel to confirm with). Its warning is worth carrying forward: *"THE
  DESTRUCTIVE VERB ALREADY WORKS"* — `scripts/practice-pilot-gate.ts` calls
  `practice_workspace.delete()` and 111 cascade FKs across 113 tables fire off that row.
- **`practice_invitation` codes are plaintext bearer credentials with no immutability trigger**, and
  `invited_email` is explicitly *not* an authority (the migration says enforcing a match "would be
  theatre" because `getCaller` carries no verified email for a practice-only user). Anyone holding
  the code can redeem it as anyone. Documented and deliberate — but it is the weakest link in
  COMP-IDENTITY-001's "Administrator invitation" path, and worth revisiting once email works.

## 2.4 Blast radius

`supabase/schema.sql` + a new migration (`profiles`, tenancy join table, teams, custom roles);
`src/lib/api-auth.ts` (`getCaller`, `inScope`, every `assert*`); `src/lib/supabase/server.ts`;
**every one of the ~20 workspace layouts listed in §1.4**, because each re-derives roles from
`profiles`; `src/app/api/auth/{login,signup,switch-role}`; `src/app/api/super-admin/users/*`;
`src/lib/platform/landlord.ts`; `src/lib/ogs/office` (appointment-based access on CMO/QAW/HEX);
`src/lib/practice/{access,shell,team}.ts`. This is the widest-reaching of the three.

## 2.5 Capability codes — probed live, do not trust any count

I queried `practice_role_capabilities` directly. **The brief's "43+" and any figure in the documents
are both wrong.**

- **47 distinct `capability_code` values**, across **5 roles**, in **82 role→capability rows**.
- Roles: `practice_owner`, `practitioner`, `practice_assistant`, `billing_reporting`,
  `read_only_auditor`.
- Cross-check against `practice_role_assignment` (171 live grants): **47 codes assigned, 0 orphans,
  0 catalogue entries never assigned.** The catalogue and the grants agree exactly — no invented
  codes are in play right now.
- Independently confirmed by static count of the seed `INSERT`s across migrations 191–200, 202,
  239, 246, 247, 248: **82 `(role_code, capability_code)` rows, 47 distinct codes**, matching the
  live probe exactly. Per role: `practitioner` 41, `practice_assistant` 21, `practice_owner` 16,
  `billing_reporting` 2, `read_only_auditor` 2. Migration 247's own "43 codes were seeded before
  this file" is correct (43 + 4 new in 247 = 47; 248 added none).
- One thing static analysis flags that the live probe clears: migration 239 seeded
  `pathway.design/assign/view` into the catalogue **without** the `practice_role_assignment`
  backfill, so pre-239 workspaces would hold them as catalogued-but-granted-to-nobody. **In the live
  database all 47 are assigned**, so the three live workspaces are unaffected — but the migration is
  still wrong for any workspace restored from an older snapshot, and 247's repair explicitly filters
  those three codes out.
- Structural gap: `practice_role_capabilities` has **no FK** tying `role_code` to the CHECK set on
  `practice_membership.role_code`. The catalogue can name a role no membership may hold.

Full live catalogue:

```
access.review          appointment.manage     comm.record            data.export
diagnosis.record       document.author        document.sign          document.view
encounter.create       encounter.edit         encounter.list         encounter.sign
followup.manage        followup.view          inbox.record           inbox.review
message.use            pack.install           parameter.configure    parameter.record
parameter.view         pathway.assign         pathway.design         pathway.view
patient.create         patient.edit           patient.list           patient.merge
patient.view           practice.archive       practice.calendar.view practice.home.view
practice.lifecycle.view practice.locations.manage practice.members.manage practice.restore
practice.settings.manage practice.suspend     procedure.manage       procedure.record
queue.manage           report.view            search.use             task.manage
task.view              template.manage        treatment.record
```

**Codes these three specs would need that do not exist.** None of the three names a capability code
(they contain no code-like identifiers at all), so this is derived from the functions they demand:

- COMP-AUTH-001 "Administration → Overrides by tenant…": `practice.settings.manage` already covers
  the practice security policy. **No new code needed for the practice scope.**
- COMP-AUTH-001 device management: the existing model has no code — `listSessions`/`revokeSession`
  are reached through the security console. If sessions become an administrable surface,
  `session.view` / `session.revoke` would be new. `access.review` is the nearest existing fit and
  arguably already covers viewing.
- COMP-IDENTITY-001 custom roles / teams / invitations: `role.manage`, `team.manage`,
  `member.invite` would all be new. `practice.members.manage` covers membership today.
- COMP-SEC-001 break-glass: already covered — the mechanism exists and is not capability-gated (it
  is deliberately self-granted).

⚠ **The platform side has no capability catalogue at all.** Every non-practice workspace gates on a
role string. Any capability model COMP-IDENTITY-001 implies for the platform is greenfield, not an
extension of the 47.

---

# 3. COMP-SEC-001 — Competen Platform Security Framework

## 3.1 Verdict first: this one is mostly prose

**Of its 41 bullets, I count 9 that describe code this repo could write, 13 that are satisfied by
COMP-AUTH-001 or COMP-IDENTITY-001 (it says so itself — "Shared authentication engine
(COMP-AUTH-001)"), 11 that are infrastructure/deployment facts outside the application, and 8 that
are process commitments about how humans work.** It is a governing charter that composes over the
other two. The brief's suspicion is correct.

The application already holds this position explicitly and well.
`src/lib/practice/security.ts:528-541` refuses to render a security score, compliance badges, or an
encryption claim, on the grounds that *"security is not a quantity"* and that encryption and
residency *"describe a deployment this application does not inspect"*. `securityPosture()` returns a
`notKnowableFromHere` array. **COMP-SEC-001 asks for several things that function already declares
unknowable** — see §3.4.

## 3.2 What already exists

Identity & Authentication (delegated), RBAC (practice: 47 codes; platform: role strings), custom
roles (absent), **break-glass with mandatory audit — fully built** (`security.ts:350-526`:
read-capabilities only, 10-character minimum reason enforced in code *and* the database,
time-boxed, three-way logged, self-review refused, never ages off the review list — this is the
strongest control in the codebase), **immutable audit log** (`practice_audit_event` append-only,
`practice_access_log` immutable), TLS (Supabase-provided), parameterised queries (PostgREST
throughout — no raw SQL string-building found), input validation (per-engine, `EngineResult`
pattern), configurable retention (practice-level only).

## 3.3 What is genuinely missing

CSP · XSS mitigation headers · CSRF · failed-login thresholds and account lockout · alerting for
suspicious logins · comprehensive API request logging · key rotation and secrets management ·
consent management **at platform level** (Practice has a full `practice_consent` engine —
record/withdraw/never-delete/derived-expiry — the platform has none) · regional data residency ·
network segmentation · WAF · vulnerability scanning · patch management · DDoS protection · backup /
DR / RPO / RTO · dependency scanning · secret scanning · SAST/DAST · mandatory code review.

## 3.4 Where the spec is weaker or wrong for this codebase

⚠ **Several COMP-SEC-001 bullets, if implemented as UI, would re-introduce claims the codebase has
already deliberately refused.** "Encryption at rest", "Encrypted object storage", "Regional data
residency support" are properties of a Supabase project and a deployment; this application cannot
observe them. If they must appear, they belong in a deployment attestation document, **not** in a
`securityPosture()` field — that function's `notKnowableFromHere` array already names three of them
by name. Building them as product claims would be a regression against a decision already taken and
well argued.

Also: the acceptance criterion "**No plaintext secrets**" — I did not audit secret handling in depth,
but `.env.local` holds `SUPABASE_SERVICE_ROLE_KEY` and 2 files read it directly
(`src/lib/supabase/server.ts:8` and `src/app/api/auth/signup/route.ts:54`, the latter constructing
its own client rather than reusing the helper). No secret scanning is configured.

## 3.5 Blast radius

Genuinely small for the buildable parts: `next.config.ts` (headers), `src/proxy.ts` (CSRF origin
check, request logging), the auth routes (lockout), one migration for a platform auth-audit table.
The rest is CI configuration (`dependency scanning`, `secret scanning`, SAST) and infrastructure —
no application files.

---

# 4. Dependency order, from the documents' own text

The documents state it themselves and agree with each other:

1. **COMP-IDENTITY-001 is the base.** Its Implementation Order begins "Identity model, Organization
   engine, Memberships, Role engine" — the objects the other two act on. Its own
   "Authentication Integration" section defers outward: *"Integrates with COMP-AUTH-001."*
2. **COMP-AUTH-001 sits on it.** Its Implementation Order is "1. Authentication core, 2. Session
   engine, 3. Lock screen, 4. Token rotation, 5. Device manager, 6. Audit service, 7. Admin security
   settings, 8. Clinical Pause Mode" — every item after (2) presumes an identity to attach a session
   to, and (7) presumes the tenant/org/role axes COMP-IDENTITY-001 defines.
3. **COMP-SEC-001 composes over both.** It names COMP-AUTH-001 as a dependency in its
   "Identity & Authentication" section (*"Shared authentication engine (COMP-AUTH-001)"*), and its
   Implementation Roadmap opens with "Authentication & Sessions, Authorization" — i.e. the other two
   documents — before reaching anything of its own (Encryption, Audit, Monitoring, Compliance, DR).

**So: IDENTITY → AUTH → SEC.** Note this is *not* my recommended build order (§7) — the security
fixes cut across all three and must go first.

---

# 5. Navigation — what the text actually says

⚠ **All three documents are silent on navigation. None contains a sidebar, a menu, an information
architecture, a route list, or a screen inventory.** There is nothing to quote, because there is
nothing there.

The closest any of them comes to a surface:

- COMP-AUTH-001, *Administration*: "Global defaults." / "Overrides by tenant, organization, product,
  role and user." — implies an admin settings surface, names no location.
- COMP-AUTH-001, *Implementation Order*, item 7: "Admin security settings" — again a surface without
  a home.
- COMP-IDENTITY-001, *Implementation Order*, final item: "Administration" — one word.
- COMP-SEC-001 names no surface at all.

**No comp was supplied with any of the three, and none was consulted.** The live nine-item Practice
sidebar is untouched by these specs. The existing homes for what they describe already exist and
should absorb any new surface: `/practice/(shell)/privacy/security` (the security console),
`/practice/(shell)/setup/*`, `/super-admin/system/*`, `/super-admin/governance/*`. **No navigation
change is required by any of the three**, and I would treat a proposal to add one as unsupported by
the text.

---

# 6. ⚠ What would lock people out if built wrong

`practice_sign_in` and `practice_public_signup` are **ON**. There are live users. Every item below
can make the product unenterable.

## 6.1 The §0.1 fix — safe, and the exception to the rule

Adding an allow-list inside `handle_new_user()` **cannot lock out an existing user**: the trigger
only fires on *new* `auth.users` rows. Existing profiles are untouched. This is the one change here
with essentially zero lockout risk, which is another reason it should go first.

Safe increment: clamp the role to a fixed allow-list inside the function, keep `'nurse'` as the
fallback for anything unrecognised, and add `set search_path = public, pg_catalog`. Do **not** at the
same time try to remove the `exception when others then return new` swallow — that is a separate,
riskier change (a hard failure there would break signup entirely). Then turn `mailer_autoconfirm`
back on for verification separately, as its own decision (§8).

## 6.2 ⚠⚠ Consolidating the six role columns on `profiles` — the biggest lockout risk in the survey

`role`, `roles`, `org_role`, `org_roles`, `platform_role`, `platform_roles`. Roughly 20 layouts and
`api-auth.ts` read some subset. Dropping or renaming any of them **signs everybody out of every
workspace at once**, and because the gates render "Access restricted" rather than redirecting, the
symptom would be a wall of locked screens with no route back.

Safe increment: **read-side unification only, no column drops.** Introduce one resolver
(`resolveIdentity(userId)`) that reads all six with the current precedence, point the layouts at it
one at a time, and prove equivalence for all 47 live profiles before removing anything. Removal is a
separate change, much later, behind a verified-empty check on each column.

## 6.3 ⚠⚠ Making MFA fail closed (§0.3.1 / §0.3.2)

Correct, and it will lock out anyone who is `mfa_required` and not enrolled — and **there is no
enrolment UI anywhere.** `grep "auth.mfa."` returns exactly one hit in the whole repo:
`shell.ts:88`. `/practice/access-status` tells an MFA-blocked user to "add an authenticator to your
account" — **there is no page that does that.** Today only one workspace has a policy row and MFA is
off, so nobody is affected; the moment someone switches it on with the fail-open fixed, they lock
themselves and their whole practice out with no recovery path.

Safe increment, strictly in this order: (1) **build the enrolment page first** — `mfa.enroll`,
`mfa.challenge`, `mfa.verify`, and unenrol; (2) route `MFA_REQUIRED` to it instead of to a dead-end
status page; (3) only then make the check fail closed; (4) only then let anyone set
`mfa_required = true`. Never ship (3) before (1).

## 6.4 ⚠⚠ Fixing the device cookie (§0.2)

This is the fix that makes the idle timeout and device revocation *start working* — which is exactly
why it is dangerous. Today `session_idle_minutes` is `null` on the one live policy row, so nothing
changes on day one. But any workspace that later sets it will find the control real for the first
time, and a short value locks a whole practice out on the next page load with a 30-second window.

Safe increment: plant the cookie in `src/proxy.ts` (the only place that can set a response cookie
correctly) and **land that alone**. Confirm `practice_session` row growth flattens and one stable
`device_id` per browser appears. Then, separately: clear the 13k orphan rows, then re-validate that
revocation works end to end, then consider enabling an idle policy — with a floor well above 5
minutes and the 60-second warning from COMP-AUTH-001 built *first*.

## 6.5 ⚠⚠ Absolute session lifetime (12 h) and idle logout (30 min), platform-wide

COMP-AUTH-001's headline defaults. Applied globally they would sign out every user of every
workspace on a fixed schedule, including mid-form. Applied via GoTrue's JWT/refresh settings they are
**not reversible per user** and take effect for everybody at once.

Safe increment: implement as a **client-side warning that does nothing** first — measure how often
users would have been logged out, over a fortnight, before enforcing anything. Then enforce
idle-logout only, at 30 min with the 60-second warning and a working "Stay Logged In". Leave the
absolute 12-hour lifetime last, and never set it below the length of a clinical shift.

## 6.6 ⚠ The lock screen and Clinical Pause Mode

A lock overlay that cannot be dismissed is a lockout by construction. The spec's resume methods
(PIN, biometrics, Windows Hello) do not exist here, so the only real resume is a password re-entry —
and if the session has *also* expired underneath the overlay, the user is stuck behind a lock screen
that cannot authenticate. Safe increment: password re-entry only, with an always-available
"Sign out and start again" escape on the overlay itself, and never lock while an unsaved clinical
form is open.

## 6.7 ⚠ Enabling email confirmation

Flipping `mailer_autoconfirm` off is correct for COMP-IDENTITY-001 but **immediately blocks every
new signup until email delivery is proven working**, and `/practice` self-service signup is live.
Safe increment: verify the mailer end-to-end in a staging project first; note that
`api/v1/practice/signup/route.ts:106-118` already contains the correct handling for the
no-session case, so the code is ready — only delivery is unproven.

## 6.8 ⚠ CSP and CSRF

A strict CSP breaks inline styles/scripts and can white-screen the app; a CSRF check that rejects a
legitimate `Origin` blocks every write. Safe increment: ship CSP in **`Content-Security-Policy-
Report-Only`** first and read the reports; ship the CSRF origin check as **log-only** first. Neither
should go straight to enforcing. `X-Frame-Options`, `Referrer-Policy`, `X-Content-Type-Options` and
HSTS carry no such risk and can go enforcing immediately.

---

# 7. Recommended build order — the user's "feasibility and best results"

## Classification

| Spec | Verdict |
|---|---|
| **COMP-AUTH-001** | **Split.** ~50% already built (auth core, token refresh, server-side validation, per-tenant policy, device model) but with the broken parts of §0.2/§0.3 inside it. The remaining ~50% — lock screen, activity detection, warning UX, absolute lifetime, Clinical Pause Mode, auth audit — is a **genuine build**, and it is client-side and platform-wide. |
| **COMP-IDENTITY-001** | **Mostly-already-built, verify and close gaps — with one critical hole.** Identity, lifecycle, tenancy, RBAC, audit and invitations all exist in some form. The genuinely new items are teams, custom roles, SSO, multi-tenant platform membership and join requests. But its "Registration" section is where §0.1 lives. |
| **COMP-SEC-001** | ⚠ **Mostly prose.** A governing/policy document that composes over the other two. ~9 of 41 bullets are application code, and 4 of those are one afternoon's work (headers). Most of the rest is CI configuration, infrastructure, and process. **Do not schedule it as a build.** Adopt it as the charter, and let it generate a short list of tickets. |

## The order

**Phase 0 — before anything else, and before any of the three specs (days, not weeks).**

1. ⚠⚠ **§0.1 AND §0.1b together — close both escalation paths in one migration.** The signup role
   allow-list inside `handle_new_user()`, **and** a `WITH CHECK` (or column-level revoke) on the
   `profiles` UPDATE policy. **Fixing either one alone leaves the platform fully open**, so they
   must land together. No lockout risk (§6.1). Everything else on this list is moot while an
   anonymous POST — or any signed-in nurse — can mint a `super_admin`.
2. **Pin `search_path` on the seven authorization-touching `SECURITY DEFINER` functions** (§0.6).
   Same migration, same reasoning, no behaviour change.
3. **§0.5 — delete the three false claims from `practice-site.ts`.** A one-line edit each. The
   product is publicly advertising lockout protection it does not have. Reinstate each line when the
   control ships.
4. **§0.3 — the three fail-open discards.** `shell.ts:88` and `security.ts:55/195`. Small, local,
   and the same class as `fc2de9a2` — worth doing while the pattern is fresh. ⚠ For the MFA one,
   read §6.3 first: fix the *discard*, but gate the *fail-closed* behaviour behind the enrolment page.
5. **Security headers** (§0.6). `next.config.ts` is empty. `X-Frame-Options`, `Referrer-Policy`,
   `X-Content-Type-Options`, `Permissions-Policy`, HSTS enforcing; CSP in report-only. Half a day,
   and it is the largest single COMP-SEC-001 deliverable.
6. **Turn RLS on for the six tables in §0.4b, and wire `plat_rls_registry()` into a CI harness.**
   All six are empty, so enabling RLS breaks nothing. The harness is what stops the seventh.

**Phase 1 — COMP-AUTH-001, the part that is already built and broken.**

5. **Plant the device cookie in `proxy.ts`** (§6.4), alone, and watch the row count flatten.
6. **Clean the 13k orphan `practice_session` rows**, then verify revocation end to end.
7. **The auth audit service** — `sign_in`, `sign_out`, `session_revoked`, `idle_timeout`. This is
   COMP-AUTH-001 item 6, it is genuinely absent, it has **zero lockout risk**, and it is the
   precondition for COMP-SEC-001's "alerting for suspicious logins" and for honestly restoring the
   "Every sign-in recorded" claim.
8. **Login rate limiting and lockout** — COMP-SEC-001's "failed login thresholds", currently
   advertised and absent. ⚠ Needs a decision (§8) because a lockout *is* a lockout.

**Phase 2 — COMP-AUTH-001, the genuine build.**

9. **MFA enrolment page first, then fail-closed** (§6.3, strict order).
10. **The client session engine**: one provider in `src/app/layout.tsx` — activity detection,
    `onAuthStateChange`, 60-second warning, "Stay Logged In". ⚠ Ship in warn-only mode first (§6.5).
11. **Lock screen**, password-resume only, with an escape hatch (§6.6).
12. **Clinical Pause Mode** last of this phase — it is the most distinctive thing in the three
    documents and the most valuable to clinicians, and it needs 10 and 11 underneath it.

**Phase 3 — COMP-IDENTITY-001, the genuine build.**

13. **Read-side identity unification** — one resolver over the six role columns, no drops (§6.2).
14. Teams · custom roles · platform-side multi-tenant membership · organisation join requests ·
    invitation flow · retention policy.
15. **SSO (OAuth2/OIDC/SAML)** last — it is the largest single item across all three documents and
    the one most dependent on everything above.

**Phase 4 — COMP-SEC-001 as a charter.** Adopt the principles; open tickets for dependency scanning,
secret scanning, SAST in CI; write the deployment attestation for the encryption/residency/DR claims
the application cannot make about itself (§3.4). ⚠ Also worth its own workstream: the RLS recursion
in §0.4, which is the one COMP-SEC-001 item that is both application-layer and serious.

## Smallest increment that delivers real value, per spec

- **COMP-AUTH-001:** the auth audit service (item 7). Absent, cheap, no lockout risk, unblocks two
  other controls, and turns a false public claim true. *Runner-up: the `proxy.ts` cookie fix, which
  repairs two dead controls in a few lines.*
- **COMP-IDENTITY-001:** the §0.1 + §0.1b pair. One migration. It is the whole registration and
  self-service security model, and today both halves are absent.
- **COMP-SEC-001:** the `next.config.ts` headers block. Half a day, no risk, and it is the single
  largest genuinely-missing application-layer item in that document.

---

# 8. Decisions needed before code

These are the MED-001-drug-database / LIFE-001-anonymisation equivalents. Each blocks a specific item
above.

1. ⚠ **Email confirmation: on or off?** `mailer_autoconfirm` is currently **true** — nobody verifies
   an address. COMP-IDENTITY-001's lifecycle *begins* with "Email/phone verification". Turning it on
   blocks new signups until the mailer is proven, on a live product (§6.7). **Your call, and it
   changes what §0.1's fix has to defend against.**
2. ⚠ **Lockout policy — the exact numbers, and the unlock path.** How many failures, over what
   window, locking for how long, and *who can unlock*. A lockout with no admin unlock route is a
   denial-of-service against your own users; a lockout an attacker can trigger on a known email
   address is a denial-of-service against a named clinician. There is no answer in any of the three
   documents.
3. ⚠ **Do COMP-AUTH-001's defaults apply to clinical workspaces unchanged?** 5-minute idle lock and
   30-minute logout are shoulder-surfing defaults from a shared-ward-terminal world. Against a
   clinician documenting an encounter they are hostile. The spec offers no per-product override even
   though its Administration section promises one. **Decide the clinical defaults before building
   the engine**, not after.
4. **Is the "shared engine" literally a package?** COMP-AUTH-001 says "consumed by all Competen
   applications (CP, AFCAN, Competen Platform)" and makes it an acceptance criterion. This repo is
   one application. Extracting `src/lib/practice/security.ts` into a publishable package is a
   different project from fixing it here. **Confirm this repo is the only consumer for now**, or the
   architecture changes.
5. **Which of the six `profiles` role columns is the survivor?** Needed before §6.2 can finish, and
   it is a product decision (platform role vs org role vs clinical role are genuinely different
   things that got flattened into one column).
6. **Do you want the RLS recursion fixed, or is service-role-plus-`api-auth.ts` the accepted
   architecture?** (§0.4.) Fixing it is a large migration touching `profiles`, `hospitals`,
   `assessments`, `competency_scores` policies. Accepting it is defensible — but then COMP-SEC-001's
   "RBAC enforced platform-wide" needs rewording, and the 93 routes that skip `getCaller()` become
   the priority instead.
7. **Retention periods.** COMP-IDENTITY-001 wants "deletion with retention policy" and COMP-SEC-001
   "configurable data retention". `securityPosture()` already lists this as unanswered: *"How long
   data must be kept — a legal question per jurisdiction, still unanswered."* It is a legal answer,
   not an engineering one, and it is still needed.
8. **Which suspension mechanism wins — `profiles.account_status` or the GoTrue ban?** Today both
   exist, neither knows about the other, and only one works (§2.3). COMP-IDENTITY-001 lists
   Suspension/Reactivation/Deactivation as three distinct lifecycle states, which the current
   single-column-no-timestamps model cannot represent. **Decide the state machine before writing
   the engine**, and decide whether `account_status` becomes a projection of the ban or the ban
   becomes a projection of it.
9. **Do you want the unnumbered SQL files folded into numbered migrations?** (§0.6, last bullet.)
   The §0.1b policy lives in one of them, so the fix has to touch that layer regardless. Folding
   them in makes the repo rebuildable; leaving them makes every future schema audit unreliable.
   Not a security decision by itself, but it gates how §0.1b is written.
