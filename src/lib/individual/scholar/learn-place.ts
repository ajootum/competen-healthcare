// ── SCHOLAR-LEARN-GAPS-02 item 2: THE READING PLACE WITHIN THE ACTIVE LESSON ─────────────────────────────────────────────
//
// Client-safe and pure: no server imports, no DOM, no I/O of its own. #214 removed every scroll observer, so scrolling never
// changes the active lesson. This file saves WHERE inside the active lesson the learner stopped reading, without touching
// current_step (the 790 position row carries card_id and offset_hint for exactly this; learn-position.ts decides the write).
//
//   1. PlaceScheduler  WHEN. A scroll only notes "the place may have changed"; the place is committed once the scrolling has
//      stopped for DEBOUNCE_MS, and never more than once per MIN_GAP_MS. Leaving the page (hidden, pagehide) commits what is
//      pending at once. Never a write per scroll event. (PositionSync in learn-position.ts then throttles the actual PUT.)
//   2. cardIdFor / parseCardId / pickAnchor  WHAT. A stable card id `lesson-<n>:<section anchor>` of the nearest section inside
//      the lesson card; the anchors are fixed ids in the lesson card (lessonAnchorId), so another device finds the same place.
//   3. choosePlace / placeScrollTop  WHERE TO RETURN. The server value when it is newer than this device's copy, else this
//      device's; a missing anchor falls back to the coarse percentage.
//
// A bookmark, never assessment evidence and never AI output.

export const PLACE_DEBOUNCE_MS = 2_000;
export const PLACE_MIN_GAP_MS = 15_000;
/** The same pattern the 790 PUT validates (learn-position.ts ID). */
const CARD_ID = /^[a-z0-9][a-z0-9:_-]{0,59}$/;
const ANCHOR = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** The DOM id of a section inside a lesson card: `lesson-<step>-<anchor>`. */
export const lessonAnchorId = (step: number, anchor: string) => `lesson-${step}-${anchor}`;
/** The id prefix every anchor of one lesson shares. */
export const lessonAnchorPrefix = (step: number) => `lesson-${step}-`;

/** Pure. `lesson-<n>` (the top), or `lesson-<n>:<anchor>`. Always a valid 790 card id. */
export function cardIdFor(step: number, anchor: string | null): string {
  const id = anchor && ANCHOR.test(anchor) ? `lesson-${step}:${anchor}` : `lesson-${step}`;
  return CARD_ID.test(id) ? id : `lesson-${step}`;
}

/** Pure. A card id as its lesson and anchor, or null when it is not a lesson card id. */
export function parseCardId(cardId: string | null | undefined): { step: number; anchor: string | null } | null {
  const m = /^lesson-(\d{1,5})(?::([a-z0-9][a-z0-9_-]{0,39}))?$/.exec(cardId ?? "");
  return m ? { step: Number(m[1]), anchor: m[2] ?? null } : null;
}

/**
 * Pure. The anchor of the section the reading band is in: the last anchor whose top is at or above the band, else the first.
 * `tops`: each section's top in viewport pixels, in any order. null when the lesson has none.
 */
export function pickAnchor(tops: readonly { anchor: string; top: number }[], bandY: number): string | null {
  const ok = tops.filter(t => ANCHOR.test(t.anchor) && Number.isFinite(t.top));
  if (!ok.length) return null;
  const sorted = [...ok].sort((a, b) => a.top - b.top);
  let hit = sorted[0];
  for (const t of sorted) if (t.top <= bandY) hit = t;
  return hit.anchor;
}

/** Pure. 0-100: how far through the lesson card the reading band is (clamped). */
export function offsetPercent(card: { top: number; height: number }, bandY: number): number | null {
  if (!(card.height > 0) || !Number.isFinite(card.top)) return null;
  return Math.max(0, Math.min(100, Math.round(((bandY - card.top) / card.height) * 100)));
}

export type Place = { cardId: string; offset: number | null; at: string };

/** Pure. The scrollTop that puts a saved percentage at the reading band again. */
export function placeScrollTop(input: { cardTop: number; cardHeight: number; offset: number; viewportHeight: number; scrollY: number; bandRatio?: number }): number {
  const band = input.viewportHeight * (input.bandRatio ?? 0.35);
  return Math.max(0, Math.round(input.scrollY + input.cardTop + (Math.max(0, Math.min(100, input.offset)) / 100) * input.cardHeight - band));
}

