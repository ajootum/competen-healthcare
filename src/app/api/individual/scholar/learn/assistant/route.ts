// Allow up to 60s for AI generation -- the same ceiling the personal AI uses.
export const maxDuration = 60;

import { NextResponse } from "next/server";

import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { runIndividualAssistant } from "@/lib/individual/personal-ai";
import { getLearningSession, getPassage, isUuid } from "@/lib/individual/scholar/store";
import type { Passage } from "@/lib/individual/scholar/generation";
import { SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, meteredRefusal, scholarRequestId, scholarRisk } from "@/lib/individual/scholar/http";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { PERSONAL_AI_LABEL, QUESTION_MAX, STEP_MAX_SECTIONS } from "@/lib/individual/scholar/config";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/learn/assistant -- owner D3, from the Learn workspace: "Continue with your personal
// assistant". Body { question, mode?, sessionId?, step?, chunkIds? }.
//
// THE ONE HOLDINGS PERSONAL AI (src/lib/individual/personal-ai.ts runIndividualAssistant), never a Scholar-only one,
// given the step the student is on as its study context: the sections' text, their competencies and topic terms --
// the student's own sections, read by their id. Scholar's default mode is Teach Me. Through the metered engine, so
// the request's clinical risk (D1) sets the model floor like every other AI call.
//
// ⚠ NOT A LEARN ANSWER (coordinator D3 conditions). Ask Scholar stays the grounded Learn `ask` action. This answer is
// general explanation, not checked against the notes and not clinically reviewed, and says so (PERSONAL_AI_LABEL). It
// is never saved as a Learn artefact, never recorded as a learning event, and never shown as "from your notes".
// ⚠ SCREENED FIRST. What the student typed is checked for patient identifiers before anything is sent.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question || question.length > QUESTION_MAX) return NextResponse.json({ error: `Ask a question of up to ${QUESTION_MAX} characters.` }, { status: 400 });
  if (findPatientIdentifiers(question).length) return NextResponse.json({ error: "That looks like it identifies a patient. Remove it and try again." }, { status: 422 });
  const mode = body?.mode === "ask" ? "ask" : "teach";

  // ── the step's own sections, by the caller's id ──
  let ids: string[] = [];
  if (isUuid(body?.sessionId)) {
    const s = await getLearningSession(ctx.admin, ctx.userId, body.sessionId);
    if (!s.ok) return NextResponse.json({ error: "Your session could not be read just now." }, { status: 503 });
    if (!s.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const here = s.data.steps.find(x => x.step === Number(body?.step)) ?? s.data.steps[0];
    ids = here ? here.sections.map(x => x.chunkId) : [];
  } else if (Array.isArray(body?.chunkIds)) ids = [...new Set((body.chunkIds as unknown[]).filter(isUuid))].slice(0, STEP_MAX_SECTIONS) as string[];
  if (!ids.length) return NextResponse.json({ error: "Choose what to learn from." }, { status: 400 });
  const found = await Promise.all(ids.map(id => getPassage(ctx.admin, ctx.userId, id)));
  if (found.some(p => !p)) return NextResponse.json({ error: "That section could not be found." }, { status: 404 });
  const passages = found as Passage[];

  // ── consent, quota, configuration -- as every Scholar AI call ──
  const pre = await aiPreflight(ctx);
  if (pre) return pre;

  // The study context: the sections (screened at upload), their live competency links and topic terms.
  const study = await scholarRisk(ctx.admin, ctx.userId, { passages });
  const out = await runIndividualAssistant(ctx.admin, {
    userId: ctx.userId, fullName: ctx.profile.fullName, live: ctx.live, experience: "scholar", mode, question,
    requestId: scholarRequestId(ctx, req), study,
  });
  if (!out.ok && out.kind === "invalid") return NextResponse.json({ error: out.error }, { status: out.status });
  if (!out.ok && out.kind === "metered") return meteredRefusal(out.refusal)!;
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_learn_assistant", isUuid(body?.sessionId) ? body.sessionId : null, {
    mode, chunk_ids: ids, question_chars: question.length, outcome: out.ok ? "shown" : `error:${out.result.error}`, model: out.ok ? out.model : null,
  });
  if (!out.ok) {
    const status = out.result.error === "not_configured" ? 503 : 502;
    return NextResponse.json({ error: out.result.error === "refusal" ? "The assistant declined to answer that question." : "The assistant could not answer just now. Try again shortly." }, { status });
  }
  return NextResponse.json({ answer: out.answer, mode: out.mode, model: out.model, label: PERSONAL_AI_LABEL });
}
