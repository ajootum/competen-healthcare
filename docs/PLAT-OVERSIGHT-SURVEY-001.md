# PLAT-OVERSIGHT-SURVEY-001 — What oversight platform owners have over practices

**Read-only survey. Nothing in this document was built, migrated or committed.**
Scope: tiers 1 (aggregate telemetry, standing) and 2 (practice-identifiable operations, standing).
Tiers 3 (support access) and 4 (break-glass) are out of scope except where existing machinery already
touches them.

Three registers, kept separate throughout:
**[CODE]** what the code does · **[DOC]** what a document says · **[REC]** what I recommend.

---

# 0. Provenance and method

| | |
|---|---|
| Repo | `C:\Users\elish\Documents\Competen\competen-healthcare` |
| Read | `AGENTS.md`, `docs/PLAT-ARCH-SURVEY-001.md` §2 + §10, `docs/CPR-GATE-001-pilot-walkthrough.md`, `src/lib/hq/spaces.ts`, `src/lib/hq/context.ts`, migrations 104 / 166 / 191 / 213 / 218 / 247 / 264, `src/lib/practice/operations.ts`, `src/lib/practice/access.ts`, `src/lib/practice/api-context.ts`, `src/lib/practice/privacy.ts`, `src/lib/access/scan.ts`, `src/lib/access/hq-scan.ts` |
| Not read | the live database. Every figure attributed to "live" below is the one **you supplied**, and is labelled as such. I ran no query and applied no `head:true` count, so the PostgREST trap is not in this document's own numbers. |
| Search method for Question Zero | four passes, described in §1.3, because the obvious pass returns a false negative |

**Estate, counted from the repo:**

| Thing | Count | How |
|---|---|---|
| `page.tsx` under `src/app/super-admin/` | **204** | `find … -name page.tsx \| wc -l` |
| …that call `requireHqContext` | **36** | `grep -rl` over the same set |
| `route.ts` under `src/app/api/platform/` | **20** | `find` |
| `practice_*` tables created in `supabase/migrations/` | **146** | `grep 'create table … practice_'`, deduped |
| `.from("practice_*")` call sites in `src/` | **1,377** across **97 files** | `grep -roE` |
| Entries in `src/lib/access/matrix.generated.json` | **1,360** | `grep -c '"path":'` |
| HQ capabilities in `src/lib/hq/spaces.ts:42–72` | **29** | list length |
| HQ positions seeded, migration 264 §9 | **6** | list length |
| HQ grants seeded, migration 264 §10 | **37** | list length |
| HQ capabilities in the **practice** space | **1** — `hq.practice.operations.view` | `spaces.ts:58` |

---

# 1. ⚠ QUESTION ZERO — and you were half right, in the way that matters

## 1.1 The answer

> **Does any `/super-admin/**` page or `/api/platform/**` route read `practice_patient`, `practice_encounter`, or any other clinical table?**

**[CODE] YES. One page does, today, and it reads both of them.**

`/super-admin/platform-ops/practice` → `src/app/super-admin/platform-ops/practice/page.tsx:31`
calls `loadPracticeOps(admin)`, and that function is `src/lib/practice/operations.ts:48`:

```
 94   const TABLES: Record<string, string> = {
 95     members: "practice_membership", appointments: "practice_appointment",
 96     patients: "practice_patient", encounters: "practice_encounter",
 97   };
 98   for (const [key, table] of Object.entries(TABLES)) {
 99     const { data: rows } = wsIds.length
100       ? await admin.from(table).select("workspace_id").in("workspace_id", wsIds).limit(5000)
```

and again at `operations.ts:107–110`:

```
107   const { data: signedRows } = wsIds.length
108     ? await admin.from("practice_encounter").select("workspace_id")
109       .in("workspace_id", wsIds).in("status", ["SIGNED", "AMENDED"]).limit(5000)
```

`admin` is `createAdminClient()` (`src/lib/supabase/server.ts:5–11`), which is the
`SUPABASE_SERVICE_ROLE_KEY` client. **It bypasses RLS.** Every `practice_*` table has RLS enabled and
**no policy at all** (migration `191-practice-provisioning-foundation.sql:319–332` enables RLS on
fourteen tables and grants nothing; `213-practice-security-control.sql:176–179` does the same for four
more). Deny-by-default for `anon` and `authenticated`; unrestricted for the service role.

## 1.2 ⚠ But it is not tier 4, and the distinction is the whole finding

The selects are **`select("workspace_id")`** and nothing else. No name, no date of birth, no note body,
no diagnosis label, no identifier ever leaves those tables into the platform plane. What is rendered
(`PracticeOpsConsole.tsx:278–282`) is five integers per practice: members, appointments, patients,
encounters, signed encounters.

So the accurate statement is:

> **A platform page reads two clinical tables today, projected to their tenancy column, to produce
> counts. It reads no clinical content. Nothing records that it happened.**

That is **tier 1 and part of tier 2 already shipped**, not tier 4. But three properties of it are worth
stating plainly, because each is the thing that would turn it into tier 4:

1. **The column restriction is a comment, not a control.** `operations.ts:3–7` says *"THE OPERATOR SEES
   METADATA, NEVER CLINICAL CONTENT … no patient name, no note body, no diagnosis label crosses into the
   super-admin surface. Nothing here can be widened by accident: the selects say so."* The last clause is
   the load-bearing one and it is false as written: **the selects say so today**. Changing `"workspace_id"`
   to `"workspace_id, given_name, family_name"` is a four-word edit that nothing in the repo would refuse
   — no test, no harness, no lint rule, no matrix assertion. §6 proposes the missing control.
2. **No read is recorded.** `loadPracticeOps` performs eleven reads and writes nothing. It does not call
   `logAccess` (`src/lib/practice/privacy.ts:38`), it does not call `audit`, and it does not touch
   `practice_access_log`. Compare `/practice/privacy` (`src/app/practice/(shell)/privacy/page.tsx:12–15`),
   which logs the act of reviewing the log. **A practitioner asking "has anyone at Competen looked at my
   practice?" cannot be answered from any store in this repo.**
3. **`hq_access_observation` does not fill that gap.** `src/lib/hq/context.ts:210–212` writes an
   observation **only when `verdict.decision !== "allow"`**, and the owner branch at
   `context.ts:194–202` returns *before* `record()` is reachable at all. **A permitted access is never
   recorded, and an owner's access is never recorded under any circumstances.** The observation ledger
   answers "what would enforce mode have refused", which is what it was built for — it is not an access log.

