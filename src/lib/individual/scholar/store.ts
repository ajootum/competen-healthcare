/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { sm2 } from "@/lib/delivery/reinforcement";
import { isNotProvisioned } from "../access";
import { BUCKET, CONSENT_FEATURE, CONSENT_NOTICE_VERSION, MAX_MATERIALS_PER_PERSON, type MaterialMime } from "./config";
import type { Chunk } from "./extract";
import type { CandidateChunk } from "./retrieval";
import type { DraftQuestion, Passage, QuestionKind } from "./generation";
import type { ProgressAttempt, ProgressCard, ProgressMaterial, ProgressQuestion } from "./progress";
import { isLayer, type Layer, type ProgrammeConfig } from "./catalogue";
import { mappingStates, type LiveMapping, type MappingDecision, type MappingState, type MappingSubject, type SubjectAnalysis } from "@/lib/competency/mapping";

export type MapSource = "ai" | "student" | "reviewer";
import { STUDY_ACHIEVEMENT, isStudyAchievementKind, studyAchievementsFrom, type ChoiceRow, type StudyAchievement, type StudyAchievementKind } from "./passport-items";

// ── THE SCHOLAR STORE ── the ONE file that reads and writes individual_scholar_* (migration 372) ──────────
//
// ⚠ EVERY QUERY IS KEYED ON THE CALLER'S OWN user_id. The caller is the gate-3 guard's context
// (requireIndividualContext("scholar") or experiencePage), and the id comes from it, never from a request
// body. The service role bypasses RLS, so this filter IS the isolation on the application path -- and the
// composite foreign keys in 372 make a row pointing at another person's material unstorable anyway.
//
// ⚠ THE ONLY WRITE SITE. scripts/individual-foundation-harness.ts (2a) allows writes to these tables
// from this file and nowhere else, and scripts/scholar-learning-harness.ts checks the user_id filter.
//
// ⚠ OWNER RULING D1. Nothing here touches quiz_attempts, knowledge_attempts, cdp_reinforcement_cards or
// any other estate learning table. The SM-2 arithmetic is IMPORTED from src/lib/delivery/reinforcement.ts
// (not copied); only the card store is Scholar's own.
//
// ⚠ UNREADABLE IS NOT EMPTY. A read that fails returns { ok: false } and the page says it could not be
// read. A table that does not exist yet (372 not applied) is reported as not provisioned.

type Admin = any;
export type Read<T> = { ok: true; data: T } | { ok: false; notProvisioned: boolean };
const fail = (error: unknown): { ok: false; notProvisioned: boolean } => ({ ok: false, notProvisioned: isNotProvisioned(error) });
const todayIso = () => new Date().toISOString().slice(0, 10);

// ── CONSENT ────────────────────────────────────────────────────────────────────────────────────────

export type ConsentState = { granted: boolean; noticeVersion: string | null; grantedAt: string | null; revokedAt: string | null };

export async function readConsent(admin: Admin, userId: string): Promise<Read<ConsentState>> {
  const { data, error } = await admin.from("individual_scholar_consent")
    .select("status, notice_version, granted_at, revoked_at")
    .eq("user_id", userId).eq("feature", CONSENT_FEATURE).maybeSingle();
  if (error) return fail(error);
  return {
    ok: true,
    data: data
      ? { granted: data.status === "granted", noticeVersion: data.notice_version, grantedAt: data.granted_at, revokedAt: data.revoked_at }
      : { granted: false, noticeVersion: null, grantedAt: null, revokedAt: null },
  };
}

/** Grant or revoke. A grant records the notice version shown. A revoke keeps it, and says when. */
export async function setConsent(admin: Admin, userId: string, grant: boolean): Promise<{ ok: boolean }> {
  const now = new Date().toISOString();
  if (grant) {
    const { error } = await admin.from("individual_scholar_consent").upsert({
      user_id: userId, feature: CONSENT_FEATURE, status: "granted", notice_version: CONSENT_NOTICE_VERSION,
      granted_at: now, revoked_at: null, updated_at: now,
    }, { onConflict: "user_id,feature" });
    return { ok: !error };
  }
  const { error } = await admin.from("individual_scholar_consent")
    .update({ status: "revoked", revoked_at: now, updated_at: now })
    .eq("user_id", userId).eq("feature", CONSENT_FEATURE);
  return { ok: !error };
}

// ── MATERIALS ──────────────────────────────────────────────────────────────────────────────────────

export type MaterialRow = {
  id: string; title: string; fileName: string; mimeType: MaterialMime; byteSize: number;
  pageCount: number | null; chunkCount: number; createdAt: string;
};
const MATERIAL_COLS = "id, title, file_name, mime_type, byte_size, page_count, chunk_count, created_at";
const toMaterial = (r: any): MaterialRow => ({
  id: r.id, title: r.title, fileName: r.file_name, mimeType: r.mime_type, byteSize: r.byte_size,
  pageCount: r.page_count, chunkCount: r.chunk_count, createdAt: r.created_at,
});

export async function listMaterials(admin: Admin, userId: string): Promise<Read<MaterialRow[]>> {
  const { data, error } = await admin.from("individual_scholar_material").select(MATERIAL_COLS)
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(MAX_MATERIALS_PER_PERSON);
  if (error) return fail(error);
  return { ok: true, data: (data ?? []).map(toMaterial) };
}

export async function getMaterial(admin: Admin, userId: string, id: string): Promise<Read<MaterialRow | null>> {
  if (!isUuid(id)) return { ok: true, data: null };
  const { data, error } = await admin.from("individual_scholar_material").select(MATERIAL_COLS)
    .eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) return fail(error);
  return { ok: true, data: data ? toMaterial(data) : null };
}

export async function countMaterials(admin: Admin, userId: string): Promise<number | null> {
  const { count, error } = await admin.from("individual_scholar_material").select("id", { count: "exact", head: true }).eq("user_id", userId);
  return error ? null : (count ?? 0);
}

// ── UPLOAD: A SIGNED SLOT, THEN PROCESSING ──────────────────────────────────────────────────────────
//
// ⚠ THE FILE DOES NOT PASS THROUGH A ROUTE HANDLER. A serverless function on this deployment accepts a
// request body of about 4.5 MB, and the proxy buffers 10 MB, so a 10 MB upload through a route would be
// cut off. Instead the server issues a one-time signed upload URL for ONE path it chose itself,
// <user_id>/<upload id>.<ext>. The browser can write that object and nothing else (the bucket still
// enforces its size and type). Processing then reads the object back by the same server-built path.

