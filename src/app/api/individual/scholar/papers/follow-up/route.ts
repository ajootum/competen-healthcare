export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isUuid } from "@/lib/individual/scholar/store";
import { followUp } from "@/lib/individual/scholar/exam-service";
import { QUESTION_MAX } from "@/lib/individual/scholar/config";

export const dynamic = "force-dynamic";

// POST /api/individual/scholar/papers/follow-up -- Body { answerId, ask }. A follow-up question about a saved answer,
// answered only from that answer's evidence and checked. Not stored (as Learn's explanations).
export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const ask = typeof body?.ask === "string" ? body.ask.trim() : "";
  if (!isUuid(body?.answerId)) return NextResponse.json({ error: "That answer could not be found." }, { status: 404 });
  if (!ask || ask.length > QUESTION_MAX) return NextResponse.json({ error: `Ask a question of up to ${QUESTION_MAX} characters.` }, { status: 400 });
  const r = await followUp(ctx, req, { answerId: body.answerId, ask });
  return NextResponse.json(r.body, { status: r.status });
}