## 1.3 ⚠ Why your grep returned nothing, and why a directory-scoped search is not a check

You searched `/super-admin/**` and got zero. That is correct output and a wrong conclusion: **the read is
one import away.** `grep` over `src/app/super-admin/` for `practice_patient` finds nothing because the
string lives in `src/lib/practice/operations.ts`, and the page reaches it through
`page.tsx:4  import { loadPracticeOps … } from "@/lib/practice/operations";`

The check that is actually sound is a **closure**, in four passes:

| # | Pass | Result |
|---|---|---|
| 1 | Every `.from("practice_*")` site in all of `src/` | **1,377 sites in 97 files** |
| 2 | Of those 97, the ones **outside** `src/lib/practice/` and `src/app/practice/` and `src/app/api/v1/practice/` | **1 file**: `src/app/super-admin/platform-ops/practice/identifiers/page.tsx:36` |
| 3 | Every import of `@/lib/practice/*` from **outside** the Practice product | **6 sites in 6 files** — 3 under `src/app/super-admin/`, 2 marketing, 1 shared component |
| 4 | Whether any *non-practice* lib imports a practice lib and is itself imported by `/super-admin` (a two-hop path) | `src/lib/marketing/journey-gates.ts:2` is the only such lib, and **nothing under `src/app/super-admin/` or `src/app/api/platform/` imports it** |

There are **no `.rpc()` calls at all** under `src/app/super-admin/`, `src/app/api/platform/`,
`src/app/api/super-admin/` or `src/app/api/admin/`, and **no database view** anywhere in
`supabase/migrations/` names a `practice_*` table. So there is no third route in.

**The complete platform-plane → practice-data surface, exhaustively:**

| Reached from | Reader | Tables |
|---|---|---|
| `/super-admin/platform-ops/practice` (`page.tsx:31`) | `src/lib/practice/operations.ts` | `practice_platform_flags` (:50) · `practice_workspace` (:54) · `practice_membership`, `practice_appointment`, **`practice_patient`**, **`practice_encounter`** (:95–96, :108) · `practice_role_capabilities`, `practice_plans`, `practice_onboarding_step_catalog` (:150–152) |
| `/super-admin/platform-ops/practice/identifiers` (`page.tsx:35–37`) | `src/lib/practice/identifier-format.ts` + the page itself | `practice_identifier_format` (:112, :192, :213) · `practice_identifier_format_history` (:181, :217) · `practice_practitioner_identity` (:167, and `page.tsx:36`) |

**Three files. Eleven tables. Two of them clinical.** `src/lib/practice/catalogs.ts`, imported by
`PracticeOpsConsole.tsx:4`, contains no database read at all.

**`/api/platform/**` reads no `practice_*` table.** Its twenty routes plus `src/lib/platform/*` touch 40
distinct tables (`assessment_evidence`, `audit_log`, `hospitals`, `plat_*`, `profiles`, `tenants`, …) and
not one begins `practice_`. Same for `/api/super-admin/**` and `/api/admin/**` (9 tables, none practice).

## 1.4 ✅ Your other claim is exactly right

> *"Practice access is by membership only, and there is no super_admin bypass."*

**[CODE] Confirmed, and it survives a hostile grep.** `grep -n "super_admin\|isSuper\|platform_role"`
over `src/lib/practice/shell.ts`, `src/lib/practice/access.ts` and `src/lib/practice/team.ts` returns
**nothing**. `resolveWorkspaceContext` (`src/lib/practice/access.ts:74–…`) refuses with `NO_MEMBERSHIP`
before it reads anything else, and `requirePracticeContext`
(`src/lib/practice/api-context.ts:27–31`) turns that into a **404, not a 403** — so a non-member cannot
even confirm the workspace exists. Entitlement and time-bounded capability are both checked on the
**database's** clock (`access.ts:88–99`, `:126–132`).

There is one adjacent fact worth knowing, from `docs/CPR-GATE-001-pilot-walkthrough.md:26`:
*"**A super-admin may provision for themselves**"*. That creates a **new** workspace owned by the
operator. It is not a door into anybody else's.

## 1.5 ⚠ So: what stops it?

**Nothing technical. The only control is that nobody has written the page.**

| Candidate control | Does it stop a new `/super-admin` page reading `practice_patient`? |
|---|---|
| RLS on `practice_*` | ❌ No. Enabled with **zero policies**, and every platform page holds the **service-role** client. RLS is a wall the platform plane is already on the far side of. |
| `requireHqContext` | ❌ No. It returns `admin` — the service-role client — as the first field of its context (`src/lib/hq/context.ts:38`, and every one of the 36 call sites destructures it: `const { admin } = await requireHqContext(…)`). It decides **who may open the page**, never **what the page may read**. |
| The route→capability map | ❌ No. It maps `/super-admin/platform-ops/practice` → `hq.practice.operations.view` (`spaces.ts:92`). A capability is not a data scope. |
| The access matrix / `scan.ts` | ❌ No. `MatrixEntry` (`src/lib/access/scan.ts:35–48`) carries `path`, `kind`, `gate`, `guard`, `inheritedFrom`. **There is no field for what a page reads.** The matrix models the door, not the room. |
| The practice engine | ❌ No. It is never invoked on this path. `loadPracticeOps` calls `admin.from(...)` directly and never touches `resolveWorkspaceContext`. |
| A test or harness | ❌ No. There is no harness over `src/lib/practice/operations.ts` (`scripts/practice-operations-harness.ts` exists but covers `src/lib/practice/operations-home.ts`, the in-practice operations home, not this file). |
| `hq_config.mode = 'observe'` | ❌ No, and it is weaker than it sounds: `decideHq` (`spaces.ts:185`) short-circuits to `allow_owner` for any `super_admin` **before consulting a single HQ table**. With **zero appointments**, every one of the 49 profiles that can reach `/super-admin` today reaches it as an owner. |

**[REC]** This is the single most important sentence in the survey: *the practice plane's isolation is
enforced by the practice engine, and the platform plane does not call the practice engine.* Tiers 1 and 2
are not "features to add" — they are **already being taken, informally, by one page**. The work is to
name the boundary and make it checkable, not to open a door.

