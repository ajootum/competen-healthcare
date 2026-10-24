import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { createLearningSession, listLearningSessions } from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { parseScope, planSteps, resolveScope, sessionTopics } from "@/lib/individual/scholar/learn";
import { sessionView } from "@/lib/individual/scholar/learn-view";
import { audit } from "@/lib/individual/scholar/http";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/learn/sessions -- COMPETEN-SCHOLAR-LEARN-01 L1, L3, L4.
//
// POST { scope } starts a learning session. The scope (a section, a document, chosen documents, a topic across the
// library, a competency) is resolved through Stage 2's own reads, planned into SUGGESTED steps (no AI), and -- when
// the Individual policy keeps learning history and 414 is here -- recorded, structure only. Otherwise the session is
// returned unrecorded and the workspace holds it. No AI call here. GET lists the student's recent sessions to resume.


export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const scope = parseScope(body);
  if (typeof scope === "string") return NextResponse.json({ error: scope }, { status: 400 });
  if (scope.kind === "topic" && findPatientIdentifiers(scope.topic).length)
    return NextResponse.json({ error: "That topic looks like it identifies a patient. Name the topic only." }, { status: 422 });

  const [policy, learner] = await Promise.all([loadIndividualPolicy(ctx.admin), loadLearnerCatalogue(ctx.admin, ctx.userId)]);
  const competencyTitle = scope.kind === "competency" ? learner.competencies?.find(c => c.id === scope.competencyId)?.title ?? null : null;
  const resolved = await resolveScope(ctx.admin, ctx.userId, scope, { competencyTitle });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  const topics = await sessionTopics(ctx.admin, ctx.userId, resolved.sections.map(s => s.chunkId));
  const plan = planSteps(resolved.sections, topics, policy.scholarSessionMaxSteps);
  let id: string | null = null, recorded = false, note: string | null = null;
  if (policy.scholarLearningHistory === "record") {
    const made = await createLearningSession(ctx.admin, ctx.userId, { scopeKind: scope.kind, title: resolved.title, topic: resolved.topic, competencyId: resolved.competencyId, steps: plan.steps });
    if (made.ok) { id = made.id; recorded = true; }
    else note = made.error === "not_provisioned"
      ? "Learning history is not available here yet, so this session cannot be resumed later."
      : "This session could not be saved, so it cannot be resumed later. You can still learn now.";
  } else note = "Learning history is off, so this session is not kept.";

  await audit(ctx, "individual_scholar_learning_started", "individual_scholar_learning_session", id,
    { scope: scope.kind, steps: plan.steps.length, sections: plan.coverage.sections, of: plan.coverage.of, recorded });
  return NextResponse.json({
    session: sessionView({ id, recorded, title: resolved.title, scopeKind: scope.kind, currentStep: 0, status: "active", coverage: plan.coverage, steps: plan.steps, topics }),
    note,
  });
}

export async function GET() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const r = await listLearningSessions(ctx.admin, ctx.userId, 20);
  if (!r.ok) return NextResponse.json({ sessions: [], history: r.notProvisioned ? "not_provisioned" : "unreadable" });
  return NextResponse.json({ sessions: r.data, history: "on" });
}
