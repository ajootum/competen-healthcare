"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Governance Dashboard approval queue (GOV-001.1 deepening) — decide pending
// requests IN PLACE via PATCH /api/platform/approvals?id=…&source=… with
// {decision: "approved"|"rejected"} (the engine enum; per-step decisions are
// audited; multi-step requests advance rather than finalise). The submitter of
// framework content approvals still cannot decide their own (server-enforced
// on that pipeline); the engine queue here is super_admin territory.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Item = { id: string; source: string; title: string; sub: string; step: string | null; by: string | null; at: string };

const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };

export default function GovernanceQueue({ queue }: { queue: Item[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 5000); };

  async function decide(item: Item, decision: "approved" | "rejected") {
    setBusyId(item.id);
    try {
      const r = await fetch(`/api/platform/approvals?id=${encodeURIComponent(item.id)}&source=${encodeURIComponent(item.source)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (r.ok) {
        toast("ok", j.status === "pending" ? `Approved — advanced to ${j.step}` : `${item.title}: ${j.status ?? decision}`);
        router.refresh();
      } else toast("err", j.error ?? "Decision failed");
    } catch { toast("err", "Network error — nothing was decided"); }
    finally { setBusyId(null); }
  }

  if (queue.length === 0) return <p className="text-sm text-gray-400 py-6 text-center">Queue is clear.</p>;

  return (
    <div>
      {msg && <p className={`text-xs rounded-lg px-2.5 py-1.5 mb-2 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</p>}
      <div className="divide-y divide-gray-50">
        {queue.map(q => (
          <div key={`${q.source}-${q.id}`} className="py-2">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-800 leading-tight truncate">{q.title}</p>
                <p className="text-[10px] text-gray-400 capitalize">{q.sub}{q.step ? ` · ${q.step}` : ""}{q.by ? ` · ${q.by}` : ""} · {relTime(q.at)}</p>
              </div>
              <button onClick={() => decide(q, "approved")} disabled={busyId !== null}
                className="text-[11px] font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg px-2.5 py-1 disabled:opacity-50 shrink-0">
                {busyId === q.id ? "…" : "Approve"}
              </button>
              <button onClick={() => decide(q, "rejected")} disabled={busyId !== null}
                className="text-[11px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg px-2.5 py-1 disabled:opacity-50 shrink-0">
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
