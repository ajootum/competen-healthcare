// Allow up to 60s: a run may be given AI feedback.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { finishOsceAttempt, getOsceAttempt, getOsceStation, markOsceAttempt, saveOsceFeedback } from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, refusalWords, scholarAiRunner, scholarRisk } from "@/lib/individual/scholar/http";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { runOsceFeedback } from "@/lib/individual/scholar/generation";
import { recordScholarOutcome } from "@/lib/individual/scholar/outcome";
import { osceGate } from "@/lib/individual/scholar/osce-service";
import { OSCE_FEEDBACK_WITHHELD, finishRun, normaliseResponses, remediation, scoreSummary, scoreTicks } from "@/lib/individual/scholar/osce";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/osce/attempts/[id] -- SCHOLAR-PRACTICE-EXAMS-01 (720). One practice run, in three steps:
//   { action: "finish", responses, timeUp? }  what the learner wrote under each heading, screened for patient
//                                             identifiers, kept once. How long it took is measured from the server's
//                                             own start, never more than the station allows.
//   { action: "feedback" }                    optional AI feedback (activity `evaluate`) on what was written against the
//                                             checklist: suggested ticks and the five parts, checked, kept on the run.
//                                             Unavailable or withheld: the learner marks themselves, as without AI.
//   { action: "mark", ticks, useAi? }         the learner's own ticks for every item, once: the practice score and the
//                                             critical items missed. ai_evaluation only where feedback was kept AND the
//                                             learner used it -- with the evaluator recorded from the server's copy.
// A practice score is formative practice: never a pass, never an observed assessment, never verified competence.

