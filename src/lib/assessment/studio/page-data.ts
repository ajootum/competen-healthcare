// Checklist Studio: what a version page needs to draw its lifecycle panel, from one call. Server only.
import type { createAdminClient } from "@/lib/supabase/server";
import { approvalStatus, availabilities, type ApprovalStatus, type Availabilities } from "./transitions";
import { involvedPeople, loadTrail, nameMap, requiredApprovals, buildTimeline } from "./read";
import type { DefinitionEventRow, DefinitionKind, LifecycleRow, ReviewDecisionRow, TimelineEntry } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

export interface LifecycleData {
  availability: Availabilities;
  approval: ApprovalStatus;
  decisions: ReviewDecisionRow[];
  timeline: TimelineEntry[];
  names: Record<string, string>;
  /** the raw definition events of this version (the pathway reads the latest return to draft from them) */
  events: DefinitionEventRow[];
  /** everyone who authored, edited or submitted this or an earlier version (asmt_version_people) */
  involved: string[];
}

export async function lifecycleData(admin: Admin, o: {
  kind: DefinitionKind; version: LifecycleRow & { risk?: "standard" | "high"; requires_domain_review?: boolean; delivery_modes?: string[] };
  actorId: string; caps: string[]; validationErrors: number; versionNos?: Record<string, number>;
}): Promise<LifecycleData> {
  const v = o.version;
  const [involved, trail, need] = await Promise.all([involvedPeople(admin, o.kind, v.id), loadTrail(admin, o.kind, [v.id]), requiredApprovals(admin)]);
  const input = {
    kind: o.kind, state: v.state, actorId: o.actorId, caps: o.caps, authoredBy: v.authored_by ?? [], editedBy: v.edited_by ?? [], involved,
    contentHash: v.content_hash, risk: v.risk ?? "standard", requiresDomainReview: Boolean(v.requires_domain_review), deliveryModes: v.delivery_modes ?? ["n/a"],
    decisions: trail.decisions, need, validationErrors: o.validationErrors,
  } as const;
  const names = await nameMap(admin, [...trail.events.map((e) => e.actor_id), ...trail.decisions.map((d) => d.reviewer_id), ...(v.authored_by ?? []), ...(v.edited_by ?? []), v.submitted_by, v.published_by]);
  return {
    availability: availabilities(input), approval: approvalStatus(input), decisions: trail.decisions,
    timeline: buildTimeline(trail.events, trail.decisions, o.versionNos ?? { [v.id]: v.version_no }), names, events: trail.events, involved,
  };
}
