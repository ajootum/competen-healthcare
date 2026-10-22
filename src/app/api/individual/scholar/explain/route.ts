// Allow up to 60s for AI generation -- the same ceiling the personal AI uses.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { getPassage, isUuid, searchCandidates, toPassages } from "@/lib/individual/scholar/store";
import { AI_ERROR, SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit } from "@/lib/individual/scholar/http";
import { rankChunks, toTsQuery } from "@/lib/individual/scholar/retrieval";
import { EXPLAIN_REFUSAL, describeViolations, passageCitation, passageTag, runExplain } from "@/lib/individual/scholar/generation";
import { AI_LABEL, QUESTION_MAX, RETRIEVAL_LIMIT } from "@/lib/individual/scholar/config";

// POST /api/individual/scholar/explain -- COMPETEN-IND-004 s2 (Understand).
//
// Body { question, materialId?, chunkId? }. With chunkId, the explanation reads that one passage
// ("explain this section"). Otherwise the person's own chunks are searched (Postgres FTS, their user_id
// first) and the best RETRIEVAL_LIMIT are used. No passage found means NO AI call: there is nothing to
// ground an answer on, and saying so is the honest answer.
//
// The answer is shown only if it passes the grounding check (generation.ts), with each [S n] citation
// resolved to material and page. It is NOT stored (owner ruling D10). The audit row records ids and
// counts, never the question text.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question || question.length > QUESTION_MAX) return NextResponse.json({ error: `Ask a question of up to ${QUESTION_MAX} characters.` }, { status: 400 });
  const materialId = isUuid(body?.materialId) ? body.materialId : null;

  let passages;
  if (body?.chunkId !== undefined && body?.chunkId !== null) {
    const p = await getPassage(ctx.admin, ctx.userId, body.chunkId);
    if (!p) return NextResponse.json({ error: "That section could not be found." }, { status: 404 });
    passages = [p];
  } else {
    const tsq = toTsQuery(question);
    if (!tsq) return NextResponse.json({ notInNotes: true, message: EXPLAIN_REFUSAL.not_in_notes });
    const found = await searchCandidates(ctx.admin, ctx.userId, tsq, materialId);
    if (!found.ok) return NextResponse.json({ error: "Your notes could not be searched just now. Try again shortly." }, { status: 503 });
    const ranked = rankChunks(question, found.data, RETRIEVAL_LIMIT);
    if (!ranked.length) return NextResponse.json({ notInNotes: true, message: EXPLAIN_REFUSAL.not_in_notes });
    passages = await toPassages(ctx.admin, ctx.userId, ranked);
  }

  const pre = await aiPreflight(ctx);
  if (pre) return pre;

  const r = await runExplain(ctx.userId, question, passages);
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_explain", null, {
    chunk_ids: passages.map(p => p.chunkId), question_chars: question.length,
    outcome: r.ok ? (r.check.ok ? "shown" : `withheld:${r.check.reason}`) : `error:${r.error}`,
    model: r.ok ? r.model : null, prompt_version: r.ok ? r.promptVersion : null,
  });
  if (!r.ok) return NextResponse.json({ error: AI_ERROR[r.error].error }, { status: AI_ERROR[r.error].status });

  const sources = passages.map((p, i) => ({
    tag: passageTag(i), chunkId: p.chunkId, materialId: p.materialId, citation: passageCitation(p), excerpt: p.content.slice(0, 400),
  }));
  if (!r.check.ok) {
    const detail = r.check.reason === "ungrounded" && r.check.violations?.length ? ` (${describeViolations(r.check.violations)})` : "";
    return NextResponse.json({ withheld: true, reason: r.check.reason, message: EXPLAIN_REFUSAL[r.check.reason] + detail, sources });
  }
  return NextResponse.json({
    answer: r.check.text, label: AI_LABEL, sources: sources.filter((_, i) => r.check.ok && r.check.cited.includes(i + 1)),
    provenance: { model: r.model, promptVersion: r.promptVersion },
  });
}
