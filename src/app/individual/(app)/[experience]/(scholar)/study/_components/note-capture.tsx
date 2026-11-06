"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { LearningIcon, learnAction, learnBox } from "@/components/ui/scholar-learning";
import { DictateButton } from "@/app/individual/_components/speech/speech-buttons";
import { experienceHref } from "@/lib/individual/experiences";
import { NoteSaver, statusWords, type OtherCopy, type SaverDeps, type SaverSnapshot, type SendReply, type SendRequest } from "@/lib/individual/scholar/note-saver";
import { IDEAS, NOTEBOOK_BODY_MAX, cleanTags, draftKeyOf, draftPrefixOf, parseDraft, type NoteContext, type NoteDraft } from "@/lib/individual/scholar/personal-notebook";
import type { NotebookNote } from "@/lib/individual/scholar/store";

// COMPETEN-NOTEBOOK-001 P1, SCHOLAR-NOTEBOOK-UX-002: what every capture place shares. The provider that says the Notebook is offered (decided
// once by the server, off by default), the send that talks to the notes route, the saver hook, and the amber writing field with its status.
// Learner text, private. Nothing here calls a model.

const Offered = createContext<{ on: boolean; userId: string | null }>({ on: false, userId: null });
export function NotebookProvider({ on, userId, children }: { on: boolean; userId: string; children: ReactNode }) {
  const value = useMemo(() => ({ on, userId }), [on, userId]);
  return <Offered.Provider value={value}>{children}</Offered.Provider>;
}
/** The signed-in learner where the Notebook is offered, or null: every capture place then draws nothing. */
export function useNotebook(): { userId: string } | null {
  const c = useContext(Offered);
  return c.on && c.userId ? { userId: c.userId } : null;
}

export const notebookHref = (seg = "") => experienceHref("scholar", seg ? `study/notebook/${seg}` : "study/notebook");
export const newClientKey = () => crypto.randomUUID();

// ── SENDING ──

const NOTES_URL = "/api/individual/scholar/notebook/notes";
/** A keepalive request has a browser limit. Above it the words stay in the draft and go on the next visit. */
const KEEPALIVE_MAX = 50_000;

async function post(url: string, method: string, body: unknown, keepalive: boolean): Promise<{ status: number; json: Record<string, unknown> } | null> {
  try {
    const text = JSON.stringify(body);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: text, keepalive: keepalive && text.length < KEEPALIVE_MAX });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  } catch { return null; }
}
const refused = (json: Record<string, unknown>): SendReply => ({ kind: "refused", message: typeof json.error === "string" ? json.error : "That could not be saved." });

/** A save carries whose words these are, so a retry still waiting after a sign-out and someone else's sign-in is refused, not written to their notebook. */
export async function sendNote(r: SendRequest, userId: string): Promise<SendReply> {
  const okReply = (json: Record<string, unknown>): SendReply | null => (typeof json.id === "string" && Number.isInteger(json.revision) ? { kind: "ok", id: json.id, revision: json.revision as number, ...(json.stored ? { stored: json.stored as { body: string | null; title: string | null; tags: string[] } } : {}) } : null);
  if (r.op === "create") {
    const body = { forUser: userId, clientKey: r.clientKey, body: r.body, title: r.title || null, tags: r.tags, context: r.context };
    let a = await post(NOTES_URL, "POST", body, r.keepalive);
    // The lesson or section is gone: the words matter more than the link. Saved free-standing, with the section's name kept.
    if (a?.status === 404) a = await post(NOTES_URL, "POST", { ...body, context: { ...r.context, link: { targetKind: "free" }, studyId: null } }, r.keepalive);
    if (!a || a.status >= 500) return { kind: "retry" };
    if (a.status === 401) return { kind: "signed_out" };
    if (a.status !== 200) return refused(a.json);
    // An answer that is not the route's own (a proxy's page) is not a save: the words stay in the draft.
    return okReply(a.json) ?? { kind: "retry" };
  }
  const { op: _op, id, keepalive, title, ...rest } = r;
  void _op;
  const a = await post(`${NOTES_URL}/${encodeURIComponent(id)}`, "PATCH", { forUser: userId, ...rest, ...(title !== undefined ? { title: title || null } : {}) }, keepalive);
  if (!a || a.status >= 500) return { kind: "retry" };
  if (a.status === 401) return { kind: "signed_out" };
  if (a.status === 409 && a.json.conflict) return { kind: "conflict", current: a.json.current as OtherCopy };
  if (a.status === 404 && a.json.reason === "not_found") return { kind: "gone" };
  if (a.status !== 200) return refused(a.json);
  return okReply(a.json) ?? { kind: "retry" };
}

