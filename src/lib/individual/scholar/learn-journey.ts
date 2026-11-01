// SCHOLAR-COMPANION-01 P0b: THE CONTINUOUS SCROLL LEARNING JOURNEY -- the pure state model the Learn workspace
// (learn-client.tsx) runs on. Client-safe: no server imports, no timers, no I/O. The route (learn/act) still decides
// everything that matters -- what is saved, what may be generated, the allowance, grounding -- and the client still
// gates every Teach with shouldAutoTeach / consent / policy. This file only decides WHEN the page may ask.
//
// The journey is the session's planned lessons (learn.ts planSteps, no AI) revealed one after another in ONE scroll
// column. It is not a chatbot transcript and not a new stage: every lesson keeps its existing actions.
//
//   THE GENERATE RULE (a vitest proves it): only these can emit a `teach` effect -- the one effect that may lead
//   to an AI call (open:true first, then the Teach the route dedupes):
//     1. select / next /  the learner made a lesson ACTIVE (tapped it, Next lesson, Continue) in Guided learning AND the
//        chooseContinue   server records say nothing is saved for it. A lesson with saved teaching is only ever opened.
//     2. requestTeach     the learner pressed Start learning / Continue learning / a Teach button on a lesson
//     3. startJourney     guided auto-teach of the FIRST lesson of a NEW scope with nothing saved. A resume (restoring
//                         history) never teaches: it opens the active lesson saved-only (zero AI).
//   Everything else -- scrolling (viewed, scrollReachedEnd), jumping (jumpTo), saved replies -- emits at most an `open`
//   effect: open:true, which returns a saved lesson or nothing, NEVER an AI call.
//   At most ONE teach is in flight: a new one replaces (aborts) the old, and the same lesson is never asked twice.
//
//   SCHOLAR-PERSISTENT-LEARNING-01 (owner, 1 Nov) -- THE POSITION RULE: `current` is the ACTIVE lesson, the one the
//   learner chose (select, Next, Previous, Continue, Resume). Scrolling never moves it (`viewed` only loads what is saved),
//   so the server's current_step is never pulled back by a lesson merely scrolled past. Progress is never read from the
//   position: each lesson's state (lessonFacts below) comes from the server records -- learning events, saved teaching,
//   attempts -- so a regressed or stale position can hide nothing that was learned.
//
//   PREFETCH (policy scholar_learn_prepare_next, default off): only after the FRONTIER lesson (the last revealed) is
//   taught, only the one after it, never further. It is aborted when the learner jumps elsewhere; a Continue to the
//   prefetched lesson keeps it (the route dedupes the Teach against it).
//
// ⚠ Learning progress is not verified competence: "Read" and "Checked" are learning marks for the learner, never
// assessment evidence or a Passport record.

import { OPENABLE_ACTIONS } from "./guided-learn";
import type { QuickMark, RecallMark } from "./learn-inline";

export type LessonState = "outline" | "saved" | "taught" | "checked";
export type ActivityKind = "read" | "deeper" | "examples" | "practised" | "applied";
/**
 * `recalled` / `quickChecked` (SCHOLAR-INLINE-CHECKS-01): the learner's own recall rating on the inline card, and the result of the
 * quick check marked by code. Neither is a score or verified competence (learn-inline.ts).
 */
export type Activities = Partial<Record<ActivityKind, boolean>> & { verdict?: string | null; recalled?: RecallMark; quickChecked?: QuickMark };

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
  /** The server records say teaching is SAVED for this lesson (any version): making it active opens it, never teaches. */
  hasSaved: boolean[];
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
  /** The learner made this lesson active (a tap in the list or navigator, Resume). Guided + nothing saved: taught. */
  | { type: "select"; index: number; guided: boolean }
  /** Next lesson: the one after the ACTIVE lesson, made active and opened or taught in one action. */
  | { type: "next"; guided: boolean }
  | { type: "requestTeach"; index: number }
  /** `missing`: the route answered that nothing is saved (not merely unreachable): the lesson is no longer treated as saved. */
  | { type: "savedLoaded"; index: number; found: boolean; missing?: boolean }
  | { type: "taught"; index: number }
  | { type: "teachEnded"; index: number }
  | { type: "verdict"; index: number; value: string }
  | { type: "activity"; index: number; kind: ActivityKind }
  /** An inline check's outcome (a recall rating, a quick-check result). Written at once; never a request. */
  | { type: "mark"; index: number; recalled?: RecallMark; quickChecked?: QuickMark }
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
  /** The server records: saved teaching per lesson (any version, depth or mode). */
  saved?: readonly boolean[];
}): JourneyState {
  const count = Math.max(0, Math.floor(input.count));
  const last = Math.max(0, count - 1);
  const current = clamp(input.current, 0, last);
  const touched = (input.progress ?? []).reduce((m, p, i) => (p && (p.verdict || p.actions.some(a => LEARN_MARKS.includes(a))) ? i : m), -1);
  const savedUpTo = (input.saved ?? []).reduce((m, v, i) => (v && i < count ? i : m), -1);
  // Every lesson up to the furthest one taught or saved is available, whatever the position says.
  const revealedUpTo = clamp(Math.max(input.revealedUpTo ?? 0, current, touched, savedUpTo), 0, last);
  const lessons: LessonState[] = [], activities: Activities[] = [];
  for (let i = 0; i < count; i++) {
    const p = input.progress?.[i], a = { ...(input.activities?.[i] ?? {}) };
    if (p?.verdict) a.verdict = p.verdict;
    if (p?.actions.includes("deeper")) a.deeper = true;
    if (p?.actions.includes("examples")) a.examples = true;
    lessons.push(a.verdict ? "checked" : "outline");
    activities.push(a);
  }
  const hasSaved = lessons.map((_, i) => !!input.saved?.[i]);
  return { count, revealedUpTo, current, lessons, opened: lessons.map(() => false), activities, generating: null, prefetching: null, endVisible: false, hasSaved };
}

