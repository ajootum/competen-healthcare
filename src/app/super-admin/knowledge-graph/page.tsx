import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { graphStats } from "@/lib/engines/graph";
import { aiStatus } from "@/lib/ai/config";
import GraphControls from "./GraphControls";

export default async function KnowledgeGraphPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") redirect("/dashboard");

  const stats = await graphStats(admin);
  const ai = aiStatus();

  const REL_LABEL: Record<string, string> = {
    contains: "Contains", assesses: "Assesses", supports: "Supports",
    belongs_to: "Belongs to", requires: "Requires", depends_on: "Depends on",
    generates: "Generates", validates: "Validates", supersedes: "Supersedes",
    references: "References", related_to: "Related to",
  };

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Knowledge Graph</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          The semantic backbone connecting every governed object — the substrate for AI retrieval and impact analysis (Book IV Ch.2–5).
        </p>
      </div>

      {/* AI readiness banner */}
      <div className={`rounded-xl px-5 py-4 mb-6 border ${ai.configured ? "bg-green-50 border-green-100" : "bg-amber-50 border-amber-100"}`}>
        <div className="flex items-center gap-2">
          <span className="text-lg">{ai.configured ? "🟢" : "🟡"}</span>
          <div>
            <p className={`text-sm font-semibold ${ai.configured ? "text-green-800" : "text-amber-800"}`}>
              {ai.configured ? `AI configured — provider: ${ai.provider}` : "AI not configured"}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {ai.configured
                ? "Retrieval, embeddings and agents are live. Reasoning model: " + (ai.models?.reasoning ?? "—")
                : "Add an ANTHROPIC_API_KEY (or OPENAI_API_KEY / GEMINI_API_KEY) to enable semantic search, embeddings and AI agents. The graph below works without it."}
            </p>
          </div>
        </div>
      </div>

      {/* Graph controls + stats */}
      <GraphControls
        totalEdges={stats.totalEdges}
        nodeTypes={stats.nodeTypes.length}
        embeddingTotal={stats.embeddingTotal}
        embeddingDone={stats.embeddingDone}
      />

      {/* Relationship breakdown */}
      <div className="mt-6">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Relationships</h2>
        {stats.totalEdges === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
            <p className="text-gray-400 text-sm">Graph is empty — click <span className="font-semibold">Rebuild Graph</span> to derive edges from your competency hierarchy.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden divide-y divide-gray-50">
            {Object.entries(stats.byRelationship).sort((a, b) => b[1] - a[1]).map(([rel, count]) => (
              <div key={rel} className="flex items-center justify-between px-5 py-2.5">
                <span className="text-sm text-gray-700">{REL_LABEL[rel] ?? rel}</span>
                <span className="text-sm font-bold text-gray-800">{count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
