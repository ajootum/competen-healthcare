import type { CompetencyRef, QuestionCompetency } from "./competency-sources";

// ── LEARNING INTELLIGENCE ── COMPETEN-SCHOLAR-01 S5 ─────────────────────────────────────────────────────
//
// Four measures, TRACKED SEPARATELY and never blended into one score:
//
//   coverage    which competencies of the person's framework their practice has touched (needs S1 + S2)
//   engagement  how regularly they study: days with practice or revision, questions answered, reviews done
//   knowledge   how their practice questions (MCQ) go: accuracy on the latest try, corrections, recall
//   reasoning   how their practice scenarios (case questions) go, kept apart from knowledge on purpose
//
// Then insights (what is true, in a sentence) and recommendations (what to do next, with the reason).
//
// ⚠ A MEASURE THE DATA DOES NOT SUPPORT IS NOT SHOWN AS ONE. Every measure is one of three states:
//   measured      the figures, from enough data to mean something
//   insufficient  some data, too little to say: how much there is and how much is needed
//   not_measured  nothing to measure, or a source that is not connected -- with the reason
// A blank reads as a defect and a zero reads as a measurement. Neither is ever used for "unknown".
//
// ⚠ SELF-DIRECTED STUDY, NOT COMPETENCE. Practice accuracy on AI-written questions from the person's own
// notes is study, not an assessment. "Coverage" means practised, never achieved. Nothing here is mastery,
// and nothing here is visible to an organisation.
//
// Pure: no I/O, no clock of its own (`today` is passed in), so every rule is tested by being run.

export type Kind = "mcq" | "case";
export type IMaterial = { id: string; title: string; createdAt?: string };
/** caseId (IND-004 388): a question that belongs to a clinical case counts as reasoning, whatever its kind. */
export type IQuestion = { id: string; materialId: string; kind: Kind; caseId?: string | null };
/** Reasoning is scenarios and case questions. Knowledge is everything else. Kept apart, never blended. */
export const isReasoning = (q: IQuestion) => q.kind === "case" || !!q.caseId;
export type IAttempt = { questionId: string; correct: boolean; answeredAt: string };
export type ICard = { materialId: string; status: "active" | "mastered"; nextReviewAt: string };
export type IReview = { materialId: string; quality: number; reviewedAt: string };

export type Thresholds = {
  /** Answered questions (or reviews) needed before an accuracy or recall figure is shown. */
  minAnswers: number;
  /** The engagement window, in days, ending today. */
  windowDays: number;
};

export type Insufficient = { state: "insufficient"; have: number; need: number; reason: string };
export type NotMeasured = { state: "not_measured"; reason: string };

export type Coverage =
  | { state: "measured"; framework: string; total: number; practised: number; practisedCorrect: number;
      /** Not yet practised, highest expected level first (S1 expectedLevel), then by name. */
      gaps: { id: string; name: string; expected: string | null }[];
      rows: { id: string; name: string; answered: number; latestCorrect: number; expected: string | null }[] }
  | NotMeasured;

export type Engagement =
  | { state: "measured"; windowDays: number; studyDays: number; answered: number;
      /** null while the review log is not installed (migration 391), or before its first review. */
      reviews: number | null; reviewsSince: string | null;
      lastStudied: string | null; daysSinceStudy: number | null; cardsDue: number; activeWeeks: number; weeks: number }
  | NotMeasured;

export type Knowledge =
  | { state: "measured"; answered: number; accuracy: number; firstTryAccuracy: number; corrected: number;
      perMaterial: { id: string; title: string; answered: number; accuracy: number | null }[];
      recall: { state: "measured"; reviews: number; meanQuality: number } | Insufficient | NotMeasured;
      longIntervalCards: number }
  | Insufficient | NotMeasured;

export type Reasoning =
  | { state: "measured"; answered: number; accuracy: number; firstTryAccuracy: number; corrected: number }
  | Insufficient | NotMeasured;

export type Recommendation = { id: string; priority: number; title: string; reason: string; href: string | null };

