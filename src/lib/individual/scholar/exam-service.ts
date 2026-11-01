/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IndividualContext } from "../guard";
import { loadIndividualPolicy, type ExamEvidenceSource, type ExamResearchDepth, type IndividualPolicy } from "../policy";
import { BUCKET, PDF_MIME } from "./config";
import { findPatientIdentifiers } from "./extract";
import { getMaterial, getPassage, insertRevisionQuestions, listChunks, materialExtras, materialOriginal, searchCandidates, toPassages } from "./store";
import { rankChunks, spreadAcrossMaterials, toTsQuery } from "./retrieval";
import { governedReferences, referenceSource } from "./learn";
import { loadLearnerCatalogue } from "./competency-view";
import { AI_ERROR, SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, meteredRefusal, scholarAiRunner, scholarRisk } from "./http";
import type { ScholarAiActivity } from "./ai-standing";
import { answerOutcome, recordScholarOutcome } from "./outcome";
import { recordRecoveryResult, recoveredReply, rederiveRecovery, type RecoveryRequest } from "./evidence-recovery";
import { RECOVERY_STILL_WITHHELD } from "./config";
import {
  NOTES_NOT_PAPER, NOTES_VERDICT, PAPER_PARSER, isCurrentParser, isNotesNotPaper, judgeLegacyPaper, leadInFor, linesFromChunks, parsePaper, questionText, revisionFront,
  type LegacyJudgement, type PaperLine,
} from "./exam-paper";
import {
  ANSWER_WITHHELD, buildEvidence, matchLibrary, runAnswer, runFollowUp, runGuide, runTranscription, type Evidence, type LibraryEntry,
} from "./exam-answer";
import { RESEARCH_DEPTH, RESEARCH_PROMPT_VERSION, researchKey, researchRequest, runResearch, webResearchState, type ResearchSource } from "./exam-research";
import {
  EXAM_RESEARCH_ENTITY, createExamPaper, getExamAnswer, getExamPaper, getExamQuestion, linkRevision, listExamAnswers, listExamQuestions,
  readResearchCache, saveExamAnswer, webResearchToday, writeResearchCache, type ExamPaperRow, type ExamQuestionRow,
} from "./exam-store";

// ── STUDYING AN EXAMINATION PAPER: THE ORCHESTRATION ── COMPETEN-SCHOLAR-EXAM-PAPERS-01 (570) ───────────────
//
// What each route does, in one place, on the existing Scholar engine: the material store and extraction, Learn's
// retrieval, the governed references, the metered AI runner (consent, allowance, risk), the grounding check, the
// revision store and the audit. Routes stay thin: they check the request and call these.
//
// AI ACTIVITIES. The approved Scholar activity codes (ai-standing.ts) are reused rather than new ones invented, so
// the allowance, eligibility and the HQ policy already cover them: a suggested answer is "deeper" (reasoning over
// evidence), a follow-up "ask", a revision guide "teach", web research "deeper", a transcription "map". Dedicated
// codes are a one-line change here once HQ publishes them.

export const EXAM_ACTIVITY: Record<"answer" | "follow_up" | "guide" | "research" | "transcribe", ScholarAiActivity> = {
  answer: "deeper", follow_up: "ask", guide: "teach", research: "deeper", transcribe: "map",
};

/** The practice-paper attestation, kept with the paper by version. */
export const EXAM_ATTESTATION = {
  version: "exam-practice-v1",
  text: "This is a past or practice paper. I am not sitting this examination now, and I have permission to use the paper for my own study.",
};

export const LIVE_EXAM_NOTICE = "Scholar is for studying past and practice papers. Do not use it during a live examination or assessment.";

/** The most scanned pages one paper may have transcribed, and how many go in one AI call. */
export const TRANSCRIBE_MAX_PAGES = 12;
export const TRANSCRIBE_BATCH = 2;

type Out = { status: number; body: Record<string, unknown> };
const json = (status: number, body: Record<string, unknown>): Out => ({ status, body });
const NOT_SET_UP = json(503, { error: "Studying examination papers is not set up on this environment yet. Nothing on your account has changed." });

export async function examPolicy(admin: any): Promise<IndividualPolicy> { return loadIndividualPolicy(admin); }

async function pdfBase64(admin: any, userId: string, materialId: string): Promise<string | null> {
  const original = await materialOriginal(admin, userId, materialId);
  if (!original?.path) return null;
  const { data: blob, error } = await admin.storage.from(BUCKET).download(original.path);
  if (error || !blob) return null;
  return Buffer.from(await blob.arrayBuffer()).toString("base64");
}

/**
 * Pages with no text, transcribed by AI where policy and consent allow. Each page is screened for patient identifiers:
 * a page that has one is not kept (it stays unreadable). Returns lines to merge and the pages transcribed.
 */
