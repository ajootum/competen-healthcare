import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { individualAppEnabled } from "@/lib/individual/gate";
import { currentTraceId } from "@/lib/trace";
import { revokeIndividualInvitation } from "@/lib/individual/invitations";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/hq/individual/invitations/revoke -- withdraw an invitation that is still waiting. Body:
// { invitationId, reason }. The row stays as the record (378's trigger allows PENDING to REVOKED and nothing
// else). The identity the invitation created is NOT deleted: it holds nothing, and deleting unused accounts
// is a separate owner decision.

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.individual.pilot.grant"]);
  if (isHqRefusal(ctx)) return ctx;
  if (!(await individualAppEnabled(ctx.admin))) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const invitationId = typeof body?.invitationId === "string" ? body.invitationId.trim() : "";
  const reason = typeof body?.reason === "string" ? body.reason : "";
  const out = await revokeIndividualInvitation(ctx.admin, invitationId, ctx.userId, reason);
  if (!out.ok) return NextResponse.json({ error: { code: out.code, message: out.message } }, { status: out.status });

  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null,
    action: "individual_invitation_revoked", entity_type: "individual_invitation", entity_id: invitationId,
    new_value: { reason: reason.trim() },
  }).then((r: unknown) => r, () => {});

  return NextResponse.json({ ok: true });
}
