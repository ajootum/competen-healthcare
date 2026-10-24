import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { createLearningSession, isUuid, listLearningSessions } from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { MAX_SCOPE_MATERIALS, planSteps, resolveScope, sessionTopics, type LearningScope } from "@/lib/individual/scholar/learn";
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

function parseScope(body: { scope?: Record<string, unknown> } | null): LearningScope | string {
  const s = body?.scope ?? {};
  const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter(isUuid))].slice(0, MAX_SCOPE_MATERIALS) : []);
  if (s.kind === "section") return isUuid(s.chunkId) ? { kind: "section", chunkId: s.chunkId } : "Choose a section.";
  if (s.kind === "document") return isUuid(s.materialId) ? { kind: "document", materialId: s.materialId } : "Choose a material.";
  if (s.kind === "documents") {
    const m = ids(s.materialIds);
    return m.length ? (m.length === 1 ? { kind: "document", materialId: m[0] } : { kind: "documents", materialIds: m }) : "Choose at least one material.";
  }
  if (s.kind === "topic") {
    const topic = typeof s.topic === "string" ? s.topic.replace(/\s+/g, " ").trim() : "";
    if (topic.length < 2 || topic.length > 120) return "Name a topic in a few words.";
    const m = ids(s.materialIds);
    return { kind: "topic", topic, materialIds: m.length ? m : undefined };
  }
  if (s.kind === "competency") return isUuid(s.competencyId) ? { kind: "competency", competencyId: s.competencyId } : "Choose a competency.";
  return "Choose what to learn.";
}

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
