export const maxDuration = 120;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isUuid } from "@/lib/individual/scholar/store";
import { revisionGuide } from "@/lib/individual/scholar/exam-service";

export const dynamic = "force-dynamic";

// POST /api/individual/scholar/papers/[materialId]/guide -- a revision guide written from the paper's saved answers
// and their evidence, checked like every Scholar answer, and saved for the student.
export async function POST(req: Request, { params }: { params: Promise<{ materialId: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { materialId } = await params;
  if (!isUuid(materialId)) return NextResponse.json({ error: "That paper could not be found." }, { status: 404 });
  const r = await revisionGuide(ctx, req, materialId);
  return NextResponse.json(r.body, { status: r.status });
}