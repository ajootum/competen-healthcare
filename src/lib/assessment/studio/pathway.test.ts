import { describe, expect, it } from "vitest";
import { approvalStatus, availabilities, CAP, type TransitionInput } from "./transitions";
import { blockersOf, NO_HOLDERS, pathwayOf, standingOf, stagesOf, summarize, type PathwayHolders, type PathwayInput } from "./pathway";
import { latestReturn } from "./pathway-data";
import type { ReviewDecisionRow } from "./types";

// ASMT-PATHWAY-01: every stage, every blocker, independence, who can act with and without appointees. The pathway only
// arranges what transitions.ts says, so each case builds a real TransitionInput and feeds its availabilities in.

const AUTHOR = "p-author", REVIEWER = "p-rev", REVIEWER2 = "p-rev2", PUBLISHER = "p-pub", VIEWER = "p-view";
const names: Record<string, string> = { [AUTHOR]: "Ada Author", [REVIEWER]: "Ria Reviewer", [REVIEWER2]: "Rob Reviewer", [PUBLISHER]: "Pat Publisher", [VIEWER]: "Vic Viewer" };
const holders: PathwayHolders = {
  author: [{ personId: AUTHOR, name: "Ada Author", position: "Checklist Studio Author" }],
  review: [{ personId: REVIEWER, name: "Ria Reviewer", position: "Checklist Studio Reviewer" }, { personId: REVIEWER2, name: "Rob Reviewer", position: "Checklist Studio Reviewer" }],
  domainReview: [{ personId: REVIEWER2, name: "Rob Reviewer", position: "Domain Reviewer" }],
  publish: [{ personId: PUBLISHER, name: "Pat Publisher", position: "Checklist Studio Publisher" }],
  positions: { author: ["assessment_studio_author"], review: ["assessment_studio_reviewer"], domainReview: ["domain_reviewer"], publish: ["assessment_studio_publisher"] },
  readable: true,
};
const decision = (reviewer: string, decision: ReviewDecisionRow["decision"], hash: string, kind: ReviewDecisionRow["review_kind"] = "governance", at = "2026-11-03T10:00:00Z", rationale: string | null = null): ReviewDecisionRow =>
  ({ id: `${reviewer}-${decision}-${hash}`, version_table: "asmt_instrument_version", version_id: "v1", review_kind: kind, reviewer_id: reviewer, decision, content_hash: hash, rationale, created_at: at });

function build(over: Partial<TransitionInput> & { actor?: string; validation?: PathwayInput["validation"]; returned?: PathwayInput["returned"]; holders?: PathwayHolders; supersededBy?: number | null; catalogueAvailability?: boolean | null; versionNo?: number | null }): PathwayInput {
  const actorId = over.actor ?? AUTHOR;
  const t: TransitionInput = {
    kind: "instrument", state: "draft", actorId, caps: [CAP.author], authoredBy: [AUTHOR], editedBy: [], involved: [AUTHOR], contentHash: "h1", risk: "standard",
    requiresDomainReview: false, deliveryModes: ["self_assessment"], decisions: [], need: { standard: 1, high: 2 }, validationErrors: over.validation?.length ?? 0, ...over,
  };
  return {
    kind: t.kind, versionNo: over.versionNo === undefined ? 1 : over.versionNo, state: t.state, actorId, caps: t.caps, availability: availabilities(t), approval: approvalStatus(t),
    authoredBy: t.authoredBy, editedBy: t.editedBy, submittedBy: t.state === "draft" ? null : AUTHOR, involved: t.involved, decisions: t.decisions, contentHash: t.contentHash,
    requiresDomainReview: t.requiresDomainReview, deliveryModes: t.deliveryModes, validation: over.validation ?? [], returned: over.returned ?? null, supersededBy: over.supersededBy ?? null,
    catalogueAvailability: over.catalogueAvailability ?? null, holders: over.holders ?? holders, names,
  };
}
const statusOf = (m: ReturnType<typeof pathwayOf>) => Object.fromEntries(m.stages.map((s) => [s.key, s.status]));

