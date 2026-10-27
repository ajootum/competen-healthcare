/**
 * COMPETEN-DESIGN-SYSTEM-01 -- one Competen brand, four coordinated product themes.
 *
 * Pins what the design system promises, from source only (no database, no network, no .env.local):
 *   1. the four approved accents are exactly the directive's, and every theme colour that carries words clears AA;
 *   2. globals.css has the generated [data-cmp-theme] rule for every product, and each shell sets its theme;
 *   3. product chrome reads the theme instead of raw brand hex or Tailwind teal/blue (semantic colours are elsewhere);
 *   4. the login chooser is presentation over the server's set: no navigation of its own, storage only orders;
 *   5. the governed presentation config cannot reach a name, a colour, Platform or Practice;
 *   6. SCHOLAR-HFE-COLOR-01: the Calm Teal variant is reviewable (off by default, a stored choice ignored under
 *      "current"), meets AA where it carries words or identifies a control, keeps warm off normal text, stays scoped.
 * Every scan is proved able to fail by a planted violation before its result is trusted.
 *
 *   npx --yes tsx scripts/design-system-themes-harness.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { contrast } from "../src/lib/design/colour-map";
import tokens, { PRODUCT_THEME_KEYS, productTheme, scholarVariant } from "../src/lib/design/tokens";
import { resolveScholarTheme } from "../src/lib/design/scholar-theme";
import { DEFAULT_POLICY } from "../src/lib/individual/policy";
import { SCHOLAR, PROFESSIONAL } from "../src/lib/individual/experiences";
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
  const want = { platform: "#064E3B", individual: "#4338CA", scholar: "#087F9C", professional: "#4338CA" } as const;
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

  console.log("\n6. Scholar Calm Teal variant (SCHOLAR-HFE-COLOR-01)");
  const cv = scholarVariant.calm, ct = cv.theme, cs = cv.surface;
  ok("6a. the candidate palette is the owner's", ct.accent === "#0B7089" && ct.strong === "#07566B" && ct.soft === "#E8F6F9" && cs.page === "#F8FAF9"
    && cs.card === "#FFFFFF" && cs.border === "#D9E3E8" && cs.text === "#142638" && cs.textSecondary === "#475569" && cs.warm === "#D97706"
    && cs.warmSoft === "#FFF4DC" && cs.success === "#15803D" && cs.error === "#B91C1C");
  const textPairs: [string, string, string][] = [["body text", cs.text, cs.card], ["body text on page", cs.text, cs.page],
    ["secondary text", cs.textSecondary, cs.card], ["secondary text on page", cs.textSecondary, cs.page],
    ["button label", ct.onAccent, ct.accent], ["button label, hover", ct.onAccent, ct.strong],
    ["link on card", ct.accent, cs.card], ["link on page", ct.accent, cs.page], ["selected tab on soft teal", ct.accent, ct.soft],
    ["ink on soft teal", ct.ink, ct.soft], ["warm ink on warm tint", cs.warmInk, cs.warmSoft], ["warm button label", "#FFFFFF", cs.warmStrong],
    ["success text", cs.success, cs.card], ["error text", cs.error, cs.card]];
  for (const [n, fg, bg] of textPairs) ok(`6b. ${n} clears 4.5:1`, contrast(fg, bg) >= AA, contrast(fg, bg).toFixed(2));
  ok("6c. a field edge (controlBorder) clears 3:1 on card and page", contrast(cs.controlBorder, cs.card) >= 3 && contrast(cs.controlBorder, cs.page) >= 3);
  for (const [k, a] of Object.entries(cv.activity)) ok(`6d. ${k} activity icon clears 3:1 on its chip`, contrast(a.icon, a.chip) >= 3, contrast(a.icon, a.chip).toFixed(2));
  ok("6e. plant: warm #D97706 as normal text fails 4.5:1 (so it must never be a text colour)", contrast(cs.warm, cs.card) < AA);
  const individualSrc = walk("src/app/individual").map(f => code(read(f))).join("\n");
  const WARM_TEXT = /text-\[var\(--cmp-scholar-calm-warm\)\]|color:\s*["'`]?var\(--cmp-scholar-calm-warm\)/;
  ok("6f. the warm accent is never used as a text colour", !WARM_TEXT.test(individualSrc));
  ok("6g. plant: a warm text colour is caught", WARM_TEXT.test(`<p className="text-[var(--cmp-scholar-calm-warm)]" />`));
  const parts = Object.keys(ct).map(k => k.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`));
  ok("6h. the variant rule re-points every Scholar palette part", css.includes(`[data-cmp-scholar="calm"] {`)
    && parts.every(p => css.includes(`--cmp-product-scholar-${p}: var(--cmp-variant-scholar-calm-${p});`)));
  ok("6i. the approved Scholar palette is unchanged", productTheme.scholar.accent === "#087F9C" && vars["--cmp-product-scholar-accent"] === "#087F9C");
  ok("6j. the policy defaults to the current theme", DEFAULT_POLICY.scholarTheme === "current");
  ok("6k. under 'current' a stored Calm Teal choice is ignored", resolveScholarTheme("current", "calm") === "current");
  ok("6l. preview is opt-in, calm is opt-out", resolveScholarTheme("preview", null) === "current" && resolveScholarTheme("preview", "calm") === "calm"
    && resolveScholarTheme("calm", null) === "calm" && resolveScholarTheme("calm", "current") === "current");
  ok("6m. Scholar accents read the variable; Professional keeps its own indigo", SCHOLAR.accent === "var(--cmp-product-scholar-accent)" && PROFESSIONAL.accent === "#4338CA");
  const nav = code(read("src/app/individual/(app)/[experience]/(scholar)/study/_components/StudyNav.tsx"));
  ok("6n. activity chips: hidden outside the variant, hidden from assistive tech, the tab still named in text",
    /aria-hidden className="hidden [^"]*in-\[\[data-cmp-scholar=calm\]\]:inline-flex/.test(nav) && nav.includes("{s.tab}"));
  ok("6o. the variant attribute is set by the Individual app layout from the resolver",
    /data-cmp-scholar=\{scholarTheme === "calm"/.test(read("src/app/individual/(app)/layout.tsx")));

  console.log(`\n${fail ? "FAILED" : "PASSED"}  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main();
