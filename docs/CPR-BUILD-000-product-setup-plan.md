# CPR-BUILD-000 — Setting up the Competen Practice product

**Status: PLAN.** Nothing in this document is built. The public marketing section at `/practice` is complete
and harness-verified; the product it describes does not exist. This plan is derived from CPR-ARCH-001 v2
(especially §4 users, §5 domains, §13 platform/engine separation, §15 conceptual data model, §19 ADRs,
§20 development sequence, §21 acceptance criteria), the 15 PEN engine specs, the 20 CPR-V2 workspace
specs, and CPR-000A — read, not recalled.

## What "set up" actually means

Competen Practice is not another lens over existing hospital data, which is what most workspaces built so
far have been. It is a **second product with its own tenant type**: the practitioner-owned practice. That
is the single deepest fact in the architecture (CPR-ARCH-001 §3, §8, §10) and it drives everything below —
the record belongs to the practitioner and follows them across employers; hospitals are *contexts* an
encounter is tagged with, never the owner of the practice record.

## Phase 0 gate — six decisions that precede any code

1. **Tenancy: `practice_id` is a new tenant boundary, parallel to `hospital_id`.**
   Every Practice table carries `practice_id`; encounters additionally carry a `PracticeContext`
   (organisation / facility / department / service / local identifier) for multi-site work (§10, ADR-06).
   Consequence, stated up front: the entire tenant-scoping doctrine built this session —
   subject-vs-caller writes, mandatory search-function tenant args, no blanket reads, the four drift
   audits — must be **instantiated for `practice_id` from day one**, not retrofitted. The harnesses
   currently key on `hospital_id` only; extending them is part of Phase 0, not an afterthought.

2. **Roles: practice membership, not global roles.**
   The app's `AppRole` is `super_admin | hospital_admin | educator | assessor | nurse`. Practice needs
   practitioner, personal assistant/receptionist (delegated, cannot alter protected clinical content),
   practice administrator, patient, external collaborator (§4). These belong in a **`prc_members`
   practice-scoped membership table** (precedent: OGS appointments, org roles) rather than inflating
   `AppRole` — because CPR-015 multi-practice switching means one person holds *different roles in
   different practices*, which a global role cannot express. Patient access is identity + relationship,
   not a staff role.

3. **Naming: the `prc_` prefix, mandatorily.**
   `practices` is already taken — migration 011 created it for CKCM (clinical practices inside competency
   frameworks). A name collision at the tenant table would be catastrophic to unwind. All product tables
   are `prc_*`.