const localStore: SaverDeps["storage"] = {
  get: k => window.localStorage.getItem(k),
  set: (k, v) => window.localStorage.setItem(k, v),
  remove: k => window.localStorage.removeItem(k),
};
const deps = (userId: string): SaverDeps => ({
  send: r => sendNote(r, userId),
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: t => window.clearTimeout(t as number),
  now: () => Date.now(),
  storage: typeof window === "undefined" ? null : localStore,
});

export type SaverStart = { userId: string; clientKey: string; id?: string | null; revision?: number | null; body?: string; title?: string; tags?: string[]; context: NoteContext; dirtyFromDraft?: boolean; allowBlank?: boolean };

/** One note's saver for the life of this component. Leaving, hiding the page or coming back online sends or retries what is waiting. */
export function useNoteSaver(start: SaverStart): { saver: NoteSaver; snap: SaverSnapshot } {
  const [saver] = useState(() => new NoteSaver(deps(start.userId), start));
  const snap = useSyncExternalStore(saver.subscribe, saver.getSnapshot, saver.getSnapshot);
  useEffect(() => {
    const online = () => saver.online();
    const hidden = () => { if (document.visibilityState === "hidden") saver.flush(true); };
    const leave = () => saver.flush(true);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leave);
      if (saver.getSnapshot().dirty) saver.flush();
    };
  }, [saver]);
  return { saver, snap };
}

// ── DRAFTS ON THIS DEVICE ──

