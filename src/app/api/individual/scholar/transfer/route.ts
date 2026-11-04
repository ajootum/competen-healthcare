import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { experienceHref } from "@/lib/individual/experiences";
import {
  createRevisionSession, getQuestion, getRevisionSession, insertLibraryCopies, isUuid, listMappings, listMaterials, listTransferChecks, recordTransferCheck,
  revisionPool, sqieSchema, type QuestionRow,
} from "@/lib/individual/scholar/store";
import { readStateInputs, norm } from "@/lib/individual/scholar/learning-state-data";
import { cleanTopic, lessonContext, outsideOf, pickTransfer, transferOffered, type TransferCandidate, type TransferContext, type TransferItem } from "@/lib/individual/scholar/transfer";
import { formatOfLibrary, loadLibraryQuestions, pickLibraryQuestions, type LibrarySection } from "@/lib/individual/scholar/library-questions";
import { generationContextLoader } from "@/lib/individual/scholar/question-context";
import { isScenarioQuestion } from "@/lib/individual/scholar/formats";
import { audit } from "@/lib/individual/scholar/http";
import type { RevisionKind } from "@/lib/individual/scholar/revision";
import type { IndividualPolicy } from "@/lib/individual/policy";
import type { IndividualContext } from "@/lib/individual/guard";

export const dynamic = "force-dynamic";

// /api/individual/scholar/transfer -- SALE-2026-11 R2, row SALE-10 (transfer of learning). Behind scholar_transfer_checks (default OFF)
// and migration 970 (absent: 503, nothing offered).
//
//   POST { action: "offer", topic }
//        For a topic whose answers already show some understanding (transfer.ts rule X1), a short revision session (417) of questions
//        from OUTSIDE the lesson where it was taught, chosen with NO AI: an approved library question on a competency the topic's
//        sections are ACCEPTED-linked to (copied as the revision route does), then the learner's saved questions from other notes or
//        sections, then a saved one never answered and not a lesson check. Recorded (970) with the lesson context and, per question,
//        how it is outside it. Answers: { session, href }. An unanswered transfer check on the same topic from the last week is opened
//        again ({ reopened: true }), so a second click never makes a second session.
//        With none: { generate } -- the body for the EXISTING revision sessions route (harder difficulty, the topic's sections), so a
//        new question is written through the same gate, allowance, eligibility and model routing as any revision question.
//   POST { action: "record", topic, sessionId }
//        After the client started that session: records it as the transfer check (only the questions outside the context, a session
//        of the caller made in the last 15 minutes, once). Answers: { session, href }.
// The answers are ordinary attempts, marked by the ordinary revision route. FORMATIVE: never competence, never a stage.

const RECENT_MS = 15 * 60_000;
/** An unanswered transfer check this recent is opened again rather than a second one made. */
const REOPEN_MS = 7 * 86_400_000;
const SECTION_CAP = 40;
const reviseSession = (id: string) => experienceHref("scholar", `study/revise?session=${id}`);
const answerOf = (q: QuestionRow) => (q.answer && typeof q.answer === "object" ? (q.answer as Record<string, unknown>) : {});
const levelOf = (q: QuestionRow): string | null => { const r = answerOf(q).rubric; return r && typeof r === "object" && typeof (r as Record<string, unknown>).level === "string" ? String((r as Record<string, unknown>).level) : null; };
const isCheck = (q: QuestionRow) => { const c = answerOf(q).check; return !!c && typeof c === "object" && (c as Record<string, unknown>).source === "lesson"; };
const kindsOf = (policy: IndividualPolicy, sqie: boolean): RevisionKind[] =>
  policy.scholarRevisionFormats.filter(f => f !== "flashcard" && (f !== "structured" || sqie)) as RevisionKind[];

type Topic = { key: string; label: string; chunkIds: string[]; materialId: string | null; ctx: TransferContext; competencies: string[]; candidates: string[]; offered: { offered: boolean; reason: string } };

/** The topic as the learning state has it, its lesson context, and the sections a transfer question may come from. */
async function topicOf(ctx: IndividualContext, policy: IndividualPolicy, label: string): Promise<Topic | NextResponse> {
  const [mats, maps] = await Promise.all([listMaterials(ctx.admin, ctx.userId), listMappings(ctx.admin, ctx.userId)]);
  if (!mats.ok || !maps.ok) return NextResponse.json({ error: "Your notes could not be read just now." }, { status: 503 });
  const inputs = await readStateInputs(ctx.admin, ctx.userId, policy, new Date().toISOString(), { materials: mats.data.map(m => ({ id: m.id, title: m.title })), concepts: maps.data.concepts });
  if (!inputs.ok) return NextResponse.json({ error: "Your answers could not be read just now." }, { status: 503 });
  const t = inputs.data.topics.find(x => x.key === norm(label));
  if (!t) return NextResponse.json({ error: "There are no answers on that topic yet." }, { status: 404 });
  const rows = inputs.data.evidence.filter(e => e.topicKey === t.key);
  const lessonCtx = lessonContext(rows, inputs.data.exposure.filter(e => e.topicKey === t.key));
  const accepted = maps.data.mappings.filter(m => m.state === "accepted");
  const competencies = [...new Set(accepted.filter(m => t.chunkIds.includes(m.chunkId)).map(m => m.competencyId))];
  // Sections that may hold a transfer question: the topic's own, and others ACCEPTED-linked to the same competencies.
  const candidates = [...new Set([...t.chunkIds, ...accepted.filter(m => competencies.includes(m.competencyId)).map(m => m.chunkId)])].slice(0, SECTION_CAP);
  return { key: t.key, label: t.label, chunkIds: [...t.chunkIds], materialId: t.materialId, ctx: lessonCtx, competencies, candidates, offered: transferOffered(rows, policy.scholarLearningStateDistinctQuestions) };
}

