import { audit } from "@/lib/practice/audit";
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

export type ActivityListFilter = {
  performedBy?: string; kind?: string; fromDay?: string; toDay?: string; limit?: number;
};

/**
 * The activity log, WITH THE THREE STATES KEPT APART.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THIS FUNCTION EXISTS BECAUSE listActivities BELOW DISCARDED THE ERROR AND RETURNED [].
 *
 * `const { data } = await q` then `data ?? []` is this codebase's oldest bug, and it is worse on a page
 * that now carries a PERIOD: an unreadable query and a genuinely quiet fortnight render identically, so
 * a practitioner reviewing what they did in July would read an outage as "I did nothing in July" -- and
 * on a portfolio, "I did nothing" is a claim somebody submits to a regulator.
 *
 * ⚠ AND THE ROW CAP IS REPORTED RATHER THAN APPLIED IN SILENCE. The old call took 100 rows and said
 * nothing; a year of a busy clinician's work is more than 100, so "what did I do in 2026" would have
 * stopped somewhere in March with no mark on the screen. PostgREST also caps at 1000 whatever is asked
 * for, so the request is made for one MORE than the caller wants and the surplus is the proof there is
 * more -- rather than the guess that a full page means a full table.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
export async function listActivitiesResult(admin: any, workspaceId: string, filter: ActivityListFilter = {}): Promise<{
  items: any[]; unavailable: boolean; detail: string | null; truncated: boolean; limit: number;
}> {
  // ⚠ NEVER ABOVE 999. PostgREST returns 1000 rows and no error whatever `.limit()` says, so a limit of
  // 1000 would come back full and the "one over" trick would report "no more" on a truncated read.
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 999);
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

  const { data, error } = await q.order("occurred_at", { ascending: false }).limit(limit + 1);
  if (error) return { items: [], unavailable: true, detail: error.message, truncated: false, limit };

  const all = (data ?? []) as any[];
  const truncated = all.length > limit;
  const rows = truncated ? all.slice(0, limit) : all;
  if (rows.length === 0) return { items: [], unavailable: false, detail: null, truncated: false, limit };

  const ids = [...new Set(rows.map(r => r.performed_by))];
  const { data: profiles, error: profileError } = await admin.from("profiles").select("id, full_name").in("id", ids);
  // A NAME THAT COULD NOT BE READ IS NOT AN ANONYMOUS ACTIVITY. The row still counts; only the name is
  // missing, and the screen says which of the two it is looking at.
  const nameOf = profileError
    ? new Map<string, string>()
    : new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));

  const labelOf = Object.fromEntries(ACTIVITY_KINDS.map(([k, l]) => [k, l])) as Record<string, string>;
  return {
    items: rows.map(r => ({
      ...r,
      performedByName: nameOf.get(r.performed_by) ?? null,
      performedByNameUnavailable: !!profileError,
      kindLabel: labelOf[r.kind] ?? r.kind,
    })),
    unavailable: false, detail: null, truncated, limit,
  };
}

/**
 * The same list as a plain array, for the callers that predate the three-state result.
 *
 * ⚠ KEPT DELIBERATELY, NOT LEFT BEHIND. The API route and two harnesses read `.length` off this, and a
 * type change would have made each of them a separate edit in somebody else's file on the same day three
 * other agents are working here. It delegates, so there is one query and not two that drift.
 */
export async function listActivities(admin: any, workspaceId: string, filter: ActivityListFilter = {}) {
  return (await listActivitiesResult(admin, workspaceId, filter)).items;
}

// ── EXTERNAL PROCEDURES ── CPR-PCA-HFE-012 s13 (migration 302) ───────────────────────────────────────
//
// A procedure the practitioner performed OUTSIDE this practice, recorded EXPLICITLY -- s13 forbids a
// generic manual procedure workflow precisely because it would invite duplicate entry of encounter
// work. The table carries no complication column and no outcome enum ON PURPOSE: this product never
// observed the procedure, so the screen says "not assessed here" instead of rendering an assessment
// nobody made (s15's recorded-none versus not-assessed, made structural).

