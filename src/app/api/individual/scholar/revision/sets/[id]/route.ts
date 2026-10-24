import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { deleteRevisionSet } from "@/lib/individual/scholar/store";
import { audit } from "@/lib/individual/scholar/http";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// DELETE /api/individual/scholar/revision/sets/[id] -- remove a saved revision set. Its questions, answers and cards
// stay (they are the student's revision history); sessions already played keep their own snapshot. Owner-keyed.
export async function DELETE(_req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const id = (await ctx2.params).id;
  if (!(await deleteRevisionSet(ctx.admin, ctx.userId, id))) return NextResponse.json({ error: "The set could not be removed just now." }, { status: 500 });
  await audit(ctx, "individual_scholar_revision_set_deleted", "individual_scholar_revision_set", id, {});
  return NextResponse.json({ ok: true });
}
