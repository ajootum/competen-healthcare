// asmt core: validators for the three grammars. Run live in the builders, again server-side at submit and at publish.
// Every function returns { errors, warnings }. Anything in `errors` blocks publication.
//
//   validateDefinition(def)                      structure of the instrument itself
//   validateRules(def, doc)                      asmt.rules/1 (design s4): unknown keys / operators, unresolved refs,
//                                                type mismatches, gate outcomes, coverage + fallback, ambiguity,
//                                                unreachable rules, weight and percentage ranges
//   revalidateTemplate(def, template)            a copied scoring template is validated again against THIS version
//   validateProgression(doc, scale, def?)        asmt.progression/1 (design s7)
//   validateLayout(layout, def?, opts?)          asmt.layout/1 closed vocabulary; a layout can never hide or reorder items
import {
  boolAtoms, condKind, dnfIntersects, dnfShadowed, leafKey, numAtoms, setAtoms, toBoxes, walkLeaves,
  type Atomizer, type Box, type Cond, type NumDomain,
} from "./cond";
import {
  AGG_FNS, AGGREGATE_KEYS, AVAILABLE_PRESENTATIONS, BADGES, CONTROL_VOCAB, GROUPINGS, HEADER_BLOCKS, ITEM_COMPONENTS, ITEM_SELECTOR_KEYS,
  LAYOUT_SCHEMA, LAYOUT_TOP_KEYS, NAV_KEYS, NAV_MODES, NAV_PROGRESS, NAV_UNITS, OPS, PRED_ALLOWED, PRED_KEYS, PRESENTATIONS,
  PRINT_KEYS, PROFILE_KEYS, PROG_TOP_KEYS, PROGRESSION_SCHEMA, RULE_KEYS, RULES_SCHEMA, RULES_TOP_KEYS, SCOPES, SECTION_COMPONENTS, SELECTOR_KEYS,
  SLOT_KEYS, SLOT_VALUES, TEST_KEYS, WEIGHT_MODES, WHERE_KEYS,
  type LayoutDoc, type Pred, type ProgPred, type ProgressionDoc, type Rule, type RulesDoc, type Selector, type StageScale,
} from "./rules-ast";
import { progressionAtomizer } from "./progression";
import { allowedStates, fieldSpec, type FieldSpec } from "./responses";
import { selectItems } from "./select";
import { runTests } from "./testing";
import type { ScoringTestCase } from "./testing";
import {
  ATTESTATIONS, CRITICAL_REQUIREMENTS, OUTCOME_CLASSES, PRIMARY, RESPONSE_TYPES, STATE_CODES,
  type InstrumentDef, type InstrumentItem, type Issue, type ValidationResult,
} from "./types";

type Rec = Record<string, unknown>;
const isObj = (x: unknown): x is Rec => !!x && typeof x === "object" && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === "string" && x.length > 0;
const BIG = 1e14;

class Collector {
  errors: Issue[] = [];
  warnings: Issue[] = [];
  err(code: string, path: string, message: string) { this.errors.push({ code, path, message }); }
  warn(code: string, path: string, message: string) { this.warnings.push({ code, path, message }); }
  result(): ValidationResult { return { errors: this.errors, warnings: this.warnings }; }
}

function checkKeys(o: Rec, allowed: readonly string[], path: string, c: Collector, layoutMode = false): void {
  for (const k of Object.keys(o)) {
    if (allowed.includes(k)) continue;
    if (layoutMode && (ITEM_SELECTOR_KEYS as readonly string[]).includes(k)) {
      c.err("layout_item_selector", `${path}.${k}`, `"${k}" would select, hide, filter or reorder items. A layout can only change how items look, never which items appear or in what order.`);
    } else c.err("unknown_key", `${path}.${k}`, `Unknown key "${k}".`);
  }
}

// ── definition ───────────────────────────────────────────────────────────────────────────────────────────────
export function validateDefinition(def: InstrumentDef): ValidationResult {
  const c = new Collector();
  const secKeys = new Set<string>();
  def.sections.forEach((s, i) => {
    if (secKeys.has(s.stable_key)) c.err("duplicate_key", `sections[${i}]`, `Duplicate section key ${s.stable_key}.`);
    secKeys.add(s.stable_key);
    if (!(s.weight >= 0) || !Number.isFinite(s.weight)) c.err("weight_range", `sections[${i}].weight`, "A weight must be zero or more.");
  });
  def.sections.forEach((s, i) => { if (s.parent_section_key && !secKeys.has(s.parent_section_key)) c.err("unresolved_ref", `sections[${i}].parent_section_key`, "Parent section does not exist."); });
  const groups = new Set(def.groups.map((g) => g.code));
  def.groups.forEach((g, i) => { if (!(g.weight >= 0) || !Number.isFinite(g.weight)) c.err("weight_range", `groups[${i}].weight`, "A weight must be zero or more."); });
  const itemKeys = new Set<string>();
  def.items.forEach((it, i) => {
    const p = `items[${i}]`;
    if (itemKeys.has(it.stable_key)) c.err("duplicate_key", p, `Duplicate item key ${it.stable_key}.`);
    itemKeys.add(it.stable_key);
    if (!secKeys.has(it.section_key)) c.err("unresolved_ref", `${p}.section_key`, "Section does not exist.");
    if (it.group_code && !groups.has(it.group_code)) c.err("unresolved_ref", `${p}.group_code`, `Group "${it.group_code}" does not exist.`);
    if (!(RESPONSE_TYPES as readonly string[]).includes(it.response_type)) c.err("unknown_type", `${p}.response_type`, `Unknown response type "${it.response_type}".`);
    if (!(it.weight >= 0) || !Number.isFinite(it.weight)) c.err("weight_range", `${p}.weight`, "A weight must be zero or more.");
    if (it.critical && !it.mandatory) c.err("critical_not_mandatory", p, "A critical item must also be mandatory.");
    if (it.critical && it.critical_requirements.length === 0) c.warn("critical_default", p, "A critical item with no requirements is treated as must_be_satisfactory.");
    for (const r of it.critical_requirements) if (!(CRITICAL_REQUIREMENTS as readonly string[]).includes(r)) c.err("unknown_key", `${p}.critical_requirements`, `Unknown critical requirement "${r}".`);
    const specs: FieldSpec[] = [fieldSpec(it)!, ...(it.fields ?? []).map((f) => fieldSpec(it, f.field_key)!)];
    const seen = new Set<string>();
    (it.fields ?? []).forEach((f, n) => {
      if (!/^[a-z][a-z0-9_]{1,40}$/.test(f.field_key) || f.field_key === PRIMARY) c.err("bad_field_key", `${p}.fields[${n}]`, `Field key "${f.field_key}" is not allowed.`);
      if (seen.has(f.field_key)) c.err("duplicate_key", `${p}.fields[${n}]`, `Duplicate field key ${f.field_key}.`);
      seen.add(f.field_key);
    });
    for (const sp of specs) {
      const q = sp.field_key === PRIMARY ? p : `${p}.fields.${sp.field_key}`;
      if (sp.response_type === "rating_scale" && (!sp.scale || sp.scale.levels.length === 0)) c.err("no_scale", q, "A rating scale field needs a scale with levels.");
      if (sp.response_type === "multiple_choice" && !(sp.config.options ?? []).length) c.err("no_options", q, "A multiple choice field needs options.");
      for (const o of sp.config.options ?? []) if (o.credit !== undefined && o.credit !== null && !(o.credit >= 0 && o.credit <= 1)) c.err("credit_range", q, `Option ${o.code} credit must be between 0 and 1.`);
      for (const s of sp.config.allowedStates ?? []) if (!(STATE_CODES as readonly string[]).includes(s)) c.err("unknown_state", q, `Unknown state "${s}".`);
    }
  });
  return c.result();
}