/**
 * Pure. What opening the workspace asks for. A NEW scope, guided, with nothing saved: teach its first lesson (the client
 * still gates it). Anything else -- Manual, a lesson with saved teaching, and every RESUME -- opens the active lesson
 * saved-only: restoring history never costs AI.
 */
export function startJourney(s: JourneyState, guided: boolean, resume = false): { state: JourneyState; effects: JourneyEffect[] } {
  if (!s.count) return { state: s, effects: [] };
  if (guided && !resume && !s.hasSaved[s.current]) return teachInto(s, s.current, true);
  return openSaved(s, s.current);
}

/** Pure. The learner made `index` active: revealed, scrolled to, prefetch elsewhere dropped, then opened or (guided, nothing saved) taught. */
function makeActive(s: JourneyState, index: number, guided: boolean): { state: JourneyState; effects: JourneyEffect[] } {
  const base: JourneyState = { ...s, revealedUpTo: Math.max(s.revealedUpTo, index), current: index, endVisible: false };
  const effects: JourneyEffect[] = [{ kind: "scrollTo", index }];
  if (s.prefetching !== null && s.prefetching !== index) { effects.push({ kind: "abortPrefetch" }); base.prefetching = null; }
  const r = guided && !s.hasSaved[index] && !shown(s, index) ? teachInto(base, index, false) : openSaved(base, index);
  return { state: r.state, effects: [...effects, ...r.effects] };
}

/** The lesson's teaching is on the page already (opened from saved, or taught this visit). */
const shown = (s: JourneyState, index: number) => s.lessons[index] === "saved" || s.lessons[index] === "taught";

function openSaved(s: JourneyState, index: number): { state: JourneyState; effects: JourneyEffect[] } {
  if (s.opened[index] || shown(s, index) || s.generating === index) return { state: s, effects: [] };
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
      // Scrolling: a lesson in view that is not loaded yet loads what is SAVED. It never becomes the active lesson (the
      // position rule: only the learner's choice moves `current`), and it is never a teach.
      if (!valid(e.index) || e.index > s.revealedUpTo) return none;
      return openSaved(s, e.index);
    }
    case "nearView": {
      // About to scroll into view: load what is SAVED, so it is there when it arrives. Current does not move. Never a teach.
      if (!valid(e.index) || e.index > s.revealedUpTo) return none;
      return openSaved(s, e.index);
    }
    case "scrollReachedEnd": return s.endVisible ? none : { state: { ...s, endVisible: true }, effects: [] };
    case "scrollLeftEnd": return s.endVisible ? { state: { ...s, endVisible: false }, effects: [] } : none;
    case "chooseContinue":
    case "next": {
      // The lesson after the ACTIVE one (not after the furthest revealed): made active, opened or taught in one action.
      if (s.current >= s.count - 1) return none;
      return makeActive(s, s.current + 1, e.guided);
    }
    case "select": {
      if (!valid(e.index)) return none;
      return makeActive(s, e.index, e.guided);
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
      if (!valid(e.index)) return none;
      if (!e.found) {
        if (!e.missing || !s.hasSaved[e.index]) return none;
        const hasSaved = s.hasSaved.slice(); hasSaved[e.index] = false;
        return { state: { ...s, hasSaved }, effects: [] };
      }
      const lessons = s.lessons.slice(); lessons[e.index] = raise(lessons[e.index], "saved");
      const hasSaved = s.hasSaved.slice(); hasSaved[e.index] = true;
      return { state: { ...s, lessons, hasSaved }, effects: [] };
    }
    case "taught": {
      if (!valid(e.index)) return none;
      const lessons = s.lessons.slice(); lessons[e.index] = raise(lessons[e.index], "taught");
      const activities = s.activities.slice(); activities[e.index] = { ...activities[e.index], read: true };
      const hasSaved = s.hasSaved.slice(); hasSaved[e.index] = true;
      const next: JourneyState = { ...s, lessons, activities, hasSaved, generating: s.generating === e.index ? null : s.generating };
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
    case "mark": {
      if (!valid(e.index)) return none;
      const activities = s.activities.slice();
      const cur = activities[e.index] ?? {};
      // A skip never replaces a rating the learner already gave.
      const recalled = e.recalled && !(e.recalled === "skipped" && cur.recalled && cur.recalled !== "skipped") ? e.recalled : cur.recalled;
      activities[e.index] = { ...cur, ...(recalled ? { recalled } : {}), ...(e.quickChecked ? { quickChecked: e.quickChecked } : {}) };
      return { state: { ...s, activities }, effects: [] };
    }
    case "prefetchEnded": return s.prefetching === null ? none : { state: { ...s, prefetching: null }, effects: [] };
  }
}

