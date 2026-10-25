# CKRI 440–443 — staging record (ezhvpgtcqcdsgylrxgdb), 2026-10-25

Applied by the coordinating session with the guarded runner, files whole, LF bytes exactly as in BUILD-RECORD.md's
checksums. **Staging only. Production: not applied, needs its own owner GO.**

## Sequence

1. Apply 440, 441, 442, 443.
2. Apply 440, 441, 442, 443 again.
3. VERIFY-440 to VERIFY-443.
4. Rollback 443, 442, 441, 440.
5. Re-apply 440, 441, 442, 443.

## Fingerprint

md5 over: ckri_* columns, constraints, indexes, policies and triggers; ckri_* function sources and both clinical guard
sources (CR-stripped md5); clinical_content_version and clinical_review_decision columns, constraints, indexes and
triggers; the research and knowledge capabilities, positions and grants.

| step | fingerprint | items |
|---|---|---|
| PRE | aca96edd72357907aaf44dde3b16fc17 | 39 |
| apply #1 | 7b8c575971c95e042236c445e66b7fab | 439 |
| apply #2 | 7b8c575971c95e042236c445e66b7fab (idempotent) | 439 |
| rollback 443 to 440 | aca96edd72357907aaf44dde3b16fc17 = PRE (guards, subject CHECK, capabilities restored) | 39 |
| re-apply | 7b8c575971c95e042236c445e66b7fab = apply #1 | 439 |

## VERIFY (after both applies, all as expected)

- **440**: 5 tables with RLS. Read-own policies on ckri_participation and ckri_participation_event. Grants as
  specified. ckri_holds_capability not executable by anon or authenticated. 0 rows. Fingerprint 04964f23.
- **441**: 2 tables, RLS on, 0 policies. 2 triggers. Builder, purge and capability check executable by the service
  role only. 0 rows. Fingerprint e73968db.
- **442**:
  - 4 tables, RLS on, 0 policies. knowledge_version_id nullable. The three-kind subject CHECK.
  - Existing review records unchanged: clinical_content_version case 4, competency 8. Review decisions 4.
  - Guard bodies (CR-stripped md5): clinical_content_version_guard f3d6387c588f0bb2e41d04ebd6eb6037, and
    clinical_review_decision_guard 1641180d36b2881d9251209327604fd6. Both match the frozen values, and both have the
    resource branch.
  - Grants: knowledge_educator to hq.learning.ckri.educator, and quality_council_member to hq.quality.knowledge.publish.
- **443**: 7 tables, RLS on, 0 policies. The 3 project triggers. Member check is aggregate_only. Reviewer grant
  present. 0 rows. Fingerprint e2e97c66.

## Independent review by the coordinator

Both guard functions as live on staging (from 422) were diffed against 442. The only change in each is the added
resource branch. The competency and case branches are unchanged.

## Notes

- VERIFY-442 reads ckri tables, so it cannot run before the first apply. The PRE fingerprint records the before-state
  of both guards instead.
- The 442 guard bodies are FROZEN. Learning (migration 461) copies them byte-identical and adds only its own branch.
  Order on every environment: 442 before 461.
- 430 (portable clinical hash, staging only) does not overlap 442. 442 calls competency_content_hash() and does not
  restate it, the import functions or the provenance constraints.
