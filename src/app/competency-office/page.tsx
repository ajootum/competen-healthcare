import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCmoDashboard } from "@/lib/cmo-dashboard";
import { loadCmoGovernance } from "@/lib/competency/cmo-governance";
import { officeForWorkspace, holdsOfficeAppointment } from "@/lib/ogs/office";
import { GovernanceBanner } from "@/components/GovernanceBanner";
import { estateRolesOf } from "@/lib/roles";

export const dynamic = "force-dynamic";

// Competency Dashboard (CMO-001) — the operational home page of the Competency Management Operations
// workspace (CMO-000). Real-time visibility of workforce competence, compliance and operational
// readiness. The 12 spec widgets are computed once in loadCmoDashboard from live competency data
// (competency_decisions + framework/CPU governance). Design follows the CMO-001 mockup; every value
// is real or an honest state — trend deltas / sparklines are NOT fabricated (they need a retained
// readiness-snapshot history, an honest next-phase).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const pctTone = (n: number) => (n >= 90 ? "text-[var(--cmp-text-success)]" : n >= 75 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]");
const riskOf = (n: number) => (n >= 90 ? { label: "Low Risk", tone: "bg-[var(--cmp-surface-success)] text-emerald-700" } : n >= 80 ? { label: "Medium Risk", tone: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" } : { label: "High Risk", tone: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]" });
const todayLabel = () => new Date().toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
const DOMAIN_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

// Trend sparkline (real, from readiness snapshots — renders only with ≥2 days of history).
function Sparkline({ series, color }: { series: number[]; color: string }) {
  if (!series || series.length < 2) return null;
  const w = 100, h = 26, max = Math.max(...series), min = Math.min(...series), range = (max - min) || 1;
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`).join(" ");
  return <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden className="mt-2"><polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

function Kpi({ icon, tint, label, value, sub, tone, href, trend }: { icon: string; tint: string; label: string; value: any; sub?: string; tone?: string; href: string; trend?: { series: number[]; delta: number | null; good: "up" | "down"; unit?: string; color: string } }) {
  const delta = trend?.delta;
  const showDelta = delta != null && delta !== 0;
  const good = showDelta && ((delta! > 0 && trend!.good === "up") || (delta! < 0 && trend!.good === "down"));
  return (
    <Link href={href} className={`${card} p-4 hover:border-teal-300 transition-colors block`}>
      <div className="flex items-center gap-2.5 mb-2">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${tint}`}>{icon}</span>
        <span className="text-xs font-medium text-gray-500 leading-tight">{label}</span>
      </div>
      <div className={`text-3xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</div>
      {showDelta
        ? <div className={`text-[11px] mt-0.5 font-medium ${good ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{delta! > 0 ? "↑" : "↓"} {Math.abs(delta!)}{trend!.unit ?? ""} vs yesterday</div>
        : sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
      {trend && <Sparkline series={trend.series} color={trend.color} />}
    </Link>
  );
}