// ── THE LESSON STATES, FROM SERVER RECORDS (SCHOLAR-PERSISTENT-LEARNING-01, no AI) ──
//
// Four states per lesson, each from records the server already keeps (store.ts learnLessonRecords + learningEvents),
// never from the position and never from a model:
//   read       any learning event for the lesson except a skip, or the lesson the position stands on
//   taught     a teach-family event (Teach, Explain, Simplify, Go deeper, Examples, Summarise) for the lesson, OR a
//              saved teaching artefact for the lesson's own chunk set (any prompt version, depth or mode)
//   completed  THE COMPLETION RULE: taught AND read, AND -- only where policy scholar_check_behaviour is "prompt"
//              (a check suggested after each step) -- an informal check answered (any verdict). "offer" and "off" ask no check.
//   assessed   the latest informal check verdict (understood / partly / not yet), else "practised" when questions on
//              the lesson's own sections have been attempted. LEARNING PROGRESS for the learner, never verified competence.

export type CheckRule = "offer" | "prompt" | "off";
export type Assessed = "understood" | "partly" | "not_yet" | "practised" | null;
export type LessonFacts = { read: boolean; taught: boolean; saved: boolean; completed: boolean; assessed: Assessed };
/** One lesson's server records (store.ts learnLessonRecords): its newest saved teaching and attempts on its sections. */
export type LessonRecord = { step: number; saved: { at: string; promptVersion: string; depth: string } | null; attempts: number };

const VERDICT_LABEL: Record<string, string> = { understood: "understood", partly: "partly", not_yet: "not yet" };
const TEACH_FAMILY: readonly string[] = OPENABLE_ACTIONS;

/** Pure. THE STATE RULE (above). `live`: this visit's marks (an activity, a verdict); `shown`: teaching on the page now. */
export function lessonFacts(x: {
  actions?: readonly string[]; verdict?: string | null; saved?: boolean; attempts?: number; visited?: boolean;
  live?: Activities; shown?: boolean; check: CheckRule;
  /** A required recall check this lesson belongs to is not rated yet (learn-inline.ts): the lesson is not counted complete. */
  recallPending?: boolean;
}): LessonFacts {
  const actions = x.actions ?? [], live = x.live ?? {};
  const verdict = live.verdict ?? x.verdict ?? null;
  const read = !!x.visited || !!live.read || !!x.shown || actions.some(a => a !== "skip");
  const taught = !!x.saved || !!x.shown || actions.some(a => TEACH_FAMILY.includes(a));
  const assessed: Assessed = verdict && verdict in VERDICT_LABEL ? verdict as Assessed : (x.attempts ?? 0) > 0 || live.practised ? "practised" : null;
  const completed = taught && read && !x.recallPending && (x.check === "prompt" ? !!verdict : true);
  return { read, taught, saved: !!x.saved || !!x.shown, completed, assessed };
}

/** Pure. One lesson's facts inside the journey: the server records merged with what this visit did. */
export function journeyFacts(s: JourneyState, index: number, input: { progress?: StepProgress; record?: LessonRecord | null; visited?: boolean; check: CheckRule; recallPending?: boolean }): LessonFacts {
  return lessonFacts({
    // `hasSaved` starts from the records (createJourney) and is cleared only when the route says nothing is saved after all.
    actions: input.progress?.actions, verdict: input.progress?.verdict ?? null, saved: !!s.hasSaved[index],
    attempts: input.record?.attempts ?? 0, visited: input.visited, live: s.activities[index], shown: s.lessons[index] === "saved" || s.lessons[index] === "taught", check: input.check, recallPending: input.recallPending,
  });
}

