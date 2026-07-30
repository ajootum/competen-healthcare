import { cmoGuard, Head, Card, Kpi, Pill, Progress, Foot } from "../_cmo-ui";
import { loadWorkforceMapping } from "@/lib/competency/workforce-mapping";

// CMO-007 — Competency Workforce Mapping. Maps each role to its required competency profile (assignment rules)
// and measures real coverage across the role's staff. Mapped/unmapped roles, per-role coverage, critical gaps.
// Real over cmo_assignment_rules + profiles + competency_decisions. Hospital-scoped.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const covTone = (n: number | null) => (n == null ? "text-gray-300" : n >= 90 ? "text-emerald-600" : n >= 50 ? "text-amber-600" : "text-rose-600");

export default async function WorkforceMappingPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await loadWorkforceMapping(admin, hid, isSuper) as any;

  const head = <Head code="CMO-007 · Workforce Mapping" title="Competency Workforce Mapping" sub="Map roles to the competencies required for safe, high-quality care — and see how well each role's workforce covers its profile." />;
  if (!d.provisioned) {
    return <div className="space-y-4">{head}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="text-sm text-amber-800">Workforce mapping isn&apos;t provisioned — it reads role competency profiles from <code className="font-mono">cmo_assignment_rules</code> (migration 125).</p></div></div>;
  }

  const k = d.kpis;
  return (
    <div className="space-y-4 max-w-[1400px]">
      {head}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Roles" value={k.roles} sub={`${k.rolesMapped} mapped`} />
        <Kpi label="Competency profiles" value={k.profiles} sub="role → competencies" tone="text-teal-600" />
        <Kpi label="Workforce mapped" value={k.workforceMapped} sub={`${k.mappingCoverage}% of staff`} />
        <Kpi label="Profile coverage" value={k.avgProfileCoverage != null ? `${k.avgProfileCoverage}%` : "—"} sub="avg achieved" tone={k.avgProfileCoverage != null && k.avgProfileCoverage < 60 ? "text-amber-600" : "text-gray-900"} />
        <Kpi label="Unmapped roles" value={k.unmappedRoles} sub="no profile" tone={k.unmappedRoles ? "text-amber-600" : "text-gray-900"} />
        <Kpi label="Critical gaps" value={k.criticalGaps} sub="< 25% coverage" tone={k.criticalGaps ? "text-rose-600" : "text-gray-900"} />
      </div>

      <Card title="Role → competency mapping" right={<span className="text-[11px] text-gray-400">coverage = achieved share of the role&apos;s required competencies</span>}>
        {d.roleRows.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">No roles with staff or a competency profile yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100"><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 px-3 font-medium text-right">Staff</th><th className="py-2 px-3 font-medium text-right">Required</th><th className="py-2 px-3 font-medium w-40">Coverage</th><th className="py-2 pl-3 font-medium">Status</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {d.roleRows.map((r: any) => (
                  <tr key={r.role}>
                    <td className="py-2 pr-3 text-gray-800 font-medium">{r.label}</td>
                    <td className="py-2 px-3 text-gray-500 tabular-nums text-right">{r.staff}</td>
                    <td className="py-2 px-3 text-gray-500 tabular-nums text-right">{r.required || "—"}</td>
                    <td className="py-2 px-3">
                      {r.coverage == null ? <span className="text-[11px] text-gray-300">{r.required ? "no staff" : "no profile"}</span> : (
                        <div className="flex items-center gap-2"><div className="flex-1"><Progress pct={r.coverage} /></div><span className={`text-[11px] font-semibold tabular-nums w-9 text-right ${covTone(r.coverage)}`}>{r.coverage}%</span></div>
                      )}
                    </td>
                    <td className="py-2 pl-3"><Pill text={r.status} tone={r.tone} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Critical competency gaps" right={<span className="text-[11px] text-gray-400">required, but most of the role lacks it</span>}>
          {d.gaps.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No critical gaps — role profiles are well covered. 🎯</p> : (
            <div className="space-y-2">
              {d.gaps.map((g: any, i: number) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1"><p className="text-[13px] text-gray-800 truncate">{g.competency}</p><p className="text-[10px] text-gray-400">{g.role} · {g.affected} staff missing it</p></div>
                  <span className={`text-xs font-bold tabular-nums shrink-0 ${covTone(g.coverage)}`}>{g.coverage}%</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Unmapped roles" right={<span className="text-[11px] text-gray-400">staff but no competency profile</span>}>
          {d.unmapped.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">Every role with staff has a competency profile. ✅</p> : (
            <div className="space-y-1.5">
              {d.unmapped.map((r: any) => (
                <div key={r.role} className="flex items-center gap-2 text-[13px]"><span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" /><span className="text-gray-700 flex-1 truncate">{r.label}</span><span className="text-[11px] text-gray-400">{r.staff} staff</span></div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Foot>CMO-007 — the role competency profile is derived from the standing assignment rules (cmo_assignment_rules): a role &quot;requires&quot; the competencies its active rules assign. Coverage is the achieved share of those competencies across the role&apos;s staff, live from competency_decisions. Roles with staff but no rules are surfaced as unmapped so the office can define their profile. Position-level mapping and the full Org→Unit hierarchy view are the next phase.</Foot>
    </div>
  );
}
