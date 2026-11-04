"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { noteDatesLabel } from "@/lib/individual/scholar/library-organise";
import { DictateButton } from "@/app/individual/_components/speech/speech-buttons";

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

export type ClientNote = { id: string; kind: "note" | "bookmark" | "highlight" | "summary"; body: string | null; quote: string | null; createdAt: string; updatedAt?: string | null; step?: number | null; artefactId?: string | null };
export type NotesTarget =
  | { targetKind: "artefact"; artefactId: string; sessionId?: string | null; step?: number | null }
  | { targetKind: "lesson"; sessionId: string; step: number; materialId?: string | null; chunkId?: string | null };

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
    if (!r.json.existing) setNotes(n => [{ id: String(r.json.id), kind, body, quote, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), step: target.step ?? null, artefactId: target.targetKind === "artefact" ? target.artefactId : null }, ...(n ?? [])]);
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
                  <li key={n.id}><NoteEntry note={n} busy={busy} onRemove={id => void remove(id)} onChanged={c => setNotes(all => (all ?? []).map(x => (x.id === c.id ? c : x)))} /></li>
                ))}
              </ul>
            )}
            <label className="mt-2 block text-[12.5px] font-semibold text-gray-800" htmlFor={`note-${containerId ?? "x"}`}>Add a note</label>
            <textarea id={`note-${containerId ?? "x"}`} value={draft} maxLength={BODY_MAX} rows={2} onChange={e => setDraft(e.target.value)}
              className={`mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[14px] ${focusRing}`} placeholder="Your own words: what to remember, a question to ask" />
            <DictateButton fieldId={`note-${containerId ?? "x"}`} onValue={setDraft} disabled={busy} className="mt-2" />
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

/**
 * One note or highlight: its words, when it was written and last edited, and Edit / Remove. Edit is in place (PATCH the text; a highlight
 * keeps its quote and changes only the comment). Remove asks once. Learner text, private, never AI.
 */
export function NoteEntry({ note, busy = false, onRemove, onChanged, attached }: {
  note: ClientNote; busy?: boolean; onRemove: (id: string) => void; onChanged: (n: ClientNote) => void; attached?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.body ?? "");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const needsText = note.kind === "note" || note.kind === "summary";
  const save = async () => {
    const body = text.trim();
    if (needsText && !body) { setMsg("A note needs some words. Remove it instead if you no longer want it."); return; }
    setSaving(true); setMsg(null);
    const r = await send("PATCH", { id: note.id, body: body || null });
    setSaving(false);
    if (!r.ok) { setMsg(typeof r.json.error === "string" ? r.json.error : "That could not be saved just now."); return; }
    onChanged({ ...note, body: body || null, updatedAt: new Date().toISOString() });
    setEditing(false);
  };
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-[13.5px] text-gray-800">
      {note.quote && <p className="break-words border-l-4 border-amber-300 pl-2 italic"><span className="sr-only">You highlighted: </span>{note.quote}</p>}
      {editing ? (
        <div className="mt-1">
          <label className="block text-[12.5px] font-semibold text-gray-800" htmlFor={`edit-${note.id}`}>{note.kind === "highlight" ? "Your comment on the highlight" : note.kind === "summary" ? "Edit your summary" : "Edit your note"}</label>
          <textarea id={`edit-${note.id}`} value={text} maxLength={BODY_MAX} rows={3} onChange={e => setText(e.target.value)}
            className={`mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[14px] ${focusRing}`} />
          <DictateButton fieldId={`edit-${note.id}`} onValue={setText} disabled={saving} className="mt-2" />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={chip} disabled={saving} onClick={() => void save()}>Save changes</button>
            <button type="button" className={chip} disabled={saving} onClick={() => { setEditing(false); setText(note.body ?? ""); setMsg(null); }}>Cancel</button>
          </div>
        </div>
      ) : note.body && <p className="mt-1 whitespace-pre-wrap break-words">{note.body}</p>}
      {attached && <p className="mt-1 break-words text-[12px] text-gray-600">{attached}</p>}
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-gray-600">
        <span>{note.kind === "highlight" ? "Highlight" : note.kind === "summary" ? "Your summary" : "Note"} · {noteDatesLabel(note.createdAt, note.updatedAt)}</span>
        {!editing && <button type="button" className={`${linkBtn} ${focusRing}`} disabled={busy || saving} onClick={() => { setText(note.body ?? ""); setEditing(true); }}>{note.kind === "highlight" && !note.body ? "Add a comment" : "Edit"}<span className="sr-only"> this {note.kind}</span></button>}
        {confirming ? (
          <span role="group" aria-label="Remove this note?" className="inline-flex items-center gap-2">
            <button type="button" className={`${linkBtn} font-bold ${focusRing}`} disabled={busy} onClick={() => { setConfirming(false); onRemove(note.id); }}>Yes, remove it</button>
            <button type="button" className={`${linkBtn} ${focusRing}`} onClick={() => setConfirming(false)}>Keep it</button>
          </span>
        ) : <button type="button" className={`${linkBtn} ${focusRing}`} disabled={busy || saving} onClick={() => setConfirming(true)}>Remove<span className="sr-only"> this {note.kind}</span></button>}
      </p>
      {msg && <p role="status" className="mt-1 text-[12.5px] text-gray-800">{msg}</p>}
    </div>
  );
}
const linkBtn = "inline-flex min-h-[32px] items-center underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)]";

