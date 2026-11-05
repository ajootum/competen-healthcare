// ── SCHOLAR-EVALUATE-GOALS-01: GOAL-FIRST EVALUATE, THE RULES ── owner GO 5 Nov 2026 ───────────────────────────────────────
//
// Pure and client-safe: no I/O, no clock of its own, no AI. It reads an Evaluation (evaluation.ts, unchanged) and says what it
// shows for a goal or a competency. It adds no scoring. Four things stay apart, and none stands in for another:
//   planned activity completed   the learner's own plan, a measure of activity only
//   learning outcome supported   marked evidence, past the evaluation's own minimum, reaching application or reasoning
//   learning gap identified      marked evidence that went wrong
//   insufficient evidence        too little to say, which is never failure
// Verified clinical competence is not decided here: only an independently governed assessment decides it. No overall percentage
// and no Novice-to-Expert stage is ever worked out from learning activity.

// Owner final alignment, 5 Nov 2026: Evaluate is where an evaluation is taken. My Progress is the read-only report of what the records show.
export const EVALUATE_VIEWS = ["goals", "competencies", "learning", "reasoning", "monthly", "history"] as const;
export type EvaluateView = (typeof EVALUATE_VIEWS)[number];
export const EVALUATE_VIEW_LABEL: Record<EvaluateView, string> = { goals: "My Plan goals", competencies: "My Competencies", learning: "My Learning", reasoning: "Clinical Reasoning", monthly: "Monthly Review", history: "Evaluation history" };
export const parseEvaluateView = (v: unknown): EvaluateView => ((EVALUATE_VIEWS as readonly unknown[]).includes(v) ? v as EvaluateView : "goals");

export const PROGRESS_TABS = ["overview", "goals", "competencies", "learning", "history", "practice"] as const;
export type ProgressTab = (typeof PROGRESS_TABS)[number];
export const PROGRESS_TAB_LABEL: Record<ProgressTab, string> = { overview: "Overview", goals: "My Goals", competencies: "Competencies", learning: "Learning", history: "History", practice: "Practice & achievements" };
export const parseProgressTab = (v: unknown): ProgressTab => ((PROGRESS_TABS as readonly unknown[]).includes(v) ? v as ProgressTab : "overview");

/** What each way of evaluating means as evidence. A review of existing evidence reads what is already there and adds nothing new. */
export const METHOD_MEANING = {
  existing: "Reads what you have already done. It adds no new evidence, and it is not new performance.",
  fresh: "New questions, answered now. These are new evidence, and each says how it was marked.",
  combined: "Your existing evidence and a fresh check. Only the fresh check is new evidence.",
} as const;
export const WORKFLOW_STEPS = ["Choose what", "Choose how", "Complete it", "Get feedback", "Saved to My Progress"] as const;

export const DIMENSIONS = ["knowledge", "retention", "application", "reasoning"] as const;
export type DimensionName = (typeof DIMENSIONS)[number];
export const DIMENSION_NAME: Record<DimensionName, string> = { knowledge: "Knowledge", retention: "Retention", application: "Application", reasoning: "Reasoning" };

export type EvidenceStatus = "supported" | "developing" | "gap" | "thin" | "not_assessed";
export const EVIDENCE_STATUS_LABEL: Record<EvidenceStatus, string> = { supported: "Supported", developing: "Developing", gap: "Learning gap", thin: "Not enough yet", not_assessed: "Not assessed" };

export type DimensionView = {
  key: DimensionName; label: string; status: EvidenceStatus;
  /** Pieces of evidence, and the minimum the evaluation asks for before it says anything. For the evidence bar, never a score. */
  have: number; need: number | null;
  note: string;
};

type DimensionInput = { state?: unknown; band?: unknown; independent?: unknown; n?: unknown; recalls?: unknown; have?: unknown; need?: unknown; reason?: unknown } | null | undefined;
const count = (d: DimensionInput) => { const n = Number(d?.independent ?? d?.n ?? d?.recalls ?? d?.have ?? 0); return Number.isFinite(n) ? n : 0; };

/** Pure. One dimension of a stored or live evaluation. A band describes; it does not certify. Too little evidence is said to be that. */
export function dimensionView(key: DimensionName, d: DimensionInput): DimensionView {
  const base = { key, label: DIMENSION_NAME[key], have: count(d), need: typeof d?.need === "number" ? d.need : null };
  if (d?.state === "measured") {
    const status: EvidenceStatus = d.band === "strong" ? "supported" : d.band === "developing" ? "developing" : d.band === "needs_work" ? "gap" : "thin";
    return { ...base, status, note: `${base.have} marked ${base.have === 1 ? "piece" : "pieces"} of evidence` };
  }
  if (d?.state === "insufficient") return { ...base, status: "thin", note: `${base.have} of ${base.need ?? "?"} pieces of evidence needed. This is not a low result.` };
  return { ...base, status: "not_assessed", note: typeof d?.reason === "string" ? d.reason : "Nothing has tested this yet. This is not a low result." };
}

