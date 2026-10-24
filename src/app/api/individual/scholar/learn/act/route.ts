// Allow up to 60s for AI generation -- the same ceiling the personal AI uses.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { getLearningPreference, getLearningSession, getPassage, isUuid, recordLearningEvent, searchCandidates, toPassages, updateLearningSession } from "@/lib/individual/scholar/store";
import { AI_ERROR, SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit } from "@/lib/individual/scholar/http";
import { rankChunks, spreadAcrossMaterials, toTsQuery } from "@/lib/individual/scholar/retrieval";
import { EXPLAIN_REFUSAL, SUPPLEMENTARY_WITHHELD, describeViolations, passageCitation, passageTag, runLearn, type Passage, type TutorTurn } from "@/lib/individual/scholar/generation";
import { loadLearnerCatalogue, loadTutorContext } from "@/lib/individual/scholar/competency-view";
import { governedReferences } from "@/lib/individual/scholar/learn";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import {
  AI_LABEL, CHECK_VERDICT_LABEL, EXPLANATION_DEPTHS, INFORMAL_CHECK_LABEL, QUESTION_MAX, RETRIEVAL_LIMIT, SOURCE_KIND_LABEL, SUPPLEMENTARY_LABEL, STEP_MAX_SECTIONS,
  isLearnAction, type ExplanationDepth, type LearnAction,
} from "@/lib/individual/scholar/config";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/learn/act -- COMPETEN-SCHOLAR-LEARN-01 L2 and L3, one learning action.
//
// Body { action, sessionId?, step?, chunkIds?, question?, checkQuestion?, answer?, history?, depth? }.
//   action  teach | explain | simplify | deeper | examples | summary | ask  (the policy's, L5)
//           check (write an informal check question) | clarify (judge the answer to it, and clarify)
// The passages are the step's own sections, read by the caller's id (a recorded session's, or -- for a session the
// browser holds -- the chunk ids it sends, each looked up as the caller's own). Ask Scholar searches within the
// session's sections first. Everything runs on the ONE Scholar engine (generation.ts runLearn): the notes part is
// cited and checked, background and AI flags are split off and checked, and nothing is shown ungrounded.
// Nothing the AI says or the student types is stored. A recorded session gets one event: the action, the step,
// the sections used and, for a clarification, the informal verdict -- never assessment, never competence.

const CANNED: Record<LearnAction | "check", string> = {
  teach: "Teach me this step.", explain: "Explain this.", simplify: "Explain this as simply as possible.", deeper: "Help me understand this in more depth.",
  examples: "Give me examples of this in practice.", summary: "Summarise the important learning points.", ask: "", check: "Check my understanding of this.",
};

