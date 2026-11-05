import { caseSessionView } from "@/lib/cases/library";
import { caseBlueprintLabels, chunkConceptRows, chunkTextRows, caseHistory, getPassage, learnedStepRows, listLearningSessions, listMaterials, listOsceAttempts, listOsceStations, listQuestions, practiceCaseRows, reviewedCardRows, revisionInsightRows, sectionLinks, getStudyPlan, type QuestionRow } from "./store";
import { listAllExamAnswers, listExamPapers } from "./exam-store";
import { settingsFromRow } from "./plan-settings";
import { localDay } from "./learning-definitions";
import { CONNECTED_SECTIONS_MAX, NOTHING_STUDIED, buildLearnedSections, pickConnected, poolFor, termsOfText, type ConnectedPick, type Draw, type LearnedSection } from "./apply-context";
import { caseReadiness } from "./sufficiency";
import { headingOf } from "./plan-data";
import { gapsOfDebrief, practiceStatus, type PracticeAttempt, type PracticeRow } from "./practice-library";
import { experienceHref } from "../experiences";

// SCHOLAR-APPLY-CONNECTED-01: the learner's own records, read for Apply. Every read here is keyed on the caller, through store.ts,
// and goes no further than this request. No new table and no copy of a learner's history. No AI anywhere in this file.

type Ctx = { admin: unknown; userId: string };
/** How many of the most recent studied sections are read for what they say. A bound on one request, not a limit on the record. */
const READ_SECTIONS = 80;
const apply = (path = "") => experienceHref("scholar", `study/apply${path}`);

export type LearningRecord = { sections: LearnedSection[]; priorities: string[]; goal: string | null; lessons: { id: string; title: string; day: string; status: string; chunkIds: string[]; materialTitles: string[] }[] };

/** What the records show this learner has studied, with what each section is about and the learner's own priorities. */
export async function loadLearningRecord(ctx: Ctx, tz: string): Promise<LearningRecord> {
  const { admin, userId } = ctx;
  const [materials, rows, cards, sessions, steps, concepts, papers, plan, practice] = await Promise.all([
    listMaterials(admin, userId), revisionInsightRows(admin, userId), reviewedCardRows(admin, userId), listLearningSessions(admin, userId, 100), learnedStepRows(admin, userId),
    chunkConceptRows(admin, userId), listExamPapers(admin, userId), getStudyPlan(admin, userId).catch(() => null), practiceCaseRows(admin, userId),
  ]);
  const mats = materials.ok ? materials.data : [];
  const titles = new Map(mats.map(m => [m.id, m.title]));
  const sess = sessions.ok ? sessions.data : [];
  const reached = new Map(sess.map(s => [s.id, s]));
  // A prepared examination paper is the learner's questions, never notes (SQIE D-4).
  const excluded = new Set(papers.ok ? papers.data.map(p => p.materialId) : []);
  // Only the steps a learner reached count as studied, not every step a lesson planned.
  const lessons = steps.flatMap(st => {
    const s = reached.get(st.sessionId);
    return s && st.step <= s.currentStep && st.materialId ? [{ chunkId: st.chunkId, materialId: st.materialId, day: localDay(s.lastActiveAt, tz), sessionId: st.sessionId }] : [];
  });
  const caseGaps = practice.sessions.flatMap(s => ((s.debrief as { revisit?: { chunkIds?: string[] }[] } | null)?.revisit ?? []).flatMap(r => (r.chunkIds ?? []).map(chunkId => ({ chunkId, day: localDay(s.lastActiveAt, tz) }))));
  const qs = rows.ok ? rows.data.questions : [];
  const atts = rows.ok ? rows.data.attempts : [];
  const firstPass = buildLearnedSections({
    materials: mats, excludedMaterials: excluded, questions: qs, lessons, caseGaps, concepts, competencies: new Map(),
    attempts: atts.map(a => ({ questionId: a.questionId, correct: a.correct, at: a.answeredAt, day: localDay(a.answeredAt, tz) })),
    cards: cards.map(c => ({ questionId: c.questionId, lastQuality: c.lastQuality, day: localDay(c.lastReviewedAt, tz) })),
  });
  const links = await sectionLinks(admin, userId, firstPass.slice(0, 200).map(s => s.chunkId));
  const comp = new Map<string, string[]>();
  for (const l of links) comp.set(l.chunkId, [...(comp.get(l.chunkId) ?? []), l.competencyId]);
  // What the most recent sections actually say: whether a case could be written from them (the engine's own readiness check, no AI),
  // and what they are about where the analysis has not said. Read here and not kept.
  const texts = await chunkTextRows(admin, userId, firstPass.slice(0, READ_SECTIONS).map(s => s.chunkId));
  const sections = firstPass.map(s => {
    const text = texts.get(s.chunkId);
    const fit = text ? caseReadiness([text], "case_blueprint").outcome : null;
    return { ...s, competencyIds: comp.get(s.chunkId) ?? [], ...(text ? { terms: termsOfText(text), heading: headingOf(text), suited: fit !== "insufficient", caseReady: fit !== "insufficient" && fit !== "simpler" } : {}) };
  });
  const settings = plan?.ok && plan.data ? settingsFromRow(plan.data) : null;
  const lessonList = sess.filter(s => lessons.some(l => l.sessionId === s.id)).map(s => {
    const own = lessons.filter(l => l.sessionId === s.id);
    return { id: s.id, title: s.title, day: localDay(s.lastActiveAt, tz), status: s.status, chunkIds: [...new Set(own.map(l => l.chunkId))], materialTitles: [...new Set(own.map(l => titles.get(l.materialId)).filter((x): x is string => !!x))] };
  });
  return { sections, priorities: [...(settings?.priorities ?? [])], goal: settings?.goal ?? null, lessons: lessonList };
}