4. **Route namespace.** `/practice` is the PUBLIC marketing section and must stay. The product workspace
   needs its own root — proposal: **`/my-practice`** (matches the practitioner-owned framing; "Your
   practice. Wherever you practise."). The LP journeys (`/practice/start`, `/practice/login`) currently
   have **no forms, deliberately**, because there was nothing to sign into; they become real in Phase 0/1,
   at which point the disclosure-harness assertion 7e (no password field) is revisited — an assertion that
   exists to keep the site honest, being retired because the claim became true.

5. **Non-EMR guardrail in the schema itself (ADR-01).** No medication-administration records, no lab
   ordering, no billing tables. The model stops at `TreatmentAction` (what was decided/done in the
   encounter) and `ResponseOutcome`. This is the constraint that keeps the product what it is.

6. **Patient-facing surfaces are phase-gated.** V2 specifies no patient workspace (recorded in
   `V2_SPEC_GAPS`), but the architecture names the Patient as a primary user (books, questionnaires,
   views shared information). Build practitioner-side first — acceptance criterion §21: *the core product
   is fully usable by one practitioner without a receptionist* — and take patient booking as its own
   later phase against the LP-BOOK/LP-PAT specs.

## What is reused vs greenfield

CPR-ARCH-001 §13.1 lists the shared platform services, and this platform already has most of them:

| Platform service (§13.1) | Exists here | Reuse |
|---|---|---|
| Identity & authentication | Supabase auth + profiles | as-is |
| Tenant & workspace membership | hospital model | **pattern only** — new `prc_` tenancy |
| RBAC/ABAC | roles + RLS doctrine | pattern + harnesses, extended to `practice_id` |
| Audit & compliance logging | audit patterns per workspace | as-is |
| Workflow orchestration | notification framework, WCE | compose (PEN-007) |
| Notifications & communication | mig 161 framework | compose (PEN-010) |
| Enterprise search | search_ckcm / match_assets patterns | pattern; any Practice search fn takes **mandatory `p_practice`** (mig 186 lesson) |
| Document & object storage | documents modules | compose (PEN-011) |
| AI platform & governance | AI gateway + copilot pattern + plat_ai_requests | compose (PEN-013); ADR-09 source-linked |
| Analytics | charts/PUI-007 | as-is |
| Config & no-code | WCE + CPR-019 R2 split | compose (platform-managed vs practice-managed) |
| Design system | PUI tokens/components; Practice indigo #2563EB accent | as-is |

Greenfield: the `prc_` domain model, the PEN engine logic, all 20 workspaces.

## Build phases (dependency order per §20, grouped by the eight public areas)

- **Phase 0 — Foundation.** Migrations for the tenant spine: `prc_practices`, `prc_members`,
  `prc_contexts`, `prc_patients`, `prc_patient_relationships`, `prc_patient_aliases` (§15 entities).
  RLS practice-scoped from the first migration, written under the current doctrine (no blanket reads;
  writes scope to the subject's practice; policies declared in migrations only). Workspace shell at
  `/my-practice` with GlobalHeader + kit. `/practice/start` wired to create a real practice. Harnesses
  extended to know `practice_id`.
- **Phase 1 — Your diary.** PEN-001 scheduling engine; CPR-002 schedule/availability, CPR-003
  appointments/booking; CPR-001 command centre skeleton over real appointments.
- **Phase 2 — Patient identity.** PEN-002; CPR-004 rapid registration (six modes), CPR-005 search &
  clinical summary. Duplicate prevention, aliases, consent fields; **no automatic cross-organisation
  matching** (§10).
- **Phase 3 — The encounter.** PEN-003 encounter lifecycle + PEN-006 rapid capture; CPR-006..009
  (encounter, diagnosis/problems, investigations, treatment/procedures/prescription-as-record). All four
  entry pathways end to end (§7: booked, new walk-in, walk-in follow-up, scheduled follow-up). ADR-07
  minimal capture with progressive completion.
- **Phase 4 — Continuity.** PEN-004 follow-up intelligence + PEN-012 timeline; CPR-010 follow-ups.
  `FollowUpObligation` due/overdue/missed/closed loop. **Phases 0–4 are the acceptance-criteria core.**
- **Phase 5 — Case memory & copilot.** PEN-005/008/013; CPR-011 intelligence, CPR-013 AI copilot.
  ADR-05: every encounter contributes a `PracticeIntelligenceFact` with source, method, confidence.
- **Phase 6 — Evidence.** PEN-009/014; CPR-012 reports/exports/portfolio; hospital payment lists with
  facility-specific identifiers (§21).
- **Phase 7 — Team & network.** PEN-007/010; CPR-016 delegation (protected-content boundary), CPR-017
  collaboration/referrals.
- **Phase 8 — Setup & switching.** CPR-014 settings under the CPR-019 R2 platform-/practice-managed
  split; CPR-015 multi-practice switching with context banners (§10).
- **Phase 9 — Care anywhere.** CPR-018 teleconsultation, CPR-019 mobile/offline. Infra-heavy
  (WebRTC, sync/conflict model); honestly last, as the platform has deferred this class before (CDP-012).
- **Patient phase (unnumbered, gated).** Booking + patient login against LP-BOOK/LP-PAT, once the
  practitioner core is real.

Per phase, the working discipline stays what it has been: migrations applied by hand (plain ASCII,
idempotent, no do-blocks), a harness per phase proven able to fail, cross-workspace sweep extended, and
the public site's `AVAILABILITY`/journey copy updated only when the thing it describes is true.

## Order of magnitude

This is the largest single build proposed on this platform — 20 workspaces, 15 engines, a new tenant
model. For scale: HWW (14 modules, existing tenancy) took several sessions. Phases 0–4 are the smallest
honest "product exists" milestone: one practitioner can run a diary, register patients, record encounters
and close follow-ups, with everything after that additive.
