import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { practiceToday, workspaceClock, zonedDayRange } from "@/lib/practice/practice-time";
import { resolvePeriod, diagnosisReport, type Period } from "@/lib/practice/reports";
import { logAccess } from "@/lib/practice/privacy";
import { FOLLOW_UP_OUTCOMES } from "@/lib/practice/follow-up-constants";
import {
  practiceMetrics, metricScope,
  bookedAppointments, completedEncounters, patientsSeen, cancelledAppointments, noShows, followUpsDue,
  type Metric, type MetricKey, type MetricScope, type PracticeMetrics,
} from "@/lib/practice/metrics";
// CPR-PI-001/002/003. A leaf module with no imports of its own, so nothing it carries can drag a
// server-only dependency into a client component -- see the header of intelligence-constants.ts.
import {
  INACTIVE_AFTER_DAYS, LOST_TO_FOLLOW_UP_AFTER_DAYS, REFUSED_PATIENT_STATES,
  ALERT_SEVERITIES, SEVERITY_NOT_CLASSIFIED, PIE_NOT_BUILDABLE,
  type RefusedState, type UnbuildableModule,
} from "@/lib/practice/intelligence-constants";

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
      .select("procedure_id, outcome_type, severity").eq("workspace_id", ctx.workspaceId).in("procedure_id", procs.map(p => p.id))
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
        .select("procedure_id").eq("workspace_id", ctx.workspaceId).in("procedure_id", ids);
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

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-V5-003 -- THE PRACTICE INTELLIGENCE WORKSPACE
// ════════════════════════════════════════════════════════════════════════════════════════════════════
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THIS SECTION COMPUTES NO METRIC OF ITS OWN, AND THAT IS THE WHOLE DESIGN.
//
// CPR-V5-003 acceptance: "Metrics derived from operational engines. No duplicated business logic."
// CPR-CORE-003 acceptance: "No duplicate analytics engine."
// CPR-CORE-001 s16: "No widget independently calculates a conflicting version of a shared metric."
//
// src/lib/practice/metrics.ts already owns CORE-001 section 8's twelve definitions, each with its
// formula and its table.column sources travelling beside the number. Every figure this workspace shows
// that section 8 names is READ FROM THERE -- including the previous period's, which is obtained by
// calling the SAME owning function over a different scope rather than by writing a second query that
// would drift from the first the day somebody changed an exclusion.
//
// What is left is legitimately new: a shape over time, a breakdown by location, a distribution across a
// column section 8 never mentions. Those are computed here. A figure section 8 already owns is not.
//
// THE TEST APPLIED TO EVERY NUMBER BELOW: could metrics.ts answer this? If yes, it did.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// READ ONLY. CPR-V5-003: "No direct data entry." Nothing in this section inserts, updates or deletes --
// including the access log. CORE-001 s13 requires a read of the whole practice to be logged, and that
// remains true; the logging belongs to the ROUTE that serves this payload (as practiceIntelligence above
// does it), not to an engine that promises to write nothing.
//
// ⚠ EVERY TABLE, COLUMN AND CAPABILITY BELOW WAS READ OUT OF supabase/migrations, not remembered. A wrong
// column name does not fail typecheck: PostgREST errors at runtime and the honest failure path turns that
// into "could not be read". The migration each source came from is named above its module.

// ── THE FOUR DOCTRINES, RESTATED BECAUSE THIS SECTION OBEYS ALL OF THEM ───────────────────────────────
//
//  1. A FAILED READ IS NEVER A ZERO. Every `.error` is checked. A module that could not read reports the
//     database's own message and a null, never a plausible nought.
//
//  2. A TRUNCATED PAGE IS NEVER A DISTRIBUTION. PostgREST caps an unbounded select at 1000 rows. Every
//     row-scan carries an EXPLICIT limit so a full page is DETECTABLE, and a detectable overflow is
//     reported as not-knowable rather than charted as if it were the whole period.
//
//  3. COUNTS AND DENOMINATORS, NOT RATES. A percentage is where a small number hides: "follow-up
//     completion 75%" is the same sentence whether it is 3 of 4 or 750 of 1000, and only one of those is
//     worth changing a clinic over. Where a proportion is genuinely the answer it is returned as its
//     NUMERATOR AND DENOMINATOR so a screen can render "72 of 96". No field below holds a percentage.
//
//  4. NO COMPARISON WITHOUT A REAL PRIOR PERIOD. s8 on Clinic Delay: "No comparison shown until enough
//     valid observations exist." Applied here to every period-over-period figure -- see intelRange.
//
// ⚠ THE PLUMBING BELOW (intelRows/intelCount/intelIn) RESTATES metrics.ts's THREE READ RULES BECAUSE
// metrics.ts KEEPS ITS OWN readRows/countRows/readIn PRIVATE. That is duplicated PLUMBING, not duplicated
// BUSINESS LOGIC -- no metric definition, exclusion or formula is repeated -- but the better fix is to
// export those three helpers from metrics.ts and delete these. That is an edit to an existing file and
// is reported rather than made.

/** Far above a real reporting period and deliberately below nothing: reaching it is reported, never charted. */
const INTEL_ROW_CAP = 2000;
/** Keeps an `.in()` filter's URL short enough to survive proxies. A 500-uuid IN list fails like an empty result. */
const INTEL_IN_CHUNK = 100;

/**
 * Both windows together must carry this many records before a difference between them is reported.
 *
 * Doctrine 4, given a number. Below ten records across two periods the difference between them is one
 * cancelled afternoon, and a workspace whose whole purpose is longitudinal review must not teach a
 * practitioner to read noise as a trend. Ten rather than section 8's five for Clinic Delay because a
 * comparison spends its observations twice -- once on each side.
 */
export const MIN_OBSERVATIONS_FOR_COMPARISON = 10;

/**
 * Valid observations required before a median duration is reported. The same reasoning, and the same
 * number, as metrics.ts's MIN_OBSERVATIONS_FOR_DELAY -- restated rather than imported because it governs
 * a different quantity (time-to-sign) and coupling the two would make one change move the other silently.
 */
export const MIN_OBSERVATIONS_FOR_MEDIAN = 5;

// ── CAPABILITIES ─────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ STRINGS COMPARED AGAINST practice_role_capabilities. Inventing a plausible one costs nothing at
// compile time and silently disables the module at runtime; it has shipped in this codebase twice. Each
// code below was read out of the migration that inserts it, not remembered:
//
//   report.view            191 -- practice_owner, practitioner, billing_reporting, read_only_auditor
//   patient.list           191 -- practitioner, practice_assistant
//   patient.view           191 (practitioner), 193 (practice_assistant)
//   encounter.list         191 (practitioner), 194 (practice_assistant)
//   followup.view          191 (practitioner), 196 (practice_assistant)
//   practice.calendar.view 191 -- practitioner, practice_assistant
//   document.view          195 -- practitioner
//   inbox.review           200 -- practitioner ONLY
//   procedure.record       197 -- practitioner
//   procedure.manage       197 -- practitioner, practice_owner
//
// ⚠ THE OWNER HOLDS report.view AND ALMOST NOTHING ELSE. Migration 191 gives practice_owner report.view
// but withholds patient.view, encounter.list and followup.view -- so the workspace's own proprietor sees
// the shell of this page and "you may not see this" inside most of it. That is the intended behaviour and
// not a bug to route around: the difference between "no procedures were performed" and "you may not see
// which procedures were performed" is the difference this whole engine exists to preserve.
const CAP_REPORT = "report.view";
const CAP_PATIENT_LIST = "patient.list";
const CAP_PATIENT_VIEW = "patient.view";
const CAP_ENCOUNTER_LIST = "encounter.list";
const CAP_FOLLOWUP_VIEW = "followup.view";
const CAP_CALENDAR_VIEW = "practice.calendar.view";
const CAP_DOCUMENT_VIEW = "document.view";
const CAP_INBOX_REVIEW = "inbox.review";
const CAP_PROCEDURE_RECORD = "procedure.record";
const CAP_PROCEDURE_MANAGE = "procedure.manage";

/** Exported so a harness can prove each one EXISTS in practice_role_capabilities rather than re-typing it. */
export const INTELLIGENCE_CAPABILITIES = [
  CAP_REPORT, CAP_PATIENT_LIST, CAP_PATIENT_VIEW, CAP_ENCOUNTER_LIST, CAP_FOLLOWUP_VIEW,
  CAP_CALENDAR_VIEW, CAP_DOCUMENT_VIEW, CAP_INBOX_REVIEW, CAP_PROCEDURE_RECORD, CAP_PROCEDURE_MANAGE,
];

// ── RESULT SHAPES ────────────────────────────────────────────────────────────────────────────────────

export type IntelStatus =
  /** The figure stands. */
  | "ok"
  /** Read fine; there is no honest figure. No denominator, no prior period, too few observations. */
  | "unknowable"
  /** A read failed or came back truncated. NOT a zero. */
  | "unreadable"
  /** The caller may not see the domain this comes from. NOT a zero either. */
  | "not_permitted";

/** One slice of a distribution. `total` is a count; there is deliberately no share, fraction or percent. */
export type IntelSlice = { key: string; label: string; total: number };

/**
 * A distribution over a column, with what it was computed from and what it could not classify.
 *
 * `unrecorded` is disclosed rather than folded into "other": a column nobody fills in makes every slice
 * above it look more complete than it is, and that is exactly the thing a reader must be able to see.
 */
export type IntelDistribution = {
  key: string;
  label: string;
  status: IntelStatus;
  reason: string | null;
  slices: IntelSlice[];
  /** Rows the distribution was computed over. Null when nothing was read. */
  of: number | null;
  unrecorded: number;
  formula: string;
  sources: string[];
};

/**
 * A proportion, as a numerator and a denominator and NOTHING ELSE.
 *
 * Doctrine 3. There is no `rate`, no `percent` and no `share` field, on purpose: a client that wanted one
 * would have to compute it, at which point the decision to show "75%" instead of "72 of 96" is a visible
 * choice somebody made rather than a default this engine handed over.
 */
export type IntelProportion = {
  key: string;
  label: string;
  numerator: number | null;
  denominator: number | null;
  status: IntelStatus;
  reason: string | null;
  /** What the figure does NOT account for -- censoring, late arrivals, records not yet due. */
  caveat: string | null;
  formula: string;
  sources: string[];
};

/**
 * A period-over-period comparison, refused unless it is real.
 *
 * The comp draws "128 Encounters, up 18% vs previous 30 days". Two things are wrong with that tile and
 * both are fixed here:
 *
 *   THE PERCENTAGE IS GONE. `change` is a signed COUNT -- "128, and 109 in the 30 days before" -- because
 *   a percentage of a small base is a number that moves violently for reasons nobody acted on.
 *
 *   THE COMPARISON ITSELF IS EARNED, NOT ASSUMED. A practice three weeks old has no "previous 30 days";
 *   showing it as a fall from zero would tell a new practitioner their clinic was collapsing on the day
 *   they opened it. `prior` is null with a reason whenever the window did not exist, could not be read,
 *   or holds too few records for the difference to mean anything.
 */
export type IntelComparison = {
  key: string;
  label: string;
  current: number | null;
  prior: number | null;
  /** current - prior, in the metric's own unit. Never a percentage. Null whenever `prior` is null. */
  change: number | null;
  status: IntelStatus;
  reason: string | null;
  priorFromDay: string | null;
  priorToDay: string | null;
  formula: string;
  sources: string[];
};

/**
 * One module of the workspace.
 *
 * `available: false` with a reason is a FIRST-CLASS OUTCOME, not an error path. CORE-001 s14 on empty
 * states: "Do not show misleading zero comparisons." A module whose store does not exist returns nothing
 * and says which store, so a reader can tell an absent number from an unbuilt one -- the same rule the
 * NOT_AVAILABLE list above follows.
 */
export type IntelModule<T> = {
  key: string;
  label: string;
  available: boolean;
  /** Names the missing store, column or capability. Null when the module is available. */
  unavailableReason: string | null;
  data: T | null;
  /** table.column identifiers everything in `data` was read from. */
  sources: string[];
  /**
   * Reads that failed, overflowed, or whose reliability is limited -- so a screen can retry the part that
   * broke (s14 partial failure) or disclose the limit. A non-empty list is NOT the same as an unavailable
   * module: most of `data` may still stand.
   */
  problems: string[];
};

const intelModule = <T>(
  key: string, label: string, data: T, sources: string[], problems: string[] = [],
): IntelModule<T> => ({ key, label, available: true, unavailableReason: null, data, sources, problems });

const intelUnavailable = <T>(
  key: string, label: string, reason: string, sources: string[] = [],
): IntelModule<T> => ({ key, label, available: false, unavailableReason: reason, data: null, sources, problems: [] });

// ── PLUMBING ─────────────────────────────────────────────────────────────────────────────────────────

type IntelRead = { rows: any[]; error: string | null; overflowed: boolean };

/** A bounded row read. Reaching the bound is an OVERFLOW: reported, never charted as the whole period. */
async function intelRows(query: any, cap = INTEL_ROW_CAP): Promise<IntelRead> {
  const { data, error } = await query.limit(cap);
  if (error) return { rows: [], error: error.message ?? "read failed", overflowed: false };
  const rows = (data ?? []) as any[];
  return { rows, error: null, overflowed: rows.length >= cap };
}

/** A head+count read. The count is computed server-side and is not subject to the 1000-row page cap. */
async function intelCount(query: any): Promise<{ count: number | null; error: string | null }> {
  const { count, error } = await query;
  if (error) return { count: null, error: error.message ?? "read failed" };
  // ⚠ A null count with no error is NOT a zero. PostgREST returns null when the count was not computed --
  // a missing table among them -- and calling that nought is the precise bug this engine refuses.
  return { count: count ?? null, error: null };
}

/** `.in()` in survivable batches. One failed batch fails the whole read: a partial join is a wrong answer. */
async function intelIn(
  admin: any, table: string, select: string, workspaceId: string, column: string, values: string[],
): Promise<IntelRead> {
  const out: any[] = [];
  for (let i = 0; i < values.length; i += INTEL_IN_CHUNK) {
    const { data, error } = await admin.from(table).select(select)
      .eq("workspace_id", workspaceId).in(column, values.slice(i, i + INTEL_IN_CHUNK)).limit(INTEL_ROW_CAP);
    if (error) return { rows: [], error: error.message ?? "read failed", overflowed: false };
    const rows = (data ?? []) as any[];
    if (rows.length >= INTEL_ROW_CAP) return { rows: [], error: null, overflowed: true };
    out.push(...rows);
  }
  return { rows: out, error: null, overflowed: false };
}

const overflowNote = (what: string) =>
  `more than ${INTEL_ROW_CAP} ${what} in this period, so what came back is a page rather than the period`;

const parseAt = (iso: unknown): number | null => {
  if (typeof iso !== "string" || !iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** Median, stated rather than assumed -- the same requirement s8 places on Clinic Delay's aggregation. */
const intelMedian = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
};

/** Shift a YYYY-MM-DD day by n days. Pure calendar arithmetic on the UTC axis, so no offset is involved. */
function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` inclusive. Both are calendar days, so this cannot be off by a DST hour. */
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;

/**
 * Tally rows by a column into a fixed vocabulary.
 *
 * THE VOCABULARY IS THE MIGRATION'S CHECK CONSTRAINT, AND EVERY MEMBER IS EMITTED EVEN AT ZERO. A
 * distribution that drops its empty slices reads as if those categories did not exist -- "no
 * teleconsultations" and "teleconsultation is not a thing here" are different facts. A value the
 * constraint does not list lands in `unrecorded` rather than inventing a slice, so a later migration
 * adding a state is VISIBLE as unclassified instead of silently uncounted.
 */
function tally(
  rows: any[], pick: (r: any) => unknown, vocabulary: [string, string][],
): { slices: IntelSlice[]; unrecorded: number } {
  const counts = new Map<string, number>(vocabulary.map(([k]) => [k, 0]));
  let unrecorded = 0;
  for (const r of rows) {
    const raw = pick(r);
    const key = typeof raw === "string" && raw ? raw : null;
    if (key !== null && counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
    else unrecorded++;
  }
  return {
    slices: vocabulary.map(([key, label]) => ({ key, label, total: counts.get(key) ?? 0 })),
    unrecorded,
  };
}

const distribution = (
  key: string, label: string, read: IntelRead, pick: (r: any) => unknown,
  vocabulary: [string, string][], formula: string, sources: string[], what: string,
): IntelDistribution => {
  const base = { key, label, formula, sources };
  if (read.error) return { ...base, status: "unreadable", reason: `could not be read: ${read.error}`, slices: [], of: null, unrecorded: 0 };
  if (read.overflowed) return { ...base, status: "unreadable", reason: overflowNote(what), slices: [], of: null, unrecorded: 0 };
  const { slices, unrecorded } = tally(read.rows, pick, vocabulary);
  return { ...base, status: "ok", reason: null, slices, of: read.rows.length, unrecorded };
};

const notPermittedDistribution = (
  key: string, label: string, capability: string, formula: string, sources: string[],
): IntelDistribution => ({
  key, label, status: "not_permitted", reason: `${capability} is required to see this`,
  slices: [], of: null, unrecorded: 0, formula, sources,
});

// ── THE RANGE, AND THE PRIOR PERIOD IT MAY OR MAY NOT HAVE ───────────────────────────────────────────

export type IntelRange = {
  /** The reporting window. reports.ts owns this shape and its practice-calendar arithmetic. */
  period: Period;
  timezone: string;
  days: number;
  /** The immediately preceding window of equal length. Always constructible; not always honest. */
  prior: Period;
  /** False when a comparison against `prior` would be a lie. Every comparison checks this first. */
  priorUsable: boolean;
  /** Why not. Null when `priorUsable` is true. */
  priorReason: string | null;
};

/**
 * Build the range every module is computed over, and decide whether it has a usable prior period.
 *
 * ⚠ THE PRIOR WINDOW IS SHIFTED ON THE DAY AXIS, NOT BY SUBTRACTING A MILLISECOND SPAN. Subtracting the
 * current window's length in milliseconds -- the obvious implementation, and the one encounterTrend above
 * uses -- lands an hour out whenever a DST boundary falls between the two windows, which quietly moves
 * one evening clinic from one period into the other. Shifting whole calendar days and then asking
 * zonedDayRange for the instants is correct across any offset change.
 *
 * ⚠ AND THE PRIOR WINDOW MUST HAVE EXISTED. practice_workspace.created_at (migration 191) is the date
 * this practice began keeping records. If the prior window starts before it, the practice was not
 * recording for all of it, and any comparison would read a shorter history as a fall in activity -- the
 * single most misleading thing this workspace could show a practitioner in their first month.
 */
export async function intelRange(admin: any, workspaceId: string, opts: {
  fromDay?: string; toDay?: string; days?: number;
} = {}): Promise<IntelRange> {
  const [period, { timezone }] = await Promise.all([
    resolvePeriod(admin, workspaceId, opts),
    workspaceClock(admin, workspaceId),
  ]);

  const days = Math.max(1, daysBetween(period.fromDay, period.toDay));
  const priorToDay = shiftDay(period.fromDay, -1);
  const priorFromDay = shiftDay(priorToDay, -(days - 1));
  const prior: Period = {
    fromDay: priorFromDay,
    toDay: priorToDay,
    fromIso: zonedDayRange(priorFromDay, timezone).startIso,
    toIso: zonedDayRange(priorToDay, timezone).endIso,
    label: `${priorFromDay} to ${priorToDay}`,
  };

  const { data, error } = await admin.from("practice_workspace")
    .select("created_at").eq("id", workspaceId).maybeSingle();

  // A failed read is never a permission to compare. Unknown start date means no comparison.
  if (error) {
    return { period, timezone, days, prior, priorUsable: false,
      priorReason: `the practice's start date could not be read (${error.message ?? "read failed"}), so the previous period cannot be shown to be real` };
  }
  const began = parseAt((data as any)?.created_at);
  if (began === null) {
    return { period, timezone, days, prior, priorUsable: false,
      priorReason: "this practice has no recorded start date, so there is no way to tell whether the previous period existed" };
  }
  if (began > Date.parse(prior.fromIso)) {
    return { period, timezone, days, prior, priorUsable: false,
      priorReason: `this practice began keeping records on ${new Date(began).toISOString().slice(0, 10)}, part-way through ${prior.label}, so a comparison would read a shorter history as a fall` };
  }
  return { period, timezone, days, prior, priorUsable: true, priorReason: null };
}

/**
 * Widen a MetricScope to cover a whole reporting period.
 *
 * metricScope() is built for CORE-001 s7's day-or-session question and hard-codes its date range to one
 * calendar day, because that is the only range Today at a Glance ever asks about. This workspace asks
 * about thirty days, so the scope's instants and its DATE range are both widened -- the date range
 * matters because practice_follow_up.due_on is a DATE column and comparing it against one day would make
 * "follow-ups due this month" mean "follow-ups due on the last day of it".
 *
 * `kind` stays "day". MetricScopeKind has exactly two members, day and session, and a thirty-day period
 * is emphatically not session-scoped; adding a "period" member means editing metrics.ts, which is
 * reported rather than done. Every Metric returned through here therefore carries scopeKind "day", and
 * the range it actually covers is this workspace's `range.period`, which travels in the payload.
 */
function rangeScope(period: Period, timezone: string): MetricScope {
  const base = metricScope({ date: period.toDay, timezone });
  return {
    ...base,
    fromIso: period.fromIso, toIso: period.toIso,
    fromDate: period.fromDay, toDate: period.toDay,
  };
}

/**
 * The section 8 metrics that may be compared period-over-period, each with ITS OWN OWNING FUNCTION.
 *
 * The prior figure is produced by calling the same function metrics.ts uses for the current one, over the
 * prior scope. That is the entire mechanism, and it is what makes "no duplicated business logic" true
 * rather than aspirational: every exclusion, every allow-list and every null-instead-of-default rule
 * applies identically to both sides of the comparison because it is literally the same code.
 *
 * ONLY COUNTS. The three duration metrics are deliberately absent: the difference between two means over
 * two periods with different case mixes is not a trend in punctuality, it is a trend in who turned up,
 * and this workspace has no way to tell those apart.
 */
const COMPARABLE_METRICS: { key: MetricKey; owner: (admin: any, ctx: WorkspaceContext, scope: MetricScope) => Promise<Metric> }[] = [
  { key: "booked", owner: bookedAppointments },
  { key: "completed", owner: completedEncounters },
  { key: "patients_seen", owner: patientsSeen },
  { key: "cancelled", owner: cancelledAppointments },
  { key: "no_show", owner: noShows },
  { key: "follow_ups_due", owner: followUpsDue },
];

