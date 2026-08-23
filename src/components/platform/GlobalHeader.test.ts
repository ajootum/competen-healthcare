import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The header's dropdown panel has a DATA-DRIVEN height: the workspace menu renders one row per workspace
// the person holds. That is fine at four and broken at sixteen, and the breakage is invisible in review
// because the markup is identical either way -- you have to hold enough workspaces to see it.
//
// A user with estate roles across admin, education, nursing and assessment PLUS an HQ appointment gets a
// panel taller than the viewport, and the header is `sticky top-0`, so the overflow cannot be scrolled to:
// the panel moves with the header and the entries below the fold stay below it permanently. Reported from
// a real screen, where the last visible entry was clipped by the viewport edge.
//
// This is a SOURCE assertion because the property is a CSS class on a shared constant, not a behaviour a
// render test would reach -- jsdom has no viewport height to overflow.

const SRC = readFileSync(new URL("./GlobalHeader.tsx", import.meta.url), "utf8");
const PANEL_LINE = SRC.split(/\r?\n/).find(l => l.startsWith("const PANEL ="));

describe("the header dropdown panel cannot outgrow the viewport", () => {
  it("has a PANEL constant to assert against", () => {
    // The control: if this constant is renamed or inlined, every assertion below would pass vacuously
    // against `undefined`, so the suite would go green on a panel with no constraint at all.
    expect(PANEL_LINE, "const PANEL was renamed or inlined -- the assertions below no longer bind").toBeTruthy();
  });

  it("bounds its height, so a long workspace list cannot run off the screen", () => {
    expect(PANEL_LINE).toMatch(/max-h-/);
  });

  it("scrolls its own overflow, because a sticky header can never scroll it into view", () => {
    // Without this, max-h alone would CLIP the extra entries -- hiding them more neatly rather than
    // making them reachable, which is the same defect with better manners.
    expect(PANEL_LINE).toMatch(/overflow-y-auto/);
  });

  it("contains its scroll, so reaching the end of the menu does not scroll the page behind it", () => {
    expect(PANEL_LINE).toMatch(/overscroll-contain/);
  });

  it("still positions under its trigger and above the page", () => {
    // Pinned so a future edit to the height rules cannot quietly drop the positioning that makes the
    // panel a panel.
    expect(PANEL_LINE).toMatch(/absolute/);
    expect(PANEL_LINE).toMatch(/z-50/);
  });

  it("CONTROL — the needle is not matching its own documentation", () => {
    // This repository has recorded eight separate times that a source scan matched the comment explaining
    // the rule rather than the rule. PANEL_LINE is one code line, taken by prefix, so a comment mentioning
    // max-h cannot satisfy any assertion above.
    expect(PANEL_LINE?.startsWith("//")).toBe(false);
    expect(PANEL_LINE).toContain("absolute right-0");
  });
});
