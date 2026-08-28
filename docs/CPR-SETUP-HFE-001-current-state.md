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

## Increment plan

1. **Setup Home (§2/§3/§4/§16/§17)** — rebuild `/practice/setup` as the grouped control centre:
   recommended next action, purpose-specific readiness (operational / public booking / communications
   as warning-only), grouped destination cards each carrying live state and linking to the existing
   surface that owns the control. No routes move; no redirects needed yet.
2. **Patient Booking destination (§9)** — `/practice/setup/patient-booking`, six tabs mounting the
   existing consoles (Overview, Booking page, Clinics & availability, Patient information,
   Review & publish, Advanced = Rules Centre). `?layer=3` redirects here.
3. **Availability & Changes (§8)** — `/practice/setup/availability-changes` with Regular week /
   Changes & exceptions tabs (Sessions + Exceptions workspaces); `?layer=1|2` redirect; recall/walk-in
   operational widgets move to their owning Follow-ups workspace per §20.
4. Language purge (§17/§18) across the moved surfaces + acceptance harness updates + SET-HFE-10
   redirect checks.
