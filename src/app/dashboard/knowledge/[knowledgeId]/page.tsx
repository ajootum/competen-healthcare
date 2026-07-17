import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";

// Knowledge object reader — workers open and read governed knowledge
// (Knowledge Hub Redesign v2 §7: linked to its CPU and the AI Copilot).

const KNOWLEDGE_TYPE_UI: Record<string, { label: string; icon: string }> = {
  anatomy: { label: "Anatomy", icon: "🫀" },
  physiology: { label: "Physiology", icon: "🫁" },
  pathophysiology: { label: "Pathophysiology", icon: "🧬" },
  pharmacology: { label: "Pharmacology", icon: "💊" },
  clinical_reasoning: { label: "Clinical Reasoning", icon: "🧠" },
  other: { label: "Reference", icon: "📘" },
};

export default async function KnowledgeReaderPage({ params }: { params: Promise<{ knowledgeId: string }> }) {
  const { knowledgeId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: k } = await admin.from("knowledge_objects")
    .select("id, code, title, summary, content, knowledge_type, evidence_level, source_ref, review_date, status, cpu_id, clinical_practice_units(id, name)")
    .eq("id", knowledgeId).single();
  if (!k || k.status === "retired") notFound();

  const t = KNOWLEDGE_TYPE_UI[k.knowledge_type] ?? KNOWLEDGE_TYPE_UI.other;
  const cpu = k.clinical_practice_units as unknown as { id: string; name: string } | null;
  const paragraphs = (k.content ?? "").split(/\n{2,}|\r\n\r\n/).map((p: string) => p.trim()).filter(Boolean);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/dashboard/knowledge" className="hover:text-gray-600">Knowledge Hub</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium truncate">{k.title}</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-5">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-[10px] font-bold bg-rose-50 text-rose-700 px-2 py-0.5 rounded">{t.icon} {t.label}</span>
          {k.evidence_level && <span className="text-[10px] font-bold bg-green-50 text-green-700 px-2 py-0.5 rounded">Evidence: {k.evidence_level}</span>}
          {k.code && <span className="text-[10px] font-mono text-gray-400">{k.code}</span>}
        </div>
        <h1 className="text-xl font-bold text-gray-900">{k.title}</h1>
        {k.summary && <p className="text-sm text-gray-500 mt-2 leading-relaxed">{k.summary}</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[10px] text-gray-400">
          {cpu && <span>🏥 <Link href={`/dashboard/cpu/${cpu.id}`} className="text-teal-600 hover:underline">{cpu.name}</Link></span>}
          {k.source_ref && <span>📖 Source: {k.source_ref}</span>}
          {k.review_date && <span suppressHydrationWarning>🔄 Review due {new Date(k.review_date).toLocaleDateString()}</span>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-5">
        {paragraphs.length ? paragraphs.map((p: string, i: number) => (
          <p key={i} className="text-sm text-gray-700 leading-relaxed mb-4 last:mb-0">{p}</p>
        )) : <p className="text-sm text-gray-400">This knowledge object has no body content yet.</p>}
      </div>

      <div className="bg-teal-50 border border-teal-100 rounded-xl px-5 py-4 flex flex-wrap items-center gap-3">
        <span className="text-xl">🤖</span>
        <p className="text-[12px] text-teal-900 flex-1 min-w-[200px]">
          Want this explained differently, or a quick quiz on it? The AI Copilot cites this exact document.
        </p>
        <Link href="/dashboard/copilot"
          className="text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg">
          Ask the Copilot →
        </Link>
      </div>
    </div>
  );
}