export type LearningIntelligence = {
  coverage: Coverage; engagement: Engagement; knowledge: Knowledge; reasoning: Reasoning;
  insights: string[]; recommendations: Recommendation[];
};

const DAY = 86_400_000;
const pct = (n: number, d: number) => Math.round((n / d) * 100);
const dayOf = (iso: string) => iso.slice(0, 10);
const daysBetween = (fromDay: string, toDay: string) => Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY);

/** Latest and first attempt per question. */
function attemptIndex(attempts: readonly IAttempt[]) {
  const latest = new Map<string, IAttempt>(), first = new Map<string, IAttempt>();
  for (const a of attempts) {
    const l = latest.get(a.questionId); if (!l || a.answeredAt > l.answeredAt) latest.set(a.questionId, a);
    const f = first.get(a.questionId); if (!f || a.answeredAt < f.answeredAt) first.set(a.questionId, a);
  }
  return { latest, first };
}

/** Accuracy figures over one kind of question. */
function performanceOf(qs: readonly IQuestion[], idx: ReturnType<typeof attemptIndex>) {
  const answered = qs.filter(q => idx.latest.has(q.id));
  const right = answered.filter(q => idx.latest.get(q.id)!.correct).length;
  const firstRight = answered.filter(q => idx.first.get(q.id)!.correct).length;
  const corrected = answered.filter(q => !idx.first.get(q.id)!.correct && idx.latest.get(q.id)!.correct).length;
  return { answered: answered.length, right, firstRight, corrected };
}

export function buildCoverage(
  questions: readonly IQuestion[], idx: ReturnType<typeof attemptIndex>,
  catalogue: readonly CompetencyRef[] | null, mappings: readonly QuestionCompetency[] | null, unreadable = false,
): Coverage {
  if (unreadable) return { state: "not_measured", reason: "Competency information could not be read just now." };
  if (catalogue === null) return { state: "not_measured", reason: "No competency framework is connected to your study yet." };
  if (mappings === null) return { state: "not_measured", reason: "Your practice questions are not yet linked to competencies." };
  if (catalogue.length === 0) return { state: "not_measured", reason: "Your competency framework lists no competencies." };
  const known = new Set(questions.map(q => q.id));
  const byComp = new Map<string, string[]>();
  for (const m of mappings) if (known.has(m.questionId)) byComp.set(m.competencyId, [...(byComp.get(m.competencyId) ?? []), m.questionId]);
  const rows = catalogue.map(c => {
    const qs = byComp.get(c.id) ?? [];
    const answered = qs.filter(q => idx.latest.has(q)).length;
    const latestCorrect = qs.filter(q => idx.latest.get(q)?.correct).length;
    return { id: c.id, name: c.name, answered, latestCorrect, expected: c.expectedLevel?.label ?? null, score: c.expectedLevel?.score ?? -1 };
  });
  const frameworks = [...new Set(catalogue.map(c => c.frameworkName))];
  return {
    state: "measured", framework: frameworks.join(", "), total: rows.length,
    practised: rows.filter(r => r.answered > 0).length, practisedCorrect: rows.filter(r => r.latestCorrect > 0).length,
    gaps: rows.filter(r => r.answered === 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).map(r => ({ id: r.id, name: r.name, expected: r.expected })),
    rows: rows.map(({ score: _s, ...r }) => r),
  };
}

