"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Bank = { id: string; name: string; description: string | null; cpu_id: string | null; pass_mark: number; validity_months: number; time_limit_minutes: number | null };
type Question = { id: string; bank_id: string; content: string; options: string[]; correct_answer: string; explanation: string | null };
type Cpu = { id: string; name: string; code: string | null };
type Attempt = { bank_id: string; passed: boolean };

const EMPTY_Q = { content: "", options: ["", "", "", ""], correct_index: 0, explanation: "" };

export default function QuestionBuilder({ banks, questions, cpus, attempts }: {
  banks: Bank[]; questions: Question[]; cpus: Cpu[]; attempts: Attempt[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(banks[0]?.id ?? null);
  const [showNew, setShowNew] = useState(false);
  const [bankForm, setBankForm] = useState({ name: "", cpu_id: "", pass_mark: "80", validity_months: "24" });
  const [q, setQ] = useState(EMPTY_Q);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = banks.find(b => b.id === selectedId) ?? null;
  const bankQuestions = useMemo(() => questions.filter(x => x.bank_id === selectedId), [questions, selectedId]);
  const qCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of questions) m.set(x.bank_id, (m.get(x.bank_id) ?? 0) + 1);
    return m;
  }, [questions]);
  const bankAttempts = attempts.filter(a => a.bank_id === selectedId);
  const cpuName = (id: string | null) => (id ? cpus.find(c => c.id === id)?.name ?? "—" : null);

  async function api(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    const res = await fetch("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Failed"); return null; }
    router.refresh();
    return res.json();
  }

  const input = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5">
      {/* LEFT — banks */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 self-start">
        <button onClick={() => setShowNew(v => !v)}
          className="w-full bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors mb-3">
          {showNew ? "Cancel" : "+ New Question Bank"}
        </button>
        {showNew && (
          <div className="flex flex-col gap-2 mb-3 pb-3 border-b border-gray-100">
            <input className={input} placeholder="Bank name — e.g. Oxygen Therapy Knowledge Test"
              value={bankForm.name} onChange={e => setBankForm(f => ({ ...f, name: e.target.value }))} />
            <select className={input} value={bankForm.cpu_id} onChange={e => setBankForm(f => ({ ...f, cpu_id: e.target.value }))}>
              <option value="">Linked CPU (optional)…</option>
              {cpus.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-gray-400">Pass mark %
                <input className={input} type="number" value={bankForm.pass_mark}
                  onChange={e => setBankForm(f => ({ ...f, pass_mark: e.target.value }))} />
              </label>
              <label className="text-[10px] text-gray-400">Valid (months)
                <input className={input} type="number" value={bankForm.validity_months}
                  onChange={e => setBankForm(f => ({ ...f, validity_months: e.target.value }))} />
              </label>
            </div>
            <button disabled={busy || !bankForm.name.trim()}
              onClick={async () => {
                const r = await api({ kind: "question_bank", name: bankForm.name, cpu_id: bankForm.cpu_id || null,
                  pass_mark: Number(bankForm.pass_mark) || 80, validity_months: Number(bankForm.validity_months) || 24 });
                if (r) { setSelectedId(r.id); setShowNew(false); setBankForm({ name: "", cpu_id: "", pass_mark: "80", validity_months: "24" }); }
              }}
              className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors disabled:opacity-50">
              Create bank
            </button>
          </div>
        )}
        <div className="flex flex-col gap-1 max-h-96 overflow-y-auto">
          {banks.length === 0 && <p className="text-xs text-gray-400 py-4 text-center">No banks yet.</p>}
          {banks.map(b => (
            <button key={b.id} onClick={() => { setSelectedId(b.id); setError(null); }}
              className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                b.id === selectedId ? "bg-teal-50 text-teal-800 border border-teal-200" : "hover:bg-gray-50 text-gray-700"}`}>
              <span className="flex items-center gap-2">
                <span>❓</span>
                <span className="flex-1 min-w-0 truncate">{b.name}</span>
                <span className="text-[9px] bg-gray-100 text-gray-500 rounded-full px-1.5 font-bold">{qCount.get(b.id) ?? 0}</span>
              </span>
              {b.cpu_id && <span className="text-[9px] text-gray-400 ml-6">{cpuName(b.cpu_id)}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* RIGHT — questions editor */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 self-start">
        {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-3 py-2 mb-3">{error}</div>}
        {!selected ? (
          <p className="text-sm text-gray-400 py-8 text-center">Select or create a question bank.</p>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-bold text-gray-900 text-sm">{selected.name}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Pass mark {selected.pass_mark}% · valid {selected.validity_months} months
                  {selected.cpu_id ? ` · ${cpuName(selected.cpu_id)}` : ""}
                  {" · "}{bankAttempts.length} attempt{bankAttempts.length !== 1 ? "s" : ""}
                  {bankAttempts.length > 0 ? ` (${bankAttempts.filter(a => a.passed).length} passed)` : ""}
                </p>
              </div>
              <button disabled={busy}
                onClick={async () => { setBusy(true); await fetch(`/api/studio?kind=question_bank&id=${selected.id}`, { method: "DELETE" }); setBusy(false); setSelectedId(null); router.refresh(); }}
                className="text-xs text-red-400 hover:bg-red-50 px-2 py-1 rounded-lg">Retire</button>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {bankQuestions.map((x, i) => (
                <div key={x.id} className="bg-gray-50 rounded-lg px-4 py-3">
                  <div className="flex items-start gap-2">
                    <p className="text-sm text-gray-800 flex-1"><b>{i + 1}.</b> {x.content}</p>
                    <button disabled={busy} title="Delete"
                      onClick={async () => { setBusy(true); await fetch(`/api/studio?kind=bank_question&id=${x.id}`, { method: "DELETE" }); setBusy(false); router.refresh(); }}
                      className="text-gray-300 hover:text-red-500 text-xs">✕</button>
                  </div>
                  <div className="mt-1.5 flex flex-col gap-0.5">
                    {x.options.map(o => (
                      <p key={o} className={`text-[11px] px-2 py-0.5 rounded ${o === x.correct_answer ? "bg-green-100 text-green-800 font-medium" : "text-gray-500"}`}>
                        {o === x.correct_answer ? "✓ " : "○ "}{o}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
              {bankQuestions.length === 0 && <p className="text-xs text-gray-400">No questions yet — add the first below.</p>}
            </div>

            {/* Add question */}
            <div className="mt-5 pt-4 border-t border-gray-100 flex flex-col gap-2.5">
              <p className="text-[10px] font-bold text-teal-600 uppercase tracking-widest">Add question</p>
              <textarea className={input} rows={2} placeholder="Question stem"
                value={q.content} onChange={e => setQ(f => ({ ...f, content: e.target.value }))} />
              {q.options.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="radio" name="correct" checked={q.correct_index === i} onChange={() => setQ(f => ({ ...f, correct_index: i }))}
                    title="Mark as correct answer" />
                  <input className={input} placeholder={`Option ${i + 1}${q.correct_index === i ? " (correct)" : ""}`}
                    value={o} onChange={e => setQ(f => ({ ...f, options: f.options.map((x, j) => j === i ? e.target.value : x) }))} />
                </div>
              ))}
              <input className={input} placeholder="Explanation shown after answering (optional)"
                value={q.explanation} onChange={e => setQ(f => ({ ...f, explanation: e.target.value }))} />
              <button disabled={busy || !q.content.trim() || q.options.filter(o => o.trim()).length < 2 || !q.options[q.correct_index]?.trim()}
                onClick={async () => {
                  const r = await api({ kind: "bank_question", bank_id: selectedId, ...q });
                  if (r) setQ(EMPTY_Q);
                }}
                className="self-start bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
                Add question
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
