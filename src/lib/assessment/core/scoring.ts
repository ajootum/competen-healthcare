// asmt core: the scoring engine. Pure, synchronous, deterministic. No Date.now, no eval, no I/O.
//
//   evaluate(def, doc, responses, ctx?) -> { outcome, class, decided_by, groupOutcomes, aggregates, gates, counts,
//                                            trace, traceHash, rules_hash }
//
// ORDER OF DECISION (design s4)
//   1. GATES, built in, cannot be turned off, override everything:
//        criticalFail      any critical item failed its critical requirements (class negative outcome)
//        mandatoryMissing  any mandatory item (a critical item is mandatory) is unanswered (class incomplete outcome)
//      criticalFail is checked before mandatoryMissing. A high average can never override a failed critical item.
//   2. Aggregates are computed (informational even when a gate fires).
//   3. Group rules, one level, no cycles: each group gets an outcome (rules by priority, first match wins, else the
//      group fallback).
//   4. Overall rules by priority (HIGHER number first, array order breaks equal priority), first match wins, else the
//      overall fallback.
//
// ITEM STATUS (how a response counts)
//   satisfactory / unsatisfactory   from computeSatisfactory, or from a state's treatment
//   neutral                         answered but carries no pass or fail meaning (free text, a level with null flag)
//   excluded                        not applicable (default) or unable_to_determine under "exclude": out of every
//                                   denominator, still "answered"
//   missing                         no response, not_assessed, not_observed under "missing", unable_to_determine
//                                   under "missing", or an invalid response. Not answered, not in any denominator.
//   Treatment defaults come from rules.defaults, overridden per item by config.treat. Nothing here is a universal
//   threshold: no percentage, no stage, no scale is named in this file.
//
// traceHash is sha-256 (pure implementation in hash.ts) over canonical JSON of { engine, outcome, trace }, so it is
// produced synchronously and identically in the browser and on the server.
import { compare, evalCond, type Cond } from "./cond";
import { hashDoc, round6, sha256Hex, canonicalJson } from "./hash";
import type { AggregateDef, Pred, RulesDoc, Rule, Selector, Test } from "./rules-ast";
import {
  allowedStates, answerCodes, computeSatisfactory, creditOf, fieldSpec, levelOrdinal, numericValue, validateResponse,
  type FieldSpec,
} from "./responses";
import { selectItems, sectionClosure } from "./select";
import {
  PRIMARY, rkey, type EvalContext, type InstrumentDef, type InstrumentItem, type OutcomeClass, type Responses, type StateCode, type Treatment,
} from "./types";

export const ENGINE_VERSION = "asmt-engine/1";

export class RulesError extends Error {
  constructor(message: string) { super(message); this.name = "RulesError"; }
}

export type ItemStatus = "satisfactory" | "unsatisfactory" | "neutral" | "excluded" | "missing";

export interface FieldEval {
  key: string;
  field: string;
  code: string;
  status: ItemStatus;
  /** counts as answered (excluded answers are answered) */
  answered: boolean;
  /** the response carried any content at all (a state counts) */
  hasResponse: boolean;
  state: StateCode | null;
  ordinal: number | null;
  numeric: number | null;
  credit: number | null;
  satisfactory: boolean | null;
  codes: string[];
  why: string;
}

const has = (v: unknown) => v !== undefined && v !== null;

/** Resolve how states are treated for an item: item config.treat over rules defaults over built-in defaults. */
function treatmentFor(item: InstrumentItem, spec: FieldSpec, defaults: Treatment | undefined): Required<Treatment> {
  const t = { ...(defaults ?? {}), ...(item.config?.treat ?? {}), ...(spec.config?.treat ?? {}) };
  return {
    na: t.na ?? "exclude",
    notObserved: t.notObserved ?? "missing",
    unable: t.unable ?? "unsatisfactory",
    undeterminable: t.undeterminable ?? "missing",
  };
}

