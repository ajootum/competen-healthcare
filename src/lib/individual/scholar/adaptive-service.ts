/* eslint-disable @typescript-eslint/no-explicit-any */
// ── ADAPTIVE EXAMS -- THE READS, WRITES AND ONE GENERATION CALL ── SCHOLAR-PRACTICE-EXAMS-01 (owner, 30 Oct 2026) ─────
//
// The I/O half of adaptive.ts, on what Revision already has. Nothing here is a second question bank, marker or
// scheduler:
//   QUESTIONS   the governed Competen library first (library-questions.ts: published, clinically approved, matched to a
//               section by an ACCEPTED competency link -- copied as the learner's own row, store.ts insertLibraryCopies),
//               then the student's own stored questions (store.ts revisionPool), then -- only for the difficulty the
//               rule asks for, when neither has one -- ONE generation call for a small batch (activity `questions`,
//               through the Holdings allowance with its risk, exactly as Revision writes a shortfall).
//   MARKING     /api/individual/scholar/revision/answer, unchanged: code where code can, then AI evaluation (activity
//               `evaluate`) or the student's own judgement, each labelled; a missed answer makes its review card.
//   STATE       the 417 session (its items added one at a time) and the 417 set whose scope holds the blueprint.
// ⚠ ESTATE TABLES ARE NEVER READ (D1): no estate question bank, quiz or adaptive blueprint (136). Scholar's own rows only.

import type { IndividualContext } from "../guard";
import type { IndividualPolicy } from "../policy";
import { leadingCompetency } from "@/lib/competency/mapping";
import { outcomeOf } from "@/lib/ai/outcomes";
import {
  acceptedQuestionCompetencies, appendAdaptiveItem, chunkMappings, getAdaptiveSet, getPassage, getRevisionSession, insertLibraryCopies, insertQuestions,
  insertRevisionQuestions, listMappings, listMaterials, questionsByIds, revisionPool, sectionLinks, topicsOfSections, updateAdaptiveScope, updateRevisionSession,
  type HeldAnswer, type QuestionRow, type RevisionSessionRow, type SessionAttempt,
} from "./store";
import { loadLibraryQuestions, pickLibraryQuestions, type LibrarySection } from "./library-questions";
import { competencyLabels, loadLearnerCatalogue } from "./competency-view";
import { resolveScope } from "./learn";
import { SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, refusalWords, scholarAiRunner, scholarRisk } from "./http";
import { activityState, getScholarAiStanding } from "./ai-standing";
import { formatPromptVersion, runQuestions, runRevisionQuestions } from "./generation";
import { effectiveKind, existingObjectives, keyOf, planGeneration } from "./revision";
import { missOf, recentMisses, signalsOf, type RecentMiss } from "./misconception";
import { generationContextLoader } from "./question-context";
import { answerOutcome, recordScholarOutcome } from "./outcome";
import { rubricOf, stemKey, type GenerationDifficulty } from "./question-intel";
import { ADAPTIVE_GENERATION_CALLS_MAX } from "./config";
import {
  BLUEPRINT_LIBRARY_MAX, BLUEPRINT_SECTIONS_MAX, BLUEPRINT_COMPETENCIES_MAX, adaptationOutcomes, blueprintOf, blueprintScope, buildAdaptiveReport,
  cognitiveOf, formatRotation, itemSource, nextDifficulty, recordServed, selectNext, servedSources, unusedCoverage,
  type AdaptiveBlueprint, type AdaptiveReport, type AdaptiveScope, type Candidate, type NextPick, type ReportItem, type ServedSource, type StopReason,
} from "./adaptive";

// ── WHAT THE EXAM COVERS ──

/**
 * The sections an exam draws on, and the competencies they are linked to by ACCEPTED links. "My programme" is every
 * section the student has linked, and accepted, to a competency of their programme's catalogue: a practice exam aligned
 * to the programme's competencies. "All my notes" draws stored questions from everything, and writes new ones from the
 * three most recent materials, as Revision does.
 */
