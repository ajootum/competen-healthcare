import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadShiftIntelligence, loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitCommandTabs from "../UnitCommandTabs";
import UnitFilters from "../UnitFilters";

export const dynamic = "force-dynamic";

// Shift Intelligence (UMW-003 §2) — compare performance across shifts and
// supervisors from persisted shift_metrics (SSW-002 §19). Health-score trend,
// supervisor performance and recurring-risk detection are all derived from real
// captured metrics; handover-quality has no backing store and shows as an honest
// state.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const scoreTone = (n: number | null) => n == null ? "text-gray-400" : n >= 85 ? "text-green-600" : n >= 70 ? "text-amber-600" : "text-rose-600";
const scoreBg = (n: number | null) => n == null ? "bg-gray-50 text-gray-400" : n >= 85 ? "bg-green-50 text-green-700" : n >= 70 ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700";

// Compact multi-series line chart (scores 0–100).
function TrendChart({ trend }: { trend: { type: string; series: { date: string; score: number }[] }[] }) {
  const W = 320, H = 120, pad = 6;
  const colors: Record<string, string> = { day: "#f59e0b", evening: "#22c55e", night: "#3b82f6" };
  const maxLen = Math.max(1, ...trend.map(t => t.series.length));
  const x = (i: number) => pad + (maxLen === 1 ? W / 2 : (i / (maxLen - 1)) * (W - 2 * pad));
  const y = (s: number) => H - pad - (s / 100) * (H - 2 * pad);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32">
      {[0, 25, 50, 75, 100].map(g => <line key={g} x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="#f1f5f9" strokeWidth="1" />)}
      {trend.map(t => t.series.length ? (
        <polyline key={t.type} fill="none" stroke={colors[t.type]} strokeWidth="2" strokeLinejoin="round"
          points={t.series.map((p, i) => `${x(i)},${y(p.score)}`).join(" ")} />
      ) : null)}
    </svg>
  );
}

