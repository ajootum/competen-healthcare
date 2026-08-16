import { audit } from "@/lib/practice/audit";
import { editableEncounter, type EngineResult } from "@/lib/practice/encounters";
import {
  PROCEDURE_CATEGORIES, SIDED_LATERALITIES, LATERALITIES, CONSENT_STATUSES,
  OUTCOME_TYPES, OUTCOME_SEVERITIES, SEVERITY_REQUIRED_FOR,
  PROCEDURE_STATUSES, PROCEDURE_STATUSES_NOT_DONE, PROCEDURE_STATUSES_NEEDING_REASON,
  parseDetailFields, detailFieldIssues,
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
  /** The settings screen needs the DISABLED rows too -- hiding them there would make a hidden
      procedure unrecoverable from the very screen that hides it. Capture surfaces never set this. */
  includeDisabled?: boolean;
} = {}) {
  const statuses = opts.includeUnpublished ? ["draft", "published"] : ["published"];
  const build = (q: any) => {
    // ⚠ THE RULE COLUMNS TRAVEL WITH THE LIST, because the screen decides what to DRAW from them. This
    // select omitting one is the same failure as resolveProcedureType omitting one: the rule arrives
    // undefined and reads as "no rule", except here it silently hides or shows a field rather than
    // silently skipping a refusal.
    let out = q.select("id, workspace_id, code, name, category, sided, consent_required, typical_duration_minutes, aftercare, status, version, "
      + "site_rule, laterality_rule, consent_rule, allowed_lateralities, allowed_statuses, default_status, outcome_required, detail_fields")
      .in("status", statuses);
    if (opts.category) out = out.eq("category", opts.category);
    return out.order("name");
  };
  const [platform, mine, activation] = await Promise.all([
    build(admin.from("practice_procedure_type")).is("workspace_id", null),
    build(admin.from("practice_procedure_type")).eq("workspace_id", workspaceId),
    // CPR-PROC-HFE-005 s20 (migration 297). The catalogue's nullable workspace_id has always let a
    // practice ADD entries; it has never let one hide or rename a supplied entry, which is why a
    // practice that does no obstetrics has always had obstetric procedures in its search results.
    admin.from("practice_procedure_type_activation")
      .select("procedure_type_id, enabled, local_display_name, sort_order")
      .eq("workspace_id", workspaceId),
  ]);

  // ⚠ A FAILED ACTIVATION READ MUST NOT SILENTLY DISABLE THE CATALOGUE, NOR SILENTLY ENABLE IT. The
  // table records only DEPARTURES from the default, so `error` and "no rows" are indistinguishable in
  // the data itself -- and treating an error as "no departures" would quietly re-enable everything a
  // practice had switched off. The offering is left whole and the failure is reported on the row, so a
  // caller can say so rather than guess.
  const overrides = new Map<string, any>();
  for (const a of ((activation.data ?? []) as any[])) overrides.set(a.procedure_type_id, a);
  const activationUnavailable = !!activation.error;

  return [...((platform.data ?? []) as any[]), ...((mine.data ?? []) as any[])]
    .map(r => {
      const o = overrides.get(r.id);
      return {
        ...r,
        scope: r.workspace_id === null ? "platform" : "workspace",
        // The local name overrides the display only. `name` is untouched, because migration 197 writes
        // the label DOWN onto each procedure event and a renamed catalogue entry must not rewrite
        // history -- the local name is what this practice calls it from now on, not what it called it.
        name: (o?.local_display_name ?? "").trim() || r.name,
        catalogueName: r.name,
        enabled: o ? o.enabled !== false : true,
        sortOrder: o?.sort_order ?? null,
        activationUnavailable,
      };
    })
    .filter(r => opts.includeDisabled || r.enabled)
    .sort((a, b) => {
      if (a.sortOrder !== null && b.sortOrder !== null && a.sortOrder !== b.sortOrder)
        return a.sortOrder - b.sortOrder;
      if (a.sortOrder !== null && b.sortOrder === null) return -1;
      if (a.sortOrder === null && b.sortOrder !== null) return 1;
      return String(a.name).localeCompare(String(b.name));
    });
}

