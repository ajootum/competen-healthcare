"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LearningIcon, learnAction, learnBox } from "@/components/ui/scholar-learning";
import { FREE_CONTEXT, IDEAS, capturedInOf, parseNoteLink, pickReadingBox, type NoteContext, type NoteDraft } from "@/lib/individual/scholar/personal-notebook";
import { activeStudyId } from "./study-active";
import { DraftRecovery, NoteExtras, NoteField, newClientKey, notebookHref, useNoteSaver } from "./note-capture";

// COMPETEN-NOTEBOOK-001 P1, SCHOLAR-NOTEBOOK-UX-002 items 2-4: QUICK NOTE. A control in the sticky header, so it is on every Scholar page and never
// floats over anything. One tap opens a panel beside what is being read: not a dialog that takes the page, no navigation, no scroll, nothing on the page
// resets or closes, and the cursor is in the field at once. Inside a lesson it attaches to the section being read, and that can be undone with one tap.
// Closing it keeps the words: what is waiting is saved, and a note not yet confirmed is still there on the next open.

/** What the page says about where the learner is: the capture box their reading has reached, else the whole page's marker. Read once, on opening. */
function readContext(pathname: string): NoteContext {
  const capturedIn = capturedInOf(pathname);
  const base: NoteContext = { ...FREE_CONTEXT, capturedIn, studyId: activeStudyId() };
  const parse = (raw: string | undefined): Partial<NoteContext> | null => {
    if (!raw) return null;
    try { const c = JSON.parse(raw) as Partial<NoteContext>; return parseNoteLink(c.link) ? c : null; } catch { return null; }
  };
  const boxes = [...document.querySelectorAll<HTMLElement>("[data-note-box]")].map(el => ({ el, bottom: el.getBoundingClientRect().bottom }));
  const hit = pickReadingBox(boxes, window.innerHeight * 0.35);
  // Several marks: the newest one on the page (the question now on screen, in Revise).
  const marks = document.querySelectorAll<HTMLElement>("[data-note-page]");
  const c = parse(hit?.el.dataset.noteBox) ?? parse(marks[marks.length - 1]?.dataset.notePage);
  return c ? { ...base, ...c, capturedIn, studyId: base.studyId } : base;
}

const whereWords = (c: NoteContext) => c.link.targetKind === "free" ? null : c.sectionLabel ?? (c.link.targetKind === "lesson" ? "this lesson" : "this material");

type Open = { key: string; context: NoteContext; draft: NoteDraft | null };

export function QuickNote({ userId }: { userId: string }) {
  const pathname = usePathname() ?? "";
  const button = useRef<HTMLButtonElement>(null);
  const [panel, setPanel] = useState<Open | null>(null);
  const [visible, setVisible] = useState(false);
  const [dirty, setDirty] = useState(false);

  const open = () => {
    // A note still waiting to reach the server is reopened as it was. Otherwise a new blank page.
    if (panel && dirty) { setVisible(true); return; }
    setPanel({ key: newClientKey(), context: readContext(pathname), draft: null });
    setVisible(true);
  };
  const close = useCallback(() => {
    setVisible(false);
    button.current?.focus({ preventScroll: true });
  }, []);
  const restore = (d: NoteDraft) => { setPanel({ key: d.clientKey, context: d.context, draft: d }); setVisible(true); };

  return (
    <>
      <button ref={button} type="button" onClick={() => (visible ? close() : open())} aria-expanded={visible} aria-haspopup="dialog" data-testid="quick-note-button"
        className="cmp-learn-ideas inline-flex min-h-[40px] min-w-[40px] items-center justify-center gap-1.5 rounded-xl border border-[var(--learn-border)] bg-[var(--learn-surface)] px-2 text-[13.5px] font-semibold text-[var(--learn-ink)] hover:brightness-95 pointer-coarse:min-h-[var(--cmp-touch-min)] pointer-coarse:min-w-[var(--cmp-touch-min)] md:px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900">
        <LearningIcon name="bulb" className="h-5 w-5" />
        <span className="sr-only md:not-sr-only">Quick note</span>
      </button>
      {panel && (
        <div role="dialog" aria-modal="false" aria-label="Quick note" hidden={!visible} data-testid="quick-note-panel"
          className={`${learnBox("ideas")} fixed inset-x-2 top-[calc(56px+var(--cmp-preview-h,0px)+6px)] z-40 max-h-[calc(100dvh-56px-var(--cmp-preview-h,0px)-12px)] overflow-y-auto p-3.5 shadow-lg md:left-auto md:right-5 md:top-[calc(76px+var(--cmp-preview-h,0px)+8px)] md:max-h-[calc(100dvh-76px-var(--cmp-preview-h,0px)-24px)] md:w-[28rem]`}
          onKeyDown={e => { if (e.key === "Escape") close(); }}>
          <div className="flex items-center gap-2">
            <span className="cmp-learn-accent"><LearningIcon name="bulb" className="h-5 w-5" /></span>
            <h2 className="cmp-learn-ink min-w-0 flex-1 text-[15px] font-bold">{IDEAS.title}</h2>
            <span className="cmp-learn-ink text-[12px]">{IDEAS.privacy}</span>
            <button type="button" onClick={close} aria-label="Close quick note. Your words are kept." className={`${learnAction.secondary} px-2.5`}>Close</button>
          </div>
          <DraftRecovery userId={userId} onRestore={restore} skip={panel.key} />
          {/* Mounted while closed, so the words and any waiting save survive. A new key is a new note. */}
          <QuickWriter key={panel.key} userId={userId} clientKey={panel.key} context={panel.context} draft={panel.draft} focus={visible} onDirty={setDirty}
            onNew={() => setPanel({ key: newClientKey(), context: readContext(pathname), draft: null })} onClose={close} />
        </div>
      )}
    </>
  );
}