export const uploadPath = (userId: string, uploadId: string, mime: MaterialMime) =>
  `${userId}/${uploadId}.${mime === "application/pdf" ? "pdf" : mime === "text/plain" ? "txt" : "docx"}`;

export async function createUploadSlot(admin: Admin, userId: string, mime: MaterialMime): Promise<{ uploadId: string; path: string; token: string } | null> {
  const uploadId = crypto.randomUUID();
  const path = uploadPath(userId, uploadId, mime);
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) return null;
  return { uploadId, path, token: data.token };
}

/** The uploaded object's bytes, or null. Only ever called with a path built by uploadPath(). */
export async function readUpload(admin: Admin, path: string): Promise<Uint8Array | null> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export async function discardUpload(admin: Admin, path: string): Promise<void> {
  await admin.storage.from(BUCKET).remove([path]);
}

/**
 * The material row, then its chunks, for an object already in the bucket at `path`. If any step fails,
 * everything already written is removed, the object included: a material with no chunks, or an object
 * with no row, is a state nobody could see or erase.
 */
export async function createMaterial(admin: Admin, userId: string, input: {
  id: string; path: string; title: string; fileName: string; mime: MaterialMime; bytes: Uint8Array;
  pageCount: number | null; extractor: string; chunks: Chunk[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string; detail?: string }> {
  const { id, path } = input;
  const { error: mErr } = await admin.from("individual_scholar_material").insert({
    id, user_id: userId, title: input.title, file_name: input.fileName.slice(0, 255), mime_type: input.mime,
    byte_size: input.bytes.byteLength, sha256: createHash("sha256").update(input.bytes).digest("hex"),
    storage_path: path, page_count: input.pageCount, chunk_count: input.chunks.length,
    char_count: input.chunks.reduce((n, c) => n + c.content.length, 0), extractor: input.extractor,
    pii_attested_at: new Date().toISOString(),
  });
  if (mErr) {
    await admin.storage.from(BUCKET).remove([path]);
    return { ok: false, error: "material", detail: mErr.message };
  }
  for (let i = 0; i < input.chunks.length; i += 200) {
    const { error } = await admin.from("individual_scholar_chunk").insert(input.chunks.slice(i, i + 200).map(c => ({
      material_id: id, user_id: userId, ordinal: c.ordinal, page_from: c.pageFrom, page_to: c.pageTo, content: c.content,
    })));
    if (error) {
      await admin.from("individual_scholar_material").delete().eq("id", id).eq("user_id", userId);
      await admin.storage.from(BUCKET).remove([path]);
      return { ok: false, error: "chunks", detail: error.message };
    }
  }
  return { ok: true, id };
}

/** Owner erasure of one material: the object, then the row (which cascades to everything derived). */
export async function deleteMaterial(admin: Admin, userId: string, id: string): Promise<{ ok: boolean; found: boolean }> {
  if (!isUuid(id)) return { ok: true, found: false };
  const { data, error } = await admin.from("individual_scholar_material").select("id, storage_path")
    .eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) return { ok: false, found: false };
  if (!data) return { ok: true, found: false };
  const rm = await admin.storage.from(BUCKET).remove([data.storage_path]);
  if (rm.error) return { ok: false, found: true };
  const { error: dErr } = await admin.from("individual_scholar_material").delete().eq("user_id", userId).eq("id", id);
  return { ok: !dErr, found: true };
}

/**
 * Owner erasure of ALL their Scholar study material. Every object in their folder goes, including any
 * upload that was never processed. The consent record is kept: it is the record of a choice they made,
 * and it holds no study content.
 */
export async function eraseAllMaterial(admin: Admin, userId: string): Promise<{ ok: boolean; erased: number }> {
  const { data, error } = await admin.from("individual_scholar_material").select("id, storage_path").eq("user_id", userId);
  if (error) return { ok: false, erased: 0 };
  const rows = (data ?? []) as { id: string; storage_path: string }[];
  const listed = await admin.storage.from(BUCKET).list(userId, { limit: 1000 });
  if (listed.error) return { ok: false, erased: 0 };
  const paths = new Set([...rows.map(r => r.storage_path), ...((listed.data ?? []) as any[]).map(o => `${userId}/${o.name}`)]);
  if (paths.size) {
    const rm = await admin.storage.from(BUCKET).remove([...paths]);
    if (rm.error) return { ok: false, erased: 0 };
  }
  const { error: dErr } = await admin.from("individual_scholar_material").delete().eq("user_id", userId);
  return { ok: !dErr, erased: dErr ? 0 : rows.length };
}

/** A five-minute signed URL to the owner's own original. */
export async function signedOriginalUrl(admin: Admin, userId: string, id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  const { data } = await admin.from("individual_scholar_material").select("storage_path, file_name")
    .eq("user_id", userId).eq("id", id).maybeSingle();
  if (!data) return null;
  const { data: s, error } = await admin.storage.from(BUCKET).createSignedUrl(data.storage_path, 300, { download: data.file_name });
  return error ? null : s?.signedUrl ?? null;
}

// ── CHUNKS AND PASSAGES ────────────────────────────────────────────────────────────────────────────

export type ChunkRow = { id: string; ordinal: number; pageFrom: number | null; pageTo: number | null; content: string };

export async function listChunks(admin: Admin, userId: string, materialId: string): Promise<Read<ChunkRow[]>> {
  const { data, error } = await admin.from("individual_scholar_chunk").select("id, ordinal, page_from, page_to, content")
    .eq("user_id", userId).eq("material_id", materialId).order("ordinal").limit(2000);
  if (error) return fail(error);
  return { ok: true, data: (data ?? []).map((r: any) => ({ id: r.id, ordinal: r.ordinal, pageFrom: r.page_from, pageTo: r.page_to, content: r.content })) };
}

async function titlesOf(admin: Admin, userId: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data } = await admin.from("individual_scholar_material").select("id, title").eq("user_id", userId).in("id", ids);
  return new Map(((data ?? []) as any[]).map(r => [r.id, r.title]));
}

