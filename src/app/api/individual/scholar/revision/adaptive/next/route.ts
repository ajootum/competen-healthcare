// Allow up to 120s: when nothing stored fits the difficulty asked for, one small batch is written.
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { isUuid } from "@/lib/individual/scholar/store";
import { audit } from "@/lib/individual/scholar/http";
import { revisionItemView } from "@/lib/individual/scholar/revision-view";
import { addItem, adaptiveReport, chooseNext, currentQuestion, finishAdaptive, loadAdaptive, recordServedItem, stateOutcomes, type AdaptiveState } from "@/lib/individual/scholar/adaptive-service";
import { adaptationOutcomes, deadlineOf, nextDifficulty, stopReason } from "@/lib/individual/scholar/adaptive";
import { ADAPTIVE_RULE } from "@/lib/individual/scholar/config";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/revision/adaptive/next -- SCHOLAR-PRACTICE-EXAMS-01. Body { sessionId, finish? }.
//
// After each answer (marked by /revision/answer, unchanged), the browser asks for the next question:
//   - the current question again while it is unanswered (so a reload, or a second tab, never skips one);
//   - otherwise, unless the exam has reached its length or its time limit, the next one: the difficulty recomputed by
//     the rule over THIS exam's answers (adaptive.ts difficultyTrajectory), then library → stored → one generation
//     call → the nearest difficulty (adaptive-service.ts chooseNext), added as the session's next item;
//   - or, when it stops (length, time, nothing left, or finish: true), the session completed and the report.
// Only the learner view of a question is sent (revision-view.ts revisionItemView). Owner-keyed: another person's
// session answers 404.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const policy = await loadIndividualPolicy(ctx.admin);
  if (policy.scholarAdaptiveExams !== "on") return NextResponse.json({ error: "Adaptive exams are not offered here." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!isUuid(body?.sessionId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const loaded = await loadAdaptive(ctx.admin, ctx.userId, body.sessionId);
  if (!loaded.ok) return NextResponse.json({ error: "Your exam could not be read just now." }, { status: 503 });
  if (!loaded.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let st: AdaptiveState = loaded.data;

  const done = async (s: AdaptiveState) => NextResponse.json({ done: true, report: await adaptiveReport(ctx.admin, ctx.userId, s) });
  if (st.session.status === "completed") return done(st);
  if (body?.finish === true) return done(await finishAdaptive(ctx, st, "ended"));

  const bp = st.blueprint;
  const deadline = deadlineOf(st.session.createdAt, bp.timeLimitMinutes);
  const answered = st.questionIds.filter(id => st.attempts.some(a => a.questionId === id) || st.held.some(h => h.questionId === id)).length;
  const stop = stopReason({ answered, length: bp.length, startedAt: st.session.createdAt, now: Date.now(), timeLimitMinutes: bp.timeLimitMinutes });
  const current = currentQuestion(st);
  const view = (q: NonNullable<ReturnType<typeof currentQuestion>>, extra: Record<string, unknown> = {}) => NextResponse.json({
    item: revisionItemView(q), number: st.questionIds.indexOf(q.id) + 1, total: bp.length, answered,
    target: nextDifficulty(bp.start, adaptationOutcomes(stateOutcomes(st).slice(0, st.questionIds.indexOf(q.id)))), deadline, rule: ADAPTIVE_RULE, ...extra,
  });
  if (current && stop !== "time") return view(current);
  if (stop) return done(await finishAdaptive(ctx, st, stop));

  // Two attempts: another request may add the next item between our read and our write; then we show what it added.
  for (let attempt = 0; attempt < 2; attempt++) {
    const lastId = st.questionIds.at(-1) ?? null;
    const next = await chooseNext(ctx, req, policy, {
      setId: st.setId, blueprint: st.blueprint, questionIds: st.questionIds, outcomes: adaptationOutcomes(stateOutcomes(st)), lastKind: lastId ? st.questions.get(lastId)?.kind ?? null : null,
    });
    if (!next.ok) return NextResponse.json({ error: "Your saved questions could not be read just now." }, { status: 503 });
    if (!next.pick) return done(await finishAdaptive(ctx, { ...st, blueprint: next.blueprint }, "exhausted"));
    if (await addItem(ctx.admin, ctx.userId, st.session.id, st.questionIds.length + 1, next.pick.id)) {
      // D4: its source recorded at selection (library, written by this exam, or stored), on the blueprint.
      await recordServedItem(ctx.admin, ctx.userId, st.setId, next.blueprint, st.questionIds.length + 1, next.pick, next.generated);
      await audit(ctx, "individual_scholar_adaptive_next", "individual_scholar_revision_session", st.session.id, {
        number: st.questionIds.length + 1, target: next.target, from: next.pick.from, match: next.pick.match, level: next.pick.level,
      });
      const again = await loadAdaptive(ctx.admin, ctx.userId, st.session.id);
      if (!again.ok || !again.data) return NextResponse.json({ error: "Your exam could not be read just now." }, { status: 503 });
      st = again.data;
      const q = currentQuestion(st);
      return q ? view(q, { note: next.note, match: next.pick.match }) : NextResponse.json({ error: "The next question could not be shown just now." }, { status: 503 });
    }
    const again = await loadAdaptive(ctx.admin, ctx.userId, st.session.id);
    if (!again.ok || !again.data) return NextResponse.json({ error: "Your exam could not be read just now." }, { status: 503 });
    st = again.data;
    const q = currentQuestion(st);
    if (q) return view(q);
  }
  return NextResponse.json({ error: "The next question could not be added just now. Try again." }, { status: 503 });
}