// ── selectors and tests ──────────────────────────────────────────────────────────────────────────────────────
function checkSelector(def: InstrumentDef, sel: unknown, path: string, c: Collector): InstrumentItem[] | null {
  if (sel === true) return selectItems(def, true);
  if (!isObj(sel)) { c.err("bad_selector", path, "A selector is an object with a scope."); return null; }
  checkKeys(sel, SELECTOR_KEYS, path, c);
  if (!(SCOPES as readonly string[]).includes(sel.scope as string)) { c.err("unknown_scope", `${path}.scope`, `Unknown scope "${String(sel.scope)}".`); return null; }
  let ok = true;
  if (sel.scope !== "all") {
    const keys = sel.keys;
    if (!Array.isArray(keys) || keys.length === 0 || !keys.every(isStr)) { c.err("bad_selector", `${path}.keys`, "This scope needs a non-empty list of keys."); return null; }
    const valid = sel.scope === "section" ? new Set(def.sections.map((s) => s.stable_key)) : sel.scope === "group" ? new Set(def.groups.map((g) => g.code)) : new Set(def.items.map((i) => i.stable_key));
    for (const k of keys as string[]) if (!valid.has(k)) { c.err("unresolved_ref", `${path}.keys`, `"${k}" does not exist in this ${sel.scope === "items" ? "item list" : sel.scope}.`); ok = false; }
  }
  for (const f of ["critical", "mandatory"]) if (f in sel && typeof sel[f] !== "boolean") c.err("bad_selector", `${path}.${f}`, `${f} must be true or false.`);
  if ("methods" in sel && !(Array.isArray(sel.methods) && (sel.methods as unknown[]).every(isStr))) c.err("bad_selector", `${path}.methods`, "methods must be a list of method codes.");
  if (!ok) return null;
  const items = selectItems(def, sel as unknown as Selector);
  if (items.length === 0) c.warn("empty_selection", path, "This selector picks no items, so it is never true.");
  return items;
}

const NUMERIC_TYPES = ["numeric_rating", "measurement", "evidence"];
const numericCapable = (s: FieldSpec) => NUMERIC_TYPES.includes(s.response_type) || (s.response_type === "rating_scale" && !!s.scale?.levels.some((l) => typeof l.numeric_value === "number"));
const satCapable = (s: FieldSpec) => !["free_text", "datetime", "na"].includes(s.response_type);

function checkTest(test: unknown, specs: FieldSpec[], isPrimary: boolean, path: string, c: Collector): void {
  if (!isObj(test)) { c.err("bad_test", path, "A test is an object with exactly one key."); return; }
  const keys = Object.keys(test);
  if (keys.length !== 1) { c.err("bad_test", path, "A test has exactly one key."); return; }
  const k = keys[0];
  if (!(TEST_KEYS as readonly string[]).includes(k)) { c.err("unknown_key", `${path}.${k}`, `Unknown test "${k}".`); return; }
  const v = test[k];
  const mismatch = (what: string, ok: FieldSpec[]) => {
    if (specs.length && ok.length === 0) c.err("type_mismatch", path, `${what} cannot apply to the selected items, which are ${Array.from(new Set(specs.map((s) => s.response_type))).join(", ")}.`);
    else if (ok.length < specs.length) c.warn("partial_type_mismatch", path, `${what} only applies to some of the selected items.`);
  };
  switch (k) {
    case "state":
      if (!(STATE_CODES as readonly string[]).includes(v as string)) { c.err("unknown_state", path, `Unknown state "${String(v)}".`); break; }
      if (specs.length && !specs.some((s) => allowedStates(s).includes(v as never))) c.warn("state_not_allowed", path, `No selected item allows the state "${String(v)}", so this is never true.`);
      break;
    case "satisfactory":
      if (typeof v !== "boolean") { c.err("bad_test", path, "satisfactory must be true or false."); break; }
      if (!isPrimary) { c.err("type_mismatch", path, "Only the primary field is scored satisfactory or not."); break; }
      mismatch("A satisfactory test", specs.filter(satCapable));
      break;
    case "levelAtLeast": case "levelAtMost": {
      if (!isNum(v)) { c.err("bad_test", path, `${k} needs a number.`); break; }
      const ok = specs.filter((s) => s.response_type === "rating_scale");
      mismatch(`A level test`, ok);
      if (ok.length) {
        const ords = ok.flatMap((s) => s.scale?.levels.map((l) => l.ordinal) ?? []);
        if (ords.length && k === "levelAtLeast" && v > Math.max(...ords)) c.err("level_out_of_range", path, `No level reaches ${v}. The highest is ${Math.max(...ords)}.`);
        if (ords.length && k === "levelAtMost" && v < Math.min(...ords)) c.err("level_out_of_range", path, `No level is as low as ${v}. The lowest is ${Math.min(...ords)}.`);
      }
      break;
    }
    case "value": {
      if (!isObj(v) || !(OPS as readonly string[]).includes(v.op as string) || !isNum(v.n)) { c.err("bad_test", path, "value needs { op, n }."); break; }
      checkKeys(v, ["op", "n"], path, c);
      mismatch("A numeric value test", specs.filter(numericCapable));
      break;
    }
    case "answered":
      if (typeof v !== "boolean") c.err("bad_test", path, "answered must be true or false.");
      break;
  }
}

// ── rules ────────────────────────────────────────────────────────────────────────────────────────────────────
function itemRangeDomain(specs: FieldSpec[]): NumDomain {
  const ords = specs.filter((s) => s.response_type === "rating_scale").flatMap((s) => s.scale?.levels.map((l) => l.ordinal) ?? []);
  return ords.length ? { lo: Math.min(...ords), hi: Math.max(...ords), int: true, none: true } : { lo: -BIG, hi: BIG, int: true, none: true };
}

