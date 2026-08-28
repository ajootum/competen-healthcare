/**
 * CPR-BOOK-HFE-002 s16 -- the failure vocabulary is COMPLETE and honest.
 *
 * The pin that matters: every reason code the public entry can emit has a recorded practitioner
 * action (or an honest "not yours to fix"), so no failure ever reaches the setup workspace with
 * nothing to say. The union below is written out by hand ON PURPOSE -- if a new code is added to
 * PublicBookingEntry without a translation, this test is the tripwire that names it.
 */
import { describe, it, expect } from "vitest";
import { PUBLIC_FAILURE_ACTIONS, publicFailureAction } from "./public-failure-constants";

const EVERY_ENTRY_CODE = [
  "PAGE_NOT_PUBLISHED", "PAGE_PAUSED", "NOTHING_OFFERED",
  "NO_WAY_TO_SEND_A_CODE", "NO_PATIENT_SCREEN", "COULD_NOT_CHECK",
  // The soft availability state, translated the same way.
  "NO_PUBLIC_CLINIC",
];

describe("the public-failure vocabulary (s16)", () => {
  it("every code the entry can emit has a translation", () => {
    for (const code of EVERY_ENTRY_CODE) {
      expect(PUBLIC_FAILURE_ACTIONS[code], code).toBeDefined();
    }
  });

  it("every translation either acts or says honestly why it cannot", () => {
    for (const [code, a] of Object.entries(PUBLIC_FAILURE_ACTIONS)) {
      const acts = a.href !== null && a.label.length > 0;
      const declines = a.href === null && (a.why ?? "").length > 20;
      expect(acts || declines, `${code} neither acts nor explains`).toBe(true);
    }
  });

  it("practitioner-fixable codes land inside the Patient Booking workspace", () => {
    for (const code of ["PAGE_PAUSED", "PAGE_NOT_PUBLISHED", "NO_PUBLIC_CLINIC", "NOTHING_OFFERED"]) {
      expect(PUBLIC_FAILURE_ACTIONS[code].href).toContain("/practice/setup/patient-booking");
    }
  });

  it("an unknown code is named as a vocabulary gap, never given an invented correction", () => {
    const a = publicFailureAction("SOMETHING_NEW");
    expect(a.href).toBeNull();
    expect(a.why).toContain("gap in this product's vocabulary");
  });
});
