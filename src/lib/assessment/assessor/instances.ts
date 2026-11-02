// Assessor workspace: starting, loading and working an assessor-led instance.
//
// ⚠ THE RESPONDENT FILTER. Every read of asmt_instance here carries .eq("respondent_id", actor), and every read of an
// answer, evidence row, comment, outcome or pinned layout takes an OwnedInstance, which only own() can produce. The
// database repeats the rule (the guards and the submit entry point check the respondent), this is the second wall.
//
// ⚠ ONLY ASSESSOR-LED WORK. own() also requires respondent_role = 'assessor', so a person who is both an assessor and
// a subject can never open their own self-led instance through this workspace.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LayoutDoc, ResponseValue, Responses } from "@/lib/assessment/core";
import { rkey, PRIMARY } from "@/lib/assessment/core";
import {
  type Admin, type GrantRow, type InstanceRow, type OwnedInstance, type Res, ASSESS_CAPABILITY, GRANT_COLS, INSTANCE_COLS,
  fail, grantState, guardMessage, isUuid, okRes,
} from "./common";
import { loadDefinition, pickLayouts, type LoadedDefinition } from "./definition";

/** The instance, if and only if the actor is its assessor. */
export async function own(admin: Admin, actor: string, instanceId: string): Promise<Res<OwnedInstance>> {
  if (!isUuid(instanceId) || !isUuid(actor)) return fail(404, "That assessment could not be found.");
  const { data, error } = await admin.from("asmt_instance").select(INSTANCE_COLS)
    .eq("id", instanceId).eq("respondent_id", actor).eq("respondent_role", "assessor").maybeSingle();
  if (error) return fail(503, "The assessment could not be read just now.");
  if (!data) return fail(404, "That assessment could not be found.");
  return okRes(data as OwnedInstance);
}

export interface InstanceSummary {
  id: string; status: InstanceRow["status"]; started_at: string; submitted_at: string | null; grant_id: string | null;
  subject_user_id: string | null; instrument_version_id: string;
}

export async function listMyInstances(admin: Admin, actor: string): Promise<Res<InstanceSummary[]>> {
  const { data, error } = await admin.from("asmt_instance")
    .select("id, status, started_at, submitted_at, grant_id, subject_user_id, instrument_version_id")
    .eq("respondent_id", actor).eq("respondent_role", "assessor").order("started_at", { ascending: false }).limit(200);
  if (error) return fail(503, "Your assessments could not be read just now.");
  return okRes((data ?? []) as InstanceSummary[]);
}

/** Start an assessor instance from a grant of mine, or resume the one already in progress for it. */
export async function startInstance(admin: Admin, actor: string, grantId: string): Promise<Res<{ instanceId: string; resumed: boolean }>> {
  if (!isUuid(grantId)) return fail(400, "Choose an assessment.");
  const g = await admin.from("asmt_respondent_grant").select(GRANT_COLS).eq("id", grantId).eq("respondent_id", actor).maybeSingle();
  if (g.error) return fail(503, "The assessment could not be read just now.");
  const grant = g.data as GrantRow | null;
  if (!grant) return fail(404, "That assessment could not be found.");
  if (grant.respondent_role !== "assessor") return fail(409, "That authority is not an assessor authority.");
  if (grantState(grant) !== "live") return fail(409, "That authority is not ready: it must be accepted by the person, not ended and inside its dates.");

  const open = await admin.from("asmt_instance").select("id").eq("grant_id", grantId).eq("respondent_id", actor).eq("status", "in_progress").limit(1);
  if (open.error) return fail(503, "The assessment could not be read just now.");
  if (open.data && open.data.length) return okRes({ instanceId: open.data[0].id as string, resumed: true });

  const ver = await admin.from("asmt_instrument_version").select("id, default_layout_version_id, respondent_roles")
    .eq("instrument_id", grant.instrument_id).eq("state", "published").order("version_no", { ascending: false }).limit(1).maybeSingle();
  if (ver.error) return fail(503, "The checklist could not be read just now.");
  if (!ver.data) return fail(409, "This checklist has no published version.");
  if (!(ver.data.respondent_roles ?? []).includes("assessor")) return fail(409, "This checklist is not open to an assessor.");
  const ins = await admin.from("asmt_instrument").select("owner_scope, owner_product_line, owner_organisation_id, owner_user_id, owner_instrument_id").eq("id", grant.instrument_id).maybeSingle();
  if (ins.error || !ins.data) return fail(503, "The checklist could not be read just now.");

  const created = await admin.from("asmt_instance").insert({
    instrument_version_id: ver.data.id, subject_kind: grant.subject_kind, subject_id: grant.subject_id, subject_user_id: grant.subject_user_id,
    respondent_role: "assessor", respondent_id: actor, grant_id: grant.id, attestation: "assessor_evaluated",
    owner_scope: ins.data.owner_scope, owner_product_line: ins.data.owner_product_line, owner_organisation_id: ins.data.owner_organisation_id,
    owner_user_id: ins.data.owner_user_id, owner_instrument_id: ins.data.owner_instrument_id,
  }).select("id").single();
  if (created.error || !created.data) return fail(422, guardMessage(created.error));
  const instanceId = created.data.id as string;

  // Pin layouts: the default is primary, the other allowed ones ride along (the guided view uses one of them).
  const allowed = await admin.from("asmt_version_layout").select("layout_version_id").eq("version_id", ver.data.id);
  const ids = new Set<string>([...(ver.data.default_layout_version_id ? [ver.data.default_layout_version_id as string] : []), ...((allowed.data ?? []).map((r: any) => r.layout_version_id as string))]);
  const primary = (ver.data.default_layout_version_id as string | null) ?? [...ids][0] ?? null;
  for (const lid of ids) {
    const pin = await admin.from("asmt_instance_layout").insert({ instance_id: instanceId, layout_version_id: lid, is_primary: lid === primary });
    // A layout that cannot be pinned (retired since) is skipped: the runner falls back to its built-in layouts.
    if (pin.error) continue;
  }
  return okRes({ instanceId, resumed: false });
}

