import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isOutsideAll } from "./GlobalHeader";

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

// ── THE DISMISS PREDICATE ────────────────────────────────────────────────────────────────────────────
//
// The workspace menu is driven by ONE state (`menu === "workspace"`) and has FOUR elements: a desktop
// panel, an `md:hidden` mobile panel, and a trigger for each. It used to get two separate useDismiss
// hooks, and each treated the other's panel as OUTSIDE -- so on desktop, clicking a workspace link fired
// close() from the mobile hook. mousedown precedes click, the panel unmounted, and the click landed on an
// anchor that no longer existed. The menu shut and nothing navigated.
//
// These assert the predicate directly. No jsdom: `contains` is all it needs from an element.

const el = (...children: object[]) => ({ contains: (n: object) => children.includes(n) });
const ref = (current: { contains(n: object): boolean } | null) => ({ current });

describe("isOutsideAll — one click, every element that belongs to the menu", () => {
  it("a click inside the DESKTOP panel is inside, even though the mobile panel does not contain it", () => {
    const link = {};
    const desktop = el(link);
    const mobile = el();                                   // in the DOM, md:hidden, contains nothing here
    // The exact configuration of the bug: with two hooks, the mobile one saw this as outside and closed.
    expect(isOutsideAll(link as never, [ref(desktop), ref(mobile)] as never)).toBe(false);
  });

  it("a click inside the MOBILE panel is inside, symmetrically", () => {
    const link = {};
    expect(isOutsideAll(link as never, [ref(el()), ref(el(link))] as never)).toBe(false);
  });

  it("a click on EITHER trigger is inside — pressing one must not close in the same gesture", () => {
    const btn = {};
    expect(isOutsideAll(btn as never, [ref(el()), ref(el()), ref(el(btn)), ref(el())] as never)).toBe(false);
  });

  it("a click on the page really is outside, so the menu still dismisses", () => {
    // Without this control every assertion above could pass by never returning true at all.
    expect(isOutsideAll({} as never, [ref(el()), ref(el())] as never)).toBe(true);
  });

  it("an unmounted panel (null ref) does not make a real click count as outside", () => {
    const link = {};
    expect(isOutsideAll(link as never, [ref(el(link)), ref(null)] as never)).toBe(false);
  });

  it("no refs at all means outside — a menu with nothing mounted cannot swallow a click", () => {
    expect(isOutsideAll({} as never, [] as never)).toBe(true);
  });
});

describe("the wiring that made the predicate necessary", () => {
  it("has exactly ONE useDismiss call per menu state", () => {
    // THE FREEZE. Two hooks sharing one `open` condition is the shape of the bug: each treats the other's
    // panel as outside. Counting call sites is what stops it coming back, because the code reads fine.
    const calls = SRC.match(/useDismiss\(menu === "(\w+)"/g) ?? [];
    const states = calls.map(c => c.match(/"(\w+)"/)![1]);
    expect(states.length, "no useDismiss call sites found -- this assertion no longer binds").toBeGreaterThan(0);
    expect(new Set(states).size, `a menu state has two dismiss hooks: ${states.join(", ")}`).toBe(states.length);
  });

  it("gives the workspace menu all four of its elements", () => {
    const call = SRC.match(/useDismiss\(menu === "workspace", close, \[([^\]]*)\]/);
    expect(call, "the workspace dismiss call was reshaped -- re-check it covers both panels and both triggers").toBeTruthy();
    for (const el of ["wsPanel", "wsMobilePanel", "wsBtn", "wsMobileBtn"]) {
      expect(call![1], `${el} is not treated as inside the workspace menu`).toContain(el);
    }
  });
});