function rulesAtomizer(def: InstrumentDef, doc: RulesDoc): Atomizer<Pred> {
  const aggs = new Map((doc.aggregates ?? []).map((a) => [a.id, a]));
  const codes = doc.outcomes.map((o) => o.code);
  return (p, neg) => {
    if ("count" in p) {
      const n = selectItems(def, p.count).length;
      return numAtoms(`count|${leafKey(p.count)}|${leafKey(p.where)}`, p.op, p.value, neg, { lo: 0, hi: n, int: true, none: false });
    }
    if ("aggregate" in p) {
      const a = aggs.get(p.aggregate);
      const dom: NumDomain = !a ? { lo: -BIG, hi: BIG, int: false, none: true }
        : a.fn === "count" ? { lo: 0, hi: BIG, int: true, none: false }
        : a.fn === "percent_satisfactory" || a.fn === "credit_percent" ? { lo: 0, hi: 100, int: false, none: true }
        : { lo: -BIG, hi: BIG, int: false, none: true };
      return numAtoms(`agg|${p.aggregate}`, p.op, p.value, neg, dom);
    }
    if ("item" in p) {
      const it = def.items.find((i) => i.stable_key === p.item);
      const fk = p.field ?? PRIMARY;
      const sp = it ? fieldSpec(it, fk) : null;
      const base = `item|${p.item}|${fk}`;
      const t = p.test as Rec;
      if ("state" in t) return setAtoms(`${base}|state`, [t.state as string], [...STATE_CODES, "value"], neg);
      if ("satisfactory" in t) return setAtoms(`${base}|sat`, [t.satisfactory ? "true" : "false"], ["true", "false", "other"], neg);
      if ("answered" in t) return boolAtoms(`${base}|answered`, !!t.answered, neg);
      if ("levelAtLeast" in t) return numAtoms(`${base}|level`, ">=", t.levelAtLeast as number, neg, itemRangeDomain(sp ? [sp] : []));
      if ("levelAtMost" in t) return numAtoms(`${base}|level`, "<=", t.levelAtMost as number, neg, itemRangeDomain(sp ? [sp] : []));
      if ("value" in t) { const v = t.value as { op: never; n: number }; return numAtoms(`${base}|value`, v.op, v.n, neg, { lo: -BIG, hi: BIG, int: false, none: true }); }
      return boolAtoms(`opaque|${leafKey(p)}`, true, neg);
    }
    if ("criticalFailed" in p) return boolAtoms(`crit|${leafKey(p.criticalFailed)}`, true, neg);
    if ("mandatoryMissing" in p) return boolAtoms(`mand|${leafKey(p.mandatoryMissing)}`, true, neg);
    if ("evidenceMissing" in p) return boolAtoms(`evid|${leafKey(p.evidenceMissing)}`, true, neg);
    if ("groupOutcome" in p) return setAtoms(`grp|${p.groupOutcome}`, [p.is], codes, neg);
    return boolAtoms(`opaque|${leafKey(p)}`, true, neg);
  };
}

function checkPred(def: InstrumentDef, doc: RulesDoc, p: unknown, path: string, c: Collector, inGroup: boolean): void {
  if (!isObj(p)) { c.err("bad_predicate", path, "A predicate is an object."); return; }
  const main = (PRED_KEYS as readonly string[]).filter((k) => k in p);
  if (main.length !== 1) { c.err("unknown_predicate", path, main.length ? "A predicate has exactly one kind." : `Unknown predicate. Allowed kinds: ${PRED_KEYS.join(", ")}.`); return; }
  const kind = main[0] as (typeof PRED_KEYS)[number];
  checkKeys(p, PRED_ALLOWED[kind], path, c);
  const opOk = (op: unknown) => { if (!(OPS as readonly string[]).includes(op as string)) { c.err("unknown_operator", `${path}.op`, `Unknown operator "${String(op)}".`); return false; } return true; };
  switch (kind) {
    case "count": {
      const items = checkSelector(def, p.count, `${path}.count`, c);
      const specs = (items ?? []).map((i) => fieldSpec(i)!);
      checkTest(p.where, specs, true, `${path}.where`, c);
      opOk(p.op);
      if (!isNum(p.value) || p.value < 0) c.err("bad_value", `${path}.value`, "A count compares with a number, zero or more.");
      else if (items && p.value > items.length && (p.op === "=" || p.op === ">=" || p.op === ">")) c.warn("count_out_of_range", path, `Only ${items.length} items are selected, so this count can never reach ${p.value}.`);
      break;
    }
    case "aggregate": {
      const a = (doc.aggregates ?? []).find((x) => x.id === p.aggregate);
      if (!a) { c.err("unresolved_ref", `${path}.aggregate`, `Aggregate "${String(p.aggregate)}" is not defined.`); }
      opOk(p.op);
      if (!isNum(p.value)) c.err("bad_value", `${path}.value`, "An aggregate compares with a number.");
      else if (a && (a.fn === "percent_satisfactory" || a.fn === "credit_percent") && (p.value < 0 || p.value > 100)) c.err("percent_range", `${path}.value`, "A percentage is between 0 and 100.");
      break;
    }
    case "item": {
      const it = def.items.find((i) => i.stable_key === p.item);
      if (!it) { c.err("unresolved_ref", `${path}.item`, `Item "${String(p.item)}" does not exist.`); break; }
      const fk = typeof p.field === "string" ? p.field : PRIMARY;
      const sp = fieldSpec(it, fk);
      if (!sp) { c.err("unresolved_ref", `${path}.field`, `Item ${it.code} has no field "${fk}".`); break; }
      if ("field" in p && typeof p.field !== "string") c.err("bad_value", `${path}.field`, "field is a field key.");
      checkTest(p.test, [sp], fk === PRIMARY, `${path}.test`, c);
      break;
    }
    case "criticalFailed": case "mandatoryMissing": case "evidenceMissing":
      checkSelector(def, p[kind], `${path}.${kind}`, c);
      break;
    case "groupOutcome":
      if (inGroup) c.err("group_cycle", path, "A group rule cannot read another group's outcome. Group rules are evaluated first, one level, with no cycles.");
      if (!def.groups.some((g) => g.code === p.groupOutcome) && !(doc.groups ?? []).some((g) => g.group === p.groupOutcome)) c.err("unresolved_ref", `${path}.groupOutcome`, `Group "${String(p.groupOutcome)}" does not exist.`);
      if (!doc.outcomes.some((o) => o.code === p.is)) c.err("unresolved_ref", `${path}.is`, `Outcome "${String(p.is)}" is not declared.`);
      break;
  }
}

function checkCond(def: InstrumentDef, doc: RulesDoc, cond: unknown, path: string, c: Collector, inGroup: boolean): void {
  const k = condKind(cond);
  if (k === "invalid") { c.err("bad_condition", path, "A condition is one of all, any, not, or a predicate."); return; }
  if (k === "all" || k === "any") {
    const arr = (cond as Rec)[k];
    if (!Array.isArray(arr) || arr.length === 0) { c.err("bad_condition", `${path}.${k}`, `${k} needs a non-empty list.`); return; }
    arr.forEach((x, i) => checkCond(def, doc, x, `${path}.${k}[${i}]`, c, inGroup));
  } else if (k === "not") checkCond(def, doc, (cond as Rec).not, `${path}.not`, c, inGroup);
  else checkPred(def, doc, cond, path, c, inGroup);
}

interface RuleAnalysis { reachable: Set<string> }

