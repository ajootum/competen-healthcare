import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { workspaceClock, dueDateFrom, zonedDayRange } from "@/lib/practice/practice-time";
import { logAccess } from "@/lib/practice/privacy";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE TWO PATIENT LISTS -- WHO IS BOOKED, AND WHO WAS SEEN.
//
// The owner, 2026-08-12: "review all patients booked, see who is booked when and where; export the
// list; filter per location (booked in TMR for the next month or two). Same concept for patients
// already seen."
//
// ⚠ WHY THIS IS NOT THE PLANNER'S AGENDA. The Agenda answers "what does my diary hold" -- it is grouped
// by day and session, and a person booked four times appears four times, which is correct for a diary.
// These lists answer a different question: WHO. They are a register over a period, filtered by place,
// meant to be read as a list of people and carried out of the product. The two must not be merged: an
// agenda that quietly de-duplicated patients would misstate a day's workload.
//
// ⚠ AND IT IS NOT reports.ts EITHER. That engine counts, and CPR-330 forbids it from naming anybody
// (report.view without patient.view yields counts and no names). This one is names first, so it gates
// on patient.view and every read is logged as a patient access.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A row is an APPOINTMENT or an ENCOUNTER, never a de-duplicated person -- see the header. */
export type PatientListRow = {
  id: string;
  patientId: string | null;
  patientName: string;
  /** The CP Patient Number (CPR-PID-001). Null on a row whose patient record could not be read. */
  patientNumber: string | null;
  /** The instant, in UTC. Every screen formats it in the practice timezone. */
  at: string;
  /** What kind of appointment, or the encounter's pathway. Free of clinical content, deliberately. */
  kind: string;
  status: string;
  locationId: string | null;
  locationName: string | null;
};

export type PatientListResult = {
  view: "booked" | "seen";
  rows: PatientListRow[];
  /** How many DISTINCT people the rows cover. Stated separately because rows are visits, not people. */
  patientCount: number;
  fromDate: string;
  toDate: string;
  timezone: string;
  locationId: string | null;
  locationName: string | null;
  /** Every active location, so a screen can offer the filter without a second read. */
  locations: { id: string; name: string }[];
  /**
   * ⚠ TRUE WHEN THE LIST IS SHORT BECAUSE THE CAP BIT, not because the practice is quiet. A register
   * that silently stops at 500 is a register somebody plans a month around and gets wrong.
   */
  truncated: boolean;
  limit: number;
  /** ⚠ A FAILED READ IS NOT AN EMPTY LIST. `unavailable` says so and no caller may print "none". */
  unavailable: boolean;
  permitted: boolean;
  detail: string | null;
};

export const PATIENT_LIST_LIMIT = 500;

/** Statuses that mean an appointment is still expected to happen. Mirrors the Booked worklist tile. */
const LIVE_APPOINTMENT = ["REQUESTED", "CONFIRMED", "ARRIVED"];

const empty = (
  view: "booked" | "seen", fromDate: string, toDate: string, timezone: string,
  extra: Partial<PatientListResult> = {},
): PatientListResult => ({
  view, rows: [], patientCount: 0, fromDate, toDate, timezone,
  locationId: null, locationName: null, locations: [], truncated: false,
  limit: PATIENT_LIST_LIMIT, unavailable: false, permitted: true, detail: null, ...extra,
});

/**
 * The default window for each view, in the practice's own calendar.
 *
 * BOOKED LOOKS FORWARD, SEEN LOOKS BACK, and neither defaults to "everything": an unbounded default
 * makes the first paint slow and the cap likelier, and the owner's own example was "the next month or
 * two". Both are overridable.
 */
export function defaultWindow(view: "booked" | "seen", today: string): { from: string; to: string } {
  return view === "booked"
    ? { from: today, to: dueDateFrom(today, 60) }
    : { from: dueDateFrom(today, -30), to: today };
}

