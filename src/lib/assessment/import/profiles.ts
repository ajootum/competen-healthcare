/**
 * Scoring PROFILES (ASMT-SCORING-INTEGRATION-01, owner GO 4 Nov 2026): reusable, configurable starting points an author
 * applies to an imported instrument. A profile is configuration, not an engine: it writes ordinary content settings
 * (response options with their numerical values, N/A with a required reason, mandatory, the evidence fields) and an
 * ordinary asmt.rules/1 document with saved tests into the draft, where HQ edits them like any other. The engine that
 * calculates is the one every checklist uses. Pure and client-safe. Deterministic. No AI.
 *
 *   graded_assessment     a graded instrument on its own rating scale (for example 0 to 6): average grade and achievement
 *                         percentage are calculated; the competency decision is a SEPARATE proposed rule template that is
 *                         not active until it is approved. Until then the interpretation is "Not configured".
 *   weighted_agreement    a documented-versus-observed audit: Yes = 2, Partial = 1, No = 0 (credit 1, 0.5, 0), N/A excluded
 *                         with a reason; weighted agreement percentage and full-match percentage, both reported.
 *   weighted_compliance   a documentation compliance audit: the same weights; weighted compliance percentage, fully-met
 *                         percentage, and the unmet and partially met counts.
 *
 * Three outputs stay distinct everywhere: the raw response (what was recorded), the calculated result (the aggregates and
 * counts), and the governed interpretation (the outcome, "Not configured" while no threshold is approved).
 */
import { RULES_SCHEMA, rkey, type Evaluation, type InstrumentDef, type InstrumentItem, type ItemField, type Responses, type RulesDoc, type ScoringTestCase } from "../core";
import type { EditorContent, EditorItem } from "../studio/types";
import type { ImportFlag } from "./types";

export type ProfileId = "graded_assessment" | "weighted_agreement" | "weighted_compliance";
export const PROFILE_VERSION = "1";
export const PROPOSED_PREFIX = "proposed_";

export interface ProfileFieldTemplate { field_key: string; label: string; response_type: ItemField["response_type"]; required: boolean; hint?: string }

export interface ProfileDefinition {
  id: ProfileId;
  label: string;
  /** the calculation in words, shown in the Scoring & Evaluation panel and stored on the rules document */
  formula: string;
  summary: string;
  /** the recommended delivery mode; configurable, it never changes the scoring construct */
  deliveryMode: string;
  /** why this profile does not fit a definition, or null */
  unfit: (def: InstrumentDef) => string | null;
  /** the evidence fields every item carries after the profile is applied (added by key when missing, labels kept when present) */
  fields: ProfileFieldTemplate[];
  /** field keys renamed on apply (an imported combined field becomes the profile's own) */
  renames: Record<string, string>;
}

const OPTION_WEIGHT: { test: RegExp; satisfactory: boolean; credit: number; word: string }[] = [
  { test: /^(yes|met|compliant|documented|pass|achieved|agree[sd]?)$/i, satisfactory: true, credit: 1, word: "Yes = 2" },
  { test: /^(partial(ly)?|partly|partially met|partly documented)$/i, satisfactory: false, credit: 0.5, word: "Partial = 1" },
  { test: /^(no|not met|unmet|non-?compliant|absent|not documented|fail|not achieved|disagree[sd]?)$/i, satisfactory: false, credit: 0, word: "No = 0" },
];