/** Turn a current and a prior Metric into a comparison, refusing wherever the comparison is not earned. */
function compareMetric(current: Metric, prior: Metric | null, range: IntelRange): IntelComparison {
  const base = {
    key: current.key, label: current.label,
    formula: `${current.formula} -- compared against the same calculation over ${range.prior.label} as a signed count, never as a percentage`,
    sources: current.sources,
    priorFromDay: range.prior.fromDay, priorToDay: range.prior.toDay,
  };
  const noPrior = (status: IntelStatus, reason: string): IntelComparison => ({
    ...base, current: current.value, prior: null, change: null, status, reason,
  });

  // The current figure fails first: there is nothing to compare a null against.
  if (current.status !== "ok" || current.value === null)
    return { ...base, current: null, prior: null, change: null, status: current.status, reason: current.reason };

  if (!range.priorUsable) return noPrior("unknowable", range.priorReason ?? "the previous period cannot be shown to be real");
  if (!prior) return noPrior("unreadable", "the previous period was not computed");
  if (prior.status === "unreadable") return noPrior("unreadable", `the previous period could not be read: ${prior.reason ?? "read failed"}`);
  if (prior.status === "not_permitted") return noPrior("not_permitted", prior.reason ?? "not permitted");
  if (prior.status !== "ok" || prior.value === null) return noPrior("unknowable", prior.reason ?? "the previous period holds no comparable figure");

  const observations = current.value + prior.value;
  if (observations < MIN_OBSERVATIONS_FOR_COMPARISON)
    return noPrior("unknowable",
      `${observations} record${observations === 1 ? "" : "s"} across the two periods; ${MIN_OBSERVATIONS_FOR_COMPARISON} are needed before a difference means anything`);

  return { ...base, current: current.value, prior: prior.value, change: current.value - prior.value, status: "ok", reason: null };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// THE TEN MODULES OF CPR-V5-003
// ════════════════════════════════════════════════════════════════════════════════════════════════════

// ── 1. OVERVIEW ──────────────────────────────────────────────────────────────────────────────────────

export type OverviewData = {
  /** All twelve of section 8, verbatim from metrics.ts. Not one of them is recomputed here. */
  metrics: PracticeMetrics;
  /** The subset that may honestly be compared with the period before, each earned or refused. */
  comparisons: IntelComparison[];
};

/**
 * OVERVIEW -- the workspace's headline figures, every one of them borrowed.
 *
 * SOURCE: src/lib/practice/metrics.ts, in full. This function issues no query of its own except the ones
 * metrics.ts issues on its behalf for the prior period.
 *
 * ⚠ THE COMP'S TILE READS "128 Encounters, up 18% vs previous 30 days" AND NEITHER HALF OF THAT SURVIVES
 * INTACT. The count does: it is metrics.completed, computed by the function that owns the definition. The
 * "up 18%" does not -- see IntelComparison for both reasons. What a screen can draw from this is
 * "128 completed, 109 in the 30 days before", or, where the comparison was refused, the count alone with
 * the reason underneath it. Never a 0%, never a default, never an arrow pointing at nothing.
 */
export async function overviewIntelligence(
  admin: any, ctx: WorkspaceContext, range: IntelRange,
): Promise<IntelModule<OverviewData>> {
  const scope = rangeScope(range.period, range.timezone);

  const [metrics, priorMetrics] = await Promise.all([
    practiceMetrics(admin, ctx, scope),
    // Only the comparable six, and only when the prior window is real. Six reads nobody will look at is a
    // waste of a clinic's connectivity, and CORE-001 s18 lists performance on typical connectivity as
    // part of done.
    range.priorUsable
      ? Promise.all(COMPARABLE_METRICS.map(m => m.owner(admin, ctx, rangeScope(range.prior, range.timezone))))
      : Promise.resolve(null),
  ]);

  const comparisons = COMPARABLE_METRICS.map((m, i) =>
    compareMetric(metrics.metrics[m.key], priorMetrics ? priorMetrics[i] : null, range));

  const problems = Object.values(metrics.metrics)
    .filter(m => m.status === "unreadable")
    .map(m => `${m.label}: ${m.reason ?? "could not be read"}`);

  return intelModule("overview", "Overview", { metrics, comparisons },
    // The sources of the twelve travel on each Metric; naming the engine is what matters at module level.
    ["src/lib/practice/metrics.ts (CORE-001 s8, all twelve definitions)"], problems);
}

// ── 2. CLINICAL ACTIVITY ─────────────────────────────────────────────────────────────────────────────

export type ClinicalActivityData = {
  /** The encounter curve, from this file's existing owner. Counts per day in the practice's calendar. */
  trend: Awaited<ReturnType<typeof encounterTrend>>;
  /** Period totals, from metrics.ts. These and the curve answer different questions -- see below. */
  completed: Metric;
  patientsSeen: Metric;
  byMode: IntelDistribution;
  byPathway: IntelDistribution;
  byActivityType: IntelDistribution;
};

/** practice_encounter.encounter_mode -- migration 194's CHECK, in full. */
const ENCOUNTER_MODES: [string, string][] = [
  ["in_person", "In person"], ["teleconsultation", "Teleconsultation"], ["outreach", "Outreach"],
  ["home_visit", "Home visit"], ["hospital", "Hospital"],
];

/** practice_encounter.entry_pathway -- migration 194's CHECK, in full. */
const ENTRY_PATHWAYS: [string, string][] = [
  ["booked", "Booked"], ["new_walk_in", "New walk-in"], ["walk_in_followup", "Walk-in follow-up"],
  ["scheduled_followup", "Scheduled follow-up"],
];

/** practice_activity.activity_type -- migration 232's CHECK, in full (CPR-V3-001 s4's list). */
const ACTIVITY_TYPES: [string, string][] = [
  ["outpatient_clinic", "Outpatient clinic"], ["ward_round", "Ward round"], ["theatre", "Theatre"],
  ["emergency_consult", "Emergency consult"], ["virtual_clinic", "Virtual clinic"],
  ["telephone_review", "Telephone review"], ["administration", "Administration"], ["teaching", "Teaching"],
];

/**
 * CLINICAL ACTIVITY -- the shape of the practitioner's work over the period.
 *
 * TOTALS COME FROM metrics.ts. THE SHAPE IS NEW WORK. Section 8 defines Completed and Patients Seen and
 * this module shows exactly those numbers; what it adds is a distribution across three columns section 8
 * never mentions -- encounter_mode, entry_pathway and the activity the consultation ran inside.
 *
 * THE CURVE COMES FROM encounterTrend, WHICH IS ALREADY IN THIS FILE. Writing a second daily bucket here
 * is precisely the "conflicting version of a shared metric" s16 forbids, and the fact that the existing
 * one buckets started_at while a new one might bucket completed_at is not a defence -- it is the bug. Its
 * one defect (it does not surface read errors, so a dead table draws a flat line rather than a failure)
 * is REPORTED rather than forked around, because forking is how a codebase ends up with two of everything.
 *
 * TABLES/COLUMNS: practice_encounter.workspace_id, .started_at, .status, .encounter_mode, .entry_pathway,
 * .activity_id (migration 194; activity_id from 232); embedded practice_activity.activity_type (232).
 *
 * ⚠ CANCELLED AND ENTERED_IN_ERROR ARE EXCLUDED FROM THE BREAKDOWNS. A voided record is not a
 * teleconsultation that happened. DRAFT is kept: a launched consultation is work in progress, and this is
 * a picture of activity rather than of completions -- which the totals beside it already are.
 */
export async function clinicalActivityIntelligence(
  admin: any, ctx: WorkspaceContext, range: IntelRange, metrics: PracticeMetrics,
): Promise<IntelModule<ClinicalActivityData>> {
  const sources = [
    "practice_encounter.started_at", "practice_encounter.status", "practice_encounter.encounter_mode",
    "practice_encounter.entry_pathway", "practice_encounter.activity_id", "practice_activity.activity_type",
  ];
  const permitted = hasCapability(ctx, CAP_ENCOUNTER_LIST);

  const [trend, read] = await Promise.all([
    encounterTrend(admin, ctx, range.period),
    permitted
      ? intelRows(admin.from("practice_encounter")
        .select("id, encounter_mode, entry_pathway, practice_activity:activity_id(activity_type)")
        .eq("workspace_id", ctx.workspaceId)
        .not("status", "in", "(CANCELLED,ENTERED_IN_ERROR)")
        .gte("started_at", range.period.fromIso).lt("started_at", range.period.toIso))
      : Promise.resolve({ rows: [], error: null, overflowed: false } as IntelRead),
  ]);

  const build = (key: string, label: string, pick: (r: any) => unknown, vocab: [string, string][], formula: string, src: string[]) =>
    permitted
      ? distribution(key, label, read, pick, vocab, formula, src, "encounters")
      : notPermittedDistribution(key, label, CAP_ENCOUNTER_LIST, formula, src);

  const data: ClinicalActivityData = {
    trend,
    completed: metrics.metrics.completed,
    patientsSeen: metrics.metrics.patients_seen,
    byMode: build("by_mode", "How the patient was seen", r => r.encounter_mode, ENCOUNTER_MODES,
      "count of encounters started in the period by practice_encounter.encounter_mode, cancelled and voided records excluded",
      ["practice_encounter.encounter_mode", "practice_encounter.started_at"]),
    byPathway: build("by_pathway", "How the patient arrived", r => r.entry_pathway, ENTRY_PATHWAYS,
      "count of encounters started in the period by practice_encounter.entry_pathway, cancelled and voided records excluded",
      ["practice_encounter.entry_pathway", "practice_encounter.started_at"]),
    // Encounters launched outside any activity land in `unrecorded` -- see the module comment on why that
    // is disclosed rather than filed under "other".
    byActivityType: build("by_activity_type", "What the practitioner was doing",
      r => r.practice_activity?.activity_type, ACTIVITY_TYPES,
      "count of encounters started in the period by the activity_type of the practice_activity they ran inside; encounters launched outside any activity are reported as unrecorded",
      ["practice_encounter.activity_id", "practice_activity.activity_type"]),
  };

  const problems: string[] = [];
  if (read.error) problems.push(`encounter breakdowns: ${read.error}`);
  if (read.overflowed) problems.push(`encounter breakdowns: ${overflowNote("encounters")}`);
  // Named honestly: the curve's reader cannot report a failure, so a flat line is not proof of a quiet week.
  problems.push("the daily curve comes from encounterTrend, which does not surface read errors -- an empty curve is not proof of an empty period");

  return intelModule("clinical_activity", "Clinical Activity", data, sources, problems);
}

// ── 3. PATIENT INTELLIGENCE ──────────────────────────────────────────────────────────────────────────

export type PatientIntelligenceData = {
  /** Distinct patients with a completed encounter in the period -- metrics.ts owns this. */
  patientsSeen: Metric;
  /** Patients whose record was created in the period. New work: section 8 has no registration metric. */
  registered: { value: number | null; status: IntelStatus; reason: string | null; formula: string; sources: string[] };
  /** Of the patients seen, how many the practice had never seen before. */
  newToPractice: IntelProportion;
  bySex: IntelDistribution;
  byAgeBand: IntelDistribution;
  /** Diagnosis labels, from reports.ts -- counted AS TYPED, because tidying them invents a coding. */
  diagnoses: Awaited<ReturnType<typeof diagnosisReport>>;
  /** False when the caller lacks patient.view: counts without names (migration 191 gives the owner exactly this). */
  identified: boolean;
};

/** practice_patient.sex -- migration 193's CHECK, in full. */
const PATIENT_SEXES: [string, string][] = [
  ["female", "Female"], ["male", "Male"], ["other", "Other"], ["unknown", "Unknown"],
  ["unspecified", "Unspecified"],
];

/**
 * Age bands, chosen once and named, because a band boundary is an editorial decision and not a fact.
 * These are the bands a general practice actually triages by; they are not a WHO or a census standard and
 * nothing here claims they are.
 */
const AGE_BANDS: [string, string][] = [
  ["0_4", "Under 5"], ["5_14", "5 to 14"], ["15_24", "15 to 24"], ["25_44", "25 to 44"],
  ["45_64", "45 to 64"], ["65_plus", "65 and over"],
];

const ageBandOf = (years: number | null): string | null => {
  if (years === null || !Number.isFinite(years) || years < 0) return null;
  if (years < 5) return "0_4";
  if (years < 15) return "5_14";
  if (years < 25) return "15_24";
  if (years < 45) return "25_44";
  if (years < 65) return "45_64";
  return "65_plus";
};

/**
 * PATIENT INTELLIGENCE -- who this practice serves.
 *
 * TABLES/COLUMNS: practice_patient.workspace_id, .created_at, .status, .sex, .birth_date,
 * .age_estimate_years (migration 193); practice_encounter.patient_id, .status, .started_at (194);
 * practice_diagnosis via reports.ts diagnosisReport (194).
 *
 * PATIENTS SEEN IS metrics.ts's. Everything else here is new: section 8 counts patients, it does not
 * describe them.
 *
 * ⚠ AGE IS AS AT THE END OF THE PERIOD, NOT AS AT TODAY. A report on last March that ages everybody to
 * this morning moves a handful of children out of the band they were treated in. birth_date is preferred;
 * age_estimate_years (migration 193 exists precisely because many patients here do not know their date of
 * birth) is used where there is no birth date and taken as at recording, which is the best the record
 * holds. Patients with neither land in `unrecorded` and are never guessed at.
 *
 * ⚠ MERGED PATIENTS ARE EXCLUDED FROM REGISTRATIONS. status 'merged' means the record turned out to be a
 * duplicate of another; counting it as a new patient inflates growth by exactly the practice's data-entry
 * error rate, which is the one number a growth figure must not secretly contain.
 */
export async function patientIntelligence(
  admin: any, ctx: WorkspaceContext, range: IntelRange, metrics: PracticeMetrics,
): Promise<IntelModule<PatientIntelligenceData>> {
  const sources = [
    "practice_patient.created_at", "practice_patient.status", "practice_patient.sex",
    "practice_patient.birth_date", "practice_patient.age_estimate_years",
    "practice_encounter.patient_id", "practice_encounter.started_at", "practice_diagnosis.label",
  ];
  const registeredFormula = "count of practice_patient rows created within the period whose status is not 'merged'";
  const registeredSources = ["practice_patient.created_at", "practice_patient.status"];

  if (!hasCapability(ctx, CAP_PATIENT_LIST))
    return intelUnavailable("patient_intelligence", "Patient Intelligence",
      `${CAP_PATIENT_LIST} is required to see anything about this practice's patients`, sources);

  const problems: string[] = [];
  const [registration, seenRead, diagnoses] = await Promise.all([
    intelCount(admin.from("practice_patient").select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).neq("status", "merged")
      .gte("created_at", range.period.fromIso).lt("created_at", range.period.toIso)),
    hasCapability(ctx, CAP_ENCOUNTER_LIST)
      ? intelRows(admin.from("practice_encounter").select("patient_id")
        .eq("workspace_id", ctx.workspaceId)
        .in("status", ["COMPLETED", "SIGNED", "AMENDED"])
        .gte("completed_at", range.period.fromIso).lt("completed_at", range.period.toIso))
      : Promise.resolve({ rows: [], error: null, overflowed: false } as IntelRead),
    diagnosisReport(admin, ctx, range.period, 10),
  ]);

  const registered = registration.error
    ? { value: null, status: "unreadable" as IntelStatus, reason: `could not be read: ${registration.error}`, formula: registeredFormula, sources: registeredSources }
    : registration.count === null
      ? { value: null, status: "unreadable" as IntelStatus, reason: "the patient register returned no count", formula: registeredFormula, sources: registeredSources }
      : { value: registration.count, status: "ok" as IntelStatus, reason: null, formula: registeredFormula, sources: registeredSources };
  if (registered.status === "unreadable") problems.push(`registrations: ${registered.reason}`);

  const newFormula = "of the distinct patients with a completed encounter in the period, those with no encounter of any status before the period began";
  const newSources = ["practice_encounter.patient_id", "practice_encounter.started_at"];
  const demographyFormula = (column: string) =>
    `distribution of the distinct patients seen in the period by practice_patient.${column}; patients with nothing recorded are reported as unrecorded rather than assigned a value`;

  const noSeen = (status: IntelStatus, reason: string): PatientIntelligenceData => ({
    patientsSeen: metrics.metrics.patients_seen,
    registered,
    newToPractice: { key: "new_to_practice", label: "Patients new to the practice", numerator: null, denominator: null, status, reason, caveat: null, formula: newFormula, sources: newSources },
    bySex: { key: "by_sex", label: "Patients seen by sex", status, reason, slices: [], of: null, unrecorded: 0, formula: demographyFormula("sex"), sources: ["practice_patient.sex"] },
    byAgeBand: { key: "by_age_band", label: "Patients seen by age", status, reason, slices: [], of: null, unrecorded: 0, formula: demographyFormula("birth_date / age_estimate_years"), sources: ["practice_patient.birth_date", "practice_patient.age_estimate_years"] },
    diagnoses,
    identified: hasCapability(ctx, CAP_PATIENT_VIEW),
  });

  if (!hasCapability(ctx, CAP_ENCOUNTER_LIST))
    return intelModule("patient_intelligence", "Patient Intelligence",
      noSeen("not_permitted", `${CAP_ENCOUNTER_LIST} is required to see who was seen`), sources, problems);
  if (seenRead.error) {
    problems.push(`patients seen: ${seenRead.error}`);
    return intelModule("patient_intelligence", "Patient Intelligence",
      noSeen("unreadable", `could not be read: ${seenRead.error}`), sources, problems);
  }
  if (seenRead.overflowed) {
    problems.push(`patients seen: ${overflowNote("completed encounters")}`);
    return intelModule("patient_intelligence", "Patient Intelligence",
      noSeen("unreadable", overflowNote("completed encounters")), sources, problems);
  }

  const seenIds = [...new Set(seenRead.rows.map(r => r.patient_id).filter(Boolean))] as string[];
  if (seenIds.length === 0)
    return intelModule("patient_intelligence", "Patient Intelligence",
      noSeen("unknowable", "no consultation was completed in this period, so there is nobody to describe"), sources, problems);

  const [priorRead, patientRead] = await Promise.all([
    // "Never seen before" = no encounter of ANY status before the period began. Any status, deliberately:
    // a cancelled first visit still means the practice had met them.
    intelIn(admin, "practice_encounter", "patient_id, started_at", ctx.workspaceId, "patient_id", seenIds),
    intelIn(admin, "practice_patient", "id, sex, birth_date, age_estimate_years", ctx.workspaceId, "id", seenIds),
  ]);

  const periodStart = Date.parse(range.period.fromIso);
  let newToPractice: IntelProportion;
  if (priorRead.error || priorRead.overflowed) {
    const reason = priorRead.error ? `could not be read: ${priorRead.error}` : overflowNote("encounter records for these patients");
    problems.push(`new to practice: ${reason}`);
    newToPractice = { key: "new_to_practice", label: "Patients new to the practice", numerator: null, denominator: seenIds.length, status: "unreadable", reason, caveat: null, formula: newFormula, sources: newSources };
  } else {
    const seenBefore = new Set<string>();
    for (const r of priorRead.rows) {
      const started = parseAt(r.started_at);
      if (r.patient_id && started !== null && started < periodStart) seenBefore.add(r.patient_id);
    }
    newToPractice = {
      key: "new_to_practice", label: "Patients new to the practice",
      numerator: seenIds.filter(id => !seenBefore.has(id)).length,
      denominator: seenIds.length,
      status: "ok", reason: null,
      caveat: "New means new to THIS practice's records. A patient the practitioner has known for years at another organisation is new here on the day their record is created.",
      formula: newFormula, sources: newSources,
    };
  }

  const endOfPeriod = new Date(range.period.toIso);
  const yearsOld = (row: any): number | null => {
    if (typeof row.birth_date === "string" && row.birth_date) {
      const born = Date.parse(`${row.birth_date}T00:00:00Z`);
      if (Number.isFinite(born)) return Math.floor((endOfPeriod.getTime() - born) / 31557600000);
    }
    return typeof row.age_estimate_years === "number" ? row.age_estimate_years : null;
  };

  const bySex = distribution("by_sex", "Patients seen by sex", patientRead, r => r.sex, PATIENT_SEXES,
    demographyFormula("sex"), ["practice_patient.sex"], "patient records");
  const byAgeBand = distribution("by_age_band", "Patients seen by age", patientRead, r => ageBandOf(yearsOld(r)), AGE_BANDS,
    demographyFormula("birth_date / age_estimate_years"), ["practice_patient.birth_date", "practice_patient.age_estimate_years"], "patient records");
  if (patientRead.error) problems.push(`patient demography: ${patientRead.error}`);

  return intelModule("patient_intelligence", "Patient Intelligence", {
    patientsSeen: metrics.metrics.patients_seen,
    registered, newToPractice, bySex, byAgeBand, diagnoses,
    identified: hasCapability(ctx, CAP_PATIENT_VIEW),
  }, sources, problems);
}

// ── 4. ORDERS INTELLIGENCE ───────────────────────────────────────────────────────────────────────────

/**
 * ORDERS INTELLIGENCE -- NOT BUILT, BECAUSE THERE IS NOTHING TO BUILD IT OVER.
 *
 * CPR-V5-003 lists an Orders Intelligence module and CPR-CORE-003 lists an "Orders & Procedures Engine"
 * among the CP domain engines. THE PROCEDURES HALF EXISTS (migration 197). THE ORDERS HALF DOES NOT.
 *
 * WHAT WAS LOOKED FOR AND WHAT WAS FOUND, so the next person does not repeat the search:
 *
 *   - No practice_order, practice_order_item, practice_lab_request or practice_prescription table
 *     exists in any migration.
 *   - No orders engine exists in src/lib/practice and no /practice/orders route exists.
 *   - No orders capability exists in practice_role_capabilities.
 *
 * ⚠ TWO NAMES IN THAT LIST HAVE SINCE BEEN BUILT AND THE REFUSAL SURVIVES BOTH. Migration 238 created
 * practice_encounter_investigation and practice_referral after this comment was written, so the sentence
 * above has been corrected rather than left to rot -- a stale refusal is how a real store goes unread for
 * months, and practice_referral went unread for exactly that reason until referralIntelligence below.
 * NEITHER makes this module buildable, and the reason is the one this refusal was always about: both are
 * NOTES THAT A PRACTITIONER DECIDED SOMETHING, recorded inside a consultation. Migration 238 says so in
 * its own header -- "RECORDED, NOT SENT ... no channel column, no sent_at" -- so neither has a dispatch,
 * neither has a recipient system, and practice_incoming_document still carries no reference back to the
 * request that produced a result. "What have I asked for that has not come back" remains unaskable.
 *
 * THE NEAREST STORE IS practice_treatment (migration 194), AND IT IS NOT AN ORDERS ENGINE. It records
 * what the practitioner DECIDED inside a consultation -- treatment_type is one of medication, procedure,
 * investigation, advice, referral, monitoring -- and that is a clinical intention, not a request that was
 * dispatched anywhere. Three specific things make it unusable as an orders read model:
 *
 *   1. ITS LIFECYCLE IS NEVER WRITTEN. status is planned/in_progress/completed/cancelled, and nothing in
 *      this product updates it after insert. Every row is 'planned' forever. A "completion rate" over it
 *      would read 0 of everything for reasons that have nothing to do with any patient.
 *   2. IT HAS NO RECIPIENT AND NO DISPATCH. There is no lab, no destination, no sent_at. "Turnaround" has
 *      no first timestamp to start from.
 *   3. RESULTS DO NOT LINK BACK. practice_incoming_document (migration 200) registers lab_result and
 *      imaging_report arrivals, but carries no treatment_id, order_id or request reference at all -- so
 *      no arrival can be matched to the request that caused it, and the one question an orders dashboard
 *      exists to answer ("what have I asked for that has not come back") cannot be asked of this schema.
 *
 * SO THIS RETURNS NOTHING. Counting investigation-typed treatment rows and labelling the tile "Orders"
 * would be the exact failure this codebase cares most about: a chart that is populated, plausible, and
 * answering a different question from the one on its heading.
 *
 * WHAT WOULD MAKE IT REAL: an order store with a recipient and a dispatch timestamp, a status written by
 * something, and a result linkage on practice_incoming_document. That is a migration and an engine, which
 * is CPR-V5-003 scope for somebody, and it is not scope this read-only workspace can invent.
 */
