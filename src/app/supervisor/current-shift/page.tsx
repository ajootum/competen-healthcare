import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadShiftCommand, fmtTime, titleCase } from "@/lib/operations/shift-command";

export const dynamic = "force-dynamic";

// Current Shift (Shift Command SS §1) — the live operational control room: shift
// overview, an interactive workforce board, the live patient operations board
// (SSW-005 groupings), real-time actions and the operational copilot. All on live
// op_* data; per-staff activity/break/fatigue are not instrumented in the schema
// and are shown as an honest note rather than fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";
const hm = (h: number | null) => h == null ? "—" : `${Math.max(0, Math.floor(h))}h ${Math.max(0, Math.round((h % 1) * 60))}m`;
const ROLE_FILTERS = ["charge", "nurse", "support", "float", "educator", "assessor"];
const GROUP_TONE: Record<string, string> = { "High Risk": "text-red-600", "PEWS Review": "text-orange-600", "Isolation": "text-purple-600", "Observation": "text-amber-600", "Discharge Ready": "text-teal-600", "Theatre": "text-indigo-600", "Stable": "text-green-600" };
const ewsColor = (n: number | null) => n == null ? "text-gray-400" : n >= 7 ? "text-red-600" : n >= 5 ? "text-orange-600" : n >= 3 ? "text-yellow-600" : "text-green-600";