export const PROFILES: Record<ProfileId, ProfileDefinition> = {
  graded_assessment: {
    id: "graded_assessment", label: "Graded assessment (rating scale)",
    formula: "Average grade = sum of awarded grades / number of applicable assessed items. Achievement percentage = sum of awarded grades / (highest grade x number of applicable assessed items) x 100. Justified N/A excluded. Unanswered is its own state and makes the result Not determined. The competency decision is a separate, governed rule set.",
    summary: "Keeps the imported scale and its full level descriptions. Calculates the average grade and the achievement percentage. Reports both, with the interpretation Not configured until a competency decision is approved.",
    deliveryMode: "assessor_led",
    unfit: (def) => (def.items.some((it) => it.response_type === "rating_scale") ? null : "No item rates on a scale."),
    fields: [{ field_key: "evidence_comments", label: "Evidence / comments", response_type: "free_text", required: false }],
    renames: {},
  },
  weighted_agreement: {
    id: "weighted_agreement", label: "Weighted agreement audit (documented versus observed)",
    formula: "Weighted agreement percentage = ((2 x Yes) + Partial) / (2 x number of applicable assessed items) x 100. Full-match percentage = Yes / number of applicable assessed items x 100. Justified N/A excluded. Unanswered makes the result Not determined.",
    summary: "Yes = 2, Partial = 1, No = 0, N/A excluded with a reason. Keeps the documented finding, the independent finding, the match, the discrepancy, the action and a clinically explainable change as separate evidence fields. A difference is never classified automatically.",
    deliveryMode: "auditor_recorded",
    unfit: (def) => (def.items.some((it) => ["multiple_choice", "yes_no"].includes(it.response_type)) ? null : "No item answers with Yes / Partial / No."),
    fields: [
      { field_key: "documented_finding", label: "Documented finding (copied verbatim)", response_type: "free_text", required: false },
      { field_key: "observed_finding", label: "Independent bedside finding", response_type: "free_text", required: false },
      { field_key: "discrepancy", label: "Discrepancy", response_type: "free_text", required: false },
      { field_key: "action_needed", label: "Action needed", response_type: "free_text", required: false },
      { field_key: "explainable_change", label: "Difference explained by a change in the patient's condition (timing of observations, intervening care)", response_type: "yes_no", required: false },
      { field_key: "clinical_context", label: "Relevant clinical context", response_type: "free_text", required: false },
    ],
    renames: { discrepancy_action: "discrepancy" },
  },
  weighted_compliance: {
    id: "weighted_compliance", label: "Weighted documentation compliance audit",
    formula: "Documentation compliance percentage = ((2 x Yes) + Partial) / (2 x number of applicable assessed items) x 100. Fully-met percentage = Yes / number of applicable assessed items x 100. Unmet and partially met counts reported. Justified N/A excluded. Unanswered makes the result Not determined.",
    summary: "Yes = 2, Partial = 1, No = 0, N/A excluded with a reason. Keeps the policy requirement (section), the criterion, the response, the deficiency or supporting evidence and the record references. No universal pass threshold is imposed.",
    deliveryMode: "auditor_recorded",
    unfit: (def) => (def.items.some((it) => ["multiple_choice", "yes_no"].includes(it.response_type)) ? null : "No item answers with Yes / Partial / No."),
    fields: [
      { field_key: "evidence_comments", label: "Deficiency or supporting evidence", response_type: "free_text", required: false },
      { field_key: "record_reference", label: "Record reference(s)", response_type: "free_text", required: false },
    ],
    renames: {},
  },
};

export const PROFILE_LIST: ProfileDefinition[] = [PROFILES.graded_assessment, PROFILES.weighted_agreement, PROFILES.weighted_compliance];

/** The profile the items point at: a rating scale -> graded; options with findings fields -> agreement; options otherwise -> compliance. */
export function chooseProfile(def: InstrumentDef): ProfileId | null {
  const rating = def.items.filter((it) => it.response_type === "rating_scale").length;
  const choice = def.items.filter((it) => ["multiple_choice", "yes_no"].includes(it.response_type)).length;
  if (!rating && !choice) return null;
  if (rating >= choice) return "graded_assessment";
  const findings = def.items.some((it) => (it.fields ?? []).some((f) => /observed_finding|documented_finding/.test(f.field_key)));
  return findings ? "weighted_agreement" : "weighted_compliance";
}

export interface AppliedProfile {
  profile: ProfileDefinition;
  content: EditorContent;
  rules: RulesDoc;
  tests: ScoringTestCase[];
  flags: ImportFlag[];
  deliveryModes: string[];
  /** what the profile changed on the content, in words, for the event and the screen */
  changes: string[];
}

