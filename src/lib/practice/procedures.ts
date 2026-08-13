import { audit } from "@/lib/practice/audit";
import { editableEncounter, type EngineResult } from "@/lib/practice/encounters";
import {
  PROCEDURE_CATEGORIES, SIDED_LATERALITIES, LATERALITIES, CONSENT_STATUSES,
  OUTCOME_TYPES, OUTCOME_SEVERITIES, SEVERITY_REQUIRED_FOR,
  PROCEDURE_STATUSES, PROCEDURE_STATUSES_NOT_DONE, PROCEDURE_STATUSES_NEEDING_REASON,
} from "@/lib/practice/procedure-constants";

// CPR-150 PROCEDURE AND CLINICAL ACTIVITY -- what was actually DONE to a person, as distinct from what
// was decided for them. Migration 197's header explains at length why this is not practice_treatment;
// the short version is that a treatment row saying "excision, planned" is not evidence that anything
// happened, and a procedure row is.
//
// TWO REFUSALS IN THIS FILE ARE CLINICAL SAFETY RULES, NOT VALIDATION:
//
//   LATERALITY  a catalogue entry marked `sided` cannot be recorded without a side. Not a warning, not
//               a default -- a refusal. Wrong-site procedures are the canonical never-event, and the
//               moment a side becomes optional the field starts being skipped on busy days.
//               `not_applicable` is refused too, because it is precisely what somebody picks to get
//               past a required field they do not want to think about.
//
//   CONSENT     defaults to not_recorded and never to obtained. A column defaulting to true
//               manufactures a legal claim about a conversation nobody can evidence. Where the
//               catalogue says consent is required, not_recorded is refused -- but `refused` is a
//               perfectly good answer, because a patient declining is a real and recordable event.
//
// AN OUTCOME IS LEARNED LATER, AND ITS ENCOUNTER IS THE ONE THAT NOTICED. recordOutcome guards the
// OBSERVING encounter, not the one that performed the procedure -- the performing encounter is signed
// and immutable by then, which is the entire reason outcomes are their own append-only rows.

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

// ── THE CATALOGUE ────────────────────────────────────────────────────────────────────────────────────

/** Platform entries plus this workspace's own. Two queries, for the reason listTemplates gives. */
export async function listProcedureTypes(admin: any, workspaceId: string, opts: {
  category?: string; includeUnpublished?: boolean;
} = {}) {
  const statuses = opts.includeUnpublished ? ["draft", "published"] : ["published"];
  const build = (q: any) => {
    let out = q.select("id, workspace_id, code, name, category, sided, consent_required, typical_duration_minutes, aftercare, status, version")
      .in("status", statuses);
    if (opts.category) out = out.eq("category", opts.category);
    return out.order("name");
  };
  const [platform, mine] = await Promise.all([
    build(admin.from("practice_procedure_type")).is("workspace_id", null),
    build(admin.from("practice_procedure_type")).eq("workspace_id", workspaceId),
  ]);
  return [...((platform.data ?? []) as any[]), ...((mine.data ?? []) as any[])]
    .map(r => ({ ...r, scope: r.workspace_id === null ? "platform" : "workspace" }));
}

async function resolveProcedureType(admin: any, workspaceId: string, typeId: string) {
  const { data } = await admin.from("practice_procedure_type")
    .select("id, workspace_id, name, sided, consent_required, status, aftercare").eq("id", typeId).maybeSingle();
  if (!data) return null;
  if (data.workspace_id !== null && data.workspace_id !== workspaceId) return null;
  return data;
}

