import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadQualityCommand } from "@/lib/operations/quality-command";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../UnitFilters";
import QualityTabs from "./QualityTabs";

export const dynamic = "force-dynamic";

// Quality & Safety Command Centre (UMG-QS-001) — the Unit Manager's executive quality dashboard. A
// consolidation surface (spec §4): it composes the platform's existing quality/safety stores — op_incidents,
// op_quality_actions, audits/audit_findings, gov_risks, quality_indicators — with no new store. Real: the
// KPI ribbon, incident trend, audit-compliance donut, CAPA pipeline, patient-safety breakdown, the 5×5 risk
// heat map + top risks, alerts and rule-based AI insights. Honest next-phase: the 12-month composite quality
// trend (needs analytics-snapshot history) and Mortality & Morbidity (no store).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const BAND_META: { key: string; label: string; color: string }[] = [
  { key: "critical", label: "Critical", color: "#ef4444" },
  { key: "major", label: "Major", color: "#f59e0b" },
  { key: "moderate", label: "Moderate", color: "#eab308" },
  { key: "minor", label: "Minor", color: "#22c55e" },
  { key: "nearMiss", label: "Near Miss", color: "#14b8a6" },
];
const riskCellTone = (score: number) => (score >= 15 ? "bg-rose-500 text-white" : score >= 10 ? "bg-orange-400 text-white" : score >= 5 ? "bg-amber-300 text-amber-900" : "bg-emerald-400/80 text-emerald-950");

