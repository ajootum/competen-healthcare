/**
 * PUI migration, stage 1 — replace the hand-written canonical card string with the exported constant.
 *
 * WHY THIS ONE FIRST. The string being replaced is byte-for-byte what `cardClass` exports, so the rendered
 * className is unchanged and no page can look different. That makes it the one part of a platform-wide
 * restyle that can be done mechanically across hundreds of files without a human checking each result —
 * everything else in the adoption audit (card-ish classNames, locally redefined primitives, semantic colour)
 * changes appearance and is not safe to codemod.
 *
 * The value is that the card stops being duplicated 150+ times: changing the platform card then means
 * editing one constant instead of finding every copy.
 *
 *   npx --yes tsx scripts/pui-codemod-cardclass.ts --dry     report what would change
 *   npx --yes tsx scripts/pui-codemod-cardclass.ts           apply
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const APP = join(ROOT, "src/app");
const CARD = "bg-white rounded-xl border border-gray-200 p-5";
const IMPORT = 'import { cardClass } from "@/components/ui/primitives";';

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(p)) out.push(p);
  }
  return out;
};

type Change = { file: string; sites: number; skipped: string[] };

export function transform(src: string): { out: string; sites: number; skipped: string[] } {
  const skipped: string[] = [];
  let sites = 0;

  // A file that defines its own cardClass is left alone: rebinding the name to the import would silently
  // change what that file renders, which is exactly what this stage promises not to do.
  if (/(?:const|let|function)\s+cardClass\b/.test(src)) return { out: src, sites: 0, skipped: ["defines its own cardClass"] };

  let out = src.replace(/className=(["'])([^"'`]*)\1/g, (whole, _q, cls: string) => {
    if (!cls.includes(CARD)) return whole;
    const rest = cls.replace(CARD, "").replace(/\s+/g, " ").trim();
    sites++;
    // Extra utilities are APPENDED, never reordered. Tailwind's cascade is source-order dependent, and a
    // reshuffle could change which of two conflicting utilities wins.
    return rest ? `className={\`\${cardClass} ${rest}\`}` : "className={cardClass}";
  });

  // Template classNames: only the plain `className={`...`}` form, and only when the card sits at the start.
  // A card string spliced into the middle of an interpolated template is left for a human — the risk of
  // changing utility order there is not worth the tidiness.
  out = out.replace(/className=\{`([^`]*)`\}/g, (whole, cls: string) => {
    if (!cls.includes(CARD)) return whole;
    if (!cls.trimStart().startsWith(CARD)) { skipped.push("card string not at the start of a template"); return whole; }
    const rest = cls.replace(CARD, "").replace(/\s+/g, " ").trim();
    sites++;
    return rest ? `className={\`\${cardClass} ${rest}\`}` : "className={cardClass}";
  });

  // The other half of the duplication: a local alias, `const card = "<the same string>"`. Assigning from
  // the import rather than deleting the binding means every existing `{card}` usage in the file keeps
  // working untouched — the alias stays, only its source of truth moves.
  out = out.replace(new RegExp(`(=\\s*)"${CARD.replace(/[-/\\^$*+?.()|[\\]{}]/g, "\\\\$&")}"`, "g"), (_w, eq: string) => {
    sites++;
    return `${eq}cardClass`;
  });

  if (sites === 0) return { out: src, sites, skipped };

  if (!out.includes('from "@/components/ui/primitives"')) {
    // Insert after the last import so directives ("use client") and existing imports stay put.
    const imports = [...out.matchAll(/^import .*?;$/gm)];
    if (imports.length) {
      const last = imports[imports.length - 1];
      const at = last.index! + last[0].length;
      out = out.slice(0, at) + "\n" + IMPORT + out.slice(at);
    } else {
      skipped.push("no import statement to anchor to — left unchanged");
      return { out: src, sites: 0, skipped };
    }
  } else if (!/\bcardClass\b/.test(out.split("\n").filter(l => l.startsWith("import")).join("\n"))) {
    // Already imports from primitives, but not cardClass — extend that import rather than adding a second.
    out = out.replace(/import\s*\{([^}]*)\}\s*from\s*"@\/components\/ui\/primitives";/,
      (_w, names: string) => `import {${names.trimEnd()}, cardClass } from "@/components/ui/primitives";`);
  }

  return { out, sites, skipped };
}

function main() {
  const dry = process.argv.includes("--dry");
  const files = walk(APP).filter(f => !f.includes("components/ui/"));
  const changes: Change[] = [];
  let total = 0;

  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (!src.includes(CARD)) continue;
    const { out, sites, skipped } = transform(src);
    if (sites > 0) {
      changes.push({ file: relative(ROOT, f).replace(/\\/g, "/"), sites, skipped });
      total += sites;
      if (!dry) writeFileSync(f, out);
    } else if (skipped.length) {
      changes.push({ file: relative(ROOT, f).replace(/\\/g, "/"), sites: 0, skipped });
    }
  }

  console.log(`\n${dry ? "DRY RUN — nothing written" : "APPLIED"}\n`);
  console.log(`  ${changes.filter(c => c.sites).length} file(s), ${total} card site(s)\n`);
  for (const c of changes.filter(c => c.sites).sort((a, b) => b.sites - a.sites).slice(0, 25)) {
    console.log(`  ${String(c.sites).padStart(3)}  ${c.file}`);
  }
  const skips = changes.filter(c => c.skipped.length);
  if (skips.length) {
    console.log(`\n  Left for a human (${skips.length}):`);
    for (const c of skips.slice(0, 15)) console.log(`       ${c.file}  — ${[...new Set(c.skipped)].join("; ")}`);
  }
  console.log();
}

if (process.argv[1] && process.argv[1].endsWith("pui-codemod-cardclass.ts")) main();