export function ordersIntelligence(): IntelModule<never> {
  return intelUnavailable("orders_intelligence", "Orders Intelligence",
    "There is no orders store in this product. No practice_order table exists in any migration, no orders engine exists in src/lib/practice, and no orders capability exists in practice_role_capabilities. practice_treatment (migration 194) is the nearest table and records clinical INTENT rather than orders: its status column is never written after insert, it has no recipient or dispatch timestamp, and practice_incoming_document (migration 200) carries no reference back to the request that produced a result. Nothing here can be counted without answering a different question from the one on the heading.",
    ["(none -- no store exists)"]);
}

// ── 5. PROCEDURE INTELLIGENCE ────────────────────────────────────────────────────────────────────────

export type ProcedureIntelligenceData = {
  /** Performed / complication / outcomes-recorded counts, from this file's existing owner. */
  outcomes: Awaited<ReturnType<typeof outcomePicture>>["procedures"];
  /** Top procedure labels, from this file's existing caseMix. Counted as typed. */
  topLabels: { label: string; total: number }[];
  procedureTotal: number;
  byCategory: IntelDistribution;
  byConsent: IntelDistribution;
  byLaterality: IntelDistribution;
  abandoned: IntelProportion;
  complications: IntelProportion;
};

/** practice_procedure_type.category -- migration 197's CHECK, in full. */
const PROCEDURE_CATEGORIES: [string, string][] = [
  ["minor_surgery", "Minor surgery"], ["injection", "Injection"], ["wound_care", "Wound care"],
  ["diagnostic", "Diagnostic"], ["obstetric", "Obstetric"], ["dental", "Dental"],
  ["dressing", "Dressing"], ["physical", "Physical"], ["other", "Other"],
];

/** practice_procedure.consent_status -- migration 197's CHECK, in full. */
const CONSENT_STATUSES: [string, string][] = [
  ["obtained", "Obtained"], ["not_required", "Not required"], ["refused", "Refused"],
  ["not_recorded", "Not recorded"],
];

/** practice_procedure.laterality -- migration 197's CHECK, in full. */
const LATERALITIES: [string, string][] = [
  ["left", "Left"], ["right", "Right"], ["bilateral", "Bilateral"], ["not_applicable", "Not applicable"],
];

/**
 * PROCEDURE INTELLIGENCE -- what this practice does with its hands.
 *
 * TABLES/COLUMNS: practice_procedure.workspace_id, .performed_at, .status, .consent_status, .laterality,
 * .procedure_type_id (migration 197); embedded practice_procedure_type.category (197);
 * practice_procedure_outcome.outcome_type via outcomePicture (197).
 *
 * THE COUNTS COME FROM outcomePicture AND caseMix, BOTH ALREADY IN THIS FILE. What is added is three
 * distributions and two proportions those functions do not compute.
 *
 * ⚠ THE COMPLICATION FIGURE IS A CENSORED NUMERATOR AND IT SAYS SO. A complication is discovered later --
 * that is why practice_procedure_outcome is a separate append-only table with its own observed_on. A
 * procedure performed on the last day of the period has had one day to declare a complication and one
 * performed on the first has had thirty, so the most recent procedures systematically look safest. The
 * comp draws this as "Complication Rate 2.1%", which hides the censoring completely. Here it is
 * "4 of 213" with the caveat attached, and the count of procedures with no outcome recorded at all is
 * beside it so a reader can see how much of the denominator has simply not reported yet.
 *
 * ⚠ CATEGORY IS THE CATALOGUE'S, AND A FREE-TYPED PROCEDURE HAS NONE. procedure_type_id is nullable
 * because migration 197 deliberately allows a procedure the catalogue does not hold. Those land in
 * `unrecorded`, never in "other" -- "other" is a category somebody chose and unclassified is not.
 */
export async function procedureIntelligence(
  admin: any, ctx: WorkspaceContext, range: IntelRange,
  outcomes: Awaited<ReturnType<typeof outcomePicture>>,
  mix: Awaited<ReturnType<typeof caseMix>>,
): Promise<IntelModule<ProcedureIntelligenceData>> {
  const sources = [
    "practice_procedure.performed_at", "practice_procedure.status", "practice_procedure.consent_status",
    "practice_procedure.laterality", "practice_procedure.procedure_type_id",
    "practice_procedure_type.category", "practice_procedure_outcome.outcome_type",
  ];

  // Either procedure capability admits a reader: migration 197 gives `procedure.record` to the
  // practitioner and `procedure.manage` to the practitioner and the owner, and both are people entitled
  // to know what the practice performed. Neither was invented -- both are in 197's insert.
  if (!hasCapability(ctx, CAP_PROCEDURE_RECORD) && !hasCapability(ctx, CAP_PROCEDURE_MANAGE))
    return intelUnavailable("procedure_intelligence", "Procedure Intelligence",
      `${CAP_PROCEDURE_RECORD} or ${CAP_PROCEDURE_MANAGE} is required to see what this practice performed`, sources);

  const read = await intelRows(admin.from("practice_procedure")
    .select("id, status, consent_status, laterality, practice_procedure_type:procedure_type_id(category)")
    .eq("workspace_id", ctx.workspaceId)
    .gte("performed_at", range.period.fromIso).lt("performed_at", range.period.toIso));

  const problems: string[] = [];
  if (read.error) problems.push(`procedure breakdowns: ${read.error}`);
  if (read.overflowed) problems.push(`procedure breakdowns: ${overflowNote("procedures")}`);

  const performed = outcomes.procedures.performed;
  const abandonedCount = read.error || read.overflowed ? null : read.rows.filter(p => p.status === "ABANDONED").length;
  const attempted = read.error || read.overflowed ? null : read.rows.length;

  const data: ProcedureIntelligenceData = {
    outcomes: outcomes.procedures,
    topLabels: mix.procedures,
    procedureTotal: mix.procedureTotal,
    byCategory: distribution("by_category", "Procedures by category", read,
      r => r.practice_procedure_type?.category, PROCEDURE_CATEGORIES,
      "count of practice_procedure rows performed in the period by the category of their catalogue entry; procedures typed freehand carry no catalogue entry and are reported as unrecorded",
      ["practice_procedure.procedure_type_id", "practice_procedure_type.category"], "procedures"),
    byConsent: distribution("by_consent", "Consent recorded", read, r => r.consent_status, CONSENT_STATUSES,
      "count of practice_procedure rows performed in the period by practice_procedure.consent_status; 'not recorded' is not the same as 'not obtained' and is shown as its own slice",
      ["practice_procedure.consent_status"], "procedures"),
    byLaterality: distribution("by_laterality", "Side", read, r => r.laterality, LATERALITIES,
      "count of practice_procedure rows performed in the period by practice_procedure.laterality",
      ["practice_procedure.laterality"], "procedures"),
    abandoned: {
      key: "abandoned", label: "Procedures started and stopped",
      numerator: abandonedCount, denominator: attempted,
      status: abandonedCount === null ? "unreadable" : "ok",
      reason: abandonedCount === null ? (read.error ? `could not be read: ${read.error}` : overflowNote("procedures")) : null,
      caveat: "Abandoned means something was begun and stopped, which is a thing that happened to the patient. It is not a failure count and migration 197 does not record why.",
      formula: "practice_procedure rows in the period with status ABANDONED, over all procedure rows in the period",
      sources: ["practice_procedure.status", "practice_procedure.performed_at"],
    },
    complications: {
      key: "complications", label: "Procedures with a complication recorded",
      numerator: outcomes.procedures.withComplication,
      denominator: performed,
      status: performed === 0 ? "unknowable" : "ok",
      reason: performed === 0 ? "no procedure was performed in this period, so there is nothing to report a complication against" : null,
      caveat: `A complication is discovered later, so the most recent procedures have had the least time to declare one and always look safest. ${performed - outcomes.procedures.outcomesRecorded} of ${performed} procedures in this period have no outcome recorded at all.`,
      formula: "distinct practice_procedure ids with a practice_procedure_outcome row of outcome_type 'complication', over procedures performed in the period with status PERFORMED",
      sources: ["practice_procedure_outcome.outcome_type", "practice_procedure.status"],
    },
  };

  return intelModule("procedure_intelligence", "Procedure Intelligence", data, sources, problems);
}

// ── 6. FOLLOW-UP INTELLIGENCE ────────────────────────────────────────────────────────────────────────

export type FollowUpIntelligenceData = {
  /** Open follow-ups due inside the period -- metrics.ts owns this definition. */
  due: Metric;
  /** How the period's concluded follow-ups turned out -- this file's existing owner. */
  concluded: Awaited<ReturnType<typeof outcomePicture>>["followUps"];
  /** Still owed and already past their date, as at today. Section 8 deliberately excludes these from Due. */
  overdue: { value: number | null; status: IntelStatus; reason: string | null; formula: string; sources: string[] };
  /** The comp's "completion rate", done as a cohort with its censoring disclosed. */
  completion: IntelProportion;
  byKind: IntelDistribution;
  byPriority: IntelDistribution;
};

/** practice_follow_up.kind -- migration 309's CHECK, in full (CPR-FUP-002 domains + the pre-split
 *  codes that live on historical rows). A code missing here would fall out of the distribution. */
const FOLLOW_UP_KINDS: [string, string][] = [
  ["clinical_condition", "Clinical condition"], ["investigation_result", "Investigation / result"],
  ["treatment_response", "Treatment"], ["procedure_intervention", "Procedure / intervention"],
  ["referral_outcome", "Referral"], ["administrative", "Administrative"], ["other", "Other"],
  ["review", "Review"], ["monitoring", "Monitoring"], ["immunisation", "Immunisation"],
];

/** practice_follow_up.priority -- migration 196's CHECK, in full. */
const FOLLOW_UP_PRIORITIES: [string, string][] = [
  ["routine", "Routine"], ["soon", "Soon"], ["urgent", "Urgent"],
];

/**
 * FOLLOW-UP INTELLIGENCE -- what this practice promised and what became of it.
 *
 * TABLES/COLUMNS: practice_follow_up.workspace_id, .status, .due_on, .created_at, .kind, .priority
 * (migration 196).
 *
 * ⚠ THE COMP'S "FOLLOW-UP COMPLETION RATE 75%" IS THE MOST MISLEADING FIGURE IN THE DESIGN, AND THIS IS
 * WHAT REPLACES IT.
 *
 * Three separate problems, all fixed:
 *
 *   THE PERCENTAGE HIDES THE COUNT. "75%" is 3 of 4 and 750 of 1000 and a practitioner would act on one
 *   of those. Returned here as a numerator and a denominator; there is no rate field.
 *
 *   THE DENOMINATOR WAS NEVER DEFINED. Completed over what -- everything due in the window? Everything
 *   raised in it? Those are different numbers and the comp does not say. THIS USES THE COHORT RAISED IN
 *   THE PERIOD, because that is the set the practitioner actually created and the only one whose fate is
 *   attributable to the period. Completions of older follow-ups belong to the periods that raised them.
 *
 *   THE COHORT IS CENSORED AND THE TILE PRETENDS OTHERWISE. A follow-up raised on the last day of the
 *   period with a six-week interval is not late, not missed and not completed -- it is NOT YET DUE, and
 *   counting it in the denominator makes every recent period look worse than every old one, purely as an
 *   artefact of when the report was run. `notYetDue` is returned beside the proportion so a screen can
 *   show "72 of 96 completed, 31 of those 96 are not yet due" instead of a number that quietly falls
 *   every time somebody makes a promise.
 *
 * OVERDUE IS AS AT TODAY, NOT AS AT THE PERIOD. "How many promises are broken right now" is a live state
 * exactly as Waiting is (see metrics.ts on why Waiting is not windowed), and reporting last March's
 * overdue backlog on a page somebody opened this morning would answer a question nobody asked.
 */
export async function followUpIntelligence(
  admin: any, ctx: WorkspaceContext, range: IntelRange, metrics: PracticeMetrics,
  outcomes: Awaited<ReturnType<typeof outcomePicture>>,
): Promise<IntelModule<FollowUpIntelligenceData>> {
  const sources = [
    "practice_follow_up.status", "practice_follow_up.due_on", "practice_follow_up.created_at",
    "practice_follow_up.kind", "practice_follow_up.priority",
  ];
  if (!hasCapability(ctx, CAP_FOLLOWUP_VIEW))
    return intelUnavailable("followup_intelligence", "Follow-up Intelligence",
      `${CAP_FOLLOWUP_VIEW} is required to see this practice's follow-ups`, sources);

  const overdueFormula = "count of practice_follow_up rows still OPEN or SCHEDULED whose due_on is before the practice's today; OVERDUE is not a stored status (migration 196 has none on purpose) so it is derived from the clock at read time";
  const completionFormula = "of practice_follow_up rows CREATED within the period, those whose status is now COMPLETED; the cohort is what the period raised, not what fell due in it";

  const today = practiceToday(range.timezone);
  const [overdueRead, cohort] = await Promise.all([
    intelCount(admin.from("practice_follow_up").select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).in("status", ["OPEN", "SCHEDULED"]).lt("due_on", today)),
    intelRows(admin.from("practice_follow_up").select("id, status, due_on, kind, priority")
      .eq("workspace_id", ctx.workspaceId)
      .gte("created_at", range.period.fromIso).lt("created_at", range.period.toIso)),
  ]);

  const problems: string[] = [];
  const overdue = overdueRead.error
    ? { value: null, status: "unreadable" as IntelStatus, reason: `could not be read: ${overdueRead.error}`, formula: overdueFormula, sources: ["practice_follow_up.status", "practice_follow_up.due_on"] }
    : overdueRead.count === null
      ? { value: null, status: "unreadable" as IntelStatus, reason: "the follow-up board returned no count", formula: overdueFormula, sources: ["practice_follow_up.status", "practice_follow_up.due_on"] }
      : { value: overdueRead.count, status: "ok" as IntelStatus, reason: null, formula: overdueFormula, sources: ["practice_follow_up.status", "practice_follow_up.due_on"] };
  if (overdue.status === "unreadable") problems.push(`overdue backlog: ${overdue.reason}`);
  if (cohort.error) problems.push(`follow-up cohort: ${cohort.error}`);
  if (cohort.overflowed) problems.push(`follow-up cohort: ${overflowNote("follow-ups raised")}`);

  const cohortUnreadable = cohort.error ? `could not be read: ${cohort.error}` : cohort.overflowed ? overflowNote("follow-ups raised") : null;
  const notYetDue = cohortUnreadable ? 0
    : cohort.rows.filter(f => ["OPEN", "SCHEDULED"].includes(f.status) && typeof f.due_on === "string" && f.due_on > today).length;

  const completion: IntelProportion = {
    key: "completion", label: "Follow-ups raised in this period that are now completed",
    numerator: cohortUnreadable ? null : cohort.rows.filter(f => f.status === "COMPLETED").length,
    denominator: cohortUnreadable ? null : cohort.rows.length,
    status: cohortUnreadable ? "unreadable" : cohort.rows.length === 0 ? "unknowable" : "ok",
    reason: cohortUnreadable ?? (cohort.rows.length === 0 ? "no follow-up was raised in this period, so there is nothing whose completion could be counted" : null),
    caveat: cohortUnreadable ? null
      : `${notYetDue} of these ${cohort.rows.length} are not yet due, so they can be neither completed nor missed. A denominator that includes them understates completion for recent periods and always will.`,
    formula: completionFormula,
    sources: ["practice_follow_up.created_at", "practice_follow_up.status", "practice_follow_up.due_on"],
  };

  return intelModule("followup_intelligence", "Follow-up Intelligence", {
    due: metrics.metrics.follow_ups_due,
    concluded: outcomes.followUps,
    overdue, completion,
    byKind: distribution("by_kind", "What the follow-up is for", cohort, r => r.kind, FOLLOW_UP_KINDS,
      "count of practice_follow_up rows raised in the period by practice_follow_up.kind",
      ["practice_follow_up.kind", "practice_follow_up.created_at"], "follow-ups raised"),
    byPriority: distribution("by_priority", "How urgent", cohort, r => r.priority, FOLLOW_UP_PRIORITIES,
      "count of practice_follow_up rows raised in the period by practice_follow_up.priority",
      ["practice_follow_up.priority", "practice_follow_up.created_at"], "follow-ups raised"),
  }, sources, problems);
}

// ── 7. DOCUMENT INTELLIGENCE ─────────────────────────────────────────────────────────────────────────

export type DocumentIntelligenceData = {
  byStatus: IntelDistribution;
  byType: IntelDistribution;
  /** Written but never signed. The count somebody can act on, in place of a "documentation quality" score. */
  unsigned: IntelProportion;
  /** Median days from creation to signature, stated as a median, null below the observation floor. */
  daysToSign: { value: number | null; unit: "days"; observations: number; status: IntelStatus; reason: string | null; formula: string; sources: string[] };
  /** What arrived from outside and whether anybody has looked at it. Null when inbox.review is not held. */
  incoming: IntelDistribution;
};

/** practice_clinical_document.status -- migration 195's CHECK, in full. */
const DOCUMENT_STATUSES: [string, string][] = [
  ["DRAFT", "Draft"], ["FINAL", "Final"], ["SIGNED", "Signed"], ["AMENDED", "Amended"],
  ["ENTERED_IN_ERROR", "Entered in error"],
];

/** practice_clinical_document.doc_type -- migration 195's CHECK, in full. */
const DOCUMENT_TYPES: [string, string][] = [
  ["consultation_summary", "Consultation summary"], ["referral_letter", "Referral letter"],
  ["sick_note", "Sick note"], ["procedure_note", "Procedure note"],
  ["discharge_summary", "Discharge summary"], ["general", "General"],
];

/** practice_incoming_document.status -- migration 200's CHECK, in full. */
const INCOMING_STATUSES: [string, string][] = [
  ["RECEIVED", "Received, not yet reviewed"], ["REVIEWED", "Reviewed"], ["ACTIONED", "Actioned"],
];

/**
 * DOCUMENT INTELLIGENCE -- what this practice wrote, and what it has not finished writing.
 *
 * TABLES/COLUMNS: practice_clinical_document.workspace_id, .created_at, .status, .doc_type, .signed_at
 * (migration 195); practice_incoming_document.workspace_id, .received_on, .status (migration 200).
 *
 * NOTHING ELSE OWNS THESE FIGURES. Section 8 has no document metric, and completeness() above counts
 * unsigned ENCOUNTERS, which is a different record from an unsigned letter. This module is new work.
 *
 * ⚠ THE COMP ASKS FOR "COMPLETED NOTES 96.3%" AND A "DATA QUALITY" SCORE. Neither is here, for the reason
 * the completeness() comment above gives: a composite score with no published formula is an opinion with
 * arithmetic attached, and "96% complete" tells a practitioner nothing to do on a Tuesday morning. What
 * replaces it is a count with a denominator and a median somebody can act on.
 *
 * ⚠ TIME TO SIGN IS MEASURED FROM CREATION, WHICH IS WHAT THE RECORD HOLDS AND NOT QUITE WHAT ANYBODY
 * MEANS. A document created as a draft on Monday and signed on Friday reads as four days even if it was
 * written on Thursday, because migration 195 has no authored_at. Stated here rather than quietly
 * presented as writing speed. The median is used rather than the mean, and named, for exactly the reason
 * metrics.ts gives against Clinic Delay: one letter forgotten for a month is an outlier that drags a mean
 * into describing a practice that does not exist.
 */
export async function documentIntelligence(
  admin: any, ctx: WorkspaceContext, range: IntelRange,
): Promise<IntelModule<DocumentIntelligenceData>> {
  const sources = [
    "practice_clinical_document.created_at", "practice_clinical_document.status",
    "practice_clinical_document.doc_type", "practice_clinical_document.signed_at",
    "practice_incoming_document.received_on", "practice_incoming_document.status",
  ];
  const incomingFormula = "count of practice_incoming_document rows received within the period by practice_incoming_document.status";
  const incomingSources = ["practice_incoming_document.received_on", "practice_incoming_document.status"];

  if (!hasCapability(ctx, CAP_DOCUMENT_VIEW))
    return intelUnavailable("document_intelligence", "Document Intelligence",
      `${CAP_DOCUMENT_VIEW} is required to see this practice's documents`, sources);

  const [read, incomingRead] = await Promise.all([
    intelRows(admin.from("practice_clinical_document").select("id, status, doc_type, created_at, signed_at")
      .eq("workspace_id", ctx.workspaceId)
      .gte("created_at", range.period.fromIso).lt("created_at", range.period.toIso)),
    // Gated separately: migration 200 gives inbox.review to the PRACTITIONER ONLY, because deciding a lab
    // result needs nothing is a clinical judgement. An assistant sees the rest of this module and not this.
    hasCapability(ctx, CAP_INBOX_REVIEW)
      ? intelRows(admin.from("practice_incoming_document").select("id, status")
        .eq("workspace_id", ctx.workspaceId)
        .gte("received_on", range.period.fromDay).lte("received_on", range.period.toDay))
      : Promise.resolve(null),
  ]);

  const problems: string[] = [];
  if (read.error) problems.push(`documents: ${read.error}`);
  if (read.overflowed) problems.push(`documents: ${overflowNote("documents")}`);
  if (incomingRead?.error) problems.push(`incoming documents: ${incomingRead.error}`);

  const unreadable = read.error ? `could not be read: ${read.error}` : read.overflowed ? overflowNote("documents") : null;
  // ENTERED_IN_ERROR is a voided record, not an unsigned one; it belongs in neither half of the proportion.
  const live = unreadable ? [] : read.rows.filter(d => d.status !== "ENTERED_IN_ERROR");
  const signedStates = ["SIGNED", "AMENDED"];

  const signDelays: number[] = [];
  for (const d of live) {
    if (!signedStates.includes(d.status)) continue;
    const created = parseAt(d.created_at);
    const signed = parseAt(d.signed_at);
    // Missing or backwards timestamps are excluded, never clamped: a zero-day signature that did not
    // happen would drag the median toward a promptness nobody achieved.
    if (created === null || signed === null || signed < created) continue;
    signDelays.push((signed - created) / 86400000);
  }

  const daysToSignFormula = `median of (practice_clinical_document.signed_at - .created_at) in days over documents created in the period and since signed; null below ${MIN_OBSERVATIONS_FOR_MEDIAN} valid observations. Measured from CREATION, which is what the record holds -- migration 195 has no authored_at, so a draft left open inflates this without anybody having been slow`;
  const daysToSignSources = ["practice_clinical_document.created_at", "practice_clinical_document.signed_at", "practice_clinical_document.status"];

  return intelModule("document_intelligence", "Document Intelligence", {
    byStatus: distribution("by_status", "Documents by status", read, r => r.status, DOCUMENT_STATUSES,
      "count of practice_clinical_document rows created within the period by status",
      ["practice_clinical_document.created_at", "practice_clinical_document.status"], "documents"),
    byType: distribution("by_type", "Documents by kind", read, r => r.doc_type, DOCUMENT_TYPES,
      "count of practice_clinical_document rows created within the period by doc_type",
      ["practice_clinical_document.created_at", "practice_clinical_document.doc_type"], "documents"),
    unsigned: {
      key: "unsigned", label: "Documents written but not signed",
      numerator: unreadable ? null : live.filter(d => !signedStates.includes(d.status)).length,
      denominator: unreadable ? null : live.length,
      status: unreadable ? "unreadable" : live.length === 0 ? "unknowable" : "ok",
      reason: unreadable ?? (live.length === 0 ? "no document was written in this period" : null),
      caveat: "A document created near the end of the period may simply not have been signed yet. Records voided as entered-in-error are excluded from both halves.",
      formula: "practice_clinical_document rows created in the period whose status is DRAFT or FINAL, over all rows created in the period except ENTERED_IN_ERROR",
      sources: ["practice_clinical_document.status", "practice_clinical_document.created_at"],
    },
    daysToSign: unreadable
      ? { value: null, unit: "days", observations: 0, status: "unreadable", reason: unreadable, formula: daysToSignFormula, sources: daysToSignSources }
      : signDelays.length < MIN_OBSERVATIONS_FOR_MEDIAN
        ? { value: null, unit: "days", observations: signDelays.length, status: "unknowable",
            reason: `${signDelays.length} document${signDelays.length === 1 ? " was" : "s were"} created and signed in this period; ${MIN_OBSERVATIONS_FOR_MEDIAN} are needed before a median means anything`,
            formula: daysToSignFormula, sources: daysToSignSources }
        : { value: intelMedian(signDelays), unit: "days", observations: signDelays.length, status: "ok", reason: null, formula: daysToSignFormula, sources: daysToSignSources },
    incoming: incomingRead === null
      ? notPermittedDistribution("incoming", "Documents received from outside", CAP_INBOX_REVIEW, incomingFormula, incomingSources)
      : distribution("incoming", "Documents received from outside", incomingRead, r => r.status, INCOMING_STATUSES,
        incomingFormula, incomingSources, "incoming documents"),
  }, sources, problems);
}

