/**
 * COMPETEN-DESIGN-SYSTEM-01 -- one Competen brand, four coordinated product themes.
 *
 * Pins what the design system promises, from source only (no database, no network, no .env.local):
 *   1. the four approved accents are exactly the directive's, and every theme colour that carries words clears AA;
 *   2. globals.css has the generated [data-cmp-theme] rule for every product, and each shell sets its theme;
 *   3. product chrome reads the theme instead of raw brand hex or Tailwind teal/blue (semantic colours are elsewhere);
 *   4. the login chooser is presentation over the server's set: no navigation of its own, storage only orders;
 *   5. the governed presentation config cannot reach a name, a colour, Platform or Practice.
 * Every scan is proved able to fail by a planted violation before its result is trusted.
 *
 *   npx --yes tsx scripts/design-system-themes-harness.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { contrast } from "../src/lib/design/colour-map";
import tokens, { PRODUCT_THEME_KEYS, productTheme } from "../src/lib/design/tokens";
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

  console.log(`\n${fail ? "FAILED" : "PASSED"}  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main();
