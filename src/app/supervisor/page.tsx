import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

export const dynamic = "force-dynamic";

// Shift Supervisor Workspace — Dashboard (SSW-001 Revision 2.0, Ch.4). The
// executive landing overview: shift summary, census, critical alerts, staffing
// status, open escalations, bed status, outstanding tasks, safety alerts, AI
// recommendations and shift KPIs. It summarises rather than duplicating the module
// dashboards. Everything is live from the Clinical Operations Engine (op_*);
// per-metric day-over-day deltas, sparklines, average LOS and break clocking have
// no store and are shown as honest states rather than fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const card = "bg-white rounded-xl border border-gray-200 p-5";
const head = "font-semibold text-gray-900 flex items-center gap-2 text-sm";
const tc = (s: string) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());
const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "--:--";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const covTone = (n: number | null) => (n == null ? "text-gray-300" : n >= 90 ? "text-green-600" : n >= 75 ? "text-amber-600" : "text-rose-600");

export default async function Dashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const { ready, data } = await loadOpsConsoleData(admin, hid, isSuper);
  if (!ready) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-2">The Clinical Operations Engine tables aren&apos;t provisioned yet. Once applied, your shift dashboard fills with live data.</p></div>
      </div>
    );
  }

  const { shifts, shiftStaff, beds, patients, assignments, escalations, alerts, tasks, observations } = data;
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = (profile?.full_name ?? "there").split(" ")[0];

  const activeShift = shifts.find((s: any) => s.status === "active") ?? shifts.find((s: any) => s.status === "planned") ?? null;
  const shiftId = activeShift?.id ?? null;
  const rostered = activeShift ? shiftStaff.filter((s: any) => s.shift_id === activeShift.id) : [];
  const present = rostered.filter((s: any) => ["on_duty", "confirmed", "assigned"].includes(s.status));
  const roleMix = present.reduce<Record<string, number>>((m, s: any) => ({ ...m, [s.role]: (m[s.role] ?? 0) + 1 }), {});
  const unitName = activeShift?.departments?.name ?? "Unit";

  const [handoverRes, tasksDoneRes, stdRes] = await Promise.all([
    scope(admin.from("op_handovers").select("status, accepted_at, created_at")).order("created_at", { ascending: false }).limit(3),
    scope(admin.from("op_tasks").select("id", { count: "exact", head: true })).in("status", ["completed", "verified"]).gte("created_at", todayStart.toISOString()),
    scope(admin.from("op_staffing_standards").select("shift_type, department_id, role, min_count")),
  ]);
  const latestHandover = handoverRes.data?.[0] ?? null;
  const completedToday = tasksDoneRes.count ?? 0;

  // Census / acuity
  const census = patients.filter((p: any) => p.operational_status !== "discharged").length;
  const critical = patients.filter((p: any) => p.acuity_level === "critical").length;
  const byStatus = (s: string) => patients.filter((p: any) => p.operational_status === s).length;

  // Beds
  const bedBy = (s: string) => beds.filter((b: any) => b.status === s).length;
  const totalBeds = beds.length, available = bedBy("available");
  const availPct = totalBeds ? Math.round((available / totalBeds) * 100) : 0;

  // Escalations
  const openEsc = escalations.filter((e: any) => ["open", "acknowledged"].includes(e.status));
  const recentEsc = escalations.slice(0, 3).map((e: any) => ({ label: e.op_patients?.label ?? "patient", summary: e.summary, status: e.status, at: e.created_at, level: e.level }));

  // Observations / safety
  const latestObs = new Map<string, any>();
  observations.forEach((o: any) => { const t = new Date(o.recorded_at ?? o.created_at ?? 0).getTime(); const cur = latestObs.get(o.patient_id); if (!cur || t > cur._t) latestObs.set(o.patient_id, { ...o, _t: t }); });
  const highMews = [...latestObs.values()].filter((o: any) => o.ews_score != null && o.ews_score >= 5).length;
  const overdueObs = observations.filter((o: any) => o.status === "overdue").length;
  const shiftObs = shiftId ? observations.filter((o: any) => o.shift_id === shiftId) : observations;
  const soRecorded = shiftObs.filter((o: any) => o.status === "recorded").length;
  const soPending = shiftObs.filter((o: any) => ["due", "overdue"].includes(o.status)).length;
  const obsCompliance = (soRecorded + soPending) ? Math.round((soRecorded / (soRecorded + soPending)) * 100) : null;

  // Tasks
  const openTasks = tasks.filter((t: any) => !["completed", "verified", "cancelled"].includes(t.status));
  const PRIO = { urgent: "Critical", high: "High", normal: "Medium", low: "Low" } as Record<string, string>;
  const taskByPrio = { Critical: 0, High: 0, Medium: 0, Low: 0 } as Record<string, number>;
  openTasks.forEach((t: any) => { const p = PRIO[t.priority] ?? "Medium"; taskByPrio[p]++; });
  const criticalTasks = taskByPrio.Critical;
  const taskCompletion = (completedToday + openTasks.length) ? Math.round((completedToday / (completedToday + openTasks.length)) * 100) : null;

  // Staffing donut (grouped roles) + skill mix
  const rn = (roleMix.nurse ?? 0) + (roleMix.charge ?? 0);
  const assistants = roleMix.support ?? 0;
  const other = present.length - rn - assistants;
  const staffGroups = [["Registered Nurses", rn, "#14b8a6"], ["Assistants", assistants, "#f59e0b"], ["Other", other, "#6366f1"]] as [string, number, string][];
  const staffTotal = present.length || 1;
  const staffDonut = (() => { let acc = 0; const st: string[] = []; staffGroups.forEach(([, n, c]) => { const a = (acc / staffTotal) * 360, b = ((acc + n) / staffTotal) * 360; if (n) st.push(`${c} ${a}deg ${b}deg`); acc += n; }); return st.length ? `conic-gradient(${st.join(", ")})` : "conic-gradient(#e5e7eb 0deg 360deg)"; })();
  const applies = (row: any) => (row.shift_type === "any" || !activeShift || row.shift_type === activeShift.shift_type) && (row.department_id == null || !activeShift?.department_id || row.department_id === activeShift.department_id);
  const standards = ((stdRes as any).error ? [] : ((stdRes.data ?? []) as any[])).filter(applies);
  const ratioRows = standards.map((s: any) => ({ role: s.role, required: s.min_count, present: (roleMix as any)[s.role] ?? 0 }));
  const skillMix = ratioRows.length ? Math.round((ratioRows.filter((r: any) => r.present >= r.required).length / ratioRows.length) * 100) : null;

  // Tasks donut
  const taskTotal = openTasks.length || 1;
  const taskDonut = (() => { const segs = [["#ef4444", taskByPrio.Critical], ["#f59e0b", taskByPrio.High], ["#3b82f6", taskByPrio.Medium], ["#22c55e", taskByPrio.Low]] as [string, number][]; let acc = 0; const st: string[] = []; segs.forEach(([c, n]) => { const a = (acc / taskTotal) * 360, b = ((acc + n) / taskTotal) * 360; if (n) st.push(`${c} ${a}deg ${b}deg`); acc += n; }); return st.length ? `conic-gradient(${st.join(", ")})` : "conic-gradient(#e5e7eb 0deg 360deg)"; })();

  // Ward status (group active patients by department)
  const wardMap = new Map<string, { n: number; critical: number; high: number }>();
  patients.filter((p: any) => p.operational_status !== "discharged").forEach((p: any) => {
    const w = p.departments?.name ?? unitName;
    const e = wardMap.get(w) ?? { n: 0, critical: 0, high: 0 };
    e.n++; if (p.acuity_level === "critical") e.critical++; else if (p.acuity_level === "high") e.high++;
    wardMap.set(w, e);
  });
  const wardStatus = [...wardMap.entries()].map(([ward, s]) => ({ ward, ...s, status: s.critical > 0 ? `${s.critical} Critical` : s.high > 0 ? `${s.high} High Risk` : "Stable", tone: s.critical > 0 ? "text-rose-600 bg-rose-50" : s.high > 0 ? "text-amber-600 bg-amber-50" : "text-green-600 bg-green-50" })).slice(0, 6);

  // AI recommendations (rule-based)
  const copilot: { text: string; sub: string; href: string }[] = [];
  const heavy = [...assignments.reduce((m: Map<string, number>, a: any) => m.set(a.profiles?.full_name ?? a.staff_id, (m.get(a.profiles?.full_name ?? a.staff_id) ?? 0) + 1), new Map()).entries()].sort((a, b) => b[1] - a[1])[0];
  if (skillMix != null && skillMix < 100) copilot.push({ text: "Review staffing mix", sub: "Mandatory ratio below target", href: "/supervisor/workforce-operations" });
  if (byStatus("discharge_pending") > 0) copilot.push({ text: "Discharge readiness", sub: `${byStatus("discharge_pending")} patients may be ready`, href: "/supervisor/patient-flow" });
  if (availPct < 20) copilot.push({ text: "Low bed availability", sub: "Consider planned discharges", href: "/supervisor/bed-management" });
  if (heavy && heavy[1] >= 6) copilot.push({ text: `Rebalance ${heavy[0]}`, sub: `Carrying ${heavy[1]} patients`, href: "/supervisor/operations?section=assignments" });
  if (highMews > 0) copilot.push({ text: "High MEWS review", sub: `${highMews} patient${highMews > 1 ? "s" : ""} deteriorating`, href: "/supervisor/clinical-safety" });

  // KPIs (this shift)
  const patientSafety = Math.max(0, 100 - critical * 4 - highMews * 5 - alerts.length * 2);
  const handoverQuality = latestHandover?.status === "accepted" ? 100 : latestHandover ? 60 : null;
  const shiftKpis = [
    ["Patient Safety", `${patientSafety}%`, covTone(patientSafety)],
    ["Observation Compliance", obsCompliance == null ? "—" : `${obsCompliance}%`, covTone(obsCompliance)],
    ["Average LOS", "—", "text-gray-400"],
    ["Task Completion", taskCompletion == null ? "—" : `${taskCompletion}%`, covTone(taskCompletion)],
    ["Handover Quality", handoverQuality == null ? "—" : `${handoverQuality}%`, covTone(handoverQuality)],
  ];

  const kpis = [
    { label: "Total Patients", value: census, sub: "Current census", href: "/supervisor/patient-list", tone: "" },
    { label: "Critical Patients", value: critical, sub: "View patients", href: "/supervisor/clinical-safety", tone: critical ? "text-rose-600" : "" },
    { label: "Available Beds", value: `${available}/${totalBeds}`, sub: `${availPct}% available`, href: "/supervisor/bed-management", tone: "" },
    { label: "Staff on Duty", value: present.length, sub: "Break clocking not tracked", href: "/supervisor/workforce-operations", tone: "" },
    { label: "Open Escalations", value: openEsc.length, sub: "View escalations", href: "/supervisor/operations?section=safety", tone: openEsc.length ? "text-amber-600" : "" },
    { label: "Outstanding Tasks", value: openTasks.length, sub: `${criticalTasks} critical`, href: "/supervisor/task-center", tone: criticalTasks ? "text-rose-600" : "" },
  ];

  return (
    <div data-wide className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{greeting}, {firstName} 👋</h1>
          <p className="text-sm text-gray-500">Here is your shift overview for {new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" })}{activeShift ? ` · ${tc(activeShift.shift_type)} shift` : ""}</p>
        </div>
        {activeShift && (
          <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <div><p className="text-xs font-bold text-green-700">Active Shift</p><p className="text-[11px] text-green-600 tabular-nums">{fmtTime(activeShift.starts_at)} – {fmtTime(activeShift.ends_at)}</p></div>
          </div>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map(k => (
          <Link key={k.label} href={k.href} className={`${card} !p-4 hover:border-teal-300 transition-colors`}>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide leading-tight">{k.label}</p>
            <p className={`text-2xl font-bold mt-1 tabular-nums ${k.tone || "text-gray-900"}`}>{k.value}</p>
            <p className="text-[11px] text-gray-400 truncate">{k.sub}</p>
          </Link>
        ))}
      </div>

      {/* Patient Flow · Staffing Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={card}>
          <h3 className={head}>🔀 Patient Flow Today</h3>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {[["Admitted", patients.filter((p: any) => p.operational_status === "admitted" && p.created_at && new Date(p.created_at) >= todayStart).length, "text-green-600"], ["Transfers", byStatus("transfer_pending"), "text-blue-600"], ["Discharge Pending", byStatus("discharge_pending"), "text-violet-600"]].map(([l, n, tone]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-3 text-center"><p className={`text-2xl font-bold tabular-nums ${tone}`}>{n}</p><p className="text-[10px] text-gray-500 mt-0.5">{l}</p></div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Live census movement. Hourly flow curve &amp; completed-discharge timing need directional flow tracking.</p>
        </div>

        <div className={card}>
          <h3 className={head}>👥 Staffing Overview</h3>
          <div className="mt-3 flex items-center gap-4">
            <div className="relative w-24 h-24 shrink-0 rounded-full" style={{ background: staffDonut }}>
              <div className="absolute inset-[10px] bg-white rounded-full flex flex-col items-center justify-center"><span className="text-lg font-bold text-gray-900 leading-none">{present.length}</span><span className="text-[8px] text-gray-400">on duty</span></div>
            </div>
            <div className="text-xs space-y-1 flex-1">
              {staffGroups.map(([l, n, c]) => (
                <div key={l} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c }} /><span className="text-gray-600 flex-1">{l}</span><span className="font-semibold text-gray-800 tabular-nums">{n} <span className="text-gray-400 font-normal">({present.length ? Math.round((n / present.length) * 100) : 0}%)</span></span></div>
              ))}
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center justify-between text-xs mb-1"><span className="text-gray-600">Skill Mix Compliance</span><span className={`font-semibold ${covTone(skillMix)}`}>{skillMix == null ? "—" : `${skillMix}%`} <span className="text-gray-400 font-normal">· target ≥90%</span></span></div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${skillMix == null ? "bg-gray-200" : skillMix >= 90 ? "bg-green-500" : skillMix >= 75 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${skillMix ?? 0}%` }} /></div>
          </div>
        </div>
      </div>

      {/* Ward Status · Safety Alerts · AI Recommendations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={card}>
          <h3 className={head}>🏥 Ward Status</h3>
          <div className="mt-3 space-y-1.5">
            {wardStatus.length === 0 && <p className="text-sm text-gray-400">No active wards.</p>}
            {wardStatus.map(w => (
              <div key={w.ward} className="flex items-center gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5">
                <div className="min-w-0 flex-1"><p className="text-xs font-medium text-gray-800 truncate">{w.ward}</p><p className="text-[10px] text-gray-400">{w.n} patients</p></div>
                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${w.tone}`}>{w.status}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={card}>
          <h3 className={head}>⚠️ Safety Alerts</h3>
          <div className="mt-3 space-y-1.5">
            {[["Patients with High MEWS", highMews, "/supervisor/clinical-safety", "rose"], ["Overdue Observations", overdueObs, "/supervisor/operations?section=safety", "amber"], ["Open Incidents", alerts.length, "/supervisor/operations?section=safety", "amber"], ["Escalations Awaiting Review", openEsc.length, "/supervisor/operations?section=safety", "rose"]].map(([l, n, href, tone]: any) => (
              <Link key={l} href={href} className="flex items-center gap-2 rounded-lg border border-gray-100 hover:border-gray-200 px-2.5 py-1.5">
                <span className={`w-2 h-2 rounded-full shrink-0 ${(n ?? 0) > 0 ? (tone === "rose" ? "bg-rose-500" : "bg-amber-500") : "bg-gray-300"}`} />
                <span className="text-xs text-gray-700 flex-1">{l}</span>
                <span className={`text-sm font-bold tabular-nums ${(n ?? 0) > 0 ? (tone === "rose" ? "text-rose-600" : "text-amber-600") : "text-gray-300"}`}>{n}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className={card}>
          <h3 className={head}>✨ AI Recommendations</h3>
          <div className="mt-3 space-y-1.5">
            {copilot.length === 0 ? <p className="text-sm text-gray-400">No recommendations — the shift looks balanced.</p> : copilot.slice(0, 4).map((c, i) => (
              <Link key={i} href={c.href} className="flex items-start gap-2 rounded-lg border border-gray-100 hover:border-violet-200 hover:bg-violet-50/30 px-2.5 py-1.5">
                <span className="text-sm shrink-0">💡</span>
                <div className="min-w-0"><p className="text-xs font-medium text-gray-800 leading-tight">{c.text}</p><p className="text-[10px] text-gray-400">{c.sub}</p></div>
              </Link>
            ))}
          </div>
          <Link href="/supervisor/ai" className="mt-3 block text-center text-xs text-teal-700 hover:underline">View all recommendations →</Link>
        </div>
      </div>

      {/* Tasks Summary · Recent Escalations · Shift Handover */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={card}>
          <h3 className={head}>✅ Tasks Summary</h3>
          <div className="mt-3 flex items-center gap-4">
            <div className="relative w-20 h-20 shrink-0 rounded-full" style={{ background: taskDonut }}>
              <div className="absolute inset-[8px] bg-white rounded-full flex flex-col items-center justify-center"><span className="text-base font-bold text-gray-900 leading-none">{openTasks.length}</span><span className="text-[8px] text-gray-400">open</span></div>
            </div>
            <div className="text-xs space-y-1 flex-1">
              {[["Critical", taskByPrio.Critical, "#ef4444"], ["High", taskByPrio.High, "#f59e0b"], ["Medium", taskByPrio.Medium, "#3b82f6"], ["Low", taskByPrio.Low, "#22c55e"]].map(([l, n, c]: any) => (
                <div key={l} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c }} /><span className="text-gray-600 flex-1">{l}</span><span className="font-semibold text-gray-800 tabular-nums">{n}</span></div>
              ))}
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-gray-100 flex items-center justify-between text-xs"><span className="text-gray-500">Completed today</span><span className="font-semibold text-green-600">{completedToday}</span></div>
          <Link href="/supervisor/task-center" className="mt-2 block text-center text-xs text-teal-700 hover:underline">Go to Task Centre →</Link>
        </div>

        <div className={card}>
          <h3 className={head}>⬆️ Recent Escalations</h3>
          <div className="mt-3 space-y-2">
            {recentEsc.length === 0 ? <p className="text-sm text-gray-400">No recent escalations.</p> : recentEsc.map((e, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${e.level >= 4 ? "bg-rose-500" : "bg-amber-500"}`} />
                <div className="min-w-0 flex-1"><p className="text-xs font-medium text-gray-800 truncate">{e.label} — {e.summary || `Escalation L${e.level}`}</p><p className="text-[10px] text-gray-400">{relTime(e.at)}</p></div>
                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${e.status === "acknowledged" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>{tc(e.status)}</span>
              </div>
            ))}
          </div>
          <Link href="/supervisor/operations?section=safety" className="mt-3 block text-center text-xs text-teal-700 hover:underline">Go to Escalation Centre →</Link>
        </div>

        <div className={card}>
          <h3 className={head}>🔄 Shift Handover</h3>
          <div className="mt-3 space-y-2">
            <div className="rounded-lg border border-gray-100 p-3">
              <p className="text-[10px] text-gray-400 uppercase">Outgoing shift</p>
              <p className="text-sm font-medium text-gray-800">{activeShift?.ends_at ? fmtTime(activeShift.ends_at) : "—"} · {latestHandover ? tc(latestHandover.status) : "Not started"}</p>
              <Link href="/supervisor/handover" className="text-[11px] text-teal-700 hover:underline">Review handover →</Link>
            </div>
            <div className="rounded-lg border border-gray-100 p-3">
              <p className="text-[10px] text-gray-400 uppercase">Incoming shift</p>
              <p className="text-sm font-medium text-gray-800">{latestHandover?.status === "accepted" ? "Accepted" : "Awaiting"}</p>
              <Link href="/supervisor/handover" className="text-[11px] text-teal-700 hover:underline">Prepare handover →</Link>
            </div>
          </div>
        </div>
      </div>

      {/* Shift KPIs */}
      <div className={card}>
        <h3 className={head}>📊 Key Performance Indicators <span className="text-gray-400 font-normal">· this shift</span></h3>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3">
          {shiftKpis.map(([l, v, tone]: any) => (
            <div key={l} className="rounded-lg border border-gray-100 p-3 text-center"><p className={`text-2xl font-bold tabular-nums ${tone}`}>{v}</p><p className="text-[10px] text-gray-500 mt-0.5 leading-tight">{l}</p></div>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-3">Patient Safety is a live composite (critical/MEWS/incident load); observation compliance, task completion and handover quality are measured from live records. Average LOS and day-over-day deltas need admission/discharge timing history.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Dashboard is the executive overview for your shift (SSW-001 R2) — shift summary, census, critical alerts, staffing, escalations, bed status, tasks, safety alerts, AI recommendations and shift KPIs — summarised from the Clinical Operations Engine (op_*) rather than duplicated from the module dashboards. Per-metric sparklines, day-over-day deltas, average LOS and break clocking have no store and are shown as honest states rather than fabricated.</p>
    </div>
  );
}
