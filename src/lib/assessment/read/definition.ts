/* eslint-disable @typescript-eslint/no-explicit-any */
import type { InstrumentDef, InstrumentGroup, InstrumentItem, InstrumentSection, ItemField, LayoutDoc, ResponseScale, RulesDoc, ScaleLevel, ScaleStateDef } from "../core";

// ── THE SHARED DEFINITION READER ── Checklist Studio S3 ──────────────────────────────────────────────────────────────
//
// One published (or retired) instrument version, read from the DEFINITION tables only (asmt_instrument_version, _group,
// _section, _item, _item_field, the response scale versions and the layout template versions) and put back together as the
// engine's InstrumentDef. A definition holds no person's data, so there is nothing here to key on a person: every table
// that DOES hold a person's answers (instance, response, evidence, comment, outcome, grant) is read only by an adapter,
// always keyed on the subject. Nothing here writes.
//
// ⚠ UNREADABLE IS NOT ABSENT. A failed read returns `{ ok: false }`; a version that does not exist is `{ ok: true, value: null }`.
// ⚠ NOTHING IS TRUSTED FROM THE CLIENT. The caller passes a version id it got from a row it read by the subject.

type Admin = any;

export type VersionMeta = {
  versionId: string; instrumentId: string; instrumentCode: string; instrumentName: string; versionNo: number;
  state: string; title: string | null; summary: string | null;
  purposeCode: string; methodCodes: string[]; deliveryModes: string[]; respondentRoles: string[];
  scoringHash: string | null; defaultLayoutVersionId: string | null;
};

export type LoadedDefinition = {
  meta: VersionMeta;
  def: InstrumentDef;
  rules: RulesDoc;
  /** The version's own default layout (a published layout template version), when there is one. */
  layout: LayoutDoc | null;
  methodLabels: Record<string, string>;
  /** item stable_key -> item id (the asmt_item row), for writing a response. */
  itemIds: Record<string, string>;
};

export type Read<T> = { ok: true; value: T } | { ok: false };

const VERSION_COLS = "id, instrument_id, version_no, state, title, summary, purpose_code, method_codes, delivery_modes, respondent_roles, scoring, scoring_hash, default_layout_version_id";

const ok = <T,>(value: T): Read<T> => ({ ok: true, value });
const bad = { ok: false } as const;
const num = (v: unknown, d = 0): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

function toScale(version: any, levels: any[], states: any[]): ResponseScale {
  return {
    code: undefined, version_id: version.id, scale_kind: version.scale_kind === "stage" ? "stage" : "rating",
    levels: levels.filter(l => l.version_id === version.id).sort((a, b) => a.ordinal - b.ordinal).map((l): ScaleLevel => ({
      code: l.code, label: l.label, description: l.description ?? null, ordinal: l.ordinal,
      numeric_value: l.numeric_value === null || l.numeric_value === undefined ? null : num(l.numeric_value), satisfactory: l.satisfactory ?? null,
      colour_token: l.colour_token ?? null, source_level_id: l.source_level_id ?? null,
    })),
    states: states.filter(s => s.version_id === version.id).map((s): ScaleStateDef => ({ state: s.state, label: s.label })),
  };
}

