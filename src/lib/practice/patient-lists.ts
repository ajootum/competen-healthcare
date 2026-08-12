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
  /** Migration 290's per-clinic colour choice, so a list can be scanned by place like the planner. */
  locationSlot: string | null;
  /**
   * The register's recorded sex, drawn as a glyph beside the patient number in the reference design.
   * ⚠ NULL IS A REAL ANSWER and stays distinguishable from "unknown": the register permits neither being
   * recorded, and drawing a guessed glyph would put a fact in front of a clinician that nobody entered.
   */
  sex: string | null;
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
  /** s5's search text, echoed back so the field repopulates without re-reading the URL. */
  search: string | null;
  /** Every active location, so a screen can offer the filter without a second read. */
  locations: { id: string; name: string; colorSlot: string | null }[];
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
  view, rows: [], patientCount: 0, fromDate, toDate, timezone, search: null,
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
  /** s5: searches the ACTIVE RESULT SET by patient name and patient number. */
  search?: string | null;
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

  // color_slot is migration 290's per-clinic colour choice. Carried through so these lists can be
  // scanned by place the way the planner is -- the owner picked those colours and they must mean the
  // same thing on every screen, not just the calendar.
  const { data: locRows, error: locErr } = await admin.from("practice_location")
    .select("id, name, color_slot").eq("workspace_id", ctx.workspaceId).eq("active", true).order("name");
  // A failed LOCATION read does not fail the list -- it costs the filter its labels, and the rows are
  // still true. Reported through `detail` rather than swallowed.
  const locations = ((locRows ?? []) as any[]).map(l => ({
    id: l.id as string, name: l.name as string, colorSlot: (l.color_slot as string | null) ?? null,
  }));
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
    ? await admin.from("practice_patient").select("id, display_name, patient_number, sex")
      .eq("workspace_id", ctx.workspaceId).in("id", ids)
    : { data: [] };
  const byId = new Map(((patients ?? []) as any[]).map(p => [p.id, p]));
  const locById = new Map(locations.map(l => [l.id, l.name]));
  const slotById = new Map(locations.map(l => [l.id, l.colorSlot]));

  const rowsAll: PatientListRow[] = kept.map(r => {
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
      locationSlot: r.location_id ? (slotById.get(r.location_id) ?? null) : null,
      sex: (p?.sex as string | null) ?? null,
    };
  });

  // ⚠ s5's SEARCH NARROWS THE ACTIVE RESULT SET, and does so AFTER the read on purpose. Pushing it into
  // the query would make `truncated` a lie in the dangerous direction: 600 bookings filtered server-side
  // to 12 matches would report a complete list, when 100 rows past the cap were never examined. Here the
  // cap is computed against the whole window, so a truncated register still says it is truncated.
  const needle = (opts.search ?? "").trim().toLowerCase();
  const rows = needle
    ? rowsAll.filter(r =>
      r.patientName.toLowerCase().includes(needle)
      || (r.patientNumber ?? "").toLowerCase().includes(needle))
    : rowsAll;

  await logAccess(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, subjectKind: "search", action: "search",
    route: `patients/lists/${view}`,
    detail: `${fromDate}..${toDate}${locationName ? ` at ${locationName}` : ""}${needle ? ` matching "${needle}"` : ""}`,
    correlationId: opts.correlationId,
  });

  return {
    view, rows, search: needle || null,
    patientCount: new Set(rows.map(r => r.patientId ?? r.id)).size,
    fromDate, toDate, timezone, locationId, locationName, locations,
    truncated, limit: PATIENT_LIST_LIMIT, unavailable: false, permitted: true,
    detail: locErr ? `the location list could not be read: ${locErr.message}` : null,
  };
}

/**
 * BOTH TAB COUNTS AT ONCE, for the same filters (s3: "counts must respect the active date and location
 * filters"). The reference design puts a number on the tab you are NOT looking at, so one view has to be
 * able to state the other's size.
 *
 * ⚠ NULL MEANS THE COUNT COULD NOT BE READ, and every caller must render that as something other than a
 * nought. A tab reading "Seen 0" when the query failed tells a practitioner they saw nobody last month.
 *
 * ⚠ head + count, SO NO ROWS CROSS THE WIRE. These are counts of people this caller may already list, but
 * fetching 500 rows to call .length on them would also silently cap at the PostgREST limit and start
 * under-reporting past 1000 -- the trap recorded against the QIE work.
 */
