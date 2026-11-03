/* eslint-disable @typescript-eslint/no-explicit-any */
// UNIFIED-GOVERNANCE-V1 (owner GO 3 Nov 2026), section 4: My Governance Inbox. ONE list of what this person can act on
// now, aggregated across Holdings products and all of their active appointments, read from the EXISTING review queues
// and governance records (the Checklist Studio lifecycle, the competency clinical review queue and framework
// publication). It decides nothing: every row links to the governed item, where the same gated route and database
// guard take the action. A task shows the content, its type, its scope, its status, the required action, the deadline
// where one is configured, and ONE contextual action. Where the person cannot act, the reason and the position or
// authority required are said instead of a button. Deadlines are optional (owner, 3 Nov): no deadline system exists yet,
// so a task carries one only when its record does, and nothing about deadlines or overdue work is drawn until one is configured.
import type { createAdminClient } from "@/lib/supabase/server";
import { listGovernedVersions, nameMap, reviewOverview, loadTrail, type GovernedVersionRow } from "@/lib/assessment/studio/read";
import { loadHolders, latestReturn } from "@/lib/assessment/studio/pathway-data";
import { standingOf } from "@/lib/assessment/studio/pathway";
import { CAP, POLICY_CAP, capabilitiesFor } from "@/lib/assessment/studio/transitions";
import { KIND_LABEL, STATE_LABEL, type DefinitionKind } from "@/lib/assessment/studio/types";
import { loadGovernanceIndex, type IndexRow } from "@/lib/competency/governance-workspace";

type Admin = ReturnType<typeof createAdminClient>;

export type InboxActionKind = "review_approve" | "publish" | "complete_submit" | "revise" | "decide_publication" | "put_forward" | "review_framework" | "open";
export interface InboxTask {
  id: string;
  title: string;
  /** "Checklist", "Response scale", "Competency framework", ... */
  type: string;
  scope: string;
  status: string;
  /** The required action, in words: "Review & approve", "Publish v1", "Complete and submit v1". */
  required: string;
  /** The one contextual action for THIS person, or null with `reason` saying why not and who can. */
  action: { kind: InboxActionKind; label: string; href: string } | null;
  reason: string | null;
  deadline: string | null;
  /** who / when context: "Submitted by X, 3 Nov" */
  detail: string | null;
  href: string;
  at: string | null;
}

export interface InboxModel {
  mine: InboxTask[];
  inProgress: InboxTask[];
  returned: InboxTask[];
  recentlyPublished: InboxTask[];
  overdue: InboxTask[];
  /** Sources that could not be read, said on screen. */
  notes: string[];
  /** What this person holds, in words, so the empty inbox explains itself. */
  standing: string;
}

export interface InboxViewer { userId: string; caps: string[]; isOwner: boolean }

const HOLDINGS = "Competen Holdings";
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

function versionTitle(v: GovernedVersionRow) { return `${v.code} ${v.name}, v${v.versionNo}`; }

/** Pure: sort tasks newest first by their timestamp. */
export function newestFirst<T extends { at: string | null }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

/** Pure: the required action for a Studio version, by state (spec section 5). */
export function requiredFor(state: string, versionNo: number): string {
  switch (state) {
    case "draft": return `Complete and submit v${versionNo} for review`;
    case "in_review": return `Review & approve v${versionNo}, or request changes`;
    case "approved": return `Publish v${versionNo}`;
    case "published": return "Create a new version to change it";
    default: return "";
  }
}

