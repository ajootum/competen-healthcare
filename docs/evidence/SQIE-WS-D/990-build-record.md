# Build record: migration 990 (SQIE-CLOSE-2026-11 WS-D, attempt-record completeness)

**Authority:** owner directive SALE-2026-11 (4 Nov 2026), SQIE workstreams WS-A..WS-J approved; Wave 1 = WS-B, WS-H, WS-D, WS-J. This is WS-D (tracker rows SQIE-04, SQIE-07, SQIE-08, C-04, C-09, C-12). Migration number 990 claimed in the SQIE Wave 1 claim file.
**State (CLAUDE.md four states):** 2, applied and verified on staging (ezhvpgtcqcdsgylrxgdb) twice, rollback rehearsed, re-applied. **Not applied to production.** When merged, `main` holds 990 while production does not. The code fails closed without it (below).

## File, order, dependencies

| File | sha256 |
|---|---|
| `supabase/migrations/990-individual-scholar-snapshot-completeness.sql` | `46a474837293e95e27f417fb58cc1715c8a859444bd3fa2a3bebe0a793eefcc5` |
| `docs/evidence/SQIE-WS-D/PRECHECK-990.sql` (read only) | `6a1e899cd2afff0bfd3310176e1f8478836fdef1ed6da2a095dd2508f5053b64` |
| `docs/evidence/SQIE-WS-D/VERIFY-990.sql` | `da5367b85be704d8d8835fa0fecb05473ac73c4f37e60a405ab61e9153c83e7e` |
| `docs/evidence/SQIE-WS-D/ROLLBACK-990.sql` | `8734819d5d54393d968aff7de191482fa0d0f265b97cb56837a0c58e9908e96e` |

**Depends on:** 791 (`individual_scholar_attempt_snapshot`), 950 (`unmarked` attempts), 395 and 761 (`competency_content_hash`, `competency_content_hashes`), 012 (`frameworks.version_major/minor/revision`). All are in production (prod head 960). Independent of 970-989. Application order: after 960, any time; it writes no row.

**What it changes (one table, no new table, no row written, no backfill):**
1. `individual_scholar_attempt_snapshot.competency_provenance jsonb` (null on every existing snapshot).
2. The 791 shape CHECK re-added with `marking 'unmarked'` and `outcome 'unmarked'`, bound together (`(marking = 'unmarked') = (outcome = 'unmarked')`), and an unmarked snapshot carries no score. Every other 791 term (16384-byte budget, hashes, versions, 20 competencies) is unchanged.
3. `individual_scholar_attempt_snapshot_provenance_check`: null, or an array as long as `competency_ids`, its ids equal to `competency_ids` in order, each element exactly `{id, content_hash (32 hex or null), framework_id (uuid or null), framework_version ('M.m.r' or null)}`, at most 4096 bytes.

**Design choice (column vs `presented` JSON):** a column, so the CHECK makes a misaligned or malformed provenance unrepresentable (CLAUDE.md). A NOT NULL / NOT VALID rule for new rows was considered and left out on purpose: if 990 reached production before this app, the app at 09d9da09 would insert snapshots without the column and every snapshot would be refused. Null therefore means "not recorded" (before 990, or written by an older app).

Passes `scripts/migration-house-rules.ts`: ALL CLEAR (85 lines, 8 statements, 2 constraints).

## Staging evidence (4 Nov 2026, 10:25 UTC)

- **Found already applied.** The first PRECHECK found the 990 column and both constraints present, carrying this file's own comment text, with 0 rows using them (0 snapshots with provenance, 0 unmarked snapshots). No other worktree holds the file and the runner keeps no log, so who applied it first is not established. To get a clean pre-state the rollback was applied first.
- `ROLLBACK-990.sql`: Done, Committed. `VERIFY-990.sql` then failed as expected: `VERIFY-990: competency_provenance column missing`.
- **Pre-state (PRECHECK):** snapshot_table=true, provenance_col=false, shape_has_unmarked=false, provenance_check=false, attempt_marking_950=true, hash_fn=true, fw_version_cols=3, snapshots=44, attempts=47, unmarked_attempts=0, attempts_without_snapshot=3.
- **990 applied twice** through the owner runner (`run-staging-sql.mjs`, target ezhvpgtcqcdsgylrxgdb): both `Done ... Committed`. `VERIFY-990.sql` passed after each.
- **VERIFY-990** (a DO block that raises on the first failure): the column is jsonb, both CHECKs present and exactly two on the table, the shape CHECK carries unmarked, ai_evaluation and the 16384 budget, no older snapshot carries provenance; 13 behaviour probes against a real attempt without a snapshot, each rolled back: accepted = unmarked with no score, valid provenance, provenance with nulls, null provenance; refused = unmarked with outcome incorrect, deterministic with outcome unmarked, unmarked with a score, misaligned id, an extra key, a missing key, a bad hash, wrong length, not an array. No probe row kept.
- **Post-state (PRECHECK):** provenance_col=true, shape_has_unmarked=true, provenance_check=true, snapshots=44, attempts=47 (no row written by the migration).
- The jsonpath element rule was first checked with a read-only probe (8 cases, the expected true/false for each) before it went into the file.

