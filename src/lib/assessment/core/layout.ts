// asmt core: from (definition, layout, responses, evaluation) to a view model the renderer draws.
//
// ⚠ A LAYOUT NEVER DECIDES WHICH ITEMS APPEAR. resolveView reads only the closed vocabulary of asmt.layout/1; every
// item of the definition is in `items`, in exactly one block, and in exactly one step of a stepper. Unknown or hostile
// keys in a layout are ignored here and refused by validateLayout. A renderer must draw `blocks` (scroll / section tabs)
// or `steps` (stepper) and nothing else.
//
// Two presentations are built in Phase 1:
//   Standard Checklist   navigation scroll, every item on one page
//   Guided Assessment    navigation stepper, one item at a time (unit item) or one section at a time (unit section)
// Both share the same responses, so switching between them loses nothing.
import { orderedItems, orderedSections } from "./select";
import { progress, itemProgress, type Evaluation, type Progress } from "./scoring";
import { allowedStates, fieldSpec, stateLabel, type FieldSpec } from "./responses";
import {
  CONTROL_VOCAB, LAYOUT_SCHEMA, type Badge, type HeaderBlock, type LayoutDoc, type LayoutSlots,
} from "./rules-ast";
import { PRIMARY, rkey, type EvalContext, type InstrumentDef, type InstrumentItem, type OutcomeClass, type ResponseType, type ResponseValue, type Responses, type Treatment } from "./types";

const baseSlots: LayoutSlots = { guidance: "disclosure", expected: "inline", response: "right", evidence: "drawer", comment: "drawer", fields: "grid2", badges: ["critical", "mandatory", "method", "group"] };

export const STANDARD_CHECKLIST_LAYOUT: LayoutDoc = {
  schema: LAYOUT_SCHEMA,
  presentation: "standard_checklist",
  navigation: { mode: "scroll", unit: "section", progress: "bar", allowJump: true, prevNext: false },
  header: ["TitleBlock", "SubjectBlock", "ProgressBlock"],
  section: { component: "SectionCard", collapsible: true, groupBadges: true },
  item: { component: "ItemRow", slots: { ...baseSlots } },
  controls: {},
  grouping: "section",
  indicators: { completed: true, unassessed: true, critical: true, missingEvidence: true },
  outcomePreview: { enabled: true, label: "Preview outcome" },
  breakpoints: { mobile: { item: { component: "ItemCard" }, slots: { response: "below", fields: "stack" } } },
  print: { guidance: true, responses: true, evidenceList: true, pageBreak: "section", signature: true, orientation: "portrait" },
};

export const GUIDED_ASSESSMENT_LAYOUT: LayoutDoc = {
  schema: LAYOUT_SCHEMA,
  presentation: "guided_assessment",
  navigation: { mode: "stepper", unit: "item", progress: "count", allowJump: true, prevNext: true },
  header: ["TitleBlock", "ProgressBlock"],
  section: { component: "SectionCard", collapsible: false, groupBadges: true },
  item: { component: "ItemFocus", slots: { ...baseSlots, guidance: "inline", response: "below", evidence: "inline", comment: "inline" } },
  controls: {},
  grouping: "section",
  indicators: { completed: true, unassessed: true, critical: true, missingEvidence: true },
  outcomePreview: { enabled: true, label: "Preview outcome" },
  print: { guidance: true, responses: true, evidenceList: true, pageBreak: "none", signature: true, orientation: "portrait" },
};

export type Breakpoint = "desktop" | "tablet" | "mobile";

