import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { workspaceClock, zonedDayRange } from "@/lib/practice/practice-time";
import { resolvePeriod, diagnosisReport, type Period } from "@/lib/practice/reports";
import { logAccess } from "@/lib/practice/privacy";
import { FOLLOW_UP_OUTCOMES } from "@/lib/practice/follow-up-constants";

// CPR-200 PRACTICE INTELLIGENCE.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// NO MIGRATION. THIS MODULE IS A COMPOSING LAYER, AND THAT IS THE FINDING, NOT A SHORTCUT.
//
// Everything CPR-200 needs already exists: encounters carry timestamps, diagnoses carry labels,
// procedures carry outcomes, follow-ups carry their taxonomy, and CPR-270's early slice already counts
// activity over a practice's own calendar. An intelligence layer with its own tables would be one
// keeping a second copy of the truth, and it would disagree with the first the day somebody backdated a
// record. The one genuinely new computation here is the time series, and a time series is a query.
//
// The same check CPR-320 made before building nine things that already existed.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// THE COMP IS ALMOST ENTIRELY RATES, AND ALMOST NONE OF THEM SURVIVE. Follow-up Rate 86.2%, Completed
// Notes 96.3%, Complication Rate 2.1%, Readmission 1.8%, Retention 78%, Data Quality 96%, and every
// tile carrying "↑12.4% vs last year". This product computes no rates -- CPR-270's doctrine, and the
// reason is unchanged: a percentage is where a small number hides, and a practice with nine follow-ups
// does not have an 86.2% anything.
//
// So every figure below is A COUNT AND ITS DENOMINATOR, and the comp's layout is kept around them. What
// cannot be counted at all is named in `notAvailable` rather than omitted, so a reader can tell an
// absent number from an unbuilt one.
//
// AND EVERY FIGURE IS THE LENGTH OF A LIST SOMEBODY CAN OPEN (CPR-300). A count with nothing behind it
// is a dashboard; one you can click into is a worklist.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Bucket = { day: string; total: number };

export type Unavailable = { key: string; label: string; reason: string };

/**
 * What this product cannot compute, and why.
 *
 * IN THE ENGINE RATHER THAN THE PAGE, so the API says it too and no client can quietly render one of
 * these as a zero. Each reason names the missing capability, not a vague "not available".
 */
export const NOT_AVAILABLE: Unavailable[] = [
  {
    key: "satisfaction", label: "Patient satisfaction",
    reason: "Nothing in this product asks a patient anything. There is no survey capability to measure.",
  },
  {
    key: "benchmarks", label: "Benchmarks against similar practices",
    reason: "Comparing needs practices this product has never seen. It holds one practice's records and cannot rank them against anybody.",
  },
  {
    key: "readmission", label: "Readmission",
    reason: "Readmission is an inpatient concept. This product records consultations and procedures, not admissions.",
  },
  {
    key: "encounter_time", label: "Average encounter time",
    reason: "What is recorded is how long a consultation stayed open before it was signed, which is a documentation habit rather than time spent with a patient. Reporting it as consultation length would be wrong in a way nobody could see.",
  },
  {
    key: "ai_insights", label: "AI-generated insights",
    reason: "Trend explanation, pattern detection and outlier identification are specified in CPR-210, which is not built.",
  },
];

/** Day buckets across a period, zero-filled so a quiet week reads as quiet rather than as missing. */
function emptyBuckets(period: Period): Bucket[] {
  const out: Bucket[] = [];
  const from = Date.parse(`${period.fromDay}T00:00:00Z`);
  const to = Date.parse(`${period.toDay}T00:00:00Z`);
  for (let t = from; t <= to; t += 86400000) out.push({ day: new Date(t).toISOString().slice(0, 10), total: 0 });
  return out;
}

/**
 * A count per day over a period, in the PRACTICE's calendar.
 *
 * Bucketed by the practice's local day, not by UTC -- the same reason CPR-300 fixed "today". A Kampala
 * evening clinic read in UTC lands on the following day and every weekday curve is wrong by three hours.
 */
