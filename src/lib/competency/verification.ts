/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  checkAssessorRecord, checkDecision, checkMethodContent, componentOutcomeOf, deriveState, isAssessorEvidence, standingOf,
  cleanDraft, developmentNeedsOf, methodDraftFromCompetency,
  type AnyEvidenceKind, type DecisionDraft, type DevelopmentNeed, type MethodContent, type RequestState, type ScaleLevel, type SourceComponent, type Standing, type EvidenceKind,
} from "./verification-config";

// ── THE COMPETENCY VERIFICATION STUDIO: READ AND WRITTEN ── COMPETENCY-01 C5, migration 510 ───────────────────────
//
// THE ONE WRITER of 510's tables. A Holdings capability: the Studio (methods, versions, assessor scopes, assignment,
// revocation) behind hq.competency.verification.manage, the assessor behind hq.competency.verification.assess, and the
// person side (request, add evidence, withdraw, read) that a product calls for its own signed-in member.
//
// ⚠ THE DATABASE DECIDES. Every write here is re-checked by 510's triggers: the actor's ACTIVE appointment and its
// capability, independence (never the person), scope, assignment, the pinned criteria and append-only history. An HQ
// owner who passes the route gate is refused there too unless appointed: an owner short-circuit is not an appointment.
//
// ⚠ NO PROFESSIONAL TABLE IS READ HERE (individual-professional-harness R1). What an assessor reviews is the provenance
// snapshot 510's trigger took of each record when the person submitted it, so Holdings never reads the person's
// Professional record directly, and an assessor sees only what was submitted.
//
// ⚠ PORTFOLIO CONTRACT (agreed with the Stage 5 portfolio workstream). The portfolio calls requestVerification,
// addRequestEvidence, withdrawRequest and the readers, never writes these tables, and C5 never writes the portfolio's.

/** A refusal. code NOT_PROVISIONED: 510 is not on this environment, and a product gates on it. */
export type Write<T extends object = object> = ({ ok: true } & T) | { ok: false; status: number; error: string; code?: "NOT_PROVISIONED" };
export const NOT_PROVISIONED = { ok: false as const, status: 409, error: "Competency verification is not set up on this environment yet.", code: "NOT_PROVISIONED" as const };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missing = (e: any) => /does not exist|schema cache|could not find/i.test(e?.message ?? "");

/** A database refusal, in words. 510's messages are written for people, after the table name. */
export function refusalOf(e: any, what: string): { ok: false; status: number; error: string; code?: "NOT_PROVISIONED" } {
  const m = String(e?.message ?? "");
  if (missing(e)) return NOT_PROVISIONED;
  const said = /^(competency_[a-z_]+): (.+)$/.exec(m);
  if (said) return { ok: false, status: /not authorised|not independent|no self-verification|not the assigned/i.test(said[2]) ? 403 : 409, error: said[2].replace(/^./, c => c.toUpperCase()) + (/\.$/.test(said[2]) ? "" : ".") };
  if (String(e?.code) === "23503") return { ok: false, status: 404, error: "That is not on the record." };
  if (String(e?.code) === "23505") return { ok: false, status: 409, error: `That ${what} already exists.` };
  return { ok: false, status: 500, error: `The ${what} could not be saved just now. Try again shortly.` };
}

/**
 * 680 is not yet applied everywhere (CLAUDE.md, state 3: main can hold code a database does not have yet). A read or
 * write that names a 680 column is tried first and, ONLY when the database says that column does not exist, tried again
 * as 510 wrote it. Where 680 is absent there is no component rule and no publication independence to bypass: the
 * database simply predates them.
 */
async function with680<T = any>(run: (has680: boolean) => PromiseLike<{ data: T; error: any }>): Promise<{ data: T; error: any }> {
  const first = await run(true);
  if (first.error && missing(first.error) && /edited_by|component_|assessor_record|recorded_by|method_version_id/i.test(String(first.error.message ?? ""))) return run(false);
  return first;
}

/**
 * 690 is likewise not yet everywhere. A read naming 690 columns is tried first, then as 680 wrote it, then as 510 did,
 * each step ONLY when the database says a column of the newer migration does not exist.
 */
type Level = 690 | 680 | 510;
async function withLevel<T = any>(run: (level: Level) => PromiseLike<{ data: T; error: any }>): Promise<{ data: T; error: any }> {
  let r = await run(690);
  if (r.error && missing(r.error) && /confirmation_required|stage_|requested_by/i.test(String(r.error.message ?? ""))) r = await run(680);
  if (r.error && missing(r.error) && /edited_by|component_|assessor_record|recorded_by|method_version_id/i.test(String(r.error.message ?? ""))) r = await run(510);
  return r;
}

/** Whether 510 is on this environment. A zero-row read, never HEAD. */
export async function verificationReady(admin: any): Promise<boolean> {
  try { const { error } = await admin.from("competency_verification_method_version").select("id").limit(0); return !error; } catch { return false; }
}

// ── THE STUDIO (manage) ───────────────────────────────────────────────────────────────────────────────────────────

export type MethodVersionRow = { id: string; method_id: string; version_no: number; state: "draft" | "published" | "retired"; content: MethodContent; content_hash: string | null;
  authored_by: string | null; published_by: string | null; published_at: string | null; retired_at: string | null; updated_at: string;
  /** 680: everyone who edited the draft. None of them, nor the author, may publish it. Absent before 680. */
  edited_by?: string[] };
export type MethodRow = { id: string; code: string; name: string; kind: string; created_at: string; versions: MethodVersionRow[] };
const VERSION_COLS = "id, method_id, version_no, state, content, content_hash, authored_by, published_by, published_at, retired_at, updated_at";

/** Pure: whether this actor may publish this draft (680): never its author, never one of its editors. */
export const mayPublish = (v: Pick<MethodVersionRow, "authored_by" | "edited_by">, actor: string) => v.authored_by !== actor && !(v.edited_by ?? []).includes(actor);

export async function loadMethods(admin: any): Promise<MethodRow[] | null> {
  try {
    const [m, v] = await Promise.all([
      admin.from("competency_verification_method").select("id, code, name, kind, created_at").order("name").limit(500),
      with680(has => admin.from("competency_verification_method_version").select(has ? `${VERSION_COLS}, edited_by` : VERSION_COLS).order("version_no", { ascending: false }).limit(5000)),
    ]);
    if (m.error || v.error) return missing(m.error ?? v.error) ? [] : null;
    return (m.data ?? []).map((x: any) => ({ ...x, versions: (v.data ?? []).filter((y: any) => y.method_id === x.id) }));
  } catch { return null; }
}

export async function createMethod(admin: any, actor: string, b: { code: unknown; name: unknown; kind: unknown }): Promise<Write<{ methodId: string; versionId: string }>> {
  const code = typeof b.code === "string" ? b.code.trim().toLowerCase() : "";
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 160) : "";
  if (!/^[a-z][a-z0-9_]{2,60}$/.test(code)) return { ok: false, status: 400, error: "The method code is lower-case letters, digits and underscores, 3 to 61 characters." };
  if (name.length < 3) return { ok: false, status: 400, error: "Name the method." };
  const { data: m, error } = await admin.from("competency_verification_method").insert({ code, name, kind: b.kind, created_by: actor }).select("id").single();
  if (error || !m) return refusalOf(error, "method");
  const { data: v, error: vErr } = await admin.from("competency_verification_method_version").insert({ method_id: m.id, authored_by: actor }).select("id").single();
  if (vErr || !v) return refusalOf(vErr, "version");
  return { ok: true, methodId: m.id, versionId: v.id };
}

/** A new draft of a method, starting from its latest version's criteria. */
export async function newDraft(admin: any, actor: string, methodId: string): Promise<Write<{ versionId: string }>> {
  if (!UUID.test(methodId)) return { ok: false, status: 400, error: "Choose a method." };
  const { data: open } = await admin.from("competency_verification_method_version").select("id").eq("method_id", methodId).eq("state", "draft").limit(1);
  if ((open ?? []).length) return { ok: false, status: 409, error: "This method already has a draft. Edit that one." };
  const { data: latest } = await admin.from("competency_verification_method_version").select("content").eq("method_id", methodId).order("version_no", { ascending: false }).limit(1);
  const { data, error } = await admin.from("competency_verification_method_version").insert({ method_id: methodId, authored_by: actor, content: latest?.[0]?.content ?? {} }).select("id").single();
  return error || !data ? refusalOf(error, "version") : { ok: true, versionId: data.id };
}

/** A draft edit. 680 records the editor, who then can never publish this version. */
export async function saveDraft(admin: any, actor: string, versionId: string, input: unknown): Promise<Write<{ problems: string[] }>> {
  if (!UUID.test(versionId)) return { ok: false, status: 400, error: "Choose a version." };
  const c = checkMethodContent(input);
  if (!c.ok) return { ok: false, status: 400, error: c.error };
  const { data, error } = await with680(has => admin.from("competency_verification_method_version").update(has ? { content: c.content, last_edited_by: actor } : { content: c.content })
    .eq("id", versionId).eq("state", "draft").select("id").maybeSingle());
  if (error) return refusalOf(error, "draft");
  return data ? { ok: true, problems: c.problems } : { ok: false, status: 409, error: "Only a draft is edited. Published criteria never change: make a new version." };
}

