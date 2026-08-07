# CPR-LIFE-SURVEY-001 — Practice Lifecycle & Decommissioning: what exists, what is missing, what the comp asserts

Survey only. No code, no migration, no file changed but this one.
Source spec: `C:\Users\elish\Downloads\CPR-LIFE-001_Practice_Lifecycle_&_Decommissioning_Framework_v1.docx` (v1.0).
Comp: `CPR-LIFE-001_..._v1.png`.
Live probe run 2026-08-07 against the project database via service-role PostgREST, using the harness
discriminator (a missing table returns `count === null`, never an error).

---

## 0. The one-paragraph finding

**The spec is 61 lines long and never once uses the word "anonymise", "anonymous", "pseudonymise",
"privacy law", "GDPR", or "retention period".** The comp's Danger Zone says *"Patient data will be
anonymised or removed according to privacy laws."* That sentence exists **only in the picture**. The
document behind it specifies neither what anonymisation means, which law, which fields, nor any
mechanism. Printing that sentence in a UI would be the product making a legal claim its own
specification does not make and its code cannot honour. This is the single most important finding
in this survey — see §4.

Second finding: the destructive verb is **already reachable** from a script in this repo, with no
confirmation, no export and no audit. `scripts/practice-pilot-gate.ts` does
`admin.from("practice_workspace").delete().eq("id", w.id)`, and **111 foreign keys across 113 tables
declare `references practice_workspace(id) on delete cascade`.** One `DELETE` on one row destroys the
entire clinical estate of a practice in a single statement, today. Everything CPR-LIFE-001 asks for is
a set of *brakes* on a capability that already exists in its rawest form.

---

## 1. What already exists

### 1.1 `practice_workspace` — its live shape is exactly migration 191's

Probed every column. **`practice_workspace` is created in migration 191 and never altered by any
later migration** (`grep` over all 246 migrations for `alter table practice_workspace` returns only
the `enable row level security` line). The live shape confirms it:

| present | absent |
|---|---|
| `id, type, name, owner_person_id, status, country, timezone, default_practice_type, profession_code, primary_specialty_code, suspension_reason, record_version, created_at, created_by, updated_at, updated_by, deleted_at` | `archived_at, closed_at, suspended_at, pending_deletion_at, delete_after, lifecycle_state, retention_until, storage_quota_bytes, storage_bytes` |

`supabase/migrations/191-practice-provisioning-foundation.sql:32-57`.

**There is a status column, and it is a provisioning state machine, not a lifecycle one.** Its CHECK
constraint admits ten values:

```
REQUESTED, IDENTITY_PENDING, PROVISIONING, ONBOARDING, ACTIVE,
SUSPENDED, MIGRATING, CLOSING, CLOSED, FAILED
```

Three of the spec's six states already have a **vocabulary** here: `ACTIVE`, `SUSPENDED`, `CLOSED`
(plus a transitional `CLOSING`). Three do not: **`ARCHIVED`, `PENDING_DELETION`, `DELETED`.**

**Nothing writes the terminal ones.** A grep across all of `src/` for `'SUSPENDED'`, `'CLOSING'`,
`'CLOSED'` finds exactly one hit and it is unrelated (an availability-slot status in
`src/app/api/v1/practice/availability/route.ts:21`). Live tally over the two real workspaces:
`{"ONBOARDING":1,"ACTIVE":1}`, `deleted_at not null = 0`. **`suspension_reason` and `deleted_at` have
never been written by anything.** The state machine's later half is declared and dead.

`src/lib/practice/provisioning.ts` reads `CLOSED` once, defensively — the duplicate-owner pre-check
excludes closed workspaces (`.not("status", "in", "(CLOSED,FAILED)")`, line 175) — so a closure
pathway was anticipated and never built.

### 1.2 The audit trail — exists, is used, and is **not** append-only

`practice_audit_event` (migration 191 §10, lines 217-228): `workspace_id, actor_id, event_type,
source, payload jsonb, payload_hash, correlation_id, occurred_at`. Written through
`audit()` in `src/lib/practice/provisioning.ts:93`. Live: **178 rows, 41 distinct event types.** None
lifecycle-related — the closest are `practice.workspace_created`, `practice.workspace_activated`,
`practice.entitlement_created`, `practice.launch_flag_changed`.