export async function resolveAdaptiveSections(admin: any, userId: string, scope: AdaptiveScope): Promise<{ ok: true; sections: string[]; competencyIds: string[]; title: string } | { ok: false; status: number; error: string }> {
  if (scope.kind === "programme" || scope.kind === "competencies") {
    const learner = await loadLearnerCatalogue(admin, userId);
    const catalogue = learner.competencies ?? [];
    if (scope.kind === "programme" && !learner.programme) return { ok: false, status: 404, error: "You have not chosen a programme yet, so there are no programme competencies to align the exam to. Choose “All my notes” instead, or set your programme in Settings." };
    if (learner.competencies === null) return { ok: false, status: 503, error: "Your programme's competencies could not be read just now." };
    const allowed = new Set(scope.kind === "programme" ? catalogue.map(c => c.id) : scope.competencyIds);
    const maps = await listMappings(admin, userId);
    if (!maps.ok) return maps.notProvisioned ? { ok: false, status: 404, error: "Competency links are not available here yet." } : { ok: false, status: 503, error: "Your competency links could not be read just now." };
    const accepted = maps.data.mappings.filter(m => m.state === "accepted" && allowed.has(m.competencyId));
    if (!accepted.length) return { ok: false, status: 404, error: "None of your notes is linked to these competencies by a link you have accepted. In a material, find its topics and accept the competency links that fit." };
    // Round-robin over the competencies, so a long list of one competency's sections does not crowd the others out.
    const lanes = [...new Set(accepted.map(m => m.competencyId))].map(c => [...new Set(accepted.filter(m => m.competencyId === c).map(m => m.chunkId))]);
    const sections: string[] = [];
    for (let i = 0; sections.length < BLUEPRINT_SECTIONS_MAX && lanes.some(l => i < l.length); i++)
      for (const l of lanes) if (l[i] && !sections.includes(l[i]) && sections.length < BLUEPRINT_SECTIONS_MAX) sections.push(l[i]);
    const comps = [...new Set(accepted.filter(m => sections.includes(m.chunkId)).map(m => m.competencyId))].slice(0, BLUEPRINT_COMPETENCIES_MAX);
    const title = scope.kind === "programme" ? `${learner.programme?.label ?? "My programme"} competencies`
      : comps.length === 1 ? catalogue.find(c => c.id === comps[0])?.title ?? "A competency" : `${comps.length} competencies`;
    return { ok: true, sections, competencyIds: comps, title };
  }
  let resolved: Awaited<ReturnType<typeof resolveScope>> | null = null;
  if (scope.kind === "library") {
    const mats = await listMaterials(admin, userId);
    const recent = mats.ok ? mats.data.filter(m => m.chunkCount > 0).slice(0, 3).map(m => m.id) : [];
    if (recent.length) resolved = await resolveScope(admin, userId, recent.length === 1 ? { kind: "document", materialId: recent[0] } : { kind: "documents", materialIds: recent });
    if (resolved && !resolved.ok) resolved = null;
  } else {
    resolved = await resolveScope(admin, userId, scope.kind === "documents"
      ? (scope.materialIds.length === 1 ? { kind: "document", materialId: scope.materialIds[0] } : { kind: "documents", materialIds: scope.materialIds })
      : { kind: "topic", topic: scope.topic });
    if (!resolved.ok) return resolved;
  }
  const sections = resolved && resolved.ok ? resolved.sections.map(s => s.chunkId).slice(0, BLUEPRINT_SECTIONS_MAX) : [];
  const links = await sectionLinks(admin, userId, sections);
  return { ok: true, sections, competencyIds: [...new Set(links.filter(l => l.accepted).map(l => l.competencyId))].slice(0, BLUEPRINT_COMPETENCIES_MAX), title: scope.kind === "library" ? "All my notes" : resolved && resolved.ok ? resolved.title : "My notes" };
}

/**
 * LIBRARY FIRST. The governed library questions matched to these sections (accepted links, their topics), copied as the
 * student's own rows (store.ts insertLibraryCopies -- 710 only; [] without it). Held copies are reused, not copied again.
 */
