"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Supervisor assessment requests (XWI P2-5), from the assessor's side.
//
// An OPEN request is unclaimed and visible to every assessor in the hospital, so the first thing this has
// to do is make claiming safe: two assessors opening the inbox at the same time both see it, and only one
// should end up holding it. The route answers the loser with 409, and that is surfaced as "someone else
// took this" rather than as a generic failure -- the difference between a race the user understands and a
// bug they report.

export type RequestRow = {
  id: string;
  status: string;
  urgency: string;
  reason: string | null;
  created_at: string;
  assessor_id: string | null;
  claimed_by: string | null;
  nurse?: { full_name?: string | null } | null;
  requester?: { full_name?: string | null } | null;
  competency?: { name?: string | null } | null;
};

const ago = (iso: string) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

export default function RequestQueue({ rows, meId }: { rows: RequestRow[]; meId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; text: string; tone: "error" | "ok" } | null>(null);

  async function act(id: string, action: string) {
    setBusy(id); setMsg(null);
    try {
      const res = await fetch(`/api/competency/assessment-requests?id=${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ id, tone: "error", text: body.claimed ? "Another assessor claimed this first." : (body.error ?? "Could not update the request.") });
        // A lost race is not an error state to sit in -- refresh so the queue shows what is actually true.
        if (body.claimed) router.refresh();
        return;
      }
      router.refresh();
    } catch {
      setMsg({ id, tone: "error", text: "Network error — the request was not updated." });
    } finally { setBusy(null); }
  }

  if (!rows.length) {
    return (
      <p className="px-5 py-4 text-xs text-gray-400">
        No open requests. Supervisors raise these when a clinician needs assessing for the work the ward has.
      </p>
    );
  }

  return (
    <div className="divide-y divide-gray-50">
      {rows.map(r => {
        const mine = r.claimed_by === meId;
        const directed = r.assessor_id === meId;
        return (
          <div key={r.id} className="px-5 py-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {r.nurse?.full_name ?? "Clinician"}
                  {r.competency?.name ? <span className="font-normal text-gray-500"> — {r.competency.name}</span> : null}
                </p>
                <p className="text-[11px] text-gray-500">
                  {r.requester?.full_name ? `Requested by ${r.requester.full_name}` : "Requested"} · {ago(r.created_at)}
                  {directed ? " · directed to you" : r.assessor_id ? " · directed to another assessor" : " · open to any assessor"}
                </p>
                {r.reason && <p className="text-[11px] text-gray-600 mt-1">{r.reason}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {r.urgency === "urgent" && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]">Urgent</span>
                )}
                {r.status === "open" && (
                  <button onClick={() => act(r.id, "claim")} disabled={busy === r.id}
                    className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50">
                    {busy === r.id ? "…" : "Claim"}
                  </button>
                )}
                {r.status === "claimed" && mine && (
                  <>
                    <button onClick={() => act(r.id, "release")} disabled={busy === r.id}
                      className="text-[11px] font-medium px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50">Release</button>
                    <button onClick={() => act(r.id, "complete")} disabled={busy === r.id}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50">Mark assessed</button>
                  </>
                )}
                {r.status === "claimed" && !mine && (
                  <span className="text-[10px] text-gray-400">Claimed by another assessor</span>
                )}
              </div>
            </div>
            {msg?.id === r.id && (
              <p className={`text-[11px] mt-2 ${msg.tone === "error" ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]"}`}>{msg.text}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
