/**
 * RLS BODY audit — semantic comparison of policy predicates, repo-authored vs database-deployed.
 *
 * COMP-ENG-002A §7 asks for "normalised USING and WITH CHECK expressions or equivalent semantic
 * assertion". scripts/rls-drift-audit.ts deliberately compares EXISTENCE only, and says so: Postgres
 * rewrites every stored expression (`auth.uid() = id` comes back schema-qualified and re-parenthesised),
 * so a text diff reports all ~317 policies as drifted and the tool gets ignored inside a day. This file
 * is the missing half.
 *
 * ⚠⚠ IT IS DELIBERATELY CONSERVATIVE, AND THE ASYMMETRY IS THE WHOLE DESIGN.
 *
 * A false "DIFFERS" costs a human five minutes reading two predicates. A false "EQUIVALENT" lets a
 * WEAKER policy pass as matching its declaration — which is how a security gate becomes a rubber stamp.
 * So EQUIVALENT is only ever claimed on an exact match after conservative normalisation. Everything
 * else is REVIEW, with both bodies printed for a person to judge. This tool does not decide; it
 * produces evidence and refuses to guess.
 *
 * WHAT NORMALISATION DOES (all of it reversible reasoning, none of it semantic):
 *   - lowercases, collapses whitespace
 *   - strips `public.` schema qualification that Postgres adds
 *   - strips `::text` / `::uuid` / `::"text"` casts Postgres adds around literals and columns
 *   - removes redundant outer parentheses, repeatedly
 *   - rewrites `x in (a, b)` to `x = any (array[a, b])`, which is what Postgres stores
 *
 * ⚠ WHAT IT CANNOT DO. It does not understand SQL. Two predicates that are logically equivalent but
 * written differently (`a and b` vs `b and a`) come back as DIFFERS, correctly, because proving that
 * equivalence needs a planner rather than a string. A DIFFERS verdict is a prompt to read, not a defect.
 *
 *   npx tsx scripts/rls-body-audit.ts                 everything needing review
 *   npx tsx scripts/rls-body-audit.ts --table <name>  one table, full bodies
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pagedRpc, capWarning } from "./_registry";

loadEnvConfig(process.cwd());

const ROOT = join(import.meta.dirname, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

type Deployed = {
  tbl: string; policy_name: string; cmd: string; roles: string;
  qual: string | null; with_check: string | null;
};
type Authored = {
  name: string; table: string; file: string; cmd: string | null;
  using: string | null; withCheck: string | null; roles: string[];
};

/**
 * Normalise a role set for comparison.
 *
 * ⚠ AN ABSENT `TO` CLAUSE MEANS PUBLIC, NOT "UNSPECIFIED". Postgres defaults a policy with no TO clause
 * to PUBLIC — every role, including `anon`. Treating the absence as "no opinion" would silently excuse
 * the single broadest thing a policy can be, which is the opposite of what COMP-ENG-002B §9 priority 1
 * is asking about.
 */
function roleSet(roles: string[] | string | null | undefined): string[] {
  if (!roles) return ["public"];
  const arr = Array.isArray(roles)
    ? roles
    : String(roles).replace(/^\{|\}$/g, "").split(",");
  const cleaned = arr.map(r => r.trim().replace(/^"|"$/g, "").toLowerCase()).filter(Boolean);
  return cleaned.length ? [...new Set(cleaned)].sort() : ["public"];
}

/** PUBLIC contains every role, so it is the widest possible set. */
const widerThan = (live: string[], repo: string[]) =>
  (live.includes("public") && !repo.includes("public"))
  || live.some(r => !repo.includes(r) && !repo.includes("public"));

/** Reads a balanced-parenthesis group starting at `open`, returning its inner text. */
function balanced(src: string, open: number): { text: string; end: number } | null {
  if (src[open] !== "(") return null;
  let depth = 0, inStr = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "'" && src[i - 1] !== "\\") inStr = !inStr;
    if (inStr) continue;
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return { text: src.slice(open + 1, i), end: i }; }
  }
  return null;
}

