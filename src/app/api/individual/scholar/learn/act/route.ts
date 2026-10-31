// Allow up to 60s for AI generation -- the same ceiling the personal AI uses.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { recordScholarOutcome } from "@/lib/individual/scholar/outcome";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import {
  findArtefact, getLearningPreference, getLearningSession, getPassage, isUuid, listArtefacts, listExamPapers, recordLearningEvent, saveArtefact, searchCandidates, toPassages, updateLearningSession,
  type ArtefactRow,
} from "@/lib/individual/scholar/store";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { purposeFrom } from "@/lib/individual/pilot-ai";

import { AI_ERROR, SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, meteredRefusal, refusalWords, withinRequestRisk, scholarAiRunner, scholarRisk, scholarRiskGate } from "@/lib/individual/scholar/http";
import { rankChunks, spreadAcrossMaterials, toTsQuery } from "@/lib/individual/scholar/retrieval";
import {
  RESEARCH_ACTIONS, RESEARCH_MARKER, RESEARCH_WITHHELD, SUPPLEMENTARY_WITHHELD, describeViolations, learnPromptVersion, learnResearchPromptVersion, passageCitation, passageTag, runLearn, splitLearnAnswer,
  type Passage, type TutorTurn,
} from "@/lib/individual/scholar/generation";
import { loadLearnerCatalogue, loadTutorContext } from "@/lib/individual/scholar/competency-view";
import { LESSON_MAX_SECTIONS, TEACH_THIN_CHARS, artefactKey, governedReferences, isArtefactAction, lessonOutline, libraryReferences, referenceSource, relabelReferences, sectionProfile, type LessonOutline } from "@/lib/individual/scholar/learn";
import { externalReferences, learnResearch, researchEvidence, scholarResearchOperational, type LearnResearch } from "@/lib/individual/scholar/learn-research";
import { qualityOf } from "@/lib/individual/scholar/source-quality";
import { topicsOfSections } from "@/lib/individual/scholar/store";
import type { LearnSourceMode } from "@/lib/individual/policy";
import { withheldNext } from "@/lib/individual/scholar/learn-view";
import { groundingOutcome, keyTermsOf, parseRecoveryRequest, recordRecoveryResult, recoveredReply, rederiveRecovery, relatedSections, widerMode, type Grounding, type Rederived } from "@/lib/individual/scholar/evidence-recovery";
import type { RecoveryMode } from "@/lib/individual/policy";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { studySessionBlock } from "@/lib/individual/scholar/study-context";
import {
  AI_LABEL, CHECK_VERDICT_LABEL, EXPLANATION_DEPTHS, INFORMAL_CHECK_LABEL, QUESTION_MAX, RECOVERY_STILL_WITHHELD, RESEARCH_READING_ONLY, RETRIEVAL_LIMIT, SOURCE_KIND_LABEL, SUPPLEMENTARY_LABEL,
  isLearnAction, type ExplanationDepth, type LearnAction,
} from "@/lib/individual/scholar/config";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/learn/act -- COMPETEN-SCHOLAR-LEARN-01 L2 and L3, one learning action.
//
// Body { action, sessionId?, step?, chunkIds?, question?, checkQuestion?, answer?, history?, depth?, purpose? }.
//   purpose  "education" only: the student's answer to a clarify question (AI operating modes), the same request resent as study.
//   action  teach | explain | simplify | deeper | examples | summary | ask  (the policy's, L5)
//           check (write an informal check question) | clarify (judge the answer to it, and clarify)
// The passages are the step's own sections, read by the caller's id (a recorded session's, or -- for a session the
// browser holds -- the chunk ids it sends, each looked up as the caller's own). Ask Scholar searches within the
// session's sections first. Everything runs on the ONE Scholar engine (generation.ts runLearn): the notes part is
// cited and checked, background and AI flags are split off and checked, and nothing is shown ungrounded.
// Nothing the AI says or the student types is stored. A recorded session gets one event: the action, the step,
// the sections used and, for a clarification, the informal verdict -- never assessment, never competence.
//
// AI-FAIR-USE-01 s8, NOT REGENERATED: a reusable answer (teach, explain, simplify, deeper, examples, summary, with no
// conversation) is saved as an artefact, and the same request returns the saved one with no AI call -- unless the
// student asks for a new one ({ fresh: true }), which replaces it. s7, CONTINUITY: when new AI is not available
// (the student's standing, or the allowance refusing), the answer says so plainly and returns what is saved for these
// sections. Nothing claims a new AI answer was made.

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
  // COMPETEN-RESEARCH-01: what this request may draw on. Notes only unless the learner chose otherwise, for this request,
  // and policy offers it. A check question and a clarification are always notes only.
  const askedMode = typeof body?.mode === "string" ? body.mode as LearnSourceMode : "notes";
  if (!policy.scholarResearch.modes.includes(askedMode)) return NextResponse.json({ error: "That way of learning is not offered here." }, { status: 403 });
  // ADDENDUM V2: an inactive mode is never available -- research only while the engine has it operational.
  if (askedMode === "research" && !(await scholarResearchOperational(ctx.admin))) return NextResponse.json({ error: "Research & Explain is not available on Scholar at the moment." }, { status: 403 });
  const mode: LearnSourceMode = RESEARCH_ACTIONS.includes(action as LearnAction) ? askedMode : "notes";
  // SCHOLAR-SQIE-02, "Explain using approved references": recovery { id, mode, question }. Only those are read -- never
  // evidence, ids or text -- and the evidence is found again on the server below. A check or clarification never takes one.
  const recoveryAsked = isCheck ? null : parseRecoveryRequest(body?.recovery, "notes_only", QUESTION_MAX);
  if (recoveryAsked && !recoveryAsked.ok) return NextResponse.json({ error: recoveryAsked.error }, { status: 400 });
  const recovery = recoveryAsked?.value ?? null;

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
  let recorded = false, stepTitle: string | null = null, sessionMaterials: string[] = [];
  if (sessionId) {
    const s = await getLearningSession(ctx.admin, ctx.userId, sessionId);
    if (!s.ok) return NextResponse.json({ error: "Your session could not be read just now." }, { status: 503 });
    if (!s.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const here = s.data.steps.find(x => x.step === step) ?? s.data.steps[0];
    if (!here) return NextResponse.json({ error: "This session has nothing left to teach: its materials were deleted." }, { status: 404 });
    step = here.step; stepIds = here.sections.map(x => x.chunkId); scopeIds = s.data.steps.flatMap(x => x.sections.map(y => y.chunkId)); recorded = true; stepTitle = s.data.session.topic ?? s.data.session.title ?? null;
    sessionMaterials = [...new Set(s.data.steps.flatMap(x => x.sections.map(y => y.materialId)))];
  } else {
    const ids = Array.isArray(body?.chunkIds) ? [...new Set((body.chunkIds as unknown[]).filter(isUuid))] as string[] : [];
    if (!ids.length) return NextResponse.json({ error: "Choose what to learn from." }, { status: 400 });
    scopeIds = ids.slice(0, 60); stepIds = scopeIds.slice(0, LESSON_MAX_SECTIONS);
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
  if (!sessionMaterials.length) sessionMaterials = [...new Set(passages.map(p => p.materialId))];

  // ── SCHOLAR-LEARN-FIX-01: the lesson, its key terms and how well its passages hold them (no AI) ──
  // The lesson's title and objective come from its own sections' headings and topics (learn.lessonOutline). A thin or
  // partly grounded lesson is given the most relevant OTHER sections of the session's own material(s) -- and, only in a
  // source mode wider than My notes only, another upload that holds most of its key terms (relatedSections) -- up to
  // RETRIEVAL_LIMIT, after its own sections, so its [S n] tags come first. Ask already searches the session. Not for an
  // explanation from recovery, which brings its own evidence. Every read is keyed on the learner's id.
  const lesson: LessonOutline | null = action === "ask" ? null
    : lessonOutline({ step, sections: passages.map(p => ({ chunkId: p.chunkId, materialId: p.materialId, ordinal: p.ordinal, pageFrom: p.pageFrom, pageTo: p.pageTo, materialTitle: p.materialTitle, unit: p.unit ?? "page" })) },
      await topicsOfSections(ctx.admin, ctx.userId, passages.map(p => p.chunkId)), new Map(passages.map(p => [p.chunkId, sectionProfile(p.content)])));
  const lessonTerms = action === "ask" ? keyTermsOf(question) : lesson ? keyTermsOf(lesson.focus.join(" ")).slice(0, 8) : [];
  let grounding: Grounding = groundingOutcome(lessonTerms, passages);
  const related = { sameMaterial: 0, otherMaterials: 0 };
  const thin = passages.reduce((n, p) => n + p.content.length, 0) < TEACH_THIN_CHARS;
  if (isArtefactAction(action) && !recovery && lessonTerms.length && (thin || grounding.outcome !== "sufficient")) {
    const tsq = toTsQuery(lessonTerms.join(" "));
    const others = RESEARCH_ACTIONS.includes(action as LearnAction) && askedMode !== "notes";
    const [same, wide, papers] = tsq ? await Promise.all([
      searchCandidates(ctx.admin, ctx.userId, tsq, { materialIds: sessionMaterials }),
      others ? searchCandidates(ctx.admin, ctx.userId, tsq, null) : Promise.resolve(null),
      others ? listExamPapers(ctx.admin, ctx.userId) : Promise.resolve(null),
    ]) : [null, null, null];
    // An unreadable paper list: no other uploads at all (an examination paper is never notes that answer it).
    const exclude = papers?.ok ? new Set(papers.data.map(p => p.materialId)) : null;
    const pool = [...(same?.ok ? same.data : []), ...(wide?.ok && exclude ? wide.data : [])];
    const picked = relatedSections(pool, { have: passages.map(p => p.chunkId), terms: lessonTerms, covered: grounding.covered, materialIds: sessionMaterials, others: others && !!exclude, exclude: exclude ?? undefined, limit: RETRIEVAL_LIMIT });
    if (picked.length) {
      passages = [...passages, ...(await toPassages(ctx.admin, ctx.userId, picked))];
      related.sameMaterial = picked.filter(c => sessionMaterials.includes(c.materialId)).length;
      related.otherMaterials = picked.length - related.sameMaterial;
      grounding = groundingOutcome(lessonTerms, passages);
    }
  }
  // What L-B renders: sufficient -> teach; partial -> teach what is supported, name uncoveredTerms, offer `wider`;
  // insufficient -> the existing evidence recovery. `wider` is the next recovery mode the learner may choose.
  const wider: RecoveryMode | null = grounding.outcome === "sufficient" ? null : mode === "notes" ? "notes_and_library"
    : mode === "library" ? widerMode("notes_and_library", policy, await scholarResearchOperational(ctx.admin).catch(() => false)) : null;
  const lessonFields = { lesson: lesson ? { title: lesson.title, objective: lesson.objective } : null, grounding: { ...grounding, related, wider } };

  // ── how to teach it: depth and the governed references (L5 decides each). No AI yet. ──
  const pref = await getLearningPreference(ctx.admin, ctx.userId);
  const depth: ExplanationDepth = (EXPLANATION_DEPTHS as readonly string[]).includes(body?.depth) ? body.depth : pref?.depth ?? policy.scholarExplanationDepth;
  const learner = await loadLearnerCatalogue(ctx.admin, ctx.userId);
  // Stage 3 acceptance item 5: the governed reference source is policy (the CFCA by default), and a saved answer's
  // references are labelled by it as it is now -- "clinically approved" only for content 395 approved as it stands.
  const refSource = await referenceSource(ctx.admin, policy, learner.competencies);
  const linked = policy.scholarLearningObjectives === "outcomes" ? await governedReferences(ctx.admin, ctx.userId, passages.map(p => p.chunkId), refSource) : [];
  // COMPETEN-RESEARCH-01: the library modes add the Competen library entries matching the topic (no external call).
  const topics = mode === "notes" ? [] : [...new Set([...(await topicsOfSections(ctx.admin, ctx.userId, passages.map(p => p.chunkId))).values()].flat())];
  let references = mode === "notes" ? linked : [...linked, ...libraryReferences([action === "ask" ? question : "", stepTitle ?? "", ...topics].join(" "), refSource, linked)];
  const background = policy.scholarBeyondNotes === "labelled" && mode !== "research";

  // ── s8: a saved artefact for exactly this request is returned, not regenerated ──
  const hasHistory = Array.isArray(body?.history) && body.history.length > 0;
  const oneMaterial = new Set(passages.map(p => p.materialId)).size === 1;
  const storable = isArtefactAction(action) && !hasHistory && oneMaterial;
  const promptVersion = mode === "research" ? learnResearchPromptVersion(action as LearnAction) : learnPromptVersion(action as LearnAction);
  // SCHOLAR-SQIE-02: an explanation from recovered evidence is never a saved artefact, and never served from one.
  const key = storable && !recovery ? artefactKey({ action, depth, chunkIds: passages.map(p => p.chunkId), promptVersion, references, background, mode }) : null;
  const savedReply = (a: ArtefactRow, extra: Record<string, unknown> = {}) => {
    const byId = new Map(passages!.map(p => [p.chunkId, p]));
    const src = a.sources.map(id => byId.get(id)).filter((p): p is Passage => !!p);
    // COMPETEN-RESEARCH-01: a saved Research & Explain answer keeps its research part after the marker, and its
    // external references (kind "external") beside the governed ones -- exactly as the providers returned them.
    const split = splitLearnAnswer(a.content);
    const external = a.refs.filter(r => r?.kind === "external");
    return {
      action, step, depth: a.depth, label: AI_LABEL, provenance: { model: a.model, promptVersion: a.promptVersion }, kinds: SOURCE_KIND_LABEL,
      sources: src.map((p, i) => ({ tag: passageTag(i), chunkId: p.chunkId, materialId: p.materialId, materialTitle: p.materialTitle, citation: passageCitation(p), excerpt: p.content.slice(0, 400) })),
      passageIds: src.map(p => p.chunkId), references: relabelReferences(a.refs, refSource), answer: split.research !== null ? split.main : a.content, cited: src.map((_, i) => i + 1),
      background: a.background ? { text: a.background, label: SUPPLEMENTARY_LABEL } : null, flags: a.flags, verdict: null,
      research: external.length ? { state: "cached", label: SOURCE_KIND_LABEL.research, message: null, references: external, ...(split.research ? { text: split.research } : {}) } : null,
      saved: { at: a.createdAt, reviewStatus: a.reviewStatus }, artefactId: a.id, ...lessonFields, ...extra,
    };
  };
  if (key && body?.fresh !== true) {
    const saved = await findArtefact(ctx.admin, ctx.userId, key);
    if (saved && saved.sources.every(id => passages!.some(p => p.chunkId === id))) {
      if (recorded && sessionId && policy.scholarLearningHistory === "record") {
        await recordLearningEvent(ctx.admin, ctx.userId, { sessionId, step, action, verdict: null, chunkIds: saved.sources });
        await updateLearningSession(ctx.admin, ctx.userId, sessionId, { currentStep: step });
      }
      return NextResponse.json(savedReply(saved));
    }
  }

  // ── s7: continuity -- no new AI where the standing (or the allowance) says no; what is saved stays available ──
  const continuity = async (message: string, insufficient: boolean) => {
    const saved = await listArtefacts(ctx.admin, ctx.userId, { chunkIds: passages!.map(p => p.chunkId) });
    return NextResponse.json({ action, step, ...lessonFields, continuity: { message, insufficient }, saved: saved.ok ? saved.data.slice(0, 5).map(a => savedReply(a)) : [] });
  };
  const standing = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), action as "teach");
  if (!standing.available) return continuity(standing.message ?? "", standing.insufficient);
  const pre = await aiPreflight(ctx);
  if (pre) {
    if (pre.status === 429) return continuity(((await pre.clone().json().catch(() => ({}))) as { error?: string }).error ?? "Your AI allowance is used up for now.", false);
    return pre;
  }
  const learnerContext = await loadTutorContext(ctx.admin, ctx.userId, passages.map(p => p.chunkId));
  // SCHOLAR-SESSION-AI-02 slice C (owner D4): an ask in the caller's OWN connected study session (policy on, 740 present)
  // also carries the session block -- database reads only, no AI call, under the learner-context rule (emphasis, never
  // grounding, never cited). Any other session, or the gate off: null, and the ask is exactly as before.
  const study = action === "ask" && recorded && sessionId
    ? await studySessionBlock(ctx.admin, ctx.userId, sessionId, { policy, competencyTitle: id => learner.competencies?.find(c => c.id === id)?.title ?? null })
    : null;
  const history: TutorTurn[] = (Array.isArray(body?.history) ? body.history : []).slice(-policy.scholarTutorTurns).flatMap((raw: unknown) => {
    const t = raw as { speaker?: unknown; text?: unknown } | null;
    return (t?.speaker === "tutor" || t?.speaker === "student") && typeof t.text === "string" && t.text.trim() ? [{ speaker: t.speaker, text: t.text.trim().slice(0, 1500) }] : [];
  });
  const prompt = action === "ask" ? question : action === "clarify" ? `Your check question was: ${checkQuestion}\nMy answer: ${answer}` : CANNED[action as LearnAction | "check"];

  // AI-FAIR-USE-01: through the Holdings allowance, the learning action as the activity. A refusal becomes
  // Learning Continuity (s7): said plainly, with what is saved for these sections -- and nothing was sent.
  // SCHOLAR-SQIE-02: the recovery's evidence, re-derived from the learner's rows, the governed library and the engine
  // (its cache: the search was already made when the recovery was), added to this step's own passages and references.
  // Nothing to explain from: said, with what remains unanswered, and no AI call. The request's risk is then classified
  // on everything the model will read, as for every Learn request.
  let recovered: Rederived | null = null;
  if (recovery) {
    recovered = await rederiveRecovery(ctx, policy, recovery, { materialId: passages[0].materialId, sectionId: passages[0].chunkId, scopeMaterialIds: sessionMaterials });
    if (!recovered.ok && recovered.reason === "unknown") return NextResponse.json({ error: "Those learning resources could not be found. Look for them again." }, { status: 400 });
    if (!recovered.ok)
      return NextResponse.json({ action, step, depth, label: AI_LABEL, kinds: SOURCE_KIND_LABEL, ...lessonFields, sources: [], passageIds: passages.map(p => p.chunkId), references: [], withheld: true, reason: "no_evidence", message: RECOVERY_STILL_WITHHELD, recovered: recoveredReply(recovered, false) });
    const own = passages;
    passages = [...own, ...recovered.inputs.passages.filter(p => !own.some(x => x.chunkId === p.chunkId))].slice(0, LESSON_MAX_SECTIONS + RETRIEVAL_LIMIT);
    const have = references;
    references = [...have, ...recovered.inputs.references.filter(x => !have.some(y => y.competencyId === x.competencyId))];
  }
  const risk = await scholarRisk(ctx.admin, ctx.userId, { text: prompt, passages, purpose: purposeFrom(body) });
  // COMPETEN-RESEARCH-01, research workflow. DISCOVERY IS NOT GENERATION (commissioning GO, 28 Oct):
  //   (1) the REQUEST's clinical risk is classified as for every Learn request (its prompt and passages). With metering
  //       OFF the same gate decides BEFORE any search, so a request no model is eligible for is refused before anything
  //       is sent to a research source -- high-risk generation stays refused exactly as without research.
  //   (3-5) discovery: search, retrieve, verify (learn-research.ts). Every verified abstract may inform the answer, even
  //       one that mentions medicines: reading published research is not clinical advice, and dropping it used to
  //       exclude most legitimate educational evidence (about 4 of 5 abstracts on an oxygen-therapy step).
  //   (6-7) generation runs on the REQUEST's risk and its eligible model, unchanged. What the research part SAYS is then
  //       classified by the same published rules: research text that would lift the request above its own tier (a dose,
  //       a medication instruction) is withheld as risk_raised, on top of the dosing and grounding checks.
  // The runner is built first so the research it pays for carries the same action id as the AI call and its outcome.
  const ai = scholarAiRunner(ctx, req, action as LearnAction | "check" | "clarify", risk);
  let research: LearnResearch | null = null;
  if (mode === "research") {
    const gate = await scholarRiskGate(ctx, action as LearnAction, risk);
    // AI operating modes: a clarify question is put to the student, not shown as a refusal. Nothing was sent anywhere.
    if (gate?.error === "clarify_purpose") return meteredRefusal(gate)!;
    if (gate) { const w = refusalWords(gate); return continuity(w.message, w.insufficient); }
    // SCHOLAR-SOURCE-QUALITY-01: the result comes back GATED (source-quality.ts), so only abstracts that pass the HQ
    // source-quality rules can reach generation below; the rest are listed as reading only.
    research = await learnResearch(ctx, policy.scholarResearch, { question: action === "ask" ? question : null, topics, title: stepTitle }, ai.actionId, null, qualityOf(policy.scholarRecovery));
  }
  const evidence = [...(research ? researchEvidence(research) : []), ...(recovered?.ok ? recovered.inputs.research : [])];
  const r = await runLearn(ctx.userId, { action: action as LearnAction | "check" | "clarify", question: prompt, passages, references, depth, background, history, learnerContext, research: evidence, studyContext: study?.text ?? null }, ai.run);
  const refusal = ai.refusal();
  if (refusal?.error === "clarify_purpose") return meteredRefusal(refusal)!;
  if (refusal) { const w = refusalWords(refusal); return continuity(w.message, w.insufficient); }
  // SCHOLAR-AI-OPT-01: the outcome of this one action, codes only. A check question is not an explanation.
  // COMPETEN-RESEARCH-01: a research answer is its own operation; the notes part and the research part each count.
  let rr = r.ok ? r.research : null;
  if (rr?.ok && !(await withinRequestRisk(ctx.admin, action as LearnAction, risk, [rr.text]))[0]) rr = { ok: false, reason: "risk_raised" };
  const researchCodes = research ? [`research_${research.state}`, ...research.codes, ...(rr ? [rr.ok ? "research_shown" : `research_${rr.reason}`] : [])] : [];
  await recordScholarOutcome(ctx.admin, ai, {
    operation: `${mode === "research" ? "individual_scholar_learn_research" : "individual_scholar_learn"}:${action}`, outputKind: action === "check" ? "other" : "explanation",
    promptVersion: r.ok ? r.promptVersion : null, configVersion: `depth:${depth}${mode === "notes" ? "" : `;mode:${mode}`}`,
    ...(!r.ok ? { outcome: "error" as const, reasons: [`error_${r.error}`, ...researchCodes] }
      : action === "check" ? (r.question?.ok ? { outcome: "accepted" as const, accepted: 1 } : { outcome: "rejected" as const, rejected: 1, reasons: [r.question?.reason ?? "malformed"] })
        : (() => {
          const accepted = (r.check.ok ? 1 : 0) + (rr?.ok ? 1 : 0), rejected = (r.check.ok ? 0 : 1) + (rr && !rr.ok ? 1 : 0);
          return { outcome: accepted ? (rejected ? "partial" as const : "accepted" as const) : "rejected" as const, accepted, rejected, reasons: [...(r.check.ok ? [] : [r.check.reason]), ...researchCodes] };
        })()),
  });
  if (recovery && recovered?.ok) await recordRecoveryResult(ctx.admin, recovery.id, r.ok && action !== "check" && r.check.ok);
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_learn", sessionId, {
    action_id: ai.actionId, purpose: purposeFrom(body),
    action, step, chunk_ids: passages.map(p => p.chunkId), depth, references: references.length, learner_context: learnerContext !== null, recorded,
    // SCHOLAR-SESSION-AI-02: which study-session sections reached the prompt (names only, never the text).
    study_context: study ? study.sections : null,
    outcome: r.ok ? (action === "check" ? (r.question?.ok ? "shown" : `withheld:${r.question?.reason}`) : r.check.ok ? "shown" : `withheld:${r.check.reason}`) : `error:${r.error}`,
    // SCHOLAR-AI-OPT-01: what the grounding check refused, in its own words ("the number one"), never the answer text.
    withheld_detail: r.ok && action !== "check" && !r.check.ok && r.check.violations?.length ? describeViolations(r.check.violations) : null,
    flags: r.ok ? r.flags.kept.length : 0, verdict: r.ok ? r.verdict : null, model: r.ok ? r.model : null, prompt_version: r.ok ? r.promptVersion : null,
    ...(mode !== "notes" ? { mode, research: research ? { state: research.state, items: research.items.length, evidence: evidence.length, outcome: rr ? (rr.ok ? "shown" : `withheld:${rr.reason}`) : null } : null } : {}),
  });
  if (!r.ok) return NextResponse.json({ error: AI_ERROR[r.error].error }, { status: AI_ERROR[r.error].status });

  // ── the record: structure only, and only what was shown ──
  const shown = action === "check" ? !!r.question?.ok : r.check.ok;
  if (recorded && sessionId && shown && policy.scholarLearningHistory === "record") {
    await recordLearningEvent(ctx.admin, ctx.userId, { sessionId, step, action, verdict: r.verdict, chunkIds: passages.map(p => p.chunkId) });
    await updateLearningSession(ctx.admin, ctx.userId, sessionId, { currentStep: step });
  }

  const sources = passages.map((p, i) => ({ tag: passageTag(i), chunkId: p.chunkId, materialId: p.materialId, materialTitle: p.materialTitle, citation: passageCitation(p), excerpt: p.content.slice(0, 400) }));
  const base = { action, step, depth, label: AI_LABEL, provenance: { model: r.model, promptVersion: r.promptVersion }, sources, passageIds: passages.map(p => p.chunkId), actionId: ai.actionId,
    references: references.map((x, i) => ({ tag: `R${i + 1}`, ...x })), kinds: SOURCE_KIND_LABEL, ...lessonFields,
    ...(recovered ? { recovered: recoveredReply(recovered, action !== "check" && r.check.ok) } : {}),
    // COMPETEN-RESEARCH-01: external research, apart from the notes, with the providers' own records. Never mixed in.
    research: research ? {
      state: research.state, label: SOURCE_KIND_LABEL.research, query: research.query, scholarLink: research.scholarLink, references: externalReferences(research),
      message: research.message ?? (evidence.length && !rr ? "The research found did not add to this request, so nothing from it is shown." : !evidence.length && Object.keys(research.notUsed ?? {}).length ? RESEARCH_READING_ONLY
          : !evidence.length && research.items.length ? "Research found records without a verified abstract: listed as further reading only." : null),
      ...(rr ? (rr.ok ? { text: rr.text, cited: rr.cited } : { withheld: RESEARCH_WITHHELD[rr.reason] }) : {}),
    } : null };
  if (action === "check") {
    return NextResponse.json(r.question?.ok
      ? { ...base, checkQuestion: r.question.question, informal: INFORMAL_CHECK_LABEL }
      : { ...base, withheld: true, message: "A check question could not be written from these sections just now. Try again, or carry on learning." });
  }
  if (!r.check.ok) {
    // Stage 3 acceptance item 4: why, plainly, and next steps from the notes only. The withheld text is never sent.
    const detail = r.check.reason === "ungrounded" && r.check.violations?.length ? describeViolations(r.check.violations) : null;
    const next = withheldNext({ reason: r.check.reason, detail, sources, askOffered: policy.scholarLearningActions.includes("ask"), background: r.background, backgroundAllowed: background });
    return NextResponse.json({ ...base, withheld: true, reason: r.check.reason, message: next.why, notInNotes: next.notInNotes, next });
  }
  const b = r.background;
  // s8: the shown answer is saved for next time (private formative; replaced when the student asks for a new one).
  let savedNow: "ok" | "not_provisioned" | "failed" | null = null;
  if (key) savedNow = await saveArtefact(ctx.admin, ctx.userId, {
    materialId: passages[0].materialId, action, depth, content: rr?.ok ? `${r.check.text}

${RESEARCH_MARKER}
${rr.text}` : r.check.text, background: b?.ok ? b.text : null, flags: r.flags.kept,
    refs: [...references.map((x, i) => ({ tag: `R${i + 1}`, ...x })), ...(research ? externalReferences(research) : [])], dedupeKey: key, model: r.model, promptVersion: r.promptVersion, chunkIds: passages.map(p => p.chunkId),
  });
  return NextResponse.json({
    ...base,
    answer: r.check.text,
    cited: r.check.cited,
    background: !b || (!b.ok && b.reason === "not_this_mode") ? null : b.ok ? { text: b.text, label: SUPPLEMENTARY_LABEL } : { withheld: SUPPLEMENTARY_WITHHELD[b.reason as Exclude<typeof b.reason, "not_this_mode">] },
    flags: r.flags.kept,
    verdict: r.verdict ? { value: r.verdict, label: CHECK_VERDICT_LABEL[r.verdict], informal: INFORMAL_CHECK_LABEL } : null,
    savedForLater: savedNow === "ok",
  });
}
