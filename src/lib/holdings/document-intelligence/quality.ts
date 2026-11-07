import { blockWords, type CanonicalDocument, type QualityIssue, type QualityReport } from "./canonical";

// ── DID THE CONVERSION KEEP WHAT WAS THERE ── COMPETEN-DIG-001 s7, PHASE 1 ────────────────────────────────────────────────
//
// Pure. Technical success is not fidelity. Two uses:
//
//   compareWords, orderScore      how close one reader is to an independent reference (the benchmark uses PowerPoint's own object model)
//   reconcile                     what can be checked at run time with no second engine: the words and pictures the file's own parts
//                                 hold, against what the document kept. Cheap enough to run on every conversion.

/** Pure. Lower case, punctuation off both ends, split on space. A label such as "120/80" or "6-8" stays one word. */
export function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/\s+/).map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, "")).filter(Boolean);
}

export type WordScore = { reference: number; found: number; extra: number; recall: number | null; precision: number | null; missing: string[] };

/** Pure. Every word counted as often as it occurs. Recall null: the reference holds no words, so there is nothing to say. */
export function compareWords(reference: string, candidate: string, keepMissing = 12): WordScore {
  const ref = wordsOf(reference), cand = wordsOf(candidate);
  const left = new Map<string, number>();
  for (const w of cand) left.set(w, (left.get(w) ?? 0) + 1);
  const missing: string[] = [];
  let found = 0;
  for (const w of ref) {
    const n = left.get(w) ?? 0;
    if (n > 0) { left.set(w, n - 1); found++; } else if (missing.length < keepMissing) missing.push(w);
  }
  return { reference: ref.length, found, extra: cand.length - found, recall: ref.length ? found / ref.length : null, precision: cand.length ? found / cand.length : null, missing };
}

/** Pure. How much of the reference's word order the candidate keeps: the longest common subsequence, as a share of the reference. Null with no reference. */
export function orderScore(reference: string, candidate: string): number | null {
  const a = wordsOf(reference), b = wordsOf(candidate);
  if (!a.length) return null;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) row[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    prev = row;
  }
  return prev[b.length] / a.length;
}

/** What the file's own parts hold for one unit, read without any conversion engine. */
export type UnitFacts = { n: number; words: string; figures: number; tables: { rows: number; cols: number }[]; charts: number; diagrams: number };

/** Pure. A document against the file's own parts. A failed check names its unit, so recovery can target it. */
export function reconcile(doc: CanonicalDocument, facts: readonly UnitFacts[], minRecall: number): QualityReport {
  const issues: QualityIssue[] = [];
  const units = new Map(doc.units.map(u => [u.n, u]));
  const order = doc.units.map(u => u.n);
  if (order.some((n, i) => i > 0 && n <= order[i - 1])) issues.push({ unit: null, check: "unit_order", detail: "out of order" });
  if (doc.units.length !== doc.source.units) issues.push({ unit: null, check: "unit_order", detail: `${doc.units.length} of ${doc.source.units}` });
  let refWords = 0, foundWords = 0;
  for (const f of facts) {
    const u = units.get(f.n);
    if (!u) { issues.push({ unit: f.n, check: "text_completeness", detail: "missing" }); refWords += wordsOf(f.words).length; continue; }
    if (u.status === "failed") issues.push({ unit: f.n, check: "text_completeness", detail: "failed" });
    const score = compareWords(f.words, u.blocks.map(blockWords).join("\n"));
    refWords += score.reference;
    foundWords += score.found;
    if (u.status !== "failed" && score.recall !== null && score.recall < minRecall) issues.push({ unit: f.n, check: "text_completeness", detail: `recall ${score.recall.toFixed(3)}` });
    const figures = u.blocks.filter(b => b.type === "figure").length;
    if (figures < f.figures) issues.push({ unit: f.n, check: "visual_preservation", detail: `${figures} of ${f.figures} pictures` });
    const tables = u.blocks.filter(b => b.type === "table");
    if (tables.length < f.tables.length) issues.push({ unit: f.n, check: "table_structure", detail: `${tables.length} of ${f.tables.length} tables` });
    for (const [i, t] of tables.entries()) {
      const want = f.tables[i];
      if (want && (t.type !== "table" || t.rows.length !== want.rows || Math.max(0, ...t.rows.map(r => r.length)) !== want.cols)) issues.push({ unit: f.n, check: "table_structure", detail: `table ${i + 1} shape differs` });
    }
    if (u.blocks.filter(b => b.type === "chart").length < f.charts) issues.push({ unit: f.n, check: "labels", detail: "chart not read" });
    if (u.blocks.filter(b => b.type === "diagram").length < f.diagrams) issues.push({ unit: f.n, check: "labels", detail: "diagram not read" });
    for (const b of u.blocks) if (b.source.unit !== f.n) issues.push({ unit: f.n, check: "source_refs", detail: "reference names another unit" });
  }
  // An AI reading can only live in interpretations. Its text in a block would be source and interpretation mixed.
  const texts = new Set(doc.interpretations.map(i => i.text.trim()).filter(t => t.length > 20));
  for (const u of doc.units) for (const b of u.blocks) if (texts.has(blockWords(b).trim())) issues.push({ unit: u.n, check: "separation", detail: "AI text in a source block" });
  const textRecall = refWords ? foundWords / refWords : null;
  return { passed: issues.length === 0, textRecall, issues };
}

/** Pure. The units a recovery should target, once each, in order. */
export const unitsNeedingRecovery = (r: QualityReport): number[] => [...new Set(r.issues.map(i => i.unit).filter((n): n is number => n !== null))].sort((a, b) => a - b);