/**
 * Paren-insensitive form, for the SECOND verdict tier.
 *
 * ⚠ WHY THIS TIER EXISTS AND WHY IT IS NOT FOLDED INTO "EQUIVALENT". Postgres stores a parse tree and
 * re-prints it FULLY parenthesised, so `a or b` comes back as `((a) or (b))`. The overwhelming majority
 * of first-pass "differences" were nothing but that. Stripping parens from both sides recovers the
 * comparison — but it also erases GROUPING, and `(a or b) and c` is not `a or (b and c)`. Two policies
 * that differ only in grouping would compare equal here.
 *
 * So this earns its own verdict rather than being promoted to EQUIVALENT: near-certainly the same, worth
 * a glance, and never silently counted as a strict match.
 */
function normLoose(expr: string | null): string {
  // ⚠ PARENS BECOME A SPACE, NOT NOTHING. Deleting them welds neighbouring tokens together --
  // `auth.uid()or` collapses to `auth.uidor` -- which made two identical predicates compare unequal and
  // left 88 policies in review that were never different. Replace, collapse, then re-strip spacing
  // around operators so the two sides land on the same shape.
  return norm(expr)
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*([,=<>])\s*/g, "$1")
    .trim();
}

/** Conservative normalisation. See the header for what each step is and is not. */
function norm(expr: string | null): string {
  if (!expr) return "";
  let s = expr.toLowerCase();
  s = s.replace(/::\s*"?[a-z_]+"?(\s*\[\s*\])?/g, "");   // casts Postgres adds
  s = s.replace(/\bpublic\./g, "");                        // schema qualification
  s = s.replace(/"/g, "");                                 // quoted identifiers
  s = s.replace(/\s+/g, " ").trim();
  // `x in (a, b)` -> `x = any (array[a, b])`, the stored form
  s = s.replace(/\s+in\s+\(([^()]*)\)/g, " = any (array[$1])");
  s = s.replace(/\s*([(),=<>])\s*/g, "$1");
  let prev = "";
  while (prev !== s) { prev = s; if (s.startsWith("(") && balanced(s, 0)?.end === s.length - 1) s = s.slice(1, -1); }
  return s;
}

/** Parse `create policy` statements, capturing bodies. Numbered migrations only: they settle intent. */
function authoredPolicies(): Authored[] {
  const out: Authored[] = [];
  for (const f of readdirSync(MIGRATIONS).filter(f => f.endsWith(".sql")).sort()) {
    const src = readFileSync(join(MIGRATIONS, f), "utf8");
    const re = /create\s+policy\s+(?:if\s+not\s+exists\s+)?("[^"]+"|[\w]+)\s+on\s+("?[\w.]+"?)/gi;
    for (const m of src.matchAll(re)) {
      const name = m[1].replace(/"/g, "");
      const table = m[2].replace(/"/g, "").replace(/^public\./, "");
      // The statement runs to the next unquoted semicolon.
      const start = m.index! + m[0].length;
      let end = start, inStr = false;
      while (end < src.length) {
        const c = src[end];
        if (c === "'" && src[end - 1] !== "\\") inStr = !inStr;
        if (c === ";" && !inStr) break;
        end++;
      }
      const body = src.slice(start, end);
      const cmdM = body.match(/\bfor\s+(all|select|insert|update|delete)\b/i);
      const uIdx = body.search(/\busing\s*\(/i);
      const wIdx = body.search(/\bwith\s+check\s*\(/i);
      const grab = (idx: number) => {
        if (idx < 0) return null;
        const p = body.indexOf("(", idx);
        return balanced(body, p)?.text ?? null;
      };
      // `to role_a, role_b` sits between the optional FOR and the USING/WITH CHECK clauses.
      const toM = body.match(/\bto\s+([a-z_][\w",\s]*?)(?=\s+(?:using|with\s+check)\b|\s*$)/i);
      out.push({
        name, table, file: `supabase/migrations/${f}`,
        cmd: cmdM ? cmdM[1].toUpperCase() : null,
        using: grab(uIdx), withCheck: grab(wIdx),
        roles: roleSet(toM ? toM[1].split(",") : null),
      });
    }
  }
  return out;
}

async function main() {
  const only = process.argv.includes("--table") ? process.argv[process.argv.indexOf("--table") + 1] : null;

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  // ⚠ orderBy is REQUIRED and both flags are checked. _registry's own header explains why: paging an
  // unordered set-returning function can repeat or skip rows between pages, and a silent short read
  // here would understate drift -- the failure mode this whole gate exists to prevent.
  const live = await pagedRpc<Deployed>(admin, "plat_rls_registry", ["tbl", "policy_name"]);
  if (live.error) { console.error(`\ncould not read plat_rls_registry: ${live.error}\n`); process.exit(1); }
  if (live.suspicious) console.log(`\n⚠ ${capWarning(live.rows.length)}\n`);
  const deployed = (live.rows ?? []).filter(r => r.policy_name);

  // ⚠ INTENT IS THE LAST STATEMENT IN FILE ORDER, CREATE **OR DROP**. A first pass ignored DROP and
  // reported 73 missing policies against the existence audit's 10 -- because this codebase writes
  // policies idempotently as `drop policy if exists X; create policy X ...` and revises them across
  // migrations. Counting every historical CREATE as live intent measures the repo's history, not its
  // meaning.
  const authored = authoredPolicies();
  const authoredByKey = new Map<string, Authored>();
  for (const a of authored) authoredByKey.set(`${a.table}::${a.name}`, a);
  for (const f of readdirSync(MIGRATIONS).filter(f => f.endsWith(".sql")).sort()) {
    const src = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const m of src.matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?("[^"]+"|[\w]+)\s+on\s+("?[\w.]+"?)/gi)) {
      const key = `${m[2].replace(/"/g, "").replace(/^public\./, "")}::${m[1].replace(/"/g, "")}`;
      const created = authoredByKey.get(key);
      // Only a drop that comes AFTER the surviving create retires it; the idempotent drop-then-create
      // pair in the same file must not delete the very policy it precedes.
      if (created && created.file <= `supabase/migrations/${f}` && !new RegExp(
        `drop\\s+policy[^;]*${m[1].replace(/"/g, "")}[^;]*;\\s*create\\s+policy`, "i").test(src)) {
        authoredByKey.delete(key);
      }
    }
  }

  const tables = new Set([...deployed.map(d => d.tbl), ...authored.map(a => a.table)]);
  const rows: { table: string; verdict: string; detail: string }[] = [];

  // ── §9 priority 1: per-policy ROLES, reported separately from bodies ──────────────────────────
  // ⚠ A CORRECT BODY ON AN UNEXPECTEDLY BROAD ROLE SET IS AN AUTHORIZATION DEFECT, and it would be
  // invisible in a body-only comparison -- every one of those policies would read EQUIVALENT. Kept as
  // its own verdict so a widening can never be absorbed by a matching predicate.
  const roleRows: { table: string; policy: string; repo: string[]; live: string[]; wider: boolean }[] = [];
  for (const d of deployed) {
    const a = authoredByKey.get(`${d.tbl}::${d.policy_name}`);
    if (!a) continue;
    const live = roleSet(d.roles), repo = a.roles;
    if (live.join() !== repo.join()) {
      roleRows.push({ table: d.tbl, policy: d.policy_name, repo, live, wider: widerThan(live, repo) });
    }
  }

  for (const t of [...tables].sort()) {
    if (only && t !== only) continue;
    const dep = deployed.filter(d => d.tbl === t);
    const aut = authored.filter(a => a.table === t && authoredByKey.get(`${t}::${a.name}`) === a);
    if (!dep.length && !aut.length) continue;

    for (const d of dep) {
      const a = authoredByKey.get(`${t}::${d.policy_name}`);
      if (a) {
        const same = norm(a.using) === norm(d.qual) && norm(a.withCheck) === norm(d.with_check);
        const loose = normLoose(a.using) === normLoose(d.qual)
          && normLoose(a.withCheck) === normLoose(d.with_check);
        rows.push({
          table: t,
          verdict: same ? "EQUIVALENT" : loose ? "EQUIVALENT-MODULO-PARENS" : "REVIEW-BODY",
          detail: same ? `${d.policy_name}` :
            `${d.policy_name}\n      repo   USING: ${a.using ?? "-"}\n      live   USING: ${d.qual ?? "-"}` +
            (a.withCheck || d.with_check ? `\n      repo   CHECK: ${a.withCheck ?? "-"}\n      live   CHECK: ${d.with_check ?? "-"}` : ""),
        });
      } else {
        // Deployed under a name the repo does not declare -- the REWORKED case. Try to find an
        // authored policy on the same table whose BODY matches, which is what "renamed" means.
        const twin = aut.find(x => norm(x.using) === norm(d.qual) && norm(x.withCheck) === norm(d.with_check));
        rows.push({
          table: t,
          verdict: twin ? "RENAMED-ONLY" : "REVIEW-UNPAIRED",
          detail: twin
            ? `live "${d.policy_name}" has the same body as repo "${twin.name}" -- a rename, not a semantic change`
            : `live "${d.policy_name}" (${d.cmd}) pairs with no authored body on this table\n      live   USING: ${d.qual ?? "-"}`,
        });
      }
    }
    for (const a of aut) {
      if (dep.some(d => d.policy_name === a.name)) continue;
      const twin = dep.find(x => norm(x.qual) === norm(a.using) && norm(x.with_check) === norm(a.withCheck));
      if (twin) continue; // counted as RENAMED-ONLY above
      rows.push({
        table: t, verdict: "MISSING-BODY",
        detail: `repo "${a.name}" (${a.cmd ?? "?"}, ${a.file}) has no deployed counterpart\n      repo   USING: ${a.using ?? "-"}`,
      });
    }
  }

  const by = (v: string) => rows.filter(r => r.verdict === v);
  console.log("\nRLS body audit — semantic comparison\n");
  console.log(`  authored policies parsed (numbered migrations): ${authored.length}`);
  console.log(`  deployed policies:                              ${deployed.length}\n`);
  for (const v of ["EQUIVALENT", "EQUIVALENT-MODULO-PARENS", "RENAMED-ONLY", "REVIEW-BODY", "REVIEW-UNPAIRED", "MISSING-BODY"]) {
    console.log(`  ${v.padEnd(16)} ${by(v).length}`);
  }
  for (const v of ["REVIEW-BODY", "REVIEW-UNPAIRED", "MISSING-BODY", "RENAMED-ONLY"]) {
    const list = by(v);
    if (!list.length) continue;
    console.log(`\n── ${v} (${list.length}) ──`);
    for (const r of list.slice(0, only ? 999 : 40)) console.log(`  ${r.table}: ${r.detail}`);
    if (!only && list.length > 40) console.log(`  ... and ${list.length - 40} more (use --table to inspect)`);
  }
  // ── Roles report ─────────────────────────────────────────────────────────────────────────────
  const wider = roleRows.filter(r => r.wider);
  const narrower = roleRows.filter(r => !r.wider);
  console.log(`\n── ROLES (§9 priority 1) ──`);
  console.log(`  policies whose deployed role set differs from the declaration: ${roleRows.length}`);
  console.log(`    BROADER than declared (authorization defect class): ${wider.length}`);
  console.log(`    narrower than declared:                             ${narrower.length}`);
  for (const r of wider.slice(0, 30)) {
    console.log(`  ⚠ ${r.table} :: ${r.policy}  repo=[${r.repo.join(",")}] live=[${r.live.join(",")}]`);
  }
  for (const r of narrower.slice(0, 15)) {
    console.log(`    ${r.table} :: ${r.policy}  repo=[${r.repo.join(",")}] live=[${r.live.join(",")}]`);
  }

  console.log("\n⚠ EQUIVALENT means an exact match after conservative normalisation. REVIEW means a human");
  console.log("  must read both predicates — it is not by itself a defect. This tool does not decide.\n");
}

main();