export interface ViewOption { code: string; label: string; description?: string | null; ordinal?: number }
export interface ViewField {
  field_key: string;
  label: string;
  response_type: ResponseType;
  control: string;
  options: ViewOption[];
  states: { state: string; label: string }[];
  required: boolean;
  answered: boolean;
  response: ResponseValue | null;
}
export interface ViewItem {
  key: string;
  code: string;
  section_key: string;
  group_code: string | null;
  prompt: string;
  guidance: string | null;
  expected: string[];
  response_type: ResponseType;
  /** the control that draws the primary field. A rating scale control shows every level's label AND description. */
  control: string;
  options: ViewOption[];
  states: { state: string; label: string }[];
  component: LayoutDoc["item"]["component"];
  slots: LayoutSlots;
  /** badges this item shows: the layout's choice, limited to the ones that apply */
  badges: Badge[];
  fields: ViewField[];
  response: ResponseValue | null;
  status: { complete: boolean; unassessed: boolean; critical: boolean; criticalFailed: boolean; missingEvidence: boolean; missingFields: string[] };
}
export interface ViewBlock {
  key: string;
  kind: "section" | "group";
  title: string;
  depth: number;
  guidance: string | null;
  /** for section_then_group: the group label under the section title */
  subtitle: string | null;
  items: ViewItem[];
  counts: { total: number; complete: number; remaining: number };
}
export interface ViewStep { key: string; itemKeys: string[]; blockKey: string }
export interface ViewModel {
  presentation: LayoutDoc["presentation"];
  mode: LayoutDoc["navigation"]["mode"];
  unit: LayoutDoc["navigation"]["unit"];
  navigation: LayoutDoc["navigation"];
  header: HeaderBlock[];
  /** MetadataBlock values: labels from the layout, values supplied by the adapter */
  metadata: { key: string; label: string; value: string | null }[];
  /** ContextBlock text supplied by the adapter (absent for instruments with no pathway) */
  context: string | null;
  section: LayoutDoc["section"];
  blocks: ViewBlock[];
  /** every item, in reading order. Always the full list. */
  items: ViewItem[];
  itemKeys: string[];
  steps: ViewStep[];
  step: { index: number; total: number; key: string | null; prevKey: string | null; nextKey: string | null };
  sectionTabs: { key: string; title: string; total: number; complete: number; remaining: number }[] | null;
  progress: Progress;
  indicators: LayoutDoc["indicators"];
  outcomePreview: { enabled: boolean; label: string; evaluation: { code: string; label: string; class: OutcomeClass; decided_by: string } | null };
  print: LayoutDoc["print"];
}

export interface ViewOptions {
  breakpoint?: Breakpoint;
  /** zero-based step to show in a stepper */
  currentStep?: number;
  metadata?: Record<string, string | null | undefined>;
  context?: string | null;
  evidenceCounts?: EvalContext["evidenceCounts"];
  defaults?: Treatment;
}

const YESNO: Partial<Record<ResponseType, ViewOption[]>> = {
  yes_no: [{ code: "yes", label: "Yes" }, { code: "no", label: "No" }],
  pass_fail: [{ code: "pass", label: "Pass" }, { code: "fail", label: "Fail" }],
  achieved: [{ code: "achieved", label: "Achieved" }, { code: "not_achieved", label: "Not achieved" }],
};

function optionsOf(sp: FieldSpec): ViewOption[] {
  if (sp.response_type === "rating_scale") {
    return [...(sp.scale?.levels ?? [])].sort((a, b) => a.ordinal - b.ordinal).map((l) => ({ code: l.code, label: l.label, description: l.description ?? null, ordinal: l.ordinal }));
  }
  if (sp.response_type === "multiple_choice") return (sp.config.options ?? []).map((o) => ({ code: o.code, label: o.label, description: o.description ?? null }));
  return YESNO[sp.response_type] ?? [];
}

function viewField(item: InstrumentItem, fieldKey: string, layout: LayoutDoc, responses: Responses): ViewField {
  const sp = fieldSpec(item, fieldKey)!;
  const vocab = CONTROL_VOCAB[sp.response_type];
  const asked = layout.controls?.[sp.response_type];
  const r = responses[rkey(item.stable_key, fieldKey)] ?? null;
  return {
    field_key: fieldKey, label: sp.label, response_type: sp.response_type,
    control: asked && vocab.includes(asked) ? asked : vocab[0],
    options: optionsOf(sp),
    states: allowedStates(sp).filter((s) => s !== "not_assessed").map((s) => ({ state: s, label: stateLabel(sp, s) })),
    required: sp.required, answered: !!r && (r.state != null || r.level_code != null || r.value != null) && r.state !== "not_assessed",
    response: r,
  };
}

