"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Task lifecycle buttons over the existing /api/operations/tasks PATCH (the
// WF-001 Task machine: assigned → accepted → in_progress → completed). Nurses
// act on their OWN tasks; verification stays a coordinator act.

const btnGhost = "px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50";

const NEXT: Record<string, { to: string; label: string }[]> = {
  created: [{ to: "accepted", label: "Accept" }],
  assigned: [{ to: "accepted", label: "Accept" }, { to: "in_progress", label: "Start" }],
  accepted: [{ to: "in_progress", label: "Start" }, { to: "completed", label: "Done" }],
  in_progress: [{ to: "completed", label: "Done" }],
};

export default function TaskActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nexts = NEXT[status] ?? [];
  if (!nexts.length) return null;

  async function move(to: string) {
    setBusy(true); setErr(null);
    const r = await fetch(`/api/operations/tasks?id=${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: to }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d.error ?? "Failed"); return; }
    router.refresh();
  }

  return (
    <span className="flex items-center gap-1.5">
      {err && <span className="text-[10px] text-amber-700">{err}</span>}
      {nexts.map(n => <button key={n.to} className={btnGhost} disabled={busy} onClick={() => move(n.to)}>{n.label}</button>)}
    </span>
  );
}
