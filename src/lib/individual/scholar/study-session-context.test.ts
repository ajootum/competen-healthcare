import { describe, expect, it } from "vitest";
import { buildStudySessionContext, STUDY_CONTEXT_HEADER, STUDY_CONTEXT_MAX_CHARS, type StudySessionContextInput } from "./study-session-context";

// SCHOLAR-SESSION-AI-02 slice C (owner D4): the study-session block for the Personal AI. Pure.

const base = (): StudySessionContextInput => ({
  focus: { title: "Acute kidney injury", objective: "Explain the stages of acute kidney injury", competencies: ["Renal assessment"] },
  sources: [{ material: "Renal notes", order: 1, topics: ["Fluid balance", "Staging"] }],
  missed: [
    { id: "q1", stem: "Which finding defines stage 3 AKI?", topic: "Staging", at: "2026-10-30T10:00:00Z", still: true },
    { id: "q2", stem: "What urine output suggests oliguria?", topic: "Fluid balance", at: "2026-10-30T11:00:00Z", still: false },
  ],
  mistakes: ["Confusing creatinine rise with urine output"],
  unsure: [{ topic: "Staging", at: "2026-10-30T09:00:00Z" }],
  osce: [{ id: "o1", station: "Fluid assessment", at: "2026-10-30T12:00:00Z", gaps: [{ text: "Check capillary refill", critical: true, mark: "missed" }], suggestions: ["Learn: Check capillary refill", "Revise this material"] }],
  progress: { stepsDone: 2, stepsTotal: 5, completed: false, stagesTouched: ["Learn", "Revise"] },
});

describe("buildStudySessionContext", () => {
  it("keeps the D4 priority order: focus, sources, misconceptions, feedback, progress", () => {
    const r = buildStudySessionContext(base())!;
    expect(r.sections).toEqual(["focus", "sources", "misconceptions", "feedback", "progress"]);
    expect(r.text.startsWith(STUDY_CONTEXT_HEADER)).toBe(true);
    const at = (s: string) => r.text.indexOf(s);
    expect(at("I am studying: Acute kidney injury")).toBeGreaterThan(0);
    expect(at("Acute kidney injury")).toBeLessThan(at("Renal notes"));
    expect(at("Renal notes")).toBeLessThan(at("I missed:"));
    expect(at("I missed:")).toBeLessThan(at("OSCE practice on Fluid assessment"));
    expect(at("OSCE practice")).toBeLessThan(at("learning steps"));
    // still-wrong first; a since-corrected miss says so; the duplicate "Learn: <gap>" suggestion is folded into the gap
    expect(at("defines stage AKI")).toBeLessThan(at("oliguria"));
    expect(r.text).toContain("(right since)");
    expect(r.text).toContain("Check capillary refill (missed, critical)");
    expect(r.text).not.toContain("Learn: Check capillary refill");
    expect(r.text).toContain("suggested next: Revise this material");
    expect(r.text).toContain("My check was not yet right on: Staging");
  });

  it("is words only: no digits or codes, progress in words", () => {
    const r = buildStudySessionContext({ ...base(), focus: { title: "Sepsis SEP-001 week 3", objective: null, competencies: [] } })!;
    expect(r.text).not.toMatch(/\d/);
    expect(r.text).not.toContain("SEP-");
    expect(r.text).toContain("I have done two of five learning steps.");
  });

  it("is deterministic: the same records in any order give the same block", () => {
    const a = base();
    const b: StudySessionContextInput = {
      ...a, missed: [...a.missed].reverse(), sources: [{ material: "Lecture slides", order: 2, topics: ["B", "A"] }, ...a.sources],
      focus: { ...a.focus, competencies: ["Z comp", "A comp"] },
    };
    const c: StudySessionContextInput = { ...b, sources: [...b.sources].reverse(), focus: { ...b.focus, competencies: [...b.focus.competencies].reverse() } };
    expect(buildStudySessionContext(b)!.text).toBe(buildStudySessionContext(c)!.text);
    expect(buildStudySessionContext(a)!.text).toBe(buildStudySessionContext({ ...a, missed: [...a.missed].reverse() })!.text);
  });

  it("holds the cap, taking the lowest-priority sections first", () => {
    const long = (n: number) => Array.from({ length: n }, (_, i) => `concept ${String.fromCharCode(97 + i)} `.repeat(15));
    const big: StudySessionContextInput = {
      ...base(),
      sources: long(6).map((m, i) => ({ material: `Material ${m}`, order: i, topics: long(4) })),
      missed: long(6).map((s, i) => ({ id: `q${i}`, stem: s, topic: null, at: null, still: true })),
      osce: long(3).map((s, i) => ({ id: `o${i}`, station: s, at: `2026-10-0${i + 1}`, gaps: long(5).map(t => ({ text: t, critical: false, mark: "partly" as const })), suggestions: [] })),
    };
    const full = buildStudySessionContext(big, 100000)!;
    expect(full.text.length).toBeGreaterThan(STUDY_CONTEXT_MAX_CHARS);
    const r = buildStudySessionContext(big)!;
    expect(r.text.length).toBeLessThanOrEqual(STUDY_CONTEXT_MAX_CHARS);
    expect(r.sections[0]).toBe("focus");
    expect(r.sections).not.toContain("progress");
    expect(r.text).toContain("I am studying: Acute kidney injury");
    // a tighter cap drops more from the bottom, never the focus first
    const tight = buildStudySessionContext(big, 600)!;
    expect(tight.sections).toEqual(["focus", "sources"].slice(0, tight.sections.length));
    expect(tight.text.length).toBeLessThanOrEqual(600);
  });

  it("leaves out any item carrying a patient identifier", () => {
    const r = buildStudySessionContext({
      ...base(),
      missed: [{ id: "q9", stem: "Patient NHS number 943 476 5919 has a raised creatinine: why?", topic: null, at: "2026-10-31", still: true }],
      focus: { title: "Ward case MRN: AB123456", objective: "Review DOB: 01/02/1980 notes", competencies: [] },
    })!;
    expect(r.text).not.toMatch(/943|5919|AB123456|1980|raised creatinine|Ward case/);
    expect(r.text).not.toContain("My objective");
  });

  it("reads only the fields it names: Professional, employer and own_development data are ignored even if passed", () => {
    const leaky = { ...base(), professional: { needs: "SECRET-PRO need" }, ownDevelopment: "SECRET own development plan", employer: "SECRET Trust", fullName: "Jane SECRET" } as unknown as StudySessionContextInput;
    const r = buildStudySessionContext(leaky)!;
    expect(r.text).not.toContain("SECRET");
    expect(r.text).toBe(buildStudySessionContext(base())!.text);
  });

  it("is null when there is nothing worth saying", () => {
    expect(buildStudySessionContext({ focus: { title: "", objective: null, competencies: [] }, sources: [], missed: [], mistakes: [], unsure: [], osce: [], progress: null })).toBeNull();
  });
});