async function transcribeEmptyPages(ctx: IndividualContext, req: Request, materialId: string, pages: number[]): Promise<{ lines: PaperLine[]; done: number[]; refused: Out | null }> {
  const wanted = pages.slice(0, TRANSCRIBE_MAX_PAGES);
  const pdf = await pdfBase64(ctx.admin, ctx.userId, materialId);
  if (!pdf) return { lines: [], done: [], refused: null };
  const ai = scholarAiRunner(ctx, req, EXAM_ACTIVITY.transcribe, Object.assign(await scholarRisk(ctx.admin, ctx.userId, { text: null, passages: [] }), { intentContext: { surface: "material" as const, activity: "transcribe" } }));
  const lines: PaperLine[] = [];
  const done: number[] = [];
  for (let i = 0; i < wanted.length; i += TRANSCRIBE_BATCH) {
    const batch = wanted.slice(i, i + TRANSCRIBE_BATCH);
    const r = await runTranscription(ai.run, ctx.userId, { pdfBase64: pdf, pages: batch });
    const refused = meteredRefusal(ai.refusal());
    if (refused) return { lines, done, refused: json(refused.status, await refused.json()) };
    if (!r.ok) break;
    for (const p of r.pages) {
      if (findPatientIdentifiers(p.text).length) continue;
      done.push(p.page);
      lines.push(...p.text.split("\n").map(t => t.trim()).filter(Boolean).map(text => ({ text, chunkId: null, page: p.page })));
    }
  }
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_exam_transcribe", materialId, { asked: wanted.length, transcribed: done.length });
  return { lines, done, refused: null };
}

/** Prepare a material as an examination paper: read its structure (and transcribe scanned pages where allowed). */
export async function preparePaper(ctx: IndividualContext, req: Request, materialId: string, opts: { attested: boolean; transcribe: boolean }): Promise<Out> {
  const policy = await loadIndividualPolicy(ctx.admin);
  if (!policy.scholarExams.enabled) return json(403, { error: "Studying examination papers is not offered on Scholar at the moment." });
  if (!opts.attested) return json(400, { error: "Confirm that this is a past or practice paper you may use." });
  const material = await getMaterial(ctx.admin, ctx.userId, materialId);
  if (!material.ok) return material.notProvisioned ? NOT_SET_UP : json(503, { error: "Your material could not be read just now. Try again shortly." });
  if (!material.data) return json(404, { error: "That material could not be found." });
  const existing = await getExamPaper(ctx.admin, ctx.userId, materialId);
  if (!existing.ok) return existing.notProvisioned ? NOT_SET_UP : json(503, { error: "Your papers could not be read just now. Try again shortly." });
  if (existing.data) return json(200, { materialId, existing: true });

  const [chunks, extras] = await Promise.all([listChunks(ctx.admin, ctx.userId, materialId), materialExtras(ctx.admin, ctx.userId, [materialId])]);
  if (!chunks.ok) return json(503, { error: "Your material could not be read just now. Try again shortly." });
  const quality = extras.qualityOn ? extras.byId.get(materialId)?.quality ?? null : null;
  let empty = quality?.unit === "page" ? [...quality.emptyUnits] : [];
  let lines = linesFromChunks(chunks.data.map(c => ({ id: c.id, content: c.content, pageFrom: c.pageFrom })));
  let transcribed: number[] = [];
  // A material whose own extractor was AI transcription (a fully scanned paper, at upload) is transcribed throughout.
  if ((await materialOriginal(ctx.admin, ctx.userId, materialId))?.extractor.startsWith("ai-transcription")) transcribed = [...new Set(chunks.data.map(c => c.pageFrom).filter((p): p is number => p !== null))];

  if (opts.transcribe && empty.length && material.data.mimeType === PDF_MIME && policy.scholarExams.scannedPages === "ai_transcription") {
    const pre = await aiPreflight(ctx);
    if (pre) return json(pre.status, await pre.json());
    const t = await transcribeEmptyPages(ctx, req, materialId, empty);
    if (t.refused) return t.refused;
    transcribed = [...transcribed, ...t.done];
    empty = empty.filter(p => !t.done.includes(p));
    lines = [...lines, ...t.lines].sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
  }

  const parsed = parsePaper(lines, { emptyPages: empty, transcribedPages: transcribed });
  // SCHOLAR-QUESTION-INTELLIGENCE-01: numbered notes are not a paper. Nothing is kept as one; the student is sent to
  // practice questions written from the material instead (Revise, scoped to it).
  if (isNotesNotPaper(parsed)) {
    await audit(ctx, "individual_scholar_exam_paper_declined", "individual_scholar_material", materialId, { reason: "looks_like_notes", questions: parsed.questions.length, parser: PAPER_PARSER });
    return json(200, { materialId, notesLike: true, message: NOTES_NOT_PAPER });
  }
  const created = await createExamPaper(ctx.admin, ctx.userId, {
    materialId, attestationVersion: EXAM_ATTESTATION.version, extractor: transcribed.length ? `${PAPER_PARSER}+ai-transcription` : PAPER_PARSER,
    instructions: parsed.instructions, flags: parsed.flags,
    questions: parsed.questions.map(q => ({ ...q, source: q.flags.some(f => f.kind === "transcribed") || q.chunkId === null ? "ai_transcription" as const : "text_layer" as const })),
  });
  if (!created.ok) return created.exists ? json(200, { materialId, existing: true }) : created.notProvisioned ? NOT_SET_UP : json(503, { error: "The paper could not be saved just now. Try again shortly." });
  await audit(ctx, "individual_scholar_exam_paper_prepared", "individual_scholar_exam_paper", materialId, {
    questions: parsed.questions.length, flags: parsed.flags.map(f => f.kind), transcribed_pages: transcribed.length, attestation: EXAM_ATTESTATION.version,
  });
  return json(201, { materialId, questions: parsed.questions.length, flags: parsed.flags });
}

