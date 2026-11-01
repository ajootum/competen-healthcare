// ── SCHOLAR-CONTINUITY-01 item 1: THE LEARNING POSITION ACROSS DEVICES (migration 790) ─────────────────────────────────
//
// Client-safe and pure: no server imports, no I/O of its own. Three things live here.
//
//   1. decidePositionWrite -- THE STALE-WRITE RULE, the same rule migration 790's individual_scholar_learning_position_put
//      applies in the database (that function is the one that decides; this mirror is what the vitest proves and what the
//      build record documents). In order:
//        first        there is no stored position yet
//        same_device  the stored position came from this device and the incoming client_seq is greater
//        informed     the writer had seen the stored position (base_revision = stored revision): any move, back or on
//        progress     a stale writer, accepted only when its device time is later AND (step greater OR completion newer)
//        stale        anything else: rejected, and only furthestStep (a grow-only maximum) is merged
//      So a stale device never moves the learner back or forgets a later completion; the device in use always can.
//
//   2. mergeResume -- where the workspace opens: the server position wins over this device's copy when its device time is
//      later; the lessons revealed are the furthest either knows.
//
//   3. PositionSync -- WHEN the page writes. Never per scroll: an interaction only marks the position dirty and lets a write
//      happen at most every SYNC_INTERVAL_MS; a meaningful event (a lesson after its dwell, a jump, Continue, an activity
//      completed, a practice answered) writes at once (coalesced over EVENT_COALESCE_MS); leaving the page (hidden, pagehide)
//      flushes what is dirty with keepalive. One write in flight at a time; an unchanged position is not written again.
//
// ⚠ A bookmark, never assessment evidence. `unfinished` holds practice STATE only (which practice panel was open, and the learner's own
// recall / quick-check marks as short codes per lesson), never AI output and never notes content.

import { cleanMarks, type InlineMarks } from "./learn-inline";

export const SYNC_INTERVAL_MS = 15_000;
export const EVENT_COALESCE_MS = 300;
export const UNFINISHED_MAX_BYTES = 4000;
export const DEVICE_KEY = "scholar.learn.device";

export type PositionDraft = {
  step: number; furthestStep: number; cardId: string; sectionChunkId: string | null; offsetHint: number | null;
  lastCompletedActivity: string | null; lastCompletedAt: string | null; unfinished: Unfinished | null;
};
/** `recall` / `quick`: SCHOLAR-INLINE-CHECKS-01, the learner's own recall rating and quick-check result per lesson step (learn-inline.ts; codes only). */
export type Unfinished = { v: 1; practiceOpen?: number | null } & InlineMarks;
export type PositionPut = PositionDraft & { deviceId: string; clientSeq: number; baseRevision: number | null; clientUpdatedAt: string };
export type ServerPosition = PositionDraft & { deviceId: string; clientSeq: number; clientUpdatedAt: string; revision: number; updatedAt: string };
export type WriteReason = "first" | "same_device" | "informed" | "progress" | "stale";

const t = (iso: string | null | undefined) => { const n = iso ? Date.parse(iso) : NaN; return Number.isFinite(n) ? n : -Infinity; };

/** Pure. The stale-write rule (migration 790 mirrors it exactly). `next` is what is stored after the write. */
export function decidePositionWrite(stored: ServerPosition | null, incoming: PositionPut): { accepted: boolean; reason: WriteReason; next: ServerPosition } {
  const furthestIn = Math.max(incoming.step, incoming.furthestStep ?? incoming.step);
  if (!stored) {
    const { baseRevision: _b, ...rest } = incoming; void _b;
    return { accepted: true, reason: "first", next: { ...rest, furthestStep: furthestIn, revision: 1, updatedAt: "" } };
  }
  const newerCompletion = incoming.lastCompletedAt !== null && (stored.lastCompletedAt === null || t(incoming.lastCompletedAt) > t(stored.lastCompletedAt));
  let reason: WriteReason;
  if (incoming.deviceId === stored.deviceId) reason = incoming.clientSeq > stored.clientSeq ? "same_device" : "stale";
  else if (incoming.baseRevision !== null && incoming.baseRevision === stored.revision) reason = "informed";
  else if (t(incoming.clientUpdatedAt) > t(stored.clientUpdatedAt) && (incoming.step > stored.step || newerCompletion)) reason = "progress";
  else reason = "stale";
  if (reason !== "stale") {
    const { baseRevision: _b, ...rest } = incoming; void _b;
    return {
      accepted: true, reason,
      next: {
        ...rest, furthestStep: Math.max(stored.furthestStep, furthestIn),
        lastCompletedActivity: newerCompletion ? incoming.lastCompletedActivity : stored.lastCompletedActivity,
        lastCompletedAt: newerCompletion ? incoming.lastCompletedAt : stored.lastCompletedAt,
        revision: stored.revision + 1, updatedAt: stored.updatedAt,
      },
    };
  }
  return furthestIn > stored.furthestStep
    ? { accepted: false, reason, next: { ...stored, furthestStep: furthestIn, revision: stored.revision + 1 } }
    : { accepted: false, reason, next: stored };
}

