import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadEscalations } from "@/lib/operations/escalations-workspace";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../UnitFilters";
import EscalationActions from "./EscalationActions";

export const dynamic = "force-dynamic";

// Escalations Workspace (UMW-EA-002) — the Unit Manager's operational escalation
// command centre over the real op_escalations store: KPIs, escalation board, review
// panel with rule-based AI risk scoring + recommended actions, analytics, hotspots
// and AI early-warning. Decisions (take action / assign / escalate / resolve) run
// through the audited escalations API. Patient PHI (age/sex) isn't stored → honest.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const SEV: Record<string, string> = { Critical: "bg-rose-50 text-rose-700", High: "bg-amber-50 text-amber-700", Medium: "bg-blue-50 text-blue-700", Low: "bg-green-50 text-green-700" };
const SEV_BAR: Record<string, string> = { Critical: "#ef4444", High: "#f59e0b", Medium: "#3b82f6", Low: "#22c55e" };
const TYPE_COLOR = ["#ef4444", "#3b82f6", "#f59e0b", "#8b5cf6", "#14b8a6", "#6b7280"];
const STATUS_LABEL: Record<string, string> = { open: "Awaiting Review", acknowledged: "In Progress", resolved: "Resolved", cancelled: "Cancelled" };
const DOT: Record<string, string> = { red: "bg-rose-500", amber: "bg-amber-500", blue: "bg-blue-500" };
const elapsed = (m: number) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d`);
const TABS = ["Escalation Overview", "Escalation Board", "My Escalations", "Escalation Timeline", "Escalation Analytics", "Escalation Reports"];

function Kpi({ label, value, sub, tone, icon }: { label: string; value: any; sub?: string; tone?: string; icon?: string }) {
  return <div className={`${card} p-3.5`}><div className="flex items-start justify-between"><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>{icon && <span className="text-sm opacity-50">{icon}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}
function Donut({ segs, total }: { segs: { n: number; color: string }[]; total: number }) {
  const sum = segs.reduce((s, x) => s + x.n, 0) || 1; let acc = 0;
  const stops = segs.map(s => { const a = (acc / sum) * 100; acc += s.n; return `${s.color} ${a}% ${(acc / sum) * 100}%`; }).join(", ");
  return <div className="relative w-24 h-24 shrink-0"><div className="w-24 h-24 rounded-full" style={{ background: sum > 0 ? `conic-gradient(${stops})` : "#f1f5f9" }} /><div className="absolute inset-[22%] rounded-full bg-white flex items-center justify-center"><span className="text-lg font-bold text-gray-900">{total}</span></div></div>;
}
function TimelineChart({ series }: { series: any[] }) {
  const W = 320, H = 120, pad = 8; const n = Math.max(1, series.length);
  const max = Math.max(1, ...series.flatMap(s => [s.opened, s.resolved]));
  const x = (i: number) => pad + (n === 1 ? W / 2 : (i / (n - 1)) * (W - 2 * pad));
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  const line = (k: string, c: string) => <polyline fill="none" stroke={c} strokeWidth="2" points={series.map((s, i) => `${x(i)},${y(s[k])}`).join(" ")} />;
  return <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28">{[0, max].map(g => <line key={g} x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="#f1f5f9" />)}{line("opened", "#ef4444")}{line("resolved", "#22c55e")}</svg>;
}

export default async function EscalationsWorkspace({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const dept = typeof sp.dept === "string" ? sp.dept : undefined;
  const selId = typeof sp.id === "string" ? sp.id : undefined;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const isSuper = roles.includes("super_admin");
  const [d, departments] = await Promise.all([
    loadEscalations(admin, profile?.hospital_id ?? null, isSuper, dept, selId) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">⚠️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Escalations</h1><p className="text-sm text-gray-500">Monitor and manage escalations requiring your immediate attention.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t, i) => <span key={t} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium ${i === 0 ? "border-teal-600 text-teal-700" : "border-transparent text-gray-300"}`} title={i === 0 ? "" : "Next phase"}>{t}</span>)}
      </div>
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operations tables not provisioned</p><p className="text-sm text-amber-800 mt-1">The op_escalations table isn&apos;t available for this tenant yet.</p></div></div>;

  const k = d.kpis; const r = d.review;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
        <Kpi label="Open Escalations" value={k.open} sub="Requiring action" icon="⚠" />
        <Kpi label="Critical" value={k.critical} sub="Immediate action" tone={k.critical ? "text-rose-600" : undefined} icon="🔴" />
        <Kpi label="High Priority" value={k.highPriority} sub="Needs attention" tone={k.highPriority ? "text-amber-600" : undefined} icon="🔺" />
        <Kpi label="Awaiting Review" value={k.awaitingReview} sub="Unacknowledged" icon="👁" />
        <Kpi label="Avg Response" value={k.avgResponse != null ? `${k.avgResponse}m` : "—"} sub="To resolution" icon="⏱" />
        <Kpi label="Resolved This Week" value={k.resolvedThisWeek} sub="Closed" tone="text-green-600" icon="✅" />
        <Kpi label="Escalation Health" value={`${k.health}%`} sub={k.health >= 80 ? "Good" : k.health >= 60 ? "Fair" : "At risk"} tone={k.health >= 80 ? "text-green-600" : k.health >= 60 ? "text-amber-600" : "text-rose-600"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Escalation board */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">Escalation Board</h3><div className="flex gap-1">{["All", "Critical", "High", "Medium", "Low"].map((f, i) => <span key={f} className={`text-[10px] px-2 py-0.5 rounded-full ${i === 0 ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-500"}`}>{f}</span>)}</div></div>
          {d.board.length === 0 ? (
            <div className="text-center py-8"><p className="text-3xl mb-2">✅</p><p className="text-sm font-semibold text-gray-700">No open escalations</p><p className="text-xs text-gray-400 mt-1">All escalations are resolved. New escalations appear here in real time.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Severity</th><th className="py-2 pr-3 font-medium">Type</th><th className="py-2 pr-3 font-medium">Escalation</th><th className="py-2 pr-3 font-medium">Location</th><th className="py-2 pr-3 font-medium">Reported By</th><th className="py-2 pr-3 font-medium">Elapsed</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 pr-3 font-medium">Owner</th><th className="py-2 font-medium">Action</th></tr></thead>
                <tbody>
                  {d.board.slice(0, 8).map((e: any) => (
                    <tr key={e.id} className={`border-b border-gray-50 hover:bg-gray-50/50 ${r?.id === e.id ? "bg-teal-50/40" : ""}`}>
                      <td className="py-2 pr-3"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${SEV[e.bucket]}`}>{e.bucket}</span></td>
                      <td className="py-2 pr-3 text-gray-600 capitalize">{(e.escalation_type ?? "").replace(/_/g, " ")}</td>
                      <td className="py-2 pr-3 text-gray-800 font-medium max-w-[150px] truncate">{e.summary}</td>
                      <td className="py-2 pr-3 text-gray-500 truncate max-w-[80px]">{e.patientLabel ?? e.area}</td>
                      <td className="py-2 pr-3 text-gray-600 truncate max-w-[80px]">{e.reporter}</td>
                      <td className={`py-2 pr-3 whitespace-nowrap ${e.overdue ? "text-rose-600" : "text-gray-400"}`}>{elapsed(e.elapsedMin)}</td>
                      <td className="py-2 pr-3"><span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px]">{STATUS_LABEL[e.status] ?? e.status}</span></td>
                      <td className="py-2 pr-3 text-gray-500 truncate max-w-[70px]">{e.owner ?? "—"}</td>
                      <td className="py-2"><Link href={`/unit-manager/escalations?id=${e.id}${dept ? `&dept=${dept}` : ""}`} className="text-teal-700 hover:underline">Review</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-gray-400 mt-2">Showing {Math.min(8, d.board.length)} of {d.board.length}. Critical first, overdue pinned. AI risk scoring is rule-based.</p>
            </div>
          )}
        </div>

        {/* Review panel */}
        <div className={`${card} p-5 xl:col-span-1`}>
          {!r ? <div className="text-center py-8"><p className="text-2xl mb-2">🗂️</p><p className="text-sm text-gray-400">Select an escalation to review.</p></div> : (
            <>
              <div className="flex items-start justify-between mb-2"><div><h3 className="text-sm font-bold text-gray-900">{r.summary}</h3><p className="text-[10px] text-gray-400">{r.patientLabel ? `${r.patientLabel} · ` : ""}{r.area} · reported {elapsed(r.elapsedMin)} ago</p></div><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold h-fit ${SEV[r.bucket]}`}>{r.bucket}</span></div>
              <div className="mt-2"><p className="text-[10px] font-semibold text-gray-500 uppercase">Situation</p><p className="text-xs text-gray-700">{r.summary}</p><p className="text-[10px] text-gray-400 mt-0.5">Patient age/sex not stored operationally (EMR) — honest.</p></div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-rose-50/50 border border-rose-100 p-2.5"><p className="text-[10px] font-bold text-rose-700 uppercase">AI Risk</p><p className="text-lg font-bold text-rose-600">{r.riskScore}/100</p><p className="text-[11px] text-gray-600">{r.riskLabel}</p></div>
                <div className="rounded-lg border border-gray-100 p-2.5"><p className="text-[10px] font-bold text-gray-500 uppercase">Due In</p><p className={`text-lg font-bold ${r.dueIn != null && r.dueIn < 0 ? "text-rose-600" : "text-gray-800"}`}>{r.dueIn == null ? "—" : r.dueIn < 0 ? "Overdue" : `${r.dueIn}m`}</p><p className="text-[11px] text-gray-500">Level {r.level}</p></div>
              </div>
              <div className="mt-3"><p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Recommended Actions</p><ul className="text-[11px] text-gray-600 space-y-0.5">{r.recommendations.slice(0, 5).map((a: string, i: number) => <li key={i}>✓ {a}</li>)}</ul></div>
              <div className="mt-3 flex items-center justify-between text-[10px] text-gray-400"><span>Owner: <b className="text-gray-600">{r.owner ?? "Unassigned"}</b></span><span>{STATUS_LABEL[r.status]}</span></div>
              <div className="mt-3"><EscalationActions id={r.id} status={r.status} /></div>
            </>
          )}
        </div>
      </div>

      {/* Analytics */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Escalation by Type</h3>
          {d.byType.length === 0 ? <p className="text-sm text-gray-400">No open escalations.</p> : (
            <div className="flex items-center gap-3"><Donut total={k.open} segs={d.byType.map((x: any, i: number) => ({ n: x.n, color: TYPE_COLOR[i % 6] }))} /><div className="text-[11px] space-y-1 flex-1">{d.byType.map((x: any, i: number) => <div key={x.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: TYPE_COLOR[i % 6] }} /><span className="text-gray-600 flex-1">{x.label}</span><b>{x.n}</b><span className="text-gray-400">({x.pct}%)</span></div>)}</div></div>
          )}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Escalations by Severity</h3>
          <div className="space-y-1.5">{d.bySeverity.map((s: any) => { const max = Math.max(1, ...d.bySeverity.map((x: any) => x.n)); return <div key={s.label} className="flex items-center gap-2 text-xs"><span className="w-16 text-gray-500">{s.label}</span><div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(s.n / max) * 100}%`, background: SEV_BAR[s.label] }} /></div><b className="w-5 text-right tabular-nums">{s.n}</b></div>; })}</div>
          <p className="text-[10px] text-gray-400 mt-2">Total open: {k.open}</p>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Escalation Timeline (7 days)</h3>
          <TimelineChart series={d.timeline} />
          <div className="flex gap-3 text-[10px] mt-1"><span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-rose-500" />Opened</span><span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-green-500" />Resolved</span></div>
        </div>
      </div>

      {/* Hotspots + AI early warning */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Escalation Hotspots</h3>
          {d.hotspots.length === 0 ? <p className="text-sm text-gray-400">No hotspots.</p> : (
            <div className="space-y-1.5">{d.hotspots.map((h: any) => { const max = Math.max(1, ...d.hotspots.map((x: any) => x.n)); return <div key={h.label} className="flex items-center gap-2 text-xs"><span className="w-28 text-gray-600 truncate">{h.label}</span><div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-rose-400 rounded-full" style={{ width: `${(h.n / max) * 100}%` }} /></div><b className="w-5 text-right tabular-nums">{h.n}</b></div>; })}</div>
          )}
        </div>
        <div className={`${card} p-5 bg-gradient-to-br from-violet-50/40 to-white`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-1.5"><span>✨</span>AI Early Warning</h3>
          {d.aiWarn.length === 0 ? <p className="text-sm text-gray-400">No early-warning signals.</p> : (
            <div className="space-y-2">{d.aiWarn.map((a: any, i: number) => (<div key={i} className="flex items-start gap-2"><span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${DOT[a.tone] ?? "bg-gray-300"}`} /><div><p className="text-xs font-semibold text-gray-800">{a.title}</p><p className="text-[10px] text-gray-500">{a.sub}</p></div></div>))}</div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Rule-based over the live escalation queue.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Escalations Workspace (UMW-EA-002) is the Unit Manager&apos;s escalation command centre over the live op_escalations store — KPIs, board, review panel with rule-based AI risk scoring &amp; recommended actions, by-type/severity analytics, weekly timeline, hotspot analysis and AI early-warning. Decisions (take action, assign, escalate higher, resolve with documented outcome) are fully audited. Patient age/sex isn&apos;t held operationally, AI scoring is rule-based, and open-incident/open-CAPA/create-task cross-actions + the deep Analytics/Reports tabs are next-phase. <Link href="/unit-manager/action-centre" className="text-teal-700 hover:underline">← Executive Actions</Link></p>
    </div>
  );
}
