import type { WorkspaceContext } from "@/lib/practice/access";
import { zonedDayRange } from "@/lib/practice/practice-time";
import { APPOINTMENT_KINDS } from "@/lib/practice/calendar";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE TIMELINE -- the day as a shape rather than a list, with a lane per place.
//
// EVERY POSITION IS COMPUTED HERE, ON THE SERVER, AND NOT IN THE BROWSER.
//
// A timeline is arithmetic on a clock, and the clock that matters is the PRACTICE'S -- Africa/Kampala,
// not whatever the receptionist's laptop believes. A browser computing `new Date(iso).getHours()` reads
// the machine's timezone, so the same day would draw differently on a laptop that had travelled, and
// nobody would notice until an appointment was in the wrong place. So the server sends MINUTES FROM THE
// START OF THE PRACTICE'S DAY, and the browser only multiplies by pixels.
//
// dayStartIso is sent back with it, so a drag can be turned into an instant the same way in reverse:
// dayStart + minutes. Exact except across a daylight-saving transition inside the day, which is stated
// rather than hidden -- see `dstWarning`.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type TimelineBlock = {
  id: string;
  patientId: string | null;
  patientName: string;
  status: string;
  appointmentType: string;
  typeLabel: string;
  colour: string;
  /** Minutes from the start of the practice's day. The only positioning number the browser gets. */
  startMinute: number;
  durationMinutes: number;
  locationId: string | null;
  locationName: string | null;
  scheduledAt: string;
  recordVersion: number;
  /** False for terminal and arrived appointments -- the engine would refuse the move anyway. */
  movable: boolean;
  immovableReason: string | null;
};

export type TimelineLane = {
  id: string | null;
  name: string;
  type: string;
  facilityName: string | null;
};

export type Timeline = {
  day: string;
  timezone: string;
  dayStartIso: string;
  /** The drawn window, in minutes from midnight. Derived from what is actually in the day. */
  fromMinute: number;
  toMinute: number;
  /** Drags snap to this. Five minutes is finer than any clinic books and coarse enough to hit. */
  snapMinutes: number;
  lanes: TimelineLane[];
  blocks: TimelineBlock[];
  /** Availability behind the blocks, so a lane shows when the practitioner is actually there. */
  shading: { laneId: string | null; fromMinute: number; toMinute: number; kind: string }[];
  dstWarning: string | null;
};

const DEFAULT_FROM = 7 * 60;
const DEFAULT_TO = 19 * 60;