/**
 * SCHOLAR-SQIE-CLOSE-01 P0. An opened paper that an earlier parser kept is judged again with today's rules
 * (judgeLegacyPaper). Read-only: the paper, question and answer rows are never written. When any of its questions are
 * statements, a codes-only audit records the redirect. Null: the paper was read by the current parser (shown as is).
 */
export async function judgeOpenedPaper(ctx: IndividualContext, paper: Pick<ExamPaperRow, "materialId" | "extractor" | "instructions">, questions: readonly ExamQuestionRow[]): Promise<LegacyJudgement | null> {
  if (isCurrentParser(paper.extractor)) return null;
  const chunks = await listChunks(ctx.admin, ctx.userId, paper.materialId);
  const reparsed = chunks.ok && chunks.data.length ? parsePaper(linesFromChunks(chunks.data.map(c => ({ id: c.id, content: c.content, pageFrom: c.pageFrom })))) : null;
  const j = judgeLegacyPaper(paper, questions, reparsed);
  // SQIE-COMPLETE-01: EVERY legacy recheck leaves one codes-only row, clean or redirected, so coverage is measurable
  // (checked versus redirected). The redirect audit below keeps its own semantics and is still written only for statements.
  await audit(ctx, "individual_scholar_exam_paper_legacy_checked", "individual_scholar_exam_paper", paper.materialId, {
    result: j.statements > 0 ? "redirected" : "clean", statements: j.statements, questions: j.questions, parser: paper.extractor.slice(0, 60), judged_with: PAPER_PARSER,
  });
  if (j.statements > 0) {
    await audit(ctx, "individual_scholar_exam_paper_legacy_redirected", "individual_scholar_exam_paper", paper.materialId, {
      outcome: j.notesLike ? "notes_like" : "statements_hidden", statements: j.statements, questions: j.questions,
      parser: paper.extractor.slice(0, 60), judged_with: PAPER_PARSER, basis: j.basis,
    });
  }
  return j;
}

/**
 * SCHOLAR-SQIE-CLOSE-01 P0, the answer route: a stored row of an earlier-parser paper that today's rules judge a
 * statement is never answered, even when called directly (the page no longer offers it). Read-only, no audit (the page
 * already records the redirect). Unreadable paper: refused (fail closed), never answered as a question.
 */
export async function legacyStatementRefusal(ctx: IndividualContext, q: ExamQuestionRow): Promise<Out | null> {
  const paper = await getExamPaper(ctx.admin, ctx.userId, q.materialId);
  if (!paper.ok) return json(503, { error: "Your papers could not be read just now. Try again shortly." });
  if (!paper.data || isCurrentParser(paper.data.extractor)) return null;
  const [all, chunks] = await Promise.all([listExamQuestions(ctx.admin, ctx.userId, q.materialId), listChunks(ctx.admin, ctx.userId, q.materialId)]);
  if (!all.ok) return json(503, { error: "Your papers could not be read just now. Try again shortly." });
  const reparsed = chunks.ok && chunks.data.length ? parsePaper(linesFromChunks(chunks.data.map(c => ({ id: c.id, content: c.content, pageFrom: c.pageFrom })))) : null;
  const j = judgeLegacyPaper(paper.data, all.data, reparsed);
  return j.statementIds.includes(q.id) ? json(409, { error: NOTES_VERDICT, notesLike: true, materialId: q.materialId }) : null;
}

/** The question as the model reads it: its lead-in (when it has one), number, instructions, stem and options. */
async function questionWithContext(ctx: IndividualContext, q: ExamQuestionRow): Promise<string> {
  const all = await listExamQuestions(ctx.admin, ctx.userId, q.materialId);
  return questionText(q, all.ok ? leadInFor(q, all.data) : null);
}

