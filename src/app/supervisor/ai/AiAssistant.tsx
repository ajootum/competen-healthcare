"use client";

import { useState } from "react";

// AI Assistant (SSW-AI-001 §7) — natural-language chat grounded on the live shift
// snapshot via /api/operations/copilot. Suggested questions seed common queries;
// if AI isn't configured the panel says so honestly (503) rather than faking a reply.

const SUGGESTIONS = [
  "Which patients need review first?",
  "Why is workload high this shift?",
  "Show me staffing gaps for the shift",
  "Summarise today's safety picture",
  "What redeployments do you recommend?",
];

export default function AiAssistant() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function ask(question: string) {
    if (!question.trim()) return;
    setBusy(true); setErr(null); setAnswer(null);
    try {
      const res = await fetch("/api/operations/copilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? "Copilot unavailable"); return; }
      setAnswer(j.answer ?? "");
    } catch { setErr("Network error"); } finally { setBusy(false); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-3"><span className="w-6 h-6 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center text-[11px] font-bold">6</span><h3 className="text-xs font-bold text-gray-900">AI Assistant</h3></div>
      <div className="flex gap-2 mb-2">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && ask(q)} placeholder="Ask me anything about your shift…" className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
        <button onClick={() => ask(q)} disabled={!q.trim() || busy} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">{busy ? "…" : "Ask"}</button>
      </div>
      {answer && <div className="rounded-lg bg-teal-50/50 border border-teal-100 p-2.5 mb-2 text-[11px] text-gray-700 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">{answer}</div>}
      {err && <div className="rounded-lg bg-amber-50 border border-amber-100 p-2 mb-2 text-[11px] text-amber-700">{err}</div>}
      <div className="space-y-1">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => { setQ(s); ask(s); }} disabled={busy} className="w-full flex items-center gap-2 text-left rounded-lg border border-gray-100 hover:border-teal-300 hover:bg-teal-50/40 px-2.5 py-1.5 text-[11px] text-gray-700 disabled:opacity-50"><span className="text-gray-400">›</span>{s}</button>
        ))}
      </div>
    </div>
  );
}