export async function publishVersion(admin: any, actor: string, versionId: string): Promise<Write> {
  const { data: v } = await with680(has => admin.from("competency_verification_method_version").select(has ? "content, state, authored_by, edited_by" : "content, state, authored_by").eq("id", versionId).maybeSingle()) as { data: any; error: any };
  if (!v) return { ok: false, status: 404, error: "No such version." };
  // 680 refuses it too. Said here first, in words.
  if (Array.isArray(v.edited_by) && !mayPublish(v, actor)) return { ok: false, status: 403, error: "Not independent. You created or edited this version, so another administrator publishes it." };
  const c = checkMethodContent(v.content, true);
  if (!c.ok) return { ok: false, status: 400, error: c.error };
  const { data, error } = await admin.from("competency_verification_method_version").update({ state: "published", published_by: actor }).eq("id", versionId).eq("state", "draft").select("id").maybeSingle();
  if (error) return refusalOf(error, "version");
  return data ? { ok: true } : { ok: false, status: 409, error: "Only a draft can be published." };
}

export async function retireVersion(admin: any, actor: string, versionId: string): Promise<Write> {
  const { data, error } = await admin.from("competency_verification_method_version").update({ state: "retired", retired_by: actor }).eq("id", versionId).eq("state", "published").select("id").maybeSingle();
  if (error) return refusalOf(error, "version");
  return data ? { ok: true } : { ok: false, status: 409, error: "Only a published version can be retired." };
}

export const SCOPE_KINDS = ["profession", "specialty", "framework", "domain", "competency", "method", "max_level", "context"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];
export const SCOPE_KIND_LABEL: Record<ScopeKind, string> = {
  profession: "Profession", specialty: "Specialty", framework: "Framework", domain: "Competency domain", competency: "Competency",
  method: "Assessment method (narrows)", max_level: "Highest proficiency level (narrows)", context: "Verification context (narrows)",
};

export type AssessorAppointment = { appointmentId: string; personId: string; name: string | null; status: string; termEnd: string | null;
  scopes: { id: string; kind: ScopeKind; ref: string | null; value: string | null; validFrom: string; validUntil: string | null; endedAt: string | null; reason: string | null }[] };

export async function loadAssessorAppointments(admin: any): Promise<AssessorAppointment[] | null> {
  try {
    const { data: appts, error } = await admin.from("ogs_office_appointments").select("id, person_id, person_name, status, term_end").eq("role", "competency_assessor").order("term_start", { ascending: false }).limit(500);
    if (error) return null;
    const ids = (appts ?? []).map((a: any) => a.id);
    const { data: scopes, error: sErr } = ids.length ? await admin.from("competency_assessor_scope").select("id, appointment_id, scope_kind, scope_ref, scope_value, valid_from, valid_until, ended_at, grant_reason").in("appointment_id", ids) : { data: [], error: null };
    if (sErr && !missing(sErr)) return null;
    return (appts ?? []).map((a: any) => ({ appointmentId: a.id, personId: a.person_id, name: a.person_name ?? null, status: a.status, termEnd: a.term_end ?? null,
      scopes: (scopes ?? []).filter((s: any) => s.appointment_id === a.id).map((s: any) => ({ id: s.id, kind: s.scope_kind, ref: s.scope_ref, value: s.scope_value, validFrom: s.valid_from, validUntil: s.valid_until, endedAt: s.ended_at, reason: s.grant_reason })) }));
  } catch { return null; }
}

export async function grantScope(admin: any, actor: string, b: any): Promise<Write> {
  if (!UUID.test(String(b?.appointmentId ?? ""))) return { ok: false, status: 400, error: "Choose the assessor appointment." };
  const kind = (SCOPE_KINDS as readonly string[]).includes(b?.kind) ? b.kind as ScopeKind : null;
  if (!kind) return { ok: false, status: 400, error: "Choose what the scope covers." };
  const ref = kind === "context" ? null : UUID.test(String(b?.ref ?? "")) ? b.ref : null;
  const value = kind === "context" && typeof b?.value === "string" && /^[a-z][a-z0-9_]{1,40}$/.test(b.value) ? b.value : null;
  if (kind === "context" ? !value : !ref) return { ok: false, status: 400, error: kind === "context" ? "Name the context (lower-case letters and underscores)." : "Choose what it covers." };
  const validUntil = typeof b?.validUntil === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.validUntil) ? b.validUntil : null;
  const reason = typeof b?.reason === "string" ? b.reason.trim().slice(0, 500) : "";
  if (reason.length < 3) return { ok: false, status: 400, error: "Say why this scope is granted." };
  const { error } = await admin.from("competency_assessor_scope").insert({ appointment_id: b.appointmentId, scope_kind: kind, scope_ref: ref, scope_value: value, valid_until: validUntil, granted_by: actor, grant_reason: reason });
  return error ? refusalOf(error, "scope") : { ok: true };
}

export async function endScope(admin: any, actor: string, scopeId: string, reason: unknown): Promise<Write> {
  const r = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  if (!UUID.test(scopeId) || r.length < 3) return { ok: false, status: 400, error: "Choose the scope and say why it ends." };
  const { data, error } = await admin.from("competency_assessor_scope").update({ ended_at: new Date().toISOString(), ended_by: actor, end_reason: r }).eq("id", scopeId).is("ended_at", null).select("id").maybeSingle();
  if (error) return refusalOf(error, "scope");
  return data ? { ok: true } : { ok: false, status: 409, error: "That scope has already ended." };
}

// ── REQUESTS, READ ────────────────────────────────────────────────────────────────────────────────────────────────

// ── STABLE OUTCOME IDS (migration 751, owner ruling 5) ── evidence names outcomes by id, resolved through the REQUEST's
// outcome_map (the outcomes as they were when it was made), never the live competency, so reordering or rewording a
// competency never changes what historical evidence says. Before 751 (no ids) the stored indexes are read into the
// request's own snapshot, exactly as before.
export const WHOLE_COMPETENCY_OUTCOME = "00000000-0000-0000-0000-000000000000";
export type OutcomeMapEntry = { id: string; text: string };
/** Pure: the outcome texts an index list or id list names. null = the whole competency. */
export function outcomeTexts(indexes: readonly number[], ids: readonly string[] | null | undefined, map: readonly OutcomeMapEntry[] | null | undefined, snapshot: readonly string[]): string[] | null {
  if (ids?.length && map) {
    if (ids.includes(WHOLE_COMPETENCY_OUTCOME)) return null;
    return ids.map(id => map.find(m => m.id === id)?.text ?? "An outcome not recorded on this request");
  }
  if (indexes.includes(-1)) return null;
  return indexes.map(i => snapshot[i] ?? `Outcome ${i + 1}`);
}
const outcomeMapOf = (v: unknown): OutcomeMapEntry[] | null => Array.isArray(v) ? v.filter((m: any) => typeof m?.id === "string" && typeof m?.text === "string").map((m: any) => ({ id: m.id, text: m.text })) : null;

/** sourcePresent: the person's source record still exists. Always true for 680 assessor evidence, which has no source but itself. */
export type EvidenceView = { id: string; kind: AnyEvidenceKind; outcomeIndexes: number[]; outcomeIds?: string[] | null; provenance: Record<string, any>; sourcePresent: boolean; addedAt: string };
/** 680: one component as the decision recorded it (levelId null: not assessed). */
export type ComponentResultView = { code: string; levelId: string | null; score: number | null; label: string | null; note: string | null };
export type ConsolidatedView = NonNullable<ReturnType<typeof componentOutcomeOf>>;
export type DecisionView = { id: string; assessorId: string | null; appointmentId: string | null; methodVersionId: string; methodContentHash: string | null; competencyHash: string | null;
  outcomeCode: string; outcomeClass: string | null; outcomeLabel: string | null; levelId: string | null; criteria: any[]; checklist: any[]; evidenceReviewed: string[];
  rationale: string; validFrom: string | null; validUntil: string | null; decidedAt: string; standing: Standing; revokedReason: string | null;
  /** 680: empty and null when the method version assesses no components (or 680 is absent). */
  componentResults: ComponentResultView[]; componentOutcome: ConsolidatedView | null;
  /** 690: the stage of the published stage mapping, pinned to its version. null: no mapping published, or no level. */
  stage: StageView | null;
  /** 690: a second assessor's confirmation, where the method requires one. */
  confirmationRequired: boolean; confirmation: ConfirmationView | null };
export type StageView = { code: string; label: string; mappingVersion: number | null };
export type ConfirmationView = { result: "confirmed" | "not_confirmed"; assessorId: string | null; rationale: string; at: string };

