/**
 * CPR-HFE-REF-001 s9 -- the practitioner-estate inventory, as a thing you can re-run.
 *
 * s14 asks for every practitioner-facing refusal call site to be inventoried. An inventory taken once
 * and pasted into a commit message is a photograph; this is the camera. It scans src/app/practice and
 * src/lib/practice with comments stripped, and flags PROSE strings (five or more real words -- not
 * keys, class lists or query fragments) carrying a spec id, a section number, a build phase, a
 * function call, a practice table name or implementation jargon.
 *
 * ⚠ IT REPORTS CANDIDATES, NOT DEFECTS, AND THE DIFFERENCE MATTERS. A flagged string in
 * src/app/practice is almost certainly rendered. A flagged string in src/lib/practice may be a metric
 * formula, a refusal technicalDetail or an engine comment -- all of which are REQUIRED to keep their
 * technical language (s11). Deciding which is which is a read, not a regex, and this tool does not
 * pretend otherwise.
 *
 *   node scripts/practice-refusal-inventory.mjs <output-file>
 *
 * The enforcing check is scripts/practice-refusal-harness.ts. This one is for surveying.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

/** Comments stripped exactly as the harness does -- blocks first, then line comments. */
const strip = (src) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map(l => (/^\s*(\/\/|\*)/.test(l) ? "" : l))
    .join("\n");

const ID = /\b(CPR|COMP|PLAT|IAM|WEB|GOV|CST|CAP|AVB|PAT|REG|PID|MOB|HFE|LP)-[A-Z0-9]{2,}(-[0-9]+)?\b/;
const SECTION = /\bs[0-9]{1,2}(\.[0-9]+)?['’]s?\b|\bs[0-9]{1,2}\.[0-9]+\b/;
const PHASE = /\bPhase [0-9]\b/;
const FN = /\b[a-z][A-Za-z0-9]*\(\)/;
const TABLE = /\bpractice_[a-z_]+\b/;
const JARGON = /\b(schema|payload|endpoint|nullable|foreign key|migration [0-9]|the comp\b|COMP\b)/i;

const files = execSync('git ls-files "src/**/*.ts" "src/**/*.tsx"', { encoding: "utf8" })
  .split("\n").filter(Boolean)
  // the practitioner estate: the Practice product and the lib modules whose strings feed it
  .filter(f => f.startsWith("src/app/practice/") || f.startsWith("src/lib/practice/"));

const rows = [];
for (const f of files) {
  const src = strip(readFileSync(f, "utf8"));
  // string literals long enough to be prose rather than a key or a class name
  const lits = [...src.matchAll(/"([^"\\\n]{18,240})"/g)].map(m => m[1]);
  for (const t of lits) {
    const flags = [];
    if (ID.test(t)) flags.push("spec-id");
    if (SECTION.test(t)) flags.push("section");
    if (PHASE.test(t)) flags.push("phase");
    if (FN.test(t)) flags.push("function");
    if (TABLE.test(t) && /\s\w+\s\w+\s\w+\s/.test(t)) flags.push("table-in-prose");
    if (JARGON.test(t)) flags.push("jargon");
    // Prose, not a key, a class list or a query string: real words, and not mostly punctuation.
    const words = t.trim().split(/\s+/);
    const isProse = words.length >= 5 && /[a-z]{3,}\s+[a-z]{3,}/i.test(t) && !/^[\w.-]+$/.test(t);
    if (flags.length && isProse) rows.push({ file: f, flags: flags.join("+"), text: t });
  }
}

// group by file so the triage reads as work, not as noise
const byFile = new Map();
for (const r of rows) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
const sorted = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);

let out = `CPR-HFE-REF-001 s9 -- practitioner-estate inventory\n`;
out += `${rows.length} flagged strings across ${byFile.size} files (of ${files.length} scanned)\n\n`;
for (const [f, rs] of sorted) {
  out += `\n=== ${f}  (${rs.length})\n`;
  for (const r of rs) out += `  [${r.flags}] ${r.text.slice(0, 150)}\n`;
}
writeFileSync(process.argv[2], out, "utf8");

const app = rows.filter(r => r.file.startsWith("src/app/"));
const lib = rows.filter(r => r.file.startsWith("src/lib/"));
console.log(`${rows.length} flagged PROSE strings across ${byFile.size} files`);
console.log(`  src/app/practice (definitely rendered): ${app.length}`);
console.log(`  src/lib/practice  (rendered only if a screen reads it): ${lib.length}`);
console.log("\ntop files:");
for (const [f, rs] of sorted.slice(0, 14)) console.log(`  ${String(rs.length).padStart(3)}  ${f}`);
console.log("\nby flag:");
const byFlag = {};
for (const r of rows) for (const fl of r.flags.split("+")) byFlag[fl] = (byFlag[fl] ?? 0) + 1;
for (const [k, v] of Object.entries(byFlag).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
