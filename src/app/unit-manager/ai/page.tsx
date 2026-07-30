import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitIntelligence } from "@/lib/operations/ai-intelligence";
import AiCopilotPanel from "@/components/AiCopilotPanel";
import AiTabs from "./AiTabs";

// AI & Intelligence (UMG-AI) command centre — the unit's cross-domain intelligence hub. Consolidates the
// rule-based AI signals every domain loader already computes into one prioritised view, adds a LIVE copilot
// grounded in the same data, and routes each domain lens to its authoritative surface. No fabricated ML.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const TONE: Record<string, string> = { red: "border-rose-200 bg-rose-50", amber: "border-amber-200 bg-amber-50", blue: "border-blue-200 bg-blue-50", gray: "border-gray-200 bg-gray-50", green: "border-emerald-200 bg-emerald-50" };
const DOT: Record<string, string> = { red: "bg-rose-500", amber: "bg-amber-500", blue: "bg-blue-500", gray: "bg-gray-300", green: "bg-emerald-500" };

export default async function UnitAiPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadUnitIntelligence(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const card = "bg-white rounded-xl border border-gray-200 p-5";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">AI & Intelligence</h1>
        <p className="text-sm text-gray-500 mt-1">Your unit&apos;s cross-domain intelligence — every domain&apos;s signals consolidated and prioritised, with a live copilot grounded in the same data.</p>
      </div>
      <AiTabs />

      <AiCopilotPanel
        endpoint="/api/unit-manager/copilot"
        title="Unit Intelligence Copilot — live"
        sublabel="Grounded in your unit's workforce, competency, safety, capacity & quality signals · logged to the AI gateway"
        placeholder="Ask what needs attention across the unit…"
        prompts={["Unit intelligence briefing", "Top risks right now", "My 3 highest-priority actions", "Where are we exposed on safety?"]}
      />

      {!d.provisioned ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-800">Unit intelligence isn&apos;t available yet — once competency and operational data exists, the hub consolidates it here automatically. The copilot above also relies on this data.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "AI health", value: d.aiHealth != null ? `${d.aiHealth}` : "—", tone: "text-gray-900", sub: "composite" },
              { label: "Confidence", value: d.confidence != null ? `${d.confidence}%` : "—", tone: "text-violet-600", sub: "signal-backed" },
              { label: "Critical signals", value: d.criticalCount, tone: d.criticalCount ? "text-rose-600" : "text-gray-900", sub: "act now" },
              { label: "Warnings", value: d.warnCount, tone: d.warnCount ? "text-amber-600" : "text-gray-900", sub: "watch" },
            ].map(k => (
              <div key={k.label} className={card}><div className={`text-2xl font-bold tabular-nums ${k.tone}`}>{k.value}</div><div className="text-xs text-gray-500 mt-1 font-medium">{k.label}</div><div className="text-[10px] text-gray-400">{k.sub}</div></div>
            ))}
          </div>

          {/* Domain intelligence tiles */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {d.domains.map((dm: any) => (
              <Link key={dm.key} href={dm.href} className={`rounded-xl border p-4 transition-all hover:shadow-sm ${TONE[dm.tone] ?? TONE.gray}`}>
                <div className="flex items-center justify-between mb-1"><span className="text-lg">{dm.icon}</span>{dm.signals > 0 && <span className={`w-2 h-2 rounded-full ${DOT[dm.tone] ?? DOT.gray}`} />}</div>
                <p className="text-sm font-semibold text-gray-900">{dm.key}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{dm.headline}</p>
                <p className="text-[10px] text-gray-400 mt-1">{dm.signals > 0 ? `${dm.signals} signal${dm.signals === 1 ? "" : "s"} →` : "View →"}</p>
              </Link>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Consolidated recommendations */}
            <div className={`${card} lg:col-span-2`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900 text-sm">Prioritised recommendations</h3>
                <Link href="/unit-manager/ai/recommendations" className="text-xs text-violet-600 hover:underline">All recommendations →</Link>
              </div>
              {d.recommendations.length === 0 ? (
                <p className="text-sm text-gray-400">No open recommendations — the unit&apos;s cross-domain signals are stable. 🎉</p>
              ) : (
                <div className="space-y-2">
                  {d.recommendations.slice(0, 6).map((rc: any, i: number) => (
                    <Link key={i} href={rc.href} className={`flex items-start gap-3 rounded-lg border p-3 transition-all hover:shadow-sm ${TONE[rc.tone] ?? TONE.gray}`}>
                      <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${DOT[rc.tone] ?? DOT.gray}`} />
                      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="text-sm font-semibold text-gray-800 truncate">{rc.title}</p><span className="text-[9px] font-bold uppercase tracking-wide text-gray-400 shrink-0">{rc.domain}</span></div><p className="text-xs text-gray-500 mt-0.5">{rc.detail}</p></div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Intelligence agents */}
            <div className={card}>
              <h3 className="font-semibold text-gray-900 text-sm mb-3">Intelligence engines</h3>
              <div className="space-y-1.5">
                {d.agents.map((a: string) => (
                  <div key={a} className="flex items-center gap-2 text-sm"><span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" /><span className="text-gray-600">{a}</span></div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-3">Each engine derives rule-based signals from a live domain store. The copilot reasons over their consolidated output.</p>
            </div>
          </div>

          <p className="text-[11px] text-gray-400">Recommendations are explainable, decision-support signals over real unit data — the copilot advises, it does not execute changes. Acting on any item routes to its authoritative, audited surface. Generated {new Date(d.generatedAt).toLocaleString()}.</p>
        </>
      )}
    </div>
  );
}
