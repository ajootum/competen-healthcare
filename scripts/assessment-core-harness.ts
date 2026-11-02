/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ASSESSMENT CORE HARNESS (Checklist Studio). Sections are independent. Each slice adds its own.
 *
 *   npx tsx scripts/assessment-core-harness.ts            static sections only (no database)
 *   npx tsx scripts/assessment-core-harness.ts db         S1a database proofs on STAGING (rolls back, keeps nothing)
 *   npx tsx scripts/assessment-core-harness.ts scholar    S3a database proofs of migration 893 (Scholar adapter) on STAGING
 *   npx tsx scripts/assessment-core-harness.ts all        static, db and scholar
 *   npx tsx scripts/assessment-core-harness.ts all        both, then the catalogue and its acceptance
 *   npx tsx scripts/assessment-core-harness.ts catalogue  catalogue (894) static checks, DB proofs with planted reds, acceptance
 *   npx tsx scripts/assessment-core-harness.ts catalogue-static   the catalogue static checks only (no database)
 *   npx tsx scripts/assessment-core-harness.ts acceptance the three example instruments on STAGING (rolled back)
 *
 * SECTION S1a -- DATABASE (migrations 890, 891, 892)
 *   S1a.static  the literal ban. The core DDL knows no profession, framework or proficiency model. Comments are
 *               stripped first (a needle must never match its own documentation). The only exemptions are the
 *               two references the design allows: the existing function competency_appointment_holds and the
 *               existing capability hq.quality.clinical.approve. Controls: the strip did not empty the file, and a
 *               planted word in a copy is caught.
 *   S1a.db      scripts/sql/asmt-core-proofs.sql run inside one transaction on STAGING (it ends by raising its
 *               RESULT line, so nothing is kept). Then each CONTROL is planted (a trigger disabled or a
 *               constraint dropped inside that same rolled back transaction) and the proofs that depend on it must
 *               go red. A harness that always passes is worth nothing.
 *
 * It refuses production in every way the staging runner does and never reads or prints a credential.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const PRODUCTION_REF = "rnnqhlrcgvsauigxwszl";
const MIGRATIONS = ["890-asmt-core-definitions.sql", "891-asmt-capture.sql", "892-asmt-progression.sql"];
const PROOF_FILE = resolve(__dirname, "sql/asmt-core-proofs.sql");
const SCHOLAR_PROOF_FILE = resolve(__dirname, "sql/asmt-scholar-proofs.sql");

