// asmt core: the Test Scoring preview. A saved test is { responses, expect }. runTests evaluates each and reports the
// mismatches in words. Tests are saved in scoring_tests and re-run at submit and at publish.
// Preset generators build the four standard starting points; they always produce VALID responses.
import { evaluate, RulesError, type Evaluation } from "./scoring";
import { computeSatisfactory, fieldSpec, validateResponse, allowedStates } from "./responses";
import type { RulesDoc } from "./rules-ast";
import { PRIMARY, rkey, type EvalContext, type InstrumentDef, type InstrumentItem, type OutcomeClass, type ResponseValue, type Responses } from "./types";

export interface ScoringTestCase {
  id: string;
  name: string;
  responses: Responses;
  evidence?: Record<string, number>;
  expect: {
    outcome?: string;
    class?: OutcomeClass;
    gate?: "criticalFail" | "mandatoryMissing" | null;
    ruleId?: string;
    groupOutcomes?: Record<string, string>;
    aggregates?: Record<string, number | null>;
  };
}

export interface TestResult {
  id: string;
  name: string;
  ok: boolean;
  mismatches: string[];
  actual: { outcome: string; class: OutcomeClass; decided_by: string; aggregates: Record<string, number | null>; groupOutcomes: Record<string, string> } | null;
  traceHash: string | null;
}
export interface TestRun { passed: number; failed: number; results: TestResult[] }

