import Link from "next/link";
import { requireAnalyticsAccess } from "@/lib/analytics";
import { createAdminClient } from "@/lib/supabase/server";
import { KNOWLEDGE_TYPE_UI } from "@/lib/ckcm";
import { AiHeader } from "../ui";

// Knowledge Hub (assessor shell) — search the governed clinical knowledge
// library that grounds the AI. Items open in the shared reader.

export const dynamic = "force-dynamic";
type SearchParams = Promise<{ q?: string; type?: string }>;

export default async function AssessorKnowledgePage({ searchParams }: { searchParams: SearchParams }) {
  await requireAnalyticsAccess();
  const { q, type } = await searchParams;
  const admin = createAdminClient();

  let query = admin.from("knowledge_objects")
    .select("id, title, knowledge_type, status, created_at")
    .neq("status", "retired").order("created_at", { ascending: false }).limit(60);
  if (q?.trim()) query = query.ilike("title", `%${q.trim()}%`);
  if (type && KNOWLEDGE_TYPE_UI[type]) query = query.eq("knowledge_type", type);
  const { data: objects } = await query;

  const { data: allTypes } = await admin.from("knowledge_objects").select("knowledge_type").neq("status", "retired").limit(1000);
  const typeCounts = new Map<string, number>();
  for (const o of allTypes ?? []) typeCounts.set(o.knowledge_type, (typeCounts.get(o.knowledge_type) ?? 0) + 1);

  return (
    <div className="max-w-4xl">
      <AiHeader icon="🔬" title="Knowledge Hub" sub="Curated governed knowledge that supports quality assessments — the same library that grounds the AI." />

      <form action="/assessor/ai/knowledge" className="flex items-center gap-2 mb-3">
        <input name="q" defaultValue={q ?? ""} placeholder="Search guidelines, tools, procedures…"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-400" />
        {type && <input type="hidden" name="type" value={type} />}
        <button type="submit" className="text-sm font-semibold text-white bg-indigo-600 rounded-lg px-4 py-2 hover:bg-indigo-700">Search</button>
      </form>

      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        <Link href={`/assessor/ai/knowledge${q ? `?q=${encodeURIComponent(q)}` : ""}`}
          className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border ${!type ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-200"}`}>
          All ({[...typeCounts.values()].reduce((a, b) => a + b, 0)})
        </Link>
        {[...typeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t, count]) => (
          <Link key={t} href={`/assessor/ai/knowledge?type=${t}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`text-[11px] px-2.5 py-1 rounded-lg border ${type === t ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"}`}>
            {KNOWLEDGE_TYPE_UI[t]?.icon ?? "📄"} {KNOWLEDGE_TYPE_UI[t]?.label ?? t} ({count})
          </Link>
        ))}
      </div>

      {(objects ?? []).length ? (
        <div className="grid sm:grid-cols-2 gap-2">
          {(objects ?? []).map(o => (
            <Link key={o.id} href={`/dashboard/knowledge/${o.id}`}
              className="bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-indigo-300 transition-colors">
              <p className="text-xs font-semibold text-gray-800">{KNOWLEDGE_TYPE_UI[o.knowledge_type]?.icon ?? "📄"} {o.title}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{KNOWLEDGE_TYPE_UI[o.knowledge_type]?.label ?? o.knowledge_type} · opens in the reader ↗</p>
            </Link>
          ))}
        </div>
      ) : (
        <p className="bg-white border border-gray-200 rounded-xl px-4 py-10 text-center text-xs text-gray-400">
          No knowledge objects match{q ? ` “${q}”` : ""}.
        </p>
      )}

      <p className="text-[10px] text-gray-400 mt-4">
        Content is authored and governed in Studio. The reader opens in the shared shell. Journal-article feeds and external clinical calculators aren&apos;t integrated.
      </p>
    </div>
  );
}
