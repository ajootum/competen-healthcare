import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { CAP } from "@/lib/assessment/studio/transitions";
import { approveVersion, recordDecision } from "@/lib/assessment/studio/write";
import { isUuid, kindOf, mustHold, refuse, respond } from "@/lib/assessment/studio/api";

export const dynamic = "force-dynamic";

// POST /api/hq/checklist-studio/versions/[versionId]/decisions -- Checklist Studio (S2). Review capability.
// Body { kind?, reviewKind: governance|domain, decision: approved|rejected|changes_requested, rationale? }. A rejection or a request for
// changes needs a reason. The database refuses a reviewer who authored, edited or submitted this version or an earlier one, a decision
// on a version that is not in review, and a domain decision without the domain review right. The decision names the content hash it
// was made on, so changing the content later makes it stale.
// UNIFIED-GOVERNANCE-V1 (owner two-person workflow): { andApprove: true } with decision "approved" records the decision and then
// marks the version approved in the same interaction when the independent approvals now reach the required number. Two distinct
// records (the decision row, the approved event); one click. The database refuses the approval when the count is short.

export async function POST(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const ctx = await withOwnAppointments(await hqApiGate([CAP.review, CAP.domainReview]));
  if (isHqRefusal(ctx)) return ctx;
  const { versionId } = await params;
  const b = await req.json().catch(() => ({}));
  const kind = b?.kind === undefined ? "instrument" : kindOf(b.kind);
  if (!isUuid(versionId) || !kind) return refuse(400, "Choose a version.");
  if (b?.reviewKind !== "governance" && b?.reviewKind !== "domain") return refuse(400, "Choose the kind of review.");
  if (!["approved", "rejected", "changes_requested"].includes(b?.decision)) return refuse(400, "Choose a decision.");
  const denied = mustHold(ctx, b.reviewKind === "domain" ? CAP.domainReview : CAP.review);
  if (denied) return denied;
  const recorded = await recordDecision(ctx.admin, kind, versionId, ctx.userId, { reviewKind: b.reviewKind, decision: b.decision, rationale: typeof b.rationale === "string" ? b.rationale : null });
  if (!recorded.ok || b?.andApprove !== true || b.decision !== "approved") return respond(recorded);
  if (!(ctx.capabilities.includes(CAP.review) || ctx.capabilities.includes(CAP.publish))) return respond(recorded, { approved: false, note: "Your decision is recorded. Marking the version approved needs the review or publish capability." });
  const approved = await approveVersion(ctx.admin, kind, versionId);
  return respond(recorded, approved.ok ? { approved: true } : { approved: false, note: approved.error });
}
