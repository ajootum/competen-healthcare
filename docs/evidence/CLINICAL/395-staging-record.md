# Owner decision D2: migration 395, staging record

**Authority:** owner D2, 2026-10-24: "Implement migration 395 in development/staging if required." The main session applied 395 from the cfca worktree with the guarded runner (target ezhvpgtcqcdsgylrxgdb, guard passed, every run "ok"). OPS-001 s8 tier: Medium (new trigger functions), so the rollback was rehearsed.

**Fingerprint tool:** `npx tsx scripts/ind007-staging-schema-check.ts --clinical395` (read-only).

**Revision 2 (this file).** It supersedes an earlier staging application of aa58ad1a. The only differences are the reviewer position's `hq.platform.home.view` grant and grant INSERTs written in the form hq-guard reads.

| Step | Result |
|---|---|
| Starting state (aa58ad1a applied) | 03ecf7d3 |
| Apply ×2 | ok. F1 = 87dda360 (home grant to clinical_content_reviewer present) |
| Rollback (ROLLBACK-395.sql, b8503d33, run-staging-sql.mjs) | committed. F2 = 299a0776 = true PRE (no reviewer appointment existed) |
| Re-apply ×2 | ok. F3 = 87dda360 = F1 |

**Files (bytes re-checked before and after the runs):**
- 395-clinical-content-approval.sql: sha256 142ac7165ee4389ed897b573306906acceacd60b3f603cd10cdec8bb9bd71611. migration-house-rules ALL CLEAR (382 lines, 81 statements).
- ROLLBACK-395.sql: sha256 b8503d33d05012b6759c3c5825c633d7f3eea4ac861849bd641bf018cebe01af

**Frozen.** Any further change is a new migration (410).

**Dependencies and application order:** 384 (learning_outcomes, expected_level_id), 264 (hq_position, hq_capability, hq_position_capability), 117 (ogs_office_appointments), 013 (taxonomies, taxonomy_terms), 007 (competency_skills). It is independent of 393 and 394, so it may follow them in either order.

**Staging acceptance:** `clinical-review-acceptance` passes 16/16 against these triggers. It made and removed its own fixtures. Its first run preceded this record, and the main session confirmed it did not overlap the rehearsal.

**Production:** not applied, not authorised.
