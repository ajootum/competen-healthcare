/* eslint-disable @typescript-eslint/no-explicit-any */
// FRAMEWORK-GOVERNANCE-WORKSPACE-01 -- one framework, every governance fact on it, for one person.
//
// Reads ONLY through the existing services and tables: the authoring view (465) for structure and content, the clinical
// review states (395) for each competency, the reviewer's own queue (clinical-review-hq) for what THIS person may decide
// now, the publication view and request (580) for readiness, the appointments and grants (264, 641) for who can act, and
// the audit trail for history. Nothing here decides anything: the pure helpers only sort what the services return into
// the pathway, the next action, the queues and the eligibility the page draws. Every write stays on its own gated route,
// and the database's independence guards (395, 640) remain the control.
import { loadAuthoringView, type AuthoringCompetency, type AuthoringView } from "./authoring-view";
import { CLINICAL_STATE_LABEL, clinicalNote, scopeCovers, type ClinicalReview, type ReviewerScope } from "./clinical-review";
import { reviewQueue, type QueueItem } from "./clinical-review-hq";
import { eligibilityOf, type Eligibility } from "./review-batch";
import { contributorsOf, loadPublicationView, publisherConflict, type PublicationRow } from "./framework-publication";
import { checksFor } from "./criteria-checks";
import { activeGrants, appointmentInTerm, narrowToScope } from "@/lib/hq/spaces";

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

// ── the pathway and the next action (pure) ──────────────────────────────────────────────────────────

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/**
 * Pure: the five stages with their status. A submitted publication request is NOT readiness: the decision stage says
 * "put forward early" while clinical review is incomplete, and the publish action is offered only once every
 * competency is approved at its current content (466) and an eligible independent publisher exists.
 */
