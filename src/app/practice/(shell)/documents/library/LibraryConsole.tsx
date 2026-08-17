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

  // ⚠ `title` IS ONLY EVER PASSED BY THE CAMERA PATH, and only because a camera has no filename worth
  // keeping. Every phone hands back "image.jpg" or an IMG_ number, so deriving the title the usual way
  // fills this practice's library with documents called "image". The date is a fact about the capture,
  // not a guess about the contents -- this deliberately does NOT invent a subject for the photograph.
  // The file picker path is unchanged and still takes the name the file actually has.
  async function upload(file: File, title?: string) {
    setBusy(true); setNotice(null);
    const form = new FormData();
    form.set("file", file);
    form.set("title", title ?? file.name.replace(/\.[^.]+$/, ""));
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
              /* ══ CPR-MOB-001 s12 row 4 — "Mobile file picker/camera capture ONLY where permitted and
                   technically supported" ═══════════════════════════════════════════════════════════════
                   BOTH HALVES OF THAT ROW ARE TRUE HERE, AND EACH WAS CHECKED SEPARATELY.

                   PERMITTED: unchanged. Both controls sit inside the same `canManage && !inBin` gate the
                   Upload button has always had — library.manage, decided by the server, and the camera
                   adds no new door into this practice's storage.

                   TECHNICALLY SUPPORTED: checked against the server, not assumed. The upload path is
                   POST /api/v1/practice/library, which validates `file.type` against LIBRARY_MIME --
                   and that set contains image/jpeg, image/png and image/webp, which is exactly what a
                   phone camera produces. A capture is therefore a file this endpoint already accepts;
                   nothing on the server needed changing and nothing was changed. MAX_LIBRARY_BYTES is
                   25MB, comfortably above a phone photo, and an oversized or wrong-typed file still
                   comes back through the same error notice as before.

                   ⚠ TWO CONTROLS, NOT ONE CONTROL WITH `capture` BOLTED ON. Putting capture= on the
                   existing input would force the camera on a phone and TAKE AWAY the file picker, so a
                   practitioner could no longer upload the PDF sitting in their downloads. s12 asks for
                   picker AND capture. The camera one is md:hidden because `capture` is inert on a
                   desktop browser -- a "Take a photo" button that silently opens a file dialog is a
                   control that lies about what it does.

                   ⚠ AND THIS IS THE LIBRARY, WHICH IS NOT PATIENT DATA. The library holds the practice's
                   own documents -- protocols, blank forms, price lists. It is the ONLY upload path in
                   this workspace; there is no patient-document upload anywhere in Documents (arrivals
                   are classified, never uploaded, and s20 Phase 4's patient upload channel does not
                   exist). So no photograph taken here can be filed against a patient by this control,
                   which is the right limit for a camera button and is why it can exist at all. */
              <div className="flex flex-wrap items-center gap-1.5">
                <label className="flex cursor-pointer items-center rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 max-md:min-h-[var(--cp-touch)]">
                  Upload
                  <input type="file" className="hidden" disabled={busy}
                    onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
                </label>
                <label className="md:hidden flex cursor-pointer items-center rounded-lg border border-gray-200 px-3 text-[12px] font-semibold text-gray-700 min-h-[var(--cp-touch)]">
                  Take a photo
                  <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy}
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) upload(f, `Photo ${new Date().toISOString().slice(0, 10)}`);
                    }} />
                </label>
              </div>
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
                /* ⚠ s12 row 3, "Preview → Full-screen document preview where supported": the title IS
                   the preview control, and on a phone it already opens full screen. `open()` fetches a
                   signed URL and hands it to the browser in a new tab, so a PDF or an image fills the
                   device's own viewer with its own pinch-zoom -- which is a better reader than anything
                   this page could draw, and it is what "where supported" means. Nothing about that
                   path changed; it only needed to be big enough to hit. */
                <li key={d.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0 max-md:flex-wrap">
                  {canManage && !inBin && (
                    <input type="checkbox" checked={selected.includes(d.id)} aria-label={`Select ${d.title}`}
                      className="max-md:h-5 max-md:w-5"
                      onChange={e => setSelected(s => e.target.checked ? [...s, d.id] : s.filter(x => x !== d.id))} />
                  )}
                  <span className="min-w-0 max-md:flex-1">
                    <button type="button" onClick={() => open(d.id)}
                      className="block truncate text-[12px] font-semibold text-gray-800 hover:underline max-md:flex max-md:min-h-[var(--cp-touch)] max-md:items-center max-md:text-[13.5px]">
                      {d.title}
                    </button>
                    <span className="block text-[10px] text-gray-500">
                      {d.file_name} · {size(d.byte_size)}
                      {d.folder_id ? ` · ${folders.find((f: any) => f.id === d.folder_id)?.name ?? ""}` : " · unfiled"}
                    </span>
                  </span>
                  {canManage && (
                    /* s4's 44px floor over three text links that were about 15px tall. Purge keeps its
                       confirm() and its critical colour, and gains a border below md so the two
                       destructive-vs-not controls are not distinguished by colour alone. */
                    <span className="ml-auto shrink-0 flex gap-2 max-md:ml-0 max-md:w-full max-md:gap-1.5">
                      {inBin ? (
                        <>
                          <button type="button" disabled={busy} onClick={() => act({ documentId: d.id, action: "restore" })}
                            className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline max-md:flex max-md:flex-1 max-md:min-h-[var(--cp-touch)] max-md:items-center max-md:justify-center max-md:rounded-lg max-md:border max-md:border-gray-200 max-md:text-[13px] max-md:no-underline">
                            Restore
                          </button>
                          <button type="button" disabled={busy} onClick={() => {
                            if (confirm(`Purge "${d.title}"? The file itself is deleted and cannot be restored.`)) {
                              act({ documentId: d.id, action: "purge" });
                            }
                          }} className="text-[11px] text-[var(--cmp-text-critical)] hover:underline max-md:flex max-md:flex-1 max-md:min-h-[var(--cp-touch)] max-md:items-center max-md:justify-center max-md:rounded-lg max-md:border max-md:border-[var(--cmp-color-critical)] max-md:text-[13px] max-md:font-semibold">
                            Purge
                          </button>
                        </>
                      ) : (
                        <button type="button" disabled={busy} onClick={() => act({ documentId: d.id })}
                          className="text-[11px] text-gray-500 hover:text-[var(--cmp-text-critical)] hover:underline max-md:flex max-md:min-h-[var(--cp-touch)] max-md:items-center max-md:rounded-lg max-md:border max-md:border-gray-200 max-md:px-3 max-md:text-[13px]">
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