/** Notes: the student's own other materials, never the paper itself. Library: governed CFCA entries. */
async function gatherLocalEvidence(ctx: IndividualContext, policy: IndividualPolicy, q: ExamQuestionRow, text: string, sources: readonly ExamEvidenceSource[]) {
  let passages: Awaited<ReturnType<typeof toPassages>> = [];
  if (sources.includes("notes")) {
    const tsq = toTsQuery(text);
    const found = tsq ? await searchCandidates(ctx.admin, ctx.userId, tsq, null) : null;
    if (found?.ok) {
      const others = found.data.filter((c: any) => c.materialId !== q.materialId);
      passages = await toPassages(ctx.admin, ctx.userId, spreadAcrossMaterials(rankChunks(text, others, 40), 4));
    }
  }
  let library: LibraryEntry[] = [];
  if (sources.includes("library")) {
    const learner = await loadLearnerCatalogue(ctx.admin, ctx.userId);
    const source = await referenceSource(ctx.admin, policy, learner.competencies);
    const linked = await governedReferences(ctx.admin, ctx.userId, [...(q.chunkId ? [q.chunkId] : []), ...passages.map(p => p.chunkId)], source, 3);
    const known = new Map((source.catalogue ?? []).map((c: any) => [c.id, c]));
    const fromLinks: LibraryEntry[] = linked.filter(r => r.competencyId).map(r => ({
      id: r.competencyId!, code: r.code, title: r.title, outcome: r.outcome, contentStatus: r.approved ? "approved" : (known.get(r.competencyId!) as any)?.contentStatus ?? "unreviewed",
    }));
    const matched = matchLibrary(text, ((source.catalogue ?? []) as any[]).map(c => ({ id: c.id, code: c.code ?? null, title: c.title, outcomes: c.outcomes ?? [], contentStatus: c.contentStatus ?? "unreviewed" })), 3);
    library = [...fromLinks, ...matched.filter(m => !fromLinks.some(f => f.id === m.id))].slice(0, 4);
  }
  return { passages, library };
}

type WebOutcome = { sources: ResearchSource[]; state: "off" | "cached" | "searched" | "not_found" | "refused" | "limit" | "failed"; message: string | null; searches: number };

async function webEvidence(ctx: IndividualContext, req: Request, policy: IndividualPolicy, text: string, depth: ExamResearchDepth): Promise<WebOutcome | Out> {
  const p = policy.scholarExams;
  const state = webResearchState(p);
  if (!state.on) return { sources: [], state: "off", message: state.reason, searches: 0 };
  const request = researchRequest(text);
  if (!request.ok) return { sources: [], state: "refused", searches: 0, message: request.reason === "identifier" ? "Web research was not run: the question looks like it identifies a patient." : "There was nothing to research." };
  const key = researchKey(request.query, p.webProvider, p.domains, depth);
  const now = new Date().toISOString();
  const cached = await readResearchCache(ctx.admin, key, now);
  if (cached) return { sources: cached.sources, state: "cached", message: null, searches: 0 };
  const today = await webResearchToday(ctx.admin, ctx.userId);
  if (today === null) return { sources: [], state: "failed", searches: 0, message: "Your research allowance could not be checked, so no web research was run." };
  if (today >= p.webDailyMax) return { sources: [], state: "limit", searches: 0, message: `You have used today's ${p.webDailyMax} web research requests. Your notes and the Competen library are still used.` };
  const ai = scholarAiRunner(ctx, req, EXAM_ACTIVITY.research, await scholarRisk(ctx.admin, ctx.userId, { text, passages: [] }), "research");
  const r = await runResearch(ai.run, ctx.userId, { query: request.query, depth, domains: p.domains, now });
  const refused = meteredRefusal(ai.refusal());
  if (refused) return json(refused.status, await refused.json());
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, EXAM_RESEARCH_ENTITY, null, {
    query_chars: request.query.length, depth, outcome: r.ok ? "searched" : `error:${r.error}`, sources: r.ok ? r.sources.length : 0, searches: r.ok ? r.searches : 0,
  });
  if (!r.ok) return { sources: [], state: "failed", searches: 0, message: "Web research could not be completed just now. Your notes and the Competen library are still used." };
  await writeResearchCache(ctx.admin, { key, provider: `${r.provider}:${p.webProvider}`, policyVersion: `${RESEARCH_PROMPT_VERSION}:${depth}`, sources: r.sources, searches: r.searches, days: p.cacheDays });
  return { sources: r.sources, state: r.sources.length ? "searched" : "not_found", searches: r.searches, message: r.sources.length ? null : "Web research found no source on the approved list." };
}

