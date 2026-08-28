/**
 * The Command Centre booking-link card: four states, and the share affordance exists in exactly one.
 *
 * The pin that matters is the NEGATIVE one: `claimed_not_open` must never offer Copy/Open/share for
 * an address a patient cannot open -- the identity console's history records what happens when a dead
 * address reaches a poster. The other states are pinned so the card cannot quietly become blank.
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import BookingLinkCard from "./BookingLinkCard";

const routerStub = {
  back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {}, hmrRefresh() {},
} as never;

const render = (summary: Parameters<typeof BookingLinkCard>[0]["summary"]) =>
  renderToString(
    React.createElement(
      AppRouterContext.Provider, { value: routerStub },
      React.createElement(BookingLinkCard, { summary }),
    ),
  ).replace(/<!-- -->/g, "");

const URL = "https://competenhealthcare.com/practice/book/@dreokaisu";

describe("the Command Centre booking-link card", () => {
  it("live: the address with copy, open and the share-tools pointer", () => {
    const html = render({ state: "live", handle: "dreokaisu", url: URL });
    expect(html).toContain("Your booking link");
    expect(html).toContain(URL);
    expect(html).toContain("Copy link");
    expect(html).toContain("Open ↗");
    expect(html).toContain("share tools");
  });

  it("claimed but not open: shown for recognition, refused for sharing", () => {
    const html = render({ state: "claimed_not_open", handle: "dreokaisu", url: URL });
    expect(html).toContain(URL);
    expect(html).toContain("does not open yet");
    expect(html).toContain("Finish publishing");
    expect(html).not.toContain("Copy link");
    expect(html).not.toContain("Open ↗");
  });

  it("none: points at claiming, prints no address", () => {
    const html = render({ state: "none" });
    expect(html).toContain("no booking address yet");
    expect(html).toContain("Claim your address");
    expect(html).not.toContain("/practice/book/");
  });

  it("unreadable: the outage, never a guessed address and never a claim of none", () => {
    const html = render({ state: "unreadable", reason: "the read failed" });
    expect(html).toContain("could not be read");
    expect(html).not.toContain("/practice/book/");
    expect(html).not.toContain("no booking address yet");
  });
});
