import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function QuestionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: questions } = await supabase
    .from("questions")
    .select("id, topic, question_text, difficulty, created_at")
    .order("created_at", { ascending: false });

  const difficultyColors: Record<string, string> = {
    easy:   "bg-green-100 text-green-700",
    medium: "bg-amber-100 text-amber-700",
    hard:   "bg-red-100 text-red-700",
  };

  const topics = [...new Set((questions ?? []).map(q => q.topic ?? "Uncategorized"))].sort();

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Question Bank</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {questions?.length ?? 0} questions · {topics.length} topics
          </p>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 text-xs text-purple-700">
          Question editor coming soon
        </div>
      </div>

      {/* Topic overview */}
      {topics.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {topics.map(t => {
            const count = (questions ?? []).filter(q => (q.topic ?? "Uncategorized") === t).length;
            return (
              <span key={t} className="text-xs bg-white border border-gray-200 rounded-full px-3 py-1 text-gray-700">
                {t} <span className="font-bold text-purple-600">{count}</span>
              </span>
            );
          })}
        </div>
      )}

      {!questions?.length ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-3xl mb-3">❓</p>
          <p className="text-gray-500 text-sm font-medium">No questions yet</p>
          <p className="text-gray-400 text-xs mt-1">Questions are added via the quiz API or Supabase dashboard.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Question</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Topic</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Difficulty</th>
                <th className="text-right px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {questions.map(q => (
                <tr key={q.id} className="hover:bg-gray-50/40">
                  <td className="px-5 py-3.5 max-w-md">
                    <p className="text-gray-900 line-clamp-2">{q.question_text}</p>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-gray-500">{q.topic ?? "Uncategorized"}</td>
                  <td className="px-4 py-3.5 text-center">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded capitalize ${difficultyColors[q.difficulty] ?? "bg-gray-100 text-gray-600"}`}>
                      {q.difficulty}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right text-xs text-gray-400">
                    {new Date(q.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
