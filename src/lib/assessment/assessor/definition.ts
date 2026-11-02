// Assessor workspace: the frozen definition of a published version, loaded for use.
//
// Definitions (versions, groups, sections, items, fields, scales, layouts) are not captured data and are not governed by
// the plane boundary. An instance pins ONE version, so what an assessor sees is what was published and nothing later.
// assembleDefinition() is pure and is what the tests exercise. loadDefinition() only fetches the rows.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  InstrumentDef, InstrumentGroup, InstrumentItem, InstrumentSection, ItemField, ResponseScale, RulesDoc, StateCode, LayoutDoc,
} from "@/lib/assessment/core";
import { type Admin, type Res, fail, okRes } from "./common";

/** A synthetic section for an item that sits in no section (allowed by the DDL, not by the engine). */
export const LOOSE_SECTION_KEY = "00000000-0000-4000-8000-000000000000";

type Row = Record<string, any>;

export interface DefinitionRows {
  version: Row;
  groups: Row[];
  sections: Row[];
  items: Row[];
  fields: Row[];
  scaleVersions: Row[];
  levels: Row[];
  states: Row[];
}

export interface LoadedDefinition {
  version: {
    id: string; instrument_id: string; version_no: number; state: string; title: string | null; purpose_code: string;
    method_codes: string[]; scoring_hash: string | null; content_hash: string | null; default_layout_version_id: string | null;
    assess_capability: string | null; respondent_roles: string[]; delivery_modes: string[]; published_at: string | null;
  };
  def: InstrumentDef;
  rules: RulesDoc;
  /** item stable_key -> item id, and back. The database keys answers by item id. */
  itemIdByKey: Record<string, string>;
  itemKeyById: Record<string, string>;
}

const num = (v: unknown, d = 0): number => { const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? n : d; };

function scaleOf(versionId: string, rows: DefinitionRows): ResponseScale | null {
  const sv = rows.scaleVersions.find(s => s.id === versionId);
  if (!sv) return null;
  return {
    version_id: versionId,
    scale_kind: sv.scale_kind === "stage" ? "stage" : "rating",
    levels: rows.levels.filter(l => l.version_id === versionId).sort((a, b) => num(a.ordinal) - num(b.ordinal)).map(l => ({
      code: l.code, label: l.label, description: l.description ?? null, ordinal: num(l.ordinal),
      numeric_value: l.numeric_value === null || l.numeric_value === undefined ? null : num(l.numeric_value),
      satisfactory: l.satisfactory ?? null, colour_token: l.colour_token ?? null, source_level_id: l.source_level_id ?? null,
    })),
    states: rows.states.filter(s => s.version_id === versionId).map(s => ({ state: s.state as StateCode, label: s.label })),
  };
}

export function assembleDefinition(rows: DefinitionRows): { def: InstrumentDef; itemIdByKey: Record<string, string>; itemKeyById: Record<string, string> } {
  const v = rows.version;
  const secKeyById = new Map<string, string>(rows.sections.map(s => [s.id, s.stable_key]));
  const sections: InstrumentSection[] = rows.sections.slice().sort((a, b) => num(a.position) - num(b.position)).map(s => ({
    stable_key: s.stable_key, parent_section_key: s.parent_section_id ? secKeyById.get(s.parent_section_id) ?? null : null,
    title: s.title, guidance: s.guidance ?? null, weight: num(s.weight, 1), position: num(s.position),
  }));
  const groups: InstrumentGroup[] = rows.groups.slice().sort((a, b) => num(a.position) - num(b.position)).map(g => ({
    code: g.code, label: g.label, weight: num(g.weight, 1), position: num(g.position), source_ref: g.source_ref ?? null,
  }));
  let loose = false;
  const items: InstrumentItem[] = rows.items.slice().sort((a, b) => num(a.position) - num(b.position)).map(i => {
    let section_key: string | undefined = i.section_id ? secKeyById.get(i.section_id) : undefined;
    if (!section_key) { section_key = LOOSE_SECTION_KEY; loose = true; }
    const fields: ItemField[] = rows.fields.filter(f => f.item_id === i.id).sort((a, b) => num(a.position) - num(b.position)).map(f => ({
      field_key: f.field_key, label: f.label, response_type: f.response_type, scale_version_id: f.scale_version_id ?? null,
      scale: f.scale_version_id ? scaleOf(f.scale_version_id, rows) : null, config: f.config ?? {}, required: !!f.required, position: num(f.position),
    }));
    const er = i.evidence_requirement && typeof i.evidence_requirement === "object" && "required" in i.evidence_requirement ? i.evidence_requirement : null;
    return {
      stable_key: i.stable_key, section_key, code: i.code ?? "", prompt: i.prompt, guidance: i.guidance ?? null,
      expected_performance: Array.isArray(i.expected_performance) ? i.expected_performance : [],
      response_type: i.response_type, scale_version_id: i.scale_version_id ?? null,
      scale: i.scale_version_id ? scaleOf(i.scale_version_id, rows) : null, config: i.config ?? {}, fields,
      group_code: i.group_code ?? null, method_codes: i.method_codes ?? [], method_rule: i.method_rule === "all" ? "all" : "any",
      mandatory: !!i.mandatory, critical: !!i.critical, critical_requirements: i.critical_requirements ?? [],
      evidence_requirement: er, weight: num(i.weight, 1), references_text: i.references_text ?? null, position: num(i.position),
    } as InstrumentItem;
  });
  if (loose) sections.push({ stable_key: LOOSE_SECTION_KEY, parent_section_key: null, title: "Other items", guidance: null, weight: 1, position: 1_000_000 });
  const itemIdByKey: Record<string, string> = {};
  const itemKeyById: Record<string, string> = {};
  for (const i of rows.items) { itemIdByKey[i.stable_key] = i.id; itemKeyById[i.id] = i.stable_key; }
  return {
    def: { version_no: num(v.version_no, 1), version_id: v.id, purpose_code: v.purpose_code ?? null, method_codes: v.method_codes ?? [], groups, sections, items },
    itemIdByKey, itemKeyById,
  };
}

