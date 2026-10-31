import { libraryCopyOf, libraryFormatOf, libraryKeyText, markingOf, LIBRARY_FORMAT_LABEL, MARKING_LABEL, type LibraryFormat } from "@/lib/individual/scholar/library-format";

// The 442 shape of a revision question, read defensively for display (the same reading as Scholar's library-questions.ts
// libraryContent, but tolerant: a malformed legacy row is shown as far as it parses rather than hidden from HQ).
// SQIE-LIBRARY-EXPANSION-01 (800): any format, with its key in words, its rubric and its marking rule (library-format.ts).
export type LibraryDisplay = {
  stem: string; options: string[]; correctIndex: number | null; rationale: string;
  format: LibraryFormat; formatLabel: string; keyText: string; marking: string; rubric: { level?: string; objective?: string; keyPoints: string[]; misconceptions: string[] } | null;
};
export function libraryContentOf(c: unknown): LibraryDisplay | null {
  const x = (c ?? {}) as Record<string, unknown>;
  if (typeof x.stem !== "string") return null;
  const options = Array.isArray(x.options) ? x.options.map(o => String(o)) : [];
  const ci = typeof x.correct_index === "number" && Number.isInteger(x.correct_index) && x.correct_index >= 0 && x.correct_index < options.length ? x.correct_index : null;
  const format = libraryFormatOf(x) ?? "mcq";
  const copy = libraryCopyOf(x);
  const r = (x.rubric ?? null) as Record<string, unknown> | null;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const rule = markingOf(copy?.answer) ?? (format === "mcq" ? "deterministic" : null);
  return {
    stem: x.stem, options, correctIndex: ci, rationale: typeof x.rationale === "string" ? x.rationale : "",
    format, formatLabel: LIBRARY_FORMAT_LABEL[format], keyText: libraryKeyText(x), marking: rule ? MARKING_LABEL[rule] : "Not recorded",
    rubric: r && typeof r === "object" ? { ...(typeof r.level === "string" ? { level: r.level } : {}), ...(typeof r.objective === "string" ? { objective: r.objective } : {}), keyPoints: list(r.keyPoints), misconceptions: list(r.misconceptions) } : null,
  };
}
