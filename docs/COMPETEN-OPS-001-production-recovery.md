# COMPETEN-OPS-001 — Production database recovery: requirements and recommended configuration

| | |
|---|---|
| **Status** | Requirements of record, revised 2026-10-23 (Revision 1, §6–§12). **Freeze lifted for Low-tier changes under the §8 gate** (owner GO, 2026-10-23); 370, 372 and 373 are applied (§11). R9–R11 and R14 are open; R12 and R13 are corrected (§12). |
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

## 6. Backup automation (built; production verified 2026-10-23)

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
| **Production backup (2026-10-23 09:48)** | **OK.** 10.3 MB encrypted archive in 425 s. 7,706 TOC entries; data for all 672 public tables; 318 policies; Postgres 17.6. |
| **Production isolated restore** | **PASS** (`docs/evidence/COMPETEN-OPS-001/production-restore-test-2026-10-23.json`). 715/715 tables match the archive row for row (105,803 rows); 0 restore errors; 34 s restore, 84 s end to end. Live cross-check (read-only counts): 672 tables, 672 with RLS, 318 policies, 379 functions, 47 auth users and the schema fingerprint `67c8b840…` all match. Nothing is left behind. |

## 8. Migration governance by risk

| Tier | Definition | Gate before applying to production |
|---|---|---|
| **Low** | Additive and non-destructive:<br>• new tables, views, indexes or private buckets;<br>• RLS and constraints on **new** objects only;<br>• foreign keys from new tables to existing ones that act only on the new rows;<br>• **additive columns with compatible defaults** (a constant default, or nullable) on **product-owned** tables, where existing rows, reads and access behaviour stay as they were;<br>• **HQ catalogue additions** (capabilities, positions, position grants) that confer **no effective authority** until separately authorised, for example by an appointment.<br>Otherwise no change to existing tables, policies, grants, functions or data. **Classify on actual security, data and operational impact, from the committed file on `main` by checksum.** A change that touches RLS, existing authority, shared access boundaries or bulk data is not Low, whatever its shape. | A verified backup **less than 24 hours old** (the daily run), a recovery reference and rollback SQL in the build record, and the migration's own verification queries after applying. |
| **Medium** | Changes constraints, relationships, RLS, grants, triggers or functions on **existing** objects, or shared behaviour that existing code relies on. | The Low gate, plus a compatibility check (affected code paths and harnesses green on staging with the change) and a recovery rehearsal (rollback SQL run on staging). |
| **High** | Destructive (drop, rename, type change), bulk data rewrites, or changes to a critical security boundary (auth, patient-data RLS, `SECURITY DEFINER` widening, grants to `anon`). | A **fresh** backup taken immediately before, verified by an isolated restore, and **explicit owner approval** for that migration. |

**Low-tier amendment (owner, 2026-10-23):** the last two Low bullets were added so 374 (two defaulted columns on `individual_professional_profile`) and 376 (an HQ capability seed) are classified by their real impact, not their shape. Each batch sheet still states why its migration is Low.

**Batches:** related migrations may be applied as one controlled batch under one GO, in dependency order. The batch takes the gate of its highest tier, is verified after each migration and again at the end, and stops at the first failed verification.

## 9. Classification of 370, 372 and 373

| Migration | Tier | Basis |
|---|---|---|
| **370** Individual membership and entitlement | **Low** (see correction) | Two new tables and one view.<br>• RLS and own-row policies on the new tables only.<br>• Its drop/add constraint statements touch only its own tables.<br>• The view is `security_invoker`, so it cannot read past the base table's RLS.<br>• FKs to `profiles` act only on the new rows.<br>**Correction (2026-10-23):** 370 also inserts HQ catalogue rows into existing tables: capability `hq.individual.pilot.grant`, position `individual_product_administrator`, and two `hq_position_capability` grants. The first classification was made from an earlier draft without this section. These rows are additive, and no one is appointed, so no one's access changed; strictly, though, they are data in existing tables. The rule from now on: **classify from the file on `main`, by checksum**. |
| **372** Scholar learning | **Low** | Six new tables and one private bucket.<br>• Own-row RLS, no write policies.<br>• Composite keys among its own tables; FK to `profiles` only.<br>• No `storage.objects` policies.<br>• No functions. |
| **373** Professional record | **Low** | Six new tables and one private bucket.<br>• Own-row RLS.<br>• FKs to `profiles`, `frameworks`, `framework_competencies` (`set null`) and `passport_share_tokens` (`cascade`) act only on the new rows.<br>• No `storage.objects` policies. |

