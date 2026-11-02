/* eslint-disable @typescript-eslint/no-explicit-any */
// Checklist Studio: server writers. Every write passes the actor (p_actor, updated_by, last_edited_by, reviewer_id), so
// the 890 to 892 guards can compute who edited, who submitted and who may approve or publish. The database refuses what
// is not allowed; friendlyDbError turns the refusal into plain words. Table names are literals (plane boundary scan).
import type { createAdminClient } from "@/lib/supabase/server";
import { hashDoc } from "../core";
import { contentProblems, diffContent } from "./diff";
import { friendlyDbError } from "./transitions";
import { loadInstrumentVersion } from "./read";
import { VERSION_TABLE, type DefinitionKind, type EditorContent, type EditorItem, type ValidationReport } from "./types";

type Admin = ReturnType<typeof createAdminClient>;
export type WriteResult<T = object> = ({ ok: true } & T) | { ok: false; status: number; error: string };

const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });
const dbFail = (e: { message?: string } | null | undefined) => fail(422, friendlyDbError(e?.message));

/** The version table of a kind, as a query builder. Literal names, so the plane boundary scan can resolve each. */
function versionTable(admin: Admin, kind: DefinitionKind) {
  switch (kind) {
    case "instrument": return admin.from("asmt_instrument_version");
    case "scale": return admin.from("asmt_response_scale_version");
    case "rule_template": return admin.from("asmt_rule_template_version");
    case "layout_template": return admin.from("asmt_layout_template_version");
    case "progression": return admin.from("asmt_progression_rule_version");
  }
}

// ---- creating --------------------------------------------------------------------------------------------------------

export interface NewInstrument {
  family: string; name: string; description?: string | null; kind?: string | null; purpose: string;
  methods?: string[]; deliveryModes?: string[]; respondentRoles?: string[];
}

/**
 * THE CREATE-INSTRUMENT PATH (aligned with the catalogue). Two steps, no Studio-specific function:
 *   1. asmt_catalogue_register(p_family, p_name, p_description, p_kind, p_actor, p_terms) assigns the catalogue code and inserts the master
 *      record (with its catalogue_registered event) in one transaction, with no version.
 *   2. a plain insert of version 1 as a draft authored by the actor (the 890 lifecycle guard numbers it and appends the created event).
 * If step 2 fails the instrument stays registered without a version, which the instrument page offers to finish ("Create first draft").
 */
export async function createInstrument(admin: Admin, actorId: string, n: NewInstrument): Promise<WriteResult<{ instrumentId: string; versionId: string; code: string }>> {
  const reg = await admin.rpc("asmt_catalogue_register", {
    p_family: n.family, p_name: n.name, p_description: n.description ?? null, p_kind: n.kind ?? "assessment", p_actor: actorId, p_terms: [],
  });
  if (reg.error) {
    if (/could not find the function|PGRST202/i.test(reg.error.message)) return fail(422, "Registering an instrument is not available on this environment yet (catalogue migration 894).");
    return dbFail(reg.error);
  }
  const instrumentId = String(reg.data);
  const { data: ins } = await admin.from("asmt_instrument").select("code").eq("id", instrumentId).maybeSingle();
  const v = await insertFirstVersion(admin, actorId, instrumentId, n.name.trim(), n);
  if (!v.ok) return fail(v.status, `${v.error} The instrument ${ins?.code ?? ""} was registered. Open it to create its first draft.`);
  return { ok: true, instrumentId, versionId: v.versionId, code: ins?.code ?? "" };
}

type FirstVersionInput = Pick<NewInstrument, "purpose" | "methods" | "deliveryModes" | "respondentRoles">;

