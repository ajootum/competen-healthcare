import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadMandatoryCompliance } from "@/lib/operations/mandatory-compliance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import LearningTabs from "../LearningTabs";
import { KpiTile as Kpi } from "../../_kit";

export const dynamic = "force-dynamic";

// Mandatory Learning & Compliance Centre (LDS-002) — the compliance-focused view over the LDS-001
// learning operations (learning_enrolments). Design follows the LDS-002 mockup; every value is real
// over live enrolment data or an honest state (no fabricated compliance / trend). Populated once
// mandatory learning is assigned in the Assign Learning surface.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const pctTone = (n: number) => (n >= 90 ? "text-[var(--cmp-text-success)]" : n >= 80 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]");
const barTone = (n: number) => (n >= 90 ? "bg-[var(--cmp-color-success)]" : n >= 80 ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-error)]");
const ESC_TONE: Record<string, string> = { "Level 1": "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", "Level 2": "bg-[var(--cmp-surface-warning)] text-orange-700", "Level 3": "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]" };

function Bars({ rows }: { rows: any[] }) {
  return <div className="space-y-1.5">{rows.map((r: any) => (<div key={r.name} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700 capitalize truncate">{r.name}</span><span className={`tabular-nums font-semibold ${pctTone(r.pct)}`}>{r.pct}%</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${barTone(r.pct)}`} style={{ width: `${r.pct}%` }} /></div></div>))}</div>;
}

export default async function MandatoryCompliance() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadMandatoryCompliance(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Mandatory Learning &amp; Compliance</h1><p className="text-sm text-gray-500">Where are we non-compliant, who is affected and what is overdue — for mandatory learning.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <LearningTabs />
    </>
  );
  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Learning operations store not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 089 to enable mandatory-learning compliance tracking.</p></div></div>;
  if (!d.hasData) return <div className="space-y-4">{header}<div className="bg-white border border-dashed border-gray-200 rounded-xl p-8 text-center"><p className="text-3xl mb-2 opacity-40">📋</p><p className="text-sm text-gray-600">No mandatory learning assigned yet.</p><p className="text-[11px] text-gray-400 mt-1">Compliance, overdue and completion track here once mandatory learning is assigned.</p><Link href="/unit-manager/learning/assign" className="mt-3 inline-block text-sm rounded-lg bg-[var(--cmp-color-success)] text-white px-4 py-2 hover:bg-emerald-700">Assign mandatory learning →</Link></div></div>;

  const k = d.kpis, s = d.status;
  const statusSegs = [["#22c55e", s.compliant, "Compliant"], ["#f59e0b", s.dueSoon, "Due soon"], ["#ef4444", s.overdue, "Overdue"], ["#94a3b8", s.notStarted, "Not started"], ["#e5e7eb", s.exempt, "Exempt"]] as [string, number, string][];
  const statusTotal = statusSegs.reduce((t, x) => t + x[1], 0) || 1;
  const donut = (() => { let acc = 0; const st: string[] = []; statusSegs.forEach(([c, n]) => { const a = (acc / statusTotal) * 360, b = ((acc + n) / statusTotal) * 360; if (n) st.push(`${c} ${a}deg ${b}deg`); acc += n; }); return st.length ? `conic-gradient(${st.join(", ")})` : "conic-gradient(#e5e7eb 0deg 360deg)"; })();

  return (
    <div className="space-y-4">
      {header}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Kpi icon="🛡️" tint="bg-[var(--cmp-surface-success)]" label="Overall Compliance" value={`${k.overallCompliance}%`} tone={pctTone(k.overallCompliance)} sub="mandatory learning" />
        <Kpi icon="✅" tint="bg-teal-50" label="Fully Compliant" value={k.fullyCompliant} sub={`of ${k.totalLearners} learners`} />
        <Kpi icon="🕐" tint="bg-[var(--cmp-surface-warning)]" label="Due Soon (≤30d)" value={k.dueSoon} tone={k.dueSoon ? "text-[var(--cmp-text-warning)]" : "text-gray-400"} sub="approaching" />
        <Kpi icon="⚠️" tint="bg-[var(--cmp-surface-error)]" label="Overdue Learners" value={k.overdueLearners} tone={k.overdueLearners ? "text-[var(--cmp-text-error)]" : "text-gray-400"} sub="action required" />
        <Kpi icon="🚩" tint="bg-[var(--cmp-surface-warning)]" label="Critical Gaps" value={d.topGaps.length} tone={d.topGaps.length ? "text-[var(--cmp-text-error)]" : "text-gray-400"} sub="requirements" />
        <Kpi icon="📋" tint="bg-[var(--cmp-surface-information)]" label="Assignments Issued" value={k.assignmentsIssued} sub="active" href="/unit-manager/learning/assign" />
        <Kpi icon="📈" tint="bg-violet-50" label="Completion Rate" value={`${k.completionRate}%`} tone={pctTone(k.completionRate)} sub="completed" />
      </div>

      {/* Breakdowns + status distribution */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}><h3 className="font-semibold text-gray-900 text-sm mb-3">Compliance by Role</h3>{d.byRole.length === 0 ? <p className="text-sm text-gray-400">No data.</p> : <Bars rows={d.byRole} />}<p className="text-[10px] text-gray-400 mt-2">By-department grouping needs a staff→department mapping — next-phase.</p></div>
        <div className={`${card} p-5`}><h3 className="font-semibold text-gray-900 text-sm mb-3">Compliance by Course / Requirement</h3>{d.byCourse.length === 0 ? <p className="text-sm text-gray-400">No data.</p> : <Bars rows={d.byCourse} />}</div>
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Compliance Status Distribution</h3>
          <div className="flex items-center gap-4">
            <div className="relative w-24 h-24 shrink-0 rounded-full" style={{ background: donut }}><div className="absolute inset-[22%] rounded-full bg-white flex flex-col items-center justify-center"><span className="text-base font-bold text-gray-900 tabular-nums">{k.totalLearners}</span><span className="text-[8px] text-gray-400">learners</span></div></div>
            <div className="flex-1 space-y-1 text-[11px]">{statusSegs.map(([c, n, label]) => (<div key={label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: c }} /><span className="text-gray-600 flex-1">{label}</span><b className="tabular-nums">{n}</b></div>))}</div>
          </div>
        </div>
      </div>

      {/* Top gaps + overdue learners */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Top Compliance Gaps <span className="text-[10px] font-normal text-rose-500">critical</span></h3>
          {d.topGaps.length === 0 ? <p className="text-sm text-gray-400">No compliance gaps. 🎉</p> : (
            <table className="w-full text-xs"><thead><tr className="text-[10px] uppercase tracking-wide text-gray-400 text-left border-b border-gray-100"><th className="py-1.5 font-medium">Requirement</th><th className="py-1.5 font-medium text-right">Learners affected</th></tr></thead>
              <tbody>{d.topGaps.map((g: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-1.5 text-gray-700">⚠️ {g.requirement}</td><td className="py-1.5 text-right text-[var(--cmp-text-error)] font-semibold tabular-nums">{g.affected}</td></tr>))}</tbody>
            </table>
          )}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Escalations <span className="text-[10px] font-normal text-gray-400">by level (from overdue)</span></h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-[var(--cmp-surface-warning)] py-3"><p className="text-xl font-bold text-[var(--cmp-text-warning)] tabular-nums">{d.escalations.l1}</p><p className="text-[10px] text-[var(--cmp-text-warning)]">Level 1 · Supervisor</p></div>
            <div className="rounded-lg bg-[var(--cmp-surface-warning)] py-3"><p className="text-xl font-bold text-orange-700 tabular-nums">{d.escalations.l2}</p><p className="text-[10px] text-[var(--cmp-text-warning)]">Level 2 · Unit Manager</p></div>
            <div className="rounded-lg bg-[var(--cmp-surface-error)] py-3"><p className="text-xl font-bold text-[var(--cmp-text-error)] tabular-nums">{d.escalations.l3}</p><p className="text-[10px] text-[var(--cmp-text-error)]">Level 3 · Compliance</p></div>
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Derived from overdue duration. Exception/extension requests and a formal escalation store are honest next-phase.</p>
        </div>
      </div>

      {/* Overdue learners table */}
      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Overdue Learners</h3><Link href="/unit-manager/learning/assign" className="text-[11px] text-[var(--cmp-text-success)] hover:underline">Manage →</Link></div>
        {d.overdueLearners.length === 0 ? <p className="text-sm text-gray-400">No overdue mandatory learning. 🎉</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-[10px] uppercase tracking-wide text-gray-400 text-left border-b border-gray-100"><th className="py-2 font-medium">Learner</th><th className="py-2 font-medium">Role</th><th className="py-2 font-medium">Overdue Requirement</th><th className="py-2 font-medium">Due</th><th className="py-2 font-medium text-right">Days</th><th className="py-2 font-medium text-right">Escalation</th></tr></thead>
            <tbody>{d.overdueLearners.map((o: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-2 text-gray-800">{o.name}</td><td className="py-2 text-gray-500 capitalize">{o.role}</td><td className="py-2 text-gray-600 truncate max-w-[12rem]">{o.requirement}</td><td className="py-2 text-gray-500 tabular-nums">{o.due ?? "—"}</td><td className="py-2 text-right text-[var(--cmp-text-error)] font-medium tabular-nums">{o.days}</td><td className="py-2 text-right"><span className={`text-[9px] px-1.5 py-0.5 rounded ${ESC_TONE[o.escalation]}`}>{o.escalation}</span></td></tr>))}</tbody>
          </table></div>
        )}
      </div>

      {/* Upcoming + recent completions */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Upcoming (≤30 days)</h3>
          {d.upcoming.length === 0 ? <p className="text-sm text-gray-400">Nothing due in 30 days.</p> : (
            <div className="space-y-2">{d.upcoming.map((u: any, i: number) => (<div key={i} className="flex items-center justify-between gap-2 text-xs"><div className="min-w-0"><p className="text-gray-800 truncate">{u.requirement}</p><p className="text-[10px] text-gray-400 truncate">{u.name}</p></div><span className="text-[var(--cmp-text-warning)] shrink-0 tabular-nums">{u.days != null ? `${u.days}d` : u.due ?? "—"}</span></div>))}</div>
          )}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Recent Completions</h3>
          {d.recentCompletions.length === 0 ? <p className="text-sm text-gray-400">No completions yet.</p> : (
            <div className="space-y-2">{d.recentCompletions.map((c: any, i: number) => (<div key={i} className="flex items-center justify-between gap-2 text-xs"><div className="flex items-center gap-2 min-w-0"><span className="text-emerald-500">✓</span><span className="text-gray-800 truncate">{c.name}</span><span className="text-gray-400 truncate">{c.requirement}</span></div></div>))}</div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Mandatory Learning &amp; Compliance Centre (LDS-002) over the LDS-001 learning operations (learning_enrolments / learning_assignments). Real: compliance KPIs, status distribution, by-role &amp; by-course compliance, top critical gaps, named overdue learners with a derived escalation level, upcoming (≤30d) and recent completions. Honest next-phase: exception/extension request &amp; formal escalation stores, risk-level classification, by-department grouping (no department field on staff) and the compliance trend history. Assign mandatory learning in the <Link href="/unit-manager/learning/assign" className="text-emerald-700 hover:underline">assignment surface</Link>.</p>
    </div>
  );
}
