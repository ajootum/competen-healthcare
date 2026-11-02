/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ASSESSMENT CORE HARNESS (Checklist Studio). Sections are independent. Each slice adds its own.
 *
 *   npx tsx scripts/assessment-core-harness.ts            static sections only (no database)
 *   npx tsx scripts/assessment-core-harness.ts db         S1a database proofs on STAGING (rolls back, keeps nothing)
 *   npx tsx scripts/assessment-core-harness.ts scholar    S3a database proofs of migration 893 (Scholar adapter) on STAGING
 *   npx tsx scripts/assessment-core-harness.ts all        both, then the catalogue and its acceptance
 *   npx tsx scripts/assessment-core-harness.ts catalogue  catalogue (894) static checks, DB proofs with planted reds, acceptance
 *   npx tsx scripts/assessment-core-harness.ts catalogue-static   the catalogue static checks only (no database)
 *   npx tsx scripts/assessment-core-harness.ts acceptance the three example instruments on STAGING (rolled back)
 *   npx tsx scripts/assessment-core-harness.ts assessor   assessor workspace (S4): static checks with planted reds, then DB proofs on STAGING
 *   npx tsx scripts/assessment-core-harness.ts assessor-static   the assessor static checks only (no database)
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
import { extractReads } from "../src/lib/access/plane-boundary-scan";

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

async function runProofs(client: any, plantSql: string, file = PROOF_FILE, label = "ASMT PROOFS"): Promise<{ pass: number; fail: number; failed: string[]; raw: string }> {
  const base = readFileSync(file, "utf8");
  if (!base.includes("-- @@PLANT@@")) throw new Error("the proof file lost its plant marker");
  const sql = base.replace("-- @@PLANT@@", plantSql);
  await client.query("begin");
  try {
    await client.query(sql);
    return { pass: 0, fail: 0, failed: [], raw: "the proof block did not raise its RESULT" };
  } catch (e: any) {
    const msg = String(e.message ?? e);
    const m = msg.match(new RegExp(`RESULT ${label} pass=(\\d+) fail=(\\d+) failed:\\s*(.*)$`));
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

// >>> ASSESSOR-WORKSPACE (Checklist Studio S4) ---------------------------------------------------------------------------------
// SECTION assessor -- the assessor-led workspace in the HQ plane.
//   assessor.static  every page and API route under checklist-assessments is gated by hqApiGate / requireHqCapability with an
//                    assessment capability BEFORE any read; every reader of an instance or grant in src/lib/assessment/assessor
//                    is filtered by the actor (respondent_id, or granted_by for the grants I made) and every reader of answers,
//                    evidence, comments and outcomes takes an instance proved to be the actor's; no AI import anywhere in the
//                    workspace; the literal ban covers src/lib/assessment/assessor/**; nothing writes verification or a
//                    progression decision table. Each control is PLANTED in a copy of the real source and must go red.
//   assessor.db      scripts/sql/asmt-assessor-proofs.sql on STAGING (rolls back): a coordinator makes a grant, the person accepts
//                    it, the assessor starts, answers and submits, a failed critical item forces a negative outcome, a second
//                    assessor without a grant cannot start, a person cannot read another person's instance. Then each control is
//                    broken inside the same rolled back transaction and the proofs that depend on it must go red.
const ASR_LIB = resolve(__dirname, "../src/lib/assessment/assessor");
const ASR_PAGES = resolve(__dirname, "../src/app/super-admin/checklist-assessments");
const ASR_API = resolve(__dirname, "../src/app/api/hq/checklist-assessments");
const ASR_PROOF = resolve(__dirname, "sql/asmt-assessor-proofs.sql");
const ASR_RESULT = "ASMT ASSESSOR PROOFS";
const ASR_REPO = (p: string) => p.replace(/\\/g, "/").replace(/^.*?\/(src\/)/, "$1");

/** The text of a file with comments removed (a needle must never match its own documentation). */
const code = (src: string) => stripTsComments(src);

/**
 * Is the capability gate called, with an assessment capability, before the file first touches data? A page calls
 * requireHqCapability("hq.assessment..."), a route calls hqApiGate([ASSESS_CAPABILITY | ASSIGN_CAPABILITY | "hq.assessment..."]).
 * "Touches data" is the first use of the context's admin client or of a loader imported from the assessor library.
 */
export function gatedBeforeReads(src: string): { ok: boolean; why: string } {
  const c = code(src);
  const gate = /(?:requireHqCapability\(\s*["'`]hq\.assessment\.[a-z.]+["'`]\s*\)|hqApiGate\(\s*\[\s*(?:ASSESS_CAPABILITY|ASSIGN_CAPABILITY|["'`]hq\.assessment\.[a-z.]+["'`])\s*\]\s*\))/.exec(c);
  if (!gate) return { ok: false, why: "no assessment-capability gate" };
  const touch = /\b(?:ctx|gate)\.admin\b|\b(?:list|load|start|patch|add|submit|create|end|find)[A-Za-z]*\(\s*(?:ctx|gate)\./.exec(c);
  if (touch && touch.index < gate.index) return { ok: false, why: "data is touched before the gate" };
  // the gate result must also be used: a route must return the refusal
  if (/hqApiGate/.test(c) && !/isHqRefusal\(\s*(?:ctx|gate)\s*\)\s*\)\s*return/.test(c)) return { ok: false, why: "the refusal is not returned" };
  return { ok: true, why: "" };
}