/** Evaluate one field (primary by default) of one item to a status. */
export function evalField(item: InstrumentItem, fieldKey: string, responses: Responses, defaults?: Treatment): FieldEval {
  const spec = fieldSpec(item, fieldKey);
  const base = { key: item.stable_key, field: fieldKey, code: item.code, ordinal: null, numeric: null, credit: null, satisfactory: null, codes: [] as string[] };
  if (!spec) return { ...base, status: "missing", answered: false, hasResponse: false, state: null, why: "unknown field" };
  const r = responses[rkey(item.stable_key, fieldKey)];
  const hasResponse = !!r && (has(r.state) || has(r.level_code) || has(r.value));
  if (!r || !hasResponse) return { ...base, status: "missing", answered: false, hasResponse: false, state: "not_assessed", why: "no response" };
  const t = treatmentFor(item, spec, defaults);
  const creditCapable = (spec.config.options ?? []).some((o) => has(o.credit));
  if (has(r.state)) {
    const s = r.state as StateCode;
    const chk = validateResponse(item, r, fieldKey);
    const codes = answerCodes(spec, r);
    if (!chk.ok) return { ...base, codes, status: "missing", answered: false, hasResponse, state: s, why: `invalid response: ${chk.issues[0]?.message}` };
    const unsat = (why: string): FieldEval => ({ ...base, codes, status: "unsatisfactory", answered: true, hasResponse, state: s, satisfactory: false, credit: creditCapable ? 0 : null, why });
    const excl = (why: string): FieldEval => ({ ...base, codes, status: "excluded", answered: true, hasResponse, state: s, why });
    const miss = (why: string): FieldEval => ({ ...base, codes, status: "missing", answered: false, hasResponse, state: s, why });
    switch (s) {
      case "not_assessed": return miss("not assessed");
      case "not_applicable": return t.na === "exclude" ? excl("not applicable, excluded") : unsat("not applicable, counted unsatisfactory");
      case "not_observed": return t.notObserved === "missing" ? miss("not observed, treated as missing") : unsat("not observed, counted unsatisfactory");
      case "unable_to_demonstrate": return unsat("unable to demonstrate");
      case "unable_to_determine":
        return t.undeterminable === "exclude" ? excl("unable to determine, excluded")
          : t.undeterminable === "unsatisfactory" ? unsat("unable to determine, counted unsatisfactory")
          : miss("unable to determine, treated as missing");
    }
  }
  const chk = validateResponse(item, r, fieldKey);
  if (!chk.ok) return { ...base, status: "missing", answered: false, hasResponse, state: null, why: `invalid response: ${chk.issues[0]?.message}` };
  const sat = computeSatisfactory(item, r, fieldKey);
  return {
    ...base,
    status: sat === true ? "satisfactory" : sat === false ? "unsatisfactory" : "neutral",
    answered: true, hasResponse, state: null, satisfactory: sat,
    ordinal: levelOrdinal(spec, r), numeric: numericValue(spec, r), credit: creditOf(spec, r), codes: answerCodes(spec, r),
    why: sat === true ? "satisfactory" : sat === false ? "unsatisfactory" : "answered, no pass or fail meaning",
  };
}

const evalAll = (def: InstrumentDef, responses: Responses, defaults?: Treatment): Map<string, FieldEval> =>
  new Map(def.items.map((i) => [i.stable_key, evalField(i, PRIMARY, responses, defaults)]));

/** Why a critical item counts as failed, or null. An empty critical_requirements list is treated as must_be_satisfactory. */
export function criticalFailure(item: InstrumentItem, ev: FieldEval): string | null {
  if (!item.critical) return null;
  const reqs = item.critical_requirements.length ? item.critical_requirements : ["must_be_satisfactory" as const];
  if (reqs.includes("must_be_observed") && ev.state === "not_observed") return "not observed (must be observed)";
  if ((reqs.includes("must_be_satisfactory") || reqs.includes("auto_fail")) && ev.status === "unsatisfactory") return reqs.includes("auto_fail") ? "unsatisfactory (automatic fail)" : "unsatisfactory (must be satisfactory)";
  return null;
}