const t = (iso: string | null | undefined) => { const n = iso ? Date.parse(iso) : NaN; return Number.isFinite(n) ? n : -Infinity; };

/**
 * Pure. Where to return to in lesson `step`: the server position when it is for this lesson and newer than this device's copy
 * (device time, as mergeResume), else this device's copy for the lesson. null when neither knows a place in this lesson.
 */
export function choosePlace(input: {
  step: number; local: Place | null;
  server: { step: number; cardId: string; offsetHint: number | null; clientUpdatedAt: string } | null;
}): (Place & { from: "server" | "device" }) | null {
  const local = input.local && parseCardId(input.local.cardId)?.step === input.step ? input.local : null;
  const s = input.server && input.server.step === input.step && parseCardId(input.server.cardId)?.step === input.step
    ? { cardId: input.server.cardId, offset: input.server.offsetHint, at: input.server.clientUpdatedAt } : null;
  if (s && (!local || t(s.at) > t(local.at))) return { ...s, from: "server" };
  return local ? { ...local, from: "device" } : null;
}

// ── this device's copy: a small map per session, keyed by lesson step ──
export type LocalPlaces = Record<string, Place>;
export const placeKey = (sessionId: string) => `scholar.learn.place.${sessionId}`;
const MAX_LOCAL = 40;

/** Pure. A stored copy, or {} when it is not one. */
export function parseLocalPlaces(raw: string | null): LocalPlaces {
  try {
    const j = JSON.parse(raw ?? "{}") as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return {};
    const out: LocalPlaces = {};
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      const p = v as Partial<Place> | null;
      if (/^\d{1,5}$/.test(k) && p && typeof p.cardId === "string" && CARD_ID.test(p.cardId) && typeof p.at === "string"
        && (p.offset === null || (Number.isInteger(p.offset) && (p.offset as number) >= 0 && (p.offset as number) <= 100))) out[k] = { cardId: p.cardId, offset: p.offset ?? null, at: p.at };
    }
    return out;
  } catch { return {}; }
}

/** Pure. The copy with this lesson's place set (the oldest dropped beyond a bound). */
export function withLocalPlace(prev: LocalPlaces, step: number, place: Place): LocalPlaces {
  const next: LocalPlaces = { ...prev, [String(step)]: place };
  const keys = Object.keys(next);
  if (keys.length <= MAX_LOCAL) return next;
  for (const k of keys.sort((a, b) => t(next[a].at) - t(next[b].at)).slice(0, keys.length - MAX_LOCAL)) delete next[k];
  return next;
}

// ── WHEN: the debounce and the throttle ──
type Timer = unknown;

export class PlaceScheduler {
  private pending = false;
  private timer: Timer | null = null;
  private lastCommitAt = -Infinity;
  private off = false;

  constructor(private o: {
    /** The place is read and kept (and the position write asked for). `keepalive`: the page is going away. */
    commit: (keepalive: boolean) => void;
    now?: () => number;
    setTimer?: (fn: () => void, ms: number) => Timer;
    clearTimer?: (h: Timer) => void;
    debounceMs?: number;
    minGapMs?: number;
  }) {}

  private now() { return this.o.now ? this.o.now() : Date.now(); }
  private clear() {
    if (this.timer === null) return;
    (this.o.clearTimer ?? ((h: Timer) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
  }

  /** A scroll event: never a commit by itself. The commit comes DEBOUNCE after the last one, and not within MIN_GAP of the previous. */
  note() {
    if (this.off) return;
    this.pending = true;
    this.clear();
    const wait = Math.max(this.o.debounceMs ?? PLACE_DEBOUNCE_MS, this.lastCommitAt + (this.o.minGapMs ?? PLACE_MIN_GAP_MS) - this.now());
    const set = this.o.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    this.timer = set(() => { this.timer = null; this.fire(false); }, wait);
  }

  /** The page is hidden or closing: what is pending is committed now (with keepalive), whatever the gap. */
  hide() {
    if (this.off || !this.pending) return;
    this.clear();
    this.fire(true);
  }

  /** The workspace is leaving or the learner chose another lesson: nothing pending survives. */
  cancel() { this.pending = false; this.clear(); }
  stop() { this.off = true; this.cancel(); }
  get isPending() { return this.pending; }

  private fire(keepalive: boolean) {
    this.pending = false;
    this.lastCommitAt = this.now();
    this.o.commit(keepalive);
  }
}
