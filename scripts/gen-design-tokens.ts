// Regenerates the design-token CSS block in src/app/globals.css FROM src/lib/design/tokens.ts.
//
// The CSS custom properties are never hand-edited: run this after changing a token and the stylesheet
// follows. scripts/pui-tokens-harness.ts fails the build if the block is stale, so drift between the
// TypeScript source of truth and the CSS consumers cannot survive a verification run.
//
//   npx --yes tsx scripts/gen-design-tokens.ts


import fs from "node:fs";
import path from "node:path";

const START = "/* @generated:design-tokens-start — regenerate with scripts/gen-design-tokens.ts */";
const END = "/* @generated:design-tokens-end */";

export function renderBlock(vars: Record<string, string>, fontFamily: string): string {
  const lines = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`);
  // COMPETEN-DESIGN-SYSTEM-01: one `[data-cmp-theme="<product>"]` rule per product palette, derived from the same
  // variables (--cmp-product-<product>-<part>), so the theme selectors can never drift from the palette.
  const themes = new Map<string, string[]>();
  for (const k of Object.keys(vars)) {
    const m = /^--cmp-product-([a-z]+)-([a-z-]+)$/.exec(k);
    if (m) themes.set(m[1], [...(themes.get(m[1]) ?? []), m[2]]);
  }
  const themeRules = [...themes].map(([p, parts]) =>
    [`[data-cmp-theme="${p}"] {`, ...parts.map(part => `  --cmp-theme-${part}: var(--cmp-product-${p}-${part});`), "}"].join("\n"));
  // SCHOLAR LEARNING DESIGN SYSTEM: one `.cmp-learn-<tone>` rule per learning tone (the --learn-* roles a component reads),
  // and ONE [data-cmp-scheme="dark"] rule re-pointing each light tone variable at its staged dark twin. Both derived from
  // the variables (--cmp-learn-<tone>-<role> / --cmp-learn-dark-<tone>-<role>), so neither can drift from the palette.
  const learn = new Map<string, string[]>();
  const learnDark: string[] = [];
  for (const k of Object.keys(vars)) {
    const d = /^--cmp-learn-dark-([a-z-]+)-(surface|border|accent|ink)$/.exec(k);
    if (d) { learnDark.push(`  --cmp-learn-${d[1]}-${d[2]}: var(${k});`); continue; }
    const m = /^--cmp-learn-([a-z-]+)-(surface|border|accent|ink)$/.exec(k);
    if (m) learn.set(m[1], [...(learn.get(m[1]) ?? []), m[2]]);
  }
  const learnRules = [...learn].map(([t, roles]) =>
    `.cmp-learn-${t} { ${roles.map(r => `--learn-${r}: var(--cmp-learn-${t}-${r});`).join(" ")} }`);
  // SEARCH-STANDARD-01: the shared search box uses .cmp-learn-key. Under Professional it takes the product's own colours; Scholar is untouched.
  const learnThemeRules = [
    `/* SEARCH-STANDARD-01: the shared search box uses .cmp-learn-key. Under Professional it takes the product's own colours; Scholar is untouched. */`,
    `[data-cmp-theme="professional"] .cmp-learn-key { --learn-surface: var(--cmp-theme-soft); --learn-border: var(--cmp-theme-border); --learn-accent: var(--cmp-theme-accent); --learn-ink: var(--cmp-theme-strong); }`,
  ];
  const learnDarkRule = learnDark.length ? [`[data-cmp-scheme="dark"] {`, ...learnDark, "}"] : [];
  return [
    START,
    "/* Platform Design System (PUI-001). Do not edit by hand — edit src/lib/design/tokens.ts. */",
    ":root {",
    ...lines,
    `  --cmp-font-sans: ${fontFamily};`,
    "}",
    ...themeRules,
    ...learnRules,
    ...learnThemeRules,
    ...learnDarkRule,
    END,
  ].join("\n");
}

async function main() {
  const { cssVariables, font } = await import("../src/lib/design/tokens");
  const cssPath = path.join(process.cwd(), "src", "app", "globals.css");
  const css = fs.readFileSync(cssPath, "utf8");
  const block = renderBlock(cssVariables(), font.family);

  let next: string;
  if (css.includes(START) && css.includes(END)) {
    const before = css.slice(0, css.indexOf(START));
    const after = css.slice(css.indexOf(END) + END.length);
    next = `${before}${block}${after}`;
  } else {
    // First run — insert after the tailwind import so tokens are available to everything below.
    const anchor = '@import "tailwindcss";';
    const at = css.indexOf(anchor) + anchor.length;
    next = `${css.slice(0, at)}\n\n${block}\n${css.slice(at)}`;
  }

  if (next === css) { console.log("globals.css already up to date."); return; }
  fs.writeFileSync(cssPath, next);
  console.log(`globals.css updated — ${Object.keys(cssVariables()).length} custom properties written.`);
}

main().catch(e => { console.error(e); process.exit(1); });