async function insertFirstVersion(admin: Admin, actorId: string, instrumentId: string, title: string, n: FirstVersionInput): Promise<WriteResult<{ versionId: string }>> {
  const { data, error } = await admin.from("asmt_instrument_version").insert({
    instrument_id: instrumentId, authored_by: [actorId], title, purpose_code: n.purpose, method_codes: n.methods ?? [], delivery_modes: n.deliveryModes ?? [],
    respondent_roles: n.respondentRoles && n.respondentRoles.length ? n.respondentRoles : ["self"],
  }).select("id").single();
  if (error) return dbFail(error);
  return { ok: true, versionId: (data as { id: string }).id };
}

/** The first draft of an instrument that was registered (for example in the catalogue) without a version. */
export async function createFirstVersion(admin: Admin, actorId: string, instrumentId: string, n: FirstVersionInput): Promise<WriteResult<{ versionId: string }>> {
  const { data: ins } = await admin.from("asmt_instrument").select("name").eq("id", instrumentId).maybeSingle();
  if (!ins) return fail(404, "That instrument does not exist.");
  const { count } = await admin.from("asmt_instrument_version").select("id", { count: "exact", head: true }).eq("instrument_id", instrumentId);
  if ((count ?? 0) > 0) return fail(409, "The instrument already has a version. Duplicate it to make a new draft.");
  return insertFirstVersion(admin, actorId, instrumentId, ins.name, n);
}

export interface NewDefinition {
  type: "scale" | "rule_template" | "layout_template" | "progression"; code: string; name: string; description?: string | null;
  scaleKind?: "rating" | "stage"; presentation?: string; targetKind?: string | null; stageScaleVersionId?: string | null;
}

/** A definition and its first draft version. Two plain inserts: the code is chosen by the author, so there is no counter to race on. */
export async function createDefinition(admin: Admin, actorId: string, n: NewDefinition): Promise<WriteResult<{ definitionId: string; versionId: string }>> {
  const desc = n.description?.trim() ? n.description.trim() : null;
  const base = { code: n.code, name: n.name.trim(), created_by: actorId };
  let defId: string;
  let ver: { id?: string; error?: { message?: string } | null };
  const unwrap = (r: { data: unknown; error: { message?: string } | null }) => ({ id: (r.data as { id?: string } | null)?.id, error: r.error });
  switch (n.type) {
    case "scale": {
      const d = unwrap(await admin.from("asmt_response_scale").insert(base).select("id").single());
      if (d.error || !d.id) return dbFail(d.error);
      defId = d.id;
      ver = unwrap(await admin.from("asmt_response_scale_version").insert({ scale_id: defId, authored_by: [actorId], scale_kind: n.scaleKind ?? "rating", description: desc }).select("id").single());
      if (ver.error) await admin.from("asmt_response_scale").delete().eq("id", defId);
      break;
    }
    case "rule_template": {
      const d = unwrap(await admin.from("asmt_rule_template").insert(base).select("id").single());
      if (d.error || !d.id) return dbFail(d.error);
      defId = d.id;
      ver = unwrap(await admin.from("asmt_rule_template_version").insert({ template_id: defId, authored_by: [actorId], description: desc }).select("id").single());
      if (ver.error) await admin.from("asmt_rule_template").delete().eq("id", defId);
      break;
    }
    case "layout_template": {
      const d = unwrap(await admin.from("asmt_layout_template").insert(base).select("id").single());
      if (d.error || !d.id) return dbFail(d.error);
      defId = d.id;
      ver = unwrap(await admin.from("asmt_layout_template_version").insert({ template_id: defId, authored_by: [actorId], presentation: n.presentation ?? "standard_checklist", description: desc }).select("id").single());
      if (ver.error) await admin.from("asmt_layout_template").delete().eq("id", defId);
      break;
    }
    case "progression": {
      if (!n.stageScaleVersionId) return fail(400, "A progression rule set needs a stage scale version.");
      const d = unwrap(await admin.from("asmt_progression_rule_set").insert({ ...base, target_kind: n.targetKind?.trim() || "person_stage" }).select("id").single());
      if (d.error || !d.id) return dbFail(d.error);
      defId = d.id;
      ver = unwrap(await admin.from("asmt_progression_rule_version").insert({ rule_set_id: defId, authored_by: [actorId], stage_scale_version_id: n.stageScaleVersionId, description: desc }).select("id").single());
      if (ver.error) await admin.from("asmt_progression_rule_set").delete().eq("id", defId);
      break;
    }
  }
  if (ver.error || !ver.id) return dbFail(ver.error);
  return { ok: true, definitionId: defId, versionId: ver.id };
}

