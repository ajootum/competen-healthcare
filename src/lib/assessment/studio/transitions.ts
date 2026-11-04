// Checklist Studio: what a person may do to a version right now, and why not. Pure and client-safe.
// THIS EXPLAINS, THE DATABASE DECIDES. The 890 lifecycle guard enforces every rule below for every writer.
// These helpers only draw the right buttons and say in plain words why one is disabled.
import type { DefinitionKind, LifecycleState, ReviewDecisionRow } from "./types";

export const CAP = {
  view: "hq.assessment.studio.view",
  author: "hq.assessment.instrument.author",
  review: "hq.assessment.instrument.review",
  publish: "hq.assessment.instrument.publish",
  assign: "hq.assessment.assessor.assign",
  assess: "hq.assessment.instrument.assess",
  domainReview: "hq.quality.clinical.approve",
} as const;

/** Migration 942: governed policies share the engine with their own three rights. Domain review is the one shared right. */
export const POLICY_CAP = {
  view: "hq.quality.policy.view",
  author: "hq.quality.policy.author",
  review: "hq.quality.policy.review",
  publish: "hq.quality.policy.publish",
} as const;

export interface KindCapabilities { view: string; author: string; review: string; publish: string; domainReview: string }
/** The capabilities a lifecycle step needs for a kind, as asmt_lifecycle_capability answers in the database. */
export function capabilitiesFor(kind: DefinitionKind): KindCapabilities {
  return kind === "policy"
    ? { view: POLICY_CAP.view, author: POLICY_CAP.author, review: POLICY_CAP.review, publish: POLICY_CAP.publish, domainReview: CAP.domainReview }
    : { view: CAP.view, author: CAP.author, review: CAP.review, publish: CAP.publish, domainReview: CAP.domainReview };
}

export interface Availability { allowed: boolean; reason: string | null }
const yes: Availability = { allowed: true, reason: null };
const no = (reason: string): Availability => ({ allowed: false, reason });

export interface TransitionInput {
  kind: DefinitionKind;
  state: LifecycleState;
  actorId: string;
  /** capabilities the actor holds (an owner is not assumed to hold any: the database wants appointments) */
  caps: string[];
  authoredBy: string[];
  editedBy: string[];
  /** everyone who authored, edited or submitted this or ANY earlier version of the same definition */
  involved: string[];
  contentHash: string | null;
  risk: "standard" | "high";
  requiresDomainReview: boolean;
  deliveryModes: string[];
  decisions: ReviewDecisionRow[];
  /** hq_sod_required_approvals for standard and high risk */
  need: { standard: number; high: number };
  /** engine validation errors currently on the content */
  validationErrors: number;
}

export interface ApprovalStatus {
  need: number;
  governance: number;
  domain: number;
  blocked: boolean;
  governanceMet: boolean;
  domainMet: boolean;
}

export function approvalStatus(i: Pick<TransitionInput, "decisions" | "contentHash" | "risk" | "requiresDomainReview" | "need">): ApprovalStatus {
  const need = i.risk === "high" ? i.need.high : i.need.standard;
  const forHash = i.decisions.filter((d) => d.content_hash === i.contentHash);
  const distinct = (kind: string) => new Set(forHash.filter((d) => d.review_kind === kind && d.decision === "approved").map((d) => d.reviewer_id)).size;
  const governance = distinct("governance");
  const domain = distinct("domain");
  const blocked = forHash.some((d) => d.decision !== "approved");
  const governanceMet = governance >= need;
  const domainMet = !i.requiresDomainReview || domain >= need;
  return { need, governance, domain, blocked, governanceMet, domainMet };
}

export interface Availabilities {
  edit: Availability;
  submit: Availability;
  returnToDraft: Availability;
  reviewGovernance: Availability;
  reviewDomain: Availability;
  approve: Availability;
  publish: Availability;
  retire: Availability;
  duplicate: Availability;
}

