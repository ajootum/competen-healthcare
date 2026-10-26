// @vitest-environment jsdom
/**
 * IND-007 s7 PARTIAL: "after a create in a collapsed Add panel, the confirmation is hidden when the panel closes on
 * refresh". The refresh re-renders the page with the suggestion OFF (something is recorded now). These tests are that
 * re-render: the panel must stay open, and its confirmation with it.
 *
 * The "stays open" assertion alone would also pass on a panel that is always open, so it is paired with controls: a
 * panel suggested closed starts closed, a suggestion turning on opens it, and the person can still close it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
import { AddPanel } from "./forms";

const panel = (suggestOpen: boolean) => (
  <AddPanel label="Add a goal" accent="#000" suggestOpen={suggestOpen}><p role="status">Goal added.</p></AddPanel>
);
const details = () => screen.getByText("Add a goal").closest("details") as HTMLDetailsElement;

afterEach(cleanup);

describe("AddPanel", () => {
  it("stays open, confirmation in sight, when the refresh after the first save turns the suggestion off", () => {
    const { rerender } = render(panel(true));
    expect(details().open).toBe(true);
    rerender(panel(false));
    expect(details().open).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Goal added.");
  });

  it("control: suggested closed, it starts closed", () => {
    render(panel(false));
    expect(details().open).toBe(false);
  });

  it("control: a suggestion that turns on opens it (the first need makes a goal the next step)", () => {
    const { rerender } = render(panel(false));
    rerender(panel(true));
    expect(details().open).toBe(true);
  });

  it("control: the person can close it, and a re-render does not reopen it", () => {
    const { rerender } = render(panel(true));
    details().open = false;
    fireEvent(details(), new Event("toggle"));
    rerender(panel(true));
    expect(details().open).toBe(false);
  });
});

describe("AddPanel Cancel (HFE-01 Wave 5, F19)", () => {
  it("closes the panel without saving", () => {
    render(panel(true));
    expect(details().open).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(details().open).toBe(false);
  });
});
