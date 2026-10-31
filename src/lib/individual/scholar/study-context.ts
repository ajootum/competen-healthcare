// ── CONNECTED STUDY SESSIONS ON A PAGE AND IN A ROUTE (SCHOLAR-SESSION-AI-02 slice B) ── server only ─────────────────
//
// loadStudy  a page's ?study=<id>: resolved once, by DATABASE READS ONLY (no AI), to the caller's own connected
//            session, its focus (study-carry.ts StudyScope) and the session bar. The space the page belongs to is
//            recorded as last_space. Anything else (no id, not a uuid, another person's id, a plain Learn session, the
//            policy off, migration 740 absent) answers null, and the page behaves exactly as without ?study= (no
//            disclosure that the id exists).
// linkStudy  after one of the learner's own activities was created, link it to their session. Best effort: it never
//            throws and never fails the activity (a missing or foreign session id is simply not linked).
//
// studySessionBlock  slice C (owner D4): the caller's own connected session turned into the Personal AI's session block
//            (study-session-context.ts). Database reads only, no AI call. Null where the policy is off, 740 is absent,
//            the id is not the caller's own connected session, or anything fails (the ask then runs exactly as before).
//
// Reads and writes go through store.ts only (harness A1). Nothing here writes evaluation, verification, DACUM or
// Passport rows (owner D5): a link row says the activity belongs to the session, nothing more.

import { isStudySessionsOn, loadIndividualPolicy, type IndividualPolicy } from "@/lib/individual/policy";
import {
  addStudyLink, getConnectedSession, getLearningSession, getOsceAttempt, latestConnectedSession, learningEvents, listStudyLinks, revisionPool, setLastSpace, studySessionSchema, topicsOfSections,
  type StudySessionRow,
} from "./store";
import { REVISION_FORMATS } from "./config";
import { rubricOf } from "./question-intel";
import { buildStudySessionContext, type StudySessionContextInput, type StudySessionSection } from "./study-session-context";
import type { StudyLinkKind, StudySpace } from "./study-session";
import { isStudyId, studyScopeOf, studyStages, type StudyBarView, type StudyScope } from "./study-carry";
import { displaySessionTitle } from "./learn-search";

type Admin = unknown;
type Policy = Pick<IndividualPolicy, "scholarStudySessions">;

/** Whether study sessions are on for this caller: the policy switch AND migration 740 (fails closed). */
export async function studySessionsOn(admin: Admin, userId: string, policy?: Policy): Promise<boolean> {
  try {
    const p = policy ?? await loadIndividualPolicy(admin);
    if (!p.scholarStudySessions) return false;
    return isStudySessionsOn(p, await studySessionSchema(admin, userId));
  } catch { return false; }
}

export type StudyOnPage = { session: StudySessionRow; scope: StudyScope; bar: StudyBarView };

/** The caller's study session for this page, or null (see the file header). `space` null: the page is not a stage (Library, Progress). */
export async function loadStudy(admin: Admin, userId: string, raw: unknown, space: StudySpace | null, policy?: Policy): Promise<StudyOnPage | null> {
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!isStudyId(id)) return null;
  try {
    if (!(await studySessionsOn(admin, userId, policy))) return null;
    const session = await getConnectedSession(admin, userId, id);
    if (!session) return null;
    const [full, links] = await Promise.all([getLearningSession(admin, userId, id), listStudyLinks(admin, userId, id), space ? setLastSpace(admin, userId, id, space) : null]);
    const steps = full.ok && full.data ? full.data.steps : [];
    const scope = studyScopeOf(session, steps);
    return {
      session, scope,
      bar: {
        id: session.id, title: displaySessionTitle(session.title), objective: session.objectiveOutcome ?? session.objectiveText ?? null,
        current: space, status: session.status, stages: studyStages(session, steps.length, links),
      },
    };
  } catch { return null; }
}

/** "Continue your study session": the caller's latest active one, and where to reopen it (its last space). Null where none or off. */
export async function continueStudy(admin: Admin, userId: string, policy?: Policy): Promise<{ id: string; title: string; space: StudySpace } | null> {
  try {
    if (!(await studySessionsOn(admin, userId, policy))) return null;
    const s = await latestConnectedSession(admin, userId);
    return s ? { id: s.id, title: displaySessionTitle(s.title), space: s.lastSpace ?? "learn" } : null;
  } catch { return null; }
}

/** Link a just-created activity to the caller's own study session. Never throws; never fails the activity. */
export async function linkStudy(admin: Admin, userId: string, raw: unknown, kind: StudyLinkKind, refId: string | null | undefined, policy?: Policy): Promise<void> {
  if (!isStudyId(raw) || !refId) return;
  try {
    if (!(await studySessionsOn(admin, userId, policy))) return;
    if (!(await getConnectedSession(admin, userId, raw))) return;
    await addStudyLink(admin, userId, { sessionId: raw, kind, refId });
  } catch { /* a link is never worth failing the activity */ }
}

const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

