/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EMPTY_CONTENT, checkMethodContent, cleanDraft, deriveState, developmentNeedsOf, isPinned, methodDraftFromCompetency, standingOf, STATE_LABEL, STANDING_LABEL,
} from "./verification-config";
import { methodReviewOf, renewalsDue, type VerificationItem } from "./verification";

// CCHU Competency Assessment Implementation (owner GO 29 Oct 2026), migration 690: method drafts from a competency's
// approved criteria, method versions on the one clinical-approval process, programme-lead requests, server drafts,
// stage at decision, second-assessor confirmation, development needs and renewal.
const SQL461 = readFileSync("supabase/migrations/461-learning-on-clinical-approval.sql", "utf8").replace(/\r\n/g, "\n");
const SQL510 = readFileSync("supabase/migrations/510-competency-verification-studio.sql", "utf8").replace(/\r\n/g, "\n");
const SQL690 = readFileSync("supabase/migrations/690-cfca-assessment-operations.sql", "utf8").replace(/\r\n/g, "\n");
const ROLLBACK = readFileSync("docs/evidence/CFCA-ASSESS-OPS/ROLLBACK-690.sql", "utf8").replace(/\r\n/g, "\n");
const body = (sql: string, fn: string) => { const at = sql.indexOf(`create or replace function public.${fn}(`); return at < 0 ? "" : sql.slice(at, sql.indexOf("\n$$;", at) + 4); };

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SKILLS = [
  { id: U(1), name: " Uses correct techniques to assess the respiratory system ", componentCode: "clinical_skills", sourceRef: "NUR!D7" },
  { id: U(2), name: "Demonstrates knowledge of the normal respiratory cycle", componentCode: "knowledge", sourceRef: "NUR!D11" },
];

describe("a method draft made from a competency's criteria", () => {
  it("keeps every criterion's id, words, component and source reference, so the database can hold the method to them", () => {
    const r = methodDraftFromCompetency({ id: U(9), name: "Respiratory Assessment" }, SKILLS, [{ code: "clinical_skills", passLevelId: U(50), mandatory: true, safetyCritical: true, weight: 2 }], U(60));
    if (!r.ok) throw new Error(r.error);
    expect(r.content.criteria).toEqual([
      { id: U(1), criterionId: U(1), text: "Uses correct techniques to assess the respiratory system", required: true, component: "clinical_skills", sourceRef: "NUR!D7" },
      { id: U(2), criterionId: U(2), text: "Demonstrates knowledge of the normal respiratory cycle", required: true, component: "knowledge", sourceRef: "NUR!D11" },
    ]);
    expect(r.content.applicability.competencyIds).toEqual([U(9)]);
    expect(r.content.components.map(k => [k.code, k.passLevelId, k.safetyCritical])).toEqual([["clinical_skills", U(50), true], ["knowledge", null, false]]);
    // A safety-critical component turns on the second assessor by default. The author may change it before review.
    expect(r.content.workflow.secondAssessor).toBe(true);
    expect(r.problems.some(p => /knowledge component/.test(p))).toBe(true);
    expect(r.content.criteria.every(isPinned)).toBe(true);
  });
  it("refuses what it cannot hold word for word, and a competency with no criteria", () => {
    expect(methodDraftFromCompetency({ id: U(9), name: "X" }, [], [], null)).toMatchObject({ ok: false });
    expect(methodDraftFromCompetency({ id: U(9), name: "X" }, [{ ...SKILLS[0], name: "a".repeat(501) }], [], null)).toMatchObject({ ok: false });
  });
  it("round-trips the pin through the editor's normaliser, and the second-assessor setting", () => {
    const c = checkMethodContent({ ...EMPTY_CONTENT, criteria: [{ id: "c1", text: "Words", required: true, criterionId: U(1).toUpperCase(), sourceRef: "S!A1" }], workflow: { secondAssessor: true } });
    if (!c.ok) throw new Error(c.error);
    expect(c.content.criteria[0]).toMatchObject({ criterionId: U(1), sourceRef: "S!A1" });
    expect(c.content.workflow.secondAssessor).toBe(true);
    expect(checkMethodContent({ ...EMPTY_CONTENT, criteria: [{ id: "c1", text: "Words", criterionId: "not-a-uuid" }] }).ok && (checkMethodContent({ ...EMPTY_CONTENT, criteria: [{ id: "c1", text: "Words", criterionId: "x" }] }) as any).content.criteria[0].criterionId).toBeFalsy();
  });
});

