/**
 * Function-drift audit — does every database function match its last definition in the migrations?
 *
 * THE DEFECT THAT MOTIVATED THIS. Migration 019 redefined search_ckcm() to add a quality_object branch.
 * It was never applied to this database. Library search therefore returned ZERO quality objects, for
 * months, with no error anywhere: the function existed, the signature was unchanged, every call returned
 * 200, and the missing branch simply produced fewer rows. A confident zero.
 *
 * WHY NOTHING ELSE CATCHES IT:
 *   - scripts/schema-drift-audit.ts compares selected COLUMNS against the live schema. A function body is
 *     invisible to it.
 *   - PostgREST's OpenAPI exposes only the 8 functions callable through the API, and only their
 *     SIGNATURES. 019 changed the body and left the signature identical, so signature checking -- the
 *     thing that is free and easy -- would have reported clean.
 *   - Nothing tracks which migrations were applied. They are applied by hand.
 *
 * So the only honest check reads the deployed body. plat_function_registry() (migration 168) exposes
 * pg_proc to the service role for exactly that.
 *
 * WHAT IT REPORTS:
 *   MISSING         declared in a migration, not in the database. The 019 case at its worst.
 *   BODY DRIFT      deployed body differs from the last definition in the migrations.
 *   EXTRA OVERLOAD  the database has a signature the migrations no longer intend. This is not cosmetic:
 *                   two overloads of one name make a PostgREST rpc call AMBIGUOUS, and a leftover
 *                   permissive overload is how a fixed function keeps being called the old way.
 *   STALE           dropped by a migration, still deployed.
 *   UNPARSED        a create-function this script could not read. Reported, never skipped -- an audit
 *                   that silently ignores what it cannot parse is how you get a false clean.
 *   ORPHAN          deployed in public, never declared in the repo (informational: dashboard-authored or
 *                   extension-installed).
 *
 * DEGRADED MODE. Without migration 168 it falls back to OpenAPI signature checks and says so loudly,
 * because that mode cannot see bodies and would have missed the very defect this tool exists for.
 *
 *   npx --yes tsx scripts/function-drift-audit.ts
 *   npx --yes tsx scripts/function-drift-audit.ts --show <name>   print both bodies for one function
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
loadEnvConfig(process.cwd());

const ROOT = process.cwd();
const SUPA = join(ROOT, "supabase");

// ── Parsing ──────────────────────────────────────────────────────────────────
// Deliberately NOT a regex over the whole statement. An argument list can contain parentheses --
// `numeric(10,2)`, `default coalesce(a,b)` -- so a non-greedy `\(([\s\S]*?)\)` closes on the first inner
// paren and silently truncates the signature. Everything below scans with a depth counter and respects
// quoting, which is the difference between reading a declaration and guessing at one.

type Ev = {
  kind: "create" | "drop";
  name: string;
  arity: number;
  body: string | null;   // null for drops and for bodies this parser could not read
  parsed: boolean;
  file: string;
  seq: number;
};

/** Scan a balanced (...) starting at `open`. Returns the inner text and the index after the ')'. */
function scanParens(s: string, open: number): { inner: string; end: number } | null {
  if (s[open] !== "(") return null;
  let depth = 0, i = open;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "'") {                       // single-quoted literal: skip it whole ('' is an escaped quote)
      i++;
      while (i < s.length && !(s[i] === "'" && s[i + 1] !== "'")) i += s[i] === "'" ? 2 : 1;
      i++; continue;
    }
    if (ch === "-" && s[i + 1] === "-") { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) return { inner: s.slice(open + 1, i), end: i + 1 }; }
    i++;
  }
  return null;
}

/** Count top-level commas in an argument list. Nested parens and quoted defaults do not separate args. */
function arityOf(args: string): number {
  const t = args.trim();
  if (!t) return 0;
  let depth = 0, n = 1, i = 0;
  while (i < t.length) {
    const ch = t[i];
    if (ch === "'") { i++; while (i < t.length && !(t[i] === "'" && t[i + 1] !== "'")) i += t[i] === "'" ? 2 : 1; i++; continue; }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) n++;
    i++;
  }
  return n;
}

