/**
 * plane-boundary-harness — the platform plane may see THAT a practice is used, not WHAT is in it.
 *
 * PLAT-OVERSIGHT-SURVEY-001 §6.2, enforcing the §9 D1–D8 policy. No migration: static analysis over
 * source, and nothing here touches a database.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ WHY A CLOSURE AND NOT A GREP, WHICH IS THE ENTIRE REASON THIS FILE EXISTS.
 *
 * `grep -rn practice_patient src/app/super-admin/` returns ZERO. The page reads the table anyway:
 *
 *     src/app/super-admin/platform-ops/practice/page.tsx:4
 *       → src/lib/practice/operations.ts:129   admin.from(table).select("workspace_id")
 *         where `table` is a parameter bound to practice_patient at the call site.
 *
 * A harness that searched the entry directory would be green for the same wrong reason the grep was
 * empty. So: follow every runtime import transitively, read every `.from()` in the closure, resolve the
 * table name even when it is held in a variable, and judge the columns against a declared allowlist.
 *
 * ⚠ AND THE CLOSURE IS THE CALLABLE SURFACE, NOT THE BUNDLE — the one place this harness disagrees with
 * §1.3 on method rather than fact. `identifier-format.ts:1` imports ONE function from
 * `provisioning.ts`, which dynamically imports `identity-service.ts`. Module-level reachability
 * therefore drags 400 lines of the practice engine into the platform closure and produces 23 refusals
 * for reads no platform page can cause — `practice_entitlement`, `practice_handle_history`, a
 * practitioner's `biography`. Symbol-level reachability asks the sharper question: of the names this
 * page actually imports, which declarations can run? Both numbers are printed below, because the bundle
 * surface is a real fact even when it is not the rule.
 *
 * ⚠ EVERY REFUSAL IS PAIRED WITH A CONTROL. A rule that only ever says "denied" passes just as loudly
 * when the walker has stopped walking. So: baselines on the closure (§B), the known-good reads asserted
 * to still PASS (§P), the refusals exercised as pure judgements (§C), and the extractor exercised over
 * real source so §C is not judging shapes nothing produces (§C10–C13).
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * THE BREAK TABLE. Each break was applied to a real file, run, observed, restored by byte copy and
 * re-run. ⚠ RESTORE IS `cp`, NEVER `git checkout`: this repository has `core.autocrlf=true`, and a
 * checkout rewrote a source file's line endings while reporting the tree clean — the first restore of
 * break 1 changed 105 bytes and the checksum caught it.
 *
 *   #   break                                                   where                              result
 *   1   reads practice_problem (a table not on the allowlist)    practice/page.tsx (0 hops)         RED  TABLE_NOT_ALLOWED
 *   2   practice_patient.select("workspace_id, given_name,…")    practice/page.tsx (0 hops)         RED  COLUMN_NOT_ALLOWED
 *   3   the same read TWO IMPORTS DEEP, in decideHq()            ai/services/actions/page.tsx
 *                                                                 → lib/hq/context.ts
 *                                                                 → lib/hq/spaces.ts (2 hops)       RED  COLUMN_NOT_ALLOWED
 *   3b  the same read in an UNREACHED symbol of a bundled module lib/practice/provisioning.ts        GREEN — see the limit below
 *   4   a LEGITIMATE new read: practice_workspace id/name/status practice/page.tsx                   GREEN (the other direction)
 *   5   practice_audit_event.select("event_type, payload")       practice/page.tsx                   RED  TABLE_NOT_ALLOWED
 *   6   select("id, name, practice_patient(given_name)")         practice/page.tsx                   RED  EMBED_NOT_ALLOWED
 *   7   .from(t) — a table name this scanner cannot resolve      practice/page.tsx                   RED  UNRESOLVED_TABLE
 *
 * ⚠ 3b IS THE LIMIT, AND IT IS PRINTED RATHER THAN HIDDEN. A read planted in a module that is in the
 * platform bundle but that no platform export can call does NOT turn this harness red. That is the price
 * of symbol-level reachability, and the alternative price is 23 refusals for reads nobody can cause. The
 * "Bundled but NOT callable" section below lists every such module every run, so the set is visible and
 * a reviewer can see it grow. `provisioning.ts` is in it, and it is reachable in earnest from the five
 * OUT_OF_SCOPE_OPERATOR_ROUTES that §6.2's entry set does not name — see plane-boundary.ts.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Run: npx --yes tsx scripts/plane-boundary-harness.ts
 * Exit 0 = green. Non-zero = a platform-plane file reads practice data it may not, or reads something
 * this scanner could not parse and nobody has declared — the same class of blind spot, never a pass.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";
import { analyzeModule, extractReads, ALL, type ModuleFacts, type OwnedSite } from "../src/lib/access/plane-boundary-scan";
import {
  judge, policyFor, PRACTICE_ALLOWLIST, PRACTICE_RPC_ALLOWLIST, UNRESOLVED_EXCEPTIONS,
  OUT_OF_SCOPE_OPERATOR_ROUTES, describeAllowlist, type BoundarySite,
} from "../src/lib/access/plane-boundary";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const ENTRY_DIRS = ["src/app/super-admin", "src/app/api/platform"];
const EXT = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];

// ── Baselines. A walker that silently reads nothing makes every assertion below pass. ────────────────
// Floors, not equalities: the estate grows, and a harness that fails on every new page gets muted. What
// must never happen is the walker shrinking to nothing, which is what these catch.
const ENTRY_FLOOR = 340;          // files under the two entry directories
const MODULE_FLOOR = 500;         // files in the bundle-level closure
const READ_FLOOR = 12;            // judged `.from("practice_*")` sites

let pass = 0, fail = 0;
const failures: string[] = [];
const ok = (id: string, cond: boolean, msg: string) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { fail++; failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}`); }
};
const rel = (p: string) => relative(ROOT, p).split(sep).join("/");

// ── PASS 1 — THE CLOSURE ─────────────────────────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.some(x => e.endsWith(x)) && !e.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/**
 * Resolve a module specifier the way the bundler does. Returns null for a package (node:, next, react …)
 * and THROWS for a first-party specifier that does not resolve — because a first-party import this
 * harness cannot follow is a hole in the closure, not a file with no imports.
 */
