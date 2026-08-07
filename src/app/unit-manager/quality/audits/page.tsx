import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAuditCentre } from "@/lib/operations/audit-centre";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import QualityTabs from "../QualityTabs";
import { SegDonut } from "../_kit";
import UnavailableNotice from "@/components/UnavailableNotice";

export const dynamic = "force-dynamic";

// Audit & Compliance Centre (UMG-QS-003) — aligned to the detailed spec + mockup. Consolidation over audits /
// audit_findings / capa_actions (034); no store forked. Real: the compliance KPIs with 12-month trend +
// period delta, audit status, top areas with per-area change, best/lowest/most-improved/declined highlights,
// findings breakdown, CAPA status, overdue items and AI insights. Honest next-phase (spec §9 entities with no
// store): the forward Audit Calendar (audits has no scheduled_date) and the Evidence repository/completeness.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
const pctTone = (p: number | null) => (p == null ? "text-gray-300" : p >= 85 ? "text-[var(--cmp-text-success)]" : p >= 70 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]");
const barTone = (p: number) => (p >= 85 ? "#10b981" : p >= 70 ? "#f59e0b" : "#ef4444");
const statusTone = (s: string) => (s === "completed" ? "bg-[var(--cmp-surface-success)] text-emerald-700" : s === "in_progress" ? "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]" : "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]");
const QUICK = [
  { label: "Create Audit", sub: "Schedule a new audit", icon: "🗓️", tint: "bg-[var(--cmp-surface-success)]", href: "/quality-accreditation" },
  { label: "Audit Library", sub: "Browse audit templates", icon: "📚", tint: "bg-[var(--cmp-surface-information)]", href: "/quality-accreditation" },
  { label: "Active Audits", sub: "Manage ongoing audits", icon: "✅", tint: "bg-teal-50", href: "/quality-accreditation" },
  { label: "Findings Register", sub: "View and manage findings", icon: "📋", tint: "bg-[var(--cmp-surface-warning)]", href: "/quality-accreditation" },
  { label: "CAPA Centre", sub: "Corrective actions", icon: "🗂️", tint: "bg-violet-50", href: "/unit-manager/capa" },
  { label: "Evidence Repository", sub: "Browse evidence", icon: "📁", tint: "bg-pink-50", href: "/quality-accreditation" },
  { label: "Reports", sub: "Generate audit reports", icon: "📊", tint: "bg-indigo-50", href: "/unit-manager/reports" },
  { label: "Configuration", sub: "Audit settings", icon: "⚙️", tint: "bg-gray-50", href: "/unit-manager/settings" },
];

function Spark({ series, color }: { series: number[]; color: string }) {
  const nz = series.filter(v => v > 0);
  if (nz.length < 2) return <div className="h-6" />;
  const max = Math.max(...series), min = Math.min(...series.filter(v => v > 0)), rng = max - min || 1;
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * 100},${22 - ((Math.max(v, min) - min) / rng) * 20}`).join(" ");
  return <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="w-full h-6"><polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}
function Delta({ v, unit = "%", prev, invert }: { v: number | null | undefined; unit?: string; prev: string; invert?: boolean }) {
  if (v == null) return <span className="text-[10px] text-gray-300">no prior period</span>;
  if (v === 0) return <span className="text-[10px] text-gray-400">no change vs {prev}</span>;
  const good = invert ? v < 0 : v > 0;
  return <span className={`text-[10px] font-medium ${good ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{v > 0 ? "↑" : "↓"} {Math.abs(v)}{unit} vs {prev}</span>;
}
function Kpi({ icon, tint, label, value, unit, sub, tone, spark, sparkColor, delta, prev, deltaInvert }: any) {
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-center justify-between mb-1.5"><div className="flex items-center gap-2 min-w-0"><span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0 ${tint}`}>{icon}</span><span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide truncate">{label}</span></div><span className="text-[10px] text-gray-300 shrink-0">ⓘ</span></div>
      <div className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}{unit && <span className="text-sm font-medium text-gray-400 ml-0.5">{unit}</span>}</div>
      {spark ? <div className="mt-1"><Spark series={spark} color={sparkColor} /></div> : sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
      {delta !== undefined && <div className="mt-1"><Delta v={delta} prev={prev} invert={deltaInvert} /></div>}
    </div>
  );
}

