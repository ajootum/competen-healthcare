// SCHOLAR LEARNING DESIGN SYSTEM: the contrast pairs every learning tone must clear (WCAG 1.4.3 text 4.5:1, 1.4.11 non-text
// 3:1), light and staged dark. Asserted by scholar-learning-tokens.test.ts; printed as evidence by
// docs/evidence/LEARN-REDESIGN/contrast.ts. Pure: reads the tokens, writes nothing.
import { contrast } from "./colour-map";
import { LEARNING_TONES, learningCanvas, learningTone } from "./tokens";

/** The pairs a component draws with a tone: what, the ratio, and the minimum it must clear. */
export function learningPairs() {
  const out: { tone: string; scheme: "light" | "dark"; what: string; ratio: number; min: number }[] = [];
  for (const tone of LEARNING_TONES) for (const scheme of ["light", "dark"] as const) {
    const t = learningTone[tone][scheme], c = learningCanvas[scheme];
    const pairs: [string, string, string, number][] = [
      ["ink on surface (headings, labels)", t.ink, t.surface, 4.5],
      ["ink on card (labels on white rows)", t.ink, c.card, 4.5],
      ["body text on surface", c.text, t.surface, 4.5],
      ["secondary text on surface", c.textSecondary, t.surface, 4.5],
      ["surface on ink (filled button text)", t.surface, t.ink, 4.5],
      ["accent on surface (icons, selected edge)", t.accent, t.surface, 3],
      ["accent on card", t.accent, c.card, 3],
      ["accent on page", t.accent, c.page, 3],
    ];
    for (const [what, fg, bg, min] of pairs) out.push({ tone, scheme, what, ratio: contrast(fg, bg), min });
  }
  return out;
}