// ── 8. LOCATION INTELLIGENCE ─────────────────────────────────────────────────────────────────────────

export type LocationIntelligenceData = {
  /** Appointments per location, from this file's existing owner. False `comparable` for a single site. */
  appointments: Awaited<ReturnType<typeof byLocation>>;
  /** Encounters per location, attributed through the activity they ran inside -- see the warning below. */
  encounters: {
    status: IntelStatus;
    reason: string | null;
    rows: { locationId: string; name: string; total: number }[];
    /** Encounters that carry no location at all. Disclosed, never redistributed across the sites. */
    unattributed: number;
    of: number | null;
    formula: string;
    sources: string[];
  };
};

/**
 * LOCATION INTELLIGENCE -- where the work happened.
 *
 * TABLES/COLUMNS: practice_location.id, .name, .active (migration 191); practice_appointment.location_id
 * via byLocation (192); practice_encounter.activity_id (232) and embedded practice_activity.location_id
 * (232).
 *
 * ⚠ practice_encounter.location_id EXISTS AND IS ALWAYS NULL. THIS IS THE FINDING THAT SHAPES THE MODULE.
 *
 * Migration 194 gives practice_encounter a location_id column and NOTHING IN THIS PRODUCT EVER WRITES IT
 * -- launchEncounter (encounters.ts) does not set it and no other engine touches it. A location breakdown
 * built on that column would return zero for every site while consultations were plainly happening, and
 * it would look exactly like a quiet month. So it is not used, and this says so out loud rather than
 * leaving the next person to rediscover it.
 *
 * The route that DOES carry a location is practice_encounter.activity_id -> practice_activity.location_id,
 * which activity.ts writes when a session is started. That is what is used here.
 *
 * ⚠ WHICH MEANS SOME ENCOUNTERS CANNOT BE PLACED, AND THEY ARE COUNTED SEPARATELY RATHER THAN DROPPED. An
 * encounter launched outside any activity has no location; so does one inside a telephone_review or an
 * administration block, which migration 232 explicitly allows to have neither a facility nor a location.
 * Dropping those silently would make the per-site totals add up to less than the practice's own encounter
 * count and nobody could see why; redistributing them would be a fabrication. They are returned as
 * `unattributed`.
 */
export async function locationIntelligence(
  admin: any, ctx: WorkspaceContext, range: IntelRange,
): Promise<IntelModule<LocationIntelligenceData>> {
  const sources = [
    "practice_location.name", "practice_appointment.location_id",
    "practice_encounter.activity_id", "practice_activity.location_id",
  ];
  const formula = "count of encounters started in the period grouped by the location of the practice_activity they ran inside; practice_encounter.location_id is deliberately NOT used because nothing in this product writes it";
  const encounterSources = ["practice_encounter.activity_id", "practice_activity.location_id", "practice_location.name"];

  if (!hasCapability(ctx, CAP_CALENDAR_VIEW))
    return intelUnavailable("location_intelligence", "Location Intelligence",
      `${CAP_CALENDAR_VIEW} is required to see where this practice works`, sources);

  const problems: string[] = [];
  const [appointments, locationRead, encounterRead] = await Promise.all([
    byLocation(admin, ctx, range.period),
    intelRows(admin.from("practice_location").select("id, name").eq("workspace_id", ctx.workspaceId)),
    hasCapability(ctx, CAP_ENCOUNTER_LIST)
      ? intelRows(admin.from("practice_encounter")
        .select("id, practice_activity:activity_id(location_id)")
        .eq("workspace_id", ctx.workspaceId)
        .not("status", "in", "(CANCELLED,ENTERED_IN_ERROR)")
        .gte("started_at", range.period.fromIso).lt("started_at", range.period.toIso))
      : Promise.resolve(null),
  ]);

  let encounters: LocationIntelligenceData["encounters"];
  if (encounterRead === null) {
    encounters = { status: "not_permitted", reason: `${CAP_ENCOUNTER_LIST} is required to see where consultations happened`, rows: [], unattributed: 0, of: null, formula, sources: encounterSources };
  } else if (encounterRead.error || encounterRead.overflowed || locationRead.error) {
    const reason = encounterRead.error ? `could not be read: ${encounterRead.error}`
      : encounterRead.overflowed ? overflowNote("encounters")
        : `the location list could not be read: ${locationRead.error}`;
    problems.push(`encounters by location: ${reason}`);
    encounters = { status: "unreadable", reason, rows: [], unattributed: 0, of: null, formula, sources: encounterSources };
  } else {
    const names = new Map<string, string>(locationRead.rows.map(l => [l.id as string, l.name as string]));
    const counts = new Map<string, number>();
    let unattributed = 0;
    for (const e of encounterRead.rows) {
      const locationId = e.practice_activity?.location_id;
      if (typeof locationId === "string" && locationId) counts.set(locationId, (counts.get(locationId) ?? 0) + 1);
      else unattributed++;
    }
    encounters = {
      status: "ok", reason: null,
      rows: [...counts.entries()]
        // A location id with no name is a row that was deleted from under the encounter. Named as such
        // rather than dropped -- the consultations happened somewhere.
        .map(([locationId, total]) => ({ locationId, name: names.get(locationId) ?? "Location no longer in the register", total }))
        .sort((a, b) => b.total - a.total),
      unattributed, of: encounterRead.rows.length, formula, sources: encounterSources,
    };
  }

  return intelModule("location_intelligence", "Location Intelligence", { appointments, encounters }, sources, problems);
}

// ── 9. PRACTICE GROWTH ───────────────────────────────────────────────────────────────────────────────

export type PracticeGrowthData = {
  /** Period-over-period counts, each earned or refused. Never a percentage, never an arrow by default. */
  comparisons: IntelComparison[];
  /** Every patient this practice has ever registered, as at now. Not windowed: it is a running total. */
  cumulativePatients: { value: number | null; status: IntelStatus; reason: string | null; formula: string; sources: string[] };
  /** How long this practice has been keeping records, which is what licenses any comparison at all. */
  recordingSince: string | null;
  priorPeriod: { fromDay: string; toDay: string; usable: boolean; reason: string | null };
};

/**
 * PRACTICE GROWTH -- is this practice growing, and by how many.
 *
 * TABLES/COLUMNS: practice_patient.created_at, .status (migration 193); practice_workspace.created_at
 * (191); plus the six comparable section 8 metrics, computed by metrics.ts over both windows.
 *
 * ⚠ THIS IS THE MODULE THE COMP'S "↑18% vs previous 30 days" BELONGS TO, AND IT IS WHERE THE REFUSAL
 * MATTERS MOST. A growth page is read by somebody deciding whether to hire, to open a second site, or to
 * keep going. Every comparison here is gated twice -- the prior window must have existed for the whole of
 * its length (practice_workspace.created_at), and the two windows together must carry
 * MIN_OBSERVATIONS_FOR_COMPARISON records -- and when either gate closes the figure is null with the
 * reason attached, never a 0% and never an arrow pointing at nothing.
 *
 * The comparisons are the SAME OBJECTS the Overview module carries, computed once by the assembler and
 * passed to both, so the two pages cannot disagree about the same difference.
 */
export async function practiceGrowth(
  admin: any, ctx: WorkspaceContext, range: IntelRange, comparisons: IntelComparison[],
): Promise<IntelModule<PracticeGrowthData>> {
  const sources = ["practice_patient.created_at", "practice_patient.status", "practice_workspace.created_at"];
  const cumulativeFormula = "count of all practice_patient rows whose status is not 'merged', with no date filter -- a running total, not a period count";
  const cumulativeSources = ["practice_patient.status"];

  const problems: string[] = [];
  const [total, workspace] = await Promise.all([
    hasCapability(ctx, CAP_PATIENT_LIST)
      ? intelCount(admin.from("practice_patient").select("id", { count: "exact", head: true })
        .eq("workspace_id", ctx.workspaceId).neq("status", "merged"))
      : Promise.resolve(null),
    admin.from("practice_workspace").select("created_at").eq("id", ctx.workspaceId).maybeSingle(),
  ]);

  const cumulativePatients = total === null
    ? { value: null, status: "not_permitted" as IntelStatus, reason: `${CAP_PATIENT_LIST} is required to see how many patients this practice has`, formula: cumulativeFormula, sources: cumulativeSources }
    : total.error
      ? { value: null, status: "unreadable" as IntelStatus, reason: `could not be read: ${total.error}`, formula: cumulativeFormula, sources: cumulativeSources }
      : total.count === null
        ? { value: null, status: "unreadable" as IntelStatus, reason: "the patient register returned no count", formula: cumulativeFormula, sources: cumulativeSources }
        : { value: total.count, status: "ok" as IntelStatus, reason: null, formula: cumulativeFormula, sources: cumulativeSources };
  if (cumulativePatients.status === "unreadable") problems.push(`cumulative patients: ${cumulativePatients.reason}`);

  const createdAt = (workspace as any)?.data?.created_at;
  if ((workspace as any)?.error) problems.push(`recording since: ${(workspace as any).error.message ?? "read failed"}`);

  return intelModule("practice_growth", "Practice Growth", {
    comparisons,
    cumulativePatients,
    recordingSince: typeof createdAt === "string" ? createdAt.slice(0, 10) : null,
    priorPeriod: {
      fromDay: range.prior.fromDay, toDay: range.prior.toDay,
      usable: range.priorUsable, reason: range.priorReason,
    },
  }, sources, problems);
}

// ── 10. AI PRACTICE INTELLIGENCE ─────────────────────────────────────────────────────────────────────

export type GroundedFigure = {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  /** The calculation, in words. An assistant that cannot state this may not state the number. */
  formula: string;
  /** table.column identifiers. CORE-001 s16's "traceable basis", carried rather than promised. */
  sources: string[];
  periodFromDay: string;
  periodToDay: string;
};

export type RefusedClaim = {
  claim: string;
  why: string;
  /** What would have to exist in this product before the claim could be made at all. */
  wouldRequire: string;
};

export type AiPracticeIntelligenceData = {
  /** The complete set of figures an assistant may cite about this practice, and nothing else. */
  authorisedFigures: GroundedFigure[];
  /** Claims the design asks for that cannot be grounded. Named so they are refused rather than forgotten. */
  refusedClaims: RefusedClaim[];
  /** Always true. This module produces no sentence, no prediction and no comparison of its own. */
  groundingOnly: true;
  asOfIso: string;
};

/**
 * AI PRACTICE INTELLIGENCE -- THE GROUNDING CONTRACT, NOT THE INSIGHTS.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THE COMP'S AI CARD READS: "your headache/migraine follow-up completion rate is 14% lower than
 * average. Consider earlier review scheduling." THAT SENTENCE IS NOT IMPLEMENTABLE AND IT IS IMPORTANT TO
 * SAY EXACTLY WHY, BECAUSE IT LOOKS SO REASONABLE.
 *
 * "Lower than average" requires an average of OTHER PRACTICES. This product holds one practice's records
 * per workspace, has no cross-tenant read path, no consented data-sharing agreement, no case-mix
 * adjustment and no approved statistical method. Manufacturing a baseline from the practice's own other
 * diagnoses would be a different claim wearing the same words -- and a practitioner reading "14% lower
 * than average" will reasonably assume it means other doctors.
 *
 * CORE-001 s3: "No fabricated intelligence: No comparison, prediction or clinical cohort is shown unless
 * supported by recorded data and an approved method." s16: "No AI statement appears without authorised
 * source data and a traceable basis."
 *
 * So this module generates NO SENTENCES. It returns the exact set of figures an assistant is authorised
 * to cite about this practice, each carrying its own formula and its own table.column sources, plus the
 * claims that were REFUSED and what each would require. An assistant grounded on this can say "your
 * follow-up completion for this period was 72 of 96, and 31 of those are not yet due"; it cannot say
 * "lower than average", because no figure it has been handed is an average of anything.
 *
 * It also calls no model and writes no row: the AI orchestration layer is CPR-210's, and CORE-001 s4 is
 * explicit that the assistant "does not become a source of truth".
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
export function aiPracticeIntelligence(
  range: IntelRange, metrics: PracticeMetrics, comparisons: IntelComparison[], atTime: Date = new Date(),
): IntelModule<AiPracticeIntelligenceData> {
  const period = { periodFromDay: range.period.fromDay, periodToDay: range.period.toDay };

  const authorisedFigures: GroundedFigure[] = [
    // Only metrics that STAND. A null is not a fact about a practice and must never be handed to a
    // generator, which will reach for a plausible number the moment it is given a labelled blank.
    ...Object.values(metrics.metrics)
      .filter(m => m.status === "ok" && m.value !== null)
      .map(m => ({ key: m.key, label: m.label, value: m.value, unit: m.unit, formula: m.formula, sources: m.sources, ...period })),
    // And only comparisons that were EARNED. A refused comparison is deliberately absent rather than
    // present-and-null, for the same reason.
    ...comparisons
      .filter(c => c.status === "ok" && c.change !== null)
      .map(c => ({
        key: `${c.key}_change`, label: `${c.label}: change against ${range.prior.label}`,
        value: c.change, unit: "count", formula: c.formula, sources: c.sources, ...period,
      })),
  ];

  const refusedClaims: RefusedClaim[] = [
    {
      claim: "Your follow-up completion for a given condition is lower than average.",
      why: "There is no average. This product holds one practice per workspace, has no cross-tenant read path and no consented data-sharing arrangement, so there is no population to be below.",
      wouldRequire: "A consented multi-practice dataset, an approved case-mix adjustment, and a documented statistical method -- none of which exists in this product or is specified anywhere in CPR-V5-003.",
    },
    {
      claim: "Any comparison against similar practices, peers, national figures or benchmarks.",
      why: "Identical to the above and named separately because the comp uses all four words. Comparing needs practices this product has never seen.",
      wouldRequire: "The same consented dataset, plus a defensible definition of 'similar' that a practitioner could challenge.",
    },
    {
      claim: "A percentage change against the previous period where the previous period was not real.",
      why: "A practice younger than the window it is being compared against has no previous period, and rendering the shortfall as a fall in activity is the most misleading thing this workspace could show. See IntelComparison.",
      wouldRequire: "Nothing further -- it is computed and returned whenever it IS real, and refused with a reason whenever it is not.",
    },
    {
      claim: "A prediction of future volume, risk, no-show likelihood or deterioration.",
      why: "No model is trained, validated or approved in this product, and an unvalidated clinical prediction shown next to real counts inherits their credibility.",
      wouldRequire: "A specified model, a validation set, a recorded approval and a disclosure that it is a prediction. CPR-V5-003 specifies none of these.",
    },
    {
      claim: "A clinical recommendation, such as scheduling reviews earlier for a named condition.",
      why: "CORE-001 s4: the assistant 'does not become a source of truth'. A recommendation derived from a count is guidance this product has no authority to issue.",
      wouldRequire: "An approved clinical rule base with provenance, which is CPR-210's territory and is not built.",
    },
  ];

  return intelModule("ai_practice_intelligence", "AI Practice Intelligence", {
    authorisedFigures, refusedClaims, groundingOnly: true as const, asOfIso: atTime.toISOString(),
  }, ["src/lib/practice/metrics.ts (every figure carries its own sources)"], []);
}

// ── THE ASSEMBLER ────────────────────────────────────────────────────────────────────────────────────

export type PracticeIntelligenceWorkspace = {
  /** s12: "Every dashboard response must include an as_of timestamp and timezone." */
  asOfIso: string;
  timezone: string;
  range: IntelRange;
  /** False when the caller may not see reports at all. Every module then carries the same reason. */
  permitted: boolean;
  /** True when the caller holds patient.view. Counts without names is a real state, not a degraded one. */
  identified: boolean;
  modules: {
    overview: IntelModule<OverviewData>;
    clinicalActivity: IntelModule<ClinicalActivityData>;
    patients: IntelModule<PatientIntelligenceData>;
    orders: IntelModule<never>;
    procedures: IntelModule<ProcedureIntelligenceData>;
    followUps: IntelModule<FollowUpIntelligenceData>;
    documents: IntelModule<DocumentIntelligenceData>;
    locations: IntelModule<LocationIntelligenceData>;
    growth: IntelModule<PracticeGrowthData>;
    ai: IntelModule<AiPracticeIntelligenceData>;
  };
  /** The doctrine, in the payload, so no client can render any of this as a rate. */
  ratesComputed: false;
  /** True only when NOTHING could be read. One dead table must not blank the workspace (s14). */
  unavailable: boolean;
};

/**
 * The whole workspace, for one range.
 *
 * CPR-V5-003 UX: "Dashboard with drill-down views. Global filters. Exports. No direct data entry." This
 * is the read model behind all four; it writes nothing, and the caller owns the access log (see the
 * section header on why the logging is not in here).
 *
 * THE SHARED READS HAPPEN ONCE AND ARE PASSED DOWN. practiceMetrics, caseMix and outcomePicture are each
 * called exactly once and their results handed to every module that needs them, so no two modules can
 * disagree about the same figure and a clinic's connectivity is not spent reading the same table five
 * times. That is s16 enforced by construction rather than by convention.
 *
 * EACH MODULE FAILS ALONE -- s14 partial failure: "Render available cards and show retry on the failed
 * card." A module that could not read returns its reason; the other nine stand.
 */