/** Pure: a stored 680 component_results array, as a view. */
export const componentResultsOf = (v: unknown): ComponentResultView[] => (Array.isArray(v) ? v : []).filter((r: any) => typeof r?.code === "string").map((r: any) => ({
  code: r.code, levelId: typeof r.levelId === "string" ? r.levelId : null, score: typeof r.score === "number" ? r.score : null, label: typeof r.label === "string" ? r.label : null,
  note: typeof r.note === "string" ? r.note : null,
}));
export type RequestView = { id: string; userId: string; competencyId: string; competency: { name: string; code: string | null; learning_outcomes: string[] } | null;
  frameworkVersion: string | null; methodVersionId: string; outcomeIndexes: number[];
  /** 751: the stable outcome ids and the request's outcome map. null before 751. */
  outcomeIds?: string[] | null; outcomeMap?: OutcomeMapEntry[] | null; targetLevelId: string | null; context: string; note: string | null; createdAt: string;
  state: RequestState; assignedTo: { assessorId: string; appointmentId: string } | null; evidence: EvidenceView[]; decisions: DecisionView[];
  events: { event: string; actorId: string | null; reason: string | null; decisionId: string | null; at: string }[];
  /** 690: who asked for the assessment: the person, or a programme lead. null before 690. */
  requestedBy: string | null; renewsDecisionId: string | null };

const REQ_COLS = "id, user_id, competency_id, method_version_id, outcome_indexes, target_level_id, context, note, competency_snapshot, framework_version, created_at, renews_decision_id";
const reqCols = (level: Level) => (level === 690 ? `${REQ_COLS}, requested_by` : REQ_COLS);
const DEC_COLS = "id, request_id, user_id, assessor_id, appointment_id, method_version_id, method_content_hash, competency_hash, outcome_code, outcome_class, outcome_label, level_id, criteria_results, checklist_results, evidence_reviewed, rationale, valid_from, valid_until, created_at";
const decCols = (level: Level) => DEC_COLS + (level !== 510 ? ", component_results, component_outcome" : "") + (level === 690 ? ", confirmation_required, stage_code, stage_label, stage_mapping_version" : "");

/** 690 confirmations of these requests. Absent before 690, so none. */
async function confirmationsOf(admin: any, requestIds: string[]): Promise<any[] | null> {
  if (!requestIds.length) return [];
  const { data, error } = await admin.from("competency_verification_confirmation").select("decision_id, request_id, assessor_id, result, rationale, created_at").in("request_id", requestIds);
  if (error) return missing(error) ? [] : null;
  return data ?? [];
}

/** 751 outcome ids of these requests and their evidence. Before 751 (or unreadable) none: readers fall back to indexes. */
async function outcomeIdsOf(admin: any, requestIds: string[]): Promise<{ requests: Map<string, { ids: string[]; map: OutcomeMapEntry[] | null }>; evidence: Map<string, string[]> }> {
  const out = { requests: new Map<string, { ids: string[]; map: OutcomeMapEntry[] | null }>(), evidence: new Map<string, string[]>() };
  if (!requestIds.length) return out;
  try {
    const [rq, ev] = await Promise.all([
      admin.from("competency_verification_request").select("id, outcome_ids, outcome_map").in("id", requestIds),
      admin.from("competency_verification_evidence").select("id, outcome_ids").in("request_id", requestIds),
    ]);
    if (rq?.error || ev?.error) return out;
    for (const r of rq?.data ?? []) if (Array.isArray(r.outcome_ids)) out.requests.set(r.id, { ids: r.outcome_ids, map: outcomeMapOf(r.outcome_map) });
    for (const e of ev?.data ?? []) if (Array.isArray(e.outcome_ids)) out.evidence.set(e.id, e.outcome_ids);
  } catch { /* before 751: indexes */ }
  return out;
}

/** Assemble requests with their evidence, events and decisions, deriving state and standing as 510 (and 690) does. */
async function assemble(admin: any, reqs: any[], today: string): Promise<RequestView[] | null> {
  if (!reqs.length) return [];
  const ids = reqs.map(r => r.id);
  const [ev, evts, decs, confs, ids751] = await Promise.all([
    admin.from("competency_verification_evidence").select("id, request_id, kind, outcome_indexes, provenance, cpd_id, learning_record_id, evidence_id, profile_item_id, reflection_id, created_at").in("request_id", ids).order("created_at"),
    admin.from("competency_verification_event").select("id, request_id, event, actor_id, assessor_id, appointment_id, decision_id, reason, created_at").in("request_id", ids).order("created_at"),
    withLevel(level => admin.from("competency_verification_decision").select(decCols(level)).in("request_id", ids).order("created_at")),
    confirmationsOf(admin, ids),
    outcomeIdsOf(admin, ids),
  ]);
  if (ev.error || evts.error || decs.error || confs === null) return null;
  const allDecisions = decs.data ?? [];
  const confirmationOf = new Map<string, any>(confs.map((c: any) => [c.decision_id, c]));
  // A decision stands on its own only when no confirmation is required, or it was confirmed. Only those supersede.
  const standsAlone = (d: any) => !d.confirmation_required ? confirmationOf.get(d.id)?.result !== "not_confirmed" : confirmationOf.get(d.id)?.result === "confirmed";
  return reqs.map(r => {
    const evidence = (ev.data ?? []).filter((e: any) => e.request_id === r.id);
    const events = (evts.data ?? []).filter((e: any) => e.request_id === r.id);
    const decisions = allDecisions.filter((d: any) => d.request_id === r.id);
    const revoked = new Map<string, string | null>(events.filter((e: any) => e.event === "revoked").map((e: any) => [e.decision_id as string, e.reason as string | null]));
    const sameCompetencyLater = allDecisions.filter((d: any) => reqs.find(x => x.id === d.request_id)?.competency_id === r.competency_id && d.user_id === r.user_id && standsAlone(d));
    const lastAssign = [...events].reverse().find((e: any) => e.event === "assigned" || e.event === "assignment_declined");
    return {
      id: r.id, userId: r.user_id, competencyId: r.competency_id, competency: r.competency_snapshot ?? null, frameworkVersion: r.framework_version, methodVersionId: r.method_version_id,
      outcomeIndexes: r.outcome_indexes ?? [-1], outcomeIds: ids751.requests.get(r.id)?.ids ?? null, outcomeMap: ids751.requests.get(r.id)?.map ?? null, targetLevelId: r.target_level_id, context: r.context, note: r.note, createdAt: r.created_at,
      requestedBy: r.requested_by ?? null, renewsDecisionId: r.renews_decision_id ?? null,
      state: deriveState(events, decisions, evidence, confs.filter((c: any) => c.request_id === r.id)),
      assignedTo: lastAssign?.event === "assigned" ? { assessorId: lastAssign.assessor_id, appointmentId: lastAssign.appointment_id } : null,
      evidence: evidence.map((e: any) => ({ id: e.id, kind: e.kind, outcomeIndexes: e.outcome_indexes ?? [-1], outcomeIds: ids751.evidence.get(e.id) ?? null, provenance: e.provenance ?? {},
        sourcePresent: isAssessorEvidence(e.kind) || !!(e.cpd_id ?? e.learning_record_id ?? e.evidence_id ?? e.profile_item_id ?? e.reflection_id), addedAt: e.created_at })),
      decisions: decisions.map((d: any) => ({ id: d.id, assessorId: d.assessor_id, appointmentId: d.appointment_id, methodVersionId: d.method_version_id, methodContentHash: d.method_content_hash,
        competencyHash: d.competency_hash, outcomeCode: d.outcome_code, outcomeClass: d.outcome_class, outcomeLabel: d.outcome_label, levelId: d.level_id, criteria: d.criteria_results ?? [],
        checklist: d.checklist_results ?? [], evidenceReviewed: d.evidence_reviewed ?? [], rationale: d.rationale, validFrom: d.valid_from, validUntil: d.valid_until, decidedAt: d.created_at,
        standing: standingOf(d, new Set(revoked.keys()), sameCompetencyLater, today, confirmationOf.get(d.id)?.result ?? null), revokedReason: revoked.get(d.id) ?? null,
        componentResults: componentResultsOf(d.component_results), componentOutcome: componentOutcomeOf(d.component_outcome),
        stage: d.stage_code ? { code: d.stage_code, label: d.stage_label ?? d.stage_code, mappingVersion: d.stage_mapping_version ?? null } : null,
        confirmationRequired: d.confirmation_required === true,
        confirmation: confirmationOf.has(d.id) ? { result: confirmationOf.get(d.id).result, assessorId: confirmationOf.get(d.id).assessor_id ?? null, rationale: confirmationOf.get(d.id).rationale, at: confirmationOf.get(d.id).created_at } : null })),
      events: events.map((e: any) => ({ event: e.event, actorId: e.actor_id, reason: e.reason, decisionId: e.decision_id ?? null, at: e.created_at })),
    };
  });
}

/** Internal assembly of the person's own requests, newest first. Products use listVerifications. null = unreadable. */
export async function loadVerifications(admin: any, userId: string, today = new Date().toISOString().slice(0, 10)): Promise<RequestView[] | null> {
  try {
    const { data, error } = await withLevel(level => admin.from("competency_verification_request").select(reqCols(level)).eq("user_id", userId).order("created_at", { ascending: false }).limit(500));
    if (error) return missing(error) ? [] : null;
    return assemble(admin, data ?? [], today);
  } catch { return null; }
}

export async function verificationsFor(admin: any, userId: string, competencyId: string, today?: string): Promise<RequestView[] | null> {
  const all = await loadVerifications(admin, userId, today);
  return all === null ? null : all.filter(r => r.competencyId === competencyId);
}