let bad = 0;
const ok = (id: string, name: string, cond: boolean, evidence = "") => {
  if (!cond) bad++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${id}. ${name}${cond ? "" : evidence ? ` -- ${evidence}` : ""}`);
};

// ---- S1a.static -------------------------------------------------------------------------------------------------

/** True when the `--` at `at` opens a comment rather than sitting inside a string literal. */
const opensComment = (line: string, at: number) => ((line.slice(0, at).match(/'/g) ?? []).length) % 2 === 0;
export const stripSqlComments = (sql: string) =>
  sql.split(/\r?\n/).map(l => { const at = l.indexOf("--"); return at >= 0 && opensComment(l, at) ? l.slice(0, at) : l; }).join("\n");

/** Words the universal core must not contain. The two exemptions are removed before the scan. */
export const BANNED = /nurs|competenc|criteri|learner|scholar|benner|dacum|clinical/i;
const EXEMPT = ["competency_appointment_holds", "hq.quality.clinical.approve"];
export function literalBanHits(sql: string): string[] {
  let code = stripSqlComments(sql);
  for (const e of EXEMPT) code = code.split(e).join("");
  const hits: string[] = [];
  code.split("\n").forEach((l, i) => { const m = BANNED.exec(l); if (m) hits.push(`line ${i + 1}: ${m[0]}: ${l.trim().slice(0, 90)}`); });
  return hits;
}

function staticSection() {
  console.log("\nS1a.static  the literal ban over migrations 890-892 (comments stripped)\n");
  for (const f of MIGRATIONS) {
    const path = resolve(__dirname, "../supabase/migrations", f);
    const sql = readFileSync(path, "utf8");
    const stripped = stripSqlComments(sql);
    ok(`${f.slice(0, 3)}.control`, `${f}: stripping comments left real code (${stripped.length} of ${sql.length} chars)`, stripped.length > sql.length * 0.5 && /create table/i.test(stripped));
    const hits = literalBanHits(sql);
    ok(`${f.slice(0, 3)}.ban`, `${f}: no profession, framework or proficiency word outside comments`, hits.length === 0, hits.slice(0, 3).join(" | "));
    // plant: a banned word in code must be caught
    const planted = literalBanHits(stripped + "\ncreate table if not exists asmt_nursing_note (id uuid);\n");
    ok(`${f.slice(0, 3)}.red`, `${f}: a planted word in code is caught`, planted.length >= 1);
    // plant: the same word in a comment is not (the strip works)
    const commented = literalBanHits(stripped + "\n-- nursing competency learner scholar benner dacum clinical criteria\n");
    ok(`${f.slice(0, 3)}.red2`, `${f}: the same words inside a comment are ignored`, commented.length === 0);
  }
  // the exemptions are the only ones and they are really used
  const all = MIGRATIONS.map(f => stripSqlComments(readFileSync(resolve(__dirname, "../supabase/migrations", f), "utf8"))).join("\n");
  ok("S1a.exempt", "both design exemptions are the only references to a domain authority", EXEMPT.every(e => all.includes(e)));
  ok("S1a.noverified", "no column or value named verified anywhere in the core DDL", !/verified/i.test(all));
}

// ---- S1a.db -----------------------------------------------------------------------------------------------------

type Plant = { name: string; control: string; sql: string; expect: string[] };
const dis = (t: string, trg: string) => `execute 'alter table ${t} disable trigger ${trg}';`;
const drop = (t: string, c: string) => `execute 'alter table ${t} drop constraint ${c}';`;
const VERSION_TABLES = [
  ["asmt_instrument_version", "asmt_instrument_version_lifecycle"], ["asmt_response_scale_version", "asmt_response_scale_version_lifecycle"],
  ["asmt_rule_template_version", "asmt_rule_template_version_lifecycle"], ["asmt_layout_template_version", "asmt_layout_template_version_lifecycle"],
  ["asmt_progression_rule_version", "asmt_progression_rule_version_lifecycle"],
];
const FREEZE = [
  ["asmt_group", "asmt_group_freeze"], ["asmt_section", "asmt_section_freeze"], ["asmt_item", "asmt_item_freeze"], ["asmt_item_field", "asmt_item_field_freeze"],
  ["asmt_mapping", "asmt_mapping_freeze"], ["asmt_version_layout", "asmt_version_layout_freeze"], ["asmt_version_tag", "asmt_version_tag_freeze"],
  ["asmt_response_scale_level", "asmt_response_scale_level_freeze"], ["asmt_response_scale_state", "asmt_response_scale_state_freeze"],
];
/** The lifecycle function with every CHECK removed. It keeps only the plumbing (numbering, hash, timestamps), so the setup still runs. */
const PERMISSIVE_LIFECYCLE = `execute $plant$
create or replace function public.asmt_version_lifecycle_guard() returns trigger language plpgsql set search_path = public, pg_catalog as $f$
declare v_no int; v_pcol text := public.asmt_version_parent_col(tg_table_name);
begin
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'INSERT' then
    if new.version_no is null then
      execute format('select coalesce(max(version_no), 0) + 1 from %I where %I = $1', tg_table_name, v_pcol) into v_no using (to_jsonb(new) ->> v_pcol)::uuid;
      new.version_no := v_no;
    end if;
    new.edited_by := '{}';
    return new;
  end if;
  if new.state = 'in_review' and old.state = 'draft' then
    new.submitted_at := now();
    new.content_hash := public.asmt_version_content_hash(tg_table_name, new.id, to_jsonb(new));
  end if;
  if new.state = 'published' and old.state <> 'published' then new.published_at := now(); end if;
  if new.state = 'retired' and old.state <> 'retired' then new.retired_at := now(); end if;
  if new.state = 'draft' then new.content_hash := null; end if;
  return new;
end $f$ $plant$;`;
/** The instance guard with every refusal removed, keeping only the status plumbing. */
const PERMISSIVE_INSTANCE = `execute $plant$
create or replace function public.asmt_instance_guard() returns trigger language plpgsql set search_path = public, pg_catalog as $f$
begin
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and new.status = 'submitted' and old.status <> 'submitted' then new.submitted_at := now(); end if;
  return new;
end $f$ $plant$;`;
export const PLANTS: Plant[] = [
  { name: "lifecycle guard removed", control: "asmt_version_lifecycle_guard on every version table",
    sql: PERMISSIVE_LIFECYCLE, expect: ["A1", "A5", "A6", "A10", "B3", "B3b", "B4", "B5", "B6", "B11", "B12", "B15", "B17", "B18"] },
  { name: "child freeze guard removed", control: "asmt_child_freeze_guard on the content tables",
    sql: FREEZE.map(([t, g]) => dis(t, g)).join("\n"), expect: ["A7", "A8", "A9", "A3", "A4", "A11"] },
  { name: "review decision independence removed", control: "asmt_review_decision_sod_guard",
    sql: dis("asmt_review_decision", "asmt_review_decision_sod"), expect: ["B1", "B2", "B7", "B8", "B9"] },
  { name: "attestation checks removed", control: "asmt_instance attestation and self checks",
    sql: [drop("asmt_instance", "asmt_instance_attestation_check"), drop("asmt_instance", "asmt_instance_self_check")].join("\n"), expect: ["C1", "C2", "C2b", "C3"] },
  { name: "instance guard removed", control: "asmt_instance_guard (published version, live grant, appointment)",
    sql: PERMISSIVE_INSTANCE, expect: ["C4", "C5", "C6", "C8", "C9", "C13"] },
  { name: "respondent grant guard removed", control: "asmt_respondent_grant_guard and the apart check",
    sql: [dis("asmt_respondent_grant", "asmt_respondent_grant_guard"), drop("asmt_respondent_grant", "asmt_respondent_grant_apart_check")].join("\n"), expect: ["D1", "D2", "D3", "D4", "D6", "D9", "D12"] },
  { name: "response guard removed", control: "asmt_response_guard (validation and computed satisfactory)",
    sql: dis("asmt_response", "asmt_response_guard"), expect: ["E1", "E2", "E3", "E5", "E6", "E6b", "E6e", "F10"] },
  { name: "outcome backstop removed", control: "asmt_outcome_guard (critical and mandatory backstop)",
    sql: dis("asmt_outcome", "asmt_outcome_guard"), expect: ["F1", "F2", "F3", "F8", "G2"] },
  { name: "append-only trails removed", control: "asmt_append_only_guard on outcome, evidence, comment, decision",
    sql: [dis("asmt_outcome", "asmt_outcome_append_only"), dis("asmt_evidence", "asmt_evidence_append_only"), dis("asmt_comment", "asmt_comment_append_only"),
          dis("asmt_progression_decision", "asmt_progression_decision_append_only")].join("\n"), expect: ["F7", "F7b", "H1", "H2", "H4", "J5"] },
  { name: "definition guard removed", control: "asmt_definition_guard (permanent code and family)",
    sql: dis("asmt_instrument", "asmt_instrument_definition_guard"), expect: ["N2", "N3"] },
  { name: "progression decision guard removed", control: "asmt_progression_decision_guard and the standing check",
    sql: [dis("asmt_progression_decision", "asmt_progression_decision_guard"), drop("asmt_progression_decision", "asmt_progression_decision_standing_check")].join("\n"), expect: ["J2", "J3", "J4", "J8", "J9"] },
  { name: "row level security off", control: "own-row RLS on instances and definitions",
    sql: "execute 'alter table asmt_instance disable row level security';\nexecute 'alter table asmt_instrument disable row level security';", expect: ["K1b", "K2"] },
  { name: "layout pin guard removed", control: "asmt_instance_layout_guard",
    sql: dis("asmt_instance_layout", "asmt_instance_layout_guard"), expect: ["L2", "L3", "L4"] },
  { name: "a constraint that rejects a shape", control: "the second shape inserts without DDL change",
    sql: "execute 'alter table asmt_item add constraint zz_plant check (response_type <> ''free_text'')';", expect: ["G1b", "G2b"] },
];

function stagingUrl(): string {
  let conn = process.env.STAGING_DB_URL ?? "";
  if (!conn) {
    for (const p of [resolve(process.cwd(), ".env.local"), "C:/Users/elish/Documents/Competen/competen-healthcare/.env.local"]) {
      if (existsSync(p)) { const m = readFileSync(p, "utf8").match(/^STAGING_DB_URL=(.*)$/m); if (m) { conn = m[1].trim().replace(/^"|"$/g, ""); break; } }
    }
  }
  const pooler = conn.match(/^postgres(?:ql)?:\/\/postgres\.([a-z0-9]{20})[:@]/)?.[1] ?? null;
  const direct = conn.match(/@db\.([a-z0-9]{20})\.supabase\.co(?:[:/]|$)/)?.[1] ?? null;
  const ref = pooler && direct && pooler !== direct ? null : (pooler ?? direct);
  if (!ref) throw new Error("STAGING_DB_URL does not identify one Supabase project");
  if (ref === PRODUCTION_REF || conn.includes(PRODUCTION_REF)) throw new Error("REFUSING: that connection is PRODUCTION");
  return conn;
}

async function runProofs(client: any, plantSql: string, proofFile: string = PROOF_FILE, resultTag: string = "ASMT PROOFS"): Promise<{ pass: number; fail: number; failed: string[]; raw: string }> {
  const base = readFileSync(proofFile, "utf8");
  if (!base.includes("-- @@PLANT@@")) throw new Error("the proof file lost its plant marker");
  const sql = base.replace("-- @@PLANT@@", plantSql);
  await client.query("begin");
  try {
    await client.query(sql);
    return { pass: 0, fail: 0, failed: [], raw: "the proof block did not raise its RESULT" };
  } catch (e: any) {
    const msg = String(e.message ?? e);
    const m = msg.match(new RegExp("RESULT " + resultTag + " pass=(\\d+) fail=(\\d+) failed:\\s*(.*)$"));
    if (!m) return { pass: 0, fail: -1, failed: [], raw: msg };
    return { pass: +m[1], fail: +m[2], failed: m[3].trim() ? m[3].trim().split(/\s+/) : [], raw: msg };
  } finally {
    await client.query("rollback").catch(() => {});
  }
}

async function dbSection() {
  console.log("\nS1a.db  database proofs on STAGING (each run rolls back and keeps nothing)\n");
  const require = createRequire(resolve(process.cwd(), "package.json"));
  const { Client } = require("pg");
  const client = new Client({ connectionString: stagingUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const base = await runProofs(client, "");
    ok("S1a.db.base", `all proofs pass with every control in place (pass=${base.pass} fail=${base.fail})`, base.fail === 0 && base.pass > 0, base.fail < 0 ? base.raw : `failed: ${base.failed.join(" ")}`);
    if (base.fail !== 0) console.log(`      ${base.raw.slice(0, 600)}`);
    for (const p of PLANTS) {
      const r = await runProofs(client, p.sql);
      const missing = p.expect.filter(id => !r.failed.includes(id));
      ok(`S1a.db.red`, `planted: ${p.name} -> red on ${p.expect.join(" ")}`, r.fail > 0 && missing.length === 0,
        r.fail < 0 ? r.raw.slice(0, 300) : `not red: ${missing.join(" ")}; failed was: ${r.failed.join(" ")}`);
    }
  } finally {
    await client.end();
  }
}

// ---- S3a.scholar ------------------------------------------------------------------------------------------------
// Migration 893 (the Scholar competency adapter). scripts/sql/asmt-scholar-proofs.sql reads the real staging DACUM 0-6 scale
// with its published mapping, the real NUR-CCF Respiratory Assessment criteria and the real assessment components, and plants
// everything else inside one rolled back transaction. Each CONTROL is then broken in that same transaction and the proofs
// that depend on it must go red.
const SCHOLAR_RESULT = "ASMT SCHOLAR PROOFS";
const fnBody = (name: string, args: string, body: string) => `execute $plant$ create or replace function public.${name}(${args}) ${body} $plant$;`;
export const SCHOLAR_PLANTS: Plant[] = [
  { name: "mapping guard trigger removed", control: "asmt_instrument_version_scholar_check",
    sql: dis("asmt_instrument_version", "asmt_instrument_version_scholar_check"), expect: ["M1", "M2", "M2c", "M3", "M8"] },
  { name: "mapping check permissive", control: "asmt_scholar_mapping_check",
    sql: fnBody("asmt_scholar_mapping_check", "p_version uuid", `returns jsonb language sql as $b$ select '{"ok":true,"problems":[]}'::jsonb $b$`),
    expect: ["M0", "M1", "M1a", "M2", "M2a", "M2b", "M3", "M4", "M5", "M8", "M8b", "M9"] },
  { name: "clinical approval always true", control: "competency_clinically_approved",
    sql: fnBody("competency_clinically_approved", "p_competency uuid", `returns boolean language sql stable as $b$ select true $b$`), expect: ["M0", "M3", "M8b", "C3"] },
  { name: "scale level satisfactory forced", control: "satisfactory copied from is_passing in the import",
    sql: `execute $plant$ create or replace function public.zz_plant_sat() returns trigger language plpgsql as $b$ begin new.satisfactory := true; return new; end $b$ $plant$;
execute 'create trigger zz_plant_sat before insert on asmt_response_scale_level for each row execute function public.zz_plant_sat()';`, expect: ["I2", "I2b", "I3b"] },
  { name: "stage band guard removed", control: "asmt_scholar_stage_band_guard",
    sql: dis("asmt_scholar_stage_band", "asmt_scholar_stage_band_guard"), expect: ["I9", "I9b", "I11", "I11b", "I11c"] },
  { name: "assessment component retired", control: "groups come from the active components",
    sql: "execute 'update competency_assessment_component set is_active = false where code = ''knowledge''';", expect: ["G1", "G2"] },
  { name: "erasure trigger removed", control: "asmt_scholar_erasure_run",
    sql: dis("asmt_scholar_erasure", "asmt_scholar_erasure_run"), expect: ["E2", "E3", "E5"] },
  { name: "erasure receipt not append-only", control: "asmt_scholar_erasure_append_only",
    sql: dis("asmt_scholar_erasure", "asmt_scholar_erasure_append_only"), expect: ["E6", "E6b"] },
  { name: "adapter function opened to signed-in people", control: "execute rights are service role only",
    sql: "execute 'grant execute on function public.asmt_scholar_erase_user(uuid) to authenticated';", expect: ["P1"] },
];

// ---- catalogue (migration 894) ----------------------------------------------------------------------------------

const CAT_PROOF = resolve(__dirname, "sql/asmt-catalogue-proofs.sql");
const CAT_ACCEPT = resolve(__dirname, "sql/asmt-catalogue-acceptance.sql");
const CAT_DIR = resolve(__dirname, "../src/lib/assessment/catalogue");
const CAT_MIGRATION = resolve(__dirname, "../supabase/migrations/894-asmt-catalogue.sql");
/** Tables the catalogue must never read: instances, responses, evidence, outcomes, progression and grants. */
export const CAT_FORBIDDEN_TABLES = ["asmt_instance", "asmt_instance_layout", "asmt_response", "asmt_evidence", "asmt_comment", "asmt_outcome",
  "asmt_respondent_grant", "asmt_progression_decision"];

/** Every .ts and .tsx file below a directory (tests included). */
function filesBelow(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = resolve(dir, e);
    if (statSync(p).isDirectory()) out.push(...filesBelow(p));
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}
export const stripTsComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const CAT_BANNED = /nurs|competenc|criteri|learner|scholar|benner|dacum|clinical/i;
export function catalogueSourceHits(src: string): string[] {
  const hits: string[] = [];
  stripTsComments(src).split("\n").forEach((l, i) => { const m = CAT_BANNED.exec(l); if (m) hits.push(`line ${i + 1}: ${m[0]}: ${l.trim().slice(0, 80)}`); });
  return hits;
}
/** Tables named in .from("...") in a source file, comments stripped. */
export function tablesNamed(src: string): string[] {
  return [...stripTsComments(src).matchAll(/\.from\(\s*["'`]([a-z_0-9]+)["'`]/g)].map(m => m[1]);
}
/** Function bodies of a migration, the text between dollar quotes, comments stripped. */
export function sqlFunctionBodies(sql: string): string {
  const code = stripSqlComments(sql);
  return [...code.matchAll(/\$\$([\s\S]*?)\$\$/g)].map(m => m[1]).join("\n");
}

