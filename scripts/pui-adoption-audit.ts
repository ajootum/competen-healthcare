/**
 * PUI adoption audit — measures how much of the app is built on the design system, per workspace.
 *
 * This runs BEFORE any migration and after every stage of it. A platform-wide restyle is only safe if it
 * is measured: without a baseline, "migrated" is an opinion, and a codemod that quietly skipped half the
 * files would look identical to one that worked.
 *
 * It reports, and changes nothing.
 *
 *   npx --yes tsx scripts/pui-adoption-audit.ts            summary per workspace
 *   npx --yes tsx scripts/pui-adoption-audit.ts --detail   the worst offenders, with counts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

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

// The canonical card, written out by hand. This exact string is what `cardClass` exports.
const CARD_CLASS = "bg-white rounded-xl border border-gray-200 p-5";
const CARD_ISH = /bg-white[^"'`]*rounded-(?:xl|lg|2xl)[^"'`]*border/;

type Row = {
  file: string; workspace: string;
  usesPui: boolean;
  puiImports: string[];
  cardClassLiteral: number;   // the exact canonical string, hand-written
  cardIsh: number;            // a card-shaped className that is not the canonical one
  localPrimitives: string[];  // Card/Stat/Badge/Section defined locally, duplicating the library
  rawHex: number;             // #rrggbb in className or style
  tailwindSemantic: number;   // text-red-600 / bg-emerald-50 style semantic colour
  tokenVars: number;          // var(--cmp-*)
  lines: number;
};

const PRIMITIVE_NAMES = ["Card", "Stat", "Badge", "Section", "Alert", "Progress", "EmptyState", "TableWrap", "Th", "Chip", "PriorityPill", "Skeleton", "KpiRibbon", "Donut", "StackedBar", "Gauge"];

function analyse(file: string): Row {
  const src = readFileSync(file, "utf8");
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const ws = rel.replace("src/app/", "").split("/")[0];

  const puiImports = [...src.matchAll(/from\s+"@\/components\/ui\/(\w+)"/g)].map(m => m[1]);
  const localPrimitives = PRIMITIVE_NAMES.filter(n =>
    new RegExp(`(?:function|const)\\s+${n}\\s*[({=]`).test(src));

  const classAttrs = [...src.matchAll(/className=\{?["'`]([^"'`]*)["'`]/g)].map(m => m[1]);
  const styleAttrs = [...src.matchAll(/style=\{\{([^}]*)\}\}/g)].map(m => m[1]);

  return {
    file: rel, workspace: ws,
    usesPui: puiImports.length > 0,
    puiImports: [...new Set(puiImports)],
    cardClassLiteral: (src.match(new RegExp(CARD_CLASS.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "g")) ?? []).length,
    cardIsh: classAttrs.filter(c => CARD_ISH.test(c) && !c.includes(CARD_CLASS)).length,
    localPrimitives,
    rawHex: [...classAttrs, ...styleAttrs].join(" ").match(/#[0-9a-fA-F]{6}\b/g)?.length ?? 0,
    tailwindSemantic: classAttrs.join(" ").match(/\b(?:text|bg|border)-(?:red|rose|amber|yellow|emerald|green|sky|blue|orange)-\d{2,3}\b/g)?.length ?? 0,
    tokenVars: (src.match(/var\(--cmp-/g) ?? []).length,
    lines: src.split("\n").length,
  };
}

function main() {
  const detail = process.argv.includes("--detail");
  const rows = walk(APP).map(analyse);
  const pages = rows.filter(r => /\/(page|layout)\.tsx$/.test(r.file));

  console.log("\nPUI adoption\n");
  console.log(`  ${rows.length} .tsx files under src/app  (${pages.length} pages and layouts)`);
  console.log(`  ${rows.filter(r => r.usesPui).length} file(s) import the component library`);
  console.log(`  ${pages.filter(r => r.usesPui).length} of ${pages.length} pages/layouts do\n`);

  const by = new Map<string, Row[]>();
  for (const r of rows) { if (!by.has(r.workspace)) by.set(r.workspace, []); by.get(r.workspace)!.push(r); }

  const head = "  workspace".padEnd(28) + "files".padStart(6) + "  on PUI".padStart(9) + "  cardClass".padStart(11) + "  card-ish".padStart(10) + "  local prims".padStart(13) + "  tw-colour".padStart(11) + "  tokens".padStart(8);
  console.log(head);
  console.log("  " + "-".repeat(head.length - 2));
  const sorted = [...by.entries()].sort((a, b) => b[1].length - a[1].length);
  let totals = { files: 0, pui: 0, cardClass: 0, cardIsh: 0, local: 0, tw: 0, tok: 0 };
  for (const [ws, list] of sorted) {
    const pui = list.filter(r => r.usesPui).length;
    const cardClass = list.reduce((n, r) => n + r.cardClassLiteral, 0);
    const cardIsh = list.reduce((n, r) => n + r.cardIsh, 0);
    const local = list.reduce((n, r) => n + r.localPrimitives.length, 0);
    const tw = list.reduce((n, r) => n + r.tailwindSemantic, 0);
    const tok = list.reduce((n, r) => n + r.tokenVars, 0);
    totals = { files: totals.files + list.length, pui: totals.pui + pui, cardClass: totals.cardClass + cardClass, cardIsh: totals.cardIsh + cardIsh, local: totals.local + local, tw: totals.tw + tw, tok: totals.tok + tok };
    console.log("  " + ws.padEnd(26) + String(list.length).padStart(6) + String(pui).padStart(9) + String(cardClass).padStart(11) + String(cardIsh).padStart(10) + String(local).padStart(13) + String(tw).padStart(11) + String(tok).padStart(8));
  }
  console.log("  " + "-".repeat(head.length - 2));
  console.log("  " + "TOTAL".padEnd(26) + String(totals.files).padStart(6) + String(totals.pui).padStart(9) + String(totals.cardClass).padStart(11) + String(totals.cardIsh).padStart(10) + String(totals.local).padStart(13) + String(totals.tw).padStart(11) + String(totals.tok).padStart(8));

  console.log(`\n  cardClass  = the canonical card string written out by hand (a drop-in import)`);
  console.log(`  card-ish   = a card-shaped className that is NOT the canonical one (needs a human eye)`);
  console.log(`  local prims= Card/Stat/Badge/Section etc. redefined in a page instead of imported`);
  console.log(`  tw-colour  = semantic colour as a Tailwind class rather than a token`);

  if (detail) {
    console.log("\n  Files redefining the most primitives:");
    for (const r of rows.filter(r => r.localPrimitives.length).sort((a, b) => b.localPrimitives.length - a.localPrimitives.length).slice(0, 20)) {
      console.log(`    ${String(r.localPrimitives.length).padStart(2)}  ${r.file}  [${r.localPrimitives.join(", ")}]`);
    }
    console.log("\n  Files with the most hand-written canonical cards:");
    for (const r of rows.filter(r => r.cardClassLiteral).sort((a, b) => b.cardClassLiteral - a.cardClassLiteral).slice(0, 15)) {
      console.log(`    ${String(r.cardClassLiteral).padStart(3)}  ${r.file}`);
    }
    console.log("\n  Raw hex colours in markup:");
    const hex = rows.filter(r => r.rawHex).sort((a, b) => b.rawHex - a.rawHex).slice(0, 12);
    if (!hex.length) console.log("    none");
    for (const r of hex) console.log(`    ${String(r.rawHex).padStart(3)}  ${r.file}`);
  }
  console.log();
}

main();