export async function patientListCounts(admin: any, ctx: WorkspaceContext, opts: {
  fromDate: string; toDate: string; locationId?: string | null; timezone: string;
}): Promise<{ booked: number | null; seen: number | null }> {
  if (!hasCapability(ctx, "patient.list")) return { booked: null, seen: null };
  const startIso = zonedDayRange(opts.fromDate, opts.timezone).startIso;
  const endIso = zonedDayRange(opts.toDate, opts.timezone).endIso;

  const one = async (table: string, timeCol: string, statuses: string[] | null) => {
    let q = admin.from(table).select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).gte(timeCol, startIso).lt(timeCol, endIso);
    if (statuses) q = q.in("status", statuses);
    if (opts.locationId) q = q.eq("location_id", opts.locationId);
    const { count, error } = await q;
    return error ? null : (count ?? 0);
  };

  const [booked, seen] = await Promise.all([
    one("practice_appointment", "scheduled_at", LIVE_APPOINTMENT),
    one("practice_encounter", "started_at", null),
  ]);
  return { booked, seen };
}

// ── ATTENDANCE ──────────────────────────────────────────────────────────────────────────────────────
//
// ⚠⚠ THE ONE PERCENTAGE THIS WORKSPACE COMPUTES, AND WHY IT IS NOT THE ONE THE COMP DREW.
//
// The reference design shows "Seen rate 76% of booked" beside the two tab counts. That figure divides
// encounters by appointments, and it is not a rate of anything:
//
//   1. THE TWO TABS USE DIFFERENT WINDOWS BY DEFAULT -- Booked looks forward 60 days, Seen looks back
//      30. The comp's 76% divided last month's encounters by next month's bookings.
//   2. EVEN MATCHED, THE DENOMINATOR IS WRONG. CP-BOOKED-SEEN-001 s1 says a patient may be seen with no
//      booking at all -- walk-in, inpatient review, emergency. Encounters over appointments therefore
//      counts things that were never booked against bookings that have not happened, and a walk-in-heavy
//      week pushes it over 100 per cent.
//   3. THE SPEC ITSELF REFUSES IT. s3: "Do not treat the Booked count and Seen count as a conversion
//      funnel. Any optional seen-rate summary is informational only and belongs behind a configurable
//      feature flag."
//
// What IS measurable is attendance, and only over time that has already happened. So:
//
//   THE DENOMINATOR IS CLOSED   only appointments whose time has PASSED. A future booking cannot have
//                               been attended, and including it would make the figure a measure of how
//                               far ahead the window reaches.
//   THE NUMERATOR COMES FROM IT every attended appointment is one of those appointments, matched by
//                               practice_encounter.appointment_id. s10: "Do not mark an appointment as
//                               Seen merely because it is Arrived. Seen requires an encounter."
//   NOTHING IS FOLDED AWAY      elapsed = attended + did not attend + cancelled + NO OUTCOME RECORDED,
//                               and the fourth bucket is shown rather than being quietly counted as a
//                               failure to attend. See attendanceVerdict for what it costs the figure.
//   THE COUNTS TRAVEL WITH IT   a percentage hides its own scale -- 78 per cent reads identically at
//                               31-of-40 and 3-of-4 -- so every caller renders the counts beside it.

export type Attendance = {
  /** Appointments in the window whose time has passed. The only closed denominator available. */
  elapsed: number;
  attended: number;
  didNotAttend: number;
  cancelled: number;
  /** Elapsed, not cancelled, no encounter and not marked missed. Somebody has not closed these off. */
  noOutcomeRecorded: number;
  /**
   * ⚠ NULL WHENEVER THE FIGURE WOULD DESCRIBE THE RECORD-KEEPING RATHER THAN THE PATIENTS. Null when
   * nothing has elapsed, and null when more elapsed appointments have no outcome than have one -- see
   * attendanceVerdict.
   */
  attendedPercent: number | null;
  /** Attended plus did-not-attend: the appointments somebody actually closed off. */
  resolved: number;
  /** True when part of the window is still in the future, so the figure covers only the elapsed part. */
  partialWindow: boolean;
  /** ⚠ A FAILED READ IS NOT AN ATTENDANCE OF NOUGHT. */
  readable: boolean;
  detail: string | null;
};

/**
 * WHICH BUCKET ONE ELAPSED APPOINTMENT FALLS IN. Pure, so it can be tested without a database.
 *
 * ⚠ ATTENDANCE IS NOT DOCUMENTATION, and this used to insist it was. Requiring an encounter meant a
 * practice that closes its appointments properly but writes its notes elsewhere read as nought per cent
 * attended -- the figure describing the paperwork again, which is the very fault attendanceVerdict exists
 * to prevent. ARRIVED and COMPLETED are the desk stating that the patient turned up, and that is the
 * whole of what attendance asks.
 *
 * ⚠ s10 IS NOT VIOLATED BY THAT. Its rule -- "do not mark an appointment as Seen merely because it is
 * Arrived" -- governs the SEEN LIST, which remains encounters and only encounters. Somebody who attended
 * without a consultation being written up is attended here and absent from Seen. Both are true.
 */
