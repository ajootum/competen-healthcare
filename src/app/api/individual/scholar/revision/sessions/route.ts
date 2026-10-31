// Allow up to 300s: filling a shortfall may write a few small sets of questions, one passage at a time.
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { answerOutcome, recordScholarOutcome, type Withheld } from "@/lib/individual/scholar/outcome";
import { outcomeOf } from "@/lib/ai/outcomes";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { leadingCompetency } from "@/lib/competency/mapping";
import {
  addDeckCards, chunkMappings, createRevisionSession, flashcardDecks, touchFlashcardDeck, getPassage, getRevisionSet, insertLibraryCopies, insertQuestions, insertRevisionQuestions, isUuid, listMaterials, listRevisionSessions,
  revisionPool, sectionLinks, sqieSchema, topicsOfSections, touchRevisionSet, type QuestionRow,
} from "@/lib/individual/scholar/store";
import { loadLibraryQuestions, pickLibraryQuestions, type LibrarySection } from "@/lib/individual/scholar/library-questions";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { parseScope, resolveScope } from "@/lib/individual/scholar/learn";
import { SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, refusalWords, scholarAiRunner, scholarRisk } from "@/lib/individual/scholar/http";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { formatPromptVersion, runQuestions, runRevisionQuestions } from "@/lib/individual/scholar/generation";
import { linkStudy } from "@/lib/individual/scholar/study-context";
import { GENERATING_MODES, effectiveKind, existingObjectives, keyOf, pickQuestions, planGeneration, type PoolItem } from "@/lib/individual/scholar/revision";
import { missOf, recentMisses, signalsOf } from "@/lib/individual/scholar/misconception";
import { writeClozeItems } from "@/lib/individual/scholar/cloze-service";
import { isClozeQuestion } from "@/lib/individual/scholar/cloze";
import { revisionItemView } from "@/lib/individual/scholar/revision-view";
import { cardsOfDecks, gapFocus, libraryRecallFits, recallCardOf } from "@/lib/individual/scholar/flashcards";
import { loadFlashcardGaps, loadFlashcards } from "@/lib/individual/scholar/flashcard-service";
import { generationContextLoader } from "@/lib/individual/scholar/question-context";
import { adaptDifficulty, flashcardLevelMix, generationDifficulty, isSourceMode, stemKey, type SourceMode } from "@/lib/individual/scholar/question-intel";
import {
  MOCK_LABEL, REVISION_DIFFICULTIES, REVISION_GENERATION_CALLS_MAX, REVISION_FORMATS, REVISION_MODES, REVISION_QUANTITY_MAX,
  type RevisionDifficulty, type RevisionFormat, type RevisionMode,
} from "@/lib/individual/scholar/config";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/revision/sessions -- COMPETEN-SCHOLAR-REVISION-01 R1, R2 and R4.
//
// POST { mode, scope?, formats?, quantity?, difficulty?, feedback?, setId?, source? } starts a revision session.
//   source  "notes" (default) or "notes_and_references" (SCHOLAR-SQIE-01: approved governed references too)
//   scope   a section, a document, chosen documents, a topic, a competency (Stage 3's own scope), or none: the library
//   setId   replay a saved set: its stored questions, no AI at all (s8)
// REUSE FIRST. The session is filled from the student's saved questions (pickQuestions, deterministic). Only a
// shortfall, in a mode that may write (today, quick, mock, flashcards), and only where policy allows, is written new
// -- one passage and format at a time, never a section and format that already has questions at this prompt version,
// at most REVISION_GENERATION_CALLS_MAX calls, each through the Holdings allowance (activity questions) with its risk.
// When new AI is not available the session is made from what is saved, and says so (s8 Learning Continuity).
// The browser receives learner views only: no key, no rationale, no source quote (revision-view.ts).
// SCHOLAR-SQIE-CLOSE-01 (migration 710):
//   LIBRARY FIRST, THEN WRITTEN. Before anything is written for a shortfall, multiple-choice places are filled from the
//   governed Competen library (442): published, clinically approved revision questions teaching a competency the
//   section is linked to (accepted links only) and naming its topic (library-questions.ts). No AI. Each is the
//   learner's own copy, with its provenance, labelled "From the Competen library (clinically reviewed)".
//   STRUCTURED (multi-part) is offered where policy allows it AND 710 is applied, in sessions with feedback after each
//   answer (a multi-part answer cannot yet be held to the end, so mock and end-of-session sessions leave it out).
//   Without 710 neither happens: the session is made exactly as before.
// SCHOLAR-FLASHCARDS-01 (mode flashcards, policy scholar_flashcards):
//   deck / decks / cardIds  study a deck (a 730 deck id or a deck key), several decks, or chosen cards: stored cards
//                   only, no AI, due first, at most fifty in one session.
//                   only "due" (due and new) or "practice" (not remembered last time) narrows it.
//   scope gaps      cards for the learner's own learning gaps: the sections of what they missed, new cards focused on
//                   the key points and misconceptions missed (generation CONCEPTS), stored and library cards first.
//   deckId          generate INTO a deck: the session takes cards not yet in it (stored and library first, then new,
//                   at most scholar_flashcards_per_generation written), and they are added to the deck (by reference).
//   generate false  use stored and library cards only.
//   New cards are written to the level mix of policy scholar_flashcard_level_mix (SCHOLAR-FLASHCARDS-QA-01), only at the
//   levels the passage supports; the audit row records the mix, the fallbacks and why.
//   A governed library question whose stem stands alone is studied as a card (flashcards.ts recallCardOf), library first.
// GET lists the student's recent revision sessions to resume.