function analyseRuleList(rules: Rule[], atomize: Atomizer<Pred>, path: string, c: Collector): RuleAnalysis {
  const reachable = new Set<string>();
  const boxes = rules.map((r, i) => {
    try { return toBoxes(r.when as Cond<Pred>, atomize); } catch { c.err("bad_condition", `${path}[${i}]`, "This condition could not be analysed."); return "too_complex" as const; }
  });
  const known = (i: number): Box[] | null => (boxes[i] === "too_complex" ? null : (boxes[i] as Box[]));
  rules.forEach((r, i) => {
    if (boxes[i] === "too_complex") c.err("too_complex", `${path}[${i}]`, `Rule "${r.id}" is too complex to check: it expands to more than 256 terms. Split it into simpler rules.`);
  });
  // ambiguity: equal priority, different outcomes, intersecting boxes
  for (let i = 0; i < rules.length; i++) for (let j = i + 1; j < rules.length; j++) {
    const a = known(i), b = known(j);
    if (!a || !b) continue;
    if (rules[i].priority === rules[j].priority && rules[i].then.outcome !== rules[j].then.outcome && dnfIntersects(a, b)) {
      c.err("ambiguous", `${path}[${j}]`, `Rules "${rules[i].id}" and "${rules[j].id}" have the same priority, can both be true at once, and give different outcomes. Give them different priorities or make their conditions exclusive.`);
    }
  }
  // unreachable: no satisfiable box, or every box inside one box of a rule that is evaluated first
  rules.forEach((r, i) => {
    const mine = known(i);
    if (!mine) { reachable.add(r.then.outcome); return; }
    if (mine.length === 0) { c.err("unreachable", `${path}[${i}]`, `Rule "${r.id}" can never be true: its conditions contradict each other.`); return; }
    const higher: Box[] = [];
    rules.forEach((h, j) => {
      if (j === i) return;
      const first = h.priority > r.priority || (h.priority === r.priority && j < i && h.then.outcome === r.then.outcome);
      const hb = known(j);
      if (first && hb) higher.push(...hb);
    });
    if (dnfShadowed(mine, higher)) { c.err("unreachable", `${path}[${i}]`, `Rule "${r.id}" can never fire: higher-priority rules always match first.`); return; }
    reachable.add(r.then.outcome);
  });
  return { reachable };
}

