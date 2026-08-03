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
 *      #2E3AA8; the DOCUMENT's section 4 says #4F46E5, as does CPR-001 v3. Two v1.0 documents against
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
  const offenders: string[] = [];
  for (const f of files) {
    if (!existsSync(f)) continue;
    for (const [i, line] of readFileSync(f, "utf8").split("\n").entries()) {
      for (const hex of line.match(/#[0-9A-Fa-f]{6}\b/g) ?? []) {
        if (!ALLOWED.has(hex)) offenders.push(`${f.replace(process.cwd() + "\\", "")}:${i + 1} ${hex}`);
      }
    }
  }
  ok("3. no raw hex colour in the Practice surface", offenders.length === 0,
    offenders.slice(0, 8).join(" | ") + (offenders.length > 8 ? ` (+${offenders.length - 8} more)` : ""));

  // CONTROL: the scan must actually be reading files. Without this, a bad path glob reports a clean
  // sweep of nothing -- the confident zero this project keeps meeting.
  ok("3-control. the scan read a meaningful number of files", files.length > 20, `${files.length} files`);

  // ── 4. The focus rule CPR-040 s9 requires is present and scoped ──────────────────────────────
  ok("4. a visible focus state is defined for the Practice surface",
    /\.cp-surface\s+:focus-visible/.test(css));
  ok("4b. reduced motion is honoured", /prefers-reduced-motion/.test(css));

  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exitCode = fails.length ? 1 : 0;
}

main();
