import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { deleteEvaluation, getEvaluation } from "@/lib/individual/scholar/store";
import { audit } from "@/lib/individual/scholar/http";

// Request-time only: it reads the release gate and the record, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/individual/scholar/evaluations/[id] -- COMPETEN-SCHOLAR-EVALUATION-01 E5.
// GET one of the student's evaluations as it was made: no AI, so it is always available. DELETE removes it (the
// student's right to remove their own record). Owner-keyed: another person's id answers 404.

export async function GET(_req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const r = await getEvaluation(ctx.admin, ctx.userId, (await ctx2.params).id);
  if (!r.ok) return NextResponse.json({ error: "Your evaluation could not be read just now." }, { status: 503 });
  if (!r.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ evaluation: r.data });
}

export async function DELETE(_req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const id = (await ctx2.params).id;
  if (!(await deleteEvaluation(ctx.admin, ctx.userId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await audit(ctx, "individual_scholar_evaluation_removed", "individual_scholar_evaluation", id, {});
  return NextResponse.json({ ok: true });
}
