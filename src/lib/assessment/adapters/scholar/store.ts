/* eslint-disable @typescript-eslint/no-explicit-any */
import { ENGINE_VERSION, RulesError, evaluate, validateResponse, type InstrumentItem, type LayoutDoc, type ResponseValue, type Responses } from "../../core";
import { loadDefinition, type LoadedDefinition } from "../../read/definition";
import { getMaterial, getRevisionSession } from "@/lib/individual/scholar/store";
import { loadIndividualPolicyOnce } from "@/lib/individual/policy";
import { offerFilter, type OfferCard, type OfferGrant, type OfferVersion } from "./offer";
import { fromDbValue, responsesFromRows, splitKey, toDbValue, type ResponseRow } from "./answers";
import { ratingsByCompetency, type Attempt, type CompetencyRating } from "./history";
import { findStrengthsAndGaps, type Finding, type ItemContext } from "./findings";
import { progressionAfterSubmit, unansweredItems, unansweredMandatory, type UnansweredItem } from "./submit-check";
import { CONTEXT_PRODUCT_LINE, MODE_SELF, SELF_ATTESTATION } from "./vocab";

// ── THE SCHOLAR ADAPTER'S STORE ── Checklist Studio S3 ───────────────────────────────────────────────────────────────
//
// The ONLY Scholar code that reads or writes asmt_* rows. It interprets the universal engine for a Scholar learner:
//
// ⚠ EVERY QUERY ON A PERSON TABLE (asmt_instance, _response, _evidence, _comment, _outcome, _respondent_grant) CARRIES
//   subject_user_id = the learner. The learner's id comes from the gate-3 context of the caller, never from a request. A row of another
//   person reads as not found, exactly as a row that does not exist. (scripts/scholar-learning-harness.ts pins this statically.)
// ⚠ A SCHOLAR INSTANCE IS ALWAYS SELF-REPORTED: respondent_role self, respondent = subject, attestation self_reported (also a database
//   CHECK). Nothing here can create an assessor_evaluated or verified record, and nothing here writes the Passport or any verification.
// ⚠ THE DATABASE IS THE AUTHORITY. This file validates early for good messages and returns the database's own refusal otherwise.
//   Definition tables (the instrument, its items, scales, layouts and mappings) hold no person's data and are read by id only.
// ⚠ NO AI. Nothing in this directory imports an AI module.

type Admin = any;
export type Res<T> = { ok: true; data: T } | { ok: false; status: number; error: string; server?: unknown };
const fail = (status: number, error: string, server?: unknown): { ok: false; status: number; error: string; server?: unknown } => ({ ok: false, status, error, ...(server !== undefined ? { server } : {}) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (x: unknown): x is string => typeof x === "string" && UUID.test(x);
/** The database's own sentence without its prefix ("asmt_response: ..."). */
const dbMessage = (e: any): string => String(e?.message ?? "The change could not be saved.").replace(/^asmt_[a-z_]+:\s*/, "");

// ── readiness ──

/** Whether the assessment tables exist here. Absent or unreadable is "no" (the surface answers 404 / says it is not available). */
export async function assessmentsReady(admin: Admin, userId: string): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([
      admin.from("asmt_instance").select("id").eq("subject_user_id", userId).limit(1),
      admin.from("asmt_instrument").select("id").limit(1),
    ]);
    return !a.error && !b.error;
  } catch { return false; }
}

// ── offers and grants ──

export type OffersView = { cards: OfferCard[]; pendingGrants: number };

