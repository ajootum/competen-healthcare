// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import ScholarPreviewBanner, { timeLeftLabel } from "./ScholarPreviewBanner";
import { EndPreviewButton } from "./ShellNav";
import { readPreviewRender } from "@/lib/individual/preview/headers";

afterEach(cleanup);

describe("ScholarPreviewBanner render states", () => {
  it("read-only: names the product, the demonstration learner and Read-only, with the time left and a Return to HQ form posting to /preview/end", () => {
    const { container } = render(<ScholarPreviewBanner mode="read_only" secondsLeft={58 * 60} />);
    const region = screen.getByRole("region", { name: "Scholar product preview" });
    expect(region.getAttribute("data-scholar-preview")).toBe("read_only");
    expect(region.textContent).toContain("Scholar Product Preview · Demonstration learner · Read-only");
    expect(screen.getByRole("timer").textContent).toBe("58 min left");
    const form = container.querySelector("form") as HTMLFormElement;
    expect(form.getAttribute("action")).toBe("/preview/end");
    expect(form.getAttribute("method")?.toLowerCase()).toBe("post");
    expect(screen.getByRole("button", { name: "Return to HQ" })).toBeTruthy();
    expect(region.className).not.toContain("amber");
  });

  it("testing: a distinct amber bar that says changes and AI use go to the sandbox demo learner", () => {
    render(<ScholarPreviewBanner mode="testing" secondsLeft={30 * 60} />);
    const region = screen.getByRole("region", { name: "Scholar product preview" });
    expect(region.getAttribute("data-scholar-preview")).toBe("testing");
    expect(region.textContent).toContain("Testing mode: changes and AI use go to the sandbox demo learner");
    expect(region.textContent).not.toContain("Read-only");
    expect(region.className).toContain("amber");
  });

  it("touch sizing is gated on pointer-coarse, never on viewport width", () => {
    render(<ScholarPreviewBanner mode="read_only" secondsLeft={600} />);
    const button = screen.getByRole("button", { name: "Return to HQ" });
    expect(button.className).toContain("pointer-coarse:h-[var(--cmp-touch-min)]");
    expect(button.className).not.toMatch(/\b(sm|lg|xl):/);
  });

  it("says Preview ended at zero, and Under 1 min near the end", () => {
    expect(timeLeftLabel(0)).toBe("Preview ended");
    expect(timeLeftLabel(-3)).toBe("Preview ended");
    expect(timeLeftLabel(45)).toBe("Under 1 min left");
    expect(timeLeftLabel(60)).toBe("1 min left");
    expect(timeLeftLabel(61)).toBe("2 min left");
    render(<ScholarPreviewBanner mode="read_only" secondsLeft={0} />);
    expect(screen.getByRole("timer").textContent).toBe("Preview ended");
  });
});

describe("the account menu on the preview host", () => {
  it("offers End preview as a POST to /preview/end, not Sign out", () => {
    const { container } = render(<EndPreviewButton />);
    expect(screen.getByRole("button", { name: "End preview" })).toBeTruthy();
    expect(container.querySelector("form")?.getAttribute("action")).toBe("/preview/end");
    expect(screen.queryByText("Sign out")).toBeNull();
  });
});

describe("readPreviewRender: the banner shows only from the proxy's headers", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
  const now = Date.parse("2026-11-02T10:00:00Z");
  it("is null without a header, or with an unknown mode (a spoofed value shows nothing)", () => {
    expect(readPreviewRender(h({}), now)).toBeNull();
    expect(readPreviewRender(h({ "x-scholar-preview-mode": "admin" }), now)).toBeNull();
    expect(readPreviewRender(h({ "x-scholar-preview-mode": "" }), now)).toBeNull();
  });
  it("reads the mode and the seconds left from the injected headers", () => {
    expect(readPreviewRender(h({ "x-scholar-preview-mode": "testing", "x-scholar-preview-expires": "2026-11-02T10:10:00Z" }), now)).toEqual({ mode: "testing", secondsLeft: 600 });
    expect(readPreviewRender(h({ "x-scholar-preview-mode": "read_only", "x-scholar-preview-expires": "2026-11-02T09:00:00Z" }), now)).toEqual({ mode: "read_only", secondsLeft: 0 });
    expect(readPreviewRender(h({ "x-scholar-preview-mode": "read_only" }), now)?.secondsLeft).toBe(0);
  });
});
