/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

// The C5 wiring (COMPETEN-PROFESSIONAL-COMPETENCY-01 C5, Studio #128): what Professional reads back and hands over.
// The Studio is mocked at its module boundary; the adapter's mapping is real.

const studio = vi.hoisted(() => ({
  listVerifications: vi.fn(), requestVerification: vi.fn(), verificationMethodsFor: vi.fn(), addRequestEvidence: vi.fn(), withdrawRequest: vi.fn(),
  verificationReady: vi.fn(async () => true),
}));
vi.mock("@/lib/competency/verification", () => ({ ...studio, NOT_PROVISIONED: { ok: false, status: 409, error: "not set up", code: "NOT_PROVISIONED" } }));

import { loadVerifications, requestVerification, verificationMethods, verifiedNow, withdrawVerification } from "./competency-verification";

const decision = (over: Record<string, unknown> = {}) => ({
  decisionId: "d1", outcomeCode: "verified_at_level", outcomeLabel: "Verified at the expected level", outcomeClass: "verified",
  level: { id: "l1", score: 3, label: "Proficient" }, assessorName: null, authority: "Competency Assessor, appointed by Competen Holdings", appointmentId: "a1",
  criteriaVersion: { versionId: "v", versionNo: 2, hash: "h" }, competencyHash: null, rationale: "r", decidedAt: "2026-10-20", validFrom: null, validUntil: null,
  standing: "current", revokedAt: null, revokedReason: null, supersededBy: null, ...over,
});
const item = (decisions: any[]) => ({
  requestId: "r1", status: "decided", competency: { frameworkCompetencyId: "c1", frameworkId: null, frameworkVersion: "1.2.0", code: null, title: "Airway", learningOutcomes: [], allLearningOutcomes: [] },
  method: { code: "obs", name: "Direct observation", kind: "direct_observation", versionNo: 2, criteriaHash: "h" }, context: "independent", requestedAt: "2026-10-19",
  evidence: [{ evidenceId: "e1", linkId: "k1", kind: "cpd", title: "Course", evidenceClass: "self_declared", issuer: null, occurredOn: null, learningOutcomes: [], sourcePresent: true, submittedAt: "2026-10-19" }],
  decisions, current: null,
});

beforeEach(() => vi.clearAllMocks());

describe("reading C5 back", () => {
  it("carries the class, the standing and the level label through, whatever the configured code", async () => {
    studio.listVerifications.mockResolvedValue({ provisioned: true, items: [item([decision()])] });
    const r = await loadVerifications({}, "u1", "c1");
    const d = r.provisioned && r.items ? r.items[0].decisions[0] : null;
    expect(d).toMatchObject({ outcomeCode: "verified_at_level", outcomeClass: "verified", standing: "current", level: "Proficient", assessorName: "An appointed assessor", criteriaVersion: "version 2" });
    expect(r.provisioned && r.items?.[0]).toMatchObject({ status: "decided", statusLabel: "Decided", method: "Direct observation" });
    expect(d && verifiedNow(d, "2026-10-26")).toBe(true);
  });
  it("an unknown class is no class, so it never stands", async () => {
    studio.listVerifications.mockResolvedValue({ provisioned: true, items: [item([decision({ outcomeClass: "made_up" })])] });
    const r = await loadVerifications({}, "u1");
    expect(r.provisioned && r.items?.[0].decisions[0].outcomeClass).toBeNull();
  });
  it("not provisioned and unreadable stay distinct", async () => {
    studio.listVerifications.mockResolvedValue({ provisioned: false });
    expect(await loadVerifications({}, "u1")).toEqual({ provisioned: false });
    studio.listVerifications.mockResolvedValue(null);
    expect(await loadVerifications({}, "u1")).toEqual({ provisioned: true, items: null });
  });
});

describe("handing C5 a request", () => {
  it("passes the chosen method and each record by its source and link, never more", async () => {
    studio.requestVerification.mockResolvedValue({ ok: true, requestId: "r9" });
    const competency = { frameworkId: "f", frameworkCompetencyId: "c1", frameworkVersion: "v1.2.0", title: "Airway", learningOutcomes: [] };
    const evidence = [{ linkId: "k1", kind: "cpd" as const, sourceId: "s1", title: "Course", evidenceClass: "self_declared", issuer: null, occurredOn: null, learningOutcome: null, relation: "Supports", frameworkVersion: null }];
    await requestVerification({}, "u1", { competency, evidence, methodCode: "obs" });
    expect(studio.requestVerification).toHaveBeenCalledWith({}, "u1", { competency, methodCode: "obs", note: undefined, evidence: [{ kind: "cpd", sourceId: "s1", linkId: "k1", learningOutcome: null }] });
  });
  it("offers methods by name only, and withdrawal waits for C5 to be set up", async () => {
    studio.verificationMethodsFor.mockResolvedValue({ provisioned: true, methods: [{ versionId: "v", methodId: "m", code: "obs", name: "Direct observation", kind: "direct_observation", versionNo: 2, content: {} }] });
    expect(await verificationMethods({}, "c1")).toEqual({ provisioned: true, methods: [{ code: "obs", name: "Direct observation" }] });
    studio.verificationReady.mockResolvedValueOnce(false);
    expect((await withdrawVerification({}, "u1", "r1")).ok).toBe(false);
    expect(studio.withdrawRequest).not.toHaveBeenCalled();
  });
});
