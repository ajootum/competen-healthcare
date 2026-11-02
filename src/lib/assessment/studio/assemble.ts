// Checklist Studio: pure assembly of an engine InstrumentDef from database rows (no I/O, client-safe, tested).
// Rows are snake_case and mirror the asmt_* columns, so the mapping is 1:1.
import type { InstrumentDef, ResponseScale, ScaleLevel, ScaleStateDef, StateCode } from "../core";
import type { EditorContent, EditorItem, ItemMapping } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const num = (v: unknown, d = 0): number => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const arr = <T = string>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** A frozen scale as the engine wants it, from the level and state rows of one scale version. */
export function scaleFromRows(scaleVersionId: string, head: Row, levels: Row[], states: Row[]): ResponseScale {
  const lv: ScaleLevel[] = [...levels].sort((a, b) => num(a.ordinal) - num(b.ordinal)).map((l) => ({
    code: String(l.code), label: String(l.label), description: l.description ?? null, ordinal: num(l.ordinal),
    numeric_value: l.numeric_value === null || l.numeric_value === undefined ? null : num(l.numeric_value),
    satisfactory: l.satisfactory === null || l.satisfactory === undefined ? null : Boolean(l.satisfactory),
    colour_token: l.colour_token ?? null, source_level_id: l.source_level_id ?? null,
  }));
  const st: ScaleStateDef[] = states.map((s) => ({ state: String(s.state) as StateCode, label: String(s.label) }));
  return { code: head?.code, version_id: scaleVersionId, scale_kind: head?.scale_kind === "stage" ? "stage" : "rating", levels: lv, states: st };
}

export interface AssembleInput {
  instrumentCode?: string;
  versionNo: number;
  versionId?: string;
  purposeCode?: string | null;
  methodCodes?: string[];
  groups: Row[];
  sections: Row[];
  items: Row[];
  fields: Row[];
  mappings: Row[];
  /** scale version id -> frozen scale */
  scales: Map<string, ResponseScale> | Record<string, ResponseScale>;
}

const scaleOf = (scales: AssembleInput["scales"], id: string | null | undefined): ResponseScale | null => {
  if (!id) return null;
  return (scales instanceof Map ? scales.get(id) : scales[id]) ?? null;
};

export function mappingFromRow(m: Row): ItemMapping {
  return {
    kind: String(m.kind), ref_id: m.ref_id ?? null, ref_code: m.ref_code ?? null, ref_version: m.ref_version ?? null,
    ref_hash: m.ref_hash ?? null, ref_snapshot: obj(m.ref_snapshot), relation: (m.relation ?? "assesses") as ItemMapping["relation"],
  };
}

/** Rows -> what the Content tab edits. Sections are ordered by position, items by position within the version. */
export function assembleContent(input: AssembleInput): EditorContent {
  const secKeyById = new Map<string, string>(input.sections.map((s) => [String(s.id), String(s.stable_key)]));
  const itemKeyById = new Map<string, string>(input.items.map((i) => [String(i.id), String(i.stable_key)]));
  const groups = [...input.groups].sort((a, b) => num(a.position) - num(b.position)).map((g) => ({
    code: String(g.code), label: String(g.label), weight: num(g.weight, 1), position: num(g.position), source_ref: g.source_ref ?? null,
  }));
  const sections = [...input.sections].sort((a, b) => num(a.position) - num(b.position)).map((s) => ({
    stable_key: String(s.stable_key), parent_section_key: s.parent_section_id ? secKeyById.get(String(s.parent_section_id)) ?? null : null,
    title: String(s.title), guidance: s.guidance ?? null, weight: num(s.weight, 1), position: num(s.position),
  }));
  const fieldsByItem = new Map<string, Row[]>();
  for (const f of input.fields) {
    const k = itemKeyById.get(String(f.item_id));
    if (k) fieldsByItem.set(k, [...(fieldsByItem.get(k) ?? []), f]);
  }
  const mapByItem = new Map<string, ItemMapping>();
  for (const m of input.mappings) {
    const k = m.item_id ? itemKeyById.get(String(m.item_id)) : null;
    if (k && !mapByItem.has(k)) mapByItem.set(k, mappingFromRow(m));
  }
  const items: EditorItem[] = [...input.items].sort((a, b) => num(a.position) - num(b.position)).map((i) => {
    const key = String(i.stable_key);
    const er = obj(i.evidence_requirement);
    const fields = (fieldsByItem.get(key) ?? []).sort((a, b) => num(a.position) - num(b.position)).map((f) => ({
      field_key: String(f.field_key), label: String(f.label), response_type: f.response_type, scale_version_id: f.scale_version_id ?? null,
      scale: scaleOf(input.scales, f.scale_version_id), config: obj(f.config), required: Boolean(f.required), position: num(f.position),
    }));
    return {
      stable_key: key, section_key: i.section_id ? secKeyById.get(String(i.section_id)) ?? "" : "", code: i.code ?? "", prompt: String(i.prompt),
      guidance: i.guidance ?? null, expected_performance: arr<{ term_id?: string | null; text: string }>(i.expected_performance),
      response_type: i.response_type, scale_version_id: i.scale_version_id ?? null, scale: scaleOf(input.scales, i.scale_version_id),
      config: obj(i.config), fields, group_code: i.group_code ?? null, method_codes: arr(i.method_codes), method_rule: i.method_rule === "all" ? "all" : "any",
      mandatory: Boolean(i.mandatory), critical: Boolean(i.critical), critical_requirements: arr(i.critical_requirements) as EditorItem["critical_requirements"],
      evidence_requirement: Object.keys(er).length ? (er as unknown as EditorItem["evidence_requirement"]) : null, weight: num(i.weight, 1),
      references_text: i.references_text ?? null, position: num(i.position), mapping: mapByItem.get(key) ?? null,
    };
  });
  return { groups, sections, items };
}

/** The engine definition. The mapping is a Studio concern and is dropped. */
export function toDefinition(content: EditorContent, meta: { instrumentCode?: string; versionNo: number; versionId?: string; purposeCode?: string | null; methodCodes?: string[] }): InstrumentDef {
  return {
    instrument_code: meta.instrumentCode, version_no: meta.versionNo, version_id: meta.versionId, purpose_code: meta.purposeCode ?? null,
    method_codes: meta.methodCodes ?? [], groups: content.groups,
    sections: content.sections,
    items: content.items.map(({ mapping: _m, ...it }) => { void _m; return it; }),
  };
}

export function assembleDefinition(input: AssembleInput): { content: EditorContent; def: InstrumentDef } {
  const content = assembleContent(input);
  return { content, def: toDefinition(content, { instrumentCode: input.instrumentCode, versionNo: input.versionNo, versionId: input.versionId, purposeCode: input.purposeCode, methodCodes: input.methodCodes }) };
}

/** Renumber positions 1..n in array order (what a reorder does). Returns new arrays, never mutates. */
export function renumber<T extends { position: number }>(list: T[]): T[] {
  return list.map((x, i) => ({ ...x, position: i + 1 }));
}
