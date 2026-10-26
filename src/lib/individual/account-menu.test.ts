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
