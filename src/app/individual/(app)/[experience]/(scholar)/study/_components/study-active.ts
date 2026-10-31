// SCHOLAR-SESSION-AI-02 slice B: the study session open on THIS page, for the client components that create an
// activity (they send it as studySessionId, and carry ?study= on to the page they open next). Set by StudyNav from the
// session the SERVER resolved (study-context.ts loadStudy), never read from the address bar, so with the feature off,
// or with another person's id in the address, it stays null and nothing is sent. Browser only.

import { isStudyId, withStudy } from "@/lib/individual/scholar/study-carry";

let active: string | null = null;
export const STUDY_EVENT = "scholar:study";
export const setActiveStudy = (id: string | null | undefined) => { active = isStudyId(id) ? id : null; };
/** The open study session's id, or null. Read it in an event handler, not while rendering. */
export const activeStudyId = (): string | null => active;
/** The request field for a create route: { studySessionId } while a session is open, otherwise nothing. */
export const studyField = (): { studySessionId?: string } => (active ? { studySessionId: active } : {});
/** A link onward from a client component, carrying the open session. */
export const carry = (href: string) => withStudy(href, active);
