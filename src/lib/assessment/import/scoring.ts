/**
 * Instrument import: PROPOSED scoring, deterministic, from what the sheet actually holds (owner GO 3 Nov 2026, late).
 * Pure and client-safe. No AI. The proposal is written into the draft as ordinary, editable scoring rules with saved
 * tests, every rule id carrying the PROPOSED prefix so the Studio and the pathway can say "proposed from the workbook,
 * review before submitting" until the author accepts it. Nothing is assumed silently: every default is a flag.
 *
 * Two families, chosen from the items' response types:
 *   compliance  Yes / No / Partial / N/A audits: compliance percentage = met / (met + not met), N/A excluded. Partial
 *               counts as the workbook defines it, else as NOT MET with a flag (patchPartialOptions). The workbook names
 *               no target, so the proposal is neutral (Compliant only when every applicable item is met, Partially
 *               compliant when any is met) and flagged for the author to set a percentage target.
 *   rating      rating-scale instruments: every rated item at or above a threshold level = Achieved, any at or above =
 *               Partially achieved, else Not achieved, nothing rated = Incomplete. The threshold is read from the
 *               workbook's own scoring or achievement text where it names one, else the middle level of the scale,
 *               flagged as a neutral default the author must confirm. Ordinals are never averaged.
 */
import { RULES_SCHEMA, rkey, type InstrumentDef, type InstrumentItem, type Responses, type RulesDoc, type ScoringTestCase } from "../core";
import type { EditorContent } from "../studio/types";
import type { ImportFlag, SheetDraft } from "./types";

export const PROPOSED_PREFIX = "proposed_";
export type ProposalFamily = "compliance" | "rating" | "none";

export interface ScoringProposal {
  family: ProposalFamily;
  rules: RulesDoc | null;
  tests: ScoringTestCase[];
  flags: ImportFlag[];
  /** rating family: the threshold level ordinal, and where it came from */
  threshold: { ordinal: number; code: string; label: string; source: "workbook" | "default" } | null;
  /** delivery modes implied by who answers (self, assessor, auditor), for the version settings */
  deliveryModes: string[];
}

export interface ProposalInput {
  sheets: SheetDraft[];
  /** the draft's definition, items with their frozen scales where known */
  def: InstrumentDef;
  respondentRoles: string[];
  /** the rating scale's levels when the def's items carry no scale yet (at import, before the scale version exists) */
  levels?: { code: string; label: string; ordinal: number }[] | null;
}

const flag = (code: string, message: string, severity: ImportFlag["severity"] = "warn"): ImportFlag => ({ code, message, severity });
const ROLE_MODE: Record<string, string> = { self: "self_assessment", assessor: "assessor_led", auditor: "auditor_recorded" };

/** Rules carry the proposal mark until the author accepts them. */
export const isProposedRules = (doc: unknown): boolean =>
  !!doc && typeof doc === "object" && Array.isArray((doc as RulesDoc).rules) && (doc as RulesDoc).rules.some((r) => typeof r?.id === "string" && r.id.startsWith(PROPOSED_PREFIX));

/** The same rules as the author's own: the proposal mark is removed from every rule id. */
export function acceptProposedRules(doc: RulesDoc): RulesDoc {
  return { ...doc, rules: doc.rules.map((r) => ({ ...r, id: r.id.startsWith(PROPOSED_PREFIX) ? r.id.slice(PROPOSED_PREFIX.length) : r.id })) };
}

/**
 * A choice option with no pass or fail meaning (Partial, as the workbook left it) counts as NOT MET, so the compliance
 * percentage can count it. Returns the patched content and the labels it changed, for the flag.
 */
export function patchPartialOptions(content: EditorContent): { content: EditorContent; changed: string[] } {
  const changed = new Set<string>();
  const items = content.items.map((it) => {
    if (it.response_type !== "multiple_choice" || !Array.isArray(it.config.options)) return it;
    let touched = false;
    const options = it.config.options.map((o) => {
      if (typeof o.satisfactory === "boolean") return o;
      touched = true; changed.add(o.label);
      return { ...o, satisfactory: false };
    });
    return touched ? { ...it, config: { ...it.config, options } } : it;
  });
  return { content: { ...content, items }, changed: [...changed] };
}

export function familyOf(def: InstrumentDef): { family: ProposalFamily; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  for (const it of def.items) counts[it.response_type] = (counts[it.response_type] ?? 0) + 1;
  const rating = counts.rating_scale ?? 0;
  const choice = (counts.multiple_choice ?? 0) + (counts.yes_no ?? 0) + (counts.pass_fail ?? 0) + (counts.achieved ?? 0);
  if (!rating && !choice) return { family: "none", counts };
  return { family: rating >= choice ? "rating" : "compliance", counts };
}

