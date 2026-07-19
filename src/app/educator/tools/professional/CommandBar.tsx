"use client";

import { useState } from "react";

// Professional Tools Command Bar (mockup "Professional Tools Command Bar — Ask
// AI"). Light-themed single-turn natural-language prompt over the real grounded
// /api/ai/assistant endpoint; the answer renders inline above the composer.

const SUGGESTED = ["Create assessment", "Generate questions", "Build scenario", "Find templates", "Import content", "Generate report", "Improve my content"];

export default function CommandBar({ aiConfigured }: { aiConfigured: boolean }) {
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(text?: string) {
    const query = (text ?? input).trim();
    if (!query || busy) return;
    setInput(""); setAsked(query); setAnswer(null); setBusy(true);
    try {
      const res = await fetch("/api/ai/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: query }) });
      const d = await res.json().catch(() => ({}));
      setAnswer(res.ok ? (d.answer ?? "No answer returned.")
        : res.status === 503 ? "The AI assistant isn't configured yet (no API key set). Ask your administrator to enable it — the rest of this centre runs on your live workspace data."
        : res.status === 429 ? "AI rate limit reached for this hour — please try again shortly."
        : (d.error ?? "Something went wrong. Please try again."));
    } catch {
      setAnswer("Network error. Please check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <span>⌨️</span>
        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Professional Tools Command Bar <span className="normal-case font-normal text-gray-400">(Ask AI)</span></p>
        <span className="ml-auto text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border border-gray-200 text-gray-400">{aiConfigured ? "AI ready" : "AI not configured"}</span>
      </div>

      {(asked || answer) && (
        <div className="mb-3 rounded-xl bg-gray-50 border border-gray-200 p-3">
          {asked && <p className="text-[12px] text-violet-700 font-medium mb-1.5 flex gap-2"><span>🧑</span><span>{asked}</span></p>}
          <div className="text-[12px] text-gray-700 leading-relaxed flex gap-2">
            <span className="shrink-0">🤖</span>
            {answer ? <span className="whitespace-pre-wrap">{answer}</span>
              : <span className="flex gap-1 items-center py-1">{[0, 1, 2].map(k => <span key={k} className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: `${k * 0.15}s` }} />)}</span>}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 mb-3">
        {SUGGESTED.map(s => <button key={s} onClick={() => send(s)} disabled={busy} className="text-[11px] text-gray-600 bg-gray-100 hover:bg-gray-200 border border-gray-200 rounded-full px-3 py-1.5 transition-colors disabled:opacity-50">{s}</button>)}
      </div>

      <div className="flex gap-2">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} disabled={busy}
          placeholder="Ask me anything about your content, assessments or tools…"
          className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-violet-400 disabled:opacity-50" />
        <button onClick={() => send()} disabled={!input.trim() || busy} className="bg-violet-600 hover:bg-violet-700 text-white px-4 rounded-xl disabled:opacity-40 transition-colors">{busy ? "…" : "➤"}</button>
      </div>
    </div>
  );
}
