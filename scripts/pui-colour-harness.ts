/**
 * Proves the colour migration is an accessibility improvement, not just a repaint.
 *
 * Touching thousands of colour sites is only defensible if the result is measurably better. So this
 * computes the REAL contrast of every source Tailwind class and its target token, and fails if any text
 * mapping would make text harder to read than it already is. It also fails if a token that carries words
 * does not clear the 4.5:1 floor PUI-005 sets.
 *
 *   npx --yes tsx scripts/pui-colour-harness.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TAILWIND, HUE_MEANING, SEMANTIC_TEXT, tokenFor, contrast } from "../src/lib/design/colour-map";
import tokens from "../src/lib/design/tokens";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const WHITE = "#FFFFFF";
const AA = 4.5;

// Resolve a --cmp-* variable to its hex through the token module, so the harness and the app cannot
// disagree about what a token is worth.
function resolve(varName: string): string | null {
  const vars = tokens.cssVariables();
  return vars[varName] ?? null;
}

function main() {
  console.log("\nPUI colour migration — contrast\n");

  const vars = tokens.cssVariables();
  console.log("Token scales");
  ok("the surface scale exists", Object.keys(vars).some(k => k.startsWith("--cmp-surface-")));
  ok("every text tone clears AA on white",
    Object.entries(tokens.color.semanticText).every(([, hex]) => contrast(hex as string, WHITE) >= AA),
    Object.entries(tokens.color.semanticText).filter(([, h]) => contrast(h as string, WHITE) < AA).map(([k, h]) => `${k} ${contrast(h as string, WHITE)}`).join(", "));
  // Surfaces are washes, so they must be LIGHT enough to carry the matching text tone on top.
  const surfaceProblems = Object.entries(tokens.color.surface)
    .filter(([k, hex]) => {
      const text = (tokens.color.semanticText as Record<string, string>)[k];
      return text && contrast(text, hex as string) < AA;
    })
    .map(([k, hex]) => `${k}: text on ${hex} = ${contrast((tokens.color.semanticText as Record<string, string>)[k], hex as string)}`);
  ok("each text tone clears AA on its own surface", surfaceProblems.length === 0, surfaceProblems.join(" | "));

  console.log("\nEvery text mapping improves or holds contrast");
  const regressions: string[] = [];
  const improvements: string[] = [];
  for (const [key, hex] of Object.entries(TAILWIND)) {
    const [hue, shadeStr] = key.split("-");
    const shade = Number(shadeStr);
    if (!HUE_MEANING[hue]) continue;
    const target = tokenFor("text", hue, shade);
    if (!target) continue;
    const to = resolve(target);
    if (!to) { regressions.push(`${key} -> ${target} (token missing)`); continue; }
    const before = contrast(hex, WHITE), after = contrast(to, WHITE);
    if (after < before - 0.01) regressions.push(`text-${key}: ${before} -> ${after}`);
    else if (after > before + 0.01) improvements.push(`text-${key}: ${before} -> ${after}`);
  }
  ok("no text mapping reduces contrast", regressions.length === 0, regressions.slice(0, 6).join(" | "));
  console.log(`  note  ${improvements.length} text mapping(s) IMPROVE contrast`);
  for (const i of improvements.slice(0, 8)) console.log(`          ${i}`);

  console.log("\nThe migration only lifts text that currently fails");
  const failingBefore = Object.entries(TAILWIND).filter(([key, hex]) => {
    const [hue, s] = key.split("-");
    return HUE_MEANING[hue] && tokenFor("text", hue, Number(s)) && contrast(hex, WHITE) < AA;
  });
  const stillFailing = failingBefore.filter(([key]) => {
    const [hue, s] = key.split("-");
    const to = resolve(tokenFor("text", hue, Number(s))!);
    return !to || contrast(to, WHITE) < AA;
  });
  console.log(`  note  ${failingBefore.length} mapped text class(es) fail AA today: ${failingBefore.map(([k]) => k).join(", ")}`);
  ok("none of them still fails after migration", stillFailing.length === 0, stillFailing.map(([k]) => k).join(", "));

  console.log("\nThe rule is measured, not guessed");
  ok("the restated text tones equal the token module",
    Object.entries(SEMANTIC_TEXT).every(([k, v]) => (tokens.color.semanticText as Record<string, string>)[k] === v));
  // The three that read BETTER today than the token would. Naming them explicitly keeps this honest: the
  // migration leaves them alone on purpose, and if the tokens ever darken these should start converting.
  ok("a class already darker than its token is NOT migrated",
    tokenFor("text", "emerald", 700) === null && tokenFor("text", "blue", 700) === null && tokenFor("text", "orange", 700) === null,
    "emerald-700 / blue-700 / orange-700 read better today than the token");
  ok("a class the token improves IS migrated",
    tokenFor("text", "amber", 600) === "--cmp-text-warning" && tokenFor("text", "emerald", 600) === "--cmp-text-success");

  console.log("\nRole separation is preserved");
  ok("a text class never maps to a fill token",
    Object.keys(TAILWIND).every(key => {
      const [hue, s] = key.split("-");
      const t = tokenFor("text", hue, Number(s));
      return !t || t.startsWith("--cmp-text-");
    }));
  ok("a light bg maps to a surface, never to a fill",
    ["amber-50", "emerald-50", "rose-50", "blue-50"].every(k => {
      const [hue, s] = k.split("-");
      return tokenFor("bg", hue, Number(s))?.startsWith("--cmp-surface-");
    }));
  ok("a strong bg maps to a fill, never to a surface",
    ["amber-500", "emerald-500", "rose-500"].every(k => {
      const [hue, s] = k.split("-");
      return tokenFor("bg", hue, Number(s))?.startsWith("--cmp-color-");
    }));
  ok("shades outside the declared bands are left alone",
    tokenFor("text", "amber", 400) === null && tokenFor("bg", "amber", 800) === null && tokenFor("border", "amber", 600) === null,
    "guessing at an out-of-band shade would be a silent restyle");
  ok("an unknown hue is never mapped", tokenFor("text", "purple", 600) === null);

  console.log("\nThe surface values are the ones the app already renders");
  const src = readFileSync(join(process.cwd(), "src/lib/design/tokens.ts"), "utf8");
  ok("each surface names the Tailwind tint it was taken from",
    ["emerald-50", "blue-50", "amber-50", "rose-50", "red-50", "slate-50"].every(t => src.includes(t)));
  ok("success surface equals emerald-50", tokens.color.surface.success === TAILWIND["emerald-50"]);
  ok("warning surface equals amber-50", tokens.color.surface.warning === TAILWIND["amber-50"]);
  ok("error surface equals rose-50", tokens.color.surface.error === TAILWIND["rose-50"]);

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"}  ${pass}/${pass + fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
