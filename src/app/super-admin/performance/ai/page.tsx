import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadOutcomeCorrelation } from "@/lib/performance/outcome-correlation";
import AiCopilotPanel from "@/components/AiCopilotPanel";
import { requireHqCapability } from "@/lib/hq/context";

// CAPM-010 — AI Performance Intelligence. A live copilot grounded in the enterprise performance picture (balanced
// scorecard + competency-to-outcome correlation), alongside the correlation signal it reasons over. Predict /
// recommend / explain over real performance data. Super-admin, enterprise-wide.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const CORR: Record<string, string> = { emerald: "text-[var(--cmp-text-success)]", rose: "text-[var(--cmp-text-error)]", gray: "text-gray-500" };
const AGENTS = ["Outcome Correlation", "Balanced Scorecard", "Competency Coverage", "Benchmarking", "Forecasting", "Executive Intelligence"];

export default async function PerformanceAiPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  await requireHqCapability("hq.executive.performance.view");

  const corr = await loadOutcomeCorrelation(admin, profile?.hospital_id ?? null, true);
  const card = "bg-white rounded-xl border border-gray-100";
  const hasCorr = corr.provisioned && !corr.empty && !corr.insufficient;

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-sky-500 uppercase tracking-widest mb-0.5">CAPM-010 · Competency Performance</p>
          <h1 className="text-xl font-bold text-gray-900">AI Performance Intelligence</h1>
          <p className="text-gray-500 text-sm mt-0.5">Ask the performance copilot — it predicts, recommends and explains over the live scorecard and the competency-to-outcome correlation.</p>
        </div>
        <Link href="/super-admin/performance" className="text-xs font-semibold text-gray-500 hover:text-[var(--cmp-text-information)] border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Performance</Link>
      </div>

      <AiCopilotPanel
        endpoint="/api/capm/copilot"
        title="Performance Intelligence Copilot — live"
        sublabel="Grounded in the balanced scorecard + competency-to-outcome correlation · logged to the AI gateway"
        placeholder="Ask whether competency is improving outcomes and what to prioritise…"
        prompts={["Performance briefing", "Is competency improving outcomes?", "Where are we off target?", "Top 3 priorities"]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        {/* The correlation it reasons over */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <p className="text-[11px] font-semibold text-gray-500 mb-3">Signal in context — competency ↔ outcomes</p>
          {!hasCorr ? (
            <p className="text-sm text-gray-500">Not enough department data to correlate competency with outcomes yet — the copilot will say so rather than overclaim.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {[
                { title: "↔ observation compliance", corr: corr.complianceCorr },
                { title: "↔ escalation rate", corr: corr.escalationCorr },
              ].map((b: any) => (
                <div key={b.title} className="border border-gray-100 rounded-lg p-3">
                  <p className={`text-2xl font-bold tabular-nums ${CORR[b.corr.tone] ?? CORR.gray}`}>{b.corr.r == null ? "—" : (b.corr.r > 0 ? "+" : "") + b.corr.r}</p>
                  <p className="text-[11px] text-gray-500">{b.title}</p>
                  <p className={`text-[10px] font-semibold mt-0.5 ${CORR[b.corr.tone] ?? CORR.gray}`}>{b.corr.label}</p>
                </div>
              ))}
              <p className="col-span-2 text-[10px] text-gray-500">Across {corr.kpis.departments} departments · avg competency {corr.kpis.avgCompetency}% · avg compliance {corr.kpis.avgCompliance}%. <Link href="/super-admin/performance/correlation" className="text-[var(--cmp-text-information)] hover:underline">Full correlation →</Link></p>
            </div>
          )}
        </div>

        {/* Engines */}
        <div className={`${card} p-4`}>
          <p className="text-[11px] font-semibold text-gray-500 mb-3">Intelligence engines</p>
          <div className="flex flex-wrap gap-1.5">
            {AGENTS.map(a => <span key={a} className="text-[10px] text-[var(--cmp-text-information)] bg-[var(--cmp-surface-information)] border border-[var(--cmp-color-information)] rounded-full px-2 py-0.5">{a}</span>)}
          </div>
          <p className="text-[10px] text-gray-500 mt-3">The copilot reasons over the balanced scorecard and the correlation engine, then explains in plain language.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-500 mt-4 leading-relaxed">The copilot answers only from the live performance signals — it never invents KPIs, scores or correlations, and it treats the competency-to-outcome correlation as ecological/directional, never causal. It advises; acting routes through the owning surface. Every call logs to the AI gateway.</p>
    </div>
  );
}