// ── THE READ CONTRACT for products (Professional My Competencies, history, Passport; Stage 6 evaluation) ─────────────
//
// listVerifications is the ONE reader a product uses. { provisioned: false } = 510 is not on this environment (say
// "verification not available"), null = it could not be read just now (say so), otherwise the person's own items.
// Read-only. Expiry, revocation and supersession are derived for the day asked, never stored.

export type VerificationDecision = {
  decisionId: string; outcomeCode: string; outcomeLabel: string; outcomeClass: string | null;
  level: { id: string; score: number; label: string } | null;
  assessorName: string | null; authority: string; appointmentId: string | null;
  criteriaVersion: { versionId: string; versionNo: number | null; hash: string | null };
  competencyHash: string | null; rationale: string;
  decidedAt: string; validFrom: string | null; validUntil: string | null;
  standing: Standing; revokedAt: string | null; revokedReason: string | null; supersededBy: string | null;
  /** 680: the per-component results and the consolidated CCHU outcome the database computed. null: no components. */
  components: { results: ComponentResultView[]; outcome: ConsolidatedView } | null;
  /** 690: the stage at decision (published mapping, pinned), and the second assessor's confirmation where required. */
  stage: StageView | null;
  confirmation: { required: boolean; result: "confirmed" | "not_confirmed" | null; at: string | null };
};
export type VerificationItem = {
  requestId: string; status: RequestState;
  competency: { frameworkCompetencyId: string; frameworkId: string | null; frameworkVersion: string | null; code: string | null; title: string; learningOutcomes: string[]; allLearningOutcomes: string[] };
  method: { code: string | null; name: string | null; kind: string | null; versionNo: number | null; criteriaHash: string | null };
  context: string; requestedAt: string;
  evidence: { evidenceId: string; linkId: string | null; kind: AnyEvidenceKind; title: string; evidenceClass: string | null; issuer: string | null; occurredOn: string | null; learningOutcomes: string[]; sourcePresent: boolean; submittedAt: string }[];
  decisions: VerificationDecision[];
  /** The decision that stands today as a verification (verified or partial, not revoked, expired or superseded), or null. */
  current: VerificationDecision | null;
  /** 690: true when a programme lead, not the person, asked for this assessment. */
  requestedByOther: boolean;
  /** 690: what the latest outcome leaves to develop (partial, further evidence, not demonstrated), or null. Offered, never written. */
  developmentNeed: DevelopmentNeed | null;
};
/** Who decides, in words. The Competency Assessor is a Holdings appointment, separate from content review. */
export const ASSESSOR_AUTHORITY = "Competency Assessor, appointed by Competen Holdings";

export async function listVerifications(admin: any, userId: string, opts: { frameworkCompetencyId?: string; today?: string } = {}):
  Promise<{ provisioned: false } | { provisioned: true; items: VerificationItem[] } | null> {
  if (!(await verificationReady(admin))) return { provisioned: false };
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const views = await loadVerifications(admin, userId, today);
  if (views === null) return null;
  const mine = opts.frameworkCompetencyId ? views.filter(v => v.competencyId === opts.frameworkCompetencyId) : views;
  if (!mine.length) return { provisioned: true, items: [] };
  try {
    const versions = await loadVersionsById(admin, [...new Set(mine.map(v => v.methodVersionId))]);
    const decisions = mine.flatMap(v => v.decisions);
    const levelIds = [...new Set(decisions.map(d => d.levelId).filter(Boolean))] as string[];
    const assessorIds = [...new Set(decisions.map(d => d.assessorId).filter(Boolean))] as string[];
    const [lv, ppl, rq, ev, reg] = await Promise.all([
      levelIds.length ? admin.from("scoring_levels").select("id, score, label").in("id", levelIds) : { data: [] },
      assessorIds.length ? admin.from("profiles").select("id, full_name").in("id", assessorIds) : { data: [] },
      admin.from("competency_verification_request").select("id, framework_id").in("id", mine.map(v => v.id)),
      admin.from("competency_verification_evidence").select("id, portfolio_link_id").in("request_id", mine.map(v => v.id)),
      decisions.some(d => d.componentOutcome) ? admin.from("competency_assessment_component").select("code, label") : { data: [] },
    ]);
    const componentLabel = new Map<string, string>((reg.data ?? []).map((c: any) => [c.code, c.label]));
    const level = new Map<string, any>((lv.data ?? []).map((l: any) => [l.id, l]));
    const name = new Map<string, string | null>((ppl.data ?? []).map((p: any) => [p.id, p.full_name ?? null]));
    const fwOf = new Map<string, string | null>((rq.data ?? []).map((r: any) => [r.id, r.framework_id ?? null]));
    const linkOf = new Map<string, string | null>((ev.data ?? []).map((e: any) => [e.id, e.portfolio_link_id ?? null]));
    const sameCompetency = (v: RequestView) => views.filter(x => x.competencyId === v.competencyId).flatMap(x => x.decisions);
    const items = mine.map(v => {
      const snapshot = (v.competency?.learning_outcomes ?? []).map(String);
      // 751: the request's own outcome map is what it asked about, in its order. Before 751, its snapshot.
      const all = v.outcomeMap?.length ? v.outcomeMap.map(m => m.text) : snapshot;
      const words = (idx: number[], ids?: string[] | null) => outcomeTexts(idx, ids, v.outcomeMap, snapshot) ?? [];
      const ver = versions.get(v.methodVersionId);
      const ds: VerificationDecision[] = v.decisions.map(d => {
        const later = sameCompetency(v).filter(x => x.outcomeClass === "verified" && x.decidedAt > d.decidedAt && x.standing !== "awaiting_confirmation" && x.standing !== "not_confirmed").sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))[0];
        const revoked = v.events.find(e => e.event === "revoked" && e.decisionId === d.id);
        const l = d.levelId ? level.get(d.levelId) : null;
        return {
          decisionId: d.id, outcomeCode: d.outcomeCode, outcomeLabel: d.outcomeLabel ?? d.outcomeCode, outcomeClass: d.outcomeClass,
          level: l ? { id: l.id, score: l.score, label: l.label } : null,
          assessorName: d.assessorId ? name.get(d.assessorId) ?? null : null, authority: ASSESSOR_AUTHORITY, appointmentId: d.appointmentId,
          criteriaVersion: { versionId: d.methodVersionId, versionNo: versions.get(d.methodVersionId)?.version_no ?? null, hash: d.methodContentHash },
          competencyHash: d.competencyHash, rationale: d.rationale, decidedAt: d.decidedAt, validFrom: d.validFrom, validUntil: d.validUntil,
          standing: d.standing, revokedAt: revoked?.at ?? null, revokedReason: d.revokedReason, supersededBy: d.standing === "superseded" ? later?.id ?? null : null,
          components: d.componentOutcome ? { results: d.componentResults, outcome: d.componentOutcome } : null,
          stage: d.stage, confirmation: { required: d.confirmationRequired, result: d.confirmation?.result ?? null, at: d.confirmation?.at ?? null },
        };
      });
      return {
        requestId: v.id, status: v.state,
        competency: { frameworkCompetencyId: v.competencyId, frameworkId: fwOf.get(v.id) ?? null, frameworkVersion: v.frameworkVersion, code: v.competency?.code ?? null,
          title: v.competency?.name ?? "", learningOutcomes: words(v.outcomeIndexes, v.outcomeIds), allLearningOutcomes: all },
        method: { code: ver?.method?.code ?? null, name: ver?.method?.name ?? null, kind: ver?.method?.kind ?? null, versionNo: ver?.version_no ?? null, criteriaHash: ver?.content_hash ?? null },
        context: v.context, requestedAt: v.createdAt,
        evidence: v.evidence.map(e => ({
          evidenceId: e.id, linkId: linkOf.get(e.id) ?? null, kind: e.kind, title: String(e.provenance.title ?? e.provenance.template ?? e.kind),
          evidenceClass: e.provenance.evidence_class ?? null, issuer: e.provenance.issuing_body ?? e.provenance.organisation ?? null,
          occurredOn: e.provenance.date ?? e.provenance.completed_at ?? e.provenance.issued_on ?? e.provenance.started_on ?? null,
          learningOutcomes: words(e.outcomeIndexes, e.outcomeIds), sourcePresent: e.sourcePresent, submittedAt: e.addedAt,
        })),
        decisions: ds,
        current: [...ds].reverse().find(d => d.standing === "current") ?? null,
        requestedByOther: !!v.requestedBy && v.requestedBy !== v.userId,
        developmentNeed: developmentNeedsOf({ competencyId: v.competencyId, title: v.competency?.name ?? "", decisions: ds.filter(d => d.standing !== "not_confirmed") }, c => componentLabel.get(c) ?? c),
      };
    });
    return { provisioned: true, items };
  } catch { return null; }
}

/** Pure: the items about one catalogue competency. */
export const verificationsForCompetency = (items: readonly VerificationItem[], frameworkCompetencyId: string) => items.filter(i => i.competency.frameworkCompetencyId === frameworkCompetencyId);