describe("buildStudySessionContext: formative feedback on written answers (SCHOLAR-WRITTEN-FEEDBACK-01)", () => {
  const written = (): NonNullable<StudySessionContextInput["written"]> => [
    { id: "a1", stem: "Why does oliguria matter in AKI?", topic: "Fluid balance", at: "2026-10-30T13:00:00Z", missing: ["Urine output below the threshold", "Link to staging", "Third point"], misconceptions: ["Thinking creatinine rises first"], next: "Revise the staging criteria", summary: null },
    { id: "a2", stem: "What is stage 1 AKI?", topic: null, at: "2026-10-30T08:00:00Z", missing: [], misconceptions: [], next: null, summary: "Mostly right; add the time window." },
  ];
  it("adds labelled headlines to the feedback section, newest first, words only, no verdict or mark", () => {
    const r = buildStudySessionContext({ ...base(), written: written() })!;
    expect(r.sections).toEqual(["focus", "sources", "misconceptions", "feedback", "progress"]);
    const at = (s: string) => r.text.indexOf(s);
    expect(r.text).toContain('Formative AI feedback on my written answer on Fluid balance to "Why does oliguria matter in AKI?": missing Urine output below the threshold; Link to staging. mistaken idea Thinking creatinine rises first. revise next Revise the staging criteria');
    expect(r.text).not.toContain("Third point");
    expect(r.text).toContain('to "What is stage AKI?": Mostly right; add the time window.');
    expect(at("OSCE practice")).toBeLessThan(at("Formative AI feedback"));
    expect(at("oliguria matter")).toBeLessThan(at("What is stage AKI"));
    expect(at("Formative AI feedback")).toBeLessThan(at("learning steps"));
    expect(r.text).not.toMatch(/verified|score|correct|self-assess/i);
  });
  it("is deterministic whatever the read order, and leaves out an item with a patient identifier", () => {
    const w = written();
    expect(buildStudySessionContext({ ...base(), written: [...w].reverse() })!.text).toBe(buildStudySessionContext({ ...base(), written: w })!.text);
    const r = buildStudySessionContext({ ...base(), written: [{ ...w[0], stem: "Mr Smith NHS number 943 476 5919: why oliguria?" }] })!;
    expect(r.text).not.toContain("Formative AI feedback");
  });
  it("stays within the cap, losing written-answer feedback before anything of higher priority", () => {
    const many = Array.from({ length: 3 }, (_, i) => ({ ...written()[0], id: `w${i}`, at: `2026-10-3${i}T00:00:00Z`, stem: `${"Long stem words ".repeat(9)}${i}?` }));
    const r = buildStudySessionContext({ ...base(), written: many }, 900)!;
    expect(r.text.length).toBeLessThanOrEqual(900);
    expect(r.text).toContain("I am studying: Acute kidney injury");
  });
});
