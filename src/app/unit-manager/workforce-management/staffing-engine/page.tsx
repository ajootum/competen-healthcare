import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceOps } from "@/lib/operations/workforce-ops";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import StaffingEngine from "./StaffingEngine";

export const dynamic = "force-dynamic";

// Staffing Engine (UMW-WFM-001) — real-time staffing demand, availability, competency
// readiness and coverage. Overview: 6 KPIs, staffing requirements vs actual, an honest
// current-coverage heatmap (per-hour history isn't stored → next-phase), interactive
// staff availability + deployment (op_shift_staff via the audited shift-staff API),
// coverage by role, and live staffing alerts. Real over op_shift_staff /
// op_staffing_standards / op_staff_breaks; honest states where nothing is stored.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const NONE = "00000000-0000-0000-0000-000000000000";
const SUBTABS = ["Overview", "Requirements", "Real-time Coverage", "Staff Availability", "Skills & Competencies", "Scenarios", "History & Reports", "Settings"];
// Coverage colour tiers (mockup legend)
const cellColor = (p: number | null) => p == null ? "bg-gray-50 text-gray-400" : p >= 90 ? "bg-emerald-100 text-emerald-800" : p >= 70 ? "bg-lime-100 text-lime-800" : p >= 50 ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800";
const hhmm = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(11, 16) : null);