async function dailyCounts(admin: any, workspaceId: string, table: string, column: string, period: Period, timezone: string, extra?: (q: any) => any): Promise<Bucket[]> {
  let q = admin.from(table).select(column)
    .eq("workspace_id", workspaceId).gte(column, period.fromIso).lt(column, period.toIso);
  if (extra) q = extra(q);
  const { data } = await q.limit(5000);

  const buckets = emptyBuckets(period);
  const index = new Map(buckets.map((b, i) => [b.day, i]));
  for (const row of ((data ?? []) as any[])) {
    const at = row[column];
    if (!at) continue;
    // Convert the instant into the practice's local day by asking the same formatter the clock uses.
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(at));
    const i = index.get(day);
    if (i !== undefined) buckets[i].total += 1;
  }
  return buckets;
}

/**
 * The encounter trend, with the period before it alongside.
 *
 * THE COMPARISON IS A COUNT AGAINST A COUNT -- "342 this period, 318 in the period before" -- never the
 * comp's "↑12.4%". The previous period IS recorded, so the comparison is real; it is the percentage that
 * was refused, exactly as CPR-330's dashboard does it.
 */
export async function encounterTrend(admin: any, ctx: WorkspaceContext, period: Period) {
  const { timezone } = await workspaceClock(admin, ctx.workspaceId);
  const spanMs = Date.parse(period.toIso) - Date.parse(period.fromIso);
  const prior: Period = {
    ...period,
    fromIso: new Date(Date.parse(period.fromIso) - spanMs).toISOString(),
    toIso: period.fromIso,
    fromDay: new Date(Date.parse(`${period.fromDay}T00:00:00Z`) - spanMs).toISOString().slice(0, 10),
    toDay: period.fromDay,
  };

  const [current, previous] = await Promise.all([
    dailyCounts(admin, ctx.workspaceId, "practice_encounter", "started_at", period, timezone),
    dailyCounts(admin, ctx.workspaceId, "practice_encounter", "started_at", prior, timezone),
  ]);

  const total = current.reduce((n, b) => n + b.total, 0);
  const priorTotal = previous.reduce((n, b) => n + b.total, 0);
  return {
    buckets: current,
    total,
    priorTotal,
    // The busiest day, because "which day is my clinic heaviest" is a question somebody acts on.
    busiestDay: current.slice().sort((a, b) => b.total - a.total)[0] ?? null,
    days: current.length,
  };
}

/**
 * Case mix: what this practice actually sees and does.
 *
 * Diagnoses come from CPR-270's existing report rather than a second query, so the two pages can never
 * disagree about the same count -- including its rule that labels are counted AS TYPED, because tidying
 * them would invent a coding nobody performed.
 */
export async function caseMix(admin: any, ctx: WorkspaceContext, period: Period) {
  const diagnoses = await diagnosisReport(admin, ctx, period, 10);

  const { data: procedures } = await admin.from("practice_procedure")
    .select("label, status, procedure_type_id")
    .eq("workspace_id", ctx.workspaceId)
    .gte("performed_at", period.fromIso).lt("performed_at", period.toIso).limit(1000);

  const byLabel = new Map<string, number>();
  for (const p of ((procedures ?? []) as any[])) byLabel.set(p.label, (byLabel.get(p.label) ?? 0) + 1);

  return {
    diagnoses,
    procedures: [...byLabel.entries()]
      .map(([label, total]) => ({ label, total }))
      .sort((a, b) => b.total - a.total).slice(0, 10),
    procedureTotal: ((procedures ?? []) as any[]).length,
  };
}

/**
 * How things turned out: follow-ups by their taxonomy, procedures by complication.
 *
 * COUNTS AND DENOMINATORS. The comp draws two donuts labelled 86.2% and 2.1%; over the numbers a real
 * practice will have in its first year, both are sentences that sound like measurements and are not.
 */