export function availabilities(i: TransitionInput): Availabilities {
  const CAP = capabilitiesFor(i.kind);
  const holds = (c: string) => i.caps.includes(c);
  const mine = i.authoredBy.includes(i.actorId) || i.editedBy.includes(i.actorId);
  const involved = i.involved.includes(i.actorId);
  const ap = approvalStatus(i);
  const alreadyDecided = (kind: string) => i.decisions.some((d) => d.reviewer_id === i.actorId && d.review_kind === kind && d.content_hash === i.contentHash);

  const edit = i.state !== "draft" ? no(`A ${i.state.replace("_", " ")} version is frozen. Duplicate it to make a new draft.`)
    : !holds(CAP.author) ? no("Editing needs the author capability.") : yes;

  const submit = i.state !== "draft" ? no("Only a draft can be put forward for review.")
    : !holds(CAP.author) ? no("Submitting needs the author capability.")
    : !mine ? no("Only an author or editor of this draft can put it forward.")
    : i.kind === "instrument" && i.deliveryModes.length === 0 ? no("Choose at least one delivery mode in Settings first.")
    : i.validationErrors > 0 ? no(`Fix the ${i.validationErrors} validation problem${i.validationErrors === 1 ? "" : "s"} first.`) : yes;

  const returnToDraft = i.state !== "in_review" && i.state !== "approved" ? no("Only a version in review or approved can go back to draft.")
    : !holds(CAP.author) ? no("Returning to draft needs the author capability.") : yes;

  const reviewBase = (kind: "governance" | "domain", cap: string): Availability =>
    i.state !== "in_review" ? no("A decision is recorded only while the version is in review.")
    : !holds(cap) ? no(kind === "governance" ? "A review decision needs the review capability." : "A domain decision needs the domain review capability.")
    : involved ? no("Not independent. You authored, edited or submitted this version or an earlier one.")
    : alreadyDecided(kind) ? no("You have already decided on this exact content.") : yes;
  const reviewGovernance = reviewBase("governance", CAP.review);
  const reviewDomain = !i.requiresDomainReview ? no("This version does not require a domain review.") : reviewBase("domain", CAP.domainReview);

  const approve = i.state !== "in_review" ? no("Only a version in review can be approved.")
    : !(holds(CAP.review) || holds(CAP.publish)) ? no("Approving needs the review or publish capability.")
    : ap.blocked ? no("A reviewer rejected it or asked for changes on this exact content.")
    : !ap.governanceMet ? no(`It needs ${ap.need} independent governance approval${ap.need === 1 ? "" : "s"} and has ${ap.governance}.`)
    : !ap.domainMet ? no(`It needs ${ap.need} independent domain approval${ap.need === 1 ? "" : "s"} and has ${ap.domain}.`) : yes;

  // UNIFIED-GOVERNANCE-V1 (migration 940): the author may publish the EXACT independently approved version. Independence
  // is enforced at the review decision (nobody approves their own work); an approved version carries the hash its
  // approvals name, and any change clears it. So publication needs the publish capability and the approved state only.
  const publish = i.state !== "approved" ? no("Only an approved version can be published.")
    : !holds(CAP.publish) ? no("Publishing needs the publish capability.")
    : i.kind === "instrument" && i.deliveryModes.length === 0 ? no("A checklist cannot be published without a delivery mode.") : yes;

  const retire = i.state !== "published" ? no("Only a published version can be retired.")
    : !holds(CAP.publish) ? no("Retiring needs the publish capability.") : yes;

  const duplicate = !holds(CAP.author) ? no("Duplicating needs the author capability.") : yes;
  return { edit, submit, returnToDraft, reviewGovernance, reviewDomain, approve, publish, retire, duplicate };
}

/** Plain words for a database refusal. Falls back to the original text, never to a generic apology. */
export function friendlyDbError(message: string | null | undefined): string {
  const m = String(message ?? "").trim();
  if (!m) return "The change could not be saved.";
  const rules: [RegExp, string][] = [
    [/not independent/i, "Not independent: you authored, edited or submitted this version (or an earlier one), so you cannot approve, review or publish it."],
    [/frozen/i, "This version is frozen. Duplicate it to make a new draft."],
    [/only an author or editor of the draft/i, "Only an author or editor of this draft can put it forward for review."],
    [/without at least one delivery mode/i, "Choose at least one delivery mode in Settings before putting this forward."],
    [/purpose .* cannot be published/i, "That purpose cannot be published. Choose another purpose."],
    [/every scale an item uses must be a published/i, "Every scale an item uses must be a published scale version."],
    [/not approved\. It needs/i, m.replace(/^[a-z_]+: /i, "")],
    [/rejected it or asked for changes/i, "A reviewer rejected it or asked for changes on this exact content."],
    [/not authorised/i, "You do not hold the capability this step needs."],
    [/duplicate key value.*asmt_instrument_code|already exists.*code/i, "That code is already in use."],
    [/duplicate key value/i, "That already exists."],
    [/asmt_item_scale_check/i, "A rating item needs a scale, and other items must not have one."],
    [/asmt_item_critical_check/i, "A critical item must also be mandatory."],
    [/foreign key constraint.*group/i, "That group does not exist in this version."],
  ];
  for (const [re, text] of rules) if (re.test(m)) return text;
  return m.replace(/^asmt_[a-z_]+: /i, "");
}
