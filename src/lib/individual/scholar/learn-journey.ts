// SCHOLAR-COMPANION-01 P0b: THE CONTINUOUS SCROLL LEARNING JOURNEY -- the pure state model the Learn workspace
// (learn-client.tsx) runs on. Client-safe: no server imports, no timers, no I/O. The route (learn/act) still decides
// everything that matters -- what is saved, what may be generated, the allowance, grounding -- and the client still
// gates every Teach with shouldAutoTeach / consent / policy. This file only decides WHEN the page may ask.
//
// The journey is the session's planned lessons (learn.ts planSteps, no AI) revealed one after another in ONE scroll
// column. It is not a chatbot transcript and not a new stage: every lesson keeps its existing actions.
//
//   THE GENERATE RULE (a vitest proves it): only three things can emit a `teach` effect -- the one effect that may lead
//   to an AI call (open:true first, then the Teach the route dedupes):
//     1. chooseContinue   the learner chose "Continue to lesson N+1" (guided; Manual opens it saved-only)
//     2. requestTeach     the learner pressed a Teach button on a lesson
//     3. startJourney     guided auto-teach of the CURRENT lesson when the workspace opens (the first lesson of a new
//                         scope, or the lesson a resume lands on) -- as the one-lesson workspace always did.
//   Everything else -- scrolling (viewed, scrollReachedEnd), jumping from the navigator (jumpTo), saved replies --
//   emits at most an `open` effect: open:true, which returns a saved lesson or nothing, NEVER an AI call.
//   At most ONE teach is in flight: a new one replaces (aborts) the old, and the same lesson is never asked twice.
//
//   PREFETCH (policy scholar_learn_prepare_next, default off): only after the FRONTIER lesson (the last revealed) is
//   taught, only the one after it, never further. It is aborted when the learner jumps elsewhere; a Continue to the
//   prefetched lesson keeps it (the route dedupes the Teach against it).
//
// ⚠ Learning progress is not verified competence: "Read" and "Checked" are learning marks for the learner, never
// assessment evidence or a Passport record.

export type LessonState = "outline" | "saved" | "taught" | "checked";
export type ActivityKind = "read" | "deeper" | "examples" | "practised" | "applied";
export type Activities = Partial<Record<ActivityKind, boolean>> & { verdict?: string | null };

export type JourneyState = {
  count: number;
  /** Index of the last lesson shown in the column (0-based). Lessons after it are not on the page yet. */
  revealedUpTo: number;
  /** Index of the lesson being read (the navigator's Current; the server's current_step follows it after a dwell). */
  current: number;
  lessons: LessonState[];
  /** A saved-only open was asked for this lesson during this visit (never asked again by itself). */
  opened: boolean[];
  activities: Activities[];
  /** The ONE lesson whose teach is in flight, or null. */
  generating: number | null;
  /** The lesson being prepared ahead, or null. */
  prefetching: number | null;
  /** The end-of-journey sentinel is on screen (shows the Continue card; never a request). */
  endVisible: boolean;
};

export type JourneyEffect =
  | { kind: "open"; index: number }
  | { kind: "teach"; index: number; auto: boolean }
  | { kind: "abort"; index: number }
  | { kind: "prefetch"; index: number }
  | { kind: "abortPrefetch" }
  | { kind: "scrollTo"; index: number };

export type JourneyEvent =
  | { type: "viewed"; index: number }
  | { type: "nearView"; index: number }
  | { type: "scrollReachedEnd" }
  | { type: "scrollLeftEnd" }
  | { type: "chooseContinue"; guided: boolean }
  | { type: "jumpTo"; index: number }
  | { type: "requestTeach"; index: number }
  | { type: "savedLoaded"; index: number; found: boolean }
  | { type: "taught"; index: number }
  | { type: "teachEnded"; index: number }
  | { type: "verdict"; index: number; value: string }
  | { type: "activity"; index: number; kind: ActivityKind }
  | { type: "prefetchEnded" };