export async function outcomePicture(admin: any, ctx: WorkspaceContext, period: Period) {
  const [{ data: followUps }, { data: procedures }] = await Promise.all([
    admin.from("practice_follow_up")
      .select("status, outcome_code, closed_at").eq("workspace_id", ctx.workspaceId)
      .gte("closed_at", period.fromIso).lt("closed_at", period.toIso).limit(1000),
    admin.from("practice_procedure")
      .select("id, status").eq("workspace_id", ctx.workspaceId)
      .gte("performed_at", period.fromIso).lt("performed_at", period.toIso).limit(1000),
  ]);

  const fu = (followUps ?? []) as any[];
  const procs = ((procedures ?? []) as any[]).filter(p => p.status === "PERFORMED");

  const { data: outcomes } = procs.length
    ? await admin.from("practice_procedure_outcome")
      .select("procedure_id, outcome_type, severity").in("procedure_id", procs.map(p => p.id))
    : { data: [] };
  const outcomeRows = (outcomes ?? []) as any[];
  const withComplication = new Set(outcomeRows.filter(o => o.outcome_type === "complication").map(o => o.procedure_id));

  return {
    followUps: {
      concluded: fu.length,
      completed: fu.filter(f => f.status === "COMPLETED").length,
      missed: fu.filter(f => f.status === "MISSED").length,
      cancelled: fu.filter(f => f.status === "CANCELLED").length,
      byOutcome: FOLLOW_UP_OUTCOMES.map(([code, label]) => ({
        code, label, total: fu.filter(f => f.outcome_code === code).length,
      })),
      // Named, because a taxonomy nobody fills in makes the counts above look more complete than they are.
      uncoded: fu.filter(f => f.status === "COMPLETED" && !f.outcome_code).length,
    },
    procedures: {
      performed: procs.length,
      withComplication: withComplication.size,
      outcomesRecorded: new Set(outcomeRows.map(o => o.procedure_id)).size,
    },
  };
}

/**
 * The comp's "Data Quality 96% · Accuracy 94% · Timeliness 92%".
 *
 * THOSE ARE COMPOSITE SCORES WITH NO FORMULA, AND THEY ARE NOT HERE. What replaces them is better than a
 * score, because it is actionable: a list of records that are MISSING SOMETHING SPECIFIC, each one a
 * length somebody can open and fix. "96% complete" tells a practitioner nothing to do on a Tuesday
 * morning; "12 procedures have no outcome recorded" tells them exactly what.
 */
export async function completeness(admin: any, ctx: WorkspaceContext, period: Period) {
  const count = async (table: string, column: string, extra: (q: any) => any) => {
    const { count: n } = await extra(admin.from(table).select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).gte(column, period.fromIso).lt(column, period.toIso));
    return n ?? 0;
  };

  const [encounters, unsigned, procedures, noOutcome, consentGaps, diagnoses, uncoded] = await Promise.all([
    count("practice_encounter", "started_at", q => q),
    count("practice_encounter", "started_at", q => q.in("status", ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"])),
    count("practice_procedure", "performed_at", q => q.eq("status", "PERFORMED")),
    // A procedure with no outcome row at all. The join is done as a NOT IN over ids rather than a
    // negated embed, which PostgREST does not express reliably.
    (async () => {
      const { data: procs } = await admin.from("practice_procedure")
        .select("id").eq("workspace_id", ctx.workspaceId).eq("status", "PERFORMED")
        .gte("performed_at", period.fromIso).lt("performed_at", period.toIso).limit(1000);
      const ids = ((procs ?? []) as any[]).map(p => p.id);
      if (ids.length === 0) return 0;
      const { data: withOutcome } = await admin.from("practice_procedure_outcome")
        .select("procedure_id").in("procedure_id", ids);
      const has = new Set(((withOutcome ?? []) as any[]).map(o => o.procedure_id));
      return ids.filter(id => !has.has(id)).length;
    })(),
    count("practice_procedure", "performed_at", q => q.eq("consent_status", "not_recorded")),
    count("practice_diagnosis", "created_at", q => q),
    count("practice_diagnosis", "created_at", q => q.or("code.is.null,code.eq.")),
  ]);

  // EVERY LINE CARRIES ITS DENOMINATOR AND SOMEWHERE TO GO. A gap with no route to fix it is a reproach,
  // not a worklist.
  return [
    {
      key: "unsigned", label: "Consultations not yet signed", missing: unsigned, of: encounters,
      href: "/practice/encounters",
      note: "A consultation that is never signed is a record nobody has stood behind.",
    },
    {
      key: "no_outcome", label: "Procedures with no outcome recorded", missing: noOutcome, of: procedures,
      href: "/practice/activity",
      note: "An outcome is learned later; without it the complication count below is an undercount.",
    },
    {
      key: "consent", label: "Procedures with consent not recorded", missing: consentGaps, of: procedures,
      href: "/practice/activity",
      note: "Not recorded is not the same as not obtained, which is exactly why it is worth closing.",
    },
    {
      key: "uncoded", label: "Diagnoses with no code", missing: uncoded, of: diagnoses,
      href: "/practice/reports/analytics",
      note: "Nothing here forces a terminology, so two spellings of one condition count as two things.",
    },
  ].filter(r => r.of > 0);
}

/** Encounters and procedures per location, for the comp's location switcher. */
export async function byLocation(admin: any, ctx: WorkspaceContext, period: Period) {
  const { data: locations } = await admin.from("practice_location")
    .select("id, name, active").eq("workspace_id", ctx.workspaceId).order("name");
  const locs = (locations ?? []) as any[];
  // A single-location practice does not need a comparison of itself with itself.
  if (locs.length < 2) return { locations: [], comparable: false };

  const { data: appointments } = await admin.from("practice_appointment")
    .select("location_id").eq("workspace_id", ctx.workspaceId)
    .gte("scheduled_at", period.fromIso).lt("scheduled_at", period.toIso).limit(2000);

  const byId = new Map<string, number>();
  for (const a of ((appointments ?? []) as any[])) {
    if (!a.location_id) continue;
    byId.set(a.location_id, (byId.get(a.location_id) ?? 0) + 1);
  }
  return {
    comparable: true,
    locations: locs.map(l => ({ id: l.id, name: l.name, active: l.active, appointments: byId.get(l.id) ?? 0 })),
    unassigned: ((appointments ?? []) as any[]).filter(a => !a.location_id).length,
  };
}

/**
 * The whole picture, for one period.
 *
 * A READ OF THE WHOLE PRACTICE, so it is logged (CPR-370) -- and it inherits the same de-identification
 * rule as the reports page: a caller holding report.view but not patient.view gets counts and no names.
 * That combination is real rather than hypothetical, because migration 191 gives the OWNER report.view
 * and deliberately withholds patient.view.
 */
export async function practiceIntelligence(admin: any, ctx: WorkspaceContext, opts: {
  fromDay?: string; toDay?: string; days?: number;
} = {}) {
  const period = await resolvePeriod(admin, ctx.workspaceId, opts);

  const [trend, mix, outcomes, gaps, locations] = await Promise.all([
    encounterTrend(admin, ctx, period),
    caseMix(admin, ctx, period),
    outcomePicture(admin, ctx, period),
    completeness(admin, ctx, period),
    byLocation(admin, ctx, period),
  ]);

  await logAccess(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, subjectKind: "search",
    action: "view", detail: `Practice intelligence ${period.label}`,
    route: "/practice/intelligence",
  });

  return {
    period,
    identified: hasCapability(ctx, "patient.view"),
    trend, caseMix: mix, outcomes, completeness: gaps, locations,
    // Named, never omitted: a reader must be able to tell an absent number from an unbuilt one.
    notAvailable: NOT_AVAILABLE,
    // The doctrine, in the payload, so a client cannot render any of this as a rate.
    ratesComputed: false,
  };
}

