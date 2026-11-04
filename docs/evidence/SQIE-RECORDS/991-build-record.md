# Build record: migration 991 and branch `scholar/sqie-records` (SQIE-CLOSE-2026-11 WS-D, WS-I)

**Authority:** owner directive SQIE-CLOSE-2026-11 (4 Nov 2026) sections 3, 5 and 7; owner decisions 4 Nov 2026 item 3 (competency mapping: published framework version, competency and learning objective on learner attempts; draft mappings permitted but never represented as validated competency evidence; formative performance never becomes verified competence or a Benner stage). Tracker `docs/programme/SQIE-CLOSE-2026-11-TRACKER.md` (PR #269): WS-D (rank 3), WS-I (rank 8); rows SQIE-04, SQIE-07, SQIE-08, C-13. WS-H is NOT in this branch: it ships in the reconciliation session's own PR (`scholar/sqie-ws-h-quality-guards`, with WS-J), by coordinator decision.
**State of 991 (CLAUDE.md four states):** 2, applied and verified on staging (ezhvpgtcqcdsgylrxgdb) twice, rollback rehearsed. **Not applied to production.** When merged, `main` holds 990 and 991 while production does not. The code fails closed without either (below).

**Staging (ezhvpgtcqcdsgylrxgdb) holds exactly:** the 990 definitions of `990-individual-scholar-snapshot-completeness.sql` (sha256 `46a47483...eefcc5`, applied by session local_0e0244d2 after rolling back this branch's earlier 990), then 991 (sha256 `0873d2db...29533e`, applied twice here). The provenance CHECK on staging is 991's; the shape CHECK is 990's. VERIFY-990 and VERIFY-991 both pass on it.

## What this branch holds, and whose work it is

| Workstream | Source | Notes |
|---|---|---|
| WS-D attempt records, migration 990 | merged from `sqie/ws-d-attempt-record-01` @ `07d4fd00` (session local_0e0244d2) | Its build record, PRECHECK, VERIFY and ROLLBACK: `docs/evidence/SQIE-WS-D/`. 990 sha256 `46a474837293e95e27f417fb58cc1715c8a859444bd3fa2a3bebe0a793eefcc5` |
| WS-D owner decision 3, migration 991 | this branch | this record |
| WS-H quality guards | not in this branch | ships separately in `scholar/sqie-ws-h-quality-guards`. This branch's own first WS-H build was removed (one implementation only); its extra stage-pin test was handed to the coordinator as a note |
| WS-I unified per-question history | this branch | no migration, no new store |

This branch first built its own WS-D with a different 990 (sha `230b86a4...acb8986`, applied twice on staging and verified at about 13:05 EAT). When the stopped session's 990 was found, that one was adopted: it had since been applied on staging over this branch's (same constraint names, so staging holds its definitions), and this branch's 990 file, verify, rollback and provenance module were removed. Nothing of the dropped 990 remains on staging except the shared column name `competency_provenance`, which both define the same way (nullable jsonb).

## Migration 991

| File | sha256 | Depends on |
|---|---|---|
| `supabase/migrations/991-individual-scholar-snapshot-mapping-status.sql` | `0873d2db42dac572270f37ea6601327e31422bb5b6e33cfae5df57823129533e` | 990 (the provenance column and its CHECK). Application order: after 990 |
| `docs/evidence/SQIE-RECORDS/VERIFY-991.sql` | (in the PR) | 12 probe inserts, each rolled back |
| `docs/evidence/SQIE-RECORDS/ROLLBACK-991.sql` | (in the PR) | restores the 990 CHECK text exactly |

Number: 991 is within this session's claim (990-994, coordinator 4 Nov). The shared-notes claim file was updated.

What it changes: only `individual_scholar_attempt_snapshot_provenance_check`, recreated with two more OPTIONAL keys per element. `mapping_status`: `published` (the framework version was published when the answer was given, `frameworks.pub_status`), `draft` (publication pending: never validated evidence), or null (not readable). `objective`: the learning objective the question tested (its rubric objective), a string or null. Every 990 rule is kept (array as long as `competency_ids`, same ids in order, the four 990 keys in their forms, 4096 bytes, no other key). No row is written. Passes `scripts/migration-house-rules.ts` (ALL CLEAR).

Why a new migration rather than editing 990: 990 was already applied on staging at its recorded sha, and a migration file is not edited once it is shared (CLAUDE.md, fix forward).

### Staging evidence (4 Nov 2026)

- Pre-state: the 990 provenance CHECK present without `mapping_status`; 44 snapshots, 0 with provenance, 0 unmarked.
- Applied twice through the owner's runner (`run-staging-sql.mjs`): both `Done on ezhvpgtcqcdsgylrxgdb. Committed.`
- `VERIFY-991.sql`: Committed (PASS): the CHECK names `mapping_status`, `objective` and the 4096 budget; exactly two CHECKs on the table; the 990 shape CHECK in place; probes accepted: published with an objective, draft, null status, the four 990 keys alone, an objective, a null objective; probes refused: status `validated`, a numeric status, a numeric objective, a `stage` key, a misaligned id, a missing 990 key; no probe row kept.
- `VERIFY-990.sql` (the 990 session's) still passes after 991.
- Rollback rehearsed inside one transaction: `ROLLBACK-991.sql` then `VERIFY-991.sql` → `VERIFY-991: provenance check does not carry mapping_status, objective and the 4096 budget` → rolled back, nothing changed. `VERIFY-991.sql` then passed again (991 in place). This also shows VERIFY-991 fails when 991 is absent.
- `ROLLBACK-991.sql` refuses while any element carries `mapping_status` or `objective`.

### Fail closed without 991

`insertAttemptSnapshot` (store.ts): a snapshot whose provenance carries the 991 keys and is refused by the provenance CHECK (`23514`, `..._provenance_check`) is kept again with the four 990 keys only, and later snapshots are sent with those only. Any other refusal is not retried. Without 990 as well, the 990 fallback applies (a revision snapshot kept without provenance, a check snapshot not kept). Tests: `mapping-status.test.ts`.

## WS-I: one per-question history

- Readers in `store.ts` (owner-keyed): `questionAttemptRows` (950 `content_version` where present), `recentlyAnsweredQuestions`, `questionHeads`, `historySessions` (417 mode, and the 720 adaptive marker on the set), `historyCheckEvents` (950), `historyExamAnswers` (570 `revision_question_id`). With `attemptIntegrity` (791/990/991 snapshots and corrections). No new table.
- `question-history.ts` (pure): every attempt at one question, newest first, by source (practice, Revise session, adaptive exam, mock exam, Check your understanding) plus the exam-paper answers the question was made from; the effective result with the original beside a correction; the marking; what it was marked against (question version, content hash, guide hash, each competency's framework version with its mapping status, the objective) and notes where the live question or guide changed since. An attempt without a snapshot says so and invents no version. An unmarked check reads "Kept without a mark". A draft mapping always reads "draft mapping, publication pending: not validated competency evidence".
- `GET /api/individual/scholar/questions/[id]/history` and the page `study/saved/history` (linked from Saved learning, and from each kept check). Database reads only, no AI, no write.

## Staging walk (4 Nov 2026)

The HTTP walk (`records-walk.ts`, shared notes `SQIE-RECORDS/`) signs in as the fixture learner on a staging-pointed dev server and is then refused by the Individual guard: "Accept the terms for this experience before using it" (the fixture has not accepted the current Scholar terms). Accepting terms on an account was not done without the owner. The walk was therefore run on the same server code paths against the staging database as that learner (`records-walk-db.ts`, log `walk-db-run.log`): 16 PASS, 0 FAIL.

- (The walk's first three checks exercised WS-H code from the other branch while it was merged here; they are not evidence for this branch, which no longer holds WS-H.)
- WS-D: an unmarked and a self-graded check answer (`recordCheckAttempt` then `keepCheckSnapshot`, as `learn/checks` does) each keep a snapshot: unmarked marking and outcome with no score and the typed answer; self-graded with its question version and guide hash.
- WS-D 990/991: a real answer snapshotted with a real staging framework competency attached in memory (the question row unchanged): `{id, content_hash (32 hex), framework_id, framework_version "1.0.0", mapping_status "published", objective}`, matching the framework's `pub_status` (published).
- WS-I: a question answered in a mock exam and again in practice shows both sources, each with what it was marked against; the check question's history shows the new answers with snapshots and the older ones (kept before snapshots) each saying no record was kept; a question that is not the learner's gives no history.
- Not walked: the history page in a browser (the terms gate above). It is covered by typecheck and the pure tests of what it renders.

Staging rows written by the walk: check attempts and practice attempts of the fixture learner, with their snapshots. Nothing else.

## Not competence

A snapshot, its framework version, its mapping status and the history are the learner's own record of private practice. A published mapping is learning evidence only; a draft mapping is not validated evidence and says so. No stage table or mapping is read or written on this path (the WS-H branch carries the stage-boundary test).
