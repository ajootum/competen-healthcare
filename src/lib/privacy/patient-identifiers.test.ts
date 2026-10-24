import { describe, expect, it } from "vitest";
import { findPatientIdentifiers, isValidNhsNumber, PII_LABEL } from "./patient-identifiers";
import * as scholar from "@/lib/individual/scholar/extract";

// COMPETEN-HOLDINGS-SHARED-ENGINES-01: the patient-identifier screen is Holdings code; Scholar re-exports it.

describe("the shared patient-identifier screen", () => {
  it("finds the identifier shapes, by kind, never the value", () => {
    expect(isValidNhsNumber("9434765919")).toBe(true);
    expect(findPatientIdentifiers("Patient NHS no 943 476 5919, DOB: 12/03/1961, MRN 00482913")).toEqual(["nhs_number", "date_of_birth", "hospital_number"]);
    expect(findPatientIdentifiers("Give 500 ml over 15 minutes. Normal range 3.5-5.3 mmol/L.")).toEqual([]);
    expect(PII_LABEL.nhs_number).toBe("an NHS number");
  });

  it("is the very function Scholar uses -- one screen, not a copy", () => {
    expect(scholar.findPatientIdentifiers).toBe(findPatientIdentifiers);
    expect(scholar.isValidNhsNumber).toBe(isValidNhsNumber);
    expect(scholar.PII_LABEL).toBe(PII_LABEL);
  });
});