export async function getPassage(admin: Admin, userId: string, chunkId: string): Promise<Passage | null> {
  if (!isUuid(chunkId)) return null;
  const { data } = await admin.from("individual_scholar_chunk").select("id, material_id, ordinal, page_from, page_to, content")
    .eq("user_id", userId).eq("id", chunkId).maybeSingle();
  if (!data) return null;
  const titles = await titlesOf(admin, userId, [data.material_id]);
  return {
    chunkId: data.id, materialId: data.material_id, materialTitle: titles.get(data.material_id) ?? "Your material",
    ordinal: data.ordinal, pageFrom: data.page_from, pageTo: data.page_to, content: data.content,
  };
}

/** FTS candidates from the person's OWN chunks, optionally one material. The tsquery is pre-sanitised. */
export async function searchCandidates(admin: Admin, userId: string, tsquery: string, materialId?: string | null): Promise<Read<CandidateChunk[]>> {
  let q = admin.from("individual_scholar_chunk").select("id, material_id, ordinal, page_from, page_to, content")
    .eq("user_id", userId).textSearch("tsv", tsquery, { config: "english" });
  if (materialId) q = q.eq("material_id", materialId);
  const { data, error } = await q.limit(40);
  if (error) return fail(error);
  return {
    ok: true,
    data: (data ?? []).map((r: any) => ({ id: r.id, materialId: r.material_id, ordinal: r.ordinal, pageFrom: r.page_from, pageTo: r.page_to, content: r.content })),
  };
}

export async function toPassages(admin: Admin, userId: string, chunks: CandidateChunk[]): Promise<Passage[]> {
  const titles = await titlesOf(admin, userId, [...new Set(chunks.map(c => c.materialId))]);
  return chunks.map(c => ({
    chunkId: c.id, materialId: c.materialId, materialTitle: titles.get(c.materialId) ?? "Your material",
    ordinal: c.ordinal, pageFrom: c.pageFrom, pageTo: c.pageTo, content: c.content,
  }));
}

// ── QUESTIONS AND ATTEMPTS ─────────────────────────────────────────────────────────────────────────

export type QuestionRow = {
  id: string; materialId: string; chunkId: string; kind: QuestionKind; stem: string; options: string[];
  correctIndex: number; rationale: string; sourceQuote: string; model: string; promptVersion: string; createdAt: string;
  materialTitle: string; ordinal: number | null; pageFrom: number | null; pageTo: number | null;
  latest: { correct: boolean; chosenIndex: number; answeredAt: string } | null;
  /** Migration 388. Null where 388 is absent, or the question practises no particular competency. */
  competencyId: string | null;
  caseId: string | null; caseStep: number | null; caseTitle: string | null;
};

const QUESTION_COLS = "id, material_id, chunk_id, kind, stem, options, correct_index, rationale, source_quote, model, prompt_version, created_at";

/**
 * The 388 columns are written ONLY when there is something to write. Where 388 is not applied, a question
 * with no competency and no case is the 372 insert exactly, so the MVP keeps working (fail closed: the
 * competency features are simply absent). A case is its steps in order: one case_id, case_step 1..n, and
 * the title on step 1.
 */
export async function insertQuestions(admin: Admin, userId: string, input: {
  passage: Passage; kind: QuestionKind; drafts: DraftQuestion[]; model: string; provider: string; promptVersion: string;
  competencyId?: string | null; caseId?: string | null; caseTitle?: string | null;
}): Promise<{ ok: boolean; ids: string[] }> {
  if (!input.drafts.length) return { ok: true, ids: [] };
  if (input.caseId && input.kind !== "case") return { ok: false, ids: [] };
  const { data, error } = await admin.from("individual_scholar_question").insert(input.drafts.map((d, i) => ({
    user_id: userId, material_id: input.passage.materialId, chunk_id: input.passage.chunkId, kind: input.kind,
    stem: d.stem, options: d.options, correct_index: d.correctIndex, rationale: d.rationale, source_quote: d.sourceQuote,
    model: input.model, provider: input.provider, prompt_version: input.promptVersion,
    ...(input.competencyId ? { competency_id: input.competencyId } : {}),
    ...(input.caseId ? { case_id: input.caseId, case_step: i + 1, ...(i === 0 ? { case_title: input.caseTitle ?? null } : {}) } : {}),
  }))).select("id");
  if (error) return { ok: false, ids: [] };
  return { ok: true, ids: ((data ?? []) as any[]).map(r => r.id) };
}

async function hydrate(admin: Admin, userId: string, rows: any[]): Promise<QuestionRow[]> {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [titles, chunksRes, attRes, extra] = await Promise.all([
    titlesOf(admin, userId, [...new Set(rows.map(r => r.material_id as string))]),
    admin.from("individual_scholar_chunk").select("id, ordinal, page_from, page_to").eq("user_id", userId).in("id", [...new Set(rows.map(r => r.chunk_id as string))]),
    admin.from("individual_scholar_attempt").select("question_id, correct, chosen_index, answered_at").eq("user_id", userId).in("question_id", ids).order("answered_at", { ascending: false }),
    questionExtras(admin, userId, ids),
  ]);
  const chunk = new Map(((chunksRes.data ?? []) as any[]).map(c => [c.id, c]));
  const latest = new Map<string, any>();
  for (const a of (attRes.data ?? []) as any[]) if (!latest.has(a.question_id)) latest.set(a.question_id, a);
  return rows.map(r => {
    const c = chunk.get(r.chunk_id);
    const l = latest.get(r.id);
    return {
      id: r.id, materialId: r.material_id, chunkId: r.chunk_id, kind: r.kind, stem: r.stem, options: r.options,
      correctIndex: r.correct_index, rationale: r.rationale, sourceQuote: r.source_quote, model: r.model,
      promptVersion: r.prompt_version, createdAt: r.created_at, materialTitle: titles.get(r.material_id) ?? "Your material",
      ordinal: c?.ordinal ?? null, pageFrom: c?.page_from ?? null, pageTo: c?.page_to ?? null,
      latest: l ? { correct: l.correct, chosenIndex: l.chosen_index, answeredAt: l.answered_at } : null,
      competencyId: extra.get(r.id)?.competency_id ?? null, caseId: extra.get(r.id)?.case_id ?? null,
      caseStep: extra.get(r.id)?.case_step ?? null, caseTitle: extra.get(r.id)?.case_title ?? null,
    };
  });
}

/** The 388 columns, read apart from the 372 ones so that their absence costs nothing but themselves. */
async function questionExtras(admin: Admin, userId: string, ids: string[]): Promise<Map<string, any>> {
  if (!ids.length) return new Map();
  const { data, error } = await admin.from("individual_scholar_question").select("id, competency_id, case_id, case_step, case_title")
    .eq("user_id", userId).in("id", ids);
  if (error) return new Map();
  return new Map(((data ?? []) as any[]).map(r => [r.id, r]));
}

