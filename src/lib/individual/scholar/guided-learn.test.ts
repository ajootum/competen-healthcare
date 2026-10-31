import { describe, expect, it } from "vitest";
import { ARTEFACT_ACTIONS } from "./learn";
import { RECOVERY_PROMPT, RECOVERY_PROMPT_PLAIN } from "./config";
import {
  LessonRequests, OPENABLE_ACTIONS, expansionChoices, groupActions, guidedValue, isGuided, lessonKey, lessonPhase, recoveryPromptText, shouldAutoTeach,
} from "./guided-learn";

// SCHOLAR-GUIDED-LEARNING-01 G-B: the pure parts of guided learning.

const S = { mode: "notes" as const, depth: "standard" as const };

describe("lesson requests: one in flight per lesson, stale replies ignored, no loops", () => {
  it("dedupes rapid clicks on the same lesson", () => {
    const q = new LessonRequests(), k = lessonKey("s1", 0, "teach", S);
    expect(q.begin(k)).toBe(true);
    expect(q.begin(k)).toBe(false); // second click / re-render
    q.end(k);
    expect(q.pending(k)).toBe(false);
    expect(q.wasAsked(k)).toBe(true); // never re-asked by itself (a withheld lesson does not loop)
  });
  it("a reply for a lesson the learner left is not current", () => {
    const q = new LessonRequests(), a = lessonKey("s1", 0, "teach", S), b = lessonKey("s1", 1, "teach", S);
    q.begin(a); q.begin(b);
    expect(q.isCurrent(a)).toBe(false);
    expect(q.isCurrent(b)).toBe(true);
    q.focus(null);
    expect(q.isCurrent(b)).toBe(false);
  });
  it("a lesson left before it was written is opened again on return", () => {
    const q = new LessonRequests(), a = lessonKey("s1", 0, "teach", S);
    q.begin(a); q.release(a);
    expect(q.wasAsked(a)).toBe(false);
    expect(q.begin(a)).toBe(true);
  });
  it("mode and depth are part of the lesson", () => {
    expect(lessonKey("s", 2, "teach", S)).not.toBe(lessonKey("s", 2, "teach", { ...S, mode: "library" }));
    expect(lessonKey("s", 2, "teach", S)).not.toBe(lessonKey("s", 2, "teach", { ...S, depth: "brief" }));
  });
  it("prepare-next is claimed once per lesson", () => {
    const q = new LessonRequests(), k = lessonKey("s", 0, "teach", S);
    expect(q.claimPrepare(k)).toBe(true);
    expect(q.claimPrepare(k)).toBe(false);
  });
});

describe("shouldAutoTeach", () => {
  const base = { guided: true, consent: true, startAction: "teach", actions: ["teach", "ask"], hasLesson: false, asked: false, inFlight: false };
  it("guided by default asks for the lesson", () => expect(shouldAutoTeach(base)).toBe(true));
  it("never in Manual, without consent, twice, or over a lesson already shown", () => {
    for (const x of [{ guided: false }, { consent: false }, { asked: true }, { inFlight: true }, { hasLesson: true }]) expect(shouldAutoTeach({ ...base, ...x })).toBe(false);
  });
  it("only an action that can be opened from saved", () => {
    expect(shouldAutoTeach({ ...base, startAction: "ask" })).toBe(false);
    expect(shouldAutoTeach({ ...base, startAction: "simplify", actions: ["simplify"] })).toBe(true);
    expect(shouldAutoTeach({ ...base, startAction: "teach", actions: ["ask"] })).toBe(false);
  });
  it("the openable actions are the route's artefact actions", () => expect([...OPENABLE_ACTIONS]).toEqual([...ARTEFACT_ACTIONS]));
});

describe("lessonPhase: open first, generate only when nothing is saved", () => {
  it("saved -> shown (zero AI)", () => expect(lessonPhase("open", true, { cached: true, answer: "x" })).toEqual({ kind: "show" }));
  it("not saved or in flight -> generate", () => {
    expect(lessonPhase("open", true, { cached: false, open: "generate" })).toEqual({ kind: "generate" });
    expect(lessonPhase("open", true, { cached: false, open: "in_flight" })).toEqual({ kind: "generate" });
  });
  it("a generate reply is shown, withheld included; a duplicate twin asks to retry", () => {
    expect(lessonPhase("generate", true, { cached: false, answer: "x" }).kind).toBe("show");
    expect(lessonPhase("generate", false, { withheld: true, reason: "ungrounded" }).kind).toBe("show");
    expect(lessonPhase("generate", true, { retry: true, message: "m" })).toEqual({ kind: "retry", message: "m" });
    expect(lessonPhase("generate", true, { open: "generate" }).kind).toBe("show"); // generate never loops back to open
  });
  it("errors say so", () => expect(lessonPhase("open", false, { error: "e" })).toEqual({ kind: "error", message: "e" }));
});

describe("groupActions", () => {
  it("Teach first; Simplify, Go deeper, Examples, Summarise under More; Ask apart", () => {
    expect(groupActions(["teach", "explain", "simplify", "deeper", "examples", "summary", "ask"], "teach"))
      .toEqual({ primary: "teach", more: ["explain", "simplify", "deeper", "examples", "summary"], ask: true });
  });
  it("a learner's other starting action leads; Teach moves under More; nothing offered is lost", () => {
    expect(groupActions(["teach", "simplify"], "simplify")).toEqual({ primary: "simplify", more: ["teach"], ask: false });
    expect(groupActions(["ask"], "ask")).toEqual({ primary: null, more: [], ask: true });
  });
});

describe("source expansion: learner-chosen, policy-offered only", () => {
  it("notes only offers the wider modes policy offers", () => {
    expect(expansionChoices("notes", ["notes", "library", "research"])).toEqual(["library", "research"]);
    expect(expansionChoices("notes", ["notes", "library"])).toEqual(["library"]);
    expect(expansionChoices("notes", ["notes"])).toEqual([]);
    expect(expansionChoices("library", ["notes", "library", "research"])).toEqual(["research"]);
    expect(expansionChoices("research", ["notes", "library", "research"])).toEqual([]);
  });
  it("the recovery panel asks only a question it can answer (owner screenshot 31 Oct)", () => {
    expect(recoveryPromptText([{ action: "continue_with_notes" }], 0)).toBe(RECOVERY_PROMPT_PLAIN);
    expect(recoveryPromptText([{ action: "continue_with_notes" }], 1)).toBe(RECOVERY_PROMPT);
    expect(recoveryPromptText([{ action: "find_resources" }, { action: "continue_with_notes" }], 0)).toBe(RECOVERY_PROMPT);
    expect(RECOVERY_PROMPT_PLAIN).not.toMatch(/\?/);
  });
});

describe("Manual learning preference (device)", () => {
  it("guided unless the learner chose manual", () => {
    expect(isGuided(null)).toBe(true);
    expect(isGuided("guided")).toBe(true);
    expect(isGuided("manual")).toBe(false);
    expect(isGuided(guidedValue(false))).toBe(false);
  });
});
