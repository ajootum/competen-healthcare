# UNIFIED-GOVERNANCE-V1 — migration 940 build record

Owner spec and GO, 3 Nov 2026 ("Competen Holdings — Unified Governance V1, Approved Design and Implementation GO").

| State | Status |
|---|---|
| 1. Authored | Done (branch `asmt/pathway-01`, worktree competen-asmt-path). House rules ALL CLEAR (4 non-blocking APPLY-WHOLE warnings). |
| 2. Applied and verified on staging ×2 | **PASS 3 Nov 2026** (this session, staging ezhvpgtcqcdsgylrxgdb via run-staging-sql.mjs): apply #1 committed, apply #2 committed (idempotent), VERIFY 12/12; ROLLBACK rehearsed (committed), the 890 guard restored from 890's own text, VERIFY then errors on the dropped `reports_to` column (expected), re-apply #1 and #2 committed, VERIFY 12/12. Left APPLIED. |
| 3. Merged into main | Not yet. |
| 4. Applied to production | **Not applied.** Separate owner GO. The owner applies it by hand in the SQL editor. |

**sha256 of the file to stage and to apply:** `6f3f88cc4d825932feaea634062ed291b50848e3e0e5d7c0314a56f02226a637` (LF, ASCII, 440 lines).

| Companion file | sha256 (first 8) |
|---|---|
| VERIFY-940.sql | a0d500f8 |
| ROLLBACK-940.sql | a107e45a |

**Application order and dependencies.** After 930. Needs 264, 040, 500, 640, 641 and 890 (all in production). Additive except the one function replaced whole (asmt_version_lifecycle_guard, see below). Re-running it is a no-op. Appoints nobody, ends no grant, changes no existing appointment, decision or event.

## What it changes and why

1. **Two-person checklist publication rule** (spec section 3). `asmt_version_lifecycle_guard` is 890's text with one block changed in the `approved → published` branch: the refusal "an author, editor or submitter of this version or any earlier version cannot publish it" is replaced by: publish capability held, content hash present, at least `hq_sod_required_approvals(risk)` governance approvals on that exact hash recorded by reviewers who are NOT among `asmt_version_people(version)`, and no rejection or request for changes on that hash. `asmt_review_decision_sod_guard` is untouched, so nobody records a decision on their own work; a change after approval is only possible by returning to draft, which clears the hash. Distinct records remain: decision rows, the approved event, the published event with its person.
2. **Reporting relationships** (sections 1, 6). `hq_position.reports_to` (self reference, loop guard for every writer) and `hq_position_admin_set_reports_to` (owner only, audit_log first).
3. **Initial organisation** (section 1, acceptance 1-2). 13 positions (5 executive in the `executive` space; managers in `platform`, `quality`, `learning`, `executive`), reporting lines, the standard content-governance profile as ordinary `hq_position_capability` grants (grant_reason `UNIFIED-GOVERNANCE-V1 …`), clinical approval only on the CCAO and its two managers, `scoped_appointments = true` on the eight management positions. On staging every grant was accepted (10 per position, 11 for the three clinical ones); no pair was blocked. If a pair is blocked on the target database the grant is skipped with a NOTICE, and that must be read in the SQL editor output when applying to production.

## Staging artefacts
None beyond the rows above. Nobody appointed by the file. The two-person walk appoints the staging owner fixture to `chief_executive_officer` (see WALK-2026-11-03.md in this folder) — a staging appointment only.

## Production release actions (owner, separate GO)
1. Backup reference recorded, then apply 940 whole in the SQL editor; read the NOTICE lines (skipped grants).
2. Run VERIFY-940.sql: expect `pass=12 fail=0`.
3. Appointments (HQ Positions screen, owner): see the PR body for the exact three.
