import { audit } from "@/lib/practice/provisioning";
import type { EngineResult } from "@/lib/practice/encounters";
import { workspaceClock, zonedDayRange } from "@/lib/practice/practice-time";

// CPR-150's OTHER HALF: clinical activity, procedure teams, instruments, templates and portfolio.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// A CLINICAL ACTIVITY IS NOT A PROCEDURE, AND IT IS NOT A TASK.
//
// A procedure is done TO a patient and lives in their record. An activity is something a clinician DID --
// a ward round, a teaching session, a mortality meeting -- and most name no patient at all. Recording a
// lecture as a procedure would put it in somebody's clinical record; recording it as a task would say it
// was work assigned rather than work done.
//
// So practice_clinical_activity has NO patient_id. The one link it may carry is to an encounter, for the
// case where an activity genuinely happened around one consultation -- and even then it is about the
// clinician, not the patient.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// IT BELONGS TO THE PERSON WHO DID IT, NOT THE PERSON WHO TYPED IT. A consultant recording that a
// registrar led a ward round must credit the registrar, or the portfolio built on top of this is wrong
// about who did the work. `performed_by` is separate from `created_by` for exactly that.
//
// CPD MINUTES ARE SEPARATE FROM DURATION. A four-hour meeting is not four hours of CPD, and conflating
// them would inflate every portfolio in the practice. Both are recorded; neither is derived from the
// other.
//
// NO RATES. Complication and success figures are counts and denominators -- "1 of 48", never "2.1%".
// The comp prints both; only one of them survives a practice that has done three of something. Same
// doctrine as CPR-270's.

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

export const ACTIVITY_KINDS = [
  ["ward_round", "Ward round"],
  ["clinic_session", "Clinic session"],
  ["teaching", "Teaching"],
  ["training", "Training attended"],
  ["meeting", "Meeting"],
  ["audit", "Audit or governance"],
  ["on_call", "On call"],
  ["supervision", "Supervision"],
  ["admin", "Administration"],
  ["other", "Other"],
] as const;

export const PARTICIPATION = [
  ["led", "Led it"],
  ["participated", "Took part"],
  ["observed", "Observed"],
  ["taught", "Taught"],
  ["supervised", "Supervised"],
] as const;

export const PARTICIPANT_ROLES = [
  ["operator", "Operator"],
  ["assistant", "Assistant"],
  ["anaesthetist", "Anaesthetist"],
  ["scrub", "Scrub"],
  ["observer", "Observer"],
  ["supervisor", "Supervisor"],
  ["other", "Other"],
] as const;

export const ITEM_KINDS = [
  ["instrument", "Instrument"],
  ["consumable", "Consumable"],
  ["implant", "Implant"],
] as const;

// ── CLINICAL ACTIVITY ────────────────────────────────────────────────────────────────────────────────

