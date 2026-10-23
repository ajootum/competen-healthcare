# COMPETEN-OPS-002 — Migration reconciliation: production and staging, and the production sequence for 370 → 372 → 373

| | |
|---|---|
| **Date** | 2026-10-23 |
| **Authority** | Owner GO "COMPETEN — INDIVIDUAL RELEASE PREPARATION", item 3 |
| **Status** | Findings and a proposed plan. **No schema was changed anywhere.** No production migration happens without a separate owner GO, and the COMPETEN-OPS-001 schema freeze stays in force until its §5 is met. |
| **Method** | Read-only. **Staging:** catalog reads over `STAGING_DB_URL`, in a read-only session. **Production:** PostgREST requests that return no rows (`select … limit 0`) plus filtered counts on catalog-like tables (`hq_*`, `practice_plans`, `practice_entitlement`), and a storage bucket metadata read. No row content was read and no write was issued. Production has no catalog access over REST, so indexes, constraints, policies, RLS and nullability are reported as *not determinable* there (§2.3 gives the read-only SQL to settle them). |
| **Markers** | Derived from each migration file's own statements: every created table, view, column, index, constraint and policy, every seeded HQ row and every bucket. Not inferred from filenames. |

## 1. Findings

| Migration | Production | Staging | Notes |
|---|---|---|---|
| 361 message preferences | **Applied** (1/1) | **Absent** (0/1) | |
| 362 practitioner photo | **Applied** (2/2 columns; constraint not determinable) | **Absent** (0/3) | |
| 363 booking emergency notice | **Applied** (1/1 column; constraint not determinable) | **Absent** (0/2) | |
| 364 relationship parent / other relative | **Not determinable over REST** (it only redefines two CHECK constraints) | **Absent**: both constraint definitions lack `other_relative` | Settle production with §2.3 query Q1 |
| 365 location address and map | **Applied** (2/2 columns; 2 constraints not determinable) | **Absent** (0/4) | |
| 366 booking funnel events | **Applied** (table; 2 indexes and RLS not determinable) | **Absent** (0/4) | |
| 367 commercial-manage capability | **Applied**: `hq.practice.commercial.manage` row and its Product Director grant (counts 1/1) | **Absent** (0/2) | |
| 368 entitlement source | **Applied**: column present, rows with `source IS NULL` = 0. CHECK constraint and NOT NULL not determinable. | **Absent** (column missing) | The zero-null count is consistent with the backfill. NOT NULL is settled by Q1. |
| **369 activate priced plan** | **Consistent with applied**: `practice_solo_ugx` rows = 1, active = 1 | **Absent**: the row exists but is inactive | **Data-only migration.** A schema probe cannot say *how* the row became active (369, or a later Director action through the commercial console). Only that the state 369 produces is present. |
| 370 Individual gate | **Absent** (0/8: tables, view, columns, HQ capability, position, grant). Its constraints and policies cannot exist without the tables. | **Applied** (14/14). Snapshot hash `83b7db43…6678` after an idempotent re-run (IND-003 §4). | |
| 371 AI usage attribution | **Applied** (2/2 columns; index not determinable) | **Applied** (3/3) | Applied to production under AI-LOG-001's GO |
| 372 Scholar learning | **Absent** (0/7: 6 tables and the `individual-scholar-materials` bucket) | **Applied** (13/13: tables, own-row policies, bucket) | |
| 373 Professional record | **Absent** (0/7: 6 tables and the `individual-professional-evidence` bucket) | **Applied** (13/13) | |

**Probe controls.** Each run included an absent table, an absent column and a known-present table, and all three read correctly on both environments.

The first production run used `HEAD` requests, and those read *absent* tables as present: PostgREST answers `HEAD` on a missing relation with 204 and no error. A control exposed it before any conclusion was drawn, and every table, view and column probe was re-run with `select … limit 0`, which returns 404 `PGRST205` / 400 `42703`. Only the corrected results are reported here.

### Root cause of the drift