const THRESHOLD_TEXT = [
  /(?:minimum|pass(?:ing)?|threshold|required|expected|target)\b[^.\n]{0,40}?\b(?:score|level|grade|rating)\b[^.\n]{0,15}?(\d+)/i,
  /\b(?:score|level|grade|rating)\b[^.\n]{0,12}?(?:of|>=|at least)\s*(\d+)[^.\n]{0,40}?\b(?:pass|achiev|required|minimum|target)/i,
];

/** The threshold the workbook names, if it names one in a scoring or achievement sentence, as a scale value. */
export function thresholdFromText(texts: string[], values: string[]): { value: string; text: string } | null {
  for (const t of texts) {
    for (const re of THRESHOLD_TEXT) {
      const m = re.exec(t);
      if (m && values.includes(m[1])) return { value: m[1], text: t.trim().slice(0, 160) };
    }
  }
  return null;
}

export function proposeScoring(i: ProposalInput): ScoringProposal {
  const flags: ImportFlag[] = [];
  const { family, counts } = familyOf(i.def);
  const deliveryModes = [...new Set(i.respondentRoles.map((r) => ROLE_MODE[r]).filter((m): m is string => !!m))];
  if (deliveryModes.length) flags.push(flag("delivery_mode_proposed", `Delivery mode proposed from who answers (${i.respondentRoles.join(", ")}): ${deliveryModes.join(", ")}. Change it in Settings & Review if the instrument is delivered differently.`, "info"));
  else flags.push(flag("delivery_mode_missing", "No delivery mode could be proposed because nobody is set to answer. Choose one in Settings & Review before submitting."));
  const kinds = Object.keys(counts);
  if (family !== "none" && kinds.length > 1) flags.push(flag("mixed_response_types", `The items answer in more than one way (${kinds.join(", ")}). The ${family === "rating" ? "rating threshold" : "compliance percentage"} rules were proposed for the majority; check the others count as you intend.`));
  if (family === "none") {
    flags.push(flag("no_scoring_proposed", "No rating or compliance responses were found, so no scoring was proposed. Start from a starter rule set in Scoring & Rules."));
    return { family, rules: null, tests: [], flags, threshold: null, deliveryModes };
  }
  return family === "compliance" ? compliance(i, flags, deliveryModes) : rating(i, flags, deliveryModes);
}

function compliance(i: ProposalInput, flags: ImportFlag[], deliveryModes: string[]): ScoringProposal {
  const partial = i.sheets.flatMap((s) => s.response.options.filter((o) => o.satisfactory === null).map((o) => o.label));
  if (partial.length) flags.push(flag("partial_counted_not_met", `The workbook does not define how "${[...new Set(partial)].join('" and "')}" counts. It is counted as NOT MET in the compliance percentage. Change the option's Met value in Content if it should count otherwise.`));
  flags.push(flag("compliance_percentage", "Compliance percentage = items met divided by items met or not met. Not applicable answers are excluded from the count.", "info"));
  flags.push(flag("threshold_default", "The workbook names no compliance target. Proposed: Compliant only when every applicable item is met, Partially compliant when any item is met, Non-compliant otherwise. Set a percentage target in Scoring & Rules if your standard has one."));
  const rules: RulesDoc = {
    schema: RULES_SCHEMA,
    outcomes: [
      { code: "COMPLIANT", label: "Compliant", class: "positive" },
      { code: "PARTIAL", label: "Partially compliant", class: "partial" },
      { code: "NON_COMPLIANT", label: "Non-compliant", class: "negative" },
      { code: "INCOMPLETE", label: "Incomplete", class: "incomplete" },
    ],
    gates: { criticalFail: "NON_COMPLIANT", mandatoryMissing: "INCOMPLETE" },
    defaults: { na: "exclude", undeterminable: "exclude" },
    aggregates: [
      { id: "pct", fn: "percent_satisfactory", over: { scope: "all" }, weights: "none" },
      { id: "judged", fn: "count", over: { scope: "all" }, weights: "none" },
    ],
    rules: [
      { id: `${PROPOSED_PREFIX}nothing_judged`, label: "Nothing could be judged", priority: 30, when: { aggregate: "judged", op: "=", value: 0 }, then: { outcome: "INCOMPLETE" }, explain: "Proposed from the workbook: no item was answered met or not met (not applicable is excluded)." },
      { id: `${PROPOSED_PREFIX}all_met`, label: "Every applicable item met", priority: 20, when: { aggregate: "pct", op: ">=", value: 100 }, then: { outcome: "COMPLIANT" }, explain: "Proposed from the workbook: the workbook names no target, so compliant means 100 percent. Review this threshold." },
      { id: `${PROPOSED_PREFIX}some_met`, label: "Some items met", priority: 10, when: { aggregate: "pct", op: ">", value: 0 }, then: { outcome: "PARTIAL" }, explain: "Proposed from the workbook: at least one applicable item met." },
    ],
    fallback: "NON_COMPLIANT",
  };
  const items = i.def.items.filter((it) => ["multiple_choice", "yes_no", "pass_fail", "achieved"].includes(it.response_type));
  const met = (it: InstrumentItem) => metResponse(it, true);
  const notMet = (it: InstrumentItem) => metResponse(it, false);
  const all = (pick: (it: InstrumentItem) => Responses[string] | null): Responses => Object.fromEntries(items.flatMap((it) => { const r = pick(it); return r ? [[rkey(it.stable_key), r]] : []; }));
  const naAllowed = items.filter((it) => (it.config.allowedStates ?? []).includes("not_applicable"));
  const tests: ScoringTestCase[] = [
    { id: "proposed_all_met", name: "Proposed: every item met is Compliant", responses: all(met), expect: { outcome: "COMPLIANT", aggregates: { pct: 100 } } },
    { id: "proposed_none_met", name: "Proposed: no item met is Non-compliant", responses: all(notMet), expect: { outcome: "NON_COMPLIANT", aggregates: { pct: 0 } } },
    { id: "proposed_nothing_answered", name: "Proposed: nothing answered is Incomplete", responses: {}, expect: { outcome: "INCOMPLETE" } },
  ];
  if (items.length >= 2) {
    const r = all(met);
    const first = items[0];
    const bad = notMet(first);
    if (bad) { r[rkey(first.stable_key)] = bad; tests.push({ id: "proposed_one_not_met", name: "Proposed: one item not met is Partially compliant", responses: r, expect: { outcome: "PARTIAL" } }); }
  }
  if (naAllowed.length === items.length && items.length) tests.push({ id: "proposed_all_na", name: "Proposed: everything not applicable is Incomplete", responses: all(() => ({ state: "not_applicable", reason: "proposed test" })), expect: { outcome: "INCOMPLETE" } });
  return { family: "compliance", rules, tests, flags, threshold: null, deliveryModes };
}

