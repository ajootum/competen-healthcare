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
