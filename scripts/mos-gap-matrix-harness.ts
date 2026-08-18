/**
 * CPR-CORE-MOS-001 §16 — THE GAP MATRIX, HELD TO THE SCHEMA.
 *
 * §16 says "produce and MAINTAIN a traceable gap matrix". A matrix nothing checks is accurate on the day
 * it is written and wrong on the day the schema moves, so this re-derives its claims from the migrations
 * rather than trusting the prose.
 *
 * ⚠ IT EXISTS BECAUSE THE MATRIX GOT TWO CLAIMS WRONG BEFORE IT WAS WRITTEN DOWN, both the same way: a
 * table's EXISTENCE was read as evidence that it holds data. The gov_* registers were called "built and
 * populated" (they are empty), and practice_sync_transaction was called a table "the product writes
 * daily" (it holds zero rows). Neither error was visible in the prose — both needed a count.
 *
 * So the rule this file enforces is narrow and checkable: every table the matrix names must EXIST, and
 * every Practice-aware verdict must match what the schema actually declares. Row counts move with the
 * data and are deliberately NOT pinned; what is pinned is that no row of the matrix names a table that
 * is not there, and no verdict contradicts the columns.
 *
 *   npx --yes tsx scripts/mos-gap-matrix-harness.ts
 */
import { readFileSync, readdirSync } from "node:fs";

const MATRIX = "docs/CPR-CORE-MOS-001-GAP-MATRIX.md";

let pass = 0;
const failures: string[] = [];
const ok = (id: string, cond: boolean, msg: string) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}`); }
};

const doc = readFileSync(MATRIX, "utf8");
const migrations = readdirSync("supabase/migrations")
  .filter(f => f.endsWith(".sql"))
  .map(f => readFileSync(`supabase/migrations/${f}`, "utf8"))
  .join("\n");

/** Columns declared for a table in its create statement. */
function columnsOf(table: string): string[] {
  const m = new RegExp(`create table (?:if not exists )?${table}\\b\\s*\\(([\\s\\S]*?)\\n\\);`, "i").exec(migrations);
  if (!m) return [];
  return m[1].split("\n")
    .map(l => /^\s+([a-z_]+)\s+/.exec(l)?.[1])
    .filter((c): c is string => !!c && !["constraint", "primary", "unique", "check", "foreign"].includes(c));
}
/**
 * ⚠ A VIEW IS AN OBJECT THE MATRIX MAY NAME, AND THIS ONLY UNDERSTOOD TABLES.
 *
 * The matrix cited mos_journey_event — the join from an event to its journey, which phase 2 created as a
 * VIEW precisely so the mapping could not drift. Both helpers here looked only for `create table`, so a
 * correct citation was reported as a missing table and a correct Practice-aware verdict was reported as
 * wrong. The harness was describing a narrower world than the one the matrix documents.
 */
const viewBody = (name: string): string | null =>
  new RegExp(`create (?:or replace )?view ${name}\\b([\\s\\S]*?);`, "i").exec(migrations)?.[1] ?? null;

const objectExists = (t: string) =>
  new RegExp(`create table (?:if not exists )?${t}\\b`, "i").test(migrations) || viewBody(t) !== null;

const isPracticeAware = (t: string) => {
  const c = columnsOf(t);
  if (c.length > 0) return c.includes("practice_id") || c.includes("workspace_id");
  // a view has no column list to read, so its Practice-awareness is whether it SELECTS one
  const body = viewBody(t);
  return body !== null && /\bpractice_id\b|\bworkspace_id\b/.test(body);
};

// ── parse the matrix rows ───────────────────────────────────────────────────
type Row = { cells: string[]; tables: string[]; verdict: string };
const rows: Row[] = doc.split("\n")
  .filter(l => l.trim().startsWith("|") && !/^\|[\s|:-]+\|$/.test(l.trim()))
  .map(l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()))
  .filter(cells => cells.length === 7 && cells[0] !== "Requirement")
  .map(cells => ({
    cells,
    // A table name is a backticked identifier in the "existing service/table" column.
    //
    // ⚠ AND A COLUMN NAME IS NOT ONE. That column also cites scope keys — `tenant_id`, `hospital_id`,
    // `workspace_id`, `patient_id` — which is the whole point of several rows. A first version treated
    // every backticked snake_case token as a table and reported four columns as missing tables, which
    // is a failing pin about the harness rather than about the matrix. Nothing in this schema is named
    // `*_id`, so the suffix is a safe discriminator.
    tables: [...cells[1].matchAll(/`([a-z_]+)`/g)].map(m => m[1])
      .filter(t => t.includes("_") && !t.endsWith("_id")),
    verdict: cells[2].toLowerCase(),
  }));

console.log("\nCPR-CORE-MOS-001 §16 GAP MATRIX\n");

ok("M0", rows.length >= 30,
  `control: ${rows.length} matrix rows parsed — a parse that found nothing would pass every pin below`);

ok("M1", rows.every(r => r.cells.every(c => c.length > 0)),
  `every row carries all seven of §16's columns${rows.filter(r => r.cells.some(c => !c)).length ? " — offenders: " + rows.filter(r => r.cells.some(c => !c)).map(r => r.cells[0]).join(", ") : ""}`);

