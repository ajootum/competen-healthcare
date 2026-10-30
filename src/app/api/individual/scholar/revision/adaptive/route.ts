// Allow up to 120s: when the library and saved questions have none at the starting difficulty, one small batch is written.
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { createAdaptiveSession, createAdaptiveSet, deleteRevisionSet, listAdaptiveExams, sqieSchema } from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { audit } from "@/lib/individual/scholar/http";
import { generationContextLoader } from "@/lib/individual/scholar/question-context";
import { adaptiveLibraryCopies, chooseNext, resolveAdaptiveSections } from "@/lib/individual/scholar/adaptive-service";
import { blueprintLimits, blueprintOf, blueprintScope, parseBlueprintRequest, startingDifficulty, type AdaptiveBlueprint } from "@/lib/individual/scholar/adaptive";
import { ADAPTIVE_REPORT_LABEL, ADAPTIVE_RULE } from "@/lib/individual/scholar/config";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/revision/adaptive -- SCHOLAR-PRACTICE-EXAMS-01 (owner, 30 Oct 2026). Adaptive Exams.
//
// POST { scope, formats?, length?, start?, feedback?, timeLimitMinutes?, source?, title? } starts one.
//   scope   { kind: "programme" } (default: sections linked by ACCEPTED links to the programme's competencies),
//           "library", "documents" { materialIds }, "topic" { topic }, "competencies" { competencyIds }
//   start   "auto" (the programme level's default, else the policy's) or easy | standard | harder
// The blueprint is kept in a revision set's scope (417, no new table); the session is mode 'adaptive' where migration
// 720 allows it, otherwise 'mock' with the set's scope.adaptive marker (store.ts createAdaptiveSession), and the report
// says so. The first question is chosen as every next one is (adaptive-service.ts chooseNext): library, then stored,
// then one small generation call at the starting difficulty. The browser receives the learner view only.
// GET lists the student's adaptive exams (newest first) with their practice score so far.
// Policy scholar_adaptive_exams off: refused (403), and the Revise page does not offer it.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const policy = await loadIndividualPolicy(ctx.admin);
  if (policy.scholarAdaptiveExams !== "on") return NextResponse.json({ error: "Adaptive exams are not offered here." }, { status: 403 });
  const body = await req.json().catch(() => ({}));

  // SCHOLAR-SQIE-CLOSE-01: structured only where 710 stores it (and parseBlueprintRequest keeps it to feedback after each answer).
  const sqie = await sqieSchema(ctx.admin, ctx.userId);
  const limits = blueprintLimits({ length: policy.scholarAdaptiveLength, maxLength: policy.scholarAdaptiveMaxLength, formats: policy.scholarAdaptiveFormats.filter(f => f !== "structured" || sqie), revisionFormats: policy.scholarRevisionFormats, feedback: policy.scholarRevisionFeedback });
  const asked = parseBlueprintRequest(body, limits);
  if (!asked.ok) return NextResponse.json({ error: asked.error }, { status: 400 });
  const a = asked.value;
  if ((a.scope.kind === "topic" && findPatientIdentifiers(a.scope.topic).length) || findPatientIdentifiers(a.title).length)
    return NextResponse.json({ error: "That looks like it identifies a patient. Name the topic only." }, { status: 422 });

  const resolved = await resolveAdaptiveSections(ctx.admin, ctx.userId, a.scope);
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const loader = await generationContextLoader(ctx.admin, ctx.userId, policy);
  const start = startingDifficulty(a.start, loader.levelDefault, policy.scholarRevisionDifficulty);
  const libraryIds = sqie && a.formats.includes("mcq") ? await adaptiveLibraryCopies(ctx, resolved.sections, a.length) : [];
  const blueprint: AdaptiveBlueprint = {
    v: 1, title: a.title || `Adaptive exam: ${resolved.title}`.slice(0, 120), scope: a.scope, formats: a.formats, length: a.length,
    start: start.start, startFrom: start.from, feedback: a.feedback, timeLimitMinutes: a.timeLimitMinutes, source: a.source,
    sections: resolved.sections, competencyIds: resolved.competencyIds, libraryIds, calls: 0,
  };
  const set = await createAdaptiveSet(ctx.admin, ctx.userId, { title: blueprint.title, scope: blueprintScope(blueprint), formats: a.formats, quantity: a.length, difficulty: start.start, feedback: a.feedback });
  if (!set.ok) return NextResponse.json({ error: set.notProvisioned ? "Adaptive exams are not available here yet: revision sessions are not installed on this environment." : "The exam could not be set up just now." }, { status: set.notProvisioned ? 404 : 503 });

  const first = await chooseNext(ctx, req, policy, { setId: set.id, blueprint, questionIds: [], outcomes: [], lastKind: null });
  if (!first.ok) { await deleteRevisionSet(ctx.admin, ctx.userId, set.id); return NextResponse.json({ error: "Your saved questions could not be read just now." }, { status: 503 }); }
  if (!first.pick) {
    await deleteRevisionSet(ctx.admin, ctx.userId, set.id);
    return NextResponse.json({ error: `There are no questions for this yet${first.note ? `: ${first.note}` : ""}. Answer a few practice questions on these notes, or try again when new questions can be written.`, continuity: true }, { status: 404 });
  }
  const made = await createAdaptiveSession(ctx.admin, ctx.userId, { setId: set.id, feedback: a.feedback, total: a.length, firstQuestionId: first.pick.id });
  if (!made.ok) { await deleteRevisionSet(ctx.admin, ctx.userId, set.id); return NextResponse.json({ error: made.notProvisioned ? "Adaptive exams are not available here yet: revision sessions are not installed on this environment." : "The exam could not be started just now." }, { status: made.notProvisioned ? 404 : 503 }); }
  await audit(ctx, "individual_scholar_revision_started", "individual_scholar_revision_session", made.id, {
    adaptive: true, mode: made.mode, fallback: made.mode !== "adaptive", scope: a.scope.kind, sections: resolved.sections.length, competencies: resolved.competencyIds.length,
    formats: a.formats, length: a.length, start: start.start, start_from: start.from, feedback: a.feedback, time_limit: a.timeLimitMinutes, library: libraryIds.length,
    first: { target: first.target, from: first.pick.from, match: first.pick.match, level: first.pick.level },
  });
  return NextResponse.json({ session: { id: made.id, mode: made.mode, fallback: made.mode !== "adaptive" }, rule: ADAPTIVE_RULE, label: ADAPTIVE_REPORT_LABEL });
}

export async function GET() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const r = await listAdaptiveExams(ctx.admin, ctx.userId, 20);
  if (!r.ok) return NextResponse.json({ exams: [], history: r.notProvisioned ? "not_provisioned" : "unreadable" });
  return NextResponse.json({
    history: "on", label: ADAPTIVE_REPORT_LABEL,
    exams: r.data.map(x => {
      const bp = blueprintOf(x.scope);
      return {
        id: x.session.id, title: x.title, status: x.session.status, startedAt: x.session.createdAt, completedAt: x.session.completedAt,
        length: bp?.length ?? x.session.total, answered: x.session.position, fallback: x.session.mode !== "adaptive",
        practicePercent: x.marked ? Math.round((x.scoreSum / x.marked) * 100) : null, marked: x.marked,
      };
    }),
  });
}
