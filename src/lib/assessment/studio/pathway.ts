// ASMT-PATHWAY-01 -- the pathway to publication, the PURE half. Client-safe: no import of a server module.
//
// THIS EXPLAINS, THE DATABASE DECIDES. Every rule drawn here is the 890 lifecycle guard's and transitions.ts's: this
// module only ARRANGES what availabilities() and approvalStatus() already say into the five stages, the one next action,
// the blockers with their reasons, and who can act (the appointed holders by name, each with their independence for THIS
// content). It adds no stage, no rule and no exception. The same shape serves every definition kind (checklist version,
// response scale, scoring template, layout template, progression rule set) and the catalogue identity that has no
// version yet. The pattern is the Framework Governance Workspace's (src/lib/competency/governance-rules.ts).
import type { ApprovalStatus, Availabilities } from "./transitions";
import { CAP } from "./transitions";
import { capabilityLabel } from "./capability-labels";
import { KIND_LABEL, type DefinitionKind, type LifecycleState, type ReviewDecisionRow, type StudioIssue } from "./types";

export type StageKey = "draft" | "review" | "approved" | "published" | "retired";
export type StageStatus = "done" | "current" | "waiting" | "blocked" | "not_started";
export interface PathwayStage { key: StageKey; label: string; status: StageStatus; role: string; note: string | null }

export type NextKind = "first_version" | "edit" | "submit" | "review" | "approve" | "publish" | "catalogue" | "duplicate" | "appoint" | "none";
export interface PathwayNext {
  /** The one thing to do now, in plain words: "Submit v1 for review". */
  headline: string;
  detail: string;
  /** What the page may offer THIS person. null = nothing for them, the responsible role is named instead. */
  action: { kind: NextKind; label: string } | null;
  /** The role responsible for the next step, in words. */
  responsible: string;
  /** This person's own standing on the next step: may they act, and if not, why. */
  viewer: { canAct: boolean; reason: string | null };
}

export interface Blocker { text: string; fix: string | null }

export interface PathwayHolder { personId: string; name: string; position: string }
/** The appointed holders of each Studio capability, read from the live appointments (never assumed). */
export interface PathwayHolders {
  author: PathwayHolder[]; review: PathwayHolder[]; domainReview: PathwayHolder[]; publish: PathwayHolder[];
  /** Positions that grant each capability (so an empty list can say "no position grants this" vs "nobody appointed"). */
  positions: { author: string[]; review: string[]; domainReview: string[]; publish: string[] };
  /** false when the appointments could not be read: said on screen, never silently empty. */
  readable: boolean;
}
export const NO_HOLDERS: PathwayHolders = { author: [], review: [], domainReview: [], publish: [], positions: { author: [], review: [], domainReview: [], publish: [] }, readable: true };

export interface ActorStanding { personId: string; name: string; position: string; eligible: boolean; conflict: string | null }
export interface WhoCanAct {
  capability: string; capabilityLabel: string; role: string; positions: string[];
  actors: ActorStanding[]; eligible: number;
  /** Why the list is empty or unreliable, or null. */
  note: string | null;
}

export type Moment = "registered" | "draft" | "returned" | "submitted" | "approved" | "published" | "retired";
export interface PathwayPrompt { moment: Moment; text: string }

export interface PathwayModel {
  kind: DefinitionKind;
  versionNo: number | null;
  state: LifecycleState | null;
  stages: PathwayStage[];
  current: StageKey | "registered";
  next: PathwayNext;
  blockers: Blocker[];
  /** The groups that matter for the current step, the responsible one first. */
  who: WhoCanAct[];
  prompt: PathwayPrompt;
}

