// FRAMEWORK-GOVERNANCE-WORKSPACE-01 -- the PURE half: the shapes the workspace draws and the rules that sort them into
// queues, the pathway and the next action. No import of a server module (the client component imports this file), no
// read, no decision: the services decide, the database guards, this only arranges.
import type { ClinicalReview } from "./clinical-review";
import type { Eligibility } from "./review-batch";
import type { PublicationRow } from "./framework-publication";

export type Me = { canAuthor: boolean; canReview: boolean; canPublish: boolean };
export const AUTHOR_CAP = "hq.quality.competency.author", REVIEW_CAP = "hq.quality.clinical.approve", PUBLISH_CAP = "hq.quality.competency.publish";

export type GovCompetency = {
  id: string; code: string | null; name: string; domainId: string; domain: string;
  description: string | null; outcomes: string[]; riskCategory: string;
  criteria: { component: string | null; text: string; sourceRef: string | null }[];
  clinical: ClinicalReview | null;
  state: Eligibility;
  stateLabel: string;
  stateNote: string;
  /** The current content version in review or approved: who may NOT review it (authors, editors, the submitter). */
  version: { id: string; authoredBy: string[]; submittedBy: string | null } | null;
  /** Set when THIS person may decide it now (their own queue): the exact version and the appointment to decide under. */
  mine: { versionId: string; appointmentId: string; approvals: number; required: number; checks: string[]; submittedAt: string } | null;
};
export type GovDomain = { id: string; name: string; competencies: GovCompetency[] };
export type GovFramework = {
  id: string; code: string | null; name: string; pubStatus: string; layer: string | null; editable: boolean; version: string;
  approved: number; total: number;
  publication: PublicationRow | null;
  /** The open publication request, if any: who put it forward and when. */
  pending: { id: string; submittedBy: string | null; submittedByName: string | null; submittedAt: string | null; note: string | null } | null;
  professionTermId: string | null; specialtyTermId: string | null;
};
export type Counts = { total: number; ready: number; inReview: number; changes: number; approved: number; unreadable: number };

export type StageKey = "preparation" | "review" | "readiness" | "decision" | "published";
export type StageStatus = "done" | "current" | "waiting" | "blocked" | "not_started";
export type Stage = { key: StageKey; label: string; status: StageStatus; role: string; done: string[]; outstanding: string[]; next: string | null };

export type NextAction = {
  headline: string; detail: string;
  /** What the page offers the CURRENT person, by their capability. null = nothing for them, the responsible role is named instead. */
  action: { kind: "put_forward" | "review_mode" | "open_queue" | "edit" | "submit_publication" | "publish" | "assign_reviewer" | "none"; label: string } | null;
  responsible: string;
};

export type Actor = {
  personId: string; name: string; position: string;
  /** Scope of a reviewer appointment covers this framework (profession, specialty, framework or one of its domains). */
  inScope: boolean | null;
  /** Why this person may not act on the SELECTED content, or null when eligible. */
  conflict: string | null;
};
export type ActorGroup = { capability: string; role: string; positions: string[]; actors: Actor[]; eligible: number; note: string | null };

export type HistoryEvent = { at: string; kind: string; who: string | null; text: string };

export type GovModel = {
  framework: GovFramework; domains: GovDomain[]; counts: Counts; components: Record<string, string>; me: Me;
  stages: Stage[]; next: NextAction;
  actors: { reviewers: ActorGroup; publishers: ActorGroup; authors: ActorGroup };
  history: HistoryEvent[];
  /** The reviewer holds the right but no appointment or no scope: said on screen, never silently empty. */
  reviewerNote: string | null;
  clinicalReadable: boolean;
  /** Which signed-in person this model was built for: the eligibility of the viewer is read off the actor groups by this id. */
  viewerId: string;
};

export const EDITABLE = new Set(["draft", "published"]);

// ── queues ───────────────────────────────────────────────────────────────────────────────────────────

export type QueueFilter = "all" | "mine" | "ready" | "in_review" | "changes" | "approved" | "publication";
export const QUEUE_FILTERS: { key: QueueFilter; label: string }[] = [
  { key: "mine", label: "Needs my action" }, { key: "ready", label: "Ready for review" }, { key: "in_review", label: "In review" },
  { key: "changes", label: "Needs changes" }, { key: "approved", label: "Approved" }, { key: "publication", label: "Awaiting publication" }, { key: "all", label: "All" },
];

