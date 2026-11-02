// Pure helpers behind the rules builders: which tests are valid for which items, defaults for new blocks, and
// renaming an outcome everywhere it is used. No React. The engine's validators remain the judge; these helpers only
// keep the pickers from OFFERING what the validator would refuse.
import {
  allowedStates, fieldSpec, selectItems, PRIMARY,
  type AggFn, type FieldSpec, type InstrumentDef, type OutcomeDef, type Pred, type Rule, type RulesDoc, type Selector, type StateCode, type Test,
} from "@/lib/assessment/core";

export type TestKind = "state" | "satisfactory" | "levelAtLeast" | "levelAtMost" | "value" | "answered";
export const TEST_LABEL: Record<TestKind, string> = {
  state: "has the answer type (state)", satisfactory: "is met or not met", levelAtLeast: "is at or above level", levelAtMost: "is at or below level",
  value: "has a value", answered: "is answered or not",
};

const NOT_SCORED = ["free_text", "datetime", "na"];
export const satCapable = (s: FieldSpec) => !NOT_SCORED.includes(s.response_type);
export const numericCapable = (s: FieldSpec) =>
  ["numeric_rating", "measurement", "evidence"].includes(s.response_type) || (s.response_type === "rating_scale" && !!s.scale?.levels.some((l) => typeof l.numeric_value === "number"));

/** Primary specs of the items a selector picks. A bad selector picks nothing. */
export function specsFor(def: InstrumentDef, sel: Selector | true | undefined): FieldSpec[] {
  try { return selectItems(def, sel as Selector | true).map((i) => fieldSpec(i, PRIMARY)!).filter(Boolean); } catch { return []; }
}

/** The tests that can be true for at least one of these fields. Nothing the validator would refuse as a type mismatch. */
export function validTestKinds(specs: FieldSpec[], isPrimary: boolean): TestKind[] {
  const out: TestKind[] = ["answered"];
  if (specs.length === 0 || specs.some((s) => allowedStates(s).length > 0)) out.unshift("state");
  if (isPrimary && (specs.length === 0 || specs.some(satCapable))) out.unshift("satisfactory");
  if (specs.length === 0 || specs.some((s) => s.response_type === "rating_scale")) out.push("levelAtLeast", "levelAtMost");
  if (specs.length === 0 || specs.some(numericCapable)) out.push("value");
  return (["satisfactory", "state", "levelAtLeast", "levelAtMost", "value", "answered"] as TestKind[]).filter((k) => out.includes(k));
}

export function testKind(t: Test | undefined): TestKind | null {
  if (!t) return null;
  const k = Object.keys(t)[0] as TestKind | undefined;
  return k ?? null;
}

/** Ordinal levels of the rating scales among the specs (first scale wins a label), sorted. */
export function levelChoices(specs: FieldSpec[]): { ordinal: number; label: string }[] {
  const seen = new Map<number, string>();
  for (const s of specs) for (const l of s.scale?.levels ?? []) if (!seen.has(l.ordinal)) seen.set(l.ordinal, l.label);
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([ordinal, label]) => ({ ordinal, label }));
}

