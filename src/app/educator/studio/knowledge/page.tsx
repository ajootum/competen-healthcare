import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { KNOWLEDGE_TYPE_UI } from "@/lib/ckcm";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import { EduHeader } from "../../ui";

// Clinical Library / Clinical Knowledge Objects (live view) — the governed
// knowledge library and case library. Objects open in the shared reader.

export const dynamic = "force-dynamic";
type SearchParams = Promise<{ q?: string; type?: string }>;

const STATUS_CLS: Record<string, string> = {
  published: "bg-green-100 text-green-700", draft: "bg-gray-100 text-gray-600",
  in_review: "bg-amber-100 text-amber-700", retired: "bg-gray-100 text-gray-400",
};

export default async function KnowledgePage({ searchParams }: { searchParams: SearchParams }) {
  const { admin } = await requireEducatorAccess();
  const { q, type } = await searchParams;

  let query = admin.from("knowledge_objects")
    .select("id, code, title, knowledge_type, status, evidence_level, review_date")
    .neq("status", "retired").order("created_at", { ascending: false }).limit(80);
  if (q?.trim()) query = query.ilike("title", `%${q.trim()}%`);
  if (type && KNOWLEDGE_TYPE_UI[type]) query = query.eq("knowledge_type", type);

  const [{ data: objects }, { data: allTypes }, { data: cases }] = await Promise.all([
    query,
    admin.from("knowledge_objects").select("knowledge_type").neq("status", "retired").limit(1000),
    admin.from("clinical_cases").select("id, code, title, difficulty, status").neq("status", "retired").order("created_at", { ascending: false }).limit(30),
  ]);
  const typeCounts = new Map<string, number>();
  for (const o of allTypes ?? []) typeCounts.set(o.knowledge_type, (typeCounts.get(o.knowledge_type) ?? 0) + 1);

  return (
    <div className="max-w-4xl">
      <Link href="/educator/studio/content" className="text-xs text-gray-400 hover:text-gray-600">← Learning Content Studio</Link>
      <div className="mt-1"><EduHeader icon="📚" title="Clinical Library" sub="Governed clinical knowledge objects and the case library — the material that grounds learning and AI." /></div>
      <StatTiles tiles={[
        { label: "Knowledge Objects", value: String([...typeCounts.values()].reduce((a, b) => a + b, 0)) },
        { label: "Types", value: String(typeCounts.size) },
        { label: "Clinical Cases", value: String((cases ?? []).length) },
        { label: "Published", value: String((objects ?? []).filter(o => o.status === "published").length) },
      ]} />

      <form action="/educator/studio/knowledge" className="flex items-center gap-2 mb-3">
        <input name="q" defaultValue={q ?? ""} placeholder="Search the library…"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-purple-400" />
        <button type="submit" className="text-sm font-semibold text-white bg-purple-600 rounded-lg px-4 py-2 hover:bg-purple-700">Search</button>
      </form>
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        <Link href={`/educator/studio/knowledge${q ? `?q=${encodeURIComponent(q)}` : ""}`}
          className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border ${!type ? "bg-purple-600 text-white border-purple-600" : "bg-white text-gray-600 border-gray-200"}`}>All</Link>
        {[...typeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => (
          <Link key={t} href={`/educator/studio/knowledge?type=${t}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`text-[11px] px-2.5 py-1 rounded-lg border ${type === t ? "bg-purple-600 text-white border-purple-600" : "bg-white text-gray-600 border-gray-200 hover:border-purple-300"}`}>
            {KNOWLEDGE_TYPE_UI[t]?.icon ?? "📄"} {KNOWLEDGE_TYPE_UI[t]?.label ?? t} ({c})
          </Link>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-2 mb-4">
        {(objects ?? []).map(o => (
          <Link key={o.id} href={`/dashboard/knowledge/${o.id}`} className="bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-purple-300 transition-colors">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-gray-800 flex-1">{KNOWLEDGE_TYPE_UI[o.knowledge_type]?.icon ?? "📄"} {o.title}</p>
              <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${STATUS_CLS[o.status] ?? "bg-gray-100"}`}>{o.status.replace("_", " ")}</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5">{o.code ? `${o.code} · ` : ""}{KNOWLEDGE_TYPE_UI[o.knowledge_type]?.label ?? o.knowledge_type}{o.evidence_level ? ` · ${o.evidence_level}` : ""}</p>
          </Link>
        ))}
        {!(objects ?? []).length && <p className="text-xs text-gray-400">No knowledge objects match.</p>}
      </div>

      <Card title="Case Library" sub="governed clinical cases">
        {(cases ?? []).length ? (
          <div className="flex flex-wrap gap-1.5">
            {(cases ?? []).map(c => (
              <span key={c.id} className="text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5">
                {c.code ? `${c.code} · ` : ""}{c.title}{c.difficulty ? ` · ${c.difficulty}` : ""}
              </span>
            ))}
          </div>
        ) : <p className="text-xs text-gray-400">No cases yet.</p>}
      </Card>

      <p className="text-[10px] text-gray-400 mt-4">
        Content is authored and governed in the platform Studio; it opens in the shared reader. Video/media hosting and microlearning have no store yet.
      </p>
    </div>
  );
}