describe("pathway: the identity before its first version", () => {
  it("says create the first draft, names the authors, and offers the action only to an author", () => {
    const base = build({ state: "draft" });
    const m = pathwayOf({ ...base, state: null, versionNo: null, availability: null, approval: null, authoredBy: [], involved: [] });
    expect(m.current).toBe("registered");
    expect(m.next.headline).toMatch(/Create the first draft/);
    expect(m.next.action?.kind).toBe("first_version");
    expect(m.prompt.moment).toBe("registered");
    expect(m.prompt.text).toMatch(/registered\. Next: open it in Checklist Studio/);
    expect(m.prompt.text).toContain("Ada Author");
    expect(statusOf(m).draft).toBe("not_started");
    const viewer = pathwayOf({ ...base, state: null, versionNo: null, availability: null, approval: null, actorId: VIEWER, caps: [CAP.view] });
    expect(viewer.next.action).toBeNull();
    expect(viewer.next.viewer.canAct).toBe(false);
    expect(viewer.next.viewer.reason).toMatch(/author capability/);
  });
});

describe("pathway: draft", () => {
  it("a clean draft: next is Submit v1 for review, the author can act, reviewers are named", () => {
    const m = pathwayOf(build({}));
    expect(m.current).toBe("draft");
    expect(m.next.headline).toBe("Submit v1 for review.");
    expect(m.next.action).toEqual({ kind: "submit", label: "Submit v1 for review" });
    expect(m.next.viewer.canAct).toBe(true);
    expect(m.next.detail).toContain("Ria Reviewer, Rob Reviewer");
    expect(m.blockers).toEqual([]);
    expect(statusOf(m)).toEqual({ draft: "current", review: "not_started", approved: "not_started", published: "not_started", retired: "not_started" });
    expect(m.prompt.moment).toBe("draft");
    expect(m.prompt.text).toMatch(/complete its content, then Submit for review/);
  });
  it("blockers: validation errors, a missing scale, no delivery mode; the draft stage is blocked and the next action says complete first", () => {
    const m = pathwayOf(build({ deliveryModes: [], validation: [
      { code: "no_scale", path: "items[0].scale", message: "A rating item needs a published scale.", source: "content" },
      { code: "x", path: "scoring", message: "No outcomes defined.", source: "rules" },
      { code: "y", path: "layout", message: "No default layout.", source: "layout" },
    ] }));
    expect(m.blockers.map((b) => b.text)).toEqual([
      "No delivery mode chosen.",
      "A rating item needs a published scale.",
      "2 validation problems: No outcomes defined. No default layout.",
    ]);
    expect(m.blockers[1].fix).toMatch(/published response scale/);
    expect(statusOf(m).draft).toBe("blocked");
    expect(m.next.headline).toBe("Complete v1, then submit it for review.");
    expect(m.next.action).toEqual({ kind: "edit", label: "Open the content" });
    expect(m.next.viewer.canAct).toBe(false);
  });
  it("approval stale after a content change: earlier approvals on another hash are a blocker", () => {
    const m = pathwayOf(build({ contentHash: "h2", decisions: [decision(REVIEWER, "approved", "h1")] }));
    expect(m.blockers.map((b) => b.text)).toEqual(["1 earlier approval on earlier content no longer count."]);
    expect(m.blockers[0].fix).toMatch(/exact content/);
  });
  it("returned with notes: the prompt names who returned it and the note, and the blocker says address the notes", () => {
    const m = pathwayOf(build({ returned: { by: REVIEWER, note: "Item 3 needs a guidance line." } }));
    expect(m.prompt.moment).toBe("returned");
    expect(m.prompt.text).toBe('Returned with notes by Ria Reviewer: "Item 3 needs a guidance line.". Edit and resubmit.');
    expect(m.blockers.map((b) => b.fix)).toContain("Address the notes, then submit again.");
    expect(m.stages.find((s) => s.key === "draft")?.note).toMatch(/Returned to draft by Ria Reviewer/);
  });
  it("a viewer who did not author the draft cannot submit and is told why", () => {
    const m = pathwayOf(build({ actor: VIEWER, caps: [CAP.author] }));
    expect(m.next.viewer).toEqual({ canAct: false, reason: "Only an author or editor of this draft can put it forward." });
    expect(m.next.action).toBeNull();
  });
  it("other kinds: a response scale draft has the same pathway without the delivery-mode rule", () => {
    const m = pathwayOf(build({ kind: "scale", deliveryModes: [] }));
    expect(m.blockers).toEqual([]);
    expect(m.next.action?.kind).toBe("submit");
    expect(m.prompt.text).toMatch(/^Draft v1 is registered/);
    for (const kind of ["rule_template", "layout_template", "progression"] as const) {
      const k = pathwayOf(build({ kind, deliveryModes: [] }));
      expect(k.stages.map((s) => s.key)).toEqual(["draft", "review", "approved", "published", "retired"]);
      expect(k.next.action?.kind).toBe("submit");
    }
  });
});