export async function duplicateVersion(admin: Admin, actorId: string, versionId: string): Promise<WriteResult<{ versionId: string }>> {
  const { data, error } = await admin.rpc("asmt_duplicate_version", { p_version: versionId, p_actor: actorId });
  if (error) return dbFail(error);
  return { ok: true, versionId: String(data) };
}

export async function renameInstrument(admin: Admin, instrumentId: string, patch: { name?: string; description?: string | null }): Promise<WriteResult> {
  const { error } = await admin.from("asmt_instrument").update(patch).eq("id", instrumentId);
  return error ? dbFail(error) : { ok: true };
}

// ---- content (sections, items, fields, mappings, groups) --------------------------------------------------------------

/** Pure shaping of one item into its asmt_item row. Keeps the table CHECKs true before the write. */
export function itemRow(it: EditorItem, versionId: string, sectionId: string | null, actorId: string) {
  const rating = it.response_type === "rating_scale";
  const critical = Boolean(it.critical);
  return {
    version_id: versionId, section_id: sectionId, stable_key: it.stable_key, code: it.code?.trim() ? it.code.trim() : null, prompt: it.prompt.trim(),
    guidance: it.guidance?.trim() ? it.guidance : null, expected_performance: it.expected_performance ?? [], response_type: it.response_type,
    scale_version_id: rating ? it.scale_version_id : null, config: it.config ?? {}, group_code: it.group_code || null, method_codes: it.method_codes ?? [],
    method_rule: it.method_rule === "all" ? "all" : "any", mandatory: critical ? true : Boolean(it.mandatory), critical,
    critical_requirements: critical ? it.critical_requirements ?? [] : [], evidence_requirement: it.evidence_requirement ?? {},
    weight: it.weight, references_text: it.references_text?.trim() ? it.references_text : null, position: it.position, updated_by: actorId,
  };
}

