import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isPlayKind, viewPlay } from "@/lib/individual/scholar/clinical-routes";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// GET /api/individual/scholar/clinical/sessions/[kind]/[id]?hints=1 -- CR5: come back to a case where it was left.
// The learner view only (tokens, the stages reached, the findings shown), the decisions answered with their feedback,
// and the debrief once finished. No AI. Another person's session answers 404.

export async function GET(req: Request, ctx2: { params: Promise<{ kind: string; id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { kind, id } = await ctx2.params;
  if (!isPlayKind(kind)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const v = await viewPlay(ctx.admin, ctx.userId, kind, id, new URL(req.url).searchParams.get("hints") === "1");
  return v ? NextResponse.json({ play: v }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