/** What is stored of each piece of evidence: enough to show and cite it again, bounded. */
export function storedEvidence(e: Evidence): Record<string, unknown> {
  return {
    tag: e.tag, kind: e.kind, title: e.title.slice(0, 300), citation: e.citation.slice(0, 300), excerpt: e.text.slice(0, 600),
    url: e.url ?? null, published: e.published ?? null, retrievedAt: e.retrievedAt ?? null, status: e.status ?? null,
    chunkId: e.chunkId ?? null, materialId: e.materialId ?? null,
  };
}
const fromStored = (s: any): Evidence => ({
  tag: String(s.tag), kind: s.kind, title: String(s.title ?? ""), citation: String(s.citation ?? ""), text: String(s.excerpt ?? s.title ?? ""),
  url: s.url ?? null, published: s.published ?? null, retrievedAt: s.retrievedAt ?? null, status: s.status ?? null, chunkId: s.chunkId ?? null, materialId: s.materialId ?? null,
});

/** SCHOLAR-SQIE-02: the question as evidence recovery searches for it, and its paper (never evidence for its own questions). */
export async function paperQuestionForRecovery(ctx: IndividualContext, questionId: string): Promise<{ text: string; materialId: string } | null> {
  const q = await getExamQuestion(ctx.admin, ctx.userId, questionId);
  if (!q || q.flags.some(f => f.kind === "lead_in")) return null;
  return { text: (await questionWithContext(ctx, q)).slice(0, 600), materialId: q.materialId };
}

/** Pure. Recovered evidence merged into the answer's own: each passage and library entry once, abstracts as cited sources. */
export function mergeRecovered(local: { passages: Awaited<ReturnType<typeof toPassages>>; library: LibraryEntry[] }, web: ResearchSource[], rec: { passages: Awaited<ReturnType<typeof toPassages>>; references: { competencyId?: string; code: string | null; title: string; outcome: string | null }[]; abstracts: { title: string; journal: string | null; year: number | null; url: string; abstract: string; retrievedAt: string }[] }) {
  const passages = [...local.passages, ...rec.passages.filter(p => !local.passages.some(l => l.chunkId === p.chunkId))];
  const library = [...local.library, ...rec.references.filter(r => r.competencyId && !local.library.some(l => l.id === r.competencyId))
    .map(r => ({ id: r.competencyId!, code: r.code, title: r.title, outcome: r.outcome, contentStatus: "approved" }))];
  const sources = [...web, ...rec.abstracts.filter(a => !web.some(w => w.url === a.url)).map(a => ({
    url: a.url, title: a.title, publisher: a.journal ?? "Published research (abstract only)", published: a.year ? String(a.year) : null, retrievedAt: a.retrievedAt, excerpt: a.abstract.slice(0, 600),
  }))];
  return { passages, library, web: sources };
}

