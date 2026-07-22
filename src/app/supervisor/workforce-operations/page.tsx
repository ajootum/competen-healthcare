import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceOps } from "@/lib/operations/workforce-ops";

export const dynamic = "force-dynamic";

// Workforce Operations Engine (SSW-004) — the Shift Supervisor's real-time staffing,
// rostering & deployment surface: KPI strip, per-role staffing overview, skill-mix
// compliance, competency gaps, staff assignment board, workload & coverage, quick
// staff summary and staffing alerts. Every figure is live from op_*/competency
// data. Shift clocking (late arrivals, overtime), break scheduling, redeployment
// history, absence reasons and per-day trend have no store and are honest states.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const tc = (s: string) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());
const covTone = (n: number | null) => (n == null ? "text-gray-300" : n >= 90 ? "text-green-600" : n >= 75 ? "text-amber-600" : "text-rose-600");
const ROLE_TONE: Record<string, string> = { charge: "bg-violet-50 text-violet-700", nurse: "bg-green-50 text-green-700", support: "bg-teal-50 text-teal-700", float: "bg-blue-50 text-blue-700", doctor: "bg-rose-50 text-rose-700", educator: "bg-amber-50 text-amber-700", assessor: "bg-amber-50 text-amber-700", therapist: "bg-sky-50 text-sky-700" };
const STATUS_LABEL: Record<string, string> = { on_duty: "Present", confirmed: "Confirmed", assigned: "Assigned", off_duty: "Off duty", absent: "Absent" };
const STATUS_TONE: Record<string, string> = { on_duty: "text-green-600", confirmed: "text-green-600", assigned: "text-gray-600", off_duty: "text-gray-400", absent: "text-rose-600" };
const OVR_TONE: Record<string, string> = { Good: "bg-green-50 text-green-700", "At Risk": "bg-amber-50 text-amber-700", "Below Required": "bg-rose-50 text-rose-700", "—": "bg-gray-100 text-gray-500" };
const WL_TONE: Record<string, string> = { High: "bg-rose-500", Medium: "bg-amber-500", Low: "bg-green-500", "—": "bg-gray-300" };
const ALERT_TONE: Record<string, string> = { critical: "bg-rose-50 text-rose-700 border-rose-100", high: "bg-orange-50 text-orange-700 border-orange-100", medium: "bg-amber-50 text-amber-700 border-amber-100" };

