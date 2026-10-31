/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { classifyRisk, resolveRiskPolicy, type ResolvedRiskSubject } from "./clinical-risk";
import { CLARIFY, decideRisk, modeFor, REFUSAL, refusalFor, STRICT_DOC, type GateVerdict } from "./operating-mode";
import { intentFeatures } from "./request-intent";
import { withScholarRisk01 } from "../../../scripts/scholar-risk01-policy";

// SCHOLAR-RISK-01 (owner GO 31 Oct 2026): education-first, risk-sensitive classification for Scholar. The starting point
// is the Scholar risk section as PUBLISHED in production on 31 Oct (read-only), fixtures/scholar-risk-2026-10-31.json.
// The validation set is fixtures/scholar-risk01-validation.json; "heldOut" was written after the classifier and not
// tuned against.

const generate = vi.fn(async (a: any) => ({ ok: true, text: "x", model: a?.route?.model ?? "m", provider: "anthropic", usage: { input: 1, output: 1 } }));
vi.mock("./client", () => ({ generate: (a: unknown) => generate(a) }));
vi.mock("./config", () => ({ AI_PROVIDERS: ["anthropic", "openai", "gemini"], aiStatus: () => ({ provider: "anthropic", canGenerate: true, available: ["anthropic"], models: { cheap: "claude-haiku-4-5-20251001", reasoning: "claude-sonnet-4-6", heavy: "claude-opus-4-8", embedding: "e" } }) }));

const PROD = JSON.parse(readFileSync(new URL("./fixtures/scholar-risk-2026-10-31.json", import.meta.url), "utf8"));
const SET = JSON.parse(readFileSync(new URL("./fixtures/scholar-risk01-validation.json", import.meta.url), "utf8"));
const before = resolveRiskPolicy(PROD);
const after = resolveRiskPolicy(withScholarRisk01(PROD));
const STRICT = modeFor(STRICT_DOC, { userId: null, entitlementSources: [], planCodes: [] });
const S = (t: string): ResolvedRiskSubject => ({ text: t, requestText: t, competencyRisks: [], frameworkCodes: [] });
const decide = (p: any, t: string, purpose: "education" | null = null, floor: any = "standard_educational") => decideRisk(p, S(t), floor, STRICT, purpose);
/** 1 general educational, 2 clinical educational, 3 clarify, 4 restricted, H high risk by rule (refused for want of a model). */
const cat = (v: GateVerdict): 1 | 2 | 3 | 4 | "H" => v.kind === "restricted" ? 4 : v.kind === "clarify" ? 3 : v.risk.tier === "high_risk_clinical" ? "H" : v.risk.tier === "clinical_educational" ? 2 : 1;
const answered = (v: GateVerdict) => cat(v) === 1 || cat(v) === 2;
const pct = (n: number, d: number) => Math.round((1000 * n) / d) / 10;