const candidateOf = (q: QuestionRow, answered: boolean): TransferCandidate => ({
  id: q.id, chunkId: q.chunkId, materialId: q.materialId, level: levelOf(q), difficulty: q.difficulty, check: isCheck(q), library: !!q.library, answered,
});

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const [body, policy] = await Promise.all([req.json().catch(() => ({})), loadIndividualPolicy(ctx.admin)]);
  if (policy.scholarTransferChecks !== "on") return NextResponse.json({ error: "Transfer checks are not offered here." }, { status: 403 });
  const label = cleanTopic(body?.topic);
  if (!label) return NextResponse.json({ error: "Name the topic." }, { status: 400 });
  // 970 must be present before anything is made: absent, nothing is offered (fail closed).
  const probe = await listTransferChecks(ctx.admin, ctx.userId, { limit: 1 });
  if (!probe.ok) return NextResponse.json({ error: probe.notProvisioned ? "Transfer checks are not available yet." : "Your transfer checks could not be read just now." }, { status: 503 });
  const topic = await topicOf(ctx, policy, label);
  if (topic instanceof NextResponse) return topic;
  const n = policy.scholarTransferQuestions;
  const sqie = await sqieSchema(ctx.admin, ctx.userId);
  const kinds = kindsOf(policy, sqie);

  if (body?.action === "record") return record(ctx, topic, body?.sessionId, kinds);
  if (body?.action !== "offer") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  if (!topic.offered.offered) return NextResponse.json({ error: topic.offered.reason }, { status: 409 });

  // ── 0. an unanswered transfer check on this topic from the last week is opened again, never made twice ──
  const mine = await listTransferChecks(ctx.admin, ctx.userId, { sinceIso: new Date(Date.now() - REOPEN_MS).toISOString(), limit: 50 });
  const recent = mine.ok ? [...new Set(mine.data.filter(r => norm(r.topic) === topic.key).map(r => r.sessionId))].slice(0, 3) : [];
  for (const id of recent) {
    const s = await getRevisionSession(ctx.admin, ctx.userId, id);
    if (s.ok && s.data && s.data.session.status === "active" && s.data.attempts.length === 0 && s.data.held.length === 0)
      return NextResponse.json({ session: { id }, href: reviseSession(id), items: mine.ok ? mine.data.filter(r => r.sessionId === id).map(r => ({ outside: r.outside })) : [], reopened: true });
  }

  // ── 1. approved library questions first (no AI): only where the pool holds fewer unanswered library copies than needed ──
  let extra: string[] = [];
  const poolOf = async () => {
    const p = await revisionPool(ctx.admin, ctx.userId, { chunkIds: topic.candidates, kinds, extraIds: extra });
    if (!p.ok) return null;
    return p.data.questions.filter(q => !isScenarioQuestion(q)).map(q => candidateOf(q, !!p.data.stats.get(q.id)?.lastAnsweredAt));
  };
  let pool = await poolOf();
  if (!pool) return NextResponse.json({ error: "Your saved questions could not be read just now." }, { status: 503 });
  let libraryCopied = 0;
  const freshLibrary = pool.filter(c => c.library && !c.answered).length;
  if (sqie && topic.competencies.length && freshLibrary < n) {
    const loader = await generationContextLoader(ctx.admin, ctx.userId, policy);
    const library = (await loadLibraryQuestions(ctx.admin, topic.competencies, loader.learnerFit)).filter(x => (kinds as readonly string[]).includes(formatOfLibrary(x)));
    const sections: LibrarySection[] = topic.candidates.map(c => ({ chunkId: c, competencyIds: topic.competencies, topics: [topic.label] }));
    const held = new Set<string>();
    for (const id of pool.filter(c => c.library).map(c => c.id)) { const q = await getQuestion(ctx.admin, ctx.userId, id); if (q?.library?.versionId) held.add(q.library.versionId); }
    const picks = pickLibraryQuestions({ questions: library, sections, exclude: held, limit: n - freshLibrary });
    const copies = await insertLibraryCopies(ctx.admin, ctx.userId, picks);
    if (copies.ids.length) { extra = copies.ids; libraryCopied = copies.copied; pool = (await poolOf()) ?? pool; }
  }

  // ── 2. pick: library, other notes, other sections, then a saved question never answered and not a lesson check ──
  const items = pickTransfer(pool, topic.ctx, n);
  if (!items.length) {
    const outside = topic.candidates.filter(c => !topic.ctx.contextChunkIds.includes(c));
    return NextResponse.json({
      generate: { mode: "quick", feedback: "immediate", difficulty: "harder", quantity: n, scope: { kind: "sources", chunkIds: (outside.length ? outside : topic.chunkIds).slice(0, 24) } },
      reason: "None of your saved or library questions on this topic is from outside the lesson yet, so a new one is written for you.",
    });
  }
  const made = await createRevisionSession(ctx.admin, ctx.userId, { mode: "quick", feedback: "immediate", questionIds: items.map(i => i.questionId) });
  if (!made.ok) return NextResponse.json({ error: "The transfer check could not be started just now." }, { status: 503 });
  const kept = await keep(ctx, topic, made.id, items, it => (it.outside === "library" ? "library" : "saved"));
  if (kept) return kept;
  await audit(ctx, "individual_scholar_transfer_check", "individual_scholar_revision_session", made.id, { questions: items.length, outside: countOf(items), library_copied: libraryCopied, generated: 0 });
  return NextResponse.json({ session: { id: made.id }, href: reviseSession(made.id), items: items.map(i => ({ outside: i.outside })) });
}

