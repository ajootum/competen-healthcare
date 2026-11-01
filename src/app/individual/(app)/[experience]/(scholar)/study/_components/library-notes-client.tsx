"use client";

import { useCallback, useState } from "react";

// SCHOLAR-LIBRARY-01 (owner, 1 Nov 2026): the learner's OWN notes, bookmark and highlights on one saved teaching or one
// lesson. Learner-authored, private, never AI: every write goes to api/individual/scholar/library/notes (820), which keys
// it on the caller and screens the text for patient identifiers. Nothing here calls a model.
//
// "Highlight" takes the text the learner selected INSIDE `containerId` (the lesson card or the saved teaching), at most
// 500 characters; a selection anywhere else is not taken.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const chip = `inline-flex min-h-[36px] items-center justify-center rounded-full border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const URL_NOTES = "/api/individual/scholar/library/notes";
const QUOTE_MAX = 500, BODY_MAX = 4000;

export type ClientNote = { id: string; kind: "note" | "bookmark" | "highlight"; body: string | null; quote: string | null; createdAt: string; step?: number | null; artefactId?: string | null };
export type NotesTarget =
  | { targetKind: "artefact"; artefactId: string; sessionId?: string | null; step?: number | null }
  | { targetKind: "lesson"; sessionId: string; step: number; materialId?: string | null; chunkId?: string | null };

const day = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };

async function send(method: string, body?: unknown, query = ""): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  try {
    const res = await fetch(`${URL_NOTES}${query}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch { return { ok: false, json: { error: "Competen could not be reached. Check your connection and try again." } }; }
}

/**
 * Notes for one target. `initial`: notes the server page already read (the library). Without it (Learn), they are read
 * when the learner opens the panel. `label`: the panel's summary line.
 */
export function LibraryNotes({ target, initial, containerId, label = "Your notes", allowHighlight = true, allowBookmark = true }: {
  target: NotesTarget; initial?: ClientNote[]; containerId?: string; label?: string; allowHighlight?: boolean; allowBookmark?: boolean;
}) {
  const [notes, setNotes] = useState<ClientNote[] | null>(initial ?? null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const mine = useCallback((n: ClientNote) => (target.targetKind === "lesson" ? n.step === target.step && !n.artefactId : n.artefactId === target.artefactId), [target]);

  const load = useCallback(async () => {
    const q = target.targetKind === "artefact" ? `?artefact=${encodeURIComponent(target.artefactId)}` : `?session=${encodeURIComponent(target.sessionId)}`;
    const r = await send("GET", undefined, q);
    if (!r.ok) { setMsg(typeof r.json.error === "string" ? r.json.error : "Your notes could not be read just now."); setNotes([]); return; }
    setNotes(((r.json.notes ?? []) as ClientNote[]).filter(mine));
  }, [target, mine]);
  // Read when the learner opens the panel (an event, not an effect), once.
  const toggled = (isOpen: boolean) => { setOpen(isOpen); if (isOpen && notes === null) void load(); };

  const add = async (kind: ClientNote["kind"], body: string | null, quote: string | null) => {
    setBusy(true); setMsg(null);
    const r = await send("POST", { ...target, kind, body, quote });
    setBusy(false);
    if (!r.ok) { setMsg(typeof r.json.error === "string" ? r.json.error : "That could not be saved just now."); return false; }
    if (!r.json.existing) setNotes(n => [{ id: String(r.json.id), kind, body, quote, createdAt: new Date().toISOString(), step: target.step ?? null, artefactId: target.targetKind === "artefact" ? target.artefactId : null }, ...(n ?? [])]);
    return true;
  };
  const remove = async (id: string) => {
    setBusy(true); setMsg(null);
    const r = await send("DELETE", undefined, `?id=${encodeURIComponent(id)}`);
    setBusy(false);
    if (!r.ok) { setMsg(typeof r.json.error === "string" ? r.json.error : "That could not be removed just now."); return; }
    setNotes(n => (n ?? []).filter(x => x.id !== id));
  };
  const highlight = async () => {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    const text = sel?.toString().replace(/\s+/g, " ").trim() ?? "";
    const box = containerId ? document.getElementById(containerId) : null;
    const inside = !!sel && sel.rangeCount > 0 && !!box && box.contains(sel.getRangeAt(0).commonAncestorContainer);
    if (!text || !inside) { setMsg("Select some text in this lesson first, then choose Highlight."); return; }
    if (text.length > QUOTE_MAX) { setMsg(`Select at most ${QUOTE_MAX} characters to highlight.`); return; }
    if (await add("highlight", draft.trim() || null, text)) setDraft("");
  };

  const list = notes ?? [];
  const bookmark = list.find(n => n.kind === "bookmark");
  const written = list.filter(n => n.kind !== "bookmark");
  return (
    <details className="mt-3 rounded-xl border border-gray-200" open={open} onToggle={e => toggled((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className={`flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 text-[13.5px] font-semibold text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] [&::-webkit-details-marker]:hidden ${focusRing}`}>
        {label}{notes !== null && <span className="text-[12px] font-normal text-gray-600">· {written.length}{bookmark ? " · bookmarked" : ""}</span>}
      </summary>
      <div className="border-t border-gray-200 px-3 pb-3 pt-2">
        <p className="text-[12px] text-gray-600">Written by you, private to you. Never shared, never AI.</p>
        {notes === null ? <p role="status" className="mt-2 text-[13px] text-gray-600">Reading your notes…</p> : (
          <>
            {written.length > 0 && (
              <ul className="mt-2 space-y-2">
                {written.map(n => (
                  <li key={n.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-[13.5px] text-gray-800">
                    {n.quote && <p className="border-l-4 border-amber-300 pl-2 italic"><span className="sr-only">You highlighted: </span>{n.quote}</p>}
                    {n.body && <p className="mt-1 whitespace-pre-wrap break-words">{n.body}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-gray-500">
                      <span>{n.kind === "highlight" ? "Highlight" : "Note"} · {day(n.createdAt)}</span>
                      <button type="button" className={`underline underline-offset-2 ${focusRing}`} disabled={busy} onClick={() => void remove(n.id)}>Remove</button>
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <label className="mt-2 block text-[12.5px] font-semibold text-gray-800" htmlFor={`note-${containerId ?? "x"}`}>Add a note</label>
            <textarea id={`note-${containerId ?? "x"}`} value={draft} maxLength={BODY_MAX} rows={2} onChange={e => setDraft(e.target.value)}
              className={`mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[14px] ${focusRing}`} placeholder="Your own words: what to remember, a question to ask" />
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={chip} disabled={busy || !draft.trim()} onClick={() => void add("note", draft.trim(), null).then(ok => ok && setDraft(""))}>Save note</button>
              {allowHighlight && containerId && <button type="button" className={chip} disabled={busy} onClick={() => void highlight()}>Highlight selected text</button>}
              {allowBookmark && (bookmark
                ? <button type="button" className={chip} aria-pressed="true" disabled={busy} onClick={() => void remove(bookmark.id)}>Bookmarked · Remove bookmark</button>
                : <button type="button" className={chip} aria-pressed="false" disabled={busy} onClick={() => void add("bookmark", null, null)}>Bookmark for revision</button>)}
            </div>
          </>
        )}
        {msg && <p role="status" className="mt-2 text-[13px] text-gray-800">{msg}</p>}
      </div>
    </details>
  );
}
