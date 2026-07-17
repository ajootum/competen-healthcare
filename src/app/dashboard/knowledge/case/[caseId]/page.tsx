import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";

// Clinical case study reader — worked scenario with think-first reveal:
// scenario and findings are open; the expert discussion and learning points
// sit behind native <details> reveals so learners commit to their own answers
// first (Knowledge Hub Redesign v2, case-based learning).

export default async function CaseReaderPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: c } = await admin.from("clinical_cases")
    .select("id, code, title, scenario, findings, questions, discussion, learning_points, difficulty, status, source_ref, cpu_id, clinical_practice_units(id, name)")
    .eq("id", caseId).single();
  if (!c || c.status === "retired") notFound();

  const cpu = c.clinical_practice_units as unknown as { id: string; name: string } | null;
  const questions = (c.questions ?? []) as string[];
  const learningPoints = (c.learning_points ?? []) as string[];

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/dashboard/knowledge" className="hover:text-gray-600">Knowledge Hub</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium truncate">{c.title}</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-5">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-[10px] font-bold bg-sky-50 text-sky-700 px-2 py-0.5 rounded">🧑‍⚕️ Clinical Case Study</span>
          {c.difficulty && <span className="text-[10px] font-bold bg-violet-50 text-violet-600 px-2 py-0.5 rounded capitalize">{c.difficulty}</span>}
          {c.code && <span className="text-[10px] font-mono text-gray-400">{c.code}</span>}
        </div>
        <h1 className="text-xl font-bold text-gray-900">{c.title}</h1>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[10px] text-gray-400">
          {cpu && <span>🏥 <Link href={`/dashboard/cpu/${cpu.id}`} className="text-teal-600 hover:underline">{cpu.name}</Link></span>}
          {c.source_ref && <span>📖 Source: {c.source_ref}</span>}
        </div>
      </div>

      {c.scenario && (
        <div className="bg-white rounded-xl border border-gray-100 p-6 mb-4">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Clinical Scenario</h2>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{c.scenario}</p>
        </div>
      )}

      {c.findings && (
        <div className="bg-white rounded-xl border border-gray-100 p-6 mb-4">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Assessment Findings</h2>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{c.findings}</p>
        </div>
      )}

      {questions.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-6 mb-4">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Questions — think before you reveal</h2>
          <ol className="flex flex-col gap-2 list-decimal list-inside">
            {questions.map((q, i) => (
              <li key={i} className="text-sm text-gray-700 leading-relaxed">{q}</li>
            ))}
          </ol>
        </div>
      )}

      {c.discussion && (
        <details className="bg-white rounded-xl border border-amber-100 mb-4 group">
          <summary className="px-6 py-4 cursor-pointer text-sm font-semibold text-amber-800 select-none">
            💡 Reveal expert discussion
          </summary>
          <div className="px-6 pb-5">
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{c.discussion}</p>
          </div>
        </details>
      )}

      {learningPoints.length > 0 && (
        <details className="bg-white rounded-xl border border-green-100 mb-5">
          <summary className="px-6 py-4 cursor-pointer text-sm font-semibold text-green-800 select-none">
            ✅ Reveal key learning points
          </summary>
          <div className="px-6 pb-5">
            <ul className="flex flex-col gap-2">
              {learningPoints.map((p, i) => (
                <li key={i} className="text-sm text-gray-700 leading-relaxed flex gap-2"><span className="text-green-500">•</span>{p}</li>
              ))}
            </ul>
          </div>
        </details>
      )}

      <div className="bg-teal-50 border border-teal-100 rounded-xl px-5 py-4 flex flex-wrap items-center gap-3">
        <span className="text-xl">🤖</span>
        <p className="text-[12px] text-teal-900 flex-1 min-w-[200px]">
          Talk this case through with the AI Copilot — it can play the scenario with you and cite the source material.
        </p>
        <Link href="/dashboard/copilot"
          className="text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg">
          Discuss with the Copilot →
        </Link>
      </div>
    </div>
  );
}
