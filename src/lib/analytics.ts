import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";

type Admin = ReturnType<typeof createAdminClient>;

/** Auth + role gate shared by every Analytics & Reports module page. */
export async function requireAnalyticsAccess() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    redirect("/dashboard");
  }
  return { admin, hospitalId: me?.hospital_id ?? null, userId: user!.id };
}

// Shared loader for the Analytics & Reports modules (Architecture spec §5:
// "shared analytics components"). One hospital-scoped context, computed from
// live records, consumed by every module page so figures agree across pages.

export type AnalyticsNurse = { id: string; name: string; dept: string };
export type AnalyticsStaff = { id: string; name: string };
export type AnalyticsAssessment = {
  score: number; method: string; assessed_at: string; created_at: string | null;
  nurse_id: string; assessor_id: string | null; competency_id: string | null;
};
export type AnalyticsEntry = { status: string; created_at: string; verified_at: string | null; nurse_id: string };
export type LatestDecision = {
  nurse_id: string; competency_id: string; name: string;
  passing: boolean; expired: boolean; validated: boolean; critical: boolean;
  expiry_date: string | null;
};
export type AnalyticsCtx = {
  today: string;
  nurses: AnalyticsNurse[];
  nurseIds: Set<string>;
  staff: AnalyticsStaff[];
  staffName: Map<string, string>;
  assess: AnalyticsAssessment[];   // last 8 weeks, complete + scored, this hospital
  entries: AnalyticsEntry[];       // last ~1500 logbook entries, this hospital
  latest: LatestDecision[];        // latest decision per nurse+competency
  sched: { status: string; scheduled_for: string; nurse_id: string; assessor_id: string | null }[];
};