⚠ **The header comment on the table says "append-only". It is not.** The live function registry
returns eleven immutability guards — `practice_access_log_immutable`, `practice_note_version_immutable`,
`practice_follow_up_event_immutable`, `practice_membership_event_immutable`,
`practice_thread_message_immutable`, `practice_contact_log_immutable`,
`practice_procedure_outcome_immutable`, `practice_task_event_immutable`,
`practice_encounter_signed_guard`, `practice_clinical_document_signed_guard`,
`practice_last_owner_guard` — and **none of them is on `practice_audit_event`.** The pilot gate
deletes from it directly (`admin.from("practice_audit_event").delete().eq("actor_id", USER)`).
Spec §7's *"Deletion events are never removable from the platform audit log"* is therefore **false
today** and needs a trigger, not a comment. The pattern to copy is
`supabase/migrations/202-practice-access-log.sql:130-152`.

### 1.3 The read trail and the export machinery

- `practice_access_log` (migration 202, 14 live rows) — every read logged, **genuinely** immutable at
  the database, `subject_kind` already includes `"export"`.
- `src/lib/practice/privacy.ts:179` `exportPatientRecord()` — a real, working, audited export of **one
  patient**: patient, identifiers, contacts, appointments, encounters, notes, note versions, problems,
  diagnoses, treatments, procedures, documents, follow-ups, contact log. Emits
  `practice.patient_exported` and an access-log row. Format `competen-practice-patient-record` v1, JSON.
- `src/lib/practice/privacy.ts:262` `privacyPosture()` — and it already tells the truth about the two
  gaps CPR-LIFE-001 walks into: *"There is no retention policy: nothing is deleted from the access log,
  because how long to keep it is a legal question this product has not been given an answer to"* and
  *"Export produces one patient at a time. A whole-practice export is not built."*

### 1.4 Security, MFA and consent — the enforcement half of §6 is real

`supabase/migrations/213-practice-security-control.sql` + `src/lib/practice/security.ts`:
`practice_security_policy` (one row per practice: `mfa_required`, `break_glass_enabled`,
`break_glass_minutes`, `session_idle_minutes`), `practice_session`, `practice_consent`,
`practice_break_glass`.

**MFA is enforceable, not aspirational.** `src/lib/practice/shell.ts:87-90` calls
`supabase.auth.mfa.getAuthenticatorAssuranceLevel()` and returns `MFA_REQUIRED` unless
`currentLevel === "aal2"`. Spec §6's "multi-factor authentication" step can be built against something
that already works. Password re-confirmation is not built anywhere.

### 1.5 The pilot gate and the launch flags

`scripts/practice-pilot-gate.ts` — CPR-IAM-001 §14 preflight. Provisions a synthetic workspace, runs
the whole clinical loop, **hard-deletes it**, prints manual items rather than passing them.
`src/app/super-admin/platform-ops/practice/PracticeOpsConsole.tsx` — operator console; toggles flags
through `/api/v1/practice/flags`, shows the provisioning saga step ledger. It has **no** suspend,
close, archive or delete control.

Live flag state (`practice_platform_flags`):

| flag | live |
|---|---|
| `practice_pilot_provisioning` | **ON** |
| `practice_sign_in` | **ON** |
| `practice_public_signup` | off |

(Memory records public signup as ON as of 2026-08-02; it reads **off** in the database today. The
posture is: a person can sign in to a practice that exists, but cannot create one self-service.)

### 1.6 The Practice Setup domain registry

