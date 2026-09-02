import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import type { EngineResult } from "@/lib/practice/encounters";
import { practiceToday, workspaceClock, zonedDayRange, dueDateFrom } from "@/lib/practice/practice-time";
import { ageFrom, relationshipExpectation, RELATIONSHIP_TYPES } from "@/lib/practice/relationships";
import { canonicalPatientNumber } from "@/lib/practice/patients";
import { logAccess } from "@/lib/practice/privacy";
import {
  WORKLIST_KEYS, RECENT_WINDOW_DAYS, WORKLIST_META, HOSPITAL_IDENTIFIER_TYPES, MATCH_RANK,
  COHORT_STATUS_LABELS, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, WORKLIST_ROW_LIMIT, ENRICHMENT_ROW_CAP, SORT_ORDER_CAP,
  REFUSES, PENDING_RESULTS_BOUNDARY, MEDICATION_BOUNDARY, MEDICATION_NOT_CURRENT_REASON, PLACE_BOUNDARY,
  type WorklistKey, type CohortStatus,
} from "@/lib/practice/patient-workspace-constants";

// CPR-V5-006 -- THE PATIENTS WORKSPACE.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// "Patients workspace manages identity, search and continuity of care. Not an EMR and not only a
// registration page." The spec's own line, and it is the boundary this file is built along: PATIENTS
// IDENTIFY THE PERSON, ENCOUNTERS DOCUMENT THE CARE. Nothing here writes a clinical fact. Every clinical
// row it reads is read to answer "who is this and what is outstanding for them", never to be edited.
//
// SO THIS MODULE IS ALL READS -- and that is exactly why it is written the way it is. Registration,
// merging, relationships, booking, follow-up transitions and encounter launch all already exist in
// patients.ts, relationships.ts, scheduling.ts, follow-ups.ts and encounters.ts. Building a second one
// of any of them here would give the product two answers to the same question.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// FIVE RULES, EACH OF WHICH HAS A HARNESS ASSERTION BEHIND IT.
//
// 1. A FAILED READ IS NEVER A ZERO. Every count in this file is `number | null`. `null` means the read
//    did not happen or did not work, and the payload carries the reason and the database's own words.
//    "Nothing is waiting" and "I could not find out what is waiting" are different answers, and a
//    worklist that renders the second as the first tells a practitioner the room is empty.
//
// 2. EVERY FIGURE IS THE LENGTH OF A LIST YOU CAN OPEN. Every worklist returns `count` AND `rows`, and
//    the rows carry patient ids so the tile opens a filtered cohort (myPatients takes `patientIds`).
//    CPR-300 set this rule; CPR-V5-006's "these should be clickable and open filtered patient lists"
//    is the same rule said again.
//
// 3. NO RATES, NO PERCENTAGES, NO TARGETS. Counts and denominators as separate fields where a
//    denominator exists at all. Nothing on this surface divides one real number by an invented one.
//
// 4. ANYTHING CLOCK-DEPENDENT IS DERIVED AT READ TIME. Age, last seen, overdue, "today". None of them
//    is stored, because a stored one needs something to run and the thing it needs is what a busy
//    practice does not do. "Today" is practiceToday(timezone) -- a UTC day boundary loses the first
//    three hours of a Kampala morning, which is exactly when somebody opens this page.
//
// 5. patient.view GATES NAMES, patient.list GATES LISTS. A caller who may see that six people are
//    waiting is not thereby a caller who may see who they are. Migration 191 gives the practice OWNER
//    neither, deliberately, so the owner of a practice is not automatically able to read its patients.
//
// NO MIGRATION. Everything CPR-V5-006 asks for that this product can honestly answer is already stored:
// identities and identifiers (193), facility-scoped hospital numbers (222), relationships (221),
// encounters and diagnoses and treatments (194), follow-ups (196), the arrivals queue (192/226) and the
// incoming register (200). What it asks for that is NOT stored is listed in REFUSES, and a table would
// not have made those true -- it would have made them look true.

/* eslint-disable @typescript-eslint/no-explicit-any */

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const normValue = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const digits = (s: string) => (s ?? "").replace(/\D+/g, "");

// ── The unavailability primitive ─────────────────────────────────────────────────────────────────────

export type Unavailable = null | "capability" | "read_failed";

/**
 * One read, with its own honesty.
 *
 * `count` is null whenever the read did not produce an answer. It is NEVER 0 in that case -- rule 1.
 * `truncated` says the cap bit, so `count: 50, truncated: true` reads as "at least fifty" rather than
 * "fifty", which is the difference between a worklist and a lie.
 */
export type Probe<T = any> = {
  rows: T[];
  count: number | null;
  unavailable: boolean;
  reason: Unavailable;
  /** The database's own words, verbatim. Never paraphrased into something reassuring. */
  error: string | null;
  limit: number;
  truncated: boolean;
};

const capabilityDenied = <T,>(limit: number): Probe<T> => ({
  rows: [], count: null, unavailable: true, reason: "capability", error: null, limit, truncated: false,
});

async function probe<T = any>(
  allowed: boolean,
  limit: number,
  run: () => Promise<{ data: any; error: any }>,
): Promise<Probe<T>> {
  if (!allowed) return capabilityDenied<T>(limit);
  // NEVER `const { data } =`. Discarding the error is how an unreachable table becomes an empty list,
  // and an empty list becomes "nothing is outstanding". Three engines in this codebase do it; see the
  // report that shipped with this module.
  const { data, error } = await run();
  if (error) {
    return { rows: [], count: null, unavailable: true, reason: "read_failed", error: String(error.message ?? error), limit, truncated: false };
  }
  const all = (data ?? []) as T[];
  const truncated = all.length > limit;
  const rows = truncated ? all.slice(0, limit) : all;
  return { rows, count: rows.length, unavailable: false, reason: null, error: null, limit, truncated };
}

/** A read whose rows are only a lookup, where truncation still has to be knowable. */
type Lookup<T> = { rows: T[]; ok: boolean; error: string | null; truncated: boolean };

async function lookup<T = any>(limit: number, run: () => Promise<{ data: any; error: any }>): Promise<Lookup<T>> {
  const { data, error } = await run();
  if (error) return { rows: [], ok: false, error: String(error.message ?? error), truncated: false };
  const all = (data ?? []) as T[];
  return { rows: all.slice(0, limit), ok: true, error: null, truncated: all.length > limit };
}

// ── Identifiers, surfaced together ───────────────────────────────────────────────────────────────────

export type IdentifierRow = {
  id: string;
  type: string;
  value: string;
  issuer: string | null;
  facilityId: string | null;
  facilityName: string | null;
  live: boolean;
};

export type IdentifierSet = {
  /** CPR-V5-006: "Multiple identifiers" and "Multiple hospital identifiers", not hidden in demographics. */
  practiceId: string | null;
  hospitalNumbers: IdentifierRow[];
  otherIdentifiers: IdentifierRow[];
  all: IdentifierRow[];
};

const isHospitalNumber = (t: string) => (HOSPITAL_IDENTIFIER_TYPES as readonly string[]).includes(t);

function groupIdentifiers(rows: any[], facilityNames: Map<string, string>): IdentifierSet {
  const mapped: IdentifierRow[] = rows.map(r => ({
    id: r.id, type: r.identifier_type, value: r.value, issuer: r.issuer ?? null,
    facilityId: r.facility_id ?? null,
    facilityName: r.facility_id ? (facilityNames.get(r.facility_id) ?? null) : null,
    live: r.valid_to === null || r.valid_to === undefined,
  }));
  const live = mapped.filter(m => m.live);
  return {
    practiceId: live.find(m => m.type === "practice_id")?.value ?? null,
    hospitalNumbers: live.filter(m => isHospitalNumber(m.type)),
    otherIdentifiers: live.filter(m => m.type !== "practice_id" && !isHospitalNumber(m.type)),
    all: mapped,
  };
}

// ── 1. UNIVERSAL SEARCH ──────────────────────────────────────────────────────────────────────────────

export type SearchMatch = {
  patientId: string;
  displayName: string;
  /** The CP Patient Number, YY-NNNNNN (CPR-PID-001). */
  patientNumber: string | null;
  /** The retired P-XXXXXX, where the record predates the numbering. Legacy, searchable, not headline. */
  practiceId: string | null;
  hospitalNumbers: IdentifierRow[];
  birthDate: string | null;
  age: ReturnType<typeof ageFrom>;
  ageEstimateYears: number | null;
  sex: string;
  status: string;
  /** How this person was reached: "identifier:national_id", "phone", "name", "guardian_phone:mother". */
  matchedBy: string;
  /** DIRECT means the query matched something on the patient. GUARDIAN means it matched somebody else's
   *  number recorded against them -- true, useful for a child with no phone, and not the same thing. */
  matchedVia: "direct" | "guardian";
  matchedGuardian: { name: string; relationshipType: string; relationshipLabel: string } | null;
  rank: number;
};

export type UniversalSearchResult = {
  query: string;
  /** False when the query was empty -- an empty box has not searched and has not found nothing. */
  ran: boolean;
  results: SearchMatch[];
  limit: number;
  truncated: boolean;
  /**
   * FALSE WHENEVER ANY PROBE FAILED OR WAS CAPPED. When this is false, "no results" is not a claim the
   * caller may make -- the honest sentence is "nothing found in what could be searched".
   */
  complete: boolean;
  probes: Record<string, { unavailable: boolean; reason: Unavailable; error: string | null; truncated: boolean }>;
  unavailable: boolean;
  reason: Unavailable;
  searchedBy: string[];
};

/**
 * CPR-V5-006's Universal Search: Practice ID, hospital numbers, name, phone, national ID, passport,
 * email AND parent/guardian phone.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS DOES NOT CALL searchPatients() FROM patients.ts.
 *
 * That function covers identifiers, contacts and names and it ranks them correctly -- and it discards
 * every query error (`const { data: idHits } =`). Built on top of it, a database that refused the
 * identifier read would return "no patient found" for a national ID that is sitting right there, and
 * the desk would register a duplicate. Rule 1 cannot be satisfied by a caller of a function that
 * cannot express failure, so the reads are done here, with the same ranking, and the defect in
 * patients.ts is reported rather than patched around silently.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * THE GUARDIAN PHONE IS MATCHED IN TWO STEPS, AND THE FIRST ONE IS A SUPERSET.
 *
 * practice_patient_relationship.phone is free text with no normalised twin (unlike identifiers and
 * contacts, which migration 193 gave generated columns). So "0772 221 010" is stored with its spaces
 * and `.eq()` on the digits finds nothing. The filter sent to the database is `%0%7%7%2%2%2%1%0%1%0%`:
 * every digit of the query, in order, separated by wildcards. That matches any spacing, any separator
 * and any prefix -- and it matches MORE than it should, which is the point. The exact test is then made
 * here on the digits. A pre-filter that is a strict superset is correct; a clever one that is not is
 * how a child stops being findable by their mother's number.
 */
