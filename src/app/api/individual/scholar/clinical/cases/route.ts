// Allow up to 120s: a case is drafted, checked, and drafted again once if it fails its checks.
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { caseLibraryEnabled, loadCasePolicy } from "@/lib/cases/policy";
import { findLibraryCases } from "@/lib/cases/library";
import { caseHistory, getPassage, insertPrivateCase, listMaterials, listPrivateCases, sectionLinks } from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { parseScope, resolveScope, type LearningScope } from "@/lib/individual/scholar/learn";
import { SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, refusalWords, scholarAiRunner, scholarRisk } from "@/lib/individual/scholar/http";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { runCaseBlueprint } from "@/lib/individual/scholar/generation";
import { startPrivatePlay } from "@/lib/individual/scholar/clinical-play";
import { CASE_CONTEXT_LABEL, CASE_CONTEXTS, type CaseContext } from "@/lib/individual/scholar/config";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/clinical/cases -- COMPETEN-SCHOLAR-CLINICAL-REASONING-01 CR1 (and CI6, the Scholar side).
//
// POST { entry, scope?, context?, mode?, generateAnyway? } begins clinical reasoning:
//   entry  notes | competency | surprise | teach | revision -- what the case is written from (the student's own notes,
//          a competency's linked sections, a section from Teach Me or Revision, or one the student has not tried)
// LIBRARY FIRST (CI6). Where the case library is on and its policy says reuse first, suitable governed cases are
// offered BEFORE anything is written -- no AI, no charge. The student may still ask for one from their notes.
// A PRIVATE CASE from the notes is drafted through the Holdings allowance (activity case_steps, with its risk), made a
// blueprint and checked by clinical.ts; only a case that passes is stored (private_formative), and its session starts.
// When new AI is not available, stored and library cases stay playable and the reply says so (Learning Continuity).
// GET lists the student's own cases and their case history (private and library plays).

