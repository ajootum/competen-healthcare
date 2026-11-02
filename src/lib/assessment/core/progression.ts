// asmt core: the progression engine (design s7). It is NOT scoring: scoring judges ONE assessment, progression looks at
// the evidence from MANY assessments and decides whether a stage is supported.
//
//   evaluateProgression(rules, stageScale, evidence[], now, opts?) ->
//     { state: unassessed | not_staged | staged, stage, target, outstanding, conflict, trace, trace_hash, ... }
//
// STATES
//   unassessed   no qualifying evidence at all (never confused with not_staged)
//   not_staged   evidence exists but no stage rule holds
//   staged       the HIGHEST stage whose rule holds
//
// EVIDENCE FILTER (default attestation: assessor_evaluated). Self-reported evidence is dropped ALWAYS, whatever the
// rules say (the validator also refuses a rule that lists it). Then methods, then withinDays against `now`, which is
// PASSED IN: this file never reads a clock.
//
// REPEATED (how several records that each meet a count filter combine). The pool for a count predicate is the working
// records that match the filter's attestation and method; the result criteria are outcomeClass and minLevelStage.
//   best          count = records in the pool that meet the result criteria
//   latest        only the most recent record in the pool is looked at: count is 1 or 0
//   all_must_meet every record in the pool must meet the criteria: count = pool size, or 0 if any record fails
// CONFLICTING. Take the latest record of each assessor. If those latest records include both a positive and a negative
// outcome class the assessors disagree. Then the working set is reduced to ONE record: the most recent (latest) or the
// lowest (negative < incomplete < partial < positive, ties to the most recent). Improvement over time by the same
// assessor is not a conflict.
// SINGLE ASSESSMENT. Unless permitSingleAssessment, a stage is never conferred while the working set has fewer than two
// records (the validator also refuses a stage rule that one assessment can satisfy). Ordinals are never averaged here.
import { compare, evalCond, leafKey, numAtoms, boolAtoms, setAtoms, type Atomizer, type Cond, type CondEval } from "./cond";
import { canonicalJson, sha256Hex } from "./hash";
import type { EvidenceWhere, ProgPred, ProgressionDoc, StageScale } from "./rules-ast";
import { ENGINE_VERSION } from "./scoring";
import { OUTCOME_CLASSES, type Attestation, type OutcomeClass } from "./types";

const BIG = 1e14;

export interface ProgressionEvidence {
  /** the submitted outcome id */
  id: string;
  attestation: Attestation;
  methods: string[];
  assessor_id: string | null;
  submitted_at: string;
  outcome_class: OutcomeClass;
  outcome_code: string;
  /** lowest rating ordinal answered per group (scoring.groupMinOrdinals) */
  group_min_ordinal: Record<string, number | null>;
  critical_failed: boolean;
}

export interface OutstandingItem { kind: "rule" | "conflict" | "single_assessment" | "no_evidence" | "no_rule"; stage?: string; text: string }
export type ProgTrace =
  | { kind: "filter"; id: string; kept: boolean; why: string }
  | { kind: "conflict"; conflict: boolean; reducedTo: string | null; latestPerAssessor: { assessor: string; id: string; class: OutcomeClass }[] }
  | { kind: "stage_rule"; stage: string; holds: boolean; blocked: string | null; leaves: { pred: string; value: boolean; detail?: unknown }[] }
  | { kind: "decision"; state: string; stage: string | null };

export interface ProgressionResult {
  engine_version: string;
  state: "unassessed" | "not_staged" | "staged";
  stage: string | null;
  target: string | null;
  outstanding: OutstandingItem[];
  conflict: boolean;
  qualifying_ids: string[];
  working_ids: string[];
  excluded: { id: string; why: string }[];
  trace: ProgTrace[];
  trace_hash: string;
}

export const stageOrdinal = (scale: StageScale, code: string): number => scale.stages.find((s) => s.code === code)?.ordinal ?? -Infinity;
export const stageForOrdinal = (scale: StageScale, ordinal: number): string | null => scale.bands.find((b) => ordinal >= b.from_ordinal && ordinal <= b.to_ordinal)?.stage ?? null;

const RANK: Record<OutcomeClass, number> = { negative: 0, incomplete: 1, partial: 2, positive: 3 };
const ts = (s: string): number => new Date(s).getTime();
const toMs = (n: Date | string | number): number => (n instanceof Date ? n.getTime() : typeof n === "number" ? n : new Date(n).getTime());
const DAY = 86400000;

export function progressionAtomizer(repeated: ProgressionDoc["repeated"]): Atomizer<ProgPred> {
  return (p, neg) => {
    if ("count" in p) return numAtoms(`ecount|${leafKey(p.count.where)}`, p.op, p.value, neg, { lo: 0, hi: repeated === "latest" ? 1 : BIG, int: true, none: false });
    if ("distinctAssessors" in p) return numAtoms(`assessors|${leafKey(p.distinctAssessors.where ?? {})}`, p.op, p.value, neg, { lo: 0, hi: BIG, int: true, none: false });
    if ("latest" in p) return p.latest.field === "outcomeClass" ? setAtoms("latest|class", [p.latest.is], [...OUTCOME_CLASSES], neg) : boolAtoms(`latestcode|${p.latest.is}`, true, neg);
    return boolAtoms(`critfail|${leafKey(p.anyCriticalFailure)}`, true, neg);
  };
}