export function buildEngagement(input: {
  materials: readonly IMaterial[]; attempts: readonly IAttempt[]; reviews: readonly IReview[] | null;
  cards: readonly ICard[]; today: string; windowDays: number; weeks?: number;
}): Engagement {
  const { materials, attempts, reviews, cards, today, windowDays } = input;
  if (materials.length === 0) return { state: "not_measured", reason: "You have not added any study material yet." };
  const weeks = input.weeks ?? 8;
  const from = dayOf(new Date(Date.parse(`${today}T00:00:00Z`) - (windowDays - 1) * DAY).toISOString());
  const inWindow = (iso: string) => dayOf(iso) >= from && dayOf(iso) <= today;
  const days = new Set<string>();
  let answered = 0;
  for (const a of attempts) if (inWindow(a.answeredAt)) { days.add(dayOf(a.answeredAt)); answered++; }
  let reviewCount: number | null = null;
  let reviewsSince: string | null = null;
  if (reviews) {
    reviewCount = 0;
    for (const r of reviews) {
      if (!reviewsSince || r.reviewedAt < reviewsSince) reviewsSince = r.reviewedAt;
      if (inWindow(r.reviewedAt)) { days.add(dayOf(r.reviewedAt)); reviewCount++; }
    }
    reviewsSince = reviewsSince ? dayOf(reviewsSince) : null;
  }
  const all = [...attempts.map(a => a.answeredAt), ...(reviews ?? []).map(r => r.reviewedAt)];
  const lastStudied = all.length ? dayOf(all.reduce((m, x) => (x > m ? x : m))) : null;
  // Weeks (of the last `weeks`, ending this week) with any practice or revision.
  const weekOf = (d: string) => Math.floor(daysBetween(d, today) / 7);
  const activeWeekSet = new Set(all.map(x => weekOf(dayOf(x))).filter(w => w >= 0 && w < weeks));
  return {
    state: "measured", windowDays, studyDays: days.size, answered,
    reviews: reviewCount, reviewsSince,
    lastStudied, daysSinceStudy: lastStudied ? daysBetween(lastStudied, today) : null,
    cardsDue: cards.filter(c => c.status === "active" && c.nextReviewAt <= today).length,
    activeWeeks: activeWeekSet.size, weeks,
  };
}

export function buildKnowledge(input: {
  materials: readonly IMaterial[]; questions: readonly IQuestion[]; idx: ReturnType<typeof attemptIndex>;
  cards: readonly ICard[]; reviews: readonly IReview[] | null; today: string; t: Thresholds;
}): Knowledge {
  const { materials, questions, idx, cards, reviews, today, t } = input;
  const mcq = questions.filter(q => !isReasoning(q));
  if (mcq.length === 0) return { state: "not_measured", reason: "No practice questions have been written from your notes yet." };
  const p = performanceOf(mcq, idx);
  if (p.answered === 0) return { state: "not_measured", reason: "You have not answered any practice questions yet." };
  if (p.answered < t.minAnswers)
    return { state: "insufficient", have: p.answered, need: t.minAnswers, reason: `Answer at least ${t.minAnswers} practice questions to see how they are going.` };
  const perMaterial = materials.map(m => {
    const mp = performanceOf(mcq.filter(q => q.materialId === m.id), idx);
    return { id: m.id, title: m.title, answered: mp.answered, accuracy: mp.answered >= t.minAnswers ? pct(mp.right, mp.answered) : null };
  }).filter(r => r.answered > 0);
  let recall: Extract<Knowledge, { state: "measured" }>["recall"];
  if (reviews === null) recall = { state: "not_measured", reason: "Recall is recorded from your revision reviews, and that record is not set up here yet." };
  else {
    const from = dayOf(new Date(Date.parse(`${today}T00:00:00Z`) - (t.windowDays - 1) * DAY).toISOString());
    const recent = reviews.filter(r => dayOf(r.reviewedAt) >= from);
    recall = recent.length === 0
      ? { state: "not_measured", reason: `No revision reviews in the last ${t.windowDays} days.` }
      : recent.length < t.minAnswers
        ? { state: "insufficient", have: recent.length, need: t.minAnswers, reason: `Review at least ${t.minAnswers} cards to see how your recall is going.` }
        : { state: "measured", reviews: recent.length, meanQuality: Math.round((recent.reduce((n, r) => n + r.quality, 0) / recent.length) * 10) / 10 };
  }
  return {
    state: "measured", answered: p.answered, accuracy: pct(p.right, p.answered), firstTryAccuracy: pct(p.firstRight, p.answered),
    corrected: p.corrected, perMaterial, recall, longIntervalCards: cards.filter(c => c.status === "mastered").length,
  };
}

