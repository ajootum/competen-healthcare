import type { WorkspaceContext } from "@/lib/practice/access";
import { practiceToday, zonedDayRange } from "@/lib/practice/practice-time";
import { APPOINTMENT_KINDS } from "@/lib/practice/calendar";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-001_v4 PRACTICE COMMAND CENTRE -- the widgets the v4 comp adds over CPR-300's operations home.
//
// operationsHome() still supplies the attention list and the practice facts; this file supplies what
// v4 asks for on top: the hero briefing, the week's locations, the live queue, follow-up intelligence,
// recent patients and documents, patient insights and practice performance.
//
// ---- THE THREE THINGS THIS FILE REFUSES TO SAY -------------------------------------------------------
//
// 1. NOTHING HERE IS AI-GENERATED, so nothing here is labelled as if it were. The comp's briefing panel
//    reads "AI Briefing (BETA)" over four lines, three of which are arithmetic this product already
//    does -- "2 follow-ups are overdue" needs no model, it needs a subtraction. The fourth, "Michael
//    Chen likely needs longer consultation", is a CLINICAL PREDICTION about a named patient, and there
//    is nothing in this product that could ground it: no consultation-length history per patient, no
//    complexity model, nothing. CPR-210 drew this line already -- the assistant may REORGANISE what is
//    in the record, it may not ORIGINATE a clinical fact. A prediction attached to a real person's name
//    on the first screen of the morning is the strongest possible version of originating one.
//    The panel therefore renders, in its designed position, carrying the derived lines and the field
//    `aiGenerated: false`.
//
// 2. NO AVERAGE WITHOUT ITS DENOMINATOR. "18 min avg consult time" over three consultations is not a
//    measurement, and the comp shows four such figures with no n at all. Each carries `overCount`, and
//    a figure with nothing behind it is null with a reason rather than a confident zero.
//
// 3. NO COHORT THIS PRACTICE DID NOT RECORD. The comp's Patient Insights names five neurology cohorts
//    (Epilepsy, Hydrocephalus, Spina Bifida, Brain Tumours, Other). Those are the DESIGNER'S specialty,
//    not a taxonomy -- counting into fixed buckets would mean inventing a coding nobody performed.
//    Diagnoses are counted AS TYPED, which is CPR-330's rule, and the widget says so.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const DEFAULT_OPENS = 8 * 60;
const DEFAULT_CLOSES = 17 * 60;

export const COMMAND_CENTRE_REFUSES = [
  {
    key: "ai_briefing",
    label: "An AI-written briefing",
    detail: "The lines in the brief are derived from the diary, the follow-up board and the inbox — arithmetic, not a model. The design's fourth line predicts that a named patient will need a longer consultation; nothing recorded here could ground that.",
  },
  {
    key: "performance_trends",
    label: "Comparisons with yesterday or last week",
    detail: "Nothing has recorded a baseline to compare against, so an arrow would be pointing at a number that was never measured.",
  },
  {
    key: "fixed_cohorts",
    label: "Named condition cohorts",
    detail: "Diagnoses are counted exactly as they were typed. Sorting them into a fixed list of conditions would invent a coding nobody performed.",
  },
  {
    key: "realtime",
    label: "Live figures that update themselves",
    detail: "The page is read when it is opened. Nothing pushes an update to it, so it states when it was read rather than claiming to be current.",
  },
];

