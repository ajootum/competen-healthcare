# Build record: migration 880 and CE-04 (SCHOLAR-CE-2026, Conversational clinical simulation)

**Authority:** owner GO 2 Nov 2026, programme SCHOLAR-CE-2026, workstream CE-04, gap-only on the existing case engine.
**State (CLAUDE.md four states):** 2, applied and verified on STAGING (project ezhvpgtcqcdsgylrxgdb) 2 Nov 2026 and left applied there. **Not applied to production** (needs a separate owner GO with the OPS-001 safeguards). The file is committed on this branch because it passed staging. Checksum recorded at staging: `df966c11ad8fb293ef6d258b878a18d049a90029eff6a7e21eb2f37dd2f2450f` (matches the file in this commit). Package, VERIFY, ROLLBACK and the full staging record: `RELEASE-2026-10-25/PENDING-38/`. Staging result: pre-state no table and no sessions, apply twice OK (second a no-op), `RESULT VERIFY 880 pass=46 fail=0 pend=0`, ROLLBACK OK (refuses while rows exist, proven), re-apply OK, VERIFY again 46/0. The code is safe on `main` before production has 880: Talk to the patient is behind the policy `scholar_case_conversation` (default OFF) and, with 880 absent, says "Conversation unavailable" with the reason while the case plays as before. The SBAR handover task needs no migration (a handover is kept as a written answer exactly as other written answers are).

## File, order, dependencies

| Migration | sha256 | Depends on |
|---|---|---|
| `880-individual-scholar-case-conversation.sql` | `df966c11ad8fb293ef6d258b878a18d049a90029eff6a7e21eb2f37dd2f2450f` | 435/436 (`individual_scholar_case_session`), 423 (`case_library_session`) |

Application order: any time after 436. Independent of 810 (the snapshot builder reads the table when present). Passes `scripts/migration-house-rules.ts` (ALL CLEAR, APPLY WHOLE banner, two functions).

## Why a table (and not the attempt snapshot)

The 810 snapshot is written once at completion and never changed. A conversation happens during play, before there is a snapshot. 880 adds ONE append-only table, `individual_scholar_case_conversation`, for three entry kinds on one private or library session: `turn` (a question and the reply, at a stage), `communication_note` (at most one, after completion) and `handover_note` (at most one per handover decision). At completion the snapshot builder copies the turns and the handover note into the kept attempt record (bounded, labelled).

Guard: refuses UPDATE, refuses DELETE except through a cascade (`pg_trigger_depth() > 1`), checks the session is the learner's own, refuses a turn on a completed session or at a stage not reached, a second communication note, a second note on one decision, and a 401st turn (hard ceiling behind the per-stage policy cap). RLS on, read-own only, no grants.

## What is NOT a migration

`voice` (persona, style, what is known, key questions) and the `handover` spec live inside the blueprint JSON (`case-blueprint/1`, additive and optional), so they are approved with the exact version by the existing 422 content hash.

## Staging verification (done 2 Nov 2026, see the State line, the steps below are what VERIFY-880.sql automates)

1. Apply 880 on staging twice (second run a no-op). 2. As a learner with a session: insert a turn (ok), a turn on a completed session (refused), a turn at an unreached stage (refused), UPDATE (refused), DELETE directly (refused) and by deleting the session (cascades). 3. Second communication note refused. 4. Another learner's session refused. 5. `scripts/staging-seed-ce04-demo.ts --educator <uuid>` creates the synthetic draft; take it through staging review and publish, switch `scholar_case_conversation` ON, and play it with AI consent and an allowance.

## Owner ruling 2 Nov 2026: the D10 exception (ADR-016)

Turns are assessment evidence of one case attempt, not Personal AI memory. The nine conditions and where each is met are recorded in `docs/adr/ADR-016-individual-product-gate.md` ("D10 exception"). Added to 880 for the ruling: `individual_scholar_case_conversation_erase(p_user uuid)` (security definer, server role only), a transaction-local flag the guard honours, so the Scholar erase-all can remove library-play conversations, whose sessions are not material and so are reached by no cascade.

### SQL plan for the staging check of cascade and erase (condition 3 and 4)

1. As the service role, with a private session S1 (learner A) at stage s1 and a library session L1 (learner A): insert a `turn` on each (ok). Insert a `turn` on a stage the session has not reached (refused). `update` a row (refused). `delete from individual_scholar_case_conversation where id = ...` directly (refused: "never deleted").
2. `delete from individual_scholar_case_session where id = S1` then `select count(*) from individual_scholar_case_conversation where private_session_id = S1` is 0 (cascade, guard allows depth above 1). Repeat for `case_library_session` L1 (library cascade).
3. Insert fresh turns for learner A on a session and for learner B on another. `select public.individual_scholar_case_conversation_erase('<A>')` returns A's count, B's rows remain.
4. As `authenticated` or `anon`: `select public.individual_scholar_case_conversation_erase('<A>')` is refused (no execute grant). Run the whole file twice (second run a no-op).
5. Via the app: the learner's Settings, Erase all my study material, with a library play that has turns: the library turns are gone, and the audit row is written.

## Rollback

`drop table if exists individual_scholar_case_conversation` then `drop function if exists public.individual_scholar_case_conversation_guard()` and `drop function if exists public.individual_scholar_case_conversation_erase(uuid)`. It deletes learner practice conversations, so copy first.