export function buildReasoning(questions: readonly IQuestion[], idx: ReturnType<typeof attemptIndex>, t: Thresholds): Reasoning {
  const cases = questions.filter(isReasoning);
  if (cases.length === 0) return { state: "not_measured", reason: "No practice scenarios have been written from your notes yet." };
  const p = performanceOf(cases, idx);
  if (p.answered === 0) return { state: "not_measured", reason: "You have not worked through any practice scenarios yet." };
  if (p.answered < t.minAnswers)
    return { state: "insufficient", have: p.answered, need: t.minAnswers, reason: `Work through at least ${t.minAnswers} practice scenarios to see how your reasoning is going.` };
  return { state: "measured", answered: p.answered, accuracy: pct(p.right, p.answered), firstTryAccuracy: pct(p.firstRight, p.answered), corrected: p.corrected };
}

/** Routes the recommendations point at, under /individual/scholar/study. */
export const STUDY_HREF = {
  home: "/individual/scholar/study",
  revise: "/individual/scholar/study/revise",
  apply: "/individual/scholar/study/apply",
  material: (id: string) => `/individual/scholar/study/${id}`,
};

/** Accuracy below this, on a material with enough answers, earns a "revisit" recommendation. */
export const REVISIT_BELOW = 70;
/** Days without study before "pick up where you left off". */
export const IDLE_DAYS = 7;
/** Reasoning this many points below knowledge earns a "more scenarios" recommendation. */
export const REASONING_GAP = 15;