export function stateChoices(specs: FieldSpec[]): { state: StateCode; label: string }[] {
  const out = new Map<StateCode, string>();
  const list = specs.length ? specs : [];
  for (const s of list) for (const st of allowedStates(s)) if (!out.has(st)) out.set(st, labelOfState(s, st));
  return [...out.entries()].map(([state, label]) => ({ state, label }));
}
function labelOfState(s: FieldSpec, st: StateCode): string {
  return s.config.stateLabels?.[st] ?? s.scale?.states.find((x) => x.state === st)?.label ?? st.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function defaultTest(kind: TestKind, specs: FieldSpec[]): Test {
  switch (kind) {
    case "state": return { state: stateChoices(specs)[0]?.state ?? "not_assessed" };
    case "satisfactory": return { satisfactory: true };
    case "levelAtLeast": return { levelAtLeast: levelChoices(specs).slice(-1)[0]?.ordinal ?? 1 };
    case "levelAtMost": return { levelAtMost: levelChoices(specs)[0]?.ordinal ?? 0 };
    case "value": return { value: { op: ">=", n: 0 } };
    case "answered": return { answered: true };
  }
}

export const AGG_LABEL: Record<AggFn, string> = {
  count: "Count of items", sum: "Sum of values", weighted_sum: "Weighted sum", percent_satisfactory: "Percent met",
  min_ordinal: "Lowest level", max_ordinal: "Highest level", mean_numeric: "Mean value", credit_percent: "Credit percent",
};

/** Whether an aggregate function can work over these items (mirrors the validator's type_mismatch checks). */
export function aggApplicable(fn: AggFn, specs: FieldSpec[]): boolean {
  if (specs.length === 0 || fn === "count") return true;
  switch (fn) {
    case "mean_numeric": case "sum": case "weighted_sum": return specs.some(numericCapable);
    case "min_ordinal": case "max_ordinal": return specs.some((s) => s.response_type === "rating_scale");
    case "percent_satisfactory": return specs.some(satCapable);
    case "credit_percent": return specs.some((s) => s.response_type === "multiple_choice" && (s.config.options ?? []).some((o) => typeof o.credit === "number"));
    default: return true;
  }
}

export function uniqueId(prefix: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  let n = set.size + 1;
  while (set.has(`${prefix}_${n}`)) n++;
  return `${prefix}_${n}`;
}

export const allRuleIds = (doc: RulesDoc): string[] => [...doc.rules, ...(doc.groups ?? []).flatMap((g) => g.rules)].map((r) => r.id);

export function newPred(kind: string, def: InstrumentDef, doc: RulesDoc): Pred {
  switch (kind) {
    case "aggregate": return { aggregate: doc.aggregates?.[0]?.id ?? "", op: ">=", value: 0 };
    case "item": return { item: def.items[0]?.stable_key ?? "", test: { answered: true } };
    case "criticalFailed": return { criticalFailed: true };
    case "mandatoryMissing": return { mandatoryMissing: true };
    case "evidenceMissing": return { evidenceMissing: true };
    case "groupOutcome": return { groupOutcome: def.groups[0]?.code ?? "", is: doc.outcomes[0]?.code ?? "" };
    default: return { count: { scope: "all" }, where: { satisfactory: true }, op: ">=", value: 1 };
  }
}

export function newRule(def: InstrumentDef, doc: RulesDoc): Rule {
  const top = Math.max(0, ...doc.rules.map((r) => r.priority));
  const hasAgg = !!doc.aggregates?.length;
  return {
    id: uniqueId("rule", allRuleIds(doc)), label: "New rule", priority: top + 10,
    when: newPred(hasAgg ? "aggregate" : "count", def, doc), then: { outcome: doc.outcomes[0]?.code ?? "" },
  };
}

export function newOutcome(doc: RulesDoc): OutcomeDef {
  return { code: uniqueId("OUTCOME", doc.outcomes.map((o) => o.code)).toUpperCase(), label: "New outcome", class: "partial" };
}

/** Rename an outcome code everywhere it is referenced. */
export function renameOutcome(doc: RulesDoc, from: string, to: string): RulesDoc {
  if (from === to) return doc;
  const swap = (c: string) => (c === from ? to : c);
  const walk = (c: unknown): unknown => {
    if (Array.isArray(c)) return c.map(walk);
    if (c && typeof c === "object") {
      const o = c as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) out[k] = k === "is" && typeof v === "string" ? swap(v) : walk(v);
      return out;
    }
    return c;
  };
  const rule = (r: Rule): Rule => ({ ...r, when: walk(r.when) as Rule["when"], then: { ...r.then, outcome: swap(r.then.outcome) } });
  const next: RulesDoc = {
    ...doc,
    outcomes: doc.outcomes.map((o) => (o.code === from ? { ...o, code: to } : o)),
    rules: doc.rules.map(rule), fallback: swap(doc.fallback),
  };
  if (doc.gates) next.gates = { ...doc.gates, ...(doc.gates.criticalFail === from ? { criticalFail: to } : {}), ...(doc.gates.mandatoryMissing === from ? { mandatoryMissing: to } : {}) };
  if (doc.groups) next.groups = doc.groups.map((g) => ({ ...g, rules: g.rules.map(rule), fallback: swap(g.fallback) }));
  return next;
}

export const without = <T extends object>(o: T, key: keyof T): T => { const c = { ...o }; delete c[key]; return c; };
export const setAt = <T,>(list: T[], i: number, v: T): T[] => list.map((x, n) => (n === i ? v : x));
export const removeAt = <T,>(list: T[], i: number): T[] => list.filter((_, n) => n !== i);
