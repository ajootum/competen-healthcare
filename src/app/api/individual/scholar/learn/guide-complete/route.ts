import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { getLearningSession, getPassage, isUuid, lessonEventTrail, listArtefacts, listCheckAttempts, recordLearningEvent } from "@/lib/individual/scholar/store";
import { parseDeeperAnswer } from "@/lib/individual/scholar/deeper-format";
import { GUIDE_COPY, guideStepCount, guideStepResults, guideTeachStepOf, guidedLessonOutcome, lessonResultIsNew } from "@/lib/individual/scholar/guide-me";
import { ARTEFACT_SOURCES_MAX, coversLesson } from "@/lib/individual/scholar/learn-journey";
import { sectionProfile } from "@/lib/individual/scholar/learn";
import { questionText } from "@/lib/individual/scholar/teach-format";

// Request-time only: it reads the session and writes a learning event.
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/learn/guide-complete { sessionId, step }. OWNER DECISION SCHOLAR-TEACHING-P1-RELEASE-001 item 3.
// The learner reached the end of a guided lesson. The server decides what that means from its own records, never from what the page says: every step's teaching saved, and each step's kept answers
// (guide-me.ts guidedLessonOutcome). When complete, the lesson is recorded as taught and, if anything was answered, with the guided check's result. Step results were kept as they were judged. No AI.
// A reply of complete: false leaves the lesson as it was, and says so. recorded: false says the lesson was finished but nothing was written. already: true says finishing again had nothing new to add.

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
  // The same count the act route uses: the lesson's own headings. A section that cannot be read would shrink the count and could overstate the result, so it stops here, as it does there.
  const passages = await Promise.all(chunkIds.map(id => getPassage(ctx.admin, ctx.userId, id)));
  if (passages.some(p => !p)) return NextResponse.json({ error: "Your guided lesson could not be read just now." }, { status: 503 });
  const of = guideStepCount(new Set(passages.map(p => sectionProfile(p!.content).heading).filter(Boolean)).size || 1);
  const [saved, kept] = await Promise.all([
    listArtefacts(ctx.admin, ctx.userId, { chunkIds }),
    listCheckAttempts(ctx.admin, ctx.userId, { sessionId, step, limit: 100 }),
  ]);
  if (!saved.ok || !kept.ok) return NextResponse.json({ error: "Your guided lesson could not be read just now." }, { status: 503 });
  // Each step's questions, from every saved version of its teaching. The saved teaching is found by its sections and not by the session it was first written in: another session on the same lesson
  // reopens the same row at no cost, and has to be able to finish. Only the first ten sections of a larger lesson are stored (learn-journey.ts ARTEFACT_SOURCES_MAX).
  const asked = new Map<number, string[]>();
  for (const a of saved.data) {
    const n = guideTeachStepOf(a.promptVersion);
    if (n === null || !coversLesson(a.sources, chunkIds.slice(0, ARTEFACT_SOURCES_MAX))) continue;
    asked.set(n, [...(asked.get(n) ?? []), questionText(parseDeeperAnswer(a.content)?.questions[0]?.text ?? GUIDE_COPY.fallbackQuestion)]);
  }
  const checks = kept.data.map(c => ({ question: c.question, verdict: c.response?.verdict ?? null, next: c.response?.feedback?.next ?? null }));
  const taught = Array.from({ length: of }, (_, i) => i).filter(i => asked.has(i));
  const taughtResults = guideStepResults(taught.map(i => asked.get(i)!), checks);
  const results = Array.from({ length: of }, (_, i) => { const at = taught.indexOf(i); return at < 0 ? null : taughtResults[at]; });
  const outcome = guidedLessonOutcome(taughtResults, of);
  if (!outcome.complete) return NextResponse.json({ complete: false, of, taught: asked.size, verdict: null });
  // Saying "counted" is a claim about a record, so it follows the record.
  if (policy.scholarLearningHistory !== "record") return NextResponse.json({ complete: true, recorded: false, of, verdict: outcome.verdict, results });
  const trail = await lessonEventTrail(ctx.admin, ctx.userId, sessionId, step);
  if (!trail.ok) return NextResponse.json({ error: "Your guided lesson could not be read just now." }, { status: 503 });
  const fresh = !!outcome.verdict && lessonResultIsNew(trail.data);
  const wrote = [
    trail.data.some(e => e.action === "explain") ? "ok" : await recordLearningEvent(ctx.admin, ctx.userId, { sessionId, step, action: "explain", verdict: null, chunkIds }),
    fresh ? await recordLearningEvent(ctx.admin, ctx.userId, { sessionId, step, action: "clarify", verdict: outcome.verdict, chunkIds }) : "ok",
  ];
  if (wrote.includes("failed")) return NextResponse.json({ complete: true, recorded: false, of, verdict: outcome.verdict, results });
  return NextResponse.json({ complete: true, recorded: true, already: !!outcome.verdict && !fresh, of, verdict: outcome.verdict, results });
}