export type JourneyOptions = { prepareNext: boolean };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(Number.isFinite(n) ? n : lo)));
const RANK: Record<LessonState, number> = { outline: 0, saved: 1, taught: 2, checked: 3 };
const raise = (from: LessonState, to: LessonState): LessonState => (RANK[to] > RANK[from] ? to : from);

/** The learner's recorded progress for one lesson (learning_event: actions + latest informal verdict). */
export type StepProgress = { actions: readonly string[]; verdict: string | null } | undefined;
const LEARN_MARKS = ["teach", "explain", "simplify", "deeper", "examples", "summary", "ask", "check", "clarify"];

/** Pure. The journey as the workspace opens: the lessons revealed so far, the current one, the recorded marks. */
export function createJourney(input: {
  count: number; current: number; revealedUpTo?: number; progress?: readonly StepProgress[]; activities?: readonly (Activities | undefined)[];
}): JourneyState {
  const count = Math.max(0, Math.floor(input.count));
  const last = Math.max(0, count - 1);
  const current = clamp(input.current, 0, last);
  const touched = (input.progress ?? []).reduce((m, p, i) => (p && (p.verdict || p.actions.some(a => LEARN_MARKS.includes(a))) ? i : m), -1);
  const revealedUpTo = clamp(Math.max(input.revealedUpTo ?? 0, current, touched), 0, last);
  const lessons: LessonState[] = [], activities: Activities[] = [];
  for (let i = 0; i < count; i++) {
    const p = input.progress?.[i], a = { ...(input.activities?.[i] ?? {}) };
    if (p?.verdict) a.verdict = p.verdict;
    if (p?.actions.includes("deeper")) a.deeper = true;
    if (p?.actions.includes("examples")) a.examples = true;
    lessons.push(a.verdict ? "checked" : "outline");
    activities.push(a);
  }
  return { count, revealedUpTo, current, lessons, opened: lessons.map(() => false), activities, generating: null, prefetching: null, endVisible: false };
}

/** Pure. What opening the workspace asks for: guided -> teach the CURRENT lesson (the client still gates it); Manual -> saved only. */
export function startJourney(s: JourneyState, guided: boolean): { state: JourneyState; effects: JourneyEffect[] } {
  if (!s.count) return { state: s, effects: [] };
  if (guided) return teachInto(s, s.current, true);
  return openSaved(s, s.current);
}

function openSaved(s: JourneyState, index: number): { state: JourneyState; effects: JourneyEffect[] } {
  if (s.opened[index] || s.lessons[index] !== "outline" || s.generating === index) return { state: s, effects: [] };
  const opened = s.opened.slice(); opened[index] = true;
  return { state: { ...s, opened }, effects: [{ kind: "open", index }] };
}

function teachInto(s: JourneyState, index: number, auto: boolean): { state: JourneyState; effects: JourneyEffect[] } {
  if (s.generating === index) return { state: s, effects: [] }; // the same lesson is never asked twice at once
  const effects: JourneyEffect[] = [];
  const opened = s.opened.slice();
  // The old lesson's request is cancelled; it may still be saved by the route, so a later view opens it again (saved only).
  if (s.generating !== null) { effects.push({ kind: "abort", index: s.generating }); opened[s.generating] = false; }
  opened[index] = true; // the teach opens it saved-first itself
  effects.push({ kind: "teach", index, auto });
  return { state: { ...s, opened, generating: index }, effects };
}

