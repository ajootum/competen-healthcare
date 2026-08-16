import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadRosterGovernance } from "@/lib/operations/roster-governance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import RosterGovTabs from "./RosterGovTabs";
import { KpiWithFoot as Kpi } from "../_kit";
import { estateRolesOf } from "@/lib/roles";

export const dynamic = "force-dynamic";

// Governance Overview (UMW-WFM-004 §8) — the live summary of roster readiness: overall
// assurance score (with a hard publish-block a high score can't override), roster status,
// coverage readiness, critical exceptions, skill-mix, supervisor coverage, working-time,
// fairness, cost and recent activity. Real over the roster store + WSE engines. Every widget
// carries its source footnote (§31). Approval progress / acknowledgement need workflow stores
// → honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const BAND: Record<string, { tone: string; ring: string }> = {
  "Ready": { tone: "text-[var(--cmp-text-success)]", ring: "#10b981" },
  "Review required": { tone: "text-[var(--cmp-text-warning)]", ring: "#f59e0b" },
  "Material risks": { tone: "text-[var(--cmp-text-warning)]", ring: "#f97316" },
  "Not publishable": { tone: "text-[var(--cmp-text-error)]", ring: "#e11d48" },
  "—": { tone: "text-gray-400", ring: "#e5e7eb" },
};
const STATUS_BADGE: Record<string, string> = { draft: "bg-gray-100 text-gray-600", published: "bg-[var(--cmp-surface-success)] text-emerald-700", archived: "bg-gray-100 text-gray-400" };
const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";

