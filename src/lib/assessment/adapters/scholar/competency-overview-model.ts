import { buildHistory, deltaText, type Attempt, type CompetencyHistory } from "./history";
import { compareBands, differs, evidenceBand, feedbackText, selfBand, type Band, type CompareState, type PracticeEvidence } from "./compare";
import type { Finding } from "./findings";
import { NOT_VERIFIED_LINE, NO_MAPPED_EVIDENCE, VERIFICATION_UNREADABLE } from "./vocab";

// ── MY COMPETENCIES OVERVIEW: THE VIEW MODEL ── Checklist Studio S3, owner addendum 5 ────────────────────────────────
//
// Pure. Four classes per competency, kept apart and never merged into one figure:
//   1. HOW I RATE MYSELF         from the learner's own submitted self instances (asmt), labelled "Self-reported - Not independently verified"
//   2. WHAT MY LEARNING EVIDENCE SHOWS   from the existing competency progress readers, ONLY for a competency a section of the
//                                learner's notes is linked to (an accepted link). An unlinked competency has no evidence row at all.
//   3. COMPARE                   the two beside each other, with fixed wording where they differ. It never changes a rating.
//   4. VERIFIED COMPETENCY       from the Passport's verifications. Without a record it is "Not yet verified". A self-assessment never produces it.
//
// No duplicate score, engine or history is built here: ratings come in as the history of asmt instances, evidence as the rows
// loadCompetencyProfile already read, and verification as the Passport's own items.

export type OverviewCompetency = {
  id: string; code: string | null; title: string; domain: string;
  /** The level the programme expects (the scale's own ordinal), or null when it sets none. */
  expected: { score: number; label: string } | null;
  contentStatus: "approved" | "draft" | "unreviewed";
  /** False for a competency the learner rated themselves on that their programme does not offer. Absent means true. */
  inProgramme?: boolean;
  framework?: string | null;
};

/** The small neutral note on a competency outside the learner's programme. It says nothing about the competency's status. */
export const NOT_IN_PROGRAMME_NOTE = "Not in your current programme";
export const EXPECTED_NOT_SET = "Expected level: not set for your programme";

export type ProgressFact = {
  sectionsAccepted: number; sectionsProposed: number; questions: number; answered: number; latestAccuracy: number | null;
  status: "no_notes" | "notes_linked" | "practising";
};
export type ActivityFact = { actions: number; lastVerdict: string | null; lastAt: string };
export type VerificationFact = { competencyId: string; outcomeLabel: string; issuer: string; decidedAt: string; current: boolean };

export type OverviewInput = {
  competencies: readonly OverviewCompetency[];
  attempts: ReadonlyMap<string, readonly Attempt[]>;
  progress: ReadonlyMap<string, ProgressFact>;
  activity: ReadonlyMap<string, ActivityFact> | null;
  /** null: the Passport could not be read. */
  verifications: readonly VerificationFact[] | null;
  /** competency id -> the instrument (code) a learner can start to rate themselves on it. */
  startable: ReadonlyMap<string, { code: string; name: string }>;
  /** competency id -> findings of the latest submitted attempt. */
  findings: ReadonlyMap<string, readonly Finding[]>;
  /** The highest ordinal on the self-assessment scale (6 on the 0-6 scale). */
  scaleMax: number | null;
  /** competency id -> the learner's own open (not yet submitted) self instance, so the row can offer Continue. */
  openSelf?: ReadonlyMap<string, string>;
};

export type SelfPanel = {
  history: CompetencyHistory;
  rating: number | null; descriptor: string | null; range: string | null;
  delta: number | null; deltaText: string | null; trend: CompetencyHistory["trend"];
  /** Rating at the points of the trend, oldest first (null where an attempt rated nothing). */
  points: (number | null)[];
  strengths: Finding[]; gaps: Finding[];
  latestInstanceId: string | null;
  /** A self-assessment started and not yet submitted that rates this competency. */
  openInstanceId: string | null;
  /** Review the latest report, or repeat the self-assessment. */
  canRepeat: { code: string; name: string } | null;
  unjudged: number; unanswered: number;
};
export type EvidencePanel =
  | { state: "none"; text: string }
  | { state: "evidence"; sectionsAccepted: number; questions: number; answered: number; accuracy: number | null; outcome: string; lastAt: string | null; lastVerdict: string | null; actions: number };
export type VerificationPanel = { state: "not_yet" | "verified" | "unreadable"; line: string; detail: string | null };

export type OverviewRow = {
  competency: OverviewCompetency;
  self: SelfPanel | null;
  evidence: EvidencePanel;
  compare: { state: CompareState; selfBand: Band | null; evidenceBand: Band | null; text: string; differs: boolean };
  verification: VerificationPanel;
  /** The row has something to show in at least one class (a self rating, an instrument to start, or linked evidence). */
  active: boolean;
};

