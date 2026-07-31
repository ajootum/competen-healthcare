// Workforce Wellbeing & Fatigue (UMW-WFM-003) — the Unit Manager's lens, migration 162.
//
// PRIVACY IS ENFORCED HERE, NOT IN THE PAGE. A check-in marked `private` is counted toward unit averages
// and distributions and then its identity is DROPPED before this function returns. The manager surface
// cannot leak what it never receives, and a future page author cannot accidentally undo the rule by
// rendering a field. Only 'manager' / 'occupational_health' check-ins carry a name.
//
// WHAT IS COMPUTED vs WHAT IS RECORDED:
//   fatigue          COMPUTED from rostered shifts by src/lib/workforce/fatigue.ts (shared with the SSW)
//   overtime, breaks RECORDED in op_roster_actuals / op_staff_breaks
//   sick leave       RECORDED in op_leave_records
//   check-ins,       RECORDED in the migration-162 stores
//   burnout, plans
// Every recorded source is reported with its row count, so an empty store reads as "nothing recorded yet"
// and never as a healthy zero. A wellbeing dashboard that shows 0 burnout cases because nobody has ever
// been assessed is worse than one that says so.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { computeFatigue, resolveFatigueThresholds, type ShiftRow } from "./fatigue";

const NONE = "00000000-0000-0000-0000-000000000000";
const DAY = 86400000;

export type WellbeingWindow = { days: number; from: string; to: string };

