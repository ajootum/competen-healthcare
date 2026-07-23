import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceOps } from "@/lib/operations/workforce-ops";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import StaffEngineTabs from "../StaffEngineTabs";

export const dynamic = "force-dynamic";

// Real-Time Coverage (WSE-STAFF-001 §7) — the live operational command board. Continuously
// compares requirement with roster (planned), confirmed, present and deployable staff, then
// classifies each role as SAFE / WATCH / CRITICAL (§13.1 core coverage states). Real over
// op_staffing_standards + op_shift_staff via loadWorkforceOps. Coverage confidence reflects
// attendance-data completeness. The 15/30/60-min coverage timeline and live event feed need
// per-block attendance history → honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
// §13.1 status classification from the per-role coverage status
const STATE = (cov: number | null): "SAFE" | "WATCH" | "CRITICAL" | "UNKNOWN" => cov == null ? "UNKNOWN" : cov >= 100 ? "SAFE" : cov >= 75 ? "WATCH" : "CRITICAL";
const STATE_BADGE: Record<string, string> = { SAFE: "bg-emerald-50 text-emerald-700", WATCH: "bg-amber-50 text-amber-700", CRITICAL: "bg-rose-50 text-rose-700", UNKNOWN: "bg-gray-100 text-gray-500" };
const STATE_DOT: Record<string, string> = { SAFE: "bg-emerald-500", WATCH: "bg-amber-500", CRITICAL: "bg-rose-500", UNKNOWN: "bg-gray-300" };

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function RealTimeCoverage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [w, departments] = await Promise.all([
    loadWorkforceOps(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🧑‍⚕️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Staffing Engine · Real-Time Coverage</h1><p className="text-sm text-gray-500">Live operational command — required vs planned vs present vs deployable, by role.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <StaffEngineTabs />
    </>
  );

  if (!w.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No active shift</p><p className="text-sm text-amber-800 mt-1">Real-time coverage activates once an operational shift with staffing is running.</p></div></div>;

  const ov = w.overviewTotal;
  const rows = w.staffingOverview.map((r: any) => ({ ...r, state: STATE(r.coverage), gap: r.required != null ? Math.max(0, r.required - r.present) : 0 }));
  const netGap = rows.reduce((n: number, r: any) => n + r.gap, 0);
  const critical = rows.filter((r: any) => r.state === "CRITICAL").sort((a: any, b: any) => b.gap - a.gap);
  const watch = rows.filter((r: any) => r.state === "WATCH").length;
  const confidence = ov.planned ? Math.round((ov.present / ov.planned) * 100) : null; // attendance completeness proxy
  const skill = w.skillMix;

  return (
    <div className="space-y-4">
      {header}

      {/* Coverage headline (§13.1) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Required" value={ov.required ?? "—"} sub="Approved posts" />
        <Kpi label="Planned" value={ov.planned} sub="Rostered" />
        <Kpi label="Confirmed" value={ov.confirmed} sub="Acknowledged" />
        <Kpi label="Present" value={ov.present} sub="Attendance evidence" tone="text-emerald-600" />
        <Kpi label="Net gap" value={netGap} sub={netGap ? "Deployable shortfall" : "Covered"} tone={netGap ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Coverage" value={ov.coverage != null ? `${ov.coverage}%` : "—"} sub={netGap ? `${critical.length} critical` : "Safe"} tone={ov.coverage != null && ov.coverage >= 100 ? "text-emerald-600" : ov.coverage != null && ov.coverage >= 75 ? "text-amber-600" : "text-rose-600"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Role coverage table */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Role coverage <span className="text-[10px] text-gray-400 font-normal">SAFE / WATCH / CRITICAL by role</span></h3>
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium text-right">Req</th><th className="py-2 pr-3 font-medium text-right">Planned</th><th className="py-2 pr-3 font-medium text-right">Present</th><th className="py-2 pr-3 font-medium text-right">Gap</th><th className="py-2 pr-3 font-medium text-right">Coverage</th><th className="py-2 font-medium">Status</th></tr></thead>
            <tbody>{rows.map((r: any) => (<tr key={r.role} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-700">{r.label}</td><td className="py-2 pr-3 text-right text-gray-600">{r.required ?? "—"}</td><td className="py-2 pr-3 text-right text-gray-600">{r.planned}</td><td className="py-2 pr-3 text-right text-gray-600">{r.present}</td><td className={`py-2 pr-3 text-right ${r.gap ? "text-rose-600 font-semibold" : "text-gray-400"}`}>{r.gap}</td><td className="py-2 pr-3 text-right font-semibold">{r.coverage != null ? `${r.coverage}%` : "—"}</td><td className="py-2"><span className="inline-flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${STATE_DOT[r.state]}`} /><span className={`text-[9px] px-1.5 py-0.5 rounded ${STATE_BADGE[r.state]}`}>{r.state}</span></span></td></tr>))}</tbody>
            <tfoot><tr className="border-t border-gray-200 font-bold"><td className="py-2 pr-3 text-gray-800">Total</td><td className="py-2 pr-3 text-right">{ov.required ?? "—"}</td><td className="py-2 pr-3 text-right">{ov.planned}</td><td className="py-2 pr-3 text-right">{ov.present}</td><td className={`py-2 pr-3 text-right ${netGap ? "text-rose-600" : ""}`}>{netGap}</td><td className="py-2 pr-3 text-right text-emerald-600">{ov.coverage != null ? `${ov.coverage}%` : "—"}</td><td /></tr></tfoot>
          </table></div>
          <p className="text-[10px] text-gray-400 mt-2">Deployable ≈ present clinicians meeting checks; a 15/30/60-min coverage timeline needs per-block attendance history (honest next-phase). Gap never hidden by overstaffing in another role.</p>
        </div>

        {/* Critical gaps + confidence */}
        <div className="space-y-4 xl:col-span-1">
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-3">Critical gaps</h3>
            {critical.length === 0 ? <p className="text-sm text-gray-400">No critical gaps. 🎉{watch ? ` (${watch} on watch)` : ""}</p> : <div className="space-y-2">{critical.map((r: any) => (<div key={r.role} className="flex items-center justify-between rounded-lg border border-rose-100 bg-rose-50/40 p-2.5"><div><p className="text-xs font-semibold text-gray-800">{r.label}</p><p className="text-[11px] text-gray-500">{r.gap} short · {r.coverage}% covered</p></div><Link href="/unit-manager/workforce-management/staffing-engine/availability" className="text-[10px] font-semibold rounded-lg py-1.5 px-2.5 bg-rose-600 text-white">Find cover →</Link></div>))}</div>}
          </div>
          <div className={`${card} p-5`}>
            <h3 className="text-sm font-bold text-gray-900 mb-2">Coverage confidence</h3>
            <div className="flex items-center gap-3"><div className="relative w-16 h-16 shrink-0"><div className="w-16 h-16 rounded-full" style={{ background: confidence != null ? `conic-gradient(${confidence >= 85 ? "#10b981" : "#f59e0b"} ${confidence}%, #f1f5f9 0)` : "#f1f5f9" }} /><div className="absolute inset-[20%] rounded-full bg-white flex items-center justify-center text-xs font-bold">{confidence != null ? `${confidence}%` : "—"}</div></div><div className="text-[11px] text-gray-500"><p>Based on attendance-data completeness (present ÷ planned).</p><p className="text-[10px] text-gray-400 mt-1">Skill mix {skill?.pct != null ? `${skill.pct}%` : "—"} compliant.</p></div></div>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Real-Time Coverage (WSE-STAFF-001 §7 / §13.1) classifies each role as SAFE / WATCH / CRITICAL from required vs planned vs present, over live op_staffing_standards + op_shift_staff. Deployable staff, contact/redeployment workflows and the live event feed reuse the <Link href="/unit-manager/workforce-management/staffing-engine/availability" className="text-emerald-700 hover:underline">Staff Availability</Link> and <Link href="/supervisor/team-assignments" className="text-emerald-700 hover:underline">allocation</Link> surfaces; the 15/30/60-minute coverage timeline needs per-block attendance history (honest next-phase). Requirements come from <Link href="/unit-manager/workforce-management/establishment" className="text-emerald-700 hover:underline">Unit Workforce Planning</Link>; skill eligibility from <Link href="/unit-manager/scheduling-engine/competency-matching" className="text-emerald-700 hover:underline">Competency Matching</Link>. <Link href="/unit-manager/workforce-management/staffing-engine" className="text-emerald-700 hover:underline">← Overview</Link></p>
    </div>
  );
}
