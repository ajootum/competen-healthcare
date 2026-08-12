import { type WorkspaceContext } from "@/lib/practice/access";
import { practiceToday, workspaceClock, zonedDayRange } from "@/lib/practice/practice-time";
import { ageFrom } from "@/lib/practice/relationships";
import { channelSettings } from "@/lib/practice/messaging";

// CPR-CAL-001 v4 -- the Practice Operations Calendar.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE DAY IS THE PRACTICE'S DAY, NOT UTC'S. loadDay() has been slicing the diary with
// `${dayIso}T00:00:00.000Z` since Phase 1, which is the exact bug CPR-300 found on the operations home
// and fixed there: in Kampala a 01:00 appointment is 22:00Z the day before, so it VANISHED from its own
// day view and appeared on the previous one. Three hours of every morning, wrong, in the diary.
//
// UTILISATION IS SHOWN AS TIME, NOT AS A PERCENTAGE. Capacity IS recorded here -- an availability slot
// has a start and an end -- so unlike the registration screen the underlying numbers are real. What is
// still refused is the donut: "7h 23m of 10h 00m" carries everything "82%" carries and also says what
// it is 82% OF, which is what a reader needs on a morning when only two hours were ever available.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The comp's colour-coded badges, mapped to the types migration 192 already defines. */
export const APPOINTMENT_KINDS: Record<string, { label: string; colour: string }> = {
  new_consultation: { label: "New patient", colour: "var(--cp-primary)" },
  scheduled_followup: { label: "Follow-up", colour: "var(--cp-info)" },
  hospital_consultation: { label: "Hospital consult", colour: "var(--cp-warning)" },
  teleconsultation: { label: "Telemedicine", colour: "var(--cp-accent)" },
  walk_in: { label: "Walk-in", colour: "var(--cp-success)" },
  emergency: { label: "Emergency", colour: "var(--cp-error)" },
  home_visit: { label: "Home visit", colour: "var(--cp-slate-500)" },
};

export const SLOT_KINDS: Record<string, { label: string; colour: string }> = {
  clinic: { label: "Clinic", colour: "var(--cp-primary)" },
  telemedicine: { label: "Telemedicine", colour: "var(--cp-accent)" },
  emergency_reserve: { label: "Emergency", colour: "var(--cp-error)" },
  leave: { label: "Leave", colour: "var(--cp-warning)" },
  blocked: { label: "Blocked", colour: "var(--cp-slate-500)" },
  admin: { label: "Admin", colour: "var(--cp-slate-500)" },
};

/**
 * What this screen will not claim.
 *
 * THE ALLERGY LINE IS THE DANGEROUS ONE. The comp's drawer reads "Allergies: No known allergies", and
 * the practice tenancy HAS NO ALLERGY STORE -- that sentence would be rendered from an empty table.
 * "No known allergies" read off a screen is taken as a fact somebody checked, and a clinician who
 * believes it is a clinician who does not ask. An absent field is safe; a confident empty one is not.
 */
export const REFUSED_ON_CALENDAR = [
  {
    key: "allergies",
    label: "Allergies",
    detail: "The design shows \"No known allergies\" in the patient drawer. Nothing in this product records an allergy, so that line would be printed from an empty table -- and \"no known allergies\" read off a screen is taken as a fact somebody checked. A clinician who believes it is a clinician who does not ask. The field is absent rather than reassuringly blank.",
  },
  {
    key: "balance",
    label: "Outstanding balance",
    detail: "The design shows $0.00 and a Billing tab. There is no billing in this product -- no invoice, no payment, no ledger -- so a zero balance would be a financial statement made from nothing.",
  },
  {
    key: "questionnaires",
    label: "Questionnaire status",
    detail: "The design counts patients who have not completed questionnaires. There is no questionnaire capability here, and nothing has ever been sent to a patient to complete.",
  },
  {
    key: "utilisation_percent",
    label: "Utilisation as a percentage",
    detail: "The design draws 82% in a donut. Hours scheduled and hours available are both real here and are shown as times -- \"7h 23m of 10h 00m\" says what 82% says and also says what it is a percentage OF, which is what matters on a morning when only two hours were available.",
  },
  {
    key: "ai_clinical",
    label: "Clinical suggestions in the briefing",
    detail: "The design's briefing says \"3 MRI results likely require discussion\" and \"Recommend calling 1 patient before clinic\". Those originate clinical judgements, which is the line CPR-210 draws. The counts in the same panel -- how many are follow-ups, how many are overdue -- are arithmetic over the diary and are kept.",
  },
  {
    key: "auto_notify",
    label: "\"Patients notified automatically\"",
    detail: "The design's footer claims it. There is now a delivery channel, but it is off until a practice turns it on, it requires recorded consent, and NOTHING schedules a reminder -- no job runs, so no message is sent by itself. The footer says what is actually true instead.",
  },
] as const;

