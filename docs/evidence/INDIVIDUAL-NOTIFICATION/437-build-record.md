# Migration 437: notices in the person's own account (build record)

**Owner (25 October 2026):** "Use notifications in the user account, not Email". The coordinator relayed the scope:
- reuse an Individual-scoped own-row store if one exists;
- otherwise add a minimal staging-only migration.

**State:** APPLIED and verified on staging (`ezhvpgtcqcdsgylrxgdb`), run twice and idempotent, with the rollback rehearsed. See `437-staging-record.md`. Production needs a separate owner GO and is applied by the owner, by hand.

## Why a new table: no existing store fits

| Candidate | Why not |
|---|---|
| Estate `notifications` | Counted by type across every user on estate consoles. An Individual-only person has no inbox. ADR-016 D1 and owner ruling D1 rule it out. |
| 374 reminders and home renewals | Computed on read from the person's rows. There is no stored notice and no read state. |
| `audit_log` | Append-only, and read by estate consoles. It cannot hold `read_at`. |
| Passport | Records about the person, not notices to them. |

A refused CPD save is never stored, by the owner's rule, so its notice must be.

## What it adds

`individual_notification`:
- **Columns:** `id`, `user_id` (references profiles, on delete cascade), `kind`, `body`, `href`, `dedupe_key`, `created_at`, `read_at`.
- **CHECKs:**
  - `kind` is a code;
  - `body` is 1–400 characters;
  - `href` is null or a same-site path, never `//host`;
  - `dedupe_key` is 1–200 characters;
  - `read_at` is at or after `created_at`.
- **Unique `(user_id, kind, dedupe_key)`:** a double notice is impossible. It is a full index, not partial.
- **Guard trigger (plpgsql, APPLY WHOLE):**
  - only `read_at` may change, and only once;
  - direct DELETE is refused;
  - a cascade from `profiles` passes (the `pg_trigger_depth() > 1` allowance).
- **RLS on:** one policy, own-row SELECT. Writes are the service role only.
- **No scope column:** no hospital, organisation, tenant or workspace.

**Dependencies:** `profiles` only, and no other migration. Order-independent. Re-running it is a no-op.

## Files (LF, ASCII)

| File | sha256 |
|---|---|
| `supabase/migrations/437-individual-notification.sql` | see `437-staging-record.md` |
| `docs/evidence/INDIVIDUAL-NOTIFICATION/ROLLBACK-437.sql` | see `437-staging-record.md` |
| `docs/evidence/INDIVIDUAL-NOTIFICATION/VERIFY-437.sql` | see `437-staging-record.md` |

## Local proof (PG17, `cmp-ai410`, scratch database, dropped after)

- **Migration house rules:** ALL CLEAR. 103 lines, 30 statements, 5 constraints. The only warnings are the declared APPLY WHOLE constructs.
- **Applied twice:** the second run was a no-op.
- **VERIFY part A:** all true.
  - The table exists, with no scope column.
  - RLS is on.
  - The one policy is own-row SELECT.
  - The unique index and the guard trigger exist.
- **VERIFY part B:** all PASS, rolled back after.
  - A second notice with the same key is refused.
  - The body cannot change.
  - `read_at` can be set, and only once.
  - A direct delete is refused.
  - An off-site link is refused.
- **Cascade:** deleting the profile removes its notices.
- **RLS as `authenticated`:**
  - The person sees 1 of 2 rows, their own.
  - An update through the API role changes 0 rows, because there is no update policy.
- **Rollback, then re-apply:** both clean.

## The code that uses it

Committed on `prof/learning-integration` @ `004bf62e`.
- **Behind Learning's `learning_app` flag,** which is off by default.
- **If 437 is absent:** `postNotice` returns `unavailable` and the panel shows nothing. The CPD refusal and everything else still work.
- **No email is ever sent** for these notices.