export async function listQuestions(admin: Admin, userId: string, opts: { materialId?: string; kind?: QuestionKind } = {}): Promise<Read<QuestionRow[]>> {
  let q = admin.from("individual_scholar_question").select(QUESTION_COLS).eq("user_id", userId);
  if (opts.materialId) q = q.eq("material_id", opts.materialId);
  if (opts.kind) q = q.eq("kind", opts.kind);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(200);
  if (error) return fail(error);
  return { ok: true, data: await hydrate(admin, userId, data ?? []) };
}

export async function getQuestion(admin: Admin, userId: string, id: string): Promise<QuestionRow | null> {
  if (!isUuid(id)) return null;
  const { data } = await admin.from("individual_scholar_question").select(QUESTION_COLS).eq("user_id", userId).eq("id", id).maybeSingle();
  if (!data) return null;
  return (await hydrate(admin, userId, [data]))[0] ?? null;
}

/**
 * Record one answer. A MISSED question becomes a spaced-review card (COMPETEN-IND-004 s4): a new card is
 * due today, and an existing card is put back to the start of its schedule by SM-2 itself (quality 1 is
 * a lapse), not by a rule of this file's own.
 */
export async function recordAttempt(admin: Admin, userId: string, q: QuestionRow, chosenIndex: number): Promise<{ ok: boolean; correct: boolean; card: "created" | "reset" | null }> {
  const correct = chosenIndex === q.correctIndex;
  const { error } = await admin.from("individual_scholar_attempt").insert({ user_id: userId, question_id: q.id, chosen_index: chosenIndex, correct });
  if (error) return { ok: false, correct, card: null };
  if (correct) return { ok: true, correct, card: null };

  const { data: existing } = await admin.from("individual_scholar_card").select("id, ease_factor, interval_days, repetitions")
    .eq("user_id", userId).eq("question_id", q.id).maybeSingle();
  if (!existing) {
    const { error: cErr } = await admin.from("individual_scholar_card").insert({
      user_id: userId, question_id: q.id, material_id: q.materialId, next_review_at: todayIso(), status: "active",
    });
    return { ok: !cErr, correct, card: cErr ? null : "created" };
  }
  const next = sm2({ ease: Number(existing.ease_factor ?? 2.5), interval: existing.interval_days ?? 0, reps: existing.repetitions ?? 0 }, 1);
  const { error: uErr } = await admin.from("individual_scholar_card").update({
    ease_factor: next.ease, interval_days: next.interval, repetitions: next.reps, status: "active",
    next_review_at: todayIso(), updated_at: new Date().toISOString(),
  }).eq("user_id", userId).eq("id", existing.id);
  return { ok: !uErr, correct, card: uErr ? null : "reset" };
}

// ── REVISE: CARDS ──────────────────────────────────────────────────────────────────────────────────

export type CardRow = { id: string; nextReviewAt: string; reviews: number; status: "active" | "mastered"; question: QuestionRow };

export async function dueCards(admin: Admin, userId: string): Promise<Read<CardRow[]>> {
  const { data, error } = await admin.from("individual_scholar_card").select("id, question_id, next_review_at, reviews, status")
    .eq("user_id", userId).eq("status", "active").lte("next_review_at", todayIso()).order("next_review_at").limit(50);
  if (error) return fail(error);
  const rows = (data ?? []) as any[];
  if (!rows.length) return { ok: true, data: [] };
  const qRes = await admin.from("individual_scholar_question").select(QUESTION_COLS).eq("user_id", userId).in("id", rows.map(r => r.question_id));
  if (qRes.error) return fail(qRes.error);
  const qs = new Map((await hydrate(admin, userId, qRes.data ?? [])).map(q => [q.id, q]));
  return {
    ok: true,
    data: rows.filter(r => qs.has(r.question_id)).map(r => ({ id: r.id, nextReviewAt: r.next_review_at, reviews: r.reviews, status: r.status, question: qs.get(r.question_id)! })),
  };
}

/** How many cards are due now. Null when it could not be counted -- never shown as zero. */
export async function countDue(admin: Admin, userId: string): Promise<number | null> {
  const { count, error } = await admin.from("individual_scholar_card").select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("status", "active").lte("next_review_at", todayIso());
  return error ? null : (count ?? 0);
}

/** The learner self-grades recall 0..5. SM-2 (imported) reschedules. Owner-keyed. */
export async function reviewCard(admin: Admin, userId: string, cardId: string, quality: number) {
  if (!isUuid(cardId)) return { ok: false as const, error: "not_found" };
  const { data: card } = await admin.from("individual_scholar_card").select("id, material_id, ease_factor, interval_days, repetitions, reviews")
    .eq("user_id", userId).eq("id", cardId).maybeSingle();
  if (!card) return { ok: false as const, error: "not_found" };
  const next = sm2({ ease: Number(card.ease_factor ?? 2.5), interval: card.interval_days ?? 0, reps: card.repetitions ?? 0 }, quality);
  const nextDate = new Date(Date.now() + next.interval * 864e5).toISOString().slice(0, 10);
  // The mastery rule reinforcement.ts applies to its own cards, applied the same way here.
  const status = next.reps >= 5 && next.interval >= 60 ? "mastered" : "active";
  const now = new Date().toISOString();
  const { error } = await admin.from("individual_scholar_card").update({
    ease_factor: next.ease, interval_days: next.interval, repetitions: next.reps, next_review_at: nextDate,
    last_reviewed_at: now, last_quality: next.quality, reviews: (card.reviews ?? 0) + 1, status, updated_at: now,
  }).eq("user_id", userId).eq("id", cardId);
  if (error) return { ok: false as const, error: "write" };
  // The review history (migration 391, COMPETEN-SCHOLAR-01 S5): one row per review, for engagement and
  // recall over time. It never blocks the review itself -- the card is already rescheduled -- and before
  // 391 is installed the table is absent and nothing is written; the page says when the record starts.
  await admin.from("individual_scholar_review").insert({
    user_id: userId, card_id: cardId, material_id: card.material_id, quality: next.quality, interval_days: next.interval, reviewed_at: now,
  }).then((r: unknown) => r, () => {});
  return { ok: true as const, nextReviewAt: nextDate, intervalDays: next.interval, status };
}