// ── THE REQUEST, VALIDATED (the PUT route) ──

const ID = /^[a-z0-9][a-z0-9:_-]{0,59}$/;
const DEVICE = /^[A-Za-z0-9_-]{8,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const int = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const isoOk = (v: unknown) => typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v));
/** A device clock more than this far ahead of the server is refused (it could otherwise win every progress comparison). */
export const MAX_CLOCK_AHEAD_MS = 10 * 60_000;

/** Pure. The practice state kept, or null. Only known fields, only numbers: nothing written or taught is ever kept. */
export function cleanUnfinished(v: unknown): Unfinished | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const p = (v as Record<string, unknown>).practiceOpen;
  const marks = cleanMarks(v);
  const out: Unfinished = { v: 1, ...marks };
  if (int(p, 0, 10000)) out.practiceOpen = p as number;
  return out.practiceOpen !== undefined || marks.recall || marks.quick ? out : null;
}

/** Pure. A PUT body as a position write, or why not. `nowMs` is the server's clock (an app clock, compared with device time only to refuse the far future). */
export function parsePositionPut(body: unknown, nowMs: number): { ok: true; value: PositionPut } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.deviceId !== "string" || !DEVICE.test(b.deviceId)) return { ok: false, error: "device" };
  if (!int(b.clientSeq, 0, Number.MAX_SAFE_INTEGER)) return { ok: false, error: "sequence" };
  if (b.baseRevision !== null && b.baseRevision !== undefined && !int(b.baseRevision, 1, Number.MAX_SAFE_INTEGER)) return { ok: false, error: "revision" };
  if (!isoOk(b.clientUpdatedAt) || Date.parse(b.clientUpdatedAt as string) > nowMs + MAX_CLOCK_AHEAD_MS) return { ok: false, error: "time" };
  if (!int(b.step, 0, 10000)) return { ok: false, error: "step" };
  const furthest = b.furthestStep === undefined || b.furthestStep === null ? b.step as number : b.furthestStep;
  if (!int(furthest, 0, 10000)) return { ok: false, error: "furthest" };
  if (typeof b.cardId !== "string" || !ID.test(b.cardId)) return { ok: false, error: "card" };
  const chunk = b.sectionChunkId ?? null;
  if (chunk !== null && (typeof chunk !== "string" || !UUID.test(chunk))) return { ok: false, error: "section" };
  const offset = b.offsetHint ?? null;
  if (offset !== null && !int(offset, 0, 100)) return { ok: false, error: "offset" };
  const act = b.lastCompletedActivity ?? null, at = b.lastCompletedAt ?? null;
  if ((act === null) !== (at === null)) return { ok: false, error: "completion" };
  if (act !== null && (typeof act !== "string" || !ID.test(act) || !isoOk(at) || Date.parse(at as string) > nowMs + MAX_CLOCK_AHEAD_MS)) return { ok: false, error: "completion" };
  const unfinished = b.unfinished === null || b.unfinished === undefined ? null : cleanUnfinished(b.unfinished);
  if (unfinished && new TextEncoder().encode(JSON.stringify(unfinished)).length > UNFINISHED_MAX_BYTES) return { ok: false, error: "unfinished" };
  return {
    ok: true,
    value: {
      deviceId: b.deviceId, clientSeq: b.clientSeq as number, baseRevision: (b.baseRevision as number | null | undefined) ?? null,
      clientUpdatedAt: new Date(Date.parse(b.clientUpdatedAt as string)).toISOString(), step: b.step as number, furthestStep: Math.max(b.step as number, furthest as number),
      cardId: b.cardId, sectionChunkId: chunk as string | null, offsetHint: offset as number | null,
      lastCompletedActivity: act as string | null, lastCompletedAt: at === null ? null : new Date(Date.parse(at as string)).toISOString(), unfinished,
    },
  };
}