/** A suggested answer, with its evidence, saved for the student. The attempt (when made first) is kept with it. */
export async function answerQuestion(ctx: IndividualContext, req: Request, input: {
  questionId: string; attempt: { option?: string | null; text?: string | null } | null; sources: ExamEvidenceSource[] | null; depth: ExamResearchDepth | null;
  /** SCHOLAR-SQIE-02: explain from a recovery. Only its id and mode are taken; the evidence is found again here. */
  recovery?: RecoveryRequest | null;
}): Promise<Out> {
  const policy = await loadIndividualPolicy(ctx.admin);
  const p = policy.scholarExams;
  if (!p.enabled) return json(403, { error: "Studying examination papers is not offered on Scholar at the moment." });
  const q = await getExamQuestion(ctx.admin, ctx.userId, input.questionId);
  if (!q) return json(404, { error: "That question could not be found." });
  if (q.flags.some(f => f.kind === "lead_in")) return json(400, { error: "This is the shared information for the parts below it. Choose one of its parts." });
  const statement = await legacyStatementRefusal(ctx, q);
  if (statement) return statement;
  const text = await questionWithContext(ctx, q);
  const attemptText = [input.attempt?.option ? `Chose ${input.attempt.option}` : null, input.attempt?.text?.trim() || null].filter(Boolean).join(". ").slice(0, 3000) || null;
  if ([text, attemptText ?? ""].some(t => findPatientIdentifiers(t).length))
    return json(422, { error: "That looks like it identifies a patient, so nothing was sent. Remove it and try again." });

  const pre = await aiPreflight(ctx);
  if (pre) return json(pre.status, await pre.json());

  // The student may use less than policy allows, never more.
  const sources = (input.sources?.length ? input.sources.filter(s => p.sources.includes(s)) : p.sources) as ExamEvidenceSource[];
  const depth = input.depth && RESEARCH_DEPTH[input.depth] && RESEARCH_DEPTH[input.depth].maxUses <= RESEARCH_DEPTH[p.depth].maxUses ? input.depth : p.depth;
  let local = await gatherLocalEvidence(ctx, policy, q, text, sources);
  const web = sources.includes("web") ? await webEvidence(ctx, req, policy, text, depth) : { sources: [], state: "off" as const, message: null, searches: 0 };
  if ("status" in web) return web;
  // SCHOLAR-SQIE-02: every withhold is typed (withheld.reason) and carries the question and the attempt back.
  const kept = { questionId: q.id, attempt: input.attempt ?? null };
  // SCHOLAR-SQIE-02, "Explain using approved references": the recovery's evidence, re-derived HERE for the server's own
  // question text, the paper itself left out. Nothing the browser sent becomes evidence. No evidence: no AI call.
  let webSources = web.sources;
  const rec = input.recovery ? await rederiveRecovery(ctx, policy, { ...input.recovery, question: text.slice(0, 600) }, { materialId: q.materialId, excludeMaterialId: q.materialId }) : null;
  if (rec && !rec.ok && rec.reason === "unknown") return json(400, { error: "Those learning resources could not be found. Look for them again." });
  if (rec && !rec.ok) return json(200, { withheld: { reason: "no_evidence" }, ...kept, message: RECOVERY_STILL_WITHHELD, recovered: recoveredReply(rec, false) });
  if (rec?.ok) { const m = mergeRecovered(local, web.sources, rec.inputs); local = { passages: m.passages, library: m.library }; webSources = m.web; }
  const evidence = buildEvidence(local.passages, local.library, webSources);
  const research = { depth, sources, web: { state: web.state, message: web.message, searches: web.searches } };
  if (!evidence.length)
    return json(200, { noEvidence: true, withheld: { reason: "no_evidence" }, ...kept, research, message: "No evidence was found for this question in your notes, the Competen library or web research, so no answer was written. Upload notes that cover it, then try again." });

  const ai = scholarAiRunner(ctx, req, EXAM_ACTIVITY.answer, await scholarRisk(ctx.admin, ctx.userId, { text, passages: local.passages }));
  const r = await runAnswer(ai.run, ctx.userId, { question: text, evidence, attempt: attemptText, optionLabels: q.options.map(o => o.label) });
  const refused = meteredRefusal(ai.refusal());
  if (refused) return json(refused.status, await refused.json());
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_exam_answer", q.id, {
    evidence: { notes: local.passages.length, library: local.library.length, web: web.sources.length }, web: web.state, attempted: !!attemptText,
    outcome: r.ok ? (r.check.ok ? "shown" : `withheld:${r.check.reason}`) : `error:${r.error}`, model: r.ok ? r.model : null,
  });
  if (!r.ok) return json(AI_ERROR[r.error].status, { error: AI_ERROR[r.error].error });
  // SCHOLAR-SQIE-02: withheld vs answered, counted apart (codes only). The paper answer stays on its own activity.
  const o = answerOutcome(r.check.ok ? null : r.check.reason);
  await recordScholarOutcome(ctx.admin, ai, { operation: "individual_scholar_exam_answer", outputKind: "explanation", outcome: o.outcome, reasons: o.reasons, promptVersion: r.promptVersion });
  if (rec?.ok && input.recovery) await recordRecoveryResult(ctx.admin, input.recovery.id, r.check.ok);
  const recovered = rec ? { recovered: recoveredReply(rec, r.check.ok) } : {};
  const shownEvidence = evidence.map(storedEvidence);
  if (!r.check.ok) return json(200, { withheld: { reason: r.check.reason }, reason: r.check.reason, ...kept, message: rec ? RECOVERY_STILL_WITHHELD : ANSWER_WITHHELD[r.check.reason], evidence: shownEvidence, research, ...recovered });

  const attempt = input.attempt && (input.attempt.option || input.attempt.text) ? { option: input.attempt.option ?? null, text: input.attempt.text?.slice(0, 3000) ?? null } : null;
  const id = await saveExamAnswer(ctx.admin, ctx.userId, {
    materialId: q.materialId, questionId: q.id, kind: "answer", attempt, content: r.check.content, evidence: shownEvidence, research,
    model: r.model, provider: r.provider, promptVersion: r.promptVersion,
  });
  return json(200, { id, content: r.check.content, evidence: shownEvidence, research, attempt, provenance: { model: r.model, promptVersion: r.promptVersion }, saved: !!id, ...recovered });
}

