// Allow up to 60s for AI generation -- the same ceiling the personal AI uses.
export const maxDuration = 60;

import { NextResponse } from "next/server";

import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { runIndividualAssistant } from "@/lib/individual/personal-ai";
import { purposeFrom } from "@/lib/individual/pilot-ai";
import { getLearningSession, getPassage, isUuid } from "@/lib/individual/scholar/store";
import type { Passage } from "@/lib/individual/scholar/generation";
import { SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, meteredRefusal, scholarRequestId, scholarRisk } from "@/lib/individual/scholar/http";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { studySessionBlock } from "@/lib/individual/scholar/study-context";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { PERSONAL_AI_LABEL, QUESTION_MAX, STEP_MAX_SECTIONS } from "@/lib/individual/scholar/config";
import { parseDepth, parseFollowUp } from "@/lib/individual/personal-ai-options";
import { personalAiFlight, personalAiResponse } from "@/lib/individual/personal-ai-stream";
import { citedSources, dropUnknownTags, numberPassages } from "@/lib/individual/personal-ai-sources";
import { splitNotCovered } from "@/lib/individual/scholar/answer-format";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/learn/assistant -- owner D3, from the Learn workspace: "Continue with your personal
// assistant". Body { question, mode?, sessionId?, step?, chunkIds?, purpose? }. `purpose: "education"` is the student's answer to a
// clarify question (AI operating modes): the same question resent as a study question. Anything else is ignored.
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
//
// SCHOLAR-PAI-EXPERIENCE-01: { depth?, followUp?, stream? } exactly as /api/individual/assistant (see that route): a
// follow-up's earlier question is the question (screened here and classified), its earlier answer is quoted model text
// (screened by the engine, never classified). Streamed only once the answer is being written; every refusal before it
// is the same JSON. The audit row gains depth, follow_up and timing_ms.
//
// SCHOLAR-PAI-RESEARCH-01: the step's sections are handed to the model NUMBERED [S1]..[Sn] (this route only), so the answer may
// cite what it takes from the notes and put everything else in a General background callout. The reply (JSON, and the streamed
// done event) carries `sources` -- the numbered notes the answer actually cites -- and `notCovered`, the items of the model's
// final "NOT COVERED: a; b" line (also removed from the JSON answer). No new AI call: the same one request, a different prompt.

export async function POST(req: Request) {
  const flight = personalAiFlight();
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  flight.want(body?.stream === true);
  const depth = parseDepth(body), followUp = parseFollowUp(body);
  if (!depth) return NextResponse.json({ error: "Choose quick, standard or deep." }, { status: 400 });
  if (followUp === null) return NextResponse.json({ error: "That follow-up could not be read. Ask your question again." }, { status: 400 });
  const question = followUp ? followUp.previousQuestion : typeof body?.question === "string" ? body.question.trim() : "";
  if (!question || question.length > QUESTION_MAX) return NextResponse.json({ error: `Ask a question of up to ${QUESTION_MAX} characters.` }, { status: 400 });
  if (findPatientIdentifiers(question).length) return NextResponse.json({ error: "That looks like it identifies a patient. Remove it and try again." }, { status: 422 });
  const mode = body?.mode === "ask" ? "ask" : "teach";
  const purpose = purposeFrom(body);

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
  // The material the model reads, numbered. `text` (the risk's plain material) is still what is screened and classified.
  const numbered = numberPassages(passages);
  Object.assign(study, { numbered: numbered.text, sources: numbered.sources });
  // What the reader gets of an answer: its "NOT COVERED" line lifted out, any tag naming no note dropped, the notes it cites.
  const shape = (answer: string) => {
    const split = splitNotCovered(answer);
    const text = dropUnknownTags(split.text, numbered.sources.length);
    return { text, notCovered: split.items, sources: citedSources(text, numbered.sources) };
  };
  // SCHOLAR-SESSION-AI-02 (D4): the study id passed (studySessionId, else the Learn sessionId, which IS the study session
  // when connected). Built only if the published profile lists study_session (default off), and only for the caller's
  // own connected session with the policy on and 740 present (studySessionBlock). Reads only; no extra AI call.
  const studyId = isUuid(body?.studySessionId) ? body.studySessionId as string : isUuid(body?.sessionId) ? body.sessionId as string : null;
  const studySession = studyId ? async () => {
    const learner = await loadLearnerCatalogue(ctx.admin, ctx.userId);
    return (await studySessionBlock(ctx.admin, ctx.userId, studyId, { competencyTitle: id => learner.competencies?.find(c => c.id === id)?.title ?? null }))?.text ?? null;
  } : null;
  type Out = Awaited<ReturnType<typeof runIndividualAssistant>>;
  const record = (out: Extract<Out, { ok: true } | { kind: "generation" }>) => audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_learn_assistant", isUuid(body?.sessionId) ? body.sessionId : null, {
    mode, chunk_ids: ids, question_chars: question.length, purpose, scopes_read: out.ok ? out.scopesRead : [], outcome: out.ok ? "shown" : `error:${out.result.error}`, model: out.ok ? out.model : null,
    depth, follow_up: followUp?.kind ?? null, streamed: flight.streamed, timing_ms: flight.timing(),
  });
  // The label the answer is shown under, on both the JSON and the streamed answer (one place, so it cannot drift).
  const shown = { label: PERSONAL_AI_LABEL };
  const declined = (out: Extract<Out, { kind: "generation" }>) => out.result.error === "refusal" ? "The assistant declined to answer that question." : "The assistant could not answer just now. Try again shortly.";
  return personalAiResponse(flight, async () => {
    const out = await runIndividualAssistant(ctx.admin, {
      userId: ctx.userId, fullName: ctx.profile.fullName, live: ctx.live, experience: "scholar", mode, question,
      requestId: scholarRequestId(ctx, req), study, purpose,
      studySession, depth, followUp, hooks: flight.hooks,
    });
    return out;
  }, {
    json: async out => {
      if (!out.ok && out.kind === "invalid") return NextResponse.json({ error: out.error }, { status: out.status });
      if (!out.ok && out.kind === "metered") return meteredRefusal(out.refusal)!;
      await record(out);
      if (!out.ok) {
        const status = out.result.error === "not_configured" ? 503 : 502;
        return NextResponse.json({ error: declined(out) }, { status });
      }
      const a = shape(out.answer);
      return NextResponse.json({ answer: a.text, mode: out.mode, model: out.model, ...shown, sources: a.sources, notCovered: a.notCovered });
    },
    // Text was already sent: the answer ended, or failed after it began (the browser discards the partial text).
    finish: async out => {
      if (out.ok) { await record(out); const a = shape(out.answer); return { type: "done", mode: out.mode, ...shown, timing: flight.timing(), sources: a.sources, notCovered: a.notCovered }; }
      if (out.kind === "generation") { await record(out); return { type: "error", code: out.result.error, message: declined(out) }; }
      return { type: "error", code: "failed", message: "The assistant could not answer just now. Try again shortly." };
    },
  });
}