export async function patientList(admin: any, ctx: WorkspaceContext, opts: {
  view: "booked" | "seen";
  fromDate?: string; toDate?: string;
  locationId?: string | null;
  correlationId?: string;
}): Promise<PatientListResult> {
  const view = opts.view === "seen" ? "seen" : "booked";
  const { timezone, today } = await workspaceClock(admin, ctx.workspaceId);
  const def = defaultWindow(view, today);
  const isDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const fromDate = isDay(opts.fromDate) ? opts.fromDate : def.from;
  const toDate = isDay(opts.toDate) ? opts.toDate : def.to;

  // ⚠ NAMES, SO patient.view -- NOT report.view. See the header: this list exists to be read as people.
  if (!hasCapability(ctx, "patient.list") || !hasCapability(ctx, "patient.view"))
    return empty(view, fromDate, toDate, timezone, { permitted: false });

  // The window is a pair of CALENDAR DAYS in the practice's zone, turned into instants once.
  const startIso = zonedDayRange(fromDate, timezone).startIso;
  const endIso = zonedDayRange(toDate, timezone).endIso;

  const { data: locRows, error: locErr } = await admin.from("practice_location")
    .select("id, name").eq("workspace_id", ctx.workspaceId).eq("active", true).order("name");
  // A failed LOCATION read does not fail the list -- it costs the filter its labels, and the rows are
  // still true. Reported through `detail` rather than swallowed.
  const locations = ((locRows ?? []) as any[]).map(l => ({ id: l.id as string, name: l.name as string }));
  const locationId = opts.locationId && locations.some(l => l.id === opts.locationId) ? opts.locationId : null;
  const locationName = locations.find(l => l.id === locationId)?.name ?? null;

  let q = view === "booked"
    ? admin.from("practice_appointment")
      .select("id, patient_id, patient_name, scheduled_at, appointment_type, status, location_id")
      .eq("workspace_id", ctx.workspaceId).in("status", LIVE_APPOINTMENT)
      .gte("scheduled_at", startIso).lt("scheduled_at", endIso)
      .order("scheduled_at")
    : admin.from("practice_encounter")
      .select("id, patient_id, started_at, status, entry_pathway, location_id")
      .eq("workspace_id", ctx.workspaceId)
      .gte("started_at", startIso).lt("started_at", endIso)
      .order("started_at", { ascending: false });
  if (locationId) q = q.eq("location_id", locationId);

  const { data, error } = await q.limit(PATIENT_LIST_LIMIT + 1);
  if (error)
    return empty(view, fromDate, toDate, timezone, {
      locations, locationId, locationName, unavailable: true,
      detail: `this list could not be read: ${error.message}`,
    });

  const all = (data ?? []) as any[];
  const truncated = all.length > PATIENT_LIST_LIMIT;
  const kept = all.slice(0, PATIENT_LIST_LIMIT);

  // Names and numbers come from the register, never from whatever the diary spelled at booking time --
  // the same rule bookAppointment follows when it writes patient_name.
  const ids = [...new Set(kept.map(r => r.patient_id).filter(Boolean))] as string[];
  const { data: patients } = ids.length
    ? await admin.from("practice_patient").select("id, display_name, patient_number")
      .eq("workspace_id", ctx.workspaceId).in("id", ids)
    : { data: [] };
  const byId = new Map(((patients ?? []) as any[]).map(p => [p.id, p]));
  const locById = new Map(locations.map(l => [l.id, l.name]));

  const rows: PatientListRow[] = kept.map(r => {
    const p = r.patient_id ? byId.get(r.patient_id) : null;
    return {
      id: r.id,
      patientId: r.patient_id ?? null,
      // A diary row booked by name before the person was registered keeps that name, and says so by
      // carrying no number -- it is not a record, and pretending otherwise would hide it from a merge.
      patientName: p?.display_name ?? r.patient_name ?? "Not on the register",
      patientNumber: p?.patient_number ?? null,
      at: view === "booked" ? r.scheduled_at : r.started_at,
      kind: String(view === "booked" ? r.appointment_type : (r.entry_pathway ?? "encounter")).replace(/_/g, " "),
      status: String(r.status ?? ""),
      locationId: r.location_id ?? null,
      locationName: r.location_id ? (locById.get(r.location_id) ?? null) : null,
    };
  });

  await logAccess(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, subjectKind: "search", action: "search",
    route: `patients/lists/${view}`,
    detail: `${fromDate}..${toDate}${locationName ? ` at ${locationName}` : ""}`,
    correlationId: opts.correlationId,
  });

  return {
    view, rows,
    patientCount: new Set(rows.map(r => r.patientId ?? r.id)).size,
    fromDate, toDate, timezone, locationId, locationName, locations,
    truncated, limit: PATIENT_LIST_LIMIT, unavailable: false, permitted: true,
    detail: locErr ? `the location list could not be read: ${locErr.message}` : null,
  };
}

// ── EXPORT ──────────────────────────────────────────────────────────────────────────────────────────

const csvCell = (v: string | null) => {
  const s = (v ?? "").replace(/"/g, '""');
  // ⚠ FORMULA INJECTION. A cell opening with = + - @ is executed by Excel when the file is opened, and
  // a patient name is caller-controlled text. Prefixed with a quote, which every spreadsheet reads as
  // "this is text" and no formula engine executes.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe}"` : safe;
};

/**
 * The list as CSV.
 *
 * ⚠ IT SAYS WHAT IT IS IN THE FILE. A list of named patients travels further than the screen it came
 * from, so the header rows carry the practice, the window, the filter and the plain sentence that this
 * is identifiable patient data -- the same doctrine CPR-330's activity export follows.
 */
export function patientListCsv(result: PatientListResult, practiceName: string): string {
  const fmt = (iso: string) => {
    try {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: result.timezone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(new Date(iso)).replace(",", "");
    } catch { return iso; }
  };
  const lines: string[] = [
    `${csvCell(practiceName)},${csvCell(result.view === "booked" ? "Booked patients" : "Patients seen")}`,
    `Period,${csvCell(`${result.fromDate} to ${result.toDate}`)},Timezone,${csvCell(result.timezone)}`,
    `Location,${csvCell(result.locationName ?? "All locations")}`,
    `Rows,${result.rows.length},Distinct patients,${result.patientCount}`,
    ...(result.truncated ? [`NOTE,${csvCell(`only the first ${result.limit} rows are included -- narrow the period or the location`)}`] : []),
    `NOTE,${csvCell("This file identifies patients. It is not anonymised.")}`,
    "",
    "Patient number,Patient,Date and time,Kind,Status,Location",
    ...result.rows.map(r => [
      csvCell(r.patientNumber), csvCell(r.patientName), csvCell(fmt(r.at)),
      csvCell(r.kind), csvCell(r.status), csvCell(r.locationName ?? "not named"),
    ].join(",")),
  ];
  return lines.join("\n");
}