export function validateRules(def: InstrumentDef, doc: RulesDoc): ValidationResult {
  const c = new Collector();
  if (!isObj(doc)) { c.err("bad_doc", "", "The rules document must be an object."); return c.result(); }
  const d = doc as unknown as Rec;
  checkKeys(d, RULES_TOP_KEYS, "", c);
  if (d.schema !== RULES_SCHEMA) c.err("bad_schema", "schema", `schema must be "${RULES_SCHEMA}".`);
  if (d.profile !== undefined) {
    if (!isObj(d.profile)) c.err("bad_profile", "profile", "profile is an object { id, label, version, formula?, notes? }.");
    else {
      checkKeys(d.profile, PROFILE_KEYS, "profile", c);
      for (const k of ["id", "label", "version"]) if (!isStr((d.profile as Rec)[k])) c.err("bad_profile", `profile.${k}`, `profile.${k} is text.`);
      for (const k of ["formula", "notes"]) if ((d.profile as Rec)[k] !== undefined && !isStr((d.profile as Rec)[k])) c.err("bad_profile", `profile.${k}`, `profile.${k} is text.`);
    }
  }

  // outcomes
  const outcomes = Array.isArray(doc.outcomes) ? doc.outcomes : [];
  if (outcomes.length === 0) c.err("no_outcomes", "outcomes", "Declare at least one outcome.");
  const codes = new Set<string>();
  outcomes.forEach((o, i) => {
    if (!isObj(o)) { c.err("bad_outcome", `outcomes[${i}]`, "An outcome is { code, label, class }."); return; }
    checkKeys(o, ["code", "label", "class"], `outcomes[${i}]`, c);
    if (!isStr(o.code)) c.err("bad_outcome", `outcomes[${i}].code`, "An outcome needs a code.");
    else if (codes.has(o.code)) c.err("duplicate_key", `outcomes[${i}].code`, `Duplicate outcome code ${o.code}.`);
    else codes.add(o.code);
    if (!isStr(o.label)) c.err("bad_outcome", `outcomes[${i}].label`, "An outcome needs a label.");
    if (!(OUTCOME_CLASSES as readonly string[]).includes(o.class as string)) c.err("bad_outcome", `outcomes[${i}].class`, `Class must be one of ${OUTCOME_CLASSES.join(", ")}.`);
  });
  const classOf = (code: string) => outcomes.find((o) => o.code === code)?.class;
  const needOutcome = (code: unknown, path: string): boolean => {
    if (!isStr(code) || !codes.has(code)) { c.err("unresolved_ref", path, `Outcome "${String(code)}" is not declared.`); return false; }
    return true;
  };

  // gates
  const anyCritical = def.items.some((i) => i.critical);
  const anyMandatory = def.items.some((i) => i.mandatory || i.critical);
  const gates = (isObj(d.gates) ? d.gates : {}) as Rec;
  if ("gates" in d && !isObj(d.gates)) c.err("bad_gates", "gates", "gates is an object.");
  checkKeys(gates, ["criticalFail", "mandatoryMissing"], "gates", c);
  if (anyCritical && !gates.criticalFail) c.err("gate_missing", "gates.criticalFail", "An item is critical, so the criticalFail gate must name a negative outcome.");
  if (anyMandatory && !gates.mandatoryMissing) c.err("gate_missing", "gates.mandatoryMissing", "An item is mandatory, so the mandatoryMissing gate must name an incomplete outcome.");
  if (gates.criticalFail && needOutcome(gates.criticalFail, "gates.criticalFail") && classOf(gates.criticalFail as string) !== "negative") c.err("gate_class", "gates.criticalFail", "The criticalFail outcome must have class negative.");
  if (gates.mandatoryMissing && needOutcome(gates.mandatoryMissing, "gates.mandatoryMissing") && classOf(gates.mandatoryMissing as string) !== "incomplete") c.err("gate_class", "gates.mandatoryMissing", "The mandatoryMissing outcome must have class incomplete.");

  // defaults
  if (d.defaults !== undefined) {
    if (!isObj(d.defaults)) c.err("bad_defaults", "defaults", "defaults is an object.");
    else {
      checkKeys(d.defaults, ["na", "notObserved", "unable", "undeterminable"], "defaults", c);
      const allow: Rec = { na: ["exclude", "count_unsatisfactory"], notObserved: ["missing", "unsatisfactory"], unable: ["unsatisfactory"], undeterminable: ["missing", "unsatisfactory", "exclude"] };
      for (const k of Object.keys(d.defaults)) if (allow[k] && !(allow[k] as string[]).includes((d.defaults as Rec)[k] as string)) c.err("bad_defaults", `defaults.${k}`, `${k} must be one of ${(allow[k] as string[]).join(", ")}.`);
    }
  }

  // weights
  def.items.forEach((it, i) => { if (!(it.weight >= 0) || !Number.isFinite(it.weight)) c.err("weight_range", `items[${i}].weight`, "A weight must be zero or more."); });
  def.sections.forEach((s, i) => { if (!(s.weight >= 0) || !Number.isFinite(s.weight)) c.err("weight_range", `sections[${i}].weight`, "A weight must be zero or more."); });
  def.groups.forEach((g, i) => { if (!(g.weight >= 0) || !Number.isFinite(g.weight)) c.err("weight_range", `groups[${i}].weight`, "A weight must be zero or more."); });

  // aggregates
  const aggIds = new Set<string>();
  (Array.isArray(doc.aggregates) ? doc.aggregates : []).forEach((a, i) => {
    const p = `aggregates[${i}]`;
    if (!isObj(a)) { c.err("bad_aggregate", p, "An aggregate is an object."); return; }
    checkKeys(a, AGGREGATE_KEYS, p, c);
    if (!isStr(a.id)) c.err("bad_aggregate", `${p}.id`, "An aggregate needs an id."); else if (aggIds.has(a.id)) c.err("duplicate_key", `${p}.id`, `Duplicate aggregate id ${a.id}.`); else aggIds.add(a.id);
    if (!(AGG_FNS as readonly string[]).includes(a.fn as string)) { c.err("unknown_function", `${p}.fn`, `Unknown function "${String(a.fn)}".`); return; }
    if (!(WEIGHT_MODES as readonly string[]).includes(a.weights as string)) c.err("unknown_key", `${p}.weights`, `weights must be one of ${WEIGHT_MODES.join(", ")}.`);
    const items = checkSelector(def, a.over, `${p}.over`, c);
    if (!items) return;
    const specs = items.map((x) => fieldSpec(x)!);
    switch (a.fn) {
      case "mean_numeric":
        if (items.some((x) => x.response_type === "rating_scale")) {
          if (!doc.permitOrdinalMean) c.err("ordinal_mean", p, "A mean over ordinal rating values is refused: the gap between levels is not a fixed amount. Turn on permitOrdinalMean to allow it, and a reviewer will see that you did.");
          else c.warn("ordinal_mean_permitted", p, "This mean averages ordinal ratings. permitOrdinalMean is on.");
        }
        if (!specs.some(numericCapable)) c.err("type_mismatch", p, "No selected item has a numeric value to average.");
        break;
      case "sum": case "weighted_sum":
        if (!specs.some(numericCapable)) c.err("type_mismatch", p, "No selected item has a numeric value to add up.");
        break;
      case "min_ordinal": case "max_ordinal":
        if (!specs.some((s) => s.response_type === "rating_scale")) c.err("type_mismatch", p, "No selected item is a rating scale item.");
        break;
      case "percent_satisfactory":
        if (!specs.some(satCapable)) c.err("type_mismatch", p, "No selected item can be satisfactory or not.");
        break;
      case "credit_percent":
        if (!specs.some((s) => s.response_type === "multiple_choice" && (s.config.options ?? []).some((o) => typeof o.credit === "number"))) c.err("type_mismatch", p, "No selected item has options with a credit figure.");
        break;
    }
    if (a.weights === "item" && items.length && items.every((x) => x.weight === 0)) c.warn("zero_weights", p, "Every selected item has weight zero, so this aggregate is empty.");
  });

  // rules and groups
  const ruleIds = new Set<string>();
  const checkRule = (r: unknown, path: string, inGroup: boolean) => {
    if (!isObj(r)) { c.err("bad_rule", path, "A rule is an object."); return; }
    checkKeys(r, RULE_KEYS, path, c);
    if (!isStr(r.id)) c.err("bad_rule", `${path}.id`, "A rule needs an id."); else if (ruleIds.has(r.id)) c.err("duplicate_key", `${path}.id`, `Duplicate rule id ${r.id}.`); else ruleIds.add(r.id);
    if (!isStr(r.label)) c.err("bad_rule", `${path}.label`, "A rule needs a label.");
    if (!Number.isInteger(r.priority)) c.err("bad_rule", `${path}.priority`, "priority is a whole number.");
    if ("explain" in r && typeof r.explain !== "string") c.err("bad_rule", `${path}.explain`, "explain is text.");
    if (!isObj(r.then)) c.err("bad_rule", `${path}.then`, "then is { outcome }."); else { checkKeys(r.then, ["outcome"], `${path}.then`, c); needOutcome(r.then.outcome, `${path}.then.outcome`); }
    checkCond(def, doc, r.when, `${path}.when`, c, inGroup);
  };
  const overall = Array.isArray(doc.rules) ? doc.rules : [];
  if (!Array.isArray(doc.rules)) c.err("bad_rules", "rules", "rules is a list.");
  overall.forEach((r, i) => checkRule(r, `rules[${i}]`, false));
  needOutcome(doc.fallback, "fallback");
  if (!doc.fallback) c.err("fallback_required", "fallback", "A fallback outcome is required: say what happens when no rule matches.");
  const groupRules = Array.isArray(doc.groups) ? doc.groups : [];
  const seenGroups = new Set<string>();
  groupRules.forEach((g, gi) => {
    const p = `groups[${gi}]`;
    if (!isObj(g)) { c.err("bad_rule", p, "A group rule set is an object."); return; }
    checkKeys(g, ["group", "rules", "fallback"], p, c);
    if (!def.groups.some((x) => x.code === g.group)) c.err("unresolved_ref", `${p}.group`, `Group "${String(g.group)}" does not exist.`);
    if (seenGroups.has(g.group)) c.err("duplicate_key", `${p}.group`, `Group ${g.group} has two rule sets.`);
    seenGroups.add(g.group);
    if (!g.fallback) c.err("fallback_required", `${p}.fallback`, "Each group needs a fallback outcome."); else needOutcome(g.fallback, `${p}.fallback`);
    (Array.isArray(g.rules) ? g.rules : []).forEach((r, i) => checkRule(r, `${p}.rules[${i}]`, true));
  });

  // analysis only when the structure is sound (analysis reads the same fields)
  if (c.errors.length === 0) {
    const atomize = rulesAtomizer(def, doc);
    const reach = new Set<string>();
    groupRules.forEach((g, gi) => {
      const a = analyseRuleList(g.rules, atomize, `groups[${gi}].rules`, c);
      a.reachable.forEach((x) => reach.add(x));
      reach.add(g.fallback);
    });
    const a = analyseRuleList(overall, atomize, "rules", c);
    a.reachable.forEach((x) => reach.add(x));
    reach.add(doc.fallback);
    if (anyCritical && doc.gates?.criticalFail) reach.add(doc.gates.criticalFail);
    if (anyMandatory && doc.gates?.mandatoryMissing) reach.add(doc.gates.mandatoryMissing);
    for (const o of doc.outcomes) if (!reach.has(o.code)) c.err("uncovered_outcome", "outcomes", `Outcome "${o.label}" (${o.code}) can never be the result: no rule that can fire, no fallback and no gate gives it.`);
    if (doc.permitOrdinalMean) c.warn("ordinal_mean_enabled", "permitOrdinalMean", "permitOrdinalMean is on: reviewers will see that ordinal ratings may be averaged.");
  }
  return c.result();
}

/** A scoring template copied into an instrument version is validated again against THAT version, and its saved tests run. */
export function revalidateTemplate(def: InstrumentDef, template: { rules: RulesDoc; tests?: ScoringTestCase[] }): ValidationResult {
  const r = validateRules(def, template.rules);
  const out: ValidationResult = { errors: r.errors.map((e) => ({ ...e, code: `template_${e.code}` })), warnings: r.warnings.map((e) => ({ ...e, code: `template_${e.code}` })) };
  if (out.errors.length === 0 && template.tests?.length) {
    const t = runTests(def, template.rules, template.tests);
    for (const x of t.results) if (!x.ok) out.errors.push({ code: "template_test_failed", path: `tests.${x.id}`, message: `Saved test "${x.name}" no longer passes: ${x.mismatches.join("; ")}` });
  }
  return out;
}

