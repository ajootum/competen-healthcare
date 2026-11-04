# Build record: migration 970 (SALE-2026-11 R2, SALE-10 transfer-check record)

**Authority:** owner directive SALE-2026-11 §7.3 (4 Nov 2026), owner GO to build R2-R5 in parallel. Number 970 claimed in `SALE-R2-migration-number-claim.md` (block 970-974 assigned to R2; 971-974 unused).
**State (CLAUDE.md four states):** 2, applied and verified on staging (ezhvpgtcqcdsgylrxgdb) twice, rollback rehearsed, re-applied. **Not applied to production.** When merged, `main` holds 970 while production does not; the code fails closed without it (below).

## Files

| File | sha256 |
|---|---|
| `supabase/migrations/970-individual-scholar-transfer-check.sql` | `31f0a1807c69b68d5d441edd9a996709505abf6e8ac46527b13a7a7d44d7e4e6` |
| `docs/evidence/SALE-R2/PRECHECK-970.sql` (read only) | `ec236fc876abcf54082b261598f85af82fe2c9b03f91b95ee5394cb3d9b8c3dc` |
| `docs/evidence/SALE-R2/VERIFY-970.sql` (staging: structure + probes) | `c115fb5f25b28d99f3556f0b0300536514e8f45d609dff63fcc2bf0d2a1a44d8` |
| `docs/evidence/SALE-R2/VERIFY-970-prod.sql` (structure only: no DML, no ALTER) | `03aba1dec424d955b117db4fc54b4df12dc4f8a69a67439609225ba63570c33d` |
| `docs/evidence/SALE-R2/ROLLBACK-970.sql` | `af59e58a8d739ab529a703ef29c36eaaafae7b1b3dc3c7663eb41bc43bc1cc01` |

`scripts/migration-house-rules.ts`: ALL CLEAR (77 lines, 10 statements, 1 constraint, 0 warnings).

## What it changes (one new table, no existing table altered, no row written, no backfill)

`individual_scholar_transfer_check`: one row per question of a revision session asked as a transfer check: `user_id`, `revision_session_id`, `question_id`, `topic` (2-120 chars, trimmed), `outside` (library / other_material / other_section / new_question), `source` (saved / library / generated), `context_chunk_ids` (the sections where the topic was taught, at most 200), `created_at`.
- **Unrepresentable wrong state:** foreign key `(revision_session_id, user_id)` onto the 417 owner-scoped session identity, and `(revision_session_id, question_id)` onto the 417 session item. A row for a question that is not in that learner's own session cannot be stored. Unique per session and question.
- **Own rows only:** RLS on, one read-own policy (the 417 pattern). Writes are server-side (service role).
- **Deletion:** cascades from the session, its item (so its question and material), and the learner (profiles). Nothing references the table.
- **Why a table:** no existing structure can say why a revision session was asked (its mode CHECK is closed, and the 416 attempt carries no session purpose). Retrieval scheduling (SALE-08) and prerequisite suggestions (SALE-09) need no migration: derived each time.

**Depends on:** 372 (`individual_scholar_question`), 416, 417 (`individual_scholar_revision_session`, `_item`, the `(id, user_id)` and `(session_id, question_id)` unique indexes). All in production. Independent of 990-998. Application order: after 960, any time.

## Staging evidence (4 Nov 2026, ~18:50 local)

- **PRECHECK before:** `table=false | session_table=true | session_id_user_ux=true | session_item_question_ux=true | attempt_session_col=true | sessions=37 | session_items=158 | rows=n/a`.
- **970 applied twice** through the owner runner (`run-staging-sql.mjs`, target ezhvpgtcqcdsgylrxgdb): both `Done ... Committed`. **VERIFY-970 passed after each.**
- **PRECHECK after:** `table=true | ... | rows=0`.
- **VERIFY-970** (DO block, raises on the first failure): exactly the nine columns, required columns NOT NULL, the shape CHECK text, both 417 foreign keys present and cascading, the owner key cascading, the unique index, RLS on with exactly the read-own policy; then ten behaviour probes on a real session item, each rolled back: accepted = a valid row; refused = the same question twice, a question not in the session, another owner, a bad `outside`, a bad `source`, a one-character topic, an untrimmed topic, a 121-character topic, 201 context sections. No probe row kept.
- **Rollback rehearsed:** `ROLLBACK-970.sql` Committed; `VERIFY-970` then **failed as it must** (`VERIFY-970: table missing`); 970 re-applied, `VERIFY-970` passed, and **`VERIFY-970-prod.sql` passed on staging** (structure only).

## Rollback

`ROLLBACK-970.sql` drops the table (its policy goes with it). The transfer answers stay as ordinary attempts of their revision sessions; the learning state then counts them as ordinary practice. Run only on an owner decision.

## Fail closed without it (production today)

- `scholar_transfer_checks` defaults **off**; with it off nothing reads or writes the table.
- With it on and 970 absent: the transfer route answers 503 "Transfer checks are not available yet" before making anything (it probes the table first); the Revise panel and the learning state offer no transfer check (`transferRead` false); the learning state reads no transfer evidence and is otherwise unchanged.

## Production (needs a separate owner GO)

Apply `970-individual-scholar-transfer-check.sql` whole in the SQL editor, then run `VERIFY-970-prod.sql` (structure only; prints `VERIFY-970 PASS (structure)`). No data change, no backfill. The checksum above must match the file applied.
