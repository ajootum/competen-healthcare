# CPR-RULES-HFE-001 — Current-State Map (§18, produced before coding)

Surveyed 2026-08-28. This is what exists, what maps cleanly onto the prescribed HFE model, and where
the seams are. Conclusion first: **the spec's architecture line holds — everything prescribed is an
authoring/presentation layer over the existing engine. No schema change is required for increment 1,
and none is anticipated for increment 2.**

## The engine (untouched by this redesign)

`src/lib/practice/booking-rules.ts` (~2,300 lines):
- **Precedence**: five-dimension scope (location, session template, appointment type, channel,
  effective dates) + explicit priority; `specificityOf/Rung/Reasons`, most-specific-wins,
  equal-specificity conflicts BLOCK activation rather than being guessed (s11). Deterministic,
  server-authoritative, versioned with reason-for-change. Proven: `practice-booking-rules` 133/133,
  `practice-booking-ready` 21/21 (CI), plus the patient-side suites.
- **Statuses**: draft/active/paused/archived via `RULE_STATUS_CODES`; unique partial index
  `ux_practice_booking_rule_scope` over all five scope columns + priority (migrations 230→245).
- **Effective dates**: `effective_from/to` on the rule — this IS the "temporary exception" the spec
  prescribes; higher precedence per the existing engine contract. No new concept needed.
- **`bookingRulesWorkspace`** already returns rules + locations + active session templates +
  appointment usage — the whole payload the new landing requires. `resolveBookingRule` is the
  composed-projection primitive the clinic view needs.

## The taxonomy already exists

`BUILDER_SECTIONS` (booking-rule-constants.ts): identity, scope, window, capacity, eligibility,
follow_ups, walk_ins, confirmation, cancellations, required_information, notifications (not built),
overrides. Mapping onto the spec's §3 categories:

| Spec category | Existing section(s) | Notes |
|---|---|---|
| Practice Defaults | a rule with NO scope dimensions set | already expressible; presentation only |
| Clinics & Sessions | scope.sessionTemplateId + composed view | structural config lives in Availability (correct §7 boundary) |
| Booking & Access | window + confirmation + visibility/channel | |
| Capacity | capacity | |
| Patient Eligibility | eligibility | |
| Walk-ins | walk_ins | |
| Cancellations & Changes | cancellations | |
| Booking Information | required_information (`BOOKING_INTAKE_FIELDS` + `REQUIREMENT_LEVELS`) | the matrix's data model already exists as {field: level} |
| Communications | confirmation now; notifications when built | §10: absent controls are omitted |
| Exceptions | effective_from/to on any category | |
| Advanced | the full current form incl. priority | priority hidden elsewhere (§8) |

## Constraints this build must not violate

- **The practice sidebar is FROZEN** (CPR-HFE-001, eleven items five sections; the harness IS the
  freeze). The comp's "Rules" nav entry is NOT added; everything mounts at the existing
  `/practice/setup/availability-booking?layer=3` route.
- **Engine messages are pinned by harnesses** — presentation may prefix/compose but the engine's own
  sentences stay.
- Colour language stays: existing tokens, `RULE_STATUS_CHIP`, band colours (owner: "maintain color
  coding already done").
- `blankDraft` round-trips every field (§15 no-data-loss): the category composer edits a SUBSET of the
  draft but always submits the full draft object, so hidden values survive untouched.

## Increment 1 (this pass)

Landing: summary counts (active/drafts/exceptions/conflicts — computed from the rules payload), search,
category chips (derived from which fields a rule sets), compact badge cards replacing prose. Create-rule:
"What do you want to control?" tile chooser gating the composer to that category's sections (+ identity,
scope, review); priority visible only under Advanced. Booking-information: compact three-state matrix
(radio columns; segmented control below md). Language: §10 pass over this screen — no migration numbers,
schema names or build history in practitioner-facing copy; a source-scan pin enforces it (HFE-11).

## Increment 2 (documented, not yet built)

Clinic-first composed view (§6): per-session panel rendering `resolveBookingRule`'s effective values
with per-field source (inherited vs overridden), Override → prefilled session-scoped rule, Restore →
deactivate the override. Plain-language pre-activation preview (§11.5). Both are projections over
existing calls; no persistence change. Human acceptance (§17) runs after increment 2.

## The §18 stop-clause check

Nothing prescribed requires a new persistence model. The one semantic seam: the spec's "category" is
not a stored attribute — it is DERIVED from which behaviour fields a rule sets. A rule spanning many
categories renders under each relevant chip and under All; that is presentation, and it is the honest
rendering of what the row actually is.

## Defects the inspection itself surfaced (both fixed with increment 1)

1. **Cancellation-notice silent reset (the spec's §15 data-loss class, live in the old screen).**
   `BookingRuleCard` never carried `cancellationNoticeMinutes` — it existed only inside the composed
   `cancellationLine` — so `draftFrom` left the editor at 0 and the first save of ANY edit wrote 0 over
   a real notice period. Fixed by putting the field on the card (engine) and reading it in `draftFrom`;
   the engine harness (133) and patient-manage suite stayed green, confirming the store and save path
   were always right — only the editor's round-trip lost it.
2. **Stale scenario-preview refusal** on the layer-3 page: "needs the patient-facing intake, which is
   not built yet" — false since the intake screens shipped. The CPR-HFE-REF-001 class (a refusal that
   understates the product). Rewritten to name the true absence: a guided walkthrough SIMULATOR.

## Increment 1 — BUILT 2026-08-28

Landing (title "Rules", subtitle, + Create rule, search, the eight §4 filter chips, summary counts,
target-grouped compact badge cards with "Everything this rule says" / "Why does this rule apply?"
drawers), the §5 chooser (nine tiles → section-scoped composer), §11 step order with a plain-language
review computed from the same `plain*` functions the cards use, §9 matrix (radio grid ≥ md, segmented
control below), §8 priority hidden except Advanced/non-zero, §10 language pass (constants' rendered
fields rewritten; provenance fields kept unrendered), ordinary creates land as drafts (§11.6).

Enforcement added: refusal-harness 8d/8e (HFE-11 — source scan of the two screens + import-level scan
of every rendered vocabulary field; both break-tested red), and `RuleWorkspace.test.tsx` (CI, 10
tests) rendering the real component against fixtures typed `BookingRuleCard`, pinning the landing,
the render-time HFE-11 boundary, and priority staying off the card face.
