# Build record: migration 975 and branch `scholar/sale-r3-workspace` (SALE-2026-11 R3, rows SALE-11 and SALE-12)

**Authority:** owner directive SALE-2026-11 (4 Nov 2026) §8 (Intelligent My Plan and Personal Learning Library), §3 (reuse), §13 (governance and privacy), §14 (execution rules); owner GO to build R2-R5 in parallel before pilot use. Tracker `docs/programme/SALE-2026-11-TRACKER.md` rows SALE-11, SALE-12.
**State of 975 (CLAUDE.md four states):** 2, applied and verified on staging (`ezhvpgtcqcdsgylrxgdb`) twice, rollback rehearsed. **Not applied to production.** When merged, `main` holds 975 while production does not; every feature that needs it is behind keys that default OFF and fails closed without it (below).
**Number:** 975, inside the coordinator's R3 claim 975-979 (claim note `SALE-R3-migration-number-claim.md` in the shared notes). 976-979 unused.

## Migration 975

| File | sha256 | Depends on |
|---|---|---|
| `supabase/migrations/975-scholar-learning-workspace.sql` | `b297f83a4af1bf51b5a77898a3fc8cac4251b85b2458ab8d06107460a5465080` | 820 (the note table and its kind CHECK), 840 (the plan event table and its CHECK). Application order: any time after 820 and 840 |
| `docs/evidence/SALE-R3/VERIFY-975.sql` | `e59ee85ab6de8980b96a993c631b02e352810e41e55399aaea7ea5e84e6d07e3` | staging only: 16 probe inserts, each undone |
| `docs/evidence/SALE-R3/VERIFY-975-prod.sql` | (in the PR) | structure only: catalogue reads, no learner row, no write. For the owner after a production GO |
| `docs/evidence/SALE-R3/ROLLBACK-975.sql` | (in the PR) | restores the 840 and 820 CHECK texts exactly and drops the marker |
| `docs/evidence/SALE-R3/PRECHECK-975.sql` | `ed024ac7b895e8def8ab163efdd7cedcb8bb7dec36adfd997c7bfe72b02761d5` | read only: the two CHECK definitions (md5), the marker, row counts |

What it changes (additive only, no table, no column, no row):
1. `individual_learning_plan_event_check` re-added with one more kind, `next_action` (every 840 kind, status, ref length and 8000-byte value budget unchanged).
2. `individual_scholar_note_kind_check` re-added with one more kind, `summary` (body 1-4000 characters, no quote; the note, bookmark and highlight rules unchanged).
3. `individual_scholar_workspace_975()`: returns true; SQL, stable, SECURITY INVOKER, execute for `service_role` only. A widened CHECK cannot be seen by a select, so the app asks this once (`store.workspaceSchema`).
RLS and grants on both tables unchanged. House rules: ALL CLEAR (2 warnings, the APPLY WHOLE constructs).

Why a migration: accept / snooze / dismiss must each be recorded (owner brief), and a personal summary is a different record from a note (SALE-12, CE-02-1 "notes on a topic need a schema decision"). Reusing `recommendation_declined` for an acceptance, or a note for a summary, would record something untrue. Both are the smallest widening of an existing CHECK; no new table.

### Staging evidence (4 Nov 2026, `scripts/run-staging-file.local.ts`: one file whole, one transaction, refuses production by `production-guard.judgeDbTarget`)

| Step | Result |
|---|---|
| PRECHECK before (15:57Z) | plan-event CHECK md5 `dd4ee8df…b38a7` (no next_action), note kind CHECK md5 `656f1a71…a01a1d0` (no summary), no marker; 6 plan events, 6 notes |
| VERIFY-975 before 975 | **red**: "the 840 event CHECK does not carry next_action…" (the control can fail) |
| 975 applied twice | 15:58:05Z and 15:58:11Z, `Done on ezhvpgtcqcdsgylrxgdb. Committed.` both times, same sha256 |
| VERIFY-975 | Committed (PASS): both CHECK texts, exactly one CHECK on the event table and two on the note table, the marker (invoker, service_role only, returns true), RLS on both; probes accepted: next_action accepted / deferred / declined, an 840 proposal, a summary, a note, a bookmark, a highlight; probes refused: an unknown kind (each table), a status `snoozed`, an array value, a 201-character ref, an empty summary, a summary with a quote, a 4001-character summary; no probe row kept |
| PRECHECK after | both CHECKs carry the new kind (md5 `2cb8e93d…`, `690fba71…`), marker true; still 6 events, 6 notes |
| ROLLBACK-975 rehearsal (one transaction, rolled back) | restored both CHECK definitions to the exact pre-state md5s and removed the marker; then VERIFY-975 in the same rehearsal **red**; staging unchanged afterwards (VERIFY-975 passed again) |
| VERIFY-975-prod on staging | passes |

ROLLBACK-975 refuses while any `next_action` event or `summary` note exists.

### Fail closed without 975
- `workspaceSchema` is false (the marker RPC is missing): the Today card is read only and says so (no Add / Later / Dismiss), `POST plan/next-action` answers 409, no summary form is offered, and `POST library/notes` with kind `summary` answers 409.
- Keys off (the default): no card, no Notebook view (`?view=notebook` falls back to Recently studied), summary posts 403.

## Staging configuration for the walk
`docs/evidence/SALE-R3/staging-config.sql` published `scholar_next_best_action` and `scholar_active_notebook` ON in staging HQ policy. Production keeps the code defaults (OFF) until the owner publishes them.

## Staging walk
See `walk/` (script, log, screenshots) and the PR body.
