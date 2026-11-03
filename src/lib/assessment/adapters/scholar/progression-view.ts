import type { StageScale } from "../../core";
import { EVIDENCE_SUPPORTED_NOTE, STAGE_FROM_ASSESSORS, STAGE_NOT_STAGED, STAGE_UNASSESSED } from "./vocab";

// ── THE LEARNER'S EVIDENCE-SUPPORTED STAGE: THE VIEW MODEL ── Checklist Studio S3 ────────────────────────────────────
//
// Pure. A progression decision is computed from ASSESSOR-LED evidence by a published rule set (the engine and the database own that).
// This file only words what was stored: the stage, the target and what is outstanding, with the stage scale's own LABELS (never a code),
// and always beside the line that it is evidence-supported and not formally verified. It never touches a self rating, and the stored
// working of a decision is not an input here: only the decision's own columns are.

export type DecisionRow = {
  id: string; ruleVersionId: string; state: string; stageCode: string | null; targetStageCode: string | null;
  outstanding: unknown; validUntil: string | null; computedAt: string;
};
export type RuleSetFact = { ruleSetId: string; code: string; name: string; targetKind: string; targetRef: string | null; stageScaleVersionId: string | null };

export type StageView = {
  ruleSetId: string; ruleSetCode: string; ruleSetName: string; targetKind: string; targetRef: string | null;
  state: "unassessed" | "not_staged" | "staged";
  stageLabel: string | null; targetLabel: string | null; outstanding: string[];
  /** The sentence the page shows: stage, target and what is outstanding. */
  summary: string;
  computedAt: string; validUntil: string | null;
  /** The evidence window the stage rests on has passed, so a later assessment may change it. */
  stale: boolean;
  note: string;
};

/** "advanced_beginner" -> "Advanced Beginner": only when the scale could not name the stage. */
export const humaniseCode = (code: string): string => code.replace(/[_-]+/g, " ").trim().replace(/\b[a-z]/g, c => c.toUpperCase());

export const stageLabel = (scale: StageScale | null, code: string | null): string | null => {
  if (!code) return null;
  return scale?.stages.find(s => s.code === code)?.label ?? humaniseCode(code);
};

const ATTESTATION_WORDS: Record<string, string> = { assessor_evaluated: "assessor-led", self_reported: "self-reported", auditor_recorded: "auditor-recorded", ai_assisted_formative: "AI-assisted formative" };

/** A count requirement's stored JSON filter, worded. Unreadable JSON gives a generic phrase, never the JSON itself. */
function whereWords(raw: string, scale: StageScale | null): string {
  try {
    const w = JSON.parse(raw) as { attestation?: string; method?: string; outcomeClass?: string; minLevelStage?: { group?: string; atLeast?: string } };
    const parts: string[] = [];
    if (w.attestation) parts.push(ATTESTATION_WORDS[w.attestation] ?? humaniseCode(w.attestation).toLowerCase());
    if (w.outcomeClass) parts.push(`${w.outcomeClass.replace(/_/g, " ")} outcome`);
    if (w.method) parts.push(`${w.method.replace(/_/g, " ")} method`);
    if (w.minLevelStage?.atLeast) parts.push(`lowest rating in ${w.minLevelStage.group ? humaniseCode(w.minLevelStage.group).toLowerCase() : "the group"} at ${stageLabel(scale, w.minLevelStage.atLeast)} or above`);
    return parts.length ? parts.join(", ") : "qualifying";
  } catch { return "qualifying"; }
}

