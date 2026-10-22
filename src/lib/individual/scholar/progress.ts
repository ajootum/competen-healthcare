// ── IMPROVE: THE PERSON'S OWN PROGRESS ── COMPETEN-IND-004 s6, COMPETEN-IND-002 s3.2(6) ──────────────────
//
// Pure aggregation over rows the store has already read by the person's own id. Self-directed study:
// nothing here is an assessment outcome, and the page that shows it says so (SELF_DIRECTED_LABEL).
//
// ⚠ NOT MEASURED IS NOT ZERO. A material with no answered questions has mastery null, and the page says
// "not measured yet". A week with no answers has accuracy null, and the trend shows a gap, not a 0% bar.
// A zero would read as a measurement, and nothing was measured.

export type ProgressMaterial = { id: string; title: string };
export type ProgressQuestion = { id: string; materialId: string; kind: "mcq" | "case" };
export type ProgressAttempt = { questionId: string; correct: boolean; answeredAt: string };
export type ProgressCard = { materialId: string; status: "active" | "mastered"; nextReviewAt: string };

export type MaterialProgress = {
  id: string;
  title: string;
  questions: number;
  answered: number;
  /** Of the questions answered, how many were right on the LATEST try. Null when none answered. */
  latestCorrect: number | null;
  mastery: number | null;
  cardsDue: number;
  cardsActive: number;
  cardsMastered: number;
};

export type WeekPoint = { weekStart: string; attempts: number; correct: number; accuracy: number | null };

export type Progress = {
  materials: MaterialProgress[];
  totals: { questions: number; answered: number; attempts: number; cardsDue: number; cardsActive: number; cardsMastered: number };
  trend: WeekPoint[];
};

/** Monday of the ISO week containing `iso` (UTC), as YYYY-MM-DD. */
export function weekStartOf(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return m.toISOString().slice(0, 10);
}

export function buildProgress(input: {
  materials: ProgressMaterial[];
  questions: ProgressQuestion[];
  attempts: ProgressAttempt[];
  cards: ProgressCard[];
  today: string;
  weeks?: number;
}): Progress {
  const { materials, questions, attempts, cards, today } = input;
  const weeks = input.weeks ?? 8;
  const qMaterial = new Map(questions.map(q => [q.id, q.materialId]));

  // Latest attempt per question.
  const latest = new Map<string, ProgressAttempt>();
  for (const a of attempts) {
    const prev = latest.get(a.questionId);
    if (!prev || a.answeredAt > prev.answeredAt) latest.set(a.questionId, a);
  }

  const rows: MaterialProgress[] = materials.map(m => {
    const qs = questions.filter(q => q.materialId === m.id);
    const answeredQs = qs.filter(q => latest.has(q.id));
    const right = answeredQs.filter(q => latest.get(q.id)!.correct).length;
    const mc = cards.filter(c => c.materialId === m.id);
    return {
      id: m.id, title: m.title,
      questions: qs.length,
      answered: answeredQs.length,
      latestCorrect: answeredQs.length ? right : null,
      mastery: answeredQs.length ? Math.round((right / answeredQs.length) * 100) : null,
      cardsDue: mc.filter(c => c.status === "active" && c.nextReviewAt <= today).length,
      cardsActive: mc.filter(c => c.status === "active").length,
      cardsMastered: mc.filter(c => c.status === "mastered").length,
    };
  });

  // Weekly trend, oldest first, ending with the current week.
  const thisWeek = weekStartOf(`${today}T12:00:00Z`);
  const starts: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(`${thisWeek}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i * 7);
    starts.push(d.toISOString().slice(0, 10));
  }
  const bucket = new Map(starts.map(s => [s, { attempts: 0, correct: 0 }]));
  for (const a of attempts) {
    if (!qMaterial.has(a.questionId)) continue;
    const b = bucket.get(weekStartOf(a.answeredAt));
    if (!b) continue;
    b.attempts++; if (a.correct) b.correct++;
  }
  const trend = starts.map(s => {
    const b = bucket.get(s)!;
    return { weekStart: s, attempts: b.attempts, correct: b.correct, accuracy: b.attempts ? Math.round((b.correct / b.attempts) * 100) : null };
  });

  return {
    materials: rows,
    totals: {
      questions: questions.length,
      answered: latest.size,
      attempts: attempts.length,
      cardsDue: rows.reduce((n, r) => n + r.cardsDue, 0),
      cardsActive: rows.reduce((n, r) => n + r.cardsActive, 0),
      cardsMastered: rows.reduce((n, r) => n + r.cardsMastered, 0),
    },
    trend,
  };
}
