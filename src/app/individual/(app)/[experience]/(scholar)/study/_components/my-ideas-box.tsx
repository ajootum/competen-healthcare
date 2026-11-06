"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { LearningIcon, learnAction, learnBox } from "@/components/ui/scholar-learning";
import { IDEAS, noteHeading, type NoteContext } from "@/lib/individual/scholar/personal-notebook";
import type { NotebookNote } from "@/lib/individual/scholar/store";
import { activeStudyId } from "./study-active";
import { NoteExtras, NoteField, newClientKey, notebookHref, useLessonNotes, useNotebook, useNoteSaver } from "./note-capture";
import { NoteActions } from "./note-actions";

// SCHOLAR-NOTEBOOK-UX-002 items 1, 4-10: MY IDEAS & NOTES, inside a lesson. One compact amber line after a teaching section, so the reading flow
// is not broken by empty boxes. One tap opens it, without leaving the page or moving what is being read, and the cursor is in the field at once.
// The lesson, section and source attach by themselves. Several notes per section. Existing notes are one quiet line, and open and edit in place.
// The box also marks where its section ends, so Quick Note can tell which section is being read (data-note-box, personal-notebook pickReadingBox).

export function MyIdeasBox({ chunkId = null, materialId = null, sectionLabel, anchor, className = "" }: {
  chunkId?: string | null; materialId?: string | null; sectionLabel: string; anchor: string; className?: string;
}) {
  const nb = useNotebook();
  const scope = useLessonNotes();
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [writerKey, setWriterKey] = useState<string | null>(null);
  const [current, setCurrent] = useState<{ id: string | null; words: boolean; preview: string }>({ id: null, words: false, preview: "" });

  // The read is asked once for the lesson, by the first box drawn. A note link to this section opens it (`#ideas-<step>-<anchor>`).
  useEffect(() => { if (nb && scope?.sessionId) scope.load(); }, [nb, scope]);
  useEffect(() => {
    if (!scope || scope.notes === null || window.location.hash !== `#ideas-${scope.step}-${anchor}`) return;
    const t = window.setTimeout(() => { setOpen(true); setEverOpened(true); root.current?.scrollIntoView({ block: "center" }); }, 400);
    return () => window.clearTimeout(t);
  }, [scope, anchor]);

  if (!nb || !scope || !scope.sessionId) return null;
  const context: NoteContext = {
    link: { targetKind: "lesson", sessionId: scope.sessionId, step: scope.step, materialId: materialId ?? scope.materialId, chunkId },
    sectionLabel, sectionAnchor: anchor, capturedIn: "learn", studyId: activeStudyId(),
  };
  const mine = (scope.notes ?? []).filter(n => (chunkId ? n.chunkId === chunkId : !n.chunkId && n.sessionId === scope.sessionId && n.step === scope.step && n.sectionAnchor === anchor));
  const listed = mine.filter(n => n.id !== current.id);
  const count = listed.length + (current.words ? 1 : 0);
  const preview = current.preview || (listed[listed.length - 1] ? noteHeading(listed[listed.length - 1], 70) : "");
  const expand = (next: boolean) => {
    setOpen(next);
    if (next) { setEverOpened(true); setWriterKey(k => k ?? newClientKey()); }
  };
  const another = () => { scope.reload(); setCurrent({ id: null, words: false, preview: "" }); setWriterKey(newClientKey()); };

  return (
    <div ref={root} id={`ideas-${scope.step}-${anchor}`} className={`${learnBox("ideas")} scroll-mt-20 ${className}`} data-note-box={JSON.stringify(context)} data-testid="my-ideas-box">
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => expand(!open)}
        className="flex min-h-[48px] w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-2xl px-3.5 py-2 text-left pointer-coarse:min-h-[var(--cmp-touch-min)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900">
        <span className="cmp-learn-accent"><LearningIcon name="bulb" className="h-5 w-5" /></span>
        <span className="cmp-learn-ink text-[14px] font-bold">{IDEAS.title}</span>
        {count > 0 && <span className="text-[12.5px] font-semibold text-gray-800">· {count} {count === 1 ? "note" : "notes"}</span>}
        <span className="cmp-learn-ink ml-auto hidden text-[12px] sm:inline">{IDEAS.privacy}</span>
        <span aria-hidden="true" className={`cmp-learn-accent text-[10px] motion-safe:transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        {!open && preview && <span className="basis-full truncate pl-7 text-[13px] text-gray-800" data-testid="my-ideas-preview">{preview}</span>}
      </button>
      {/* Stays mounted once opened: closing it never loses the words or stops a save that is waiting. */}
      {everOpened && (
        <div id={panelId} hidden={!open} className="rounded-b-2xl border-t border-[var(--learn-border)] px-3.5 pb-3.5 pt-2.5">
          <p className="cmp-learn-ink text-[13px]">{IDEAS.linkedLine}</p>
          <p className="mt-0.5 text-[12px] text-gray-700">{IDEAS.patientWarning}</p>
          {scope.failed && <p role="status" className="mt-1.5 text-[12.5px] text-gray-900">Your earlier notes could not be read just now. They are unchanged. <button type="button" className={learnAction.link} onClick={scope.reload}>Try again</button></p>}
          {listed.length > 0 && (
            <ul className="mt-2 space-y-1.5" aria-label="Your earlier notes here">
              {listed.map(n => <li key={n.id}><ExistingNote note={n} userId={nb.userId} onRemoved={() => scope.remove(n.id)} /></li>)}
            </ul>
          )}
          <div className="mt-2.5">
            {writerKey && (
              <BoxWriter key={writerKey} clientKey={writerKey} userId={nb.userId} context={context} autoFocus={open}
                onState={setCurrent} onAnother={another} onClose={() => expand(false)} chunkIds={chunkId ? [chunkId] : []} materialId={materialId ?? scope.materialId} sessionId={scope.sessionId} step={scope.step} />
            )}
          </div>
          <p className="mt-2.5 text-[12.5px]"><Link href={notebookHref()} className={learnAction.link}>All my notes in My Notebook</Link></p>
        </div>
      )}
    </div>
  );
}

function BoxWriter({ clientKey, userId, context, autoFocus, onState, onAnother, onClose, chunkIds, materialId, sessionId, step }: {
  clientKey: string; userId: string; context: NoteContext; autoFocus: boolean; onState: (s: { id: string | null; words: boolean; preview: string }) => void;
  onAnother: () => void; onClose: () => void; chunkIds: string[]; materialId: string | null; sessionId: string; step: number;
}) {
  const { saver, snap } = useNoteSaver({ userId, clientKey, context });
  const words = !!snap.body.trim();
  useEffect(() => { onState({ id: snap.id, words, preview: words ? noteHeading({ title: snap.title, body: snap.body }, 70) : "" }); }, [onState, snap.id, snap.title, snap.body, words]);
  return (
    <>
      <NoteField saver={saver} snap={snap} autoFocus={autoFocus} label={`${IDEAS.title}, on this section`} onEscape={onClose} />
      <NoteExtras saver={saver} snap={snap} />
      {words && <NoteActions title={snap.title} body={snap.body} chunkIds={chunkIds} materialId={materialId} sessionId={sessionId} step={step} />}
      {words && snap.id && !snap.dirty && <button type="button" className={`${learnAction.secondary} mt-2.5`} onClick={onAnother} data-testid="my-ideas-another">Add another note here</button>}
    </>
  );
}

/** One earlier note: one quiet line, its words on a tap, editable in place with the same autosave. */
function ExistingNote({ note, userId, onRemoved }: { note: NotebookNote; userId: string; onRemoved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <div className="rounded-xl bg-[var(--cmp-app-surface)] px-3 py-2 ring-1 ring-[var(--learn-border)]" data-testid="my-ideas-existing">
      {editing
        ? <ExistingEditor note={note} userId={userId} onDone={() => setEditing(false)} onRemoved={() => { setGone(true); onRemoved(); }} />
        : (
          <>
            <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-gray-900">{note.body}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px] text-gray-600">
              <span>{new Date(note.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
              <button type="button" className={learnAction.link} onClick={() => setEditing(true)}>Edit<span className="sr-only"> this note</span></button>
              <Link href={notebookHref(note.id)} className={learnAction.link}>Open<span className="sr-only"> this note in My Notebook</span></Link>
            </p>
          </>
        )}
    </div>
  );
}

function ExistingEditor({ note, userId, onDone, onRemoved }: { note: NotebookNote; userId: string; onDone: () => void; onRemoved: () => void }) {
  // The note's own key, or a throwaway one for a note from before the Notebook: only the draft is stored under it, never the note.
  const [key] = useState(() => newClientKey());
  const { saver, snap } = useNoteSaver({
    userId, clientKey: key, id: note.id, revision: note.revision, body: note.body ?? "", title: note.title ?? "", tags: note.tags,
    context: { link: { targetKind: "free" }, sectionLabel: note.sectionLabel, sectionAnchor: note.sectionAnchor, capturedIn: "learn", studyId: null },
  });
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const remove = async () => {
    const res = await fetch(`/api/individual/scholar/notebook/notes/${encodeURIComponent(note.id)}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok || res?.status === 404) onRemoved(); else setMsg("That could not be removed just now.");
  };
  return (
    <>
      <NoteField saver={saver} snap={snap} autoFocus label="Edit your note" onEscape={onDone} />
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        <button type="button" className={learnAction.secondary} onClick={() => { saver.flush(); onDone(); }}>Done</button>
        {confirming ? (
          <span role="group" aria-label="Remove this note?" className="inline-flex items-center gap-3">
            <button type="button" className={`${learnAction.link} font-bold`} onClick={() => void remove()}>Yes, remove it</button>
            <button type="button" className={learnAction.link} onClick={() => setConfirming(false)}>Keep it</button>
          </span>
        ) : <button type="button" className={learnAction.link} onClick={() => setConfirming(true)}>Remove</button>}
      </div>
      {msg && <p role="status" className="mt-1 text-[12.5px] text-gray-900">{msg}</p>}
    </>
  );
}