const hhmm = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(Math.floor(minute) % 60).padStart(2, "0")}`;

// ── THE CLINIC WINDOW ────────────────────────────────────────────────────────────────────────────────

export type ClinicWindow = {
  opensMinute: number; closesMinute: number;
  opensLabel: string; closesLabel: string;
  /** null before the clinic opens and after it closes -- a bar cannot be 0% and "in progress". */
  progressPercent: number | null;
  state: "before" | "in_progress" | "finished";
  /** When the last booked appointment ends, when that is later than closing. Derived, never stored. */
  estimatedFinishLabel: string | null;
  runningLate: boolean;
  nowMinute: number;
};

function clinicWindow(
  config: any, appts: any[], dayStartMs: number, nowMs: number,
): ClinicWindow {
  const opensMinute = config?.clinic_opens_minute ?? DEFAULT_OPENS;
  const closesMinute = config?.clinic_closes_minute ?? DEFAULT_CLOSES;
  const nowMinute = (nowMs - dayStartMs) / 60000;

  // The estimated finish is the LAST BOOKING'S END, not a prediction about how the day will run. A
  // product that guessed "you will finish at 16:45" would be modelling overruns it has never measured.
  const lastEndMinute = appts
    .filter(a => !["CANCELLED", "NO_SHOW"].includes(a.status))
    .reduce((latest, a) => {
      const end = (Date.parse(a.scheduled_at) - dayStartMs) / 60000 + (a.duration_minutes ?? 20);
      return end > latest ? end : latest;
    }, -Infinity);
  const hasBookings = Number.isFinite(lastEndMinute);

  const state = nowMinute < opensMinute ? "before" : nowMinute >= closesMinute ? "finished" : "in_progress";
  const progressPercent = state === "in_progress"
    ? Math.round(((nowMinute - opensMinute) / (closesMinute - opensMinute)) * 100)
    : null;

  return {
    opensMinute, closesMinute,
    opensLabel: hhmm(opensMinute), closesLabel: hhmm(closesMinute),
    progressPercent, state,
    estimatedFinishLabel: hasBookings ? hhmm(Math.max(lastEndMinute, 0)) : null,
    runningLate: hasBookings && lastEndMinute > closesMinute,
    nowMinute,
  };
}

// ── THE COMMAND CENTRE ───────────────────────────────────────────────────────────────────────────────

export async function commandCentre(admin: any, ctx: WorkspaceContext) {
  const can = (c: string) => ctx.capabilities.includes(c);

  // The comp greets "Dr. Alex". Names live in `profiles` and a practice-only user may have no row --
  // CPR-340 recorded this already, which is why task assignees can render as "Unnamed member". Looked
  // up rather than guessed, and NEVER falling back to the workspace name: greeting somebody by their
  // business's name is worse than not greeting them at all.
  const [{ data: ws }, { data: profile }] = await Promise.all([
    admin.from("practice_workspace").select("timezone, name").eq("id", ctx.workspaceId).maybeSingle(),
    admin.from("profiles").select("full_name").eq("id", ctx.userId).maybeSingle(),
  ]);
  const timezone = ws?.timezone || "UTC";
  const today = practiceToday(timezone);
  const { startIso, endIso } = zonedDayRange(today, timezone);
  const dayStartMs = Date.parse(startIso);
  const readAt = new Date();

  const { data: config } = await admin.from("practice_configuration")
    .select("clinic_opens_minute, clinic_closes_minute, clinic_days")
    .eq("workspace_id", ctx.workspaceId).eq("is_effective", true).maybeSingle();

  const [
    { data: appointments }, { data: queue }, { data: locations },
  ] = await Promise.all([
    can("practice.calendar.view")
      ? admin.from("practice_appointment")
        .select("id, patient_id, patient_name, appointment_type, scheduled_at, duration_minutes, status, location_id")
        .eq("workspace_id", ctx.workspaceId).gte("scheduled_at", startIso).lt("scheduled_at", endIso)
        .order("scheduled_at")
      : Promise.resolve({ data: null }),
    can("queue.manage") || can("practice.calendar.view")
      ? admin.from("practice_queue_entry")
        .select("id, patient_id, patient_name, status, entered_at, appointment_id")
        .eq("workspace_id", ctx.workspaceId).in("status", ["WAITING", "READY", "IN_CONSULTATION", "PAUSED"])
        .order("entered_at")
      : Promise.resolve({ data: null }),
    admin.from("practice_location")
      .select("id, name, type, active, facility_id").eq("workspace_id", ctx.workspaceId),
  ]);

  const appts = ((appointments ?? []) as any[]);
  const live = appts.filter(a => !["CANCELLED", "NO_SHOW"].includes(a.status));
  const locById = new Map(((locations ?? []) as any[]).map(l => [l.id, l]));

  // ── HERO STATS ─────────────────────────────────────────────────────────────────────────────────
  //
  // Follow-up intelligence still needs its rows. The `newPatients` and `incoming` counts beside it fed
  // heroStats ONLY, so they are gone with it: a query nobody reads is latency and a row cap spent on
  // nothing, and leaving it is how somebody later argues a figure should be computed here because
  // "we already fetch that".
  const followUpRows = can("followup.view")
    ? await admin.from("practice_follow_up").select("id, due_on, status, patient_id")
      .eq("workspace_id", ctx.workspaceId).in("status", ["OPEN", "SCHEDULED", "COMPLETED"]).limit(2000)
    : { data: null };

  const follows = ((followUpRows as any)?.data ?? null) as any[] | null;
  const openFollows = follows?.filter(f => f.status === "OPEN") ?? null;
  const overdueFollows = openFollows?.filter(f => f.due_on < today) ?? null;

  // heroStats lived here and fed the greeting card that CPR-V5-001 s2 replaced with Current Activity.
  // Dead since that commit, and a FOURTH set of definitions for figures s8 owns -- removed rather than
  // left for somebody to wire back up.

  const clinic = clinicWindow(config, appts, dayStartMs, readAt.getTime());

  // ── TODAY'S TIMELINE ───────────────────────────────────────────────────────────────────────────
  const timeline = live.map(a => ({
    id: a.id, patientId: a.patient_id, patientName: a.patient_name,
    timeLabel: hhmm((Date.parse(a.scheduled_at) - dayStartMs) / 60000),
    typeLabel: APPOINTMENT_KINDS[a.appointment_type]?.label ?? a.appointment_type,
    colour: APPOINTMENT_KINDS[a.appointment_type]?.colour ?? "var(--cp-slate-500)",
    status: a.status,
    locationName: a.location_id ? locById.get(a.location_id)?.name ?? null : null,
  }));

  // ── THE WEEK'S LOCATIONS (v4's own panel, and the reason migration 228 exists) ──────────────────
  //
  // Only the days the practice actually runs (clinic_days, mig 229). A row with no location is not an
  // empty row: it says nothing was recorded, which is a different fact from "no clinic that day".
  const clinicDays: number[] = config?.clinic_days ?? [1, 2, 3, 4, 5];
  const weekStart = new Date(`${today}T12:00:00Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));

  const weekDates: { date: string; isoWeekday: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart); d.setUTCDate(d.getUTCDate() + i);
    const isoWeekday = ((d.getUTCDay() + 6) % 7) + 1;
    if (clinicDays.includes(isoWeekday)) weekDates.push({ date: d.toISOString().slice(0, 10), isoWeekday });
  }

  const weekRange = weekDates.length
    ? { start: zonedDayRange(weekDates[0].date, timezone).startIso, end: zonedDayRange(weekDates[weekDates.length - 1].date, timezone).endIso }
    : null;

  const { data: weekAppts } = weekRange && can("practice.calendar.view")
    ? await admin.from("practice_appointment")
      .select("scheduled_at, location_id, status")
      .eq("workspace_id", ctx.workspaceId).not("status", "in", "(CANCELLED,NO_SHOW)")
      .gte("scheduled_at", weekRange.start).lt("scheduled_at", weekRange.end)
    : { data: null };

  const weekLocations = weekDates.map(({ date }) => {
    const range = zonedDayRange(date, timezone);
    const onThatDay = ((weekAppts ?? []) as any[]).filter(a =>
      a.scheduled_at >= range.startIso && a.scheduled_at < range.endIso);
    // The place with the most of that day's work. A day split across two sites shows the busier one and
    // says there is another -- naming only one when two are real would send somebody to the wrong site.
    //
    // ONLY REAL PLACES ARE CANDIDATES. Bookings that say nothing about where are not a location that
    // can win the ranking: a day with two unplaced bookings and one at Mulago is a day at Mulago, and
    // letting the empty bucket take the row would hide the only place actually named.
    const counts = new Map<string, number>();
    for (const a of onThatDay) {
      if (!a.location_id) continue;
      counts.set(a.location_id, (counts.get(a.location_id) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const topId = ranked[0]?.[0] ?? null;
    const loc = topId ? locById.get(topId) : null;
    return {
      date,
      appointmentCount: onThatDay.length,
      locationName: loc?.name ?? null,
      locationType: loc?.type ?? null,
      otherLocationCount: Math.max(0, ranked.length - 1),
      /** Bookings on that day that name no place at all. Distinct from having no bookings. */
      unplacedCount: onThatDay.filter(a => !a.location_id).length,
      /** Distinguishes "no clinic booked" from "booked, but nobody said where". */
      placeRecorded: !!loc,
      isToday: date === today,
    };
  });

  // ── FOLLOW-UP INTELLIGENCE (the comp's five tiles) ─────────────────────────────────────────────
  const inSevenDays = new Date(`${today}T12:00:00Z`);
  inSevenDays.setUTCDate(inSevenDays.getUTCDate() + 7);
  const weekAhead = inSevenDays.toISOString().slice(0, 10);

  const followUpIntelligence = follows ? [
    { key: "booked_today", label: "Booked Today", value: follows.filter(f => f.status === "SCHEDULED").length, tone: "normal" },
    { key: "need_booking", label: "Need Booking", value: (openFollows ?? []).filter(f => f.due_on >= today).length, tone: "normal" },
    { key: "overdue", label: "Overdue", value: (overdueFollows ?? []).length, tone: "critical" },
    { key: "completed", label: "Completed", value: follows.filter(f => f.status === "COMPLETED").length, tone: "normal" },
    { key: "due_week", label: "Due This Week", value: (openFollows ?? []).filter(f => f.due_on >= today && f.due_on <= weekAhead).length, tone: "normal" },
  ] : null;

  // ── PRACTICE PERFORMANCE: MOVED TO metrics.ts ──────────────────────────────────────────────────
  //
  // ⚠ THIS WAS THE THIRD IMPLEMENTATION OF FOUR OF s8's METRICS, and the most wrong of the three.
  // CPR-CORE-001 s16: "no widget independently calculates a conflicting version of a shared metric."
  //
  //   patients_seen  was `encs.length` -- every encounter STARTED today with no status filter, so
  //                  DRAFT, CANCELLED and ENTERED_IN_ERROR were all counted as a patient seen. s8
  //                  defines it as DISTINCT patients with a COMPLETED encounter.
  //   avg_consult    excluded no paused duration and filtered no status, so a consultation interrupted
  //                  by an emergency read as a 90-minute consultation -- which also breaks s6.2's
  //                  "interruption time must not be counted as active consultation time for another
  //                  patient" -- and a reopened encounter's stale completed_at was counted too.
  //   avg_wait       read practice_arrival with status='ARRIVED' and silently dropped VERIFIED
  //                  arrivals, and measured no wait at all for a walk-in, who has no appointment to
  //                  join on. The people who wait longest were the people it could not see.
  //   clinic_delay   was a MEAN with negatives clamped to zero, so a clinic could never read as early
  //                  and every figure was biased upward; it included walk-in appointments whose delay
  //                  is ~0 by construction; and it had NO MINIMUM-OBSERVATION GATE, so one late start
  //                  rendered a number -- exactly what s8's "no comparison shown until enough valid
  //                  observations exist" forbids.
  //
  // All four reads were also unbounded, so each was silently capped at PostgREST's 1000 rows.
  //
  // The card now renders from the dashboard read model's `metrics`, which is metrics.ts. Deleted
  // rather than corrected, for the reason s16 gives: two correct implementations drift into two
  // answers just as surely as a wrong one, only later and more quietly.

  // ── PATIENT INSIGHTS ───────────────────────────────────────────────────────────────────────────
  //
  // Counted AS TYPED (CPR-330). Distinct PATIENTS per label, not diagnosis rows -- a patient seen four
  // times for epilepsy is one person with epilepsy, and counting rows would inflate every cohort by how
  // often people came back.
  const { data: diagnoses } = can("encounter.list")
    ? await admin.from("practice_diagnosis")
      .select("label, patient_id").eq("workspace_id", ctx.workspaceId).limit(5000)
    : { data: null };

  const cohortMap = new Map<string, Set<string>>();
  for (const d of ((diagnoses ?? []) as any[])) {
    const label = String(d.label ?? "").trim();
    if (!label || !d.patient_id) continue;
    if (!cohortMap.has(label)) cohortMap.set(label, new Set());
    cohortMap.get(label)!.add(d.patient_id);
  }
  const allCohorts = [...cohortMap.entries()]
    .map(([label, patients]) => ({ label, count: patients.size }))
    .sort((a, b) => b.count - a.count);
  const patientInsights = can("encounter.list") ? {
    cohorts: allCohorts.slice(0, 5),
    // NAMED, NOT DROPPED. "and 23 more" is the difference between a top-five and a claim that five is all
    // there is.
    otherLabelCount: Math.max(0, allCohorts.length - 5),
    countedAsTyped: true,
  } : null;

  // ── RECENT PATIENTS, RECENT DOCUMENTS ──────────────────────────────────────────────────────────
  //
  // Recent = who THIS PRACTITIONER opened, from CPR-370's access log, which is what "rapid patient
  // reopening" means. Reading it back to its own author discloses nothing they did not already see.
  const { data: recentAccess, error: accessError } = can("patient.view")
    ? await admin.from("practice_access_log")
      // patient_id, not subject_id: 202 denormalised it precisely so this question is one index scan,
      // and it stays populated when the subject was an encounter or a document belonging to that person.
      .select("patient_id, occurred_at").eq("workspace_id", ctx.workspaceId)
      .eq("actor_id", ctx.userId).eq("subject_kind", "patient")
      .order("occurred_at", { ascending: false }).limit(60)
    : { data: null, error: null };
  if (accessError) throw new Error(`could not read the access log: ${accessError.message}`);

  const seenIds: string[] = [];
  for (const r of ((recentAccess ?? []) as any[])) {
    if (r.patient_id && !seenIds.includes(r.patient_id)) seenIds.push(r.patient_id);
    if (seenIds.length >= 5) break;
  }
  const { data: recentPatientRows } = seenIds.length
    ? await admin.from("practice_patient")
      .select("id, display_name, status").eq("workspace_id", ctx.workspaceId).in("id", seenIds)
    : { data: null };
  const patientById = new Map(((recentPatientRows ?? []) as any[]).map(p => [p.id, p]));
  const lastSeenAt = new Map<string, string>();
  for (const r of ((recentAccess ?? []) as any[]))
    if (r.patient_id && !lastSeenAt.has(r.patient_id)) lastSeenAt.set(r.patient_id, r.occurred_at);

  const recentPatients = can("patient.view")
    ? seenIds.map(id => ({
      id, name: patientById.get(id)?.display_name ?? "a record you can no longer open",
      status: patientById.get(id)?.status ?? null,
      openedAt: lastSeenAt.get(id) ?? null,
    })).filter(p => p.status)
    : null;

  const { data: recentDocuments } = can("document.view")
    ? await admin.from("practice_clinical_document")
      .select("id, title, doc_type, created_at, status")
      .eq("workspace_id", ctx.workspaceId).order("created_at", { ascending: false }).limit(5)
    : { data: null };

  // ── QUICK ACCESS (the spec's eight, in its order) ──────────────────────────────────────────────
  const quickAccess = [
    { key: "new_patient", label: "New Patient", href: "/practice/patients", capability: "patient.create" },
    { key: "walk_in", label: "Walk-in", href: "/practice/calendar", capability: "queue.manage" },
    { key: "start_encounter", label: "Start Encounter", href: "/practice/encounters", capability: "encounter.create" },
    { key: "book", label: "Book Appointment", href: "/practice/calendar", capability: "appointment.manage" },
    { key: "calendar", label: "Open Calendar", href: "/practice/calendar", capability: "practice.calendar.view" },
    { key: "letter", label: "Create Letter", href: "/practice/documents", capability: "document.author" },
    { key: "procedure", label: "New Procedure", href: "/practice/activity", capability: "procedure.record" },
    { key: "task", label: "Create Task", href: "/practice/tasks", capability: "task.manage" },
  ].filter(a => can(a.capability));

  return {
    today, timezone, readAtIso: readAt.toISOString(),
    practiceName: ws?.name ?? null,
    /** First name only, for the greeting. Null when this user has no profile row. */
    greetingName: (profile?.full_name ?? "").trim().split(/\s+/)[0] || null,
    clinic,
    timeline,
    queue: queue ? (queue as any[]).map(q => ({
      id: q.id, patientId: q.patient_id, patientName: q.patient_name, status: q.status,
      timeLabel: hhmm((Date.parse(q.entered_at) - dayStartMs) / 60000),
      waitingMinutes: Math.max(0, Math.round((readAt.getTime() - Date.parse(q.entered_at)) / 60000)),
    })) : null,
    weekLocations,
    followUpIntelligence,
    patientInsights,
    recentPatients,
    recentDocuments: ((recentDocuments ?? []) as any[]),
    quickAccess,
    refused: COMMAND_CENTRE_REFUSES,
  };
}
