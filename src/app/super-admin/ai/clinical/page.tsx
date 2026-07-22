import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadClinicalIntelligence } from "@/lib/super-admin/ai-clinical";
import AskPanel from "../_components/AskPanel";

export const dynamic = "force-dynamic";

// Clinical Intelligence (AIP-001.2) — evidence-informed clinical decision support
// grounded in approved Competen knowledge. Supports, never replaces, professional
// judgement. Live clinical AI usage, high-risk signals, the approved knowledge
// base and the human review queue; honest states where recommendations aren't
// separately stored.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const SEV_TONE: Record<string, string> = { critical: "bg-rose-50 text-rose-700", high: "bg-orange-50 text-orange-700", medium: "bg-amber-50 text-amber-700", low: "bg-gray-100 text-gray-600" };

export default async function ClinicalIntelligence() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadClinicalIntelligence(admin);
  const k = d.kpis;

  const kpiCards = [
    { label: "Clinical AI (24h)", value: dash(k.clinicalReq24h), icon: "🩺", iconBg: "bg-teal-50" },
    { label: "High-Risk Alerts", value: dash(k.highRiskAlerts), icon: "🚨", iconBg: "bg-rose-50", tone: (k.highRiskAlerts ?? 0) > 0 ? "text-rose-600" : undefined },
    { label: "Escalations", value: dash(k.escalations), icon: "⛑️", iconBg: "bg-orange-50", tone: (k.escalations ?? 0) > 0 ? "text-orange-600" : undefined },
    { label: "Pathways", value: dash(k.pathways), icon: "🧭", iconBg: "bg-sky-50" },
    { label: "Competencies", value: dash(k.competencies), icon: "🎯", iconBg: "bg-violet-50" },
    { label: "Evidence", value: dash(k.evidence), icon: "📎", iconBg: "bg-blue-50" },
    { label: "Guidelines", value: dash(k.policies), icon: "📋", iconBg: "bg-indigo-50" },
    { label: "Awaiting Review", value: dash(k.awaitingReview), icon: "👀", iconBg: "bg-amber-50", tone: (k.awaitingReview ?? 0) > 0 ? "text-amber-600" : undefined },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/ai" className="hover:text-teal-700">AI &amp; Intelligence</Link><span>/</span><span className="text-gray-600">Clinical Intelligence</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Clinical Intelligence</h1>
        <p className="text-sm text-gray-500">Evidence-informed clinical decision support — grounded in approved knowledge, supporting professional judgement.</p>
      </div>

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {kpiCards.map(c => (
          <div key={c.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</span>
              <span className={`w-7 h-7 rounded-lg ${c.iconBg} flex items-center justify-center text-sm shrink-0`}>{c.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${(c as any).tone ?? "text-gray-900"}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Live grounded clinical Q&A — real CKCM-grounded assistant in-place */}
      <AskPanel
        title="Ask Clinical Intelligence"
        placeholder="Ask a grounded clinical knowledge question…"
        prompts={[
          "Which competencies cover patient deterioration?",
          "What CPUs address airway management?",
          "Summarise our infection control policies",
          "Which frameworks include paediatric competencies?",
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Clinical Copilot */}
        <div className={`${card} p-5 flex flex-col`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-2">Clinical Copilot</h2>
          <p className="text-sm text-gray-500 mb-3">Contextual clinical reasoning, deterioration support, care planning and guideline retrieval — grounded in approved CKCM content with citations and confidence.</p>
          {d.clinicalOps.length > 0 ? (
            <div className="space-y-1.5 mb-3">
              {d.clinicalOps.slice(0, 5).map((o: any) => (
                <div key={o.label} className="flex items-center justify-between text-xs">
                  <span className="text-gray-600 truncate">{o.label}</span>
                  <span className="tabular-nums text-gray-400 shrink-0 ml-2">{o.n} · {o.tokens.toLocaleString()}t</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400 mb-3">{d.aiReady ? "No clinical AI activity in the last 24h." : "AI usage telemetry off."}</p>}
          <Link href="/super-admin/assistant" className="mt-auto text-center text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-3.5 py-2">Open Clinical Assistant</Link>
        </div>

        {/* Approved knowledge composition */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Approved Knowledge</h2>
            <span className="text-[10px] text-gray-400">{dash(k.knowledgeTotal)} objects</span>
          </div>
          {d.composition.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No knowledge objects yet.</p> : (
            <div className="space-y-2">
              {d.composition.slice(0, 8).map((c: any) => {
                const total = k.knowledgeTotal || 1;
                return (
                  <div key={c.label}>
                    <div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600 capitalize">{String(c.label).replace(/_/g, " ")}</span><span className="tabular-nums text-gray-400">{c.n}</span></div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-teal-500 rounded-full" style={{ width: `${(c.n / total) * 100}%` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">{dash(k.cpus)} CPUs · {dash(k.cases)} clinical cases · {dash(k.policies)} policies.</p>
        </div>

        {/* High-risk & escalations */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">High-Risk &amp; Escalations</h2>
            <Link href="/super-admin/platform-ops/monitoring" className="text-xs text-teal-700 hover:underline">Monitor →</Link>
          </div>
          {d.escalations.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No open escalations.</p> : (
            <div className="divide-y divide-gray-50">
              {d.escalations.map((e: any) => (
                <div key={e.id} className="flex items-start gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-800 leading-tight truncate">{e.summary || e.escalation_type || "Escalation"}</p>
                    <p className="text-[10px] text-gray-400">{e.escalation_type ?? "—"} · {relTime(e.created_at)}</p>
                  </div>
                  {(e.severity || e.level) && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${SEV_TONE[String(e.severity ?? e.level).toLowerCase()] ?? "bg-gray-100 text-gray-600"}`}>{e.severity ?? `L${e.level}`}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Capabilities */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Clinical Capabilities</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {d.capabilities.map((c: any) => (
              <Link key={c.name} href={c.href} className="flex items-start gap-2.5 rounded-lg border border-gray-100 p-3 hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-400 mt-1.5 shrink-0" />
                <div className="min-w-0"><p className="text-sm font-medium text-gray-800 leading-tight">{c.name}</p><p className="text-[10px] text-gray-500 leading-tight">{c.desc}</p></div>
              </Link>
            ))}
          </div>
        </div>

        {/* Safety controls */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-1">Safety Controls</h2>
          <p className="text-[11px] text-gray-400 mb-3">Non-negotiable clinical guardrails.</p>
          <div className="space-y-1.5">
            {d.safety.map((s: string) => (
              <p key={s} className="text-xs text-gray-600 flex items-start gap-1.5"><span className="text-green-500 shrink-0">✓</span><span>{s}</span></p>
            ))}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Clinical Intelligence supports — never replaces — professional clinical judgement. Clinical AI usage, high-risk safety alerts and open escalations are live (plat_ai_requests, op_safety_alerts, op_escalations); the approved-knowledge composition and review queue are live from the knowledge schema. Every AI recommendation must show its evidence, source, confidence and required review. Recommendation acceptance and outcome tracking are metered in Intelligence Analytics as evaluation is wired.</p>
    </div>
  );
}
