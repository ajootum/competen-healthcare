"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Interventions board — create remediation plans and advance them through the
// lifecycle (planned → in progress → review → completed with outcome).

export type InterventionRow = {
  id: string; nurse: string; nurseId: string; competency: string | null; reason: string;
  objectives: string | null; activities: string | null; reviewDate: string | null;
  status: string; outcome: string | null; outcomeNote: string | null; createdBy: string | null; at: string;
};
export type Learner = { id: string; name: string; dept: string };

const STATUS_CLS: Record<string, string> = {
  planned: "bg-gray-100 text-gray-600", in_progress: "bg-blue-100 text-blue-700",
  review: "bg-amber-100 text-amber-700", completed: "bg-green-100 text-green-700",
};
const OUTCOME_CLS: Record<string, string> = {
  successful: "bg-green-100 text-green-700", partially_successful: "bg-amber-100 text-amber-700", unsuccessful: "bg-red-100 text-red-600",
};
const NEXT: Record<string, { to: string; label: string }> = {
  planned: { to: "in_progress", label: "Start" },
  in_progress: { to: "review", label: "Move to review" },
  review: { to: "completed", label: "Complete…" },
};

export default function InterventionsBoard({ items, learners, startOpen }: {
  items: InterventionRow[]; learners: Learner[]; startOpen: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState("Active");
  const [showNew, setShowNew] = useState(startOpen);
  const [form, setForm] = useState({ nurse_id: "", competency_name: "", reason: "", objectives: "", activities: "", review_date: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completeFor, setCompleteFor] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("successful");
  const [outcomeNote, setOutcomeNote] = useState("");

  const TABS: { label: string; match: (i: InterventionRow) => boolean }[] = [
    { label: "Active", match: i => i.status !== "completed" },
    { label: "In Review", match: i => i.status === "review" },
    { label: "Completed", match: i => i.status === "completed" },
    { label: "All", match: () => true },
  ];
  const active = TABS.find(t => t.label === tab) ?? TABS[0];
  const visible = items.filter(active.match);

  async function create() {
    if (!form.nurse_id || !form.reason.trim()) { setError("Pick a learner and give a reason."); return; }
    setBusy("new"); setError(null);
    const res = await fetch("/api/support/interventions", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) { setShowNew(false); setForm({ nurse_id: "", competency_name: "", reason: "", objectives: "", activities: "", review_date: "" }); router.refresh(); }
    else setError(d.error ?? "Could not create");
    setBusy(null);
  }

  async function advance(i: InterventionRow, to: string) {
    setBusy(i.id); setError(null);
    const body = to === "completed"
      ? { id: i.id, status: "completed", outcome, outcome_note: outcomeNote }
      : { id: i.id, status: to };
    const res = await fetch("/api/support/interventions", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (res.ok) { setCompleteFor(null); setOutcomeNote(""); router.refresh(); }
    else setError((await res.json().catch(() => ({})))?.error ?? "Failed");
    setBusy(null);
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {TABS.map(t => (
          <button key={t.label} onClick={() => setTab(t.label)}
            className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
              tab === t.label ? "bg-purple-600 text-white border-purple-600" : "bg-white text-gray-600 border-gray-200 hover:border-purple-300"}`}>
            {t.label} ({items.filter(t.match).length})
          </button>
        ))}
        <span className="flex-1" />
        <button onClick={() => setShowNew(v => !v)}
          className="text-xs font-semibold text-white bg-purple-600 px-3 py-1.5 rounded-lg hover:bg-purple-700 transition-colors">
          {showNew ? "Close" : "＋ New intervention"}
        </button>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</p>}

      {showNew && (
        <div className="bg-white border border-purple-200 rounded-xl p-4 mb-4">
          <div className="grid md:grid-cols-2 gap-2 mb-2">
            <select value={form.nurse_id} onChange={e => setForm(f => ({ ...f, nurse_id: e.target.value }))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700 focus:outline-none focus:border-purple-400">
              <option value="">Learner…</option>
              {learners.map(l => <option key={l.id} value={l.id}>{l.name} · {l.dept}</option>)}
            </select>
            <input value={form.competency_name} onChange={e => setForm(f => ({ ...f, competency_name: e.target.value }))} placeholder="Competency / area (optional)"
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-purple-400" />
          </div>
          <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Reason for the intervention *"
            className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 mb-2 focus:outline-none focus:border-purple-400" />
          <textarea value={form.objectives} onChange={e => setForm(f => ({ ...f, objectives: e.target.value }))} rows={2} placeholder="Objectives…"
            className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 mb-2 text-gray-600 focus:outline-none focus:border-purple-400" />
          <div className="grid md:grid-cols-[1fr_160px] gap-2 mb-2">
            <textarea value={form.activities} onChange={e => setForm(f => ({ ...f, activities: e.target.value }))} rows={2} placeholder="Activities…"
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-2 text-gray-600 focus:outline-none focus:border-purple-400" />
            <input type="date" value={form.review_date} onChange={e => setForm(f => ({ ...f, review_date: e.target.value }))} title="Review date"
              className="text-xs border border-gray-200 rounded-lg px-2 py-2 text-gray-600 focus:outline-none focus:border-purple-400 h-fit" />
          </div>
          <button onClick={create} disabled={busy === "new"}
            className="text-xs font-bold text-white bg-purple-600 rounded-lg px-4 py-2 hover:bg-purple-700 disabled:opacity-40 transition-colors">
            {busy === "new" ? "Creating…" : "Create intervention"}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {visible.map(i => (
          <div key={i.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-gray-800">{i.nurse}</span>
              {i.competency && <span className="text-[10px] text-gray-400">{i.competency}</span>}
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${STATUS_CLS[i.status] ?? ""}`}>{i.status.replace("_", " ")}</span>
              {i.outcome && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${OUTCOME_CLS[i.outcome]}`}>{i.outcome.replace("_", " ")}</span>}
              {i.reviewDate && i.status !== "completed" && <span className="text-[10px] text-amber-600">review {i.reviewDate}</span>}
              <span className="flex-1" />
              {NEXT[i.status] && (
                <button onClick={() => i.status === "review" ? setCompleteFor(completeFor === i.id ? null : i.id) : advance(i, NEXT[i.status].to)}
                  disabled={busy === i.id}
                  className="text-[10px] font-semibold text-purple-600 border border-purple-200 rounded-lg px-2.5 py-1 hover:bg-purple-50 disabled:opacity-40">
                  {busy === i.id ? "…" : NEXT[i.status].label}
                </button>
              )}
            </div>
            <p className="text-[11px] text-gray-600 mt-1">{i.reason}</p>
            {(i.objectives || i.activities) && <p className="text-[10px] text-gray-400 mt-0.5">{i.objectives}{i.objectives && i.activities ? " · " : ""}{i.activities}</p>}
            {i.outcomeNote && <p className="text-[10px] text-gray-500 mt-0.5 italic">Outcome: {i.outcomeNote}</p>}
            {completeFor === i.id && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <select value={outcome} onChange={e => setOutcome(e.target.value)}
                  className="text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:border-purple-400">
                  <option value="successful">Successful</option>
                  <option value="partially_successful">Partially successful</option>
                  <option value="unsuccessful">Unsuccessful</option>
                </select>
                <input value={outcomeNote} onChange={e => setOutcomeNote(e.target.value)} placeholder="Outcome note…"
                  className="flex-1 min-w-[160px] text-[11px] border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-600 focus:outline-none focus:border-purple-400" />
                <button onClick={() => advance(i, "completed")} disabled={busy === i.id}
                  className="text-[10px] font-bold text-white bg-green-600 rounded-lg px-3 py-1.5 hover:bg-green-700 disabled:opacity-40">Record outcome</button>
              </div>
            )}
          </div>
        ))}
        {!visible.length && <p className="bg-white border border-gray-200 rounded-xl px-4 py-8 text-center text-xs text-gray-400">No {tab.toLowerCase()} interventions.</p>}
      </div>
    </div>
  );
}
