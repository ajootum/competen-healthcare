# CPR-GATE-001 — Competen Practice pilot walkthrough

The IAM-001 §14 cutover gate, as a thing a person actually does.

§14 is a ten-line checklist ending in *"run controlled internal and pilot-user acceptance testing"*.
Most of those lines are facts about the deployment and are checked by
`scripts/practice-pilot-gate.ts`. Two of them are facts about a **person**, and no script can stand in
for those. This document is those two.

**Run the preflight first.** If it is red, stop — a failure during the walkthrough would be an engine
problem wearing a UI costume, and you would waste the walkthrough diagnosing it.

```bash
npx --yes tsx scripts/practice-pilot-gate.ts
```

It provisions a synthetic workspace, drives provision → onboard → ACTIVE → book → confirm → check in →
register → encounter → note → diagnosis → treatment → sign, checks tenant isolation *while that data
exists*, and deletes it. Green means the engines are sound and anything you hit below is the interface.

---

## Part A — the walkthrough (no flag flips, no new credentials)

You are already signed in as `super_admin`, and `practice_pilot_provisioning` is ON. That is enough to
walk the entire product. **A super-admin may provision for themselves**, so nothing here needs
`practice_sign_in`, a second account, or a password typed anywhere.

| # | Do this | Expect |
|---|---|---|
| 1 | Open **Platform Operations → Competen Practice** (`/super-admin/platform-ops/practice`) | Launch state reads **Development**. The gate ledger shows auto items green and three MANUAL items. |
| 2 | In *Provision a pilot workspace*, leave the target as yourself, name it, press **Provision** | A green notice with a workspace id and status `ONBOARDING`. The workspace appears in the table below. |
| 3 | Press **Provision** again without changing anything | The **same** workspace comes back, not a second one — the Idempotency-Key is reused until success. |
| 4 | Go to `/practice` | You are routed into the product, not the marketing page — the index is auth-aware on **membership**. |
| 5 | Complete the onboarding wizard | Each step saves; finishing `review_activate` flips the workspace to **ACTIVE**. |
| 6 | You land on `/practice/home` | Real numbers: locations, team, plan with trial days, workspace status, and the audit trail as recent activity. Sidebar shows Home, Calendar, Patients, Encounters. |
| 7 | **Calendar** → book an appointment for today | It appears on the day with status `REQUESTED`. |
| 8 | **Confirm**, then **Check in** | Status → `CONFIRMED` → `ARRIVED`, and the patient appears in the waiting queue. |
| 9 | **Patients** → register the same person (name, DOB, a phone) | A `P-XXXXXX` Practice ID is generated. Try registering them again — you are shown candidates and refused until you confirm. |
| 10 | On the patient record, press **Start encounter** | You land on the consultation workspace. Press it again from another tab — you get the **same** encounter, resumed. |
| 11 | Write a SOAP segment and **Save**; record a diagnosis with a problem name; record a medication | Each appears immediately on the encounter. |
| 12 | **Complete**, then **Sign and lock** (confirm the dialog) | The encounter shows *Signed and locked*. The note boxes are read-only. |
| 13 | Try to change anything on the signed encounter | Refused. The engine refuses it, and migration 194's trigger refuses it again underneath. |
| 14 | Go back to the patient record | The **clinical timeline** shows the encounter with its diagnosis. |
| 15 | Return to the operator page and refresh | The workspace row shows patients 1, encounters 1, **signed 1**. The gate item *"the clinical loop closed end to end"* is green. |

If steps 1–15 pass, **CPR-BUILD-000 phases 0–3 are accepted**. That is the acceptance-criteria core.

### If something breaks

- **Empty sidebar / everything 403s** → capabilities were not granted. Check the provisioning step
  ledger on the operator page: `assign_capabilities` should be green. This exact failure shipped once —
  an upsert against a partial unique index that PostgREST refuses, with the error discarded.
- **Provisioning stops midway** → the request stays resumable by design. The step ledger shows which
  step failed; re-running the same idempotency key continues from there rather than starting over.
- **`PRACTICE_ALREADY_EXISTS`** → one individual Practice per person, deliberately. The response carries
  the existing workspace and where to continue.

---

## Part B — the cold sign-in (this one needs a flag)

Everything above rides your existing session. The last untested thing is a person arriving **signed
out**. Only this needs `practice_sign_in`.

**Before flipping it, understand what changes publicly.** `/practice/sign-in` currently renders a
transparent *"Sign-in is not open yet"* panel and there is **no password field anywhere on the public
site**. Turning the flag on puts one there. The public disclosure harness asserts its absence
(assertion 7e), and that assertion exists to prevent a **fake** form — not a real one. So it is retired
**deliberately, in the same change as the flip**, never discovered afterwards as a red harness.

1. On the operator page, toggle **Sign-in open** → ON. Confirm the dialog. The notice restates the 7e
   consequence.
2. Retire assertion 7e in `scripts/public-disclosure-harness.ts`, with a comment recording why, and
   re-run it. Update the public availability copy so it no longer says the product cannot be signed into.
3. Sign out completely. Open `/practice/sign-in` in a fresh window.
4. Sign in with your own credentials. You should land on `/practice/home` — the shell decides the
   destination from membership, so it also routes correctly to onboarding or the workspace chooser.
5. Check `/practice/sign-in?return_to=/practice/calendar` sends you to the calendar, and that a foreign
   `return_to` is ignored.