export async function timelineDay(
  admin: any, ctx: WorkspaceContext, day: string, timezone: string,
): Promise<Timeline> {
  const { startIso, endIso } = zonedDayRange(day, timezone);
  const dayStartMs = Date.parse(startIso);

  const [{ data: appointments }, { data: locations }, { data: slots }] = await Promise.all([
    admin.from("practice_appointment")
      .select("id, patient_id, patient_name, appointment_type, scheduled_at, duration_minutes, status, location_id, record_version")
      .eq("workspace_id", ctx.workspaceId).gte("scheduled_at", startIso).lt("scheduled_at", endIso)
      .order("scheduled_at"),
    admin.from("practice_location")
      .select("id, name, type, active, facility_id").eq("workspace_id", ctx.workspaceId),
    admin.from("practice_availability_slot")
      .select("id, starts_at, ends_at, slot_kind, location_id")
      .eq("workspace_id", ctx.workspaceId).gte("starts_at", startIso).lt("starts_at", endIso),
  ]);

  const locRows = (locations ?? []) as any[];
  const facilityIds = [...new Set(locRows.map(l => l.facility_id).filter(Boolean))];
  const { data: facilities } = facilityIds.length
    ? await admin.from("practice_facility").select("id, name").eq("workspace_id", ctx.workspaceId).in("id", facilityIds)
    : { data: [] };
  const facilityById = new Map(((facilities ?? []) as any[]).map(f => [f.id, f]));
  const locById = new Map(locRows.map(l => [l.id, l]));

  const appts = ((appointments ?? []) as any[])
    .filter(a => !["CANCELLED", "NO_SHOW"].includes(a.status));

  const minuteOf = (iso: string) => Math.round((Date.parse(iso) - dayStartMs) / 60000);

  const blocks: TimelineBlock[] = appts.map(a => {
    const loc = a.location_id ? locById.get(a.location_id) : null;
    // The engine refuses these moves; saying so on the block is kinder than letting the drag fail.
    const terminal = ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(a.status);
    const present = a.status === "ARRIVED";
    return {
      id: a.id, patientId: a.patient_id, patientName: a.patient_name, status: a.status,
      appointmentType: a.appointment_type,
      typeLabel: APPOINTMENT_KINDS[a.appointment_type]?.label ?? a.appointment_type,
      colour: APPOINTMENT_KINDS[a.appointment_type]?.colour ?? "var(--cp-slate-500)",
      startMinute: minuteOf(a.scheduled_at),
      durationMinutes: a.duration_minutes ?? 20,
      locationId: a.location_id ?? null,
      locationName: loc?.name ?? null,
      scheduledAt: a.scheduled_at,
      recordVersion: a.record_version ?? 1,
      movable: !terminal && !present,
      immovableReason: terminal ? `this appointment is ${String(a.status).toLowerCase()}`
        : present ? "this patient has already arrived" : null,
    };
  });

  // ── LANES ────────────────────────────────────────────────────────────────────────────────────────
  //
  // Only places THIS DAY uses, plus the open ones, so a practice with fifteen historical sites does not
  // draw fifteen empty columns. The unassigned lane appears only when something is in it -- an empty
  // "no location" column on a single-site practice is a question nobody asked.
  const usedIds = new Set(blocks.map(b => b.locationId).filter(Boolean) as string[]);
  const lanes: TimelineLane[] = locRows
    .filter(l => l.active || usedIds.has(l.id))
    .map(l => ({
      id: l.id, name: l.name, type: l.type,
      facilityName: l.facility_id ? facilityById.get(l.facility_id)?.name ?? null : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (blocks.some(b => !b.locationId))
    lanes.push({ id: null, name: "Not said", type: "unassigned", facilityName: null });
  if (lanes.length === 0)
    lanes.push({ id: null, name: "The day", type: "unassigned", facilityName: null });

  const shading = ((slots ?? []) as any[]).map(s => ({
    laneId: s.location_id ?? null,
    fromMinute: minuteOf(s.starts_at),
    toMinute: minuteOf(s.ends_at),
    kind: s.slot_kind ?? "clinic",
  }));

  // ── THE DRAWN WINDOW ─────────────────────────────────────────────────────────────────────────────
  //
  // Derived from the day, never assumed: a 06:00 ward round and a 21:00 call must both be on the
  // screen. Padded by half an hour so a block at the edge has somewhere to be dragged to.
  const edges = [
    ...blocks.map(b => b.startMinute), ...blocks.map(b => b.startMinute + b.durationMinutes),
    ...shading.map(s => s.fromMinute), ...shading.map(s => s.toMinute),
  ];
  const fromMinute = edges.length ? Math.max(0, Math.min(DEFAULT_FROM, Math.min(...edges) - 30)) : DEFAULT_FROM;
  const toMinute = edges.length ? Math.min(1440, Math.max(DEFAULT_TO, Math.max(...edges) + 30)) : DEFAULT_TO;

  // A day containing a DST transition is 23 or 25 hours long, so minutes-from-midnight and wall-clock
  // time stop agreeing partway through. Stated rather than silently drawn wrong.
  const dayLengthMinutes = Math.round((Date.parse(endIso) - dayStartMs) / 60000);
  const dstWarning = dayLengthMinutes === 1440 ? null
    : `the clocks change on this day (it is ${Math.round(dayLengthMinutes / 60)} hours long), so times after the change may sit an hour out on this view`;

  return {
    day, timezone, dayStartIso: startIso,
    fromMinute, toMinute, snapMinutes: 5,
    lanes, blocks, shading, dstWarning,
  };
}
