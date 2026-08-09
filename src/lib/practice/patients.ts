import { randomBytes } from "node:crypto";
import { audit } from "@/lib/practice/audit";

// PEN-002 Patient Identity Engine -- one longitudinal identity per patient, duplicates prevented at
// registration, retrieval in seconds, merges audited. This module is the engine; CPR-V2-004's registry and
// CPR-V2-005's registration are its consumers, and Phase 3's encounter launch will be the third.
//
// THE DUPLICATE DOCTRINE (DM-001 s6.1), split between here and migration 193:
//   database  refuses two LIVE identifiers of the same type+value+issuer in a workspace -- the one
//             collision that is never legitimate.
//   engine    runs detection BEFORE save (CPR-V2-005's workflow order): an exact identifier hit REFUSES
//             registration outright; demographic similarity (same normalised name + same birth date, or
//             same name + same phone) returns CANDIDATES and refuses only until the caller confirms --
//             probabilistic matching "may suggest but never silently merge", and equally never silently
//             blocks a genuine namesake.
//
// PRACTICE IDS ARE OPAQUE AND NON-SEQUENTIAL (DM-001 s2): P- plus six characters from an unambiguous
// alphabet (no 0/O/1/I), generated and retried on the unique index. A counter would leak registration
// volume to anyone who saw two cards.

/* eslint-disable @typescript-eslint/no-explicit-any */

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const normValue = (s: string) => s.toLowerCase().replace(/\s+/g, "");

const ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export function generatePracticeId(): string {
  const bytes = randomBytes(6);
  let out = "P-";
  for (let i = 0; i < 6; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

/**
 * Compose a display name from parts.
 *
 * MONONYMS SURVIVE. "Nakato" alone is a whole name, not a missing surname -- so this returns whatever
 * parts were given, joined, and never demands three. A form that requires first/middle/last cannot
 * register a real person, and the failure lands on whoever is at the desk, who then types something
 * untrue into a box to get past it.
 */
export function composeDisplayName(parts: {
  givenName?: string; middleName?: string; familyName?: string;
}): string {
  return [parts.givenName, parts.middleName, parts.familyName]
    .map(p => (p ?? "").trim()).filter(Boolean).join(" ");
}

export type RegisterInput = {
  workspaceId: string;
  /** The whole name. Required -- composed from the parts below when they are supplied instead. */
  displayName: string;
  // CPR-PRM-001 s4: "Identity (First, Middle, Last Name)". All optional; see composeDisplayName.
  givenName?: string;
  middleName?: string;
  familyName?: string;
  sex?: string;
  birthDate?: string;        // YYYY-MM-DD
  ageEstimateYears?: number; // CPR-V2-005: estimated OR actual
  phone?: string;
  email?: string;
  identifiers?: { type: string; value: string; issuer?: string }[];
  /** Caller has seen the duplicate candidates and confirms this is a different person. */
  confirmNew?: boolean;
  actorId: string;
  correlationId: string;
};

export type Candidate = {
  id: string; displayName: string; birthDate: string | null; matchedBy: string; practiceId: string | null;
};

export type EngineResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string; candidates?: Candidate[] };

async function practiceIdsFor(admin: any, workspaceId: string, patientIds: string[]): Promise<Map<string, string>> {
  if (patientIds.length === 0) return new Map();
  const { data } = await admin.from("practice_patient_identifier")
    .select("patient_id, value").eq("workspace_id", workspaceId)
    .eq("identifier_type", "practice_id").in("patient_id", patientIds).is("valid_to", null);
  return new Map(((data ?? []) as any[]).map(r => [r.patient_id, r.value]));
}

/** Ranked search (CPR-V2-004): identifier exact beats phone exact beats name. Never fuzzy-merges anything. */
export async function searchPatients(admin: any, workspaceId: string, q: string, limit = 20): Promise<{
  results: (Candidate & { sex: string; status: string })[];
  /**
   * ⚠ FALSE WHEN A PROBE FAILED, AND THIS IS THE POINT OF THE TYPE.
   *
   * All five reads discarded their errors, so a refused identifier query returned "no patient found"
   * for an ID sitting in the table. The desk then registers somebody who is already registered -- and
   * that is not a cosmetic failure, it is a SPLIT CLINICAL RECORD, the same harm registerPatient's
   * duplicate check exists to prevent. Search is where the prevention is supposed to start.
   *
   * `complete: false` means the empty result is not an answer. A caller must not say "nobody matches".
   */
  complete: boolean;
  /** The database's own words for whichever probes failed. Null when everything ran. */
  detail: string | null;
}> {
  const query = q.trim();
  if (!query) return { results: [], complete: true, detail: null };
  const hits = new Map<string, { score: number; matchedBy: string }>();
  const failures: string[] = [];

  const add = (id: string, score: number, matchedBy: string) => {
    const cur = hits.get(id);
    if (!cur || cur.score < score) hits.set(id, { score, matchedBy });
  };

  // Each probe records its own failure by name. Which one broke matters: an identifier probe failing is
  // how a duplicate gets made, and a name probe failing merely makes the search feel poor.
  const probe = (name: string, error: { message: string } | null) => {
    if (error) failures.push(`${name}: ${error.message}`);
  };

  // Identifier exact (any type -- practice id, national id, MRN, QR...).
  const { data: idHits, error: idErr } = await admin.from("practice_patient_identifier")
    .select("patient_id, identifier_type").eq("workspace_id", workspaceId)
    .eq("value_normalised", normValue(query)).is("valid_to", null).limit(limit);
  probe("identifier", idErr);
  for (const h of (idHits ?? []) as any[]) add(h.patient_id, 100, `identifier:${h.identifier_type}`);

  // Phone/email exact through contacts.
  if (normValue(query).length >= 5) {
    const { data: cHits, error: cErr } = await admin.from("practice_patient_contact")
      .select("patient_id, contact_type").eq("workspace_id", workspaceId)
      .eq("value_normalised", normValue(query)).limit(limit);
    probe("contact", cErr);
    for (const h of (cHits ?? []) as any[]) add(h.patient_id, 90, h.contact_type);
  }

  // Name: exact-normalised, then contains.
  const { data: exact, error: exactErr } = await admin.from("practice_patient")
    .select("id").eq("workspace_id", workspaceId).eq("name_normalised", norm(query)).limit(limit);
  probe("name", exactErr);
  for (const h of (exact ?? []) as any[]) add(h.id, 80, "name");
  const { data: partial, error: partialErr } = await admin.from("practice_patient")
    .select("id").eq("workspace_id", workspaceId).ilike("name_normalised", `%${norm(query)}%`).limit(limit);
  probe("name-partial", partialErr);
  for (const h of (partial ?? []) as any[]) add(h.id, 40, "name-partial");

  const detail = failures.length ? failures.join("; ") : null;
  const ids = [...hits.keys()];
  if (ids.length === 0) return { results: [], complete: failures.length === 0, detail };
  // ⚠ THE TENANT FILTER WAS MISSING HERE and on this read alone. Not a leak today -- every id came from
  // a workspace-scoped probe above -- but it was the one read in this function keyed on ids alone, and
  // "safe because of where the ids came from" is a property of the CALLER, not of this query. A future
  // probe that forgets its own filter would turn this into a cross-tenant read with nothing to catch it.
  const { data: rows, error: rowsErr } = await admin.from("practice_patient")
    .select("id, display_name, birth_date, sex, status")
    .eq("workspace_id", workspaceId).in("id", ids).neq("status", "merged");
  probe("hydrate", rowsErr);
  const pids = await practiceIdsFor(admin, workspaceId, ids);

  const results = ((rows ?? []) as any[])
    .map(r => ({
      id: r.id, displayName: r.display_name, birthDate: r.birth_date, sex: r.sex, status: r.status,
      practiceId: pids.get(r.id) ?? null, matchedBy: hits.get(r.id)!.matchedBy,
      _score: hits.get(r.id)!.score,
    }))
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(r => { const { _score: _drop, ...rest } = r; void _drop; return rest; });
  // `complete` is recomputed from the same failures list, not assumed true because rows came back: a
  // partial answer with two hits in it is still a partial answer, and it is the dangerous kind, because
  // results on screen read as "the search worked".
  return { results, complete: failures.length === 0, detail };
}

/** CPR-V2-005: search first, duplicate detection BEFORE save, identifier generation, then create. */
export async function registerPatient(admin: any, input: RegisterInput): Promise<EngineResult<{
  id: string; practiceId: string;
  /** Writes that did not happen. Empty on a clean registration -- never absent, so a caller cannot
   * forget to look. See the note above the identifier and contact inserts. */
  incomplete: { step: string; reason: string }[];
}>> {
  // THE PARTS COMPOSE THE WHOLE when a caller sends them, and the whole still wins when it is sent on
  // its own -- so an existing caller keeps working and a one-name patient stays registrable.
  const name = (input.displayName?.trim() || composeDisplayName(input)).trim();
  if (!name) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a name is required" };
  if (!input.birthDate && input.ageEstimateYears == null)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "birthDate or ageEstimateYears is required (CPR-V2-005 minimum dataset)" };
  if (!input.phone && !input.email)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a primary contact (phone or email) is required (CPR-V2-005 minimum dataset)" };

  // 1. Exact identifier collision: refused outright, with the existing patient named.
  //
  // ⚠ A COLLISION CHECK THAT COULD NOT RUN IS NOT A COLLISION CHECK THAT PASSED. This read used to
  // discard its error, so a failed query left `clash` undefined, the loop fell through, and the patient
  // was created -- a SECOND record carrying somebody's hospital number, which is the single worst thing
  // this function can do. A split record loses half a history in the place a clinician least expects it.
  //
  // THE DATABASE IS ONLY A PARTIAL BACKSTOP, so this cannot be left to it. ux_practice_identifier_live
  // (migration 193) is unique on (workspace_id, identifier_type, value_normalised, coalesce(issuer, '')),
  // and the check here deliberately IGNORES the issuer -- so it is stricter than the index. The same
  // number recorded against two different issuers is caught HERE and nowhere else.
  for (const ident of input.identifiers ?? []) {
    const { data: clash, error: clashErr } = await admin.from("practice_patient_identifier")
      .select("patient_id").eq("workspace_id", input.workspaceId)
      .eq("identifier_type", ident.type).eq("value_normalised", normValue(ident.value)).is("valid_to", null)
      .maybeSingle();
    // Refused rather than risked. CPR-V5-006 says "registration never delays care", and this is the one
    // place that yields to something heavier: a retry costs seconds, and an unnoticed duplicate record
    // costs a merge, plus every consultation filed on the wrong half until somebody notices.
    if (clashErr) return {
      ok: false, status: 500, code: "DUPLICATE_CHECK_FAILED",
      message: `could not check whether that ${ident.type} is already registered, so this was not saved: ${clashErr.message}`,
    };
    if (clash) {
      // The clash is already established. If the patient behind it cannot be read we still refuse -- we
      // simply cannot say WHO. Previously this called .single() and used `p.id` unchecked, so a failed
      // read threw a TypeError out of a function whose callers expect a result object.
      const { data: p } = await admin.from("practice_patient")
        .select("id, display_name, birth_date").eq("id", clash.patient_id).maybeSingle();
      const pids = p ? await practiceIdsFor(admin, input.workspaceId, [p.id]) : new Map<string, string>();
      return {
        ok: false, status: 409, code: "DUPLICATE_IDENTIFIER",
        message: `that ${ident.type} already belongs to a registered patient`,
        candidates: p
          ? [{ id: p.id, displayName: p.display_name, birthDate: p.birth_date, matchedBy: `identifier:${ident.type}`, practiceId: pids.get(p.id) ?? null }]
          : [],
      };
    }
  }

  // 2. Demographic similarity: candidates, refused until confirmed (never silently blocked either).
  if (!input.confirmNew) {
    const candidates: Candidate[] = [];
    // Same reasoning as the identifier check above: a search for existing people that FAILED found no
    // people, and "found nobody" is what lets this function proceed. Both reads refuse rather than
    // report an empty result.
    const { data: sameName, error: nameErr } = await admin.from("practice_patient")
      .select("id, display_name, birth_date").eq("workspace_id", input.workspaceId)
      .eq("name_normalised", norm(name)).neq("status", "merged").limit(5);
    if (nameErr) return {
      ok: false, status: 500, code: "DUPLICATE_CHECK_FAILED",
      message: `could not check for an existing patient of that name, so this was not saved: ${nameErr.message}`,
    };
    for (const p of (sameName ?? []) as any[]) {
      const dobMatch = input.birthDate && p.birth_date === input.birthDate;
      let phoneMatch = false;
      if (input.phone) {
        const { data: c, error: cErr } = await admin.from("practice_patient_contact")
          .select("id").eq("patient_id", p.id).eq("contact_type", "phone")
          .eq("value_normalised", normValue(input.phone)).limit(1).maybeSingle();
        if (cErr) return {
          ok: false, status: 500, code: "DUPLICATE_CHECK_FAILED",
          message: `could not check an existing patient's phone number, so this was not saved: ${cErr.message}`,
        };
        phoneMatch = !!c;
      }
      if (dobMatch || phoneMatch) {
        candidates.push({ id: p.id, displayName: p.display_name, birthDate: p.birth_date, matchedBy: dobMatch ? "name+dob" : "name+phone", practiceId: null });
      }
    }
    if (candidates.length > 0) {
      const pids = await practiceIdsFor(admin, input.workspaceId, candidates.map(c => c.id));
      candidates.forEach(c => { c.practiceId = pids.get(c.id) ?? null; });
      return {
        ok: false, status: 409, code: "POSSIBLE_DUPLICATE",
        message: "a very similar patient exists; open them, or confirm this is a different person",
        candidates,
      };
    }
  }

  // 3. Create patient + generated practice id (retried on the unique index) + primary contact(s).
  const { data: patient, error: pErr } = await admin.from("practice_patient").insert({
    workspace_id: input.workspaceId, display_name: name,
    sex: ["female", "male", "other", "unknown"].includes(input.sex ?? "") ? input.sex : "unspecified",
    birth_date: input.birthDate ?? null, age_estimate_years: input.ageEstimateYears ?? null,
    given_name: input.givenName?.trim() || null,
    middle_name: input.middleName?.trim() || null,
    family_name: input.familyName?.trim() || null,
    created_by: input.actorId,
  }).select("id").single();
  if (pErr) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: pErr.message };

  let practiceId = "";
  for (let attempt = 0; attempt < 5 && !practiceId; attempt++) {
    const candidate = generatePracticeId();
    const { error } = await admin.from("practice_patient_identifier").insert({
      workspace_id: input.workspaceId, patient_id: patient.id,
      identifier_type: "practice_id", value: candidate, created_by: input.actorId,
    });
    if (!error) practiceId = candidate;
    else if (!/duplicate|unique/i.test(error.message)) {
      return { ok: false, status: 502, code: "IDENTIFIER_GENERATION_FAILED", message: error.message };
    }
  }
  if (!practiceId) return { ok: false, status: 502, code: "IDENTIFIER_GENERATION_FAILED", message: "could not generate a unique practice id" };

  // ⚠ THESE FOUR WRITES DISCARDED THEIR ERRORS, AND THAT IS WHERE THE DATA WENT.
  //
  // It is the other half of the duplicate bug and the more damaging half. When the collision check above
  // could not run and the DATABASE caught the duplicate instead, ux_practice_identifier_live rejected
  // this insert -- and the rejection was thrown away. The function returned ok, the desk saw a
  // registered patient, and the hospital number they had just typed was simply not there. Nothing on
  // any screen said so, and the number is exactly what somebody later searches by.
  //
  // The same applies to the phone and the email: a contact that silently failed to save is a patient
  // nobody can ring back.
  //
  // THE PATIENT IS NOT ROLLED BACK. "Registration never delays care" (CPR-V5-006) decides this one --
  // the record exists and the consultation can start. What changes is that the desk is TOLD, through
  // the `incomplete` vocabulary registration.ts already uses and the form already renders, so a missing
  // hospital number is a line on the screen rather than a discovery six weeks later.
  const incomplete: { step: string; reason: string }[] = [];

  for (const ident of input.identifiers ?? []) {
    const { error } = await admin.from("practice_patient_identifier").insert({
      workspace_id: input.workspaceId, patient_id: patient.id,
      identifier_type: ident.type, value: ident.value, issuer: ident.issuer ?? null, created_by: input.actorId,
    });
    if (error) incomplete.push({
      step: "identifier",
      reason: /duplicate|unique/i.test(error.message)
        // Reached only when the check above passed and this still collided -- another desk registering
        // the same number in the seconds between. Named plainly, because "it did not save" invites a
        // retype and this will not save on a retype either.
        ? `the ${ident.type} "${ident.value}" already belongs to another patient and was not saved`
        : `the ${ident.type} "${ident.value}" was not saved: ${error.message}`,
    });
  }
  if (input.phone) {
    const { error } = await admin.from("practice_patient_contact").insert({
      workspace_id: input.workspaceId, patient_id: patient.id, contact_type: "phone",
      value: input.phone, preferred: true, created_by: input.actorId,
    });
    if (error) incomplete.push({ step: "phone", reason: `the phone number was not saved: ${error.message}` });
  }
  if (input.email) {
    const { error } = await admin.from("practice_patient_contact").insert({
      workspace_id: input.workspaceId, patient_id: patient.id, contact_type: "email",
      value: input.email, preferred: !input.phone, created_by: input.actorId,
    });
    if (error) incomplete.push({ step: "email", reason: `the email address was not saved: ${error.message}` });
  }

  await audit(admin, {
    workspaceId: input.workspaceId, actorId: input.actorId, eventType: "practice.patient_registered",
    payload: { patientId: patient.id, practiceId }, correlationId: input.correlationId,
  });
  return { ok: true, data: { id: patient.id as string, practiceId, incomplete } };
}