const pickFormats = (v: unknown, allowed: readonly RevisionFormat[]): RevisionFormat[] => {
  const asked = Array.isArray(v) ? v.filter((f): f is RevisionFormat => (REVISION_FORMATS as readonly string[]).includes(f as string)) : [];
  const out = (asked.length ? asked : allowed).filter(f => allowed.includes(f));
  return [...new Set(out)];
};

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const policy = await loadIndividualPolicy(ctx.admin);

  const mode = body?.mode as RevisionMode;
  if (!(REVISION_MODES as readonly string[]).includes(mode)) return NextResponse.json({ error: "Unknown way of revising." }, { status: 400 });
  if (!policy.scholarRevisionModes.includes(mode)) return NextResponse.json({ error: "That way of revising is not offered here." }, { status: 403 });
  const feedback: "immediate" | "end" = mode === "mock" ? "end" : body?.feedback === "end" || body?.feedback === "immediate" ? body.feedback : policy.scholarRevisionFeedback;

  // ── SCHOLAR-FLASHCARDS-01: offered by policy, and a deck or chosen cards are studied as they are, with no AI ──
  if (mode === "flashcards" && policy.scholarFlashcards !== "on") return NextResponse.json({ error: "Flashcards are not offered here." }, { status: 403 });
  if (mode === "flashcards" && (typeof body?.deck === "string" || Array.isArray(body?.decks) || Array.isArray(body?.cardIds))) {
    const lib = await loadFlashcards(ctx);
    if (!lib.ok) return NextResponse.json({ error: "Your cards could not be read just now." }, { status: 503 });
    const have = new Map(lib.data.cards.map(c => [c.id, c]));
    let ids = typeof body.deck === "string" ? cardsOfDecks(lib.data.decks, [body.deck])
      : Array.isArray(body.decks) ? cardsOfDecks(lib.data.decks, (body.decks as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 20))
        : (body.cardIds as unknown[]).filter((x): x is string => typeof x === "string");
    ids = ids.filter(id => have.has(id));
    if (body?.only === "due") ids = ids.filter(id => ["due", "new"].includes(have.get(id)!.review.state));
    else if (body?.only === "practice") ids = ids.filter(id => have.get(id)!.review.state === "needs_practice");
    if (!ids.length) return NextResponse.json({ error: body?.only === "due" ? "Nothing here is due for review today." : body?.only === "practice" ? "Nothing here needs more practice right now." : "There are no cards here yet." }, { status: 404 });
    const items: PoolItem[] = ids.map(id => { const c = have.get(id)!; return { id, kind: "flashcard", difficulty: c.difficulty, chunkId: c.chunkId, createdAt: c.createdAt, latestCorrect: null, misses: 0, lastAnsweredAt: c.review.lastReviewedAt, due: c.review.state === "due" }; });
    const picked = pickQuestions({ mode, pool: items, quantity: REVISION_QUANTITY_MAX, formats: ["flashcard"], difficulty: "any", seed: `${ctx.userId}:${mode}` });
    const made = await createRevisionSession(ctx.admin, ctx.userId, { mode, feedback: "immediate", questionIds: picked.ids });
    if (!made.ok) return NextResponse.json({ error: made.notProvisioned ? "Study sessions are not kept on this environment yet." : "Your study session could not be started just now." }, { status: made.notProvisioned ? 409 : 500 });
    const deck = typeof body.deck === "string" ? lib.data.decks.find(d => d.key === body.deck || d.id === body.deck) ?? null : null;
    if (deck?.id) await touchFlashcardDeck(ctx.admin, ctx.userId, deck.id);
    // SCHOLAR-SESSION-AI-02: started inside a study session, it is linked to it (never failing the session).
    await linkStudy(ctx.admin, ctx.userId, body?.studySessionId, "revision_session", made.id, policy);
    await audit(ctx, "individual_scholar_revision_started", "individual_scholar_revision_session", made.id, { mode, deck: deck?.kind ?? "cards", only: body?.only ?? null, questions: picked.ids.length, generated: 0 });
    return NextResponse.json({ session: { id: made.id, mode, feedback: "immediate", total: picked.ids.length, position: 0 }, generated: 0, reused: picked.ids.length, of: ids.length });
  }

  // ── a saved set: its own questions, replayed with no AI ──
  if (mode === "custom") {
    const set = isUuid(body?.setId) ? await getRevisionSet(ctx.admin, ctx.userId, body.setId) : null;
    if (!set) return NextResponse.json({ error: "That revision set could not be found." }, { status: 404 });
    const pool = await revisionPool(ctx.admin, ctx.userId, { kinds: [...REVISION_FORMATS, "case"] });
    if (!pool.ok) return NextResponse.json({ error: "Your saved questions could not be read just now." }, { status: 503 });
    const have = new Map(pool.data.questions.map(q => [q.id, q]));
    const ordered = set.questionIds.map(id => have.get(id)).filter((q): q is QuestionRow => !!q && !!keyOf(q) && (q.kind !== "structured" || set.feedback === "immediate"));
    if (!ordered.length) return NextResponse.json({ error: "The questions in this set are no longer stored (their materials were removed)." }, { status: 404 });
    const made = await createRevisionSession(ctx.admin, ctx.userId, { mode, feedback: set.feedback, setId: set.id, questionIds: ordered.map(q => q.id) });
    await touchRevisionSet(ctx.admin, ctx.userId, set.id);
    if (made.ok) await linkStudy(ctx.admin, ctx.userId, body?.studySessionId, "revision_session", made.id, policy);
    await audit(ctx, "individual_scholar_revision_started", "individual_scholar_revision_session", made.ok ? made.id : null, { mode, set: true, questions: ordered.length, generated: 0 });
    return NextResponse.json({
      session: made.ok ? { id: made.id, mode, feedback: set.feedback, total: ordered.length, position: 0 } : null,
      items: ordered.map(revisionItemView), generated: 0, reused: ordered.length,
      note: made.ok ? null : "Revision sessions are not kept on this environment, so this one cannot be resumed later.",
    });
  }

  // ── the scope: Stage 3's, or the whole library ──
  let chunkIds: string[] | null = null;
  let scopeSections: string[] = [];
  // SCHOLAR-FLASHCARDS-01: the learner's own learning gaps, as cards: where they missed, and what to focus on.
  let gapConcepts: Map<string, string[]> | null = null;
  if (body?.scope?.kind === "gaps") {
    if (mode !== "flashcards") return NextResponse.json({ error: "Learning gaps are revised as flashcards." }, { status: 400 });
    const focus = gapFocus(await loadFlashcardGaps(ctx));
    if (!focus.chunkIds.length) return NextResponse.json({ error: "No learning gaps yet: questions you get wrong, and cards you do not remember, show up here." }, { status: 404 });
    chunkIds = focus.chunkIds; scopeSections = focus.chunkIds; gapConcepts = focus.concepts;
  } else if (body?.scope && typeof body.scope === "object" && body.scope.kind !== "library") {
    const scope = parseScope(body);
    if (typeof scope === "string") return NextResponse.json({ error: scope }, { status: 400 });
    if (scope.kind === "topic" && findPatientIdentifiers(scope.topic).length)
      return NextResponse.json({ error: "That topic looks like it identifies a patient. Name the topic only." }, { status: 422 });
    const learner = scope.kind === "competency" ? await loadLearnerCatalogue(ctx.admin, ctx.userId) : null;
    const resolved = await resolveScope(ctx.admin, ctx.userId, scope, { competencyTitle: learner?.competencies?.find(c => c.id === (scope as { competencyId?: string }).competencyId)?.title ?? null });
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    chunkIds = resolved.sections.map(s => s.chunkId);
    scopeSections = chunkIds;
  } else {
    // The library: new questions, if any are needed, come from the most recent materials.
    const mats = await listMaterials(ctx.admin, ctx.userId);
    const recent = mats.ok ? mats.data.filter(m => m.chunkCount > 0).slice(0, 3).map(m => m.id) : [];
    if (recent.length) {
      const r = await resolveScope(ctx.admin, ctx.userId, recent.length === 1 ? { kind: "document", materialId: recent[0] } : { kind: "documents", materialIds: recent });
      if (r.ok) scopeSections = r.sections.map(s => s.chunkId);
    }
  }

  // SCHOLAR-SQIE-CLOSE-01: structured only where 710 stores it, and only with feedback after each answer.
  const sqie = await sqieSchema(ctx.admin, ctx.userId);
  const formats = pickFormats(body?.formats, policy.scholarRevisionFormats).filter(f => f !== "structured" || (sqie && feedback === "immediate"));
  if (!formats.length) return NextResponse.json({ error: "None of those question formats is offered here." }, { status: 400 });
  const quantity = Number.isInteger(body?.quantity) ? Math.min(REVISION_QUANTITY_MAX, Math.max(1, body.quantity)) : policy.scholarRevisionQuantity;
  const asked: RevisionDifficulty | null = (REVISION_DIFFICULTIES as readonly string[]).includes(body?.difficulty) ? body.difficulty : null;
  let difficulty: RevisionDifficulty = asked ?? (mode === "flashcards" ? policy.scholarFlashcardDifficulty : policy.scholarRevisionDifficulty);
  // SCHOLAR-SQIE-01: where questions come from -- the notes (default), or the notes with approved references.
  const sourceMode: SourceMode = isSourceMode(body?.source) && (mode !== "flashcards" || policy.scholarFlashcardSourceModes.includes(body.source)) ? body.source : "notes";
  const loader = await generationContextLoader(ctx.admin, ctx.userId, policy);
  const kinds = mode === "flashcards" ? (["flashcard"] as RevisionFormat[]) : formats;
  const seed = `${ctx.userId}:${new Date().toISOString().slice(0, 10)}:${mode}`;

  // SCHOLAR-FLASHCARDS-01: generating INTO a deck takes cards not yet in it, and adds them to it (by reference).
  const targetDeck = mode === "flashcards" && isUuid(body?.deckId) ? (await flashcardDecks(ctx.admin, ctx.userId)).find(d => d.id === body.deckId) ?? null : null;
  if (isUuid(body?.deckId) && !targetDeck) return NextResponse.json({ error: "That deck could not be found." }, { status: 404 });
  const inDeck = new Set(targetDeck?.cardIds ?? []);
  // At most this many new cards are written for one flashcards request (policy). Other modes: the call cap only.
  const genCap = mode === "flashcards" ? policy.scholarFlashcardsPerGeneration : Number.POSITIVE_INFINITY;
  // Library copies this session reuses: read with the pool wherever they were first filed.
  let libraryIds: string[] = [];
  const poolOf = async () => {
    // Flashcards: cards, and governed library questions that stand alone as a recall prompt (recallCardOf).
    const p = await revisionPool(ctx.admin, ctx.userId, { chunkIds, kinds: mode === "flashcards" ? ["flashcard", "mcq"] : kinds, extraIds: libraryIds });
    if (!p.ok) return null;
    const qs = mode === "flashcards" ? p.data.questions.map(recallCardOf).filter((q): q is QuestionRow => !!q) : p.data.questions;
    const items: PoolItem[] = qs.filter(q => !!keyOf(q) && !inDeck.has(q.id)).map(q => {
      const s = p.data.stats.get(q.id)!;
      // SCHOLAR-SQIE-LEARNER-01: what its rubric lists as misconceptions and its topic, for the preference in Weak areas.
      return { id: q.id, kind: effectiveKind(q), difficulty: q.difficulty, chunkId: q.chunkId, createdAt: q.createdAt, latestCorrect: s.latestCorrect, misses: s.misses, lastAnsweredAt: s.lastAnsweredAt, due: s.due, ...signalsOf(q) };
    });
    // The learner's misses in the last 30 days, with what each missed item's rubric lists (misconception.ts).
    return { questions: qs, items, misses: recentMisses(qs.flatMap(q => missOf(q, p.data.stats.get(q.id)?.lastMissAt)), new Date().toISOString()) };
  };
  let pool = await poolOf();
  if (!pool) return NextResponse.json({ error: "Your saved questions could not be read just now." }, { status: 503 });
  // SCHOLAR-SQIE-01: with no difficulty chosen, the default is the programme level's (else the policy's), stepped up
  // after three right answers and down after two misses in the last three (question-intel.ts adaptDifficulty). A
  // default only: a chosen difficulty is always used as chosen, and nothing is withheld by it.
  if (!asked && (mode !== "flashcards" || policy.scholarFlashcardDifficulty === "any")) {
    const base = loader.levelDefault ?? generationDifficulty(policy.scholarRevisionDifficulty);
    const recent = pool.items.filter(p => p.lastAnsweredAt && p.latestCorrect !== null)
      .sort((a, b) => (b.lastAnsweredAt ?? "").localeCompare(a.lastAnsweredAt ?? "")).map(p => p.latestCorrect as boolean);
    if (base) difficulty = adaptDifficulty(base, recent);
  }
  let pick = pickQuestions({ mode, pool: pool.items, quantity, formats: kinds, difficulty, seed, recentMisses: pool.misses });

  // ── SCHOLAR-COMPANION-01 P1: cloze items, written by a rule from the learner's own notes (cloze.ts). No AI, no allowance. ──
  // Only when cloze was asked for by name: a default session never gains new cloze items it was not asked for.
  let clozeWritten = 0;
  if (GENERATING_MODES.includes(mode) && kinds.includes("cloze") && scopeSections.length && Array.isArray(body?.formats) && body.formats.includes("cloze")) {
    const have = pool.questions.filter(isClozeQuestion).length;
    const need = Math.min(20, Math.max(0, Math.ceil(quantity / kinds.length) - have));
    if (need > 0) {
      const w = await writeClozeItems(ctx.admin, ctx.userId, { chunkIds: scopeSections, questions: pool.questions, need });
      clozeWritten = w.written;
      if (w.written) {
        pool = (await poolOf()) ?? pool;
        pick = pickQuestions({ mode, pool: pool.items, quantity, formats: kinds, difficulty, seed, recentMisses: pool.misses });
      }
      await audit(ctx, "individual_scholar_revision_cloze", "individual_scholar_revision_session", null, { asked: need, written: w.written, sections: Math.min(scopeSections.length, 30), rule: "cloze:v1" });
    }
  }

  // ── SCHOLAR-SQIE-CLOSE-01 C: the shortfall's multiple-choice places from the governed library first, with no AI ──
  let libraryVersions: string[] = [];
  if (pick.shortfall > 0 && GENERATING_MODES.includes(mode) && (kinds.includes("mcq") || mode === "flashcards") && scopeSections.length && sqie) {
    const sections = scopeSections.slice(0, 40);
    const [links, topics] = await Promise.all([sectionLinks(ctx.admin, ctx.userId, sections), topicsOfSections(ctx.admin, ctx.userId, sections)]);
    const libSections: LibrarySection[] = sections
      .map(c => ({ chunkId: c, competencyIds: [...new Set(links.filter(l => l.chunkId === c && l.accepted).map(l => l.competencyId))], topics: topics.get(c) ?? [] }))
      .filter(x => x.competencyIds.length);
    if (libSections.length) {
      const library = await loadLibraryQuestions(ctx.admin, libSections.flatMap(x => x.competencyIds));
      const held = new Set(pool.questions.map(q => q.library?.versionId).filter((v): v is string => !!v));
      // SCHOLAR-FLASHCARDS-01: as cards, only a library question whose stem stands alone as a recall prompt.
      const picks = pickLibraryQuestions({ questions: mode === "flashcards" ? library.filter(x => libraryRecallFits(x.stem)) : library, sections: libSections, exclude: held, limit: pick.shortfall });
      const copies = await insertLibraryCopies(ctx.admin, ctx.userId, picks);
      if (copies.ids.length) {
        libraryIds = copies.ids; libraryVersions = picks.map(x => x.question.versionId);
        pool = (await poolOf()) ?? pool;
        pick = pickQuestions({ mode, pool: pool.items, quantity, formats: kinds, difficulty, seed, recentMisses: pool.misses });
      }
      await audit(ctx, "individual_scholar_revision_library", "individual_scholar_revision_session", null, {
        offered: library.length, picked: picks.length, copied: copies.copied, reused: copies.ids.length, versions: libraryVersions,
      });
    }
  }

  // ── the shortfall: written new only where the mode, the policy and the student's AI allow ──
  let generated = 0, note: string | null = null, aiCalls = 0, referencesUsed = false;
  const stems = new Set(pool.questions.map(q => stemKey(q.stem)));
  if (pick.shortfall > 0 && GENERATING_MODES.includes(mode) && scopeSections.length && body?.generate !== false) {
    if (policy.scholarRevisionGeneration === "saved_only") note = "New questions are not written here: this session uses your saved questions only.";
    else {
      const standing = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "questions");
      const pre = standing.available ? await aiPreflight(ctx) : null;
      if (!standing.available) note = `${standing.message ?? "New AI help is not available right now."} This session uses your saved questions.`;
      else if (pre) note = ((await pre.clone().json().catch(() => ({}))) as { error?: string }).error ?? "New questions could not be written just now. This session uses your saved questions.";
      else {
        // Identical content is not written twice: a section and format that already has questions at this prompt version is skipped.
        // SCHOLAR-SQIE-LEARNER-01: by the format a question is offered as (cloze, true/false and extended are stored as `short`).
        const existing = new Set(pool.questions.filter(q => q.promptVersion.startsWith(formatPromptVersion(effectiveKind(q)))).map(q => `${q.chunkId}|${effectiveKind(q)}`));
        // Rounds: an item the checks drop leaves the session short, so a second round writes for what is still
        // missing -- never a section and format already written, and never more than REVISION_GENERATION_CALLS_MAX calls.
        let i = 0, refused = false;
        for (let round = 0; round < 2 && pick.shortfall > 0 && generated < genCap && i < REVISION_GENERATION_CALLS_MAX && !refused; round++) {
                    const plan = planGeneration({ shortfall: Math.min(pick.shortfall, genCap - generated), chunkIds: scopeSections, formats: kinds, existing });
          let made = 0;
          for (const call of plan.slice(0, REVISION_GENERATION_CALLS_MAX - i)) {
            existing.add(`${call.chunkId}|${call.kind}`);
            i++;
            const passage = await getPassage(ctx.admin, ctx.userId, call.chunkId);
            if (!passage) continue;
            const ai = scholarAiRunner(ctx, req, "questions", await scholarRisk(ctx.admin, ctx.userId, { passages: [passage] }), `g${i}`);
            const competencyId = leadingCompetency(await chunkMappings(ctx.admin, ctx.userId, passage.chunkId));
            // SCHOLAR-QUESTION-INTELLIGENCE-01: the section's guidance, the difficulty, and (revision kinds only: an mcq
            // cannot record a reference) the approved references of mode notes_and_references.
            const sectionContext = await loader.forSection(passage.chunkId, { difficulty: generationDifficulty(difficulty), mode: call.kind === "mcq" ? "notes" : sourceMode });
            // SCHOLAR-FLASHCARDS-01: cards for a learning gap test what was missed (still only what the passage holds).
            const focus = gapConcepts?.get(passage.chunkId) ?? [];
            const context = focus.length ? { ...sectionContext, concepts: [...focus, ...sectionContext.concepts] } : sectionContext;
            if (context.mode === "notes_and_references") referencesUsed = true;
            let ids: string[] = [], outcome = "", calls = 0;
            let mixPlan: { levels: Record<string, number>; fallback: string[]; relabelled: number } | null = null;
            let measured: { accepted: number; rejected: number; reasons: string[]; promptVersion: string | null } | null = null;
            if (call.kind === "mcq") {
              // Each call asks for up to three: the checks drop some, and what is kept beyond this session is saved
              // for the next one (reuse first), never written again.
              const r = await runQuestions(ctx.userId, "mcq", passage, Math.max(call.count, 3), ai.run, { context, existing: stems, verifyFormats: policy.scholarVerifyFormats, existingObjectives: existingObjectives(pool.questions, call.chunkId, "mcq") });
              if (r.ok) {
                calls = r.calls; r.check.kept.forEach(d => stems.add(stemKey(d.stem)));
                const s = await insertQuestions(ctx.admin, ctx.userId, { passage, kind: "mcq", drafts: r.check.kept, model: r.model, provider: r.provider, promptVersion: r.promptVersion, competencyId }); ids = s.ids;
                // SQIE D-6: the reasons multiple-choice items were dropped, counted (never their text), as for the revision kinds.
                const reasons = r.check.dropped.map(d => d.reason), why = [...new Set(reasons)].map(x => `${x}:${reasons.filter(y => y === x).length}`).join("/");
                outcome = `kept:${ids.length},dropped:${reasons.length}${why ? `(${why})` : ""}`; measured = { accepted: ids.length, rejected: r.check.dropped.length, reasons: r.check.dropped.map(d => d.reason), promptVersion: r.promptVersion };
              }
              else outcome = `error:${r.error}`;
            } else {
              // SCHOLAR-FLASHCARDS-QA-01: flashcards to the policy's level mix (by programme level by default).
              const levelMix = call.kind === "flashcard" ? flashcardLevelMix(policy.scholarFlashcardLevelMix, loader.levelDefault) : undefined;
              const r = await runRevisionQuestions(ctx.userId, call.kind, passage, mode === "flashcards" ? call.count : Math.max(call.count, 3), ai.run, { context, existing: stems, levelMix, verifyFormats: policy.scholarVerifyFormats, existingObjectives: existingObjectives(pool.questions, call.chunkId, call.kind) });
              if (r.ok && r.levelPlan) mixPlan = r.levelPlan;
              if (r.ok) {
                calls = r.calls; r.kept.forEach(d => stems.add(stemKey(d.stem)));
                const s = await insertRevisionQuestions(ctx.admin, ctx.userId, { passage, kind: call.kind, drafts: r.kept, model: r.model, provider: r.provider, promptVersion: r.promptVersion, competencyId });
                // The reasons items were dropped, counted (never their text): what the checks are refusing.
                const why = [...new Set(r.dropped)].map(x => `${x}:${r.dropped.filter(y => y === x).length}`).join("/");
                ids = s.ok ? s.ids : []; measured = { accepted: ids.length, rejected: r.dropped.length, reasons: [...r.dropped, ...(s.ok ? [] : ["save_failed"])], promptVersion: r.promptVersion };
                outcome = s.ok ? `kept:${ids.length},dropped:${r.dropped.length}${why ? `(${why})` : ""}` : s.notProvisioned ? "not_provisioned" : "save_failed";
              } else outcome = `error:${r.error}`;
            }
            const refusal = ai.refusal();
            if (refusal) { note = `${refusalWords(refusal).message} This session uses your saved questions.`; refused = true; break; }
            // SCHOLAR-AI-OPT-01: one outcome per generation call, codes and counts only.
            await recordScholarOutcome(ctx.admin, ai, {
              operation: call.kind === "mcq" ? "individual_scholar_mcq" : `individual_scholar_revision_${call.kind}`, outputKind: "question",
              ...(measured
                ? { outcome: outcomeOf(measured.accepted, measured.rejected), ...measured, reasons: [...measured.reasons, ...answerOutcome(measured.accepted ? null : "insufficient_grounding").reasons].slice(-20) }
                : { outcome: "error" as const, reasons: [outcome.replace(/:/g, "_")] }),
            });
            await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_revision_generate", null, {
              chunk_id: passage.chunkId, kind: call.kind, asked: call.count, outcome, competency_id: competencyId,
              ai_calls: calls, difficulty: context.difficulty, source: context.mode, references: context.references.length,
              // The level mix asked for, the levels the passage could not support (why), and cards relabelled: codes and counts.
              ...(mixPlan ? { level_mix: mixPlan.levels, level_fallback: mixPlan.fallback, level_relabelled: mixPlan.relabelled } : {}),
            });
            aiCalls += calls;
            made += ids.length;
          }
          generated += made;
          if (!made) break;
          pool = (await poolOf()) ?? pool;
          pick = pickQuestions({ mode, pool: pool.items, quantity, formats: kinds, difficulty, seed, recentMisses: pool.misses });
        }
      }
    }
  }

  // SCHOLAR-SQIE-02: new questions were asked for and none survived the checks -- typed, so a way on can be offered.
  const withheld: Withheld | null = aiCalls > 0 && generated === 0 && pick.shortfall > 0 ? { reason: "insufficient_grounding" } : null;
  if (!pick.ids.length) {
    // Continuity with nothing stored: there is no session to "use your saved questions", so say what is true instead.
    const nothingSaved = note ? `${note.replace(/ This session uses your saved questions( only)?\.$/, "").replace(/: this session uses your saved questions only\.$/, ".")} You have no saved questions for this yet, so there is nothing to revise here until new ones can be written. Your cards, saved sets and history are unaffected.` : null;
    return NextResponse.json({
      error: mode === "spaced" ? "Nothing is due for review today." : mode === "weak" ? "Nothing to revise here yet: questions you get wrong show up in Weak areas." : nothingSaved ?? "There are no questions for this yet.",
      continuity: !!nothingSaved, ...(withheld ? { withheld } : {}),
    }, { status: 404 });
  }
  const byId = new Map(pool.questions.map(q => [q.id, q]));
  const ordered = pick.ids.map(id => byId.get(id)!).filter(Boolean);
  const made = await createRevisionSession(ctx.admin, ctx.userId, { mode, feedback, questionIds: ordered.map(q => q.id) });
  if (made.ok) await linkStudy(ctx.admin, ctx.userId, body?.studySessionId, "revision_session", made.id, policy);
  // SCHOLAR-FLASHCARDS-01: the cards go into the deck asked for, by reference, up to the deck size limit.
  let deckNote: string | null = null;
  if (targetDeck) {
    const room = Math.max(0, policy.scholarFlashcardDeckMax - targetDeck.cardIds.length);
    const add = ordered.map(q => q.id).slice(0, room);
    if (add.length) await addDeckCards(ctx.admin, ctx.userId, targetDeck.id, add);
    await touchFlashcardDeck(ctx.admin, ctx.userId, targetDeck.id);
    if (add.length < ordered.length) deckNote = `The deck holds at most ${policy.scholarFlashcardDeckMax} cards, so ${ordered.length - add.length} of these were not added to it.`;
  }
  // SCHOLAR-SQIE-CLOSE-01: how the session was filled -- saved questions reused, governed library questions reused, new ones written.
  const fromLibrary = ordered.filter(q => q.library && libraryIds.includes(q.id)).length;
  const reused = Math.max(0, ordered.length - Math.min(generated, ordered.length) - fromLibrary);
  await audit(ctx, "individual_scholar_revision_started", "individual_scholar_revision_session", made.ok ? made.id : null,
    { mode, scope: chunkIds ? "scoped" : "library", questions: ordered.length, generated, cloze_written: clozeWritten, reused, library: fromLibrary, library_versions: libraryVersions, formats: kinds, ai_calls: aiCalls, difficulty, adapted: !asked, source: sourceMode, references_used: referencesUsed });
  // Mode notes_and_references with no approved reference linked to these notes: said, never implied.
  const sourceNote = sourceMode === "notes_and_references" && generated > 0 && !referencesUsed
    ? "No clinically approved reference is linked to these notes yet, so the new questions are from your notes only." : null;
  return NextResponse.json({
    session: made.ok ? { id: made.id, mode, feedback, total: ordered.length, position: 0 } : null,
    items: ordered.map(revisionItemView), generated, reused, library: fromLibrary,
    label: mode === "mock" ? MOCK_LABEL : null, difficulty, source: sourceMode, aiCalls, ...(withheld ? { withheld } : {}),
    note: [note ?? (made.ok ? null : "Revision sessions are not kept on this environment, so this one cannot be resumed later."), sourceNote, deckNote].filter(Boolean).join(" ") || null,
  });
}

export async function GET() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const r = await listRevisionSessions(ctx.admin, ctx.userId, 20);
  if (!r.ok) return NextResponse.json({ sessions: [], history: r.notProvisioned ? "not_provisioned" : "unreadable" });
  return NextResponse.json({ sessions: r.data, history: "on" });
}