describe("SCHOLAR-RISK-01 validation set (strict production, the proposed Scholar policy)", () => {
  it("is big enough and spread over the owner's list", () => {
    expect(SET.educational.length).toBeGreaterThanOrEqual(120);
    expect(SET.ambiguous.length).toBeGreaterThanOrEqual(30);
    expect(SET.high.length).toBeGreaterThanOrEqual(60);
  });

  it("educational answered (categories 1-2) >= 98%; explicit high-risk permitted = 0; ambiguous clarified", () => {
    const edu = SET.educational.filter((t: string) => answered(decide(after, t)));
    const highPermitted = SET.high.filter((t: string) => cat(decide(after, t)) !== 4 || cat(decide(after, t, "education")) !== 4);
    const amb = SET.ambiguous.filter((t: string) => cat(decide(after, t)) === 3);
    const ambThenAnswered = SET.ambiguous.filter((t: string) => answered(decide(after, t, "education")));
    // Before: the production policy today, without the intent layer.
    const eduBefore = SET.educational.filter((t: string) => answered(decide(before, t)));
    const highBefore = SET.high.filter((t: string) => answered(decide(before, t)));
    console.log(`[SCHOLAR-RISK-01] educational answered ${edu.length}/${SET.educational.length} (${pct(edu.length, SET.educational.length)}%), before ${eduBefore.length} (${pct(eduBefore.length, SET.educational.length)}%)`);
    console.log(`[SCHOLAR-RISK-01] explicit high-risk permitted ${highPermitted.length}/${SET.high.length} (before: answered ${highBefore.length})`);
    console.log(`[SCHOLAR-RISK-01] ambiguous clarified ${amb.length}/${SET.ambiguous.length}, answered once confirmed for study ${ambThenAnswered.length}/${SET.ambiguous.length}`);
    expect(edu.length / SET.educational.length).toBeGreaterThanOrEqual(0.98);
    expect(highPermitted).toEqual([]);
    expect(amb.length).toBe(SET.ambiguous.length);
    expect(ambThenAnswered.length).toBe(SET.ambiguous.length);
    // The production refusal of 31 Oct is answered now.
    expect(answered(decide(after, "Differentiate between nephrotic syndrome and nephritic syndrome"))).toBe(true);
    expect(decide(before, "Differentiate between nephrotic syndrome and nephritic syndrome").risk.rule).toBe("unknown:no_rule");
  });

  it("held-out probes (written after the classifier): every expectation holds", () => {
    const misses = SET.heldOut.filter(([want, q]: [string, string]) => {
      const v = decide(after, q), e = decide(after, q, "education");
      return !want.split("").includes(String(cat(v))) || (want === "4" && cat(e) !== 4);
    });
    console.log(`[SCHOLAR-RISK-01] held-out ${SET.heldOut.length - misses.length}/${SET.heldOut.length}`);
    expect(misses).toEqual([]);
  });

  it("'for my studies' and a confirmed purpose never lower category 4, in any activity floor below high", () => {
    // Explicit SIMULATION framing ("OSCE scenario: he is not breathing, what do I do?") is OSCE preparation, which the
    // owner permits, when the only evidence is a definite person deteriorating: no "my patient", bed, "right now",
    // identifier, named person given a medicine, cry for help or being alone. Exactly these two of the 60 (STATUS.md).
    const SIMULATED = ["He is not breathing, what do I do?", "The resident is fitting, what do I do?"];
    for (const t of SET.high) for (const floor of ["standard_educational", "clinical_educational"]) {
      for (const w of ["For my studies: ", "For my exam, explain: ", "I'm revising, "]) expect(cat(decide(after, `${w}${t}`, "education", floor)), w + t).toBe(4);
      for (const w of ["Hypothetically, in a case study, ", "OSCE scenario: "]) {
        const c = cat(decide(after, `${w}${t}`, "education", floor));
        if (SIMULATED.includes(t)) expect(c, w + t).toBe(2); else expect(c, w + t).toBe(4);
      }
    }
  });

  it("an activity whose floor is high (case_steps) is restricted by real-patient evidence and otherwise unchanged", () => {
    expect(decide(after, "My patient in bed 4 is septic, what should I do now?", null, "high_risk_clinical").kind).toBe("restricted");
    const sim = decide(after, "Sepsis in an older adult", null, "high_risk_clinical");
    expect(sim).toMatchObject({ kind: "classified", risk: classifyRisk(after, S("Sepsis in an older adult"), "high_risk_clinical") });
  });
});