describe("pathway: in review", () => {
  it("waiting for a reviewer: the author cannot approve (independence), the eligible reviewers are named", () => {
    const m = pathwayOf(build({ state: "in_review", caps: [CAP.author, CAP.review] }));
    expect(m.current).toBe("review");
    expect(m.next.headline).toBe("Approve or return v1.");
    expect(m.next.detail).toContain("Needs 1 independent governance approval; has 0.");
    expect(m.next.detail).toContain("Waiting for a reviewer: Ria Reviewer, Rob Reviewer can approve.");
    expect(m.next.viewer.canAct).toBe(false);
    expect(m.next.viewer.reason).toMatch(/You authored, edited or submitted this version/);
    expect(m.prompt.moment).toBe("submitted");
    expect(m.prompt.text).toContain("Submitted by Ada Author. Waiting for a reviewer: Ria Reviewer, Rob Reviewer can approve.");
    expect(m.prompt.text).toContain("You authored this, so another appointee must approve.");
    expect(statusOf(m)).toMatchObject({ draft: "done", review: "current" });
  });
  it("an independent reviewer is offered the decision", () => {
    const m = pathwayOf(build({ state: "in_review", actor: REVIEWER, caps: [CAP.review], involved: [AUTHOR] }));
    expect(m.next.action).toEqual({ kind: "review", label: "Record your decision" });
    expect(m.next.viewer.canAct).toBe(true);
    const who = m.who[0];
    expect(who.role).toBe("Independent reviewer");
    expect(who.actors.map((a) => [a.name, a.eligible])).toEqual([["Ria Reviewer", true], ["Rob Reviewer", true]]);
  });
  it("a reviewer who already decided on this exact content is no longer eligible; a reviewer who edited it is not independent", () => {
    const m = pathwayOf(build({ state: "in_review", actor: VIEWER, caps: [CAP.view], involved: [AUTHOR, REVIEWER2], decisions: [decision(REVIEWER, "approved", "h1")] }));
    const who = m.who[0];
    expect(who.actors.find((a) => a.personId === REVIEWER)?.conflict).toBe("Already decided on this exact content.");
    expect(who.actors.find((a) => a.personId === REVIEWER2)?.conflict).toMatch(/Not independent/);
    expect(who.eligible).toBe(0);
    expect(who.note).toMatch(/another appointee must act/);
    // one approval of one needed: ready to mark approved
    expect(m.next.headline).toBe("Mark v1 approved.");
  });
  it("approvals met: the review or publish holder may mark it approved", () => {
    const m = pathwayOf(build({ state: "in_review", actor: PUBLISHER, caps: [CAP.publish], involved: [AUTHOR], decisions: [decision(REVIEWER, "approved", "h1")] }));
    expect(m.next.action).toEqual({ kind: "approve", label: "Mark v1 approved" });
    expect(m.next.viewer.canAct).toBe(true);
  });
  it("required domain review missing is a blocker with the domain reviewers named; the domain group is listed", () => {
    const m = pathwayOf(build({ state: "in_review", actor: VIEWER, caps: [], requiresDomainReview: true, decisions: [decision(REVIEWER, "approved", "h1")] }));
    expect(m.blockers.map((b) => b.text)).toEqual(["Needs 1 independent domain approval, has 0."]);
    expect(m.blockers[0].fix).toBe("Rob Reviewer can give the domain review.");
    expect(m.who.map((w) => w.role)).toContain("Independent domain reviewer");
    expect(m.next.headline).toBe("Approve or return v1.");
  });
  it("high risk needs two approvals: one in, still waiting", () => {
    const m = pathwayOf(build({ state: "in_review", actor: VIEWER, caps: [], risk: "high", decisions: [decision(REVIEWER, "approved", "h1")] }));
    expect(m.blockers[0].text).toBe("Needs 2 independent governance approvals, has 1.");
    expect(m.blockers[0].fix).toBe("Rob Reviewer can approve.");
  });
  it("a reviewer asked for changes: the review stage is blocked and the next action is the author's return to draft", () => {
    const m = pathwayOf(build({ state: "in_review", decisions: [decision(REVIEWER, "changes_requested", "h1", "governance", "2026-11-03T10:00:00Z", "Tighten item 2.")] }));
    expect(statusOf(m).review).toBe("blocked");
    expect(m.next.headline).toBe("Return v1 to draft and address the notes.");
    expect(m.next.action).toEqual({ kind: "edit", label: "Return to draft" });
    expect(m.next.responsible).toBe("Author");
    expect(m.blockers[0].text).toMatch(/rejected it or asked for changes/);
  });
  it("without appointees: the review stage is blocked and the who-can-act note says nobody is appointed", () => {
    const none: PathwayHolders = { ...NO_HOLDERS, positions: { author: ["a"], review: ["r"], domainReview: [], publish: ["p"] } };
    const m = pathwayOf(build({ state: "in_review", actor: VIEWER, caps: [], holders: none }));
    expect(statusOf(m).review).toBe("blocked");
    expect(m.who[0].note).toBe("Nobody is appointed to these positions.");
    expect(m.blockers[0].fix).toBe("Nobody is appointed to these positions.");
    expect(m.next.detail).toContain("Nobody is appointed to these positions.");
    const noGrant = pathwayOf(build({ state: "in_review", actor: VIEWER, caps: [], holders: NO_HOLDERS }));
    expect(noGrant.who[0].note).toBe("No position grants this right yet.");
    const unreadable = pathwayOf(build({ state: "in_review", actor: VIEWER, caps: [], holders: { ...NO_HOLDERS, readable: false } }));
    expect(unreadable.who[0].note).toBe("The appointments could not be read just now.");
  });
});