// ── every named table exists ────────────────────────────────────────────────
const named = [...new Set(rows.flatMap(r => r.tables))];
const ghosts = named.filter(t => !objectExists(t));
ok("M2", ghosts.length === 0,
  `every table or view the matrix names exists in the migrations (${named.length} distinct)${ghosts.length ? " — missing: " + ghosts.join(", ") : ""}`);

ok("M3", named.length >= 15,
  `control: ${named.length} distinct tables were extracted — a regex that stopped matching would empty M2`);

// ── every Practice-aware verdict matches the schema ─────────────────────────
const wrongYes = rows.filter(r => r.verdict.includes("yes") && r.tables.length > 0 && !r.tables.some(isPracticeAware));
ok("M4", wrongYes.length === 0,
  `every "Practice-aware: YES" row names a table carrying practice_id or workspace_id${wrongYes.length ? " — wrong: " + wrongYes.map(r => r.cells[0]).join(", ") : ""}`);

const wrongNo = rows.filter(r => r.verdict === "no" && r.tables.length > 0 && r.tables.every(isPracticeAware));
ok("M5", wrongNo.length === 0,
  `every "Practice-aware: no" row names only tables WITHOUT practice_id or workspace_id${wrongNo.length ? " — wrong: " + wrongNo.map(r => r.cells[0]).join(", ") : ""}`);

const yesRows = rows.filter(r => r.verdict.includes("yes"));
ok("M6", yesRows.length >= 5 && rows.filter(r => r.verdict === "no").length >= 10,
  `control: the matrix contains both verdicts (${yesRows.length} yes, ${rows.filter(r => r.verdict === "no").length} no) — M4 and M5 discriminate rather than passing over an empty set`);

// ── the specific findings the matrix leads with ─────────────────────────────
ok("F1", isPracticeAware("practice_sync_transaction") && isPracticeAware("practice_activation_event")
      && isPracticeAware("practice_configuration") && isPracticeAware("practice_entitlement")
      && isPracticeAware("practice_message"),
  "the five Practice-scoped tables the matrix counts are all genuinely workspace-scoped");

ok("F2", !isPracticeAware("op_incidents") && columnsOf("op_incidents").includes("hospital_id")
      && columnsOf("op_incidents").includes("patient_id"),
  "⚠ op_incidents is hospital-scoped AND carries patient_id — the matrix's argument against generalising it rather than replacing it");

ok("F3", columnsOf("plat_subscriptions").includes("tenant_id") && !columnsOf("practice_workspace").includes("tenant_id"),
  "a Practice cannot be the subject of a subscription: the subscription keys on a tenant and the workspace has no tenant column");

const ENVELOPE = ["event_id", "product_id", "practice_id", "correlation_id", "journey_name", "outcome", "duration_ms", "failure_code", "component", "release_version"];
const activation = columnsOf("practice_activation_event");
const matched = ENVELOPE.filter(f => activation.includes(f));
ok("F4", matched.length === 0,
  `⚠ practice_activation_event matches ${matched.length} of §5's ten envelope fields — it is a milestone log and cannot be extended into the envelope, which is why §18 phase 2 is a new store`);

ok("F5", activation.length > 0,
  `control: the activation table's columns were read (${activation.length} of them) — F4 would pass trivially against an empty column list`);

// ── §17's standard refusal pattern ──────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}
const refusalKits = walk("src/app/super-admin/pd")
  .filter(f => /export function (AbsentList|PlaneRefusal)\b/.test(readFileSync(f, "utf8")));
ok("D1", refusalKits.length > 0,
  `control: ${refusalKits.length} refusal kits found — the duplication count below is measured`);

// ⚠ A RATCHET, NOT A BAN. §17 wants ONE standard missing-evidence pattern and there are three today.
// Consolidating them is a refactor the matrix names as a build action; what must not happen meanwhile is
// a FOURTH appearing because a new module copied the pattern again.
const REFUSAL_KIT_BASELINE = 3;
ok("D2", refusalKits.length <= REFUSAL_KIT_BASELINE,
  `§17 asks for one standard missing-evidence pattern; there are ${refusalKits.length} (ratchet at ${REFUSAL_KIT_BASELINE}, may fall, never rise) — ${refusalKits.map(f => f.split("/").pop()).join(", ")}`);

// ── the matrix records its own corrections ──────────────────────────────────
ok("C1", /Corrected:/.test(doc) && (doc.match(/⚠ \*\*Corrected/g) ?? []).length >= 2,
  "the two claims that were wrong before this matrix was written are corrected IN PLACE rather than silently fixed");

console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${failures.length} failed\n`);
if (failures.length) { failures.forEach(f => console.log("  " + f)); process.exit(1); }