export interface PathwayInput {
  kind: DefinitionKind;
  versionNo: number | null;
  /** null = the catalogue identity exists and has no version yet. */
  state: LifecycleState | null;
  actorId: string;
  caps: string[];
  availability: Availabilities | null;
  approval: ApprovalStatus | null;
  authoredBy: string[];
  editedBy: string[];
  submittedBy: string | null;
  /** everyone who authored, edited or submitted this or ANY earlier version of the same definition (asmt_version_people) */
  involved: string[];
  decisions: ReviewDecisionRow[];
  contentHash: string | null;
  requiresDomainReview: boolean;
  deliveryModes: string[];
  /** engine validation errors on the content */
  validation: StudioIssue[];
  /** The most recent return to draft since the last submission, when the version was returned with notes. */
  returned: { by: string | null; note: string | null } | null;
  /** When the version is retired: the version that superseded it, if any. */
  supersededBy: number | null;
  /** Checklists only: product availability already set in the catalogue (null = unknown or not a checklist). */
  catalogueAvailability: boolean | null;
  holders: PathwayHolders;
  names: Record<string, string>;
}

const ROLE = { author: "Author", review: "Independent reviewer", domainReview: "Independent domain reviewer", publish: "Independent publisher" } as const;
const INDEPENDENCE = "Not independent: authored, edited or submitted this version or an earlier one.";
const STAGE_LABEL: Record<StageKey, string> = { draft: "Draft", review: "Submitted for review", approved: "Approved", published: "Published", retired: "Retired" };
const STAGE_ROLE: Record<StageKey, string> = { draft: ROLE.author, review: ROLE.review, approved: ROLE.publish, published: "", retired: "" };
const ORDER: StageKey[] = ["draft", "review", "approved", "published", "retired"];

const nameOf = (names: Record<string, string>, id: string | null | undefined) => (id ? names[id] ?? "a person" : "someone");
const listNames = (xs: { name: string }[]) => xs.map((x) => x.name).join(", ");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const vLabel = (versionNo: number | null) => (versionNo ? `v${versionNo}` : "the draft");

/** Pure: who, of the appointed holders, may act on THIS content under THIS capability. Independence is content-specific. */
export function standingOf(group: "author" | "review" | "domainReview" | "publish", i: Pick<PathwayInput, "holders" | "involved" | "decisions" | "contentHash">): WhoCanAct {
  const cap = { author: CAP.author, review: CAP.review, domainReview: CAP.domainReview, publish: CAP.publish }[group];
  const holders = i.holders[group];
  const positions = i.holders.positions[group];
  const decided = (personId: string, kind: "governance" | "domain") => i.decisions.some((d) => d.reviewer_id === personId && d.review_kind === kind && d.content_hash === i.contentHash && i.contentHash !== null);
  const actors: ActorStanding[] = holders.map((h) => {
    let conflict: string | null = null;
    if (group !== "author") {
      if (i.involved.includes(h.personId)) conflict = INDEPENDENCE;
      else if (group === "review" && decided(h.personId, "governance")) conflict = "Already decided on this exact content.";
      else if (group === "domainReview" && decided(h.personId, "domain")) conflict = "Already decided on this exact content.";
    }
    return { ...h, eligible: conflict === null, conflict };
  });
  const note = !i.holders.readable ? "The appointments could not be read just now."
    : positions.length === 0 ? "No position grants this right yet."
    : holders.length === 0 ? "Nobody is appointed to these positions."
    : actors.every((a) => !a.eligible) ? "Everyone appointed is involved in this content: another appointee must act." : null;
  return { capability: cap, capabilityLabel: capabilityLabel(cap), role: ROLE[group], positions, actors, eligible: actors.filter((a) => a.eligible).length, note };
}

