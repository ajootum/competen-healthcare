/**
 * CPR-BOOK-HFE-002 s14 -- the first-time wizard's arithmetic and its render.
 *
 * The pins that matter: the wizard NEVER outlives first publication (published, published-with-
 * warnings and paused all end it); resume lands on the FIRST incomplete stage; and evidence that
 * could not be read counts as incomplete with the reason said -- never as a tick, never skipped.
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { computeSetupWizard, type WizardCheck } from "./wizard";
import SetupWizard from "./SetupWizard";

const pass = (codes: string[]): WizardCheck[] => codes.map(code => ({ code, state: "pass" }));
const ALL = [
  "HANDLE_CLAIMED", "ACCESS_MODE_SELECTED", "MODE_ADMITS_PATIENTS",
  "SESSION_BOOKABLE", "EFFECTIVE_BOOKING_CONSTRAINTS_SATISFIED",
  "RESERVED_WITHIN_CAPACITY", "RULE_CONFLICTS_RESOLVED",
  "REGISTRATION_FIELDS_VALID", "INTAKE_BUILT",
];

describe("computeSetupWizard (s14)", () => {
  it("ends forever at first publication — published, with warnings, or paused", () => {
    for (const state of ["published", "published_with_warnings", "paused"]) {
      expect(computeSetupWizard({
        publishState: state, verdict: "ready", checks: pass(ALL), onlineClinicCount: 2,
      }).show).toBe(false);
    }
  });

  it("shows before publication, including when no page row exists at all", () => {
    for (const state of [null, "draft", "ready"]) {
      expect(computeSetupWizard({
        publishState: state, verdict: "not_ready", checks: [], onlineClinicCount: 0,
      }).show).toBe(true);
    }
  });

  it("everything ready: stages 1-4 done, publish is current, and it says one step remains", () => {
    const v = computeSetupWizard({
      publishState: "ready", verdict: "ready", checks: pass(ALL), onlineClinicCount: 3,
    });
    expect(v.stages.slice(0, 4).map(s => s.state)).toEqual(["done", "done", "done", "done"]);
    expect(v.stages[4].state).toBe("current");
    expect(v.stages[4].detail).toContain("publishing is the last step");
    expect(v.continueTab).toBe("publish");
    expect(v.stages[1].detail).toContain("3 clinics accepting online bookings");
  });

  it("resumes at the FIRST incomplete stage — a failed handle outranks everything after it", () => {
    const checks = pass(ALL).map(c => c.code === "HANDLE_CLAIMED" ? { ...c, state: "fail" } : c);
    const v = computeSetupWizard({ publishState: "draft", verdict: "not_ready", checks, onlineClinicCount: 2 });
    expect(v.stages[0].state).toBe("current");
    expect(v.continueTab).toBe("page");
    expect(v.stages.filter(s => s.state === "current")).toHaveLength(1);
  });

  it("a clinic count of zero keeps stage 2 incomplete even when the session check passes", () => {
    const v = computeSetupWizard({
      publishState: "draft", verdict: "not_ready", checks: pass(ALL), onlineClinicCount: 0,
    });
    expect(v.stages[1].state).toBe("current");
    expect(v.stages[1].detail).toContain("Turn on online booking");
    expect(v.continueTab).toBe("clinics");
  });

  it("evidence that could not be read is incomplete WITH the reason — never a tick, never skipped", () => {
    const checks = pass(ALL).map(c =>
      c.code === "REGISTRATION_FIELDS_VALID" ? { ...c, state: "not_checked" } : c);
    const v = computeSetupWizard({ publishState: "draft", verdict: "ready", checks, onlineClinicCount: 1 });
    expect(v.stages[3].state).toBe("current");
    expect(v.stages[3].couldNotCheck).toBe(true);
    expect(v.stages[3].detail).toContain("could not be read");
    // And unreadable rules make stage 2 unknown-incomplete the same way.
    const blind = computeSetupWizard({ publishState: "draft", verdict: "ready", checks: pass(ALL), onlineClinicCount: null });
    expect(blind.stages[1].state).toBe("current");
    expect(blind.stages[1].couldNotCheck).toBe(true);
  });

  it("a check the engine never reported reads as not-checked, not as passed", () => {
    const v = computeSetupWizard({ publishState: "draft", verdict: "ready", checks: [], onlineClinicCount: 1 });
    expect(v.stages[0].state).toBe("current");
    expect(v.stages[0].couldNotCheck).toBe(true);
  });
});

describe("the stepper render", () => {
  const routerStub = {
    back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {}, hmrRefresh() {},
  } as never;
  const render = (view: ReturnType<typeof computeSetupWizard>) =>
    renderToString(React.createElement(
      AppRouterContext.Provider, { value: routerStub },
      React.createElement(SetupWizard, { view }),
    )).replace(/<!-- -->/g, "");

  it("renders the five stages with Continue on the current one, each linking to its owning tab", () => {
    const html = render(computeSetupWizard({
      publishState: "draft", verdict: "not_ready",
      checks: pass(["HANDLE_CLAIMED", "ACCESS_MODE_SELECTED", "MODE_ADMITS_PATIENTS", "SESSION_BOOKABLE"]),
      onlineClinicCount: 0,
    }));
    for (const t of ["Booking page", "Clinics &amp; availability", "Booking behaviour", "Patient information", "Review &amp; publish"])
      expect(html).toContain(t);
    expect(html).toContain("Continue: Clinics &amp; availability →");
    expect(html).toContain("?tab=clinics");
    expect(html).toContain("nothing is live until you publish");
  });

  it("renders nothing at all after first publication", () => {
    const gone = render(computeSetupWizard({
      publishState: "published", verdict: "ready", checks: pass(ALL), onlineClinicCount: 1,
    }));
    expect(gone).toBe("");
  });
});
