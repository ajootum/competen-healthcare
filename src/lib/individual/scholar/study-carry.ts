// ── CONNECTED STUDY SESSIONS: CARRYING THE FOCUS (SCHOLAR-SESSION-AI-02 slice B) ── pure, client and server ─────────
//
// How one study session (a connected 414 Learn session, owner D1) travels across Learn, Revise, Apply and Evaluate:
//   withStudy      adds ?study=<id> to a link, and nothing at all when there is no valid session id
//   studyScopeOf   the session's focus as the existing scope controls understand it (materials, sections, topic, competency)
//   *Prefill       that focus mapped onto each page's EXISTING scope control (nothing new is chosen for the learner)
//   studyStages    the four stage chips of the session bar, with their progress marks, from the links and the steps
//
// ⚠ IMPORTS NOTHING THAT TOUCHES A DATABASE OR AN AI: the tab bar and the pages read it, and stage navigation makes
// zero AI calls. Not a "use client" module, so a Server Component may call it.
// ⚠ D5. Everything here is a learning aid. A progress mark says an activity was done in this session, never how well,
// and nothing here is assessment evidence, verified competence or a Passport record.

import { experienceHref } from "@/lib/individual/experiences";
import { STUDY_SPACES, type StudyLinkKind, type StudySpace } from "./study-session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isStudyId = (x: unknown): x is string => typeof x === "string" && UUID.test(x);

/**
 * The link with ?study=<id> added (or replaced), its other parameters and its #fragment kept. Without a valid id the
 * link is returned exactly as given, so a page with no study session renders the same links as before.
 */
export function withStudy(href: string, studyId: string | null | undefined): string {
  if (!isStudyId(studyId)) return href;
  const hashAt = href.indexOf("#");
  const hash = hashAt >= 0 ? href.slice(hashAt) : "";
  const base = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const qAt = base.indexOf("?");
  const path = qAt >= 0 ? base.slice(0, qAt) : base;
  const params = new URLSearchParams(qAt >= 0 ? base.slice(qAt + 1) : "");
  params.set("study", studyId);
  return `${path}?${params.toString()}${hash}`;
}

// ── the focus ──

export type StudyScopeKind = "section" | "document" | "documents" | "topic" | "competency";
export type StudyScope = {
  kind: StudyScopeKind; materialIds: string[]; chunkIds: string[]; topic: string | null; competencyId: string | null; outcome: string | null;
};

/** The session's focus: its stored scope kind, topic, competency and outcome, and the materials and sections of its steps (in order). */
export function studyScopeOf(
  session: { scopeKind: StudyScopeKind; topic: string | null; competencyId: string | null; objectiveOutcome?: string | null },
  steps: readonly { sections: readonly { chunkId: string; materialId: string }[] }[],
): StudyScope {
  const chunkIds: string[] = [], materialIds: string[] = [];
  for (const s of steps) for (const x of s.sections) {
    if (!chunkIds.includes(x.chunkId)) chunkIds.push(x.chunkId);
    if (!materialIds.includes(x.materialId)) materialIds.push(x.materialId);
  }
  return {
    kind: session.scopeKind, materialIds, chunkIds, topic: session.topic?.trim() || null, competencyId: session.competencyId ?? null,
    outcome: session.competencyId ? session.objectiveOutcome ?? null : null,
  };
}

/**
 * Owner D2: a competency study session's objective is one of that competency's programme outcomes -- the one asked
 * for when it is one of them, otherwise the first. None recorded: null, and the session is studied by its competency.
 */
export function chooseOutcome(requested: unknown, outcomes: readonly string[]): string | null {
  if (typeof requested === "string" && outcomes.includes(requested)) return requested;
  return outcomes.find(o => typeof o === "string" && o.trim().length > 0) ?? null;
}

/** What the page can actually offer: the learner's materials and catalogue competencies. A focus outside them is not pre-chosen. */
export type StudyChoices = { materialIds: readonly string[]; competencyIds: readonly string[] };

