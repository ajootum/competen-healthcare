/* eslint-disable @typescript-eslint/no-explicit-any */
import { isNotProvisioned } from "../access";
import type { Read } from "./store";
import type { ExamOption, PaperFlag, ParsedQuestion, QuestionFlag } from "./exam-paper";
import type { ResearchSource } from "./exam-research";

// ── THE EXAM-PAPER STORE ── COMPETEN-SCHOLAR-EXAM-PAPERS-01 (570) ────────────────────────────────────────
//
// Every read and write is scoped by the caller's own user id (service role, as store.ts), and every child row
// carries a composite key to its paper, so another person's ids find nothing. Without migration 570 every read
// answers notProvisioned, and the feature says it is not set up here rather than failing.

type Admin = any;
const fail = (error: unknown): { ok: false; notProvisioned: boolean } => ({ ok: false, notProvisioned: isNotProvisioned(error) });

export type ExamPaperRow = {
  materialId: string; attestationVersion: string; attestedAt: string; extractor: string; questionCount: number;
  instructions: string | null; flags: PaperFlag[]; createdAt: string;
};
export type ExamQuestionRow = {
  id: string; materialId: string; ordinal: number; number: string; section: string | null; instructions: string | null; stem: string;
  options: ExamOption[]; marks: number | null; pageFrom: number | null; pageTo: number | null; chunkId: string | null;
  source: "text_layer" | "ai_transcription"; flags: QuestionFlag[];
};
export type ExamAnswerRow = {
  id: string; materialId: string; questionId: string | null; kind: "answer" | "guide"; attempt: Record<string, unknown> | null;
  content: Record<string, unknown>; evidence: Record<string, unknown>[]; research: Record<string, unknown>;
  model: string; provider: string; promptVersion: string; revisionQuestionId: string | null; createdAt: string;
};

const PAPER_COLS = "material_id, attestation_version, attested_at, extractor, question_count, instructions, flags, created_at";
const toPaper = (r: any): ExamPaperRow => ({
  materialId: r.material_id, attestationVersion: r.attestation_version, attestedAt: r.attested_at, extractor: r.extractor,
  questionCount: r.question_count, instructions: r.instructions, flags: Array.isArray(r.flags) ? r.flags : [], createdAt: r.created_at,
});
const QUESTION_COLS = "id, material_id, ordinal, number, section, instructions, stem, options, marks, page_from, page_to, chunk_id, source, flags";
const toQuestion = (r: any): ExamQuestionRow => ({
  id: r.id, materialId: r.material_id, ordinal: r.ordinal, number: r.number, section: r.section, instructions: r.instructions, stem: r.stem,
  options: Array.isArray(r.options) ? r.options : [], marks: r.marks === null ? null : Number(r.marks), pageFrom: r.page_from, pageTo: r.page_to,
  chunkId: r.chunk_id, source: r.source, flags: Array.isArray(r.flags) ? r.flags : [],
});
const ANSWER_COLS = "id, material_id, question_id, kind, attempt, content, evidence, research, model, provider, prompt_version, revision_question_id, created_at";
const toAnswer = (r: any): ExamAnswerRow => ({
  id: r.id, materialId: r.material_id, questionId: r.question_id, kind: r.kind, attempt: r.attempt, content: r.content ?? {},
  evidence: Array.isArray(r.evidence) ? r.evidence : [], research: r.research ?? {}, model: r.model, provider: r.provider,
  promptVersion: r.prompt_version, revisionQuestionId: r.revision_question_id, createdAt: r.created_at,
});

export async function getExamPaper(admin: Admin, userId: string, materialId: string): Promise<Read<ExamPaperRow | null>> {
  const { data, error } = await admin.from("individual_scholar_exam_paper").select(PAPER_COLS).eq("user_id", userId).eq("material_id", materialId).maybeSingle();
  if (error) return fail(error);
  return { ok: true, data: data ? toPaper(data) : null };
}

export async function listExamPapers(admin: Admin, userId: string): Promise<Read<ExamPaperRow[]>> {
  const { data, error } = await admin.from("individual_scholar_exam_paper").select(PAPER_COLS).eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(toPaper) };
}

/** The paper and its questions, written together: a failed question insert removes the paper again. */
export async function createExamPaper(admin: Admin, userId: string, input: {
  materialId: string; attestationVersion: string; extractor: string; instructions: string | null; flags: PaperFlag[];
  questions: (ParsedQuestion & { source: "text_layer" | "ai_transcription" })[];
}): Promise<{ ok: true } | { ok: false; notProvisioned: boolean; exists?: boolean }> {
  const { error } = await admin.from("individual_scholar_exam_paper").insert({
    material_id: input.materialId, user_id: userId, attestation_version: input.attestationVersion, attested_at: new Date().toISOString(),
    extractor: input.extractor, question_count: input.questions.length, instructions: input.instructions, flags: input.flags,
  });
  if (error) return { ...fail(error), exists: String((error as any)?.code ?? "") === "23505" };
  if (!input.questions.length) return { ok: true };
  const { error: qErr } = await admin.from("individual_scholar_exam_question").insert(input.questions.map(q => ({
    user_id: userId, material_id: input.materialId, ordinal: q.ordinal, number: q.number, section: q.section, instructions: q.instructions,
    stem: q.stem, options: q.options, marks: q.marks, page_from: q.pageFrom, page_to: q.pageTo, chunk_id: q.chunkId, source: q.source, flags: q.flags,
  })));
  if (qErr) {
    await admin.from("individual_scholar_exam_paper").delete().eq("user_id", userId).eq("material_id", input.materialId);
    return fail(qErr);
  }
  return { ok: true };
}