function QuickWriter({ userId, clientKey, context, draft, focus, onDirty, onNew, onClose }: {
  userId: string; clientKey: string; context: NoteContext; draft: NoteDraft | null; focus: boolean; onDirty: (d: boolean) => void; onNew: () => void; onClose: () => void;
}) {
  const [ctx, setCtx] = useState(context);
  const { saver, snap } = useNoteSaver({ userId, clientKey, context, ...(draft ? { id: draft.noteId, revision: draft.revision, body: draft.body, title: draft.title, tags: draft.tags, dirtyFromDraft: true } : {}) });
  const where = whereWords(ctx);
  useEffect(() => { onDirty(snap.dirty); }, [onDirty, snap.dirty]);
  // A saved note is finished with: the next open is a new page. Telling the parent happens above, through onDirty.
  const unlink = () => {
    const free: NoteContext = { ...ctx, link: { targetKind: "free" }, sectionLabel: null, sectionAnchor: null };
    setCtx(free);
    saver.setContext(free);
    if (snap.id) saver.patch({ link: { targetKind: "free" }, sectionLabel: null, sectionAnchor: null });
  };
  return (
    <>
      <p className="cmp-learn-ink mt-1.5 text-[13px]" data-testid="quick-note-where">
        {where ? <>Linked to <strong>{where}</strong>. <button type="button" className={learnAction.link} onClick={unlink}>Keep it free-standing</button></> : IDEAS.freeLine}
      </p>
      <p className="mb-2 text-[12px] text-gray-700">{IDEAS.patientWarning}</p>
      <FocusOnOpen active={focus} />
      <NoteField saver={saver} snap={snap} autoFocus={focus} label="Quick note" rows={5} onEscape={onClose} />
      <NoteExtras saver={saver} snap={snap} />
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {snap.id && !snap.dirty && <button type="button" className={learnAction.secondary} onClick={onNew} data-testid="quick-note-new">New note</button>}
        {snap.id && <Link href={notebookHref(snap.id)} className={learnAction.link}>Open in My Notebook</Link>}
        <Link href={notebookHref()} className={learnAction.link}>My Notebook</Link>
      </div>
    </>
  );
}

/** Reopening the panel puts the cursor back in the field, without moving the page behind it. */
function FocusOnOpen({ active }: { active: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!active) return;
    const field = ref.current?.parentElement?.querySelector<HTMLTextAreaElement>("textarea");
    field?.focus({ preventScroll: true });
  }, [active]);
  return <span ref={ref} hidden />;
}
