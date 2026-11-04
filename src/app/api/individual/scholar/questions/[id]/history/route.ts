import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadQuestionHistory } from "@/lib/individual/scholar/question-history-data";
import { HISTORY_NOTE } from "@/lib/individual/scholar/question-history";

// Request-time only: it reads the session.
export const dynamic = "force-dynamic";

// GET /api/individual/scholar/questions/[id]/history -- SQIE-CLOSE-2026-11 WS-I. One of the caller's own questions, with every
// attempt at it across practice, Revise sessions, adaptive and mock exams and Check your understanding, and the exam-paper answers
// it was made from, each with what it was marked against (question-history.ts). Owner-keyed reads only: no AI, no allowance, no
// write. A question that is not the caller's is 404. Formative: a practice record, never an assessment or competence.

export async function GET(_req: Request, route: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const r = await loadQuestionHistory(ctx.admin, ctx.userId, (await route.params).id);
  if (!r.ok) return NextResponse.json({ error: "Your question history could not be read just now." }, { status: 503 });
  if (!r.data) return NextResponse.json({ error: "That question could not be found." }, { status: 404 });
  return NextResponse.json({ history: r.data, note: HISTORY_NOTE });
}
