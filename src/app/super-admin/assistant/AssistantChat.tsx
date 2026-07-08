"use client";
import { useState } from "react";

type Turn = { role: "user" | "assistant"; text: string; meta?: string };

const SUGGESTIONS = [
  "Which competencies are high-risk?",
  "What CPUs exist for oxygen therapy?",
  "Summarise the Core Nursing framework structure",
];

export default function AssistantChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    setTurns(t => [...t, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/ai/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }),
      });
      const d = await res.json();
      if (res.ok) {
        setTurns(t => [...t, { role: "assistant", text: d.answer, meta: `${d.model} · ${d.sources} source${d.sources !== 1 ? "s" : ""} · ${d.usage.output} tokens` }]);
      } else {
        setTurns(t => [...t, { role: "assistant", text: `⚠ ${d.error ?? "Failed"}` }]);
      }
    } catch {
      setTurns(t => [...t, { role: "assistant", text: "⚠ Network error." }]);
    }
    setBusy(false);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="min-h-[280px] max-h-[55vh] overflow-y-auto p-5 flex flex-col gap-4">
        {turns.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 py-8">
            <p className="text-3xl">🤖</p>
            <p className="text-sm text-gray-400">Ask about your competency content. Try:</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => ask(s)} className="text-xs px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-full text-gray-600 hover:bg-gray-100">{s}</button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((t, i) => (
            <div key={i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${t.role === "user" ? "bg-rose-600 text-white" : "bg-gray-50 border border-gray-100 text-gray-800"}`}>
                <p className="text-sm whitespace-pre-wrap">{t.text}</p>
                {t.meta && <p className="text-[10px] text-gray-400 mt-1.5">{t.meta}</p>}
              </div>
            </div>
          ))
        )}
        {busy && <div className="flex justify-start"><div className="bg-gray-50 border border-gray-100 rounded-2xl px-4 py-2.5 text-sm text-gray-400">Thinking…</div></div>}
      </div>

      <form onSubmit={e => { e.preventDefault(); ask(input); }} className="border-t border-gray-100 p-3 flex gap-2">
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask about competencies, CPUs, policies…"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
        <button type="submit" disabled={busy || !input.trim()}
          className="px-4 py-2 bg-rose-600 text-white text-sm font-semibold rounded-lg hover:bg-rose-700 disabled:opacity-50">
          Ask
        </button>
      </form>
      <p className="px-4 pb-3 text-[10px] text-gray-400">
        Answers are grounded in governed content and cited. The assistant navigates the framework — it does not make competency decisions. Every query is audit-logged.
      </p>
    </div>
  );
}
