# PCS-BILLING-SURVEY-001 — Survey of the three billing / licensing / payment specifications

Survey only. No code, no migration, no seed, nothing staged, nothing committed. One file written: this one.
Date: 2026-08-08.

Companions: `docs/PLAT-ARCH-SURVEY-001.md` (**[PLAT]**), `docs/CNE-SURVEY-001.md` (**[CNE]**),
`docs/COMP-SECURITY-SURVEY-001.md` (**[SEC]**), `docs/ENT-REVIEW-001-three-enterprise-specs.md` (**[ENT]**).

Everything below separates three voices, and never blurs them:

- **DOC** — what the document says, quoted with its section number.
- **CODE** — what the repository and the live database do, with a path, a line, or a probe.
- **REC** — what I recommend. Mine, not theirs.

---

## 0. Provenance — bodies and md5s, because byte size is worthless here

Every `.docx` in this project sits at ~37–56 KB on disk and **that number tells you nothing**: `styles.xml`
alone is ~349 KB uncompressed inside each one. Here is what is actually in them.

| Document | file bytes | `document.xml` bytes | extracted text bytes | text lines | `styles.xml` bytes | file md5 |
|---|---|---|---|---|---|---|
| **PCS-CAP-BILL-001** Platform Billing & Subscription Capability v1.0 | 55,807 | **209,170** | **33,020** | **1,495** | 349,649 | `cc6cede5e42a1bf5f6426e9184609059` |
| **PCS-CAP-LIC-001** Licensing, Entitlements & Feature Activation v1.0 | 37,418 | **6,475** | **1,570** | **62** | 349,458 | `b1665c874c90a595100d1043f6b1ceb0` |
| **PCS-CAP-PAY-001** Payment, Invoicing & Financial Operations v1.0 | 37,521 | **6,931** | **1,686** | **69** | 349,458 | `a06d18aaa7b981d648ae442802578332` |
| *(reference)* PCS-CAP-001 Platform Capability & Activation Framework v1.0 | 38,386 | 9,252 | 3,919 | 197 | 349,458 | `ecf08aa55a380cdbd68e4f4ac7d917ee` |
| *(reference)* PLAT-CAP-001 Capability Registry & Composition | 38,486 | 13,475 | 3,567 | 166 | 349,538 | `ae3629ce3009f3334ab27d324c9a0d76` |

`styles.xml` md5s:

```
310b8a397f5c92d4b3361d9818515387   PCS-CAP-001   PCS-CAP-LIC-001   PCS-CAP-PAY-001
5068bcdec9001723bc933db796aa1f85   PCS-CAP-BILL-001
498da2308cca8272891cb7012396f6fd   PLAT-CAP-001
```

**Three distinct bodies. Two batches, and the split is the most important fact in this section.**

- **LIC and PAY carry byte-identical `styles.xml` to PCS-CAP-001** — the plain template, no banner, no
  document-control table, no status line. Their bodies are **1,570 and 1,686 bytes**: *smaller than
  PCS-CAP-001, which [PLAT] §0 already called "a page of headings."* They are 8 and 9 bullet-lists long.
- **BILL has its own `styles.xml`** and the full production template: a cover banner (`COMPETEN`), a
  **Document control** table (`Status: Approved implementation baseline`), coloured callout boxes
  (`FOUNDATIONAL DECISION`, `RULE`, `STATE MACHINE RULE`, `FOUNDER IMPLEMENTATION`, `PRODUCT CONTRACT`,
  `IMPLEMENTATION POSITION`), **39 numbered sections**, a 13-entity domain model, a 10-state machine with a
  permitted-transition table, 12 named platform events with payloads, 15 acceptance criteria and 12 test
  scenarios.

⚠ **BILL is a real developer specification. LIC and PAY are not documents of the same class — they are
one-page outlines.** BILL says so itself:

> **DOC** — BILL §39 *"Related Documents to Build Next"*: `PCS-CAP-PAY-001 — Payment, Invoicing & Financial
> Operations`; `PCS-CAP-LIC-001 — Licensing, Entitlements & Feature Activation`.

BILL's own §39 lists LIC and PAY as **documents still to be written**. Their `document.xml` timestamps
(14:52 and 14:54) are *after* BILL's (14:45) on the same day, so the outlines were generated immediately
after the spec that asks for them. **Treat LIC and PAY as placeholders in a spec's own dependency list, not
as approved baselines.** BILL carries `Status: Approved implementation baseline`; LIC and PAY carry no
status line at all — the same tell [PLAT] §0 used to separate the four routing documents from the two
`PLAT-*` drafts.

### 0.1 ⚠ For LIC and PAY the comp carries more requirement than the document

Each `.docx` has a `.png` beside it, all three **1536×1024** — cover-art architecture diagrams, not page
renders. For BILL the comp adds little the 33 KB body does not already say. **For LIC and PAY the
relationship inverts: the comp is substantially richer than the 1.5 KB document.** The LIC comp alone
carries a 6-step activation architecture, 6 licence types, 6 licence states, a 6-part entitlement model, 8
control dimensions, an 18-item Feature Registry example list, 7 usage-limit examples and 5 entitlement-check
methods — none of which appears in the 62-line body.

⚠ **The comps are not authoritative.** The LIC comp contains at least two garbled labels
(`Plature Access` for what is evidently *Feature Access*, `Finance / Billing Terduct Team`), which is the
signature of generated art rather than reviewed copy. **REC:** read them for intent, quote them for nothing.

### 0.2 ⚠ Two places where comp and document contradict each other

| # | The comp says | The document says |
|---|---|---|
| **C1** | The BILL comp draws **one** box — `PLATFORM BILLING ENGINE (Capability)` — containing 15 numbered components including **#3 Feature Registry**, **#5 Entitlement & Activation Engine**, **#9 Licence Management**, **#12 Tax Engine** and **#13 Invoice & Document Management**. Licensing and payment are *inside* billing. | BILL §3 puts them **outside**: *"Feature-level authorization enforcement → PCS-CAP-LIC-001"*, *"Invoice PDF layout and fiscal document rules → PCS-CAP-PAY-001"*. BILL §39's closing callout is emphatic: *"Keeping these questions separate is the key architectural boundary."* |
| **C2** | The BILL comp names six consuming products: **Competen Practice (CP), Competen Recruitment (CR), Competen Learning (CL), Competen Construction (CC), Competen AFCAN (CA)**, "Other Future Products". | **CODE** — `plat_products` holds **7 rows**: `competency, mclip, lms, simulation, passport, coe, pce`. **The intersection with the comp's list is empty.** Not one comp product code exists; not one live product code appears in the comp. |

**REC:** C1 is a decision the user has to make (§9, D2) and it decides whether this is one build or three.
C2 is evidence for the same conclusion [PLAT] §3.3 reached from a different direction — `plat_products` is
a table describing the competency estate that the commercial documents have stopped describing.

---

# 1. ⚠ THE FIRST QUESTION: how these three relate to PCS-CAP-001 and to each other

**Answer: none of the three duplicates PCS-CAP-001. The relationship is subordination, not overlap — and
the numbering says so.** `PCS-CAP-BILL-001` is `PCS-CAP-001` + a domain segment. That is a child ID.

The subject matter confirms it. PCS-CAP-001 is a **meta-standard** — how to describe, register, activate,
monitor and retire *any* capability:

> **DOC** — PCS-CAP-001 §15 *"Standard Template for All Future Specifications"*: Executive Summary ·
> Business Purpose · Capability Metadata · Architecture · Data Model · Services & APIs · Configuration ·
> Dependencies · Activation Workflow · Feature Flags · Operations Workspace · Health Monitoring · Security
> · Testing · Acceptance Criteria · Capability Lifecycle · Rollback Procedure · Future Enhancements.

BILL is an **instance** of that template. It has Business Purpose (§1), Architecture (§4), Data Model (§5),
Services & APIs (§21), Configuration (§35), Dependencies (§36), Acceptance Criteria (§32), Testing (§33),
Security (§25), Operations UI (§22). **BILL conforms to PCS-CAP-001 §15 on 10 of 18 headings.**

⚠ **It also breaks PCS-CAP-001 on eight, and one of the breaks is structural:**