**Recommended:** apply them as **one Low-tier batch, 370 → 372 → 373**.
- **Gate:** a verified production backup less than 24 hours old.
- **After each migration:** run its verification queries.
- **Throughout:** `individual_app` stays OFF, so nothing becomes reachable.
- **Rollback:** the build records hold rollback SQL for each migration (drop the new objects in reverse order).

## 10. Freeze lift (revised conditions; owner sign-off required)

- [x] Automated, encrypted, integrity-checked backup with 7 daily + 4 weekly retention and failure/missed reporting, proven on staging (§6, §7).
- [x] First production backup verified (2026-10-23, §7).
- [x] Production isolated restore test **PASS** (2026-10-23, §7).
- [x] Risk-tier gate adopted (§8); 370, 372 and 373 classified (§9).
- [x] Owner production GO for the 370 → 372 → 373 batch, 2026-10-23 ("Production GO for 370 → 372 → 373 … GO"). **The freeze is lifted for Low-tier changes under the §8 gate.**

## 11. Release batch record (production, 2026-10-23)

| Step | Detail |
|---|---|
| Recovery reference | `competen-production-20261023-1021.dump.gpg`, sha256 `a31369ef…`. Isolated restore **PASS**: 715/715 tables, 0 errors, schema fingerprint `67c8b840…` matches live. |
| Pre-check | All 15 objects and both buckets absent. Dependencies `profiles`, `frameworks`, `framework_competencies` and `passport_share_tokens` present (uuid ids). `individual_app` has no row. Baseline 672 tables, 318 policies. |
| Files | Applied from `main`; checksums match staging (370 `4b327cb8…`, 372 `17a43464…`, 373 `4b53519a…`). Applied by the owner in the SQL editor, one at a time. |
| 370 | Verified: 2 tables with RLS, 1 own-row policy each, 0 rows. View `security_invoker=true`. HQ capability, position and 2 grants present; nobody appointed. 674 tables, 320 policies. A first attempt ran outside production and changed nothing; the read-only check caught it, and it was re-run in production. |
| 372 | Verified: 6 tables with RLS, 1 policy each, 0 rows. Private bucket `individual-scholar-materials` (10 MB). 680 tables, 326 policies. |
| 373 | Verified: 6 tables with RLS, 1 policy each, 0 rows. Private bucket `individual-professional-evidence` (10 MB). **686 tables, 332 policies**; functions unchanged (379). No `storage.objects` policies. |
| Gate | `individual_app` has no row before and after. Individual stays off. |
| Rollback | `docs/evidence/COMPETEN-OPS-001/ROLLBACK-370-372-373.sql`: drop the new objects in reverse order, and buckets only if empty. Not used. |

**Dark deploy, same day.** Production deployment `dpl_36p4BL34ipAgrZFuCRVgSqppXFuQ` (`main` `88df2929`), deployed by CLI. Git auto-deploys stay paused (Ignored Build Step = pre-production only). Rollback reference: `dpl_BQufB4JpTK4RHxYBSHCgPCRZ97oc`.
- **Individual dark:** all 38 Individual page URLs return 404 with the root title; all 31 Individual API method checks return 404; the HQ grant APIs return 403.
- **No regression:** the public site, Practice, Enterprise, Recruitment, Staff, Platform and `/login` all respond 200. The public disclosure harness gives 213 assertions and 1 failure, the same as the pre-deploy baseline.

### 11b. Release batch 374 → 375 (production, 2026-10-23, owner GO)