const ASR_CHILD = ["asmt_response", "asmt_evidence", "asmt_comment", "asmt_outcome", "asmt_instance_layout"];

/** Reads of an instance or grant must carry the actor filter, child reads the instance filter. Returns the offending sites. */
export function readerProblems(src: string, file: string): string[] {
  const out: string[] = [];
  const isProgression = /progression\.ts$/.test(file);
  for (const x of extractReads(src, file)) {
    if (x.write) continue; // a write that reads nothing back; one that reads back is a write site with .select(), judged by the plane harness
    const f = new Set(x.filters);
    if (x.table === "asmt_instance") {
      if (isProgression) { if (!(f.has("subject_user_id") && f.has("status") && f.has("attestation"))) out.push(`${file}:${x.line} asmt_instance read without subject_user_id + status + attestation`); }
      else if (!f.has("respondent_id")) out.push(`${file}:${x.line} asmt_instance read without respondent_id`);
    } else if (x.table === "asmt_respondent_grant") {
      if (!(f.has("respondent_id") || f.has("granted_by"))) out.push(`${file}:${x.line} asmt_respondent_grant read without respondent_id or granted_by`);
    } else if (x.table && ASR_CHILD.includes(x.table)) {
      if (!f.has("instance_id")) out.push(`${file}:${x.line} ${x.table} read without instance_id`);
    }
  }
  return out;
}