/** The review history (migration 391), or null while the table is not installed. Owner-keyed. */
export async function reviewRows(admin: Admin, userId: string): Promise<Read<{ materialId: string; quality: number; reviewedAt: string }[] | null>> {
  const { data, error } = await admin.from("individual_scholar_review").select("material_id, quality, reviewed_at")
    .eq("user_id", userId).order("reviewed_at", { ascending: false }).limit(10000);
  if (error) return isNotProvisioned(error) ? { ok: true, data: null } : fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(r => ({ materialId: r.material_id, quality: r.quality, reviewedAt: r.reviewed_at })) };
}

// ── IMPROVE: THE ROWS PROGRESS IS BUILT FROM ───────────────────────────────────────────────────────

export async function progressRows(admin: Admin, userId: string): Promise<Read<{
  materials: ProgressMaterial[]; questions: ProgressQuestion[]; attempts: ProgressAttempt[]; cards: ProgressCard[];
}>> {
  const [m, q, a, c] = await Promise.all([
    admin.from("individual_scholar_material").select("id, title, created_at").eq("user_id", userId).order("created_at", { ascending: false }),
    admin.from("individual_scholar_question").select("id, material_id, kind").eq("user_id", userId).limit(5000),
    admin.from("individual_scholar_attempt").select("question_id, correct, answered_at").eq("user_id", userId).order("answered_at", { ascending: false }).limit(10000),
    admin.from("individual_scholar_card").select("material_id, status, next_review_at").eq("user_id", userId).limit(5000),
  ]);
  const err = m.error ?? q.error ?? a.error ?? c.error;
  if (err) return fail(err);
  return {
    ok: true,
    data: {
      materials: (m.data ?? []).map((r: any) => ({ id: r.id, title: r.title, createdAt: r.created_at })),
      questions: (q.data ?? []).map((r: any) => ({ id: r.id, materialId: r.material_id, kind: r.kind })),
      attempts: (a.data ?? []).map((r: any) => ({ questionId: r.question_id, correct: r.correct, answeredAt: r.answered_at })),
      cards: (c.data ?? []).map((r: any) => ({ materialId: r.material_id, status: r.status, nextReviewAt: r.next_review_at })),
    },
  };
}

// ── COMPETEN-SCHOLAR-01: PROGRAMMES, CONCEPTS, PROPOSED MAPPINGS, DECISIONS (migrations 387, 388) ─────
//
// ⚠ CONFIGURATION IS NOT PERSONAL. individual_scholar_programme and individual_scholar_programme_framework
// carry no user_id: they say which frameworks a programme learns against, for everyone. They are the two
// tables here read without the caller's id, and they are only ever read (CONFIG_TABLES in the harness).
// Everything else below is keyed on the caller's own user_id like the rest of this file.
//
// ⚠ A DECISION IS A NEW ROW. Accepting or rejecting a mapping inserts into the append-only decision table
// (its trigger refuses UPDATE and DELETE). Nothing here updates or deletes a mapping or a decision -- they
// go only by cascade, when the person deletes the material they came from.

export type ProgrammeSummary = { code: string; label: string; profession: string; country: string | null; level: string | null };

export async function listProgrammes(admin: Admin): Promise<Read<ProgrammeSummary[]>> {
  const { data, error } = await admin.from("individual_scholar_programme").select("code, label, profession, country, level")
    .eq("is_active", true).order("label").limit(200);
  if (error) return fail(error);
  return { ok: true, data: (data ?? []) as ProgrammeSummary[] };
}

export async function loadProgramme(admin: Admin, code: string): Promise<Read<ProgrammeConfig | null>> {
  const { data: p, error } = await admin.from("individual_scholar_programme").select("code, label, profession, country, level")
    .eq("code", code).eq("is_active", true).maybeSingle();
  if (error) return fail(error);
  if (!p) return { ok: true, data: null };
  const { data: f, error: fErr } = await admin.from("individual_scholar_programme_framework").select("framework_id, layer, sort_order")
    .eq("programme_code", code).order("sort_order").limit(50);
  if (fErr) return fail(fErr);
  return {
    ok: true,
    data: {
      ...(p as ProgrammeSummary),
      frameworks: ((f ?? []) as any[]).filter(r => isLayer(r.layer)).map(r => ({ frameworkId: r.framework_id, layer: r.layer, sortOrder: r.sort_order ?? 0 })),
    },
  };
}

/** The programme the person chose, as configuration, or null when they have not chosen one. */
export async function learnerProgramme(admin: Admin, userId: string): Promise<Read<ProgrammeConfig | null>> {
  const { data, error } = await admin.from("individual_scholar_learner").select("programme_code").eq("user_id", userId).maybeSingle();
  if (error) return fail(error);
  if (!data) return { ok: true, data: null };
  return loadProgramme(admin, data.programme_code);
}

/** Choose a programme (an active one only), or clear the choice with null. */
export async function setLearnerProgramme(admin: Admin, userId: string, code: string | null): Promise<"ok" | "unknown_programme" | "failed"> {
  if (code === null) {
    const { error } = await admin.from("individual_scholar_learner").delete().eq("user_id", userId);
    return error ? "failed" : "ok";
  }
  const p = await loadProgramme(admin, code);
  if (!p.ok) return "failed";
  if (!p.data) return "unknown_programme";
  const { error } = await admin.from("individual_scholar_learner")
    .upsert({ user_id: userId, programme_code: code, chosen_at: new Date().toISOString() }, { onConflict: "user_id" });
  return error ? "failed" : "ok";
}

// ── COMPETEN-SCHOLAR-JOIN-01: THE EDUCATIONAL CONTEXT (migration 402) ── rules in ./context.ts, reads and writes here ──

export type LearnerContextRow = {
  programme_code: string; level_code: string | null; level_label: string | null;
  institution_code: string | null; institution_label: string | null;
};

/** Write the CURRENT context. 402's trigger copies a real change into the history -- this never writes the history. */
export async function writeLearnerContext(admin: Admin, userId: string, c: LearnerContextRow): Promise<"ok" | "failed"> {
  const { error } = await admin.from("individual_scholar_learner")
    .upsert({ user_id: userId, ...c, chosen_at: new Date().toISOString() }, { onConflict: "user_id" });
  return error ? "failed" : "ok";
}

