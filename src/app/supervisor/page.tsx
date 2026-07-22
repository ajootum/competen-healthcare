import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

export const dynamic = "force-dynamic";

// Shift Command — SSW-001 "Mission Control". The workspace landing, laid out to the
// Overall Design: a live KPI strip, the Shift Command band (Current Shift, Today's
// Priorities, Critical Alerts, Shift Timeline), quick actions + AI copilot + upcoming
// events, then Patient / Staffing / Tasks / Escalations overviews and the Ward Map,
// Patient Flow and Notifications. Everything is derived from live Clinical Operations
// (op_*) data; anything the schema does not back (per-metric trend sparklines,
// transfer in/out split, shift-goal library) is shown as an honest state, not faked.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const pretty = (s: string) => (s ?? "").replace(/_/g, " ");
const titleCase = (s: string) => pretty(s).split(" ").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "--:--";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const card = "bg-white rounded-xl border border-gray-200 p-5";
const head = "font-semibold text-gray-900 flex items-center gap-2 text-sm";

export default async function ShiftCommand() {
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
        <h1 className="text-2xl font-bold text-gray-900">Shift Command</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <p className="font-semibold text-amber-900">⚙️ Coming online</p>
          <p className="text-sm text-amber-800 mt-2">The Clinical Operations Engine tables aren&apos;t provisioned yet (migrations 038 &amp; 039). Once applied, this command centre fills with your live shift data.</p>
        </div>
      </div>
    );
  }

  const { shifts, shiftStaff, beds, patients, assignments, escalations, alerts, tasks, observations } = data;
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const now = Date.now();

  // ── Shift & staff ────────────────────────────────────────────────────────
  const activeShift = shifts.find((s: any) => s.status === "active") ?? shifts.find((s: any) => s.status === "planned") ?? null;
  const shiftId = activeShift?.id ?? null;
  const rostered = activeShift ? shiftStaff.filter((s: any) => s.shift_id === activeShift.id) : [];
  const present = rostered.filter((s: any) => ["on_duty", "confirmed", "assigned"].includes(s.status));
  const absent = rostered.filter((s: any) => s.status === "absent");
  const roleMix = present.reduce((m: Record<string, number>, s: any) => ({ ...m, [s.role]: (m[s.role] ?? 0) + 1 }), {});
  const supervisorName = activeShift?.profiles?.full_name ?? profile?.full_name ?? "—";
  const unitName = activeShift?.departments?.name ?? "Unit";
  const staffPct = rostered.length ? Math.round((present.length / rostered.length) * 100) : null;

  const tScope = (q: any) => (shiftId ? q.eq("shift_id", shiftId) : scope(q));
  const nowIso = new Date(now).toISOString();
  const [handoverRes, unreadListRes, tasksTotalRes, tasksDoneRes, stdRes, roundRes] = await Promise.all([
    scope(admin.from("op_handovers").select("status, accepted_at, created_at")).order("created_at", { ascending: false }).limit(5),
    admin.from("notifications").select("title, body, href, created_at").eq("user_id", user.id).eq("read", false).order("created_at", { ascending: false }).limit(6),
    tScope(admin.from("op_tasks").select("id", { count: "exact", head: true })).neq("status", "cancelled"),
    tScope(admin.from("op_tasks").select("id", { count: "exact", head: true })).in("status", ["completed", "verified"]),
    scope(admin.from("op_staffing_standards").select("shift_type, department_id, role, min_count")),
    scope(admin.from("op_round_schedule").select("shift_type, department_id, at_time, label")).order("at_time"),
  ]);
  const handovers = handoverRes.data ?? [];
  const unreadList = unreadListRes.error ? [] : (unreadListRes.data ?? []);
  const tasksTotal = tasksTotalRes.count ?? 0;
  const tasksDone = tasksDoneRes.count ?? 0;

  // ── Ward configuration (mandatory ratios + planned rounds) ───────────────
  const applies = (row: any) =>
    (row.shift_type === "any" || !activeShift || row.shift_type === activeShift.shift_type) &&
    (row.department_id == null || !activeShift?.department_id || row.department_id === activeShift.department_id);
  const standards = ((stdRes as any).error ? [] : ((stdRes.data ?? []) as any[])).filter(applies);
  const rounds = ((roundRes as any).error ? [] : ((roundRes.data ?? []) as any[])).filter(applies);
  const ratioRows = standards.map((s: any) => ({ role: s.role, required: s.min_count, present: (roleMix as any)[s.role] ?? 0 }));
  const ratioMet = ratioRows.filter((r: any) => r.present >= r.required).length;
  const ratioCompliance = ratioRows.length ? Math.round((ratioMet / ratioRows.length) * 100) : null;
  const shortRoles = ratioRows.filter((r: any) => r.present < r.required);

  // ── Patients / acuity ────────────────────────────────────────────────────
  const census = patients.length;
  const byStatus = (s: string) => patients.filter((p: any) => p.operational_status === s).length;
  const byAcuity = (a: string) => patients.filter((p: any) => p.acuity_level === a).length;
  const highAcuity = byAcuity("critical") + byAcuity("high");
  const medAcuity = byAcuity("moderate");
  const lowAcuity = byAcuity("low") + byAcuity("stable");
  const highShare = census ? Math.round((highAcuity / census) * 100) : 0;
  const acuityLabel = highShare >= 15 ? "High" : highShare >= 5 ? "Medium" : "Low";
  const isolation = patients.filter((p: any) => p.isolation_status && p.isolation_status !== "none").length;
  const critical = byAcuity("critical");

  // ── Safety / escalations ─────────────────────────────────────────────────
  const alertCat = (c: string) => alerts.filter((a: any) => a.category === c).length;
  const openEsc = escalations.filter((e: any) => ["open", "acknowledged"].includes(e.status));
  const escHigh = openEsc.filter((e: any) => e.level >= 4).length;
  const escMed = openEsc.filter((e: any) => e.level === 2 || e.level === 3).length;
  const escLow = openEsc.filter((e: any) => e.level <= 1).length;
  const latestObs = new Map<string, any>();
  observations.forEach((o: any) => {
    const t = new Date(o.recorded_at ?? o.created_at ?? 0).getTime();
    const cur = latestObs.get(o.patient_id);
    if (!cur || t > cur._t) latestObs.set(o.patient_id, { ...o, _t: t });
  });
  const deteriorating = [...latestObs.values()].filter((o: any) => o.ews_score != null && o.ews_score >= 5);

  // ── Observations & tasks ─────────────────────────────────────────────────
  const overdueCount = observations.filter((o: any) => o.status === "overdue").length;
  const shiftObs = shiftId ? observations.filter((o: any) => o.shift_id === shiftId) : observations;
  const soRecorded = shiftObs.filter((o: any) => o.status === "recorded").length;
  const soPending = shiftObs.filter((o: any) => ["due", "overdue"].includes(o.status)).length;
  const obsCompliance = (soRecorded + soPending) ? Math.round((soRecorded / (soRecorded + soPending)) * 100) : null;
  const taskInProgress = tasks.filter((t: any) => ["accepted", "in_progress"].includes(t.status)).length;
  const taskOverdue = tasks.filter((t: any) => t.due_at && new Date(t.due_at).getTime() < now && !["completed", "verified", "cancelled"].includes(t.status)).length;
  const taskOpen = tasks.filter((t: any) => !["completed", "verified", "cancelled"].includes(t.status)).length;
  const taskOther = Math.max(0, tasksTotal - tasksDone - taskInProgress - taskOverdue);

  // ── Beds / capacity ──────────────────────────────────────────────────────
  const bedBy = (s: string) => beds.filter((b: any) => b.status === s).length;
  const totalBeds = beds.length;
  const occupied = bedBy("occupied");
  const occPct = totalBeds ? Math.round((occupied / totalBeds) * 100) : 0;
  const patientByBed = new Map<string, any>();
  patients.forEach((p: any) => { if (p.bed_id) patientByBed.set(p.bed_id, p); });

  // ── Handover / current shift timers ──────────────────────────────────────
  const latestHandover = handovers[0] ?? null;
  const handoverDone = latestHandover?.status === "accepted";
  const durMs = activeShift?.starts_at && activeShift?.ends_at ? new Date(activeShift.ends_at).getTime() - new Date(activeShift.starts_at).getTime() : null;
  const elapsedMs = activeShift?.starts_at ? Math.max(0, now - new Date(activeShift.starts_at).getTime()) : null;
  const elapsedPct = durMs && elapsedMs != null ? Math.min(100, Math.round((elapsedMs / durMs) * 100)) : null;
  const elapsedLabel = elapsedMs != null ? `${Math.floor(elapsedMs / 3.6e6)}h ${Math.floor((elapsedMs % 3.6e6) / 6e4)}m` : "—";

  // ── Today's Priorities — achieved (from live state) + open (derived) ──────
  const achieved: string[] = [];
  if (handoverDone) achieved.push("Incoming handover accepted");
  if (overdueCount === 0) achieved.push("Observations on track");
  if (openEsc.length === 0) achieved.push("No open escalations");
  if (ratioCompliance === 100) achieved.push("Mandatory staffing ratios met");
  const openPriorities: { tone: string; title: string; href: string }[] = [];
  escalations.filter((e: any) => e.level >= 4).slice(0, 2).forEach((e: any) => openPriorities.push({ tone: "red", title: `Respond — ${e.op_patients?.label ?? "patient"} (L${e.level})`, href: "/supervisor/operations?section=safety" }));
  if (overdueCount > 0) openPriorities.push({ tone: "amber", title: `Reduce overdue observations (${overdueCount})`, href: "/supervisor/operations?section=safety" });
  deteriorating.slice(0, 1).forEach((o: any) => openPriorities.push({ tone: "amber", title: `Review high-risk patients (PEWS ${o.ews_score})`, href: "/supervisor/operations?section=safety" }));
  if (byStatus("discharge_pending") > 0) openPriorities.push({ tone: "amber", title: `Action ${byStatus("discharge_pending")} pending discharge${byStatus("discharge_pending") > 1 ? "s" : ""}`, href: "/supervisor/operations?section=ward" });
  if (absent.length > 0) openPriorities.push({ tone: "amber", title: `Allocate cover — ${absent.length} staff absent`, href: "/supervisor/operations?section=assignments" });
  if (!handoverDone) openPriorities.push({ tone: "amber", title: "Complete shift handover", href: "/supervisor/handover" });

  // ── Critical Alerts (safety alerts + overdue obs + staffing shortfall) ───
  type Crit = { tone: string; title: string; sub: string; at?: string | null; href: string };
  const criticalAlerts: Crit[] = [];
  escalations.filter((e: any) => e.level >= 4).forEach((e: any) => criticalAlerts.push({ tone: "red", title: `Rapid response — ${e.op_patients?.label ?? "patient"}`, sub: e.summary ?? `Escalation L${e.level}`, at: e.created_at, href: "/supervisor/operations?section=safety" }));
  alerts.filter((a: any) => a.severity === "high").slice(0, 4).forEach((a: any) => criticalAlerts.push({ tone: "red", title: `${titleCase(a.category ?? "Safety alert")} — ${a.op_patients?.label ?? "patient"}`, sub: a.note ?? "High severity", at: a.created_at, href: "/supervisor/operations?section=safety" }));
  observations.filter((o: any) => o.status === "overdue").slice(0, 2).forEach((o: any) => criticalAlerts.push({ tone: "amber", title: `Observation overdue — ${o.op_patients?.label ?? "patient"}`, sub: "PEWS/obs past due", at: o.due_at, href: "/supervisor/operations?section=safety" }));
  shortRoles.forEach((r: any) => criticalAlerts.push({ tone: "red", title: `Staff shortage — ${titleCase(r.role)}`, sub: `${r.present} of ${r.required} required`, href: "/supervisor/operations?section=assignments" }));
  const critRank: Record<string, number> = { red: 0, amber: 1 };
  criticalAlerts.sort((a, b) => critRank[a.tone] - critRank[b.tone]);

  // ── Shift Timeline (real events + planned rounds) ────────────────────────
  type TlItem = { hm: string; label: string; kind: "event" | "round"; done: boolean };
  const tl: TlItem[] = [];
  if (activeShift?.starts_at) tl.push({ hm: fmtTime(activeShift.starts_at), label: "Shift started", kind: "event", done: activeShift.status !== "planned" });
  if (latestHandover?.accepted_at) tl.push({ hm: fmtTime(latestHandover.accepted_at), label: "Handover accepted", kind: "event", done: true });
  escalations.slice(0, 3).forEach((e: any) => e.created_at && tl.push({ hm: fmtTime(e.created_at), label: `Escalation — ${e.op_patients?.label ?? "patient"}`, kind: "event", done: true }));
  observations.filter((o: any) => o.status === "recorded" && o.recorded_at).slice(0, 2).forEach((o: any) => tl.push({ hm: fmtTime(o.recorded_at), label: `Observation — ${o.op_patients?.label ?? "patient"}`, kind: "event", done: true }));
  rounds.forEach((r: any) => tl.push({ hm: r.at_time, label: r.label, kind: "round", done: false }));
  if (activeShift?.ends_at) tl.push({ hm: fmtTime(activeShift.ends_at), label: "End-of-shift handover", kind: "event", done: activeShift.status === "completed" });
  tl.sort((a, b) => a.hm.localeCompare(b.hm));

  // Upcoming events — planned rounds still ahead (real; other calendar items not backed).
  const upcoming = rounds.filter((r: any) => (r.at_time ?? "") > fmtTime(nowIso)).slice(0, 4);

  // ── Operational Copilot ──────────────────────────────────────────────────
  const copilot: { text: string; action: string; href: string }[] = [];
  const heavy = [...assignments.reduce((m: Map<string, number>, a: any) => m.set(a.profiles?.full_name ?? a.staff_id, (m.get(a.profiles?.full_name ?? a.staff_id) ?? 0) + 1), new Map()).entries()].sort((a, b) => b[1] - a[1])[0];
  if (heavy && heavy[1] >= 6) copilot.push({ text: `${heavy[0]} is carrying ${heavy[1]} patients — consider redeploying to balance workload.`, action: "View Recommendation", href: "/supervisor/operations?section=assignments" });
  deteriorating.slice(0, 1).forEach((o: any) => copilot.push({ text: `Deterioration — ${o.op_patients?.label ?? "patient"} (PEWS ${o.ews_score}). Escalate for review.`, action: "View Recommendation", href: "/supervisor/operations?section=safety" }));
  if (absent.length) copilot.push({ text: `Reassign ${absent.length} absent staff member${absent.length > 1 ? "s" : ""} to maintain coverage.`, action: "View Recommendation", href: "/supervisor/operations?section=assignments" });
  if (occPct >= 85) copilot.push({ text: `Capacity ${occPct}% — plan proactively for incoming admissions.`, action: "View Recommendation", href: "/supervisor/operations?section=ward" });

  // ── KPI strip ────────────────────────────────────────────────────────────
  const kpis: { label: string; value: string; sub: string; tone?: string; href: string }[] = [
    { label: "Patients", value: String(census), sub: `${highShare}% high acuity`, href: "/supervisor/patient-list" },
    { label: "Acuity", value: acuityLabel, sub: `${highAcuity} high acuity`, tone: acuityLabel === "High" ? "text-rose-600" : acuityLabel === "Medium" ? "text-amber-600" : "text-green-600", href: "/supervisor/patient-ops" },
    { label: "Staff on Duty", value: `${present.length} / ${rostered.length}`, sub: staffPct == null ? "—" : `${staffPct}% of planned`, tone: staffPct != null && staffPct < 90 ? "text-amber-600" : undefined, href: "/supervisor/workforce-operations" },
    { label: "Tasks", value: String(taskOpen), sub: `${taskOverdue} overdue`, tone: taskOverdue ? "text-rose-600" : undefined, href: "/supervisor/task-center" },
    { label: "Observations", value: obsCompliance == null ? "—" : `${obsCompliance}%`, sub: "Compliance", tone: obsCompliance != null && obsCompliance < 90 ? "text-amber-600" : "text-green-600", href: "/supervisor/operations?section=safety" },
    { label: "Escalations", value: String(openEsc.length), sub: `${escHigh} high priority`, tone: openEsc.length ? "text-amber-600" : undefined, href: "/supervisor/operations?section=safety" },
  ];

  const quickActions = [
    { icon: "🧭", label: "Patient Ops", href: "/supervisor/patient-ops" },
    { icon: "➕", label: "New Task", href: "/supervisor/task-center" },
    { icon: "👥", label: "Assign Staff", href: "/supervisor/operations?section=assignments" },
    { icon: "⬆️", label: "Escalate", href: "/supervisor/operations?section=safety" },
    { icon: "💬", label: "Send Message", href: "/supervisor/communication" },
    { icon: "🛏️", label: "Bed Board", href: "/supervisor/bed-management" },
    { icon: "🧩", label: "Staff Allocation", href: "/supervisor/workforce-operations" },
    { icon: "📈", label: "Reports", href: "/supervisor/analytics" },
  ];

  const staffingRows = [...new Set([...Object.keys(roleMix), ...ratioRows.map((r: any) => r.role)])].map((r) => ({
    role: r, present: (roleMix as any)[r] ?? 0, required: ratioRows.find((x: any) => x.role === r)?.required as number | undefined,
  }));

  const taskDonut = (() => {
    const segs = [["#14b8a6", tasksDone], ["#3b82f6", taskInProgress], ["#f43f5e", taskOverdue], ["#e5e7eb", taskOther]] as [string, number][];
    const tot = tasksDone + taskInProgress + taskOverdue + taskOther || 1;
    let acc = 0; const stops: string[] = [];
    segs.forEach(([c, n]) => { const a = (acc / tot) * 360, b = ((acc + n) / tot) * 360; if (n) stops.push(`${c} ${a}deg ${b}deg`); acc += n; });
    return stops.length ? `conic-gradient(${stops.join(", ")})` : "conic-gradient(#e5e7eb 0deg 360deg)";
  })();

  const wardStatus = (bed: any) => {
    if (["cleaning", "out_of_service"].includes(bed.status)) return { dot: "bg-gray-300", ring: "border-gray-200 bg-gray-50" };
    if (bed.status === "available") return { dot: "bg-blue-400", ring: "border-blue-200 bg-blue-50/40" };
    const p = patientByBed.get(bed.id);
    if (!p) return { dot: "bg-gray-400", ring: "border-gray-200" };
    if (p.acuity_level === "critical" || p.acuity_level === "high") return { dot: "bg-red-500", ring: "border-red-200 bg-red-50/40" };
    if (p.acuity_level === "moderate") return { dot: "bg-amber-500", ring: "border-amber-200 bg-amber-50/40" };
    return { dot: "bg-green-500", ring: "border-green-200 bg-green-50/30" };
  };

  return (
    <div data-wide className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Shift Supervisor Workspace</h1>
          <p className="text-sm text-gray-500">Real-time operational command for {unitName} · {activeShift ? `${titleCase(activeShift.shift_type)} shift ${fmtTime(activeShift.starts_at)}–${fmtTime(activeShift.ends_at)}` : "no active shift"}</p>
        </div>
        <div className="text-right text-xs text-gray-400 shrink-0">
          <p className="font-medium text-gray-600">{supervisorName}</p>
          <p>{new Date().toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</p>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className={`${card} !p-4 hover:border-teal-300 transition-colors`}>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{k.label}</p>
            <p className={`text-2xl font-bold leading-tight mt-1 ${k.tone ?? "text-gray-900"}`}>{k.value}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{k.sub}</p>
          </Link>
        ))}
      </div>

      {/* SHIFT COMMAND band */}
      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest pt-1">Shift Command</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Current Shift */}
        <div className={card}>
          <h3 className={head}>🩺 Current Shift</h3>
          <p className="text-sm font-semibold text-gray-900 mt-2">{activeShift ? `${titleCase(activeShift.shift_type)} Shift` : "No active shift"}</p>
          <p className="text-[11px] text-gray-400">{activeShift?.starts_at ? `${fmtTime(activeShift.starts_at)} – ${fmtTime(activeShift.ends_at)}` : ""}</p>
          <div className="mt-3 flex items-center justify-center">
            <div className="relative w-28 h-28 rounded-full" style={{ background: elapsedPct != null ? `conic-gradient(#14b8a6 0deg ${elapsedPct * 3.6}deg, #e5e7eb ${elapsedPct * 3.6}deg 360deg)` : "conic-gradient(#e5e7eb 0deg 360deg)" }}>
              <div className="absolute inset-[10px] bg-white rounded-full flex flex-col items-center justify-center">
                <span className="text-lg font-bold text-gray-900 leading-none">{elapsedLabel}</span>
                <span className="text-[9px] text-gray-400">Elapsed</span>
              </div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
            <span className="text-gray-500">Next Handover</span>
            <span className="font-semibold text-gray-900 tabular-nums">{activeShift?.ends_at ? fmtTime(activeShift.ends_at) : "—"}</span>
          </div>
        </div>

        {/* Today's Priorities */}
        <div className={card}>
          <h3 className={head}>⚠️ Today&apos;s Priorities</h3>
          <div className="mt-3 space-y-1.5">
            {achieved.map((t, i) => (
              <div key={`a${i}`} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 w-4 h-4 rounded-full bg-green-500 text-white flex items-center justify-center text-[9px] shrink-0">✓</span>
                <span className="text-gray-500 line-through decoration-gray-300">{t}</span>
              </div>
            ))}
            {openPriorities.slice(0, 6).map((p, i) => (
              <Link key={`o${i}`} href={p.href} className="flex items-start gap-2 text-sm group">
                <span className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 ${p.tone === "red" ? "border-rose-400" : "border-amber-400"}`} />
                <span className="text-gray-800 group-hover:text-teal-700">{p.title}</span>
              </Link>
            ))}
            {achieved.length === 0 && openPriorities.length === 0 && <p className="text-sm text-gray-400">No priorities — the shift is stable.</p>}
          </div>
        </div>

        {/* Critical Alerts */}
        <div className={card}>
          <h3 className={head}>🚨 Critical Alerts <span className="text-rose-600">({criticalAlerts.length})</span></h3>
          <div className="mt-3 space-y-2">
            {criticalAlerts.length === 0 && <p className="text-sm text-gray-400">✅ No critical alerts.</p>}
            {criticalAlerts.slice(0, 5).map((a, i) => (
              <Link key={i} href={a.href} className="flex items-start gap-2 rounded-lg border border-gray-100 hover:border-rose-200 px-2.5 py-1.5">
                <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${a.tone === "red" ? "bg-rose-500" : "bg-amber-500"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-gray-800 leading-tight truncate">{a.title}</span>
                  <span className="block text-[10px] text-gray-400 truncate">{a.sub}</span>
                </span>
                {a.at && <span className="text-[9px] text-gray-400 shrink-0">{relTime(a.at)}</span>}
              </Link>
            ))}
          </div>
          <Link href="/supervisor/operations?section=safety" className="mt-3 block text-center text-xs text-teal-700 hover:underline">View all alerts →</Link>
        </div>

        {/* Shift Timeline */}
        <div className={card}>
          <h3 className={head}>🕑 Shift Timeline</h3>
          <div className="mt-3 space-y-2">
            {tl.length === 0 && <p className="text-sm text-gray-400">No shift events yet.</p>}
            {tl.slice(0, 8).map((e, i) => (
              <div key={i} className="flex items-center gap-2.5 text-sm">
                <span className="text-[11px] text-gray-400 tabular-nums w-10 shrink-0">{e.hm}</span>
                <span className={`w-2 h-2 rounded-full shrink-0 ${e.kind === "round" ? "border border-teal-400" : e.done ? "bg-teal-500" : "border border-gray-300"}`} />
                <span className={`truncate text-xs ${e.kind === "round" ? "text-gray-500" : e.done ? "text-gray-700" : "text-gray-400"}`}>{e.label}{e.kind === "round" && <span className="ml-1 text-[8px] uppercase text-teal-500/70">round</span>}</span>
              </div>
            ))}
          </div>
          <Link href="/supervisor/timeline" className="mt-3 block text-center text-xs text-teal-700 hover:underline">View full timeline →</Link>
        </div>
      </div>

      {/* Quick Actions · AI Copilot · Upcoming Events */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className={`${card} xl:col-span-2`}>
          <h3 className={head}>⚡ Quick Actions</h3>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {quickActions.map((a) => (
              <Link key={a.label} href={a.href} className="flex flex-col items-center gap-1 rounded-lg border border-gray-100 hover:border-teal-300 hover:bg-teal-50/40 p-2.5 transition-colors text-center">
                <span className="text-lg">{a.icon}</span>
                <span className="text-[10px] text-gray-600 leading-tight">{a.label}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className={`${card} bg-gradient-to-br from-violet-50/60 to-white border-violet-100`}>
          <h3 className={head}>✨ AI Copilot <span className="text-[9px] font-bold uppercase bg-violet-100 text-violet-600 rounded px-1 py-0.5">beta</span></h3>
          {copilot.length === 0 ? (
            <p className="text-sm text-gray-400 mt-3">No suggestions — nothing needs attention.</p>
          ) : (
            <>
              <p className="text-xs text-gray-700 mt-3 leading-relaxed">{copilot[0].text}</p>
              <Link href={copilot[0].href} className="mt-3 inline-block text-xs font-semibold text-violet-700 bg-violet-100 hover:bg-violet-200 rounded-lg px-3 py-1.5">{copilot[0].action}</Link>
            </>
          )}
          <Link href="/supervisor/ai" className="mt-3 block text-center text-xs text-teal-700 hover:underline">Ask AI Copilot →</Link>
        </div>

        <div className={card}>
          <h3 className={head}>📅 Upcoming Events</h3>
          <div className="mt-3 space-y-2">
            {upcoming.length === 0 ? <p className="text-sm text-gray-400">No scheduled rounds ahead.</p> : upcoming.map((r: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-[11px] text-gray-400 tabular-nums w-10 shrink-0">{r.at_time}</span>
                <span className="text-gray-700 truncate">{r.label}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Planned rounds from the ward schedule. Meetings &amp; education sessions arrive with the calendar engine.</p>
        </div>
      </div>

      {/* Patient · Staffing · Tasks · Escalations overviews */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className={card}>
          <h3 className={head}>👤 Patient Overview</h3>
          <p className="text-2xl font-bold text-gray-900 mt-2">{census} <span className="text-sm font-normal text-gray-400">patients</span></p>
          <div className="mt-3 space-y-1.5 text-sm">
            {[["High acuity", highAcuity, "bg-rose-500"], ["Medium acuity", medAcuity, "bg-amber-500"], ["Low acuity", lowAcuity, "bg-green-500"], ["Discharges today", byStatus("discharge_pending"), "bg-blue-500"]].map(([l, n, dot]: any) => (
              <div key={l} className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${dot}`} /><span className="text-gray-600 flex-1">{l}</span><span className="font-semibold text-gray-900 tabular-nums">{n}</span></div>
            ))}
          </div>
          <Link href="/supervisor/patient-ops" className="mt-3 block text-center text-xs text-teal-700 hover:underline">View Patient Dashboard →</Link>
        </div>

        <div className={card}>
          <h3 className={head}>🧑‍⚕️ Staffing Overview</h3>
          <p className="text-2xl font-bold text-gray-900 mt-2">{present.length} / {rostered.length} <span className="text-sm font-normal text-gray-400">on duty</span></p>
          <div className="mt-3 space-y-1.5 text-sm">
            {staffingRows.length === 0 && <p className="text-gray-400 text-xs">No staff on the active shift.</p>}
            {staffingRows.map((r) => {
              const short = r.required != null && r.present < r.required;
              return (
                <div key={r.role} className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${short ? "bg-rose-500" : "bg-green-500"}`} />
                  <span className="text-gray-600 flex-1">{titleCase(r.role)}</span>
                  <span className={`font-semibold tabular-nums ${short ? "text-rose-600" : "text-gray-900"}`}>{r.present}{r.required != null && <span className="text-gray-400 font-normal"> / {r.required}</span>}</span>
                </div>
              );
            })}
          </div>
          <Link href="/supervisor/workforce-operations" className="mt-3 block text-center text-xs text-teal-700 hover:underline">View Staffing Dashboard →</Link>
        </div>

        <div className={card}>
          <h3 className={head}>✅ Tasks Overview</h3>
          <div className="mt-3 flex items-center gap-4">
            <div className="relative w-20 h-20 shrink-0 rounded-full" style={{ background: taskDonut }}>
              <div className="absolute inset-[8px] bg-white rounded-full flex flex-col items-center justify-center">
                <span className="text-base font-bold text-gray-900 leading-none">{tasksTotal}</span>
                <span className="text-[8px] text-gray-400">total</span>
              </div>
            </div>
            <div className="text-xs space-y-1 flex-1">
              {[["Completed", tasksDone, "#14b8a6"], ["In progress", taskInProgress, "#3b82f6"], ["Overdue", taskOverdue, "#f43f5e"]].map(([l, n, c]: any) => (
                <div key={l} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c }} /><span className="text-gray-600 flex-1">{l}</span><span className="font-semibold text-gray-800 tabular-nums">{n}</span></div>
              ))}
            </div>
          </div>
          <Link href="/supervisor/task-center" className="mt-3 block text-center text-xs text-teal-700 hover:underline">View Task Center →</Link>
        </div>

        <div className={card}>
          <h3 className={head}>⬆️ Escalations <span className="text-gray-400 font-normal">· {openEsc.length} active</span></h3>
          <div className="mt-3 space-y-1.5 text-sm">
            {[["High priority", escHigh, "bg-rose-500", "text-rose-600"], ["Medium priority", escMed, "bg-amber-500", "text-amber-600"], ["Low priority", escLow, "bg-blue-500", "text-blue-600"]].map(([l, n, dot, tone]: any) => (
              <div key={l} className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${dot}`} /><span className="text-gray-600 flex-1">{l}</span><span className={`font-semibold tabular-nums ${n ? tone : "text-gray-300"}`}>{n}</span></div>
            ))}
          </div>
          <Link href="/supervisor/operations?section=safety" className="mt-3 block text-center text-xs text-teal-700 hover:underline">View Escalation Centre →</Link>
        </div>
      </div>

      {/* Ward Map · Patient Flow · Notifications */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className={`${card} xl:col-span-2`}>
          <h3 className={head}>🗺️ Ward Map <span className="text-gray-400 font-normal">· {unitName}</span> <span className="ml-auto text-[10px] text-green-600 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />Live status</span></h3>
          {beds.length === 0 ? <p className="text-sm text-gray-400 mt-3">No beds configured for this unit.</p> : (
            <>
              <div className="mt-3 grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
                {beds.slice(0, 24).map((b: any) => {
                  const st = wardStatus(b);
                  return (
                    <Link key={b.id} href="/supervisor/ward-map" className={`rounded-lg border ${st.ring} px-1 py-1.5 text-center hover:shadow-sm transition-shadow`}>
                      <p className="text-[10px] font-semibold text-gray-700 truncate">{b.label}</p>
                      <span className={`inline-block w-2 h-2 rounded-full my-0.5 ${st.dot}`} />
                    </Link>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-gray-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Stable</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Review</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> High risk</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" /> Available</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300" /> Not in use</span>
              </div>
            </>
          )}
          <Link href="/supervisor/ward-map" className="mt-3 block text-center text-xs text-teal-700 hover:underline">Open Full Ward Map →</Link>
        </div>

        <div className={card}>
          <h3 className={head}>🔀 Patient Flow</h3>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[["Admissions", byStatus("expected"), "text-green-600"], ["Transfers", byStatus("transfer_pending"), "text-blue-600"], ["Discharges", byStatus("discharge_pending"), "text-violet-600"]].map(([l, n, tone]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-2"><p className={`text-xl font-bold tabular-nums ${tone}`}>{n}</p><p className="text-[9px] text-gray-500">{l}</p></div>
            ))}
          </div>
          <div className="mt-3 space-y-1.5 text-xs">
            <div className="flex justify-between"><span className="text-gray-500">Occupancy</span><span className="font-semibold text-gray-800">{occPct}%</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Critical patients</span><span className={`font-semibold ${critical ? "text-rose-600" : "text-gray-800"}`}>{critical}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Isolation</span><span className={`font-semibold ${isolation ? "text-purple-600" : "text-gray-800"}`}>{isolation}</span></div>
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Live census movement. Transfer in/out split arrives with directional flow tracking.</p>
        </div>

        <div className={card}>
          <h3 className={head}>🔔 Notifications <span className="text-gray-400 font-normal">· {unreadList.length}</span></h3>
          <div className="mt-3 space-y-2">
            {unreadList.length === 0 ? <p className="text-sm text-gray-400">✅ You&apos;re all caught up.</p> : unreadList.map((n: any, i: number) => (
              <Link key={i} href={n.href ?? "/supervisor/communication"} className="flex items-start gap-2 rounded-lg hover:bg-gray-50 px-2 py-1.5">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-gray-800 leading-tight truncate">{n.title}</span>
                  <span className="block text-[10px] text-gray-400">{relTime(n.created_at)}</span>
                </span>
              </Link>
            ))}
          </div>
          <Link href="/supervisor/communication" className="mt-3 block text-center text-xs text-teal-700 hover:underline">View all notifications →</Link>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Shift Command is Mission Control for the shift — every figure is live from the Clinical Operations Engine (op_*): census &amp; acuity, staff on duty, task and observation status, escalations, capacity and flow. Priorities blend achieved milestones (from real state) with open actions; the AI copilot and critical alerts are rule-based over live data. Per-metric trend sparklines, transfer in/out direction, and a shift-goal library aren&apos;t backed by the current schema and are shown as honest states rather than fabricated.</p>
    </div>
  );
}