function catalogueStatic() {
  console.log("\ncatalogue.static  no domain literal in the catalogue code, no read of the capture tables, universal function bodies\n");
  const files = filesBelow(CAT_DIR);
  ok("CAT.s0", "the catalogue code directory exists and has files (a walker that finds none proves nothing)", files.length >= 8, `${files.length} files`);
  let lit = 0, forb = 0;
  const named = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    lit += catalogueSourceHits(src).length;
    for (const t of tablesNamed(src)) { named.add(t); if (CAT_FORBIDDEN_TABLES.includes(t)) forb++; }
  }
  ok("CAT.s1", "no nursing, competency, learner or framework literal outside comments in src/lib/assessment/catalogue/**", lit === 0, `${lit} hit(s)`);
  ok("CAT.s2", "no catalogue file reads an instance, response, evidence, outcome, grant or progression table", forb === 0, `${forb} read(s)`);
  ok("CAT.s2b", "the walker really sees tables (the catalogue names asmt_instrument and asmt_catalogue_term)", named.has("asmt_instrument") && named.has("asmt_catalogue_term"), [...named].join(","));
  ok("CAT.s3", "a planted word in catalogue source is caught", catalogueSourceHits("export const x = 'nursing';").length === 1 && catalogueSourceHits("// nursing in a comment\nexport const y = 1;").length === 0);
  ok("CAT.s4", "a planted read of asmt_instance is caught by the table scan", tablesNamed('a.from("asmt_instance").select("id")').some(t => CAT_FORBIDDEN_TABLES.includes(t)));
  const sql = readFileSync(CAT_MIGRATION, "utf8");
  const bodies = sqlFunctionBodies(sql);
  ok("CAT.m0", "894: the function bodies were extracted (control)", bodies.length > 2000 && /insert into asmt_instrument/.test(bodies), `${bodies.length} chars`);
  const mHits = bodies.split("\n").filter(l => CAT_BANNED.test(l));
  ok("CAT.m1", "894: no profession, framework or proficiency word in any function body (the seed labels are data)", mHits.length === 0, mHits.slice(0, 2).join(" | "));
  ok("CAT.m2", "894: a planted word in a function body is caught", sqlFunctionBodies("create function f() returns int as $$ select 'nursing' $$;").split("\n").some(l => CAT_BANNED.test(l)));
  const code = stripSqlComments(sql);
  ok("CAT.m3", "894: no partial unique index", !/create\s+unique\s+index[^;]*\bwhere\b/i.test(code));
  ok("CAT.m4", "894: RLS is enabled on every created table and no policy is created",
    (code.match(/create table if not exists asmt_/g) ?? []).length === (code.match(/alter table asmt_[a-z_]+ enable row level security/g) ?? []).length && !/create policy/i.test(code));
}

