import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import LibrarySearch from "../library/LibrarySearch";

// Knowledge Hub — the reading surface for the governed knowledge base
// (Knowledge Hub Redesign v2). Workers can now OPEN and read every governed
// knowledge object and clinical case study; search is the real FTS engine.
// The curated East-African reference list is kept, clearly labelled as a
// directory (no invented links). Bookmarks/downloads/ratings need their own
// stores — registered, not faked.

const KNOWLEDGE_TYPE_UI: Record<string, { label: string; icon: string }> = {
  anatomy: { label: "Anatomy", icon: "🫀" },
  physiology: { label: "Physiology", icon: "🫁" },
  pathophysiology: { label: "Pathophysiology", icon: "🧬" },
  pharmacology: { label: "Pharmacology", icon: "💊" },
  clinical_reasoning: { label: "Clinical Reasoning", icon: "🧠" },
  other: { label: "Reference", icon: "📘" },
};

// Curated external reference directory (no links on record — directory only)
const DIRECTORY: { category: string; items: { title: string; type: string; source: string }[] }[] = [
  {
    category: "External Clinical Guidelines",
    items: [
      { title: "Kenya Essential Medicines List (KEML) 2023", type: "PDF", source: "Ministry of Health Kenya" },
      { title: "WHO Infection Prevention and Control Guidelines", type: "PDF", source: "World Health Organization" },
      { title: "East African Community Nursing Standards", type: "Doc", source: "EAC Health Secretariat" },
      { title: "Pediatric Emergency Triage (ETAT+) Protocol", type: "PDF", source: "WHO AFRO" },
    ],
  },
  {
    category: "Policy & Compliance",
    items: [
      { title: "Nursing Council of Kenya — Licensure Requirements", type: "Link", source: "NCK" },
      { title: "Uganda Nurses & Midwives Council CPD Framework", type: "PDF", source: "UNMCA" },
      { title: "Tanzania Nursing & Midwifery Council Standards", type: "PDF", source: "TNMC" },
      { title: "Patient Rights Charter — East Africa", type: "Doc", source: "EAC" },
    ],
  },
  {
    category: "Research & Evidence",
    items: [
      { title: "Lancet: Nursing workforce in Sub-Saharan Africa", type: "Article", source: "The Lancet" },
      { title: "BMJ: Clinical competency assessment models", type: "Article", source: "BMJ" },
      { title: "African Journal of Nursing & Midwifery", type: "Journal", source: "AJNM" },
      { title: "WHO AFRO Nursing Strategic Plan 2020–2030", type: "PDF", source: "WHO AFRO" },
    ],
  },
];

