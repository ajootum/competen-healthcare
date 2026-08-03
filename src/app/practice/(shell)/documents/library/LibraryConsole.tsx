"use client";

import { useState } from "react";
import Link from "next/link";

// CPR-320's library, folders, bulk move and recycle bin.
//
// THE COMP'S "STORAGE USED 2.4 GB OF 10 GB (24%)" IS A QUOTA, AND THERE IS NO QUOTA. The bytes are real
// and are shown; the denominator and the bar are not. A progress bar against a limit nobody set is a
// warning that will never fire and a reassurance that means nothing.
//
// THE RECYCLE BIN IS FOR THIS LIBRARY ONLY. A clinical document is marked entered-in-error and kept
// forever -- a "restore" on one would imply it had been gone, which is a claim about the record that is
// not true. The engine refuses to confuse them and says why.

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const card = "rounded-xl border border-gray-200 bg-white p-4";

/* eslint-disable @typescript-eslint/no-explicit-any */

const size = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export default function LibraryConsole({
  documents, folders, summary, activeFolder, query, inBin, canManage,
}: {
  documents: any[]; folders: any[]; summary: any;
  activeFolder: string; query: string; inBin: boolean; canManage: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [newFolder, setNewFolder] = useState("");

  async function act(body: unknown) {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/library", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice({ kind: "err", text: data?.error?.message ?? data?.error ?? "That did not work." });
      setBusy(false); return;
    }
    // A bulk result reports both numbers, so "12 moved" out of 14 selected cannot read as complete.
    if (data.requested !== undefined && data.moved !== data.requested) {
      setNotice({ kind: "err", text: `${data.moved} of ${data.requested} moved. The rest were not found here.` });
      setBusy(false); return;
    }
    window.location.reload();
  }

  async function open(id: string) {
    const res = await fetch(`/api/v1/practice/library?id=${id}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) window.open(data.url, "_blank", "noopener");
    else setNotice({ kind: "err", text: "That file could not be opened." });
  }

  async function upload(file: File) {
    setBusy(true); setNotice(null);
    const form = new FormData();
    form.set("file", file);
    form.set("title", file.name.replace(/\.[^.]+$/, ""));
    if (activeFolder) form.set("folderId", activeFolder);
    const res = await fetch("/api/v1/practice/library", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setNotice({ kind: "err", text: data?.error?.message ?? data?.error ?? "That did not upload." }); setBusy(false); return; }
    window.location.reload();
  }

  async function addFolder() {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/library", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newFolder }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setNotice({ kind: "err", text: data?.error?.message ?? "That did not work." }); setBusy(false); return; }
    window.location.reload();
  }

  const href = (params: Record<string, string>) => {
    const q = new URLSearchParams({ ...(inBin ? { bin: "1" } : {}), ...params });
    [...q.entries()].forEach(([k, v]) => { if (!v) q.delete(k); });
    return `/practice/documents/library${q.toString() ? `?${q}` : ""}`;
  };

  return (
    <>
      {notice && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-[12px] ${
          notice.kind === "ok" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
            : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Documents</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{summary.totalFiles}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">{summary.folders.length} folders</p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Storage used</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{size(summary.totalBytes)}</p>
          {/* No bar, no denominator. See the header. */}
          <p className="mt-0.5 text-[10px] text-gray-500">No storage limit is set on this practice.</p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Unfiled</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{summary.unfiled.files}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">in no folder</p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">In the bin</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{summary.binned}</p>
          <Link href={inBin ? "/practice/documents/library" : "/practice/documents/library?bin=1"}
            className="mt-0.5 block text-[10px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
            {inBin ? "Back to the library" : "Open the bin"}
          </Link>
        </div>
      </div>

      <div className="mt-4 grid lg:grid-cols-4 gap-4 items-start">
        {/* Folders */}
        <section className={card}>
          <h2 className="text-[13px] font-bold text-gray-900">Folders</h2>
          <ul className="mt-2 flex flex-col">
            <li>
              <Link href={href({})} className={`block py-1 text-[12px] ${!activeFolder ? "font-bold text-[var(--cp-primary-deep)]" : "text-gray-700 hover:underline"}`}>
                Everything <span className="text-gray-400">({summary.totalFiles})</span>
              </Link>
            </li>
            {folders.map((f: any) => (
              <li key={f.id} className="flex items-baseline gap-1">
                <Link href={href({ folderId: f.id })}
                  className={`block flex-1 truncate py-1 text-[12px] ${activeFolder === f.id ? "font-bold text-[var(--cp-primary-deep)]" : "text-gray-700 hover:underline"}`}>
                  {f.name} <span className="text-gray-400">({summary.folders.find((x: any) => x.id === f.id)?.files ?? 0})</span>
                </Link>
                {canManage && (
                  <button type="button" disabled={busy} onClick={async () => {
                    if (!confirm(`Delete the folder "${f.name}"? Its documents stay in the library, unfiled.`)) return;
                    setBusy(true);
                    await fetch(`/api/v1/practice/library?folderId=${f.id}`, { method: "DELETE" });
                    window.location.reload();
                  }} className="text-[10px] text-gray-400 hover:text-[var(--cmp-text-critical)]" aria-label={`Delete ${f.name}`}>
                    &times;
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canManage && (
            <div className="mt-2 flex gap-1">
              <input value={newFolder} onChange={e => setNewFolder(e.target.value)} placeholder="New folder"
                className={input} />
              <button type="button" disabled={busy || !newFolder.trim()} onClick={addFolder}
                className="rounded-lg border border-gray-200 px-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                Add
              </button>
            </div>
          )}
          <p className="mt-2 text-[10px] text-gray-500">
            Deleting a folder leaves its documents in the library, unfiled. Tidying is not deleting.
          </p>
        </section>

        {/* Documents */}
        <section className={`${card} lg:col-span-3`}>
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 className="text-[13px] font-bold text-gray-900">{inBin ? "Recycle bin" : "Documents"}</h2>
            {canManage && !inBin && (
              <label className="cursor-pointer rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                Upload
                <input type="file" className="hidden" disabled={busy}
                  onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
              </label>
            )}
          </div>

          {inBin && (
            <p className="mt-0.5 text-[11px] text-gray-500">
              Documents removed from the library. Clinical records never come here &mdash; those are
              marked entered in error and kept.
            </p>
          )}

          <form className="mt-2" action="/practice/documents/library">
            {inBin && <input type="hidden" name="bin" value="1" />}
            {activeFolder && <input type="hidden" name="folderId" value={activeFolder} />}
            <input name="q" defaultValue={query} placeholder="Search titles" className={input} />
          </form>

          {canManage && !inBin && selected.length > 0 && (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-gray-50 px-2 py-1.5">
              <span className="text-[11px] text-gray-600">{selected.length} selected</span>
              <select className={`${input} w-48`} defaultValue=""
                // "none" is the sentinel for unfiling, because "" is already the disabled placeholder.
                // Passing it through as a folder id would look up a folder called "none" and fail.
                onChange={e => { if (e.target.value !== "") act({ documentIds: selected, folderId: e.target.value === "none" ? null : e.target.value }); }}>
                <option value="" disabled>Move to&hellip;</option>
                <option value="none">No folder</option>
                {folders.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <button type="button" onClick={() => setSelected([])}
                className="ml-auto text-[11px] text-gray-500 hover:underline">Clear</button>
            </div>
          )}

          {documents.length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-400">
              {inBin ? "The bin is empty." : query ? "Nothing matches." : "Nothing here yet."}
            </p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {documents.map((d: any) => (
                <li key={d.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                  {canManage && !inBin && (
                    <input type="checkbox" checked={selected.includes(d.id)} aria-label={`Select ${d.title}`}
                      onChange={e => setSelected(s => e.target.checked ? [...s, d.id] : s.filter(x => x !== d.id))} />
                  )}
                  <span className="min-w-0">
                    <button type="button" onClick={() => open(d.id)}
                      className="block truncate text-[12px] font-semibold text-gray-800 hover:underline">
                      {d.title}
                    </button>
                    <span className="block text-[10px] text-gray-500">
                      {d.file_name} · {size(d.byte_size)}
                      {d.folder_id ? ` · ${folders.find((f: any) => f.id === d.folder_id)?.name ?? ""}` : " · unfiled"}
                    </span>
                  </span>
                  {canManage && (
                    <span className="ml-auto shrink-0 flex gap-2">
                      {inBin ? (
                        <>
                          <button type="button" disabled={busy} onClick={() => act({ documentId: d.id, action: "restore" })}
                            className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                            Restore
                          </button>
                          <button type="button" disabled={busy} onClick={() => {
                            if (confirm(`Purge "${d.title}"? The file itself is deleted and cannot be restored.`)) {
                              act({ documentId: d.id, action: "purge" });
                            }
                          }} className="text-[11px] text-[var(--cmp-text-critical)] hover:underline">
                            Purge
                          </button>
                        </>
                      ) : (
                        <button type="button" disabled={busy} onClick={() => act({ documentId: d.id })}
                          className="text-[11px] text-gray-500 hover:text-[var(--cmp-text-critical)] hover:underline">
                          Remove
                        </button>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
