// Allow up to 60s for AI generation -- the same ceiling the personal AI uses.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { recordScholarOutcome } from "@/lib/individual/scholar/outcome";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { competencyChunks, getPassage, isUuid, searchCandidates, toPassages } from "@/lib/individual/scholar/store";
import { AI_ERROR, SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, meteredRefusal, scholarAiRunner, scholarRisk } from "@/lib/individual/scholar/http";
import { rankChunks, spreadAcrossMaterials, toTsQuery } from "@/lib/individual/scholar/retrieval";
import {
  EXPLAIN_REFUSAL, SUPPLEMENTARY_WITHHELD, describeViolations, isExplainMode, passageCitation, passageTag, runExplain, type ExplainMode, type TutorTurn,
} from "@/lib/individual/scholar/generation";
import { loadTutorContext } from "@/lib/individual/scholar/competency-view";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { AI_LABEL, QUESTION_MAX, RETRIEVAL_LIMIT, SUPPLEMENTARY_LABEL, TUTOR_MAX_TURNS } from "@/lib/individual/scholar/config";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/explain -- COMPETEN-IND-004 s2 (Understand).
//
// Body { question, materialId?, chunkId? }. With chunkId, the explanation reads that one passage
// ("explain this section"). Otherwise the person's own chunks are searched (Postgres FTS, their user_id
// first) and the best RETRIEVAL_LIMIT are used. No passage found means NO AI call: there is nothing to
// ground an answer on, and saying so is the honest answer.
//
// UPLOAD-01 U4, the cumulative library. materialIds (up to MAX_SELECTED) asks the question of CHOSEN documents.
// competencyId asks it of the sections the student linked to that competency (accepted links first, then
// suggestions; never a rejected one) -- with no searchable words, those sections themselves. Without either,
// the whole library is searched. Across several materials the passages are spread over the documents that
// matched, so each relevant one is cited by name. Retrieval stays Postgres FTS: no embeddings.
//
// The answer is shown only if it passes the grounding check (generation.ts), with each [S n] citation
// resolved to material and page. It is NOT stored (owner ruling D10). The audit row records ids and
// counts, never the question text.