export async function recordActivity(admin: any, args: {
  workspaceId: string; kind: string; title: string; occurredAt: string;
  detail?: string; durationMinutes?: number | null; participation?: string;
  performedBy?: string | null; locationId?: string | null; encounterId?: string | null;
  cpdMinutes?: number | null; portfolio?: boolean;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!ACTIVITY_KINDS.some(([k]) => k === args.kind))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `kind must be one of: ${ACTIVITY_KINDS.map(([k]) => k).join(", ")}` };
  if (!args.title.trim())
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "an activity needs a title" };
  if (!args.occurredAt || Number.isNaN(Date.parse(args.occurredAt)))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "say when it happened" };

  const participation = PARTICIPATION.some(([p]) => p === args.participation) ? args.participation! : "participated";

  // CREDITED TO WHOEVER DID IT. Defaulting to the actor is right for the common case -- somebody logging
  // their own morning -- and naming a colleague is the case the field exists for.
  const performedBy = args.performedBy ?? args.actorId;
  if (performedBy !== args.actorId) {
    const { data: m } = await admin.from("practice_membership")
      .select("id").eq("workspace_id", args.workspaceId).eq("user_id", performedBy).eq("status", "active").limit(1).maybeSingle();
    if (!m) return { ok: false, status: 422, code: "NOT_A_MEMBER", message: "that person is not an active member of this practice" };
  }

  for (const [value, label, max] of [
    [args.durationMinutes, "duration", 1440], [args.cpdMinutes, "CPD time", 1440],
  ] as const) {
    if (value === undefined || value === null) continue;
    if (!Number.isInteger(value) || value < 0 || value > max)
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `${label} must be a whole number of minutes, up to ${max}` };
  }
  // CPD CANNOT EXCEED THE TIME SPENT. A portfolio claiming six hours of CPD from a two-hour meeting is
  // the kind of record that discredits every other entry beside it.
  if (args.cpdMinutes != null && args.durationMinutes != null && args.cpdMinutes > args.durationMinutes)
    return {
      ok: false, status: 422, code: "CPD_EXCEEDS_DURATION",
      message: "the CPD time claimed is longer than the activity itself",
    };

  let encounterId: string | null = null;
  if (args.encounterId) {
    const { data: enc } = await admin.from("practice_encounter")
      .select("id").eq("id", args.encounterId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!enc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    encounterId = enc.id;
  }
  let locationId: string | null = null;
  if (args.locationId) {
    const { data: loc } = await admin.from("practice_location")
      .select("id").eq("id", args.locationId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!loc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    locationId = loc.id;
  }

  const { data, error } = await admin.from("practice_clinical_activity").insert({
    workspace_id: args.workspaceId, performed_by: performedBy, kind: args.kind,
    title: args.title.trim(), detail: args.detail?.trim() || null, occurred_at: args.occurredAt,
    duration_minutes: args.durationMinutes ?? null, participation,
    location_id: locationId, encounter_id: encounterId,
    cpd_minutes: args.cpdMinutes ?? null, portfolio: args.portfolio === true, created_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.activity_recorded",
    payload: { activityId: data.id, kind: args.kind, performedBy }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

export async function listActivities(admin: any, workspaceId: string, filter: {
  performedBy?: string; kind?: string; fromDay?: string; toDay?: string; limit?: number;
} = {}) {
  let q = admin.from("practice_clinical_activity")
    .select("id, performed_by, kind, title, detail, occurred_at, duration_minutes, participation, location_id, encounter_id, cpd_minutes, portfolio, created_at")
    .eq("workspace_id", workspaceId);
  if (filter.performedBy) q = q.eq("performed_by", filter.performedBy);
  if (filter.kind) q = q.eq("kind", filter.kind);

  if (filter.fromDay || filter.toDay) {
    // THE PRACTICE'S CALENDAR, not the server's -- the same reason CPR-300 fixed "today". A month
    // boundary read in UTC puts the first hours of a Kampala month in the wrong month.
    const { timezone } = await workspaceClock(admin, workspaceId);
    if (filter.fromDay) q = q.gte("occurred_at", zonedDayRange(filter.fromDay, timezone).startIso);
    if (filter.toDay) q = q.lt("occurred_at", zonedDayRange(filter.toDay, timezone).endIso);
  }

  const { data } = await q.order("occurred_at", { ascending: false }).limit(filter.limit ?? 100);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.map(r => r.performed_by))];
  const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", ids);
  const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));

  const labelOf = Object.fromEntries(ACTIVITY_KINDS.map(([k, l]) => [k, l])) as Record<string, string>;
  return rows.map(r => ({ ...r, performedByName: nameOf.get(r.performed_by) ?? null, kindLabel: labelOf[r.kind] ?? r.kind }));
}

// ── PROCEDURE TEAM AND INSTRUMENTS ───────────────────────────────────────────────────────────────────

async function procedureIn(admin: any, workspaceId: string, procedureId: string) {
  const { data } = await admin.from("practice_procedure")
    .select("id, status").eq("id", procedureId).eq("workspace_id", workspaceId).maybeSingle();
  return data ?? null;
}