/** The current context's codes, to preselect a form, or null. */
export async function learnerContextPointer(admin: Admin, userId: string): Promise<Read<{ programme_code: string; level_code: string | null; institution_code: string | null } | null>> {
  const { data, error } = await admin.from("individual_scholar_learner").select("programme_code, level_code, institution_code").eq("user_id", userId).maybeSingle();
  if (error) return fail(error);
  return { ok: true, data: data ?? null };
}

/** The person's context periods, newest first. */
export async function learnerContextPeriods(admin: Admin, userId: string): Promise<Read<any[]>> {
  const { data, error } = await admin.from("individual_scholar_learner_context")
    .select("programme_code, level_label, institution_label, effective_from, effective_to")
    .eq("user_id", userId).order("effective_from", { ascending: false }).limit(100);
  if (error) return fail(error);
  return { ok: true, data: data ?? [] };
}

/** How much of one material has been analysed. */
export async function analysisStatus(admin: Admin, userId: string, materialId: string): Promise<Read<{ sections: number; analysed: number }>> {
  const [c, a] = await Promise.all([
    admin.from("individual_scholar_chunk").select("id", { count: "exact" }).eq("user_id", userId).eq("material_id", materialId).limit(1),
    admin.from("individual_scholar_chunk_analysis").select("chunk_id", { count: "exact" }).eq("user_id", userId).eq("material_id", materialId).limit(1),
  ]);
  const err = c.error ?? a.error;
  if (err) return fail(err);
  return { ok: true, data: { sections: c.count ?? 0, analysed: a.count ?? 0 } };
}

/** The next sections of one material that have not been analysed, in document order. */
export async function unanalysedSections(admin: Admin, userId: string, materialId: string, limit: number): Promise<Read<MappingSubject[]>> {
  const [c, a] = await Promise.all([
    admin.from("individual_scholar_chunk").select("id, content").eq("user_id", userId).eq("material_id", materialId).order("ordinal").limit(2000),
    admin.from("individual_scholar_chunk_analysis").select("chunk_id").eq("user_id", userId).eq("material_id", materialId).limit(2000),
  ]);
  const err = c.error ?? a.error;
  if (err) return fail(err);
  const done = new Set(((a.data ?? []) as any[]).map(r => r.chunk_id));
  return { ok: true, data: ((c.data ?? []) as any[]).filter(r => !done.has(r.id)).slice(0, limit).map(r => ({ ref: r.id, text: r.content })) };
}

/**
 * Store one analysis call. EVERY section sent is marked analysed, including one the model said nothing
 * about, so a section is never sent again and again. Proposals already stored for the same section and
 * competency are left as they are (ignoreDuplicates): a proposal is never overwritten.
 */
export async function saveAnalysis(admin: Admin, userId: string, input: {
  materialId: string; programmeCode: string | null; model: string; promptVersion: string; sentChunkIds: string[]; sections: SubjectAnalysis[];
}): Promise<{ ok: boolean; proposals: number }> {
  const byChunk = new Map(input.sections.map(s => [s.ref, s]));
  const { error } = await admin.from("individual_scholar_chunk_analysis").upsert(input.sentChunkIds.map(chunkId => ({
    chunk_id: chunkId, user_id: userId, material_id: input.materialId, concepts: byChunk.get(chunkId)?.concepts ?? [],
    programme_code: input.programmeCode, model: input.model, prompt_version: input.promptVersion,
  })), { onConflict: "chunk_id", ignoreDuplicates: true });
  if (error) return { ok: false, proposals: 0 };
  const maps = input.sections.filter(s => input.sentChunkIds.includes(s.ref)).flatMap(s => s.proposals.filter(p => p.layer !== null).map(p => ({
    user_id: userId, material_id: input.materialId, chunk_id: s.ref, competency_id: p.competencyId, layer: p.layer,
    source: "ai", confidence: p.confidence, rationale: p.rationale, model: input.model, prompt_version: input.promptVersion,
    programme_code: input.programmeCode,
  })));
  if (!maps.length) return { ok: true, proposals: 0 };
  const { error: mErr } = await admin.from("individual_scholar_competency_map")
    .upsert(maps.map(r => ({ ...r, user_id: userId })), { onConflict: "chunk_id,competency_id", ignoreDuplicates: true });
  return { ok: !mErr, proposals: mErr ? 0 : maps.length };
}

export type MappingRow = {
  id: string; chunkId: string; materialId: string; competencyId: string; layer: Layer; source: MapSource;
  confidence: number | null; rationale: string | null; model: string | null; promptVersion: string | null; createdAt: string;
  state: MappingState; decidedBy: "student" | "reviewer" | null; decisions: number;
};

/** The person's mappings (one material, or all), each with its current state, and the concepts per section. */
export async function listMappings(admin: Admin, userId: string, materialId?: string | null): Promise<Read<{ mappings: MappingRow[]; concepts: Map<string, string[]> }>> {
  let m = admin.from("individual_scholar_competency_map")
    .select("id, chunk_id, material_id, competency_id, layer, source, confidence, rationale, model, prompt_version, created_at").eq("user_id", userId);
  let a = admin.from("individual_scholar_chunk_analysis").select("chunk_id, concepts").eq("user_id", userId);
  if (materialId) { m = m.eq("material_id", materialId); a = a.eq("material_id", materialId); }
  const [maps, analysis] = await Promise.all([m.order("created_at").limit(5000), a.limit(5000)]);
  const err = maps.error ?? analysis.error;
  if (err) return fail(err);
  const ids = ((maps.data ?? []) as any[]).map(r => r.id);
  let decisions: MappingDecision[] = [];
  if (ids.length) {
    const { data, error } = await admin.from("individual_scholar_competency_decision").select("map_id, decision, decided_by, created_at")
      .eq("user_id", userId).in("map_id", ids).order("created_at").limit(20000);
    if (error) return fail(error);
    decisions = ((data ?? []) as any[]).map(d => ({ mappingId: d.map_id, decision: d.decision, decidedBy: d.decided_by, createdAt: d.created_at }));
  }
  const states = mappingStates(decisions);
  return {
    ok: true,
    data: {
      mappings: ((maps.data ?? []) as any[]).map(r => {
        const s = states.get(r.id);
        return {
          id: r.id, chunkId: r.chunk_id, materialId: r.material_id, competencyId: r.competency_id, layer: r.layer, source: r.source,
          confidence: r.confidence === null ? null : Number(r.confidence), rationale: r.rationale, model: r.model, promptVersion: r.prompt_version,
          createdAt: r.created_at, state: s?.state ?? "proposed", decidedBy: (s?.decidedBy as "student" | "reviewer" | undefined) ?? null, decisions: s?.history ?? 0,
        };
      }),
      concepts: new Map(((analysis.data ?? []) as any[]).map(r => [r.chunk_id, r.concepts ?? []])),
    },
  };
}

