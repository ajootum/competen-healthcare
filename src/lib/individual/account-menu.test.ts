import { describe, expect, it } from "vitest";
import { BOTTOM_BAR_MAX, EXPERIENCE_KEYS, bottomNavFor, navFor, overflowNavFor } from "./experiences";

// HFE-01 D1 (owner Option A): on a phone every destination is reachable -- the five-tab bar, plus the account
// menu holding everything else. The bar itself stays at five (CPR-MOB-001).
describe("account menu overflow", () => {
  for (const x of EXPERIENCE_KEYS) {
    it(`${x}: bar + menu together cover every sidebar destination exactly once`, () => {
      const bar = bottomNavFor(x).map(i => i.key);
      const menu = overflowNavFor(x).map(i => i.key);
      expect(bar.length).toBeLessThanOrEqual(BOTTOM_BAR_MAX);
      expect([...bar, ...menu].sort()).toEqual(navFor(x).map(i => i.key).sort());
      expect(menu.filter(k => bar.includes(k))).toEqual([]);
      expect(menu).toContain("settings");
    });
  }
  it("Professional's practice record is reachable on a phone and is called My practice", () => {
    const menu = overflowNavFor("professional");
    expect(menu.find(i => i.segment === "registration")?.label).toBe("My practice");
    for (const seg of ["evidence", "competencies", "progress", "profile"]) expect(menu.some(i => i.segment === seg)).toBe(true);
  });
});

// Private module development access: the account menu lists a private Scholar module only for a person who may see it.
describe("account menu and private Scholar modules", () => {
  const has = (allowed: readonly string[], segment: string) => navFor("scholar", allowed).some(i => i.segment === segment);
  it("lists neither Courses nor My Competencies when no module is allowed", () => {
    expect(has([], "courses")).toBe(false);
    expect(has([], "my-competencies")).toBe(false);
    expect(overflowNavFor("scholar", []).some(i => i.segment === "courses" || i.segment === "my-competencies")).toBe(false);
    for (const seg of ["study", "profile", "settings"]) expect(has([], seg)).toBe(true);
  });
  it("lists exactly the modules allowed", () => {
    expect(has(["courses"], "courses")).toBe(true);
    expect(has(["courses"], "my-competencies")).toBe(false);
    expect(has(["competencies"], "my-competencies")).toBe(true);
    expect(has(["competencies"], "courses")).toBe(false);
    expect(overflowNavFor("scholar", ["courses", "competencies"]).map(i => i.segment)).toEqual(expect.arrayContaining(["courses", "my-competencies"]));
  });
  it("leaves Professional untouched", () => expect(navFor("professional", []).map(i => i.key)).toEqual(navFor("professional").map(i => i.key)));
});