export const evidenceMissingFor = (item: InstrumentItem, ev: FieldEval, ctx?: EvalContext): boolean => {
  const req = item.evidence_requirement;
  if (!req || !req.required || ev.status === "excluded") return false;
  return (ctx?.evidenceCounts?.[item.stable_key] ?? 0) < (req.min_count ?? 1);
};

// ── progress (indicators) ────────────────────────────────────────────────────────────────────────────────────
export interface ItemProgress {
  key: string;
  /** primary answered and every required secondary field answered */
  complete: boolean;
  unassessed: boolean;
  missingFields: string[];
  missingEvidence: boolean;
  criticalFailed: boolean;
  primary: FieldEval;
}
export function itemProgress(item: InstrumentItem, responses: Responses, ctx?: EvalContext, defaults?: Treatment): ItemProgress {
  const primary = evalField(item, PRIMARY, responses, defaults);
  const missingFields = (item.fields ?? []).filter((f) => f.required && !evalField(item, f.field_key, responses, defaults).answered).map((f) => f.field_key);
  return {
    key: item.stable_key,
    complete: primary.answered && missingFields.length === 0,
    unassessed: !primary.hasResponse || primary.state === "not_assessed",
    missingFields,
    missingEvidence: evidenceMissingFor(item, primary, ctx),
    criticalFailed: criticalFailure(item, primary) !== null,
    primary,
  };
}

export interface Progress {
  total: number;
  completed: number;
  unassessed: number;
  /** answered false but not unassessed (for example not observed treated as missing, or a required field missing) */
  incomplete: number;
  critical: { total: number; failed: number; unanswered: number };
  missingEvidence: number;
  missingFields: number;
  mandatoryMissing: number;
  /** completion share, 0 to 100. This is a progress figure, not a score. */
  percentComplete: number;
}
export function progress(def: InstrumentDef, responses: Responses, ctx?: EvalContext, defaults?: Treatment): Progress {
  const ps = def.items.map((i) => itemProgress(i, responses, ctx, defaults));
  const by = new Map(def.items.map((i, n) => [i.stable_key, ps[n]]));
  const crit = def.items.filter((i) => i.critical);
  const completed = ps.filter((p) => p.complete).length;
  const unassessed = ps.filter((p) => p.unassessed).length;
  return {
    total: def.items.length,
    completed,
    unassessed,
    incomplete: ps.filter((p) => !p.complete && !p.unassessed).length,
    critical: {
      total: crit.length,
      failed: crit.filter((i) => by.get(i.stable_key)!.criticalFailed).length,
      unanswered: crit.filter((i) => !by.get(i.stable_key)!.primary.answered).length,
    },
    missingEvidence: ps.filter((p) => p.missingEvidence).length,
    missingFields: ps.reduce((a, p) => a + p.missingFields.length, 0),
    mandatoryMissing: def.items.filter((i) => (i.mandatory || i.critical) && !by.get(i.stable_key)!.primary.answered).length,
    percentComplete: def.items.length ? round6((completed / def.items.length) * 100) : 0,
  };
}

/** The lowest rating ordinal answered per group (null when the group has none). Input for progression evidence. */
export function groupMinOrdinals(def: InstrumentDef, responses: Responses): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const g of def.groups) out[g.code] = null;
  for (const i of def.items) {
    if (!i.group_code || i.response_type !== "rating_scale") continue;
    const o = evalField(i, PRIMARY, responses).ordinal;
    if (o === null) continue;
    const cur = out[i.group_code];
    out[i.group_code] = cur === null || cur === undefined ? o : Math.min(cur, o);
  }
  return out;
}

// ── tests, predicates, aggregates ────────────────────────────────────────────────────────────────────────────
export function testHolds(test: Test, ev: FieldEval): boolean {
  if ("state" in test) return ev.state === test.state;
  if ("satisfactory" in test) return ev.status === (test.satisfactory ? "satisfactory" : "unsatisfactory");
  if ("levelAtLeast" in test) return ev.ordinal !== null && ev.ordinal >= test.levelAtLeast;
  if ("levelAtMost" in test) return ev.ordinal !== null && ev.ordinal <= test.levelAtMost;
  if ("value" in test) return ev.numeric !== null && compare(test.value.op, ev.numeric, test.value.n);
  if ("answered" in test) return ev.answered === test.answered;
  throw new RulesError("unknown test");
}

