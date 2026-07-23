import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadConstraintEngine } from "@/lib/operations/constraint-engine";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import SchedulingTabs from "../SchedulingTabs";

export const dynamic = "force-dynamic";

// Constraint Engine (WSE-001C) — validates the current week's generated roster against
// clinical / workforce / competency / fairness constraints, returning per-rule pass /
// warning / block with severity, a compliance score, per-unit compliance and top violated
// rules. All checks run over real solver output. Tenant-configurable rule libraries +
// regulatory packs + an override-approval workflow are honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const SUBTABS = ["Overview", "Clinical Constraints", "Workforce Constraints", "Labour Rules", "Organisation Policies", "Override Management", "Validation Results", "Rule Library", "Audit & History", "Settings"];
const SEV: Record<string, string> = { Critical: "bg-rose-50 text-rose-700", High: "bg-amber-50 text-amber-700", Medium: "bg-blue-50 text-blue-700", Low: "bg-gray-100 text-gray-600", Pass: "bg-emerald-50 text-emerald-700" };
const STATUS_DOT: Record<string, string> = { Pass: "bg-emerald-500", Warning: "bg-amber-500", Override: "bg-amber-500", Blocked: "bg-rose-500" };
const CAT_COLOR: Record<string, string> = { Clinical: "text-rose-600", Competency: "text-violet-600", Workforce: "text-blue-600", Fairness: "text-amber-600" };