/**
 * ⚠ ONE COLUMN LIST, BECAUSE A RULE THIS SELECT FORGETS IS A RULE THAT SILENTLY STOPS BEING ENFORCED.
 * `resolveProcedureType` feeds every refusal in recordProcedure. A column missing from it arrives as
 * `undefined`, and `undefined` reads as "no rule" in every check below -- which is exactly how this tab
 * shipped with `sided` unreachable, by a different route. Migration 297 added six more rules to forget.
 */
const PROCEDURE_TYPE_RULE_COLUMNS =
  "id, workspace_id, name, sided, consent_required, status, aftercare, site_rule, laterality_rule, "
  + "consent_rule, allowed_lateralities, allowed_statuses, default_status, outcome_required, detail_fields";

async function resolveProcedureType(admin: any, workspaceId: string, typeId: string) {
  const { data } = await admin.from("practice_procedure_type")
    .select(PROCEDURE_TYPE_RULE_COLUMNS).eq("id", typeId).maybeSingle();
  if (!data) return null;
  if (data.workspace_id !== null && data.workspace_id !== workspaceId) return null;
  return data;
}

/**
 * The s8 detail answers that are actually going to be written, with their labels beside them.
 *
 * ⚠ ONLY WHAT THE CATALOGUE DECLARED. A caller can post any keys it likes; anything not in
 * `detail_fields` is dropped rather than stored, so this table cannot become an unschema'd bag of
 * whatever a client felt like sending. Blank answers are dropped too -- a row whose value_text is empty
 * would fail the column's own check and says nothing anyway.
 */
