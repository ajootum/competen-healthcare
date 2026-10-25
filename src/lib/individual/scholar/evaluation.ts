// ── INTELLIGENT LEARNING EVALUATION ── COMPETEN-SCHOLAR-EVALUATION-01 (Stage 6) E2-E4 ──────────────────────────
//
// Interprets the evidence a student already has -- Teach Me checks (414), revision answers (372, 416), spaced
// review (391), clinical reasoning decisions (435) and coverage -- across a scope, into SIX dimensions kept apart:
//
//   knowledge           accuracy on structured questions, marked by code
//   retention           recall over time: spaced reviews, and questions answered right again days later
//   application         applying knowledge to a situation: scenario and case-step questions, marked by code
//   clinical reasoning  decisions in clinical cases, marked by their key, by reasoning dimension, with safety points
//   coverage            which sections and learning outcomes the student has worked on -- NEVER knowledge
//   evidence confidence how far the evidence can be relied on: amount, breadth, recency, how it was marked
//
// ⚠ NEVER ONE NUMBER. No dimension is blended into another, and nothing here is a competency percentage.
// ⚠ A MEASURE THE DATA DOES NOT SUPPORT IS NOT SHOWN AS ONE: the Holdings measure states (measured, insufficient,
//   not_measured with its reason -- src/lib/competency/progress-model.ts). A blank is a defect, a zero a measurement.
// ⚠ WHAT COUNTS AS EVIDENCE OF UNDERSTANDING. Only answers marked by code (a question's key, a case decision's
//   key). AI-evaluated written answers are AI-evaluated performance, shown apart. Self-graded answers are the
//   student's own report, shown apart. Teach Me explanations are teaching, not evidence, and are not read at all.
//   An informal Teach Me check is shown as what it is, and never counted as knowledge.
// ⚠ INDEPENDENT, NOT REPEATED. One question (or one decision of one case) is one piece of evidence, judged on its
//   latest marked answer. Answering it again is repeated exposure, counted as such.
// ⚠ NOT COMPETENCE. Formative, educational self-evaluation. Verified clinical competence is independently governed
//   and is never set here: `verified` is always not_assessed.
//
// Pure: no I/O, no clock of its own (`now` is passed in), so every rule is tested by being run.

import { insufficient, notMeasured, type Insufficient, type NotMeasured } from "@/lib/competency/progress-model";

export type Marking = "deterministic" | "ai_evaluation" | "self_graded";
export type EvidenceKind = "teach_checks" | "revision" | "spaced_review" | "clinical_reasoning";
export type Band = "strong" | "developing" | "needs_work";
export type ConfidenceClass = "strong" | "moderate" | "limited" | "insufficient";

export type ESection = { chunkId: string; materialId: string; materialTitle: string; label: string };
export type EQuestion = { id: string; chunkId: string; materialId: string; kind: string; difficulty: number | null; competencyId: string | null; caseId: string | null };
export type EAttempt = { id: string; questionId: string; correct: boolean; marking: Marking; answeredAt: string; sessionId: string | null; evaluatorModel?: string | null };
export type EReview = { id: string; questionId: string; quality: number; intervalDays: number; reviewedAt: string };
export type ECheck = { id: string; chunkIds: string[]; verdict: "understood" | "partly" | "not_yet"; createdAt: string };
export type EDecision = {
  id: string; caseId: string; decisionPointId: string; dimension: string | null; written: boolean; marking: Marking;
  correct: boolean | null; safetyMissed: number; createdAt: string; chunkIds: string[]; competencyIds: string[]; context: string;
};
export type ELink = { chunkId: string; competencyId: string; outcome: string | null };
/** The catalogue's competency, with its CFCA place (domain -> practice unit -> competency -> outcome). */
export type ECompetency = {
  id: string; title: string; code: string | null; domain: string; practice: string | null; cpu: string | null;
  outcomes: string[]; expectedLevel: { score: number; label: string } | null;
};

