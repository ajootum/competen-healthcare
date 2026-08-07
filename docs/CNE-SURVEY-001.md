# CNE-SURVEY-001 — Survey of PCS-CAP-001 and CNE-001..004 v2

Survey only. No code, no migrations, no file changed except this one. Date: 2026-08-07.

Companion to `docs/COMP-SECURITY-SURVEY-001.md`, which this report cites as **[SEC]**.

---

## 0. Provenance and shape

Five documents, all distinct (MD5s differ), extracted from `~/Downloads`.

| Document | Extracted lines | Bytes | Numbered sections |
|---|---|---|---|
| PCS-CAP-001 Platform Capability & Activation Framework v1.0 | 114 | 3,655 | 17 |
| CNE-001 v2 Communications & Notifications Engine | 85 | 2,975 | 15 |
| CNE-002 v2 Email Capability | 70 | 2,417 | 12 |
| CNE-003 v2 Authentication & OTP Capability | 83 | 2,395 | 13 |
| CNE-004 v2 Messaging Capabilities | 61 | 2,294 | 11 |

Unlike the COMP-* set surveyed on 2026-08-07, **these five do number their own sections**, so every
`§n` below is the document's own. They are still short — 2–4 KB each, bullet lists under headings.
There is no data model, no API surface, no acceptance-test detail beyond a tick list, and (with one
exception noted in §7) no numbers.

The four CNE documents are near-identical in skeleton: Executive Summary → Business Purpose →
Capability Metadata → Managed Capabilities → Architecture/Provider Abstraction → Lifecycle →
Activation Workflow → Feature Flags → Operations Workspace → Health → Tenant Configuration →
Security → Acceptance Criteria → Related Specifications. That skeleton is PCS-CAP-001 §15's
"Standard Template for All Future Specifications", applied. They are a conforming set, not four
independent specs.

**No comp was consulted for any finding in this report.** Where the brief cited comp content, §7 and
§9 correct it against the text.

---

# 1. ⚠ THE HEADLINE FINDING

## 1.1 PCS-CAP-001 is **not** already implemented under another name — but six of its parts are, separately, under six different names

The brief's hypothesis was the right one to test. The answer is a qualified no, and the qualification
is the useful part.

**There is no capability registry.** Probed live and by grep:

```
probe platform_capabilities : MISSING     probe capability_registry  : MISSING
probe plat_capabilities     : MISSING     probe plat_service_registry: MISSING
probe cne_capability        : MISSING     probe plat_health_checks   : MISSING
```

