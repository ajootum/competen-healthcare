// ── SALE-2026-11 R4 (SALE-13 / SALE-14): APPLICATION EVIDENCE AND TRACEABLE LEARNING EVIDENCE ── pure, client-safe, NO AI ──
//
// A LOGICAL view over records that already exist. Nothing here is stored, scored again or sent anywhere:
//   - a completed clinical case (810 individual_scholar_case_attempt_snapshot: its decisions, their reasoning dimension, the
//     handover marks and the deterioration timeline's escalation windows, with any 810 correction applied),
//   - a finished OSCE practice run (720 individual_scholar_osce_attempt on a station),
//   - a lesson check or practice answer whose 990/991 snapshot names the competency it was mapped to.
// Each becomes ONE evidence record with the competencies it links to, the framework version and the mapping status (published
// or draft) at the time it was done where that was recorded, and "not recorded" where it was not. Nothing is filled in.
//
// SALE-13: the case and OSCE records are APPLICATION evidence, split by the skill each part exercised (clinical reasoning,
//   prioritisation, interpreting findings, evolving scenarios, structured handover, recognising deterioration, practical
//   simulation). The skill comes from what the case author declared (the decision's reasoning dimension, a handover decision, an
//   escalation window): never guessed from the text.
// SALE-14: My Competencies shows three views, kept apart: self-assessment (what the learner believes), learning evidence (these
//   records) and verified competence (an authorised verification only).
//
// ⚠ NEVER COMPETENCE, NEVER A STAGE. Every record is formative. Nothing here produces, reads into or changes a verified
//   competency, a Benner or competency stage, an assessment outcome or a Passport record. The verified view is built from the
//   verification facts it is given and from nothing else (application-evidence.test.ts, the stage guard).
// ⚠ DRAFT IS NEVER VALIDATED. A record on a draft mapping (framework version not yet published) is labelled as such every time
//   it is shown, and is never counted as published evidence (SQIE-CLOSE-2026-11 owner decision 3).
// ⚠ WORDS, NOT SCORES. Each skill gets the same evidence words as the learning state (R1): no percentage, no overall score.
// ⚠ EACH PROFESSION'S FRAMEWORK STAYS ITS OWN. A record links to the competency ids its case, station or question named; no
//   competency is mapped across frameworks here.

import { DEFAULT_STATE_THRESHOLDS, EVIDENCE_WORD_LABEL, STATE_MARKING_WEIGHT, type EvidenceWord, type StateMarking, type StateThresholds } from "./learning-state";

export const APPLICATION_SKILLS = ["reasoning", "prioritisation", "interpretation", "evolving", "handover", "deterioration", "practical"] as const;
export type ApplicationSkill = (typeof APPLICATION_SKILLS)[number];
export const APPLICATION_SKILL_LABEL: Record<ApplicationSkill, string> = {
  reasoning: "Clinical reasoning and decisions",
  prioritisation: "Prioritisation",
  interpretation: "Interpreting patient findings",
  evolving: "Reassessing an evolving patient",
  handover: "Structured handover",
  deterioration: "Recognising and escalating deterioration",
  practical: "Practical simulation (OSCE)",
};

export const APPLICATION_NOTE = "Practice in clinical cases, OSCE stations and simulations: learning evidence of applying what you learned. It is not an assessment and not verified competence, and no result here sets a competency stage.";
export const DRAFT_MAPPING_LABEL = "Draft mapping, publication pending: not validated competency evidence";
export const MAPPING_NOT_RECORDED = "Framework version not recorded when this was done";
export const LEARNING_EVIDENCE_NOTE = "Traceable records of your own learning activity, each with the competency it was linked to, the framework version and whether that mapping was published. Learning evidence, never verified competence.";
export const VERIFIED_ONLY_NOTE = "Only an authorised verification process sets this. Practice results, self-assessments and learning evidence never do, and none of them sets a competency stage.";

