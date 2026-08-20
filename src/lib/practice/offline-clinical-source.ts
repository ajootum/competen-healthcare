import type { WorkspaceContext } from "@/lib/practice/access";
import { practiceToday, zonedDayRange, practiceDayOf } from "@/lib/practice/practice-time";
import { isMissingTable } from "@/lib/practice/investigations";
import {
  capOfflineClinical, projectOfflineAllergy, projectOfflineClinicalPack, projectOfflineMedication,
  projectOfflineProblem,
  OFFLINE_CLINICAL_HORIZON_DAYS, OFFLINE_CLINICAL_MAX_ALLERGIES, OFFLINE_CLINICAL_MAX_MEDICATIONS,
  OFFLINE_CLINICAL_MAX_PATIENTS, OFFLINE_CLINICAL_MAX_PROBLEMS, OFFLINE_MEDICATION_STATUSES,
  OFFLINE_LAST_VISIT_EXCLUDED_STATUSES,
  type AllergySource, type MedicationSource, type OfflineClinicalPack, type OfflineClinicalRecord,
  type OfflineLastVisit, type ProblemSource,
} from "@/lib/practice/offline-clinical";

// CP-OFFLINE-SURVEY-001 s9 — the SERVER half of the clinical carry.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THE CAPABILITY IS `practice.calendar.view`, AND NO NEW CODE IS MINTED. s8: "For phase one:
// introduce no new capability code." That is already the capability the patient worklists are gated on
// (patient-workspace-constants.ts WORKLIST_META) and the one the day cohort uses. A practitioner who may
// see who is booked and open their record online is the same practitioner reading it offline.
//
// ⚠ SIX READS, DELIBERATELY NOT A JOIN, AND EACH FAILS ON ITS OWN.
//
// A single nested select would be tidier and would make one failure destroy everything. The whole point
// of this payload is that a practitioner in a place with no connection gets what could be read and is
// TOLD what could not -- so a medication table that is unreadable must not cost them the allergy list.
// Each read sets its own `...Unavailable` flag on every record, and every one of those flags reaches a
// sentence on the screen.
//
// ⚠ AND A MISSING TABLE IS NOT AN EMPTY ONE. practice_medication arrived in migration 258 and the
// longitudinal columns in 238. A practice whose database predates either gets "could not be read", never
// "nothing recorded" -- the difference between the two is the difference between asking the patient and
// not asking them.
//
// ⚠ THE POSTGREST 1000-ROW DEFAULT IS A REAL CEILING HERE AND IT IS SET EXPLICITLY BELOW. 120 patients
// with a dozen medicines each is 1,440 rows, and PostgREST would return the first thousand SILENTLY --
// the remaining patients would arrive with empty medication lists that are indistinguishable from
// patients who take nothing. That is precisely the failure this file exists to prevent, reached through
// a default nobody set.

/* eslint-disable @typescript-eslint/no-explicit-any -- the Supabase admin client is untyped; every
   engine in src/lib/practice does the same. */

/** ⚠ Explicit, and above what the caps can produce, so truncation is never silent. See the header. */
const ROW_CEILING = 5000;

const PATIENT_COLUMNS = "id, allergy_status, allergy_reviewed_at, blood_group";
const ALLERGY_COLUMNS = "id, patient_id, substance, reaction, severity, certainty";
const MEDICATION_COLUMNS =
  "id, patient_id, generic_name, brand_name, dose_text, route, frequency, indication, started_on, status";
const PROBLEM_COLUMNS = "id, patient_id, label, status, onset_date";

/** migration 194's five note segments. Only these two are carried -- see OfflineLastVisit. */
const CARRIED_NOTE_TYPES = ["assessment", "plan"] as const;

/** migration 194's encounter_mode, as a care setting rather than a code on a screen. */
const MODE_LABELS: Record<string, string> = {
  in_person: "In person",
  teleconsultation: "Teleconsultation",
  outreach: "Outreach",
  home_visit: "Home visit",
  hospital: "Hospital",
};

export type OfflineClinicalResult =
  | { ok: true; pack: OfflineClinicalPack }
  /** Nothing is cached and nothing is claimed. */
  | { ok: false; reason: string };

