/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";

// One person with two appointments: each governance row must name the position its appointment holds.
vi.mock("./clinical-review", async () => {
  const actual = await vi.importActual<any>("./clinical-review");
  return {
    ...actual,
    approverPositions: async () => ["clinical_content_reviewer", "scholar_clinical_lead"],
    carryingApproval: async () => [
      { id: "a1", person_id: "p1", person_name: "Dr A", role: "clinical_content_reviewer" },
      { id: "a2", person_id: "p1", person_name: "Dr A", role: "scholar_clinical_lead" },
    ],
  };
});
import { governanceView } from "./clinical-review-hq";

function fake() {
  const tables: Record<string, any[]> = {
    hq_position: [{ code: "clinical_content_reviewer", name: "Clinical Content Reviewer" }, { code: "scholar_clinical_lead", name: "Scholar Clinical Lead" }],
    profiles: [{ id: "p1", full_name: "Dr A" }],
  };
  const from = (t: string) => {
    const q: any = {};
    for (const op of ["select", "order", "limit", "in", "eq", "is"]) q[op] = () => q;
    q.then = (ok: any) => Promise.resolve({ data: tables[t] ?? [], error: null }).then(ok);
    return q;
  };
  return { from };
}

describe("governance rows name their position", () => {
  it("two appointments of one person show two different positions", async () => {
    const v = await governanceView(fake());
    expect(v!.reviewers.map(r => r.position)).toEqual(["Clinical Content Reviewer", "Scholar Clinical Lead"]);
  });
});
