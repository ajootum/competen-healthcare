import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { experiencesOf, gapList, isGap, SCHOLAR_EXPERIENCES, type ReadinessRow } from "./readiness";
import { SCHOLAR_AI_ACTIVITIES } from "@/lib/individual/scholar/ai-standing";

// SCHOLAR-EDU-AI-01 sections 6-7: a gap is an activity with no model at clinical educational (or at its high floor).

const R = { provider: "anthropic", model: "claude-sonnet-4-6" };
const row = (code: string, floor: ReadinessRow["floor"], routes: ReadinessRow["routes"]): ReadinessRow => ({ code, label: code, floor, routes, experiences: null, gap: isGap({ floor, routes }) });

describe("AI readiness", () => {
  it("a gap is no route at clinical educational; standard-only coverage is still a gap; high risk alone is not", () => {
    expect(isGap({ floor: "standard_educational", routes: { standard_educational: R, clinical_educational: null, high_risk_clinical: null } })).toBe(true);
    expect(isGap({ floor: "standard_educational", routes: { standard_educational: R, clinical_educational: R, high_risk_clinical: null } })).toBe(false);
    expect(isGap({ floor: "clinical_educational", routes: { clinical_educational: null, high_risk_clinical: null } })).toBe(true);
    expect(isGap({ floor: "high_risk_clinical", routes: { high_risk_clinical: R } })).toBe(false);
    expect(isGap({ floor: "high_risk_clinical", routes: { high_risk_clinical: null } })).toBe(true);
  });

  it("lists gaps for the publish warning, and nothing when unreadable", () => {
    expect(gapList([row("deeper", "standard_educational", { clinical_educational: null }), row("teach", "standard_educational", { clinical_educational: R })])).toEqual(["deeper (deeper)"]);
    expect(gapList(null)).toEqual([]);
  });

  it("names a student experience for every Scholar AI activity, and none for other products", () => {
    for (const a of SCHOLAR_AI_ACTIVITIES) expect(SCHOLAR_EXPERIENCES[a], a).toBeTruthy();
    expect(experiencesOf("professional", "teach")).toBeNull();
  });
});
