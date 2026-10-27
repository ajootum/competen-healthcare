/**
 * COMPETEN-DESIGN-SYSTEM-01 -- one Competen brand, four coordinated product themes.
 *
 * Pins what the design system promises, from source only (no database, no network, no .env.local):
 *   1. the four approved accents are exactly the directive's, and every theme colour that carries words clears AA;
 *   2. globals.css has the generated [data-cmp-theme] rule for every product, and each shell sets its theme;
 *   3. product chrome reads the theme instead of raw brand hex or Tailwind teal/blue (semantic colours are elsewhere);
 *   4. the login chooser is presentation over the server's set: no navigation of its own, storage only orders;
 *   5. the governed presentation config cannot reach a name, a colour, Platform or Practice;
 *   6. HFE-COLOR-02: one #F7F8FA canvas and white surfaces for every product shell, the approved Scholar palette,
 *      role accents (amber never as text), AA for every word and 3:1 for every field edge and activity icon.
 * Every scan is proved able to fail by a planted violation before its result is trusted.
 *
 *   npx --yes tsx scripts/design-system-themes-harness.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { contrast } from "../src/lib/design/colour-map";
import tokens, { PRODUCT_THEME_KEYS, productTheme, appSurface, accentRole, activityRole } from "../src/lib/design/tokens";
import { checkPresentationDraft, DEFAULT_PRESENTATION } from "../src/lib/design/presentation-config";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};
const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const AA = 4.5, WHITE = "#FFFFFF";

/** Source with comments removed, so a hex quoted in an explanation is not mistaken for a use. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
function walk(dir: string): string[] {
  const abs = join(ROOT, dir);
  return readdirSync(abs).flatMap(n => {
    const p = join(dir, n);
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !n.endsWith(".test.ts") ? [p] : [];
  });
}

const BRAND_HEX = /#(?:087f98|087f9c|4f46e5|0f766e|4338ca|064e3b|0a2e38|0f1b3d)\b/i;
const CHROME_UTIL = /\b(?:bg|text|border|ring|outline|from|to|hover:bg|hover:text)-(?:teal|blue)-\d{2,3}\b/;
const hexHits = (files: string[]) => files.filter(f => BRAND_HEX.test(code(read(f))));
const utilHits = (files: string[]) => files.filter(f => CHROME_UTIL.test(code(read(f))));

function main() {
  console.log("\nCOMPETEN-DESIGN-SYSTEM-01 -- product themes\n");

  console.log("1. Approved palette and contrast");
  const want = { platform: "#064E3B", individual: "#4338CA", scholar: "#0B7089", professional: "#4338CA" } as const;
  for (const k of PRODUCT_THEME_KEYS) {
    const t = productTheme[k];
    ok(`1a. ${k} accent is the approved ${want[k]}`, t.accent.toUpperCase() === want[k], t.accent);
    const words: [string, string, string][] = [["accent on white", t.accent, WHITE], ["strong on white", t.strong, WHITE], ["ink on white", t.ink, WHITE],
      ["ink on soft", t.ink, t.soft], ["on-accent on accent", t.onAccent, t.accent], ["on-accent on strong", t.onAccent, t.strong]];
    for (const [n, fg, bg] of words) ok(`1b. ${k} ${n} clears AA`, contrast(fg, bg) >= AA, `${contrast(fg, bg).toFixed(2)}`);
  }
  ok("1c. plant: a pale accent fails the AA check", contrast("#7DD3FC", WHITE) < AA);

  console.log("\n2. Generated theme rules and shells");
  const css = read("src/app/globals.css");
  const vars = tokens.cssVariables();
  for (const k of PRODUCT_THEME_KEYS) {
    ok(`2a. globals.css has [data-cmp-theme="${k}"]`, css.includes(`[data-cmp-theme="${k}"]`));
    ok(`2b. --cmp-product-${k}-accent is generated`, vars[`--cmp-product-${k}-accent`]?.toUpperCase() === want[k]);
  }
  ok("2c. the default theme is Platform", vars["--cmp-theme-accent"] === "var(--cmp-product-platform-accent)");
  ok("2d. Individual shell sets data-cmp-theme=individual", /data-cmp-theme="individual"/.test(read("src/app/individual/(app)/layout.tsx")));
  ok("2e. experience shell sets data-cmp-theme={experience}", /data-cmp-theme=\{experience\}/.test(read("src/app/individual/(app)/[experience]/layout.tsx")));
  ok("2f. Platform dashboard shell sets data-cmp-theme=platform", /data-cmp-theme="platform"/.test(read("src/app/dashboard/layout.tsx")));

  console.log("\n3. Product chrome reads the theme");
  const chrome = [
    ...walk("src/app/login"),
    "src/app/individual/(app)/layout.tsx", "src/app/individual/(app)/[experience]/layout.tsx",
    "src/app/individual/(app)/home/page.tsx", ...walk("src/app/individual/(app)/learning"),
    "src/app/dashboard/layout.tsx", "src/app/dashboard/MobileSidebar.tsx",
    "src/lib/individual/experiences.ts", "src/lib/marketing/individual-family.ts", "src/lib/marketing/products.ts",
    "src/lib/design/product-themes.ts", "src/lib/design/presentation-config.ts",
  ];
  ok("3a. the chrome set is non-trivial", chrome.length >= 15, `${chrome.length}`);
  ok("3b. no raw product hex in product chrome (tokens.ts is the only source)", hexHits(chrome).length === 0, hexHits(chrome).join(", "));
  ok("3c. no Tailwind teal/blue utility in product chrome", utilHits(chrome).length === 0, utilHits(chrome).join(", "));
  // Plants: the scans must see a violation in real code, and must ignore one only quoted in a comment.
  ok("3d. plant: a raw hex in code is caught", BRAND_HEX.test(code(`const a = "#087F98";`)));
  ok("3e. plant: a teal utility in code is caught", CHROME_UTIL.test(code(`<p className="text-teal-800" />`)));
  ok("3f. plant: a hex quoted in a comment is not a use", !BRAND_HEX.test(code(`// the old accent was #087F98\nconst a = 1;`)));
  ok("3g. semantic colours are left alone (trust label teal for 'assessed' still present)",
    /teal/.test(read("src/app/individual/_components/passport/PassportLinkView.tsx")));

  console.log("\n4. Login chooser is presentation over the server's set");
  const chooser = code(read("src/app/login/DestinationChooser.tsx"));
  const login = code(read("src/app/login/page.tsx"));
  ok("4a. heading is the directive's question", chooser.includes("How would you like to use Competen?"));
  ok("4b. the chooser never navigates on its own", !/router\.(push|replace)|location\.(href|assign|replace)|useRouter/.test(chooser));
  ok("4c. storage only orders the given set", /orderDestinations\(destinations, last\)/.test(chooser) && /list\.some\(d => d\.code === last\)/.test(chooser));
  ok("4d. the chooser renders only for state many", /resolution\?\.state === "many" && <DestinationChooser/.test(login));
  ok("4e. next goes through the shared safeNextPath guard", /safeNextPath\(new URLSearchParams\(window\.location\.search\)\.get\("next"\)/.test(login));
  ok("4f. every card has a visible focus ring and a coarse-pointer size", /focus-visible:outline-\[3px\]/.test(chooser) && /pointer-coarse:min-h-/.test(chooser));
  ok("4g. plant: a chooser that pushes the router is caught", /router\.(push|replace)/.test(`router.push("/dashboard")`));

  console.log("\n5. Governed presentation config");
  const door = read("src/app/api/hq/individual/config/route.ts");
  ok("5a. the presentation path is written only behind hq.individual.config.manage", /case "presentation"/.test(door) && /hqApiGate\(\["hq\.individual\.config\.manage"\]\)/.test(door));
  ok("5b. defaults validate", checkPresentationDraft(DEFAULT_PRESENTATION).ok);
  ok("5c. a name cannot be configured", !checkPresentationDraft({ ...DEFAULT_PRESENTATION, scholar: { ...DEFAULT_PRESENTATION.scholar, name: "X" } }).ok);
  ok("5d. a colour cannot be configured", !checkPresentationDraft({ ...DEFAULT_PRESENTATION, scholar: { ...DEFAULT_PRESENTATION.scholar, theme: "platform" } }).ok);
  ok("5e. Platform cannot be configured through this door", !checkPresentationDraft({ ...DEFAULT_PRESENTATION, platform: DEFAULT_PRESENTATION.individual }).ok);
  ok("5f. an icon outside the set is refused", !checkPresentationDraft({ ...DEFAULT_PRESENTATION, individual: { ...DEFAULT_PRESENTATION.individual, icon: "rocket" } }).ok);

  console.log("\n6. Shared canvas and Scholar refinement (HFE-COLOR-02)");
  const A = appSurface, rv = accentRole.revision, pg = accentRole.progress, ig = accentRole.indigo, sc = productTheme.scholar;
  ok("6a. the approved palette", A.bg === "#F7F8FA" && A.surface === "#FFFFFF" && A.border === "#E2E8F0" && A.text === "#142638" && A.textSecondary === "#475569"
    && sc.accent === "#0B7089" && sc.strong === "#07566B" && sc.soft === "#E8F6F9" && rv.accent === "#D97706" && rv.soft === "#FFF4DC"
    && pg.accent === "#15803D" && pg.soft === "#ECFDF5");
  const textPairs: [string, string, string][] = [
    ["body text on card", A.text, A.surface], ["body text on canvas", A.text, A.bg],
    ["secondary text on card", A.textSecondary, A.surface], ["secondary text on canvas", A.textSecondary, A.bg],
    ["Scholar button label", sc.onAccent, sc.accent], ["Scholar button label, hover", sc.onAccent, sc.strong],
    ["Scholar link on card", sc.accent, A.surface], ["Scholar link on canvas", sc.accent, A.bg],
    ["selected navigation (teal on #E8F6F9)", sc.accent, sc.soft], ["Scholar ink on soft", sc.ink, sc.soft],
    ["revision words on its tint", rv.ink, rv.soft], ["label on a revision fill", "#FFFFFF", rv.strong],
    ["progress text on card", pg.accent, A.surface], ["progress words on its tint", pg.ink, pg.soft],
    ["indigo words on its tint", ig.ink, ig.soft], ["Platform selected item (ink on soft)", productTheme.platform.ink, productTheme.platform.soft],
    ["Scholar secondary grey (gray-500) on canvas", "#5F6F80", A.bg]];
  for (const [n, fg, bg] of textPairs) ok(`6b. ${n} clears 4.5:1`, contrast(fg, bg) >= AA, contrast(fg, bg).toFixed(2));
  ok("6c. a form field's edge (controlBorder) clears 3:1 on card and canvas", contrast(A.controlBorder, A.surface) >= 3 && contrast(A.controlBorder, A.bg) >= 3);
  for (const k of Object.keys(activityRole)) {
    const icon = vars[`--cmp-activity-${k}-icon`], chip = vars[`--cmp-activity-${k}-chip`];
    ok(`6d. ${k} activity icon clears 3:1 on its chip`, !!icon && !!chip && contrast(icon, chip) >= 3, icon && chip ? contrast(icon, chip).toFixed(2) : "missing");
  }
  ok("6e. plant: amber #D97706 as normal text fails 4.5:1 (so it must never be a text colour)", contrast(rv.accent, A.surface) < AA);
  const appSrc = [...walk("src/app/individual"), ...walk("src/app/dashboard")].map(f => code(read(f))).join("\n");
  const AMBER_TEXT = /text-\[var\(--cmp-role-revision-accent\)\]|color:\s*["'`]?var\(--cmp-role-revision-accent\)/;
  ok("6f. the amber accent is never used as a text colour", !AMBER_TEXT.test(appSrc));
  ok("6g. plant: an amber text colour is caught", AMBER_TEXT.test(`<p className="text-[var(--cmp-role-revision-accent)]" />`));
  const canvases = ["src/app/dashboard/layout.tsx", "src/app/individual/(app)/[experience]/layout.tsx", "src/app/individual/(app)/home/page.tsx",
    "src/app/individual/(app)/welcome/page.tsx", "src/app/individual/(app)/learning/_components/LearningShell.tsx"];
  const offCanvas = canvases.filter(f => !/min-h-screen bg-\[var\(--cmp-app-bg\)\]/.test(read(f)) || /min-h-screen bg-gray-50/.test(read(f)));
  ok("6h. one canvas: every product shell paints --cmp-app-bg", offCanvas.length === 0, offCanvas.join(", "));
  const dash = code(read("src/app/dashboard/layout.tsx")), xp = code(read("src/app/individual/(app)/[experience]/layout.tsx"));
  ok("6i. white header and sidebars on Platform and Individual", /<aside data-sidebar[^>]*bg-\[var\(--cmp-app-surface\)\]/.test(dash)
    && /<header[^>]*bg-\[var\(--cmp-app-surface\)\]/.test(xp) && /<aside[^>]*bg-\[var\(--cmp-app-surface\)\]/.test(xp)
    && /h-14 bg-\[var\(--cmp-app-surface\)\]/.test(code(read("src/app/dashboard/MobileSidebar.tsx"))));
  const scholarScreens = [...walk("src/app/individual/(app)/[experience]/(scholar)"), ...walk("src/app/individual/_components")]
    .filter(f => !f.endsWith("DocumentPreview.tsx"));
  const RAW_HEX = /#[0-9a-fA-F]{6}\b/;
  const hexed = scholarScreens.filter(f => RAW_HEX.test(code(read(f)).replace(/accent="#111827"/g, "")));
  ok("6j. no hard-coded hex colour in Scholar screens or the shared Individual chrome", hexed.length === 0, hexed.join(", "));
  ok("6k. plant: a hard-coded hex is caught", RAW_HEX.test(code(`<p className="bg-[#e9f7f8]" />`)));
  const nav = code(read("src/app/individual/(app)/[experience]/(scholar)/study/_components/StudyNav.tsx"));
  ok("6l. activity chips are aria-hidden, read the activity tokens, and the tab keeps its text label",
    /aria-hidden className="inline-flex[^"]*"/.test(nav) && nav.includes("var(--cmp-activity-${space}-chip)") && nav.includes("{s.tab}"));
  const scholarCss = css.slice(css.indexOf(".cmp-scholar {"), css.indexOf("}", css.indexOf(".cmp-scholar {")));
  ok("6m. the Scholar shell's canvas, line and text greys read the shared app tokens",
    ["--color-gray-50: var(--cmp-app-bg)", "--color-gray-200: var(--cmp-app-border)", "--color-gray-600: var(--cmp-app-text-secondary)", "--color-gray-900: var(--cmp-app-text)"].every(x => scholarCss.includes(x)));
  ok("6n. Professional keeps its indigo, distinct from Scholar teal", productTheme.professional.accent === "#4338CA" && sc.accent !== productTheme.professional.accent);

  console.log(`\n${fail ? "FAILED" : "PASSED"}  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main();