function ComplianceTrend({ months, compliance, target }: { months: string[]; compliance: (number | null)[]; target: number }) {
  const W = 340, H = 150, pad = 10;
  const x = (i: number) => pad + (i / Math.max(1, months.length - 1)) * (W - 2 * pad);
  const y = (v: number) => H - 18 - (v / 100) * (H - 30);
  const pts = compliance.map((v, i) => v == null ? null : `${x(i)},${y(v)}`).filter(Boolean).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 150 }}>
      {[0, 25, 50, 75, 100].map(g => <line key={g} x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="#f1f5f9" strokeWidth="1" />)}
      <line x1={pad} x2={W - pad} y1={y(target)} y2={y(target)} stroke="#3b82f6" strokeWidth="1" strokeDasharray="4 3" />
      <polyline points={pts} fill="none" stroke="#10b981" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {compliance.map((v, i) => v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r="2" fill="#10b981" />)}
      {months.map((l, i) => (i % 2 === 0 || i === months.length - 1) ? <text key={i} x={x(i)} y={H - 4} textAnchor="middle" className="fill-gray-400" style={{ fontSize: 7 }}>{l}</text> : null)}
    </svg>
  );
}

export default async function AuditCentre() {
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
    loadAuditCentre(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="w-9 h-9 rounded-lg bg-[var(--cmp-surface-success)] flex items-center justify-center text-lg">✅</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Audit &amp; Compliance Centre</h1><p className="text-sm text-gray-500">Plan, execute and monitor audits to ensure compliance and drive continuous improvement</p></div></div>
        <div className="flex items-center gap-2"><UnitFilters departments={departments} /><Link href="/unit-manager/quality/audits" className="text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-600 hover:bg-gray-50">↻ Refresh</Link><Link href="/quality-accreditation" className="text-xs bg-[var(--cmp-color-success)] text-white rounded-lg px-3 py-2 hover:bg-emerald-700 font-medium">+ Schedule Audit</Link></div>
      </div>
      <QualityTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Audit store not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 034 (audits / audit_findings) to enable the audit centre.</p></div></div>;

  const k = d.kpis, prev = d.trend.months[10] ?? "prev", h = d.highlights;

  return (
    <div className="space-y-4">
      {header}
      <UnavailableNotice sources={d.findings?.unavailable ? ["audit findings"] : []} what="audit figures" />

      {/* ── KPI ribbon (8) ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Kpi icon="📊" tint="bg-[var(--cmp-surface-success)]" label="Overall Compliance" value={k.overallCompliance != null ? `${k.overallCompliance}%` : "—"} tone={pctTone(k.overallCompliance)} spark={k.complianceSpark} sparkColor="#10b981" delta={k.complianceDelta} prev={prev} deltaInvert={false} />
        <Kpi icon="🗓️" tint="bg-[var(--cmp-surface-information)]" label="Audits Scheduled" value={k.scheduled} sub="planned / pending" />
        <Kpi icon="✅" tint="bg-teal-50" label="Audits Completed" value={k.completed} sub={`${k.completedPct}% of total`} />
        <Kpi icon="⏰" tint="bg-[var(--cmp-surface-error)]" label="Overdue Audits" value={k.overdue} tone={k.overdue ? "text-[var(--cmp-text-error)]" : "text-gray-400"} sub=">30d open (proxy)" />
        <Kpi icon="🚩" tint="bg-[var(--cmp-surface-warning)]" label="High Risk Findings" value={k.highRiskFindings} tone={k.highRiskFindings ? "text-[var(--cmp-text-warning)]" : "text-gray-400"} sub={`${k.repeatFindings} repeat`} />
        <Kpi icon="🗂️" tint="bg-violet-50" label="CAPAs Generated" value={k.capasGenerated} sub={`${k.capasTotal} total`} />
        <Kpi icon="📁" tint="bg-pink-50" label="Evidence Complete" value="—" tone="text-gray-300" sub="repository: next-phase" />
        <Kpi icon="🏅" tint="bg-indigo-50" label="Accreditation" value={k.accreditationScore != null ? `${k.accreditationScore}%` : "—"} tone={pctTone(k.accreditationScore)} sub={k.surveyDays != null ? `survey in ${k.surveyDays}d` : "readiness"} />
      </div>

      {/* ── Compliance trend + highlights · status donut · top areas ────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-1">Audit Compliance Trend <span className="text-[10px] text-gray-400 font-normal">last 12 months</span></h3>
          {d.hasData ? (
            <div className="flex gap-3">
              <div className="flex-1 min-w-0"><ComplianceTrend months={d.trend.months} compliance={d.trend.compliance} target={d.trend.target} /><div className="flex gap-3 text-[10px] text-gray-500 mt-1"><span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[var(--cmp-color-success)]" />Compliance %</span><span className="flex items-center gap-1"><span className="w-3 h-0 border-t border-dashed border-blue-500" />Target {d.trend.target}%</span></div></div>
              <div className="w-28 shrink-0 space-y-2 text-[10px]">
                {h.best && <Hl label="Best" name={h.best.name} v={`${h.best.compliance}%`} tone="emerald" />}
                {h.lowest && <Hl label="Lowest" name={h.lowest.name} v={`${h.lowest.compliance}%`} tone="rose" />}
                {h.mostImproved?.change != null && <Hl label="Most improved" name={h.mostImproved.name} v={`↑${h.mostImproved.change}%`} tone="emerald" />}
                {h.mostDeclined?.change != null && h.mostDeclined.change < 0 && <Hl label="Most declined" name={h.mostDeclined.name} v={`↓${Math.abs(h.mostDeclined.change)}%`} tone="rose" />}
              </div>
            </div>
          ) : <p className="text-sm text-gray-400 py-10 text-center">No completed audits with a compliance score yet.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Audit Status Overview</h3>
          {d.status.total > 0 ? <div className="flex items-center gap-4">
            <SegDonut total={d.status.total} segments={[{ n: d.status.completed, color: "#10b981" }, { n: d.status.inProgress, color: "#3b82f6" }, { n: d.status.planned, color: "#f59e0b" }, { n: d.status.overdue, color: "#ef4444" }]} />
            <div className="text-[11px] text-gray-600 space-y-1.5 flex-1">
              <Lg color="#10b981" label="Completed" v={`${d.status.completed} (${Math.round((d.status.completed / d.status.total) * 100)}%)`} />
              <Lg color="#3b82f6" label="In Progress" v={d.status.inProgress} />
              <Lg color="#f59e0b" label="Planned" v={d.status.planned} />
              <Lg color="#ef4444" label="Overdue (proxy)" v={d.status.overdue} />
            </div>
          </div> : <p className="text-sm text-gray-400 py-8 text-center">No audits recorded.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Top Audit Areas by Compliance</h3>
          {d.areas.length ? <div className="space-y-2">{d.areas.map((a: any) => (
            <div key={a.name} className="flex items-center gap-2 text-xs"><span className="text-gray-600 w-32 truncate" title={a.name}>{a.name}</span><div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${a.compliance}%`, background: barTone(a.compliance) }} /></div><b className={`tabular-nums w-9 text-right ${pctTone(a.compliance)}`}>{a.compliance}%</b><span className={`w-9 text-right tabular-nums text-[10px] ${a.change == null ? "text-gray-300" : a.change >= 0 ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{a.change == null ? "—" : `${a.change >= 0 ? "↑" : "↓"}${Math.abs(a.change)}%`}</span></div>
          ))}</div> : <p className="text-sm text-gray-400 py-8 text-center">No audit areas scored.</p>}
        </div>
      </div>

      {/* ── Recent audits · findings · CAPA · overdue ──────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Recent Audits</h3>
          {d.recentAudits.length ? <div className="space-y-2">{d.recentAudits.map((a: any, i: number) => (
            <div key={i} className="text-xs border-b border-gray-50 pb-1.5 last:border-0"><div className="flex items-center justify-between gap-2"><span className="text-gray-700 truncate">{a.title}</span>{a.pct != null && <b className={`tabular-nums shrink-0 ${pctTone(a.pct)}`}>{a.pct}%</b>}</div><div className="flex items-center gap-2 mt-0.5"><span className={`text-[9px] font-semibold rounded px-1 py-0.5 ${statusTone(a.status)}`}>{a.status.replace("_", " ")}</span><span className="text-[10px] text-gray-400 truncate">{a.area ?? "—"} · {(a.at ?? "").slice(0, 10)}</span></div></div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No audits yet.</p>}
          <p className="text-[10px] text-gray-400 mt-2">Forward audit calendar &amp; scheduling (AuditSchedule) is next-phase.</p>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Audit Findings</h3>
          <div className="space-y-2">{d.findingsByLevel.map((f: any) => (
            <div key={f.label} className="flex items-center gap-2 text-xs"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: f.color }} /><span className="text-gray-600 flex-1 truncate">{f.label}</span><b className="tabular-nums text-gray-800">{f.n}</b></div>
          ))}<div className="border-t border-gray-100 pt-1.5 flex justify-between text-xs"><span className="text-gray-500">Total findings</span><b className="tabular-nums text-gray-800">{d.findings.total}</b></div></div>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Open CAPA Status</h3>
          {d.capa.total > 0 ? <div className="flex items-center gap-3">
            <SegDonut total={d.capa.total} segments={[{ n: d.capa.open, color: "#3b82f6" }, { n: d.capa.inProgress, color: "#8b5cf6" }, { n: d.capa.verified, color: "#f59e0b" }, { n: d.capa.completed, color: "#10b981" }]} />
            <div className="text-[11px] text-gray-600 space-y-1 flex-1 min-w-0">
              <Lg color="#3b82f6" label="Open" v={d.capa.open} />
              <Lg color="#8b5cf6" label="In Progress" v={d.capa.inProgress} />
              <Lg color="#f59e0b" label="Verified" v={d.capa.verified} />
              <Lg color="#10b981" label="Completed" v={d.capa.completed} />
            </div>
          </div> : <p className="text-sm text-gray-400 py-6 text-center">No CAPAs linked to audits.</p>}
          <Link href="/unit-manager/capa" className="inline-block text-[11px] font-medium text-emerald-700 hover:underline mt-2">Go to CAPA Centre →</Link>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Overdue Items</h3>
          <div className="space-y-2">{d.overdueItems.map((o: any) => (
            <div key={o.label} className="flex items-center justify-between text-xs"><span className="text-gray-600">{o.label}</span><b className={`tabular-nums ${o.n ? "text-[var(--cmp-text-error)]" : "text-gray-400"}`}>{o.n}</b></div>
          ))}</div>
        </div>
      </div>

      {/* ── Quick access · AI insights ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Quick Access</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">{QUICK.map(q => (
            <Link key={q.label} href={q.href} className="rounded-lg border border-gray-100 p-3 hover:border-[var(--cmp-color-success)] hover:shadow-sm transition-all text-center"><span className={`w-9 h-9 rounded-lg ${q.tint} flex items-center justify-center text-base mx-auto mb-1.5`}>{q.icon}</span><p className="text-[11px] font-medium text-gray-800 leading-tight">{q.label}</p><p className="text-[9px] text-gray-400 mt-0.5 leading-tight">{q.sub}</p></Link>
          ))}</div>
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-3"><span className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center text-sm">🤖</span><h3 className="font-semibold text-gray-900 text-sm">AI Audit Insights</h3><span className="text-[10px] text-violet-600">rule-based</span></div>
          {d.ai.length ? <div className="space-y-2">{d.ai.map((a: any, i: number) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-gray-100 p-2.5"><span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${a.tone === "rose" ? "bg-[var(--cmp-color-error)]" : a.tone === "amber" ? "bg-[var(--cmp-color-warning)]" : a.tone === "sky" ? "bg-[var(--cmp-color-information)]" : "bg-[var(--cmp-color-success)]"}`} /><div className="min-w-0 flex-1"><p className="text-xs font-medium text-gray-800 leading-snug">{a.text}</p><p className="text-[10px] text-gray-400">{a.detail}</p></div><span className="text-[10px] text-gray-400 shrink-0">conf {a.confidence}%</span></div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No audit signals to action right now.</p>}
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2 text-[10px] text-gray-400 pb-4">
        <span>Data sources: Audit Repository · CAPA &amp; Improvement · Incident Management · Accreditation Readiness · Clinical Indicators</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[var(--cmp-color-success)]" /> Audit store live · consolidation over audits / audit_findings / capa_actions (migration 034)</span>
      </div>
    </div>
  );
}

function Lg({ color, label, v }: { color: string; label: string; v: any }) {
  return <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color }} /><span className="text-gray-500 flex-1">{label}</span><b className="tabular-nums text-gray-700">{v}</b></div>;
}
function Hl({ label, name, v, tone }: { label: string; name: string; v: string; tone: string }) {
  return <div><p className="text-gray-400">{label}</p><div className="flex items-center justify-between gap-1"><span className="text-gray-700 truncate" title={name}>{name}</span><b className={tone === "emerald" ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}>{v}</b></div></div>;
}