const MAX_PASSAGES = 5;

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const policy = await loadIndividualPolicy(ctx.admin);
  const entry = ["notes", "competency", "surprise", "teach", "revision"].includes(body?.entry) ? body.entry as string : null;
  if (!entry) return NextResponse.json({ error: "Choose how to start a case." }, { status: 400 });
  const offered = entry === "teach" || entry === "revision" ? policy.scholarCaseEntries.includes("notes") : policy.scholarCaseEntries.includes(entry as "notes");
  if (!offered) return NextResponse.json({ error: "That way of starting a case is not offered here." }, { status: 403 });
  const context: CaseContext = (CASE_CONTEXTS as readonly string[]).includes(body?.context) && policy.scholarCaseContexts.includes(body.context) ? body.context : (policy.scholarCaseContexts[0] ?? "general");
  const mode = body?.mode === "independent" || body?.mode === "guided" ? body.mode : policy.scholarCaseMode;

  // ── the scope: the student's own sections ──
  let scope: LearningScope | string;
  if (entry === "surprise") {
    // One of the student's materials, a different one each day: the case is still written from their own notes.
    const mats = await listMaterials(ctx.admin, ctx.userId);
    const usable = mats.ok ? mats.data.filter(m => m.chunkCount > 0) : [];
    if (!usable.length) return NextResponse.json({ error: "Upload your notes first: a case is written from them." }, { status: 404 });
    const day = Math.floor(Date.now() / 864e5);
    scope = { kind: "document", materialId: usable[day % usable.length].id };
  } else scope = parseScope(body);
  if (typeof scope === "string") return NextResponse.json({ error: scope }, { status: 400 });
  if (scope.kind === "topic" && findPatientIdentifiers(scope.topic).length)
    return NextResponse.json({ error: "That topic looks like it identifies a patient. Name the topic only." }, { status: 422 });
  const learner = await loadLearnerCatalogue(ctx.admin, ctx.userId);
  const resolved = await resolveScope(ctx.admin, ctx.userId, scope, { competencyTitle: scope.kind === "competency" ? learner.competencies?.find(c => c.id === (scope as { competencyId: string }).competencyId)?.title ?? null : null });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const chunkIds = resolved.sections.slice(0, MAX_PASSAGES).map(s => s.chunkId);
  const links = await sectionLinks(ctx.admin, ctx.userId, chunkIds);
  const competencyIds = [...new Set([...(scope.kind === "competency" ? [scope.competencyId] : []), ...links.map(l => l.competencyId)])].slice(0, 8);

  // ── CI6: a governed library case first, with no AI and no charge ──
  if (body?.generateAnyway !== true && (await caseLibraryEnabled(ctx.admin)) && (await loadCasePolicy(ctx.admin)).reuseFirst) {
    const offers = await findLibraryCases(ctx.admin, { competencyIds: competencyIds.length ? competencyIds : undefined, topic: resolved.topic ?? undefined });
    if (offers?.length) return NextResponse.json({ offers, note: "Clinically approved cases from the case library fit what you asked for. Playing one uses no AI. You can still have one written from your notes." });
  }

  // ── a private case from the notes ──
  if (policy.scholarCaseGeneration === "stored_only")
    return NextResponse.json({ error: "New cases are not written here. Play one of your stored cases or a library case." }, { status: 403 });
  const standing = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "case_steps");
  if (!standing.available) return NextResponse.json({ error: `${standing.message ?? "New AI help is not available right now."} Your stored and library cases are still yours to play.`, continuity: true }, { status: 409 });
  const pre = await aiPreflight(ctx);
  if (pre) return pre;
  const passages = (await Promise.all(chunkIds.map(id => getPassage(ctx.admin, ctx.userId, id)))).filter((p): p is NonNullable<typeof p> => !!p);
  if (!passages.length) return NextResponse.json({ error: "Your notes could not be read just now." }, { status: 503 });
  const titles = new Map((learner.competencies ?? []).map(c => [c.id, c]));
  const comps = competencyIds.map(id => ({ id, title: titles.get(id)?.title ?? "A competency", outcomes: titles.get(id)?.outcomes ?? [] }));
  const ai = scholarAiRunner(ctx, req, "case_steps", await scholarRisk(ctx.admin, ctx.userId, { text: resolved.topic, passages, competencyIds }));
  const r = await runCaseBlueprint(ctx.userId, { passages, competencies: comps, context: CASE_CONTEXT_LABEL[context], dimensions: policy.scholarCaseDimensions, asked: resolved.topic }, ai.run);
  const refusal = ai.refusal();
  if (refusal) return NextResponse.json({ error: `${refusalWords(refusal).message} Your stored and library cases are still yours to play.`, continuity: true }, { status: 409 });
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_case_blueprint", null, {
    entry, context, chunk_ids: chunkIds, outcome: !r.ok ? `error:${r.error}` : r.blueprint ? "stored" : `withheld:${[...new Set(r.problems)].join("/")}`,
    model: r.ok ? r.model : null, prompt_version: r.ok ? r.promptVersion : null,
  });
  if (!r.ok) return NextResponse.json({ error: "A case could not be written just now. Try again shortly." }, { status: 502 });
  if (!r.blueprint) return NextResponse.json({ error: "A case could not be written from these notes without adding things they do not say, so none was kept. Try other sections, or more of your notes." }, { status: 422 });
  const made = await insertPrivateCase(ctx.admin, ctx.userId, {
    materialId: passages[0].materialId, title: r.blueprint.title, origin: entry, context, blueprint: r.blueprint, model: r.model, promptVersion: r.promptVersion,
    chunkIds, competencyIds: [...new Set(r.blueprint.learningObjectives.flatMap(l => l.competencyIds))],
  });
  if (!made.ok) return NextResponse.json({ error: made.notProvisioned ? "Clinical reasoning is not available on this environment yet." : "The case could not be saved just now." }, { status: made.notProvisioned ? 409 : 500 });
  const play = await startPrivatePlay(ctx.admin, ctx.userId, made.id, mode);
  if ("error" in play) return NextResponse.json({ error: play.error }, { status: play.status });
  return NextResponse.json({ caseId: made.id, play });
}

export async function GET() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const [cases, history] = await Promise.all([listPrivateCases(ctx.admin, ctx.userId), caseHistory(ctx.admin, ctx.userId)]);
  return NextResponse.json({
    cases: cases.ok ? cases.data : [], history: history.ok ? history.data : [],
    available: cases.ok ? "on" : cases.notProvisioned ? "not_provisioned" : "unreadable",
  });
}