/** Revise (Practice and Flashcards): the existing "what to revise" choice -- chosen materials, a topic or a competency. */
export type RevisePrefill = { kind: "documents"; materialIds: string[] } | { kind: "topic"; topic: string } | { kind: "competency"; competencyId: string };
const MAX_MATERIALS = 10;

export function revisePrefill(scope: StudyScope | null, have: StudyChoices): RevisePrefill | null {
  if (!scope) return null;
  if (scope.kind === "competency" && scope.competencyId && have.competencyIds.includes(scope.competencyId)) return { kind: "competency", competencyId: scope.competencyId };
  if (scope.kind === "topic" && scope.topic) return { kind: "topic", topic: scope.topic.slice(0, 120) };
  const m = scope.materialIds.filter(id => have.materialIds.includes(id)).slice(0, MAX_MATERIALS);
  if (m.length) return { kind: "documents", materialIds: m };
  return scope.topic ? { kind: "topic", topic: scope.topic.slice(0, 120) } : null;
}

/** Flashcards' Create More: the same focus, on the row that already exists for it (from my notes, a competency, a topic). */
export function flashcardPrefill(scope: StudyScope | null, have: StudyChoices): { open: "notes" | "topic" | "competency"; materialIds: string[]; topic: string; competencyId: string } | null {
  const p = revisePrefill(scope, have);
  if (!p) return null;
  return p.kind === "documents" ? { open: "notes", materialIds: p.materialIds, topic: "", competencyId: "" }
    : p.kind === "topic" ? { open: "topic", materialIds: [], topic: p.topic, competencyId: "" }
      : { open: "competency", materialIds: [], topic: "", competencyId: p.competencyId };
}

/** Adaptive exams: chosen materials, a topic, or chosen competencies (the one of this session). */
export function adaptivePrefill(scope: StudyScope | null, have: StudyChoices): { kind: "documents"; materialIds: string[] } | { kind: "topic"; topic: string } | { kind: "competencies"; competencyIds: string[] } | null {
  const p = revisePrefill(scope, have);
  if (!p) return null;
  return p.kind === "competency" ? { kind: "competencies", competencyIds: [p.competencyId] } : p;
}

/**
 * Apply's clinical reasoning start: Apply from the section (the existing ?section= preset) for a one-section session,
 * otherwise a case from the session's competency, otherwise from its first material.
 */
/** Where Apply was opened from (?from=): Learn, Teach me, Revision or the study journey. Anything else is Teach me. */
export const CASE_FROM = ["learn", "teach", "revision", "journey"] as const;
export type CaseFrom = (typeof CASE_FROM)[number];
export const parseCaseFrom = (raw: unknown): CaseFrom => (typeof raw === "string" && (CASE_FROM as readonly string[]).includes(raw) ? raw as CaseFrom : "teach");

export type CasePrefill = { chunkId: string; from: CaseFrom } | { entry: "competency"; competencyId: string } | { entry: "notes"; materialId: string };
export function casePrefill(scope: StudyScope | null, have: StudyChoices): CasePrefill | null {
  if (!scope) return null;
  if (scope.kind === "section" && scope.chunkIds[0]) return { chunkId: scope.chunkIds[0], from: "teach" };
  if (scope.competencyId && have.competencyIds.includes(scope.competencyId)) return { entry: "competency", competencyId: scope.competencyId };
  const m = scope.materialIds.find(id => have.materialIds.includes(id));
  return m ? { entry: "notes", materialId: m } : null;
}

/** OSCE practice: the existing station filters, by the session's competency, else its topic. Only when the learner set none. */
export function osceFilterPrefill(scope: StudyScope | null): { competency: string } | { q: string } | null {
  if (!scope) return null;
  if (scope.competencyId) return { competency: scope.competencyId };
  return scope.topic ? { q: scope.topic.slice(0, 120) } : null;
}

