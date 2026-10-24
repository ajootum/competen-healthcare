/**
 * MIGRATION 373 -- READ-ONLY STAGING CHECK, before and after the apply (COMPETEN-IND-007, owner GO).
 *
 *   npx tsx scripts/ind007-staging-schema-check.ts            prints the report, changes nothing
 *
 * ⚠ READ-ONLY BY CONSTRUCTION. Every query runs inside `begin transaction read only`, which Postgres
 * enforces: a write in here is an error, not a risk. It connects to STAGING_DB_URL with the same
 * production guard as apply-migrations.ts (refuses a URL naming the production ref, refuses the
 * transaction pooler).
 *
 * WHAT IT ANSWERS:
 *   1. Server version -- 373 uses `on delete set null (col)`, which needs PostgreSQL 15 or later.
 *   2. Dependencies present: profiles, frameworks, framework_competencies, passport_share_tokens and
 *      storage.buckets (373's own), plus 370's and 371's markers (the ordering the owner asked about).
 *   3. Collisions: any EXISTING object whose name 373 creates, and that 373 did not create (tables,
 *      constraints, indexes, policies, the bucket id). Before the first apply this must be empty.
 *   4. Preserved data: row counts of every existing table 373 references, before and after.
 *   5. The 373 schema fingerprint: columns (type, nullability, default, generated), constraints,
 *      indexes, policies, RLS flags and the bucket row, hashed. Identical after a second apply =
 *      idempotent.
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { judgeDbTarget } from "./production-guard";

const require2 = createRequire(process.cwd() + "/");
require2("@next/env").loadEnvConfig(process.cwd());

const dbUrl = process.env.STAGING_DB_URL ?? "";
if (!/^postgres(ql)?:\/\/\S+@\S+\/\S+/.test(dbUrl)) { console.error("STAGING_DB_URL is not set to a Postgres URL."); process.exit(1); }
// The production ref is a constant in production-guard.ts, the same judge apply-migrations uses. It used to
// be read from NEXT_PUBLIC_SUPABASE_URL -- which, since .env.local names STAGING, made this refuse staging
// itself as "production". Failing closed was right; the source of the ref was wrong.
const hasLayer = (cols: { column_name: string }[]) => cols.some(c => c.column_name === "competency_layer");
const verdict = judgeDbTarget(dbUrl);
if (!verdict.ok) { console.error(`REFUSING: STAGING_DB_URL is ${verdict.reason === "PRODUCTION" ? `PRODUCTION (${verdict.ref})` : "not identifiable as a project"}.`); process.exit(1); }
if (/:6543\//.test(dbUrl)) { console.error("Transaction pooler (6543) -- use the session pooler (5432)."); process.exit(1); }

const TABLES = ["individual_professional_profile", "individual_professional_need", "individual_professional_goal",
  "individual_professional_cpd", "individual_professional_evidence", "individual_professional_share"];
const BUCKET = "individual-professional-evidence";
const REFERENCED = ["profiles", "frameworks", "framework_competencies", "passport_share_tokens"];

async function main() {
  const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("begin transaction read only");
  try {
    const q = async (sql: string, args: unknown[] = []) => (await c.query(sql, args)).rows;
    const out: Record<string, unknown> = {};

    out.server = (await q("show server_version"))[0].server_version;
    const major = Number(String(out.server).split(".")[0]);
    out.pg15OrLater = major >= 15;

    const has = async (t: string, schema = "public") =>
      (await q("select 1 from information_schema.tables where table_schema = $1 and table_name = $2", [schema, t])).length > 0;
    const col = async (t: string, cname: string) =>
      (await q("select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2", [t, cname])).length > 0;
    out.dependencies = {
      profiles: await has("profiles"), frameworks: await has("frameworks"), framework_competencies: await has("framework_competencies"),
      passport_share_tokens: await has("passport_share_tokens"), "storage.buckets": await has("buckets", "storage"),
      "370 individual_membership": await has("individual_membership"), "370 individual_entitlement": await has("individual_entitlement"),
      "371 plat_ai_requests.attribution_scope": await col("plat_ai_requests", "attribution_scope"),
      "372 individual_scholar_material (informational)": await has("individual_scholar_material"),
    };

    const present = (await q("select table_name from information_schema.tables where table_schema='public' and table_name = any($1)", [TABLES])).map(r => r.table_name);
    out.tables373Present = present;
    const bucket = await q("select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = $1", [BUCKET]);
    out.bucket = bucket[0] ?? null;

    // Names 373 creates that already exist on OTHER relations (a true collision), whatever the state.
    out.foreignNameCollisions = await q(`
      select 'index' as kind, indexname as name, tablename as on_table from pg_indexes
       where schemaname='public' and indexname like any(array['ux_individual_professional_%','idx_individual_professional_%'])
         and not (tablename = any($1))
      union all
      select 'constraint', conname, conrelid::regclass::text from pg_constraint
       where conname like 'individual_professional_%' and not (conrelid::regclass::text = any($1))
      union all
      select 'policy', policyname, tablename from pg_policies
       where policyname like 'individual_professional_%' and not (tablename = any($1))`, [TABLES]);

    const counts: Record<string, number> = {};
    for (const t of [...REFERENCED, ...present]) counts[t] = Number((await q(`select count(*)::int as n from public.${t}`))[0].n);
    counts["storage.buckets"] = Number((await q("select count(*)::int as n from storage.buckets"))[0].n);
    out.rowCounts = counts;

    // The fingerprint of everything 373 owns. Sorted, so the same schema always hashes the same.
    const fp = {
      columns: await q(`select table_name, column_name, data_type, is_nullable, column_default, is_generated, generation_expression
        from information_schema.columns where table_schema='public' and table_name = any($1) order by table_name, column_name`, [TABLES]),
      constraints: await q(`select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid::regclass::text = any($1) order by 1, 2`, [TABLES]),
      indexes: await q(`select tablename, indexname, indexdef from pg_indexes where schemaname='public' and tablename = any($1) order by 1, 2`, [TABLES]),
      policies: await q(`select tablename, policyname, cmd, qual, with_check from pg_policies where tablename = any($1) order by 1, 2`, [TABLES]),
      rls: await q(`select relname, relrowsecurity from pg_class where relname = any($1) and relkind='r' order by 1`, [TABLES]),
      bucket: out.bucket,
    };
    out.fingerprint = createHash("sha256").update(JSON.stringify(fp)).digest("hex");
    out.objectCounts = { columns: fp.columns.length, constraints: fp.constraints.length, indexes: fp.indexes.length, policies: fp.policies.length,
      rlsOn: fp.rls.filter(r => r.relrowsecurity).length };

    if (process.argv.includes("--config")) {
      // COMPETEN-CONFIG-002 migration 376, before and after: the capability, the position's open grants,
      // who holds an active appointment to it, and the Individual policy partition of the WCE store.
      out.config376 = {
        capability: await q("select code, space, label from hq_capability where code = 'hq.individual.config.manage'"),
        positionGrants: await q(`select capability_code, effective_to from hq_position_capability
          where position_code = 'individual_product_administrator' order by capability_code`),
        policyOverrides: await q(`select config_path, draft, published from workspace_config_overrides
          where scope_type = 'platform' and scope_ref = 'individual' order by config_path`),
        policyVersions: Number((await q(`select count(*)::int as n from workspace_config_versions
          where scope_type = 'platform' and scope_ref = 'individual'`))[0].n),
      };
    }
    if (process.argv.includes("--taxonomy")) {
      // COMPETEN-CONFIG-002 item 8: the migration 013 vocabularies the Professional fields are offered.
      out.taxonomy = await q(`select t.kind, count(tt.id)::int as terms, coalesce(string_agg(tt.value, ', ' order by tt.sort_order, tt.value), '') as sample
        from taxonomies t left join taxonomy_terms tt on tt.taxonomy_id = t.id group by t.kind order by t.kind`);
    }
    if (process.argv.includes("--frameworks")) {
      // COMPETEN-CONFIG-002 P0: what a person may choose = shared (no hospital), active, published.
      out.sharedFrameworksByStatus = await q(`select coalesce(pub_status, '(null)') as pub_status, count(*)::int as n
        from frameworks where hospital_id is null and is_active = true group by 1 order by 1`);
    }
    if (process.argv.includes("--prof393")) {
      // Professional vertical slice, migration 393, before and after (and through its rollback rehearsal).
      const T = ["individual_professional_competency_map", "individual_professional_competency_decision"];
      const cols = await q(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = any($1) order by 1, 2`, [T]);
      const cons = await q(`select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid::regclass::text = any($1) order by 1, 2`, [T]);
      const idx = await q(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public'
        and (tablename = any($1) or indexname in ('ux_individual_professional_cpd_id_user', 'ux_individual_professional_evidence_id_user')) order by 1, 2`, [T]);
      const pol = await q(`select tablename, policyname, cmd, qual from pg_policies where tablename = any($1) order by 1, 2`, [T]);
      const trg = await q(`select tgname, pg_get_triggerdef(oid) as def from pg_trigger where tgname = 'individual_professional_competency_decision_append_only'`);
      const fn = await q(`select md5(pg_get_functiondef(p.oid)) as def_md5 from pg_proc p where p.proname = 'individual_professional_decision_append_only'`);
      out.prof393 = { tables: [...new Set(cols.map((c: any) => c.table_name))], constraints: cons.length, indexes: idx.length, policies: pol.length, trigger: trg.length, function: fn,
        fingerprint: createHash("sha256").update(JSON.stringify({ cols, cons, idx, pol, trg, fn })).digest("hex") };
    }
    if (process.argv.includes("--cfca394")) {
      // P0 controlled catalogues, migration 394, before and after (and through its rollback rehearsal).
      const T = ["competency_catalogue_entry"];
      const cols = await q(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = any($1) order by 1, 2`, [T]);
      const cons = await q(`select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid::regclass::text = any($1) order by 1, 2`, [T]);
      const idx = await q(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = any($1) order by 1, 2`, [T]);
      const pol = await q(`select tablename, policyname, cmd, qual from pg_policies where tablename = any($1) order by 1, 2`, [T]);
      const rls = await q(`select relname, relrowsecurity from pg_class where relname = any($1) order by 1`, [T]);
      const trg = await q(`select tgname, pg_get_triggerdef(oid) as def from pg_trigger where tgname = 'competency_catalogue_entry_guard'`);
      const fn = await q(`select md5(pg_get_functiondef(p.oid)) as def_md5 from pg_proc p where p.proname = 'competency_catalogue_entry_guard'`);
      out.cfca394 = { tables: [...new Set(cols.map((c: any) => c.table_name))], constraints: cons.length, indexes: idx.length, policies: pol.length, rls, trigger: trg.length, function: fn,
        fingerprint: createHash("sha256").update(JSON.stringify({ cols, cons, idx, pol, rls, trg, fn })).digest("hex") };
    }
    if (process.argv.includes("--clinical395")) {
      // D2 clinical-content approval, migration 395, before and after (and through its rollback rehearsal).
      const T = ["clinical_content_version", "clinical_reviewer_scope", "clinical_review_decision"];
      const cols = await q(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and (table_name = any($1) or (table_name = 'frameworks' and column_name = 'specialty_term_id')) order by 1, 2`, [T]);
      const cons = await q(`select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid::regclass::text = any($1) or conname like 'frameworks_specialty_term_id%' order by 1, 2`, [T]);
      const idx = await q(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = any($1) order by 1, 2`, [T]);
      const pol = await q(`select tablename, policyname from pg_policies where tablename = any($1) order by 1, 2`, [T]);
      const rls = await q(`select relname, relrowsecurity from pg_class where relname = any($1) order by 1`, [T]);
      const trg = await q(`select tgname, pg_get_triggerdef(oid) as def from pg_trigger where tgname in ('clinical_content_version_guard', 'clinical_review_decision_guard', 'clinical_reviewer_scope_guard') order by 1`);
      const fn = await q(`select p.proname, md5(pg_get_functiondef(p.oid)) as def_md5 from pg_proc p where p.proname in ('competency_content_hash', 'competency_content_hashes', 'clinical_scope_covers',
        'clinical_content_version_guard', 'clinical_review_decision_guard', 'clinical_reviewer_scope_guard') order by 1`);
      const caps = await q(`select code, space from hq_capability where code in ('hq.quality.clinical.approve', 'hq.quality.clinical.govern') order by 1`);
      const pos = await q(`select code, space from hq_position where code = 'clinical_content_reviewer'`);
      const grants = await q(`select position_code, capability_code from hq_position_capability where (capability_code in ('hq.quality.clinical.approve', 'hq.quality.clinical.govern') or position_code = 'clinical_content_reviewer') and effective_to is null order by 1, 2`);
      out.clinical395 = { tables: [...new Set(cols.map((c: any) => c.table_name))], constraints: cons.length, indexes: idx.length, policies: pol.length, rls, triggers: trg.length, functions: fn.length, caps, pos, grants,
        fingerprint: createHash("sha256").update(JSON.stringify({ cols, cons, idx, pol, rls, trg, fn, caps, pos, grants })).digest("hex") };
    }
    if (process.argv.includes("--ai410")) {
      // AI-FAIR-USE-01, migration 410: ledger, allowances, rates, guards, accounting functions and grants.
      const T = ["ai_price", "ai_fx_rate", "ai_cau_rate", "ai_allowance_account", "ai_usage_ledger"];
      const cols = await q(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = any($1) order by 1, 2`, [T]);
      const cons = await q(`select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid::regclass::text = any($1) order by 1, 2`, [T]);
      const idx = await q(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = any($1) order by 1, 2`, [T]);
      const pol = await q(`select tablename, policyname from pg_policies where tablename = any($1) order by 1, 2`, [T]);
      const rls = await q(`select relname, relrowsecurity from pg_class where relname = any($1) order by 1`, [T]);
      const trg = await q(`select tgname, pg_get_triggerdef(oid) as def from pg_trigger where tgname like 'ai\\_%' order by 1`);
      const fn = await q(`select p.proname, md5(pg_get_functiondef(p.oid)) as def_md5,
        has_function_privilege('anon', p.oid, 'execute') as anon_exec from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('ai_reserve', 'ai_settle', 'ai_release', 'ai_release_stale', 'ai_price_at', 'ai_rate_history_guard', 'ai_usage_ledger_guard', 'ai_allowance_account_guard') order by 1`);
      const caps = await q(`select code, space from hq_capability where code = 'hq.platform.ai.manage'`);
      const grants = await q(`select position_code, capability_code from hq_position_capability where capability_code = 'hq.platform.ai.manage' and effective_to is null order by 1`);
      out.ai410 = { tables: [...new Set(cols.map((c: any) => c.table_name))], constraints: cons.length, indexes: idx.length, policies: pol.length, rls, triggers: trg.length, functions: fn, caps, grants,
        fingerprint: createHash("sha256").update(JSON.stringify({ cols, cons, idx, pol, rls, trg, fn, caps, grants })).digest("hex") };
    }
    for (const flag of ["--ai411", "--ai412"] as const) if (process.argv.includes(flag)) {
      // AI-FAIR-USE-01, migrations 411 and 412 (same reading, named by the flag): the 410 tables as widened, the two new tables, every AI guard and accounting
      // function with who may execute it. PRE must equal the state after the matching ROLLBACK. ai_risk_rank exists only from 412.
      const T = ["ai_price", "ai_fx_rate", "ai_cau_rate", "ai_cau_basis", "ai_model_eligibility", "ai_allowance_account", "ai_usage_ledger"];
      const cols = await q(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = any($1) order by 1, 2`, [T]);
      const cons = await q(`select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid::regclass::text = any($1) order by 1, 2`, [T]);
      const idx = await q(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = any($1) order by 1, 2`, [T]);
      const pol = await q(`select tablename, policyname from pg_policies where tablename = any($1) order by 1, 2`, [T]);
      const rls = await q(`select relname, relrowsecurity from pg_class where relname = any($1) order by 1`, [T]);
      const trg = await q(`select tgname, pg_get_triggerdef(oid) as def from pg_trigger where tgname like 'ai\\_%' order by 1`);
      const fn = await q(`select p.proname, p.pronargs, md5(pg_get_functiondef(p.oid)) as def_md5,
        has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
        has_function_privilege('service_role', p.oid, 'execute') as service_exec from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('ai_reserve', 'ai_settle', 'ai_release', 'ai_release_stale', 'ai_mark_unreconciled', 'ai_price_at',
          'ai_rate_history_guard', 'ai_usage_ledger_guard', 'ai_allowance_account_guard', 'ai_risk_rank') order by 1, 2`);
      out[flag.slice(2)] = { tables: [...new Set(cols.map((c: any) => c.table_name))], constraints: cons.length, indexes: idx.length, policies: pol.length, rls, triggers: trg.length,
        functions: fn.map((f: any) => `${f.proname}/${f.pronargs}`),
        fingerprint: createHash("sha256").update(JSON.stringify({ cols, cons, idx, pol, rls, trg, fn })).digest("hex") };
    }
    if (process.argv.includes("--ai420")) {
      // Migration 420: the scale of every AI amount column. The other AI readings take data_type only ("numeric"),
      // which cannot see a precision or scale change -- this one does.
      const cols = await q(`select table_name, column_name, numeric_precision, numeric_scale from information_schema.columns
        where table_schema = 'public' and table_name like 'ai\\_%' and data_type = 'numeric' order by 1, 2`);
      out.ai420 = { account: cols.filter((c: any) => c.table_name === "ai_allowance_account").map((c: any) => `${c.column_name}:${c.numeric_precision},${c.numeric_scale}`),
        fingerprint: createHash("sha256").update(JSON.stringify(cols)).digest("hex") };
    }
    if (process.argv.includes("--ai419")) {
      // IND-007 D5, migration 419: the model-evaluation evidence tables, their guards and functions.
      const T = ["ai_model_evaluation_run", "ai_model_evaluation_result", "ai_model_evaluation_proposal"];
      const cols = await q(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = any($1) order by 1, 2`, [T]);
      const cons = await q(`select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid::regclass::text = any($1) order by 1, 2`, [T]);
      const idx = await q(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = any($1) order by 1, 2`, [T]);
      const pol = await q(`select tablename, policyname from pg_policies where tablename = any($1) order by 1, 2`, [T]);
      const rls = await q(`select relname, relrowsecurity from pg_class where relname = any($1) order by 1`, [T]);
      const trg = await q(`select tgname, pg_get_triggerdef(oid) as def from pg_trigger where tgname like 'ai\\_model\\_evaluation%' order by 1`);
      const fn = await q(`select p.proname, md5(pg_get_functiondef(p.oid)) as def_md5 from pg_proc p where p.proname in ('ai_model_evaluation_run_guard', 'ai_model_evaluation_evidence_guard') order by 1`);
      out.ai419 = { tables: [...new Set(cols.map((c: any) => c.table_name))], constraints: cons.length, indexes: idx.length, policies: pol.length, rls, triggers: trg.length, functions: fn.length,
        fingerprint: createHash("sha256").update(JSON.stringify({ cols, cons, idx, pol, rls, trg, fn })).digest("hex") };
    }
    if (process.argv.includes("--s1")) {
      // COMPETEN-SCHOLAR-01 S1, migration 384, before and after (and through its rollback rehearsal): the four
      // columns, their constraints and index, and how many frameworks are classified. Hashed for comparison.
      const cols = await q(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and ((table_name = 'frameworks' and column_name in ('competency_layer', 'profession_term_id'))
          or (table_name = 'framework_competencies' and column_name in ('learning_outcomes', 'expected_level_id'))) order by 1, 2`);
      const cons = await q(`select conname, pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid in ('frameworks'::regclass, 'framework_competencies'::regclass)
          and (conname like '%competency_layer%' or conname like '%layer_profession%' or conname like '%learning_outcomes%'
            or conname like '%profession_term_id%' or conname like '%expected_level_id%') order by 1`);
      const idx = await q(`select indexname, indexdef from pg_indexes where indexname = 'idx_frameworks_competency_layer'`);
      out.s1 = {
        columns: cols, constraints: cons, index: idx,
        fingerprint: createHash("sha256").update(JSON.stringify({ cols, cons, idx })).digest("hex"),
        classified: hasLayer(cols) ? await q(`select competency_layer, count(*)::int as n from frameworks group by 1 order by 1`) : "column absent",
      };
    }
    if (process.argv.includes("--reset")) {
      // HQ-USERS-B migrations 382 and 383, before and after (and through 383's rollback rehearsal): the
      // reservation function's definition, settings and grants, and the chief_executive grants. Hashed, so
      // "re-applied equals first applied" is one comparison.
      const fn = await q(`select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef, p.proconfig,
          md5(pg_get_functiondef(p.oid)) as def_md5
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'hq_reserve_password_reset'`);
      const grants = await q(`select grantee, privilege_type from information_schema.routine_privileges
        where routine_schema = 'public' and routine_name = 'hq_reserve_password_reset' order by grantee, privilege_type`);
      const ceo = await q(`select capability_code, effective_to from hq_position_capability
        where position_code = 'chief_executive' order by capability_code`);
      const dupes = await q(`select position_code, capability_code, count(*)::int as n from hq_position_capability
        where effective_to is null group by 1, 2 having count(*) > 1`);
      out.reset383 = { function: fn, grants, fingerprint: createHash("sha256").update(JSON.stringify({ fn, grants })).digest("hex") };
      out.ceo382 = { grants: ceo, duplicateOpenGrants: dupes };
    }
    if (process.argv.includes("--detail")) {
      out.policies = fp.policies;
      out.generated = fp.columns.filter(r => r.is_generated === "ALWAYS");
      out.compositeForeignKeys = fp.constraints.filter(r => /foreign key \(\w+, user_id\)/i.test(r.def));
      out.verifiedColumns = fp.columns.filter(r => /verif/i.test(r.column_name));
      out.scopeColumns = fp.columns.filter(r => /^(hospital_id|organisation_id|tenant_id|workspace_id)$/.test(r.column_name));
      // Migration 374: the reminder preference columns on the own profile row.
      out.reminderColumns = fp.columns.filter(r => /^reminder_(in_app|email)$/.test(r.column_name));
    }
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await c.query("rollback");
    await c.end();
  }
}
main().catch(e => { console.error(String(e?.message ?? e)); process.exit(1); });
