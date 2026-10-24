import { describe, expect, it } from "vitest";
import { authorsOf, clinicalStatus, reviewRefusal, reviewRisk, scopeCovers } from "./clinical-review";
import { presentableAsApproved, usableForDecision } from "./content-governance";

// Migration 395, the pure parts: the state of a competency from its current content hash and review records,
// who counts as an author, the scope rule, and the Holdings rule for AI-generated content.

const v = (id: string, hash: string, required = 1) => ({ id, competency_id: "c", content_hash: hash, required_approvals: required, created_at: "2026-10-24T00:00:00Z" });
const d = (version_id: string, decision: string, at = "2026-10-24T01:00:00Z") => ({ version_id, decision, created_at: at });

describe("clinical-content approval (395)", () => {
  it("is unreviewed with no record, and in review until enough independent approvals", () => {
    expect(clinicalStatus("h1", [], []).state).toBe("unreviewed");
    expect(clinicalStatus("h1", [v("v1", "h1", 2)], [d("v1", "approved")])).toMatchObject({ state: "in_review", approvals: 1, required: 2 });
    expect(clinicalStatus("h1", [v("v1", "h1", 2)], [d("v1", "approved"), d("v1", "approved", "2026-10-24T02:00:00Z")])).toMatchObject({ state: "approved", approvedAt: "2026-10-24T02:00:00Z" });
  });

  it("binds to the exact content: a material change makes an approved version stale", () => {
    expect(clinicalStatus("h2", [v("v1", "h1")], [d("v1", "approved")]).state).toBe("stale");
    expect(clinicalStatus("h2", [v("v1", "h1"), v("v2", "h2")], [d("v1", "approved")]).state).toBe("in_review");
  });

  it("one rejection means changes were requested, whatever else approved", () => {
    expect(clinicalStatus("h1", [v("v1", "h1")], [d("v1", "approved"), d("v1", "rejected")]).state).toBe("changes_requested");
  });

  it("the submitter and every editor are authors; governance actions are not authorship", () => {
    expect(authorsOf("s", [{ actor_id: "e1", action: "update_competency" }, { actor_id: "p", action: "publish" }, { actor_id: null, action: "x" }])).toEqual(["s", "e1"]);
  });

  it("a scope is data -- profession, specialty, framework or domain -- and nothing else covers", () => {
    const c = { domainId: "d1", frameworkId: "f1", professionTermId: "t-any-profession", specialtyTermId: null };
    expect(scopeCovers([{ id: "1", appointmentId: "a", kind: "profession", ref: "t-any-profession" }], c)).toBe(true);
    expect(scopeCovers([{ id: "1", appointmentId: "a", kind: "domain", ref: "d2" }], c)).toBe(false);
    expect(scopeCovers([{ id: "1", appointmentId: "a", kind: "specialty", ref: "x" }], c)).toBe(false);
  });

  it("higher risk comes from the competency or its CPU, and every refusal is said in words", () => {
    expect([reviewRisk("high", null), reviewRisk(null, "high"), reviewRisk("standard", "standard")]).toEqual(["high", "high", "standard"]);
    expect(reviewRefusal("clinical_review_decision: not independent. x")).toMatch(/cannot review it/);
    expect(reviewRefusal("clinical_review_decision: stale. x")).toMatch(/renewed review/);
  });

  it("Holdings rule: private formative AI material is never presented as approved or used to decide; shared content only when approved", () => {
    expect(presentableAsApproved("private_formative", true)).toBe(false);
    expect(usableForDecision("private_formative", true)).toBe(false);
    expect(presentableAsApproved("shared_clinical", false)).toBe(false);
    expect(presentableAsApproved("shared_clinical", true)).toBe(true);
    expect(usableForDecision("formal_assessment", false)).toBe(false);
    expect(usableForDecision("formal_assessment", true)).toBe(true);
  });
});