export async function universalSearch(
  admin: any, ctx: WorkspaceContext, rawQuery: string, opts: { limit?: number; correlationId?: string } = {},
): Promise<UniversalSearchResult> {
  const query = (rawQuery ?? "").trim();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), MAX_PAGE_SIZE);
  const searchedBy = [
    "Patient number", "Practice ID", "Hospital numbers", "National ID", "Passport", "Insurance", "Name",
    "Phone", "Email", "Parent/guardian phone", "Parent/guardian email",
  ];
  const empty = (reason: Unavailable, probes: UniversalSearchResult["probes"] = {}): UniversalSearchResult => ({
    query, ran: false, results: [], limit, truncated: false,
    complete: reason === null, probes, unavailable: reason !== null, reason, searchedBy,
  });

  if (!query) return empty(null);

  // RULE 5, AND search.ts's rule 1: the gate runs BEFORE the query. A caller who may not see patients
  // is told the search did not run -- not shown "3 results hidden", which for a clinical record is a
  // disclosure on its own.
  if (!hasCapability(ctx, "patient.list") || !hasCapability(ctx, "patient.view")) {
    return empty("capability");
  }

  const ws = ctx.workspaceId;
  const nq = normValue(query);
  const nn = norm(query);
  const qDigits = digits(query);
  // A digit subsequence pattern only makes sense once there are enough digits to mean a number. Five is
  // the same floor patients.ts uses for a contact lookup.
  const phonePattern = qDigits.length >= 5 ? `%${qDigits.split("").join("%")}%` : null;

  // CPR-PID-001 s10: "26-000184", "26000184", "26 000184" and the zero-dropped "26-184" all resolve.
  const pn = canonicalPatientNumber(query);

  const [patientNumberHits, identifiers, contacts, nameExact, namePartial, guardianPhone, guardianEmail] = await Promise.all([
    lookup(4, () => pn
      ? admin.from("practice_patient")
        .select("id, status, merged_into_patient_id")
        .eq("workspace_id", ws).eq("patient_number", pn).limit(5)
      : Promise.resolve({ data: [], error: null })),
    lookup(limit * 2, () => admin.from("practice_patient_identifier")
      .select("patient_id, identifier_type").eq("workspace_id", ws)
      .eq("value_normalised", nq).is("valid_to", null).limit(limit * 2 + 1)),
    lookup(limit * 2, () => nq.length >= 5
      ? admin.from("practice_patient_contact").select("patient_id, contact_type")
        .eq("workspace_id", ws).eq("value_normalised", nq).limit(limit * 2 + 1)
      : Promise.resolve({ data: [], error: null })),
    lookup(limit * 2, () => admin.from("practice_patient")
      .select("id").eq("workspace_id", ws).eq("name_normalised", nn).limit(limit * 2 + 1)),
    lookup(limit * 2, () => admin.from("practice_patient")
      .select("id").eq("workspace_id", ws).ilike("name_normalised", `%${nn}%`).limit(limit * 2 + 1)),
    lookup(ENRICHMENT_ROW_CAP, () => phonePattern
      ? admin.from("practice_patient_relationship")
        .select("patient_id, full_name, relationship_type, phone, effective_to")
        .eq("workspace_id", ws).ilike("phone", phonePattern).limit(ENRICHMENT_ROW_CAP + 1)
      : Promise.resolve({ data: [], error: null })),
    lookup(ENRICHMENT_ROW_CAP, () => query.includes("@")
      ? admin.from("practice_patient_relationship")
        .select("patient_id, full_name, relationship_type, email, effective_to")
        .eq("workspace_id", ws).ilike("email", query).limit(ENRICHMENT_ROW_CAP + 1)
      : Promise.resolve({ data: [], error: null })),
  ]);

  const probes: UniversalSearchResult["probes"] = {};
  const record = (key: string, l: Lookup<any>) => {
    probes[key] = {
      unavailable: !l.ok, reason: l.ok ? null : "read_failed", error: l.error, truncated: l.truncated,
    };
  };
  record("patientNumber", patientNumberHits);
  record("identifiers", identifiers); record("contacts", contacts);
  record("nameExact", nameExact); record("namePartial", namePartial);
  record("guardianPhone", guardianPhone); record("guardianEmail", guardianEmail);

  type Hit = { rank: number; matchedBy: string; via: "direct" | "guardian"; guardian: SearchMatch["matchedGuardian"] };
  const hits = new Map<string, Hit>();
  const add = (id: string, hit: Hit) => {
    const cur = hits.get(id);
    if (!cur || cur.rank < hit.rank) hits.set(id, hit);
  };

  // ⚠ THE RETIRED NUMBER OF A MERGED RECORD RESOLVES TO THE SURVIVOR (CPR-PID-001 s13). The number is
  // a COLUMN, so a merge does not move it the way identifiers move -- the merged row keeps it. The
  // probe therefore reads status and the pointer, and a hit on a merged row surfaces the canonical
  // patient with matchedBy saying it arrived through a retired number.
  for (const r of patientNumberHits.rows as any[]) {
    if (r.status === "merged") {
      if (r.merged_into_patient_id)
        add(r.merged_into_patient_id, { rank: MATCH_RANK.identifier + 5, matchedBy: "patient_number:retired_on_merged_record", via: "direct", guardian: null });
    } else {
      add(r.id, { rank: MATCH_RANK.identifier + 5, matchedBy: "patient_number", via: "direct", guardian: null });
    }
  }
  for (const r of identifiers.rows as any[]) {
    add(r.patient_id, { rank: MATCH_RANK.identifier, matchedBy: `identifier:${r.identifier_type}`, via: "direct", guardian: null });
  }
  for (const r of contacts.rows as any[]) {
    add(r.patient_id, { rank: MATCH_RANK[r.contact_type] ?? MATCH_RANK.phone, matchedBy: r.contact_type, via: "direct", guardian: null });
  }
  for (const r of nameExact.rows as any[]) add(r.id, { rank: MATCH_RANK.name, matchedBy: "name", via: "direct", guardian: null });

  const today = practiceToday((await workspaceClock(admin, ws)).timezone);
  const liveRelationship = (r: any) => !r.effective_to || r.effective_to > today;
  const labelOf = (t: string) => (RELATIONSHIP_TYPES.find(([k]) => k === t) ?? [])[1] ?? t;

  // STEP TWO: the exact test, on the digits, over the superset the database returned.
  for (const r of guardianPhone.rows as any[]) {
    if (!liveRelationship(r)) continue;
    if (!digits(r.phone ?? "").includes(qDigits)) continue;
    add(r.patient_id, {
      rank: MATCH_RANK.guardian_phone, matchedBy: `guardian_phone:${r.relationship_type}`, via: "guardian",
      guardian: { name: r.full_name, relationshipType: r.relationship_type, relationshipLabel: labelOf(r.relationship_type) },
    });
  }
  for (const r of guardianEmail.rows as any[]) {
    if (!liveRelationship(r)) continue;
    if (normValue(r.email ?? "") !== nq) continue;
    add(r.patient_id, {
      rank: MATCH_RANK.guardian_email, matchedBy: `guardian_email:${r.relationship_type}`, via: "guardian",
      guardian: { name: r.full_name, relationshipType: r.relationship_type, relationshipLabel: labelOf(r.relationship_type) },
    });
  }
  for (const r of namePartial.rows as any[]) add(r.id, { rank: MATCH_RANK.name_partial, matchedBy: "name_partial", via: "direct", guardian: null });

  const complete = Object.values(probes).every(p => !p.unavailable && !p.truncated);
  const ids = [...hits.keys()];
  if (ids.length === 0) {
    return {
      query, ran: true, results: [], limit, truncated: false, complete, probes,
      unavailable: !complete, reason: complete ? null : "read_failed", searchedBy,
    };
  }

  // MERGED RECORDS ARE EXCLUDED. A merged row is a pointer, not a person; returning it would offer the
  // desk a record that must not be written to. The surviving record is found by every identifier the
  // merge moved, so nothing becomes unfindable.
  const patients = await lookup(ids.length, () => admin.from("practice_patient")
    .select("id, display_name, birth_date, age_estimate_years, sex, status, patient_number")
    .eq("workspace_id", ws).in("id", ids).neq("status", "merged").limit(ids.length + 1));
  record("patients", patients);

  const found = patients.rows as any[];
  const identifierRows = found.length
    ? await lookup(found.length * 20, () => admin.from("practice_patient_identifier")
      .select("id, patient_id, identifier_type, value, issuer, facility_id, valid_to")
      .eq("workspace_id", ws).in("patient_id", found.map(p => p.id)).limit(found.length * 20 + 1))
    : { rows: [] as any[], ok: true, error: null, truncated: false };
  record("resultIdentifiers", identifierRows);

  const facilityNames = await facilityNameMap(admin, ws, identifierRows.rows as any[]);
  const byPatient = new Map<string, any[]>();
  for (const r of identifierRows.rows as any[]) byPatient.set(r.patient_id, [...(byPatient.get(r.patient_id) ?? []), r]);

  const results: SearchMatch[] = found.map(p => {
    const set = groupIdentifiers(byPatient.get(p.id) ?? [], facilityNames);
    const hit = hits.get(p.id)!;
    return {
      patientId: p.id, displayName: p.display_name,
      patientNumber: p.patient_number ?? null,
      practiceId: set.practiceId, hospitalNumbers: set.hospitalNumbers,
      birthDate: p.birth_date ?? null, age: ageFrom(p.birth_date ?? null, today),
      ageEstimateYears: p.age_estimate_years ?? null, sex: p.sex, status: p.status,
      matchedBy: hit.matchedBy, matchedVia: hit.via, matchedGuardian: hit.guardian, rank: hit.rank,
    };
  }).sort((a, b) => b.rank - a.rank || a.displayName.localeCompare(b.displayName));

  const finalComplete = Object.values(probes).every(p => !p.unavailable && !p.truncated);
  await logAccess(admin, {
    workspaceId: ws, actorId: ctx.userId, subjectKind: "search", action: "search",
    route: "patients-workspace/search", detail: query, correlationId: opts.correlationId,
  });

  return {
    query, ran: true, results: results.slice(0, limit), limit, truncated: results.length > limit,
    complete: finalComplete, probes, unavailable: !finalComplete,
    reason: finalComplete ? null : "read_failed", searchedBy,
  };
}

async function facilityNameMap(admin: any, ws: string, identifierRows: any[]): Promise<Map<string, string>> {
  const facilityIds = [...new Set(identifierRows.map(r => r.facility_id).filter(Boolean))] as string[];
  if (facilityIds.length === 0) return new Map();
  const { data, error } = await admin.from("practice_facility")
    .select("id, name").eq("workspace_id", ws).in("id", facilityIds);
  // A facility name is a label. If it cannot be read the identifier still shows, with facilityName null
  // -- the NUMBER is the fact and it is never withheld because its decoration failed.
  if (error) return new Map();
  return new Map(((data ?? []) as any[]).map(f => [f.id, f.name]));
}

// ── 2. OPERATIONAL WORKLISTS ─────────────────────────────────────────────────────────────────────────

export type WorklistRow = {
  id: string;
  patientId: string | null;
  /** null when the caller lacks patient.view. Never a placeholder that reads like a name. */
  patientName: string | null;
  deIdentified: boolean;
  note: string;
  when: string | null;
};