/** Pure. A stored row (790 columns, snake_case) as a ServerPosition, or null when it is not one. */
export function positionFromRow(r: unknown): ServerPosition | null {
  const x = r as Record<string, unknown> | null;
  if (!x || typeof x !== "object" || !Number.isInteger(x.step) || typeof x.card_id !== "string" || typeof x.device_id !== "string") return null;
  return {
    step: x.step as number, furthestStep: Number.isInteger(x.furthest_step) ? x.furthest_step as number : x.step as number, cardId: x.card_id,
    sectionChunkId: typeof x.section_chunk_id === "string" ? x.section_chunk_id : null, offsetHint: Number.isInteger(x.offset_hint) ? x.offset_hint as number : null,
    lastCompletedActivity: typeof x.last_completed_activity === "string" ? x.last_completed_activity : null,
    lastCompletedAt: typeof x.last_completed_at === "string" ? x.last_completed_at : null, unfinished: cleanUnfinished(x.unfinished),
    deviceId: x.device_id, clientSeq: Number(x.client_seq ?? 0), clientUpdatedAt: String(x.client_updated_at ?? ""),
    revision: Number(x.revision ?? 1), updatedAt: String(x.updated_at ?? ""),
  };
}

// ── WHERE THE WORKSPACE OPENS ──

/**
 * Pure. Merge this device's copy (learn-journey.ts SavedJourney: anchor, revealedUpTo, updatedAt) with the server position.
 * The server wins when its device time is later than this device's copy (or this device has none); the lessons revealed are
 * the furthest either knows. Indices are clamped to the session as it is now. `fallback`: the 414 current_step's index.
 */
export function mergeResume(input: {
  steps: readonly number[]; fallback: number;
  local: { anchor: number; revealedUpTo: number; updatedAt: string } | null; server: ServerPosition | null;
}): { anchor: number; revealedUpTo: number; from: "server" | "device" | "session"; practiceOpen: number | null; marks: InlineMarks } {
  const last = Math.max(0, input.steps.length - 1);
  const clamp = (i: number) => Math.max(0, Math.min(last, Number.isInteger(i) ? i : 0));
  const idx = (stepNo: number) => { const i = input.steps.indexOf(stepNo); return i >= 0 ? i : -1; };
  const s = input.server;
  const serverAt = s ? idx(s.step) : -1;
  const serverFar = s ? Math.max(serverAt, idx(s.furthestStep)) : -1;
  const serverWins = s !== null && serverAt >= 0 && (!input.local || t(s.clientUpdatedAt) > t(input.local.updatedAt));
  const anchor = serverWins ? serverAt : input.local ? clamp(input.local.anchor) : clamp(input.fallback);
  const revealedUpTo = clamp(Math.max(anchor, input.local?.revealedUpTo ?? 0, serverFar));
  const practiceStep = serverWins ? s?.unfinished?.practiceOpen ?? null : null;
  return { anchor, revealedUpTo, from: serverWins ? "server" : input.local ? "device" : "session", practiceOpen: practiceStep !== null && idx(practiceStep) >= 0 ? practiceStep : null,
    // The inline-check marks are the learner's own words on a lesson: read whichever copy is newer, never dropped for a position.
    marks: cleanMarks(s?.unfinished) };
}

// ── WHEN THE PAGE WRITES ──

export type SyncEvent = "lesson" | "jump" | "continue" | "activity" | "practice";
export type SyncResult = { provisioned: boolean; accepted?: boolean; position?: ServerPosition | null } | null;
type Timer = unknown;

