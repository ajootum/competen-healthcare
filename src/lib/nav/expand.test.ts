import { describe, it, expect } from "vitest";
import { isParentOpen, submenuWithOverview } from "./expand";

// HQ-NAV-EXPAND-01 s4: the rule that decides whether a sidebar parent is open.
describe("isParentOpen", () => {
  it("opens the parent of the page you are on, untouched", () => {
    expect(isParentOpen(true, undefined, "/a/b")).toBe(true);
  });
  it("control: leaves a parent closed when it does not hold the page and nobody opened it", () => {
    expect(isParentOpen(false, undefined, "/a/b")).toBe(false);
  });
  it("keeps the person's choice on the page where they made it, even closing the active parent", () => {
    expect(isParentOpen(true, { open: false, at: "/a/b" }, "/a/b")).toBe(false);
  });
  it("re-opens the active parent when the person arrives on a new page inside it", () => {
    expect(isParentOpen(true, { open: false, at: "/a/b" }, "/a/c")).toBe(true);
  });
  it("keeps a parent the person opened open while they move elsewhere (no accordion)", () => {
    expect(isParentOpen(false, { open: true, at: "/x" }, "/a/c")).toBe(true);
  });
  it("keeps a parent the person closed closed while they move elsewhere", () => {
    expect(isParentOpen(false, { open: false, at: "/x" }, "/a/c")).toBe(false);
  });
});

describe("submenuWithOverview", () => {
  const parent = { key: "p", label: "Competency Delivery", href: "/s/delivery", icon: "🎓" };
  const kids = [{ key: "c", label: "Reminders", href: "/s/delivery/reminders", icon: "·" }];
  it("puts the parent's own landing page first, as Overview, on the same href", () => {
    const m = submenuWithOverview(parent, kids);
    expect(m.map(x => [x.label, x.href])).toEqual([["Overview", "/s/delivery"], ["Reminders", "/s/delivery/reminders"]]);
  });
  it("does not repeat the landing page when a child already is it", () => {
    expect(submenuWithOverview(parent, [{ ...kids[0], href: "/s/delivery" }]).length).toBe(1);
  });
});
