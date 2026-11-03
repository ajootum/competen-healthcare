import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { CAP } from "@/lib/assessment/studio/transitions";
import { approveVersion, deleteDraft, duplicateVersion, publishVersion, retireVersion, returnToDraft } from "@/lib/assessment/studio/write";
import { submitForReview } from "@/lib/assessment/studio/service";
import { isUuid, kindOf, mustHold, refuse, respond } from "@/lib/assessment/studio/api";
import { readStageScale } from "@/lib/assessment/adapters/scholar/scales";

export const dynamic = "force-dynamic";

// POST /api/hq/checklist-studio/versions/[versionId]/transition -- Checklist Studio (S2).
// Body { kind?: instrument|scale|rule_template|layout_template|progression, action }. Each action needs its own capability:
//   submit | return | duplicate | delete   author          submit validates on the server first and answers 422 with the list
//   approve                                review or publish  (the database checks the independent decisions on the current hash)
//   publish | retire                       publish         (the database checks the publisher never authored, edited or submitted it)
// The gate admits the lowest right and each action re-checks its own. Every refusal of the database comes back in plain words.

export async function POST(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const ctx = await withOwnAppointments(await hqApiGate([CAP.author, CAP.review, CAP.publish]));
  if (isHqRefusal(ctx)) return ctx;
  const { versionId } = await params;
  const b = await req.json().catch(() => ({}));
  const kind = b?.kind === undefined ? "instrument" : kindOf(b.kind);
  if (!isUuid(versionId) || !kind) return refuse(400, "Choose a version.");
  const action = String(b?.action ?? "");
  const need: Record<string, string[]> = {
    submit: [CAP.author], return: [CAP.author], duplicate: [CAP.author], delete: [CAP.author],
    approve: [CAP.review, CAP.publish], publish: [CAP.publish], retire: [CAP.publish],
  };
  if (!need[action]) return refuse(400, "Unknown action.");
  if (!need[action].some((c) => ctx.capabilities.includes(c))) return mustHold(ctx, need[action][0]) ?? refuse(403, "Not allowed.");
  const a = ctx.admin;
  switch (action) {
    case "submit": {
      const r = await submitForReview(a, kind, versionId, ctx.userId, async (id) => (await readStageScale(a, id)) as never);
      return r.ok ? NextResponse.json({ ok: true, report: r.report }) : NextResponse.json({ error: r.error, report: "report" in r ? r.report : undefined }, { status: r.status });
    }
    case "return": return respond(await returnToDraft(a, kind, versionId, ctx.userId));
    case "approve": return respond(await approveVersion(a, kind, versionId));
    case "publish": return respond(await publishVersion(a, kind, versionId, ctx.userId));
    case "retire": return respond(await retireVersion(a, kind, versionId, ctx.userId));
    case "duplicate": return respond(await duplicateVersion(a, ctx.userId, versionId));
    case "delete": return respond(await deleteDraft(a, kind, versionId));
  }
  return refuse(400, "Unknown action.");
}
