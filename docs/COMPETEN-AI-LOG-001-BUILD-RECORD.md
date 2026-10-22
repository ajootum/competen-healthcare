# COMPETEN-AI-LOG-001 — AI usage attribution, build record

**2026-10-22.** Code merged as PR #2 (`9402bbe`). Migration 371 is in this record's PR. Status of the
production application is recorded under section 4 and updated when it happens.

## 1. What was wrong

`plat_ai_requests.tenant_id` references `tenants(id)` (migration 055).
- Practice passed its workspace id as `tenantId`.
- The Enterprise copilots passed `profiles.hospital_id`.

Neither is a tenant, so the database refused every one of those usage rows (Postgres `23503`). The
refusal was invisible: supabase-js returns `{ error }` rather than throwing, and `recordAiUsage` only had a
`catch`. PR #2 replaced the bare `tenantId` with a scoped `AiAttribution` (tenant / workspace / person)
and made a refused insert log `[ai-gateway] usage row ... was NOT recorded`.

## 2. Migration 371

`supabase/migrations/371-plat-ai-requests-attribution.sql` adds two columns and one index:

| Object | Definition |
|---|---|
| `workspace_id` | `uuid`, FK `practice_workspace(id)` on delete set null |
| `attribution_scope` | `text`, check `tenant` / `workspace` / `person` |
| `idx_plat_ai_requests_workspace` | `(workspace_id, created_at desc)` |

- **Additive:** no existing column, row or constraint is changed, and `tenant_id` with its FK
  `plat_ai_requests_tenant_id_fkey` is untouched.
- **Idempotent:** every statement is `if not exists`. A second run on staging changed nothing.
- **House rules:** passes `scripts/migration-house-rules.ts` (4 statements).

**Ordering.**
- 371 does not depend on 370. It reads only `practice_workspace` (191) and `plat_ai_requests` (055).
- 370 (`ind-003/individual-foundation`, `cb63e582`) is on neither `main` nor production.
- `main` will read 369, 371 until 370 lands, then 369, 370, 371. Numbering order is not application
  order in this repo; there is no schema_migrations ledger (see 001's header).

**Deploy order. Every combination is safe:**

| Gateway code | Migration 371 | What happens |
|---|---|---|
| Old (pre-PR #2) | Applied | Inserts name no new column; the new columns stay null. |
| PR #2 | Not applied | PostgREST answers `PGRST204` naming `workspace_id` or `attribution_scope`. The gateway re-sends the row without those two columns, so usage is still counted. |
| PR #2 | Applied | Full attribution. |

## 3. Recovery reference (taken before application, production `rnnqhlrcgvsauigxwszl`, read-only)

- **`plat_ai_requests`:** 151 rows, latest `created_at` 2026-08-27T15:41:14Z.
  - Fingerprint (sha256 of every row's id and accounting columns, ordered by id): `17f69b1b6006f67a`.
  - Columns: `id, actor_id, tenant_id, operation, tier, provider, model, input_tokens, output_tokens,
    total_tokens, latency_ms, status, error, cost_usd, created_at`.
  - FKs: `actor_id -> profiles(id)`, `tenant_id -> tenants(id)`.
- **Production head:** 368 present (`practice_entitlement.source`). 371 absent
  (`plat_ai_requests.workspace_id` does not exist). 370 not applied.
- **Backups:** **none.** The project is on the Supabase Free plan, which has no scheduled backups and no
  point-in-time recovery (Dashboard > Database > Backups). 371 modifies no existing row, so the rollback
  below restores the prior schema exactly. The absence of backups is a standing production risk beyond
  this change.

**Rollback (recorded, NOT run):**

```sql
drop index if exists idx_plat_ai_requests_workspace;
alter table plat_ai_requests drop column if exists attribution_scope;
alter table plat_ai_requests drop column if exists workspace_id;
notify pgrst, 'reload schema';
```

Dropping `workspace_id` also drops its FK. The gateway's pre-371 fallback keeps logging working after a
rollback.

## 4. Application

**Method:** by the owner, by hand, in the Supabase SQL editor, as for every migration in this repo.
The owner GO authorised the rollout, but the agent's attempt to drive the production SQL editor was
refused by its own safety gate, so the owner applies the file.

- **Staging:** applied 2026-10-22 under the staging GO, and verified. Both columns, the FK and the check
  are present, and a re-run is a no-op. The real gateway writes workspace, tenant and person rows to the
  right columns, a bad tenant is reported, and all probe rows were removed.
- **Production:** PENDING owner application.

**Verification query (read-only, run after applying):**

```sql
select column_name, data_type, is_nullable from information_schema.columns
 where table_name = 'plat_ai_requests' and column_name in ('tenant_id','workspace_id','attribution_scope')
 order by 1;
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'plat_ai_requests'::regclass and contype in ('f','c') order by 1;
select indexname, indexdef from pg_indexes where tablename = 'plat_ai_requests' order by 1;
select count(*) as rows_after from plat_ai_requests;
```

**Expected result:**
- `tenant_id`, `workspace_id` (uuid) and `attribution_scope` (text), all nullable.
- Constraints:
  - `plat_ai_requests_actor_id_fkey`
  - `plat_ai_requests_attribution_scope_check`
  - `plat_ai_requests_status_check`
  - `plat_ai_requests_tenant_id_fkey`, still `REFERENCES tenants(id) ON DELETE SET NULL`
  - `plat_ai_requests_workspace_id_fkey`, `REFERENCES practice_workspace(id) ON DELETE SET NULL`
- Indexes: the pkey, `idx_plat_ai_requests_created`, `idx_plat_ai_requests_model` and
  `idx_plat_ai_requests_workspace`.
- `rows_after` = 151.
