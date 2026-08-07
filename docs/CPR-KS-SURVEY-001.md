# CPR-KS-SURVEY-001 — Clinical Knowledge Studio: what exists, what is missing, what it costs

Survey only. No application code, no migration, no file changed but this one.

**Sources.** Two copies were supplied and they are **not** near-identical — they are different documents:

| file | `word/document.xml` | content |
|---|---|---|
| `CPR-KS-001 — Clinical Knowledge Studio & Authoring Engine.docx` | 108,715 bytes | **449 lines. The real spec.** Fifteen numbered parts, engine by engine. |
| `CPR-KS-001_Clinical_Knowledge_Studio_and_Authoring_Engine.docx` | 7,593 bytes | 33 lines. A condensed restatement. |

The second file is *larger on disk* (38 KB vs 24 KB) purely because it carries a 349 KB `styles.xml` and a
`stylesWithEffects.xml`. Its **body is one-fourteenth the size**. Byte size on disk was the wrong
discriminator here; I diffed the extracted bodies.

⚠ **The two copies use DIFFERENT SECTION NUMBERS for the same engines.** The long one numbers
Document Authoring as *Engine 1 under §2*; the short one numbers it *§4*. This is a fourth numbering
register in a product that has already settled three (`CPR-nnn` v1.0, `CPR-V2-nnn`, `CPR-V3-nnn`).
Citations below give **both**, as `long §2/Engine 1 · short §4`. **Nothing in the short copy adds a
requirement the long copy lacks**, so the long copy is the specification and the short one is a summary.

Live probe run 2026-08-07 against the project database via service-role PostgREST. Where a table's
existence was in doubt I used `select … limit 1` and read the error code, **not** `head+count` — a
missing table and an empty table both return `count === null`, and four of my first-pass "missing"
results were that trap.

---

## 0. The one-paragraph finding

**The prior held, but very unevenly.** Of the **twelve engines** CPR-KS-001 names, **three are
substantially built** (Documents ~70%, Pathways ~65%, Forms ~55%), **three have a real data model or a
working primitive but no runtime** (Algorithm, Interactive Tools, AI Builder), and **six are genuinely
greenfield** (Guideline & SOP, Checklist, Visual Designer, Diagram, Patient Education, Asset Library).
Long §3's Common Components exist **five times over as silos and zero times as a shared layer**.

The overall figure lands inside the 50–70% the previous five surveys found, but it is concentrated
rather than spread. **Everything that is structured data authored through a form already exists in some
silo. Everything that is free-form visual composition does not exist at all**, in any form, anywhere in
the repo — and **no installed dependency provides any part of it**. The entire front-end dependency list
is `next`, `react`, `react-dom`, `@supabase/*`, `@anthropic-ai/sdk`, `mammoth` and `qrcode`. No canvas
library, no diagram library, no drag-and-drop library, no PDF library, and **no rich-text editor** —
`contentEditable` appears nowhere in `src/`.

⚠ **A fourth finding that changes the shape of the plan** (§1.13): the product *already* has a versioned
policy/SOP store with an editor (`policies`, mig 007) and a versioned prose-knowledge store with a
library UI (`knowledge_objects`, mig 025). Neither is reachable from a practice, because the whole
competency estate is keyed on `hospital_id` and `practice_workspace` shares no table with it. So Phase 1
rebuilds, for the practice tenancy, something this codebase already built once. That is the right call —
but it is a decision, not a detail.

Second finding, and the one most likely to cost money if it is missed: **the practice tier's document,
note-template and AI-task vocabularies are all `CHECK`-constrained enums in the database.**
`practice_clinical_document.doc_type`, `practice_note_template.kind` and `practice_ai_session.task` each
admit a fixed list. A Knowledge Studio that lets a practitioner invent a new asset type is a designer
whose output the runtime will **reject at the database**, and no amount of front-end work fixes it. That
is the precise line asked about in "what would a half-built Knowledge Studio be worse than not starting"
— see §8.

Third: **the name is already taken.** `src/lib/super-admin/ckp-studio.ts` exports `loadKnowledgeStudio()`
and `/super-admin/ckp/studio` is already labelled Knowledge Studio. It is a read-only counting dashboard
over the competency estate, unrelated to any of this. Two things called Knowledge Studio in one product
is a support-call generator; §9 lists it as a decision.

---

## 1. What already exists, named

### 1.1 Intelligent Forms Engine — **largely built** (long §4 · short §9)

⚠ The table is **`practice_registration_field`**, not `practice_registration_template_field`. Probed live;
the name in the brief returns `PGRST205`.

`supabase/migrations/223-practice-registration-templates.sql` is the **only** migration touching either
table — grepped all 254. The 223 shape is the current shape.

**`practice_registration_template`**: `id, workspace_id, name, specialty, country, practice_type,
status ('draft','published','retired'), version, is_default, created_at/by, updated_at/by,
published_at/by`. Partial unique index enforces one default published template per workspace.

**`practice_registration_field`**: `id, workspace_id, template_id, field_key (^[a-z][a-z0-9_]{1,40}$),
is_core, label, help, field_type, required, visible, display_order, options jsonb, condition jsonb`.

Nine field types: `text, long_text, number, date, select, multi_select, boolean, phone, email`.