export function pathwayOf(fw: GovFramework, c: Counts, publishersEligible: number, reviewersEligible: number | null): Stage[] {
  const published = fw.pubStatus === "published";
  const allApproved = c.total > 0 && c.approved === c.total;
  const forwarded = c.total > 0 && c.ready === 0 && c.unreadable === 0;
  const prep: Stage = {
    key: "preparation", label: "Framework preparation", role: "Competency Author",
    status: published || forwarded ? "done" : c.total === 0 ? "current" : "current",
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

// ── loading ──────────────────────────────────────────────────────────────────────────────────────────

function toCompetency(c: AuthoringCompetency, domainId: string, domain: string, pubStatus: string, mine: QueueItem | undefined, version: GovCompetency["version"], components: Record<string, string>): GovCompetency {
  const state = eligibilityOf(c.clinical, pubStatus);
  return {
    id: c.id, code: c.code, name: c.name, domainId, domain, description: c.description, outcomes: c.learningOutcomes, riskCategory: c.riskCategory,
    criteria: c.criteria.filter(k => k.active !== false).map(k => ({ component: k.component, text: k.text, sourceRef: k.sourceRef })),
    clinical: c.clinical, state,
    stateLabel: c.clinical ? CLINICAL_STATE_LABEL[c.clinical.state] : "Clinical state not readable",
    stateNote: c.clinical ? clinicalNote(c.clinical) : "Its clinical state could not be read just now.",
    version,
    mine: mine ? { versionId: mine.versionId, appointmentId: mine.appointmentId, approvals: mine.approvals, required: mine.required, submittedAt: mine.submittedAt,
      checks: checksFor(mine.criteria ?? c.criteria.filter(k => k.active !== false), components) } : null,
  };
}

const rows = async (p: PromiseLike<any>): Promise<any[] | null> => { try { const r = await p; return r?.error ? null : (r?.data ?? []); } catch { return null; } };
const nameOf = (p: any) => (p?.full_name as string | null) ?? (p?.email as string | null) ?? "Unnamed";

/** Positions granting a capability now, and the people appointed to them, with reviewer scopes. */
async function actorsFor(admin: any, capability: string, role: string, fw: GovFramework, domainIds: readonly string[], conflictOf: (personId: string) => string | null, withScopes: boolean): Promise<ActorGroup> {
  const grants = await rows(admin.from("hq_position_capability").select("position_code, effective_from, effective_to").eq("capability_code", capability).limit(500));
  const positions = grants ? [...new Set(activeGrants(grants as any).map((g: any) => g.position_code as string))].sort() : [];
  const note = grants === null ? "The grants could not be read just now." : positions.length === 0 ? "No position grants this right." : null;
  if (!positions.length) return { capability, role, positions, actors: [], eligible: 0, note };
  const appts = await rows(admin.from("ogs_office_appointments").select("id, person_id, role, status, term_start, term_end, capability_scope").in("role", positions).eq("status", "active").limit(500));
  if (appts === null) return { capability, role, positions, actors: [], eligible: 0, note: "The appointments could not be read just now." };
  const live = appts.filter((a: any) => appointmentInTerm(a.term_start, a.term_end) && narrowToScope([capability], a.capability_scope).length > 0);
  const people = live.length ? await rows(admin.from("profiles").select("id, full_name, email").in("id", [...new Set(live.map((a: any) => a.person_id))])) : [];
  const byId = new Map((people ?? []).map((p: any) => [p.id, nameOf(p)]));
  let scopes: any[] = [];
  if (withScopes && live.length) scopes = (await rows(admin.from("clinical_reviewer_scope").select("appointment_id, scope_kind, scope_ref").in("appointment_id", live.map((a: any) => a.id)).is("ended_at", null))) ?? [];
  const actors: Actor[] = live.map((a: any) => {
    const sc: ReviewerScope[] = scopes.filter(s => s.appointment_id === a.id).map(s => ({ id: "", appointmentId: a.id, kind: s.scope_kind, ref: s.scope_ref }));
    const inScope = withScopes ? domainIds.some(d => scopeCovers(sc, { domainId: d, frameworkId: fw.id, professionTermId: fw.professionTermId, specialtyTermId: fw.specialtyTermId })) : null;
    const conflict = conflictOf(a.person_id) ?? (withScopes && !inScope ? "Reviewer scope does not cover this framework (set in Clinical review governance)." : null);
    return { personId: a.person_id, name: byId.get(a.person_id) ?? "Unnamed", position: a.role, inScope, conflict };
  });
  return { capability, role, positions, actors, eligible: actors.filter(a => !a.conflict).length, note: actors.length === 0 ? "Nobody is appointed to these positions." : null };
}

const HISTORY_ACTIONS: Record<string, string> = {
  submit_review: "Put forward for publication", approve_content: "Published", reject_content: "Returned to the author", publish: "Published", revert: "Returned to draft", archive: "Archived",
  cfca_review_batch_submitted: "Competencies put forward for clinical review", clinical_review_submitted: "Put forward for clinical review",
  clinical_review_decided: "Clinical decision", clinical_review_decided_many: "Clinical decisions", clinical_scope_added: "Reviewer scope added", clinical_scope_ended: "Reviewer scope ended",
  cfca_framework_created: "Framework created", cfca_draft_imported: "Draft imported", cfca_domains_restructured: "Domains restructured",
};

/** The whole model for one framework, or null when the framework cannot be read. */
export async function loadGovernanceModel(admin: any, userId: string, frameworkId: string, me: Me): Promise<GovModel | null> {
  const [view, queue, pub, pendingRows] = await Promise.all([
    loadAuthoringView(admin) as Promise<AuthoringView | null>,
    me.canReview ? reviewQueue(admin, userId) : Promise.resolve(null),
    loadPublicationView(admin),
    rows(admin.from("content_approvals").select("id, submitted_by, submitted_by_name, submitted_at, comment").eq("framework_id", frameworkId).eq("status", "pending").order("submitted_at", { ascending: false }).limit(1)),
  ]);
  const f = view?.frameworks.find(x => x.id === frameworkId);
  if (!view || !f) return null;
  const mine = new Map<string, QueueItem>();
  for (const i of queue?.items ?? []) if (i.kind === "competency" && !i.revision) mine.set(i.competencyId, i);
  const compIds = f.domains.flatMap(d => d.competencies.map(c => c.id));
  const versionIds = f.domains.flatMap(d => d.competencies.map(c => c.clinical?.versionId).filter((v): v is string => !!v));
  const versions = versionIds.length ? (await rows(admin.from("clinical_content_version").select("id, competency_id, authored_by, submitted_by").in("id", versionIds))) ?? [] : [];
  const versionByComp = new Map<string, GovCompetency["version"]>(versions.map((v: any) => [v.competency_id, { id: v.id, authoredBy: (v.authored_by ?? []) as string[], submittedBy: v.submitted_by ?? null }]));
  const domains: GovDomain[] = f.domains.map(d => ({ id: d.id, name: d.name, competencies: d.competencies.map(c => toCompetency(c, d.id, d.name, f.pubStatus, mine.get(c.id), versionByComp.get(c.id) ?? null, view.components)) }));
  const counts = countsOf(domains);
  const p0 = pendingRows?.[0];
  const pubRow = pub?.rows.find(r => r.id === f.id) ?? null;
  const framework: GovFramework = {
    id: f.id, code: f.code, name: f.name, pubStatus: f.pubStatus, layer: f.layer, editable: EDITABLE.has(f.pubStatus), version: pubRow?.version ?? `${f.versionNum}`,
    approved: counts.approved, total: counts.total, publication: pubRow,
    pending: p0 ? { id: p0.id, submittedBy: p0.submitted_by ?? null, submittedByName: p0.submitted_by_name ?? null, submittedAt: p0.submitted_at ?? null, note: p0.comment ?? null } : null,
    professionTermId: f.professionTermId, specialtyTermId: f.specialtyTermId,
  };
  // Contributors for publication (the same trail decidePublication reads) and the authorship of each version for review.
  const entityIds = [f.id, ...f.domains.map(d => d.id), ...compIds];
  const trail = (await rows(admin.from("audit_log").select("actor_id, actor_name, action, entity_id, entity_type, created_at, new_value").in("entity_id", entityIds).order("created_at", { ascending: false }).limit(5000))) ?? [];
  const contributors = contributorsOf(trail);
  const publisherConflictOf = (personId: string) => framework.pending ? publisherConflict(personId, framework.pending.submittedBy, contributors) : (contributors.includes(personId) ? "Contributed to this framework's content, so may not publish it." : null);
  const reviewerConflictOf = (personId: string) => {
    const vs = [...versionByComp.values()].filter((v): v is NonNullable<typeof v> => !!v);
    const blocked = vs.filter(v => v.authoredBy.includes(personId) || v.submittedBy === personId).length;
    return blocked === 0 ? null : blocked === vs.length ? "Authored, edited or submitted every version in review, so may not review this framework." : `Authored, edited or submitted ${blocked} of ${vs.length} versions, so may not review those.`;
  };
  const domainIds = f.domains.map(d => d.id);
  const [reviewers, publishers, authors] = await Promise.all([
    actorsFor(admin, REVIEW_CAP, "Clinical Content Reviewer", framework, domainIds, reviewerConflictOf, true),
    actorsFor(admin, PUBLISH_CAP, "Independent publisher", framework, domainIds, publisherConflictOf, false),
    actorsFor(admin, AUTHOR_CAP, "Competency Author", framework, domainIds, () => null, false),
  ]);
  // History: the governance trail of this framework and its content, plus every clinical decision on its versions.
  const decisions = versionIds.length ? (await rows(admin.from("clinical_review_decision").select("version_id, reviewer_id, decision, created_at").in("version_id", versionIds).order("created_at", { ascending: false }).limit(500))) ?? [] : [];
  const reviewerIds = [...new Set(decisions.map((d: any) => d.reviewer_id))];
  const reviewerNames = new Map<string, string>(reviewerIds.length ? ((await rows(admin.from("profiles").select("id, full_name, email").in("id", reviewerIds))) ?? []).map((p: any) => [p.id, nameOf(p)]) : []);
  const compName = new Map(domains.flatMap(d => d.competencies.map(c => [c.id, c.name] as const)));
  const versionComp = new Map(versions.map((v: any) => [v.id, v.competency_id as string]));
  const history: HistoryEvent[] = [
    ...trail.filter((t: any) => t.action in HISTORY_ACTIONS && t.entity_id === f.id).map((t: any) => ({
      at: t.created_at, kind: t.action, who: t.actor_name ?? null,
      text: HISTORY_ACTIONS[t.action] + (t.new_value?.note ? ` -- "${String(t.new_value.note).slice(0, 160)}"` : "") + (t.new_value?.version ? ` (version ${t.new_value.version})` : "") + (t.new_value?.counts?.submitted != null ? ` (${t.new_value.counts.submitted} submitted)` : ""),
    })),
    ...decisions.map((d: any) => ({ at: d.created_at, kind: `decision_${d.decision}`, who: reviewerNames.get(d.reviewer_id) ?? null, text: `${d.decision === "approved" ? "Approved" : "Changes requested"}: ${compName.get(versionComp.get(d.version_id) ?? "") ?? "a competency"}` })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 80);
  const reviewersEligible = reviewers.note ? null : reviewers.eligible;
  const stages = pathwayOf(framework, counts, publishers.eligible, reviewersEligible);
  const viewerConflict = me.canPublish ? publisherConflictOf(userId) : null;
  const next = nextActionOf(framework, counts, me, mine.size, publishers.eligible, viewerConflict, reviewersEligible);
  const reviewerNote = !me.canReview ? null
    : queue === null ? "Your review queue could not be read just now, so no decision is offered here."
    : queue.appointments.length === 0 ? "You hold the clinical review right but no active Clinical Content Reviewer appointment, so nothing is offered for decision."
    : !queue.appointments.some(a => a.scopes.length) ? "Your reviewer appointment has no scope yet (Clinical review governance sets it), so nothing is offered for decision."
    : null;
  return { framework, domains, counts, components: view.components, me, stages, next, actors: { reviewers, publishers, authors }, history, reviewerNote, clinicalReadable: view.clinicalReadable, viewerId: userId };
}

/** The index: every shared framework with its counts, for the landing page. */
export async function loadGovernanceIndex(admin: any, userId: string, me: Me): Promise<{ id: string; code: string | null; name: string; pubStatus: string; total: number; approved: number; inReview: number; ready: number; changes: number; mine: number; pending: boolean }[] | null> {
  const [view, queue, pending] = await Promise.all([loadAuthoringView(admin) as Promise<AuthoringView | null>, me.canReview ? reviewQueue(admin, userId) : Promise.resolve(null), rows(admin.from("content_approvals").select("framework_id").eq("status", "pending"))]);
  if (!view) return null;
  const mineIds = new Set((queue?.items ?? []).filter(i => i.kind === "competency").map(i => i.competencyId));
  const pendingIds = new Set((pending ?? []).map((p: any) => p.framework_id));
  return view.frameworks.map(f => {
    const comps = f.domains.flatMap(d => d.competencies);
    const st = comps.map(c => eligibilityOf(c.clinical, f.pubStatus));
    const editable = EDITABLE.has(f.pubStatus);
    return {
      id: f.id, code: f.code, name: f.name, pubStatus: f.pubStatus, total: comps.length,
      approved: st.filter(s => s === "approved").length, inReview: st.filter(s => s === "in_review").length, ready: st.filter(s => s === "eligible").length,
      changes: st.filter(s => s === "changes_requested" || s === "unreadable").length,
      mine: comps.filter((c, i) => (me.canReview && mineIds.has(c.id)) || (me.canAuthor && editable && (st[i] === "eligible" || st[i] === "changes_requested"))).length,
      pending: pendingIds.has(f.id),
    };
  });
}