export async function saveContent(admin: Admin, actorId: string, versionId: string, next: EditorContent): Promise<WriteResult<{ changed: boolean }>> {
  const problems = contentProblems(next);
  if (problems.length) return fail(422, problems[0]);
  const loaded = await loadInstrumentVersion(admin, versionId);
  if (!loaded) return fail(404, "That version does not exist.");
  if (loaded.version.state !== "draft") return fail(409, "This version is frozen. Duplicate it to make a new draft.");
  const d = diffContent(loaded.content, next);
  if (d.unchanged) return { ok: true, changed: false };

  // groups first (items point at them)
  if (d.groupUpserts.length) {
    const { error } = await admin.from("asmt_group").upsert(
      d.groupUpserts.map((g) => ({ version_id: versionId, code: g.code, label: g.label, weight: g.weight, position: g.position, source_ref: g.source_ref ?? null, updated_by: actorId })),
      { onConflict: "version_id,code" });
    if (error) return dbFail(error);
  }
  // sections: write without a parent, then set the parents
  if (d.sectionUpserts.length) {
    const { error } = await admin.from("asmt_section").upsert(
      d.sectionUpserts.map((s) => ({ version_id: versionId, stable_key: s.stable_key, parent_section_id: null, title: s.title.trim(), guidance: s.guidance?.trim() ? s.guidance : null, weight: s.weight, position: s.position, updated_by: actorId })),
      { onConflict: "version_id,stable_key" });
    if (error) return dbFail(error);
  }
  const { data: secRows } = await admin.from("asmt_section").select("id, stable_key").eq("version_id", versionId);
  const secId = new Map(((secRows ?? []) as any[]).map((s) => [s.stable_key as string, s.id as string]));
  for (const s of d.sectionUpserts.filter((x) => x.parent_section_key && secId.has(x.parent_section_key))) {
    const { error } = await admin.from("asmt_section").update({ parent_section_id: secId.get(s.parent_section_key!), updated_by: actorId }).eq("version_id", versionId).eq("stable_key", s.stable_key);
    if (error) return dbFail(error);
  }
  // items
  if (d.itemUpserts.length) {
    const { error } = await admin.from("asmt_item").upsert(
      d.itemUpserts.map((it) => itemRow(it, versionId, it.section_key ? secId.get(it.section_key) ?? null : null, actorId)), { onConflict: "version_id,stable_key" });
    if (error) return dbFail(error);
    const { data: itemRows } = await admin.from("asmt_item").select("id, stable_key").eq("version_id", versionId).in("stable_key", d.itemUpserts.map((i) => i.stable_key));
    const itemId = new Map(((itemRows ?? []) as any[]).map((r) => [r.stable_key as string, r.id as string]));
    const ids = [...itemId.values()];
    // fields: replace the fields of every changed item
    if (ids.length) {
      const del = await admin.from("asmt_item_field").delete().eq("version_id", versionId).in("item_id", ids);
      if (del.error) return dbFail(del.error);
      const fieldRows = d.itemUpserts.flatMap((it) => (it.fields ?? []).map((f) => ({
        version_id: versionId, item_id: itemId.get(it.stable_key)!, field_key: f.field_key, label: f.label.trim(), response_type: f.response_type,
        scale_version_id: f.response_type === "rating_scale" ? f.scale_version_id ?? null : null, config: f.config ?? {}, required: Boolean(f.required), position: f.position, updated_by: actorId,
      })));
      if (fieldRows.length) { const { error: fe } = await admin.from("asmt_item_field").insert(fieldRows); if (fe) return dbFail(fe); }
      const delM = await admin.from("asmt_mapping").delete().eq("version_id", versionId).in("item_id", ids);
      if (delM.error) return dbFail(delM.error);
      const mapRows = d.itemUpserts.filter((it) => it.mapping).map((it) => ({
        version_id: versionId, item_id: itemId.get(it.stable_key)!, section_id: null, kind: it.mapping!.kind, ref_id: it.mapping!.ref_id, ref_code: it.mapping!.ref_code,
        ref_version: it.mapping!.ref_version, ref_hash: it.mapping!.ref_hash, ref_snapshot: it.mapping!.ref_snapshot ?? {}, relation: it.mapping!.relation, updated_by: actorId,
      }));
      if (mapRows.length) { const { error: me } = await admin.from("asmt_mapping").insert(mapRows); if (me) return dbFail(me); }
    }
  }
  // deletes last: items, then sections (children before parents), then groups
  if (d.itemDeletes.length) {
    const { error } = await admin.from("asmt_item").delete().eq("version_id", versionId).in("stable_key", d.itemDeletes);
    if (error) return dbFail(error);
  }
  if (d.sectionDeletes.length) {
    const depth = (key: string, seen = new Set<string>()): number => {
      const s = loaded.content.sections.find((x) => x.stable_key === key);
      if (!s?.parent_section_key || seen.has(key)) return 0;
      seen.add(key);
      return 1 + depth(s.parent_section_key, seen);
    };
    for (const key of [...d.sectionDeletes].sort((a, b) => depth(b) - depth(a))) {
      const { error } = await admin.from("asmt_section").delete().eq("version_id", versionId).eq("stable_key", key);
      if (error) return dbFail(error);
    }
  }
  if (d.groupDeletes.length) {
    const { error } = await admin.from("asmt_group").delete().eq("version_id", versionId).in("code", d.groupDeletes);
    if (error) return dbFail(error);
  }
  return { ok: true, changed: true };
}

