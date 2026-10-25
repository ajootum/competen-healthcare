# Migration 437: staging record (25 October 2026)

**Target:** staging `ezhvpgtcqcdsgylrxgdb`.
- Applied by the coordinator with the guarded runner, the file applied whole.
- The applied file is LF, sha256 `201418bfeda83c4e646f7c8022f5a71e9f9ff8719998bf86763d52fd6cd83ac4`.

**State:** APPLIED and verified on staging. Production needs its own owner GO and is applied by the owner, by hand.

## Fingerprint

The fingerprint covers `individual_notification`: columns, constraints, indexes, policies, triggers, the md5 of the guard function, and RLS.

| Step | Fingerprint | Items |
|---|---|---|
| PRE | null (absent) | 0 |
| apply #1 | `fc5e86fafbea189370561863d36f70d1` | 22 |
| apply #2 | `fc5e86fa…` (idempotent) | 22 |
| ROLLBACK-437 | absent, = PRE | 0 |
| re-apply | `fc5e86fa…`, = apply #1 | 22 |

## VERIFY-437

- **Part A** (read-only), all true:
  - the table exists, with no scope column;
  - RLS is on;
  - own-row select is the only policy;
  - the once-only unique index and the guard trigger exist.
- **Part B** (its own transaction, ending in ROLLBACK), all 6 PASS:
  - a duplicate key is refused;
  - the body is immutable;
  - `read_at` can be set, and only once;
  - a direct delete is refused;
  - an off-site link is refused.
- 0 rows remain after part B.

## Files (LF, sha256)

| File | sha256 |
|---|---|
| `supabase/migrations/437-individual-notification.sql` | `201418bfeda83c4e646f7c8022f5a71e9f9ff8719998bf86763d52fd6cd83ac4` |
| `docs/evidence/INDIVIDUAL-NOTIFICATION/ROLLBACK-437.sql` | `613256253823442bbc05a78bd9755268797d07656a2af344d9bda185cb532c67` |
| `docs/evidence/INDIVIDUAL-NOTIFICATION/VERIFY-437.sql` | `b6aa5bc99abbe63d72d42f6e06672bc5b9872cf764ff15c3de10683bd7010886` |

**Order and dependencies:** it depends on `profiles` only, and is independent of every other migration.

**Production:**
- Not applied.
- `main` may hold this file before production does.
- The code that uses it stays behind Learning's `learning_app` flag, which is off by default.
- If the table is absent, it fails closed: no notice is posted, and the panel shows nothing.