export async function recordExternalProcedure(admin: any, args: {
  workspaceId: string; label: string; source: string; sourceRef?: string | null;
  role?: string; detail?: string; performedAt: string; cpdMinutes?: number | null;
  portfolio?: boolean; performedBy?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (args.label.trim().length < 3)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "name the procedure" };
  // THE SOURCE IS REQUIRED, NOT POLITE. Provenance is the whole difference between this row and an
  // encounter procedure -- an external row with no source is an unverifiable claim wearing a record's
  // clothes (s12).
  if (args.source.trim().length < 3)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "say where it was done -- the source is what makes an external record checkable" };
  if (!args.performedAt || Number.isNaN(Date.parse(args.performedAt)))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "say when it was performed" };
  // WORK DONE, NEVER WORK INTENDED. There is no scheduled external procedure -- the same rule that
  // keeps SCHEDULED encounter procedures out of the record (five minutes of clock skew allowed).
  if (Date.parse(args.performedAt) > Date.now() + 5 * 60 * 1000)
    return { ok: false, status: 422, code: "NOT_YET_DONE", message: "that date is in the future; this records work already done" };

  const role = PARTICIPANT_ROLES.some(([r]) => r === args.role) ? args.role! : "operator";
  if (args.cpdMinutes != null && (!Number.isInteger(args.cpdMinutes) || args.cpdMinutes < 0 || args.cpdMinutes > 1440))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "CPD time must be a whole number of minutes, up to 1440" };

  // Credited to whoever did it, the recordActivity rule -- with the same membership check, so a
  // portfolio row cannot be pinned on somebody who is not here.
  const performedBy = args.performedBy ?? args.actorId;
  if (performedBy !== args.actorId) {
    const { data: m } = await admin.from("practice_membership")
      .select("id").eq("workspace_id", args.workspaceId).eq("user_id", performedBy).eq("status", "active").limit(1).maybeSingle();
    if (!m) return { ok: false, status: 422, code: "NOT_A_MEMBER", message: "that person is not an active member of this practice" };
  }

  const { data, error } = await admin.from("practice_external_procedure").insert({
    workspace_id: args.workspaceId, performed_by: performedBy,
    label: args.label.trim(), source: args.source.trim(),
    source_ref: args.sourceRef?.trim() || null, role,
    detail: args.detail?.trim() || null, performed_at: args.performedAt,
    cpd_minutes: args.cpdMinutes ?? null, portfolio: args.portfolio === true,
    created_by: args.actorId,
  }).select("id").single();
  if (error) {
    // s13's idempotency, refused BY NAME. The index name was read off a live refusal, not assumed, and
    // it folds case and whitespace -- "OpNote-302" and "  opnote-302 " are one reference.
    if (String(error.code) === "23505" || /ux_practice_ext_proc_source_ref/.test(String(error.message)))
      return { ok: false, status: 409, code: "DUPLICATE_EXTERNAL", message: "that reference is already in this person's record; the same procedure is not recorded twice" };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.external_procedure_recorded",
    payload: { externalProcedureId: data.id, performedBy, source: args.source.trim() }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

export async function removeExternalProcedure(admin: any, args: {
  workspaceId: string; id: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ deleted: true }>> {
  const { data: row, error: readError } = await admin.from("practice_external_procedure")
    .select("id, performed_by").eq("id", args.id).eq("workspace_id", args.workspaceId).maybeSingle();
  if (readError) return { ok: false, status: 500, code: "READ_FAILED", message: readError.message };
  if (!row) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (row.performed_by !== args.actorId)
    return { ok: false, status: 403, code: "NOT_YOURS", message: "that is somebody else's record" };

  // Keyed on the id AND the person -- the removeEntry lesson, applied before the bug this time.
  await admin.from("practice_external_procedure").delete().eq("id", row.id).eq("performed_by", args.actorId);
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.external_procedure_removed",
    payload: { externalProcedureId: row.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { deleted: true } };
}

// ── THE UNIFIED ACTIVITY RECORD ── CPR-PCA-HFE-012 s2/s10/s13 ────────────────────────────────────────
//
// One chronological record from TWO sources: procedures PROJECTED from practice_procedure, and the
// manually logged practice_clinical_activity rows. s13's duplicate protection is structural -- the
// procedure rows are READ, never copied, so a procedure recorded in an encounter cannot exist twice
// here and an edit to the encounter record is visible here on the next read. There is no procedure
// row of this page's own to drift.
//
// ⚠ THE TWO SOURCES FAIL SEPARATELY. A broken procedure read must not blank the logged activities, and
// vice versa -- and neither failure may render as "you did nothing" (this is a portfolio; "did nothing"
// is a claim somebody submits to a regulator). Each source carries its own {unavailable, detail}.
//
// ⚠ ONLY PROCEDURES WITH A performed_at ARE IN THE RECORD. Since migration 294 a procedure can be
// ORDERED or SCHEDULED -- future work, not work done -- and a portfolio of what somebody HAS DONE must
// not count intentions. The status still renders honestly (Performed / Attempted / Abandoned).

export type ActivityRecordFilter = {
  performedBy?: string;
  /** "procedure" narrows to the projected procedures; any ACTIVITY_KINDS code narrows to that kind. */
  kind?: string; fromDay?: string; toDay?: string; limit?: number;
};

export async function activityRecord(admin: any, workspaceId: string, filter: ActivityRecordFilter = {}): Promise<{
  items: any[]; truncated: boolean; limit: number;
  procedures: { unavailable: boolean; detail: string | null };
  activities: { unavailable: boolean; detail: string | null };
  /** Migration 302's third source. Fails separately for the same reason the first two do. */
  external: { unavailable: boolean; detail: string | null };
}> {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 999);
  const wantProcedures = !filter.kind || filter.kind === "procedure";
  const wantActivities = filter.kind !== "procedure";

  // The logged half rides the existing three-state read -- one query owner, not a second copy.
  const acts = wantActivities
    ? await listActivitiesResult(admin, workspaceId, {
      performedBy: filter.performedBy, kind: filter.kind || undefined,
      fromDay: filter.fromDay, toDay: filter.toDay, limit,
    })
    : { items: [] as any[], unavailable: false, detail: null, truncated: false, limit };

  let procItems: any[] = [];
  let procTruncated = false;
  let procUnavailable = false;
  let procDetail: string | null = null;
  if (wantProcedures) {
    let q = admin.from("practice_procedure")
      .select("id, label, status, performed_at, encounter_id, patient_id, performed_by, cpd_minutes, portfolio")
      .eq("workspace_id", workspaceId).not("performed_at", "is", null);
    if (filter.performedBy) q = q.eq("performed_by", filter.performedBy);
    if (filter.fromDay || filter.toDay) {
      const { timezone } = await workspaceClock(admin, workspaceId);
      if (filter.fromDay) q = q.gte("performed_at", zonedDayRange(filter.fromDay, timezone).startIso);
      if (filter.toDay) q = q.lt("performed_at", zonedDayRange(filter.toDay, timezone).endIso);
    }
    const { data, error } = await q.order("performed_at", { ascending: false }).limit(limit + 1);
    if (error) { procUnavailable = true; procDetail = error.message; }
    else {
      const all = (data ?? []) as any[];
      procTruncated = all.length > limit;
      procItems = procTruncated ? all.slice(0, limit) : all;
    }

    // s15: complication state comes from the procedure's own outcome records, nowhere else. Best-effort
    // BUT NEVER SILENTLY WRONG -- if outcomes cannot be read, the rows say "not read" rather than
    // rendering as complication-free, which would be an absence claim the read cannot support.
    if (procItems.length > 0) {
      const { data: outcomes, error: outErr } = await admin.from("practice_procedure_outcome")
        .select("procedure_id, outcome_type").in("procedure_id", procItems.map(p => p.id));
      const complicated = outErr
        ? null
        : new Set(((outcomes ?? []) as any[]).filter(o => o.outcome_type === "complication").map(o => o.procedure_id));
      procItems = procItems.map(p => ({
        ...p,
        hasComplication: complicated ? complicated.has(p.id) : false,
        complicationsUnread: !complicated,
      }));
    }
  }

  // s13's explicit external procedures (migration 302). Type: Procedure in the record (s9), external
  // in provenance (s12). They carry NO complication state -- complicationsAssessed says so, and the
  // screen renders "not assessed here" rather than complication-free.
  let extItems: any[] = [];
  let extTruncated = false;
  let extUnavailable = false;
  let extDetail: string | null = null;
  if (wantProcedures) {
    let q = admin.from("practice_external_procedure")
      .select("id, label, source, source_ref, role, detail, performed_at, performed_by, cpd_minutes, portfolio")
      .eq("workspace_id", workspaceId);
    if (filter.performedBy) q = q.eq("performed_by", filter.performedBy);
    if (filter.fromDay || filter.toDay) {
      const { timezone } = await workspaceClock(admin, workspaceId);
      if (filter.fromDay) q = q.gte("performed_at", zonedDayRange(filter.fromDay, timezone).startIso);
      if (filter.toDay) q = q.lt("performed_at", zonedDayRange(filter.toDay, timezone).endIso);
    }
    const { data, error } = await q.order("performed_at", { ascending: false }).limit(limit + 1);
    if (error) { extUnavailable = true; extDetail = error.message; }
    else {
      const all = (data ?? []) as any[];
      extTruncated = all.length > limit;
      extItems = extTruncated ? all.slice(0, limit) : all;
    }
  }

  const merged = [
    ...procItems.map(p => ({
      recordKind: "procedure" as const, external: false,
      id: p.id, kind: "procedure", kindLabel: "Procedure",
      title: p.label, occurredAt: p.performed_at,
      status: p.status, hasComplication: !!p.hasComplication, complicationsUnread: !!p.complicationsUnread,
      complicationsAssessed: !p.complicationsUnread,
      encounterId: p.encounter_id, performed_by: p.performed_by,
      cpd_minutes: p.cpd_minutes ?? null, portfolio: !!p.portfolio,
    })),
    ...extItems.map(x => ({
      recordKind: "procedure" as const, external: true,
      id: x.id, kind: "procedure", kindLabel: "Procedure",
      title: x.label, occurredAt: x.performed_at,
      status: null, hasComplication: false, complicationsUnread: false,
      complicationsAssessed: false,
      source: x.source, sourceRef: x.source_ref ?? null, role: x.role,
      detail: x.detail ?? null,
      encounterId: null, performed_by: x.performed_by,
      cpd_minutes: x.cpd_minutes ?? null, portfolio: !!x.portfolio,
    })),
    ...acts.items.map(a => ({ ...a, recordKind: "activity" as const, external: false, occurredAt: a.occurred_at })),
  ].sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));

  return {
    items: merged.length > limit ? merged.slice(0, limit) : merged,
    truncated: procTruncated || acts.truncated || extTruncated || merged.length > limit,
    limit,
    procedures: { unavailable: procUnavailable, detail: procDetail },
    activities: { unavailable: acts.unavailable, detail: acts.detail },
    external: { unavailable: extUnavailable, detail: extDetail },
  };
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

  // ⚠ 999, NOT 1000, AND THE OVERFLOW IS THE PROOF. PostgREST returns at most 1000 rows and reports no
  // error when it does, so a limit of 1000 coming back full is indistinguishable from a table with
  // exactly 1000 rows in it. Asking for one more than is wanted makes "there was more" knowable. This
  // matters here because a portfolio is a claim about EVERYTHING somebody did, and a portfolio that
  // silently stopped at a thousand understates the person it belongs to.
  const PORTFOLIO_ROW_CAP = 999;
  const [procRes, actRes, extRes] = await Promise.all([
    range("performed_at")(admin.from("practice_procedure")
      .select("id, status, procedure_type_id, label, performed_at, cpd_minutes, portfolio")
      .eq("workspace_id", workspaceId).eq("performed_by", userId)).limit(PORTFOLIO_ROW_CAP + 1),
    range("occurred_at")(admin.from("practice_clinical_activity")
      .select("id, kind, title, occurred_at, duration_minutes, participation, cpd_minutes, portfolio")
      .eq("workspace_id", workspaceId).eq("performed_by", userId)).limit(PORTFOLIO_ROW_CAP + 1),
    // Migration 302. Counted SEPARATELY from the encounter-derived figures -- the band's headline says
    // "captured automatically from your encounter records" and folding externals into it would make
    // that sentence false.
    range("performed_at")(admin.from("practice_external_procedure")
      .select("id, cpd_minutes, portfolio")
      .eq("workspace_id", workspaceId).eq("performed_by", userId)).limit(PORTFOLIO_ROW_CAP + 1),
  ]);

  // ⚠ AN UNREADABLE HALF IS NOT AN EMPTY HALF. The error was discarded here, so a failed procedure read
  // rendered as "0 procedures, 0 complications" -- a portfolio that says somebody has done nothing and
  // had no complications, on the strength of a query that never answered.
  const proceduresUnavailable = !!procRes.error;
  const activitiesUnavailable = !!actRes.error;
  const externalUnavailable = !!extRes.error;
  const allProcs = (procRes.data ?? []) as any[];
  const allActs = (actRes.data ?? []) as any[];
  const allExt = (extRes.data ?? []) as any[];
  const proceduresTruncated = allProcs.length > PORTFOLIO_ROW_CAP;
  const activitiesTruncated = allActs.length > PORTFOLIO_ROW_CAP;
  const externalTruncated = allExt.length > PORTFOLIO_ROW_CAP;
  const procs = allProcs.slice(0, PORTFOLIO_ROW_CAP);
  const acts = allActs.slice(0, PORTFOLIO_ROW_CAP);
  const exts = allExt.slice(0, PORTFOLIO_ROW_CAP);

  const performed = procs.filter(p => p.status === "PERFORMED");
  const { data: outcomes } = performed.length
    ? await admin.from("practice_procedure_outcome")
      .select("procedure_id, outcome_type, severity").eq("workspace_id", workspaceId).in("procedure_id", performed.map(p => p.id))
    : { data: [] };
  const outcomeRows = (outcomes ?? []) as any[];
  const withComplication = new Set(outcomeRows.filter(o => o.outcome_type === "complication").map(o => o.procedure_id));

  const byKind = ACTIVITY_KINDS.map(([k, label]) => ({
    kind: k, label, total: acts.filter(a => a.kind === k).length,
    minutes: acts.filter(a => a.kind === k).reduce((n, a) => n + (a.duration_minutes ?? 0), 0),
  })).filter(r => r.total > 0);

  return {
    // ⚠ CARRIED ON THE PAYLOAD, NOT ONLY LOGGED. A screen cannot distinguish an empty portfolio from an
    // unreadable one unless the payload says which, and this is the field that lets it.
    unavailable: proceduresUnavailable || activitiesUnavailable || externalUnavailable,
    unavailableDetail: [
      procRes.error ? `procedures: ${procRes.error.message}` : null,
      actRes.error ? `activities: ${actRes.error.message}` : null,
      extRes.error ? `external procedures: ${extRes.error.message}` : null,
    ].filter(Boolean).join("; ") || null,
    truncated: proceduresTruncated || activitiesTruncated || externalTruncated,
    procedures: {
      total: procs.length,
      performed: performed.length,
      abandoned: procs.filter(p => p.status === "ABANDONED").length,
      // "1 of 48", never "2.1%".
      withComplication: withComplication.size,
      complicationDenominator: performed.length,
      outcomesRecorded: new Set(outcomeRows.map(o => o.procedure_id)).size,
      // Migration 302, kept OUT of `performed`: those figures are encounter-derived and say so on the
      // screen. External procedures carry no complication state, so they must not join a denominator.
      external: exts.length,
    },
    activities: { total: acts.length, byKind },
    cpdMinutes:
      procs.reduce((n, p) => n + (p.cpd_minutes ?? 0), 0) +
      acts.reduce((n, a) => n + (a.cpd_minutes ?? 0), 0) +
      exts.reduce((n, x) => n + (x.cpd_minutes ?? 0), 0),
    portfolioItems: procs.filter(p => p.portfolio).length + acts.filter(a => a.portfolio).length
      + exts.filter(x => x.portfolio).length,
    // Stated in the payload, not only in the UI, so a client cannot render this as a competency record.
    competencyLinked: false,
    competencyNote: "Not linked to the platform's competency records; this is the practice's own log.",
  };
}