export async function createProcedureType(admin: any, args: {
  workspaceId: string; code: string; name: string; category?: string;
  sided?: boolean; consentRequired?: boolean; typicalDurationMinutes?: number; aftercare?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  const code = args.code.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  if (!code) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a code is required" };
  if (!args.name.trim()) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a name is required" };

  const { data: clash } = await admin.from("practice_procedure_type")
    .select("id").eq("code", code).is("workspace_id", null).maybeSingle();
  if (clash) return { ok: false, status: 409, code: "CODE_RESERVED", message: `"${code}" is the code of a supplied procedure; choose another` };

  const category = PROCEDURE_CATEGORIES.some(([c]) => c === args.category) ? args.category! : "other";
  const { data: t, error } = await admin.from("practice_procedure_type").insert({
    workspace_id: args.workspaceId, code, name: args.name.trim(), category,
    sided: args.sided === true, consent_required: args.consentRequired === true,
    typical_duration_minutes: args.typicalDurationMinutes ?? null,
    aftercare: args.aftercare ?? null, status: "draft",
    created_by: args.actorId, updated_by: args.actorId,
  }).select("id").single();
  if (error) {
    if (/duplicate|unique/i.test(error.message))
      return { ok: false, status: 409, code: "CODE_IN_USE", message: `this workspace already has a procedure coded "${code}"` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.procedure_type_created",
    payload: { procedureTypeId: t.id, code, sided: args.sided === true }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: t.id as string } };
}

export async function setProcedureTypeStatus(admin: any, args: {
  workspaceId: string; procedureTypeId: string; status: "draft" | "published" | "retired";
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string; version: number }>> {
  const { data: t } = await admin.from("practice_procedure_type")
    .select("id, workspace_id, status, version").eq("id", args.procedureTypeId).maybeSingle();
  if (!t) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (t.workspace_id === null)
    return { ok: false, status: 403, code: "PLATFORM_PROCEDURE", message: "supplied procedures are read-only; copy it into your practice to change it" };
  if (t.workspace_id !== args.workspaceId) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const version = args.status === "published" && t.status !== "published" ? t.version + 1 : t.version;
  const { error } = await admin.from("practice_procedure_type")
    .update({ status: args.status, version, updated_at: nowIso(), updated_by: args.actorId }).eq("id", t.id);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: `practice.procedure_type_${args.status}`,
    payload: { procedureTypeId: t.id, version }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: args.status, version } };
}

// ── PERFORMING ───────────────────────────────────────────────────────────────────────────────────────

