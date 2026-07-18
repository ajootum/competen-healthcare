"use client";

import { useRef, useState } from "react";

// Reusable evidence attach/view strip (§E). Files upload through /api/evidence
// into the private bucket; viewing opens a short-lived signed URL. Used on
// logbook entries (owner attaches, verifiers view) and credentials.

export type EvidenceItem = {
  id: string; file_name: string; mime_type: string; size_bytes: number;
  note?: string | null; created_at: string;
};

const fmtSize = (b: number) => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

export default function EvidencePanel({ entryId, credentialId, initial, canAttach }: {
  entryId?: string; credentialId?: string; initial: EvidenceItem[]; canAttach?: boolean;
}) {
  const [items, setItems] = useState<EvidenceItem[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true); setError(null);
    const form = new FormData();
    form.append("file", file);
    if (entryId) form.append("skill_log_entry_id", entryId);
    if (credentialId) form.append("credential_id", credentialId);
    const res = await fetch("/api/evidence", { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.evidence) setItems(prev => [...prev, body.evidence]);
    else setError(body.error ?? "Upload failed");
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function view(id: string) {
    const res = await fetch(`/api/evidence?id=${id}`);
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.url) window.open(body.url, "_blank", "noopener");
    else setError(body.error ?? "Could not open the file");
  }

  async function remove(id: string) {
    setBusy(true); setError(null);
    const res = await fetch(`/api/evidence?id=${id}`, { method: "DELETE" });
    if (res.ok) setItems(prev => prev.filter(i => i.id !== id));
    else setError((await res.json().catch(() => ({}))).error ?? "Delete failed");
    setBusy(false);
  }

  if (!canAttach && items.length === 0) return null;

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {items.map(i => (
          <span key={i.id} className="inline-flex items-center gap-1 bg-gray-50 border border-gray-100 rounded-lg pl-1.5 pr-1 py-0.5">
            <button onClick={() => view(i.id)} title={`${i.file_name} · ${fmtSize(i.size_bytes)}`}
              className="text-[10px] text-teal-700 hover:underline max-w-[140px] truncate">
              📎 {i.file_name}
            </button>
            {canAttach && (
              <button onClick={() => remove(i.id)} disabled={busy} title="Remove"
                className="text-[10px] text-gray-300 hover:text-red-500 px-0.5">✕</button>
            )}
          </span>
        ))}
        {canAttach && (
          <>
            <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
            <button onClick={() => fileRef.current?.click()} disabled={busy}
              className="text-[10px] font-semibold text-gray-400 hover:text-teal-700 border border-dashed border-gray-200 hover:border-teal-300 rounded-lg px-2 py-0.5 transition-colors disabled:opacity-50">
              {busy ? "Uploading…" : "＋ Attach evidence"}
            </button>
          </>
        )}
      </div>
      {error && <p className="text-[10px] text-red-500 mt-1">{error}</p>}
    </div>
  );
}
