import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { CAP } from "@/lib/assessment/studio/transitions";
import { nameMap, reviewQueue } from "@/lib/assessment/studio/read";

export const dynamic = "force-dynamic";

// GET /api/hq/checklist-studio/review -- Checklist Studio (S2). Review capability (the domain review right also opens it).
// The versions in review that THIS person may still decide: never one they authored, edited or submitted, and not one they already
// decided on its current content.

export async function GET() {
  const ctx = await hqApiGate([CAP.review, CAP.domainReview]);
  if (isHqRefusal(ctx)) return ctx;
  const queue = await reviewQueue(ctx.admin, ctx.userId, ctx.capabilities);
  const names = await nameMap(ctx.admin, queue.map((q) => q.submittedBy));
  return NextResponse.json({ queue, names });
}
