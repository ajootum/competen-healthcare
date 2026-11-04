# UNIFIED-GOVERNANCE-V1 — migration 941 build record (frameworks on the two-person principle)

Owner follow-up, 3 Nov 2026, item 6: Person A authors and publishes; Person B independently reviews and approves; A publishes only the exact independently approved version; professional reviewer eligibility, specialist approval and actor-level SoD unchanged.

| State | Status |
|---|---|
| 1. Authored | Done (branch `holdings/unified-governance-v1-followups`, worktree competen-gov2). House rules ALL CLEAR. |
| 2. Applied and verified on staging ×2 | **PASS 3 Nov 2026** (staging ezhvpgtcqcdsgylrxgdb via run-staging-sql.mjs): apply #1 and #2 committed, VERIFY 6/6; ROLLBACK (640's function text) committed, VERIFY then 3/6 as expected (the three removed/changed refusals back); re-apply #1 and #2 committed, VERIFY 6/6. Left APPLIED. |
| 3. Merged into main | Not yet. |
| 4. Applied to production | **Not applied.** Separate owner GO. |

**sha256 of the file to stage and to apply:** `bd897f717e59bf40122d41b27b8167ba3972ce89977101a2f861dc3cbfd02ba4` (LF, ASCII, 77 lines).

| Companion file | sha256 (first 8) |
|---|---|
| VERIFY-941.sql | 4e963825 |
| ROLLBACK-941.sql | 65946458 |

**Application order and dependencies.** After 940. Needs 395, 466 and 640 (in production). One function replaced whole (`frameworks_sod_publication_guard`); no row changed; no table, column or grant.

## What it changes
`frameworks_sod_publication_guard` (640) refused the person who put the framework forward and any contributor in the audit trail. 941 removes those two refusals and keeps: the publisher is recorded on a publication and cleared otherwise; where `hq_sod_content_rule.publisher_not_approver` is on for `competency_framework`, the publisher may not be one of the clinical approvers of its competencies. Independence of the approvals stays at the decision (`clinical_review_decision_sod_guard`, 640, every version of the subject; 395 reviewer scopes; NOT_AUTHORSHIP), and `cfca_framework_publication_guard` (466) still refuses a publication while any competency is not clinically approved at its current content, so what is published is exactly what was independently approved.

## App (same PR)
`publisherConflict` no longer excludes the submitter or contributors; it reports the configured approver rule (`approversOf`, `publisherNotApproverRule`, fail-closed when unreadable). `decidePublication` reads the decision rows for that check. The governance workspace names the group "Publisher" and computes eligibility by the same rule; wording in the pathway, next action, publication controls and refusal texts updated. Tests: framework-publication (two-person cases, approver rule on/off), framework-layout (the reorderer may publish the approved layout), governance-workspace.