---

# 2. Tier 1 — aggregate telemetry that exists today

**[CODE] Everything below is live and rendering.** Source: `src/lib/practice/operations.ts` →
`src/app/super-admin/platform-ops/practice/PracticeOpsConsole.tsx` (335 lines).

| Datum | Where it comes from | Rendered at |
|---|---|---|
| Launch state — Closed / Development / Private pilot / Controlled launch | derived from 3 flags, `operations.ts:17–22` | `page.tsx:78` |
| The three launch flags and **what each one makes true of the public site** | `practice_platform_flags`, copy at `operations.ts:39–46` | `page.tsx:58–72` (a **standing** banner, not a toast — the reasoning is at `operations.ts:28–37`) |
| Gate ledger, 12 items — 9 auto, 3 manual | `evaluateGate`, `operations.ts:145–208` | `page.tsx:84` |
| `practice_role_capabilities` / `practice_plans` / `practice_onboarding_step_catalog` row counts | `operations.ts:150–152` | gate items `migrations`, `seed` |
| Workspace total, ACTIVE total, "closed the clinical loop" total | `operations.ts:155–157` | gate items `provisioned`, `activated`, `clinical` |
| Failed provisioning requests | `operations.ts:157` | gate item `resumable` |
| Practitioner numbers issued | `practice_practitioner_identity` head-count, `identifiers/page.tsx:36–37` | `identifiers/page.tsx:59` |
| Identifier format + version + change history | `practice_identifier_format(_history)` | `identifiers/page.tsx:63–152` |

**[DOC]** `docs/CPR-GATE-001-pilot-walkthrough.md:31` describes this page as the operator's first stop,
and step 15 (`:45`) is precisely a tier-1 read: *"The workspace row shows patients 1, encounters 1,
**signed 1**."*

**Live numbers, as you supplied them** (I did not query): 2 practice workspaces · 2 patients ·
3 appointments · **0 encounters** · 36 practitioner identities · 0 claimed handles.

⚠ **One consistency note on those figures.** With 0 encounters, gate item `clinical`
(`operations.ts:183–185`, *"The clinical loop closed end to end (a signed encounter exists)"*) is
**FAILING** today, and `evaluateGate` returns `state: "fail"` for it. If the console is showing that item
green, something is wrong; if it is showing red, the gate is doing its job and the pilot walkthrough has
not been completed. Either way it is worth a glance, because `docs/CPR-GATE-001` step 15 is the step that
turns it green and your memory records the walkthrough as still outstanding.

**What tier 1 does NOT have today:** no time series (every figure is instantaneous), no cohort or
country roll-up, no retention or churn, no error-rate telemetry, no per-practice trend. `plat_*`
telemetry (`plat_platform_events`, `plat_job_runs`, `plat_deployments`) exists and is read by
`/api/platform/**`, but **nothing in the Practice product writes to it** — the two audit trails are
disjoint (§4.4).

---

# 3. Tier 2 — practice-identifiable operational data

## 3.1 What is rendered today

**[CODE]** `PracticeOpsConsole.tsx` lines 270–282 render, per practice, in one table:

| Column | Line | Source |
|---|---|---|
| Practice **name** | :270 | `practice_workspace.name` |
| **Owner email**, falling back to owner name | :271 | `profiles.email` / `full_name`, joined at `operations.ts:71–78` |
| Status badge (ACTIVE / ONBOARDING / other) | :274–276 | `practice_workspace.status` |
| members · appointments · **patients** · **encounters** · **signed** | :278–282 | the five counts of §1.1 |

and, for provisioning requests (`:310`), the **target user's email**.

**So tier 2 is, in substance, already shipped for the Practice product — for one page, with no
capability of its own, no record of the read, and no consent from the practitioner.**

## 3.2 The stores tier 2 would draw on, and what each actually holds

| Store | Migration | Holds | State |
|---|---|---|---|
| `practice_workspace` | 191:32–54 | `name`, `type`, `owner_person_id`, `status` (10 values incl. SUSPENDED/CLOSING/CLOSED/FAILED), `country`, `timezone`, `default_practice_type`, `profession_code`, `primary_specialty_code`, `suspension_reason`, `record_version`, created/updated/deleted stamps. ⚠ **No `tenant_id`.** A practice belongs to a person, not to a tenant. | **LIVE**, read at `operations.ts:54–56` |
| `practice_membership` | 191:61 | `user_id`, `role_code`, `status` | LIVE — **counted only**, never listed, on the platform plane |
| `practice_entitlement` | 191:138–150 | `product_code`, `plan_code`, `status` ∈ {active, trial, expired, suspended, cancelled}, `starts_at`, `ends_at`, `sponsor_ref` | **LIVE but invisible to the platform.** Enforced at `access.ts:88–99`; asserted created at signup by `scripts/practice-signup-harness.ts:158–160`. **`loadPracticeOps` never reads it** — the operator cannot see whether a practice is entitled, on trial, or expired. |
| `practice_plans` | 191:249–254 | `plan_code`, `name`, `trial_days`, `active`. **No price, no currency, no billing period.** | LIVE as a catalogue; row count only on the platform plane (`operations.ts:151`) |
| `provisioning_request` | 191:176–192 | `idempotency_key`, `request_type`, `actor_user_id`, `target_user_id`, `status` (8 values), `error_code`, `correlation_id` | LIVE, `operations.ts:57–59`, newest 50 |
| `provisioning_step` | 191 | `step_code`, `status`, `error_code`, `started_at`, `completed_at` | LIVE, `operations.ts:83–85` — the saga ledger, so a partial failure is legible |
| `practice_platform_flags` | 191:256–260 | 3 rows | LIVE, read + **written** via `PATCH /api/v1/practice/flags` (`route.ts:42–49`), every flip audited |
| `practice_practitioner_identity` | 218:46–… | `practitioner_number` (permanent, unique), `handle`, `display_name`, public profile fields, `discovery` (**hidden by default**), `status` (8-state lifecycle), `licence_verified_at` / `_by` / `_reference` | LIVE. Platform reads **one head-count** (`identifiers/page.tsx:36`). Licence verification: **dormant**, §4.3 |

## 3.3 ⚠ There is no billing to see

