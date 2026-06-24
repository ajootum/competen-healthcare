"use client";
import { useState } from "react";

type Question = {
  id: string;
  content: string;
  options: string[];
  correct_answer: string;
  explanation: string | null;
  category: string;
  difficulty: string;
};

const difficultyColors: Record<string, string> = {
  easy:   "bg-green-100 text-green-700",
  medium: "bg-amber-100 text-amber-700",
  hard:   "bg-red-100 text-red-600",
};

export default function QuizClient({ questions }: { questions: Question[] }) {
  const [filter, setFilter] = useState("All");
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [quizStarted, setQuizStarted] = useState(false);
  const [quizDone, setQuizDone] = useState(false);

  const categories = ["All", ...Array.from(new Set(questions.map(q => q.category)))];
  const filtered = filter === "All" ? questions : questions.filter(q => q.category === filter);
  const q = filtered[current];

  function startQuiz() {
    setCurrent(0);
    setSelected(null);
    setScore(0);
    setAnswered(0);
    setQuizStarted(true);
    setQuizDone(false);
  }

  function handleSelect(option: string) {
    if (selected) return;
    setSelected(option);
    const correct = option === q.correct_answer;
    if (correct) setScore(s => s + 1);
    setAnswered(a => a + 1);
    fetch("/api/quiz/attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_id: q.id, selected_answer: option, is_correct: correct }),
    });
  }

  function next() {
    if (current + 1 >= filtered.length) {
      setQuizDone(true);
    } else {
      setCurrent(c => c + 1);
      setSelected(null);
    }
  }

  if (questions.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-12 text-center text-gray-400">
        <p className="text-4xl mb-3">❓</p>
        <p className="font-medium text-gray-600">No questions yet</p>
        <p className="text-sm mt-1">Run <code className="bg-gray-100 px-1 rounded text-xs">supabase/seed-questions.sql</code> to populate the question bank.</p>
      </div>
    );
  }

  if (!quizStarted) {
    return (
      <div>
        <div className="flex gap-2 flex-wrap mb-6">
          {categories.map(cat => (
            <button key={cat} onClick={() => setFilter(cat)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === cat ? "bg-teal-600 text-white" : "bg-white text-gray-600 border border-gray-200 hover:border-teal-300"
              }`}>
              {cat} ({cat === "All" ? questions.length : questions.filter(q => q.category === cat).length})
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
          {filtered.slice(0, 6).map(q => (
            <div key={q.id} className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400">{q.category}</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded capitalize ${difficultyColors[q.difficulty] ?? "bg-gray-100 text-gray-500"}`}>{q.difficulty}</span>
              </div>
              <p className="text-sm text-gray-700 line-clamp-2">{q.content}</p>
            </div>
          ))}
        </div>
        <div className="bg-teal-50 rounded-xl p-6 flex items-center justify-between">
          <div>
            <p className="font-semibold text-teal-900">{filtered.length} questions ready</p>
            <p className="text-sm text-teal-600 mt-0.5">Test your clinical knowledge</p>
          </div>
          <button onClick={startQuiz}
            className="bg-teal-600 text-white px-6 py-2.5 rounded-lg font-medium text-sm hover:bg-teal-700 transition-colors">
            Start Quiz →
          </button>
        </div>
      </div>
    );
  }

  if (quizDone) {
    const pct = Math.round((score / filtered.length) * 100);
    return (
      <div className="max-w-lg mx-auto text-center py-12">
        <div className={`w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold mx-auto mb-6 ${
          pct >= 70 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
        }`}>
          {pct}%
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">
          {pct >= 70 ? "Well done! 🎉" : "Keep practicing 💪"}
        </h2>
        <p className="text-gray-500 mb-6">You got {score} out of {filtered.length} questions correct.</p>
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-2xl font-bold text-green-600">{score}</p>
            <p className="text-xs text-gray-400">Correct</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-2xl font-bold text-red-500">{filtered.length - score}</p>
            <p className="text-xs text-gray-400">Incorrect</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-2xl font-bold text-teal-600">{pct}%</p>
            <p className="text-xs text-gray-400">Score</p>
          </div>
        </div>
        <div className="flex gap-3 justify-center">
          <button onClick={startQuiz}
            className="bg-teal-600 text-white px-6 py-2.5 rounded-lg font-medium text-sm hover:bg-teal-700 transition-colors">
            Retry Quiz
          </button>
          <button onClick={() => { setQuizStarted(false); setQuizDone(false); }}
            className="bg-white border border-gray-200 text-gray-700 px-6 py-2.5 rounded-lg font-medium text-sm hover:border-teal-300 transition-colors">
            Change Category
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-gray-500">Question {current + 1} of {filtered.length}</span>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded capitalize ${difficultyColors[q.difficulty] ?? ""}`}>{q.difficulty}</span>
          <span className="text-sm font-medium text-teal-600">Score: {score}/{answered}</span>
        </div>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full mb-6 overflow-hidden">
        <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${((current) / filtered.length) * 100}%` }} />
      </div>

      {/* Question */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-4">
        <p className="text-xs text-gray-400 mb-3">{q.category}</p>
        <p className="text-gray-900 font-medium text-base leading-relaxed">{q.content}</p>
      </div>

      {/* Options */}
      <div className="flex flex-col gap-3 mb-6">
        {q.options.map(option => {
          let cls = "bg-white border border-gray-200 text-gray-700 hover:border-teal-300";
          if (selected) {
            if (option === q.correct_answer) cls = "bg-green-50 border-green-400 text-green-800";
            else if (option === selected) cls = "bg-red-50 border-red-300 text-red-700";
            else cls = "bg-white border border-gray-100 text-gray-400";
          }
          return (
            <button key={option} onClick={() => handleSelect(option)}
              className={`text-left px-4 py-3 rounded-xl border text-sm font-medium transition-all ${cls} ${selected ? "" : "cursor-pointer"}`}>
              {option}
            </button>
          );
        })}
      </div>

      {/* Explanation */}
      {selected && q.explanation && (
        <div className={`rounded-xl p-4 mb-4 text-sm ${selected === q.correct_answer ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>
          <p className="font-semibold mb-1">{selected === q.correct_answer ? "✓ Correct!" : "✗ Incorrect"}</p>
          <p>{q.explanation}</p>
        </div>
      )}

      {selected && (
        <button onClick={next}
          className="w-full bg-teal-600 text-white py-3 rounded-xl font-medium text-sm hover:bg-teal-700 transition-colors">
          {current + 1 >= filtered.length ? "See Results" : "Next Question →"}
        </button>
      )}
    </div>
  );
}