/** YYYY-MM-DD, `days` after `date`. Pure string arithmetic on a calendar date, no timezone involved. */
export function addCalendarDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The clinical carry for every patient booked between today and the horizon.
 *
 * ⚠ IT IS BOUNDED BY APPOINTMENTS AND THERE IS NO PATH THAT WIDENS IT TO A REGISTER. The patient ids
 * come from `practice_appointment` and from nowhere else; every subsequent read is `.in("patient_id",
 * ids)`. A practice with fifty thousand patients puts on the device only the ones somebody is due to see.
 */
export async function offlineClinicalPayload(
  admin: any, ctx: WorkspaceContext,
  opts: { timezone: string; at?: Date; horizonDays?: number },
): Promise<OfflineClinicalResult> {
  if (!ctx.capabilities.includes("practice.calendar.view"))
    return { ok: false, reason: "This account cannot see the appointment list, so no clinical records are stored on this device." };

  const at = opts.at ?? new Date();
  const horizonDays = opts.horizonDays ?? OFFLINE_CLINICAL_HORIZON_DAYS;
  const today = practiceToday(opts.timezone, at);
  const horizonDate = addCalendarDays(today, horizonDays);

  // The window runs from the start of today to the END of the horizon day, both on the PRACTICE's clock.
  const { startIso } = zonedDayRange(today, opts.timezone);
  const { endIso } = zonedDayRange(horizonDate, opts.timezone);

  const { data: appts, error: apptErr } = await admin.from("practice_appointment")
    .select("patient_id")
    .eq("workspace_id", ctx.workspaceId)
    .gte("scheduled_at", startIso).lt("scheduled_at", endIso)
    // ⚠ The day cache's rule, for the same reason: a cancelled booking is not part of the work, and a
    // clinical record held on a device has to earn its place far more than a name does.
    .neq("status", "CANCELLED")
    .order("scheduled_at", { ascending: true })
    .limit(ROW_CEILING);

  // ⚠ A FAILED READ IS NEVER AN EMPTY CLINIC. Refusing here means nothing new is written and whatever is
  // already on the device keeps its own expiry -- it is not deleted because one read failed.
  if (apptErr || appts == null)
    return { ok: false, reason: "The appointment list could not be read just now, so no clinical records were stored on this device." };

  // Order-preserving dedupe: the soonest appointment decides a patient's place, so the cap keeps the
  // people who are due first rather than an arbitrary set.
  const seen = new Set<string>();
  const patientIds: string[] = [];
  for (const row of (appts as any[])) {
    const id = row.patient_id;
    // A name-only booking has no patient record, so there is nothing clinical to carry for it.
    if (!id || seen.has(id)) continue;
    seen.add(id);
    patientIds.push(id);
  }

  const totalAvailable = patientIds.length;
  if (totalAvailable === 0)
    return {
      ok: true,
      pack: projectOfflineClinicalPack({
        workspaceId: ctx.workspaceId, timezone: opts.timezone, asOf: at.toISOString(),
        horizonDate, records: [], recordsUnavailable: false, dropped: null,
      }),
    };

  // ⚠ CAPPED BEFORE THE EXPENSIVE READS, not after. Reading medication for four hundred patients in
  // order to keep a hundred and twenty moves megabytes to discard them -- the guidance library's lesson.
  const considered = patientIds.slice(0, OFFLINE_CLINICAL_MAX_PATIENTS);

  const [people, allergies, medications, problems, encounters] = await Promise.all([
    admin.from("practice_patient").select(PATIENT_COLUMNS)
      .eq("workspace_id", ctx.workspaceId).in("id", considered).limit(ROW_CEILING),
    admin.from("practice_patient_allergy").select(ALLERGY_COLUMNS)
      .eq("workspace_id", ctx.workspaceId).in("patient_id", considered).limit(ROW_CEILING),
    admin.from("practice_medication").select(MEDICATION_COLUMNS)
      .eq("workspace_id", ctx.workspaceId).in("patient_id", considered)
      // ⚠ ACTIVE AND PAUSED, NOT ACTIVE ALONE -- see OFFLINE_MEDICATION_STATUSES for the reasoning. A
      // paused course is a drug the patient may resume and that can interact with what is prescribed
      // today; offline there is nobody to ring and ask. `completed` and `discontinued` are over, and
      // listing finished drugs is the noise that makes the important lines get skipped.
      .in("status", OFFLINE_MEDICATION_STATUSES as unknown as string[])
      .order("started_on", { ascending: false })
      .limit(ROW_CEILING),
    admin.from("practice_problem").select(PROBLEM_COLUMNS)
      .eq("workspace_id", ctx.workspaceId).in("patient_id", considered)
      .eq("status", "active")
      .limit(ROW_CEILING),
    admin.from("practice_encounter")
      .select("id, patient_id, started_at, completed_at, encounter_mode, status")
      .eq("workspace_id", ctx.workspaceId).in("patient_id", considered)
      // ⚠ See OFFLINE_LAST_VISIT_EXCLUDED_STATUSES: an entered-in-error encounter presented offline as
      // "the last visit" is a fabricated history that nobody on site can check.
      .not("status", "in", `(${OFFLINE_LAST_VISIT_EXCLUDED_STATUSES.join(",")})`)
      .order("started_at", { ascending: false })
      .limit(ROW_CEILING),
  ]);

  // ⚠ EACH FLAG IS SET FROM ITS OWN READ. `isMissingTable` is folded in here rather than treated as a
  // success: a practice whose database predates migration 258 has no medication table, and the honest
  // answer is "could not be read", not "takes nothing".
  const patientsBad = !!(people as any).error || (people as any).data == null;
  const allergiesBad = patientsBad || !!(allergies as any).error || (allergies as any).data == null
    || isMissingTable((allergies as any).error);
  const medsBad = !!(medications as any).error || (medications as any).data == null
    || isMissingTable((medications as any).error);
  const problemsBad = !!(problems as any).error || (problems as any).data == null;
  const visitsBad = !!(encounters as any).error || (encounters as any).data == null;

  const patientById = new Map<string, any>();
  for (const p of ((((people as any).data ?? []) as any[]))) patientById.set(p.id, p);

  const allergyByPatient = new Map<string, AllergySource[]>();
  for (const a of ((((allergies as any).data ?? []) as any[]))) {
    const list = allergyByPatient.get(a.patient_id);
    if (list) list.push(a as AllergySource); else allergyByPatient.set(a.patient_id, [a as AllergySource]);
  }

  const medsByPatient = new Map<string, MedicationSource[]>();
  for (const m of ((((medications as any).data ?? []) as any[]))) {
    const list = medsByPatient.get(m.patient_id);
    if (list) list.push(m as MedicationSource); else medsByPatient.set(m.patient_id, [m as MedicationSource]);
  }

  const problemsByPatient = new Map<string, ProblemSource[]>();
  for (const p of ((((problems as any).data ?? []) as any[]))) {
    const list = problemsByPatient.get(p.patient_id);
    if (list) list.push(p as ProblemSource); else problemsByPatient.set(p.patient_id, [p as ProblemSource]);
  }

  // The most recent surviving encounter per patient. The query is ordered newest-first, so the FIRST one
  // seen for a patient is the last visit -- no comparison needed and no second sort.
  const lastEncounterByPatient = new Map<string, any>();
  for (const e of ((((encounters as any).data ?? []) as any[])))
    if (!lastEncounterByPatient.has(e.patient_id)) lastEncounterByPatient.set(e.patient_id, e);

  // ── The two follow-up reads, for the chosen encounters only ───────────────────────────────────────
  const encounterIds = [...lastEncounterByPatient.values()].map(e => e.id);
  let notesBad = false;
  let diagnosesBad = false;
  const notesByEncounter = new Map<string, { assessment: string | null; plan: string | null }>();
  const diagnosesByEncounter = new Map<string, string[]>();

  if (encounterIds.length > 0) {
    const [notes, diagnoses] = await Promise.all([
      admin.from("practice_encounter_note").select("encounter_id, note_type, body")
        .eq("workspace_id", ctx.workspaceId).in("encounter_id", encounterIds)
        .in("note_type", CARRIED_NOTE_TYPES as unknown as string[])
        .limit(ROW_CEILING),
      admin.from("practice_diagnosis").select("encounter_id, label")
        .eq("workspace_id", ctx.workspaceId).in("encounter_id", encounterIds)
        .limit(ROW_CEILING),
    ]);
    notesBad = !!(notes as any).error || (notes as any).data == null;
    diagnosesBad = !!(diagnoses as any).error || (diagnoses as any).data == null;

    for (const n of ((((notes as any).data ?? []) as any[]))) {
      const held = notesByEncounter.get(n.encounter_id) ?? { assessment: null, plan: null };
      // ⚠ An empty body is stored as NULL rather than "". migration 194 defaults `body` to the empty
      // string, so a segment that exists but was never written would otherwise render as a heading over
      // white space -- which reads as "there was nothing to say" rather than "nobody wrote this".
      const body = typeof n.body === "string" && n.body.trim().length > 0 ? n.body.trim() : null;
      if (n.note_type === "assessment") held.assessment = body;
      if (n.note_type === "plan") held.plan = body;
      notesByEncounter.set(n.encounter_id, held);
    }

    for (const d of ((((diagnoses as any).data ?? []) as any[]))) {
      const list = diagnosesByEncounter.get(d.encounter_id);
      if (list) list.push(d.label); else diagnosesByEncounter.set(d.encounter_id, [d.label]);
    }
  }

  // ── Build one record per patient ──────────────────────────────────────────────────────────────────
  const records: OfflineClinicalRecord[] = considered.map((patientId): OfflineClinicalRecord => {
    const person = patientById.get(patientId);
    const allergyRows = allergyByPatient.get(patientId) ?? [];
    const medRows = medsByPatient.get(patientId) ?? [];
    const problemRows = problemsByPatient.get(patientId) ?? [];
    const encounter = lastEncounterByPatient.get(patientId);

    let lastVisit: OfflineLastVisit | null = null;
    if (encounter) {
      const noteSet = notesByEncounter.get(encounter.id) ?? { assessment: null, plan: null };
      lastVisit = {
        encounterId: encounter.id,
        // completed_at when the visit finished, started_at otherwise. Date only -- a time of day adds
        // nothing to a decision and is one more identifying detail on a device.
        // opts.timezone is already resolved above for practiceToday. The date of a last visit is
        // read on a device with no network, so there is nothing to correct it against later.
        date: practiceDayOf(opts.timezone, encounter.completed_at ?? encounter.started_at) ?? "date not recorded",
        kindLabel: MODE_LABELS[encounter.encounter_mode] ?? "Consultation",
        assessment: noteSet.assessment,
        plan: noteSet.plan,
        diagnoses: diagnosesByEncounter.get(encounter.id) ?? [],
      };
    }

    return {
      patientId,
      allergyStatus: person?.allergy_status ?? null,
      allergyReviewedAt: person?.allergy_reviewed_at ?? null,
      // ⚠ NULL WHEN THE LIST COULD NOT BE READ, THE ACTUAL COUNT OTHERWISE -- INCLUDING ZERO. allergyLine
      // treats these as different answers and the whole three-state design rests on the distinction
      // surviving this line.
      allergyCount: allergiesBad ? null : allergyRows.length,
      allergiesUnavailable: allergiesBad,
      allergies: allergyRows.slice(0, OFFLINE_CLINICAL_MAX_ALLERGIES).map(projectOfflineAllergy),

      bloodGroup: person?.blood_group ?? null,

      medications: medRows.slice(0, OFFLINE_CLINICAL_MAX_MEDICATIONS).map(projectOfflineMedication),
      medicationsUnavailable: medsBad,
      medicationsDropped: Math.max(0, medRows.length - OFFLINE_CLINICAL_MAX_MEDICATIONS),

      problems: problemRows.slice(0, OFFLINE_CLINICAL_MAX_PROBLEMS).map(projectOfflineProblem),
      problemsUnavailable: problemsBad,
      problemsDropped: Math.max(0, problemRows.length - OFFLINE_CLINICAL_MAX_PROBLEMS),

      lastVisit,
      // ⚠ THE NOTES AND THE DIAGNOSES ARE PART OF THE LAST VISIT, so a failure in either makes the last
      // visit unavailable rather than making it look like a visit at which nothing was concluded.
      lastVisitUnavailable: visitsBad || notesBad || diagnosesBad,
    };
  });

  const capped = capOfflineClinical(records, { totalAvailable });

  return {
    ok: true,
    pack: projectOfflineClinicalPack({
      workspaceId: ctx.workspaceId,
      timezone: opts.timezone,
      asOf: at.toISOString(),
      horizonDate,
      records: capped.records,
      // ⚠ THE PACK AS A WHOLE IS UNAVAILABLE ONLY WHEN THE PATIENT READ ITSELF FAILED. Everything else is
      // reported per section, per record -- a device that has the allergies but not the medication must
      // say exactly that rather than refusing to show anything.
      recordsUnavailable: patientsBad,
      dropped: capped.dropped,
    }),
  };
}
