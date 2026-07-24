import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCmoDashboard } from "@/lib/cmo-dashboard";

export const dynamic = "force-dynamic";

// Competency Operations Dashboard (CMO-001) — the operational command centre for competency
// readiness, enterprise to individual. The 12 spec widgets are computed once in loadCmoDashboard
// from live competency data (competency_decisions + framework/CPU governance). Real: readiness,
// expiries, workforce-by-CPU, risk alerts, domain readiness, validation queue, activity and
// rule-based (explainable) AI recommendations. Honest next-phase: readiness TREND lines (need a
// readiness_snapshots history) and per-widget export/filter (workspace-level).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";
const pctTone = (n: number) => (n >= 85 ? "text-emerald-600" : n >= 70 ? "text-amber-600" : "text-rose-600");
const barTone = (n: number) => (n >= 85 ? "bg-emerald-500" : n >= 70 ? "bg-amber-400" : "bg-rose-500");

function Kpi({ n, label, tone, sub, href }: { n: any; label: string; tone?: string; sub?: string; href?: string }) {
  const inner = (
    <div className={`${card} ${href ? "hover:border-teal-300 transition-colors" : ""}`}>
      <div className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{n}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default async function CompetencyOperationsDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "educator", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadCmoDashboard(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const h = d.header;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Competency Operations Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Real-time competency readiness — enterprise to individual · {profile?.full_name}</p>
      </div>

      {/* Header KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Kpi n={`${d.readiness.score}%`} label="Organisation readiness" tone={pctTone(d.readiness.score)} sub={`${d.readiness.current}/${d.readiness.total} current`} href="/competency-office/readiness" />
        <Kpi n={d.highRiskUnits.length} label="High-risk units" tone={d.highRiskUnits.length ? "text-rose-600" : "text-gray-400"} sub={`below ${d.highRiskThreshold}%`} href="/competency-office/readiness" />
        <Kpi n={d.expiring.d30} label="Expiring ≤30 days" tone={d.expiring.d30 ? "text-amber-600" : "text-gray-400"} sub={`${d.expiring.individuals} individuals`} href="/competency-office/credentialing" />
        <Kpi n={d.assessments.provisioned ? d.assessments.total : "—"} label="Assessments today" sub={d.assessments.provisioned ? `${d.assessments.completed} completed` : "cycle data"} href="/competency-office/assessments" />
        <Kpi n={d.awaitingValidation} label="Awaiting validation" tone={d.awaitingValidation ? "text-amber-600" : "text-gray-400"} href="/competency-office/validation" />
        <Kpi n={h.competencies} label="Governed competencies" sub={`${h.frameworks} frameworks`} href="/competency-office/frameworks" />
        <Kpi n={h.cpus} label="Clinical Practice Units" sub={`${h.activeCycles} active cycles`} href="/competency-office/cpus" />
      </div>

      {/* Operational readiness row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Organisation Readiness */}
        <div className={card}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">Organisation Readiness</h3><span className="text-[11px] text-gray-400">weighted, live</span></div>
          <div className="flex items-center gap-5">
            <div className="relative w-24 h-24 shrink-0">
              <div className="w-24 h-24 rounded-full" style={{ background: `conic-gradient(${d.readiness.score >= 85 ? "#10b981" : d.readiness.score >= 70 ? "#f59e0b" : "#ef4444"} 0% ${d.readiness.score}%, #f3f4f6 ${d.readiness.score}% 100%)` }} />
              <div className="absolute inset-[22%] rounded-full bg-white flex flex-col items-center justify-center"><span className={`text-lg font-bold ${pctTone(d.readiness.score)}`}>{d.readiness.score}%</span><span className="text-[8px] text-gray-400">ready</span></div>
            </div>
            <div className="flex-1 text-sm">
              <div className="flex justify-between py-1 border-b border-gray-50"><span className="text-gray-500">Current competencies</span><b className="tabular-nums">{d.readiness.current}</b></div>
              <div className="flex justify-between py-1 border-b border-gray-50"><span className="text-gray-500">Total governed</span><b className="tabular-nums">{d.readiness.total}</b></div>
              <div className="flex justify-between py-1"><span className="text-gray-500">Expiring 30/60/90</span><b className="tabular-nums">{d.expiring.d30}/{d.expiring.d60}/{d.expiring.d90}</b></div>
            </div>
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Trend lines need a retained readiness-snapshot history — honest next-phase. Business rule: readiness recalculates immediately after validation.</p>
        </div>

        {/* Workforce Readiness Table (by CPU) */}
        <div className={card}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900">Workforce Readiness</h3><Link href="/competency-office/readiness" className="text-[11px] text-teal-600 hover:underline">Drill down →</Link></div>
          {!d.decisionsReady || d.workforceByCpu.length === 0 ? <p className="text-sm text-gray-400">No competency decisions with a CPU yet.</p> : (
            <div className="space-y-2">
              {d.workforceByCpu.slice(0, 6).map(u => (
                <div key={u.id} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700 truncate">{u.name}</span><span className={`tabular-nums font-semibold ${pctTone(u.pct)}`}>{u.pct}% <span className="text-gray-400 font-normal">({u.current}/{u.total})</span></span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${barTone(u.pct)}`} style={{ width: `${u.pct}%` }} /></div></div>
              ))}
              <p className="text-[10px] text-gray-400 pt-1">Required vs available competencies by Clinical Practice Unit.</p>
            </div>
          )}
        </div>
      </div>

      {/* Risk & analytics row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* High Risk Units */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">High Risk Units</h3>
          {d.highRiskUnits.length === 0 ? <p className="text-sm text-gray-400">No units below the {d.highRiskThreshold}% threshold. 🎉</p> : (
            <div className="space-y-1.5">{d.highRiskUnits.slice(0, 6).map(u => (
              <div key={u.id} className="flex items-center justify-between text-xs"><span className="text-gray-700 truncate">{u.name}</span><span className="text-rose-600 font-semibold tabular-nums">{u.pct}%</span></div>
            ))}</div>
          )}
        </div>

        {/* Competency Risk Alerts */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Competency Risk Alerts</h3>
          {d.risks.length === 0 ? <p className="text-sm text-gray-400">No critical competency risks.</p> : (
            <div className="space-y-2">{d.risks.slice(0, 5).map((r, i) => (
              <div key={i} className="flex items-start gap-2"><span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${r.severity === "high" ? "bg-rose-500" : "bg-amber-400"}`} /><div><p className="text-xs font-medium text-gray-800">{r.label}</p><p className="text-[11px] text-gray-500">{r.detail}</p></div></div>
            ))}</div>
          )}
        </div>

        {/* Competency Domain Chart */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Readiness by Domain</h3>
          {d.domains.length === 0 ? <p className="text-sm text-gray-400">Domain readiness needs competency-to-domain mapping.</p> : (
            <div className="space-y-2">{d.domains.slice(0, 6).map(dom => (
              <div key={dom.name} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700 truncate">{dom.name}</span><span className={`tabular-nums font-semibold ${pctTone(dom.pct)}`}>{dom.pct}%</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${barTone(dom.pct)}`} style={{ width: `${dom.pct}%` }} /></div></div>
            ))}</div>
          )}
        </div>
      </div>

      {/* Activity & AI row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* AI Recommendations */}
        <div className={`${card} bg-gradient-to-br from-teal-50/40 to-white`}>
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">✨ AI Recommendations <span className="text-[10px] font-normal text-gray-400">explainable</span></h3>
          {d.ai.length === 0 ? <p className="text-sm text-gray-400">No priority actions — competency operations are on track.</p> : (
            <div className="space-y-2">{d.ai.slice(0, 5).map((a, i) => (
              <div key={i} className="rounded-lg border border-gray-100 p-2.5"><div className="flex items-start justify-between gap-2"><p className="text-xs text-gray-800 flex-1">{a.text}</p><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${a.priority === "high" ? "bg-rose-50 text-rose-700" : a.priority === "medium" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{a.priority}</span></div><p className="text-[10px] text-gray-400 mt-1">Why: {a.why}</p></div>
            ))}</div>
          )}
        </div>

        {/* Activity Feed */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Activity Feed</h3>
          {d.activity.length === 0 ? <p className="text-sm text-gray-400">No recent competency activity.</p> : (
            <div className="divide-y divide-gray-50">{d.activity.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between gap-2 py-1.5 text-xs"><span className="text-gray-700 truncate">{(a.action ?? "").replace(/_/g, " ")}</span><span className="text-gray-400 shrink-0">{a.actor?.full_name ?? "—"}</span></div>
            ))}</div>
          )}
        </div>

        {/* Quick Actions */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Quick Actions</h3>
          <div className="grid grid-cols-1 gap-2 text-sm">
            {[["📋 Assessments", "/competency-office/assessments"], ["📎 Evidence Centre", "/competency-office/evidence"], ["✅ Validation queue", "/competency-office/validation"], ["🎓 Credentialing", "/competency-office/credentialing"], ["📈 Analytics", "/competency-office/analytics"]].map(([label, href]) => (
              <Link key={href} href={href} className="border border-gray-200 rounded-lg px-3 py-2 text-gray-700 hover:border-teal-300 hover:text-teal-700 transition-colors">{label}</Link>
            ))}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Competency Operations Dashboard (CMO-001) over the live competency spine (competency_decisions) + framework/CPU governance. Real: organisation readiness, workforce readiness by CPU, high-risk units, expiring competencies (30/60/90) &amp; individuals, competency risk alerts, domain readiness, validation queue, activity and rule-based explainable AI recommendations. Honest next-phase: readiness trend history (needs readiness_snapshots), assessments-today where cycle data is sparse, and per-widget export/filter. Every calculation is tenant-scoped; readiness recalculates on validation.</p>
    </div>
  );
}