/** The current mappings of one section, for choosing the competency a question practises. [] when unreadable. */
export async function chunkMappings(admin: Admin, userId: string, chunkId: string): Promise<LiveMapping[]> {
  if (!isUuid(chunkId)) return [];
  const { data, error } = await admin.from("individual_scholar_competency_map").select("id, competency_id, source, confidence")
    .eq("user_id", userId).eq("chunk_id", chunkId).limit(50);
  if (error || !data?.length) return [];
  const { data: d, error: dErr } = await admin.from("individual_scholar_competency_decision").select("map_id, decision, decided_by, created_at")
    .eq("user_id", userId).in("map_id", (data as any[]).map(r => r.id)).limit(2000);
  if (dErr) return [];
  const states = mappingStates(((d ?? []) as any[]).map(x => ({ mappingId: x.map_id, decision: x.decision, decidedBy: x.decided_by, createdAt: x.created_at })));
  return (data as any[]).map(r => ({
    competencyId: r.competency_id, byPerson: r.source !== "ai", confidence: r.confidence === null ? null : Number(r.confidence),
    state: states.get(r.id)?.state ?? "proposed",
  }));
}

/** Accept or reject one of the person's own mappings: a new decision row, never an edit. */
export async function decideMapping(admin: Admin, userId: string, mapId: string, decision: "accepted" | "rejected", reason: string | null): Promise<"ok" | "not_found" | "failed"> {
  if (!isUuid(mapId)) return "not_found";
  const { data, error } = await admin.from("individual_scholar_competency_map").select("id").eq("user_id", userId).eq("id", mapId).maybeSingle();
  if (error) return "failed";
  if (!data) return "not_found";
  const { error: iErr } = await admin.from("individual_scholar_competency_decision")
    .insert({ user_id: userId, map_id: mapId, decision, decided_by: "student", reason });
  return iErr ? "failed" : "ok";
}

/**
 * The person links a section to a competency the AI did not propose. It is their own mapping (source
 * student, no model or confidence) and their acceptance of it is recorded at once, as a decision row.
 * The caller has already checked the competency is in the person's programme.
 */
export async function addMapping(admin: Admin, userId: string, input: { chunkId: string; competencyId: string; layer: Layer; programmeCode: string | null }): Promise<"ok" | "exists" | "not_found" | "failed"> {
  if (!isUuid(input.chunkId)) return "not_found";
  const { data: c, error } = await admin.from("individual_scholar_chunk").select("id, material_id").eq("user_id", userId).eq("id", input.chunkId).maybeSingle();
  if (error) return "failed";
  if (!c) return "not_found";
  const { data: m, error: mErr } = await admin.from("individual_scholar_competency_map").insert({
    user_id: userId, material_id: c.material_id, chunk_id: c.id, competency_id: input.competencyId, layer: input.layer,
    source: "student", programme_code: input.programmeCode,
  }).select("id").single();
  if (mErr) return mErr.code === "23505" ? "exists" : "failed";
  const { error: dErr } = await admin.from("individual_scholar_competency_decision")
    .insert({ user_id: userId, map_id: m.id, decision: "accepted", decided_by: "student", reason: null });
  return dErr ? "failed" : "ok";
}

/**
 * The competency each of the person's questions practises (388, individual_scholar_question.competency_id),
 * in the shape S5's CompetencyMappingSource.mappingsFor takes. A question tied to no competency is left out.
 * value null: 388 is not on this environment (not measured). { ok: false }: it could not be read.
 */
export async function questionCompetencies(admin: Admin, userId: string, questionIds: string[]): Promise<
  { ok: true; value: { questionId: string; competencyId: string }[] | null } | { ok: false }> {
  if (!questionIds.length) return { ok: true, value: [] };
  const { data, error } = await admin.from("individual_scholar_question").select("id, competency_id")
    .eq("user_id", userId).in("id", questionIds.slice(0, 5000)).not("competency_id", "is", null);
  if (error) return isNotProvisioned(error) ? { ok: true, value: null } : { ok: false };
  return { ok: true, value: ((data ?? []) as any[]).map(r => ({ questionId: r.id, competencyId: r.competency_id })) };
}

/**
 * ACCEPTED ONLY: question → competency, for the questions given, where the question's section is linked to that
 * competency by a mapping the person has ACCEPTED (latest decision). The rule progress by competency uses
 * (competency-progress.ts) and S5's coverage reads through COMPETENCY_SOURCES, so the two agree. value null:
 * 388 is not on this environment.
 */
export async function acceptedQuestionCompetencies(admin: Admin, userId: string, questionIds: readonly string[]): Promise<
  { ok: true; value: { questionId: string; competencyId: string }[] | null } | { ok: false }> {
  if (!questionIds.length) return { ok: true, value: [] };
  const { data, error } = await admin.from("individual_scholar_question").select("id, chunk_id, competency_id")
    .eq("user_id", userId).in("id", questionIds.slice(0, 5000)).not("competency_id", "is", null);
  if (error) return isNotProvisioned(error) ? { ok: true, value: null } : { ok: false };
  const maps = await listMappings(admin, userId);
  if (!maps.ok) return maps.notProvisioned ? { ok: true, value: null } : { ok: false };
  const accepted = new Set(maps.data.mappings.filter(m => m.state === "accepted").map(m => `${m.chunkId}|${m.competencyId}`));
  return {
    ok: true,
    value: ((data ?? []) as any[]).filter(r => accepted.has(`${r.chunk_id}|${r.competency_id}`)).map(r => ({ questionId: r.id, competencyId: r.competency_id })),
  };
}

/** The rows competency progress is built from. Ids, competencies and right-or-wrong only. */
export async function competencyProgressRows(admin: Admin, userId: string): Promise<Read<{
  mappings: MappingRow[]; questions: { id: string; chunkId: string; competencyId: string | null }[]; attempts: ProgressAttempt[];
}>> {
  const maps = await listMappings(admin, userId);
  if (!maps.ok) return maps;
  const [q, a] = await Promise.all([
    admin.from("individual_scholar_question").select("id, chunk_id, competency_id").eq("user_id", userId).limit(5000),
    admin.from("individual_scholar_attempt").select("question_id, correct, answered_at").eq("user_id", userId).order("answered_at", { ascending: false }).limit(10000),
  ]);
  const err = q.error ?? a.error;
  if (err) return fail(err);
  return {
    ok: true,
    data: {
      mappings: maps.data.mappings,
      questions: ((q.data ?? []) as any[]).map(r => ({ id: r.id, chunkId: r.chunk_id, competencyId: r.competency_id ?? null })),
      attempts: ((a.data ?? []) as any[]).map(r => ({ questionId: r.question_id, correct: r.correct, answeredAt: r.answered_at })),
    },
  };
}