`src/lib/practice/setup.ts`. **Eighteen** modules (CPR-SETUP-001's seventeen plus Clinical Parameters),
grouped into **three** domains by `SETUP_DOMAINS` — `foundation`, `operations`, `administration`. Each
module carries `state: "configured" | "needs_attention" | "not_built" | "no_access" | "unreadable"`,
an `hue` swatch, an `href`, a `capability`, and `specSaysUnbuilt`.

**There is no "Security & Data" domain.** The nearest existing homes:

- module 14 `import_export` "Import & Export" → `/practice/privacy`, capability `data.export`, domain
  `administration`;
- nav `/practice/privacy` label **"Activity Log"**, capability `access.review`, `parent: "/practice/setup"`;
- nav `/practice/privacy/security` label **"Security"**, capability `null`, `parent: "/practice/setup"`
  (`src/lib/practice/navigation.ts:224,228`), page at
  `src/app/practice/(shell)/privacy/security/`.

### 1.7 Provisioning saga (migrations 191-203)

`provisioning_request` (idempotency spine, unique index on `idempotency_key`), `provisioning_step`
(eight step codes, replay-safe, `attempts`, `error_code`). `runProvisioning()` in
`src/lib/practice/provisioning.ts:150`. **This is the shape a decommissioning saga should be modelled
on** — it is already resumable, idempotent and step-ledgered, and the runner cannot host a
multi-statement transaction, which is precisely the constraint a delete pipeline has to survive.

### 1.8 Nothing that resembles the lifecycle tables

Probed live and **ABSENT**: `practice_lifecycle_event`, `practice_lifecycle_state`,
`practice_deletion_request`, `practice_export_job`, `practice_retention_policy`,
`practice_lifecycle_config`, `practice_integration`, `practice_integration_connection`.

---

## 2. What is genuinely missing

| Proposed | Demanded by | Note |
|---|---|---|
| `practice_workspace.status` extended: `+ARCHIVED, +PENDING_DELETION, +DELETED` | §2 | A CHECK-constraint change on a live table. `SUSPENDED`/`CLOSED` already legal. |
| `practice_workspace.archived_at / closed_at / pending_deletion_at / delete_after / lifecycle_reason` | §2, §6 | `deleted_at` and `suspension_reason` already exist and are unused. |
| `practice_lifecycle_transition` (workspace_id, from_state, to_state, actor_id, reason, ip, user_agent, approval_id, occurred_at) + **immutability trigger** | §3 "Every transition creates an immutable audit log", §7 "actor, timestamp, IP/device, previous and new state, reason" | `practice_audit_event` has no IP/device column and no immutability guard. |
| **Immutability trigger on `practice_audit_event`** | §7 "Deletion events are never removable" | Currently deletable. Copy `202-practice-access-log.sql:130-152`. |
| `practice_lifecycle_config` (workspace or platform scope: `grace_period_days`, `retention_days`, `required_approvals`, `mfa_required_for_deletion`, `export_required_before_delete`, `legal_warning_text`) | §9 (all six settings) | `practice_security_policy` is the obvious host and has none of these columns (probed: all ABSENT). |
| `practice_deletion_request` (workspace_id, requested_by, requested_at, scheduled_for, confirmation_phrase_ok, mfa_at, export_id, cancelled_at, cancelled_by, executed_at, status) | §6 (seven-step workflow), §3 "Pending Deletion may be cancelled" | Nothing like it exists. |
| `practice_export_job` (workspace_id, scope, formats, requested_by, status, artefact_path, byte_size, completed_at) | §5, §10 "Exports complete successfully before deletion" | `exportPatientRecord` is synchronous and single-patient; a whole-practice export is a job. |
| Whole-practice export function + CSV/PDF/ZIP serialisers | §5 "Export patients, appointments, follow-ups, documents, billing, settings, and configuration" in "PDF, CSV, JSON, ZIP" | Only JSON, only one patient. **Billing does not exist at all** (`setup.ts` module 16: *"There is no billing module"*), so one of the seven named exports has no source. |
| Closure validation engine (six checks) | §4 | Of the six: invoices — **no billing store, uncheckable**; future appointments — computable from `practice_appointment`; pending follow-ups — computable from `practice_follow_up`; team access — computable from `practice_membership`; integrations — **no integration store, uncheckable**; patient notifications — **no delivery channel exists**. Two of six have no data, one has no mechanism. |
| Booking refusal when `CLOSED`/`ARCHIVED` | §2, §10 "Closed practices cannot receive bookings" | The booking engine does not consult `practice_workspace.status`. This is a small, safe, high-value change. |
| Deletion capability code + role grant | §3 "Only authorized users may…" | See §7 below. |
| Scheduled executor for the 30-day expiry | §6 "Automatic deletion after grace period" | No cron for `practice_*` exists. The three platform crons are CDP's. |

---

## 3. ⚠ Every figure in the comp, judged

The comp's status strip carries six figures. Verdicts are against the live schema.

| Figure in comp | Store | Verdict |
|---|---|---|
| **Patients 2,431** | `practice_patient` (exists, 2 rows live) | ✅ **Honest.** `count(*) where workspace_id = …`. Decide whether merged/inactive patients are in or out and say which. |
| **Appointments 14,325** | `practice_appointment` (exists, 3 rows live) | ✅ **Honest**, but ambiguous: lifetime vs future vs non-cancelled. On a *closure* screen the only useful number is **future, non-cancelled** — that is the one §4's checklist asks about. A lifetime total on a decommissioning page is a vanity figure. |
| **Documents 9,481** | three different tables | ⚠ **Honest only if defined.** `practice_clinical_document` (authored clinical documents), `practice_library_document` (practice library files), `practice_attachment` (uploads on encounters) are three different things. One number summing all three is defensible; one number labelled "Documents" that silently means one of them is not. |
| **Storage Used 18.4 GB** | `practice_attachment.byte_size` + `practice_library_document.byte_size` — **both confirmed present** | ⚠ **Partially computable, and materially incomplete.** Those two are the only `byte_size` columns in the entire schema (grep over all 246 migrations). `practice_clinical_document` has none — generated clinical documents are structured rows, not files. So a "Storage Used" figure would cover uploads and library files and **silently exclude the clinical record itself**. Reportable if labelled *"files uploaded"*, not if labelled *"storage used"*. |
| **of 100 GB** | **nothing** | ❌ **FABRICATED. There is no quota store anywhere.** Probed live and ABSENT: `practice_entitlement.storage_quota_bytes`, `practice_plans.storage_quota_bytes`, `practice_plans.quota_bytes`, `practice_configuration.storage_quota_bytes`, `practice_workspace.storage_quota_bytes`. `practice_plans` has exactly four columns — `plan_code, name, trial_days, active`. No `price`, no `limits`, no `storage_gb`. **This codebase has already refused this exact figure once**: `src/lib/practice/document-library.ts:266-293` — *"THE COMP'S 'STORAGE USED 2.4 GB OF 10 GB (24%)' IS A QUOTA, AND THERE IS NO QUOTA… A progress bar against a limit nobody set is a warning that will never fire and a reassurance that means nothing"* — and returns `quotaBytes: null` in the payload so a client physically cannot draw the bar. **The same comp mistake has now arrived twice. The same answer applies.** |
| **Team Members 8 · Active** | `practice_membership` (exists, 4 rows live) | ✅ **Honest.** `count(*) where workspace_id = … and status = 'active'`. |
| **Integrations 6 · Connected** | **nothing** | ❌ **FABRICATED. `practice_integration` is ABSENT** (probed). `setup.ts` module 13 states it plainly: *"No calendar, messaging, payment or FHIR integration exists."* The number can only ever be **0**, and a tile reading "0 Connected" is more useful than one reading 6. §4's *"Integrations disconnected safely"* and the Danger Zone's *"Removed active integrations"* are checks against a table that does not exist. |
| **Created 12 Feb 2026** | `practice_workspace.created_at` | ✅ Honest. |
| **Practice Name / Current Status badge** | `name`, `status` | ✅ Honest — though the badge would today only ever read ONBOARDING or ACTIVE (live tally). |

**Two of eight figures have no store at all.** Under `[[cpr-honesty-rules]]` (no invented targets, no
absent baselines) neither the 100 GB denominator nor the integration count may be rendered.

---

## 4. ⚠ The destructive actions — what the spec says, and what it does not

### 4.1 What the spec DESCRIBES (verbatim, §2)

- **Archived** — *"hidden from daily use; bookings disabled; fully recoverable."*
- **Suspended** — *"temporarily inaccessible due to administrative or licensing reasons."*
- **Closed** — *"operations permanently ceased; data retained according to policy; booking links disabled."*
- **Pending Deletion** — *"30-day reversible holding period."*
- **Deleted** — *"irreversible removal after retention and legal checks."*

### 4.2 What the spec SPECIFIES A MECHANISM FOR

Exactly one thing: the **gate** in front of deletion (§6), and it is specified as a list of seven steps —

1. Password confirmation. 2. Multi-factor authentication. 3. Typed confirmation phrase:
`DELETE MY PRACTICE`. 4. Display legal warning. 5. Enter 30-day Pending Deletion state.
6. Email confirmation sent. 7. Automatic deletion after grace period if not cancelled.

Of those, MFA is buildable against `shell.ts`'s existing `aal2` check; the typed phrase and the
warning are UI; the 30-day state is a column and a scheduled job. **Step 6 cannot be built: this
product has no delivery channel of any kind** — `privacyPosture()` asserts it as a guarantee
(*"Nothing in this product sends email, SMS or messages to patients"*), `setup.ts` module 8 repeats
it. An email-confirmation step in a delete pipeline is a step that will silently not happen.

### 4.3 ⚠ What the spec DOES NOT SPECIFY — and this is the finding

**The spec never defines what "Deleted" does to the data.** It says *"irreversible removal after
retention and legal checks"* and stops. It does not say:

- which rows are removed and which are retained;
- what a "retention check" checks, or against what policy — §9 lists "Retention duration" as a
  *configurable setting* with no default, no source and no legal basis;
- what a "legal check" is, who performs it, or what it can veto;
- whether the storage-bucket bytes go with the rows;
- what happens to a patient who is also a patient of another practice
  (`practice_patient_relationships`, migration 221, makes this a real case);
- what happens to `practice_audit_event` rows about the deleted practice — §7 says deletion events are
  never removable, which means the audit trail must **survive the cascade that would take it**.

**And "anonymised" appears nowhere in the specification.** The comp asserts *"Patient data will be
anonymised or removed according to privacy laws."* The document says nothing of the kind. That
sentence would be:

- a **legal claim** — "according to privacy laws" names no law, and Uganda (the default locale is
  `en-UG`), the UK GDPR and HIPAA impose materially different, sometimes conflicting, minimum
  retention periods on clinical records;
- an **unimplementable claim** — anonymisation of a clinical record is not a column-blanking exercise.
  Free-text SOAP notes, `practice_encounter_note_version` history, correspondence in
  `practice_thread_message` and `practice_contact_log`, and uploaded scans in
  `practice_attachment` all carry identifiers in prose and in pixels. There is no de-identification
  engine in this codebase and none is specified;
- a claim contradicted by the mechanism it would sit on: **111 `on delete cascade` FKs mean the actual
  behaviour is "removed", full stop.** There is no branch in which anything is anonymised.

**Recommendation: the sentence must not be printed.** If a deletion is built, the UI should say what
the code does — *"Every record in this practice is permanently deleted. Nothing is retained and
nothing is anonymised."* — or the spec must be sent back with the anonymisation question answered.

### 4.4 The 30-day window

§2 and §6 both give 30 days; §9 makes "Grace period length" configurable, so 30 is a **default, not a
constant**, and must live in a config row rather than in code. §3: *"Pending Deletion may be cancelled
during the grace period."* §6: *"Automatic deletion after grace period if not cancelled."* Nothing in
this repo runs on a schedule for `practice_*`, so the executor is greenfield — and an unexecuted
Pending Deletion is the *safe* failure mode, which is the right way round.

---

## 5. Legal and regulatory claims the UI would be making

The Danger Zone lists five preconditions ("Before you delete, ensure you have…") and four consequences
("What happens when you delete?").

**Preconditions — enforceable vs printed:**

| Precondition | Verdict |
|---|---|
| Exported your data | ⚠ **Enforceable once a whole-practice export exists.** Today only single-patient JSON export exists, so this can only be printed. §10 requires enforcement (*"Exports complete successfully before deletion"*). |
| Cancelled future appointments | ✅ **Enforceable** — `count(practice_appointment) where starts_at > now() and status not cancelled`, block or warn on non-zero. |
| Cleared outstanding invoices | ❌ **Printed only. There is no billing module.** Unfalsifiable. |
| Removed active integrations | ❌ **Printed only. `practice_integration` does not exist.** Unfalsifiable. |
| Reviewed legal & regulatory obligations | ❌ **Printed only, and irreducibly so** — it is an attestation by a human. Should be recorded as an explicit typed/ticked attestation with actor and timestamp, so at least *the claim that it was reviewed* is auditable. |

**Consequences — true vs asserted:**

| Consequence | Verdict |
|---|---|
| "All practice data will be permanently removed after the 30-day waiting period" | ✅ **True and, given the cascade, unavoidably true.** |
| "You will not be able to recover any data" | ✅ True. |
| "Patient data will be anonymised or removed according to privacy laws" | ❌ **Unsupported by the spec and unimplemented in the code. Do not print.** See §4.3. |
| "This action cannot be undone" | ✅ True. |

Three of five preconditions and one of four consequences are assertions the product cannot stand
behind. A Danger Zone whose checklist cannot be checked teaches a practitioner that the checklist is
decoration — which is exactly the wrong lesson on the one screen where it matters.

---

## 6. ⚠ Navigation — what the TEXT says

**The spec's text contains exactly one navigation sentence, §8:**

> *"Location: Practice Setup → Security & Data → Practice Lifecycle."*

That is the whole of it. There is no navigation section, no sidebar list, no grouping, no mention of
"Patient Care" or "Practice Management", and no instruction to restructure anything. **The comp's
grouped ~20-item three-section sidebar is drawn by the picture and is not in the document.**

This is the third comp in a row to draw a pre-decision navigation. The live sidebar is **nine flat
items** fixed by CPR-PI-001 §4 (`PRIMARY_ORDER` in `src/lib/practice/navigation.ts:249-254`:
home, today, calendar, patients, encounters, documents, follow-ups, intelligence, setup) with
`SIDEBAR_SECTIONS` collapsed to one unlabelled section, and it is pinned by
`scripts/practice-current-activity-harness.ts` §9 (assertion `9b. the sidebar declares CPR-PI-001 s4's
nine sections`, plus `9a` no-orphans, `9g` and `9h` one-flat-section). The UI is additionally frozen
by `[[cpr-ui-design-freeze]]`. **Ignore the picture's sidebar, as the two prior surveys did.**

**The breadcrumb is the usable part, and it points somewhere real.** "Practice Setup → Security & Data
→ Practice Lifecycle" maps cleanly onto the existing structure with **one** open question: there is no
`Security & Data` domain in `SETUP_DOMAINS` (`foundation` / `operations` / `administration`). Two
honest readings:

- **(a)** a nineteenth Setup module `practice_lifecycle` in the existing `administration` domain, at
  `/practice/setup/lifecycle`, alongside `import_export` (→ `/practice/privacy`) and the existing
  `/practice/privacy/security` "Security" page — no sidebar change, no domain change, `PRIMARY_ORDER`
  untouched. This is exactly the precedent set by Clinical Parameters (module 18,
  `src/lib/practice/setup.ts:236-247`: *"LCP-001 contains no navigation section at all… So this is a
  card in an existing domain at an existing route prefix, and PRIMARY_ORDER is untouched"*).
- **(b)** a fourth `security_data` domain regrouping `import_export`, the Security page and Lifecycle.
  That is a real restructure of a frozen surface and needs the user's decision, not a spec's breadcrumb.

**(a) is the reading the spec's text supports.** Note the counting consequence: adding a module moves
`setup.ts`'s configured-of-configurable denominator, and `scripts/practice-setup-domains-harness.ts`
asserts the counts sum — so this is not a free addition.

---

## 7. Capability codes

**43 distinct capability codes are live** in `practice_role_capabilities` (the brief said 39; later
migrations added `pack.install`, `parameter.*`, `pathway.*` among others). Full live list:

```
access.review appointment.manage comm.record data.export diagnosis.record document.author
document.sign document.view encounter.create encounter.edit encounter.list encounter.sign
followup.manage followup.view inbox.record inbox.review message.use pack.install
parameter.configure parameter.record parameter.view pathway.assign pathway.design pathway.view
patient.create patient.edit patient.list patient.merge patient.view practice.calendar.view
practice.home.view practice.locations.manage practice.members.manage practice.settings.manage
procedure.manage procedure.record queue.manage report.view search.use task.manage task.view
template.manage treatment.record
```

**Lifecycle-related codes: NONE.** No `practice.lifecycle.*`, no `practice.delete`, no `archive`,
`suspend`, `close`, `purge` or `retention` code exists.

`practice_owner` holds **11**: `message.use practice.home.view practice.locations.manage
practice.members.manage practice.settings.manage procedure.manage report.view search.use task.manage
task.view template.manage`. Note it does **not** hold `data.export` — that is seeded to `practitioner`
only (`202-practice-access-log.sql:99`).

**Proposed, minimally:**

| Code | Holder | Why |
|---|---|---|
| `practice.lifecycle.view` | `practice_owner`, `read_only_auditor` | Reading the state and the trail is not the same as changing it. |
| `practice.lifecycle.manage` | `practice_owner` only | Archive / suspend / restore — reversible verbs. |
| `practice.close` | `practice_owner` only | Closure is one-way and triggers the §4 checklist. |
| `practice.delete` | **`practice_owner` only, and it should NOT be a role default** — an explicit `source = 'explicit_grant'` row in `practice_role_assignment`, granted per-deletion | The only irreversible verb in the product. `practice_role_assignment` already supports `role_default` / `explicit_grant` / `delegation` and `effective_to`, so a time-boxed grant is expressible with no new schema. |

Do **not** reuse `practice.settings.manage`. Six invented codes have shipped here before; every code
above must be seeded in the same migration that first reads it, and asserted by a harness.

---

## 8. Contradictions with what is already built

1. **The pilot gate already hard-deletes practices.** `scripts/practice-pilot-gate.ts` `cleanup()`
   deletes `practice_workspace` rows, `provisioning_request` rows and `practice_audit_event` rows
   outright. If a `practice.delete` pipeline lands, the gate's cleanup becomes either (a) the one
   sanctioned bypass of it, or (b) something that must be routed through it. **Neither is decided.**
   Leaving both is how a "safe" delete pipeline gets a back door on day one.
2. **`practice_audit_event` is deletable**, which contradicts §7 outright and contradicts the table's
   own header comment. Fix this *before* anything writes deletion events to it.
3. **The `status` CHECK constraint is a provisioning machine, not a lifecycle machine.** `MIGRATING`,
   `FAILED`, `REQUESTED`, `IDENTITY_PENDING`, `PROVISIONING` are not lifecycle states and must never
   appear on a Practice Lifecycle pipeline graphic. Either the six lifecycle states become a *second*
   column (`lifecycle_state`) or the pipeline UI filters the vocabulary. A six-node pipeline rendering
   a ten-value column will eventually draw `FAILED` as a lifecycle state to a practitioner.
4. **`practice_sign_in` is ON and `practice_pilot_provisioning` is ON.** Real people can sign in to
   real practices right now. A lifecycle page shipped into that posture is live on day one — this is
   not a dark-launch situation.
5. **`practice_public_signup` is off.** So today every practice was created by an operator, and an
   operator-mediated decommissioning is coherent. If public signup turns on, self-service creation
   without self-service deletion becomes a data-protection problem in the other direction ("I cannot
   get my practice removed"). The lifecycle work and the signup flag are coupled; note it.
6. **§5's export list names "billing"** and `setup.ts` module 16 states there is no billing module.
   §4's invoice check has no store. An export that silently omits a named category is worse than one
   that declares the category unavailable.
7. **§10 "Closed practices cannot receive bookings"** — the booking engine
   (`src/lib/practice/scheduling.ts`, `booking-rules.ts`) does not read `practice_workspace.status` at
   all. Today, setting a workspace to `CLOSED` by hand would not stop a single booking.
8. **`practice_last_owner_guard`** (migration 201) refuses to remove the last active owner of a
   workspace. A deletion pipeline that removes memberships before the workspace row will hit it.

---

## 9. Direct answers

### Is any of this reachable by a practitioner today, or is it super-admin only?

**None of it is reachable by anyone today** — there is no lifecycle UI, no lifecycle route, no
lifecycle API, and no verb that writes `SUSPENDED`, `CLOSED` or `deleted_at`. The only path to
destruction is a service-role script run by a developer.

**What the spec intends:** §8 places the page in **Practice Setup**, which is the *practitioner's own*
workspace (`/practice/setup`, nav capability `null` — every signed-in member sees it). §3 says *"Only
authorized users may archive, suspend, close, or delete"* and §9 lists *"Required approvals"* as a
configurable setting. **That is the entirety of the spec's authorisation story: it names the existence
of an authorisation step and defines neither who nor what.** It never says "platform operator", never
says "super-admin", never names a role, and never says a second person must agree.

So the spec, read literally, puts an irreversible clinical-data delete in the practitioner's own
settings menu behind an unspecified authorisation. In a `managed_practice` — a type
`practice_workspace.type` already supports — that means **one practice owner could destroy the
clinical records of every other practitioner and patient in that workspace, alone.** `practice_membership`
has four non-owner roles; none of them would be consulted.

**Recommendation:** treat "authorised" as requiring, at minimum, (a) an explicit non-default
`practice.delete` grant, (b) sole ownership *or* recorded consent from every active practitioner
member, and (c) a platform-operator counter-signature for `managed_practice`. None of that is in the
spec; all of it is a decision the user has to make before a delete verb is written.

### What would a half-built version destroy?

**A half-built delete pipeline is the worst artefact this survey can imagine, and the reason is
specific.** The verb is free — `delete from practice_workspace where id = …` cascades across **111
foreign keys and 113 tables** and is one line. Every part of CPR-LIFE-001 that costs effort is a
*brake*: the export, the checklist, the grace period, the audit, the MFA, the cancellation. So the
natural build order — verb first, brakes later — produces, at every intermediate commit, a working
irreversible destructor with some of its safeties missing. Concretely, a partial build could:

- delete before the whole-practice export exists → §10's *"Exports complete successfully before
  deletion"* is unmet and the data is simply gone;
- write the `PENDING_DELETION` state and ship the scheduled executor before the **cancel** path →
  a practice that cannot be rescued inside its own grace period;
- ship cancel before the executor → harmless;
- write deletion events into a `practice_audit_event` that is **still deletable** → the cascade takes
  the evidence with the data, and there is no record that a practice ever existed;
- delete memberships first and hit `practice_last_owner_guard` → a half-cascaded practice with orphan
  clinical rows and no owner, which nothing in the product can then read or fix.

**The safe subset, and it is genuinely useful on its own:**

1. `practice_lifecycle_transition` + the **immutability trigger on `practice_audit_event`** — the
   audit half of §3 and §7. Pure addition, destroys nothing, and is a prerequisite for everything else.
2. `ARCHIVED` added to the status vocabulary, plus **archive / restore / suspend / unsuspend** — all
   four are reversible, all four are state changes on one column, and Archived is the state §1 exists
   to provide (*"safe alternatives to permanent deletion"*).
3. **Make the booking engine read `practice_workspace.status`** and refuse bookings when archived,
   suspended or closed. Small, and it makes §10's third criterion true.
4. The **closure validation checklist as a read-only report** — future appointments, open follow-ups,
   active memberships, all computable today — with the two uncheckable lines (invoices, integrations)
   rendered as *"no store, cannot be checked"* rather than as green ticks.
5. **Whole-practice export** as a first-class capability, independent of deletion. It is the single
   most valuable thing in this spec, it is useful on its own day one, and it is the precondition every
   destructive path depends on.
6. `CLOSED` as a terminal-but-non-destructive state — data retained, nothing removed.

**Stop there.** That is states, audit, brakes and export, with **no destructive verb**, and it delivers
§1's stated objective — *"Prevent accidental loss"*, *"controlled lifecycle states instead of immediate
deletion"* — in full. `PENDING_DELETION` and `DELETED` should not be built until the user has answered
the anonymisation question (§4.3), the authorisation question (§9), and the email-confirmation gap
(§4.2 step 6).

---

## 10. Files and migrations named in this survey

- `supabase/migrations/191-practice-provisioning-foundation.sql` — `practice_workspace` (status CHECK,
  `deleted_at`, `suspension_reason`), `practice_audit_event`, `practice_platform_flags`, capability seeds
- `supabase/migrations/201-practice-team.sql` — `practice_last_owner_guard`, membership event immutability
- `supabase/migrations/202-practice-access-log.sql` — access log + the immutability trigger pattern,
  `data.export` seed
- `supabase/migrations/207-practice-documentation-tools.sql` — `practice_attachment.byte_size`
- `supabase/migrations/210-practice-document-library.sql` — `practice_library_document.byte_size`, recycle bin
- `supabase/migrations/213-practice-security-control.sql` — `practice_security_policy` (MFA, sessions), consent
- `src/lib/practice/provisioning.ts` — saga, `audit()`, `platformFlag()`
- `src/lib/practice/privacy.ts` — `exportPatientRecord()`, `privacyPosture()`
- `src/lib/practice/security.ts` — policy, sessions, break-glass
- `src/lib/practice/shell.ts` — the `aal2` MFA gate
- `src/lib/practice/setup.ts` — the 18-module registry and `SETUP_DOMAINS`
- `src/lib/practice/navigation.ts` — `PRIMARY_ORDER` (nine), `SIDEBAR_SECTIONS`
- `src/lib/practice/document-library.ts` — the storage-quota refusal precedent
- `scripts/practice-pilot-gate.ts` — the existing hard-delete
- `scripts/practice-current-activity-harness.ts` — §9, the nine nav assertions
- `src/app/super-admin/platform-ops/practice/PracticeOpsConsole.tsx` — operator console, flags