export interface AggregateTrace {
  id: string;
  fn: string;
  value: number | null;
  included: { key: string; code: string; weight: number; value: number | null }[];
  excluded: { key: string; code: string; why: string }[];
}

function weightOf(def: InstrumentDef, item: InstrumentItem, mode: AggregateDef["weights"]): number {
  if (mode === "none") return 1;
  if (mode === "section") return def.sections.find((s) => s.stable_key === item.section_key)?.weight ?? 1;
  return item.weight;
}

export function computeAggregate(def: InstrumentDef, agg: AggregateDef, evals: Map<string, FieldEval>, permitOrdinalMean: boolean): AggregateTrace {
  const items = selectItems(def, agg.over);
  if (agg.fn === "mean_numeric" && !permitOrdinalMean && items.some((i) => i.response_type === "rating_scale")) {
    throw new RulesError(`aggregate "${agg.id}": a mean over ordinal rating values is refused unless permitOrdinalMean is true`);
  }
  const included: AggregateTrace["included"] = [];
  const excluded: AggregateTrace["excluded"] = [];
  const rows: { w: number; v: number; sat?: boolean }[] = [];
  for (const it of items) {
    const ev = evals.get(it.stable_key)!;
    const w = weightOf(def, it, agg.weights);
    const out = (why: string) => excluded.push({ key: it.stable_key, code: it.code, why });
    const inc = (v: number | null, extra?: { sat?: boolean }) => { included.push({ key: it.stable_key, code: it.code, weight: w, value: v }); rows.push({ w, v: v ?? 0, ...extra }); };
    if (ev.status === "excluded") { out(ev.why); continue; }
    switch (agg.fn) {
      case "count":
        if (ev.answered) inc(1); else out(ev.why);
        break;
      case "sum": case "weighted_sum": case "mean_numeric":
        if (ev.answered && ev.numeric !== null) inc(ev.numeric); else out(ev.answered ? "no numeric value" : ev.why);
        break;
      case "percent_satisfactory":
        if (ev.status === "satisfactory") inc(1, { sat: true });
        else if (ev.status === "unsatisfactory") inc(0, { sat: false });
        else out(ev.status === "neutral" ? "no pass or fail meaning" : ev.why);
        break;
      case "credit_percent":
        if (ev.credit !== null && ev.answered) inc(ev.credit); else out(ev.answered ? "no credit figure" : ev.why);
        break;
      case "min_ordinal": case "max_ordinal":
        if (ev.ordinal !== null) inc(ev.ordinal); else out(ev.answered ? "no ordinal level" : ev.why);
        break;
      default: throw new RulesError(`unknown aggregate function ${String(agg.fn)}`);
    }
  }
  let value: number | null = null;
  const wsum = rows.reduce((a, r) => a + r.w, 0);
  switch (agg.fn) {
    case "count": value = rows.length; break;
    case "sum": value = rows.length ? round6(rows.reduce((a, r) => a + r.v, 0)) : null; break;
    case "weighted_sum": value = rows.length ? round6(rows.reduce((a, r) => a + r.v * r.w, 0)) : null; break;
    case "mean_numeric": value = rows.length && wsum > 0 ? round6(rows.reduce((a, r) => a + r.v * r.w, 0) / wsum) : null; break;
    case "percent_satisfactory": value = rows.length && wsum > 0 ? round6((rows.filter((r) => r.sat).reduce((a, r) => a + r.w, 0) / wsum) * 100) : null; break;
    case "credit_percent": value = rows.length && wsum > 0 ? round6((rows.reduce((a, r) => a + r.v * r.w, 0) / wsum) * 100) : null; break;
    case "min_ordinal": value = rows.length ? Math.min(...rows.map((r) => r.v)) : null; break;
    case "max_ordinal": value = rows.length ? Math.max(...rows.map((r) => r.v)) : null; break;
  }
  return { id: agg.id, fn: agg.fn, value, included, excluded };
}

