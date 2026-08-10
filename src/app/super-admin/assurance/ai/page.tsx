import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAssuranceDashboard } from "@/lib/assurance/assurance-dashboard";
import AiCopilotPanel from "@/components/AiCopilotPanel";
import { requireHqCapability } from "@/lib/hq/context";

// CAPA-010 — AI Assurance Intelligence. A live copilot grounded in the consolidated enterprise assurance picture,
// alongside the signals it reasons over. Predict / recommend / explain over the real assurance score + risks —
// the LLM layer on top of the rule-based engines. Super-admin, enterprise-wide.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const RISK: Record<string, string> = { red: "border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)]", amber: "border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)]", gray: "border-gray-200 bg-gray-50" };
const DOT: Record<string, string> = { red: "bg-[var(--cmp-color-error)]", amber: "bg-[var(--cmp-color-warning)]", gray: "bg-gray-300" };
const BAND: Record<string, string> = { emerald: "text-[var(--cmp-text-success)]", amber: "text-[var(--cmp-text-warning)]", rose: "text-[var(--cmp-text-error)]" };

const AGENTS = ["Assessor Reliability", "Competency Drift", "Corrective Action", "Evidence Integrity", "Compliance & Accreditation", "Assurance Score"];

export default async function AssuranceAiPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  await requireHqCapability("hq.quality.assurance.view");

  const q = await loadAssuranceDashboard(admin, profile?.hospital_id ?? null, true);
  const card = "bg-white rounded-xl border border-gray-100";

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-indigo-500 uppercase tracking-widest mb-0.5">CAPA-010 · Competency Assurance</p>
          <h1 className="text-xl font-bold text-gray-900">AI Assurance Intelligence</h1>
          <p className="text-gray-400 text-sm mt-0.5">Ask the assurance copilot — it predicts, recommends and explains over the live assurance score, domains and risks the engines produce.</p>
        </div>
        <Link href="/super-admin/assurance" className="text-xs font-semibold text-gray-500 hover:text-indigo-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Assurance</Link>
      </div>

      <AiCopilotPanel
        endpoint="/api/assurance/copilot"
        title="Assurance Intelligence Copilot — live"
        sublabel="Grounded in the enterprise assurance score, per-domain breakdown and ranked risks · logged to the AI gateway"
        placeholder="Ask what's dragging assurance down and what to fix first…"
        prompts={["Assurance briefing", "Top 3 risks to act on", "Why is the score where it is?", "Which competencies are drifting?"]}
      />

      {!q.provisioned ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-4 mt-4"><p className="text-[13px] text-amber-900">No assurance signals yet — the copilot needs competency decisions, assessments or corrective actions to reason over.</p></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
          {/* Score it's grounded in */}
          <div className={`${card} p-5 flex flex-col items-center justify-center text-center`}>
            <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">Grounded in assurance score</p>
            <p className={`text-4xl font-bold tabular-nums ${BAND[q.band!.tone]}`}>{q.overall}</p>
            <p className={`text-sm font-semibold mt-0.5 ${BAND[q.band!.tone]}`}>{q.band!.label}</p>
            <Link href="/super-admin/assurance/dashboard" className="text-[11px] text-indigo-600 hover:underline mt-2">Full dashboard →</Link>
          </div>

          {/* Top risks the copilot reasons over */}
          <div className={`${card} p-4 lg:col-span-2`}>
            <p className="text-[11px] font-semibold text-gray-500 mb-3">Signals in context</p>
            {q.risks.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">No open risks — the copilot will confirm the system is within tolerance.</p>
            ) : (
              <div className="space-y-2">
                {q.risks.slice(0, 5).map((r: any, i: number) => (
                  <div key={i} className={`flex items-start gap-2.5 rounded-lg border p-2.5 ${RISK[r.tone] ?? RISK.gray}`}>
                    <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${DOT[r.tone] ?? DOT.gray}`} />
                    <div className="min-w-0 flex-1"><p className="text-[13px] font-semibold text-gray-800 leading-tight">{r.title}</p><p className="text-[11px] text-gray-500 mt-0.5">{r.detail}</p></div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-gray-50">
              {AGENTS.map(a => <span key={a} className="text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">{a}</span>)}
            </div>
          </div>
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-4 leading-relaxed">The copilot answers only from the live assurance signals above — it never invents scores, staff or competencies. It advises; acting on any recommendation routes through the owning, audited surface. Every call logs to the AI gateway (AIS-011 observability).</p>
    </div>
  );
}