export async function addParticipant(admin: any, args: {
  workspaceId: string; procedureId: string; role: string;
  userId?: string | null; personName?: string; note?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!PARTICIPANT_ROLES.some(([r]) => r === args.role))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `role must be one of: ${PARTICIPANT_ROLES.map(([r]) => r).join(", ")}` };

  const proc = await procedureIn(admin, args.workspaceId, args.procedureId);
  if (!proc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  // A NAME OR AN ACCOUNT, BUT NOT NEITHER. A team entry that identifies nobody is a row that says
  // somebody else was there and cannot say who -- which is worse than an incomplete team list, because
  // it looks complete.
  const name = args.personName?.trim() || null;
  if (!args.userId && !name)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "name the person, or choose a member" };

  if (args.userId) {
    const { data: m } = await admin.from("practice_membership")
      .select("id").eq("workspace_id", args.workspaceId).eq("user_id", args.userId).eq("status", "active").limit(1).maybeSingle();
    if (!m) return { ok: false, status: 422, code: "NOT_A_MEMBER", message: "that person is not an active member of this practice" };
  }

  const { data, error } = await admin.from("practice_procedure_participant").insert({
    workspace_id: args.workspaceId, procedure_id: proc.id, user_id: args.userId ?? null,
    person_name: name, role: args.role, note: args.note?.trim() || null, created_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  return { ok: true, data: { id: data.id as string } };
}

export async function addItem(admin: any, args: {
  workspaceId: string; procedureId: string; label: string; kind?: string;
  identifier?: string; quantity?: number | null; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!args.label.trim())
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "name the instrument or item" };
  const kind = ITEM_KINDS.some(([k]) => k === args.kind) ? args.kind! : "instrument";

  const proc = await procedureIn(admin, args.workspaceId, args.procedureId);
  if (!proc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  // AN IMPLANT WITHOUT AN IDENTIFIER CANNOT BE RECALLED. The one field that has to be there years later
  // when a batch is withdrawn, and the one nobody thinks to fill in at the time.
  if (kind === "implant" && !args.identifier?.trim())
    return {
      ok: false, status: 422, code: "IDENTIFIER_REQUIRED",
      message: "an implant needs its batch or serial number; without it this patient cannot be found in a recall",
    };

  const { data, error } = await admin.from("practice_procedure_item").insert({
    workspace_id: args.workspaceId, procedure_id: proc.id, kind, label: args.label.trim(),
    identifier: args.identifier?.trim() || null, quantity: args.quantity ?? null, created_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  return { ok: true, data: { id: data.id as string } };
}

/** One procedure's team and kit, for the detail panel. */
export async function procedureDetail(admin: any, workspaceId: string, procedureId: string) {
  const [{ data: participants }, { data: items }, { data: attachments }] = await Promise.all([
    admin.from("practice_procedure_participant")
      .select("id, user_id, person_name, role, note").eq("procedure_id", procedureId).eq("workspace_id", workspaceId),
    admin.from("practice_procedure_item")
      .select("id, kind, label, identifier, quantity").eq("procedure_id", procedureId).eq("workspace_id", workspaceId),
    admin.from("practice_attachment")
      .select("id, file_name, mime_type, byte_size, kind, caption, created_at")
      .eq("procedure_id", procedureId).eq("workspace_id", workspaceId).is("removed_at", null),
  ]);

  const rows = (participants ?? []) as any[];
  const ids = [...new Set(rows.map(p => p.user_id).filter(Boolean))];
  const { data: profiles } = ids.length
    ? await admin.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] };
  const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));

  return {
    participants: rows.map(p => ({ ...p, name: p.user_id ? (nameOf.get(p.user_id) ?? null) : p.person_name })),
    items: (items ?? []) as any[],
    attachments: (attachments ?? []) as any[],
  };
}

/** Which procedures used a given piece of kit -- the question a maintenance fault or a recall asks. */
export async function procedureItemTrace(admin: any, workspaceId: string, label: string) {
  const { data } = await admin.from("practice_procedure_item")
    .select("id, procedure_id, kind, label, identifier, created_at")
    .eq("workspace_id", workspaceId).ilike("label", label.trim()).order("created_at", { ascending: false }).limit(200);
  return (data ?? []) as any[];
}

// ── PROCEDURE TEMPLATES ──────────────────────────────────────────────────────────────────────────────

export async function listProcedureTemplates(admin: any, workspaceId: string) {
  const { data } = await admin.from("practice_procedure_template")
    .select("id, code, title, procedure_type_id, default_laterality, default_indication, default_items, default_roles, active")
    .eq("workspace_id", workspaceId).eq("active", true).order("title");
  return (data ?? []) as any[];
}

