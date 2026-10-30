// Evidence, optional web research and the answer itself.
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isUuid } from "@/lib/individual/scholar/store";
import { answerQuestion } from "@/lib/individual/scholar/exam-service";
import type { ExamEvidenceSource, ExamResearchDepth } from "@/lib/individual/policy";
import { parseRecoveryRequest } from "@/lib/individual/scholar/evidence-recovery";
import { QUESTION_MAX } from "@/lib/individual/scholar/config";

export const dynamic = "force-dynamic";

const SOURCES: readonly ExamEvidenceSource[] = ["notes", "library", "web"];
const DEPTHS: readonly ExamResearchDepth[] = ["quick", "standard", "deep"];

// POST /api/individual/scholar/papers/answer -- COMPETEN-SCHOLAR-EXAM-PAPERS-01. Body { questionId, attempt?, sources?, depth?, recovery? }.
// SCHOLAR-SQIE-02: recovery { id, mode, question } asks for the answer again from the evidence that recovery found. Only
// the id and mode are used: the server re-derives the evidence for its own question text (exam-service answerQuestion).
// A suggested answer with its explanation and cited evidence (notes, the Competen library and, where policy allows,
// live web research), checked and saved. The student's own attempt, when they made one first, is kept beside it.
export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if (!isUuid(body?.questionId)) return NextResponse.json({ error: "Choose a question." }, { status: 400 });
  const a = body?.attempt;
  const attempt = a && typeof a === "object"
    ? { option: typeof a.option === "string" && /^[A-J]$/.test(a.option) ? a.option : null, text: typeof a.text === "string" ? a.text.slice(0, 3000) : null }
    : null;
  const sources = Array.isArray(body?.sources) ? (body.sources as unknown[]).filter((s): s is ExamEvidenceSource => SOURCES.includes(s as ExamEvidenceSource)) : null;
  const depth = DEPTHS.includes(body?.depth) ? body.depth as ExamResearchDepth : null;
  const recovery = parseRecoveryRequest(body?.recovery, "notes_only", QUESTION_MAX);
  if (recovery && !recovery.ok) return NextResponse.json({ error: recovery.error }, { status: 400 });
  const r = await answerQuestion(ctx, req, { questionId: body.questionId, attempt, sources, depth, recovery: recovery?.value ?? null });
  return NextResponse.json(r.body, { status: r.status });
}