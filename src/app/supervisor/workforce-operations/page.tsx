import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceOps } from "@/lib/operations/workforce-ops";
import BreakBoard from "./BreakBoard";
import SupervisorNotesPanel from "./SupervisorNotesPanel";

export const dynamic = "force-dynamic";

// Workforce Operations command centre (SSW-WFO-001 redesign) — staffing,
// deployment, competency, wellbeing and shift documentation in five modules:
// Staff Allocation, Team Assignments, Competency Readiness, Break Management
// (live board, migration 069) and Supervisor Notes (persisted journal, 069).
// Every figure is live from op_*/competency data; shift clocking (late/overtime),
// time-block coverage history and absence reasons have no store (honest states).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const tc = (s: string) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());
const covTone = (n: number | null) => (n == null ? "text-gray-300" : n >= 90 ? "text-green-600" : n >= 75 ? "text-amber-600" : "text-rose-600");
const OVR_TONE: Record<string, string> = { Good: "bg-green-50 text-green-700", "At Risk": "bg-amber-50 text-amber-700", "Below Required": "bg-rose-50 text-rose-700", "—": "bg-gray-100 text-gray-500" };
const ACU_TONE: Record<string, string> = { critical: "text-rose-600", high: "text-orange-600", moderate: "text-amber-600", stable: "text-green-600", low: "text-green-600" };

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
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-1">Workforce Operations activates once the Clinical Operations Engine is provisioned.</p></div>
      </div>
    );
  }

  const k = d.wfoKpis, sm = d.skillMix, ot = d.overviewTotal, w = d.wardOverview;
  const kpiTiles = [
    ["Planned Staff", k.planned, "Includes supervisor", ""],
    ["Present Now", k.present, `${k.presentPct ?? "—"}% of planned`, ""],
    ["Assigned", k.assigned, `${k.assignedPct ?? "—"}% of present`, ""],
    ["Open Shifts", k.openShifts, "Require coverage", k.openShifts ? "text-amber-600" : ""],
    ["Staffing Variance", k.variancePct == null ? "—" : `${k.variancePct > 0 ? "+" : ""}${k.variancePct}%`, k.variancePct != null && k.variancePct < 0 ? "Below required" : "At/above required", k.variancePct != null && k.variancePct < 0 ? "text-rose-600" : "text-green-600"],
    ["Overdue Breaks", k.overdueBreaks ?? "—", k.overdueBreaks == null ? "Needs migration 069" : "Require attention", k.overdueBreaks ? "text-rose-600" : "text-gray-400"],
    ["Critical Gaps", k.criticalGaps, "Competency gap", k.criticalGaps ? "text-rose-600" : ""],
  ];

  const smSeg = [["#22c55e", sm.compliant], ["#f59e0b", sm.minor], ["#ef4444", sm.major]] as [string, number][];
  const smDonut = (() => { const tot = sm.total || 1; let acc = 0; const st: string[] = []; smSeg.forEach(([c, n]) => { const a = (acc / tot) * 360, b = ((acc + n) / tot) * 360; if (n) st.push(`${c} ${a}deg ${b}deg`); acc += n; }); return st.length ? `conic-gradient(${st.join(", ")})` : "conic-gradient(#e5e7eb 0deg 360deg)"; })();

  // AI recommendations (composed from live signals + copilot)
  const aiRecs: { text: string; sub: string; href: string; tone: string }[] = [];
  if (d.floatPool.some((f: any) => f.status === "Available") && d.openShiftCount > 0) aiRecs.push({ text: "Reassign from float pool", sub: `${d.openShiftCount} open position${d.openShiftCount > 1 ? "s" : ""} need coverage`, href: "/supervisor/operations?section=assignments", tone: "blue" });
  if (k.overdueBreaks && k.overdueBreaks > 0) aiRecs.push({ text: `${k.overdueBreaks} overdue break${k.overdueBreaks > 1 ? "s" : ""} need attention`, sub: "Risk of fatigue & non-compliance", href: "#break", tone: "orange" });
  d.competencyGaps.slice(0, 1).forEach((g: any) => aiRecs.push({ text: `Competency gap: ${g.label}`, sub: `${g.count} role shortfall in this shift`, href: "#competency", tone: "green" }));
  d.copilot.slice(0, 2).forEach((c: any) => aiRecs.push({ text: c.text, sub: c.action, href: c.href, tone: "teal" }));

  return (
    <div data-wide className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Workforce Operations</h1>
          <p className="text-sm text-gray-500">Real-time workforce management, deployment &amp; coordination</p>
        </div>
        {d.shift && (
          <div className="flex items-center gap-2">
            <div className="text-right"><p className="text-xs font-semibold text-gray-700">{d.shift.unit} · {tc(d.shift.shift_type)}</p><p className="text-[11px] text-gray-400">{d.overview.present}/{d.overview.rostered} on duty</p></div>
            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${d.shift.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{d.shift.status === "active" ? "Live" : d.shift.status}</span>
          </div>
        )}
      </div>

      {/* KPI strip (7) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
        {kpiTiles.map(([l, v, sub, tone]: any) => (
          <div key={l} className={`${card} p-3`}><p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide leading-tight">{l}</p><p className={`text-xl font-bold mt-1 tabular-nums ${tone || "text-gray-900"}`}>{v}</p><p className="text-[10px] text-gray-400 truncate">{sub}</p></div>
        ))}
      </div>

      {/* Staffing Snapshot · Skill Mix · AI Copilot */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className={`${card} p-5 xl:col-span-2`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Staffing Snapshot <span className="text-gray-400 font-normal">· by role</span></h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[460px]">
              <thead><tr className="text-[10px] uppercase text-gray-400 text-left border-b border-gray-100">{["Role", "Planned", "Present", "Assigned", "Variance", "Coverage", "Status"].map(h => <th key={h} className="py-1.5 px-1 font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {d.staffingOverview.map((r: any) => (
                  <tr key={r.role} className="border-b border-gray-50">
                    <td className="py-1.5 px-1 text-gray-800 font-medium">{r.label}</td>
                    <td className="py-1.5 px-1 tabular-nums text-gray-600">{r.planned}</td>
                    <td className="py-1.5 px-1 tabular-nums text-gray-600">{r.present}</td>
                    <td className="py-1.5 px-1 tabular-nums text-gray-600">{r.assigned}</td>
                    <td className={`py-1.5 px-1 tabular-nums font-medium ${r.variance == null ? "text-gray-400" : r.variance < 0 ? "text-rose-600" : "text-green-600"}`}>{r.variance == null ? "—" : r.variance > 0 ? `+${r.variance}` : r.variance}</td>
                    <td className="py-1.5 px-1 tabular-nums text-gray-600">{r.coverage == null ? "—" : `${r.coverage}%`}</td>
                    <td className="py-1.5 px-1"><span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${OVR_TONE[r.status]}`}>{r.status}</span></td>
                  </tr>
                ))}
                <tr className="border-t border-gray-200 font-semibold">
                  <td className="py-1.5 px-1 text-gray-900">TOTAL</td><td className="py-1.5 px-1 tabular-nums">{ot.planned}</td><td className="py-1.5 px-1 tabular-nums">{ot.present}</td><td className="py-1.5 px-1 tabular-nums">{ot.assigned}</td>
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
            <div className="relative w-20 h-20 shrink-0 rounded-full" style={{ background: smDonut }}><div className="absolute inset-[9px] bg-white rounded-full flex flex-col items-center justify-center"><span className={`text-base font-bold ${covTone(sm.pct)}`}>{sm.pct == null ? "—" : `${sm.pct}%`}</span><span className="text-[7px] text-gray-400">compliant</span></div></div>
            <div className="text-[11px] space-y-1 flex-1">{[["Compliant", sm.compliant, "#22c55e"], ["Minor Gaps", sm.minor, "#f59e0b"], ["Major Gaps", sm.major, "#ef4444"]].map(([l, n, c]: any) => (<div key={l} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c }} /><span className="text-gray-600 flex-1">{l}</span><span className="font-semibold text-gray-800 tabular-nums">{n}</span></div>))}</div>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Top Competency Gaps</p>
            {d.competencyGaps.length === 0 ? <p className="text-xs text-gray-400">No role shortfalls.</p> : d.competencyGaps.slice(0, 3).map((g: any) => (<div key={g.label} className="flex items-center justify-between text-xs"><span className="text-gray-600 truncate">{g.label}</span><span className="text-[10px] font-bold text-rose-600 bg-rose-50 rounded-full w-5 h-5 flex items-center justify-center">{g.count}</span></div>))}
          </div>
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center gap-1.5 mb-3"><span className="w-5 h-5 rounded bg-violet-100 text-violet-700 flex items-center justify-center text-[10px] font-bold">AI</span><h2 className="text-sm font-bold text-gray-900">Copilot Recommendations</h2></div>
          <div className="space-y-2">
            {aiRecs.length === 0 ? <p className="text-sm text-gray-400">No recommendations — the shift looks balanced.</p> : aiRecs.slice(0, 4).map((r, i) => (
              <Link key={i} href={r.href} className="block rounded-lg border border-gray-100 hover:border-violet-200 hover:bg-violet-50/30 p-2.5">
                <p className="text-xs font-medium text-gray-800 leading-tight">{r.text}</p>
                <p className="text-[10px] text-gray-400">{r.sub}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Modules 1–3: Staff Allocation · Team Assignments · Competency Readiness */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-3"><span className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold">1</span><div><h2 className="text-sm font-bold text-gray-900 leading-tight">Staff Allocation</h2><p className="text-[10px] text-gray-500">Live staffing, attendance &amp; deployment</p></div></div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[["Present", d.overview.present, "text-gray-900"], ["Coverage", ot.coverage == null ? "—" : `${ot.coverage}%`, covTone(ot.coverage)], ["Open", d.openShiftCount, d.openShiftCount ? "text-amber-600" : "text-gray-900"]].map(([l, v, tone]: any) => (<div key={l} className="rounded-lg border border-gray-100 p-2 text-center"><p className={`text-lg font-bold tabular-nums ${tone}`}>{v}</p><p className="text-[9px] text-gray-500">{l}</p></div>))}
          </div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Float Pool</p>
          <div className="space-y-1 mb-3">
            {d.floatPool.length === 0 ? <p className="text-xs text-gray-400">No float staff on shift.</p> : d.floatPool.map((f: any, i: number) => (<div key={i} className="flex items-center gap-2 text-xs"><span className="text-gray-700 flex-1 truncate">{f.name}</span><span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${f.status === "Available" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{f.status}</span></div>))}
          </div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Open Shifts</p>
          <div className="space-y-1">
            {d.openShifts.length === 0 ? <p className="text-xs text-gray-400">All positions covered.</p> : d.openShifts.map((o: any, i: number) => (<div key={i} className="flex items-center gap-2 text-xs"><span className="text-gray-700 flex-1 truncate">{o.role}</span><span className="tabular-nums text-gray-500">{o.positions} pos.</span><span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${o.urgency === "Urgent" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{o.urgency}</span></div>))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Time-block coverage curve &amp; attendance clocking need a shift-clocking store.</p>
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-3"><span className="w-7 h-7 rounded-lg bg-green-100 text-green-700 flex items-center justify-center text-sm font-bold">2</span><div><h2 className="text-sm font-bold text-gray-900 leading-tight">Team Assignments</h2><p className="text-[10px] text-gray-500">Patient allocation &amp; workload balancing</p></div></div>
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            {[["Patients", w.patients], ["Teams", w.teams], ["Acuity", w.avgAcuity], ["Unassigned", w.unassigned]].map(([l, v]: any) => (<div key={l} className="rounded-lg border border-gray-100 p-1.5 text-center"><p className={`text-base font-bold tabular-nums ${l === "Unassigned" && (v as number) > 0 ? "text-rose-600" : l === "Acuity" ? ACU_TONE[String(v).toLowerCase()] ?? "text-gray-900" : "text-gray-900"}`}>{v}</p><p className="text-[8px] text-gray-500">{l}</p></div>))}
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {d.teams.length === 0 ? <p className="text-xs text-gray-400 py-3 text-center">No nurse-patient teams yet.</p> : d.teams.map((t: any) => (
              <div key={t.id} className="rounded-lg border border-gray-100 p-2">
                <div className="flex items-center gap-2 mb-1"><span className="text-xs font-semibold text-gray-800 truncate flex-1">{t.name}</span><span className="text-[10px] text-gray-400">{t.count} pt{t.count === 1 ? "" : "s"}{t.high > 0 ? ` · ${t.high} high` : ""}</span></div>
                <div className="flex flex-wrap gap-1 mb-1">{t.patients.map((p: any, i: number) => (<span key={i} className={`text-[9px] px-1 py-0.5 rounded bg-gray-50 border border-gray-100 ${ACU_TONE[p.acuity] ?? "text-gray-600"}`}>{p.bed ?? p.label}</span>))}</div>
                <div className="h-1 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${t.workloadPct >= 80 ? "bg-rose-500" : t.workloadPct >= 60 ? "bg-amber-500" : "bg-green-500"}`} style={{ width: `${Math.min(100, t.workloadPct)}%` }} /></div>
              </div>
            ))}
          </div>
        </div>

        <div className={`${card} p-5`} id="competency">
          <div className="flex items-center gap-2 mb-3"><span className="w-7 h-7 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center text-sm font-bold">3</span><div><h2 className="text-sm font-bold text-gray-900 leading-tight">Competency Readiness</h2><p className="text-[10px] text-gray-500">Skill mix, compliance &amp; competency gaps</p></div></div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[["Validated", d.compliance.coverage == null ? "—" : `${d.compliance.coverage}%`, covTone(d.compliance.coverage)], ["Expiring", d.compliance.expiring, d.compliance.expiring > 0 ? "text-amber-600" : "text-gray-900"], ["Supervise", d.compliance.needsSupervision, d.compliance.needsSupervision > 0 ? "text-amber-600" : "text-gray-900"]].map(([l, v, tone]: any) => (<div key={l} className="rounded-lg border border-gray-100 p-2 text-center"><p className={`text-base font-bold tabular-nums ${tone}`}>{v}</p><p className="text-[9px] text-gray-500">{l}</p></div>))}
          </div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Coverage by role</p>
          <div className="space-y-1.5">
            {d.staffingOverview.map((r: any) => (
              <div key={r.role}>
                <div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600 truncate">{r.label}</span><span className={`tabular-nums ${r.coverage == null ? "text-gray-400" : covTone(r.coverage)}`}>{r.present}/{r.required ?? "—"}</span></div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${r.coverage == null ? "bg-gray-200" : r.coverage >= 100 ? "bg-green-500" : r.coverage >= 75 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${Math.min(100, r.coverage ?? 0)}%` }} /></div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Named-certification tracking (ACLS, PALS) links to the Competency Passport.</p>
        </div>
      </div>

      {/* Modules 4–5: Break Management · Supervisor Notes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" id="break">
        <BreakBoard shiftId={d.shiftId} data={d.breaks} staff={d.staffPicker} editable={d.shift?.status !== "completed"} />
        <SupervisorNotesPanel shiftId={d.shiftId} data={d.notes} editable={d.shift?.status !== "completed"} />
      </div>

      {/* Underlying engine */}
      <div className={`${card} p-4`}>
        <div className="flex items-center gap-2 mb-2"><span className="text-base">⚙️</span><h2 className="text-sm font-bold text-gray-900">Workforce Operations Engine</h2><span className="text-[10px] text-gray-400">continuously calculates staffing adequacy, workload balance, competency coverage &amp; fatigue risk</span></div>
        <div className="flex flex-wrap gap-2">
          {["Staffing Intelligence", "Workload Balancing", "Competency Engine", "Fatigue Monitoring", "Redeployment Suggestions", "AI Recommendations"].map(e => (<span key={e} className="text-[11px] text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1">{e}</span>))}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Workforce Operations is the supervisor's workforce command centre (SSW-WFO-001) — staffing snapshot &amp; coverage, skill-mix compliance, competency gaps, live team assignments &amp; workload, a fully operational break board (schedule/start/end, compliance) and a persisted supervisor journal, all live from op_*/competency data. Shift clocking (late arrivals, overtime), time-block coverage history, drag-and-drop allocation and absence reasons need dedicated stores and are shown as honest states or click-based equivalents rather than fabricated.</p>
    </div>
  );
}