export async function createProcedureTemplate(admin: any, args: {
  workspaceId: string; code: string; title: string; procedureTypeId?: string | null;
  defaultLaterality?: string; defaultIndication?: string;
  defaultItems?: { kind?: string; label: string }[]; defaultRoles?: { role: string; personName?: string }[];
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  const code = args.code.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  if (!code) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a code is required" };
  if (!args.title.trim()) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a title is required" };

  const items = (args.defaultItems ?? []).filter(i => i?.label?.trim())
    .map(i => ({ kind: ITEM_KINDS.some(([k]) => k === i.kind) ? i.kind : "instrument", label: i.label.trim() }));
  const roles = (args.defaultRoles ?? []).filter(r => PARTICIPANT_ROLES.some(([x]) => x === r?.role))
    .map(r => ({ role: r.role, personName: r.personName?.trim() || null }));

  const { data, error } = await admin.from("practice_procedure_template").insert({
    workspace_id: args.workspaceId, code, title: args.title.trim(),
    procedure_type_id: args.procedureTypeId ?? null,
    default_laterality: args.defaultLaterality ?? null,
    default_indication: args.defaultIndication?.trim() || null,
    default_items: items, default_roles: roles, created_by: args.actorId,
  }).select("id").single();
  if (error) {
    if (/duplicate|unique/i.test(error.message))
      return { ok: false, status: 409, code: "CODE_IN_USE", message: `this practice already has a template coded "${code}"` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.procedure_template_created",
    payload: { templateId: data.id, code }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

/**
 * Seed a recorded procedure's team and kit from a template.
 *
 * APPLIED AFTER THE PROCEDURE EXISTS, never as part of creating one, and it seeds ONLY the team and the
 * kit. It does not pre-fill findings: writing what was found into a record before anybody has performed
 * the operation is the same mistake CPR-130's template library refuses about starting text.
 */
export async function applyProcedureTemplate(admin: any, args: {
  workspaceId: string; procedureId: string; templateId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ items: number; roles: number }>> {
  const proc = await procedureIn(admin, args.workspaceId, args.procedureId);
  if (!proc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const { data: t } = await admin.from("practice_procedure_template")
    .select("id, default_items, default_roles, active").eq("id", args.templateId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!t) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!t.active) return { ok: false, status: 422, code: "TEMPLATE_RETIRED", message: "that template has been retired" };

  const items = (Array.isArray(t.default_items) ? t.default_items : []) as any[];
  const roles = (Array.isArray(t.default_roles) ? t.default_roles : []) as any[];

  // AN IMPLANT IS NEVER SEEDED FROM A TEMPLATE. A template cannot know a batch number, and an implant
  // row without one is exactly what addItem refuses -- so seeding one would smuggle past that rule.
  const seedable = items.filter(i => i.kind !== "implant");

  if (seedable.length) {
    await admin.from("practice_procedure_item").insert(seedable.map(i => ({
      workspace_id: args.workspaceId, procedure_id: proc.id,
      kind: i.kind ?? "instrument", label: String(i.label), created_by: args.actorId,
    })));
  }
  // A seeded role names a PLACE IN THE TEAM, not a person, unless the template said so. It is a
  // reminder to fill in who, not a claim that they were there.
  if (roles.length) {
    await admin.from("practice_procedure_participant").insert(roles.map(r => ({
      workspace_id: args.workspaceId, procedure_id: proc.id, role: r.role,
      person_name: r.personName ?? "(to be named)", created_by: args.actorId,
    })));
  }

  return { ok: true, data: { items: seedable.length, roles: roles.length } };
}

// ── THE PORTFOLIO ────────────────────────────────────────────────────────────────────────────────────

/**
 * What one clinician has done, over a period.
 *
 * COUNTS AND DENOMINATORS, NEVER RATES. The comp prints "Complication Rate 2.1%" and "Success Rate
 * 97.9%" beside a total of 48. Over 48 that is arguably meaningful; over the 3 a new practice will have,
 * "33%" is a sentence that sounds like a measurement and is not one. So this returns "1 of 48" and lets
 * the reader divide.
 *
 * THE LINK INTO THE PLATFORM'S COMPETENCY TABLES IS NOT BUILT and is named as absent rather than
 * implied. A practice tenancy writing into hospital competency records is a cross-tenancy decision with
 * its own specification.
 */
export async function portfolioSummary(admin: any, workspaceId: string, userId: string, opts: {
  fromDay?: string; toDay?: string;
} = {}) {
  const { timezone } = await workspaceClock(admin, workspaceId);
  const range = (col: string) => (q: any) => {
    let out = q;
    if (opts.fromDay) out = out.gte(col, zonedDayRange(opts.fromDay, timezone).startIso);
    if (opts.toDay) out = out.lt(col, zonedDayRange(opts.toDay, timezone).endIso);
    return out;
  };

  const [{ data: procedures }, { data: activities }] = await Promise.all([
    range("performed_at")(admin.from("practice_procedure")
      .select("id, status, procedure_type_id, label, performed_at, cpd_minutes, portfolio")
      .eq("workspace_id", workspaceId).eq("performed_by", userId)).limit(1000),
    range("occurred_at")(admin.from("practice_clinical_activity")
      .select("id, kind, title, occurred_at, duration_minutes, participation, cpd_minutes, portfolio")
      .eq("workspace_id", workspaceId).eq("performed_by", userId)).limit(1000),
  ]);

  const procs = (procedures ?? []) as any[];
  const acts = (activities ?? []) as any[];

  const performed = procs.filter(p => p.status === "PERFORMED");
  const { data: outcomes } = performed.length
    ? await admin.from("practice_procedure_outcome")
      .select("procedure_id, outcome_type, severity").in("procedure_id", performed.map(p => p.id))
    : { data: [] };
  const outcomeRows = (outcomes ?? []) as any[];
  const withComplication = new Set(outcomeRows.filter(o => o.outcome_type === "complication").map(o => o.procedure_id));

  const byKind = ACTIVITY_KINDS.map(([k, label]) => ({
    kind: k, label, total: acts.filter(a => a.kind === k).length,
    minutes: acts.filter(a => a.kind === k).reduce((n, a) => n + (a.duration_minutes ?? 0), 0),
  })).filter(r => r.total > 0);

  return {
    procedures: {
      total: procs.length,
      performed: performed.length,
      abandoned: procs.filter(p => p.status === "ABANDONED").length,
      // "1 of 48", never "2.1%".
      withComplication: withComplication.size,
      complicationDenominator: performed.length,
      outcomesRecorded: new Set(outcomeRows.map(o => o.procedure_id)).size,
    },
    activities: { total: acts.length, byKind },
    cpdMinutes:
      procs.reduce((n, p) => n + (p.cpd_minutes ?? 0), 0) +
      acts.reduce((n, a) => n + (a.cpd_minutes ?? 0), 0),
    portfolioItems: procs.filter(p => p.portfolio).length + acts.filter(a => a.portfolio).length,
    // Stated in the payload, not only in the UI, so a client cannot render this as a competency record.
    competencyLinked: false,
    competencyNote: "Not linked to the platform's competency records; this is the practice's own log.",
  };
}

/** Mark a procedure or activity as portfolio evidence, with the CPD time it is worth. */
export async function setPortfolio(admin: any, args: {
  workspaceId: string; subject: "procedure" | "activity"; id: string;
  portfolio: boolean; cpdMinutes?: number | null; actorId: string; correlationId: string;
}): Promise<EngineResult<{ portfolio: boolean }>> {
  const table = args.subject === "procedure" ? "practice_procedure" : "practice_clinical_activity";
  const { data: row } = await admin.from(table)
    .select("id, performed_by, duration_minutes").eq("id", args.id).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!row) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  // A PORTFOLIO IS THE PERSON'S OWN. Somebody else claiming an entry into it -- or out of it -- is the
  // one thing a portfolio must not allow, because its whole worth is that it says what THEY did.
  if (row.performed_by !== args.actorId)
    return { ok: false, status: 403, code: "NOT_YOURS", message: "only the person who did it can put it in their portfolio" };

  if (args.cpdMinutes != null) {
    if (!Number.isInteger(args.cpdMinutes) || args.cpdMinutes < 0 || args.cpdMinutes > 1440)
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "CPD time must be a whole number of minutes, up to 1440" };
    if (row.duration_minutes != null && args.cpdMinutes > row.duration_minutes)
      return { ok: false, status: 422, code: "CPD_EXCEEDS_DURATION", message: "the CPD time claimed is longer than the activity itself" };
  }

  const { error } = await admin.from(table).update({
    portfolio: args.portfolio,
    ...(args.cpdMinutes !== undefined ? { cpd_minutes: args.cpdMinutes } : {}),
    ...(args.subject === "activity" ? { updated_at: nowIso() } : {}),
  }).eq("id", row.id);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.portfolio_marked",
    payload: { subject: args.subject, id: row.id, portfolio: args.portfolio }, correlationId: args.correlationId,
  });
  return { ok: true, data: { portfolio: args.portfolio } };
}