// ── loading ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface EvidenceView { id: string; item_key: string | null; kind: string; note: string | null; ref_kind: string | null; ref_id: string | null; created_at: string }
export interface CommentView { id: string; item_key: string | null; kind: string; body: string; author_id: string | null; created_at: string }
export interface OutcomeView {
  id: string; engine_version: string; rules_hash: string | null; outcome_code: string; outcome_class: string; group_outcomes: Record<string, unknown>;
  aggregates: Record<string, unknown>; trace: any; trace_hash: string | null; backstop_applied: boolean; backstop_detail: any; created_at: string;
}

export interface LoadedInstance {
  instance: OwnedInstance;
  definition: LoadedDefinition;
  standardLayout: LayoutDoc | null;
  guidedLayout: LayoutDoc | null;
  responses: Responses;
  /** revision of each stored response, by response key (item stable_key, or key#field). Absent = no row yet. */
  revisions: Record<string, number>;
  evidence: EvidenceView[];
  evidenceCounts: Record<string, number>;
  comments: CommentView[];
  outcome: OutcomeView | null;
}

/** Answer rows -> the engine's Responses map and the revisions. */
export function responsesFromRows(rows: { item_id: string; field_key: string; value: ResponseValue; revision: number }[], keyById: Record<string, string>): { responses: Responses; revisions: Record<string, number> } {
  const responses: Responses = {};
  const revisions: Record<string, number> = {};
  for (const r of rows) {
    const k = keyById[r.item_id];
    if (!k) continue;
    const rk = rkey(k, r.field_key);
    responses[rk] = r.value;
    revisions[rk] = r.revision;
  }
  return { responses, revisions };
}

export async function readResponses(admin: Admin, inst: OwnedInstance, keyById: Record<string, string>): Promise<Res<{ responses: Responses; revisions: Record<string, number> }>> {
  const { data, error } = await admin.from("asmt_response").select("item_id, field_key, value, revision").eq("instance_id", inst.id);
  if (error) return fail(503, "The answers could not be read just now.");
  return okRes(responsesFromRows((data ?? []) as any[], keyById));
}

export async function readEvidence(admin: Admin, inst: OwnedInstance, keyById: Record<string, string>): Promise<Res<{ evidence: EvidenceView[]; counts: Record<string, number> }>> {
  const { data, error } = await admin.from("asmt_evidence").select("id, item_id, kind, ref_kind, ref_id, note, created_at").eq("instance_id", inst.id).order("created_at");
  if (error) return fail(503, "The evidence could not be read just now.");
  const evidence: EvidenceView[] = (data ?? []).map((r: any) => ({ id: r.id, item_key: r.item_id ? keyById[r.item_id] ?? null : null, kind: r.kind, note: r.note ?? null, ref_kind: r.ref_kind ?? null, ref_id: r.ref_id ?? null, created_at: r.created_at }));
  const counts: Record<string, number> = {};
  for (const e of evidence) if (e.item_key) counts[e.item_key] = (counts[e.item_key] ?? 0) + 1;
  return okRes({ evidence, counts });
}