export default async function GovernanceOverview() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = estateRolesOf(profile);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadRosterGovernance(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">📋</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Roster Governance</h1><p className="text-sm text-gray-500">Review, validate, approve, publish and monitor the workforce roster — the assurance layer above the Scheduling Engine.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <RosterGovTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Roster store not provisioned</p><p className="text-sm text-amber-800 mt-1">Migration 080 (op_rosters) is required. Roster Governance activates once a roster has been generated in the <Link href="/unit-manager/scheduling-engine" className="underline">Scheduling Engine</Link>.</p></div></div>;

  if (!d.hasRoster) return <div className="space-y-4">{header}<div className="bg-white border border-gray-200 rounded-xl p-6"><p className="font-semibold text-gray-800">No roster for the current week</p><p className="text-sm text-gray-500 mt-1">There is no generated roster for week starting {fmtDate(d.weekStart)}. Generate one in the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link>, then govern it here — review, validate, approve and publish.</p></div></div>;

  const a = d.assurance;
  const b = BAND[a.band] ?? BAND["—"];

  return (
    <div className="space-y-4">
      {header}

      {/* Roster status strip */}
      <div className={`${card} p-4 flex items-center gap-4 flex-wrap`}>
        <div><p className="text-[10px] text-gray-400 uppercase">Cycle</p><p className="text-sm font-semibold text-gray-800">Week of {fmtDate(d.weekStart)}</p></div>
        <div><p className="text-[10px] text-gray-400 uppercase">Version</p><p className="text-sm font-semibold text-gray-800">v{d.roster.version}</p></div>
        <div><p className="text-[10px] text-gray-400 uppercase">Status</p><span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_BADGE[d.roster.status] ?? "bg-gray-100 text-gray-500"}`}>{d.roster.status}</span></div>
        <div><p className="text-[10px] text-gray-400 uppercase">Generated</p><p className="text-sm text-gray-700">{fmtDate(d.roster.generatedAt)}{d.roster.generatedByName ? ` · ${d.roster.generatedByName}` : ""}</p></div>
        <div><p className="text-[10px] text-gray-400 uppercase">Published</p><p className="text-sm text-gray-700">{d.roster.publishedAt ? `${fmtDate(d.roster.publishedAt)}${d.roster.publishedByName ? ` · ${d.roster.publishedByName}` : ""}` : "Not published"}</p></div>
        <Link href="/unit-manager/scheduling-engine" className="ml-auto text-[11px] font-semibold text-emerald-700 hover:underline">Open in Scheduling Engine ↗</Link>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Assurance score */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-1">Overall roster assurance <span className="text-[9px] text-gray-300">¹</span></h3>
          <div className="flex items-center gap-4 mt-3">
            <div className="relative w-24 h-24 shrink-0"><div className="w-24 h-24 rounded-full" style={{ background: a.score != null ? `conic-gradient(${b.ring} ${a.score}%, #f1f5f9 0)` : "#f1f5f9" }} /><div className="absolute inset-[18%] rounded-full bg-white flex flex-col items-center justify-center"><span className={`text-2xl font-bold ${b.tone}`}>{a.score ?? "—"}</span><span className="text-[9px] text-gray-400">/ 100</span></div></div>
            <div className="min-w-0"><p className={`text-sm font-bold ${b.tone}`}>{a.band}</p><p className="text-[11px] text-gray-500 mt-0.5">{a.publishable ? "No blocking conditions detected." : "Publication blocked by a critical rule."}</p></div>
          </div>
          {!a.publishable && a.blockingReasons.length > 0 && (
            <div className="mt-3 rounded-lg border border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)]/40 p-2.5"><p className="text-[10px] font-semibold text-[var(--cmp-text-error)] uppercase">Publish blocked</p><ul className="mt-1 space-y-0.5">{a.blockingReasons.map((r: string, i: number) => (<li key={i} className="text-[11px] text-gray-700">• {r}</li>))}</ul></div>
          )}
          <div className="mt-3 space-y-1">{a.components.map((c: any) => (<div key={c.key} className="flex items-center gap-2 text-[11px]"><span className="text-gray-500 w-36 truncate">{c.label}</span><div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${c.score == null ? "bg-gray-200" : c.score >= 90 ? "bg-[var(--cmp-color-success)]" : c.score >= 75 ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-error)]"}`} style={{ width: `${c.score ?? 0}%` }} /></div><span className="text-gray-600 w-8 text-right font-medium">{c.score != null ? `${c.score}` : "—"}</span></div>))}</div>
          <p className="text-[9px] text-gray-400 mt-2">Weighted composite; a critical safety block caps publishability regardless of score (§8.2).</p>
        </div>

        {/* Coverage readiness + supervisor */}
        <div className="space-y-4 xl:col-span-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Kpi label="Coverage" value={d.coverage.coveragePct != null ? `${d.coverage.coveragePct}%` : "—"} sub={`${d.coverage.filledPosts}/${d.coverage.totalPosts} posts`} tone={d.coverage.coveragePct != null && d.coverage.coveragePct >= 95 ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"} foot="³" />
            <Kpi label="Fully covered" value={d.coverage.fullyCovered} sub={`of ${d.coverage.totalShifts} shifts`} foot="³" />
            <Kpi label="Uncovered shifts" value={d.coverage.uncoveredShifts} sub={d.coverage.partialShifts ? `${d.coverage.partialShifts} partial` : "none partial"} tone={d.coverage.uncoveredShifts ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]"} foot="³" />
            <Kpi label="Supervisor coverage" value={d.supervisor.score != null ? `${d.supervisor.score}%` : "—"} sub={`${d.supervisor.confirmed}/${d.supervisor.required} shifts`} tone={d.supervisor.uncovered ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]"} foot="⁶" />
            <Kpi label="Skill-mix match" value={d.skillMix.competencyScore != null ? `${d.skillMix.competencyScore}%` : "—"} sub={d.skillMix.expiredCerts ? `${d.skillMix.expiredCerts} expired` : "current"} tone={d.skillMix.competencyScore != null && d.skillMix.competencyScore >= 90 ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"} foot="⁵" />
            <Kpi label="Working-time" value={d.workingTime.score != null ? `${d.workingTime.score}%` : "—"} sub={`${d.workingTime.critical} critical · ${d.workingTime.warnings} warn`} tone={d.workingTime.critical ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]"} foot="⁷" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi label="Fairness index" value={d.fairness.overall != null ? `${d.fairness.overall}` : "—"} sub={d.fairness.biasAlerts ? `${d.fairness.biasAlerts} alerts` : "balanced"} tone={d.fairness.overall != null && d.fairness.overall >= 80 ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"} foot="⁸" />
            <Kpi label="Est. cost" value={d.cost.totalLabour != null ? `£${(d.cost.totalLabour / 1000).toFixed(1)}k` : "—"} sub={d.cost.variance != null ? `${d.cost.variance >= 0 ? "+" : ""}£${Math.round(d.cost.variance / 100) / 10}k vs plan` : "planning est."} foot="⁹" />
            <Kpi label="Overtime" value={d.cost.overtimeHours != null ? `${d.cost.overtimeHours}h` : "—"} sub="This cycle" tone={d.cost.overtimeHours ? "text-[var(--cmp-text-warning)]" : undefined} foot="⁹" />
            <Kpi label="Critical exceptions" value={d.exceptions.critical} sub={`${d.exceptions.blocked} blocked posts`} tone={d.exceptions.critical ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]"} foot="⁴" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Critical governance exceptions summary */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Critical governance exceptions <span className="text-[9px] text-gray-300">⁴</span></h3>
          <div className="space-y-2 text-xs">
            {[
              ["Uncovered shifts", d.coverage.uncoveredShifts, "/unit-manager/workforce-management/roster-governance/coverage"],
              ["Missing supervisor", d.supervisor.uncovered, "/unit-manager/workforce-management/roster-governance/skill-mix"],
              ["Competency gaps", d.workingTime.blocked, "/unit-manager/workforce-management/roster-governance/skill-mix"],
              ["Working-time breaches", d.workingTime.critical, "/unit-manager/workforce-management/roster-governance/compliance"],
              ["Over shift limit", d.workingTime.overLimit, "/unit-manager/workforce-management/roster-governance/fairness"],
              ["Expired credentials", d.skillMix.expiredCerts, "/unit-manager/workforce-management/roster-governance/skill-mix"],
            ].map(([label, n, href]) => (
              <Link key={label as string} href={href as string} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 hover:border-[var(--cmp-color-success)] hover:bg-[var(--cmp-surface-success)]/30"><span className="text-gray-700">{label as string}</span><span className={`font-semibold ${(n as number) ? "text-[var(--cmp-text-error)]" : "text-gray-300"}`}>{n as number}</span></Link>
            ))}
          </div>
        </div>

        {/* Highest-risk dates */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Highest-risk dates <span className="text-[10px] text-gray-400 font-normal">by uncovered posts</span></h3>
          {d.coverage.riskDates.length === 0 ? <p className="text-sm text-gray-400">No uncovered posts. 🎉</p> : <div className="space-y-2">{d.coverage.riskDates.map((r: any) => (<div key={r.date} className="flex items-center gap-3 text-xs"><span className="text-gray-700 w-24">{fmtDate(r.date)}</span><div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-[var(--cmp-color-error)] rounded-full" style={{ width: `${Math.min(100, r.gaps * 20)}%` }} /></div><span className="text-[var(--cmp-text-error)] font-semibold w-6 text-right">{r.gaps}</span></div>))}</div>}
          <p className="text-[10px] text-gray-400 mt-3">Approval progress ¹⁰ and staff acknowledgement ¹¹ appear once the approval workflow + publication stores are wired (see Approval &amp; Publication) — shown honestly rather than faked.</p>
        </div>

        {/* Recent governance activity */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Recent governance activity <span className="text-[9px] text-gray-300">¹²</span></h3>
          {d.recentActivity.length === 0 ? <p className="text-sm text-gray-400">No roster governance events yet.</p> : <ol className="space-y-0">{d.recentActivity.map((r: any, i: number) => (<li key={i} className="flex items-start gap-2 py-1.5 border-b border-gray-50 last:border-0"><span className="mt-1 w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" /><div className="min-w-0"><p className="text-[11px] text-gray-700">{r.action === "generate_roster" ? "Roster generated" : r.action === "publish_roster" ? "Roster published" : r.action === "archive_roster" ? "Roster archived" : r.action}</p><p className="text-[10px] text-gray-400">{r.actor_name || "System"} · {fmtDate(r.created_at)}</p></div></li>))}</ol>}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Governance Overview (UMW-WFM-004 §8) composes the current-week roster (op_rosters / op_roster_assignments) with the Scheduling Engine&apos;s constraint, competency, fairness and cost engines into an assurance score and readiness widgets. Footnotes: ¹ validation+exception+approval records · ³ demand vs assignments · ⁴ constraint/competency results · ⁵ competency passports · ⁶ supervisor eligibility · ⁷ working-time rules · ⁸ assignment history · ⁹ pay-rate reference · ¹⁰ approval workflow · ¹¹ acknowledgement records · ¹² audit log. Approval/acknowledgement workflow stores are next-phase. <Link href="/unit-manager/workforce-management" className="text-emerald-700 hover:underline">← Workforce Overview</Link></p>
    </div>
  );
}