export type EvidenceSet = {
  /** The sections the scope covers (the student's own). */
  sections: ESection[];
  questions: EQuestion[]; attempts: EAttempt[]; reviews: EReview[]; checks: ECheck[]; decisions: EDecision[];
  /** Section -> competency links that are not rejected (Stage 2), with the outcome each names. */
  links: ELink[];
  /** The programme's catalogue, or null with none assigned. */
  catalogue: ECompetency[] | null;
  /** The fresh knowledge check's session, when there is one: its answers were given under evaluation conditions. */
  freshSessionId?: string | null;
};

export type EvaluationRules = {
  /** Independent pieces of evidence a dimension needs before a figure is shown. */
  minEvidence: number;
  /** Evidence older than this many days is dated: it still counts, and confidence says so. */
  recencyDays: number;
  /** Distinct sections the evidence must span before confidence is more than limited. */
  minSources: number;
  /** Performance bands, percent. No pass mark: a band describes, it does not certify. */
  bands: { strong: number; developing: number };
  /** Which kinds of evidence this evaluation reads (policy). */
  evidence: readonly EvidenceKind[];
};

type Perf = { independent: number; correct: number; percent: number; band: Band; repeats: number };
export type Knowledge = ({ state: "measured" } & Perf & Apart) | ((Insufficient | NotMeasured) & Apart);
/** Kept apart from the figure, always shown: what was AI-evaluated, self-reported, or an informal check. */
type Apart = { aiEvaluated: { n: number; correct: number }; selfReported: { n: number; correct: number }; informalChecks: { understood: number; partly: number; notYet: number } };
export type Retention = { state: "measured"; recalls: number; successful: number; percent: number; band: Band; longestIntervalDays: number } | Insufficient | NotMeasured;
export type Application = ({ state: "measured" } & Perf) | Insufficient | NotMeasured;
export type Reasoning = ({ state: "measured" } & Perf & { byDimension: { dimension: string; n: number; correct: number }[]; safetyMissed: number; written: { aiEvaluated: number; selfReviewed: number } })
  | ((Insufficient | NotMeasured) & { safetyMissed: number; written: { aiEvaluated: number; selfReviewed: number } });
export type Coverage = { state: "measured"; sections: { total: number; worked: number }; outcomes: { total: number; worked: number } | null; materials: number } | NotMeasured;
export type Confidence = { level: ConfidenceClass; independent: number; sources: number; recentShare: number | null; deterministicShare: number | null; reasons: string[] };

/** One area judged: a learning outcome, a competency, or (with no catalogue) a section. */
export type Area = {
  kind: "outcome" | "competency" | "section"; key: string; label: string; context: string | null;
  n: number; correct: number; percent: number | null; band: Band | null;
  chunkId: string | null; materialId: string | null;
  /** CFCA: what the framework expects, what the evidence observed. Verified is never set here. */
  expected: string | null;
};
export type Recommendation = { kind: "teach" | "revise" | "spaced" | "case" | "material"; label: string; reason: string; chunkId: string | null; materialId: string | null };

export type Evaluation = {
  knowledge: Knowledge; retention: Retention; application: Application; reasoning: Reasoning; coverage: Coverage; confidence: Confidence;
  strengths: Area[]; gaps: Area[]; insufficientAreas: Area[];
  retentionDifficulties: { chunkId: string; materialId: string; label: string; failed: number }[];
  reasoningWeaknesses: { dimension: string; n: number; correct: number }[];
  recommendations: Recommendation[];
  limitations: string[];
  /** The CFCA view, where a catalogue is assigned: domain -> practice unit -> competency -> outcome. */
  cfca: { domain: string; units: { name: string; competencies: Area[]; outcomes: Area[] }[] }[] | null;
  verified: { state: "not_assessed"; reason: string };
  /** AI provenance: the models that evaluated written answers read here. The interpretation itself is never AI. */
  aiModels: string[];
  evidence: { attempts: string[]; reviews: string[]; checks: string[]; decisions: string[]; counts: Record<string, number> };
};