export default async function ShiftIntelligence({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const dept = typeof sp.dept === "string" ? sp.dept : undefined;
  const period = typeof sp.period === "string" ? sp.period : undefined;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const isSuper = roles.includes("super_admin");
  const [d, departments] = await Promise.all([
    loadShiftIntelligence(admin, profile?.hospital_id ?? null, isSuper, { dept, period }),
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);
  const recent = d.shifts.slice(0, 7);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Unit Command</h1><p className="text-sm text-gray-500">Compare shifts and monitor performance trends.</p></div>
        <UnitFilters departments={departments} showPeriod />
      </div>
      <UnitCommandTabs />

      {!d.provisioned ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <p className="font-semibold text-amber-900">⚙️ Shift metrics not provisioned</p>
          <p className="text-sm text-amber-800 mt-1">The <code>shift_metrics</code> table (migration 068) isn&apos;t available yet, so cross-shift intelligence can&apos;t render.</p>
        </div>
      ) : d.shifts.length === 0 ? (
        <div className={`${card} p-6`}>
          <p className="font-semibold text-gray-900">No shift metrics captured yet</p>
          <p className="text-sm text-gray-500 mt-1">Shift Intelligence trends appear once supervisors capture shift metrics at closure (Shift Operations Engine). No data is fabricated in the meantime.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2"><span className="w-5 h-5 rounded bg-teal-600 text-white text-[11px] font-bold flex items-center justify-center">2</span><h2 className="text-sm font-bold text-gray-900">Shift Intelligence</h2><span className="text-[11px] text-gray-400">Across {d.shifts.length} captured shifts</span></div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Shift overview */}
            <div className={`${card} p-5`}>
              <h3 className="text-sm font-bold text-gray-900 mb-3">Shift Overview <span className="text-[10px] text-gray-400 font-normal">(most recent {recent.length})</span></h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-gray-400 text-left"><th className="py-1 pr-2 font-medium">Date</th><th className="py-1 pr-2 font-medium">Shift</th><th className="py-1 pr-2 font-medium">Supervisor</th><th className="py-1 pr-2 font-medium">Health</th><th className="py-1 pr-2 font-medium">Esc</th><th className="py-1 pr-2 font-medium">Inc</th><th className="py-1 font-medium">Handover</th></tr></thead>
                  <tbody>
                    {recent.map((s: any, i: number) => (
                      <tr key={i} className="border-t border-gray-50">
                        <td className="py-1.5 pr-2 text-gray-600">{s.date?.slice(5)}</td>
                        <td className="py-1.5 pr-2 capitalize text-gray-600">{s.shift_type?.replace(/_/g, " ")}</td>
                        <td className="py-1.5 pr-2 text-gray-700 truncate max-w-[110px]">{s.supervisor}</td>
                        <td className="py-1.5 pr-2"><span className={`px-1.5 py-0.5 rounded font-semibold ${scoreBg(s.health)}`}>{s.health != null ? `${s.health}%` : "—"}</span></td>
                        <td className="py-1.5 pr-2 tabular-nums text-gray-700">{s.escalations}</td>
                        <td className="py-1.5 pr-2 tabular-nums text-gray-700">{s.incidents}</td>
                        <td className="py-1.5 text-gray-300">—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-gray-400 mt-2">Handover quality has no captured store yet (op_handovers is unwritten) — shown as an honest state.</p>
            </div>

            {/* Trend */}
            <div className={`${card} p-5`}>
              <h3 className="text-sm font-bold text-gray-900 mb-2">Shift Health Score Trend</h3>
              <TrendChart trend={d.trend} />
              <div className="flex gap-3 text-[10px] mt-1">
                <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-amber-500" />Day</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-green-500" />Evening</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-blue-500" />Night</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Top issues */}
            <div className={`${card} p-5`}>
              <h3 className="text-sm font-bold text-gray-900 mb-3">Top Issues Across Shifts</h3>
              {d.topIssues.length === 0 ? <p className="text-sm text-gray-400">No recurring operational risks detected in the captured window.</p> : (
                <div className="space-y-2">
                  {d.topIssues.map((t: any) => (
                    <div key={t.rank} className="flex items-start gap-2.5"><span className="w-5 h-5 rounded-full bg-rose-100 text-rose-700 text-[11px] font-bold flex items-center justify-center shrink-0">{t.rank}</span><div><p className="text-xs font-semibold text-gray-800">{t.title}</p><p className="text-[10px] text-gray-500">{t.sub}</p></div></div>
                  ))}
                </div>
              )}
            </div>

            {/* Supervisor performance */}
            <div className={`${card} p-5`}>
              <h3 className="text-sm font-bold text-gray-900 mb-3">Supervisor Performance</h3>
              {d.supervisors.length === 0 ? <p className="text-sm text-gray-400">No supervisor-attributed shifts captured.</p> : (
                <table className="w-full text-xs">
                  <thead><tr className="text-gray-400 text-left"><th className="py-1 pr-2 font-medium">Supervisor</th><th className="py-1 pr-2 font-medium">Shifts</th><th className="py-1 pr-2 font-medium">Avg Health</th><th className="py-1 font-medium">Avg Esc</th></tr></thead>
                  <tbody>
                    {d.supervisors.map((s: any, i: number) => (
                      <tr key={i} className="border-t border-gray-50">
                        <td className="py-1.5 pr-2 text-gray-700 truncate max-w-[130px]">{s.name}</td>
                        <td className="py-1.5 pr-2 tabular-nums text-gray-600">{s.shifts}</td>
                        <td className={`py-1.5 pr-2 font-semibold tabular-nums ${scoreTone(s.avgHealth)}`}>{s.avgHealth != null ? `${s.avgHealth}%` : "—"}</td>
                        <td className="py-1.5 tabular-nums text-gray-600">{s.avgEscalations}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <p className="text-[11px] text-gray-400 pb-4">Shift Intelligence (UMW-003 §2) benchmarks shifts and supervisors from the persisted shift_metrics captured at shift closure — health-score trend, supervisor performance and recurring-risk detection are all live. Handover-quality scoring has no store yet and is shown as an honest state. <Link href="/unit-manager/action-centre" className="text-teal-700 hover:underline">Executive Action Centre →</Link></p>
        </>
      )}
    </div>
  );
}