/** Stop studying a material as a paper: its questions and saved answers go with it (cascade). The material stays. */
export async function deleteExamPaper(admin: Admin, userId: string, materialId: string): Promise<"deleted" | "not_found" | "failed"> {
  const { error, count } = await admin.from("individual_scholar_exam_paper").delete({ count: "exact" }).eq("user_id", userId).eq("material_id", materialId);
  return error ? "failed" : (count ?? 0) > 0 ? "deleted" : "not_found";
}

export async function listExamQuestions(admin: Admin, userId: string, materialId: string): Promise<Read<ExamQuestionRow[]>> {
  const { data, error } = await admin.from("individual_scholar_exam_question").select(QUESTION_COLS).eq("user_id", userId).eq("material_id", materialId).order("ordinal");
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(toQuestion) };
}

export async function getExamQuestion(admin: Admin, userId: string, id: string): Promise<ExamQuestionRow | null> {
  const { data } = await admin.from("individual_scholar_exam_question").select(QUESTION_COLS).eq("user_id", userId).eq("id", id).maybeSingle();
  return data ? toQuestion(data) : null;
}

export async function saveExamAnswer(admin: Admin, userId: string, a: {
  materialId: string; questionId: string | null; kind: "answer" | "guide"; attempt: Record<string, unknown> | null;
  content: Record<string, unknown>; evidence: Record<string, unknown>[]; research: Record<string, unknown>;
  model: string; provider: string; promptVersion: string;
}): Promise<string | null> {
  const { data, error } = await admin.from("individual_scholar_exam_answer").insert({
    user_id: userId, material_id: a.materialId, question_id: a.questionId, kind: a.kind, attempt: a.attempt, content: a.content,
    evidence: a.evidence, research: a.research, model: a.model, provider: a.provider, prompt_version: a.promptVersion,
  }).select("id").single();
  return error ? null : (data as any).id;
}

export async function listExamAnswers(admin: Admin, userId: string, materialId: string): Promise<Read<ExamAnswerRow[]>> {
  const { data, error } = await admin.from("individual_scholar_exam_answer").select(ANSWER_COLS).eq("user_id", userId).eq("material_id", materialId).order("created_at", { ascending: false }).limit(500);
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(toAnswer) };
}

/** Every saved answer of the person, newest first: Evaluate and Progress read these as formative practice. */
export async function listAllExamAnswers(admin: Admin, userId: string, limit = 500): Promise<Read<ExamAnswerRow[]>> {
  const { data, error } = await admin.from("individual_scholar_exam_answer").select(ANSWER_COLS).eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(toAnswer) };
}

export async function getExamAnswer(admin: Admin, userId: string, id: string): Promise<ExamAnswerRow | null> {
  const { data } = await admin.from("individual_scholar_exam_answer").select(ANSWER_COLS).eq("user_id", userId).eq("id", id).maybeSingle();
  return data ? toAnswer(data) : null;
}

export async function deleteExamAnswer(admin: Admin, userId: string, id: string): Promise<boolean> {
  const { error, count } = await admin.from("individual_scholar_exam_answer").delete({ count: "exact" }).eq("user_id", userId).eq("id", id);
  return !error && (count ?? 0) > 0;
}

export async function linkRevision(admin: Admin, userId: string, answerId: string, revisionQuestionId: string): Promise<boolean> {
  const { error } = await admin.from("individual_scholar_exam_answer").update({ revision_question_id: revisionQuestionId }).eq("user_id", userId).eq("id", answerId);
  return !error;
}

// ── the public research cache: no user, nothing of a student's ──────────────────────────────────────────

export async function readResearchCache(admin: Admin, key: string, nowIso: string): Promise<{ sources: ResearchSource[]; createdAt: string } | null> {
  const { data } = await admin.from("individual_scholar_research_cache").select("sources, created_at, expires_at").eq("query_hash", key).maybeSingle();
  if (!data || (data as any).expires_at <= nowIso) return null;
  return { sources: Array.isArray((data as any).sources) ? (data as any).sources : [], createdAt: (data as any).created_at };
}

export async function writeResearchCache(admin: Admin, row: { key: string; provider: string; policyVersion: string; sources: ResearchSource[]; searches: number; days: number }): Promise<void> {
  if (row.days <= 0) return;
  const now = new Date();
  await admin.from("individual_scholar_research_cache").upsert({
    query_hash: row.key, provider: row.provider.slice(0, 100), policy_version: row.policyVersion.slice(0, 200), sources: row.sources.slice(0, 20),
    searches: Math.min(20, Math.max(0, row.searches)), created_at: now.toISOString(), expires_at: new Date(now.getTime() + row.days * 86400000).toISOString(),
  }, { onConflict: "query_hash" }).then((r: unknown) => r, () => {});
}

export const EXAM_RESEARCH_ENTITY = "individual_scholar_exam_research";

/** Fresh web research the person ran today (UTC), from the audit rows each one writes. Unreadable: null (refuse). */
export async function webResearchToday(admin: Admin, userId: string): Promise<number | null> {
  const since = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
  const { count, error } = await admin.from("audit_log").select("id", { count: "exact", head: true })
    .eq("actor_id", userId).eq("entity_type", EXAM_RESEARCH_ENTITY).gte("created_at", since);
  return error ? null : (count ?? 0);
}