## Rollback

`ROLLBACK-990.sql` refuses while any unmarked snapshot or any snapshot with provenance exists (791 snapshots are immutable, and those rows would break the restored rule). Removing them is an owner decision, never done there. Then it drops the provenance CHECK, restores the 791 shape CHECK verbatim, and drops the column. Rehearsed on staging (above).

## Fail closed without it (production today)

- The server sends `competency_provenance` only while the column exists (`store.ts insertAttemptSnapshot`). A missing column (PGRST204 / 42703) is remembered for the process.
- A **revision, adaptive or scenario** snapshot is then kept exactly as before, without the provenance (one retry, then no further try).
- An **understanding check** snapshot (`attempt-integrity.ts keepCheckSnapshot`, both CYU write sites) is not kept: what happens today. No audit row, nothing said to the learner, the kept answer is unaffected.
- The provenance lookups (`competency_content_hashes`, `framework_competencies`, `framework_domains`, `frameworks`) are skipped once 990 is known absent. They never throw: a part not read is null.
- 791 absent: unchanged (nothing is kept).

## The code in this branch (beside the migration)

- **SQIE-08:** `keepCheckSnapshot` after `recordCheckAttempt` in `R/learn/checks/route.ts` (self_graded, unmarked) and `R/learn/act/route.ts` (ai_evaluation). The snapshot keeps the question as shown, the typed answer, the lesson's key points as key and rubric with the rubric hash, the verdict or self-grade, score, outcome (unmarked for an unmarked answer, never incorrect), marking, the five-part formative feedback for an AI judgement, competency ids and provenance, assessed_at. Never fails the answer (the `attempt-integrity.ts` pattern: failures other than "absent" write an audit row, codes only).
- **SQIE-07:** `provenanceOf` (pure) and `competencyProvenance` (store) pin, per competency, its content hash, framework id and framework version at answer time, on every snapshot written once 990 is present.
- **C-04 scenario:** each AI-judged stage keeps its five parts (`FeedbackParts`) in the attempt response (`response.formative.items[].parts`) and so in the snapshot. Earlier stages' parts travel inside the signed progress token (`scenario.ts signProgress`); if the token would pass 10500 characters the oldest stages' parts are dropped first (their summary stays), so the 12000-character token limit is never reached.
- **SQIE-04 rubric cap:** `rubric-snapshot.ts` keeps each key point and accepted answer up to 300 characters (was 160 and 120, below what `rubricOf` allows) and the full snapshot up to 6144 bytes (was 1500), inside the 791 16384-byte budget. The 416 response copy (7000-byte budget shared with the typed answer) falls back to the compact 1500-byte form, then to `{v, hash}`. In the 791 fit, the rubric is compacted before it is dropped. **Only a genuinely oversized guide** (more than 6144 bytes of key points, accepted answers and parts) is cut back, and only past the compact form to its hash; `rubric_hash` stays on the row in every case.

## Historical rows

No backfill. The 44 staging snapshots (and the 9 in production) keep `competency_provenance` null. No snapshot is rewritten (791 refuses every UPDATE).

## Not competence

A snapshot, its provenance and its feedback are the learner's private formative practice record: never verified competence, never a stage, never an assessment outcome or a Passport record. The provenance only says which competency text a practice question was mapped to.

## Known, out of scope

- The 791 correction guard derives `previous_outcome` from `correct`/`score` and would call an unmarked attempt "incorrect" if it were ever corrected. No correction surface exists for check attempts today; noted for a later migration if one is added.
