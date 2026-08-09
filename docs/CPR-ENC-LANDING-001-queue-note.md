# CPR-ENC-LANDING-001 — queue note

**Status: QUEUED, behind the encounter patient-picker.** The specification itself is
`CPR-ENC-LANDING-001_Encounters_Landing_Page_Developer_Specification.docx` in `~/Downloads` — 11,996
characters, 195 lines, "Version 1.0 | 9 August 2026 | Implementation-ready". A genuine build document, not
an outline. This note records only what was measured against the comp on 2026-08-09, so it is not measured
twice.

## Why it is queued rather than started

The patient-picker agent holds `src/app/practice/(shell)/encounters/page.tsx` — the landing page itself.
⚠ And the picker is **not a separate feature**: s1 of this spec lists *"start a new encounter for an
existing or newly registered patient"* as a requirement, and the comp draws the dropdown chevron on
`+ Start encounter`. **The picker is this spec's first piece.** Two agents in one file produce a merge
neither of them tested.

## ⚠ ONE TILE IN THE COMP WOULD TELL A CLINICAL LIE

The comp draws **"0 — Unresolved safety alerts / Medication safety requires review."**

**There is no medication safety alert store in Practice.** The only `op_safety_alerts` table
(migration 038) is `hospital_id`-scoped — the competency estate, not this product. And the nine
medication safety checks were **deliberately declined rather than shipped empty**. The medication screen
already prints the reasoning:

> *"an empty rule table makes every check return nothing to say, which a clinician reads as safe … the
> absence of a warning on this screen carries no information about safety."*

⚠ So a tile reading **0 unresolved safety alerts** contradicts a warning this product prints two screens
away, and does it in the reassuring direction. **Omit it, or render it as a permanently `not_checked`
row** — the pattern `form-constants.ts` and the checklist work already established. See
[[cpr-honesty-rules]].

## Real, but differently named

**"Ready to sign"** is not a status. `practice_encounter.status` (migration 194:51) admits
`DRAFT, ACTIVE, PAUSED, COMPLETED, SIGNED, AMENDED` — **`COMPLETED` IS completed-but-unsigned**. The tab
is buildable today with no schema change.

Everything else in the comp maps onto stores that exist: the inherited session/location context banner,
the tabs, "still required", open duration, and the history table with SIGNED/AMENDED and date filters.

## The frozen decision to respect

The spec's own words: *"Do not reproduce the Current Session queue, appointment list, waiting-room
management, or session dashboard on this page."* Current Session runs the live clinic; Encounters is the
clinical-record workbench. The comp obeys this and the build must.

## ⚠ Design for the empty case, because that is what exists

The comp shows Sarah Nakato, Peter Okello and Mary Achieng, three signed encounters, and an attention
panel with counts. **Trial has 2 patients, 1 open encounter and 0 signed encounters.** The screen the user
will actually see is mostly empty states — the case comps never show and the one they will meet first.

See [[walkthrough-findings]] for how this task arose, and [[cpr-ui-design-freeze]] — the freeze was lifted
on 2026-08-08, so screen work from walkthrough findings is in scope.
