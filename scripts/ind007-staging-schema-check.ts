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

const require2 = createRequire(process.cwd() + "/");
require2("@next/env").loadEnvConfig(process.cwd());

const dbUrl = process.env.STAGING_DB_URL ?? "";
const prodRef = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;
if (!/^postgres(ql)?:\/\/\S+@\S+\/\S+/.test(dbUrl)) { console.error("STAGING_DB_URL is not set to a Postgres URL."); process.exit(1); }
if (!prodRef) { console.error("Cannot read the production ref; refusing rather than guessing."); process.exit(1); }
if (dbUrl.includes(prodRef)) { console.error(`REFUSING: STAGING_DB_URL points at PRODUCTION (${prodRef}).`); process.exit(1); }
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

    console.log(JSON.stringify(out, null, 2));
  } finally {
    await c.query("rollback");
    await c.end();
  }
}
main().catch(e => { console.error(String(e?.message ?? e)); process.exit(1); });