function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const ext of ["", ...EXT]) {
    const cand = base + ext;
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  for (const ext of EXT) if (existsSync(join(base, "index" + ext))) return join(base, "index" + ext);
  throw new Error(`unresolved first-party import "${spec}" from ${rel(fromFile)}`);
}

const errors: string[] = [];
const factsOf = new Map<string, ModuleFacts>();
function load(file: string): ModuleFacts | null {
  const hit = factsOf.get(file);
  if (hit) return hit;
  let source: string;
  // ⚠ NEVER DISCARDED. A file that cannot be read is a failure, not an empty file — an empty file has no
  // imports and no reads, which is exactly the answer that would hide whatever it contains.
  try { source = readFileSync(file, "utf8"); }
  catch (e) { errors.push(`could not read ${rel(file)}: ${(e as Error).message}`); return null; }
  try {
    const f = analyzeModule(source, rel(file));
    factsOf.set(file, f);
    return f;
  } catch (e) { errors.push(`could not parse ${rel(file)}: ${(e as Error).message}`); return null; }
}

/** Bundle-level reachability: every module the platform plane's imports pull in, callable or not. */
function moduleClosure(entries: string[]): { files: Set<string>; edges: Map<string, string[]>; typeOnlyCut: number } {
  const seen = new Set(entries);
  const queue = [...entries];
  const edges = new Map<string, string[]>();
  let typeOnlyCut = 0;
  while (queue.length) {
    const file = queue.shift() as string;
    const facts = load(file);
    if (!facts) continue;
    const out: string[] = [];
    for (const imp of facts.imports) {
      if (imp.typeOnly) { if (imp.specifier.startsWith("@/") || imp.specifier.startsWith(".")) typeOnlyCut++; continue; }
      let target: string | null;
      try { target = resolveSpecifier(imp.specifier, file); }
      catch (e) { errors.push((e as Error).message); continue; }
      if (!target) continue;
      out.push(target);
      if (!seen.has(target)) { seen.add(target); queue.push(target); }
    }
    edges.set(file, out);
  }
  return { files: seen, edges, typeOnlyCut };
}