Engine: `src/lib/practice/registration-config.ts` (518 lines). It already does the hard parts —
`validateTemplate()` catches five classes of defect including **condition-cycle detection with a step
cap**; `resolveTemplate()` does specificity-ranked matching on specialty/country/practice_type;
published templates are **immutable** (`upsertField` returns 409 `PUBLISHED`) and the forward path is
`duplicateTemplate()` → new draft at `version + 1`.

Authoring UI: `src/app/practice/(shell)/settings/registration-form/FormEditor.tsx` (429 lines) —
field list with reorder, Shown/Required toggles, a condition builder, live problem list, publish/retire.

API: `src/app/api/v1/practice/registration-templates/route.ts`.

**What it does NOT have** (all required by long §4): per-field validation rules (no regex, min, max,
length column), calculated fields, repeating sections, sections/pages/groups of any kind, signature
field type, file/image upload field type, and **a response table** — answers are written into
`practice_patient.custom_fields jsonb`, deliberately (223:110).

⚠ **A live defect worth knowing before building on this.** `conditionMet()` is imported by
`registration-config.ts` and the harness **only** — grep confirms zero UI callers. The renderer
(`src/app/practice/(shell)/patients/RegistrationForm.tsx`, 569 lines) shows every visible custom field
**regardless of its condition**; the server discards non-applicable values afterwards in
`validateSubmission()`. The file comment claiming one shared function is aspirational. Conditional
display is authored and stored but **not honoured on screen**.

### 1.2 Document Authoring Engine — **substantially built** (long §2/Engine 1 · short §4)

⚠ **`practice_document_template` does not exist.** No migration creates it, no code references it.
Document templates are `practice_note_template` rows with `kind != 'encounter_note'` and a `body_template`.

`practice_note_template` (mig 195, extended by 204): `workspace_id` **nullable — null means a platform
template shared to every workspace**, `code, title, description, kind, specialty, status
('draft','published','retired'), version, body_template, include_letterhead`. Plus
`practice_note_template_section` for SOAP-structured notes.

`src/lib/practice/document-generation.ts` (477 lines): `mergeTemplate`, `buildMergeContext`,
`letterhead`, `generateFromTemplate`, `generateBatch` (max 200), `createSchedule`, `reportsDashboard`.

Merge fields work and are **whitelisted to 13** in `document-constants.ts` — `patient.*` (6),
`encounter.*` (4), `practice.name`, `practitioner.name`, `today`. An unresolved field renders
`[[unknown field: x]]`, never a blank, and generation refuses with 422 unless `allowUnresolved`.

Branding is real: `practice_configuration.letterhead_name/_registration/_address/_contact/_footer`,
composed at print time rather than baked into the body.

The Documents workspace already ships tabs `library · mine · patient · review · shared · templates` and
APIs `ai-draft · batch · bulk · classify · export · generate · register · review`.
`practice_library_document` + `practice_folder` (mig 210) give a filed, searchable, recycle-binned store
gated on `document.view` / `template.manage`.

**Not built**: rich text (body is `text`, "not HTML" by comment), conditional or looping content, Word
export, and **PDF generation** — there is no PDF library in the tree at all. Export is
`window.print()` against a print-CSS page with a DRAFT watermark, which the code openly calls the PDF
export "without this product taking on a rendering library".

### 1.3 Clinical Pathway Engine — **built, and linear** (long §2/Engine 3 · short §6)

`supabase/migrations/239-practice-continuity-pathways.sql`, five tables, no later migration touches them:
`practice_pathway_template`, `practice_pathway_stage`, `practice_patient_pathway`,
`practice_patient_pathway_stage`, `practice_pathway_event`.

Engine `src/lib/practice/pathways.ts` (977 lines) with a full runtime: assign, complete, skip, repeat,
delay, cancel, stop — **every deviation requires a reason** and writes a `practice_pathway_event`.
Versioning via `version` + `supersedes_template_id`. Authoring UI exists:
`src/app/practice/(shell)/pathways/TemplateDesigner.tsx` (188 lines), an ordered `<ol>` of stage rows.

**What long §2/Engine 3 asks for and this lacks**: decision points and branching (order is a single
integer `position` — a pathway is **strictly linear**), KPIs (no column), linked documents, linked
tasks, linked patient education (no FK or jsonb for any of the three). Entry/exit criteria exist as
**prose that is deliberately never machine-evaluated**. There is no draft/published lifecycle, only
`is_active`. `publishPathwayVersion` and `setTemplateActive` exist in the engine and API with **no
screen calling them**.

### 1.4 The Version / Review / Approval spine — **exists, per-silo, never shared** (long §3)

Every one of these already implements draft→published→retired independently:

| store | lifecycle | versioning |
|---|---|---|
| `practice_registration_template` | draft/published/retired | `version` + immutability + duplicate |
| `practice_note_template` | draft/published/retired | `version` |
| `practice_parameter_definition` | draft/active/retired | `version` + **full jsonb snapshots** in `practice_parameter_definition_version` |
| `practice_pathway_template` | `is_active` only | `version` + `supersedes_template_id` |
| `practice_clinical_document` | DRAFT/FINAL/SIGNED/AMENDED/ENTERED_IN_ERROR | signature columns |

`practice_approval_request` (mig 208) is **already a generic review engine**: `requested_by, assigned_to,
subject_kind ('document','patient','appointment','task','incoming_document','other'), subject_id, area,
summary, urgency, status (PENDING/APPROVED/REJECTED/WITHDRAWN), decided_by, decision_note`. The
`'other'` member means a new subject kind needs **no migration**. This is the single most reusable thing
found in the survey.

