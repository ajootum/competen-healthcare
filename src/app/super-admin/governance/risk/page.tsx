import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadRiskControls } from "@/lib/super-admin/gov-risk";
import RiskCenter from "./RiskCenter";

export const dynamic = "force-dynamic";

// Risk & Internal Controls (GOV-001.4) — the 5×5 enterprise risk register and
// controls library (migration 060), with real in-place register actions. The
// heat map, bands and top-risks list are computed from the actual register;
// honest banner until the migration runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const BAND_TONE: Record<string, string> = { low: "bg-green-50 text-green-700", medium: "bg-amber-50 text-amber-700", high: "bg-orange-50 text-orange-700", critical: "bg-rose-50 text-rose-700" };
const EFF_TONE: Record<string, string> = { effective: "bg-green-50 text-green-700", partially_effective: "bg-amber-50 text-amber-700", ineffective: "bg-rose-50 text-rose-700", not_tested: "bg-gray-100 text-gray-500" };
// Cell colour by inherent score band (likelihood × impact).
const cellTone = (score: number, n: number) => {
  if (n === 0) return "bg-gray-50 text-gray-300";
  if (score >= 16) return "bg-rose-500 text-white";
  if (score >= 10) return "bg-orange-400 text-white";
  if (score >= 5) return "bg-amber-300 text-gray-800";
  return "bg-green-400 text-white";
};