const flag = (code: string, message: string, severity: ImportFlag["severity"] = "warn"): ImportFlag => ({ code, message, severity });

/** Apply a profile to the editable content: option values, N/A with a reason, mandatory, the evidence fields. Pure. */
export function applyProfileToContent(content: EditorContent, profile: ProfileDefinition): { content: EditorContent; changes: string[]; flags: ImportFlag[] } {
  const changes = new Set<string>();
  const flags: ImportFlag[] = [];
  const unknownOptions = new Set<string>();
  const items: EditorItem[] = content.items.map((it) => {
    let next: EditorItem = { ...it, config: { ...it.config } };
    // response values
    if (profile.id !== "graded_assessment" && it.response_type === "multiple_choice" && Array.isArray(it.config.options)) {
      next.config.options = it.config.options.map((o) => {
        const w = OPTION_WEIGHT.find((x) => x.test.test(o.label) || x.test.test(o.code));
        if (!w) { unknownOptions.add(o.label); return o; }
        if (o.satisfactory !== w.satisfactory || o.credit !== w.credit) changes.add(`${w.word}`);
        return { ...o, satisfactory: w.satisfactory, credit: w.credit };
      });
      next.config.select = "single";
    }
    // N/A with a required reason, never zero
    const allowed = new Set(next.config.allowedStates ?? []);
    if (!allowed.has("not_applicable")) { allowed.add("not_applicable"); changes.add("N/A allowed on every item"); }
    next.config.allowedStates = [...allowed] as EditorItem["config"]["allowedStates"];
    if (!next.config.naReasonRequired) { next.config.naReasonRequired = true; changes.add("N/A requires a reason"); }
    // unanswered required items are never silently excluded
    if (!next.mandatory) { next = { ...next, mandatory: true }; changes.add("every item mandatory (unanswered makes the result Not determined)"); }
    // evidence fields
    let fields = [...(it.fields ?? [])];
    for (const [from, to] of Object.entries(profile.renames)) {
      const f = fields.find((x) => x.field_key === from);
      if (f && !fields.some((x) => x.field_key === to)) { fields = fields.map((x) => (x.field_key === from ? { ...x, field_key: to, label: profile.fields.find((t) => t.field_key === to)?.label ?? x.label } : x)); changes.add(`field ${from} becomes ${to}`); }
    }
    for (const t of profile.fields) {
      if (fields.some((x) => x.field_key === t.field_key)) continue;
      fields.push({ field_key: t.field_key, label: t.label, response_type: t.response_type, scale_version_id: null, config: {}, required: t.required, position: fields.length + 1 });
      changes.add(`field ${t.field_key} added`);
    }
    next = { ...next, fields: fields.map((f, i) => ({ ...f, position: i + 1 })) };
    return next;
  });
  if (unknownOptions.size) flags.push(flag("option_value_unknown", `Options ${[...unknownOptions].map((o) => `"${o}"`).join(", ")} carry no numerical value yet (not Yes, Partial or No). Set their Met value and credit in Content.`));
  return { content: { ...content, items }, changes: [...changes], flags };
}

const OUT = {
  notConfigured: { code: "NOT_CONFIGURED", label: "Not configured", class: "incomplete" as const },
  notDetermined: { code: "NOT_DETERMINED", label: "Not determined", class: "incomplete" as const },
};

const unansweredRule = (): RulesDoc["rules"][number] => ({
  id: `${PROPOSED_PREFIX}unanswered`, label: "An item is unanswered", priority: 30,
  when: { count: { scope: "all" }, where: { answered: false }, op: ">", value: 0 }, then: { outcome: OUT.notDetermined.code },
  explain: "Unanswered is its own state: a result is not determined while an item is neither answered nor justified as not applicable.",
});