/** Pure: does a competency belong in a queue, for this person. "Needs my action" is by capability and state, never by guess. */
export function inQueue(c: GovCompetency, filter: QueueFilter, me: Me, fw: GovFramework): boolean {
  switch (filter) {
    case "all": return true;
    case "ready": return c.state === "eligible";
    case "in_review": return c.state === "in_review";
    case "changes": return c.state === "changes_requested" || c.state === "unreadable";
    case "approved": return c.state === "approved";
    case "publication": return !!fw.pending;
    case "mine":
      return (me.canReview && !!c.mine)
        || (me.canAuthor && fw.editable && (c.state === "eligible" || c.state === "changes_requested"));
  }
}

export function queueCounts(domains: readonly GovDomain[], me: Me, fw: GovFramework): Record<QueueFilter, number> {
  const all = domains.flatMap(d => d.competencies);
  const out = {} as Record<QueueFilter, number>;
  for (const f of QUEUE_FILTERS) out[f.key] = f.key === "publication" ? (fw.pending ? all.length : 0) : all.filter(c => inQueue(c, f.key, me, fw)).length;
  return out;
}

/** Pure: the reviewer's ordered queue for focused review (framework order, waiting items only). */
export function reviewOrder(domains: readonly GovDomain[]): GovCompetency[] {
  return domains.flatMap(d => d.competencies).filter(c => !!c.mine);
}

export function countsOf(domains: readonly GovDomain[]): Counts {
  const all = domains.flatMap(d => d.competencies);
  const n = (s: Eligibility) => all.filter(c => c.state === s).length;
  return { total: all.length, ready: n("eligible"), inReview: n("in_review"), changes: n("changes_requested"), approved: n("approved"), unreadable: n("unreadable") };
}

// ── the pathway and the next action ─────────────────────────────────────────────────────────────────

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/**
 * Pure: the five stages with their status. A submitted publication request is NOT readiness: the decision stage says
 * "submitted early" while clinical review is incomplete, and the publish action is offered only once every competency
 * is approved at its current content (466) and an eligible independent publisher exists.
 */
export function pathwayOf(fw: GovFramework, c: Counts, publishersEligible: number, reviewersEligible: number | null): Stage[] {
  const published = fw.pubStatus === "published";
  const allApproved = c.total > 0 && c.approved === c.total;
  const forwarded = c.total > 0 && c.ready === 0 && c.unreadable === 0;
  const prep: Stage = {
    key: "preparation", label: "Framework preparation", role: "Competency Author",
    status: published || forwarded ? "done" : "current",
    done: [c.total ? `${plural(c.total, "competency", "competencies")} authored` : "", forwarded ? "Every competency put forward for clinical review" : ""].filter(Boolean),
    outstanding: [c.total === 0 ? "No competency yet" : "", c.ready ? `${plural(c.ready, "competency", "competencies")} not yet put forward` : "", c.unreadable ? `${c.unreadable} with an unreadable clinical state` : ""].filter(Boolean),
    next: c.ready ? "Put the remaining competencies forward for clinical review" : null,
  };
  const review: Stage = {
    key: "review", label: "Clinical review", role: "Clinical Content Reviewer",
    status: allApproved ? "done" : c.inReview || c.changes ? (reviewersEligible === 0 ? "blocked" : "current") : forwarded ? "current" : "not_started",
    done: [c.approved ? `${c.approved} of ${c.total} clinically approved at current content` : ""].filter(Boolean),
    outstanding: [c.inReview ? `${plural(c.inReview, "competency", "competencies")} awaiting independent review` : "", c.changes ? `${c.changes} returned with change requests` : ""].filter(Boolean),
    next: c.inReview ? (reviewersEligible === 0 ? "Assign an independent reviewer whose scope covers this framework" : "Review each waiting competency at its exact version") : c.changes ? "Author revises and puts the returned competencies forward again" : null,
  };
  const readiness: Stage = {
    key: "readiness", label: "Readiness", role: "Competency Author",
    status: published ? "done" : allApproved ? (fw.pending ? "done" : "current") : "not_started",
    done: allApproved ? ["All competencies clinically approved"] : [],
    outstanding: allApproved ? (fw.pending ? [] : ["Not yet put forward for publication"]) : [`${c.total - c.approved} of ${c.total} still need clinical approval`],
    next: allApproved && !fw.pending ? "Put the framework forward for publication" : null,
  };
  const decision: Stage = {
    key: "decision", label: "Publication decision", role: "Quality Council Member (independent publisher)",
    status: published ? "done" : fw.pending ? (allApproved ? (publishersEligible === 0 ? "blocked" : "current") : "waiting") : "not_started",
    done: fw.pending ? [`Publication request submitted${fw.pending.submittedByName ? ` by ${fw.pending.submittedByName}` : ""}`] : [],
    outstanding: fw.pending
      ? [!allApproved ? "Publication blocked until every competency is clinically approved" : "", publishersEligible === 0 ? "No eligible independent publisher: submitter and contributors may not decide" : ""].filter(Boolean)
      : ["No publication request yet"],
    next: fw.pending && allApproved ? (publishersEligible === 0 ? "Appoint an independent publisher (Quality Council Member) who did not contribute or submit" : "Publish, or return to the author with a note") : null,
  };
  const pub: Stage = { key: "published", label: "Published", role: "", status: published ? "done" : "not_started", done: published ? [`Version ${fw.version} in use`] : [], outstanding: [], next: null };
  return [prep, review, readiness, decision, pub];
}