export async function loadInbox(admin: Admin, me: InboxViewer): Promise<InboxModel> {
  const notes: string[] = [];
  const caps = me.caps;
  const holdsStudio = [CAP.view, CAP.author, CAP.review, CAP.publish, POLICY_CAP.view, POLICY_CAP.author, POLICY_CAP.review, POLICY_CAP.publish].some((c) => caps.includes(c));
  const mine: InboxTask[] = [], inProgress: InboxTask[] = [], returned: InboxTask[] = [], recentlyPublished: InboxTask[] = [], overdue: InboxTask[] = [];

  // ---- Checklist Studio: every definition kind, by the same readers the Studio uses -----------------------------
  if (holdsStudio) {
    try {
      const [inReview, versions, asmtHolders, policyHolders] = await Promise.all([
        reviewOverview(admin, me.userId, caps),
        listGovernedVersions(admin, { states: ["draft", "approved", "published"], limit: 400 }),
        loadHolders(admin),
        loadHolders(admin, "policy"),
      ]);
      const holdersFor = (kind: DefinitionKind) => (kind === "policy" ? policyHolders : asmtHolders);
      const people = await nameMap(admin, [...inReview.map((q) => q.submittedBy), ...versions.flatMap((v) => [...v.authoredBy, v.submittedBy, v.publishedBy])]);
      const who = (id: string | null | undefined) => (id ? people[id] ?? "a person" : "");

      for (const q of inReview) {
        const title = `${q.code} ${q.definitionName}, v${q.versionNo}`;
        const base = { id: `asmt:${q.versionId}`, title, type: KIND_LABEL[q.kind], scope: HOLDINGS, status: STATE_LABEL.in_review, required: requiredFor("in_review", q.versionNo), deadline: null, href: q.href, at: q.submittedAt, detail: `Submitted by ${who(q.submittedBy) || "an author"}${q.submittedAt ? `, ${day(q.submittedAt)}` : ""}. Needs ${q.need} independent governance approval${q.need === 1 ? "" : "s"}, has ${q.governance}.` };
        const canGov = q.viewer.canGovern && !q.viewer.decidedGovernance;
        const canDom = q.viewer.canDomain && q.requiresDomainReview && !q.viewer.decidedDomain;
        if (q.viewer.independent && (canGov || canDom)) {
          mine.push({ ...base, action: { kind: "review_approve", label: "Review & approve", href: q.href }, reason: null });
        } else {
          const reviewers = standingOf("review", { kind: q.kind, holders: holdersFor(q.kind), involved: q.involved, decisions: [], contentHash: q.contentHash });
          const names = reviewers.actors.filter((a) => a.eligible).map((a) => a.name);
          const reason = !q.viewer.independent ? `You authored, edited or submitted this version, so another appointee must approve it.${names.length ? ` Who can: ${names.join(", ")}.` : reviewers.note ? ` ${reviewers.note}` : ""}`
            : q.viewer.decidedGovernance || q.viewer.decidedDomain ? `You have already decided on this exact content.${names.length ? ` Still to decide: ${names.join(", ")}.` : ""}`
            : `Needs the right to review ${q.kind === "policy" ? "policies" : "checklists"}.${names.length ? ` Who can: ${names.join(", ")}.` : reviewers.note ? ` ${reviewers.note}` : ""}`;
          inProgress.push({ ...base, action: null, reason });
        }
      }

      const byKind = new Map<DefinitionKind, GovernedVersionRow[]>();
      for (const v of versions) byKind.set(v.kind, [...(byKind.get(v.kind) ?? []), v]);
      const returnedIds = new Set<string>();
      const returnNote = new Map<string, { by: string | null; note: string | null }>();
      for (const [kind, vs] of byKind) {
        const drafts = vs.filter((v) => v.state === "draft" && (v.authoredBy.includes(me.userId) || caps.includes(capabilitiesFor(kind).author)));
        if (!drafts.length) continue;
        const trail = await loadTrail(admin, kind, drafts.map((v) => v.id));
        for (const v of drafts) {
          const r = latestReturn(trail.events.filter((e) => e.subject_id === v.id), trail.decisions.filter((d) => d.version_id === v.id));
          if (r) { returnedIds.add(v.id); returnNote.set(v.id, r); }
        }
      }
      const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
      for (const v of versions) {
        const title = versionTitle(v);
        const type = KIND_LABEL[v.kind];
        const minesDraft = v.authoredBy.includes(me.userId);
        const K = capabilitiesFor(v.kind);
        if (v.state === "draft") {
          const r = returnNote.get(v.id);
          const task: InboxTask = {
            id: `asmt:${v.id}`, title, type, scope: HOLDINGS, status: r ? "Returned for correction" : STATE_LABEL.draft, required: requiredFor("draft", v.versionNo),
            action: minesDraft && caps.includes(K.author) ? { kind: r ? "revise" : "complete_submit", label: r ? "Revise and resubmit" : "Open and submit", href: v.href } : null,
            reason: minesDraft && !caps.includes(K.author) ? "You authored this draft but hold no author capability now: an appointment with the authoring right is needed to edit or submit it." : !minesDraft ? `Authored by ${v.authoredBy.map(who).filter(Boolean).join(", ") || "an author"}.` : null,
            deadline: null, href: v.href, at: v.createdAt,
            detail: r ? `Returned${r.by ? ` by ${who(r.by)}` : ""}${r.note ? `: "${r.note.slice(0, 160)}"` : ""}.` : `Authored by ${v.authoredBy.map(who).filter(Boolean).join(", ") || "an author"}, ${day(v.createdAt)}.`,
          };
          if (r && minesDraft) returned.push(task);
          else if (minesDraft) mine.push(task);
          else if (caps.includes(K.author)) inProgress.push(task);
        } else if (v.state === "approved") {
          const can = caps.includes(K.publish);
          const publishers = standingOf("publish", { kind: v.kind, holders: holdersFor(v.kind), involved: [], decisions: [], contentHash: null });
          const names = publishers.actors.map((a) => a.name);
          const task: InboxTask = {
            id: `asmt:${v.id}`, title, type, scope: HOLDINGS, status: STATE_LABEL.approved, required: requiredFor("approved", v.versionNo),
            action: can ? { kind: "publish", label: `Publish v${v.versionNo}`, href: v.href } : null,
            reason: can ? null : `Publishing needs the right to publish ${v.kind === "policy" ? "policies" : "checklists"}.${names.length ? ` Who can: ${names.join(", ")}.` : publishers.note ? ` ${publishers.note}` : ""}`,
            deadline: null, href: v.href, at: v.submittedAt ?? v.createdAt,
            detail: `Independently approved on the exact content${minesDraft ? ": you authored it and may publish the approved version" : ""}.`,
          };
          (can ? mine : inProgress).push(task);
        } else if (v.state === "published" && v.publishedAt && v.publishedAt >= cutoff) {
          recentlyPublished.push({ id: `asmt:${v.id}`, title, type, scope: HOLDINGS, status: STATE_LABEL.published, required: requiredFor("published", v.versionNo), action: { kind: "open", label: "Open", href: v.href }, reason: null, deadline: null, href: v.href, at: v.publishedAt, detail: `Published by ${who(v.publishedBy) || "a publisher"}, ${day(v.publishedAt)}.` });
        }
      }
    } catch (e: any) {
      notes.push(`The Checklist Studio queue could not be read just now${e?.message ? ` (${String(e.message).slice(0, 120)})` : ""}.`);
    }
  }

  // ---- Competency frameworks: the clinical review queue and publication requests ---------------------------------
  const fwMe = { canAuthor: caps.includes("hq.quality.competency.author"), canReview: caps.includes("hq.quality.clinical.approve"), canPublish: caps.includes("hq.quality.competency.publish") };
  if (fwMe.canAuthor || fwMe.canReview || fwMe.canPublish) {
    try {
      const rows: IndexRow[] | null = await loadGovernanceIndex(admin, me.userId, fwMe);
      if (rows === null) notes.push("The competency framework index could not be read just now.");
      for (const f of rows ?? []) {
        const href = `/super-admin/competencies/governance/${f.id}`;
        const title = `${f.code ?? ""} ${f.name}`.trim();
        const type = "Competency framework";
        if (fwMe.canReview && f.mine > 0) {
          mine.push({ id: `fw:review:${f.id}`, title, type, scope: HOLDINGS, status: "In review", required: `Review ${f.mine} competenc${f.mine === 1 ? "y" : "ies"} at their exact version`, action: { kind: "review_framework", label: `Start focused review (${f.mine})`, href: `${href}?mode=review` }, reason: null, deadline: null, href, at: f.milestones.forwarded, detail: `${f.counts.inReview} awaiting independent review across the framework.` });
        } else if (f.counts.inReview > 0) {
          inProgress.push({ id: `fw:inreview:${f.id}`, title, type, scope: HOLDINGS, status: "In review", required: `${f.counts.inReview} competenc${f.counts.inReview === 1 ? "y" : "ies"} await independent review`, action: null, reason: fwMe.canReview ? "None of them is in your queue: outside your scope or you contributed to them." : "Needs an appointed reviewer whose scope covers this framework.", deadline: null, href, at: f.milestones.forwarded, detail: null });
        }
        if (f.pending) {
          const canDecide = fwMe.canPublish;
          const task: InboxTask = { id: `fw:pub:${f.id}`, title, type, scope: HOLDINGS, status: "Publication requested", required: "Decide publication", action: canDecide ? { kind: "decide_publication", label: "Decide publication", href } : null, reason: canDecide ? null : "Needs the right to publish competency frameworks, held by an independent publisher.", deadline: null, href, at: f.pending.submittedAt, detail: `Requested${f.pending.byName ? ` by ${f.pending.byName}` : ""}${f.pending.submittedAt ? `, ${day(f.pending.submittedAt)}` : ""}.` };
          (canDecide ? mine : inProgress).push(task);
        }
        if (fwMe.canAuthor && f.counts.changes > 0) {
          returned.push({ id: `fw:changes:${f.id}`, title, type, scope: HOLDINGS, status: "Returned for correction", required: `Revise ${f.counts.changes} returned competenc${f.counts.changes === 1 ? "y" : "ies"} and put them forward again`, action: { kind: "revise", label: "Open the framework", href }, reason: null, deadline: null, href, at: f.milestones.decided?.at ?? null, detail: "A reviewer returned them with a note." });
        }
        if (fwMe.canAuthor && f.counts.ready > 0 && f.pubStatus !== "published") {
          mine.push({ id: `fw:ready:${f.id}`, title, type, scope: HOLDINGS, status: "Draft", required: `Put ${f.counts.ready} competenc${f.counts.ready === 1 ? "y" : "ies"} forward for clinical review`, action: { kind: "put_forward", label: "Open the governance workspace", href }, reason: null, deadline: null, href, at: f.milestones.created, detail: null });
        }
        if (f.milestones.published && f.milestones.published.at >= new Date(Date.now() - 30 * 86400000).toISOString()) {
          recentlyPublished.push({ id: `fw:published:${f.id}`, title, type, scope: HOLDINGS, status: "Published", required: "Create a revision draft to change it", action: { kind: "open", label: "Open", href }, reason: null, deadline: null, href, at: f.milestones.published.at, detail: `Version ${f.milestones.published.version ?? f.version}${f.milestones.published.byName ? ` by ${f.milestones.published.byName}` : ""}, ${day(f.milestones.published.at)}.` });
        }
      }
    } catch (e: any) {
      notes.push(`The competency framework index could not be read just now${e?.message ? ` (${String(e.message).slice(0, 120)})` : ""}.`);
    }
  }

  const held = [
    caps.includes(CAP.author) ? "author checklists" : "", caps.includes(CAP.review) ? "review checklists" : "", caps.includes(CAP.publish) ? "publish checklists" : "",
    caps.includes(POLICY_CAP.author) ? "author policies" : "", caps.includes(POLICY_CAP.review) ? "review policies" : "", caps.includes(POLICY_CAP.publish) ? "publish policies" : "",
    fwMe.canAuthor ? "author competencies" : "", fwMe.canReview ? "give clinical approval" : "", fwMe.canPublish ? "publish frameworks" : "",
  ].filter(Boolean);
  const standing = held.length ? `Through your appointments you can ${held.join(", ")}.` : me.isOwner
    ? "You are a platform owner with no governance appointment: you can look at everything, and act only through an appointment that holds the capability."
    : "Your appointments hold no content-governance capability, so nothing is assigned to you here.";

  return { mine: newestFirst(mine), inProgress: newestFirst(inProgress), returned: newestFirst(returned), recentlyPublished: newestFirst(recentlyPublished).slice(0, 20), overdue, notes, standing };
}
