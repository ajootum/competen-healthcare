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
  RESEARCH_ACTIONS, RESEARCH_MARKER, RESEARCH_PROMPT_SUFFIX, RESEARCH_WITHHELD, SUPPLEMENTARY_WITHHELD, describeViolations, legacyLearnPromptVersions, learnPromptVersion, learnResearchPromptVersion, passageCitation, passageTag, runLearn, splitLearnAnswer,
  type Passage, type TutorTurn,
} from "@/lib/individual/scholar/generation";
import { loadLearnerCatalogue, loadTutorContext } from "@/lib/individual/scholar/competency-view";
import { LESSON_MAX_SECTIONS, TEACH_THIN_CHARS, artefactKey, governedReferences, isArtefactAction, lessonOutline, libraryReferences, referenceSource, relabelReferences, sectionProfile, type LessonOutline } from "@/lib/individual/scholar/learn";
import { contextOf, externalReferences, learnResearch, restoreResearch, researchEvidence, scholarResearchOperational, withLessonScope, withdrawDeclaredIrrelevant, type ExternalReference, type LearnResearch, type LessonScope } from "@/lib/individual/scholar/learn-research";
import { qualityOf } from "@/lib/individual/scholar/source-quality";
import { findSavedLesson, materialQualities, topicsOfSections } from "@/lib/individual/scholar/store";
import { aiReadByMaterial, aiReadMark } from "@/lib/individual/scholar/learn-ai-read";
import { parseSpellingVariant } from "@/lib/individual/scholar/spelling-variant";
import { SAVED_EARLIER_LABEL } from "@/lib/individual/scholar/learn-journey";
import { normaliseLearnerText, vocabularyOf } from "@/lib/individual/scholar/spelling";
import type { LearnSourceMode } from "@/lib/individual/policy";
import { withheldNext } from "@/lib/individual/scholar/learn-view";
import { groundingOutcome, keyTermsOf, parseRecoveryRequest, recordRecoveryResult, recoveredReply, rederiveRecovery, relatedSections, widerMode, type Grounding, type Rederived } from "@/lib/individual/scholar/evidence-recovery";
import type { RecoveryMode } from "@/lib/individual/policy";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { studySessionBlock } from "@/lib/individual/scholar/study-context";
import {
  AI_LABEL, CHECK_VERDICT_LABEL, EXPLANATION_DEPTHS, INFORMAL_CHECK_LABEL, QUESTION_MAX, RECOVERY_STILL_WITHHELD, RESEARCH_READING_ONLY, RETRIEVAL_LIMIT, SOURCE_KIND_LABEL, SUPPLEMENTARY_LABEL,
  isLearnAction, type ClassicLearnAction, type ExplanationDepth, type LearnAction,
} from "@/lib/individual/scholar/config";
import { challengeNextLevels, eventVerdict, extractQuestion, isTeachingAction, learningEventAction, meteredActivity, parseTeachingRequest, teachingPrompt, teachingTexts } from "@/lib/individual/scholar/learn-teaching";
import { examEvidenceFor } from "@/lib/individual/scholar/exam-evidence";
import type { ScholarAiActivity } from "@/lib/individual/scholar/ai-standing";
import {
  DUPLICATE_IN_FLIGHT, DUPLICATE_RETRY, DUPLICATE_WITHHELD, LEARN_ENTITY, LEARN_SERVED_ACTION, SALVAGE_NOTE, claimFlight, endFlight, flightActive, later, salvagedCount, salvagedPromptVersion, stageTimer, waitForFlight, type Flight,
} from "@/lib/individual/scholar/learn-flight";

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
//
// SCHOLAR-COMPANION-01 P1 (owner, 31 Oct): six TEACHING actions on the same path (learn-teaching.ts), grounded on the step's
// passages exactly like Teach me (same risk gate on what the learner typed, standing, preflight, metering, maxDuration):
//   ask_me     { level? }                          -> answer (markdown), checkQuestion, level, informal   (the learner's reply goes to `clarify`)
//   challenge  { level? }                          -> as ask_me, plus nextLevel { understood, partly, not_yet } (the client holds the rung)
//   guide      { hintLevel: 1|2|3, attempt?, question? } -> answer = the hint only, hintLevel, nextHintLevel, explainDirectly { action: "explain" }
//   mistake    { question, learnerAnswer }         -> answer (right / misconceptions / why / quick check)
//   teach_back { explanation }                     -> answer + verdict (parseVerdict), like clarify
//   high_yield { depth? }                          -> answer (key concepts ... ), examEvidence { papers, questions } | null
// None is a saved artefact (415's CHECK) or a flight; learning_event.action and the metered activity are mapped onto existing
// values (learn-teaching.ts header). Nothing the learner types is stored.
//
// SCHOLAR-GUIDED-LEARNING-01 (owner, 31 Oct):
//   { open: true }     OPEN A LESSON: the saved answer if there is one (cached: true), otherwise { open: "generate" } or
//                      { open: "in_flight" } -- never an AI call, never a standing or allowance read.
//   { prepare: true }  PREPARE THE NEXT LESSON (teach only, a recorded session, policy scholar_learn_prepare_next on):
//                      the session's next step after the current one, at most one ahead, only when nothing is saved for
//                      it and nothing is writing it, and only while the standing and allowance allow it. Same metered
//                      runner and checks; nothing is recorded as learning; the audit row says prepared: true.
//   CACHE FIRST: a saved Teach Me under an earlier prompt version (LEARN_TEACH_LEGACY) is still served, with no AI call.
//   SCHOLAR-PERSISTENT-LEARNING-01 (owner, 1 Nov): an OPEN (or a prepare) that the exact key misses falls back to the
//   newest saved artefact of the same action for this learner, material and the lesson's own chunk set -- any prompt
//   version, depth or mode (store.ts findSavedLesson) -- labelled savedEarlier when it differs. Never generated. Opening
//   a lesson is a read: it records the learning event, but never moves the session's current_step (the learner's
//   explicit choice does that, through PATCH sessions/[id]).
//   DEDUPE: two identical requests never both call the AI (learn-flight.ts claimFlight); the later one is served the
//   first one's lesson. TIMINGS: every audit row carries timing_ms by stage. SALVAGE: a Teach Me lesson whose
//   unsupported parts were left out (generation.ts checkTeachAnswer) carries salvage { removed, note }.

