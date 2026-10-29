/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";

// CFCA-STUDIO-P1 (670): the clinical reviewer sees a competency's criteria, by component -- and only for a CURRENT
// version, whose hash (which covers each criterion and its component) still matches, so they are what is approved.

vi.mock("./clinical-review", () => ({
  reviewerAppointments: async () => [{ id: "appt-1", scopes: [{ id: "s", appointmentId: "appt-1", kind: "profession", ref: "nursing" }] }],
  scopeCovers: () => true,
  approverPositions: async () => ["committee_clinical_content_reviewer"],
  carryingApproval: async () => [],
}));
import { reviewQueue } from "./clinical-review-hq";

function fake(tables: Record<string, any[]>, hashes: { competency_id: string; content_hash: string }[]) {
  const from = (table: string) => {
    const q: any = {};
    for (const op of ["select", "order", "limit", "in", "eq", "is", "or"]) q[op] = () => q;
    q.then = (ok: any) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(ok);
    return q;
  };
  return { from, rpc: async () => ({ data: hashes, error: null }) };
}
const version = (hash: string) => ({ id: "v1", competency_id: "c1", content_hash: hash, required_approvals: 1, submitted_by: "author", authored_by: ["author"], created_at: "2026-10-29T00:00:00Z", content_snapshot: { name: "Respiratory Assessment", skills: [] } });
const base = {
  framework_competencies: [{ id: "c1", name: "Respiratory Assessment", domain_id: "d1" }],
  framework_domains: [{ id: "d1", name: "Breathing", framework_id: "f1" }],
  frameworks: [{ id: "f1", name: "Competen Nursing Competency Framework", profession_term_id: "nursing", specialty_term_id: null }],
  clinical_review_decision: [],
  competency_skills: [
    { competency_id: "c1", name: "Able to perform a comprehensive respiratory assessment", sort_order: 1, component_code: "clinical_skills", source_ref: "Sheet!D4" },
    { competency_id: "c1", name: "Demonstrates knowledge of normal respiratory cycle", sort_order: 2, component_code: "knowledge", source_ref: "Sheet!D11" },
  ],
};

describe("the review queue shows criteria by component for the version under review", () => {
  it("a current version carries its criteria, each with its component and source", async () => {
    const q = await reviewQueue(fake({ ...base, clinical_content_version: [version("h-now")] }, [{ competency_id: "c1", content_hash: "h-now" }]), "reviewer");
    expect(q?.items).toHaveLength(1);
    expect(q!.items[0].criteria).toEqual([
      { component: "clinical_skills", text: "Able to perform a comprehensive respiratory assessment", sourceRef: "Sheet!D4" },
      { component: "knowledge", text: "Demonstrates knowledge of normal respiratory cycle", sourceRef: "Sheet!D11" },
    ]);
  });
  it("a stale version (content or classification changed since it was put forward) is not offered at all", async () => {
    const q = await reviewQueue(fake({ ...base, clinical_content_version: [version("h-then")] }, [{ competency_id: "c1", content_hash: "h-now" }]), "reviewer");
    expect(q?.items).toEqual([]);
  });
});
