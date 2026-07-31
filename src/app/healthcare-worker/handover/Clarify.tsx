"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Handover clarifications (HWW-HND-001): the incoming nurse ASKS about a
// patient in the handover; the outgoing nurse ANSWERS. Both restricted to
// the caller's assigned patients server-side.

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
const btnGhost = "px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50";

export function AskClarification({ patientId, patientLabel }: { patientId: string; patientLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function ask() {
    setBusy(true); setErr(null);
    const r = await fetch("/api/operations/handover", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clarify", patient_id: patientId, question: q }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d.error ?? "Failed"); return; }
    setQ(""); setOpen(false);
    router.refresh();
  }

  if (!open) return <button className={btnGhost} onClick={() => setOpen(true)}>Ask about {patientLabel}</button>;
  return (
    <div className="flex flex-wrap items-center gap-2 mt-1">
      <input className={`${input} flex-1 min-w-[200px]`} placeholder="Your question for the outgoing nurse" value={q} onChange={e => setQ(e.target.value)} />
      <button className={btnGhost} disabled={busy || !q.trim()} onClick={ask}>Ask</button>
      <button className={btnGhost} onClick={() => setOpen(false)}>Cancel</button>
      {err && <span className="text-xs text-[var(--cmp-text-warning)]">{err}</span>}
    </div>
  );
}

export function AnswerClarification({ id }: { id: string }) {
  const router = useRouter();
  const [a, setA] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function answer() {
    setBusy(true); setErr(null);
    const r = await fetch("/api/operations/handover", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "answer", id, answer: a }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d.error ?? "Failed"); return; }
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mt-1">
      <input className={`${input} flex-1 min-w-[180px]`} placeholder="Answer…" value={a} onChange={e => setA(e.target.value)} />
      <button className={btnGhost} disabled={busy || !a.trim()} onClick={answer}>Answer</button>
      {err && <span className="text-xs text-[var(--cmp-text-warning)]">{err}</span>}
    </div>
  );
}
