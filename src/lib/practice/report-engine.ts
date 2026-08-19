import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { audit } from "@/lib/practice/audit";
import { resolvePeriod, practiceReport, diagnosisReport, type Period } from "@/lib/practice/reports";
import {
  intelRange, practiceIntelligenceWorkspace, referralIntelligence, outcomePicture,
} from "@/lib/practice/intelligence";
import { weekdayPattern } from "@/lib/practice/intelligence-constants";
import { financialIntelligence } from "@/lib/practice/financial-intelligence";
import { piV2Extras } from "@/lib/practice/pi-v2";
import { metricById } from "@/lib/practice/intelligence-registry";
import { reportTemplateById } from "@/lib/practice/report-templates";
import { portfolioPeriodSummary } from "@/lib/practice/portfolio";
import { sessionSummary, sessionClinicalActivity, windowClinicalActivity } from "@/lib/practice/activity";
import { formatMinor } from "@/lib/practice/billing-constants";

// CPR-PI-001 v2 s12 -- THE REPORT ENGINE.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// A REPORT IS THE SCREEN'S OWN NUMBERS WITH A DEFINITION BLOCK STAPLED ON. v2's line is explicit:
// "Reports use the same metric definitions as on-screen Intelligence" -- so every builder below calls
// the module that OWNS its figures (practiceIntelligenceWorkspace, diagnosisReport, outcomePicture,
// referralIntelligence, financialIntelligence, piV2Extras) and computes nothing of its own except two
// registered aggregates (treatments, investigations) that no screen owns yet. A report that ran its
// own SQL would eventually disagree with the screen it summarises, and the reader would trust
// whichever they saw second.
//
// EVERY REPORT CARRIES s12's DEFINITION BLOCK: practice, period, filters, generated timestamp and the
// registry entries behind its headline figures -- in the payload AND in the CSV, because a spreadsheet
// forwarded by email keeps its header while the screen that explained it stays behind.
//
// A MODULE THAT REFUSES STAYS REFUSED HERE. Permission filtering happens in the owning engines before
// aggregation (v2's rule); this file never widens a read, and an unavailable module renders as a
// section that says why rather than as a section full of zeroes.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/* eslint-disable @typescript-eslint/no-explicit-any */

export type EngineResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

const fail = (status: number, code: string, message: string) =>
  ({ ok: false as const, status, code, message });

export type ReportSection = {
  title: string;
  /** The formula/limitation sentence for this section's figures. Travels into the CSV. */
  note?: string;
  columns: string[];
  rows: (string | number)[][];
  /** Set when the owning module refused or failed; rows are empty and this says why. */
  unavailable?: string;
};

export type GeneratedReport = {
  definition: {
    templateId: string;
    templateName: string;
    practiceName: string;
    fromDay: string;
    toDay: string;
    periodLabel: string;
    /** s12: filters stated. No report filter exists yet, and the block says so instead of hiding the row. */
    filters: string;
    generatedAtIso: string;
    identified: boolean;
    metrics: { id: string; version: number; displayName: string; definition: string }[];
  };
  sections: ReportSection[];
};

/**
 * Investigations grouped by label with the reviewed share -- the ONE aggregate no screen owns, shared
 * with Ask Practice so the two can never disagree (registry: ask.investigations_ordered).
 */
/**
 * Treatments recorded in the period, by type and by label. `pi.treatments_recorded`.
 *
 * ⚠ EXTRACTED FROM THE REPORT BRANCH RATHER THAN COPIED BESIDE IT (CPR-PD-013, closing v2 s8). This
 * read lived inline in the `treatments_medications` template and nothing else could reach it, which is
 * why the Clinical screen had no Treatments panel while a report could produce one. Writing a second
 * read for the screen is how command-centre.ts and session.ts came to disagree about "overdue" on two
 * screens a click apart, each right against itself -- so the report branch below now calls THIS, and
 * the screen calls it too. One owner, one definition, and v2 s24's "reports share definitions with the
 * screens" is true by construction instead of by inspection.
 *
 * A ROW IS AN INTENTION, NOT AN ADMINISTRATION. The registry entry says so and so does every note this
 * feeds: practice_treatment records what the practitioner DECIDED.
 */
export async function treatmentsRecorded(admin: any, ctx: WorkspaceContext, period: Period): Promise<
  | { ok: true; byType: { label: string; total: number }[]; byLabel: { label: string; total: number }[]; total: number; truncated: boolean }
  | { ok: false; detail: string }