export async function listOffers(admin: Admin, userId: string, policyCodes: readonly string[], now = Date.now()): Promise<Res<OffersView>> {
  try {
    const g = await admin.from("asmt_respondent_grant")
      .select("id, instrument_id, respondent_id, accepted_at, ended_at, valid_from, valid_until, reason")
      .eq("subject_user_id", userId).is("ended_at", null);
    if (g.error) return fail(503, "Your assessments could not be read just now.");
    const grantRows = (g.data ?? []) as any[];
    const byCode = policyCodes.length ? await admin.from("asmt_instrument").select("id, code, name").in("code", [...policyCodes]) : { data: [], error: null };
    if (byCode.error) return fail(503, "Your assessments could not be read just now.");
    const ids = [...new Set([...(byCode.data ?? []).map((r: any) => r.id), ...grantRows.map(r => r.instrument_id)])] as string[];
    if (!ids.length) return { ok: true, data: { cards: [], pendingGrants: 0 } };
    const [ins, vers] = await Promise.all([
      admin.from("asmt_instrument").select("id, code, name").in("id", ids),
      admin.from("asmt_instrument_version").select("id, instrument_id, version_no, state, title, summary, delivery_modes, respondent_roles, method_codes").in("instrument_id", ids).eq("state", "published"),
    ]);
    if (ins.error || vers.error) return fail(503, "Your assessments could not be read just now.");
    const nameOf = new Map<string, { code: string; name: string }>((ins.data ?? []).map((r: any) => [r.id, { code: r.code, name: r.name }]));
    const respondentIds = [...new Set(grantRows.map(r => r.respondent_id))] as string[];
    const names = new Map<string, string | null>();
    if (respondentIds.length) {
      const p = await admin.from("profiles").select("id, full_name").in("id", respondentIds);
      for (const r of (p.data ?? []) as any[]) names.set(r.id, r.full_name ?? null);
    }
    const versions: OfferVersion[] = ((vers.data ?? []) as any[]).filter(v => nameOf.has(v.instrument_id)).map(v => ({
      instrumentId: v.instrument_id, code: nameOf.get(v.instrument_id)!.code, name: nameOf.get(v.instrument_id)!.name, versionId: v.id, versionNo: v.version_no, state: v.state,
      title: v.title ?? null, summary: v.summary ?? null, deliveryModes: v.delivery_modes ?? [], respondentRoles: v.respondent_roles ?? [], methodCodes: v.method_codes ?? [],
    }));
    const grants: OfferGrant[] = grantRows.map(r => ({
      id: r.id, instrumentId: r.instrument_id, acceptedAt: r.accepted_at ?? null, endedAt: r.ended_at ?? null, validFrom: r.valid_from, validUntil: r.valid_until ?? null,
      respondentName: names.get(r.respondent_id) ?? null, reason: r.reason ?? null,
    }));
    const cards = offerFilter({ policyCodes, versions, grants, now });
    return { ok: true, data: { cards, pendingGrants: cards.filter(c => c.assessorLed?.standing === "awaiting_acceptance").length } };
  } catch { return fail(503, "Your assessments could not be read just now."); }
}

/** The learner accepts a grant made for them. Only their own, only while it is neither accepted nor ended. */
export async function acceptGrant(admin: Admin, userId: string, grantId: string): Promise<Res<true>> {
  if (!isUuid(grantId)) return fail(404, "Not found.");
  const r = await admin.from("asmt_respondent_grant").update({ accepted_at: new Date().toISOString(), accepted_by: userId })
    .eq("id", grantId).eq("subject_user_id", userId).is("accepted_at", null).is("ended_at", null).select("id");
  if (r.error) return fail(422, dbMessage(r.error));
  return (r.data ?? []).length ? { ok: true, data: true } : fail(404, "Not found.");
}

/** The learner ends a grant made for them (declining one not yet accepted is ending it). An ended grant is history and never reopens. */
export async function endGrant(admin: Admin, userId: string, grantId: string, reason: string): Promise<Res<true>> {
  if (!isUuid(grantId)) return fail(404, "Not found.");
  const text = reason.trim().slice(0, 1000);
  if (text.length < 3) return fail(422, "Say briefly why (at least three characters).");
  const r = await admin.from("asmt_respondent_grant").update({ ended_at: new Date().toISOString(), ended_by: userId, end_reason: text })
    .eq("id", grantId).eq("subject_user_id", userId).is("ended_at", null).select("id");
  if (r.error) return fail(422, dbMessage(r.error));
  return (r.data ?? []).length ? { ok: true, data: true } : fail(404, "Not found.");
}

// ── start ──

/**
 * A new self-assessment on the latest PUBLISHED version of an instrument. The code must be one HQ offers (the caller passes the policy list),
 * and the version must allow self-assessment and a self respondent. Every attempt is a NEW instance: nothing is reused or overwritten.
 */
