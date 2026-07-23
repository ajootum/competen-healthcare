"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import { useRouter } from "next/navigation";

// AI Scheduling Engine roster controls (WSE-001B). Generate runs the solver + persists a
// draft; Publish approves it (a below-safe-coverage roster prompts for an override reason
// before publishing, per business rules). All through the audited /api/operations/rosters.
export default function RosterControls({ week, roster }: { week: string; roster: any | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function generate() {
    setBusy("gen"); setErr(null); setMsg(null);
    const res = await fetch("/api/operations/rosters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ week_start: week }) });
    setBusy(null);
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Failed"); return; }
    const j = await res.json(); setMsg(`Draft generated — ${j.slots_filled}/${j.slots_total} posts filled (${j.coverage ?? 0}% coverage).`); router.refresh();
  }

  async function publish(override?: string) {
    setBusy("pub"); setErr(null); setMsg(null);
    const res = await fetch(`/api/operations/rosters?id=${roster.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "publish", override_reason: override }) });
    if (res.status === 422) {
      setBusy(null);
      const reason = window.prompt("Coverage is below the safe threshold. Enter an override reason to publish anyway:", "");
      if (reason === null || !reason.trim()) return;
      return publish(reason.trim());
    }
    setBusy(null);
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Failed"); return; }
    setMsg("Roster published to operational workspaces."); router.refresh();
  }

  async function del() {
    if (!window.confirm("Discard this draft roster?")) return;
    setBusy("del"); setErr(null);
    const res = await fetch(`/api/operations/rosters?id=${roster.id}`, { method: "DELETE" });
    setBusy(null);
    if (res.ok) router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {(!roster || roster.status !== "published") && <button onClick={generate} disabled={!!busy} className="text-xs font-semibold rounded-lg py-2 px-3 bg-emerald-600 text-white disabled:opacity-50">{busy === "gen" ? "Generating…" : roster ? "↻ Regenerate" : "✨ Generate Roster"}</button>}
      {roster?.status === "draft" && <button onClick={() => publish()} disabled={!!busy} className="text-xs font-semibold rounded-lg py-2 px-3 border border-emerald-300 text-emerald-700 disabled:opacity-50">{busy === "pub" ? "Publishing…" : "Publish & Approve"}</button>}
      {roster?.status === "draft" && <button onClick={del} disabled={!!busy} className="text-xs font-semibold rounded-lg py-2 px-2 border border-gray-200 text-gray-500 disabled:opacity-50" title="Discard draft">✕</button>}
      {roster?.status === "published" && <span className="text-xs font-semibold rounded-lg py-2 px-3 bg-emerald-50 text-emerald-700">✓ Published</span>}
      {(err || msg) && <span className={`text-[10px] ${err ? "text-rose-600" : "text-emerald-600"} max-w-[220px]`}>{err ?? msg}</span>}
    </div>
  );
}
