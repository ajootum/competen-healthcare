"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Coaching Sessions board — schedule sessions and complete/cancel them with
// notes. Writes go through /api/support/sessions.

export type SessionRow = {
  id: string; nurse: string; nurseId: string; educator: string | null; type: string;
  at: string; focus: string | null; goals: string | null; notes: string | null;
  followUp: string | null; status: string;
};
export type Learner = { id: string; name: string; dept: string };

const TYPE_LABEL: Record<string, string> = {
  coaching: "Coaching", progress_review: "Progress review",
  validation_meeting: "Validation meeting", other: "Other",
};
const STATUS_CLS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700", completed: "bg-green-100 text-green-700", cancelled: "bg-gray-100 text-gray-400",
};

export default function CoachingBoard({ sessions, learners, startOpen }: {
  sessions: SessionRow[]; learners: Learner[]; startOpen: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState("Upcoming");
  const [showNew, setShowNew] = useState(startOpen);
  const [form, setForm] = useState({ nurse_id: "", session_type: "coaching", scheduled_for: "", focus: "", goals: "", follow_up_date: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const TABS: { label: string; match: (s: SessionRow) => boolean }[] = [
    { label: "Upcoming", match: s => s.status === "scheduled" },
    { label: "Completed", match: s => s.status === "completed" },
    { label: "Cancelled", match: s => s.status === "cancelled" },
    { label: "All", match: () => true },
  ];
  const active = TABS.find(t => t.label === tab) ?? TABS[0];
  const visible = sessions.filter(active.match);

  async function create() {
    if (!form.nurse_id || !form.scheduled_for) { setError("Pick a learner and a date/time."); return; }
    setBusy("new"); setError(null);
    const res = await fetch("/api/support/sessions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, scheduled_for: new Date(form.scheduled_for).toISOString() }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) { setShowNew(false); setForm({ nurse_id: "", session_type: "coaching", scheduled_for: "", focus: "", goals: "", follow_up_date: "" }); router.refresh(); }
    else setError(d.error ?? "Could not schedule");
    setBusy(null);
  }

  async function complete(id: string) {
    setBusy(id); setError(null);
    const res = await fetch("/api/support/sessions", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "completed", notes: note }),
    });
    if (res.ok) { setNoteFor(null); setNote(""); router.refresh(); }
    else setError((await res.json().catch(() => ({})))?.error ?? "Failed");
    setBusy(null);
  }

  async function cancel(id: string) {
    if (!confirm("Cancel this session? The learner is notified.")) return;
    setBusy(id);
    await fetch("/api/support/sessions", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "cancelled" }),
    });
    setBusy(null);
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {TABS.map(t => (
          <button key={t.label} onClick={() => setTab(t.label)}
            className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
              tab === t.label ? "bg-purple-600 text-white border-purple-600" : "bg-white text-gray-600 border-gray-200 hover:border-purple-300"}`}>
            {t.label} ({sessions.filter(t.match).length})
          </button>
        ))}
        <span className="flex-1" />
        <button onClick={() => setShowNew(v => !v)}
          className="text-xs font-semibold text-white bg-purple-600 px-3 py-1.5 rounded-lg hover:bg-purple-700 transition-colors">
          {showNew ? "Close" : "＋ Schedule session"}
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
            <select value={form.session_type} onChange={e => setForm(f => ({ ...f, session_type: e.target.value }))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-600 focus:outline-none focus:border-purple-400">
              <option value="coaching">Coaching</option>
              <option value="progress_review">Progress review</option>
              <option value="validation_meeting">Validation meeting</option>
              <option value="other">Other</option>
            </select>
            <input type="datetime-local" value={form.scheduled_for} onChange={e => setForm(f => ({ ...f, scheduled_for: e.target.value }))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-2 text-gray-600 focus:outline-none focus:border-purple-400" />
            <input type="date" value={form.follow_up_date} onChange={e => setForm(f => ({ ...f, follow_up_date: e.target.value }))} title="Follow-up date (optional)"
              className="text-xs border border-gray-200 rounded-lg px-2 py-2 text-gray-600 focus:outline-none focus:border-purple-400" />
          </div>
          <input value={form.focus} onChange={e => setForm(f => ({ ...f, focus: e.target.value }))} placeholder="Focus (e.g. IV therapy skills)"
            className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 mb-2 focus:outline-none focus:border-purple-400" />
          <textarea value={form.goals} onChange={e => setForm(f => ({ ...f, goals: e.target.value }))} rows={2} placeholder="SMART goals / action items…"
            className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 mb-2 text-gray-600 focus:outline-none focus:border-purple-400" />
          <button onClick={create} disabled={busy === "new"}
            className="text-xs font-bold text-white bg-purple-600 rounded-lg px-4 py-2 hover:bg-purple-700 disabled:opacity-40 transition-colors">
            {busy === "new" ? "Scheduling…" : "Schedule session"}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {visible.map(s => (
          <div key={s.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-gray-800">{s.nurse}</span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase bg-purple-50 text-purple-600">{TYPE_LABEL[s.type] ?? s.type}</span>
              <span className="text-[10px] text-gray-400" suppressHydrationWarning>{new Date(s.at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${STATUS_CLS[s.status] ?? ""}`}>{s.status}</span>
              <span className="flex-1" />
              {s.status === "scheduled" && (
                <>
                  <button onClick={() => setNoteFor(noteFor === s.id ? null : s.id)}
                    className="text-[10px] font-semibold text-green-700 border border-green-300 rounded-lg px-2.5 py-1 hover:bg-green-50">Complete…</button>
                  <button onClick={() => cancel(s.id)} disabled={busy === s.id}
                    className="text-[10px] font-semibold text-red-600 border border-red-200 rounded-lg px-2.5 py-1 hover:bg-red-50 disabled:opacity-40">Cancel</button>
                </>
              )}
            </div>
            {(s.focus || s.goals) && <p className="text-[11px] text-gray-500 mt-1">{s.focus}{s.focus && s.goals ? " — " : ""}{s.goals}</p>}
            {s.followUp && <p className="text-[10px] text-amber-600 mt-0.5">Follow-up: {s.followUp}</p>}
            {s.notes && <p className="text-[11px] text-gray-600 mt-1 italic">Notes: {s.notes}</p>}
            {noteFor === s.id && (
              <div className="flex items-center gap-2 mt-2">
                <input value={note} onChange={e => setNote(e.target.value)} autoFocus placeholder="Session notes / outcomes…"
                  className="flex-1 text-[11px] border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-600 focus:outline-none focus:border-purple-400" />
                <button onClick={() => complete(s.id)} disabled={busy === s.id}
                  className="text-[10px] font-bold text-white bg-green-600 rounded-lg px-3 py-1.5 hover:bg-green-700 disabled:opacity-40">Save &amp; complete</button>
              </div>
            )}
          </div>
        ))}
        {!visible.length && <p className="bg-white border border-gray-200 rounded-xl px-4 py-8 text-center text-xs text-gray-400">No {tab.toLowerCase()} sessions.</p>}
      </div>
    </div>
  );
}