/** A per-device, per-tab monotone sequence that needs no storage: never below the last one, never below the clock. */
export const nextSeq = (prev: number, nowMs: number) => Math.max(prev + 1, Math.floor(nowMs));

export class PositionSync {
  private dirty = false;
  private inFlight = false;
  private again = false;
  private off = false;
  private seq = 0;
  private lastSentAt = -Infinity;
  private lastSent: string | null = null;
  private timer: Timer | null = null;
  private keepaliveNext = false;
  base: number | null = null;

  constructor(private o: {
    deviceId: string;
    read: () => PositionDraft | null;
    send: (p: PositionPut, opts: { keepalive: boolean }) => Promise<SyncResult>;
    now?: () => number;
    setTimer?: (fn: () => void, ms: number) => Timer;
    clearTimer?: (h: Timer) => void;
    intervalMs?: number;
  }) {}

  private now() { return this.o.now ? this.o.now() : Date.now(); }
  private schedule(ms: number) {
    if (this.timer !== null) return;
    const set = this.o.setTimer ?? ((fn: () => void, d: number) => setTimeout(fn, d));
    this.timer = set(() => { this.timer = null; void this.flush(false); }, Math.max(0, ms));
  }
  private unschedule() {
    if (this.timer === null) return;
    (this.o.clearTimer ?? ((h: Timer) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
  }

  /** The server position this device has seen (on load, and from every write's answer): later moves are "informed". */
  adopt(p: ServerPosition | null) { if (p) this.base = p.revision; }
  /** 790 is absent (or the learner left the session): nothing more is written. Learn stays device-only. */
  disable() { this.off = true; this.unschedule(); }
  get disabled() { return this.off; }

  /** An interaction (scroll, typing): never a write by itself. At most one write per interval, and only if it changed. */
  touch() {
    if (this.off) return;
    this.dirty = true;
    this.schedule(this.lastSentAt + (this.o.intervalMs ?? SYNC_INTERVAL_MS) - this.now());
  }
  /** A meaningful event: written at once (bursts in the same moment coalesce into one write). */
  event(kind: SyncEvent) {
    void kind; // which event it was does not change the timing: every meaningful event is written at once
    if (this.off) return;
    this.dirty = true;
    this.unschedule();
    this.schedule(EVENT_COALESCE_MS);
  }
  /** The page is hidden or closing: what is dirty is sent now, with keepalive so it survives the page. */
  hide() {
    if (this.off || !this.dirty) return;
    this.unschedule();
    void this.flush(true);
  }

  async flush(keepalive: boolean): Promise<void> {
    if (this.off || !this.dirty) return;
    if (this.inFlight) { this.again = true; this.keepaliveNext = this.keepaliveNext || keepalive; return; }
    const draft = this.o.read();
    if (!draft) return;
    const key = JSON.stringify(draft);
    if (key === this.lastSent) { this.dirty = false; return; }
    const now = this.now();
    this.seq = nextSeq(this.seq, now);
    const put: PositionPut = { ...draft, deviceId: this.o.deviceId, clientSeq: this.seq, baseRevision: this.base, clientUpdatedAt: new Date(now).toISOString() };
    this.dirty = false; this.inFlight = true; this.lastSentAt = now;
    let r: SyncResult = null;
    try { r = await this.o.send(put, { keepalive }); } catch { r = null; }
    this.inFlight = false;
    if (r && r.provisioned === false) { this.disable(); return; }
    if (r && r.position) this.adopt(r.position);
    // Not reached: still this device's to send next time. Refused as stale: dropped -- the server's position is now seen,
    // so only the learner's NEXT move on this device (an informed one) is written, never the stale one again.
    if (!r) this.dirty = true;
    else if (r.accepted) this.lastSent = key;
    if (this.again) { this.again = false; const k = this.keepaliveNext; this.keepaliveNext = false; if (k) await this.flush(true); else this.schedule(EVENT_COALESCE_MS); }
  }
}

/** A random device id for this browser (kept in localStorage by the page; a fresh one per visit where storage is blocked). */
export function newDeviceId(rand: (n: number) => Uint8Array = n => { const b = new Uint8Array(n); globalThis.crypto.getRandomValues(b); return b; }): string {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  return [...rand(18)].map(x => abc[x & 63]).join("");
}
