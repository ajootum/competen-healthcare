// ── THE AUTOSAVE ENGINE ── COMPETEN-NOTEBOOK-001 P1, SCHOLAR-NOTEBOOK-UX-002 items 5 and 8 ───────────────────────────────────
//
// Client-safe, no React and no DOM of its own: the send, the timers and the storage are handed in, so every path is tested with fakes.
//
//   ONE AT A TIME   one save per note is ever in flight. Typing while it runs waits, then the newest words go. Old words never overwrite new.
//   A LOST REPLY    the first save carries a client key, so a retry finds the same note. A later save carries the revision it was made
//                   from, and a refusal whose stored words equal ours is that save having landed: it counts as saved.
//   NO WORDS LOST   anything the server has not confirmed sits in a draft on this device until it does. Network and server failures retry by
//                   themselves, backing off. What cannot be retried (patient identifiers, a changed copy, a signed-out session) says so and keeps the draft.
//   NO ALARMS       saving is quiet. Failure says plainly where the words are.

import { draftKeyOf, type NoteContext, type NoteDraft, type NoteLink } from "./personal-notebook";

export type SaveStatus = "idle" | "typing" | "saving" | "saved" | "retrying" | "refused" | "conflict" | "signed_out" | "failed";

/** The other copy, when a save was refused because the note changed elsewhere. */
export type OtherCopy = { body: string | null; title: string | null; tags: string[]; revision: number };

export type SendReply =
  /** `stored`: a retried first save found the note already there. These are the words it holds, which may be older than ours. */
  | { kind: "ok"; id: string; revision: number; stored?: { body: string | null; title: string | null; tags: string[] } }
  | { kind: "conflict"; current: OtherCopy }
  /** The server will not take these words as they stand (a patient identifier, too long). Retrying the same words cannot help. */
  | { kind: "refused"; message: string }
  | { kind: "signed_out" }
  | { kind: "gone" }
  /** No answer, or the server failed. Worth trying again. */
  | { kind: "retry"; message?: string };

export type MetaPatch = { title?: string; tags?: string[]; pinned?: boolean; link?: NoteLink; sectionLabel?: string | null; sectionAnchor?: string | null; competencyId?: string | null; studyId?: string | null };

export type SendRequest =
  | { op: "create"; clientKey: string; body: string; title: string; tags: string[]; context: NoteContext; keepalive: boolean }
  | ({ op: "update"; id: string; expectedRevision: number; body?: string; keepalive: boolean } & MetaPatch);

export type SaverDeps = {
  send: (r: SendRequest) => Promise<SendReply>;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
  now: () => number;
  /** Device storage. Any failure (full, private mode) is survived: the note still saves. */
  storage: { get: (k: string) => string | null; set: (k: string, v: string) => void; remove: (k: string) => void } | null;
};

export type SaverSnapshot = {
  status: SaveStatus; id: string | null; revision: number | null; body: string; title: string; tags: string[];
  /** When the server last confirmed the words. */
  savedAt: number | null; message: string | null; other: OtherCopy | null;
  /** Something has not yet reached the server. */
  dirty: boolean;
};

export const AUTOSAVE_DELAY_MS = 1200;
export const DRAFT_DELAY_MS = 300;
export const RETRY_BACKOFF_MS = [2000, 5000, 15000, 30000, 60000] as const;

type Start = { userId: string; clientKey: string; id?: string | null; revision?: number | null; body?: string; title?: string; tags?: string[]; context: NoteContext; dirtyFromDraft?: boolean };

export class NoteSaver {
  private snap: SaverSnapshot;
  private listeners = new Set<() => void>();
  private timer: unknown = null;
  private draftTimer: unknown = null;
  private inFlight = false;
  private retries = 0;
  private serverBody: string;
  private serverTitle: string;
  private serverTags: string;
  private meta: MetaPatch = {};
  private readonly key: string;
  readonly clientKey: string;
  context: NoteContext;

