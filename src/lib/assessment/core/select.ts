// asmt core: resolving a Selector against a definition. Shared by scoring, validation and layout.
import type { InstrumentDef, InstrumentItem } from "./types";
import type { Selector } from "./rules-ast";

/** section stable_key -> that key plus every descendant section key */
export function sectionClosure(def: InstrumentDef): Map<string, Set<string>> {
  const kids = new Map<string, string[]>();
  for (const s of def.sections) {
    if (s.parent_section_key) kids.set(s.parent_section_key, [...(kids.get(s.parent_section_key) ?? []), s.stable_key]);
  }
  const out = new Map<string, Set<string>>();
  const walk = (k: string, seen: Set<string>): Set<string> => {
    if (out.has(k)) return out.get(k)!;
    const set = new Set<string>([k]);
    if (!seen.has(k)) {
      seen.add(k);
      for (const c of kids.get(k) ?? []) walk(c, seen).forEach((x) => set.add(x));
    }
    out.set(k, set);
    return set;
  };
  for (const s of def.sections) walk(s.stable_key, new Set());
  return out;
}

/** Items a selector picks, in definition order (section position then item position). */
export function selectItems(def: InstrumentDef, sel: Selector | true | undefined): InstrumentItem[] {
  const s: Selector = sel === true || sel === undefined ? { scope: "all" } : sel;
  let items = orderedItems(def);
  const keys = new Set(s.keys ?? []);
  if (s.scope === "section") {
    const clo = sectionClosure(def);
    const allowed = new Set<string>();
    for (const k of keys) clo.get(k)?.forEach((x) => allowed.add(x));
    items = items.filter((i) => allowed.has(i.section_key));
  } else if (s.scope === "group") items = items.filter((i) => !!i.group_code && keys.has(i.group_code));
  else if (s.scope === "items") items = items.filter((i) => keys.has(i.stable_key));
  if (typeof s.critical === "boolean") items = items.filter((i) => i.critical === s.critical);
  if (typeof s.mandatory === "boolean") items = items.filter((i) => (i.mandatory || i.critical) === s.mandatory);
  if (s.methods && s.methods.length) items = items.filter((i) => i.method_codes.some((m) => s.methods!.includes(m)));
  return items;
}

/** All items ordered by section tree position then item position (the order a reader sees). */
export function orderedItems(def: InstrumentDef): InstrumentItem[] {
  const secs = orderedSections(def);
  const rank = new Map(secs.map((s, i) => [s.stable_key, i]));
  return [...def.items].sort((a, b) => (rank.get(a.section_key) ?? 1e9) - (rank.get(b.section_key) ?? 1e9) || a.position - b.position);
}

/** Sections in reading order: depth-first by position. Sections whose parent is missing are treated as roots. */
export function orderedSections(def: InstrumentDef) {
  const known = new Set(def.sections.map((s) => s.stable_key));
  const byParent = new Map<string | null, typeof def.sections>();
  for (const s of def.sections) {
    const p = s.parent_section_key && known.has(s.parent_section_key) ? s.parent_section_key : null;
    byParent.set(p, [...(byParent.get(p) ?? []), s]);
  }
  const out: typeof def.sections = [];
  const seen = new Set<string>();
  const walk = (p: string | null) => {
    for (const s of [...(byParent.get(p) ?? [])].sort((a, b) => a.position - b.position)) {
      if (seen.has(s.stable_key)) continue;
      seen.add(s.stable_key);
      out.push(s);
      walk(s.stable_key);
    }
  };
  walk(null);
  return out;
}
