/**
 * ASSESSMENT CORE LITERAL BAN -- the universal engine names no profession, framework, learner or scale.
 *
 *   npx --yes tsx scripts/assessment-core-literals.ts
 *   npx --yes tsx scripts/assessment-core-literals.ts --self-test
 *
 * Scans every .ts/.tsx file under src/lib/assessment/core (tests and fixtures included) with COMMENTS STRIPPED, so the
 * explanatory comments may talk about what the engine is not. String and template literals are NOT stripped: a banned
 * word in a literal is a violation. The ban is the owner's rule that the shared core is not a nursing system:
 *   /nurs|competenc|criteri|learner|scholar|benner|dacum|clinical/i
 *
 * Controls (a harness that always passes is worth nothing):
 *   0  the strip did not simply empty the files (files found, code remains)
 *   1  planted: a banned word in code is caught
 *   2  planted: a banned word in a string literal is caught
 *   3  planted: a banned word only inside a comment is NOT a violation (the strip works, comment markers inside strings survive)
 *
 * The coordinator merges this section into scripts/assessment-core-harness.ts.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

export const BANNED = /nurs|competenc|criteri|learner|scholar|benner|dacum|clinical/i;
export const CORE_DIR = "src/lib/assessment/core";
/**
 * EXACT tokens the approved design (asmt-design s6, owner template library) fixes in the layout vocabulary. They are
 * presentation names, not engine knowledge, and are removed before the ban is applied. Anything else containing a banned
 * word is still a violation (a planted control proves it). To be decided by the coordinator: rename to generic names.
 *   competency_matrix        asmt_layout_template_version.presentation value (owner: Competency Matrix template)
 *   CriterionRow|Card|Focus  item components of the asmt.layout/1 grammar
 */
export const DESIGN_FIXED = /competency_matrix|Criterion(?:Row|Card|Focus)(?![A-Za-z])/g;

/** Remove // and block comments, keeping string, template and regex-free code intact. Line breaks are kept. */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") out += "\n"; i++; } i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += c; i++;
      while (i < n && src[i] !== q) {
        if (src[i] === "\\") { out += src[i] + (src[i + 1] ?? ""); i += 2; continue; }
        if (q === "`" && src[i] === "$" && src[i + 1] === "{") {
          // a template expression: copy it, tracking braces, stripping comments inside it is not needed
          let depth = 0;
          while (i < n) { out += src[i]; if (src[i] === "{") depth++; if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } } i++; }
          continue;
        }
        out += src[i]; i++;
      }
      out += q; i++;
      continue;
    }
    out += c; i++;
  }
  return out;
}

export interface Violation { file: string; line: number; word: string; text: string }

export function scanSource(file: string, src: string): Violation[] {
  const out: Violation[] = [];
  stripComments(src).replace(DESIGN_FIXED, "").split("\n").forEach((text, idx) => {
    const m = BANNED.exec(text);
    if (m) out.push({ file, line: idx + 1, word: m[0], text: text.trim().slice(0, 120) });
  });
  return out;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

export function scanCore(root = process.cwd()): { files: string[]; violations: Violation[]; codeChars: number } {
  const files = walk(join(root, CORE_DIR));
  const violations: Violation[] = [];
  let codeChars = 0;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    codeChars += stripComments(src).replace(/\s/g, "").length;
    violations.push(...scanSource(relative(root, f).replace(/\\/g, "/"), src));
  }
  return { files, violations, codeChars };
}

export function selfTest(): string[] {
  const fails: string[] = [];
  const t = (name: string, cond: boolean) => { if (!cond) fails.push(name); console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}`); };
  t("planted word in code is caught", scanSource("x.ts", "export const nursingMode = 1;").length === 1);
  t("planted word in a string literal is caught", scanSource("x.ts", 'export const label = "Learner view";').length === 1);
  t("planted word in a template literal is caught", scanSource("x.ts", "export const s = `a ${1} scholar`;").length === 1);
  t("a word only in a line comment is not a violation", scanSource("x.ts", "// the core is not clinical\nexport const a = 1;").length === 0);
  t("a word only in a block comment is not a violation", scanSource("x.ts", "/* dacum\n benner */ export const a = 1;").length === 0);
  t("a comment marker inside a string does not hide what follows", scanSource("x.ts", 'const u = "http://x"; const competency = 1;').length === 1);
  t("the design-fixed layout names are allowed", scanSource("x.ts", 'const a = ["CriterionRow", "competency_matrix"];').length === 0);
  t("but a near miss is not", scanSource("x.ts", 'const a = "CriterionList"; const b = "competency_map";').length === 1);
  t("line numbers survive the strip", scanSource("x.ts", "/* a\n b */\nconst benner = 1;")[0]?.line === 3);
  return fails;
}

if (process.argv[1] && /assessment-core-literals/.test(process.argv[1])) {
  if (process.argv.includes("--self-test")) {
    const fails = selfTest();
    console.log(fails.length ? `\n${fails.length} control(s) FAILED` : "\nall controls passed");
    process.exit(fails.length ? 1 : 0);
  }
  const { files, violations, codeChars } = scanCore();
  const control0 = files.length > 0 && codeChars > 1000;
  console.log(`  ${control0 ? "PASS" : "FAIL"}  control 0: ${files.length} files, ${codeChars} code characters after the strip`);
  const self = selfTest();
  for (const v of violations) console.log(`  FAIL  ${v.file}:${v.line} banned word "${v.word}": ${v.text}`);
  if (violations.length === 0) console.log(`  PASS  no banned literal in ${files.length} core files`);
  const bad = !control0 || self.length > 0 || violations.length > 0;
  console.log(bad ? "\nFAILED" : "\nOK");
  process.exit(bad ? 1 : 0);
}
