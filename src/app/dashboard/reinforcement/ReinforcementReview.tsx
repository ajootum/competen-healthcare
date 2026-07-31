"use client";

import { useState } from "react";

// CDP-004 — learner review loop. Retrieval practice: the prompt asks you to recall a competency; you try,
// then self-grade how well it came back. The grade drives SM-2, which reschedules the next review.

type Card = { id: string; subject: string; prompt: string };
const GRADES = [
  { q: 1, label: "Again", hint: "blanked", cls: "text-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)] border-[var(--cmp-color-error)] hover:bg-[var(--cmp-surface-error)]" },
  { q: 3, label: "Hard", hint: "a struggle", cls: "text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)] hover:bg-[var(--cmp-surface-warning)]" },
  { q: 4, label: "Good", hint: "recalled it", cls: "text-teal-700 bg-teal-50 border-teal-200 hover:bg-teal-100" },
  { q: 5, label: "Easy", hint: "instant", cls: "text-emerald-700 bg-[var(--cmp-surface-success)] border-[var(--cmp-color-success)] hover:bg-[var(--cmp-surface-success)]" },
];

export default function ReinforcementReview({ initial }: { initial: Card[] }) {
  const [i, setI] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);

  const card = initial[i];

  async function grade(quality: number) {
    if (!card) return;
    setBusy(true);
    const r = await fetch("/api/me/reinforcement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card_id: card.id, quality }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok && j.nextReviewAt) setLast(`Next review in ${j.intervalDays}d${j.status === "mastered" ? " · mastered ✓" : ""}`);
    setRevealed(false);
    setI(i + 1);
  }

  if (!initial.length) return <div className="bg-white rounded-xl border border-gray-100 p-8 text-center"><p className="text-2xl mb-1">🎉</p><p className="text-sm font-semibold text-gray-800">All caught up</p><p className="text-xs text-gray-400 mt-0.5">No reviews due today. New cards appear as their intervals come round.</p></div>;
  if (i >= initial.length) return <div className="bg-white rounded-xl border border-gray-100 p-8 text-center"><p className="text-2xl mb-1">✅</p><p className="text-sm font-semibold text-gray-800">Session complete — {initial.length} card{initial.length === 1 ? "" : "s"} reviewed</p><p className="text-xs text-gray-400 mt-0.5">Next reviews are scheduled by recall strength. Come back tomorrow.</p></div>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-gray-400 font-medium">Card {i + 1} of {initial.length}</p>
        {last && <p className="text-[11px] text-gray-400">{last}</p>}
      </div>
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <p className="text-[10px] font-semibold text-teal-600 uppercase tracking-widest mb-2">{card.subject}</p>
        <p className="text-base text-gray-800 leading-relaxed mb-5">{card.prompt}</p>
        {!revealed ? (
          <button onClick={() => setRevealed(true)} className="text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-5 py-2.5">Recall it, then grade yourself →</button>
        ) : (
          <div>
            <p className="text-[11px] text-gray-400 mb-2">How well did it come back?</p>
            <div className="flex flex-wrap gap-2">
              {GRADES.map(g => (
                <button key={g.q} onClick={() => grade(g.q)} disabled={busy} className={`text-sm font-semibold border rounded-lg px-4 py-2 disabled:opacity-50 ${g.cls}`}>
                  {g.label}<span className="text-[10px] font-normal opacity-70"> · {g.hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
