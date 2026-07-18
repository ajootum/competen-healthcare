"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Referrals board — escalate a learner to a named colleague or external
// service and track resolution. Sensitive: only the reason travels.

export type ReferralRow = {
  id: string; nurse: string; referredTo: string; reason: string; urgency: string;
  status: string; resolutionNote: string | null; createdBy: string | null; at: string; mine: boolean;
};
export type Person = { id: string; name: string; role: string };
export type Learner = { id: string; name: string; dept: string };

const URGENCY_CLS: Record<string, string> = {
  high: "bg-red-100 text-red-700", medium: "bg-amber-100 text-amber-700", low: "bg-gray-100 text-gray-600",
};
const STATUS_CLS: Record<string, string> = {
  open: "bg-blue-100 text-blue-700", accepted: "bg-indigo-100 text-indigo-700",
  resolved: "bg-green-100 text-green-700", declined: "bg-gray-100 text-gray-400",
};
const NEXT: Record<string, { to: string; label: string }[]> = {
  open: [{ to: "accepted", label: "Accept" }, { to: "resolved", label: "Resolve…" }, { to: "declined", label: "Decline…" }],
  accepted: [{ to: "resolved", label: "Resolve…" }, { to: "declined", label: "Decline…" }],
};

export default function ReferralsBoard({ referrals, learners, referees, startOpen }: {
  referrals: ReferralRow[]; learners: Learner[]; referees: Person[]; startOpen: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState("Open");
  const [showNew, setShowNew] = useState(startOpen);
  const [form, setForm] = useState({ nurse_id: "", target: "", referred_to_text: "", reason: "", urgency: "medium" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<{ id: string; to: string } | null>(null);
  const [note, setNote] = useState("");

  const TABS: { label: string; match: (r: ReferralRow) => boolean }[] = [
    { label: "Open", match: r => ["open", "accepted"].includes(r.status) },
    { label: "Resolved", match: r => r.status === "resolved" },
    { label: "Declined", match: r => r.status === "declined" },
    { label: "All", match: () => true },
  ];
  const active = TABS.find(t => t.label === tab) ?? TABS[0];
  const visible = referrals.filter(active.match);

  async function create() {
    if (!form.nurse_id || !form.reason.trim() || (!form.target && !form.referred_to_text.trim())) {
      setError("Pick a learner, a referee (internal or external) and a reason."); return;
    }
    setBusy("new"); setError(null);
    const internal = form.target && form.target !== "__external__";
    const res = await fetch("/api/support/referrals", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nurse_id: form.nurse_id, reason: form.reason, urgency: form.urgency,
        referred_to_id: internal ? form.target : undefined,
        referred_to_text: internal ? undefined : form.referred_to_text,
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) { setShowNew(false); setForm({ nurse_id: "", target: "", referred_to_text: "", reason: "", urgency: "medium" }); router.refresh(); }
    else setError(d.error ?? "Could not create");
    setBusy(null);
  }

  async function move(id: string, to: string, withNote: boolean) {
    if (withNote && !(noteFor && noteFor.id === id)) { setNoteFor({ id, to }); return; }
    setBusy(id); setError(null);
    const res = await fetch("/api/support/referrals", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: to, resolution_note: withNote ? note : undefined }),
    });
    if (res.ok) { setNoteFor(null); setNote(""); router.refresh(); }
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
            {t.label} ({referrals.filter(t.match).length})
          </button>
        ))}
        <span className="flex-1" />
        <button onClick={() => setShowNew(v => !v)}
          className="text-xs font-semibold text-white bg-purple-600 px-3 py-1.5 rounded-lg hover:bg-purple-700 transition-colors">
          {showNew ? "Close" : "＋ New referral"}
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
            <select value={form.urgency} onChange={e => setForm(f => ({ ...f, urgency: e.target.value }))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-600 focus:outline-none focus:border-purple-400">
              <option value="low">Low urgency</option>
              <option value="medium">Medium urgency</option>
              <option value="high">High urgency</option>
            </select>
            <select value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-600 focus:outline-none focus:border-purple-400">
              <option value="">Refer to…</option>
              {referees.map(p => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}
              <option value="__external__">External service (specify)…</option>
            </select>
            {form.target === "__external__" && (
              <input value={form.referred_to_text} onChange={e => setForm(f => ({ ...f, referred_to_text: e.target.value }))} placeholder="External service (e.g. Wellbeing)"
                className="text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-purple-400" />
            )}
          </div>
          <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} rows={2} placeholder="Reason for referral * (kept minimal — no clinical detail)"
            className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 mb-2 text-gray-600 focus:outline-none focus:border-purple-400" />
          <button onClick={create} disabled={busy === "new"}
            className="text-xs font-bold text-white bg-purple-600 rounded-lg px-4 py-2 hover:bg-purple-700 disabled:opacity-40 transition-colors">
            {busy === "new" ? "Creating…" : "Create referral"}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {visible.map(r => (
          <div key={r.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-gray-800">{r.nurse}</span>
              <span className="text-[10px] text-gray-400">→ {r.referredTo}</span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${URGENCY_CLS[r.urgency]}`}>{r.urgency}</span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${STATUS_CLS[r.status]}`}>{r.status}</span>
              <span className="flex-1" />
              {(NEXT[r.status] ?? []).map(n => (
                <button key={n.to} onClick={() => move(r.id, n.to, n.label.endsWith("…"))} disabled={busy === r.id}
                  className="text-[10px] font-semibold text-purple-600 border border-purple-200 rounded-lg px-2.5 py-1 hover:bg-purple-50 disabled:opacity-40">
                  {n.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-600 mt-1">{r.reason}</p>
            {r.resolutionNote && <p className="text-[10px] text-gray-500 mt-0.5 italic">Resolution: {r.resolutionNote}</p>}
            {noteFor?.id === r.id && (
              <div className="flex items-center gap-2 mt-2">
                <input value={note} onChange={e => setNote(e.target.value)} autoFocus placeholder="Resolution note (to the referrer)…"
                  className="flex-1 text-[11px] border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-600 focus:outline-none focus:border-purple-400" />
                <button onClick={() => move(r.id, noteFor.to, true)} disabled={busy === r.id}
                  className="text-[10px] font-bold text-white bg-purple-600 rounded-lg px-3 py-1.5 hover:bg-purple-700 disabled:opacity-40 capitalize">Mark {noteFor.to}</button>
              </div>
            )}
          </div>
        ))}
        {!visible.length && <p className="bg-white border border-gray-200 rounded-xl px-4 py-8 text-center text-xs text-gray-400">No {tab.toLowerCase()} referrals.</p>}
      </div>
    </div>
  );
}