// ---- version settings, scoring, layouts, tags ---------------------------------------------------------------------------

export interface SettingsPatch {
  title?: string | null; summary?: string | null; purpose_code?: string; method_codes?: string[]; requires_domain_review?: boolean;
  assess_capability?: string | null; assign_capability?: string | null; respondent_roles?: string[]; delivery_modes?: string[];
  evidence_policy?: Record<string, unknown>; effective_from?: string | null; review_due?: string | null;
}
const SETTINGS_KEYS: (keyof SettingsPatch)[] = ["title", "summary", "purpose_code", "method_codes", "requires_domain_review", "assess_capability", "assign_capability", "respondent_roles", "delivery_modes", "evidence_policy", "effective_from", "review_due"];

export async function saveSettings(admin: Admin, actorId: string, versionId: string, patch: SettingsPatch): Promise<WriteResult> {
  const clean: Record<string, unknown> = {};
  for (const k of SETTINGS_KEYS) if (k in patch) clean[k] = (patch as any)[k];
  if (!Object.keys(clean).length) return { ok: true };
  const { data, error } = await admin.from("asmt_instrument_version").update({ ...clean, last_edited_by: actorId }).eq("id", versionId).eq("state", "draft").select("id");
  if (error) return dbFail(error);
  return (data ?? []).length ? { ok: true } : fail(409, "This version is no longer a draft.");
}

export async function saveTags(admin: Admin, actorId: string, versionId: string, termIds: string[]): Promise<WriteResult> {
  const del = await admin.from("asmt_version_tag").delete().eq("version_id", versionId);
  if (del.error) return dbFail(del.error);
  if (termIds.length) {
    const { error } = await admin.from("asmt_version_tag").insert([...new Set(termIds)].map((t) => ({ version_id: versionId, term_id: t, updated_by: actorId })));
    if (error) return dbFail(error);
  }
  return { ok: true };
}

/** Stores the scoring document and its hash (the hash a submitted instance must carry), the saved tests and the source template. */
export async function saveScoring(admin: Admin, actorId: string, versionId: string, doc: Record<string, unknown>, tests: unknown[], templateVersionId: string | null): Promise<WriteResult<{ scoringHash: string }>> {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return fail(422, "The scoring rules must be an object.");
  const scoringHash = hashDoc(doc);
  const { data, error } = await admin.from("asmt_instrument_version")
    .update({ scoring: doc, scoring_hash: scoringHash, scoring_tests: tests ?? [], scoring_template_version_id: templateVersionId, last_edited_by: actorId })
    .eq("id", versionId).eq("state", "draft").select("id");
  if (error) return dbFail(error);
  return (data ?? []).length ? { ok: true, scoringHash } : fail(409, "This version is no longer a draft.");
}

/** Default layout and the allowed layouts. Every one must be a PUBLISHED layout template version. */
export async function saveLayouts(admin: Admin, actorId: string, versionId: string, defaultLayoutVersionId: string | null, allowed: string[]): Promise<WriteResult> {
  const all = [...new Set([...(defaultLayoutVersionId ? [defaultLayoutVersionId] : []), ...allowed])];
  if (all.length) {
    const { data } = await admin.from("asmt_layout_template_version").select("id, state").in("id", all);
    const bad = all.filter((id) => ((data ?? []) as any[]).find((l) => l.id === id)?.state !== "published");
    if (bad.length) return fail(422, "A layout must be a published layout template version.");
  }
  const up = await admin.from("asmt_instrument_version").update({ default_layout_version_id: defaultLayoutVersionId, last_edited_by: actorId }).eq("id", versionId).eq("state", "draft").select("id");
  if (up.error) return dbFail(up.error);
  if (!(up.data ?? []).length) return fail(409, "This version is no longer a draft.");
  const del = await admin.from("asmt_version_layout").delete().eq("version_id", versionId);
  if (del.error) return dbFail(del.error);
  if (allowed.length) {
    const { error } = await admin.from("asmt_version_layout").insert([...new Set(allowed)].map((l) => ({ version_id: versionId, layout_version_id: l, updated_by: actorId })));
    if (error) return dbFail(error);
  }
  return { ok: true };
}

