# Migration file inventory and forward-only normalization point

COMP-SECURITY-SURVEY-001 §8 item 9. Owner instruction, 2026-08-19: *"don't rename historical migration
files blindly if they may already have been applied… The goal is deterministic migration history, not
aesthetically perfect filenames at the cost of corrupting migration state."*

Read-only inventory, 2026-08-19. **No file was renamed, moved or deleted.**

## The headline is better than the survey implied

`supabase/migrations/` holds **329 files, all numbered, with no duplicate numbers.** The problem is not
in the migration directory at all — it is **26 loose `.sql` files sitting one level up in `supabase/`**.

## ⚠ There is no applied-migration ledger, and the check for one is itself a trap

Migrations here are applied by hand in the Supabase SQL editor, so nothing records what ran. A first
probe appeared to find four ledger tables — `schema_migrations`, `supabase_migrations`, `migrations`,
**and `_migrations`** — all reporting "EXISTS, null rows".

All four "existing" is implausible; nobody names a table `_migrations` *and* `migrations`. This is the
**PostgREST head+count missing-table trap** already recorded in this repo: a `select("*", {head: true,
count: "exact"})` against a table that does not exist returns no error and a null count, which reads
identically to an empty table. **The probe was measuring nothing.**

So: **"applied to production?" cannot be answered from the repository, and cannot be answered by asking
PostgREST either.** It is owner knowledge. Every disposition below is therefore written to be safe
*without* that answer.

## The 26 loose files

### A. `RUN-ME-*` — 17 files, all with a numbered twin. **Not divergent DDL.**

| Class | Count | Finding |
|---|---|---|
| Byte-identical to their numbered twin | 6 | `052`–`057`. Pure duplicates. |
| Differ by **header prose only** | 9 | `043`–`051`. Diffed: the loose file says `-- RUN ME: … Paste all into the Supabase SQL editor, Run.`, the numbered one carries the fuller explanatory header. **The DDL is the same.** |
| Deliberate multi-migration **bundles** | 2 | `RUN-ME-012-to-018-combined.sql` (763 lines vs 118), `RUN-ME-040-to-042-platform.sql` (350 vs 59). Bigger because they bundle a range, not because they disagree. |

**These were paste-convenience copies, not a second lineage.** Whichever was actually run, the schema
outcome is the same — which is why 329 numbered migrations can be trusted as the history even though
nothing recorded the run.

### B. Untwinned — 9 files. **This is where the real risk is.**

| File | What it is | Disposition |
|---|---|---|
| `schema.sql` | a dump/reference | Keep, clearly label as non-executable reference |
| `seed-cst-demo.sql`, `seed-demo-ckcm.sql`, `seed-questions.sql` | demo/seed data | Keep, move to `supabase/seeds/` — they are not migrations and should not read as history |
| `fix-profile.sql` (32 ln) | `create policy` on profiles | ⚠ **Unnumbered schema change** |
| `fix-rls-recursion.sql` (76 ln) | drops + recreates several policies | ⚠ **Unnumbered schema change** |
| `fix-super-admin-rls-recursion.sql` (25 ln) | drops `"Super admin reads all profiles"`, `"Users see own profile"`, recreates | ⚠ **Unnumbered schema change — this is the §0.1b policy the survey referred to** |
| `rls-updates.sql` (82 ln) | `create policy` | ⚠ **Unnumbered schema change** |
| `reset.sql` (16 ln) | `drop table … cascade` × N (competencies, courses, cpd_logs, enrolments…) | ⚠⚠ **DESTRUCTIVE, loose, and named like a convenience** |

The four `fix-*` / `rls-updates` files are the genuine problem: **policy changes with no number, no
ordering, and no record of whether they ran.** A future schema audit that reads only
`supabase/migrations/` will conclude the RLS posture is one thing while production may be another.

⚠ **`reset.sql` deserves separate attention.** Sixteen lines of `drop table … cascade` with a name that
invites being run. It is not a migration and should not sit beside them.

## The forward-only normalization point

**Nothing historical is renamed.** The line is drawn at today, and everything after it is deterministic:

1. **Freeze the past.** `supabase/migrations/*.sql` (329 files, numbered, no duplicates) **is** the
   history of record from here. It is not re-derived, re-ordered or renumbered.
2. **Delete nothing until the owner confirms application.** The 6 byte-identical `RUN-ME` duplicates are
   the only files that can be removed with no information loss whatever the answer — they are identical
   to their twins by checksum.
3. **Number the four unnumbered schema changes forward, do not backfill them.** Rather than inserting
   them into history at the point they were probably run, capture their *current intended state* as new
   numbered migrations written idempotently (`drop policy if exists` → `create policy`), so applying them
   is safe whether or not the original ran. **That is the whole value of forward-only**: it needs no
   answer to "was it applied?".
4. **Move `seed-*` to `supabase/seeds/` and `reset.sql` out of `supabase/` entirely** (or delete it) —
   both are miscategorised rather than mis-numbered.
5. **From this point, one rule:** a schema change is a numbered file in `supabase/migrations/`, and
   nothing else is. `scripts/migration-house-rules.ts` already gates content; this gates *location*.

## What still needs the owner

- **Confirm the 6 identical duplicates can be deleted** (zero risk — checksums match).
- **Confirm the four `fix-*`/`rls-updates` policies are the current intended RLS state** before they are
  re-expressed forward. If any were superseded, re-applying them would *restore* a policy someone
  removed on purpose — the one way this could do harm.
- **Decide `reset.sql`'s fate.** Recommendation: delete. A destructive script whose name reads as routine
  is a hazard, and it is reproducible from `schema.sql` if ever needed.

**None of the above is executed.** This is the inventory the instruction asked for first.
