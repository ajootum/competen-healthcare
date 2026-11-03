// Assessor workspace: grants. A grant is the authority to assess one person with one checklist.
//
// The coordinator (hq.assessment.assessor.assign) makes it, the person accepts it in their own product (that step is not
// here: this plane only reads accepted_at), and either side can end it. The database refuses a grant to or by the
// subject, to an appointment that does not hold the assess capability, and an ended grant never reopens.
//
// ⚠ READS ARE FILTERED. My own grants: respondent_id = actor. The grants I made: granted_by = actor. Ids are all a grant
// stores. Names and emails are looked up for display only and are never written to a grant.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { normaliseLookupEmail, normaliseLookupName, searchPeopleByName } from "@/lib/individual/grants";
import {
  type Admin, type GrantRow, type Res, ASSESS_CAPABILITY, NOT_SET_UP, fail, grantState, guardMessage, isMissingRelation, isUuid, okRes, type GrantState, HQ_RESPONDENT_ROLES, type HqRespondentRole, isHqRole,
} from "./common";

export interface GrantView extends GrantRow {
  state: GrantState;
  instrument_code: string | null;
  instrument_name: string | null;
  subject_name: string | null;
  respondent_name: string | null;
}

async function names(admin: Admin, ids: string[]): Promise<Map<string, string | null>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const { data } = await admin.from("profiles").select("id, full_name").in("id", uniq);
  return new Map((data ?? []).map((p: any) => [p.id as string, (p.full_name ?? null) as string | null]));
}

async function instruments(admin: Admin, ids: string[]): Promise<Map<string, { code: string; name: string }>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const { data } = await admin.from("asmt_instrument").select("id, code, name").in("id", uniq);
  return new Map((data ?? []).map((i: any) => [i.id as string, { code: i.code as string, name: i.name as string }]));
}

async function decorate(admin: Admin, rows: GrantRow[]): Promise<GrantView[]> {
  const [n, ins] = await Promise.all([
    names(admin, rows.flatMap(r => [r.subject_user_id ?? "", r.respondent_id])),
    instruments(admin, rows.map(r => r.instrument_id)),
  ]);
  return rows.map(r => ({
    ...r, state: grantState(r), instrument_code: ins.get(r.instrument_id)?.code ?? null, instrument_name: ins.get(r.instrument_id)?.name ?? null,
    subject_name: r.subject_user_id ? n.get(r.subject_user_id) ?? null : null, respondent_name: n.get(r.respondent_id) ?? null,
  }));
}

/** The grants made TO me, all states. */
export async function listMyGrants(admin: Admin, actor: string): Promise<Res<GrantView[]>> {
  const { data, error } = await admin.from("asmt_respondent_grant").select("id, instrument_id, subject_kind, subject_id, subject_user_id, respondent_id, respondent_role, appointment_id, granted_by, reason, valid_from, valid_until, accepted_at, ended_at, end_reason, created_at").eq("respondent_id", actor).in("respondent_role", [...HQ_RESPONDENT_ROLES]).order("created_at", { ascending: false }).limit(200);
  if (isMissingRelation(error)) return fail(501, NOT_SET_UP);
  if (error) return fail(503, "Your assessments could not be read just now.");
  return okRes(await decorate(admin, (data ?? []) as GrantRow[]));
}

/** The grants I made. */
export async function listGrantsIMade(admin: Admin, actor: string): Promise<Res<GrantView[]>> {
  const { data, error } = await admin.from("asmt_respondent_grant").select("id, instrument_id, subject_kind, subject_id, subject_user_id, respondent_id, respondent_role, appointment_id, granted_by, reason, valid_from, valid_until, accepted_at, ended_at, end_reason, created_at").eq("granted_by", actor).order("created_at", { ascending: false }).limit(300);
  if (isMissingRelation(error)) return fail(501, NOT_SET_UP);
  if (error) return fail(503, "The grants could not be read just now.");
  return okRes(await decorate(admin, (data ?? []) as GrantRow[]));
}

// ── the picker data for making a grant ───────────────────────────────────────────────────────────────────────
export interface AssessableInstrument { instrument_id: string; code: string; name: string; version_no: number; assess_capability: string; respondent_roles: string[] }

/** Instruments whose latest published version admits an assessor or an auditor (HQ-recorded roles). */
export async function listAssessableInstruments(admin: Admin): Promise<Res<AssessableInstrument[]>> {
  const { data, error } = await admin.from("asmt_instrument_version").select("instrument_id, version_no, assess_capability, respondent_roles")
    .eq("state", "published").overlaps("respondent_roles", [...HQ_RESPONDENT_ROLES]).order("version_no", { ascending: false }).limit(500);
  if (error) return fail(503, "The checklists could not be read just now.");
  const latest = new Map<string, any>();
  for (const v of data ?? []) if (!latest.has(v.instrument_id)) latest.set(v.instrument_id, v);
  const ins = await instruments(admin, [...latest.keys()]);
  return okRes([...latest.values()].filter(v => ins.has(v.instrument_id)).map(v => ({
    instrument_id: v.instrument_id as string, code: ins.get(v.instrument_id)!.code, name: ins.get(v.instrument_id)!.name,
    version_no: v.version_no as number, assess_capability: (v.assess_capability ?? ASSESS_CAPABILITY) as string,
    respondent_roles: ((v.respondent_roles ?? []) as string[]).filter(isHqRole),
  })).sort((a, b) => a.name.localeCompare(b.name)));
}

export interface PersonMatch { id: string; name: string | null; email: string | null }