/** The rules document of a profile, for a definition: descriptive calculations, Not configured as the interpretation. */
export function profileRules(def: InstrumentDef, profile: ProfileDefinition): RulesDoc {
  const critical = def.items.some((it) => it.critical);
  const base = { schema: RULES_SCHEMA, profile: { id: profile.id, label: profile.label, version: PROFILE_VERSION, formula: profile.formula, notes: "Applied from a starter profile. Proposed until the author accepts it; the interpretation stays Not configured until a threshold or decision rule set is approved." } } as const;
  if (profile.id === "graded_assessment") {
    const outcomes = [OUT.notConfigured, OUT.notDetermined, ...(critical ? [{ code: "CRITICAL_SAFETY", label: "Critical safety failure", class: "negative" as const }] : [])];
    return {
      ...base, outcomes,
      gates: { mandatoryMissing: OUT.notDetermined.code, ...(critical ? { criticalFail: "CRITICAL_SAFETY" } : {}) },
      defaults: { na: "exclude", undeterminable: "exclude" },
      aggregates: [
        { id: "average_grade", fn: "mean_numeric", over: { scope: "all" }, weights: "none" },
        { id: "graded", fn: "count", over: { scope: "all" }, weights: "none" },
        { id: "lowest_grade", fn: "min_ordinal", over: { scope: "all" }, weights: "none" },
      ],
      rules: [
        unansweredRule(),
        { id: `${PROPOSED_PREFIX}nothing_graded`, label: "Nothing graded", priority: 20, when: { aggregate: "graded", op: "=", value: 0 }, then: { outcome: OUT.notDetermined.code }, explain: "No item carries a grade (justified N/A is excluded)." },
      ],
      fallback: OUT.notConfigured.code,
      permitOrdinalMean: true,
    };
  }
  const critName = profile.id === "weighted_agreement" ? "CRITICAL_DISCREPANCY" : "CRITICAL_DEFICIENCY";
  const critLabel = profile.id === "weighted_agreement" ? "Critical discrepancy" : "Critical deficiency";
  const outcomes = [OUT.notConfigured, OUT.notDetermined, ...(critical ? [{ code: critName, label: critLabel, class: "negative" as const }] : [])];
  return {
    ...base, outcomes,
    gates: { mandatoryMissing: OUT.notDetermined.code, ...(critical ? { criticalFail: critName } : {}) },
    defaults: { na: "exclude", undeterminable: "exclude" },
    aggregates: [
      { id: "weighted_pct", fn: "credit_percent", over: { scope: "all" }, weights: "none" },
      { id: "full_match_pct", fn: "percent_satisfactory", over: { scope: "all" }, weights: "none" },
      { id: "judged", fn: "count", over: { scope: "all" }, weights: "none" },
    ],
    rules: [
      unansweredRule(),
      { id: `${PROPOSED_PREFIX}nothing_judged`, label: "Nothing could be judged", priority: 20, when: { aggregate: "judged", op: "=", value: 0 }, then: { outcome: OUT.notDetermined.code }, explain: "Every item was justified as not applicable, so there is nothing to count." },
    ],
    fallback: OUT.notConfigured.code,
  };
}

const choiceWith = (it: InstrumentItem, credit: number) => (it.config.options ?? []).find((o) => o.credit === credit);
const fill = (items: InstrumentItem[], pick: (it: InstrumentItem, i: number) => Responses[string] | null): Responses =>
  Object.fromEntries(items.flatMap((it, i) => { const r = pick(it, i); return r ? [[rkey(it.stable_key), r]] : []; }));