6. Follow **Forgot your password?** and confirm it reaches the platform reset flow.

**Rollback:** toggle the flag OFF. The panel returns, no account is lost, and every flip is in the
Practice audit log with who and when.

`practice_public_signup` stays OFF until a pilot cohort has used the product for real. That is §14.1's
*controlled launch*, and it is a separate decision from this gate.

---

## What this gate does not cover

Named honestly, because a checklist that implies more coverage than it has is worse than a short one.

- **Performance and load.** §14 asks for performance tests; nothing here measures latency under
  concurrency. Not built.
- **Multi-user practices.** Every path above is one practitioner. Delegation, invitations and shared
  workspaces are Phase 7.
- **Recovery of a half-provisioned workspace by a non-operator.** Resumability is proven by the harness
  and visible in the step ledger, but there is no self-service retry in the product.
- **Email delivery.** Verification and reset emails ride the platform's identity configuration; this
  document assumes it already works, because it is not Practice-specific.

---

## Part A-2026-08-16 — the refreshed route (start HERE if your practice already exists)

Part A above was written when the product was phases 0-3 and provisioning was the first hurdle. Your
practice exists and is ACTIVE, so steps 1-6 are already true of you; and the product has grown a
finance arc, offline capture, follow-ups, the Session cockpit and the compressed planner since. Two
details of Part A have also aged: new registrations mint a `YY-NNNNNN` patient number (the
`P-XXXXXX` id is a legacy identifier, still searchable), and the sidebar is the eleven-item
harmonised navigation, not the four items step 6 names.

**A free day is a good walkthrough day.** The walk-in path is the whole clinical spine and needs no
bookings; booking one appointment for today un-frees the day in two clicks anyway; and the empty
states themselves are test subjects -- every one of them is supposed to say something true rather
than render a zero grid.

The route, in the order a real day runs. At every step the question is the same: **does the screen
say something untrue, confusing, or missing?** A defect here is usually a SENTENCE, not a crash.

| # | Do this | Watch for |
|---|---|---|
| 1 | **Planner** -> add an activity for today (a clinic block) | The compressed layout: one Day Inspector, not six stacked cards. The appointment book appears only in Day view. |
| 2 | **Command Centre** -> start the day / start the activity | Current Activity in the sidebar goes Running. |
| 3 | **Current Session** | The cockpit: tiles as pairs (no percentages), Current Patient empty state honest, queue empty but not a zero grid. |
| 4 | Book an appointment for today (Planner, Day view), then Check in -- **from the cockpit**: the booked person appears on Current Session's "Expected" strip with a one-click Check in | Your booking is BORN CONFIRMED (staff bookings confirm themselves -- you should never be asked to confirm your own booking); Check in moves it to ARRIVED, the arrival time is stamped by the server at that click, and the person appears in the cockpit queue. The Planner's own Check in button still works and does the same thing. The REQUESTED state belongs to the patient-facing booking page only. |
| 5 | **Add a walk-in** from the cockpit queue | Registration with duplicate screening; the `YY-NNNNNN` number mints. |
| 6 | **Start the encounter from the queue row** | This action is NEW today -- it existed as code for months and was never wired. You land in the consultation. |
| 7 | Document: SOAP segments, a diagnosis with a problem, a medication | Each save is versioned; no-op saves write no version. |
| 8 | Record a **measurement** and a **procedure** on the encounter | Plausibility warns, never blocks. |
| 9 | Raise a **follow-up** from the encounter ("review in 2 weeks") | It lands on the Follow-ups board with the encounter as origin. |
| 10 | **Charges and payment** door on the encounter -> charge the consultation -> record a cash payment | The receipt gets a CP-RCT number; collected-vs-received language holds. |
| 11 | Back in the cockpit: **Finish the session** | The two-step acknowledgement lists anything unresolved (it acknowledges, never blocks). Session Complete renders the summary. |
| 12 | **Sign** the encounter, then try to edit it | Refused by the engine, and by the database trigger underneath. |
| 13 | **Payments** workspace: Overview / Transactions / Outstanding | The day's money is there; print an invoice and the patient statement (print view IS the pdf). |
| 14 | **Patients** -> the patient record | Timeline shows encounter, diagnosis, measurement, procedure, follow-up, charges. |
| 15 | **Practice Intelligence** | Real denominators, the ONE approved percentage (attendance) and nothing else percent-shaped. |
| 16 | **/practice/offline** (open it once online first, set the PIN when offered) | The offline reader with its four capture forms: reading, visit, follow-up, money -- each says "held on this device", never "saved". |
| 17 | Airplane-mode one capture if you are feeling thorough, then reconnect | It files at sync; the receipt for money is numbered AT sync. |
| 18 | **Privacy -> Security** | The posture states the retention POLICY (a decision of record, not a gap); the session panel shows your 30-minute idle rule live. |
| 19 | Walk away 30 minutes (or use the console's preview) | The 60-second warning, then the cover; your password brings everything back. |
| 20 | Anything that read wrong at any step | Write the sentence down verbatim. That sentence is the defect report. |

Steps 1-15 exercise everything CPR-BUILD-000 through the PAY arc shipped; 16-17 the offline arc;
18-19 the security enforcement you switched on today. The walkthrough is DONE when you have either
a list of sentences that need fixing, or the honest verdict that a stranger could run a day on this
product without being lied to once.