`grep -ri "capability manager|capability registry|capability_registry|platform_capabilit|plat_capabilit"`
across every `.ts/.tsx/.sql/.md` in the repo returns **zero matches**. `health_check` returns zero
hits in `src/` and in `supabase/migrations/`. `edition` returns zero hits in `src/`. Nothing anywhere
uses the eight-state lifecycle — `PLANNED` is not a status value in any table, and is twice
*explicitly rejected* in prose (`supabase/migrations/197-practice-procedures.sql:113` "There is no
PLANNED"; `src/lib/practice/procedure-constants.ts:4` "THERE IS NO 'PLANNED' HERE.").

**But the machinery PCS-CAP-001 asks for exists, scattered across six subsystems with six different
vocabularies:**

| PCS-CAP-001 asks for | Already exists as | Where | Verdict |
|---|---|---|---|
| §9 Feature flags, per-scope | `plat_feature_flags` + `plat_feature_flag_assignments` + `flagEnabled()` resolver + UI | mig **042** (LCP-001 §9); `src/lib/platform/feature-flags.ts`; `src/app/platform/control-plane/feature-flags/page.tsx` | Real engine. ⚠ **Zero gating callers** — see §1.2 |
| §6 Registry, authoritative inventory | `configuration_registry_objects` (WCE-002) | mig **092**; `src/lib/config/registry.ts`; `/super-admin/platform-ops/registry` | Right shape, wrong subject (config objects, not capabilities) |
| §4 Lifecycle with governed transitions | `configuration_registry_objects.status`, 9 values: `draft, technical_review, product_review, safety_review, approved, published, active, deprecated, retired` | mig 092:19-20 | A *governance* lifecycle, not an *activation* one. Different vocabulary, overlapping intent |
| §8 Activation Framework (7 ordered steps) | `configuration_releases` — validate → approve → publish → activate (NCP-019) | mig **099**; `/super-admin/platform-ops/releases` | The workflow pattern exists, for config releases |
| §7 Dependency Management | `configuration_registry_objects.dependencies` jsonb + cycle/broken-ref detection (NCP-017) | `src/lib/config/dependency-graph.ts`; `/super-admin/platform-ops/dependencies` | Graph exists; **no health gate** on transitions |
| §12 Licensing by edition | `plat_plans.entitlements` jsonb + `plat_products` + `tenant_product_licenses` + PCS-PORT-001 | mig 042, 105; `/super-admin/platform-ops/licensing`, `.../portfolio` | Plans, not editions — see §9.4 |
| §7 "cannot transition to READY unless dependencies are healthy" | `service_profiles` + `loadActivationReadiness()` → `ready \| conditional \| not_ready` (CGR-028) | mig **151**; `src/lib/cgr/activation.ts` | The **exact gate pattern**, in the wrong domain (clinical staffing) |

**So the honest reading of PCS-CAP-001 is: it is a unification spec for six subsystems this codebase
already built separately, not a greenfield framework.** That reframing is worth more than any
percentage. Note also that **PCS-PORT-001 already exists here** (`/super-admin/platform-ops/portfolio`,
hub module #13) — the `PCS-*` series is one the codebase already recognises, and PCS-CAP-001 is its
sibling.

### 1.2 ⚠ The feature-flag engine is real and nothing uses it

This is the single most consequential thing found about PCS-CAP-001.

`src/lib/platform/feature-flags.ts:10` implements a correct precedence resolver:

```ts
// Resolves scope precedence: tenant > cohort > plan > country > global assignment > flag default.
export async function flagEnabled(admin, key, ctx: FlagContext = {}): Promise<boolean>
```

It is fail-closed (`catch { return false }`), it is backed by a real scope enum
(`scope_type in ('global','tenant','country','plan','cohort')`, mig 042:98-106), and it has a
working admin UI with per-scope assignment chips.

**`grep -rn "flagEnabled" src/` finds no caller.** The only hit outside the module itself is a
documentation string rendered on the flag page. And the live database says the same:

```
plat_feature_flags:             5 rows  (simulation_engine, executive_intelligence,
                                          ai_copilot, clinical_operations, marketplace)
plat_feature_flag_assignments:  0 rows
```

Nothing in the application gates behaviour on a platform flag. The five keys are a catalogue nobody
reads. Separately, `practice_platform_flags` (mig 191, three columns: `flag/enabled/note`) *is* read,
by `platformFlag()` in `src/lib/practice/provisioning.ts:125` — but it is a three-row launch ladder,
not a capability model. **Two flag systems; only the smaller, dumber one is consulted.**

Live launch-flag state (changed since [SEC] was written):

```
practice_pilot_provisioning : true
practice_sign_in            : true
practice_public_signup      : FALSE   (was ON when [SEC] was written; now off)
```

Minor find: `PATIENT_BOOKING_FLAG = "practice_patient_booking"`
(`src/lib/practice/patient-access-constants.ts:84`) is read by `patient-access.ts:232` but **no such
row exists** in the three-row table, so it resolves false by absence. Fail-safe, but it is a flag
that can never be turned on through the flags API, whose allow-list names only the other three
(`src/app/api/v1/practice/flags/route.ts:20-24`).

## 1.3 ⚠ THE ARCHITECTURAL QUESTION — the machinery is **not** only inside `/practice`

The brief framed the biggest decision as "must migration 224's adapters be lifted out of
`src/lib/practice/` into a platform service?" **The premise is wrong, and the truth is more
awkward.** There are already **two independent messaging stacks**, and the platform one is the
bigger of the two.

| | Practice stack | Platform stack |
|---|---|---|
| Code | `src/lib/practice/messaging.ts` (592 lines) | `src/lib/notifications/dispatch.ts` (+ `framework.ts`, `notify.ts`) |
| Migrations | **224** (`practice_message_channel`, `practice_message`, `practice_otp_challenge`) | **029** (`notifications`), **056** (`notif_deliveries`), **161** (framework, `notification_preferences`) |
| Channels | `sms`, `email` only (CHECK-constrained) | `in_app, email, sms, webhook, teams, slack` |
| Email provider | Resend, via `RESEND_API_KEY` + **`RESEND_FROM`** | Resend, via `RESEND_API_KEY` + **`NOTIFY_FROM_EMAIL`** |
| SMS provider | Twilio (`TWILIO_FROM`) **and** Africa's Talking | Twilio (`TWILIO_FROM_NUMBER`) — **stub**: `error: "sms adapter pending"` |
| Consent | `practice_patient_consent`, `require_consent` default **true**, full refusal ladder | **None** |
| Rate limiting | Per-destination 5/hr, fail-closed | None |
| Templates | 6 hard-coded purposes | None — sends `n.title` / `n.body` verbatim |
| Audit | `practice_message` row per attempt + `practice_audit_event` | `notif_deliveries` row per attempt |
| Live callers | **⚠ zero in `src/`** — only harnesses | **242** `notify()` call sites |
| Live rows | `practice_message_channel` = **0**, `practice_otp_challenge` = **0** | `notifications` = 36 |

⚠ **Latent deployment bug, independent of these specs:** the two stacks share
`RESEND_API_KEY`, `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` but use **different sender variables**
for the same identity — `RESEND_FROM` vs `NOTIFY_FROM_EMAIL`, `TWILIO_FROM` vs `TWILIO_FROM_NUMBER`.
A deployment that sets one set will have exactly half its email working, and
`messagingStatus()` will report the email channel *configured* while `channelProviders()` reports it
*not ready* — or vice versa. `messagingStatus()` reports configured on `RESEND_API_KEY` **alone**
(`messaging.ts:38-40`) and falls back to `"no-reply@example.invalid"` if `RESEND_FROM` is unset
(`messaging.ts:322`); `channelProviders()` requires both (`dispatch.ts:16`). **This should be
reconciled whether or not any CNE spec is built.**

**None of the five documents mentions either stack, `/practice`, or any existing table.** So the
answer to the architectural question, stated plainly:

> The work is **not** "lift practice code up to the platform". It is **reconcile two platform-scale
> stacks that already overlap**, then put one capability façade in front of the result. The cheap
> version keeps both tables and unifies only the adapter layer into `src/lib/comms/` behind the
> `EmailProvider` / `SMSProvider` interfaces CNE-001 §6 names. The expensive version merges
> `practice_message` and `notif_deliveries` into one delivery log — which is a migration touching a
> table with 242 upstream call sites.

**Recommendation: unify the adapter layer only.** The practice stack has the discipline (consent,
refusal ladder, rate limits, honest `handed_to_provider_at` rather than `sent_at`); the platform
stack has the reach. Lift `handOver()`'s three branches out as the shared provider layer, leave both
delivery logs where they are, and give the practice stack's consent/refusal ladder to the platform
stack as a second step. No table needs to move for CNE-001 §6 to be satisfied.

## 1.4 ⚠ By PCS-CAP-001's own rule, CNE-002 and CNE-004 cannot reach READY

PCS-CAP-001 §7: *"A capability cannot transition to READY or ACTIVE unless all mandatory dependencies
are healthy. Dependency validation occurs automatically during activation."*

CNE-002 §3 declares `Dependencies: Authentication, Template Engine, Scheduler, Queue Service`.
CNE-004 §3 declares `Dependencies: Template Engine, Scheduler, Queue Service, Identity Service`.
CNE-001 §3 declares `Depends On: Authentication, Scheduler, Template Engine, Queue Service`.

Of those five named dependencies:

- **Queue Service — does not exist.** Nothing polls `practice_message` or `notif_deliveries`. The
  `status: 'queued'` value on `practice_message` is a transient state written and updated inside one
  HTTP request (`messaging.ts:255` then `:262`). The only `*queue*` table is `practice_queue_entry`
  (mig 192) — a clinic waiting room. No retry, no backoff, no `next_retry_at`, no lock column.
- **Template Engine — does not exist as a service.** `messaging.ts:58-97` is a hard-coded
  `Record<string, {kinds, subject?, body}>` of six purposes. There are ~20 `*_template` tables in the
  migrations and every one is domain content (notes, follow-ups, tasks, reports); none is referenced
  by either messaging stack.
- **Scheduler — exists, unwired.** `vercel.json` has exactly two crons (`/api/cron/reports` daily
  06:00, `/api/cron/jobs` hourly), `CRON_SECRET`-gated, logging to `plat_job_runs` (**1,008 rows
  live**). Job definitions are in code, not a table. **Neither cron touches either messaging table**,
  so CNE-004's "Appointment reminders" and "Follow-up reminders" have no runner.
- **Authentication / Identity Service — exists** (Supabase Auth, `getCaller()`, `api-auth.ts`).

So three of the four CNE documents declare a hard dependency on two services that do not exist, and
the governing framework forbids activation without them. **Queue and Template are the real gate on
this whole spec set**, and neither has a spec.

---

# 2. CNE-001 — Communications & Notifications Engine

## 2.1 What exists

- **Provider adapters for three of six named providers.** `handOver()` (`messaging.ts:280-335`):
  Twilio (`api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json`, Basic auth, form-encoded),
  Africa's Talking (`api.africastalking.com/version1/messaging`, `apiKey` header), Resend
  (`api.resend.com/emails`, Bearer). 10-second `AbortController` timeout on all three. A fourth,
  independent Resend adapter in `dispatch.ts:29`, plus a generic webhook adapter.
- **An operations surface, partially.** `/super-admin/platform-ops/notifications` — a viewer plus a
  one-shot tester. Reads `notif_deliveries` (last 5,000 rows) and `notifications` counts; renders six
  KPIs including "Channels Ready n/6", 24h delivery/failed/skipped, in-app read rate; per-channel
  provider readiness table from `channelProviders()`. Sidebar item exists ("Notifications", 📨).
- **Delivery logging on both stacks**, with honest status vocabularies: `practice_message.status in
  ('queued','handed_over','failed','refused')` and `notif_deliveries.status in
  ('sent','queued','failed','skipped')`.
- **A notification framework** (mig 161 + `src/lib/notifications/framework.ts`, 215 lines): six
  categories, per-priority behaviour with `escalateAfterMin`, `CATEGORY_FLOOR`, `clampPriority()`,
  regex `type → category` inference over ~242 legacy types, `notification_preferences` table.
- **§13 Security, mostly satisfied.** API keys are server-side only (no `NEXT_PUBLIC_` provider key
  anywhere). Every send attempt is logged. Practice-side sends are additionally audited to
  `practice_audit_event`.

## 2.2 What is genuinely missing

| CNE-001 item | State |
|---|---|
| §4 `CNE.WHATSAPP` | **0%.** No adapter. WhatsApp appears only as (a) a log-only channel value `whatsapp_external` = "WhatsApp (from a phone, not this product)" and (b) a shareable-string builder (`identity-service.ts:572`) |
| §4 `CNE.PUSH` | **0%**, and worse than absent: `framework.ts` `BEHAVIOUR` maps `critical → channels: ["in_app","push","sms","email"]`, but `dispatch.ts`'s `Channel` union has no `"push"` member. That branch is unreachable |
| §4 `CNE.VOICE` | **0%** |
| §4 `CNE.TEMPLATES` | Hard-coded const, no table, no authoring, no per-tenant override |
| §5 Providers Infobip, Meta, Firebase | **0%** — named in the architecture diagram, referenced nowhere |
| §6 Provider *interfaces* (`EmailProvider`, `SMSProvider`, `WhatsAppProvider`, `PushProvider`) | **0%.** No interface, no registry, no adapter class. Three sequential `if` statements in one function. The only seam is an injectable `transport?: Transport` argument used by harnesses |
| §7 Capability lifecycle | **0%** (§1.1) |
| §8 Activation workflow | **0%** — channels are switched by `setChannel()` per practice; there is no dependency validation, no health check, no flag step, no capability status |
| §9 All five feature flags | **0%** — none of the five keys exists |
| §10 Capability Manager | **0%** — the notifications page shows status/provider/logs but no cost, no dependencies, no activation controls, no per-capability metrics |
| §11 Health: latency, cost, webhook status, template status | **0%.** `receiptsAvailable` is hard-coded `false` with the reason stated in code: *"NEITHER GATEWAY REPORTS DELIVERY WITHOUT A WEBHOOK THIS DEPLOYMENT DOES NOT HOST"* |
| §12 Per-tenant / per-practitioner | Per-**practice** only (`practice_message_channel`). No global, no tenant, no practitioner axis |

## 2.3 Verdict

**≈ 45% already built** — but as two disjoint half-engines that must be reconciled before the
remaining 55% has anywhere to attach. Of the nine `CNE.*` capabilities in §4: two are real
(`CNE.EMAIL`, `CNE.TEMPLATES`-as-a-const), two are half-real (`CNE.SMS` — adapters exist,
unconfigured, no caller; `CNE.OTP.*` — engine exists, no caller), one is a broken gate (`CNE.MFA`),
four are zero (`WHATSAPP`, `PUSH`, `VOICE`, and `CNE.TOTP` from CNE-003).

---

# 3. CNE-002 — Email Capability

## 3.1 What exists

Four working email paths, none of which knows about the others:

1. `messaging.ts` → Resend, consent-gated, template-closed, per-practice. **No production caller.**
2. `dispatch.ts:29` `sendEmail()` → Resend, no consent, no template. **242 upstream call sites.**
3. Supabase Auth transactional email: `admin.auth.admin.inviteUserByEmail()`
   (`api/super-admin/users/route.ts:84`, `.../actions/route.ts:41,45`),
   `admin.auth.resetPasswordForEmail()` (`.../actions/route.ts:33`), and client-side
   `supabase.auth.resetPasswordForEmail()` (`src/app/forgot-password/page.tsx:16`).
4. `notif_deliveries` records every attempt from (2) with `status`, `provider`, `address`, `error`.

Against §4's eight Supported Functions: **Password reset** ✅ (path 3), **Practice notifications** ✅
(path 2), **System alerts** ✅ (path 2), **Email OTP delivery** ⚠ engine only, **Appointment
confirmations / Follow-up reminders** ⚠ templates exist (`appointment_confirmation`,
`appointment_reminder`, `appointment_cancelled`), no caller and no scheduler, **Email verification**
❌, **Invoices & receipts** ❌.

§9 Tenant Configuration is genuinely satisfied at practice scope: `practice_message_channel` carries
`sender_name` and `sender_address`, and `setChannel()` refuses without a sender name
(`SENDER_REQUIRED`).

§10 Security: server-side keys ✅, audit ✅, rate limiting ✅ (OTP only), RBAC ⚠ partial
(`practice.settings.manage` covers `setChannel`; the platform side has no gate below `super_admin`),
"Encrypted secrets" ❌ — secrets are plain env vars, and [SEC] §3.4 already noted no secret scanning.

## 3.2 What is genuinely missing

- **No provider abstraction.** §5's whole point ("Providers such as Resend, SendGrid, Amazon SES or
  Postmark may be substituted without changing business logic") is unmet: Resend is hard-coded in two
  files. SendGrid, SES and Postmark appear nowhere.
- **Nothing is configured.** `.env.local` holds exactly six keys: `ANTHROPIC_API_KEY`, `CRON_SECRET`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `VERCEL_OIDC_TOKEN`. **No `RESEND_API_KEY`.** Every acceptance criterion in §11 that mentions a
  delivered email fails today for want of a key, not for want of code.
- **§6 Activation Workflow, seven steps, six absent**: configure API key (env only, no UI), verify
  sending domain ❌, install templates ❌, validate queue ❌ (no queue), health checks ⚠ (env presence,
  not a live ping), enable feature flag ❌, activate through Platform Operations ❌.
- **§7 Health Checks**: API connectivity ⚠ (presence-of-env, not a call), domain verification ❌,
  template availability ❌, queue ❌, webhook ❌, delivery success rate ✅, **bounce monitoring ❌**.
- **§8 Ops Workspace**: delivery logs ✅ and a usage dashboard ✅; activate/deactivate ❌, provider
  configuration ❌, template management ❌, cost dashboard ❌ (the platform-ops hub explicitly renders
  cost KPIs as `—` "Not metered").

## 3.3 Verdict

**≈ 50% already built.** At the *bottom* of the brief's 50-70% prior. The sending code is done twice
over; the *capability wrapper* around it — flag, activation, domain verification, template
management, bounce handling, cost — is entirely absent, and so is the API key.

---

# 4. CNE-003 — Authentication & OTP Capability

⚠ **This is the outlier. It is well below the brief's 50-70% prior.**

## 4.1 What exists — and it is genuinely good

`practice_otp_challenge` (mig 224:123-152) plus `issueOtp`/`verifyOtp` (`messaging.ts:390`, `:510`)
is the strongest thing in this survey, hardened in `fc2de9a2`:

- Code never stored: `sha256(\`${challengeId}:${code}\`)`, salted with the row's own id, so the row is
  inserted `code_hash: "pending"` and then updated.
- `timingSafeEqual` comparison (`messaging.ts:560`).
- Replay protection: `consumed_at`, plus a **compare-and-set** attempt increment
  (`.eq("attempts", c.attempts)`, `:546-549`).
- `max_attempts integer not null default 5` — in the schema, today.
- Rate limits that **fail closed**, with the reasoning recorded in code (`messaging.ts:351-354`):
  *"A limit whose failure mode is 'no limit' is not a rate limit. Both branches now refuse."*
- A code that could not be handed to a provider is immediately consumed and returns
  `502 NOT_DELIVERED` — no dangling live code.

Also present: `practice_session` with `device_id, device_label, user_agent, trusted, first_seen_at,
last_seen_at, revoked_at, revoked_by, revoked_reason`, listing/revoke/trust functions and a UI
console — **broken as [SEC] §0.2 describes.**

## 4.2 What is genuinely missing

| CNE-003 §4 capability | State |
|---|---|
| Email OTP | Engine ✅. **No API route, no UI, no production caller.** `grep issueOtp src/` finds definitions and harnesses only. Provider unconfigured. `practice_otp_challenge` = **0 rows live** |
| SMS OTP | Same, plus the platform stack's SMS is a literal stub (`error: "sms adapter pending"`) |
| Authenticator (TOTP) / `CNE.TOTP` | **0%.** `auth.mfa.` appears in **one** functional place, `shell.ts:117` (`getAuthenticatorAssuranceLevel`). No `mfa.enroll`, `mfa.challenge`, `mfa.verify`, no unenrol |
| Multi-Factor Authentication | A gate that **fails open** ([SEC] §0.3.1), and no enrolment |
| Recovery Codes | **0%** |
| **Account Lockout** | **0%.** Confirmed by grep — the only `lockout` hits in `src/lib` + `src/app/api` are an AI quota limiter, a practice-restore cooldown string, and the false marketing claim |
| Rate Limiting | OTP: ✅ per-destination (5/hr). ⚠ per-**source** is dead — the code reads/writes a `source_hash` column that **exists in no migration**, so any source-limited call refuses with `503 SOURCE_LIMIT_UNAVAILABLE`. Login: **0%** |
| Trusted Devices | Column + functions + UI exist; register broken ([SEC] §0.2) |

§9 Health Monitoring — **all six absent**: OTP delivery success, provider availability, authentication
latency, failed login trends, lockout statistics, MFA adoption.
§10 Operations Workspace — **absent entirely**. No auth surface exists under Platform Operations.
§3 Feature flags — none of the three exists.

## 4.3 ⚠ Two direct conflicts between this spec and live code

1. **OTP expiry.** CNE-003 §8 says *"5-minute expiry"*. Live: `OTP_MINUTES = 10`
   (`messaging.ts:370`), and the SMS body template interpolates it — *"It expires in ${a.minutes}
   minutes"*. Adopting the spec halves a live constant. **Decision (§9.1).**
2. **`max_attempts`.** The spec gives no number. The schema default is already `5`.

## 4.4 Verdict

**≈ 35% already built.** The OTP core is ~85% done and unreachable; everything the document wraps
around it — TOTP, MFA lifecycle, recovery codes, lockout, login rate limiting, health, the ops
console, the flags — is 0%.

---

# 5. CNE-004 — Messaging Capabilities

## 5.1 What exists

- **SMS adapters, two of them** (Twilio, Africa's Talking), with provider precedence
  `twilio ? "twilio" : africas ? "africastalking" : null`. Unconfigured, no production caller.
- **§8 Consent — genuinely ahead of the spec.** `practice_message_channel.require_consent` defaults
  **true**, and `refusalFor()` (`messaging.ts:180-213`) checks, in order: empty destination → channel
  not enabled → `preferred_contact_method === "none"` → patient `status === "merged"` →
  `practice_patient_consent` for `contact_by_practice` must be `"given"` → provider configured. Each
  refusal is written as a `practice_message` row with `status: "refused"` and `refused_reason`. This
  is a better consent model than CNE-004 §9 asks for.
- **§8 Branding**, partially: `sender_name` / `sender_address` per practice.
- **Message retention**: `practice_message` is indexed and queryable; no retention policy.

## 5.2 What is genuinely missing

Of §4's eight Managed Messaging Capabilities: **SMS messaging** ⚠ (adapter only, unconfigured, no
caller); **WhatsApp Business** ❌; **Push notifications** ❌ (declared unreachably, §2.2);
**Voice notifications** ❌; **Appointment reminders** ⚠ (template, no scheduler); **Follow-up
reminders** ⚠ (same); **Broadcast messaging** ❌; **Two-way messaging** ❌ — there is no inbound
webhook route anywhere, and `practice_incoming_document` (mig 200) is a *manual* register with a
`RECEIVED → REVIEWED → ACTIONED` workflow, not a receive channel.

§5 names five providers; two exist. §8's quiet hours ❌ and language ❌ are absent. §9's message
retention policies ❌.

⚠ `practice_message.kind` is `check (kind in ('sms','email'))` and `practice_message_channel.kind`
the same. **Adding WhatsApp, push or voice requires altering two CHECK constraints on the practice
tables and adding members to the platform stack's `Channel` union** — the two stacks would have to be
extended in lockstep, or diverge further.

## 5.3 Verdict

**≈ 25% already built.** One of four channels, at adapter level only, unconfigured and uncalled.
CNE-004's acceptance criteria include "✓ WhatsApp operational" and "✓ Push notifications
operational"; both are 0% with no partial credit available.

---

# 6. Dependency order, from the documents' own text

**PCS-CAP-001 is unambiguously first.** §1: *"All future engine specifications shall conform to this
standard."* §16 Governance: *"No new engine or major feature may be implemented without: 1. A
registered Capability ID. 2. Defined feature flags. 3. Activation workflow. 4. Health checks. 5.
Rollback plan. 6. Acceptance criteria."* All four CNE documents name it first in "Related
Specifications", and each Executive Summary says it is governed by it.

**Among the four CNE documents the text states a cycle, and then breaks it.**

- CNE-001 §3: `Depends On: Authentication, Scheduler, Template Engine, Queue Service`
- CNE-002 §3: `Dependencies: Authentication, Template Engine, Scheduler, Queue Service`
- CNE-004 §3: `Dependencies: Template Engine, Scheduler, Queue Service, Identity Service`
- CNE-003 §3: `Dependencies: Email Capability, SMS Capability, Identity Service, Audit Engine`

CNE-001/002 depend on "Authentication"; CNE-003 *is* Authentication and depends on Email and SMS.
The cycle resolves because the dependencies are of different kinds: CNE-002/004 need Authentication
for *administrative RBAC on the ops console*, whereas CNE-003 needs Email/SMS for *actual delivery of
a code*. Only the latter is a hard runtime dependency. **CNE-003's own dependency list therefore
places it last**, and that settles the order.

```
PCS-CAP-001  (registry, lifecycle, flags, activation, health)
     │
     ├── ⚠ Queue Service  ─┐
     ├── ⚠ Template Engine ├── all three declared as dependencies; two do not exist (§1.4)
     └──   Scheduler      ─┘
     │
CNE-001  (engine + provider interfaces + capability wrapper)
     │
     ├── CNE-002 (Email)      ─┐  parallel; neither depends on the other
     └── CNE-004 (Messaging)  ─┘
                    │
              CNE-003 (OTP / MFA / TOTP)   ← last, by its own §3
```

**Note the tension with the security work.** [SEC] §7 puts the auth fixes in Phase 0. This spec set
puts Authentication *last*. Those are not in conflict — [SEC]'s Phase 0 items (role escalation, RLS,
headers, fail-open discards) are not CNE-003 items — but **CNE-003's build must not be treated as
the delivery vehicle for [SEC]'s auth findings.** It arrives too late.

---

# 7. ⚠ Exact keys, names, IDs and numbers — quoted from the text

## 7.1 Feature flag keys — every one named, and where

| Key | Named in |
|---|---|
| `communications.email.enabled` | PCS-CAP-001 §9 (as an example); CNE-001 §9; **CNE-002 §3 (as the capability's own `Feature Flag:`)** |
| `communications.sms.enabled` | PCS-CAP-001 §9; CNE-001 §9; CNE-004 §3 |
| `communications.whatsapp.enabled` | CNE-001 §9; CNE-004 §3 |
| `communications.push.enabled` | CNE-001 §9; CNE-004 §3 |
| `communications.voice.enabled` | CNE-001 §9; CNE-004 §3 |
| `communications.otp.email.enabled` | CNE-003 §3 |
| `communications.otp.sms.enabled` | CNE-003 §3 |
| `security.mfa.enabled` | CNE-003 §3 |
| `offline.sync.enabled` | PCS-CAP-001 §9 (example only; no CNE spec) |
| `ai.copilot.enabled` | PCS-CAP-001 §9 (example only) |

**⚠ CORRECTION TO THE BRIEF.** The brief states the comps show `communications.auth.*`. **The text
never uses that prefix.** CNE-003 §3 reads, verbatim:

> `Feature Flags: communications.otp.email.enabled, communications.otp.sms.enabled, security.mfa.enabled`

Note that `security.mfa.enabled` is the **only flag in all five documents outside the
`communications.` namespace** — the auth capability deliberately splits across two prefixes. Any
implementation that normalises it to `communications.mfa.enabled` is departing from the text.

⚠ Two collisions with live keys:
- `ai.copilot.enabled` (PCS-CAP-001 §9) vs the live `plat_feature_flags` row **`ai_copilot`**. Same
  feature, two naming conventions. Dots vs underscores is a platform-wide decision (§9.3).
- All five live keys are single-token snake_case (`simulation_engine`, `executive_intelligence`,
  `ai_copilot`, `clinical_operations`, `marketplace`). Every key in the specs is dotted and
  hierarchical. There is no precedent in the codebase for the dotted form on the platform side.

## 7.2 Capability IDs

Ten distinct, across two documents. **These are a different namespace from the 47 RBAC capability
codes** (§10) — uppercase, dot-separated, naming *features* not *permissions*.

`CNE.EMAIL` · `CNE.SMS` · `CNE.WHATSAPP` · `CNE.PUSH` · `CNE.VOICE` · `CNE.OTP.EMAIL` ·
`CNE.OTP.SMS` · `CNE.MFA` · `CNE.TEMPLATES` · `CNE.TOTP`

⚠ The two lists disagree: CNE-001 §4's nine include `CNE.TEMPLATES` but omit `CNE.TOTP`; CNE-003 §3
names `CNE.TOTP` (and no CNE doc lists `CNE.TEMPLATES` as its own spec). The union is ten.

Capability **groups** named: `Communications` (CNE-001 §3), `Authentication` (CNE-003 §3).
Engine name, given identically three times: `Communications & Notifications Engine`.
Owner, once: `Platform Core Services` (CNE-001 §3).

## 7.3 Provider names

| Named in | Providers |
|---|---|
| CNE-001 §5 (architecture row) | `Resend \| Africa's Talking \| Infobip \| Twilio \| Meta \| Firebase` |
| CNE-002 §3 / §5 | Primary Provider: **`Resend`**; substitutable: `SendGrid`, `Amazon SES`, `Postmark` |
| CNE-004 §5 | `Africa's Talking, Infobip, Twilio, Meta WhatsApp, Firebase` |

**Provider interface names** (CNE-001 §6, the only interface identifiers in the five documents):
`EmailProvider`, `SMSProvider`, `WhatsAppProvider`, `PushProvider`.

Present in the repo: Resend, Twilio, Africa's Talking (+ a generic webhook, unnamed by any spec).
Absent: Infobip, Meta, Firebase, SendGrid, Amazon SES, Postmark.

## 7.4 Config keys and lifecycle values

**Lifecycle, given identically three times** (PCS-CAP-001 §4, CNE-001 §7, CNE-003 §6):
`PLANNED` · `DEVELOPMENT` · `BUILT` · `TESTED` · `READY` · `ACTIVE` · `SUSPENDED` · `RETIRED`

**Mandatory Capability Metadata, thirteen fields** (PCS-CAP-001 §5): `Capability ID`,
`Capability Name`, `Engine`, `Business Purpose`, `Version`, `Dependencies`, `Feature Flag`,
`Default State`, `Tenant Scope`, `Supported Editions`, `Owner`, `Health Endpoint`,
`Configuration Screen`.

**Editions, four** (PCS-CAP-001 §12): `Free`, `Professional`, `Premium`, `Enterprise`.

**Activation scopes** (PCS-CAP-001 §11, CNE-001 §12, CNE-002 §9, CNE-004 §8 — all four identical):
*"globally, per tenant, per practice, or per practitioner"*.

**Health signals, eight** (PCS-CAP-001 §10): Availability, Dependency health, Queue health, Error
rate, Usage, Latency, Cost, Audit logs.

## 7.5 ⚠ NUMERIC DEFAULTS — the answer to the brief's direct question

**There is exactly one number in all five documents.** CNE-003 §8, Security Controls, verbatim:

> • Hashed OTP storage
> • **5-minute expiry**
> • Maximum retry limits
> • Replay protection
> • Brute-force protection
> • Audit logging
> • RBAC administration

**"Maximum retry limits" and "Brute-force protection" carry no numbers.** §4 lists "Account Lockout"
and "Rate Limiting" as capability names with no elaboration anywhere in the document.

So, directly answering the brief:

| Value | The comp reportedly showed | **What the TEXT says** | What the CODE says |
|---|---|---|---|
| OTP expiry | 5 min | **"5-minute expiry"** ✅ confirmed | ⚠ **10 min** (`OTP_MINUTES = 10`, `messaging.ts:370`) — **conflicts** |
| Max OTP attempts | 5 | **nothing** — "Maximum retry limits" only | ✅ **5** (`max_attempts integer not null default 5`, mig 224) |
| Lockout duration | 15 min | **nothing** — no duration anywhere | **nothing** — no lockout exists |

- **The user's independently chosen 5 attempts is corroborated — but by the live schema, not by this
  document.** Migration 224 already defaults `max_attempts` to 5. That is a stronger endorsement than
  the spec would have been: it is already the deployed value.
- **The 15-minute lockout has no source in the text and no source in the code.** It remains entirely a
  proposal and needs a decision (§9.2). ⚠ Note also that no document names an *unlock path*, which
  [SEC] §8.2 already flagged as the harder half of the question.
- **The only number the text does give conflicts with live code**, in the safer direction (5 < 10).

Other numeric-ish values, for completeness: `Version: 2.0` (all four CNE docs), `v1.0`
(PCS-CAP-001), `Default State: READY` (all four CNE docs). Nothing else — no retry counts, no queue
depths, no rate limits, no timeouts, no cost thresholds, no SLA.

---

# 8. Which security gaps each spec closes — and which stay open

Cross-referenced against [SEC] and re-verified live.

| Gap ([SEC] ref) | Which spec addresses it | Does it close it? |
|---|---|---|
| **No account lockout / brute-force protection** ([SEC] §0.5, §3.3) | CNE-003 §4 ("Account Lockout", "Rate Limiting"), §8 ("Brute-force protection"), §9 ("Lockout statistics") | ⚠ **Names it, does not specify it.** No threshold, no window, no duration, no unlock path, no scope (per-account? per-IP?). The decision [SEC] §8.2 asked for is not answered here |
| **No auth audit trail** ([SEC] §0.5) | CNE-003 §8 "Audit logging", §9 "Failed login trends", §10 "Authentication logs"; CNE-001 §13 "All communication events are audited" | ⚠ **Demands it, names no event taxonomy.** Re-verified live: `practice_audit_event` has **86 distinct event types, none an auth event**; `audit_log` has **68 distinct actions**, of which `change_password` and `switch_role` are the closest and neither is a sign-in. The build is cheap and unblocked; the spec adds motive, not design |
| **No MFA enrolment UI** ([SEC] §6.3) | CNE-003 §4 ("Authenticator (TOTP)", "Recovery Codes"), §10 ("Enable/Disable MFA", "Recovery management") | ⚠⚠ **No — and it makes the risk worse.** §10's items are *administrative*: an ops console that can require MFA. There is **no enrolment flow, no recovery-code issuance flow, no self-service anything in any of the five documents.** Shipping §10 before an enrolment page is precisely the lockout [SEC] §6.3 warns about. **[SEC] §6.3's strict order — enrolment page first — must survive this spec set intact.**<br>ℹ Update since [SEC]: `/practice/access-status` **has been fixed**. `src/app/practice/access-status/page.tsx:35` now records *"⚠ THIS USED TO SAY 'add an authenticator to your account and then come back'. There is no page in…"* and the live copy at `:42` correctly says the product has no such screen and to contact an admin. That specific false instruction is gone |
| **Broken device register** ([SEC] §0.2, 13,092 rows) | CNE-003 §4: `• Trusted Devices` | ⚠ **No.** That bullet is the **entire** mention across all five documents. No description, no validity period, no revocation semantics, no enrolment, no cookie. **The text does not describe the feature that register was meant to be.** The fix ([SEC] §6.4, plant the cookie in `proxy.ts`) is unaffected and should proceed independently |
| **No email verification** (`mailer_autoconfirm: true`) | CNE-002 §4, first Supported Function: "Email verification"; §11 "✓ Test emails successful" | ✅ **Partly — the strongest connection in the set.** It makes verification a named deliverable. But `mailer_autoconfirm` is a GoTrue project setting, not application code: flipping it needs a working mailer, not this spec. **Blocked on a `RESEND_API_KEY` and a verified sending domain, both absent.** [SEC] §6.7's staging-first caution still governs |
| **False marketing claim** ([SEC] §0.5) | — | ❌ **Still live.** `src/lib/marketing/practice-site.ts:250` still renders *"Account lockout and brute-force protection"* publicly. Unchanged, still false |
| **Encrypted secrets** | CNE-002 §10, CNE-004 §9 "Encrypted provider secrets" | ❌ Secrets are plain env vars. No vault, no rotation, no secret scanning ([SEC] §3.4) |

**Net:** these five specs close **one** open security gap (email verification, and only by naming it),
and **add** one risk — an MFA administration console with no enrolment page beneath it.

---

# 9. What needs a user decision before code

1. ⚠ **OTP expiry: 5 minutes (spec) or 10 (live)?** `OTP_MINUTES = 10` is deployed and interpolated
   into the SMS body. Halving it is safe but user-visible. **The spec is the only written source;
   the code is the only deployed one.**
2. ⚠ **Lockout: the numbers and the unlock path.** Unspecified in all five documents. [SEC] §8.2
   asked this and it is still open. Needed: failures, window, duration, scope (account / IP / both),
   and *who can unlock*. The 15-minute figure has no source. ⚠ An email-keyed lockout is a
   denial-of-service against a named clinician.
3. ⚠ **Flag naming convention.** Dotted (`communications.email.enabled`) vs the five live snake_case
   keys. And specifically: does `ai.copilot.enabled` become a **new** flag or a **rename** of the live
   `ai_copilot`? Two flags for one feature is the failure mode.
4. **Editions vs plans.** PCS-CAP-001 §12 names `Free, Professional, Premium, Enterprise`. Live
   `plat_plans` codes are `starter, professional, hospital, enterprise, government, unlimited`.
   `Free` and `Premium` do not exist; `hospital`, `government`, `unlimited` are not editions. Is
   "edition" a **new axis** on capabilities, or a **rename** of plan? `edition` currently has zero
   hits in `src/`.
5. ⚠⚠ **Which messaging stack survives, and one sender variable per provider.** §1.3. Decide
   `RESEND_FROM` vs `NOTIFY_FROM_EMAIL` and `TWILIO_FROM` vs `TWILIO_FROM_NUMBER` **before** any key
   is set, or half the email will silently work.
6. **Provider commitment — and a budget.** Nothing works until a key exists. Resend is named primary
   by CNE-002 §3. For SMS the specs name Twilio, Africa's Talking and Infobip without ranking them;
   the code already has adapters for the first two, with `twilio` winning the precedence check.
7. **Does "Capability" become a new table, or a 33rd `object_type` in
   `configuration_registry_objects`?** The enum already carries 32 values including `FEATURE_FLAG`
   and `AI_CAPABILITY`, and the registry already has `dependencies`, `configuration_owner`, a status
   lifecycle and an audit table. Reusing it is dramatically cheaper; the cost is that WCE-002's
   9-value governance lifecycle and PCS-CAP-001's 8-value activation lifecycle would have to
   coexist on one column or become two columns.
8. **Consent for platform notifications.** CNE-004 §9 requires consent management. The practice
   stack has it; `dispatch.ts` sends to `profiles.email` with no consent check at all, from 242 call
   sites. Extending consent to those is a behaviour change for existing users.
9. **`source_hash`.** Per-source OTP rate limiting is written, fail-closed, and dead because the
   column exists in no migration. Add the column, or delete the parameter — leaving it is a control
   that reads as present and refuses in practice.
10. **Are WhatsApp, Push and Voice real commitments?** CNE-004 §10 asserts "✓ WhatsApp operational"
    and "✓ Push notifications operational" as acceptance criteria. Both are 0%, both need vendor
    onboarding (Meta Business verification; FCM project), and neither has a spec beyond a bullet.
11. **Queue Service and Template Engine.** §1.4 — three specs declare them as dependencies, neither
    exists, and PCS-CAP-001 §7 forbids activation without healthy dependencies. Either write the two
    missing specs, or amend the dependency lists. **This is the gate on the whole set.**

---

# 10. Navigation — what the TEXT says

⚠ **No comp was opened for this section.** Four of the five documents name a navigation location, in
consistent language, and it lands on a section that already exists. **This is the first spec set this
week whose navigation instruction is quotable and correct.**

Verbatim:

- **PCS-CAP-001 §14 (heading: "Capability Dashboard"):**
  > "Platform Operations > Capability Manager displays:
  > • Status • Health • Dependencies • Version • Cost • Usage • Activate/Disable controls • Logs • Metrics"

- **CNE-001 §10 (heading: "Operations Workspace"):**
  > "Platform Operations > Capability Manager displays capability status, health, provider, usage, costs, logs, dependencies, activation controls and metrics."

- **CNE-002 §8 (heading: "Operations Workspace"):**
  > "Platform Operations > Capability Manager > Communications > Email
  > • Activate/Deactivate • Provider configuration • Template management • Delivery logs • Usage dashboard • Cost dashboard"

- **CNE-003 §10 (heading: "Operations Workspace"):**
  > "Platform Operations > Capability Manager > Authentication
  > • Enable/Disable MFA • Configure OTP channels • View security metrics • Recovery management • Authentication logs"

- **CNE-004: no path.** It has no "Operations Workspace" section; §7 is "Health & Operations" and
  names no location. Its §6 says only *"Activate capability via Platform Operations"*. Its channels
  would presumably sit beside Email under Communications, but **the text does not say so and I am
  not inferring it.**

**What this means concretely.**

- The home already exists: **`/super-admin/platform-ops`**. Its sidebar group "Platform Operations"
  (`src/app/super-admin/_components/WorkspaceSidebar.tsx:33-43`) currently holds **11 items**:
  Overview, Tenant Operations, Workspaces, Licensing, Monitoring, AI Gateway, Notifications,
  Approvals, Control Plane, Competen Practice, Platform Workspace. Its hub page lists **14 numbered
  modules**. "Capability Manager" would be item 12 and module 15.
- The four-level path `Platform Operations > Capability Manager > Communications > Email` implies a
  **nested** surface, which no existing platform-ops module has — every one is flat at
  `/super-admin/platform-ops/<slug>`. `/super-admin/platform-ops/capabilities/communications/email`
  would be the first three-segment route in that section.
- ⚠ **The nine-item Practice sidebar is untouched.** No document names `/practice`, a practice
  screen, or any practitioner-facing surface. The design freeze (CPR-CORE-001 / CPR-V5-002) is not
  in play. There is nothing here to weigh against the 16 of 94 assertions that pin it.
- ⚠ **"Feature Management" already points elsewhere.** The platform-ops hub's quick action
  (`page.tsx:90`) links Feature Management to `/platform/control-plane`, a *different* workspace
  (landlord-gated, `getLandlordCaller`). A Capability Manager under `/super-admin/platform-ops` that
  owns feature flags would sit across a workspace boundary from the flag UI that exists. **Decide
  which workspace owns flags before building either.**

---

# 11. Capability codes — probed live

## 11.1 The practice catalogue: 47, unchanged

Queried `practice_role_capabilities` directly: **47 distinct `capability_code` values, 82
role→capability rows, 5 roles.** Identical to [SEC] §2.5 — no drift.

Codes in the catalogue with any communications or authoring adjacency:

```
comm.record      message.use      template.manage      document.author
```

`message.use` and `comm.record` are the two that a Communications capability would touch.
`template.manage` is document templates, not message templates.

## 11.2 ⚠ The platform side still has none

Confirmed again: no capability catalogue exists outside `practice_*`. Every non-practice workspace
gates on a role string, and `/platform/control-plane` gates on `getLandlordCaller`. **Any capability
model these specs imply for the platform is greenfield.**

## 11.3 ⚠ The specs' capability IDs are a *different namespace* — do not merge them

The ten `CNE.*` IDs (§7.2) are **feature identifiers**, not permissions. The 47 practice codes are
**permissions** (`patient.view`, `encounter.sign`). They are superficially similar — both
dot-separated — and putting `CNE.EMAIL` into `practice_role_capabilities` would be a category error
that the schema would happily accept: that table has `role_code`/`capability_code` as plain text with
**no FK and no CHECK on `capability_code`**.

Two separate registers are needed:

- **Capability IDs** (`CNE.EMAIL`, …) → a new platform capability registry, or a 33rd `object_type`
  in `configuration_registry_objects` (§9.7).
- **RBAC codes** → the existing 47, extended only if a practice-facing surface appears. **None of the
  five documents names a practice-facing surface**, so today: **no new RBAC codes are required by
  any of the five specs.** The ops consoles they describe are super-admin/landlord surfaces.

If the practice messaging channel ever becomes administrable beyond `practice.settings.manage` (which
already covers `setChannel`), `message.send` and `channel.manage` would be the natural additions —
but nothing in the text asks for them.

---

# 12. Build-vs-already-built summary

| Spec | Already built | Genuinely missing | Verdict |
|---|---|---|---|
| **PCS-CAP-001** | **~22%** | Capability registry, 8-state lifecycle, 13-field metadata, health endpoints, activation workflow, rollback, Capability Manager UI, governance gate | ⚠ **Not implemented under another name — but six of its parts are, separately.** Best built as a **unification** of `plat_feature_flags` + WCE-002 registry + NCP-019 releases + NCP-017 dependencies + `plat_plans` + the CGR-028 readiness-gate pattern, not greenfield |
| **CNE-001** | **~45%** | Provider interfaces, WhatsApp/Push/Voice, template engine, capability wrapper, all 5 flags, Capability Manager, latency/cost/webhook health | Two disjoint half-engines that must be reconciled first (§1.3) |
| **CNE-002** | **~50%** | Provider abstraction, **an API key**, domain verification, template management, bounce monitoring, cost, activation workflow, feature flag | **Bottom of the 50-70% prior.** Sending is done twice; the capability wrapper is absent |
| **CNE-003** | **~35%** | ⚠ **TOTP, MFA lifecycle, recovery codes, account lockout, login rate limiting, all health signals, the entire ops console, all 3 flags** | ⚠ **Well below the prior.** The OTP core is ~85% done and has **no caller**; everything around it is 0% |
| **CNE-004** | **~25%** | WhatsApp, Push, Voice, broadcast, two-way, quiet hours, language, retention, scheduler wiring | Lowest. One of four channels, adapter-only, unconfigured, uncalled |

**The prior held for CNE-002 and roughly for CNE-001. It does not hold for CNE-003 (~35%) or
CNE-004 (~25%).** The reason is consistent: what exists is *delivery mechanics*; what these
documents are actually about is the *capability layer above them* — registration, flags, activation,
health, cost, ops console — and that layer is close to absent everywhere.

## 12.1 Smallest increment that delivers real value, per spec

- **PCS-CAP-001:** wire `flagEnabled()` to one real gate. The engine, the precedence, the UI and the
  audit trail all exist and nothing calls it (§1.2). One caller turns a dead subsystem live and
  proves the pattern before any registry is designed.
- **CNE-001:** reconcile the two sender env vars (§1.3). A few lines, no migration, and it removes a
  half-configured failure mode that will otherwise bite the moment a key is bought.
- **CNE-002:** buy a Resend key and verify a sending domain. **Every acceptance criterion in the
  document is blocked on this and none is blocked on code.** ⚠ Do not flip `mailer_autoconfirm`
  in the same change ([SEC] §6.7).
- **CNE-003:** the auth audit service — already [SEC] §7's Phase-1 item 7, still absent, still zero
  lockout risk, and CNE-003 §9/§10 now give it three named consumers (failed-login trends, lockout
  statistics, authentication logs). ⚠ **Do not build §10's "Enable/Disable MFA" before an
  enrolment page.**
- **CNE-004:** nothing worth doing until §9.6 and §9.11 are answered. This spec is genuinely
  premature.

---

## Appendix — live probe results, 2026-08-07

```
practice_platform_flags        3 rows   (sign_in ON, public_signup OFF, pilot_provisioning ON)
plat_feature_flags             5 rows   (snake_case; zero gating callers)
plat_feature_flag_assignments  0 rows
plat_products                  7 rows   competency, mclip, lms, simulation, passport, coe, pce
plat_plans                     6 rows   starter, professional, hospital, enterprise, government, unlimited
plat_job_runs              1,008 rows
practice_entitlement           5 rows   product_code='practice', plan_code='practice_trial'
                                        ⚠ 'practice' is NOT in plat_products — two disjoint entitlement systems
practice_message_channel       0 rows
practice_otp_challenge         0 rows
practice_role_capabilities    82 rows   47 distinct codes, 5 roles
service_profiles               1 row    status='active' (harness test row)
notifications                 36 rows
configuration_registry_audit   2 rows

MISSING: platform_capabilities, capabilities, plat_capabilities, capability_registry,
         cne_capability, plat_service_registry, plat_health_checks,
         plat_notifications, notification_templates, practice_message_log,
         practice_message_outbox

practice_audit_event: 86 distinct event_types — ZERO auth events
audit_log:            68 distinct actions   — ZERO sign-in events
.env.local:           6 keys — no RESEND_API_KEY, no TWILIO_*, no AFRICASTALKING_*
```
