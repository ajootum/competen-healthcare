/**
 * Finds component implementations that are duplicated VERBATIM across files.
 *
 * The adoption audit says 86 primitives are redefined in pages rather than imported. That number on its own
 * is not actionable: some of those are a workspace's own visual language (the educator surfaces are dark,
 * and the platform library has no dark card — replacing them with the light one would be a redesign, not a
 * migration). What IS actionable is the subset where two or more files contain the SAME implementation
 * character for character. Those can be merged into one with zero rendering change, and that is provable.
 *
 * So this reports only exact duplicates, grouped, and changes nothing.
 *
 *   npx --yes tsx scripts/pui-find-duplicate-components.ts
 *   npx --yes tsx scripts/pui-find-duplicate-components.ts --show <Name>   print one implementation
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const APP = join(ROOT, "src/app");

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(p)) out.push(p);
  }
  return out;
};

type Impl = { name: string; file: string; body: string; hash: string; lines: number };

// Pull each top-level function component out by brace matching. A regex alone cannot find the end of a
// component, and a body cut short would hash as "different" and hide a real duplicate.
function extractComponents(src: string, file: string): Impl[] {
  const out: Impl[] = [];
  const re = /^(?:export\s+)?function\s+([A-Z]\w*)\s*\(/gm;
  for (const m of src.matchAll(re)) {
    const start = m.index!;
    // Step over the PARAMETER LIST first. A destructured parameter opens a brace of its own, and matching
    // that one instead of the body's would make every "implementation" just a signature — which silently
    // turns this tool into a signature-duplication detector while still reporting confident numbers.
    let p = start + m[0].length - 1;   // at the opening paren
    let pd = 0, afterParams = -1;
    for (; p < src.length; p++) {
      if (src[p] === "(") pd++;
      else if (src[p] === ")") { pd--; if (pd === 0) { afterParams = p + 1; break; } }
    }
    if (afterParams < 0) continue;
    let i = src.indexOf("{", afterParams);
    if (i < 0) continue;
    let depth = 0, end = -1, inStr: string | null = null;
    for (; i < src.length; i++) {
      const c = src[i], prev = src[i - 1];
      if (inStr) { if (c === inStr && prev !== "\\") inStr = null; continue; }
      if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end < 0) continue;
    const raw = src.slice(start, end);
    // Normalise whitespace only. Identifiers, classes and structure must match exactly for two
    // implementations to count as the same — this is not a similarity score.
    const body = raw.replace(/\s+/g, " ").trim();
    out.push({ name: m[1], file, body, hash: createHash("sha1").update(body).digest("hex"), lines: raw.split("\n").length });
  }
  return out;
}

function main() {
  const show = process.argv.includes("--show") ? process.argv[process.argv.indexOf("--show") + 1] : null;
  const impls: Impl[] = [];
  for (const f of walk(APP)) {
    impls.push(...extractComponents(readFileSync(f, "utf8"), relative(ROOT, f).replace(/\\/g, "/")));
  }

  const groups = new Map<string, Impl[]>();
  for (const i of impls) {
    const key = `${i.name}:${i.hash}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  }
  const dupes = [...groups.values()].filter(g => g.length > 1).sort((a, b) => b.length - a.length || b[0].lines - a[0].lines);

  console.log("\nVerbatim-duplicate components\n");
  console.log(`  ${impls.length} top-level components across ${new Set(impls.map(i => i.file)).size} files`);
  console.log(`  ${dupes.length} implementation(s) appear in more than one file`);
  const copies = dupes.reduce((n, g) => n + g.length - 1, 0);
  console.log(`  ${copies} redundant copies could be deleted with no rendering change\n`);

  if (show) {
    const g = dupes.find(x => x[0].name === show);
    if (g) { console.log(`  ${show} — ${g.length} copies:\n`); console.log(g[0].body.slice(0, 1400)); console.log(); }
    else console.log(`  no verbatim duplicate named ${show}\n`);
    return;
  }

  for (const g of dupes.slice(0, 30)) {
    console.log(`  ${String(g.length).padStart(2)}x  ${g[0].name.padEnd(18)} ${String(g[0].lines).padStart(3)} lines`);
    for (const i of g) console.log(`         ${i.file}`);
  }
  // Same name, different body: NOT safe to merge, and worth seeing so the two numbers are not confused.
  const byName = new Map<string, Set<string>>();
  for (const i of impls) {
    if (!byName.has(i.name)) byName.set(i.name, new Set());
    byName.get(i.name)!.add(i.hash);
  }
  const divergent = [...byName.entries()].filter(([, h]) => h.size > 1).sort((a, b) => b[1].size - a[1].size);
  console.log(`\n  Same name, DIFFERENT implementation (not mergeable without a design decision):`);
  for (const [name, hashes] of divergent.slice(0, 12)) console.log(`    ${name.padEnd(18)} ${hashes.size} distinct versions`);
  console.log();
}

main();
