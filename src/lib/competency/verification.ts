/* eslint-disable @typescript-eslint/no-explicit-any */
import { checkDecision, checkMethodContent, deriveState, standingOf, type MethodContent, type RequestState, type Standing, type EvidenceKind } from "./verification-config";

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

/** Whether 510 is on this environment. A zero-row read, never HEAD. */
export async function verificationReady(admin: any): Promise<boolean> {
  try { const { error } = await admin.from("competency_verification_method_version").select("id").limit(0); return !error; } catch { return false; }
}

// ── THE STUDIO (manage) ───────────────────────────────────────────────────────────────────────────────────────────

export type MethodVersionRow = { id: string; method_id: string; version_no: number; state: "draft" | "published" | "retired"; content: MethodContent; content_hash: string | null;
  authored_by: string | null; published_by: string | null; published_at: string | null; retired_at: string | null; updated_at: string };
export type MethodRow = { id: string; code: string; name: string; kind: string; created_at: string; versions: MethodVersionRow[] };

export async function loadMethods(admin: any): Promise<MethodRow[] | null> {
  try {
    const [m, v] = await Promise.all([
      admin.from("competency_verification_method").select("id, code, name, kind, created_at").order("name").limit(500),
      admin.from("competency_verification_method_version").select("id, method_id, version_no, state, content, content_hash, authored_by, published_by, published_at, retired_at, updated_at").order("version_no", { ascending: false }).limit(5000),
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

export async function saveDraft(admin: any, versionId: string, input: unknown): Promise<Write<{ problems: string[] }>> {
  if (!UUID.test(versionId)) return { ok: false, status: 400, error: "Choose a version." };
  const c = checkMethodContent(input);
  if (!c.ok) return { ok: false, status: 400, error: c.error };
  const { data, error } = await admin.from("competency_verification_method_version").update({ content: c.content }).eq("id", versionId).eq("state", "draft").select("id").maybeSingle();
  if (error) return refusalOf(error, "draft");
  return data ? { ok: true, problems: c.problems } : { ok: false, status: 409, error: "Only a draft is edited. Published criteria never change: make a new version." };
}

export async function publishVersion(admin: any, actor: string, versionId: string): Promise<Write> {
  const { data: v } = await admin.from("competency_verification_method_version").select("content, state").eq("id", versionId).maybeSingle();
  if (!v) return { ok: false, status: 404, error: "No such version." };
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

export type EvidenceView = { id: string; kind: EvidenceKind; outcomeIndexes: number[]; provenance: Record<string, any>; sourcePresent: boolean; addedAt: string };
export type DecisionView = { id: string; assessorId: string | null; appointmentId: string | null; methodVersionId: string; methodContentHash: string | null; competencyHash: string | null;
  outcomeCode: string; outcomeClass: string | null; outcomeLabel: string | null; levelId: string | null; criteria: any[]; checklist: any[]; evidenceReviewed: string[];
  rationale: string; validFrom: string | null; validUntil: string | null; decidedAt: string; standing: Standing; revokedReason: string | null };
export type RequestView = { id: string; userId: string; competencyId: string; competency: { name: string; code: string | null; learning_outcomes: string[] } | null;
  frameworkVersion: string | null; methodVersionId: string; outcomeIndexes: number[]; targetLevelId: string | null; context: string; note: string | null; createdAt: string;
  state: RequestState; assignedTo: { assessorId: string; appointmentId: string } | null; evidence: EvidenceView[]; decisions: DecisionView[];
  events: { event: string; actorId: string | null; reason: string | null; decisionId: string | null; at: string }[] };

const REQ_COLS = "id, user_id, competency_id, method_version_id, outcome_indexes, target_level_id, context, note, competency_snapshot, framework_version, created_at";

/** Assemble requests with their evidence, events and decisions, deriving state and standing as 510 does. */
async function assemble(admin: any, reqs: any[], today: string): Promise<RequestView[] | null> {
  if (!reqs.length) return [];
  const ids = reqs.map(r => r.id);
  const [ev, evts, decs] = await Promise.all([
    admin.from("competency_verification_evidence").select("id, request_id, kind, outcome_indexes, provenance, cpd_id, learning_record_id, evidence_id, profile_item_id, reflection_id, created_at").in("request_id", ids).order("created_at"),
    admin.from("competency_verification_event").select("id, request_id, event, actor_id, assessor_id, appointment_id, decision_id, reason, created_at").in("request_id", ids).order("created_at"),
    admin.from("competency_verification_decision").select("id, request_id, user_id, assessor_id, appointment_id, method_version_id, method_content_hash, competency_hash, outcome_code, outcome_class, outcome_label, level_id, criteria_results, checklist_results, evidence_reviewed, rationale, valid_from, valid_until, created_at").in("request_id", ids).order("created_at"),
  ]);
  if (ev.error || evts.error || decs.error) return null;
  const allDecisions = decs.data ?? [];
  return reqs.map(r => {
    const evidence = (ev.data ?? []).filter((e: any) => e.request_id === r.id);
    const events = (evts.data ?? []).filter((e: any) => e.request_id === r.id);
    const decisions = allDecisions.filter((d: any) => d.request_id === r.id);
    const revoked = new Map<string, string | null>(events.filter((e: any) => e.event === "revoked").map((e: any) => [e.decision_id as string, e.reason as string | null]));
    const sameCompetencyLater = allDecisions.filter((d: any) => reqs.find(x => x.id === d.request_id)?.competency_id === r.competency_id && d.user_id === r.user_id);
    const lastAssign = [...events].reverse().find((e: any) => e.event === "assigned" || e.event === "assignment_declined");
    return {
      id: r.id, userId: r.user_id, competencyId: r.competency_id, competency: r.competency_snapshot ?? null, frameworkVersion: r.framework_version, methodVersionId: r.method_version_id,
      outcomeIndexes: r.outcome_indexes ?? [-1], targetLevelId: r.target_level_id, context: r.context, note: r.note, createdAt: r.created_at,
      state: deriveState(events, decisions, evidence),
      assignedTo: lastAssign?.event === "assigned" ? { assessorId: lastAssign.assessor_id, appointmentId: lastAssign.appointment_id } : null,
      evidence: evidence.map((e: any) => ({ id: e.id, kind: e.kind, outcomeIndexes: e.outcome_indexes ?? [-1], provenance: e.provenance ?? {},
        sourcePresent: !!(e.cpd_id ?? e.learning_record_id ?? e.evidence_id ?? e.profile_item_id ?? e.reflection_id), addedAt: e.created_at })),
      decisions: decisions.map((d: any) => ({ id: d.id, assessorId: d.assessor_id, appointmentId: d.appointment_id, methodVersionId: d.method_version_id, methodContentHash: d.method_content_hash,
        competencyHash: d.competency_hash, outcomeCode: d.outcome_code, outcomeClass: d.outcome_class, outcomeLabel: d.outcome_label, levelId: d.level_id, criteria: d.criteria_results ?? [],
        checklist: d.checklist_results ?? [], evidenceReviewed: d.evidence_reviewed ?? [], rationale: d.rationale, validFrom: d.valid_from, validUntil: d.valid_until, decidedAt: d.created_at,
        standing: standingOf(d, new Set(revoked.keys()), sameCompetencyLater, today), revokedReason: revoked.get(d.id) ?? null })),
      events: events.map((e: any) => ({ event: e.event, actorId: e.actor_id, reason: e.reason, decisionId: e.decision_id ?? null, at: e.created_at })),
    };
  });
}

/** Internal assembly of the person's own requests, newest first. Products use listVerifications. null = unreadable. */
export async function loadVerifications(admin: any, userId: string, today = new Date().toISOString().slice(0, 10)): Promise<RequestView[] | null> {
  try {
    const { data, error } = await admin.from("competency_verification_request").select(REQ_COLS).eq("user_id", userId).order("created_at", { ascending: false }).limit(500);
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
};
export type VerificationItem = {
  requestId: string; status: RequestState;
  competency: { frameworkCompetencyId: string; frameworkId: string | null; frameworkVersion: string | null; code: string | null; title: string; learningOutcomes: string[]; allLearningOutcomes: string[] };
  method: { code: string | null; name: string | null; kind: string | null; versionNo: number | null; criteriaHash: string | null };
  context: string; requestedAt: string;
  evidence: { evidenceId: string; linkId: string | null; kind: EvidenceKind; title: string; evidenceClass: string | null; issuer: string | null; occurredOn: string | null; learningOutcomes: string[]; sourcePresent: boolean; submittedAt: string }[];
  decisions: VerificationDecision[];
  /** The decision that stands today as a verification (verified or partial, not revoked, expired or superseded), or null. */
  current: VerificationDecision | null;
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
    const [lv, ppl, rq, ev] = await Promise.all([
      levelIds.length ? admin.from("scoring_levels").select("id, score, label").in("id", levelIds) : { data: [] },
      assessorIds.length ? admin.from("profiles").select("id, full_name").in("id", assessorIds) : { data: [] },
      admin.from("competency_verification_request").select("id, framework_id").in("id", mine.map(v => v.id)),
      admin.from("competency_verification_evidence").select("id, portfolio_link_id").in("request_id", mine.map(v => v.id)),
    ]);
    const level = new Map<string, any>((lv.data ?? []).map((l: any) => [l.id, l]));
    const name = new Map<string, string | null>((ppl.data ?? []).map((p: any) => [p.id, p.full_name ?? null]));
    const fwOf = new Map<string, string | null>((rq.data ?? []).map((r: any) => [r.id, r.framework_id ?? null]));
    const linkOf = new Map<string, string | null>((ev.data ?? []).map((e: any) => [e.id, e.portfolio_link_id ?? null]));
    const sameCompetency = (v: RequestView) => views.filter(x => x.competencyId === v.competencyId).flatMap(x => x.decisions);
    const items = mine.map(v => {
      const all = (v.competency?.learning_outcomes ?? []).map(String);
      const words = (idx: number[]) => (idx.includes(-1) ? [] : idx.map(i => all[i] ?? `Outcome ${i + 1}`));
      const ver = versions.get(v.methodVersionId);
      const ds: VerificationDecision[] = v.decisions.map(d => {
        const later = sameCompetency(v).filter(x => x.outcomeClass === "verified" && x.decidedAt > d.decidedAt).sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))[0];
        const revoked = v.events.find(e => e.event === "revoked" && e.decisionId === d.id);
        const l = d.levelId ? level.get(d.levelId) : null;
        return {
          decisionId: d.id, outcomeCode: d.outcomeCode, outcomeLabel: d.outcomeLabel ?? d.outcomeCode, outcomeClass: d.outcomeClass,
          level: l ? { id: l.id, score: l.score, label: l.label } : null,
          assessorName: d.assessorId ? name.get(d.assessorId) ?? null : null, authority: ASSESSOR_AUTHORITY, appointmentId: d.appointmentId,
          criteriaVersion: { versionId: d.methodVersionId, versionNo: versions.get(d.methodVersionId)?.version_no ?? null, hash: d.methodContentHash },
          competencyHash: d.competencyHash, rationale: d.rationale, decidedAt: d.decidedAt, validFrom: d.validFrom, validUntil: d.validUntil,
          standing: d.standing, revokedAt: revoked?.at ?? null, revokedReason: d.revokedReason, supersededBy: d.standing === "superseded" ? later?.id ?? null : null,
        };
      });
      return {
        requestId: v.id, status: v.state,
        competency: { frameworkCompetencyId: v.competencyId, frameworkId: fwOf.get(v.id) ?? null, frameworkVersion: v.frameworkVersion, code: v.competency?.code ?? null,
          title: v.competency?.name ?? "", learningOutcomes: words(v.outcomeIndexes), allLearningOutcomes: all },
        method: { code: ver?.method?.code ?? null, name: ver?.method?.name ?? null, kind: ver?.method?.kind ?? null, versionNo: ver?.version_no ?? null, criteriaHash: ver?.content_hash ?? null },
        context: v.context, requestedAt: v.createdAt,
        evidence: v.evidence.map(e => ({
          evidenceId: e.id, linkId: linkOf.get(e.id) ?? null, kind: e.kind, title: String(e.provenance.title ?? e.provenance.template ?? e.kind),
          evidenceClass: e.provenance.evidence_class ?? null, issuer: e.provenance.issuing_body ?? e.provenance.organisation ?? null,
          occurredOn: e.provenance.date ?? e.provenance.completed_at ?? e.provenance.issued_on ?? e.provenance.started_on ?? null,
          learningOutcomes: words(e.outcomeIndexes), sourcePresent: e.sourcePresent, submittedAt: e.addedAt,
        })),
        decisions: ds,
        current: [...ds].reverse().find(d => d.standing === "current") ?? null,
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
    const { data, error } = await admin.from("competency_verification_request").select(REQ_COLS).order("created_at", { ascending: false }).limit(500);
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
  const { data: req } = await admin.from("competency_verification_request").select("id, user_id, method_version_id").eq("id", requestId).maybeSingle();
  if (!req) return { ok: false, status: 404, error: "No such request." };
  if (req.user_id === assessorId) return { ok: false, status: 403, error: "No self-verification. You can never decide your own request." };
  const { data: assign } = await admin.from("competency_verification_event").select("assessor_id, appointment_id, event").eq("request_id", requestId).in("event", ["assigned", "assignment_declined"]).order("created_at", { ascending: false }).limit(1);
  const a = assign?.[0];
  if (a?.event !== "assigned" || a.assessor_id !== assessorId) return { ok: false, status: 403, error: "Only the assessor assigned to this request decides it." };
  const { data: v } = await admin.from("competency_verification_method_version").select("content").eq("id", req.method_version_id).maybeSingle();
  const { data: ev } = await admin.from("competency_verification_evidence").select("id").eq("request_id", requestId);
  const c = checkDecision(input, v?.content ?? {}, (ev ?? []).map((e: any) => e.id));
  if (!c.ok) return { ok: false, status: 400, error: c.error };
  const { data, error } = await admin.from("competency_verification_decision").insert({
    request_id: requestId, user_id: req.user_id, assessor_id: assessorId, appointment_id: a.appointment_id, method_version_id: req.method_version_id,
    outcome_code: c.value.outcomeCode, level_id: c.value.levelId, rationale: c.value.rationale, criteria_results: c.value.criteria, checklist_results: c.value.checklist, evidence_reviewed: c.value.evidenceReviewed,
  }).select("id").single();
  return error || !data ? refusalOf(error, "decision") : { ok: true, decisionId: data.id };
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
