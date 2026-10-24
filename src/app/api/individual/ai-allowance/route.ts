import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isExperienceKey } from "@/lib/individual/experiences";
import { getAiStanding } from "@/lib/ai/allowance";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// GET /api/individual/ai-allowance?experience=scholar|professional -- COMPETEN-AI-FAIR-USE-01.
//
// The person's own AI standing for one experience: service level, a remaining band, when it renews, and what
// each activity may do now. For client components that show Learning Continuity. Read only, for the signed-in
// person: there is no way to send an allowance, a balance or an entitlement here, and no other person's id.

export async function GET(req: Request) {
  const experience = new URL(req.url).searchParams.get("experience");
  const known = isExperienceKey(experience);
  // The guard first: with the release gate off this route does not exist (404).
  const ctx = await requireIndividualContext(known ? experience : undefined);
  if (isGuardRefusal(ctx)) return ctx;
  if (!known) return NextResponse.json({ error: "Unknown experience" }, { status: 400 });
  return NextResponse.json({ standing: await getAiStanding(ctx.admin, { userId: ctx.userId, product: experience }) });
}