/**
 * Symbol-level reachability: which DECLARATIONS the platform plane can actually cause to run.
 *
 * A worklist over (file, needed export name). An entry file needs everything it exports, because Next
 * calls its exports. Every other file needs only the names the reachable code imports from it — plus its
 * module-load statements, which run the moment it is imported at all.
 */
type Reach = { needed: Map<string, Set<string>>; reachableDecls: Map<string, Set<string>> };
function symbolClosure(entries: string[]): Reach {
  const needed = new Map<string, Set<string>>();
  const reachableDecls = new Map<string, Set<string>>();
  const queue: string[] = [];
  const want = (file: string, name: string) => {
    const s = needed.get(file) ?? new Set<string>();
    if (s.has(name) || s.has(ALL)) { needed.set(file, s); return; }
    s.add(name);
    needed.set(file, s);
    if (!queue.includes(file)) queue.push(file);
  };
  for (const e of entries) want(e, ALL);

  const processed = new Map<string, number>();
  while (queue.length) {
    const file = queue.shift() as string;
    const facts = load(file);
    if (!facts) continue;
    const need = needed.get(file) ?? new Set<string>();
    // Re-process only while the needed set is still growing.
    if (processed.get(file) === need.size) continue;
    processed.set(file, need.size);

    // Roots: module-load code always runs; needed exports pull in their declarations.
    const roots = new Set<string>(facts.moduleLoadRefs);
    const all = need.has(ALL);
    if (all) for (const local of facts.exports.values()) roots.add(local);
    else for (const n of need) { const local = facts.exports.get(n); if (local) roots.add(local); }

    // Expand within the file: a reachable declaration makes everything it mentions reachable.
    const reached = new Set<string>();
    const work = [...roots];
    while (work.length) {
      const name = work.pop() as string;
      if (reached.has(name)) continue;
      reached.add(name);
      for (const r of facts.refs.get(name) ?? []) if (!reached.has(r)) work.push(r);
    }
    reachableDecls.set(file, reached);

    // Cross the module boundary for every reachable import binding, and for every eager edge.
    const edgeFor = (spec: string) => { try { return resolveSpecifier(spec, file); } catch (e) { errors.push((e as Error).message); return null; } };
    for (const [local, b] of facts.importBindings) {
      if (!reached.has(local) && !local.startsWith("__reexport:")) continue;
      if (local.startsWith("__reexport:") && !(all || need.has(local.slice("__reexport:".length)))) continue;
      const t = edgeFor(b.specifier);
      if (t) want(t, b.imported);
    }
    for (const imp of facts.imports) {
      if (imp.typeOnly || !imp.eager) continue;
      const t = edgeFor(imp.specifier);
      // Loaded for effect / namespace / `export *`: the module runs, and a namespace import may reach
      // any of its exports, so it is needed whole.
      if (t) want(t, ALL);
    }
    for (const spec of facts.starReexports) { const t = edgeFor(spec); if (t) want(t, ALL); }
  }
  return { needed, reachableDecls };
}

// ── RUN ──────────────────────────────────────────────────────────────────────────────────────────────

console.log("\nplane-boundary-harness — PLAT-OVERSIGHT-SURVEY-001 §6.2\n");

const entries = ENTRY_DIRS.flatMap(d => (existsSync(join(ROOT, d)) ? walk(join(ROOT, d)) : []));
const bundle = moduleClosure(entries);
const reach = symbolClosure(entries);

console.log("── Closure ──────────────────────────────────────────────────────────────────");
console.log(`  entry files                 ${entries.length}   (${ENTRY_DIRS.join(", ")})`);
console.log(`  modules in the bundle       ${bundle.files.size}`);
console.log(`  modules with callable code  ${reach.needed.size}`);
console.log(`  type-only edges cut         ${bundle.typeOnlyCut}   (erased at build; no runtime read)`);
console.log(`  read/parse/resolve errors   ${errors.length}`);

