# Build record: migration 960 (SCHOLAR-CE07C)

**Authority:** owner directive LEARNING-CLOSE-2026-11 (4 Nov 2026), WS02 CE-07, Wave 1, acceptance 6.5.
**State (CLAUDE.md four states):** 2, applied and verified on staging (ezhvpgtcqcdsgylrxgdb) twice. **Not applied to
production.** When merged, `main` holds 960 while production does not; the code works without it (below).

## File, order, dependencies

| Migration | sha256 | Depends on |
|---|---|---|
| `960-individual-scholar-upload-record.sql` | `232c4e948f7215e4bdc7a041bd4fbf09b677c2d5438e00b08c55ad07b1fca917` | 372 (`profiles` FK pattern, the private bucket), 405/406 (the four formats), 413 (25 MB cap), all in production |

One new table `individual_scholar_upload` (RLS on, no policy: service role only), 4 CHECK constraints, 2 indexes, comments.
No change to any existing table, column, policy, bucket or function; no backfill. Passes `scripts/migration-house-rules.ts`
(ALL CLEAR, 90 lines, 17 statements).

## Staging evidence (4 Nov 2026)

- Pre-application state: no `individual_scholar_upload` table (the routes answered `isNotProvisioned`).
- Applied twice with the owner's runner (`run-staging-sql.mjs`, target ezhvpgtcqcdsgylrxgdb): both `Done ... Committed`.
- VERIFY (`verify-960.sql`, a DO block that raises on failure): table present, RLS on, no policy, 4 CHECKs; a bad type,
  an oversize row, `processing` without a start, `refused` without a status and a malformed sha256 are each refused.
  Result: `960 VERIFY PASSED`.
- Exercised by the staging walk (`staging-walk.md`): records issued, claimed, kept, refused, cancelled and abandoned.
- Rollback: `ROLLBACK-960.sql` (drops the table; the routes fall back to the behaviour without 960).

## Without 960 (production until the owner's GO)

`issueUpload`, `getUpload` and `claimUpload` answer `absent` on PGRST205/42P01 and the routes go on as before: the finish
is still idempotent by the material id (a retry after success gets the kept answer, and a colliding insert never deletes
the kept material's original), integrity is checked against the size and sha256 the client sends with the finish, uploads
still resume (TUS + the local resume record + a re-issued token for the same path), and each learner's next upload cleans
their own folder of objects older than 24 h. What 960 adds: the single-extraction claim under two concurrent finishes
(run G), the stored refusal answer for a retried finish (run F), the size/sha256 bound at the slot, server-side reuse of
an unfinished upload identity when the device lost its record, and the hourly global clean-up.

The without-960 path is established by reading the code (every 960 read and write goes through `isNotProvisioned`) and by
the unit decisions (`finishDecision(null)` = proceed); it was not walked against a database without 960.

## Production application (owner, separate GO)

Apply `960-individual-scholar-upload-record.sql` whole in the SQL editor after the recovery reference, then run
`verify-960.sql` (expects `960 VERIFY PASSED`). Rollback SQL above. No app redeploy is needed for 960 to take effect.