**What does not exist is the shared layer long §3 asks for.** Five silos each solved versioning their
own way, with five different column sets and three different status vocabularies. Nothing reads across
them; there is no asset table, no shared search, no shared permission model.

### 1.5 `practice_parameter_definition` + packs (mig 246) — the best-governed thing in the product

Ten tables. Full columns include `data_type` (8 values), `options jsonb`, `unit_conversions jsonb`,
`applicability jsonb`, `presentation jsonb`, **`formula text`**, `risk_class`, `licence_required` +
`licence_reference`, `status (draft/active/retired)`, `version`, `effective_from`, `review_on`,
`cloned_from_id`. `workspace_id IS NULL` means a **platform-tier** row, and the engine refuses workspace
writes to platform rows. Constraints with teeth: a definition **cannot go active while it is marked
licence-required with no licence reference**.

`practice_parameter_definition_version` stores a **full jsonb snapshot per version, not a diff** — the
one store in the practice tier that can reconstruct any past version exactly. If a Knowledge Studio
needs a versioning pattern to copy, this is it.

⚠ **`formula` is a display string, not an executable expression.** `parameters.ts:~256` defines "the two
derived values this build can compute" as a hardcoded map pointing back at `clinical-calculators.ts`.
Adding a calculated parameter still requires a TypeScript change, and the CPL seed catalogue
(`scripts/cpl-catalogue.ts`, 617 lines of definitions as data) authors **no** calculated parameters. So
the no-code layer is real for *collection*, and not yet real for *computation* — which is exactly the gap
long §7's Interactive Tool Engine would have to close.

⚠ **The pack lifecycle is declared and not implemented.** The column admits `draft/published/retired`;
no code anywhere writes `status: 'published'`. `createPack` hard-codes `draft`, and a practice-created
pack stays draft forever **and is still installable**. Packs bundle parameter definitions only.

### 1.6 Prior art for the Algorithm Engine — real data model, no drawing

`src/app/super-admin/platform-ops/workflows/WorkflowBuilder.tsx` (140 lines) already models
`{ nodes: {key,type,label,config}[], transitions: {from,to,condition?}[] }` with node types
`start, task, decision, approval, timer, notification, integration, ai_action, end`, persisted to
`configuration_registry_objects.definition`. **It renders zero `<svg>`.** Nodes are a vertical list of
form rows; transitions are two `<select>` dropdowns plus a condition string; the "flow preview" is text
lines like `◆ Decision →[approved] Task`. No coordinates, no dragging, no drawing.

Also present: `knowledge_edges` (mig 012) — `source_type, source_id, target_type, target_id,
relationship` over eleven relationship kinds, with `knowledge_embeddings` (pgvector) alongside.

**This is genuinely useful.** It proves the node/transition *shape* is workable in this codebase and
persists cleanly as jsonb. It is platform-scoped, form-based, and has no execution runtime.

### 1.7 The no-code FORM designer — richest vocabulary, zero runtime

`src/app/super-admin/platform-ops/forms/FormDesigner.tsx` has 19 field types including the four the
practice tier lacks — **`signature`, `file`, `image`, `calculated`** — plus a live disabled preview
renderer. Its own header says conditional logic, validation rules, workflow binding and offline capture
are "honest next-phase". **There is no runtime that renders its output and no response store.** It
writes to `configuration_registry_objects.definition`, which is **platform-scoped: the table has no
`workspace_id` column at all.** It therefore *cannot* govern per-practice knowledge assets without a
new store.

### 1.8 `configuration_registry_objects` / `configuration_releases` — governance that does not reach here

32 `object_type` values are allowed by the CHECK constraint (including `FORM`, `FIELD`, `TEMPLATE`,
`WORKFLOW`, `APPROVAL_RULE`). ⚠ **Only 8 are live** (`PLATFORM, PRODUCT_SUITE, WORKSPACE,
NAVIGATION_SECTION, MODULE, WIDGET, METRIC, DASHBOARD` across 80 rows), and only 12 are authorable per
`OBJECT_SCHEMAS`. Nothing is seeded in SQL; rows come from `syncRegistryFromCatalog()` walking in-code
catalogues.

`configuration_releases` (mig 099) has a real lifecycle — create → validate (schema + dependency gate) →
approve → publish → activate (with snapshot checkpoints) → rollback. But: **approval is a single
super-admin flipping a status** (no reviewer roles, no multi-approver), **no scheduler ever fires a
`scheduled` release**, and `phased`/`canary` are stored with no behaviour. Activation does exactly one
thing: sets `status='active'` on registry rows.

**Verdict: not reusable for this programme.** It is platform-tier, has no tenancy column, and knows
nothing about `practice_*` tables. The practice tier has its own separate governance (workspace-scoped
capabilities plus per-table status columns). The two systems do not touch, and joining them is a much
larger job than building a practice-tier asset lifecycle.

### 1.9 AI — the primitive exists, the authoring pattern exists once

`src/lib/ai/client.ts` exports `generate({system, user, tier, maxTokens, context})`, logging every call
to `plat_ai_requests`. Sixteen copilot endpoints and fourteen mounted `AiCopilotPanel`s exist — **none
in the practice tier**, which has its own `src/lib/practice/ai-assistant.ts` with six tasks
(`summarise_encounter, summarise_history, draft_referral, patient_instructions, tidy_note, ask`),
five grounding contexts and **no ungrounded mode**.

