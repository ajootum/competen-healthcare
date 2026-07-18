import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";

// Quality Indicators (spec §Quality Indicators) — all nine, each computed
// from live records with its formula stated on the card. Indicators with no
// underlying data show "—", never an invented value.

export const dynamic = "force-dynamic";

export default async function QualityIndicatorsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const myRoles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!myRoles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    redirect("/dashboard");
  }
  const hospitalId = me?.hospital_id ?? null;

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const d30 = new Date(now.getTime() - 30 * 86400000).toISOString();

  const [{ data: nurses }, { data: sched }, { data: logEntries }, { data: simAssess }, { data: osceRes }, { data: audits }] = await Promise.all([
    hospitalId ? admin.from("profiles").select("id").eq("hospital_id", hospitalId).eq("role", "nurse") : Promise.resolve({ data: [] }),
    hospitalId ? admin.from("scheduled_assessments").select("status, scheduled_for").eq("hospital_id", hospitalId).limit(1000) : Promise.resolve({ data: [] }),
    hospitalId
      ? admin.from("skill_log_entries").select("status, created_at, verified_at, profiles!nurse_id(hospital_id)").order("created_at", { ascending: false }).limit(1000)
      : Promise.resolve({ data: [] }),
    admin.from("assessments")
      .select("score, assessed_at, competency_cycles!cycle_id(hospital_id)")
      .eq("method", "simulation").eq("status", "complete").not("score", "is", null)
      .gte("assessed_at", d30).limit(500),
    hospitalId
      ? admin.from("osce_results").select("score, osce_exams!exam_id(hospital_id)").limit(1000)
      : Promise.resolve({ data: [] }),
    hospitalId ? admin.from("audits").select("compliance_pct").eq("hospital_id", hospitalId).not("compliance_pct", "is", null).limit(500) : Promise.resolve({ data: [] }),
  ]);

  const nurseIds = (nurses ?? []).map(n => n.id);
  const { data: decisions } = nurseIds.length
    ? await admin.from("competency_decisions")
        .select("nurse_id, competency_id, outcome, validation_outcome, expiry_date, created_at")
        .in("nurse_id", nurseIds).order("created_at", { ascending: false }).limit(3000)
    : { data: [] };

  // Latest decision per nurse+competency
  const seen = new Set<string>();
  let total = 0, compliant = 0, expired = 0;
  for (const d of decisions ?? []) {
    const key = `${d.nurse_id}:${d.competency_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    total++;
    const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;
    const isExpired = passing && d.expiry_date && d.expiry_date < today;
    if (isExpired) expired++;
    if (passing && d.validation_outcome === "validated" && !isExpired) compliant++;
  }

  const pastSched = (sched ?? []).filter(s => s.scheduled_for < now.toISOString() && s.status !== "cancelled");
  const completion = pastSched.length ? Math.round(pastSched.filter(s => s.status === "completed").length / pastSched.length * 100) : null;
  const overdueSessions = pastSched.filter(s => s.status === "scheduled").length;

  const hosEntries = (logEntries ?? []).filter(e =>
    !hospitalId || (e.profiles as unknown as { hospital_id: string | null } | null)?.hospital_id === hospitalId);
  const backlog = hosEntries.filter(e => e.status === "pending").length;
  const turn = hosEntries.filter(e => e.status === "verified" && e.verified_at && (e.verified_at as string) >= d30 && e.created_at);
  const avgTurnHours = turn.length
    ? Math.round(turn.reduce((s, e) => s + (new Date(e.verified_at as string).getTime() - new Date(e.created_at as string).getTime()), 0) / turn.length / 36e5)
    : null;

  const hosSim = (simAssess ?? []).filter(a =>
    !hospitalId || (a.competency_cycles as unknown as { hospital_id: string | null } | null)?.hospital_id === hospitalId);
  const simPass = hosSim.length ? Math.round(hosSim.filter(a => a.score >= 3).length / hosSim.length * 100) : null;

  const hosOsce = (osceRes ?? []).filter(r =>
    !hospitalId || (r.osce_exams as unknown as { hospital_id: string | null } | null)?.hospital_id === hospitalId);
  const oscePass = hosOsce.length ? Math.round(hosOsce.filter(r => r.score >= 3).length / hosOsce.length * 100) : null;

  const auditCompliance = (audits ?? []).length
    ? Math.round((audits ?? []).reduce((s, a) => s + Number(a.compliance_pct), 0) / (audits ?? []).length)
    : null;

  type Ind = { icon: string; name: string; value: string; n: string; how: string; good?: boolean; bad?: boolean };
  const pct = (v: number | null) => v != null ? `${v}%` : "—";
  const INDICATORS: Ind[] = [
    { icon: "📅", name: "Assessment Completion Rate", value: pct(completion), n: `${pastSched.length} past sessions`, how: "Past scheduled sessions marked completed ÷ all past non-cancelled sessions.", good: completion != null && completion >= 80, bad: completion != null && completion < 60 },
    { icon: "🛂", name: "Competency Compliance", value: pct(total ? Math.round(compliant / total * 100) : null), n: `${total} latest decisions`, how: "Latest decision per clinician+competency that is passing, validated and unexpired.", good: total > 0 && compliant / total >= 0.8 },
    { icon: "⏳", name: "Expired Competencies", value: String(expired), n: "needing reassessment", how: "Latest passing decisions whose expiry date has passed.", bad: expired > 0 },
    { icon: "🖊️", name: "Evidence Backlog", value: String(backlog), n: "pending logbook entries", how: "Logbook entries in status pending awaiting verifier review.", bad: backlog > 10 },
    { icon: "⚡", name: "Validation Turnaround", value: avgTurnHours != null ? `${avgTurnHours}h` : "—", n: `${turn.length} verified (30d)`, how: "Average hours from logbook submission to verification, last 30 days.", good: avgTurnHours != null && avgTurnHours <= 48 },
    { icon: "🧪", name: "Simulation Performance", value: pct(simPass), n: `${hosSim.length} sims (30d)`, how: "Simulation-method assessments scoring ≥3 (Benner passing), last 30 days.", good: simPass != null && simPass >= 80 },
    { icon: "🩺", name: "OSCE Pass Rate", value: pct(oscePass), n: `${hosOsce.length} station results`, how: "OSCE station results scoring ≥3 across all exams.", good: oscePass != null && oscePass >= 80 },
    { icon: "📋", name: "Audit Compliance", value: pct(auditCompliance), n: `${(audits ?? []).length} audits`, how: "Average compliance % across all conducted audits (met ÷ (met + not met)).", good: auditCompliance != null && auditCompliance >= 85 },
    { icon: "🔁", name: "Reassessment Overdue", value: String(overdueSessions), n: "past-due sessions", how: "Scheduled assessment sessions whose time has passed without completion or cancellation.", bad: overdueSessions > 0 },
  ];

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-1">
        <Link href="/assessor/quality" className="text-xs text-gray-400 hover:text-gray-600">← Quality &amp; Governance</Link>
      </div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">📐 Quality Indicators</h1>
        <p className="text-gray-400 text-sm mt-0.5">All nine spec indicators, computed live — each card states exactly how its value is derived.</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {INDICATORS.map(ind => (
          <div key={ind.name} className={`bg-white border rounded-xl p-4 ${ind.bad ? "border-red-200" : ind.good ? "border-green-200" : "border-gray-200"}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">{ind.icon}</span>
              <p className="text-[11px] font-bold text-gray-700 leading-tight">{ind.name}</p>
            </div>
            <p className={`text-2xl font-bold ${ind.bad ? "text-red-600" : ind.good ? "text-green-600" : "text-gray-900"}`}>{ind.value}</p>
            <p className="text-[10px] text-gray-400">{ind.n}</p>
            <p className="text-[9px] text-gray-400 mt-2 leading-snug border-t border-gray-50 pt-2">{ind.how}</p>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Indicators showing &quot;—&quot; have no underlying data yet. Values are hospital-scoped and refresh on every page load.
      </p>
    </div>
  );
}
