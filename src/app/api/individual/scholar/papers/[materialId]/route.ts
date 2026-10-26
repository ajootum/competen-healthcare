import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isUuid } from "@/lib/individual/scholar/store";
import { deleteExamPaper } from "@/lib/individual/scholar/exam-store";
import { audit } from "@/lib/individual/scholar/http";

export const dynamic = "force-dynamic";

// DELETE /api/individual/scholar/papers/[materialId] -- stop studying a material as a paper. Its questions and saved
// answers are removed with it; the material itself, and any revision cards made from answers, stay.
export async function DELETE(_req: Request, { params }: { params: Promise<{ materialId: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { materialId } = await params;
  if (!isUuid(materialId)) return NextResponse.json({ error: "That paper could not be found." }, { status: 404 });
  const r = await deleteExamPaper(ctx.admin, ctx.userId, materialId);
  if (r === "not_found") return NextResponse.json({ error: "That paper could not be found." }, { status: 404 });
  if (r === "failed") return NextResponse.json({ error: "It could not be removed just now." }, { status: 503 });
  await audit(ctx, "individual_scholar_exam_paper_removed", "individual_scholar_exam_paper", materialId, {});
  return NextResponse.json({ ok: true });
}