export const VERIFIED_NOT_ASSESSED = "Verified clinical competence is not assessed by Scholar. It is decided only by an independently governed assessment.";
const DAY = 86_400_000;
const pct = (n: number, d: number) => Math.round((n / d) * 100);
export const bandOf = (percent: number, b: EvaluationRules["bands"]): Band => (percent >= b.strong ? "strong" : percent >= b.developing ? "developing" : "needs_work");
/** Rules as a configuration may give them, made coherent: developing never at or above strong. */
export function coherentRules(r: EvaluationRules): EvaluationRules {
  const strong = Math.min(100, Math.max(1, r.bands.strong));
  return { ...r, bands: { strong, developing: Math.min(Math.max(0, r.bands.developing), strong - 1) } };
}

/** Latest marked answer per key, and how many answers beyond the first (repeated exposure). */
function latestBy<T extends { createdAt?: string; answeredAt?: string }>(rows: readonly T[], key: (r: T) => string) {
  const latest = new Map<string, T>(); const count = new Map<string, number>();
  const at = (r: T) => r.answeredAt ?? r.createdAt ?? "";
  for (const r of rows) {
    const k = key(r); count.set(k, (count.get(k) ?? 0) + 1);
    const l = latest.get(k); if (!l || at(r) > at(l)) latest.set(k, r);
  }
  const repeats = [...count.values()].reduce((s, c) => s + c - 1, 0);
  return { latest, repeats };
}
function perf(items: readonly { correct: boolean }[], repeats: number, r: EvaluationRules, what: string): ({ state: "measured" } & Perf) | Insufficient | NotMeasured {
  if (!items.length) return notMeasured(`No ${what} has been answered in this scope yet.`);
  if (items.length < r.minEvidence) return insufficient(items.length, r.minEvidence, `Only ${items.length} ${what} answered here: ${r.minEvidence} are needed before a figure means something.`);
  const correct = items.filter(i => i.correct).length, percent = pct(correct, items.length);
  return { state: "measured", independent: items.length, correct, percent, band: bandOf(percent, r.bands), repeats };
}