/** Deterministic saved tests: they state the calculation, not a pass or fail. */
export function profileTests(def: InstrumentDef, profile: ProfileDefinition, levels: { code: string; ordinal: number; numeric_value?: number | null }[] | null): ScoringTestCase[] {
  if (profile.id === "graded_assessment") {
    const items = def.items.filter((it) => it.response_type === "rating_scale");
    const lv = (items.find((it) => it.scale?.levels.length)?.scale?.levels ?? levels ?? []).map((l) => ({ code: l.code, ordinal: l.ordinal, n: l.numeric_value ?? null })).sort((a, b) => a.ordinal - b.ordinal);
    if (!lv.length || !items.length) return [];
    const top = lv[lv.length - 1], bottom = lv[0];
    const all = (code: string) => fill(items, () => ({ level_code: code }));
    const tests: ScoringTestCase[] = [
      { id: "proposed_all_top", name: `Every item at the top grade: average ${top.n ?? top.ordinal}, interpretation Not configured`, responses: all(top.code), expect: { outcome: OUT.notConfigured.code, aggregates: { average_grade: top.n ?? top.ordinal, graded: items.length } } },
      { id: "proposed_all_bottom", name: `Every item at the bottom grade: average ${bottom.n ?? bottom.ordinal}, still Not configured (no threshold is approved)`, responses: all(bottom.code), expect: { outcome: OUT.notConfigured.code, aggregates: { average_grade: bottom.n ?? bottom.ordinal } } },
      { id: "proposed_nothing_answered", name: "Nothing answered: Not determined, never a grade of 0", responses: {}, expect: { outcome: OUT.notDetermined.code, aggregates: { graded: 0 } } },
      { id: "proposed_all_na", name: "Everything justified not applicable: Not determined, N/A is never zero", responses: fill(items, () => ({ state: "not_applicable", reason: "profile test" })), expect: { outcome: OUT.notDetermined.code, aggregates: { graded: 0, average_grade: null } } },
    ];
    if (items.length >= 2) {
      const r = all(top.code);
      delete r[rkey(items[0].stable_key)];
      tests.push({ id: "proposed_one_unanswered", name: "One item unanswered: Not determined", responses: r, expect: { outcome: OUT.notDetermined.code } });
      const na = all(top.code);
      na[rkey(items[0].stable_key)] = { state: "not_applicable", reason: "profile test" };
      tests.push({ id: "proposed_one_na", name: `One item N/A with a reason: excluded, average stays ${top.n ?? top.ordinal}`, responses: na, expect: { outcome: OUT.notConfigured.code, aggregates: { average_grade: top.n ?? top.ordinal, graded: items.length - 1 } } });
    }
    return tests;
  }
  const items = def.items.filter((it) => it.response_type === "multiple_choice" && choiceWith(it, 1) && choiceWith(it, 0));
  if (!items.length) return [];
  const yes = (it: InstrumentItem) => ({ value: choiceWith(it, 1)!.code });
  const no = (it: InstrumentItem) => ({ value: choiceWith(it, 0)!.code });
  const partial = (it: InstrumentItem) => (choiceWith(it, 0.5) ? { value: choiceWith(it, 0.5)!.code } : null);
  const tests: ScoringTestCase[] = [
    { id: "proposed_all_yes", name: "Every item Yes: weighted 100, full match 100, interpretation Not configured", responses: fill(items, yes), expect: { outcome: OUT.notConfigured.code, aggregates: { weighted_pct: 100, full_match_pct: 100, judged: items.length } } },
    { id: "proposed_all_no", name: "Every item No: weighted 0, full match 0", responses: fill(items, no), expect: { outcome: OUT.notConfigured.code, aggregates: { weighted_pct: 0, full_match_pct: 0 } } },
    { id: "proposed_nothing_answered", name: "Nothing answered: Not determined, never zero", responses: {}, expect: { outcome: OUT.notDetermined.code, aggregates: { judged: 0 } } },
    { id: "proposed_all_na", name: "Everything justified not applicable: Not determined", responses: fill(items, () => ({ state: "not_applicable", reason: "profile test" })), expect: { outcome: OUT.notDetermined.code, aggregates: { judged: 0, weighted_pct: null } } },
  ];
  if (items.every((it) => partial(it))) tests.push({ id: "proposed_all_partial", name: "Every item Partial: weighted 50, full match 0", responses: fill(items, partial), expect: { outcome: OUT.notConfigured.code, aggregates: { weighted_pct: 50, full_match_pct: 0 } } });
  if (items.length >= 4 && items.every((it) => partial(it))) {
    const r = fill(items, (it, i) => (i === 0 || i === 1 ? yes(it) : i === 2 ? partial(it) : i === 3 ? no(it) : yes(it)));
    const n = items.length;
    const weighted = Math.round(((2 * (n - 2) + 1) / (2 * n)) * 100 * 1e6) / 1e6;
    const full = Math.round(((n - 2) / n) * 100 * 1e6) / 1e6;
    tests.push({ id: "proposed_mixed", name: `Two Yes, one Partial, one No among ${n}: weighted ${weighted}, full match ${full}`, responses: r, expect: { outcome: OUT.notConfigured.code, aggregates: { weighted_pct: weighted, full_match_pct: full } } });
  }
  if (items.length >= 2) {
    const r = fill(items, yes);
    delete r[rkey(items[0].stable_key)];
    tests.push({ id: "proposed_one_unanswered", name: "One item unanswered: Not determined", responses: r, expect: { outcome: OUT.notDetermined.code } });
    const na = fill(items, yes);
    na[rkey(items[0].stable_key)] = { state: "not_applicable", reason: "profile test" };
    tests.push({ id: "proposed_one_na", name: "One item N/A with a reason: excluded from the denominator, weighted stays 100", responses: na, expect: { outcome: OUT.notConfigured.code, aggregates: { weighted_pct: 100, judged: items.length - 1 } } });
  }
  return tests;
}

