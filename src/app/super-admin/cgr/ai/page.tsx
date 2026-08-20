import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadGovernanceRegistry, type GovRecord } from "@/lib/cgr/registry";
import AiCopilotPanel from "@/components/AiCopilotPanel";
import { requireHqCapability } from "@/lib/hq/context";

// CGR-007 — Governance Intelligence & Predictive Risk. A live copilot grounded in the Competency Governance
// Registry (CGR-001) — it flags ownership, regulatory, review and evidence gaps and prioritises governance
// risk, alongside the signal it reasons over. It recommends and detects; it never approves or changes standards.
// Super-admin, enterprise-wide.
export const dynamic = "force-dynamic";

const AGENTS = ["Governance Registry", "Ownership Gaps", "Regulatory Alignment", "Review Currency", "Risk Exposure", "Change Control"];

function gapsOf(r: GovRecord): string {
  const g: string[] = [];
  if (!r.owner) g.push("no owner");
  if (r.standards === 0) g.push("no mapping");
  if (r.reviewOverdue) g.push("review overdue");
  else if (!r.reviewDue) g.push("no review date");
  if (r.decisions === 0) g.push("no evidence");
  return g.join(" · ") || "multiple gaps";
}

export default async function CgrAiPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.quality.regulation.view");

  const d = await loadGovernanceRegistry(admin);
  const k = d.kpis;
  const flagged = d.records.filter((r) => r.state === "at_risk" || r.state === "ungoverned").slice(0, 6);
  const card = "bg-white rounded-xl border border-gray-100";

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-[var(--cmp-text-success)] uppercase tracking-widest mb-0.5">CGR-007 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Governance Intelligence &amp; Predictive Risk</h1>
          <p className="text-gray-500 text-sm mt-0.5">Ask the governance copilot — it flags ownership, regulatory, review and evidence gaps and prioritises risk over the live registry. It recommends; it never approves or changes standards.</p>
        </div>
        <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← CGR Platform</Link>
      </div>

      <AiCopilotPanel
        endpoint="/api/cgr/copilot"
        title="Governance Intelligence Copilot — live"
        sublabel="Grounded in the Competency Governance Registry (CGR-001) · logged to the AI gateway"
        placeholder="Ask which competencies are at governance risk and what to prioritise…"
        prompts={["Governance briefing", "Which competencies are at risk?", "Where are the ownership gaps?", "Top 3 governance priorities"]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        {/* The registry signal it reasons over */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <p className="text-[11px] font-semibold text-gray-500 mb-3">Signal in context — governance registry</p>
          {!d.provisioned ? (
            <p className="text-sm text-gray-500">No competency definitions yet — the copilot will say so rather than overclaim.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                <div className="border border-gray-100 rounded-lg p-3"><p className={`text-2xl font-bold tabular-nums ${k.avgScore >= 75 ? "text-[var(--cmp-text-success)]" : k.avgScore >= 45 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]"}`}>{k.avgScore}</p><p className="text-[10px] text-gray-500">avg governance /100</p></div>
                <div className="border border-gray-100 rounded-lg p-3"><p className="text-2xl font-bold text-gray-900 tabular-nums">{k.ownerPct}%</p><p className="text-[10px] text-gray-500">with owner</p></div>
                <div className="border border-gray-100 rounded-lg p-3"><p className={`text-2xl font-bold tabular-nums ${k.overdue ? "text-[var(--cmp-text-error)]" : "text-gray-900"}`}>{k.overdue}</p><p className="text-[10px] text-gray-500">overdue reviews</p></div>
                <div className="border border-gray-100 rounded-lg p-3"><p className={`text-2xl font-bold tabular-nums ${d.states.at_risk + d.states.ungoverned ? "text-[var(--cmp-text-warning)]" : "text-gray-900"}`}>{d.states.at_risk + d.states.ungoverned}</p><p className="text-[10px] text-gray-500">at-risk / ungoverned</p></div>
              </div>
              {flagged.length > 0 ? (
                <div>
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Most at-risk it flags</p>
                  <div className="space-y-1">
                    {flagged.map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-2 text-[11px] border border-gray-50 rounded-lg px-2.5 py-1.5">
                        <span className="font-medium text-gray-700 truncate">{r.name}</span>
                        <span className="text-gray-500 shrink-0">{r.risk} · {gapsOf(r)}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-500 mt-2"><Link href="/super-admin/cgr/registry" className="text-[var(--cmp-text-success)] hover:underline">Full registry →</Link></p>
                </div>
              ) : (
                <p className="text-[11px] text-gray-500">No competencies currently at governance risk.</p>
              )}
            </>
          )}
        </div>

        {/* Engines */}
        <div className={`${card} p-4`}>
          <p className="text-[11px] font-semibold text-gray-500 mb-3">Intelligence lenses</p>
          <div className="flex flex-wrap gap-1.5">
            {AGENTS.map((a) => <span key={a} className="text-[10px] text-emerald-700 bg-[var(--cmp-surface-success)] border border-[var(--cmp-color-success)] rounded-full px-2 py-0.5">{a}</span>)}
          </div>
          <p className="text-[10px] text-gray-500 mt-3">The copilot reasons over the governance registry, then explains and prioritises in plain language.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-500 mt-4 leading-relaxed">The copilot answers only from the live governance registry — it never invents competencies, owners or scores. Per the CGR mandate it may recommend, detect and flag risk, but it cannot approve competencies, change standards or override governance decisions; acting routes through the responsible owner or authority. Every call logs to the AI gateway.</p>
    </div>
  );
}
