import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { workforceReport } from "@/lib/engines/workforce";

function heatColor(readiness: number): string {
  if (readiness >= 85) return "#16a34a";
  if (readiness >= 70) return "#84cc16";
  if (readiness >= 50) return "#eab308";
  if (readiness >= 30) return "#f97316";
  return "#ef4444";
}

export default async function IntelligencePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["hospital_admin", "super_admin"].includes(profile.role)) redirect("/dashboard");

  const report = await workforceReport(admin, profile.hospital_id ?? "");
  const heatDeptIds = Object.keys(report.heat);
  const heatFrameworks = report.frameworks.filter(f => heatDeptIds.some(d => report.heat[d]?.[f.id]));

  const RISK_CARDS = [
    { label: "Expired", value: report.risk.expired, color: "text-red-600", bg: "bg-red-50" },
    { label: "Due ≤60d", value: report.risk.dueSoon, color: "text-amber-600", bg: "bg-amber-50" },
    { label: "Critical Failures", value: report.risk.criticalFailures, color: "text-red-700", bg: "bg-red-50" },
    { label: "Remediation", value: report.risk.remediation, color: "text-orange-600", bg: "bg-orange-50" },
    { label: "Not Yet Competent", value: report.risk.notYetCompetent, color: "text-gray-600", bg: "bg-gray-50" },
  ];

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Workforce Intelligence</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Readiness heat map, risk indicators and department benchmarking from governed competency decisions (Book I Ch.14).
        </p>
      </div>

      {report.totalDecisions === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-3xl mb-3">📊</p>
          <p className="font-semibold text-gray-700">No decisions yet</p>
          <p className="text-gray-400 text-sm mt-2">Complete competency cycles to generate the decisions this dashboard is built from.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {/* Risk panel */}
          <div>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Workforce Risk</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {RISK_CARDS.map(c => (
                <div key={c.label} className={`${c.bg} rounded-xl px-4 py-3`}>
                  <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{c.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Heat map */}
          <div>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Readiness Heat Map — Department × Framework</h2>
            <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase sticky left-0 bg-white">Department</th>
                    {heatFrameworks.map(f => (
                      <th key={f.id} className="px-3 py-3 text-[10px] font-semibold text-gray-400 text-center min-w-[90px]">{f.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {heatDeptIds.map(deptId => {
                    const deptName = report.deptReadiness.find(d => d.id === deptId)?.name ?? deptId;
                    return (
                      <tr key={deptId}>
                        <td className="px-4 py-2.5 font-medium text-gray-800 text-xs sticky left-0 bg-white">{deptName}</td>
                        {heatFrameworks.map(f => {
                          const cell = report.heat[deptId]?.[f.id];
                          return (
                            <td key={f.id} className="px-3 py-2.5 text-center">
                              {cell ? (
                                <div className="inline-flex flex-col items-center">
                                  <span className="w-10 h-7 rounded flex items-center justify-center text-white text-[11px] font-bold"
                                    style={{ backgroundColor: heatColor(cell.readiness) }}>{cell.readiness}%</span>
                                  <span className="text-[9px] text-gray-400 mt-0.5">{cell.passing}/{cell.total}</span>
                                </div>
                              ) : <span className="text-gray-200">—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Reassessment forecast */}
          {(report.forecast.d30 + report.forecast.d60 + report.forecast.d90) > 0 && (
            <div>
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Reassessment Forecast — next 90 days</h2>
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="text-left px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Department</th>
                      <th className="text-center px-4 py-3 text-[10px] font-semibold text-amber-600 uppercase tracking-wide">≤ 30 days</th>
                      <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">31–60 days</th>
                      <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">61–90 days</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {report.forecast.byDept.map(d => (
                      <tr key={d.id} className="hover:bg-gray-50/40">
                        <td className="px-5 py-2.5 text-xs font-medium text-gray-800">{d.name}</td>
                        <td className={`px-4 py-2.5 text-center text-sm font-bold ${d.d30 > 0 ? "text-amber-600" : "text-gray-300"}`}>{d.d30 || "—"}</td>
                        <td className={`px-4 py-2.5 text-center text-sm ${d.d60 > 0 ? "text-gray-700" : "text-gray-300"}`}>{d.d60 || "—"}</td>
                        <td className={`px-4 py-2.5 text-center text-sm ${d.d90 > 0 ? "text-gray-700" : "text-gray-300"}`}>{d.d90 || "—"}</td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50/50 font-bold">
                      <td className="px-5 py-2.5 text-xs text-gray-800">Total reassessments due</td>
                      <td className="px-4 py-2.5 text-center text-sm text-amber-700">{report.forecast.d30}</td>
                      <td className="px-4 py-2.5 text-center text-sm text-gray-800">{report.forecast.d60}</td>
                      <td className="px-4 py-2.5 text-center text-sm text-gray-800">{report.forecast.d90}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-gray-400 mt-2">Use this to schedule assessor capacity ahead of demand — competencies expiring soonest need assessment slots first.</p>
            </div>
          )}

          {/* Department benchmark */}
          <div>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Department Benchmark</h2>
            <div className="bg-white rounded-xl border border-gray-100 p-5 flex flex-col gap-3">
              {report.deptReadiness.map(d => (
                <div key={d.id} className="flex items-center gap-3">
                  <div className="w-32 shrink-0">
                    <p className="text-sm text-gray-800 truncate">{d.name}</p>
                    <p className="text-[10px] text-gray-400">{d.workers} worker{d.workers !== 1 ? "s" : ""}</p>
                  </div>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${d.readiness}%`, backgroundColor: heatColor(d.readiness) }} />
                  </div>
                  <span className="w-10 text-right text-sm font-bold text-gray-700">{d.readiness}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
