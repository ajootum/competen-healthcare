import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { getEvaluation, getRevisionSession, insertEvaluation, isUuid, listEvaluations } from "@/lib/individual/scholar/store";
import { audit } from "@/lib/individual/scholar/http";
import { parseScope } from "@/lib/individual/scholar/learn";
import { configVersion, evaluateScope, parseEvaluationScope } from "@/lib/individual/scholar/evaluation-data";

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

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const policy = await loadIndividualPolicy(ctx.admin);
  const method = body?.method === "fresh" || body?.method === "combined" ? body.method : "existing";
  if (!policy.scholarEvaluationMethods.includes(method)) return NextResponse.json({ error: "That way of evaluating is not offered here." }, { status: 403 });
  const scope = parseEvaluationScope(body?.scope, parseScope);
  if (typeof scope === "string") return NextResponse.json({ error: scope }, { status: 400 });

  // A fresh knowledge check is the caller's own finished Mock session. Its held short answers, if any, are said.
  let freshSessionId: string | null = null, heldUngraded = 0;
  if (method !== "existing") {
    if (!isUuid(body?.freshSessionId)) return NextResponse.json({ error: "Take the knowledge check first." }, { status: 400 });
    const s = await getRevisionSession(ctx.admin, ctx.userId, body.freshSessionId);
    if (!s.ok) return NextResponse.json({ error: "Your knowledge check could not be read just now." }, { status: 503 });
    if (!s.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (s.data.session.mode !== "mock" || s.data.session.status !== "completed") return NextResponse.json({ error: "Finish the knowledge check first." }, { status: 409 });
    freshSessionId = s.data.session.id; heldUngraded = s.data.held.length;
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
  const limitations = heldUngraded ? [...e.limitations, `${heldUngraded} short answer${heldUngraded === 1 ? "" : "s"} in the knowledge check ${heldUngraded === 1 ? "waits" : "wait"} for your own grading: not counted.`] : e.limitations;
  const results = { knowledge: e.knowledge, retention: e.retention, application: e.application, reasoning: e.reasoning, coverage: e.coverage, strengths: e.strengths, gaps: e.gaps,
    insufficientAreas: e.insufficientAreas, retentionDifficulties: e.retentionDifficulties, reasoningWeaknesses: e.reasoningWeaknesses, verified: e.verified,
    recommendations: policy.scholarEvaluationRecommendations === "on" ? e.recommendations : [], confidenceDetail: e.confidence };
  const made = await insertEvaluation(ctx.admin, ctx.userId, {
    kind: body?.continuous === true && method === "existing" ? "continuous" : "student", method, scope: r.scope, context: r.context, freshSessionId,
    configVersion: await configVersion(ctx.admin), criteria: { rules: r.rules, recommendations: policy.scholarEvaluationRecommendations, interpretation: "evaluation/1" },
    results, confidence: e.confidence.level, limitations, evidenceRefs: e.evidence, cfca: e.cfca ? { tree: e.cfca } : null,
    aiProvenance: { interpretation: "deterministic", aiEvaluatedAnswers: e.knowledge.aiEvaluated.n + e.reasoning.written.aiEvaluated, models: e.aiModels }, supersedesId,
  });
  if (!made.ok) return NextResponse.json({ error: made.notProvisioned ? "Evaluations are not kept on this environment yet." : "Your evaluation could not be saved just now." }, { status: made.notProvisioned ? 409 : 500 });
  await audit(ctx, "individual_scholar_evaluation_made", "individual_scholar_evaluation", made.id, { method, scope: r.scope.kind, confidence: e.confidence.level, supersedes: supersedesId });
  return NextResponse.json({ id: made.id });
}

export async function GET() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const r = await listEvaluations(ctx.admin, ctx.userId);
  if (!r.ok) return NextResponse.json({ evaluations: [], history: r.notProvisioned ? "not_provisioned" : "unreadable" });
  return NextResponse.json({ evaluations: r.data.map(x => ({ id: x.id, kind: x.kind, method: x.method, scope: x.scope, confidence: x.confidence, createdAt: x.createdAt, supersedesId: x.supersedesId })), history: "on" });
}