/** UPLOAD-01 U4: the most documents one question may be asked of at once. */
const MAX_SELECTED = 10;
const NOT_LINKED = "None of your notes is linked to that competency yet. Find the topics in a material and accept the links that fit, then ask again.";

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question || question.length > QUESTION_MAX) return NextResponse.json({ error: `Ask a question of up to ${QUESTION_MAX} characters.` }, { status: 400 });
  const materialId = isUuid(body?.materialId) ? body.materialId : null;
  // COMPETEN-SCHOLAR-01 S3: the mode, and for the tutor the earlier turns, which the browser holds. Nothing
  // of the conversation is stored (D10). Earlier turns are bounded and only ever used as grounding text the
  // person has already seen or typed.
  const mode: ExplainMode | null = body?.mode === undefined || body?.mode === null ? "explain" : isExplainMode(body.mode) ? body.mode : null;
  if (!mode) return NextResponse.json({ error: "Unknown way of explaining." }, { status: 400 });
  const rawHistory: unknown[] = mode === "tutor" && Array.isArray(body?.history) ? body.history : [];
  const history: TutorTurn[] = rawHistory.slice(-TUTOR_MAX_TURNS).flatMap(raw => {
    const t = raw as { speaker?: unknown; text?: unknown } | null;
    return (t?.speaker === "tutor" || t?.speaker === "student") && typeof t.text === "string" && t.text.trim()
      ? [{ speaker: t.speaker, text: t.text.trim().slice(0, 1500) }] : [];
  });

  // What the student typed goes to the model and, as the request's subject, to the risk classification (D1): screened
  // first, as Learn screens it. Nothing that identifies a patient is sent.
  if ([question, ...history.filter(t => t.speaker === "student").map(t => t.text)].some(t => findPatientIdentifiers(t).length))
    return NextResponse.json({ error: "That looks like it identifies a patient. Remove it and try again." }, { status: 422 });
  let passages;
  if (Array.isArray(body?.chunkIds) && body.chunkIds.length) {
    // The tutor continues on the passages it started from.
    const ids = [...new Set(body.chunkIds as unknown[])].slice(0, RETRIEVAL_LIMIT);
    const found = await Promise.all(ids.map(id => getPassage(ctx.admin, ctx.userId, id as string)));
    if (found.some(p => !p)) return NextResponse.json({ error: "That section could not be found." }, { status: 404 });
    passages = found as NonNullable<(typeof found)[number]>[];
  } else if (body?.chunkId !== undefined && body?.chunkId !== null) {
    const p = await getPassage(ctx.admin, ctx.userId, body.chunkId);
    if (!p) return NextResponse.json({ error: "That section could not be found." }, { status: 404 });
    passages = [p];
  } else if (isUuid(body?.competencyId)) {
    const linked = await competencyChunks(ctx.admin, ctx.userId, body.competencyId);
    if (!linked.ok) return NextResponse.json({ error: "Your notes could not be searched just now. Try again shortly." }, { status: 503 });
    if (!linked.data.length) return NextResponse.json({ notInNotes: true, message: NOT_LINKED });
    const tsq = toTsQuery(question);
    const found = tsq ? await searchCandidates(ctx.admin, ctx.userId, tsq, { chunkIds: linked.data.map(c => c.id) }) : null;
    if (found && !found.ok) return NextResponse.json({ error: "Your notes could not be searched just now. Try again shortly." }, { status: 503 });
    const ranked = found?.ok && found.data.length ? rankChunks(question, found.data, 40) : [];
    passages = await toPassages(ctx.admin, ctx.userId, spreadAcrossMaterials(ranked.length ? ranked : linked.data, RETRIEVAL_LIMIT));
  } else {
    const tsq = toTsQuery(question);
    if (!tsq) return NextResponse.json({ notInNotes: true, message: EXPLAIN_REFUSAL.not_in_notes });
    const chosen = Array.isArray(body?.materialIds) ? [...new Set((body.materialIds as unknown[]).filter(isUuid))].slice(0, MAX_SELECTED) : [];
    if (Array.isArray(body?.materialIds) && !chosen.length) return NextResponse.json({ error: "Choose at least one of your materials." }, { status: 400 });
    const found = await searchCandidates(ctx.admin, ctx.userId, tsq, materialId ?? (chosen.length ? { materialIds: chosen } : null));
    if (!found.ok) return NextResponse.json({ error: "Your notes could not be searched just now. Try again shortly." }, { status: 503 });
    const ranked = rankChunks(question, found.data, 40);
    if (!ranked.length) return NextResponse.json({ notInNotes: true, message: EXPLAIN_REFUSAL.not_in_notes });
    passages = await toPassages(ctx.admin, ctx.userId, materialId ? ranked.slice(0, RETRIEVAL_LIMIT) : spreadAcrossMaterials(ranked, RETRIEVAL_LIMIT));
  }

  const pre = await aiPreflight(ctx);
  if (pre) return pre;

  // P1: the tutor sees the student's own study context, assembled now from their rows (never stored, never grounding).
  const learnerContext = mode === "tutor" ? await loadTutorContext(ctx.admin, ctx.userId, passages.map(p => p.chunkId)) : null;
  // AI-FAIR-USE-01: through the Holdings allowance, with the mode as the activity (the tutor's turn is tutor_continue).
  const ai = scholarAiRunner(ctx, req, mode === "tutor" ? "tutor_continue" : mode, await scholarRisk(ctx.admin, ctx.userId, { text: question, passages }));
  const r = await runExplain(ctx.userId, question, passages, mode, history, learnerContext, ai.run);
  const refused = meteredRefusal(ai.refusal());
  if (refused) return refused;
  // SCHOLAR-AI-OPT-01: the outcome of this one action (shown or withheld, and why), codes only.
  await recordScholarOutcome(ctx.admin, ai, {
    operation: "individual_scholar_explain", outputKind: "explanation", promptVersion: r.ok ? r.promptVersion : null, configVersion: `mode:${mode}`,
    ...(!r.ok ? { outcome: "error" as const, reasons: [`error_${r.error}`] }
      : r.check.ok ? { outcome: "accepted" as const, accepted: 1 } : { outcome: "rejected" as const, rejected: 1, reasons: [r.check.reason] }),
  });
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_explain", null, {
    action_id: ai.actionId,
    chunk_ids: passages.map(p => p.chunkId), question_chars: question.length, mode, tutor_turns: history.length, learner_context: learnerContext !== null,
    outcome: r.ok ? (r.check.ok ? "shown" : `withheld:${r.check.reason}`) : `error:${r.error}`,
    supplementary: r.ok && r.supplementary ? (r.supplementary.ok ? "shown" : `withheld:${r.supplementary.reason}`) : null,
    model: r.ok ? r.model : null, prompt_version: r.ok ? r.promptVersion : null,
  });
  if (!r.ok) return NextResponse.json({ error: AI_ERROR[r.error].error }, { status: AI_ERROR[r.error].status });

  const sources = passages.map((p, i) => ({
    tag: passageTag(i), chunkId: p.chunkId, materialId: p.materialId, materialTitle: p.materialTitle, citation: passageCitation(p), excerpt: p.content.slice(0, 400),
  }));
  if (!r.check.ok) {
    const detail = r.check.reason === "ungrounded" && r.check.violations?.length ? ` (${describeViolations(r.check.violations)})` : "";
    return NextResponse.json({ withheld: true, reason: r.check.reason, message: EXPLAIN_REFUSAL[r.check.reason] + detail, sources });
  }
  // Beyond the notes: shown apart, under its own label, or withheld with the reason. A notes-only mode
  // never shows it, and says nothing about it either (not_this_mode).
  const s = r.supplementary;
  const supplementary = !s || (!s.ok && s.reason === "not_this_mode") ? null
    : s.ok ? { text: s.text, label: SUPPLEMENTARY_LABEL } : { withheld: SUPPLEMENTARY_WITHHELD[s.reason as Exclude<typeof s.reason, "not_this_mode">] };
  return NextResponse.json({
    answer: r.check.text, label: AI_LABEL, sources: sources.filter((_, i) => r.check.ok && r.check.cited.includes(i + 1)),
    provenance: { model: r.model, promptVersion: r.promptVersion }, mode, supplementary, passageIds: passages.map(p => p.chunkId), actionId: ai.actionId,
  });
}
