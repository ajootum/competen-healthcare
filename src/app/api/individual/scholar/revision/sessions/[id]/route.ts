import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { getRevisionSession, revisionPool, updateRevisionSession, type QuestionRow } from "@/lib/individual/scholar/store";
import { audit } from "@/lib/individual/scholar/http";
import { REVISION_FORMATS, type Marking } from "@/lib/individual/scholar/config";
import { feedbackView, revisionItemView } from "@/lib/individual/scholar/revision-view";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/revision/sessions/[id] -- COMPETEN-SCHOLAR-REVISION-01 R1 and R4: come back to a session.
//
// GET  the session, its questions (learner views) in order, what is answered, and -- where feedback is immediate or
//      the session is finished -- each answer's feedback. A student who left for Teach Me returns to the same place.
// PATCH { complete: true } finishes it and returns every answer's feedback (end-of-session feedback).
// No AI in either. Owner-keyed: another person's session id answers 404.

async function load(ctx: { admin: unknown; userId: string }, id: string) {
  const s = await getRevisionSession(ctx.admin, ctx.userId, id);
  if (!s.ok) return { error: NextResponse.json({ error: "Your revision session could not be read just now." }, { status: 503 }) };
  if (!s.data) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const pool = await revisionPool(ctx.admin, ctx.userId, { kinds: [...REVISION_FORMATS, "case"] });
  if (!pool.ok) return { error: NextResponse.json({ error: "Your saved questions could not be read just now." }, { status: 503 }) };
  const byId = new Map(pool.data.questions.map(q => [q.id, q]));
  // A question removed with its material leaves the session; the rest stay in order.
  const questions = s.data.questionIds.map(qid => byId.get(qid)).filter((q): q is QuestionRow => !!q);
  return { s: s.data, questions };
}

function view(s: NonNullable<Awaited<ReturnType<typeof load>>["s"]>, questions: QuestionRow[], showFeedback: boolean) {
  const answered = new Map(s.attempts.map(a => [a.questionId, a]));
  return {
    session: { id: s.session.id, mode: s.session.mode, feedback: s.session.feedback, status: s.session.status, total: questions.length, position: Math.min(s.session.position, questions.length) },
    items: questions.map(revisionItemView),
    answered: questions.filter(q => answered.has(q.id)).map(q => {
      const a = answered.get(q.id)!;
      return { questionId: q.id, ...(showFeedback ? { feedback: feedbackView(q, { correct: a.correct, score: a.score, marking: a.marking as Marking }) } : {}) };
    }),
  };
}

export async function GET(_req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const l = await load(ctx, (await ctx2.params).id);
  if ("error" in l) return l.error;
  await updateRevisionSession(ctx.admin, ctx.userId, l.s.session.id, {});
  return NextResponse.json(view(l.s, l.questions, l.s.session.feedback === "immediate" || l.s.session.status === "completed"));
}

export async function PATCH(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if (body?.complete !== true) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  const l = await load(ctx, (await ctx2.params).id);
  if ("error" in l) return l.error;
  if (l.s.session.status !== "completed") {
    await updateRevisionSession(ctx.admin, ctx.userId, l.s.session.id, { completed: true });
    await audit(ctx, "individual_scholar_revision_completed", "individual_scholar_revision_session", l.s.session.id, {
      answered: l.s.attempts.length, of: l.questions.length, correct: l.s.attempts.filter(a => a.correct).length,
    });
  }
  const done = view({ ...l.s, session: { ...l.s.session, status: "completed" } }, l.questions, true);
  const marked = l.s.attempts;
  return NextResponse.json({
    ...done,
    summary: {
      answered: marked.length, of: l.questions.length, correct: marked.filter(a => a.correct).length,
      byMarking: { deterministic: marked.filter(a => a.marking === "deterministic").length, self_graded: marked.filter(a => a.marking === "self_graded").length, ai_evaluation: marked.filter(a => a.marking === "ai_evaluation").length },
    },
  });
}
