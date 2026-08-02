/**
 * Migration-object audit: did every declared TABLE and INDEX actually get created?
 *
 * THE GAP THIS FILLS. Three audits already ask the database whether the repo's intent arrived --
 * schema-drift compares columns the code reads, function-drift compares function bodies, rls-drift
 * compares policies. None of them notices an object that was declared and never created.
 *
 * That happened here. Migrations 108, 109 and 166 were TRUNCATED when applied: the tail of each file
 * never ran. It surfaced only because the anon-exposure harness found 13 tables with RLS switched off,
 * and the `enable row level security` lines were in those tails. Every audit was green at the time, and
 * the tables themselves turned out fine -- but nothing was checking, so that was luck rather than
 * evidence.
 *
 * The three losses rank by how loudly they fail:
 *   TABLE   errors the moment code touches it -- loud.
 *   POLICY  a security hole, findable by probing as anon -- quiet, but detectable.
 *   INDEX   SILENT. Results stay correct; a tenant-filtered query just starts scanning the table. The
 *           only symptom is a page that gets slower as data grows, months later, with nothing to point
 *           at. This is the one no existing tool could see.
 *
 * WHAT IT DOES NOT DO. It does not compare index DEFINITIONS, only existence by name. Postgres
 * normalises a stored index expression, so a text diff would report nearly everything as drifted -- the
 * same reason rls-drift compares policy existence rather than policy bodies.
 *
 * DROPS ARE INTENT. A migration that drops a table later in the sequence means the object is meant to be
 * gone, so file order matters: statements are processed in migration order and a later drop cancels an
 * earlier create. Collecting all creates and all drops separately would report every dropped object as
 * missing -- the same mistake rls-drift-audit made and had to fix.
 *
 * LOOSE SCRIPTS ARE NOT ORDERED. supabase/ holds hand-run files (fix-*.sql, RUN-ME-*.sql, reset.sql)
 * that create real objects but carry no reliable order relative to the migrations. Objects they declare
 * are reported separately and never counted as drift, because a drop in one of them is not evidence of
 * anything.
 *
 *   npx --yes tsx scripts/migration-object-audit.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

let controlFailed = false;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) console.log(`  PASS  ${label}`);
  else { controlFailed = true; console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const ROOT = process.cwd();
const MIG = join(ROOT, "supabase", "migrations");
const LOOSE = join(ROOT, "supabase");

/** Migrations sort NUMERICALLY: "99-x.sql" runs before "108-y.sql", which a plain sort gets backwards. */
const migrationFiles = () =>
  readdirSync(MIG).filter(f => f.endsWith(".sql"))
    .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || a.localeCompare(b));

const looseFiles = () => readdirSync(LOOSE).filter(f => f.endsWith(".sql"));