describe("pathway: approved", () => {
  it("ready to publish: the publisher is named and offered the action; the author is refused on independence", () => {
    const pub = pathwayOf(build({ state: "approved", actor: PUBLISHER, caps: [CAP.publish], involved: [AUTHOR], decisions: [decision(REVIEWER, "approved", "h1")] }));
    expect(pub.next.headline).toBe("Publish v1.");
    expect(pub.next.action).toEqual({ kind: "publish", label: "Publish v1" });
    expect(pub.prompt).toEqual({ moment: "approved", text: "Ready to publish: Pat Publisher can publish." });
    expect(statusOf(pub)).toMatchObject({ draft: "done", review: "done", approved: "current" });
    const author = pathwayOf(build({ state: "approved", caps: [CAP.author, CAP.publish], decisions: [decision(REVIEWER, "approved", "h1")] }));
    expect(author.next.viewer.canAct).toBe(false);
    expect(author.next.viewer.reason).toMatch(/another appointee must publish it/);
  });
  it("no eligible publisher (the only publisher is involved): approved stage blocked, blocker says appoint another", () => {
    const m = pathwayOf(build({ state: "approved", actor: VIEWER, caps: [], involved: [AUTHOR, PUBLISHER], decisions: [decision(REVIEWER, "approved", "h1")] }));
    expect(statusOf(m).approved).toBe("blocked");
    expect(m.blockers[0].text).toBe("No eligible independent publisher.");
    expect(m.blockers[0].fix).toMatch(/another appointee must act/);
    expect(m.who[0].actors[0].conflict).toMatch(/Not independent/);
  });
  it("a checklist approved without a delivery mode cannot be published", () => {
    const m = pathwayOf(build({ state: "approved", actor: PUBLISHER, caps: [CAP.publish], involved: [AUTHOR], deliveryModes: [] }));
    expect(m.blockers[0].text).toMatch(/without a delivery mode/);
    expect(m.next.viewer.canAct).toBe(false);
  });
});