/** The sections an integrated case would use for this choice, or why there are none. Chosen materials read as not studied unless a record says otherwise. */
export function connectedFor(record: LearningRecord, draw: Draw, today: string, extra?: { selected?: readonly { chunkId: string; materialId: string; materialTitle: string }[] }): { ok: true; pick: ConnectedPick } | { ok: false; message: string } {
  if (draw.from === "session") {
    const lesson = record.lessons.find(l => l.id === draw.sessionId);
    const pool = record.sections.filter(s => lesson?.chunkIds.includes(s.chunkId));
    const pick = pickConnected(pool.length ? widen(pool, record.sections) : [], { today, priorities: record.priorities, topic: lesson?.title ?? null, lead: "From what you learned in this lesson." });
    return pick ? { ok: true, pick } : { ok: false, message: NOTHING_STUDIED.session };
  }
  if (draw.from === "selected") {
    const known = new Map(record.sections.map(s => [s.chunkId, s]));
    const pool: LearnedSection[] = (extra?.selected ?? []).slice(0, 60).map(x => known.get(x.chunkId) ?? { ...x, concepts: [], competencyIds: [], signals: [], gap: false, lastDay: "1970-01-01" });
    if (!pool.length) return { ok: false, message: NOTHING_STUDIED.selected };
    const allStudied = pool.every(s => s.signals.length > 0);
    const spread = pool.filter((s, i) => pool.findIndex(y => y.materialId === s.materialId) === i || i < CONNECTED_SECTIONS_MAX);
    return { ok: true, pick: { ...pickWhole(spread, today, allStudied) } };
  }
  const pick = pickConnected(poolFor(record.sections, draw, { today, priorities: record.priorities }), { today, priorities: record.priorities, topic: draw.topic, companions: record.sections });
  return pick ? { ok: true, pick } : { ok: false, message: NOTHING_STUDIED[draw.from] };
}

/** A lesson's own sections, joined by what else the learner studied that relates to them. */
const widen = (lesson: readonly LearnedSection[], all: readonly LearnedSection[]): LearnedSection[] => [...lesson, ...all.filter(s => !lesson.includes(s))];

/** Chosen sections are used as chosen. Only sections with a record of study are said to have been studied. */
function pickWhole(pool: readonly LearnedSection[], today: string, allStudied: boolean): ConnectedPick {
  return pickConnected(pool, { today, allStudied }) ?? { title: "Practice", why: "", chunkIds: [], areas: [], competencyIds: [], materials: 0, hasGap: false, topic: null, allStudied };
}

