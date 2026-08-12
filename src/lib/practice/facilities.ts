import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";
import { type WorkspaceContext } from "@/lib/practice/access";

// CPR-PRM-001 s3, s7, s11 -- FACILITIES AND FACILITY IDENTIFIERS.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// A FACILITY IS NOT A PRACTICE LOCATION.
//
// practice_location is somewhere the PRACTITIONER works and controls -- their own clinic room. A
// FACILITY is a hospital whose numbering system the patient carries and which the practitioner does not
// own. s3 lists both separately, and merging them would have a practitioner's own clinic issuing the
// MRN that a national referral hospital issued.
//
// UNIQUENESS IS KEYED ON THE FACILITY, NOT ON A TYPED STRING. Migration 193 used the free-text `issuer`
// and got it wrong in both directions: "Mulago Hospital" and "Mulago" were two issuers, so one MRN
// could be recorded against three patients; and two patients holding the same MRN at genuinely
// different hospitals, both entered with no issuer, collided as duplicates of somebody they had never
// met. Migration 222 replaces it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

export const FACILITY_TYPES = [
  ["hospital", "Hospital"],
  ["clinic", "Clinic"],
  ["health_centre", "Health centre"],
  ["laboratory", "Laboratory"],
  ["pharmacy", "Pharmacy"],
  ["imaging_centre", "Imaging centre"],
  ["insurer", "Insurer"],
  ["other", "Other"],
] as const;

/** s7's list, plus the ones that are not facility-issued at all. */
export const PATIENT_IDENTIFIER_TYPES = [
  { key: "hospital_mrn", label: "Hospital MRN", facilityScoped: true },
  { key: "hospital_number", label: "Hospital number", facilityScoped: true },
  { key: "clinic_number", label: "Clinic number", facilityScoped: true },
  { key: "outpatient_number", label: "Outpatient number", facilityScoped: true },
  { key: "inpatient_number", label: "Inpatient number", facilityScoped: true },
  { key: "insurance", label: "Insurance number", facilityScoped: true },
  { key: "custom", label: "Custom", facilityScoped: true },
  // NOT facility-issued: a country issues these, and scoping them to a hospital would be wrong.
  { key: "national_id", label: "National ID", facilityScoped: false },
  { key: "passport", label: "Passport", facilityScoped: false },
  { key: "practice_id", label: "Practice ID", facilityScoped: false },
] as const;

export const ENCOUNTER_IDENTIFIER_TYPES = [
  ["visit_number", "Visit number"],
  ["admission_number", "Admission number"],
  ["episode_number", "Episode number"],
  ["lab_accession", "Laboratory accession"],
  ["claim_number", "Claim number"],
  ["referral_number", "Referral number"],
  ["other", "Other"],
] as const;

const facilityScoped = (type: string) =>
  PATIENT_IDENTIFIER_TYPES.find(t => t.key === type)?.facilityScoped ?? false;

// ── FACILITIES ───────────────────────────────────────────────────────────────────────────────────────

export async function listFacilities(admin: any, ctx: WorkspaceContext, includeClosed = false) {
  let q = admin.from("practice_facility")
    .select("id, name, facility_type, country, code, active, created_at")
    .eq("workspace_id", ctx.workspaceId);
  if (!includeClosed) q = q.eq("active", true);
  const { data } = await q.order("name");
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  // How many patients carry a number from each. A facility with none is one somebody added and never
  // used, and saying so is more use than hiding it.
  const { data: counts } = await admin.from("practice_patient_identifier")
    .select("facility_id").eq("workspace_id", ctx.workspaceId).is("valid_to", null)
    .in("facility_id", rows.map(r => r.id));
  const byFacility = new Map<string, number>();
  for (const c of ((counts ?? []) as any[])) byFacility.set(c.facility_id, (byFacility.get(c.facility_id) ?? 0) + 1);

  return rows.map(r => ({
    ...r,
    typeLabel: (FACILITY_TYPES.find(([k]) => k === r.facility_type) ?? [])[1] ?? r.facility_type,
    identifiers: byFacility.get(r.id) ?? 0,
  }));
}