/** Pure. One event: the next state and what the page must do. */
export function journeyStep(s: JourneyState, e: JourneyEvent, o: JourneyOptions): { state: JourneyState; effects: JourneyEffect[] } {
  const none = { state: s, effects: [] as JourneyEffect[] };
  const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < s.count;
  switch (e.type) {
    case "viewed": {
      // Scrolling: the lesson in view becomes Current, and a lesson not loaded yet loads what is SAVED. Never a teach.
      if (!valid(e.index) || e.index > s.revealedUpTo) return none;
      const moved = e.index === s.current ? s : { ...s, current: e.index };
      return openSaved(moved, e.index);
    }
    case "nearView": {
      // About to scroll into view: load what is SAVED, so it is there when it arrives. Current does not move. Never a teach.
      if (!valid(e.index) || e.index > s.revealedUpTo) return none;
      return openSaved(s, e.index);
    }
    case "scrollReachedEnd": return s.endVisible ? none : { state: { ...s, endVisible: true }, effects: [] };
    case "scrollLeftEnd": return s.endVisible ? { state: { ...s, endVisible: false }, effects: [] } : none;
    case "chooseContinue": {
      if (s.revealedUpTo >= s.count - 1) return none;
      const next = s.revealedUpTo + 1;
      const base: JourneyState = { ...s, revealedUpTo: next, current: next, endVisible: false };
      const effects: JourneyEffect[] = [{ kind: "scrollTo", index: next }];
      if (s.prefetching !== null && s.prefetching !== next) { effects.push({ kind: "abortPrefetch" }); base.prefetching = null; }
      const r = e.guided ? teachInto(base, next, false) : openSaved(base, next);
      return { state: r.state, effects: [...effects, ...r.effects] };
    }
    case "jumpTo": {
      // The navigator: reveal up to that lesson as an outline, scroll to it, load what is saved. Never a teach.
      if (!valid(e.index)) return none;
      const base: JourneyState = { ...s, revealedUpTo: Math.max(s.revealedUpTo, e.index), current: e.index };
      const effects: JourneyEffect[] = [{ kind: "scrollTo", index: e.index }];
      if (s.prefetching !== null && s.prefetching !== e.index) { effects.push({ kind: "abortPrefetch" }); base.prefetching = null; }
      const r = openSaved(base, e.index);
      return { state: r.state, effects: [...effects, ...r.effects] };
    }
    case "requestTeach": {
      if (!valid(e.index) || e.index > s.revealedUpTo) return none;
      return teachInto(s, e.index, false);
    }
    case "savedLoaded": {
      if (!valid(e.index) || !e.found) return none;
      const lessons = s.lessons.slice(); lessons[e.index] = raise(lessons[e.index], "saved");
      return { state: { ...s, lessons }, effects: [] };
    }
    case "taught": {
      if (!valid(e.index)) return none;
      const lessons = s.lessons.slice(); lessons[e.index] = raise(lessons[e.index], "taught");
      const activities = s.activities.slice(); activities[e.index] = { ...activities[e.index], read: true };
      const next: JourneyState = { ...s, lessons, activities, generating: s.generating === e.index ? null : s.generating };
      if (o.prepareNext && e.index === s.revealedUpTo && e.index < s.count - 1 && s.prefetching === null)
        return { state: { ...next, prefetching: e.index + 1 }, effects: [{ kind: "prefetch", index: e.index }] };
      return { state: next, effects: [] };
    }
    case "teachEnded": return s.generating === e.index ? { state: { ...s, generating: null }, effects: [] } : none;
    case "verdict": {
      if (!valid(e.index)) return none;
      const lessons = s.lessons.slice(); lessons[e.index] = "checked";
      const activities = s.activities.slice(); activities[e.index] = { ...activities[e.index], verdict: e.value, read: true };
      return { state: { ...s, lessons, activities }, effects: [] };
    }
    case "activity": {
      if (!valid(e.index)) return none;
      const activities = s.activities.slice(); activities[e.index] = { ...activities[e.index], [e.kind]: true };
      return { state: { ...s, activities }, effects: [] };
    }
    case "prefetchEnded": return s.prefetching === null ? none : { state: { ...s, prefetching: null }, effects: [] };
  }
}

// ── THE NAVIGATOR'S WORDS (text + icon, never colour alone) ──

export type LessonStatus = { label: string; icon: "current" | "checked" | "read" | "none"; current: boolean };
const VERDICT_LABEL: Record<string, string> = { understood: "understood", partly: "partly", not_yet: "not yet" };