/** Pure. The evaluation of one scope's evidence under the rules. */
export function evaluate(e: EvidenceSet, rules0: EvaluationRules, now: string): Evaluation {
  const r = coherentRules(rules0);
  const reads = (k: EvidenceKind) => r.evidence.includes(k);
  const inScope = new Set(e.sections.map(s => s.chunkId));
  const sectionOf = new Map(e.sections.map(s => [s.chunkId, s]));
  const qById = new Map(e.questions.filter(q => inScope.has(q.chunkId)).map(q => [q.id, q]));
  const isApplication = (q: EQuestion) => q.kind === "case" || !!q.caseId;
  const attempts = reads("revision") ? e.attempts.filter(a => qById.has(a.questionId)) : [];
  const fresh = e.freshSessionId ?? null;

  // ── knowledge and application: the latest code-marked answer per question; AI and self kept apart ──
  const det = attempts.filter(a => a.marking === "deterministic");
  const { latest: detLatest, repeats: detRepeats } = latestBy(det, a => a.questionId);
  const detItems = [...detLatest.values()].map(a => ({ a, q: qById.get(a.questionId)! }));
  const kItems = detItems.filter(x => !isApplication(x.q)), aItems = detItems.filter(x => isApplication(x.q));
  const kRepeats = det.filter(a => !isApplication(qById.get(a.questionId)!)).length - kItems.length;
  const latestOf = (m: Marking) => [...latestBy(attempts.filter(a => a.marking === m), a => a.questionId).latest.values()];
  const ai = latestOf("ai_evaluation"), self = latestOf("self_graded");
  const checks = reads("teach_checks") ? e.checks.filter(c => c.chunkIds.some(id => inScope.has(id))) : [];
  const apart: Apart = {
    aiEvaluated: { n: ai.length, correct: ai.filter(a => a.correct).length },
    selfReported: { n: self.length, correct: self.filter(a => a.correct).length },
    informalChecks: { understood: checks.filter(c => c.verdict === "understood").length, partly: checks.filter(c => c.verdict === "partly").length, notYet: checks.filter(c => c.verdict === "not_yet").length },
  };
  const knowledge = { ...perf(kItems.map(x => x.a), Math.max(0, kRepeats), r, "structured question"), ...apart } as Knowledge;
  const application = perf(aItems.map(x => x.a), Math.max(0, detRepeats - Math.max(0, kRepeats)), r, "scenario question") as Application;

  // ── retention: spaced reviews after an interval, and questions right again a day or more later ──
  const reviews = reads("spaced_review") ? e.reviews.filter(v => qById.has(v.questionId) && v.intervalDays >= 1) : [];
  const again: { ok: boolean; days: number }[] = [];
  for (const [qid] of detLatest) {
    const mine = det.filter(a => a.questionId === qid).sort((x, y) => x.answeredAt.localeCompare(y.answeredAt));
    for (let i = 1; i < mine.length; i++) {
      const days = Math.floor((Date.parse(mine[i].answeredAt) - Date.parse(mine[i - 1].answeredAt)) / DAY);
      if (days >= 1) again.push({ ok: mine[i].correct, days });
    }
  }
  const recalls = reviews.length + again.length, recalled = reviews.filter(v => v.quality >= 3).length + again.filter(x => x.ok).length;
  const retention: Retention = !recalls ? notMeasured(reads("spaced_review") || reads("revision") ? "Nothing has been recalled after a gap of a day or more in this scope yet." : "Spaced review and revision are not read by this evaluation.")
    : recalls < r.minEvidence ? insufficient(recalls, r.minEvidence, `Only ${recalls} recall${recalls === 1 ? "" : "s"} after a gap so far: ${r.minEvidence} are needed.`)
      : { state: "measured", recalls, successful: recalled, percent: pct(recalled, recalls), band: bandOf(pct(recalled, recalls), r.bands), longestIntervalDays: Math.max(0, ...reviews.map(v => v.intervalDays), ...again.map(x => x.days)) };

  // ── clinical reasoning: one decision of one case is one piece of evidence, judged on its latest key-marked answer ──
  const decisions = reads("clinical_reasoning") ? e.decisions.filter(d => d.chunkIds.some(id => inScope.has(id))) : [];
  const choice = decisions.filter(d => !d.written && d.marking === "deterministic" && d.correct !== null);
  const { latest: dLatest, repeats: dRepeats } = latestBy(choice, d => `${d.caseId}:${d.decisionPointId}`);
  const dItems = [...dLatest.values()];
  const written = { aiEvaluated: decisions.filter(d => d.written && d.marking === "ai_evaluation").length, selfReviewed: decisions.filter(d => d.written && d.marking !== "ai_evaluation").length };
  const safetyMissed = decisions.reduce((s, d) => s + d.safetyMissed, 0);
  const dims = new Map<string, { n: number; correct: number }>();
  for (const d of dItems) { const k = d.dimension ?? "unclassified"; const v = dims.get(k) ?? { n: 0, correct: 0 }; v.n++; if (d.correct) v.correct++; dims.set(k, v); }
  const byDimension = [...dims.entries()].map(([dimension, v]) => ({ dimension, ...v }));
  const rPerf = perf(dItems.map(d => ({ correct: !!d.correct })), dRepeats, r, "case decision");
  const reasoning = (rPerf.state === "measured" ? { ...rPerf, byDimension, safetyMissed, written } : { ...rPerf, safetyMissed, written }) as Reasoning;

  // ── coverage: worked on, never known ──
  const worked = new Set<string>([
    ...attempts.map(a => qById.get(a.questionId)!.chunkId), ...checks.flatMap(c => c.chunkIds), ...decisions.flatMap(d => d.chunkIds),
  ].filter(id => inScope.has(id)));
  const scopeLinks = e.links.filter(l => inScope.has(l.chunkId) && l.outcome);
  const outcomeKey = (l: ELink) => `${l.competencyId}::${l.outcome}`;
  const outcomeKeys = new Set(scopeLinks.map(outcomeKey));
  const coverage: Coverage = !e.sections.length ? notMeasured("This scope has no sections of your notes.") : {
    state: "measured", sections: { total: inScope.size, worked: worked.size },
    outcomes: outcomeKeys.size ? { total: outcomeKeys.size, worked: new Set(scopeLinks.filter(l => worked.has(l.chunkId)).map(outcomeKey)).size } : null,
    materials: new Set(e.sections.map(s => s.materialId)).size,
  };

  // ── areas: by learning outcome and competency where linked, by section otherwise ──
  const itemMin = Math.max(2, Math.floor(r.minEvidence / 2));
  const units: { chunkId: string; correct: boolean; competencyIds: string[]; context: string | null }[] = [
    ...detItems.map(x => ({ chunkId: x.q.chunkId, correct: x.a.correct, competencyIds: x.q.competencyId ? [x.q.competencyId] : [], context: null })),
    ...dItems.map(d => ({ chunkId: d.chunkIds.find(id => inScope.has(id)) ?? d.chunkIds[0], correct: !!d.correct, competencyIds: d.competencyIds, context: d.context })),
  ];
  const catalogue = new Map((e.catalogue ?? []).map(c => [c.id, c]));
  const compLabel = (id: string) => { const c = catalogue.get(id); return c ? `${c.code ? `${c.code} ` : ""}${c.title}` : "A linked competency"; };
  const tally = new Map<string, Area>();
  const add = (a: Omit<Area, "n" | "correct" | "percent" | "band">, ok: boolean) => {
    const t = tally.get(`${a.kind}:${a.key}`) ?? { ...a, n: 0, correct: 0, percent: null, band: null }; t.n++; if (ok) t.correct++; tally.set(`${a.kind}:${a.key}`, t);
  };
  for (const u of units) {
    const s = sectionOf.get(u.chunkId);
    const links = e.links.filter(l => l.chunkId === u.chunkId && (u.competencyIds.length === 0 || u.competencyIds.includes(l.competencyId)));
    for (const l of links) {
      const c = catalogue.get(l.competencyId);
      add({ kind: "competency", key: l.competencyId, label: compLabel(l.competencyId), context: null, chunkId: u.chunkId, materialId: s?.materialId ?? null, expected: c?.expectedLevel?.label ?? null }, u.correct);
      if (l.outcome) add({ kind: "outcome", key: outcomeKey(l), label: l.outcome, context: compLabel(l.competencyId), chunkId: u.chunkId, materialId: s?.materialId ?? null, expected: c?.expectedLevel?.label ?? null }, u.correct);
    }
    if (s) add({ kind: "section", key: u.chunkId, label: `${s.materialTitle}, ${s.label}`, context: null, chunkId: u.chunkId, materialId: s.materialId, expected: null }, u.correct);
  }
  const areas = [...tally.values()].map(a => (a.n >= itemMin ? { ...a, percent: pct(a.correct, a.n), band: bandOf(pct(a.correct, a.n), r.bands) } : a));
  // The most specific level the evidence supports: outcomes where linked, else competencies, else sections.
  const level: Area["kind"] = areas.some(a => a.kind === "outcome") ? "outcome" : areas.some(a => a.kind === "competency") ? "competency" : "section";
  const atLevel = areas.filter(a => a.kind === level);
  const strengths = atLevel.filter(a => a.band === "strong").sort((x, y) => y.percent! - x.percent!);
  const gaps = atLevel.filter(a => a.band === "needs_work").sort((x, y) => x.percent! - y.percent!);
  const insufficientAreas = atLevel.filter(a => a.band === null);

  // ── retention difficulties and reasoning weaknesses, from the record ──
  const failedBy = new Map<string, number>();
  for (const v of reviews) if (v.quality < 3) { const q = qById.get(v.questionId)!; failedBy.set(q.chunkId, (failedBy.get(q.chunkId) ?? 0) + 1); }
  const retentionDifficulties = [...failedBy.entries()].map(([chunkId, failed]) => {
    const s = sectionOf.get(chunkId); return { chunkId, materialId: s?.materialId ?? "", label: s ? `${s.materialTitle}, ${s.label}` : "A section", failed };
  }).sort((x, y) => y.failed - x.failed);
  const reasoningWeaknesses = byDimension.filter(d => d.n >= itemMin && pct(d.correct, d.n) < r.bands.developing);

  // ── evidence confidence: amount, breadth, recency, how it was marked ──
  const marked = [...detItems.map(x => x.a.answeredAt), ...dItems.map(d => d.createdAt), ...reviews.map(v => v.reviewedAt)];
  const independent = kItems.length + aItems.length + dItems.length + recalls;
  const sources = new Set([...detItems.map(x => x.q.chunkId), ...dItems.flatMap(d => d.chunkIds.filter(id => inScope.has(id)))]).size;
  const cutoff = Date.parse(now) - r.recencyDays * DAY;
  const recentShare = marked.length ? marked.filter(t => Date.parse(t) >= cutoff).length / marked.length : null;
  const allMarked = kItems.length + aItems.length + dItems.length + ai.length + self.length;
  const deterministicShare = allMarked ? (kItems.length + aItems.length + dItems.length) / allMarked : null;
  const reasons: string[] = [];
  if (independent < r.minEvidence) reasons.push(`${independent} independent piece${independent === 1 ? "" : "s"} of evidence, fewer than the ${r.minEvidence} needed.`);
  else reasons.push(`${independent} independent pieces of evidence.`);
  reasons.push(sources >= r.minSources ? `It spans ${sources} section${sources === 1 ? "" : "s"} of your notes.` : `It comes from ${sources} section${sources === 1 ? "" : "s"}: ${r.minSources} are needed for breadth.`);
  if (recentShare !== null) reasons.push(recentShare >= 0.5 ? `Most of it is from the last ${r.recencyDays} days.` : `Most of it is older than ${r.recencyDays} days, so it may not reflect what you know now.`);
  if (deterministicShare !== null && deterministicShare < 1) reasons.push("Some answers were judged by AI or by you: they are shown apart and not counted as independent evidence.");
  const level0: ConfidenceClass = independent < r.minEvidence ? "insufficient"
    : independent >= 3 * r.minEvidence && sources >= 2 * r.minSources && (recentShare ?? 0) >= 0.5 && (deterministicShare ?? 0) >= 0.7 ? "strong"
      : independent >= 2 * r.minEvidence && sources >= r.minSources ? "moderate" : "limited";
  const confidence: Confidence = { level: level0, independent, sources, recentShare, deterministicShare, reasons };

  // ── recommendations: deterministic, each from a finding, each linking to a Scholar experience ──
  const recommendations: Recommendation[] = [];
  for (const g of gaps.slice(0, 3)) {
    recommendations.push({ kind: "teach", label: `Teach me: ${g.label}`, reason: `${g.correct} of ${g.n} right in this area.`, chunkId: g.chunkId, materialId: g.materialId });
    recommendations.push({ kind: "revise", label: `Revise: ${g.label}`, reason: "More practice where answers went wrong.", chunkId: g.chunkId, materialId: g.materialId });
  }
  if (retentionDifficulties.length) recommendations.push({ kind: "spaced", label: "Spaced review", reason: `${retentionDifficulties.reduce((s, d) => s + d.failed, 0)} recall${retentionDifficulties.length === 1 ? "" : "s"} did not hold: your review cards bring them back.`, chunkId: retentionDifficulties[0].chunkId, materialId: retentionDifficulties[0].materialId });
  if (reasoningWeaknesses.length || safetyMissed > 0) {
    const at = dItems.find(d => !d.correct) ?? decisions[0];
    recommendations.push({ kind: "case", label: "Practise clinical reasoning", reason: reasoningWeaknesses.length ? `Weaker in ${reasoningWeaknesses.map(d => d.dimension).join(", ")}.` : `${safetyMissed} safety point${safetyMissed === 1 ? "" : "s"} missed in cases.`, chunkId: at?.chunkIds.find(id => inScope.has(id)) ?? null, materialId: null });
  }
  for (const a of insufficientAreas.slice(0, 2)) recommendations.push({ kind: "material", label: `Work on: ${a.label}`, reason: "Too little evidence here to say how you are doing.", chunkId: a.chunkId, materialId: a.materialId });
  if (coverage.state === "measured" && coverage.sections.worked < coverage.sections.total) {
    const untouched = e.sections.find(s => !worked.has(s.chunkId));
    if (untouched) recommendations.push({ kind: "teach", label: `Start on: ${untouched.materialTitle}, ${untouched.label}`, reason: `${coverage.sections.total - coverage.sections.worked} section${coverage.sections.total - coverage.sections.worked === 1 ? "" : "s"} in this scope not worked on yet.`, chunkId: untouched.chunkId, materialId: untouched.materialId });
  }

  // ── limitations: what this evaluation cannot say, said ──
  const limitations: string[] = ["Coverage shows what you have worked on, not what you know."];
  if (apart.selfReported.n) limitations.push(`${apart.selfReported.n} answer${apart.selfReported.n === 1 ? " was" : "s were"} graded by you: shown, not counted as independent evidence.`);
  if (apart.aiEvaluated.n || written.aiEvaluated) limitations.push("Answers evaluated by AI are shown apart from answers marked by their key.");
  if (written.selfReviewed) limitations.push(`${written.selfReviewed} written case answer${written.selfReviewed === 1 ? " was" : "s were"} reviewed by you, not evaluated: not counted.`);
  if (checks.length) limitations.push("Teach Me checks are informal: shown, not counted as knowledge.");
  if (!e.catalogue?.length) limitations.push("No competency catalogue is assigned: results are by section of your notes.");
  else if (!e.links.some(l => inScope.has(l.chunkId))) limitations.push("No section in this scope is linked to a competency yet: results are by section.");
  if (recentShare !== null && recentShare < 0.5) limitations.push(`Most evidence is older than ${r.recencyDays} days.`);
  if (fresh && !attempts.some(a => a.sessionId === fresh)) limitations.push("The fresh knowledge check has no marked answers yet.");
  limitations.push(VERIFIED_NOT_ASSESSED);

  // ── CFCA: domain -> practice unit -> competency -> outcome, where a catalogue places them ──
  let cfca: Evaluation["cfca"] = null;
  if (e.catalogue?.length && areas.some(a => a.kind === "competency")) {
    const byDomain = new Map<string, Map<string, { competencies: Area[]; outcomes: Area[] }>>();
    for (const a of areas.filter(x => x.kind === "competency")) {
      const c = catalogue.get(a.key); if (!c) continue;
      const unit = [c.practice, c.cpu].filter(Boolean).join(" › ") || "Not placed in a practice unit";
      const d = byDomain.get(c.domain) ?? new Map(); const u = d.get(unit) ?? { competencies: [], outcomes: [] };
      u.competencies.push(a); u.outcomes.push(...areas.filter(o => o.kind === "outcome" && o.key.startsWith(`${a.key}::`)));
      d.set(unit, u); byDomain.set(c.domain, d);
    }
    cfca = [...byDomain.entries()].map(([domain, d]) => ({ domain, units: [...d.entries()].map(([name, u]) => ({ name, ...u })) }));
  }

  return {
    knowledge, retention, application, reasoning, coverage, confidence, strengths, gaps, insufficientAreas, retentionDifficulties, reasoningWeaknesses,
    recommendations, limitations, cfca, verified: { state: "not_assessed", reason: VERIFIED_NOT_ASSESSED },
    aiModels: [...new Set(ai.map(a => a.evaluatorModel).filter((m): m is string => !!m))],
    evidence: {
      attempts: attempts.map(a => a.id), reviews: reviews.map(v => v.id), checks: checks.map(c => c.id), decisions: decisions.map(d => d.id),
      counts: { attempts: attempts.length, independentQuestions: kItems.length + aItems.length, reviews: reviews.length, checks: checks.length, decisions: decisions.length, independentDecisions: dItems.length, fresh: fresh ? attempts.filter(a => a.sessionId === fresh).length : 0 },
    },
  };
}
