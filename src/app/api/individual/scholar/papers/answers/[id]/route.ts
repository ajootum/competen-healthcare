import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isUuid } from "@/lib/individual/scholar/store";
import { answerToRevision } from "@/lib/individual/scholar/exam-service";
import { deleteExamAnswer } from "@/lib/individual/scholar/exam-store";

export const dynamic = "force-dynamic";

// POST /api/individual/scholar/papers/answers/[id] -- turn a saved suggested answer into a flashcard on the student's
// spaced-review schedule (the existing revision store). Idempotent.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That answer could not be found." }, { status: 404 });
  const r = await answerToRevision(ctx, id);
  return NextResponse.json(r.body, { status: r.status });
}

// DELETE -- remove a saved answer or guide. A revision card already made from it stays.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await params;
  if (!isUuid(id) || !(await deleteExamAnswer(ctx.admin, ctx.userId, id))) return NextResponse.json({ error: "That answer could not be found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}