export const VERSION_COLS = "id, instrument_id, version_no, state, title, purpose_code, method_codes, scoring, scoring_hash, content_hash, default_layout_version_id, assess_capability, respondent_roles, delivery_modes, published_at";

/** Fetch the rows of one version and assemble them. Any read error fails the load: a half-loaded checklist is never shown. */
export async function loadDefinition(admin: Admin, versionId: string): Promise<Res<LoadedDefinition>> {
  const ver = await admin.from("asmt_instrument_version").select(VERSION_COLS).eq("id", versionId).maybeSingle();
  if (ver.error || !ver.data) return fail(404, "That checklist version could not be read.");
  const [groups, sections, items, fields] = await Promise.all([
    admin.from("asmt_group").select("code, label, weight, position, source_ref").eq("version_id", versionId),
    admin.from("asmt_section").select("id, stable_key, parent_section_id, title, guidance, weight, position").eq("version_id", versionId),
    admin.from("asmt_item").select("id, stable_key, section_id, code, prompt, guidance, expected_performance, response_type, scale_version_id, config, group_code, method_codes, method_rule, mandatory, critical, critical_requirements, evidence_requirement, weight, references_text, position").eq("version_id", versionId),
    admin.from("asmt_item_field").select("item_id, field_key, label, response_type, scale_version_id, config, required, position").eq("version_id", versionId),
  ]);
  if (groups.error || sections.error || items.error || fields.error) return fail(503, "The checklist could not be read just now.");
  const scaleIds = [...new Set([...(items.data ?? []), ...(fields.data ?? [])].map((r: Row) => r.scale_version_id).filter(Boolean))] as string[];
  let scaleVersions: Row[] = [], levels: Row[] = [], states: Row[] = [];
  if (scaleIds.length) {
    const [sv, lv, st] = await Promise.all([
      admin.from("asmt_response_scale_version").select("id, scale_kind").in("id", scaleIds),
      admin.from("asmt_response_scale_level").select("version_id, code, label, description, ordinal, numeric_value, satisfactory, colour_token, source_level_id").in("version_id", scaleIds),
      admin.from("asmt_response_scale_state").select("version_id, state, label").in("version_id", scaleIds),
    ]);
    if (sv.error || lv.error || st.error) return fail(503, "The checklist scales could not be read just now.");
    scaleVersions = sv.data ?? []; levels = lv.data ?? []; states = st.data ?? [];
  }
  const a = assembleDefinition({ version: ver.data, groups: groups.data ?? [], sections: sections.data ?? [], items: items.data ?? [], fields: fields.data ?? [], scaleVersions, levels, states });
  const v = ver.data;
  return okRes({
    version: {
      id: v.id, instrument_id: v.instrument_id, version_no: v.version_no, state: v.state, title: v.title ?? null, purpose_code: v.purpose_code,
      method_codes: v.method_codes ?? [], scoring_hash: v.scoring_hash ?? null, content_hash: v.content_hash ?? null,
      default_layout_version_id: v.default_layout_version_id ?? null, assess_capability: v.assess_capability ?? null,
      respondent_roles: v.respondent_roles ?? [], delivery_modes: v.delivery_modes ?? [], published_at: v.published_at ?? null,
    },
    def: a.def, rules: v.scoring as RulesDoc, itemIdByKey: a.itemIdByKey, itemKeyById: a.itemKeyById,
  });
}

/** Standard and guided layouts from the layout versions pinned at the start of an instance. */
export function pickLayouts(rows: { presentation: string; layout: LayoutDoc; is_primary: boolean }[]): { standard: LayoutDoc | null; guided: LayoutDoc | null } {
  const primary = rows.find(r => r.is_primary) ?? rows[0] ?? null;
  const std = rows.find(r => r.presentation === "standard_checklist") ?? (primary && primary.presentation !== "guided_assessment" ? primary : null);
  const gd = rows.find(r => r.presentation === "guided_assessment") ?? null;
  return { standard: std?.layout ?? null, guided: gd?.layout ?? null };
}