/** For the Studio: every request not withdrawn, newest first. */
export async function loadQueue(admin: any, today = new Date().toISOString().slice(0, 10)): Promise<RequestView[] | null> {
  try {
    const { data, error } = await withLevel(level => admin.from("competency_verification_request").select(reqCols(level)).order("created_at", { ascending: false }).limit(500));
    if (error) return missing(error) ? [] : null;
    return assemble(admin, data ?? [], today);
  } catch { return null; }
}

/** For one assessor: requests assigned to them, and open ones of a self-claim method their scope covers. */
export async function loadAssessorQueue(admin: any, assessorId: string, today = new Date().toISOString().slice(0, 10)): Promise<{ assigned: RequestView[]; claimable: (RequestView & { claimWith: string })[]; appointments: string[] } | null> {
  const all = await loadQueue(admin, today);
  if (all === null) return null;
  const { data: appts } = await admin.from("ogs_office_appointments").select("id").eq("person_id", assessorId).eq("role", "competency_assessor").eq("status", "active");
  const mine = (appts ?? []).map((a: any) => a.id as string);
  const assigned = all.filter(r => r.assignedTo?.assessorId === assessorId && (r.state === "assigned" || r.state === "awaiting_evidence"));
  const open = all.filter(r => r.state === "open" && r.userId !== assessorId);
  const versions = await loadVersionsById(admin, [...new Set(open.map(r => r.methodVersionId))]);
  const claimable: (RequestView & { claimWith: string })[] = [];
  for (const r of open) {
    if (versions.get(r.methodVersionId)?.content?.workflow?.assignment !== "self_claim") continue;
    for (const ap of mine) {
      const { data: covers } = await admin.rpc("competency_assessor_covers", { p_appointment: ap, p_competency: r.competencyId, p_method: versions.get(r.methodVersionId)!.method_id, p_level: r.targetLevelId, p_context: r.context, p_on: today });
      if (covers === true) { claimable.push({ ...r, claimWith: ap }); break; }
    }
  }
  return { assigned, claimable, appointments: mine };
}

export async function loadVersionsById(admin: any, ids: string[]): Promise<Map<string, MethodVersionRow & { method?: { code: string; name: string; kind: string } }>> {
  if (!ids.length) return new Map();
  const { data } = await admin.from("competency_verification_method_version").select("id, method_id, version_no, state, content, content_hash, authored_by, published_by, published_at, retired_at, updated_at, competency_verification_method(code, name, kind)").in("id", ids);
  return new Map((data ?? []).map((v: any) => [v.id, { ...v, method: v.competency_verification_method ?? undefined }]));
}

export type MethodOffer = { versionId: string; methodId: string; code: string; name: string; kind: string; versionNo: number; content: MethodContent };
/**
 * The published methods a person may request for a competency in a context, checked by 510's own predicate.
 * { provisioned: false } = 510 absent, null = unreadable.
 */
export async function verificationMethodsFor(admin: any, competencyId: string, context = "independent"): Promise<{ provisioned: false } | { provisioned: true; methods: MethodOffer[] } | null> {
  try {
    const { data, error } = await admin.from("competency_verification_method_version").select("id, method_id, version_no, content, competency_verification_method(code, name, kind)").eq("state", "published").limit(500);
    if (error) return missing(error) ? { provisioned: false } : null;
    const out = [];
    for (const v of data ?? []) {
      const { data: applies } = await admin.rpc("competency_method_applies", { p_content: v.content, p_competency: competencyId, p_context: context });
      if (applies === true) out.push({ versionId: v.id, methodId: v.method_id, code: v.competency_verification_method?.code ?? "", name: v.competency_verification_method?.name ?? "", kind: v.competency_verification_method?.kind ?? "other", versionNo: v.version_no, content: v.content });
    }
    return { provisioned: true, methods: out };
  } catch { return null; }
}

// ── THE PERSON'S SIDE (called by a product for its own signed-in member) ──────────────────────────────────────────
//
// THE AGREED CONTRACT (Stage 5 portfolio workstream, 25 Oct). The portfolio passes its own CompetencyRef and EvidenceRef
// (from evidenceForVerification). Only identifiers and the outcome WORDS are used: what an assessor reviews is 510's
// snapshot of the source record, never a title, class or date the caller sent. A learning outcome is named by its words
// (null = the whole competency) and resolved to the competency's current outcomes when submitted.
//
// ⚠ PRIVATE REFLECTIONS STAY PRIVATE UNLESS DELIBERATELY SHARED (owner, GO s11). A reflection reaches a request ONLY when
// the person ticks THAT reflection for THAT request (the portfolio's per-request checkbox, evidenceForVerification's
// explicitReflectionLinkIds). Never by default, never automatically, never carried to another request. Once submitted it
// is snapshotted with the request and shown only to the assessor assigned to it.

/** The portfolio's competency reference. Only catalogue-backed competencies can be verified. */
export type CompetencyRef = { frameworkId?: string; frameworkCompetencyId: string; frameworkVersion?: string | null; title?: string; learningOutcomes?: string[] };
/** One piece of evidence: the portfolio's EvidenceRef, or { kind, id }. Descriptive fields are ignored. */
export type EvidenceRef = { kind: EvidenceKind; id?: string; sourceId?: string; linkId?: string; learningOutcome?: string | null; outcomeIndexes?: number[] };
type Resolved = { kind: EvidenceKind; id: string; linkId?: string; outcomeIndexes: number[] };

const KINDS: readonly string[] = ["cpd", "learning_record", "evidence", "profile_item", "reflection", "study_achievement"];
/** The outcome words, as the competency now has them, to indexes. -1 is the whole competency. */
function outcomeIndex(text: unknown, outcomes: readonly string[]): number | null {
  if (text === null || text === undefined || text === "") return -1;
  const i = outcomes.findIndex(o => String(o).trim() === String(text).trim());
  return i >= 0 ? i : null;
}
function resolveRefs(v: unknown, outcomes: readonly string[]): Resolved[] | string {
  if (!Array.isArray(v) || v.length > 50) return "Choose up to 50 of your own records as evidence.";
  const out: Resolved[] = [];
  for (const e of v as any[]) {
    const id = e?.id ?? e?.sourceId;
    if (!KINDS.includes(e?.kind) || !UUID.test(String(id ?? ""))) return "Each piece of evidence names one of your own records.";
    let idx: number[];
    if (Array.isArray(e.outcomeIndexes)) idx = e.outcomeIndexes.filter((n: unknown) => Number.isInteger(n) && (n as number) >= -1).slice(0, 200);
    else {
      const i = outcomeIndex(e.learningOutcome, outcomes);
      if (i === null) return `"${String(e.learningOutcome).slice(0, 80)}" is not a learning outcome of this competency now.`;
      idx = [i];
    }
    out.push({ kind: e.kind, id, ...(UUID.test(String(e?.linkId ?? "")) ? { linkId: e.linkId } : {}), outcomeIndexes: idx.length ? idx : [-1] });
  }
  return out;
}

/** The competency as it is now: its outcomes and its framework version. null = not a competency. */
async function currentCompetency(admin: any, competencyId: string): Promise<{ outcomes: string[]; frameworkVersion: string | null } | null> {
  const { data } = await admin.from("framework_competencies").select("learning_outcomes, framework_domains!inner(frameworks!inner(version_major, version_minor, version_revision))").eq("id", competencyId).maybeSingle();
  if (!data) return null;
  const dom = Array.isArray(data.framework_domains) ? data.framework_domains[0] : data.framework_domains;
  const fw = Array.isArray(dom?.frameworks) ? dom.frameworks[0] : dom?.frameworks;
  // The governed major.minor.revision (012), composed exactly as the catalogue shows it (competency/foundation.ts).
  return { outcomes: (data.learning_outcomes ?? []).map(String), frameworkVersion: fw ? `${fw.version_major ?? 1}.${fw.version_minor ?? 0}.${fw.version_revision ?? 0}` : null };
}

/** The published version of a method, by its code. */
async function versionForCode(admin: any, code: string): Promise<string | null> {
  const { data } = await admin.from("competency_verification_method_version").select("id, competency_verification_method!inner(code)").eq("state", "published").eq("competency_verification_method.code", code).limit(1);
  return data?.[0]?.id ?? null;
}

