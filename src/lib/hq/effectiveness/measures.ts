/* eslint-disable @typescript-eslint/no-explicit-any */
import { floorOf, type CohortRules } from "@/lib/knowledge/question-performance";

// ── SCHOLAR LEARNING-EFFECTIVENESS ANALYTICS ── SALE-2026-11 R5, tracker row SALE-15 (owner directive s10.1, s10.2, s13) ──────
//
// What the pilot evaluation reports about LEARNING, derived from records Scholar already keeps (414 learning events, 416
// attempts, 950 kept understanding checks with the R1 response.adaptive decision, 372 card reviews, 414 sessions).
//
// ⚠ PRIVACY. HQ never reads those rows. Every figure comes from ONE database function (migration 985,
// ckri_scholar_effectiveness_stats) on the pattern 996 set: learners whose collective_analytics permission is granted only,
// every cell under the CKRI minimum cohort (never below 5) suppressed, counts rounded, declared columns with no learner id
// and no content. Nothing in this module can see a learner.
// ⚠ NOT MEASURED IS NOT ZERO. Without 985 (or on a read error) the readout is { measured: false, reason } and shows no
// figure. A cell nobody contributed to is "none", a cell under the floor is "fewer than N learners", never a number.
// ⚠ NO TARGETS. The directive says the first pilot sets the baselines. Nothing here has a goal, a threshold of success or a
// red/green colour. Every result carries its sample size and its caution text.
// ⚠ ENGAGEMENT IS NOT LEARNING. Friction signals describe the experience. They are never read as evidence of learning,
// and the outcome measures are never read as evidence of verified competence.

export type CellState = "reported" | "below_floor" | "none";
export type MeasureKind = "rate" | "per100" | "per_hour";
export type MeasureGroup = "outcome" | "comparison" | "friction";

export type MeasureDef = {
  measure: string; arm: string; group: MeasureGroup; kind: MeasureKind;
  label: string;
  /** What the numerator and denominator count, in words. */
  counts: string;
  /** Why the figure is limited, said with the figure. */
  caution: string;
};

const FORMATIVE = "Formative practice, not assessment: never a grade or verified competence.";