**[CODE]** `practice_workspace` has no `tenant_id`, and **no migration links any `practice_*` table to
`plat_billing_accounts`, `plat_subscriptions` or `plat_plans`**
(`grep -rn "plat_.*practice\|practice.*plat_billing"` over all migrations: **zero hits**).
`practice_plans` carries `trial_days` and `active` and no money.

**So "billing" as a tier-2 datum does not exist for practices.** The furthest a platform surface could
honestly go today is *plan code + entitlement status + trial window*. Anything labelled revenue would be
invented, which `docs/` and your `cpr-honesty-rules` note both forbid.

---

# 4. The machinery nobody wired to the platform side

**Live or dormant, stated plainly.** "Dormant" means the table exists and nothing consumes it.

## 4.1 `break_glass_grant` — migration 104 — ⚠ **DORMANT, and more so than it looks**

**[CODE]** 29 lines. `break_glass_grant(actor_id, tenant_id, hospital_id, target_type, target_ref,
reason NOT NULL, scope ∈ {read, act}, status, granted_at, expires_at NOT NULL, revoked_at, revoked_by)`.
RLS enabled, **no policy** (104:29). Service is `src/lib/orchestration/break-glass.ts`: minimum
8-character reason (`:17`), 240-minute ceiling (`:10`), writes `audit_log` + a domain event (`:32–33`).
API at `src/app/api/me/break-glass/route.ts`.

⚠ **`hasActiveBreakGlass()` — the function whose entire purpose is to widen scope
(`break-glass.ts:49–58`) — has ZERO callers.** `grep -rn "hasActiveBreakGlass" src` returns two hits, both
inside the file that defines it (`:2` a comment, `:50` the definition).

**So `break_glass_grant` is a ledger with no consumer. Invoking break-glass records an intention, emits
an event, and grants nothing.** Three read-only surfaces display it — `src/lib/access/permissions.ts:41`,
`src/lib/admin/admin-suite.ts:30`, `src/lib/cgr/exceptions.ts:44` — and one of those,
`src/app/unit-manager/administration/governance/page.tsx:69`, tells a manager *"Emergency access reads
the platform `break_glass_grant` store"*, which is true of the display and false of the enforcement.

⚠ **And it is `hospital_id` / `tenant_id` scoped. It has no concept of a practice workspace.** Nothing in
`src/lib/practice/**` imports it. It is not, and cannot become without new columns, the mechanism for
tier 3 or tier 4 over a practice.

## 4.2 `practice_break_glass` — migration 213 §4 — **LIVE, and it is not a platform mechanism**

**[CODE]** 213:133–146. Four stated properties (213:122–129): self-granted, reason 10–1000 chars
(DB CHECK), time-boxed, loud. `practice_role_assignment.source` gained a fourth value `'break_glass'`
(213:159–161) and a `break_glass_id` FK (213:163), so an emergency grant can never be mistaken for a
delegation. Live path: `POST /api/v1/practice/security` → `src/lib/practice/security.ts:900`, surfaced at
`src/app/practice/(shell)/privacy/security/`. A practice may switch it off entirely
(`practice_security_policy.break_glass_enabled`, 213:70).

⚠ **It is reached through `requirePracticeContext`, so only an existing MEMBER can invoke it.** It lets a
colleague inside one practice reach a record they would not normally open. **It does not let anyone at the
platform in, and it is not a foundation for tier 4** — a platform break-glass would need a different
subject, because the platform operator has no membership to break out of.

## 4.3 Licence verification — migration 218 — ⚠ **DORMANT BY DESIGN, and there is no operator door**

**[CODE]** `licence_verified_at` / `licence_verified_by` / `licence_reference` exist (218:79–83), and the
`licence_verified` lifecycle state is legal in the CHECK constraint (218:76).

`transitionIdentity` (`src/lib/practice/identity-service.ts:939`) is the only writer, and it has **no
production caller for that state**: `publishIdentity` (`:1147`, `:1158`) deliberately steps around it to
`active`, with the reason at `:1096–1101` — *"a self-awarded record that somebody checked a licence is
worse than no record at all, because everything downstream reads it as provenance. **Verification is an
operator's act and has no practitioner-facing door, here or anywhere.**"* The API refuses any body naming
a lifecycle state outright (`src/app/api/v1/practice/identity/route.ts:47`, `STATUS_KEYS`), and
`scripts/practice-identity-publication-harness.ts:505–508` asserts the route does not even *import*
`transitionIdentity`.

⚠ **The practitioner-facing door is correctly nailed shut and the operator-facing door was never built.**
So licence verification is a **tier-2 capability the platform is missing**, not one it holds: three columns,
a lifecycle state, a harness proving the wrong actor cannot write them, and no surface for the right one.
`scripts/practice-booking-link-harness.ts:109–116` records why it must never become a patient-facing tick.

## 4.4 `practice_audit_event` — migrations 191 + 247 — **LIVE, append-only, and ⚠ NOT SAFE TO SURFACE**

**[CODE]** `191:219–229`: `(workspace_id, actor_id, event_type, source, payload jsonb, payload_hash,
correlation_id, occurred_at)`. Migration `247:120–132` deploys `practice_audit_event_immutable()` as a
`before update or delete` trigger that raises — **genuinely append-only since 247**, and 247:104–115 is
explicit that it was not before. `practice_lifecycle_transition` gets the same treatment (247:139–149).

⚠ **`payload` is not metadata, and this is the finding that most constrains tier 2.** Sampling the
payloads written across `src/lib/practice/*.ts`:

| Payload | Site | Why it disqualifies a platform-side read |
|---|---|---|
| `{ medicationId, patientId, genericName, source }` | `medication.ts:1292` | **a drug name beside a patient id** |
| `{ procedureId, encounterId, label, laterality, status }` | `procedures.ts:190` | **what was done, and to which side** |
| `{ consentId, patientId, consentType, reason }` | `security.ts:603` | consent type + free text |
| `{ breakGlassId, note }` | `security.ts:900` | a reviewer's free-text note about an emergency access |
| dozens more carrying `reason` / `note` | across the module | clinician-authored free text, unbounded |

Encounter events are clean by comparison — `encounters.ts:127`, `:380`, `:403`, `:459` carry only ids and
enums. **But the table as a whole holds clinical content, and any platform surface that rendered it would
be tier 4 in everything but name.**