**Production and staging are mirror images.**
- **361–369 reached production only.** All nine were authored on 2026-09-01/02, after staging's last parity catch-up on 2026-08-28 (through 360, recorded in `scripts/privileged-harnesses.ts`). Staging then sat unused and was later paused and lost until the owner restored it on 2026-10-22 (OPS-001 §1). There was no staging-first step in the process at the time. The CLAUDE.md four-state rule (PR #7) now makes one mandatory.
- **370, 372 and 373 reached staging only,** deliberately, under staging-only GOs. That is the four-state rule working as designed: applied and verified on staging, production pending.

No partially applied migration was found on either side. Every determinable marker of each migration is all present or all absent.

## 2. Staging catch-up plan for 361–369

**Goal:** staging at production parity, so the boundary harnesses (`hq-guard`, `platform-membership`, `practice-signup`) run clean there. IND-003 §8 traced their staging failures to exactly this gap.

1. **Who applies:** the owner in the staging SQL editor, or an agent under a separate staging-only GO with `scripts/apply-migrations.ts --only <nnn>` (session pooler, whole file, production guard).
2. **Order:** 361 → 369 in number order, one at a time. None of the nine depends on 370–373, and none of 370–373 depends on them (§3.1), so applying them after 370–373 is safe.
3. **Per migration:**
   - house-rules check (already committed files, ALL CLEAR at authoring);
   - apply;
   - re-run the same file as a no-op (all nine are idempotent: `if not exists`, drop-then-add constraints, `on conflict`);
   - re-run this document's probe;
   - expected result: that migration reads applied (constraints included) on staging.
4. **369 on staging** activates staging's own `practice_solo_ugx` row. Staging data only, so it doesn't matter to production.
5. **After 369:** re-run the staging boundary harnesses. `hq-guard` B1/B5 and the `ENTITLEMENT_CREATE_FAILED` failures should clear.

### 2.3 Read-only SQL to settle production's not-determinable markers (owner, production SQL editor, SELECT only)

```sql
-- Q1: constraints, nullability, indexes and RLS for 362-366, 368, 371 (catalog only, no row data)
select conrelid::regclass as tbl, conname, pg_get_constraintdef(oid) like '%other_relative%' as has_other_relative
  from pg_constraint
 where conname in ('practice_identity_photo_is_complete','practice_booking_access_emergency_notice_check',
                   'practice_patient_relationship_relationship_type_check',
                   'practice_booking_request_representative_relationship_check',
                   'practice_location_address_check','practice_location_map_url_check',
                   'practice_entitlement_source_check')
 order by 2;
select is_nullable from information_schema.columns where table_name = 'practice_entitlement' and column_name = 'source';
select indexname from pg_indexes
 where indexname in ('idx_practice_funnel_ws_step','idx_practice_funnel_occurred','idx_plat_ai_requests_workspace');
select relname, relrowsecurity from pg_class where relname = 'practice_booking_funnel_event';
```

Expected if 361–369 and 371 are fully applied:
- seven constraints, with both 364 rows `has_other_relative = true`;
- `is_nullable = NO`;
- three indexes;
- `relrowsecurity = true`.

## 3. Proposed production sequence: 370 → 372 → 373

### 3.1 Preconditions, all required before step 1

1. **The OPS-001 freeze is lifted** (its §5): backups visible and current, PITR active, and one restore drill documented.
2. **Separate owner GO for each migration.** One GO does not cover the next.
3. **The file is on `main` and matches its staging checksum** (the CLAUDE.md four-state rule):

   | Migration | SHA-256 (as committed, LF) | On `main`? |
   |---|---|---|
   | 370 | `4b327cb8ad6c716214c43756eca50addb851fd0ef11a2fab163ae3e46d63f656` | Yes (`293e50f1`) |
   | 372 | `17a43464bc36eea620e3187536bbec3f8a1ef71a499a0d843880e0bf5854351d` | **No.** IND-004's PR is not merged. |
   | 373 | `4b53519aee7faaef7f2d6aace2f8f24574262677474867f509b21a49e0c75657` | **No.** IND-007's PR is not merged. |

