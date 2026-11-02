# Build record: migration 880 and CE-04 (SCHOLAR-CE-2026, Conversational clinical simulation)

**Authority:** owner GO 2 Nov 2026, programme SCHOLAR-CE-2026, workstream CE-04, gap-only on the existing case engine.
**State (CLAUDE.md four states):** 1, authored. Not applied anywhere. The migration file is kept out of version control until it has been applied and verified on staging. The code is merged-safe without it: Talk to the patient is behind the policy `scholar_case_conversation` (default OFF) and, with 880 absent, says "Conversation unavailable" with the reason while the case plays as before. The SBAR handover task needs no migration (a handover is kept as a written answer exactly as other written answers are).

## File, order, dependencies

| Migration | sha256 | Depends on |
|---|---|---|
| `880-individual-scholar-case-conversation.sql` | recorded in the hand-over report (the file is the source of truth) | 435/436 (`individual_scholar_case_session`), 423 (`case_library_session`) |

Application order: any time after 436. Independent of 810 (the snapshot builder reads the table when present). Passes `scripts/migration-house-rules.ts` (ALL CLEAR, APPLY WHOLE banner).

## Why a table (and not the attempt snapshot)

The 810 snapshot is written once at completion and never changed. A conversation happens during play, before there is a snapshot. 880 adds ONE append-only table, `individual_scholar_case_conversation`, for three entry kinds on one private or library session: `turn` (a question and the reply, at a stage), `communication_note` (at most one, after completion) and `handover_note` (at most one per handover decision). At completion the snapshot builder copies the turns and the handover note into the kept attempt record (bounded, labelled).

Guard: refuses UPDATE, refuses DELETE except through a cascade (`pg_trigger_depth() > 1`), checks the session is the learner's own, refuses a turn on a completed session or at a stage not reached, a second communication note, a second note on one decision, and a 401st turn (hard ceiling behind the per-stage policy cap). RLS on, read-own only, no grants.

## What is NOT a migration

`voice` (persona, style, what is known, key questions) and the `handover` spec live inside the blueprint JSON (`case-blueprint/1`, additive and optional), so they are approved with the exact version by the existing 422 content hash.

## Staging verification to run (owner)

1. Apply 880 on staging twice (second run a no-op). 2. As a learner with a session: insert a turn (ok), a turn on a completed session (refused), a turn at an unreached stage (refused), UPDATE (refused), DELETE directly (refused) and by deleting the session (cascades). 3. Second communication note refused. 4. Another learner's session refused. 5. `scripts/staging-seed-ce04-demo.ts --educator <uuid>` creates the synthetic draft; take it through staging review and publish, switch `scholar_case_conversation` ON, and play it with AI consent and an allowance.

## Rollback

`drop table if exists individual_scholar_case_conversation` then `drop function if exists public.individual_scholar_case_conversation_guard()`. It deletes learner practice conversations, so copy first.