describe("pathway: published and retired", () => {
  it("a published checklist not yet available in a product points to the catalogue", () => {
    const m = pathwayOf(build({ state: "published", catalogueAvailability: false }));
    expect(m.next.headline).toBe("Set product availability in the catalogue.");
    expect(m.next.action?.kind).toBe("catalogue");
    expect(m.prompt.moment).toBe("published");
    expect(m.prompt.text).toMatch(/set its product availability in the catalogue/);
    expect(statusOf(m)).toMatchObject({ approved: "done", published: "current", retired: "not_started" });
  });
  it("a published checklist already available, or any other published kind, offers duplicate to an author", () => {
    const m = pathwayOf(build({ state: "published", catalogueAvailability: true }));
    expect(m.next.headline).toBe("v1 is published.");
    expect(m.next.action).toEqual({ kind: "duplicate", label: "Duplicate to a new draft" });
    const s = pathwayOf(build({ kind: "scale", state: "published", actor: VIEWER, caps: [] }));
    expect(s.prompt.text).toMatch(/duplicate to a new draft/);
    expect(s.next.action).toBeNull();
  });
  it("retired and superseded", () => {
    const m = pathwayOf(build({ state: "retired", supersededBy: 2 }));
    expect(m.current).toBe("retired");
    expect(m.stages.at(-1)).toMatchObject({ label: "Superseded", status: "current" });
    expect(m.prompt.text).toBe("Retired: v2 supersedes it.");
    const plain = pathwayOf(build({ state: "retired" }));
    expect(plain.stages.at(-1)?.label).toBe("Retired");
    expect(plain.prompt.text).toMatch(/kept for the record/);
  });
});

describe("pathway: pieces", () => {
  it("standingOf: authors have no independence rule; reviewers and publishers do", () => {
    const i = build({ involved: [AUTHOR, PUBLISHER] });
    expect(standingOf("author", i).actors[0].eligible).toBe(true);
    expect(standingOf("publish", i).actors[0]).toMatchObject({ eligible: false, conflict: expect.stringMatching(/Not independent/) });
    expect(standingOf("publish", i).capabilityLabel).toBe("the right to publish checklists");
  });
  it("stagesOf and blockersOf agree on a blocked draft", () => {
    const i = build({ deliveryModes: [] });
    const b = blockersOf(i, standingOf("review", i), standingOf("domainReview", i), standingOf("publish", i));
    expect(stagesOf(i, 2, 1, b)[0].status).toBe("blocked");
    expect(stagesOf(i, 2, 1, [])[0].status).toBe("current");
  });
  it("summarize carries stage, next, who and prompt for the catalogue", () => {
    const s = summarize(pathwayOf(build({ state: "in_review", actor: VIEWER, caps: [] })));
    expect(s.stageLabel).toBe("Submitted for review");
    expect(s.who).toEqual(["Ria Reviewer", "Rob Reviewer"]);
    expect(s.headline).toBe("Approve or return v1.");
    expect(s.viewerCanAct).toBe(false);
    const none = summarize(pathwayOf({ ...build({}), state: null, versionNo: null, availability: null, approval: null }));
    expect(none.stageLabel).toBe("Registered, no version yet");
  });
  it("latestReturn: only a return after the last submission counts, and the reviewer's note is picked up", () => {
    const ev = (event: string, at: string, reason: string | null = null) => ({ event, actor_id: REVIEWER, reason, created_at: at });
    expect(latestReturn([ev("created", "1"), ev("submitted", "2"), ev("returned", "3")], [decision(REVIEWER, "changes_requested", "h1", "governance", "2.5", "Tighten item 2.")])).toEqual({ by: REVIEWER, note: "Tighten item 2." });
    expect(latestReturn([ev("created", "1"), ev("submitted", "2"), ev("returned", "3", "Wrong purpose")], [])).toEqual({ by: REVIEWER, note: "Wrong purpose" });
    expect(latestReturn([ev("created", "1"), ev("submitted", "2"), ev("returned", "3"), ev("submitted", "4")], [])).toBeNull();
    expect(latestReturn([ev("created", "1")], [])).toBeNull();
  });
});
