import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { workspaceClock, zonedDayRange } from "@/lib/practice/practice-time";
import { logAccess } from "@/lib/practice/privacy";

// CPR-330 REPORTS.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THIS PRODUCT DOES NOT COMPUTE RATES.
//
// A report is the last place in this product where the comps' invented dashboards could still get in --
// CPR-BUILD-001 s4 lists what they wanted: 2,348 encounters, 86.4 hours saved, 99.95% uptime. Replacing
// those with real percentages would not fix them, because a percentage is where a small number goes to
// hide. "67% attendance" over three appointments is a sentence that sounds like a measurement and is
// not one.
//
// So every figure here is A COUNT AND ITS DENOMINATOR, in that form: "4 did not attend, of 37 booked".
// The reader divides if they want to. CPR-150 took this position for complication counts; this module
// takes it for everything, and there is no percentage anywhere in the file.
//
// NO BENCHMARKS, NO TARGETS, NO TRENDS AGAINST EXPECTATION. "Better than last month" needs a claim about
// what last month should have been, and "in the top quartile" needs practices this product has never
// seen. Both are available to invent and neither is available to know.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// A REPORT IS A READ OF THE WHOLE PRACTICE, so it is logged (CPR-370) -- and it obeys the same
// de-identification rule as the access review: a caller holding report.view but not patient.view sees
// counts and no names. That combination is real rather than hypothetical, because migration 191 gives
// the OWNER report.view and deliberately withholds patient.view.
//
// NO MIGRATION. Every number here is derived from tables that already exist, which is the point: a
// reporting layer that needed its own tables would be one keeping a second copy of the truth.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Period = { fromIso: string; toIso: string; fromDay: string; toDay: string; label: string };

/**
 * A reporting window, in the PRACTICE's calendar rather than the server's -- the same reason CPR-300
 * fixed "today". A month boundary read in UTC puts the first and last few hours of a Kampala month in
 * the wrong month, which is exactly where a monthly count goes quietly wrong.
 */