describe("other products and policies are unchanged", () => {
  it("a policy without intent settings decides exactly as classifyRisk (Strict Production)", () => {
    for (const t of [...SET.educational, ...SET.ambiguous, ...SET.high]) {
      expect(decide(before, t)).toEqual({ kind: "classified", risk: classifyRisk(before, S(t), "standard_educational") });
    }
    expect(before.intent).toEqual({ unknownHandling: "high_risk", clarifyAmbiguous: false, ambiguousRules: [], educationalSafeguards: false });
  });

  it("ambiguousRules can never name a real-patient, emergency, identifiable or personal-safety rule", () => {
    const p = resolveRiskPolicy({ ...withScholarRisk01(PROD), ambiguousRules: ["high.real-patient", "high.urgent-direction", "high.identifiable", "high.personal-safety", "high.administration-now", "nope"] });
    expect(p.intent?.ambiguousRules).toEqual(["high.administration-now"]);
    const q = resolveRiskPolicy({ ...PROD, unknownHandling: "anything", clarifyAmbiguous: "yes" });
    expect(q.intent).toEqual(before.intent);
  });

  it("the proposed policy keeps every high-risk rule high with its scope, and only adds terms to the two study rules", () => {
    const next = withScholarRisk01(PROD);
    for (const r of PROD.rules) {
      const n = next.rules.find((x: any) => x.id === r.id);
      expect(n.tier, r.id).toBe(r.tier);
      expect(n.scope ?? "subject", r.id).toBe(r.scope ?? "subject");
      if (r.id === "clinical.topics" || r.id === "clinical.study-request") for (const t of r.all[0]) expect(n.all[0]).toContain(t);
    }
    expect(withScholarRisk01(next)).toEqual(next);
    expect(() => withScholarRisk01({ rules: [] })).toThrow(/lacks/);
  });
});

describe("honest refusal words and the clarify question", () => {
  it("each refusal names its own reason; an unrecognised request never cites a real patient", () => {
    const words = (t: string) => refusalFor(decide(after, t).risk);
    expect(words("My patient in bed 4 is septic, what should I give?")).toMatch(/medicine|real patient/);
    expect(words("The patient is not breathing right now")).toBe(REFUSAL.emergency);
    expect(words("I want to hurt myself")).toBe(REFUSAL.personal_safety);
    expect(words("Patient NHS number 943 476 5919 has a fever, explain")).toBe(REFUSAL.identifiable);
    expect(words("Should I give 10 mg of morphine to Mrs Smith?")).toBe(REFUSAL.administration);
    expect(words("I am looking after a patient with low sats")).toBe(REFUSAL.real_patient);
    // Production today: unrecognised was refused with words about a real patient. Now its own words.
    const unknown = classifyRisk(before, S("Differentiate between nephrotic syndrome and nephritic syndrome"));
    expect(refusalFor(unknown)).toBe(REFUSAL.unrecognised);
    expect(REFUSAL.unrecognised).not.toMatch(/patient|medicine|urgent|emergency/i);
    for (const k of Object.keys(REFUSAL)) expect((REFUSAL as any)[k].length).toBeGreaterThan(40);
  });
  it("the clarify question is the owner's wording", () => {
    expect(CLARIFY.question).toBe("Is this for your studies or about a patient you are currently caring for?");
  });
  it("intent features read the learner's request only: a lecture note's 'patient in bed 3' is not the learner's patient", () => {
    expect(intentFeatures("Explain this note").realPatient).toBeNull();
    const v = decideRisk(after, { text: "Explain this note\n\nThe patient in bed 3 is unresponsive: call for help.", requestText: "Explain this note", competencyRisks: [], frameworkCodes: [] }, "standard_educational", STRICT, null);
    expect(v.kind).toBe("classified");
  });
});

