# Migration 690: build record (CCHU competency assessment operations)

**Authority:** owner GO, 29 Oct 2026, "COMPETEN — CCHU Competency Assessment Implementation. Decision: GO — Engine B integration and completion", with ENT-ASMT-REVIEW-01 as the baseline.

**File:** `supabase/migrations/690-cfca-assessment-operations.sql`, sha256 `ee0762ecf64c30ca5ac73b898f77150769b8126b2860ab998bce8d0c6f560392` (the file staged, merged and to be applied).
**Rollback:** `docs/evidence/CFCA-ASSESS-OPS/ROLLBACK-690.sql`. It refuses once a 690 record exists.
**House rules:** ALL CLEAR (791 lines, 324 statements; warnings are the APPLY-WHOLE constructs and apostrophes inside the 461 comments carried byte for byte).

## Order and dependencies

- Apply **after 680** and after 395, 422, 442, 461, 510, 640, 641, 660 and 670, all already in production.
- It replaces the two 461 review guards with every 461 branch unchanged plus a method branch. A later migration that replaces those guards must start from this file.
- **Deploy the app first.** The code reads 690 columns with a fallback to 680 and then to 510 (`withLevel` in `src/lib/competency/verification.ts`). Every 690 write answers "not set up on this environment yet" while 690 is absent.

## Staging (ezhvpgtcqcdsgylrxgdb), 29 Oct 2026, applied by the agent with the guarded runner

| Function | md5 before 690 | md5 after 690 |
|---|---|---|
| clinical_content_version_guard | 5c7e99fcb3f30265db6b5dca7e04f7e5 | 1c5a96cdea9d4655b0167842e66adb17 |
| clinical_review_decision_guard | 555ae43ed11c2631f2e86f3a5e89a216 | b91b8e90542b8f70080e0653b3aab67e |
| competency_verification_state | d8a906df9025989f9d50296a180738e5 | 97b7ac820edd610d2b79011e9faf0149 |
| 510/680 decision, version and request guards | unchanged | unchanged (fcadb90a, 22eb8d16, 7dd68646) |

1. Applied: 7 triggers, 2 tables, the new column on `clinical_content_version`, 2 request-capability grants.
2. Rollback rehearsal: every function returned to its exact pre-690 md5, and the 690 column and tables were gone. The rollback's first run refused because its own guard counted null `requested_by` as a programme-lead request. That guard was corrected and the rollback then ran.
3. Re-applied twice: identical md5s and counts both times.

## Staging probe (`PROBE-690.sql`): one transaction, always rolled back

The probe appointed synthetic staging profiles (authorised by the staging owner) and ran the whole chain. Result:

`setup=ok; P1=ok; P2=ok; P3 submitted required=1; P4=ok; P5=ok; P6a=ok; P6=ok approved true; P7a=ok; P7=ok; P8a=ok; P8=ok; P9 state=awaiting_confirmation confirm=true stage=competent v1 drafts=0; P10a=ok; P10 state=decided; P11=ok`

| Item | What was proved |
|---|---|
| P1 | An unreviewed method cannot be published, even by an independent publisher |
| P2 | Only the author or an editor puts a draft forward |
| P3 | The submission takes the governed approval count |
| P4 | The author cannot review their own method |
| P5 | A criterion edited after the method was made is caught |
| P6 | The author may not publish, an independent administrator may, and the method is then clinically approved |
| P7 | A request for somebody else needs `hq.competency.verification.request` (refused for an assessor, allowed for the programme lead) |
| P8 | Only the assigned assessor keeps a draft |
| P9 | A verified decision under a second-assessor method awaits confirmation, its stage comes from published DACUM mapping v1, and its drafts are cleared |
| P10 | The first assessor cannot confirm, and the second assessor's confirmation decides the request |
| P11 | Confirmations are append-only |

## Production

**NOT applied.** It needs a separate owner GO, a fresh backup and restore test, and a read-only pre-check. The pre-check must show the production md5s of the three replaced functions equal the staging "before" column, which proves production carries the 461 and 510 bodies the rollback restores. Nothing is activated: no method published, nobody appointed or scoped.

## Known follow-up

`scripts/staging-c5-verification-acceptance.ts` publishes a method over HTTP. Under 690 that also needs a clinical approval of the exact draft, so its journey needs a clinical reviewer identity appointed on staging. That appointment is an owner action.