/** Every function that reads answers, evidence, comments, outcomes or layouts takes an OwnedInstance, and every function that takes an instance id calls own() first. */
export function ownershipProblems(src: string): string[] {
  const out: string[] = [];
  const c = code(src);
  for (const m of c.matchAll(/export async function (read[A-Za-z]+)\(([^)]*)\)/g)) if (!/OwnedInstance/.test(m[2])) out.push(`${m[1]} does not take an OwnedInstance`);
  for (const part of c.split(/\nexport async function /).slice(1)) {
    const name = part.slice(0, part.indexOf("(")).trim();
    const head = part.slice(0, part.indexOf("{\n") > 0 ? part.indexOf("{\n") : 400);
    if (/\(\s*admin: Admin, actor: string, instanceId: string/.test(head) && !/await own\(admin, actor, instanceId\)/.test(part) && !/await own\(admin, actor, instanceId\)/.test(part.replace(/loadInstance/, "")) && name !== "own") {
      if (!/\bown\(/.test(part)) out.push(`${name} takes an instance id and never calls own()`);
    }
  }
  return out;
}

function listFiles(dir: string): string[] { return filesBelow(dir); }

/** (id, condition, message): the message is the name and, when the condition fails, the evidence. */
const aok = (id: string, cond: boolean, msg: string) => ok(id, msg, cond, msg);

function assessorStatic() {
  console.log("\nassessor.static  the assessor workspace in the HQ plane (source read, comments stripped)\n");
  const read = (f: string) => readFileSync(f, "utf8");
  const lib = listFiles(ASR_LIB), pages = listFiles(ASR_PAGES), api = listFiles(ASR_API);
  aok("AS.control", lib.length >= 9 && pages.length >= 6 && api.length >= 8, `the scan found ${lib.length} library, ${pages.length} page and ${api.length} route files`);

  // ---- gates ----
  const gated = [...pages.filter(f => /(page|route)\.tsx?$/.test(f)), ...api.filter(f => /route\.ts$/.test(f))];
  const caps = gated.map(f => ({ f, g: gatedBeforeReads(read(f)) }));
  const bad = caps.filter(x => !x.g.ok);
  aok("AS.gate", gated.length >= 13 && bad.length === 0, bad.length ? bad.map(x => `${ASR_REPO(x.f)}: ${x.g.why}`).join("; ") : `${gated.length} pages and routes are gated by an assessment capability before any read`);
  const sample = gated.find(f => /instances[\\/]route\.ts$/.test(f))!;
  const src0 = read(sample);
  aok("AS.gate.red1", !gatedBeforeReads(src0.replace(/const ctx = await hqApiGate\(\[ASSESS_CAPABILITY\]\);\s*\n\s*if \(isHqRefusal\(ctx\)\) return ctx;/, "const ctx: any = null;")).ok, "planted: a route without its gate is caught");
  aok("AS.gate.red2", !gatedBeforeReads(src0.replace(/hqApiGate\(\[ASSESS_CAPABILITY\]\)/, "hqApiGate([\"hq.platform.home.view\"])")).ok, "planted: a route gated by a capability that is not an assessment one is caught");
  const pg0 = read(gated.find(f => /checklist-assessments[\\/]page\.tsx$/.test(f))!);
  aok("AS.gate.red3", !gatedBeforeReads(pg0.replace(/const ctx = await requireHqCapability\("hq\.assessment\.instrument\.assess"\);/, "const ctx = { admin: null as any, userId: '' };")).ok, "planted: a page without its gate is caught");
  // each surface uses the right capability
  const capOf = (f: string) => (/GrantsPage|grants[\\/]/.test(ASR_REPO(f)) ? "assign" : "assess");
  const wrong = gated.filter(f => { const c = code(read(f)); const grants = /checklist-assessments[\\/]grants|grants[\\/]/.test(f.replace(/\\/g, "/")) || /grants/.test(ASR_REPO(f)); return grants ? !/ASSIGN_CAPABILITY|hq\.assessment\.assessor\.assign/.test(c) : !/ASSESS_CAPABILITY|hq\.assessment\.instrument\.assess/.test(c); });
  void capOf;
  aok("AS.gate.caps", wrong.length === 0, wrong.length ? `wrong capability: ${wrong.map(ASR_REPO).join(", ")}` : "grants surfaces need assessor.assign, assessing surfaces need instrument.assess");

  // ---- respondent filter in every reader ----
  const libFiles = lib.filter(f => /\.ts$/.test(f) && !/\.test\./.test(f));
  const problems = libFiles.flatMap(f => readerProblems(read(f), ASR_REPO(f)));
  aok("AS.filter", problems.length === 0, problems.join("; ") || "every reader of an instance or grant is filtered by the actor, and every child read by the instance");
  const sites = libFiles.flatMap(f => extractReads(read(f), ASR_REPO(f))).filter(x => !x.write);
  aok("AS.filter.count", sites.filter(x => x.table === "asmt_instance").length >= 4 && sites.filter(x => x.table === "asmt_respondent_grant").length >= 3, `the scan sees the readers (${sites.length} read sites, ${sites.filter(x => x.table === "asmt_instance").length} on asmt_instance)`);
  const inst = read(resolve(ASR_LIB, "instances.ts"));
  const planted1 = inst.replace('.eq("id", instanceId).eq("respondent_id", actor)', '.eq("id", instanceId)');
  aok("AS.filter.red1", planted1 !== inst && readerProblems(planted1, "src/lib/assessment/assessor/instances.ts").length > 0, "planted: removing respondent_id = actor from own() goes RED");
  const planted2 = inst.replace('.eq("instance_id", inst.id).order("created_at");', ".order(\"created_at\");");
  aok("AS.filter.red2", planted2 !== inst && readerProblems(planted2, "src/lib/assessment/assessor/instances.ts").length > 0, "planted: a child read without instance_id goes RED");
  const grants = read(resolve(ASR_LIB, "grants.ts"));
  const planted3 = grants.replace('.eq("granted_by", actor)', "");
  aok("AS.filter.red3", planted3 !== grants && readerProblems(planted3, "src/lib/assessment/assessor/grants.ts").length > 0, "planted: a grants read without granted_by goes RED");
  const planted4 = inst.replace(/\n  const o = await own\(admin, actor, instanceId\);\n  if \(!o\.ok\) return o;\n  const inst = o\.value;\n  if \(inst\.status !== "in_progress"\) return fail\(409, "Evidence/, '\n  const inst: any = null;\n  if (inst.status !== "in_progress") return fail(409, "Evidence');
  aok("AS.own", ownershipProblems(inst).length === 0, ownershipProblems(inst).join("; ") || "every function that takes an instance id calls own() first, every reader takes an OwnedInstance");
  aok("AS.own.red", planted4 !== inst && ownershipProblems(planted4).length > 0, "planted: addEvidence without own() goes RED");
  const planted5 = inst.replace("readResponses(admin: Admin, inst: OwnedInstance,", "readResponses(admin: Admin, inst: { id: string },");
  aok("AS.own.red2", planted5 !== inst && ownershipProblems(planted5).length > 0, "planted: a reader that takes any object instead of an OwnedInstance goes RED");
  // progression reads the subject's evidence and nothing else
  const prog = read(resolve(ASR_LIB, "progression.ts"));
  aok("AS.progression", !/asmt_progression_decision/.test(code(prog)) && !libFiles.some(f => /\.from\(\s*["']asmt_progression_decision["']/.test(code(read(f)))), "progression decisions are never read in the workspace (asmt_record_progression is the only door)");
  aok("AS.progression.red", /\.from\(\s*["']asmt_progression_decision["']/.test(code(prog + '\nconst x = admin.from("asmt_progression_decision").select("id");')), "planted: a read of asmt_progression_decision is visible to this check");

  // ---- no AI ----
  const ai = (src: string) => [...code(src).matchAll(/from\s+["']([^"']+)["']/g)].map(m => m[1]).filter(s => /(^|\/)ai(\/|$)|anthropic|openai|@ai-sdk|llm|completion|gemini|embedding/i.test(s));
  const aiHits = [...lib, ...pages, ...api].flatMap(f => ai(read(f)).map(s => `${ASR_REPO(f)} imports ${s}`));
  aok("AS.noai", aiHits.length === 0, aiHits.join("; ") || "no file of the workspace imports an AI module");
  aok("AS.noai.red", ai('import { x } from "@/lib/ai/anything";').length === 1 && ai('import { y } from "@anthropic-ai/sdk";').length === 1, "planted: an AI import is caught");

  // ---- literal ban over the library (comments stripped, the two design exemptions removed) ----
  const banHits = (src: string) => { let c = code(src); for (const e of EXEMPT) c = c.split(e).join(""); const h: string[] = []; c.split("\n").forEach((l, i) => { const m = BANNED.exec(l); if (m) h.push(`line ${i + 1}: ${m[0]}: ${l.trim().slice(0, 80)}`); }); return h; };
  const banned = lib.flatMap(f => banHits(read(f)).map(h => `${ASR_REPO(f)} ${h}`));
  aok("AS.ban", banned.length === 0, banned.slice(0, 4).join(" | ") || `src/lib/assessment/assessor/** (${lib.length} files) names no profession, framework or proficiency model`);
  aok("AS.ban.red", banHits("const x = 'nursing competency';").length === 1 && banHits("// nursing competency\nconst x = 1;").length === 0, "planted: a banned word in code is caught, in a comment it is not");
  aok("AS.ban.exempt", lib.some(f => read(f).includes("competency_appointment_holds")), "the one exemption (the database function that checks an appointment) is really used");

  // ---- nothing under the workspace writes verification or progression decisions ----
  const forbidden = /\.from\(\s*["'](competency_verification[a-z_]*|competency_decisions|asmt_progression_decision)["']/;
  const writers = [...lib, ...pages, ...api].filter(f => forbidden.test(code(read(f)))).map(ASR_REPO);
  aok("AS.noverify", writers.length === 0, writers.join(", ") || "the workspace touches no verification or decision table");

  // ---- the workspace never sends a computed value ----
  const sends = /(insert|update)\(\s*\{[^}]*\bsatisfactory\b/.test(code(inst));
  aok("AS.nosat", !sends, "an answer is written without satisfactory: the database computes it");

  // ---- evidence: notes and references only ----
  aok("AS.noupload", !/\.storage\.from\(|createSignedUrl|\.upload\(/.test(lib.map(f => code(read(f))).join("\n")), "no upload path in the workspace library (notes and record references only)");
}

type DbPlant = { name: string; control: string; sql: string; expect: string[] };
export const ASSESSOR_PLANTS: DbPlant[] = [
  { name: "instance guard removed", control: "asmt_instance_guard (live grant, matching grant, independence)",
    sql: PERMISSIVE_INSTANCE, expect: ["I1", "J1", "J2", "J2b", "J3", "M4"] },
  { name: "outcome backstop removed", control: "asmt_outcome_guard (a failed critical item forces the gate outcome)",
    sql: dis("asmt_outcome", "asmt_outcome_guard"), expect: ["K8", "K8b", "L9"] },
  { name: "grant guard removed", control: "asmt_respondent_grant_guard (who may grant, accept, end) and the apart check",
    sql: [dis("asmt_respondent_grant", "asmt_respondent_grant_guard"), drop("asmt_respondent_grant", "asmt_respondent_grant_apart_check")].join("\n"), expect: ["H1", "H1b", "H1c", "H1d", "I2", "I2b", "M1", "M5"] },
  { name: "row level security off", control: "own-row read on instances and answers",
    sql: "execute 'alter table asmt_instance disable row level security';\nexecute 'alter table asmt_response disable row level security';", expect: ["N1", "N2", "N3"] },
  { name: "append-only trails removed", control: "asmt_append_only_guard on evidence and comments",
    sql: [dis("asmt_comment", "asmt_comment_append_only"), dis("asmt_evidence", "asmt_evidence_append_only")].join("\n"), expect: ["L5", "L5b"] },
  { name: "response guard removed", control: "asmt_response_guard (the database computes satisfactory and advances the revision)",
    sql: dis("asmt_response", "asmt_response_guard"), expect: ["K3", "K4"] },
];

async function assessorDb() {
  console.log("\nassessor.db  assessor workspace database proofs on STAGING (each run rolls back and keeps nothing)\n");
  const require = createRequire(resolve(process.cwd(), "package.json"));
  const { Client } = require("pg");
  const client = new Client({ connectionString: stagingUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const base = await runProofs(client, "", ASR_PROOF, ASR_RESULT);
    ok("AS.db.base", `all proofs pass with every control in place (pass=${base.pass} fail=${base.fail})`, base.fail === 0 && base.pass > 0, base.fail < 0 ? base.raw : `failed: ${base.failed.join(" ")}`);
    if (base.fail !== 0) console.log(`      ${base.raw.slice(0, 700)}`);
    for (const p of ASSESSOR_PLANTS) {
      const r = await runProofs(client, p.sql, ASR_PROOF, ASR_RESULT);
      const missing = p.expect.filter(id => !r.failed.includes(id));
      ok("AS.db.red", `planted: ${p.name} -> red on ${p.expect.join(" ")}`, r.fail > 0 && missing.length === 0,
        r.fail < 0 ? r.raw.slice(0, 300) : `not red: ${missing.join(" ")}; failed was: ${r.failed.join(" ")}`);
    }
  } finally {
    await client.end();
  }
}
// <<< ASSESSOR-WORKSPACE

async function main() {
  const arg = process.argv[2] ?? "static";
  if (arg === "static" || arg === "all") staticSection();
  if (arg === "db" || arg === "all") await dbSection();
  if (arg === "scholar" || arg === "all") await scholarSection();
  if (arg === "catalogue" || arg === "all") { catalogueStatic(); await catalogueDb(); }
  if (arg === "catalogue-static") catalogueStatic();
  if (arg === "assessor-static" || arg === "assessor" || arg === "all") assessorStatic();
  if (arg === "assessor-db" || arg === "assessor" || arg === "all") await assessorDb();
  if (arg === "acceptance" || arg === "catalogue" || arg === "all") await catalogueAcceptance();
  console.log(bad === 0 ? "\n  ALL PASS\n" : `\n  ${bad} FAILURE(S)\n`);
  process.exitCode = bad === 0 ? 0 : 1;
}
if (require.main === module) main().catch(e => { console.error(String(e.message ?? e)); process.exitCode = 1; });
