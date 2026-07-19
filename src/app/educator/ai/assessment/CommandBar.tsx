"use client";

import { useState } from "react";

// Assessment Command Bar (Assessment Intelligence spec §17). Single-turn natural-
// language prompt over the real grounded /api/ai/assistant endpoint — the same
// educator-gated, cited, audit-logged AI that powers the Copilot. The answer
// renders inline above the composer. Attach/template chips are shown muted
// ("soon") because object attachment needs a picker + store — no dead controls.

const SUGGESTED = [
  "Analyse this assessment",
  "Check blueprint alignment",
  "Find weak items",
  "Detect missing competencies",
  "Analyse fairness",
  "Predict assessment risk",
  "Generate questions",
];
const ATTACH = ["📎 Attach File", "🧩 Select Object", "📐 Add Standard", "📄 Use Template"];

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
        : res.status === 503 ? "The AI assistant isn't configured yet (no API key set). Ask your administrator to enable it — the rest of this workspace runs on your live assessment data."
        : res.status === 429 ? "AI rate limit reached for this hour — please try again shortly."
        : (d.error ?? "Something went wrong. Please try again."));
    } catch {
      setAnswer("Network error. Please check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <span>⌨️</span>
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-300">Assessment Command Bar</p>
        <span className="ml-auto text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border border-white/10 text-slate-400">
          {aiConfigured ? "AI ready" : "AI not configured"}
        </span>
      </div>

      {(asked || answer) && (
        <div className="mb-3 rounded-xl bg-white/[0.04] border border-white/10 p-3">
          {asked && <p className="text-[12px] text-violet-200 font-medium mb-1.5 flex gap-2"><span>🧑</span><span>{asked}</span></p>}
          <div className="text-[12px] text-slate-200 leading-relaxed flex gap-2">
            <span className="shrink-0">🤖</span>
            {answer ? <span className="whitespace-pre-wrap">{answer}</span>
              : <span className="flex gap-1 items-center py-1">{[0, 1, 2].map(k => <span key={k} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: `${k * 0.15}s` }} />)}</span>}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} disabled={busy}
          placeholder="Ask Copilot to analyse, improve or generate assessment content…"
          className="flex-1 bg-white/[0.05] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-500/50 disabled:opacity-50" />
        <button onClick={() => send()} disabled={!input.trim() || busy} className="bg-violet-600 hover:bg-violet-700 text-white px-4 rounded-xl disabled:opacity-40 transition-colors">{busy ? "…" : "➤"}</button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
        {ATTACH.map(l => <span key={l} title="Coming soon — needs an object picker" className="text-[10px] text-slate-500 bg-white/[0.03] border border-white/10 rounded-lg px-2 py-1 select-none">{l}</span>)}
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3">
        {SUGGESTED.map(s => <button key={s} onClick={() => send(s)} disabled={busy} className="text-[11px] text-violet-200 bg-violet-500/10 border border-violet-500/20 rounded-full px-3 py-1.5 hover:bg-violet-500/20 transition-colors disabled:opacity-50">{s}</button>)}
      </div>
    </div>
  );
}