export async function recordProcedure(admin: any, args: {
  workspaceId: string; encounterId: string; procedureTypeId?: string | null; label?: string;
  treatmentId?: string | null; site?: string; laterality?: string; indication?: string;
  consentStatus?: string; consentNote?: string; anaesthesia?: string; materials?: string;
  immediateOutcome?: string; status?: string; abandonedReason?: string; performedAt?: string;
  /** CPR-TRT-PROC-003 s10. Required by the engine when the status is SCHEDULED -- see recordProcedure. */
  scheduledAt?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; label: string }>> {
  const guard = await editableEncounter(admin, args.workspaceId, args.encounterId);
  if (!guard.ok) return guard;

  const type = args.procedureTypeId ? await resolveProcedureType(admin, args.workspaceId, args.procedureTypeId) : null;
  if (args.procedureTypeId && !type) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (type && type.status !== "published")
    return { ok: false, status: 422, code: "PROCEDURE_NOT_PUBLISHED", message: "that procedure is not published" };

  // The label is written down, not joined -- see migration 197 s2. From the catalogue when there is one,
  // from the practitioner when there is not.
  const label = (args.label ?? type?.name ?? "").trim();
  if (!label) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "name the procedure, or choose one from the catalogue" };

  const laterality = LATERALITIES.some(([l]) => l === args.laterality) ? args.laterality! : "not_applicable";

  // SAFETY RULE 1. See the header.
  if (type?.sided && !SIDED_LATERALITIES.includes(laterality))
    return {
      ok: false, status: 422, code: "LATERALITY_REQUIRED",
      message: `${type.name} has sides; record left, right or bilateral`,
    };

  const consentStatus = CONSENT_STATUSES.some(([c]) => c === args.consentStatus) ? args.consentStatus! : "not_recorded";
  // SAFETY RULE 2. `refused` passes deliberately -- a patient declining is a real recordable event, and
  // the record should be able to say so rather than forcing a false "obtained".
  if (type?.consent_required && consentStatus === "not_recorded")
    return {
      ok: false, status: 422, code: "CONSENT_REQUIRED",
      message: `${type.name} requires consent; record whether it was obtained, refused, or not required`,
    };

  // ⚠ THE STATUS IS VALIDATED, NOT COERCED, AND THAT IS A BUG FIX RATHER THAN A REFACTOR. This line
  // read `args.status === "ABANDONED" ? "ABANDONED" : "PERFORMED"`, so ANY unrecognised value -- a
  // typo, a stale client, a renamed constant -- silently became PERFORMED. That is the single most
  // consequential value in the set: the record would assert that a procedure was carried out on a
  // patient because a string did not match. With six statuses instead of two the odds of a near-miss
  // rise sharply, so an unknown status is now refused by name.
  const status = (args.status ?? "PERFORMED").trim();
  if (!PROCEDURE_STATUSES.some(([s]) => s === status))
    return {
      ok: false, status: 400, code: "VALIDATION_ERROR",
      message: `${status} is not a procedure status`,
    };

  const needsReason = (PROCEDURE_STATUSES_NEEDING_REASON as readonly string[]).includes(status);
  if (needsReason && !(args.abandonedReason ?? "").trim())
    return {
      ok: false, status: 400, code: "VALIDATION_ERROR",
      message: status === "ATTEMPTED"
        ? "say why the procedure was not completed"
        : `say why the procedure was ${status.toLowerCase()}`,
    };

  // ⚠ A SCHEDULED PROCEDURE NEEDS THE TIME IT IS SCHEDULED FOR, and defaulting it to now() would be
  // worse than refusing: it would put a meaningless appointment on the record and satisfy migration
  // 294's constraint while doing so. Refusing costs one round trip and says exactly what is missing.
  if (status === "SCHEDULED" && !(args.scheduledAt ?? "").trim())
    return {
      ok: false, status: 400, code: "VALIDATION_ERROR",
      message: "a scheduled procedure needs the date and time it is scheduled for",
    };

  const notDone = (PROCEDURE_STATUSES_NOT_DONE as readonly string[]).includes(status);

  // A named plan must belong to this encounter -- linking a procedure to another visit's treatment would
  // make the "was this carried out" question unanswerable in both directions.
  let treatmentId: string | null = null;
  if (args.treatmentId) {
    const { data: t } = await admin.from("practice_treatment")
      .select("id, encounter_id").eq("id", args.treatmentId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!t) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (t.encounter_id !== args.encounterId)
      return { ok: false, status: 422, code: "TREATMENT_ENCOUNTER_MISMATCH", message: "that plan belongs to a different encounter" };
    treatmentId = t.id;
  }

  const { data: p, error } = await admin.from("practice_procedure").insert({
    workspace_id: args.workspaceId, patient_id: guard.data.patient_id, encounter_id: args.encounterId,
    treatment_id: treatmentId, procedure_type_id: type?.id ?? null, label,
    site: args.site ?? null, laterality, indication: args.indication ?? null,
    consent_status: consentStatus, consent_note: args.consentNote ?? null,
    anaesthesia: args.anaesthesia ?? null, materials: args.materials ?? null,
    immediate_outcome: args.immediateOutcome ?? null,
    status, abandoned_reason: needsReason ? args.abandonedReason!.trim() : null,
    // ⚠ EACH STATUS CARRIES ONLY THE TIMESTAMP THAT IS TRUE OF IT. performed_at was set on every insert,
    // which was harmless while the only statuses meant the act had happened, and becomes a false claim
    // the moment ORDERED and SCHEDULED exist -- a record saying the procedure was carried out, at a
    // precise moment, on a patient it has not been done to. Migration 294 dropped the column default for
    // this same reason; this is the other half of it. performed_by follows the same rule: nobody
    // performed a procedure that has not been performed.
    performed_at: notDone ? null : (args.performedAt ?? nowIso()),
    performed_by: notDone ? null : args.actorId,
    ordered_at: status === "ORDERED" ? (args.performedAt ?? nowIso()) : null,
    scheduled_at: status === "SCHEDULED" ? args.scheduledAt!.trim() : null,
    created_by: args.actorId,
  }).select("id, label").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.procedure_recorded",
    payload: { procedureId: p.id, encounterId: args.encounterId, label, laterality, status },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: p.id as string, label: p.label as string } };
}

