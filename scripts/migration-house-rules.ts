/**
 * MIGRATION HOUSE RULES — a mechanical check of a migration file before it is sent to be applied.
 *
 * ⚠ WHY THIS EXISTS RATHER THAN A CHECKLIST. Migrations on this database are applied BY HAND, ONCE, with
 * no rollback, by a runner that SPLITS STATEMENTS ON SEMICOLONS. Every rule below is a scar:
 *
 *   - a semicolon inside a COMMENT shredded two sections of migration 238 while still reporting success
 *   - `archived_reason is not null` in migration 256 did not stop a blank reason, and cost migration 257
 *   - migration 258 refused the very rows 259 required a decision for, so a column was unreachable from
 *     the day it landed, and 265 had to fix it
 *   - a PARTIAL unique index as an upsert target is a write that silently does nothing
 *
 * "Checked by eye" is what let the first of those through. This is the same check, run.
 *
 * ⚠ IT READS STRIPPED TEXT. The first version of the banned-construct scan reported "contains plpgsql"
 * against the header comment that says NO plpgsql — a needle matching its own documentation, which this
 * repository has recorded eight separate times. Every content assertion here strips comments first, and
 * carries a control proving the strip did not simply empty the file.
 *
 *   npx --yes tsx scripts/migration-house-rules.ts [path-to-migration.sql]
 *
 * With no argument it checks the highest-numbered migration, which is almost always the one about to be
 * sent.
 */
import { readFileSync, readdirSync } from "node:fs";

const DIR = "supabase/migrations";
const arg = process.argv[2];
const FILE = arg ?? `${DIR}/${readdirSync(DIR).filter(f => f.endsWith(".sql")).sort().reverse()[0]}`;

const src = readFileSync(FILE, "utf8");
const lines = src.split(/\r?\n/);

let bad = 0;
let warned = 0;
const fail = (where: string, why: string, text = "") => {
  bad++;
  console.log(`  FAIL ${where.padEnd(10)} ${why}${text ? `\n        ${text.trim().slice(0, 110)}` : ""}`);
};
/**
 * ⚠ WARN, NOT FAIL, AND THE DISTINCTION WAS FORCED BY RUNNING THIS AGAINST A KNOWN-GOOD FILE.
 *
 * The first version treated an apostrophe inside a comment as fatal. Migration 279 — applied
 * successfully, and the file this checker's rules were derived from — contains more than twenty of them.
 * So the rule is not evidenced by anything that has actually happened here, unlike the semicolon rule,
 * which has a shredded migration behind it.
 *
 * A checker that fails files known to have applied cleanly is a checker somebody turns off, and then the
 * semicolon rule goes with it. So this counts and reports, and does not block.
 */
const warn = (where: string, why: string, text = "") => {
  warned++;
  console.log(`  warn ${where.padEnd(10)} ${why}${text ? `\n        ${text.trim().slice(0, 100)}` : ""}`);
};

console.log(`\nMIGRATION HOUSE RULES — ${FILE}\n`);