export async function startSelf(admin: Admin, userId: string, code: string, policyCodes: readonly string[]): Promise<Res<{ instanceId: string }>> {
  if (!/^[A-Z][A-Z0-9-]{2,40}$/.test(code) || !policyCodes.includes(code)) return fail(404, "Not found.");
  try {
    const ins = await admin.from("asmt_instrument").select("id").eq("code", code).maybeSingle();
    if (ins.error) return fail(503, "This could not be started just now.");
    if (!ins.data) return fail(404, "Not found.");
    const v = await admin.from("asmt_instrument_version").select("id, delivery_modes, respondent_roles, default_layout_version_id, version_no")
      .eq("instrument_id", ins.data.id).eq("state", "published").order("version_no", { ascending: false }).limit(1);
    if (v.error) return fail(503, "This could not be started just now.");
    const ver = (v.data ?? [])[0];
    if (!ver || !(ver.delivery_modes ?? []).includes(MODE_SELF) || !(ver.respondent_roles ?? []).includes("self")) return fail(404, "Not found.");
    // A double click, a back button or a refresh must not open a second copy: a self-assessment started on this version in the last two minutes that has
    // no answer yet is the one the learner meant. (A deliberate new attempt later is always a new instance.)
    const recent = await admin.from("asmt_instance").select("id, started_at").eq("subject_user_id", userId).eq("instrument_version_id", ver.id)
      .eq("respondent_role", "self").eq("status", "in_progress").gte("started_at", new Date(Date.now() - 120_000).toISOString()).order("started_at", { ascending: false }).limit(1);
    if (!recent.error && (recent.data ?? []).length) {
      const answered = await admin.from("asmt_response").select("item_id").eq("instance_id", recent.data[0].id).eq("subject_user_id", userId).limit(1);
      if (!answered.error && !(answered.data ?? []).length) return { ok: true, data: { instanceId: recent.data[0].id } };
    }
    const created = await admin.from("asmt_instance").insert({
      instrument_version_id: ver.id, subject_kind: "person", subject_id: userId, subject_user_id: userId,
      respondent_role: "self", respondent_id: userId, attestation: SELF_ATTESTATION,
      owner_scope: "individual", owner_user_id: userId, context_product_line: CONTEXT_PRODUCT_LINE,
    }).select("id").single();
    if (created.error || !created.data) return fail(422, dbMessage(created.error));
    const instanceId = created.data.id as string;
    // Pin the layouts: the version's default is primary, every other allowed layout is pinned beside it. A failure to pin the primary layout
    // removes the empty instance rather than leaving one that cannot be shown. The runner falls back to its built-in layout when none is pinned.
    const allowed = await admin.from("asmt_version_layout").select("layout_version_id").eq("version_id", ver.id);
    const layoutIds = [...new Set([ver.default_layout_version_id, ...((allowed.data ?? []) as any[]).map(r => r.layout_version_id)].filter(Boolean))] as string[];
    for (const id of layoutIds) {
      const pin = await admin.from("asmt_instance_layout").insert({ instance_id: instanceId, layout_version_id: id, is_primary: id === ver.default_layout_version_id });
      if (pin.error && id === ver.default_layout_version_id) {
        await admin.from("asmt_instance").delete().eq("id", instanceId).eq("subject_user_id", userId);
        return fail(422, dbMessage(pin.error));
      }
    }
    return { ok: true, data: { instanceId } };
  } catch { return fail(503, "This could not be started just now."); }
}

// ── an instance, whole ──

export type EvidenceRowOut = { id: string; itemKey: string | null; kind: string; refKind: string | null; refId: string | null; note: string | null; createdAt: string };
export type CommentRowOut = { id: string; itemKey: string | null; kind: string; body: string; createdAt: string };
export type OutcomeOut = { code: string; outcomeClass: string; backstopApplied: boolean; createdAt: string };
export type InstanceBundle = {
  instance: { id: string; status: string; attestation: string; respondentRole: string; respondentId: string | null; startedAt: string; submittedAt: string | null; versionId: string };
  loaded: LoadedDefinition;
  layout: LayoutDoc | null;
  guidedLayout: LayoutDoc | null;
  responses: Responses;
  revisions: Record<string, number>;
  evidence: EvidenceRowOut[];
  comments: CommentRowOut[];
  outcome: OutcomeOut | null;
};

async function pinnedLayouts(admin: Admin, pins: { layout_version_id: string; is_primary: boolean }[]): Promise<{ layout: LayoutDoc | null; guided: LayoutDoc | null }> {
  if (!pins.length) return { layout: null, guided: null };
  const r = await admin.from("asmt_layout_template_version").select("id, presentation, layout, state").in("id", pins.map(p => p.layout_version_id));
  if (r.error) return { layout: null, guided: null };
  const rows = ((r.data ?? []) as any[]).filter(x => (x.state === "published" || x.state === "retired") && x.layout && typeof x.layout === "object");
  const primary = rows.find(x => pins.some(p => p.is_primary && p.layout_version_id === x.id)) ?? rows.find(x => x.presentation === "standard_checklist");
  const guided = rows.find(x => x.presentation === "guided_assessment");
  return { layout: (primary?.layout as LayoutDoc) ?? null, guided: (guided?.layout as LayoutDoc) ?? null };
}

