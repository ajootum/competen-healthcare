// ── MONTHLY LEARNING REVIEW AND STUDY CALENDAR: THE ASSEMBLY ── SCHOLAR-MONTHLY-REVIEW-01 (owner GO, 1 Nov 2026) ─────
//
// Around the pure files (monthly-review.ts, study-calendar.ts). Every read and write is the caller's own rows and goes through
// the store (the only Scholar write site). NO new AI call path: a shortfall is written only by the EXISTING revision-session
// route (the same consent, the same allowance, the same checks), and only where policy allows it and the learner's AI standing
// says it is available. NO migration for the review: it is an ordinary evaluation (426) over an ordinary mock session (417).
// Migration 830 only keeps what the calendar cannot derive (moved dates, a review waiting to resume, the opt-out), and
// everything here works without it.

import type { IndividualContext } from "../guard";
import type { IndividualPolicy } from "../policy";
import { experienceHref } from "../experiences";
import {
  calendarSchema, cardDueDates, createRevisionSession, discardRevisionSession, getRevisionSession, listCalendarEntries, listMonthlyReviewRecords, monthRecords, monthlyReviewForSession,
  putCalendarEntry, revisionPool, sittingQuestions, topicsOfSections, type Admin, type MonthlyReviewRecord, type StoredCalendarEntry,
} from "./store";
import { keyOf } from "./revision";
import { loadLearnerCatalogue } from "./competency-view";
import { activityState, getScholarAiStanding } from "./ai-standing";
import { audit } from "./http";
import { REVISION_QUANTITY_MAX, REVISION_FORMATS, type RevisionFormat } from "./config";
import {
  MAX_REVIEW_SECTIONS, MONTHLY_REVIEW_VERSION, compactBlueprint, isLate, isMonth, monthActivity, monthOf, monthStanding, monthlyBlueprint, monthlyBreakdown, optedOutOf, prevMonth,
  recommendedDate, reviewLength, reviewNudges, selectForBlueprint, type ActivityRecords, type Blueprint, type GapSignals, type MonthlyBreakdown, type Nudge, type PoolQuestion, type ReviewPolicy,
} from "./monthly-review";
import type { CompletedRecord } from "./study-calendar";

const studyHref = (seg = "") => experienceHref("scholar", seg ? `study/${seg}` : "study");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The policy as the pure blueprint reads it. */
export const reviewPolicyOf = (p: IndividualPolicy): ReviewPolicy => ({
  minQuestions: p.scholarMonthlyReviewMinQuestions, maxQuestions: p.scholarMonthlyReviewMaxQuestions, perSection: p.scholarMonthlyReviewPerSection, mix: p.scholarMonthlyReviewMix,
});
/** The formats a review's questions may take: the revision formats HQ offers, without the ones a held-to-the-end sitting cannot use (multi-part answers, flip cards). */
export const reviewFormats = (p: IndividualPolicy): RevisionFormat[] => {
  const f = p.scholarRevisionFormats.filter(x => x !== "structured" && x !== "flashcard" && (REVISION_FORMATS as readonly string[]).includes(x));
  return f.length ? f : ["mcq"];
};
export const monthlyReviewOn = (p: IndividualPolicy) => p.scholarMonthlyReview === "on" && p.scholarEvaluationMethods.includes("fresh") && p.scholarRevisionModes.includes("mock");

export type MonthRaw = { records: ActivityRecords; completed: CompletedRecord[] };

/**
 * The learner's own dated records from the first day of `fromMonth` to the last day of `toMonth`, and the completed-work lines
 * the calendar shows. Only real activity dates. Unreadable is null: the caller says so, never a calm zero.
 */
