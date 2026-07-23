import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadKnowledgeIntelligence } from "@/lib/super-admin/ckp-intelligence";
import { JOB_REGISTRY } from "@/lib/platform/jobs";
import JobRunner from "../../ai/_components/JobRunner";
import AskPanel from "../../ai/_components/AskPanel";

export const dynamic = "force-dynamic";

// Knowledge Intelligence (CKP-001.6) — analytics & AI over the clinical knowledge
// base. Coverage, gap analysis, duplicate detection, a knowledge-health composite
// and derived recommendations — all computed from real data; usage/search
// analytics show honest "needs telemetry" states.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmt = (n: number) => n.toLocaleString();
const IMPACT_TONE: Record<string, string> = { High: "text-rose-600 bg-rose-50", Medium: "text-amber-600 bg-amber-50", Low: "text-gray-500 bg-gray-100" };

export default async function KnowledgeIntelligence() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const q = await loadKnowledgeIntelligence(admin);
  const k = q.kpis;

  const healthTone = k.health == null ? "text-gray-400" : k.health >= 80 ? "text-green-600" : k.health >= 50 ? "text-amber-600" : "text-orange-600";
  const kpiCards = [
    { label: "Knowledge Health", value: k.health == null ? "—" : `${k.health}%`, icon: "💚", iconBg: "bg-green-50", tone: healthTone },
    { label: "Coverage Score", value: k.coverage == null ? "—" : `${k.coverage}%`, icon: "🎯", iconBg: "bg-violet-50", tone: k.coverage != null && k.coverage < 50 ? "text-amber-600" : "text-gray-900" },
    { label: "Duplicate Items", value: fmt(k.duplicates), icon: "🧬", iconBg: "bg-rose-50", tone: k.duplicates ? "text-rose-600" : "text-gray-900" },
    { label: "Knowledge Gaps", value: fmt(k.gaps), icon: "🕳️", iconBg: "bg-orange-50", tone: k.gaps ? "text-orange-600" : "text-gray-900" },
    { label: "Missing Competencies", value: fmt(k.missingCompetencies), icon: "⚠️", iconBg: "bg-amber-50", tone: k.missingCompetencies ? "text-amber-600" : "text-gray-900" },
    { label: "AI Recommendations", value: fmt(k.recommendations), icon: "✨", iconBg: "bg-teal-50", tone: k.recommendations ? "text-teal-600" : "text-gray-900" },
  ];

  const tools = [
    { label: "Knowledge Analytics", icon: "📊", href: "/super-admin/knowledge-graph" },
    { label: "AI Recommendations", icon: "✨", href: "/super-admin/assistant" },
    { label: "Coverage Analysis", icon: "🎯", href: "/super-admin/ckp/competency" },
    { label: "Duplicate Detection", icon: "🧬", href: "/super-admin/studio/knowledge" },
    { label: "Gap Analysis", icon: "🕳️", href: "/super-admin/content" },
    { label: "Knowledge Health", icon: "💚", href: "/super-admin/ckp" },
    { label: "Usage Analytics", icon: "📈", href: "/super-admin/reports" },
    { label: "Predictive Intelligence", icon: "🔮", href: "/super-admin/assistant" },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/ckp" className="hover:text-teal-700">Clinical Knowledge Platform</Link><span>/</span><span className="text-gray-600">Knowledge Intelligence</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Knowledge Intelligence</h1>
        <p className="text-sm text-gray-500">Analytics and AI-driven insight over the clinical knowledge base.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
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

      {/* Real interactive canvases: on-demand intelligence scan + grounded knowledge Q&A */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <JobRunner jobs={JOB_REGISTRY.filter(j => j.category === "knowledge")} title="Run Intelligence Scan" />
        <AskPanel
          title="Ask the Knowledge Base"
          placeholder="Ask about coverage, gaps or any knowledge topic…"
          prompts={[
            "Which competencies are not mapped to a CPU?",
            "Which frameworks have the lowest coverage?",
            "Summarise the knowledge base by type",
          ]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Knowledge health dimensions */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Knowledge Health <span className="text-[10px] text-gray-400">{k.health == null ? "" : `${k.health}% overall`}</span></h2>
          <div className="space-y-2.5">
            {q.dimensions.map((d: any) => (
              <div key={d.label}>
                <div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600">{d.label}</span><span className={`tabular-nums ${d.value == null ? "text-gray-300" : "text-gray-700"}`}>{d.value == null ? "n/a" : `${d.value}%`}</span></div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">{d.value != null && <div className={`h-full rounded-full ${d.value >= 70 ? "bg-green-500" : d.value >= 40 ? "bg-amber-500" : "bg-orange-500"}`} style={{ width: `${d.value}%` }} />}</div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Usage needs access telemetry (not collected); overall health averages the computable dimensions.</p>
        </div>

        {/* Top AI insights */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Top AI Insights</h2>
          {q.insights.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">✅ No gaps detected — the knowledge base looks healthy.</p> : (
            <div className="space-y-2">
              {q.insights.map((r: any, i: number) => (
                <Link key={i} href={r.href ?? "/super-admin/ckp"} className="flex items-center gap-2.5 rounded-lg border border-gray-100 p-2.5 hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
                  <span className="text-base shrink-0">✨</span>
                  <span className="text-sm text-gray-700 flex-1 min-w-0">{r.text}</span>
                  <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0 ${IMPACT_TONE[r.impact]}`}>{r.impact} impact</span>
                  <span className="text-xs text-teal-600 shrink-0">→</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Coverage analysis */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Coverage Analysis</h2>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[["Mapped", q.coverage.mapped], ["Total", q.coverage.total], ["Missing", q.coverage.missing]].map(([l, n]) => (
              <div key={l as string} className="rounded-lg border border-gray-100 py-2.5 text-center"><p className={`text-lg font-bold tabular-nums ${l === "Missing" && (n as number) > 0 ? "text-orange-600" : "text-gray-900"}`}>{fmt(n as number)}</p><p className="text-[10px] text-gray-500">{l}</p></div>
            ))}
          </div>
          {q.coverage.lowCoverageFrameworks.length > 0 ? (
            <div className="space-y-1 pt-2 border-t border-gray-50">
              <p className="text-[10px] font-semibold text-gray-400 uppercase">Low-coverage frameworks</p>
              {q.coverage.lowCoverageFrameworks.map((f: any) => <div key={f.name} className="flex items-center justify-between text-xs"><span className="text-gray-600 truncate">{f.name}</span><span className="text-orange-600 tabular-nums">{f.cov}%</span></div>)}
            </div>
          ) : <p className="text-[11px] text-gray-400 pt-2 border-t border-gray-50">All frameworks above 50% coverage.</p>}
        </div>

        {/* Duplicate detection */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Duplicate Detection</h2>
          <div className="grid grid-cols-2 gap-2">
            {[["KO duplicates", q.duplicates.knowledgeObjects.items], ["KO groups", q.duplicates.knowledgeObjects.groups], ["Competency dupes", q.duplicates.competencies.items], ["Comp groups", q.duplicates.competencies.groups]].map(([l, n]) => (
              <div key={l as string} className="rounded-lg border border-gray-100 p-3 text-center"><p className={`text-xl font-bold tabular-nums ${(n as number) > 0 ? "text-rose-600" : "text-gray-900"}`}>{fmt(n as number)}</p><p className="text-[10px] text-gray-500">{l}</p></div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Exact normalised-title matches. Semantic near-duplicate detection activates with the embedding index.</p>
        </div>

        {/* Gap analysis */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Gap Analysis</h2>
          <div className="space-y-2">
            {[["Empty domains", q.gaps.emptyDomains], ["CPUs without blueprint", q.gaps.cpusNoBlueprint], ["Low-coverage frameworks", q.gaps.lowCoverageFrameworks], ["Outdated policies", q.gaps.outdatedPolicies]].map(([l, n]) => (
              <div key={l as string} className="flex items-center justify-between text-sm py-1 border-b border-gray-50 last:border-0"><span className="text-gray-600">{l}</span><span className={`tabular-nums font-medium ${(n as number) > 0 ? "text-orange-600" : "text-gray-900"}`}>{fmt(n as number)}</span></div>
            ))}
          </div>
        </div>
      </div>

      {/* Intelligence tools + usage (honest) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`${card} p-5 lg:col-span-2`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Intelligence Tools</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {tools.map(t => (
              <Link key={t.label} href={t.href} className="flex flex-col items-center gap-1 rounded-lg border border-gray-100 py-3 px-2 text-center hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
                <span className="text-lg">{t.icon}</span><span className="text-[11px] font-semibold text-gray-700 leading-tight">{t.label}</span>
              </Link>
            ))}
          </div>
        </div>
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Usage Analytics</h2>
          <div className="py-6 text-center">
            <p className="text-2xl mb-1">📈</p>
            <p className="text-sm text-gray-500">Views, downloads and search analytics activate with content-access telemetry.</p>
            <span className="inline-block mt-2 text-[9px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Not collected</span>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Knowledge Intelligence is the analytics and AI layer — coverage, gap analysis, duplicate detection, knowledge health and recommendations are computed live from the knowledge base. The Intelligence Scan recomputes the composite on demand (and nightly at 05:00 UTC) and snapshots it to the platform event log for trending; each insight deep-links to the surface where it gets fixed, and the assistant answers grounded exclusively in approved CKCM content — published CPUs, active knowledge objects, cases and policies — with citations; drafts and retired items are never retrieved. Semantic duplicate detection and usage/search analytics activate with the embedding index and access telemetry.</p>
    </div>
  );
}