export default async function CompetencyDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = estateRolesOf(profile);
  const isSuper = roles.includes("super_admin");
  // R001 appointment-based access (additive): a role holder OR an active Competency Office member may enter.
  const roleOk = roles.some(r => ["hospital_admin", "educator", "super_admin"].includes(r));
  const apptOk = roleOk ? false : await holdsOfficeAppointment(admin, "competency", profile?.hospital_id ?? null, isSuper, user.id);
  if (!roleOk && !apptOk) redirect("/dashboard");

  const [d, gov, hosp, office] = await Promise.all([
    loadCmoDashboard(admin, profile?.hospital_id ?? null, isSuper),
    loadCmoGovernance(admin, profile?.hospital_id ?? null, isSuper),
    profile?.hospital_id ? admin.from("hospitals").select("name").eq("id", profile.hospital_id).maybeSingle() : Promise.resolve({ data: null }),
    officeForWorkspace(admin, "competency", profile?.hospital_id ?? null, isSuper, user.id),
  ]);
  const GOV_HEX: Record<string, string> = { slate: "#94a3b8", amber: "#f59e0b", blue: "#3b82f6", violet: "#a855f7", emerald: "#22c55e" };
  const hospitalName = isSuper ? "Enterprise" : (hosp?.data?.name ?? "Your hospital");
  const domTotal = d.domains.reduce((s: number, x: any) => s + x.total, 0) || 1;
  const donut = d.domains.length
    ? (() => { let acc = 0; const segs = d.domains.map((dom: any, i: number) => { const a = (acc / domTotal) * 360; acc += dom.total; const b = (acc / domTotal) * 360; return `${DOMAIN_COLORS[i % DOMAIN_COLORS.length]} ${a}deg ${b}deg`; }); return `conic-gradient(${segs.join(", ")})`; })()
    : "conic-gradient(#e5e7eb 0deg 360deg)";

  return (
    <div className="space-y-4">
      {/* Header + filters */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Competency Dashboard</h1>
          <p className="text-sm text-gray-500">Real-time visibility of workforce competence, compliance and operational readiness</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-700">🏥 {hospitalName}</span>
          <span className="text-xs bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-700">📅 {todayLabel()}</span>
        </div>
      </div>

      {/* OGS R001 — this workspace operates as a governed Office */}
      <GovernanceBanner office={office} />

      {/* COMP-011 governance & publication strip — the Office governs (approve, publish, version, monitor) */}
      {gov.provisioned && (
        <div className={`${card} p-4`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 text-sm">Governance &amp; Publication</h3>
            <Link href="/competency-office/publishing" className="text-[11px] text-teal-600 hover:underline">Governance hub →</Link>
          </div>
          <div className="flex items-center gap-1 overflow-x-auto">
            {gov.pipeline.map((s: any, i: number) => (
              <div key={s.stage} className="flex items-center gap-1 shrink-0">
                <div className="flex flex-col items-center text-center w-[88px]">
                  <span className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold tabular-nums" style={{ backgroundColor: (GOV_HEX[s.tone] ?? "#94a3b8") + "22", color: GOV_HEX[s.tone] ?? "#94a3b8" }}>{s.n}</span>
                  <span className="text-[10.5px] text-gray-600 mt-1 leading-tight">{s.stage}</span>
                </div>
                {i < gov.pipeline.length - 1 && <span className="text-gray-300">→</span>}
              </div>
            ))}
            <div className="border-l border-gray-100 h-10 mx-2 shrink-0" />
            <div className="shrink-0 text-center px-2"><p className={`text-lg font-bold tabular-nums ${gov.kpis.approvalPending ? "text-violet-600" : "text-gray-900"}`}>{gov.kpis.approvalPending}</p><p className="text-[10px] text-gray-400">approval pending</p></div>
            <div className="shrink-0 text-center px-2"><p className={`text-lg font-bold tabular-nums ${gov.kpis.retiringSoon ? "text-[var(--cmp-text-error)]" : "text-gray-900"}`}>{gov.kpis.retiringSoon}</p><p className="text-[10px] text-gray-400">review due</p></div>
          </div>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon="🛡️" tint="bg-[var(--cmp-surface-success)]" label="Organisation Readiness" value={`${d.readiness.score}%`} sub={`${d.readiness.current}/${d.readiness.total} current`} href="/competency-office/readiness" trend={d.trends ? { ...d.trends.readiness, good: "up", unit: "%", color: "#10b981" } : undefined} />
        <Kpi icon="⚠️" tint="bg-[var(--cmp-surface-error)]" label="At Risk Units" value={d.highRiskUnits.length} sub={`below ${d.highRiskThreshold}%`} href="/competency-office/readiness" trend={d.trends ? { ...d.trends.atRisk, good: "down", color: "#ef4444" } : undefined} />
        <Kpi icon="📅" tint="bg-[var(--cmp-surface-warning)]" label="Expiring (30 Days)" value={d.expiring.d30} sub={`${d.expiring.individuals} individuals`} href="/competency-office/credentialing" trend={d.trends ? { ...d.trends.expiring, good: "down", color: "#f59e0b" } : undefined} />
        <Kpi icon="📋" tint="bg-[var(--cmp-surface-information)]" label="Assessments Today" value={d.assessments.provisioned ? d.assessments.total : "—"} sub={d.assessments.provisioned ? `${d.assessments.completed} completed` : "cycle data"} href="/competency-office/assessments" trend={d.trends ? { ...d.trends.assessments, good: "up", color: "#0ea5e9" } : undefined} />
        <Kpi icon="📁" tint="bg-violet-50" label="Evidence Pending" value={d.awaitingValidation} sub="awaiting validation" href="/competency-office/validation" trend={d.trends ? { ...d.trends.evidence, good: "down", color: "#8b5cf6" } : undefined} />
        <Kpi icon="✨" tint="bg-teal-50" label="Compliance Score" value={`${d.complianceScore}%`} sub="validated & current" href="/competency-office/compliance" trend={d.trends ? { ...d.trends.compliance, good: "up", unit: "%", color: "#14b8a6" } : undefined} />
      </div>

      {/* Operational readiness + risk + domain row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Workforce Readiness by Unit */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Workforce Readiness by Unit</h3><Link href="/competency-office/readiness" className="text-[11px] text-teal-600 hover:underline">Full report →</Link></div>
          <div className="flex gap-1 mb-3">
            <span className="text-[11px] bg-teal-700 text-white rounded-md px-2.5 py-1">By Unit</span>
            <span className="text-[11px] text-gray-400 rounded-md px-2.5 py-1" title="Grouping by department needs unit→department mapping (next-phase)">By Department</span>
            <span className="text-[11px] text-gray-400 rounded-md px-2.5 py-1" title="Grouping by role needs role mapping (next-phase)">By Role</span>
          </div>
          {!d.decisionsReady || d.workforceByCpu.length === 0 ? <p className="text-sm text-gray-400">No competency decisions with a CPU yet.</p> : (
            <table className="w-full text-xs">
              <thead><tr className="text-[10px] uppercase tracking-wide text-gray-400 text-left border-b border-gray-100"><th className="py-1.5 font-medium">Unit</th><th className="py-1.5 font-medium text-right">Req</th><th className="py-1.5 font-medium text-right">Avail</th><th className="py-1.5 font-medium text-right">Cover</th><th className="py-1.5 font-medium text-right">Readiness</th></tr></thead>
              <tbody>{d.workforceByCpu.slice(0, 6).map((u: any) => { const r = riskOf(u.pct); return (
                <tr key={u.id} className="border-b border-gray-50"><td className="py-2 text-gray-700 truncate max-w-[9rem]">{u.name}</td><td className="py-2 text-right text-gray-600 tabular-nums">{u.total}</td><td className="py-2 text-right text-gray-600 tabular-nums">{u.current}</td><td className="py-2 text-right font-semibold tabular-nums">{u.pct}%</td><td className="py-2 text-right"><span className={`text-[9px] px-1.5 py-0.5 rounded ${r.tone}`}>{r.label}</span></td></tr>
              ); })}</tbody>
            </table>
          )}
        </div>

        {/* Competency Risk Alerts */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Competency Risk Alerts</h3><Link href="/competency-office/readiness" className="text-[11px] text-teal-600 hover:underline">View all →</Link></div>
          {d.risks.length === 0 ? <p className="text-sm text-gray-400">No critical competency risks. 🎉</p> : (
            <div className="space-y-2">{d.risks.slice(0, 4).map((r: any, i: number) => (
              <div key={i} className={`rounded-lg border p-2.5 ${r.severity === "high" ? "border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)]/40" : "border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)]/40"}`}>
                <div className="flex items-start gap-2"><span className="text-sm">{r.severity === "high" ? "🩸" : "⚠️"}</span><div className="min-w-0"><p className="text-xs font-semibold text-gray-800">{r.label}</p><p className="text-[11px] text-gray-500">{r.detail}</p></div></div>
              </div>
            ))}</div>
          )}
        </div>

        {/* Readiness by Competency Domain */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Readiness by Competency Domain</h3><Link href="/competency-office/analytics" className="text-[11px] text-teal-600 hover:underline">Analytics →</Link></div>
          {d.domains.length === 0 ? <p className="text-sm text-gray-400">Domain readiness needs competency-to-domain mapping.</p> : (
            <div className="flex items-center gap-4">
              <div className="relative w-28 h-28 shrink-0 rounded-full" style={{ background: donut }}>
                <div className="absolute inset-[24%] rounded-full bg-white flex flex-col items-center justify-center"><span className={`text-lg font-bold ${pctTone(d.readiness.score)}`}>{d.readiness.score}%</span><span className="text-[8px] text-gray-400">Ready</span></div>
              </div>
              <div className="flex-1 space-y-1">{d.domains.slice(0, 6).map((dom: any, i: number) => (
                <div key={dom.name} className="flex items-center gap-1.5 text-[11px]"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: DOMAIN_COLORS[i % DOMAIN_COLORS.length] }} /><span className="text-gray-600 flex-1 truncate">{dom.name}</span><b className={`tabular-nums ${pctTone(dom.pct)}`}>{dom.pct}%</b></div>
              ))}</div>
            </div>
          )}
        </div>
      </div>

      {/* Expiring / Assessment / Validation / AI row */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Expiring Competencies */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Expiring Competencies</h3><Link href="/competency-office/credentialing" className="text-[11px] text-teal-600 hover:underline">All →</Link></div>
          {d.expiringPeople.length === 0 ? <p className="text-sm text-gray-400">Nothing expiring in 60 days.</p> : (
            <div className="space-y-2.5">{d.expiringPeople.map((p: any, i: number) => (
              <div key={i} className="flex items-center gap-2.5"><span className="w-7 h-7 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-bold shrink-0">{(p.name?.[0] ?? "?").toUpperCase()}</span><div className="min-w-0 flex-1"><p className="text-xs font-medium text-gray-800 truncate">{p.name}</p><p className="text-[10px] text-gray-400 truncate">{p.competency}</p></div>{p.days != null && <span className={`text-[10px] font-medium shrink-0 ${p.days <= 7 ? "text-[var(--cmp-text-error)]" : p.days <= 14 ? "text-[var(--cmp-text-warning)]" : "text-gray-500"}`}>{p.days}d</span>}</div>
            ))}</div>
          )}
        </div>

        {/* Assessment Activity */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Assessment Activity</h3><Link href="/competency-office/assessments" className="text-[11px] text-teal-600 hover:underline">Centre →</Link></div>
          {d.assessmentActivity.length === 0 ? <p className="text-sm text-gray-400">No recent assessment activity.</p> : (
            <div className="space-y-2.5">{d.assessmentActivity.slice(0, 4).map((a: any, i: number) => (
              <div key={i} className="flex items-start gap-2"><span className="text-sm">📋</span><div className="min-w-0"><p className="text-xs font-medium text-gray-800 capitalize truncate">{a.method}</p><p className="text-[10px] text-gray-400 capitalize">{(a.status ?? "").replace(/_/g, " ")}</p></div></div>
            ))}</div>
          )}
        </div>

        {/* Validation Queue */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Validation Queue</h3><Link href="/competency-office/validation" className="text-[11px] text-teal-600 hover:underline">Queue →</Link></div>
          {d.validationList.length === 0 ? <p className="text-sm text-gray-400">Validation queue clear.</p> : (
            <div className="space-y-2.5">{d.validationList.slice(0, 4).map((v: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="text-xs font-medium text-gray-800 truncate">{v.competency}</p><p className="text-[10px] text-gray-400 truncate">{v.nurse}</p></div><span className={`text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0 ${v.status === "review" ? "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" : "bg-violet-50 text-violet-700"}`}>{v.status}</span></div>
            ))}</div>
          )}
        </div>

        {/* AI Competency Insights */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">AI Competency Insights</h3><Link href="/competency-office/ai" className="text-[11px] text-teal-600 hover:underline">Intelligence →</Link></div>
          {d.ai.length === 0 ? <p className="text-sm text-gray-400">No priority actions.</p> : (
            <div className="space-y-2.5">{d.ai.slice(0, 4).map((a: any, i: number) => (
              <div key={i} className="flex items-start gap-2"><span className="text-sm">{a.priority === "high" ? "🔴" : a.priority === "medium" ? "💡" : "📈"}</span><div className="min-w-0"><p className="text-xs font-medium text-gray-800 leading-tight">{a.text}</p><p className="text-[10px] text-gray-400 mt-0.5">Why: {a.why}</p></div></div>
            ))}</div>
          )}
        </div>
      </div>

      {/* Quick Access / Recent Updates / System Health */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Quick Access</h3>
          <div className="grid grid-cols-2 gap-2">
            {[["🔍", "Search People", "/competency-office/readiness"], ["📚", "Competency Library", "/competency-office/library"], ["🗂️", "Frameworks", "/competency-office/frameworks"], ["🧾", "Reports", "/competency-office/analytics"], ["✅", "My Tasks", "/competency-office/validation"]].map(([icon, label, href]) => (
              <Link key={href} href={href} className="border border-gray-200 rounded-lg p-3 hover:border-teal-300 hover:bg-teal-50/30 transition-colors"><div className="text-base mb-1">{icon}</div><p className="text-xs font-medium text-gray-700">{label}</p></Link>
            ))}
          </div>
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Recent Updates</h3></div>
          <div className="space-y-1.5 text-sm">
            {[["evidence items", d.recentUpdates.evidence, "📎"], ["assessment events", d.recentUpdates.assessments, "📋"], ["competency decisions", d.recentUpdates.competencies, "✅"], ["framework changes", d.recentUpdates.frameworks, "🗂️"]].map(([label, n, icon]: any) => (
              <div key={label} className="flex items-center gap-2"><span>{icon}</span><span className="text-gray-600 flex-1">{label}</span><b className="tabular-nums text-gray-800">{n}</b></div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Counts of recent competency events (audit log).</p>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">System Health</h3>
          <div className={`rounded-lg p-3 flex items-center gap-2.5 ${d.ready ? "bg-[var(--cmp-surface-success)]" : "bg-[var(--cmp-surface-warning)]"}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${d.ready ? "bg-[var(--cmp-color-success)]" : "bg-[var(--cmp-color-warning)]"}`} />
            <span className={`text-sm font-medium ${d.ready ? "text-emerald-800" : "text-amber-800"}`}>{d.ready ? "Competency data operational" : "Awaiting competency data"}</span>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">As of {todayLabel()}. Every calculation is tenant-scoped; readiness recalculates on validation.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Competency Dashboard (CMO-001) over the live competency spine (competency_decisions) + framework/CPU governance. Real: readiness, compliance, at-risk units, expiring competencies &amp; named individuals, workforce readiness by unit, risk alerts, domain readiness, validation queue, assessment activity, recent updates, rule-based explainable AI insights and the KPI trend sparklines/deltas (daily readiness snapshots, migration 088 — sparklines build once ≥2 days are recorded; per-hospital, so no trend at enterprise scope yet). Honest next-phase: By-Department/Role grouping, per-widget export/filter and enterprise-aggregate trends.</p>
    </div>
  );
}
