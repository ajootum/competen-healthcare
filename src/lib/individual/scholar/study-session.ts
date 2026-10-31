// ── CONNECTED STUDY SESSIONS (SCHOLAR-SESSION-AI-02, migration 740) ── the pure vocabulary ─────────────────────────
//
// A study session IS a Learn session (414) flagged connected (owner D1). This file holds only what is pure: the four
// study spaces, the six activity kinds a session may link, and the rules that shape the session's objective before the
// store writes it. No database, no AI. The store (store.ts) is the only file that reads or writes the rows.
//
// ⚠ D2. A learning objective is a CFCA outcome of the session's competency, held as its text (outcomes have no id), or
// a free-text educational objective where no approved mapping exists. An outcome without a competency is unstorable
// (740 CHECK), so it is dropped here rather than refused: learning an unmapped topic is never blocked.
// ⚠ D5. Nothing here is assessment evidence, verified competence or a Passport record.

export const STUDY_SPACES = ["learn", "revise", "apply", "evaluate"] as const;
export type StudySpace = (typeof STUDY_SPACES)[number];
export const isStudySpace = (x: unknown): x is StudySpace => typeof x === "string" && (STUDY_SPACES as readonly string[]).includes(x);

/** The learner's own activities a study session may link (740 kind CHECK). exam_paper refs are the paper's material id. */
export const STUDY_LINK_KINDS = ["revision_session", "osce_attempt", "flashcard_deck", "case_session", "evaluation", "exam_paper"] as const;
export type StudyLinkKind = (typeof STUDY_LINK_KINDS)[number];
export const isStudyLinkKind = (x: unknown): x is StudyLinkKind => typeof x === "string" && (STUDY_LINK_KINDS as readonly string[]).includes(x);

/** 740 limits, the same numbers as the CHECK. */
export const OBJECTIVE_OUTCOME_MAX = 500;
export const OBJECTIVE_TEXT_MAX = 300;

export type StudyFieldsInput = { connected?: boolean; objectiveOutcome?: string | null; objectiveText?: string | null };
export type StudyFields = { connected: boolean; objective_outcome: string | null; objective_text: string | null };

const clean = (s: string | null | undefined, max: number): string | null => {
  if (typeof s !== "string") return null;
  const t = s.replace(/\s+/g, " ").trim().slice(0, max).trim();
  return t.length ? t : null;
};

/** A typed learning objective (D2, free text): spaces folded, trimmed, cut to the 740 limit, or null when nothing is left. */
export const cleanObjectiveText = (raw: unknown): string | null => clean(typeof raw === "string" ? raw : null, OBJECTIVE_TEXT_MAX);

/**
 * The 740 columns for a new session, or null when the caller asked for none of them (so a plain Learn session is
 * written exactly as before, and works where 740 is absent). An outcome is kept only with a competency.
 * The caller screens free text for patient identifiers first, as it does a topic (414).
 */
export function studyFields(input: StudyFieldsInput, competencyId: string | null): StudyFields | null {
  if (input.connected === undefined && input.objectiveOutcome === undefined && input.objectiveText === undefined) return null;
  return {
    connected: input.connected === true,
    objective_outcome: competencyId ? clean(input.objectiveOutcome, OBJECTIVE_OUTCOME_MAX) : null,
    objective_text: clean(input.objectiveText, OBJECTIVE_TEXT_MAX),
  };
}