| Step | Detail |
|---|---|
| Tier | **Low**, under the amended §8. 374: two constant-default columns on the product-owned `individual_professional_profile` (0 rows). 375: one new table with its own RLS. |
| Recovery reference | `competen-production-20261023-1246.dump.gpg`, sha256 `e73c1b6e…`, taken immediately before (R11). Isolated restore **PASS**: 729/729 tables, 0 errors. |
| Pre-check | Dependencies `individual_professional_profile` and `individual_scholar_material` present. 374 columns absent; 375 table absent; 0 profile rows; `individual_app` has no row. Baseline 686 tables, 332 policies. |
| Files | From `main`; checksums match staging (374 `8ccd5a48…`, 375 `782295e1…`). Applied by the owner in the SQL editor, one at a time. |
| 374 | Verified: `reminder_in_app` boolean NOT NULL default true; `reminder_email` boolean NOT NULL default false. The profile's own-row policy is unchanged; 0 rows; totals unchanged. |
| 375 | Verified: `individual_scholar_passport_item` with RLS on, one `read_own` SELECT policy, the composite key `(material_id, user_id)` to the owner's own material with cascade, and 0 rows. **687 tables, 333 policies**; functions unchanged (379). Buckets unchanged; no `storage.objects` policies. |
| Gate | `individual_app` has no row, before and after. |
| Rollback | `docs/evidence/COMPETEN-OPS-001/ROLLBACK-374-375.sql`. Not used. |

### 11c. Migration 395, Holdings clinical-content approval (production, 2026-10-24, owner GO)

| Step | Detail |
|---|---|
| Tier | **Medium.** New trigger functions, a nullable column on the existing `frameworks`, and HQ catalogue additions that confer no authority until someone is appointed. The staging compatibility check and recovery rehearsal are done: F1 87dda360, rollback F2 = PRE 299a0776, F3 = F1 (`docs/evidence/CLINICAL/395-staging-record.md`). |
| Recovery reference | `competen-production-20261024-0816.dump.gpg`, the latest restore-tested archive (isolated restore **PASS**, 08:23). **No fresh backup was taken immediately before applying**, which falls short of R11. A post-application backup is recommended and has been raised with the owner. |
| Pre-check | **Not captured.** The runbook step-2 output was not recorded, so the baseline counts before applying are not on file. |
| File | 395 from `main`: PR #56, merged as `82a2205`. sha256 `142ac7165ee4389ed897b573306906acceacd60b3f603cd10cdec8bb9bd71611`, matching staging. Applied by the owner, by hand, in the SQL editor. |
| Verified (read-only, main session, `run-prod-readonly.ps1`) | Every value as the runbook expects: 3 tables with RLS and 0 policies on them; 3 triggers; 6 functions, whose bodies hash (CR-stripped md5) to `21cbb8aa…`, **identical to staging**; `frameworks.specialty_term_id` present. Grants are exactly clinical_content_reviewer → hq.platform.home.view and → hq.quality.clinical.approve, plus quality_council_member → hq.quality.clinical.govern. **0 reviewer appointments and 0 rows**, so nobody holds the new authority. `competency_content_hash()` works. **700 tables, 341 policies, 390 functions** after applying. |
| Gate | Nothing for people changes until a Clinical Content Reviewer is appointed and scoped: every competency reads "Not clinically reviewed". The Individual release gate, publication and catalogues are untouched. |
| Rollback | `docs/evidence/CLINICAL/ROLLBACK-395-production.sql`: the same statements as the rehearsed `ROLLBACK-395.sql` (b8503d33); only the header comments differ. Not used. |

## 12. Outstanding recovery requirements