| PCS-CAP-001 §15 requires | In BILL |
|---|---|
| Capability Metadata (§5's 13 mandatory fields) | ❌ absent — no Capability ID in the §5 sense, no Engine, no Version field, no Feature Flag, no Default State, no Tenant Scope, no Supported Editions, no Owner, no Health Endpoint, no Configuration Screen |
| Feature Flags (§9 — *"Every capability exposes at least one feature flag"*) | ❌ **BILL declares no feature flag anywhere.** §35 defines eight *configuration key families* (`billing.market.*` etc.), which is a different mechanism |
| Capability Lifecycle (§4's 8 states) | ❌ absent — BILL §11 has a **subscription** state machine, not a capability lifecycle |
| Health Monitoring (§10's 8 signals) | ⚠ partial — BILL §34 has logs, metrics, alerts; no health endpoint, no dependency-health gate |
| Rollback Procedure (§13) | ❌ absent |
| Supported Editions (§12 — Free/Professional/Premium/Enterprise) | ⚠ BILL §7 uses *plan types* `Free / Paid / Lifetime / Enterprise / Internal` — a **different, overlapping vocabulary** |
| Executive Summary | ⚠ §1 "Purpose and Outcome" serves |
| Future Enhancements | ⚠ §37 "Explicit Non-Goals" serves inversely |

⚠ **The structural break.** PCS-CAP-001 §3 fixes the hierarchy:

> **DOC** — PCS-CAP-001 §3 *"Capability Model"*: `Platform └─ Engine └─ Capability └─ Services └─ Provider Adapters`

Under that model, *Billing* is an **Engine** and its 15 parts are **Capabilities**. BILL inverts it: §2 says
*"Billing is a platform capability"*, and the comp titles the whole thing `PLATFORM BILLING ENGINE
(Capability)` while calling its 15 subordinate parts "Engines" (`4. SUBSCRIPTION ENGINE`,
`6. TRIAL & GRACE MANAGEMENT`, `12. TAX ENGINE`). **Engine and Capability have swapped places between the
standard and the specification written to conform to it.** This is the same class of failure [PLAT] §5
flagged for `CP-ROUTE-001` restating frozen `PIS-000` with a changed rule — and it is cheap to fix now and
expensive later, because §16 of PCS-CAP-001 makes the registry entry a governance gate.

### 1.1 How the three relate to each other

BILL's own §39 callout is the cleanest statement of intent in all three documents:

> **DOC** — BILL §39: *"PCS-CAP-BILL-001 is the commercial source of truth. PCS-CAP-PAY-001 answers 'has
> money settled and what financial document is required?' PCS-CAP-LIC-001 answers 'what may this user or
> organisation use right now?' Keeping these questions separate is the key architectural boundary."*

That is a sound three-way split, and BILL §19 gives it a concrete contract — seven events billing emits and
what licensing does with each (`subscription.active` → activate bundle; `subscription.grace_started` → apply
grace policy; `usage.updated` → evaluate limits).

**Verdict per document:**

| Document | Duplicate? | Subset? | Genuinely new? |
|---|---|---|---|
| **PCS-CAP-BILL-001** | ❌ No. Nothing in `docs/` or the repo covers subscription commerce at this depth; nearest prior art is a migration comment. | ❌ No. | ✅ **Yes — and it is the only one of the three with enough content to build from.** |
| **PCS-CAP-LIC-001** | ⚠ **Substantially, yes — of BILL and of PLAT-CAP-001.** Its "Feature Registry" is PLAT-CAP-001 §3's registry under a new name. Its "Entitlement Model" (product/plan/feature/seat/quota/expiry) is BILL §19 + BILL §18 restated. Its "Activation Flow" is BILL §11 read from the other end. Its "Licence Types" is BILL §7 plan types plus two (`Lifetime Founder`, `Educational/Student`). | ✅ Its unique content is **two ideas**: a Feature Registry, and the LIC comp's licence-state model. | ⚠ Barely. **~85% restatement by bullet count.** |
| **PCS-CAP-PAY-001** | ❌ Not a duplicate — nothing in the repo or the other documents covers payment settlement. | — | ✅ **Yes in subject, no in substance.** 69 lines cannot specify a payment layer; it names 8 providers, 8 components and 4 acceptance criteria and defines none of them. |

⚠ **Do not read "three documents" as "three capabilities."** By body weight the set is **one specification
(33 KB) and two of its section headings promoted to filenames (1.6 KB each)**. BILL §3's scope table
already carves both out cleanly; whether they become separate builds is a decision (§9, D2), not a fact the
documents establish.

---

# 2. ⚠ The word "capability" — sense by sense, and these documents add a sixth

[PLAT] §8 raised this as **D4** and it is still unresolved. Live count, re-probed today:

| # | Sense | Where it lives | Live size |
|---|---|---|---|
| 1 | **A permission code on the Practice plane** | `practice_role_assignment.capability_code`, catalogue `practice_role_capabilities` | **50 distinct codes**, 120 grant rows, 87 catalogue rows |
| 2 | **A permission code on the HQ plane** | `hq_capability.code`, granted via `hq_position_capability` | **29 codes**, 6 positions, 37 grants (mig 264, applied) |
| 3 | **A registry object type** | `configuration_registry_objects.object_type = 'AI_CAPABILITY'`; routed for review at `src/lib/config/governance.ts:41` | 80 registry rows across 8 live types |
| 4 | **A feature-flag key** | `plat_feature_flags.key` | 6 keys |
| 5 | **A product feature** | PLAT-CAP-001 §4 (`Booking`, `Encounters`, `Subscriptions`, `Billing`); PCS-CAP-001 §3 | 0 rows — **no capability registry table exists** ([CNE] §1.1; re-probed today: `plat_capabilities`, `capability_registry`, `platform_capabilities` all return `PGRST205`) |
| 6 | ⚠ **NEW — a whole platform subsystem** | BILL §2 *"Billing is a platform capability"*; PAY *"the reusable payment and financial operations capability"*; LIC *"the platform capability responsible for licensing"* | 0 |

**Section by section, which sense each document means:**

| Document / section | Sense meant |
|---|---|
| BILL title, §2 first bullet, §4 heading "Capability Context", §36 "Dependencies", §38 "Definition of Done for PCS-CAP-BILL-001" | **6** — the subsystem |
| BILL §23 "Roles and Permissions" — column header is literally *"Role/capability"* listing `Billing Viewer`, `Billing Operator`, `Commercial Manager`, `Finance Admin`, `Platform Admin`, `Support Agent` | ⚠ **1/2** — a permission grant, the same sense as the 50 practice codes and the 29 HQ codes. **BILL uses two senses of the word inside one document.** |
| BILL §19 "Entitlement Handoff", §18 "Usage and Metering" | **5** — product features and quotas |
| LIC "Core Components → Feature Registry", "Entitlement Model → Feature entitlement" | **5** |
| LIC comp "Feature Registry: Scheduling & Calendar, Patient Management, Encounters, AI Assistant, Follow-ups, Documents, SMS Notifications, WhatsApp, Multi-location, Team & Staff, Analytics & Reports, Custom Branding, API Access, Offline Mode, Unlimited Patients, Storage" | **5** — and note **`Offline Mode` is already sense 4**: it is `plat_feature_flags.practice_offline_cache`, seeded by mig 260 |
| LIC "Role & Permission Integration" | **1/2** |
| PAY throughout | **6** |

⚠ **The collision is not academic, it is a live enforcement hazard.** `hasCapability(ctx, "document.sign")`
resolves sense 1. If a Feature Registry ships whose rows are also called capabilities, the next person to
write `hasCapability(ctx, "documents")` will get `false` from an array that never contained product
features, and no type error will tell them. Sense 1 and sense 5 are both `string`.

**REC:** settle D4 before any of this is built, and settle it by **banning the bare word in code**. Sense 1
is already `capability_code`; sense 2 already namespaces every code with `hq.`. Give sense 5 a different
noun entirely — `feature_code` / `plat_feature` — and never a table called `capabilities`. This costs one
naming decision now and a rename across 300 `hasCapability` call sites later.

---

# 3. What already exists — measured, not assumed

Probed live via `plat_rls_registry()`. **544 tables in `public`.** Every probe below used
`select("*", { count: "exact" }).limit(0)` — **never `head: true`**, because a `head` request against a
missing table returns no error and reports it PRESENT. `PGRST205` is treated as absent.

## 3.1 ⚠ Four things in the brief need correcting

| The brief says | Evidence | Correction |
|---|---|---|
| "`plat_products` — 7 rows, and Competen Practice is NOT one of them" | probe: 7 rows, `competency, mclip, lms, simulation, passport, coe, pce` | ✅ **Correct.** |
| "`plat_feature_flags` — `product_code` references `plat_products.code`. Migration 260 had to write `null`" | `042-platform-control-plane.sql:95`; `260-offline-cache-flag.sql:18` — *"product_code is NULL because there is no `practice` row in plat_products. The `marketplace` flag sets that precedent rather than this file inventing one."* | ✅ **Correct, and the migration says it in those words.** |
| "`plat_plans` — verify it exists and what is in it" | 6 rows: `starter, professional, hospital, enterprise, government, unlimited` | ✅ Exists. ⚠ **All six have `price_monthly = 0` and `currency = 'USD'`.** There is no UGX anywhere in the platform plan catalogue. |
| **The brief implies there is no billing table set.** | — | ❌ **Wrong, and this is the most consequential correction in the report.** See §3.2. |

## 3.2 ⚠ A billing schema already exists — this is the THIRD generation of billing specification, not the first

| Table | Rows | Created by | Cited spec |
|---|---|---|---|
| `plat_products` | **7** | `042-platform-control-plane.sql:36` | LCP-001 |
| `plat_plans` (`price_monthly numeric`, `currency char(3)`, `entitlements jsonb`) | **6** | `042:55` | LCP-001 §4 |
| `plat_subscriptions` (`status in ('trialing','active','past_due','canceled')`, `renews_at`, `trial_ends_at`, `seats_purchased`) | **6** | `042:75` | LCP-001 §5 |
| `plat_feature_flags` / `plat_feature_flag_assignments` | **6 / 0** | `042:91` / `042:98` | LCP-001 §9 |
| `plat_billing_accounts` (`legal_name`, `tax_id`, `billing_email`, **`gateway_customer_ref`**, `currency`, `balance`) | **0** | `043-control-plane-phase2.sql:8` | LCP-001 §5 |
| `plat_invoices` (`number`, `status in ('draft','open','paid','void','uncollectible')`, `amount`, `currency`, `issued_at`, `due_at`) | **0** | `043:22` — comment: *"minimal invoice ledger (activates with a gateway)"* | LCP-001 |
| `plat_platform_events` | — | `043:40` — comment names *"subscription.changed, billing.failure"* as intended event types | LCP-001 §15 |
| `product_portfolios` / `product_suites` / `product_workspaces` | **0 / 0 / 0** | `105-product-portfolio.sql` | **PCS-PORT-001** |
| `tenant_product_licenses` (`product_code → plat_products.code`, `status`, `valid_from`, `valid_to`) | **0** | `105:52`, re-keyed by `106-reconcile-pcs-products.sql:21` | PCS-PORT-001 |
| `practice_plans` (`plan_code`, `name`, `trial_days`, `active`) | **2** (`practice_trial`, `practice_standard`) | `191-practice-provisioning-foundation.sql:249` | PROV-001 |
| `practice_entitlement` (`workspace_id`, `product_code` default `'practice'`, `plan_code`, `status`, `starts_at`, `ends_at`, `sponsor_ref`) | **2** | `191:138` | PROV-001 §5 |
| `practice_platform_flags` | **3** | `191:256` | — |

⚠ **So the commercial layer has been specified three times already and this is the fourth.**
`LCP-001` (migs 042/043, July), `PCS-PORT-001` (migs 105/106), `PROV-001` (mig 191, Practice's own), and now
`PCS-CAP-BILL-001`. Every one of them created its own tables and none of them retired the previous set.
The result is what the probe shows: **three independent entitlement engines and two flag systems.**

⚠ **There is no `docs/` file for the platform `LCP-001`.** It is cited only inside migration comments at
`042:36/54/74/90` and `043:7/21/37`. **The spec that produced the live billing tables is not in the
repository.** Anyone building BILL will re-derive decisions that document already made.

## 3.3 ⚠ An orphan Stripe-shaped table exists in the live database

```
public.subscriptions   0 rows
  id, user_id, hospital_id, stripe_subscription_id, plan, status,
  current_period_start, current_period_end, created_at
```

- **CODE** — `grep -rn "create table.*subscriptions" supabase/` finds only `plat_subscriptions`. `subscriptions`
  is **defined in no file in this repository**, including `supabase/schema.sql`.
- **CODE** — `grep -rn 'from("subscriptions")' src/ scripts/` → **zero**.
- **CODE** — `grep -rn "stripe_subscription_id"` across `*.sql *.ts *.tsx *.md` (excluding `node_modules`) →
  **zero**.

It is exposed through PostgREST (it appears in the OpenAPI spec among 545 definitions), so it is reachable
with a valid key subject only to its RLS policies. **REC:** confirm its RLS posture and drop it, or record
why it stays. A table nobody declared, nobody reads, and whose column names promise a payment integration
that does not exist is exactly the artefact that makes a future auditor believe there is one.

## 3.4 The three entitlement engines, side by side

| | **Practice** | **Platform / estate** | **HQ** |
|---|---|---|---|
| Subject | one practice workspace | a tenant (hospital) | a platform staff member |
| Entitlement store | `practice_entitlement` (2 rows) | `tenant_product_licenses` (**0 rows**) | — |
| Permission store | `practice_role_assignment` (120 rows, **50 codes**) | `profiles.platform_role[]` | `hq_position_capability` (37 rows, **29 codes**) |
| Resolver | `resolveWorkspaceContext` — `src/lib/practice/access.ts:74` | `loadTenantLicensing` / `isWorkspaceLicensed` — `src/lib/orchestration/licensing.ts:15,37` | `resolveHqContext` / `requireHqContext` — `src/lib/hq/context.ts:174,235` |
| Enforced? | ✅ **Yes, fail-closed.** `NOT_ENTITLED` denies | ⚠ **No.** Explicitly **fail-open** (see below) and `canEnterWorkspace` has **0 call sites outside its own file** | ⚠ `hq_config.mode` defaults to `observe`; refusals are logged to `hq_access_observation`, not enforced, until switched to `enforce` |
| Gate call sites | `requirePracticeContext` — **227 calls / 112 files** (210 in 102 API route files); `resolvePracticeShell` — **64 calls / 62 files**; `hasCapability` — **300 calls / 87 files** | 1 (`/api/me/workspaces`) | `requireHqContext` |

> **CODE** — `src/lib/orchestration/licensing.ts:3-5`: *"FAIL-OPEN + NON-BREAKING: a workspace is
> licence-gated ONLY if mapped to a product (`product_workspaces`); unmapped workspaces, an unknown tenant,
> or an unprovisioned store all resolve to 'available' — so nothing changes until an admin actually maps +
> licenses."*

With `product_workspaces` and `tenant_product_licenses` both at **0 rows**, the platform licensing filter
today gates **nothing**, by design and honestly documented.

## 3.5 Two flag systems — confirmed, and neither is a licensing engine

| | `plat_feature_flags` | `practice_platform_flags` |
|---|---|---|
| Rows | 6 (`simulation_engine`, `executive_intelligence`, `ai_copilot`, `clinical_operations`, `marketplace`, `practice_offline_cache`) | 3 (`practice_pilot_provisioning`=on, `practice_sign_in`=on, `practice_public_signup`=**off**) |
| Scoping | `plat_feature_flag_assignments` — `global/tenant/country/plan/cohort`, precedence tenant > cohort > plan > country > global > default. **0 assignment rows.** | none — a single boolean per flag |
| Helper | `flagState` / `flagEnabled` / `gateFor` — `src/lib/platform/feature-flags.ts:74,128,182` | `platformFlag(admin, flag)` — `src/lib/practice/provisioning.ts:141` |
| Live enforcement gates | **2** — `src/app/hospital-executive/intelligence/page.tsx:36`, `src/lib/practice/offline-gate.ts:59` | **13 in `src/`, 3 in scripts** |
| Fail posture | fail-closed (`unresolved` withholds) | fail-closed (read error → `false`, and it logs why) |

⚠ **The `plat_feature_flags` engine has a working plan-scope dimension that nothing uses.** `scope_type`
already includes `'plan'`, and `flagState`'s precedence already resolves a `planCode`
(`feature-flags.ts:100,165-173`). **This is the closest existing thing to LIC's Feature Registry and it is
0 rows deep.**

## 3.6 The quota model exists and enforces nothing — and says so

`plat_plans.entitlements` jsonb carries `max_users`, `max_hospitals`, `ai_credits`, `storage_gb`,
`api_access` on all six plans. It is editable through `/super-admin/platform-ops/licensing` and
`/api/platform/plans`. It is **displayed** at `src/lib/platform/tenants.ts:80-83` — and that file labels
two of the three:

> **CODE** — `src/lib/platform/tenants.ts:82-83`:
> `{ label: "Storage (GB)", used: null, limit: ent.storage_gb ?? null, note: "not metered" },`
> `{ label: "AI credits", used: null, limit: ent.ai_credits ?? null, note: "not metered" },`

**No quota in this codebase blocks anything.** LIC's "Usage Limit Engine" and BILL §18's eight meters are
greenfield.

---

# 4. ⚠ THE MONEY QUESTION

## 4.1 Is there any payment integration? **Zero. Searched exhaustively; the answer is zero.**

**Dependencies (0 of 22 packages).** `package.json` production dependencies in full:
`@anthropic-ai/sdk`, `@supabase/ssr`, `@supabase/supabase-js`, `@types/qrcode`, `mammoth`, `next`, `qrcode`,
`react`, `react-dom`. Dev: `@tailwindcss/postcss`, `@types/*`, `docx`, `eslint`, `eslint-config-next`,
`tailwindcss`, `typescript`, `vitest`, `xlsx`. Searched `package.json`, `package-lock.json` (296 KB) and
`node_modules/` for: **stripe, @stripe/\*, flutterwave, pesapal, paystack, dpo, mtn, momo, airtel, paypal,
square, braintree, razorpay, adyen, checkout.com, tap, plaid**. Zero. (The only `stripe`/`paystack`
substrings in the lockfile are base64 noise inside `integrity` hashes at lines 6138 and 7670.)

**Environment (0 of 33).** `.env.local` holds **6 keys** — `ANTHROPIC_API_KEY`, `CRON_SECRET`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`VERCEL_OIDC_TOKEN`. Across `src/`, `scripts/` and `next.config.ts` there are **33 distinct `process.env`
reads**; the payment-adjacent count is **zero**. (`TWILIO_*` and `AFRICASTALKING_*` are SMS only — used at
`src/lib/practice/messaging.ts` and `src/lib/notifications/dispatch.ts`. Africa's Talking *does* sell a
mobile-money API; this codebase calls only the messaging side.)

**Routes (0 of 421).** No route under `src/app/api/**` has `webhook`, `pay`, `charge`, `checkout`, `invoice`
or `billing` in its path. Every `webhook` hit in `src/` is the notification dispatcher
(`src/lib/notifications/dispatch.ts:9,35,57,111,114` — an outbound POST gated on `NOTIFY_WEBHOOK_URL`).

**Explicit zero counts**, searched across `src/`, `supabase/`, `scripts/`:
`payment_intent` 0 · `checkout_session` 0 · `card_number` 0 · `cvv` 0 · `iban` 0 · `payment_method` 0 ·
`3ds` 0 · `journal_entry` 0 · `double_entry` 0 · `credit_note` 0 · `refund` 0 · `payout` 0 · `tax_rate` 0 ·
`vat_` 0 · `dunning` 0 · `proration` 0 · `promo_code` 0 · `amount_cents` 0 · `minor unit` 0 · `ISO 4217` 0 ·
`debit` 0 · `KES` 0 · `NGN` 0. `coupon`: **1**, and it is inside a sentence saying the feature does not
exist (`src/app/platform/control-plane/[section]/page.tsx:11`).

**Provider names in source: 4 hits, all prose.**

| Where | Text |
|---|---|
| `src/app/platform/control-plane/billing/page.tsx:56` | *"…need a payment gateway (Stripe / Paystack / Flutterwave). Connect one to activate this."* |
| `src/app/super-admin/settings/page.tsx:46` | `{ label: "M-Pesa Billing", status: false, note: "Planned" }` |
| `src/app/dashboard/osce/page.tsx:455` | marketing copy — *"…digital certificate · M-Pesa accepted"*, with `$25` at :457 |
| `docs/CPR-BUILD-001-v1-respecification.md:139` | *"PCI DSS Compliant"* listed as a trust badge to render |

**The only monetary amount tied to a real transaction anywhere in the schema** is
`sponsorship_requests` (`090-lds-education-planning.sql:67-83`): `amount numeric(14,2)`,
`currency text default 'UGX'`, `amount_disbursed`, `status in ('requested','approved','rejected','disbursed')`,
written by `src/app/api/operations/education-plan/route.ts:69`. It is an employer-sponsorship record.
`disbursed` is a status a human sets. **There is no disbursement mechanism.**

⚠ **Two honesty defects found in passing, both pre-existing and neither caused by these documents:**

1. `src/app/dashboard/osce/page.tsx:455-457` advertises **$25** and **"M-Pesa accepted"** to end users. The
   page has no payment control of any kind, and `src/app/dashboard/billing/page.tsx:260` states
   *"Online payment isn't live yet."* Every other money surface in this codebase is scrupulously labelled;
   this one is not.
2. `docs/CPR-BUILD-001-v1-respecification.md:139` specifies rendering a **"PCI DSS Compliant"** badge. The
   platform handles no cardholder data and has no PCI scope, so that is an unsubstantiated compliance claim.
   I did not find it rendered in any component — it may exist only in the spec. The PAY comp's phrasing
   (*"PCI DSS compliant via providers"*) is the defensible form.

## 4.2 ⚠ A ledger and PCI scope are a programme with legal obligations, not a sprint

The three documents ask, in plain words, for the following. Each is quoted; each is a regulated activity or
a statutory obligation, not a feature.

> **DOC** — PAY *"Supported Providers"*: Stripe · Flutterwave · Pesapal · Paystack · MTN Mobile Money ·
> Airtel Money · Bank Transfer · Manual/Cash. **Eight integrations, six of them distinct settlement rails.**

> **DOC** — PAY *"Core Components"*: … **Refund & Credit Note Engine** · **Tax & Currency Engine** ·
> **Financial Ledger** …

> **DOC** — PAY comp, *Ledger & Reconciliation*: *"Financial Ledger — **Double entry style ledger** for all
> financial transactions"*; *"**Payouts** — Record payouts to partners, affiliates, agents or refunds."*

> **DOC** — PAY comp, *Tax Management*: *"Country based tax rules (e.g. VAT, GST) · Multiple tax rates per
> product/plan · Tax inclusive or exclusive pricing · Automatic tax calculation on invoices · **Tax reports
> for compliance**."*

**What each of those actually commits Competen to:**

| Requirement | The obligation behind it |
|---|---|
| **Card acceptance** (PAY comp: *"Visa, MasterCard, Amex"*) | PCI-DSS scope. It is minimal (SAQ-A) **only if** the platform never touches a PAN — provider-hosted fields or full redirect, no card data in any log, no card data in any DOM the platform serves. A single self-hosted card field moves this to SAQ-D and an annual assessment. **This is an architectural constraint on day one, not a certification exercise at the end.** |
| **Tax calculation and tax reports** | VAT registration and filing in each jurisdiction where Competen has a taxable supply. Uganda's URA imposes obligations that include, for many taxpayers, fiscalised e-invoicing (EFRIS). A field called `tax_rate` does not discharge any of that, and **getting it wrong is a liability to the revenue authority, not a bug**. BILL §37 explicitly disclaims *"Automated statutory tax filing"* and *"Tax advice / statutory filing"* (§3) — good, but that disclaimer is in BILL, and PAY's comp promises "tax reports for compliance" without it. |
| **Refunds** | A consumer-facing commitment. Somebody must own the policy, the SLA and the funding of a refund that has already been swept to a settlement account. |
| **Payouts to "partners, affiliates, agents"** | ⚠ **This is money transmission on behalf of third parties**, which is a categorically different regulatory posture from collecting your own subscription fee, and in several jurisdictions requires licensing or a licensed partner. **It should be struck from Phase 1 explicitly.** BILL §37 already disclaims *"Marketplace split payments"* and *"Multi-party commissions"*; the PAY comp reintroduces them. |
| **Double-entry ledger** | Once a ledger is the record of what customers were charged, it is a financial record. It must be append-only, reconcilable, and retained. ⚠ [CPR-LIFE] already recorded that `practice_audit_event` **is not append-only**; the same mistake in a money ledger is not recoverable by re-running a job. |
| **Mobile money (MTN, Airtel)** | Per-country merchant onboarding, KYC on the merchant entity, settlement accounts, and callback security models that differ per provider. Each is its own commercial relationship before it is code. |

**REC — say this in the plan, not in a footnote:** the payment layer is a **programme with an external
dependency chain that code cannot shorten** — merchant accounts, KYC, tax registration, a refund policy
with a named owner, and a decision about card scope. Estimating it in sprints will produce a schedule that
is wrong for reasons no engineer can fix. **Everything in §5 below is designed so that Practice can charge
its first customer without entering that programme.**

---

# 5. Genuine build, mapping document, or duplicate — with the evidence

## 5.1 PCS-CAP-BILL-001 — **genuine build. ~18% of Phase 1 exists.**

Measured against BILL's own §30 "Phase 1 Implementation Baseline", which lists **10 must-haves**. Each row
is a list you can open.

| # | BILL §30 must-have | Live | Evidence |
|---|---|---|---|
| 1 | Product catalogue + **plan versions** | **~35%** | `plat_products` 7 rows / 9 §6 fields present as 3 (`code`,`name`,`description`); missing `status`, `saleable`, `entitlement_namespace`, `default_market`, `metadata`. `plat_plans` 6 rows but **no `product_id`** — plans are not scoped to a product. **Plan versions: 0.** |
| 2 | UGX price book; monthly/annual/one-time prices | **~5%** | `plat_plans.price_monthly numeric` + `currency char(3)`. One price per plan, one interval, one currency. All six rows are `0 USD`. No price book, no annual, no one-time, no effective dating. |
| 3 | Founder offer capped at 250 | **0%** | No `offers` table (`PGRST205`). No redemption counter. |
| 4 | Individual billing accounts | **~30%** | `plat_billing_accounts` exists (0 rows) with `legal_name`, `tax_id`, `billing_email`, `gateway_customer_ref`, `currency`, `balance`. ⚠ It is keyed `tenant_id → tenants(id)` **only**. BILL §10 requires `owner_type PERSON / ORGANISATION` and a Practice owner is a **person**, not a tenant. |
| 5 | Subscription state machine | **~15%** | `plat_subscriptions.status` has **4** of BILL §11's **10** states (`trialing, active, past_due, canceled`; missing `DRAFT, GRACE, PAUSED, CANCEL_SCHEDULED, EXPIRED, SUSPENDED`). There is **no transition service**: `changeSubscription` (`src/lib/platform/commercial.ts:42`) inserts a row and cancels the old one directly, which BILL §11's callout prohibits — *"Direct database status edits are prohibited in normal operations."* |
| 6 | Trial + grace configuration | **~20%** | `plat_subscriptions.trial_ends_at` and `practice_plans.trial_days` exist. **Grace: zero** — the 9 `grace_period` hits in the repo are all reassessment schedule grace (`007-configurable-content.sql:109,188`). |
| 7 | Manual settlement + one online-provider handoff | **0%** | §4.1. |
| 8 | Activation/expiry events to entitlement service | **~10%** | `plat_platform_events` exists and `043:38` names `subscription.changed`/`billing.failure` as intended types. **None of BILL §20's 12 events is emitted.** `practice_entitlement` is written once, at provisioning (`provisioning.ts:337`), and never again. |
| 9 | Admin subscription search/actions | **~40%** | Existing screens: `/platform/control-plane/{products,subscriptions,billing,feature-flags}`, `/platform/staff/finance`, `/super-admin/platform-ops/{licensing,portfolio}`. Against BILL §22's 9 screens: Products ✅, Plans ⚠ (no versioning), Pricing ⚠ (one number), Subscriptions ✅ read, Billing Accounts ⚠ read-only, Offers ❌, Operations Queue ❌, Configuration ❌, Audit Log ⚠ (`plat_audit_events` exists, not surfaced as a billing log). |
| 10 | Audit logs + idempotency | **~30%** | `plat_audit_events` and `practice_audit_event` exist and are used. **Idempotency keys: 0** — `grep` for `idempotency` returns nothing. BILL §21.1 requires them on every financially material write. |

**Domain model (BILL §5, 13 entities): 3 present, 2 partial, 8 absent.**
Present — `Product`, `Plan`, `Subscription`. Partial — `Price` (a column, not an entity),
`Customer Billing Account` (tenant-keyed). Absent — `Plan Version`, `Price Book`, `Offer`,
`Subscription Item`, `Billing Period`, `Adjustment`, `Usage Meter`, `Usage Record`.

**Aggregate: ~18% of BILL Phase 1 exists** (mean of the ten rows, weighted by nothing — treat it as a
range of 15–25%, and note that the two heaviest rows, 3 and 7, are at zero).

## 5.2 PCS-CAP-LIC-001 — **mapping document, ~85% restatement. But the ~15% is the important part.**

Bullet-by-bullet against prior text:

| LIC section (bullets) | Already stated in | New? |
|---|---|---|
| Objectives (4) | BILL §2 bullets 1–3, BILL §19 | ❌ |
| Core Components (7) — Licence Registry, Entitlement Engine, **Feature Registry**, Activation Engine, Usage Limit Engine, Role & Permission Integration, Audit & History | BILL §19 + §18; PLAT-CAP-001 §3 | ⚠ **"Feature Registry" is new as a named store** |
| Licence Types (6) | BILL §7 plan types (5), + `Educational/Student` | ⚠ 1 new |
| Entitlement Model (6) | BILL §19 table + §18 meters | ❌ |
| Activation Flow (5) | BILL §11 + §19 read backwards | ❌ |
| Administration (5) | BILL §17 + §22 | ❌ |
| Acceptance Criteria (4) | BILL AC-09 says the same thing | ❌ |

**The 15% that matters, and it is genuinely absent from the codebase:**

1. **A Feature Registry** — a table of purchasable product features, distinct from the 50 practice
   permission codes. Nothing like it exists (§3.5: the nearest thing is 6 feature-flag keys with a plan
   scope dimension at 0 rows).
2. **Licence states as a first-class model** — the LIC comp's `Active / Trial / Grace / Paused / Expired /
   Cancelled`. `practice_entitlement.status` already has five of the six
   (`active, trial, expired, suspended, cancelled` — missing `grace`, having `suspended` instead of
   `paused`). **This is one CHECK-constraint change, not an engine.**
3. **`Educational / Student` licence type** — the only commercial idea in LIC that appears nowhere else,
   and it matters given [COMPETEN-STRATEGY-001]'s nursing-school wedge.

**REC:** LIC as written is not buildable and does not need to be built as a separate thing. Fold points 1–3
into BILL and retire the document, or **ask for a v2 written to the same standard as BILL**.

## 5.3 PCS-CAP-PAY-001 — **genuinely new subject, ~0% built, and not specified enough to build.**

| PAY "Core Components" (8) | Live |
|---|---|
| Payment Provider Adapter Layer | **0%** |
| Payment Orchestrator | **0%** |
| Invoicing Engine | ⚠ `plat_invoices` table exists, **0 rows, 0 code references except one UI string**. No line items, no tax lines, no numbering sequence |
| Receipt Engine | **0%** |
| Refund & Credit Note Engine | **0%** — `refund` and `credit_note` return zero across the repo |
| Tax & Currency Engine | **0%** — `tax_id` is a column on `plat_billing_accounts`; there is no tax rule anywhere |
| Financial Ledger | **0%** — the 100+ `ledger` hits in `src/` are the **clinical session pause ledger** (`src/lib/practice/session.ts`, `activity.ts:510`) |
| Notification Service | ✅ **exists** — `src/lib/notifications/dispatch.ts`, Resend + Twilio + Africa's Talking + webhook |

**1 of 8 components exists, and it is the one PAY borrows rather than builds.** Of the 8 named providers,
**0** have an adapter, a credential, an account, or a line of code.

⚠ **PAY's 69 lines do not specify: idempotency key strategy, webhook signature verification per provider,
the currency-rounding rule, the invoice-number sequence and its gap policy, the reconciliation window,
partial-refund semantics, or the ledger's account chart.** Its four acceptance criteria include
*"Duplicate callbacks are idempotent"* with no mechanism named. **REC: this document cannot be estimated,
let alone implemented, in its current form.**

---

# 6. What Competen Practice actually needs to charge its first customer

**Scale is not the constraint.** Live: `practice_workspace` **2 rows**, `practice_membership` **4 rows**,
2 patients, 0 handles claimed, `practice_public_signup` **off**. The constraint is that money is
irreversible and access decisions are not.

**REC — the minimum honest path. Six steps, no payment gateway, no ledger, no tax engine.**

| # | Step | Why it is the minimum | What it is not |
|---|---|---|---|
| **M1** | Insert `practice` into `plat_products`, and give `practice_entitlement.product_code` a foreign key to it. | The column already exists and already defaults to `'practice'` (`191:138`) — it is text pointing at nothing. This is **one row and one constraint**, it closes the `null` that mig 260 had to write, and it is the cheapest useful change in the repo. [PLAT] D5, which the user has now settled. | Not a product registry. Not a composition engine. |
| **M2** | Add a **priced** plan row for Practice — `practice_standard` already exists in `practice_plans` with no price column. Add `price_minor int`, `currency char(3)`, `interval text`. | BILL §29's launch config is `UGX 75,000 monthly / UGX 750,000 annual / UGX 50,000 founder lifetime`. **Today `practice_plans` cannot express a price at all**, and `plat_plans` can only express one monthly USD number. | Not a price book. Not multi-market. One currency, decided in D5. |
| **M3** | Extend `practice_entitlement.status` to include `grace`, and add `plan_code`-aware expiry. The enforcement point already exists and already denies. | `access.ts:92-99` already refuses on `NOT_ENTITLED`, on the **database clock**, fail-closed. **The hardest part of billing enforcement is already built and tested.** Adding grace is a CHECK constraint plus one branch. | Not a state machine. Not a scheduler yet. |
| **M4** | **A manual settlement record**: one table — who paid, how much, in what currency, when, by what method, recorded by which operator, with a reference. Activating an entitlement requires a settlement row. | BILL §17 is explicitly designed for this: *"To accelerate CP commercialisation, the platform must support manual settlement alongside an online provider. This allows bank transfer, mobile-money collection outside the gateway, cash or exceptional administrative settlement while retaining a proper subscription and audit trail."* Uganda mobile money already works without an API — a practitioner sends money and an operator records it. | Not a payment gateway. Not a ledger. Not reconciliation. |
| **M5** | An **expiry job** that moves `active`/`trial` past `ends_at` into `expired`, idempotently, catching up after downtime. | BILL AC-08: *"Trial and grace expiry are handled automatically after downtime/retry."* Without it, an unpaid trial serves forever — the same class of failure as billing someone twice, in the other direction. Three cron jobs already exist and are governed by `cdp_delivery_config`; this is a fourth of the same shape. | Not renewals. Not dunning. |
| **M6** | An **operator screen**: list practices, entitlement status, plan, expiry; record a settlement; extend; suspend. With an audit row per action. | BILL §22's Subscriptions + Operations Queue, reduced to what two workspaces need. `practice_audit_event` already exists. | Not nine screens. |

**That is the whole minimum path: two migrations, one job, one screen, zero payment integrations.** Under
it, Competen can charge a real customer — by bank transfer or mobile money, collected outside the platform —
and the platform will correctly grant access for the period paid for and correctly stop at the end of it.

**What M1–M6 deliberately do NOT do, and must be said out loud when they ship:** no card acceptance, no
automatic renewal, no invoice document, no tax calculation, no refund mechanism, no self-service upgrade.
Each of those is a promise, and a half-made promise about money is worse than no promise (§10).

**The full BILL specification is the right destination.** The gap between M1–M6 and BILL §30 is: plan
versioning, price books, the founder offer with a race-safe cap of 250, the 10-state machine, the 12 events,
usage meters, and the gateway. **None of those is needed to take the first payment; all of them are needed
before the hundredth.**

⚠ **One thing M1–M6 cannot defer: the founder offer.** BILL §9 and AC-04 require *"a configurable offer
with a hard redemption limit and an auditable redemption sequence"* capped at exactly 250 with no
race-condition oversubscription — and BILL's callout forbids the shortcut in the same breath:
*"Do not implement founder status as a manually coded exception in CP."* If the founder offer is part of
the launch, it is **M4a**, not later, because retrofitting a counter after redemption 300 means telling 50
people they are not founders.

---

# 7. ⚠ The overlap with the entitlement we already enforce

## 7.1 The brief's premise is half right, and the correction is good news

> The brief: *"if a capability registry ships and `requirePracticeContext` does not consult it in the same
> call as `hasCapability`, then a feature disabled at product level while `document.sign` is still granted
> means the button is hidden and the API still signs."*

**The mechanism described is exactly right. The claim that `requirePracticeContext` does not consult
entitlement is wrong — it already does, in the same call, fail-closed.**

> **CODE** — `src/lib/practice/api-context.ts:14`:
> `export async function requirePracticeContext(capability: string | null): Promise<PracticeApiContext | NextResponse>`
> — and at `:32-34`: `if (capability && !hasCapability(res.ctx, capability)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });`

The `ctx` it tests comes from `resolveWorkspaceContext`, which **reads `practice_entitlement` before it
reads `practice_role_assignment`** and returns a refusal instead of a context if there is no live
entitlement:

> **CODE** — `src/lib/practice/access.ts:92-101`: two queries against `practice_entitlement`
> (`status in ('active','trial')`, `starts_at <= now`, open-ended **or** `ends_at >= now`), then
> `if (ents.length === 0) return { ok: false, reason: "NOT_ENTITLED" };`

> **CODE** — `src/lib/practice/access.ts:10-13`: *"Guard evaluation order follows SHELL-001 §6.1 exactly —
> authentication, workspace, membership, workspace status, entitlement, onboarding — because evaluating
> capability before membership leaks which routes exist to non-members."*

**`hasCapability(ctx, cap)` is a pure array test (`access.ts:154`) on an array that can only exist if the
workspace was entitled.** The described failure cannot occur for *workspace-level* entitlement. That
property is worth defending explicitly, because it was clearly designed rather than stumbled into.

## 7.2 ⚠ Where the hazard really is: there is no *feature-level* dimension, and `plan_code` is decorative

`practice_entitlement.plan_code` is written once at provisioning and **read for display only**:

- `src/lib/practice/operations-home.ts:129` → `plan: entitlement?.plan_code ?? null` (rendered)
- `src/app/practice/(shell)/layout.tsx:140,156` → renders `"Trial"` or `"Licensed"` from `entitlementStatus`

**No access decision anywhere consults which plan the practice is on.** A `practice_trial` workspace and a
`practice_standard` workspace get identical capability arrays, because capabilities come from the
**role**, not the plan. So today:

- Entitlement is **binary** — entitled or not.
- Capability is **role-derived** — 50 codes from `practice_role_capabilities` by `role_code`.
- **There is no third axis.** A Feature Registry would be that third axis, and nothing intersects it.

**The exact failure the brief describes will occur the moment a Feature Registry ships**, if features are
resolved anywhere other than inside `resolveWorkspaceContext`. Example: `document.sign` is a
`practitioner` role default (`practice_role_capabilities`), so a practice on a plan that does not include
`Documents` would still have `document.sign` in `ctx.capabilities`, and
`requirePracticeContext("document.sign")` would return `{ caller, ctx }` — **200, signed** — while the
sidebar, built from `primaryNav(ctx.capabilities)` in `src/app/practice/(shell)/layout.tsx`, could be
filtered separately and hide the button. Hidden UI, live API. Exactly as described.

## 7.3 ⚠ Every place that would have to change — and why it should be ONE place

**REC: intersect the feature entitlement inside `resolveWorkspaceContext` before `capabilities` is
returned.** Then 227 + 300 + 64 call sites inherit it and **none of them changes**. If instead each route
is taught to check features, there are 210 edits and the first one anybody forgets is a silent hole.

**The one place to change:**

| # | File / symbol | Why |
|---|---|---|
| **1** | `src/lib/practice/access.ts:74` `resolveWorkspaceContext` | ⚠ **THE choke point.** Reads entitlement at `:92`, capabilities at `:125`. Intersecting `capabilities` against the plan's feature set here, and adding a `NOT_LICENSED` reason beside `NOT_ENTITLED`, closes the hole for the API path and the page path simultaneously. |

**The places that must be *audited* even under the one-place fix, because they read `ctx.capabilities`
directly rather than through `hasCapability`, or bypass `ctx` entirely:**

| # | File / symbol | Exposure |
|---|---|---|
| 2 | `src/lib/practice/api-context.ts:14` `requirePracticeContext` | **227 calls / 112 files** (210 in 102 API routes). Inherits the fix — but its 403 body must distinguish "you lack the permission" from "your practice has not bought this", or support cannot triage. |
| 3 | `src/lib/practice/shell.ts:67` `resolvePracticeShell` | **64 calls / 62 files.** `ShellState` already carries `ACCESS_RESTRICTED` with `reason: "WORKSPACE_INACTIVE" \| "NOT_ENTITLED"` — the natural place for a third reason. |
| 4 | `src/app/practice/(shell)/layout.tsx` | Builds the sidebar from `primaryNav(ctx.capabilities)` + `SIDEBAR_SECTIONS`, and inlines `ctx.capabilities.includes("task.view")` / `("inbox.record")`. ⚠ **If navigation is filtered by a different rule from the API, the two rules will diverge.** Filter both from the same intersected array. |
| 5 | `hasCapability` direct call sites — **300 calls / 87 files** | Heaviest: `intelligence.ts` (36), `parameters.ts` (30), `metrics.ts` (17), `longitudinal.ts` (16), `patients/[patientId]/page.tsx` (14), `patient-workspace.ts` (13), `medication.ts` (12). All read `ctx.capabilities`, so all inherit — **provided nobody constructs a `WorkspaceContext` by hand.** |
| 6 | ⚠ `src/lib/practice/patient-booking.ts:369` | **Constructs a `WorkspaceContext` literal with `entitled: true, entitlementStatus: null`** for the public booking path. This is a deliberate, documented bypass for unauthenticated patients — and it is exactly the shape that would silently grant every feature under a new intersection. **Must be handled explicitly, not inherited.** |
| 7 | `src/lib/practice/offline-gate.ts:56` `offlineCacheGate` | Already ANDs a platform flag with a per-workspace switch. The **only existing example** of a product-level gate on the Practice plane; a feature registry must compose with it, not duplicate it. |
| 8 | `src/lib/practice/provisioning.ts:337` (step 5, `create_entitlement`) | **The only site that ever creates an entitlement row.** A plan → feature-set resolution has to happen here or the first workspace is licensed for nothing. |
| 9 | `src/lib/access/scan.ts` (`PRACTICE_CALL` regex at `:80`) → `src/lib/access/matrix.generated.json` | ⚠ **The access-matrix scanner parses `requirePracticeContext(...)` textually.** Changing its argument shape makes routes report as `unknown`. [tenant-scoping-bug-class] records that this scanner was already **stale by 112 routes and classified 98 gated routes as open**. Teach it in the same commit. |
| 10 | `src/lib/orchestration/entitlements.ts:77` `canEnterWorkspace` | A **third** entitlement engine with **0 call sites outside its own file**, despite its header calling itself *"the server-side re-auth primitive every landing/launch/deep-link should use."* Reconcile or delete — do not let a fourth grow beside it. |
| 11 | `src/lib/hq/context.ts:235` `requireHqContext` | The HQ plane's equivalent. Separate axis; needs its own decision about whether platform staff see products the tenant has not licensed. |
| 12 | `src/proxy.ts` | ⚠ **There is no `src/middleware.ts`.** `proxy.ts` refreshes the session and stamps headers, and its own header quotes Next's warning that it *"should not be used as a full session management or authorization solution."* **It is not a hook point.** [PLAT] §7 already noted the absence of middleware as the one real coupling between documents. |

**Harnesses that must be extended in the same change**, or the new gate ships unproven:
`scripts/practice-provisioning-harness.ts` (asserts `entitlements === 1`),
`scripts/practice-signup-harness.ts:158` (*"an entitlement was created"*), `scripts/practice-pilot-gate.ts`,
`scripts/platform-flag-gate-harness.ts`, `scripts/umw-permissions-harness.ts`, `scripts/hq-guard-harness.ts`,
`scripts/verify-licensing.mjs`, `scripts/gen-access-matrix.ts`.

⚠ **And the control that proves it can say NO:** a harness that grants a role capability, removes the
feature from the plan, calls the API directly (not the page), and **asserts 403**. Without that assertion
the intersection is unproven, and [tenant-scoping-bug-class] records two silent write failures that passed
every green harness in this repo.

---

# 8. Sequencing — what must exist before what

**Dependency order taken from the documents' own text:**

> **DOC** — BILL §36 *"Dependencies"*: Platform Identity · Organisation Service · **PCS-CAP-PAY-001**
> (payment methods, collection, settlement, invoicing, refunds, tax execution) · **PCS-CAP-LIC-001**
> (entitlement bundles, feature access, limits, activation) · Notification Capability · Audit/Observability
> · Configuration Service.

> **DOC** — BILL §31 *"Recommended Implementation Sequence"*, steps 1–10, in which **PAY does not appear
> until step 7** and LIC until step 6.

BILL's own sequence therefore says: **schema → state machine → admin config → founder offer → schedulers →
events to LIC → PAY.** That is correct, and it means **PAY is last** — which is fortunate, because it is
the one with the external dependency chain.

**REC — the actual order, with what is independently useful marked:**

| Stage | What | Independently useful? | Blocked by |
|---|---|---|---|
| **0** | ⚠ **Settle D1–D8 (§9).** Currency, per-practitioner-or-per-practice, card scope, refund owner, the capability naming ban. | — | nothing |
| **1** | `practice` row in `plat_products` + FK from `practice_entitlement.product_code` (**M1**) | ✅ **Yes.** Removes the `null` mig 260 had to write; makes `plat_feature_flags` scopable to Practice; one row. | D5 |
| **2** | Price on the Practice plan (**M2**) + grace state (**M3**) | ✅ Yes — makes the trial→paid boundary expressible | D1 currency |
| **3** | Manual settlement record + operator screen (**M4**, **M6**) | ✅ **Yes — this is the step that lets Competen take money.** | D4 refund owner, D6 who is billed |
| **3a** | Founder offer with race-safe cap (**M4a**) | ⚠ Only if the founder offer launches. **Cannot be retrofitted** after over-redemption. | D3 |
| **4** | Expiry/grace job (**M5**) | ✅ Yes — stops serving the unpaid | stage 2 |
| **5** | **Feature Registry** + intersection in `resolveWorkspaceContext` (§7.3) + the 403-asserting harness | ⚠ **Only useful if a plan actually withholds a feature.** Building it before that is a gate over an empty set. | stage 2, D8 |
| **6** | BILL's full model — plan versions, price books, offers, the 10-state machine, the 12 events, usage meters | ✅ Each is independently useful once there is more than one plan and more than one market | stages 1–5 |
| **7** | **PAY — one provider, card scope decided, tax posture decided** | ❌ **Not independently useful and not independently possible.** Merchant onboarding, KYC and tax registration are prerequisites that no sprint contains. | D2, D4, D7, and an external chain |

⚠ **What is orthogonal to all of it:** the routing migration ([PLAT] §1). Billing needs no URL. A billing
build and a `/practice/{handle}` build do not touch the same files and can proceed in either order.

⚠ **What must NOT be built in parallel with this:** anything else that touches
`src/lib/practice/access.ts`. [three-arcs-launch-plan] establishes per-arc file ownership precisely so
arcs cannot collide, and `access.ts` is the one file every stage above eventually edits.

---

# 9. ⚠ Decisions that need the user, and why none can be inferred

| # | Decision | Why it cannot be inferred |
|---|---|---|
| **D1** | ⚠ **What currency does Practice sell in, and is there more than one?** | BILL §29 proposes **UGX 75,000 / 750,000 / 50,000**. The live `plat_plans` are **USD 0**; `plat_billing_accounts.currency` and `plat_invoices.currency` default `'USD'`; `tenants.currency` defaults `'USD'`; the only UGX in the schema is `sponsorship_requests.currency default 'UGX'`. The PAY comp lists six currencies. **BILL §8.2 forbids resolving this at runtime** — *"A currency conversion rate must not silently alter a configured market price. Each market may carry an independently approved price."* One currency is a column default; two is a price book, which is a different schema. |
| **D2** | ⚠ **One capability or three?** Do LIC and PAY get built as separate engines, or folded into BILL? | The BILL comp draws **one** engine containing all fifteen parts; BILL §3 and §39 draw **three**, and §39 calls the separation *"the key architectural boundary."* The document and its own illustration disagree (§0.2, C1). This decides the migration count, the table prefixes and the API surface. |
| **D3** | ⚠ **Is Practice billed per practitioner or per practice?** | `practice_entitlement` is keyed **`workspace_id`** — per practice. BILL §29 says *"first 250 eligible **practitioners**"* and §10 permits `owner_type PERSON`. `practice_membership` allows many members per workspace ([PLAT] D2 records that one person may hold two practices). **These give different revenue on the same customer**, and switching later re-keys the entitlement table. `plat_subscriptions.seats_purchased` exists, unused and null on all 6 rows. |
| **D4** | ⚠ **Who owns refunds — the policy, the SLA, and the money?** | PAY names a *"Refund & Credit Note Engine"*; BILL §23 gives `Finance Admin` the power and §17 requires *"Financial role only"* for a write-off. **No such role holder exists.** `hq_position` has a `chief_financial_officer` (0 appointments — `ogs_office_appointments` is **0 rows**). A refund engine with nobody authorised to press the button is a screen, not a control. |
| **D5** | ⚠ **Which tax jurisdiction(s), and is Competen registered in them?** | The PAY comp promises *"Country based tax rules (e.g. VAT, GST)"* and *"Tax reports for compliance"*; BILL §3 and §37 **explicitly disclaim** *"Tax advice / statutory filing"*. Uganda's regime (including fiscalised e-invoicing for many taxpayers) imposes obligations a `tax_rate` column does not discharge. **Whether an invoice must be fiscalised is a legal fact about Competen's registration, not a schema choice.** |
| **D6** | ⚠ **Card acceptance: yes or no — and if yes, provider-hosted only?** | The PAY comp lists *"Online Card Payments — Visa, MasterCard, Amex"* **and** *"No card data stored on platform"*. Those are compatible only under provider-hosted fields or full redirect. **This is an architecture constraint on day one.** One self-hosted card input moves the platform from SAQ-A to SAQ-D and an annual assessment. |
| **D7** | ⚠ **Are payouts to third parties in scope?** | The PAY comp says *"Payouts — Record payouts to partners, affiliates, agents or refunds"*; BILL §37 disclaims *"Marketplace split payments"* and *"Multi-party commissions"*. **The documents contradict each other, and the difference is a regulatory category** (collecting your own fee vs transmitting money for others). |
| **D8** | ⚠ **D4 from [PLAT], still open: what does "capability" mean?** | Now **six** senses (§2), and these documents add the sixth. Sense 1 has 50 live codes and 300 `hasCapability` call sites; sense 5 has zero rows. A Feature Registry whose rows are called capabilities will be read as sense 1 by the next person, and `string` will not stop them. |
| **D9** | ⚠ **Which of the four commercial specs is retired?** | `LCP-001` (migs 042/043, **no `docs/` file**), `PCS-PORT-001` (migs 105/106), `PROV-001` (mig 191), `PCS-CAP-BILL-001`. Four specs, three live table sets, one unwritten document. **Nothing can be built coherently until it is decided which of `plat_plans` / `practice_plans` / `products` is the catalogue.** |
| **D10** | ⚠ **Does the founder offer launch, and with what cap?** | BILL §9 and AC-04 require a hard cap of **250** with *"no race-condition oversubscription"* and an auditable redemption sequence. **This cannot be retrofitted** — the 251st redemption is a promise already made. If it launches, it is stage 3a, not stage 6. |
| **D11** | ⚠ **Is `plat_products` the product registry, given the comp's list shares nothing with it?** | Live: `competency, mclip, lms, simulation, passport, coe, pce`. Comp: `CP, CR, CL, CC, CA`. **Empty intersection** (§0.2, C2). Either the seven rows are stale and Practice/Recruitment/Construction/AFCAN are the real portfolio, or the comp is aspirational. **`plat_products.code` is a primary key referenced by `plat_feature_flags` and `tenant_product_licenses`**, so the answer changes what M1 inserts. |
| **D12** | **Where does the customer-facing purchase surface live?** | `src/app/dashboard/billing/page.tsx` (348 lines) already exists with a **hardcoded** catalogue (`"Free"`, `"$4/mo"`, `"Custom"`, `"Custom"` at :35-40) and a `mailto:` upgrade CTA at :277-280. Its header comment (:11-13) lists what it deliberately does not fake. It serves the *competency* estate, not Practice. Whether Practice reuses it or gets its own surface decides whether the hardcoded catalogue is deleted or forked. |

---

# 10. ⚠ What a half-built version destroys

**Money is the one domain in this codebase where a partial build is worse than none.** Everywhere else a
half-built feature shows an empty state. Here it takes money it should not have taken, or serves work it
was not paid for, and both are visible to the customer before they are visible to us.

**Concretely, in this codebase, with these tables:**

| # | The half-build | What it destroys |
|---|---|---|
| **H1** | **Prices configured, expiry job not shipped.** M2 without M5. | Every trial serves **forever**. `practice_entitlement.ends_at` is already written at provisioning (`provisioning.ts:337`, `trial_days = 30`) and `access.ts:96` already refuses past it — **so this specific failure is currently closed.** But the moment a paid plan exists with `ends_at = null` (which `practice_plans.trial_days` being null already produces for `practice_standard`), an unpaid customer is served indefinitely with no signal anywhere. **Check `ends_at` nullability before shipping any paid plan.** |
| **H2** | **Settlement recorded, entitlement not linked.** M4 without the activation rule. | Two records of truth: a settlement row saying paid, an entitlement row saying trial. Support answers from whichever they open first. BILL §26's *"Reconciliation check — detect subscription/payment state mismatches"* exists precisely because this happens. **With 2 workspaces it is a conversation; with 200 it is unrecoverable without a reconciliation the spec puts in step 9 of 10.** |
| **H3** | ⚠ **Feature Registry shipped, intersection not in `resolveWorkspaceContext`.** §7.2. | The button is hidden and the API still signs. **A signed clinical document created through a feature the practice did not buy is not a billing error — it is a clinical record with a disputed provenance**, and mig 194's DB-enforced signed-immutability means it cannot be quietly removed. This is the single worst outcome in this report. |
| **H4** | ⚠ **Founder offer without the race-safe cap.** BILL AC-04 skipped. | Redemption 251 through 300 were told they were founders. There is no technical remedy: you either honour a lifetime price you did not intend, or you tell fifty early customers the offer they accepted was not real. **BILL §9's callout — *"Do not implement founder status as a manually coded exception in CP"* — exists because the manual version always over-redeems.** |
| **H5** | **Grace state added, grace policy not configured.** | `GRACE` becomes a status nobody set a duration for. BILL §13 opens: *"Grace is a deliberate business policy and must not be inferred ad hoc by the application."* Ad-hoc grace means one customer gets 7 days and another gets whatever the code path happened to do. |
| **H6** | ⚠ **A gateway connected before idempotency keys exist.** | `grep idempotency` → **0 hits in the repo.** Payment providers retry webhooks by design. Without a persisted key, a retried callback double-extends a subscription or double-charges. BILL §21.1 and AC-07 both require it; §33's test *"Payment-provider callback repeats → Settlement remains idempotent"* is the assertion. ⚠ **And [tenant-scoping-bug-class] records the partial-index upsert trap in this exact codebase: two silent write failures because an upsert's error was discarded.** The same shape in a settlement path silently loses a payment. |
| **H7** | **Invoices issued from `plat_invoices` as it stands.** | `amount numeric` (exact decimal — so BILL §24's *"never floating-point"* is satisfied) but **not integer minor units** as §21.1 and §24 require, **no line items, no tax lines, no numbering sequence, no gap policy**. An invoice with a gap in its number sequence is a question from a revenue authority, not a bug report. |
| **H8** | ⚠ **`plat_products` gets a `practice` row and nothing else changes.** M1 alone. | Harmless — and worth saying, because M1 is the one step that is safe on its own. It closes the `null` in mig 260, makes flags scopable to Practice, and gates nothing. **This is the correct first commit.** |
| **H9** | **Two catalogues left live.** D9 unanswered. | `plat_plans` (6 rows, USD 0) and `practice_plans` (2 rows, no price column) both describing what a customer can buy. The Finance page already computes MRR from the first and labels it honestly (*"list price 0 on seeded plans"*, `finance/page.tsx:52`). **Add a price to the wrong one and the platform's own revenue figure is wrong** — and it is wrong on a page an executive reads. |
| **H10** | ⚠ **A "PCI DSS Compliant" badge with no PCI scope.** Already specified at `docs/CPR-BUILD-001-v1-respecification.md:139`. | A false compliance claim on a marketing page is a legal exposure independent of any code. **Fix the spec line before anyone renders it.** |

**The single sentence for the plan:** *nothing that charges a customer ships without the expiry job, the
idempotency key and the 403-asserting harness in the same commit.*

---

# 11. ID collisions and numbering

Checked every ID in the three documents against `docs/`, `src/`, `scripts/`, `supabase/`.

| ID | Status |
|---|---|
| **`PCS-CAP-BILL-001`** | ✅ **No collision.** Zero occurrences in the repo before today. ⚠ **New ID shape**: this is the first four-segment ID in the `PCS-` family (`PCS-CAP-001`, `PCS-PORT-001` are three). It reads naturally as a child of `PCS-CAP-001` — see the caveat below. |
| **`PCS-CAP-LIC-001`** | ✅ No collision. |
| **`PCS-CAP-PAY-001`** | ✅ No collision. |
| **`PCS-CAP-NOT-001`** | ⚠ **Referenced but does not exist.** The PAY comp's *"Related Capabilities"* footer names `PCS-CAP-NOT-001 — Notifications & Communications`. **Zero occurrences in the repo, no `.docx` in `~/Downloads`.** A fourth sibling is being cited before it is written — the same pattern as `PLAT-ROUTE-002` citing a `PLAT-ROUTE-001` that [PLAT] §5 proved does not exist. **Ask whether it is coming.** |
| **`PCS-CAP-001`** | ⚠ **Still contested.** [PLAT] §5 established `PLAT-CAP-001` is a lower-resolution re-issue of it and recommended retiring `PLAT-CAP-001`; [PLAT] D8 is still open. **These three documents settle it in practice** — they all descend from `PCS-CAP-001`, not `PLAT-CAP-001`. **REC: retire `PLAT-CAP-001`, keeping only its §7 Composition Engine.** |
| ⚠ **`LCP-001`** | ⚠ **A live, undocumented, pre-existing collision — two different specs share this ID.** (a) The **platform Licensing/Control Plane** spec cited by `042-platform-control-plane.sql:36,54,74,90` and `043-control-plane-phase2.sql:7,21,37` as §4/§5/§9/§15 — **it created `plat_plans`, `plat_subscriptions`, `plat_billing_accounts` and `plat_invoices`, and there is no `docs/` file for it.** (b) **`CPR-LCP-001`** — *Configurable Longitudinal Clinical Parameters & Patient Monitoring Engine*, 36 references in `docs/CPR-CLINICAL-SURVEY-001.md`. ⚠ **A grep for `LCP-001` returns both, and one of them is the billing schema.** Anybody researching billing history will land in the clinical parameters survey. |
| **`PCS-PORT-001`** | ✅ Exists and is live — 16 references, migs 105/106, `/super-admin/platform-ops/portfolio`, `scripts/verify-licensing.mjs`. **It already owns product→workspace licensing.** BILL §5's `Product` entity and PCS-PORT-001's `products`/`plat_products` are the same object under two specs. Reconcile (D9). |
| **`PROV-001`** | ✅ Exists — cited at `src/lib/practice/access.ts:86` (§5 access rule) and `provisioning.ts:331` (§11.2). **It owns `practice_entitlement` and `practice_plans`.** BILL §19's entitlement handoff overlaps it directly. |
| **`FIN-001`** | ⚠ **Exists as a shipped workspace, unmentioned by any of the three documents.** `src/lib/roles.ts:34,49` (`finance` platform role — *"Billing, subscriptions, revenue"*, tier 3), `src/lib/platform/workspaces.ts:24` → `/platform/staff/finance`, `src/app/platform/staff/finance/page.tsx` (58 lines, live MRR/plan-mix/billing-accounts). **BILL §23 proposes a `Finance Admin` role; `FIN-001` already shipped one.** |
| **`SUP-001`** | Exists (`043:52`, support tickets). Relevant to BILL §23's `Support Agent`. |
| **`AC-01` … `AC-15`** | ✅ Document-local. No collision — `AC-` is not used as a global prefix in this repo. ⚠ `AES-256` appears 7 times in `docs/` and matches a naive `[A-Z]{2,6}-[0-9]{3}` ID scan; it is an algorithm, not an ID. |

⚠ **On the four-segment ID shape.** `PCS-CAP-BILL-001` parses two ways: *"the BILL sub-document of
PCS-CAP"*, or *"document 001 in the PCS-CAP-BILL series"*. The repo has no precedent either way. Given
that this family **already** produced a numbering problem (`PCS-CAP-001` vs `PLAT-CAP-001`, [PLAT] §5) and
a third numbering register for Practice ([CPR-V3]), **REC: write the convention down once, in `docs/`,
before a `PCS-CAP-BILL-002` has to decide it retroactively.**

---

# 12. Summary

1. **BILL is the only real document of the three.** 33 KB, 39 sections, an entity model, a state machine, 15
   acceptance criteria. LIC (1.6 KB) and PAY (1.7 KB) are outlines that BILL's own §39 lists as *"documents
   to build next"*, and for both the **comp carries more requirement than the docx**.
2. **None duplicates PCS-CAP-001** — they are its children, and BILL is a partly-conforming instance of its
   §15 template that **inverts §3's Engine/Capability hierarchy**. LIC is **~85% a restatement of BILL**;
   its genuinely new content is a Feature Registry, a licence-state model and one licence type.
3. ⚠ **The brief understates what exists.** A billing schema has been created **three times already** —
   `LCP-001` (migs 042/043: `plat_plans`, `plat_subscriptions`, `plat_billing_accounts`, `plat_invoices`),
   `PCS-PORT-001` (migs 105/106: `tenant_product_licenses`), `PROV-001` (mig 191: `practice_entitlement`,
   `practice_plans`). **`plat_subscriptions` has 6 live rows.** The spec behind the first set,
   `LCP-001`, **has no file in `docs/`** and collides by ID with `CPR-LCP-001`.
4. ⚠ **An orphan `public.subscriptions` table with a `stripe_subscription_id` column exists in the live
   database, is declared in no file, and is read by no code.**
5. **Payment integration: zero.** 0 of 22 packages, 0 of 33 env vars, 0 of 421 routes, 0 refunds, 0 tax
   rules, 0 ledger entries. The four provider mentions in `src/` are all prose, three of which say the
   feature does not exist. **BILL Phase 1 is ~18% built** (10 rows of evidence in §5.1); **LIC ~85%
   restatement**; **PAY 1 of 8 components, and that one is borrowed.**
6. ⚠ **The brief's entitlement risk is real but mislocated.** `requirePracticeContext` **already** consults
   `practice_entitlement` in the same call as `hasCapability`, fail-closed, on the database clock — that
   property is designed and should be defended. **The hole is that there is no *feature*-level axis at all,
   and `plan_code` is decorative.** Fix it in **one** place (`resolveWorkspaceContext`) so 227 + 300 + 64
   call sites inherit it; audit the 11 listed exposures, especially the hand-built `WorkspaceContext` at
   `patient-booking.ts:369` and the textual route scanner at `scan.ts:80`.
7. **Practice can charge its first customer without a payment gateway**: `practice` in `plat_products`, a
   price on the Practice plan, a grace state, a manual settlement record, an expiry job, an operator screen.
   Two migrations, one job, one screen. Everything harder is the destination, not the first step.
8. **PAY is last, and it is a programme, not a sprint** — merchant onboarding, KYC, tax registration, card
   scope and a named refund owner are prerequisites no schedule can compress.
9. **Twelve decisions need the user** before code (§9), of which **D1 currency**, **D3 per-practitioner vs
   per-practice**, **D6 card scope**, **D9 which catalogue survives** and **D10 the founder cap** change the
   schema and cannot be deferred past stage 2.

**Nothing in this survey was built, staged, seeded or committed.**
