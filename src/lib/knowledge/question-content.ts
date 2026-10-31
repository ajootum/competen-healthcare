// The 442 shape of a revision question, read defensively for display (the same reading as Scholar's library-questions.ts
// libraryContent, but tolerant: a malformed legacy row is shown as far as it parses rather than hidden from HQ).
export function libraryContentOf(c: unknown): { stem: string; options: string[]; correctIndex: number | null; rationale: string } | null {
  const x = (c ?? {}) as Record<string, unknown>;
  if (typeof x.stem !== "string") return null;
  const options = Array.isArray(x.options) ? x.options.map(o => String(o)) : [];
  const ci = typeof x.correct_index === "number" && Number.isInteger(x.correct_index) && x.correct_index >= 0 && x.correct_index < options.length ? x.correct_index : null;
  return { stem: x.stem, options, correctIndex: ci, rationale: typeof x.rationale === "string" ? x.rationale : "" };
}