> {
  const { data, error } = await admin.from("practice_treatment")
    .select("treatment_type, label").eq("workspace_id", ctx.workspaceId)
    .gte("created_at", period.fromIso).lt("created_at", period.toIso).limit(1000);
  // ⚠ A FAILED READ IS NOT AN EMPTY PRACTICE. The registry's own nullHandling clause for this metric.
  if (error) return { ok: false, detail: error.message };
  const rows = (data ?? []) as any[];
  const byType = new Map<string, number>();
  const byLabel = new Map<string, number>();
  for (const r of rows) {
    byType.set(r.treatment_type, (byType.get(r.treatment_type) ?? 0) + 1);
    byLabel.set(r.label, (byLabel.get(r.label) ?? 0) + 1);
  }
  const sorted = (m: Map<string, number>) =>
    [...m.entries()].map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total);
  return { ok: true, byType: sorted(byType), byLabel: sorted(byLabel), total: rows.length, truncated: rows.length >= 1000 };
}

export async function investigationsOrdered(admin: any, ctx: WorkspaceContext, period: Period): Promise<
  | { ok: true; rows: { label: string; total: number; reviewed: number }[]; total: number; truncated: boolean }
  | { ok: false; detail: string }
> {
  const { data, error } = await admin.from("practice_encounter_investigation")
    .select("label, status").eq("workspace_id", ctx.workspaceId)
    .gte("requested_at", period.fromIso).lt("requested_at", period.toIso).limit(1000);
  if (error) return { ok: false, detail: error.message };
  const rows = (data ?? []) as any[];
  const byLabel = new Map<string, { total: number; reviewed: number }>();
  for (const r of rows) {
    const e = byLabel.get(r.label) ?? { total: 0, reviewed: 0 };
    e.total++;
    if (r.status === "reviewed") e.reviewed++;
    byLabel.set(r.label, e);
  }
  return {
    ok: true,
    rows: [...byLabel.entries()].map(([label, e]) => ({ label, ...e })).sort((a, b) => b.total - a.total),
    total: rows.length,
    truncated: rows.length >= 1000,
  };
}

// IntelSlice carries `total` -- and the first draft here read `count ?? value`, which silently zeroed
// EVERY distribution in every report. The same wrong field names were live on the frozen screens
// (AreasV2 rendered a dash for every slice); both were fixed together, which is the whole argument
// for one owner per shape. `unrecorded` is disclosed as its own row, per the type's own comment.
const dist = (d: any): { rows: (string | number)[][]; of: number | null } => ({
  rows: [
    ...((d?.slices ?? []) as any[]).map((s: any) => [s.label ?? s.key, s.total ?? 0]),
    ...((d?.unrecorded ?? 0) > 0 ? [["Unrecorded", d.unrecorded] as (string | number)[]] : []),
  ],
  of: d?.of ?? null,
});

const refusedSection = (title: string, m: any): ReportSection => ({
  title, columns: [], rows: [],
  unavailable: m?.unavailableReason ?? m?.reason ?? "this module could not be read",
});

