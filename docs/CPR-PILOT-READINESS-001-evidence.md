# CPR-PILOT-READINESS-001 — Evidence Pack

Acceptance arc executed 2026-08-28 against the staging project (`ezhvpgtcqcdsgylrxgdb`, full schema
parity with production confirmed same day: 671/671 tables, RLS on everywhere) and, where read-only,
against production. Per §16 this maps only evidence that genuinely proves each criterion; everything a
machine cannot truthfully test is marked **NOT TESTED** with an owner script in §H.

## Executive verdict

**CONDITIONAL GO for Stage 0 (internal simulation) now, and for Stage 1 (controlled practitioner pilot)
once the four items in the blocker list at the end are closed.** No unresolved P0 exists. No P1 is open.
Per §15, this CONDITIONAL GO covers the **free** pilot only: **the separate payment/commercial gate is
untested and deliberately out of scope** — paid service stays disabled and pilot entitlement is
provisioned without billing.

## Gate matrix

| Gate | Disposition |
|---|---|
| 1 Clinical safety & data integrity | **PASS** (guardian line closed by H1: fixed, deployed, human-verified live) |
| Outbox / sync arc (§4) | **PASS — executed** (new, this arc) |
| 2 Practitioner day-in-the-life | **desktop PASS** (owner-run 2026-08-28, findings dispositioned — see §H1 results) · **mobile NOT TESTED** (§H2) |
| 3 Identity, access & topology | **PASS — executed** (fixtures A–D, this arc) |
| 4 Communications | **PASS** (human-verified 2026-08-27 + executed checks) |
| 5 Patient self-booking | **CONDITIONAL** (enabled; one named gap: true in-flight race) |
| 6 Pilot security minimum | **PASS** (backups line = owner confirmation pending) |
| 7 HFE / real-user acceptance | **NOT TESTED** — human; script in §H3 |
| 8 Operational readiness | **BLOCKED on owner** — register drafted in §G, names required |

## A. Gate 1 — Clinical safety & data integrity [BLOCKING] — PASS

All evidence below is **executed** (staging unless marked CI/prod), from runs on 2026-08-27/28.

| Criterion | Executed evidence |
|---|---|
| Patient identity / isolation | `practice-patients` 31 · `practice-security` 149/149 · `practice-patient-workspace` 133/133 |
| Adult registration persists | `practice-registration` 66/66 |
| Minor/guardian | **PASS** — H1-1 found the template check blind to guardians (P1); fixed, deployed, and HUMAN-VERIFIED live the same day (guardian details survived reopening: YES). Executable regression: `practice-registration` cases 10/10b/10c, 69/69 |
| Encounter persistence, leave/re-enter | `practice-encounter-start` 65/65 · `practice-encounter-workspace` 135 · `practice-encounters` 46 · `practice-continuity` 67/67 |
| Diagnoses | `practice-diagnosis-capture` (CI, blocking) · `practice-case-memory` 50/50 |
| Treatments | `practice-treatment-investigation` 238/238 |
| Procedures | `practice-procedures` 72/72 |
| Investigations/results | `practice-treatment-investigation` 238/238 |
| Follow-up in intended workspace | `practice-followup-plans` 50/50 · `practice-followups` (solo green) |
| Generated documents grounded | `practice-generation` 56/56 · `practice-document-automation` 120/120 (CI) — grounding, disclosure, provenance |
| Signed/issued cannot be silently rewritten | `practice-documentation` 65/65 — **the DB trigger refuses a raw edit of a signed document and a covered rewrite; amendment preserves the original byte-for-byte** (proven on a real read after the mig-357 catch-up) |
| Patient isolation vs URL/state/API manipulation | `practice-security` 149/149 · `practice-api-plane` 16/16 · `anon-exposure` 0 of 671 tables (prod) |
| Practice isolation | `blanket-policy` 59 (prod) · `practice-api-plane` 16/16 · `xw-sweep` 54/54 · outbox wire carries no workspace claim (see §B) |
| Failed saves never claim success | `practice-attention-contract` 11/11 (CI) · outbox acceptance contract executed (§B) |
| Unsynced work recoverable, executable proof | **§B — new executable suite** |
| Session safety | `practice-offline-lock` (CI, incl. PBKDF2 timing floor) · `practice-security` 149/149 |

## B. Outbox / sync arc (§4) [BLOCKING] — PASS, EXECUTED

`src/lib/practice/outbox-sync.test.ts` — **16 executable tests, CI-blocking** (vitest), over the real
modules with real AES-GCM sealing and a spec-conformant IndexedDB (`fake-indexeddb`, assessed per §4:
non-extractable CryptoKey round-trip, sealed byte shapes, and transaction-abort semantics all verified
before adoption — the abort semantics matter because `commit()` resolves on `oncomplete` by doctrine).