export async function loadAnalytics(admin: Admin, hospitalId: string | null): Promise<AnalyticsCtx> {
  const now = new Date();
  const d56 = new Date(now.getTime() - 8 * 7 * 86400000).toISOString();

  const [{ data: people }, { data: assessRaw }, { data: logRaw }, { data: schedRaw }] = await Promise.all([
    hospitalId
      ? admin.from("profiles").select("id, full_name, specialization, role, roles").eq("hospital_id", hospitalId).limit(600)
      : Promise.resolve({ data: [] }),
    admin.from("assessments")
      .select("score, method, assessed_at, created_at, assessor_id, competency_id, competency_cycles!cycle_id(hospital_id, nurse_id)")
      .eq("status", "complete").not("score", "is", null).gte("assessed_at", d56)
      .order("assessed_at", { ascending: false }).limit(3000),
    hospitalId
      ? admin.from("skill_log_entries")
          .select("status, created_at, verified_at, nurse_id, profiles!nurse_id(hospital_id)")
          .order("created_at", { ascending: false }).limit(1500)
      : Promise.resolve({ data: [] }),
    hospitalId
      ? admin.from("scheduled_assessments").select("status, scheduled_for, nurse_id, assessor_id").eq("hospital_id", hospitalId).limit(1000)
      : Promise.resolve({ data: [] }),
  ]);

  const rolesOf = (p: { role: string | null; roles: string[] | null }) => (p.roles?.length ? p.roles : [p.role]).filter(Boolean) as string[];
  const nurses: AnalyticsNurse[] = (people ?? [])
    .filter(p => rolesOf(p).includes("nurse"))
    .map(p => ({ id: p.id, name: p.full_name, dept: p.specialization ?? "General" }));
  const nurseIds = new Set(nurses.map(n => n.id));
  const staff: AnalyticsStaff[] = (people ?? [])
    .filter(p => rolesOf(p).some(r => ["assessor", "educator", "hospital_admin"].includes(r)))
    .map(p => ({ id: p.id, name: p.full_name }));
  const staffName = new Map(staff.map(s => [s.id, s.name]));

  const assess: AnalyticsAssessment[] = (assessRaw ?? [])
    .filter(a => {
      const c = a.competency_cycles as unknown as { hospital_id: string | null } | null;
      return !hospitalId || c?.hospital_id === hospitalId;
    })
    .map(a => ({
      score: a.score as number, method: a.method as string,
      assessed_at: a.assessed_at as string, created_at: (a.created_at as string | null) ?? null,
      nurse_id: (a.competency_cycles as unknown as { nurse_id: string }).nurse_id,
      assessor_id: a.assessor_id as string | null,
      competency_id: (a.competency_id as string | null) ?? null,
    }));

  const entries: AnalyticsEntry[] = (logRaw ?? [])
    .filter(e => !hospitalId || (e.profiles as unknown as { hospital_id: string | null } | null)?.hospital_id === hospitalId)
    .map(e => ({ status: e.status as string, created_at: e.created_at as string, verified_at: (e.verified_at as string | null) ?? null, nurse_id: e.nurse_id as string }));

  const today = now.toISOString().slice(0, 10);
  const { data: decisionsRaw } = nurseIds.size
    ? await admin.from("competency_decisions")
        .select("nurse_id, competency_id, outcome, validation_outcome, expiry_date, critical_failure, created_at, framework_competencies!competency_id(name)")
        .in("nurse_id", [...nurseIds]).order("created_at", { ascending: false }).limit(4000)
    : { data: [] };

  const seen = new Set<string>();
  const latest: LatestDecision[] = [];
  for (const d of decisionsRaw ?? []) {
    const key = `${d.nurse_id}:${d.competency_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;
    latest.push({
      nurse_id: d.nurse_id, competency_id: d.competency_id,
      name: (d.framework_competencies as unknown as { name: string } | null)?.name ?? "Competency",
      passing,
      expired: !!(passing && d.expiry_date && d.expiry_date < today),
      validated: d.validation_outcome === "validated",
      critical: !!d.critical_failure,
      expiry_date: d.expiry_date ?? null,
    });
  }

  return {
    today, nurses, nurseIds, staff, staffName, assess, entries, latest,
    sched: (schedRaw ?? []).map(s => ({ status: s.status as string, scheduled_for: s.scheduled_for as string, nurse_id: s.nurse_id as string, assessor_id: (s.assessor_id as string | null) ?? null })),
  };
}

// ── Shared derivations ───────────────────────────────────────────────────────

export const passRateOf = (xs: { score: number }[]) =>
  xs.length ? Math.round(xs.filter(a => a.score >= 3).length / xs.length * 100) : null;
export const avgScoreOf = (xs: { score: number }[]) =>
  xs.length ? Math.round(xs.reduce((s, a) => s + a.score, 0) / xs.length * 10) / 10 : null;

export function deltaLabel(cur: number | null, prev: number | null): string | null {
  if (cur == null || prev == null || prev === 0) return null;
  const d = Math.round((cur - prev) / Math.abs(prev) * 100);
  if (d === 0) return "±0%";
  return `${d > 0 ? "▲" : "▼"} ${Math.abs(d)}%`;
}

/** Per-nurse risk from latest decisions: high = critical failure; medium = failed or expired. */
export function riskBuckets(latest: LatestDecision[], nurseCount: number) {
  const byNurse = new Map<string, "high" | "medium">();
  for (const d of latest) {
    if (d.critical) byNurse.set(d.nurse_id, "high");
    else if ((!d.passing || d.expired) && byNurse.get(d.nurse_id) !== "high") byNurse.set(d.nurse_id, "medium");
  }
  const high = [...byNurse.values()].filter(v => v === "high").length;
  const medium = [...byNurse.values()].filter(v => v === "medium").length;
  return { high, medium, low: Math.max(0, nurseCount - high - medium), byNurse };
}

/** Group latest decisions per competency name → pass profile. */
export function competencyProfile(latest: LatestDecision[]) {
  const agg = new Map<string, { pass: number; total: number; expSoon: number }>();
  const in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  for (const d of latest) {
    const a = agg.get(d.name) ?? { pass: 0, total: 0, expSoon: 0 };
    a.total++;
    if (d.passing && !d.expired) a.pass++;
    if (d.passing && d.expiry_date && d.expiry_date >= today && d.expiry_date <= in90) a.expSoon++;
    agg.set(d.name, a);
  }
  return [...agg.entries()].map(([name, v]) => ({
    name, total: v.total, expSoon: v.expSoon,
    pct: Math.round(v.pass / v.total * 100),
  }));
}
