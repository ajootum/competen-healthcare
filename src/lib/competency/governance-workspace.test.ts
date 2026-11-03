import { describe, expect, it } from "vitest";
import { inQueue, nextActionOf, pathwayOf, queueCounts, reviewOrder, type GovCompetency, type GovDomain, type GovFramework, type Me } from "./governance-rules";

// FRAMEWORK-GOVERNANCE-WORKSPACE-01: the pure rules the page draws from. The acceptance case is NUR-CCF on 3 Nov 2026:
// version 1.0.0, 42 competencies, 0 approved, a publication request already submitted.

const fw = (over: Partial<GovFramework> = {}): GovFramework => ({
  id: "fw", code: "NUR-CCF", name: "Competen Nursing Competency Framework", pubStatus: "in_review", layer: "profession", editable: false, version: "1.0.0",
  approved: 0, total: 42, publication: null, pending: { id: "p", submittedBy: "elisha", submittedByName: "Elisha", submittedAt: "2026-11-03T06:28:00Z", note: null },
  professionTermId: "prof", specialtyTermId: null, ...over,
});
const comp = (id: string, state: GovCompetency["state"], mine = false): GovCompetency => ({
  id, code: id.toUpperCase(), name: `Competency ${id}`, domainId: "d", domain: "Airway", description: null, outcomes: [], riskCategory: "standard", criteria: [],
  clinical: null, state, stateLabel: "", stateNote: "", version: null,
  mine: mine ? { versionId: `v-${id}`, appointmentId: "a", approvals: 0, required: 1, checks: [], submittedAt: "2026-11-03T00:00:00Z" } : null,
});
const counts = { total: 42, ready: 0, inReview: 42, changes: 0, approved: 0, unreadable: 0 };
const reviewer: Me = { canAuthor: false, canReview: true, canPublish: false };
const author: Me = { canAuthor: true, canReview: false, canPublish: false };
const publisher: Me = { canAuthor: false, canReview: false, canPublish: true };

describe("pathway", () => {
  it("NUR-CCF: review current, decision submitted early, nothing published", () => {
    const s = pathwayOf(fw(), counts, 0, 1);
    expect(s.map(x => x.status)).toEqual(["done", "current", "not_started", "waiting", "not_started"]);
    expect(s[3].outstanding.join(" ")).toMatch(/blocked until every competency is clinically approved/);
    expect(s[3].done[0]).toMatch(/submitted by Elisha/);
  });
  it("all approved with a pending request and no eligible publisher is BLOCKED, not current", () => {
    const s = pathwayOf(fw({ approved: 42 }), { ...counts, inReview: 0, approved: 42 }, 0, 1);
    expect(s[1].status).toBe("done"); expect(s[2].status).toBe("done"); expect(s[3].status).toBe("blocked");
    expect(s[3].next).toMatch(/Appoint an independent publisher/);
  });
  it("in review with no eligible reviewer marks review blocked", () => {
    expect(pathwayOf(fw(), counts, 1, 0)[1].status).toBe("blocked");
  });
  it("published is done at every stage", () => {
    expect(pathwayOf(fw({ pubStatus: "published", pending: null, approved: 42 }), { ...counts, inReview: 0, approved: 42 }, 1, 1).map(x => x.status)).toEqual(["done", "done", "done", "done", "done"]);
  });
});

describe("next action", () => {
  it("reviewer with a queue is offered focused review, in words that count the competencies", () => {
    const n = nextActionOf(fw(), counts, reviewer, 42, 0, null, 1);
    expect(n.headline).toBe("42 competencies require independent clinical review.");
    expect(n.action?.kind).toBe("review_mode");
  });
  it("author sees who is responsible and gets no review button", () => {
    const n = nextActionOf(fw(), counts, author, 0, 0, null, 1);
    expect(n.action).toBeNull(); expect(n.responsible).toBe("Clinical Content Reviewer");
  });
  it("no eligible reviewer says so and points at assignment", () => {
    expect(nextActionOf(fw(), counts, author, 0, 0, null, 0).action?.kind).toBe("assign_reviewer");
  });
  it("ready to publish but the viewer is the submitter: no publish action, the conflict is the detail", () => {
    const n = nextActionOf(fw({ approved: 42 }), { ...counts, inReview: 0, approved: 42 }, publisher, 0, 1, "You put this framework forward, so a different publisher must decide it.", 1);
    expect(n.action).toBeNull(); expect(n.detail).toMatch(/different publisher/);
  });
  it("ready to publish and eligible: decide publication", () => {
    expect(nextActionOf(fw({ approved: 42 }), { ...counts, inReview: 0, approved: 42 }, publisher, 0, 1, null, 1).action?.kind).toBe("publish");
  });
  it("ready to publish and nobody eligible: assignment, not publish", () => {
    expect(nextActionOf(fw({ approved: 42 }), { ...counts, inReview: 0, approved: 42 }, publisher, 0, 0, null, 1).action?.kind).toBe("assign_reviewer");
  });
  it("not yet put forward: the author is offered put forward", () => {
    expect(nextActionOf(fw({ pubStatus: "draft", editable: true, pending: null }), { ...counts, inReview: 0, ready: 42 }, author, 0, 0, null, 1).action?.kind).toBe("put_forward");
  });
});

describe("queues", () => {
  const domains: GovDomain[] = [{ id: "d", name: "Airway", competencies: [comp("a", "in_review", true), comp("b", "in_review"), comp("c", "eligible"), comp("e", "approved"), comp("f", "changes_requested")] }];
  it("needs my action: reviewer = own queue, author = ready or returned", () => {
    expect(queueCounts(domains, reviewer, fw()).mine).toBe(1);
    expect(queueCounts(domains, author, fw({ editable: true })).mine).toBe(2);
    expect(queueCounts(domains, author, fw({ editable: false })).mine).toBe(0);
  });
  it("other queues by state, publication by the request", () => {
    const q = queueCounts(domains, reviewer, fw());
    expect([q.ready, q.in_review, q.changes, q.approved, q.all]).toEqual([1, 2, 1, 1, 5]);
    expect(q.publication).toBe(5);
    expect(queueCounts(domains, reviewer, fw({ pending: null })).publication).toBe(0);
    expect(inQueue(domains[0].competencies[1], "mine", reviewer, fw())).toBe(false);
  });
  it("focused review order is the framework order of waiting items", () => {
    expect(reviewOrder(domains).map(c => c.id)).toEqual(["a"]);
  });
});