/** A follow-up question about a saved answer, on the same evidence. Not stored. */
export async function followUp(ctx: IndividualContext, req: Request, input: { answerId: string; ask: string }): Promise<Out> {
  const a = await getExamAnswer(ctx.admin, ctx.userId, input.answerId);
  if (!a || a.kind !== "answer" || !a.questionId) return json(404, { error: "That answer could not be found." });
  if (findPatientIdentifiers(input.ask).length) return json(422, { error: "That looks like it identifies a patient. Remove it and try again." });
  const q = await getExamQuestion(ctx.admin, ctx.userId, a.questionId);
  if (!q) return json(404, { error: "That question could not be found." });
  const pre = await aiPreflight(ctx);
  if (pre) return json(pre.status, await pre.json());
  const evidence = a.evidence.map(fromStored);
  if (!evidence.length) return json(200, { withheld: { reason: "no_evidence" }, answerId: a.id, ask: input.ask, message: "This answer has no evidence to ask about." });
  const text = await questionWithContext(ctx, q);
  const answer = [String(a.content.examAnswer ?? ""), String(a.content.explanation ?? "")].join("\n");
  const ai = scholarAiRunner(ctx, req, EXAM_ACTIVITY.follow_up, await scholarRisk(ctx.admin, ctx.userId, { text: `${text}\n${input.ask}`, passages: [] }));
  const r = await runFollowUp(ai.run, ctx.userId, { question: text, answer, ask: input.ask, evidence });
  const refused = meteredRefusal(ai.refusal());
  if (refused) return json(refused.status, await refused.json());
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_exam_follow_up", a.id, { ask_chars: input.ask.length, outcome: r.ok ? (r.check.ok ? "shown" : `withheld:${r.check.reason}`) : `error:${r.error}` });
  if (!r.ok) return json(AI_ERROR[r.error].status, { error: AI_ERROR[r.error].error });
  if (!r.check.ok) return json(200, { withheld: { reason: r.check.reason }, answerId: a.id, ask: input.ask, message: r.check.reason === "no_citation" || r.check.reason === "bad_citation" ? "The reply did not cite the evidence correctly, so it was not shown." : r.check.reason === "identifier" ? ANSWER_WITHHELD.identifier : ANSWER_WITHHELD.ungrounded });
  return json(200, { text: r.check.text, cited: r.check.cited });
}

/** A revision guide from the paper's saved answers and their evidence, saved as kind "guide". */
export async function revisionGuide(ctx: IndividualContext, req: Request, materialId: string): Promise<Out> {
  const answers = await listExamAnswers(ctx.admin, ctx.userId, materialId);
  if (!answers.ok) return answers.notProvisioned ? NOT_SET_UP : json(503, { error: "Your saved answers could not be read just now." });
  const latest = new Map<string, (typeof answers.data)[number]>();
  for (const a of answers.data) if (a.kind === "answer" && a.questionId && !latest.has(a.questionId)) latest.set(a.questionId, a);
  if (!latest.size) return json(400, { error: "Reveal at least one suggested answer first. The guide is written from them." });
  const pre = await aiPreflight(ctx);
  if (pre) return json(pre.status, await pre.json());
  const chosen = [...latest.values()].slice(0, 12);
  // One evidence list for the guide: each source once, tagged again in order.
  const seen = new Map<string, Evidence>();
  for (const a of chosen) for (const s of a.evidence.map(fromStored)) {
    const k = `${s.kind}|${s.url ?? ""}|${s.chunkId ?? ""}|${s.title}`;
    if (!seen.has(k) && seen.size < 30) seen.set(k, s);
  }
  const counts: Record<string, number> = { notes: 0, library: 0, web: 0 };
  const evidence = [...seen.values()].map(e => ({ ...e, tag: `${e.kind === "notes" ? "N" : e.kind === "library" ? "L" : "W"}${++counts[e.kind]}` }));
  const all = await listExamQuestions(ctx.admin, ctx.userId, materialId);
  const qs = all.ok ? all.data.filter(q => latest.has(q.id)).map(q => questionText(q, leadInFor(q, all.data))) : [];
  const ai = scholarAiRunner(ctx, req, EXAM_ACTIVITY.guide, await scholarRisk(ctx.admin, ctx.userId, { text: qs.join("\n"), passages: [] }));
  const r = await runGuide(ai.run, ctx.userId, { questions: qs, evidence });
  const refused = meteredRefusal(ai.refusal());
  if (refused) return json(refused.status, await refused.json());
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_exam_guide", materialId, { questions: qs.length, outcome: r.ok ? (r.check.ok ? "shown" : `withheld:${r.check.reason}`) : `error:${r.error}` });
  if (!r.ok) return json(AI_ERROR[r.error].status, { error: AI_ERROR[r.error].error });
  if (!r.check.ok) return json(200, { withheld: { reason: r.check.reason }, materialId, message: "The guide included details its evidence does not support, so it was not shown. Try again." });
  const stored = evidence.map(storedEvidence);
  const id = await saveExamAnswer(ctx.admin, ctx.userId, {
    materialId, questionId: null, kind: "guide", attempt: null, content: { text: r.check.text, cited: r.check.cited, questions: qs.length },
    evidence: stored, research: {}, model: r.model, provider: r.provider, promptVersion: r.promptVersion,
  });
  return json(200, { id, text: r.check.text, evidence: stored, saved: !!id });
}

