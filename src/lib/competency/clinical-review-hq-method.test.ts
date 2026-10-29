/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";

// CFCA assessment operations (690): a method version in the clinical reviewer's queue. Independence covers every version
// of the same method, the version must still be the unchanged draft, and ONE appointment must cover every framework and
// competency the method names. The database decides every decision; this is the convenience list.

vi.mock("./clinical-review", () => ({
  reviewerAppointments: async () => [
    { id: "appt-fw", scopes: [{ id: "s1", appointmentId: "appt-fw", kind: "framework", ref: "f1" }] },
    { id: "appt-dom", scopes: [{ id: "s2", appointmentId: "appt-dom", kind: "domain", ref: "d1" }] },
  ],
  scopeCovers: (scopes: any[], c: any) => scopes.some(s => (s.kind === "framework" && s.ref === c.frameworkId) || (s.kind === "domain" && s.ref === c.domainId)),
  approverPositions: async () => [],
  carryingApproval: async () => [],
}));
import { reviewQueue } from "./clinical-review-hq";

function fake(tables: Record<string, any[]>, failTable?: string) {
  const from = (table: string) => {
    const q: any = {};
    for (const op of ["select", "order", "limit", "in", "eq", "is", "or"]) q[op] = () => q;
    q.then = (ok: any) => Promise.resolve(table === failTable ? { data: null, error: { message: "boom" } } : { data: tables[table] ?? [], error: null }).then(ok);
    return q;
  };
  return { from, rpc: async () => ({ data: [], error: null }) };
}
const content = (applicability: any) => ({
  summary: "Observe a respiratory assessment", applicability, outcomes: [{ code: "verified", class: "verified", label: "Verified" }],
  criteria: [{ id: "k1", text: "Auscultates both lungs", required: true, component: "clinical_skills", criterionId: "crit-1", sourceRef: "S!D4" }],
});
const mv = (id: string, applicability: any, extra: any = {}) => ({
  id, content_kind: "method", competency_id: null, case_version_id: null, method_version_id: `mv-${id}`, content_hash: "h", required_approvals: 1,
  submitted_by: "author", authored_by: ["author"], created_at: "2026-10-29T10:00:00Z",
  content_snapshot: { method: { code: "obs", name: "Respiratory observation", kind: "direct_observation" }, version_no: 2, content: content(applicability) }, ...extra,
});
const base = {
  framework_competencies: [{ id: "c1", name: "Respiratory Assessment", domain_id: "d1" }],
  framework_domains: [{ id: "d1", name: "Breathing", framework_id: "f1" }],
  frameworks: [{ id: "f1", name: "Nursing Framework", profession_term_id: "nursing", specialty_term_id: null }],
  clinical_review_decision: [],
  competency_verification_method_version: [{ id: "mv-a", method_id: "m1", state: "draft", updated_at: "2026-10-29T09:00:00Z", authored_by: "author", edited_by: [] }],
  competency_verification_method: [{ id: "m1", created_by: "author" }],
};

describe("the review queue lists assessment methods (690)", () => {
  it("a current, independent, in-scope method is listed with its content and what it applies to", async () => {
    const q = await reviewQueue(fake({ ...base, clinical_content_version: [mv("a", { frameworkIds: ["f1"], competencyIds: ["c1"] })] }), "reviewer");
    expect(q?.items).toHaveLength(1);
    const i = q!.items[0];
    expect(i.kind).toBe("method");
    expect(i.title).toBe("Respiratory observation v2");
    expect(i.home).toBe("Nursing Framework");
    expect(i.domain).toBe("Respiratory Assessment");
    expect(i.appointmentId).toBe("appt-fw");
    expect(i.methodContent.content.criteria[0].criterionId).toBe("crit-1");
    expect(i.methodContent.applies.competencies).toEqual([{ name: "Respiratory Assessment", framework: "Nursing Framework" }]);
  });
  it("a method that changed after it was put forward is stale and not offered", async () => {
    const q = await reviewQueue(fake({ ...base, competency_verification_method_version: [{ ...base.competency_verification_method_version[0], updated_at: "2026-10-29T11:00:00Z" }],
      clinical_content_version: [mv("a", { frameworkIds: ["f1"], competencyIds: [] })] }), "reviewer");
    expect(q?.items).toEqual([]);
  });
  it("a method no longer a draft is not offered", async () => {
    const q = await reviewQueue(fake({ ...base, competency_verification_method_version: [{ ...base.competency_verification_method_version[0], state: "published" }],
      clinical_content_version: [mv("a", { frameworkIds: ["f1"], competencyIds: [] })] }), "reviewer");
    expect(q?.items).toEqual([]);
  });
  it("a reviewer who edited ANY version of the same method is not offered it", async () => {
    const sib = [...base.competency_verification_method_version, { id: "mv-old", method_id: "m1", state: "published", updated_at: "2026-09-01T00:00:00Z", authored_by: "x", edited_by: ["reviewer"] }];
    const q = await reviewQueue(fake({ ...base, competency_verification_method_version: sib, clinical_content_version: [mv("a", { frameworkIds: ["f1"], competencyIds: [] })] }), "reviewer");
    expect(q?.items).toEqual([]);
  });
  it("no single appointment covering every framework and competency: not offered", async () => {
    // appt-fw covers framework f1 but the second framework f2 is covered by nobody.
    const q = await reviewQueue(fake({ ...base, frameworks: [...base.frameworks, { id: "f2", name: "Midwifery", profession_term_id: null, specialty_term_id: null }],
      clinical_content_version: [mv("a", { frameworkIds: ["f1", "f2"], competencyIds: [] })] }), "reviewer");
    expect(q?.items).toEqual([]);
  });
  it("the appointment with a framework scope is chosen, a domain-only one cannot cover a named framework", async () => {
    const q = await reviewQueue(fake({ ...base, clinical_content_version: [mv("a", { frameworkIds: ["f1"], competencyIds: [] })] }), "reviewer");
    expect(q!.items[0].appointmentId).toBe("appt-fw");
  });
  it("a method naming neither a framework nor a competency cannot be covered", async () => {
    const q = await reviewQueue(fake({ ...base, clinical_content_version: [mv("a", { frameworkIds: [], competencyIds: [] })] }), "reviewer");
    expect(q?.items).toEqual([]);
  });
  it("an unreadable method read costs only the method items, never the queue", async () => {
    const q = await reviewQueue(fake({ ...base, clinical_content_version: [mv("a", { frameworkIds: ["f1"], competencyIds: [] })] }, "competency_verification_method_version"), "reviewer");
    expect(q).not.toBeNull();
    expect(q!.items).toEqual([]);
  });
  it("a malformed snapshot is skipped without breaking the queue", async () => {
    const q = await reviewQueue(fake({ ...base, clinical_content_version: [mv("a", { frameworkIds: ["f1"], competencyIds: [] }, { content_snapshot: { content: { applicability: { frameworkIds: "x" } } } })] }), "reviewer");
    expect(q?.items).toEqual([]);
  });
  it("a method the reviewer put forward is not offered", async () => {
    const q = await reviewQueue(fake({ ...base, clinical_content_version: [mv("a", { frameworkIds: ["f1"], competencyIds: [] }, { submitted_by: "reviewer", authored_by: ["reviewer"] })] }), "reviewer");
    expect(q?.items).toEqual([]);
  });
});