/** Pure: the engine's definition from the rows of one version. Exported so a test can build one without a database. */
export function assembleDefinition(rows: {
  version: any; instrument: { code: string; name: string };
  groups: any[]; sections: any[]; items: any[]; fields: any[]; scaleVersions: any[]; scaleLevels: any[]; scaleStates: any[];
}): { def: InstrumentDef; itemIds: Record<string, string> } {
  const scales = new Map<string, ResponseScale>(rows.scaleVersions.map(v => [v.id, toScale(v, rows.scaleLevels, rows.scaleStates)]));
  const sectionKey = new Map<string, string>(rows.sections.map(s => [s.id, s.stable_key]));
  const itemKey = new Map<string, string>(rows.items.map(i => [i.id, i.stable_key]));
  const fieldsOf = new Map<string, ItemField[]>();
  for (const f of rows.fields) {
    const key = itemKey.get(f.item_id);
    if (!key) continue;
    const list = fieldsOf.get(key) ?? [];
    list.push({
      field_key: f.field_key, label: f.label, response_type: f.response_type, scale_version_id: f.scale_version_id ?? null,
      scale: f.scale_version_id ? scales.get(f.scale_version_id) ?? null : null, config: f.config ?? {}, required: !!f.required, position: f.position ?? 0,
    });
    fieldsOf.set(key, list);
  }
  const groups: InstrumentGroup[] = rows.groups.map(g => ({ code: g.code, label: g.label, weight: num(g.weight, 1), position: g.position ?? 0, source_ref: g.source_ref ?? null }));
  const sections: InstrumentSection[] = rows.sections.map(s => ({
    stable_key: s.stable_key, parent_section_key: s.parent_section_id ? sectionKey.get(s.parent_section_id) ?? null : null,
    title: s.title, guidance: s.guidance ?? null, weight: num(s.weight, 1), position: s.position ?? 0,
  }));
  const items: InstrumentItem[] = rows.items.map(i => ({
    stable_key: i.stable_key, section_key: i.section_id ? sectionKey.get(i.section_id) ?? "" : "", code: i.code ?? "", prompt: i.prompt, guidance: i.guidance ?? null,
    expected_performance: Array.isArray(i.expected_performance) ? i.expected_performance : [],
    response_type: i.response_type, scale_version_id: i.scale_version_id ?? null, scale: i.scale_version_id ? scales.get(i.scale_version_id) ?? null : null,
    config: i.config ?? {}, fields: (fieldsOf.get(i.stable_key) ?? []).sort((a, b) => a.position - b.position),
    group_code: i.group_code ?? null, method_codes: i.method_codes ?? [], method_rule: i.method_rule === "all" ? "all" : "any",
    mandatory: !!i.mandatory, critical: !!i.critical, critical_requirements: i.critical_requirements ?? [],
    evidence_requirement: i.evidence_requirement && Object.keys(i.evidence_requirement).length ? i.evidence_requirement : null,
    weight: num(i.weight, 1), references_text: i.references_text ?? null, position: i.position ?? 0,
  }));
  const itemIds: Record<string, string> = {};
  for (const i of rows.items) itemIds[i.stable_key] = i.id;
  return {
    def: {
      instrument_code: rows.instrument.code, version_no: rows.version.version_no, version_id: rows.version.id,
      purpose_code: rows.version.purpose_code, method_codes: rows.version.method_codes ?? [],
      groups: groups.sort((a, b) => a.position - b.position), sections: sections.sort((a, b) => a.position - b.position), items: items.sort((a, b) => a.position - b.position),
    },
    itemIds,
  };
}

// A published or retired version is FROZEN by the database (the lifecycle guard refuses every edit), so a read of one can be kept for a few
// minutes: autosave asks for the same definition on every answer. A draft or an unfinished version is never kept.
const KEEP_MS = 10 * 60 * 1000, KEEP_MAX = 40;
const kept = new Map<string, { at: number; value: LoadedDefinition }>();
/** Tests only. */
export const forgetDefinitions = () => kept.clear();

/** The published or retired version, whole. `retired` is readable because an instance keeps the version it started on. */
export async function loadDefinition(admin: Admin, versionId: string): Promise<Read<LoadedDefinition | null>> {
  const hit = kept.get(versionId);
  if (hit && Date.now() - hit.at < KEEP_MS) return ok(hit.value);
  const r = await readDefinition(admin, versionId);
  if (r.ok && r.value && (r.value.meta.state === "published" || r.value.meta.state === "retired")) {
    if (kept.size >= KEEP_MAX) kept.delete(kept.keys().next().value as string);
    kept.set(versionId, { at: Date.now(), value: r.value });
  }
  return r;
}