function Kpi({ icon, tint, label, value, sub, tone }: { icon: string; tint: string; label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-center gap-2.5 mb-2"><span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${tint}`}>{icon}</span><span className="text-xs font-medium text-gray-500 leading-tight">{label}</span></div><div className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</div>{sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}</div>;
}

// Single-value conic donut.
function Donut({ pct, color, center, sub }: { pct: number; color: string; center: string; sub?: string }) {
  return (
    <div className="relative w-[120px] h-[120px] shrink-0" style={{ background: `conic-gradient(${color} ${pct * 3.6}deg, #f1f5f9 0)`, borderRadius: "9999px" }}>
      <div className="absolute inset-[12px] bg-white rounded-full flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-gray-900 tabular-nums leading-none">{center}</span>
        {sub && <span className="text-[10px] text-gray-400 mt-0.5">{sub}</span>}
      </div>
    </div>
  );
}

// 6-month stacked incident-trend bars.
function IncidentTrend({ months, series }: { months: string[]; series: Record<string, number[]> }) {
  const sums = months.map((_, i) => BAND_META.reduce((n, b) => n + (series[b.key]?.[i] ?? 0), 0));
  const max = Math.max(...sums, 1);
  return (
    <div className="flex items-end justify-between gap-2 h-40 pt-2">
      {months.map((m, i) => (
        <div key={m + i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
          <div className="w-full flex flex-col-reverse items-center" style={{ height: "128px" }}>
            {BAND_META.map(b => { const v = series[b.key]?.[i] ?? 0; if (!v) return null; return <div key={b.key} className="w-5 rounded-sm" style={{ height: `${(v / max) * 120}px`, background: b.color }} title={`${b.label}: ${v}`} />; })}
            {sums[i] === 0 && <div className="w-5 h-0.5 bg-gray-100 rounded" />}
          </div>
          <span className="text-[10px] text-gray-400">{m}</span>
        </div>
      ))}
    </div>
  );
}

export default async function QualityCommandCentre() {
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
    loadQualityCommand(admin, hid, isSuper) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="w-9 h-9 rounded-lg bg-rose-50 flex items-center justify-center text-lg">🛡️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Quality &amp; Safety Command Centre</h1><p className="text-sm text-gray-500">Executive overview of quality, safety and compliance performance · {d.scope} scope</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <QualityTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Quality command centre warming up</p><p className="text-sm text-amber-800 mt-1">This centre consolidates incidents, audits, CAPA, the risk register and clinical indicators. Once incidents are logged (Shift Supervisor), audits run, or risks are registered, the dashboards populate automatically.</p></div></div>;

  const k = d.kpis, inc = d.incidents, au = d.audits, capa = d.capa, risk = d.risks, acc = d.accreditation;
  const val = (n: any, suffix = "%") => (n == null ? "—" : `${n}${suffix}`);
  const auditTotal = au.total || 1;

  return (
    <div className="space-y-4">
      {header}

      {/* ── KPI ribbon ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon="⭐" tint="bg-sky-50" label="Quality Score" value={val(k.qualityScore)} tone={k.qualityScore == null ? "text-gray-300" : k.qualityScore >= 85 ? "text-emerald-600" : "text-amber-600"} sub={k.qualityScore == null ? "awaiting data" : "composite"} />
        <Kpi icon="🛡️" tint="bg-emerald-50" label="Patient Safety Index" value={val(k.safetyIndex)} tone={k.safetyIndex == null ? "text-gray-300" : k.safetyIndex >= 85 ? "text-emerald-600" : "text-amber-600"} sub={k.safetyIndex == null ? "awaiting data" : "composite"} />
        <Kpi icon="📋" tint="bg-indigo-50" label="Compliance Score" value={val(k.complianceScore)} tone={k.complianceScore == null ? "text-gray-300" : "text-gray-900"} sub={k.complianceScore == null ? "no completed audits" : "audit compliance"} />
        <Kpi icon="🗂️" tint="bg-amber-50" label="Open CAPAs" value={capa.provisioned ? k.openCapa : "—"} tone={k.openCapa ? "text-amber-600" : "text-gray-400"} sub={capa.provisioned ? `${capa.overdue} overdue` : "not provisioned"} />
        <Kpi icon="❗" tint="bg-rose-50" label="Critical Incidents" value={inc.provisioned ? k.criticalIncidents : "—"} tone={k.criticalIncidents ? "text-rose-600" : "text-gray-400"} sub={inc.provisioned ? `${inc.open} open total` : "not provisioned"} />
        <Kpi icon="⚠️" tint="bg-orange-50" label="High Risks" value={risk.provisioned ? k.highRisks : "—"} tone={k.highRisks ? "text-orange-600" : "text-gray-400"} sub={risk.provisioned ? `of ${risk.total} on register` : "not provisioned"} />
      </div>

      {/* ── Incident trend · audit compliance · alerts ─────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-1">Incident Trend <span className="text-[10px] text-gray-400 font-normal">last 6 months</span></h3>
          {inc.provisioned ? (<>
            <IncidentTrend months={inc.trend.months} series={inc.trend.series} />
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3">{BAND_META.map(b => <span key={b.key} className="flex items-center gap-1 text-[11px] text-gray-500"><span className="w-2 h-2 rounded-sm" style={{ background: b.color }} />{b.label} <b className="tabular-nums text-gray-700">{inc.totals[b.key] ?? 0}</b></span>)}</div>
          </>) : <p className="text-sm text-gray-400 py-10 text-center">Incident register not provisioned.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Audit Compliance <span className="text-[10px] text-gray-400 font-normal">this period</span></h3>
          {au.provisioned && au.total > 0 ? (
            <div className="flex items-center gap-4">
              <Donut pct={au.avgCompliance ?? 0} color="#10b981" center={au.avgCompliance != null ? `${au.avgCompliance}%` : "—"} sub="compliant" />
              <div className="text-[11px] text-gray-600 space-y-1.5 min-w-0">
                <Row color="#10b981" label="Completed" v={`${au.completed} (${Math.round((au.completed / auditTotal) * 100)}%)`} />
                <Row color="#3b82f6" label="In progress" v={au.inProgress} />
                <Row color="#f59e0b" label="Planned" v={au.planned} />
                <div className="border-t border-gray-100 pt-1.5 flex justify-between"><span className="text-gray-500">Total audits</span><b className="tabular-nums text-gray-800">{au.total}</b></div>
                {au.findingsOpen > 0 && <p className="text-[10px] text-rose-500">{au.findingsOpen} open findings · {au.findingsCritical} critical</p>}
              </div>
            </div>
          ) : <p className="text-sm text-gray-400 py-10 text-center">No audits recorded yet.</p>}
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Alerts &amp; Notifications</h3>{d.alerts.length > 0 && <span className="text-[10px] font-bold bg-rose-500 text-white rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">{d.alerts.length}</span>}</div>
          {d.alerts.length ? (
            <div className="space-y-2">{d.alerts.map((a: any, i: number) => (
              <div key={i} className="flex items-start gap-2">
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${a.level === "high" ? "bg-rose-500" : a.level === "medium" ? "bg-amber-400" : "bg-sky-400"}`} />
                <div className="min-w-0"><p className="text-xs font-medium text-gray-800 leading-snug">{a.title}</p><p className="text-[11px] text-gray-400">{a.detail}</p></div>
              </div>
            ))}</div>
          ) : <p className="text-sm text-gray-400 py-8 text-center">No active alerts. 🎉</p>}
        </div>
      </div>

      {/* ── CAPA pipeline · patient safety · risk heat map ─────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">CAPA Pipeline</h3>
          {capa.provisioned && capa.total > 0 ? (
            <div className="space-y-2">
              <Pipe label="Open" n={capa.open} total={capa.total} color="#3b82f6" />
              <Pipe label="In progress" n={capa.inProgress} total={capa.total} color="#10b981" />
              <Pipe label="Overdue" n={capa.overdue} total={capa.total} color="#ef4444" />
              <Pipe label="Completed" n={capa.completed} total={capa.total} color="#94a3b8" />
              <Link href="/unit-manager/capa" className="inline-block text-[11px] font-medium text-rose-700 hover:underline mt-1">Go to CAPA Centre →</Link>
            </div>
          ) : <p className="text-sm text-gray-400 py-8 text-center">No CAPA actions yet. Raise them in the <Link href="/unit-manager/capa" className="text-rose-700 hover:underline">CAPA Centre</Link>.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Patient Safety <span className="text-[10px] text-gray-400 font-normal">open incidents by type</span></h3>
          {inc.provisioned ? (
            <div className="grid grid-cols-2 gap-2">{inc.byType.map((t: any) => (
              <div key={t.type} className="rounded-lg border border-gray-100 p-2.5"><p className="text-[11px] text-gray-500 truncate">{t.label}</p><p className={`text-xl font-bold tabular-nums ${t.n ? "text-gray-900" : "text-gray-300"}`}>{t.n}</p></div>
            ))}</div>
          ) : <p className="text-sm text-gray-400 py-8 text-center">Incident register not provisioned.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Risk Heat Map <span className="text-[10px] text-gray-400 font-normal">5×5 · likelihood × impact</span></h3>
          {risk.provisioned && risk.total > 0 ? (
            <div className="flex gap-2">
              <div className="flex flex-col justify-between text-[9px] text-gray-400 py-1"><span>5</span><span>Likelihood</span><span>1</span></div>
              <div className="flex-1">
                <div className="grid grid-cols-5 gap-1">
                  {[5, 4, 3, 2, 1].map(l => [1, 2, 3, 4, 5].map(im => { const n = risk.heat[l - 1][im - 1]; const score = l * im; return <div key={`${l}-${im}`} className={`aspect-square rounded flex items-center justify-center text-[11px] font-bold ${n ? riskCellTone(score) : "bg-gray-50 text-gray-200"}`} title={`Likelihood ${l} × Impact ${im} = ${score}`}>{n || ""}</div>; }))}
                </div>
                <div className="flex justify-between text-[9px] text-gray-400 mt-1 px-0.5"><span>1</span><span>Impact</span><span>5</span></div>
              </div>
            </div>
          ) : <p className="text-sm text-gray-400 py-8 text-center">No open risks on the register.</p>}
        </div>
      </div>

      {/* ── Top risks · accreditation · AI insights ───────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Top Risks</h3><Link href="/unit-manager/quality/risk" className="text-[11px] text-rose-700 hover:underline">View all →</Link></div>
          {risk.provisioned && risk.top.length ? (
            <div className="space-y-1.5">{risk.top.map((r: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={`w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0 ${riskCellTone(r.score)}`}>{r.score}</span>
                <div className="min-w-0 flex-1"><p className="text-gray-800 truncate">{r.title}</p><p className="text-[10px] text-gray-400 capitalize truncate">{r.category}{r.owner ? ` · ${r.owner}` : ""}</p></div>
                <span className="text-[10px] text-gray-400 shrink-0 capitalize">{r.status}</span>
              </div>
            ))}</div>
          ) : <p className="text-sm text-gray-400 py-8 text-center">No risks registered.</p>}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Accreditation Readiness</h3>
          <div className="flex items-center gap-4">
            <Donut pct={acc.readiness ?? 0} color="#14b8a6" center={acc.readiness != null ? `${acc.readiness}%` : "—"} sub="readiness" />
            <div className="text-[11px] text-gray-600 space-y-1.5">
              <Row color="#14b8a6" label="Quality standards" v={acc.standards} />
              <Row color="#0ea5e9" label="Active indicators" v={acc.indicators} />
              <Row color="#8b5cf6" label="Quality objects" v={acc.objects} />
              <Link href="/quality-accreditation" className="inline-block text-[11px] font-medium text-rose-700 hover:underline pt-0.5">Accreditation workspace →</Link>
            </div>
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Readiness is derived from audit compliance; the full framework-by-framework assessment (JCI, SafeCare) lives in the accreditation workspace.</p>
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-3"><span className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center text-sm">🤖</span><h3 className="font-semibold text-gray-900 text-sm">AI Quality Insights</h3><span className="text-[10px] text-gray-400">rule-based</span></div>
          {d.ai.length ? (
            <div className="space-y-2">{d.ai.map((a: any, i: number) => (
              <Link key={i} href={a.href} className="block rounded-lg border border-gray-100 p-2.5 hover:border-violet-200 transition-colors">
                <div className="flex items-start gap-2"><span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${a.priority === "high" ? "bg-rose-500" : a.priority === "medium" ? "bg-amber-400" : "bg-emerald-500"}`} />
                  <div className="min-w-0"><p className="text-xs font-medium text-gray-800 leading-snug">{a.text}</p><p className="text-[10px] text-gray-400 mt-0.5">{a.why}</p><span className="text-[10px] font-semibold text-violet-700">{a.action} →</span></div>
                </div>
              </Link>
            ))}</div>
          ) : <p className="text-sm text-gray-400 py-8 text-center">No quality signals to action right now.</p>}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Quality &amp; Safety Command Centre (UMG-QS-001) — a consolidation surface composing the incident register (op_incidents), operational quality actions / CAPA (op_quality_actions), audits &amp; findings (audits/audit_findings), the enterprise 5×5 risk register (gov_risks) and clinical indicators (quality_indicators). No new store. Real: the KPI ribbon, incident trend, audit-compliance donut, CAPA pipeline, patient-safety breakdown, risk heat map, top risks, alerts and rule-based AI insights. Business rules honoured: critical incidents require RCA before closure, high risks (rating ≥ 15) escalate to Executive Actions. Honest next-phase: the 12-month composite quality trend (needs an analytics-snapshot history) and Mortality &amp; Morbidity (no store). Data as of {d.asOf}. Gate hospital_admin/super_admin.</p>
    </div>
  );
}

function Row({ color, label, v }: { color: string; label: string; v: any }) {
  return <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color }} /><span className="text-gray-500">{label}</span><b className="ml-auto tabular-nums text-gray-700">{v}</b></div>;
}
function Pipe({ label, n, total, color }: { label: string; n: number; total: number; color: string }) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return <div><div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600">{label}</span><b className="tabular-nums text-gray-800">{n}</b></div><div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} /></div></div>;
}
