// ── CRITERION LABELS FROM THE COMPONENT REGISTRY ── FRAMEWORK-DESIGN-STUDIO-02, owner (31 Oct 2026) ────────────────
//
// A criterion is numbered by its section's prefix (DPP1, K1, ...). The prefix comes from the assessment component
// registry (competency_assessment_component, 660), never from hard-coded codes, so any profession's sections number
// themselves. The registry carries no prefix column, so it is derived from the label: the initials of its words
// ("Demonstrated Professional Practice" -> DPP), small joining words left out, one letter for a one-word label
// ("Knowledge" -> K). Prefixes are unique across the registry. Pure and client-safe.

/** The prefix of criteria with no section. Reserved, so no component takes it. */
export const UNCLASSIFIED_PREFIX = "C";
const SMALL = new Set(["a", "an", "and", "for", "in", "of", "on", "or", "the", "to", "with"]);

/** Pure: the initials of a label (letters and digits only), uppercase, at most four. "" when it has no words. */
export function initialsOf(label: string): string {
  const words = String(label ?? "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const main = words.filter(w => !SMALL.has(w.toLowerCase()));
  const use = main.length ? main : words;
  return use.map(w => w[0].toUpperCase()).join("").slice(0, 4);
}

/** Pure: a unique prefix per component code, in registry order (earlier rows keep the shorter prefix). */
export function criterionPrefixes(components: Record<string, string>): Record<string, string> {
  const taken = new Set([UNCLASSIFIED_PREFIX]), out: Record<string, string> = {};
  for (const [code, label] of Object.entries(components)) {
    const base = initialsOf(label) || initialsOf(code.replace(/_/g, " ")) || "X";
    const last = (String(label).split(/[^A-Za-z0-9]+/).filter(Boolean).pop() ?? code).toUpperCase();
    // On a clash, lengthen with the following letters of the last word, then number.
    let p = base;
    for (let i = 1; taken.has(p) && i < last.length; i++) p = base + last.slice(1, i + 1);
    for (let n = 2; taken.has(p); n++) p = `${base}${n}`;
    taken.add(p); out[code] = p;
  }
  return out;
}

/** Pure: a criterion's label, its section's prefix and its 1-based number in that section. */
export const criterionLabel = (prefixes: Record<string, string>, component: string | null | undefined, index: number) =>
  `${(component && prefixes[component]) || UNCLASSIFIED_PREFIX}${index + 1}`;
