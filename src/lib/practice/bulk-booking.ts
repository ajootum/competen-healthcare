import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { bookableTimes, type BookableSlot } from "@/lib/practice/patient-booking";
import { bookAppointment } from "@/lib/practice/scheduling";
import { loadTaxonomy, type Taxonomy } from "@/lib/practice/taxonomy";
import { workspaceClock, dueDateFrom, zonedDayRange } from "@/lib/practice/practice-time";
import { isStaffBookableMode } from "@/lib/practice/practice-session-constants";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// BULK BOOKING (CP-BULK-BOOKING-001) -- placing many patients into a clinic in one pass.
//
// ⚠ THERE IS NO BOOKING LOGIC IN THIS FILE, AND THAT IS THE WHOLE DESIGN. s13: "Bulk Booking must call
// the same appointment creation domain service as single-patient booking. Do not create a parallel
// booking rules engine for bulk operations." Availability comes from bookableTimes on the STAFF channel;
// every write goes through bookAppointment, which is where notice periods, double-booking, the walk-in
// cutoff, session channels, the taxonomy and the audit trail already live. A bulk path that re-decided
// any of those would be a second rulebook that drifts from the first the day either one changes -- and
// the drift would show up as a clinic booked against rules nobody thought were still in force.
//
// ⚠ AND THE COMMIT IS ROW BY ROW ON PURPOSE. s12 asks for per-row outcomes and forbids silently skipping
// invalid patients. PostgREST has no cross-call transaction, so an "all or nothing" claim would be a
// lie; what this returns instead is exactly what happened to each row, and the screen shows every one.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type BulkPreset = "today" | "tomorrow" | "this_week" | "next_week" | "custom";

/** s4: one-click presets, resolved in the PRACTICE's calendar rather than the reader's. */
export function presetRange(preset: BulkPreset, today: string): { from: string; to: string } {
  switch (preset) {
    case "today": return { from: today, to: today };
    case "tomorrow": return { from: dueDateFrom(today, 1), to: dueDateFrom(today, 1) };
    case "this_week": {
      // ISO weeks: Monday starts. getUTCDay is 0 for Sunday, so Sunday belongs to the week just ending.
      const d = new Date(`${today}T00:00:00.000Z`);
      const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
      return { from: dueDateFrom(today, 1 - dow), to: dueDateFrom(today, 7 - dow) };
    }
    case "next_week": {
      const d = new Date(`${today}T00:00:00.000Z`);
      const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
      return { from: dueDateFrom(today, 8 - dow), to: dueDateFrom(today, 14 - dow) };
    }
    default: return { from: today, to: dueDateFrom(today, 6) };
  }
}

export type BulkSession = {
  /** The day in the practice's calendar. */
  day: string;
  dayLabel: string;
  locationId: string | null;
  locationName: string | null;
  slots: { startsAt: string; time: string; minutes: number }[];
};

/** A clinic that EXISTS on this day and is not open to booking. Inert on screen -- see closedSessions. */
export type ClosedSession = {
  day: string;
  dayLabel: string;
  locationId: string | null;
  locationName: string | null;
  locationSlot: string | null;
  reason: string;
};