export async function practiceIntelligenceWorkspace(
  admin: any, ctx: WorkspaceContext, opts: { fromDay?: string; toDay?: string; days?: number } = {},
  atTime: Date = new Date(),
): Promise<PracticeIntelligenceWorkspace> {
  const range = await intelRange(admin, ctx.workspaceId, opts);
  const permitted = hasCapability(ctx, CAP_REPORT);

  // report.view is the gate on the whole workspace -- navigation.ts gates the route on it and migration
  // 191 grants it to every role that has any business reading a report. Refused here as a stated reason
  // on every module rather than as an empty page, so the shell can explain itself (s14 permission denied:
  // "Hide or disable the action with an explanatory message").
  if (!permitted) {
    const reason = `${CAP_REPORT} is required to see practice intelligence`;
    return {
      asOfIso: atTime.toISOString(), timezone: range.timezone, range, permitted: false, identified: false,
      modules: {
        overview: intelUnavailable("overview", "Overview", reason),
        clinicalActivity: intelUnavailable("clinical_activity", "Clinical Activity", reason),
        patients: intelUnavailable("patient_intelligence", "Patient Intelligence", reason),
        orders: ordersIntelligence(),
        procedures: intelUnavailable("procedure_intelligence", "Procedure Intelligence", reason),
        followUps: intelUnavailable("followup_intelligence", "Follow-up Intelligence", reason),
        documents: intelUnavailable("document_intelligence", "Document Intelligence", reason),
        locations: intelUnavailable("location_intelligence", "Location Intelligence", reason),
        growth: intelUnavailable("practice_growth", "Practice Growth", reason),
        ai: intelUnavailable("ai_practice_intelligence", "AI Practice Intelligence", reason),
      },
      ratesComputed: false, unavailable: true,
    };
  }

  // The shared reads, once. Overview owns practiceMetrics; caseMix and outcomePicture are this file's
  // existing owners of the diagnosis, procedure-label and outcome counts.
  const [overview, mix, outcomes] = await Promise.all([
    overviewIntelligence(admin, ctx, range),
    caseMix(admin, ctx, range.period),
    outcomePicture(admin, ctx, range.period),
  ]);

  const metrics = overview.data!.metrics;
  const comparisons = overview.data!.comparisons;

  const [clinicalActivity, patients, procedures, followUps, documents, locations, growth] = await Promise.all([
    clinicalActivityIntelligence(admin, ctx, range, metrics),
    patientIntelligence(admin, ctx, range, metrics),
    procedureIntelligence(admin, ctx, range, outcomes, mix),
    followUpIntelligence(admin, ctx, range, metrics, outcomes),
    documentIntelligence(admin, ctx, range),
    locationIntelligence(admin, ctx, range),
    practiceGrowth(admin, ctx, range, comparisons),
  ]);

  const modules = {
    overview, clinicalActivity, patients,
    orders: ordersIntelligence(),
    procedures, followUps, documents, locations, growth,
    ai: aiPracticeIntelligence(range, metrics, comparisons, atTime),
  };

  return {
    asOfIso: atTime.toISOString(),
    timezone: range.timezone,
    range,
    permitted: true,
    identified: hasCapability(ctx, CAP_PATIENT_VIEW),
    modules,
    ratesComputed: false,
    // Orders is unavailable by design and the AI module is always computable, so neither counts toward a
    // total failure. Only a workspace where every module that HAS a store produced nothing at all is
    // unavailable -- a module that is honestly empty because nothing happened is a working page, not a
    // broken one, and a module carrying a disclosure in `problems` still produced its data.
    unavailable: metrics.unavailable
      && [clinicalActivity, patients, procedures, followUps, documents, locations, growth]
        .every(m => m.data === null),
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PI-001 / CPR-PI-002 / CPR-PI-003 -- THE CONSOLIDATED PRACTICE INTELLIGENCE SUITE
// ════════════════════════════════════════════════════════════════════════════════════════════════════
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// EVERYTHING BELOW COMPOSES. NOT ONE FIGURE IS RECOMPUTED FROM A TABLE ANOTHER ENGINE ALREADY OWNS.
//
// CPR-PI-001 s2 asks the suite to answer three questions -- what needs my attention now, what do my
// records tell me, what should I do next -- and CPR-PI-002 s1 asks for "a single analytical engine".
// The single engine already exists: metrics.ts owns the twelve definitions, reports.ts owns the period
// and the diagnosis counts, operations-home.ts owns the attention list, brief.ts owns the derived brief,
// follow-ups.ts owns the obligation taxonomy, pathways.ts owns enrolment and stage progression, and the
// CPR-V5-003 section above owns the distributions and the comparisons.
//
// So this section adds exactly four things that genuinely did not exist, and assembles the rest:
//
//   1. PATIENT ATTENTION -- s5's "patients overdue, inactive, lost to follow-up", as date rules, WITH
//      s5's "improving, deteriorating, high complexity" refused in the position they would occupy.
//   2. COHORTS -- s5's "define and analyse patient groups", over attributes the record actually holds.
//   3. PATHWAY STATUS as an intelligence lens -- milestones whose date has passed, drawn from the
//      pathways engine rather than from a second read of its tables.
//   4. THE PRIORITY STRIP AND THE SUITE ASSEMBLER -- s7's overview, and s6's nine areas as one payload.
//
// ⚠ THE COMPS ARE FULL OF RATES AND NONE OF THEM SURVIVE. "82% Follow-up Compliance", "78% of VP shunt
// patients had no complications", donut slices labelled "6 (33%)" and "22 (25%)", and "up 12% vs last
// week" on every tile. Counts and denominators as SEPARATE values -- see findRates in
// intelligence-constants.ts, which the harness runs over this entire payload.
//
// ⚠ THE COMPS ALSO SHOW A SIDEBAR SUBMENU AND s4 FORBIDS ONE. The nine areas are tabs. Nothing in this
// file registers a navigation entry.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The pathway capability, from migration 239 (`('practitioner', 'pathway.view')`). Read, not remembered. */
const CAP_PATHWAY_VIEW = "pathway.view";

/**
 * How far a figure can be traced. Attached to EVERY group and slice below.
 *
 * s15's fifth acceptance criterion: "All metrics identify their date range and source definition." That
 * is also the fix for a comp full of unexplained numbers -- "18 Follow-ups Due" over what window, from
 * which table, counting obligations or counting people? Every answer below travels with its figure.
 */
export type Provenance = {
  /** The calculation, in words a practitioner could check with a calendar. */
  formula: string;
  /** table.column identifiers. */
  sources: string[];
  /** The window, as calendar days in the practice's own timezone. Null when the figure is "as of now". */
  fromDay: string | null;
  toDay: string | null;
  /** The instant the figure was computed, for a figure that has no window. */
  asOf: string;
  /** Where the number came from, so a screen cannot label arithmetic as AI. */
  provenance: "computed" | "derived" | "ai";
};

/**
 * A figure that is the length of a list somebody can open.
 *
 * s15: "Users can drill from an insight to its source patient, encounter, follow-up, document or
 * pathway." That is not a property of a screen, it is a property of a payload: a count with no ids
 * behind it CANNOT be made drillable by any amount of UI work, so the ids travel with the count.
 */
export type OpenableCount = {
  key: string;
  label: string;
  /** What this counts, in one sentence, including the threshold where a threshold was chosen. */
  definition: string;
  count: number | null;
  status: IntelStatus;
  reason: string | null;
  /** Real rows, so the figure is a worklist. Empty when the caller may not see names. */
  sample: { id: string; label: string; note: string | null; href: string | null }[];
  /** True when `count` exceeds the rows listed, so nobody reads the sample as the whole. */
  sampleIsPartial: boolean;
  /** Where the whole list lives. */
  href: string;
} & Provenance;

const openable = (
  key: string, label: string, definition: string, href: string, prov: Provenance,
): OpenableCount => ({
  key, label, definition, count: null, status: "unknowable", reason: null,
  sample: [], sampleIsPartial: false, href, ...prov,
});

/** How many rows travel with a count. Enough to make it a worklist, few enough to stay a payload. */
const SAMPLE_SIZE = 6;

// ── 1. PATIENT ATTENTION: THE DATE RULES, AND THE THREE JUDGEMENTS THAT ARE REFUSED ──────────────────

export type PatientAttentionData = {
  /** The three s5 states that are arithmetic on dates. Each drillable. */
  groups: OpenableCount[];
  /**
   * The three s5 states that are clinical judgements nothing in this product recorded.
   *
   * PRESENT IN THE PAYLOAD, not omitted, so a screen renders them IN THE POSITION THEY WOULD OCCUPY
   * with the reason. An omitted card teaches nothing; a card saying "this cannot be computed, and here
   * is what it would take" is the difference between a gap and a lie.
   */
  refused: RefusedState[];
  /** The practice's own today, which every rule below is measured against. */
  today: string;
  /** False when the caller lacks patient.view: counts stand, names do not travel. */
  identified: boolean;
};

/**
 * PATIENT INTELLIGENCE -- s5's list, split down the line between a date and a judgement.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ s5 ASKS FOR SEVEN STATES AND ONLY FOUR OF THEM ARE KNOWABLE. Overdue, inactive, lost to follow-up
 * and "requiring attention" are arithmetic on dates. Improving, deteriorating and high complexity are
 * judgements with NO STORE -- see REFUSED_PATIENT_STATES for each one and what would make it real.
 *
 * The proxies are available and every one of them is worse than nothing. Fewer visits lately is exactly
 * what a patient who deteriorated and went elsewhere looks like. A follow-up closed with outcome_code
 * `improved` describes one obligation on one day, not a person over time. Counting problems calls
 * somebody with four minor entries more complex than somebody with one serious one. Each would render
 * as a confident chip beside real counts and inherit their credibility.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ THE THRESHOLDS ARE EDITORIAL AND THEY TRAVEL IN THE PAYLOAD. "Inactive" is not a property of a
 * patient, it is a property of a number somebody picked; 180 days is a choice, and a count shown without
 * it invites being read as clinical.
 *
 * TABLES/COLUMNS: practice_patient.id/.display_name/.status/.created_at (193);
 * practice_encounter.patient_id/.started_at/.status (194); practice_follow_up.patient_id/.due_on/.status
 * (196). Capabilities: patient.list to count, patient.view to name, followup.view for the obligations.
 */
export async function patientAttentionIntelligence(
  admin: any, ctx: WorkspaceContext, range: IntelRange, atTime: Date = new Date(),
): Promise<IntelModule<PatientAttentionData>> {
  const today = practiceToday(range.timezone, atTime);
  const asOf = atTime.toISOString();
  const identified = hasCapability(ctx, CAP_PATIENT_VIEW);
  const canList = hasCapability(ctx, CAP_PATIENT_LIST);
  const canFollowUps = hasCapability(ctx, CAP_FOLLOWUP_VIEW);
  const canEncounters = hasCapability(ctx, CAP_ENCOUNTER_LIST);

  const sources = [
    "practice_patient.id", "practice_patient.status", "practice_patient.created_at",
    "practice_encounter.patient_id", "practice_encounter.started_at",
    "practice_follow_up.patient_id", "practice_follow_up.due_on", "practice_follow_up.status",
  ];

  const prov = (formula: string, src: string[]): Provenance => ({
    formula, sources: src, fromDay: null, toDay: null, asOf, provenance: "computed",
  });

  const overdueProv = prov(
    `count of DISTINCT patients holding at least one follow-up whose status is OPEN or SCHEDULED and whose due_on is earlier than ${today} in this practice's calendar; a patient owed three late reviews is counted once`,
    ["practice_follow_up.due_on", "practice_follow_up.status", "practice_follow_up.patient_id"],
  );
  const inactiveProv = prov(
    `count of patients whose status is active and whose most recent encounter started more than ${INACTIVE_AFTER_DAYS} days before ${today}, together with those who have no encounter at all and were registered more than ${INACTIVE_AFTER_DAYS} days ago; ${INACTIVE_AFTER_DAYS} days is a choice made here, not a clinical standard`,
    ["practice_patient.status", "practice_patient.created_at", "practice_encounter.started_at"],
  );
  const lostProv = prov(
    `count of patients holding an OPEN or SCHEDULED follow-up whose due_on passed more than ${LOST_TO_FOLLOW_UP_AFTER_DAYS} days before ${today} AND who have had no encounter since that due date; ${LOST_TO_FOLLOW_UP_AFTER_DAYS} days is a choice made here, not a clinical standard`,
    ["practice_follow_up.due_on", "practice_follow_up.status", "practice_encounter.started_at"],
  );

  const groups: OpenableCount[] = [
    openable("overdue", "Overdue for a follow-up",
      `An obligation this practice recorded has passed its date. As of ${today}.`,
      "/practice/follow-ups?view=overdue", overdueProv),
    openable("inactive", "Inactive",
      `No encounter in the last ${INACTIVE_AFTER_DAYS} days. The threshold is this product's choice and is stated so it can be argued with.`,
      "/practice/patients", inactiveProv),
    openable("lost_to_follow_up", "Lost to follow-up",
      `An obligation went more than ${LOST_TO_FOLLOW_UP_AFTER_DAYS} days past its date and the person has not been back since.`,
      "/practice/follow-ups?view=overdue", lostProv),
  ];

  const data: PatientAttentionData = {
    groups, refused: REFUSED_PATIENT_STATES, today, identified,
  };

  // ── PERMISSION IS AN ANSWER, NOT AN EMPTY LIST ─────────────────────────────────────────────────────
  if (!canList) {
    for (const g of groups) { g.status = "not_permitted"; g.reason = `${CAP_PATIENT_LIST} is required to count patients`; }
    return intelModule("patient_attention", "Patient Attention", data, sources,
      [`${CAP_PATIENT_LIST} withheld, so no patient state could be counted`]);
  }

  const problems: string[] = [];

  // Patients first: everything else is joined onto them, and an unreadable patient list makes every
  // group below wrong rather than empty.
  const patientRead = await intelRows(admin.from("practice_patient")
    .select("id, display_name, created_at")
    .eq("workspace_id", ctx.workspaceId).eq("status", "active"));

  if (patientRead.error || patientRead.overflowed) {
    const reason = patientRead.error
      ? `the patient list could not be read: ${patientRead.error}`
      : overflowNote("patients");
    for (const g of groups) { g.status = "unreadable"; g.reason = reason; }
    return intelModule("patient_attention", "Patient Attention", data, sources, [reason]);
  }

  const patients = patientRead.rows;
  const nameById = new Map<string, string>(patients.map(p => [p.id as string, String(p.display_name ?? "")]));
  const registeredById = new Map<string, string>(patients.map(p => [p.id as string, String(p.created_at ?? "")]));

  const dayDiff = (from: string, to: string) =>
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

  // A sample row, de-identified when the caller may not see names. Ids are stable identifiers and are
  // carried either way (brief.ts's rule: enough to find the row, not enough to be a disclosure).
  const row = (patientId: string, note: string | null) => ({
    id: patientId,
    label: identified ? (nameById.get(patientId) || "Unnamed record") : `Patient ${patientId.slice(0, 8)}`,
    note,
    href: identified ? `/practice/patients/${patientId}` : null,
  });

  const settle = (
    g: OpenableCount, ids: string[], noteFor: (id: string) => string | null,
  ) => {
    g.status = "ok";
    g.reason = null;
    g.count = ids.length;
    g.sample = ids.slice(0, SAMPLE_SIZE).map(id => row(id, noteFor(id)));
    g.sampleIsPartial = ids.length > g.sample.length;
    if (!identified) g.reason = "counted, and not named: you hold reporting access but not clinical access";
  };

  // ── LAST ENCOUNTER PER PATIENT ─────────────────────────────────────────────────────────────────────
  //
  // ⚠ NOT FILTERED TO THE REPORTING PERIOD. "Inactive" asks when somebody was LAST seen, which is a
  // question about the whole record; scoping it to the selected 30 days would call every patient in the
  // practice inactive whenever a practitioner picked a short window.
  const lastSeen = new Map<string, string>();
  let encountersReadable = canEncounters;
  if (canEncounters) {
    const encRead = await intelRows(admin.from("practice_encounter")
      .select("patient_id, started_at")
      .eq("workspace_id", ctx.workspaceId)
      .not("status", "in", "(CANCELLED,ENTERED_IN_ERROR)")
      .order("started_at", { ascending: false }), INTEL_ROW_CAP);
    if (encRead.error || encRead.overflowed) {
      encountersReadable = false;
      problems.push(encRead.error
        ? `encounter history: ${encRead.error}`
        : `encounter history: ${overflowNote("encounters")}`);
    } else {
      // Ordered newest first, so the FIRST time a patient appears is their most recent encounter.
      for (const e of encRead.rows) {
        const pid = e.patient_id as string;
        if (!pid || lastSeen.has(pid)) continue;
        const at = typeof e.started_at === "string" ? e.started_at.slice(0, 10) : null;
        if (at) lastSeen.set(pid, at);
      }
    }
  }

  // ── OPEN OBLIGATIONS ───────────────────────────────────────────────────────────────────────────────
  let followUpsReadable = canFollowUps;
  const openFollowUps: { patient_id: string; due_on: string }[] = [];
  if (canFollowUps) {
    const fuRead = await intelRows(admin.from("practice_follow_up")
      .select("patient_id, due_on, status")
      .eq("workspace_id", ctx.workspaceId).in("status", ["OPEN", "SCHEDULED"])
      .lt("due_on", today));
    if (fuRead.error || fuRead.overflowed) {
      followUpsReadable = false;
      problems.push(fuRead.error
        ? `open follow-ups: ${fuRead.error}`
        : `open follow-ups: ${overflowNote("follow-ups")}`);
    } else {
      for (const f of fuRead.rows) {
        if (typeof f.patient_id === "string" && typeof f.due_on === "string")
          openFollowUps.push({ patient_id: f.patient_id, due_on: f.due_on });
      }
    }
  }

  // ── OVERDUE ────────────────────────────────────────────────────────────────────────────────────────
  const overdue = groups[0];
  if (!canFollowUps) {
    overdue.status = "not_permitted";
    overdue.reason = `${CAP_FOLLOWUP_VIEW} is required to see obligations`;
  } else if (!followUpsReadable) {
    overdue.status = "unreadable";
    overdue.reason = "the open follow-ups could not be read, so this is deliberately blank rather than nought";
  } else {
    // Oldest obligation per patient: it is the one that explains the flag.
    const oldest = new Map<string, string>();
    for (const f of openFollowUps) {
      const prev = oldest.get(f.patient_id);
      if (!prev || f.due_on < prev) oldest.set(f.patient_id, f.due_on);
    }
    const ids = [...oldest.keys()].sort((a, b) => (oldest.get(a)! < oldest.get(b)! ? -1 : 1));
    settle(overdue, ids, id => {
      const due = oldest.get(id)!;
      const n = dayDiff(due, today);
      return `${n} day${n === 1 ? "" : "s"} past its date (due ${due})`;
    });
  }

  // ── INACTIVE ───────────────────────────────────────────────────────────────────────────────────────
  const inactive = groups[1];
  if (!canEncounters) {
    inactive.status = "not_permitted";
    inactive.reason = `${CAP_ENCOUNTER_LIST} is required to know when somebody was last seen`;
  } else if (!encountersReadable) {
    inactive.status = "unreadable";
    inactive.reason = "the encounter history could not be read, so 'not seen recently' cannot be distinguished from 'not readable'";
  } else {
    const flagged: { id: string; note: string }[] = [];
    for (const p of patients) {
      const id = p.id as string;
      const seen = lastSeen.get(id);
      if (seen) {
        if (dayDiff(seen, today) > INACTIVE_AFTER_DAYS)
          flagged.push({ id, note: `last seen ${seen}` });
      } else {
        // NEVER SEEN IS NOT THE SAME FACT AND IT IS LABELLED DIFFERENTLY. A record registered last week
        // with no encounter is a booking, not a lapse -- so the same threshold is applied to the
        // registration date rather than counting every new record as inactive on day one.
        const registered = (registeredById.get(id) ?? "").slice(0, 10);
        if (registered && dayDiff(registered, today) > INACTIVE_AFTER_DAYS)
          flagged.push({ id, note: `registered ${registered}, never seen` });
      }
    }
    const noteById = new Map(flagged.map(f => [f.id, f.note]));
    settle(inactive, flagged.map(f => f.id), id => noteById.get(id) ?? null);
  }

  // ── LOST TO FOLLOW-UP ──────────────────────────────────────────────────────────────────────────────
  //
  // ⚠ NEEDS BOTH READS AND REFUSES WITHOUT EITHER. "An obligation went past its date AND they have not
  // been back" is a conjunction: with the encounter side missing, every overdue patient would be
  // reported as lost, which is the most alarming possible way to render a failed query.
  const lost = groups[2];
  if (!canFollowUps || !canEncounters) {
    lost.status = "not_permitted";
    lost.reason = `${CAP_FOLLOWUP_VIEW} and ${CAP_ENCOUNTER_LIST} are both required: this asks whether somebody came back after an obligation lapsed`;
  } else if (!followUpsReadable || !encountersReadable) {
    lost.status = "unreadable";
    lost.reason = "one of the two reads this depends on failed; reporting the other half alone would call every overdue patient lost";
  } else {
    const candidates = new Map<string, string>();
    for (const f of openFollowUps) {
      if (dayDiff(f.due_on, today) <= LOST_TO_FOLLOW_UP_AFTER_DAYS) continue;
      const seen = lastSeen.get(f.patient_id);
      // Back since the obligation fell due? Then they are not lost, whatever the follow-up still says.
      if (seen && seen >= f.due_on) continue;
      const prev = candidates.get(f.patient_id);
      if (!prev || f.due_on < prev) candidates.set(f.patient_id, f.due_on);
    }
    const ids = [...candidates.keys()].sort((a, b) => (candidates.get(a)! < candidates.get(b)! ? -1 : 1));
    settle(lost, ids, id => `due ${candidates.get(id)!}, not seen since`);
  }

  return intelModule("patient_attention", "Patient Attention", data, sources, problems);
}

// ── 2. COHORTS ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The attributes a cohort may be defined by.
 *
 * ⚠ EVERY ONE IS A COLUMN THAT EXISTS. s5 says "diagnosis, treatment, procedure, location, pathway, age,
 * outcome or other authorised attributes", and the trailing "other" is where an intelligence workspace
 * usually acquires an attribute nobody records. Each dimension below names the column it reads.
 */
export const COHORT_DIMENSIONS = [
  { key: "diagnosis", label: "Diagnosis", column: "practice_diagnosis.label",
    note: "Counted AS TYPED. Nothing here forces a terminology, so two spellings are two cohorts -- which is visible, whereas silently merging them would not be." },
  { key: "procedure", label: "Procedure", column: "practice_procedure.label",
    note: "The label recorded on the procedure, as typed." },
  { key: "treatment", label: "Treatment", column: "practice_treatment.label",
    note: "What was prescribed or planned, as typed. A plan, not proof it was taken." },
  { key: "sex", label: "Sex", column: "practice_patient.sex",
    note: "Migration 193's five values, including the two that mean 'not answered'." },
  { key: "age_band", label: "Age band", column: "practice_patient.birth_date",
    note: "Bands chosen by this product and named on the page. They are not a WHO or census standard." },
  { key: "location", label: "Location", column: "practice_appointment.location_id",
    note: "Where the patient was booked in the period. A patient seen at two sites appears in both." },
  { key: "pathway", label: "Care pathway", column: "practice_patient_pathway.template_id",
    note: "Which plan the patient is enrolled on. Enrolment, not completion." },
] as const;

export type CohortDimension = (typeof COHORT_DIMENSIONS)[number]["key"];

export const isCohortDimension = (x: unknown): x is CohortDimension =>
  typeof x === "string" && COHORT_DIMENSIONS.some(d => d.key === x);

export type CohortSlice = {
  key: string;
  label: string;
  /** DISTINCT PATIENTS, never rows. A cohort is a group of people. */
  patients: number;
  /** The rows that put them there -- three diagnoses for one person is three rows and one patient. */
  records: number;
  /** Real patient ids, so the cohort opens. Empty when the caller may not see patients. */
  sample: { id: string; label: string; href: string | null }[];
  sampleIsPartial: boolean;
};

export type CohortData = {
  dimension: CohortDimension;
  dimensionLabel: string;
  /** The caveat that belongs to this dimension specifically. */
  note: string;
  slices: CohortSlice[];
  status: IntelStatus;
  reason: string | null;
  /** Distinct patients across every slice. NOT the sum of the slices -- people appear in more than one. */
  patientsInAnySlice: number | null;
  /** Rows whose attribute was blank. Disclosed, never folded into a slice. */
  unclassified: number;
  identified: boolean;
  /** Every other dimension, so a screen can offer them without hard-coding the list. */
  available: { key: string; label: string; note: string }[];
} & Provenance;

/** Age bands. The same bands the CPR-V5-003 module above uses, so one product has one banding. */
const COHORT_AGE_BANDS: [string, string, (age: number) => boolean][] = [
  ["under_1", "Under 1", a => a < 1],
  ["1_4", "1 to 4", a => a >= 1 && a < 5],
  ["5_14", "5 to 14", a => a >= 5 && a < 15],
  ["15_44", "15 to 44", a => a >= 15 && a < 45],
  ["45_64", "45 to 64", a => a >= 45 && a < 65],
  ["65_plus", "65 and over", a => a >= 65],
];

/**
 * COHORT INTELLIGENCE -- s5's "define and analyse patient groups".
 *
 * ⚠ A COHORT IS A COUNT OF PEOPLE AND A LIST OF THEM, NOT A SHARE OF A DONUT. The comps draw this as a
 * ring with slices labelled "48 (55%)" and "22 (25%)". Both halves of that label are shown here and the
 * percentage is not: the slice carries its patient count, its record count and its openable ids, and the
 * denominator sits beside it as its own number.
 *
 * ⚠ DISTINCT PATIENTS, AND THE SLICES DO NOT SUM. One person with hydrocephalus and epilepsy is in two
 * diagnosis slices and is one patient. `patientsInAnySlice` is therefore computed as a set union rather
 * than by adding the slices up, and a screen that adds them will disagree with it -- which is why the
 * union travels rather than being left to the client.
 */
export async function cohortIntelligence(
  admin: any, ctx: WorkspaceContext, range: IntelRange, dimension: CohortDimension,
  atTime: Date = new Date(),
): Promise<IntelModule<CohortData>> {
  const dim = COHORT_DIMENSIONS.find(d => d.key === dimension) ?? COHORT_DIMENSIONS[0];
  const identified = hasCapability(ctx, CAP_PATIENT_VIEW);
  const available = COHORT_DIMENSIONS.map(d => ({ key: d.key, label: d.label, note: d.note }));

  const base: CohortData = {
    dimension: dim.key, dimensionLabel: dim.label, note: dim.note,
    slices: [], status: "unknowable", reason: null, patientsInAnySlice: null, unclassified: 0,
    identified, available,
    formula: "", sources: [dim.column],
    fromDay: range.period.fromDay, toDay: range.period.toDay,
    asOf: atTime.toISOString(), provenance: "computed",
  };

  const refuse = (reason: string) => intelModule<CohortData>("cohorts", "Cohorts",
    { ...base, status: "not_permitted", reason }, [dim.column], []);

  if (!hasCapability(ctx, CAP_PATIENT_LIST))
    return refuse(`${CAP_PATIENT_LIST} is required to group patients`);

  // Every dimension resolves to the same intermediate shape: (patientId, sliceKey, sliceLabel).
  const pairs: { patientId: string; key: string; label: string }[] = [];
  let unclassified = 0;
  let read: IntelRead = { rows: [], error: null, overflowed: false };
  let formula = "";
  const sources: string[] = [dim.column];

  const inPeriod = (q: any, column: string) =>
    q.gte(column, range.period.fromIso).lt(column, range.period.toIso);

  if (dim.key === "diagnosis") {
    if (!hasCapability(ctx, CAP_ENCOUNTER_LIST))
      return refuse(`${CAP_ENCOUNTER_LIST} is required to read diagnoses`);
    sources.push("practice_diagnosis.created_at", "practice_diagnosis.patient_id");
    formula = `distinct patients holding a diagnosis recorded between ${range.period.fromDay} and ${range.period.toDay}, grouped by practice_diagnosis.label exactly as it was typed`;
    read = await intelRows(inPeriod(admin.from("practice_diagnosis")
      .select("label, patient_id").eq("workspace_id", ctx.workspaceId), "created_at"));
    for (const r of read.rows) {
      const label = typeof r.label === "string" ? r.label.trim() : "";
      if (!label || typeof r.patient_id !== "string") { unclassified++; continue; }
      pairs.push({ patientId: r.patient_id, key: label.toLowerCase(), label });
    }
  } else if (dim.key === "procedure" || dim.key === "treatment") {
    if (!hasCapability(ctx, CAP_ENCOUNTER_LIST))
      return refuse(`${CAP_ENCOUNTER_LIST} is required to read these`);
    const table = dim.key === "procedure" ? "practice_procedure" : "practice_treatment";
    const column = dim.key === "procedure" ? "performed_at" : "created_at";
    sources.push(`${table}.${column}`, `${table}.patient_id`);
    formula = `distinct patients with a ${dim.key} recorded between ${range.period.fromDay} and ${range.period.toDay}, grouped by ${table}.label exactly as it was typed`;
    read = await intelRows(inPeriod(admin.from(table)
      .select("label, patient_id").eq("workspace_id", ctx.workspaceId), column));
    for (const r of read.rows) {
      const label = typeof r.label === "string" ? r.label.trim() : "";
      if (!label || typeof r.patient_id !== "string") { unclassified++; continue; }
      pairs.push({ patientId: r.patient_id, key: label.toLowerCase(), label });
    }
  } else if (dim.key === "sex" || dim.key === "age_band") {
    sources.push("practice_patient.status");
    // ⚠ EVERY ACTIVE PATIENT, NOT ONLY THOSE SEEN IN THE PERIOD. Sex and age are properties of a person
    // rather than of an episode, and scoping them to a 7-day window would describe the week's clinic
    // list while wearing the label "this practice's patients".
    const bandedAt = practiceToday(range.timezone, atTime);
    formula = dim.key === "sex"
      ? "every active patient on this practice's register, grouped by practice_patient.sex (migration 193's five values). Not scoped to the reporting period: sex is a property of a person, not of a visit"
      : `every active patient on this practice's register, banded by age at ${bandedAt} from practice_patient.birth_date. Records with no date of birth are reported as unclassified rather than guessed at from an age estimate`;
    read = await intelRows(admin.from("practice_patient")
      .select("id, sex, birth_date").eq("workspace_id", ctx.workspaceId).eq("status", "active"));
    const now = Date.parse(`${bandedAt}T00:00:00Z`);
    for (const r of read.rows) {
      if (typeof r.id !== "string") { unclassified++; continue; }
      if (dim.key === "sex") {
        const sex = typeof r.sex === "string" && r.sex ? r.sex : "";
        if (!sex) { unclassified++; continue; }
        const label = PATIENT_SEXES.find(([k]) => k === sex)?.[1] ?? sex;
        pairs.push({ patientId: r.id, key: sex, label });
      } else {
        if (typeof r.birth_date !== "string" || !r.birth_date) { unclassified++; continue; }
        const age = Math.floor((now - Date.parse(`${r.birth_date}T00:00:00Z`)) / (365.25 * 86400000));
        const band = COHORT_AGE_BANDS.find(([, , test]) => test(age));
        if (!band) { unclassified++; continue; }
        pairs.push({ patientId: r.id, key: band[0], label: band[1] });
      }
    }
  } else if (dim.key === "location") {
    if (!hasCapability(ctx, CAP_CALENDAR_VIEW))
      return refuse(`${CAP_CALENDAR_VIEW} is required to read the diary`);
    sources.push("practice_appointment.scheduled_at", "practice_appointment.patient_id", "practice_location.name");
    formula = `distinct patients with an appointment scheduled between ${range.period.fromDay} and ${range.period.toDay}, grouped by practice_appointment.location_id; somebody seen at two sites is in both groups`;
    const [locRead, apptRead] = await Promise.all([
      intelRows(admin.from("practice_location").select("id, name").eq("workspace_id", ctx.workspaceId)),
      intelRows(inPeriod(admin.from("practice_appointment")
        .select("location_id, patient_id").eq("workspace_id", ctx.workspaceId), "scheduled_at")),
    ]);
    read = locRead.error || locRead.overflowed ? locRead : apptRead;
    const locName = new Map<string, string>(locRead.rows.map(l => [l.id as string, String(l.name ?? "")]));
    for (const r of apptRead.rows) {
      if (typeof r.patient_id !== "string" || typeof r.location_id !== "string") { unclassified++; continue; }
      pairs.push({ patientId: r.patient_id, key: r.location_id, label: locName.get(r.location_id) ?? "Unnamed location" });
    }
  } else {
    if (!hasCapability(ctx, CAP_PATHWAY_VIEW))
      return refuse(`${CAP_PATHWAY_VIEW} is required to read pathway enrolment`);
    sources.push("practice_patient_pathway.template_id", "practice_pathway_template.name");
    formula = "distinct patients with an ACTIVE pathway enrolment right now, grouped by the template they are on. Enrolment, not completion, and not scoped to the reporting period -- a plan running today started before it";
    const [enrolRead, tplRead] = await Promise.all([
      intelRows(admin.from("practice_patient_pathway")
        .select("patient_id, template_id, status").eq("workspace_id", ctx.workspaceId).eq("status", "active")),
      intelRows(admin.from("practice_pathway_template").select("id, name").eq("workspace_id", ctx.workspaceId)),
    ]);
    read = enrolRead.error || enrolRead.overflowed ? enrolRead : tplRead;
    const tplName = new Map<string, string>(tplRead.rows.map(t => [t.id as string, String(t.name ?? "")]));
    for (const r of enrolRead.rows) {
      if (typeof r.patient_id !== "string" || typeof r.template_id !== "string") { unclassified++; continue; }
      pairs.push({ patientId: r.patient_id, key: r.template_id, label: tplName.get(r.template_id) ?? "Unnamed pathway" });
    }
  }

  if (read.error || read.overflowed) {
    const reason = read.error ? `could not be read: ${read.error}` : overflowNote("records");
    return intelModule("cohorts", "Cohorts",
      { ...base, formula, sources, status: "unreadable" as IntelStatus, reason }, sources, [reason]);
  }

  // Names, only where the caller may see them.
  const patientIds = [...new Set(pairs.map(p => p.patientId))];
  const nameById = new Map<string, string>();
  if (identified && patientIds.length > 0) {
    const nameRead = await intelIn(admin, "practice_patient", "id, display_name", ctx.workspaceId, "id", patientIds);
    for (const p of nameRead.rows) nameById.set(p.id as string, String(p.display_name ?? ""));
  }

  const byKey = new Map<string, { label: string; patients: Set<string>; records: number }>();
  for (const p of pairs) {
    if (!byKey.has(p.key)) byKey.set(p.key, { label: p.label, patients: new Set(), records: 0 });
    const s = byKey.get(p.key)!;
    s.patients.add(p.patientId);
    s.records++;
  }

  const slices: CohortSlice[] = [...byKey.entries()]
    .map(([key, s]) => {
      const ids = [...s.patients];
      return {
        key, label: s.label, patients: ids.length, records: s.records,
        sample: identified
          ? ids.slice(0, SAMPLE_SIZE).map(id => ({
            id, label: nameById.get(id) || "Unnamed record", href: `/practice/patients/${id}`,
          }))
          : [],
        sampleIsPartial: identified ? ids.length > SAMPLE_SIZE : ids.length > 0,
      };
    })
    .sort((a, b) => b.patients - a.patients || a.label.localeCompare(b.label))
    .slice(0, 25);

  return intelModule("cohorts", "Cohorts", {
    ...base, formula, sources, slices, status: "ok" as IntelStatus, reason: null,
    patientsInAnySlice: patientIds.length, unclassified,
  }, sources, []);
}

// ── 3. PATHWAY STATUS AS AN INTELLIGENCE LENS ────────────────────────────────────────────────────────

export type PathwayIntelligenceData = {
  /** The pathways engine's own cards, unchanged. Not recounted here. */
  cards: { key: string; label: string; blurb: string; count: number | null; ids: string[] }[];
  /** Milestones whose date has passed, and the ones coming up. Both openable. */
  milestonesPassed: OpenableCount;
  milestonesUpcoming: OpenableCount;
  status: IntelStatus;
  reason: string | null;
};

/** A stage due within this many days counts as upcoming. Stated, because it is a choice. */
export const UPCOMING_MILESTONE_DAYS = 14;

/**
 * CARE PATHWAY INTELLIGENCE -- s5's "enrolment, stage progression, delays, missed milestones".
 *
 * ⚠ IT CALLS THE PATHWAYS ENGINE. It does not read practice_patient_pathway itself. A second reader of
 * those tables would compute "overdue" from its own arithmetic and disagree with the Pathways workspace
 * the first time somebody changed how a stage's due date is derived -- and the two screens would each
 * look internally consistent while contradicting each other.
 *
 * ⚠ THE COMPS DRAW AN "AT RISK" RING SEGMENT AND THERE IS NO SUCH STATE. pathways.ts refuses it by name:
 * a stage is before its date or past it, and "at risk" would need a prediction about whether it is going
 * to be met. That refusal is inherited here rather than worked around.
 */
export async function pathwayIntelligence(
  admin: any, ctx: WorkspaceContext, atTime: Date = new Date(),
): Promise<IntelModule<PathwayIntelligenceData>> {
  const sources = [
    "practice_patient_pathway.status", "practice_patient_pathway_stage.due_on",
    "src/lib/practice/pathways.ts (pathwayWorkspace owns every figure below)",
  ];
  const asOf = atTime.toISOString();

  const prov = (formula: string): Provenance => ({
    formula, sources, fromDay: null, toDay: null, asOf, provenance: "derived",
  });

  const passed = openable("milestones_passed", "Milestones past their date",
    "The live stage of an active pathway whose due date has gone by. Derived from the date against this practice's today -- never stored.",
    "/practice/pathways", prov("count of ACTIVE enrolments whose live stage's due_on is earlier than this practice's today, as pathwayWorkspace derives it"));

  const upcoming = openable("milestones_upcoming", "Milestones coming up",
    `The live stage of an active pathway due within ${UPCOMING_MILESTONE_DAYS} days. ${UPCOMING_MILESTONE_DAYS} days is a choice made here.`,
    "/practice/pathways", prov(`count of ACTIVE enrolments whose live stage's due_on falls between today and ${UPCOMING_MILESTONE_DAYS} days ahead`));

  const both = (status: IntelStatus, reason: string) => {
    passed.status = status; passed.reason = reason;
    upcoming.status = status; upcoming.reason = reason;
  };

  if (!hasCapability(ctx, CAP_PATHWAY_VIEW)) {
    const reason = `${CAP_PATHWAY_VIEW} is required to see care pathways`;
    both("not_permitted", reason);
    return intelModule("pathways", "Care Pathways", {
      cards: [], milestonesPassed: passed, milestonesUpcoming: upcoming,
      status: "not_permitted" as IntelStatus, reason,
    }, sources, []);
  }

  // ⚠ IMPORTED, NOT REIMPLEMENTED. pathways.ts is owned elsewhere; this reads its exports and edits
  // nothing. A dynamic import keeps the dependency one-way, and the try/catch means the engine being
  // absent or renamed is a STATED OUTCOME rather than a crash that blanks the whole suite.
  let workspace: Awaited<ReturnType<typeof import("@/lib/practice/pathways").pathwayWorkspace>>;
  try {
    const { pathwayWorkspace } = await import("@/lib/practice/pathways");
    workspace = await pathwayWorkspace(admin, ctx.workspaceId, { activeOnly: false });
  } catch (e) {
    const reason = `the pathways engine could not be loaded: ${e instanceof Error ? e.message : String(e)}`;
    both("unreadable", reason);
    return intelModule("pathways", "Care Pathways", {
      cards: [], milestonesPassed: passed, milestonesUpcoming: upcoming,
      status: "unreadable" as IntelStatus, reason,
    }, sources, [reason]);
  }

  if (workspace.unavailable) {
    const reason = `the pathways engine could not read its own tables: ${workspace.detail ?? "read failed"}`;
    both("unreadable", reason);
    return intelModule("pathways", "Care Pathways", {
      cards: workspace.cards, milestonesPassed: passed, milestonesUpcoming: upcoming,
      status: "unreadable" as IntelStatus, reason,
    }, sources, [reason]);
  }

  const identified = hasCapability(ctx, CAP_PATIENT_VIEW);
  const active = workspace.pathways.filter(p => p.status === "active");
  const stageNote = (p: (typeof active)[number]) =>
    `${p.template_name} -- ${p.stageName ? `${p.stageName} due ${p.stageDueOn ?? "?"}` : `due ${p.stageDueOn ?? "?"}`}`;

  const fill = (g: OpenableCount, rows: typeof active) => {
    g.status = "ok";
    g.reason = identified ? null : "counted, and not named: you hold reporting access but not clinical access";
    g.count = rows.length;
    g.sample = rows.slice(0, SAMPLE_SIZE).map(p => ({
      id: p.id,
      label: identified ? (p.patient_name ?? "Unnamed record") : `Pathway ${p.id.slice(0, 8)}`,
      note: stageNote(p),
      // ⚠ NO PER-ENROLMENT ROUTE EXISTS -- the pathways workspace is a single page, so
      // /practice/pathways/<id> would 404. The drill target is the PATIENT, which s15 lists first
      // among them. Read out of the route tree rather than assumed from the id being present.
      href: identified ? `/practice/patients/${p.patient_id}` : null,
    }));
    g.sampleIsPartial = rows.length > g.sample.length;
  };

  fill(passed, active.filter(p => p.progress === "overdue"));
  fill(upcoming, active.filter(p =>
    p.progress !== "overdue" && p.stageDueInDays !== null &&
    p.stageDueInDays >= 0 && p.stageDueInDays <= UPCOMING_MILESTONE_DAYS));

  return intelModule("pathways", "Care Pathways", {
    cards: workspace.cards, milestonesPassed: passed, milestonesUpcoming: upcoming,
    status: "ok" as IntelStatus, reason: null,
  }, sources, workspace.templatesUnavailable ? [`pathway templates: ${workspace.templatesDetail ?? "read failed"}`] : []);
}

// ── 4. RECENT REPORTS ────────────────────────────────────────────────────────────────────────────────

export type RecentReportsData = {
  /** Reports this practice has DEFINED. Not runs -- see `limitation`. */
  defined: { id: string; name: string; kind: string; cadence: string; active: boolean; lastRunAt: string | null }[];
  status: IntelStatus;
  reason: string | null;
  /**
   * ⚠ WHY "RECENT REPORTS" IS A LIST OF DEFINITIONS AND NOT A LIST OF RUNS.
   *
   * The comp's panel implies a history of generated documents. practice_scheduled_report records an
   * INTENTION ("monthly activity summary, first of the month") and a last_run_at that is only ever set
   * by somebody pressing Run now -- migration 204 says so in its own comment, because scheduling needs a
   * scheduler and this product's cron surface belongs to the platform rather than to a tenant. Rendering
   * intentions as a run history would be the most quietly wrong panel on the page.
   */
  limitation: string;
} & Provenance;

export async function recentReports(
  admin: any, ctx: WorkspaceContext, atTime: Date = new Date(),
): Promise<IntelModule<RecentReportsData>> {
  const sources = ["practice_scheduled_report.name", "practice_scheduled_report.last_run_at"];
  const base: RecentReportsData = {
    defined: [], status: "unknowable" as IntelStatus, reason: null,
    limitation: "These are report DEFINITIONS, not generated documents. Nothing here runs on a schedule: last run is set only when somebody presses Run now (migration 204).",
    formula: "every practice_scheduled_report row for this practice, most recently run first",
    sources, fromDay: null, toDay: null, asOf: atTime.toISOString(), provenance: "computed",
  };

  if (!hasCapability(ctx, CAP_REPORT))
    return intelModule("recent_reports", "Reports",
      { ...base, status: "not_permitted" as IntelStatus, reason: `${CAP_REPORT} is required` }, sources, []);

  const read = await intelRows(admin.from("practice_scheduled_report")
    .select("id, name, report_kind, cadence, active, last_run_at")
    .eq("workspace_id", ctx.workspaceId)
    .order("last_run_at", { ascending: false, nullsFirst: false }), 50);

  if (read.error)
    return intelModule("recent_reports", "Reports",
      { ...base, status: "unreadable" as IntelStatus, reason: `could not be read: ${read.error}` },
      sources, [read.error]);

  return intelModule("recent_reports", "Reports", {
    ...base, status: "ok" as IntelStatus, reason: null,
    defined: read.rows.map(r => ({
      id: r.id as string, name: String(r.name ?? ""), kind: String(r.report_kind ?? ""),
      cadence: String(r.cadence ?? ""), active: r.active === true,
      lastRunAt: typeof r.last_run_at === "string" ? r.last_run_at : null,
    })),
  }, sources, []);
}

// ── 5. THE PRIORITY STRIP ────────────────────────────────────────────────────────────────────────────

export type PriorityTile = OpenableCount & {
  severity: "critical" | "warning" | "normal";
};

export type PriorityStripData = {
  tiles: PriorityTile[];
  /** Domains the caller may not see. An empty strip that cannot say why is indistinguishable from calm. */
  blindSpots: string[];
  /** Reads that FAILED. "You may not look" and "I could not look" are different sentences. */
  unreadable: string[];
  /** Nothing owed AND nothing hidden AND nothing broken. All three, or it is not "you are clear". */
  allClear: boolean;
};

/** s7.2's five, in s7.2's order. The keys the colour is looked up by -- see PRIORITY_SWATCH. */
const PRIORITY_SHAPE: { key: string; label: string; definition: string; href: string }[] = [
  { key: "overdue_followups", label: "Overdue follow-ups",
    definition: "Obligations this practice recorded whose date has passed.",
    href: "/practice/follow-ups" },
  { key: "awaiting_review", label: "Awaiting review",
    definition: "Results and letters that arrived and nobody has reviewed, plus documents not yet issued.",
    href: "/practice/inbox" },
  { key: "open_encounters", label: "Consultations to finish",
    definition: "Consultations still open or recorded but not signed. Not yet a record.",
    href: "/practice/encounters" },
  { key: "patients_attention", label: "Patients needing attention",
    definition: "Distinct people the date rules have flagged. See the Patients tab for which rule and why.",
    href: "/practice/intelligence?tab=patients" },
  { key: "pathway_milestones", label: "Pathway milestones",
    definition: "Stages of an active plan that are due soon or have gone past their date.",
    href: "/practice/pathways" },
];

/** The exact keys a screen looks a colour up by. Exported so the harness can prove the two maps agree --
 *  a mismatch here compiles perfectly and renders a real figure in dead grey, which has shipped twice. */
export const PRIORITY_KEYS = PRIORITY_SHAPE.map(p => p.key);

type HomeAttentionShape = {
  attention: {
    kind: string; count: number; title: string; detail: string; href: string;
    severity: "critical" | "warning" | "normal";
    sample: { id: string; label: string; note?: string; href?: string }[];
  }[];
  blindSpots: string[];
  unreadable: string[];
};

/**
 * s7.2's PRIORITY STRIP.
 *
 * ⚠ COMPOSED FROM operations-home.ts's ATTENTION LIST, NOT RECOUNTED. The command centre already counts
 * overdue follow-ups, unreviewed incoming documents and unsigned consultations, with each tile carrying
 * a sample of real rows. Counting them again here would produce a second answer to "how many follow-ups
 * are overdue" that agrees with the first only until somebody changes an exclusion.
 *
 * ⚠ AN ABSENT ITEM IS A ZERO ONLY WHEN ITS DOMAIN WAS BOTH PERMITTED AND READABLE. operationsHome omits
 * an attention item whose count is zero, which is right for a worklist and wrong for a fixed strip: the
 * strip draws five tiles whatever happened, so the tile checks the blind-spot list and the unreadable
 * list FIRST and only then treats an absence as nothing waiting.
 */
export function priorityStrip(
  home: HomeAttentionShape,
  patientAttention: IntelModule<PatientAttentionData>,
  pathways: IntelModule<PathwayIntelligenceData>,
  atTime: Date = new Date(),
): PriorityStripData {
  const asOf = atTime.toISOString();
  const byKind = new Map(home.attention.map(a => [a.kind, a]));

  const prov = (formula: string, sources: string[]): Provenance => ({
    formula, sources, fromDay: null, toDay: null, asOf, provenance: "derived",
  });

  const fromAttention = (
    shape: (typeof PRIORITY_SHAPE)[number], kinds: string[], blindSpotNames: string[],
    unreadableNames: string[], formula: string, sources: string[],
  ): PriorityTile => {
    const rows = kinds.map(k => byKind.get(k)).filter(Boolean) as HomeAttentionShape["attention"];
    const tile: PriorityTile = {
      ...openable(shape.key, shape.label, shape.definition, shape.href, prov(formula, sources)),
      severity: "normal",
    };
    // PERMISSION FIRST: a domain the caller cannot see must never read as nothing waiting.
    const hidden = blindSpotNames.filter(b => home.blindSpots.includes(b));
    if (hidden.length === blindSpotNames.length && blindSpotNames.length > 0) {
      tile.status = "not_permitted";
      tile.reason = `you may not see ${hidden.join(" or ")}`;
      return tile;
    }
    // THEN FAILURE: a query that broke must never read as nothing waiting either.
    const broken = unreadableNames.filter(u => home.unreadable.includes(u));
    if (broken.length > 0) {
      tile.status = "unreadable";
      tile.reason = `could not be read: ${broken.join(", ")}`;
      return tile;
    }
    tile.status = "ok";
    tile.count = rows.reduce((n, r) => n + r.count, 0);
    tile.severity = rows.some(r => r.severity === "critical") ? "critical"
      : rows.some(r => r.severity === "warning") ? "warning" : "normal";
    // Partly hidden is still a real count of what IS visible, and it says so rather than pretending.
    if (hidden.length > 0) tile.reason = `not counting ${hidden.join(" or ")}, which you may not see`;
    tile.sample = rows.flatMap(r => r.sample.map(s => ({
      id: s.id, label: s.label, note: s.note ?? null, href: s.href ?? r.href,
    }))).slice(0, SAMPLE_SIZE);
    tile.sampleIsPartial = (tile.count ?? 0) > tile.sample.length;
    return tile;
  };

  // ⚠ THE BLIND-SPOT AND UNREADABLE NAMES ARE operations-home.ts's OWN STRINGS, not paraphrases. It
  // pushes "follow-ups", "encounters and procedures", "documents" and "the incoming-document register"
  // by hand, and a near-miss here would silently stop the permission check ever firing.
  const patientsTile = (): PriorityTile => {
    // ⚠ DISTINCT PEOPLE, NOT THE SUM OF THE THREE GROUPS. One patient can be overdue AND inactive AND
    // lost; adding the groups up would count them three times and produce a headline larger than the
    // register itself.
    const shape = PRIORITY_SHAPE[3];
    const tile: PriorityTile = {
      ...openable(shape.key, shape.label, shape.definition, shape.href,
        prov("distinct patients appearing in any of the three date-derived attention groups, as a set union rather than a sum -- one person can be in all three",
          ["src/lib/practice/intelligence.ts (patientAttentionIntelligence)"])),
      severity: "warning",
    };
    const data = patientAttention.data;
    if (!data) {
      tile.status = "unreadable";
      tile.reason = patientAttention.unavailableReason ?? "patient attention was not computed";
      return tile;
    }
    const groups = data.groups;
    if (groups.every(g => g.status === "not_permitted")) {
      tile.status = "not_permitted";
      tile.reason = groups[0]?.reason ?? "not permitted";
      return tile;
    }
    const brokenGroup = groups.find(g => g.status === "unreadable");
    if (brokenGroup) {
      tile.status = "unreadable";
      tile.reason = brokenGroup.reason;
      return tile;
    }
    const union = new Set<string>();
    for (const g of groups) for (const s of g.sample) union.add(s.id);
    // The union of the SAMPLES understates the whole whenever any group was sampled, so a partial
    // strip reports the largest single group -- a floor with a stated reason, never a sum.
    const anyPartial = groups.some(g => g.sampleIsPartial);
    tile.status = "ok";
    tile.count = anyPartial ? Math.max(...groups.map(g => g.count ?? 0)) : union.size;
    if (anyPartial)
      tile.reason = "at least this many: the groups overlap and more rows exist than were listed, so the largest single group is shown rather than a sum that would double-count";
    tile.sample = groups
      .flatMap(g => g.sample.map(s => ({ ...s, note: `${g.label}${s.note ? ` -- ${s.note}` : ""}` })))
      .slice(0, SAMPLE_SIZE);
    tile.sampleIsPartial = (tile.count ?? 0) > tile.sample.length;
    return tile;
  };

  const pathwayTile = (): PriorityTile => {
    const shape = PRIORITY_SHAPE[4];
    const tile: PriorityTile = {
      ...openable(shape.key, shape.label, shape.definition, shape.href,
        prov(`milestones past their date plus milestones due within ${UPCOMING_MILESTONE_DAYS} days, from pathwayWorkspace`,
          ["src/lib/practice/pathways.ts"])),
      severity: "normal",
    };
    const data = pathways.data;
    if (!data || data.status === "not_permitted") {
      tile.status = "not_permitted";
      tile.reason = data?.reason ?? pathways.unavailableReason ?? `${CAP_PATHWAY_VIEW} is required`;
      return tile;
    }
    if (data.status === "unreadable") {
      tile.status = "unreadable";
      tile.reason = data.reason;
      return tile;
    }
    const past = data.milestonesPassed.count ?? 0;
    const soon = data.milestonesUpcoming.count ?? 0;
    tile.status = "ok";
    tile.count = past + soon;
    tile.severity = past > 0 ? "warning" : "normal";
    tile.sample = [...data.milestonesPassed.sample, ...data.milestonesUpcoming.sample].slice(0, SAMPLE_SIZE);
    tile.sampleIsPartial = (tile.count ?? 0) > tile.sample.length;
    return tile;
  };

  const tiles: PriorityTile[] = [
    fromAttention(PRIORITY_SHAPE[0], ["followup_overdue"], ["follow-ups"], ["follow-ups"],
      "the count operations-home.ts computes for overdue obligations, unchanged",
      ["practice_follow_up.due_on", "src/lib/practice/operations-home.ts"]),
    fromAttention(PRIORITY_SHAPE[1], ["incoming_unreviewed", "document_unissued"],
      ["documents", "the incoming-document register"], ["documents", "incoming"],
      "unreviewed incoming documents plus clinical documents not yet issued, as operations-home.ts counts them",
      ["practice_incoming_document.id", "practice_clinical_document.status", "src/lib/practice/operations-home.ts"]),
    fromAttention(PRIORITY_SHAPE[2], ["encounter_unsigned", "encounter_live"],
      ["encounters and procedures"], ["encounters"],
      "consultations left open plus consultations completed but not signed, as operations-home.ts counts them",
      ["practice_encounter.status", "src/lib/practice/operations-home.ts"]),
    patientsTile(),
    pathwayTile(),
  ];

  return {
    tiles,
    blindSpots: home.blindSpots,
    unreadable: home.unreadable,
    // ⚠ ALL CLEAR MEANS ALL THREE: nothing owed, nothing hidden, nothing broken. A tile that is
    // not_permitted or unreadable is not a quiet clinic and must never contribute to a green page.
    allClear: tiles.every(t => t.status === "ok" && (t.count ?? 0) === 0)
      && home.blindSpots.length === 0 && home.unreadable.length === 0,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PIE-001 -- THE PRACTICE INTELLIGENCE ENGINE, AS AN EXTENSION AND NOT AS A REPLACEMENT
// ════════════════════════════════════════════════════════════════════════════════════════════════════
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-PIE-001 IS A ONE-PAGE OUTLINE AND MORE THAN HALF OF IT WAS ALREADY BUILT ABOVE. Nothing in this
// section replaces anything. Everything here is a store that had NO READER, or a refusal that had no
// home. Where PIE describes something this file already does differently, this file wins and says so:
//
//   §3 "Follow-up intelligence"        followUpIntelligence, above. Untouched.
//   §3 "Practice workload insights"    clinicalActivityIntelligence + locationIntelligence. Untouched.
//   §3 "Population/cohort analytics"   cohortIntelligence, seven dimensions. Untouched.
//   §5 "Common diagnoses"              caseMix + diagnosisReport. Untouched.
//   §5 "Follow-up completion"          followUpIntelligence.completion -- ALREADY a numerator and a
//                                      denominator with its censoring disclosed. PIE calls it a figure;
//                                      this file already refused to make it a percentage and that refusal
//                                      is older and better argued. NOT REOPENED.
//   §7 "Informational/Advisory/Action required/Critical"   settled in migration 246 and read below.
//   §8 "Every recommendation cites supporting data"        already stricter -- every figure in this
//                                      payload carries a Provenance, which is more than a citation.
//
// SO THIS SECTION ADDS EXACTLY THREE THINGS:
//
//   1. REFERRAL TRENDS (§5). practice_referral has existed since migration 238 and NOTHING READ IT.
//      A whole store with no reader is the cheapest real thing on this page.
//   2. THE PARAMETER ALERT SURFACE (§7, and §4's "parameter deterioration"). Migration 246 shipped
//      practice_parameter_alert with PIE §7's own four-level taxonomy on it. No dashboard read it.
//   3. THE MODULES THAT CANNOT BE BUILT, IN THE PAYLOAD (§3, §4, §5). See PIE_NOT_BUILDABLE.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A comparison over a count THIS FILE OWNS, gated exactly as compareMetric gates a metrics.ts figure.
 *
 * ⚠ NOT A SECOND SET OF RULES. compareMetric cannot be reused because it takes a metrics.ts `Metric`,
 * and referrals and alerts are not section 8 figures -- section 8 does not mention either, so there is no
 * owning function to call over a second scope. What IS reused is every gate, in the same order and with
 * the same wording: a current figure that failed, a prior window that was not real, a prior read that
 * broke, and too few observations across the two windows for a difference to mean anything.
 */
function compareOwnCounts(args: {
  key: string; label: string; range: IntelRange; formula: string; sources: string[];
  current: number | null; currentStatus: IntelStatus; currentReason: string | null;
  prior: number | null; priorError: string | null;
}): IntelComparison {
  const base = {
    key: args.key, label: args.label,
    formula: `${args.formula} -- compared against the same count over ${args.range.prior.label} as a signed count, never as a percentage`,
    sources: args.sources,
    priorFromDay: args.range.prior.fromDay, priorToDay: args.range.prior.toDay,
  };
  const noPrior = (status: IntelStatus, reason: string): IntelComparison =>
    ({ ...base, current: args.current, prior: null, change: null, status, reason });

  if (args.currentStatus !== "ok" || args.current === null)
    return { ...base, current: null, prior: null, change: null, status: args.currentStatus, reason: args.currentReason };
  if (!args.range.priorUsable)
    return noPrior("unknowable", args.range.priorReason ?? "the previous period cannot be shown to be real");
  if (args.priorError) return noPrior("unreadable", `the previous period could not be read: ${args.priorError}`);
  if (args.prior === null) return noPrior("unreadable", "the previous period returned no count");

  const observations = args.current + args.prior;
  if (observations < MIN_OBSERVATIONS_FOR_COMPARISON)
    return noPrior("unknowable",
      `${observations} record${observations === 1 ? "" : "s"} across the two periods; ${MIN_OBSERVATIONS_FOR_COMPARISON} are needed before a difference means anything`);

  return { ...base, current: args.current, prior: args.prior, change: args.current - args.prior, status: "ok", reason: null };
}

// ── 7. REFERRAL TRENDS -- PIE §5, AND THE ONE STORE IN THIS PRODUCT THAT NOBODY READ ──────────────────

/** practice_referral.status -- migration 238's CHECK, in full. Every member emitted even at zero. */
const REFERRAL_STATUSES: [string, string][] = [
  ["made", "Made -- nothing heard back"],
  ["accepted", "Accepted"],
  ["declined", "Declined"],
  ["withdrawn", "Withdrawn"],
];

/** How many destinations are listed. A long tail of one-off hospitals is not a trend and is not drawn. */
const TOP_DESTINATIONS = 10;

export type ReferralDestination = {
  /** Exactly as it was typed. See the module comment on why it is not tidied. */
  label: string;
  /** Referrals to this destination in the period. */
  total: number;
  /** DISTINCT patients sent there. One patient referred three times is one person. */
  patients: number;
};

export type ReferralIntelligenceData = {
  /** Referrals recorded in the period, and the patients behind them. */
  made: OpenableCount;
  /** What the practitioner has since been TOLD. `made` means nobody has told them anything. */
  byStatus: IntelDistribution;
  destinations: ReferralDestination[];
  /** How many distinct destinations were typed. Null when the list could not be computed. */
  distinctDestinations: number | null;
  /** Every referral still sitting at `made`, whenever it was recorded. As at now, not windowed. */
  awaitingNews: OpenableCount;
  /** This period against the one before, as a signed count. Refused unless the prior window was real. */
  change: IntelComparison;
  /** ⚠ RECORDED, NOT SENT. Migration 238's own warning, carried into the payload. */
  limitation: string;
  identified: boolean;
};

/**
 * REFERRAL TRENDS -- PIE §5's fifth practice item, over a table that has been written since migration
 * 238 and read by no dashboard since.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THE ONE THING A REFERRAL PANEL MUST NOT IMPLY, AND MIGRATION 238 SAYS IT FIRST.
 *
 *     "WARNING: RECORDED, NOT SENT. This product has no email, no SMS and no messaging of any kind, and
 *      the tables were shaped so that nothing could ever claim to have transmitted anything -- no channel
 *      column, no sent_at. A referral row is a note that the practitioner decided to refer."
 *
 * So `made` is NOT "sent and awaiting reply". It is "written down, and nobody has since written down any
 * news about it". A panel headed "12 referrals outstanding" would be read as twelve letters sitting in
 * somebody's inbox, and that is a claim this schema structurally cannot support. The limitation travels
 * in the payload rather than in a comment, so the API says it too.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ DESTINATIONS ARE COUNTED EXACTLY AS TYPED, and this is the same decision diagnosisReport already
 * made for diagnosis labels. referred_to is free text because "the person or service referred to may be
 * at an institution this product has never heard of" (238). Normalising "Mulago" and "mulago hospital"
 * into one bar would be inventing a facility register nobody maintains, and getting it wrong quietly.
 * Whitespace is trimmed, because trailing spaces are a typing artefact rather than a different hospital;
 * nothing else is touched, and the panel says so.
 *
 * ⚠ referred_on IS A DATE COLUMN, SO THE WINDOW IS COMPARED AS DAYS. Comparing it against the period's
 * INSTANTS would make "referrals this month" mean something an hour out at either end, and the direction
 * of the error would depend on the practice's timezone.
 *
 * TABLES/COLUMNS: practice_referral.workspace_id/.patient_id/.referred_to/.status/.referred_on
 * (migration 238); practice_patient.id/.display_name (193) for the names.
 * CAPABILITY: encounter.list -- the same gate encounter-workspace.ts puts on referralHistory, because a
 * referral is part of a consultation record and two engines disagreeing about who may read one is worse
 * than either answer.
 */
export async function referralIntelligence(
  admin: any, ctx: WorkspaceContext, range: IntelRange, atTime: Date = new Date(),
): Promise<IntelModule<ReferralIntelligenceData>> {
  const asOf = atTime.toISOString();
  const sources = [
    "practice_referral.referred_on", "practice_referral.status", "practice_referral.referred_to",
    "practice_referral.patient_id",
  ];
  const limitation = "A referral row is a note that the practitioner DECIDED to refer. Migration 238 gave this table no channel and no sent_at on purpose: nothing in this product transmits anything, so `made` means \"written down, and no news recorded since\" rather than \"sent and awaiting a reply\". The letter that actually goes anywhere is a clinical document with its own release register.";

  if (!hasCapability(ctx, CAP_ENCOUNTER_LIST))
    return intelUnavailable("referral_intelligence", "Referrals",
      `${CAP_ENCOUNTER_LIST} is required to see this practice's referrals -- a referral is part of a consultation record`,
      sources);

  const identified = hasCapability(ctx, CAP_PATIENT_VIEW);
  const prov = (formula: string, src: string[], windowed: boolean): Provenance => ({
    formula, sources: src,
    fromDay: windowed ? range.period.fromDay : null,
    toDay: windowed ? range.period.toDay : null,
    asOf, provenance: "computed",
  });

  const madeFormula = `count of practice_referral rows whose referred_on falls on or between ${range.period.fromDay} and ${range.period.toDay} in this practice's calendar; referred_on is a DATE column and is compared as days rather than as instants`;
  const awaitingFormula = "count of practice_referral rows whose status is still `made`, whenever they were recorded; this is a live state as at now and is deliberately not windowed -- \"what have I heard nothing about\" does not stop being true because a reader picked a 30-day range";

  const made = openable("referrals_made", "Referrals recorded in this period",
    `Referrals a practitioner wrote down between ${range.period.fromDay} and ${range.period.toDay}.`,
    "/practice/patients", prov(madeFormula, sources, true));
  const awaitingNews = openable("referrals_awaiting_news", "Referrals with no news recorded",
    "Still at `made`. Nobody has recorded that the destination accepted, declined or that it was withdrawn -- which is not the same as nobody having replied.",
    "/practice/patients", prov(awaitingFormula, ["practice_referral.status"], false));

  const data: ReferralIntelligenceData = {
    made, byStatus: {
      key: "by_status", label: "What has since been heard", status: "unknowable", reason: null,
      slices: [], of: null, unrecorded: 0,
      formula: "count of the period's practice_referral rows by practice_referral.status; the four are migration 238's CHECK constraint in full and every one is emitted even at zero",
      sources: ["practice_referral.status", "practice_referral.referred_on"],
    },
    destinations: [], distinctDestinations: null, awaitingNews,
    change: compareOwnCounts({
      key: "referrals_change", label: "Referrals recorded", range,
      formula: madeFormula, sources, current: null, currentStatus: "unknowable",
      currentReason: "not computed", prior: null, priorError: null,
    }),
    limitation, identified,
  };

  const [periodRead, priorRead, awaitingRead] = await Promise.all([
    intelRows(admin.from("practice_referral")
      .select("id, patient_id, referred_to, status, referred_on")
      .eq("workspace_id", ctx.workspaceId)
      .gte("referred_on", range.period.fromDay).lte("referred_on", range.period.toDay)
      .order("referred_on", { ascending: false })),
    intelCount(admin.from("practice_referral").select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId)
      .gte("referred_on", range.prior.fromDay).lte("referred_on", range.prior.toDay)),
    intelRows(admin.from("practice_referral")
      .select("id, patient_id, referred_to, referred_on")
      .eq("workspace_id", ctx.workspaceId).eq("status", "made")
      .order("referred_on", { ascending: true })),
  ]);

  const problems: string[] = [];

  // ── A FAILED READ IS NEVER A ZERO, AND A FULL PAGE IS NEVER A PERIOD ──────────────────────────────
  const periodBad = periodRead.error
    ? `could not be read: ${periodRead.error}`
    : periodRead.overflowed ? overflowNote("referrals") : null;

  if (periodBad) {
    made.status = "unreadable";
    made.reason = periodBad;
    problems.push(`referrals in the period: ${periodBad}`);
  } else {
    made.status = "ok";
    made.count = periodRead.rows.length;
  }

  const awaitingBad = awaitingRead.error
    ? `could not be read: ${awaitingRead.error}`
    : awaitingRead.overflowed ? overflowNote("referrals with no news") : null;
  if (awaitingBad) {
    awaitingNews.status = "unreadable";
    awaitingNews.reason = awaitingBad;
    problems.push(`referrals awaiting news: ${awaitingBad}`);
  } else {
    awaitingNews.status = "ok";
    awaitingNews.count = awaitingRead.rows.length;
  }

  data.byStatus = distribution("by_status", "What has since been heard", periodRead,
    r => r.status, REFERRAL_STATUSES, data.byStatus.formula, data.byStatus.sources, "referrals");

  data.change = compareOwnCounts({
    key: "referrals_change", label: "Referrals recorded", range, formula: madeFormula, sources,
    current: made.count, currentStatus: made.status, currentReason: made.reason,
    prior: priorRead.count, priorError: priorRead.error,
  });
  if (priorRead.error) problems.push(`the previous period's referrals: ${priorRead.error}`);

  // ── DESTINATIONS, AS TYPED ────────────────────────────────────────────────────────────────────────
  if (!periodBad) {
    const byDestination = new Map<string, { total: number; patients: Set<string> }>();
    for (const r of periodRead.rows) {
      const label = String(r.referred_to ?? "").trim();
      if (!label) continue;
      const slot = byDestination.get(label) ?? { total: 0, patients: new Set<string>() };
      slot.total++;
      if (typeof r.patient_id === "string") slot.patients.add(r.patient_id);
      byDestination.set(label, slot);
    }
    data.distinctDestinations = byDestination.size;
    data.destinations = [...byDestination.entries()]
      .map(([label, s]) => ({ label, total: s.total, patients: s.patients.size }))
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
      .slice(0, TOP_DESTINATIONS);
  }

  // ── THE SAMPLES: REAL ROWS, DE-IDENTIFIED WHEN THE CALLER MAY NOT SEE NAMES ───────────────────────
  //
  // The same rule patientAttentionIntelligence follows: the id travels either way (enough to find the
  // row), the NAME only with patient.view, and the count is complete in both cases.
  const sampleSources = [
    ...(periodBad ? [] : periodRead.rows.slice(0, SAMPLE_SIZE)),
    ...(awaitingBad ? [] : awaitingRead.rows.slice(0, SAMPLE_SIZE)),
  ];
  const wantedIds = [...new Set(sampleSources
    .map(r => r.patient_id).filter((x): x is string => typeof x === "string"))];

  const nameById = new Map<string, string>();
  if (identified && wantedIds.length > 0) {
    const nameRead = await intelIn(admin, "practice_patient", "id, display_name", ctx.workspaceId, "id", wantedIds);
    if (nameRead.error) problems.push(`patient names for the referral samples: ${nameRead.error}`);
    else for (const p of nameRead.rows) nameById.set(p.id as string, String(p.display_name ?? ""));
  }

  const sampleRow = (r: any, note: string) => {
    const pid = typeof r.patient_id === "string" ? r.patient_id : "";
    return {
      id: String(r.id),
      label: identified
        ? `${nameById.get(pid) || "Unnamed record"} → ${String(r.referred_to ?? "").trim() || "destination not recorded"}`
        : `Patient ${pid.slice(0, 8)} → ${String(r.referred_to ?? "").trim() || "destination not recorded"}`,
      note,
      href: identified && pid ? `/practice/patients/${pid}` : null,
    };
  };

  if (made.status === "ok") {
    made.sample = periodRead.rows.slice(0, SAMPLE_SIZE)
      .map(r => sampleRow(r, String(r.referred_on ?? "")));
    made.sampleIsPartial = (made.count ?? 0) > made.sample.length;
    if (!identified) made.reason = "counted, and not named: you hold reporting access but not clinical access";
  }
  if (awaitingNews.status === "ok") {
    awaitingNews.sample = awaitingRead.rows.slice(0, SAMPLE_SIZE)
      .map(r => sampleRow(r, `recorded ${String(r.referred_on ?? "")}`));
    awaitingNews.sampleIsPartial = (awaitingNews.count ?? 0) > awaitingNews.sample.length;
    if (!identified) awaitingNews.reason = "counted, and not named: you hold reporting access but not clinical access";
  }

  return intelModule("referral_intelligence", "Referrals", data, sources, problems);
}

// ── 8. THE PARAMETER ALERT SURFACE -- PIE §7, AND §4's "PARAMETER DETERIORATION" ──────────────────────

/** Migration 246 seeds this; read out of the migration, not remembered. Practitioner and assistant. */
const CAP_PARAMETER_VIEW = "parameter.view";

/** practice_parameter_alert.alert_type -- migration 246's CHECK, in full. LCP §7.2's list verbatim. */
const PARAMETER_ALERT_TYPES: [string, string][] = [
  ["reference_range", "Outside the reference range"],
  ["patient_target", "Outside this patient's own target"],
  ["change_from_baseline", "Changed from the recorded baseline"],
  ["percentage_change", "Changed by more than a configured percentage of the previous value"],
  ["rate_of_change", "Changing faster than the configured limit"],
  ["missing_overdue", "A measurement is due and has not been taken"],
  ["trend_deviation", "Departing from its own established trend"],
];

/** The severities as a tally vocabulary. `not_classified` is where NULL lands -- see the pick below. */
const ALERT_SEVERITY_VOCABULARY: [string, string][] =
  ALERT_SEVERITIES.map(s => [s.key, s.label] as [string, string]);

/** The two levels that assert something is expected of somebody, in the order they are acted on. */
const ACTIONABLE_SEVERITIES: { key: string; label: string; definition: string }[] = [
  { key: "critical", label: "Critical, still open",
    definition: "The most serious level this product has, and nobody has acknowledged, actioned or overridden it." },
  { key: "action_required", label: "Action required, still open",
    definition: "PIE §7's third level. Something is expected of somebody and no acknowledgement has been recorded." },
];

export type ParameterAlertData = {
  /** Every open alert, whatever its severity. */
  open: OpenableCount;
  /** ⚠ NULL IS A NAMED SLICE CALLED "Not classified", never folded into a level and never a blank. */
  bySeverity: IntelDistribution;
  byType: IntelDistribution;
  /** Critical and action-required, separately, each a list. */
  actionable: OpenableCount[];
  /** Open alerts whose rule declared no severity at all. Surfaced, not buried. */
  notClassified: OpenableCount;
  /** Open alerts on a parameter whose category is vital_sign -- PIE §3's surveillance, as far as it goes. */
  vitalSigns: OpenableCount;
  /** Of the alerts raised in the period, how many have since been acknowledged, actioned or overridden. */
  acknowledged: IntelProportion;
  /** Alerts raised in this period against the one before, as a signed count. */
  raised: IntelComparison;
  /** The settled taxonomy, in the payload, so no client invents a fifth level or a low. */
  taxonomy: { key: string; label: string; meaning: string; isLevel: boolean }[];
  identified: boolean;
};

/**
 * THE ALERT FRAMEWORK PIE §7 ASKS FOR, WHICH ALREADY EXISTS AS A TABLE AND HAD NO DASHBOARD.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THIS ENGINE RAISES NO ALERT AND CHANGES NONE. It counts what the parameter engine wrote. That is the
 * whole boundary: practice_parameter_alert is written by src/lib/practice/parameters.ts, which owns the
 * rules, the thresholds and the rationale on every row. A second place deciding what is critical would
 * produce two answers to "how many critical alerts are open", and they would agree until the day somebody
 * changed a threshold.
 *
 * ⚠ AND NOTHING FROM THE PARAMETER SERIES IS MERGED INTO THIS PAYLOAD, DELIBERATELY. The per-patient
 * series that engine returns carries a change expressed as a percentage -- correct there, because a
 * monitoring plan's own rule is written in those terms and the figure is one patient's own reading against
 * their own baseline. It is NOT correct here: this payload is asserted to hold no rate anywhere, a whole
 * dashboard is drawn from that assertion, and merging a series into it would breach the assertion the
 * moment somebody added a panel. So the ALERT ROWS are read, and the series is not.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ A NULL SEVERITY IS "NOT CLASSIFIED" AND IS NEVER A LOW. Migration 246 makes the column nullable on
 * purpose and states the rendering rule in its own comment. Two wrong ways to handle it were available
 * and both are refused here: folding NULL into `informational` asserts a clinical judgement nobody made,
 * and letting it fall into the distribution's `unrecorded` bucket reads as a data-quality defect when it
 * is a rule that never declared one. It gets its own named slice and its own openable count.
 *
 * ⚠ THE OPERATIONAL SCALE IS NOT TOUCHED. PriorityTile.severity stays critical/warning/normal; migration
 * 246 warns against merging the two in its own words, and this module adds no tile to that strip.
 *
 * TABLES/COLUMNS: practice_parameter_alert.workspace_id/.patient_id/.definition_id/.alert_type/
 * .severity/.status/.raised_at/.rationale (migration 246); practice_parameter_definition.display_name/
 * .category (246); practice_patient.display_name (193).
 * CAPABILITY: parameter.view -- migration 246 seeds it for practitioner and practice_assistant, and
 * deliberately not for practice_owner. An owner holding report.view therefore sees this panel say so.
 */
export async function parameterAlertIntelligence(
  admin: any, ctx: WorkspaceContext, range: IntelRange, atTime: Date = new Date(),
): Promise<IntelModule<ParameterAlertData>> {
  const asOf = atTime.toISOString();
  const sources = [
    "practice_parameter_alert.severity", "practice_parameter_alert.alert_type",
    "practice_parameter_alert.status", "practice_parameter_alert.raised_at",
    "practice_parameter_definition.category", "practice_parameter_definition.display_name",
  ];

  if (!hasCapability(ctx, CAP_PARAMETER_VIEW))
    return intelUnavailable("parameter_alerts", "Clinical parameter alerts",
      `${CAP_PARAMETER_VIEW} is required to see parameter alerts. Migration 246 grants it to the practitioner and the practice assistant and withholds it from the practice owner, so a business role holding report.view sees this sentence rather than a zero.`,
      sources);

  const identified = hasCapability(ctx, CAP_PATIENT_VIEW);
  const prov = (formula: string, src: string[], windowed: boolean): Provenance => ({
    formula, sources: src,
    fromDay: windowed ? range.period.fromDay : null,
    toDay: windowed ? range.period.toDay : null,
    asOf, provenance: "computed",
  });

  // OPEN IS A LIVE STATE AND IS NOT WINDOWED. An alert raised five weeks ago that nobody has
  // acknowledged is open now, and hiding it because a reader picked a 30-day range would make the
  // backlog shrink every time somebody narrowed the window.
  const openFormula = "count of practice_parameter_alert rows whose status is `open` -- not acknowledged, not actioned, not overridden -- whenever they were raised; open is a live state and is deliberately not windowed";
  const raisedFormula = `count of practice_parameter_alert rows whose raised_at falls inside ${range.period.label}`;

  const alertsHref = "/practice/patients";
  const open = openable("alerts_open", "Open parameter alerts",
    "Raised by the parameter engine's own rules and not yet acknowledged, actioned or overridden.",
    alertsHref, prov(openFormula, ["practice_parameter_alert.status"], false));
  const notClassified = openable("alerts_not_classified", "Open, and not classified",
    "The rule that raised these declared no severity. That is an absence of a classification, not a low one.",
    alertsHref, prov(`${openFormula}, restricted to rows whose severity column is NULL; NULL is reported as "not classified" and is never rendered as a level`,
      ["practice_parameter_alert.severity"], false));
  const vitalSigns = openable("alerts_vital_signs", "Open on a vital sign",
    "Open alerts whose parameter is categorised vital_sign. PIE §3 asks for vital-sign surveillance; this is what the parameter engine actually supports, and it covers only parameters somebody configured.",
    alertsHref, prov(`${openFormula}, restricted to rows whose practice_parameter_definition.category is 'vital_sign'`,
      ["practice_parameter_definition.category"], false));
  const actionable = ACTIONABLE_SEVERITIES.map(s => openable(
    `alerts_${s.key}`, s.label, s.definition, alertsHref,
    prov(`${openFormula}, restricted to severity = '${s.key}'`, ["practice_parameter_alert.severity"], false),
  ));

  const emptyDistribution = (key: string, label: string, formula: string, src: string[]): IntelDistribution => ({
    key, label, status: "unknowable", reason: null, slices: [], of: null, unrecorded: 0, formula, sources: src,
  });

  const data: ParameterAlertData = {
    open, notClassified, vitalSigns, actionable,
    bySeverity: emptyDistribution("by_severity", "How serious the rule said it was",
      "count of OPEN practice_parameter_alert rows by practice_parameter_alert.severity; the four levels are migration 246's CHECK constraint in full and a NULL is counted under `not_classified`, which is a bucket rather than a level",
      ["practice_parameter_alert.severity", "practice_parameter_alert.status"]),
    byType: emptyDistribution("by_type", "Which rule fired",
      "count of OPEN practice_parameter_alert rows by practice_parameter_alert.alert_type; the seven are migration 246's CHECK constraint in full, which is LCP §7.2's list verbatim",
      ["practice_parameter_alert.alert_type", "practice_parameter_alert.status"]),
    acknowledged: {
      key: "acknowledged", label: "Alerts raised in this period that somebody has since answered",
      numerator: null, denominator: null, status: "unknowable", reason: null, caveat: null,
      formula: `${raisedFormula}, and of those, the ones whose status is now acknowledged, actioned or overridden; the cohort is what the period raised, because the fate of an older alert belongs to the period that raised it`,
      sources: ["practice_parameter_alert.raised_at", "practice_parameter_alert.status"],
    },
    raised: compareOwnCounts({
      key: "alerts_raised_change", label: "Alerts raised", range, formula: raisedFormula,
      sources: ["practice_parameter_alert.raised_at"],
      current: null, currentStatus: "unknowable", currentReason: "not computed",
      prior: null, priorError: null,
    }),
    taxonomy: ALERT_SEVERITIES.map(s => ({ key: s.key, label: s.label, meaning: s.meaning, isLevel: s.isLevel })),
    identified,
  };

  // ⚠ THE EMBED IS WHAT MAKES THE VITAL-SIGN LENS POSSIBLE AND IT IS ALSO THE MOST FRAGILE READ HERE.
  // A wrong relationship name does not fail typecheck; PostgREST errors at runtime, and the honest
  // failure path below turns that into "could not be read" rather than into an empty surveillance panel.
  const openRead = await intelRows(admin.from("practice_parameter_alert")
    .select("id, patient_id, alert_type, severity, raised_at, rationale, practice_parameter_definition:definition_id(display_name, category)")
    .eq("workspace_id", ctx.workspaceId).eq("status", "open")
    .order("raised_at", { ascending: false }));

  const [periodRead, priorRead] = await Promise.all([
    intelRows(admin.from("practice_parameter_alert").select("id, status")
      .eq("workspace_id", ctx.workspaceId)
      .gte("raised_at", range.period.fromIso).lt("raised_at", range.period.toIso)),
    intelCount(admin.from("practice_parameter_alert").select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId)
      .gte("raised_at", range.prior.fromIso).lt("raised_at", range.prior.toIso)),
  ]);

  const problems: string[] = [];
  const openBad = openRead.error
    ? `could not be read: ${openRead.error}`
    : openRead.overflowed ? overflowNote("open alerts") : null;

  if (openBad) {
    for (const o of [open, notClassified, vitalSigns, ...actionable]) { o.status = "unreadable"; o.reason = openBad; }
    problems.push(`open alerts: ${openBad}`);
    data.bySeverity = { ...data.bySeverity, status: "unreadable", reason: openBad };
    data.byType = { ...data.byType, status: "unreadable", reason: openBad };
  } else {
    const rows = openRead.rows;

    // ⚠ NULL -> "not_classified" HAPPENS HERE, IN THE PICK, so it lands in a NAMED slice. Left as NULL
    // it would fall into `unrecorded`, which reads as a column nobody fills in rather than as a rule
    // that declared nothing.
    data.bySeverity = distribution("by_severity", "How serious the rule said it was", openRead,
      r => (typeof r.severity === "string" && r.severity ? r.severity : SEVERITY_NOT_CLASSIFIED),
      ALERT_SEVERITY_VOCABULARY, data.bySeverity.formula, data.bySeverity.sources, "open alerts");
    data.byType = distribution("by_type", "Which rule fired", openRead,
      r => r.alert_type, PARAMETER_ALERT_TYPES, data.byType.formula, data.byType.sources, "open alerts");

    const wantedIds = [...new Set(rows.map(r => r.patient_id).filter((x): x is string => typeof x === "string"))]
      .slice(0, INTEL_ROW_CAP);
    const nameById = new Map<string, string>();
    if (identified && wantedIds.length > 0) {
      const nameRead = await intelIn(admin, "practice_patient", "id, display_name", ctx.workspaceId, "id", wantedIds);
      if (nameRead.error) problems.push(`patient names for the alert samples: ${nameRead.error}`);
      else for (const p of nameRead.rows) nameById.set(p.id as string, String(p.display_name ?? ""));
    }

    const sampleRow = (r: any) => {
      const pid = typeof r.patient_id === "string" ? r.patient_id : "";
      const parameter = String(r.practice_parameter_definition?.display_name ?? "").trim() || "a parameter";
      return {
        id: String(r.id),
        label: identified
          ? `${nameById.get(pid) || "Unnamed record"} -- ${parameter}`
          : `Patient ${pid.slice(0, 8)} -- ${parameter}`,
        // THE RATIONALE, NOT A SEVERITY WORD. Migration 246 made rationale NOT NULL precisely so an
        // alert can say why it fired, and a sample row that showed only the level would waste that.
        note: String(r.rationale ?? "").slice(0, 90) || null,
        href: identified && pid ? `/practice/patients/${pid}` : null,
      };
    };

    const settle = (o: OpenableCount, matching: any[]) => {
      o.status = "ok";
      o.count = matching.length;
      o.sample = matching.slice(0, SAMPLE_SIZE).map(sampleRow);
      o.sampleIsPartial = matching.length > o.sample.length;
      if (!identified) o.reason = "counted, and not named: you hold reporting access but not clinical access";
    };

    settle(open, rows);
    settle(notClassified, rows.filter(r => !(typeof r.severity === "string" && r.severity)));
    settle(vitalSigns, rows.filter(r => r.practice_parameter_definition?.category === "vital_sign"));
    for (const o of actionable) {
      const key = o.key.replace(/^alerts_/, "");
      settle(o, rows.filter(r => r.severity === key));
    }
  }

  // ── THE PERIOD COHORT: RAISED, AND ANSWERED ───────────────────────────────────────────────────────
  const periodBad = periodRead.error
    ? `could not be read: ${periodRead.error}`
    : periodRead.overflowed ? overflowNote("alerts raised") : null;
  if (periodBad) problems.push(`alerts raised in the period: ${periodBad}`);

  const answered = periodBad ? null
    : periodRead.rows.filter(r => r.status === "acknowledged" || r.status === "actioned" || r.status === "overridden").length;

  data.acknowledged = {
    ...data.acknowledged,
    numerator: answered,
    denominator: periodBad ? null : periodRead.rows.length,
    status: periodBad ? "unreadable" : periodRead.rows.length === 0 ? "unknowable" : "ok",
    reason: periodBad ?? (periodRead.rows.length === 0
      ? "no alert was raised in this period, so there is nothing whose answering could be counted"
      : null),
    caveat: periodBad ? null
      : "An alert raised on the last day of the period has had a day to be answered and one raised on the first has had a month. A denominator that ignores that makes every recent period look worse than every old one, and always will.",
  };

  data.raised = compareOwnCounts({
    key: "alerts_raised_change", label: "Alerts raised", range, formula: raisedFormula,
    sources: ["practice_parameter_alert.raised_at"],
    current: periodBad ? null : periodRead.rows.length,
    currentStatus: periodBad ? "unreadable" : "ok",
    currentReason: periodBad,
    prior: priorRead.count, priorError: priorRead.error,
  });
  if (priorRead.error) problems.push(`the previous period's alerts: ${priorRead.error}`);

  return intelModule("parameter_alerts", "Clinical parameter alerts", data, sources, problems);
}

// ── 6. THE SUITE ─────────────────────────────────────────────────────────────────────────────────────

export type IntelligenceSuite = {
  asOfIso: string;
  timezone: string;
  range: IntelRange;
  permitted: boolean;
  identified: boolean;
  /** s7.2. Five tiles, always five, each one openable. */
  priority: PriorityStripData;
  /** s7.3's panels and s6's areas -- CPR-V5-003's ten modules, assembled once. */
  workspace: PracticeIntelligenceWorkspace;
  brief: {
    status: "derived";
    calculatedAt: string;
    items: { key: string; severity: string; sentence: string; href: string; count: number }[];
    method: string;
    blindSpots: string[];
    unavailable: boolean;
  };
  patients: IntelModule<PatientAttentionData>;
  pathways: IntelModule<PathwayIntelligenceData>;
  cohorts: IntelModule<CohortData>;
  reports: IntelModule<RecentReportsData>;
  /**
   * CPR-PIE-001 §5's referral trends. ADDITIVE: practice_referral has existed since migration 238 and
   * this is the first reader it has ever had.
   */
  referrals: IntelModule<ReferralIntelligenceData>;
  /** CPR-PIE-001 §7's alert framework, over the store migration 246 shipped and nothing surfaced. */
  alerts: IntelModule<ParameterAlertData>;
  /**
   * CPR-PIE-001 §3/§4/§5's modules that have NO store in this product, named where they would have gone.
   *
   * ⚠ IN THE PAYLOAD RATHER THAN ONLY ON THE PAGE, so the API says it too and no second surface renders
   * one of these as a zero. The same device REFUSED_PATIENT_STATES uses, at module scale.
   */
  notBuildable: UnbuildableModule[];
  /** The doctrine, in the payload. No client can render any of this as a rate. */
  ratesComputed: false;
  /** True only when NOTHING could be read. One dead feeder must not blank the suite (s12). */
  unavailable: boolean;
};

/**
 * THE WHOLE SUITE, FOR ONE RANGE -- s6's nine areas and s7's overview, in one payload.
 *
 * ⚠ IT IS ONE READ OF THE WHOLE PRACTICE AND IT IS LOGGED AS ONE. CPR-370 and CORE-001 s13: reading
 * everything about everybody is the read most worth having a record of.
 *
 * ⚠ EVERY FEEDER FAILS ALONE. s12: "Unavailable AI must not block dashboards", and the same holds for
 * every other source -- a module that could not read returns its reason and the others stand. There is
 * no path here where one failed query produces an empty page.
 *
 * ⚠ THE ASSISTANT IS NOT CALLED FROM HERE. s12 again: an AI provider that is down, slow or switched off
 * must not delay a dashboard made entirely of arithmetic. The Assistant area asks for itself.
 */
export async function intelligenceSuite(
  admin: any, ctx: WorkspaceContext,
  opts: { fromDay?: string; toDay?: string; days?: number; cohortBy?: CohortDimension } = {},
  atTime: Date = new Date(),
): Promise<IntelligenceSuite> {
  const permitted = hasCapability(ctx, CAP_REPORT);
  const range = await intelRange(admin, ctx.workspaceId, opts);

  const { operationsHome } = await import("@/lib/practice/operations-home");
  const { practiceBrief } = await import("@/lib/practice/brief");

  // practiceIntelligenceWorkspace already refuses politely when report.view is absent, and each of the
  // other four states its own permission answer. Nothing here short-circuits on a missing capability:
  // a page that renders nothing cannot explain why it rendered nothing.
  const [workspace, patients, pathways, reports, cohorts, referrals, alerts, home] = await Promise.all([
    practiceIntelligenceWorkspace(admin, ctx, opts, atTime),
    patientAttentionIntelligence(admin, ctx, range, atTime),
    pathwayIntelligence(admin, ctx, atTime),
    recentReports(admin, ctx, atTime),
    cohortIntelligence(admin, ctx, range, opts.cohortBy ?? "diagnosis", atTime),
    // CPR-PIE-001. Both fail alone, like every other feeder: a practice with no parameter engine
    // configured and a dead referral table still gets the other nine areas.
    referralIntelligence(admin, ctx, range, atTime),
    parameterAlertIntelligence(admin, ctx, range, atTime),
    operationsHome(admin, ctx),
  ]);

  const brief = practiceBrief(
    { attention: home.attention, blindSpots: home.blindSpots, allClear: home.allClear, unreadable: home.unreadable },
    atTime,
  );

  const priority = priorityStrip(
    { attention: home.attention, blindSpots: home.blindSpots, unreadable: home.unreadable },
    patients, pathways, atTime,
  );

  await logAccess(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, subjectKind: "search",
    action: "view", detail: `Practice Intelligence suite ${range.period.label}`,
    route: "/practice/intelligence",
  });

  return {
    asOfIso: atTime.toISOString(),
    timezone: range.timezone,
    range,
    permitted,
    identified: hasCapability(ctx, CAP_PATIENT_VIEW),
    priority,
    workspace,
    brief: {
      status: brief.status, calculatedAt: brief.calculatedAt, method: brief.method,
      blindSpots: brief.blindSpots, unavailable: brief.unavailable,
      // The sentences and where they go. `sourceRefs` are deliberately not copied here: they are on the
      // brief itself, and duplicating a trace gives it two homes and one maintainer.
      items: brief.items.map(i => ({
        key: i.key, severity: i.severity, sentence: i.sentence, href: i.href, count: i.count,
      })),
    },
    patients, pathways, cohorts, reports,
    referrals, alerts,
    // ⚠ NOT CONDITIONAL. The list of what cannot be built travels whatever the caller's permissions and
    // whatever the reads did: a reader who sees no medication panel must be able to tell "not built" from
    // "not permitted" from "nothing this month", and an omitted list answers none of the three.
    notBuildable: PIE_NOT_BUILDABLE,
    ratesComputed: false,
    // ⚠ THE TWO NEW MODULES DO NOT JOIN THIS TEST, AND THE OMISSION IS DELIBERATE. Referrals and
    // parameter alerts are both legitimately unavailable in a practice that holds neither capability, and
    // counting them here would let two permission answers blank a page whose other nine areas worked.
    unavailable: workspace.unavailable && patients.data === null && pathways.data === null,
  };
}

/**
 * THE FIGURES AN ASSISTANT MAY CITE ABOUT THIS PRACTICE, FLATTENED FROM THE SUITE.
 *
 * ⚠ CPR-PI-003 s5: "Recommendations should include the supporting evidence... and links back to the
 * underlying records." That is only possible if the assistant is handed figures that ALREADY carry their
 * formula, their sources and their period -- which is what aiPracticeIntelligence does for the twelve
 * metrics, and what this adds for the four modules built above.
 *
 * ⚠ ONLY FIGURES THAT STAND. A null is not a fact about a practice, and handing a generator a labelled
 * blank is how "0 patients are overdue" gets written about a practice whose follow-up table timed out.
 * Every `status !== "ok"` figure is ABSENT rather than present-and-null.
 */
export function suiteGroundingFigures(suite: IntelligenceSuite): GroundedFigure[] {
  const out: GroundedFigure[] = [];
  const push = (key: string, label: string, value: number | null, status: IntelStatus, formula: string, sources: string[], fromDay: string | null, toDay: string | null) => {
    if (status !== "ok" || value === null) return;
    out.push({
      key, label, value, unit: "count", formula, sources,
      periodFromDay: fromDay ?? suite.range.period.fromDay,
      periodToDay: toDay ?? suite.range.period.toDay,
    });
  };

  const ai = suite.workspace.modules.ai.data;
  if (ai) out.push(...ai.authorisedFigures);

  for (const g of suite.patients.data?.groups ?? [])
    push(`patients_${g.key}`, `Patients: ${g.label}`, g.count, g.status, g.formula, g.sources, g.fromDay, g.toDay);

  const pw = suite.pathways.data;
  if (pw) for (const m of [pw.milestonesPassed, pw.milestonesUpcoming])
    push(m.key, m.label, m.count, m.status, m.formula, m.sources, m.fromDay, m.toDay);

  for (const t of suite.priority.tiles)
    push(`priority_${t.key}`, t.label, t.count, t.status, t.formula, t.sources, t.fromDay, t.toDay);

  // ── CPR-PIE-001's TWO NEW MODULES, ON THE SAME TERMS AS EVERYTHING ELSE ────────────────────────────
  //
  // ⚠ ONLY THE OPENABLE COUNTS. The distributions, the destination list and the acknowledgement
  // proportion are deliberately NOT flattened: a grounding figure is a single number a sentence can be
  // built on, and handing a generator a seven-slice breakdown invites it to describe the slices in a
  // sentence with a proportion in it. The panels show those; the model is given counts.
  const ref = suite.referrals.data;
  if (ref) for (const o of [ref.made, ref.awaitingNews])
    push(`referrals_${o.key}`, o.label, o.count, o.status, o.formula, o.sources, o.fromDay, o.toDay);

  const al = suite.alerts.data;
  if (al) for (const o of [al.open, al.notClassified, al.vitalSigns, ...al.actionable])
    push(`alerts_${o.key}`, o.label, o.count, o.status, o.formula, o.sources, o.fromDay, o.toDay);

  return out;
}