/** The layout the view actually uses: the given one over the presentation's built-in default, with a bad shape ignored. */
function normalise(layout: LayoutDoc | null | undefined): LayoutDoc {
  const def = layout?.presentation === "guided_assessment" ? GUIDED_ASSESSMENT_LAYOUT : STANDARD_CHECKLIST_LAYOUT;
  const l = (layout ?? {}) as Partial<LayoutDoc>;
  const pick = <T,>(v: T | undefined, d: T, ok: (x: T) => boolean): T => (v !== undefined && v !== null && ok(v) ? v : d);
  const obj = (x: unknown) => !!x && typeof x === "object" && !Array.isArray(x);
  return {
    schema: LAYOUT_SCHEMA,
    presentation: l.presentation ?? def.presentation,
    navigation: { ...def.navigation, ...(obj(l.navigation) ? l.navigation : {}) },
    header: pick(l.header, def.header, Array.isArray),
    metadata: l.metadata,
    section: { ...def.section, ...(obj(l.section) ? l.section : {}) },
    item: { component: l.item?.component ?? def.item.component, slots: { ...def.item.slots, ...(obj(l.item?.slots) ? l.item!.slots : {}) } },
    controls: pick(l.controls, def.controls, obj),
    grouping: l.grouping ?? def.grouping,
    indicators: { ...def.indicators, ...(obj(l.indicators) ? l.indicators : {}) },
    outcomePreview: l.outcomePreview ?? def.outcomePreview,
    breakpoints: l.breakpoints,
    print: { ...def.print, ...(obj(l.print) ? l.print : {}) },
  };
}

