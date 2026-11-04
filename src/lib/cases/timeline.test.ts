import { describe, expect, it } from "vitest";
import { CE0405_DEMO, CE04_DEMO, MINIMAL_S4 } from "./fixtures";
import { answeredView, learnerView, validateBlueprint, visibleFacts, type Blueprint } from "./blueprint";
import { escalationOutcomes, eventsBy, futureValues, simClock, timelineProblems, timelineView, valueAt, TIMELINE_LABEL } from "./timeline";
import { caseReview, CASE_REVIEW_LABEL } from "./debrief";
import { buildVoiceRequest, permittedKnowledge, screenReply } from "./conversation";
import { composeHandover } from "./handover";
import { applyAnswer, sessionSim } from "./library";

// LEARNING-CLOSE-2026-11 CE-04C (deterioration timeline) and the CE-04 debrief. Pure: the same record gives the same minute.

const B = CE0405_DEMO;
const SALT = "salt-ce0405";
const play = (picks: [string, string[]][], revealed: string[] = []) => ({ answers: picks.map(([decisionPointId, chosen]) => ({ decisionPointId, chosen })), revealed });

describe("CE-04C timeline: authoring rules", () => {
  it("the demo case is a sound library case once it names a competency", () => {
    const lib: Blueprint = { ...B, learningObjectives: [{ ...B.learningObjectives[0], competencyIds: ["00000000-0000-4000-8000-000000000001"] }] };
    expect(validateBlueprint(lib, "library")).toEqual([]);
  });
  it("refuses a timeline in a student's private case (written by AI from notes)", () => {
    const priv = { ...B, metadata: { ...B.metadata, provenance: { kind: "private" as const, rights: "student_private" as const } } };
    expect(validateBlueprint(priv, "private").some(p => /never part of a private case/.test(p))).toBe(true);
  });
  it("refuses unknown facts, history that changes, bad minutes, options that do not exist and duplicate ids", () => {
    const bad = {
      events: [
        { id: "e1", at: -1, label: "x", updates: [{ factId: "nope", value: "1" }] },
        { id: "e1", at: 5, label: "y", updates: [] },
        { id: "e2", at: 5, label: "z", updates: [{ factId: "f_onset", value: "changed" }] },
      ],
      escalation: [{ id: "w1", label: "esc", escalate: [{ decisionPointId: "d3", optionIds: ["a"] }], closesAt: 1.5, safetyCritical: "yes" }],
      optionMinutes: [{ decisionPointId: "d1", optionId: "zz", minutes: 10 }],
    };
    const p = timelineProblems(bad, B);
    expect(p.join("\n")).toMatch(/whole number/);
    expect(p.join("\n")).toMatch(/unknown fact nope/);
    expect(p.join("\n")).toMatch(/its own id/);
    expect(p.join("\n")).toMatch(/only an observation, examination or result/);
    expect(p.join("\n")).toMatch(/not a choice/);
    expect(p.join("\n")).toMatch(/safetyCritical is true or false/);
    expect(p.join("\n")).toMatch(/option that does not exist/);
    expect(timelineProblems(B.timeline, B)).toEqual([]);
  });
});

describe("CE-04C timeline: the clock comes only from the record", () => {
  it("no answers: minute 0; asking for a finding takes its cost; the same record gives the same minute", () => {
    expect(simClock(B, play([])).now).toBe(0);
    expect(simClock(B, play([], ["f_spo2"])).now).toBe(2);
    expect(simClock(B, play([["d1", ["a"]]], ["f_spo2"]))).toEqual(simClock(B, play([["d1", ["a"]]], ["f_spo2"])));
  });
  it("a reveal is placed at the decision that permitted it, before that decision's own minute", () => {
    const c = simClock(B, play([["d1", ["a"]], ["d2", ["a"]]], ["f_spo2", "f_pain"]));
    expect(c.atAnswer).toEqual({ d1: 4, d2: 9 });
    expect(c.now).toBe(14);
  });
  it("questions to the patient take time at their stage; an option can cost extra minutes", () => {
    const c = simClock(B, { ...play([["d1", ["a"]], ["d2", ["b"]]]), turns: [{ stageId: "s1" }, { stageId: "s1" }, { stageId: "s2b" }] });
    expect(c.atAnswer).toEqual({ d1: 2, d2: 7 });
    expect(c.now).toBe(7 + 5 + 30 + 1);
  });
  it("a case without a timeline has no clock", () => {
    expect(simClock(MINIMAL_S4, play([["d1", ["a"]]]))).toEqual({ now: 0, atAnswer: {} });
  });
});