// ── progression ──────────────────────────────────────────────────────────────────────────────────────────────
export function validateProgression(doc: ProgressionDoc, scale: StageScale, def?: InstrumentDef): ValidationResult {
  const c = new Collector();
  if (!isObj(doc)) { c.err("bad_doc", "", "The progression document must be an object."); return c.result(); }
  const d = doc as unknown as Rec;
  checkKeys(d, PROG_TOP_KEYS, "", c);
  if (d.schema !== PROGRESSION_SCHEMA) c.err("bad_schema", "schema", `schema must be "${PROGRESSION_SCHEMA}".`);
  const stages = new Set(scale.stages.map((s) => s.code));
  scale.bands.forEach((b, i) => {
    if (!stages.has(b.stage)) c.err("unresolved_ref", `stageScale.bands[${i}]`, `Band stage "${b.stage}" is not in the stage scale.`);
    if (b.from_ordinal > b.to_ordinal) c.err("bad_band", `stageScale.bands[${i}]`, "A band starts at or below where it ends.");
  });
  if (!isStr(d.notStaged) || (d.notStaged !== "unstaged" && !stages.has(d.notStaged))) c.err("bad_value", "notStaged", 'notStaged is "unstaged" or a stage in the scale.');
  if (!isObj(d.target)) c.err("bad_value", "target", "target is { stage } or { fromProgramme: true }.");
  else if ("stage" in d.target) { checkKeys(d.target, ["stage"], "target", c); if (!stages.has(d.target.stage as string)) c.err("unresolved_ref", "target.stage", `Stage "${String(d.target.stage)}" is not in the stage scale.`); }
  else if (d.target.fromProgramme === true) checkKeys(d.target, ["fromProgramme"], "target", c);
  else c.err("bad_value", "target", "target is { stage } or { fromProgramme: true }.");
  if (!isObj(d.evidence)) c.err("bad_value", "evidence", "evidence is { attestation, methods?, withinDays? }.");
  else {
    checkKeys(d.evidence, ["attestation", "methods", "withinDays"], "evidence", c);
    const at = d.evidence.attestation;
    if (!Array.isArray(at) || at.length === 0 || !at.every((x) => (ATTESTATIONS as readonly string[]).includes(x as string))) c.err("bad_value", "evidence.attestation", "attestation lists one or more of the attestations.");
    else if (at.includes("self_reported")) c.err("self_evidence", "evidence.attestation", "Self-reported evidence can never support a stage. Remove self_reported.");
    if ("methods" in d.evidence && !(Array.isArray(d.evidence.methods) && (d.evidence.methods as unknown[]).every(isStr))) c.err("bad_value", "evidence.methods", "methods is a list of method codes.");
    if ("withinDays" in d.evidence && !(isNum(d.evidence.withinDays) && d.evidence.withinDays > 0)) c.err("bad_value", "evidence.withinDays", "withinDays is a positive number of days.");
  }
  if (!["latest", "best", "all_must_meet"].includes(d.repeated as string)) c.err("bad_value", "repeated", "repeated is latest, best or all_must_meet.");
  if (!["latest", "lowest"].includes(d.conflicting as string)) c.err("bad_value", "conflicting", "conflicting is latest or lowest.");
  if (typeof d.permitOrdinalMean !== "boolean") c.err("bad_value", "permitOrdinalMean", "permitOrdinalMean is true or false.");
  else if (d.permitOrdinalMean) c.warn("ordinal_mean_enabled", "permitOrdinalMean", "permitOrdinalMean is on. Progression never averages ordinals itself, so this has no effect.");
  if (typeof d.permitSingleAssessment !== "boolean") c.err("bad_value", "permitSingleAssessment", "permitSingleAssessment is true or false.");
  else if (d.permitSingleAssessment) c.warn("single_assessment_permitted", "permitSingleAssessment", "A stage can be conferred from a single assessment. A reviewer will see that this is on.");

  const checkWhere = (w: unknown, path: string) => {
    if (w === undefined) return;
    if (!isObj(w)) { c.err("bad_value", path, "where is an object."); return; }
    checkKeys(w, WHERE_KEYS, path, c);
    if ("attestation" in w) {
      if (!(ATTESTATIONS as readonly string[]).includes(w.attestation as string)) c.err("bad_value", `${path}.attestation`, "Unknown attestation.");
      else if (w.attestation === "self_reported") c.err("self_evidence", `${path}.attestation`, "Self-reported evidence is never counted.");
    }
    if ("method" in w && !isStr(w.method)) c.err("bad_value", `${path}.method`, "method is a method code.");
    if ("outcomeClass" in w && !(OUTCOME_CLASSES as readonly string[]).includes(w.outcomeClass as string)) c.err("bad_value", `${path}.outcomeClass`, "Unknown outcome class.");
    if ("minLevelStage" in w) {
      const m = w.minLevelStage;
      if (!isObj(m)) c.err("bad_value", `${path}.minLevelStage`, "minLevelStage is { group, atLeast }.");
      else {
        checkKeys(m, ["group", "atLeast"], `${path}.minLevelStage`, c);
        if (def && !def.groups.some((g) => g.code === m.group)) c.err("unresolved_ref", `${path}.minLevelStage.group`, `Group "${String(m.group)}" does not exist.`);
        if (!stages.has(m.atLeast as string)) c.err("unresolved_ref", `${path}.minLevelStage.atLeast`, `Stage "${String(m.atLeast)}" is not in the stage scale.`);
      }
    }
  };
  const opOk = (op: unknown, path: string) => { if (!(OPS as readonly string[]).includes(op as string)) c.err("unknown_operator", path, `Unknown operator "${String(op)}".`); };
  const rules = Array.isArray(d.stageRules) ? (d.stageRules as { stage: string; when: Cond<ProgPred> }[]) : [];
  if (!Array.isArray(d.stageRules) || rules.length === 0) c.err("bad_value", "stageRules", "Give at least one stage rule.");
  const seenStage = new Set<string>();
  rules.forEach((r, i) => {
    const p = `stageRules[${i}]`;
    if (!isObj(r)) { c.err("bad_rule", p, "A stage rule is { stage, when }."); return; }
    checkKeys(r, ["stage", "when"], p, c);
    if (!stages.has(r.stage)) c.err("unresolved_ref", `${p}.stage`, `Stage "${String(r.stage)}" is not in the stage scale.`);
    if (seenStage.has(r.stage)) c.err("duplicate_key", `${p}.stage`, `Stage ${r.stage} has two rules.`);
    seenStage.add(r.stage);
    const k0 = condKind(r.when);
    if (k0 === "invalid") { c.err("bad_condition", `${p}.when`, "A condition is one of all, any, not, or a predicate."); return; }
    walkLeaves<ProgPred>(r.when, (pr, path) => {
      const o = pr as unknown as Rec;
      const keys = ["count", "latest", "anyCriticalFailure", "distinctAssessors"].filter((k) => k in o);
      if (keys.length !== 1) { c.err("unknown_predicate", `${p}.${path}`, "Unknown progression predicate. Allowed: count, latest, anyCriticalFailure, distinctAssessors."); return; }
      const kind = keys[0];
      if (kind === "count") {
        checkKeys(o, ["count", "op", "value"], `${p}.${path}`, c);
        if (!isObj(o.count)) c.err("bad_value", `${p}.${path}.count`, "count is { where }."); else { checkKeys(o.count, ["where"], `${p}.${path}.count`, c); checkWhere(o.count.where, `${p}.${path}.count.where`); }
        opOk(o.op, `${p}.${path}.op`); if (!isNum(o.value) || o.value < 0) c.err("bad_value", `${p}.${path}.value`, "Compare with a number, zero or more.");
      } else if (kind === "distinctAssessors") {
        checkKeys(o, ["distinctAssessors", "op", "value"], `${p}.${path}`, c);
        if (!isObj(o.distinctAssessors)) c.err("bad_value", `${p}.${path}.distinctAssessors`, "distinctAssessors is { where? }."); else { checkKeys(o.distinctAssessors, ["where"], `${p}.${path}.distinctAssessors`, c); checkWhere(o.distinctAssessors.where, `${p}.${path}.distinctAssessors.where`); }
        opOk(o.op, `${p}.${path}.op`); if (!isNum(o.value) || o.value < 0) c.err("bad_value", `${p}.${path}.value`, "Compare with a number, zero or more.");
      } else if (kind === "latest") {
        checkKeys(o, ["latest"], `${p}.${path}`, c);
        const l = o.latest;
        if (!isObj(l) || !["outcomeClass", "outcomeCode"].includes(l.field as string) || !isStr(l.is)) c.err("bad_value", `${p}.${path}.latest`, "latest is { field: outcomeClass | outcomeCode, is }.");
        else if (l.field === "outcomeClass" && !(OUTCOME_CLASSES as readonly string[]).includes(l.is as string)) c.err("bad_value", `${p}.${path}.latest.is`, "Unknown outcome class.");
      } else {
        checkKeys(o, ["anyCriticalFailure"], `${p}.${path}`, c);
        const a = o.anyCriticalFailure;
        if (!isObj(a)) c.err("bad_value", `${p}.${path}.anyCriticalFailure`, "anyCriticalFailure is { withinDays? }."); else { checkKeys(a, ["withinDays"], `${p}.${path}.anyCriticalFailure`, c); if ("withinDays" in a && !(isNum(a.withinDays) && a.withinDays > 0)) c.err("bad_value", `${p}.${path}.anyCriticalFailure.withinDays`, "withinDays is a positive number."); }
      }
    }, (_n, path) => c.err("bad_condition", `${p}.${path}`, "A condition is one of all, any, not, or a predicate."));
  });

  if (c.errors.length === 0) {
    const atomize = progressionAtomizer(doc.repeated);
    rules.forEach((r, i) => {
      const boxes = toBoxes(r.when, atomize);
      if (boxes === "too_complex") { c.err("too_complex", `stageRules[${i}]`, `The rule for stage ${r.stage} is too complex to check: it expands to more than 256 terms.`); return; }
      if (boxes.length === 0) { c.err("unreachable", `stageRules[${i}]`, `The rule for stage ${r.stage} can never be true.${doc.repeated === "latest" ? ' With repeated "latest" only one record counts, so a count above 1 cannot be met.' : ""}`); return; }
      if (!doc.permitSingleAssessment && boxes.some(singleReachable)) {
        c.err("single_assessment", `stageRules[${i}]`, `Stage ${r.stage} can be reached from a single assessment. Require at least two assessments (or two assessors), or turn on permitSingleAssessment so a reviewer sees it.`);
      }
    });
  }
  return c.result();
}

