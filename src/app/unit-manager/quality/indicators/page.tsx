import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadClinicalIndicators } from "@/lib/operations/clinical-indicators";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import QualityTabs from "../QualityTabs";
import { qcard, QHeader, Kpi, Rag, NextPhase, CrossLink } from "../widgets";

export const dynamic = "force-dynamic";

// Clinical Indicators (UMG-QS-008) — clinical-quality indicators (quality_indicators + indicator_measurements,
// migration 019) scoped via the hospital's quality_objects. Real: KPIs, the indicator register with each
// indicator's latest value, target, direction-aware RAG status and a recent-value trend. Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */
const fmt = (v: number | null, unit: string) => { if (v == null) return "—"; if (unit === "percent") return `${v}%`; if (unit === "rate_per_1000") return `${v}/1k`; if (unit === "minutes") return `${v}m`; if (unit === "days") return `${v}d`; return `${v}`; };
const ragTone = (s: string): "green" | "amber" | "red" | "gray" => (s === "green" ? "green" : s === "amber" ? "amber" : s === "red" ? "red" : "gray");
const ragLabel: Record<string, string> = { green: "On target", amber: "Watch", red: "Escalation", gray: "No data" };

// Inline sparkline (RAG-tinted).
function Spark({ series, color }: { series: number[]; color: string }) {
  if (!series || series.length < 2) return <span className="text-[10px] text-gray-300">—</span>;
  const max = Math.max(...series), min = Math.min(...series), rng = max - min || 1;
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * 100},${20 - ((v - min) / rng) * 18}`).join(" ");
  return <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="w-16 h-5"><polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}

export default async function ClinicalIndicators() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const [d, departments] = await Promise.all([
    loadClinicalIndicators(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <QHeader code="UMG-QS-008" title="Clinical Indicators" subtitle="Clinical-quality indicators, targets and RAG performance" />
        <UnitFilters departments={departments} />
      </div>
      <QualityTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Quality indicators not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 019 (quality_indicators / indicator_measurements) to enable clinical indicators.</p></div></div>;

  const k = d.kpis;
  const sparkColor: Record<string, string> = { green: "#10b981", amber: "#f59e0b", red: "#ef4444", gray: "#cbd5e1" };

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon="📈" tint="bg-indigo-50" label="Active Indicators" value={k.total} sub={`${k.measured} measured`} />
        <Kpi icon="🟢" tint="bg-emerald-50" label="On Target" value={k.onTarget} tone={k.onTarget ? "text-emerald-600" : "text-gray-400"} sub="meeting target" />
        <Kpi icon="🟡" tint="bg-amber-50" label="Watch" value={k.warning} tone={k.warning ? "text-amber-600" : "text-gray-400"} sub="below target" />
        <Kpi icon="🔴" tint="bg-rose-50" label="At Escalation" value={k.atEscalation} tone={k.atEscalation ? "text-rose-600" : "text-gray-400"} sub="breached threshold" />
        <Kpi icon="⚪" tint="bg-gray-50" label="No Data" value={k.noData} tone="text-gray-400" sub="awaiting measurement" />
        <Kpi icon="✅" tint="bg-sky-50" label="Coverage" value={k.total ? `${Math.round((k.measured / k.total) * 100)}%` : "—"} sub="with a measurement" />
      </div>

      <div className={`${qcard} p-5`}>
        <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Indicator Register</h3><CrossLink href="/quality-accreditation">Quality workspace</CrossLink></div>
        {d.indicators.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1.5 font-medium">Indicator</th><th className="py-1.5 font-medium">Object</th><th className="py-1.5 font-medium text-right">Latest</th><th className="py-1.5 font-medium text-right">Target</th><th className="py-1.5 font-medium">Trend</th><th className="py-1.5 font-medium">Status</th><th className="py-1.5 font-medium text-right">Period</th></tr></thead>
              <tbody>{d.indicators.map((i: any, idx: number) => (
                <tr key={idx} className="border-b border-gray-50">
                  <td className="py-2 text-gray-700 max-w-[200px] truncate" title={i.name}>{i.name}{i.code && <span className="ml-1 text-[9px] text-gray-400">{i.code}</span>}</td>
                  <td className="py-2 text-gray-500 max-w-[120px] truncate">{i.object ?? "—"}</td>
                  <td className="py-2 text-right tabular-nums font-semibold text-gray-800">{fmt(i.value, i.unit)}</td>
                  <td className="py-2 text-right tabular-nums text-gray-500">{fmt(i.target, i.unit)}</td>
                  <td className="py-2"><Spark series={i.trend} color={sparkColor[i.status]} /></td>
                  <td className="py-2"><Rag tone={ragTone(i.status)} label={ragLabel[i.status]} /></td>
                  <td className="py-2 text-right text-gray-400 tabular-nums">{i.period ?? "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="text-sm text-gray-400 py-8 text-center">No active indicators defined for this hospital&apos;s quality objects yet.</p>}
      </div>

      <NextPhase>Clinical Indicators (UMG-QS-008) over quality_indicators / indicator_measurements (migration 019), scoped via the hospital&apos;s quality objects. Real: KPIs and the indicator register with each indicator&apos;s latest measured value, target, direction-aware RAG status (higher/lower-is-better against target and escalation thresholds) and a recent-value trend. Honest next-phase: measurement entry, indicator benchmarking against peer units and the drill-down to the numerator/denominator. Gate hospital_admin/super_admin.</NextPhase>
    </div>
  );
}