/**
 * Merge (PEN-002 / DM-001 s6.1): identifiers, contacts and appointments MOVE to the survivor; the
 * duplicate row STAYS as status=merged with the pointer, so nothing is lost and unmerge remains
 * possible under governance. Fully audited. Merging a merged patient, or a patient into itself, is
 * refused.
 */
export async function mergePatients(admin: any, args: {
  workspaceId: string; survivingId: string; duplicateId: string; reason?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ moved: { identifiers: number; contacts: number; appointments: number } }>> {
  if (args.survivingId === args.duplicateId)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a patient cannot be merged into itself" };

  const { data: both } = await admin.from("practice_patient")
    .select("id, status").eq("workspace_id", args.workspaceId).in("id", [args.survivingId, args.duplicateId]);
  const surviving = ((both ?? []) as any[]).find(p => p.id === args.survivingId);
  const duplicate = ((both ?? []) as any[]).find(p => p.id === args.duplicateId);
  if (!surviving || !duplicate) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (surviving.status !== "active" || duplicate.status !== "active")
    return { ok: false, status: 422, code: "ILLEGAL_MERGE", message: "both patients must be active to merge" };

  const move = async (table: string) => {
    const { data } = await admin.from(table)
      .update({ patient_id: args.survivingId })
      .eq("patient_id", args.duplicateId).eq("workspace_id", args.workspaceId).select("id");
    return ((data ?? []) as any[]).length;
  };
  const identifiers = await move("practice_patient_identifier");
  const contacts = await move("practice_patient_contact");
  const appointments = await move("practice_appointment");

  await admin.from("practice_patient").update({
    status: "merged", merged_into_patient_id: args.survivingId, updated_at: new Date().toISOString(), updated_by: args.actorId,
  }).eq("id", args.duplicateId);

  await admin.from("practice_patient_merge").insert({
    workspace_id: args.workspaceId, surviving_patient_id: args.survivingId,
    merged_patient_id: args.duplicateId, reason: args.reason ?? null, actor_id: args.actorId,
  });
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.patient_merged",
    payload: { survivingId: args.survivingId, duplicateId: args.duplicateId, moved: { identifiers, contacts, appointments } },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { moved: { identifiers, contacts, appointments } } };
}

/** The patient with everything the registry shows (CPR-V2-002/004): identity, identifiers, contacts, diary. */
export async function getPatient(admin: any, workspaceId: string, patientId: string) {
  const { data: patient } = await admin.from("practice_patient")
    .select("id, display_name, sex, birth_date, age_estimate_years, status, merged_into_patient_id, record_version, created_at")
    .eq("id", patientId).eq("workspace_id", workspaceId).maybeSingle();
  if (!patient) return null;
  const [{ data: identifiers }, { data: contacts }, { data: appointments }] = await Promise.all([
    admin.from("practice_patient_identifier")
      .select("id, identifier_type, value, issuer, valid_to").eq("patient_id", patientId).order("created_at"),
    admin.from("practice_patient_contact")
      .select("id, contact_type, value, preferred, verified").eq("patient_id", patientId).order("created_at"),
    admin.from("practice_appointment")
      .select("id, scheduled_at, appointment_type, status, duration_minutes")
      .eq("patient_id", patientId).order("scheduled_at", { ascending: false }).limit(25),
  ]);
  return { patient, identifiers: identifiers ?? [], contacts: contacts ?? [], appointments: appointments ?? [] };
}
