import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { getQuestion, recordAttempt } from "@/lib/individual/scholar/store";
import { citeChunk } from "@/lib/individual/scholar/extract";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/attempts -- COMPETEN-IND-004 s3 (feedback) and s4 (missed → review card).
//
// Body { questionId, chosenIndex }. Records the answer and returns the feedback: right or wrong, the
// correct option, the rationale and the SOURCE -- the sentence quoted from the person's own notes, with
// the material and page it came from. The feedback is the stored question's own content: no AI call
// here, so nothing new and unchecked is said at the moment of marking.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const chosen = body?.chosenIndex;
  if (!Number.isInteger(chosen) || chosen < 0 || chosen > 3) return NextResponse.json({ error: "Choose one of the four answers." }, { status: 400 });
  const q = await getQuestion(ctx.admin, ctx.userId, body?.questionId);
  if (!q) return NextResponse.json({ error: "That question could not be found." }, { status: 404 });
  // REVISION-01: only the single-choice kinds are answered here. The 416 kinds are answered in a revision session.
  if ((q.kind !== "mcq" && q.kind !== "case") || q.correctIndex === null) return NextResponse.json({ error: "Answer this question in Revision." }, { status: 400 });

  const r = await recordAttempt(ctx.admin, ctx.userId, q, chosen);
  if (!r.ok) return NextResponse.json({ error: "Your answer could not be saved. Try again shortly." }, { status: 500 });
  return NextResponse.json({
    correct: r.correct,
    correctIndex: q.correctIndex,
    rationale: q.rationale,
    source: {
      quote: q.sourceQuote,
      citation: `${q.materialTitle}, ${q.ordinal !== null ? citeChunk({ ordinal: q.ordinal, pageFrom: q.pageFrom, pageTo: q.pageTo }, q.unit) : "source section"}`,
      materialId: q.materialId,
    },
    card: r.card,
  });
}