// ---- scales and templates ---------------------------------------------------------------------------------------------

export interface ScaleSave {
  description?: string | null;
  levels: { code: string; label: string; description?: string | null; ordinal: number; numeric_value?: number | null; satisfactory?: boolean | null; colour_token?: string | null; source_level_id?: string | null }[];
  states: { state: string; label: string }[];
}

export async function saveScale(admin: Admin, actorId: string, versionId: string, s: ScaleSave): Promise<WriteResult> {
  const codes = s.levels.map((l) => l.code.trim());
  const ords = s.levels.map((l) => l.ordinal);
  if (codes.some((c) => !c) || new Set(codes).size !== codes.length) return fail(422, "Every level needs a code and the codes must differ.");
  if (new Set(ords).size !== ords.length) return fail(422, "Every level needs its own ordinal.");
  const head = await admin.from("asmt_response_scale_version").update({ description: s.description ?? null, last_edited_by: actorId }).eq("id", versionId).eq("state", "draft").select("id");
  if (head.error) return dbFail(head.error);
  if (!(head.data ?? []).length) return fail(409, "This version is no longer a draft.");
  const dl = await admin.from("asmt_response_scale_level").delete().eq("version_id", versionId);
  if (dl.error) return dbFail(dl.error);
  const ds = await admin.from("asmt_response_scale_state").delete().eq("version_id", versionId);
  if (ds.error) return dbFail(ds.error);
  if (s.levels.length) {
    const { error } = await admin.from("asmt_response_scale_level").insert(s.levels.map((l) => ({
      version_id: versionId, code: l.code.trim(), label: l.label.trim(), description: l.description ?? null, ordinal: l.ordinal, numeric_value: l.numeric_value ?? null,
      satisfactory: l.satisfactory ?? null, colour_token: l.colour_token ?? null, source_level_id: l.source_level_id ?? null, updated_by: actorId,
    })));
    if (error) return dbFail(error);
  }
  if (s.states.length) {
    const { error } = await admin.from("asmt_response_scale_state").insert(s.states.map((x) => ({ version_id: versionId, state: x.state, label: x.label.trim(), updated_by: actorId })));
    if (error) return dbFail(error);
  }
  return { ok: true };
}

export async function saveRuleTemplate(admin: Admin, actorId: string, versionId: string, rules: Record<string, unknown>, tests: unknown[], description?: string | null): Promise<WriteResult<{ rulesHash: string }>> {
  const rulesHash = hashDoc(rules);
  const { data, error } = await admin.from("asmt_rule_template_version").update({ rules, rules_hash: rulesHash, tests, description: description ?? null, last_edited_by: actorId }).eq("id", versionId).eq("state", "draft").select("id");
  if (error) return dbFail(error);
  return (data ?? []).length ? { ok: true, rulesHash } : fail(409, "This version is no longer a draft.");
}

export async function saveLayoutTemplate(admin: Admin, actorId: string, versionId: string, layout: Record<string, unknown>, presentation: string, description?: string | null): Promise<WriteResult> {
  const { data, error } = await admin.from("asmt_layout_template_version").update({ layout, presentation, description: description ?? null, last_edited_by: actorId }).eq("id", versionId).eq("state", "draft").select("id");
  if (error) return dbFail(error);
  return (data ?? []).length ? { ok: true } : fail(409, "This version is no longer a draft.");
}

export async function saveProgression(admin: Admin, actorId: string, versionId: string, rules: Record<string, unknown>, tests: unknown[], stageScaleVersionId: string, description?: string | null): Promise<WriteResult<{ rulesHash: string }>> {
  const rulesHash = hashDoc(rules);
  const { data, error } = await admin.from("asmt_progression_rule_version").update({ rules, rules_hash: rulesHash, tests, stage_scale_version_id: stageScaleVersionId, description: description ?? null, last_edited_by: actorId }).eq("id", versionId).eq("state", "draft").select("id");
  if (error) return dbFail(error);
  return (data ?? []).length ? { ok: true, rulesHash } : fail(409, "This version is no longer a draft.");
}

