"use client";

import { useState } from "react";

// CDP-005 — log a deliberate-practice session with a structured debrief (what went well / to improve / action
// plan) and a self-rating. A "needs more practice" outcome seeds a reinforcement card for the competency.

type Scenario = { id: string; name: string; scenario_type: string | null };
type Session = { id: string; scenario_name: string | null; scenario_type: string | null; outcome: string; self_rating: number | null; created_at: string };

export default function PracticeLog({ scenarios, initialHistory }: { scenarios: Scenario[]; initialHistory: Session[] }) {
  const [scenarioId, setScenarioId] = useState("");
  const [outcome, setOutcome] = useState("completed");
  const [rating, setRating] = useState("");
  const [duration, setDuration] = useState("");
  const [wentWell, setWentWell] = useState("");
  const [toImprove, setToImprove] = useState("");
  const [action, setAction] = useState("");
  const [history, setHistory] = useState<Session[]>(initialHistory);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/me/simulation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario_id: scenarioId || null, outcome, self_rating: rating, duration_min: duration, went_well: wentWell, to_improve: toImprove, action_plan: action }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(j.error ?? "Could not log"); return; }
    setMsg("Practice logged.");
    if (j.history?.sessions) setHistory(j.history.sessions);
    setScenarioId(""); setOutcome("completed"); setRating(""); setDuration(""); setWentWell(""); setToImprove(""); setAction("");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-xl border border-gray-100 p-4 flex flex-col gap-2.5">
        <h2 className="font-semibold text-gray-900 text-sm">Log a practice session</h2>
        <select value={scenarioId} onChange={e => setScenarioId(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-teal-400">
          <option value="">Scenario (optional)…</option>
          {scenarios.map(s => <option key={s.id} value={s.id}>{s.name}{s.scenario_type ? ` · ${s.scenario_type.replace(/_/g, " ")}` : ""}</option>)}
        </select>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-gray-400 font-medium">Outcome</span>
          <button onClick={() => setOutcome("completed")} className={`text-xs font-semibold rounded-lg px-3 py-1.5 border ${outcome === "completed" ? "bg-teal-50 border-teal-200 text-teal-700" : "border-gray-200 text-gray-500"}`}>Completed confidently</button>
          <button onClick={() => setOutcome("needs_practice")} className={`text-xs font-semibold rounded-lg px-3 py-1.5 border ${outcome === "needs_practice" ? "bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)] text-[var(--cmp-text-warning)]" : "border-gray-200 text-gray-500"}`}>Needs more practice</button>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-600"><span className="text-[10px] text-gray-400">Confidence 1–5</span><input value={rating} onChange={e => setRating(e.target.value)} type="number" min={1} max={5} className="w-16 text-xs border border-gray-200 rounded-lg px-2 py-1.5" /></label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600"><span className="text-[10px] text-gray-400">Minutes</span><input value={duration} onChange={e => setDuration(e.target.value)} type="number" min={0} className="w-20 text-xs border border-gray-200 rounded-lg px-2 py-1.5" /></label>
        </div>
        <textarea value={wentWell} onChange={e => setWentWell(e.target.value)} placeholder="What went well?" rows={2} className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-400" />
        <textarea value={toImprove} onChange={e => setToImprove(e.target.value)} placeholder="What to improve?" rows={2} className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-400" />
        <textarea value={action} onChange={e => setAction(e.target.value)} placeholder="Action plan for next time" rows={2} className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-400" />
        <div className="flex items-center gap-3">
          <button onClick={submit} disabled={busy} className="text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-lg px-5 py-2">{busy ? "Saving…" : "Log session"}</button>
          {msg && <span className="text-[11px] text-gray-500">{msg}</span>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-50"><p className="text-[11px] text-gray-400">Your practice history</p></div>
        {history.length === 0 ? (
          <p className="text-xs text-gray-400 px-4 py-8 text-center">No sessions logged yet.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {history.map(s => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-sm text-gray-800 truncate flex-1">{s.scenario_name ?? "Practice session"}</span>
                {s.self_rating != null && <span className="text-[10px] text-gray-400 shrink-0">conf {s.self_rating}/5</span>}
                <span className={`text-[8px] font-bold uppercase tracking-wide border rounded px-1.5 py-0.5 shrink-0 ${s.outcome === "needs_practice" ? "text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]" : "text-teal-700 bg-teal-50 border-teal-100"}`}>{s.outcome === "needs_practice" ? "Practice" : "Done"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