/** Pure: the five stages with their status for one version (or none). */
export function stagesOf(i: Pick<PathwayInput, "state" | "versionNo" | "approval" | "requiresDomainReview" | "returned" | "supersededBy" | "submittedBy" | "names" | "authoredBy">, reviewersEligible: number, publishersEligible: number, blockers: Blocker[]): PathwayStage[] {
  const STATE_STAGE: Record<LifecycleState, StageKey> = { draft: "draft", in_review: "review", approved: "approved", published: "published", retired: "retired" };
  const idx = i.state ? ORDER.indexOf(STATE_STAGE[i.state]) : -1;
  const ap = i.approval;
  return ORDER.map((key, k) => {
    let status: StageStatus = k < idx ? "done" : k === idx ? "current" : "not_started";
    let note: string | null = null;
    if (key === "draft") {
      if (i.state === null) { status = "not_started"; note = "No version yet."; }
      else if (i.state === "draft") note = i.returned ? `Returned to draft${i.returned.by ? ` by ${nameOf(i.names, i.returned.by)}` : ""}.` : `Authored by ${i.authoredBy.map((a) => nameOf(i.names, a)).join(", ") || "an author"}.`;
      else status = "done";
      if (i.state === "draft" && blockers.length) status = "blocked";
    }
    if (key === "review") {
      if (i.state === "in_review") {
        status = ap?.blocked ? "blocked" : reviewersEligible === 0 ? "blocked" : "current";
        note = ap ? `Governance approvals ${ap.governance} of ${ap.need}${i.requiresDomainReview ? `, domain ${ap.domain} of ${ap.need}` : ""}.${ap.blocked ? " A reviewer asked for changes or rejected it." : ""}` : null;
      } else if (idx > 1) { status = "done"; note = ap ? `${plural(ap.governance, "independent approval")} recorded.` : null; }
      else if (i.state === "draft" && i.returned) note = "Returned with notes.";
    }
    if (key === "approved" && i.state === "approved") { status = publishersEligible === 0 ? "blocked" : "current"; note = "Approved on the exact content. Awaiting publication."; }
    if (key === "published") {
      if (i.state === "published") note = "In use. Frozen: a change is a new draft.";
      else if (i.state === "retired") status = "done";
    }
    if (key === "retired") {
      if (i.state === "retired") { status = "current"; note = i.supersededBy ? `Superseded by v${i.supersededBy}.` : "Retired. No longer used for new work."; }
      else status = "not_started";
    }
    return { key, label: key === "retired" && i.supersededBy ? "Superseded" : STAGE_LABEL[key], status, role: STAGE_ROLE[key], note };
  });
}

/** Pure: what stands between this version and its next stage, with the fix. Actor-independent. */
export function blockersOf(i: PathwayInput, reviewers: WhoCanAct, domainReviewers: WhoCanAct, publishers: WhoCanAct): Blocker[] {
  const out: Blocker[] = [];
  const ap = i.approval;
  if (i.state === null) return out;
  if (i.state === "draft") {
    if (i.kind === "instrument" && i.deliveryModes.length === 0) out.push({ text: "No delivery mode chosen.", fix: "Choose at least one delivery mode in Settings & Review." });
    const scaleIssue = i.validation.find((e) => /scale/i.test(e.message) || /scale/i.test(e.path));
    if (scaleIssue) out.push({ text: scaleIssue.message, fix: "Choose a published response scale on each rating item (Content tab), or publish the scale first." });
    const others = i.validation.filter((e) => e !== scaleIssue);
    if (others.length) out.push({ text: `${plural(others.length, "validation problem")}: ${others.slice(0, 2).map((e) => e.message).join(" ")}${others.length > 2 ? " …" : ""}`, fix: "Run Validate in Settings & Review and fix each problem." });
    const stale = i.decisions.filter((d) => d.decision === "approved" && d.content_hash !== i.contentHash);
    if (stale.length && !i.returned) out.push({ text: `${plural(stale.length, "earlier approval")} on earlier content no longer count.`, fix: "Submit again: approvals attach to the exact content put forward." });
    if (i.returned?.note) out.push({ text: `Returned with notes: "${i.returned.note.slice(0, 200)}"`, fix: "Address the notes, then submit again." });
  }
  if (i.state === "in_review" && ap) {
    if (ap.blocked) out.push({ text: "A reviewer rejected it or asked for changes on this exact content.", fix: "An author returns it to draft, edits, and submits again." });
    else {
      if (!ap.governanceMet) out.push({ text: `Needs ${plural(ap.need, "independent governance approval")}, has ${ap.governance}.`, fix: reviewers.eligible === 0 ? (reviewers.note ?? "Appoint an independent reviewer.") : `${listNames(reviewers.actors.filter((a) => a.eligible))} can approve.` });
      if (!ap.domainMet) out.push({ text: `Needs ${plural(ap.need, "independent domain approval")}, has ${ap.domain}.`, fix: domainReviewers.eligible === 0 ? (domainReviewers.note ?? "Appoint an independent domain reviewer.") : `${listNames(domainReviewers.actors.filter((a) => a.eligible))} can give the domain review.` });
    }
  }
  if (i.state === "approved") {
    if (i.kind === "instrument" && i.deliveryModes.length === 0) out.push({ text: "A checklist cannot be published without a delivery mode.", fix: "Return to draft and choose a delivery mode." });
    if (publishers.eligible === 0) out.push({ text: "No eligible independent publisher.", fix: publishers.note ?? "Everyone who can publish is involved in this content: appoint another publisher." });
  }
  return out;
}

