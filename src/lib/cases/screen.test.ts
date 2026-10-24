import { describe, expect, it } from "vitest";
import { CASE_SCREEN_CORPUS, screenBlueprint, screenText, structuredKinds } from "./screen";

// The deterministic eligibility gate (owner Stage 5 approval, IND-004 C-b). The structured kinds match the database
// backstop on one corpus. The judged kinds make this screen stricter than the database, never looser.

describe("the case identifier screen", () => {
  it("finds exactly the structured kinds the database finds, on the parity corpus", () => {
    for (const c of CASE_SCREEN_CORPUS) expect(structuredKinds(c.text), c.text).toEqual(c.kinds);
  });

  it("is stricter than the database: titled names, addresses, named facilities, exact ages over 89", () => {
    expect(screenText("Mrs Okello was admitted")).toContain("titled_name");
    expect(screenText("lives at 14 Kampala Road")).toContain("street_address");
    expect(screenText("transferred from St Mary's Hospital")).toContain("named_facility");
    expect(screenText("seen at Mulago Referral Hospital")).toContain("named_facility");
    expect(screenText("a 94-year-old woman")).toContain("exact_age_over_89");
    expect(screenText("a woman in her sixties, on the surgical ward, respiratory rate 30")).toEqual([]);
    expect(screenText("seen on 12/03/24")).toContain("written_date");
    expect(screenText("admitted on 12 March 2024")).toContain("written_date");
    expect(screenText("March 12, 2024")).toContain("written_date");
    expect(screenText("day 2 post-op, 3/7 history, 1/52 ago, at 14:00, BP 85/50, GCS 14/15")).toEqual([]);
  });

  it("screens every text field of a blueprint, the patient's age band, and source references", () => {
    const b = { title: "Breathless", patient: { ageBand: "60-69", setting: "Ward", presentingComplaint: "Breathless", background: [] },
      facts: [{ id: "rr", label: "Respiratory rate", value: "30" }], decisionPoints: [{ id: "d1", prompt: "First?", options: [] }] };
    expect(screenBlueprint(b)).toEqual([]);
    expect(screenBlueprint({ ...b, facts: [{ id: "n", label: "Notes", value: "MRN 1234567" }] })).toEqual(["hospital_number"]);
    expect(screenBlueprint({ ...b, patient: { ...b.patient, ageBand: "63" } })).toEqual(["age_not_banded"]);
    expect(screenBlueprint({ ...b, patient: { ...b.patient, ageBand: "90+" } })).toEqual([]);
    expect(screenBlueprint({ ...b, decisionPoints: [{ id: "d1", prompt: "First?", options: [], sourceRefs: ["section:1"] }] })).toEqual(["source_refs"]);
  });

  it("the bypassed-AI red: an AI saying the content is de-identified changes nothing", () => {
    const leaky = { title: "Leaky", metadata: { provenance: { note: "AI screen: de-identified, safe to share" } }, facts: [{ value: "NHS 943 476 5919" }] };
    expect(screenBlueprint(leaky)).toEqual(["nhs_number"]);
  });
});