/** The catalogue 985 returns, in its order. One row per (measure, arm). */
export const MEASURES: readonly MeasureDef[] = [
  { measure: "immediate_understanding", arm: "all", group: "outcome", kind: "rate", label: "Immediate understanding",
    counts: "First understanding check of a lesson step judged understood, of all first checks answered.",
    caution: `Judged by AI or by the learner against key points (marking shown on each answer). One answer is limited evidence. ${FORMATIVE}` },
  { measure: "corrective_followup", arm: "adaptive", group: "comparison", kind: "rate", label: "After a missed check: adaptive flow",
    counts: "Next check in the same lesson step understood, after a missed check that carried an adaptive teaching decision.",
    caution: "Observational, not randomised: the arms differ in when and by whom they were used. Compare with the standard flow only where both are reported." },
  { measure: "corrective_followup", arm: "standard", group: "comparison", kind: "rate", label: "After a missed check: standard flow",
    counts: "Next check in the same lesson step understood, after a missed check without an adaptive decision (adaptive teaching off or not yet released).",
    caution: "Observational, not randomised: the arms differ in when and by whom they were used. Compare with the adaptive flow only where both are reported." },
  { measure: "misconception_resolution", arm: "adaptive", group: "outcome", kind: "rate", label: "Misconception resolution after corrective teaching",
    counts: "Next check in the same lesson step understood, after a miss whose decision named a likely misconception.",
    caution: `A likely misconception is a rule-based reading of one answer, not a diagnosis. A follow-up may be an easier or a different question. ${FORMATIVE}` },
  { measure: "delayed_recall", arm: "questions", group: "outcome", kind: "rate", label: "Delayed recall (about 7 days), questions",
    counts: "Answers correct again when the same learner's previous answer to the same question was correct 5 to 10 days earlier.",
    caution: "Only learners who came back to the same question are counted, so the group selects itself. Repeating a question can measure recognition as well as recall." },
  { measure: "delayed_recall", arm: "flashcards", group: "outcome", kind: "rate", label: "Delayed recall (about 7 days), flashcards",
    counts: "Card reviews rated remembered when the previous review of that card was 5 to 10 days earlier.",
    caution: "Remembered is the learner's own rating of the card, not a marked answer." },
  { measure: "transfer", arm: "all", group: "outcome", kind: "rate", label: "Transfer to a new situation",
    counts: "First answers to questions the retention release (R2) marks as transfer checks, judged correct.",
    caution: "Recorded once transfer checks are released (SALE R2). Until then it reads none." },
  { measure: "independent_reasoning", arm: "all", group: "outcome", kind: "rate", label: "Independent reasoning",
    counts: "First answers to open reasoning formats (extended, scenario, structured, justification, interpretation, calculation) judged correct.",
    caution: `A first answer is given before any key is shown. Marking may be by AI or by the learner against key points. ${FORMATIVE}` },
  { measure: "study_efficiency", arm: "all", group: "outcome", kind: "per_hour", label: "Study efficiency",
    counts: "Correct first answers per estimated active hour (denominator: estimated active minutes).",
    caution: "Time is ESTIMATED from gaps between activity (up to 30 minutes each, plus 5 minutes per burst), never measured from an open tab. More answers per hour is not by itself better learning." },
  { measure: "friction", arm: "skips", group: "friction", kind: "per100", label: "Skipped lesson steps",
    counts: "Skip events per 100 lessons taught.",
    caution: "A skip can mean the learner already knew it. Experience signal, not a learning outcome." },
  { measure: "friction", arm: "not_yet", group: "friction", kind: "rate", label: "Checks answered not yet",
    counts: "Understanding checks judged not yet, of all judged checks.",
    caution: "Expected while learning: a high share may mean the checks are hard, not that teaching failed." },
  { measure: "friction", arm: "simplify", group: "friction", kind: "per100", label: "Simplify requests",
    counts: "Simplify requests per 100 lessons taught.",
    caution: "Asking for a simpler explanation is a healthy learner choice as well as a sign of confusion." },
  { measure: "friction", arm: "unmarked_checks", group: "friction", kind: "rate", label: "Checks kept without a judgement",
    counts: "Kept understanding checks with no judgement (AI unavailable or refused), of all kept checks.",
    caution: "An operational signal: the learner answered and got no feedback." },
  { measure: "friction", arm: "reteach_cap", group: "friction", kind: "rate", label: "Re-teach limit reached",
    counts: "Adaptive decisions that reached the re-teach limit, of all adaptive decisions.",
    caution: "At the limit Scholar stops re-teaching and saves the point for review. The limit is HQ policy." },
  { measure: "friction", arm: "stalled_sessions", group: "friction", kind: "rate", label: "Learn sessions stalled",
    counts: "Learn sessions started in the window, still active and idle for over 7 days, of all sessions started.",
    caution: "A learner may return later. Disengagement signal only." },
] as const;

export const ENGAGEMENT_IS_NOT_LEARNING =
  "Engagement and activity are not learning. Friction signals describe the experience. Outcome figures are formative and never verified competence.";
export const NO_TARGETS = "No targets are set: the first pilot establishes the baselines these figures will be read against.";
export const NOT_985 = "Not measured: the consented, cohort-suppressed effectiveness analytics (migration 985) are not installed here.";
export const READ_ERROR = "Not measured: the effectiveness analytics could not be read just now.";

export type EffectivenessCell = MeasureDef & {
  state: CellState; learners: number | null; denominator: number | null; numerator: number | null;
  /** Percent (rate) or per 100 (per100). null where suppressed or not applicable. */
  rate: number | null;
  /** Correct first answers per estimated active hour (study_efficiency only). */
  value: number | null;
  /** The sample-size caution for this cell, always present. */
  sample: string;
};

export type Comparison = {
  /** Both arms reported: the difference in percentage points (adaptive minus standard). Otherwise null with the reason. */
  differencePoints: number | null;
  reason: string | null;
  basis: string;
  caution: string;
};

export type EffectivenessReadout =
  | { measured: true; days: number; floor: number; roundTo: number; cells: EffectivenessCell[]; comparison: Comparison }
  | { measured: false; days: number; floor: number; roundTo: number; reason: string };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Pure. The sample-size caution every result carries. Thresholds describe the evidence, they are not targets. */
export function sampleCaution(state: CellState, learners: number | null, floor: number): string {
  if (state === "none") return "No data yet: nobody who has agreed to collective analytics has a record of this kind in the window.";
  if (state === "below_floor" || learners === null) return `Suppressed: fewer than ${floor} consenting learners. No figure is shown so no learner can be identified.`;
  if (learners < 30) return `Very small sample (about ${learners} learners): describe, do not generalise.`;
  if (learners < 100) return `Small sample (about ${learners} learners): interpret cautiously.`;
  return `About ${learners} learners. Still one pilot cohort, not a controlled study.`;
}

