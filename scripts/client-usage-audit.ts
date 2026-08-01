/**
 * Which tables does the application ever touch through the USER client?
 *
 * WHY IT SETTLES SOMETHING. The RLS audit reports 111 tables with row-level security on and no policies.
 * That denies every non-service request, which is safe but usually means a feature is silently dead. The
 * only way to tell "safe" from "dead" is whether anything reads the table as a user at all: a table
 * reached exclusively through the service-role client is unaffected by having no policies, because the
 * service role bypasses RLS. So the question is answerable mechanically rather than by judgement.
 *
 * It also answers the inverse, which is the more dangerous direction: a table reached through the USER
 * client is one whose RLS policies are load-bearing. Those are the ones where a missing or wrong policy
 * shows up as a broken page, and where a too-permissive one is a real hole.
 *
 * RECEIVERS ARE READ BACKWARDS, NOT BY LINE. Chains wrap:
 *
 *     const { data } = await c.admin
 *       .from("competency_scores")
 *
 * so `grep 'from("x")' | grep -v admin` calls that a user-client read. It is not. This walks back from
 * each `.from(` across newlines to the receiver expression that actually owns the call, which is the
 * difference between an answer and a plausible-looking list. (I made exactly that mistake by hand
 * earlier in this session, on this exact table.)
 *
 *   npx --yes tsx scripts/client-usage-audit.ts
 *   npx --yes tsx scripts/client-usage-audit.ts --table <name>
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
loadEnvConfig(process.cwd());

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
};

// Receivers that bypass RLS. Anything else that resolves to a supabase client is user-scoped.
const SERVICE = /(^|\.)admin$|^adminClient$|^svc$|^createAdminClient$/;
const USERISH = /^supabase$|^client$|^db$|^sb$|^createClient$/;

type Use = { table: string; file: string; line: number; receiver: string; kind: "service" | "user" | "unknown" };

function usesIn(file: string): Use[] {
  const src = readFileSync(file, "utf8");
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const out: Use[] = [];
  for (const m of src.matchAll(/\.from\(\s*["'`]([\w]+)["'`]\s*\)/g)) {
    // Comments first: a `.from(` can sit under an explanatory line, and its trailing word is not a
    // receiver.
    const before = src.slice(Math.max(0, m.index! - 300), m.index!)
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

    // Walk backwards: skip the wrap, then take identifier characters until something that is not one.
    //
    // COLLAPSING ALL WHITESPACE FIRST WAS WRONG AND LOUDLY SO. `await admin` became the single token
    // `awaitadmin`, which matched neither list, so 2,209 service-role calls landed in "unknown" -- and
    // because unknown was then treated as user-scoped, 186 `await admin.from("audit_log")` calls were
    // reported as user-client reads. Whitespace terminates an identifier; it does not disappear.
    let i = before.length - 1;
    while (i >= 0 && /\s/.test(before[i])) i--;

    // A `)` before `.from` means the receiver is parenthesised, and the two cases need opposite handling:
    //
    //   createAdminClient().from(...)      a CALL   -> the receiver is the callee, outside the parens
    //   (caller.admin as any).from(...)    a CAST   -> the receiver is inside the parens
    //
    // Telling them apart is just whether an identifier immediately precedes the `(`. Stepping over both
    // the same way left `await` as the receiver and one table permanently undecided.
    if (i >= 0 && before[i] === ")") {
      const close = i;
      let depth = 0;
      while (i >= 0) {
        if (before[i] === ")") depth++;
        else if (before[i] === "(") { depth--; if (depth === 0) break; }
        i--;
      }
      const open = i;
      const isCall = open > 0 && /[A-Za-z0-9_$]/.test(before[open - 1]);
      if (isCall) { i = open - 1; while (i >= 0 && /\s/.test(before[i])) i--; }
      else {
        // Parenthesised expression: classify by the identifier chain it starts with.
        const inner = before.slice(open + 1, close).trim();
        const lead = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/.exec(inner)?.[1] ?? "";
        const leadLast = lead.split(".").pop() ?? "";
        const k: Use["kind"] = SERVICE.test(lead) || SERVICE.test(leadLast) ? "service"
          : USERISH.test(leadLast) ? "user" : "unknown";
        out.push({ table: m[1], file: rel, line: src.slice(0, m.index!).split("\n").length, receiver: lead || "(paren)", kind: k });
        continue;
      }
    }

    const end = i + 1;
    while (i >= 0 && /[A-Za-z0-9_$.]/.test(before[i])) i--;
    const chain = before.slice(i + 1, end);

    const last = chain.split(".").pop() ?? "";
    // `admin.storage.from("avatars")` addresses a STORAGE BUCKET, not a table. It has no RLS policy and
    // does not belong in a table census at all -- classifying it either way would be an answer to a
    // question nobody asked.
    if (last === "storage") continue;
    const kind: Use["kind"] = SERVICE.test(chain) || SERVICE.test(last) ? "service"
      : USERISH.test(last) ? "user" : "unknown";
    out.push({ table: m[1], file: rel, line: src.slice(0, m.index!).split("\n").length, receiver: chain || "(none)", kind });
  }
  return out;
}

async function main() {
  const tIdx = process.argv.indexOf("--table");
  const only = tIdx >= 0 ? process.argv[tIdx + 1] : null;

  const uses = walk(SRC).flatMap(usesIn);
  const byTable = new Map<string, Use[]>();
  for (const u of uses) {
    if (!byTable.has(u.table)) byTable.set(u.table, []);
    byTable.get(u.table)!.push(u);
  }

  console.log(`\nClient-usage audit\n`);
  console.log(`  ${uses.length} .from() call site(s) across ${byTable.size} table(s)\n`);

  if (only) {
    const list = byTable.get(only) ?? [];
    console.log(`  ${only}: ${list.length} call site(s)\n`);
    for (const u of list) console.log(`    ${u.kind.padEnd(8)} ${u.receiver.padEnd(14)} ${u.file}:${u.line}`);
    console.log();
    return;
  }

  const unknown = uses.filter(u => u.kind === "unknown");
  if (unknown.length) {
    const shown = [...new Set(unknown.map(u => u.receiver))].slice(0, 12);
    console.log(`  ${unknown.length} call site(s) whose receiver could not be classified — REPORTED, not assumed`);
    console.log(`  receivers: ${shown.join(", ")}${[...new Set(unknown.map(u => u.receiver))].length > 12 ? ", ..." : ""}\n`);
  }

  // Cross-reference the zero-policy tables: safe, or a dead feature?
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("  Missing Supabase env.\n"); process.exit(1); }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const reg = await admin.rpc("plat_rls_registry");
  if (reg.error) { console.log(`  plat_rls_registry() unavailable — apply migration 172 for the RLS cross-reference.\n`); return; }

  const live = new Map<string, { rls: boolean; policies: number }>();
  for (const r of (reg.data ?? []) as any[]) {
    if (!live.has(r.tbl)) live.set(r.tbl, { rls: r.rls_enabled, policies: 0 });
    if (r.policy_name) live.get(r.tbl)!.policies++;
  }
  const zeroPolicy = [...live.entries()].filter(([, v]) => v.rls && v.policies === 0).map(([t]) => t);

  // UNKNOWN IS NOT USER. Treating an unclassified receiver as user-scoped is how a broken classifier
  // turns into a confident list of 111 "broken" features. Unknowns are counted and named separately so
  // the gap in the tool is visible instead of being laundered into a finding.
  const dead: string[] = [], benign: string[] = [], unsure: string[] = [];
  for (const t of zeroPolicy) {
    const list = byTable.get(t) ?? [];
    const userSites = list.filter(u => u.kind === "user");
    const unknownSites = list.filter(u => u.kind === "unknown");
    if (userSites.length) dead.push(`${t}  ${userSites.length} user-client site(s): ${userSites.slice(0, 3).map(u => `${u.file}:${u.line}`).join(", ")}`);
    else if (unknownSites.length) unsure.push(`${t}  ${unknownSites.length} unclassified site(s), e.g. receiver "${unknownSites[0].receiver}" at ${unknownSites[0].file}:${unknownSites[0].line}`);
    else benign.push(t);
  }

  console.log(`  ${zeroPolicy.length} table(s) have RLS on with ZERO policies. Cross-referenced against real usage:\n`);
  if (dead.length) {
    console.log(`  BROKEN FOR REAL USERS (${dead.length}) — reached through the user client, but every row is denied`);
    for (const d of dead) console.log(`    ${d}`);
    console.log();
  }
  if (unsure.length) {
    console.log(`  UNDECIDED (${unsure.length}) — only unclassified receivers, so this tool cannot say either way`);
    for (const u of unsure) console.log(`    ${u}`);
    console.log();
  }
  console.log(`  ${benign.length} of them are touched ONLY through the service-role client, which bypasses RLS.`);
  console.log(`  Having no policies costs those nothing — the category is safe, not merely "probably fine".\n`);

  // The inverse, and the more important half.
  const userTables = [...byTable.entries()].filter(([, l]) => l.some(u => u.kind === "user")).map(([t]) => t).sort();
  console.log(`  LOAD-BEARING RLS — ${userTables.length} table(s) are reached through the USER client, so their`);
  console.log(`  policies are the only thing standing between a logged-in user and the rows:`);
  for (const t of userTables) {
    const l = live.get(t);
    console.log(`    ${t.padEnd(30)} ${l ? `RLS ${l.rls ? "on" : "OFF"}, ${l.policies} policy(ies)` : "not in public schema"}`);
  }
  console.log();
}

main();
