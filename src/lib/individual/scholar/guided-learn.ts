// SCHOLAR-GUIDED-LEARNING-01 G-B: GUIDED LEARNING, the pure parts the Learn workspace (learn-client.tsx) runs on.
// Client-safe: no server imports. The route (learn/act) decides everything that matters -- what is saved, what may be
// generated, the allowance, grounding and salvage; this file only decides WHEN the page asks and WHAT it offers.
//
//   lessonKey / LessonRequests   one lesson request in flight per lesson key (scope, step, action, mode, depth); a key
//                                asked for once is not asked for again by itself (a withheld or failed lesson never
//                                loops), and a reply for a lesson the learner has left is not shown as the current one.
//   shouldAutoTeach              guided by default: opening a lesson asks for it, unless the learner chose Manual.
//   lessonPhase                  open:true first (saved -> shown, zero AI); only "generate"/"in_flight" sends the Teach.
//   groupActions                 the primary way in; Simplify, Go deeper, Examples, Summarise under "More learning options".
//   expansionChoices             the wider Learn-from modes the LEARNER may choose (policy-offered only). Never silent.
//   recoveryPromptText           the recovery panel asks a question only when it can offer an answer to it.

import { LEARN_MODE_LABEL, RECOVERY_PROMPT, RECOVERY_PROMPT_PLAIN } from "./config";

export type LearnMode = keyof typeof LEARN_MODE_LABEL;
export type LessonDepth = "brief" | "standard" | "detailed";
export type LessonSettings = { mode: LearnMode; depth: LessonDepth };

/** The kinds of explanation the route can open from saved (learn.ts ARTEFACT_ACTIONS; a vitest keeps the two equal). */
export const OPENABLE_ACTIONS = ["teach", "explain", "simplify", "deeper", "examples", "summary"] as const;
export const isOpenable = (a: string) => (OPENABLE_ACTIONS as readonly string[]).includes(a);

// ── THE MANUAL LEARNING PREFERENCE ──
// The 414 preference's default_action is CHECK-constrained to a learn action, so "manual" cannot be stored there
// without a migration: it is kept on this device (STATUS G-B). Anything but "manual" is guided -- the default.
export const GUIDED_KEY = "scholar.learn.guided";
export const isGuided = (stored: string | null | undefined) => stored !== "manual";
export const guidedValue = (on: boolean) => (on ? "guided" : "manual");

/** The identity of one lesson request. Two requests with the same key are the same lesson. */
export const lessonKey = (scope: string, step: number, action: string, s: LessonSettings) => `${scope}|${step}|${action}|${s.mode}|${s.depth}`;

/**
 * Pure bookkeeping (no timers, no I/O). `begin` claims a key: false when it is already in flight. `focus` names the
 * lesson the learner is on; `isCurrent` says whether a reply still belongs on screen as the current lesson.
 */
export class LessonRequests {
  private inFlight = new Set<string>();
  private asked = new Set<string>();
  private prepared = new Set<string>();
  private current: string | null = null;
  begin(key: string): boolean {
    this.current = key;
    if (this.inFlight.has(key)) return false;
    this.inFlight.add(key); this.asked.add(key);
    return true;
  }
  end(key: string) { this.inFlight.delete(key); }
  focus(key: string | null) { this.current = key; }
  isCurrent(key: string) { return this.current === key; }
  pending(key: string) { return this.inFlight.has(key); }
  /** Asked for during this visit (whatever came of it): never asked for again unless the learner asks. */
  wasAsked(key: string) { return this.asked.has(key); }
  /** Prepare-next: at most once per lesson key. */
  claimPrepare(key: string): boolean {
    if (this.prepared.has(key)) return false;
    this.prepared.add(key);
    return true;
  }
}

/** Pure. Whether opening this lesson asks for it now, without a click. */
export function shouldAutoTeach(x: {
  guided: boolean; consent: boolean; startAction: string; actions: readonly string[];
  /** Something for this action is already in the lesson's thread. */
  hasLesson: boolean; asked: boolean; inFlight: boolean;
}): boolean {
  return x.guided && x.consent && isOpenable(x.startAction) && x.actions.includes(x.startAction) && !x.hasLesson && !x.asked && !x.inFlight;
}

export type LessonPhase =
  | { kind: "show" }        // a reply to show (saved, generated, withheld or continuity)
  | { kind: "generate" }    // open found nothing saved: send the same request without open
  | { kind: "retry"; message: string }
  | { kind: "error"; message: string };

/** Pure. What a reply to an open (phase "open") or a Teach (phase "generate") request leads to. */
export function lessonPhase(phase: "open" | "generate", ok: boolean, json: Record<string, unknown>): LessonPhase {
  const msg = (v: unknown, d: string) => (typeof v === "string" && v ? v : d);
  if (!ok && !json.withheld) return { kind: "error", message: msg(json.error, "Scholar could not answer just now.") };
  if (phase === "open" && json.cached !== true && (json.open === "generate" || json.open === "in_flight")) return { kind: "generate" };
  if (json.retry === true) return { kind: "retry", message: msg(json.message, "This lesson is still being prepared. Try again in a moment.") };
  if (phase === "open" && json.cached !== true && !json.withheld && !json.continuity && !json.answer) return { kind: "error", message: "Scholar could not open this lesson just now." };
  return { kind: "show" };
}

/** What the progress line says while a lesson is written (no percentages: the model gives none). */
export const preparingText = (mode: LearnMode) =>
  mode === "research" ? "Preparing this lesson from your notes and published research…"
    : mode === "library" ? "Preparing this lesson from your notes and the Competen library…" : "Preparing this lesson from your notes…";

const MORE_ORDER = ["teach", "explain", "simplify", "deeper", "examples", "summary"] as const;
/** Pure. The primary way in (the policy's or learner's starting action), the rest under More learning options, and Ask. */
export function groupActions(actions: readonly string[], start: string): { primary: string | null; more: string[]; ask: boolean } {
  const primary = start !== "ask" && actions.includes(start) ? start : null;
  return { primary, more: MORE_ORDER.filter(a => a !== primary && actions.includes(a)), ask: actions.includes("ask") };
}

export const EXPANSION_LABEL: Record<Exclude<LearnMode, "notes">, string> = { library: "Use my notes + Competen library", research: "Research & Explain" };
/** Pure. The wider Learn-from modes the learner may switch to from `mode`, in order, only those policy offers. */
export function expansionChoices(mode: LearnMode, offered: readonly LearnMode[]): Exclude<LearnMode, "notes">[] {
  const wider: Exclude<LearnMode, "notes">[] = mode === "notes" ? ["library", "research"] : mode === "library" ? ["research"] : [];
  return wider.filter(m => offered.includes(m));
}

/** Pure. The recovery panel's opening line: a question only when there is something to choose besides carrying on. */
export function recoveryPromptText(actions: readonly { action: string }[], expansions: number): string {
  return expansions > 0 || actions.some(a => a.action !== "continue_with_notes") ? RECOVERY_PROMPT : RECOVERY_PROMPT_PLAIN;
}