**Today nothing reads it from the platform plane.** `/super-admin/audit`
(`src/app/super-admin/audit/page.tsx:42`) reads `audit_log` — the tenant trail — and nothing else.
⚠ But `hq.platform.audit.view` is described in migration 264 §8 as **"Cross-plane audit trail"**. That
description is an instruction to a future engineer to wire `practice_audit_event` in. **[REC] Change that
label.** It is a one-word edit today and a breach later.

## 4.5 `practice_access_log` + the privacy surface — **LIVE, and it does not see the platform**

**[CODE]** `src/lib/practice/privacy.ts:38` `logAccess(...)` records reads with three stated rules
(`privacy.ts:16–26`): logging never blocks a clinician; the reviewer of a privacy control must not be its
easiest bypass (names shown only to a caller who already holds `patient.view`); an export is logged as
loudly as it deserves. Reviewing is itself logged, by `reviewAccess` rather than by the page
(`src/app/practice/(shell)/privacy/page.tsx:13–15`).

⚠ **It is `workspace_id`-scoped and every writer is inside the practice.** A platform read leaves no row.
The page answers *"who in this practice has been reading"* and cannot answer *"has anyone outside it"*.

## 4.6 `delegation_id` — migration 208:62 — **LIVE, intra-practice**

`practice_role_assignment.delegation_id → practice_delegation(id)`. With `break_glass_id` (213:163) and
`source ∈ {role_default, explicit_grant, delegation, break_glass}` (213:160–161), **every capability a
person holds inside a practice carries its provenance**. Enforced at `access.ts:126–132` on the database's
clock, with both a start and an end bound. **[REC] This is the model to copy for HQ**, and
`docs/PLAT-ARCH-SURVEY-001.md:614` already says so.

## 4.7 `166-access-governance.sql` — **LIVE tables, ⚠ hospital-scoped, no practice concept**

`access_reviews`, `access_review_items` (`access_type ∈ {role, delegation, break_glass, workspace}`),
`sod_rules`, `sod_exceptions`. Every one is `hospital_id`-scoped (166:28, :68, :85). `subject_id` FKs to
`profiles`. **A practice cannot be the subject of an access review as the schema stands**, and
`decision` is deliberately nullable so an undecided item can never read as approved (166:43–45).

Read policy is `for select to authenticated using (true)` (166:104–110) — deliberate, since these
describe policy rather than personal data, but worth knowing before any practice identifier goes near them.

## 4.8 Summary

| Machinery | Migration | Live? | Reaches a practice? | Reaches the platform plane? |
|---|---|---|---|---|
| `break_glass_grant` | 104 | ledger only — **no consumer** | ❌ no columns for it | ❌ |
| `practice_break_glass` | 213 §4 | ✅ fully | ✅ from **inside**, by a member | ❌ |
| licence verification columns | 218 | ❌ **no writer** | ✅ per practitioner | ❌ no operator surface |
| `practice_audit_event` | 191 + 247 | ✅ append-only | ✅ | ❌ — **and must stay that way**, §4.4 |
| `practice_access_log` + `/practice/privacy` | 202 + 213 | ✅ | ✅ intra-practice | ❌ blind to platform reads |
| `delegation_id` / `break_glass_id` provenance | 208 + 213 | ✅ | ✅ | ❌ |
| `access_reviews` / SoD | 166 | ✅ tables | ❌ hospital-scoped | partial |
| `hq_access_observation` | 264 | ✅ | ❌ | ⚠ **records refusals only** |

---

# 5. What tiers 1 and 2 would take, as HQ capabilities

**[REC].** Your constraint — *no new capability code without saying why an existing one will not do* — is
the right one, and it mostly holds.

## 5.1 Tier 1: `hq.practice.operations.view` — **no new code needed**

It already exists (`spaces.ts:58`), is granted to exactly one position (`practice_product_director`,
migration 264 §10), and is already mapped to the route that shows every tier-1 number
(`spaces.ts:92`, declared **above** `/super-admin/platform-ops` so it is not swallowed).

The gap is not a capability, it is a **call**: `/super-admin/platform-ops/practice/page.tsx:27–29` and
`identifiers/page.tsx:31–33` still use the bare idiom

```
if (!roles.includes("super_admin")) redirect("/dashboard");
```

They are **not** among the 36 pages that call `requireHqContext`. Both are `single-role` in the matrix
(`src/lib/access/matrix.generated.json`, entries at `:14366` and `:14380`). **[REC] Convert these two
first, ahead of the other 166** — they are the only platform pages that touch practice data, so they are
where the capability model buys the most per line changed.

## 5.2 Tier 2: **one new capability, and here is why the existing one will not do**

`hq.practice.operations.view` currently means *"see the pilot gate and the launch ladder"* **and**
*"see every practice's name, owner email and patient count"*, because one page carries both. Those are
different sensitivities:

- the gate is about **the product** — flags, migrations, catalogues, whether the loop closed;
- the roster is about **named people's businesses**.

A finance analyst who needs plan and entitlement status, or an engineer diagnosing a stuck provisioning
saga, should not thereby learn who owns which practice. **[REC] Split it:**

| Capability | Covers | Why the existing one is insufficient |
|---|---|---|
| `hq.practice.operations.view` *(exists)* | flags, launch state, gate ledger, catalogue counts, **aggregate totals only** — no per-practice row | unchanged in meaning; narrowed in scope |
| **`hq.practice.registry.view`** *(new — tier 2)* | the per-practice table: name, owner, status, country, created, entitlement, activity counts | granting the gate must not grant the roster. One code cannot express two audiences. |
| **`hq.practice.licence.verify`** *(new — §4.3)* | write `licence_verified_*` | a **write**, and the only operator-side write over a practitioner's identity. Modelling it as a view capability would make the catalogue lie about what it permits. |

Three codes total, one of which exists. **[REC] Do not mint anything for tier 3 or 4** until they are
specified — an unused capability in the catalogue is an invitation.

⚠ **One structural gap to name.** `hq_capability` has `code`, `space`, `label`, `description` (264:32–38).
There is **no column stating what data a capability admits** and no relationship between a capability and
a table. So a capability catalogue alone cannot express "may see counts, may not see names". That is why
§6 proposes the control at the **data** layer rather than adding a column here.

## 5.3 Positions