/** One stored outstanding requirement as a sentence the learner can read: stage codes become the scale's labels, filters become words. Pure. */
export function outstandingText(text: string, scale: StageScale | null): string {
  let t = text.trim().replace(/\.$/, "");
  // "not any critical failure in 180 days" is the stored form of the requirement "no critical failure in the last 180 days".
  t = t.replace(/^not any critical failure in (\d+) days?$/i, (_m, n: string) => `no critical failure in the last ${n} days`);
  t = t.replace(/^not any critical failure$/i, "no critical failure");
  t = t.replace(/^any critical failure in (\d+) days?$/i, (_m, n: string) => `no critical failure in the last ${n} days`);
  t = t.replace(/^any critical failure$/i, "no critical failure");
  t = t.replace(/(not )?records matching (\{.*?\}) (>=|<=|==|!=|>|<|=) (\d+) \(now ([^)]*)\)/i, (_m, neg: string | undefined, json: string, op: string, v: string, now: string) =>
    `${neg ? "not: " : ""}${whereWords(json, scale)} records ${op} ${v} (now ${now})`);
  t = t.replace(/\blatest (outcomeClass|outcomeCode) is /g, (_m, f: string) => `latest ${f === "outcomeClass" ? "outcome class" : "outcome"} is `);
  t = t.replace(/\bNo rule describes stage ([a-z][a-z0-9_]*)/g, (_m, code: string) => `No rule describes the stage ${stageLabel(scale, code)}`);
  t = t.replace(/\b(Stage|stage) ([a-z][a-z0-9_]*)(?=[:\s,]|$)/g, (m, w: string, code: string) => (scale?.stages.some(s => s.code === code) || code.includes("_") ? `${w} ${stageLabel(scale, code)}` : m));
  return t;
}

/** The stored outstanding array as sentences. Tolerates a plain string element; anything else is dropped. */
export function outstandingList(raw: unknown, scale: StageScale | null): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const o of raw) {
    const text = typeof o === "string" ? o : o && typeof o === "object" && typeof (o as { text?: unknown }).text === "string" ? (o as { text: string }).text : null;
    if (text && text.trim()) out.push(outstandingText(text, scale));
  }
  return out;
}

/** The newest decision per rule set (by computed_at). `ruleSetOf` maps a rule version id to its rule set. Pure. */
export function latestPerRuleSet(decisions: readonly DecisionRow[], ruleSetOf: ReadonlyMap<string, string>): Map<string, DecisionRow> {
  const out = new Map<string, DecisionRow>();
  for (const d of decisions) {
    const set = ruleSetOf.get(d.ruleVersionId);
    if (!set) continue;
    const cur = out.get(set);
    if (!cur || cur.computedAt < d.computedAt || (cur.computedAt === d.computedAt && cur.id < d.id)) out.set(set, d);
  }
  return out;
}

/** The one-line wording of a view, e.g. "Evidence-supported stage: Advanced Beginner (from assessor-led assessments) · Target: Competent · Outstanding: ...". */
export function summaryLine(v: Pick<StageView, "state" | "stageLabel" | "targetLabel" | "outstanding">): string {
  if (v.state === "unassessed") return STAGE_UNASSESSED;
  const head = v.state === "staged" && v.stageLabel ? `Evidence-supported stage: ${v.stageLabel} (${STAGE_FROM_ASSESSORS})` : STAGE_NOT_STAGED;
  const parts = [head];
  if (v.targetLabel) parts.push(`Target: ${v.targetLabel}`);
  if (v.outstanding.length) parts.push(`Outstanding: ${v.outstanding.join("; ")}`);
  return parts.join(" · ");
}

export function buildStageView(d: DecisionRow, set: RuleSetFact, scale: StageScale | null, now: Date = new Date()): StageView {
  const state: StageView["state"] = d.state === "staged" || d.state === "not_staged" ? d.state : "unassessed";
  const parts = {
    state,
    stageLabel: state === "staged" ? stageLabel(scale, d.stageCode) : null,
    targetLabel: state === "unassessed" ? null : stageLabel(scale, d.targetStageCode),
    outstanding: state === "unassessed" ? [] : outstandingList(d.outstanding, scale),
  };
  return {
    ruleSetId: set.ruleSetId, ruleSetCode: set.code, ruleSetName: set.name, targetKind: set.targetKind, targetRef: set.targetRef,
    ...parts, summary: summaryLine(parts), computedAt: d.computedAt, validUntil: d.validUntil,
    stale: !!d.validUntil && new Date(d.validUntil).getTime() < now.getTime(), note: EVIDENCE_SUPPORTED_NOTE,
  };
}

/** The views that apply to a competency, newest first. A view applies when its rule set targets the competency or an instrument that assesses it. */
export function viewsForCompetency(views: readonly { view: StageView; competencyIds: readonly string[] }[], competencyId: string): StageView[] {
  return views.filter(v => v.competencyIds.includes(competencyId)).map(v => v.view).sort((a, b) => b.computedAt.localeCompare(a.computedAt));
}
