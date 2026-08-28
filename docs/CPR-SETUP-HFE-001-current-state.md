# CPR-SETUP-HFE-001 — Current-State Map (§20, produced before moving anything)

Surveyed 2026-08-28. §20's mandate: inventory every current Practice Setup route, component and
dependency, and map each existing control to its new destination BEFORE moving or removing UI.

**A note on the incorporated spec:** §9 declares CPR-BOOK-HFE-002 incorporated and binding. That
document does not exist in the owner's spec folder (searched all of Downloads). Its architecture is
summarised inside this spec's own §9 table (the six Patient Booking tabs) and §18/§22; those sections
are treated as the binding prescription. If the full CPR-BOOK-HFE-002 arrives later, it queues as its
own arc — it never displaces this one mid-flight.

## Inventory: where every setup control lives today

| Today's surface | Route | New §2 destination |
|---|---|---|
| Setup hub (CPR-V5-008, 3 domains / 23 modules) | `/practice/setup` | **Setup Home** (rebuilt) |
| Practice profile, letterhead, hospital identifiers, appointment types | `/practice/settings?tab=practice#…` anchors | Practice Profile · Visit Types & Modes |
| Locations & clinics editor | `/practice/settings?tab=practice#locations` | Locations & Clinics |
| The 3-layer console: Regular Practice / Changes & Exceptions / Patient Booking | `/practice/setup/availability-booking?layer=1..3` | Availability & Changes (layers 1–2) · Patient Booking (layer 3) |
| Old single-row rule editor | `/practice/setup/availability?step=4` | Patient Booking → Advanced |
| Booking address, discovery, publish-as-mode, QR/share | `/practice/setup/identity` | Patient Booking → Overview/Booking page |
| Registration form config | `/practice/settings/registration-form` | Registration & Intake |
| Team & delegation | `/practice/people` | Team & Permissions |
| Security | `/practice/privacy/security` | Security |
| Audit/activity + export | `/practice/privacy` | Activity Log · Import & Export |
| Personal settings | `/practice/settings` (personal tab) | Personal Settings |
| Clinical spine: parameters, investigations, treatments, procedures, taxonomy | `/practice/setup/…` | Clinical catalogues (kept reachable, grouped) |
| Document design | `/practice/settings/document-design` | Practice group |
| Lifecycle | `/practice/setup/lifecycle` | Practice Control |
| AI assistant, analytics, billing cards on the old hub | owning workspaces | REMOVED from Setup Home (§20: they live in their workspaces, main nav reaches them) |

## What is pinned, and by what

- `practiceSetup()` (src/lib/practice/setup.ts) is pinned by `practice-setup` +
  `practice-setup-domains` (domains partition the modules BY NAME; progress is counts-and-denominators
  and MOVES; dependencies are evaluated, not printed). **The service is not restructured** — the new
  Setup Home regroups its modules at the presentation layer, which is exactly §20's
  "refactor navigation and presentation before inventing new persistence."
- The practice-wide sidebar (eleven items, five sections) is CPR-HFE-001-frozen and untouched: this
  spec's §3 sidebar is Setup-internal navigation, not the app shell.
- `practice-refusal-harness` 8a/8d/10a pin internal-language boundaries on the availability-booking
  screens; new/edited setup surfaces are written to the same standard (§17 here restates it).

## Stale claims found by this inventory (the CPR-HFE-REF-001 class)

1. The hub header renders "No booking page to preview" and a comment insists "THERE IS STILL NO
   BOOKING PAGE" — false since the publish flow shipped and pages go live. Replaced by the real
   view-as-patient / finish-publishing / claim-address action, fed by `bookingLinkSummary`.
2. `setup.ts` marks `self_booking` and `team` as spec-unbuilt; both exist (publish flow live today;
   `/practice/people` is a working console). The service stays as-is for now (harness-pinned
   partition); the new Setup Home's Patient Access cards read REAL state (`publishReadiness`,
   `bookingLinkSummary`, `messagingStatus`) rather than the stale module flags. Correcting the
   service's flags is queued with its harness update as its own change.
3. The hub's "Already built" spec-disagreement panel exposes spec numbering to practitioners — §17's
   "developer acceptance evidence" class. Removed from the UI (the disagreement data stays available
   to engineering in the payload).

## Increments — ALL BUILT 2026-08-28