export async function adaptiveLibraryCopies(ctx: IndividualContext, sections: readonly string[], length: number): Promise<string[]> {
  const ids = sections.slice(0, 40);
  if (!ids.length) return [];
  const [links, topics] = await Promise.all([sectionLinks(ctx.admin, ctx.userId, ids), topicsOfSections(ctx.admin, ctx.userId, ids)]);
  const libSections: LibrarySection[] = ids.map(c => ({ chunkId: c, competencyIds: [...new Set(links.filter(l => l.chunkId === c && l.accepted).map(l => l.competencyId))], topics: topics.get(c) ?? [] }))
    .filter(x => x.competencyIds.length);
  if (!libSections.length) return [];
  const library = await loadLibraryQuestions(ctx.admin, libSections.flatMap(x => x.competencyIds));
  const picks = pickLibraryQuestions({ questions: library, sections: libSections, exclude: new Set(), limit: Math.min(BLUEPRINT_LIBRARY_MAX, length) });
  const copies = await insertLibraryCopies(ctx.admin, ctx.userId, picks);
  await audit(ctx, "individual_scholar_revision_library", "individual_scholar_revision_session", null, {
    adaptive: true, offered: library.length, picked: picks.length, copied: copies.copied, reused: copies.ids.length, versions: picks.map(p => p.question.versionId),
  });
  return copies.ids.slice(0, BLUEPRINT_LIBRARY_MAX);
}

// ── ONE EXAM, AS STORED ──

export type AdaptiveState = {
  session: RevisionSessionRow; setId: string; setTitle: string; blueprint: AdaptiveBlueprint; fallback: boolean;
  questionIds: string[]; attempts: SessionAttempt[]; held: HeldAnswer[]; questions: Map<string, QuestionRow>;
  /** D4: each served item's source as recorded when it was chosen (blueprint.served), and when the exam was set up. */
  provenance: Map<string, ServedSource>; setUpAt: string;
};

/** An adaptive exam of the caller's: its session, blueprint, items and answers. null: not theirs, or not an adaptive exam. */
export async function loadAdaptive(admin: any, userId: string, sessionId: string): Promise<{ ok: true; data: AdaptiveState | null } | { ok: false }> {
  const s = await getRevisionSession(admin, userId, sessionId);
  if (!s.ok) return { ok: false };
  if (!s.data) return { ok: true, data: null };
  const set = await getAdaptiveSet(admin, userId, s.data.session.setId);
  const blueprint = set ? blueprintOf(set.scope) : null;
  if (!set || !blueprint) return { ok: true, data: null };
  const q = await questionsByIds(admin, userId, s.data.questionIds);
  if (!q.ok) return { ok: false };
  const questions = new Map(q.data.map(x => [x.id, x]));
  return {
    ok: true,
    data: {
      session: s.data.session, setId: set.id, setTitle: set.title, blueprint, fallback: s.data.session.mode !== "adaptive",
      // A question removed with its material leaves the exam; the rest stay in order.
      questionIds: s.data.questionIds.filter(id => questions.has(id)), attempts: s.data.attempts, held: s.data.held, questions,
      provenance: servedSources(blueprint.served, s.data.questionIds), setUpAt: set.createdAt,
    },
  };
}

/** Pure. Each item's outcome in order: right/missed (and when marked), held, or unanswered (the current one). */
export function stateOutcomes(st: Pick<AdaptiveState, "questionIds" | "attempts" | "held" | "session">): Pick<ReportItem, "outcome" | "markedAfterEnd">[] {
  const att = new Map(st.attempts.map(a => [a.questionId, a]));
  const held = new Set(st.held.map(h => h.questionId));
  const ended = st.session.completedAt;
  return st.questionIds.map(id => {
    const a = att.get(id);
    if (a) return { outcome: { correct: a.correct, score: a.score, marking: a.marking }, markedAfterEnd: !!ended && a.answeredAt > ended };
    return { outcome: held.has(id) ? "held" as const : "unanswered" as const };
  });
}

/** The current question: the last item, while it is neither answered nor held. */
export function currentQuestion(st: AdaptiveState): QuestionRow | null {
  const last = st.questionIds.at(-1);
  if (!last || st.attempts.some(a => a.questionId === last) || st.held.some(h => h.questionId === last)) return null;
  return st.questions.get(last) ?? null;
}

// ── THE NEXT QUESTION ──

