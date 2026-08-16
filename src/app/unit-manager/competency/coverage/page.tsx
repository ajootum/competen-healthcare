import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import CompetencyTabs from "../CompetencyTabs";
import { loadWorkforceReadiness } from "@/lib/operations/workforce-readiness";
import { loadCoverageHeatmap } from "@/lib/operations/learning-analytics";
import { cardClass } from "@/components/ui/primitives";
import { estateRolesOf } from "@/lib/roles";

// Competency Management → Coverage & Gaps (UMG-CM). Where the unit is competent, where it isn't, and where a
// single person is the only cover. Real over competency_decisions (role coverage + maturity heatmap) — the
// unit-scoped lens on the same data the Competency Office governs org-wide. No migration.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const barCls = (n: number) => (n >= 85 ? "bg-[var(--cmp-color-success)]" : n >= 60 ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-error)]");
const heatCls = (pct: number) => (pct >= 40 ? "bg-teal-600 text-white" : pct >= 20 ? "bg-teal-300 text-teal-900" : pct > 0 ? "bg-teal-100 text-teal-700" : "bg-gray-50 text-gray-300");

export default async function CoverageGapsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = estateRolesOf(profile);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const hid = profile?.hospital_id ?? null; const isSuper = roles.includes("super_admin");

  const [wr, heat]: [any, any] = await Promise.all([
    loadWorkforceReadiness(admin, hid, isSuper).catch(() => ({ ready: false })),
    loadCoverageHeatmap(admin, hid, isSuper).catch(() => ({ provisioned: false, levels: [], rows: [] })),
  ]);
  const card = cardClass;
  const roleCoverage: any[] = wr.roleCoverage ?? [];
  const noCoverage: any[] = wr.noCoverage ?? [];
  const singleDep: any[] = wr.singleDep ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Coverage & Gaps</h1>
        <p className="text-sm text-gray-500 mt-1">Competency coverage by role, single-person dependencies and the unit&apos;s competency maturity by domain.</p>
      </div>
      <CompetencyTabs />

      {!wr.ready ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6 text-sm text-amber-800">Competency coverage data isn&apos;t available for this unit yet.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Readiness score", value: wr.score != null ? `${wr.score}%` : "—", sub: wr.band, tone: "text-gray-900" },
              { label: "Fully deployable", value: wr.kpis?.fullyDeployable ?? 0, sub: `of ${wr.kpis?.total ?? 0}`, tone: "text-[var(--cmp-text-success)]" },
              { label: "No validated cover", value: noCoverage.length, sub: "roles", tone: "text-[var(--cmp-text-error)]" },
              { label: "Single-person cover", value: singleDep.length, sub: "roles", tone: "text-[var(--cmp-text-warning)]" },
            ].map(k => (
              <div key={k.label} className={card}><div className={`text-2xl font-bold tabular-nums ${k.tone}`}>{k.value}</div><div className="text-xs text-gray-500 mt-1 font-medium">{k.label}</div><div className="text-[10px] text-gray-400">{k.sub}</div></div>
            ))}
          </div>

          {(noCoverage.length > 0 || singleDep.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className={card}>
                <h3 className="font-semibold text-gray-900 text-sm mb-2">No validated coverage</h3>
                {noCoverage.length === 0 ? <p className="text-sm text-gray-400">Every role has validated cover.</p> : (
                  <div className="space-y-1.5">{noCoverage.map((r: any) => (<div key={r.role} className="flex items-center gap-2 text-sm"><span className="w-2 h-2 rounded-full bg-[var(--cmp-color-error)] shrink-0" /><span className="text-gray-700 flex-1 truncate">{r.label}</span><span className="text-[11px] text-gray-400">0/{r.total}</span></div>))}</div>
                )}
              </div>
              <div className={card}>
                <h3 className="font-semibold text-gray-900 text-sm mb-2">Single-person dependency</h3>
                {singleDep.length === 0 ? <p className="text-sm text-gray-400">No single-person dependencies.</p> : (
                  <div className="space-y-1.5">{singleDep.map((r: any) => (<div key={r.role} className="flex items-center gap-2 text-sm"><span className="w-2 h-2 rounded-full bg-[var(--cmp-color-warning)] shrink-0" /><span className="text-gray-700 flex-1 truncate">{r.label}</span><span className="text-[11px] text-gray-400">1/{r.total} — cross-train</span></div>))}</div>
                )}
              </div>
            </div>
          )}

          <div className={card}>
            <h3 className="font-semibold text-gray-900 text-sm mb-3">Coverage by role</h3>
            {roleCoverage.length === 0 ? <p className="text-sm text-gray-400">No role coverage data.</p> : (
              <div className="space-y-2.5">
                {roleCoverage.map((rc: any) => (
                  <div key={rc.role} className="flex items-center gap-3">
                    <span className="text-sm text-gray-700 w-44 truncate">{rc.label}</span>
                    <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden max-w-xs"><div className={`h-full ${barCls(rc.pct ?? 0)}`} style={{ width: `${rc.pct ?? 0}%` }} /></div>
                    <span className="text-xs tabular-nums text-gray-500 w-10 text-right">{rc.pct != null ? `${rc.pct}%` : "—"}</span>
                    <span className="text-[11px] text-gray-400 ml-auto">{rc.current}/{rc.total} current</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Competency maturity heatmap by domain */}
          <div className={card}>
            <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Competency maturity by domain</h3><span className="text-[11px] text-gray-400">% of achieved competencies at each Benner band</span></div>
            {!heat.provisioned || heat.rows.length === 0 ? (
              <p className="text-sm text-gray-400">No achieved competency decisions to map yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr><th className="text-left font-medium text-gray-400 py-1.5 pr-3">Domain</th>{heat.levels.map((l: string) => <th key={l} className="text-center font-medium text-gray-400 px-1.5 whitespace-nowrap">{l}</th>)}</tr></thead>
                  <tbody>
                    {heat.rows.map((row: any) => (
                      <tr key={row.domain} className="border-t border-gray-50">
                        <td className="py-1.5 pr-3 text-gray-700 truncate max-w-[180px]" title={row.domain}>{row.domain} <span className="text-gray-300">({row.total})</span></td>
                        {row.cells.map((c: any) => (
                          <td key={c.level} className="px-1 py-1 text-center"><span className={`inline-block w-full rounded py-1 tabular-nums ${heatCls(c.pct)}`} title={`${c.count} at ${c.level}`}>{c.pct ? `${c.pct}%` : "·"}</span></td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
