# COMPETEN-OPS-001 — Production database recovery: requirements and recommended configuration

| | |
|---|---|
| **Status** | Requirements of record. **Production schema freeze in force** until §5 is met (owner ruling, 2026-10-22). |
| **Scope** | The production Supabase project `rnnqhlrcgvsauigxwszl` (Competen Platform, Practice, Enterprise, Individual). |
| **Not covered** | Application rollback, which is a Vercel concern and already has a verified path. See `COMPETEN-WEB-IND-001-website-redesign.md` §3a. |

## 1. Current state (verified 2026-10-22)

- **No backups and no point-in-time recovery.** Production is on the Supabase Free plan, which has no scheduled backups and no PITR (`COMPETEN-AI-LOG-001-BUILD-RECORD.md` §3). Nothing can restore the database if a migration, a defective write path or an operator error damages data.
- **Patient-identifiable clinical data is stored here** (Practice: patients, encounters, appointments), as well as staff competency records and Passport evidence. A loss is unrecoverable.
- **There is no applied-migration ledger.** Migrations are applied by hand in the SQL editor (`CLAUDE.md`, Database), and nothing in the database records which files have run. Production's state is therefore inferred from marker objects.
  - Example: AI-LOG-001 confirmed that 368's marker exists, but 369 (`369-activate-priced-plan.sql`) was not checked.
  - 370 is **not** applied (on HOLD).
  - 371 **is** applied and verified.
- **Staging** (`ezhvpgtcqcdsgylrxgdb`) was paused and unreachable on 2026-10-22 until the owner restored it. It is also missing migrations 361–369 (IND-003 record). Staging therefore cannot yet stand in for production state.

## 2. Requirements

| # | Requirement | Why |
|---|---|---|
| R1 | **Automated backups** of production, retained for at least 7 days | Recover from loss or corruption discovered within a week |
| R2 | **Point-in-time recovery**, given the clinical data | Recover to just before a bad migration or write, not merely to last night |
| R3 | **An independent copy outside Supabase**: a scheduled logical dump to encrypted storage the owner controls | Recover if the provider account or project itself is lost |
| R4 | **A tested restore**: a backup restored into a *separate* project and verified (row counts and fingerprints, as in AI-LOG-001 §3), with the restore time recorded | A backup that has never been restored is not a recovery mechanism |
| R5 | **A pre-migration gate** for every production schema change: confirm a backup is newer than 24 hours (or PITR is active), record a recovery reference and write rollback SQL before applying | Makes each change reversible by procedure, as 371 was |
| R6 | **A migration ledger** recording which numbered files are applied, when and by whom | Removes the guesswork in §1. A separate design decision, not a drive-by migration |
| R7 | **Restore authority and runbook**: who may trigger a restore, the steps and the notification path | A restore under pressure must not be improvised |
| R8 | **Staging kept awake and current** (no auto-pause; migrations 361–369 applied) | Every production change must be rehearsed somewhere that actually matches |

## 3. Recommended configuration

1. **Move the production project to a paid Supabase plan that includes daily backups** (R1). Confirm the retention period in Dashboard → Database → Backups once it's active.
2. **Enable the PITR add-on** with at least 7 days of retention (R2). Check Supabase's current requirements, such as plan and compute size, at the time of purchase. This document deliberately records no prices.
3. **Add an owner-run scheduled logical backup** (R3): `pg_dump` of schema and data to encrypted storage outside Supabase, with a retention policy. The database URL used for it is a production credential. Keep it in an owner-controlled secret store and never in the repository or in CI logs.
4. **Run a restore drill** (R4) into a new, separate Supabase project. Never overwrite staging or production. Record what was restored, the verification queries and results, and the elapsed time.
5. **Adopt the R5 gate** as a checklist step in every migration's build record, using the format AI-LOG-001 §3 established: row counts, fingerprint, schema snapshot, rollback SQL.
6. **Turn off auto-pause** for staging, or move it to a plan that doesn't pause, and apply 361–369 there (R8).
7. **Decide R6** (the ledger format) as a separate owner decision. Until then, record every application in the migration's build record.

## 4. Changes blocked by the freeze

- **Migration 370** on production (COMPETEN-IND-003, PR #5). It is already on HOLD pending a separate GO.
- Any other production DDL or bulk data change.
- **Not blocked:** application deploys that change no schema, read-only production queries authorised by the owner, and staging work.

## 5. Conditions to lift the freeze (owner sign-off required)

- [ ] Backups are visible and current in the production dashboard (R1), and PITR is active (R2), or the owner records an accepted alternative.
- [ ] One restore drill is completed and documented (R4).
- [ ] The R5 gate is adopted. The first gated change can be 370, under its own GO.
- [ ] The owner records the sign-off date in this document.
