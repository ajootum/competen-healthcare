"use client";

import { useState, useEffect, useCallback } from "react";

// CAP-001 Phase 4 — per-asset file panel. Lists an asset's binary files (each via a short-lived signed URL),
// and lets a super-admin upload or remove them. Rendered inline under an expanded row in the Asset Browser.

type FileRow = { id: string; file_name: string; mime_type: string | null; size_bytes: number | null; uploaded_by_name: string | null; created_at: string; url: string | null };

function fmtSize(n: number | null) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function AssetFiles({ objectType, objectId }: { objectType: string; objectId: string }) {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/admin/assets/files?type=${encodeURIComponent(objectType)}&id=${encodeURIComponent(objectId)}`);
    const j = await r.json().catch(() => ({ files: [] }));
    setLoading(false);
    setErr(j.migration ? "Run migration 141 to enable asset files." : j.error ?? null);
    setFiles(j.files ?? []);
  }, [objectType, objectId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr(null);
    const fd = new FormData();
    fd.append("file", file); fd.append("object_type", objectType); fd.append("object_id", objectId);
    const r = await fetch("/api/admin/assets/files", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    e.target.value = "";
    if (!r.ok) { setErr(j.error ?? "Upload failed"); return; }
    load();
  }

  async function del(id: string) {
    setBusy(true);
    await fetch(`/api/admin/assets/files?id=${id}`, { method: "DELETE" });
    setBusy(false);
    load();
  }

  return (
    <div className="border border-gray-100 rounded-lg bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Files</p>
        <label className={`text-[11px] font-semibold rounded-lg px-2.5 py-1 cursor-pointer ${busy ? "opacity-50 pointer-events-none" : "text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100"}`}>
          {busy ? "Working…" : "+ Upload"}
          <input type="file" className="hidden" onChange={upload} disabled={busy} />
        </label>
      </div>
      {err && <p className="text-[11px] text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded px-2 py-1 mb-2">{err}</p>}
      {loading ? (
        <p className="text-[11px] text-gray-400">Loading…</p>
      ) : files.length === 0 ? (
        <p className="text-[11px] text-gray-400">No files attached. Upload documents, images or video for this asset (≤ 50 MB).</p>
      ) : (
        <div className="flex flex-col divide-y divide-gray-50">
          {files.map(f => (
            <div key={f.id} className="flex items-center gap-2 py-1.5">
              <span className="text-sm shrink-0">📄</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-800 truncate">{f.file_name}</p>
                <p className="text-[10px] text-gray-400">{fmtSize(f.size_bytes)}{f.uploaded_by_name ? ` · ${f.uploaded_by_name}` : ""}</p>
              </div>
              {f.url && <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-teal-700 hover:underline shrink-0">Download</a>}
              <button onClick={() => del(f.id)} disabled={busy} className="text-[11px] font-semibold text-rose-400 hover:text-[var(--cmp-text-error)] disabled:opacity-40 shrink-0">Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