/** One of THIS learner's instances with its pinned definition, answers, evidence, comments and outcome. Null: not the learner's, or not there. */
export async function loadInstanceBundle(admin: Admin, userId: string, instanceId: string): Promise<Res<InstanceBundle | null>> {
  if (!isUuid(instanceId)) return { ok: true, data: null };
  try {
    const inst = await admin.from("asmt_instance")
      .select("id, instrument_version_id, status, attestation, respondent_role, respondent_id, started_at, submitted_at, asmt_instance_layout(layout_version_id, is_primary)")
      .eq("id", instanceId).eq("subject_user_id", userId).maybeSingle();
    if (inst.error) return fail(503, "This assessment could not be read just now.");
    if (!inst.data) return { ok: true, data: null };
    const d = await loadDefinition(admin, inst.data.instrument_version_id);
    if (!d.ok) return fail(503, "This assessment could not be read just now.");
    if (!d.value) return { ok: true, data: null };
    const loaded = d.value;
    const [resp, ev, cm, oc] = await Promise.all([
      admin.from("asmt_response").select("item_id, field_key, value, revision").eq("instance_id", instanceId).eq("subject_user_id", userId),
      admin.from("asmt_evidence").select("id, item_id, kind, ref_kind, ref_id, note, created_at").eq("instance_id", instanceId).eq("subject_user_id", userId).order("created_at"),
      admin.from("asmt_comment").select("id, item_id, kind, body, created_at").eq("instance_id", instanceId).eq("subject_user_id", userId).order("created_at"),
      admin.from("asmt_outcome").select("outcome_code, outcome_class, backstop_applied, created_at").eq("instance_id", instanceId).eq("subject_user_id", userId).maybeSingle(),
    ]);
    if (resp.error || ev.error || cm.error || oc.error) return fail(503, "This assessment could not be read just now.");
    const stableOf = new Map<string, string>(Object.entries(loaded.itemIds).map(([k, id]) => [id, k]));
    const { responses, revisions } = responsesFromRows((resp.data ?? []) as ResponseRow[], stableOf);
    const lay = await pinnedLayouts(admin, (inst.data.asmt_instance_layout ?? []) as any[]);
    return {
      ok: true,
      data: {
        instance: {
          id: inst.data.id, status: inst.data.status, attestation: inst.data.attestation, respondentRole: inst.data.respondent_role, respondentId: inst.data.respondent_id ?? null,
          startedAt: inst.data.started_at, submittedAt: inst.data.submitted_at ?? null, versionId: inst.data.instrument_version_id,
        },
        loaded, layout: lay.layout ?? loaded.layout, guidedLayout: lay.guided, responses, revisions,
        evidence: ((ev.data ?? []) as any[]).map(e => ({ id: e.id, itemKey: e.item_id ? stableOf.get(e.item_id) ?? null : null, kind: e.kind, refKind: e.ref_kind ?? null, refId: e.ref_id ?? null, note: e.note ?? null, createdAt: e.created_at })),
        comments: ((cm.data ?? []) as any[]).map(c => ({ id: c.id, itemKey: c.item_id ? stableOf.get(c.item_id) ?? null : null, kind: c.kind, body: c.body, createdAt: c.created_at })),
        outcome: oc.data ? { code: oc.data.outcome_code, outcomeClass: oc.data.outcome_class, backstopApplied: !!oc.data.backstop_applied, createdAt: oc.data.created_at } : null,
      },
    };
  } catch { return fail(503, "This assessment could not be read just now."); }
}

// ── answers ──

export type PatchInput = { key: string; value: ResponseValue | null; revision: number };
export type PatchResult = { revision: number; cleared: boolean };

/** Saves ONE answer. `revision` is the revision the browser last saw (0 when it saw none): a different one is a conflict and returns the server's row. */
export async function patchResponse(admin: Admin, userId: string, instanceId: string, input: PatchInput): Promise<Res<PatchResult>> {
  const k = splitKey(input.key);
  if (!k || !Number.isInteger(input.revision) || input.revision < 0) return fail(400, "That answer could not be read.");
  try {
    const b = await loadInstanceBundle(admin, userId, instanceId);
    if (!b.ok) return b;
    if (!b.data) return fail(404, "Not found.");
    if (b.data.instance.status !== "in_progress") return fail(409, "This assessment is already submitted.");
    const itemId = b.data.loaded.itemIds[k.itemKey];
    const item: InstrumentItem | undefined = b.data.loaded.def.items.find(i => i.stable_key === k.itemKey);
    if (!itemId || !item) return fail(404, "Not found.");
    const stored = toDbValue(input.value);
    if (stored) {
      const check = validateResponse(item, fromDbValue(stored), k.fieldKey);
      if (!check.ok) return fail(422, check.issues[0]?.message ?? "That answer is not valid for this item.");
    }
    const where = { instance_id: instanceId, item_id: itemId, field_key: k.fieldKey };
    const cur = await admin.from("asmt_response").select("value, revision").match(where).eq("subject_user_id", userId).maybeSingle();
    if (cur.error) return fail(503, "That answer could not be saved just now.");
    const existing = cur.data as { value: unknown; revision: number } | null;
    if (!stored) {
      if (!existing) return { ok: true, data: { revision: 0, cleared: true } };
      if (existing.revision !== input.revision) return fail(409, "conflict", { value: existing.value, revision: existing.revision });
      const del = await admin.from("asmt_response").delete().match(where).eq("revision", input.revision).eq("subject_user_id", userId).select("revision");
      if (del.error) return fail(422, dbMessage(del.error));
      return (del.data ?? []).length ? { ok: true, data: { revision: 0, cleared: true } } : fail(409, "conflict", null);
    }
    if (!existing) {
      if (input.revision !== 0) return fail(409, "conflict", null);
      const ins = await admin.from("asmt_response").insert({ ...where, version_id: b.data.instance.versionId, value: stored, subject_user_id: userId, updated_by: userId }).select("revision").single();
      if (ins.error) {
        // A second device wrote the same item first: that is a conflict, not a failure.
        if (String(ins.error.code) === "23505") return fail(409, "conflict", null);
        return fail(422, dbMessage(ins.error));
      }
      return { ok: true, data: { revision: ins.data.revision, cleared: false } };
    }
    if (existing.revision !== input.revision) return fail(409, "conflict", { value: existing.value, revision: existing.revision });
    const upd = await admin.from("asmt_response").update({ value: stored, updated_by: userId }).match(where).eq("revision", input.revision).eq("subject_user_id", userId).select("revision");
    if (upd.error) return fail(422, dbMessage(upd.error));
    if (!(upd.data ?? []).length) return fail(409, "conflict", null);
    return { ok: true, data: { revision: upd.data[0].revision, cleared: false } };
  } catch { return fail(503, "That answer could not be saved just now."); }
}

