"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// CAPA tracker board (client): filter tabs, create form, status advance with
// optional evidence note. All writes go through /api/quality/capa.

export type CapaRow = {
  id: string; title: string; description: string | null; priority: string; status: string;
  due: string | null; owner: string | null; evidenceNote: string | null; source: string | null; overdue: boolean;
};

const PRIORITY_CLS: Record<string, string> = {
  high: "bg-red-100 text-red-700", medium: "bg-amber-100 text-amber-700", low: "bg-gray-100 text-gray-600",
};
const STATUS_CLS: Record<string, string> = {
  open: "bg-blue-100 text-blue-700", in_progress: "bg-indigo-100 text-indigo-700",
  completed: "bg-green-100 text-green-700", verified: "bg-teal-100 text-teal-700", closed: "bg-gray-100 text-gray-500",
};
const NEXT: Record<string, { to: string; label: string }> = {
  open: { to: "in_progress", label: "Start" },
  in_progress: { to: "completed", label: "Mark completed" },
  completed: { to: "verified", label: "Verify" },
  verified: { to: "closed", label: "Close" },
};

export default function CapaBoard({ rows, owners, startOpen }: {
  rows: CapaRow[]; owners: { id: string; name: string }[]; startOpen: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState("Open");
  const [showNew, setShowNew] = useState(startOpen);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [priority, setPriority] = useState("medium");
  const [due, setDue] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null);
  const [evidenceText, setEvidenceText] = useState("");

  const TABS: { label: string; match: (r: CapaRow) => boolean }[] = [
    { label: "Open", match: r => ["open", "in_progress"].includes(r.status) },
    { label: "Overdue", match: r => r.overdue },
    { label: "Completed", match: r => ["completed", "verified"].includes(r.status) },
    { label: "Closed", match: r => r.status === "closed" },
    { label: "All", match: () => true },
  ];
  const active = TABS.find(t => t.label === tab) ?? TABS[0];
  const visible = rows.filter(active.match);

  async function create() {
    if (!title.trim()) { setError("A title is required."); return; }
    setBusy("new"); setError(null);
    const res = await fetch("/api/quality/capa", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description: desc, priority, due_date: due || null, owner_id: ownerId || null }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setShowNew(false); setTitle(""); setDesc(""); setDue(""); setOwnerId(""); setPriority("medium");
      router.refresh();
    } else setError(d.error ?? "Could not create the action");
    setBusy(null);
  }

  async function advance(row: CapaRow) {
    const next = NEXT[row.status];
    if (!next) return;
    setBusy(row.id); setError(null);
    const res = await fetch("/api/quality/capa", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: row.id, status: next.to,
        evidence_note: evidenceFor === row.id ? evidenceText.trim() || undefined : undefined,
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) { setEvidenceFor(null); setEvidenceText(""); router.refresh(); }
    else setError(d.error ?? "Status change failed");
    setBusy(null);
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {TABS.map(t => {
          const n = rows.filter(t.match).length;
          return (
            <button key={t.label} onClick={() => setTab(t.label)}
              className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                tab === t.label ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"}`}>
              {t.label} ({n})
            </button>
          );
        })}
        <span className="flex-1" />
        <button onClick={() => setShowNew(v => !v)}
          className="text-xs font-semibold text-white bg-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors">
          {showNew ? "Close" : "＋ New action"}
        </button>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</p>}

      {showNew && (
        <div className="bg-white border border-indigo-200 rounded-xl p-4 mb-4">
          <div className="grid md:grid-cols-2 gap-2 mb-2">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Action title *"
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-indigo-400 md:col-span-2" />
            <select value={priority} onChange={e => setPriority(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-600 focus:outline-none focus:border-indigo-400">
              <option value="low">Low priority</option>
              <option value="medium">Medium priority</option>
              <option value="high">High priority</option>
            </select>
            <input type="date" value={due} onChange={e => setDue(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-2 text-gray-600 focus:outline-none focus:border-indigo-400" />
            <select value={ownerId} onChange={e => setOwnerId(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-600 focus:outline-none focus:border-indigo-400 md:col-span-2">
              <option value="">Owner (defaults to you)…</option>
              {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="Description / evidence required for closure…"
            className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 text-gray-600 focus:outline-none focus:border-indigo-400 mb-2" />
          <button onClick={create} disabled={busy === "new"}
            className="text-xs font-bold text-white bg-indigo-600 rounded-lg px-4 py-2 hover:bg-indigo-700 disabled:opacity-40 transition-colors">
            {busy === "new" ? "Creating…" : "Create action"}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {visible.map(r => (
          <div key={r.id} className={`bg-white border rounded-xl px-4 py-3 ${r.overdue ? "border-red-200" : "border-gray-200"}`}>
            <div className="flex items-start gap-2 flex-wrap">
              <div className="flex-1 min-w-[220px]">
                <p className="text-sm font-medium text-gray-800">{r.title}</p>
                {r.description && <p className="text-[11px] text-gray-500 mt-0.5">{r.description}</p>}
                <p className="text-[10px] text-gray-400 mt-1">
                  {r.owner ? `Owner: ${r.owner}` : "Unassigned"}
                  {r.due ? ` · due ${r.due}` : ""}
                  {r.source ? ` · from ${r.source}` : " · raised manually"}
                </p>
                {r.evidenceNote && <p className="text-[10px] text-teal-700 mt-0.5">Evidence: {r.evidenceNote}</p>}
              </div>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${PRIORITY_CLS[r.priority] ?? ""}`}>{r.priority}</span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${STATUS_CLS[r.status] ?? ""}`}>{r.status.replace("_", " ")}</span>
              {r.overdue && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase bg-red-500 text-white">overdue</span>}
              {NEXT[r.status] && (
                <button onClick={() => (r.status === "in_progress" && evidenceFor !== r.id) ? setEvidenceFor(r.id) : advance(r)}
                  disabled={busy === r.id}
                  className="text-[10px] font-semibold text-indigo-600 border border-indigo-200 rounded-lg px-2.5 py-1 hover:bg-indigo-50 disabled:opacity-40 transition-colors">
                  {busy === r.id ? "…" : NEXT[r.status].label}
                </button>
              )}
            </div>
            {evidenceFor === r.id && (
              <div className="flex items-center gap-2 mt-2">
                <input value={evidenceText} onChange={e => setEvidenceText(e.target.value)} autoFocus
                  placeholder="What was done? (recorded as closure evidence)…"
                  className="flex-1 text-[11px] border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-600 focus:outline-none focus:border-indigo-400" />
                <button onClick={() => advance(r)} disabled={busy === r.id}
                  className="text-[10px] font-bold text-white bg-indigo-600 rounded-lg px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-40">Save &amp; complete</button>
              </div>
            )}
          </div>
        ))}
        {!visible.length && (
          <p className="bg-white border border-gray-200 rounded-xl px-4 py-8 text-center text-xs text-gray-400">
            No {tab.toLowerCase()} actions.
          </p>
        )}
      </div>
    </div>
  );
}
