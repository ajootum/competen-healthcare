# CPR-DOC-AUTO-001 — implementation tracker

§19 of the specification requires that "at minimum the priority document set has defined input
contracts/templates, **with phased implementation explicitly tracked**". This file is that tracking.
It is the answer to "which of the eight is built, and what is the honest state of the rest".

Last updated 2026-08-24, after Phase 3.

## The priority set (§5)

| # | Document | Mode (§3) | State | Generator | Type |
|---|---|---|---|---|---|
| 1 | Referral letter | B, decision + generation | **Built** (Phase 1) | `generateReferralLetter` | `referral_letter` |
| 2 | Visit summary | A, one-click / review | **Built** (Phase 2) | `generateVisitSummary` | `consultation_summary` |
| 3 | Patient instructions | B, decision + generation | **Built** (Phase 2) | `generatePatientInstructions` | `patient_instructions` |
| 4 | Clinical / medical summary | C, select + summarise | **Built** (Phase 3) | `generateClinicalSummary` | `clinical_summary` |
| 5 | Investigation request | B, decision + generation | **Built** (Phase 3) | `generateInvestigationRequest` | `investigation_request` |
| 6 | Follow-up instructions | A, one-click / review | **Built** (Phase 3) | `generateFollowUpInstructions` | `follow_up_instructions` |
| 7 | Medication list | A, one-click | **Built** (Phase 3) | `generateMedicationList` | `medication_list` |
| 8 | Sick leave / fitness certificate | D, decision + controlled template | **Not built — blocked, see below** | none | `sick_note` exists, nothing writes it |

Migrations: 352 + 353 (Phase 1), 354 (Phase 2), 355 (Phase 3).

## Priority 8 is blocked, not skipped

§14 is explicit, and it blocks this rather than merely cautioning:

- "Certificates remain practitioner decisions; AI must never decide fitness, incapacity or duration
  independently."
- "Statutory/jurisdiction-specific documents require **approved controlled templates** before
  automation."

No controlled template has been approved for any jurisdiction this product operates in, so there is
nothing to generate into. §3 assigns priority 8 to mode D — "controlled fields/template; AI may assist
phrasing but cannot change required structure" — and a mode-D document without its controlled template
is not a smaller version of the feature, it is the feature with its only safety mechanism removed.

**What is available meanwhile.** `sick_note` has been in the `doc_type` CHECK since migration 195, and
the blank-body authoring form still produces one by hand. §19 requires that fallback to remain; §14
requires the automation to wait. Both hold today.

**What would unblock it**, in order:

1. An approved controlled template per jurisdiction, owned by whoever is accountable for the legal
   content — not authored in code.
2. A decision on which fields are practitioner-only (§14: fitness, incapacity, duration — these must
   never be derived).
3. A template-versioning story, since §15 requires the stored artifact to carry its template version
   and a certificate's version has legal weight a letter's does not.

Until 1 and 2 exist, do not add a generator. `practice-document-automation-harness.ts` §15 asserts the
absence — 15a, 15b and 15c fail if a sick-note or fitness generator appears, or if the engine grows
any notion of fitness, incapacity or duration. Adding one should mean deleting a test with §14 written
on it, in front of whoever owns that decision.

## Also deliberately not built

- **Transfer summary** — appears in §13's input table and §3's "clinical correspondence" group but not
  in §5's numbered priority sequence. Its contract (destination/purpose and selected continuity data)
  is satisfiable by the clinical summary today; a distinct type should wait until somebody needs the
  distinction.
- **Results summary** — named in §3's examples for mode A. CP records investigations and their
  summaries, but "results" as a distinct authoritative artifact is not modelled, and inventing one
  would be the second clinical source of truth §19 forbids.
- **AI phrasing (§10)** — deferred by owner decision, Phase 1 ("deterministic first"). The engine's
  payload contract does not change when it arrives: composition already receives exactly the selected
  facts and practitioner input, so an AI layer replaces the composer's prose without widening what it
  is allowed to see. The grounding tests continue to apply unchanged and are the acceptance gate.

## §17 acceptance rows

| Test | Where |
|---|---|
| Grounded generation | harness 1d, 9f, 10d, 12l |
| No invention | 1e, 1f, 12d |
| Disclosure control | 2a-2c, 13a-13e |
| Referral | 1a-1c, 8a-8c |
| Visit summary | 9a-9g |
| Medication list | 12j-12l, 14a-14b |
| Regeneration | 5a-5b |
| Signing | migration 353's guard; 6h asserts the cascade allowance |
| Patient isolation | 3a-3f |
| Timeline | `createDocument` links patient + encounter; 352 links referral |
| Blank letter | 6d, 6e |
| Failure | referral written before the document; `PROVENANCE_NOT_RECORDED` refuses a silent success |

Two rows are **not** closed by the harness and should not be read as if they were. "Signing" is
asserted at the schema level but the signed-document UI path has not been exercised end to end, and
"Timeline" is asserted by construction (the FK is written) rather than by reading the rendered patient
timeline. Both need the signed-in pass that remains the owner's.
