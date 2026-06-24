import { createClient } from "@/lib/supabase/server";
import QuizClient from "./QuizClient";

export default async function QuestionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: questions }, { data: attempts }] = await Promise.all([
    supabase.from("questions").select("id, content, options, correct_answer, explanation, category, difficulty").eq("is_published", true),
    supabase.from("quiz_attempts").select("is_correct").eq("user_id", user!.id),
  ]);

  const totalAttempts = attempts?.length ?? 0;
  const correct = attempts?.filter(a => a.is_correct).length ?? 0;
  const accuracy = totalAttempts > 0 ? Math.round((correct / totalAttempts) * 100) : 0;

  const parsed = (questions ?? []).map(q => ({
    ...q,
    options: Array.isArray(q.options) ? q.options : (typeof q.options === "string" ? JSON.parse(q.options) : []),
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Question Bank</h1>
        <p className="text-gray-400 text-sm mt-0.5">Clinical MCQs aligned with East African nursing competency frameworks.</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: "Questions Available", value: questions?.length ?? 0, color: "text-teal-600" },
          { label: "Attempts Made",       value: totalAttempts,           color: "text-blue-600" },
          { label: "Accuracy",            value: `${accuracy}%`,          color: accuracy >= 70 ? "text-green-600" : "text-amber-500" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl p-4 border border-gray-100 text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <QuizClient questions={parsed} />
    </div>
  );
}
