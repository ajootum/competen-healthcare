// Checklist Studio: pure diff between the saved content of a draft and the content the editor sends.
// The server writes only what changed (each child write names its editor), and deletes what is gone.
import { canonicalJson } from "../core";
import type { InstrumentGroup, InstrumentSection } from "../core";
import type { EditorContent, EditorItem } from "./types";

export interface ContentDiff {
  groupUpserts: InstrumentGroup[];
  groupDeletes: string[];
  sectionUpserts: InstrumentSection[];
  sectionDeletes: string[];
  itemUpserts: EditorItem[];
  itemDeletes: string[];
  unchanged: boolean;
}

/** The frozen scale is derived from scale_version_id and is never stored with the item, so it is not part of the signature. */
export function itemSignature(it: EditorItem): string {
  const { scale: _s, fields, ...rest } = it;
  void _s;
  return canonicalJson({ ...rest, fields: (fields ?? []).map(({ scale: _fs, ...f }) => { void _fs; return f; }) });
}

/** Parents first, so a child section can point at its parent when it is written. */
export function sectionsParentFirst(sections: InstrumentSection[]): InstrumentSection[] {
  const byKey = new Map(sections.map((s) => [s.stable_key, s]));
  const depth = (s: InstrumentSection, seen = new Set<string>()): number => {
    if (!s.parent_section_key || seen.has(s.stable_key)) return 0;
    seen.add(s.stable_key);
    const p = byKey.get(s.parent_section_key);
    return p ? 1 + depth(p, seen) : 0;
  };
  return [...sections].sort((a, b) => depth(a) - depth(b));
}

export function diffContent(current: EditorContent, next: EditorContent): ContentDiff {
  const curGroups = new Map(current.groups.map((g) => [g.code, canonicalJson(g)]));
  const nextGroupCodes = new Set(next.groups.map((g) => g.code));
  const curSections = new Map(current.sections.map((s) => [s.stable_key, canonicalJson(s)]));
  const nextSectionKeys = new Set(next.sections.map((s) => s.stable_key));
  const curItems = new Map(current.items.map((i) => [i.stable_key, itemSignature(i)]));
  const nextItemKeys = new Set(next.items.map((i) => i.stable_key));

  const groupUpserts = next.groups.filter((g) => curGroups.get(g.code) !== canonicalJson(g));
  const sectionUpserts = sectionsParentFirst(next.sections.filter((s) => curSections.get(s.stable_key) !== canonicalJson(s)));
  const itemUpserts = next.items.filter((i) => curItems.get(i.stable_key) !== itemSignature(i));
  const groupDeletes = current.groups.filter((g) => !nextGroupCodes.has(g.code)).map((g) => g.code);
  const sectionDeletes = current.sections.filter((s) => !nextSectionKeys.has(s.stable_key)).map((s) => s.stable_key);
  const itemDeletes = current.items.filter((i) => !nextItemKeys.has(i.stable_key)).map((i) => i.stable_key);
  return {
    groupUpserts, groupDeletes, sectionUpserts, sectionDeletes, itemUpserts, itemDeletes,
    unchanged: !groupUpserts.length && !groupDeletes.length && !sectionUpserts.length && !sectionDeletes.length && !itemUpserts.length && !itemDeletes.length,
  };
}

/** Problems that make a content payload unwritable, found before touching the database. */
export function contentProblems(c: EditorContent): string[] {
  const out: string[] = [];
  const secKeys = new Set<string>();
  for (const s of c.sections) { if (secKeys.has(s.stable_key)) out.push(`Section key ${s.stable_key} is repeated.`); secKeys.add(s.stable_key); if (!s.title.trim()) out.push("Every section needs a title."); }
  const groupCodes = new Set<string>();
  for (const g of c.groups) { if (groupCodes.has(g.code)) out.push(`Group code ${g.code} is repeated.`); groupCodes.add(g.code); if (!g.label.trim()) out.push("Every group needs a label."); }
  const itemKeys = new Set<string>();
  for (const i of c.items) {
    if (itemKeys.has(i.stable_key)) out.push(`Item key ${i.stable_key} is repeated.`);
    itemKeys.add(i.stable_key);
    if (!i.prompt.trim()) out.push("Every item needs a prompt.");
    if (i.section_key && !secKeys.has(i.section_key)) out.push(`Item "${i.prompt.slice(0, 30)}" sits in a section that does not exist.`);
    if (i.group_code && !groupCodes.has(i.group_code)) out.push(`Item "${i.prompt.slice(0, 30)}" uses a group that does not exist.`);
    if (i.critical && !i.mandatory) out.push(`Item "${i.prompt.slice(0, 30)}" is critical, so it must also be mandatory.`);
    if (i.response_type === "rating_scale" && !i.scale_version_id) out.push(`Item "${i.prompt.slice(0, 30)}" is a rating item and needs a scale.`);
  }
  return out;
}