export const CATALOGUE_PLANTS: Plant[] = [
  { name: "one-primary trigger removed", control: "asmt_instrument_term_guard", sql: dis("asmt_instrument_term", "asmt_instrument_term_guard"), expect: ["L2", "L4", "L5"] },
  { name: "term hierarchy guard removed", control: "asmt_catalogue_term_guard", sql: dis("asmt_catalogue_term", "asmt_catalogue_term_guard"), expect: ["M1", "M3", "M4"] },
  { name: "availability mode check dropped", control: "asmt_instrument_availability_mode_check", sql: drop("asmt_instrument_availability", "asmt_instrument_availability_mode_check"), expect: ["N2"] },
  { name: "relation self-link check dropped", control: "asmt_instrument_relation_self_check", sql: drop("asmt_instrument_relation", "asmt_instrument_relation_self_check"), expect: ["O2b"] },
  { name: "definition guard removed", control: "asmt_definition_guard (code, family, kind permanent)", sql: dis("asmt_instrument", "asmt_instrument_definition_guard"), expect: ["K4", "K4b", "K5b"] },
  { name: "code assignment broken", control: "asmt_assign_catalogue_code per-family counter",
    sql: "execute $plant$ create or replace function public.asmt_assign_catalogue_code(p_family text) returns text language sql as $f$ select p_family || '-' || lpad((floor(random() * 900000) + 1)::text, 6, '0') $f$ $plant$;",
    expect: ["K1", "K2"] },
  { name: "search words ignored", control: "asmt_catalogue_tsv (title and description search)",
    sql: "execute $plant$ create or replace function public.asmt_catalogue_tsv(p_name text, p_description text, p_code text) returns tsvector language sql immutable as $f$ select ''::tsvector $f$ $plant$;",
    expect: ["R1", "R1b", "R3"] },
  { name: "duplicate warning removed", control: "asmt_catalogue_similar",
    sql: "execute $plant$ create or replace function public.asmt_catalogue_similar(p_title text, p_family text default null) returns table (id uuid, code text, name text, family_code text, family_label text, score numeric, same_family boolean) language sql stable as $f$ select null::uuid, null::text, null::text, null::text, null::text, null::numeric, null::boolean where false $f$ $plant$;",
    expect: ["S1", "S2"] },
  { name: "audit event helper removed", control: "asmt_catalogue_event",
    sql: "execute $plant$ create or replace function public.asmt_catalogue_event(p_instrument uuid, p_event text, p_actor uuid, p_detail jsonb) returns void language sql as $f$ select $f$ $plant$;",
    expect: ["T1", "T2", "T3", "T4", "T5"] },
  { name: "row level security off", control: "RLS on the catalogue tables", sql: "execute 'alter table asmt_collection disable row level security';", expect: ["U2"] },
];

