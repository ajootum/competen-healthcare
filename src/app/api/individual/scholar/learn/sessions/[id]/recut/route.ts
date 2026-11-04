import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { getLearningSession, recutLearningSession } from "@/lib/individual/scholar/store";
import { parseRecutRequest, sameCut } from "@/lib/individual/scholar/learn-recut";
import { audit } from "@/lib/individual/scholar/http";

// Request-time only: it reads the session and writes it, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/learn/sessions/[id]/recut -- LEARNING-CLOSE-2026-11 D03 / LE-03 (migration 955).
//
// { steps: string[][], titles?: (string | null)[] }: the session's lessons re-cut (the SAME sections, regrouped, each in
// exactly one lesson) and the learner's own names for them. The caller's own session only (another person's id answers
// 404). The store's function (955) rewrites the lesson rows and re-points learning events, the learning position, lesson
// notes and lesson-linked artefacts in one transaction, by old-lesson containment. Nothing that hangs off the sections
// (questions, flashcards, attempts, citations, saved explanations, section notes) is touched. Where 955 is absent the
// answer is 409 and the session is unchanged. Never assessment evidence.

export async function POST(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  const body = await req.json().catch(() => ({}));
  const r = await getLearningSession(ctx.admin, ctx.userId, id);
  if (!r.ok || !r.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = parseRecutRequest(body, r.data.steps);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (sameCut(parsed.value, r.data.steps, r.data.lessonTitles)) return NextResponse.json({ error: "Nothing changed." }, { status: 400 });
  const out = await recutLearningSession(ctx.admin, ctx.userId, id, parsed.value.steps, parsed.value.titles.some(t => t !== null) ? parsed.value.titles : null);
  if (!out.ok) {
    if (out.error === "not_provisioned") return NextResponse.json({ error: "Changing the lessons is not available here yet. Your session is unchanged." }, { status: 409 });
    if (out.error === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (out.error === "invalid") return NextResponse.json({ error: "The lessons do not match this session. Reload the page and try again." }, { status: 400 });
    return NextResponse.json({ error: "Your lessons could not be changed just now. Nothing was changed." }, { status: 500 });
  }
  await audit(ctx, "individual_scholar_learning_recut", "individual_scholar_learning_session", id, { before: r.data.steps.length, ...out.summary });
  return NextResponse.json({ ok: true, currentStep: typeof out.summary.current_step === "number" ? out.summary.current_step : 0, summary: out.summary });
}
