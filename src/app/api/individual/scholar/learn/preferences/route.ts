import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { getLearningPreference, setLearningPreference } from "@/lib/individual/scholar/store";
import { EXPLANATION_DEPTHS, isClassicLearnAction } from "@/lib/individual/scholar/config";
import { audit } from "@/lib/individual/scholar/http";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/learn/preferences -- COMPETEN-SCHOLAR-LEARN-01 L4, the student's own learning
// preferences: explanation depth and the action a session starts with. Own row only (414); erased with them.

export async function GET() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  return NextResponse.json({ preference: await getLearningPreference(ctx.admin, ctx.userId) });
}

export async function PUT(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const depth = (EXPLANATION_DEPTHS as readonly string[]).includes(body?.depth) ? body.depth : null;
  // The starting-action CHECK (migration 414) lists the seven original actions only.
  const defaultAction = isClassicLearnAction(body?.defaultAction) ? body.defaultAction : null;
  if (!depth || !defaultAction) return NextResponse.json({ error: "Choose a depth and a starting action." }, { status: 400 });
  const r = await setLearningPreference(ctx.admin, ctx.userId, { depth, defaultAction });
  if (r === "not_provisioned") return NextResponse.json({ error: "Learning preferences are not available here yet." }, { status: 409 });
  if (r === "failed") return NextResponse.json({ error: "Your preferences could not be saved just now." }, { status: 500 });
  await audit(ctx, "individual_scholar_learning_preference_set", "individual_scholar_learning_preference", null, { depth, default_action: defaultAction });
  return NextResponse.json({ ok: true });
}
