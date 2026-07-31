import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadOperationalCommand } from "@/lib/operations/ops-command";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../UnitFilters";

export const dynamic = "force-dynamic";

// UMW-OPC-001 Operational Command Dashboard — the Unit Manager's single real-time operational picture, aligned to
// the command-centre mockup (dark wallboard surface). Read-only manager lens over the live operational stores
// (op_beds / op_patients / op_shifts+op_shift_staff / op_escalations / op_safety_alerts / op_tasks /
// op_flow_blockers / op_ops_snapshots / op_movement_events). Live execution stays in the SSW. Gate
// hospital_admin/super_admin. AI & Config are now separate UMW-AI / UMW-CFG sections (spec: removed from OPC).
/* eslint-disable @typescript-eslint/no-explicit-any */
const dcard = "bg-slate-800/60 border border-slate-700/70 rounded-xl";
const BED_TONE: Record<string, string> = { high: "bg-[var(--cmp-color-error)]/90 text-white", medium: "bg-[var(--cmp-color-warning)]/90 text-slate-900", low: "bg-[var(--cmp-color-success)]/90 text-slate-900", discharged: "bg-slate-600 text-slate-200", maintenance: "bg-fuchsia-600/80 text-white", available: "bg-slate-700/40 text-slate-400 border border-slate-600" };
const ACUITY = [{ key: "high", label: "High Acuity", color: "#f43f5e" }, { key: "medium", label: "Medium Acuity", color: "#f59e0b" }, { key: "low", label: "Low Acuity", color: "#22c55e" }, { key: "stable", label: "Stable / Discharge", color: "#64748b" }];
const SCHEDULE = [["10:30", "Ward Round", "🔵"], ["11:00", "Discharge Planning Meeting", "🟣"], ["13:00", "MDT Meeting – Complex Cases", "🟢"], ["14:30", "Safety Huddle", "🟠"], ["16:00", "Shift Handover (Day → Eve)", "🔴"]];
const TIMELINE = [["07:00", "Shift Start"], ["07:15", "Handover In"], ["10:00", "Safety Huddle"], ["13:00", "Break Period"], ["16:00", "Evening Prep"], ["19:00", "Handover Out"]];
const QUICK = [{ icon: "➕", label: "Add Task", href: "/unit-manager/action-centre" }, { icon: "⚠️", label: "Escalate", href: "/unit-manager/quality/incidents" }, { icon: "📢", label: "Broadcast", href: "/dashboard/messages" }, { icon: "📝", label: "Note", href: "/unit-manager/action-centre" }, { icon: "📊", label: "Report", href: "/unit-manager/ops-performance" }];
const fmtT = (t: string | null) => { if (!t) return ""; try { return new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

function Donut({ segs, total, centre, sub }: { segs: { n: number; color: string }[]; total: number; centre: any; sub: string }) {
  const R = 42, C = 2 * Math.PI * R, t = total || 1;
  const arr = segs.map((s, i) => ({ ...s, len: (s.n / t) * C, off: segs.slice(0, i).reduce((a, x) => a + (x.n / t) * C, 0) }));
  return (
    <svg width="110" height="110" viewBox="0 0 110 110" className="shrink-0">
      <circle cx="55" cy="55" r={R} fill="none" stroke="#1e293b" strokeWidth="12" />
      {arr.map((s, i) => <circle key={i} cx="55" cy="55" r={R} fill="none" stroke={s.color} strokeWidth="12" strokeDasharray={`${s.len} ${C - s.len}`} strokeDashoffset={-s.off} transform="rotate(-90 55 55)" />)}
      <text x="55" y="52" textAnchor="middle" className="fill-white font-bold" fontSize="20">{centre}</text>
      <text x="55" y="68" textAnchor="middle" className="fill-slate-400" fontSize="9">{sub}</text>
    </svg>
  );
}
function Gauge({ v }: { v: number }) {
  const R = 34, C = Math.PI * R, len = (Math.max(0, Math.min(100, v)) / 100) * C;
  const color = v >= 85 ? "#22c55e" : v >= 70 ? "#84cc16" : v >= 55 ? "#f59e0b" : "#f43f5e";
  return (
    <svg width="90" height="54" viewBox="0 0 90 54"><path d="M 11 48 A 34 34 0 0 1 79 48" fill="none" stroke="#1e293b" strokeWidth="8" strokeLinecap="round" />
      <path d="M 11 48 A 34 34 0 0 1 79 48" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${len} ${C}`} />
      <text x="45" y="44" textAnchor="middle" className="fill-white font-bold" fontSize="18">{v}</text>
    </svg>
  );
}
function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: any; tone?: string }) {
  return <div className={`${dcard} p-3.5`}><p className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-white"}`}>{value}</p>{sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}</div>;
}

export default async function OperationalCommandPage({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  const { dept } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const [d, departments] = await Promise.all([
    loadOperationalCommand(admin, hid, isSuper, dept || null) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const topStrip = (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div><p className="text-[11px] text-gray-400 font-medium">UMW-OPC-001 · Operational Command</p><h1 className="text-xl font-bold text-gray-900">Operational Command Centre</h1></div>
      <UnitFilters departments={departments} />
    </div>
  );
  if (!d.provisioned) return <div className="space-y-4">{topStrip}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operational stores not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply the clinical-operations migrations (038/050) + 101, then seed the ward (scripts/seed-ops-performance.mjs).</p></div></div>;

  const k = d.kpis;
  const staffSegs = [...d.staffing.breakdown.map((b: any) => ({ n: b.n, color: b.color })), { n: d.staffing.vacant ?? 0, color: "#475569" }];

  return (
    <div className="space-y-3">
      {topStrip}

      {/* Dark command surface */}
      <div className="bg-slate-900 rounded-2xl p-4 md:p-5 space-y-4 text-slate-100">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-white">Operational Command Centre</h2>
          <span className="text-[10px] font-semibold text-emerald-300 bg-[var(--cmp-color-success)]/15 rounded px-1.5 py-0.5 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[var(--cmp-color-success)] animate-pulse" />LIVE</span>
          <span className="flex-1" />
          <span className="text-[11px] text-slate-400">{d.asOf ? `as of ${d.asOf}` : "real-time"}</span>
        </div>

        {/* KPI ribbon */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <Kpi label="Total Patients" value={k.totalPatients} sub="in unit" />
          <Kpi label="Occupied Beds" value={`${k.occupiedBeds}/${k.totalBeds}`} sub={`${k.occupancy}% occupancy`} />
          <Kpi label="High Acuity" value={k.highAcuity} sub={`${k.highAcuityPct}% of total`} tone="text-rose-400" />
          <Kpi label="Safety Incidents (24h)" value={k.safetyIncidents} sub="reported" tone={k.safetyIncidents ? "text-amber-400" : "text-white"} />
          <Kpi label="Tasks Outstanding" value={k.tasksOutstanding} sub={`${k.criticalTasks} critical`} tone={k.criticalTasks ? "text-amber-400" : "text-white"} />
          <Kpi label="Staff on Duty" value={`${k.staffOnDuty}${k.staffRequired ? `/${k.staffRequired}` : ""}`} sub={k.coverage != null ? `${k.coverage}% coverage` : "on duty"} />
          <Kpi label="Escalations (24h)" value={k.escalations} sub={k.escalations ? "needs attention" : "clear"} tone={k.escalations ? "text-rose-400" : "text-white"} />
          <div className={`${dcard} p-3.5 flex flex-col items-center justify-center`}><p className="text-[10px] text-slate-400 uppercase tracking-wide self-start">Unit Health</p><Gauge v={k.health} /><p className="text-[10px] text-emerald-300 -mt-1">{k.healthLabel}</p></div>
        </div>

        {/* Row 2: bed grid + acuity + capacity + alerts */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <div className={`${dcard} p-4 xl:col-span-2`}>
            <h3 className="text-sm font-semibold text-white mb-3">Unit Status Overview</h3>
            {d.bedGrid.length ? (
              <div className="grid grid-cols-5 sm:grid-cols-8 gap-1.5">
                {d.bedGrid.map((b: any) => <div key={b.label} title={b.patient ?? b.label} className={`aspect-square rounded-md flex items-center justify-center text-[10px] font-semibold ${BED_TONE[b.tone]}`}>{String(b.label).replace(/\D/g, "").slice(-3) || b.label}</div>)}
              </div>
            ) : <p className="text-xs text-slate-400 py-6 text-center">No beds configured for this unit.</p>}
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[10px] text-slate-400">
              {ACUITY.map(a => <span key={a.key} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: a.color }} />{a.label}</span>)}
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-fuchsia-500" />Maintenance</span>
            </div>
          </div>

          <div className={`${dcard} p-4`}>
            <h3 className="text-sm font-semibold text-white mb-3">Patient Acuity</h3>
            <div className="flex items-center gap-3">
              <Donut segs={ACUITY.map(a => ({ n: d.acuity[a.key], color: a.color }))} total={d.acuity.total} centre={d.acuity.total} sub="Total" />
              <div className="space-y-1 text-[11px] flex-1">{ACUITY.map(a => <div key={a.key} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: a.color }} /><span className="text-slate-300 flex-1">{a.label.split(" ")[0]}</span><span className="font-semibold text-white">{d.acuity[a.key]}</span></div>)}</div>
            </div>
          </div>

          <div className={`${dcard} p-4`}>
            <h3 className="text-sm font-semibold text-white mb-3">Capacity &amp; Flow</h3>
            <div className="space-y-1.5 text-[12px]">
              {[["Available Beds", d.capacity.available], ["Beds Cleaning", d.capacity.cleaning], ["Expected Discharges", d.capacity.expectedDischarges], ["Expected Admissions", d.capacity.expectedAdmissions], ["ED Boarding (h)", d.capacity.edWaiting], ["Discharge Delays", d.capacity.dischargeDelays]].map(([l, v]: any) => (
                <div key={l} className="flex items-center justify-between"><span className="text-slate-400">{l}</span><span className="font-semibold text-white tabular-nums">{v ?? "—"}</span></div>
              ))}
            </div>
          </div>
        </div>

        {/* Row 3: alerts + staffing + schedule + tasks */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <div className={`${dcard} p-4`}>
            <h3 className="text-sm font-semibold text-white mb-3">Critical Alerts</h3>
            {d.alerts.length ? <div className="space-y-2">{d.alerts.map((a: any, i: number) => (
              <div key={i} className="flex items-start gap-2"><span className="text-sm shrink-0">{a.icon}</span><div className="min-w-0 flex-1"><p className="text-[12px] text-slate-200 leading-tight">{a.title}</p><p className="text-[10px] text-slate-500">{a.sub}{a.at ? ` · ${fmtT(a.at)}` : ""}</p></div></div>
            ))}</div> : <p className="text-xs text-slate-400 py-4 text-center">No active alerts. ✅</p>}
          </div>

          <div className={`${dcard} p-4`}>
            <h3 className="text-sm font-semibold text-white mb-3">Staffing &amp; Assignment</h3>
            <div className="flex items-center gap-3">
              <Donut segs={staffSegs} total={(d.staffing.onDuty) + (d.staffing.vacant ?? 0)} centre={d.staffing.required ? `${d.staffing.onDuty}/${d.staffing.required}` : d.staffing.onDuty} sub="On Duty" />
              <div className="space-y-1 text-[11px] flex-1">{d.staffing.breakdown.map((b: any) => <div key={b.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: b.color }} /><span className="text-slate-300 flex-1 truncate">{b.label}</span><span className="font-semibold text-white">{b.n}</span></div>)}<div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-500" /><span className="text-slate-300 flex-1">Vacant</span><span className="font-semibold text-rose-400">{d.staffing.vacant ?? "—"}</span></div></div>
            </div>
          </div>

          <div className={`${dcard} p-4`}>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-white">Today&apos;s Schedule</h3><span className="text-[9px] text-slate-500">template</span></div>
            <div className="space-y-2">{SCHEDULE.map(([t, title, dot]) => <div key={t} className="flex gap-2.5 text-[11px]"><span className="text-slate-400 tabular-nums w-11 shrink-0">{t}</span><span className="text-slate-200">{dot} {title}</span></div>)}</div>
          </div>

          <div className={`${dcard} p-4`}>
            <h3 className="text-sm font-semibold text-white mb-3">Task Summary</h3>
            <div className="space-y-1.5 text-[12px]">
              {[["Critical", d.taskSummary.critical, "#f43f5e"], ["High", d.taskSummary.high, "#f59e0b"], ["Medium", d.taskSummary.medium, "#eab308"], ["Low", d.taskSummary.low, "#22c55e"]].map(([l, v, c]: any) => (
                <div key={l} className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: c }} /><span className="text-slate-400 flex-1">{l}</span><span className="font-semibold text-white tabular-nums">{v}</span></div>
              ))}
              <Link href="/unit-manager/action-centre" className="block text-center text-[11px] font-medium text-blue-400 hover:underline pt-1">View all tasks →</Link>
            </div>
          </div>
        </div>

        {/* Row 4: forecast + timeline + quick actions + activity */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <div className={`${dcard} p-4 xl:col-span-2`}>
            <h3 className="text-sm font-semibold text-white mb-3">Operational Forecast</h3>
            {d.forecast.length >= 2 ? (
              <div className="space-y-2">
                {d.forecast.map((f: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]"><span className="text-slate-400 w-20 shrink-0">{f.label}</span><div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden"><div className="h-full rounded-full bg-[var(--cmp-color-information)]" style={{ width: `${f.occupancy ?? 0}%` }} /></div><span className="text-slate-300 w-28 text-right">{f.occupancy}% occ · +{f.admissions ?? 0} / -{f.discharges ?? 0}</span></div>
                ))}
                <p className="text-[9px] text-slate-500">Recent daily snapshots (occupancy · admissions / discharges).</p>
              </div>
            ) : <p className="text-xs text-slate-400 py-6 text-center">Forecast needs daily snapshots (seed op_ops_snapshots).</p>}
          </div>

          <div className={`${dcard} p-4`}>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-white">Shift Timeline</h3><span className="text-[9px] text-slate-500">template</span></div>
            <div className="flex items-center justify-between">{TIMELINE.map(([t, l], i) => <div key={t} className="flex flex-col items-center text-center"><span className={`w-2.5 h-2.5 rounded-full ${i <= 2 ? "bg-[var(--cmp-color-success)]" : "bg-slate-600"}`} /><span className="text-[8px] text-slate-400 mt-1">{t}</span><span className="text-[7px] text-slate-500 leading-tight w-12">{l}</span></div>)}</div>
            <div className="mt-3 grid grid-cols-5 gap-1.5">{QUICK.map(a => <Link key={a.label} href={a.href} className="flex flex-col items-center gap-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 p-1.5"><span className="text-sm">{a.icon}</span><span className="text-[7px] text-slate-300 text-center leading-tight">{a.label}</span></Link>)}</div>
          </div>

          <div className={`${dcard} p-4`}>
            <h3 className="text-sm font-semibold text-white mb-3">Recent Activity</h3>
            {d.activity.length ? <div className="space-y-2">{d.activity.map((a: any, i: number) => (
              <div key={i} className="flex items-start gap-2"><span className="w-1.5 h-1.5 rounded-full bg-[var(--cmp-color-information)] mt-1.5 shrink-0" /><div className="min-w-0"><p className="text-[11px] text-slate-300 leading-tight capitalize truncate">{a.text}</p><p className="text-[9px] text-slate-500">{fmtT(a.at)}</p></div></div>
            ))}</div> : <p className="text-xs text-slate-400 py-4 text-center">No recent movement events.</p>}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400">UMW-OPC-001 — the Unit Manager&apos;s real-time operational picture over the live SSW/operational stores (read-only lens; live execution stays in the Shift Supervisor Workspace). Schedule + shift-timeline are template-based; everything else is your unit&apos;s real data. AI &amp; Configuration are now separate UMW-AI / UMW-CFG sections.</p>
    </div>
  );
}
