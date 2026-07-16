import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import TakeTest from "./TakeTest";

// Take a governed knowledge assessment. Questions are served WITHOUT the
// correct answers — grading happens server-side on submission.

export default async function KnowledgeTestPage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [{ data: bank }, { data: questions }, { data: attempts }] = await Promise.all([
    admin.from("question_banks")
      .select("id, name, description, pass_mark, validity_months, time_limit_minutes, clinical_practice_units(name)")
      .eq("id", bankId).eq("is_active", true).single(),
    admin.from("questions").select("id, content, options").eq("bank_id", bankId).order("created_at"),
    admin.from("knowledge_attempts").select("score, passed, completed_at")
      .eq("bank_id", bankId).eq("nurse_id", user.id).order("completed_at", { ascending: false }).limit(5),
  ]);
  if (!bank) notFound();

  const safeQuestions = (questions ?? []).map(q => ({
    id: q.id, content: q.content,
    options: (Array.isArray(q.options) ? q.options : []) as string[],
  }));
  const cpu = (bank.clinical_practice_units as unknown as { name: string } | null)?.name ?? null;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/dashboard/assessments" className="hover:text-gray-600">Assessments</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Knowledge Test</span>
      </div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">{bank.name}</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          {cpu ? `${cpu} · ` : ""}{safeQuestions.length} questions · pass mark {bank.pass_mark}% · result valid {bank.validity_months} months
        </p>
      </div>

      {(attempts ?? []).length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 px-5 py-3 mb-5 flex flex-wrap gap-3">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest self-center">Previous attempts</span>
          {(attempts ?? []).map((a, i) => (
            <span key={i} className={`text-[11px] font-bold px-2 py-0.5 rounded ${a.passed ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {a.score}% {a.passed ? "✓" : "✗"} · {new Date(a.completed_at).toLocaleDateString()}
            </span>
          ))}
        </div>
      )}

      {safeQuestions.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center text-sm text-gray-400">
          This test has no questions yet.
        </div>
      ) : (
        <TakeTest bankId={bank.id} questions={safeQuestions} passMark={bank.pass_mark} />
      )}
    </div>
  );
}
