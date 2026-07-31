// SCHEMA DRIFT AUDIT — every column the code SELECTS, checked against the live database.
//
// WHY THIS EXISTS. Three separate bugs were found by hand in one loader (ops-command.ts): it selected
// `op_escalations.reason` (the column is `summary`) and `op_safety_alerts.message` (the column is `note`).
// PostgREST returns an error for an unknown column, the loader's fail-soft `.then(r => r, () => ({data:[]}))`
// swallowed it, and the Unit Manager dashboard reported ZERO escalations and ZERO safety incidents
// PERMANENTLY. No crash, no log, no missing page — just a dashboard confidently displaying nothing.
//
// That pattern (`() => ({ data: [] })`) appears at 17 sites. Rather than read all of them, this asks the
// database directly: for every (table, column) pair the source selects, does the column exist?
//
// It is READ-ONLY. Each check is a `select(col).limit(0)` — no rows fetched, nothing written.
//
//   npx --yes tsx scripts/schema-drift-audit.ts            # whole codebase
//   npx --yes tsx scripts/schema-drift-audit.ts unit-manager   # filter by path fragment
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
loadEnvConfig(process.cwd());

type Usage = { table: string; column: string; file: string; line: number };

// Walk src/ for .ts/.tsx.
function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) sources(p, out); }
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

// Pull the column list out of a PostgREST select string.
//
// The syntax has traps: `units!unit_id(name)` is an EMBED, not a column, and its inner columns belong to the
// embedded table (not checked here — checking them needs relationship resolution). `*` is every column.
// `count` and aliases (`alias:col`) also appear. Anything followed by `(` is an embed and is skipped.
export function columnsOf(select: string): string[] {
  const cols: string[] = [];
  let depth = 0, cur = "";
  for (const ch of select) {
    if (ch === "(") { depth++; cur += ch; continue; }
    if (ch === ")") { depth--; cur += ch; continue; }
    if (ch === "," && depth === 0) { cols.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) cols.push(cur);

  return cols
    .map(c => c.trim())
    .filter(c => c && c !== "*" && !c.includes("("))          // drop wildcard + embeds
    .map(c => (c.includes(":") ? c.split(":")[1] : c))         // alias:column -> column
    .map(c => c.split("::")[0].trim())                         // cast
    .filter(c => /^[a-z_][a-z0-9_]*$/i.test(c));               // plain identifiers only
}

// Find `.from("table")` ... `.select("cols")` pairs, AND the filter columns chained after them.
//
// FILTERS MATTER AS MUCH AS SELECTS. A `.eq("hospital_id", x)` on a table with no hospital_id fails exactly
// the same way a bad select does, and is just as invisible behind a fail-soft. This audit originally checked
// only selects and therefore MISSED a broken `.eq()` in code written the same day — catching it only by
// luck, through a different file that selected the same bad column. Filters are checked too.
//
// Deliberately conservative: skips template literals (dynamic columns cannot be checked) and stops the
// filter scan at the next `.from(` so chains are not attributed to the wrong table.
const FILTERS = ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "contains", "order"];