/** Pure. All four dimensions of an evaluation's results. */
export const dimensionsOf = (r: Partial<Record<DimensionName, DimensionInput>> | null | undefined): DimensionView[] => DIMENSIONS.map(k => dimensionView(k, r?.[k]));

export type GoalStatus = "outcome_supported" | "learning_gap" | "insufficient_evidence" | "not_assessed";
export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = { outcome_supported: "Outcome supported by evidence", learning_gap: "Learning gap identified", insufficient_evidence: "Evidence insufficient", not_assessed: "Not assessed yet" };

/**
 * Pure. What the evidence shows for a goal. A gap is said first, since it can be acted on. An outcome is supported only with two
 * supported dimensions, one of them application or reasoning, at more than insufficient confidence: reading alone can never reach it.
 */
export function goalStatus(dims: readonly DimensionView[], confidence: string | null): GoalStatus {
  if (dims.some(d => d.status === "gap")) return "learning_gap";
  const supported = dims.filter(d => d.status === "supported");
  if (supported.length >= 2 && supported.some(d => d.key === "application" || d.key === "reasoning") && confidence !== "insufficient") return "outcome_supported";
  return dims.every(d => d.status === "not_assessed") ? "not_assessed" : "insufficient_evidence";
}
/** Pure. What remains unproven, by name. */
export const unprovenOf = (dims: readonly DimensionView[]): string[] => dims.filter(d => d.status !== "supported").map(d => d.label);
export const supportedCount = (dims: readonly DimensionView[]): number => dims.filter(d => d.status === "supported").length;
/** Pure. Whether a goal needs attention: a gap to act on, or evidence that is still to be collected. Not assessed is not failure; it still wants a next step. */
export const needsAttention = (s: GoalStatus): boolean => s === "learning_gap" || s === "insufficient_evidence";

// ── saved evaluations: search and compare, from the snapshots already kept ──

export type SnapshotRow = { id: string; label: string; kind: string; method: string; confidence: string; createdAt: string; dims: DimensionView[]; supported: number;
  /** A review of existing evidence: it says what the records showed that day, and is never new independent performance. */
  review: boolean; methodLine: string };

/** Pure. A stored evaluation as a row. It reads the stored results, so an old snapshot says what it said then. */
export function snapshotRow(e: { id: string; scope: { label?: string } | null; kind: string; method: string; confidence: { level?: string } | string | null; createdAt: string; results: unknown }): SnapshotRow {
  const dims = dimensionsOf(e.results as Partial<Record<DimensionName, DimensionInput>>);
  const confidence = typeof e.confidence === "string" ? e.confidence : e.confidence?.level ?? "insufficient";
  const review = e.method === "existing";
  const methodLine = review ? "Review of existing evidence, no new evidence" : e.method === "fresh" ? "Fresh assessment, new evidence" : "Existing evidence and a fresh assessment";
  return { id: e.id, label: e.scope?.label ?? "An evaluation", kind: e.kind, method: e.method, confidence, createdAt: e.createdAt, dims, supported: supportedCount(dims), review, methodLine };
}

/** Pure. Search by what an evaluation was of, optionally from a date. */
export function filterSnapshots(rows: readonly SnapshotRow[], f: { q?: string | null; from?: string | null }): SnapshotRow[] {
  const words = (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(r => words.every(w => r.label.toLowerCase().includes(w)) && (!f.from || r.createdAt.slice(0, 10) >= f.from));
}

export type DimensionChange = { key: DimensionName; label: string; from: EvidenceStatus; to: EvidenceStatus; movement: "more" | "same" | "changed" };
const RANK: Record<EvidenceStatus, number> = { not_assessed: 0, thin: 1, gap: 2, developing: 3, supported: 4 };

/** Pure. Two evaluations side by side, like for like only: each dimension's status, then and now. Comparing evaluations of different things returns null. */
export function compareSnapshots(a: SnapshotRow, b: SnapshotRow): { older: SnapshotRow; newer: SnapshotRow; changes: DimensionChange[] } | null {
  if (a.label !== b.label) return null;
  const [older, newer] = a.createdAt <= b.createdAt ? [a, b] : [b, a];
  return {
    older, newer,
    changes: older.dims.map((d, i) => {
      const to = newer.dims[i].status;
      return { key: d.key, label: d.label, from: d.status, to, movement: to === d.status ? "same" as const : RANK[to] > RANK[d.status] ? "more" as const : "changed" as const };
    }),
  };
}

/** Pure. Each saved evaluation of one thing, oldest first, for the view over time. */
export function historyOf(rows: readonly SnapshotRow[], label: string): SnapshotRow[] {
  return rows.filter(r => r.label === label).sort((x, y) => x.createdAt.localeCompare(y.createdAt));
}

/** Pure. A section's readable name for the learner: its topic, then its own heading. A file position is the last resort, and the exact link stays. */
export function sectionName(concepts: readonly string[] | undefined, heading: string | null | undefined, fallback: string): string {
  const concept = concepts?.find(c => c.trim());
  if (concept) return concept;
  return heading && heading.length <= 60 && !/[.!?…]$/.test(heading) ? heading : fallback;
}
