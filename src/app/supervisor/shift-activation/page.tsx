import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadShiftActivation } from "@/lib/operations/shift-activation";
import { ConfirmAttendance, ActivateButton } from "./ActivationActions";

export const dynamic = "force-dynamic";

// Shift Planning & Activation Centre (SSW-SPA-001) — the Shift Supervisor's operational
// orchestration hub. Consumes live data from the authoritative modules (roster, attendance,
// census/acuity, competency, tasks, escalations) and validates a 12-item readiness checklist
// before activation. It owns no operational data — every value links to a single source.
// Activation (op_shifts planned → active) is gated on mandatory readiness.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const cap = (s: string) => (s ? s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "");
const STEPS = ["Review roster", "Confirm attendance", "Review census & acuity", "Validate demand", "Approve allocation", "Activate shift"];

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function ShiftActivationCentre() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadShiftActivation(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));

  const header = (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2"><span className="text-xl">🚀</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Shift Planning &amp; Activation Centre</h1><p className="text-sm text-gray-500">Prepare, validate and activate the shift — one guided workflow, single-source data.</p></div></div>
      {d.ready && <span className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${d.phase === "activated" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{d.phase === "activated" ? "● Shift active" : "○ Planning"}</span>}
    </div>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No operational data</p><p className="text-sm text-amber-800 mt-1">The activation centre orchestrates a running/planned shift with patients + staff.</p></div></div>;

  const k = d.kpis;
  const stepIdx = d.phase === "activated" ? 5 : k.attendancePct != null && k.attendancePct >= 90 ? 3 : k.confirmed ? 1 : 0;
  return (
    <div className="space-y-4">
      {header}

      {/* Workflow */}
      <div className={`${card} p-4`}>
        <div className="flex items-center gap-2 flex-wrap">{STEPS.map((s, i) => (<div key={s} className="flex items-center gap-2"><span className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center ${i <= stepIdx ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-400"}`}>{i + 1}</span><span className={`text-xs ${i <= stepIdx ? "text-gray-800 font-medium" : "text-gray-400"}`}>{s}</span>{i < STEPS.length - 1 && <span className="text-gray-300">→</span>}</div>))}</div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Expected staff" value={k.expected} sub="Rostered" />
        <Kpi label="Attendance confirmed" value={`${k.confirmed}/${k.expected}`} sub={k.attendancePct != null ? `${k.attendancePct}%` : ""} tone={k.attendancePct != null && k.attendancePct >= 90 ? "text-emerald-600" : "text-amber-600"} />
        <Kpi label="Patients" value={k.totalPatients} sub={`${k.highAcuity} high acuity`} />
        <Kpi label="Avg acuity" value={k.avgAcuity ?? "—"} sub="1–4 scale" tone={k.avgAcuity != null && k.avgAcuity >= 3 ? "text-rose-600" : undefined} />
        <Kpi label="Demand" value={k.requiredFte != null ? `${k.requiredFte} FTE` : "—"} sub={k.coverage != null ? `${k.coverage}% covered` : ""} />
        <Kpi label="Readiness" value={`${k.readinessPct}%`} sub={d.mandatoryDone ? "Mandatory met" : "Incomplete"} tone={d.mandatoryDone ? "text-emerald-600" : "text-amber-600"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Readiness checklist */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Shift readiness checklist</h3>
          <div className="space-y-1.5">{d.checklist.map((c: any) => (
            <div key={c.label} className="flex items-center gap-2.5 text-xs">
              <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${c.ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{c.ok ? "✓" : "!"}</span>
              <span className="text-gray-700 flex-1">{c.label}{c.mandatory && <span className="text-[9px] text-rose-400 ml-1">mandatory</span>}</span>
              <span className="text-gray-400">{c.detail}</span>
              <span className="text-[9px] text-gray-300 w-24 text-right">{c.source}</span>
            </div>
          ))}</div>
          <div className="mt-4 pt-3 border-t border-gray-100"><ActivateButton shiftId={d.shift?.id ?? null} ready={d.mandatoryDone} phase={d.phase} /></div>
          <p className="text-[10px] text-gray-400 mt-2">Activation is blocked until all mandatory checks pass; it transitions the shift to active and the Shift Dashboard becomes the default workspace. All overrides are audit-logged.</p>
        </div>

        {/* Risk register */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Risk register</h3>
          {d.risks.length === 0 ? <p className="text-sm text-gray-400">No unresolved risks. 🎉</p> : <div className="space-y-2">{d.risks.map((r: any, i: number) => (<div key={i} className="flex items-start gap-2"><span className="text-sm shrink-0">{r.sev === "High" ? "🔴" : "🟠"}</span><div className="flex-1 min-w-0"><p className="text-xs font-semibold text-gray-800 truncate">{r.label}</p><p className="text-[10px] text-gray-400">{r.type}</p></div></div>))}</div>}
          <Link href="/supervisor/operations?section=safety" className="text-[11px] text-emerald-700 hover:underline mt-3 inline-block">Escalation Centre →</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Attendance confirmation */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Attendance confirmation <span className="text-[10px] text-gray-400 font-normal">expected team · source: Workforce Ops</span></h3>
          {d.roster.length === 0 ? <p className="text-sm text-gray-400">No staff rostered to this shift.</p> : (
            <div className="overflow-x-auto max-h-[320px] overflow-y-auto"><table className="w-full text-xs">
              <thead className="sticky top-0 bg-white"><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Staff</th><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 font-medium">Confirm</th></tr></thead>
              <tbody>{d.roster.map((s: any) => (<tr key={s.id} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-800 font-medium">{s.name}</td><td className="py-2 pr-3 text-gray-600">{cap(s.role)}</td><td className="py-2 pr-3"><span className={`text-[10px] px-1.5 py-0.5 rounded ${s.status === "absent" ? "bg-rose-50 text-rose-700" : ["on_duty", "confirmed"].includes(s.status) ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>{cap(s.status)}</span></td><td className="py-2"><ConfirmAttendance staffId={s.id} status={s.status} /></td></tr>))}</tbody>
            </table></div>
          )}
        </div>

        {/* Data ownership / published roster */}
        <div className="space-y-4 xl:col-span-1">
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-2">Published roster</h3>
            {!d.rosterProvisioned ? <p className="text-[11px] text-gray-400">Roster store not provisioned (migration 080).</p> : !d.publishedRoster ? <p className="text-[11px] text-gray-400">No roster generated for this week. <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine →</Link></p> : <div className="text-xs text-gray-600"><p><b>{d.publishedRoster.slots_filled}/{d.publishedRoster.slots_total}</b> posts · {d.publishedRoster.coverage_score}% cover</p><p className="text-[10px] text-gray-400">Owned by WSE-001B — read-only here.</p></div>}
          </div>
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-2">Data ownership</h3>
            <p className="text-[10px] text-gray-400 mb-2">The centre orchestrates — it owns no data. Each element has one authoritative source.</p>
            <div className="space-y-0.5 text-[10px]">{[["Roster", "WSE-001B"], ["Attendance", "Workforce Ops"], ["Census / acuity", "Patient Ops"], ["Competency", "Competency Platform"], ["Tasks", "Task Centre"], ["Escalations", "Quality & Safety"]].map(([e, s]) => (<div key={e} className="flex items-center justify-between"><span className="text-gray-600">{e}</span><span className="text-gray-400">{s}</span></div>))}</div>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Shift Planning &amp; Activation Centre (SSW-SPA-001) is the operational orchestration hub of the Shift Supervisor Workspace — outgoing supervisors prepare the next shift, incoming supervisors validate and activate it, and no operational information is entered twice. It consumes live data from authoritative modules (published roster from <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">WSE-001B</Link>, attendance, census/acuity, competency, tasks, escalations), validates a 12-item readiness checklist, and gates activation on the mandatory items. Before activation it&apos;s the landing page; after, the <Link href="/supervisor/shift-operations" className="text-emerald-700 hover:underline">Shift Dashboard</Link> takes over. The activation snapshot, attendance snapshot and full audit trail persist through the shift lifecycle (the operational-engine snapshot stores are in <Link href="/supervisor/shift-operations" className="text-emerald-700 hover:underline">Shift Operations</Link>); a dedicated SPA snapshot record is a next-phase addition. <Link href="/supervisor/handover" className="text-emerald-700 hover:underline">← Handover Centre</Link></p>
    </div>
  );
}