export async function addFacility(admin: any, ctx: WorkspaceContext, args: {
  name: string; facilityType?: string; country?: string; code?: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!ctx.capabilities.includes("practice.locations.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "practice.locations.manage is required" };
  if (args.name.trim().length < 2)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a facility needs a name" };
  if (args.facilityType && !FACILITY_TYPES.some(([k]) => k === args.facilityType))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `unknown facility type: ${args.facilityType}` };

  const { data, error } = await admin.from("practice_facility").insert({
    workspace_id: ctx.workspaceId, name: args.name.trim(),
    facility_type: args.facilityType ?? "hospital",
    country: args.country?.trim() || null, code: args.code?.trim() || null,
    created_by: ctx.userId,
  }).select("id").single();
  if (error) {
    // TWO SPELLINGS OF ONE HOSPITAL SPLIT ITS NUMBERING IN HALF, which is the whole reason the
    // normalised name is unique. Reported as "already there" rather than as a failure.
    if (/duplicate|unique/i.test(error.message))
      return { ok: false, status: 409, code: "ALREADY_EXISTS", message: `"${args.name.trim()}" is already recorded -- numbers from one hospital have to sit under one entry` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.facility_added",
    payload: { facilityId: data.id, name: args.name.trim() }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

/**
 * Close a facility.
 *
 * CLOSED, NOT DELETED -- the position CPR-360 took about locations, and here the reason is stronger:
 * the identifiers reference it with ON DELETE RESTRICT, so an MRN can never be left pointing at a
 * hospital nobody can name.
 */
export async function closeFacility(admin: any, ctx: WorkspaceContext, args: {
  id: string; correlationId: string;
}): Promise<EngineResult<{ closed: true }>> {
  if (!ctx.capabilities.includes("practice.locations.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "practice.locations.manage is required" };

  const { data: updated, error } = await admin.from("practice_facility")
    .update({ active: false }).eq("id", args.id).eq("workspace_id", ctx.workspaceId).select("id");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!updated || updated.length === 0)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.facility_closed",
    payload: { facilityId: args.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { closed: true } };
}

// ── PATIENT IDENTIFIERS ──────────────────────────────────────────────────────────────────────────────

export async function patientIdentifiers(admin: any, ctx: WorkspaceContext, patientId: string) {
  const { data: patient } = await admin.from("practice_patient")
    .select("id, display_name").eq("id", patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!patient) return null;

  const { data } = await admin.from("practice_patient_identifier")
    .select("id, identifier_type, value, issuer, facility_id, valid_from, valid_to, created_at")
    .eq("patient_id", patientId).eq("workspace_id", ctx.workspaceId)
    .order("valid_to", { ascending: true, nullsFirst: true }).order("created_at");
  const rows = (data ?? []) as any[];

  const facilityIds = [...new Set(rows.map(r => r.facility_id).filter(Boolean))];
  const { data: facilities } = facilityIds.length
    ? await admin.from("practice_facility").select("id, name, facility_type, active").eq("workspace_id", ctx.workspaceId).in("id", facilityIds)
    : { data: [] };
  const facilityById = new Map(((facilities ?? []) as any[]).map(f => [f.id, f]));

  return {
    patient,
    identifiers: rows.map(r => ({
      ...r,
      // s7: "Maintain active/historical status". DERIVED from valid_to, never a stored status -- the
      // rule this codebase has now applied to overdue, expiry, orphaned and guardianship.
      status: r.valid_to ? "historical" : "active",
      typeLabel: PATIENT_IDENTIFIER_TYPES.find(t => t.key === r.identifier_type)?.label ?? r.identifier_type,
      facility: r.facility_id ? (facilityById.get(r.facility_id) ?? null) : null,
      facilityScoped: facilityScoped(r.identifier_type),
    })),
    active: rows.filter(r => !r.valid_to).length,
    historical: rows.filter(r => r.valid_to).length,
  };
}

export async function addPatientIdentifier(admin: any, ctx: WorkspaceContext, args: {
  patientId: string; identifierType: string; value: string;
  facilityId?: string | null; issuer?: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!ctx.capabilities.includes("patient.edit"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "patient.edit is required" };
  if (!PATIENT_IDENTIFIER_TYPES.some(t => t.key === args.identifierType))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `unknown identifier type: ${args.identifierType}` };
  if (!args.value.trim())
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a value is required" };

  const { data: patient } = await admin.from("practice_patient")
    .select("id").eq("id", args.patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!patient) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  // A FACILITY-SCOPED IDENTIFIER WITHOUT A FACILITY IS UNENFORCEABLE. "MRN 12345" with no hospital
  // named cannot be checked against anything and cannot be traced back to who issued it, which is the
  // exact shape of the bug migration 222 fixed.
  if (facilityScoped(args.identifierType) && !args.facilityId)
    return {
      ok: false, status: 422, code: "FACILITY_REQUIRED",
      message: "say which facility issued this number -- a hospital number with no hospital cannot be checked against anything",
    };
  // And the reverse: a national id is not issued by a hospital.
  if (!facilityScoped(args.identifierType) && args.facilityId)
    return {
      ok: false, status: 422, code: "FACILITY_NOT_APPLICABLE",
      message: "that kind of identifier is not issued by a facility",
    };

  if (args.facilityId) {
    const { data: facility } = await admin.from("practice_facility")
      .select("id, active").eq("id", args.facilityId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (!facility) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (!facility.active)
      return { ok: false, status: 422, code: "FACILITY_CLOSED", message: "that facility is closed -- reopen it or choose another" };
  }

  const { data, error } = await admin.from("practice_patient_identifier").insert({
    workspace_id: ctx.workspaceId, patient_id: args.patientId,
    identifier_type: args.identifierType, value: args.value.trim(),
    facility_id: args.facilityId ?? null, issuer: args.issuer?.trim() || null,
    created_by: ctx.userId,
  }).select("id").single();

  if (error) {
    // s11's rule biting. THE OWNER IS NAMED, because "this number is taken" without saying by whom is
    // the difference between a resolvable clash and a dead end -- migration 193 set that precedent for
    // duplicate detection and it holds here.
    if (/duplicate|unique/i.test(error.message)) {
      const owner = await identifierOwner(admin, ctx, args.identifierType, args.value, args.facilityId ?? null);
      return {
        ok: false, status: 409, code: "IDENTIFIER_IN_USE",
        message: owner
          ? `that number is already recorded against ${owner.display_name}`
          : "that number is already in use at this facility",
      };
    }
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.identifier_added",
    payload: { identifierId: data.id, patientId: args.patientId, type: args.identifierType, facilityId: args.facilityId ?? null },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

async function identifierOwner(admin: any, ctx: WorkspaceContext, type: string, value: string, facilityId: string | null) {
  const normalised = value.trim().toLowerCase().replace(/\s+/g, "");
  let q = admin.from("practice_patient_identifier")
    .select("patient_id").eq("workspace_id", ctx.workspaceId).eq("identifier_type", type)
    .eq("value_normalised", normalised).is("valid_to", null);
  q = facilityId ? q.eq("facility_id", facilityId) : q.is("facility_id", null);
  const { data } = await q.maybeSingle();
  if (!data) return null;
  const { data: patient } = await admin.from("practice_patient")
    .select("id, display_name").eq("workspace_id", ctx.workspaceId).eq("id", data.patient_id).maybeSingle();
  return patient ?? null;
}

/**
 * Retire an identifier.
 *
 * s7: "Maintain active/historical status and audit trail." Retired, never deleted -- a hospital number
 * that appears on last year's discharge summary has to stay findable, or a document arrives and matches
 * nobody.
 */
export async function retireIdentifier(admin: any, ctx: WorkspaceContext, args: {
  id: string; correlationId: string;
}): Promise<EngineResult<{ retired: true }>> {
  if (!ctx.capabilities.includes("patient.edit"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "patient.edit is required" };

  const { data: row } = await admin.from("practice_patient_identifier")
    .select("id, patient_id, identifier_type, valid_to")
    .eq("id", args.id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!row) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (row.valid_to) return { ok: true, data: { retired: true } };

  // THE PRACTICE ID IS HOW THIS PRODUCT FINDS ITS OWN PATIENTS. Retiring it would leave a record with
  // no handle of its own -- migration 193 issues exactly one and never reissues.
  if (row.identifier_type === "practice_id")
    return { ok: false, status: 422, code: "CANNOT_RETIRE", message: "the practice ID is how this record is found here" };

  const { data: updated, error } = await admin.from("practice_patient_identifier")
    .update({ valid_to: new Date().toISOString() }).eq("workspace_id", ctx.workspaceId).eq("id", row.id).select("id");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!updated || updated.length === 0)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.identifier_retired",
    payload: { identifierId: row.id, patientId: row.patient_id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { retired: true } };
}

// ── ENCOUNTER IDENTIFIERS (s7) ───────────────────────────────────────────────────────────────────────

export async function addEncounterIdentifier(admin: any, ctx: WorkspaceContext, args: {
  encounterId: string; identifierType: string; value: string;
  facilityId?: string | null; note?: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!ctx.capabilities.includes("encounter.edit"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "encounter.edit is required" };
  if (!ENCOUNTER_IDENTIFIER_TYPES.some(([k]) => k === args.identifierType))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `unknown identifier type: ${args.identifierType}` };
  if (!args.value.trim())
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a value is required" };

  const { data: encounter } = await admin.from("practice_encounter")
    .select("id").eq("id", args.encounterId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!encounter) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  if (args.facilityId) {
    const { data: facility } = await admin.from("practice_facility")
      .select("id").eq("id", args.facilityId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (!facility) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  }

  const { data, error } = await admin.from("practice_encounter_identifier").insert({
    workspace_id: ctx.workspaceId, encounter_id: args.encounterId,
    identifier_type: args.identifierType, value: args.value.trim(),
    facility_id: args.facilityId ?? null, note: args.note?.trim() || null,
    created_by: ctx.userId,
  }).select("id").single();
  if (error) {
    if (/duplicate|unique/i.test(error.message))
      return { ok: false, status: 409, code: "IDENTIFIER_IN_USE", message: "that number is already recorded against another attendance" };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }
  return { ok: true, data: { id: data.id as string } };
}

export async function encounterIdentifiers(admin: any, ctx: WorkspaceContext, encounterId: string) {
  const { data } = await admin.from("practice_encounter_identifier")
    .select("id, identifier_type, value, facility_id, note, created_at")
    .eq("encounter_id", encounterId).eq("workspace_id", ctx.workspaceId).order("created_at");
  return ((data ?? []) as any[]).map(r => ({
    ...r,
    typeLabel: (ENCOUNTER_IDENTIFIER_TYPES.find(([k]) => k === r.identifier_type) ?? [])[1] ?? r.identifier_type,
  }));
}

/**
 * s7: "Search by any facility identifier."
 *
 * ACROSS BOTH LEVELS, because somebody holding a piece of paper does not know whether the number on it
 * identifies the person or the visit -- and a search that only knew one of them would answer "no such
 * number" about a number that is right there in the record.
 */
export async function findByIdentifier(admin: any, ctx: WorkspaceContext, raw: string) {
  const normalised = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (normalised.length < 2) return { patients: [], encounters: [] };

  const [{ data: patientHits }, { data: encounterHits }] = await Promise.all([
    admin.from("practice_patient_identifier")
      .select("patient_id, identifier_type, value, facility_id, valid_to")
      .eq("workspace_id", ctx.workspaceId).eq("value_normalised", normalised).limit(25),
    admin.from("practice_encounter_identifier")
      .select("encounter_id, identifier_type, value, facility_id")
      .eq("workspace_id", ctx.workspaceId).eq("value_normalised", normalised).limit(25),
  ]);

  const pHits = (patientHits ?? []) as any[];
  const eHits = (encounterHits ?? []) as any[];

  const patientIds = [...new Set(pHits.map(h => h.patient_id))];
  const { data: patients } = patientIds.length
    ? await admin.from("practice_patient").select("id, display_name, status").eq("workspace_id", ctx.workspaceId).in("id", patientIds)
    : { data: [] };
  const patientById = new Map(((patients ?? []) as any[]).map(p => [p.id, p]));

  const encounterIds = [...new Set(eHits.map(h => h.encounter_id))];
  const { data: encounters } = encounterIds.length
    ? await admin.from("practice_encounter").select("id, patient_id, started_at, status").eq("workspace_id", ctx.workspaceId).in("id", encounterIds)
    : { data: [] };

  return {
    patients: pHits.map(h => ({
      patientId: h.patient_id,
      displayName: patientById.get(h.patient_id)?.display_name ?? null,
      matchedOn: h.identifier_type, value: h.value,
      // A RETIRED NUMBER STILL FINDS THE PERSON, and says it is retired. Last year's discharge summary
      // carries last year's number, and refusing to match it would strand the document.
      status: h.valid_to ? "historical" : "active",
      href: `/practice/patients/${h.patient_id}`,
    })),
    encounters: ((encounters ?? []) as any[]).map(e => ({
      encounterId: e.id, patientId: e.patient_id, when: e.started_at, status: e.status,
      matchedOn: eHits.find(h => h.encounter_id === e.id)?.identifier_type ?? null,
      href: `/practice/encounters/${e.id}`,
    })),
  };
}
