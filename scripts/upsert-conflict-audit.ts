/**
 * Upsert conflict-target audit -- every `.upsert(..., { onConflict })` in the repo, checked against the
 * unique indexes that actually exist in the database.
 *
 * WHY THIS EXISTS. PostgREST's `onConflict` compiles to `ON CONFLICT (cols)`, and Postgres will only
 * accept that if a NON-PARTIAL unique index or constraint covers exactly those columns. Point it at a
 * PARTIAL unique index (`... where deleted_at is null`) and the statement fails with "there is no
 * unique or exclusion constraint matching the ON CONFLICT specification". If the caller does not read
 * the error -- and an upsert's return value is easy to discard, because the happy path needs nothing
 * from it -- the write silently does NOTHING and the code carries on as though it succeeded.
 *
 * That has now happened twice: the Phase-1 arrival write, and the provisioning saga's
 * assign_capabilities step, which left every newly provisioned Practice workspace with zero
 * capabilities while reporting success. Two occurrences is a pattern, and a pattern deserves a tool
 * rather than a third discovery.
 *
 * THE FIFTH DRIFT TOOL. schema-drift = columns, function-drift = bodies, rls-drift = policies,
 * migration-object = declared-but-never-created, this one = upsert targets that cannot work.
 *
 * It reads live index definitions through plat_index_registry() (migration 187), so it measures the
 * database rather than the migration files -- an index that failed to apply is exactly the case where
 * an upsert starts failing without any source change.
 *
 *   npx --yes tsx scripts/upsert-conflict-audit.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { pagedRpc, capWarning } from "./_registry";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

type IndexRow = { tbl: string; index_name: string; is_unique: boolean; is_primary: boolean; definition: string };
type Site = { file: string; line: number; table: string | null; cols: string[] };

/** Columns inside `USING btree (a, b)` -- expression indexes are kept verbatim so they never false-match. */
function indexColumns(definition: string): string[] {
  const m = definition.match(/USING\s+\w+\s*\(([^)]*)\)/i);
  if (!m) return [];
  return m[1].split(",").map(c => c.trim().replace(/\s+(ASC|DESC|NULLS.*)$/i, "").replace(/^"|"$/g, ""));
}

const isPartial = (definition: string) => / WHERE /i.test(definition);

/**
 * Find each onConflict and walk BACKWARDS to the nearest `.from("table")`.
 *
 * Backwards, not a single spanning regex: an upsert chain can break across lines, and a forward
 * `from(...)[\s\S]*?onConflict` happily jumps over unrelated statements and attributes the conflict
 * target to the wrong table. The nearest preceding from() is the one the chain belongs to.
 */
function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) sources(p, out); }
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function sites(): Site[] {
  const found: Site[] = [];
  for (const file of [...sources("src"), ...sources("scripts")]) {
    const text = readFileSync(file, "utf8");
    const re = /onConflict:\s*["'`]([^"'`]+)["'`]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const before = text.slice(0, m.index);
      const froms = [...before.matchAll(/\.from\(\s*["'`]([A-Za-z0-9_]+)["'`]\s*\)/g)];
      const last = froms.length ? froms[froms.length - 1] : null;
      // CHAIN-MEMBERSHIP GUARD, not a distance one. Misattributing the columns to a table that happens
      // to have a matching index would be a false OK -- the only failure mode of this audit that hides a
      // real bug. Distance is the wrong signal: a legitimate upsert payload can be a thousand characters
      // of object literal. What actually ties the two together is that the span between them opens an
      // .upsert( and contains no other .from(). If it does not, the audit says so instead of guessing.
      const span = last ? text.slice(last.index! + last[0].length, m.index) : "";
      const sameChain = !!last && span.includes(".upsert(") && !span.includes(".from(");
      found.push({
        file, line: before.split("\n").length,
        table: sameChain ? last![1] : null,
        cols: m[1].split(",").map(c => c.trim()),
      });
    }
  }
  return found;
}

