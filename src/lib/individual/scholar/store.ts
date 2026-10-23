/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { sm2 } from "@/lib/delivery/reinforcement";
import { isNotProvisioned } from "../access";
import { BUCKET, CONSENT_FEATURE, CONSENT_NOTICE_VERSION, MAX_MATERIALS_PER_PERSON, type MaterialMime } from "./config";
import type { Chunk } from "./extract";
import type { CandidateChunk } from "./retrieval";
import type { DraftQuestion, Passage, QuestionKind } from "./generation";
import type { ProgressAttempt, ProgressCard, ProgressMaterial, ProgressQuestion } from "./progress";

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
  `${userId}/${uploadId}.${mime === "application/pdf" ? "pdf" : "docx"}`;

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
};

const QUESTION_COLS = "id, material_id, chunk_id, kind, stem, options, correct_index, rationale, source_quote, model, prompt_version, created_at";

export async function insertQuestions(admin: Admin, userId: string, input: {
  passage: Passage; kind: QuestionKind; drafts: DraftQuestion[]; model: string; provider: string; promptVersion: string;
}): Promise<{ ok: boolean; ids: string[] }> {
  if (!input.drafts.length) return { ok: true, ids: [] };
  const { data, error } = await admin.from("individual_scholar_question").insert(input.drafts.map(d => ({
    user_id: userId, material_id: input.passage.materialId, chunk_id: input.passage.chunkId, kind: input.kind,
    stem: d.stem, options: d.options, correct_index: d.correctIndex, rationale: d.rationale, source_quote: d.sourceQuote,
    model: input.model, provider: input.provider, prompt_version: input.promptVersion,
  }))).select("id");
  if (error) return { ok: false, ids: [] };
  return { ok: true, ids: ((data ?? []) as any[]).map(r => r.id) };
}

async function hydrate(admin: Admin, userId: string, rows: any[]): Promise<QuestionRow[]> {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [titles, chunksRes, attRes] = await Promise.all([
    titlesOf(admin, userId, [...new Set(rows.map(r => r.material_id as string))]),
    admin.from("individual_scholar_chunk").select("id, ordinal, page_from, page_to").eq("user_id", userId).in("id", [...new Set(rows.map(r => r.chunk_id as string))]),
    admin.from("individual_scholar_attempt").select("question_id, correct, chosen_index, answered_at").eq("user_id", userId).in("question_id", ids).order("answered_at", { ascending: false }),
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
    };
  });
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
  const { data: card } = await admin.from("individual_scholar_card").select("id, ease_factor, interval_days, repetitions, reviews")
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
  return { ok: true as const, nextReviewAt: nextDate, intervalDays: next.interval, status };
}

// ── IMPROVE: THE ROWS PROGRESS IS BUILT FROM ───────────────────────────────────────────────────────

export async function progressRows(admin: Admin, userId: string): Promise<Read<{
  materials: ProgressMaterial[]; questions: ProgressQuestion[]; attempts: ProgressAttempt[]; cards: ProgressCard[];
}>> {
  const [m, q, a, c] = await Promise.all([
    admin.from("individual_scholar_material").select("id, title").eq("user_id", userId).order("created_at", { ascending: false }),
    admin.from("individual_scholar_question").select("id, material_id, kind").eq("user_id", userId).limit(5000),
    admin.from("individual_scholar_attempt").select("question_id, correct, answered_at").eq("user_id", userId).order("answered_at", { ascending: false }).limit(10000),
    admin.from("individual_scholar_card").select("material_id, status, next_review_at").eq("user_id", userId).limit(5000),
  ]);
  const err = m.error ?? q.error ?? a.error ?? c.error;
  if (err) return fail(err);
  return {
    ok: true,
    data: {
      materials: (m.data ?? []).map((r: any) => ({ id: r.id, title: r.title })),
      questions: (q.data ?? []).map((r: any) => ({ id: r.id, materialId: r.material_id, kind: r.kind })),
      attempts: (a.data ?? []).map((r: any) => ({ questionId: r.question_id, correct: r.correct, answeredAt: r.answered_at })),
      cards: (c.data ?? []).map((r: any) => ({ materialId: r.material_id, status: r.status, nextReviewAt: r.next_review_at })),
    },
  };
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
