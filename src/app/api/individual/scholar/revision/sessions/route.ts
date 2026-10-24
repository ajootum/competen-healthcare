// Allow up to 300s: filling a shortfall may write a few small sets of questions, one passage at a time.
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { leadingCompetency } from "@/lib/competency/mapping";
import {
  chunkMappings, createRevisionSession, getPassage, getRevisionSet, insertQuestions, insertRevisionQuestions, isUuid, listMaterials, listRevisionSessions,
  revisionPool, touchRevisionSet, type QuestionRow,
} from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { parseScope, resolveScope } from "@/lib/individual/scholar/learn";
import { SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, refusalWords, scholarAiRunner, scholarRisk } from "@/lib/individual/scholar/http";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { runQuestions, runRevisionQuestions } from "@/lib/individual/scholar/generation";
import { GENERATING_MODES, keyOf, pickQuestions, planGeneration, type PoolItem } from "@/lib/individual/scholar/revision";
import { revisionItemView } from "@/lib/individual/scholar/revision-view";
import {
  MOCK_LABEL, PROMPT_VERSIONS, REVISION_DIFFICULTIES, REVISION_GENERATION_CALLS_MAX, REVISION_FORMATS, REVISION_MODES, REVISION_QUANTITY_MAX,
  type RevisionDifficulty, type RevisionFormat, type RevisionMode,
} from "@/lib/individual/scholar/config";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/revision/sessions -- COMPETEN-SCHOLAR-REVISION-01 R1, R2 and R4.
//
// POST { mode, scope?, formats?, quantity?, difficulty?, feedback?, setId? } starts a revision session.
//   scope   a section, a document, chosen documents, a topic, a competency (Stage 3's own scope), or none: the library
//   setId   replay a saved set: its stored questions, no AI at all (s8)
// REUSE FIRST. The session is filled from the student's saved questions (pickQuestions, deterministic). Only a
// shortfall, in a mode that may write (today, quick, mock, flashcards), and only where policy allows, is written new
// -- one passage and format at a time, never a section and format that already has questions at this prompt version,
// at most REVISION_GENERATION_CALLS_MAX calls, each through the Holdings allowance (activity questions) with its risk.
// When new AI is not available the session is made from what is saved, and says so (s8 Learning Continuity).
// The browser receives learner views only: no key, no rationale, no source quote (revision-view.ts).
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

  // ── a saved set: its own questions, replayed with no AI ──
  if (mode === "custom") {
    const set = isUuid(body?.setId) ? await getRevisionSet(ctx.admin, ctx.userId, body.setId) : null;
    if (!set) return NextResponse.json({ error: "That revision set could not be found." }, { status: 404 });
    const pool = await revisionPool(ctx.admin, ctx.userId, { kinds: [...REVISION_FORMATS, "case"] });
    if (!pool.ok) return NextResponse.json({ error: "Your saved questions could not be read just now." }, { status: 503 });
    const have = new Map(pool.data.questions.map(q => [q.id, q]));
    const ordered = set.questionIds.map(id => have.get(id)).filter((q): q is QuestionRow => !!q && !!keyOf(q));
    if (!ordered.length) return NextResponse.json({ error: "The questions in this set are no longer stored (their materials were removed)." }, { status: 404 });
    const made = await createRevisionSession(ctx.admin, ctx.userId, { mode, feedback: set.feedback, setId: set.id, questionIds: ordered.map(q => q.id) });
    await touchRevisionSet(ctx.admin, ctx.userId, set.id);
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
  if (body?.scope && typeof body.scope === "object" && body.scope.kind !== "library") {
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

  const formats = pickFormats(body?.formats, policy.scholarRevisionFormats);
  if (!formats.length) return NextResponse.json({ error: "None of those question formats is offered here." }, { status: 400 });
  const quantity = Number.isInteger(body?.quantity) ? Math.min(REVISION_QUANTITY_MAX, Math.max(1, body.quantity)) : policy.scholarRevisionQuantity;
  const difficulty: RevisionDifficulty = (REVISION_DIFFICULTIES as readonly string[]).includes(body?.difficulty) ? body.difficulty : policy.scholarRevisionDifficulty;
  const kinds = mode === "flashcards" ? (["flashcard"] as RevisionFormat[]) : formats;
  const seed = `${ctx.userId}:${new Date().toISOString().slice(0, 10)}:${mode}`;

  const poolOf = async () => {
    const p = await revisionPool(ctx.admin, ctx.userId, { chunkIds, kinds });
    if (!p.ok) return null;
    const items: PoolItem[] = p.data.questions.filter(q => !!keyOf(q)).map(q => {
      const s = p.data.stats.get(q.id)!;
      return { id: q.id, kind: q.kind, difficulty: q.difficulty, chunkId: q.chunkId, createdAt: q.createdAt, latestCorrect: s.latestCorrect, misses: s.misses, lastAnsweredAt: s.lastAnsweredAt, due: s.due };
    });
    return { questions: p.data.questions, items };
  };
  let pool = await poolOf();
  if (!pool) return NextResponse.json({ error: "Your saved questions could not be read just now." }, { status: 503 });
  let pick = pickQuestions({ mode, pool: pool.items, quantity, formats: kinds, difficulty, seed });

  // ── the shortfall: written new only where the mode, the policy and the student's AI allow ──
  let generated = 0, note: string | null = null;
  if (pick.shortfall > 0 && GENERATING_MODES.includes(mode) && scopeSections.length) {
    if (policy.scholarRevisionGeneration === "saved_only") note = "New questions are not written here: this session uses your saved questions only.";
    else {
      const standing = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "questions");
      const pre = standing.available ? await aiPreflight(ctx) : null;
      if (!standing.available) note = `${standing.message ?? "New AI help is not available right now."} This session uses your saved questions.`;
      else if (pre) note = ((await pre.clone().json().catch(() => ({}))) as { error?: string }).error ?? "New questions could not be written just now. This session uses your saved questions.";
      else {
        // Identical content is not written twice: a section and format that already has questions at this prompt version is skipped.
        const version = (k: string) => (k === "mcq" ? PROMPT_VERSIONS.mcq : `${PROMPT_VERSIONS.revision}:${k}`);
        const existing = new Set(pool.questions.filter(q => q.promptVersion.startsWith(version(q.kind))).map(q => `${q.chunkId}|${q.kind}`));
        // Rounds: an item the checks drop leaves the session short, so a second round writes for what is still
        // missing -- never a section and format already written, and never more than REVISION_GENERATION_CALLS_MAX calls.
        let i = 0, refused = false;
        for (let round = 0; round < 2 && pick.shortfall > 0 && i < REVISION_GENERATION_CALLS_MAX && !refused; round++) {
          const plan = planGeneration({ shortfall: pick.shortfall, chunkIds: scopeSections, formats: kinds, existing });
          let made = 0;
          for (const call of plan.slice(0, REVISION_GENERATION_CALLS_MAX - i)) {
            existing.add(`${call.chunkId}|${call.kind}`);
            i++;
            const passage = await getPassage(ctx.admin, ctx.userId, call.chunkId);
            if (!passage) continue;
            const ai = scholarAiRunner(ctx, req, "questions", await scholarRisk(ctx.admin, ctx.userId, { passages: [passage] }), `g${i}`);
            const competencyId = leadingCompetency(await chunkMappings(ctx.admin, ctx.userId, passage.chunkId));
            let ids: string[] = [], outcome = "";
            if (call.kind === "mcq") {
              // Each call asks for up to three: the checks drop some, and what is kept beyond this session is saved
              // for the next one (reuse first), never written again.
              const r = await runQuestions(ctx.userId, "mcq", passage, Math.max(call.count, 3), ai.run);
              if (r.ok) { const s = await insertQuestions(ctx.admin, ctx.userId, { passage, kind: "mcq", drafts: r.check.kept, model: r.model, provider: r.provider, promptVersion: r.promptVersion, competencyId }); ids = s.ids; outcome = `kept:${ids.length}`; }
              else outcome = `error:${r.error}`;
            } else {
              const r = await runRevisionQuestions(ctx.userId, call.kind, passage, Math.max(call.count, 3), ai.run);
              if (r.ok) {
                const s = await insertRevisionQuestions(ctx.admin, ctx.userId, { passage, kind: call.kind, drafts: r.kept, model: r.model, provider: r.provider, promptVersion: r.promptVersion, competencyId });
                // The reasons items were dropped, counted (never their text): what the checks are refusing.
                const why = [...new Set(r.dropped)].map(x => `${x}:${r.dropped.filter(y => y === x).length}`).join("/");
                ids = s.ok ? s.ids : []; outcome = s.ok ? `kept:${ids.length},dropped:${r.dropped.length}${why ? `(${why})` : ""}` : s.notProvisioned ? "not_provisioned" : "save_failed";
              } else outcome = `error:${r.error}`;
            }
            const refusal = ai.refusal();
            if (refusal) { note = `${refusalWords(refusal).message} This session uses your saved questions.`; refused = true; break; }
            await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_revision_generate", null, { chunk_id: passage.chunkId, kind: call.kind, asked: call.count, outcome, competency_id: competencyId });
            made += ids.length;
          }
          generated += made;
          if (!made) break;
          pool = (await poolOf()) ?? pool;
          pick = pickQuestions({ mode, pool: pool.items, quantity, formats: kinds, difficulty, seed });
        }
      }
    }
  }

  if (!pick.ids.length) {
    return NextResponse.json({
      error: mode === "spaced" ? "Nothing is due for review today." : mode === "weak" ? "Nothing to revise here yet: questions you get wrong show up in Weak areas." : note ?? "There are no questions for this yet.",
    }, { status: 404 });
  }
  const byId = new Map(pool.questions.map(q => [q.id, q]));
  const ordered = pick.ids.map(id => byId.get(id)!).filter(Boolean);
  const made = await createRevisionSession(ctx.admin, ctx.userId, { mode, feedback, questionIds: ordered.map(q => q.id) });
  await audit(ctx, "individual_scholar_revision_started", "individual_scholar_revision_session", made.ok ? made.id : null,
    { mode, scope: chunkIds ? "scoped" : "library", questions: ordered.length, generated, formats: kinds });
  return NextResponse.json({
    session: made.ok ? { id: made.id, mode, feedback, total: ordered.length, position: 0 } : null,
    items: ordered.map(revisionItemView), generated, reused: ordered.length - Math.min(generated, ordered.length),
    label: mode === "mock" ? MOCK_LABEL : null,
    note: note ?? (made.ok ? null : "Revision sessions are not kept on this environment, so this one cannot be resumed later."),
  });
}

export async function GET() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const r = await listRevisionSessions(ctx.admin, ctx.userId, 20);
  if (!r.ok) return NextResponse.json({ sessions: [], history: r.notProvisioned ? "not_provisioned" : "unreadable" });
  return NextResponse.json({ sessions: r.data, history: "on" });
}