export default async function RiskInternalControls() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadRiskControls(admin);
  const k = d.kpis;

  const kpiCards = [
    { label: "Total Risks", value: dash(k.total), icon: "⚠️", iconBg: "bg-blue-50" },
    { label: "Critical", value: dash(k.critical), icon: "🔴", iconBg: "bg-rose-50", tone: (k.critical ?? 0) > 0 ? "text-rose-600" : undefined },
    { label: "High", value: dash(k.high), icon: "🟠", iconBg: "bg-orange-50", tone: (k.high ?? 0) > 0 ? "text-orange-600" : undefined },
    { label: "Medium", value: dash(k.medium), icon: "🟡", iconBg: "bg-amber-50" },
    { label: "Low", value: dash(k.low), icon: "🟢", iconBg: "bg-green-50" },
    { label: "Overdue Reviews", value: dash(k.overdueReviews), icon: "🕓", iconBg: "bg-gray-50", tone: (k.overdueReviews ?? 0) > 0 ? "text-amber-600" : undefined },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/governance" className="hover:text-teal-700">Governance &amp; Compliance</Link><span>/</span><span className="text-gray-600">Risk &amp; Internal Controls</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Risk &amp; Internal Controls</h1>
        <p className="text-sm text-gray-500">Enterprise risk register, 5×5 assessment, controls library and treatment tracking.</p>
      </div>

      {!d.ready && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Risk register not enabled.</span> Run <code className="font-mono text-[12px] bg-amber-100 px-1 rounded">supabase/migrations/060-governance-risk-controls.sql</code> to activate the register and controls library.
        </div>
      )}

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpiCards.map(c => (
          <div key={c.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</span>
              <span className={`w-7 h-7 rounded-lg ${c.iconBg} flex items-center justify-center text-sm shrink-0`}>{c.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${(c as any).tone ?? "text-gray-900"}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Real in-place ERM actions */}
      <RiskCenter risks={d.pickers.risks} controls={d.pickers.controls} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 5×5 heat map */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Risk Heat Map <span className="text-[10px] text-gray-400">{d.openCount} open risk{d.openCount === 1 ? "" : "s"}</span></h2>
          <div className="flex gap-1.5">
            <div className="flex flex-col justify-between py-0.5 pr-1">
              <span className="text-[8px] text-gray-400 -rotate-90 origin-center whitespace-nowrap h-full flex items-center">Impact →</span>
            </div>
            <div className="flex-1">
              {[5, 4, 3, 2, 1].map(impact => (
                <div key={impact} className="flex gap-1 mb-1">
                  {[1, 2, 3, 4, 5].map(likelihood => {
                    const n = d.heat[`${likelihood}-${impact}`] ?? 0;
                    return <div key={likelihood} className={`flex-1 aspect-square rounded flex items-center justify-center text-xs font-bold tabular-nums ${cellTone(likelihood * impact, n)}`}>{n || ""}</div>;
                  })}
                </div>
              ))}
              <div className="flex gap-1 mt-0.5">
                {[1, 2, 3, 4, 5].map(l => <span key={l} className="flex-1 text-center text-[8px] text-gray-400">{l}</span>)}
              </div>
              <p className="text-center text-[8px] text-gray-400 mt-0.5">Likelihood →</p>
            </div>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Open risks plotted at inherent likelihood × impact. 1–4 low · 5–9 medium · 10–15 high · 16–25 critical.</p>
        </div>

        {/* Top risks */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Top Risks <span className="text-[10px] text-gray-400">by residual (falls back to inherent)</span></h2>
            <span className="text-[10px] text-gray-400">{d.closedCount} closed</span>
          </div>
          {d.topRisks.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">{d.ready ? "No risks registered yet — add the first one above." : "Activates with migration 060."}</p> : (
            <div className="divide-y divide-gray-50">
              {d.topRisks.map((r: any) => (
                <div key={r.id} className="flex items-center gap-3 py-2.5">
                  <span className={`text-[11px] font-bold px-2 py-1 rounded shrink-0 tabular-nums ${BAND_TONE[r.band]}`}>{r.residual ?? r.inherent}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800 leading-tight truncate">{r.title}{r.overdue && <span className="text-[9px] font-semibold text-rose-600 ml-1.5">REVIEW OVERDUE</span>}</p>
                    <p className="text-[10px] text-gray-400 capitalize">{String(r.category).replace(/_/g, " ")} · {r.scope} · treat: {r.treatment}{r.residual != null ? ` · inherent ${r.inherent} → residual ${r.residual}` : ""}</p>
                  </div>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 capitalize ${r.status === "escalated" ? "bg-rose-50 text-rose-700" : r.status === "mitigating" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-600"}`}>{r.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Controls library */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Controls Library <span className="text-[10px] text-gray-400">{dash(d.controls.total)} controls · {d.controls.notTested} untested</span></h2>
          </div>
          {d.controls.list.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">{d.controlsReady ? "No controls yet — add the first one above." : "Activates with migration 060."}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="px-3 py-2 font-semibold">Control</th><th className="px-3 py-2 font-semibold">Type</th><th className="px-3 py-2 font-semibold">Frequency</th><th className="px-3 py-2 font-semibold">Linked risk</th><th className="px-3 py-2 font-semibold text-right">Last tested</th><th className="px-3 py-2 font-semibold text-right">Effectiveness</th>
                </tr></thead>
                <tbody>
                  {d.controls.list.map((ct: any) => (
                    <tr key={ct.id} className="border-b border-gray-50">
                      <td className="px-3 py-2 text-gray-800">{ct.name}</td>
                      <td className="px-3 py-2 text-gray-500 capitalize text-[12px]">{ct.type}</td>
                      <td className="px-3 py-2 text-gray-500 capitalize text-[12px]">{ct.frequency}</td>
                      <td className="px-3 py-2 text-gray-500 text-[12px] truncate max-w-[180px]">{ct.linkedRisk ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[12px] text-gray-500">{ct.lastTested ?? "—"}</td>
                      <td className="px-3 py-2 text-right"><span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${EFF_TONE[ct.effectiveness] ?? "bg-gray-100 text-gray-600"}`}>{String(ct.effectiveness).replace(/_/g, " ")}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Breakdown panels */}
        <div className="space-y-4">
          <div className={`${card} p-5`}>
            <h2 className="font-semibold text-gray-900 text-[15px] mb-3">By Category</h2>
            {d.byCategory.length === 0 ? <p className="text-xs text-gray-400">No open risks.</p> : (
              <div className="space-y-1.5">
                {d.byCategory.map((c: any) => (
                  <div key={c.category} className="flex items-center justify-between text-xs"><span className="text-gray-600 capitalize">{String(c.category).replace(/_/g, " ")}</span><span className="tabular-nums text-gray-500">{c.n}</span></div>
                ))}
              </div>
            )}
          </div>
          <div className={`${card} p-5`}>
            <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Treatment Mix</h2>
            {Object.keys(d.byTreatment).length === 0 ? <p className="text-xs text-gray-400">No open risks.</p> : (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(d.byTreatment).map(([t, n]: any) => <span key={t} className="text-[10px] text-gray-600 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">{t} · {n}</span>)}
              </div>
            )}
            <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">Risk appetite thresholds and control-testing workflows deepen in a later phase; escalated risks surface on the Governance Dashboard.</p>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Risk &amp; Internal Controls is the ERM module — a real 5×5 register (inherent = likelihood × impact; residual scored after treatment) and a controls library with effectiveness ratings from testing. The heat map, bands, top-risks and control effectiveness are all computed from the live register; every write is audit-logged and tenant scope is bound server-side. Platform risks registered here complement the derived operational indicators on the Governance Dashboard.</p>
    </div>
  );
}