/** Mark a procedure, activity or external procedure as portfolio evidence, with the CPD time it is worth. */
export async function setPortfolio(admin: any, args: {
  workspaceId: string; subject: "procedure" | "activity" | "external_procedure"; id: string;
  portfolio: boolean; cpdMinutes?: number | null; actorId: string; correlationId: string;
}): Promise<EngineResult<{ portfolio: boolean }>> {
  const table = args.subject === "procedure" ? "practice_procedure"
    : args.subject === "external_procedure" ? "practice_external_procedure"
      : "practice_clinical_activity";
  // ONLY AN ACTIVITY HAS A DURATION. practice_procedure has never had a duration_minutes column -- the
  // catalogue carries typical_duration_minutes, the performed procedure carries nothing. Selecting it
  // anyway made PostgREST error, and because the error was DISCARDED the row came back null and this
  // returned "Not found" for a procedure that plainly existed: claiming CPD against a procedure had
  // never once worked, and said the procedure did not exist.
  const columns = args.subject === "activity" ? "id, performed_by, duration_minutes" : "id, performed_by";
  const { data: row, error: readError } = await admin.from(table)
    .select(columns).eq("id", args.id).eq("workspace_id", args.workspaceId).maybeSingle();
  // THE ERROR IS NOT THE SAME THING AS ABSENCE, and conflating them is what hid this for four modules.
  if (readError)
    return { ok: false, status: 500, code: "READ_FAILED", message: `could not read the ${args.subject}: ${readError.message}` };
  if (!row) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  // A PORTFOLIO IS THE PERSON'S OWN. Somebody else claiming an entry into it -- or out of it -- is the
  // one thing a portfolio must not allow, because its whole worth is that it says what THEY did.
  if (row.performed_by !== args.actorId)
    return { ok: false, status: 403, code: "NOT_YOURS", message: "only the person who did it can put it in their portfolio" };

  if (args.cpdMinutes != null) {
    if (!Number.isInteger(args.cpdMinutes) || args.cpdMinutes < 0 || args.cpdMinutes > 1440)
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "CPD time must be a whole number of minutes, up to 1440" };
    // Only an activity has a duration to exceed; a procedure's CPD claim is bounded by the 1440 above.
    if (args.subject === "activity" && row.duration_minutes != null && args.cpdMinutes > row.duration_minutes)
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