async function readDefinition(admin: Admin, versionId: string): Promise<Read<LoadedDefinition | null>> {
  try {
    const v = await admin.from("asmt_instrument_version").select(VERSION_COLS).eq("id", versionId).maybeSingle();
    if (v.error) return bad;
    if (!v.data) return ok(null);
    const version = v.data;
    const [ins, groups, sections, items, fields, methods] = await Promise.all([
      admin.from("asmt_instrument").select("code, name").eq("id", version.instrument_id).maybeSingle(),
      admin.from("asmt_group").select("code, label, weight, position, source_ref").eq("version_id", versionId),
      admin.from("asmt_section").select("id, stable_key, parent_section_id, title, guidance, weight, position").eq("version_id", versionId),
      admin.from("asmt_item").select("id, stable_key, section_id, code, prompt, guidance, expected_performance, response_type, scale_version_id, config, group_code, method_codes, method_rule, mandatory, critical, critical_requirements, evidence_requirement, weight, references_text, position").eq("version_id", versionId),
      admin.from("asmt_item_field").select("item_id, field_key, label, response_type, scale_version_id, config, required, position").eq("version_id", versionId),
      admin.from("asmt_method").select("code, label"),
    ]);
    if (ins.error || !ins.data || groups.error || sections.error || items.error || fields.error) return bad;
    const scaleIds = [...new Set([...(items.data ?? []), ...(fields.data ?? [])].map((r: any) => r.scale_version_id).filter(Boolean))] as string[];
    const [sv, sl, ss] = scaleIds.length
      ? await Promise.all([
        admin.from("asmt_response_scale_version").select("id, scale_kind").in("id", scaleIds),
        admin.from("asmt_response_scale_level").select("version_id, code, label, description, ordinal, numeric_value, satisfactory, colour_token, source_level_id").in("version_id", scaleIds),
        admin.from("asmt_response_scale_state").select("version_id, state, label").in("version_id", scaleIds),
      ])
      : [{ data: [] }, { data: [] }, { data: [] }];
    if ((sv as any).error || (sl as any).error || (ss as any).error) return bad;
    const { def, itemIds } = assembleDefinition({
      version, instrument: ins.data, groups: groups.data ?? [], sections: sections.data ?? [], items: items.data ?? [], fields: fields.data ?? [],
      scaleVersions: sv.data ?? [], scaleLevels: sl.data ?? [], scaleStates: ss.data ?? [],
    });
    let layout: LayoutDoc | null = null;
    if (version.default_layout_version_id) {
      const l = await admin.from("asmt_layout_template_version").select("layout, state").eq("id", version.default_layout_version_id).maybeSingle();
      if (!l.error && l.data && (l.data.state === "published" || l.data.state === "retired") && l.data.layout && typeof l.data.layout === "object") layout = l.data.layout as LayoutDoc;
    }
    const methodLabels: Record<string, string> = {};
    for (const m of (methods.data ?? []) as any[]) methodLabels[m.code] = m.label;
    return ok({
      meta: {
        versionId: version.id, instrumentId: version.instrument_id, instrumentCode: ins.data.code, instrumentName: ins.data.name, versionNo: version.version_no,
        state: version.state, title: version.title ?? null, summary: version.summary ?? null, purposeCode: version.purpose_code,
        methodCodes: version.method_codes ?? [], deliveryModes: version.delivery_modes ?? [], respondentRoles: version.respondent_roles ?? [],
        scoringHash: version.scoring_hash ?? null, defaultLayoutVersionId: version.default_layout_version_id ?? null,
      },
      def, rules: version.scoring as RulesDoc, layout, methodLabels, itemIds,
    });
  } catch { return bad; }
}

/** A layout template version's document (published or retired only), or null. */
export async function loadLayoutDoc(admin: Admin, layoutVersionId: string): Promise<LayoutDoc | null> {
  try {
    const l = await admin.from("asmt_layout_template_version").select("layout, state").eq("id", layoutVersionId).maybeSingle();
    if (l.error || !l.data || !(l.data.state === "published" || l.data.state === "retired") || !l.data.layout || typeof l.data.layout !== "object") return null;
    return l.data.layout as LayoutDoc;
  } catch { return null; }
}
