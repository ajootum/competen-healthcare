"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Collaboration console controls (PCS-000 Collaboration). Composer posts a platform
// note through /api/platform/comments; the per-row delete soft-deletes (author or
// super). Thin client — all persistence + audit is server-side.

export function NoteComposer() {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function post() {
    if (!body.trim()) { setErr("Write something first"); return; }
    setBusy(true); setErr(null);
    const res = await fetch("/api/platform/comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity_type: "platform_note", body }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Failed"); setBusy(false); return; }
    setBody(""); setBusy(false); router.refresh();
  }

  return (
    <div className="space-y-2">
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={2} placeholder="Post a platform note… (use @name to mention — mentions wire to entity pages next)" className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 focus:border-teal-400 focus:outline-none" />
      {err && <p className="text-[10px] text-rose-600">{err}</p>}
      <div className="flex justify-end"><button onClick={post} disabled={busy} className="text-xs font-semibold rounded-lg py-2 px-4 bg-teal-600 text-white disabled:opacity-50">{busy ? "Posting…" : "Post note"}</button></div>
    </div>
  );
}

export function DeleteComment({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function del() {
    if (!window.confirm("Soft-delete this comment? It's hidden from feeds but the record is kept.")) return;
    setBusy(true);
    const res = await fetch(`/api/platform/comments?id=${id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) router.refresh();
  }
  return <button onClick={del} disabled={busy} className="text-[10px] text-gray-300 hover:text-rose-500 disabled:opacity-50" title="Soft-delete (moderation)">✕</button>;
}
