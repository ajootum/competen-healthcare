"use client";

import { useState } from "react";

// CDP-003 — adaptive exam take-flow. Start an exam, answer one item at a time; the engine picks each next item
// for your current ability and stops when it's measured you precisely enough. Scoring is server-side.

type Exam = { id: string; name: string; description: string | null; minItems: number; maxItems: number; passThreshold: number; last: { status: string; score_pct: number | null; passed: boolean | null } | null };
type Item = { id: string; content: string; type: string; options: unknown };
type Opt = { label: string; value: string };

function parseOptions(item: Item): Opt[] {
  if (Array.isArray(item.options)) {
    return (item.options as unknown[]).map(o => {
      if (typeof o === "string") return { label: o, value: o };
      const obj = o as Record<string, unknown>;
      const label = String(obj.text ?? obj.label ?? obj.value ?? o);
      return { label, value: String(obj.value ?? obj.key ?? obj.text ?? obj.label ?? label) };
    });
  }
  if (item.type === "true_false") return [{ label: "True", value: "true" }, { label: "False", value: "false" }];
  return [];
}

export default function AdaptiveExam({ exams }: { exams: Exam[] }) {
  const [session, setSession] = useState<{ id: string; name: string } | null>(null);
  const [item, setItem] = useState<Item | null>(null);
  const [progress, setProgress] = useState<{ administered: number; max: number; se: number | null }>({ administered: 0, max: 0, se: null });
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ scorePct: number; passed: boolean; administered: number } | null>(null);

  async function start(examId: string) {
    setBusy(true); setErr(null); setResult(null);
    const r = await fetch("/api/me/adaptive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", exam_id: examId }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? "Could not start"); return; }
    setSession({ id: j.session_id, name: j.exam.name }); setItem(j.item); setProgress({ administered: 0, max: j.progress.max, se: null }); setChoice("");
  }

  async function submit() {
    if (!session || !item || !choice) return;
    setBusy(true); setErr(null);
    const r = await fetch("/api/me/adaptive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "answer", session_id: session.id, question_id: item.id, answer: choice }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? "Submit failed"); return; }
    if (j.done) { setResult(j.result); setItem(null); return; }
    setItem(j.item); setProgress({ administered: j.progress.administered, max: j.progress.max, se: j.progress.se }); setChoice("");
  }

  function reset() { setSession(null); setItem(null); setResult(null); setChoice(""); setErr(null); }

  if (result) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
        <p className="text-2xl mb-1">{result.passed ? "🎯" : "📗"}</p>
        <p className="text-sm font-semibold text-gray-800">{result.passed ? "Passed" : "Not yet — keep practising"}</p>
        <p className="text-2xl font-bold text-gray-900 mt-2">{result.scorePct}%</p>
        <p className="text-xs text-gray-400 mt-0.5">measured over {result.administered} adaptive item{result.administered === 1 ? "" : "s"}</p>
        <button onClick={reset} className="mt-4 text-sm font-semibold text-teal-700 border border-teal-200 bg-teal-50 hover:bg-teal-100 rounded-lg px-4 py-2">Back to exams</button>
      </div>
    );
  }

  if (session && item) {
    const opts = parseOptions(item);
    const pct = progress.max ? Math.min(100, Math.round((progress.administered / progress.max) * 100)) : 0;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-gray-400 font-medium">{session.name} · item {progress.administered + 1}{progress.se != null ? ` · precision ±${progress.se}` : ""}</p>
          <button onClick={reset} className="text-[11px] text-gray-400 hover:text-gray-600">Exit</button>
        </div>
        <div className="h-1 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-violet-500 rounded-full" style={{ width: `${pct}%` }} /></div>
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <p className="text-base text-gray-800 leading-relaxed mb-4">{item.content}</p>
          {opts.length > 0 ? (
            <div className="flex flex-col gap-2">
              {opts.map((o, idx) => (
                <button key={idx} onClick={() => setChoice(o.value)} className={`text-left text-sm border rounded-lg px-3 py-2.5 transition-colors ${choice === o.value ? "border-violet-400 bg-violet-50 text-violet-900" : "border-gray-200 hover:border-violet-200"}`}>{o.label}</button>
              ))}
            </div>
          ) : (
            <input value={choice} onChange={e => setChoice(e.target.value)} placeholder="Your answer" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-violet-400" />
          )}
          <button onClick={submit} disabled={busy || !choice} className="mt-4 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 rounded-lg px-5 py-2.5">{busy ? "…" : "Submit answer"}</button>
          {err && <p className="text-[11px] text-rose-600 mt-2">{err}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {err && <p className="text-[11px] text-rose-600">{err}</p>}
      {exams.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">No adaptive exams available yet.</div>
      ) : exams.map(e => (
        <div key={e.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-800">{e.name}</p>
            {e.description && <p className="text-[11px] text-gray-400 truncate">{e.description}</p>}
            <p className="text-[10px] text-gray-400 mt-0.5">{e.minItems}–{e.maxItems} adaptive items · pass {e.passThreshold}%{e.last?.score_pct != null ? ` · last ${e.last.score_pct}%${e.last.passed ? " ✓" : ""}` : ""}</p>
          </div>
          <button onClick={() => start(e.id)} disabled={busy} className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg px-4 py-2 shrink-0">Start</button>
        </div>
      ))}
    </div>
  );
}