export async function loadWellbeing(
  admin: any, hid: string | null, isSuper: boolean,
  opts: { windowDays?: number; unitId?: string | null; now?: number } = {},
) {
  const now = opts.now ?? Date.now();
  const windowDays = opts.windowDays ?? 28;
  const fromDate = new Date(now - windowDays * DAY).toISOString().slice(0, 10);
  const toDate = new Date(now).toISOString().slice(0, 10);
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const soft = (p: any) => p.then((r: any) => r, () => ({ data: null, error: true }));

  const probe = await admin.from("op_wellbeing_checkins").select("id").limit(1);
  const provisioned = !(probe.error && /does not exist|schema cache/i.test(probe.error.message ?? ""));

  const [shiftRes, staffRes, actualRes, breakRes, leaveRes, checkRes, burnRes, refRes, planRes] = await Promise.all([
    soft(scope(admin.from("op_shifts")
      .select("id, shift_date, shift_type, starts_at, ends_at, unit_id")
      .gte("shift_date", fromDate).lte("shift_date", toDate).limit(2000))),
    soft(admin.from("op_shift_staff").select("shift_id, staff_id, role, status, profiles!staff_id(full_name)").limit(5000)),
    soft(scope(admin.from("op_roster_actuals")
      .select("staff_id, staff_name, shift_date, actual_hours, attendance_status")
      .gte("shift_date", fromDate).limit(2000))),
    soft(scope(admin.from("op_staff_breaks").select("id, staff_id, status, duration_min, created_at")
      .gte("created_at", new Date(now - windowDays * DAY).toISOString()).limit(2000))),
    soft(scope(admin.from("op_leave_records").select("id, staff_id, staff_name, absence_type, absence_date")
      .gte("absence_date", fromDate).limit(1000))),
    provisioned ? soft(scope(admin.from("op_wellbeing_checkins")
      .select("id, staff_id, checkin_date, energy, workload, support, sleep_quality, mood, visibility, comment, profiles!staff_id(full_name)")
      .gte("checkin_date", fromDate).limit(2000))) : { data: [] },
    provisioned ? soft(scope(admin.from("op_burnout_assessments")
      .select("id, staff_id, instrument, total_score, risk_band, assessed_at, follow_up_required, profiles!staff_id(full_name)")
      .gte("assessed_at", new Date(now - 180 * DAY).toISOString()).limit(1000))) : { data: [] },
    provisioned ? soft(scope(admin.from("op_occupational_referrals")
      .select("id, staff_id, category, urgency, status, reason, referred_at, self_referred, profiles!staff_id(full_name)")
      .limit(500))) : { data: [] },
    provisioned ? soft(scope(admin.from("op_wellbeing_plans")
      .select("id, staff_id, scope, trigger, goal, status, review_date, owner_name, profiles!staff_id(full_name)")
      .limit(500))) : { data: [] },
  ]);

  const shifts = (shiftRes.data ?? []) as any[];
  const shiftIds = new Set(shifts.map(s => s.id));
  const staffRows = ((staffRes.data ?? []) as any[]).filter(r => shiftIds.has(r.shift_id));
  const byShift = new Map(shifts.map(s => [s.id, s]));
  const nameOf = new Map<string, string>();
  for (const r of staffRows) if (r.profiles?.full_name) nameOf.set(r.staff_id, r.profiles.full_name);

  // ── Fatigue, from the SHARED engine ──
  const { thresholds, configured } = await resolveFatigueThresholds(admin, { hospitalId: hid, unitId: opts.unitId ?? null });
  const rows: ShiftRow[] = staffRows.map(r => {
    const s = byShift.get(r.shift_id);
    return { staffId: r.staff_id, date: s?.shift_date ?? null, startsAt: s?.starts_at, endsAt: s?.ends_at, shiftType: s?.shift_type };
  }).filter(r => r.date);
  const fatigue = computeFatigue(rows, thresholds).map(f => ({ ...f, name: nameOf.get(f.staffId) ?? "Staff" }));
  const flagged = fatigue.filter(f => f.band !== "none");

  // A single index for the ribbon: the share of rostered staff carrying at least one fatigue flag. Null
  // when nobody is rostered in the window — there is no index to state, and 0% would imply a healthy unit.
  const fatigueIndex = fatigue.length ? Math.round((flagged.length / fatigue.length) * 100) : null;

  // ── Overtime (recorded) ──
  const actuals = (actualRes.data ?? []) as any[];
  const withHours = actuals.filter(a => a.actual_hours != null);
  const overtime = {
    recorded: actuals.length,
    withHours: withHours.length,
    totalHours: withHours.length ? Math.round(withHours.reduce((s, a) => s + Number(a.actual_hours), 0) * 10) / 10 : null,
    avgHours: withHours.length ? Math.round((withHours.reduce((s, a) => s + Number(a.actual_hours), 0) / withHours.length) * 10) / 10 : null,
    overtimeShifts: actuals.filter(a => a.attendance_status === "overtime_extension").length,
  };

  // ── Break compliance (recorded) ──
  const breaks = (breakRes.data ?? []) as any[];
  const missed = breaks.filter(b => b.status === "missed").length;
  const breakCompliance = {
    recorded: breaks.length,
    missed,
    overdue: breaks.filter(b => b.status === "overdue").length,
    completed: breaks.filter(b => b.status === "completed").length,
    rate: breaks.length ? Math.round(((breaks.length - missed) / breaks.length) * 100) : null,
  };

  // ── Sick leave (recorded) ──
  const leave = (leaveRes.data ?? []) as any[];
  const sick = leave.filter(l => l.absence_type === "sick");
  const sickLeave = {
    recorded: leave.length,
    sickDays: sick.length,
    staffAffected: new Set(sick.map(l => l.staff_id)).size,
    byWeek: Array.from({ length: Math.min(4, Math.ceil(windowDays / 7)) }, (_, i) => {
      const end = now - i * 7 * DAY, start = end - 7 * DAY;
      const label = new Date(start).toISOString().slice(5, 10);
      const n = sick.filter(l => {
        const t = new Date(`${l.absence_date}T00:00:00Z`).getTime();
        return t >= start && t < end;
      }).length;
      return { label, value: n };
    }).reverse(),
  };

  // ── Check-ins: AGGREGATE ALWAYS, IDENTITY ONLY BY CONSENT ──
  const checkins = (checkRes.data ?? []) as any[];
  const dims = ["energy", "workload", "support", "sleep_quality", "mood"] as const;
  const avg = (k: string) => {
    const vals = checkins.map(c => c[k]).filter((v: any) => typeof v === "number");
    return vals.length ? Math.round((vals.reduce((a: number, b: number) => a + b, 0) / vals.length) * 10) / 10 : null;
  };
  // Overall wellbeing score as a 0-100 from the five 1-5 dimensions, so it sits alongside other percentages.
  const dimAvgs = dims.map(d => avg(d)).filter((v): v is number => v != null);
  const wellbeingScore = dimAvgs.length
    ? Math.round(((dimAvgs.reduce((a, b) => a + b, 0) / dimAvgs.length - 1) / 4) * 100)
    : null;

  const shareable = checkins.filter(c => c.visibility !== "private");

  // SMALL-COHORT SUPPRESSION. Marking a check-in private is not enough on its own: with two responses, one
  // of them shared, a manager can simply deduce whose the other is. Below MIN_COHORT responses an aggregate
  // IS an individual disclosure, so the scores and distributions are withheld and the surface says why.
  // Participation is still reported, because knowing people ARE checking in carries no personal detail.
  const MIN_COHORT = 3;
  const cohortSafe = checkins.length >= MIN_COHORT;

  const checkIns = {
    recorded: checkins.length,
    participants: new Set(checkins.map(c => c.staff_id)).size,
    // The private count is surfaced so a manager can see participation is real without seeing who.
    privateCount: checkins.length - shareable.length,
    minCohort: MIN_COHORT,
    cohortSafe,
    suppressedReason: cohortSafe ? null
      : `Aggregates are withheld below ${MIN_COHORT} check-ins: with so few responses an average would identify individuals.`,
    score: cohortSafe ? wellbeingScore : null,
    byDimension: cohortSafe ? dims.map(d => ({ dimension: d.replace(/_/g, " "), value: avg(d) })) : [],
    // Distribution of the lowest dimension per check-in — where support is most needed, anonymously.
    // Suppressed with the rest of the aggregate below MIN_COHORT.
    lowDimension: cohortSafe ? dims.map(d => ({
      dimension: d.replace(/_/g, " "),
      lowCount: checkins.filter(c => typeof c[d] === "number" && c[d] <= 2).length,
    })).sort((a, b) => b.lowCount - a.lowCount) : [],
    // ONLY consented rows carry a name. Private rows are dropped entirely rather than nulled, so there is
    // no partially-identifying record to correlate.
    shared: shareable.map(c => ({
      id: c.id, name: c.profiles?.full_name ?? "Staff", date: c.checkin_date,
      visibility: c.visibility, comment: c.comment,
      lowest: dims.map(d => ({ d, v: c[d] })).filter(x => typeof x.v === "number")
        .sort((a, b) => (a.v as number) - (b.v as number))[0] ?? null,
    })),
  };

  // ── Burnout, referrals, plans (recorded) ──
  const burnouts = (burnRes.data ?? []) as any[];
  const BANDS = ["low", "moderate", "high", "severe"];
  const burnout = {
    recorded: burnouts.length,
    assessed: new Set(burnouts.map(b => b.staff_id)).size,
    distribution: BANDS.map(band => ({ band, n: burnouts.filter(b => b.risk_band === band).length })),
    followUp: burnouts.filter(b => b.follow_up_required).length,
    atRisk: burnouts.filter(b => ["high", "severe"].includes(b.risk_band))
      .map(b => ({ id: b.id, name: b.profiles?.full_name ?? "Staff", band: b.risk_band, score: b.total_score, at: b.assessed_at, instrument: b.instrument })),
  };

  const referralRows = (refRes.data ?? []) as any[];
  const OPEN_REF = ["referred", "acknowledged", "in_assessment", "plan_agreed"];
  const referrals = {
    recorded: referralRows.length,
    open: referralRows.filter(r => OPEN_REF.includes(r.status)),
    urgent: referralRows.filter(r => OPEN_REF.includes(r.status) && ["urgent", "immediate"].includes(r.urgency)).length,
    selfReferred: referralRows.filter(r => r.self_referred).length,
    byCategory: [...new Set(referralRows.map(r => r.category))]
      .map(c => ({ category: c as string, n: referralRows.filter(r => r.category === c).length }))
      .sort((a, b) => b.n - a.n),
  };

  const planRows = (planRes.data ?? []) as any[];
  const OPEN_PLAN = ["open", "in_progress", "review_due"];
  const plans = {
    recorded: planRows.length,
    open: planRows.filter(p => OPEN_PLAN.includes(p.status))
      .map(p => ({ ...p, name: p.staff_id ? (p.profiles?.full_name ?? "Staff") : null, overdue: !!p.review_date && p.review_date < toDate })),
    completed: planRows.filter(p => p.status === "completed").length,
    overdueReviews: planRows.filter(p => OPEN_PLAN.includes(p.status) && p.review_date && p.review_date < toDate).length,
  };

  // ── Intervention signals: each traceable to a row, none inventing a clinical judgement ──
  const signals: { severity: "high" | "medium"; text: string }[] = [];
  for (const f of fatigue.filter(x => x.band === "high")) {
    signals.push({ severity: "high", text: `${f.name}: ${f.flags.join("; ")}.` });
  }
  if (burnout.atRisk.length) signals.push({ severity: "high", text: `${burnout.atRisk.length} staff assessed at high or severe burnout risk.` });
  if (referrals.urgent) signals.push({ severity: "high", text: `${referrals.urgent} urgent occupational health referral(s) still open.` });
  if (plans.overdueReviews) signals.push({ severity: "medium", text: `${plans.overdueReviews} wellbeing plan review(s) past their date.` });
  if (breakCompliance.missed) signals.push({ severity: "medium", text: `${breakCompliance.missed} break(s) recorded as missed.` });

  return {
    provisioned,
    window: { days: windowDays, from: fromDate, to: toDate } as WellbeingWindow,
    thresholds, thresholdsConfigured: configured,
    kpis: {
      rostered: fatigue.length,
      fatigueIndex,
      fatigueFlagged: flagged.length,
      fatigueHigh: fatigue.filter(f => f.band === "high").length,
      avgOvertimeHours: overtime.avgHours,
      missedBreaks: breakCompliance.recorded ? breakCompliance.missed : null,
      sickDays: sickLeave.recorded ? sickLeave.sickDays : null,
      wellbeingScore: checkIns.cohortSafe ? checkIns.score : null,
      burnoutHigh: burnout.recorded ? burnout.atRisk.length : null,
      openReferrals: referrals.recorded ? referrals.open.length : null,
    },
    fatigue, flagged, overtime, breakCompliance, sickLeave, checkIns, burnout, referrals, plans, signals,
  };
}