describe("CE-04C timeline: what a learner sees", () => {
  it("values change only once their minute has passed, with the earlier values kept as a trend", () => {
    const rr = B.facts.find(f => f.id === "f_rr")!;
    expect(valueAt(B.timeline, rr, 9).value).toBe("22");
    expect(valueAt(B.timeline, rr, 10)).toEqual({ value: "28", history: [{ at: 0, value: "22" }, { at: 10, value: "28" }] });
    expect(valueAt(B.timeline, rr, 40).value).toBe("32");
    expect(eventsBy(B.timeline, 15).map(e => e.id)).toEqual(["t10"]);
  });
  it("learnerView shows the minute and the past only: no future event, no window, no closesAt, no future value", () => {
    const v = learnerView(B, { reachedStageIds: ["s1"], revealedFactIds: [], clock: 12 }, SALT);
    expect(v.sim).toEqual({ label: TIMELINE_LABEL, minute: 12, happened: [{ at: 10, label: "His breathing is faster and his heart rate has gone up" }] });
    expect(v.facts.find(f => f.label === "Respiratory rate")).toMatchObject({ value: "28", trend: [{ at: 0, value: "22" }] });
    const json = JSON.stringify(v, (k, x) => (k === "token" ? undefined : x));
    for (const leak of ["drowsy", "Drowsy", "confused", "32", "89", "closesAt", "w_review", "urgent medical review", "escalat"]) expect(json).not.toContain(leak);
  });
  it("an event reveal makes a finding visible at its minute, never before", () => {
    expect(visibleFacts(B, { reachedStageIds: ["s1"], revealedFactIds: [], clock: 19 }).has("f_conf")).toBe(false);
    expect(visibleFacts(B, { reachedStageIds: ["s1"], revealedFactIds: [], clock: 20 }).has("f_conf")).toBe(true);
  });
  it("without a clock (the switch off) the case is exactly as before", () => {
    const v = learnerView(B, { reachedStageIds: ["s1"], revealedFactIds: [] }, SALT);
    expect(v.sim).toBeNull();
    expect(v.facts.find(f => f.label === "Respiratory rate")).toEqual(expect.objectContaining({ value: "22" }));
    expect(v.facts.some(f => "trend" in f)).toBe(false);
    expect(timelineView(null, 5)).toBeNull();
  });
});

describe("CE-04C escalation: recognition and timeliness, by code", () => {
  it("escalating at d2 is in time; waiting first makes the escalation at d2b late", () => {
    const fast = play([["d1", ["a"]], ["d2", ["a"]]]);
    const [onTime] = escalationOutcomes(B, fast, simClock(B, fast), true);
    expect(onTime).toMatchObject({ timeliness: "on_time", escalatedAt: 5, recognised: true, score: 1, decisionPointId: "d2" });
    const slow = play([["d1", ["a"]], ["d2", ["b"]], ["d2b", ["a"]]]);
    const [late] = escalationOutcomes(B, slow, simClock(B, slow), true);
    expect(late).toMatchObject({ timeliness: "late", escalatedAt: 40, closesAt: 15, score: 0.75, decisionPointId: "d2b" });
    const never = play([["d1", ["b"]], ["d2", ["b"]], ["d2b", ["b"]]]);
    expect(escalationOutcomes(B, never, simClock(B, never), true)[0]).toMatchObject({ timeliness: "missed", recognised: false, score: 0 });
    expect(escalationOutcomes(B, never, simClock(B, never), false)[0].timeliness).toBe("pending");
  });
  it("the answered view flags a late escalation after answering, and the session engine plays it end to end", () => {
    let s = { reached_stage_ids: ["s1"], revealed_fact_ids: [] as string[], answers: [] as any[], status: "in_progress" }; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const [dp, chosen] of [["d1", ["a"]], ["d2", ["b"]], ["d2b", ["a"]]] as const) {
      const r = applyAnswer(B, s, dp, [...chosen], null, "2026-11-04T10:00:00Z");
      if ("error" in r) throw new Error(r.error);
      s = { ...s, reached_stage_ids: r.reached, revealed_fact_ids: r.revealed, answers: r.answers };
    }
    expect(s.reached_stage_ids).toEqual(["s1", "s2", "s2b", "s3"]);
    const t = sessionSim(B, s, { timeline: true })!;
    expect(t.clock.now).toBe(45);
    const av = answeredView(B, "d2b", ["a"], SALT, null, t.escalations[0]);
    expect(av?.escalation).toMatchObject({ timeliness: "late", minute: 40, closesAt: 15 });
    expect(av?.escalation?.text).toMatch(/LATE/);
    expect(answeredView(B, "d1", ["a"], SALT, null, t.escalations[0])?.escalation).toBeNull();
    expect(sessionSim(B, s, { timeline: false })).toBeNull();
    expect(sessionSim(B, s, null)).toBeNull();
  });
});

