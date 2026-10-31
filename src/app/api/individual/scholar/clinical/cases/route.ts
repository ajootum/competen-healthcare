// Allow up to 120s: a case is drafted, checked, and drafted again once if it fails its checks.
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { caseLibraryEnabled, loadCasePolicy } from "@/lib/cases/policy";
import { findLibraryCases } from "@/lib/cases/library";
import { caseHistory, getPassage, insertPrivateCase, listMaterials, listPrivateCases, sectionLinks, storedPrivateCase } from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { parseScope, resolveScope, scopeText, type LearningScope } from "@/lib/individual/scholar/learn";
import { linkStudy } from "@/lib/individual/scholar/study-context";
import { SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, refusalWords, scholarAiRunner, scholarRisk, routingVersion } from "@/lib/individual/scholar/http";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { runCaseBlueprint } from "@/lib/individual/scholar/generation";
import { startPrivatePlay } from "@/lib/individual/scholar/clinical-play";
import { CASE_CONTEXT_LABEL, CASE_CONTEXTS, PROMPT_VERSIONS, type CaseContext } from "@/lib/individual/scholar/config";
import { REPEAT_REJECTED, caseReadiness } from "@/lib/individual/scholar/sufficiency";
import { noCalls, recordScholarOutcome } from "@/lib/individual/scholar/outcome";
import { materialKey, priorRejection } from "@/lib/ai/outcomes";
import { randomUUID } from "node:crypto";

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
//
// SCHOLAR-AI-OPT-01, after the library and before any model is paid (no check on what IS written changes):
//   reuse      a private case already written from exactly these sections, in this context, is offered (`fresh`)
//   readiness  sufficiency.ts over the sections: no presentation and no action is not sent; a case question fits
//              better is offered first (`attemptAnyway` is the learner's governed attempt)
//   no repeat  exactly these sections, under the same prompt, configuration and routing, already rejected: not sent
// Every action, sent or redirected, leaves one plat_ai_outcomes row (codes and counts only).

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
  if (scopeText(scope) && findPatientIdentifiers(scopeText(scope)).length)
    return NextResponse.json({ error: "That topic looks like it identifies a patient. Name the topic only." }, { status: 422 });
  const learner = await loadLearnerCatalogue(ctx.admin, ctx.userId);
  const resolved = await resolveScope(ctx.admin, ctx.userId, scope, { competencyTitle: scope.kind === "competency" ? learner.competencies?.find(c => c.id === (scope as { competencyId: string }).competencyId)?.title ?? null : null });
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const chunkIds = resolved.sections.slice(0, MAX_PASSAGES).map(s => s.chunkId);
  const links = await sectionLinks(ctx.admin, ctx.userId, chunkIds);
  const competencyIds = [...new Set([...(scope.kind === "competency" ? [scope.competencyId] : []), ...links.map(l => l.competencyId)])].slice(0, 8);

  // ── CI6: a governed library case first, with no AI and no charge ──
  const libraryOn = await caseLibraryEnabled(ctx.admin);
  if (body?.generateAnyway !== true && libraryOn && (await loadCasePolicy(ctx.admin)).reuseFirst) {
    const offers = await findLibraryCases(ctx.admin, { competencyIds: competencyIds.length ? competencyIds : undefined, topic: resolved.topic ?? undefined });
    if (offers?.length) return NextResponse.json({ offers, note: "Clinically approved cases from the case library fit what you asked for. Playing one uses no AI. You can still have one written from your notes." });
  }

  // ── a private case from the notes ──
  if (policy.scholarCaseGeneration === "stored_only")
    return NextResponse.json({ error: `New cases are not written here. Play one of your stored cases${libraryOn ? " or a library case" : ""}.` }, { status: 403 });
  const standing = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "case_steps");
  if (!standing.available) return NextResponse.json({ error: `${standing.message ?? "New AI help is not available right now."} Your stored ${libraryOn ? "and library cases are" : "cases are"} still yours to play.`, continuity: true }, { status: 409 });
  const pre = await aiPreflight(ctx);
  // The Individual quota used up (429) is Learning Continuity, as Teach Me treats it: no new case, the stored ones
  // still playable, said so. Consent and configuration refusals stay what they are.
  if (pre?.status === 429) {
    const why = ((await pre.clone().json().catch(() => ({}))) as { error?: string }).error ?? "Your AI allowance is used up for now.";
    return NextResponse.json({ error: `${why} Your stored ${libraryOn ? "and library cases are" : "cases are"} still yours to play.`, continuity: true }, { status: 429 });
  }
  if (pre) return pre;
  const passages = (await Promise.all(chunkIds.map(id => getPassage(ctx.admin, ctx.userId, id)))).filter((p): p is NonNullable<typeof p> => !!p);
  if (!passages.length) return NextResponse.json({ error: "Your notes could not be read just now." }, { status: 503 });

  // ── SCHOLAR-AI-OPT-01: reuse, readiness, no identical repeat ──
  const promptVersion = PROMPT_VERSIONS.caseBlueprint;
  if (body?.fresh !== true) {
    const stored = await storedPrivateCase(ctx.admin, ctx.userId, passages.map(p => p.chunkId), context, promptVersion);
    if (stored) return NextResponse.json({ saved: stored, note: `You already have a case written from these sections ("${stored.title}"). Play it again, or have a new one written.` });
  }
  const readiness = caseReadiness(passages.map(p => p.content), "case_blueprint");
  const configVersion = `${context};${[...policy.scholarCaseDimensions].sort().join(",")};${await routingVersion(ctx.admin)}`;
  const key = materialKey({ userId: ctx.userId, activity: "case_blueprint", versions: [promptVersion, configVersion, ...competencyIds.slice().sort(), resolved.topic ?? ""], contents: passages.map(p => p.content) });
  const redirect = async (reason: string, payload: Record<string, unknown>) => {
    await recordScholarOutcome(ctx.admin, noCalls(randomUUID()), {
      operation: "individual_scholar_case_blueprint", outputKind: "case", outcome: "redirected", reasons: [reason], sufficiency: readiness.outcome, promptVersion, configVersion, materialKey: key,
    });
    return NextResponse.json(payload, { status: 422 });
  };
  const sectionIds = passages.map(p => p.chunkId), materialId = passages[0].materialId;
  if (readiness.outcome === "insufficient" || (readiness.outcome === "simpler" && body?.attemptAnyway !== true))
    return redirect(`sufficiency_${readiness.outcome}`, {
      error: readiness.message, sufficiency: { outcome: readiness.outcome, message: readiness.message, alternative: readiness.alternative, missing: readiness.missing, canAttempt: readiness.outcome === "simpler", sectionIds, materialId },
    });
  if (await priorRejection(ctx.admin, key))
    return redirect("repeat_rejected", { error: REPEAT_REJECTED, repeat: true, sufficiency: { outcome: readiness.outcome, message: REPEAT_REJECTED, alternative: "case_question", canAttempt: false, sectionIds, materialId } });

  const titles = new Map((learner.competencies ?? []).map(c => [c.id, c]));
  const comps = competencyIds.map(id => ({ id, title: titles.get(id)?.title ?? "A competency", outcomes: titles.get(id)?.outcomes ?? [] }));
  const ai = scholarAiRunner(ctx, req, "case_steps", await scholarRisk(ctx.admin, ctx.userId, { text: resolved.topic, passages, competencyIds }));
  const r = await runCaseBlueprint(ctx.userId, { passages, competencies: comps, context: CASE_CONTEXT_LABEL[context], dimensions: policy.scholarCaseDimensions, asked: resolved.topic }, ai.run);
  const refusal = ai.refusal();
  if (refusal) return NextResponse.json({ error: `${refusalWords(refusal).message} Your stored ${libraryOn ? "and library cases are" : "cases are"} still yours to play.`, continuity: true }, { status: 409 });
  await recordScholarOutcome(ctx.admin, ai, {
    operation: "individual_scholar_case_blueprint", outputKind: "case", sufficiency: readiness.outcome, promptVersion, configVersion, materialKey: key,
    ...(!r.ok ? { outcome: "error" as const, reasons: [`error_${r.error}`] }
      : r.blueprint ? { outcome: "accepted" as const, accepted: 1, reasons: r.problems }
        : { outcome: "rejected" as const, rejected: 1, reasons: r.problems }),
  });
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_case_blueprint", null, {
    // Why a draft was refused, by the check's own words (kinds and the token or rule, never the case text).
    entry, context, chunk_ids: chunkIds, outcome: !r.ok ? `error:${r.error}` : r.blueprint ? "stored" : "withheld", problems: r.ok ? [...new Set(r.problems)].slice(0, 12) : [],
    model: r.ok ? r.model : null, prompt_version: r.ok ? r.promptVersion : null, sufficiency: readiness.outcome, action_id: ai.actionId,
  });
  if (!r.ok) return NextResponse.json({ error: "A case could not be written just now. Try again shortly." }, { status: 502 });
  if (!r.blueprint) return NextResponse.json({
    error: r.declaredInsufficient
      ? "These notes do not describe enough of a patient's care for a case, so none was written. A case question from the same sections may work, or add notes that describe a patient's assessment and care."
      // SCHOLAR-AI-OPT-01 P2: say what actually failed. A draft refused only for its shape is not the notes' fault.
      : r.problems.every(p => p.startsWith("structure:") || p.startsWith("malformed:"))
        ? "The case drafted from these notes was not complete enough to play, so none was kept. Try a case question from these sections, or other sections."
        : "A case could not be written from these notes without adding things they do not say, so none was kept. Try a case question from these sections, other sections, or more of your notes.",
    sufficiency: { outcome: readiness.outcome, alternative: "case_question", canAttempt: false, sectionIds, materialId },
  }, { status: 422 });
  const made = await insertPrivateCase(ctx.admin, ctx.userId, {
    materialId: passages[0].materialId, title: r.blueprint.title, origin: entry, context, blueprint: r.blueprint, model: r.model, promptVersion: r.promptVersion,
    chunkIds, competencyIds: [...new Set(r.blueprint.learningObjectives.flatMap(l => l.competencyIds))],
  });
  if (!made.ok) return NextResponse.json({ error: made.notProvisioned ? "Clinical reasoning is not available on this environment yet." : "The case could not be saved just now." }, { status: made.notProvisioned ? 409 : 500 });
  const play = await startPrivatePlay(ctx.admin, ctx.userId, made.id, mode);
  if ("error" in play) return NextResponse.json({ error: play.error }, { status: play.status });
  // SCHOLAR-SESSION-AI-02: started inside a study session, the case play is linked to it (never failing the case).
  await linkStudy(ctx.admin, ctx.userId, body?.studySessionId, "case_session", play.sessionId, policy);
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