// ── counts per scope (findings summary, no percentage) ───────────────────────────────────────────────────────
export interface ScopeCounts {
  items: number;
  answered: number;
  unanswered: number;
  satisfactory: number;
  unsatisfactory: number;
  neutral: number;
  excluded: number;
  /** satisfactory + unsatisfactory: the items a percentage would be computed over. No percentage is computed here. */
  denominator: number;
  exclusions: { key: string; code: string; why: string }[];
  /** answers by code: level codes, yes/no values, option codes, and "state:<state>" for states */
  byAnswer: Record<string, number>;
}
export interface Counts { overall: ScopeCounts; sections: Record<string, ScopeCounts>; groups: Record<string, ScopeCounts> }

function countScope(items: InstrumentItem[], evals: Map<string, FieldEval>): ScopeCounts {
  const c: ScopeCounts = { items: items.length, answered: 0, unanswered: 0, satisfactory: 0, unsatisfactory: 0, neutral: 0, excluded: 0, denominator: 0, exclusions: [], byAnswer: {} };
  for (const it of items) {
    const ev = evals.get(it.stable_key)!;
    if (ev.answered) c.answered++; else c.unanswered++;
    if (ev.status === "satisfactory") c.satisfactory++;
    else if (ev.status === "unsatisfactory") c.unsatisfactory++;
    else if (ev.status === "neutral") c.neutral++;
    else if (ev.status === "excluded") { c.excluded++; c.exclusions.push({ key: it.stable_key, code: it.code, why: ev.why }); }
    for (const code of ev.codes) c.byAnswer[code] = (c.byAnswer[code] ?? 0) + 1;
  }
  c.denominator = c.satisfactory + c.unsatisfactory;
  return c;
}

export function computeCounts(def: InstrumentDef, evals: Map<string, FieldEval>): Counts {
  const clo = sectionClosure(def);
  const sections: Record<string, ScopeCounts> = {};
  for (const s of def.sections) {
    const set = clo.get(s.stable_key)!;
    sections[s.stable_key] = countScope(def.items.filter((i) => set.has(i.section_key)), evals);
  }
  const groups: Record<string, ScopeCounts> = {};
  for (const g of def.groups) groups[g.code] = countScope(def.items.filter((i) => i.group_code === g.code), evals);
  return { overall: countScope(def.items, evals), sections, groups };
}

// ── evaluation ───────────────────────────────────────────────────────────────────────────────────────────────
export interface OutcomeRef { code: string; label: string; class: OutcomeClass }
export interface GateResult { triggered: boolean; items: { key: string; code: string; why: string }[] }
export type TraceStep =
  | { kind: "gate"; gate: "criticalFail" | "mandatoryMissing"; triggered: boolean; items: GateResult["items"]; outcome: string | null }
  | ({ kind: "aggregate" } & AggregateTrace)
  | { kind: "rule"; scope: string; id: string; priority: number; matched: boolean; leaves: { pred: string; value: boolean; detail?: unknown }[] }
  | { kind: "fallback"; scope: string; outcome: string }
  | { kind: "skipped"; scope: string; why: string }
  | { kind: "decision"; by: string; outcome: string };

export interface Evaluation {
  engine_version: string;
  rules_hash: string;
  outcome: OutcomeRef;
  class: OutcomeClass;
  decided_by: string;
  groupOutcomes: Record<string, OutcomeRef>;
  aggregates: Record<string, number | null>;
  gates: { criticalFail: GateResult; mandatoryMissing: GateResult; reassess: string[] };
  counts: Counts;
  trace: TraceStep[];
  traceHash: string;
}

