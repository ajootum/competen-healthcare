import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { activeSessionsTitled, createLearningSession, getLearningSession, learningEvents, listLearningSessions, sessionStepSummaries } from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { parseScope, planSteps, resolveScope, scopeText, sessionTopics, storedScopeKind } from "@/lib/individual/scholar/learn";
import { displaySessionTitle, sessionTitle } from "@/lib/individual/scholar/learn-search";
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
//
// SCH-LEARN-UX-01: the title is deterministic (sessionTitle: the topic, then the source -- never an AI call, never a raw
// file name). Starting what the student is ALREADY learning (an active session of theirs with the same title and the
// very same sections) resumes that session instead of making a duplicate. Sessions are never merged or deleted.


export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const scope = parseScope(body);
  if (typeof scope === "string") return NextResponse.json({ error: scope }, { status: 400 });
  if (scopeText(scope) && findPatientIdentifiers(scopeText(scope)).length)
    return NextResponse.json({ error: "That topic looks like it identifies a patient. Name the topic only." }, { status: 422 });

  const [policy, learner] = await Promise.all([loadIndividualPolicy(ctx.admin), loadLearnerCatalogue(ctx.admin, ctx.userId)]);
  const competencyTitle = scope.kind === "competency" ? learner.competencies?.find(c => c.id === scope.competencyId)?.title ?? null : null;
  const resolved = await resolveScope(ctx.admin, ctx.userId, scope, { competencyTitle });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });

  const topics = await sessionTopics(ctx.admin, ctx.userId, resolved.sections.map(s => s.chunkId));
  const plan = planSteps(resolved.sections, topics, policy.scholarSessionMaxSteps);
  const kind = storedScopeKind(scope, resolved.sections);
  const title = sessionTitle({ kind, sections: plan.steps.flatMap(s => s.sections), topics, topic: kind === "topic" ? resolved.topic : null, competencyTitle });
  let id: string | null = null, recorded = false, note: string | null = null;
  if (policy.scholarLearningHistory === "record") {
    const same = await resumable(ctx.admin, ctx.userId, kind, title, plan.steps.flatMap(s => s.sections.map(x => x.chunkId)));
    if (same) {
      await audit(ctx, "individual_scholar_learning_resumed", "individual_scholar_learning_session", same.session.id, { scope: kind, reason: "same_scope" });
      return NextResponse.json({
        session: sessionView({ id: same.session.id, recorded: true, title: displaySessionTitle(same.session.title), scopeKind: same.session.scopeKind, currentStep: Math.min(same.session.currentStep, Math.max(0, same.steps.length - 1)), status: same.session.status, coverage: null, steps: same.steps, topics: await sessionTopics(ctx.admin, ctx.userId, same.steps.flatMap(s => s.sections.map(x => x.chunkId))) }),
        progress: same.progress, resumed: true,
        note: "You were already learning this, so Scholar carried on with that session where you left it.",
      });
    }
    const made = await createLearningSession(ctx.admin, ctx.userId, { scopeKind: kind, title, topic: kind === "topic" ? (resolved.topic ?? "").slice(0, 120) : null, competencyId: resolved.competencyId, steps: plan.steps });
    if (made.ok) { id = made.id; recorded = true; }
    else note = made.error === "not_provisioned"
      ? "Learning history is not available here yet, so this session cannot be resumed later."
      : "This session could not be saved, so it cannot be resumed later. You can still learn now.";
  } else note = "Learning history is off, so this session is not kept.";

  await audit(ctx, "individual_scholar_learning_started", "individual_scholar_learning_session", id,
    { scope: kind, steps: plan.steps.length, sections: plan.coverage.sections, of: plan.coverage.of, recorded });
  return NextResponse.json({
    session: sessionView({ id, recorded, title, scopeKind: kind, currentStep: 0, status: "active", coverage: plan.coverage, steps: plan.steps, topics }),
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

/** An active session of the student's with this title and exactly these sections, with its progress, or null. */
async function resumable(admin: unknown, userId: string, kind: Parameters<typeof activeSessionsTitled>[2], title: string, chunkIds: readonly string[]) {
  const candidates = await activeSessionsTitled(admin, userId, kind, title);
  if (!candidates.ok || !candidates.data.length) return null;
  const want = [...new Set(chunkIds)].sort().join(",");
  const summaries = await sessionStepSummaries(admin, userId, candidates.data.map(c => c.id));
  const match = candidates.data.find(c => [...new Set(summaries.get(c.id)?.chunkIds ?? [])].sort().join(",") === want);
  if (!match) return null;
  const [full, events] = await Promise.all([getLearningSession(admin, userId, match.id), learningEvents(admin, userId, match.id)]);
  if (!full.ok || !full.data) return null;
  const progress: Record<number, { actions: string[]; verdict: string | null }> = {};
  for (const e of events.ok ? events.data : []) { const p = (progress[e.step] ??= { actions: [], verdict: null }); if (!p.actions.includes(e.action)) p.actions.push(e.action); if (e.verdict) p.verdict = e.verdict; }
  return { ...full.data, progress };
}
