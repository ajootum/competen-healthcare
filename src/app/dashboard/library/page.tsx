import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import LibrarySearch from "./LibrarySearch";

// Clinical Library — the central evidence hub (Clinical Library Redesign
// spec). Intelligent full-text search over the governed knowledge base,
// summary cards with real counts, and featured content from the newest
// governed knowledge objects and case studies. Bookmarks/recently-viewed
// need their own store (spec §12) — registered, not faked.

const KNOWLEDGE_ICON: Record<string, string> = {
  anatomy: "🫀", physiology: "🫁", pathophysiology: "🧬", pharmacology: "💊",
  clinical_reasoning: "🧠", other: "📘",
};

export default async function ClinicalLibraryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [
    policiesCount, resourcesCount, qualityCount, knowledgeCount, casesCount,
    { data: featuredKnowledge }, { data: featuredCases }, { data: qos },
  ] = await Promise.all([
    admin.from("policies").select("id", { count: "exact", head: true }),
    admin.from("learning_resources").select("id", { count: "exact", head: true }).eq("is_active", true),
    admin.from("quality_objects").select("id", { count: "exact", head: true }).eq("status", "active"),
    admin.from("knowledge_objects").select("id", { count: "exact", head: true }).neq("status", "retired"),
    admin.from("clinical_cases").select("id", { count: "exact", head: true }).neq("status", "retired"),
    admin.from("knowledge_objects").select("id, title, knowledge_type, created_at")
      .neq("status", "retired").order("created_at", { ascending: false }).limit(4),
    admin.from("clinical_cases").select("id, title, created_at")
      .neq("status", "retired").order("created_at", { ascending: false }).limit(3),
    admin.from("quality_objects").select("id, title, description").eq("status", "active").order("title").limit(5),
  ]);

  const learningTotal = (resourcesCount.count ?? 0) + (knowledgeCount.count ?? 0) + (casesCount.count ?? 0);

  const CARDS = [
    {
      title: "Guidelines & Policies", icon: "🛡️", border: "border-t-teal-500",
      sub: "Hospital policies, SOPs and practice guidelines.",
      count: policiesCount.count ?? 0, unit: "documents",
    },
    {
      title: "Learning Resources", icon: "📚", border: "border-t-violet-500",
      sub: "Evidence-based resources, knowledge objects and case studies.",
      count: learningTotal, unit: "resources",
    },
    {
      title: "Quality Standards", icon: "🏅", border: "border-t-blue-500",
      sub: "Standards, checklists and quality improvement tools.",
      count: qualityCount.count ?? 0, unit: "standards",
    },
  ];

  const card = "bg-white rounded-xl border border-gray-100";

  return (
    <div className="max-w-5xl">
      <div className="flex items-start gap-3 mb-6">
        <span className="w-11 h-11 rounded-xl bg-teal-600 text-white flex items-center justify-center text-xl shrink-0">📖</span>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Clinical Library</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Your centralized hub for evidence-based clinical content, guidelines and standards.
          </p>
        </div>
      </div>

      <LibrarySearch />

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {CARDS.map(c => (
          <div key={c.title} className={`${card} border-t-4 ${c.border} p-5`}>
            <p className="text-xs font-bold text-gray-800 uppercase tracking-wide flex items-center gap-2">
              <span>{c.icon}</span>{c.title}
            </p>
            <p className="text-[11px] text-gray-400 mt-1.5 min-h-[30px]">{c.sub}</p>
            <p className="text-3xl font-extrabold text-gray-900 mt-2">{c.count}</p>
            <p className="text-[10px] text-gray-400">{c.unit}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Newest governed content */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-sm">New in the Library</h2>
            <Link href="/dashboard/copilot" className="text-xs text-teal-600 hover:underline">Study with the AI Coach →</Link>
          </div>
          {(featuredKnowledge ?? []).length === 0 && (featuredCases ?? []).length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">Governed content appears here as your organisation publishes it. 📚</p>
          ) : (
            <div className="flex flex-col">
              {(featuredKnowledge ?? []).map(k => (
                <div key={k.id} className="flex items-center gap-2.5 py-2 border-b border-gray-50 last:border-0">
                  <span className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center text-sm shrink-0">
                    {KNOWLEDGE_ICON[k.knowledge_type] ?? "📘"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-gray-800 leading-snug">{k.title}</p>
                    <p className="text-[9px] text-gray-400 capitalize">Knowledge object · {String(k.knowledge_type).replace(/_/g, " ")}</p>
                  </div>
                </div>
              ))}
              {(featuredCases ?? []).map(c => (
                <div key={c.id} className="flex items-center gap-2.5 py-2 border-b border-gray-50 last:border-0">
                  <span className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center text-sm shrink-0">🧑‍⚕️</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-gray-800 leading-snug">{c.title}</p>
                    <p className="text-[9px] text-gray-400">Clinical case study</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quality standards */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Featured Quality Standards</h2>
          {(qos ?? []).length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">Quality standards appear once published. 🛡️</p>
          ) : (
            <div className="flex flex-col">
              {(qos ?? []).map(q => (
                <div key={q.id} className="flex items-center gap-2.5 py-2 border-b border-gray-50 last:border-0" title={q.description ?? undefined}>
                  <span className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center text-sm shrink-0">🛡️</span>
                  <p className="text-[12px] text-gray-800 leading-snug flex-1">{q.title}</p>
                  <span className="text-gray-300 text-xs">›</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 bg-white rounded-xl border border-gray-100 px-5 py-3.5 flex items-center gap-2 text-[12px] text-gray-500">
        <span>ℹ️</span>
        Can&apos;t find what you&apos;re looking for? Ask the{" "}
        <Link href="/dashboard/copilot" className="text-teal-600 font-semibold hover:underline">AI Clinical Coach</Link>
        {" "}— it searches and cites this library.
      </div>
    </div>
  );
}