export async function generateReport(admin: any, ctx: WorkspaceContext, args: {
  templateId: string; fromDay?: string; toDay?: string; days?: number;
  /** HFE-001 s8: the Session Report is ABOUT one session. Required by that template, ignored by the rest. */
  activityId?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<GeneratedReport>> {
  const tpl = reportTemplateById(args.templateId);
  if (!tpl) return fail(404, "UNKNOWN_TEMPLATE", `no report template is named "${args.templateId}"`);
  if (!hasCapability(ctx, "report.view"))
    return fail(403, "FORBIDDEN", "generating a report needs report.view");
  if (tpl.capability && !hasCapability(ctx, tpl.capability))
    return fail(403, "FORBIDDEN", `the ${tpl.name} report needs ${tpl.capability}`);

  const period = await resolvePeriod(admin, ctx.workspaceId, {
    fromDay: args.fromDay, toDay: args.toDay, days: args.days,
  });

  // The workspace composition root, computed only for templates whose figures live in it.
  const needsWorkspace = ["patient_demographics", "followup_completion", "consultation_types", "location_activity"];
  const range = await intelRange(admin, ctx.workspaceId, { fromDay: period.fromDay, toDay: period.toDay });
  const ws = needsWorkspace.includes(tpl.id)
    ? await practiceIntelligenceWorkspace(admin, ctx, { fromDay: period.fromDay, toDay: period.toDay })
    : null;

  let sections: ReportSection[] = [];

  if (tpl.id === "practice_summary") {
    const r = await practiceReport(admin, ctx, { fromDay: period.fromDay, toDay: period.toDay, correlationId: args.correlationId });
    sections = [
      {
        title: "Activity", columns: ["Measure", "Count", "Of"],
        rows: r.activity.lines.map(l => [l.label, l.value, l.of ?? ""]),
        note: "Counts and denominators only. Backlog figures are as-at-now and live on the analytics screen, not in a period report.",
      },
      {
        title: "Top recorded conditions", columns: ["Condition", "Records", "Patients"],
        rows: r.diagnoses.rows.slice(0, 10).map(d => [d.label, d.total, d.patients]),
        note: `Labels as typed -- two spellings of one condition are two rows. ${r.diagnoses.total} diagnosis records across ${r.diagnoses.distinctLabels} labels in the period.`,
      },
    ];
  } else if (tpl.id === "patient_demographics") {
    const p: any = ws!.modules.patients;
    if (!p.available) sections = [refusedSection("Demographics", p)];
    else {
      const d = p.data;
      const sex = dist(d.bySex);
      const age = dist(d.byAgeBand);
      sections = [
        {
          title: "Patients", columns: ["Measure", "Count"],
          rows: [
            ["Patients seen (completed consultations)", d.patientsSeen?.value ?? "unavailable"],
            ["Records created in the period", d.registered?.value ?? "unavailable"],
            ["New to the practice, of those seen",
              d.newToPractice?.numerator === null || d.newToPractice?.numerator === undefined
                ? "unavailable" : `${d.newToPractice.numerator} of ${d.newToPractice.denominator}`],
          ],
          note: d.newToPractice?.reason ?? undefined,
        },
        { title: "By sex", columns: ["Sex", "Count"], rows: sex.rows, note: sex.of !== null ? `of ${sex.of} patients` : undefined },
        { title: "By age band", columns: ["Age band", "Count"], rows: age.rows, note: age.of !== null ? `of ${age.of} patients` : undefined },
      ];
    }
  } else if (tpl.id === "conditions") {
    const d = await diagnosisReport(admin, ctx, period);
    sections = [{
      title: "Conditions recorded", columns: ["Condition", "Records", "Patients", "Confirmed"],
      rows: d.rows.map(r => [r.label, r.total, r.patients, r.confirmed]),
      note: `${d.total} records, ${d.distinctLabels} distinct labels, ${d.coded} carrying a code. As typed -- nothing forces a terminology, so no tidy total is invented.${d.truncated ? " List truncated to the top rows." : ""}`,
    }];
  } else if (tpl.id === "treatments_medications") {
    // The same engine the Clinical screen renders -- see treatmentsRecorded's header for why this
    // stopped being an inline read.
    const t = await treatmentsRecorded(admin, ctx, period);
    if (!t.ok) sections = [refusedSection("Treatments", { reason: `could not be read: ${t.detail}` })];
    else {
      sections = [
        {
          title: "By type", columns: ["Type", "Count", "Of"],
          rows: t.byType.map(r => [r.label, r.total, t.total]),
          note: "A treatment row is what the practitioner DECIDED -- an intention, never an administration record.",
        },
        {
          title: "Most recorded", columns: ["Label", "Count", "Of"],
          rows: t.byLabel.slice(0, 15).map(r => [r.label, r.total, t.total]),
          note: t.truncated ? "Read capped at 1000 rows -- the counts above are a floor, not a total." : undefined,
        },
      ];
    }
  } else if (tpl.id === "investigations") {
    const inv = await investigationsOrdered(admin, ctx, period);
    if (!inv.ok) sections = [refusedSection("Investigations", { reason: inv.detail })];
    else sections = [{
      title: "Investigations requested", columns: ["Label", "Requested", "Reviewed", "Of"],
      rows: inv.rows.map(r => [r.label, r.total, r.reviewed, inv.total]),
      note: `Requested is a practitioner's note of asking -- nothing here left this product, and requested is not resulted.${inv.truncated ? " Read capped at 1000 rows." : ""}`,
    }];
  } else if (tpl.id === "followup_completion") {
    const f: any = ws!.modules.followUps;
    const extras = await piV2Extras(admin, ctx, { fromDay: period.fromDay, toDay: period.toDay, todayDate: period.toDay });
    if (!f.available) sections = [refusedSection("Follow-ups", f)];
    else {
      const d = f.data;
      const kind = dist(d.byKind);
      sections = [
        {
          title: "The period's cohort", columns: ["Measure", "Count"],
          rows: [
            ["Raised in the period", d.completion?.denominator ?? "unavailable"],
            ["Of those, now completed", d.completion?.numerator ?? "unavailable"],
            ["Due in the period (open)", d.due?.value ?? "unavailable"],
            ["Overdue now, all periods", d.overdue?.value ?? "unavailable"],
          ],
          note: d.completion?.reason ?? d.overdue?.formula,
        },
        { title: "By kind", columns: ["Kind", "Count"], rows: kind.rows, note: kind.of !== null ? `of ${kind.of} follow-ups` : undefined },
        {
          title: "Median days from due to completion", columns: ["Median days", "Completed pairs"],
          rows: extras.available && extras.data
            ? [[extras.data.medianDaysToFollowUp.medianDays ?? "no valid pairs", extras.data.medianDaysToFollowUp.pairs]]
            : [],
          unavailable: extras.available ? undefined : extras.unavailableReason ?? undefined,
          note: "An early completion is a negative value and is kept -- clamping it would overstate how long follow-up takes.",
        },
      ];
    }
  } else if (tpl.id === "outcomes_monitoring") {
    const o = await outcomePicture(admin, ctx, period);
    sections = [
      {
        title: "Concluded follow-ups", columns: ["Measure", "Count"],
        rows: [
          ["Concluded in the period", o.followUps.concluded],
          ["Completed", o.followUps.completed],
          ["Missed", o.followUps.missed],
          ["Cancelled", o.followUps.cancelled],
          ["Completed without an outcome code", o.followUps.uncoded],
        ],
        note: "Outcome coding is optional, so the coded rows below UNDERSTATE what happened. The uncoded count is named so the table cannot look more complete than the records are.",
      },
      {
        title: "By recorded outcome", columns: ["Outcome", "Count"],
        rows: o.followUps.byOutcome.map((b: any) => [b.label, b.total]),
      },
      {
        title: "Procedures", columns: ["Measure", "Count"],
        rows: [
          ["Performed in the period", o.procedures.performed],
          ["With an outcome recorded", o.procedures.outcomesRecorded],
          ["With a complication recorded", o.procedures.withComplication],
        ],
        note: "Structured monitoring beyond these tables (serial measurements against targets) is not captured by this product, so it is absent here rather than invented.",
      },
    ];
  } else if (tpl.id === "referrals") {
    const r = await referralIntelligence(admin, ctx, range);
    if (!r.available || !r.data) sections = [refusedSection("Referrals", r)];
    else {
      const d: any = r.data;
      const st = dist(d.byStatus);
      sections = [
        {
          title: "Referrals recorded", columns: ["Measure", "Count"],
          rows: [
            ["Recorded in the period", d.made?.count ?? "unavailable"],
            ["Still awaiting news, all periods", d.awaitingNews?.count ?? "unavailable"],
            ["Distinct destinations", d.distinctDestinations ?? "unavailable"],
          ],
          note: d.limitation,
        },
        { title: "By status", columns: ["Status", "Count"], rows: st.rows, note: "Accepted and declined reflect only what somebody told the practitioner." },
        {
          title: "Destinations", columns: ["Referred to", "Referrals", "Patients"],
          rows: (d.destinations ?? []).map((x: any) => [x.label, x.total, x.patients]),
          note: "Exactly as typed -- a destination this product has never heard of is still a real destination.",
        },
      ];
    }
  } else if (tpl.id === "consultation_types") {
    const c: any = ws!.modules.clinicalActivity;
    if (!c.available) sections = [refusedSection("Consultations", c)];
    else {
      const d = c.data;
      const mode = dist(d.byMode);
      const path = dist(d.byPathway);
      const weekdays = weekdayPattern(d.trend?.buckets ?? []);
      sections = [
        { title: "By mode", columns: ["Mode", "Count"], rows: mode.rows, note: mode.of !== null ? `of ${mode.of} consultations` : undefined },
        { title: "By entry pathway", columns: ["Pathway", "Count"], rows: path.rows, note: path.of !== null ? `of ${path.of} consultations` : undefined },
        {
          title: "By weekday", columns: ["Weekday", "Count"],
          rows: weekdays.map(w => [w.label, w.count]),
          note: "Derived from the one shared daily trend, in the practice's own calendar.",
        },
      ];
    }
  } else if (tpl.id === "location_activity") {
    const loc: any = ws!.modules.locations;
    if (!loc.available) sections = [refusedSection("Locations", loc)];
    else {
      const e = loc.data.encounters;
      if (e.status !== "ok") sections = [refusedSection("Consultations by location", e)];
      else sections = [{
        title: "Consultations by location", columns: ["Location", "Count", "Of"],
        rows: [
          ...e.rows.map((r: any) => [r.name, r.total, e.of ?? ""]),
          ...(e.unattributed > 0 ? [["No location recorded", e.unattributed, e.of ?? ""]] : []),
        ] as (string | number)[][],
        note: "Counted through the located session each consultation ran inside. The unplaceable are disclosed, never dropped or redistributed.",
      }];
    }
  } else if (tpl.id === "professional_portfolio") {
    // s11's export: PERSON-SCOPED throughout (portfolio.ts owns the derivation), and the two honesty
    // sentences travel in the sections because a printed portfolio outlives the screen that framed it.
    const ps = await portfolioPeriodSummary(admin, ctx, { fromIso: period.fromIso, toIso: period.toIso });
    if (!ps.available || !ps.data) sections = [refusedSection("Portfolio", { reason: ps.reason })];
    else {
      const p = ps.data;
      sections = [
        {
          title: "Your recorded activity", columns: ["Measure", "Count"],
          rows: [
            ["Consultations you created", p.encounters],
            ["Distinct patients in those", p.distinctPatients],
            ["Procedures you performed", p.proceduresPerformed],
            ["Reflections you authored", p.reflections],
          ],
          note: "Person-scoped: work YOU recorded here, not the practice's whole record. Nothing in this document has been verified by this product.",
        },
        {
          title: "Teaching and CPD", columns: ["Measure", "Count"],
          rows: [
            ["Teaching or training sessions", p.teaching.sessions],
            ["Teaching minutes (where a duration was entered)", p.teaching.minutes],
            ["Sessions without a recorded duration", p.teaching.withoutDuration],
            ["CPD minutes (where entered)", p.cpd.minutes],
            ["Items carrying CPD minutes", p.cpd.contributingItems],
          ],
          note: "CPD counts only items on which minutes were entered -- a session without them contributes nothing and is never estimated.",
        },
        {
          title: "Your case mix", columns: ["Condition", "Records"],
          rows: p.caseMix.map(m => [m.label, m.total]),
          note: `Diagnoses you recorded, as typed.${p.truncated ? " A read hit its cap, so these are floors." : ""} s11's own rule: this document supports reflection, appraisal and credentialing -- it is not a claim of competence or quality.`,
        },
      ];
    }
  } else if (tpl.id === "session_report") {
    // HFE-001 s8: same governed contracts as Session Complete -- sessionSummary owns the timings and
    // metrics, sessionClinicalActivity owns the window counts. This builder only arranges them.
    if (!args.activityId)
      return fail(422, "SESSION_REQUIRED", "a Session Report is about one session -- reach it from Session Complete, which supplies it");
    const [sum, clin] = await Promise.all([
      sessionSummary(admin, ctx, args.activityId),
      sessionClinicalActivity(admin, ctx, args.activityId),
    ]);
    if (!sum.ok) return fail(sum.status, sum.code, sum.message);
    const s = sum.value;
    const sm: any = s.metrics.metrics;
    const mrow = (label: string, x: any): (string | number)[] =>
      [label, x?.value ?? `not shown -- ${x?.reason ?? "could not be read"}`];
    sections = [
      {
        title: "Session", columns: ["Field", "Value"],
        rows: [
          ["Activity", s.title || s.label], ["Date", s.planDate],
          ["Planned window", `${String(Math.floor(s.plannedStartMinute / 60)).padStart(2, "0")}:${String(s.plannedStartMinute % 60).padStart(2, "0")} to ${String(Math.floor(s.plannedEndMinute / 60)).padStart(2, "0")}:${String(s.plannedEndMinute % 60).padStart(2, "0")}`,],
          ["Actual start", s.startedAtIso], ["Actual end", s.endedAtIso ?? "still running"],
          ["Active minutes", s.activeMinutes ?? "pause ledger unreadable"],
          ["Paused minutes", s.pausedMinutes ?? "pause ledger unreadable"],
        ] as (string | number)[][],
      },
      {
        title: "Patients and activity", columns: ["Measure", "Value"],
        rows: [
          mrow("Booked", sm?.booked), mrow("Patients seen", sm?.patients_seen),
          mrow("Walk-ins", sm?.walk_in), mrow("No-shows", sm?.no_show),
          mrow("Average consult minutes", sm?.average_consult_time),
          mrow("Average wait minutes", sm?.average_wait_time),
        ],
        note: "Operational metrics render only where their governed definitions earned a figure -- an unreliable timestamp arrives as a reason, never a number (s8 metric safety).",
      },
      {
        title: "Clinical activity and continuity", columns: ["Measure", "Count"],
        rows: !clin.available || !clin.data ? [] : [
          ["Consultations started", clin.data.encountersStarted],
          ["Follow-ups created", clin.data.followUpsCreated],
          ["Investigations requested", clin.data.investigationsRequested],
          ["Procedures performed", clin.data.proceduresPerformed],
          ["Documents signed", clin.data.documentsSigned],
          ["Still unsigned from this session", clin.data.encountersUnsigned],
          ["Follow-ups raised, not yet booked", clin.data.followUpsNeedingBooking],
        ],
        unavailable: clin.available ? undefined : clin.reason ?? undefined,
        note: "Counted inside the session's own window by when each row was recorded.",
      },
    ];
    // s8's optional PERMISSION-CONTROLLED patient appendix: names only under patient.view.
    if (hasCapability(ctx, "patient.view")) {
      const { data: encs } = await admin.from("practice_encounter")
        .select("patient_id").eq("workspace_id", ctx.workspaceId)
        .gte("started_at", s.startedAtIso).lte("started_at", s.endedAtIso ?? new Date().toISOString())
        .not("patient_id", "is", null).limit(51);
      const ids = [...new Set(((encs ?? []) as any[]).map(e => e.patient_id))].slice(0, 50);
      if (ids.length > 0) {
        const { data: pats } = await admin.from("practice_patient").select("id, display_name").in("id", ids);
        sections.push({
          title: "Patient appendix", columns: ["Patient"],
          rows: ((pats ?? []) as any[]).map(p => [p.display_name]),
          note: "Included because you hold patient.view -- a caller without it gets this report WITHOUT this section, and the counts above are identical either way.",
        });
      }
    }
  } else if (tpl.id === "daily_practice_report") {
    // HFE-001 s8: every completed session of the day, aggregate person-scoped counts, outstanding.
    const { data: acts, error: actErr } = await admin.from("practice_activity")
      .select("title, activity_type, planned_start_minute, planned_end_minute, started_at, ended_at")
      .eq("workspace_id", ctx.workspaceId).eq("practitioner_id", ctx.userId)
      .eq("plan_date", period.fromDay).order("planned_start_minute").limit(100);
    const dayWindow = { fromIso: period.fromIso, toIso: period.toIso };
    const [own, clin] = await Promise.all([
      portfolioPeriodSummary(admin, ctx, dayWindow),
      windowClinicalActivity(admin, ctx, dayWindow),
    ]);
    sections = [
      {
        title: "Sessions and activities", columns: ["Activity", "Planned", "State"],
        rows: actErr ? [] : ((acts ?? []) as any[]).map(a => [
          a.title || a.activity_type,
          `${String(Math.floor(a.planned_start_minute / 60)).padStart(2, "0")}:${String(a.planned_start_minute % 60).padStart(2, "0")}`,
          a.ended_at ? "completed" : a.started_at ? "still running" : "never started",
        ]),
        unavailable: actErr ? `could not be read: ${actErr.message}` : undefined,
        note: "The day's planned activities and what became of each -- one lifecycle, the same rows Planner and Current Session use (s11).",
      },
      {
        title: "Your day in numbers", columns: ["Measure", "Count"],
        rows: !own.available || !own.data ? [] : [
          ["Consultations you created", own.data.encounters],
          ["Distinct patients", own.data.distinctPatients],
          ["Procedures you performed", own.data.proceduresPerformed],
          ["Reflections you authored", own.data.reflections],
        ],
        unavailable: own.available ? undefined : own.reason ?? undefined,
        note: "Person-scoped: your work, not the practice's whole day.",
      },
      {
        title: "Outstanding at day end", columns: ["Measure", "Count"],
        rows: !clin.available || !clin.data ? [] : [
          ["Unsigned consultations from today", clin.data.encountersUnsigned],
          ["Follow-ups raised today, not yet booked", clin.data.followUpsNeedingBooking],
        ],
        unavailable: clin.available ? undefined : clin.reason ?? undefined,
      },
    ];
  } else if (tpl.id === "financial_summary") {
    const fin = await financialIntelligence(admin, ctx, { fromDay: period.fromDay, toDay: period.toDay });
    if (!fin.available || !fin.data) sections = [refusedSection("Money", { reason: fin.unavailableReason })];
    else if (fin.data.byCurrency.length === 0)
      sections = [{ title: "Money", columns: [], rows: [], note: "No billing records exist in the period. The read succeeded -- this is a genuinely empty money picture." }];
    else sections = [{
      title: "Per currency", columns: ["Currency", "Charged", "Collected", "Received by practitioner", "Direct", "Settled"],
      rows: fin.data.byCurrency.map((c: any) => [
        c.currency,
        formatMinor(c.charged.minor, c.currency), formatMinor(c.collected.minor, c.currency),
        formatMinor(c.received.minor, c.currency),
        formatMinor(c.received.directMinor, c.currency), formatMinor(c.received.settledMinor, c.currency),
      ]),
      note: "Collected is not received: facility-collected money joins the received figure only through a settlement (CPR-PAY-001 s9).",
    }];
  }

  const report: GeneratedReport = {
    definition: {
      templateId: tpl.id, templateName: tpl.name, practiceName: ctx.workspaceName,
      fromDay: period.fromDay, toDay: period.toDay, periodLabel: period.label,
      filters: "none -- the whole practice, no cohort or location filter exists on reports yet",
      generatedAtIso: new Date().toISOString(),
      identified: hasCapability(ctx, "patient.view"),
      metrics: tpl.registryIds.map(id => {
        const m = metricById(id);
        return m
          ? { id, version: m.version, displayName: m.displayName, definition: m.definition }
          : { id, version: 0, displayName: id, definition: "MISSING FROM THE REGISTRY -- this is a defect, not a metric" };
      }),
    },
    sections,
  };

  // s12 "Data export"/"Report definition": generation itself is on the record, with the definitions used.
  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.report_generated",
    payload: {
      templateId: tpl.id, fromDay: period.fromDay, toDay: period.toDay,
      identified: report.definition.identified, metrics: tpl.registryIds,
      activityId: args.activityId ?? null,
    },
    correlationId: args.correlationId,
  });

  return { ok: true, data: report };
}

