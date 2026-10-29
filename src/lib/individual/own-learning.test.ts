/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { OWN_LEARNING_HEADING, OWN_LEARNING_MAX, ownLearningContext } from "./own-learning";
import { AUTHORISED_SCOPES, DEFAULT_PROFILE, resolveAssistantProfile } from "@/lib/ai/personal-assistant";
import { systemPrompt } from "./assistant";
import { purposeFrom, pilotQuotaRefusal } from "./pilot-ai";

// Supervised Pilot, learner side: the Personal AI's own-learning context is words about what the person recorded,
// says "Not recorded" for the rest, stays under its cap, and the Professional part is off unless the owner publishes it.

const row = (title: string, status: "no_notes" | "notes_linked" | "practising", latestAccuracy: number | null): any =>
  ({ id: title, layer: "profession", catalogue: "x", domain: "d", code: null, title, structure: null, contentStatus: "approved", sectionsAccepted: 1, sectionsProposed: 0, questions: 3, answered: 3, latestCorrect: 1, latestAccuracy, status });

describe("own learning block", () => {
  it("labels what the person recorded and keeps progress in words, with no figures", () => {
    const t = ownLearningContext({
      programme: "BSc Nursing", level: "Year 2",
      progress: [row("Hand hygiene", "practising", 80), row("Wound care", "practising", 40), row("Airway basics", "notes_linked", null)],
      development: "not_shared",
    });
    expect(t.startsWith(OWN_LEARNING_HEADING)).toBe(true);
    expect(t).toContain("Programme (recorded by you): BSc Nursing.");
    expect(t).toContain("Level (recorded by you): Year two.");
    expect(t).toMatch(/You have practised: Hand hygiene/);
    expect(t).toMatch(/more practice is needed on: Wound care/);
    expect(t).toMatch(/not practised yet: Airway basics/);
    expect(t).not.toMatch(/\d%|80|40/);
    expect(t).toMatch(/not an assessment of competence/);
  });

  it("says Not recorded for what is missing, and never reads as empty when it could not be read", () => {
    const t = ownLearningContext({ programme: null, level: null, progress: null, development: "not_shared" });
    expect(t).toContain("Not recorded: programme.");
    expect(t).toContain("Not recorded: level.");
    expect(t).toContain("Not recorded: study progress");
    expect(ownLearningContext({ programme: "unreadable", level: "unreadable", progress: "unreadable", development: "not_shared" })).toMatch(/Programme: could not be read just now/);
  });

  it("names development as not available unless it was shared, and as not recorded when shared but empty", () => {
    expect(ownLearningContext({ programme: null, level: null, progress: null, development: "not_shared" })).toMatch(/Not available to this assistant: your development needs, goals and plan/);
    const shared = ownLearningContext({ programme: null, level: null, progress: null, development: { needs: [], goals: [] } });
    expect(shared).toContain("Not recorded: development needs.");
    expect(shared).toContain("Not recorded: development goals or targets.");
    const off = ownLearningContext({ programme: null, level: null, progress: null, development: { needs: "off", goals: "unreadable" } });
    expect(off).toMatch(/Not available to this assistant: your development needs/);
    expect(off).toMatch(/goals and targets: could not be read/);
  });

  it("lists the person's open needs and live goals, labelled as recorded by them, and leaves closed ones out", () => {
    const t = ownLearningContext({
      programme: null, level: null, progress: null,
      development: {
        needs: [{ title: "Confidence with ECGs", stage_code: "exploring" }, { title: "Old need", stage_code: "addressed" }] as any,
        goals: [{ title: "Pass OSCE", status: "in_progress", target_date: "2026-12-01" }, { title: "Done goal", status: "done", target_date: null }] as any,
      },
    });
    expect(t).toContain("Development needs (recorded by you): Confidence with ECGs (");
    expect(t).toContain("Development goals and targets (recorded by you): Pass OSCE (");
    expect(t).toContain("target 2026-12-01");
    expect(t).not.toMatch(/Old need|Done goal/);
  });

  it("stays under its cap with whole lines", () => {
    const many = Array.from({ length: 40 }, (_, i) => row(`Competency ${"x".repeat(80)} ${i}`, "practising", 20));
    const long = "word ".repeat(200);
    const t = ownLearningContext({
      programme: long, level: long, progress: many,
      development: { needs: Array.from({ length: 9 }, () => ({ title: long, stage_code: "exploring" })) as any, goals: [] },
    });
    expect(t.length).toBeLessThanOrEqual(OWN_LEARNING_MAX);
  });
});

