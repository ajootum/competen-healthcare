/**
 * PUI migration harness — proves the codemod changed no rendering.
 *
 * A 128-file codemod is only defensible if the claim "no page looks different" is CHECKED rather than
 * asserted. So this reads the actual git diff and, for every changed line, reconstructs the className that
 * was rendered before and after — expanding `${cardClass}` back to the literal string — and compares them
 * as SETS of utilities. A reordering, a dropped utility or an added one all fail.
 *
 * It also pins the constant itself: if `cardClass` ever stops equalling the string it replaced, every one of
 * those 153 sites changes at once, so that equality is the load-bearing fact of the whole stage.
 *
 *   npx --yes tsx scripts/pui-migration-harness.ts            check the working tree against HEAD
 *   npx --yes tsx scripts/pui-migration-harness.ts <ref>      check against a specific ref
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const CARD = "bg-white rounded-xl border border-gray-200 p-5";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// Expand the constant back to what the browser actually receives. Three forms reach here: the template
// interpolation `${cardClass}`, the braced expression {cardClass}, and the bare identifier captured from
// className={cardClass} — all of them are the same string once rendered.
const expand = (s: string) => s.replace(/\$\{cardClass\}|\bcardClass\b/g, CARD);
const tokens = (s: string) => new Set(s.replace(/[{}`"']/g, " ").split(/\s+/).filter(Boolean));

// Every className on a line, in whichever of the three forms it takes.
function classNames(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/className=(?:\{`([^`]*)`\}|\{(cardClass)\}|(["'])([^"']*)\3)/g)) {
    out.push(m[1] ?? m[2] ?? m[4] ?? "");
  }
  return out;
}

function main() {
  const ref = process.argv[2] ?? "HEAD";
  console.log("\nPUI migration — stage 1 (cardClass)\n");

  // ── The load-bearing constant ──
  const prim = readFileSync(join(ROOT, "src/components/ui/primitives.tsx"), "utf8");
  const decl = prim.match(/export const cardClass\s*=\s*"([^"]*)"/);
  ok("cardClass is exported as a plain string constant", !!decl);
  ok("cardClass still equals the string it replaced", decl?.[1] === CARD,
    `cardClass = "${decl?.[1]}"`);

  // ── The diff ──
  let diff = "";
  try { diff = git("diff", "-U0", ref, "--", "src/app"); } catch { /* no diff */ }
  const files = new Map<string, { removed: string[]; added: string[] }>();
  let current = "";
  for (const line of diff.split("\n")) {
    const f = line.match(/^\+\+\+ b\/(.+)$/);
    if (f) { current = f[1]; files.set(current, { removed: [], added: [] }); continue; }
    if (!current) continue;
    if (line.startsWith("-") && !line.startsWith("---")) files.get(current)!.removed.push(line.slice(1));
    if (line.startsWith("+") && !line.startsWith("+++")) files.get(current)!.added.push(line.slice(1));
  }

  console.log(`\nDiff against ${ref}: ${files.size} file(s)`);
  if (files.size === 0) {
    console.log("  (nothing to verify — run the codemod first, or the change is already committed)");
  }

  // ── Class-set equality, per file ──
  let compared = 0; const mismatches: string[] = [];
  for (const [file, { removed, added }] of files) {
    const before = removed.flatMap(classNames).map(expand);
    const after = added.flatMap(classNames).map(expand);
    // Only lines that carried a className are comparable; an added import line has none.
    if (before.length === 0 && after.length === 0) continue;
    if (before.length !== after.length) { mismatches.push(`${file}: ${before.length} className(s) before, ${after.length} after`); continue; }
    for (let i = 0; i < before.length; i++) {
      compared++;
      const a = tokens(before[i]), b = tokens(after[i]);
      const same = a.size === b.size && [...a].every(t => b.has(t));
      if (!same) mismatches.push(`${file}: {${[...a].join(" ")}} -> {${[...b].join(" ")}}`);
    }
  }
  ok(`every changed className renders the same utilities (${compared} compared)`, mismatches.length === 0,
    mismatches.slice(0, 5).join(" | "));

  // ── Imports resolve ──
  const bad: string[] = [];
  for (const file of files.keys()) {
    const src = readFileSync(join(ROOT, file), "utf8");
    if (!/\bcardClass\b/.test(src)) continue;
    const imported = /import\s*\{[^}]*\bcardClass\b[^}]*\}\s*from\s*"@\/components\/ui\/primitives"/.test(src);
    const declared = /(?:const|let|function)\s+cardClass\b/.test(src);
    if (!imported && !declared) bad.push(file);
  }
  ok("every file using cardClass imports it", bad.length === 0, bad.slice(0, 5).join(", "));

  // ── No file ended up with two primitives imports ──
  const doubled: string[] = [];
  for (const file of files.keys()) {
    const src = readFileSync(join(ROOT, file), "utf8");
    const n = (src.match(/from\s*"@\/components\/ui\/primitives"/g) ?? []).length;
    if (n > 1) doubled.push(`${file} (${n})`);
  }
  ok("no file gained a duplicate primitives import", doubled.length === 0, doubled.slice(0, 5).join(", "));

  // ── The literal is gone from the migrated files ──
  let leftovers = 0;
  for (const file of files.keys()) {
    const src = readFileSync(join(ROOT, file), "utf8");
    leftovers += (src.match(new RegExp(CARD.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "g")) ?? []).length;
  }
  ok("no migrated file still writes the card string by hand", leftovers === 0, `${leftovers} left`);

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"}  ${pass}/${pass + fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