/** Everything a profile writes into a draft: patched content, rules with saved tests, flags, the recommended delivery mode. */
export function applyProfile(content: EditorContent, profileId: ProfileId, opts: { def: InstrumentDef; levels?: { code: string; label: string; ordinal: number; numeric_value?: number | null }[] | null; respondentRoles?: string[] }): AppliedProfile {
  const profile = PROFILES[profileId];
  const patched = applyProfileToContent(content, profile);
  const def: InstrumentDef = { ...opts.def, items: patched.content.items.map((it) => ({ ...it })) };
  const rules = profileRules(def, profile);
  const tests = profileTests(def, profile, opts.levels ?? null);
  const flags: ImportFlag[] = [...patched.flags];
  flags.push(flag("profile_applied", `Scoring profile applied: ${profile.label}. ${profile.formula}`, "info"));
  if (patched.changes.length) flags.push(flag("profile_content_changes", `The profile set on the content: ${patched.changes.join("; ")}. Each is editable in Content.`, "info"));
  flags.push(flag("interpretation_not_configured", profileId === "graded_assessment"
    ? "No competency threshold is active: the result shows the average grade and achievement percentage and the interpretation Not configured. A proposed decision rule set (minimum grade 3) exists as a separate template awaiting governance approval; it becomes active only when approved and copied into a new version."
    : "No pass threshold is configured: the result shows the percentages and the interpretation Not configured. Add a threshold rule in Scoring & Rules only where the approved standard names one."));
  if (profileId === "graded_assessment") flags.push(flag("average_grade_permits_ordinal_mean", "The average grade is a mean over the scale's grades (permitOrdinalMean is on, and reviewers see that). The scale's grades carry their numeric values as imported.", "info"));
  flags.push(flag("delivery_mode_proposed", `Delivery mode proposed: ${profile.deliveryMode.replace(/_/g, " ")}. Configurable in Settings & Review; it does not change the scoring construct.`, "info"));
  return { profile, content: patched.content, rules, tests, flags, deliveryModes: [profile.deliveryMode], changes: patched.changes };
}

