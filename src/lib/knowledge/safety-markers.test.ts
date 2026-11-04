import { describe, expect, it, vi } from "vitest";
import { hasSafetyMarkers, safetyMarkerScopes } from "./safety-markers";
import { decideReview, reviewRefusal } from "@/lib/competency/clinical-review";
import { MARKER_SAMPLES } from "./safety-markers.samples";

describe("hasSafetyMarkers (the 998 database rule)", () => {
  it.each(MARKER_SAMPLES.map(s => [s.name, s] as const))("%s", (_n, s) => {
    expect(hasSafetyMarkers(s.content)).toBe(s.markers);
  });
});

describe("safetyMarkerScopes", () => {
  it("names each marker with the scope it caps", () => {
    const rows = safetyMarkerScopes(MARKER_SAMPLES.find(s => s.name === "structured, a part with a safety-critical criterion and unsafe answers")!.content);
    expect(rows).toEqual([
      { scope: "Part b only", marker: "Unsafe answer: Give the next dose anyway", effect: "an answer that says one earns at most 50% of this part" },
      { scope: "Part b only", marker: "Safety-critical criterion: Withholds the dose", effect: "not meeting it earns 0% of this part" },
    ]);
  });
  it("a calculation's safety-critical flag caps the whole question", () => {
    const rows = safetyMarkerScopes(MARKER_SAMPLES.find(s => s.name === "calculation, safety-critical")!.content);
    expect(rows).toEqual([{ scope: "The whole question", marker: "Safety-critical calculation (a tenfold or greater error is unsafe)", effect: "missing or getting it wrong earns 0% of the question" }]);
  });
  it("extended key points are named from the rubric", () => {
    const rows = safetyMarkerScopes(MARKER_SAMPLES.find(s => s.name === "extended, safety-critical key point")!.content);
    expect(rows[0].marker).toBe("Safety-critical key point: Call for help");
  });
  it("no markers, nothing to approve", () => {
    expect(safetyMarkerScopes(MARKER_SAMPLES.find(s => s.name === "mcq, no markers")!.content)).toEqual([]);
  });
});

describe("decideReview keeps the marker approval on the reviewer's own decision", () => {
  const admin = () => { const insert = vi.fn(async () => ({ error: null })); return { insert, admin: { from: vi.fn(() => ({ insert })) } }; };
  it("sent only when approved", async () => {
    const a = admin();
    await decideReview(a.admin, "v", "r", "a", "approved", null, { safetyMarkersApproved: true });
    expect(a.insert).toHaveBeenCalledWith({ version_id: "v", reviewer_id: "r", appointment_id: "a", decision: "approved", comment: null, safety_markers_approved: true });
    const b = admin();
    await decideReview(b.admin, "v", "r", "a", "approved", null);
    expect(b.insert).toHaveBeenCalledWith({ version_id: "v", reviewer_id: "r", appointment_id: "a", decision: "approved", comment: null });
  });
  it("the 998 refusals in words", () => {
    expect(reviewRefusal("clinical_review_decision: safety markers are approved only with an approval of the version")).toMatch(/together with an approval/);
    expect(reviewRefusal("clinical_review_decision: this version carries no safety marker to approve")).toMatch(/no safety marker/);
    expect(reviewRefusal("clinical_review_decision: safety markers are approved only on a library revision question")).toMatch(/library revision question/);
    expect(reviewRefusal('column "safety_markers_approved" of relation "clinical_review_decision" does not exist')).toMatch(/998 is not applied/);
  });
});