  constructor(private deps: SaverDeps, start: Start) {
    this.clientKey = start.clientKey;
    this.context = start.context;
    this.key = draftKeyOf(start.userId, start.clientKey);
    const body = start.body ?? "", title = start.title ?? "", tags = start.tags ?? [];
    this.serverBody = start.dirtyFromDraft ? "" : body;
    this.serverTitle = start.dirtyFromDraft ? "" : title;
    this.serverTags = start.dirtyFromDraft ? "" : JSON.stringify(tags);
    this.snap = { status: start.dirtyFromDraft ? "typing" : "idle", id: start.id ?? null, revision: start.revision ?? null, body, title, tags, savedAt: null, message: null, other: null, dirty: !!start.dirtyFromDraft };
    if (start.dirtyFromDraft) this.schedule(0);
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snap;
  private set(p: Partial<SaverSnapshot>) { this.snap = { ...this.snap, ...p }; this.listeners.forEach(l => l()); }

  /** The words changed. Kept on this device at once, sent when typing pauses. */
  setBody(body: string) { if (body !== this.snap.body) this.change({ body }); }
  setTitle(title: string) { if (title !== this.snap.title) this.change({ title }); }
  setTags(tags: string[]) { if (JSON.stringify(tags) !== JSON.stringify(this.snap.tags)) this.change({ tags }); }

  private hasWords() { return !!this.snap.body.trim(); }
  private isDirty() {
    return this.snap.body !== this.serverBody || this.snap.title !== this.serverTitle || JSON.stringify(this.snap.tags) !== this.serverTags || Object.keys(this.meta).length > 0;
  }

  private change(p: Partial<SaverSnapshot>) {
    this.set({ ...p, status: "typing", message: null, dirty: true });
    this.scheduleDraft();
    // Blank: nothing to send. The server keeps the last words and they are never replaced by nothing.
    if (!this.hasWords()) { this.cancelTimer(); this.set({ status: "idle" }); return; }
    this.retries = 0;
    this.schedule(AUTOSAVE_DELAY_MS);
  }

  /** A change that is not typing (a pin, a link): saved straight away, in the same queue, against the same revision. */
  patch(meta: MetaPatch) {
    this.meta = { ...this.meta, ...meta };
    this.set({ dirty: true, status: this.snap.status === "idle" || this.snap.status === "saved" ? "typing" : this.snap.status });
    this.schedule(0);
  }

  /**
   * Send what is waiting now (leaving the page, closing the panel, coming back online). A failed save goes on retrying after the panel
   * has closed, and the draft stays until the server confirms the words.
   */
  flush(keepalive = false) {
    this.cancelTimer();
    if (this.draftTimer) { this.deps.clearTimer(this.draftTimer); this.draftTimer = null; }
    this.writeDraft();
    void this.run(keepalive);
  }

  /** The network is back: try now, whatever the backoff said. */
  online() {
    if (this.snap.status === "retrying") { this.retries = 0; this.flush(); }
  }

  /** The learner chose: their words win over the copy changed elsewhere. */
  keepMine() {
    const other = this.snap.other;
    if (!other) return;
    this.serverBody = other.body ?? ""; this.serverTitle = other.title ?? ""; this.serverTags = JSON.stringify(other.tags);
    this.set({ revision: other.revision, other: null, status: "typing", message: null, dirty: true });
    this.schedule(0);
  }
  /** The learner chose: take the copy changed elsewhere. Their words are dropped only by this click. */
  useOther() {
    const other = this.snap.other;
    if (!other) return;
    this.serverBody = other.body ?? ""; this.serverTitle = other.title ?? ""; this.serverTags = JSON.stringify(other.tags);
    this.set({ body: this.serverBody, title: this.serverTitle, tags: other.tags, revision: other.revision, other: null, status: "saved", message: null, dirty: false });
    this.removeDraft();
  }

  // ── internals ──

  private cancelTimer() { if (this.timer !== null) { this.deps.clearTimer(this.timer); this.timer = null; } }
  private schedule(ms: number) {
    this.cancelTimer();
    this.timer = this.deps.setTimer(() => { this.timer = null; void this.run(false); }, ms);
  }
  private scheduleDraft() {
    if (this.draftTimer) this.deps.clearTimer(this.draftTimer);
    this.draftTimer = this.deps.setTimer(() => { this.draftTimer = null; this.writeDraft(); }, DRAFT_DELAY_MS);
  }
  private writeDraft() {
    if (!this.deps.storage || !this.hasWords() || !this.isDirty()) return;
    const d: NoteDraft = { clientKey: this.clientKey, noteId: this.snap.id, revision: this.snap.revision, body: this.snap.body, title: this.snap.title, tags: this.snap.tags, context: this.context, savedAt: this.deps.now() };
    try { this.deps.storage.set(this.key, JSON.stringify(d)); } catch { /* the note still saves */ }
  }
  private removeDraft() { try { this.deps.storage?.remove(this.key); } catch { /* nothing to do */ } }

  private async run(keepalive: boolean): Promise<void> {
    if (this.inFlight || !this.isDirty()) return;
    if (!this.hasWords()) return;
    // These wait for the learner: typing changes the status and sends again.
    if (this.snap.status === "refused" || this.snap.status === "conflict" || this.snap.status === "signed_out") return;
    this.inFlight = true;
    const body = this.snap.body, title = this.snap.title, tags = this.snap.tags, meta = this.meta;
    this.meta = {};
    this.set({ status: "saving" });
    const req: SendRequest = this.snap.id && this.snap.revision !== null
      ? {
        op: "update", id: this.snap.id, expectedRevision: this.snap.revision, keepalive,
        ...(body !== this.serverBody ? { body } : {}),
        ...(title !== this.serverTitle ? { title } : {}),
        ...(JSON.stringify(tags) !== this.serverTags ? { tags } : {}),
        ...meta,
      }
      : { op: "create", clientKey: this.clientKey, body, title, tags, context: this.context, keepalive };
    let reply: SendReply;
    try { reply = await this.deps.send(req); } catch { reply = { kind: "retry" }; }
    this.inFlight = false;
    // The first save writes the words and their context. A pin or a link chosen before it arrived follows as an update.
    if (req.op === "create") this.meta = { ...meta, ...this.meta };
    this.settle(reply, { body, title, tags, meta: req.op === "create" ? {} : meta });
  }

  private settle(reply: SendReply, sent: { body: string; title: string; tags: string[]; meta: MetaPatch }) {
    switch (reply.kind) {
      case "ok": {
        this.retries = 0;
        this.serverBody = reply.stored ? reply.stored.body ?? "" : sent.body;
        this.serverTitle = reply.stored ? reply.stored.title ?? "" : sent.title;
        this.serverTags = JSON.stringify(reply.stored ? reply.stored.tags : sent.tags);
        const dirty = this.isDirty();
        this.set({ id: reply.id, revision: reply.revision, savedAt: this.deps.now(), status: dirty ? "typing" : "saved", message: null, other: null, dirty });
        if (dirty) this.schedule(AUTOSAVE_DELAY_MS);
        else this.removeDraft();
        return;
      }
      case "conflict": {
        // A retry of a save that had landed: the stored words are ours. That is a success, not a conflict.
        const same = (reply.current.body ?? "") === sent.body && (reply.current.title ?? "") === sent.title && JSON.stringify(reply.current.tags) === JSON.stringify(sent.tags);
        if (same) {
          this.serverBody = sent.body; this.serverTitle = sent.title; this.serverTags = JSON.stringify(sent.tags);
          const dirty = this.isDirty();
          this.set({ revision: reply.current.revision, savedAt: this.deps.now(), status: dirty ? "typing" : "saved", message: null, dirty });
          if (dirty) this.schedule(AUTOSAVE_DELAY_MS); else this.removeDraft();
          return;
        }
        this.meta = { ...sent.meta, ...this.meta };
        this.writeDraft();
        this.set({ status: "conflict", other: reply.current, message: "This note was changed somewhere else since you opened it.", dirty: true });
        return;
      }
      case "refused":
        this.meta = { ...sent.meta, ...this.meta };
        this.writeDraft();
        this.set({ status: "refused", message: reply.message, dirty: true });
        return;
      case "signed_out":
        this.meta = { ...sent.meta, ...this.meta };
        this.writeDraft();
        this.set({ status: "signed_out", message: "You are signed out. Your words are kept on this device. Sign in again to save them.", dirty: true });
        return;
      case "gone":
        // The note was removed elsewhere. The words on the screen go back as a new note on the next change, never silently dropped.
        this.writeDraft();
        this.set({ status: "failed", id: null, revision: null, message: "This note was removed somewhere else. Your words are kept on this device.", dirty: true });
        return;
      case "retry": {
        this.meta = { ...sent.meta, ...this.meta };
        this.writeDraft();
        const wait = RETRY_BACKOFF_MS[Math.min(this.retries, RETRY_BACKOFF_MS.length - 1)];
        this.retries += 1;
        this.set({ status: "retrying", message: reply.message ?? "Not saved yet. Your words are kept on this device and will be saved when the connection returns.", dirty: true });
        this.schedule(wait);
      }
    }
  }
}

/** The plain words for a status. Shape and words carry it, never colour alone. */
export function statusWords(s: Pick<SaverSnapshot, "status" | "savedAt" | "message" | "dirty">, now: number): string {
  switch (s.status) {
    case "saving": return "Saving…";
    case "typing": return "Saving soon…";
    case "saved": return now - (s.savedAt ?? now) < 60_000 ? "Saved" : "All changes saved";
    case "idle": return s.dirty ? "Not saved: a note needs some words." : "";
    default: return s.message ?? "Not saved yet.";
  }
}
