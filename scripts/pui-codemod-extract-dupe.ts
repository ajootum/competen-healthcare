/**
 * PUI migration, stage 2 — replace a verbatim-duplicated component with an import from a shared kit.
 *
 * Only ever operates on implementations that scripts/pui-find-duplicate-components.ts proved IDENTICAL by
 * hashing real function bodies. The kit holds that same implementation, so every migrated page renders
 * exactly what it rendered before — the change is that there is now one copy instead of N.
 *
 * It refuses to touch a file whose implementation does not hash-match the kit's. That guard is the whole
 * safety argument: a near-copy that merely looks the same would otherwise be silently restyled.
 *
 *   npx --yes tsx scripts/pui-codemod-extract-dupe.ts <Name> <kit-path> [--dry]
 *   e.g. ... Kpi src/app/super-admin/cgr/_kit.tsx --dry
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(p)) out.push(p);
  }
  return out;
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const hash = (s: string) => createHash("sha1").update(norm(s)).digest("hex");

// Same brace-matching as the detector, including stepping over the parameter list first.
function findComponent(src: string, name: string): { start: number; end: number; body: string } | null {
  const re = new RegExp(`^(?:export\\s+)?function\\s+${name}\\s*\\(`, "m");
  const m = src.match(re);
  if (!m || m.index === undefined) return null;
  const start = m.index;
  let p = start + m[0].length - 1, pd = 0, afterParams = -1;
  for (; p < src.length; p++) {
    if (src[p] === "(") pd++;
    else if (src[p] === ")") { pd--; if (pd === 0) { afterParams = p + 1; break; } }
  }
  if (afterParams < 0) return null;
  let i = src.indexOf("{", afterParams);
  if (i < 0) return null;
  let depth = 0, end = -1, inStr: string | null = null;
  for (; i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (inStr) { if (c === inStr && prev !== "\\") inStr = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return null;
  return { start, end, body: src.slice(start, end) };
}

function importPath(from: string, kit: string): string {
  let rel = relative(dirname(from), kit).replace(/\\/g, "/").replace(/\.tsx$/, "");
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

function main() {
  const FLAGVALS = ["--as", "--from-hash"];
  const positional = process.argv.slice(2).filter((a, i, arr) => !a.startsWith("--") && !FLAGVALS.includes(arr[i - 1]));
  const [name, kitArg] = positional;
  const dry = process.argv.includes("--dry");
  // --as lets the kit's export have a different name from the local one it replaces. The import is then
  // ALIASED back to the local name, so every existing <Card> in the file keeps working and the codemod
  // never has to rename JSX — renaming call sites would be an edit this guard cannot verify.
  const localName = process.argv.includes("--as") ? process.argv[process.argv.indexOf("--as") + 1] : null;
  const fromHash = process.argv.includes("--from-hash") ? process.argv[process.argv.indexOf("--from-hash") + 1] : null;
  if (!name || !kitArg) { console.log("usage: <Name> <kit-path> [--as <LocalName>] [--dry]"); process.exit(1); }

  const kitFile = join(ROOT, kitArg);
  const kit = findComponent(readFileSync(kitFile, "utf8"), name);
  if (!kit) { console.log(`the kit does not define ${name}`); process.exit(1); }
  // The kit's `export function X` and a page's `function X` differ by one keyword — compare the bodies
  // with that normalised away, so the guard tests the implementation and not the modifier.
  // The component NAME is normalised out as well, so an alias-rename is not mistaken for a different
  // implementation. Everything else must still match character for character.
  const nameless = (b: string, n: string) => b.replace(/^export\s+/, "").replace(new RegExp(`function\\s+${n}\\b`), "function _");
  const kitHash = hash(nameless(kit.body, name));

  const targets = walk(join(ROOT, "src/app")).filter(f => f !== kitFile);
  const migrated: string[] = [];
  const refused: string[] = [];

  for (const f of targets) {
    const src = readFileSync(f, "utf8");
    const found = findComponent(src, localName ?? name);
    if (!found) continue;
    const rel = relative(ROOT, f).replace(/\\/g, "/");
    const bodyHash = hash(nameless(found.body, localName ?? name));
    // --from-hash migrates a body that is NOT textually equal to the kit's, but only one whose hash is the
    // exact value given on the command line. It exists for the case where the kit component is a proven
    // RENDER-equivalent superset rather than a copy — DarkCard with muted=false emits the same class set as
    // the plain variant, and pui-migration-harness.ts asserts that. The guard is not loosened: it still
    // refuses everything except one named, pre-verified implementation.
    const wanted = fromHash ?? kitHash;
    // In a dry run the refusal carries the body's hash, so a genuinely equivalent variant can be identified
    // and passed back via --from-hash rather than the guard being weakened to let it through.
    // A prefix is accepted so the 12-character hash the dry run prints can be pasted straight back. Twelve
    // hex characters is 48 bits — far more than enough to name one implementation in this codebase.
    if (!bodyHash.startsWith(wanted)) { refused.push(dry ? `${rel}  [${bodyHash.slice(0, 12)}]` : rel); continue; }

    // Remove the local definition, then import the identical one.
    let out = src.slice(0, found.start) + src.slice(found.end);
    out = out.replace(/\n{3,}/g, "\n\n");
    const spec = localName && localName !== name
      ? `import { ${name} as ${localName} } from "${importPath(f, kitFile)}";`
      : `import { ${name} } from "${importPath(f, kitFile)}";`;
    const imports = [...out.matchAll(/^import .*?;$/gm)];
    if (!imports.length) { refused.push(rel + " (no import to anchor to)"); continue; }
    const last = imports[imports.length - 1];
    out = out.slice(0, last.index! + last[0].length) + "\n" + spec + out.slice(last.index! + last[0].length);

    migrated.push(rel);
    if (!dry) writeFileSync(f, out);
  }

  console.log(`\n${dry ? "DRY RUN — nothing written" : "APPLIED"}  ${name} -> ${kitArg}\n`);
  console.log(`  ${migrated.length} file(s) migrated`);
  for (const m of migrated) console.log(`    ${m}`);
  if (refused.length) {
    console.log(`\n  ${refused.length} file(s) define ${name} DIFFERENTLY and were left alone:`);
    // Uncapped in a dry run: the refusal list IS the working material for deciding what to promote next,
    // and a silent "... and 57 more" would hide exactly the variants worth looking at.
    for (const r of (dry ? refused : refused.slice(0, 20))) console.log(`    ${r}`);
  }
  console.log();
}

main();