export function buildIntelligence(input: {
  materials: readonly IMaterial[]; questions: readonly IQuestion[]; attempts: readonly IAttempt[];
  cards: readonly ICard[]; reviews: readonly IReview[] | null;
  catalogue: readonly CompetencyRef[] | null; mappings: readonly QuestionCompetency[] | null;
  /** A competency source read that did not complete. Coverage says so, never computes from it. */
  competencyUnreadable?: boolean;
  today: string; t: Thresholds;
}): LearningIntelligence {
  const { materials, questions, attempts, cards, reviews, today, t } = input;
  const known = new Set(questions.map(q => q.id));
  const idx = attemptIndex(attempts.filter(a => known.has(a.questionId)));
  const coverage = buildCoverage(questions, idx, input.catalogue, input.mappings, input.competencyUnreadable);
  const engagement = buildEngagement({ materials, attempts, reviews, cards, today, windowDays: t.windowDays });
  const knowledge = buildKnowledge({ materials, questions, idx, cards, reviews, today, t });
  const reasoning = buildReasoning(questions, idx, t);

  // ── Insights: one true sentence per measure that has something to say ──
  const insights: string[] = [];
  if (engagement.state === "measured")
    insights.push(engagement.studyDays === 0
      ? `You have not studied in the last ${engagement.windowDays} days.`
      : `You studied on ${engagement.studyDays} of the last ${engagement.windowDays} days, and were active in ${engagement.activeWeeks} of the last ${engagement.weeks} weeks.`);
  if (knowledge.state === "measured") {
    insights.push(`On your latest try you answer ${knowledge.accuracy}% of your practice questions correctly (${knowledge.firstTryAccuracy}% first time).`);
    if (knowledge.corrected > 0) insights.push(`You have put right ${knowledge.corrected} practice question${knowledge.corrected === 1 ? "" : "s"} you first got wrong.`);
  }
  if (reasoning.state === "measured")
    insights.push(`On your latest try you handle ${reasoning.accuracy}% of your practice scenarios correctly.`);
  if (coverage.state === "measured")
    insights.push(`Your practice has touched ${coverage.practised} of ${coverage.total} competencies in ${coverage.framework}.`);

  // ── Recommendations: what to do next, each with its reason, highest priority first ──
  const recs: Recommendation[] = [];
  if (engagement.state === "measured" && engagement.cardsDue > 0)
    recs.push({ id: "review-due", priority: 100, title: `Review ${engagement.cardsDue} due card${engagement.cardsDue === 1 ? "" : "s"}`,
      reason: "Spaced revision works best when cards are reviewed on the day they come due.", href: STUDY_HREF.revise });
  if (engagement.state === "measured" && engagement.daysSinceStudy !== null && engagement.daysSinceStudy >= IDLE_DAYS) {
    const latestMaterial = [...materials].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0];
    recs.push({ id: "pick-up", priority: 90, title: "Pick up where you left off",
      reason: `It has been ${engagement.daysSinceStudy} days since you last studied.`, href: latestMaterial ? STUDY_HREF.material(latestMaterial.id) : STUDY_HREF.home });
  }
  if (knowledge.state === "measured") {
    const weak = knowledge.perMaterial.filter(m => m.accuracy !== null && m.accuracy < REVISIT_BELOW).sort((a, b) => a.accuracy! - b.accuracy!)[0];
    if (weak) recs.push({ id: `revisit-${weak.id}`, priority: 80, title: `Revisit ${weak.title}`,
      reason: `You answer ${weak.accuracy}% of its practice questions correctly on your latest try. Read the explanations, then try again.`, href: STUDY_HREF.material(weak.id) });
  }
  for (const m of materials) {
    const qs = questions.filter(q => q.materialId === m.id);
    if (qs.length === 0) {
      recs.push({ id: `generate-${m.id}`, priority: 60, title: `Write practice questions from ${m.title}`,
        reason: "There is nothing to practise from this material yet.", href: STUDY_HREF.material(m.id) });
    } else {
      const open = qs.filter(q => !idx.latest.has(q.id)).length;
      if (open > 0) recs.push({ id: `continue-${m.id}`, priority: 50, title: `Continue ${m.title}`,
        reason: `${open} of its ${qs.length} practice question${qs.length === 1 ? " is" : "s are"} not answered yet.`, href: STUDY_HREF.material(m.id) });
    }
  }
  // Short of the threshold: say how many more answers make the measure meaningful.
  if (knowledge.state === "insufficient") {
    const more = knowledge.need - knowledge.have;
    recs.push({ id: "more-questions", priority: 72, title: `Answer ${more} more practice question${more === 1 ? "" : "s"}`,
      reason: "Then Scholar can show how your practice questions are going.", href: STUDY_HREF.home });
  }
  if (reasoning.state === "insufficient") {
    const more = reasoning.need - reasoning.have;
    recs.push({ id: "more-scenarios-to-measure", priority: 71, title: `Work through ${more} more practice scenario${more === 1 ? "" : "s"}`,
      reason: "Then Scholar can show how your clinical reasoning is going.", href: STUDY_HREF.apply });
  }
  if (materials.length > 0 && reasoning.state === "not_measured")
    recs.push({ id: "try-scenarios", priority: 70, title: "Try a practice scenario",
      reason: "Scenarios practise clinical reasoning, which question practice alone does not show.", href: STUDY_HREF.apply });
  if (knowledge.state === "measured" && reasoning.state === "measured" && knowledge.accuracy - reasoning.accuracy >= REASONING_GAP)
    recs.push({ id: "more-scenarios", priority: 75, title: "Practise more scenarios",
      reason: `Your scenarios (${reasoning.accuracy}%) lag your practice questions (${knowledge.accuracy}%).`, href: STUDY_HREF.apply });
  if (coverage.state === "measured" && coverage.gaps.length > 0)
    recs.push({ id: "coverage-gaps", priority: 65, title: `Practise ${coverage.gaps.length} competenc${coverage.gaps.length === 1 ? "y" : "ies"} not yet touched`,
      reason: `For example: ${coverage.gaps.slice(0, 3).map(g => g.name).join(", ")}.`, href: null });
  if (materials.length === 0)
    recs.push({ id: "add-material", priority: 100, title: "Add your first study material",
      reason: "Everything here is built from the notes you upload.", href: STUDY_HREF.home });

  recs.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return { coverage, engagement, knowledge, reasoning, insights, recommendations: recs.slice(0, 6) };
}
