// ── RECOMMENDED NEXT STEPS ── COMPETEN-SCHOLAR-PROGRESS-01 (Progress, Stage 8 of 8) P4 ─────────────────────────
//
// Deterministic rules over recorded evidence. Each step names the finding it comes from and opens a Scholar
// activity with its context (the section, the material, the scope):
//
//   a learning gap                     -> Teach Me on that section, then Revision on its material
//   recall that did not hold           -> Spaced review
//   weaker clinical reasoning, safety  -> a clinical case on that section
//   too little evidence to say         -> a fresh evaluation of that scope
//   a material not yet classified      -> review its topics and competency links
//   strong, repeated performance       -> harder questions on that material
//
// ⚠ NOTHING IS INVENTED. No finding, no step. No AI. A step never claims competence.
// Pure.

import type { Evaluation } from "./evaluation";

export type NextKind = "teach" | "revise" | "spaced" | "case" | "evaluate" | "classify" | "advance" | "material";
export type NextStep = { kind: NextKind; label: string; reason: string; chunkId: string | null; materialId: string | null };
export type NextRule = "teach" | "spaced" | "case" | "evaluate" | "classify" | "advance";

/** Pure. The next steps for the student, in order of what the evidence most supports, at most `max`. */
export function nextSteps(e: Evaluation, extra: {
  /** Materials with sections but no competency link and no topics yet. */
  unclassified: { id: string; title: string }[];
  /** Materials where at least `min` independent questions were answered and nearly all were right, with repeats. */
  strongMaterials: { id: string; title: string; n: number }[];
  rules: readonly NextRule[]; max: number;
}): NextStep[] {
  const on = (r: NextRule) => extra.rules.includes(r);
  const out: NextStep[] = [];
  if (on("teach")) for (const g of e.gaps.slice(0, 2)) {
    out.push({ kind: "teach", label: `Teach me: ${g.label}`, reason: `A learning gap: ${g.correct} of ${g.n} right.`, chunkId: g.chunkId, materialId: g.materialId });
    out.push({ kind: "revise", label: `Revise: ${g.label}`, reason: "Then practise the same material.", chunkId: g.chunkId, materialId: g.materialId });
  }
  if (on("spaced") && e.retentionDifficulties.length) {
    const d = e.retentionDifficulties[0];
    out.push({ kind: "spaced", label: "Spaced review", reason: `Recall did not hold ${d.failed} time${d.failed === 1 ? "" : "s"} on ${d.label}.`, chunkId: d.chunkId, materialId: d.materialId });
  }
  if (on("case") && (e.reasoningWeaknesses.length || e.reasoning.safetyMissed > 0)) {
    out.push({ kind: "case", label: "Practise clinical reasoning", reason: e.reasoningWeaknesses.length ? `Weaker in ${e.reasoningWeaknesses.map(w => w.dimension).join(", ")}.` : `${e.reasoning.safetyMissed} safety point${e.reasoning.safetyMissed === 1 ? "" : "s"} missed.`,
      chunkId: e.gaps[0]?.chunkId ?? e.insufficientAreas[0]?.chunkId ?? null, materialId: null });
  }
  if (on("evaluate") && (e.confidence.level === "insufficient" || e.confidence.level === "limited"))
    out.push({ kind: "evaluate", label: "Take a fresh knowledge check", reason: e.confidence.level === "insufficient" ? "There is too little evidence to say how you are doing." : "The evidence so far is limited.", chunkId: null, materialId: null });
  if (on("classify")) for (const m of extra.unclassified.slice(0, 2))
    out.push({ kind: "classify", label: `Review the topics of ${m.title}`, reason: "Its sections are not linked to topics or competencies yet, so progress there is by section only.", chunkId: null, materialId: m.id });
  if (on("advance")) for (const m of extra.strongMaterials.slice(0, 1))
    out.push({ kind: "advance", label: `Try harder questions on ${m.title}`, reason: `${m.n} questions answered, nearly all right.`, chunkId: null, materialId: m.id });
  for (const a of e.insufficientAreas.slice(0, 1))
    out.push({ kind: "material", label: `Work on: ${a.label}`, reason: "Too little evidence here to say how you are doing.", chunkId: a.chunkId, materialId: a.materialId });
  // One step per (kind, place): the same section is not recommended twice for the same thing.
  const seen = new Set<string>();
  return out.filter(s => { const k = `${s.kind}:${s.chunkId ?? s.materialId ?? ""}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, extra.max);
}
