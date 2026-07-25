import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCareerPathways } from "@/lib/operations/career-pathways";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import LearningTabs from "../LearningTabs";

export const dynamic = "force-dynamic";

// Career Pathways & Progression (LDS-004) — the Unit Manager's talent & succession / progression-
// readiness oversight over the competency readiness system + the shared career ladder. Design adapts
// the LDS-004 mockup for manager oversight (unit-wide, not a single learner). Real over readiness data;
// honest states for individual target roles, progression plans, applications and mentorship (no stores).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const pctTone = (n: number) => (n >= 90 ? "text-emerald-600" : n >= 75 ? "text-amber-600" : "text-rose-600");
const SEV_TONE: Record<string, string> = { High: "bg-rose-50 text-rose-700", Medium: "bg-amber-50 text-amber-700", Low: "bg-gray-100 text-gray-600" };
const STAT_TONE: Record<string, string> = { Current: "bg-emerald-50 text-emerald-700", Expiring: "bg-amber-50 text-amber-700", Expired: "bg-rose-50 text-rose-700", None: "bg-gray-100 text-gray-500" };

function Kpi({ icon, tint, label, value, sub, tone, href }: { icon: string; tint: string; label: string; value: any; sub?: string; tone?: string; href?: string }) {
  const inner = <div className={`${card} p-4 ${href ? "hover:border-emerald-300 transition-colors" : ""}`}><div className="flex items-center gap-2.5 mb-2"><span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${tint}`}>{icon}</span><span className="text-xs font-medium text-gray-500 leading-tight">{label}</span></div><div className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</div>{sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}</div>;
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default async function CareerPathways() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadCareerPathways(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Career Pathways &amp; Progression</h1><p className="text-sm text-gray-500">Talent &amp; succession — who is ready to progress, and what gaps hold the unit back. Promotion decisions remain human-controlled.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <LearningTabs />
    </>
  );
  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No competency data yet</p><p className="text-sm text-amber-800 mt-1">Career readiness activates once competency decisions are recorded for this unit.</p></div></div>;

  const k = d.kpis, b = d.bands;
  const bandSegs = [["Fully deployable", b.fullyDeployable, "bg-emerald-500"], ["Renewal due", b.renewalDue, "bg-amber-400"], ["Awaiting renewal", b.awaitingRenewal, "bg-rose-500"], ["Awaiting validation", b.awaitingValidation, "bg-gray-300"]] as [string, number, string][];
  const bandTotal = bandSegs.reduce((t, x) => t + x[1], 0) || 1;

  return (
    <div className="space-y-4">
      {header}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon="🎯" tint="bg-emerald-50" label="Unit Readiness" value={`${k.readiness}%`} tone={pctTone(k.readiness)} sub={k.band} />
        <Kpi icon="🚀" tint="bg-teal-50" label="Progression-Ready" value={k.progressionReady} sub={`of ${k.total} staff`} />
        <Kpi icon="🎓" tint="bg-sky-50" label="Requiring Development" value={k.requiringDev} tone={k.requiringDev ? "text-amber-600" : "text-gray-400"} sub="support needed" />
        <Kpi icon="🧩" tint="bg-violet-50" label="Competency Gaps" value={k.competencyGaps} tone={k.competencyGaps ? "text-rose-600" : "text-gray-400"} sub="blocking progression" />
        <Kpi icon="🪪" tint="bg-orange-50" label="Credential Gaps" value={k.credentialGaps} tone={k.credentialGaps ? "text-rose-600" : "text-gray-400"} sub="expired / expiring" href="/competency-office/credentialing" />
        <Kpi icon="👥" tint="bg-gray-50" label="Unit Staff" value={k.total} sub="in scope" />
      </div>

      {/* Career ladder */}
      <div className={`${card} p-5`}>
        <h3 className="font-semibold text-gray-900 text-sm mb-4">Career Progression Ladder</h3>
        <div className="flex items-center justify-between gap-1 overflow-x-auto pb-1">
          {d.ladder.map((stage: any, i: number) => (
            <div key={stage.role} className="flex items-center shrink-0">
              <div className="flex flex-col items-center text-center w-28"><span className="w-10 h-10 rounded-full bg-teal-50 flex items-center justify-center text-lg mb-1">{stage.icon}</span><span className="text-[11px] font-medium text-gray-700 leading-tight">{stage.role}</span></div>
              {i < d.ladder.length - 1 && <span className="text-gray-300 mx-1">→</span>}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-3">The shared progression ladder. Per-staff target-role selection and progression tracking need a career-progression store — honest next-phase.</p>
      </div>

      {/* Readiness distribution + priority gaps */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Readiness Distribution</h3>
          <div className="flex h-5 rounded-md overflow-hidden border border-gray-200 mb-2">{bandSegs.map(([label, n, c], i) => n ? <div key={i} className={c} style={{ width: `${(n / bandTotal) * 100}%` }} title={`${label}: ${n}`} /> : null)}</div>
          <div className="grid grid-cols-2 gap-1.5">{bandSegs.map(([label, n, c], i) => (<div key={i} className="flex items-center gap-1.5 text-xs"><span className={`w-2.5 h-2.5 rounded-sm ${c}`} /><span className="text-gray-600 flex-1">{label}</span><b className="tabular-nums">{n}</b></div>))}</div>
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Priority Career Gaps</h3></div>
          {d.gaps.length === 0 ? <p className="text-sm text-gray-400">No priority gaps. 🎉</p> : (
            <div className="space-y-2">{d.gaps.map((g: any, i: number) => (<div key={i} className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-xs font-medium text-gray-800 truncate">{g.gap}</p><p className="text-[10px] text-gray-400 truncate">{g.detail}</p></div><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${SEV_TONE[g.severity]}`}>{g.severity}</span></div>))}</div>
          )}
        </div>
      </div>

      {/* Staff readiness register + role coverage */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Staff Readiness Register</h3><Link href="/unit-manager/competency" className="text-[11px] text-emerald-600 hover:underline">Competency →</Link></div>
          {d.register.length === 0 ? <p className="text-sm text-gray-400">No staff in scope.</p> : (
            <div className="divide-y divide-gray-50">{d.register.map((s: any, i: number) => (<div key={i} className="flex items-center justify-between gap-2 py-1.5 text-xs"><span className="text-gray-700 truncate">{s.name}</span><span className="flex items-center gap-2 shrink-0"><span className="text-gray-400 truncate max-w-[9rem]">{s.label}</span><span className={`text-[9px] px-1.5 py-0.5 rounded ${STAT_TONE[s.status] ?? "bg-gray-100 text-gray-600"}`}>{s.status}</span></span></div>))}</div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Succession Coverage by Role</h3>
          {d.roleCoverage.length === 0 ? <p className="text-sm text-gray-400">No role coverage data.</p> : (
            <div className="space-y-2">{d.roleCoverage.slice(0, 6).map((r: any) => { const pct = r.total ? Math.round((r.current / r.total) * 100) : 0; return (
              <div key={r.label} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700 truncate">{r.label}</span><span className={`tabular-nums font-semibold ${pctTone(pct)}`}>{r.current}/{r.total} competent</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${pct >= 90 ? "bg-emerald-500" : pct >= 75 ? "bg-amber-400" : "bg-rose-500"}`} style={{ width: `${pct}%` }} /></div></div>
            ); })}</div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Single-person dependencies are succession risks — cross-train to build depth.</p>
        </div>
      </div>

      {/* Honest next-phase */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[["🎯", "Target Roles", "Per-staff target-role selection + readiness against a chosen role."], ["📋", "Progression Plans", "Auto-generated, version-controlled development plans per staff."], ["📄", "Applications", "Progression applications, approvals & review workflow."], ["🤝", "Mentorship", "Mentor assignment, clinical exposure and progress reviews."]].map(([icon, title, blurb]) => (
          <div key={title} className={`${card} p-4`}><h3 className="font-semibold text-gray-900 text-sm mb-2 flex items-center gap-2"><span>{icon}</span>{title}</h3><p className="text-[11px] text-gray-500">{blurb}</p><p className="text-[10px] text-gray-400 mt-1">Honest next-phase — needs its store.</p></div>
        ))}
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Career Pathways &amp; Progression (LDS-004) over the competency readiness system (loadWorkforceReadiness) + the shared career ladder. Real: unit readiness, progression-ready staff, competency &amp; credential gaps, readiness distribution, priority career gaps, staff readiness register and succession coverage by role (single-person dependencies = succession risk). Readiness uses verified records; promotion decisions remain human-controlled. Honest next-phase: individual target-role selection, progression plans, applications, an HR qualification registry and mentorship assignments — each needs its store. Each learner&apos;s own career growth is in their <Link href="/dashboard/career" className="text-emerald-700 hover:underline">Career Growth</Link> page.</p>
    </div>
  );
}