function Kpi({ label, value, sub, tone, icon }: { label: string; value: any; sub?: string; tone?: string; icon?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{icon && <span className="text-base opacity-40">{icon}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function StaffingEnginePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const presetRole = typeof sp.role === "string" ? sp.role : undefined;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const [w, departments] = await Promise.all([
    loadWorkforceOps(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper),
  ]);
  const shiftId: string | null = w.ready ? (w.shiftId ?? null) : null;

  // Live roster (row ids for mutation) + next-break + area + available staff
  let roster: any[] = []; let available: any[] = [];
  if (shiftId) {
    const [{ data: rs }, breaksRes, asgRes, staffRes] = await Promise.all([
      admin.from("op_shift_staff").select("id, staff_id, role, status, profiles!staff_id(full_name)").eq("shift_id", shiftId).limit(300),
      admin.from("op_staff_breaks").select("staff_id, scheduled_at, status").eq("shift_id", shiftId).in("status", ["scheduled", "on_break"]).order("scheduled_at").then((r: any) => r).catch(() => ({ data: [] })),
      admin.from("op_patient_assignments").select("staff_id, op_patients!patient_id(departments!department_id(name))").eq("status", "active").limit(500).then((r: any) => r).catch(() => ({ data: [] })),
      (isSuper ? admin.from("profiles").select("id, full_name, role").order("full_name").limit(200) : admin.from("profiles").select("id, full_name, role").eq("hospital_id", hid ?? NONE).order("full_name").limit(200)),
    ]);
    const nextBreak = new Map<string, string>();
    for (const b of breaksRes.data ?? []) if (b.staff_id && !nextBreak.has(b.staff_id) && b.scheduled_at) nextBreak.set(b.staff_id, hhmm(b.scheduled_at)!);
    const area = new Map<string, string>();
    for (const a of asgRes.data ?? []) { const nm = a.op_patients?.departments?.name; if (a.staff_id && nm && !area.has(a.staff_id)) area.set(a.staff_id, nm); }
    roster = (rs ?? []).map((r: any) => ({ id: r.id, staffId: r.staff_id, name: r.profiles?.full_name ?? "—", role: r.role, status: r.status, area: area.get(r.staff_id) ?? null, nextBreak: nextBreak.get(r.staff_id) ?? null })).sort((a: any, b: any) => a.name.localeCompare(b.name));
    const onShift = new Set(roster.map((r: any) => r.staffId));
    available = (staffRes.data ?? []).filter((s: any) => s.id && s.full_name && !onShift.has(s.id)).map((s: any) => ({ id: s.id, name: s.full_name, role: s.role ?? "" }));
  }

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🧑‍⚕️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Staffing Engine</h1><p className="text-sm text-gray-500">Monitor staffing requirements, availability and real-time coverage for your unit.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {SUBTABS.map((t, i) => <span key={t} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium ${i === 0 ? "border-emerald-600 text-emerald-700" : "border-transparent text-gray-300"}`} title={i === 0 ? "" : "Next phase"}>{t}</span>)}
      </div>
    </>
  );

  if (!w.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No active shift / operational data</p><p className="text-sm text-amber-800 mt-1">The Staffing Engine activates once an operational shift with staffing is running for this unit.</p></div></div>;

  const ov = w.overviewTotal;
  const rows = w.staffingOverview;
  const understaffed = rows.filter((r: any) => r.coverage != null && r.coverage < 100).length;
  const overtimeRisk = w.kpis.criticalGaps > 0 ? "High" : (ov.variance != null && ov.variance < 0) ? "Medium" : "Low";
  const breaksDue = w.breaks?.provisioned && !("error" in w.breaks) ? (w.breaks.due ?? 0) : null;
  const covPct = ov.coverage ?? null;
  const statusLabel = (r: any) => (r.coverage != null && r.coverage >= 100 ? "Adequate" : "Under-staffed");

  const alerts: { icon: string; title: string; sub: string; tone: string }[] = [];
  (w.openShifts ?? []).forEach((u: any) => alerts.push({ icon: "🧑‍⚕️", title: `${u.role} under-staffed`, sub: `${u.positions} open · ${u.urgency}`, tone: "rose" }));
  if (overtimeRisk !== "Low") alerts.push({ icon: "⏰", title: `${overtimeRisk} overtime risk predicted`, sub: "Coverage gaps this shift", tone: "amber" });
  if (breaksDue) alerts.push({ icon: "☕", title: `${breaksDue} break(s) due soon`, sub: "Within next 60 minutes", tone: "amber" });
  if (w.absence?.total) alerts.push({ icon: "🏖️", title: `${w.absence.total} staff on leave / absent`, sub: "Today", tone: "gray" });
  (w.competencyGaps ?? []).slice(0, 2).forEach((g: any) => alerts.push({ icon: "🎯", title: `Competency gap — ${g.label}`, sub: `${g.count} short`, tone: "amber" }));

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Overall coverage" value={covPct != null ? `${covPct}%` : "—"} sub={covPct != null ? (covPct >= 90 ? "Good" : covPct >= 75 ? "Fair" : "Low") : "n/a"} icon="📈" tone={covPct != null && covPct >= 90 ? "text-emerald-600" : covPct != null && covPct >= 75 ? "text-amber-600" : "text-rose-600"} />
        <Kpi label="Total staff on shift" value={`${ov.present}/${ov.planned}`} sub="Filled positions" icon="👥" />
        <Kpi label="Under-staffed roles" value={understaffed} sub="Require action" icon="🧑‍⚕️" tone={understaffed ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Overtime risk" value={overtimeRisk} sub="Derived from gaps" icon="⏰" tone={overtimeRisk === "High" ? "text-rose-600" : overtimeRisk === "Medium" ? "text-amber-600" : "text-emerald-600"} />
        <Kpi label="Breaks due" value={breaksDue ?? "—"} sub={breaksDue != null ? "Within 60 min" : "Run migration 069"} icon="☕" tone={breaksDue ? "text-amber-600" : undefined} />
        <Kpi label="Leave / absent" value={w.absence?.total ?? 0} sub="Today" icon="🏖️" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Requirements vs actual */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Staffing requirements vs actual</h3>
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium text-right">Req</th><th className="py-2 pr-3 font-medium text-right">Sched</th><th className="py-2 pr-3 font-medium text-right">On shift</th><th className="py-2 pr-3 font-medium text-right">Cover</th><th className="py-2 pr-3 font-medium text-right">Var</th><th className="py-2 font-medium text-right">Status</th></tr></thead>
            <tbody>{rows.map((r: any) => (<tr key={r.role} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-700">{r.label}</td><td className="py-2 pr-3 text-right text-gray-600">{r.required ?? "—"}</td><td className="py-2 pr-3 text-right text-gray-600">{r.planned}</td><td className="py-2 pr-3 text-right text-gray-600">{r.present}</td><td className="py-2 pr-3 text-right font-semibold">{r.coverage != null ? `${r.coverage}%` : "—"}</td><td className={`py-2 pr-3 text-right ${r.variance != null && r.variance < 0 ? "text-rose-600 font-semibold" : "text-gray-500"}`}>{r.variance ?? "—"}</td><td className="py-2 text-right"><span className={`text-[9px] px-1.5 py-0.5 rounded ${statusLabel(r) === "Adequate" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{statusLabel(r)}</span></td></tr>))}</tbody>
            <tfoot><tr className="border-t border-gray-200 font-bold"><td className="py-2 pr-3 text-gray-800">Total</td><td className="py-2 pr-3 text-right">{ov.required ?? "—"}</td><td className="py-2 pr-3 text-right">{ov.planned}</td><td className="py-2 pr-3 text-right">{ov.present}</td><td className="py-2 pr-3 text-right text-emerald-600">{covPct != null ? `${covPct}%` : "—"}</td><td className={`py-2 pr-3 text-right ${ov.variance != null && ov.variance < 0 ? "text-rose-600" : ""}`}>{ov.variance ?? "—"}</td><td className="py-2 text-right"><span className={`text-[9px] px-1.5 py-0.5 rounded ${covPct != null && covPct >= 85 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{covPct != null && covPct >= 85 ? "Good" : "Review"}</span></td></tr></tfoot>
          </table></div>
        </div>

        {/* Coverage heatmap (honest current snapshot) */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">Coverage by role</h3><span className="text-[10px] text-gray-400">Now · {new Date().toISOString().slice(11, 16)}</span></div>
          <div className="space-y-1.5">{rows.map((r: any) => (<div key={r.role} className="flex items-center gap-2"><span className="text-xs text-gray-600 w-32 truncate">{r.label}</span><div className={`flex-1 rounded px-2 py-1.5 text-center text-xs font-semibold ${cellColor(r.coverage)}`}>{r.coverage != null ? `${r.coverage}%` : "—"}</div><span className="text-[10px] text-gray-400 w-12 text-right">{r.present}/{r.required ?? "—"}</span></div>))}</div>
          <div className="flex items-center gap-3 mt-3 pt-2 border-t border-gray-100 text-[10px]"><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-200" />≥90 Excellent</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-lime-200" />70–89</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-200" />50–69</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-rose-200" />&lt;50</span></div>
          <p className="text-[10px] text-gray-400 mt-2">A 24-hour coverage-by-time heatmap needs per-hour staffing history (not captured yet) — showing the current snapshot instead.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Staff availability + deployment */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Staff availability <span className="text-[10px] text-gray-400 font-normal">(on shift)</span></h3>
          <StaffingEngine shiftId={shiftId} roster={roster} available={available} presetRole={presetRole} />
        </div>

        {/* Staffing alerts */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Staffing alerts</h3>
          {alerts.length === 0 ? <p className="text-sm text-gray-400">No staffing alerts. 🎉</p> : <div className="space-y-2">{alerts.slice(0, 6).map((a, i) => (<div key={i} className="flex items-start gap-2.5"><span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0 ${a.tone === "rose" ? "bg-rose-50" : a.tone === "amber" ? "bg-amber-50" : "bg-gray-50"}`}>{a.icon}</span><div><p className="text-xs font-semibold text-gray-800">{a.title}</p><p className="text-[11px] text-gray-500">{a.sub}</p></div></div>))}</div>}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Staffing Engine (UMW-WFM-001) compares required (op_staffing_standards) vs scheduled vs on-shift staffing by role, with live coverage, availability, breaks, absence and competency gaps. Staff deployment (deploy / status / stand-down) runs through the audited /api/operations/shift-staff route. Honest next-phase: the 24-hour coverage-by-time heatmap (no hourly history), competency-gated deployment, staffing scenarios, history/reports export and configurable thresholds. AI recommendations require manager approval. <Link href="/unit-manager/workforce-management" className="text-emerald-700 hover:underline">← Workforce Overview</Link></p>
    </div>
  );
}