/** The picked sections as the case route reads a scope: the caller's own, whole. */
export async function connectedSections(admin: unknown, userId: string, pick: ConnectedPick) {
  const found = (await Promise.all(pick.chunkIds.map(id => getPassage(admin, userId, id)))).filter((p): p is NonNullable<typeof p> => !!p);
  if (!found.length) return { ok: false as const, status: 404, error: "Those sections could not be read just now." };
  return { ok: true as const, title: pick.title, topic: pick.topic, competencyId: null, sections: found.map(p => ({ chunkId: p.chunkId, materialId: p.materialId, ordinal: p.ordinal, pageFrom: p.pageFrom, pageTo: p.pageTo, materialTitle: p.materialTitle, unit: p.unit ?? "page" })) };
}

// ── My Practice Library ──

const scenarioKey = (q: QuestionRow) => q.caseId ?? q.id;

/** Everything the learner has practised, as one list, from the records already kept. Opening any of it uses no AI. */
export async function loadPracticeRows(ctx: Ctx, opts: { competencyTitle: (id: string) => string | null; concepts?: ReadonlyMap<string, readonly string[]> }): Promise<PracticeRow[]> {
  const { admin, userId } = ctx;
  const [cases, stations, attempts, papers, answers, questions, materials, history, concepts] = await Promise.all([
    practiceCaseRows(admin, userId), listOsceStations(admin, userId), listOsceAttempts(admin, userId, null, 200), listExamPapers(admin, userId), listAllExamAnswers(admin, userId),
    listQuestions(admin, userId, { kind: "case" }), listMaterials(admin, userId), caseHistory(admin, userId, 50), opts.concepts ? Promise.resolve(opts.concepts) : chunkConceptRows(admin, userId),
  ]);
  const titles = new Map((materials.ok ? materials.data : []).map(m => [m.id, m.title]));
  const conceptsOf = (chunkIds: readonly string[]) => [...new Set(chunkIds.flatMap(c => concepts.get(c) ?? []))];
  const rows: PracticeRow[] = [];

  // Clinical reasoning cases: the case is stored whole, and every playing of it is its own session.
  for (const c of cases.cases) {
    const own = cases.sessions.filter(s => s.caseId === c.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const att: PracticeAttempt[] = own.map(s => ({ id: s.id, href: `${apply("/case")}?kind=private&session=${s.id}`, status: s.status === "completed" ? "completed" : "active", startedAt: s.createdAt, finishedAt: s.completedAt, note: null }));
    const latestDone = own.find(s => s.status === "completed");
    const gaps = latestDone ? gapsOfDebrief(latestDone.debrief) : [];
    const firstRevisit = ((latestDone?.debrief as { revisit?: { chunkIds?: string[] }[] } | null)?.revisit ?? []).flatMap(r => r.chunkIds ?? [])[0] ?? null;
    const sources = [...new Set(c.sourceMaterialIds.map(m => titles.get(m)).filter((x): x is string => !!x))];
    rows.push({
      key: `case:${c.id}`, format: "case", title: c.title, href: att[0]?.href ?? `${apply()}?view=library&q=${encodeURIComponent(c.title)}`, replayCaseId: c.id,
      createdAt: c.createdAt, lastAt: own[0]?.lastActiveAt ?? c.createdAt, status: practiceStatus(att, gaps), attempts: att,
      concepts: [...caseBlueprintLabels(c.blueprint), ...conceptsOf(c.chunkIds)], competencies: c.competencyIds.map(opts.competencyTitle).filter((x): x is string => !!x), sources, gaps,
      revise: gaps.length ? { materialId: c.materialId, chunkId: firstRevisit } : null, reviewLabel: "AI-written from your notes. Not clinically reviewed.",
    });
  }

  // Library plays: the governed case keeps its own record; only the learner's plays are listed.
  for (const h of history.ok ? history.data.filter(r => r.kind === "library") : []) {
    const v = await caseSessionView(admin, userId, h.id).catch(() => null);
    const att: PracticeAttempt = { id: h.id, href: `${apply("/case")}?kind=library&session=${h.id}`, status: h.status === "completed" ? "completed" : "active", startedAt: h.startedAt, finishedAt: h.completedAt, note: null };
    rows.push({ key: `library:${h.id}`, format: "library_case", title: v?.view.title ?? "Library case", href: att.href, replayCaseId: null, createdAt: h.startedAt, lastAt: h.completedAt ?? h.startedAt, status: practiceStatus([att], []), attempts: [att], concepts: [], competencies: [], sources: ["Competen case library"], gaps: [], revise: null, reviewLabel: "Clinically approved library case." });
  }

  // OSCE stations and their runs. Each run keeps its own responses, checklist and feedback (721).
  const runs = attempts.ok ? attempts.data : [];
  for (const s of stations.ok ? stations.data : []) {
    const own = runs.filter(a => a.stationId === s.id);
    const att: PracticeAttempt[] = own.map(a => ({ id: a.id, href: `${apply(`/osce/${s.id}`)}?attempt=${a.id}`, status: a.finishedAt ? "completed" : "active", startedAt: a.startedAt, finishedAt: a.finishedAt, note: a.criticalMissed ? `${a.criticalMissed} critical ${a.criticalMissed === 1 ? "item" : "items"} missed` : null }));
    const latest = own.find(a => a.finishedAt);
    const gaps = (Array.isArray(latest?.gaps) ? latest.gaps : []).flatMap(g => { const x = g as { label?: unknown; item?: unknown } | string; return typeof x === "string" ? [x] : typeof x?.label === "string" ? [x.label] : typeof x?.item === "string" ? [x.item] : []; }).slice(0, 8);
    rows.push({
      key: `osce:${s.id}`, format: "osce", title: s.title, href: apply(`/osce/${s.id}`), replayCaseId: null, createdAt: s.createdAt, lastAt: own[0]?.startedAt ?? s.createdAt,
      status: practiceStatus(att, gaps), attempts: att, concepts: s.sections ?? [], competencies: s.competencyId ? [opts.competencyTitle(s.competencyId)].filter((x): x is string => !!x) : [],
      sources: s.materialId && titles.get(s.materialId) ? [titles.get(s.materialId)!] : [], gaps, revise: gaps.length && s.materialId ? { materialId: s.materialId, chunkId: s.chunkId } : null, reviewLabel: s.reviewStatus === "approved" ? "Clinically approved station." : "Practice station. Not clinically reviewed.",
    });
  }

  // Practice papers the learner prepared.
  const paperAnswers = answers.ok ? answers.data : [];
  for (const p of papers.ok ? papers.data : []) {
    const title = titles.get(p.materialId) ?? "Practice paper";
    const own = paperAnswers.filter(a => a.materialId === p.materialId);
    const lastAt = own.map(a => a.createdAt).sort().pop() ?? p.createdAt;
    rows.push({
      key: `paper:${p.materialId}`, format: "paper", title, href: apply(`/papers/${p.materialId}`), replayCaseId: null, createdAt: p.createdAt, lastAt,
      status: own.length ? "in_progress" : "not_started", attempts: [], concepts: [], competencies: [], sources: [title], gaps: [], revise: null, reviewLabel: "Your own paper.",
    });
  }

  // Saved scenarios: the step-by-step cases and case questions written from a section.
  const groups = new Map<string, QuestionRow[]>();
  for (const q of questions.ok ? questions.data : []) groups.set(scenarioKey(q), [...(groups.get(scenarioKey(q)) ?? []), q]);
  for (const [key, qs] of groups) {
    const first = qs[0];
    const answered = qs.some(q => q.latest !== null);
    const missed = qs.filter(q => q.latest?.correct === false).length;
    rows.push({
      key: `scenario:${key}`, format: "scenario", title: first.caseTitle ?? first.stem.slice(0, 100), href: `${apply()}?view=library&scenarios=1#own-cases-h`, replayCaseId: null, createdAt: first.createdAt, lastAt: first.createdAt,
      status: !answered ? "not_started" : missed ? "needs_review" : "completed", attempts: [], concepts: conceptsOf(qs.map(q => q.chunkId)), competencies: first.competencyId ? [opts.competencyTitle(first.competencyId)].filter((x): x is string => !!x) : [],
      sources: titles.get(first.materialId) ? [titles.get(first.materialId)!] : [], gaps: missed ? [`${missed} ${missed === 1 ? "step" : "steps"} answered wrongly`] : [], revise: missed ? { materialId: first.materialId, chunkId: first.chunkId } : null, reviewLabel: "AI-written from your notes. Not clinically reviewed.",
    });
  }
  return rows;
}