export async function loadMonthRaw(admin: Admin, userId: string, fromMonth: string, toMonth: string): Promise<MonthRaw | null> {
  const learner = await loadLearnerCatalogue(admin, userId);
  const m = await monthRecords(admin, userId, fromMonth, toMonth, (learner.competencies ?? []).map(c => ({ id: c.id, title: c.title })));
  if (!m) return null;
  const { records } = m;
  const completed: CompletedRecord[] = [];
  const seen = new Set<string>();
  for (const l of records.lessons) {
    const k = `${l.sessionId}:${l.step}:${l.at.slice(0, 10)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    completed.push({ at: l.at, kind: "lesson", title: l.title, detail: "Lesson studied", href: `${studyHref("learn")}?session=${encodeURIComponent(l.sessionId)}#lesson-${l.step}` });
  }
  for (const s of records.revisionSessions) completed.push({ at: s.at, kind: "revision", title: s.mode === "mock" ? "Mock revision session" : "Revision session", detail: null, href: `${studyHref("revise")}?session=${encodeURIComponent(s.id)}` });
  for (const c of records.caseSessions) completed.push({ at: c.at, kind: "case", title: "Clinical case practice", detail: null, href: studyHref("apply") });
  for (const r of records.reviews) completed.push({ at: r.at, kind: "cards", title: "1", href: `${studyHref("revise/flashcards")}?view=history` });
  for (const e of m.evaluations) {
    const monthly = e.scopeKind === "month";
    completed.push({
      at: e.at, kind: "evaluation", title: monthly ? `Monthly review: ${e.label ?? ""}`.trim() : `Evaluation: ${e.label ?? "my learning"}`,
      detail: monthly ? "Optional formative review · not verified competence" : null, href: `${studyHref("evaluate")}/${e.id}`,
    });
  }
  return { records, completed };
}

/** The cards by their review day, for the calendar. null when unreadable. */
export const loadDueByDate = cardDueDates;

// ── the kept reviews ──
export type MonthlyReviewRow = MonthlyReviewRecord;
/** The learner's monthly reviews (the evaluations whose scope is a month), newest first. Light: no results are read. */
export const listMonthlyReviews = listMonthlyReviewRecords;

// ── the evaluate panel and the progress card ──
export type MonthPanel = {
  month: string;
  lessons: number; sections: number; materials: number; subjects: string[];
  /** How many questions the review will ask for, at most. */
  estimated: number;
  hasActivity: boolean;
  state: "no_activity" | "ready" | "in_progress" | "done";
  original: MonthlyReviewRow | null;
  retakes: MonthlyReviewRow[];
  resumeHref: string | null;
  recommended: string;
  /** The month has ended: taking the review now is late (allowed, and said). */
  late: boolean;
};
export type MonthlyOverview = {
  panels: MonthPanel[];
  nudges: Nudge[];
  optedOut: boolean;
  canOptOut: boolean;
  /** Whether 830 is present: the opt-out and the resume link need it. */
  store: boolean;
  reminders: boolean;
  /** The learner's latest original review, for the Progress card, and how many practice retakes of that month there are. */
  latest: MonthlyReviewRow | null;
  latestRetakes: number;
};

export const resumeHrefOf = (sessionId: string, evscope: unknown) => `${studyHref("revise")}?session=${encodeURIComponent(sessionId)}&evaluate=fresh&evscope=${encodeURIComponent(JSON.stringify(evscope))}`;