/** A box is reachable with a single assessment when every record count and assessor count it constrains admits 1. */
function singleReachable(b: Box): boolean {
  for (const [v, k] of Object.entries(b)) {
    if ((v.startsWith("ecount|") || v.startsWith("assessors|")) && k.k === "num") {
      const { lo, hi, loOpen, hiOpen } = k.iv;
      if (!((lo < 1 || (lo === 1 && !loOpen)) && (hi > 1 || (hi === 1 && !hiOpen)))) return false;
    }
  }
  return true;
}

// ── layout ───────────────────────────────────────────────────────────────────────────────────────────────────
export function validateLayout(layout: LayoutDoc, def?: InstrumentDef, opts: { forPublication?: boolean } = {}): ValidationResult {
  const c = new Collector();
  if (!isObj(layout)) { c.err("bad_doc", "", "The layout must be an object."); return c.result(); }
  const l = layout as unknown as Rec;
  checkKeys(l, LAYOUT_TOP_KEYS, "", c, true);
  if (l.schema !== LAYOUT_SCHEMA) c.err("bad_schema", "schema", `schema must be "${LAYOUT_SCHEMA}".`);
  if (!(PRESENTATIONS as readonly string[]).includes(l.presentation as string)) c.err("unknown_presentation", "presentation", `Unknown presentation "${String(l.presentation)}".`);
  else if (!AVAILABLE_PRESENTATIONS.includes(l.presentation as never)) {
    if (opts.forPublication) c.err("presentation_not_available", "presentation", `The ${String(l.presentation)} presentation is not yet available.`);
    else c.warn("presentation_not_available", "presentation", `The ${String(l.presentation)} presentation is accepted but cannot be published yet.`);
  }
  const nav = l.navigation;
  if (!isObj(nav)) c.err("bad_value", "navigation", "navigation is an object.");
  else {
    checkKeys(nav, NAV_KEYS, "navigation", c, true);
    if (!(NAV_MODES as readonly string[]).includes(nav.mode as string)) c.err("unknown_component", "navigation.mode", `mode must be one of ${NAV_MODES.join(", ")}.`);
    if (!(NAV_UNITS as readonly string[]).includes(nav.unit as string)) c.err("unknown_component", "navigation.unit", `unit must be one of ${NAV_UNITS.join(", ")}.`);
    if (!(NAV_PROGRESS as readonly string[]).includes(nav.progress as string)) c.err("unknown_component", "navigation.progress", `progress must be one of ${NAV_PROGRESS.join(", ")}.`);
    for (const k of ["allowJump", "prevNext"]) if (typeof nav[k] !== "boolean") c.err("bad_value", `navigation.${k}`, `${k} is true or false.`);
    if ("sectionTabs" in nav) {
      if (!isObj(nav.sectionTabs) || typeof nav.sectionTabs.counts !== "boolean") c.err("bad_value", "navigation.sectionTabs", "sectionTabs is { counts: true | false }.");
      else checkKeys(nav.sectionTabs, ["counts"], "navigation.sectionTabs", c, true);
      if (nav.mode !== "section_tabs") c.warn("section_tabs_unused", "navigation.sectionTabs", "sectionTabs only shows when the navigation mode is section_tabs.");
    }
    if (l.presentation === "guided_assessment" && nav.mode === "scroll") c.warn("presentation_mismatch", "navigation.mode", "A guided assessment normally steps through the items.");
    if (l.presentation === "standard_checklist" && nav.mode === "stepper") c.warn("presentation_mismatch", "navigation.mode", "A standard checklist normally shows every item on one scrolling page.");
  }
  const header = l.header;
  if (!Array.isArray(header)) c.err("bad_value", "header", "header is a list of blocks.");
  else {
    header.forEach((h, i) => { if (!(HEADER_BLOCKS as readonly string[]).includes(h as string)) c.err("unknown_component", `header[${i}]`, `Unknown header block "${String(h)}". Allowed: ${HEADER_BLOCKS.join(", ")}.`); });
    if (new Set(header).size !== header.length) c.err("duplicate_key", "header", "A header block appears twice.");
    if (header.includes("MetadataBlock") && !(isObj(l.metadata) && Array.isArray(l.metadata.fields) && l.metadata.fields.length)) c.err("metadata_missing", "metadata", "MetadataBlock needs metadata.fields.");
  }
  if ("metadata" in l) {
    if (!isObj(l.metadata)) c.err("bad_value", "metadata", "metadata is { fields }.");
    else {
      checkKeys(l.metadata, ["fields"], "metadata", c, true);
      const seen = new Set<string>();
      (Array.isArray(l.metadata.fields) ? l.metadata.fields : []).forEach((f, i) => {
        if (!isObj(f)) { c.err("bad_value", `metadata.fields[${i}]`, "A metadata field is { key, label }."); return; }
        checkKeys(f, ["key", "label"], `metadata.fields[${i}]`, c, true);
        if (!isStr(f.key) || !/^[a-z][a-z0-9_]*$/.test(f.key)) c.err("bad_value", `metadata.fields[${i}].key`, "key is lower-case letters, digits and underscores.");
        else if (seen.has(f.key)) c.err("duplicate_key", `metadata.fields[${i}].key`, `Duplicate metadata key ${f.key}.`);
        else seen.add(f.key);
        if (!isStr(f.label)) c.err("bad_value", `metadata.fields[${i}].label`, "A metadata field needs a label.");
      });
    }
  }
  const sec = l.section;
  if (!isObj(sec)) c.err("bad_value", "section", "section is an object.");
  else {
    checkKeys(sec, ["component", "collapsible", "groupBadges"], "section", c, true);
    if (!(SECTION_COMPONENTS as readonly string[]).includes(sec.component as string)) c.err("unknown_component", "section.component", `Unknown section component "${String(sec.component)}".`);
    for (const k of ["collapsible", "groupBadges"]) if (typeof sec[k] !== "boolean") c.err("bad_value", `section.${k}`, `${k} is true or false.`);
  }
  const checkSlots = (s: unknown, path: string, partial: boolean) => {
    if (!isObj(s)) { c.err("bad_value", path, "slots is an object."); return; }
    checkKeys(s, SLOT_KEYS, path, c, true);
    for (const k of Object.keys(SLOT_VALUES) as (keyof typeof SLOT_VALUES)[]) {
      if (!(k in s)) { if (!partial) c.err("bad_value", `${path}.${k}`, `${k} is required.`); continue; }
      if (!(SLOT_VALUES[k] as readonly string[]).includes(s[k] as string)) c.err("unknown_component", `${path}.${k}`, `${k} must be one of ${SLOT_VALUES[k].join(", ")}.`);
    }
    if ("badges" in s) {
      if (!Array.isArray(s.badges) || !s.badges.every((b) => (BADGES as readonly string[]).includes(b as string))) c.err("unknown_component", `${path}.badges`, `badges are a list of: ${BADGES.join(", ")}.`);
    } else if (!partial) c.err("bad_value", `${path}.badges`, "badges is required.");
  };
  const item = l.item;
  if (!isObj(item)) c.err("bad_value", "item", "item is an object.");
  else {
    checkKeys(item, ["component", "slots"], "item", c, true);
    if (!(ITEM_COMPONENTS as readonly string[]).includes(item.component as string)) c.err("unknown_component", "item.component", `Unknown item component "${String(item.component)}".`);
    checkSlots(item.slots, "item.slots", false);
  }
  const controls = l.controls;
  if (!isObj(controls)) c.err("bad_value", "controls", "controls is an object keyed by response type.");
  else for (const [k, v] of Object.entries(controls)) {
    if (!(RESPONSE_TYPES as readonly string[]).includes(k)) { c.err("unknown_key", `controls.${k}`, `"${k}" is not a response type.`); continue; }
    if (!CONTROL_VOCAB[k as keyof typeof CONTROL_VOCAB].includes(v as string)) c.err("unknown_component", `controls.${k}`, `Unknown control "${String(v)}" for ${k}. Allowed: ${CONTROL_VOCAB[k as keyof typeof CONTROL_VOCAB].join(", ")}.`);
  }
  if (!(GROUPINGS as readonly string[]).includes(l.grouping as string)) c.err("unknown_component", "grouping", `grouping must be one of ${GROUPINGS.join(", ")}.`);
  const ind = l.indicators;
  if (!isObj(ind)) c.err("bad_value", "indicators", "indicators is an object.");
  else { checkKeys(ind, ["completed", "unassessed", "critical", "missingEvidence"], "indicators", c, true); for (const k of ["completed", "unassessed", "critical", "missingEvidence"]) if (typeof ind[k] !== "boolean") c.err("bad_value", `indicators.${k}`, `${k} is true or false.`); }
  if ("outcomePreview" in l) {
    const o = l.outcomePreview;
    if (!isObj(o) || typeof o.enabled !== "boolean") c.err("bad_value", "outcomePreview", "outcomePreview is { enabled, label? }.");
    else { checkKeys(o, ["enabled", "label"], "outcomePreview", c, true); if ("label" in o && !isStr(o.label)) c.err("bad_value", "outcomePreview.label", "label is text."); }
  }
  if ("breakpoints" in l) {
    const b = l.breakpoints;
    if (!isObj(b)) c.err("bad_value", "breakpoints", "breakpoints is { mobile?, tablet? }.");
    else {
      checkKeys(b, ["mobile", "tablet"], "breakpoints", c, true);
      for (const bp of ["mobile", "tablet"]) {
        const x = b[bp]; if (x === undefined) continue;
        if (!isObj(x)) { c.err("bad_value", `breakpoints.${bp}`, "A breakpoint is { item?, slots? }."); continue; }
        checkKeys(x, ["item", "slots"], `breakpoints.${bp}`, c, true);
        if ("item" in x) { if (!isObj(x.item)) c.err("bad_value", `breakpoints.${bp}.item`, "item is { component }."); else { checkKeys(x.item, ["component"], `breakpoints.${bp}.item`, c, true); if (!(ITEM_COMPONENTS as readonly string[]).includes(x.item.component as string)) c.err("unknown_component", `breakpoints.${bp}.item.component`, `Unknown item component "${String(x.item.component)}".`); } }
        if ("slots" in x) checkSlots(x.slots, `breakpoints.${bp}.slots`, true);
      }
    }
  }
  const pr = l.print;
  if (!isObj(pr)) c.err("bad_value", "print", "print is an object.");
  else {
    checkKeys(pr, PRINT_KEYS, "print", c, true);
    for (const k of ["guidance", "responses", "evidenceList", "signature"]) if (typeof pr[k] !== "boolean") c.err("bad_value", `print.${k}`, `${k} is true or false.`);
    if (!["section", "none"].includes(pr.pageBreak as string)) c.err("unknown_component", "print.pageBreak", "pageBreak is section or none.");
    if (!["portrait", "landscape"].includes(pr.orientation as string)) c.err("unknown_component", "print.orientation", "orientation is portrait or landscape.");
  }
  void def;
  return c.result();
}

