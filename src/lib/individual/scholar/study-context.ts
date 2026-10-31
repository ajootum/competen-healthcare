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
// Reads and writes go through store.ts only (harness A1). Nothing here writes evaluation, verification, DACUM or
// Passport rows (owner D5): a link row says the activity belongs to the session, nothing more.

import { isStudySessionsOn, loadIndividualPolicy, type IndividualPolicy } from "@/lib/individual/policy";
import {
  addStudyLink, getConnectedSession, getLearningSession, latestConnectedSession, listStudyLinks, setLastSpace, studySessionSchema,
  type StudySessionRow,
} from "./store";
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