/** What the Evaluate panel and the Progress banner need, for the current month and the one before. null when the records cannot be read. */
export async function loadMonthlyOverview(admin: Admin, userId: string, policy: IndividualPolicy, today: string): Promise<MonthlyOverview | null> {
  const cur = monthOf(today), prev = prevMonth(cur);
  const [raw, reviews, store] = await Promise.all([loadMonthRaw(admin, userId, prev, cur), listMonthlyReviews(admin, userId), calendarSchema(admin, userId)]);
  if (!raw || !reviews) return null;
  const entries = store ? await listCalendarEntries(admin, userId) : null;
  const stored: StoredCalendarEntry[] = entries?.ok ? entries.data : [];
  const optedOut = optedOutOf(stored);
  const rp = reviewPolicyOf(policy);
  const panels: MonthPanel[] = [];
  for (const m of [cur, prev]) {
    const a = monthActivity(raw.records, m);
    const standing = monthStanding(reviews, m);
    const entry = stored.find(e => e.kind === "monthly_review" && e.ref === m);
    const sid = typeof entry?.value?.sessionId === "string" ? (entry!.value!.sessionId as string) : null;
    const taken = sid ? reviews.some(r => r.freshSessionId === sid) : false;
    let resumeHref: string | null = null;
    if (sid && !taken && entry?.value?.evscope) {
      const s = await getRevisionSession(admin, userId, sid);
      if (s.ok && s.data) resumeHref = resumeHrefOf(sid, entry.value.evscope);
    }
    const hasActivity = a.sections.length > 0;
    const state: MonthPanel["state"] = standing.original ? "done" : resumeHref ? "in_progress" : hasActivity ? "ready" : "no_activity";
    // The earlier month is only worth showing while it is still open.
    if (m === prev && (state === "done" || state === "no_activity")) continue;
    panels.push({
      month: m, lessons: a.lessons.length, sections: a.sections.length, materials: a.materials.length, subjects: a.subjects.slice(0, 8),
      estimated: reviewLength(Math.min(a.sections.length, MAX_REVIEW_SECTIONS), rp), hasActivity, state, original: standing.original, retakes: standing.retakes,
      resumeHref, recommended: recommendedDate(m, policy.scholarMonthlyReviewRecommendDays), late: m < cur,
    });
  }
  const done = new Set(reviews.filter(r => r.retakeOf === null).map(r => r.month));
  const active = new Set(panels.filter(p => p.hasActivity).map(p => p.month));
  const nudges = reviewNudges({
    today, recommendDays: policy.scholarMonthlyReviewRecommendDays, reminders: policy.scholarMonthlyReviewReminders === "on",
    optedOut: optedOut && policy.scholarMonthlyReviewOptout === "allowed", done, active,
  });
  const originals = reviews.filter(r => r.retakeOf === null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    panels, nudges, optedOut: optedOut && policy.scholarMonthlyReviewOptout === "allowed", canOptOut: store && policy.scholarMonthlyReviewOptout === "allowed", store,
    reminders: policy.scholarMonthlyReviewReminders === "on", latest: originals[0] ?? null,
    latestRetakes: originals[0] ? monthStanding(reviews, originals[0].month).retakes.length : 0,
  };
}

// ── starting a review ──
export type StartResult =
  | { ok: true; sessionId: string; blueprint: Blueprint; evscope: Record<string, unknown>; asked: number; stored: number; written: number; spilled: { application: number; gaps: number }; shorter: boolean; notes: string[] }
  | { ok: false; status: number; error: string };

async function poolFor(admin: Admin, userId: string, chunkIds: readonly string[], formats: readonly RevisionFormat[]) {
  const p = await revisionPool(admin, userId, { chunkIds, kinds: [...formats, "case"] });
  if (!p.ok) return null;
  const items: (PoolQuestion & { kind: string })[] = [];
  for (const q of p.data.questions) {
    if (!keyOf(q)) continue;
    const st = p.data.stats.get(q.id);
    items.push({ id: q.id, chunkId: q.chunkId, kind: q.kind, application: q.kind === "case" || !!q.caseId, gap: !!st && st.misses > 0 && st.latestCorrect !== true });
  }
  return items;
}

/** Validates a retake: it must name one of the learner's own reviews of the same month. A retake of a retake names the original. */
export async function resolveRetake(admin: Admin, userId: string, month: string, retakeOf: unknown): Promise<{ ok: true; originalId: string | null } | { ok: false; status: number; error: string }> {
  if (retakeOf === undefined || retakeOf === null || retakeOf === "") return { ok: true, originalId: null };
  if (typeof retakeOf !== "string" || !uuid.test(retakeOf)) return { ok: false, status: 400, error: "That review could not be found." };
  const rows = await listMonthlyReviews(admin, userId);
  if (!rows) return { ok: false, status: 503, error: "Your reviews could not be read just now." };
  const named = rows.find(r => r.id === retakeOf && r.month === month);
  if (!named) return { ok: false, status: 404, error: "That review could not be found." };
  return { ok: true, originalId: named.retakeOf ?? named.id };
}

/**
 * Start (or retake) the review of `month`. Stored questions first; the shortfall is written only by the existing revision
 * route, only when policy allows new questions and the learner's AI standing says they are available. Otherwise a shorter
 * review is run from what is stored, and the notes say so. The questions become a Mock revision session (feedback at the end).
 */