/** Strip comments and string literals so a table name inside either is never read as a declaration. */
function strip(sql: string): string {
  return sql
    .replace(/\$\$[\s\S]*?\$\$/g, " ")      // function bodies: their DDL is not this migration's intent
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

const CREATE_TABLE = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi;
const DROP_TABLE = /\bdrop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi;
const CREATE_INDEX = /\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?\s+on\s+(?:public\.)?"?([a-z0-9_]+)"?/gi;
const DROP_INDEX = /\bdrop\s+index\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi;

type Decl = { name: string; table?: string; file: string };

function collect(files: string[], dir: string) {
  const tables = new Map<string, Decl>();
  const indexes = new Map<string, Decl>();
  const droppedTables = new Set<string>();
  const droppedIndexes = new Set<string>();

  // IN FILE ORDER. A later drop cancels an earlier create; anything else reports deliberate removals
  // as missing objects.
  for (const f of files) {
    const sql = strip(readFileSync(join(dir, f), "utf8"));
    for (const m of sql.matchAll(CREATE_TABLE)) { tables.set(m[1], { name: m[1], file: f }); droppedTables.delete(m[1]); }
    for (const m of sql.matchAll(DROP_TABLE)) {
      tables.delete(m[1]);
      droppedTables.add(m[1]);
      // DROPPING A TABLE DROPS ITS INDEXES, without a `drop index` line anywhere to see. Modelling only
      // explicit index drops made this report idx_products_suite as missing: migration 105 created
      // `products` and its index, 106 dropped the table, and the index was still counted as intended.
      // A remediation migration built on that verdict then failed on apply with 42P01, because it tried
      // to index a relation that does not exist. The audit was right that the index was absent and wrong
      // about it being wanted.
      for (const [n, d] of indexes) if (d.table === m[1]) { indexes.delete(n); droppedIndexes.add(n); }
    }
    for (const m of sql.matchAll(CREATE_INDEX)) { indexes.set(m[1], { name: m[1], table: m[2], file: f }); droppedIndexes.delete(m[1]); }
    for (const m of sql.matchAll(DROP_INDEX)) { indexes.delete(m[1]); droppedIndexes.add(m[1]); }
  }
  return { tables, indexes, droppedTables, droppedIndexes };
}

async function main() {
  console.log("\nMigration-object audit -- declared tables and indexes vs the database\n");

  const mig = collect(migrationFiles(), MIG);
  const loose = collect(looseFiles(), LOOSE);

  console.log(`  ${migrationFiles().length} ordered migration(s), ${looseFiles().length} loose script(s)`);
  console.log(`  ${mig.tables.size} table(s) and ${mig.indexes.size} index(es) intended by the migrations`);
  console.log(`  ${mig.droppedTables.size} table(s) and ${mig.droppedIndexes.size} index(es) deliberately dropped\n`);

  // ── Tables: probe directly, no registry needed ────────────────────────────
  //
  // ABSENCE IS SIGNALLED BY A NULL COUNT, NOT BY AN ERROR. A head request to a table that does not exist
  // comes back HTTP 204 with error === null and count === null -- byte-identical, from the client's point
  // of view, to a successful probe. The first version of this file tested `error` and therefore reported
  // every missing table as present; it passed 369 of 369 while `products` was not in the database at all,
  // and only a migration failing on it exposed that. A real table always returns a numeric count, even
  // when it is empty (0), so the count is the discriminator and the error is not.
  const tableExists = async (name: string) => {
    const { count } = await admin.from(name).select("*", { count: "exact", head: true });
    return typeof count === "number";
  };

  // CONTROL, for exactly the reason the last version needed one and did not have it: a detector that
  // cannot distinguish present from absent reports a clean sweep. A name that certainly does not exist
  // must come back missing, or nothing below this line means anything.
  ok("control: a table that cannot exist is reported missing",
    !(await tableExists("zz_control_table_that_does_not_exist")),
    "the probe cannot tell present from absent, so every result below is meaningless");

  const missingTables: Decl[] = [];
  for (const d of mig.tables.values()) if (!(await tableExists(d.name))) missingTables.push(d);

  if (missingTables.length) {
    console.log(`  MISSING TABLES (${missingTables.length}) -- declared in a migration, not in the database`);
    missingTables.forEach(d => console.log(`    ${d.name.padEnd(34)} ${d.file}`));
  } else {
    console.log(`  All ${mig.tables.size} intended table(s) exist.`);
  }

  // ── Indexes: need the registry from migration 187 ─────────────────────────
  //
  // PAGINATED, AND ORDERED, FOR A REASON THIS TOOL LEARNED THE HARD WAY. PostgREST caps a response at
  // 1000 rows by default. This database has more than 1000 indexes, so a single call returned exactly
  // 1000 and everything past that read as MISSING -- a confident list that was partly fiction. Worse,
  // plat_index_registry has no ORDER BY, so which 1000 came back could change between calls: adding nine
  // indexes made six unrelated ones appear in the missing list, because the scan returned a different
  // subset. An unordered, capped read is not a sample of the truth, it is a different answer each time.
  //
  // .range() pages through, and the explicit .order() makes the paging stable -- without it, page 2 can
  // repeat or skip rows from page 1 for exactly the same reason.
  const PAGE = 1000;
  const idxAll: { index_name: string }[] = [];
  let idxErr: { message: string } | null = null;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.rpc("plat_index_registry")
      .order("index_name", { ascending: true }).range(from, from + PAGE - 1);
    if (error) { idxErr = error; break; }
    const page = (data ?? []) as { index_name: string }[];
    idxAll.push(...page);
    if (page.length < PAGE) break;
  }
  const idxRows = idxAll;
  if (idxErr) {
    console.log(`\n  INDEXES NOT CHECKED -- plat_index_registry() unavailable (${idxErr.message}).`);
    console.log(`  Apply supabase/migrations/187-index-registry.sql, then re-run. Reported, not skipped`);
    console.log(`  silently: an unchecked half that prints nothing reads exactly like a clean one.`);
    console.log(`\n${missingTables.length ? "FAILED" : "INCOMPLETE"} -- tables checked, indexes not\n`);
    process.exit(missingTables.length ? 1 : 2);
  }

  const live = new Set(((idxRows ?? []) as { index_name: string }[]).map(r => r.index_name));

  // CONTROL FOR THE CAP THAT ALREADY BIT ONCE. A single unpaginated read returned exactly 1000 rows and
  // everything beyond read as missing. If the paged total ever lands exactly on a page boundary, the most
  // likely explanation is that paging silently stopped rather than that the database has a round number of
  // indexes -- so say so instead of publishing the list as fact.
  ok(`control: the index registry was read in full (${idxRows.length} rows, not a page boundary)`,
    idxRows.length % PAGE !== 0,
    `exactly ${idxRows.length} rows came back, which is ${idxRows.length / PAGE} full page(s) -- paging may `
    + `have stopped early, in which case every "missing" verdict below is unreliable`);
  const looseIdx = new Set(loose.indexes.keys());
  const missingIdx = [...mig.indexes.values()].filter(d => !live.has(d.name));

  if (missingIdx.length) {
    console.log(`\n  MISSING INDEXES (${missingIdx.length}) -- declared, never created. Queries still return`);
    console.log(`  correct rows; they just scan. This is the failure with no symptom until the table grows.`);
    missingIdx.forEach(d => console.log(`    ${d.name.padEnd(38)} on ${String(d.table).padEnd(26)} ${d.file}`));
  } else {
    console.log(`\n  All ${mig.indexes.size} intended index(es) exist.`);
  }

  // Objects only a loose script declares: real, but unordered, so never counted as drift.
  const looseOnly = [...looseIdx].filter(n => !mig.indexes.has(n) && live.has(n));
  if (looseOnly.length) {
    console.log(`\n  ${looseOnly.length} deployed index(es) come from a loose script, not a migration -- not drift,`);
    console.log(`  but they are not reproducible from supabase/migrations alone.`);
  }

  // A failed control is itself a failure: it means every "exists" verdict above is unreliable.
  const failures = missingTables.length + missingIdx.length + (controlFailed ? 1 : 0);
  console.log(`\n${failures ? "FAILED" : "PASSED"}  ${mig.tables.size} table(s) + ${mig.indexes.size} index(es) checked`
    + `${failures ? `, ${failures} missing` : ""}\n`);
  process.exit(failures ? 1 : 0);
}

main();