async function candidates(admin: any, userId: string, bp: AdaptiveBlueprint): Promise<{ questions: QuestionRow[]; pool: Candidate[]; misses: RecentMiss[] } | null> {
  const p = await revisionPool(admin, userId, { chunkIds: bp.scope.kind === "library" ? null : bp.sections, kinds: bp.formats, extraIds: bp.libraryIds });
  if (!p.ok) return null;
  const questions = p.data.questions.filter(q => !!keyOf(q));
  // SCHOLAR-SQIE-LEARNER-01: a cloze, true/false or extended item is stored as `short` but is not the short answer the exam offered.
  // The learner's misses in the last 30 days steer the next pick (misconception.ts).
  const missRows: RecentMiss[] = questions.flatMap(q => missOf(q, p.data.stats.get(q.id)?.lastMissAt));
  return {
    questions,
    misses: recentMisses(missRows, new Date().toISOString()),
    pool: questions.map(q => ({
      id: q.id, kind: effectiveKind(q), difficulty: q.difficulty, library: !!q.library, createdAt: q.createdAt, lastAnsweredAt: p.data.stats.get(q.id)?.lastAnsweredAt ?? null,
      ...signalsOf(q), chunkId: q.chunkId, due: p.data.stats.get(q.id)?.due ?? false,
    })),
  };
}

/**
 * The next question for an exam at the difficulty the rule asks for: library → stored → one generation call for
 * that difficulty (where policy, the student's AI and the exam's own call limit allow) → the nearest difficulty that
 * exists. null pick: nothing at all is left to offer.
 */
export async function chooseNext(ctx: IndividualContext, req: Request, policy: IndividualPolicy, input: {
  setId: string; blueprint: AdaptiveBlueprint; questionIds: readonly string[]; outcomes: readonly (boolean | null)[]; lastKind: QuestionRow["kind"] | null;
}): Promise<{ ok: true; pick: NextPick | null; target: GenerationDifficulty; note: string | null; blueprint: AdaptiveBlueprint; generated: string[] } | { ok: false }> {
  const target = nextDifficulty(input.blueprint.start, input.outcomes);
  const exclude = new Set(input.questionIds);
  let found = await candidates(ctx.admin, ctx.userId, input.blueprint);
  if (!found) return { ok: false };
  const first = selectNext({ target, pool: found.pool, exclude, formats: input.blueprint.formats, lastKind: input.lastKind, recentMisses: found.misses });
  if (first.exact) return { ok: true, pick: first.exact, target, note: null, blueprint: input.blueprint, generated: [] };
  // No unused question at the target: write a batch (within the exam's call limit). Only when that is not possible is the
  // nearest difficulty offered.
  const gen = await generateForTarget(ctx, req, policy, input.setId, input.blueprint, found.questions, exclude, target, input.lastKind);
  let nearest = first.nearest;
  if (gen.ids.length) {
    found = (await candidates(ctx.admin, ctx.userId, gen.blueprint)) ?? found;
    const again = selectNext({ target, pool: found.pool, exclude, formats: gen.blueprint.formats, lastKind: input.lastKind, fresh: new Set(gen.ids), recentMisses: found.misses });
    if (again.exact) return { ok: true, pick: again.exact, target, note: null, blueprint: gen.blueprint, generated: gen.ids };
    nearest = again.nearest ?? nearest;
  }
  return { ok: true, pick: nearest, target, note: nearest ? `No ${target === "easy" ? "easier" : target === "harder" ? "harder" : "standard"} question was available${gen.note ? ` (${gen.note.replace(/\.$/, "")})` : ""}, so this one is the nearest difficulty there is.` : gen.note, blueprint: gen.blueprint, generated: gen.ids };
}