describe("own-learning scopes and the prompt rule", () => {
  it("Scholar gets own_learning by default; own_development is authorised but absent until the owner publishes it", () => {
    expect(AUTHORISED_SCOPES.scholar).toContain("own_learning");
    expect(AUTHORISED_SCOPES.scholar).toContain("own_development");
    expect(DEFAULT_PROFILE.scholar.scopes).toContain("own_learning");
    expect(DEFAULT_PROFILE.scholar.scopes).not.toContain("own_development");
    expect(resolveAssistantProfile("scholar", { scopes: ["passport", "own_learning"] }).scopes).toEqual(["passport", "own_learning"]);
    expect(resolveAssistantProfile("scholar", { scopes: ["passport", "own_development"] }).scopes).toEqual(["passport", "own_development"]);
    expect(resolveAssistantProfile("professional", { scopes: ["passport", "own_learning", "own_development"] }).scopes).toEqual(["passport"]);
  });

  it("the shared persona keeps verified evidence, the learner's own records and suggestions apart", () => {
    expect(systemPrompt("scholar")).toContain("Keep three things apart: VERIFIED evidence");
    expect(systemPrompt("professional")).toContain("If something is not recorded, say so instead of guessing");
  });
});

describe("pilot helpers", () => {
  it("purposeFrom accepts only the exact string education", () => {
    expect(purposeFrom({ purpose: "education" })).toBe("education");
    for (const v of ["Education", "study", "", 1, true, null, undefined, ["education"]]) expect(purposeFrom({ purpose: v })).toBeNull();
    expect(purposeFrom(null)).toBeNull();
    expect(purposeFrom("education")).toBeNull();
  });

  it("a cohort's higher hourly limit can lift a refusal but never lowers one, and an unreadable count stays refused", async () => {
    const ME = "00000000-0000-4000-8000-000000000001";
    const published = { defaultMode: "strict_production", cohorts: [{ code: "cchu-pilot-1", mode: "supervised_pilot", userIds: [ME], hourlyLimit: 60 }] };
    const admin = (doc: unknown): any => ({
      from: (t: string) => {
        const q: any = {
          select: () => q, eq: () => q,
          maybeSingle: async () => ({ data: t === "workspace_config_overrides" && doc ? { published: doc, updated_at: "t" } : null, error: null }),
          then: (f: any) => f({ data: [], error: null }),
        };
        return q;
      },
    });
    const refusal = { status: 429, error: "limit" };
    const q = { used: 31, limit: 30, unreadable: false };
    expect(await pilotQuotaRefusal(admin(published), "scholar", ME, q, refusal)).toBeNull();
    expect(await pilotQuotaRefusal(admin(published), "scholar", ME, { used: 61, limit: 30, unreadable: false }, refusal)).toMatchObject({ status: 429, error: expect.stringContaining("60") });
    expect(await pilotQuotaRefusal(admin(published), "scholar", "00000000-0000-4000-8000-000000000002", q, refusal)).toBe(refusal);
    expect(await pilotQuotaRefusal(admin(null), "scholar", ME, q, refusal)).toBe(refusal);
    const unreadable = { status: 503, error: "x" };
    expect(await pilotQuotaRefusal(admin(published), "scholar", ME, { used: 0, limit: 30, unreadable: true }, unreadable)).toBe(unreadable);
    expect(await pilotQuotaRefusal(admin(published), "scholar", ME, { used: 1, limit: 30, unreadable: false }, null)).toBeNull();
  });
});

describe("the cross-experience consent (migration 700)", () => {
  it("is its own feature, with a versioned plain-language notice that names what is and is never shared", async () => {
    const c = await import("./scholar/config");
    expect(c.CROSS_EXPERIENCE_FEATURE).toBe("ai_cross_experience_context");
    expect(c.CROSS_EXPERIENCE_FEATURE).not.toBe(c.CONSENT_FEATURE);
    expect(c.CROSS_EXPERIENCE_NOTICE.never.join(" ")).toMatch(/employer/);
    expect(c.CROSS_EXPERIENCE_NOTICE.off).toMatch(/turn this off at any time/);
  });
  it("is OFF by default: the default Scholar profile does not list own_development", async () => {
    const { DEFAULT_PROFILE } = await import("@/lib/ai/personal-assistant");
    expect(DEFAULT_PROFILE.scholar.scopes).not.toContain("own_development");
  });
});