export type Worklist = {
  key: WorklistKey;
  title: string;
  note: string;
  href: string;
  /**
   * DISTINCT PATIENTS -- the length of the list this tile opens. null when unavailable (Rule 1: never 0
   * because a read failed).
   */
  count: number | null;
  /** Rows behind it: obligations, documents, queue entries. Equals `count` when a row is a person. */
  rowCount: number | null;
  /** What `rowCount` counts, so a screen can say "7 documents across 5 patients" rather than guess. */
  rowNoun: string;
  atLeast: boolean;
  rows: WorklistRow[];
  unavailable: boolean;
  reason: Unavailable;
  error: string | null;
  limit: number;
  truncated: boolean;
  /** The patient ids behind the figure, so the tile opens a filtered cohort. Rule 2. */
  patientIds: string[];
};

export type WorklistsResult = {
  today: string;
  timezone: string;
  worklists: Worklist[];
  /** Which worklists could not be answered, by name, so the screen says so instead of showing zero. */
  blindSpots: { key: WorklistKey; title: string; reason: Unavailable; error: string | null }[];
  pendingResultsBoundary: string;
  refuses: typeof REFUSES;
};

export async function worklists(
  admin: any, ctx: WorkspaceContext, opts: { limit?: number } = {},
): Promise<WorklistsResult> {
  const ws = ctx.workspaceId;
  const limit = Math.min(Math.max(opts.limit ?? WORKLIST_ROW_LIMIT, 1), MAX_PAGE_SIZE);
  const { timezone, today } = await workspaceClock(admin, ws);
  const { startIso, endIso } = zonedDayRange(today, timezone);
  const can = (c: string) => hasCapability(ctx, c);
  // Names come from patient.view, separately from the right to see the list at all. Rule 5.
  const mayName = can("patient.view");

  const [waiting, dueFollowUps, pendingResults, walkInQueue, walkInAppts, recent, registered,
    inConsultation, followUpsToday, urgentReviews, booked] = await Promise.all([
    probe(can(WORKLIST_META.waiting.capability), limit, () => admin.from("practice_queue_entry")
      .select("id, patient_id, patient_name, status, entered_at")
      .eq("workspace_id", ws).in("status", ["WAITING", "READY", "IN_CONSULTATION", "PAUSED"])
      .order("entered_at").limit(limit + 1)),
    // DUE IS DERIVED, NOT STORED -- and it is compared against the PRACTICE's today. Migration 196
    // refuses to keep a status column for it.
    //
    // ⚠ THIS IS NOW `< today`, STRICTLY OVERDUE, AND THE CHANGE IS THE POINT. It was `<= today`, so the
    // list contained today's obligations as well and the card had to be retitled "due & overdue" to
    // avoid overstating the backlog. CPR-PAT-002 asks for a separate Follow-ups Today card, and with
    // both present each predicate can be honest: today's are `= today` below, these are the late ones,
    // and neither double-counts the other.
    probe(can(WORKLIST_META.dueFollowUps.capability), limit, () => admin.from("practice_follow_up")
      .select("id, patient_id, reason, kind, due_on, priority, status")
      .eq("workspace_id", ws).eq("status", "OPEN").lt("due_on", today)
      .order("due_on").limit(limit + 1)),
    // WHAT CAME BACK, NOT WHAT WAS ASKED FOR. See REFUSES.orders_placed.
    probe(can(WORKLIST_META.pendingResults.capability), limit, () => admin.from("practice_incoming_document")
      .select("id, patient_id, doc_type, source, title, priority, received_on, status")
      .eq("workspace_id", ws).eq("status", "RECEIVED")
      .order("received_on", { ascending: false }).limit(limit + 1)),
    // A walk-in is somebody with no booking behind them. Two records mean that, so both are read and
    // the rows are deduplicated by patient; each row says which one it came from.
    probe(can(WORKLIST_META.walkIns.capability), limit, () => admin.from("practice_queue_entry")
      .select("id, patient_id, patient_name, status, entered_at")
      .eq("workspace_id", ws).is("appointment_id", null)
      .gte("entered_at", startIso).lt("entered_at", endIso)
      .order("entered_at").limit(limit + 1)),
    probe(can(WORKLIST_META.walkIns.capability), limit, () => admin.from("practice_appointment")
      .select("id, patient_id, patient_name, scheduled_at, status")
      .eq("workspace_id", ws).eq("appointment_type", "walk_in")
      .gte("scheduled_at", startIso).lt("scheduled_at", endIso)
      .order("scheduled_at").limit(limit + 1)),
    // ⚠ THIS READ HAD NO TIME WINDOW AT ALL. It was "the most recent N encounters, EVER" -- so in any
    // practice past the read limit the figure was neither a period nor a total, and the card's own note
    // ("whose consultation was most recently started") was true of the rows and false of the number.
    // The window is the practice's own 30 days, on the practice's clock like every other date here.
    probe(can(WORKLIST_META.recentPatients.capability), limit, () => admin.from("practice_encounter")
      .select("id, patient_id, status, reason_for_visit, started_at")
      .eq("workspace_id", ws)
      .gte("started_at", zonedDayRange(dueDateFrom(today, -RECENT_WINDOW_DAYS), timezone).startIso)
      .lt("started_at", endIso)
      .order("started_at", { ascending: false }).limit(limit + 1)),
    probe(can(WORKLIST_META.newRegistrations.capability), limit, () => admin.from("practice_patient")
      .select("id, display_name, status, created_at")
      .eq("workspace_id", ws).gte("created_at", startIso).lt("created_at", endIso)
      .order("created_at", { ascending: false }).limit(limit + 1)),

    // ── BOOKED: what is still to come (the owner, 2026-08-12) ────────────────────────────────────
    //
    // FROM THE START OF THE PRACTICE'S TODAY, not from "now". An appointment at 09:00 read at 10:00 has
    // not happened -- nobody marked it arrived, completed or missed -- and dropping it at the moment it
    // becomes late is exactly when a desk most needs to see it. The window opens on the practice's own
    // calendar, like every other date on this screen, and has NO upper bound: "booked" means booked.
    //
    // ⚠ THE THREE LIVE STATUSES ONLY. CANCELLED, COMPLETED and NO_SHOW are excluded, so this figure can
    // never overstate what is coming -- which is the one way a card called "Booked" could lie.
    probe(can(WORKLIST_META.booked.capability), limit, () => admin.from("practice_appointment")
      .select("id, patient_id, patient_name, scheduled_at, appointment_type, status, location_id")
      .eq("workspace_id", ws).in("status", ["REQUESTED", "CONFIRMED", "ARRIVED"])
      .gte("scheduled_at", startIso)
      .order("scheduled_at").limit(limit + 1)),

    // ── CPR-PAT-002's three Today's Care cards that had no engine and rendered an em dash ──────────
    //
    // IN CONSULTATION IS ITS OWN STATE, NOT A SLICE OF WAITING. `waiting` folds four queue states into
    // one figure deliberately -- it answers "who is in the building" -- and CPR-PAT-002 asks separately
    // for the people actually with a clinician. The two therefore OVERLAP BY DESIGN, and that is said on
    // the cards rather than fixed by narrowing `waiting`, which would break the question it exists for.
    probe(can(WORKLIST_META.inConsultation.capability), limit, () => admin.from("practice_queue_entry")
      .select("id, patient_id, patient_name, status, entered_at")
      .eq("workspace_id", ws).eq("status", "IN_CONSULTATION")
      .order("entered_at").limit(limit + 1)),

    // DUE TODAY, EXACTLY. Adding this is what let the list above go back to meaning OVERDUE.
    probe(can(WORKLIST_META.followUpsToday.capability), limit, () => admin.from("practice_follow_up")
      .select("id, patient_id, reason, kind, due_on, priority, status")
      .eq("workspace_id", ws).eq("status", "OPEN").eq("due_on", today)
      .order("priority").limit(limit + 1)),

    // URGENT REVIEWS. Migration 196 stores priority as (routine, soon, urgent), and THIS VERY READ
    // ALREADY SELECTED IT AND THREW IT AWAY -- the card was reported as unsupported while the column
    // was arriving in the payload. `soon` is included with `urgent`: the card answers which reviews
    // cannot wait, and a practitioner who marked something "soon" and finds it filed with the routine
    // work has been ignored by the product they told.
    probe(can(WORKLIST_META.urgentReviews.capability), limit, () => admin.from("practice_follow_up")
      .select("id, patient_id, reason, kind, due_on, priority, status")
      .eq("workspace_id", ws).in("status", ["OPEN", "SCHEDULED"]).in("priority", ["soon", "urgent"])
      .lte("due_on", today).order("due_on").limit(limit + 1)),
  ]);

  // Names for the rows that only carry a patient id, in one query rather than one per row.
  const idsNeedingNames = [...new Set([
    ...dueFollowUps.rows.map((r: any) => r.patient_id),
    ...pendingResults.rows.map((r: any) => r.patient_id),
    ...recent.rows.map((r: any) => r.patient_id),
  ].filter(Boolean))] as string[];
  const nameLookup = mayName && idsNeedingNames.length
    ? await lookup(idsNeedingNames.length, () => admin.from("practice_patient")
      .select("id, display_name").eq("workspace_id", ws).in("id", idsNeedingNames).limit(idsNeedingNames.length + 1))
    : { rows: [] as any[], ok: true, error: null, truncated: false };
  const nameOf = new Map(((nameLookup.rows ?? []) as any[]).map(p => [p.id, p.display_name]));

  const named = (patientId: string | null, fallback?: string | null): { patientName: string | null; deIdentified: boolean } => {
    if (!mayName) return { patientName: null, deIdentified: true };
    const n = (patientId ? nameOf.get(patientId) : null) ?? fallback ?? null;
    return { patientName: n, deIdentified: false };
  };

  const build = (
    key: WorklistKey, p: Probe<any>, toRow: (r: any) => Omit<WorklistRow, "patientName" | "deIdentified"> & { patientId: string | null; fallbackName?: string | null },
  ): Worklist => {
    const meta = WORKLIST_META[key];
    const rows: WorklistRow[] = p.rows.map(r => {
      const base = toRow(r);
      const { fallbackName, ...rest } = base;
      return { ...rest, ...named(base.patientId, fallbackName) };
    });
    const patientIds = [...new Set(rows.map(r => r.patientId).filter(Boolean))] as string[];
    // ⚠ THE FIGURE ON THE CARD IS THE LENGTH OF THE LIST THE CARD OPENS. It was not.
    //
    // `count` was p.count -- the ROW count -- while clicking the tile filters the register to
    // `patientIds`, which is deduplicated. One patient with two overdue obligations made the card say 2
    // and the table show 1, and the disagreement reads as a bug in the TABLE, which is the half a
    // practitioner would otherwise trust. Every figure being the length of a list you can open is this
    // module's own doctrine, and this was the one place it was not honoured.
    //
    // BOTH ARE CARRIED, because the row IS the unit of work for some of these: "results to review" is a
    // count of DOCUMENTS and a practitioner has seven things to read even if they belong to five people.
    // Two values as two fields, never one number standing for both -- the same rule as counts and
    // denominators. A screen shows `count`, and shows `rowCount` beside it only when they differ.
    return {
      key, title: meta.title, note: meta.note, href: meta.href,
      count: p.unavailable ? null : patientIds.length,
      /** Rows behind the figure: obligations, documents, queue entries. Equals `count` when a row is a person. */
      rowCount: p.count,
      /** The noun `rowCount` counts, so a screen can say "7 documents across 5 patients" without guessing. */
      rowNoun: meta.rowNoun,
      atLeast: p.truncated, rows,
      unavailable: p.unavailable, reason: p.reason, error: p.error, limit: p.limit, truncated: p.truncated,
      patientIds,
    };
  };

  const daysLate = (dueOn: string) =>
    Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueOn}T00:00:00Z`)) / 86400000);

  // The two walk-in sources, merged. Deduplicated by patient where there is one; a queue entry with no
  // patient id cannot be matched to anything and stays on its own.
  const walkInsProbe: Probe<any> = (() => {
    if (walkInQueue.unavailable || walkInAppts.unavailable) {
      const failed = walkInQueue.unavailable ? walkInQueue : walkInAppts;
      return { rows: [], count: null, unavailable: true, reason: failed.reason, error: failed.error, limit, truncated: false };
    }
    const seen = new Set<string>();
    const merged: any[] = [];
    for (const r of walkInQueue.rows as any[]) {
      if (r.patient_id) { if (seen.has(r.patient_id)) continue; seen.add(r.patient_id); }
      merged.push({ ...r, _source: "queue" });
    }
    for (const r of walkInAppts.rows as any[]) {
      if (r.patient_id) { if (seen.has(r.patient_id)) continue; seen.add(r.patient_id); }
      merged.push({ ...r, _source: "appointment" });
    }
    return {
      rows: merged.slice(0, limit), count: Math.min(merged.length, limit),
      unavailable: false, reason: null, error: null, limit,
      truncated: merged.length > limit || walkInQueue.truncated || walkInAppts.truncated,
    };
  })();

  const built: Worklist[] = [
    build("waiting", waiting, r => ({
      id: r.id, patientId: r.patient_id ?? null, fallbackName: r.patient_name,
      note: r.status === "IN_CONSULTATION" ? "In consultation" : r.status === "READY" ? "Ready" : r.status === "PAUSED" ? "Paused" : "Waiting",
      when: r.entered_at,
    })),
    build("dueFollowUps", dueFollowUps, r => {
      const late = daysLate(r.due_on);
      return {
        id: r.id, patientId: r.patient_id ?? null,
        note: `${late > 0 ? `${late}d overdue` : "due today"} - ${r.reason}`,
        when: r.due_on,
      };
    }),
    build("pendingResults", pendingResults, r => ({
      id: r.id, patientId: r.patient_id ?? null,
      note: `${r.title} (${r.source})${r.priority === "urgent" ? " - urgent" : ""}`,
      when: r.received_on,
    })),
    build("walkIns", walkInsProbe, r => ({
      id: r.id, patientId: r.patient_id ?? null, fallbackName: r.patient_name,
      note: r._source === "queue" ? "Queued at the desk, no booking" : "Booked in as a walk-in",
      when: r.entered_at ?? r.scheduled_at,
    })),
    build("recentPatients", recent, r => ({
      id: r.id, patientId: r.patient_id ?? null,
      note: r.reason_for_visit ? `${r.status} - ${r.reason_for_visit}` : r.status,
      when: r.started_at,
    })),
    build("newRegistrations", registered, r => ({
      id: r.id, patientId: r.id, fallbackName: r.display_name,
      note: r.status === "active" ? "Registered today" : `Registered today (${r.status})`,
      when: r.created_at,
    })),
    // ⚠ THE NOTE CARRIES THE STATUS IN WORDS. "Booked" folds three states into one figure, and a
    // REQUESTED appointment is not a confirmed one -- the row says which, so the tile's count never has
    // to be read as "all confirmed".
    build("booked", booked, r => ({
      id: r.id, patientId: r.patient_id ?? null, fallbackName: r.patient_name,
      note: `${String(r.appointment_type).replace(/_/g, " ")} - ${String(r.status).toLowerCase()}`,
      when: r.scheduled_at,
    })),
    build("inConsultation", inConsultation, r => ({
      id: r.id, patientId: r.patient_id ?? null, fallbackName: r.patient_name,
      note: "With a clinician now",
      when: r.entered_at,
    })),
    build("followUpsToday", followUpsToday, r => ({
      id: r.id, patientId: r.patient_id ?? null,
      // No "due today" prefix: every row in this list is due today, and repeating it on each one costs
      // the space the reason needs.
      note: r.priority === "routine" ? r.reason : `${r.reason} (${r.priority})`,
      when: r.due_on,
    })),
    build("urgentReviews", urgentReviews, r => {
      const late = daysLate(r.due_on);
      return {
        id: r.id, patientId: r.patient_id ?? null,
        // The PRIORITY is what the practitioner set. It is never inferred from how late something is --
        // a routine review three weeks late is still routine, and quietly promoting it would put this
        // product's guess where a clinician's judgement belongs.
        note: `${r.priority}${late > 0 ? `, ${late}d overdue` : ", due today"} - ${r.reason}`,
        when: r.due_on,
      };
    }),
  ];

  // The order is WORKLIST_KEYS, stated once as data, so the page cannot quietly re-sort itself into
  // whatever order the queries happened to return.
  const ordered = WORKLIST_KEYS.map(k => built.find(w => w.key === k)!);

  return {
    today, timezone, worklists: ordered,
    blindSpots: ordered.filter(w => w.unavailable)
      .map(w => ({ key: w.key, title: w.title, reason: w.reason, error: w.error })),
    pendingResultsBoundary: PENDING_RESULTS_BOUNDARY,
    refuses: REFUSES,
  };
}

// ── 3. MY PATIENTS ───────────────────────────────────────────────────────────────────────────────────

export type CohortRow = {
  patientId: string;
  /** null when the caller lacks patient.view. */
  name: string | null;
  deIdentified: boolean;
  /** The CP Patient Number, YY-NNNNNN (CPR-PID-001); withheld with the name. */
  patientNumber: string | null;
  /** The retired P-XXXXXX where the record predates the numbering. Legacy, not headline. */
  practiceId: string | null;
  hospitalNumbers: IdentifierRow[];
  /** Derived from the most recent encounter. */
  lastSeen: string | null;
  /** FALSE means "could not see far enough to say", which is not the same as "never seen". */
  lastSeenKnown: boolean;
  nextFollowUp: { id: string; dueOn: string; reason: string; status: string; overdue: boolean } | null;
  nextFollowUpKnown: boolean;
  /**
   * The soonest LIVE, FUTURE appointment. Distinct from nextFollowUp, which is a clinical intention
   * (practice_follow_up) rather than a diary entry -- the register showed "none open" for people who
   * were booked, because those are two different questions.
   */
  nextAppointment: { id: string; at: string; status: string; kind: string; locationName: string | null } | null;
  /** ⚠ FALSE means "not established", never "no appointment". See nextApptKnown. */
  nextAppointmentKnown: boolean;
  currentStatus: { code: CohortStatus; label: string };
  /** CPR-V5-006's Location column. A PLACE -- see placeMap. Never a care setting. */
  location: Place & { source: "encounter" | null };
  recordStatus: string;
};

/**
 * One token carries the column AND the direction, because the URL carries one `sort` value and a
 * separate `dir` param would let the two disagree ("name" + a direction meant for dates).
 */
export type CohortSort =
  | "registered" | "registered_oldest"
  | "name" | "name_desc"
  | "last_seen" | "last_seen_oldest"
  | "next_review" | "next_review_latest";

export type CohortResult = {
  rows: CohortRow[];
  page: number;
  /** Doctrine 10 as a field, not as page text. */
  pageSize: number;
  hasMore: boolean;
  /** The exact size of the cohort, or null if it could not be counted. Never inferred from the page. */
  total: number | null;
  scope: "practice" | "mine";
  /** The sort that was ACTUALLY applied -- a derived sort that degraded reports "registered" here. */
  sort: CohortSort;
  sortOptions: { key: string; label: string; available: boolean; note?: string }[];
  /** Set when a requested ordering could not be honoured; says what happened instead. Never silent. */
  sortNote: string | null;
  today: string;
  unavailable: boolean;
  reason: Unavailable;
  error: string | null;
  /** Named gaps in the enrichment reads, so a null column is never read as a fact. */
  enrichment: Record<string, { ok: boolean; error: string | null; truncated: boolean }>;
};

/**
 * The paginated cohort: Name, Practice ID, Hospital Numbers, Last Seen, Next Follow-up, Current Status,
 * Location -- CPR-V5-006's seven columns, four of them derived at read time.
 *
 * ⚠ SORTING BY LAST SEEN AND NEXT REVIEW IS ORDERED AT THE SOURCE, NOT WITHIN THE PAGE. The refusal
 * this function used to carry ("an ordering that is only true within a page") was about sorting the
 * PAGE after fetching it -- which would give page two rows that belong on page one. What ships instead
 * (2026-08-11, the owner asked for clickable column sorting): the ordered patient-id list is built from
 * the encounter or follow-up table FIRST, bounded by SORT_ORDER_CAP, and the page is a slice of that
 * list -- so the ordering is true across every page or it is not offered at all. A register or an
 * ordering read that exceeds the cap DEGRADES, loudly: the payload's `sort` says what actually applied
 * and `sortNote` says why. Patients with nothing to order by (never seen, no open follow-up) come LAST
 * in both directions -- a direction flip must not bury the register under its own blank rows.
 */
export async function myPatients(
  admin: any, ctx: WorkspaceContext,
  opts: {
    page?: number; pageSize?: number; scope?: "practice" | "mine"; sort?: CohortSort;
    /** The bridge from a worklist tile to a filtered patient list. Rule 2. */
    patientIds?: string[];
    includeInactive?: boolean;
    /**
     * ⚠ WHEN THEY WERE REGISTERED, AND THAT IS THE ONLY DATE A PATIENT RECORD OWNS.
     *
     * A patient is not an event. `created_at` is when the record was made -- not when the person was
     * seen, which lives on encounters, and not when they are due, which lives on follow-ups. So a period
     * on this register can honestly answer "who did we register that week" and nothing else, and the
     * screen says exactly that rather than letting a reader take it for "who did we see".
     *
     * Absent by default. A register whose whole purpose is finding a person must not hide people by
     * default because of when their record happens to have been created.
     */
    registeredFrom?: string; registeredTo?: string;
  } = {},
): Promise<CohortResult> {
  const ws = ctx.workspaceId;
  const page = Math.max(opts.page ?? 0, 0);
  const pageSize = Math.min(Math.max(opts.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const scope = opts.scope ?? "practice";
  const sort = opts.sort ?? "registered";
  // ⚠ THE TIMEZONE IS TAKEN HERE TOO, because the registration window below is a pair of CALENDAR
  // DAYS and created_at is a timestamp. A day boundary read in UTC puts the first hours of a Kampala
  // day in the day before, which on a one-day period is the whole of it.
  const { today, timezone } = await workspaceClock(admin, ws);
  const mayName = hasCapability(ctx, "patient.view");
  const enrichment: CohortResult["enrichment"] = {};
  const sortOptions = [
    { key: "registered", label: "Most recently registered", available: true },
    { key: "registered_oldest", label: "Oldest registered first", available: true },
    { key: "name", label: "Name A to Z", available: true },
    { key: "name_desc", label: "Name Z to A", available: true },
    {
      key: "last_seen", label: "Last seen, most recent first", available: true,
      note: "Ordered from the encounter table itself, so it is true across pages. Patients never seen here come last either way.",
    },
    { key: "last_seen_oldest", label: "Last seen, longest ago first", available: true },
    {
      key: "next_review", label: "Next review, soonest due first", available: true,
      note: "Ordered by the earliest open follow-up. Patients with none open come last either way.",
    },
    { key: "next_review_latest", label: "Next review, furthest away first", available: true },
  ];
  /** What was actually applied; a degraded derived sort reports "registered" + a sortNote. */
  let effSort: CohortSort = sort;
  let sortNote: string | null = null;
  const shell = (reason: Unavailable, error: string | null): CohortResult => ({
    rows: [], page, pageSize, hasMore: false, total: null, scope, sort: effSort, sortOptions, sortNote, today,
    unavailable: true, reason, error, enrichment,
  });

  if (!hasCapability(ctx, "patient.list")) return shell("capability", null);

  // "MY" PATIENTS MEANS THE ONES THIS PRACTITIONER HAS CONSULTED, which is the only practitioner-to-
  // patient link this schema holds: practice_encounter.created_by. It is capped, and the cap is
  // reported -- a scope that silently loses the older half of somebody's list is worse than one that
  // says it is showing the recent part.
  let restrictTo: string[] | null = null;
  if (scope === "mine") {
    if (!hasCapability(ctx, "encounter.list")) return shell("capability", null);
    const mine = await lookup(ENRICHMENT_ROW_CAP, () => admin.from("practice_encounter")
      .select("patient_id").eq("workspace_id", ws).eq("created_by", ctx.userId)
      .order("started_at", { ascending: false }).limit(ENRICHMENT_ROW_CAP + 1));
    enrichment.scopeMine = { ok: mine.ok, error: mine.error, truncated: mine.truncated };
    if (!mine.ok) return shell("read_failed", mine.error);
    restrictTo = [...new Set((mine.rows as any[]).map(r => r.patient_id).filter(Boolean))] as string[];
  }
  if (opts.patientIds) {
    const filtered = opts.patientIds.slice(0, MAX_PAGE_SIZE * 10);
    restrictTo = restrictTo === null ? filtered : restrictTo.filter(id => filtered.includes(id));
  }
  if (restrictTo !== null && restrictTo.length === 0) {
    return {
      rows: [], page, pageSize, hasMore: false, total: 0, scope, sort: effSort, sortOptions, sortNote, today,
      unavailable: false, reason: null, error: null, enrichment,
    };
  }

  const applyFilters = (q: any) => {
    let out = q.eq("workspace_id", ws);
    // Merged records are pointers, never people. Archived ones are people, and are excluded by default
    // but askable for -- "we archived them" is a different fact from "they do not exist".
    out = opts.includeInactive ? out.neq("status", "merged") : out.eq("status", "active");
    if (restrictTo !== null) out = out.in("id", restrictTo);
    // ⚠ APPLIED TO THE PAGE READ AND TO THE COUNT, because both go through this function. A period that
    // narrowed the rows and not the total would print "42 patients" over a table of three.
    if (opts.registeredFrom) out = out.gte("created_at", zonedDayRange(opts.registeredFrom, timezone).startIso);
    if (opts.registeredTo) out = out.lt("created_at", zonedDayRange(opts.registeredTo, timezone).endIso);
    return out;
  };

  const from = page * pageSize;
  const PAGE_COLS = "id, display_name, sex, birth_date, age_estimate_years, status, created_at, patient_number";
  let rows: any[] = [];
  let hasMore = false;
  let totalOut: number | null = null;

  // ── THE DERIVED ORDERINGS: last seen and next review ──────────────────────────────────────────────
  // The whole ordered id-list is built first and the page is a slice of it, so page two continues page
  // one instead of overlapping it. Both reads are bounded; hitting a bound DEGRADES to the registered
  // order with the reason in sortNote -- an ordering that might be missing rows is not an ordering.
  if (sort === "last_seen" || sort === "last_seen_oldest" || sort === "next_review" || sort === "next_review_latest") {
    const byLastSeen = sort === "last_seen" || sort === "last_seen_oldest";
    const reg = await lookup(SORT_ORDER_CAP, () => applyFilters(admin.from("practice_patient").select("id"))
      .order("created_at", { ascending: false }).limit(SORT_ORDER_CAP + 1));
    enrichment.sortRegister = { ok: reg.ok, error: reg.error, truncated: reg.truncated };
    const src = reg.ok && !reg.truncated
      ? await lookup(SORT_ORDER_CAP, () => byLastSeen
        ? admin.from("practice_encounter").select("patient_id, started_at")
          .eq("workspace_id", ws).order("started_at", { ascending: false }).limit(SORT_ORDER_CAP + 1)
        : admin.from("practice_follow_up").select("patient_id, due_on")
          .eq("workspace_id", ws).in("status", ["OPEN", "SCHEDULED"]).order("due_on").limit(SORT_ORDER_CAP + 1))
      : null;
    if (src) enrichment.sortOrdering = { ok: src.ok, error: src.error, truncated: src.truncated };

    if (!reg.ok || reg.truncated || !src || !src.ok || src.truncated) {
      effSort = "registered";
      const why = !reg.ok ? (reg.error ?? "the register could not be read")
        : reg.truncated ? `the register is larger than the ${SORT_ORDER_CAP}-row bound this ordering can hold`
          : !src!.ok ? (src!.error ?? "the ordering read failed")
            : `more than ${SORT_ORDER_CAP} ${byLastSeen ? "encounters" : "open follow-ups"} exist, so the ordering could be missing rows`;
      sortNote = `Could not order by ${byLastSeen ? "last seen" : "next review"}: ${why}. Showing most recently registered instead.`;
    } else {
      const registerIds = (reg.rows as any[]).map(r => r.id as string);
      const inRegister = new Set(registerIds);
      // First occurrence wins: the source is already ordered, so a patient's first row IS their most
      // recent encounter (or their earliest open follow-up).
      const head: string[] = [];
      const placed = new Set<string>();
      for (const r of src.rows as any[]) {
        const id = r.patient_id as string | null;
        if (!id || placed.has(id) || !inRegister.has(id)) continue;
        placed.add(id); head.push(id);
      }
      if (sort === "last_seen_oldest" || sort === "next_review_latest") head.reverse();
      const combined = head.concat(registerIds.filter(id => !placed.has(id)));

      totalOut = combined.length;
      hasMore = combined.length > from + pageSize;
      const slice = combined.slice(from, from + pageSize);
      enrichment.total = { ok: true, error: null, truncated: false };
      if (slice.length === 0) {
        return {
          rows: [], page, pageSize, hasMore: false, total: totalOut, scope, sort: effSort, sortOptions,
          sortNote, today, unavailable: false, reason: null, error: null, enrichment,
        };
      }
      const { data: sliceData, error: sliceError } = await admin.from("practice_patient")
        .select(PAGE_COLS).eq("workspace_id", ws).in("id", slice);
      if (sliceError) return shell("read_failed", String(sliceError.message ?? sliceError));
      const at = new Map(slice.map((id, i) => [id, i]));
      rows = ((sliceData ?? []) as any[]).sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
    }
  }

  // ── THE DIRECT ORDERINGS (and the landing place of a degraded derived one) ────────────────────────
  if (rows.length === 0 && totalOut === null) {
    const orderCol = effSort === "name" || effSort === "name_desc" ? "name_normalised" : "created_at";
    const ascending = effSort === "name" || effSort === "registered_oldest";
    const { data: pageData, error: pageError } = await applyFilters(
      admin.from("practice_patient").select(PAGE_COLS),
    )
      .order(orderCol, { ascending })
      // ONE ROW MORE THAN THE PAGE, so hasMore is a fact rather than a guess from a count that may be stale.
      .range(from, from + pageSize);
    if (pageError) return shell("read_failed", String(pageError.message ?? pageError));

    const all = (pageData ?? []) as any[];
    hasMore = all.length > pageSize;
    rows = all.slice(0, pageSize);

    const { count: total, error: countError } = await applyFilters(
      admin.from("practice_patient").select("id", { count: "exact", head: true }),
    );
    enrichment.total = { ok: !countError, error: countError ? String(countError.message ?? countError) : null, truncated: false };
    totalOut = countError ? null : (total ?? 0);

    if (rows.length === 0) {
      return {
        rows: [], page, pageSize, hasMore: false, total: totalOut,
        scope, sort: effSort, sortOptions, sortNote, today, unavailable: false, reason: null, error: null, enrichment,
      };
    }
  }

  const ids = rows.map(r => r.id);
  const nowIso = new Date().toISOString();
  const [identifiers, encounters, followUps, queue, appointments] = await Promise.all([
    lookup(ids.length * 20, () => admin.from("practice_patient_identifier")
      .select("id, patient_id, identifier_type, value, issuer, facility_id, valid_to")
      .eq("workspace_id", ws).in("patient_id", ids).limit(ids.length * 20 + 1)),
    lookup(ENRICHMENT_ROW_CAP, () => admin.from("practice_encounter")
      .select("id, patient_id, status, started_at, location_id, activity_id, encounter_mode")
      .eq("workspace_id", ws).in("patient_id", ids)
      .order("started_at", { ascending: false }).limit(ENRICHMENT_ROW_CAP + 1)),
    lookup(ENRICHMENT_ROW_CAP, () => admin.from("practice_follow_up")
      .select("id, patient_id, reason, due_on, status")
      .eq("workspace_id", ws).in("patient_id", ids).in("status", ["OPEN", "SCHEDULED"])
      .order("due_on").limit(ENRICHMENT_ROW_CAP + 1)),
    lookup(ENRICHMENT_ROW_CAP, () => admin.from("practice_queue_entry")
      .select("id, patient_id, status, entered_at")
      .eq("workspace_id", ws).in("patient_id", ids)
      .in("status", ["WAITING", "READY", "IN_CONSULTATION", "PAUSED"]).limit(ENRICHMENT_ROW_CAP + 1)),
    // ⚠ THE REGISTER HAS NEVER READ APPOINTMENTS, and the owner found it: "Is registered the same as
    // booked? Shouldn't I have a column that shows me the patients who have appointments?" The status
    // ladder below turned only on encounters and the queue, so somebody booked for next month read
    // "Registered, not yet seen" -- true, and silent about the one fact being asked for. Next review is
    // a different thing again: it is practice_follow_up, a clinical intention, not a diary entry.
    //
    // FUTURE AND STILL LIVE ONLY. A cancelled booking is not an appointment, and a past one is history
    // that Booked and seen already reports -- this column answers "who is coming".
    lookup(ENRICHMENT_ROW_CAP, () => admin.from("practice_appointment")
      .select("id, patient_id, scheduled_at, status, appointment_type, location_id")
      .eq("workspace_id", ws).in("patient_id", ids)
      .in("status", ["REQUESTED", "CONFIRMED", "ARRIVED"]).gte("scheduled_at", nowIso)
      .order("scheduled_at").limit(ENRICHMENT_ROW_CAP + 1)),
  ]);
  enrichment.identifiers = { ok: identifiers.ok, error: identifiers.error, truncated: identifiers.truncated };
  enrichment.encounters = { ok: encounters.ok, error: encounters.error, truncated: encounters.truncated };
  enrichment.followUps = { ok: followUps.ok, error: followUps.error, truncated: followUps.truncated };
  enrichment.queue = { ok: queue.ok, error: queue.error, truncated: queue.truncated };
  enrichment.appointments = { ok: appointments.ok, error: appointments.error, truncated: appointments.truncated };

  const facilityNames = await facilityNameMap(admin, ws, identifiers.rows as any[]);
  const places = await placeMap(admin, ws, encounters.rows as any[]);

  const identByPatient = new Map<string, any[]>();
  for (const r of identifiers.rows as any[]) identByPatient.set(r.patient_id, [...(identByPatient.get(r.patient_id) ?? []), r]);
  const encByPatient = new Map<string, any[]>();
  for (const r of encounters.rows as any[]) encByPatient.set(r.patient_id, [...(encByPatient.get(r.patient_id) ?? []), r]);
  const fuByPatient = new Map<string, any[]>();
  for (const r of followUps.rows as any[]) fuByPatient.set(r.patient_id, [...(fuByPatient.get(r.patient_id) ?? []), r]);
  const queueByPatient = new Map<string, any>();
  for (const r of queue.rows as any[]) if (r.patient_id && !queueByPatient.has(r.patient_id)) queueByPatient.set(r.patient_id, r);
  // Ordered by scheduled_at above, so the FIRST row for a patient is their soonest.
  const apptByPatient = new Map<string, any>();
  for (const r of appointments.rows as any[]) if (r.patient_id && !apptByPatient.has(r.patient_id)) apptByPatient.set(r.patient_id, r);
  const apptPlaces = await placeMap(admin, ws, appointments.rows as any[]);

  const LIVE_ENCOUNTER = ["DRAFT", "ACTIVE", "PAUSED"];

  const cohort: CohortRow[] = rows.map(p => {
    const set = groupIdentifiers(identByPatient.get(p.id) ?? [], facilityNames);
    const encs = encByPatient.get(p.id) ?? [];
    const live = encs.find((e: any) => LIVE_ENCOUNTER.includes(e.status));
    const latest = encs[0] ?? null;
    // TRUNCATION DOES NOT BECOME "NEVER SEEN". If the enrichment read hit its cap and this patient had
    // no row in it, we do not know whether they have been seen -- so we say we do not know.
    const lastSeenKnown = encounters.ok && (!encounters.truncated || encs.length > 0);
    const fus = fuByPatient.get(p.id) ?? [];
    const nextFu = fus[0] ?? null;
    const q = queueByPatient.get(p.id) ?? null;
    const nextAppt = apptByPatient.get(p.id) ?? null;
    // ⚠ TRUNCATION DOES NOT BECOME "NO APPOINTMENT", the same rule lastSeenKnown follows above. If the
    // read hit its cap and this patient had no row in it, we do not know whether they are booked -- and
    // "none" would be a confident answer to a question we did not finish asking.
    const nextApptKnown = appointments.ok && (!appointments.truncated || !!nextAppt);
    const locationSource = live ?? latest;

    let code: CohortStatus;
    if (p.status === "merged") code = "merged";
    else if (p.status === "archived") code = "archived";
    else if (q?.status === "IN_CONSULTATION" || live?.status === "ACTIVE") code = "in_consultation";
    else if (q) code = "waiting";
    else if (live) code = "encounter_open";
    else if (encs.length > 0) code = "seen";
    // ⚠ BOOKED IS NOT REGISTERED. Only reachable when nobody has been seen yet -- a patient with
    // encounters stays "Seen", because their history is the more useful answer and their next
    // appointment has its own column.
    else if (nextAppt) code = "booked_not_seen";
    else code = "registered_not_seen";

    return {
      patientId: p.id,
      name: mayName ? p.display_name : null,
      deIdentified: !mayName,
      patientNumber: mayName ? (p.patient_number ?? null) : null,
      practiceId: mayName ? set.practiceId : null,
      hospitalNumbers: mayName ? set.hospitalNumbers : [],
      lastSeen: latest?.started_at ?? null,
      lastSeenKnown,
      nextFollowUp: nextFu
        ? { id: nextFu.id, dueOn: nextFu.due_on, reason: nextFu.reason, status: nextFu.status, overdue: nextFu.status === "OPEN" && nextFu.due_on < today }
        : null,
      nextFollowUpKnown: followUps.ok && (!followUps.truncated || fus.length > 0),
      nextAppointment: nextAppt
        ? {
          id: nextAppt.id, at: nextAppt.scheduled_at, status: nextAppt.status,
          kind: String(nextAppt.appointment_type ?? "").replace(/_/g, " "),
          locationName: nextAppt.location_id ? (apptPlaces.get(nextAppt.id)?.locationName ?? null) : null,
        }
        : null,
      nextAppointmentKnown: nextApptKnown,
      currentStatus: { code, label: COHORT_STATUS_LABELS[code] },
      location: {
        ...(locationSource ? (places.get(locationSource.id) ?? EMPTY_PLACE) : EMPTY_PLACE),
        source: locationSource ? "encounter" : null,
      },
      recordStatus: p.status,
    };
  });

  return {
    rows: cohort, page, pageSize, hasMore, total: totalOut,
    scope, sort: effSort, sortOptions, sortNote, today, unavailable: false, reason: null, error: null, enrichment,
  };
}

/**
 * WHERE, resolved for a set of encounters.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * A PLACE, NEVER A CARE SETTING.
 *
 * The comp draws "Outpatient / C-Care IHK" and "Ward / AKUH". The right-hand half is real: the encounter
 * carries a location, and the activity it was opened inside (migration 232) carries a facility. The
 * left-hand half is not. Practice stores no care setting anywhere. practice_location.type is
 * (hospital, clinic, outreach, teleconsultation, independent) -- the KIND OF PLACE -- and rendering
 * "clinic" as "Outpatient" would be a mapping this product invented and then displayed as a clinical
 * fact. A care_setting column exists in the hospital platform's taxonomy, behind a different tenant
 * boundary, and is not read from here.
 *
 * What IS carried, because it is stored and named: the activity type the encounter was opened inside --
 * 'outpatient_clinic', 'ward_round', 'theatre'. That is the PRACTITIONER'S session, reported as such,
 * and every payload says careSettingStored: false beside it so nobody promotes it to one.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
export type Place = {
  locationId: string | null;
  locationName: string | null;
  /** practice_location.type: the kind of place. NOT a care setting. */
  locationType: string | null;
  facilityId: string | null;
  facilityName: string | null;
  /** practice_activity.activity_type, when the encounter was opened inside one. */
  activityType: string | null;
  activityTitle: string | null;
  encounterMode: string | null;
  careSettingStored: false;
};

const EMPTY_PLACE: Place = {
  locationId: null, locationName: null, locationType: null, facilityId: null, facilityName: null,
  activityType: null, activityTitle: null, encounterMode: null, careSettingStored: false,
};

async function placeMap(admin: any, ws: string, encounterRows: any[]): Promise<Map<string, Place>> {
  const locationIds = [...new Set(encounterRows.map(r => r.location_id).filter(Boolean))] as string[];
  const activityIds = [...new Set(encounterRows.map(r => r.activity_id).filter(Boolean))] as string[];

  const [locations, activities] = await Promise.all([
    locationIds.length
      ? admin.from("practice_location").select("id, name, type").eq("workspace_id", ws).in("id", locationIds)
      : Promise.resolve({ data: [], error: null }),
    activityIds.length
      ? admin.from("practice_activity").select("id, facility_id, activity_type, title").eq("workspace_id", ws).in("id", activityIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  // A NAME IS DECORATION; THE ENCOUNTER IS THE FACT. If either lookup fails the place still comes back
  // with the ids that are on the encounter itself, rather than the whole row vanishing.
  const locById = new Map(((locations.error ? [] : locations.data ?? []) as any[]).map(l => [l.id, l]));
  const actById = new Map(((activities.error ? [] : activities.data ?? []) as any[]).map(a => [a.id, a]));

  const facilityIds = [...new Set([...actById.values()].map(a => a.facility_id).filter(Boolean))] as string[];
  const { data: facilities, error: facError } = facilityIds.length
    ? await admin.from("practice_facility").select("id, name").eq("workspace_id", ws).in("id", facilityIds)
    : { data: [], error: null };
  const facById = new Map(((facError ? [] : facilities ?? []) as any[]).map(f => [f.id, f.name]));

  const out = new Map<string, Place>();
  for (const e of encounterRows) {
    const loc = e.location_id ? locById.get(e.location_id) : null;
    const act = e.activity_id ? actById.get(e.activity_id) : null;
    out.set(e.id, {
      locationId: e.location_id ?? null,
      locationName: loc?.name ?? null,
      locationType: loc?.type ?? null,
      facilityId: act?.facility_id ?? null,
      facilityName: act?.facility_id ? (facById.get(act.facility_id) ?? null) : null,
      activityType: act?.activity_type ?? null,
      activityTitle: act?.title ?? null,
      encounterMode: e.encounter_mode ?? null,
      careSettingStored: false,
    });
  }
  return out;
}

// ── 4. PATIENT SUMMARY, and 5. THE CONTEXT BANNER ────────────────────────────────────────────────────

export type ContextBanner = {
  patientId: string;
  name: string;
  /** The CP Patient Number, YY-NNNNNN (CPR-PID-001). */
  patientNumber: string | null;
  practiceId: string | null;
  age: ReturnType<typeof ageFrom>;
  ageEstimateYears: number | null;
  ageBasis: "birth_date" | "estimate" | "unknown";
  sex: string;
  hospitalNumbers: IdentifierRow[];
  lastSeen: string | null;
  lastSeenKnown: boolean;
  activeFollowUp: { id: string; dueOn: string; reason: string; status: string; overdue: boolean } | null;
  activeFollowUpKnown: boolean;
  /** Counts only, each the length of a list in the summary beside it. Null where the read failed. */
  outstanding: { key: string; label: string; count: number | null; reason: Unavailable; error: string | null }[];
  recentDiagnoses: { id: string; label: string; certainty: string; recordedAt: string }[];
  recentDiagnosesKnown: boolean;
  /**
   * WHERE this practice last had them. The spec's banner asks for "current care setting"; Practice
   * stores no care setting, so this is the place, and careSettingStored says so rather than the field
   * quietly implying otherwise.
   */
  place: Place & { label: string; basis: string; known: boolean };
  recordStatus: string;
  mergedIntoPatientId: string | null;
};

export type PatientSummary = {
  patient: {
    id: string; displayName: string; givenName: string | null; middleName: string | null; familyName: string | null;
    sex: string; birthDate: string | null; ageEstimateYears: number | null; status: string;
    mergedIntoPatientId: string | null; createdAt: string;
    preferredContactMethod: string | null; preferredLanguage: string | null; tags: string[] | null;
  };
  today: string;
  age: ReturnType<typeof ageFrom>;
  identifiers: IdentifierSet;
  identifiersProbe: { ok: boolean; error: string | null; truncated: boolean };
  contacts: Probe;
  /** Guardians, parents and next of kin: the named people, live-only, with the derived expectation. */
  relationships: Probe;
  relationshipExpectation: ReturnType<typeof relationshipExpectation> | null;
  recentEncounters: Probe;
  activeFollowUps: Probe;
  /** What ARRIVED and has not been reviewed. Not what was requested -- see pendingResultsBoundary. */
  pendingResults: Probe;
  pendingResultsBoundary: string;
  /** treatment_type = 'investigation', still planned or in progress: an intention, recorded in a note. */
  recordedInvestigations: Probe;
  /**
   * treatment_type = 'medication'. EVERY medication decided here, newest first -- not filtered to an
   * "active" subset, because `duration` is free text and no course has a computable end.
   */
  medicationsDecided: Probe;
  /** Stated as a FIELD, not only in a comment, so a consumer cannot render this under the wrong heading. */
  isCurrentMedicationList: false;
  medicationNotCurrentReason: string;
  medicationBoundary: string;
  diagnoses: Probe;
  problems: Probe;
  procedures: Probe;
  documents: Probe;
  banner: ContextBanner;
  refuses: typeof REFUSES;
};

/**
 * Everything CPR-V5-006's "selected patient without leaving the workspace" needs, in one call.
 *
 * EVERY BLOCK CARRIES ITS OWN AVAILABILITY. A summary where the medication read failed must not render
 * as a patient on no medication, and the only way to guarantee that is for each block to say so itself
 * rather than for the page to infer it from an empty array.
 */
export async function patientSummary(
  admin: any, ctx: WorkspaceContext, patientId: string, opts: { correlationId?: string } = {},
): Promise<EngineResult<PatientSummary>> {
  const ws = ctx.workspaceId;
  // RULE 5. Names, identifiers and clinical detail all live here, so this is patient.view or nothing.
  if (!hasCapability(ctx, "patient.view"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "patient.view is required" };

  // DOCTRINE 8: the workspace filter is on the query, and a patient in another practice returns the
  // same 404 an absent one does. A 403 here would confirm the record exists.
  const { data: patient, error: patientError } = await admin.from("practice_patient")
    .select("id, display_name, given_name, middle_name, family_name, sex, birth_date, age_estimate_years, status, merged_into_patient_id, patient_number, created_at, preferred_contact_method, preferred_language, tags")
    .eq("id", patientId).eq("workspace_id", ws).maybeSingle();
  if (patientError) return { ok: false, status: 502, code: "READ_FAILED", message: String(patientError.message ?? patientError) };
  if (!patient) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const { today } = await workspaceClock(admin, ws);
  const can = (c: string) => hasCapability(ctx, c);
  const L = 25;

  const [
    identifiersLookup, contacts, relationships, recentEncounters, activeFollowUps,
    pendingResults, investigations, medications, diagnoses, problems, procedures, documents,
  ] = await Promise.all([
    lookup(200, () => admin.from("practice_patient_identifier")
      .select("id, patient_id, identifier_type, value, issuer, facility_id, valid_to")
      .eq("workspace_id", ws).eq("patient_id", patientId).order("created_at").limit(201)),
    probe(true, L, () => admin.from("practice_patient_contact")
      .select("id, contact_type, value, preferred, verified")
      .eq("workspace_id", ws).eq("patient_id", patientId).order("created_at").limit(L + 1)),
    probe(true, L, () => admin.from("practice_patient_relationship")
      .select("id, relationship_type, full_name, phone, email, is_legal_guardian, may_receive_information, is_primary, effective_from, effective_to")
      .eq("workspace_id", ws).eq("patient_id", patientId)
      .order("is_primary", { ascending: false }).order("created_at").limit(L + 1)),
    probe(can("encounter.list"), L, () => admin.from("practice_encounter")
      .select("id, status, entry_pathway, encounter_mode, reason_for_visit, started_at, completed_at, signed_at, location_id, activity_id")
      .eq("workspace_id", ws).eq("patient_id", patientId)
      .order("started_at", { ascending: false }).limit(L + 1)),
    probe(can("followup.view"), L, () => admin.from("practice_follow_up")
      .select("id, reason, kind, due_on, priority, status, appointment_id")
      .eq("workspace_id", ws).eq("patient_id", patientId).in("status", ["OPEN", "SCHEDULED"])
      .order("due_on").limit(L + 1)),
    probe(can("inbox.record"), L, () => admin.from("practice_incoming_document")
      .select("id, doc_type, source, title, summary, priority, received_on, status, where_held")
      .eq("workspace_id", ws).eq("patient_id", patientId).eq("status", "RECEIVED")
      .order("received_on", { ascending: false }).limit(L + 1)),
    probe(can("encounter.list"), L, () => admin.from("practice_treatment")
      .select("id, encounter_id, treatment_type, label, notes, status, created_at")
      .eq("workspace_id", ws).eq("patient_id", patientId).eq("treatment_type", "investigation")
      .in("status", ["planned", "in_progress"]).order("created_at", { ascending: false }).limit(L + 1)),
    // NO STATUS FILTER, DELIBERATELY. Narrowing to planned/in_progress would present a subset under a
    // heading the record cannot support: with a free-text `duration` there is no way to know a planned
    // course has finished, so "still running" is not a question this data answers. Everything decided
    // here is returned with the status somebody actually set, newest first.
    probe(can("encounter.list"), L, () => admin.from("practice_treatment")
      .select("id, encounter_id, treatment_type, label, dose, dose_unit, route, frequency, duration, notes, status, created_at")
      .eq("workspace_id", ws).eq("patient_id", patientId).eq("treatment_type", "medication")
      .order("created_at", { ascending: false }).limit(L + 1)),
    probe(can("encounter.list"), L, () => admin.from("practice_diagnosis")
      .select("id, encounter_id, label, code, code_system, certainty, is_primary, created_at")
      .eq("workspace_id", ws).eq("patient_id", patientId)
      .order("created_at", { ascending: false }).limit(L + 1)),
    probe(can("encounter.list"), L, () => admin.from("practice_problem")
      .select("id, label, status, onset_date, resolved_date, created_at")
      .eq("workspace_id", ws).eq("patient_id", patientId)
      .order("created_at", { ascending: false }).limit(L + 1)),
    probe(can("encounter.list"), L, () => admin.from("practice_procedure")
      .select("id, encounter_id, label, site, laterality, performed_at")
      .eq("workspace_id", ws).eq("patient_id", patientId)
      .order("performed_at", { ascending: false }).limit(L + 1)),
    probe(can("document.view"), L, () => admin.from("practice_clinical_document")
      .select("id, encounter_id, doc_type, title, status, created_at")
      .eq("workspace_id", ws).eq("patient_id", patientId)
      .order("created_at", { ascending: false }).limit(L + 1)),
  ]);

  const facilityNames = await facilityNameMap(admin, ws, identifiersLookup.rows as any[]);
  const identifiers = groupIdentifiers(identifiersLookup.rows as any[], facilityNames);
  const age = ageFrom(patient.birth_date ?? null, today);

  const relationshipRows = (relationships.rows as any[]).map(r => ({
    ...r,
    live: !r.effective_to || r.effective_to > today,
    typeLabel: (RELATIONSHIP_TYPES.find(([k]) => k === r.relationship_type) ?? [])[1] ?? r.relationship_type,
  }));
  relationships.rows = relationshipRows;
  // The expectation is only computable when the relationships were actually read. Computing it from an
  // empty array after a failed read would tell the desk a child has no guardian recorded.
  const expectation = relationships.unavailable
    ? null
    : relationshipExpectation(age, relationshipRows.filter(r => r.live), patient.age_estimate_years ?? null);

  const encRows = recentEncounters.rows as any[];
  const latest = encRows[0] ?? null;
  const liveEnc = encRows.find(e => ["DRAFT", "ACTIVE", "PAUSED"].includes(e.status)) ?? null;
  const places = await placeMap(admin, ws, encRows);
  const nextFu = (activeFollowUps.rows as any[])[0] ?? null;

  const careSource = liveEnc ?? latest;
  const banner: ContextBanner = {
    patientId: patient.id,
    name: patient.display_name,
    patientNumber: patient.patient_number ?? null,
    practiceId: identifiers.practiceId,
    age,
    ageEstimateYears: patient.age_estimate_years ?? null,
    ageBasis: age ? "birth_date" : patient.age_estimate_years != null ? "estimate" : "unknown",
    sex: patient.sex,
    hospitalNumbers: identifiers.hospitalNumbers,
    lastSeen: latest?.started_at ?? null,
    lastSeenKnown: !recentEncounters.unavailable,
    activeFollowUp: nextFu
      ? { id: nextFu.id, dueOn: nextFu.due_on, reason: nextFu.reason, status: nextFu.status, overdue: nextFu.status === "OPEN" && nextFu.due_on < today }
      : null,
    activeFollowUpKnown: !activeFollowUps.unavailable,
    // COUNTS, EACH OF WHICH IS THE LENGTH OF A BLOCK IN THIS SAME PAYLOAD. Nothing here is a figure
    // with nothing behind it, and nothing here is a rate.
    outstanding: [
      { key: "followUps", label: "Active follow-ups", count: activeFollowUps.count, reason: activeFollowUps.reason, error: activeFollowUps.error },
      { key: "pendingResults", label: "Results arrived, not reviewed", count: pendingResults.count, reason: pendingResults.reason, error: pendingResults.error },
      { key: "recordedInvestigations", label: "Investigations recorded as planned", count: investigations.count, reason: investigations.reason, error: investigations.error },
      // NOT "current medications". See MEDICATION_BOUNDARY: nothing here can say a course is running.
      { key: "medicationsDecided", label: "Medications decided at this practice", count: medications.count, reason: medications.reason, error: medications.error },
      { key: "unsignedEncounters", label: "Encounters not yet signed", count: recentEncounters.unavailable ? null : encRows.filter(e => e.status === "COMPLETED").length, reason: recentEncounters.reason, error: recentEncounters.error },
    ],
    recentDiagnoses: (diagnoses.rows as any[]).slice(0, 5).map(d => ({
      id: d.id, label: d.label, certainty: d.certainty, recordedAt: d.created_at,
    })),
    recentDiagnosesKnown: !diagnoses.unavailable,
    place: careSource
      ? {
        ...(places.get(careSource.id) ?? EMPTY_PLACE),
        known: true,
        label: liveEnc
          ? `In an open encounter (${liveEnc.status})`
          : `Last seen ${String(latest.encounter_mode ?? "").replace(/_/g, " ")}`.trim(),
        basis: PLACE_BOUNDARY,
      }
      : {
        ...EMPTY_PLACE,
        known: !recentEncounters.unavailable,
        label: recentEncounters.unavailable ? "Not known" : "No encounter recorded here",
        basis: recentEncounters.unavailable
          ? "The encounter record could not be read, so where this patient was last seen is unknown -- which is not the same as never having been seen."
          : "This practice has never recorded an encounter for this patient.",
      },
    recordStatus: patient.status,
    mergedIntoPatientId: patient.merged_into_patient_id ?? null,
  };

  await logAccess(admin, {
    workspaceId: ws, actorId: ctx.userId, subjectKind: "patient", subjectId: patient.id,
    patientId: patient.id, action: "view", route: "patients-workspace/summary",
    correlationId: opts.correlationId,
  });

  return {
    ok: true,
    data: {
      patient: {
        id: patient.id, displayName: patient.display_name,
        givenName: patient.given_name ?? null, middleName: patient.middle_name ?? null,
        familyName: patient.family_name ?? null, sex: patient.sex,
        birthDate: patient.birth_date ?? null, ageEstimateYears: patient.age_estimate_years ?? null,
        status: patient.status, mergedIntoPatientId: patient.merged_into_patient_id ?? null,
        createdAt: patient.created_at,
        preferredContactMethod: patient.preferred_contact_method ?? null,
        preferredLanguage: patient.preferred_language ?? null,
        tags: patient.tags ?? null,
      },
      today, age, identifiers,
      identifiersProbe: { ok: identifiersLookup.ok, error: identifiersLookup.error, truncated: identifiersLookup.truncated },
      contacts, relationships, relationshipExpectation: expectation,
      recentEncounters, activeFollowUps,
      pendingResults, pendingResultsBoundary: PENDING_RESULTS_BOUNDARY,
      recordedInvestigations: investigations,
      medicationsDecided: medications,
      isCurrentMedicationList: false,
      medicationNotCurrentReason: MEDICATION_NOT_CURRENT_REASON,
      medicationBoundary: MEDICATION_BOUNDARY,
      diagnoses, problems, procedures, documents,
      banner, refuses: REFUSES,
    },
  };
}

/**
 * The banner on its own, for a view that already has the rest.
 *
 * It is a projection of the same load rather than a second set of queries, so the header and the panel
 * under it can never disagree about who the patient is.
 */
export async function patientContextBanner(
  admin: any, ctx: WorkspaceContext, patientId: string, opts: { correlationId?: string } = {},
): Promise<EngineResult<ContextBanner>> {
  const summary = await patientSummary(admin, ctx, patientId, opts);
  if (!summary.ok) return summary;
  return { ok: true, data: summary.data.banner };
}

// ── 6. FAMILY RELATIONSHIPS ──────────────────────────────────────────────────────────────────────────

export type FamilyMember = {
  relationshipId: string;
  fullName: string;
  relationshipType: string;
  relationshipLabel: string;
  phone: string | null;
  email: string | null;
  isLegalGuardian: boolean;
  mayReceiveInformation: boolean;
  isPrimary: boolean;
  /**
   * Whether this named person also has a patient record here. ALWAYS null: the schema has no link.
   * The field exists so a caller cannot mistake its absence for "we checked and there is none".
   */
  patientRecordId: null;
};

export type InferredSibling = {
  patientId: string;
  /** null without patient.view. */
  name: string | null;
  deIdentified: boolean;
  /** The guardian both children share, which is the entire basis for the inference. */
  sharedGuardian: { fullName: string; relationshipType: string; phone: string | null };
  basis: "shared_live_guardian_name_and_phone";
};

export type FamilyView = {
  patientId: string;
  today: string;
  /** mother / father, live only. CPR-V5-006's Parent-Child. */
  parents: FamilyMember[];
  /** guardian / grandparent / carer / social worker holding legal authority. Guardian-Child. */
  guardians: FamilyMember[];
  /** Recorded 'sibling' relationships -- named people, not patient records. */
  namedSiblings: FamilyMember[];
  /** Siblings INFERRED from a shared live guardian. Never asserted; the basis travels with each row. */
  inferredSiblings: InferredSibling[];
  otherRelationships: FamilyMember[];
  unavailable: boolean;
  reason: Unavailable;
  error: string | null;
  inference: {
    ok: boolean;
    error: string | null;
    truncated: boolean;
    note: string;
  };
  refuses: typeof REFUSES;
};

// ⚠ 'parent' COUNTS AS A PARENT HERE (migration 364). Somebody recorded as "Parent" who was not
// counted in the family report would be a person the record holds and the report denies.
const PARENT_TYPES = new Set(["parent", "mother", "father"]);
const GUARDIAN_TYPES = new Set(["guardian", "grandparent", "carer", "social_worker"]);

/**
 * CPR-V5-006's family relationships: Parent-Child, Guardian-Child, Siblings.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IS RECORDED, AND WHAT IS INFERRED, ARE SEPARATE FIELDS.
 *
 * practice_patient_relationship (migration 221) records a NAMED PERSON against one patient: a full
 * name, a phone, a type, two authority flags. It has no related_patient_id, so a mother's own patient
 * record and her child's are not joined by anything in this database.
 *
 * So parents and guardians are REPORTED -- they are recorded facts. Siblings are INFERRED, from two
 * children sharing a live guardian with the same normalised name and phone, and every inferred row
 * carries its basis. The alternative was to invent a link column and populate it by matching names,
 * which would turn a good guess into a stored fact that later reads as if somebody asserted it.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
export async function familyRelationships(
  admin: any, ctx: WorkspaceContext, patientId: string,
): Promise<EngineResult<FamilyView>> {
  const ws = ctx.workspaceId;
  if (!hasCapability(ctx, "patient.view"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "patient.view is required" };

  const { data: patient, error: pErr } = await admin.from("practice_patient")
    .select("id").eq("id", patientId).eq("workspace_id", ws).maybeSingle();
  if (pErr) return { ok: false, status: 502, code: "READ_FAILED", message: String(pErr.message ?? pErr) };
  if (!patient) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const { today } = await workspaceClock(admin, ws);
  const mine = await lookup(200, () => admin.from("practice_patient_relationship")
    .select("id, relationship_type, full_name, phone, email, is_legal_guardian, may_receive_information, is_primary, effective_to")
    .eq("workspace_id", ws).eq("patient_id", patientId)
    .order("is_primary", { ascending: false }).order("created_at").limit(201));

  const shell = (): FamilyView => ({
    patientId, today, parents: [], guardians: [], namedSiblings: [], inferredSiblings: [],
    otherRelationships: [], unavailable: true, reason: "read_failed", error: mine.error,
    inference: { ok: false, error: mine.error, truncated: false, note: INFERENCE_NOTE },
    refuses: REFUSES,
  });
  if (!mine.ok) return { ok: true, data: shell() };

  const map = (r: any): FamilyMember => ({
    relationshipId: r.id, fullName: r.full_name, relationshipType: r.relationship_type,
    relationshipLabel: (RELATIONSHIP_TYPES.find(([k]) => k === r.relationship_type) ?? [])[1] ?? r.relationship_type,
    phone: r.phone ?? null, email: r.email ?? null,
    isLegalGuardian: r.is_legal_guardian === true,
    mayReceiveInformation: r.may_receive_information === true,
    isPrimary: r.is_primary === true,
    patientRecordId: null,
  });

  // Live only, on the exclusive reading relationships.ts established: effective_to is the day authority
  // STOPPED, not the last day it applied.
  const live = (mine.rows as any[]).filter(r => !r.effective_to || r.effective_to > today);
  const parents = live.filter(r => PARENT_TYPES.has(r.relationship_type)).map(map);
  const guardians = live.filter(r => GUARDIAN_TYPES.has(r.relationship_type) || (r.is_legal_guardian && !PARENT_TYPES.has(r.relationship_type))).map(map);
  const namedSiblings = live.filter(r => r.relationship_type === "sibling").map(map);
  const claimed = new Set([...parents, ...guardians, ...namedSiblings].map(m => m.relationshipId));
  const otherRelationships = live.filter(r => !claimed.has(r.id)).map(map);

  // The inference: anybody with the same normalised name AND phone, live, against a different patient.
  // BOTH, not either. A shared surname alone would make every Nakato in the district a sibling.
  const keys = [...parents, ...guardians]
    .filter(m => m.phone && m.phone.trim().length > 0)
    .map(m => ({ name: norm(m.fullName), phone: digits(m.phone!), fullName: m.fullName, type: m.relationshipType }));

  let inferredSiblings: InferredSibling[] = [];
  let inference = { ok: true, error: null as string | null, truncated: false, note: INFERENCE_NOTE };

  if (keys.length > 0) {
    const others = await lookup(ENRICHMENT_ROW_CAP, () => admin.from("practice_patient_relationship")
      .select("patient_id, full_name, phone, relationship_type, effective_to")
      .eq("workspace_id", ws).neq("patient_id", patientId).not("phone", "is", null)
      .limit(ENRICHMENT_ROW_CAP + 1));
    inference = { ok: others.ok, error: others.error, truncated: others.truncated, note: INFERENCE_NOTE };

    if (others.ok) {
      const matched = new Map<string, InferredSibling>();
      for (const r of others.rows as any[]) {
        if (r.effective_to && r.effective_to <= today) continue;
        const k = keys.find(key => key.name === norm(r.full_name ?? "") && key.phone === digits(r.phone ?? ""));
        if (!k) continue;
        if (matched.has(r.patient_id)) continue;
        matched.set(r.patient_id, {
          patientId: r.patient_id, name: null, deIdentified: false,
          sharedGuardian: { fullName: k.fullName, relationshipType: k.type, phone: r.phone ?? null },
          basis: "shared_live_guardian_name_and_phone",
        });
      }
      const siblingIds = [...matched.keys()];
      if (siblingIds.length > 0) {
        const names = await lookup(siblingIds.length, () => admin.from("practice_patient")
          .select("id, display_name").eq("workspace_id", ws).in("id", siblingIds)
          .neq("status", "merged").limit(siblingIds.length + 1));
        const nameOf = new Map(((names.rows ?? []) as any[]).map(p => [p.id, p.display_name]));
        // A patient row that is not there (merged, or another practice's) is DROPPED, not returned
        // nameless -- an inferred sibling nobody can open is a claim with nothing behind it.
        inferredSiblings = siblingIds
          .filter(id => nameOf.has(id))
          .map(id => ({ ...matched.get(id)!, name: nameOf.get(id) ?? null }));
        if (!names.ok) inference = { ...inference, ok: false, error: names.error };
      }
    }
  }

  return {
    ok: true,
    data: {
      patientId, today, parents, guardians, namedSiblings, inferredSiblings, otherRelationships,
      unavailable: false, reason: null, error: null, inference, refuses: REFUSES,
    },
  };
}

const INFERENCE_NOTE =
  "Siblings are inferred from two patients sharing a live guardian with the same name and phone number. Nothing in this database links one patient record to another, so this is a match, not a recorded fact.";

// ── The workspace, assembled ─────────────────────────────────────────────────────────────────────────

export type PatientsWorkspace = {
  today: string;
  timezone: string;
  worklists: WorklistsResult;
  cohort: CohortResult;
  capabilities: { mayList: boolean; mayView: boolean; mayCreate: boolean; maySearch: boolean };
  refuses: typeof REFUSES;
};

/** The whole landing surface in one call: the worklists and the first page of the cohort. */
export async function patientsWorkspace(
  admin: any, ctx: WorkspaceContext,
  opts: {
    page?: number; pageSize?: number; scope?: "practice" | "mine"; sort?: CohortSort;
    /** The register's period, on registration date. See myPatients -- the worklists are NOT narrowed. */
    registeredFrom?: string; registeredTo?: string;
  } = {},
): Promise<PatientsWorkspace> {
  const [lists, cohort] = await Promise.all([
    worklists(admin, ctx),
    myPatients(admin, ctx, opts),
  ]);
  return {
    today: lists.today, timezone: lists.timezone,
    worklists: lists, cohort,
    capabilities: {
      mayList: hasCapability(ctx, "patient.list"),
      mayView: hasCapability(ctx, "patient.view"),
      mayCreate: hasCapability(ctx, "patient.create"),
      maySearch: hasCapability(ctx, "patient.list") && hasCapability(ctx, "patient.view"),
    },
    refuses: REFUSES,
  };
}