const evidencePanel = (p: ProgressFact | undefined, a: ActivityFact | undefined): EvidencePanel => {
  // Unmapped activities never appear: a competency with no accepted link, and no activity recorded against a link, has no evidence.
  if (!p || (p.sectionsAccepted === 0 && !a)) return { state: "none", text: NO_MAPPED_EVIDENCE };
  const outcome = p.latestAccuracy !== null
    ? `${p.latestAccuracy}% right on the latest try, ${p.answered} of ${p.questions} practice question${p.questions === 1 ? "" : "s"} answered`
    : p.questions > 0 ? `${p.answered} of ${p.questions} practice question${p.questions === 1 ? "" : "s"} answered` : "Notes linked, no practice question answered yet";
  return { state: "evidence", sectionsAccepted: p.sectionsAccepted, questions: p.questions, answered: p.answered, accuracy: p.latestAccuracy, outcome, lastAt: a?.lastAt || null, lastVerdict: a?.lastVerdict ?? null, actions: a?.actions ?? 0 };
};

export const verificationPanel = (competencyId: string, v: readonly VerificationFact[] | null): VerificationPanel => {
  if (v === null) return { state: "unreadable", line: VERIFICATION_UNREADABLE, detail: null };
  const mine = v.filter(x => x.competencyId === competencyId).sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  const current = mine.find(x => x.current);
  if (!current) return { state: "not_yet", line: NOT_VERIFIED_LINE, detail: null };
  return { state: "verified", line: `Verified competency: ${current.outcomeLabel}`, detail: `Issued by ${current.issuer}, ${current.decidedAt.slice(0, 10)}` };
};

export function buildOverview(input: OverviewInput): { rows: OverviewRow[]; verifiedCount: number | null; topLine: string } {
  const rows: OverviewRow[] = input.competencies.map(c => {
    const history = buildHistory(input.attempts.get(c.id) ?? []);
    const latest = history.latest?.rating ?? null;
    const findings = input.findings.get(c.id) ?? [];
    const startable = input.startable.get(c.id) ?? null;
    const openInstanceId = input.openSelf?.get(c.id) ?? null;
    const self: SelfPanel | null = history.attempts.length || startable || openInstanceId ? {
      history, rating: latest?.rating ?? null, descriptor: latest?.descriptor ?? null,
      range: latest && latest.low !== null && latest.high !== null && latest.rated > 1 ? `${latest.low} to ${latest.high} across ${latest.rated} criteria` : null,
      delta: history.delta, deltaText: deltaText(history.delta), trend: history.trend,
      points: history.attempts.map(a => a.rating.rating),
      strengths: findings.filter(f => f.kind === "met"), gaps: findings.filter(f => f.kind !== "met"),
      latestInstanceId: history.latest?.instanceId ?? null, openInstanceId, canRepeat: startable,
      unjudged: latest?.unjudged ?? 0, unanswered: latest?.unanswered ?? 0,
    } : null;
    const evidence = evidencePanel(input.progress.get(c.id), input.activity?.get(c.id));
    const sb = selfBand(self?.rating ?? null, input.scaleMax);
    const eb = evidence.state === "evidence" ? evidenceBand({ latestAccuracy: evidence.accuracy, answered: evidence.answered, sectionsAccepted: evidence.sectionsAccepted }) : null;
    const state = compareBands(sb, eb);
    const verification = verificationPanel(c.id, input.verifications);
    return {
      competency: c, self, evidence,
      compare: { state, selfBand: sb, evidenceBand: eb, text: feedbackText(state, c.title), differs: differs(state) },
      verification, active: !!self || evidence.state === "evidence",
    };
  });
  const verifiedCount = input.verifications === null ? null : rows.filter(r => r.verification.state === "verified").length;
  const topLine = verifiedCount === null ? VERIFICATION_UNREADABLE : verifiedCount === 0 ? NOT_VERIFIED_LINE : `Verified competency: ${verifiedCount} of ${rows.length} competencies in your programme`;
  return { rows, verifiedCount, topLine };
}

export type { PracticeEvidence };

/**
 * The competencies the Overview lists: the programme's own, then EVERY other competency the learner has a self-assessment on (submitted or still open),
 * named from `labels`. A learner's own self-reported ratings are shown unconditionally: they do not depend on the programme or the catalogue offering the
 * competency. A competency that is in both is listed once, as the programme's. One with no readable label is still listed, named plainly.
 */
export function unionCompetencies(
  programme: readonly OverviewCompetency[],
  selfMappedIds: Iterable<string>,
  labels: ReadonlyMap<string, { code: string | null; title: string; domain: string; framework: string | null }>,
): OverviewCompetency[] {
  const have = new Set(programme.map(c => c.id));
  const extra: OverviewCompetency[] = [];
  for (const id of new Set(selfMappedIds)) {
    if (have.has(id)) continue;
    const l = labels.get(id);
    extra.push({ id, code: l?.code ?? null, title: l?.title ?? "A competency you rated yourself on", domain: l?.domain ?? "", framework: l?.framework ?? null, expected: null, contentStatus: "approved", inProgramme: false });
  }
  extra.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return [...programme.map(c => ({ ...c, inProgramme: true })), ...extra];
}