export default async function KnowledgeHubPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [{ data: knowledge }, { data: cases }] = await Promise.all([
    admin.from("knowledge_objects")
      .select("id, title, summary, knowledge_type, evidence_level, clinical_practice_units(name)")
      .neq("status", "retired").order("created_at").limit(40),
    admin.from("clinical_cases")
      .select("id, title, difficulty, clinical_practice_units(name)")
      .neq("status", "retired").order("created_at", { ascending: false }).limit(12),
  ]);

  const byType = new Map<string, NonNullable<typeof knowledge>>();
  for (const k of knowledge ?? []) {
    const list = byType.get(k.knowledge_type) ?? [];
    list.push(k);
    byType.set(k.knowledge_type, list);
  }

  const card = "bg-white rounded-xl border border-gray-100";

  return (
    <div className="max-w-5xl">
      <div className="flex items-start gap-3 mb-6">
        <span className="w-12 h-12 rounded-2xl bg-teal-50 flex items-center justify-center text-2xl shrink-0">📚</span>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Knowledge Hub</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Trusted clinical knowledge, case studies and evidence-based references — {((knowledge ?? []).length + (cases ?? []).length)} governed items you can open and read.
          </p>
        </div>
      </div>

      <LibrarySearch />

      {/* Governed knowledge by type */}
      {[...byType.entries()].map(([type, items]) => {
        const t = KNOWLEDGE_TYPE_UI[type] ?? KNOWLEDGE_TYPE_UI.other;
        return (
          <div key={type} className="mb-6">
            <h2 className="font-semibold text-gray-900 text-sm mb-3">{t.icon} {t.label}</h2>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {items.map(k => (
                <Link key={k.id} href={`/dashboard/knowledge/${k.id}`}
                  className={`${card} p-4 hover:border-teal-300 transition-colors group`}>
                  <p className="text-sm font-medium text-gray-800 group-hover:text-teal-700 leading-snug">{k.title}</p>
                  {k.summary && <p className="text-[11px] text-gray-400 mt-1 line-clamp-2">{k.summary}</p>}
                  <div className="flex items-center gap-1.5 mt-2.5">
                    {(k.clinical_practice_units as unknown as { name: string } | null)?.name && (
                      <span className="text-[9px] font-semibold bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded truncate max-w-[140px]">
                        {(k.clinical_practice_units as unknown as { name: string }).name}
                      </span>
                    )}
                    {k.evidence_level && (
                      <span className="text-[9px] font-semibold bg-green-50 text-green-700 px-1.5 py-0.5 rounded">Evidence: {k.evidence_level}</span>
                    )}
                    <span className="ml-auto text-[10px] text-teal-600 font-semibold">Read →</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        );
      })}

      {/* Case studies */}
      {(cases ?? []).length > 0 && (
        <div className="mb-6">
          <h2 className="font-semibold text-gray-900 text-sm mb-3">🧑‍⚕️ Clinical Case Studies</h2>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {(cases ?? []).map(c => (
              <Link key={c.id} href={`/dashboard/knowledge/case/${c.id}`}
                className={`${card} p-4 hover:border-teal-300 transition-colors group`}>
                <p className="text-sm font-medium text-gray-800 group-hover:text-teal-700 leading-snug">{c.title}</p>
                <div className="flex items-center gap-1.5 mt-2.5">
                  {(c.clinical_practice_units as unknown as { name: string } | null)?.name && (
                    <span className="text-[9px] font-semibold bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded truncate max-w-[140px]">
                      {(c.clinical_practice_units as unknown as { name: string }).name}
                    </span>
                  )}
                  {c.difficulty && <span className="text-[9px] font-semibold bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded capitalize">{c.difficulty}</span>}
                  <span className="ml-auto text-[10px] text-teal-600 font-semibold">Work through →</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {(knowledge ?? []).length === 0 && (cases ?? []).length === 0 && (
        <div className={`${card} p-10 text-center mb-6`}>
          <p className="text-3xl mb-2">📚</p>
          <p className="text-sm text-gray-400">Governed knowledge appears here as your organisation publishes it — the CPU importer creates it automatically.</p>
        </div>
      )}

      {/* Curated external directory */}
      <div className="mb-6">
        <h2 className="font-semibold text-gray-900 text-sm mb-1">🌍 External Reference Directory</h2>
        <p className="text-[10px] text-gray-400 mb-3">Curated East-African references — ask your library team for access copies.</p>
        <div className="grid md:grid-cols-3 gap-4">
          {DIRECTORY.map(d => (
            <div key={d.category} className={`${card} p-4`}>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">{d.category}</p>
              <div className="flex flex-col gap-2">
                {d.items.map(i => (
                  <div key={i.title}>
                    <p className="text-[12px] text-gray-700 leading-snug">{i.title}</p>
                    <p className="text-[9px] text-gray-400">{i.source} · {i.type}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-[#0a2e38] rounded-xl px-5 py-4 flex flex-wrap items-center gap-3 text-white">
        <span className="text-xl">🤖</span>
        <div className="flex-1 min-w-[220px]">
          <p className="text-sm font-semibold">Need help finding something?</p>
          <p className="text-[11px] text-teal-200/70">The AI Copilot searches and cites every governed item on this page.</p>
        </div>
        <Link href="/dashboard/copilot"
          className="text-xs font-semibold bg-teal-500 hover:bg-teal-400 text-white px-4 py-2 rounded-lg">
          Ask AI Copilot →
        </Link>
      </div>
    </div>
  );
}
