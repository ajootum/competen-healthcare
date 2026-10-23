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

---

# Revision 1 (owner direction, 2026-10-23): proportionate, automation-first recovery

**Owner direction:** Competen is in development and does not yet process real patient information. Remove manual backup requirements from routine development. Use automated backups on existing infrastructure and the local Windows PC, with no paid services. **The production schema freeze stays until automated backup and an isolated restore are verified on production.**

This revision supersedes R1, R2 and R5 above, along with the §3 recommendations to buy a paid plan and PITR. R3, R4, R6, R7 and R8 stand.

## 6. Backup automation (built; production run pending the owner's credential)

Scripts are in `ops/backup/` and installed at `C:\Users\elish\CompetenBackup\bin`.

| Aspect | Implementation |
|---|---|
| **Schedule** | Windows Task Scheduler task "Competen DB backup", daily at 20:30 in the owner's session. A missed run starts at the next logon (`StartWhenAvailable`). Docker Desktop is started if needed. |
| **Method** | `pg_dump -Fc` of the whole production database through the session pooler (`aws-0-eu-west-1`), inside a `postgres:17` container. |
| **Encryption** | Piped straight into `gpg` AES-256 in the same container, so the plaintext dump never touches the host disk. |
| **Secrets** | The archive key and the production database password are DPAPI-encrypted for the owner's Windows account, in `CompetenBackup\secure` (owner-only ACL). Containers receive them as environment variables passed by name only, never as arguments. Nothing is in the repository, chat or logs. The owner sets the password with `set-production-credential.ps1`, which tests the connection before saving. |
| **Key recovery** | `competen-db-backup.ps1 -ExportRecoveryKey` writes the archive key to the BitLocker SSD. The owner keeps a second copy in a password manager. If the key goes missing while archives exist, the job refuses to create a new one. |
| **Retention** | **7 daily + 4 weekly.** The newest backup of each of the 7 most recent days that have one, plus the newest of each of the 4 most recent ISO weeks. A long outage never empties the folder. |
| **Off-PC copy** | To `I:\Backups\competen-db` (BitLocker SSD) whenever it is connected, with the same retention there. |
| **Integrity, every run** | gpg MDC on decrypt (tamper-evident), plus a full `pg_restore --list`. The public table-data count must be above 0 and at least 90% of the previous run's. sha256, size, server version and counts go in a per-archive manifest. |
| **Reporting** | A failure raises a Windows notification and is written to the log and `status.json`. The "Competen backup watch" task (at logon and 12:00) reports a missed backup (more than 26 h), a failed backup, no off-PC copy for 7 days, or a failed project-files backup. |
| **Isolated restore test** | `competen-restore-test.ps1`: decrypts into a scratch Docker volume, restores into a fresh database on a `supabase/postgres:17.6` container with **no network**, and checks **every table's row count** against the archive. It then cross-checks catalog facts against the live source (read-only counts and a schema fingerprint). The container and volume are removed afterwards, and the evidence is `result.json`. |
| **Project files** | The existing daily robocopy of `Documents\Competen` (repositories including `.git`) to the BitLocker SSD, independent of GitHub. The watch task now reports when it fails. |

**Not covered (recorded):**
- Storage bucket objects (uploaded files). A database restore can return rows whose original file is gone.
- Recovery point: up to 24 hours.
- The off-PC copy depends on the SSD being connected.

## 7. Verification evidence

| Check | Result |
|---|---|
| Staging rehearsal backup (2026-10-23) | 4.2 MB encrypted archive in 300 s. 7,798 TOC entries; data for all 685 public tables; 332 policies. |
| Encrypted at rest | The archive starts with a gpg symmetric packet (`8c 0d`), not `PGDMP`. |
| Tamper detection | One flipped byte gives "encrypted message has been manipulated", and the run fails. |
| Retention | 40 simulated days keep exactly 7 daily + the weekly set (9 files). |
| Isolated restore, staging | **PASS** (`docs/evidence/COMPETEN-OPS-001/staging-restore-test-2026-10-23.json`). 723/723 tables match the archive row for row; 0 restore errors; 28 s restore, 65 s end to end. Live cross-check: tables, RLS tables, policies, functions, auth users and the schema fingerprint all match. Nothing is left behind. |
| Run as the scheduled task (outside the app) | Backup and restore **PASS**. A failed production run (no credential yet) raised the notification and logged the cause. |
| **Production backup + restore** | **PENDING.** It needs the owner to run `set-production-credential.ps1` once. |

## 8. Migration governance by risk

| Tier | Definition | Gate before applying to production |
|---|---|---|
| **Low** | Additive and non-destructive: new tables, views, indexes or private buckets; RLS and constraints on **new** objects only; foreign keys from new tables to existing ones that act only on the new rows. No change to existing tables, policies, grants, functions or data. | A verified backup **less than 24 hours old** (the daily run), a recovery reference and rollback SQL in the build record, and the migration's own verification queries after applying. |
| **Medium** | Changes constraints, relationships, RLS, grants, triggers or functions on **existing** objects, or shared behaviour that existing code relies on. | The Low gate, plus a compatibility check (affected code paths and harnesses green on staging with the change) and a recovery rehearsal (rollback SQL run on staging). |
| **High** | Destructive (drop, rename, type change), bulk data rewrites, or changes to a critical security boundary (auth, patient-data RLS, `SECURITY DEFINER` widening, grants to `anon`). | A **fresh** backup taken immediately before, verified by an isolated restore, and **explicit owner approval** for that migration. |

**Batches:** related migrations may be applied as one controlled batch under one GO, in dependency order. The batch takes the gate of its highest tier, is verified after each migration and again at the end, and stops at the first failed verification.

## 9. Classification of 370, 372 and 373

| Migration | Tier | Basis |
|---|---|---|
| **370** Individual membership and entitlement | **Low** | Two new tables and one view.<br>• RLS and own-row policies on the new tables only.<br>• Its drop/add constraint statements touch only its own tables.<br>• The view is `security_invoker`, so it cannot read past the base table's RLS.<br>• FKs to `profiles` act only on the new rows. |
| **372** Scholar learning | **Low** | Six new tables and one private bucket.<br>• Own-row RLS, no write policies.<br>• Composite keys among its own tables; FK to `profiles` only.<br>• No `storage.objects` policies.<br>• No functions. |
| **373** Professional record | **Low** | Six new tables and one private bucket.<br>• Own-row RLS.<br>• FKs to `profiles`, `frameworks`, `framework_competencies` (`set null`) and `passport_share_tokens` (`cascade`) act only on the new rows.<br>• No `storage.objects` policies. |

**Recommended:** apply them as **one Low-tier batch, 370 → 372 → 373**.
- **Gate:** a verified production backup less than 24 hours old.
- **After each migration:** run its verification queries.
- **Throughout:** `individual_app` stays OFF, so nothing becomes reachable.
- **Rollback:** the build records hold rollback SQL for each migration (drop the new objects in reverse order).

## 10. Freeze lift (revised conditions; owner sign-off required)

- [x] Automated, encrypted, integrity-checked backup with 7 daily + 4 weekly retention and failure/missed reporting, proven on staging (§6, §7).
- [ ] First production backup verified (needs the owner's credential).
- [ ] Production isolated restore test **PASS**.
- [x] Risk-tier gate adopted (§8); 370, 372 and 373 classified (§9).
- [ ] The owner records the sign-off date here and gives a separate production GO for the 370 → 372 → 373 batch.
