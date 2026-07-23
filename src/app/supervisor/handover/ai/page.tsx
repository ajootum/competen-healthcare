import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadHandoverContext } from "@/lib/operations/handover";
import HandoverNav from "../HandoverNav";

export const dynamic = "force-dynamic";

// AI Handover Assistant (SSW-HC-009) — the intelligence layer. Rule-based (explainable,
// no fabrication) analysis over live operational data: risk ranking, deterioration
// signals, missing-information detection, a shift summary and recommendations, each
// derived from real op_* fields with a transparent confidence from data completeness.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const RISK_BADGE: Record<string, string> = { "High Risk": "bg-rose-50 text-rose-700", "At Risk": "bg-amber-50 text-amber-700", "Stable": "bg-emerald-50 text-emerald-700" };

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-3.5`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}

export default async function AIHandoverAssistant() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadHandoverContext(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const header = (<><div className="flex items-center gap-2"><span className="text-xl">🤖</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">AI Handover Assistant</h1><p className="text-sm text-gray-500">Intelligent insights and recommendations to support safer, higher-quality handovers.</p></div></div><HandoverNav /></>);
  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operational data not provisioned</p></div></div>;

  const rows = d.rows;
  const highRisk = rows.filter((r: any) => r.risk === "High Risk");
  const deterioration = rows.filter((r: any) => r.pews != null && r.pews >= 6).length;
  const withPews = rows.filter((r: any) => r.pews != null).length;
  const confidence = rows.length ? Math.round((withPews / rows.length) * 100) : 0;
  const missing = rows.filter((r: any) => r.pews == null).map((r: any) => ({ label: r.label, bed: r.bed, gap: "PEWS observation not recorded" }))
    .concat(rows.filter((r: any) => r.openTasks === 0 && r.risk === "High Risk").map((r: any) => ({ label: r.label, bed: r.bed, gap: "High risk with no documented task/plan" })));
  const overdue = d.tasks.filter((t: any) => t.due_at && t.due_at < new Date().toISOString()).length;
  const quality = d.kpis.jbiCompliance;

  const recs: string[] = [];
  highRisk.slice(0, 2).forEach((r: any) => recs.push(`Closely monitor ${r.bed ? `Bed ${r.bed} (${r.label})` : r.label} overnight — ${r.risk}, PEWS ${r.pews ?? "n/r"}.`));
  if (overdue) recs.push(`Resolve ${overdue} overdue task${overdue === 1 ? "" : "s"} before responsibility transfer.`);
  if (missing.length) recs.push(`Complete missing information on ${missing.length} patient${missing.length === 1 ? "" : "s"} before sign-off.`);
  if (!recs.length) recs.push("No urgent recommendations — proceed with standard handover.");

  const confLabel = confidence >= 85 ? "High" : confidence >= 60 ? "Medium" : "Low";
  return (
    <div className="space-y-4">
      {header}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="High Risk Patients" value={highRisk.length} sub="This shift" tone={highRisk.length ? "text-rose-600" : undefined} />
        <Kpi label="Deterioration (PEWS≥6)" value={deterioration} sub="Elevated risk" tone={deterioration ? "text-rose-600" : undefined} />
        <Kpi label="Handover Quality" value={quality != null ? `${quality}%` : "—"} sub={quality != null ? "From JBI audits" : "No audits yet"} />
        <Kpi label="Missing Info" value={missing.length} sub="Detected" tone={missing.length ? "text-amber-600" : undefined} />
        <Kpi label="Open Actions" value={overdue} sub="Overdue" tone={overdue ? "text-rose-600" : undefined} />
        <Kpi label="AI Confidence" value={confLabel} sub={`${confidence}% data`} tone={confLabel === "High" ? "text-emerald-600" : confLabel === "Medium" ? "text-amber-600" : "text-rose-600"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Top Risks to Monitor</h3>
          {highRisk.length === 0 ? <p className="text-sm text-gray-400">No high-risk patients flagged.</p> : <div className="space-y-2">{highRisk.slice(0, 6).map((r: any) => (<div key={r.patientId} className="flex items-start gap-2"><span className="text-rose-500 mt-0.5">🔺</span><div className="flex-1 min-w-0"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-gray-800 truncate">{r.bed ? `Bed ${r.bed} · ` : ""}{r.label}</span><span className={`text-[10px] px-1.5 py-0.5 rounded ${RISK_BADGE[r.risk]}`}>PEWS {r.pews ?? "—"}</span></div><p className="text-[11px] text-gray-500">{r.escalations} escalation(s), {r.alerts} alert(s), {r.openTasks} task(s).</p></div></div>))}</div>}
        </div>
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">AI Generated Shift Summary</h3>
          <p className="text-xs text-gray-600 mb-3">{rows.length} patients in scope. {highRisk.length} high-risk requiring close monitoring. {d.escalations.length} active escalation(s), {overdue} overdue task(s). {quality != null ? `Handover quality ${quality}% (JBI).` : "No JBI audits recorded yet."} Confidence {confLabel} ({confidence}% of patients have current observations).</p>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[["Patients", rows.length], ["High Risk", highRisk.length], ["Escalations", d.escalations.length], ["Overdue", overdue]].map(([l, v]) => (<div key={l as string} className="rounded-lg border border-gray-100 p-2 text-center"><p className="text-[10px] text-gray-500">{l}</p><p className="text-lg font-bold text-gray-900">{v as number}</p></div>))}
          </div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">AI Recommendations</p>
          <ol className="space-y-1">{recs.map((r, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-emerald-600 font-bold">{i + 1}</span>{r}</li>)}</ol>
        </div>
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Missing Information Detected</h3>
        {missing.length === 0 ? <p className="text-sm text-gray-400">No information gaps detected. ✅</p> : <div className="space-y-1.5">{missing.slice(0, 8).map((m: any, i: number) => (<div key={i} className="flex items-center gap-2 text-xs"><span className="text-amber-500">⚠</span><span className="text-gray-700 font-medium">{m.bed ? `Bed ${m.bed} · ` : ""}{m.label}</span><span className="text-gray-500 flex-1">{m.gap}</span></div>))}</div>}
      </div>
      <p className="text-[11px] text-gray-400 pb-4">The AI Handover Assistant (SSW-HC-009) is rule-based and explainable — every insight is derived directly from live operational fields (PEWS, acuity, escalations, alerts, tasks), with confidence reflecting real data completeness. No demographics, diagnoses or predictions are fabricated; probabilistic ML deterioration modelling is a next-phase gap. AI insights are decision support only and do not replace clinical judgement. <Link href="/supervisor/handover" className="text-emerald-700 hover:underline">← Handover Centre</Link></p>
    </div>
  );
}