/** A note on the library's Your notes view: its own state (edit, remove), where it is attached, and the item actions passed in. */
export function StandaloneNote({ note, attached, children }: { note: ClientNote; attached: string; children?: ReactNode }) {
  const [current, setCurrent] = useState(note);
  const [gone, setGone] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const remove = async (id: string) => {
    const r = await send("DELETE", undefined, `?id=${encodeURIComponent(id)}`);
    if (!r.ok) { setMsg(typeof r.json.error === "string" ? r.json.error : "That could not be removed just now."); return; }
    setGone(true);
  };
  if (gone) return <p role="status" className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-3 text-[13px] text-gray-700">Note removed.</p>;
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 sm:p-4">
      <NoteEntry note={current} attached={attached} onRemove={id => void remove(id)} onChanged={setCurrent} />
      {msg && <p role="status" className="mt-1 text-[12.5px] text-gray-800">{msg}</p>}
      {children}
    </div>
  );
}

type SectionOption = { id: string; label: string };
/**
 * Write a note on a material, and optionally one section of it, from the library page itself. POST the existing notes route (820 material
 * and section targets, no schema change); the sections of the chosen material are read when it is chosen. Learner text, private, never AI.
 */
/** SALE-2026-11 R3: kind "summary" writes a personal summary (migration 975) with the same form. */
export function NewNoteForm({ materials, initialMaterial, kind = "note" }: { materials: { id: string; title: string }[]; initialMaterial?: string | null; kind?: "note" | "summary" }) {
  const router = useRouter();
  const [materialId, setMaterialId] = useState(initialMaterial && materials.some(m => m.id === initialMaterial) ? initialMaterial : "");
  const [sections, setSections] = useState<SectionOption[] | null>(null);
  const [chunkId, setChunkId] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!materialId) return;
    let live = true;
    void send("GET", undefined, `?sections=${encodeURIComponent(materialId)}`).then(r => {
      if (live) setSections(r.ok ? ((r.json.sections ?? []) as SectionOption[]) : []);
    });
    return () => { live = false; };
  }, [materialId]);

  const choose = (id: string) => { setMaterialId(id); setChunkId(""); setSections(null); setMsg(null); };
  const save = async () => {
    setBusy(true); setMsg(null);
    const target = chunkId ? { targetKind: "section", materialId, chunkId } : { targetKind: "material", materialId };
    const r = await send("POST", { ...target, kind, body: body.trim(), quote: null });
    setBusy(false);
    if (!r.ok) { setMsg(typeof r.json.error === "string" ? r.json.error : "That could not be saved just now."); return; }
    setBody(""); setMsg(kind === "summary" ? "Summary saved." : "Note saved."); router.refresh();
  };
  const field = `mt-1 block w-full min-h-[40px] rounded-lg border border-gray-300 bg-white px-2 text-[13.5px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
  return (
    <details className="mt-3 rounded-2xl border border-gray-200 bg-white">
      <summary className={`flex min-h-[44px] cursor-pointer list-none items-center px-4 text-[14px] font-semibold text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] [&::-webkit-details-marker]:hidden ${focusRing}`}>{kind === "summary" ? "Write a personal summary" : "Write a new note"}</summary>
      <div className="border-t border-gray-200 px-4 pb-4 pt-2">
        <p className="text-[12px] text-gray-600">On one of your materials, and optionally one section of it. Written by you, private to you. Never shared, never AI.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-[12.5px] font-semibold text-gray-800">Material
            <select value={materialId} onChange={e => choose(e.target.value)} className={field}>
              <option value="">Choose a material</option>{materials.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
          </label>
          <label className="text-[12.5px] font-semibold text-gray-800">Section (optional)
            <select value={chunkId} onChange={e => setChunkId(e.target.value)} className={field} disabled={!materialId || sections === null}>
              <option value="">{!materialId ? "Choose a material first" : sections === null ? "Reading its sections…" : "The whole material"}</option>
              {(sections ?? []).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
        </div>
        <label className="mt-2 block text-[12.5px] font-semibold text-gray-800" htmlFor={`new-library-${kind}`}>{kind === "summary" ? "Your summary, in your own words" : "Your note"}</label>
        <textarea id={`new-library-${kind}`} value={body} maxLength={BODY_MAX} rows={3} onChange={e => setBody(e.target.value)}
          className={`mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[14px] ${focusRing}`} placeholder={kind === "summary" ? "The main points as you understand them" : "Your own words: what to remember, a question to ask"} />
        <DictateButton fieldId={`new-library-${kind}`} onValue={setBody} disabled={busy} className="mt-2" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={chip} disabled={busy || !materialId || !body.trim()} onClick={() => void save()}>{kind === "summary" ? "Save summary" : "Save note"}</button>
          {msg && <span role="status" className="text-[13px] text-gray-800">{msg}</span>}
        </div>
      </div>
    </details>
  );
}