function Kpi({ label, value, sub, tone, icon }: { label: string; value: any; sub?: string; tone?: string; icon?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{icon && <span className="text-base opacity-40">{icon}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function ConstraintEngine() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadConstraintEngine(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🛡️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Constraint Engine</h1><p className="text-sm text-gray-500">Validate the roster against clinical, workforce, competency and fairness rules.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <SchedulingTabs />
      <div className="flex gap-1 overflow-x-auto -mt-1">
        {SUBTABS.map((t, i) => <span key={t} className={`shrink-0 text-[11px] px-2.5 py-1.5 rounded-full font-medium ${i === 0 ? "bg-emerald-50 text-emerald-700" : "text-gray-300"}`} title={i === 0 ? "" : "Next phase"}>{t}</span>)}
      </div>
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Roster store not provisioned</p><p className="text-sm text-amber-800 mt-1">Run migration <code>080</code> and generate a roster — the Constraint Engine validates it.</p></div></div>;
  if (!d.hasRoster) return <div className="space-y-4">{header}<div className={`${card} p-8 text-center`}><p className="text-3xl mb-2">🛡️</p><p className="text-sm font-semibold text-gray-700">No roster to validate for week of {d.weekStart}</p><p className="text-xs text-gray-400 mt-1">Generate a roster in the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link> — constraint validation runs automatically over it.</p></div></div>;

  const k = d.kpis;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Compliance score" value={`${k.complianceScore}%`} sub={k.complianceScore >= 95 ? "Publishable" : k.critical ? "Blocked" : "Review"} icon="🛡️" tone={k.complianceScore >= 95 ? "text-emerald-600" : k.critical ? "text-rose-600" : "text-amber-600"} />
        <Kpi label="Critical violations" value={k.critical} sub="Publication blocked" icon="⛔" tone={k.critical ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Warnings" value={k.warnings} sub="Advisory" icon="⚠️" tone={k.warnings ? "text-amber-600" : undefined} />
        <Kpi label="Blocked / uncovered" value={k.blocked} sub="Posts unfilled" icon="🚫" tone={k.blocked ? "text-rose-600" : undefined} />
        <Kpi label="Override requests" value={k.overrideRequests} sub="Need approval" icon="✋" tone={k.overrideRequests ? "text-amber-600" : undefined} />
        <Kpi label="Overrides recorded" value={k.overrides} sub="On this roster" icon="📝" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Validation results */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Validation results <span className="text-[10px] text-gray-400 font-normal">roster week {d.weekStart} · {d.roster.status}</span></h3>
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Rule</th><th className="py-2 pr-3 font-medium">Category</th><th className="py-2 pr-3 font-medium text-right">Violations</th><th className="py-2 pr-3 font-medium">Severity</th><th className="py-2 font-medium">Result</th></tr></thead>
            <tbody>{d.rules.map((r: any) => (<tr key={r.rule} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-700">{r.rule}</td><td className={`py-2 pr-3 ${CAT_COLOR[r.category] ?? "text-gray-500"}`}>{r.category}</td><td className={`py-2 pr-3 text-right ${r.count ? "text-gray-800 font-semibold" : "text-gray-400"}`}>{r.count}</td><td className="py-2 pr-3"><span className={`text-[9px] px-1.5 py-0.5 rounded ${SEV[r.severity] ?? SEV.Pass}`}>{r.severity}</span></td><td className="py-2"><span className="inline-flex items-center gap-1.5 text-[11px] text-gray-600"><span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[r.status]}`} />{r.status}</span></td></tr>))}</tbody>
          </table></div>
          <p className="text-[10px] text-gray-400 mt-2">Runs automatically over the generated roster. No schedule may bypass a Critical constraint; High violations need a manager override with reason. Checks are over real solver output.</p>
        </div>

        {/* AI rule insights */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-1.5"><span>✨</span>AI rule insights</h3>
          {d.insights.length === 0 ? <p className="text-sm text-gray-400">No insights.</p> : <div className="space-y-2">{d.insights.map((x: any, i: number) => (<div key={i} className="flex items-start gap-2"><span className="text-sm shrink-0">{x.icon}</span><p className="text-xs text-gray-700 flex-1">{x.text}</p></div>))}</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Rule compliance by unit */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Rule compliance by unit</h3>
          {d.byUnit.length === 0 ? <p className="text-sm text-gray-400">No units.</p> : <div className="space-y-2">{d.byUnit.map((u: any) => (<div key={u.unit} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700">{u.unit}</span><span className="text-gray-500">{u.pct}%{u.violations ? ` · ${u.violations} issue(s)` : ""}</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${u.pct >= 95 ? "bg-emerald-500" : u.pct >= 80 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${u.pct}%` }} /></div></div>))}</div>}
        </div>

        {/* Top violated rules */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Top violated rules</h3>
          {d.topViolated.length === 0 ? <p className="text-sm text-gray-400">No violations — all constraints pass. 🎉</p> : <div className="space-y-2">{d.topViolated.map((r: any) => (<div key={r.rule} className="flex items-center justify-between text-xs"><span className="text-gray-700 truncate flex-1">{r.rule}</span><span className={`text-[9px] px-1.5 py-0.5 rounded ${SEV[r.severity]}`}>{r.severity}</span><b className="text-gray-800 w-6 text-right">{r.count}</b></div>))}</div>}
        </div>

        {/* Recent overrides */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Recent overrides</h3>
          {d.recentOverrides.length === 0 ? <p className="text-sm text-gray-400">No overrides on this roster.</p> : <div className="space-y-1.5">{d.recentOverrides.map((o: any, i: number) => (<div key={i} className="text-xs rounded-lg border border-gray-100 p-2"><div className="flex items-center justify-between"><span className="text-gray-800 font-medium truncate">{o.staff}</span><span className="text-gray-400">{o.unit}</span></div><p className="text-[11px] text-gray-500 truncate">{o.reason}</p></div>))}</div>}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Constraint Engine (WSE-001C) validates the generated roster before publication: minimum staffing ratios &amp; mandatory Shift Supervisor coverage (uncovered posts), mandatory competencies (unvalidated assignments), maximum weekly hours (48h / 4 shifts) &amp; minimum rest (one shift/day), and rotation fairness — all computed over real op_roster_assignments. Severity drives the gate: Critical blocks publication, High needs a manager override with reason (enforced in <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Publish &amp; Approve</Link>). Tenant-configurable rule libraries, regulatory/labour-law packs, orientation/preceptor checks and a dedicated override-approval workflow are honest next-phase. <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">← Scheduling Engine</Link></p>
    </div>
  );
}