/** An existing account by exact email (the HQ account lookup pattern), or by name. Only id, name and email are read. */
export async function findPeople(admin: Admin, q: { email?: string | null; name?: string | null }): Promise<Res<{ matches: PersonMatch[]; more: boolean }>> {
  const email = q.email ? normaliseLookupEmail(q.email) : null;
  if (email) {
    const pattern = email.replace(/[\\%_]/g, c => "\\" + c);
    const { data, error } = await admin.from("profiles").select("id, full_name, email").ilike("email", pattern).limit(2);
    if (error) return fail(503, "The account could not be looked up just now.");
    const rows = (data ?? []) as any[];
    if (rows.length > 1) return fail(409, "More than one account carries that email address.");
    return okRes({ matches: rows.map(r => ({ id: r.id, name: r.full_name ?? null, email: r.email ?? null })), more: false });
  }
  const name = q.name ? normaliseLookupName(q.name) : null;
  if (!name) return fail(400, "Enter the person's email address, or at least two letters of their name.");
  const found = await searchPeopleByName(admin, name);
  if (!found.ok) return fail(503, found.message);
  return okRes({ matches: found.value, more: found.more });
}

export interface RespondentCandidate { person_id: string; name: string | null; appointment_id: string; position: string }

/**
 * People who hold the assess capability for this checklist, with the appointment that holds it. Each pair is confirmed by
 * the database's own function, so scope, term and office state are the database's answer and not a copy of it here.
 */
export async function listRespondentCandidates(admin: Admin, instrumentId: string, exclude: string[] = []): Promise<Res<RespondentCandidate[]>> {
  if (!isUuid(instrumentId)) return fail(400, "Choose a checklist.");
  const ver = await admin.from("asmt_instrument_version").select("assess_capability").eq("instrument_id", instrumentId).eq("state", "published").order("version_no", { ascending: false }).limit(1).maybeSingle();
  if (ver.error) return fail(503, "The checklist could not be read just now.");
  if (!ver.data) return fail(409, "This checklist has no published version.");
  const cap = (ver.data.assess_capability ?? ASSESS_CAPABILITY) as string;
  const pos = await admin.from("hq_position_capability").select("position_code").eq("capability_code", cap);
  if (pos.error) return fail(503, "The positions could not be read just now.");
  const codes = [...new Set((pos.data ?? []).map((p: any) => p.position_code as string))];
  if (!codes.length) return okRes([]);
  const ap = await admin.from("ogs_office_appointments").select("id, person_id, role").in("role", codes).eq("status", "active").limit(300);
  if (ap.error) return fail(503, "The appointments could not be read just now.");
  const rows = ((ap.data ?? []) as any[]).filter(a => a.person_id && !exclude.includes(a.person_id));
  const checked = await Promise.all(rows.map(async a => {
    const r = await admin.rpc("competency_appointment_holds", { p_appointment: a.id, p_person: a.person_id, p_capability: cap });
    return r.error || r.data !== true ? null : a;
  }));
  const holders = checked.filter(Boolean) as any[];
  const n = await names(admin, holders.map(h => h.person_id));
  return okRes(holders.map(h => ({ person_id: h.person_id, name: n.get(h.person_id) ?? null, appointment_id: h.id, position: h.role })));
}

// ── making and ending ────────────────────────────────────────────────────────────────────────────────────────
export interface NewGrant { instrumentId: unknown; subjectUserId: unknown; respondentId: unknown; appointmentId: unknown; reason: unknown; validUntil?: unknown; /** assessor (default) or auditor; the database checks the published version allows it */ respondentRole?: unknown }

export async function createGrant(admin: Admin, actor: string, b: NewGrant): Promise<Res<{ id: string }>> {
  if (!isUuid(b.instrumentId) || !isUuid(b.subjectUserId) || !isUuid(b.respondentId) || !isUuid(b.appointmentId)) return fail(400, "Choose the checklist, the person, the assessor and the appointment.");
  const role = b.respondentRole === undefined || b.respondentRole === null || b.respondentRole === "" ? "assessor" : b.respondentRole;
  if (!isHqRole(role)) return fail(400, "The respondent role is assessor or auditor.");
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (reason.length < 3 || reason.length > 1000) return fail(400, "Give a reason of 3 to 1000 characters.");
  if (b.subjectUserId === actor) return fail(403, "You cannot give authority to assess yourself.");
  if (b.respondentId === actor) return fail(403, "You cannot give yourself authority to assess.");
  if (b.subjectUserId === b.respondentId) return fail(400, "The assessor and the person assessed must be different people.");
  let validUntil: string | null = null;
  if (b.validUntil) {
    const t = new Date(String(b.validUntil));
    if (Number.isNaN(t.getTime()) || t.getTime() <= Date.now()) return fail(400, "The end date must be in the future.");
    validUntil = t.toISOString();
  }
  const ins = await admin.from("asmt_respondent_grant").insert({
    instrument_id: b.instrumentId, subject_kind: "person", subject_id: b.subjectUserId, subject_user_id: b.subjectUserId,
    respondent_id: b.respondentId, respondent_role: role, appointment_id: b.appointmentId, granted_by: actor, reason, valid_until: validUntil,
  }).select("id").single();
  if (ins.error || !ins.data) return fail(422, guardMessage(ins.error));
  return okRes({ id: ins.data.id as string });
}

export async function endGrant(admin: Admin, actor: string, grantId: unknown, reason: unknown): Promise<Res<{ id: string }>> {
  if (!isUuid(grantId)) return fail(400, "Choose a grant.");
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length < 3 || why.length > 1000) return fail(400, "Give a reason of 3 to 1000 characters.");
  const upd = await admin.from("asmt_respondent_grant").update({ ended_at: new Date().toISOString(), ended_by: actor, end_reason: why }).eq("id", grantId).is("ended_at", null);
  if (upd.error) return fail(422, guardMessage(upd.error));
  return okRes({ id: grantId });
}
