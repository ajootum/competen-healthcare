/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ASSESSMENT CORE HARNESS (Checklist Studio). Sections are independent. Each slice adds its own.
 *
 *   npx tsx scripts/assessment-core-harness.ts            static sections only (no database)
 *   npx tsx scripts/assessment-core-harness.ts db         S1a database proofs on STAGING (rolls back, keeps nothing)
 *   npx tsx scripts/assessment-core-harness.ts all        both
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
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const PRODUCTION_REF = "rnnqhlrcgvsauigxwszl";
const MIGRATIONS = ["890-asmt-core-definitions.sql", "891-asmt-capture.sql", "892-asmt-progression.sql"];
const PROOF_FILE = resolve(__dirname, "sql/asmt-core-proofs.sql");

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

async function runProofs(client: any, plantSql: string): Promise<{ pass: number; fail: number; failed: string[]; raw: string }> {
  const base = readFileSync(PROOF_FILE, "utf8");
  if (!base.includes("-- @@PLANT@@")) throw new Error("the proof file lost its plant marker");
  const sql = base.replace("-- @@PLANT@@", plantSql);
  await client.query("begin");
  try {
    await client.query(sql);
    return { pass: 0, fail: 0, failed: [], raw: "the proof block did not raise its RESULT" };
  } catch (e: any) {
    const msg = String(e.message ?? e);
    const m = msg.match(/RESULT ASMT PROOFS pass=(\d+) fail=(\d+) failed:\s*(.*)$/);
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

async function main() {
  const arg = process.argv[2] ?? "static";
  if (arg === "static" || arg === "all") staticSection();
  if (arg === "db" || arg === "all") await dbSection();
  console.log(bad === 0 ? "\n  ALL PASS\n" : `\n  ${bad} FAILURE(S)\n`);
  process.exitCode = bad === 0 ? 0 : 1;
}
if (require.main === module) main().catch(e => { console.error(String(e.message ?? e)); process.exitCode = 1; });