ok("E1", errors.length === 0,
  errors.length === 0
    ? "every file in the closure was read, parsed and every first-party import resolved"
    : `⚠ ${errors.length} file(s) could not be read/parsed/resolved: ${errors.slice(0, 5).join(" · ")}`);
ok("B1", entries.length >= ENTRY_FLOOR,
  `⚠ count control: ${entries.length} entry files (floor ${ENTRY_FLOOR}) — a walker that found none would make every assertion below vacuous`);
ok("B2", bundle.files.size >= MODULE_FLOOR,
  `⚠ count control: the import closure reaches ${bundle.files.size} modules (floor ${MODULE_FLOOR})`);

/** The shortest import path from an entry point to a file — "one import away", proved rather than said. */
function shortestPath(target: string): string[] | null {
  const prev = new Map<string, string | null>();
  const q: string[] = [];
  for (const e of entries) { prev.set(e, null); q.push(e); }
  while (q.length) {
    const cur = q.shift() as string;
    if (cur === target) {
      const path: string[] = [];
      for (let n: string | null = cur; n; n = prev.get(n) ?? null) path.unshift(n);
      return path;
    }
    for (const nxt of bundle.edges.get(cur) ?? []) if (!prev.has(nxt)) { prev.set(nxt, cur); q.push(nxt); }
  }
  return null;
}

// Collect the practice reads, split by whether the platform plane can actually reach the declaration.
const judged: OwnedSite[] = [];
const bundledOnly: OwnedSite[] = [];
for (const file of bundle.files) {
  const facts = factsOf.get(file);
  if (!facts) continue;
  const reachable = reach.reachableDecls.get(file);
  for (const s of facts.sites) {
    const live = !!reachable && (s.owner === null || reachable.has(s.owner));
    (live ? judged : bundledOnly).push(s);
  }
}

const judgedFiles = [...new Set(judged.map(s => s.file))].sort();
console.log("\n── Practice reads the platform plane can reach ──────────────────────────────");
console.log(`  files ${judgedFiles.length} · sites ${judged.length}\n`);
for (const f of judgedFiles) {
  const path = shortestPath(join(ROOT, f));
  const hops = path ? path.length - 1 : -1;
  console.log(`  ${f}   — ${hops} import hop${hops === 1 ? "" : "s"} from an entry point`);
  if (path) for (const p of path) console.log(`      ${rel(p)}`);
  for (const s of judged.filter(x => x.file === f).sort((a, b) => a.line - b.line))
    console.log(`      :${String(s.line).padEnd(5)} ${(s.table ?? "?").padEnd(32)} ${s.select === "columns" ? s.columns.join(", ") : s.select}${s.head ? " (head)" : ""}${s.write ? " [write]" : ""}`);
}

const bundledFiles = [...new Set(bundledOnly.map(s => s.file))].sort();
console.log("\n── Bundled but NOT callable from this plane ─────────────────────────────────");
console.log("  ⚠ These modules are in the platform bundle and no platform export reaches them. They are");
console.log("     NOT judged. Every one of them arrives through a single edge — identifier-format.ts:1");
console.log("     `import { audit } from \"@/lib/practice/provisioning\"` — which is worth knowing.");
for (const f of bundledFiles) {
  const tables = [...new Set(bundledOnly.filter(s => s.file === f).map(s => s.table ?? "?"))];
  console.log(`  ${f}  (${bundledOnly.filter(s => s.file === f).length} sites: ${tables.join(", ")})`);
}

ok("B3", judged.length >= READ_FLOOR,
  `⚠ count control: ${judged.length} reachable practice read site(s) judged (floor ${READ_FLOOR})`);
ok("B4", judged.some(s => s.table === "practice_patient"),
  "⚠ THE CLOSURE CONTROL. `practice_patient` is found — a grep of the entry directories finds it nowhere. " +
  "If this ever fails, the harness has stopped following imports and every clean run below means nothing");
