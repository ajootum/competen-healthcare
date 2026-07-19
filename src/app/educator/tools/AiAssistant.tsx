"use client";

import { useState } from "react";

// Right-rail AI Assistant (Tools & Settings mockup). Compact, light-themed mini-
// copilot: suggested actions run the real grounded /api/ai/assistant and show the
// answer inline; a free-text box does the same. Same endpoint as the Copilot.

const ACTIONS = [
  ["🧠", "Generate assessment questions"],
  ["📝", "Create a lesson plan"],
  ["🧪", "Build a simulation scenario"],
  ["📄", "Summarise this document"],
  ["📚", "Recommend teaching resources"],
];

export default function AiAssistant({ name, aiConfigured }: { name: string; aiConfigured: boolean }) {
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(text?: string) {
    const query = (text ?? input).trim();
    if (!query || busy) return;
    setInput(""); setAnswer(null); setBusy(true);
    try {
      const res = await fetch("/api/ai/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: query }) });
      const d = await res.json().catch(() => ({}));
      setAnswer(res.ok ? (d.answer ?? "No answer returned.")
        : res.status === 503 ? "AI isn't configured yet — ask your administrator to enable it."
        : res.status === 429 ? "Rate limit reached — try again shortly."
        : (d.error ?? "Something went wrong."));
    } catch { setAnswer("Network error — please try again."); }
    setBusy(false);
  }

  return (
    <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
      <div className="flex items-center gap-1.5 mb-2"><span>✨</span><p className="text-[13px] font-bold text-gray-800">AI Assistant</p><span className="text-[8px] font-bold uppercase tracking-wide text-violet-600 bg-violet-100 rounded px-1.5 py-0.5 ml-1">Beta</span></div>
      <p className="text-[12px] text-gray-700">Hello {name}! 👋</p>
      <p className="text-[11px] text-gray-500 mb-3">How can I help you today?</p>

      {(busy || answer) && (
        <div className="mb-3 rounded-xl bg-gray-50 border border-gray-200 p-2.5 text-[11px] text-gray-700 leading-relaxed">
          {answer ? <span className="whitespace-pre-wrap">{answer}</span>
            : <span className="flex gap-1 items-center py-0.5">{[0, 1, 2].map(k => <span key={k} className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: `${k * 0.15}s` }} />)}</span>}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {ACTIONS.map(([ic, label]) => (
          <button key={label} onClick={() => send(label)} disabled={busy} className="flex items-center gap-2 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 px-2.5 py-2 text-left transition-colors disabled:opacity-50">
            <span className="text-sm">{ic}</span><span className="text-[11px] text-gray-700 leading-tight">{label}</span>
          </button>
        ))}
      </div>

      <div className="flex gap-1.5 mt-3">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} disabled={busy}
          placeholder="Ask AI anything…" className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[12px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-violet-400 disabled:opacity-50" />
        <button onClick={() => send()} disabled={!input.trim() || busy} className="bg-violet-600 hover:bg-violet-700 text-white px-3 rounded-lg disabled:opacity-40 text-sm transition-colors">➤</button>
      </div>
      {!aiConfigured && <p className="text-[9px] text-gray-400 mt-2">AI isn&apos;t configured yet — enable it to use the assistant.</p>}
    </div>
  );
}