describe("CE-04C and the patient voice", () => {
  it("the voice is told the value as it is now, never a value still to come", () => {
    const withRr = { ...B, voice: { ...B.voice!, knowsFactIds: [...B.voice!.knowsFactIds, "f_rr"] } };
    const early = permittedKnowledge(withRr, { reachedStageIds: ["s1"], revealedFactIds: [], clock: 3 });
    expect(early.facts.find(f => f.id === "f_rr")?.value).toBe("22");
    const later = permittedKnowledge(withRr, { reachedStageIds: ["s1"], revealedFactIds: [], clock: 12 });
    expect(later.facts.find(f => f.id === "f_rr")?.value).toBe("28");
    const req = buildVoiceRequest(withRr, { reachedStageIds: ["s1"], revealedFactIds: [], clock: 3 }, [], "How fast are you breathing?");
    expect(req.system).not.toContain("28");
    expect(req.system).not.toContain("32");
  });
  it("a reply voicing a future value is screened out", () => {
    const withRr = { ...B, voice: { ...B.voice!, knowsFactIds: [...B.voice!.knowsFactIds, "f_rr"] } };
    const s = { reachedStageIds: ["s1"], revealedFactIds: [], clock: 3 };
    expect(screenReply(withRr, s, "I am breathing about 22 breaths per minute.").ok).toBe(true);
    expect(screenReply(withRr, s, "My breathing rate is 32 breaths per minute.")).toMatchObject({ ok: false, reason: "hidden_finding" });
    expect(screenReply(withRr, s, "I feel drowsy, opens his eyes when spoken to.")).toMatchObject({ ok: false, reason: "hidden_finding" });
  });
});

describe("CE-04 debrief: what went well, what was missed, what was unsafe", () => {
  const handover = composeHandover({
    situation: "Mr X on the ward is more short of breath and getting worse.",
    background: "Admitted yesterday, lives alone, breathless since this morning.",
    assessment: "Respiratory rate 32, sats 89 percent, he is drowsy and confused.",
    recommendation: "Please come for an urgent review now, I will stay with him.",
  });
  it("a late, safety-critical escalation is unsafe; the handover's points are credited; the label says formative", () => {
    const p = play([["d1", ["a"]], ["d2", ["b"]], ["d2b", ["a"]]]);
    const esc = escalationOutcomes(B, p, simClock(B, p), true);
    const r = caseReview(B, { answers: [...p.answers, { decisionPointId: "d3", chosen: [], text: handover }], revealed: [], reached: ["s1", "s2", "s2b", "s3"], escalations: esc,
      questions: { asked: [{ label: "When the breathlessness started" }], missed: [{ label: "Whether he has any chest pain" }] } });
    expect(r.label).toBe(CASE_REVIEW_LABEL);
    expect(r.label).toMatch(/not evidence of clinical competence/);
    expect(r.unsafe.join(" ")).toMatch(/LATE/);
    expect(r.missed.join(" ")).toMatch(/expected answer was "Call for an urgent medical review now"/);
    expect(r.missed.join(" ")).toMatch(/did not ask for these important findings: Chest pain; Oxygen saturation/);
    expect(r.missed.join(" ")).toMatch(/did not ask the patient about: Whether he has any chest pain/);
    expect(r.wentWell.join(" ")).toMatch(/handover covered/);
    expect(r.wentWell.join(" ")).toMatch(/recognised the deterioration/);
  });
  it("broken safety criteria are unsafe; an escalation in time went well", () => {
    const p = play([["d1", ["b"]], ["d2", ["a"]]]);
    const esc = escalationOutcomes(B, p, simClock(B, p), true);
    const r = caseReview(B, { answers: p.answers, revealed: ["f_spo2"], reached: ["s1", "s2", "s3"], escalations: esc });
    expect(r.unsafe).toContain("Safety: Assess his breathing before carrying on with other work");
    expect(r.wentWell.join(" ")).toMatch(/in time/);
    expect(r.wentWell.join(" ")).toMatch(/You asked for: Oxygen saturation/);
  });
  it("works on a case with no timeline and no voice (the lines are simply absent)", () => {
    const r = caseReview(CE04_DEMO, { answers: [{ decisionPointId: "d1", chosen: ["a"] }], revealed: [], reached: ["s1", "s2"] });
    expect(r.wentWell.length).toBeGreaterThan(0);
    expect(r.unsafe).toEqual([]);
  });
  it("futureValues lists what is still to come for a fact", () => {
    expect(futureValues(B.timeline, "f_rr", 12)).toEqual(["32"]);
    expect(futureValues(B.timeline, "f_rr", 25)).toEqual([]);
  });
});