const countOf = (items: readonly TransferItem[]) => items.reduce<Record<string, number>>((m, i) => ({ ...m, [i.outside]: (m[i.outside] ?? 0) + 1 }), {});

async function keep(ctx: IndividualContext, topic: Topic, sessionId: string, items: readonly TransferItem[], source: (i: TransferItem) => "saved" | "library" | "generated"): Promise<NextResponse | null> {
  const r = await recordTransferCheck(ctx.admin, ctx.userId, items.map(i => ({ sessionId, questionId: i.questionId, topic: topic.label, outside: i.outside, source: source(i), contextChunkIds: topic.ctx.contextChunkIds })));
  return r === "ok" ? null : NextResponse.json({ error: r === "not_provisioned" ? "Transfer checks are not available yet." : "The transfer check could not be recorded just now." }, { status: 503 });
}

/** The session the client made through the revision sessions route, recorded as the transfer check. */
async function record(ctx: IndividualContext, topic: Topic, sessionId: unknown, kinds: readonly RevisionKind[]): Promise<NextResponse> {
  if (!isUuid(sessionId)) return NextResponse.json({ error: "Name the session." }, { status: 400 });
  const s = await getRevisionSession(ctx.admin, ctx.userId, sessionId);
  if (!s.ok) return NextResponse.json({ error: "Your revision session could not be read just now." }, { status: 503 });
  if (!s.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const created = s.data.session.createdAt;
  if (Date.now() - Date.parse(created) > RECENT_MS || s.data.attempts.length) return NextResponse.json({ error: "Only a transfer check just started, before any answer, can be recorded." }, { status: 409 });
  const already = await listTransferChecks(ctx.admin, ctx.userId, { sessionId });
  if (!already.ok) return NextResponse.json({ error: "Your transfer checks could not be read just now." }, { status: 503 });
  if (already.data.length) return NextResponse.json({ session: { id: sessionId }, href: reviseSession(sessionId), items: already.data.map(r => ({ outside: r.outside })) });
  const qs = (await Promise.all(s.data.questionIds.slice(0, 10).map(id => getQuestion(ctx.admin, ctx.userId, id)))).filter((q): q is QuestionRow => !!q && (kinds as readonly string[]).length > 0);
  // A question answered before this session began is in context (seen before); one written for this session is "generated".
  const items: (TransferItem & { written: boolean })[] = qs.flatMap(q => {
    const out = outsideOf(candidateOf(q, !!q.latest && q.latest.answeredAt < created), topic.ctx);
    return out ? [{ questionId: q.id, outside: out, written: Date.parse(q.createdAt) >= Date.parse(created) - 60_000 }] : [];
  });
  if (!items.length) return NextResponse.json({ error: "None of the questions in that session is from outside the lesson, so it stays an ordinary revision session." }, { status: 409 });
  const kept = await keep(ctx, topic, sessionId, items, it => (items.find(x => x.questionId === it.questionId)?.written ? "generated" : it.outside === "library" ? "library" : "saved"));
  if (kept) return kept;
  await audit(ctx, "individual_scholar_transfer_check", "individual_scholar_revision_session", sessionId, { questions: items.length, outside: countOf(items), generated: items.filter(i => i.written).length });
  return NextResponse.json({ session: { id: sessionId }, href: reviseSession(sessionId), items: items.map(i => ({ outside: i.outside })) });
}