/** The SEPARATE, proposed competency decision for a graded assessment: a rule template that is not active until approved. */
export const PROPOSED_DECISION_TEMPLATE = {
  code: "GRADED-COMPETENCY-DECISION",
  name: "Graded competency decision (proposed minimum grade 3)",
  description: "PROPOSED, not active. Competent when every graded item is at or above grade 3 (independent performance) and every item is answered or justified not applicable. Critical safety failures override. Becomes a formal decision only when clinical governance approves this template; an author then copies it into a new governed version of the instrument.",
  rules: (): RulesDoc => ({
    schema: RULES_SCHEMA,
    profile: { id: "graded_competency_decision", label: "Graded competency decision", version: PROFILE_VERSION, formula: "Competent when the lowest awarded grade is at or above the minimum grade (3) with every item answered or justified N/A; critical safety failures override.", notes: "Proposed. Not active until approved." },
    outcomes: [
      { code: "COMPETENT", label: "Competent", class: "positive" },
      { code: "NOT_YET_COMPETENT", label: "Not yet competent", class: "negative" },
      { code: "NOT_DETERMINED", label: "Not determined", class: "incomplete" },
    ],
    gates: { criticalFail: "NOT_YET_COMPETENT", mandatoryMissing: "NOT_DETERMINED" },
    defaults: { na: "exclude", undeterminable: "exclude" },
    aggregates: [
      { id: "lowest_grade", fn: "min_ordinal", over: { scope: "all" }, weights: "none" },
      { id: "graded", fn: "count", over: { scope: "all" }, weights: "none" },
    ],
    rules: [
      { id: "unanswered", label: "An item is unanswered", priority: 30, when: { count: { scope: "all" }, where: { answered: false }, op: ">", value: 0 }, then: { outcome: "NOT_DETERMINED" } },
      { id: "nothing_graded", label: "Nothing graded", priority: 25, when: { aggregate: "graded", op: "=", value: 0 }, then: { outcome: "NOT_DETERMINED" } },
      { id: "minimum_grade", label: "Every graded item at or above the minimum grade 3", priority: 20, when: { aggregate: "lowest_grade", op: ">=", value: 3 }, then: { outcome: "COMPETENT" }, explain: "The minimum grade is the ordinal 3 of the imported scale (independent performance). Change it here if governance approves another level." },
    ],
    fallback: "NOT_YET_COMPETENT",
  }),
};

// ---- result summaries (section 10): instrument-specific, never one combined score ----------------------------------------

export interface SummaryLine { label: string; value: string; note?: string }
export interface ResultSummary {
  profileId: string;
  title: string;
  /** the calculated result */
  calculated: SummaryLine[];
  /** the governed interpretation, as recorded */
  interpretation: { label: string; configured: boolean; note: string };
  /** items that need attention: below a required level, discrepancies, unmet, critical */
  attention: { label: string; items: { code: string; key: string; detail: string }[] }[];
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "Not calculated" : `${Math.round(v * 10) / 10}%`);
const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "Not calculated" : String(Math.round(v * 10 ** d) / 10 ** d));