/** Pure. A lesson's learning mark, apart from whether it is the current one. */
function markOf(s: JourneyState, index: number, progress?: StepProgress): { verdict: string | null; read: boolean } {
  const a = s.activities[index] ?? {};
  const verdict = a.verdict ?? progress?.verdict ?? null;
  const read = s.lessons[index] === "saved" || s.lessons[index] === "taught" || !!a.read || !!progress?.actions.some(x => LEARN_MARKS.includes(x));
  return { verdict, read };
}

/** Pure. One lesson's line in the navigator. */
export function lessonStatus(s: JourneyState, index: number, progress?: StepProgress): LessonStatus {
  const current = index === s.current;
  const { verdict, read } = markOf(s, index, progress);
  const base: LessonStatus = verdict ? { label: `Checked: ${VERDICT_LABEL[verdict] ?? verdict}`, icon: "checked", current }
    : read ? { label: "Read", icon: "read", current } : { label: "Not started", icon: "none", current };
  return current ? { ...base, label: `Current · ${base.label}`, icon: "current" } : base;
}

/** Pure. Lessons with any learning mark, for "Lesson 3 of 8 · 2 read". A learning mark, never a score. */
export function readCount(s: JourneyState, progress?: readonly StepProgress[]): number {
  let n = 0;
  for (let i = 0; i < s.count; i++) { const m = markOf(s, i, progress?.[i]); if (m.verdict || m.read) n++; }
  return n;
}

// ── CONTINUE WHERE I STOPPED (this device) ──
//
// Why not a server column: learning_session has no jsonb for a within-lesson position, and adding one is a migration
// (owner GO, staging x2). The server keeps what it already keeps -- current_step (PATCH sessions/[id]) and the
// learning events -- so another device resumes at the right LESSON; this device also remembers how far the column was
// revealed, the lesson being read and which activities were done. The owner can move this to a column later.

export const JOURNEY_KEY_PREFIX = "scholar.learn.journey.";
export const journeyKey = (sessionKey: string) => `${JOURNEY_KEY_PREFIX}${sessionKey}`;
export type SavedJourney = { v: 1; revealedUpTo: number; anchor: number; activities: Activities[]; updatedAt: string };

/** Pure. The device copy of a journey (indices, not content: nothing the learner wrote or was taught is kept here). */
export function savedJourney(s: JourneyState, now: Date = new Date(), anchor: number = s.current): SavedJourney {
  return { v: 1, revealedUpTo: s.revealedUpTo, anchor, activities: s.activities.map(a => ({ ...a })), updatedAt: now.toISOString() };
}

const KINDS: ActivityKind[] = ["read", "deeper", "examples", "practised", "applied"];
/** Pure. A stored journey, validated against the session as it is now (fewer lessons -> clamped). Anything odd -> null. */
export function parseSavedJourney(raw: string | null | undefined, count: number): SavedJourney | null {
  if (!raw || count <= 0) return null;
  try {
    const x = JSON.parse(raw) as Partial<SavedJourney>;
    if (!x || x.v !== 1 || typeof x.revealedUpTo !== "number" || typeof x.anchor !== "number") return null;
    const acts = Array.isArray(x.activities) ? x.activities.slice(0, count) : [];
    const activities = acts.map(a => {
      const out: Activities = {};
      if (a && typeof a === "object") {
        for (const k of KINDS) if ((a as Activities)[k] === true) out[k] = true;
        const v = (a as Activities).verdict;
        if (typeof v === "string" && v in VERDICT_LABEL) out.verdict = v;
      }
      return out;
    });
    return { v: 1, revealedUpTo: clamp(x.revealedUpTo, 0, count - 1), anchor: clamp(x.anchor, 0, count - 1), activities, updatedAt: typeof x.updatedAt === "string" ? x.updatedAt : "" };
  } catch { return null; }
}

/** Pure. The server's current_step follows the lesson in view after this dwell (ms); it can move back as well as on. */
export const DWELL_MS = 3000;
/** Pure. Whether a dwell on `index` should be sent to the server (only a real move, never below lesson 1). */
export const shouldSendPosition = (serverIndex: number, index: number) => Number.isInteger(index) && index >= 0 && index !== serverIndex;