/** Read a dollar-quoted body ($$ ... $$ or $tag$ ... $tag$) starting at or after `from`. */
function readBody(s: string, from: number): { body: string; end: number } | null {
  const open = /\$([a-zA-Z_][a-zA-Z0-9_]*)?\$/g;
  open.lastIndex = from;
  const m = open.exec(s);
  if (!m) return null;
  const tag = m[0];
  const start = m.index + tag.length;
  const close = s.indexOf(tag, start);
  if (close < 0) return null;
  return { body: s.slice(start, close), end: close + tag.length };
}

function parseFile(src: string, file: string, seq0: number): Ev[] {
  const out: Ev[] = [];
  // Only the statement HEAD is matched by regex; everything with nesting is scanned.
  const head = /\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\s+(?:public\.)?("?)([a-zA-Z_][a-zA-Z0-9_]*)\1\s*(?=\()/gi;
  let m: RegExpExecArray | null;
  while ((m = head.exec(src))) {
    const p = scanParens(src, head.lastIndex);
    if (!p) { out.push({ kind: "create", name: m[2], arity: -1, body: null, parsed: false, file, seq: seq0 + m.index }); continue; }
    // The body is the next dollar-quoted block. A function written with a single-quoted body is not
    // parsed here; it is reported as UNPARSED rather than assumed to match.
    const b = readBody(src, p.end);
    const nextCreate = head.lastIndex;
    head.lastIndex = p.end;
    out.push({
      kind: "create", name: m[2], arity: arityOf(p.inner),
      body: b ? b.body : null, parsed: !!b, file, seq: seq0 + m.index,
    });
    if (b) head.lastIndex = b.end; else head.lastIndex = nextCreate;
  }

  const drop = /\bdrop\s+(?:function|procedure)\s+(?:if\s+exists\s+)?(?:public\.)?("?)([a-zA-Z_][a-zA-Z0-9_]*)\1\s*(?=\()/gi;
  while ((m = drop.exec(src))) {
    const p = scanParens(src, drop.lastIndex);
    out.push({ kind: "drop", name: m[2], arity: p ? arityOf(p.inner) : -1, body: null, parsed: !!p, file, seq: seq0 + m.index });
    if (p) drop.lastIndex = p.end;
  }
  return out;
}

// Whitespace only. Comments are NOT stripped: they are part of the stored body, so a comment-only edit
// that was never applied is a real difference between the file and the database, and saying so is right.
const norm = (s: string) => s.replace(/\r/g, "").replace(/\s+/g, " ").trim();

/**
 * Every .sql file in the repo, in the order it can be argued they were applied.
 *
 * SCANNING ONLY schema.sql AND migrations/ PRODUCED A FALSE ORPHAN. supabase/ also holds loose scripts --
 * fix-rls-recursion.sql, fix-profile.sql, RUN-ME-*.sql -- that define functions and were run by hand.
 * current_user_is_hospital_admin_for was reported as "declared nowhere in the repo" when it is declared
 * in fix-rls-recursion.sql, and handle_new_user's deployed body was called undocumented when
 * fix-profile.sql holds it verbatim. An audit that reads only the tidy half of a directory reports on the
 * tidy half.
 *
 * `ordered` marks whether a file's position is trustworthy. Migrations are numbered, so their DROPs are
 * authoritative. The loose scripts are not ordered relative to anything -- fix-super-admin-rls-recursion
 * drops two helpers that fix-rls-recursion creates, and RLS policies in migrations 006 and 007 still call
 * one of them -- so a drop found there says nothing about the final intent, and is reported as a note
 * rather than turned into a verdict.
 */
function sqlFiles(): { path: string; ordered: boolean }[] {
  const out: { path: string; ordered: boolean }[] = [];
  if (existsSync(join(SUPA, "schema.sql"))) out.push({ path: join(SUPA, "schema.sql"), ordered: true });
  out.push(...readdirSync(SUPA).filter(f => f.endsWith(".sql") && f !== "schema.sql").sort()
    .map(f => ({ path: join(SUPA, f), ordered: false })));
  const dir = join(SUPA, "migrations");
  if (existsSync(dir)) {
    out.push(...readdirSync(dir).filter(f => f.endsWith(".sql"))
      .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || a.localeCompare(b))
      .map(f => ({ path: join(dir, f), ordered: true })));
  }
  return out;
}

async function main() {
  const showIdx = process.argv.indexOf("--show");
  const showName = showIdx >= 0 ? process.argv[showIdx + 1] : null;

  // ── Intended state, from the repo ──────────────────────────────────────────
  const files = sqlFiles();
  const events: Ev[] = [];
  const ordered = new Map<string, boolean>();
  let seq = 0;
  for (const f of files) {
    const rel = relative(ROOT, f.path).replace(/\\/g, "/");
    ordered.set(rel, f.ordered);
    events.push(...parseFile(readFileSync(f.path, "utf8"), rel, seq));
    seq += 1_000_000;
  }
  events.sort((a, b) => a.seq - b.seq);

  // Keyed by name/arity: a name can legitimately carry several signatures, and "last create wins" across
  // a whole name would flag a live overload as extra.
  const intended = new Map<string, Ev>();
  for (const e of events) {
    const key = `${e.name}/${e.arity}`;
    if (e.kind === "create") intended.set(key, e);
    else if (ordered.get(e.file)) intended.delete(key);   // only a NUMBERED file's drop settles intent
  }
  const dropped = new Map<string, Ev>();
  for (const e of events) {
    if (e.kind !== "drop" || !ordered.get(e.file)) continue;
    if (!intended.has(`${e.name}/${e.arity}`)) dropped.set(`${e.name}/${e.arity}`, e);
  }
  const looseDrops = events.filter(e => e.kind === "drop" && !ordered.get(e.file));

  const unparsed = events.filter(e => e.kind === "create" && !e.parsed);

  console.log(`\nFunction-drift audit\n`);
  console.log(`  ${files.length} sql file(s) (${files.filter(f => f.ordered).length} ordered, ${files.filter(f => !f.ordered).length} loose)`);
  console.log(`  ${intended.size} function signature(s) intended, ${dropped.size} intentionally dropped`);

  // ── Deployed state ─────────────────────────────────────────────────────────
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("  Missing Supabase env.\n"); process.exit(1); }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const reg = await admin.rpc("plat_function_registry");
  if (reg.error) {
    console.log(`\n  DEGRADED MODE — plat_function_registry() is not deployed (${reg.error.message}).`);
    console.log(`  Apply supabase/migrations/168-function-registry.sql to enable body comparison.`);
    console.log(`  Falling back to OpenAPI signature checks, which CANNOT see bodies and would not have`);
    console.log(`  caught migration 019 — the defect this audit exists for.\n`);
    const spec: any = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" },
    }).then(r => r.json());
    const exposed = new Set(Object.keys(spec?.paths ?? {}).filter(p => p.startsWith("/rpc/")).map(p => p.slice(5)));
    const names = new Set([...intended.values()].map(e => e.name));
    const missing = [...names].filter(n => exposed.size && !exposed.has(n));
    console.log(`  ${exposed.size} function(s) exposed via the API, of ${names.size} declared in the repo.`);
    console.log(`  Not exposed (expected for trigger/helper functions, NOT proof they exist): ${missing.length}\n`);
    process.exit(1);
  }

  const deployed = (reg.data ?? []) as { fn_name: string; identity_args: string; lang: string; src: string }[];
  const byKey = new Map<string, typeof deployed[number]>();
  const namesDeployed = new Map<string, number>();
  for (const d of deployed) {
    byKey.set(`${d.fn_name}/${arityOf(d.identity_args)}`, d);
    namesDeployed.set(d.fn_name, (namesDeployed.get(d.fn_name) ?? 0) + 1);
  }
  console.log(`  ${deployed.length} function(s) deployed in the public schema\n`);

  if (showName) {
    let shown = 0;
    for (const [k, e] of intended) {
      if (e.name !== showName) continue;
      shown++;
      const d = byKey.get(k);
      console.log(`  ${k}  declared in ${e.file}\n`);
      console.log(`  --- repo ---\n${e.body ?? "(unparsed)"}\n`);
      console.log(`  --- deployed ---\n${d ? d.src : "(not deployed)"}\n`);
    }
    // An ORPHAN has no repo side to diff against, and it is the case you most want to read: it exists
    // only in the database, so this is the only place its body is written down.
    if (!shown) {
      for (const d of deployed.filter(x => x.fn_name === showName)) {
        console.log(`  ${d.fn_name}(${d.identity_args})  ORPHAN — deployed only, declared nowhere in the repo\n`);
        console.log(`  --- deployed (${d.lang}) ---\n${d.src}\n`);
        shown++;
      }
    }
    if (!shown) console.log(`  no function named "${showName}" in the repo or the database\n`);
    return;
  }

  // ── Compare ────────────────────────────────────────────────────────────────
  const missing: string[] = [], drifted: string[] = [], stale: string[] = [], extra: string[] = [];

  for (const [k, e] of intended) {
    const d = byKey.get(k);
    if (!d) { missing.push(`${k}  declared in ${e.file}`); continue; }
    if (!e.parsed || e.body == null) continue;             // counted under UNPARSED, not silently passed
    if (norm(e.body) !== norm(d.src)) drifted.push(`${k}  repo: ${e.file}`);
  }
  for (const [k, e] of dropped) if (byKey.has(k)) stale.push(`${k}  dropped in ${e.file}, still deployed`);

  // A name the repo intends once but the database carries twice: the PostgREST ambiguity hazard.
  const intendedPerName = new Map<string, number>();
  for (const e of intended.values()) intendedPerName.set(e.name, (intendedPerName.get(e.name) ?? 0) + 1);
  for (const [name, n] of namesDeployed) {
    const want = intendedPerName.get(name);
    if (want != null && n > want) extra.push(`${name}  ${n} signature(s) deployed, ${want} intended`);
  }

  const declaredNames = new Set(events.filter(e => e.kind === "create").map(e => e.name));
  const orphans = [...namesDeployed.keys()].filter(n => !declaredNames.has(n));

  const section = (title: string, rows: string[], note?: string) => {
    if (!rows.length) return;
    console.log(`  ${title} (${rows.length})`);
    if (note) console.log(`    ${note}`);
    for (const r of rows) console.log(`    ${r}`);
    console.log();
  };

  section("MISSING — declared in a migration, absent from the database", missing,
    "the migration was never applied; every caller silently gets the old behaviour");
  section("BODY DRIFT — deployed body differs from the last definition", drifted,
    "run with --show <name> to see both");
  section("EXTRA OVERLOAD — the database carries a signature the repo no longer intends", extra,
    "two overloads make a PostgREST rpc call ambiguous, and the old one may be the permissive one");
  section("STALE — dropped by a migration, still deployed", stale);
  section("UNPARSED — this script could not read the body", unparsed.map(e => `${e.name}  ${e.file}`),
    "not checked either way; fix the parser rather than trusting the silence");
  section("ORPHAN — deployed but never declared in the repo", orphans,
    "informational: authored in the dashboard, or installed by an extension");
  // Reported, not judged. These files are unordered, so a drop in one may have been undone by another
  // being run later -- and at least one of these functions is still called by RLS policies in numbered
  // migrations, which means dropping it would break them.
  section("LOOSE-SCRIPT DROPS — a hand-run script drops a function that is still deployed",
    looseDrops.filter(e => namesDeployed.has(e.name)).map(e => `${e.name}  ${e.file}`),
    "not treated as drift: these scripts carry no reliable order relative to the migrations");

  const bad = missing.length + drifted.length + extra.length + stale.length;
  console.log(`  ${intended.size - bad} of ${intended.size} intended signature(s) match the database` +
    (unparsed.length ? `, ${unparsed.length} unparsed` : "") + `\n`);
  if (bad) process.exit(1);
}

main();