⚠ The six tasks are a **`CHECK` constraint on `practice_ai_session.task` (mig 215)**. A seventh task —
"draft a guideline", "convert this into an algorithm" — **requires a migration**. Long §9's AI Knowledge
Builder is at minimum one migration before it is one line of prompt.

The one true AI-authoring precedent is `src/app/api/config/copilot/route.ts`: it derives a schema hint
from `OBJECT_SCHEMAS` so prompt and validator cannot drift, extracts JSON, validates it, and
**returns a proposal that is never written**. That is the correct shape and it should be copied.

### 1.10 Interactive Tool Engine — four calculators, hardcoded (long §7)

`src/lib/practice/clinical-calculators.ts` (198 lines): BMI, BSA (Mosteller), MAP, eGFR (CKD-EPI 2021).
The typed shape `Calculator {key, name, formula, fields[], compute()}` is already the right model — but
`compute` is a **TypeScript function**, so calculators are code, not data. Authoring one from a UI needs
a formula evaluator, and there is none anywhere in the repo.

**Every scoring instrument in the product is hardcoded the same way**, which is worth knowing before
promising an authoring tool: the HWW instruments v2 engine (`src/lib/hww/instruments.ts`, 249 lines —
PEWS, Ward12, CIAF, NAS) holds every band, weight, domain and staffing ratio as a TypeScript `const`,
and mig 157 adds **no definitions table**. The file says so itself: the constants are *"the single place
to lift into config later."* `src/app/supervisor/toolkit/ClinicalToolkit.tsx` hardcodes NEWS2 inline
again. **There is no instrument-definition row anywhere in the schema.**

⚠ The file **explicitly refuses dosing calculators**, at length, on safety grounds: *"getting it right
needs a drug database, a route, a renal adjustment and an indication — none of which this product has."*
Long §7 lists "Drug dosing tools". This is a standing engineering refusal, not a gap — see §9.

### 1.11 Checklists — four engines, none in the practice tier (long §2/Engine 5 · short §8)

`skill_checklists` + `checklist_items` + `checklist_responses` (migs 007/009/020) is **the most complete
define-then-capture loop in the codebase** — sections, critical items, scoring method, evidence
requirement, and a real response table. It is competency-side. The others are `shift_readiness_records`
(items in code), POS inline checklists (fixed `items: string[]`), and `ogs_activation_checklist` (four
booleans).

The practice tier has **none**. `practice_task_template` + `_item` is the nearest analogue and mig 211
explicitly frames "a checklist collapsed into a word" as the thing it was avoiding.

### 1.12 Delivery — thinner than "just add credentials"

Two independent adapter stacks, both raw `fetch`, both env-gated, **and neither is wired to a production
path**. This is worse than the brief assumed and it matters for Phase 6.

**Stack A — `src/lib/notifications/dispatch.ts`.** Resend email + webhook implemented.
⚠ **SMS is not implemented at all** — the code hardcodes `status: "skipped", error: "sms adapter
pending"` even when Twilio env is present; `teams`/`slack` are `ready: false` unconditionally.
⚠ **`dispatch()` has exactly one caller in the entire codebase: `/api/notifications/test`.** Everything
real goes through `src/lib/notify.ts` → an **in-app row insert only**.

**Stack B — `src/lib/practice/messaging.ts`.** Real Twilio and Resend `fetch` calls, plus
Africa's Talking. Six fixed server-composed templates.
⚠ **`sendMessage()` has exactly one call site: inside `issueOtp()`.** The three appointment templates
exist and are **never invoked**. `practice_message_channel.enabled` defaults to **false** per workspace.

**So even with credentials set, the only thing that can leave this system is a booking/sign-in OTP.**
Both stacks report `receiptsAvailable: false` — no delivery webhooks are hosted.
`src/lib/practice/booking-rule-constants.ts:77` states the current position plainly: *"this deployment
has no SMS gateway and no mail provider configured"*.

**There is, however, a real transactional outbox**: `domain_events` (mig 102) with
`pending|processed|failed|dead_letter`, `attempts`, and an idempotency unique index, drained hourly by
`src/lib/delivery/consumer.ts`; `practice_domain_event` (mig 233) is the practice equivalent. It fans out
to in-app notifications only. `notif_deliveries` (mig 056) is a **log, not a queue** — nothing drains it.

`qrcode ^1.5.4` **is** installed and proven in `src/lib/practice/identity-service.ts`.

### 1.13 Platform-tier prose stores that already exist — and why they do not help

Three stores on the competency/platform spine already do a large part of what long §2/Engine 4 asks for:

- **`policies` (mig 007)** — `title`, **`content` (markdown/rich text)**, `policy_type`
  (clinical/hr/safety/governance/infection_control/quality), `version`, effective and review dates,
  `approved_by`, with a working editor at `/super-admin/policy-manager` (`PolicyEditor.tsx`).
  **This is a versioned policy/SOP document store with an authoring UI, today.**
- **`knowledge_objects` (mig 025)** — `code, title, summary, **content** text, knowledge_type` (ten
  values), `evidence_level`, `status draft|active|retired`, `review_date`, with
  `/super-admin/studio/knowledge/KnowledgeLibrary.tsx` + `/api/knowledge-objects`.