/**
 * The study-session block for the Personal AI (owner D4), from the caller's own connected session and the records of
 * it: its steps and their topics, missed questions in its sections, its "not yet" checks, the OSCE runs linked to it.
 * Every read is a store.ts call keyed on the caller. Nothing Professional, employer, estate or another learner's.
 * `competencyTitle` names the session's competency from the catalogue the caller already read (no read here).
 */
export async function studySessionBlock(admin: Admin, userId: string, raw: unknown, opts: { policy?: Policy; competencyTitle?: (id: string) => string | null } = {}): Promise<{ text: string; sections: StudySessionSection[] } | null> {
  if (!isStudyId(raw)) return null;
  try {
    if (!(await studySessionsOn(admin, userId, opts.policy))) return null;
    const session = await getConnectedSession(admin, userId, raw);
    if (!session) return null;
    const [full, links, events] = await Promise.all([getLearningSession(admin, userId, raw), listStudyLinks(admin, userId, raw), learningEvents(admin, userId, raw)]);
    const steps = full.ok && full.data ? full.data.steps : [];
    const chunkIds = [...new Set(steps.flatMap(s => s.sections.map(x => x.chunkId)))];
    const [topics, pool] = await Promise.all([
      chunkIds.length ? topicsOfSections(admin, userId, chunkIds) : Promise.resolve(new Map<string, string[]>()),
      chunkIds.length ? revisionPool(admin, userId, { chunkIds, kinds: [...REVISION_FORMATS, "case"] }) : Promise.resolve(null),
    ]);
    const topicOf = (chunkId: string) => topics.get(chunkId)?.[0] ?? null;

    // Sources: each material once, in the order the session first reaches it, with its sections' topics. No text.
    const byMaterial = new Map<string, { material: string; order: number; topics: string[] }>();
    for (const st of steps) for (const sec of st.sections) {
      const m = byMaterial.get(sec.materialId) ?? { material: sec.materialTitle, order: st.step * 10000 + sec.ordinal, topics: [] };
      m.topics.push(...(topics.get(sec.chunkId) ?? []));
      byMaterial.set(sec.materialId, m);
    }

    // Misconceptions: questions in the session's own sections answered wrongly, and their rubric's recorded mistakes.
    const stats = pool?.ok ? pool.data.stats : new Map();
    const missedQs = pool?.ok ? pool.data.questions.filter(q => (stats.get(q.id)?.misses ?? 0) > 0) : [];
    const missed = missedQs.map(q => ({ id: q.id, stem: q.stem, topic: topicOf(q.chunkId), at: stats.get(q.id)?.lastAnsweredAt ?? null, still: stats.get(q.id)?.latestCorrect === false }));
    const mistakes = missedQs.flatMap(q => rubricOf(q.answer)?.misconceptions ?? []);
    const stepTopic = new Map(steps.map(st => [st.step, st.sections.map(x => topicOf(x.chunkId)).find(Boolean) ?? st.sections[0]?.materialTitle ?? null]));
    const unsure = (events.ok ? events.data : []).filter(e => e.action === "clarify" && e.verdict === "not_yet")
      .flatMap(e => { const t = stepTopic.get(e.step); return t ? [{ topic: t, at: e.createdAt }] : []; });

    // Formative feedback: the latest OSCE runs linked to this session (D5: formative only, never evidence).
    const osceRefs = (links ?? []).filter(l => l.kind === "osce_attempt").sort((a, b) => desc(a.createdAt, b.createdAt)).slice(0, 3);
    const runs = await Promise.all(osceRefs.map(l => getOsceAttempt(admin, userId, l.refId)));
    const osce: StudySessionContextInput["osce"] = runs.flatMap(a => {
      if (!a || (!a.gaps?.length && !a.revisionSuggestions?.length)) return [];
      const gaps = (a.gaps ?? []).flatMap(raw => {
        const g = raw as { text?: unknown; critical?: unknown; mark?: unknown } | null;
        return g && typeof g.text === "string" && (g.mark === "missed" || g.mark === "partly") ? [{ text: g.text, critical: g.critical === true, mark: g.mark as "missed" | "partly" }] : [];
      });
      const suggestions = (a.revisionSuggestions ?? []).flatMap(raw => { const s = raw as { label?: unknown } | null; return s && typeof s.label === "string" ? [s.label] : []; });
      const station = typeof a.snapshot?.title === "string" ? a.snapshot.title : null;
      return [{ id: a.id, station, at: a.finishedAt ?? a.startedAt, gaps, suggestions }];
    });

    const stagesTouched = studyStages(session, steps.length, links).filter(s => s.mark !== "none").map(s => s.label);
    const competency = session.competencyId ? opts.competencyTitle?.(session.competencyId) ?? null : null;
    return buildStudySessionContext({
      focus: { title: displaySessionTitle(session.title), objective: session.objectiveOutcome ?? session.objectiveText ?? null, competencies: competency ? [competency] : [] },
      sources: [...byMaterial.values()], missed, mistakes, unsure, osce,
      progress: { stepsDone: Math.min(session.currentStep, steps.length), stepsTotal: steps.length, completed: session.status === "completed", stagesTouched },
    });
  } catch { return null; }
}