const minutesBetween = (a: string, b: string) => Math.max(0, (Date.parse(b) - Date.parse(a)) / 60000);
const asDuration = (mins: number) => {
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

/**
 * The whole operations calendar for one day.
 *
 * ONE READ, because the comp shows eight panels that all describe the same day and eight separate
 * fetches would let them disagree with each other mid-render.
 */
export async function calendarDay(admin: any, ctx: WorkspaceContext, dayIso?: string) {
  const { timezone } = await workspaceClock(admin, ctx.workspaceId);
  const today = practiceToday(timezone);
  const day = dayIso && /^\d{4}-\d{2}-\d{2}$/.test(dayIso) ? dayIso : today;
  // THE PRACTICE'S OWN DAY. See the header.
  const { startIso, endIso } = zonedDayRange(day, timezone);

  // The week the chosen day sits in, Monday-first, for the comp's location panel.
  const weekStart = new Date(`${day}T12:00:00Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
  const weekDays = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(weekStart); d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const weekRange = { start: zonedDayRange(weekDays[0], timezone).startIso, end: zonedDayRange(weekDays[4], timezone).endIso };

  const [
    { data: appointments }, { data: slots }, { data: queue },
    { data: weekSlots }, { data: locations }, { data: followUps }, channels,
  ] = await Promise.all([
    admin.from("practice_appointment")
      .select("id, patient_id, patient_name, patient_phone, appointment_type, scheduled_at, duration_minutes, status, reason, location_id, slot_id")
      .eq("workspace_id", ctx.workspaceId).gte("scheduled_at", startIso).lt("scheduled_at", endIso)
      .order("scheduled_at"),
    admin.from("practice_availability_slot")
      .select("id, starts_at, ends_at, status, slot_kind, note, location_id")
      .eq("workspace_id", ctx.workspaceId).gte("starts_at", startIso).lt("starts_at", endIso)
      .order("starts_at"),
    admin.from("practice_queue_entry")
      .select("id, patient_id, patient_name, status, entered_at, appointment_id")
      .eq("workspace_id", ctx.workspaceId).in("status", ["WAITING", "READY", "IN_CONSULTATION", "PAUSED"])
      .order("entered_at"),
    admin.from("practice_availability_slot")
      .select("id, starts_at, ends_at, slot_kind, location_id")
      .eq("workspace_id", ctx.workspaceId).gte("starts_at", weekRange.start).lt("starts_at", weekRange.end)
      .order("starts_at"),
    admin.from("practice_location").select("id, name, type, active").eq("workspace_id", ctx.workspaceId),
    admin.from("practice_follow_up").select("id, patient_id, due_on, status")
      .eq("workspace_id", ctx.workspaceId).in("status", ["OPEN", "SCHEDULED"]).limit(500),
    channelSettings(admin, ctx.workspaceId),
  ]);

  const appts = (appointments ?? []) as any[];
  const slotRows = (slots ?? []) as any[];
  const locationById = new Map(((locations ?? []) as any[]).map(l => [l.id, l]));

  const live = appts.filter(a => !["CANCELLED", "NO_SHOW"].includes(a.status));
  const bookedMinutes = live.reduce((n, a) => n + (a.duration_minutes ?? 0), 0);
  // Only slots a patient could actually be seen in count as capacity. Leave is not spare time.
  const workingSlots = slotRows.filter(s => ["clinic", "telemedicine", "emergency_reserve"].includes(s.slot_kind));
  const availableMinutes = workingSlots.reduce((n, s) => n + minutesBetween(s.starts_at, s.ends_at), 0);

  const byType = (t: string) => live.filter(a => a.appointment_type === t).length;

  return {
    day, today, timezone,
    isToday: day === today,
    week: weekDays.map(d => {
      const dayRange = zonedDayRange(d, timezone);
      const daySlots = ((weekSlots ?? []) as any[])
        .filter(s => s.starts_at >= dayRange.startIso && s.starts_at < dayRange.endIso);
      const first = daySlots[0], last = daySlots[daySlots.length - 1];
      return {
        day: d,
        isChosen: d === day,
        // WHERE, taken from the slots themselves rather than a separate rota nobody maintains.
        locations: [...new Set(daySlots.map(s => locationById.get(s.location_id)?.name).filter(Boolean))],
        kinds: [...new Set(daySlots.map(s => s.slot_kind))],
        from: first?.starts_at ?? null,
        to: last?.ends_at ?? null,
        slots: daySlots.length,
      };
    }),

    // ── The comp's summary cards ────────────────────────────────────────────────────────────────
    summary: {
      booked: live.length,
      followUps: byType("scheduled_followup"),
      newPatients: byType("new_consultation"),
      telemedicine: byType("teleconsultation"),
      emergency: byType("emergency"),
      walkIns: byType("walk_in"),
      hospital: byType("hospital_consultation"),
    },

    // ── Utilisation, as time ────────────────────────────────────────────────────────────────────
    load: {
      scheduledMinutes: bookedMinutes,
      scheduled: asDuration(bookedMinutes),
      availableMinutes,
      available: availableMinutes > 0 ? asDuration(availableMinutes) : null,
      remaining: availableMinutes > 0 ? asDuration(Math.max(0, availableMinutes - bookedMinutes)) : null,
      // WHEN NOBODY HAS SET AVAILABILITY there is no denominator, and the screen says so rather than
      // dividing by an assumption.
      capacityRecorded: availableMinutes > 0,
      // The doctrine as a field, so no client can draw the donut.
      utilisationPercent: null as number | null,
    },

    // ── The availability ribbon ─────────────────────────────────────────────────────────────────
    ribbon: slotRows.map(s => {
      const taken = live.filter(a => a.slot_id === s.id);
      return {
        id: s.id,
        kind: s.slot_kind,
        label: SLOT_KINDS[s.slot_kind]?.label ?? s.slot_kind,
        colour: SLOT_KINDS[s.slot_kind]?.colour ?? "var(--cp-slate-500)",
        from: s.starts_at, to: s.ends_at,
        location: locationById.get(s.location_id)?.name ?? null,
        note: s.note,
        // DERIVED, NEVER STORED. A stored "full" is wrong the moment somebody cancels.
        full: taken.length > 0,
        booked: taken.length,
      };
    }),

    // ── The day grid ────────────────────────────────────────────────────────────────────────────
    appointments: appts.map(a => ({
      id: a.id, patientId: a.patient_id, name: a.patient_name,
      at: a.scheduled_at, minutes: a.duration_minutes, status: a.status, reason: a.reason,
      type: a.appointment_type,
      typeLabel: APPOINTMENT_KINDS[a.appointment_type]?.label ?? a.appointment_type,
      colour: APPOINTMENT_KINDS[a.appointment_type]?.colour ?? "var(--cp-slate-500)",
      location: locationById.get(a.location_id)?.name ?? null,
      // ONE CLICK TO THE ENCOUNTER (s7) -- but only where a booking is linked to a real record. A
      // name-only booking has nothing to write a consultation against, and saying so beats a button
      // that fails.
      canOpenEncounter: !!a.patient_id,
      href: a.patient_id ? `/practice/patients/${a.patient_id}` : null,
    })),

    queue: ((queue ?? []) as any[]).map(q => ({
      id: q.id, patientId: q.patient_id, name: q.patient_name, status: q.status,
      enteredAt: q.entered_at,
      waitingMinutes: Math.round(minutesBetween(q.entered_at, new Date().toISOString())),
      href: q.patient_id ? `/practice/patients/${q.patient_id}` : null,
    })),

    // ── The follow-up overview ──────────────────────────────────────────────────────────────────
    followUps: {
      dueToday: ((followUps ?? []) as any[]).filter(f => f.status === "OPEN" && f.due_on === today).length,
      // DERIVED from the date, never a stored flag -- CPR-140's rule.
      overdue: ((followUps ?? []) as any[]).filter(f => f.status === "OPEN" && f.due_on < today).length,
      booked: ((followUps ?? []) as any[]).filter(f => f.status === "SCHEDULED").length,
      needBooking: ((followUps ?? []) as any[]).filter(f => f.status === "OPEN").length,
    },

    // ── The briefing, without the clinical suggestions ──────────────────────────────────────────
    briefing: [
      `${live.length} ${live.length === 1 ? "appointment" : "appointments"}`,
      byType("scheduled_followup") > 0 ? `${byType("scheduled_followup")} of them follow-ups` : null,
      byType("new_consultation") > 0 ? `${byType("new_consultation")} new to this practice` : null,
      ((followUps ?? []) as any[]).filter(f => f.status === "OPEN" && f.due_on < today).length > 0
        ? `${((followUps ?? []) as any[]).filter(f => f.status === "OPEN" && f.due_on < today).length} follow-ups already overdue`
        : null,
      appts.some(a => !a.patient_id) ? `${appts.filter(a => !a.patient_id).length} booked by name only, with no record attached` : null,
    ].filter(Boolean) as string[],

    locations: ((locations ?? []) as any[]).filter(l => l.active),

    // ── What the footer can honestly say ────────────────────────────────────────────────────────
    notifications: {
      // The comp's footer says "Patients notified automatically". It is not automatic.
      channelOn: channels.some(c => c.usable),
      automatic: false,
      note: channels.some(c => c.usable)
        ? "Messaging is switched on, but nothing sends by itself -- a reminder goes when somebody sends it, and only to patients who agreed to be contacted."
        : "Nothing is sent to patients from here. Messaging is off for this practice.",
    },

    refused: REFUSED_ON_CALENDAR,
  };
}

/** The comp's patient drawer -- context without navigating away (s31). */
export async function patientDrawer(admin: any, ctx: WorkspaceContext, patientId: string) {
  // ⚠ patient_number JOINED THE SELECT 2026-08-12. CPR-PID-001 made YY-NNNNNN the identity a person
  // matches on and stopped minting the practice_id IDENTIFIER ROW, so this drawer -- whose whole job is
  // "context without navigating away" -- had been showing a patient with no identifying number at all,
  // and its identifiers list is now legitimately empty for anyone registered since.
  const { data: patient } = await admin.from("practice_patient")
    .select("id, display_name, birth_date, age_estimate_years, sex, status, patient_number")
    .eq("id", patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!patient) return null;

  const { timezone } = await workspaceClock(admin, ctx.workspaceId);
  const today = practiceToday(timezone);

  const [{ data: identifiers }, { data: contacts }, { data: encounters }, { data: diagnoses }, { data: followUps }] =
    await Promise.all([
      admin.from("practice_patient_identifier")
        .select("identifier_type, value, facility_id").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).is("valid_to", null),
      admin.from("practice_patient_contact")
        .select("contact_type, value, preferred").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId),
      admin.from("practice_encounter")
        .select("id, started_at, status, reason_for_visit, entry_pathway").eq("workspace_id", ctx.workspaceId)
        .eq("patient_id", patientId).order("started_at", { ascending: false }).limit(5),
      admin.from("practice_diagnosis")
        .select("label, certainty, is_primary, created_at").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
        .order("created_at", { ascending: false }).limit(5),
      admin.from("practice_follow_up")
        .select("id, due_on, status").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).in("status", ["OPEN", "SCHEDULED"])
        .order("due_on").limit(3),
    ]);

  return {
    patient: {
      ...patient,
      age: ageFrom(patient.birth_date, today),
      ageEstimate: patient.age_estimate_years,
    },
    identifiers: (identifiers ?? []) as any[],
    contacts: (contacts ?? []) as any[],
    encounters: ((encounters ?? []) as any[]).map(e => ({ ...e, href: `/practice/encounters/${e.id}` })),
    diagnoses: (diagnoses ?? []) as any[],
    followUps: ((followUps ?? []) as any[]).map(f => ({ ...f, overdue: f.status === "OPEN" && f.due_on < today })),
    // THE THREE THINGS THE COMP'S DRAWER SHOWS THAT THIS PRODUCT CANNOT KNOW. Named on the drawer
    // itself, because a missing row reads as "none" and one of these reads as "no known allergies".
    unavailable: REFUSED_ON_CALENDAR.filter(r => ["allergies", "balance", "questionnaires"].includes(r.key)),
  };
}