1. **Setup Home (§2/§3/§4/§16/§17)** — BUILT. `/practice/setup` is the grouped control centre:
   recommended next action, purpose-specific readiness (operational / public booking / communications
   as warning-only), grouped destination cards with live state. `practiceSetup()` untouched.
2. **Patient Booking destination (§9)** — BUILT. `/practice/setup/patient-booking`, six tabs:
   Overview (link card + standing + next action), Booking page (summary + one-source-of-truth link to
   the identity console), Clinics & availability (`RuleWorkspace view="clinics"` — routine setup with
   no Rules Centre — plus the recall/walk-in board), Patient information (what each active rule asks,
   with the two source-of-truth links), Review & publish (PublishWorkspace), Advanced
   (`RuleWorkspace view="advanced"` — the Rules Centre, chooser and explainability). The
   CPR-GROWTH "practice configured" milestone moved here with the readiness evaluation.
3. **Availability & Changes (§8)** — BUILT. `/practice/setup/availability-changes`: Regular week
   (sessions, locations-as-records, week summary, next available) and Changes & exceptions
   (exceptions workspace + impact honesty). "Session" reads as "clinic" in the §18 places.
4. **SET-HFE-10** — the old `?layer=1..3` route is a redirect shim (each layer to the surface that
   owns it), pinned by a vitest test asserting the redirect digests. LayerNav deleted. Refusal
   harness 8a/8d extended over the three new/rebuilt pages (59 checks green).

## CPR-BOOK-HFE-002 reconciliation — 2026-08-28, after the full spec arrived

The referenced spec turned out to prescribe more than §9's summary. Aligned same day:

- **§4 Overview**: the standing card became the prescribed setup summary (✓ page live / ✓ N clinics
  accepting online bookings / conflicts / steps-to-publish / ⚠ no sending channel), with the coverage
  figure computed by the same `clinicRuleChain` the panels project.
- **§5 Booking page tab** now mounts the REAL editor: `PublishWorkspace view="page"` (the settings
  always open — mode, brand name, OTP/guest/consent, unverified requests, visible locations/types,
  intro text, nothing-free contacts) with a slim address header. One source of truth kept — it is the
  same component, not a copy.
- **§10 Review & publish**: `PublishWorkspace view="publish"` — blockers first, then warnings, each
  with a **Fix →** link straight to its correction (`FIX_HREF` by check code); the raw checks
  (including the database-authority badge) collapsed under "Technical checks".
- **§6/§13 clinic cards**: each clinic now carries **Online booking ON / OFF / Needs setup** read from
  the governing rule's own visibility, its **next available time** (computed from the same
  `bookingPreview` the diary reads — entries now carry `templateId`), and guide language: an
  uncovered clinic says what to choose and offers **Set up booking for this clinic →**; an
  internal-only one offers **Let patients book this clinic →** (the composer opens prefilled with
  visibility public — reviewed and saved by the practitioner, never auto-activated).
- **§11 moves**: RecallWorkspace unmounted from setup (waiting walk-ins → Current Session; unbooked
  follow-ups → Follow-ups, which already renders the recall queue); a pointer line preserves
  findability. The component FILE stays because `practice-v5007-phase56-harness` pins its source —
  retiring file+harness together is a queued follow-up.
- Stale engine sentence fixed: the fortnight preview's note said "self-booking is not built" — false
  since the publish flow shipped.

**§14 wizard — BUILT** (same day): a five-stage stepper over the Patient Booking tabs, computed by
`computeSetupWizard` (patient-booking/wizard.ts) from the SAME readiness checks that refuse a real
publish — never a second copy of the arithmetic. Resume = the first incomplete stage carries
Continue; unreadable evidence counts as incomplete with the reason said; the strip disappears
forever at first publication (published / published_with_warnings / paused). No new persistence —
rule drafts and unpublished page settings already ARE the saved progress. Pinned by 9 vitest tests
(SetupWizard.test.tsx), including the never-outlives-publication and resume-order rules.

**NOT yet built from BOOK-HFE-002** (queued):
1. §16/§17 structured public-page failure reasons (per-cause patient sentence + practitioner action,
   instead of one generic refusal).
2. §20 human acceptance: the single task "make Wednesday morning at Nsambya bookable", run untrained.

Remaining (owner-side): the §22 setup acceptance tasks + BOOK-HFE-002 §20's task, run untrained.