export default async function CurrentShiftWorkspace() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const sc = await loadShiftCommand(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  if (!sc.ready) return (
    <div className="space-y-4"><h1 className="text-2xl font-bold text-gray-900">Current Shift</h1>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-2">The Clinical Operations Engine tables aren&apos;t provisioned yet (migrations 038 &amp; 039).</p></div>
    </div>
  );
  const { shift, overview, staffBoard, roleMix, patientBoard, groupCounts, patientGroups, copilot } = sc;
  const onDuty = !!shift && shift.status === "active";

  const overviewCells = [
    { label: "Staff on duty", value: `${overview.present} / ${overview.rostered}`, sub: "Present" },
    { label: "Bed occupancy", value: `${overview.occPct}%`, sub: `${overview.occupied} / ${overview.totalBeds}`, tone: overview.occPct >= 90 ? "text-red-600" : overview.occPct >= 75 ? "text-orange-600" : "text-green-600" },
    { label: "Critical patients", value: String(overview.critical), sub: "High risk", tone: overview.critical ? "text-red-600" : undefined },
    { label: "Admissions", value: String(overview.admissionsPending), sub: "Pending" },
    { label: "Discharges", value: String(overview.discharges), sub: "Planned" },
    { label: "Escalations", value: String(overview.escalations), sub: "Active", tone: overview.escalations ? "text-amber-600" : undefined },
    { label: "Open incidents", value: String(overview.incidents), sub: "Safety alerts", tone: overview.incidents ? "text-orange-600" : undefined },
    { label: "Handover", value: `${overview.handoverPct}%`, sub: titleCase(overview.handoverStatus), tone: overview.handoverPct === 100 ? "text-green-600" : "text-gray-500" },
  ];

  const actions = [
    { label: "Allocate nurse", icon: "👥", href: "/supervisor/operations?section=assignments" },
    { label: "Move patient", icon: "🔀", href: "/supervisor/operations?section=ward" },
    { label: "Request review", icon: "🔎", href: "/supervisor/operations?section=safety" },
    { label: "Escalate deterioration", icon: "🚨", href: "/supervisor/operations?section=safety", danger: true },
    { label: "Reassign workload", icon: "⚖️", href: "/supervisor/operations?section=assignments" },
    { label: "Open incident", icon: "⚠️", href: "/supervisor/operations?section=safety" },
    { label: "Initiate handover", icon: "🔄", href: "/supervisor/handover" },
  ];

  return (
    <div className="space-y-5">
      {/* Banner */}
      <div className="bg-white rounded-xl border border-gray-200 px-2 py-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
          {[
            { l: "Current Shift", v: shift ? `${titleCase(shift.shift_type)} Shift` : "No active shift", s: shift ? `${fmtTime(shift.starts_at)} – ${fmtTime(shift.ends_at)}` : "", tone: onDuty ? "text-green-600" : "text-gray-500" },
            { l: "Unit / Ward", v: shift?.unit ?? "—" },
            { l: "Current time", v: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) },
            { l: "Elapsed", v: hm(shift?.elapsedH ?? null) },
            { l: "Remaining", v: hm(shift?.remainingH ?? null) },
            { l: "Status", v: onDuty ? "In Progress" : titleCase(shift?.status ?? "—"), tone: onDuty ? "text-green-600" : "text-gray-500" },
          ].map((c, i) => (
            <div key={i} className="px-3 py-1.5">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{c.l}</p>
              <p className={`text-sm font-bold leading-tight mt-0.5 ${c.tone ?? "text-gray-900"}`}>{c.v}</p>
              {c.s && <p className="text-[11px] text-gray-400 leading-tight">{c.s}</p>}
            </div>
          ))}
        </div>
      </div>

      <div className="grid xl:grid-cols-3 gap-5">
        {/* Shift Overview */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">📋 Shift Overview</h3>
          <div className="grid grid-cols-2 gap-2.5">
            {overviewCells.map((c, i) => (
              <div key={i} className="rounded-lg border border-gray-100 px-3 py-2.5">
                <p className={`text-xl font-bold tabular-nums ${c.tone ?? "text-gray-900"}`}>{c.value}</p>
                <p className="text-[11px] text-gray-500 leading-tight">{c.label}</p>
                {c.sub && <p className="text-[10px] text-gray-400">{c.sub}</p>}
              </div>
            ))}
          </div>
        </div>

        {/* Live Workforce */}
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">🧑‍⚕️ Live Workforce</h3>
            <span className="text-xs text-gray-400">{staffBoard.length} rostered</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {ROLE_FILTERS.filter(r => (roleMix as any)[r]).map(r => (
              <span key={r} className="text-[11px] bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{titleCase(r)} {(roleMix as any)[r]}</span>
            ))}
          </div>
          <div className="space-y-2 max-h-[26rem] overflow-y-auto">
            {staffBoard.length === 0 && <p className="text-sm text-gray-400">No staff rostered on the active shift.</p>}
            {staffBoard.map((s: any) => (
              <div key={s.id} className="flex items-center gap-2.5 rounded-lg border border-gray-100 px-3 py-2">
                <div className="w-8 h-8 rounded-full bg-teal-500 text-white flex items-center justify-center text-xs font-bold shrink-0">{s.name[0]}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 truncate">{s.name} <span className="text-[10px] text-gray-400 uppercase">{titleCase(s.role)}</span></p>
                  <p className="text-[11px] text-gray-400 truncate">{s.patients} patient{s.patients !== 1 ? "s" : ""}{s.beds.length ? ` · ${s.beds.join(", ")}` : ""}</p>
                </div>
                <span className="shrink-0 flex items-center gap-1.5">
                  {s.status === "absent" ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">Absent</span>
                    : s.competencyOk === false ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">Competency</span>
                    : s.competencyOk ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">Validated</span>
                    : <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">On duty</span>}
                  <Link href="/supervisor/operations?section=assignments" className="text-[11px] text-teal-700 hover:underline">Manage</Link>
                </span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Live break, activity &amp; fatigue tracking arrive with the workforce-clocking module; assignments &amp; competency are live.</p>
        </div>

        {/* Live Patient Operations */}
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">🛏️ Live Patient Operations</h3>
            <span className="text-xs text-gray-400">{patientBoard.length} in care</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {patientGroups.filter(g => (groupCounts as any)[g]).map(g => (
              <span key={g} className={`text-[11px] rounded-full px-2 py-0.5 bg-gray-100 ${GROUP_TONE[g] ?? "text-gray-600"}`}>{g} {(groupCounts as any)[g]}</span>
            ))}
          </div>
          <div className="overflow-x-auto max-h-[26rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100 sticky top-0 bg-white">
                <th className="py-1.5 pr-2 font-medium">Bed</th><th className="py-1.5 px-1 font-medium">Patient</th><th className="py-1.5 px-1 font-medium">PEWS</th><th className="py-1.5 px-1 font-medium">Nurse</th><th className="py-1.5 px-1 font-medium">Next review</th>
              </tr></thead>
              <tbody>
                {patientBoard.length === 0 && <tr><td colSpan={5} className="py-3 text-gray-400">No patients in care.</td></tr>}
                {patientBoard.map((p: any) => (
                  <tr key={p.id} className="border-b border-gray-50">
                    <td className="py-1.5 pr-2 text-gray-500">{p.bed ?? "—"}</td>
                    <td className="py-1.5 px-1 font-medium text-gray-800 truncate max-w-[6rem]">{p.label}</td>
                    <td className={`py-1.5 px-1 font-semibold tabular-nums ${ewsColor(p.pews)}`}>{p.pews ?? "—"}</td>
                    <td className="py-1.5 px-1 text-gray-500 truncate max-w-[5rem]">{p.nurse ? p.nurse.split(" ")[0] : "—"}</td>
                    <td className="py-1.5 px-1 text-gray-500 tabular-nums">{p.nextReview ? fmtTime(p.nextReview) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Real-time Actions + Copilot */}
      <div className="grid lg:grid-cols-3 gap-5">
        <div className={`${card} lg:col-span-2`}>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">⚡ Real-time Actions</h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {actions.map(a => (
              <Link key={a.label} href={a.href} className={`flex flex-col items-center gap-1.5 rounded-lg border py-3 px-1 text-center transition-colors ${a.danger ? "border-red-200 hover:bg-red-50/50" : "border-gray-200 hover:border-teal-300 hover:bg-teal-50/40"}`}>
                <span className="text-lg">{a.icon}</span>
                <span className={`text-[10px] leading-tight ${a.danger ? "text-red-600" : "text-gray-600"}`}>{a.label}</span>
              </Link>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Break allocation &amp; float-pool requests will be actionable once the workforce-clocking module lands; every other action opens its live operational surface.</p>
        </div>

        <div className={card}>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">✨ Operational Copilot</h3>
          <div className="space-y-1.5">
            {copilot.length === 0 && <p className="text-sm text-gray-400">No suggestions — the shift is stable.</p>}
            {copilot.slice(0, 6).map((c: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-gray-700 truncate flex-1">{c.text}</span>
                <Link href={c.href} className="text-[11px] font-medium text-teal-700 border border-teal-200 rounded-full px-2 py-0.5 hover:bg-teal-50 shrink-0">{c.action}</Link>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Rule-based suggestions from live shift data.</p>
        </div>
      </div>
    </div>
  );
}