export async function requestVerification(admin: any, userId: string, b: {
  competency?: CompetencyRef; competencyId?: unknown; methodVersionId?: unknown; methodCode?: unknown; learningOutcomes?: unknown; outcomeIndexes?: unknown;
  targetLevelId?: unknown; context?: unknown; note?: unknown; renewsDecisionId?: unknown; evidence?: unknown;
}): Promise<Write<{ requestId: string }>> {
  if (!(await verificationReady(admin))) return NOT_PROVISIONED;
  const competencyId = String(b.competency?.frameworkCompetencyId ?? b.competencyId ?? "");
  if (!UUID.test(competencyId)) return { ok: false, status: 400, error: "Only a competency from a published catalogue can be verified. Choose one." };
  const current = await currentCompetency(admin, competencyId);
  if (!current) return { ok: false, status: 404, error: "That competency is not in the catalogue." };
  // The portfolio may show a version as "v1.2.0". The comparison is of the version itself.
  const asked = typeof b.competency?.frameworkVersion === "string" ? b.competency.frameworkVersion.trim().replace(/^v/i, "") : "";
  if (asked && current.frameworkVersion && asked !== current.frameworkVersion)
    return { ok: false, status: 409, error: `This competency is now in framework version ${current.frameworkVersion}. Review it as it is now, then ask again.` };
  const methodVersionId = UUID.test(String(b.methodVersionId ?? "")) ? String(b.methodVersionId) : typeof b.methodCode === "string" ? await versionForCode(admin, b.methodCode) : null;
  if (!methodVersionId) return { ok: false, status: 400, error: "Choose how the competency is to be assessed." };
  const outcomes: number[] = [];
  if (Array.isArray(b.outcomeIndexes)) outcomes.push(...b.outcomeIndexes.filter((n: unknown) => Number.isInteger(n) && (n as number) >= -1).slice(0, 200));
  else if (Array.isArray(b.learningOutcomes)) {
    for (const t of b.learningOutcomes.slice(0, 200)) {
      const i = outcomeIndex(t, current.outcomes);
      if (i === null) return { ok: false, status: 409, error: `"${String(t).slice(0, 80)}" is not a learning outcome of this competency now.` };
      outcomes.push(i);
    }
  }
  const refs = resolveRefs(b.evidence ?? [], current.outcomes);
  if (typeof refs === "string") return { ok: false, status: 400, error: refs };
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 2000) : null;
  const context = typeof b.context === "string" && /^[a-z][a-z0-9_]{1,40}$/.test(b.context) ? b.context : "independent";
  const { data, error } = await admin.rpc("competency_verification_submit", {
    p_user: userId, p_competency: competencyId, p_method_version: methodVersionId, p_outcomes: outcomes.length ? [...new Set(outcomes)] : [-1],
    p_target_level: UUID.test(String(b.targetLevelId ?? "")) ? b.targetLevelId : null, p_context: context, p_note: note,
    p_renews: UUID.test(String(b.renewsDecisionId ?? "")) ? b.renewsDecisionId : null, p_evidence: refs,
  });
  return error || !data ? refusalOf(error, "request") : { ok: true, requestId: data as string };
}

/** Further evidence on an open request, or one where the assessor asked for more. */
export async function addRequestEvidence(admin: any, userId: string, requestId: string, evidence: unknown): Promise<Write<{ added: number }>> {
  if (!(await verificationReady(admin))) return NOT_PROVISIONED;
  if (!UUID.test(requestId)) return { ok: false, status: 400, error: "Choose the request." };
  const { data: req } = await admin.from("competency_verification_request").select("competency_snapshot").eq("id", requestId).eq("user_id", userId).maybeSingle();
  if (!req) return { ok: false, status: 404, error: "That request is not yours." };
  const refs = resolveRefs(evidence, (req.competency_snapshot?.learning_outcomes ?? []).map(String));
  if (typeof refs === "string" || !refs.length) return { ok: false, status: 400, error: typeof refs === "string" ? refs : "Choose at least one of your own records." };
  const { data, error } = await admin.rpc("competency_verification_add_evidence", { p_user: userId, p_request: requestId, p_evidence: refs });
  return error ? refusalOf(error, "evidence") : { ok: true, added: Number(data ?? 0) };
}

export async function withdrawRequest(admin: any, userId: string, requestId: string, reason?: unknown): Promise<Write> {
  if (!UUID.test(requestId)) return { ok: false, status: 400, error: "Choose a request." };
  const r = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 1000) : null;
  const { error } = await admin.from("competency_verification_event").insert({ request_id: requestId, user_id: userId, event: "withdrawn", actor_id: userId, reason: r });
  return error ? refusalOf(error, "withdrawal") : { ok: true };
}

// ── ASSIGNMENT, DECISION, REVOCATION ──────────────────────────────────────────────────────────────────────────────

async function requestOwner(admin: any, requestId: string): Promise<string | null> {
  if (!UUID.test(requestId)) return null;
  const { data } = await admin.from("competency_verification_request").select("user_id").eq("id", requestId).maybeSingle();
  return data?.user_id ?? null;
}

/** An administrator assigns an assessor appointment, or an assessor claims a self-claim request (actor = the assessor). */
export async function assignRequest(admin: any, actor: string, requestId: string, appointmentId: string): Promise<Write> {
  const user = await requestOwner(admin, requestId);
  if (!user || !UUID.test(appointmentId)) return { ok: false, status: 404, error: "Choose the request and the assessor." };
  const { data: ap } = await admin.from("ogs_office_appointments").select("person_id").eq("id", appointmentId).maybeSingle();
  if (!ap) return { ok: false, status: 404, error: "No such assessor appointment." };
  const { error } = await admin.from("competency_verification_event").insert({ request_id: requestId, user_id: user, event: "assigned", actor_id: actor, assessor_id: ap.person_id, appointment_id: appointmentId });
  return error ? refusalOf(error, "assignment") : { ok: true };
}

export async function declineAssignment(admin: any, actor: string, requestId: string, reason: unknown): Promise<Write> {
  const user = await requestOwner(admin, requestId);
  const r = typeof reason === "string" ? reason.trim().slice(0, 1000) : "";
  if (!user || r.length < 3) return { ok: false, status: 400, error: "Say why the assignment is declined." };
  const { error } = await admin.from("competency_verification_event").insert({ request_id: requestId, user_id: user, event: "assignment_declined", actor_id: actor, reason: r });
  return error ? refusalOf(error, "decline") : { ok: true };
}

export async function recordDecision(admin: any, assessorId: string, requestId: string, input: unknown): Promise<Write<{ decisionId: string }>> {
  const { data: req } = await admin.from("competency_verification_request").select("id, user_id, method_version_id, target_level_id").eq("id", requestId).maybeSingle();
  if (!req) return { ok: false, status: 404, error: "No such request." };
  if (req.user_id === assessorId) return { ok: false, status: 403, error: "No self-verification. You can never decide your own request." };
  const a = await assignedTo(admin, requestId);
  if (a?.event !== "assigned" || a.assessor_id !== assessorId) return { ok: false, status: 403, error: "Only the assessor assigned to this request decides it." };
  const { data: v } = await admin.from("competency_verification_method_version").select("content").eq("id", req.method_version_id).maybeSingle();
  const { data: ev } = await admin.from("competency_verification_evidence").select("id").eq("request_id", requestId);
  const content = { ...({ components: [] } as Partial<MethodContent>), ...(v?.content ?? {}) } as MethodContent;
  const levels = content.components?.length ? await scaleLevels(admin, content.scaleId) : [];
  const c = checkDecision(input, content, (ev ?? []).map((e: any) => e.id), { levels, requestTargetLevelId: req.target_level_id ?? null });
  if (!c.ok) return { ok: false, status: 400, error: c.error };
  // 680 computes and stores the consolidated outcome itself. Only the component levels are sent, and only where the method has components.
  const { data, error } = await admin.from("competency_verification_decision").insert({
    request_id: requestId, user_id: req.user_id, assessor_id: assessorId, appointment_id: a.appointment_id, method_version_id: req.method_version_id,
    outcome_code: c.value.outcomeCode, level_id: c.value.levelId, rationale: c.value.rationale, criteria_results: c.value.criteria, checklist_results: c.value.checklist, evidence_reviewed: c.value.evidenceReviewed,
    ...(content.components?.length ? { component_results: c.value.componentResults } : {}),
  }).select("id").single();
  return error || !data ? refusalOf(error, "decision") : { ok: true, decisionId: data.id };
}

async function assignedTo(admin: any, requestId: string): Promise<{ assessor_id: string; appointment_id: string; event: string } | null> {
  const { data } = await admin.from("competency_verification_event").select("assessor_id, appointment_id, event").eq("request_id", requestId).in("event", ["assigned", "assignment_declined"]).order("created_at", { ascending: false }).limit(1);
  return data?.[0] ?? null;
}

/** The levels of one proficiency scale, with their scores. */
export async function scaleLevels(admin: any, scaleId: string | null | undefined): Promise<ScaleLevel[]> {
  if (!scaleId || !UUID.test(scaleId)) return [];
  const { data } = await admin.from("scoring_levels").select("id, scale_id, score, label").eq("scale_id", scaleId).order("score");
  return (data ?? []).map((l: any) => ({ id: l.id, scaleId: l.scale_id, score: Number(l.score), label: l.label ?? "" }));
}

/**
 * 680: an assessor observation or exam result, by the ASSIGNED assessor, under their appointment and the method version of
 * the request. The database checks all of it again, snapshots it into provenance and refuses it on their own request.
 */
export async function recordAssessorEvidence(admin: any, assessorId: string, requestId: string, input: unknown, today = new Date().toISOString().slice(0, 10)): Promise<Write<{ evidenceId: string }>> {
  const { data: req } = await admin.from("competency_verification_request").select("id, user_id, method_version_id").eq("id", requestId).maybeSingle();
  if (!req) return { ok: false, status: 404, error: "No such request." };
  if (req.user_id === assessorId) return { ok: false, status: 403, error: "No self-verification. You can never record assessor evidence on your own request." };
  const a = await assignedTo(admin, requestId);
  if (a?.event !== "assigned" || a.assessor_id !== assessorId) return { ok: false, status: 403, error: "Only the assessor assigned to this request records assessor evidence." };
  const { data: v } = await admin.from("competency_verification_method_version").select("content").eq("id", req.method_version_id).maybeSingle();
  const c = checkAssessorRecord(input, { components: (v?.content as MethodContent | undefined)?.components ?? [] }, today);
  if (!c.ok) return { ok: false, status: 400, error: c.error };
  const { data, error } = await admin.from("competency_verification_evidence").insert({
    request_id: requestId, user_id: req.user_id, kind: c.value.kind, recorded_by: assessorId, appointment_id: a.appointment_id, method_version_id: req.method_version_id, assessor_record: c.value.record,
  }).select("id").single();
  if (error && missing(error)) return NOT_PROVISIONED;
  return error || !data ? refusalOf(error, "evidence") : { ok: true, evidenceId: data.id };
}