/**
 * One practitioner's own growth over a period.
 *
 * SEPARATE FROM THE PRACTICE VIEW, and always the caller's own. CPR-150's portfolio already answers
 * "what have I done"; this adds only the shape over time, and it takes no parameter for whose -- a
 * professional-growth figure about somebody else is a performance review, which is a different product.
 */
export async function myGrowth(admin: any, ctx: WorkspaceContext, period: Period) {
  const { timezone } = await workspaceClock(admin, ctx.workspaceId);
  const { portfolioSummary } = await import("@/lib/practice/clinical-activity");

  const [portfolio, encounters, procedures] = await Promise.all([
    portfolioSummary(admin, ctx.workspaceId, ctx.userId, { fromDay: period.fromDay, toDay: period.toDay }),
    // `created_by`, NOT `opened_by` -- migration 194 names it that, and a filter on a column that does
    // not exist makes PostgREST error, `data` null, and the count silently zero. Checked, not assumed.
    dailyCounts(admin, ctx.workspaceId, "practice_encounter", "started_at", period, timezone,
      q => q.eq("created_by", ctx.userId)),
    dailyCounts(admin, ctx.workspaceId, "practice_procedure", "performed_at", period, timezone,
      q => q.eq("performed_by", ctx.userId)),
  ]);

  return {
    portfolio,
    encounters: encounters.reduce((n, b) => n + b.total, 0),
    procedures: procedures.reduce((n, b) => n + b.total, 0),
    // Distinct procedure kinds performed -- the honest version of the comp's "skills diversity", which
    // it draws as a score. A count of kinds is a fact; a diversity index is an opinion with arithmetic.
    distinctProcedures: portfolio.procedures.total,
  };
}

export { zonedDayRange };