// ---- lifecycle ---------------------------------------------------------------------------------------------------------

async function transition(admin: Admin, kind: DefinitionKind, versionId: string, from: string[], patch: Record<string, unknown>): Promise<WriteResult> {
  const { data, error } = await versionTable(admin, kind).update(patch).eq("id", versionId).in("state", from).select("id");
  if (error) return dbFail(error);
  return (data ?? []).length ? { ok: true } : fail(409, `That version is not ${from.length === 1 ? from[0].replace("_", " ") : "in a state that allows this"} any more. Reload the page.`);
}

export const submitVersion = (admin: Admin, kind: DefinitionKind, versionId: string, actorId: string) => transition(admin, kind, versionId, ["draft"], { state: "in_review", submitted_by: actorId });
export const returnToDraft = (admin: Admin, kind: DefinitionKind, versionId: string, actorId: string) => transition(admin, kind, versionId, ["in_review", "approved"], { state: "draft", last_edited_by: actorId });
export const approveVersion = (admin: Admin, kind: DefinitionKind, versionId: string) => transition(admin, kind, versionId, ["in_review"], { state: "approved" });
export const publishVersion = (admin: Admin, kind: DefinitionKind, versionId: string, actorId: string) => transition(admin, kind, versionId, ["approved"], { state: "published", published_by: actorId });
export const retireVersion = (admin: Admin, kind: DefinitionKind, versionId: string, actorId: string) => transition(admin, kind, versionId, ["published"], { state: "retired", retired_by: actorId });

export async function deleteDraft(admin: Admin, kind: DefinitionKind, versionId: string): Promise<WriteResult> {
  const { error } = await versionTable(admin, kind).delete().eq("id", versionId).eq("state", "draft");
  return error ? dbFail(error) : { ok: true };
}

export async function recordDecision(
  admin: Admin, kind: DefinitionKind, versionId: string, actorId: string,
  d: { reviewKind: "governance" | "domain"; decision: "approved" | "rejected" | "changes_requested"; rationale?: string | null },
): Promise<WriteResult<{ decisionId: string }>> {
  if (d.decision !== "approved" && (d.rationale ?? "").trim().length < 3) return fail(422, "Give a reason (at least a few words) when you reject or ask for changes.");
  const { data: v } = await versionTable(admin, kind).select("content_hash, state").eq("id", versionId).maybeSingle();
  if (!v) return fail(404, "That version does not exist.");
  if (v.state !== "in_review" || !v.content_hash) return fail(409, "A decision is recorded only while the version is in review.");
  const { data, error } = await admin.from("asmt_review_decision").insert({
    version_table: VERSION_TABLE[kind], version_id: versionId, review_kind: d.reviewKind, reviewer_id: actorId, decision: d.decision,
    content_hash: v.content_hash, rationale: d.rationale?.trim() ? d.rationale.trim() : null,
  }).select("id").single();
  if (error) return dbFail(error);
  return { ok: true, decisionId: (data as any).id };
}

/** The validation result is part of the history: a 'validated' event with the counts and the first problems. */
export async function recordValidated(admin: Admin, kind: DefinitionKind, versionId: string, actorId: string, report: ValidationReport): Promise<void> {
  await admin.from("asmt_definition_event").insert({
    subject_table: VERSION_TABLE[kind], subject_id: versionId, event: "validated", actor_id: actorId,
    detail: {
      ok: report.ok, errors: report.errors.length, warnings: report.warnings.length, tests: report.tests,
      first: report.errors.slice(0, 10).map((e) => ({ code: e.code, path: e.path })),
    },
  });
}
