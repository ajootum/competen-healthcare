// Allow up to 60s for AI generation.
export const maxDuration = 60;

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { chunkMappings, getPassage, insertQuestions } from "@/lib/individual/scholar/store";
import { AI_ERROR, SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit } from "@/lib/individual/scholar/http";
import { runCase } from "@/lib/individual/scholar/generation";
import { leadingCompetency } from "@/lib/competency/mapping";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/cases -- COMPETEN-SCHOLAR-01 S4, an interactive practice case.
//
// Body { chunkId }. One multi-step case from ONE passage of the person's own notes: linked questions that
// follow a single scenario, each held to every rule a single question is (generation.ts runCase), stored
// with one case_id and its steps in order, and tied to the section's leading competency (accepted first,
// never a rejected one). Educational and NOT clinically reviewed -- every surface that plays it says so.
// Needs migration 388 (case_id): where it is absent the insert fails and nothing is stored.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const passage = await getPassage(ctx.admin, ctx.userId, body?.chunkId);
  if (!passage) return NextResponse.json({ error: "That section could not be found." }, { status: 404 });

  const pre = await aiPreflight(ctx);
  if (pre) return pre;

  const r = await runCase(ctx.userId, passage);
  if (!r.ok) {
    await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_case_steps", null, { chunk_id: passage.chunkId, outcome: `error:${r.error}` });
    return NextResponse.json({ error: AI_ERROR[r.error].error }, { status: AI_ERROR[r.error].status });
  }
  const competencyId = leadingCompetency(await chunkMappings(ctx.admin, ctx.userId, passage.chunkId));
  const caseId = r.steps.length ? randomUUID() : null;
  const saved = await insertQuestions(ctx.admin, ctx.userId, {
    passage, kind: "case", drafts: r.steps, model: r.model, provider: r.provider, promptVersion: r.promptVersion,
    competencyId, caseId, caseTitle: r.title,
  });
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_case_steps", caseId, {
    chunk_id: passage.chunkId, steps: saved.ids.length, dropped: r.dropped.map(d => d.reason),
    model: r.model, prompt_version: r.promptVersion, saved: saved.ok, attempts: r.attempts, competency_id: competencyId,
  });
  if (!saved.ok) return NextResponse.json({ error: "The case could not be saved. Try again shortly." }, { status: 500 });
  if (!saved.ids.length)
    return NextResponse.json({
      created: 0, dropped: r.dropped.length,
      message: "No case could be written from this section that stayed within your notes. Try a section that describes a condition, its assessment or its care.",
    });
  return NextResponse.json({ created: saved.ids.length, caseId, title: r.title, dropped: r.dropped.length });
}