/** One generation call for a small batch at the target difficulty. Counted against the exam's own limit. */
async function generateForTarget(ctx: IndividualContext, req: Request, policy: IndividualPolicy, setId: string, bp: AdaptiveBlueprint, pool: readonly QuestionRow[], used: ReadonlySet<string>, target: GenerationDifficulty, lastKind: QuestionRow["kind"] | null): Promise<{ ids: string[]; note: string | null; blueprint: AdaptiveBlueprint }> {
  const none = (note: string | null) => ({ ids: [], note, blueprint: bp });
  if (!bp.sections.length) return none(null);
  if (policy.scholarRevisionGeneration === "saved_only") return none("new questions are not written here");
  if (bp.calls >= ADAPTIVE_GENERATION_CALLS_MAX) return none("this exam has written as many new questions as it may");
  const standing = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "questions");
  if (!standing.available) return none(standing.message ?? "new AI help is not available right now");
  const pre = await aiPreflight(ctx);
  if (pre) return none(((await pre.clone().json().catch(() => ({}))) as { error?: string }).error ?? "new questions could not be written just now");
  // D3: a section and format is skipped only while it still has an UNUSED question at this difficulty and prompt version.
  // Questions this exam has already served do not count, so the exam can go on. Identical stems are still never written
  // twice (`existing` stems below).
  const existing = unusedCoverage(pool.map(q => ({ id: q.id, chunkId: q.chunkId, kind: effectiveKind(q), difficulty: q.difficulty, current: q.promptVersion.startsWith(formatPromptVersion(effectiveKind(q))) })), used, target);
  const call = planGeneration({ shortfall: 3, chunkIds: bp.sections, formats: formatRotation(bp.formats, lastKind), existing })[0];
  if (!call) return none("every section and format already has questions at this difficulty");
  const passage = await getPassage(ctx.admin, ctx.userId, call.chunkId);
  if (!passage) return none(null);
  const next: AdaptiveBlueprint = { ...bp, calls: bp.calls + 1 };
  await updateAdaptiveScope(ctx.admin, ctx.userId, setId, blueprintScope(next));
  const ai = scholarAiRunner(ctx, req, "questions", await scholarRisk(ctx.admin, ctx.userId, { passages: [passage] }), `a${next.calls}`);
  const competencyId = leadingCompetency(await chunkMappings(ctx.admin, ctx.userId, passage.chunkId));
  const loader = await generationContextLoader(ctx.admin, ctx.userId, policy);
  const context = await loader.forSection(passage.chunkId, { difficulty: target, mode: call.kind === "mcq" ? "notes" : bp.source });
  const stems = new Set(pool.map(q => stemKey(q.stem)));
  let ids: string[] = [], outcome = "", calls = 0;
  let measured: { accepted: number; rejected: number; reasons: string[]; promptVersion: string | null } | null = null;
  if (call.kind === "mcq") {
    const r = await runQuestions(ctx.userId, "mcq", passage, 3, ai.run, { context, existing: stems, verifyFormats: policy.scholarVerifyFormats, existingObjectives: existingObjectives(pool, passage.chunkId, "mcq") });
    if (r.ok) {
      calls = r.calls;
      const s = await insertQuestions(ctx.admin, ctx.userId, { passage, kind: "mcq", drafts: r.check.kept, model: r.model, provider: r.provider, promptVersion: r.promptVersion, competencyId });
      ids = s.ids;
      outcome = `kept:${ids.length},dropped:${r.check.dropped.length}`;
      measured = { accepted: ids.length, rejected: r.check.dropped.length, reasons: r.check.dropped.map(d => d.reason), promptVersion: r.promptVersion };
    } else outcome = `error:${r.error}`;
  } else {
    const r = await runRevisionQuestions(ctx.userId, call.kind, passage, 3, ai.run, { context, existing: stems, verifyFormats: policy.scholarVerifyFormats, existingObjectives: existingObjectives(pool, passage.chunkId, call.kind) });
    if (r.ok) {
      calls = r.calls;
      const s = await insertRevisionQuestions(ctx.admin, ctx.userId, { passage, kind: call.kind, drafts: r.kept, model: r.model, provider: r.provider, promptVersion: r.promptVersion, competencyId });
      ids = s.ok ? s.ids : [];
      outcome = s.ok ? `kept:${ids.length},dropped:${r.dropped.length}` : s.notProvisioned ? "not_provisioned" : "save_failed";
      measured = { accepted: ids.length, rejected: r.dropped.length, reasons: [...r.dropped, ...(s.ok ? [] : ["save_failed"])], promptVersion: r.promptVersion };
    } else outcome = `error:${r.error}`;
  }
  const refusal = ai.refusal();
  if (refusal) return { ids: [], note: refusalWords(refusal).message, blueprint: next };
  // SCHOLAR-AI-OPT-01: one outcome per generation call, codes and counts only.
  await recordScholarOutcome(ctx.admin, ai, {
    operation: call.kind === "mcq" ? "individual_scholar_mcq" : `individual_scholar_revision_${call.kind}`, outputKind: "question",
    ...(measured
      ? { outcome: outcomeOf(measured.accepted, measured.rejected), ...measured, reasons: [...measured.reasons, ...answerOutcome(measured.accepted ? null : "insufficient_grounding").reasons].slice(-20) }
      : { outcome: "error" as const, reasons: [outcome.replace(/:/g, "_")] }),
  });
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_revision_generate", null, {
    adaptive: true, chunk_id: passage.chunkId, kind: call.kind, asked: 3, outcome, competency_id: competencyId, ai_calls: calls, difficulty: target, source: context.mode, references: context.references.length,
  });
  return { ids, note: ids.length ? null : "no new question passed the checks", blueprint: next };
}