/** Pure. One function row as the readout reads it. A row whose (measure, arm) is not in the catalogue is ignored. */
export function cellOf(row: any, floor: number): EffectivenessCell | null {
  const def = MEASURES.find(m => m.measure === row?.measure && m.arm === row?.arm);
  if (!def) return null;
  const state: CellState = row?.cell_state === "reported" ? "reported" : row?.cell_state === "below_floor" ? "below_floor" : "none";
  const shown = state === "reported";
  const learners = shown ? num(row?.learners) : null;
  return {
    ...def, state, learners,
    denominator: shown ? num(row?.denominator) : null, numerator: shown ? num(row?.numerator) : null,
    rate: shown && def.kind !== "per_hour" ? num(row?.rate) : null,
    value: shown && def.kind === "per_hour" ? num(row?.value) : null,
    sample: sampleCaution(state, learners, floor),
  };
}

/** Pure. Every catalogue entry, in order: a missing row reads none (never zero). */
export function cellsOf(rows: readonly any[], floor: number): EffectivenessCell[] {
  return MEASURES.map(def => {
    const row = rows.find(r => r?.measure === def.measure && r?.arm === def.arm);
    return cellOf(row ?? { measure: def.measure, arm: def.arm, cell_state: "none" }, floor)!;
  });
}

export const COMPARISON_BASIS =
  "Same item type (a kept understanding check), same lesson step, same marking, the next answer after a miss. Only the teaching flow between them differs.";
export const COMPARISON_CAUTION =
  "Observational: learners were not assigned to a flow at random, the standard flow comes mostly from before adaptive teaching was released, and a follow-up question may differ in difficulty. A difference is a lead to investigate, not proof that adaptation improves learning.";

/** Pure. Standard against adaptive, only where both arms are reported over the floor. */
export function compareFlows(cells: readonly EffectivenessCell[]): Comparison {
  const a = cells.find(c => c.measure === "corrective_followup" && c.arm === "adaptive");
  const s = cells.find(c => c.measure === "corrective_followup" && c.arm === "standard");
  const base = { basis: COMPARISON_BASIS, caution: COMPARISON_CAUTION };
  if (!a || !s || a.state !== "reported" || s.state !== "reported" || a.rate === null || s.rate === null) {
    const why = [a, s].filter((c): c is EffectivenessCell => !!c).map(c => `${c.arm}: ${c.state === "none" ? "no data" : c.state === "below_floor" ? "suppressed" : "no rate"}`);
    return { ...base, differencePoints: null, reason: `Not compared: both flows must be reported over the minimum cohort (${why.join(", ")}).` };
  }
  return { ...base, differencePoints: a.rate - s.rate, reason: null };
}

/** Pure. A cell figure in words, never a bare zero for something unmeasured. */
export function figureText(c: Pick<EffectivenessCell, "state" | "kind" | "rate" | "value" | "numerator" | "denominator">, floor: number): string {
  if (c.state === "none") return "No data yet";
  if (c.state === "below_floor") return `Fewer than ${floor} learners`;
  if (c.kind === "per_hour") return c.value === null ? "Not computable" : `${c.value} per active hour`;
  if (c.rate === null) return "Not computable";
  return c.kind === "per100" ? `${c.rate} per 100` : `${c.rate}%`;
}

export const EFFECTIVENESS_DAYS = [30, 90, 180] as const;
export const parseDays = (v: unknown): number => {
  const n = Number(v);
  return (EFFECTIVENESS_DAYS as readonly number[]).includes(n) ? n : 90;
};

const missing = (e: any) => /could not find|does not exist|schema cache|PGRST202/i.test(`${e?.message ?? ""} ${e?.code ?? ""}`);

/** Reads 985 for the window. Never throws: not measured with the reason otherwise. */
export async function loadEffectiveness(admin: any, rules: CohortRules, days = 90): Promise<EffectivenessReadout> {
  const floor = floorOf(rules);
  const head = { days, floor, roundTo: rules.roundTo };
  try {
    const r = await admin.rpc("ckri_scholar_effectiveness_stats", { p_since: new Date(Date.now() - days * 864e5).toISOString(), p_min: floor, p_round: rules.roundTo });
    if (r.error) return { ...head, measured: false, reason: missing(r.error) ? NOT_985 : READ_ERROR };
    const cells = cellsOf(Array.isArray(r.data) ? r.data : [], floor);
    return { ...head, measured: true, cells, comparison: compareFlows(cells) };
  } catch {
    return { ...head, measured: false, reason: READ_ERROR };
  }
}