export async function revokeDecision(admin: any, actor: string, decisionId: string, reason: unknown): Promise<Write> {
  const r = typeof reason === "string" ? reason.trim().slice(0, 1000) : "";
  if (!UUID.test(decisionId) || r.length < 3) return { ok: false, status: 400, error: "Choose the outcome and say why it is revoked. The person will see the reason." };
  const { data: d } = await admin.from("competency_verification_decision").select("request_id, user_id").eq("id", decisionId).maybeSingle();
  if (!d) return { ok: false, status: 404, error: "No such outcome." };
  const { error } = await admin.from("competency_verification_event").insert({ request_id: d.request_id, user_id: d.user_id, event: "revoked", actor_id: actor, decision_id: decisionId, reason: r });
  return error ? refusalOf(error, "revocation") : { ok: true };
}

/**
 * The storage path of a document the person attached to submitted evidence, for the assessor ASSIGNED to that request
 * only. The path is the one snapshotted at submission. Signing it is Professional's (its documents module owns the
 * private bucket, individual-professional-harness R4), so the route signs what this authorises.
 */
export async function evidenceDocumentPath(admin: any, assessorId: string, evidenceId: string): Promise<Write<{ path: string }>> {
  if (!UUID.test(evidenceId)) return { ok: false, status: 400, error: "Choose the evidence." };
  const { data: e } = await admin.from("competency_verification_evidence").select("request_id, provenance").eq("id", evidenceId).maybeSingle();
  const path = e?.provenance?.document_path;
  if (!e || typeof path !== "string") return { ok: false, status: 404, error: "That evidence has no document." };
  const { data: assign } = await admin.from("competency_verification_event").select("assessor_id, event").eq("request_id", e.request_id).in("event", ["assigned", "assignment_declined"]).order("created_at", { ascending: false }).limit(1);
  if (assign?.[0]?.event !== "assigned" || assign[0].assessor_id !== assessorId) return { ok: false, status: 403, error: "Only the assessor assigned to this request can open its documents." };
  return { ok: true, path };
}

// ── 690: CCHU ASSESSMENT OPERATIONS ───────────────────────────────────────────────────────────────────────────────
//
// Every write below is re-checked by migration 690's triggers, beside 510 and 680: clinical approval of the exact method
// content before publication and before any verification, criteria pinned to the competency, requests by a programme
// lead only with hq.competency.verification.request, drafts only by the assigned assessor, and a second assessor who is
// neither the person nor the first assessor.

const NOT_690 = { ok: false as const, status: 409, error: "This part of competency assessment is not set up on this environment yet (migration 690)." };

/**
 * A method draft made from one competency's criteria, exactly as the competency has them (690 pins each one). Only from
 * a competency whose current content is clinically approved, so the method starts from approved criteria. The draft
 * then goes through clinical review and independent publication like any other.
 */
export async function generateMethodFromCompetency(admin: any, actor: string, b: { competencyId?: unknown; code?: unknown; name?: unknown; kind?: unknown; scaleId?: unknown; entryId?: unknown },
  clinicalState: (admin: any, id: string) => Promise<string | null>): Promise<Write<{ methodId: string; versionId: string; problems: string[] }>> {
  const competencyId = String(b.competencyId ?? "");
  if (!UUID.test(competencyId)) return { ok: false, status: 400, error: "Choose the competency." };
  const { data: comp } = await admin.from("framework_competencies").select("id, name, framework_domains!inner(frameworks!inner(hospital_id))").eq("id", competencyId).maybeSingle();
  if (!comp) return { ok: false, status: 404, error: "That competency is not in the catalogue." };
  const dom = Array.isArray(comp.framework_domains) ? comp.framework_domains[0] : comp.framework_domains;
  const fw = Array.isArray(dom?.frameworks) ? dom.frameworks[0] : dom?.frameworks;
  if (fw?.hospital_id) return { ok: false, status: 409, error: "Only a competency of a shared framework is assessed here." };
  if ((await clinicalState(admin, competencyId)) !== "approved") return { ok: false, status: 409, error: "Its criteria are not clinically approved at their current version. A method is made only from approved criteria." };
  const { data: skills, error: sErr } = await admin.from("competency_skills").select("id, name, component_code, source_ref, sort_order").eq("competency_id", competencyId).order("sort_order").limit(200);
  if (sErr) return refusalOf(sErr, "criteria");
  let configured: SourceComponent[] = [];
  if (UUID.test(String(b.entryId ?? ""))) {
    const { data: ec } = await admin.from("competency_catalogue_entry_component").select("component_code, pass_level_id, is_mandatory, is_safety_critical, weight, sort_order").eq("entry_id", b.entryId).order("sort_order");
    configured = (ec ?? []).map((k: any) => ({ code: k.component_code, passLevelId: k.pass_level_id ?? null, mandatory: k.is_mandatory !== false, safetyCritical: k.is_safety_critical === true, weight: k.weight === null || k.weight === undefined ? null : Number(k.weight) }));
  }
  const made = methodDraftFromCompetency({ id: comp.id, name: comp.name }, (skills ?? []).map((k: any) => ({ id: k.id, name: k.name, componentCode: k.component_code ?? null, sourceRef: k.source_ref ?? null })),
    configured, UUID.test(String(b.scaleId ?? "")) ? String(b.scaleId) : null);
  if (!made.ok) return { ok: false, status: 400, error: made.error };
  const m = await createMethod(admin, actor, { code: b.code, name: b.name ?? comp.name, kind: b.kind ?? "structured_assessment" });
  if (!m.ok) return m;
  const s = await saveDraft(admin, actor, m.versionId, made.content);
  if (!s.ok) return s;
  return { ok: true, methodId: m.methodId, versionId: m.versionId, problems: [...new Set([...made.problems, ...s.problems])] };
}

/** Put a draft method version forward for clinical review (690, on the one clinical-approval process). */
export async function submitMethodForReview(admin: any, actor: string, versionId: string): Promise<Write<{ reviewVersionId: string }>> {
  if (!UUID.test(versionId)) return { ok: false, status: 400, error: "Choose a version." };
  const { data, error } = await admin.rpc("competency_method_submit_review", { p_version: versionId, p_submitter: actor });
  if (error && missing(error)) return NOT_690;
  if (error) {
    const m = String(error.message ?? "").replace(/^(competency_method_submit_review|clinical_content_version): /, "");
    return { ok: false, status: /not authorised/i.test(m) ? 403 : 409, error: m.replace(/^./, c => c.toUpperCase()) + (/\.$/.test(m) ? "" : ".") };
  }
  return { ok: true, reviewVersionId: data as string };
}

export type MethodReview = { state: "not_submitted" | "in_review" | "approved" | "changes_requested" | "changed_since"; approvals: number; required: number; submittedAt: string | null; comment: string | null };
export const METHOD_REVIEW_LABEL: Record<MethodReview["state"], string> = {
  not_submitted: "Not yet put forward for clinical review", in_review: "In clinical review", approved: "Clinically approved",
  changes_requested: "Clinical reviewer asked for changes", changed_since: "Edited since it was put forward: put it forward again",
};

/**
 * Pure: the clinical review state of one method version, from its review records and their decisions. A draft edited
 * after it was put forward is "changed_since": that review no longer applies to it (the database compares the exact hash).
 */
export function methodReviewOf(v: { state: string; content_hash: string | null; updated_at: string }, records: readonly { id: string; content_hash: string; required_approvals: number; created_at: string }[],
  decisions: readonly { version_id: string; decision: string; comment: string | null }[]): MethodReview {
  const r = [...records].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!r) return { state: "not_submitted", approvals: 0, required: 1, submittedAt: null, comment: null };
  const ds = decisions.filter(d => d.version_id === r.id);
  const approvals = ds.filter(d => d.decision === "approved").length;
  const rejected = ds.find(d => d.decision === "rejected");
  const base = { approvals, required: r.required_approvals, submittedAt: r.created_at, comment: rejected?.comment ?? null };
  if (v.state === "draft" ? v.updated_at > r.created_at : v.content_hash !== r.content_hash) return { ...base, state: "changed_since" };
  if (rejected) return { ...base, state: "changes_requested" };
  return { ...base, state: approvals >= r.required_approvals ? "approved" : "in_review" };
}

