// The closed-vocabulary filter for a layout. A layout may only change how items look: it has no key that selects, hides,
// filters or reorders items. cleanLayout rebuilds a layout from the keys the grammar defines and drops every other key at
// every level, so whatever reaches the Designer (or leaves it) can never carry an item selector.
import {
  CONTROL_VOCAB, LAYOUT_SCHEMA, NAV_KEYS, PRINT_KEYS, SLOT_KEYS,
  type LayoutDoc,
} from "@/lib/assessment/core";

type Rec = Record<string, unknown>;
const isObj = (x: unknown): x is Rec => !!x && typeof x === "object" && !Array.isArray(x);
const pickKeys = (o: unknown, keys: readonly string[]): Rec => {
  const out: Rec = {};
  if (!isObj(o)) return out;
  for (const k of keys) if (k in o && o[k] !== undefined) out[k] = o[k];
  return out;
};

function cleanSlots(s: unknown): Rec { const o = pickKeys(s, SLOT_KEYS); if (Array.isArray(o.badges)) o.badges = [...o.badges]; return o; }

export function cleanLayout(input: unknown): LayoutDoc {
  const l = isObj(input) ? input : {};
  const out: Rec = { schema: LAYOUT_SCHEMA };
  out.presentation = l.presentation;
  const nav = pickKeys(l.navigation, NAV_KEYS);
  if (isObj((l.navigation as Rec | undefined)?.sectionTabs)) nav.sectionTabs = pickKeys((l.navigation as Rec).sectionTabs, ["counts"]);
  out.navigation = nav;
  out.header = Array.isArray(l.header) ? [...l.header] : l.header;
  if (isObj(l.metadata)) out.metadata = { fields: Array.isArray(l.metadata.fields) ? l.metadata.fields.map((f) => pickKeys(f, ["key", "label"])) : l.metadata.fields };
  out.section = pickKeys(l.section, ["component", "collapsible", "groupBadges"]);
  out.item = isObj(l.item) ? { ...pickKeys(l.item, ["component"]), slots: cleanSlots(l.item.slots) } : l.item;
  out.controls = isObj(l.controls) ? Object.fromEntries(Object.entries(l.controls).filter(([k]) => k in CONTROL_VOCAB)) : l.controls;
  out.grouping = l.grouping;
  out.indicators = pickKeys(l.indicators, ["completed", "unassessed", "critical", "missingEvidence"]);
  if (isObj(l.outcomePreview)) out.outcomePreview = pickKeys(l.outcomePreview, ["enabled", "label"]);
  if (isObj(l.breakpoints)) {
    const b: Rec = {};
    for (const bp of ["mobile", "tablet"]) {
      const x = (l.breakpoints as Rec)[bp];
      if (!isObj(x)) continue;
      const y: Rec = {};
      if (isObj(x.item)) y.item = pickKeys(x.item, ["component"]);
      if (isObj(x.slots)) y.slots = cleanSlots(x.slots);
      b[bp] = y;
    }
    out.breakpoints = b;
  }
  out.print = pickKeys(l.print, PRINT_KEYS);
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as unknown as LayoutDoc;
}
