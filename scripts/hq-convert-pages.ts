/**
 * CP-HQ-NAV-001 step 3 — convert the role-gated /super-admin pages to the HQ capability guard.
 *
 * Run:  npx --yes tsx scripts/hq-convert-pages.ts          (dry run — reports, writes nothing)
 *       npx --yes tsx scripts/hq-convert-pages.ts --apply  (writes)
 *
 * ⚠ A CODEMOD, NOT AN AGENT, AND DELIBERATELY SO. 167 files edited by hand or by a model is 167 chances to
 * quietly drop a guard. This does one textual substitution it can state exactly, refuses anything it does
 * not recognise, and is re-runnable: a second run finds nothing to do.
 *
 * ⚠ IT REPLACES THE GATE LINE AND NOTHING ELSE. The obvious tidier version would also delete the now-dead
 * profile read and the `roles` local -- and would have to know, per file, whether anything downstream still
 * uses `user`, `profile`, `roles` or `supabase`. Getting that wrong on one of 167 pages breaks a page for
 * everybody; leaving a redundant read costs one query on a page only owners open. The narrow edit is the
 * safe one.
 *
 * ⚠ AND IT WRITES requireHqCapability, NOT requireHqContext. These pages already refuse non-owners today.
 * requireHqContext honours hq_config.mode, which is `observe`, and observe ADMITS a would_deny -- so the
 * "safe" spelling would have opened all 167 to every appointee. See resolveHqContext's `enforce` option.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { classifyHqGate } from "../src/lib/access/hq-scan";
import { capabilityForRoute, HQ_HOME_CAPABILITY } from "../src/lib/hq/spaces";

const APPLY = process.argv.includes("--apply");
const GUARD_IMPORT = 'import { requireHqCapability } from "@/lib/hq/context";';

// The two idioms the survey found across all 167 files. Anything else is reported and skipped, never
// guessed at.
const GATES: { name: string; re: RegExp }[] = [
  { name: "roles.includes", re: /^([ \t]*)if \(!roles\.includes\("super_admin"\)\) redirect\("\/dashboard"\);[ \t]*$/m },
  { name: "profile.role",   re: /^([ \t]*)if \(profile\?\.role !== "super_admin"\) redirect\("\/dashboard"\);[ \t]*$/m },
];

const walk = (d: string, o: string[] = []): string[] => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, o);
    else if (e === "page.tsx") o.push(p);
  }
  return o;
};

const routeOf = (f: string) =>
  "/" + f.split("\\").join("/").replace(/^src\/app\//, "").replace(/\/page\.tsx$/, "")
    .split("/").filter(s => !(s.startsWith("(") && s.endsWith(")"))).join("/");

const CAPS = { HQ_HOME_CAPABILITY: { "": HQ_HOME_CAPABILITY } };

const files = walk("src/app/super-admin");
const converted: string[] = [];
const already: string[] = [];
const skipped: { file: string; why: string }[] = [];

// ── PASS 2: the pages that were ALREADY capability-gated, and were still an escalation path ─────────
//
// ⚠ THIS HALF WAS NOT IN THE ORIGINAL PLAN AND IS THE MORE IMPORTANT ONE. The 38 pages built inside the HQ
// programme call requireHqContext, which HONOURS hq_config.mode -- and the mode is `observe`, which admits
// a would_deny. Measured against live data before this pass ran: the one non-owner appointee could reach
// 37 pages whose capability he does not hold, INCLUDING /super-admin/users/appointments -- the screen that
// grants HQ positions. Anybody holding any position could therefore appoint themselves Chief Executive.
//
// Converting them costs those pages their observe-mode rollout, which is the right trade: observe protects
// against refusing somebody who needs access, and the people it would refuse here are exactly the people
// who should be refused. Owners are unaffected either way -- isOwner short-circuits before mode is read.
const OBSERVE_CALL = /requireHqContext\s*\(\s*([^)]*?)\s*\)/g;
const OBSERVE_IMPORT = 'import { requireHqContext } from "@/lib/hq/context";';

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const capability = capabilityForRoute(routeOf(file));
  // ⚠ NEVER INVENT ONE. An unmapped route is a route whose audience nobody has written down; guessing a
  // capability here would be authoring policy inside a text-substitution script.
  if (!capability) { skipped.push({ file, why: "route has no declared capability in HQ_ROUTE_INTENT" }); continue; }

  if (OBSERVE_CALL.test(source)) {
    OBSERVE_CALL.lastIndex = 0;
    const out = source.replace(OBSERVE_CALL, (_m, arg: string) => {
      const a = arg.trim();
      // The bare and explicit-null forms resolve the route from a header at runtime; the enforcing guard
      // takes a literal precisely so that cannot fail open. Everything else keeps the argument it had.
      return a === "" || a === "null" ? `requireHqCapability("${capability}")` : `requireHqCapability(${a})`;
    }).replace(OBSERVE_IMPORT, GUARD_IMPORT);

    if (out.includes("requireHqContext")) { skipped.push({ file, why: "a requireHqContext reference survived the rewrite" }); continue; }
    const after = classifyHqGate(out, {}, CAPS);
    if (after.kind !== "hq-position") { skipped.push({ file, why: `post-edit classification is ${after.kind}` }); continue; }
    if (APPLY) writeFileSync(file, out);
    converted.push(`${file}  ->  ${capability}  [observe->enforce]`);
    continue;
  }

  if (classifyHqGate(source, {}, CAPS).kind === "hq-position") { already.push(file); continue; }

  const hits = GATES.filter(g => g.re.test(source));
  if (hits.length !== 1) {
    skipped.push({ file, why: hits.length === 0 ? "no recognised gate idiom" : `${hits.length} idioms matched` });
    continue;
  }
  const gate = hits[0];
  // Exactly one occurrence, or the file is doing something this script should not touch.
  const occurrences = source.split("\n").filter(l => new RegExp(gate.re.source.replace(/^\^|\$$/g, "")).test(l)).length;
  if (occurrences !== 1) { skipped.push({ file, why: `${occurrences} occurrences of the gate line` }); continue; }

  let out = source.replace(gate.re, (_m, indent: string) => `${indent}await requireHqCapability("${capability}");`);

  if (!out.includes("requireHqCapability")) { skipped.push({ file, why: "substitution produced no guard call" }); continue; }

  if (!out.includes(GUARD_IMPORT)) {
    const lines = out.split("\n");
    // After the LAST top-level import, so the guard sits with the other imports rather than above a
    // directive or inside the body.
    let last = -1;
    for (let i = 0; i < lines.length; i++) if (/^import .*;\s*$/.test(lines[i])) last = i;
    if (last === -1) { skipped.push({ file, why: "no import line to anchor the guard import" }); continue; }
    lines.splice(last + 1, 0, GUARD_IMPORT);
    out = lines.join("\n");
  }

  // The proof that the edit did what it claims: the file must now classify as an HQ gate carrying the
  // capability we intended. A codemod that cannot verify its own output is a find-and-replace.
  const after = classifyHqGate(out, {}, CAPS);
  if (after.kind !== "hq-position" || !after.capabilities?.includes(capability)) {
    skipped.push({ file, why: `post-edit classification is ${after.kind} (${after.capabilities?.join(",") ?? "no caps"})` });
    continue;
  }

  if (APPLY) writeFileSync(file, out);
  converted.push(`${file}  ->  ${capability}  [${gate.name}]`);
}

console.log(`\n${APPLY ? "APPLIED" : "DRY RUN (nothing written)"}`);
console.log(`  pages scanned            ${files.length}`);
console.log(`  already capability-gated ${already.length}`);
console.log(`  converted                ${converted.length}`);
console.log(`  skipped                  ${skipped.length}`);

if (skipped.length) {
  console.log(`\n⚠ SKIPPED — each of these still carries its original gate and needs a human:`);
  for (const s of skipped) console.log(`  ${s.file}\n      ${s.why}`);
}

const byCap = new Map<string, number>();
for (const c of converted) { const cap = c.split("->")[1].trim().split(" ")[0]; byCap.set(cap, (byCap.get(cap) ?? 0) + 1); }
console.log(`\nconverted pages per capability:`);
for (const [cap, n] of [...byCap.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${cap}`);

process.exit(skipped.length ? 1 : 0);