export async function startMonthlyReview(ctx: IndividualContext, req: Request, policy: IndividualPolicy, input: { month: string; retakeOf?: unknown; today: string }): Promise<StartResult> {
  const { admin, userId } = ctx;
  if (!monthlyReviewOn(policy)) return { ok: false, status: 403, error: "The monthly review is not offered here." };
  if (!isMonth(input.month) || input.month > monthOf(input.today)) return { ok: false, status: 400, error: "Choose this month or an earlier one." };
  const retake = await resolveRetake(admin, userId, input.month, input.retakeOf);
  if (!retake.ok) return retake;
  const raw = await loadMonthRaw(admin, userId, input.month, input.month);
  if (!raw) return { ok: false, status: 503, error: "Your study records could not be read just now. Try again shortly." };
  const activity = monthActivity(raw.records, input.month);
  if (!activity.sections.length) return { ok: false, status: 404, error: "No study activity is recorded for that month, so there is nothing to review." };

  const formats = reviewFormats(policy);
  const sectionIds = activity.sections.slice(0, MAX_REVIEW_SECTIONS).map(s => s.chunkId);
  const pool0 = await poolFor(admin, userId, sectionIds, formats);
  if (!pool0) return { ok: false, status: 503, error: "Your saved questions could not be read just now. Try again shortly." };
  const gaps: Record<string, number> = {};
  for (const q of pool0) if (q.gap) gaps[q.chunkId] = (gaps[q.chunkId] ?? 0) + 1;
  const blueprint = monthlyBlueprint(activity, gaps as GapSignals, reviewPolicyOf(policy));
  if (!blueprint.length) return { ok: false, status: 404, error: "No study activity is recorded for that month, so there is nothing to review." };

  const seed = `${userId}:${input.month}:${retake.originalId ?? "original"}:${input.today}`;
  const sel = selectForBlueprint(blueprint, pool0, seed);
  const notes: string[] = [];
  const ids = sel.picked.map(p => p.id);
  const bucket = new Map(sel.picked.map(p => [p.id, p.bucket]));
  let written = 0;

  // ── the shortfall: written only through the existing path, and only where it is allowed ──
  if (sel.shortfallTotal > 0) {
    if (policy.scholarRevisionGeneration === "saved_only") notes.push("New questions are not written here, so this review uses your saved questions only.");
    else {
      const standing = activityState(await getScholarAiStanding(admin, userId), "questions");
      if (!standing.available) notes.push(`${standing.message ?? "New AI help is not available right now."} This review uses your saved questions.`);
      else {
        const shortSections = sel.shortfall.map(s => s.chunkId);
        const before = new Set(pool0.map(q => q.id));
        const storedHere = pool0.filter(q => shortSections.includes(q.chunkId) && !q.application).length;
        const { POST: startRevision } = await import("@/app/api/individual/scholar/revision/sessions/route");
        const headers = new Headers(req.headers);
        headers.delete("content-length"); headers.set("content-type", "application/json");
        const res = await startRevision(new Request(req.url, {
          method: "POST", headers,
          body: JSON.stringify({ mode: "mock", scope: { kind: "sources", chunkIds: shortSections.slice(0, MAX_REVIEW_SECTIONS) }, quantity: Math.min(REVISION_QUANTITY_MAX, storedHere + sel.shortfallTotal), formats }),
        }));
        const body = (await res.json().catch(() => ({}))) as { session?: { id?: string } | null; note?: string | null; error?: string };
        // That sitting only existed to have the questions written: the review makes its own from the blueprint.
        if (body.session?.id) await discardRevisionSession(admin, userId, body.session.id);
        if (body.note) notes.push(body.note);
        else if (!res.ok && body.error) notes.push(body.error);
        const after = await poolFor(admin, userId, shortSections, formats);
        const fresh = (after ?? []).filter(q => !before.has(q.id) && !q.application);
        const want = new Map(sel.shortfall.map(s => [s.chunkId, s.count]));
        let left = sel.shortfallTotal;
        for (const q of fresh) {
          if (left <= 0) break;
          const w = want.get(q.chunkId) ?? 0;
          if (w <= 0) continue;
          want.set(q.chunkId, w - 1); left--; ids.push(q.id); bucket.set(q.id, "core"); written++;
        }
        // A section that wrote less than it was owed: another section's new question stands in, so the length holds where it can.
        for (const q of fresh) { if (left <= 0) break; if (ids.includes(q.id)) continue; left--; ids.push(q.id); bucket.set(q.id, "core"); written++; }
      }
    }
  }
  if (!ids.length) return { ok: false, status: 404, error: `${notes.join(" ")} There are no questions to review that month yet, so there is nothing to start. Your cards, saved sets and history are unaffected.`.trim() };

  const made = await createRevisionSession(admin, userId, { mode: "mock", feedback: "end", questionIds: ids });
  if (!made.ok) return { ok: false, status: made.notProvisioned ? 409 : 500, error: made.notProvisioned ? "Study sessions are not kept on this environment yet." : "Your review could not be started just now." };
  const shorter = ids.length < blueprint.length;
  if (shorter) notes.push(`A shorter review: ${ids.length} question${ids.length === 1 ? "" : "s"} instead of ${blueprint.length}, from the questions available.`);
  if (sel.spilled.application + sel.spilled.gaps > 0) notes.push(`${sel.spilled.application + sel.spilled.gaps} place${sel.spilled.application + sel.spilled.gaps === 1 ? "" : "s"} meant for application or earlier gaps went to core knowledge, because no stored question fitted.`);

  const evscope = { kind: "month", month: input.month, retakeOf: retake.originalId, bp: compactBlueprint(blueprint) } as Record<string, unknown>;
  if (await calendarSchema(admin, userId)) {
    await putCalendarEntry(admin, userId, "monthly_review", input.month, { value: { sessionId: made.id, startedAt: new Date().toISOString(), evscope } });
  }
  const buckets = [...bucket.values()];
  await audit(ctx, "individual_scholar_monthly_review_started", "individual_scholar_revision_session", made.id, {
    month: input.month, retake: retake.originalId !== null, sections: blueprint.sections.length, length: blueprint.length, asked: ids.length, stored: ids.length - written, written,
    spilled: sel.spilled, buckets: { core: buckets.filter(b => b === "core").length, application: buckets.filter(b => b === "application").length, gaps: buckets.filter(b => b === "gaps").length },
  });
  return { ok: true, sessionId: made.id, blueprint, evscope, asked: ids.length, stored: ids.length - written, written, spilled: sel.spilled, shorter, notes };
}