export async function readComments(admin: Admin, inst: OwnedInstance, keyById: Record<string, string>): Promise<Res<CommentView[]>> {
  const { data, error } = await admin.from("asmt_comment").select("id, item_id, kind, body, author_id, created_at").eq("instance_id", inst.id).order("created_at");
  if (error) return fail(503, "The comments could not be read just now.");
  return okRes((data ?? []).map((r: any) => ({ id: r.id, item_key: r.item_id ? keyById[r.item_id] ?? null : null, kind: r.kind, body: r.body, author_id: r.author_id ?? null, created_at: r.created_at })));
}

export async function readOutcome(admin: Admin, inst: OwnedInstance): Promise<Res<OutcomeView | null>> {
  const { data, error } = await admin.from("asmt_outcome")
    .select("id, engine_version, rules_hash, outcome_code, outcome_class, group_outcomes, aggregates, trace, trace_hash, backstop_applied, backstop_detail, created_at")
    .eq("instance_id", inst.id).maybeSingle();
  if (error) return fail(503, "The outcome could not be read just now.");
  return okRes((data as OutcomeView | null) ?? null);
}

export async function readLayouts(admin: Admin, inst: OwnedInstance): Promise<Res<{ standard: LayoutDoc | null; guided: LayoutDoc | null }>> {
  const pins = await admin.from("asmt_instance_layout").select("layout_version_id, is_primary").eq("instance_id", inst.id);
  if (pins.error) return fail(503, "The layout could not be read just now.");
  const ids = (pins.data ?? []).map((p: any) => p.layout_version_id as string);
  if (!ids.length) return okRes({ standard: null, guided: null });
  const lv = await admin.from("asmt_layout_template_version").select("id, presentation, layout").in("id", ids);
  if (lv.error) return fail(503, "The layout could not be read just now.");
  const primaryOf = new Map<string, boolean>((pins.data ?? []).map((p: any) => [p.layout_version_id as string, !!p.is_primary]));
  return okRes(pickLayouts((lv.data ?? []).map((l: any) => ({ presentation: l.presentation, layout: l.layout as LayoutDoc, is_primary: primaryOf.get(l.id) ?? false }))));
}

export async function loadInstance(admin: Admin, actor: string, instanceId: string): Promise<Res<LoadedInstance>> {
  const o = await own(admin, actor, instanceId);
  if (!o.ok) return o;
  const instance = o.value;
  const d = await loadDefinition(admin, instance.instrument_version_id);
  if (!d.ok) return d;
  const [a, ev, cm, oc, ly] = await Promise.all([
    readResponses(admin, instance, d.value.itemKeyById), readEvidence(admin, instance, d.value.itemKeyById),
    readComments(admin, instance, d.value.itemKeyById), readOutcome(admin, instance), readLayouts(admin, instance),
  ]);
  if (!a.ok) return a;
  if (!ev.ok) return ev;
  if (!cm.ok) return cm;
  if (!oc.ok) return oc;
  if (!ly.ok) return ly;
  return okRes({
    instance, definition: d.value, standardLayout: ly.value.standard, guidedLayout: ly.value.guided,
    responses: a.value.responses, revisions: a.value.revisions, evidence: ev.value.evidence, evidenceCounts: ev.value.counts,
    comments: cm.value, outcome: oc.value,
  });
}

// ── writing answers ──────────────────────────────────────────────────────────────────────────────────────────
/** Keep only what the database accepts: exactly one of level_code, state, value, and a text reason. Null when nothing is left. */
export function cleanAnswer(v: unknown): ResponseValue | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const src = v as Record<string, unknown>;
  const out: ResponseValue = {};
  if (typeof src.level_code === "string" && src.level_code) out.level_code = src.level_code;
  else if (typeof src.state === "string" && src.state) out.state = src.state as ResponseValue["state"];
  else if (src.value !== undefined && src.value !== null) out.value = src.value;
  else return null;
  if (typeof src.reason === "string" && src.reason.trim()) out.reason = src.reason.trim();
  return out;
}