/** A valid met / not met answer for a choice item, from its own options or the yes/no vocabulary. */
function metResponse(it: InstrumentItem, met: boolean): Responses[string] | null {
  if (it.response_type === "multiple_choice") {
    const o = (it.config.options ?? []).find((x) => x.satisfactory === met);
    return o ? { value: o.code } : null;
  }
  const words: Record<string, [string, string]> = { yes_no: ["yes", "no"], pass_fail: ["pass", "fail"], achieved: ["achieved", "not_achieved"] };
  const w = words[it.response_type];
  return w ? { value: met ? w[0] : w[1] } : null;
}

function rating(i: ProposalInput, flags: ImportFlag[], deliveryModes: string[]): ScoringProposal {
  const items = i.def.items.filter((it) => it.response_type === "rating_scale");
  const levels = (items.find((it) => it.scale?.levels.length)?.scale?.levels ?? i.levels ?? []).map((l) => ({ code: l.code, label: l.label, ordinal: l.ordinal })).sort((a, b) => a.ordinal - b.ordinal);
  if (!levels.length) {
    flags.push(flag("no_scale_levels", "The rating scale has no levels yet, so no threshold could be proposed. Add the levels, then propose again."));
    return { family: "rating", rules: null, tests: [], flags, threshold: null, deliveryModes };
  }
  const texts = i.sheets.flatMap((s) => [s.scale?.title ?? "", ...s.instructions, ...s.unplaced.map((u) => u.text), ...(s.scale?.levels.map((l) => `${l.label ?? ""} ${l.description}`) ?? [])]);
  const values = i.sheets.flatMap((s) => s.scale?.levels.map((l) => l.value) ?? []);
  const named = thresholdFromText(texts, values);
  let threshold: ScoringProposal["threshold"];
  if (named) {
    const idx = values.indexOf(named.value);
    const lv = levels[idx] ?? levels[levels.length - 1];
    threshold = { ordinal: lv.ordinal, code: lv.code, label: lv.label, source: "workbook" };
    flags.push(flag("threshold_from_workbook", `Threshold taken from the workbook's own text: "${named.text}" (level ${lv.label}). Check it reads the sentence as intended.`, "info"));
  } else {
    const lv = levels[Math.ceil((levels.length - 1) / 2)];
    threshold = { ordinal: lv.ordinal, code: lv.code, label: lv.label, source: "default" };
    flags.push(flag("threshold_default", `The workbook names no achievement threshold. Proposed neutral default: level ${lv.label} (ordinal ${lv.ordinal}), the middle of the ${levels.length}-level scale. Confirm or change it in Scoring & Rules before submitting.`));
  }
  flags.push(flag("rating_threshold_rules", `Achieved when every rated item is at or above ${threshold.label}, Partially achieved when any is, Not achieved otherwise, Incomplete when nothing is rated. Not applicable is excluded. Ordinal levels are never averaged.`, "info"));
  const rules: RulesDoc = {
    schema: RULES_SCHEMA,
    outcomes: [
      { code: "ACHIEVED", label: "Achieved", class: "positive" },
      { code: "PARTIAL", label: "Partially achieved", class: "partial" },
      { code: "NOT_ACHIEVED", label: "Not achieved", class: "negative" },
      { code: "INCOMPLETE", label: "Incomplete", class: "incomplete" },
    ],
    gates: { criticalFail: "NOT_ACHIEVED", mandatoryMissing: "INCOMPLETE" },
    defaults: { na: "exclude", undeterminable: "exclude" },
    aggregates: [
      { id: "lowest", fn: "min_ordinal", over: { scope: "all" }, weights: "none" },
      { id: "highest", fn: "max_ordinal", over: { scope: "all" }, weights: "none" },
      { id: "rated", fn: "count", over: { scope: "all" }, weights: "none" },
    ],
    rules: [
      { id: `${PROPOSED_PREFIX}nothing_rated`, label: "Nothing rated", priority: 30, when: { aggregate: "rated", op: "=", value: 0 }, then: { outcome: "INCOMPLETE" }, explain: "Proposed from the workbook: no item carries a rating (not applicable is excluded)." },
      { id: `${PROPOSED_PREFIX}all_at_threshold`, label: `Every rated item at or above ${threshold.label}`, priority: 20, when: { aggregate: "lowest", op: ">=", value: threshold.ordinal }, then: { outcome: "ACHIEVED" }, explain: `Proposed from the workbook: threshold level ${threshold.label} (${threshold.source === "workbook" ? "named in the workbook" : "neutral default, the middle of the scale"}). Review it.` },
      { id: `${PROPOSED_PREFIX}some_at_threshold`, label: `Some items at or above ${threshold.label}`, priority: 10, when: { aggregate: "highest", op: ">=", value: threshold.ordinal }, then: { outcome: "PARTIAL" }, explain: "Proposed from the workbook: at least one rated item reaches the threshold." },
    ],
    fallback: "NOT_ACHIEVED",
  };
  const top = levels[levels.length - 1];
  const bottom = levels[0];
  const all = (code: string): Responses => Object.fromEntries(items.map((it) => [rkey(it.stable_key), { level_code: code }]));
  const tests: ScoringTestCase[] = [
    { id: "proposed_all_top", name: `Proposed: every item at ${top.label} is Achieved`, responses: all(top.code), expect: { outcome: "ACHIEVED", aggregates: { lowest: top.ordinal } } },
    { id: "proposed_all_threshold", name: `Proposed: every item exactly at ${threshold.label} is Achieved`, responses: all(threshold.code), expect: { outcome: "ACHIEVED" } },
    { id: "proposed_nothing_rated", name: "Proposed: nothing rated is Incomplete", responses: {}, expect: { outcome: "INCOMPLETE" } },
  ];
  if (bottom.ordinal < threshold.ordinal) {
    tests.push({ id: "proposed_all_bottom", name: `Proposed: every item at ${bottom.label} is Not achieved`, responses: all(bottom.code), expect: { outcome: "NOT_ACHIEVED", aggregates: { highest: bottom.ordinal } } });
    if (items.length >= 2) {
      const r = all(top.code);
      r[rkey(items[0].stable_key)] = { level_code: bottom.code };
      tests.push({ id: "proposed_one_below", name: `Proposed: one item at ${bottom.label} is Partially achieved`, responses: r, expect: { outcome: "PARTIAL" } });
    }
  }
  return { family: "rating", rules, tests, flags, threshold, deliveryModes };
}

/** A short summary of a proposal for a screen: family, the threshold, the delivery modes. */
export function proposalSummary(p: ScoringProposal): string {
  if (p.family === "none" || !p.rules) return "No scoring proposed.";
  const dm = p.deliveryModes.length ? ` Delivery mode: ${p.deliveryModes.join(", ")}.` : "";
  if (p.family === "compliance") return `Compliance percentage (met over met plus not met, not applicable excluded); Compliant at 100 percent, Partially compliant above 0.${dm}`;
  return `Rating threshold at ${p.threshold?.label ?? "?"} (${p.threshold?.source === "workbook" ? "from the workbook" : "neutral default"}): Achieved when every rated item reaches it, Partially achieved when any does.${dm}`;
}