// ── PASSPORT: THE ACHIEVEMENTS THE PERSON CHOSE TO SHOW (migration 375) ──────────────────────────────
//
// The row is the choice (passport-items.ts). Including writes one row, removing deletes that one row, and
// neither touches a material, question, answer or card. What the Passport shows is derived from the
// answers at render time, reading only which question was answered and when -- never the material text,
// a question, the option chosen or whether it was right.

export async function listPassportChoices(admin: Admin, userId: string): Promise<Read<ChoiceRow[]>> {
  const { data, error } = await admin.from("individual_scholar_passport_item").select("material_id, achievement, label, included_at")
    .eq("user_id", userId).order("included_at", { ascending: false }).limit(200);
  if (error) return fail(error);
  return {
    ok: true,
    data: ((data ?? []) as any[]).filter(r => isStudyAchievementKind(r.achievement))
      .map(r => ({ materialId: r.material_id, achievement: r.achievement, label: r.label, includedAt: r.included_at })),
  };
}

/** How many distinct questions of this kind the person answered from this material of their own -- or, for revision, how many reviews they made on it. */
async function answeredFrom(admin: Admin, userId: string, materialId: string, achievement: StudyAchievementKind): Promise<number | null> {
  const questionKind = STUDY_ACHIEVEMENT[achievement].questionKind;
  if (questionKind === null) {
    const { count, error } = await admin.from("individual_scholar_review").select("id", { count: "exact" })
      .eq("user_id", userId).eq("material_id", materialId).limit(1);
    return error ? null : (count ?? 0);
  }
  const { data: qs, error } = await admin.from("individual_scholar_question").select("id")
    .eq("user_id", userId).eq("material_id", materialId).eq("kind", questionKind).limit(5000);
  if (error) return null;
  const ids = ((qs ?? []) as any[]).map(q => q.id);
  if (!ids.length) return 0;
  const { data: at, error: aErr } = await admin.from("individual_scholar_attempt").select("question_id")
    .eq("user_id", userId).in("question_id", ids).limit(10000);
  if (aErr) return null;
  return new Set(((at ?? []) as any[]).map(a => a.question_id)).size;
}

/**
 * Show one achievement in the Passport. Refused unless the person has earned it: the material is theirs
 * (the 375 composite key would refuse it anyway) and they have answered at least one question of that kind
 * from it. Choosing again updates the label.
 */
export async function includeInPassport(admin: Admin, userId: string, input: { materialId: string; achievement: StudyAchievementKind; label: string }): Promise<"included" | "not_eligible" | "failed"> {
  if (!isUuid(input.materialId)) return "not_eligible";
  const answered = await answeredFrom(admin, userId, input.materialId, input.achievement);
  if (answered === null) return "failed";
  if (answered < 1) return "not_eligible";
  const { error } = await admin.from("individual_scholar_passport_item").upsert({
    user_id: userId, material_id: input.materialId, achievement: input.achievement, label: input.label, included_at: new Date().toISOString(),
  }, { onConflict: "user_id,material_id,achievement" });
  return error ? "failed" : "included";
}

/** Take one achievement off the Passport. Deletes that choice only. The study history is untouched. */
export async function removeFromPassport(admin: Admin, userId: string, materialId: string, achievement: StudyAchievementKind): Promise<{ ok: boolean; found: boolean }> {
  if (!isUuid(materialId)) return { ok: true, found: false };
  const { data, error } = await admin.from("individual_scholar_passport_item").delete()
    .eq("user_id", userId).eq("material_id", materialId).eq("achievement", achievement).select("id");
  if (error) return { ok: false, found: false };
  return { ok: true, found: ((data ?? []) as any[]).length > 0 };
}

/**
 * The chosen achievements with their figures, for the Passport and for /verify. Read fresh on every
 * render, so a removal reaches every live share link at once. Reads which question was answered and
 * when, and nothing else.
 */
export async function loadStudyAchievements(admin: Admin, userId: string): Promise<Read<StudyAchievement[]>> {
  const choices = await listPassportChoices(admin, userId);
  if (!choices.ok) return choices;
  if (!choices.data.length) return { ok: true, data: [] };
  const materialIds = [...new Set(choices.data.map(c => c.materialId))];
  const { data: qs, error } = await admin.from("individual_scholar_question").select("id, material_id, kind")
    .eq("user_id", userId).in("material_id", materialIds).limit(5000);
  if (error) return fail(error);
  const questions = ((qs ?? []) as any[]).map(q => ({ id: q.id, materialId: q.material_id, kind: q.kind }));
  const ids = questions.map(q => q.id);
  let attempts: { questionId: string; answeredAt: string }[] = [];
  if (ids.length) {
    const { data: at, error: aErr } = await admin.from("individual_scholar_attempt").select("question_id, answered_at")
      .eq("user_id", userId).in("question_id", ids).limit(10000);
    if (aErr) return fail(aErr);
    attempts = ((at ?? []) as any[]).map(a => ({ questionId: a.question_id, answeredAt: a.answered_at }));
  }
  // Revision achievements (migration 391) read only which material was reviewed and when -- never the grade.
  // Only asked when one is chosen, so a Passport without one never depends on the review table existing.
  let reviews: { materialId: string; reviewedAt: string }[] = [];
  const revisionMaterials = [...new Set(choices.data.filter(c => c.achievement === "revision_reviews").map(c => c.materialId))];
  if (revisionMaterials.length) {
    const { data: rv, error: rErr } = await admin.from("individual_scholar_review").select("material_id, reviewed_at")
      .eq("user_id", userId).in("material_id", revisionMaterials).limit(10000);
    if (rErr) return fail(rErr);
    reviews = ((rv ?? []) as any[]).map(r => ({ materialId: r.material_id, reviewedAt: r.reviewed_at }));
  }
  return { ok: true, data: studyAchievementsFrom({ choices: choices.data, questions, attempts, reviews }) };
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
