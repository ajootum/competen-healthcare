import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadIncidentCentre } from "@/lib/operations/incident-centre";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import QualityTabs from "../QualityTabs";
import IncidentInbox from "./IncidentInbox";

export const dynamic = "force-dynamic";

// Incident Management Centre (UMG-QS-002) — aligned to the detailed spec + mockup. The executive incident
// dashboard: KPI ribbon with period-over-period deltas + sparklines (total / critical / median investigation
// time are real from the incident timestamps; current-state KPIs show the live value), the 6-month severity
// trend (line), incidents by category and by severity (donuts), the triage inbox, investigation-progress
// stages, recent critical incidents and quick access. Consolidation over op_incidents — no store forked.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
const INC_META = [
  { key: "critical", label: "Critical", color: "#ef4444" },
  { key: "major", label: "Major", color: "#f97316" },
  { key: "moderate", label: "Moderate", color: "#f59e0b" },
  { key: "minor", label: "Minor", color: "#22c55e" },
  { key: "nearMiss", label: "Near Miss", color: "#3b82f6" },
];
const QUICK = [
  { label: "Report New Incident", sub: "Create a new incident report", icon: "📝", tint: "bg-[var(--cmp-surface-success)]", href: "/supervisor/quality-safety" },
  { label: "Investigation Centre", sub: "Manage investigations", icon: "🔎", tint: "bg-[var(--cmp-surface-information)]", href: "/supervisor/quality-safety" },
  { label: "RCA Workspace", sub: "Perform root cause analysis", icon: "🧩", tint: "bg-[var(--cmp-surface-warning)]", href: "/supervisor/quality-safety" },
  { label: "CAPA Actions", sub: "Manage corrective actions", icon: "🗂️", tint: "bg-violet-50", href: "/unit-manager/capa" },
  { label: "Incident Analytics", sub: "Trends and benchmarks", icon: "📊", tint: "bg-teal-50", href: "/unit-manager/quality/analytics" },
  { label: "Lessons Learned", sub: "Share learning & alerts", icon: "💡", tint: "bg-pink-50", href: "/unit-manager/quality/ai" },
  { label: "Regulatory Reporting", sub: "External notifications", icon: "📤", tint: "bg-[var(--cmp-surface-warning)]", href: "/unit-manager/quality/mortality" },
  { label: "Configuration", sub: "Incident settings", icon: "⚙️", tint: "bg-gray-50", href: "/unit-manager/settings" },
];

function Spark({ series, color }: { series: number[]; color: string }) {
  if (!series || series.length < 2 || series.every(v => v === series[0])) return <div className="h-6" />;
  const max = Math.max(...series), min = Math.min(...series), rng = max - min || 1;
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * 100},${22 - ((v - min) / rng) * 20}`).join(" ");
  return <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="w-full h-6"><polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}
function Delta({ v, unit, prev, invert }: { v: number | null | undefined; unit: string; prev: string; invert?: boolean }) {
  if (v == null) return <span className="text-[10px] text-gray-300">no prior period</span>;
  if (v === 0) return <span className="text-[10px] text-gray-400">no change vs {prev}</span>;
  const good = invert ? v < 0 : v > 0;
  return <span className={`text-[10px] font-medium ${good ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{v > 0 ? "↑" : "↓"} {Math.abs(v)}{unit} vs {prev}</span>;
}
function MultiLine({ labels, series, max }: { labels: string[]; series: { color: string; data: number[] }[]; max: number }) {
  const W = 320, H = 150, pad = 8;
  const x = (i: number) => pad + (i / Math.max(1, labels.length - 1)) * (W - 2 * pad);
  const y = (v: number) => H - 18 - (v / (max || 1)) * (H - 30);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 150 }}>
      {[0, 0.5, 1].map((f, i) => <line key={i} x1={pad} x2={W - pad} y1={y(max * f)} y2={y(max * f)} stroke="#f1f5f9" strokeWidth="1" />)}
      {series.map((s, si) => <polyline key={si} points={s.data.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
      {series.map((s, si) => s.data.map((v, i) => <circle key={`${si}-${i}`} cx={x(i)} cy={y(v)} r="2" fill={s.color} />))}
      {labels.map((l, i) => <text key={i} x={x(i)} y={H - 4} textAnchor="middle" className="fill-gray-400" style={{ fontSize: 8 }}>{l}</text>)}
    </svg>
  );
}
// Multi-segment donut (prefix-sum arcs — no render-scope mutation).
function SegDonut({ segments, total }: { segments: { n: number; color: string }[]; total: number }) {
  const sum = segments.reduce((a, s) => a + s.n, 0) || 1;
  const active = segments.filter(s => s.n > 0);
  const grad = active.length
    ? `conic-gradient(${active.map((s, i) => { const before = active.slice(0, i).reduce((a, x) => a + x.n, 0); return `${s.color} ${(before / sum) * 360}deg ${((before + s.n) / sum) * 360}deg`; }).join(", ")})`
    : "conic-gradient(#f1f5f9 0deg 360deg)";
  return <div className="relative w-[128px] h-[128px] shrink-0" style={{ background: grad, borderRadius: "9999px" }}><div className="absolute inset-[18px] bg-white rounded-full flex flex-col items-center justify-center"><span className="text-2xl font-bold text-gray-900 tabular-nums leading-none">{total}</span><span className="text-[10px] text-gray-400">Total</span></div></div>;
}

function Kpi({ icon, tint, label, value, unit, sub, tone, spark, sparkColor, delta, deltaUnit, deltaInvert, prev }: any) {
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-center justify-between mb-1.5"><div className="flex items-center gap-2"><span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm ${tint}`}>{icon}</span><span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{label}</span></div><span className="text-[10px] text-gray-300">ⓘ</span></div>
      <div className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}{unit && <span className="text-sm font-medium text-gray-400 ml-1">{unit}</span>}</div>
      {spark ? <div className="mt-1"><Spark series={spark} color={sparkColor} /></div> : sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
      {delta !== undefined && <div className="mt-1"><Delta v={delta} unit={deltaUnit ?? "%"} prev={prev} invert={deltaInvert} /></div>}
    </div>
  );
}