describe("second-assessor confirmation, as 690's state and standing", () => {
  const dec = { id: "d1", outcome_class: "verified", created_at: "2026-10-29T10:00:00Z", valid_until: null, confirmation_required: true };
  const assigned = [{ event: "assigned", created_at: "2026-10-29T09:00:00Z" }];
  it("a decision needing confirmation leaves the request awaiting it, and does not stand", () => {
    expect(deriveState(assigned, [dec], [])).toBe("awaiting_confirmation");
    expect(standingOf(dec, new Set(), [], "2026-10-30")).toBe("awaiting_confirmation");
    expect(STATE_LABEL.awaiting_confirmation).toMatch(/second assessor/);
  });
  it("confirmed: decided and current", () => {
    const c = [{ decision_id: "d1", result: "confirmed" as const }];
    expect(deriveState(assigned, [dec], [], c)).toBe("decided");
    expect(standingOf(dec, new Set(), [], "2026-10-30", "confirmed")).toBe("current");
  });
  it("not confirmed: the decision is set aside and the request is with its assessor again", () => {
    const c = [{ decision_id: "d1", result: "not_confirmed" as const }];
    expect(deriveState(assigned, [dec], [], c)).toBe("assigned");
    expect(standingOf(dec, new Set(), [], "2026-10-30", "not_confirmed")).toBe("not_confirmed");
    expect(STANDING_LABEL.not_confirmed).toMatch(/Not confirmed/);
  });
  it("a decision needing no confirmation is unchanged from 510", () => {
    expect(deriveState(assigned, [{ ...dec, confirmation_required: false }], [])).toBe("decided");
    expect(standingOf({ ...dec, confirmation_required: false }, new Set(), [], "2026-10-30")).toBe("current");
  });
});

describe("the clinical review state of a method version", () => {
  const rec = { id: "r1", content_hash: "h1", required_approvals: 1, created_at: "2026-10-29T10:00:00Z" };
  it("reads not submitted, in review, approved and changes requested", () => {
    const v = { state: "draft", content_hash: null, updated_at: "2026-10-29T09:00:00Z" };
    expect(methodReviewOf(v, [], []).state).toBe("not_submitted");
    expect(methodReviewOf(v, [rec], []).state).toBe("in_review");
    expect(methodReviewOf(v, [rec], [{ version_id: "r1", decision: "approved", comment: null }]).state).toBe("approved");
    expect(methodReviewOf(v, [rec], [{ version_id: "r1", decision: "rejected", comment: "Add the escalation criterion" }])).toMatchObject({ state: "changes_requested", comment: "Add the escalation criterion" });
  });
  it("a draft edited after it was put forward no longer carries that review", () => {
    expect(methodReviewOf({ state: "draft", content_hash: null, updated_at: "2026-10-29T11:00:00Z" }, [rec], [{ version_id: "r1", decision: "approved", comment: null }]).state).toBe("changed_since");
    expect(methodReviewOf({ state: "published", content_hash: "h1", updated_at: "2026-10-30T00:00:00Z" }, [rec], [{ version_id: "r1", decision: "approved", comment: null }]).state).toBe("approved");
  });
});