const CANNED: Record<ClassicLearnAction | "check", string> = {
  teach: "Teach me this step.", explain: "Explain this.", simplify: "Explain this as simply as possible.", deeper: "Help me understand this in more depth.",
  examples: "Give me examples of this in practice.", summary: "Summarise the important learning points.", ask: "", check: "Check my understanding of this.",
};

async function ownPassages(admin: unknown, userId: string, ids: readonly string[]): Promise<Passage[] | null> {
  const found = await Promise.all(ids.map(id => getPassage(admin, userId, id)));
  return found.some(p => !p) ? null : (found as Passage[]);
}

export async function POST(req: Request) {
  const clock = stageTimer();
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  // Independent: the body and the policy are read together.
  const [body, policy] = await Promise.all([req.json().catch(() => ({})), loadIndividualPolicy(ctx.admin)]);
  clock.mark("auth_policy");

  // ── the action, as policy allows it ──
  const action = body?.action as string;
  const isCheck = action === "check" || action === "clarify";
  const teaching = isTeachingAction(action);
  if (!isLearnAction(action) && !isCheck) return NextResponse.json({ error: "Unknown learning action." }, { status: 400 });
  if (isLearnAction(action) && !policy.scholarLearningActions.includes(action)) return NextResponse.json({ error: "That way of learning is not offered here." }, { status: 403 });
  // SCHOLAR-GUIDED-LEARNING-01: open (no AI ever) and prepare (the next lesson, policy-gated, default off).
  const prepare = body?.prepare === true, open = body?.open === true && !prepare;
  const notPrepared = (reason: string, extra: Record<string, unknown> = {}) => NextResponse.json({ prepared: false, reason, ...extra });
  if (prepare && action !== "teach") return notPrepared("not_teach");
  if (prepare && !policy.scholarLearnPrepareNext) return notPrepared("off");
  if (open && !isArtefactAction(action)) return NextResponse.json({ error: "Only a saved kind of explanation can be opened." }, { status: 400 });
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
  const recoveryAsked = isCheck || teaching ? null : parseRecoveryRequest(body?.recovery, "notes_only", QUESTION_MAX);
  if (recoveryAsked && !recoveryAsked.ok) return NextResponse.json({ error: recoveryAsked.error }, { status: 400 });
  const recovery = recoveryAsked?.value ?? null;
  if (prepare && recovery) return notPrepared("recovery");
  // Independent of the passages: started now, awaited where they are used (no serial wait). A rejection still
  // surfaces where it is awaited, exactly as before.
  const prefP = getLearningPreference(ctx.admin, ctx.userId), learnerP = loadLearnerCatalogue(ctx.admin, ctx.userId);
  prefP.catch(() => {}); learnerP.catch(() => {});

  // ── what the student typed: bounded and screened, never stored ──
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const question = text(body?.question), checkQuestion = text(body?.checkQuestion), answer = text(body?.answer);
  if (action === "ask" && (!question || question.length > QUESTION_MAX)) return NextResponse.json({ error: `Ask a question of up to ${QUESTION_MAX} characters.` }, { status: 400 });
  if (action === "clarify" && (!checkQuestion || !answer || answer.length > QUESTION_MAX || checkQuestion.length > 400)) return NextResponse.json({ error: "Answer the check question first." }, { status: 400 });
  // The teaching actions' own fields (attempt, question, learner answer, explanation): bounded, then screened like the rest.
  const treq = isTeachingAction(action) ? parseTeachingRequest(action, body) : null;
  if (treq && !treq.ok) return NextResponse.json({ error: treq.error }, { status: 400 });
  const teachingRequest = treq?.ok ? treq.value : null;
  // SCHOLAR-PERSISTENT-LEARNING-01 item 8 (Learn side): an Ask question's obvious everyday-word slips, corrected
  // deterministically (spelling.ts, no AI). The question as TYPED is what is screened, stored and shown beside the reading;
  // the search reads both, and the lesson terms and the prompt read the corrected one (re-read below against the
  // learner's own passages, whose words are never corrected). Check answers are marked as typed and never normalised.
  // SCHOLAR-LEARN-GAPS-02 item 4: the learner's British / American choice (this device's setting, sent as spellingVariant).
  const variant = parseSpellingVariant(body?.spellingVariant);
  let spelt = action === "ask" ? normaliseLearnerText(question, { variant }) : null;
  const searchText = spelt && spelt.display !== question ? `${question} ${spelt.display}` : question;
  if ([question, spelt?.display ?? "", answer, ...(teachingRequest ? teachingTexts(teachingRequest) : [])].some(t => t && findPatientIdentifiers(t).length))
    return NextResponse.json({ error: "That looks like it identifies a patient. Remove it and try again." }, { status: 422 });

  // ── the passages: the step's own sections, by the caller's id ──
  const sessionId = isUuid(body?.sessionId) ? body.sessionId as string : null;
  let stepIds: string[] = [], scopeIds: string[] = [], step = Number.isInteger(body?.step) ? Number(body.step) : 0;
  let recorded = false, stepTitle: string | null = null, sessionMaterials: string[] = [], sessionStep: number | null = null;
  if (sessionId) {
    const s = await getLearningSession(ctx.admin, ctx.userId, sessionId);
    if (!s.ok) return NextResponse.json({ error: "Your session could not be read just now." }, { status: 503 });
    if (!s.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    let here = s.data.steps.find(x => x.step === step) ?? s.data.steps[0];
    if (!here) return NextResponse.json({ error: "This session has nothing left to teach: its materials were deleted." }, { status: 404 });
    if (prepare) {
      // At most ONE lesson ahead of where the learner is: the step after the session's current one (where history is
      // recorded, the current step must be the one named), never further, never the whole sequence.
      if (policy.scholarLearningHistory === "record" && here.step !== s.data.session.currentStep) return notPrepared("not_current", { step: here.step });
      const next = s.data.steps.find(x => x.step > here!.step);
      if (!next) return notPrepared("no_next", { step: here.step });
      here = next;
    }
    // A prepared lesson is not learning: nothing is recorded for it until the learner opens it.
    step = here.step; stepIds = here.sections.map(x => x.chunkId); scopeIds = s.data.steps.flatMap(x => x.sections.map(y => y.chunkId)); recorded = !prepare; stepTitle = s.data.session.topic ?? s.data.session.title ?? null;
    sessionMaterials = [...new Set(s.data.steps.flatMap(x => x.sections.map(y => y.materialId)))];
    sessionStep = s.data.session.currentStep;
  } else if (prepare) {
    return notPrepared("no_session");
  } else {
    const ids = Array.isArray(body?.chunkIds) ? [...new Set((body.chunkIds as unknown[]).filter(isUuid))] as string[] : [];
    if (!ids.length) return NextResponse.json({ error: "Choose what to learn from." }, { status: 400 });
    scopeIds = ids.slice(0, 60); stepIds = scopeIds.slice(0, LESSON_MAX_SECTIONS);
  }
  let passages: Passage[] | null;
  if (action === "ask") {
    const tsq = toTsQuery(searchText);
    const found = tsq ? await searchCandidates(ctx.admin, ctx.userId, tsq, { chunkIds: scopeIds }) : null;
    if (found && !found.ok) return NextResponse.json({ error: "Your notes could not be searched just now. Try again shortly." }, { status: 503 });
    const ranked = found?.ok ? spreadAcrossMaterials(rankChunks(searchText, found.data, 40), RETRIEVAL_LIMIT) : [];
    passages = ranked.length ? await toPassages(ctx.admin, ctx.userId, ranked) : await ownPassages(ctx.admin, ctx.userId, stepIds);
  } else passages = await ownPassages(ctx.admin, ctx.userId, stepIds);
  if (!passages?.length) return NextResponse.json({ error: "That section could not be found." }, { status: 404 });
  if (!sessionMaterials.length) sessionMaterials = [...new Set(passages.map(p => p.materialId))];
  if (spelt) spelt = normaliseLearnerText(question, { vocabulary: vocabularyOf(passages.map(p => p.content)), variant });
  /** What the learner meant: the corrected reading of an Ask question (the question as typed when nothing was corrected). */
  const meant = spelt?.display || question;
  const spelling = spelt && spelt.corrections.length ? { original: spelt.original, display: spelt.display, corrections: spelt.corrections.map(c => ({ from: c.from, to: c.to })) } : null;

  // ── SCHOLAR-LEARN-FIX-01: the lesson, its key terms and how well its passages hold them (no AI) ──
  // The lesson's title and objective come from its own sections' headings and topics (learn.lessonOutline). A thin or
  // partly grounded lesson is given the most relevant OTHER sections of the session's own material(s) -- and, only in a
  // source mode wider than My notes only, another upload that holds most of its key terms (relatedSections) -- up to
  // RETRIEVAL_LIMIT, after its own sections, so its [S n] tags come first. Ask already searches the session. Not for an
  // explanation from recovery, which brings its own evidence. Every read is keyed on the learner's id.
  const lesson: LessonOutline | null = action === "ask" ? null
    : lessonOutline({ step, sections: passages.map(p => ({ chunkId: p.chunkId, materialId: p.materialId, ordinal: p.ordinal, pageFrom: p.pageFrom, pageTo: p.pageTo, materialTitle: p.materialTitle, unit: p.unit ?? "page" })) },
      await topicsOfSections(ctx.admin, ctx.userId, passages.map(p => p.chunkId)), new Map(passages.map(p => [p.chunkId, sectionProfile(p.content)])));
  clock.mark("passages_outline");
  const lessonTerms = action === "ask" ? keyTermsOf(meant) : lesson ? keyTermsOf(lesson.focus.join(" ")).slice(0, 8) : [];
  let grounding: Grounding = groundingOutcome(lessonTerms, passages, policy.scholarRecovery.sufficiency);
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
      grounding = groundingOutcome(lessonTerms, passages, policy.scholarRecovery.sufficiency);
    }
  }
  // What L-B renders: sufficient -> teach; partial -> teach what is supported, name uncoveredTerms, offer `wider`;
  // insufficient -> the existing evidence recovery. `wider` is the next recovery mode the learner may choose.
  const wider: RecoveryMode | null = grounding.outcome === "sufficient" ? null : mode === "notes" ? "notes_and_library"
    : mode === "library" ? widerMode("notes_and_library", policy, await scholarResearchOperational(ctx.admin).catch(() => false)) : null;
  const lessonFields = { lesson: lesson ? { title: lesson.title, objective: lesson.objective } : null, grounding: { ...grounding, related, wider } };
  clock.mark("related");
  // SCHOLAR-LEARN-GAPS-02 item 5 (no AI): a section whose text was read from a slide or page PICTURE by AI says so on its source
  // (aiRead + the shared label), from the material's stored extraction quality: one bounded read of the caller's own materials.
  const aiRead = new Map<string, Set<number>>(), aiReadSeen = new Set<string>();
  const loadAiRead = async (ps: readonly Passage[]) => {
    const ids = [...new Set(ps.map(p => p.materialId))].filter(id => !aiReadSeen.has(id));
    if (!ids.length) return;
    ids.forEach(id => aiReadSeen.add(id));
    const q = await materialQualities(ctx.admin, ctx.userId, ids).catch(() => new Map());
    for (const [id, s] of aiReadByMaterial(q)) aiRead.set(id, s);
  };
  const sourceOf = (p: Passage, i: number) => ({ tag: passageTag(i), chunkId: p.chunkId, materialId: p.materialId, materialTitle: p.materialTitle, citation: passageCitation(p), excerpt: p.content.slice(0, 400), ...aiReadMark(aiRead.get(p.materialId), p) });
  await loadAiRead(passages);

  // ── how to teach it: depth and the governed references (L5 decides each). No AI yet. ──
  const pref = await prefP;
  const depth: ExplanationDepth = (EXPLANATION_DEPTHS as readonly string[]).includes(body?.depth) ? body.depth : pref?.depth ?? policy.scholarExplanationDepth;
  const learner = await learnerP;
  // Stage 3 acceptance item 5: the governed reference source is policy (the CFCA by default), and a saved answer's
  // references are labelled by it as it is now -- "clinically approved" only for content 395 approved as it stands.
  const refSource = await referenceSource(ctx.admin, policy, learner.competencies);
  // COMPETEN-RESEARCH-01: the library modes add the Competen library entries matching the topic (no external call).
  // The two reads are independent, so they run together.
  const [linked, topicMap] = await Promise.all([
    policy.scholarLearningObjectives === "outcomes" ? governedReferences(ctx.admin, ctx.userId, passages.map(p => p.chunkId), refSource) : Promise.resolve([]),
    mode === "notes" ? Promise.resolve(null) : topicsOfSections(ctx.admin, ctx.userId, passages.map(p => p.chunkId)),
  ]);
  const topics = topicMap ? [...new Set([...topicMap.values()].flat())] : [];
  let references = mode === "notes" ? linked : [...linked, ...libraryReferences([action === "ask" ? meant : "", stepTitle ?? "", ...topics].join(" "), refSource, linked)];
  const background = policy.scholarBeyondNotes === "labelled" && mode !== "research";

  // ── s8: a saved artefact for exactly this request is returned, not regenerated ──
  const hasHistory = Array.isArray(body?.history) && body.history.length > 0;
  const oneMaterial = new Set(passages.map(p => p.materialId)).size === 1;
  const storable = isArtefactAction(action) && !hasHistory && oneMaterial;
  const promptVersion = mode === "research" ? learnResearchPromptVersion(action as LearnAction) : learnPromptVersion(action as LearnAction);
  // SCHOLAR-SQIE-02: an explanation from recovered evidence is never a saved artefact, and never served from one.
  const key = storable && !recovery ? artefactKey({ action, depth, chunkIds: passages.map(p => p.chunkId), promptVersion, references, background, mode }) : null;
  // SCHOLAR-GUIDED-LEARNING-01: a lesson saved under an earlier Teach Me version is still this lesson (same structure and
  // checks), so it is served -- reopening never costs AI because the prompt moved on. Looked up only when the current is absent.
  const legacyKeys = key ? legacyLearnPromptVersions(action as LearnAction).map(v => artefactKey({ action, depth, chunkIds: passages!.map(p => p.chunkId),
    promptVersion: mode === "research" ? `${v}${RESEARCH_PROMPT_SUFFIX}` : v, references, background, mode })) : [];
  const fits = (a: ArtefactRow | null) => !!a && a.sources.every(id => passages!.some(p => p.chunkId === id));
  const findSaved = async (): Promise<ArtefactRow | null> => {
    if (!key) return null;
    const [current, ...older] = await Promise.all([key, ...legacyKeys].map(async k => await findArtefact(ctx.admin, ctx.userId, k)));
    return [current, ...older].find(fits) ?? null;
  };
  // A salvaged lesson says so wherever it is shown: how many parts were left out, never which (generation.ts salvageTeach).
  const salvageFields = (removed: number | null) => removed ? {
    salvage: { removed, note: SALVAGE_NOTE },
    grounding: { ...lessonFields.grounding, outcome: "partial" as const, removed },
  } : {};
  // What a served (no AI) lesson leaves in the trail, after the response: reuse, duplicates, timings.
  // The timings are taken when the reply is ready (time to first content), not when the row is written.
  const served = (a: ArtefactRow, extra: Record<string, unknown>) => { const timing = clock.snapshot(); later(() => audit(ctx, LEARN_SERVED_ACTION, LEARN_ENTITY, sessionId, {
    action, step, depth, mode, cached: true, artefact_id: a.id, dedupe_key: key, legacy: a.promptVersion.indexOf(promptVersion) !== 0, open, recorded,
    salvage_removed: salvagedCount(a.promptVersion), timing_ms: timing, ...extra,
  })); };
  const lessonScope: LessonScope | null = lesson ? { title: lesson.title, objective: lesson.objective, focus: lesson.focus } : null;
  const savedReply = (a: ArtefactRow, extra: Record<string, unknown> = {}) => {
    const byId = new Map(passages!.map(p => [p.chunkId, p]));
    const src = a.sources.map(id => byId.get(id)).filter((p): p is Passage => !!p);
    // COMPETEN-RESEARCH-01: a saved Research & Explain answer keeps its research part after the marker, and its
    // external references (kind "external") beside the governed ones -- exactly as the providers returned them.
    const split = splitLearnAnswer(a.content);
    // SCHOLAR-RESEARCH-RELEVANCE-02: the saved record is never changed; what is SERVED is filtered against this lesson now (no AI).
    const restored = restoreResearch(a.refs.filter(r => r?.kind === "external") as unknown as ExternalReference[], split.research, contextOf(withLessonScope({ topics, title: stepTitle, question: action === "ask" ? question : null }, lessonScope)), policy.scholarResearch.relevance);
    const external = restored.references;
    return {
      action, step, depth: a.depth, label: AI_LABEL, provenance: { model: a.model, promptVersion: a.promptVersion }, kinds: SOURCE_KIND_LABEL,
      sources: src.map(sourceOf),
      passageIds: src.map(p => p.chunkId), references: relabelReferences(a.refs, refSource), answer: split.research !== null ? split.main : a.content, cited: src.map((_, i) => i + 1),
      background: a.background ? { text: a.background, label: SUPPLEMENTARY_LABEL } : null, flags: a.flags, verdict: null,
      research: restored.retrieved ? { state: "cached", label: SOURCE_KIND_LABEL.research, message: restored.message, references: external, excludedCount: restored.excluded.length, ...(restored.text ? { text: restored.text } : {}) } : null,
      saved: { at: a.createdAt, reviewStatus: a.reviewStatus }, artefactId: a.id, ...lessonFields, ...salvageFields(salvagedCount(a.promptVersion)), ...extra,
    };
  };
  // SCHOLAR-PERSISTENT-LEARNING-01, THE POSITION RULE: a lesson answered here moves current_step only FORWARD (a reply that
  // lands after the learner went back never pulls it back); moving back is the learner's explicit PATCH sessions/[id].
  const advances = sessionStep === null || step > sessionStep;
  // The learner opened a saved lesson: recorded as before (the two writes are independent, so together).
  const openedSaved = async (saved: ArtefactRow) => {
    if (recorded && sessionId && policy.scholarLearningHistory === "record") await Promise.all([
      recordLearningEvent(ctx.admin, ctx.userId, { sessionId, step, action, verdict: null, chunkIds: saved.sources }),
      open || !advances ? Promise.resolve("ok" as const) : updateLearningSession(ctx.admin, ctx.userId, sessionId, { currentStep: step }),
    ]);
  };
  clock.mark("references");
  // A prepared lesson never replaces a saved one, so `fresh` does not apply to it.
  if (key && (body?.fresh !== true || prepare)) {
    const saved = await findSaved();
    clock.mark("cache");
    if (saved) {
      if (prepare) return notPrepared("saved", { step });
      await openedSaved(saved);
      served(saved, {});
      return NextResponse.json(savedReply(saved, { cached: true }));
    }
  }
  // SCHOLAR-PERSISTENT-LEARNING-01: the exact key missed -- the newest lesson saved for this chunk set, under any version or
  // settings. Its sources beyond this request's passages are read (the learner's own, by id) so its [S n] tags stay true.
  if ((open || prepare) && body?.fresh !== true && isArtefactAction(action) && !recovery && !hasHistory) {
    const earlier = await findSavedLesson(ctx.admin, ctx.userId, { action, materialId: passages[0].materialId, chunkIds: stepIds });
    const missing = earlier ? earlier.sources.filter(id => !passages!.some(p => p.chunkId === id)) : [];
    const extra = earlier && missing.length ? await ownPassages(ctx.admin, ctx.userId, missing) : [];
    clock.mark("cache_fallback");
    if (earlier && extra) {
      if (prepare) return notPrepared("saved", { step });
      passages = [...passages, ...extra];
      await loadAiRead(extra);
      const differs = earlier.promptVersion.indexOf(promptVersion) !== 0 || earlier.depth !== depth;
      await openedSaved(earlier);
      served(earlier, { fallback: true });
      return NextResponse.json(savedReply(earlier, { cached: true, ...(differs ? { savedEarlier: { label: SAVED_EARLIER_LABEL, promptVersion: earlier.promptVersion, depth: earlier.depth } } : {}) }));
    }
  }
  if (prepare && !key) return notPrepared("not_storable", { step });
  // OPEN: nothing saved, so the client is told to ask for it (or that it is being written) -- no AI, no allowance read.
  if (open) return NextResponse.json({ action, step, depth, ...lessonFields, cached: false, open: key && (await flightActive(ctx, key)) ? "in_flight" : "generate" });
  if (prepare && key && (await flightActive(ctx, key))) return notPrepared("in_flight", { step });

  // ── s7: continuity -- no new AI where the standing (or the allowance) says no; what is saved stays available ──
  const continuity = async (message: string, insufficient: boolean) => {
    const saved = await listArtefacts(ctx.admin, ctx.userId, { chunkIds: passages!.map(p => p.chunkId) });
    return NextResponse.json({ action, step, ...lessonFields, continuity: { message, insufficient }, saved: saved.ok ? saved.data.slice(0, 5).map(a => savedReply(a)) : [] });
  };
  // The tutor context is a read the AI call needs and nothing before it decides on: started now, awaited after the gates.
  const tutorP = loadTutorContext(ctx.admin, ctx.userId, passages.map(p => p.chunkId));
  tutorP.catch(() => {});
  // A teaching action is metered as the nearest existing activity (the engine refuses an unlisted code; learn-teaching.ts).
  const activity = meteredActivity(action) as ScholarAiActivity;
  const standing = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), activity);
  if (!standing.available) return prepare ? notPrepared("unavailable", { step }) : continuity(standing.message ?? "", standing.insufficient);
  const pre = await aiPreflight(ctx);
  if (pre) {
    if (prepare) return notPrepared("unavailable", { step });
    if (pre.status === 429) return continuity(((await pre.clone().json().catch(() => ({}))) as { error?: string }).error ?? "Your AI allowance is used up for now.", false);
    return pre;
  }
  clock.mark("standing_preflight");

  // ── SCHOLAR-GUIDED-LEARNING-01: no duplicate generation (learn-flight.ts) ──
  // The earliest identical request generates; a later one makes no AI call and is served what the first saved.
  // A claimed flight is closed where the request ends (an end row): written beside the trail on the main path, and
  // before each refusal. A request that throws leaves its row to age out of the window.
  let flight: Flight | null = null;
  const closeFlight = (outcome: string) => (key ? endFlight(ctx, flight, key, sessionId, outcome) : Promise.resolve());
  if (key) {
    flight = await claimFlight(ctx, key, { sessionId, step, action, prepared: prepare });
    if (!flight.claimed) {
      if (prepare) return notPrepared("in_flight", { step });
      const waited = await waitForFlight(ctx, key, flight, findSaved);
      clock.mark("dedupe_wait");
      if ("saved" in waited) {
        await openedSaved(waited.saved);
        served(waited.saved, { duplicate_suppressed: true });
        return NextResponse.json(savedReply(waited.saved, { cached: true, duplicateSuppressed: true }));
      }
      const timing = clock.snapshot();
      later(() => audit(ctx, LEARN_SERVED_ACTION, LEARN_ENTITY, sessionId, { action, step, depth, mode, cached: false, dedupe_key: key, duplicate_suppressed: true, first: "ended" in waited ? waited.ended : "still_running", timing_ms: timing }));
      // The first was withheld: said, with nothing re-generated. It failed or was refused: the learner may simply try again.
      if ("ended" in waited && waited.ended.startsWith("withheld"))
        return NextResponse.json({ action, step, depth, label: AI_LABEL, kinds: SOURCE_KIND_LABEL, ...lessonFields, sources: [], passageIds: passages.map(p => p.chunkId), references: [], withheld: true, reason: "duplicate", message: DUPLICATE_WITHHELD, duplicateSuppressed: true });
      return NextResponse.json({ action, step, depth, ...lessonFields, inFlight: !("ended" in waited), retry: true, duplicateSuppressed: true, message: "ended" in waited ? DUPLICATE_RETRY : DUPLICATE_IN_FLIGHT });
    }
    clock.mark("dedupe_claim");
  }
  const learnerContext = await tutorP;
  clock.mark("context");
  // SCHOLAR-SESSION-AI-02 slice C (owner D4): an ask in the caller's OWN connected study session (policy on, 740 present)
  // also carries the session block -- database reads only, no AI call, under the learner-context rule (emphasis, never
  // grounding, never cited). Any other session, or the gate off: null, and the ask is exactly as before.
  const study = action === "ask" && recorded && sessionId
    ? await studySessionBlock(ctx.admin, ctx.userId, sessionId, { policy, competencyTitle: id => learner.competencies?.find(c => c.id === id)?.title ?? null })
    : null;
  // SCHOLAR-COMPANION-01 P1: High-yield's exam evidence is COUNTED here (no AI) from the learner's own past papers.
  const examEvidence = action === "high_yield" ? await examEvidenceFor(ctx.admin, ctx.userId, lessonTerms) : null;
  const history: TutorTurn[] = (!teaching && Array.isArray(body?.history) ? body.history : []).slice(-policy.scholarTutorTurns).flatMap((raw: unknown) => {
    const t = raw as { speaker?: unknown; text?: unknown } | null;
    return (t?.speaker === "tutor" || t?.speaker === "student") && typeof t.text === "string" && t.text.trim() ? [{ speaker: t.speaker, text: t.text.trim().slice(0, 1500) }] : [];
  });
  const prompt = teachingRequest ? teachingPrompt(teachingRequest, examEvidence) : action === "ask" ? meant : action === "clarify" ? `Your check question was: ${checkQuestion}\nMy answer: ${answer}` : CANNED[action as ClassicLearnAction | "check"];

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
  // Consolidated improvement item 5: the question is read in the context of this lesson (study framing by overlap only;
  // real-patient, administration, emergency, safety and identifier signals still win -- request-intent.ts).
  Object.assign(risk, { intentContext: { surface: "learn" as const, lessonTitle: lesson?.title ?? stepTitle ?? undefined, objective: lesson?.objective ?? undefined, materialTopics: topics } });
  clock.mark("risk");
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
  const ai = scholarAiRunner(ctx, req, activity, risk);
  // SCHOLAR-GUIDED-LEARNING-01: the model call's own time, apart from the checks that follow it.
  ai.run = clock.wrap("ai", ai.run);
  let research: LearnResearch | null = null;
  if (mode === "research") {
    const gate = await scholarRiskGate(ctx, activity, risk);
    if (gate) await closeFlight("refused");
    if (gate && prepare) return notPrepared("unavailable", { step });
    // AI operating modes: a clarify question is put to the student, not shown as a refusal. Nothing was sent anywhere.
    if (gate?.error === "clarify_purpose") return meteredRefusal(gate)!;
    if (gate) { const w = refusalWords(gate); return continuity(w.message, w.insufficient); }
    // SCHOLAR-SOURCE-QUALITY-01: the result comes back GATED (source-quality.ts), so only abstracts that pass the HQ
    // source-quality rules can reach generation below; the rest are listed as reading only.
    research = await learnResearch(ctx, policy.scholarResearch, { question: action === "ask" ? question : null, topics, title: stepTitle }, ai.actionId, null, qualityOf(policy.scholarRecovery), lessonScope);
  }
  const evidence = [...(research ? researchEvidence(research) : []), ...(recovered?.ok ? recovered.inputs.research : [])];
  clock.mark("research");
  const r = await runLearn(ctx.userId, { action: action as LearnAction | "check" | "clarify", question: prompt, passages, references, depth, background, history, learnerContext, research: evidence, studyContext: study?.text ?? null,
    teaching: teachingRequest ? { level: "level" in teachingRequest ? teachingRequest.level : undefined, hintLevel: teachingRequest.action === "guide" ? teachingRequest.hintLevel : undefined, examEvidence } : undefined }, ai.run);
  clock.mark("generate");
  const refusal = ai.refusal();
  if (refusal) await closeFlight("refused");
  if (refusal && prepare) return notPrepared("unavailable", { step });
  if (refusal?.error === "clarify_purpose") return meteredRefusal(refusal)!;
  if (refusal) { const w = refusalWords(refusal); return continuity(w.message, w.insufficient); }
  // SCHOLAR-AI-OPT-01: the outcome of this one action, codes only. A check question is not an explanation.
  // COMPETEN-RESEARCH-01: a research answer is its own operation; the notes part and the research part each count.
  let rr = r.ok ? r.research : null;
  // SCHOLAR-RESEARCH-RELEVANCE-02: a summary that declares its own sources irrelevant cites nothing, shows nothing, saves nothing.
  if (research && rr?.ok) { const w = withdrawDeclaredIrrelevant(research, rr.text); if (w !== research) { Object.assign(research, w); rr = null; } }
  if (rr?.ok && !(await withinRequestRisk(ctx.admin, activity, risk, [rr.text]))[0]) rr = { ok: false, reason: "risk_raised" };
  // An Ask me / Challenge me answer must hold exactly ONE question: it is what the learner's reply is judged against (`clarify`).
  const asksQuestion = action === "ask_me" || action === "challenge";
  const askedQuestion = asksQuestion && r.ok && r.check.ok ? extractQuestion(r.check.text) : null;
  const researchCodes = research ? [`research_${research.state}`, ...research.codes, ...(rr ? [rr.ok ? "research_shown" : `research_${rr.reason}`] : [])] : [];
  // SCHOLAR-GUIDED-LEARNING-01: a lesson shown with unsupported parts left out (never verified: an outcome "partial").
  const salvaged = r.ok && action !== "check" && r.check.ok ? r.check.salvaged ?? null : null;
  // s8: the shown answer is saved for next time (private formative; replaced when the student asks for a new one).
  // Saved BEFORE the trail is written, so its time is measured and a waiting duplicate finds it at once.
  let savedNow: "ok" | "not_provisioned" | "failed" | null = null;
  if (r.ok && action !== "check" && r.check.ok) {
    const notes = r.check.text, bg = r.background;
    if (key) savedNow = await saveArtefact(ctx.admin, ctx.userId, {
      materialId: passages[0].materialId, action, depth, content: rr?.ok ? `${notes}

${RESEARCH_MARKER}
${rr.text}` : notes, background: bg?.ok ? bg.text : null, flags: r.flags.kept,
      refs: [...references.map((x, i) => ({ tag: `R${i + 1}`, ...x })), ...(research ? externalReferences(research) : [])], dedupeKey: key,
      model: r.model, promptVersion: salvaged ? salvagedPromptVersion(r.promptVersion, salvaged.removed) : r.promptVersion, chunkIds: passages.map(p => p.chunkId),
      // SCHOLAR-LIBRARY-01 (820): the lesson of the caller's own recorded session it was saved for (read above by their id).
      lesson: sessionId && sessionStep !== null ? { sessionId, step } : null,
    });
  }
  clock.mark("save");
  const outcomeCode = r.ok ? (action === "check" ? (r.question?.ok ? "shown" : `withheld:${r.question?.reason}`) : r.check.ok ? (asksQuestion && !askedQuestion ? "withheld:malformed" : "shown") : `withheld:${r.check.reason}`) : `error:${r.error}`;
  // The writes are independent, so they run together (the flight closes as the artefact is already saved).
  await Promise.all([closeFlight(outcomeCode), recordScholarOutcome(ctx.admin, ai, {
    operation: `${mode === "research" ? "individual_scholar_learn_research" : "individual_scholar_learn"}:${action}`, outputKind: action === "check" || asksQuestion ? "other" : "explanation",
    promptVersion: r.ok ? r.promptVersion : null, configVersion: `depth:${depth}${mode === "notes" ? "" : `;mode:${mode}`}`,
    ...(!r.ok ? { outcome: "error" as const, reasons: [`error_${r.error}`, ...researchCodes] }
      : action === "check" ? (r.question?.ok ? { outcome: "accepted" as const, accepted: 1 } : { outcome: "rejected" as const, rejected: 1, reasons: [r.question?.reason ?? "malformed"] })
        : asksQuestion && r.check.ok && !askedQuestion ? { outcome: "rejected" as const, rejected: 1, reasons: ["malformed"] }
        : (() => {
          // A salvaged lesson: the lesson accepted, the parts left out rejected -- so "partial", never "accepted".
          const accepted = (r.check.ok ? 1 : 0) + (rr?.ok ? 1 : 0), rejected = (r.check.ok ? 0 : 1) + (rr && !rr.ok ? 1 : 0) + (salvaged ? 1 : 0);
          return { outcome: accepted ? (rejected ? "partial" as const : "accepted" as const) : "rejected" as const, accepted, rejected, reasons: [...(r.check.ok ? [] : [r.check.reason]), ...(salvaged ? ["grounding_salvaged"] : []), ...researchCodes] };
        })()),
  }),
  recovery && recovered?.ok ? recordRecoveryResult(ctx.admin, recovery.id, r.ok && action !== "check" && r.check.ok) : null,
  audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_learn", sessionId, {
    action_id: ai.actionId, purpose: purposeFrom(body),
    action, step, chunk_ids: passages.map(p => p.chunkId), depth, references: references.length, learner_context: learnerContext !== null, recorded,
    // SCHOLAR-SESSION-AI-02: which study-session sections reached the prompt (names only, never the text).
    study_context: study ? study.sections : null,
    outcome: outcomeCode,
    // SCHOLAR-COMPANION-01 P1: the event value and the metered activity a teaching action was mapped to (codes only).
    event_action: learningEventAction(action), metered_as: activity,
    // SCHOLAR-AI-OPT-01: what the grounding check refused, in its own words ("the number one"), never the answer text.
    withheld_detail: r.ok && action !== "check" && !r.check.ok && r.check.violations?.length ? describeViolations(r.check.violations) : null,
    flags: r.ok ? r.flags.kept.length : 0, verdict: r.ok ? r.verdict : null, model: r.ok ? r.model : null, prompt_version: r.ok ? r.promptVersion : null,
    ...(mode !== "notes" ? { mode, research: research ? { state: research.state, items: research.items.length, evidence: evidence.length, outcome: rr ? (rr.ok ? "shown" : `withheld:${rr.reason}`) : null } : null } : {}),
    // SCHOLAR-GUIDED-LEARNING-01: generated (not cached), whether prepared ahead, the artefact key (for reuse and
    // prepared-and-viewed), what salvage left out (a count and the rule, never the text), whether it was saved, and timings.
    cached: false, prepared: prepare, dedupe_key: key, flight_id: flight?.id ?? null, saved: savedNow,
    salvage_removed: salvaged ? salvaged.removed : null, salvage_detail: salvaged?.violations.length ? describeViolations(salvaged.violations) : null,
    timing_ms: clock.snapshot(),
  })]);
  if (prepare) return NextResponse.json({ prepared: savedNow === "ok", step, reason: savedNow === "ok" ? null : outcomeCode === "shown" ? "not_saved" : outcomeCode, actionId: ai.actionId });
  if (!r.ok) return NextResponse.json({ error: AI_ERROR[r.error].error }, { status: AI_ERROR[r.error].status });

  // ── the record: structure only, and only what was shown ──
  const shown = action === "check" ? !!r.question?.ok : r.check.ok && (!asksQuestion || !!askedQuestion);
  if (recorded && sessionId && shown && policy.scholarLearningHistory === "record") {
    await Promise.all([
      recordLearningEvent(ctx.admin, ctx.userId, { sessionId, step, action: learningEventAction(action), verdict: eventVerdict(action, r.verdict), chunkIds: passages.map(p => p.chunkId) }),
      advances ? updateLearningSession(ctx.admin, ctx.userId, sessionId, { currentStep: step }) : Promise.resolve("ok" as const),
    ]);
  }

  const sources = passages.map(sourceOf);
  const base = { action, step, depth, label: AI_LABEL, provenance: { model: r.model, promptVersion: r.promptVersion }, sources, passageIds: passages.map(p => p.chunkId), actionId: ai.actionId,
    references: references.map((x, i) => ({ tag: `R${i + 1}`, ...x })), kinds: SOURCE_KIND_LABEL, ...lessonFields, ...(spelling ? { spelling } : {}),
    ...(recovered ? { recovered: recoveredReply(recovered, action !== "check" && r.check.ok) } : {}),
    // COMPETEN-RESEARCH-01: external research, apart from the notes, with the providers' own records. Never mixed in.
    research: research ? {
      excludedCount: research.excluded?.length ?? 0,
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
  if (asksQuestion && !askedQuestion) return NextResponse.json({ ...base, withheld: true, message: "A question could not be written from these sections just now. Try again, or carry on learning." });
  // What a teaching action adds to the reply (SCHOLAR-COMPANION-01 P1); nothing for the original actions.
  const level = teachingRequest && "level" in teachingRequest ? teachingRequest.level : null;
  const teachingFields = !teachingRequest ? {}
    : asksQuestion ? { level, checkQuestion: askedQuestion, informal: INFORMAL_CHECK_LABEL, ...(action === "challenge" && level ? { nextLevel: challengeNextLevels(level) } : {}) }
      : teachingRequest.action === "guide" ? { hintLevel: teachingRequest.hintLevel, nextHintLevel: teachingRequest.hintLevel < 3 ? teachingRequest.hintLevel + 1 : null, explainDirectly: { action: "explain", label: "Explain it directly" } }
        : teachingRequest.action === "high_yield" ? { examEvidence }
          : { informal: INFORMAL_CHECK_LABEL };
  const b = r.background;
  // (s8: saved above, before the trail.) A salvaged lesson says what was left out (a count) and is graded "partial".
  return NextResponse.json({
    ...base,
    cached: false,
    ...salvageFields(salvaged ? salvaged.removed : null),
    answer: r.check.text,
    cited: r.check.cited,
    background: !b || (!b.ok && b.reason === "not_this_mode") ? null : b.ok ? { text: b.text, label: SUPPLEMENTARY_LABEL } : { withheld: SUPPLEMENTARY_WITHHELD[b.reason as Exclude<typeof b.reason, "not_this_mode">] },
    flags: r.flags.kept,
    verdict: r.verdict ? { value: r.verdict, label: CHECK_VERDICT_LABEL[r.verdict], informal: INFORMAL_CHECK_LABEL } : null,
    savedForLater: savedNow === "ok",
    ...teachingFields,
  });
}
