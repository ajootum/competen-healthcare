import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { getLearningSession, getPassage, isUuid, listArtefacts, listCheckAttempts, recordLearningEvent } from "@/lib/individual/scholar/store";
import { parseDeeperAnswer } from "@/lib/individual/scholar/deeper-format";
import { GUIDE_COPY, guideStepCount, guideTeachStepOf, guideVerdictOf, guidedLessonOutcome } from "@/lib/individual/scholar/guide-me";
import { coversLesson } from "@/lib/individual/scholar/learn-journey";
import { sectionProfile } from "@/lib/individual/scholar/learn";
import { questionText } from "@/lib/individual/scholar/teach-format";

// Request-time only: it reads the session and writes a learning event.
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/learn/guide-complete { sessionId, step }. OWNER DECISION SCHOLAR-TEACHING-P1-RELEASE-001 item 3.
// The learner reached the end of a guided lesson. The server decides what that means from its own records, never from what the page says: every step's teaching saved, and each step's kept answers
// (guide-me.ts guidedLessonOutcome). When complete, the lesson is recorded as taught and, if anything was answered, with the guided check's result. Step results were kept as they were judged. No AI.
// A reply of complete: false leaves the lesson as it was, and says so.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const [body, policy] = await Promise.all([req.json().catch(() => ({})), loadIndividualPolicy(ctx.admin)]);
  if (!policy.scholarGuideMeAdaptive) return NextResponse.json({ error: "That way of learning is not offered here." }, { status: 403 });
  const sessionId = isUuid(body?.sessionId) ? String(body.sessionId) : null;
  const step = Number.isInteger(body?.step) && Number(body.step) >= 0 ? Number(body.step) : null;
  if (!sessionId || step === null) return NextResponse.json({ error: "Choose a lesson." }, { status: 400 });
  const s = await getLearningSession(ctx.admin, ctx.userId, sessionId);
  if (!s.ok) return NextResponse.json({ error: "Your session could not be read just now." }, { status: 503 });
  const here = s.data?.steps.find(x => x.step === step);
  if (!here || !here.sections.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const chunkIds = here.sections.map(x => x.chunkId);
  // The same count the act route uses: the lesson's own headings.
  const passages = (await Promise.all(chunkIds.map(id => getPassage(ctx.admin, ctx.userId, id)))).filter((p): p is NonNullable<typeof p> => !!p);
  const of = guideStepCount(new Set(passages.map(p => sectionProfile(p.content).heading).filter(Boolean)).size || 1);
  const [saved, kept] = await Promise.all([
    listArtefacts(ctx.admin, ctx.userId, { chunkIds, limit: 40 }),
    listCheckAttempts(ctx.admin, ctx.userId, { sessionId, step, limit: 100 }),
  ]);
  if (!saved.ok || !kept.ok) return NextResponse.json({ error: "Your guided lesson could not be read just now." }, { status: 503 });
  const lesson = { sessionId, step };
  const steps = new Map<number, string>();
  for (const a of saved.data) {
    const n = guideTeachStepOf(a.promptVersion);
    if (n === null || !coversLesson(a.sources, chunkIds, { row: a, lesson })) continue;
    if (!steps.has(n)) steps.set(n, parseDeeperAnswer(a.content)?.questions[0]?.text ?? GUIDE_COPY.fallbackQuestion);
  }
  const checks = kept.data.map(c => ({ question: c.question, verdict: c.response?.verdict ?? null, next: c.response?.feedback?.next ?? null }));
  const results = Array.from({ length: of }, (_, i) => (steps.has(i) ? guideVerdictOf(questionText(steps.get(i)!), checks) : null));
  const outcome = guidedLessonOutcome(Array.from({ length: of }, (_, i) => i).filter(i => steps.has(i)).map(i => results[i]), of);
  if (!outcome.complete) return NextResponse.json({ complete: false, of, taught: steps.size, verdict: null });
  if (policy.scholarLearningHistory === "record") {
    await recordLearningEvent(ctx.admin, ctx.userId, { sessionId, step, action: "explain", verdict: null, chunkIds });
    if (outcome.verdict) await recordLearningEvent(ctx.admin, ctx.userId, { sessionId, step, action: "clarify", verdict: outcome.verdict, chunkIds });
  }
  return NextResponse.json({ complete: true, of, verdict: outcome.verdict, results });
}