/** The one primary way into a lesson: its saved teaching (no AI), or the learner's own start. */
export type PrimaryAction = "review" | "continue" | "start";
export const PRIMARY_LABEL: Record<PrimaryAction, string> = { review: "Review saved lesson", continue: "Continue learning", start: "Start learning" };
/** Pure. Review saved lesson (saved exists) / Continue learning (the active lesson, read but not taught) / Start learning. */
export const primaryAction = (f: LessonFacts, active: boolean): PrimaryAction => (f.saved ? "review" : active && f.read ? "continue" : "start");

// ── THE NAVIGATOR'S WORDS (text + icon, never colour alone) ──

export type LessonStatus = { label: string; icon: "current" | "completed" | "checked" | "taught" | "read" | "none"; current: boolean };

/** Pure. One lesson's line in the navigator and the lesson list, from its facts. */
export function lessonStatus(s: JourneyState, index: number, f: LessonFacts): LessonStatus {
  const current = index === s.current;
  const main = f.completed ? "Completed" : f.taught ? "Taught" : f.read ? "Read" : "Not started";
  const extra = f.assessed === "practised" ? "Practised" : f.assessed ? `Checked: ${VERDICT_LABEL[f.assessed]}` : null;
  const icon: LessonStatus["icon"] = f.completed ? "completed" : f.assessed && f.assessed !== "practised" ? "checked" : f.taught ? "taught" : f.read ? "read" : "none";
  const label = extra ? `${main} · ${extra}` : main;
  return current ? { label: `Current · ${label}`, icon: "current", current } : { label, icon, current };
}

/** Pure. Lessons read, for "Lesson 3 of 8 · 2 read". A learning mark, never a score. */
export const readCount = (facts: readonly LessonFacts[]) => facts.filter(f => f.read).length;

// ── SAVED TEACHING, FOUND WITHOUT AI (the open:true fallback, and the records) ──

/**
 * Pure. Whether a saved artefact was written for exactly this lesson: its sources BEGIN with the lesson's own sections
 * (the route saves the lesson's own passages first, then any related ones), as a set -- not merely one that cites them.
 */
export function coversLesson(sources: readonly string[], chunkIds: readonly string[]): boolean {
  const want = new Set(chunkIds);
  if (!want.size || want.size !== chunkIds.length || sources.length < want.size) return false;
  return sources.slice(0, want.size).every(id => want.has(id));
}

/** Pure. The newest saved artefact for this action, material and lesson chunk set -- any prompt version, depth or mode. */
export function newestSavedLesson<T extends { action: string; materialId: string; sources: readonly string[]; createdAt: string }>(
  rows: readonly T[], q: { action: string; materialId?: string | null; chunkIds: readonly string[] },
): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.action !== q.action || (q.materialId && r.materialId !== q.materialId) || !coversLesson(r.sources, q.chunkIds)) continue;
    if (!best || r.createdAt > best.createdAt) best = r;
  }
  return best;
}

/** What a lesson saved under another prompt version or settings says, beside the button that rewrites it (an explicit AI call). */
export const SAVED_EARLIER_LABEL = "Saved earlier — Refresh lesson for the latest version";

// ── PROGRESSIVE TEACHING (item 4): the start first, the rest behind "Show more" ──

/** Pure. A long answer as its lead (whole paragraphs, at least one) and the rest. Nothing is cut inside a paragraph, so no citation splits. */
export function progressiveSplit(text: string, leadChars = 700): { lead: string; more: string } {
  const paras = text.split(/\n\s*\n/);
  if (paras.length < 2) return { lead: text, more: "" };
  let n = 1, len = paras[0].length;
  while (n < paras.length && len + paras[n].length <= leadChars) { len += paras[n].length; n++; }
  return n >= paras.length ? { lead: text, more: "" } : { lead: paras.slice(0, n).join("\n\n"), more: paras.slice(n).join("\n\n") };
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
        const rc = (a as Activities).recalled;
        if (rc === "remembered" || rc === "again" || rc === "skipped") out.recalled = rc;
        const qc = (a as Activities).quickChecked;
        if (qc === "correct" || qc === "wrong") out.quickChecked = qc;
      }
      return out;
    });
    return { v: 1, revealedUpTo: clamp(x.revealedUpTo, 0, count - 1), anchor: clamp(x.anchor, 0, count - 1), activities, updatedAt: typeof x.updatedAt === "string" ? x.updatedAt : "" };
  } catch { return null; }
}