export function attendanceBucket(
  status: string, hasEncounter: boolean,
): "cancelled" | "attended" | "didNotAttend" | "noOutcomeRecorded" {
  if (status === "CANCELLED") return "cancelled";
  if (hasEncounter || status === "ARRIVED" || status === "COMPLETED") return "attended";
  if (status === "NO_SHOW") return "didNotAttend";
  return "noOutcomeRecorded";   // REQUESTED or CONFIRMED, with the time gone by: nobody said.
}

/**
 * WHETHER THE COUNTS SUPPORT A PERCENTAGE AT ALL. Pure, so it can be tested without a database -- see
 * scripts/attendance-harness.ts.
 *
 * ⚠ AN UNRECORDED OUTCOME IS NOT A FAILURE TO ATTEND. A practice that has simply not closed its
 * appointments off would otherwise be reported as having near-nought attendance: the figure would be
 * describing the record-keeping while reading as a judgement on the patients. Live data on 2026-08-12 was
 * exactly this -- five elapsed appointments, one cancelled and four still at requested or confirmed,
 * yielding a true and thoroughly misleading "0 per cent attended".
 *
 * So the percentage is withheld unless at least as many appointments were closed off as were not. Below
 * that line the honest statement is that attendance is not yet known, and the counts say why.
 */
export function attendanceVerdict(c: {
  elapsed: number; attended: number; didNotAttend: number; noOutcomeRecorded: number;
}): { resolved: number; attendedPercent: number | null } {
  const resolved = c.attended + c.didNotAttend;
  const measurable = c.elapsed > 0 && resolved > 0 && c.noOutcomeRecorded <= resolved;
  return {
    resolved,
    attendedPercent: measurable ? Math.round((c.attended / c.elapsed) * 100) : null,
  };
}

export async function attendance(admin: any, ctx: WorkspaceContext, opts: {
  fromDate: string; toDate: string; locationId?: string | null; timezone: string;
}): Promise<Attendance> {
  const none: Attendance = {
    elapsed: 0, attended: 0, didNotAttend: 0, cancelled: 0, noOutcomeRecorded: 0,
    attendedPercent: null, resolved: 0, partialWindow: false, readable: true, detail: null,
  };
  if (!hasCapability(ctx, "practice.calendar.view")) return { ...none, readable: false, detail: "not permitted" };

  const startIso = zonedDayRange(opts.fromDate, opts.timezone).startIso;
  const windowEndIso = zonedDayRange(opts.toDate, opts.timezone).endIso;
  const nowIso = new Date().toISOString();
  // The window, cut off at NOW. Everything after it has not happened and cannot be attended.
  const endIso = windowEndIso < nowIso ? windowEndIso : nowIso;
  if (endIso <= startIso) return { ...none, partialWindow: true };

  let q = admin.from("practice_appointment")
    .select("id, status").eq("workspace_id", ctx.workspaceId)
    .gte("scheduled_at", startIso).lt("scheduled_at", endIso);
  if (opts.locationId) q = q.eq("location_id", opts.locationId);
  const { data, error } = await q.limit(5000);
  if (error) return { ...none, readable: false, detail: `attendance could not be read: ${error.message}` };

  const rows = (data ?? []) as { id: string; status: string }[];
  if (rows.length === 0) return { ...none, partialWindow: windowEndIso > nowIso };

  const ids = rows.map(r => r.id);
  const { data: encs, error: encErr } = await admin.from("practice_encounter")
    .select("appointment_id").eq("workspace_id", ctx.workspaceId).in("appointment_id", ids).limit(5000);
  // ⚠ WITHOUT THE ENCOUNTERS THERE IS NO ATTENDANCE FIGURE, only a count of appointments. Reporting one
  // anyway would read every elapsed appointment as unattended.
  if (encErr) return { ...none, readable: false, detail: `attendance could not be read: ${encErr.message}` };
  const attendedIds = new Set(((encs ?? []) as any[]).map(e => e.appointment_id).filter(Boolean));

  let attended = 0, didNotAttend = 0, cancelled = 0, noOutcomeRecorded = 0;
  for (const r of rows) {
    switch (attendanceBucket(r.status, attendedIds.has(r.id))) {
      case "cancelled": cancelled++; break;
      case "attended": attended++; break;
      case "didNotAttend": didNotAttend++; break;
      default: noOutcomeRecorded++;
    }
  }

  return {
    elapsed: rows.length, attended, didNotAttend, cancelled, noOutcomeRecorded,
    ...attendanceVerdict({ elapsed: rows.length, attended, didNotAttend, noOutcomeRecorded }),
    partialWindow: windowEndIso > nowIso,
    readable: true, detail: null,
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