/** The clinical review state of each method version. Empty before 690. */
export async function loadMethodReviews(admin: any, versions: readonly Pick<MethodVersionRow, "id" | "state" | "content_hash" | "updated_at">[]): Promise<Map<string, MethodReview>> {
  const out = new Map<string, MethodReview>();
  if (!versions.length) return out;
  const { data: recs, error } = await admin.from("clinical_content_version").select("id, method_version_id, content_hash, required_approvals, created_at").eq("content_kind", "method").in("method_version_id", versions.map(v => v.id));
  if (error) return out;
  const { data: decs } = (recs ?? []).length ? await admin.from("clinical_review_decision").select("version_id, decision, comment").in("version_id", (recs ?? []).map((r: any) => r.id)) : { data: [] };
  for (const v of versions) out.set(v.id, methodReviewOf(v, (recs ?? []).filter((r: any) => r.method_version_id === v.id), decs ?? []));
  return out;
}

/**
 * A programme lead asks for an assessment for an eligible person (690 requested_by, needing
 * hq.competency.verification.request). Eligible: an account confirmed as a real person, never the lead themself (their
 * own request is made from their own competencies). The person adds the evidence and may withdraw.
 */
export async function requestAssessmentFor(admin: any, actor: string, b: { userId?: unknown; competencyId?: unknown; methodVersionId?: unknown; targetLevelId?: unknown;
  context?: unknown; note?: unknown; renewsDecisionId?: unknown }, isEligible: (admin: any, userId: string) => Promise<boolean>): Promise<Write<{ requestId: string }>> {
  if (!(await verificationReady(admin))) return NOT_PROVISIONED;
  const userId = String(b.userId ?? ""), competencyId = String(b.competencyId ?? ""), methodVersionId = String(b.methodVersionId ?? "");
  if (!UUID.test(userId)) return { ok: false, status: 400, error: "Choose the person to be assessed." };
  if (userId === actor) return { ok: false, status: 400, error: "Ask for your own assessment from your own competencies, not here." };
  if (!UUID.test(competencyId) || !UUID.test(methodVersionId)) return { ok: false, status: 400, error: "Choose the competency and the assessment method." };
  if (!(await isEligible(admin, userId))) return { ok: false, status: 409, error: "Only a person whose account is confirmed as a real person can be put forward for assessment." };
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 2000) : null;
  const context = typeof b.context === "string" && /^[a-z][a-z0-9_]{1,40}$/.test(b.context) ? b.context : "independent";
  const { data, error } = await admin.from("competency_verification_request").insert({
    user_id: userId, competency_id: competencyId, method_version_id: methodVersionId, requested_by: actor, context, note,
    target_level_id: UUID.test(String(b.targetLevelId ?? "")) ? b.targetLevelId : null, renews_decision_id: UUID.test(String(b.renewsDecisionId ?? "")) ? b.renewsDecisionId : null,
  }).select("id").single();
  if (error && missing(error)) return NOT_690;
  return error || !data ? refusalOf(error, "request") : { ok: true, requestId: data.id };
}

/** The requests a programme lead raised, newest first. Empty before 690. */
export async function loadRequestsBy(admin: any, actor: string, today = new Date().toISOString().slice(0, 10)): Promise<RequestView[] | null> {
  try {
    const { data, error } = await admin.from("competency_verification_request").select(reqCols(690)).eq("requested_by", actor).order("created_at", { ascending: false }).limit(200);
    if (error) return missing(error) ? [] : null;
    return assemble(admin, data ?? [], today);
  } catch { return null; }
}

/** The assigned assessor's working draft of a decision, or null. */
export async function loadDecisionDraft(admin: any, assessorId: string, requestId: string): Promise<{ content: DecisionDraft; updatedAt: string } | null> {
  if (!UUID.test(requestId)) return null;
  const { data, error } = await admin.from("competency_verification_decision_draft").select("content, updated_at").eq("request_id", requestId).eq("assessor_id", assessorId).maybeSingle();
  return error || !data ? null : { content: cleanDraft(data.content ?? {}), updatedAt: data.updated_at };
}

/** Save the working draft, for this assessor on any device. Only while the request is with them (690 checks). */
export async function saveDecisionDraft(admin: any, assessorId: string, requestId: string, input: unknown): Promise<Write<{ savedAt: string }>> {
  if (!UUID.test(requestId)) return { ok: false, status: 400, error: "Choose a request." };
  const a = await assignedTo(admin, requestId);
  if (a?.event !== "assigned" || a.assessor_id !== assessorId) return { ok: false, status: 403, error: "Only the assessor assigned to this request keeps a draft of it." };
  const { data, error } = await admin.from("competency_verification_decision_draft")
    .upsert({ request_id: requestId, assessor_id: assessorId, appointment_id: a.appointment_id, content: cleanDraft(input) }, { onConflict: "request_id,assessor_id" })
    .select("updated_at").single();
  if (error && missing(error)) return NOT_690;
  return error || !data ? refusalOf(error, "draft") : { ok: true, savedAt: data.updated_at };
}

/** For a second assessor: decisions awaiting confirmation they may confirm (not theirs, not on their own request, in scope). */
export async function loadConfirmationQueue(admin: any, assessorId: string, today = new Date().toISOString().slice(0, 10)): Promise<(RequestView & { decisionId: string; confirmWith: string })[] | null> {
  const all = await loadQueue(admin, today);
  if (all === null) return null;
  const waiting = all.filter(r => r.state === "awaiting_confirmation" && r.userId !== assessorId);
  if (!waiting.length) return [];
  const { data: appts } = await admin.from("ogs_office_appointments").select("id").eq("person_id", assessorId).eq("role", "competency_assessor").eq("status", "active");
  const versions = await loadVersionsById(admin, [...new Set(waiting.map(r => r.methodVersionId))]);
  const out: (RequestView & { decisionId: string; confirmWith: string })[] = [];
  for (const r of waiting) {
    const d = [...r.decisions].reverse().find(x => x.confirmationRequired && !x.confirmation);
    if (!d || d.assessorId === assessorId) continue;
    for (const ap of (appts ?? []).map((x: any) => x.id as string)) {
      const { data: covers } = await admin.rpc("competency_assessor_covers", { p_appointment: ap, p_competency: r.competencyId, p_method: versions.get(r.methodVersionId)?.method_id, p_level: d.levelId ?? r.targetLevelId, p_context: r.context, p_on: today });
      if (covers === true) { out.push({ ...r, decisionId: d.id, confirmWith: ap }); break; }
    }
  }
  return out;
}

/** A second assessor confirms, or does not confirm, a decision awaiting confirmation (690). */
export async function confirmDecision(admin: any, assessorId: string, b: { decisionId?: unknown; appointmentId?: unknown; result?: unknown; rationale?: unknown }): Promise<Write> {
  const decisionId = String(b.decisionId ?? ""), appointmentId = String(b.appointmentId ?? "");
  if (!UUID.test(decisionId) || !UUID.test(appointmentId)) return { ok: false, status: 400, error: "Choose the decision and your assessor appointment." };
  if (b.result !== "confirmed" && b.result !== "not_confirmed") return { ok: false, status: 400, error: "Confirm the outcome, or say it is not confirmed." };
  const rationale = typeof b.rationale === "string" ? b.rationale.trim().slice(0, 2000) : "";
  if (rationale.length < 10) return { ok: false, status: 400, error: "Give your reasons, in at least 10 characters." };
  const { data: d } = await admin.from("competency_verification_decision").select("request_id, user_id, assessor_id").eq("id", decisionId).maybeSingle();
  if (!d) return { ok: false, status: 404, error: "No such decision." };
  if (d.user_id === assessorId || d.assessor_id === assessorId) return { ok: false, status: 403, error: "Not independent. The second assessor is neither the person nor the first assessor." };
  const { error } = await admin.from("competency_verification_confirmation").insert({ decision_id: decisionId, request_id: d.request_id, user_id: d.user_id, assessor_id: assessorId, appointment_id: appointmentId, result: b.result, rationale });
  if (error && missing(error)) return NOT_690;
  return error ? refusalOf(error, "confirmation") : { ok: true };
}

/** Pure: verifications whose validity ends within `days`, or has ended, soonest first, unless a later request renews them. */
export function renewalsDue(items: readonly VerificationItem[], today: string, days = 90, renewed: ReadonlySet<string> = new Set()): { item: VerificationItem; decision: VerificationDecision; daysLeft: number }[] {
  const t = Date.parse(`${today}T00:00:00Z`);
  const out: { item: VerificationItem; decision: VerificationDecision; daysLeft: number }[] = [];
  const newest = new Map<string, VerificationItem>();
  for (const i of items) { const k = i.competency.frameworkCompetencyId, p = newest.get(k); if (!p || i.requestedAt > p.requestedAt) newest.set(k, i); }
  for (const item of items) {
    const d = item.current ?? [...item.decisions].reverse().find(x => x.standing === "expired" && x.outcomeClass === "verified") ?? null;
    if (!d?.validUntil || d.outcomeClass !== "verified" || renewed.has(d.decisionId)) continue;
    // Only the newest request about the competency can be due: an older one has been assessed again since.
    if (newest.get(item.competency.frameworkCompetencyId) !== item) continue;
    const left = Math.round((Date.parse(`${d.validUntil}T00:00:00Z`) - t) / 86400000);
    if (left <= days) out.push({ item, decision: d, daysLeft: left });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}