// ── evidence and comments ──

/** The learner's own material or practice session, by reference. Anything else (or another person's) reads as not found. */
export async function ownsRef(admin: Admin, userId: string, refKind: string, refId: string): Promise<boolean> {
  if (!isUuid(refId)) return false;
  try {
    if (refKind === "material") { const m = await getMaterial(admin, userId, refId); return m.ok && !!m.data; }
    if (refKind === "revision_session") { const s = await getRevisionSession(admin, userId, refId); return s.ok && !!s.data; }
  } catch { /* fall through */ }
  return false;
}

export type EvidenceInput = { itemKey: string | null; kind: "note" | "record_ref"; note?: string; refKind?: string; refId?: string };

export async function addEvidence(admin: Admin, userId: string, instanceId: string, input: EvidenceInput): Promise<Res<{ id: string }>> {
  const b = await loadInstanceBundle(admin, userId, instanceId);
  if (!b.ok) return b;
  if (!b.data) return fail(404, "Not found.");
  if (b.data.instance.status !== "in_progress") return fail(409, "Evidence is added while the assessment is in progress.");
  let itemId: string | null = null;
  if (input.itemKey) {
    itemId = b.data.loaded.itemIds[input.itemKey] ?? null;
    if (!itemId) return fail(404, "Not found.");
  }
  let row: Record<string, unknown>;
  if (input.kind === "note") {
    const note = (input.note ?? "").trim().slice(0, 4000);
    if (!note) return fail(422, "Write a note, or link one of your own materials.");
    row = { kind: "note", note };
  } else {
    if (!input.refKind || !input.refId || !(await ownsRef(admin, userId, input.refKind, input.refId))) return fail(404, "Not found.");
    row = { kind: "record_ref", ref_kind: input.refKind, ref_id: input.refId };
  }
  const ins = await admin.from("asmt_evidence").insert({ ...row, instance_id: instanceId, version_id: b.data.instance.versionId, subject_user_id: userId, item_id: itemId, added_by: userId }).select("id").single();
  return ins.error ? fail(422, dbMessage(ins.error)) : { ok: true, data: { id: ins.data.id } };
}

export async function addComment(admin: Admin, userId: string, instanceId: string, input: { itemKey: string | null; body: string }): Promise<Res<{ id: string }>> {
  const b = await loadInstanceBundle(admin, userId, instanceId);
  if (!b.ok) return b;
  if (!b.data) return fail(404, "Not found.");
  const body = input.body.trim().slice(0, 4000);
  if (!body) return fail(422, "Write a comment first.");
  let itemId: string | null = null;
  if (input.itemKey) {
    itemId = b.data.loaded.itemIds[input.itemKey] ?? null;
    if (!itemId) return fail(404, "Not found.");
  }
  // A learner's own words are a plain comment. Safety concerns, strengths and recommendations are an assessor's kinds.
  const ins = await admin.from("asmt_comment").insert({ instance_id: instanceId, version_id: b.data.instance.versionId, subject_user_id: userId, item_id: itemId, kind: "comment", body, author_id: userId }).select("id").single();
  return ins.error ? fail(422, dbMessage(ins.error)) : { ok: true, data: { id: ins.data.id } };
}

// ── submit ──

export type SubmitInput = { confirmUnanswered: boolean };
export type SubmitResult = { outcome: { code: string; label: string; outcomeClass: string }; unanswered: UnansweredItem[]; progression: ReturnType<typeof progressionAfterSubmit> };

/**
 * Submits a self-assessment: the answers are read again on the server, evaluated by the engine, the scoring hash is checked against the
 * version the instance started on, and the ONE transaction asmt_submit_instance records the outcome and closes the instance (the database
 * backstop may force a gate outcome). A mandatory item left unanswered needs the learner's confirmation, asked again here.
 */