| # | Requirement | Status |
|---|---|---|
| R9 | **Storage-file backup.** Supabase Storage objects (uploaded files in `individual-scholar-materials`, `individual-professional-evidence` and the estate buckets) are outside `pg_dump`. A restore can bring back rows whose file is gone. | **Open**, as a separate requirement. Needed before uploads hold anything that cannot be re-uploaded. |
| R10 | **An independent copy of the archive key.** Without it, the encrypted backups cannot be read if this PC is lost. | **Open (owner action):** connect the backup SSD and run `competen-db-backup.ps1 -ExportRecoveryKey`, then also keep the key in a password manager. |
| R11 | **Retention keeps the last restore-tested archive.** Today's rule keeps the newest backup per day, which replaced the 09:48 restore-tested archive; the 10:21 archive was then restore-tested too. | Recommended refinement. Until then, a restore test runs on the recovery reference before every production batch. |
| R12 | **The staging migration runner resolves "production" from the wrong place.** `scripts/apply-migrations.ts` takes the production project ref from `NEXT_PUBLIC_SUPABASE_URL`. In a worktree whose `.env.local` points the local app at staging, "production" then reads as staging, and the guard refuses every run. It fails safe, but the guard compares against the wrong reference. Seen on 2026-10-23 when applying 375; the owner set the real production URL in the shell for the run. | **Corrected (2026-10-23).** `apply-migrations.ts` now judges the target connection string with `judgeDbTarget` in `scripts/production-guard.ts`: production is that file's `PRODUCTION_REF` constant, never an environment variable, and a target naming no project, or two different projects, is refused. `production-guard-harness` pins it, including a staging-pointed app environment and a check that the runner never reads `NEXT_PUBLIC_SUPABASE_URL`; a planted revert turns it red. |
| R13 | **Production access without a named GO, including one WRITE (recorded, corrected).** On 2026-10-23 a development session ran harnesses that reached **production** through the worktree `.env.local`, which names production and its service key. The session disclosed all of them.<br>(1) `privileged-harnesses.ts` with no flag: its production read-only security subset, stopped after about 400 s.<br>(2) `hq-guard-harness.ts`, run once at about 13:05 EAT: section 7 **read** `profiles` (id and roles) and the HQ catalogue, and section G **WROTE** to production. It inserted an active `chief_executive` row in `ogs_office_appointments` for a **real** person (the first non-owner profile it read), cycled its status (suspended, nominated, active), then deleted it. For those seconds that account resolved to 9 HQ executive capabilities.<br>(3) `hq-nav-filter-harness.ts`, twice: section D **read** up to 500 profiles (id, full_name, roles) and resolved their HQ positions.<br>**Checked afterwards (read-only):** no appointment created that day remains, and the only `chief_executive` appointment predates it. The harness wrote directly to the table, so `audit_log` and `ogs_lifecycle_transitions` hold **no** record of it; only the Supabase database logs would show the statements and the person_id. | **Corrected for these three harnesses.** All three now call `productionReadDecision` (`scripts/production-guard.ts`) before creating a live client: a production target needs BOTH `--production` AND `COMPETEN_PRODUCTION_READ_GO=<owner GO reference>`, and an unidentifiable target is refused. `privileged-harnesses` refuses its default run (listing modes stay open). `hq-guard-harness` (which also guards its writing section G) and `hq-nav-filter-harness` skip their live sections. Pinned in `production-guard-harness`, and a planted revert goes red.<br>**Still open, an owner decision and urgent:** about 207 scripts read `NEXT_PUBLIC_SUPABASE_URL` with no production guard, 174 of them can write, and the default dev server (`competen-dev`, :3000) also serves against production. The durable fix is to **remove the production service key from development worktrees' `.env.local`** and point them at staging, so any production access needs the key supplied deliberately. Second fix: `hq-guard-harness` section G should use a synthetic subject, never a real profile. |
| R14 | **Abandoned direct uploads (follow-up).** With direct-to-storage evidence uploads (PR #16), a browser tab closed between the storage upload and the record step leaves an object in the private `evidence` bucket with no row. Nothing can reach it through the API, but it uses storage. Confirmed in the PR #16 staging browser test (a 5 MB orphan, removed at teardown). | **Open (follow-up).** A periodic sweep that deletes objects older than the slot lifetime (2 h) with no matching `evidence` row. Its own PR; not built. R9 (Storage-file backup) remains open separately. |