/** True when the `--` at `at` opens a comment rather than sitting inside a string literal. */
const opensComment = (line: string, at: number) => ((line.slice(0, at).match(/'/g) ?? []).length) % 2 === 0;

lines.forEach((l, i) => {
  const n = `line ${i + 1}`;

  // ── 1. ASCII ONLY ──────────────────────────────────────────────────────────────────────────────
  const nonAscii = [...l].filter(ch => ch.charCodeAt(0) > 126 || (ch.charCodeAt(0) < 32 && ch !== "\t"));
  if (nonAscii.length) fail(n, `non-ASCII character(s): ${[...new Set(nonAscii)].join(" ")}`, l);

  const at = l.indexOf("--");
  if (at >= 0 && opensComment(l, at)) {
    const comment = l.slice(at);
    // ── 2. NO SEMICOLON IN A COMMENT — the runner splits on it. This is migration 238's scar. ────
    if (comment.includes(";")) fail(n, "SEMICOLON inside a comment — the runner will split here", l);
    // ── 3. APOSTROPHE IN A COMMENT — reported, not fatal. See `warn` above for why. ──────────────
    if (comment.includes("'")) warn(n, "apostrophe inside a comment", l);
  }

  // ── 4. NO `--` INSIDE A STRING LITERAL ─────────────────────────────────────────────────────────
  for (const lit of l.match(/'[^']*'/g) ?? [])
    if (lit.includes("--")) fail(n, "`--` inside a string literal", l);
});

// Comments stripped once, for every assertion below. See the header.
const code = lines
  .map(l => { const at = l.indexOf("--"); return at >= 0 && opensComment(l, at) ? l.slice(0, at) : l; })
  .join("\n");

if (code.trim().length < 40) fail("control", "stripping comments left no code — every check below is vacuous");

// ── 5. NO do-blocks, NO plpgsql, NO functions ────────────────────────────────────────────────────
for (const banned of ["do $", "$$", "plpgsql", "create function", "create or replace function"])
  if (code.toLowerCase().includes(banned)) fail("construct", `banned construct present: ${banned}`);

// ── 6. `notify pgrst` IS THE LAST STATEMENT ──────────────────────────────────────────────────────
const statements = code.split(";").map(s => s.trim()).filter(Boolean);
if (statements.length === 0) fail("control", "no statements found — the split produced nothing");
else if (!/notify pgrst/i.test(statements[statements.length - 1]))
  fail("pgrst", "last statement is not `notify pgrst` — PostgREST may cache a half-applied schema",
    statements[statements.length - 1].slice(-110));

// ── 7. NO PARTIAL UNIQUE INDEX — a partial index is an upsert that silently writes nothing ───────
for (const m of code.matchAll(/create unique index[^;]*/gi))
  if (/\bwhere\b/i.test(m[0])) fail("index", "PARTIAL unique index — the silent-write trap", m[0]);

// ── 8. REQUIRED TEXT USES btrim(...) <> '' RATHER THAN `is not null` ─────────────────────────────
// Migration 256 shipped `archived_reason is not null` believing it stopped a blank reason. A blank
// string is not null. That cost migration 257.
for (const m of code.matchAll(/check\s*\([^)]*?_reason\s+is\s+not\s+null[^)]*\)/gi))
  fail("check", "a required TEXT column checked with `is not null` — a blank string passes it", m[0]);

// ── 9. EVERY `create table` IS `if not exists`, EVERY CONSTRAINT IS DROP-THEN-ADD ────────────────
for (const m of code.matchAll(/create\s+table\s+(?!if\s+not\s+exists)/gi))
  fail("idempotency", "`create table` without `if not exists`", m[0]);
const added = [...code.matchAll(/alter table\s+(\w+)\s+add constraint\s+(\w+)/gi)].map(m => m[2]);
for (const c of added)
  if (!new RegExp(`drop constraint if exists\\s+${c}\\b`, "i").test(code))
    fail("idempotency", `constraint ${c} is added without a preceding \`drop constraint if exists\``);

// ── 10. RLS IS ENABLED ON EVERY TABLE THIS FILE CREATES ──────────────────────────────────────────
for (const m of code.matchAll(/create\s+table\s+if\s+not\s+exists\s+(\w+)/gi))
  if (!new RegExp(`alter table\\s+${m[1]}\\s+enable row level security`, "i").test(code))
    fail("rls", `table ${m[1]} is created without \`enable row level security\``);

const tail = warned ? ` (${warned} warning(s), not blocking)` : "";
console.log(bad === 0
  ? `  ALL CLEAR — ${lines.length} lines, ${statements.length} statements, ${added.length} constraint(s)${tail}\n`
  : `\n  ${bad} PROBLEM(S) — DO NOT SEND THIS FILE${tail}\n`);
process.exitCode = bad === 0 ? 0 : 1;
