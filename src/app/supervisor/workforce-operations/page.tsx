import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceOps } from "@/lib/operations/workforce-ops";

export const dynamic = "force-dynamic";

// Workforce Operations (SSW-001) — the Shift Supervisor's live view of the
// workforce during the current shift: who is working, whether we are safely
// staffed, whether staff are competent and compliant, staff support, and shift
// intelligence. Five modules, all derived from live op_*/competency data;
// worked-hours, break-clocking, overtime and fatigue have no store yet and are
// shown as honest states, never invented.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const titleCase = (s: string) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());
const covTone = (n: number | null) => (n == null ? "text-gray-300" : n >= 90 ? "text-green-600" : n >= 75 ? "text-amber-600" : "text-rose-600");
const SEV_TONE: Record<string, string> = { critical: "bg-rose-50 text-rose-700", emergency: "bg-rose-50 text-rose-700", high: "bg-orange-50 text-orange-700", urgent: "bg-amber-50 text-amber-700", routine: "bg-gray-100 text-gray-600" };
const ROLE_TONE: Record<string, string> = { charge: "bg-violet-50 text-violet-700", nurse: "bg-green-50 text-green-700", support: "bg-teal-50 text-teal-700", float: "bg-blue-50 text-blue-700", doctor: "bg-rose-50 text-rose-700", educator: "bg-amber-50 text-amber-700", assessor: "bg-amber-50 text-amber-700", therapist: "bg-sky-50 text-sky-700" };

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
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <p className="font-semibold text-amber-900">⚙️ Coming online</p>
          <p className="text-sm text-amber-800 mt-1">Workforce Operations activates once the Clinical Operations Engine is provisioned for your hospital (shifts, staffing and rostering).</p>
        </div>
      </div>
    );
  }

  const sa = d.staffAssignment, st = d.staffing, cc = d.compliance, su = d.support, wi = d.intelligence;

  return (
    <div data-wide className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Workforce Operations</h1>
          <p className="text-sm text-gray-500">Manage the right people, with the right skills, in the right place at the right time.</p>
        </div>
        {d.shift && (
          <div className="text-right">
            <p className="text-xs font-semibold text-gray-700">{titleCase(d.shift.shift_type)} · {d.shift.unit}</p>
            <p className="text-[11px] text-gray-400">{d.shift.status} · {d.overview.present}/{d.overview.rostered} on duty</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Module 1: Staff Assignment Center */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold">1</span>
            <div><h2 className="text-sm font-bold text-gray-900 leading-tight">Staff Assignment Center</h2><p className="text-[10px] text-gray-500">Who is working, where, and on what</p></div>
            <Link href="/supervisor/operations?section=assignments" className="ml-auto text-[11px] text-teal-700 hover:underline shrink-0">Assign →</Link>
          </div>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-3xl font-bold text-gray-900 tabular-nums">{dash(sa.onDuty)}</span>
            <span className="text-xs text-gray-500">on duty · {sa.rostered} rostered</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {Object.entries(sa.roleMix).sort((a: any, b: any) => b[1] - a[1]).map(([role, n]: any) => (
              <span key={role} className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${ROLE_TONE[role] ?? "bg-gray-100 text-gray-600"}`}>{titleCase(role)} {n}</span>
            ))}
          </div>
          {sa.staffBoard.length === 0 ? <p className="text-xs text-gray-400 py-4 text-center">No staff rostered on the active shift.</p> : (
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {sa.staffBoard.slice(0, 10).map((s: any) => (
                <div key={s.id} className="flex items-center gap-2 text-xs py-1">
                  <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[9px] font-bold text-gray-600 shrink-0">{(s.name ?? "?").slice(0, 1)}</span>
                  <span className="text-gray-800 flex-1 truncate">{s.name}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded ${ROLE_TONE[s.role] ?? "bg-gray-100 text-gray-600"}`}>{s.role}</span>
                  <span className="tabular-nums text-gray-500 w-14 text-right">{s.patients} pt{s.patients === 1 ? "" : "s"}</span>
                  {s.competencyOk === false && <span className="text-rose-500 text-[10px]" title="Patients outside validated competency">⚠</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Module 2: Staffing & Capacity Monitor */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-green-100 text-green-700 flex items-center justify-center text-sm font-bold">2</span>
            <div><h2 className="text-sm font-bold text-gray-900 leading-tight">Staffing &amp; Capacity Monitor</h2><p className="text-[10px] text-gray-500">Are we safely staffed?</p></div>
            <Link href="/supervisor/operations?section=shifts" className="ml-auto text-[11px] text-teal-700 hover:underline shrink-0">Roster →</Link>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[["Coverage", st.coverage == null ? "—" : `${st.coverage}%`, covTone(st.coverage)], ["Vacancies", dash(st.vacancies), st.vacancies > 0 ? "text-rose-600" : "text-gray-900"], ["Sick Calls", dash(st.sickCalls), st.sickCalls > 0 ? "text-amber-600" : "text-gray-900"]].map(([l, v, tone]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-2 text-center"><p className={`text-lg font-bold tabular-nums ${tone}`}>{v}</p><p className="text-[9px] text-gray-500">{l}</p></div>
            ))}
          </div>
          {st.ratioRows.length === 0 ? <p className="text-xs text-gray-400 py-4 text-center">No staffing standards configured for this shift.</p> : (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-gray-400 uppercase">Unit staffing (required vs present)</p>
              {st.ratioRows.map((r: any) => {
                const ok = r.present >= r.required;
                return (
                  <div key={r.role}>
                    <div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600">{titleCase(r.role)}</span><span className={`tabular-nums ${ok ? "text-green-600" : "text-rose-600"}`}>{r.present}/{r.required}</span></div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${ok ? "bg-green-500" : "bg-rose-500"}`} style={{ width: `${Math.min(100, (r.present / Math.max(1, r.required)) * 100)}%` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-3">Late arrivals &amp; overtime need shift clocking — not yet captured.</p>
        </div>

        {/* Module 3: Workforce Competency & Compliance */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center text-sm font-bold">3</span>
            <div><h2 className="text-sm font-bold text-gray-900 leading-tight">Competency &amp; Compliance</h2><p className="text-[10px] text-gray-500">Are our staff competent and compliant?</p></div>
            <Link href="/supervisor/operations?section=assignments" className="ml-auto text-[11px] text-teal-700 hover:underline shrink-0">Review →</Link>
          </div>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[["Compliant", cc.coverage == null ? "—" : `${cc.coverage}%`, covTone(cc.coverage)], ["Expiring", dash(cc.expiring), cc.expiring > 0 ? "text-amber-600" : "text-gray-900"], ["Expired", dash(cc.expired), cc.expired > 0 ? "text-rose-600" : "text-gray-900"], ["Supervise", dash(cc.needsSupervision), cc.needsSupervision > 0 ? "text-amber-600" : "text-gray-900"]].map(([l, v, tone]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-2 text-center"><p className={`text-base font-bold tabular-nums ${tone}`}>{v}</p><p className="text-[8px] text-gray-500 leading-tight">{l}</p></div>
            ))}
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between"><span className="text-gray-600">Competencies validated</span><span className="tabular-nums text-gray-700">{cc.competent}/{cc.total}</span></div>
            <div className="flex items-center justify-between"><span className="text-gray-600">Credentials (licences)</span><span className="tabular-nums text-gray-700">{dash(cc.credentials)}{cc.credExpired ? ` · ${cc.credExpired} expired` : ""}</span></div>
            <div className="flex items-center justify-between"><span className="text-gray-600">Bedside-validated care</span><span className={`tabular-nums ${cc.validatedCare == null ? "text-gray-400" : covTone(cc.validatedCare)}`}>{cc.validatedCare == null ? "—" : `${cc.validatedCare}%`}</span></div>
            <div className="flex items-center justify-between"><span className="text-gray-600">Competency gaps</span><span className={`tabular-nums ${cc.gaps > 0 ? "text-rose-600" : "text-gray-700"}`}>{cc.gaps}</span></div>
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Live from competency decisions (expiry-aware) + professional credentials.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Module 4: Staff Support & Escalation Center */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center text-sm font-bold">4</span>
            <div><h2 className="text-sm font-bold text-gray-900 leading-tight">Staff Support &amp; Escalation Center</h2><p className="text-[10px] text-gray-500">Support our staff. Resolve issues quickly.</p></div>
            <Link href="/supervisor/operations?section=safety" className="ml-auto text-[11px] text-teal-700 hover:underline shrink-0">Escalate →</Link>
          </div>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[["Open Esc.", su.openEscalations, "text-rose-600"], ["In Progress", su.inProgress, "text-amber-600"], ["Resolved", su.resolvedToday, "text-green-600"], ["Safety Alerts", su.safetyAlerts, "text-orange-600"]].map(([l, n, tone]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-2 text-center"><p className={`text-lg font-bold tabular-nums ${(n ?? 0) > 0 ? tone : "text-gray-900"}`}>{dash(n)}</p><p className="text-[8px] text-gray-500 leading-tight">{l}</p></div>
            ))}
          </div>
          {su.recentEscalations.length > 0 ? (
            <div className="divide-y divide-gray-50">
              {su.recentEscalations.map((e: any, i: number) => (
                <div key={i} className="flex items-center gap-2 py-1.5">
                  <span className="text-xs text-gray-700 flex-1 truncate">{e.summary || "Escalation"}</span>
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 capitalize ${SEV_TONE[String(e.severity).toLowerCase()] ?? "bg-gray-100 text-gray-600"}`}>{e.severity ?? `L${e.level}`}</span>
                  <span className="text-[10px] text-gray-400 shrink-0">{relTime(e.at)}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400 py-3 text-center">No open escalations.</p>}
          <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">Break requests, wellbeing check-ins, fatigue &amp; occupational-injury tracking arrive with the workforce-support store.</p>
        </div>

        {/* Module 5: Workforce Intelligence Dashboard */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center text-sm font-bold">5</span>
            <div><h2 className="text-sm font-bold text-gray-900 leading-tight">Workforce Intelligence</h2><p className="text-[10px] text-gray-500">Real-time insights to drive better decisions</p></div>
          </div>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[["Avg Pts/Nurse", wi.avgPtsPerNurse == null ? "—" : wi.avgPtsPerNurse, "text-gray-900"], ["Utilisation", "—", "text-gray-400"], ["Overtime", "—", "text-gray-400"], ["Shift Score", wi.shiftScore == null ? "—" : wi.shiftScore, covTone(wi.shiftScore)]].map(([l, v, tone]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-2 text-center"><p className={`text-base font-bold tabular-nums ${tone}`}>{v}</p><p className="text-[8px] text-gray-500 leading-tight">{l}</p></div>
            ))}
          </div>
          {wi.workloadByStaff.length === 0 ? <p className="text-xs text-gray-400 py-3 text-center">No patient assignments yet.</p> : (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-gray-400 uppercase">Workload by staff (patients)</p>
              {wi.workloadByStaff.map((s: any, i: number) => {
                const max = Math.max(1, ...wi.workloadByStaff.map((x: any) => x.patients));
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600 truncate">{s.name}</span><span className="tabular-nums text-gray-500">{s.patients}</span></div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${s.patients >= 6 ? "bg-rose-500" : "bg-teal-500"}`} style={{ width: `${(s.patients / max) * 100}%` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">Shift score = mean of coverage, competency and escalation load. Utilisation, overtime, missed breaks &amp; 7-shift trend need shift clocking.</p>
        </div>
      </div>

      {/* AI Workforce Assistant */}
      <div className={`${card} p-4`}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base">✨</span>
          <h2 className="text-sm font-bold text-gray-900">AI Workforce Assistant</h2>
          <span className="text-[10px] text-gray-400">rule-based · live shift signals</span>
        </div>
        {d.copilot.length === 0 ? <p className="text-xs text-gray-400">No workforce actions surfaced — the shift looks balanced.</p> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {d.copilot.map((c: any, i: number) => (
              <Link key={i} href={c.href} className="flex items-start gap-2 rounded-lg border border-gray-100 p-2.5 hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
                <span className="text-sm shrink-0">💡</span>
                <div className="min-w-0"><p className="text-xs text-gray-700 leading-tight">{c.text}</p><p className="text-[10px] font-semibold text-teal-700 mt-0.5">{c.action} →</p></div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Workforce Operations manages today's workforce (not employment): who is on duty and their assignments, whether the shift is safely staffed against the mandatory ratios, competency and credential compliance, staff support and escalations, and shift intelligence. Every figure is live from the Clinical Operations Engine and competency records; worked hours, break clocking, overtime, fatigue and per-shift trend need a workforce-clocking store and are shown as honest states rather than fabricated.</p>
    </div>
  );
}