ok("B5", judged.some(s => s.resolvedFrom !== null),
  "⚠ the variable-table resolver is live: at least one `.from(<identifier>)` resolved to several real table names");
ok("B6", judgedFiles.includes("src/lib/practice/operations.ts") && judgedFiles.includes("src/lib/practice/identifier-format.ts"),
  "both known practice-reading libraries are still in the reachable closure");

// ── THE ASSERTION ────────────────────────────────────────────────────────────────────────────────────
console.log("\n── Verdicts ─────────────────────────────────────────────────────────────────");
const byCode: Record<string, number> = {};
let refused = 0;
for (const s of judged.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  const v = judge(s);
  byCode[v.code] = (byCode[v.code] ?? 0) + 1;
  if (!v.ok) { refused++; console.log(`  REFUSED  ${s.file}:${s.line}  [${v.code}] ${v.detail}`); }
}
for (const [code, n] of Object.entries(byCode).sort()) console.log(`  ${String(n).padStart(4)}  ${code}`);
ok("A1", refused === 0,
  refused === 0
    ? `every one of the ${judged.length} reachable practice reads is inside the declared allowlist`
    : `⚠ ${refused} read(s) cross the plane boundary — listed above`);

// The declared-exception list must be exactly used: nothing undeclared, nothing stale.
const unresolvedSites = judged.filter(s => s.table === null);
const stale = UNRESOLVED_EXCEPTIONS.filter(e => !unresolvedSites.some(s => s.file === e.file && s.argText === e.arg));
ok("A2", stale.length === 0,
  stale.length === 0
    ? `all ${UNRESOLVED_EXCEPTIONS.length} declared dynamic-table exceptions are still real reads (${unresolvedSites.length} unresolved site(s) in the closure)`
    : `⚠ stale exception(s) — the code moved and the justification did not: ${stale.map(e => `${e.file} .from(${e.arg})`).join(", ")}`);

// RPC: a stored function is a column rule with the columns hidden inside it.
const rpcSites: { file: string; fn: string; line: number }[] = [];
for (const file of bundle.files) {
  const facts = factsOf.get(file);
  const reachable = reach.reachableDecls.get(file);
  if (!facts || !reachable) continue;
  for (const r of facts.rpc)
    if (r.fn.startsWith("practice_") && (r.owner === null || reachable.has(r.owner)))
      rpcSites.push({ file: rel(file), fn: r.fn, line: r.line });
}
const badRpc = rpcSites.filter(r => !PRACTICE_RPC_ALLOWLIST.includes(r.fn));
ok("A3", badRpc.length === 0,
  badRpc.length === 0
    ? `${rpcSites.length} reachable practice RPC call(s), all declared: ${[...new Set(rpcSites.map(r => r.fn))].join(", ") || "(none)"}`
    : `⚠ undeclared practice RPC: ${badRpc.map(r => `${r.fn} @ ${r.file}:${r.line}`).join(", ")}`);

// ── ⚠ THE RULE'S OWN BLIND SPOT, RE-DERIVED RATHER THAN TRUSTED ──────────────────────────────────────
// Five super-admin-only routes live under `src/app/api/v1/practice/**`, which neither entry glob covers.
// This finds them the same way a reviewer would — a route that refuses a non-super caller and never
// calls requirePracticeContext is the platform plane wearing a practice path — and requires the set to
// be exactly the declared one, so a sixth fails rather than appearing.
/**
 * ⚠ THE DETECTOR WIDENED WHEN THE GATE CHANGED (CPR-PD-014 build 2, 2026-08-17).
 *
 * This found operator routes by their `isSuper(` call. All five then moved to `hqApiGate([...])` --
 * PD-014's "do not equate Product Director with Super Admin" -- and the detector stopped seeing them:
 * `goneOperator` would have listed three of the five as having vanished, and A6 would have gone red for
 * the work succeeding. The SET has not moved; the way these routes say "landlord only" has.
 *
 * So the test is now "gated on the platform plane, and never calling requirePracticeContext", which is
 * the property the pin was always about. A route that drops BOTH gates still falls out and still fails.
 */
