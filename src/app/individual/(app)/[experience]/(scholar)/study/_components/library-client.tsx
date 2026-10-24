"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SCHOLAR } from "@/lib/individual/experiences";

// COMPETEN-SCHOLAR-UPLOAD-01 U5, the student organising their own library: rename a material, put it on one
// of their collections, make or remove a collection, and correct the topics Scholar found in a section. Each
// calls a gate-3 route keyed on the caller's own id and shows what it says. Nothing here touches a shared
// competency catalogue.

const accent = SCHOLAR.accent;
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const small = `inline-flex items-center justify-center rounded-lg border px-2.5 py-1 text-[12.5px] font-semibold disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const input = `block w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-[14px] text-gray-900 ${focusRing}`;

async function send(url: string, body: unknown, method = "POST"): Promise<{ ok: boolean; json: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, json: { error: "Competen could not be reached. Check your connection and try again." } };
  }
}

export type CollectionOption = { id: string; name: string };

/** Rename a material and choose its collection. `collections` null: collections are not available here (407 absent). */
export function OrganiseMaterial({ id, title, collectionId, collections }: { id: string; title: string; collectionId: string | null; collections: CollectionOption[] | null }) {
  const router = useRouter();
  const [name, setName] = useState(title);
  const [shelf, setShelf] = useState(collectionId ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = name.trim() !== title || (collections !== null && (shelf || null) !== collectionId);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || busy) return;
    setBusy(true); setMsg(null);
    const body: Record<string, unknown> = {};
    if (name.trim() !== title) body.title = name;
    if (collections !== null && (shelf || null) !== collectionId) body.collectionId = shelf || null;
    const r = await send(`/api/individual/scholar/materials/${id}`, body, "PATCH");
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.json.error ?? "Your change could not be saved." }); return; }
    setMsg({ ok: true, text: "Saved." });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-2" aria-label={`Organise ${title}`}>
      <div className="min-w-[200px] flex-1">
        <label htmlFor={`name-${id}`} className="block text-[12.5px] font-semibold text-gray-700">Name</label>
        <input id={`name-${id}`} value={name} maxLength={120} onChange={e => setName(e.target.value)} className={`mt-1 ${input}`} />
      </div>
      {collections !== null && (
        <div className="min-w-[180px]">
          <label htmlFor={`shelf-${id}`} className="block text-[12.5px] font-semibold text-gray-700">Collection</label>
          <select id={`shelf-${id}`} value={shelf} onChange={e => setShelf(e.target.value)} className={`mt-1 ${input}`}>
            <option value="">None</option>
            {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      <button type="submit" className={`${small} border-gray-300 bg-white text-gray-800 hover:bg-gray-50`} disabled={!dirty || busy}>{busy ? "Saving…" : "Save"}</button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`w-full text-[12.5px] font-medium ${msg.ok ? "text-emerald-800" : "text-red-700"}`}>{msg.text}</p>}
    </form>
  );
}

/** Make and remove collections. Removing one keeps its materials. */
export function CollectionsManager({ collections }: { collections: CollectionOption[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy("new"); setError("");
    const r = await send("/api/individual/scholar/collections", { name });
    setBusy("");
    if (!r.ok) { setError(r.json.error ?? "The collection could not be made."); return; }
    setName("");
    router.refresh();
  }
  async function remove(c: CollectionOption) {
    if (busy || !window.confirm(`Remove the collection "${c.name}"? Its materials are kept.`)) return;
    setBusy(c.id); setError("");
    const r = await send("/api/individual/scholar/collections", { id: c.id }, "DELETE");
    setBusy("");
    if (!r.ok) { setError(r.json.error ?? "The collection could not be removed."); return; }
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <h3 className="text-[14px] font-bold text-gray-900">Collections</h3>
      <p className="mt-0.5 text-[12.5px] text-gray-600">Shelves for your own materials, such as a module or a placement. Only you see them.</p>
      {collections.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {collections.map(c => (
            <li key={c.id} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 py-0.5 pl-2.5 pr-1 text-[12.5px] text-gray-800">
              {c.name}
              <button type="button" onClick={() => remove(c)} disabled={!!busy} aria-label={`Remove the collection ${c.name}`}
                className={`rounded-full px-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-900 ${focusRing}`}>×</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={create} className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <label htmlFor="new-collection" className="block text-[12.5px] font-semibold text-gray-700">New collection</label>
          <input id="new-collection" value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="For example: Respiratory module" className={`mt-1 ${input}`} />
        </div>
        <button type="submit" className={`${small} border-gray-300 bg-white text-gray-800 hover:bg-gray-50`} disabled={!name.trim() || !!busy}>{busy === "new" ? "Saving…" : "Add"}</button>
      </form>
      {error && <p role="alert" className="mt-2 text-[12.5px] font-medium text-red-700">{error}</p>}
    </div>
  );
}

/** Correct the topics Scholar found in one section. The AI list is kept as the record; the student sees theirs. */
export function TopicEditor({ chunkId, topics, corrected }: { chunkId: string; topics: string[]; corrected: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(topics.join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const r = await send("/api/individual/scholar/topics", { chunkId, topics: text.split("\n") });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "Your topics could not be saved."); return; }
    setOpen(false);
    router.refresh();
  }
  async function reset() {
    setBusy(true); setError("");
    const r = await send("/api/individual/scholar/topics", { chunkId }, "DELETE");
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "Your topics could not be reset."); return; }
    router.refresh();
  }

  if (!open) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        {corrected && <span className="text-[12px] font-semibold" style={{ color: accent }}>Corrected by you</span>}
        <button type="button" className={`${small} border-gray-300 bg-white text-gray-800 hover:bg-gray-50`} onClick={() => { setText(topics.join("\n")); setOpen(true); }}>Correct topics</button>
        {corrected && <button type="button" className={`${small} border-gray-300 bg-white text-gray-800 hover:bg-gray-50`} disabled={busy} onClick={reset}>Use Scholar&apos;s topics</button>}
        {error && <span role="alert" className="text-[12.5px] font-medium text-red-700">{error}</span>}
      </span>
    );
  }
  return (
    <form onSubmit={save} className="mt-2 w-full">
      <label htmlFor={`topics-${chunkId}`} className="block text-[12.5px] font-semibold text-gray-700">Topics in this section, one per line</label>
      <textarea id={`topics-${chunkId}`} rows={4} value={text} onChange={e => setText(e.target.value)} className={`mt-1 ${input}`} />
      <p className="mt-1 text-[12px] text-gray-500">Up to 12. Your list replaces Scholar&apos;s for you; what Scholar suggested is kept as a record.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="submit" className={`${small} text-white`} style={{ background: accent, borderColor: accent }} disabled={busy}>{busy ? "Saving…" : "Save topics"}</button>
        <button type="button" className={`${small} border-gray-300 bg-white text-gray-800 hover:bg-gray-50`} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {error && <p role="alert" className="mt-2 text-[12.5px] font-medium text-red-700">{error}</p>}
    </form>
  );
}