export type EvidenceSource = "case" | "osce" | "question";
export const EVIDENCE_SOURCE_WORD: Record<EvidenceSource, string> = { case: "Clinical case", osce: "OSCE practice", question: "Question" };
export type EvidenceOutcomeWord = "done well" | "partly" | "not yet" | "not marked";

/** One competency a record links to. `recorded`: the framework version and status were kept when the activity was done. */
export type CompetencyLink = {
  competencyId: string; frameworkId: string | null; frameworkVersion: string | null;
  mappingStatus: "published" | "draft" | null; objective: string | null; recorded: boolean;
};
export type EvidenceRecord = {
  id: string; source: EvidenceSource; title: string; at: string;
  /** The activity, not the attempt: a case (own:<case> / lib:<version>), an OSCE station, a question. Two attempts at one activity are one activity. */
  activityId: string;
  /** 0..1 over the marked parts, null when nothing was marked. */
  outcome: number | null; marking: StateMarking;
  competencies: CompetencyLink[];
  /** SALE-13: the skills the activity exercised, each with its own outcome (case and OSCE only; a question has none). */
  skills: { skill: ApplicationSkill; outcome: number | null }[];
  /** The learner's material it was made from, where there is one (a private case, an OSCE station): for Progress by topic. */
  materialId: string | null; chunkId: string | null;
  /** Safety criteria the learner's answers broke (case only). */
  safetyBroken: number;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const right = (o: number | null) => o !== null && o >= 0.75;
export const outcomeWord = (o: number | null): EvidenceOutcomeWord => (o === null ? "not marked" : o >= 0.75 ? "done well" : o >= 0.25 ? "partly" : "not yet");
const markingOf = (m: string | null | undefined): StateMarking =>
  m === "deterministic" ? "code" : m === "ai_evaluation" ? "ai_evaluation" : m === "self_graded" ? "self" : m === "unmarked" ? "unmarked" : "code";

// ── CASES ──

/** The reasoning dimension (blueprint DEFAULT_DIMENSIONS, HQ scholarCaseDimensions) each skill reads. A dimension not listed is clinical reasoning. */
export const DIMENSION_SKILL: Readonly<Record<string, ApplicationSkill>> = {
  decision: "reasoning", interpretation: "interpretation", prioritisation: "prioritisation",
  reassessment: "evolving", recognition: "deterioration", escalation: "deterioration",
};
/** Pure. The skill one case decision exercised: a handover is handover; otherwise the dimension the author declared; else clinical reasoning. */
export const skillOfDecision = (d: { kind?: string | null; dimension?: string | null }): ApplicationSkill =>
  d.kind === "handover" ? "handover" : (d.dimension && DIMENSION_SKILL[d.dimension]) || "reasoning";

export type CaseDecisionInput = { id: string; kind?: string | null; dimension?: string | null; marking?: string | null; correct: boolean | null; score: number | null; safety?: readonly string[] | null };
/** Pure. A decision's outcome: its score, else right/wrong; null when unmarked. A broken safety criterion makes it "not yet" (0). */
export function decisionOutcome(d: Pick<CaseDecisionInput, "marking" | "correct" | "score" | "safety">): number | null {
  if (d.marking === "unmarked") return null;
  if ((d.safety ?? []).length > 0) return 0;
  if (typeof d.score === "number" && Number.isFinite(d.score)) return clamp01(d.score);
  if (d.correct === true) return 1;
  if (d.correct === false) return 0;
  return null;
}

export type CaseRecordInput = {
  snapshotId: string; caseRef: string; title: string; completedAt: string; materialId: string | null;
  decisions: readonly CaseDecisionInput[];
  /** 810 corrections, oldest first: the latest per decision replaces its result (the original is never overwritten in the record). */
  corrections?: readonly { decisionPointId: string; correctedOutcome: string; correctedScore: number | null }[];
  /** CE-04C escalation windows (formative 0..1 each), where the deterioration timeline ran. */
  escalations?: readonly { score?: number | null; recognised?: boolean; timeliness?: string }[] | null;
  competencies: CompetencyLink[];
};

/** Pure. One completed case as an evidence record, split by skill. */
export function caseRecord(x: CaseRecordInput): EvidenceRecord {
  const latest = new Map<string, { correctedOutcome: string; correctedScore: number | null }>();
  for (const c of x.corrections ?? []) latest.set(c.decisionPointId, c);
  const per = new Map<ApplicationSkill, (number | null)[]>();
  const add = (s: ApplicationSkill, o: number | null) => per.set(s, [...(per.get(s) ?? []), o]);
  let marking: StateMarking = "unmarked";
  let safetyBroken = 0;
  const rank: Record<StateMarking, number> = { unmarked: 0, self: 1, ai_evaluation: 2, code: 3 };
  for (const d of x.decisions) {
    const c = latest.get(d.id);
    const o = c ? (c.correctedOutcome === "correct" ? 1 : c.correctedScore !== null ? clamp01(c.correctedScore) : c.correctedOutcome === "partial" ? 0.5 : 0) : decisionOutcome(d);
    safetyBroken += (d.safety ?? []).length;
    add(skillOfDecision(d), o);
    // A case's marking word is its weakest kind of marking among the marked decisions: an AI-evaluated or self-reviewed part never reads as app-marked.
    if (o !== null) { const m = markingOf(d.marking); if (marking === "unmarked" || rank[m] < rank[marking]) marking = m; }
  }
  for (const e of x.escalations ?? []) {
    const o = typeof e.score === "number" && Number.isFinite(e.score) ? clamp01(e.score) : e.timeliness === "pending" ? null : e.recognised ? 0.5 : 0;
    add("deterioration", o);
    if (o !== null && marking === "unmarked") marking = "code";
  }
  const mean = (os: (number | null)[]) => { const m = os.filter((o): o is number => o !== null); return m.length ? m.reduce((a, b) => a + b, 0) / m.length : null; };
  const skills = APPLICATION_SKILLS.filter(s => per.has(s)).map(s => ({ skill: s, outcome: mean(per.get(s)!) }));
  const all = [...per.values()].flat();
  return {
    id: `case:${x.snapshotId}`, activityId: x.caseRef || `case:${x.snapshotId}`, source: "case", title: x.title || "Clinical case", at: x.completedAt, outcome: mean(all), marking,
    competencies: x.competencies, skills, materialId: x.materialId, chunkId: null, safetyBroken,
  };
}

// ── OSCE ──

export function osceRecord(x: { attemptId: string; stationId: string; title: string; finishedAt: string; score: number | null; marking: string | null; materialId: string | null; chunkId: string | null; competencies: CompetencyLink[] }): EvidenceRecord {
  const o = typeof x.score === "number" && Number.isFinite(x.score) ? clamp01(x.score) : null;
  return {
    id: `osce:${x.attemptId}`, activityId: `osce:${x.stationId}`, source: "osce", title: x.title || "OSCE station", at: x.finishedAt, outcome: o,
    marking: o === null ? "unmarked" : x.marking === "ai_evaluation" ? "ai_evaluation" : "self", competencies: x.competencies,
    skills: [{ skill: "practical", outcome: o }], materialId: x.materialId, chunkId: x.chunkId, safetyBroken: 0,
  };
}

// ── QUESTIONS (990/991 snapshots) ──

export function questionRecord(x: { attemptId: string; questionId: string; stem: string | null; assessedAt: string; outcome: string; score: number | null; marking: string | null; competencies: CompetencyLink[] }): EvidenceRecord {
  const o = x.outcome === "unmarked" ? null : x.outcome === "correct" ? 1 : typeof x.score === "number" && Number.isFinite(x.score) ? clamp01(x.score) : x.outcome === "partial" ? 0.5 : 0;
  const stem = (x.stem ?? "").replace(/\s+/g, " ").trim();
  return {
    id: `question:${x.attemptId}`, activityId: `question:${x.questionId}`, source: "question", title: stem ? (stem.length > 120 ? `${stem.slice(0, 119)}…` : stem) : "A question you answered",
    at: x.assessedAt, outcome: o, marking: o === null ? "unmarked" : markingOf(x.marking), competencies: x.competencies, skills: [], materialId: null, chunkId: null, safetyBroken: 0,
  };
}

// ── PROVENANCE ──

type ProvenanceLike = { id: string; framework_id?: string | null; framework_version?: string | null; mapping_status?: string | null; objective?: string | null };
/** Pure. Links from provenance kept with the record (990/991 shape). An entry without a version or status says so: never guessed. */
export const linksFromProvenance = (p: readonly ProvenanceLike[], recorded: boolean): CompetencyLink[] =>
  p.filter(x => typeof x?.id === "string" && x.id).map(x => ({
    competencyId: x.id, frameworkId: x.framework_id ?? null, frameworkVersion: x.framework_version ?? null,
    mappingStatus: x.mapping_status === "published" || x.mapping_status === "draft" ? x.mapping_status : null,
    objective: typeof x.objective === "string" && x.objective.trim() ? x.objective.trim().slice(0, 300) : null, recorded,
  }));

/** Pure. One link in words. A draft mapping always says it is not validated evidence; a link read now (not kept then) says so. */
export function mappingLine(l: CompetencyLink): string {
  const status = l.mappingStatus === "published" ? "published mapping" : l.mappingStatus === "draft" ? DRAFT_MAPPING_LABEL.toLowerCase() : "publication status not recorded";
  const version = l.frameworkVersion ? `framework version ${l.frameworkVersion}` : "framework version not recorded";
  return l.recorded ? `${version} (${status})` : `${version} as it is now (${status}); not recorded when this was done`;
}
export const isDraft = (l: CompetencyLink) => l.mappingStatus === "draft";

// ── SALE-13: APPLICATION BY SKILL ──

export type SkillSummary = { skill: ApplicationSkill; label: string; word: EvidenceWord; wordLabel: string; activities: number; doneWell: number; lastAt: string | null; summary: string };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Pure. Per skill, from the case and OSCE records: how many different activities exercised it, how many of them went well (their
 * latest attempt), and the same evidence word the learning state uses (R1 rule A1: one activity is not enough evidence; different
 * activities are needed). Skills with nothing are left out. No percentage.
 */
export function applicationBySkill(records: readonly EvidenceRecord[], thresholds?: Partial<StateThresholds>): SkillSummary[] {
  const T = { ...DEFAULT_STATE_THRESHOLDS, ...thresholds };
  const out: SkillSummary[] = [];
  for (const skill of APPLICATION_SKILLS) {
    const rows = records.filter(r => r.source !== "question").flatMap(r => r.skills.filter(s => s.skill === skill).map(s => ({ r, outcome: s.outcome })));
    if (!rows.length) continue;
    // The "activity" is the case or the station, not the attempt: the same case done twice is one activity, read at its latest attempt.
    const activityOf = (r: EvidenceRecord) => r.activityId;
    const latest = new Map<string, { at: string; outcome: number | null; marking: StateMarking }>();
    for (const { r, outcome } of rows) { const k = activityOf(r); const l = latest.get(k); if (!l || r.at > l.at) latest.set(k, { at: r.at, outcome, marking: r.marking }); }
    const marked = [...latest.values()].filter(v => v.outcome !== null && v.marking !== "unmarked");
    const well = marked.filter(v => right(v.outcome));
    const weight = well.reduce((n, v) => n + STATE_MARKING_WEIGHT[v.marking], 0);
    const word: EvidenceWord = !marked.length ? "thin" : well.length < T.distinctQuestions ? "thin" : weight >= 2 * T.minEvidence && well.length > T.distinctQuestions ? "stronger" : "some";
    const lastAt = rows.map(x => x.r.at).sort().pop() ?? null;
    out.push({
      skill, label: APPLICATION_SKILL_LABEL[skill], word, wordLabel: EVIDENCE_WORD_LABEL[word], activities: latest.size, doneWell: well.length, lastAt,
      summary: !marked.length ? `${plural(latest.size, "activity", "activities")} with nothing marked yet.`
        : `${plural(well.length, "different activity", "different activities")} done well out of ${latest.size}.`
          + (well.length < T.distinctQuestions ? ` One activity is limited evidence: about ${T.distinctQuestions} different ones done well are needed.` : ""),
    });
  }
  return out;
}

// ── SALE-14: THE THREE VIEWS ON MY COMPETENCIES ──

export type SelfViewInput = { rating: number | null; descriptor: string | null; latestAt?: string | null } | null;
export type VerificationInput = { state: "not_yet" | "verified" | "unreadable"; line: string; detail: string | null };
export type ThreeViewCompetency = { id: string; code: string | null; title: string; framework?: string | null };

export type CompetencyThreeViews = {
  competency: ThreeViewCompetency;
  /** What the learner believes they can do: their own self-assessment only. */
  self: { state: "rated" | "none"; line: string };
  /** What their learning records show: traceable records, newest first, with their mapping. */
  learning: { state: "records" | "none"; line: string; records: { record: EvidenceRecord; link: CompetencyLink; outcome: EvidenceOutcomeWord; mapping: string; draft: boolean }[]; total: number; published: number; draft: number; notRecorded: number };
  /** What an authorised verification process has established: the verification facts only. */
  verified: VerificationInput;
};

/**
 * Pure. The three views per competency, each from its own source and nothing else:
 *   self      <- the learner's own self-assessment rating (never changed by evidence);
 *   learning  <- the evidence records that name this competency (a draft mapping is counted apart and labelled);
 *   verified  <- the verification fact passed in for it (ONLY). No record, score or rating can change it, and no stage is produced.
 */
export function competencyThreeViews(input: {
  competencies: readonly ThreeViewCompetency[];
  self: ReadonlyMap<string, SelfViewInput>;
  scaleMax: number | null;
  records: readonly EvidenceRecord[];
  verification: (competencyId: string) => VerificationInput;
  maxRecords?: number;
}): CompetencyThreeViews[] {
  const max = input.maxRecords ?? 8;
  const byComp = new Map<string, { record: EvidenceRecord; link: CompetencyLink }[]>();
  for (const r of input.records) for (const l of r.competencies) byComp.set(l.competencyId, [...(byComp.get(l.competencyId) ?? []), { record: r, link: l }]);
  return input.competencies.map(c => {
    const s = input.self.get(c.id) ?? null;
    const self = s && s.rating !== null
      ? { state: "rated" as const, line: `You rated yourself ${s.rating}${input.scaleMax ? ` of ${input.scaleMax}` : ""}${s.descriptor ? `: ${s.descriptor}` : ""}. Self-reported, not independently verified.` }
      : { state: "none" as const, line: "You have not rated yourself on this competency." };
    const mine = [...(byComp.get(c.id) ?? [])].sort((a, b) => b.record.at.localeCompare(a.record.at));
    const draft = mine.filter(m => isDraft(m.link)).length;
    const notRecorded = mine.filter(m => !m.link.recorded || m.link.mappingStatus === null).length;
    const published = mine.filter(m => m.link.mappingStatus === "published").length;
    const learning = mine.length
      ? {
        state: "records" as const,
        line: `${plural(mine.length, "learning record")}${draft ? `, ${draft} on a draft mapping (not validated evidence)` : ""}. Learning evidence, not verified competence.`,
        records: mine.slice(0, max).map(m => ({ ...m, outcome: outcomeWord(m.record.outcome), mapping: mappingLine(m.link), draft: isDraft(m.link) })),
        total: mine.length, published, draft, notRecorded,
      }
      : { state: "none" as const, line: "No learning activity is linked to this competency yet.", records: [], total: 0, published: 0, draft: 0, notRecorded: 0 };
    return { competency: c, self, learning, verified: input.verification(c.id) };
  });
}