export async function resolvePeriod(admin: any, workspaceId: string, opts: {
  fromDay?: string; toDay?: string; days?: number;
} = {}): Promise<Period> {
  const { timezone, today } = await workspaceClock(admin, workspaceId);
  const toDay = opts.toDay ?? today;
  const fromDay = opts.fromDay ?? (() => {
    const d = new Date(`${toDay}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((opts.days ?? 30) - 1));
    return d.toISOString().slice(0, 10);
  })();

  // Half-open across the whole window: the start of the first day to the start of the day after the
  // last, so nothing falls between two days.
  const start = zonedDayRange(fromDay, timezone).startIso;
  const end = zonedDayRange(toDay, timezone).endIso;
  return { fromIso: start, toIso: end, fromDay, toDay, label: `${fromDay} to ${toDay}` };
}

const countIn = async (admin: any, table: string, workspaceId: string, column: string, period: Period, extra?: (q: any) => any) => {
  let q = admin.from(table).select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId).gte(column, period.fromIso).lt(column, period.toIso);
  if (extra) q = extra(q);
  const { count } = await q;
  return count ?? 0;
};

/**
 * What this practice did in a period. Counts only -- every one of them the size of a list somebody
 * could open, in the CPR-300 sense.
 */
export async function activityReport(admin: any, ctx: WorkspaceContext, period: Period) {
  const ws = ctx.workspaceId;

  const [
    patientsRegistered, appointmentsBooked, attended, didNotAttend, cancelled,
    encountersStarted, encountersSigned, documentsIssued, proceduresPerformed,
    followUpsRaised, followUpsCompleted, followUpsMissed, incomingReceived,
  ] = await Promise.all([
    countIn(admin, "practice_patient", ws, "created_at", period),
    countIn(admin, "practice_appointment", ws, "scheduled_at", period),
    countIn(admin, "practice_appointment", ws, "scheduled_at", period, q => q.in("status", ["ARRIVED", "COMPLETED"])),
    countIn(admin, "practice_appointment", ws, "scheduled_at", period, q => q.eq("status", "NO_SHOW")),
    countIn(admin, "practice_appointment", ws, "scheduled_at", period, q => q.eq("status", "CANCELLED")),
    countIn(admin, "practice_encounter", ws, "started_at", period),
    countIn(admin, "practice_encounter", ws, "signed_at", period, q => q.not("signed_at", "is", null)),
    countIn(admin, "practice_clinical_document", ws, "signed_at", period, q => q.not("signed_at", "is", null)),
    countIn(admin, "practice_procedure", ws, "performed_at", period),
    countIn(admin, "practice_follow_up", ws, "created_at", period),
    countIn(admin, "practice_follow_up", ws, "closed_at", period, q => q.eq("status", "COMPLETED")),
    countIn(admin, "practice_follow_up", ws, "closed_at", period, q => q.eq("status", "MISSED")),
    countIn(admin, "practice_incoming_document", ws, "created_at", period),
  ]);

  // EVERY PAIR CARRIES ITS DENOMINATOR. There is no ratio here and no percentage -- see the header.
  return {
    period,
    lines: [
      { label: "Patients registered", value: patientsRegistered, of: null, href: "/practice/patients" },
      { label: "Appointments booked", value: appointmentsBooked, of: null, href: "/practice/calendar" },
      { label: "Attended", value: attended, of: appointmentsBooked, href: "/practice/calendar" },
      { label: "Did not attend", value: didNotAttend, of: appointmentsBooked, href: "/practice/calendar" },
      { label: "Cancelled", value: cancelled, of: appointmentsBooked, href: "/practice/calendar" },
      { label: "Consultations started", value: encountersStarted, of: null, href: "/practice/encounters" },
      { label: "Consultations signed", value: encountersSigned, of: encountersStarted, href: "/practice/encounters" },
      { label: "Documents issued", value: documentsIssued, of: null, href: "/practice/documents" },
      { label: "Procedures performed", value: proceduresPerformed, of: null, href: "/practice/encounters" },
      { label: "Follow-ups raised", value: followUpsRaised, of: null, href: "/practice/follow-ups" },
      { label: "Follow-ups completed", value: followUpsCompleted, of: null, href: "/practice/follow-ups" },
      { label: "Follow-ups marked missed", value: followUpsMissed, of: null, href: "/practice/follow-ups" },
      { label: "Documents received", value: incomingReceived, of: null, href: "/practice/inbox" },
    ],
  };
}

/**
 * What this practice actually sees. The one report a practitioner asks for unprompted, and the one that
 * needs the least invention: a count of diagnosis labels over a period.
 *
 * LABELS ARE NOT CODED, and the report says so. `practice_diagnosis.code` exists and is usually empty,
 * because nothing in this product forces a terminology -- so "Malaria" and "malaria" are two rows here.
 * Presenting a tidy total across them would be inventing a coding that nobody performed.
 */
export async function diagnosisReport(admin: any, ctx: WorkspaceContext, period: Period, limit = 25) {
  const { data } = await admin.from("practice_diagnosis")
    .select("label, code, certainty, patient_id")
    .eq("workspace_id", ctx.workspaceId)
    .gte("created_at", period.fromIso).lt("created_at", period.toIso);
  const rows = (data ?? []) as any[];

  const byLabel = new Map<string, { label: string; code: string | null; total: number; patients: Set<string>; confirmed: number }>();
  for (const r of rows) {
    const key = String(r.label);
    const e = byLabel.get(key) ?? { label: key, code: r.code ?? null, total: 0, patients: new Set<string>(), confirmed: 0 };
    e.total++;
    if (r.patient_id) e.patients.add(r.patient_id);
    if (r.certainty === "confirmed") e.confirmed++;
    byLabel.set(key, e);
  }

  return {
    period,
    total: rows.length,
    distinctLabels: byLabel.size,
    coded: rows.filter(r => r.code).length,
    rows: [...byLabel.values()]
      .map(e => ({ label: e.label, code: e.code, total: e.total, patients: e.patients.size, confirmed: e.confirmed }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit),
    truncated: byLabel.size > limit,
  };
}

/**
 * The clinical backlog, right now rather than over a period -- because "how far behind am I" is a
 * question about the present, and averaging it over a month is how a backlog stops looking urgent.
 *
 * AGED, NOT JUST COUNTED. An encounter unsigned for an hour and one unsigned for three weeks are
 * different problems, and a single number treats them as the same one.
 */
export async function backlogReport(admin: any, ctx: WorkspaceContext) {
  const ws = ctx.workspaceId;
  const now = Date.now();
  const bucket = (iso: string | null) => {
    if (!iso) return "unknown";
    const days = Math.floor((now - Date.parse(iso)) / 86400000);
    return days >= 30 ? "30+ days" : days >= 7 ? "7-29 days" : days >= 1 ? "1-6 days" : "today";
  };

  const [{ data: unsigned }, { data: unreviewed }, { data: overdueFollowUps }, { data: openTasks }] = await Promise.all([
    admin.from("practice_encounter").select("id, completed_at, started_at").eq("workspace_id", ws).eq("status", "COMPLETED"),
    admin.from("practice_incoming_document").select("id, received_on, priority").eq("workspace_id", ws).eq("status", "RECEIVED"),
    admin.from("practice_follow_up").select("id, due_on").eq("workspace_id", ws).eq("status", "OPEN"),
    admin.from("practice_task").select("id, due_on").eq("workspace_id", ws).in("status", ["OPEN", "IN_PROGRESS", "BLOCKED"]),
  ]);

  const age = (rows: any[], column: string) => {
    const buckets: Record<string, number> = { "today": 0, "1-6 days": 0, "7-29 days": 0, "30+ days": 0, "unknown": 0 };
    for (const r of rows) buckets[bucket(r[column])]++;
    return buckets;
  };

  const { today } = await workspaceClock(admin, ws);
  return {
    unsignedEncounters: { total: (unsigned ?? []).length, byAge: age((unsigned ?? []) as any[], "completed_at") },
    unreviewedIncoming: {
      total: (unreviewed ?? []).length,
      urgent: ((unreviewed ?? []) as any[]).filter(r => r.priority === "urgent").length,
      byAge: age(((unreviewed ?? []) as any[]).map(r => ({ received_on: `${r.received_on}T00:00:00.000Z` })), "received_on"),
    },
    overdueFollowUps: ((overdueFollowUps ?? []) as any[]).filter(f => f.due_on < today).length,
    openFollowUps: (overdueFollowUps ?? []).length,
    overdueTasks: ((openTasks ?? []) as any[]).filter(t => t.due_on && t.due_on < today).length,
    openTasks: (openTasks ?? []).length,
  };
}

/**
 * Everything a report page needs, with the CPR-370 read logged once.
 *
 * `identified` follows the access-review rule: a caller with report.view but not patient.view gets the
 * counts and none of the names. Migration 191 makes that combination real -- the owner has exactly it.
 */
export async function practiceReport(admin: any, ctx: WorkspaceContext, opts: {
  fromDay?: string; toDay?: string; days?: number; correlationId?: string;
} = {}) {
  const period = await resolvePeriod(admin, ctx.workspaceId, opts);
  const [activity, diagnoses, backlog] = await Promise.all([
    activityReport(admin, ctx, period),
    diagnosisReport(admin, ctx, period),
    backlogReport(admin, ctx),
  ]);

  await logAccess(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, subjectKind: "search", action: "search",
    route: "/practice/reports", detail: `report ${period.label}`, correlationId: opts.correlationId,
  });

  return {
    period,
    identified: hasCapability(ctx, "patient.view"),
    activity, diagnoses, backlog,
    // Stated on the page rather than only in this file: a reader deserves to know what the numbers
    // deliberately are not.
    caveats: [
      "Counts and denominators only. This product computes no rates, because a percentage over a small number reads as a measurement and is not one.",
      "No benchmarks and no targets: there is nothing to compare a practice against that this product has actually seen.",
      "Diagnosis labels are counted as they were typed. Nothing forces a terminology here, so two spellings of one condition are two rows.",
      "The period runs on this practice's calendar, not the server's.",
    ],
  };
}

/**
 * The activity report as CSV, for the practitioner who needs it in a spreadsheet.
 *
 * NOT ANONYMISED, AND IT SAYS SO. This is aggregate rather than identifiable, but "aggregate" is not
 * "safe" -- a count of one in a small practice identifies somebody to anyone who knows the practice.
 * The file carries that sentence rather than letting a reader assume a protection nobody applied.
 */
export function activityCsv(report: Awaited<ReturnType<typeof practiceReport>>): string {
  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [
    `# Competen Practice activity report`,
    `# Period,${report.period.fromDay} to ${report.period.toDay}`,
    `# Generated,${new Date().toISOString()}`,
    `# Note,${escape("Counts and denominators only; no rates and no benchmarks. Aggregate but NOT anonymised -- a count of one identifies somebody to anyone who knows this practice.")}`,
    "",
    "Measure,Count,Of",
    ...report.activity.lines.map(l => [escape(l.label), l.value, l.of ?? ""].join(",")),
    "",
    "Diagnosis,Count,Patients,Confirmed",
    ...report.diagnoses.rows.map(r => [escape(r.label), r.total, r.patients, r.confirmed].join(",")),
  ];
  return lines.join("\n");
}
