# Migration 395: production runbook (owner GO 2026-10-24: "GO", for applying 395 in production)

**Who runs it:** the owner, by hand, in the production Supabase SQL editor. No agent applies anything to production (CLAUDE.md, migration state 4). Every SQL block below is ready to paste. Steps 2, 4 and 5 are read-only.

**Tier:** Medium (OPS-001 §8). It adds new trigger functions and a nullable column on the existing `frameworks`. Its HQ catalogue additions confer no authority until someone is appointed.
- **Already done on staging:** the compatibility check (harnesses green) and the recovery rehearsal (F1 87dda360 → rollback F2 = PRE 299a0776 → F3 = F1; `395-staging-record.md`).
- **Still to do, in production:** the Low gate (steps 1–6).

## 0. Before you start

- [ ] The PR for `holdings/clinical-approval` is **merged into `main`** (state 3 before state 4). Apply the file **from `main`**.
- [ ] Its checksum matches staging. In the repository on `main`:
  ```
  sha256sum supabase/migrations/395-clinical-content-approval.sql
  ```
  This must print `142ac7165ee4389ed897b573306906acceacd60b3f603cd10cdec8bb9bd71611`. Stop if it differs.

## 1. Recovery reference (OPS-001 §6, R11)

Take a fresh production backup now, and run the isolated restore test on it:

```
C:\Users\elish\CompetenBackup\bin\competen-db-backup.ps1
C:\Users\elish\CompetenBackup\bin\competen-restore-test.ps1
```

Record the archive name, its sha256, and the restore result (tables matched, errors, schema fingerprint). Do not go on unless the restore test **PASSES**.

## 2. Pre-check (read-only): dependencies present, 395 absent, baseline

```sql
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'framework_competencies' and column_name in ('learning_outcomes', 'expected_level_id')) as s1_columns_384,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('hq_position', 'hq_capability', 'hq_position_capability', 'ogs_office_appointments', 'ogs_offices', 'taxonomies', 'taxonomy_terms', 'competency_skills')) as dependencies,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('clinical_content_version', 'clinical_reviewer_scope', 'clinical_review_decision')) as tables_395,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'frameworks' and column_name = 'specialty_term_id') as column_395,
  (select count(*) from hq_position where code = 'quality_council_member') as council_position,
  (select count(*) from hq_capability where code like 'hq.quality.clinical.%') as caps_395,
  (select count(*) from pg_tables where schemaname = 'public') as public_tables,
  (select count(*) from pg_policies where schemaname = 'public') as policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') as functions;
```

**Expected:** `s1_columns_384 = 2`, `dependencies = 8`, `tables_395 = 0`, `column_395 = 0`, `council_position = 1`, `caps_395 = 0`. Write down `public_tables`, `policies` and `functions` as the baseline.
- If `s1_columns_384` is not 2, migration 384 is not in production. **Stop**: 395 depends on it.
- If `council_position` is 0, 395 still applies, but `hq.quality.clinical.govern` goes to nobody until that position exists.

## 3. Apply

Open `supabase/migrations/395-clinical-content-approval.sql` from `main`. Paste the **whole file** into the SQL editor and run it once. The file starts with an APPLY THIS FILE WHOLE banner: it contains plpgsql functions, so do not split it. It ends with three verification selects and `notify pgrst`.

## 4. Post-application verification (read-only)

```sql
select
  (select count(*) from pg_class c where c.relname in ('clinical_content_version', 'clinical_reviewer_scope', 'clinical_review_decision') and c.relrowsecurity) as tables_with_rls,
  (select count(*) from pg_policies where tablename in ('clinical_content_version', 'clinical_reviewer_scope', 'clinical_review_decision')) as policies_395,
  (select count(*) from pg_trigger where tgname in ('clinical_content_version_guard', 'clinical_review_decision_guard', 'clinical_reviewer_scope_guard')) as triggers,
  (select count(*) from pg_proc where proname in ('competency_content_hash', 'competency_content_hashes', 'clinical_scope_covers', 'clinical_content_version_guard', 'clinical_review_decision_guard', 'clinical_reviewer_scope_guard')) as functions_395,
  (select count(*) from information_schema.columns where table_name = 'frameworks' and column_name = 'specialty_term_id') as column_395,
  (select string_agg(position_code || ' -> ' || capability_code, ', ' order by position_code, capability_code) from hq_position_capability
     where (capability_code like 'hq.quality.clinical.%' or position_code = 'clinical_content_reviewer') and effective_to is null) as grants,
  (select count(*) from ogs_office_appointments where role = 'clinical_content_reviewer') as reviewer_appointments,
  (select count(*) from clinical_content_version) + (select count(*) from clinical_review_decision) + (select count(*) from clinical_reviewer_scope) as rows_395,
  (select count(*) from pg_tables where schemaname = 'public') as public_tables,
  (select count(*) from pg_policies where schemaname = 'public') as policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') as functions;
```

**Expected:**

| Column | Value |
|---|---|
| `tables_with_rls` | 3 |
| `policies_395` | 0 |
| `triggers` | 3 |
| `functions_395` | 6 |
| `column_395` | 1 |
| `grants` | `clinical_content_reviewer -> hq.platform.home.view, clinical_content_reviewer -> hq.quality.clinical.approve, quality_council_member -> hq.quality.clinical.govern` |
| `reviewer_appointments` | 0 (nobody holds the new authority) |
| `rows_395` | 0 |
| `public_tables` | baseline + 3 |
| `policies` | baseline (unchanged) |
| `functions` | baseline + 6 |

A quick behavioural check (read-only): the content hash works.

```sql
select competency_content_hash(id) is not null as hash_ok from framework_competencies limit 1;
```

## 5. What it changes for people (nothing yet)

- No one is appointed as a Clinical Content Reviewer, so no one can approve anything.
- Every competency still reads "Not clinically reviewed", which is now a fact the database can prove rather than a default.
- Publication, the catalogues (394 is not in production) and the Individual release gate are untouched.

## 6. Rollback (only if step 4 fails)

`docs/evidence/CLINICAL/ROLLBACK-395-production.sql` contains the same statements rehearsed on staging (b8503d33). Run it whole. It removes only 395's objects; with no review records yet, nothing else is lost.

## 7. Record

Add a release batch row to OPS-001 §11 in the 11b format:
- tier;
- recovery reference and restore result;
- pre-check;
- file checksum;
- verification;
- rollback (used or not).