function usagesIn(file: string): Usage[] {
  const src = fs.readFileSync(file, "utf8");
  const out: Usage[] = [];
  const re = /\.from\(\s*["']([a-z_][a-z0-9_]*)["']\s*\)/g;
  let m: RegExpExecArray | null;
  const marks: { table: string; at: number }[] = [];
  while ((m = re.exec(src))) marks.push({ table: m[1], at: m.index });

  // Where does THIS query's chain end? Not at a character count — that attributed a neighbouring query's
  // filters to the wrong table and produced confident false positives (e.g. "hospitals.hospital_id"), which
  // is worse than missing a real one. Walk from `.from(` tracking bracket depth and stop at the first
  // boundary of the enclosing expression: a `;`, a `,` at depth 0 (the next entry of a Promise.all array),
  // or a closing bracket that takes us out of it.
  const chainEnd = (from: number): number => {
    let d = 0;
    for (let i = from; i < src.length; i++) {
      const c = src[i];
      if (c === "(" || c === "[") d++;
      else if (c === ")" || c === "]") { d--; if (d < 0) return i; }
      else if (c === ";" && d <= 0) return i;
      else if (c === "," && d === 0) return i;
    }
    return src.length;
  };

  for (let i = 0; i < marks.length; i++) {
    const { table, at } = marks[i];
    const end = Math.min(chainEnd(at), i + 1 < marks.length ? marks[i + 1].at : src.length);
    const chunk = src.slice(at, end);
    const line0 = src.slice(0, at).split("\n").length;
    const lineOf = (idx: number) => line0 + chunk.slice(0, idx).split("\n").length - 1;

    const sel = /\.select\(\s*(["'])([\s\S]*?)\1/.exec(chunk);
    if (sel) for (const column of columnsOf(sel[2])) out.push({ table, column, file, line: lineOf(sel.index) });

    const fre = new RegExp(`\\.(${FILTERS.join("|")})\\(\\s*["']([a-z_][a-z0-9_.]*)["']`, "g");
    let f: RegExpExecArray | null;
    while ((f = fre.exec(chunk))) {
      const col = f[2];
      // `departments.hospital_id` filters an EMBEDDED table, not this one — skip dotted paths.
      if (col.includes(".")) continue;
      out.push({ table, column: col, file, line: lineOf(f.index) });
    }
  }
  return out;
}

async function main() {
  const filter = process.argv[2] ?? "";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Missing Supabase env."); process.exit(1); }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const files = sources(path.join(process.cwd(), "src")).filter(f => !filter || f.includes(filter));
  const usages = files.flatMap(usagesIn);
  const rel = (f: string) => path.relative(process.cwd(), f).replace(/\\/g, "/");

  // Unique (table, column) pairs — one DB question each, not one per call site.
  const pairs = new Map<string, Usage[]>();
  for (const u of usages) {
    const k = `${u.table}.${u.column}`;
    if (!pairs.has(k)) pairs.set(k, []);
    pairs.get(k)!.push(u);
  }

  console.log(`Scanned ${files.length} files, ${usages.length} column references, ${pairs.size} distinct (table, column) pairs.\n`);

  const missingTables = new Set<string>();
  const drift: { key: string; sites: Usage[]; reason: string }[] = [];
  let checked = 0;
  const tables = [...new Set([...pairs.keys()].map(k => k.split(".")[0]))];

  // PostgREST publishes its whole schema as OpenAPI at the API root — every table with every column. One
  // request answers all 2,000+ questions, instead of a round-trip per pair.
  const spec: any = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" },
  }).then(r => r.json());
  const defs = spec?.definitions ?? spec?.components?.schemas ?? {};
  const columnsFor = (t: string): Set<string> | null => {
    const d = defs[t];
    if (!d?.properties) return null;
    return new Set(Object.keys(d.properties));
  };

  if (!Object.keys(defs).length) {
    console.error("Could not read the PostgREST schema. Is the service-role key correct?");
    process.exit(1);
  }

  for (const t of tables) if (!columnsFor(t)) missingTables.add(t);

  for (const [k, sites] of pairs) {
    const [table, column] = k.split(".");
    if (missingTables.has(table)) continue;
    const cols = columnsFor(table)!;
    checked++;
    // A name that is not a column MAY still be a valid embed (a foreign-table relationship). Those were
    // filtered out by columnsOf, but a relationship referenced without parentheses would land here — so
    // confirm with the database before reporting, to avoid crying wolf.
    if (!cols.has(column)) {
      const probe = await admin.from(table).select(column).limit(0);
      if (probe.error) drift.push({ key: k, sites, reason: probe.error.message.replace(/\s+/g, " ").slice(0, 140) });
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  if (missingTables.size) {
    console.log(`TABLES NOT ON THIS DATABASE (${missingTables.size}) — expected if a migration is unapplied:`);
    for (const t of [...missingTables].sort()) console.log(`  - ${t}`);
    console.log("");
  }

  if (!drift.length) {
    console.log(`OK — all ${checked} checked columns exist. No schema drift.`);
  } else {
    console.log(`SCHEMA DRIFT — ${drift.length} column(s) selected but NOT present:\n`);
    for (const d of drift.sort((a, b) => a.key.localeCompare(b.key))) {
      console.log(`  ${d.key}`);
      console.log(`      ${d.reason}`);
      for (const s of d.sites) console.log(`      at ${rel(s.file)}:${s.line}`);
      // The danger is proportional to whether the caller swallows the error.
      const swallowed = d.sites.some(s => {
        const src = fs.readFileSync(s.file, "utf8");
        return /\(\)\s*=>\s*\(\{\s*data:\s*\[\]|catch\s*\{|\.catch\(/.test(src);
      });
      console.log(`      ${swallowed ? "!! the caller FAIL-SOFTS — this renders as a silent zero, not an error" : "-> surfaces as an error at runtime"}`);
      console.log("");
    }
  }

  console.log(`\n${drift.length === 0 ? "PASS" : "FAIL"}  ${checked} columns checked across ${tables.length - missingTables.size} live tables.`);
  process.exit(drift.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
