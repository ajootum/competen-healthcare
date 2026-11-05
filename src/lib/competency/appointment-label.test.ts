import { describe, expect, it } from "vitest";
import { appointmentLabel } from "./clinical-review";

describe("a reviewer appointment as the reviewer reads it", () => {
  it("is named by its position, never its id", () => {
    expect(appointmentLabel("Clinical Content Reviewer", "clinical_content_reviewer", 1)).toBe("Clinical Content Reviewer");
  });
  it("says when it can approve nothing yet", () => {
    expect(appointmentLabel("Scholar Clinical Lead", "scholar_clinical_lead", 0)).toBe("Scholar Clinical Lead (no scope yet)");
  });
  it("puts the position code in words when no name can be read", () => {
    expect(appointmentLabel(null, "clinical_content_reviewer", 2)).toBe("Clinical content reviewer");
    expect(appointmentLabel("  ", null, 2)).toBe("Reviewer appointment");
  });
});