export function resolveView(
  def: InstrumentDef, layoutIn: LayoutDoc | null | undefined, responses: Responses, evaluation?: Evaluation | null, opts: ViewOptions = {},
): ViewModel {
  const layout = normalise(layoutIn);
  const bp = opts.breakpoint ?? "desktop";
  const over = bp === "mobile" ? layout.breakpoints?.mobile : bp === "tablet" ? layout.breakpoints?.tablet : undefined;
  const component = over?.item?.component ?? layout.item.component;
  const slots: LayoutSlots = { ...layout.item.slots, ...(over?.slots ?? {}) };
  if (bp === "mobile") slots.fields = "stack";
  const ctx: EvalContext = { evidenceCounts: opts.evidenceCounts };
  const prog = progress(def, responses, ctx, opts.defaults);
  const secOf = new Map(def.sections.map((s) => [s.stable_key, s]));

  const items: ViewItem[] = orderedItems(def).map((it) => {
    const p = itemProgress(it, responses, ctx, opts.defaults);
    const primary = viewField(it, PRIMARY, layout, responses);
    const applicable: Badge[] = [];
    if (it.critical) applicable.push("critical");
    if (it.mandatory && !it.critical) applicable.push("mandatory");
    if (it.method_codes.length) applicable.push("method");
    if (it.group_code && layout.section.groupBadges) applicable.push("group");
    return {
      key: it.stable_key, code: it.code, section_key: it.section_key, group_code: it.group_code ?? null,
      prompt: it.prompt, guidance: it.guidance ?? null, expected: (it.expected_performance ?? []).map((e) => e.text),
      response_type: it.response_type, control: primary.control, options: primary.options, states: primary.states,
      component, slots, badges: applicable.filter((b) => slots.badges.includes(b)),
      fields: [...(it.fields ?? [])].sort((a, b) => a.position - b.position).map((f) => viewField(it, f.field_key, layout, responses)),
      response: primary.response,
      status: { complete: p.complete, unassessed: p.unassessed, critical: it.critical, criticalFailed: p.criticalFailed, missingEvidence: p.missingEvidence, missingFields: p.missingFields },
    };
  });

  // blocks: every item lands in exactly one
  const depthOf = (k: string): number => { let d = 0; let cur = secOf.get(k); const seen = new Set<string>(); while (cur?.parent_section_key && !seen.has(cur.stable_key)) { seen.add(cur.stable_key); d++; cur = secOf.get(cur.parent_section_key); } return d; };
  const groupsSorted = [...def.groups].sort((a, b) => a.position - b.position);
  const mk = (key: string, kind: ViewBlock["kind"], title: string, depth: number, guidance: string | null, subtitle: string | null, its: ViewItem[]): ViewBlock => {
    const complete = its.filter((i) => i.status.complete).length;
    return { key, kind, title, depth, guidance, subtitle, items: its, counts: { total: its.length, complete, remaining: its.length - complete } };
  };
  const secs = orderedSections(def);
  let blocks: ViewBlock[] = [];
  if (layout.grouping === "group") {
    for (const g of groupsSorted) blocks.push(mk(`group:${g.code}`, "group", g.label, 0, null, null, items.filter((i) => i.group_code === g.code)));
    const rest = items.filter((i) => !i.group_code || !groupsSorted.some((g) => g.code === i.group_code));
    if (rest.length) blocks.push(mk("group:", "group", "Other", 0, null, null, rest));
  } else if (layout.grouping === "section_then_group") {
    for (const s of secs) {
      const mine = items.filter((i) => i.section_key === s.stable_key);
      const used = new Set<string>();
      for (const g of groupsSorted) {
        const sub = mine.filter((i) => i.group_code === g.code);
        if (sub.length) { used.add(g.code); blocks.push(mk(`${s.stable_key}|${g.code}`, "section", s.title, depthOf(s.stable_key), s.guidance ?? null, g.label, sub)); }
      }
      const rest = mine.filter((i) => !i.group_code || !used.has(i.group_code));
      if (rest.length || mine.length === 0) blocks.push(mk(`${s.stable_key}|`, "section", s.title, depthOf(s.stable_key), s.guidance ?? null, null, rest));
    }
  } else {
    blocks = secs.map((s) => mk(s.stable_key, "section", s.title, depthOf(s.stable_key), s.guidance ?? null, null, items.filter((i) => i.section_key === s.stable_key)));
  }
  // safety net: an item whose section is unknown must still appear
  const placed = new Set(blocks.flatMap((b) => b.items.map((i) => i.key)));
  const orphans = items.filter((i) => !placed.has(i.key));
  if (orphans.length) blocks.push(mk("orphans", "section", "Other items", 0, null, null, orphans));

  const nav = layout.navigation;
  const steps: ViewStep[] = nav.mode === "stepper" && nav.unit === "item"
    ? blocks.flatMap((b) => b.items.map((i) => ({ key: i.key, itemKeys: [i.key], blockKey: b.key })))
    : blocks.filter((b) => b.items.length).map((b) => ({ key: b.key, itemKeys: b.items.map((i) => i.key), blockKey: b.key }));
  const idx = Math.min(Math.max(0, Math.trunc(opts.currentStep ?? 0)), Math.max(0, steps.length - 1));
  const md = layout.metadata?.fields ?? [];

  return {
    presentation: layout.presentation, mode: nav.mode, unit: nav.unit, navigation: nav, header: layout.header,
    metadata: md.map((f) => ({ key: f.key, label: f.label, value: opts.metadata?.[f.key] ?? null })),
    context: opts.context ?? null,
    section: layout.section,
    blocks, items, itemKeys: items.map((i) => i.key), steps,
    step: { index: idx, total: steps.length, key: steps[idx]?.key ?? null, prevKey: idx > 0 ? steps[idx - 1].key : null, nextKey: idx < steps.length - 1 ? steps[idx + 1].key : null },
    sectionTabs: nav.mode === "section_tabs" || nav.sectionTabs
      ? blocks.map((b) => ({ key: b.key, title: b.title, total: b.counts.total, complete: b.counts.complete, remaining: b.counts.remaining }))
      : null,
    progress: prog, indicators: layout.indicators,
    outcomePreview: {
      enabled: !!layout.outcomePreview?.enabled, label: layout.outcomePreview?.label ?? "Preview outcome",
      evaluation: evaluation ? { code: evaluation.outcome.code, label: evaluation.outcome.label, class: evaluation.class, decided_by: evaluation.decided_by } : null,
    },
    print: layout.print,
  };
}
