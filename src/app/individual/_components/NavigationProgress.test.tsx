// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

const nav = vi.hoisted(() => ({ path: "/a", search: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useSearchParams: () => new URLSearchParams(nav.search) }));

import { NavigationProgress, startsNavigation } from "./NavigationProgress";

const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
const here = { origin: "https://x.test", pathname: "/a", search: "?q=1" };
const link = (href: string, o: Partial<{ target: string; hasDownload: boolean }> = {}) => ({ href, target: "", hasDownload: false, ...o });

describe("startsNavigation", () => {
  it("is true for another page or other search words", () => {
    expect(startsNavigation(click, link("https://x.test/b"), here)).toBe(true);
    expect(startsNavigation(click, link("https://x.test/a?q=2"), here)).toBe(true);
  });
  it("is false for the same page or a place on it", () => {
    expect(startsNavigation(click, link("https://x.test/a?q=1"), here)).toBe(false);
    expect(startsNavigation(click, link("https://x.test/a?q=1#upload"), here)).toBe(false);
  });
  it("is false for another site, a new tab, a download or a modified click", () => {
    expect(startsNavigation(click, link("https://other.test/b"), here)).toBe(false);
    expect(startsNavigation(click, link("https://x.test/b", { target: "_blank" }), here)).toBe(false);
    expect(startsNavigation(click, link("https://x.test/b", { hasDownload: true }), here)).toBe(false);
    expect(startsNavigation({ ...click, ctrlKey: true }, link("https://x.test/b"), here)).toBe(false);
    expect(startsNavigation({ ...click, button: 1 }, link("https://x.test/b"), here)).toBe(false);
    expect(startsNavigation({ ...click, defaultPrevented: true }, link("https://x.test/b"), here)).toBe(false);
  });
});

describe("NavigationProgress", () => {
  // A Next Link cancels the browser's navigation in its own click handler and then does its own, as "next link" does here.
  const page = () => render(
    <>
      <NavigationProgress />
      <a href="/b" onClick={e => e.preventDefault()}>next link</a>
      <a href="#here">hash</a>
    </>,
  );
  const bar = (c: HTMLElement) => c.querySelector("[data-nav-progress]");
  beforeEach(() => { nav.path = "/"; nav.search = ""; vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("shows at once on a tap, says so to a screen reader, and ends on arrival", () => {
    const { getByText, container, getByRole, rerender } = page();
    fireEvent.click(getByText("next link"));
    expect(bar(container)).not.toBeNull();
    expect(getByRole("status").textContent).toBe("Loading");
    nav.path = "/b";
    rerender(<NavigationProgress />);
    expect(bar(container)).toBeNull();
  });
  it("shows nothing for a link on the same page", () => {
    const { getByText, container } = page();
    fireEvent.click(getByText("hash"));
    expect(bar(container)).toBeNull();
  });
  it("gives up rather than run for ever", () => {
    const { getByText, container } = page();
    fireEvent.click(getByText("next link"));
    expect(bar(container)).not.toBeNull();
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(bar(container)).toBeNull();
  });
});