export async function submitSelf(admin: Admin, userId: string, instanceId: string, input: SubmitInput): Promise<Res<SubmitResult>> {
  try {
    const b = await loadInstanceBundle(admin, userId, instanceId);
    if (!b.ok) return b;
    if (!b.data) return fail(404, "Not found.");
    const { instance, loaded, responses } = b.data;
    if (instance.status !== "in_progress") return fail(409, "This assessment is already submitted.");
    if (instance.respondentRole !== "self" || instance.attestation !== SELF_ATTESTATION || instance.respondentId !== userId) return fail(404, "Not found.");
    const missing = unansweredItems(loaded.def, responses, loaded.rules?.defaults);
    if (unansweredMandatory(missing).length && !input.confirmUnanswered) return fail(409, "unanswered", { unanswered: unansweredMandatory(missing) });
    const counts: Record<string, number> = {};
    for (const e of b.data.evidence) if (e.itemKey) counts[e.itemKey] = (counts[e.itemKey] ?? 0) + 1;
    let ev;
    try { ev = evaluate(loaded.def, loaded.rules, responses, { evidenceCounts: counts }); }
    catch (e) { return fail(422, e instanceof RulesError ? e.message : "This assessment could not be scored."); }
    if (!loaded.meta.scoringHash || ev.rules_hash !== loaded.meta.scoringHash) return fail(409, "This assessment's scoring rules changed. Ask your administrator to republish it.");
    const rpc = await admin.rpc("asmt_submit_instance", {
      p_instance: instanceId, p_actor: userId,
      p_outcome: { outcomeCode: ev.outcome.code, outcomeClass: ev.class, groupOutcomes: ev.groupOutcomes, aggregates: ev.aggregates, trace: ev.trace, traceHash: ev.traceHash },
      p_engine: ENGINE_VERSION, p_hash: ev.rules_hash,
    });
    if (rpc.error) return fail(422, dbMessage(rpc.error));
    // The outcome the database RECORDED (a backstop may have replaced the engine's).
    const oc = await admin.from("asmt_outcome").select("outcome_code, outcome_class").eq("instance_id", instanceId).eq("subject_user_id", userId).maybeSingle();
    const code = oc.data?.outcome_code ?? ev.outcome.code;
    const label = loaded.rules.outcomes.find(o => o.code === code)?.label ?? code;
    return { ok: true, data: { outcome: { code, label, outcomeClass: oc.data?.outcome_class ?? ev.class }, unanswered: missing, progression: progressionAfterSubmit(instance.attestation) } };
  } catch { return fail(503, "This could not be submitted just now."); }
}

// ── lists, history and gaps ──

export type InstanceSummary = {
  id: string; versionId: string; instrumentCode: string; instrumentName: string; versionNo: number;
  role: "self" | "assessor" | "auditor"; attestation: string; status: string; startedAt: string; submittedAt: string | null;
  answered: number; total: number; outcomeCode: string | null; outcomeClass: string | null; outcomeLabel: string | null; assessorName: string | null;
};

type MappingFact = { competencyId: string; criterionId: string | null; wording: string | null };

/** Item stable key -> the competency (and criterion) it assesses, from the version's own mappings. A definition read: no person's data. */
export async function loadItemCompetencies(admin: Admin, loaded: LoadedDefinition): Promise<Map<string, MappingFact>> {
  const out = new Map<string, MappingFact>();
  const r = await admin.from("asmt_mapping").select("item_id, kind, ref_id, ref_snapshot, relation").eq("version_id", loaded.meta.versionId).eq("relation", "assesses");
  if (r.error) return out;
  const stableOf = new Map<string, string>(Object.entries(loaded.itemIds).map(([k, id]) => [id, k]));
  const rows = ((r.data ?? []) as any[]).filter(m => m.item_id && stableOf.has(m.item_id) && (m.kind === "competency_criterion" || m.kind === "competency") && m.ref_id);
  const needSkill = rows.filter(m => m.kind === "competency_criterion" && !m.ref_snapshot?.competency_id).map(m => m.ref_id as string);
  const skillCompetency = new Map<string, string>();
  if (needSkill.length) {
    const s = await admin.from("competency_skills").select("id, competency_id").in("id", [...new Set(needSkill)]);
    for (const x of (s.data ?? []) as any[]) skillCompetency.set(x.id, x.competency_id);
  }
  for (const m of rows) {
    const competencyId = m.kind === "competency" ? m.ref_id : (m.ref_snapshot?.competency_id as string | undefined) ?? skillCompetency.get(m.ref_id);
    if (!competencyId) continue;
    out.set(stableOf.get(m.item_id)!, { competencyId, criterionId: m.kind === "competency_criterion" ? m.ref_id : null, wording: typeof m.ref_snapshot?.wording === "string" ? m.ref_snapshot.wording : null });
  }
  return out;
}

export type SelfHistory = {
  summaries: InstanceSummary[];
  /** Submitted self attempts that rated each competency (oldest first once built). */
  attempts: Map<string, Attempt[]>;
  /** Strengths and gaps of the LATEST submitted attempt per competency. */
  latestFindings: Map<string, Finding[]>;
  /** The highest ordinal on a rating scale the learner has used (6 on a 0-6 scale). */
  scaleMax: number | null;
  /** EVERY competency one of the learner's own self instances (submitted or still open) is mapped to, with the open instance if there is one. Whether the programme offers it or not. */
  selfMapped: Map<string, { inProgressId: string | null }>;
};

/**
 * Every instance of THIS learner, summarised, and from the submitted SELF ones the ratings per competency. `expected` is the programme's
 * expected level per competency (the scale's own ordinal), from the existing catalogue reader.
 */
