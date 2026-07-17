import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import QuizClient from "./QuizClient";

// Knowledge Assessment Centre (Knowledge Assessment Centre spec v1).
// Practice questions, governed knowledge tests, per-domain mastery and weak
// areas — all computed from real attempts. No streaks, benchmarks, Bloom's
// distributions or adaptive engines — those need stores/models that don't
// exist yet; the AI actions link to the real grounded Copilot.

const CATEGORY_ICON: Record<string, string> = {
  Emergency: "🚨", Safety: "🛡️", Pharmacology: "💊", Pediatrics: "👶",
  Clinical: "🩺", "Critical Care": "❤️", knowledge_assessment: "📘",
};

export default async function KnowledgeAssessmentPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [{ data: questions }, { data: attempts }, { data: banks }, { data: kAttempts }] = await Promise.all([
    admin.from("questions")
      .select("id, content, options, correct_answer, explanation, category, difficulty")
      .eq("is_published", true).is("bank_id", null),
    admin.from("quiz_attempts").select("question_id, is_correct, attempted_at").eq("user_id", user.id),
    admin.from("question_banks")
      .select("id, name, pass_mark, questions(id), clinical_practice_units(name)")
      .eq("is_active", true).order("name"),
    admin.from("knowledge_attempts").select("bank_id, score, passed, completed_at")
      .eq("nurse_id", user.id).order("completed_at", { ascending: false }),
  ]);

  const allAttempts = attempts ?? [];
  const correct = allAttempts.filter(a => a.is_correct).length;
  const practiceAccuracy = allAttempts.length ? Math.round((correct / allAttempts.length) * 100) : null;

  // Per-category mastery from real attempts
  const catOf = new Map((questions ?? []).map(q => [q.id, q.category]));
  const catStats = new Map<string, { n: number; ok: number }>();
  for (const a of allAttempts) {
    const cat = catOf.get(a.question_id);
    if (!cat) continue;
    const v = catStats.get(cat) ?? { n: 0, ok: 0 };
    v.n++; if (a.is_correct) v.ok++;
    catStats.set(cat, v);
  }
  const mastery = [...catStats.entries()]
    .map(([cat, v]) => ({ cat, pct: Math.round((v.ok / v.n) * 100), n: v.n }))
    .sort((a, b) => a.pct - b.pct);
  const weak = mastery.filter(m => m.pct < 70);

  // Governed tests + best attempts
  const bestByBank = new Map<string, { score: number; passed: boolean }>();
  for (const a of kAttempts ?? []) {
    const b = bestByBank.get(a.bank_id);
    if (!b || Number(a.score) > b.score) bestByBank.set(a.bank_id, { score: Number(a.score), passed: a.passed });
  }
  const bankRows = ((banks ?? []) as unknown as {
    id: string; name: string; pass_mark: number; questions: { id: string }[];
    clinical_practice_units: { name: string } | null;
  }[]);
  const quizAvg = (kAttempts ?? []).length
    ? Math.round((kAttempts ?? []).reduce((s, a) => s + Number(a.score), 0) / (kAttempts ?? []).length) : null;

  // Knowledge score: blend of practice accuracy and governed test average
  const scores = [practiceAccuracy, quizAvg].filter((v): v is number => v !== null);
  const knowledgeScore = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null;

  const categories = [...new Set((questions ?? []).map(q => q.category))];
  const parsed = (questions ?? []).map(q => ({
    ...q,
    options: Array.isArray(q.options) ? q.options : (typeof q.options === "string" ? JSON.parse(q.options) : []),
  }));

  const card = "bg-white rounded-xl border border-gray-100";

  const KPI = [
    { label: "Knowledge Score", value: knowledgeScore !== null ? `${knowledgeScore}%` : "—", sub: "practice + governed tests", color: "text-gray-900" },
    { label: "Questions Answered", value: allAttempts.length, sub: "practice attempts", color: "text-blue-600" },
    { label: "Accuracy", value: practiceAccuracy !== null ? `${practiceAccuracy}%` : "—", sub: `${correct} correct`, color: practiceAccuracy !== null && practiceAccuracy >= 70 ? "text-green-600" : "text-amber-600" },
    { label: "Weak Areas", value: weak.length, sub: weak.length ? weak.map(w => w.cat).slice(0, 2).join(", ") : "none identified", color: weak.length ? "text-red-500" : "text-gray-400" },
    { label: "Governed Tests", value: bankRows.length, sub: `${[...bestByBank.values()].filter(b => b.passed).length} passed`, color: "text-violet-600" },
  ];

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Knowledge Assessment Centre</h1>
          <p className="text-teal-700 text-xs font-semibold mt-0.5">Assess · Learn · Improve · Maintain Competence</p>
        </div>
        <Link href="/dashboard/copilot"
          className="text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-lg">
          ✨ AI Practice — ask for a quiz
        </Link>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
        {KPI.map(k => (
          <div key={k.label} className={`${card} p-4`}>
            <p className="text-[10px] text-gray-400 font-medium mb-1">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-[9px] text-gray-400 mt-0.5 truncate">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-5 mb-5">
        {/* Mastery by category */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-1">Mastery by Domain</h2>
          <p className="text-[10px] text-gray-400 mb-3">Your accuracy per category, from real attempts.</p>
          {mastery.length ? (
            <div className="flex flex-col gap-2">
              {mastery.map(m => (
                <div key={m.cat} className="flex items-center gap-2.5">
                  <span className="text-sm w-5">{CATEGORY_ICON[m.cat] ?? "📘"}</span>
                  <span className="text-[11px] text-gray-700 w-32 truncate">{m.cat}</span>
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${m.pct >= 70 ? "bg-green-500" : m.pct >= 50 ? "bg-amber-500" : "bg-red-400"}`}
                      style={{ width: `${Math.max(m.pct, 2)}%` }} />
                  </div>
                  <span className="text-[10px] font-bold text-gray-600 w-16 text-right">{m.pct}% · {m.n}q</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400 text-center py-6">Answer practice questions to build your mastery profile. 🎯</p>}
        </div>

        {/* Governed knowledge tests */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-1">Governed Knowledge Tests</h2>
          <p className="text-[10px] text-gray-400 mb-3">Formal tests — passing feeds your competency record.</p>
          {bankRows.length ? (
            <div className="flex flex-col gap-2">
              {bankRows.map(b => {
                const best = bestByBank.get(b.id);
                return (
                  <div key={b.id} className="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-gray-800 truncate">{b.name}</p>
                      <p className="text-[9px] text-gray-400">
                        {b.clinical_practice_units?.name ? `${b.clinical_practice_units.name} · ` : ""}
                        {b.questions.length} questions · pass {b.pass_mark}%
                      </p>
                    </div>
                    {best && (
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${best.passed ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                        {best.passed ? `Passed ${best.score}%` : `Best ${best.score}%`}
                      </span>
                    )}
                    <Link href={`/dashboard/tests/${b.id}`}
                      className="text-[11px] font-semibold bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-lg shrink-0">
                      {best?.passed ? "Retake" : best ? "Try again" : "Start"}
                    </Link>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-xs text-gray-400 text-center py-6">Governed tests appear when your organisation publishes them. 📋</p>}
        </div>
      </div>

      {/* Browse by domain */}
      <div className={`${card} p-5 mb-5`}>
        <h2 className="font-semibold text-gray-900 text-sm mb-3">Browse by Domain</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
          {categories.map(cat => {
            const n = (questions ?? []).filter(q => q.category === cat).length;
            const m = mastery.find(x => x.cat === cat);
            return (
              <div key={cat} className="border border-gray-100 rounded-xl p-3 text-center">
                <p className="text-xl">{CATEGORY_ICON[cat] ?? "📘"}</p>
                <p className="text-[11px] font-semibold text-gray-700 mt-1 truncate">{cat}</p>
                <p className="text-[9px] text-gray-400">{n} question{n === 1 ? "" : "s"}{m ? ` · ${m.pct}% mastered` : ""}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Practice runner (existing working client) */}
      <h2 className="font-semibold text-gray-900 text-sm mb-3">Practice Questions</h2>
      <QuizClient questions={parsed} />

      <div className="mt-5 bg-[#0a2e38] rounded-xl px-5 py-4 flex flex-wrap items-center gap-3 text-white">
        <span className="text-xl">🤖</span>
        <div className="flex-1 min-w-[220px]">
          <p className="text-sm font-semibold">Want an explanation, a custom quiz, or a case scenario?</p>
          <p className="text-[11px] text-teal-200/70">The AI Copilot generates practice grounded in your organisation&apos;s governed content.</p>
        </div>
        <Link href="/dashboard/copilot"
          className="text-xs font-semibold bg-teal-500 hover:bg-teal-400 text-white px-4 py-2 rounded-lg">
          Open AI Copilot →
        </Link>
      </div>
    </div>
  );
}