/** Split a response key into the item key and the field key. */
export function splitKey(key: string): { itemKey: string; fieldKey: string } {
  const at = key.indexOf("#");
  return at < 0 ? { itemKey: key, fieldKey: PRIMARY } : { itemKey: key.slice(0, at), fieldKey: key.slice(at + 1) };
}

export type PatchResult =
  | { ok: true; revision: number; value: ResponseValue | null; satisfactory: boolean | null }
  | { ok: false; status: 409; error: string; server: { value: ResponseValue | null; revision: number } }
  | { ok: false; status: number; error: string };

/**
 * One answer, with optimistic concurrency. `revision` is what the caller last saw (0 = no row). A stale revision answers
 * 409 with the server's row, so the caller can show both and choose. A null value clears the answer.
 */
export async function patchResponse(admin: Admin, actor: string, instanceId: string, key: string, rawValue: unknown, revision: number): Promise<PatchResult> {
  if (!Number.isInteger(revision) || revision < 0) return fail(400, "The revision is not valid.");
  const o = await own(admin, actor, instanceId);
  if (!o.ok) return o;
  const inst = o.value;
  if (inst.status !== "in_progress") return fail(409, "This assessment is no longer open for changes.");
  const d = await loadItemIds(admin, inst.instrument_version_id);
  if (!d.ok) return d;
  const { itemKey, fieldKey } = splitKey(key);
  const itemId = d.value[itemKey];
  if (!itemId) return fail(400, "That item is not part of this checklist.");
  const value = rawValue === null ? null : cleanAnswer(rawValue);
  if (rawValue !== null && value === null) return fail(400, "The answer must hold a level, a state or a value.");

  const current = await admin.from("asmt_response").select("value, revision").eq("instance_id", inst.id).eq("item_id", itemId).eq("field_key", fieldKey).maybeSingle();
  if (current.error) return fail(503, "The answer could not be read just now.");
  const row = current.data as { value: ResponseValue; revision: number } | null;
  const conflict = (): PatchResult => ({ ok: false, status: 409, error: "This answer was changed somewhere else.", server: { value: row?.value ?? null, revision: row?.revision ?? 0 } });

  if (value === null) {
    if (!row) return { ok: true, revision: 0, value: null, satisfactory: null };
    if (row.revision !== revision) return conflict();
    const del = await admin.from("asmt_response").delete().eq("instance_id", inst.id).eq("item_id", itemId).eq("field_key", fieldKey).eq("revision", revision);
    if (del.error) return fail(422, guardMessage(del.error));
    return { ok: true, revision: 0, value: null, satisfactory: null };
  }
  if (!row) {
    if (revision !== 0) return conflict();
    const ins = await admin.from("asmt_response").insert({ instance_id: inst.id, version_id: inst.instrument_version_id, item_id: itemId, field_key: fieldKey, value, updated_by: actor })
      .select("revision, value, satisfactory").single();
    if (ins.error || !ins.data) {
      // a unique violation means another writer got there first
      if (String(ins.error?.code) === "23505") {
        const again = await admin.from("asmt_response").select("value, revision").eq("instance_id", inst.id).eq("item_id", itemId).eq("field_key", fieldKey).maybeSingle();
        return { ok: false, status: 409, error: "This answer was changed somewhere else.", server: { value: (again.data as any)?.value ?? null, revision: (again.data as any)?.revision ?? 0 } };
      }
      return fail(422, guardMessage(ins.error));
    }
    return { ok: true, revision: ins.data.revision, value: ins.data.value, satisfactory: ins.data.satisfactory ?? null };
  }
  if (row.revision !== revision) return conflict();
  // The revision is part of the WHERE: a writer that lost the race updates nothing and is told so.
  const upd = await admin.from("asmt_response").update({ value, updated_by: actor })
    .eq("instance_id", inst.id).eq("item_id", itemId).eq("field_key", fieldKey).eq("revision", revision).select("revision, value, satisfactory");
  if (upd.error) return fail(422, guardMessage(upd.error));
  if (!upd.data || !upd.data.length) {
    const again = await admin.from("asmt_response").select("value, revision").eq("instance_id", inst.id).eq("item_id", itemId).eq("field_key", fieldKey).maybeSingle();
    return { ok: false, status: 409, error: "This answer was changed somewhere else.", server: { value: (again.data as any)?.value ?? null, revision: (again.data as any)?.revision ?? 0 } };
  }
  return { ok: true, revision: upd.data[0].revision, value: upd.data[0].value, satisfactory: upd.data[0].satisfactory ?? null };
}

