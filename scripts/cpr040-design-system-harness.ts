/**
 * CPR-040 design-system harness -- the Practice surface uses the token layer, not raw colour.
 *
 * WHY THIS IS A HARNESS AND NOT A CONVENTION. A design system adopted by find-and-replace stays adopted
 * for exactly as long as nobody is in a hurry. The next `bg-[#2563EB]` typed at 1am compiles, renders,
 * looks nearly right, and quietly reintroduces the palette the system replaced. Nothing catches it --
 * not tsc, not eslint, not the build. So the rule is asserted against the SOURCE.
 *
 * WHAT IT PROVES:
 *   1. Every token CPR-040 s3/s4 names is actually declared in globals.css. A component referencing
 *      var(--cp-radius-md) when nothing defines it renders with NO radius and no error at all --
 *      an undefined custom property is not a mistake to CSS, it is simply nothing.
 *   2. No raw six-digit hex survives in the Practice surface, with a named allow-list for the few
 *      places a literal is legitimate.
 *   3. The specification's own values are the ones in the file. The CPR-040 POSTER labels its primary
 *      #2E3AA8; the DOCUMENT's section 4 says #4F46E5, as does CPR-V2-001 v3. Two v1.0 documents against
 *      one image is not close, and the prose is what a developer implements -- so the prose values are
 *      asserted, and this comment records that the disagreement was seen rather than missed.
 *
 *   npx --yes tsx scripts/cpr040-design-system-harness.ts
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

// Every token the specification names. Kept here rather than imported from the CSS: a harness that
// learns its expectations from the thing it is checking proves only that the file equals itself.
const REQUIRED_TOKENS = [
  "--cp-primary", "--cp-primary-deep", "--cp-accent", "--cp-canvas",
  "--cp-success", "--cp-warning", "--cp-error", "--cp-info",
  "--cp-slate-900", "--cp-slate-700", "--cp-slate-500", "--cp-slate-300", "--cp-slate-100", "--cp-white",
  "--cp-font-base",
  "--cp-text-display-1", "--cp-text-display-2", "--cp-text-heading-1", "--cp-text-body", "--cp-text-caption",
  "--cp-space-1", "--cp-space-2", "--cp-space-4", "--cp-space-8", "--cp-space-16",
  "--cp-radius-xs", "--cp-radius-sm", "--cp-radius-md", "--cp-radius-lg", "--cp-radius-full",
  "--cp-shadow-xs", "--cp-shadow-sm", "--cp-shadow-md", "--cp-shadow-lg", "--cp-shadow-xl",
  "--cp-motion-fast", "--cp-motion-base", "--cp-easing",
];

// CPR-040 s4's prose values.
const SPEC_VALUES: [string, string][] = [
  ["--cp-primary", "#4F46E5"],
  ["--cp-primary-deep", "#312E81"],
  ["--cp-accent", "#06B6D4"],
];

function sources(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith(".")) sources(p, out); }
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

// LEGITIMATE LITERALS, each with a reason. An allow-list with reasons is reviewable; a blanket
// exception is how a rule dies.
const ALLOWED = new Set<string>([
  "#FFFFFF", "#ffffff", // svg fill on the dark closing panel, where a token would resolve per-theme
]);

function main() {
  console.log("\nCPR-040 design-system harness (Competen Practice token adoption)\n");

  const cssPath = join(process.cwd(), "src", "app", "globals.css");
  const css = readFileSync(cssPath, "utf8");

  const missing = REQUIRED_TOKENS.filter(t => !new RegExp(`${t}\\s*:`).test(css));
  ok("1. every CPR-040 token is declared", missing.length === 0, missing.join(", "));

  // CONTROL: a token that was never specified must NOT be found, or the check above is matching
  // anything that looks vaguely like a variable.
  ok("1-control. an invented token is not found", !/--cp-not-a-real-token\s*:/.test(css));

  for (const [token, value] of SPEC_VALUES) {
    const m = css.match(new RegExp(`${token}\\s*:\\s*([^;]+);`));
    ok(`2. ${token} carries the specification's value ${value}`,
      !!m && m[1].trim().toUpperCase() === value.toUpperCase(), m?.[1]?.trim() ?? "not declared");
  }

  // ── 3. No raw colour left in the Practice surface ────────────────────────────────────────────
  const files = [
    ...sources(join(process.cwd(), "src", "app", "practice")),
    ...sources(join(process.cwd(), "src", "lib", "practice")),
    join(process.cwd(), "src", "lib", "marketing", "practice-content.ts"),
    join(process.cwd(), "src", "lib", "marketing", "practice-site.ts"),
  ];
  // ⚠ ONE FILE IS EXEMPT, AND IT IS EXEMPT BY PATH RATHER THAN BY VALUE.
  //
  // preference-constants.ts declares ACCENTS: the seven accent colours a practitioner may CHOOSE in
  // Personalisation. A colour picker has to contain colours -- the swatch IS the value -- so these are
  // data the user selects from, not theme a component leaked. There is no token to point them at, because
  // a token per user choice is just this list with more steps.
  //
  // ⚠ EXEMPTED BY PATH, NOT BY ADDING THE SEVEN HEXES TO ALLOWED. #4F46E5 is the brand indigo; putting it
  // in ALLOWED would let any component in the Practice surface hardcode the primary colour and still pass
  // the check that exists to stop exactly that. The exemption is this file's palette and nothing else.
  const ACCENT_PALETTE = join(process.cwd(), "src", "lib", "practice", "preference-constants.ts");

  /**
   * ⚠ COMMENTS ARE BLANKED BEFORE THE SCAN, AND THE LINE NUMBERS SURVIVE IT (2026-08-17).
   *
   * The two genuine offenders below were fixed by pointing them at their tokens -- and the fix turned
   * this assertion red again, because the comment EXPLAINING each fix quoted the hex it had removed.
   * That is the needle matching its own documentation: a check that reads prose cannot be explained
   * without breaking it, so the explanations get deleted instead, which is the worst of both.
   *
   * Blanking replaces each comment's characters with spaces rather than removing them, because this
   * scan reports `file:line` and a stripper that collapsed lines would report the wrong ones.
   */
  const blankComments = (s: string) => s
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p: string) => p + " ".repeat(m.length - p.length));

  const offenders: string[] = [];
  for (const f of files) {
    if (!existsSync(f)) continue;
    if (f === ACCENT_PALETTE) continue;
    for (const [i, line] of blankComments(readFileSync(f, "utf8")).split("\n").entries()) {
      // ⚠ NOT PRECEDED BY & -- A NUMERIC CHARACTER REFERENCE IS NOT A COLOUR (2026-08-17).
      // This scan reported eleven "raw hex colours" that were emoji: &#128197; is a calendar, &#128205;
      // a pin, &#128100; a person. The old needle consumed neither the & nor the ; and \b is satisfied
      // by the semicolon, so six decimal digits inside an entity were indistinguishable from #128197
      // the colour. The cost was not the noise: it was that this assertion sat permanently red, and a
      // harness known to be red is one nobody reads the day it goes red for a real reason.
      for (const hex of line.match(/(?<!&)#[0-9A-Fa-f]{6}\b/g) ?? []) {
        if (!ALLOWED.has(hex)) offenders.push(`${f.replace(process.cwd() + "\\", "")}:${i + 1} ${hex}`);
      }
    }
  }
  ok("3. no raw hex colour in the Practice surface", offenders.length === 0,
    offenders.slice(0, 8).join(" | ") + (offenders.length > 8 ? ` (+${offenders.length - 8} more)` : ""));

  // CONTROL for the blanker, because a stripper that ate too much would make assertion 3 pass by
  // reading nothing. It must remove a hex written in a comment, keep one written in code, and return
  // the file at exactly its original length in lines so `file:line` above still points at the truth.
  {
    const probe = "const a = \"#AABBCC\";\n// a comment mentioning #DDEEFF\n/* and #112233 */\nconst b = 1;\n";
    const out = blankComments(probe);
    ok("3-blank-control comments are blanked, code is not, and line numbering is preserved",
      /#AABBCC/.test(out) && !/#DDEEFF/.test(out) && !/#112233/.test(out)
      && out.split("\n").length === probe.split("\n").length);
  }

  // CONTROL: the scan must actually be reading files. Without this, a bad path glob reports a clean
  // sweep of nothing -- the confident zero this project keeps meeting.
  ok("3-control. the scan read a meaningful number of files", files.length > 20, `${files.length} files`);

  // ⚠ THE EXEMPTION IS BOUNDED, OR IT IS A HOLE. An exempt file is a place raw colour can accumulate
  // unnoticed, so the exemption is only as good as a check on its size. Seven accents are offered; an
  // eighth hex in this file -- or a hex outside the ACCENTS block -- is a new raw colour and must fail.
  const paletteLines = readFileSync(ACCENT_PALETTE, "utf8").split("\n");
  const paletteHexes = paletteLines.flatMap(l => l.match(/#[0-9A-Fa-f]{6}\b/g) ?? []);
  const accentBlock = paletteLines
    .slice(paletteLines.findIndex(l => /export const ACCENTS/.test(l)),
           paletteLines.findIndex(l => /export const FONT_SCALES/.test(l)))
    .flatMap(l => l.match(/#[0-9A-Fa-f]{6}\b/g) ?? []);
  ok("3-exempt. the exempt palette holds exactly its 7 accents, all inside the ACCENTS block",
    paletteHexes.length === 7 && accentBlock.length === 7,
    `${paletteHexes.length} in the file, ${accentBlock.length} inside ACCENTS`);

  // ── 4. The focus rule CPR-040 s9 requires is present and scoped ──────────────────────────────
  ok("4. a visible focus state is defined for the Practice surface",
    /\.cp-surface\s+:focus-visible/.test(css));
  ok("4b. reduced motion is honoured", /prefers-reduced-motion/.test(css));

  // ── 5. EVERY DESIGN TOKEN A PRACTICE SURFACE NAMES IS ACTUALLY DEFINED ────────────────────────
  //
  // ⚠ ADDED AFTER THE RAW-HEX RULE CAUGHT SOMETHING BY LUCK. Honesty.tsx carried
  // `text-[var(--cmp-accent,#4338ca)]`. `--cmp-accent` is defined nowhere -- globals.css declares 55
  // --cmp-* tokens and that is not one of them -- so the FALLBACK was the real colour, on every render.
  // Assertion 3 flagged the hex, which was correct but incidental: the defect was an undefined token,
  // and the hex was only how it happened to be visible.
  //
  // Written without a fallback, `var(--cmp-accent)` resolves to nothing, the property is dropped, the
  // text inherits, and NO rule here would have said a word. Worse, this particular token had a
  // theme-aware sibling: --cp-primary-deep is re-declared per practice accent, so the fallback also
  // froze one link at indigo while the rest of the surface followed the practice's own colour.
  //
  // ⚠ SCOPE: only the --cp-* and --cmp-* families, which globals.css owns. Third-party or inline
  // custom properties are not this rule's business, and a token defined by a library would be a false
  // positive rather than a finding.
  //
  // ⚠ AND ONLY THE FILES ABOVE, WHICH IS WHY THIS NEEDS NO INTERPOLATION GUARD TODAY.
  // src/components/ui builds token names at runtime -- `var(--cmp-text-${tone})` -- and a static scan
  // would read the prefix as an undefined token. Those files are not in `files`. If this list is ever
  // widened to src/components, add a guard for the ${ form FIRST, or this rule goes noisy on day one,
  // which is how a rule stops being read.
  const defined = new Set<string>();
  for (const m of readFileSync(cssPath, "utf8").matchAll(/(--(?:cp|cmp)-[a-z0-9-]+)\s*:/g)) defined.add(m[1]);

  const undefinedTokens: string[] = [];
  for (const f of files) {
    if (!existsSync(f)) continue;
    const src = blankComments(readFileSync(f, "utf8"));
    for (const [i, line] of src.split("\n").entries()) {
      for (const m of line.matchAll(/var\(\s*(--(?:cp|cmp)-[a-z0-9-]+)/g)) {
        if (!defined.has(m[1])) undefinedTokens.push(`${f.replace(/\\/g, "/").split("/src/")[1] ?? f}:${i + 1} ${m[1]}`);
      }
    }
  }
  ok("5. every --cp-*/--cmp-* token a Practice surface names is defined in globals.css",
    undefinedTokens.length === 0, undefinedTokens.slice(0, 4).join(" | "));
  ok("5-control the scan found tokens at all, so it cannot pass by matching nothing",
    defined.size > 20, `${defined.size} defined`);

  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exitCode = fails.length ? 1 : 0;
}

main();