/** One CSV writer for every template -- the definition block first, because a forwarded spreadsheet
    keeps its header while the screen that explained it stays behind. */
export function reportCsv(r: GeneratedReport): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [
    `CompetenPractice report,${esc(r.definition.templateName)}`,
    `Practice,${esc(r.definition.practiceName)}`,
    `Period,${r.definition.fromDay} to ${r.definition.toDay}`,
    `Generated,${r.definition.generatedAtIso}`,
    `Filters,${esc(r.definition.filters)}`,
    `Identified,${r.definition.identified ? "yes -- treat as confidential" : "no -- counts without names"}`,
    "Not anonymised: a count of one identifies somebody to anyone who knows this practice.",
  ];
  if (r.definition.metrics.length > 0) {
    lines.push("Metric definitions:");
    for (const m of r.definition.metrics) lines.push(`${m.id} v${m.version},${esc(m.displayName)},${esc(m.definition)}`);
  }
  for (const s of r.sections) {
    lines.push("", esc(s.title));
    if (s.unavailable) lines.push(`Unavailable,${esc(s.unavailable)}`);
    else {
      if (s.columns.length > 0) lines.push(s.columns.map(esc).join(","));
      for (const row of s.rows) lines.push(row.map(esc).join(","));
    }
    if (s.note) lines.push(`Note,${esc(s.note)}`);
  }
  return lines.join("\n") + "\n";
}