`practice_product_director` (264 §9) is the natural holder of all three. Splitting tier 2 out means a
CFO could be granted `hq.practice.registry.view` for entitlement work without the gate, and an engineer
the gate without the roster — **which is exactly the discrimination the six-position model exists to
express** and which a single `super_admin` string cannot.

---

# 6. ⚠ The boundary, as an enforceable rule

**The rule, stated so a machine can check it:**

> **No file reachable from `src/app/super-admin/**` or `src/app/api/platform/**` may name a
> `practice_*` table outside a declared allowlist, and for each allowlisted table the *columns*
> it selects are also declared.**

## 6.1 Why the existing machinery cannot express it

`scan.ts` models **who may open a page**. `MatrixEntry` (`scan.ts:35–48`) has no data dimension, and
`Gate` (`:27–33`) has none either. `hq-scan.ts` adds `hq-position` to the gate kinds and stops there.
**The matrix is a door model. This is a room model, and it does not exist.** Page granularity — which
landed, 1,360 entries — is a necessary precondition and not the control itself.

## 6.2 The check, and it is small

**[REC] `scripts/plane-boundary-harness.ts`.** Three passes, all of which I ran by hand for §1.3, so the
implementation is known to terminate and the expected output is known:

1. **Closure.** From each entry point under `src/app/super-admin/` and `src/app/api/platform/`, follow
   `@/lib/...` and relative imports transitively. (Today the closure reaches exactly three practice-touching
   files; the two-hop path through `src/lib/marketing/journey-gates.ts` is the only near-miss and it is
   not reachable.)
2. **Extract.** In every file in that closure, match `\.from\(\s*"(practice_[a-z_]+)"` and capture the
   `.select("…")` argument that follows on the same statement.
3. **Assert against a literal allowlist** committed beside the harness:

```
practice_platform_flags        flag, enabled, note
practice_workspace             id, name, type, status, owner_person_id, country, timezone,
                               created_at, updated_at
practice_membership            workspace_id
practice_appointment           workspace_id
practice_patient               workspace_id          ⚠ TENANCY COLUMN ONLY
practice_encounter             workspace_id, status  ⚠ TENANCY + LIFECYCLE ONLY
practice_role_capabilities     (count)
practice_plans                 (count)
practice_onboarding_step_catalog (count)
practice_identifier_format     *
practice_identifier_format_history *
practice_practitioner_identity (count), practitioner_number   ⚠ NO PROFILE FIELDS
```

Everything else **fails the harness**. A page that joins one table too many turns the build red in the
same commit that wrote it, and — because the allowlist names columns — so does
`select("workspace_id, given_name")`.

**Three properties make this a real control rather than a comment:**

- **It is failable.** Add `practice_problem` to a super-admin loader and it goes red. Add a column to an
  allowlisted table and it goes red. Follow `hq.platform.audit.view`'s "cross-plane" description into
  `practice_audit_event` and it goes red.
- **It is a data rule, not a role rule**, so it holds under `enforce` mode, under owner break-glass, and
  for a page that forgot its guard entirely — **the three cases where every other control has already been
  bypassed**.
- **`practice_audit_event` is absent from the allowlist on purpose**, and §4.4 is the citation.

## 6.3 The second half — a read that leaves a trace

**[REC] The allowlist bounds *what*; nothing today records *that*.** Two additions, both small:

1. **`loadPracticeOps` should write one `practice_audit_event` row per practice it read**, event type
   `practice.platform_operations_read`, payload `{ actorId, capability, counts: [...] }`. It is the
   practice's own trail, append-only since 247, so a practitioner reviewing their audit history sees the
   platform's reads beside their colleagues'. Deliberately **not** `practice_access_log`, whose subject
   is a patient.
2. **Record `allow` and `allow_owner` in `hq_access_observation`, at least for practice-space routes.**
   Today `src/lib/hq/context.ts:210` writes only refusals and the owner branch at `:194–202` writes
   nothing at all, so the HQ ledger structurally cannot answer *"who opened the practice registry last
   month"*. ⚠ This changes the table's meaning — it was built as a migration instrument, not an access
   log — so it should be a decision (D6), not a quiet widening.

---

# 7. What the practitioner sees

## 7.1 The promise, quoted

**[DOC]** `src/lib/marketing/practice-content.ts:766`:
*"It follows you, not your employer"* — and `:61`, *"It follows you, not your employer."*

## 7.2 What they are told today about platform access: **nothing**

**[CODE]** `/practice/privacy` (`src/app/practice/(shell)/privacy/page.tsx`) answers *"who has read what
**in this practice**"* (`:41–42`). `privacyPosture` (`src/lib/practice/privacy.ts:263`) reports access-log
volume, patient count, oldest entry, and a **derived** sending guarantee. A search across
`src/lib/marketing/practice-content.ts`, `src/lib/practice/*.ts` and `src/app/practice/**` for
*"platform staff"*, *"Competen staff"*, *"we cannot see"*, *"support access"* returns **one hit and it is
unrelated** (`configuration.ts:55`, about timezones). **There is no disclosure of platform-side visibility
anywhere in the product.**

## 7.3 ⚠ The precedent is already in this file, and it is a good one

`privacy.ts:271–293` is a comment worth reading in full before writing any oversight disclosure. The page
once claimed *"there is no delivery channel of any kind"*, which was true when written; migration 224
shipped three providers and the sentence survived — *"the strongest promise on this page was being kept
only by the accident of nobody having set an environment variable."* It is now **derived from two live
reads**, and a failed read produces the cautious sentence, not the reassuring one.

**[REC] Do exactly that for oversight.** Not a policy paragraph — a computed sentence, on
`/practice/privacy`, beneath the existing summary:

> **Competen's platform team.** Competen staff cannot open your patients' records: access to this
> practice is by membership, and no platform account has one. What the platform can see is operational —
> your practice's name, your name as owner, its status and plan, and **how many** patients, appointments
> and encounters it holds. Never a name, never a note, never a diagnosis.
> **N** platform positions currently hold that access. The last time it was used to read this practice was
> **‹date›**. [What the platform can see →]

Every figure in it is computable from stores that exist:

| Claim | Computed from |
|---|---|
| "no platform account has a membership" | `practice_membership` for this workspace vs the `platform_role`/HQ-position holders |
| **N** positions | `hq_position_capability` × `ogs_office_appointments` (**0 today** — so the honest sentence today is *"nobody currently holds it"*, which is both true and the strongest thing this product will ever be able to say) |
| last read | the `practice.platform_operations_read` row proposed in §6.3 |
| the field list | generated from the §6.2 allowlist, so **the sentence and the harness cannot diverge** |

