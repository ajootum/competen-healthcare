/**
 * ASSESSMENT CORE LITERAL BAN -- the universal engine names no profession, framework, learner or scale.
 *
 *   npx --yes tsx scripts/assessment-core-literals.ts
 *   npx --yes tsx scripts/assessment-core-literals.ts --self-test
 *
 * Scans every .ts/.tsx file under src/lib/assessment/core and src/components/assessment (tests and fixtures included) with COMMENTS STRIPPED, so the
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
import { readdirSync, readFileSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

export const BANNED = /nurs|competenc|criteri|learner|scholar|benner|dacum|clinical/i;
export const CORE_DIR = "src/lib/assessment/core";
/** The shared React components are product-agnostic too: same stems, same strip. */
export const SCAN_DIRS = [CORE_DIR, "src/components/assessment"] as const;

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
  stripComments(src).split("\n").forEach((text, idx) => {
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

export function scanCore(root = process.cwd(), dirs: readonly string[] = SCAN_DIRS): { files: string[]; violations: Violation[]; codeChars: number } {
  const files = dirs.flatMap((d) => walk(join(root, d)));
  const violations: Violation[] = [];
  let codeChars = 0;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    codeChars += stripComments(src).replace(/\s/g, "").length;
    violations.push(...scanSource(relative(root, f).replace(/\\/g, "/"), src));
  }
  return { files, violations, codeChars };
}

/** Plant a banned word in a real file under a temporary components folder and prove the directory scan reports it, then clean up. */
function plantedDirScan(): boolean {
  const root = mkdtempSync(join(tmpdir(), "asmt-lit-"));
  try {
    mkdirSync(join(root, "src/components/assessment"), { recursive: true });
    mkdirSync(join(root, CORE_DIR), { recursive: true });
    writeFileSync(join(root, "src/components/assessment/Clean.tsx"), "export const A = 1;\n");
    const clean = scanCore(root).violations.length === 0;
    writeFileSync(join(root, "src/components/assessment/Planted.tsx"), 'export const label = "Nursing view";\n');
    const v = scanCore(root).violations;
    return clean && v.length === 1 && v[0].file === "src/components/assessment/Planted.tsx";
  } finally { rmSync(root, { recursive: true, force: true }); }
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
  t("planted word in a component file (tsx) is caught", scanSource("src/components/assessment/X.tsx", "export const X = () => <p>Learner view</p>;").length === 1);
  t("the components folder is scanned", SCAN_DIRS.includes("src/components/assessment"));
  t("planted: a banned word in a temporary components file is found by the directory scan", plantedDirScan());
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
  if (violations.length === 0) console.log(`  PASS  no banned literal in ${files.length} core and component files`);
  const bad = !control0 || self.length > 0 || violations.length > 0;
  console.log(bad ? "\nFAILED" : "\nOK");
  process.exit(bad ? 1 : 0);
}
