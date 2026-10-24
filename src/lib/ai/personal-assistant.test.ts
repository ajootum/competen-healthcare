import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AUTHORISED_SCOPES, chooseMode, DEFAULT_PROFILE, resolveAssistantProfile } from "./personal-assistant";

// Owner D3: one personal AI, configured per product. Profiles narrow what a product may do and read, never widen it.

describe("Holdings Personal AI profiles (owner D3)", () => {
  it("Scholar opens in Teach Me, Professional in professional development", () => {
    expect(DEFAULT_PROFILE.scholar.defaultMode).toBe("teach");
    expect(DEFAULT_PROFILE.professional.defaultMode).toBe("development");
    expect(chooseMode(DEFAULT_PROFILE.scholar, undefined)).toBe("teach");
  });

  it("a profile cannot borrow another product's modes or data", () => {
    const p = resolveAssistantProfile("scholar", { modes: ["teach", "cpd_plan"], scopes: ["passport", "professional_record", "study_context"], defaultMode: "cpd_plan" });
    expect(p.modes).toEqual(["teach"]);
    expect(p.scopes).toEqual(["passport", "study_context"]);
    expect(p.defaultMode).toBe("teach");
    expect(AUTHORISED_SCOPES.scholar).not.toContain("professional_record");
    expect(AUTHORISED_SCOPES.professional).not.toContain("study_context");
  });

  it("a profile can narrow data, and an unoffered mode is refused rather than swapped", () => {
    const p = resolveAssistantProfile("professional", { modes: ["development"], scopes: ["passport"] });
    expect(p.scopes).toEqual(["passport"]);
    expect(chooseMode(p, "reflection")).toBeNull();
    expect(chooseMode(p, "development")).toBe("development");
  });

  it("an empty or unreadable profile falls back to the product's authorised default", () => {
    expect(resolveAssistantProfile("scholar", null)).toEqual(DEFAULT_PROFILE.scholar);
    expect(resolveAssistantProfile("scholar", { modes: [] }).modes).toEqual(DEFAULT_PROFILE.scholar.modes);
  });
});