function detailValuesFor(type: any, values: Record<string, string> | undefined) {
  if (!values) return [];
  return parseDetailFields(type?.detail_fields)
    .map(f => ({ key: f.key, label: f.label, value: (values[f.key] ?? "").trim() }))
    .filter(d => d.value.length > 0 && d.value.length <= 500);
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
  /**
   * CPR-PROC-HFE-005 s8. Answers to the procedure-specific fields the catalogue declares, keyed by
   * field key. Anything not declared on the type is dropped rather than stored.
   */
  details?: Record<string, string>;
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

  // ⚠ SAFETY RULE 1, AND MIGRATION 297 DID NOT REPLACE THE BOOLEAN -- IT ADDED A SECOND WAY TO SAY YES.
  //
  // `sided` is the wrong-site control and it is the oldest thing in this file. 297 added
  // `laterality_rule` because s20 needs a third state (not_applicable) that a boolean cannot express,
  // and the backfill set the two consistently. But a catalogue editor, a bad import or a hand-run UPDATE
  // can put them out of step, and only one direction of that is survivable: the check is an OR, so a
  // stale boolean can only ever ADD a refusal. If they ever disagree, the answer is the stricter one.
  const requiresSide = type?.sided === true || type?.laterality_rule === "required";
  if (requiresSide && !SIDED_LATERALITIES.includes(laterality))
    return {
      ok: false, status: 422, code: "LATERALITY_REQUIRED",
      message: `${type!.name} has sides; record left, right or bilateral`,
    };

  // s9: "show only valid configured choices such as Left, Right or Bilateral." An empty list is NO
  // RESTRICTION, not no choices -- see migration 297's header for why it is not seeded with all three.
  const allowedLat: string[] = Array.isArray(type?.allowed_lateralities) ? type!.allowed_lateralities : [];
  if (allowedLat.length > 0 && SIDED_LATERALITIES.includes(laterality) && !allowedLat.includes(laterality))
    return {
      ok: false, status: 422, code: "LATERALITY_NOT_ALLOWED",
      message: `${type!.name} is recorded as ${allowedLat.join(" or ")}, not ${laterality}`,
    };

  // s9 and s21: site follows the same required / optional / not-applicable model. Checked with btrim
  // rather than a null test -- a blank string is not null, which is migration 256's scar.
  if (type?.site_rule === "required" && !(args.site ?? "").trim())
    return {
      ok: false, status: 422, code: "SITE_REQUIRED",
      message: `${type.name} needs the site it was done on`,
    };

  const consentStatus = CONSENT_STATUSES.some(([c]) => c === args.consentStatus) ? args.consentStatus! : "not_recorded";
  // SAFETY RULE 2, with the same stricter-of-two rule as laterality above. `refused` passes
  // deliberately -- a patient declining is a real recordable event, and the record should be able to
  // say so rather than forcing a false "obtained".
  const requiresConsent = type?.consent_required === true || type?.consent_rule === "required";
  if (requiresConsent && consentStatus === "not_recorded")
    return {
      ok: false, status: 422, code: "CONSENT_REQUIRED",
      message: `${type!.name} requires consent; record whether it was obtained, refused, or not required`,
    };

  // ⚠ THE STATUS IS VALIDATED, NOT COERCED, AND THAT IS A BUG FIX RATHER THAN A REFACTOR. This line
  // read `args.status === "ABANDONED" ? "ABANDONED" : "PERFORMED"`, so ANY unrecognised value -- a
  // typo, a stale client, a renamed constant -- silently became PERFORMED. That is the single most
  // consequential value in the set: the record would assert that a procedure was carried out on a
  // patient because a string did not match. With six statuses instead of two the odds of a near-miss
  // rise sharply, so an unknown status is now refused by name.
  //
  // ⚠ THE CATALOGUE'S DEFAULT APPLIES ONLY WHEN THE CALLER SAID NOTHING. `args.status ?? default` --
  // never an override. A procedure the practitioner explicitly marked ORDERED must not become PERFORMED
  // because the catalogue prefers it, which is the same class of failure as the coercion this line
  // already carries a warning about.
  const status = (args.status ?? type?.default_status ?? "PERFORMED").trim();
  if (!PROCEDURE_STATUSES.some(([s]) => s === status))
    return {
      ok: false, status: 400, code: "VALIDATION_ERROR",
      message: `${status} is not a procedure status`,
    };

  // s11 and s20's per-procedure lifecycle. Empty means unrestricted, as everywhere in 297.
  const allowedStatuses: string[] = Array.isArray(type?.allowed_statuses) ? type!.allowed_statuses : [];
  if (allowedStatuses.length > 0 && !allowedStatuses.includes(status))
    return {
      ok: false, status: 422, code: "STATUS_NOT_ALLOWED",
      message: `${type!.name} cannot be recorded as ${status.toLowerCase()}`,
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

  // ⚠ s14's OUTCOME REQUIREMENT, DEMANDED ONLY WHERE SOMETHING ACTUALLY HAPPENED. "Where a configured
  // procedure requires outcome documentation, surface the field automatically" -- but asking what the
  // outcome was of a procedure that is merely ORDERED or was DECLINED invites an answer that
  // contradicts the status sitting beside it. notDone is the engine's own list, so the two cannot drift.
  if (type?.outcome_required && !notDone && !(args.immediateOutcome ?? "").trim())
    return {
      ok: false, status: 422, code: "OUTCOME_REQUIRED",
      message: `${type.name} needs its immediate outcome recorded`,
    };

  // s8's configured fields, refused BEFORE the insert. detailFieldIssues is the same function the
  // screen's readiness indicator calls, so the words a practitioner reads here and the words they read
  // on the working item come from one place and cannot describe the same fault differently.
  const detailIssues = detailFieldIssues(parseDetailFields(type?.detail_fields), args.details);
  if (detailIssues.length > 0)
    return {
      ok: false, status: 422, code: "PROCEDURE_DETAIL_REQUIRED",
      message: `${type!.name} needs ${detailIssues.join(", ")}`,
    };

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

  // ── s8's PROCEDURE-SPECIFIC DETAIL FIELDS ──────────────────────────────────────────────────────
  //
  // ⚠ THE LABEL IS WRITTEN DOWN BESIDE THE VALUE, exactly as practice_procedure.label is written down
  // rather than joined (migration 197 s2). A field definition renamed or deleted from the catalogue
  // next year must not be able to rewrite, or orphan, what somebody recorded today.
  //
  // ⚠ AND A REQUIRED DETAIL FIELD IS REFUSED BEFORE THE INSERT, NOT AFTER -- see the validation loop
  // above. This block only writes what has already been accepted.
  const detailRows = detailValuesFor(type, args.details);
  if (detailRows.length > 0) {
    const { error: detailError } = await admin.from("practice_procedure_detail").insert(
      detailRows.map(d => ({
        workspace_id: args.workspaceId, procedure_id: p.id,
        field_key: d.key, field_label: d.label, value_text: d.value, created_by: args.actorId,
      })));
    // ⚠ THE PROCEDURE IS NOT ROLLED BACK IF THE DETAIL WRITE FAILS, AND THAT IS THE SAFER DIRECTION.
    // The procedure event is the clinical fact -- that something was done to a patient. A configured
    // extra field is description of it. Losing the description is bad; deleting the record of the act
    // because its description would not save is worse, and there is no transaction across these two
    // statements from here. The failure is audited so it is recoverable rather than silent.
    if (detailError)
      await audit(admin, {
        workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.procedure_detail_failed",
        payload: { procedureId: p.id, detail: detailError.message, fields: detailRows.map(d => d.key) },
        correlationId: args.correlationId,
      });
  }

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

// ── CONFIGURATION WRITERS -- the settings screen migration 297 shipped without (2026-08-16) ─────────
//
// 297's own memory line: "all the columns and both new tables are live and read by the engine, but a
// practice configures them only by SQL today." These two writers close that. Both are gated at the
// route on procedure.manage -- 197's own comment: the catalogue is practice configuration.

const TRI_STATES = ["required", "optional", "not_applicable"] as const;

/**
 * Edit a WORKSPACE-OWNED procedure type's applicability rules. Platform rows refuse exactly the way
 * setProcedureTypeStatus refuses -- supplied procedures are read-only, and what a practice controls
 * about them is ACTIVATION (below), never the safety rules themselves.
 *
 * ⚠ THE LEGACY BOOLEANS ARE NOT TOUCHED. Enforcement is an OR (sided === true || laterality_rule ===
 * "required") so a stale boolean can only ADD a refusal -- 297's own harness creates a deliberately
 * disagreeing row to prove it, and an edit here that "tidied" them would put the wrong-site check one
 * mis-set column from silence.
 */
export async function configureProcedureType(admin: any, args: {
  workspaceId: string; procedureTypeId: string;
  siteRule?: string; lateralityRule?: string; consentRule?: string;
  allowedLateralities?: string[]; allowedStatuses?: string[];
  defaultStatus?: string | null; outcomeRequired?: boolean;
  detailFields?: unknown;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  const { data: t } = await admin.from("practice_procedure_type")
    .select("id, workspace_id, allowed_statuses").eq("id", args.procedureTypeId).maybeSingle();
  if (!t) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (t.workspace_id === null)
    return { ok: false, status: 403, code: "PLATFORM_PROCEDURE", message: "supplied procedures are read-only; you can hide or rename one below, and copy it into your practice to change its rules" };
  if (t.workspace_id !== args.workspaceId) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const patch: Record<string, unknown> = { updated_at: nowIso(), updated_by: args.actorId };
  const tri = (key: string, col: string, v?: string): string | null => {
    if (v === undefined) return null;
    if (!TRI_STATES.includes(v as any)) return `${key} must be one of: ${TRI_STATES.join(", ")}`;
    patch[col] = v;
    return null;
  };
  for (const err of [
    tri("siteRule", "site_rule", args.siteRule),
    tri("lateralityRule", "laterality_rule", args.lateralityRule),
    tri("consentRule", "consent_rule", args.consentRule),
  ]) if (err) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: err };

  if (args.allowedLateralities !== undefined) {
    // ⚠ SIDED_LATERALITIES, not the capture vocabulary: the column CHECK admits left/right/bilateral
    // only, and "not_applicable" belongs to the RULE, not to the allowed-values list.
    const bad = args.allowedLateralities.filter(l => !SIDED_LATERALITIES.includes(l));
    if (bad.length) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `unknown laterality: ${bad.join(", ")}` };
    patch.allowed_lateralities = [...new Set(args.allowedLateralities)];
  }
  if (args.allowedStatuses !== undefined) {
    const bad = args.allowedStatuses.filter(s => !PROCEDURE_STATUSES.some(([v]) => v === s));
    if (bad.length) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `unknown status: ${bad.join(", ")}` };
    patch.allowed_statuses = [...new Set(args.allowedStatuses)];
  }
  if (args.defaultStatus !== undefined) {
    if (args.defaultStatus !== null) {
      if (args.defaultStatus === "ABANDONED")
        return { ok: false, status: 422, code: "VALIDATION_ERROR", message: "a procedure cannot DEFAULT to abandoned -- abandonment is recorded, never presumed" };
      if (!PROCEDURE_STATUSES.some(([v]) => v === args.defaultStatus))
        return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "unknown default status" };
      const effectiveAllowed = (args.allowedStatuses ?? t.allowed_statuses ?? []) as string[];
      if (effectiveAllowed.length > 0 && !effectiveAllowed.includes(args.defaultStatus))
        return { ok: false, status: 422, code: "VALIDATION_ERROR", message: "the default status must be one of the allowed statuses" };
    }
    patch.default_status = args.defaultStatus;
  }
  if (args.outcomeRequired !== undefined) patch.outcome_required = args.outcomeRequired === true;
  if (args.detailFields !== undefined) {
    // Round-tripped through the ONE parser every reader uses -- what cannot parse is not stored.
    patch.detail_fields = parseDetailFields(args.detailFields);
  }

  const { error } = await admin.from("practice_procedure_type").update(patch).eq("id", t.id);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.procedure_type_configured",
    payload: { procedureTypeId: t.id, changed: Object.keys(patch).filter(k => !k.startsWith("updated_")) },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: t.id as string } };
}