export function evaluate(def: InstrumentDef, doc: RulesDoc, responses: Responses, ctx: EvalContext = {}): Evaluation {
  const outcomes = new Map(doc.outcomes.map((o) => [o.code, o]));
  const ref = (code: string): OutcomeRef => {
    const o = outcomes.get(code);
    if (!o) throw new RulesError(`unknown outcome "${code}"`);
    return { code: o.code, label: o.label, class: o.class };
  };
  const evals = evalAll(def, responses, doc.defaults);
  const trace: TraceStep[] = [];

  // 1. gates
  const critItems: GateResult["items"] = [];
  const reassess: string[] = [];
  for (const it of def.items) {
    const why = criticalFailure(it, evals.get(it.stable_key)!);
    if (why) { critItems.push({ key: it.stable_key, code: it.code, why }); if (it.critical_requirements.includes("reassess")) reassess.push(it.stable_key); }
  }
  const misItems: GateResult["items"] = def.items
    .filter((i) => (i.mandatory || i.critical) && !evals.get(i.stable_key)!.answered)
    .map((i) => ({ key: i.stable_key, code: i.code, why: evals.get(i.stable_key)!.why }));
  const gates = {
    criticalFail: { triggered: critItems.length > 0, items: critItems },
    mandatoryMissing: { triggered: misItems.length > 0, items: misItems },
    reassess,
  };
  trace.push({ kind: "gate", gate: "criticalFail", triggered: gates.criticalFail.triggered, items: critItems, outcome: doc.gates?.criticalFail ?? null });
  trace.push({ kind: "gate", gate: "mandatoryMissing", triggered: gates.mandatoryMissing.triggered, items: misItems, outcome: doc.gates?.mandatoryMissing ?? null });

  // 2. aggregates
  const aggregates: Record<string, number | null> = {};
  for (const a of doc.aggregates ?? []) {
    const t = computeAggregate(def, a, evals, !!doc.permitOrdinalMean);
    aggregates[a.id] = t.value;
    trace.push({ kind: "aggregate", ...t });
  }

  const groupOutcomes: Record<string, OutcomeRef> = {};
  const fieldEval = (it: InstrumentItem, fk: string): FieldEval => (fk === PRIMARY ? evals.get(it.stable_key)! : evalField(it, fk, responses, doc.defaults));
  const leafEval = (p: Pred): { value: boolean; detail?: unknown } => evalPred(def, p, evals, aggregates, groupOutcomes, ctx, fieldEval);
  const runRules = (scope: string, rules: Rule[], fallback: string): string => {
    const ordered = rules.map((r, n) => ({ r, n })).sort((a, b) => b.r.priority - a.r.priority || a.n - b.n);
    for (const { r } of ordered) {
      const e = evalCond<Pred>(r.when as Cond<Pred>, leafEval);
      trace.push({ kind: "rule", scope, id: r.id, priority: r.priority, matched: e.value, leaves: e.leaves.map((l) => ({ pred: canonicalJson(l.pred), value: l.value, detail: l.detail })) });
      if (e.value) return r.then.outcome;
    }
    trace.push({ kind: "fallback", scope, outcome: fallback });
    return fallback;
  };

  // 3. groups
  for (const g of doc.groups ?? []) groupOutcomes[g.group] = ref(runRules(`group:${g.group}`, g.rules, g.fallback));

  // 4. decision
  let outcome: OutcomeRef;
  let decided_by: string;
  if (gates.criticalFail.triggered) {
    if (!doc.gates?.criticalFail) throw new RulesError("a critical item failed but rules.gates.criticalFail names no outcome");
    outcome = ref(doc.gates.criticalFail); decided_by = "gate:criticalFail";
    trace.push({ kind: "skipped", scope: "overall", why: "critical gate fired" });
  } else if (gates.mandatoryMissing.triggered) {
    if (!doc.gates?.mandatoryMissing) throw new RulesError("a mandatory item is missing but rules.gates.mandatoryMissing names no outcome");
    outcome = ref(doc.gates.mandatoryMissing); decided_by = "gate:mandatoryMissing";
    trace.push({ kind: "skipped", scope: "overall", why: "mandatory gate fired" });
  } else {
    const before = trace.length;
    const code = runRules("overall", doc.rules, doc.fallback);
    outcome = ref(code);
    const matched = trace.slice(before).find((t) => t.kind === "rule" && t.matched) as Extract<TraceStep, { kind: "rule" }> | undefined;
    decided_by = matched ? `rule:${matched.id}` : "fallback";
  }
  trace.push({ kind: "decision", by: decided_by, outcome: outcome.code });

  const counts = computeCounts(def, evals);
  const traceHash = sha256Hex(canonicalJson({ engine: ENGINE_VERSION, outcome: outcome.code, trace }));
  return {
    engine_version: ENGINE_VERSION, rules_hash: hashDoc(doc), outcome, class: outcome.class, decided_by,
    groupOutcomes, aggregates, gates, counts, trace, traceHash,
  };
}