async function scholarSection() {
  console.log("\nS3a.scholar  migration 893 database proofs on STAGING (each run rolls back and keeps nothing)\n");
  const require = createRequire(resolve(process.cwd(), "package.json"));
  const { Client } = require("pg");
  const client = new Client({ connectionString: stagingUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const base = await runProofs(client, "", SCHOLAR_PROOF_FILE, SCHOLAR_RESULT);
    ok("S3a.scholar.base", `all proofs pass with every control in place (pass=${base.pass} fail=${base.fail})`, base.fail === 0 && base.pass > 0, base.fail < 0 ? base.raw.slice(0, 600) : `failed: ${base.failed.join(" ")}`);
    for (const p of SCHOLAR_PLANTS) {
      const r = await runProofs(client, p.sql, SCHOLAR_PROOF_FILE, SCHOLAR_RESULT);
      const missing = p.expect.filter(id => !r.failed.includes(id));
      ok(`S3a.scholar.red`, `planted: ${p.name} -> red on ${p.expect.join(" ")}`, r.fail > 0 && missing.length === 0,
        r.fail < 0 ? r.raw.slice(0, 300) : `not red: ${missing.join(" ")}; failed was: ${r.failed.join(" ")}`);
    }
  } finally {
    await client.end();
  }
}

async function catalogueDb() {
  console.log("\ncatalogue.db  database proofs on STAGING (each run rolls back and keeps nothing)\n");
  const require = createRequire(resolve(process.cwd(), "package.json"));
  const { Client } = require("pg");
  const client = new Client({ connectionString: stagingUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const base = await runProofs(client, "", CAT_PROOF, "ASMT CATALOGUE PROOFS");
    ok("CAT.db.base", `all catalogue proofs pass with every control in place (pass=${base.pass} fail=${base.fail})`, base.fail === 0 && base.pass > 0, base.fail < 0 ? base.raw : `failed: ${base.failed.join(" ")}`);
    if (base.fail !== 0) console.log(`      ${base.raw.slice(0, 600)}`);
    for (const p of CATALOGUE_PLANTS) {
      const r = await runProofs(client, p.sql, CAT_PROOF, "ASMT CATALOGUE PROOFS");
      const missing = p.expect.filter(id => !r.failed.includes(id));
      ok("CAT.db.red", `planted: ${p.name} -> red on ${p.expect.join(" ")}`, r.fail > 0 && missing.length === 0,
        r.fail < 0 ? r.raw.slice(0, 300) : `not red: ${missing.join(" ")}; failed was: ${r.failed.join(" ")}`);
    }
  } finally {
    await client.end();
  }
}

async function catalogueAcceptance() {
  console.log("\ncatalogue.acceptance  the three owner example instruments on STAGING (rolled back, keeps nothing)\n");
  const require = createRequire(resolve(process.cwd(), "package.json"));
  const { Client } = require("pg");
  const client = new Client({ connectionString: stagingUrl(), ssl: { rejectUnauthorized: false } });
  client.on("notice", (m: any) => { if (String(m.message).startsWith("ACCEPT")) console.log("   " + m.message); });
  await client.connect();
  try {
    const r = await runProofs(client, "", CAT_ACCEPT, "ASMT CATALOGUE ACCEPTANCE");
    ok("CAT.acceptance", `acceptance passes (pass=${r.pass} fail=${r.fail})`, r.fail === 0 && r.pass > 0, r.fail < 0 ? r.raw.slice(0, 400) : `failed: ${r.failed.join(" ")}`);
  } finally {
    await client.end();
  }
}

async function main() {
  const arg = process.argv[2] ?? "static";
  if (arg === "static" || arg === "all") staticSection();
  if (arg === "db" || arg === "all") await dbSection();
  if (arg === "scholar" || arg === "all") await scholarSection();
  if (arg === "catalogue" || arg === "all") { catalogueStatic(); await catalogueDb(); }
  if (arg === "catalogue-static") catalogueStatic();
  if (arg === "acceptance" || arg === "catalogue" || arg === "all") await catalogueAcceptance();
  console.log(bad === 0 ? "\n  ALL PASS\n" : `\n  ${bad} FAILURE(S)\n`);
  process.exitCode = bad === 0 ? 0 : 1;
}
if (require.main === module) main().catch(e => { console.error(String(e.message ?? e)); process.exitCode = 1; });