export default async function IncidentManagement() {
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
    loadIncidentCentre(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="w-9 h-9 rounded-lg bg-[var(--cmp-surface-error)] flex items-center justify-center text-lg">🛡️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Incident Management Centre <span className="text-gray-300 font-medium text-lg">(UMG-QS-002)</span></h1><p className="text-sm text-gray-500">Report, investigate and manage incidents to improve patient safety and quality of care</p></div></div>
        <div className="flex items-center gap-2">
          <UnitFilters departments={departments} />
          <Link href="/unit-manager/quality/incidents" className="text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-600 hover:bg-gray-50">↻ Refresh</Link>
          <Link href="/supervisor/quality-safety" className="text-xs bg-[var(--cmp-color-error)] text-white rounded-lg px-3 py-2 hover:bg-rose-700 font-medium">+ Report Incident</Link>
        </div>
      </div>
      <QualityTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Incident register not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 073 (op_incidents) to enable incident management.</p></div></div>;

  const k = d.kpis, prev = d.trend.months[4] ?? "prev";
  const catSum = d.category.reduce((a: number, c: any) => a + c.n, 0);
  const sevSum = d.severity.reduce((a: number, s: any) => a + s.n, 0);

  return (
    <div className="space-y-4">
      {header}

      {/* ── KPI ribbon ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon="🗂️" tint="bg-[var(--cmp-surface-information)]" label="Total Incidents" value={k.total} sub={`${k.totalAll} all-time`} spark={k.sparks.total} sparkColor="#0ea5e9" delta={k.deltas.total} prev={prev} deltaInvert />
        <Kpi icon="❗" tint="bg-[var(--cmp-surface-error)]" label="Critical Incidents" value={k.criticalOpen} tone={k.criticalOpen ? "text-[var(--cmp-text-error)]" : "text-gray-400"} spark={k.sparks.critical} sparkColor="#ef4444" delta={k.deltas.critical} prev={prev} deltaInvert />
        <Kpi icon="🔎" tint="bg-[var(--cmp-surface-warning)]" label="Open Investigations" value={k.openInvestigations} sub="in progress" />
        <Kpi icon="🧩" tint="bg-violet-50" label="Awaiting RCA" value={k.awaitingRca} tone={k.awaitingRca ? "text-violet-600" : "text-gray-400"} sub="need root-cause" />
        <Kpi icon="⏱️" tint="bg-[var(--cmp-surface-warning)]" label="Overdue Actions" value={k.overdueActions} tone={k.overdueActions ? "text-[var(--cmp-text-warning)]" : "text-gray-400"} sub="open > 30 days" />
        <Kpi icon="🕐" tint="bg-teal-50" label="Median Investigation" value={k.medianDays != null ? k.medianDays : "—"} unit={k.medianDays != null ? "days" : ""} spark={k.sparks.median} sparkColor="#14b8a6" delta={k.deltas.median} deltaUnit="d" prev={prev} deltaInvert />
      </div>

      {/* ── Trend · category · severity ────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-1">Incident Trend <span className="text-[10px] text-gray-400 font-normal">last 6 months</span></h3>
          {d.hasData ? (
            <div className="flex gap-3">
              <div className="flex-1 min-w-0"><MultiLine labels={d.trend.months} max={Math.max(1, ...INC_META.map(m => Math.max(...(d.trend.series[m.key] ?? [0]))))} series={INC_META.map(m => ({ color: m.color, data: d.trend.series[m.key] ?? [] }))} /></div>
              <div className="w-24 shrink-0 space-y-1 pt-1">{INC_META.map(m => <div key={m.key} className="flex items-center justify-between text-[11px]"><span className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-sm" style={{ background: m.color }} />{m.label}</span><b className="tabular-nums text-gray-700">{d.trend.totals[m.key] ?? 0}</b></div>)}</div>
            </div>
          ) : <p className="text-sm text-gray-400 py-10 text-center">No incidents recorded.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Incidents by Category</h3>
          {d.category.length ? <div className="flex items-center gap-4">
            <SegDonut total={catSum} segments={d.category.map((c: any) => ({ n: c.n, color: c.color }))} />
            <div className="text-[11px] text-gray-600 space-y-1 min-w-0 flex-1">{d.category.slice(0, 6).map((c: any) => <div key={c.type} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} /><span className="text-gray-600 truncate flex-1">{c.label}</span><b className="tabular-nums text-gray-700">{c.n}</b><span className="text-gray-300 tabular-nums">({c.pct}%)</span></div>)}</div>
          </div> : <p className="text-sm text-gray-400 py-8 text-center">No incidents.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Severity Distribution</h3>
          {sevSum > 0 ? <div className="flex items-center gap-4">
            <SegDonut total={sevSum} segments={d.severity.map((s: any) => ({ n: s.n, color: s.color }))} />
            <div className="text-[11px] text-gray-600 space-y-1 min-w-0 flex-1">{d.severity.map((s: any) => <div key={s.key} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} /><span className="text-gray-600 flex-1">{s.label}</span><b className="tabular-nums text-gray-700">{s.n}</b><span className="text-gray-300 tabular-nums">({s.pct}%)</span></div>)}</div>
          </div> : <p className="text-sm text-gray-400 py-8 text-center">No incidents.</p>}
        </div>
      </div>

      {/* ── Inbox · investigation progress · recent critical ───────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Incident Inbox &amp; Triage Queue</h3>
          <IncidentInbox rows={d.inbox} counts={d.triageCounts} />
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Investigation Progress</h3>
          <div className="space-y-2.5">{d.investigationProgress.map((s: any) => (
            <div key={s.key}><div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600">{s.label}</span><b className="tabular-nums text-gray-800">{s.n} <span className="text-gray-300 font-normal">({s.pct}%)</span></b></div><div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${s.pct}%`, background: s.color }} /></div></div>
          ))}</div>
          <p className="text-[10px] text-gray-400 mt-3">Stages reflect the incident lifecycle statuses. A distinct RCA-in-progress stage is next-phase.</p>
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Recent Critical</h3><Link href="/supervisor/quality-safety" className="text-[11px] text-[var(--cmp-text-error)] hover:underline">View all →</Link></div>
          {d.recentCritical.length ? <div className="space-y-2">{d.recentCritical.map((r: any) => (
            <div key={r.id} className="rounded-lg border border-gray-100 p-2.5">
              <div className="flex items-center justify-between gap-2"><span className="text-[10px] text-gray-400 tabular-nums">{r.ref}</span><span className="text-[9px] font-semibold rounded px-1.5 py-0.5 bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]">Critical</span></div>
              <p className="text-xs text-gray-700 mt-0.5 line-clamp-2">{r.title}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{r.at} · {r.status.replace("_", " ")}</p>
            </div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No critical incidents open. 🎉</p>}
        </div>
      </div>

      {/* ── Quick access ───────────────────────────────────────────────────── */}
      <div className={`${card} p-5`}>
        <h3 className="font-semibold text-gray-900 text-sm mb-3">Quick Access</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">{QUICK.map(q => (
          <Link key={q.label} href={q.href} className="rounded-lg border border-gray-100 p-3 hover:border-[var(--cmp-color-error)] hover:shadow-sm transition-all text-center">
            <span className={`w-9 h-9 rounded-lg ${q.tint} flex items-center justify-center text-base mx-auto mb-1.5`}>{q.icon}</span>
            <p className="text-[11px] font-medium text-gray-800 leading-tight">{q.label}</p>
            <p className="text-[9px] text-gray-400 mt-0.5 leading-tight">{q.sub}</p>
          </Link>
        ))}</div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2 text-[10px] text-gray-400 pb-4">
        <span>Data sources: Shift Supervisor Workspace · Patient Operations · Audit &amp; Compliance · CAPA &amp; Improvement · Risk Register · Clinical Indicators</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[var(--cmp-color-success)]" /> Incident register live · consolidation over op_incidents (migration 073)</span>
      </div>
    </div>
  );
}