/** Pure: the summary a profile promises, from a recorded evaluation and the raw responses. Null when the rules carry no profile. */
export function summarizeResult(def: InstrumentDef, rules: RulesDoc, ev: Evaluation, responses: Responses): ResultSummary | null {
  const p = rules.profile;
  if (!p) return null;
  const configured = ev.outcome.code !== "NOT_CONFIGURED";
  const interpretation = {
    label: ev.outcome.label, configured,
    note: configured ? `Decided by ${ev.decided_by.replace(/^rule:/, "rule ").replace(/^gate:/, "gate ")}.` : "No approved threshold or decision rule set applies to this version: the calculated result stands on its own.",
  };
  const items = def.items;
  const critical = { label: "Critical findings", items: ev.gates.criticalFail.items.map((x) => ({ code: x.code, key: x.key, detail: x.why })) };
  const unanswered = { label: "Unanswered items", items: items.filter((it) => !ev.counts.overall.exclusions.some((e) => e.key === it.stable_key) && !responses[rkey(it.stable_key)]).map((it) => ({ code: it.code, key: it.stable_key, detail: "no response" })) };
  const c = ev.counts.overall;
  if (p.id === "graded_assessment") {
    const scale = items.find((it) => it.scale?.levels.length)?.scale;
    const levels = [...(scale?.levels ?? [])].sort((a, b) => a.ordinal - b.ordinal);
    const max = levels.reduce((m, l) => Math.max(m, l.numeric_value ?? l.ordinal), 0);
    const avg = ev.aggregates.average_grade ?? null;
    const achievement = avg === null || !max ? null : (avg / max) * 100;
    const distribution = levels.map((l) => `${l.code} ${l.label}: ${c.byAnswer[l.code] ?? 0}`).join(", ");
    const threshold = rules.rules.find((r) => "aggregate" in r.when && (r.when as { aggregate: string; value: number }).aggregate === "lowest_grade" && (r.when as { op: string }).op === ">=") as { when: { value: number } } | undefined;
    const below = threshold ? items.filter((it) => { const r = responses[rkey(it.stable_key)]; const l = r?.level_code ? levels.find((x) => x.code === r.level_code) : null; return l && l.ordinal < threshold.when.value; }).map((it) => ({ code: it.code, key: it.stable_key, detail: `below grade ${threshold.when.value}` })) : [];
    return {
      profileId: p.id, title: p.label,
      calculated: [
        { label: "Average grade", value: num(avg), note: `over ${ev.aggregates.graded ?? 0} graded item(s); justified N/A excluded (${c.excluded})` },
        { label: "Achievement percentage", value: pct(achievement), note: `sum of grades over ${max} x graded items` },
        { label: "Grade distribution", value: distribution || "none" },
        { label: "Unanswered", value: String(c.unanswered) },
      ],
      interpretation,
      attention: [{ label: threshold ? `Below the required grade (${threshold.when.value})` : "Below a required grade", items: threshold ? below : [] }, critical, unanswered],
    };
  }
  const byAnswer = c.byAnswer;
  const opt = (credit: number) => items.flatMap((it) => (it.config.options ?? []).filter((o) => o.credit === credit).map((o) => o.code));
  const count = (codes: string[]) => [...new Set(codes)].reduce((n, code) => n + (byAnswer[code] ?? 0), 0);
  const yes = count(opt(1)), partial = count(opt(0.5)), no = count(opt(0));
  const action = { label: "Corrective actions recorded", items: items.filter((it) => { const v = responses[rkey(it.stable_key, "action_needed")]?.value; return typeof v === "string" && v.trim(); }).map((it) => ({ code: it.code, key: it.stable_key, detail: String(responses[rkey(it.stable_key, "action_needed")]?.value).slice(0, 120) })) };
  const unmet = { label: p.id === "weighted_agreement" ? "Discrepancies (No)" : "Unmet requirements (No)", items: items.filter((it) => opt(0).includes(String(responses[rkey(it.stable_key)]?.value ?? ""))).map((it) => ({ code: it.code, key: it.stable_key, detail: String(responses[rkey(it.stable_key, "discrepancy")]?.value ?? responses[rkey(it.stable_key, "evidence_comments")]?.value ?? "").slice(0, 120) })) };
  return {
    profileId: p.id, title: p.label,
    calculated: [
      { label: p.id === "weighted_agreement" ? "Weighted agreement percentage" : "Weighted documentation compliance", value: pct(ev.aggregates.weighted_pct), note: "((2 x Yes) + Partial) / (2 x applicable items)" },
      { label: p.id === "weighted_agreement" ? "Full-match percentage" : "Fully-met percentage", value: pct(ev.aggregates.full_match_pct), note: "Yes / applicable items" },
      { label: "Yes / Partial / No", value: `${yes} / ${partial} / ${no}` },
      { label: "Not applicable (justified, excluded)", value: String(c.excluded) },
      { label: "Unanswered", value: String(c.unanswered) },
    ],
    interpretation,
    attention: [unmet, { label: p.id === "weighted_agreement" ? "Partial matches" : "Partially met requirements", items: items.filter((it) => opt(0.5).includes(String(responses[rkey(it.stable_key)]?.value ?? ""))).map((it) => ({ code: it.code, key: it.stable_key, detail: "" })) }, critical, action, unanswered],
  };
}