export default async function WorkforceOperations() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const d = await loadWorkforceOps(admin, hid, isSuper);
  if (!d.ready) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Workforce Operations</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-1">Workforce Operations activates once the Clinical Operations Engine is provisioned (shifts, staffing and rostering).</p></div>
      </div>
    );
  }

  const k = d.kpis, sm = d.skillMix, ot = d.overviewTotal, qs = d.quickSummary;
  const kpiTiles = [
    ["Planned Staff", k.planned, "Includes supervisor", ""],
    ["Confirmed", k.confirmed, `${k.confirmedPct ?? "—"}% confirmed`, ""],
    ["Present", k.present, `${k.presentPct ?? "—"}% of planned`, ""],
    ["Absent", k.absent, "Requires cover", k.absent ? "text-rose-600" : ""],
    ["Late", k.late ?? "—", "Needs clocking", "text-gray-400"],
    ["Staffing Variance", k.variance > 0 ? `+${k.variance}` : k.variance, k.variance < 0 ? "Below required" : "At/above required", k.variance < 0 ? "text-rose-600" : "text-green-600"],
    ["Critical Gaps", k.criticalGaps, "Roles below min", k.criticalGaps ? "text-rose-600" : ""],
    ["Overdue Breaks", k.overdueBreaks ?? "—", "Needs break store", "text-gray-400"],
  ];

  const smSeg = [["#22c55e", sm.compliant], ["#f59e0b", sm.minor], ["#ef4444", sm.major]] as [string, number][];
  const smDonut = (() => { const tot = sm.total || 1; let acc = 0; const st: string[] = []; smSeg.forEach(([c, n]) => { const a = (acc / tot) * 360, b = ((acc + n) / tot) * 360; if (n) st.push(`${c} ${a}deg ${b}deg`); acc += n; }); return st.length ? `conic-gradient(${st.join(", ")})` : "conic-gradient(#e5e7eb 0deg 360deg)"; })();

  return (
    <div data-wide className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Workforce Operations</h1>
          <p className="text-sm text-gray-500">Real-time staffing and workforce coordination — staffing, rostering &amp; deployment</p>
        </div>
        {d.shift && (
          <div className="flex items-center gap-2 text-right">
            <div><p className="text-xs font-semibold text-gray-700">{d.shift.unit} · {tc(d.shift.shift_type)}</p><p className="text-[11px] text-gray-400">{d.overview.present}/{d.overview.rostered} on duty</p></div>
            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${d.shift.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{d.shift.status}</span>
          </div>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        {kpiTiles.map(([l, v, sub, tone]: any) => (
          <div key={l} className={`${card} p-3`}>
            <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide leading-tight">{l}</p>
            <p className={`text-xl font-bold mt-1 tabular-nums ${tone || "text-gray-900"}`}>{v}</p>
            <p className="text-[10px] text-gray-400 truncate">{sub}</p>
          </div>
        ))}
      </div>

      {/* Staffing Overview · Skill Mix + Competency Gaps · Supervisor + Quick Summary */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className={`${card} p-5 xl:col-span-2`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Staffing Overview <span className="text-gray-400 font-normal">· by role</span></h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[520px]">
              <thead><tr className="text-[10px] uppercase text-gray-400 text-left border-b border-gray-100">
                {["Role", "Planned", "Confirmed", "Present", "Assigned", "Variance", "Coverage", "Status"].map(h => <th key={h} className="py-1.5 px-1 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody>
                {d.staffingOverview.map((r: any) => (
                  <tr key={r.role} className="border-b border-gray-50">
                    <td className="py-1.5 px-1 text-gray-800 font-medium">{r.label}</td>
                    <td className="py-1.5 px-1 tabular-nums text-gray-600">{r.planned}</td>
                    <td className="py-1.5 px-1 tabular-nums text-gray-600">{r.confirmed}</td>
                    <td className="py-1.5 px-1 tabular-nums text-gray-600">{r.present}</td>
                    <td className="py-1.5 px-1 tabular-nums text-gray-600">{r.assigned}</td>
                    <td className={`py-1.5 px-1 tabular-nums font-medium ${r.variance == null ? "text-gray-400" : r.variance < 0 ? "text-rose-600" : "text-green-600"}`}>{r.variance == null ? "—" : r.variance > 0 ? `+${r.variance}` : r.variance}</td>
                    <td className="py-1.5 px-1"><div className="flex items-center gap-1"><div className="h-1.5 w-12 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${r.coverage == null ? "bg-gray-200" : r.coverage >= 100 ? "bg-green-500" : r.coverage >= 75 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${Math.min(100, r.coverage ?? 0)}%` }} /></div><span className="tabular-nums text-gray-500">{r.coverage == null ? "—" : `${r.coverage}%`}</span></div></td>
                    <td className="py-1.5 px-1"><span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${OVR_TONE[r.status]}`}>{r.status}</span></td>
                  </tr>
                ))}
                <tr className="border-t border-gray-200 font-semibold">
                  <td className="py-1.5 px-1 text-gray-900">Total</td>
                  <td className="py-1.5 px-1 tabular-nums">{ot.planned}</td><td className="py-1.5 px-1 tabular-nums">{ot.confirmed}</td>
                  <td className="py-1.5 px-1 tabular-nums">{ot.present}</td><td className="py-1.5 px-1 tabular-nums">{ot.assigned}</td>
                  <td className={`py-1.5 px-1 tabular-nums ${ot.variance < 0 ? "text-rose-600" : "text-green-600"}`}>{ot.variance > 0 ? `+${ot.variance}` : ot.variance}</td>
                  <td className="py-1.5 px-1 tabular-nums">{ot.coverage == null ? "—" : `${ot.coverage}%`}</td>
                  <td className="py-1.5 px-1"><span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${ot.variance < 0 ? "bg-rose-50 text-rose-700" : "bg-green-50 text-green-700"}`}>{ot.variance < 0 ? "Below Required" : "Good"}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Skill Mix Compliance</h2>
          <div className="flex items-center gap-3">
            <div className="relative w-20 h-20 shrink-0 rounded-full" style={{ background: smDonut }}>
              <div className="absolute inset-[9px] bg-white rounded-full flex flex-col items-center justify-center"><span className={`text-base font-bold leading-none ${covTone(sm.pct)}`}>{sm.pct == null ? "—" : `${sm.pct}%`}</span><span className="text-[7px] text-gray-400">compliant</span></div>
            </div>
            <div className="text-[11px] space-y-1 flex-1">
              {[["Compliant", sm.compliant, "#22c55e"], ["Minor Gaps", sm.minor, "#f59e0b"], ["Major Gaps", sm.major, "#ef4444"]].map(([l, n, c]: any) => (
                <div key={l} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c }} /><span className="text-gray-600 flex-1">{l}</span><span className="font-semibold text-gray-800 tabular-nums">{n}</span></div>
              ))}
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Competency Gaps</p>
            {d.competencyGaps.length === 0 ? <p className="text-xs text-gray-400">No role shortfalls.</p> : (
              <div className="space-y-1">
                {d.competencyGaps.map((g: any) => (
                  <div key={g.label} className="flex items-center justify-between text-xs"><span className="text-gray-600 truncate">{g.label}</span><span className="text-[10px] font-bold text-rose-600 bg-rose-50 rounded-full w-5 h-5 flex items-center justify-center">{g.count}</span></div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-gray-400 mt-2">Named-competency requirements (Critical Care, ACLS) need the requirement config.</p>
          </div>
        </div>

        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-2">Shift Supervisor</h2>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-9 h-9 rounded-full bg-amber-400 flex items-center justify-center text-amber-900 font-bold text-sm">{(d.supervisor.name ?? "S").slice(0, 1)}</span>
            <div className="min-w-0"><p className="text-sm font-semibold text-gray-900 truncate">{d.supervisor.name ?? "Unassigned"}</p><p className="text-[10px] text-gray-500">Shift Supervisor · check-in not clocked</p></div>
          </div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Quick Staff Summary</p>
          <div className="space-y-1 text-xs">
            {[["Requiring assignment", qs.requiringAssignment], ["Unassigned to patient", qs.unassigned], ["On break now", qs.onBreakNow], ["On break due", qs.onBreakDue], ["Redeployed (float)", qs.redeployed], ["In transit", qs.inTransit]].map(([l, n]: any) => (
              <div key={l} className="flex items-center justify-between"><span className="text-gray-600">{l}</span><span className={`font-semibold tabular-nums ${n == null ? "text-gray-300" : "text-gray-900"}`}>{n == null ? "—" : n}</span></div>
            ))}
          </div>
        </div>
      </div>

      {/* Staff Assignment Board · Workload & Coverage */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5 xl:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-900">Staff Assignment Board</h2>
            <Link href="/supervisor/operations?section=assignments" className="text-[11px] text-teal-700 hover:underline">Assign →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[620px]">
              <thead><tr className="text-[10px] uppercase text-gray-400 text-left border-b border-gray-100">
                {["Staff Member", "Role", "Status", "Assignment", "Patients", "Workload", "Break"].map(h => <th key={h} className="py-1.5 px-1 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody>
                {d.assignmentBoard.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-gray-400">No staff rostered on the active shift.</td></tr>}
                {d.assignmentBoard.map((s: any) => (
                  <tr key={s.id} className="border-b border-gray-50">
                    <td className="py-1.5 px-1"><div className="flex items-center gap-1.5"><span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[9px] font-bold text-gray-600 shrink-0">{(s.name ?? "?").slice(0, 1)}</span><span className="text-gray-800 font-medium truncate">{s.name}</span>{s.competencyOk === false && <span className="text-rose-500" title="Outside validated competency">⚠</span>}</div></td>
                    <td className="py-1.5 px-1"><span className={`text-[9px] px-1.5 py-0.5 rounded ${ROLE_TONE[s.role] ?? "bg-gray-100 text-gray-600"}`}>{tc(s.role)}</span></td>
                    <td className={`py-1.5 px-1 font-medium ${STATUS_TONE[s.status] ?? "text-gray-600"}`}>{STATUS_LABEL[s.status] ?? tc(s.status)}</td>
                    <td className="py-1.5 px-1 text-gray-600 truncate max-w-[120px]">{s.assignment}</td>
                    <td className="py-1.5 px-1 tabular-nums text-gray-700">{s.patients}{s.highAcuity > 0 && <span className="text-[9px] text-rose-500"> ({s.highAcuity} high)</span>}</td>
                    <td className="py-1.5 px-1"><div className="flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${WL_TONE[s.workloadLevel]}`} /><span className="text-gray-500">{s.workloadLevel}</span></div></td>
                    <td className="py-1.5 px-1 text-gray-300">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Break clocking &amp; check-in times need a shift-clocking store.</p>
        </div>

        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Workload &amp; Coverage</h2>
          {d.workloadCoverage.length === 0 ? <p className="text-xs text-gray-400 py-4 text-center">No patient assignments yet.</p> : (
            <div className="space-y-2">
              <div className="flex items-center text-[10px] uppercase text-gray-400 font-semibold"><span className="flex-1">Staff</span><span className="w-10 text-right">Pts</span><span className="w-10 text-right">High</span><span className="w-16 text-right">Load</span></div>
              {d.workloadCoverage.map((s: any, i: number) => (
                <div key={i} className="flex items-center text-xs">
                  <span className="text-gray-700 flex-1 truncate">{s.name}</span>
                  <span className="w-10 text-right tabular-nums text-gray-600">{s.total}</span>
                  <span className="w-10 text-right tabular-nums text-gray-600">{s.high}</span>
                  <span className="w-16 flex items-center gap-1 justify-end"><div className="h-1.5 w-8 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${s.pct >= 80 ? "bg-rose-500" : s.pct >= 60 ? "bg-amber-500" : "bg-green-500"}`} style={{ width: `${Math.min(100, s.pct)}%` }} /></div><span className="tabular-nums text-gray-500">{s.pct}%</span></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Staffing Alerts · Handover & Redeployment · Absence & Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Staffing Alerts</h2>
          <div className="space-y-1.5">
            {d.staffingAlerts.length === 0 ? <p className="text-xs text-gray-400">No staffing alerts — the shift is balanced.</p> : d.staffingAlerts.slice(0, 6).map((a: any, i: number) => (
              <div key={i} className={`flex items-start gap-2 text-xs rounded-lg border px-2 py-1.5 ${ALERT_TONE[a.sev] ?? "bg-gray-50 border-gray-100"}`}>
                <span className="font-bold uppercase text-[9px] mt-0.5">{a.sev}</span><span className="flex-1">{a.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Handover &amp; Redeployment</h2>
          <div className="flex items-center gap-3 mb-3">
            <div className="relative w-16 h-16 shrink-0 rounded-full" style={{ background: `conic-gradient(#14b8a6 0deg ${(d.handoverStatus.pct ?? 0) * 3.6}deg, #e5e7eb ${(d.handoverStatus.pct ?? 0) * 3.6}deg 360deg)` }}>
              <div className="absolute inset-[7px] bg-white rounded-full flex items-center justify-center"><span className="text-sm font-bold text-gray-900">{d.handoverStatus.pct ?? 0}%</span></div>
            </div>
            <div><p className="text-xs font-medium text-gray-800">Staffing handover</p><p className="text-[10px] text-gray-400 capitalize">{tc(d.handoverStatus.status)}</p></div>
          </div>
          <div className="flex items-center justify-between text-xs pt-2 border-t border-gray-100">
            <span className="text-gray-600">Redeployed (float pool)</span><span className="font-semibold text-gray-900 tabular-nums">{qs.redeployed}</span>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Active-redeployment routing &amp; break scheduling need a redeployment/break store.</p>
        </div>

        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Absence &amp; Trend</h2>
          <div className="flex items-baseline gap-2 mb-2"><span className="text-3xl font-bold text-gray-900 tabular-nums">{d.absence.total}</span><span className="text-xs text-gray-500">absent this shift</span></div>
          <p className="text-[11px] text-gray-400">Absence reasons (sick / annual / no-show) and the 7-day staffing trend need an absence-reason store and per-day history — shown as honest states rather than fabricated.</p>
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
            <span className="text-gray-600">Shift score</span><span className={`font-bold ${covTone(d.intelligence.shiftScore)}`}>{d.intelligence.shiftScore == null ? "—" : `${d.intelligence.shiftScore}%`}</span>
          </div>
        </div>
      </div>

      {/* AI Workforce Assistant */}
      <div className={`${card} p-4`}>
        <div className="flex items-center gap-2 mb-2"><span className="text-base">✨</span><h2 className="text-sm font-bold text-gray-900">AI Workforce Assistant</h2><span className="text-[10px] text-gray-400">rule-based · live shift signals</span></div>
        {d.copilot.length === 0 ? <p className="text-xs text-gray-400">No workforce actions surfaced — the shift looks balanced.</p> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {d.copilot.map((c: any, i: number) => (
              <Link key={i} href={c.href} className="flex items-start gap-2 rounded-lg border border-gray-100 p-2.5 hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
                <span className="text-sm shrink-0">💡</span><div className="min-w-0"><p className="text-xs text-gray-700 leading-tight">{c.text}</p><p className="text-[10px] font-semibold text-teal-700 mt-0.5">{c.action} →</p></div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Workforce Operations manages today's workforce: planned/confirmed/present staff and per-role coverage against the mandatory ratios, skill-mix compliance, competency gaps, the live assignment board, workload &amp; coverage per staff, and derived staffing alerts — all live from the Clinical Operations Engine and competency records. Shift clocking (late arrivals, overtime, check-in), break scheduling &amp; clocking, active-redeployment routing, absence reasons and per-day trend need dedicated workforce stores and are shown as honest states rather than fabricated.</p>
    </div>
  );
}
