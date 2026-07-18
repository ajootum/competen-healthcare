"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Appeals review queue (Assessment Quality module). Staff move appeals
// through under review → upheld / overturned / withdrawn with a note.

export type AppealRow = {
  id: string; nurse: string; competency: string | null; score: number | null;
  reason: string; status: string; at: string;
};

const STATUS_CLS: Record<string, string> = {
  open: "bg-blue-100 text-blue-700", under_review: "bg-amber-100 text-amber-700",
  upheld: "bg-gray-100 text-gray-600", overturned: "bg-green-100 text-green-700", withdrawn: "bg-gray-100 text-gray-400",
};

export default function AppealsQueue({ rows }: { rows: AppealRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState<string>("upheld");

  async function move(id: string, status: string, resolution_note?: string) {
    setBusy(id); setError(null);
    const res = await fetch("/api/appeals", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, resolution_note }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) { setNoteFor(null); setNote(""); router.refresh(); }
    else setError(d.error ?? "Could not update the appeal");
    setBusy(null);
  }

  if (!rows.length) return <p className="text-xs text-gray-400">No open appeals. ✅</p>;

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {rows.map(r => (
        <div key={r.id} className="border border-gray-100 rounded-lg px-3 py-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-gray-800">{r.nurse}</span>
            <span className="text-[11px] text-gray-500">{r.competency ?? "Assessment"}{r.score != null ? ` · scored ${r.score}/6` : ""}</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${STATUS_CLS[r.status] ?? ""}`}>{r.status.replace("_", " ")}</span>
            <span className="text-[9px] text-gray-300" suppressHydrationWarning>{new Date(r.at).toLocaleDateString()}</span>
            <span className="flex-1" />
            {r.status === "open" && (
              <button onClick={() => move(r.id, "under_review")} disabled={busy === r.id}
                className="text-[10px] font-semibold text-amber-700 border border-amber-300 rounded-lg px-2.5 py-1 hover:bg-amber-50 disabled:opacity-40">Start review</button>
            )}
            {["open", "under_review"].includes(r.status) && (
              <button onClick={() => setNoteFor(noteFor === r.id ? null : r.id)}
                className="text-[10px] font-semibold text-indigo-600 border border-indigo-200 rounded-lg px-2.5 py-1 hover:bg-indigo-50">Decide…</button>
            )}
          </div>
          <p className="text-[11px] text-gray-500 mt-1.5 italic">&ldquo;{r.reason}&rdquo;</p>
          {noteFor === r.id && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <select value={decision} onChange={e => setDecision(e.target.value)}
                className="text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:border-indigo-400">
                <option value="upheld">Uphold original outcome</option>
                <option value="overturned">Overturn — arrange reassessment</option>
                <option value="withdrawn">Close as withdrawn</option>
              </select>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Resolution note (sent to the learner)…"
                className="flex-1 min-w-[180px] text-[11px] border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-600 focus:outline-none focus:border-indigo-400" />
              <button onClick={() => move(r.id, decision, note)} disabled={busy === r.id}
                className="text-[10px] font-bold text-white bg-indigo-600 rounded-lg px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-40">
                {busy === r.id ? "…" : "Record decision"}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
