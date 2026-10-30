/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { classifyRisk, resolveRiskPolicy, type ResolvedRiskSubject } from "./clinical-risk";
import { SCHOLAR_HIGH_KEPT, SCHOLAR_REQUEST_SCOPED, STUDY_TOPIC_RULES, withScholarEducational } from "../../../scripts/scholar-edu-policy";
import { resolveRiskSubject } from "./allowance";
import { scopeDraftSql } from "../../../scripts/emit-scholar-scope-draft";

// SCHOLAR-EDU-AI-01: how real Scholar questions classify once the topic rules are educational. The starting point is
// the production rule set as published on 30 Oct (the 29 Oct additions applied to the earlier published rules).

const S = (text: string, competencyRisks: string[] = []): ResolvedRiskSubject => ({ text, competencyRisks, frameworkCodes: [] });
const base = JSON.parse(readFileSync(new URL("./fixtures/scholar-risk-2026-10-30.json", import.meta.url), "utf8"));
const before = resolveRiskPolicy(base);
const after = resolveRiskPolicy(withScholarEducational(base));
const tier = (p: any, t: string, c: string[] = []) => classifyRisk(p, S(t, c), "standard_educational").tier;

describe("Scholar educational classification", () => {
  it("studying medicines, emergencies, paediatrics and high-risk competencies is clinical educational, not refused as patient care", () => {
    for (const q of [
      "Explain how furosemide works and what to monitor",
      "What are the side effects of morphine",
      "Explain the steps of adult CPR and resuscitation",
      "How is anaphylaxis recognised",
      "Explain mechanical ventilation and advanced airway management",
      "Signs of sepsis in children and paediatric deterioration",
      "Pyelonephritis: how does the infection spread from the bladder to the kidneys",
    ]) {
      expect(tier(after, q), q).toBe("clinical_educational");
    }
    expect(classifyRisk(after, S("Explain this competency", ["high"]), "standard_educational").tier).toBe("clinical_educational");
    expect(tier(before, "What are the side effects of morphine")).toBe("high_risk_clinical");
    expect(tier(before, "Explain how furosemide works and what to monitor")).toBe("high_risk_clinical");
    // Text no rule recognises still fails closed.
    expect(tier(after, "qwerty zxcv")).toBe("high_risk_clinical");
  });

  it("a real patient, giving a medicine, acting now, personal safety and identifiable details stay high risk", () => {
    for (const q of [
      "My patient in bed 4 is septic, what should I do now",
      "Should I give 10 mg of morphine to him",
      "The patient is not breathing right now",
      "I want to hurt myself",
      "Patient NHS number 943 476 5919 has a fever, explain",
      "Her date of birth is 2 May 1950, what is wrong with her",
    ]) {
      expect(tier(after, q), q).toBe("high_risk_clinical");
    }
  });

  it("changes only the four topic rules' tier and adds two rules; ids are kept", () => {
    const b = base.rules, a = withScholarEducational(base).rules;
    expect(a.length).toBe(b.length + 2);
    for (const r of b) {
      const n = a.find((x: any) => x.id === r.id);
      if (STUDY_TOPIC_RULES[r.id]) expect([r.tier, n.tier]).toEqual(["high_risk_clinical", "clinical_educational"]);
      else if (SCHOLAR_REQUEST_SCOPED.includes(r.id)) expect(n).toEqual({ ...r, scope: "request" });
      else expect(n).toEqual(r);
    }
    for (const id of SCHOLAR_HIGH_KEPT) expect(a.find((x: any) => x.id === id)?.tier).toBe("high_risk_clinical");
  });

  it("refuses a policy without the 29 Oct high-risk rules, and is idempotent", () => {
    expect(() => withScholarEducational({ rules: [] })).toThrow(/high-risk rules/);
    const once = withScholarEducational(base);
    expect(withScholarEducational(once)).toEqual(once);
  });
});

// SQIE D-1 (staging 30 Oct): an ordinary lecture note was refused as high risk because "Escalate urgently" and "if the
// patient is unwell" matched high.urgent-direction anywhere in the subject. The use rules now read the request only.
describe("SQIE D-1: the learner's request, not the study material, decides the use rules", () => {
  const NOTE = [
    "Pyelonephritis is an infection of the kidney and renal pelvis.",
    "It is usually caused by E. coli ascending from the bladder.",
    "Symptoms include fever, loin pain, rigors, nausea and dysuria.",
    "Escalate urgently if the patient is unwell or shows signs of sepsis.",
    "Send a midstream urine (MSU) sample for culture before starting antibiotics.",
    "Management includes antibiotics according to local guidelines, fluids and analgesia.",
  ].join(" ");
  // The context exactly as scholarRisk builds it: the request, then the passages, and the request on its own.
  const scholarCtx = (request: string, passages: string[]) => ({ text: [request, ...passages].filter(Boolean).join("\n\n"), requestText: request });
  const decide = async (ctx: Parameters<typeof resolveRiskSubject>[1]) => classifyRisk(after, await resolveRiskSubject(null, ctx), "standard_educational");

  it("the lecture note as passages, asked for practice questions, is clinical educational", async () => {
    const d = await decide(scholarCtx("Generate practice questions", [NOTE]));
    expect(d.tier).toBe("clinical_educational");
    // Questions written from the note with no request words at all: the same.
    expect((await decide(scholarCtx("", [NOTE]))).tier).toBe("clinical_educational");
  });

  it("the same note with a real-patient request, or an NHS number in the request, is high risk", async () => {
    const d = await decide(scholarCtx("My patient in bed 4 is septic, what should I give now?", [NOTE]));
    expect(d.tier).toBe("high_risk_clinical");
    expect(["high.real-patient", "high.urgent-direction", "high.administration-now"]).toContain(d.rule);
    expect((await decide(scholarCtx("Explain pyelonephritis for NHS number 943 476 5919", [NOTE]))).rule).toBe("high.identifiable");
  });

  it("identifiable details inside the study material are still caught (high.identifiable reads the notes)", async () => {
    const d = await decide(scholarCtx("Generate practice questions", [`${NOTE} Patient NHS number 943 476 5919, date of birth 2 May 1950.`]));
    expect(d).toMatchObject({ tier: "high_risk_clinical", rule: "high.identifiable" });
  });

  it("a caller that sends no separate request text is exactly as strict as before (the whole text)", async () => {
    const d = await decide({ text: `Generate practice questions\n\n${NOTE}` });
    expect(d).toMatchObject({ tier: "high_risk_clinical", rule: "high.urgent-direction" });
  });

  it("only the four use rules are request-scoped; high.identifiable and every other rule read everything", () => {
    for (const r of after.rules) expect([r.id, r.scope]).toEqual([r.id, SCHOLAR_REQUEST_SCOPED.includes(r.id) ? "request" : "subject"]);
    for (const r of before.rules) expect(r.scope).toBe("subject"); // the production rules today: no scope = subject
  });
  it("the PENDING-22 emitter drafts only while nothing is pending, plain ASCII, no semicolon in a comment", () => {
    const sql = scopeDraftSql(base);
    expect(sql).toContain("config_path = 'ai.fair_use.scholar' and draft is not distinct from published;");
    expect(/^[\t\n\x20-\x7e]*$/.test(sql)).toBe(true);
    expect(sql.split("\n").filter(l => l.startsWith("--") && l.includes(";"))).toEqual([]);
    expect(sql).toContain('"scope":"request"');
    expect(() => scopeDraftSql({ rules: [] })).toThrow();
  });
});