async function main() {
  console.log("\nUpsert conflict-target audit (PostgREST ON CONFLICT vs live unique indexes)\n");

  const reg = await pagedRpc<IndexRow>(admin, "plat_index_registry", ["tbl", "index_name"]);
  // A short read here silently removes indexes from the yardstick, and a missing index reads as
  // "NO MATCHING UNIQUE INDEX" -- so a truncated registry would invent failures rather than hide them.
  // That is the safe direction, but it is still wrong, so it aborts rather than reporting.
  if (reg.suspicious) { console.log(`  ABORTING -- ${capWarning(reg.rows.length)}\n`); process.exit(1); }
  const idx = reg.rows;
  if (idx.length === 0) { console.log("  plat_index_registry() returned nothing -- cannot audit."); process.exit(1); }

  const byTable = new Map<string, IndexRow[]>();
  for (const r of idx) (byTable.get(r.tbl) ?? byTable.set(r.tbl, []).get(r.tbl)!).push(r);

  const classify = (table: string, cols: string[]) => {
    const candidates = (byTable.get(table) ?? []).filter(r => r.is_unique || r.is_primary);
    const want = [...cols].sort().join(",");
    const matches = candidates.filter(r => [...indexColumns(r.definition)].sort().join(",") === want);
    if (matches.length === 0) return { verdict: "NO MATCHING UNIQUE INDEX", index: null as IndexRow | null };
    // A full index anywhere in the set makes the upsert legal, even if a partial one also matches.
    const full = matches.find(r => !isPartial(r.definition));
    if (full) return { verdict: "OK", index: full };
    return { verdict: "PARTIAL INDEX ONLY", index: matches[0] };
  };

  // ── CONTROL ───────────────────────────────────────────────────────────────
  // A classifier that answers the same thing for every input proves nothing. These two targets are
  // known-different in the live database: one full unique index, one partial. If they classify the
  // same, the classifier is broken and every verdict below is meaningless.
  const controlFull = classify("provisioning_step", ["request_id", "step_code"]);
  const controlPartial = classify("practice_role_assignment", ["membership_id", "capability_code"]);
  const controlOk = controlFull.verdict === "OK" && controlPartial.verdict === "PARTIAL INDEX ONLY";
  console.log(`  CONTROL  provisioning_step(request_id,step_code) -> ${controlFull.verdict}`);
  console.log(`  CONTROL  practice_role_assignment(membership_id,capability_code) -> ${controlPartial.verdict}`);
  if (!controlOk) {
    console.log("\n  FAILED  the control pair did not classify differently; the audit cannot be trusted.\n");
    process.exit(1);
  }
  console.log("");

  const all = sites();
  const broken: string[] = [];
  const unknown: string[] = [];
  let ok = 0;

  for (const s of all) {
    if (!s.table) { unknown.push(`${s.file}:${s.line} -- could not resolve the table`); continue; }
    if (!byTable.has(s.table)) { unknown.push(`${s.file}:${s.line} -- ${s.table} has no indexes in the registry`); continue; }
    const { verdict, index } = classify(s.table, s.cols);
    if (verdict === "OK") { ok++; continue; }
    broken.push(`${s.file}:${s.line}\n      ${s.table}(${s.cols.join(", ")}) -- ${verdict}${index ? `\n      ${index.index_name}: ${index.definition}` : ""}`);
  }

  console.log(`  ${all.length} upsert site(s) found; ${ok} target a usable unique index.`);
  if (unknown.length) {
    console.log(`\n  UNRESOLVED (${unknown.length}) -- read these by hand rather than assuming they are fine:`);
    for (const u of unknown) console.log(`    ${u}`);
  }
  if (broken.length) {
    console.log(`\n  WILL FAIL AT RUNTIME (${broken.length}):`);
    for (const b of broken) console.log(`    ${b}`);
    console.log("\n  Remedy: check-then-insert with the insert's error checked, letting the partial index");
    console.log("  backstop the race. Never an upsert whose return value is discarded.\n");
  } else {
    console.log("\n  No upsert targets a partial or missing unique index.\n");
  }

  process.exit(broken.length ? 1 : 0);
}

main();
