// Allow up to 60s for AI generation.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { chunkMappings, getPassage, insertQuestions } from "@/lib/individual/scholar/store";
import { leadingCompetency } from "@/lib/competency/mapping";
import { AI_ERROR, SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, meteredRefusal, scholarAiRunner, scholarRisk } from "@/lib/individual/scholar/http";
import { runQuestions, type QuestionKind } from "@/lib/individual/scholar/generation";
import { loadIndividualPolicy } from "@/lib/individual/policy";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/questions -- COMPETEN-IND-004 s3 (Assess) and s5 (Apply).
//
// Body { chunkId, kind: "mcq" | "case" }. Generates questions from ONE passage of the person's own
// material. Each question is stored with its chunk, the quoted source sentence, the model the provider
// reported and the prompt version -- and only if it passed the checks in generation.ts (well-formed,
// the quote really is in the passage, nothing ungrounded), the quality layer in question-quality.ts
// (options built from the passage's terms, keyed answer in the quote, no catch-alls or overlaps) and a
// blind verification that the passage supports exactly the keyed option. If nothing survives, it
// regenerates once. The rest are dropped and counted, never stored.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const kind: QuestionKind | null = body?.kind === "mcq" || body?.kind === "case" ? body.kind : null;
  if (!kind) return NextResponse.json({ error: "Unknown question type." }, { status: 400 });
  const passage = await getPassage(ctx.admin, ctx.userId, body?.chunkId);
  if (!passage) return NextResponse.json({ error: "That section could not be found." }, { status: 404 });

  const pre = await aiPreflight(ctx);
  if (pre) return pre;

  // AI-FAIR-USE-01: every call through the Holdings allowance (activity questions). A refusal is shown as the
  // engine words it, and nothing was sent, so nothing is audited as an AI query.
  const ai = scholarAiRunner(ctx, req, "questions", await scholarRisk(ctx.admin, ctx.userId, { passages: [passage] }));
  const r = await runQuestions(ctx.userId, kind, passage, (await loadIndividualPolicy(ctx.admin)).scholarQuestionsPerRequest, ai.run);
  const refused = meteredRefusal(ai.refusal());
  if (refused) return refused;
  if (!r.ok) {
    await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, `individual_scholar_${kind}`, null, { chunk_id: passage.chunkId, outcome: `error:${r.error}` });
    return NextResponse.json({ error: AI_ERROR[r.error].error }, { status: AI_ERROR[r.error].status });
  }
  // COMPETEN-SCHOLAR-01 S4: the competency the questions practise is the section's leading link (accepted
  // first, never a rejected one). None, or 388 absent: the questions are stored exactly as before.
  const competencyId = leadingCompetency(await chunkMappings(ctx.admin, ctx.userId, passage.chunkId));
  const saved = await insertQuestions(ctx.admin, ctx.userId, {
    passage, kind, drafts: r.check.kept, model: r.model, provider: r.provider, promptVersion: r.promptVersion, competencyId,
  });
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, `individual_scholar_${kind}`, null, {
    chunk_id: passage.chunkId, kept: saved.ids.length, dropped: r.check.dropped.map(d => d.reason),
    model: r.model, prompt_version: r.promptVersion, saved: saved.ok, attempts: r.attempts, competency_id: competencyId,
  });
  if (!saved.ok) return NextResponse.json({ error: "The questions could not be saved. Try again shortly." }, { status: 500 });
  if (!saved.ids.length)
    return NextResponse.json({
      created: 0, dropped: r.check.dropped.length,
      message: kind === "case"
        ? "No case question could be written from this section that stayed within your notes. Try a section that describes a condition or its management."
        : "No question could be written from this section that stayed within your notes. Try a longer or more detailed section.",
    });
  return NextResponse.json({ created: saved.ids.length, dropped: r.check.dropped.length, ids: saved.ids });
}