⚠ **Do not ship the sentence before the harness.** A promise about columns, kept only by a comment in
`operations.ts:3–7`, is the messaging-guarantee failure repeating with a worse subject.

---

# 8. Scale reality at 1,000 practitioners

## 8.1 ⚠ Three reads are already wrong at that scale — and two of them lie silently

The 1,000-row cap is not theoretical here. It is recorded across this codebase from experience:
`scripts/migration-object-audit.ts:152–153` (*"this database has more than 1000 indexes, so a single call
returned exactly 1000"*), `src/lib/practice/intelligence.ts:418`, `metrics.ts:33`,
`planner.ts:339` (*"PostgREST answers an unbounded select with at most 1000 rows **AND NO INDICATION
THAT IT DID**"*), `patient-workspace-constants.ts:192`, `command-centre.ts:286`.

| Read | Site | Today (2 workspaces) | At 1,000 practitioners |
|---|---|---|---|
| `practice_workspace … .limit(200)` | `operations.ts:56` | fine | ⚠ **returns 200 of 1,000.** And `ops.workspaces.length` is what `page.tsx:92` renders as "Workspaces" and what gate item `provisioned` counts (`operations.ts:178`) — **the headline figure becomes "200" and nothing says it truncated** |
| four `select("workspace_id") … .limit(5000)` | `operations.ts:100` | 2 patients, 3 appointments, 0 encounters | ⚠ **`.limit(5000)` is above the server cap, so it returns ≤1,000 rows.** These are counted **in TypeScript** (`:102–104`), so the per-practice counts silently under-report as soon as the estate holds >1,000 patients — which one busy practice reaches alone |
| `practice_encounter … .limit(5000)` signed | `operations.ts:107–110` | 0 | same, and this one feeds the gate item that certifies the clinical loop closed |

⚠ **The failure mode is the dangerous one: the numbers stay plausible.** A console reading "200
workspaces, 1,000 patients" is not obviously broken, and the gate ledger built on top of it goes green on
a truncated denominator.

**[REC]** Two changes, both mechanical:

1. **Every per-practice count becomes a server-side count**, not a fetched page:
   `.select("*", { head: true, count: "exact" }).eq("workspace_id", id)`. ⚠ **You are right about the
   trap and it applies here**: a `head+count` read against a table that does not exist returns
   `count: null` with **no error**, and the codebase already handles this correctly at
   `scripts/practice-pilot-gate.ts:88–91` — *"A missing table returns 204 with error null and count NULL
   — the COUNT is the discriminator"*. **Treat `count === null` as unknown and render it as unknown, never
   as 0.** `src/lib/practice/metrics.ts:249` already documents the safe pattern.
2. **Paginate and page the workspace list**, and — per the pattern already used at
   `src/lib/practice/documents-workspace.ts:97` — carry an explicit *"a source that returned exactly its
   limit"* flag into the payload, so a truncated page is **stated** rather than rendered as a total.

## 8.2 Which tier-1/2 reads are counts and which need infrastructure

| Read | At 1,000 practitioners |
|---|---|
| Total workspaces, by status | **a count.** One `head+count` per status. Trivial. |
| Practitioner identities issued | **a count.** Already correct — `identifiers/page.tsx:36` is a real `head+count`. |
| Provisioning requests, failures | **a count** + newest N. Already bounded to 50. |
| Flags, plans, catalogues, gate ledger | **fixed-size.** Never scales. |
| **Per-practice** counts (members / appointments / patients / encounters) | ⚠ **1,000 practices × 5 = 5,000 round trips per page load.** Not viable as counts. Needs **one grouped query** — a `count(*) … group by workspace_id` RPC, or a materialised `practice_activity_summary` refreshed on a schedule. **This is the only genuine aggregation infrastructure tiers 1–2 require.** |
| Entitlement status per practice | a count by `status`, or one indexed read per page of practices. `idx_practice_entitlement_ws` (191:152) already covers it. |
| Time series / trend | ⚠ **does not exist at any scale.** Every figure today is instantaneous. A trend needs a snapshot table; nothing writes one. |

**[REC]** A grouped-count RPC is the right shape and it fixes both problems at once: it is server-side, so
the row cap does not apply, and it is one round trip. ⚠ A Postgres **function** — note your own recorded
constraint that the migration runner splits on `;`, so no PL/pgSQL do-blocks; a plain
`create or replace function … language sql` is fine.

---

# 9. Decisions for you

Each is a decision because the code is genuinely silent, or because two defensible answers exist and the
codebase cannot pick between them.

---

**D1. May platform staff see a practice's NAME and its OWNER at all?**

⚠ **This is the decision, and it is already being made by default in the affirmative.**
`PracticeOpsConsole.tsx:270–271` renders practice name and owner email today, to anyone holding
`super_admin`. Some platforms deliberately pseudonymise: the operator sees `WS-a41f…`, ACTIVE, 12 members,
and reaches a name only through tier 3.

*Cannot be inferred:* the code shows the name; `operations.ts:3–12` justifies showing **metadata** without
ever asking whether a name is metadata; and the product promise (§7.1) points the other way. Both readings
are consistent with everything written down. Pseudonymising is cheap **now** (2 workspaces, one page,
one loader) and expensive once support tooling, dunning and CS workflows assume the name.

*Sub-decision if you say yes:* **owner email, or owner name only?** `:271` currently prefers **email** —
the more identifying of the two, and the one that doubles as a contact channel.

---

**D2. Are per-practice activity counts operational, or already too revealing?**

A row reading *"Dr Nakato's Practice · 412 patients · 38 encounters this month"* is a business intelligence
about a named clinician's practice. The aggregate *"1,000 practices hold 41,000 patients"* is not.

*Cannot be inferred:* `operations.ts:91–92` gives a specific, honest justification — *"the reason they
exist is the gate: 'the clinical loop closed' is not provable from a workspace status alone"* — and that
justification **expires when the gate passes**. Nothing in the code says whether they should then be
withdrawn to aggregate. **[REC] the middle path**: counts **bucketed** (0 / 1–9 / 10–99 / 100+) for the
standing tier-2 view, exact counts only for the gate while the gate is open. That answers "is this practice
alive" without answering "how big is her book".

---

**D3. Does the platform get a per-practice list at all, or only aggregates plus search?**

A standing table of all 1,000 is a different artefact from a search box that resolves one practice when
somebody has a reason. The search precedent exists and is good:
`src/app/api/v1/practice/operations/users/route.ts:18–19` refuses a query under two characters, because
*"a lookup that answers the empty string is a directory dump wearing a search box"* — and caps at 10.

*Cannot be inferred:* today's answer is "a list" (`.limit(200)`), which is a scale artefact rather than a
choice — it was written when 200 exceeded any plausible estate.

---

**D4. Should `hq.practice.operations.view` be split into gate vs registry (§5.2)?**

*Cannot be inferred:* migration 264 minted one code because one page existed. Whether the gate and the
roster are one audience is a judgement about who you will actually appoint. ⚠ **Cheapest before the first
appointment is made** — `ogs_office_appointments` is empty, so splitting today rewrites no grant.

---

**D5. Does the platform get a door to `licence_verified_*` (§4.3)?**

Three columns and a lifecycle state exist; the practitioner-facing door is deliberately nailed shut and
the operator-facing one was never built.

*Cannot be inferred:* the code proves who must **not** write it and is silent on whether anyone should.
⚠ Consider the downstream first: `scripts/practice-booking-link-harness.ts:109–116` explains why this must
never surface to patients as a verification tick, and assertion 5b enforces that. Building the write door
without settling that boundary puts pressure on it from the other side.

---

**D6. Does an *allowed* platform read get recorded — and where (§6.3)?**

Three sub-answers, and they differ:
(a) nothing (today); (b) `hq_access_observation` — ⚠ changes that table from a migration instrument into
an access log; (c) `practice_audit_event` in the practice's own trail — visible to the practitioner,
append-only, and the only option that makes §7.3's sentence computable.

*Cannot be inferred:* `context.ts:153` calls the observation write *"Best-effort … an observation nobody
could record is not a refusal"*, which is right for a migration instrument and **wrong for an access log**
— you cannot fail-soft on the record of a read. Whichever you choose, the fail-soft posture has to change
with it.

---

**D7. Is the §6.2 boundary harness in scope now, or after tier 2 is built?**

*Cannot be inferred:* it protects a boundary that already has traffic on it (§1.1), so "after" means the
window stays open. But it is a harness for a rule you have not yet settled (D1, D2, D3 all change the
allowlist). **[REC] land the harness with today's allowlist verbatim** — it locks the boundary at exactly
where it stands, and every subsequent decision is then a deliberate, reviewable widening of a committed
file rather than an unnoticed one.

---

**D8. Does `hq.platform.audit.view` keep the description "Cross-plane audit trail" (§4.4)?**

*Cannot be inferred:* the description is aspirational and the page is not. Given the payload contents at
`medication.ts:1292` and `procedures.ts:190`, an engineer implementing the description as written would
put drug names and procedure lateralities on a platform page. ⚠ **This is a one-word edit today.**

---

# 10. Corrections to what you told the user

| You said | Verdict | Evidence |
|---|---|---|
| *"Practice access is by membership only, and there is no super_admin bypass"* — of `requirePracticeContext` | ✅ **True**, and stronger than stated: a non-member gets **404, not 403** | `api-context.ts:29`; zero hits for `super_admin\|isSuper\|platform_role` in `shell.ts`, `access.ts`, `team.ts` |
| *"It may be false of the platform side… a `/super-admin` page could already read any practice's patients"* | ✅ **True in capability, and one page already reads two clinical tables** — but to their tenancy column only, so no clinical content has crossed | `operations.ts:94–110`; `supabase/server.ts:5–11`; `191:319–332` |
| *"a form of tier-4 access exists TODAY, silently and unrecorded"* | ⚠ **Half.** **Unrecorded: yes** — no log, no audit, no observation, and the owner branch bypasses the ledger entirely. **Tier 4: no** — five integers per practice is tier 1/2, not clinical access | `operations.ts` (no writes); `context.ts:194–202`, `:210` |
| *"the access matrix and `scan.ts` now classify at page granularity, so an assertion is possible"* | ⚠ **Necessary but not sufficient.** Page granularity landed (1,360 entries) but `MatrixEntry` has **no data dimension at all** — it models the door, not the room. §6.2 is what closes it | `scan.ts:27–48` |
| *"`practice_audit_event` (append-only since migration 247)"* | ✅ **True** — trigger at `247:120–132` — ⚠ **and it is not safe to surface**: payloads carry drug names, procedure labels with laterality, and clinician free text | `247:120–132`; `medication.ts:1292`, `procedures.ts:190`, `security.ts:603`, `:900` |
| *"`104-break-glass.sql` … machinery nobody wired to the platform side"* | ✅ **True, and worse than "not wired"**: `hasActiveBreakGlass` has **zero callers**, so the store grants nothing to anyone. It is also `hospital_id`-scoped with no practice concept | `break-glass.ts:49–58`; `grep -rn "hasActiveBreakGlass" src` → 2 hits, both in the defining file |
| *"the signup harness asserts an entitlement is created — find it"* | ✅ **Found** | `scripts/practice-signup-harness.ts:158–160` |
| Live figures (2 workspaces, 2 patients, 3 appointments, **0 encounters**, 36 identities, 0 handles) | taken as given, **not verified** — ⚠ with 0 encounters, gate item `clinical` is **failing** by construction | `operations.ts:156`, `:183–185` |

---

# 11. What I could not read

- **The live database.** No query was run. Every "live" figure is yours, labelled as such. The row counts
  in §2 and §3 describe **schema and code paths**, never row counts.
- **The project's PostgREST `max-rows` setting.** There is no `supabase/config.toml` in the repo — this is
  a hosted project — so §8's cap is asserted from **this codebase's own recorded experience**
  (`scripts/migration-object-audit.ts:152–183`, six other sites), not from a configuration file I read.
- **Whether the practice console is currently rendering the `clinical` gate item red.** Inferred from
  `operations.ts:183–185` against your figure of 0 encounters; not observed in a browser.
- **`ogs_office_appointments` row count.** Taken from your statement (**zero**) and from migration 264's
  own comment *"NOBODY IS APPOINTED"* (264 §7). Not queried.
