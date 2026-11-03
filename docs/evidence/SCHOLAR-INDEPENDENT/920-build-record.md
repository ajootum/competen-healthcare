# Build record: migration 920 (SCHOLAR-INDEPENDENT-LEARNING-01)

**Authority:** owner instruction 3 Nov 2026, "Competen Scholar, AI-independent, AI-enhanced learning engine" (P0: record progress without AI).
**State (CLAUDE.md four states):** 2, applied and verified on staging (ezhvpgtcqcdsgylrxgdb) twice. **Not applied to production.** When merged, `main` holds 920 while production does not; the code fails closed without it (below).

## File, order, dependencies

| Migration | sha256 | Depends on |
|---|---|---|
| `920-individual-scholar-learning-event-read.sql` | `9f0eb878d8835ba1a12806bcafd1e2822ddf39588cf12f9cb50f5709be865d4c` | 414 (`individual_scholar_learning_event` and its action CHECK) |

One file, no table, no column, no row written, no backfill: it drops and re-adds `individual_scholar_learning_event_action_check` with `'read'` added to the 414 action list (the verdict rule unchanged). Passes `scripts/migration-house-rules.ts` (ALL CLEAR; warnings only for apostrophes inside comments).

## Staging evidence (3 Nov 2026)

- Applied twice through the owner's runner (`run-staging-sql.mjs`, target ezhvpgtcqcdsgylrxgdb): both `Done ... Committed`.
- VERIFY (`verify-920-strict.sql`, a DO block that raises on failure): the constraint is present, its definition allows `'read'`, the 414 actions (`resume`, `clarify`) are still allowed, and the table carries exactly one CHECK constraint. Passed after the second application.
- Rollback: `ROLLBACK-920.sql` restores the 414 list and refuses while any `read` event row exists.
- Route-level walk against this branch's staging dev server (16/16): `PATCH sessions/[id] { move: "read", at }` answers `{ ok: true, recorded: true }`; the session's progress then carries action `read` for that lesson; `current_step` is untouched; a second device reads the exact place inside the original text (`lesson-1:s11`, offset 42) written by the first.

## Fail closed without it

While 920 is absent the store's insert is refused by the 414 CHECK (SQLSTATE 23514), `recordLearningEvent` answers `failed`, the route answers `{ ok: true, recorded: false }`, and the Learn page keeps the mark as a live activity on the device and in the 790 position (`lastCompletedActivity: marked:<step>`), saying "Marked on this device. It could not be recorded in your learning history just now."

## Not competence

A read mark is the learner's own statement that they read the lesson's original sections. It is a learning record for the learner, never assessment evidence, never verified competence and never a Passport record.