export async function POST(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const gate = await osceGate(ctx.admin, ctx.userId);
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx2.params;
  const attempt = await getOsceAttempt(ctx.admin, ctx.userId, id);
  if (!attempt) return NextResponse.json({ error: "That practice run could not be found." }, { status: 404 });
  const station = await getOsceStation(ctx.admin, ctx.userId, attempt.stationId);
  if (!station) return NextResponse.json({ error: "That station could not be found." }, { status: 404 });
  const body = await req.json().catch(() => ({}));

  if (body?.action === "finish") {
    if (attempt.finishedAt) return NextResponse.json({ error: "This run has already finished." }, { status: 409 });
    const responses = normaliseResponses(body?.responses, station.sections);
    if (findPatientIdentifiers(Object.values(responses).join("\n")).length)
      return NextResponse.json({ error: "Something you wrote looks like it identifies a patient. Remove it and finish again." }, { status: 422 });
    // The start is the database's clock, the finish the server's: never earlier than the start, never longer than the station.
    const started = Date.parse(attempt.startedAt);
    const finished = Math.max(Date.now(), started);
    const run = finishRun(started, finished, station.durationMinutes);
    const ok = await finishOsceAttempt(ctx.admin, ctx.userId, attempt.id, {
      responses, finishedAt: new Date(finished).toISOString(), durationSeconds: run.durationSeconds, timeUp: run.timeUp || body?.timeUp === true,
    });
    if (!ok) return NextResponse.json({ error: "What you wrote could not be saved. Copy it somewhere safe and try again." }, { status: 500 });
    return NextResponse.json({ finished: true, durationSeconds: run.durationSeconds, timeUp: run.timeUp || body?.timeUp === true });
  }

  if (body?.action === "feedback") {
    if (!attempt.finishedAt) return NextResponse.json({ error: "Finish the station first." }, { status: 409 });
    if (attempt.ticks) return NextResponse.json({ error: "This run is already marked." }, { status: 409 });
    if (attempt.feedback?.parts) return NextResponse.json({ feedback: attempt.feedback });
    if (!Object.keys(attempt.responses).length) return NextResponse.json({ error: "Nothing was written in this run, so there is nothing for feedback to read. Mark each item yourself." }, { status: 422 });
    const standing = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "evaluate");
    if (!standing.available) return NextResponse.json({ error: `${standing.message ?? "AI feedback is not available right now."} Mark each item yourself.`, selfMark: true }, { status: 409 });
    const pre = await aiPreflight(ctx);
    if (pre) return pre;
    const ai = scholarAiRunner(ctx, req, "evaluate", await scholarRisk(ctx.admin, ctx.userId, {
      text: Object.values(attempt.responses).join("\n"), passages: [{ chunkId: station.chunkId ?? station.id, content: `${station.scenario}\n${station.checklist.map(i => i.text).join("\n")}` }],
      competencyIds: station.competencyId ? [station.competencyId] : [],
    }));
    const r = await runOsceFeedback(ctx.userId, { scenario: station.scenario, candidateInstructions: station.candidateInstructions, checklist: station.checklist, responses: attempt.responses }, ai.run);
    const refusal = ai.refusal();
    if (refusal) return NextResponse.json({ error: `${refusalWords(refusal).message} Mark each item yourself.`, selfMark: true }, { status: 409 });
    await recordScholarOutcome(ctx.admin, ai, {
      operation: "individual_scholar_osce_feedback", outputKind: "other", promptVersion: r.ok ? r.promptVersion : null,
      ...(!r.ok ? { outcome: "error" as const, reasons: [`error_${r.error}`] }
        : r.feedback.ok ? { outcome: "accepted" as const, reasons: ["answered"] } : { outcome: "rejected" as const, reasons: ["withheld", `withheld_${r.feedback.reason}`] }),
    });
    await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_osce_feedback", attempt.id, {
      station_id: station.id, outcome: !r.ok ? `error:${r.error}` : r.feedback.ok ? "shown" : `withheld:${r.feedback.reason}`,
      model: r.ok ? r.model : null, prompt_version: r.ok ? r.promptVersion : null, action_id: ai.actionId,
    });
    if (!r.ok) return NextResponse.json({ error: "AI feedback could not be written just now. Mark each item yourself, or try again shortly.", selfMark: true }, { status: 502 });
    if (!r.feedback.ok) return NextResponse.json({ error: OSCE_FEEDBACK_WITHHELD, selfMark: true, withheld: { reason: r.feedback.reason } }, { status: 422 });
    const feedback = { parts: r.feedback.parts, suggested: r.feedback.suggested, model: r.model, promptVersion: r.promptVersion };
    if (!(await saveOsceFeedback(ctx.admin, ctx.userId, attempt.id, feedback))) return NextResponse.json({ error: "The feedback could not be kept just now. Mark each item yourself." }, { status: 500 });
    return NextResponse.json({ feedback });
  }

  if (body?.action === "mark") {
    if (!attempt.finishedAt) return NextResponse.json({ error: "Finish the station first." }, { status: 409 });
    if (attempt.ticks) return NextResponse.json({ error: "This run is already marked." }, { status: 409 });
    const s = scoreTicks(station.checklist, body?.ticks);
    if (!s.ok) return NextResponse.json({ error: s.reason }, { status: 400 });
    // ai_evaluation is recorded only from the server's own kept feedback, never from what the browser says.
    const fb = attempt.feedback;
    const usedAi = body?.useAi === true && !!fb?.parts && typeof fb.model === "string" && typeof fb.promptVersion === "string";
    const ok = await markOsceAttempt(ctx.admin, ctx.userId, attempt.id, {
      ticks: s.ticks, score: s.score, criticalMissed: s.criticalMissed, marking: usedAi ? "ai_evaluation" : "self_graded",
      evaluatorModel: usedAi ? fb!.model : null, evaluatorPromptVersion: usedAi ? fb!.promptVersion : null,
    });
    if (!ok) return NextResponse.json({ error: "Your marks could not be saved just now." }, { status: 500 });
    return NextResponse.json({
      marked: true, score: s.score, points: s.points, outOf: s.outOf, criticalMissed: s.criticalMissed, criticalMissedIds: s.criticalMissedIds,
      summary: scoreSummary(s), marking: usedAi ? "ai_evaluation" : "self_graded", remediation: remediation(station, s.ticks),
    });
  }

  return NextResponse.json({ error: "Unknown step." }, { status: 400 });
}