/**
 * Record something learned about a procedure after the fact.
 *
 * THE ENCOUNTER GUARDED HERE IS THE OBSERVING ONE. The procedure's own encounter is signed by now --
 * that is the situation this table exists for. Guarding the wrong one would make it impossible to
 * record the complication that the whole design is about.
 */
export async function recordProcedureOutcome(admin: any, args: {
  workspaceId: string; procedureId: string; observedAtEncounterId?: string | null;
  outcomeType: string; severity?: string; detail: string; observedOn?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!args.detail.trim())
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "say what was observed" };
  if (!OUTCOME_TYPES.some(([t]) => t === args.outcomeType))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `outcomeType must be one of: ${OUTCOME_TYPES.map(([t]) => t).join(", ")}` };

  const { data: proc } = await admin.from("practice_procedure")
    .select("id, patient_id, label").eq("id", args.procedureId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!proc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  let observedAt: string | null = null;
  if (args.observedAtEncounterId) {
    const guard = await editableEncounter(admin, args.workspaceId, args.observedAtEncounterId);
    if (!guard.ok) return guard;
    if (guard.data.patient_id !== proc.patient_id)
      return { ok: false, status: 422, code: "ENCOUNTER_PATIENT_MISMATCH", message: "that encounter belongs to a different patient" };
    observedAt = guard.data.id;
  }

  // Severity belongs to a complication and to nothing else. Enforced BOTH ways, so a complication cannot
  // be filed with no severity and a "healing" note cannot be filed as severe.
  const isComplication = SEVERITY_REQUIRED_FOR.includes(args.outcomeType);
  const severity = (OUTCOME_SEVERITIES as readonly string[]).includes(args.severity ?? "") ? args.severity! : null;
  if (isComplication && !severity)
    return { ok: false, status: 400, code: "SEVERITY_REQUIRED", message: `severity must be one of: ${OUTCOME_SEVERITIES.join(", ")}` };
  if (!isComplication && severity)
    return { ok: false, status: 400, code: "SEVERITY_NOT_APPLICABLE", message: "severity describes a complication; this outcome is not one" };

  const { data: o, error } = await admin.from("practice_procedure_outcome").insert({
    workspace_id: args.workspaceId, procedure_id: proc.id, observed_at_encounter_id: observedAt,
    outcome_type: args.outcomeType, severity, detail: args.detail.trim(),
    ...(args.observedOn ? { observed_on: args.observedOn } : {}),
    recorded_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.procedure_outcome_recorded",
    payload: { procedureId: proc.id, outcomeId: o.id, outcomeType: args.outcomeType, severity },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: o.id as string } };
}

// ── READING ──────────────────────────────────────────────────────────────────────────────────────────

/** Procedures with their outcomes attached, for an encounter or a patient. */
export async function listProcedures(admin: any, workspaceId: string, filter: {
  encounterId?: string; patientId?: string; limit?: number;
} = {}) {
  let q = admin.from("practice_procedure")
    .select("id, patient_id, encounter_id, treatment_id, procedure_type_id, label, site, laterality, indication, consent_status, consent_note, anaesthesia, materials, immediate_outcome, status, abandoned_reason, performed_at")
    .eq("workspace_id", workspaceId);
  if (filter.encounterId) q = q.eq("encounter_id", filter.encounterId);
  if (filter.patientId) q = q.eq("patient_id", filter.patientId);

  const { data } = await q.order("performed_at", { ascending: false }).limit(filter.limit ?? 100);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const { data: outcomes } = await admin.from("practice_procedure_outcome")
    .select("id, procedure_id, observed_at_encounter_id, outcome_type, severity, detail, observed_on").eq("workspace_id", workspaceId)
    .in("procedure_id", rows.map(r => r.id)).order("observed_on");
  const byProcedure: Record<string, any[]> = {};
  for (const o of (outcomes ?? []) as any[]) (byProcedure[o.procedure_id] ??= []).push(o);

  return rows.map(r => ({
    ...r,
    outcomes: byProcedure[r.id] ?? [],
    // Surfaced rather than left to every caller to recompute: a procedure with an unresolved
    // complication is the one a reader most needs to notice.
    hasComplication: (byProcedure[r.id] ?? []).some(o => o.outcome_type === "complication"),
  }));
}

