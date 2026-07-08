"use client";
import { useState } from "react";

export default function CoachPanel() {
  const [plan, setPlan] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function coach() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const d = await res.json();
      if (res.ok) setPlan(d.answer);
      else setError(d.error ?? "Coaching unavailable");
    } catch {
      setError("Network error");
    }
    setBusy(false);
  }

  return (
    <div className="mt-4">
      {plan ? (
        <div className="bg-teal-50/60 border border-teal-100 rounded-xl px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-teal-700 uppercase tracking-widest">🤖 Your Coaching Plan</p>
            <button onClick={() => setPlan(null)} className="text-[10px] text-gray-400 hover:text-gray-600">dismiss</button>
          </div>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{plan}</p>
        </div>
      ) : (
        <button onClick={coach} disabled={busy}
          className="w-full py-2.5 text-sm font-semibold bg-teal-50 text-teal-700 border border-teal-100 rounded-xl hover:bg-teal-100 disabled:opacity-50 transition-colors">
          {busy ? "Your coach is thinking…" : "🤖 Get AI coaching on my gaps"}
        </button>
      )}
      {error && <p className="mt-2 text-xs text-amber-600">{error}</p>}
    </div>
  );
}