export async function loadHistory(admin: Admin, userId: string, expected: ReadonlyMap<string, number | null>): Promise<Res<SelfHistory>> {
  try {
    const inst = await admin.from("asmt_instance")
      .select("id, instrument_version_id, respondent_role, respondent_id, attestation, status, started_at, submitted_at")
      .eq("subject_user_id", userId).neq("status", "withdrawn").order("started_at", { ascending: false }).limit(300);
    if (inst.error) return fail(503, "Your assessments could not be read just now.");
    const rows = (inst.data ?? []) as any[];
    const empty: SelfHistory = { summaries: [], attempts: new Map(), latestFindings: new Map(), scaleMax: null, selfMapped: new Map() };
    if (!rows.length) return { ok: true, data: empty };
    const ids = rows.map(r => r.id);
    const [resp, oc] = await Promise.all([
      admin.from("asmt_response").select("instance_id, item_id, field_key, value, revision").in("instance_id", ids).eq("subject_user_id", userId).eq("field_key", "primary").limit(20000),
      admin.from("asmt_outcome").select("instance_id, outcome_code, outcome_class").in("instance_id", ids).eq("subject_user_id", userId),
    ]);
    if (resp.error || oc.error) return fail(503, "Your assessments could not be read just now.");
    const versionIds = [...new Set(rows.map(r => r.instrument_version_id))] as string[];
    const defs = new Map<string, { loaded: LoadedDefinition; map: Map<string, MappingFact> }>();
    // Together: each definition takes several round trips, and a learner may have sat several instruments.
    const loaded = await Promise.all(versionIds.map(async vid => {
      const d = await loadDefinition(admin, vid);
      if (!d.ok) return { vid, failed: true as const };
      return { vid, failed: false as const, value: d.value ? { loaded: d.value, map: await loadItemCompetencies(admin, d.value) } : null };
    }));
    if (loaded.some(x => x.failed)) return fail(503, "Your assessments could not be read just now.");
    for (const x of loaded) if (!x.failed && x.value) defs.set(x.vid, x.value);
    const assessorIds = [...new Set(rows.filter(r => r.respondent_role !== "self" && r.respondent_id).map(r => r.respondent_id))] as string[];
    const names = new Map<string, string | null>();
    if (assessorIds.length) {
      const p = await admin.from("profiles").select("id, full_name").in("id", assessorIds);
      for (const r of (p.data ?? []) as any[]) names.set(r.id, r.full_name ?? null);
    }
    const outcomeOf = new Map<string, { code: string; cls: string }>(((oc.data ?? []) as any[]).map(o => [o.instance_id, { code: o.outcome_code, cls: o.outcome_class }]));
    const respByInstance = new Map<string, ResponseRow[]>();
    for (const r of (resp.data ?? []) as any[]) { const l = respByInstance.get(r.instance_id) ?? []; l.push(r); respByInstance.set(r.instance_id, l); }

    const summaries: InstanceSummary[] = [];
    const attempts = new Map<string, Attempt[]>();
    const latestFindings = new Map<string, { at: string; findings: Finding[] }>();
    let scaleMax: number | null = null;
    const selfMapped = new Map<string, { inProgressId: string | null }>();
    for (const r of rows) {
      const d = defs.get(r.instrument_version_id);
      if (!d) continue;
      const stableOf = new Map<string, string>(Object.entries(d.loaded.itemIds).map(([k, id]) => [id, k]));
      const { responses } = responsesFromRows(respByInstance.get(r.id) ?? [], stableOf);
      const o = outcomeOf.get(r.id);
      summaries.push({
        id: r.id, versionId: r.instrument_version_id, instrumentCode: d.loaded.meta.instrumentCode, instrumentName: d.loaded.meta.instrumentName, versionNo: d.loaded.meta.versionNo,
        role: r.respondent_role, attestation: r.attestation, status: r.status, startedAt: r.started_at, submittedAt: r.submitted_at ?? null,
        answered: Object.keys(responses).length, total: d.loaded.def.items.length,
        outcomeCode: o?.code ?? null, outcomeClass: o?.cls ?? null, outcomeLabel: o ? d.loaded.rules.outcomes.find(x => x.code === o.code)?.label ?? o.code : null,
        assessorName: r.respondent_role !== "self" ? names.get(r.respondent_id) ?? null : null,
      });
      for (const it of d.loaded.def.items) for (const l of it.scale?.levels ?? []) scaleMax = scaleMax === null ? l.ordinal : Math.max(scaleMax, l.ordinal);
      if (r.respondent_role === "self") {
        for (const m of d.map.values()) {
          const cur = selfMapped.get(m.competencyId);
          // rows are newest first: the first open instance seen is the newest
          if (!cur || (cur.inProgressId === null && r.status === "in_progress")) selfMapped.set(m.competencyId, { inProgressId: r.status === "in_progress" ? r.id : cur?.inProgressId ?? null });
        }
      }
      // Ratings only from SUBMITTED SELF instances: an assessor's instance is another class, and a draft is not yet an attempt.
      if (r.respondent_role !== "self" || r.status !== "submitted" || !r.submitted_at) continue;
      const competencyOf = new Map<string, string>([...d.map].map(([k, m]) => [k, m.competencyId]));
      const ratings: Map<string, CompetencyRating> = ratingsByCompetency(d.loaded.def, responses, competencyOf, d.loaded.rules?.defaults);
      for (const [competencyId, rating] of ratings) {
        const list = attempts.get(competencyId) ?? [];
        list.push({ instanceId: r.id, submittedAt: r.submitted_at, instrumentCode: d.loaded.meta.instrumentCode, instrumentName: d.loaded.meta.instrumentName, rating });
        attempts.set(competencyId, list);
      }
      const contexts = new Map<string, ItemContext>([...d.map].map(([k, m]) => [k, { competencyId: m.competencyId, expected: expected.get(m.competencyId) ?? null }]));
      const { strengths, gaps } = findStrengthsAndGaps(d.loaded.def, responses, contexts, d.loaded.rules?.defaults);
      for (const competencyId of ratings.keys()) {
        const mine = [...strengths, ...gaps].filter(f => f.competencyId === competencyId);
        const cur = latestFindings.get(competencyId);
        if (!cur || cur.at < r.submitted_at) latestFindings.set(competencyId, { at: r.submitted_at, findings: mine });
      }
    }
    return { ok: true, data: { summaries, attempts, latestFindings: new Map([...latestFindings].map(([k, v]) => [k, v.findings])), scaleMax, selfMapped } };
  } catch { return fail(503, "Your assessments could not be read just now."); }
}