/**
 * CPR-150's "clinical activity": what this practice actually does, counted from real rows.
 *
 * NO TARGETS, NO BENCHMARKS, NO TRENDS. Counting what happened is arithmetic over the record. Saying
 * whether it is a lot, or improving, would require a comparison this product has not been given.
 */
export async function procedureActivity(admin: any, workspaceId: string, sinceIso?: string) {
  let q = admin.from("practice_procedure")
    .select("id, label, procedure_type_id, status, performed_at, laterality, consent_status")
    .eq("workspace_id", workspaceId);
  if (sinceIso) q = q.gte("performed_at", sinceIso);

  const { data } = await q.order("performed_at", { ascending: false }).limit(1000);
  const rows = (data ?? []) as any[];

  const byLabel = new Map<string, { label: string; performed: number; abandoned: number; lastAt: string }>();
  for (const r of rows) {
    const entry = byLabel.get(r.label) ?? { label: r.label, performed: 0, abandoned: 0, lastAt: r.performed_at };
    // ⚠ COUNTED BY WHAT EACH STATUS MEANS, NOT BY `else`. This read "ABANDONED, otherwise performed",
    // which was exhaustive while there were two statuses and silently wrong the moment there were six:
    // an ORDERED, SCHEDULED, CANCELLED or DECLINED procedure would have been counted as PERFORMED and
    // inflated a practitioner portfolio with work nobody did. Only PERFORMED counts as performed.
    if (r.status === "PERFORMED") entry.performed++;
    else if (r.status === "ATTEMPTED" || r.status === "ABANDONED") entry.abandoned++;
    else continue;
    if (r.performed_at > entry.lastAt) entry.lastAt = r.performed_at;
    byLabel.set(r.label, entry);
  }

  const ids = rows.map(r => r.id);
  const { data: complications } = ids.length
    ? await admin.from("practice_procedure_outcome")
      .select("procedure_id, severity").eq("workspace_id", workspaceId).eq("outcome_type", "complication").in("procedure_id", ids)
    : { data: [] };

  return {
    total: rows.length,
    byLabel: [...byLabel.values()].sort((a, b) => b.performed + b.abandoned - (a.performed + a.abandoned)),
    complications: ((complications ?? []) as any[]).length,
    // Reported as a count and a denominator rather than a rate. A "2.4% complication rate" over
    // forty-one procedures is a number that sounds like a statistic and is not one.
    complicationsOf: rows.length,
    consentNotRecorded: rows.filter(r => r.consent_status === "not_recorded").length,
    sinceIso: sinceIso ?? null,
  };
}

export async function getProcedure(admin: any, workspaceId: string, procedureId: string) {
  const { data: procedure } = await admin.from("practice_procedure")
    .select("*").eq("id", procedureId).eq("workspace_id", workspaceId).maybeSingle();
  if (!procedure) return null;

  const [{ data: outcomes }, { data: patient }, { data: type }] = await Promise.all([
    admin.from("practice_procedure_outcome")
      .select("id, observed_at_encounter_id, outcome_type, severity, detail, observed_on, created_at").eq("workspace_id", workspaceId)
      .eq("procedure_id", procedureId).order("observed_on"),
    admin.from("practice_patient").select("id, display_name").eq("workspace_id", workspaceId).eq("id", procedure.patient_id).maybeSingle(),
    procedure.procedure_type_id
      ? admin.from("practice_procedure_type").select("id, name, aftercare, sided, consent_required").eq("id", procedure.procedure_type_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return { procedure, outcomes: outcomes ?? [], patient, type: type ?? null };
}