/** Pure: the single most important thing to do now, and what THIS person can do about it. */
export function nextActionOf(fw: GovFramework, c: Counts, me: Me, mineCount: number, publishersEligible: number, viewerPublisherConflict: string | null, reviewersEligible: number | null): NextAction {
  const allApproved = c.total > 0 && c.approved === c.total;
  if (fw.pubStatus === "published" && !fw.pending) return { headline: "Published.", detail: `Version ${fw.version} is in use. Changes open a revision draft in Competency Authoring.`, action: null, responsible: "" };
  if (c.total === 0) return { headline: "No competencies yet.", detail: "Author the framework's competencies before anything can be reviewed.", action: me.canAuthor ? { kind: "edit", label: "Open Competency Authoring" } : null, responsible: "Competency Author" };
  if (c.inReview > 0) {
    const head = `${plural(c.inReview, "competency requires", "competencies require")} independent clinical review.`;
    if (me.canReview && mineCount > 0) return { headline: head, detail: `${mineCount} of them are in your queue. Each decision is on the exact content version.`, action: { kind: "review_mode", label: `Start focused review (${mineCount})` }, responsible: "Clinical Content Reviewer" };
    if (reviewersEligible === 0) return { headline: head, detail: "No appointed reviewer is both in scope and independent of this content. Appoint one (HQ Positions, then Clinical review governance for the scope).", action: { kind: "assign_reviewer", label: "Open HQ Positions" }, responsible: "Platform owner" };
    return { headline: head, detail: me.canReview ? "None of them is in your queue: they are outside your scope or you contributed to them." : "Waiting on the clinical reviewers named below.", action: me.canReview ? { kind: "open_queue", label: "Open Clinical Review queue" } : null, responsible: "Clinical Content Reviewer" };
  }
  if (c.ready > 0 && fw.editable) return { headline: `${plural(c.ready, "competency has", "competencies have")} not been put forward for clinical review.`, detail: "Nothing is reviewed until it is put forward at its current content.", action: me.canAuthor ? { kind: "put_forward", label: `Put ${c.ready} forward for review` } : null, responsible: "Competency Author" };
  if (c.changes > 0) return { headline: `${plural(c.changes, "competency needs", "competencies need")} changes from the author.`, detail: "A reviewer returned them with a note. Revise, then put them forward again.", action: me.canAuthor ? { kind: "edit", label: "Open Competency Authoring" } : null, responsible: "Competency Author" };
  if (allApproved && !fw.pending) return { headline: "All competencies are clinically approved.", detail: "The framework can be put forward for publication.", action: me.canAuthor && fw.editable && !!fw.layer ? { kind: "submit_publication", label: "Put forward for publication" } : null, responsible: "Competency Author" };
  if (allApproved && fw.pending) {
    if (publishersEligible === 0) return { headline: "Ready to publish, but no eligible independent publisher.", detail: "The submitter and every contributor are excluded. Appoint a Quality Council Member who has touched nothing in this framework.", action: { kind: "assign_reviewer", label: "Open HQ Positions" }, responsible: "Platform owner" };
    if (me.canPublish && !viewerPublisherConflict) return { headline: "Awaiting your publication decision.", detail: "Every competency is clinically approved at its current content.", action: { kind: "publish", label: "Decide publication" }, responsible: "Independent publisher" };
    return { headline: "Awaiting an independent publication decision.", detail: viewerPublisherConflict ?? "Waiting on the publishers named below.", action: null, responsible: "Independent publisher" };
  }
  return { headline: "Clinical review incomplete.", detail: `${c.approved} of ${c.total} approved.`, action: null, responsible: "Clinical Content Reviewer" };
}