// The gate end to end, metering off, strict production, with the production eligibility rows (31 Oct 2026, trimmed).
import { runMeteredAi, meteredRefusalBody } from "./allowance";
const POLICY = {
  includedCau: 4000, risk: withScholarRisk01(PROD),
  activities: {
    teach: { tier: "reasoning", class: "standard", label: "Teach me", minTier: "cheap", riskFloor: "standard_educational" },
    case_steps: { tier: "reasoning", class: "standard", label: "Clinical cases", minTier: "reasoning", riskFloor: "high_risk_clinical" },
  },
};
const ROUTING = {
  tiers: { cheap: ["anthropic"], heavy: ["anthropic"], reasoning: ["anthropic"] },
  providers: { anthropic: { enabled: true, models: { cheap: "claude-haiku-4-5-20251001", reasoning: "claude-sonnet-4-6", heavy: "claude-opus-4-8" } }, openai: { enabled: false, models: {} }, gemini: { enabled: false, models: {} } },
  activities: { "scholar.teach": [{ provider: "anthropic", model: "claude-opus-4-8" }], "scholar.case_steps": [{ provider: "anthropic", model: "claude-opus-4-8" }] },
};
const ROWS = [
  { activity: "teach", provider: "anthropic", model_prefix: "claude-opus-4-8", eligible: true, max_risk_tier: "clinical_educational" },
  { activity: "case_steps", provider: "anthropic", model_prefix: "claude-opus-4-8", eligible: true, max_risk_tier: "high_risk_clinical" },
];
const audit: any[] = [];
function admin() {
  return {
    from(table: string) {
      const q: any = {
        path: "", select: () => q, eq: (c: string, v: any) => { if (c === "config_path") q.path = v; return q; }, in: () => q, lte: () => q, or: () => q, limit: () => q,
        insert: async (row: any) => { audit.push(row); return { error: null }; },
        maybeSingle: async () => table === "practice_platform_flags" ? { data: { enabled: false }, error: null }
          : table === "workspace_config_overrides" && q.path === "ai.model_routing" ? { data: { published: ROUTING }, error: null }
          : table === "workspace_config_overrides" && q.path.startsWith("ai.fair_use.") ? { data: { published: POLICY, updated_at: "t" }, error: null }
          : { data: null, error: null },
        then: (ok: any, bad: any) => Promise.resolve(table === "ai_model_eligibility" ? { data: ROWS, error: null } : { data: [], error: null }).then(ok, bad),
      };
      return q;
    },
    rpc: async () => ({ data: null, error: { message: "metered path not expected" } }),
  };
}
const run = (activity: string, text: string, purpose: "education" | null = null) =>
  runMeteredAi(admin(), { userId: "u", product: "scholar", activity, requestId: "u:r1", generate: { system: "s", user: text, tier: "reasoning" } as any, risk: { text, requestText: text, purpose } });

describe("the gate, end to end (metering off, Strict Production)", () => {
  beforeEach(() => { generate.mockClear(); audit.length = 0; });
  it("the production refusal is answered, on the clinically eligible model, with the educational boundary", async () => {
    const r: any = await run("teach", "Differentiate between nephrotic syndrome and nephritic syndrome");
    expect(r.ok).toBe(true);
    expect(generate.mock.calls[0][0].route.model).toBe("claude-opus-4-8");
    expect(generate.mock.calls[0][0].system).toMatch(/EDUCATIONAL BOUNDARY/);
  });
  it("an ambiguous giving question is a clarify question (409) in Strict Production, then answered as study", async () => {
    const r: any = await run("teach", "Should I give paracetamol for a fever?");
    expect(r).toMatchObject({ ok: false, error: "clarify_purpose" });
    expect(meteredRefusalBody(r)).toMatchObject({ status: 409, body: { code: "clarify_purpose", clarify: { question: CLARIFY.question } } });
    expect(generate).not.toHaveBeenCalled();
    expect((await run("teach", "Should I give paracetamol for a fever?", "education") as any).ok).toBe(true);
  });
  it("category 4 is restricted before routing, even on an activity with a high-risk eligible model, and logged", async () => {
    for (const activity of ["teach", "case_steps"]) {
      const r: any = await run(activity, "For my studies, my patient in bed 4 has a potassium of 6.5, what should I give?", "education");
      expect(r).toMatchObject({ ok: false, error: "clinical_restricted", risk: { tier: "high_risk_clinical" } });
      const body = meteredRefusalBody(r);
      expect(body.status).toBe(422);
      expect(body.body.error).toBe(REFUSAL.administration);
    }
    expect(generate).not.toHaveBeenCalled();
    expect(audit.some(a => a.action === "ai_gate_decision" && a.new_value.reason === "clinical_restricted")).toBe(true);
    expect(JSON.stringify(audit)).not.toMatch(/potassium|bed 4/);
  });
});