- **`cap_assets` / `cap_asset_files` / `cap_asset_translations` (migs 137–142)** — a genuine unified
  asset index over twelve source tables, with a private file bucket and translations.

⚠ **None of it is reachable from the practice tier, and the barrier is in three places at once**:
every surface redirects unless the caller is `super_admin`; the write APIs allow only
`super_admin`/`hospital_admin`/`educator`; and the whole model is keyed on `hospital_id`/`framework_id`/
`cpu_id` with **no `practice_workspace_id` anywhere**. `practice_workspace` (mig 191) is a separate
tenancy spine that shares no table with it.

**This is the survey's most consequential structural finding.** Reuse means either re-tenanting those
tables — a large, risky migration touching the competency estate — or building fresh on the practice
spine. §3 assumes the latter. But it means Phase 1 is **rebuilding something the product already has
once**, for a different tenant, and the user should know that before approving it. Note also that
`learning_resources` already carries `article`/`guideline`/`policy` types (metadata + URL, no body), and
that three parallel copies of the Competency Studio already exist (`/super-admin/studio`,
`/competency-studio`, `/educator/studio`). This codebase has a demonstrated tendency to grow a fourth.

---

## 2. What is genuinely missing, per module

| KS module | spec cite (long · short) | verdict | what is actually absent |
|---|---|---|---|
| Document Authoring | §2/E1 · §4 | **~70% built** | rich text, PDF/Word export, conditional body |
| Clinical Algorithm | §2/E2 · §5 | **greenfield in practice** | no node/branch store, no validation, no execution runtime. `WorkflowBuilder` is a platform-tier shape to copy |
| Clinical Pathway | §2/E3 · §6 | **~65% built** | branching, KPIs, linked documents/tasks/education, publish lifecycle |
| Guideline & SOP | §2/E4 · §7 | **greenfield** | nothing. Its ten template sections are a `practice_note_template` variant away |
| Checklist | §2/E5 · §8 | **greenfield in practice** | no definition store, no conditional items, no completion capture, no mobile mode |
| Visual Designer | §2/E6 · §10 | **greenfield, zero prior art** | see §4 |
| Common components | §3 · §3 | **five silos, no shared layer** | no asset table, no shared search, no shared permissions, no branding beyond letterhead |
| Intelligent Forms | §4 · §9 | **~55% built** | validation rules, calculated fields, repeating sections, signature/upload types, response store, client-side conditions |
| Diagram Engine | §5 · — | **greenfield** | nothing. Org charts, fishbones, swim lanes, Gantt, matrices |
| Patient Education | §6 · §11 | **greenfield, absolutely** | ⚠ `patient_education`, `leaflet`, `discharge_instruction` return **zero hits** across `src/`, `supabase/` and `docs/`; `education` returns zero across the whole practice tree. Nearest neighbours are staff CPD planning and a folder *label* on an uploaded file |
| Interactive Tools | §7 · — | **4 hardcoded** | no authoring, no formula evaluator. Dosing is refused |
| Asset Library | §8 · — | **greenfield** | no unified asset row to search by specialty/disease/age/tag/author/version/status/type |
| AI Knowledge Builder | §9 · §12 | **primitive exists** | needs a migration to add tasks; needs structured output + validators per asset type |
| Integration | §10 · §14 | **partly** | Encounter/Follow-up hooks exist; Patient Education and Teaching do not |

---

## 3. Phased build plan

Judged on value delivered per unit of cost, smallest viable first.

### ⚠ Phase 1 delivers something usable soonest — and it is mostly assembly. Say so.

**Phase 1 — Knowledge Library + Guideline/SOP authoring.** *Small. Highest value per unit of cost.*

One new store (`practice_knowledge_asset`: workspace, type, title, owner, status, version, effective/review
dates, tags, body, `supersedes_id`) plus a page at `/practice/knowledge-studio`. Guidelines, policies,
protocols, SOPs and work instructions are **structured prose with ten named sections** (long §2/Engine 4)
— exactly the shape `practice_note_template_section` already handles. Review and approval route through
`practice_approval_request` with `subject_kind: 'other'`, needing **no migration for the approval side**.
Publishing means print-to-PDF, which already works.

**Be honest about what this is**: roughly 60% of Phase 1 is wiring together `practice_note_template`'s
section model, `practice_approval_request`, `practice_library_document`'s filing, and the existing print
route. The genuinely new work is the asset row, the lifecycle, and one screen. That is *why* it is the
right first phase — it is the cheapest path to a practitioner writing a protocol and a colleague
approving it, which is the product promise in miniature.

⚠ **And be honest about the duplication.** The `policies` table (mig 007) is *already* a versioned
markdown policy/SOP store with a working editor, and `knowledge_objects` (mig 025) is already a versioned
prose store with a library UI. Phase 1 builds a third, because neither can be reached from a
`practice_workspace` (§1.13). That is a defensible decision — re-tenanting the competency estate is far
riskier than one new practice-scoped table — but it should be a **decision**, not an oversight, and it is
listed in §9.

**Phase 2 — Checklist engine.** *Small-to-medium. High value.*
Definition + item + response, copying `skill_checklists`/`checklist_items`/`checklist_responses`, which
already solved sections, critical items and response capture. Conditional items reuse
`registration_field.condition`'s three shapes and `conditionMet()`. Mobile mode is CSS.
⚠ **Fix `conditionMet()`'s missing UI caller first** (§1.1) or conditional items ship broken the same way.

