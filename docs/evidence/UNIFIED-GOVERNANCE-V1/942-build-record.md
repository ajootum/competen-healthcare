# UNIFIED-GOVERNANCE-V1 — migration 942 build record (governed policies on the definition engine, Document Template Studio review)

Owner follow-up, 3 Nov 2026, item 5: extend the unified governance lifecycle to Document Studio and governed policies, reusing the existing engine, versioning, review/approval controls and audit history; no separate approval system; same three-stage header, inbox tasks, history, two-person rule.

| State | Status |
|---|---|
| 1. Authored | Done (branch `holdings/unified-governance-v1-followups`, worktree competen-gov2). House rules ALL CLEAR. hq-guard harness S4/D1/D2/D5/D6 green (91 capabilities in DDL and code). |
| 2. Applied and verified on staging ×2 | **PASS 3 Nov 2026** (staging ezhvpgtcqcdsgylrxgdb via run-staging-sql.mjs): apply #1 and #2 committed, VERIFY 12/12; ROLLBACK committed, VERIFY then fails on the dropped lookup function (expected); re-apply #1 and #2 committed, VERIFY 12/12. Left APPLIED. Database proof of the policy lifecycle: `policy-db-proof` (see WALK-2026-11-03-followups.md). |
| 3. Merged into main | Not yet. |
| 4. Applied to production | **Not applied.** Separate owner GO. |

**sha256 of the file to stage and to apply:** `213855fbeae330c1fe7ae261349d87b3e3b423d73d6e58aa7e95ad72bf4301e3` (LF, ASCII, 706 lines).

| Companion file | sha256 (first 8) |
|---|---|
| VERIFY-942.sql | b5896bf2 |
| ROLLBACK-942.sql | 95b2576b |

**Application order and dependencies.** After 941. Needs 890, 940, 264, 500, 376, 451, 076 and 640. Additive: three capabilities, grants to the 13 positions of 940 and the Quality Council Member, two policy tables, one review table, the capability lookup function, three engine functions replaced whole (lifecycle from 940's text, decision guard and duplicate from 890's text, each with the capability lookup substituted), the two trail checks widened, two triggers on the policy version table, two on the review path. Re-running it is a no-op. It appoints nobody and changes no existing definition, decision or event.

## What it changes
1. **Governed policies** are a sixth kind of the 890 engine: `hq_policy` (identity, code `POL-nnnnnn`) and `hq_policy_version` (the lifecycle columns plus title, summary, content, effective_from, review_due). The same lifecycle guard (with the 940 two-person publication rule), after guard, review-decision guard, append-only trails and `asmt_duplicate_version` apply. `asmt_version_parent_col` knows the table; `asmt_lifecycle_capability(table, step)` tells the guards that policies need `hq.quality.policy.author/review/publish` (domain review stays `hq.quality.clinical.approve`).
2. **Standard profile**: the 13 positions receive policy view/author/review/publish; the Quality Council Member receives review and publish.
3. **Document Template Studio**: `hq_config_review` records a submission of the current documents draft (by hash) and one independent decision by a different holder of `hq.individual.config.manage`; `hq_config_publish_guard` refuses publishing a changed documents configuration without an approval on exactly that hash. Unchanged paths and every other path of the Individual policy publish as before. The submitter may publish the approved draft.

## Production release actions (owner, separate GO)
Apply 940, 941, 942 in order; VERIFY each; the 942 grants extend the 940 positions, so the same appointments carry the policy rights.