describe("what an outcome leaves to develop, and renewal", () => {
  const d = (o: any) => ({ decisionId: "d1", outcomeClass: "not_demonstrated", outcomeLabel: "Not demonstrated in this assessment", decidedAt: "2026-10-29T10:00:00Z",
    components: { results: [], outcome: { failedMandatory: ["clinical_skills"], missingMandatory: ["knowledge"] } }, ...o });
  it("offers a need for an outcome that did not verify, naming the components", () => {
    const n = developmentNeedsOf({ competencyId: "c", title: "Respiratory Assessment", decisions: [d({})] }, c => (c === "clinical_skills" ? "Clinical Skills" : "Knowledge"));
    expect(n).toMatchObject({ reason: "Not demonstrated in this assessment", detail: ["Clinical Skills: below the level required", "Knowledge: not yet assessed"] });
    expect(developmentNeedsOf({ competencyId: "c", title: "R", decisions: [d({ outcomeClass: "verified" })] })).toBeNull();
  });
  it("lists a verification ending within the window, or ended, and never one renewed since", () => {
    const item = (validUntil: string, standing: string, requestedAt = "2026-01-01"): VerificationItem => ({
      requestId: "r", status: "decided", competency: { frameworkCompetencyId: "c", frameworkId: null, frameworkVersion: null, code: null, title: "R", learningOutcomes: [], allLearningOutcomes: [] },
      method: { code: null, name: null, kind: null, versionNo: null, criteriaHash: null }, context: "independent", requestedAt, evidence: [], requestedByOther: false, developmentNeed: null,
      decisions: [{ decisionId: "d1", outcomeClass: "verified", standing, validUntil } as any], current: standing === "current" ? ({ decisionId: "d1", outcomeClass: "verified", standing, validUntil } as any) : null,
    });
    expect(renewalsDue([item("2026-12-01", "current")], "2026-10-29").map(x => x.daysLeft)).toEqual([33]);
    expect(renewalsDue([item("2027-12-01", "current")], "2026-10-29")).toEqual([]);
    expect(renewalsDue([item("2026-09-01", "expired")], "2026-10-29").map(x => x.daysLeft)).toEqual([-58]);
    expect(renewalsDue([item("2026-12-01", "current")], "2026-10-29", 90, new Set(["d1"]))).toEqual([]);
  });
  it("keeps a draft to known keys and bounded sizes", () => {
    const x = cleanDraft({ outcomeCode: "verified", rationale: "r".repeat(5000), criteria: [{ id: "c1", result: "met", evil: "x" }], evidenceReviewed: ["no", U(4)], extra: 1 });
    expect(x.rationale?.length).toBe(4000);
    expect(x.criteria).toEqual([{ id: "c1", result: "met" }]);
    expect(x.evidenceReviewed).toEqual([U(4)]);
    expect((x as any).extra).toBeUndefined();
  });
});

describe("migration 690, as written", () => {
  it("keeps every 461 branch of the two review guards byte for byte, and adds a method branch", () => {
    for (const fn of ["clinical_content_version_guard", "clinical_review_decision_guard"]) {
      const mine = body(SQL690, fn), theirs = body(SQL461, fn);
      for (const kind of ["learning", "resource", "case"]) {
        const at = theirs.indexOf(`content_kind = '${kind}' then`);
        const branch = theirs.slice(at, theirs.indexOf("\n  end if;", at) > 0 ? at + 400 : at + 400);
        expect(mine).toContain(branch);
      }
      expect(mine).toContain("content_kind = 'method'");
    }
  });
  it("publication and every verification need clinical approval of the exact content, with no switch", () => {
    expect(body(SQL690, "competency_verification_method_version_review_690")).toMatch(/competency_method_clinically_approved\(new\.id, md5\(new\.content::text\)\)/);
    expect(body(SQL690, "competency_verification_decision_guard_690")).toMatch(/outcome_class in \('verified', 'partial'\) and not public\.competency_method_clinically_approved/);
    expect(SQL690).not.toMatch(/hq_config|set_config\('competen\.method/);
  });
  it("never edits a 510 or 680 guard: 690 adds triggers beside them, and replaces only 510's state derivation", () => {
    for (const fn of ["competency_verification_decision_guard", "competency_verification_method_version_guard", "competency_verification_request_guard", "competency_verification_event_guard", "competency_verification_evidence_guard"])
      expect(body(SQL690, fn)).toBe("");
    expect(body(SQL690, "competency_verification_state")).toContain("awaiting_confirmation");
  });
  it("a second assessor is neither the person nor the first assessor, and holds assess in scope", () => {
    const g = body(SQL690, "competency_verification_confirmation_guard");
    expect(g).toMatch(/new\.assessor_id = v_req\.user_id or new\.assessor_id = v_dec\.assessor_id/);
    expect(g).toMatch(/competency_appointment_holds\(new\.appointment_id, new\.assessor_id, 'hq\.competency\.verification\.assess'\)/);
    expect(g).toMatch(/competency_assessor_covers/);
  });
  it("the requester column has no foreign key, so 510's refusal of request updates never blocks erasing a profile", () => {
    expect(SQL690).toMatch(/add column if not exists requested_by uuid;/);
  });
  it("the rollback restores 461's guards and 510's state derivation exactly", () => {
    expect(body(ROLLBACK, "clinical_content_version_guard")).toBe(body(SQL461, "clinical_content_version_guard"));
    expect(body(ROLLBACK, "clinical_review_decision_guard")).toBe(body(SQL461, "clinical_review_decision_guard"));
    expect(body(ROLLBACK, "competency_verification_state")).toBe(body(SQL510, "competency_verification_state"));
  });
});
