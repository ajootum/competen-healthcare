"use client";

import { useState } from "react";
import Link from "next/link";

type Q = { id: string; content: string; options: string[] };
type ResultDetail = { question_id: string; content: string; chosen: string | null; correct_answer: string; correct: boolean; explanation: string | null };
type Result = { score: number; passed: boolean; pass_mark: number; total: number; correct: number; detail: ResultDetail[] };

export default function TakeTest({ bankId, questions, passMark }: { bankId: string; questions: Q[]; passMark: number }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const answered = Object.keys(answers).length;

  async function submit() {
    setBusy(true); setError(null);
    const res = await fetch("/api/knowledge", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bank_id: bankId, answers }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Submission failed"); return; }
    setResult(await res.json());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (result) {
    return (
      <div>
        <div className={`rounded-xl p-6 mb-6 text-center ${result.passed ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
          <p className="text-4xl mb-1">{result.passed ? "🎉" : "📚"}</p>
          <p className={`text-2xl font-bold ${result.passed ? "text-green-700" : "text-red-600"}`}>{result.score}%</p>
          <p className="text-sm text-gray-600 mt-1">
            {result.correct}/{result.total} correct · pass mark {result.pass_mark}% — {result.passed ? "Passed" : "Not yet passed"}
          </p>
          {!result.passed && <p className="text-xs text-gray-500 mt-2">Review the explanations below, then retake the test when ready.</p>}
        </div>
        <div className="flex flex-col gap-3 mb-6">
          {result.detail.map((d, i) => (
            <div key={d.question_id} className={`bg-white rounded-xl border p-4 ${d.correct ? "border-green-100" : "border-red-100"}`}>
              <p className="text-sm text-gray-800"><b>{i + 1}.</b> {d.content}</p>
              <p className={`text-xs mt-1.5 ${d.correct ? "text-green-700" : "text-red-600"}`}>
                {d.correct ? "✓" : "✗"} Your answer: {d.chosen ?? "—"}
              </p>
              {!d.correct && <p className="text-xs text-green-700 mt-0.5">Correct: {d.correct_answer}</p>}
              {d.explanation && <p className="text-[11px] text-gray-500 italic mt-1.5">{d.explanation}</p>}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setResult(null); setAnswers({}); }}
            className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
            Retake test
          </button>
          <Link href="/dashboard/assessments" className="text-sm text-gray-500 hover:bg-gray-100 px-4 py-2 rounded-lg transition-colors">
            Back to assessments
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-2.5 mb-4">{error}</div>}
      <div className="flex flex-col gap-4 mb-6">
        {questions.map((q, i) => (
          <div key={q.id} className="bg-white rounded-xl border border-gray-100 p-5">
            <p className="text-sm font-medium text-gray-800 mb-3"><b>{i + 1}.</b> {q.content}</p>
            <div className="flex flex-col gap-1.5">
              {q.options.map(o => (
                <label key={o} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors text-sm ${
                  answers[q.id] === o ? "border-teal-400 bg-teal-50 text-teal-900" : "border-gray-100 hover:bg-gray-50 text-gray-700"}`}>
                  <input type="radio" name={q.id} checked={answers[q.id] === o}
                    onChange={() => setAnswers(a => ({ ...a, [q.id]: o }))} />
                  {o}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="sticky bottom-4 bg-white rounded-xl border border-gray-200 shadow-lg px-5 py-3 flex items-center gap-3">
        <p className="text-sm text-gray-600 flex-1">{answered}/{questions.length} answered · pass mark {passMark}%</p>
        <button disabled={busy || answered < questions.length} onClick={submit}
          className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors disabled:opacity-50">
          {busy ? "Grading…" : "Submit test"}
        </button>
      </div>
    </div>
  );
}