/** Evaluate: EvaluationStart's default scope (the existing scope kinds). The learner still chooses and starts it. */
export type EvaluationDefault =
  | { kind: "outcome"; competencyId: string; outcome: string } | { kind: "competency"; competencyId: string } | { kind: "topic"; topic: string }
  | { kind: "document"; materialId: string } | { kind: "documents"; materialIds: string[] };
export function evaluationPrefill(scope: StudyScope | null, have: StudyChoices): EvaluationDefault | null {
  if (!scope) return null;
  if (scope.competencyId && have.competencyIds.includes(scope.competencyId))
    return scope.outcome ? { kind: "outcome", competencyId: scope.competencyId, outcome: scope.outcome } : { kind: "competency", competencyId: scope.competencyId };
  if (scope.kind === "topic" && scope.topic) return { kind: "topic", topic: scope.topic.slice(0, 120) };
  const m = scope.materialIds.filter(id => have.materialIds.includes(id)).slice(0, MAX_MATERIALS);
  if (m.length === 1) return { kind: "document", materialId: m[0] };
  if (m.length > 1) return { kind: "documents", materialIds: m };
  return scope.topic ? { kind: "topic", topic: scope.topic.slice(0, 120) } : null;
}

// ── the session bar ──

export const STUDY_SPACE_LABEL: Record<StudySpace, string> = { learn: "Learn", revise: "Revise", apply: "Apply", evaluate: "Evaluate" };
/** Which stage each linked activity belongs to. An exam paper is studied in Apply. */
export const LINK_SPACE: Record<StudyLinkKind, StudySpace> = {
  revision_session: "revise", flashcard_deck: "revise", osce_attempt: "apply", case_session: "apply", exam_paper: "apply", evaluation: "evaluate",
};
export type StageMark = "none" | "started" | "done";
export type StudyStage = { space: StudySpace; label: string; mark: StageMark; detail: string };

/**
 * The four chips. Learn: done when the session is completed, otherwise started, with the step reached. Revise and
 * Apply: started once an activity of theirs is linked (how many). Evaluate: done once an evaluation is linked.
 * A mark says something was done in this session, never how well (D5).
 */
export function studyStages(
  session: { status: "active" | "completed"; currentStep: number },
  stepCount: number,
  links: readonly { kind: StudyLinkKind }[] | null,
): StudyStage[] {
  const count = (space: StudySpace) => (links ?? []).filter(l => LINK_SPACE[l.kind] === space).length;
  return STUDY_SPACES.map(space => {
    const label = STUDY_SPACE_LABEL[space];
    if (space === "learn") {
      if (session.status === "completed") return { space, label, mark: "done", detail: "Learning finished" };
      return { space, label, mark: "started", detail: stepCount > 0 ? `Step ${Math.min(session.currentStep + 1, stepCount)} of ${stepCount}` : "Started" };
    }
    const n = count(space);
    if (space === "evaluate") return { space, label, mark: n ? "done" : "none", detail: n ? (n === 1 ? "1 evaluation" : `${n} evaluations`) : "Not yet" };
    return { space, label, mark: n ? "started" : "none", detail: n ? (n === 1 ? "1 activity" : `${n} activities`) : "Not yet" };
  });
}

/** The page of each stage, carrying the session. Learn reopens the session itself. */
export function stageHref(space: StudySpace, id: string): string {
  return withStudy(space === "learn" ? `${experienceHref("scholar", "study/learn")}?session=${id}` : experienceHref("scholar", `study/${space}`), id);
}
/** Ask Personal AI: for now the session's own Learn ask panel (slice C gives the tutor the session's context). */
export const askHref = (id: string) => withStudy(`${experienceHref("scholar", "study/learn")}?session=${id}&panel=ask`, id);
/** Owner D3, said beside Ask. */
export const STUDY_DEVICE_NOTE = "The conversation stays on this device. Your progress, saved explanations and attempts are kept across your devices.";

/** The bar, as the tab bar receives it from the server (serialisable). */
export type StudyBarView = {
  id: string; title: string; objective: string | null; current: StudySpace | null; status: "active" | "completed"; stages: StudyStage[];
};