const practiceApi = join(ROOT, "src/app/api/v1/practice");
// ⚠ COMMENTS STRIPPED FIRST. The converted routes EXPLAIN the ownership test they replaced, so an
// unstripped scan reads the explanation and reports the old gate as still present -- a needle matching
// its own documentation, which this repo has paid for repeatedly.
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const OPERATOR_GATE = /\bisSuper\s*\(|\bhqApiGate\s*\(/;
const operatorOnly: string[] = [];
if (existsSync(practiceApi)) for (const f of walk(practiceApi)) {
  // ⚠ A TEST FILE IS NOT A ROUTE, and this scan could not tell. A route test lives beside the route it
  // exercises and MENTIONS its gate -- access-gate.test.ts asserts on hqApiGate by name -- so the needle
  // matched the test and A6 reported a sixth operator route that does not exist. The same shape as the
  // comment-stripping note above: a detector matching something written ABOUT the thing it looks for.
  if (/\.(test|spec)\.tsx?$/.test(f)) continue;
  const src = stripComments(readFileSync(f, "utf8"));
  if (OPERATOR_GATE.test(src) && !/requirePracticeContext\s*\(/.test(src)) operatorOnly.push(rel(f));
}
const undeclaredOperator = operatorOnly.filter(f => !OUT_OF_SCOPE_OPERATOR_ROUTES.includes(f));
const goneOperator = OUT_OF_SCOPE_OPERATOR_ROUTES.filter(f => !operatorOnly.includes(f));
console.log("\n── ⚠ Operator-only routes OUTSIDE the §6.2 entry set (not judged) ───────────");
for (const f of operatorOnly) console.log(`  ${f}`);
ok("A6", undeclaredOperator.length === 0 && goneOperator.length === 0,
  undeclaredOperator.length === 0 && goneOperator.length === 0
    ? `${operatorOnly.length} operator-only route(s) live in the practice API tree and are exactly the declared set — the §6.2 rule as written does not reach them`
    : `⚠ the out-of-scope set moved: new ${undeclaredOperator.join(", ") || "(none)"} · gone ${goneOperator.join(", ") || "(none)"}`);

// ── §P — POSITIVE CONTROLS. The legitimate reads must still PASS. ────────────────────────────────────
// A harness that refuses everything is as useless as one that refuses nothing, and it fails in a way
// that looks like diligence.
console.log("\n── §P positive controls ─────────────────────────────────────────────────────");
const site = (over: Partial<BoundarySite>): BoundarySite => ({
  file: "control.ts", line: 1, table: "practice_workspace", resolvedFrom: null, argText: "\"x\"",
  select: "columns", columns: [], embeds: [], head: false, exactCount: false,
  write: false, verbs: ["select"], filters: [], chain: "control", unresolved: null, ...over,
});
ok("P1", judge(site({ table: "practice_workspace", columns: ["id", "name", "status", "owner_person_id", "created_at"] })).ok,
  "the operational columns of practice_workspace still pass — the console keeps working");
ok("P2", judge(site({ table: "practice_patient", columns: ["workspace_id"] })).ok,
  "counting patients by workspace_id still passes");
ok("P3", judge(site({ table: "practice_role_capabilities", select: "star", head: true, exactCount: true })).code === "COUNT_ONLY",
  "a head-only exact count passes even with select(\"*\"), because PostgREST returns no rows");
ok("P4", judge(site({ table: "practice_audit_event", select: "none", write: true, verbs: ["insert"] })).code === "WRITE_NO_READBACK",
  "⚠ §6.3's proposed audit WRITE is not blocked by this READ rule — recording a trace of the read is the other half of the boundary and this file must not stand in its way");
ok("P5", judge(site({ table: "practice_identifier_format", select: "star" })).ok,
  "select(\"*\") passes where `*` is declared — the identifier format has no subject");

// ── §C — REFUSAL CONTROLS. ───────────────────────────────────────────────────────────────────────────
console.log("\n── §C refusal controls ──────────────────────────────────────────────────────");
ok("C1", judge(site({ table: "practice_problem", columns: ["workspace_id"] })).code === "TABLE_NOT_ALLOWED",
  "control 1 — a NEW TABLE: a platform module reading practice_problem is refused");
ok("C2", judge(site({ table: "practice_audit_event", columns: ["event_type", "payload"] })).code === "TABLE_NOT_ALLOWED",
  "practice_audit_event is refused BY NAME (§4.4: its payloads carry clinical detail)");
ok("C3", judge(site({ table: "practice_patient", columns: ["workspace_id", "given_name"] })).code === "COLUMN_NOT_ALLOWED",
  "⚠ control 2 — A WIDENED COLUMN LIST: select(\"workspace_id, given_name\") is refused. This is the feared case and it is a four-word edit");
ok("C4", judge(site({ table: "practice_patient", select: "star" })).code === "STAR_NOT_ALLOWED",
  "select(\"*\") on a tenancy-only table is refused");
ok("C5", judge(site({ table: "practice_workspace", columns: ["id"], embeds: [{ table: "practice_patient", columns: ["given_name"] }] })).code === "EMBED_NOT_ALLOWED",
  "⚠ THE JOIN, IN A STRING: select(\"id, practice_patient(given_name)\") is refused even though .from() says practice_workspace");
ok("C6", judge(site({ table: null, unresolved: "computed table name", argText: "someExpr" })).code === "UNRESOLVED_TABLE",
  "an unresolvable, UNDECLARED table name FAILS — scan.ts's rule: unknown is never open");
ok("C7", judge(site({ table: null, argText: "p.table", file: "src/lib/platform/monitoring.ts" })).code === "UNRESOLVED_DECLARED"
  && judge(site({ table: null, argText: "p.table", file: "src/lib/practice/operations.ts" })).code === "UNRESOLVED_TABLE",
  "…and passes only where a written justification exists, keyed to the file AND the expression — the same expression in another file is still refused");
ok("C8", judge(site({ table: "practice_patient", select: "unresolved", unresolved: "computed select" })).code === "UNRESOLVED_SELECT",
  "an unresolvable select list FAILS on a known practice table");
// The 2026-08-16 billing tiles: counts allowed, money NEVER. The allowed half is the tenancy column;
// the refused half is the feared four-word widening on the two tables that now carry money.
ok("C16", judge(site({ table: "practice_invoice", columns: ["workspace_id"] })).code === "ALLOWED"
  && judge(site({ table: "practice_payment", columns: ["workspace_id"] })).code === "ALLOWED",
  "the ops billing tiles' reads are on the register: tenancy column only, counted never listed");
ok("C17", judge(site({ table: "practice_invoice", columns: ["workspace_id", "total_minor"] })).code === "COLUMN_NOT_ALLOWED"
  && judge(site({ table: "practice_payment", columns: ["workspace_id", "amount_minor"] })).code === "COLUMN_NOT_ALLOWED",
  "⚠ an AMOUNT column on either billing table is refused -- a named practitioner's revenue is business intelligence, permanently outside this plane");
ok("C9", judge(site({ table: "practice_patient", select: "none", write: false, verbs: ["eq"] })).code === "NO_TERMINAL",
  "a chain this scanner cannot classify FAILS rather than being assumed inert");
ok("C10", judge(site({ table: "practice_workspace", select: "star" })).code === "STAR_NOT_ALLOWED",
  "`*` is refused where it is not declared, on the very table whose operational columns P1 allows");

// ── §C(extractor) — the same refusals, reached from REAL SOURCE. ─────────────────────────────────────
// §C above judges hand-built sites. If the extractor could not produce those shapes, §C would be a suite
// of assertions about a data structure nothing writes — which is precisely how a vacuous test looks.
console.log("\n── §C extractor controls ────────────────────────────────────────────────────");
const probeTransitive = `
  export async function deep(admin: any) {
    const T = { p: "practice_patient" };
    async function inner(table: string) {
      return admin.from(table).select("workspace_id, given_name").eq("workspace_id", "x");
    }
    for (const [, t] of Object.entries(T)) await inner(t);
  }`;
const pT = extractReads(probeTransitive, "probe.ts");
ok("C11", pT.length === 1 && pT[0].table === "practice_patient"
  && pT[0].columns.join(",") === "workspace_id,given_name" && judge(pT[0]).code === "COLUMN_NOT_ALLOWED",
  "⚠ a table held in a PARAMETER, bound from a map at the call site, resolves to practice_patient and its widened column list is refused");
const pE = extractReads(`export const f = (a: any) => a.from("practice_workspace").select("id, practice_patient(given_name)");`, "p.ts");
ok("C12", pE.length === 1 && pE[0].embeds.length === 1 && judge(pE[0]).code === "EMBED_NOT_ALLOWED",
  "⚠ the embedded join is parsed out of the select STRING and refused");
const pS = extractReads(`export const f = (a: any, t: string) => a.from(t).select("*");`, "p.ts");
ok("C13", pS.length === 1 && pS[0].table === null && judge(pS[0]).code === "UNRESOLVED_TABLE",
  "a genuinely dynamic table produces an unresolved site, and an unresolved site is refused");
ok("C14", extractReads(`const a = [1]; export const x = Array.from(a);`, "p.ts").length === 0,
  "Array.from is not mistaken for a table read");
const pOwner = analyzeModule(
  `import { z } from "./z";
   export function used(a: any) { return a.from("practice_workspace").select("id"); }
   export function unused(a: any) { return a.from("practice_patient").select("given_name"); }`, "p.ts");
ok("C15", pOwner.sites.length === 2 && pOwner.sites.find(s => s.table === "practice_patient")?.owner === "unused",
  "⚠ each read is tagged with the declaration that owns it — the tag symbol-level reachability turns on");

// ── The allowlist, printed, because a policy nobody reads is a policy nobody keeps. ──────────────────
console.log("\n── The allowlist ────────────────────────────────────────────────────────────");
for (const d of describeAllowlist()) console.log(`  ${d.table.padEnd(34)} ${d.columns}`);
const touched = [...new Set(judged.map(s => s.table).filter(Boolean))] as string[];
const unused = PRACTICE_ALLOWLIST.map(p => p.table).filter(t => !touched.includes(t));
console.log(`\n  tables the platform plane reads today: ${touched.length}`);
ok("A4", unused.length === 0,
  unused.length === 0
    ? "no dead grants AT TABLE GRANULARITY — every allowlisted table is actually read (column-level dead grants are printed below, not asserted)"
    : `⚠ ${unused.length} allowlisted table(s) are never read (a dead grant is a door left open for nobody): ${unused.join(", ")}`);
ok("A5", touched.every(t => policyFor(t)), "every table read is named in the allowlist (the inverse of A1)");

// Column-level dead grants: REPORTED, not asserted. Asserting them would refuse the two
// practice_practitioner_identity columns, which are read by the same operator console through a route
// this rule's entry set does not cover — a scoping artefact, not a widening. Printing them is what stops
// that distinction from being invisible.
const readCols = new Map<string, Set<string>>();
for (const s of judged) {
  if (!s.table || s.select !== "columns") continue;
  const set = readCols.get(s.table) ?? new Set<string>();
  for (const c of s.columns) set.add(c);
  readCols.set(s.table, set);
}
const deadColumns = PRACTICE_ALLOWLIST.flatMap(p =>
  p.columns === "*" ? [] : p.columns.filter(c => !(readCols.get(p.table)?.has(c))).map(c => `${p.table}.${c}`));
console.log(`  columns declared but not read within this entry set: ${deadColumns.length ? deadColumns.join(", ") : "(none)"}`);

console.log(`\n${fail === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${fail} failed`);
if (failures.length) { console.log("\nFAILURES:"); failures.forEach(f => console.log("  " + f)); }
process.exit(fail === 0 ? 0 : 1);