export type BulkAvailability = {
  fromDate: string;
  toDate: string;
  timezone: string;
  locationId: string | null;
  sessions: BulkSession[];
  /** ⚠ EXISTS BUT CLOSED. Rendered greyed, never omitted -- an absent clinic and a closed one differ. */
  closed: ClosedSession[];
  totalSlots: number;
  taxonomy: Taxonomy;
  /** ⚠ FALSE means the availability could not be read -- NOT that the diary is full. */
  readable: boolean;
  permitted: boolean;
  detail: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function bulkAvailability(admin: any, ctx: WorkspaceContext, opts: {
  fromDate?: string; toDate?: string; preset?: BulkPreset; locationId?: string | null;
  /** The visit type whose duration decides the slot length. Defaults to the practice default. */
  visitTypeId?: string | null;
}): Promise<BulkAvailability> {
  const { timezone, today } = await workspaceClock(admin, ctx.workspaceId);
  const range = opts.preset && opts.preset !== "custom"
    ? presetRange(opts.preset, today)
    : { from: opts.fromDate ?? today, to: opts.toDate ?? dueDateFrom(today, 6) };

  const base: BulkAvailability = {
    fromDate: range.from, toDate: range.to, timezone, locationId: opts.locationId ?? null,
    sessions: [], closed: [], totalSlots: 0,
    taxonomy: { visitTypes: [], modes: [], defaultVisitTypeId: null, defaultModeId: null, readable: true, detail: null },
    readable: true, permitted: true, detail: null,
  };

  if (!hasCapability(ctx, "appointment.manage"))
    return { ...base, permitted: false };

  const taxonomy = await loadTaxonomy(admin, { workspaceId: ctx.workspaceId });
  // ⚠ NO TAXONOMY, NO GRID. Every row of the booking grid carries a visit type and a mode, and an empty
  // pair of dropdowns on forty rows is forty chances to file a clinic against nothing.
  if (!taxonomy.readable)
    return { ...base, taxonomy, readable: false, detail: taxonomy.detail };

  // The slot length follows the chosen visit type, which is what makes a Follow-up clinic 15-minute
  // slots and a New consultation clinic 30 (s5).
  const visitType = taxonomy.visitTypes.find(v => v.id === (opts.visitTypeId ?? taxonomy.defaultVisitTypeId));

  // ⚠ THE STAFF CHANNEL. A practice building its own clinic list is not a patient self-booking, and the
  // difference is load-bearing: staff see internal-only sessions and are not held to the public notice
  // period. Passing the patient channel here would hide half the diary from its owner.
  const times = await bookableTimes(admin, {
    channel: "staff",
    workspaceId: ctx.workspaceId,
    // bookableTimes still speaks the legacy string; the taxonomy travels separately until it is retired.
    appointmentType: "new_consultation",
    locationId: opts.locationId ?? null,
    fromIso: zonedDayRange(range.from, timezone).startIso,
    toIso: zonedDayRange(range.to, timezone).endIso,
  });
  if (!times.ok)
    return { ...base, taxonomy, readable: false, detail: (times as any).message ?? "availability could not be read" };

  const dayLabel = (iso: string) => {
    try {
      const d = new Date(iso);
      const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short" }).format(d);
      const [y, m, dd] = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(d).split("-");
      return `${weekday}, ${dd} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
    } catch { return iso.slice(0, 10); }
  };
  const dayKey = (iso: string) => {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(iso)); }
    catch { return iso.slice(0, 10); }
  };
  const hhmm = (iso: string) => {
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false })
        .format(new Date(iso));
    } catch { return iso.slice(11, 16); }
  };

  // One session card per day-and-place, which is how a practitioner thinks about a clinic.
  const byKey = new Map<string, BulkSession>();
  for (const s of ((times.data as any).slots ?? []) as BookableSlot[]) {
    const day = dayKey(s.startsAt);
    const key = `${day}|${s.locationId ?? "none"}`;
    if (!byKey.has(key))
      byKey.set(key, {
        day, dayLabel: dayLabel(s.startsAt),
        locationId: s.locationId, locationName: s.locationName, slots: [],
      });
    byKey.get(key)!.slots.push({
      startsAt: s.startsAt, time: hhmm(s.startsAt),
      minutes: visitType?.defaultDurationMinutes ?? s.minutes,
    });
  }

  const sessions = [...byKey.values()].sort((a, b) =>
    a.day === b.day ? (a.locationName ?? "").localeCompare(b.locationName ?? "") : a.day.localeCompare(b.day));
  return {
    ...base, taxonomy, sessions,
    closed: await closedSessions(admin, ctx, { fromDate: range.from, toDate: range.to, locationId: opts.locationId ?? null, dayLabel, dayKey }),
    totalSlots: sessions.reduce((n, s) => n + s.slots.length, 0),
  };
}

/**
 * THE CLINICS THAT EXIST AND ARE NOT OPEN TO BOOKING.
 *
 * The owner, 2026-08-12: Friday and Saturday at TMR simply were not there, and read as "no clinic that
 * day". They exist. Their templates carry booking_mode `none`, which the practitioner set, and
 * bookableTimes correctly refuses to offer them -- but a screen that DROPS them says something the
 * practice did not configure. A closed clinic and an absent clinic are different facts and a diary must
 * not render them identically.
 *
 * ⚠ THIS ADDS NO BOOKABILITY. Nothing here becomes selectable; the cards are inert and say why. The
 * engine's decision is unchanged -- only the silence about it is.
 *
 * ⚠ AND IT REUSES isStaffBookableMode RATHER THAN TESTING `!== "none"`. That predicate is BOOKING_MODES
 * minus none, and spelling the rule out here would be a second definition of "bookable" that nobody
 * updates when a fifth mode is added -- which is exactly how the type-link filter came to disagree with
 * the booking-mode filter two lines below it.
 */
async function closedSessions(admin: any, ctx: WorkspaceContext, args: {
  fromDate: string; toDate: string; locationId: string | null;
  dayLabel: (iso: string) => string; dayKey: (iso: string) => string;
}): Promise<ClosedSession[]> {
  const { data: windows, error } = await admin.from("practice_availability_slot")
    .select("starts_at, location_id, generated_from_template_id, status")
    .eq("workspace_id", ctx.workspaceId)
    .gte("generated_for_date", args.fromDate).lte("generated_for_date", args.toDate);
  // A failed read here costs the EXPLANATION, never the list above. Silently returning none puts the
  // screen back exactly where it was, which is the state this function exists to end -- so it is empty
  // rather than wrong, and the caller still shows every bookable session.
  if (error || !windows?.length) return [];

  const templateIds = [...new Set((windows as any[]).map(w => w.generated_from_template_id).filter(Boolean))];
  if (!templateIds.length) return [];
  const { data: templates } = await admin.from("practice_availability_template")
    .select("id, booking_mode, active").eq("workspace_id", ctx.workspaceId).in("id", templateIds);
  const modeById = new Map(((templates ?? []) as any[]).map(t => [t.id, { mode: t.booking_mode as string | null, active: t.active !== false }]));

  const { data: locs } = await admin.from("practice_location")
    .select("id, name, color_slot").eq("workspace_id", ctx.workspaceId);
  const locById = new Map(((locs ?? []) as any[]).map(l => [l.id, { name: l.name as string, slot: (l.color_slot as string | null) ?? null }]));

  const out = new Map<string, ClosedSession>();
  for (const w of windows as any[]) {
    if (args.locationId && w.location_id !== args.locationId) continue;
    const t = w.generated_from_template_id ? modeById.get(w.generated_from_template_id) : null;
    if (!t) continue;                                    // a one-off window governs itself
    if (t.active && isStaffBookableMode(t.mode)) continue; // this one IS offered, and already is
    const day = args.dayKey(w.starts_at);
    const key = `${day}|${w.location_id ?? "none"}`;
    if (out.has(key)) continue;
    out.set(key, {
      day, dayLabel: args.dayLabel(w.starts_at),
      locationId: w.location_id ?? null,
      locationName: w.location_id ? (locById.get(w.location_id)?.name ?? null) : null,
      locationSlot: w.location_id ? (locById.get(w.location_id)?.slot ?? null) : null,
      reason: !t.active
        ? "this session is suspended"
        : "this session is not open to booking",
    });
  }
  return [...out.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export type BulkRow = {
  /** s14: the client's own row id, so an outcome can be matched back to the row that caused it. */
  clientRowId: string;
  patientId: string;
  startsAt: string;
  visitTypeId: string;
  consultationModeId: string;
  locationId: string | null;
  note?: string | null;
};

export type BulkRowOutcome = {
  clientRowId: string;
  patientId: string;
  ok: boolean;
  appointmentId?: string;
  code?: string;
  message?: string;
};

/**
 * s11 and s12: place the confirmed rows, and report what happened to EVERY one.
 *
 * ⚠ THE SLOT IS RE-CHECKED BY THE ENGINE, NOT BY THIS FUNCTION. s10: "do not assume an available slot
 * remains available merely because it was shown when the page loaded." bookAppointment runs
 * checkPlacement on every call and migration 255's exclusion constraint refuses an overlap in the
 * database regardless -- so a slot taken while the grid was being filled fails that ROW and no other.
 *
 * ⚠ AND THERE IS NO BATCH IDEMPOTENCY KEY, WHICH IS WHY THIS SAYS SO. s13 asks for one. What actually
 * protects a retry today is the exclusion constraint: re-submitting a batch that half-succeeded refuses
 * the rows that already exist with DOUBLE_BOOKED rather than duplicating them. That is real protection
 * and it is not the same thing as an idempotency key -- it cannot tell a retry from a deliberate
 * double-book, so the screen must show the per-row outcomes rather than a single "done".
 */
export async function bulkCommit(admin: any, ctx: WorkspaceContext, input: {
  rows: BulkRow[]; actorId: string; correlationId: string;
}): Promise<{ ok: boolean; outcomes: BulkRowOutcome[]; booked: number; failed: number; code?: string; message?: string }> {
  if (!hasCapability(ctx, "appointment.manage"))
    return { ok: false, outcomes: [], booked: 0, failed: 0, code: "FORBIDDEN", message: "booking needs the appointment permission" };
  if (!input.rows.length)
    return { ok: false, outcomes: [], booked: 0, failed: 0, code: "NO_ROWS", message: "no rows were submitted" };

  const outcomes: BulkRowOutcome[] = [];
  for (const row of input.rows) {
    // ⚠ SEQUENTIAL, NOT Promise.all. Two rows racing for the same minute would both pass their placement
    // check and one would then be refused by the database -- which is safe, but it turns a predictable
    // refusal into a race whose loser varies between runs.
    const res = await bookAppointment(admin, {
      workspaceId: ctx.workspaceId,
      patientId: row.patientId,
      patientName: "",           // taken from the register by the engine, never from this payload
      appointmentType: "new_consultation",
      visitTypeId: row.visitTypeId,
      consultationModeId: row.consultationModeId,
      scheduledAt: row.startsAt,
      locationId: row.locationId ?? null,
      reason: row.note?.trim() || undefined,
      actorId: input.actorId,
      correlationId: input.correlationId,
    });
    outcomes.push(res.ok
      ? { clientRowId: row.clientRowId, patientId: row.patientId, ok: true, appointmentId: res.data.id }
      : { clientRowId: row.clientRowId, patientId: row.patientId, ok: false, code: res.code, message: res.message });
  }

  const booked = outcomes.filter(o => o.ok).length;
  return { ok: booked > 0, outcomes, booked, failed: outcomes.length - booked };
}
