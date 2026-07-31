import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadContentQa } from "@/lib/studio/content-qa";

// CST-107 — Competency Quality Assurance Centre. Systematic QA over the AUTHORED competency content:
// completeness, assessment integrity, evidence coverage, metadata and structural checks — every score
// computed on read from the content itself (see src/lib/studio/content-qa.ts). Complements the OUTCOME
// feedback loop at /competency-office/quality-feedback (COMP-028), which correlates incidents to
// competency domains; this one is the content linter.

export const dynamic = "force-dynamic";

const SEV: Record<string, { cls: string; dot: string; label: string }> = {
  high: { cls: "text-[var(--cmp-text-critical)] bg-[var(--cmp-surface-critical)] border-[var(--cmp-color-critical)]", dot: "#ef4444", label: "High" },
  medium: { cls: "text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]", dot: "#f59e0b", label: "Medium" },
  low: { cls: "text-gray-500 bg-gray-50 border-gray-100", dot: "#9ca3af", label: "Low" },
};

function scoreColor(p: number) { return p >= 90 ? "#10b981" : p >= 75 ? "#3b82f6" : p >= 50 ? "#f59e0b" : "#ef4444"; }

export default async function StudioQaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const qa = await loadContentQa(admin, profile?.hospital_id ?? null, true);

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-rose-500 uppercase tracking-widest mb-0.5">CST-107 · Quality Assurance</p>
          <h1 className="text-xl font-bold text-gray-900">Content Quality Assurance</h1>
          <p className="text-gray-400 text-sm mt-0.5">Completeness, assessment integrity and evidence coverage across every authored competency — computed live.</p>
        </div>
        <Link href="/super-admin/studio" className="text-xs font-semibold text-gray-500 hover:text-teal-700 border border-gray-200 rounded-lg px-3 py-2">← Studio</Link>
      </div>

      {!qa.provisioned ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">Content tables are not available in this environment.</div>
      ) : qa.empty ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">No authored competencies yet — QA scores will appear once frameworks and competencies are created in the Studio.</div>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
            {[
              { label: "Frameworks assessed", value: qa.kpis.frameworks, tone: "text-gray-900" },
              { label: "Competencies", value: qa.kpis.competencies, tone: "text-gray-900" },
              { label: "Avg completeness", value: `${qa.kpis.avgScore}%`, tone: qa.kpis.avgScore >= 75 ? "text-teal-600" : qa.kpis.avgScore >= 50 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-critical)]" },
              { label: "Fully complete", value: qa.kpis.fullyComplete, tone: "text-teal-600" },
              { label: "Issues found", value: qa.kpis.issues, tone: qa.kpis.issues > 0 ? "text-[var(--cmp-text-warning)]" : "text-gray-300" },
              { label: "High severity", value: qa.kpis.high, tone: qa.kpis.high > 0 ? "text-[var(--cmp-text-critical)]" : "text-gray-300" },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <p className={`text-xl font-bold ${k.tone}`}>{k.value}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-5 mb-5">
            {/* Quality domains */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="font-semibold text-gray-900 text-sm mb-3">Quality domains</h2>
              {qa.domains.map(d => (
                <div key={d.key} className="flex items-center gap-3 py-1.5">
                  <span className="text-xs text-gray-600 w-44 truncate">{d.label}</span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${d.pct}%`, backgroundColor: scoreColor(d.pct) }} />
                  </div>
                  <span className="text-[11px] font-bold text-gray-600 w-16 text-right">{d.pct}% <span className="text-gray-300 font-normal">({d.passed})</span></span>
                </div>
              ))}
            </div>

            {/* Distribution */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="font-semibold text-gray-900 text-sm mb-3">Completeness distribution</h2>
              {qa.distribution.map(b => {
                const pct = qa.kpis.competencies ? Math.round((b.n / qa.kpis.competencies) * 100) : 0;
                return (
                  <div key={b.band} className="flex items-center gap-3 py-1.5">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: b.color }} />
                    <span className="text-xs text-gray-600 flex-1">{b.band}</span>
                    <span className="text-[11px] font-bold text-gray-700">{b.n}</span>
                    <span className="text-[10px] text-gray-400 w-9 text-right">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Framework scorecards — lowest first (worklist) */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 mb-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 text-sm">Framework scorecards</h2>
              <span className="text-[9px] text-gray-400">lowest completeness first</span>
            </div>
            <div className="flex flex-col gap-2">
              {qa.frameworks.map(f => (
                <Link key={f.id} href={`/super-admin/content/${f.id}`} className="flex items-center gap-3 py-1.5 group">
                  <span className="text-xs text-gray-700 w-56 truncate group-hover:text-teal-700">{f.name}</span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${f.pct}%`, backgroundColor: scoreColor(f.pct) }} />
                  </div>
                  <span className="text-[11px] font-bold text-gray-600 w-10 text-right">{f.pct}%</span>
                  <span className="text-[10px] text-gray-400 w-24 text-right">{f.complete}/{f.competencies} complete</span>
                  <div className="hidden lg:flex gap-1 w-40 flex-wrap justify-end">
                    {f.flags.map(fl => <span key={fl} className="text-[8px] font-semibold text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] px-1.5 py-0.5 rounded">{fl}</span>)}
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Issue tracker */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 text-sm">Quality issues</h2>
              <span className="text-[9px] text-gray-400">{qa.kpis.issues} total · showing {qa.issues.length}</span>
            </div>
            {qa.issues.length === 0 ? (
              <p className="text-xs text-gray-400">No content-quality issues detected. 🎉</p>
            ) : (
              <div className="flex flex-col divide-y divide-gray-50">
                {qa.issues.map((it, i) => {
                  const s = SEV[it.severity];
                  return (
                    <div key={i} className="flex items-center gap-3 py-2">
                      <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${s.cls} w-16 text-center shrink-0`}>{s.label}</span>
                      <span className="text-xs text-gray-700 flex-1 min-w-0">{it.label}</span>
                      {it.context && <span className="text-[10px] text-gray-400 truncate max-w-[180px]">{it.context}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