/** Pure: the whole pathway for one version (or the identity before its first version). */
export function pathwayOf(i: PathwayInput): PathwayModel {
  const label = KIND_LABEL[i.kind];
  const v = vLabel(i.versionNo);
  const authors = standingOf("author", i);
  const reviewers = standingOf("review", i);
  const domainReviewers = standingOf("domainReview", i);
  const publishers = standingOf("publish", i);
  const blockers = blockersOf(i, reviewers, domainReviewers, publishers);
  const reviewersEligible = i.requiresDomainReview ? Math.min(reviewers.eligible, domainReviewers.eligible) : reviewers.eligible;
  const stages = stagesOf(i, reviewersEligible, publishers.eligible, blockers);
  const av = i.availability;
  const ap = i.approval;
  const holdsAuthor = i.caps.includes(CAP.author);
  const eligibleNames = (g: WhoCanAct) => listNames(g.actors.filter((a) => a.eligible));

  // ---- no version yet: the catalogue identity ---------------------------------------------------------------------
  if (i.state === null || !av || !ap) {
    const canAct = holdsAuthor;
    return {
      kind: i.kind, versionNo: null, state: null, stages, current: "registered",
      next: {
        headline: `Create the first draft of this ${label.toLowerCase()}.`,
        detail: `It is registered with its permanent code and has no content yet. An author creates version 1 in Checklist Studio, completes it, then submits it for review.`,
        action: canAct ? { kind: "first_version", label: "Create first draft" } : null, responsible: ROLE.author,
        viewer: { canAct, reason: canAct ? null : "Creating a draft needs the author capability, held through an appointment." },
      },
      blockers: [], who: [authors, reviewers, publishers],
      prompt: { moment: "registered", text: `Your ${label.toLowerCase()} is registered. Next: open it in Checklist Studio, create and complete its first draft, then Submit for review.${authors.eligible ? ` Authors: ${eligibleNames(authors)}.` : ""}` },
    };
  }

  // ---- draft -----------------------------------------------------------------------------------------------------
  if (i.state === "draft") {
    const can = av.submit.allowed;
    const reason = can ? null : av.submit.reason;
    const whoReviews = reviewers.eligible ? ` Reviewers who can approve: ${eligibleNames(reviewers)}.` : reviewers.note ? ` ${reviewers.note}` : "";
    const edit = holdsAuthor && !can && blockers.length > 0;
    return {
      kind: i.kind, versionNo: i.versionNo, state: i.state, stages, current: "draft",
      next: {
        headline: blockers.length ? `Complete ${v}, then submit it for review.` : `Submit ${v} for review.`,
        detail: blockers.length ? `${plural(blockers.length, "thing")} to settle first (below). Submitting freezes the content and asks an independent reviewer to approve it.` : `Submitting freezes the content and asks an independent reviewer to approve it.${whoReviews}`,
        action: can ? { kind: "submit", label: `Submit ${v} for review` } : edit ? { kind: "edit", label: "Open the content" } : null,
        responsible: ROLE.author, viewer: { canAct: can, reason: reason ?? (edit ? "Settle the blockers, then submit." : null) },
      },
      blockers, who: [authors, reviewers, ...(i.requiresDomainReview ? [domainReviewers] : []), publishers],
      prompt: i.returned
        ? { moment: "returned", text: `Returned with notes${i.returned.by ? ` by ${nameOf(i.names, i.returned.by)}` : ""}${i.returned.note ? `: "${i.returned.note.slice(0, 160)}"` : ""}. Edit and resubmit.` }
        : { moment: "draft", text: `${v === "the draft" ? "The draft" : `Draft ${v}`} is registered. Next: complete its content, then Submit for review.${whoReviews}` },
    };
  }

  // ---- in review --------------------------------------------------------------------------------------------------
  if (i.state === "in_review") {
    const canDecide = av.reviewGovernance.allowed || av.reviewDomain.allowed;
    const canMark = av.approve.allowed;
    const involved = i.involved.includes(i.actorId);
    const reason = canDecide || canMark ? null
      : involved ? "You authored, edited or submitted this version (or an earlier one), so another appointee must approve it."
      : av.reviewGovernance.reason;
    const needText = ap.blocked ? "A reviewer asked for changes." : `Needs ${plural(ap.need, "independent governance approval")}${i.requiresDomainReview ? ` and ${plural(ap.need, "domain approval")}` : ""}; has ${ap.governance}${i.requiresDomainReview ? ` and ${ap.domain}` : ""}.`;
    const waitingOn = reviewers.eligible ? `Waiting for a reviewer: ${eligibleNames(reviewers)} can approve.` : reviewers.note ?? "Waiting for a reviewer.";
    const domainOn = i.requiresDomainReview && !ap.domainMet ? (domainReviewers.eligible ? ` Domain review: ${eligibleNames(domainReviewers)}.` : ` ${domainReviewers.note ?? "No domain reviewer available."}`) : "";
    const ready = ap.governanceMet && ap.domainMet && !ap.blocked;
    return {
      kind: i.kind, versionNo: i.versionNo, state: i.state, stages, current: "review",
      next: {
        headline: ap.blocked ? `Return ${v} to draft and address the notes.` : ready ? `Mark ${v} approved.` : `Approve or return ${v}.`,
        detail: ap.blocked ? "A reviewer rejected it or asked for changes on this exact content. An author returns it to draft, edits and submits again."
          : ready ? "The independent approvals are in. Marking it approved records the state; publication is a separate step." : `${needText} ${waitingOn}${domainOn}`,
        action: ap.blocked ? (av.returnToDraft.allowed ? { kind: "edit", label: "Return to draft" } : null)
          : ready && canMark ? { kind: "approve", label: `Mark ${v} approved` }
          : canDecide ? { kind: "review", label: "Record your decision" } : null,
        responsible: ap.blocked ? ROLE.author : ROLE.review,
        viewer: { canAct: ap.blocked ? av.returnToDraft.allowed : canDecide || (ready && canMark), reason: ap.blocked ? av.returnToDraft.reason : reason },
      },
      blockers, who: [reviewers, ...(i.requiresDomainReview ? [domainReviewers] : []), publishers, authors],
      prompt: { moment: "submitted", text: `Submitted${i.submittedBy ? ` by ${nameOf(i.names, i.submittedBy)}` : ""}. ${waitingOn}${domainOn}${involved ? " You authored this, so another appointee must approve." : ""}` },
    };
  }

  // ---- approved ---------------------------------------------------------------------------------------------------
  if (i.state === "approved") {
    const can = av.publish.allowed;
    const whoPublishes = publishers.eligible ? `${eligibleNames(publishers)} can publish.` : publishers.note ?? "Nobody can publish yet.";
    return {
      kind: i.kind, versionNo: i.versionNo, state: i.state, stages, current: "approved",
      next: {
        headline: `Publish ${v}.`, detail: `Approved on the exact content. Publishing makes it the version in use${i.kind === "instrument" ? " and retires the previous published version" : ""}. ${whoPublishes}`,
        action: can ? { kind: "publish", label: `Publish ${v}` } : null, responsible: ROLE.publish,
        viewer: { canAct: can, reason: can ? null : i.involved.includes(i.actorId) ? "You authored, edited or submitted this version (or an earlier one), so another appointee must publish it." : av.publish.reason },
      },
      blockers, who: [publishers, reviewers, authors],
      prompt: { moment: "approved", text: `Ready to publish: ${whoPublishes}` },
    };
  }

  // ---- published --------------------------------------------------------------------------------------------------
  if (i.state === "published") {
    const text = i.kind === "instrument"
      ? (i.catalogueAvailability === true ? "Published and available: the catalogue lists it to the products it is enabled for." : "Published. To make it available in a product, set its product availability in the catalogue (Available or Optional for each product line).")
      : "Published and in use. To change it, duplicate to a new draft and take the new version through review.";
    const catalogue = i.kind === "instrument" && i.catalogueAvailability !== true;
    return {
      kind: i.kind, versionNo: i.versionNo, state: i.state, stages, current: "published",
      next: {
        headline: catalogue ? "Set product availability in the catalogue." : `${v} is published.`,
        detail: text,
        action: catalogue ? { kind: "catalogue", label: "Open in the catalogue" } : av.duplicate.allowed ? { kind: "duplicate", label: "Duplicate to a new draft" } : null,
        responsible: catalogue ? "Catalogue manager" : "", viewer: { canAct: true, reason: null },
      },
      blockers, who: [publishers, authors],
      prompt: { moment: "published", text },
    };
  }

  // ---- retired ----------------------------------------------------------------------------------------------------
  const text = i.supersededBy ? `Retired: v${i.supersededBy} supersedes it.` : "Retired. It is kept for the record and no longer used for new work.";
  return {
    kind: i.kind, versionNo: i.versionNo, state: i.state, stages, current: "retired",
    next: { headline: text, detail: av.duplicate.allowed ? "To start again from this content, duplicate it to a new draft." : "", action: av.duplicate.allowed ? { kind: "duplicate", label: "Duplicate to a new draft" } : null, responsible: "", viewer: { canAct: true, reason: null } },
    blockers, who: [authors], prompt: { moment: "retired", text },
  };
}

/** The short form the catalogue and the import finish step show: stage, next action, who. Serializable. */
export interface PathwaySummary {
  state: LifecycleState | null;
  versionNo: number | null;
  stageLabel: string;
  stages: { key: StageKey; label: string; status: StageStatus }[];
  headline: string;
  detail: string;
  responsible: string;
  /** eligible names for the responsible step */
  who: string[];
  whoNote: string | null;
  prompt: string;
  blockers: string[];
  viewerCanAct: boolean;
}

export function summarize(m: PathwayModel): PathwaySummary {
  const stage = m.stages.find((s) => s.status === "current" || s.status === "blocked") ?? null;
  const lead = m.who[0];
  return {
    state: m.state, versionNo: m.versionNo, stageLabel: m.state === null ? "Registered, no version yet" : stage?.label ?? "",
    stages: m.stages.map((s) => ({ key: s.key, label: s.label, status: s.status })),
    headline: m.next.headline, detail: m.next.detail, responsible: m.next.responsible,
    who: lead ? lead.actors.filter((a) => a.eligible).map((a) => a.name) : [], whoNote: lead?.note ?? null,
    prompt: m.prompt.text, blockers: m.blockers.map((b) => b.text), viewerCanAct: m.next.viewer.canAct,
  };
}