/** D4: the served item's source recorded on the blueprint, once the item is the session's (adaptive.ts recordServed). */
export async function recordServedItem(admin: any, userId: string, setId: string, bp: AdaptiveBlueprint, ordinal: number, pick: NextPick, generated: readonly string[]): Promise<AdaptiveBlueprint> {
  const next = recordServed(bp, ordinal, pick, generated);
  await updateAdaptiveScope(admin, userId, setId, blueprintScope(next));
  return next;
}

/** The next question added as the exam's next item. false: another request added one first (the caller reloads). */
export const addItem = (admin: any, userId: string, sessionId: string, ordinal: number, questionId: string) => appendAdaptiveItem(admin, userId, sessionId, ordinal, questionId);

/** The exam finished: the session completed, and why it stopped kept with its blueprint. */
export async function finishAdaptive(ctx: IndividualContext, st: AdaptiveState, reason: StopReason): Promise<AdaptiveState> {
  const now = new Date().toISOString();
  if (st.session.status !== "completed") {
    await updateRevisionSession(ctx.admin, ctx.userId, st.session.id, { completed: true });
    await updateAdaptiveScope(ctx.admin, ctx.userId, st.setId, blueprintScope({ ...st.blueprint, stopped: reason }));
    const marked = st.attempts.filter(a => st.questionIds.includes(a.questionId));
    await audit(ctx, "individual_scholar_revision_completed", "individual_scholar_revision_session", st.session.id, {
      adaptive: true, stopped: reason, answered: marked.length, held: st.held.length, of: st.blueprint.length, correct: marked.filter(a => a.correct).length,
      finish: nextDifficulty(st.blueprint.start, adaptationOutcomes(stateOutcomes(st))),
    });
    return { ...st, session: { ...st.session, status: "completed", completedAt: now }, blueprint: { ...st.blueprint, stopped: reason } };
  }
  return st;
}

// ── THE REPORT ──

/** The formative report of one exam, from its stored rows. */
export async function adaptiveReport(admin: any, userId: string, st: AdaptiveState): Promise<AdaptiveReport> {
  const rows = st.questionIds.map(id => st.questions.get(id)!).filter(Boolean);
  const [accepted, topics, learner] = await Promise.all([
    acceptedQuestionCompetencies(admin, userId, rows.map(q => q.id)), topicsOfSections(admin, userId, [...new Set(rows.map(q => q.chunkId))]), loadLearnerCatalogue(admin, userId),
  ]);
  const compOf = new Map((accepted.ok ? accepted.value ?? [] : []).map(x => [x.questionId, x.competencyId]));
  const names = compOf.size ? await competencyLabels(admin, learner.competencies, [...new Set(compOf.values())], new Map()) : new Map();
  const outcomes = stateOutcomes(st);
  const items: ReportItem[] = rows.map(q => {
    const rubric = rubricOf(q.answer);
    return {
      questionId: q.id, kind: q.kind, stem: q.stem, difficulty: q.difficulty, cognitive: cognitiveOf(rubric?.level ?? null, q.difficulty),
      chunkId: q.chunkId, materialId: q.materialId, materialTitle: q.materialTitle, topic: topics.get(q.chunkId)?.[0] ?? null, competencyId: compOf.get(q.id) ?? null,
      // D4: counted from the source recorded when each item was served, not from the session's start.
      ...(src => ({ library: src === "library", generated: src === "generated" }))(itemSource(st.provenance.get(q.id), { library: !!q.library, createdAt: q.createdAt }, st.setUpAt)),
      ...outcomes[st.questionIds.indexOf(q.id)] ?? { outcome: "unanswered" as const },
      keyPoints: rubric?.keyPoints ?? [], misconceptions: rubric?.misconceptions ?? [],
    };
  });
  return buildAdaptiveReport({
    items, length: st.blueprint.length, start: st.blueprint.start, startFrom: st.blueprint.startFrom,
    competencyNames: new Map([...names].map(([id, l]) => [id, l.title])), fallback: st.fallback, stop: st.blueprint.stopped ?? (st.session.status === "completed" ? "ended" : null),
  });
}
