"use client";

import { useState } from "react";

// Grounded ask canvas — one-shot question to the real CKCM-grounded assistant
// (POST /api/ai/assistant). Renders the live answer with model + source count in
// place. Prompt chips let each AIP module suggest domain questions. Degrades
// honestly when AI isn't configured (503) or the hourly quota is hit (429).
/* eslint-disable @typescript-eslint/no-explicit-any */

export default function AskPanel({ title, placeholder, prompts }: { title: string; placeholder: string; prompts: string[] }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ text: string; model?: string; sources?: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true); setErr(null); setAnswer(null);
    const r = await fetch("/api/ai/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) setAnswer({ text: j.answer, model: j.model, sources: j.sources });
    else setErr(j.error ?? "Request failed");
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="font-semibold text-gray-900 text-[15px] mb-3">{title}</h2>
      <div className="flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") ask(q); }} placeholder={placeholder}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40" />
        <button onClick={() => ask(q)} disabled={busy || !q.trim()} className="text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-4 py-2 disabled:opacity-60 shrink-0">{busy ? "Thinking…" : "Ask"}</button>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {prompts.map(p => (
          <button key={p} onClick={() => { setQ(p); ask(p); }} disabled={busy} className="text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 hover:border-teal-300 hover:bg-teal-50/40 transition-colors disabled:opacity-50">{p}</button>
        ))}
      </div>
      {err && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-3">{err}</p>}
      {answer && (
        <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{answer.text}</p>
          <p className="text-[10px] text-gray-400 mt-2 pt-2 border-t border-gray-100">Grounded in {answer.sources ?? 0} CKCM source{answer.sources === 1 ? "" : "s"} · {answer.model ?? "—"} · every answer is audit-logged.</p>
        </div>
      )}
    </div>
  );
}