**Phase 3 — Forms engine completion.** *Medium. High value, and it repairs a live defect.*
Add validation rules, calculated fields, sections, and a **generic response store** to the registration
model; then build the one thing missing everywhere — a runtime that reads a stored field definition and
renders a fillable form with conditions honoured. `FormDesigner`'s 19-type vocabulary is the target;
`PosField`'s renderer is the closest working example to copy. This unlocks audit tools, questionnaires,
consent forms and research forms in one move.

**Phase 4 — Algorithm engine, form-based, no canvas.** *Medium. Value depends entirely on §8's line.*
Node/branch store plus branch-completeness validation (every decision node's outcomes covered — long
§2/Engine 2 and §12's "identify missing branches"). Author it the way `WorkflowBuilder` does: an ordered
list with dropdowns, plus a **read-only** rendered flow diagram in hand-written SVG. Then extend
pathways with branching, since the two share a model.
⚠ **Ship the execution runtime in the same phase, or do not ship the phase.** See §8.

**Phase 5 — Asset library + shared spine.** *Medium. Value grows with phases 1–4, and only then.*
Unified search and tagging across every asset, plus a shared version/review/publish layer the five
existing silos can migrate onto. **Deliberately last**: building a shared abstraction over one or two
asset types is how you get an abstraction that fits neither.

**Phase 6 — Patient education.** *Medium.* Blocked on delivery (§7). QR codes already work.

**Phase 7 — Interactive tools.** *Large, low value for now.* Four calculators exist; a formula-evaluator
authoring UI is a big build with a small audience. Defer.

**Not phased: Visual Designer and Diagram Engine.** See §4.

---

## 4. ⚠ The Visual Designer — a straight answer

**Recommendation: refuse it in this programme, and build a narrow substitute in Phase 1.**

Not "defer", not "phase 8". Refuse it as specified, and say what replaces it.

**What it would cost.** A Canva-style canvas with layers, grouping, locking, smart guides, snapping,
distribution, multi-select, undo/redo, text-on-canvas with fonts and reflow, image placement, shape
tools, tables, charts, timelines, callouts, and six canvas presets (long §2/Engine 6) is a **6–12 week
dedicated front-end build with no other output**, and it is the kind of build that is never finished —
every user compares it to Canva, and Canva has a hundred engineers on it. There is **zero prior art in
this repo to reduce that estimate**: no canvas library, no drag-and-drop beyond four file-drop zones and
one list reorder, no SVG editor, no rich-text editor, no undo stack anywhere. It would also be the first
UI dependency added to a deliberately minimal nine-package tree, or else hand-rolled, which is worse.

**Buying is not really available either.** The plausible embeddables are commercial SaaS canvases; they
mean an external script, an external asset store, and patient-adjacent content leaving the tenancy. That
collides with this product's own posture — it refuses percentile bands and dosing calculators on
narrower grounds than "clinical content is rendered by a third party we do not control". Excalidraw or
tldraw could be self-hosted for *diagrams*, but neither is a page designer, and both are large.

**What the product actually loses without it: less than the spec implies.** Work through long §11's asset
list. Correspondence, certificates, reports, guidelines, SOPs, protocols, checklists, audit tools, forms,
questionnaires, consent forms, meeting minutes, teaching handouts and discharge instructions are all
**structured documents** — they need templates, merge fields, sections and branding, and they are served
by Phases 1–3. Only **posters and infographics** genuinely need free-form composition, and they are the
one category a practitioner can already make in Word, Canva or PowerPoint and upload to
`practice_library_document`, which already exists with folders and a recycle bin.

**The narrow substitute, in Phase 1, for a fraction of the cost:** a fixed set of A4 layout templates
(title, sections, image slot, footer, QR code) rendered by the existing print route, with `qrcode`
already installed and proven. Practitioners get a branded, printable, publication-ready leaflet with a
scannable link. They do not get to move a box 3mm to the left. **That trade is worth making**, and it is
the difference between two weeks and three months.

**If the user overrules this**, the honest sequencing is: do it *last*, as a standalone programme with
its own specification, after Phases 1–5 have proved the asset spine — never as "part of" Knowledge
Studio, because bundling it guarantees the eleven cheap engines wait on the one expensive one.

---

## 5. Navigation

⚠ **The specification says nothing about navigation. Nothing at all.**

I grepped both extracted bodies for `sidebar`, `navigat*`, `primary`, `menu`, `top-level`, `section of
the`, `under documents`, `workspace item`. Across 482 lines there is **exactly one hit**, and it is not
about navigation:

> long §2/Engine 6, the Visual Designer's object list: "Callouts · Colour blocks · **Sidebars** · Banners"

That is a *sidebar as a page-layout element on a poster*. Reading it as a navigation instruction would be
the exact failure mode this repo has already recorded six times. **There is no comp-derived placement to
report and no spec text to quote for or against any position.**

**The user's decision — Knowledge Studio goes under Documents — is therefore unopposed by the
specification, and it is also the cheapest thing the harness will accept.** Verified against
`scripts/practice-current-activity-harness.ts` (94 assertions; the nav block is 9a–9i at lines 529–679):

| assertion | effect of adding KS as a **child** of `/practice/documents` |
|---|---|
| 9b — `sections.length === 9` | **untouched**; primary count stays 9 |
| 9b-order — literal 9-href array | **untouched**; `V5_ORDER` is written out in full and unchanged |
| 9c — every parent is primary AND built | **satisfied**: `/practice/documents` is `primary: true, built: true` |
| 9d-control — owner sees exactly 9 | **untouched** |
| 9e-control — children counted by equality | **self-adjusting**; both sides derive from `PRACTICE_NAV` |
| **9f — every built nav entry points at a page that exists** | ⚠ **the gate.** `built: true` is illegal until `src/app/practice/(shell)/knowledge-studio/page.tsx` exists |
| 9i — every built page has a nav entry or a written reason | satisfied once the entry lands |

**Order of operations, which is load-bearing** (the file records reversing it stranding two modules):
ship the page first, then flip `built: true` in the same or a later commit. Adding the catalogue entry
with `built: false` beforehand is safe and renders nothing.

Suggested entry, for the build plan and **not applied here**:
`{ href: "/practice/knowledge-studio", label: "Knowledge Studio", icon: "◈", capability: "template.manage", group: "Clinical", phase: N, built: false, parent: "/practice/documents" }`

⚠ Check `slug:` in `src/lib/marketing/practice-content.ts` before claiming the route —
`/practice/[area]` prerenders public marketing pages at build time and **shadows the shell in
production only**, which has already burned `/practice/team` and `/practice/setup`. `knowledge-studio`
is not in the taken list I read, but it must be re-checked at build time, and harness assertion 7a
enforces it.

---

## 6. Capability codes — probed live

**47 distinct codes in `practice_role_capabilities`.** Probed, not counted from migrations. The number
the brief carried was right, and the brief was right to tell me not to trust it.

Relevant to this programme, all confirmed present:

`template.manage` · `document.author` · `document.sign` · `document.view` · `pathway.design` ·
`pathway.view` · `pathway.assign` · `parameter.configure` · `pack.install` · `practice.settings.manage` ·
`report.view` · `search.use` · `task.manage` · `data.export` · `access.review`

**There is no `knowledge.*` code and no `asset.*` code.**

⚠ **Recommendation: mint nothing in Phase 1.** `template.manage` is already documented in mig 210 as
*"the 'this is how this practice does things' permission: the same people who write the note templates
keep the protocols"* — which is precisely the Knowledge Studio author. Six invented codes have shipped
in this product; `publish-constants.ts:33` records why every capability array is now exported and
asserted against the live catalogue. If Phase 4 or 5 genuinely needs `knowledge.publish` (a separate
approver from the author), mint it **in a migration, with a harness assertion**, and export it as a
named array so the literal-scanner can see it.

---

## 7. Is any of this reachable or useful without a delivery channel?

**Yes — most of it. This programme is unusually well-suited to being built before the DNS work lands.**

Knowledge Studio is an **internal authoring and governance tool**. An author writes, a colleague reviews,
an approver approves, a practitioner opens it during a consultation, and a printer prints it. **Not one
of those steps sends a message.** Phases 1–5 are fully reachable and fully useful today.

Three things are blocked, and only three:

1. **Patient Education distribution (Phase 6)** — leaflets are the one asset class whose point is reaching
   somebody outside the practice. Printing and QR codes work now; emailing does not.
2. **Review-request notifications** — an approver learns of a pending request by opening the screen. That
   is a degraded experience, not a blocker; `practice_approval_request` already stores urgency and
   assignee, and a task appears in the existing worklists.
3. **Scheduled/automated publication** — `practice_scheduled_report` already demonstrates the pattern and
   the honesty: `listSchedules()` stamps every row `fires: false, note: "Defined, not automated."`

⚠ **Correcting an assumption worth correcting before Monday: configuring a provider will not, by itself,
make this product able to send anything except an OTP.** §1.12 has the detail. `dispatch()` is reachable
only from `/api/notifications/test`; `sendMessage()` is called only by `issueOtp()`; SMS in stack A is a
hardcoded `skipped`; and `practice_message_channel.enabled` defaults to false per workspace. **The DNS
and provider work is necessary and not sufficient** — there is a genuine piece of wiring left, on top of
the credentials, before a leaflet or a review request could be emailed. It is not large, but it is not
zero, and it belongs in the Phase 6 estimate rather than being assumed away.

⚠ One further trap recorded in the code: `dispatch.ts` reads `NOTIFY_FROM_EMAIL`/`TWILIO_FROM_NUMBER`
while `messaging.ts` reads `RESEND_FROM`/`TWILIO_FROM`, from the same API keys, so a deployment that sets
one pair gets half its delivery working silently. Set both names.

---

## 8. ⚠ What a half-built Knowledge Studio would be worse than not starting

**The line is exactly this: a designer may only author what the runtime can already execute, and what
the database will already accept.**

There are four places where crossing it produces a screen that looks finished and a product that is
broken, and three of them are `CHECK` constraints nobody would notice until runtime:

1. **`practice_clinical_document.doc_type`** admits a fixed list
   (`consultation_summary, referral_letter, sick_note, procedure_note, …`). A Studio offering "new asset
   type" produces rows the **database rejects**. No front-end work fixes it.
2. **`practice_note_template.kind`** admits seven values. Same failure.
3. **`practice_ai_session.task`** admits six. Long §9's "convert narrative into an algorithm" is a
   seventh task and **needs a migration** before it can be logged at all.
4. **The algorithm engine is where this bites hardest.** An escalation algorithm with decision nodes,
   score thresholds and escalation targets that is **drawn but never executed** is the worst artifact
   this programme could produce. A practitioner who builds a PEWS escalation tree in a tool that calls
   itself a clinical algorithm designer will reasonably believe the system is now watching for those
   thresholds. It is not. It drew a picture. **A decorative algorithm is more dangerous than no
   algorithm**, because it transfers a duty the software never accepted — the same reasoning
   `publish-constants.ts` uses for "an unwarned screen reads as a cleared one" and mig 238 uses for
   allergies.

**Two safe rules, both already this codebase's house style:**

- Author only into vocabularies that exist; expand a `CHECK` by migration **before** the UI offers the
  value, never after.
- Where an asset is authored but not executed, **say so on the asset**, in the `not_checked` idiom
  `publish-constants.ts` already established: never a green tick, never silence. A flowchart labelled
  "Reference diagram — not monitored by this system" is honest and useful. The same flowchart unlabelled
  is a liability.

The second-worst outcome is cheaper and likelier: **twelve engines each 30% built**. The phasing in §3
is ordered to make that hard — each phase is a complete loop (author → review → approve → use) for one
asset class, rather than a layer across all of them.

---

## 9. Decisions needed from the user before any code

1. ⚠ **The Visual Designer: build, buy or refuse.** §4 recommends refuse-plus-substitute. This is the
   single largest cost line in the programme and it should not be started on an assumption. **If the
   answer is "build", it changes the whole shape of the plan** and should get its own specification.
2. ⚠ **The name collision.** `/super-admin/ckp/studio` and `loadKnowledgeStudio()` in
   `src/lib/super-admin/ckp-studio.ts` are already called Knowledge Studio. One of the two must be
   renamed. The super-admin one is a read-only KPI page whose "builders" are links out to eight other
   screens — a much weaker claim to the name. (It also already lists a "Decision Tree Builder" marked
   `soon: true`, which is the same promise this programme would be making on the practice side.)

2b. ⚠ **Rebuild on the practice spine, or re-tenant the platform stores?** §1.13. `policies` and
   `knowledge_objects` already do much of Phase 1's job for `hospital_id`. Phase 1 as written builds a
   third store for `practice_workspace_id`. The alternative — adding practice tenancy to those tables —
   is a large migration across the competency estate with real RLS risk. **Recommend rebuilding**, but
   the user should agree to the duplication knowingly, given three copies of the Competency Studio
   already exist for want of that decision being made once.
3. **Drug dosing tools (long §7).** `clinical-calculators.ts` refuses these on the record, for the same
   reason MED-001's drug database is unresolved. Either the refusal stands and the spec line is dropped,
   or a drug database is a prerequisite. It cannot be quietly built.
4. **Does an authored algorithm execute, or is it a reference diagram?** See §8. This decides whether
   Phase 4 is medium or large, and it must be answered *before* the designer is built, not after.
5. **Who approves?** `practice_approval_request` supports one assignee and one decision. Long §3 names
   Owner/Reviewer/Approver/Editor/Viewer — five roles and a possible multi-step chain. If single-approver
   is acceptable, Phase 1 needs no approval migration at all. If not, it does.
6. **Platform-tier knowledge assets?** `practice_note_template` and `practice_parameter_definition` both
   use `workspace_id IS NULL` for platform-shared rows. Should Competen ship a starter library of
   guidelines and checklists to every practice? That is a content and liability question, not a technical
   one — and mig 195 already chose "deliberately FEW" for note templates, with its reasoning written down.
7. **Patient education before delivery exists?** Phase 6 can be built and left print-and-QR-only. Worth
   confirming that is wanted rather than waiting.

---

## 10. Corrections to the brief, for the record

| brief said | live probe found |
|---|---|
| `practice_registration_template_field` | **`practice_registration_field`** |
| `practice_document_template` exists | **does not exist**; templates are `practice_note_template` |
| `configuration_registry_objects` has 32 `object_type` values | 32 **allowed** by CHECK; **8 in use** across 80 rows; 12 authorable |
| two near-identical copies of the spec | **not near-identical** — 449 lines vs 33; the bigger file has the smaller body |
| 47 capability codes | **confirmed, 47** |
| `practice_pathway_*` is five tables | **confirmed, five**, one migration, never altered |
| "no provider is configured" | true, **and understated** — even with credentials, only an OTP can leave (§1.12) |
| `practice_parameter_definition.formula` implies computation | **display string only**; computation is a hardcoded map |

---

## 11. Things this survey deliberately did not settle

- **Whether `/practice/knowledge-studio` is free as a public marketing slug.** I read the taken list in
  `navigation.ts` and it is not there, but `src/lib/marketing/practice-content.ts` must be re-checked at
  build time — production-only shadowing has burned this twice.
- **The competency-side schema drift found in passing**: `framework_versions` and `content_approvals` are
  read and written across the app but have **no `CREATE TABLE` in any migration** — only an
  `enable row level security` line in mig 252. Out of scope here, and someone should look at it.
- **Semantic search is dormant**: `embeddingConfigured()` needs `VOYAGE_API_KEY`, `OPENAI_API_KEY` or
  `GEMINI_API_KEY`; none is set, so vector search returns nothing while FTS still works. Relevant if
  long §8's Asset Library is expected to search by meaning rather than by tag.