export function evaluateProgression(
  rules: ProgressionDoc, scale: StageScale, evidence: ProgressionEvidence[], now: Date | string | number,
  opts: { programmeTarget?: string | null } = {},
): ProgressionResult {
  const nowMs = toMs(now);
  const trace: ProgTrace[] = [];
  const excluded: { id: string; why: string }[] = [];
  const allowedAtt = rules.evidence.attestation.filter((a) => a !== "self_reported");
  const kept: ProgressionEvidence[] = [];
  const ordered = [...evidence].sort((a, b) => ts(a.submitted_at) - ts(b.submitted_at) || (a.id < b.id ? -1 : 1));
  for (const e of ordered) {
    let why = "";
    if (e.attestation === "self_reported") why = "self-reported evidence never supports a stage";
    else if (!allowedAtt.includes(e.attestation)) why = `attestation ${e.attestation} is not accepted`;
    else if (rules.evidence.methods?.length && !e.methods.some((m) => rules.evidence.methods!.includes(m))) why = "method not accepted";
    else if (rules.evidence.withinDays !== undefined && ts(e.submitted_at) < nowMs - rules.evidence.withinDays * DAY) why = `older than ${rules.evidence.withinDays} days`;
    if (why) { excluded.push({ id: e.id, why }); trace.push({ kind: "filter", id: e.id, kept: false, why }); } else { kept.push(e); trace.push({ kind: "filter", id: e.id, kept: true, why: "qualifies" }); }
  }
  kept.sort((a, b) => ts(a.submitted_at) - ts(b.submitted_at) || (a.id < b.id ? -1 : 1));

  const targetCode = "stage" in rules.target ? rules.target.stage : opts.programmeTarget ?? null;
  const finish = (state: ProgressionResult["state"], stage: string | null, outstanding: OutstandingItem[], conflict: boolean, working: ProgressionEvidence[]): ProgressionResult => {
    trace.push({ kind: "decision", state, stage });
    return {
      engine_version: ENGINE_VERSION, state, stage, target: targetCode, outstanding, conflict,
      qualifying_ids: kept.map((e) => e.id), working_ids: working.map((e) => e.id), excluded, trace,
      trace_hash: sha256Hex(canonicalJson({ engine: ENGINE_VERSION, state, stage, trace })),
    };
  };
  if (kept.length === 0) {
    return finish("unassessed", null, targetCode ? [{ kind: "no_evidence", stage: targetCode, text: "No qualifying assessment yet." }] : [], false, []);
  }

  // conflict between assessors
  const latestBy = new Map<string, ProgressionEvidence>();
  for (const e of kept) latestBy.set(e.assessor_id ?? `unknown:${e.id}`, e);
  const latests = Array.from(latestBy.entries());
  const classes = new Set(latests.map(([, e]) => e.outcome_class));
  const conflict = classes.has("positive") && classes.has("negative");
  let working = kept;
  let reducedTo: string | null = null;
  if (conflict) {
    const pick = rules.conflicting === "latest"
      ? kept[kept.length - 1]
      : latests.map(([, e]) => e).sort((a, b) => RANK[a.outcome_class] - RANK[b.outcome_class] || ts(b.submitted_at) - ts(a.submitted_at))[0];
    working = [pick]; reducedTo = pick.id;
  }
  trace.push({ kind: "conflict", conflict, reducedTo, latestPerAssessor: latests.map(([a, e]) => ({ assessor: a, id: e.id, class: e.outcome_class })) });

  const base = (e: ProgressionEvidence, w: EvidenceWhere): boolean => (!w.attestation || e.attestation === w.attestation) && (!w.method || e.methods.includes(w.method));
  const result = (e: ProgressionEvidence, w: EvidenceWhere): boolean => {
    if (w.outcomeClass && e.outcome_class !== w.outcomeClass) return false;
    if (w.minLevelStage) {
      const o = e.group_min_ordinal[w.minLevelStage.group];
      if (o === null || o === undefined) return false;
      const st = stageForOrdinal(scale, o);
      if (st === null || stageOrdinal(scale, st) < stageOrdinal(scale, w.minLevelStage.atLeast)) return false;
    }
    return true;
  };
  const leaf = (p: ProgPred): { value: boolean; detail?: unknown } => {
    if ("count" in p) {
      const w = p.count.where;
      const pool = working.filter((e) => base(e, w));
      let n: number;
      if (rules.repeated === "best") n = pool.filter((e) => result(e, w)).length;
      else if (rules.repeated === "latest") n = pool.length && result(pool[pool.length - 1], w) ? 1 : 0;
      else n = pool.length && pool.every((e) => result(e, w)) ? pool.length : 0;
      return { value: compare(p.op, n, p.value), detail: { observed: n } };
    }
    if ("distinctAssessors" in p) {
      const w = p.distinctAssessors.where ?? {};
      const n = new Set(working.filter((e) => base(e, w) && result(e, w) && e.assessor_id).map((e) => e.assessor_id)).size;
      return { value: compare(p.op, n, p.value), detail: { observed: n } };
    }
    if ("latest" in p) {
      const last = working[working.length - 1];
      const v = last ? (p.latest.field === "outcomeClass" ? last.outcome_class : last.outcome_code) : null;
      return { value: v === p.latest.is, detail: { observed: v } };
    }
    const days = p.anyCriticalFailure.withinDays;
    const hit = kept.some((e) => e.critical_failed && (days === undefined || ts(e.submitted_at) >= nowMs - days * DAY));
    return { value: hit, detail: { observed: hit } };
  };

  const blocked = !rules.permitSingleAssessment && working.length < 2 ? "needs at least two assessments" : null;
  let best: { code: string; ord: number } | null = null;
  const evals = new Map<string, CondEval<ProgPred>>();
  for (const r of rules.stageRules) {
    const e = evalCond<ProgPred>(r.when, leaf);
    evals.set(r.stage, e);
    const holds = e.value && !blocked;
    trace.push({ kind: "stage_rule", stage: r.stage, holds, blocked: e.value ? blocked : null, leaves: e.leaves.map((l) => ({ pred: canonicalJson(l.pred), value: l.value, detail: l.detail })) });
    const ord = stageOrdinal(scale, r.stage);
    if (holds && (!best || ord > best.ord)) best = { code: r.stage, ord };
  }

  const outstanding: OutstandingItem[] = [];
  if (targetCode && !(best && best.ord >= stageOrdinal(scale, targetCode))) {
    const tr = rules.stageRules.find((r) => r.stage === targetCode);
    if (!tr) outstanding.push({ kind: "no_rule", stage: targetCode, text: `No rule describes stage ${targetCode}.` });
    else {
      const e = evals.get(targetCode)!;
      if (blocked && e.value) outstanding.push({ kind: "single_assessment", stage: targetCode, text: `Stage ${targetCode}: ${blocked}.` });
      else for (const t of unmetOf(tr.when, e.leaves)) outstanding.push({ kind: "rule", stage: targetCode, text: t });
    }
    if (conflict) outstanding.push({ kind: "conflict", stage: targetCode, text: `Assessors disagree, so only one assessment is counted (${rules.conflicting}).` });
  }
  if (best) return finish("staged", best.code, outstanding, conflict, working);
  return finish("not_staged", rules.notStaged === "unstaged" ? null : rules.notStaged, outstanding, conflict, working);
}

