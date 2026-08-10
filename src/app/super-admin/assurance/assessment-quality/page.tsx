import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAssessmentQuality } from "@/lib/assurance/assessment-quality";
import { requireHqCapability } from "@/lib/hq/context";

// CAPA-003 — Assessment Quality Engine (operator view). Classical item analysis: per-item difficulty and
// discrimination over quiz_attempts + questions, with a flagged-item review queue and by-category quality.
// Super-admin, enterprise-wide.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const TONE: Record<string, string> = { emerald: "text-emerald-700 bg-[var(--cmp-surface-success)] border-[var(--cmp-color-success)]", amber: "text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]", rose: "text-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)] border-[var(--cmp-color-error)]" };
const healthTone = (n: number) => (n >= 80 ? "text-[var(--cmp-text-success)]" : n >= 60 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]");
const dTone = (d: number | null) => (d == null ? "text-gray-300" : d < 0 ? "text-[var(--cmp-text-error)]" : d < 0.15 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-success)]");
const pTone = (p: number) => (p < 0.2 || p > 0.95 ? "text-[var(--cmp-text-error)]" : p > 0.9 ? "text-[var(--cmp-text-warning)]" : "text-gray-700");

export default async function AssessmentQualityPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  await requireHqCapability("hq.quality.assurance.view");

  const q = await loadAssessmentQuality(admin, profile?.hospital_id ?? null, true);
  const card = "bg-white rounded-xl border border-gray-100";

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-indigo-500 uppercase tracking-widest mb-0.5">CAPA-003 · Competency Assurance</p>
          <h1 className="text-xl font-bold text-gray-900">Assessment Quality</h1>
          <p className="text-gray-400 text-sm mt-0.5">Classical item analysis — how hard each question is and how well it separates strong from weak candidates — over the real attempt record.</p>
        </div>
        <Link href="/super-admin/assurance" className="text-xs font-semibold text-gray-500 hover:text-indigo-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Assurance</Link>
      </div>

      {!q.provisioned ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-4"><p className="text-[13px] text-amber-900">Attempt data isn&apos;t provisioned — quality analysis reads <code className="text-[11px]">quiz_attempts</code> + <code className="text-[11px]">questions</code>.</p></div>
      ) : q.empty ? (
        <div className="bg-white border border-gray-100 rounded-xl p-6"><p className="text-sm text-gray-400">No scored question attempts yet. Once learners answer questions, item difficulty and discrimination populate here automatically.</p></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
            {[
              { label: "Item health", value: `${q.kpis.itemHealth}%`, tone: healthTone(q.kpis.itemHealth), sub: "not flagged" },
              { label: "Items analysed", value: q.kpis.items, tone: "text-gray-900", sub: `${q.kpis.attempts} attempts` },
              { label: "Avg difficulty", value: q.kpis.avgDifficulty, tone: "text-indigo-600", sub: "p-value 0–1" },
              { label: "Avg discrimination", value: q.kpis.avgDiscrimination ?? "—", tone: "text-indigo-600", sub: `${q.kpis.discriminable} scored` },
              { label: "Flagged items", value: q.kpis.flagged, tone: q.kpis.flagged ? "text-[var(--cmp-text-error)]" : "text-gray-900", sub: "need review" },
              { label: "Attempts", value: q.kpis.attempts, tone: "text-gray-900", sub: "analysed" },
            ].map(k => (
              <div key={k.label} className={`${card} p-3.5`}><p className={`text-xl font-bold tabular-nums ${k.tone}`}>{k.value}</p><p className="text-[10px] text-gray-400 font-medium mt-0.5 leading-tight">{k.label}</p><p className="text-[9px] text-gray-300 leading-tight">{k.sub}</p></div>
            ))}
          </div>

          {/* Flagged review queue */}
          <div className={`${card} overflow-hidden mb-5`}>
            <div className="px-4 py-2.5 border-b border-gray-50 flex items-center justify-between"><p className="text-[11px] font-semibold text-gray-500">Item review queue</p><span className="text-[10px] text-gray-400">items too easy/hard or discriminating poorly</span></div>
            {q.flagged.length === 0 ? (
              <p className="text-xs text-gray-400 px-4 py-6 text-center">No items flagged — the question bank is performing well. 🎯</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {q.flagged.map((it: any) => (
                  <div key={it.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-sm text-gray-800 flex-1 truncate" title={it.content}>{it.content}</span>
                    <span className="text-[10px] text-gray-400 shrink-0 hidden sm:inline">{it.category}</span>
                    <span className={`text-[9px] font-bold uppercase tracking-wide border rounded px-1.5 py-0.5 shrink-0 ${TONE[it.tone]}`}>{it.verdict}</span>
                    <span className="text-[11px] text-gray-400 tabular-nums shrink-0 w-12 text-right">{it.attempts}×</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Item table */}
            <div className={`${card} overflow-hidden lg:col-span-2`}>
              <div className="px-4 py-2.5 border-b border-gray-50"><p className="text-[11px] font-semibold text-gray-500">All analysed items — worst first</p></div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-50"><th className="py-2 px-4 font-medium">Item</th><th className="py-2 px-2 font-medium text-right">n</th><th className="py-2 px-2 font-medium text-right">Diff.</th><th className="py-2 px-2 font-medium text-right">Disc.</th><th className="py-2 px-4 font-medium">Verdict</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {q.items.slice(0, 60).map((it: any) => (
                      <tr key={it.id}>
                        <td className="py-2 px-4 text-gray-800 truncate max-w-[220px]" title={it.content}>{it.content}</td>
                        <td className="py-2 px-2 text-gray-500 tabular-nums text-right">{it.attempts}</td>
                        <td className={`py-2 px-2 tabular-nums text-right font-medium ${pTone(it.pValue)}`}>{it.pValue}</td>
                        <td className={`py-2 px-2 tabular-nums text-right font-medium ${dTone(it.discrimination)}`}>{it.discrimination == null ? "—" : it.discrimination}</td>
                        <td className="py-2 px-4"><span className={`text-[9px] font-bold uppercase tracking-wide border rounded px-1.5 py-0.5 ${TONE[it.tone]}`}>{it.verdict}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* By category */}
            <div className={`${card} p-4`}>
              <p className="text-[11px] font-semibold text-gray-500 mb-3">Quality by category</p>
              {q.byCategory.length === 0 ? <p className="text-xs text-gray-400">No categories.</p> : (
                <div className="space-y-2.5">
                  {q.byCategory.map((c: any) => (
                    <div key={c.category}>
                      <div className="flex items-center justify-between text-[12px] mb-0.5"><span className="text-gray-700 truncate pr-2">{c.category}</span><span className="text-gray-400 tabular-nums shrink-0">{c.items}</span></div>
                      <div className="flex items-center gap-2 text-[10px] text-gray-400"><span>diff {c.avgDifficulty}</span><span>·</span><span className={c.avgDiscrimination != null ? dTone(c.avgDiscrimination) : ""}>disc {c.avgDiscrimination ?? "—"}</span></div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-gray-400 mt-4 leading-relaxed border-t border-gray-50 pt-3">Difficulty (p-value) = share of attempts correct; ideal ≈ 0.3–0.85. Discrimination = strong-candidate correctness minus weak-candidate correctness (≥0.3 good, &lt;0.15 weak, &lt;0 flag). Decision-support for item review, not an automated edit.</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