function evalPred(
  def: InstrumentDef, p: Pred, evals: Map<string, FieldEval>, aggs: Record<string, number | null>,
  groups: Record<string, OutcomeRef>, ctx: EvalContext, fieldEval: (it: InstrumentItem, fk: string) => FieldEval,
): { value: boolean; detail?: unknown } {
  if ("count" in p) {
    const items = selectItems(def, p.count);
    const n = items.filter((i) => testHolds(p.where, evals.get(i.stable_key)!)).length;
    return { value: compare(p.op, n, p.value), detail: { observed: n, of: items.length } };
  }
  if ("aggregate" in p) {
    if (!(p.aggregate in aggs)) throw new RulesError(`unknown aggregate "${p.aggregate}"`);
    const v = aggs[p.aggregate];
    return { value: v !== null && compare(p.op, v, p.value), detail: { observed: v } };
  }
  if ("item" in p) {
    const it = def.items.find((i) => i.stable_key === p.item);
    if (!it) throw new RulesError(`unknown item "${p.item}"`);
    const ev = fieldEval(it, p.field ?? PRIMARY);
    return { value: testHolds(p.test, ev), detail: { observed: ev.status } };
  }
  if ("criticalFailed" in p) {
    const bad = selectItems(def, p.criticalFailed).filter((i) => i.critical && criticalFailure(i, evals.get(i.stable_key)!) !== null);
    return { value: bad.length > 0, detail: { observed: bad.map((i) => i.code) } };
  }
  if ("mandatoryMissing" in p) {
    const bad = selectItems(def, p.mandatoryMissing).filter((i) => (i.mandatory || i.critical) && !evals.get(i.stable_key)!.answered);
    return { value: bad.length > 0, detail: { observed: bad.map((i) => i.code) } };
  }
  if ("evidenceMissing" in p) {
    const bad = selectItems(def, p.evidenceMissing).filter((i) => evidenceMissingFor(i, evals.get(i.stable_key)!, ctx));
    return { value: bad.length > 0, detail: { observed: bad.map((i) => i.code) } };
  }
  if ("groupOutcome" in p) {
    const g = groups[p.groupOutcome];
    return { value: !!g && g.code === p.is, detail: { observed: g?.code ?? null } };
  }
  throw new RulesError("unknown predicate");
}

/** Human-readable lines for a result (report, preview). Words come from the rules the author wrote. */
export function explain(doc: RulesDoc, e: Evaluation): string[] {
  const out: string[] = [];
  if (e.decided_by === "gate:criticalFail") out.push(`${e.outcome.label}: a critical item failed (${e.gates.criticalFail.items.map((i) => `${i.code} ${i.why}`).join("; ")}).`);
  else if (e.decided_by === "gate:mandatoryMissing") out.push(`${e.outcome.label}: mandatory items are not answered (${e.gates.mandatoryMissing.items.map((i) => i.code).join(", ")}).`);
  else if (e.decided_by === "fallback") out.push(`${e.outcome.label}: no rule matched, so the fallback applies.`);
  else {
    const r = doc.rules.find((x) => `rule:${x.id}` === e.decided_by);
    out.push(`${e.outcome.label}: ${r?.explain ?? r?.label ?? e.decided_by}.`);
  }
  return out;
}

export type { Selector };
export { allowedStates };