/** Plain sentences for the predicates that are still false in a rule, in document order. */
function unmetOf(cond: Cond<ProgPred>, leaves: { pred: ProgPred; value: boolean; detail?: unknown }[]): string[] {
  let i = 0;
  const walk = (n: Cond<ProgPred>, expect: boolean): { value: boolean; unmet: string[] } => {
    const o = n as Record<string, unknown>;
    if ("all" in o || "any" in o) {
      const k = "all" in o ? "all" : "any";
      const kids = (o[k] as Cond<ProgPred>[]).map((x) => walk(x, expect));
      const value = k === "all" ? kids.every((x) => x.value) : kids.some((x) => x.value);
      if (value === expect) return { value, unmet: [] };
      if (k === "all" && expect) return { value, unmet: kids.flatMap((x) => x.unmet) };
      if (k === "any" && expect) return { value, unmet: [`one of: ${kids.flatMap((x) => x.unmet).join("; ")}`] };
      return { value, unmet: [`this must not hold: ${canonicalJson(n)}`] };
    }
    if ("not" in o) { const r = walk(o.not as Cond<ProgPred>, !expect); return { value: !r.value, unmet: r.unmet }; }
    const l = leaves[i++];
    return { value: l.value, unmet: l.value === expect ? [] : [describe(l.pred, expect, l.detail)] };
  };
  return walk(cond, true).unmet;
}

function describe(p: ProgPred, expect: boolean, detail: unknown): string {
  const seen = (detail as { observed?: unknown } | undefined)?.observed;
  const neg = expect ? "" : "not ";
  if ("count" in p) return `${neg}records matching ${canonicalJson(p.count.where)} ${p.op} ${p.value} (now ${String(seen)})`;
  if ("distinctAssessors" in p) return `${neg}distinct assessors ${p.op} ${p.value} (now ${String(seen)})`;
  if ("latest" in p) return `${neg}latest ${p.latest.field} is ${p.latest.is} (now ${String(seen)})`;
  return `${neg}any critical failure${p.anyCriticalFailure.withinDays ? ` in ${p.anyCriticalFailure.withinDays} days` : ""}`;
}