// ── finishing a review: the context and the by-topic result that the evaluation keeps ──

/** The evaluation already made from this sitting, if any: asking twice returns it, never a second "original". */
export const evaluationForSession = monthlyReviewForSession;

export type MonthlyCompletion = {
  breakdown: MonthlyBreakdown;
  monthlyReview: { month: string; blueprint: Blueprint; questionIds: string[]; policyVersion: string; retakeOf: string | null; late: boolean; version: string };
};

/**
 * How the review went by section and topic, and the context the evaluation keeps: the month, the exact blueprint, the questions
 * asked (read from the sitting itself, never from the request), the configuration version, the original it is a practice retake
 * of (or null), and whether it was started after the month ended. Question versions and each attempt are preserved by the 791
 * snapshots; the evaluation names them and does not copy them.
 */
export async function monthlyCompletion(admin: Admin, userId: string, o: {
  month: string; blueprint: Blueprint; retakeOf: string | null; policyVersion: string; bands: { strong: number; developing: number };
  sitting: { createdAt: string; questionIds: readonly string[]; attempts: readonly { questionId: string; correct: boolean; marking: string; answeredAt: string }[] };
  sections: readonly { chunkId: string; materialId: string; materialTitle: string; label: string }[];
}): Promise<MonthlyCompletion | null> {
  try {
    const questions = await sittingQuestions(admin, userId, o.sitting.questionIds);
    const topics = await topicsOfSections(admin, userId, [...new Set(questions.map(q => q.chunkId))]);
    const known = new Map(o.sections.map(s => [s.chunkId, s]));
    // A question of a section the evaluation scope does not name still shows, under what is known of it.
    const sections = [...new Set(questions.map(q => q.chunkId))].map(c => known.get(c) ?? { chunkId: c, materialId: "", materialTitle: "A section", label: "a section" });
    const breakdown = monthlyBreakdown({ sections, topics: Object.fromEntries(topics.entries()), questions, attempts: o.sitting.attempts, bands: o.bands });
    return {
      breakdown,
      monthlyReview: {
        month: o.month, blueprint: o.blueprint, questionIds: [...o.sitting.questionIds], policyVersion: o.policyVersion, retakeOf: o.retakeOf,
        late: isLate(o.month, o.sitting.createdAt), version: MONTHLY_REVIEW_VERSION,
      },
    };
  } catch { return null; }
}
