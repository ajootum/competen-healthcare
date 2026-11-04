import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { deletePlay, isPlayKind, viewPlay } from "@/lib/individual/scholar/clinical-routes";
import { audit } from "@/lib/individual/scholar/http";

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

// DELETE /api/individual/scholar/clinical/sessions/[kind]/[id] -- D05: the learner deletes one of their own attempts, with
// its simulated conversation and kept record (database cascade). Behind scholar_case_attempt_delete (default off).
export async function DELETE(_req: Request, ctx2: { params: Promise<{ kind: string; id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { kind, id } = await ctx2.params;
  if (!isPlayKind(kind)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const r = await deletePlay(ctx.admin, ctx.userId, kind, id);
  if (r === "deleted") await audit(ctx, "individual_scholar_case_attempt_deleted", kind === "private" ? "individual_scholar_case_session" : "case_library_session", id, { kind });
  if (r === "deleted") return NextResponse.json({ deleted: true });
  if (r === "off") return NextResponse.json({ error: "Deleting a case attempt is not switched on." }, { status: 403 });
  if (r === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ error: "The attempt could not be deleted just now." }, { status: 500 });
}