/** Words this device holds that the server never confirmed, newest first. */
export function readDrafts(userId: string): NoteDraft[] {
  try {
    const now = Date.now(), prefix = draftPrefixOf(userId), out: NoteDraft[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k?.startsWith(prefix)) continue;
      const d = parseDraft(window.localStorage.getItem(k), now);
      if (d) out.push(d); else window.localStorage.removeItem(k);
    }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  } catch { return []; }
}
export function removeDraft(userId: string, clientKey: string) {
  try { window.localStorage.removeItem(draftKeyOf(userId, clientKey)); } catch { /* nothing to do */ }
}

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const when = (ms: number) => new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Unsaved writing from an interrupted visit: its first words, Restore and Discard. Drawn only where something waits. */
export function DraftRecovery({ userId, onRestore, skip }: { userId: string; onRestore: (d: NoteDraft) => void; skip?: string | null }) {
  const [drafts, setDrafts] = useState<NoteDraft[]>([]);
  // localStorage exists only in the browser, so this is read after the first paint.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDrafts(readDrafts(userId).filter(d => d.clientKey !== skip)); }, [userId, skip]);
  if (!drafts.length) return null;
  return (
    <section aria-label="Unsaved writing on this device" className={`${learnBox("ideas")} mb-3 p-3`} data-testid="note-draft-recovery">
      <p className="cmp-learn-ink text-[13.5px] font-bold">Unsaved writing on this device</p>
      <ul className="mt-1.5 space-y-2">
        {drafts.slice(0, 5).map(d => (
          <li key={d.clientKey} className="rounded-xl bg-[var(--cmp-app-surface)] p-2.5 ring-1 ring-[var(--learn-border)]">
            <p className="break-words text-[13.5px] text-gray-900">{d.body.trim().slice(0, 140)}{d.body.trim().length > 140 ? "…" : ""}</p>
            <p className="mt-0.5 text-[12px] text-gray-600">From {when(d.savedAt)}</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button type="button" className={learnAction.primary} onClick={() => { setDrafts(x => x.filter(y => y.clientKey !== d.clientKey)); onRestore(d); }}>Restore</button>
              <button type="button" className={learnAction.secondary} onClick={() => { removeDraft(userId, d.clientKey); setDrafts(x => x.filter(y => y.clientKey !== d.clientKey)); }}>Discard</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── THE STATUS LINE ──

/** Saving, saved or what went wrong, in words and a shape. A failure says where the words are and offers the one way on. */
export function SaveLine({ saver, snap, className = "" }: { saver: NoteSaver; snap: SaverSnapshot; className?: string }) {
  const words = statusWords(snap);
  const trouble = snap.status === "retrying" || snap.status === "refused" || snap.status === "conflict" || snap.status === "signed_out" || snap.status === "failed";
  return (
    <div className={className} data-testid="note-save-status" data-status={snap.status}>
      <p role="status" className={`flex min-h-[20px] items-start gap-1.5 text-[12.5px] ${trouble ? "font-semibold text-gray-900" : "cmp-learn-ink"}`}>
        {snap.status === "saved" && <LearningIcon name="check" className="mt-px h-4 w-4" />}
        {trouble && <LearningIcon name="warn" className="mt-px h-4 w-4" />}
        <span className="min-w-0 break-words">{words}</span>
      </p>
      {snap.status === "retrying" && <button type="button" className={`${learnAction.link} mt-0.5`} onClick={() => saver.flush()}>Try again now</button>}
      {snap.status === "conflict" && (
        <div className="mt-1.5 flex flex-wrap gap-2">
          <button type="button" className={learnAction.primary} onClick={() => saver.keepMine()}>Keep what I wrote here</button>
          <button type="button" className={learnAction.secondary} onClick={() => saver.useOther()}>Use the other version</button>
        </div>
      )}
    </div>
  );
}

// ── THE WRITING FIELD ──

/** The amber field: large and comfortable, grows with the words, one tap to dictate. `autoFocus` puts the cursor in it without moving the page. */
export function NoteField({ saver, snap, label = "Your idea or note", rows = 4, autoFocus = false, tall = false, disabled = false, onEscape }: {
  saver: NoteSaver; snap: SaverSnapshot; label?: string; rows?: number; autoFocus?: boolean; tall?: boolean; disabled?: boolean; onEscape?: () => void;
}) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (autoFocus) { const t = ref.current; t?.focus({ preventScroll: true }); if (t) t.setSelectionRange(t.value.length, t.value.length); } }, [autoFocus]);
  const left = NOTEBOOK_BODY_MAX - snap.body.length;
  return (
    <>
      <label htmlFor={id} className="sr-only">{label}</label>
      <textarea id={id} ref={ref} value={snap.body} rows={rows} maxLength={NOTEBOOK_BODY_MAX} disabled={disabled} placeholder={IDEAS.placeholder} data-testid="note-field"
        onChange={e => saver.setBody(e.target.value)} onBlur={() => { if (snap.dirty) saver.flush(); }} onKeyDown={e => { if (e.key === "Escape" && onEscape) { e.stopPropagation(); onEscape(); } }}
        className={`w-full resize-y rounded-xl border border-[var(--learn-border)] bg-[var(--cmp-app-surface)] px-3.5 py-3 text-[16px] leading-relaxed text-gray-900 placeholder:text-gray-600 [field-sizing:content] ${tall ? "min-h-[45dvh]" : "min-h-[112px] max-h-[50dvh]"} ${focusRing}`} />
      {left < 2000 && <p className="mt-1 text-[12px] text-gray-700">{left.toLocaleString("en-GB")} characters left in this note.</p>}
      <div className="mt-1.5 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <SaveLine saver={saver} snap={snap} className="min-w-0 flex-1" />
        <DictateButton fieldId={id} onValue={v => saver.setBody(v)} disabled={disabled} className="shrink-0" />
      </div>
    </>
  );
}

/** Optional title and tags, offered only after writing starts, and never asked for. */
export function NoteExtras({ saver, snap, open: startOpen = false }: { saver: NoteSaver; snap: SaverSnapshot; open?: boolean }) {
  const uid = useId();
  const [tagText, setTagText] = useState(snap.tags.join(", "));
  const field = `mt-1 block w-full min-h-[44px] rounded-xl border border-[var(--learn-border)] bg-[var(--cmp-app-surface)] px-3 text-[15px] text-gray-900 ${focusRing}`;
  const commit = useCallback(() => saver.setTags(cleanTags(tagText)), [saver, tagText]);
  if (!snap.body.trim() && !snap.title && !snap.tags.length) return null;
  return (
    <details className="mt-2" open={startOpen || undefined} data-testid="note-extras">
      <summary className={`inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded text-[13px] font-semibold text-[var(--learn-ink)] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Add a title or tags (optional)</summary>
      <div className="mt-1 grid gap-2 sm:grid-cols-2">
        <label className="text-[12.5px] font-semibold text-gray-800" htmlFor={`${uid}-t`}>Title
          <input id={`${uid}-t`} value={snap.title} maxLength={200} onChange={e => saver.setTitle(e.target.value)} className={field} />
        </label>
        <label className="text-[12.5px] font-semibold text-gray-800" htmlFor={`${uid}-g`}>Tags, separated by commas
          <input id={`${uid}-g`} value={tagText} onChange={e => setTagText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} className={field} />
        </label>
      </div>
    </details>
  );
}

/**
 * Says what this page is about, for Quick Note, which reads it when it is opened. Draws nothing, and sends nothing. Only where the page knows the
 * learner's own material or section (the server reads every id again by the caller's id when a note is saved).
 */
export function NotePageMark({ materialId, chunkId = null, label }: { materialId: string; chunkId?: string | null; label: string }) {
  const nb = useNotebook();
  if (!nb) return null;
  const link = chunkId ? { targetKind: "section", materialId, chunkId } : { targetKind: "material", materialId };
  return <span hidden data-note-page={JSON.stringify({ link, sectionLabel: label.slice(0, 200) })} />;
}

// ── THE NOTES OF ONE LESSON ──

type LessonNotes = {
  sessionId: string; step: number; materialId: string | null;
  notes: NotebookNote[] | null; failed: boolean; load: () => void; reload: () => void;
  remove: (id: string) => void;
};
const LessonCtx = createContext<LessonNotes | null>(null);
export const useLessonNotes = () => useContext(LessonCtx);

/** The learner's notes on this lesson and its sections, read once when the first box in it is drawn, never for lessons not being read. */
export function LessonNotesScope({ sessionId, step, materialId, chunkIds, children }: { sessionId: string; step: number; materialId: string | null; chunkIds: readonly string[]; children: ReactNode }) {
  const [notes, setNotes] = useState<NotebookNote[] | null>(null);
  const [failed, setFailed] = useState(false);
  const asked = useRef(false);
  const chunks = chunkIds.join(",");
  const read = useCallback(async () => {
    try {
      const res = await fetch(`${NOTES_URL}?session=${encodeURIComponent(sessionId)}&step=${step}&chunks=${encodeURIComponent(chunks)}`);
      const json = res.ok ? await res.json() : null;
      if (!json) { setFailed(true); setNotes(n => n ?? []); return; }
      setFailed(false); setNotes((json.notes ?? []) as NotebookNote[]);
    } catch { setFailed(true); setNotes(n => n ?? []); }
  }, [sessionId, step, chunks]);
  const load = useCallback(() => { if (!asked.current) { asked.current = true; void read(); } }, [read]);
  const remove = useCallback((id: string) => setNotes(n => (n ?? []).filter(x => x.id !== id)), []);
  const value = useMemo<LessonNotes>(() => ({ sessionId, step, materialId, notes, failed, load, reload: () => void read(), remove }), [sessionId, step, materialId, notes, failed, load, read, remove]);
  return <LessonCtx.Provider value={value}>{children}</LessonCtx.Provider>;
}