async function ownPassages(admin: unknown, userId: string, ids: readonly string[]): Promise<Passage[] | null> {
  const found = await Promise.all(ids.map(id => getPassage(admin, userId, id)));
  return found.some(p => !p) ? null : (found as Passage[]);
}

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const policy = await loadIndividualPolicy(ctx.admin);

  // ── the action, as policy allows it ──
  const action = body?.action as string;
  const isCheck = action === "check" || action === "clarify";
  if (!isLearnAction(action) && !isCheck) return NextResponse.json({ error: "Unknown learning action." }, { status: 400 });
  if (isLearnAction(action) && !policy.scholarLearningActions.includes(action)) return NextResponse.json({ error: "That way of learning is not offered here." }, { status: 403 });
  if (isCheck && policy.scholarCheckBehaviour === "off") return NextResponse.json({ error: "Understanding checks are not offered here." }, { status: 403 });

  // ── what the student typed: bounded and screened, never stored ──
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const question = text(body?.question), checkQuestion = text(body?.checkQuestion), answer = text(body?.answer);
  if (action === "ask" && (!question || question.length > QUESTION_MAX)) return NextResponse.json({ error: `Ask a question of up to ${QUESTION_MAX} characters.` }, { status: 400 });
  if (action === "clarify" && (!checkQuestion || !answer || answer.length > QUESTION_MAX || checkQuestion.length > 400)) return NextResponse.json({ error: "Answer the check question first." }, { status: 400 });
  if ([question, answer].some(t => t && findPatientIdentifiers(t).length))
    return NextResponse.json({ error: "That looks like it identifies a patient. Remove it and try again." }, { status: 422 });

  // ── the passages: the step's own sections, by the caller's id ──
  const sessionId = isUuid(body?.sessionId) ? body.sessionId as string : null;
  let stepIds: string[] = [], scopeIds: string[] = [], step = Number.isInteger(body?.step) ? Number(body.step) : 0;
  let recorded = false;
  if (sessionId) {
    const s = await getLearningSession(ctx.admin, ctx.userId, sessionId);
    if (!s.ok) return NextResponse.json({ error: "Your session could not be read just now." }, { status: 503 });
    if (!s.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const here = s.data.steps.find(x => x.step === step) ?? s.data.steps[0];
    if (!here) return NextResponse.json({ error: "This session has nothing left to teach: its materials were deleted." }, { status: 404 });
    step = here.step; stepIds = here.sections.map(x => x.chunkId); scopeIds = s.data.steps.flatMap(x => x.sections.map(y => y.chunkId)); recorded = true;
  } else {
    const ids = Array.isArray(body?.chunkIds) ? [...new Set((body.chunkIds as unknown[]).filter(isUuid))] as string[] : [];
    if (!ids.length) return NextResponse.json({ error: "Choose what to learn from." }, { status: 400 });
    scopeIds = ids.slice(0, 60); stepIds = scopeIds.slice(0, STEP_MAX_SECTIONS);
  }
  let passages: Passage[] | null;
  if (action === "ask") {
    const tsq = toTsQuery(question);
    const found = tsq ? await searchCandidates(ctx.admin, ctx.userId, tsq, { chunkIds: scopeIds }) : null;
    if (found && !found.ok) return NextResponse.json({ error: "Your notes could not be searched just now. Try again shortly." }, { status: 503 });
    const ranked = found?.ok ? spreadAcrossMaterials(rankChunks(question, found.data, 40), RETRIEVAL_LIMIT) : [];
    passages = ranked.length ? await toPassages(ctx.admin, ctx.userId, ranked) : await ownPassages(ctx.admin, ctx.userId, stepIds);
  } else passages = await ownPassages(ctx.admin, ctx.userId, stepIds);
  if (!passages?.length) return NextResponse.json({ error: "That section could not be found." }, { status: 404 });

  const pre = await aiPreflight(ctx);
  if (pre) return pre;

  // ── how to teach it: depth, the student's context, the governed references (L5 decides each) ──
  const pref = await getLearningPreference(ctx.admin, ctx.userId);
  const depth: ExplanationDepth = (EXPLANATION_DEPTHS as readonly string[]).includes(body?.depth) ? body.depth : pref?.depth ?? policy.scholarExplanationDepth;
  const [learner, learnerContext] = await Promise.all([loadLearnerCatalogue(ctx.admin, ctx.userId), loadTutorContext(ctx.admin, ctx.userId, passages.map(p => p.chunkId))]);
  const references = policy.scholarLearningObjectives === "outcomes" ? await governedReferences(ctx.admin, ctx.userId, passages.map(p => p.chunkId), learner.competencies) : [];
  const history: TutorTurn[] = (Array.isArray(body?.history) ? body.history : []).slice(-policy.scholarTutorTurns).flatMap((raw: unknown) => {
    const t = raw as { speaker?: unknown; text?: unknown } | null;
    return (t?.speaker === "tutor" || t?.speaker === "student") && typeof t.text === "string" && t.text.trim() ? [{ speaker: t.speaker, text: t.text.trim().slice(0, 1500) }] : [];
  });
  const prompt = action === "ask" ? question : action === "clarify" ? `Your check question was: ${checkQuestion}\nMy answer: ${answer}` : CANNED[action as LearnAction | "check"];

  const r = await runLearn(ctx.userId, { action: action as LearnAction | "check" | "clarify", question: prompt, passages, references, depth, background: policy.scholarBeyondNotes === "labelled", history, learnerContext });
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_learn", sessionId, {
    action, step, chunk_ids: passages.map(p => p.chunkId), depth, references: references.length, learner_context: learnerContext !== null, recorded,
    outcome: r.ok ? (action === "check" ? (r.question?.ok ? "shown" : `withheld:${r.question?.reason}`) : r.check.ok ? "shown" : `withheld:${r.check.reason}`) : `error:${r.error}`,
    flags: r.ok ? r.flags.kept.length : 0, verdict: r.ok ? r.verdict : null, model: r.ok ? r.model : null, prompt_version: r.ok ? r.promptVersion : null,
  });
  if (!r.ok) return NextResponse.json({ error: AI_ERROR[r.error].error }, { status: AI_ERROR[r.error].status });

  // ── the record: structure only, and only what was shown ──
  const shown = action === "check" ? !!r.question?.ok : r.check.ok;
  if (recorded && sessionId && shown && policy.scholarLearningHistory === "record") {
    await recordLearningEvent(ctx.admin, ctx.userId, { sessionId, step, action, verdict: r.verdict, chunkIds: passages.map(p => p.chunkId) });
    await updateLearningSession(ctx.admin, ctx.userId, sessionId, { currentStep: step });
  }

  const sources = passages.map((p, i) => ({ tag: passageTag(i), chunkId: p.chunkId, materialId: p.materialId, materialTitle: p.materialTitle, citation: passageCitation(p), excerpt: p.content.slice(0, 400) }));
  const base = { action, step, depth, label: AI_LABEL, provenance: { model: r.model, promptVersion: r.promptVersion }, sources, passageIds: passages.map(p => p.chunkId),
    references: references.map((x, i) => ({ tag: `R${i + 1}`, ...x })), kinds: SOURCE_KIND_LABEL };
  if (action === "check") {
    return NextResponse.json(r.question?.ok
      ? { ...base, checkQuestion: r.question.question, informal: INFORMAL_CHECK_LABEL }
      : { ...base, withheld: true, message: "A check question could not be written from these sections just now. Try again, or carry on learning." });
  }
  if (!r.check.ok) {
    const detail = r.check.reason === "ungrounded" && r.check.violations?.length ? ` (${describeViolations(r.check.violations)})` : "";
    return NextResponse.json({ ...base, withheld: true, reason: r.check.reason, message: EXPLAIN_REFUSAL[r.check.reason] + detail, notInNotes: r.check.reason === "not_in_notes" });
  }
  const b = r.background;
  return NextResponse.json({
    ...base,
    answer: r.check.text,
    cited: r.check.cited,
    background: !b || (!b.ok && b.reason === "not_this_mode") ? null : b.ok ? { text: b.text, label: SUPPLEMENTARY_LABEL } : { withheld: SUPPLEMENTARY_WITHHELD[b.reason as Exclude<typeof b.reason, "not_this_mode">] },
    flags: r.flags.kept,
    verdict: r.verdict ? { value: r.verdict, label: CHECK_VERDICT_LABEL[r.verdict], informal: INFORMAL_CHECK_LABEL } : null,
  });
}