/**
 * The per-practice ACTIVATION departure: hide a supplied procedure, rename it locally, pin its sort.
 * Works on platform AND workspace rows -- what it records is this practice's relationship to the
 * entry, never the entry itself. Absence of a row = enabled (297's own semantics).
 */
export async function setProcedureActivation(admin: any, args: {
  workspaceId: string; procedureTypeId: string;
  enabled?: boolean; localDisplayName?: string | null; sortOrder?: number | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ enabled: boolean }>> {
  const { data: t } = await admin.from("practice_procedure_type")
    .select("id, workspace_id").eq("id", args.procedureTypeId).maybeSingle();
  if (!t || (t.workspace_id !== null && t.workspace_id !== args.workspaceId))
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const name = (args.localDisplayName ?? "").trim();
  if (name.length > 200)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a local name is at most 200 characters" };

  // ux_practice_proc_type_activation is a FULL unique index, so onConflict is safe here -- this is
  // NOT the partial-index upsert trap (that trap is why check-then-insert exists elsewhere).
  const { data: row, error } = await admin.from("practice_procedure_type_activation").upsert({
    workspace_id: args.workspaceId, procedure_type_id: args.procedureTypeId,
    enabled: args.enabled !== false,
    local_display_name: name || null,
    sort_order: typeof args.sortOrder === "number" ? Math.round(args.sortOrder) : null,
    updated_at: nowIso(), updated_by: args.actorId,
  }, { onConflict: "workspace_id,procedure_type_id" }).select("enabled").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.procedure_activation_set",
    payload: {
      procedureTypeId: args.procedureTypeId, enabled: args.enabled !== false,
      renamed: !!name, sorted: typeof args.sortOrder === "number",
    },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { enabled: row.enabled as boolean } };
}
