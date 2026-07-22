"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// POS-001D approval queue — approve/reject pending items from both sources, and
// submit a request against any workflow to exercise the engine.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default function ApprovalQueue({ queue, workflows, canAct }: { queue: any[]; workflows: any[]; canAct: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [wf, setWf] = useState(workflows[0]?.key ?? "");
  const [name, setName] = useState("");
  const toast = (k: "ok" | "err", t: string) => { setMsg({ k, t }); setTimeout(() => setMsg(null), 4000); };

  async function act(item: any, decision: "approved" | "rejected") {
    setBusy(item.id + decision);
    try {
      const r = await fetch(`/api/platform/approvals?id=${encodeURIComponent(item.id)}&source=${item.source}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { toast("ok", `${item.entityName ?? item.workflow}: ${j.status}${j.step && j.status === "pending" ? ` (advanced to ${j.step})` : ""}`); router.refresh(); }
      else toast("err", j.error ?? "Failed");
    } catch { toast("err", "Request failed"); }
    setBusy(null);
  }

  async function submit() {
    if (!wf) return;
    setBusy("submit");
    try {
      const r = await fetch("/api/platform/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflow_key: wf, entity_name: name.trim() || undefined }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { toast("ok", "Approval request opened"); setName(""); router.refresh(); }
      else toast("err", j.error ?? "Failed");
    } catch { toast("err", "Request failed"); }
    setBusy(null);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900 mr-auto">Approval Queue <span className="text-gray-400 font-normal text-sm">({queue.length})</span></h2>
        {msg && <span className={`text-xs rounded-lg px-2.5 py-1 ${msg.k === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{msg.t}</span>}
        {canAct && (
          <div className="flex items-center gap-2">
            <select value={wf} onChange={e => setWf(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">{workflows.map(w => <option key={w.key} value={w.key}>{w.name}</option>)}</select>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Entity name (optional)" className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-44" />
            <button onClick={submit} disabled={busy === "submit"} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-3 py-1.5 disabled:opacity-60">Submit</button>
          </div>
        )}
      </div>

      {queue.length === 0 ? <p className="text-sm text-gray-400 py-10 text-center">✅ No pending approvals.</p> : (
        <div className="divide-y divide-gray-50">
          {queue.map((item: any) => (
            <div key={`${item.source}:${item.id}`} className="flex items-center gap-3 px-4 py-3">
              <span className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center text-base shrink-0">{item.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900 truncate">{item.entityName ?? item.workflow}</span>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{item.workflow}</span>
                  <span className="text-[10px] text-gray-400">{item.step}</span>
                </div>
                <p className="text-[11px] text-gray-400 truncate">{(item.entityType ?? "").replace(/_/g, " ")}{item.requestedBy ? ` · by ${item.requestedBy}` : ""}</p>
              </div>
              {canAct ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => act(item, "approved")} disabled={busy?.startsWith(item.id)} className="text-[11px] font-medium rounded-lg border border-green-200 text-green-700 hover:bg-green-50 px-2.5 py-1 disabled:opacity-40">Approve</button>
                  <button onClick={() => act(item, "rejected")} disabled={busy?.startsWith(item.id)} className="text-[11px] font-medium rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 px-2.5 py-1 disabled:opacity-40">Reject</button>
                </div>
              ) : <span className="text-[10px] text-gray-400 shrink-0">pending</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
