import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { getEvaluation, getRevisionSession, insertEvaluation, isUuid, listEvaluations } from "@/lib/individual/scholar/store";
import { audit } from "@/lib/individual/scholar/http";
import { parseScope } from "@/lib/individual/scholar/learn";
import { configVersion, evaluateScope, parseEvaluationScope } from "@/lib/individual/scholar/evaluation-data";
import { linkStudy } from "@/lib/individual/scholar/study-context";
import { enrichBlueprint } from "@/lib/individual/scholar/monthly-review";
import { evaluationForSession, monthlyCompletion, monthlyReviewOn, resolveRetake } from "@/lib/individual/scholar/monthly-review-data";

// Request-time only: it reads the release gate and the evidence, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/evaluations -- COMPETEN-SCHOLAR-EVALUATION-01 (Stage 6) E1-E5.
//
// POST { scope, method, freshSessionId?, supersedesId?, continuous? } evaluates the student's learning evidence for
// the scope and KEEPS the evaluation (426), as it was made:
//   method existing   the evidence they already have (Teach Me checks, revision, spaced review, clinical reasoning)
//   method fresh      only the answers of a fresh knowledge check: a Mock session (417) over the scope, finished
//   method combined   both, the fresh check's answers marked as given under evaluation conditions
// No AI: the interpretation is deterministic over marked evidence. Written answers were marked as they were
// answered (code, an eligible AI where available, or the student), and each keeps its marking. A later evaluation
// of the same scope may name the one it follows (supersedesId); the earlier record is never changed.
// GET lists the student's evaluations, newest first.
// SCHOLAR-MONTHLY-REVIEW-01: scope { kind: "month", month, blueprint, retakeOf? } with method fresh keeps a MONTHLY LEARNING REVIEW:
// the finished Mock sitting over the month's sections, kept with the exact blueprint, the questions asked (read from the sitting,
// never the request), the configuration version, whether it was started late, and the original it is a practice retake of.
// The first review of a month is its original and is never replaced. Asking twice for the same sitting returns the same record.
// Optional and formative: never verified competence.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const policy = await loadIndividualPolicy(ctx.admin);
  const method = body?.method === "fresh" || body?.method === "combined" ? body.method : "existing";
  if (!policy.scholarEvaluationMethods.includes(method)) return NextResponse.json({ error: "That way of evaluating is not offered here." }, { status: 403 });
  const scope = parseEvaluationScope(body?.scope, parseScope);
  if (typeof scope === "string") return NextResponse.json({ error: scope }, { status: 400 });
  if (scope.kind === "month") {
    if (!monthlyReviewOn(policy)) return NextResponse.json({ error: "The monthly review is not offered here." }, { status: 403 });
    if (method !== "fresh") return NextResponse.json({ error: "A monthly review is a knowledge check taken at its end." }, { status: 400 });
  }

  // A fresh knowledge check is the caller's own finished Mock session. Its held short answers, if any, are said.
  let freshSessionId: string | null = null, heldUngraded = 0;
  let sitting: { session: { createdAt: string }; questionIds: string[]; attempts: { questionId: string; correct: boolean; marking: string; answeredAt: string }[] } | null = null;
  if (method !== "existing") {
    if (!isUuid(body?.freshSessionId)) return NextResponse.json({ error: "Take the knowledge check first." }, { status: 400 });
    const s = await getRevisionSession(ctx.admin, ctx.userId, body.freshSessionId);
    if (!s.ok) return NextResponse.json({ error: "Your knowledge check could not be read just now." }, { status: 503 });
    if (!s.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (s.data.session.mode !== "mock" || s.data.session.status !== "completed") return NextResponse.json({ error: "Finish the knowledge check first." }, { status: 409 });
    freshSessionId = s.data.session.id; heldUngraded = s.data.held.length; sitting = s.data;
    if (scope.kind === "month") {
      const already = await evaluationForSession(ctx.admin, ctx.userId, s.data.session.id);
      if (already) return NextResponse.json({ id: already });
    }
  }
  let supersedesId: string | null = null;
  if (body?.supersedesId !== undefined && body?.supersedesId !== null) {
    const prior = await getEvaluation(ctx.admin, ctx.userId, body.supersedesId);
    if (!prior.ok) return NextResponse.json({ error: "Your earlier evaluation could not be read just now." }, { status: 503 });
    if (!prior.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    supersedesId = prior.data.id;
  }

  const now = new Date().toISOString();
  const r = await evaluateScope(ctx.admin, ctx.userId, policy, scope, { method, freshSessionId, now });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const e = r.evaluation;
  // A monthly review: how it went by section and topic, and the context it keeps (never taken from the request but the blueprint's shape).
  let monthly: Awaited<ReturnType<typeof monthlyCompletion>> = null;
  if (scope.kind === "month" && sitting) {
    scope.blueprint = enrichBlueprint(scope.blueprint, r.sections);
    const retake = await resolveRetake(ctx.admin, ctx.userId, scope.month, scope.retakeOf);
    if (!retake.ok) return NextResponse.json({ error: retake.error }, { status: retake.status });
    monthly = await monthlyCompletion(ctx.admin, ctx.userId, {
      month: scope.month, blueprint: scope.blueprint, retakeOf: retake.originalId, policyVersion: await configVersion(ctx.admin),
      bands: { strong: r.rules.bands.strong, developing: r.rules.bands.developing }, sitting: { createdAt: sitting.session.createdAt, questionIds: sitting.questionIds, attempts: sitting.attempts }, sections: r.sections,
    });
    if (!monthly) return NextResponse.json({ error: "Your review could not be read just now. Try again shortly." }, { status: 503 });
  }
  const limitations = heldUngraded ? [...e.limitations, `${heldUngraded} short answer${heldUngraded === 1 ? "" : "s"} in the knowledge check ${heldUngraded === 1 ? "waits" : "wait"} for your own grading: not counted.`] : e.limitations;
  const results = { knowledge: e.knowledge, retention: e.retention, application: e.application, reasoning: e.reasoning, coverage: e.coverage, strengths: e.strengths, gaps: e.gaps,
    insufficientAreas: e.insufficientAreas, retentionDifficulties: e.retentionDifficulties, reasoningWeaknesses: e.reasoningWeaknesses, verified: e.verified,
    recommendations: policy.scholarEvaluationRecommendations === "on" ? e.recommendations : [], confidenceDetail: e.confidence,
    ...(monthly ? { monthly: monthly.breakdown } : {}) };
  const made = await insertEvaluation(ctx.admin, ctx.userId, {
    kind: body?.continuous === true && method === "existing" ? "continuous" : "student", method, scope: r.scope, freshSessionId,
    context: monthly ? { ...r.context, monthlyReview: monthly.monthlyReview } : r.context,
    configVersion: await configVersion(ctx.admin), criteria: { rules: r.rules, recommendations: policy.scholarEvaluationRecommendations, interpretation: "evaluation/1" },
    results, confidence: e.confidence.level, limitations, evidenceRefs: e.evidence, cfca: e.cfca ? { tree: e.cfca } : null,
    aiProvenance: { interpretation: "deterministic", aiEvaluatedAnswers: e.knowledge.aiEvaluated.n + e.reasoning.written.aiEvaluated, models: e.aiModels }, supersedesId,
  });
  if (!made.ok) return NextResponse.json({ error: made.notProvisioned ? "Evaluations are not kept on this environment yet." : "Your evaluation could not be saved just now." }, { status: made.notProvisioned ? 409 : 500 });
  await audit(ctx, "individual_scholar_evaluation_made", "individual_scholar_evaluation", made.id, {
    method, scope: r.scope.kind, confidence: e.confidence.level, supersedes: supersedesId,
    ...(monthly ? { month: monthly.monthlyReview.month, retake: monthly.monthlyReview.retakeOf !== null, late: monthly.monthlyReview.late, asked: monthly.monthlyReview.questionIds.length } : {}),
  });
  // SCHOLAR-SESSION-AI-02: made inside a study session, the learner's own evaluation is linked to it -- a link row only,
  // never a change to the evaluation, its evidence, verification or the Passport (owner D5). Never fails the evaluation.
  await linkStudy(ctx.admin, ctx.userId, body?.studySessionId, "evaluation", made.id, policy);
  return NextResponse.json({ id: made.id });
}

export async function GET() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const r = await listEvaluations(ctx.admin, ctx.userId);
  if (!r.ok) return NextResponse.json({ evaluations: [], history: r.notProvisioned ? "not_provisioned" : "unreadable" });
  return NextResponse.json({ evaluations: r.data.map(x => ({ id: x.id, kind: x.kind, method: x.method, scope: x.scope, confidence: x.confidence, createdAt: x.createdAt, supersedesId: x.supersedesId })), history: "on" });
}