export function runTests(def: InstrumentDef, doc: RulesDoc, tests: ScoringTestCase[]): TestRun {
  const results: TestResult[] = tests.map((t) => {
    let ev: Evaluation;
    try { ev = evaluate(def, doc, t.responses, { evidenceCounts: t.evidence } as EvalContext); }
    catch (e) {
      const msg = e instanceof RulesError ? e.message : String(e);
      return { id: t.id, name: t.name, ok: false, mismatches: [`could not evaluate: ${msg}`], actual: null, traceHash: null };
    }
    const mm: string[] = [];
    const x = t.expect;
    if (x.outcome !== undefined && ev.outcome.code !== x.outcome) mm.push(`outcome is ${ev.outcome.code}, expected ${x.outcome}`);
    if (x.class !== undefined && ev.class !== x.class) mm.push(`class is ${ev.class}, expected ${x.class}`);
    if (x.gate !== undefined) {
      const g = ev.decided_by.startsWith("gate:") ? ev.decided_by.slice(5) : null;
      if (g !== x.gate) mm.push(`gate is ${g ?? "none"}, expected ${x.gate ?? "none"}`);
    }
    if (x.ruleId !== undefined && ev.decided_by !== `rule:${x.ruleId}`) mm.push(`decided by ${ev.decided_by}, expected rule:${x.ruleId}`);
    for (const [g, code] of Object.entries(x.groupOutcomes ?? {})) if (ev.groupOutcomes[g]?.code !== code) mm.push(`group ${g} is ${ev.groupOutcomes[g]?.code ?? "none"}, expected ${code}`);
    for (const [id, v] of Object.entries(x.aggregates ?? {})) if (ev.aggregates[id] !== v) mm.push(`aggregate ${id} is ${String(ev.aggregates[id])}, expected ${String(v)}`);
    return {
      id: t.id, name: t.name, ok: mm.length === 0, mismatches: mm, traceHash: ev.traceHash,
      actual: { outcome: ev.outcome.code, class: ev.class, decided_by: ev.decided_by, aggregates: ev.aggregates, groupOutcomes: Object.fromEntries(Object.entries(ev.groupOutcomes).map(([k, v]) => [k, v.code])) },
    };
  });
  return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

// ── preset generators ────────────────────────────────────────────────────────────────────────────────────────
function candidates(item: InstrumentItem, fieldKey: string): ResponseValue[] {
  const sp = fieldSpec(item, fieldKey)!;
  const c = sp.config;
  const out: ResponseValue[] = [];
  switch (sp.response_type) {
    case "rating_scale": [...(sp.scale?.levels ?? [])].sort((a, b) => b.ordinal - a.ordinal).forEach((l) => out.push({ level_code: l.code })); break;
    case "yes_no": out.push({ value: "yes" }, { value: "no" }); break;
    case "pass_fail": out.push({ value: "pass" }, { value: "fail" }); break;
    case "achieved": out.push({ value: "achieved" }, { value: "not_achieved" }); break;
    case "numeric_rating": case "measurement": {
      const mn = typeof c.min === "number" ? c.min : undefined, mx = typeof c.max === "number" ? c.max : undefined;
      const raw = [c.satisfactoryMin, c.satisfactoryMax, mn, mx, c.satisfactoryMin !== undefined ? c.satisfactoryMin - 1 : undefined, c.satisfactoryMax !== undefined ? c.satisfactoryMax + 1 : undefined, 0, 1];
      for (const n of raw) if (typeof n === "number") out.push({ value: n });
      break;
    }
    case "multiple_choice": for (const o of c.options ?? []) out.push({ value: c.select === "multi" ? [o.code] : o.code }); break;
    case "free_text": out.push({ value: "Test response" }); break;
    case "datetime": out.push({ value: "2000-01-01T00:00:00Z" }); break;
    case "evidence": out.push({ value: c.minCount ?? 1 }, { value: 0 }); break;
    case "na": break;
  }
  return out.filter((r) => validateResponse(item, r, fieldKey).ok);
}

/** A valid response whose satisfactory value is true, or the first valid response if the field has no pass meaning. */
export function satisfactoryResponse(item: InstrumentItem, fieldKey: string = PRIMARY): ResponseValue | null {
  const sp = fieldSpec(item, fieldKey);
  if (!sp) return null;
  if (sp.response_type === "na") return { state: "not_applicable", reason: "test" };
  const cs = candidates(item, fieldKey);
  return cs.find((r) => computeSatisfactory(item, r, fieldKey) === true) ?? cs[0] ?? null;
}

/** A valid response whose satisfactory value is false (or the unable_to_demonstrate state), or null if none exists. */
export function unsatisfactoryResponse(item: InstrumentItem): ResponseValue | null {
  const cs = candidates(item, PRIMARY);
  const hit = cs.find((r) => computeSatisfactory(item, r) === false);
  if (hit) return hit;
  const sp = fieldSpec(item)!;
  return allowedStates(sp).includes("unable_to_demonstrate") ? { state: "unable_to_demonstrate" } : null;
}

export const presetBlank = (): Responses => ({});

function fill(item: InstrumentItem, out: Responses): void {
  const p = satisfactoryResponse(item);
  if (p) out[rkey(item.stable_key)] = p;
  for (const f of item.fields ?? []) {
    if (!f.required) continue;
    const r = satisfactoryResponse(item, f.field_key);
    if (r) out[rkey(item.stable_key, f.field_key)] = r;
  }
}

/** Every item answered with a satisfactory (or, where the field has no pass meaning, a valid) response. */
export function presetAllSatisfactory(def: InstrumentDef): Responses {
  const out: Responses = {};
  for (const it of def.items) fill(it, out);
  return out;
}

/** All satisfactory, except one critical item (the given key, else the first critical item) answered unsatisfactory. */
export function presetOneCriticalFailed(def: InstrumentDef, itemKey?: string): Responses {
  const out = presetAllSatisfactory(def);
  const it = def.items.find((i) => (itemKey ? i.stable_key === itemKey : i.critical));
  if (!it) return out;
  const bad = unsatisfactoryResponse(it);
  if (bad) out[rkey(it.stable_key)] = bad;
  return out;
}

/** Not applicable wherever the item allows it. Items that do not allow it stay unanswered. */
export function presetAllNA(def: InstrumentDef): Responses {
  const out: Responses = {};
  for (const it of def.items) {
    const sp = fieldSpec(it)!;
    if (allowedStates(sp).includes("not_applicable")) out[rkey(it.stable_key)] = { state: "not_applicable", reason: sp.config.naReasonRequired ? "test" : null };
  }
  return out;
}
