import { describe, expect, it } from "vitest";
import { resolveScholarTheme, scholarThemeOffered } from "./scholar-theme";
import { DEFAULT_POLICY, resolvePolicy, policyPath } from "@/lib/individual/policy";

// SCHOLAR-HFE-COLOR-01: the Calm Teal variant must not replace the approved Scholar theme until HQ says so.

describe("resolveScholarTheme", () => {
  it("defaults to the approved theme, and ignores a stored choice while the policy is 'current'", () => {
    expect(DEFAULT_POLICY.scholarTheme).toBe("current");
    expect(resolveScholarTheme("current", null)).toBe("current");
    expect(resolveScholarTheme("current", "calm")).toBe("current");
    expect(scholarThemeOffered("current")).toBe(false);
  });
  it("preview: the approved theme unless the learner chose Calm Teal", () => {
    expect(resolveScholarTheme("preview", undefined)).toBe("current");
    expect(resolveScholarTheme("preview", "calm")).toBe("calm");
    expect(scholarThemeOffered("preview")).toBe(true);
  });
  it("calm: Calm Teal unless the learner chose the approved theme", () => {
    expect(resolveScholarTheme("calm", null)).toBe("calm");
    expect(resolveScholarTheme("calm", "current")).toBe("current");
  });
  it("ignores a malformed stored value", () => expect(resolveScholarTheme("preview", "neon")).toBe("current"));
  it("reads the published policy and clamps an unknown value to the default", () => {
    expect(resolvePolicy([{ config_path: policyPath("scholar_theme"), published: { value: "preview" } }] as never).scholarTheme).toBe("preview");
    expect(resolvePolicy([{ config_path: policyPath("scholar_theme"), published: { value: "rainbow" } }] as never).scholarTheme).toBe("current");
  });
});