async function loadItemIds(admin: Admin, versionId: string): Promise<Res<Record<string, string>>> {
  const { data, error } = await admin.from("asmt_item").select("id, stable_key").eq("version_id", versionId);
  if (error) return fail(503, "The checklist could not be read just now.");
  return okRes(Object.fromEntries((data ?? []).map((r: any) => [r.stable_key as string, r.id as string])));
}

// ── evidence and comments ────────────────────────────────────────────────────────────────────────────────────
// ⚠ NOTES AND RECORD REFERENCES ONLY. There is no HQ upload path to reuse: the document store belongs to the person's own
// Professional records and signs links for their owner. Adding a second store for assessors is its own decision, so
// kind "upload" is refused here and the screen offers a note or a reference to a record.
export const EVIDENCE_KINDS = ["note", "record_ref"] as const;
export const COMMENT_KINDS = ["comment", "safety_concern", "strength", "recommendation"] as const;

export async function addEvidence(admin: Admin, actor: string, instanceId: string, b: { itemKey?: string | null; kind?: unknown; note?: unknown; refKind?: unknown; refId?: unknown }): Promise<Res<{ id: string }>> {
  const o = await own(admin, actor, instanceId);
  if (!o.ok) return o;
  const inst = o.value;
  if (inst.status !== "in_progress") return fail(409, "Evidence is added while the assessment is in progress.");
  if (!(EVIDENCE_KINDS as readonly string[]).includes(String(b.kind))) return fail(400, "Evidence is a note or a reference to a record.");
  let itemId: string | null = null;
  if (b.itemKey) {
    const ids = await loadItemIds(admin, inst.instrument_version_id);
    if (!ids.ok) return ids;
    itemId = ids.value[String(b.itemKey)] ?? null;
    if (!itemId) return fail(400, "That item is not part of this checklist.");
  }
  const row: Record<string, unknown> = { instance_id: inst.id, version_id: inst.instrument_version_id, item_id: itemId, kind: b.kind, added_by: actor };
  if (b.kind === "note") {
    const note = typeof b.note === "string" ? b.note.trim() : "";
    if (note.length < 1 || note.length > 4000) return fail(400, "Write a note of up to 4000 characters.");
    row.note = note;
  } else {
    if (typeof b.refKind !== "string" || !/^[a-z][a-z0-9_]{1,40}$/.test(b.refKind) || !isUuid(b.refId)) return fail(400, "Give the kind of record and its id.");
    row.ref_kind = b.refKind; row.ref_id = b.refId;
  }
  const ins = await admin.from("asmt_evidence").insert(row).select("id").single();
  if (ins.error || !ins.data) return fail(422, guardMessage(ins.error));
  return okRes({ id: ins.data.id as string });
}

export async function addComment(admin: Admin, actor: string, instanceId: string, b: { itemKey?: string | null; kind?: unknown; body?: unknown }): Promise<Res<{ id: string }>> {
  const o = await own(admin, actor, instanceId);
  if (!o.ok) return o;
  const inst = o.value;
  const kind = String(b.kind ?? "comment");
  if (!(COMMENT_KINDS as readonly string[]).includes(kind)) return fail(400, "Choose a kind of comment.");
  const body = typeof b.body === "string" ? b.body.trim() : "";
  if (body.length < 1 || body.length > 4000) return fail(400, "Write a comment of up to 4000 characters.");
  let itemId: string | null = null;
  if (b.itemKey) {
    const ids = await loadItemIds(admin, inst.instrument_version_id);
    if (!ids.ok) return ids;
    itemId = ids.value[String(b.itemKey)] ?? null;
    if (!itemId) return fail(400, "That item is not part of this checklist.");
  }
  const ins = await admin.from("asmt_comment").insert({ instance_id: inst.id, version_id: inst.instrument_version_id, item_id: itemId, kind, body, author_id: actor }).select("id").single();
  if (ins.error || !ins.data) return fail(422, guardMessage(ins.error));
  return okRes({ id: ins.data.id as string });
}

/** The capability an instance needs, from its version, or the default. Used by the report to show the authority snapshot. */
export const capabilityOf = (assess: string | null): string => assess ?? ASSESS_CAPABILITY;