const stripTags = (s: string) => s.replace(/\s*\[[NLW]\d+\]/g, "").replace(/\s+\./g, ".").trim();

/** A saved suggested answer → a flashcard on the spaced-review schedule (the existing revision store). */
export async function answerToRevision(ctx: IndividualContext, answerId: string): Promise<Out> {
  const a = await getExamAnswer(ctx.admin, ctx.userId, answerId);
  if (!a || a.kind !== "answer" || !a.questionId) return json(404, { error: "That answer could not be found." });
  if (a.revisionQuestionId) return json(200, { revisionQuestionId: a.revisionQuestionId, existing: true });
  const q = await getExamQuestion(ctx.admin, ctx.userId, a.questionId);
  if (!q) return json(404, { error: "That question could not be found." });
  if (!q.chunkId) return json(409, { error: "This question was transcribed from a scanned page, so it has no section of your material to revise from yet." });
  const passage = await getPassage(ctx.admin, ctx.userId, q.chunkId);
  if (!passage) return json(404, { error: "The section of the paper this question came from could not be found." });
  // SCHOLAR-QUESTION-INTELLIGENCE-01: a statement (kept as a "question" by the v1 parser) never becomes a card front.
  const all = await listExamQuestions(ctx.admin, ctx.userId, q.materialId);
  const front = revisionFront(q, all.ok ? leadInFor(q, all.data) : null);
  if (!front) return json(409, { error: "This item reads as a statement from notes, not a question, so it is not made into a revision card. Generate practice questions from the material instead." });
  const back = [a.content.option ? `${a.content.option}. ` : "", stripTags(String(a.content.examAnswer ?? ""))].join("").slice(0, 2000);
  const r = await insertRevisionQuestions(ctx.admin, ctx.userId, {
    passage, kind: "flashcard", model: a.model, provider: a.provider, promptVersion: a.promptVersion,
    drafts: [{ stem: front, options: [], answer: { back }, rationale: stripTags(String(a.content.explanation ?? "")).slice(0, 2000) || "A suggested answer from your examination paper study.", sourceQuote: passage.content.slice(0, 500), difficulty: 2 }],
  });
  if (!r.ok || !r.ids[0]) return json(r.notProvisioned ? 503 : 500, { error: "The revision card could not be made just now." });
  await linkRevision(ctx.admin, ctx.userId, a.id, r.ids[0]);
  await audit(ctx, "individual_scholar_exam_to_revision", "individual_scholar_exam_answer", a.id, { revision_question_id: r.ids[0] });
  return json(201, { revisionQuestionId: r.ids[0] });
}

/**
 * A FULLY SCANNED paper at upload (no text at all): with policy scholar_exam_scanned_pages = ai_transcription, the
 * student's attestation and their AI consent, its pages are transcribed by AI -- two at a time, up to
 * TRANSCRIBE_MAX_PAGES, stopping at the end of the document -- and screened for patient identifiers like any upload.
 * Anything else answers null and the upload is refused as before (no text, OCR not available).
 */
export async function transcribeScannedUpload(ctx: IndividualContext, req: Request, bytes: Uint8Array, policy: IndividualPolicy): Promise<{ pages: { page: number; text: string }[]; model: string } | Out | null> {
  if (!policy.scholarExams.enabled || policy.scholarExams.scannedPages !== "ai_transcription") return null;
  const pre = await aiPreflight(ctx);
  if (pre) return json(pre.status, await pre.json());
  const pdf = Buffer.from(bytes).toString("base64");
  const ai = scholarAiRunner(ctx, req, EXAM_ACTIVITY.transcribe, Object.assign(await scholarRisk(ctx.admin, ctx.userId, { text: null, passages: [] }), { intentContext: { surface: "material" as const, activity: "transcribe" } }));
  const pages: { page: number; text: string }[] = [];
  let model = "";
  for (let start = 1; start <= TRANSCRIBE_MAX_PAGES; start += TRANSCRIBE_BATCH) {
    const batch = Array.from({ length: TRANSCRIBE_BATCH }, (_, i) => start + i).filter(n => n <= TRANSCRIBE_MAX_PAGES);
    const r = await runTranscription(ai.run, ctx.userId, { pdfBase64: pdf, pages: batch });
    const refused = meteredRefusal(ai.refusal());
    if (refused) return json(refused.status, await refused.json());
    if (!r.ok) return pages.length ? { pages, model } : json(AI_ERROR[r.error].status, { error: AI_ERROR[r.error].error });
    model = r.model;
    if (!r.pages.length) break; // past the last page
    pages.push(...r.pages);
  }
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_exam_transcribe", null, { at: "upload", pages: pages.length });
  return { pages, model };
}
