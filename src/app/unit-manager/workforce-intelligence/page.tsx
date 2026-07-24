import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceIntelligence } from "@/lib/operations/workforce-intelligence";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../UnitFilters";

export const dynamic = "force-dynamic";

// Workforce Intelligence Engine (UMW Platform Engine) — a rule-based, explainable intelligence surface
// over the live workforce state (loadWorkforceIntelligence composes loadWorkforceOps + loadWorkforceReadiness).
// Real: intelligence KPIs, a transparent staffing-risk score, predictive alerts, a competency-gap forecast
// and deployment recommendations — each shows the rule + data. Honest next-phase: forward-looking trend
// forecasting (needs retained history) and shift-swap/roster simulation.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const BAND_TONE: Record<string, string> = { Low: "text-emerald-600", Elevated: "text-amber-600", High: "text-rose-600" };
const BAND_RING: Record<string, string> = { Low: "#10b981", Elevated: "#f59e0b", High: "#ef4444" };
const SEV_TONE: Record<string, string> = { critical: "bg-rose-50 text-rose-700", high: "bg-rose-50 text-rose-700", moderate: "bg-amber-50 text-amber-700", medium: "bg-amber-50 text-amber-700" };

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function WorkforceIntelligence() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadWorkforceIntelligence(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Workforce Intelligence Engine</h1><p className="text-sm text-gray-500">Explainable, rule-based intelligence over the live workforce — risk, gaps and deployment recommendations.</p></div>
      <UnitFilters departments={departments} />
    </div>
  );
  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No active shift / workforce data</p><p className="text-sm text-amber-800 mt-1">Workforce intelligence activates once an operational shift with staffing is running for this unit.</p></div></div>;

  const k = d.kpis;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Intelligence score" value={k.intelligenceScore} sub="composite" tone={k.intelligenceScore >= 85 ? "text-emerald-600" : k.intelligenceScore >= 70 ? "text-amber-600" : "text-rose-600"} />
        <Kpi label="Workforce readiness" value={k.readiness != null ? `${k.readiness}%` : "—"} sub={k.readiness == null ? "no competency data" : "deployable"} />
        <Kpi label="Coverage" value={`${k.coverage}%`} sub="present vs required" tone={k.coverage >= 90 ? "text-emerald-600" : k.coverage >= 75 ? "text-amber-600" : "text-rose-600"} />
        <Kpi label="Skill-mix" value={k.skillMix != null ? `${k.skillMix}%` : "—"} sub={k.skillMix == null ? "no competency data" : "on-shift competency"} />
        <Kpi label="Deployable" value={k.deployable ?? "—"} sub="fully current staff" />
        <Kpi label="Critical gaps" value={k.criticalGaps} sub="no / single cover" tone={k.criticalGaps ? "text-rose-600" : "text-gray-400"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Staffing risk composite */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-1 flex items-center gap-2">Staffing Risk <span className="text-[10px] font-normal text-gray-400">rule-based composite</span></h3>
          <div className="flex items-center gap-4 mt-2">
            <div className="relative w-24 h-24 shrink-0"><div className="w-24 h-24 rounded-full" style={{ background: `conic-gradient(${BAND_RING[k.riskBand]} 0% ${k.riskScore}%, #f3f4f6 ${k.riskScore}% 100%)` }} /><div className="absolute inset-[22%] rounded-full bg-white flex flex-col items-center justify-center"><span className={`text-lg font-bold ${BAND_TONE[k.riskBand]}`}>{k.riskScore}</span><span className="text-[8px] text-gray-400">/ 100</span></div></div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-bold ${BAND_TONE[k.riskBand]}`}>{k.riskBand} risk</p>
              <div className="mt-1.5 space-y-1">{d.drivers.slice(0, 5).map((dr: any, i: number) => (<div key={i} className="flex items-center justify-between text-[11px]"><span className="text-gray-600 truncate">{dr.label}</span><span className="text-gray-400 tabular-nums ml-2">+{dr.pts}</span></div>))}{d.drivers.length === 0 && <p className="text-[11px] text-gray-400">No active risk drivers.</p>}</div>
            </div>
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Transparent composite of coverage, critical gaps, absence, skill-mix and expired credentials — not a trained model.</p>
        </div>

        {/* Predictive alerts */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Predictive Alerts</h3>
          {d.alerts.length === 0 ? <p className="text-sm text-gray-400">No predicted workforce risks. 🎉</p> : (
            <div className="space-y-2">{d.alerts.slice(0, 5).map((a: any, i: number) => (<div key={i} className="flex items-start gap-2"><span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${a.severity === "high" ? "bg-rose-500" : "bg-amber-400"}`} /><div className="min-w-0"><p className="text-xs font-semibold text-gray-800">{a.title}</p><p className="text-[11px] text-gray-500">{a.detail}</p></div></div>))}</div>
          )}
        </div>

        {/* Competency-gap forecast */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Competency-Gap Forecast</h3>
          {d.forecast.length === 0 ? <p className="text-sm text-gray-400">No competency-coverage risks.</p> : (
            <div className="space-y-2">{d.forecast.map((f: any, i: number) => (<div key={i} className="rounded-lg border border-gray-100 p-2.5"><div className="flex items-start justify-between gap-2"><p className="text-xs font-semibold text-gray-800">{f.title}</p><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${SEV_TONE[f.severity] ?? "bg-gray-100 text-gray-500"}`}>{f.severity}</span></div><p className="text-[11px] text-gray-500 mt-0.5">{f.detail}</p></div>))}</div>
          )}
        </div>
      </div>

      {/* Deployment recommendations */}
      <div className={`${card} p-5 bg-gradient-to-br from-emerald-50/40 to-white`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">✨ Deployment Recommendations <span className="text-[10px] font-normal text-gray-400">explainable · advisory</span></h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">{d.recs.map((rec: any, i: number) => (
          <div key={i} className="rounded-lg border border-gray-100 bg-white p-3"><div className="flex items-start justify-between gap-2"><p className="text-xs text-gray-800 flex-1">{rec.text}</p><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${rec.priority === "high" ? "bg-rose-50 text-rose-700" : rec.priority === "medium" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{rec.priority}</span></div><p className="text-[10px] text-gray-400 mt-1">Why: {rec.why}</p></div>
        ))}</div>
      </div>

      {/* Per-role staffing intelligence */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Per-role staffing intelligence</h3>
        <table className="w-full text-xs"><thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-1.5 font-medium">Role</th><th className="py-1.5 font-medium text-right">Req</th><th className="py-1.5 font-medium text-right">On</th><th className="py-1.5 font-medium text-right">Coverage</th><th className="py-1.5 font-medium text-right">Signal</th></tr></thead>
          <tbody>{d.staffingOverview.map((r: any) => (<tr key={r.role} className="border-b border-gray-50"><td className="py-1.5 text-gray-700">{r.label}</td><td className="py-1.5 text-right text-gray-600 tabular-nums">{r.required ?? "—"}</td><td className="py-1.5 text-right text-gray-600 tabular-nums">{r.present}</td><td className="py-1.5 text-right font-semibold tabular-nums">{r.coverage != null ? `${r.coverage}%` : "—"}</td><td className="py-1.5 text-right"><span className={`text-[9px] px-1.5 py-0.5 rounded ${r.coverage != null && r.coverage >= 100 ? "bg-emerald-50 text-emerald-700" : r.coverage != null && r.coverage >= 75 ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>{r.coverage != null && r.coverage >= 100 ? "OK" : r.coverage != null && r.coverage >= 75 ? "Watch" : "Risk"}</span></td></tr>))}</tbody>
        </table>
        <p className="text-[10px] text-gray-400 mt-2">{d.floatAvail} float staff available for redeployment.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Workforce Intelligence Engine over the live workforce state (loadWorkforceOps + loadWorkforceReadiness). Real: intelligence KPIs, the rule-based staffing-risk score, predictive alerts, competency-gap forecast and explainable deployment recommendations (advisory — need manager approval). Honest next-phase: forward-looking trend forecasting (needs retained history) and shift-swap / roster simulation. Deep workforce analytics live in <Link href="/unit-manager/workforce-management/analytics" className="text-emerald-700 hover:underline">Analytics &amp; Reports</Link>.</p>
    </div>
  );
}