4. **Dependencies are present in production.** None of the three depends on 361–369 or on 371.
   - **370:** `profiles` and the HQ catalogue tables `hq_capability`, `hq_position` (with `product_line_code`) and `hq_position_capability` (with `effective_to`), plus `plat_product_line.individual` (migrations 264 and 281).
   - **372:** `profiles` and `storage.buckets`.
   - **373:** `profiles`, `frameworks`, `framework_competencies`, `passport_share_tokens` and `storage.buckets`.

   372 and 373 don't reference 370's objects. The 370 → 372 → 373 order is a release order: the gate, then the experiences. It is not a foreign-key necessity.
5. **The release gate stays OFF throughout and after:** no `practice_platform_flags` row `individual_app`, or `enabled = false`. Turning it on is release checklist item 12, a separate later act.

### 3.2 Each step

| | 370 | 372 | 373 |
|---|---|---|---|
| **Before** | Record the recovery reference: a PITR timestamp, or a backup ID newer than 24 hours (OPS-001 R5). Confirm the gate is OFF. | The same. Also confirm 370 is applied and verified. | The same. Also confirm 372 is applied and verified. |
| **Apply** | The owner pastes the whole file into the production SQL editor (it has no `$$`; it's still applied whole by practice). | The same. | The same. |
| **Verify** | Re-run the IND-003 §4 snapshot query: 3 relations (RLS on both tables, `security_invoker` on the view), 20 constraints, 4 indexes, 2 SELECT policies, 0 rows, 1 capability, 1 position, 2 grant rows. Then this document's probe: 370 reads applied. Compare the snapshot hash with staging's `83b7db43…`. | This document's probe: 372 applied (6 tables, 6 own-row policies, bucket present, RLS on each). 0 rows in each table. | The same for 373. |
| **Rollback** (only valid while the tables are empty; with the gate OFF they are) | See §3.3 R370 | See §3.3 R372 | See §3.3 R373 |
| **Gate** | OFF | OFF | OFF |

### 3.3 Rollback SQL (owner, production, only if verification fails)

```sql
-- R370. Precondition: 0 rows in individual_membership and individual_entitlement, and no
-- ogs_office_appointments row with role = 'individual_product_administrator' (role is free text, no FK).
drop view if exists individual_live_entitlement;
drop table if exists individual_entitlement;
drop table if exists individual_membership;
delete from hq_position_capability where position_code = 'individual_product_administrator';
delete from hq_position where code = 'individual_product_administrator';
delete from hq_capability where code = 'hq.individual.pilot.grant';
notify pgrst, 'reload schema';

-- R372. Precondition: every individual_scholar_* table empty and the bucket holds no objects.
drop table if exists individual_scholar_card;
drop table if exists individual_scholar_attempt;
drop table if exists individual_scholar_question;
drop table if exists individual_scholar_chunk;
drop table if exists individual_scholar_material;
drop table if exists individual_scholar_consent;
notify pgrst, 'reload schema';
-- then delete bucket 'individual-scholar-materials' via Dashboard -> Storage (or the Storage API)

-- R373. Precondition: every individual_professional_* table empty and the bucket holds no objects.
drop table if exists individual_professional_share;
drop table if exists individual_professional_evidence;
drop table if exists individual_professional_cpd;
drop table if exists individual_professional_goal;
drop table if exists individual_professional_need;
drop table if exists individual_professional_profile;
notify pgrst, 'reload schema';
-- then delete bucket 'individual-professional-evidence' via Dashboard -> Storage (or the Storage API)
```

Checked on staging (read-only): no triggers on `hq_capability`, `hq_position`, `hq_position_capability`, `individual_membership` or `individual_entitlement`, so the deletes aren't refused. The only foreign keys into the HQ rows are from `hq_position_capability`, which is why the grants are deleted first. No table outside `individual_*` references an `individual_*` table.

## 4. What this document does not do

- It applies nothing.
- It does not settle production's not-determinable markers; that is Q1, run by the owner.
- It does not lift the OPS-001 freeze.
- It does not authorise merging IND-004 or IND-007.
- Applying 361–369 to staging needs the owner or a separate staging GO.