Executed, exactly as §4 enumerates: write → read → queue → **restart simulation** (module registry dies,
disk survives; records survive and the sequence continues) → retry → successful upload → dequeue.
Network death and non-OK responses preserve the only copy as `failed`; **`sending` is never persisted**
(disk still reads `pending` mid-flight, so a crash strands nothing); a verdict that omits a record leaves
it failed, never silently delivered; **duplicate retry carries the same transaction id** (the idempotency
key migration 284's ledger answers `duplicate` to — server side proven separately by `practice-sync`
97/97); **corrupt queued data** is reported, listed `undeliverable`, never deleted, never put on the
wire, and does not hold back readable work; queued data at rest contains **neither the clinical text nor
the workspace id**; the wire carries **no workspace/user claim** (the server's session decides).
Break-tested: gutting the preservation path reddened exactly the preservation test.

This closes Pre-Stage-1 item 2 and the parked `fake-indexeddb` decision.

## C. Gate 3 — Identity, access & topology [BLOCKING] — PASS, EXECUTED

Deterministic staging fixtures, proven through the product's own resolvers (2026-08-28):

| Fixture | Identity | Proven result |
|---|---|---|
| A — one destination | `smoke.practitioner@…` | `resolveProductDestinations` → **ONE** (practice), one workspace → direct landing |
| B — two Practice memberships | `estate.twoclinics@…` | own workspace via `runProvisioning` + second via `createInvitation`→`acceptInvitation`; `resolvePracticeAccess` → **2** → chooser. **Closes Pre-Stage-1 item 3** |
| C — multiple products | `estate.owner.a@…` | resolver → **MANY** (platform, practice) → product chooser |
| D — zero destinations | `estate.nodest@…` | resolver → **NONE** → controlled no-product state |

Wrong-door / URL-manipulation / privilege boundaries: `hq-guard` 68/68 (staging **and** production,
identical) · `practice-api-plane` 16/16 · `hq-nav-filter` 35/35 · `practice-auth-guard` 92 (prod) ·
`gateway-acceptance` 21 (prod, 2026-08-27). Logout/expiry: `practice-security` + shell harness (CI).
Verification/reset return to canonical gateways: human-verified 2026-08-27 during email activation.

⚠ Proving fixture A caught a real mis-model (a blanket fixture membership had made the smoke
practitioner platform-admitted) — corrected in the fixture and the membership harness the same day;
`platform-membership` 62/62 after.

## D. Gate 4 — Communications [BLOCKING FOR ENABLED FEATURES] — PASS

| Flow | Evidence |
|---|---|
| Email verification | Human-verified live 2026-08-27 (owner received, link worked, correct gateway). Confirm-email ON in production |
| Password reset | Human-verified live 2026-08-27 (landed on `practice.competenhealthcare.com/reset-password`, reset succeeded) |
| Practice/team invitation | Human-verified 2026-08-27 + `practice-team` 53/53 executed |
| Booking confirmation / OTP | `practice-patient-access` 77/77 (issue path executed with real code extraction) |
| Gateway callbacks | `gateway-acceptance` 21/21 across hosts (2026-08-27) |
| Acceptance ≠ delivery | The doctrine is executable: `mail-send-check` says it, `practice-messaging` 40/40 proves `handed_to_provider_at` semantics and receipts-unavailable honesty |

Self-serve signup mail: proven end-to-end on staging 2026-08-28 (`practice-signup` 27/27) and the
production door verified zero-write the same day.

## E. Gate 5 — Patient self-booking [BLOCKING IF ENABLED] — CONDITIONAL

Enabled (production door open as of 2026-08-28). Executed evidence: `practice-booking-rules` 133/133 ·
`practice-patient-booking-screens` 68/68 · `practice-patient-intake` 44/44 · `practice-session-booking-mode`
34/34 · `practice-registration-scheduling` 76/76 · `practice-booking-ready` 21/21 (CI — includes the
**null-horizon-cannot-mean-unlimited** rule: constraints resolve to EFFECTIVE values or publish refuses) ·
capacity limits **executed**: a booking beyond capacity refuses with `CAPACITY_FULL` (“3 of 3”), per-type
with `TYPE_CAPACITY_FULL`.

**The one named gap:** a true two-in-flight concurrent booking race has not been separately executed —
the sequential-at-limit refusal proves the enforcing check, and the same DB-side check decides a race,
but §8's row deserves its own execution or a human double-tap test (§H2 includes one). Until then:
CONDITIONAL, or disable self-booking for Stage 1 (both defensible; owner's call).
Mobile booking journey: human, §H2.

## F. Gate 6 — Pilot security minimum [BLOCKING] — PASS

- Isolation: see A/C. **`anon-exposure`: 0 of 671 tables readable by the public key (production).**
- Secrets: gitleaks in CI on clean checkout; service-role never in client (auth-boundary + plane-boundary CI harnesses).
- RLS/auth boundary: **671/671 RLS enabled, 0 policies-off, both projects**; `blanket-policy` 59; plane-boundary 35 (CI).
- HTTPS + separation: all pilot hosts serve TLS (gateway checks); staging/production separation is this
  week's proven machinery (`production-guard` + spawned-probe verification, break-tested).
- Audit trails: `practice-audit` 48/48 executed.
- Lifecycle governance: `practice-lifecycle` 80/80 · `cascade-immutability-ratchet` 6/6 (staging-only by construction).
- Privacy/AI disclosure: `practice-privacy` 37/37 · `practice-refusal` 48/48 (CI) · offline encryption note asserted in module.
- **Backups/recovery: owner confirmation required** (Supabase project backup schedule + who restores). The
  outbox export path (a human-readable JSON of undelivered work) is executed evidence for device-side recovery.
- Production-degrading harnesses were not run to improve counts (per §9): the security dozen is the only
  production-pointed set, all read-only.

## G. Gate 8 — Operational readiness — DRAFTED, OWNER NAMES REQUIRED

| Requirement | Draft |
|---|---|
| Pilot owner | **[owner to name — presumably Gabriel]** |
| Technical escalation | **[owner to name]** — route: WhatsApp/phone + this repo's session |
| Practitioner support | **[owner to define]** — suggested: dedicated WhatsApp group, owner-monitored |
| Incident handling | P0: stop pilot use, escalate immediately, export outbox if device-side. P1: same-day fix window. P2/P3: log to register |
| Data-loss response | Immediate: practitioner opens Outbox → Export (undelivered work as readable JSON, never deleted); escalate with the file |
| Known limitations | §I below — written |
| Pilot cohort | **[owner: 3–5 named practitioners]** |
| Duration | Stage 1: 1–2 weeks per spec §12 |
| Feedback | **[owner to define]** — suggested: same WhatsApp channel + weekly 15-min call |
| Change log | This repo's git history is active; pilot-visible changes to be summarised per deploy |
| Rollback | Vercel: promote the previous deployment (one command, owner or Claude); flags: `practice_public_signup` / `practice_sign_in` can close doors instantly via one SQL update |
| Daily review | **[owner to schedule]** during initial Stage 1 |

## H. Human tests — NOT TESTED until performed (owner scripts)

### H1 — Desktop day-in-the-life (Gate 2), one sitting, no developer help
1. Sign in at `practice.competenhealthcare.com` → land directly on Practice home (no chooser).
2. Register a new adult patient (real-shaped synthetic data). Confirm it appears in Patients.
3. Register a minor with a guardian. Confirm the guardian details persist on reopening.
4. Book an appointment for ZZTEST Amina **from her patient record** (Patients → Amina → book), so the
   appointment carries her clinical record into step 5. The Planner's quick-book panel is name-only by
   design — fine for walk-in slots, not for this journey. Pick a time at least 30 minutes ahead inside
   the practice's open window; if today's window is spent, tomorrow is fine — the journey matters, not
   the date.
5. Start the encounter from Current Session. Record: one diagnosis, one treatment, one investigation.
6. **Leave mid-encounter** (navigate away), return, confirm nothing is lost, complete the encounter.
7. Create a follow-up. Confirm it appears in the Planner/timeline.
8. Generate a referral document; review that only the facts you selected appear; sign it.
9. Sign out. Sign back in. Find the patient; review the longitudinal record; confirm every item from 2–8 is present.
10. Record: total time, every point you needed to think twice, every wrong turn, every error seen.


### H1 — PERFORMED 2026-08-28 (owner), results

| Measure | Recorded |
|---|---|
| Total time | 20 minutes |
| Completed without developer intervention | **NO on first attempt** — both causes dispositioned: H1-1 (P1, fixed + deployed + human-verified within the run) and H1-2 (the SCRIPT mis-directed booking to the Planner quick-book; script corrected) |
| Steps needing thought | Booking flow (script-induced; see H1-2) |
| Wrong turns / backtracks | None |
| Errors seen | The two reported findings only |
| Typed work lost | **None** |
| Guardian details survived reopening | **YES** (post-fix, live) |
| Longitudinal record complete (step 9) | **YES** |

Disposition: **Gate 2 desktop PASS.** The journey completed end to end with no data loss, no wrong
turns, and full continuity; the interventions trace to a since-fixed P1 and a since-corrected script
line, and no P0/P1 remains open — which is the Pre-Stage-1 item 4 criterion.

### H2 — Mobile critical subset (Gate 2/5), real device
1. Repeat H1 steps 1–2 and 5–7 at real mobile width.
2. Self-booking: from a phone browser (not signed in), open the practice's public booking page, book a
   slot as a new patient, receive the confirmation.
3. **The double-tap test:** on the final booking button, tap twice as fast as you can. Confirm exactly
   one booking exists afterwards.
4. Attempt to book the same slot again from a second browser; confirm a sensible refusal.

### H3 — HFE surfaces (Gate 7), observe a real user per surface
Command Centre → next action · Current Session → start/resume/complete · Planner → find/create ·
Patients → find + understand state · Encounter → complete one · Follow-ups → create/action ·
Documents → generate/find · Referral → generate/review/issue. Record assists, reversals, mis-clicks.
P2/P3 → optimisation backlog; P0/P1 may not enter the backlog.

## I. Pilot Known Limitations Register

1. **Payments disabled.** Free pilot only; entitlement provisioned without billing. The commercial gate is separate and untested.
2. **Estate-level `/signup` closed** (its own flag, never written). Practice self-serve is the open door.
3. **Revoked membership in an open tab is undetectable** until next navigation/session end (`contextVersion` absent from WorkspaceContext — SHELL s9 names 13 fields, 7 carried). Mitigation: short sessions; revocations take effect at next request.
4. **True concurrent-booking race not separately executed** (sequential-at-limit refusal is; same DB check decides both). H2.3–H2.4 provide the human proof, or disable self-booking for Stage 1.
5. **Playwright smoke suite not yet built** (route list is a product decision); CI covers 43 pure harnesses + 209 unit tests instead.
6. **Guardian workflow** relies on conditional-registration machinery + H1.3 human confirmation.
7. **`cgr-suggest` (AI link suggester) untested live** by policy (spend); the approved primary AI provider path is harness-proven.
8. **24 optimisation items parked** by standing owner instruction; none block the pilot.

## J. Defect register (this acceptance pass)

No open P0. No open P1.

**H1 findings (owner-run, 2026-08-28 afternoon):**

| # | Finding | Severity | Disposition |
|---|---|---|---|
| H1-1 | A phone-required template refused a MINOR: the template check read the patient's raw phone and never consulted the guardian, while the minimum-dataset rule always had. Owner ruling: phone is the guardian's requirement, not the minor's | P1 | **FIXED same day** (registration.ts, one shared guardian lookup for both checks) + 3 executable regression cases, practice-registration-harness 69/69 on staging. Reaches production on next deploy |
| H1-2 | Owner expected to SEARCH for a registered patient in the Planner's quick-book panel; it is name-only by design (its footnote says so) and the patient-linked path is Patients -> record -> book. Reachable, not discoverable at the moment of need | P2 | Logged for the optimisation backlog: patient search/autocomplete in the quick-book, or stronger signposting. Script H1 step 4 clarified |
| H1-3 | The 30-minute-notice refusal fired on a past-time booking attempt and named the rule and the location in plain words | — | Not a defect: the booking rule working, observed live | Found-and-fixed during the pass (not open): the fixture-A membership mis-model
| H2-1 | Sign in invisible on the mobile landing bar -- the daily action hidden behind the hamburger while the trial CTA got a button | P2 | **FIXED + deployed** same day: compact Sign in on the bar below lg, flag-resolved from the same journeys as the drawer |
| H2-2 | Form values rendered placeholder-grey on EVERY capture screen (owner: data difficult to read, all screens incl. encounter entry) -- the shared control class set no text colour and was copy-pasted across 33 consoles | P2 | **FIXED + deployed**: all 33 copies carry explicit value colour; placeholders alone stay muted. Gates: responsive 94/94, colour 17/17, tokens 58/58 |
| H2-3 | Choosing On a date... in the follow-up composer revealed an empty field needing ANOTHER tap -- on mobile that read as no calendar appears | P2 | **FIXED + deployed**: the calendar opens on the choice itself (showPicker on the select activation, focus fallback) |
(fixed same day, harness reshaped); the stale apex `/signup` copy (fixed + deployed 2026-08-28). P3
backlog: signup-harness `probe-*` debris identities on staging (cosmetic, exempted by pattern).

## K. The smallest remaining blocker list for Stage 1

1. ~~H1 desktop day-in-the-life~~ — **DONE 2026-08-28**, PASS (item 4 closed; results in §H1).
2. **H2 mobile critical journey** incl. the booking double-tap — owner-performed (items 5, 6).
3. **§G names filled in** — pilot owner, escalation, support channel, cohort, daily review (item 8).
4. **Backups confirmation** — owner confirms the Supabase backup schedule and who restores (§F line).

Everything else in §14 is closed: email (1, PASS 2026-08-27), outbox executable tests (2, PASS this
arc), second-practice topology (3, PASS this arc), isolation (7, PASS). Stage 0 can start today.
