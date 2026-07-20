import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

export const dynamic = "force-dynamic";

// Shift Command Centre (SSW-001) — action-first operational command surface for
// the shift supervisor, assembled entirely from live Clinical Operations Engine
// (op_*) data. Widgets show only what the schema backs; capabilities that need
// engines we don't yet feed (medication variance, mandatory-ratio targets) are
// left out rather than fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const pretty = (s: string) => (s ?? "").replace(/_/g, " ");
const titleCase = (s: string) => pretty(s).split(" ").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "--:--";
const card = "bg-white rounded-xl border border-gray-200 p-5";
const head = "font-semibold text-gray-900 flex items-center gap-2";

export default async function ShiftCommandCentre() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id, avatar_url").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const { ready, data } = await loadOpsConsoleData(admin, hid, isSuper);

  if (!ready) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Shift Command Centre</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <p className="font-semibold text-amber-900">⚙️ Coming online</p>
          <p className="text-sm text-amber-800 mt-2">The Clinical Operations Engine tables aren&apos;t provisioned yet (migrations 038 &amp; 039). Once applied, this command centre fills with your live shift data.</p>
        </div>
      </div>
    );
  }

  const { shifts, shiftStaff, beds, patients, assignments, escalations, alerts, tasks, observations } = data;
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // ── Shift & staff ────────────────────────────────────────────────────────
  const activeShift = shifts.find((s: any) => s.status === "active") ?? shifts.find((s: any) => s.status === "planned") ?? null;
  const shiftId = activeShift?.id ?? null;
  const rostered = activeShift ? shiftStaff.filter((s: any) => s.shift_id === activeShift.id) : [];
  const present = rostered.filter((s: any) => ["on_duty", "confirmed", "assigned"].includes(s.status));
  const absent = rostered.filter((s: any) => s.status === "absent");
  const roleMix = present.reduce((m: Record<string, number>, s: any) => ({ ...m, [s.role]: (m[s.role] ?? 0) + 1 }), {});
  const supervisorName = activeShift?.profiles?.full_name ?? profile?.full_name ?? "—";
  const unitName = activeShift?.departments?.name ?? "Unit";

  // Extra queries — task completion is scoped to the ACTIVE SHIFT with cancelled
  // tasks excluded from the denominator; the message count is an exact unread count.
  const tScope = (q: any) => (shiftId ? q.eq("shift_id", shiftId) : scope(q));
  const [handoverRes, unreadRes, tasksTotalRes, tasksDoneRes] = await Promise.all([
    scope(admin.from("op_handovers").select("status, accepted_at, created_at")).order("created_at", { ascending: false }).limit(5),
    admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("read", false),
    tScope(admin.from("op_tasks").select("id", { count: "exact", head: true })).neq("status", "cancelled"),
    tScope(admin.from("op_tasks").select("id", { count: "exact", head: true })).in("status", ["completed", "verified"]),
  ]);
  const handovers = handoverRes.data ?? [];
  const unreadNotif = unreadRes.count ?? 0;
  const tasksTotal = tasksTotalRes.count ?? 0;
  const tasksDone = tasksDoneRes.count ?? 0;

  // ── Ward configuration (mandatory staffing standards + round schedule) ───
  // Feeds the Workforce ratio-compliance figure and the Timeline's planned
  // rounds. Defensive: these tables exist only after migration 046 is applied.
  const [stdRes, roundRes] = await Promise.all([
    scope(admin.from("op_staffing_standards").select("shift_type, department_id, role, min_count, target_ratio")),
    scope(admin.from("op_round_schedule").select("shift_type, department_id, at_time, label")),
  ]);
  const applies = (row: any) =>
    (row.shift_type === "any" || !activeShift || row.shift_type === activeShift.shift_type) &&
    (row.department_id == null || !activeShift?.department_id || row.department_id === activeShift.department_id);
  const standards = ((stdRes as any).error ? [] : ((stdRes.data ?? []) as any[])).filter(applies);
  const rounds = ((roundRes as any).error ? [] : ((roundRes.data ?? []) as any[])).filter(applies);
  const ratioRows = standards.map((s: any) => ({ role: s.role, required: s.min_count, present: (roleMix as any)[s.role] ?? 0 }));
  const ratioMet = ratioRows.filter((r: any) => r.present >= r.required).length;
  const ratioCompliance = ratioRows.length ? Math.round((ratioMet / ratioRows.length) * 100) : null;
  const workRoles = [...new Set([...Object.keys(roleMix), ...ratioRows.map((r: any) => r.role)])];
  const requiredFor = (role: string) => ratioRows.find((r: any) => r.role === role)?.required;

  // ── Patients ─────────────────────────────────────────────────────────────
  const census = patients.length;
  const byStatus = (s: string) => patients.filter((p: any) => p.operational_status === s).length;
  const byAcuity = (a: string) => patients.filter((p: any) => p.acuity_level === a).length;
  const isolation = patients.filter((p: any) => p.isolation_status && p.isolation_status !== "none").length;
  const critical = byAcuity("critical");

  // ── Safety ───────────────────────────────────────────────────────────────
  const alertCat = (c: string) => alerts.filter((a: any) => a.category === c).length;
  const openEsc = escalations.filter((e: any) => ["open", "acknowledged"].includes(e.status));
  const rapid = escalations.filter((e: any) => e.level >= 4);
  // Distinct deteriorating patients — the LATEST observation per patient with a
  // PEWS/EWS >= 5 (not every historical high row), matching the nurse workspace.
  const latestObs = new Map<string, any>();
  observations.forEach((o: any) => {
    const t = new Date(o.recorded_at ?? o.created_at ?? 0).getTime();
    const cur = latestObs.get(o.patient_id);
    if (!cur || t > cur._t) latestObs.set(o.patient_id, { ...o, _t: t });
  });
  const deteriorating = [...latestObs.values()].filter((o: any) => o.ews_score != null && o.ews_score >= 5);

  // ── Observations & performance (compliance scoped to the active shift) ────
  const overdueCount = observations.filter((o: any) => o.status === "overdue").length;
  const shiftObs = shiftId ? observations.filter((o: any) => o.shift_id === shiftId) : observations;
  const soRecorded = shiftObs.filter((o: any) => o.status === "recorded").length;
  const soPending = shiftObs.filter((o: any) => ["due", "overdue"].includes(o.status)).length;
  const obsCompliance = (soRecorded + soPending) ? Math.round((soRecorded / (soRecorded + soPending)) * 100) : null;
  const taskCompletion = tasksTotal ? Math.round((tasksDone / tasksTotal) * 100) : null;
  const compValidated = assignments.filter((a: any) => a.competency_validated).length;
  const compCoverage = assignments.length ? Math.round((compValidated / assignments.length) * 100) : null;

  // ── Beds / capacity ──────────────────────────────────────────────────────
  const bedBy = (s: string) => beds.filter((b: any) => b.status === s).length;
  const totalBeds = beds.length;
  const occupied = bedBy("occupied"), available = bedBy("available"), reserved = bedBy("reserved"), cleaning = bedBy("cleaning"), maintenance = bedBy("out_of_service");
  const occPct = totalBeds ? Math.round((occupied / totalBeds) * 100) : 0;
  const patientByBed = new Map<string, any>();
  patients.forEach((p: any) => { if (p.bed_id) patientByBed.set(p.bed_id, p); });

  // ── Handover ─────────────────────────────────────────────────────────────
  const latestHandover = handovers[0] ?? null;
  const handoverDone = latestHandover?.status === "accepted";

  // ── Today's Priorities (action-first, ranked, only when backed) ──────────
  const priorities: { tone: string; title: string; sub?: string; href: string }[] = [];
  rapid.slice(0, 3).forEach((e: any) => priorities.push({ tone: "red", title: `Respond — ${e.op_patients?.label ?? "patient"} · L${e.level}`, sub: e.summary, href: "/supervisor/operations?section=safety" }));
  if (overdueCount > 0) priorities.push({ tone: "amber", title: `PEWS review overdue — ${overdueCount} observation${overdueCount > 1 ? "s" : ""}`, sub: "Overdue clinical observations", href: "/supervisor/operations?section=safety" });
  if (absent.length > 0) priorities.push({ tone: "amber", title: `Allocate cover — ${absent.length} staff absent`, sub: "Rostered but not on duty", href: "/supervisor/operations?section=assignments" });
  if (!handoverDone) priorities.push({ tone: "amber", title: "Complete handover", sub: latestHandover ? `Status: ${pretty(latestHandover.status)}` : "No accepted handover recorded", href: "/supervisor/handover" });
  openEsc.filter((e: any) => e.level < 4).slice(0, 2).forEach((e: any) => priorities.push({ tone: "amber", title: `Review escalation — ${e.op_patients?.label ?? "patient"} · L${e.level}`, sub: e.summary, href: "/supervisor/operations?section=safety" }));
  tasks.filter((t: any) => t.priority === "urgent").slice(0, 2).forEach((t: any) => priorities.push({ tone: "amber", title: t.description, sub: `Urgent · ${t.op_patients?.label ?? "unassigned"}`, href: "/supervisor/operations?section=care" }));

  // ── Shift Timeline (real events + planned rounds from ward config) ───────
  type TlItem = { hm: string; label: string; kind: "event" | "round"; done: boolean };
  const tl: TlItem[] = [];
  if (activeShift?.starts_at) tl.push({ hm: fmtTime(activeShift.starts_at), label: "Shift started", kind: "event", done: activeShift.status !== "planned" });
  if (latestHandover?.accepted_at) tl.push({ hm: fmtTime(latestHandover.accepted_at), label: "Handover accepted", kind: "event", done: true });
  escalations.slice(0, 3).forEach((e: any) => e.created_at && tl.push({ hm: fmtTime(e.created_at), label: `Escalation — ${e.op_patients?.label ?? "patient"}`, kind: "event", done: true }));
  observations.filter((o: any) => o.status === "recorded" && o.recorded_at).slice(0, 2).forEach((o: any) => tl.push({ hm: fmtTime(o.recorded_at), label: `Observation — ${o.op_patients?.label ?? "patient"}`, kind: "event", done: true }));
  rounds.forEach((r: any) => tl.push({ hm: r.at_time, label: r.label, kind: "round", done: false }));
  if (activeShift?.ends_at) tl.push({ hm: fmtTime(activeShift.ends_at), label: "Shift close", kind: "event", done: activeShift.status === "completed" });
  tl.sort((a, b) => a.hm.localeCompare(b.hm));

  // ── Workforce Assignment (staff → their patients/beds) ───────────────────
  const byStaff = new Map<string, { name: string; patients: any[] }>();
  assignments.forEach((a: any) => {
    const key = a.staff_id;
    if (!byStaff.has(key)) byStaff.set(key, { name: a.profiles?.full_name ?? "Staff", patients: [] });
    byStaff.get(key)!.patients.push(a);
  });
  const assignmentRows = [...byStaff.values()].slice(0, 8);

  // ── Action Centre (real, actionable) ─────────────────────────────────────
  const actionItems = [
    { label: "Late observations", n: overdueCount, href: "/supervisor/operations?section=safety", tone: overdueCount ? "text-orange-600" : "text-gray-400" },
    { label: "Open escalations", n: openEsc.length, href: "/supervisor/operations?section=safety", tone: openEsc.length ? "text-red-600" : "text-gray-400" },
    { label: "Active incidents", n: alerts.length, href: "/supervisor/operations?section=safety", tone: alerts.length ? "text-orange-600" : "text-gray-400" },
    { label: "Urgent tasks", n: tasks.filter((t: any) => t.priority === "urgent").length, href: "/supervisor/operations?section=care", tone: "text-gray-700" },
    { label: "Unread notifications", n: unreadNotif, href: "/supervisor/communication", tone: unreadNotif ? "text-teal-600" : "text-gray-400" },
  ];

  // ── Operational Copilot (rule-based suggestions from live data) ──────────
  const copilot: { text: string; action: string; href: string }[] = [];
  observations.filter((o: any) => o.status === "overdue").slice(0, 2).forEach((o: any) => copilot.push({ text: `Observation overdue — ${o.op_patients?.label ?? "patient"}`, action: "Review", href: "/supervisor/operations?section=safety" }));
  deteriorating.slice(0, 2).forEach((o: any) => copilot.push({ text: `Deterioration — ${o.op_patients?.label ?? "patient"} (PEWS ${o.ews_score})`, action: "Escalate", href: "/supervisor/operations?section=safety" }));
  if (absent.length) copilot.push({ text: `Reassign ${absent.length} absent staff member${absent.length > 1 ? "s" : ""}`, action: "Assign", href: "/supervisor/operations?section=assignments" });
  if (byStatus("discharge_pending")) copilot.push({ text: `${byStatus("discharge_pending")} discharge${byStatus("discharge_pending") > 1 ? "s" : ""} pending — free capacity`, action: "Review", href: "/supervisor/operations?section=ward" });
  if (occPct >= 85) copilot.push({ text: `Capacity ${occPct}% — plan for admissions`, action: "Plan", href: "/supervisor/operations?section=ward" });

  const donut = totalBeds ? (() => {
    const segs = [["#14b8a6", occupied], ["#86efac", available], ["#c4b5fd", reserved], ["#fdba74", cleaning], ["#cbd5e1", maintenance]] as [string, number][];
    let acc = 0; const stops: string[] = [];
    segs.forEach(([c, n]) => { const a = (acc / totalBeds) * 360, b = ((acc + n) / totalBeds) * 360; if (n) stops.push(`${c} ${a}deg ${b}deg`); acc += n; });
    return `conic-gradient(${stops.join(", ")})`;
  })() : "conic-gradient(#e5e7eb 0deg 360deg)";

  const wardStatus = (bed: any) => {
    if (["cleaning", "out_of_service"].includes(bed.status)) return { label: "Not in use", dot: "bg-gray-300", ring: "border-gray-200 bg-gray-50" };
    if (bed.status === "available") return { label: "Available", dot: "bg-blue-400", ring: "border-blue-200 bg-blue-50/40" };
    const p = patientByBed.get(bed.id);
    if (!p) return { label: "Occupied", dot: "bg-gray-400", ring: "border-gray-200" };
    if (p.acuity_level === "critical" || p.acuity_level === "high") return { label: "High risk", dot: "bg-red-500", ring: "border-red-200 bg-red-50/40" };
    if (p.acuity_level === "moderate") return { label: "Review", dot: "bg-amber-500", ring: "border-amber-200 bg-amber-50/40" };
    return { label: "Stable", dot: "bg-green-500", ring: "border-green-200 bg-green-50/30" };
  };

  const bannerCells: { label: string; value: string; sub?: string; tone?: string }[] = [
    { label: "Shift Status", value: activeShift ? titleCase(activeShift.shift_type) + " Shift" : "No active shift", sub: activeShift?.starts_at ? `${fmtTime(activeShift.starts_at)} – ${fmtTime(activeShift.ends_at)}` : "", tone: activeShift?.status === "active" ? "text-green-600" : "text-gray-500" },
    { label: "Unit / Ward", value: unitName },
    { label: "Supervisor", value: supervisorName, sub: "Shift Supervisor" },
    { label: "Staff", value: `${present.length} / ${rostered.length}`, sub: "Present" },
    { label: "Patients", value: String(census), sub: "In care" },
    { label: "Open Alerts", value: String(alerts.length), sub: "Require attention", tone: alerts.length ? "text-red-600" : undefined },
    { label: "Escalations", value: String(openEsc.length), sub: "Active", tone: openEsc.length ? "text-amber-600" : undefined },
    { label: "Handover", value: handoverDone ? "Completed" : (latestHandover ? titleCase(latestHandover.status) : "Pending"), sub: latestHandover?.accepted_at ? fmtTime(latestHandover.accepted_at) : "", tone: handoverDone ? "text-green-600" : "text-gray-500" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shift Command Centre</h1>
          <p className="text-sm text-gray-500 mt-1">Real-time operational control for your shift</p>
        </div>
        <div className="text-right text-xs text-gray-400 shrink-0">
          <p>{new Date().toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}</p>
          <p>All times real-time · Auto-refresh on reload</p>
        </div>
      </div>

      {/* Shift Status Banner */}
      <div className="bg-white rounded-xl border border-gray-200 px-2 py-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
          {bannerCells.map((c, i) => (
            <div key={i} className="px-3 py-2">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{c.label}</p>
              <p className={`text-sm font-bold leading-tight mt-0.5 ${c.tone ?? "text-gray-900"}`}>{c.value}</p>
              {c.sub && <p className="text-[11px] text-gray-400 leading-tight">{c.sub}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Row: Priorities · Timeline · Workforce · Patient Ops */}
      <div className="grid lg:grid-cols-2 xl:grid-cols-4 gap-5">
        <div id="priorities" className={card}>
          <h3 className={head}>⚠️ Today&apos;s Priorities</h3>
          <div className="mt-3 space-y-1.5">
            {priorities.length === 0 && <p className="text-sm text-gray-400">No priority actions — the shift is stable.</p>}
            {priorities.slice(0, 7).map((p, i) => (
              <Link key={i} href={p.href} className="flex items-start gap-2 rounded-lg border border-gray-100 hover:border-teal-300 hover:bg-teal-50/30 px-2.5 py-2 transition-colors">
                <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${p.tone === "red" ? "bg-red-500" : "bg-amber-500"}`} />
                <span className="min-w-0">
                  <span className="block text-sm text-gray-800 leading-tight">{p.title}</span>
                  {p.sub && <span className="block text-[11px] text-gray-400 truncate">{p.sub}</span>}
                </span>
              </Link>
            ))}
          </div>
        </div>

        <div id="timeline" className={card}>
          <h3 className={head}>🕑 Shift Timeline</h3>
          <div className="mt-3 space-y-2">
            {tl.length === 0 && <p className="text-sm text-gray-400">No shift events or planned rounds yet.</p>}
            {tl.slice(0, 10).map((e, i) => (
              <div key={i} className="flex items-center gap-2.5 text-sm">
                <span className="text-xs text-gray-400 tabular-nums w-11 shrink-0">{e.hm}</span>
                <span className={`w-2 h-2 rounded-full shrink-0 ${e.kind === "round" ? "border border-teal-400" : e.done ? "bg-teal-500" : "border border-gray-300"}`} />
                <span className={`truncate ${e.kind === "round" ? "text-gray-600" : e.done ? "text-gray-700" : "text-gray-400"}`}>{e.label}{e.kind === "round" && <span className="ml-1.5 text-[9px] uppercase tracking-wide text-teal-500/70">round</span>}</span>
              </div>
            ))}
          </div>
        </div>

        <div id="workforce" className={card}>
          <h3 className={head}>👥 Workforce Operations</h3>
          <div className="mt-3 space-y-1.5">
            {workRoles.length === 0 && <p className="text-sm text-gray-400">No staff on the active shift.</p>}
            {workRoles.map((r) => {
              const pc = (roleMix as any)[r] ?? 0; const req = requiredFor(r); const short = req != null && pc < req;
              return (
                <div key={r} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{titleCase(r)}</span>
                  <span className={`font-semibold tabular-nums ${short ? "text-red-600" : "text-gray-900"}`}>{pc}{req != null && <span className="text-gray-400 font-normal"> / {req}</span>}</span>
                </div>
              );
            })}
          </div>
          <div className={`mt-3 pt-3 border-t border-gray-100 grid ${ratioCompliance != null ? "grid-cols-3" : "grid-cols-2"} gap-2 text-center`}>
            {ratioCompliance != null && <div><p className={`text-lg font-bold ${ratioCompliance < 100 ? "text-amber-600" : "text-green-600"}`}>{ratioCompliance}%</p><p className="text-[10px] text-gray-500">Mandatory ratios</p></div>}
            <div><p className={`text-lg font-bold ${compCoverage != null && compCoverage < 90 ? "text-amber-600" : "text-green-600"}`}>{compCoverage != null ? `${compCoverage}%` : "—"}</p><p className="text-[10px] text-gray-500">Competency-validated</p></div>
            <div><p className="text-lg font-bold text-gray-900">{present.length}<span className="text-gray-300">/</span>{rostered.length}</p><p className="text-[10px] text-gray-500">Present / rostered</p></div>
          </div>
          <Link href="/supervisor/operations?section=assignments" className="mt-3 block text-center text-xs text-teal-700 hover:underline">View assignments &amp; skill mix →</Link>
        </div>

        <div className={card}>
          <h3 className={head}>🧭 Patient Operations</h3>
          <div className="mt-3 space-y-1.5 text-sm">
            {[
              ["Expected admissions", byStatus("expected"), "text-gray-700"],
              ["Transfers pending", byStatus("transfer_pending"), "text-gray-700"],
              ["Discharges pending", byStatus("discharge_pending"), "text-gray-700"],
              ["Critical patients", critical, critical ? "text-red-600" : "text-gray-400"],
              ["Isolation patients", isolation, isolation ? "text-purple-600" : "text-gray-400"],
              ["Falls risk", alertCat("fall_risk"), alertCat("fall_risk") ? "text-orange-600" : "text-gray-400"],
              ["Pressure injury risk", alertCat("pressure_injury"), alertCat("pressure_injury") ? "text-orange-600" : "text-gray-400"],
            ].map(([l, n, tone]) => (
              <div key={l as string} className="flex items-center justify-between">
                <span className="text-gray-600">{l as string}</span>
                <span className={`font-semibold tabular-nums ${tone as string}`}>{n as number}</span>
              </div>
            ))}
          </div>
          <Link href="/supervisor/operations?section=ward" className="mt-3 block text-center text-xs text-teal-700 hover:underline">View patient list →</Link>
        </div>
      </div>

      {/* Row: Clinical Safety · Ward Map · Capacity */}
      <div className="grid lg:grid-cols-4 gap-5">
        <div className={card}>
          <h3 className={head}>🛡️ Clinical Safety</h3>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {[
              ["PEWS alerts", deteriorating.length, "text-red-600"],
              ["Deterioration", alertCat("deterioration"), "text-red-600"],
              ["Falls risk", alertCat("fall_risk"), "text-orange-600"],
              ["Pressure injury", alertCat("pressure_injury"), "text-orange-600"],
              ["Medication risks", alertCat("medication"), "text-orange-600"],
              ["Infection", alertCat("infection"), "text-orange-600"],
              ["Isolation", isolation, "text-purple-600"],
              ["Rapid responses", rapid.length, "text-red-600"],
            ].map(([l, n, tone]) => (
              <div key={l as string} className="flex items-center justify-between">
                <span className="text-gray-600">{l as string}</span>
                <span className={`font-semibold tabular-nums ${(n as number) ? (tone as string) : "text-gray-300"}`}>{n as number}</span>
              </div>
            ))}
          </div>
          <Link href="/supervisor/operations?section=safety" className="mt-3 block text-center text-xs text-teal-700 hover:underline">View all safety alerts →</Link>
        </div>

        <div id="ward-map" className={`${card} lg:col-span-2`}>
          <h3 className={head}>🗺️ Ward Map <span className="text-gray-400 font-normal text-sm">· {unitName}</span></h3>
          {beds.length === 0 ? (
            <p className="text-sm text-gray-400 mt-3">No beds configured for this unit.</p>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2">
                {beds.slice(0, 24).map((b: any) => {
                  const st = wardStatus(b); const p = patientByBed.get(b.id);
                  return (
                    <Link key={b.id} href="/supervisor/operations?section=ward" className={`rounded-lg border ${st.ring} px-2 py-2 text-center hover:shadow-sm transition-shadow`}>
                      <p className="text-[11px] font-semibold text-gray-700 truncate">{b.label}</p>
                      <span className={`inline-block w-2 h-2 rounded-full my-1 ${st.dot}`} />
                      <p className="text-[10px] text-gray-500 leading-tight">{st.label}</p>
                      {p?.op_beds && p.acuity_level && <p className="text-[9px] text-gray-400 truncate">{p.label}</p>}
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
        </div>

        <div className={card}>
          <h3 className={head}>📊 Capacity</h3>
          <div className="mt-3 flex items-center gap-4">
            <div className="relative w-24 h-24 shrink-0 rounded-full" style={{ background: donut }}>
              <div className="absolute inset-[10px] bg-white rounded-full flex flex-col items-center justify-center">
                <span className="text-lg font-bold text-gray-900 leading-none">{totalBeds}</span>
                <span className="text-[9px] text-gray-400">beds</span>
              </div>
            </div>
            <div className="text-[11px] space-y-1">
              {[["Occupied", occupied, "#14b8a6"], ["Available", available, "#86efac"], ["Reserved", reserved, "#c4b5fd"], ["Cleaning", cleaning, "#fdba74"], ["Maintenance", maintenance, "#cbd5e1"]].map(([l, n, c]) => (
                <div key={l as string} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: c as string }} />
                  <span className="text-gray-600">{l as string}</span>
                  <span className="ml-auto font-semibold text-gray-800 tabular-nums">{n as number}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-3 text-center">{occPct}% occupancy</p>
        </div>
      </div>

      {/* Row: Action Centre · Workforce Assignment · Shift Performance · Copilot */}
      <div className="grid lg:grid-cols-2 xl:grid-cols-4 gap-5">
        <div className={card}>
          <h3 className={head}>📥 Action Centre</h3>
          <div className="mt-3 space-y-1">
            {actionItems.map(a => (
              <Link key={a.label} href={a.href} className="flex items-center justify-between rounded-lg hover:bg-gray-50 px-2 py-1.5 text-sm">
                <span className="text-gray-600">{a.label}</span>
                <span className={`font-bold tabular-nums ${a.tone}`}>{a.n}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className={card}>
          <h3 className={head}>🧩 Workforce Assignment</h3>
          <div className="mt-3 space-y-1.5">
            {assignmentRows.length === 0 && <p className="text-sm text-gray-400">No active assignments.</p>}
            {assignmentRows.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="font-medium text-gray-800 truncate">{s.name}</span>
                <span className="ml-auto text-xs text-gray-400 shrink-0">{s.patients.length} patient{s.patients.length !== 1 ? "s" : ""}</span>
              </div>
            ))}
          </div>
          <Link href="/supervisor/operations?section=assignments" className="mt-3 block text-center text-xs text-teal-700 hover:underline">Manage assignments →</Link>
        </div>

        <div id="performance" className={card}>
          <h3 className={head}>📈 Shift Performance</h3>
          <div className="mt-3 space-y-3">
            {[["Observation compliance", obsCompliance], ["Task completion", taskCompletion], ["Competency-validated care", compCoverage]].map(([l, v]) => (
              <div key={l as string}>
                <div className="flex justify-between text-xs mb-1"><span className="text-gray-600">{l as string}</span><span className="font-semibold text-gray-800">{v == null ? "—" : `${v}%`}</span></div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${v == null ? "bg-gray-200" : (v as number) >= 90 ? "bg-green-500" : (v as number) >= 75 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${v ?? 0}%` }} />
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Derived live from observations, tasks and competency-validated assignments. Medication &amp; documentation metrics arrive as those engines report.</p>
        </div>

        <div id="copilot" className={card}>
          <h3 className={head}>✨ Operational Copilot</h3>
          <div className="mt-3 space-y-1.5">
            {copilot.length === 0 && <p className="text-sm text-gray-400">No suggested actions — nothing needs attention.</p>}
            {copilot.slice(0, 7).map((c, i) => (
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