/** competency id -> the offered instruments (code and name) whose items assess it, so the Overview can offer "Start" / "Repeat". Definition reads only. */
export async function startableByCompetency(admin: Admin, cards: readonly OfferCard[]): Promise<Map<string, { code: string; name: string }>> {
  const out = new Map<string, { code: string; name: string }>();
  for (const c of cards.filter(x => x.selfAssessment)) {
    try {
      const d = await loadDefinition(admin, c.versionId);
      if (!d.ok || !d.value) continue;
      for (const m of (await loadItemCompetencies(admin, d.value)).values()) if (!out.has(m.competencyId)) out.set(m.competencyId, { code: c.code, name: c.name });
    } catch { /* an unreadable instrument offers nothing */ }
  }
  return out;
}

/** The criteria of one instance for the report: item stable key -> competency, expected level and criterion wording. */
export async function itemContextsFor(admin: Admin, loaded: LoadedDefinition, expected: ReadonlyMap<string, number | null>): Promise<{ contexts: Map<string, ItemContext>; wording: Map<string, string | null>; competencyOf: Map<string, string> }> {
  const map = await loadItemCompetencies(admin, loaded);
  return {
    contexts: new Map([...map].map(([k, m]) => [k, { competencyId: m.competencyId, expected: expected.get(m.competencyId) ?? null }])),
    wording: new Map([...map].map(([k, m]) => [k, m.wording])),
    competencyOf: new Map([...map].map(([k, m]) => [k, m.competencyId])),
  };
}


/** Start from a page request (the start URL): the same rules as the API, with the policy list read here. Fails closed. */
export async function startFromPage(admin: Admin, userId: string, code: string): Promise<Res<{ instanceId: string }>> {
  try {
    if (!(await assessmentsReady(admin, userId))) return fail(404, "Not found.");
    const policy = await loadIndividualPolicyOnce(admin);
    return await startSelf(admin, userId, code, policy.scholarAssessmentInstruments);
  } catch { return fail(503, "This could not be started just now."); }
}

export type CompetencyLabel = { id: string; code: string | null; title: string; domain: string; framework: string | null };

/**
 * Name, code, domain and framework NAME of competencies a learner has rated themselves on, whether or not their programme offers them. Only those four
 * labels are read: no criterion wording, no status, no content. The learner already holds these competencies' ids through their own instances.
 */
export async function loadCompetencyLabels(admin: Admin, ids: readonly string[]): Promise<Map<string, CompetencyLabel>> {
  const out = new Map<string, CompetencyLabel>();
  const want = [...new Set(ids.filter(isUuid))];
  if (!want.length) return out;
  try {
    const r = await admin.from("framework_competencies").select("id, name, code, framework_domains(name, frameworks(name))").in("id", want);
    if (r.error) return out;
    for (const c of (r.data ?? []) as any[]) {
      const dom = Array.isArray(c.framework_domains) ? c.framework_domains[0] : c.framework_domains;
      const fw = dom ? (Array.isArray(dom.frameworks) ? dom.frameworks[0] : dom.frameworks) : null;
      out.set(c.id, { id: c.id, code: c.code ?? null, title: c.name, domain: dom?.name ?? "", framework: fw?.name ?? null });
    }
  } catch { /* a label that cannot be read is simply not named: the row still shows the learner's rating */ }
  return out;
}
