"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import EvidencePanel, { type EvidenceItem } from "@/components/EvidencePanel";

export type PendingEntry = {
  id: string; skillName: string; nurseName: string; competencyName: string | null;
  performedAt: string; location: string | null; supervision: string; notes: string | null; loggedAt: string;
  evidence: EvidenceItem[];
};

const SUP_LABEL: Record<string, string> = {
  observed: "Observed", assisted: "Assisted", supervised: "Supervised", independent: "Independent",
};

export default function VerifyQueue({ entries }: { entries: PendingEntry[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [commentFor, setCommentFor] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  async function act(id: string, status: "verified" | "rejected" | "changes_requested") {
    setBusy(id); setErr(null);
    const res = await fetch("/api/logbook", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, comment: commentFor === id ? comment : undefined }),
    });
    setBusy(null);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(j.error ?? "Action failed.");
      return;
    }
    setCommentFor(null); setComment("");
    router.refresh();
  }

  if (entries.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
        <p className="text-4xl mb-3">✅</p>
        <p className="font-semibold text-gray-700">Nothing awaiting verification</p>
        <p className="text-gray-400 text-sm mt-2">Workers&apos; self-logged skills appear here for your review.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {err && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}
      {entries.map(e => (
        <div key={e.id} className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-full bg-teal-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
              {e.nurseName[0] ?? "?"}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800"><b>{e.nurseName}</b> — {e.skillName}</p>
              <p className="text-[10px] text-gray-400" suppressHydrationWarning>
                {e.competencyName ? `${e.competencyName} · ` : ""}
                {SUP_LABEL[e.supervision] ?? e.supervision} · performed {new Date(e.performedAt).toLocaleDateString()}
                {e.location ? ` · ${e.location}` : ""}
              </p>
              {e.notes && <p className="text-[11px] text-gray-500 italic mt-1">&ldquo;{e.notes}&rdquo;</p>}
              <EvidencePanel entryId={e.id} initial={e.evidence} />
            </div>
          </div>
          {commentFor === e.id && (
            <input value={comment} onChange={ev => setComment(ev.target.value)} placeholder="Comment for the worker (optional)…"
              className="w-full mt-3 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/30" autoFocus />
          )}
          <div className="flex items-center gap-2 mt-3">
            <button onClick={() => act(e.id, "verified")} disabled={busy === e.id}
              className="text-xs font-semibold bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50">✓ Verify</button>
            <button onClick={() => commentFor === e.id ? act(e.id, "changes_requested") : setCommentFor(e.id)} disabled={busy === e.id}
              className="text-xs font-semibold text-amber-700 border border-amber-200 hover:bg-amber-50 px-3 py-1.5 rounded-lg disabled:opacity-50">
              {commentFor === e.id ? "Send change request" : "Request changes"}
            </button>
            <button onClick={() => commentFor === e.id ? act(e.id, "rejected") : setCommentFor(e.id)} disabled={busy === e.id}
              className="text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-lg disabled:opacity-50">
              {commentFor === e.id ? "Reject with comment" : "Reject"}
            </button>
            {commentFor === e.id && (
              <button onClick={() => { setCommentFor(null); setComment(""); }} className="text-xs text-gray-400 px-2">Cancel</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
