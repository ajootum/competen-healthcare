import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { aiFeedbackAvailable, feedbackReasons, recordAiFeedback } from "@/lib/ai/outcomes";
import { FEEDBACK_TARGETS, resolveFeedbackTarget, type FeedbackTarget } from "@/lib/individual/scholar/feedback";

// Request-time only: it reads the session and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/individual/scholar/feedback -- COMPETEN-SCHOLAR-AI-OPT-01 s7, optional learner feedback on AI output.
//
// GET   { available }: whether feedback can be stored here (migration 600). The widget is not shown where it cannot,
//       so a learner is never offered a button that fails.
// POST  { target, ref, rating: "positive" | "negative", reasons? }. The output must be the caller's own (feedback.ts).
//       One view per learner and output: a second tap replaces the first. Codes only -- no free text is accepted.

export async function GET() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  return NextResponse.json({ available: await aiFeedbackAvailable(ctx.admin) });
}

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const target = (FEEDBACK_TARGETS as readonly string[]).includes(body?.target) ? (body.target as FeedbackTarget) : null;
  const rating = body?.rating === "positive" || body?.rating === "negative" ? body.rating : null;
  if (!target || !rating || typeof body?.ref !== "string") return NextResponse.json({ error: "That feedback could not be read." }, { status: 400 });
  const output = await resolveFeedbackTarget(ctx.admin, ctx.userId, target, body.ref);
  if (!output) return NextResponse.json({ error: "That could not be found." }, { status: 404 });
  const saved = await recordAiFeedback(ctx.admin, {
    userId: ctx.userId, product: "scholar", outputKind: output.kind, ref: `${target}:${body.ref}`, activity: output.activity,
    rating, reasons: feedbackReasons(body?.reasons), promptVersion: output.promptVersion, actionId: output.actionId,
  });
  if (saved === "ok") return NextResponse.json({ saved: true });
  return NextResponse.json({ error: "Your feedback could not be saved just now." }, { status: saved === "not_provisioned" ? 409 : 503 });
}
