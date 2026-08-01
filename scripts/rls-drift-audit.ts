/**
 * RLS drift audit — is row-level security actually on, with the policies the repo declares?
 *
 * THE ASSUMPTION THIS CHECKS. Every tenant-scoping decision in this codebase divides into two cases:
 * routes that use the SERVICE-ROLE client (RLS bypassed, scoping must be explicit in the query — that is
 * what scripts/read-scope-audit.ts covers) and everything else, which is "protected by RLS". Nobody has
 * ever verified the second half. The repo declares RLS on ~208 tables and ~390 policies, applied by hand
 * across 171 migrations, against a database where four successive redefinitions of one function silently
 * failed to land.
 *
 * A table with RLS off is not subtly wrong. It is readable and writable by any authenticated user of any
 * hospital through the ordinary client, with no error anywhere.
 *
 * WHAT IT COMPARES, AND WHAT IT DELIBERATELY DOES NOT. Existence, not text:
 *   RLS OFF          the repo enables RLS on the table, the database has it disabled.  <- the dangerous one
 *   NO POLICIES      RLS is on but the table has none. Not a hole (it denies everything to non-service
 *                    roles) but usually means a feature is quietly broken for real users.
 *   MISSING POLICY   declared in the repo, absent from the database.
 *   UNDECLARED       present in the database, declared nowhere in the repo — authored in the dashboard.
 *
 * Policy BODIES are not diffed. Postgres rewrites every expression it stores (`auth.uid() = id` comes
 * back as `(auth.uid() = id)`, schema-qualified and re-parenthesised), so a textual comparison would
 * report all 390 as drifted and the tool would be ignored inside a day. Claiming to check something you
 * cannot check is worse than not checking it, so the report says this explicitly rather than letting a
 * green line imply it.
 *
 * ORDERED vs LOOSE, as in scripts/function-drift-audit.ts: numbered migrations settle intent, the 25
 * hand-run scripts in supabase/ do not, so their DROP POLICY statements are reported and not obeyed.
 *
 *   npx --yes tsx scripts/rls-drift-audit.ts
 *   npx --yes tsx scripts/rls-drift-audit.ts --table <name>   everything known about one table
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
loadEnvConfig(process.cwd());

const ROOT = process.cwd();
const SUPA = join(ROOT, "supabase");
const clean = (s: string) => s.replace(/^public\./i, "").replace(/^"|"$/g, "");

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

type Intent = { rls: boolean | null; file: string };

function main0() {
  const rlsIntent = new Map<string, Intent>();          // table -> last enable/disable
  const declared = new Map<string, Set<string>>();      // table -> policy names the repo creates
  const policyFile = new Map<string, string>();         // "table|policy" -> file
  const looseDrops: { table: string; policy: string; file: string }[] = [];

  for (const f of sqlFiles()) {
    const src = readFileSync(f.path, "utf8");
    const rel = relative(ROOT, f.path).replace(/\\/g, "/");

    for (const m of src.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?("?[\w.]+"?)\s+(enable|disable)\s+row\s+level\s+security/gi)) {
      rlsIntent.set(clean(m[1]), { rls: m[2].toLowerCase() === "enable", file: rel });
    }
    // Policy names are quoted or bare; the ON table follows. Bodies are ignored on purpose.
    //
    // THESE MUST BE PROCESSED IN FILE ORDER, not creates-then-drops. Every policy in this codebase is
    // written idempotently as `drop policy if exists X on T;` immediately followed by `create policy X on
    // T ...`. Collecting all creates and then applying all drops cancels every pair, which silently took
    // the declared count from 390 statements down to 179 and reported tables with real policies as having
    // none. A missing-policy audit that under-counts declarations is a false-clean machine.
    type Stmt = { at: number; kind: "create" | "drop"; table: string; pol: string };
    const stmts: Stmt[] = [];
    for (const m of src.matchAll(/create\s+policy\s+(?:if\s+not\s+exists\s+)?("[^"]+"|[\w]+)\s+on\s+("?[\w.]+"?)/gi))
      stmts.push({ at: m.index!, kind: "create", table: clean(m[2]), pol: clean(m[1]) });
    for (const m of src.matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?("[^"]+"|[\w]+)\s+on\s+("?[\w.]+"?)/gi))
      stmts.push({ at: m.index!, kind: "drop", table: clean(m[2]), pol: clean(m[1]) });
    stmts.sort((a, b) => a.at - b.at);

    for (const s of stmts) {
      if (s.kind === "create") {
        if (!declared.has(s.table)) declared.set(s.table, new Set());
        declared.get(s.table)!.add(s.pol);
        policyFile.set(`${s.table}|${s.pol}`, rel);
      } else if (f.ordered) {
        declared.get(s.table)?.delete(s.pol);
      } else {
        looseDrops.push({ table: s.table, policy: s.pol, file: rel });
      }
    }
  }
  return { rlsIntent, declared, policyFile, looseDrops };
}

async function main() {
  const tableArg = process.argv.indexOf("--table");
  const only = tableArg >= 0 ? process.argv[tableArg + 1] : null;
  const { rlsIntent, declared, policyFile, looseDrops } = main0();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Missing Supabase env."); process.exit(1); }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const reg = await admin.rpc("plat_rls_registry");
  console.log(`\nRLS drift audit\n`);
  if (reg.error) {
    console.log(`  plat_rls_registry() is not deployed (${reg.error.message}).`);
    console.log(`  Apply supabase/migrations/172-rls-registry.sql. There is no fallback: PostgREST cannot`);
    console.log(`  report pg_policy, so without it nothing here can be checked at all.\n`);
    process.exit(1);
  }

  const rows = (reg.data ?? []) as { tbl: string; rls_enabled: boolean; policy_name: string | null; cmd: string; roles: string; qual: string; with_check: string }[];
  const live = new Map<string, { rls: boolean; policies: Map<string, any> }>();
  for (const r of rows) {
    if (!live.has(r.tbl)) live.set(r.tbl, { rls: r.rls_enabled, policies: new Map() });
    if (r.policy_name) live.get(r.tbl)!.policies.set(r.policy_name, r);
  }

  if (only) {
    const l = live.get(only);
    console.log(`  ${only}\n`);
    console.log(`    repo:     RLS ${rlsIntent.get(only)?.rls === false ? "DISABLED" : rlsIntent.has(only) ? "enabled" : "not mentioned"}` +
      `${rlsIntent.get(only) ? ` (${rlsIntent.get(only)!.file})` : ""}, ${declared.get(only)?.size ?? 0} policy(ies) declared`);
    console.log(`    database: RLS ${l ? (l.rls ? "enabled" : "DISABLED") : "table not found"}, ${l?.policies.size ?? 0} policy(ies)\n`);
    for (const [name, p] of l?.policies ?? []) {
      console.log(`      ${name}  [${p.cmd}] roles=${p.roles ?? "-"}`);
      if (p.qual) console.log(`        using       ${p.qual}`);
      if (p.with_check) console.log(`        with check  ${p.with_check}`);
    }
    for (const name of declared.get(only) ?? []) if (!l?.policies.has(name)) console.log(`      ${name}  DECLARED IN REPO, NOT DEPLOYED`);
    console.log();
    return;
  }

  const off: string[] = [], noPolicies: string[] = [], missing: string[] = [], undeclared: string[] = [], absent: string[] = [];

  for (const [table, intent] of rlsIntent) {
    const l = live.get(table);
    if (!l) { absent.push(`${table}  (declared in ${intent.file})`); continue; }
    if (intent.rls && !l.rls) off.push(`${table}  enabled in ${intent.file}, DISABLED in the database`);
    if (l.rls && l.policies.size === 0) noPolicies.push(`${table}  RLS on, zero policies`);
  }
  // MISSING and UNDECLARED are two views of ONE phenomenon whenever they land on the same table: a policy
  // was renamed or reworked in the database and the repo was never updated. Reporting them separately
  // said "47 policies missing", which reads as 47 holes in coverage -- when performance_criteria declares
  // "Authenticated read criteria" and the database has "read criteria", same intent, 2 declared and 2
  // deployed. Pairing them per table is the difference between a real finding and an alarming number.
  //
  // A reworked table is NOT asserted equivalent. Bodies are not compared, so the honest claim is "the
  // names differ and nobody has checked that the coverage still matches" -- which is exactly why it is
  // reported instead of hidden.
  const reworked: string[] = [];
  for (const table of new Set([...declared.keys(), ...live.keys()])) {
    const l = live.get(table);
    if (!l) continue;                       // table itself missing is reported above
    const names = declared.get(table) ?? new Set<string>();
    const gone = [...names].filter(n => !l.policies.has(n));
    const extra = [...l.policies.keys()].filter(n => !names.has(n));
    if (gone.length && extra.length) {
      reworked.push(`${table}  repo has ${gone.length} name(s) the database does not, database has ${extra.length} the repo does not (${names.size} declared / ${l.policies.size} deployed)`);
      continue;
    }
    for (const n of gone) missing.push(`${table} :: ${n}  (${policyFile.get(`${table}|${n}`)})`);
    for (const n of extra) undeclared.push(`${table} :: ${n}`);
  }

  console.log(`  repo: ${rlsIntent.size} table(s) with an RLS statement, ${[...declared.values()].reduce((s, x) => s + x.size, 0)} policy(ies) declared`);
  console.log(`  live: ${live.size} table(s) in public, ${[...live.values()].filter(l => l.rls).length} with RLS on, ${rows.filter(r => r.policy_name).length} policy(ies)\n`);

  const section = (title: string, list: string[], note?: string, cap = 40) => {
    if (!list.length) return;
    console.log(`  ${title} (${list.length})`);
    if (note) console.log(`    ${note}`);
    for (const r of list.slice(0, cap)) console.log(`    ${r}`);
    if (list.length > cap) console.log(`    ... and ${list.length - cap} more (not truncated silently: this is the count)`);
    console.log();
  };

  // ── The write surface ──────────────────────────────────────────────────────
  // Everything above is about who can READ. A policy whose command is ALL (or INSERT/UPDATE/DELETE)
  // grants writes to whoever it applies to, and nothing in this codebase's naming makes that visible:
  // "Hospital staff views competency scores" is an ALL policy. `views`. Read the cmd, not the name.
  //
  // A policy with no explicit roles applies to PUBLIC, which includes anon -- an unauthenticated writer.
  // APPLYING TO PUBLIC IS NOT THE SAME AS BEING OPEN, and counting it that way would produce a scary
  // number that is mostly wrong. 94 write-capable policies apply to PUBLIC here, and nearly all are the
  // ordinary Supabase idiom: `Users insert own profile` with check (auth.uid() = id). For an anonymous
  // caller auth.uid() is NULL, `NULL = id` is NULL, and the row is refused. The ROLE is public; the
  // PREDICATE is the gate.
  //
  // So the real question is whether the predicate governing the write can be satisfied without being
  // anybody: no auth.uid(), no auth.role(), no current_user_* helper, just `true` or a row condition.
  const writeCmds = new Set(["ALL", "INSERT", "UPDATE", "DELETE"]);
  const identityRef = /auth\.uid\(\)|auth\.role\(\)|auth\.jwt\(\)|current_user_is_|current_setting\(/i;
  const writableAnon: string[] = [], misnamed: string[] = [];
  let publicWriteGated = 0;
  for (const r of rows) {
    if (!r.policy_name || !writeCmds.has(r.cmd)) continue;
    const line = `${r.tbl} :: ${r.policy_name}  [${r.cmd}] to ${r.roles || "PUBLIC"}`;
    if (/\b(read|view|views|select|list)\b/i.test(r.policy_name)) misnamed.push(line);
    if (r.roles) continue;                                   // scoped to named roles, anon excluded
    // For INSERT only with_check applies; for UPDATE/ALL both do. Any predicate at all that names the
    // caller is enough to shut an anonymous writer out.
    const pred = [r.qual, r.with_check].filter(Boolean).join(" and ").trim();
    if (pred && identityRef.test(pred)) { publicWriteGated++; continue; }
    writableAnon.push(`${line}  predicate: ${pred || "(none)"}`);
  }

  section("RLS OFF — the repo enables it, the database does not", off,
    "any authenticated user reaches every row of these tables through the ordinary client");
  section("WRITE OPEN TO ANON — applies to PUBLIC and the predicate does not name the caller", writableAnon,
    "an anonymous request could satisfy these; ANALYSED FROM THE PREDICATE, not tested, because testing a write means writing to the database");
  section("WRITE-CAPABLE POLICY WITH A READ-SOUNDING NAME", misnamed,
    "the name says read, the command grants writes; nobody reviewing this file would notice");
  section("NO POLICIES — RLS on, nothing granted", noPolicies,
    "denies all non-service access: safe, but usually means a feature is broken for real users");
  section("MISSING POLICY — declared in the repo, no counterpart on that table at all", missing,
    "a declared policy that simply never landed; the table has nothing standing in for it");
  section("UNDECLARED POLICY — in the database, declared nowhere in the repo", undeclared,
    "authored in the dashboard; a rebuild from the repo would not recreate it");
  section("REWORKED — the table has policies under different names than the repo declares", reworked,
    "renamed or rewritten in the database and never written back; coverage is unverified, NOT wrong");
  section("TABLE NOT FOUND — the repo has RLS statements for a table that does not exist", absent);
  section("LOOSE-SCRIPT POLICY DROPS — hand-run scripts, unordered", looseDrops.map(d => `${d.table} :: ${d.policy}  ${d.file}`),
    "reported, not obeyed: these files carry no reliable order relative to the migrations");

  console.log(`  ${publicWriteGated} write-capable policy(ies) apply to PUBLIC but are gated by a predicate naming`);
  console.log(`  the caller (auth.uid() and friends), which refuses an anonymous request. Not findings.`);
  console.log(`  Policy BODIES were not compared — Postgres normalises stored expressions, so a text diff`);
  console.log(`  would report every policy as drifted. Existence only.\n`);
  if (off.length || missing.length) process.exit(1);
}

main();
