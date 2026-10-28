/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { sm2 } from "@/lib/delivery/reinforcement";
import { isNotProvisioned } from "../access";
import { BUCKET, CONSENT_FEATURE, CONSENT_NOTICE_VERSION, MAX_MATERIALS_PER_PERSON, PPTX_MIME, UNIT_OF, type MaterialMime } from "./config";
import type { Chunk, ExtractionQuality } from "./extract";
import type { CandidateChunk } from "./retrieval";
import type { DraftQuestion, Passage, QuestionKind } from "./generation";
import { SRS_DEFAULTS, scheduleReview, type RevisionDraft, type RevisionKind, type SrsParams } from "./revision";
import type { ProgressAttempt, ProgressCard, ProgressMaterial, ProgressQuestion } from "./progress";
import { isLayer, type Layer, type ProgrammeConfig } from "./catalogue";
import { mappingStates, type LiveMapping, type MappingDecision, type MappingState, type MappingSubject, type SubjectAnalysis } from "@/lib/competency/mapping";

export type MapSource = "ai" | "student" | "reviewer";
import { STUDY_ACHIEVEMENT, isStudyAchievementKind, studyAchievementsFrom, type ChoiceRow, type StudyAchievement, type StudyAchievementKind } from "./passport-items";
import { passportEvaluationOf, type PassportEvaluation } from "./passport-evaluations";
import type { ExamOption, PaperFlag, ParsedQuestion, QuestionFlag } from "./exam-paper";
import type { ResearchSource } from "./exam-research";

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

/**
 * The person's own materials kept since `sinceIso` (an upload session): how many, and their combined size.
 * ⚠ The window start is the app's clock compared with created_at. That is a rate window, not a decision about
 * whether a grant is live: a few seconds of skew moves the edge of an hour, nothing more.
 */
export async function recentUploads(admin: Admin, userId: string, sinceIso: string): Promise<{ count: number; bytes: number } | null> {
  const { data, error } = await admin.from("individual_scholar_material").select("byte_size").eq("user_id", userId).gte("created_at", sinceIso).limit(1000);
  if (error) return null;
  return { count: (data ?? []).length, bytes: ((data ?? []) as any[]).reduce((n, r) => n + Number(r.byte_size ?? 0), 0) };
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
  `${userId}/${uploadId}.${mime === "application/pdf" ? "pdf" : mime === "text/plain" ? "txt" : mime === PPTX_MIME ? "pptx" : "docx"}`;

/** UPLOAD-01 U1: the hex sha256 of an upload, the duplicate key (migration 409 makes it unique per person). */
export const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** The person's own material with exactly these bytes, if any. */
export async function findDuplicate(admin: Admin, userId: string, sha256: string): Promise<{ id: string; title: string } | null> {
  const { data } = await admin.from("individual_scholar_material").select("id, title").eq("user_id", userId).eq("sha256", sha256).limit(1).maybeSingle();
  return data ? { id: data.id, title: data.title } : null;
}

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
  /** UPLOAD-01 U2 (migration 406). Where 406 is absent the row is stored without it: quality "not measured". */
  quality?: ExtractionQuality | null;
}): Promise<{ ok: true; id: string; qualityStored: boolean } | { ok: false; error: string; detail?: string }> {
  const { id, path } = input;
  const row = {
    id, user_id: userId, title: input.title, file_name: input.fileName.slice(0, 255), mime_type: input.mime,
    byte_size: input.bytes.byteLength, sha256: sha256Hex(input.bytes),
    storage_path: path, page_count: input.pageCount, chunk_count: input.chunks.length,
    char_count: input.chunks.reduce((n, c) => n + c.content.length, 0), extractor: input.extractor,
    pii_attested_at: new Date().toISOString(),
  };
  let qualityStored = !!input.quality;
  let { error: mErr } = await admin.from("individual_scholar_material")
    .insert({ ...row, user_id: userId, ...(input.quality ? { extraction_quality: toQualityJson(input.quality) } : {}) });
  if (mErr && input.quality && isNotProvisioned(mErr)) {
    qualityStored = false;
    ({ error: mErr } = await admin.from("individual_scholar_material").insert({ ...row, user_id: userId }));
  }
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
  return { ok: true, id, qualityStored };
}

/** The stored shape (migration 406's CHECK names these keys). */
const toQualityJson = (q: ExtractionQuality) => ({ unit: q.unit, units: q.units, empty_units: q.emptyUnits, chars: q.chars, sections: q.sections });
export const fromQualityJson = (j: any): ExtractionQuality | null =>
  j && typeof j === "object" && Array.isArray(j.empty_units)
    ? { unit: j.unit, units: Number(j.units), emptyUnits: (j.empty_units as unknown[]).map(Number), chars: Number(j.chars), sections: Number(j.sections) }
    : null;

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
  // LEARN-01 L4: the deleted material's steps and sources went with it (414 cascades); a session left with nothing to
  // teach goes too.
  if (!dErr) await pruneEmptySessions(admin, userId);
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
  if (dErr) return { ok: false, erased: 0 };
  // UPLOAD-01 U5 (407): the shelves go too -- erase-all leaves nothing of the library. Absent table: nothing to do.
  const { error: cErr } = await admin.from("individual_scholar_collection").delete().eq("user_id", userId);
  // LEARN-01 L4: learning history and preferences go too. Absent tables (414): nothing to do.
  const { error: lErr } = await admin.from("individual_scholar_learning_session").delete().eq("user_id", userId);
  const { error: pErr } = await admin.from("individual_scholar_learning_preference").delete().eq("user_id", userId);
  // REVISION-01 (417): saved sets and revision sessions go too. Their items went with the questions; these are the
  // shells. Absent tables: nothing to do.
  const { error: rsErr } = await admin.from("individual_scholar_revision_session").delete().eq("user_id", userId);
  const { error: rtErr } = await admin.from("individual_scholar_revision_set").delete().eq("user_id", userId);
  // EVALUATION-01 (426): the evaluations go too. Absent table: nothing to do.
  const { error: evErr } = await admin.from("individual_scholar_evaluation").delete().eq("user_id", userId);
  const fine = (e: any) => !e || isNotProvisioned(e);
  return { ok: fine(cErr) && fine(lErr) && fine(pErr) && fine(rsErr) && fine(rtErr) && fine(evErr), erased: rows.length };
}

// ── UPLOAD-01 U5: THE LIBRARY -- QUALITY, RENAMING AND COLLECTIONS (406, 407) ───────────────────────────

/**
 * Per material: how completely it was read (406) and its collection (407). Read apart from the 372 columns so
 * that an absent migration costs only its own feature. `qualityOn`/`collectionsOn` false: that migration is
 * absent here. A material with quality null was uploaded before quality was measured.
 */
export async function materialExtras(admin: Admin, userId: string, ids: string[]): Promise<{
  qualityOn: boolean; collectionsOn: boolean; byId: Map<string, { quality: ExtractionQuality | null; collectionId: string | null }>;
}> {
  const byId = new Map<string, { quality: ExtractionQuality | null; collectionId: string | null }>(ids.map(id => [id, { quality: null, collectionId: null }]));
  if (!ids.length) return { qualityOn: true, collectionsOn: true, byId };
  const [q, c] = await Promise.all([
    admin.from("individual_scholar_material").select("id, extraction_quality").eq("user_id", userId).in("id", ids),
    admin.from("individual_scholar_material").select("id, collection_id").eq("user_id", userId).in("id", ids),
  ]);
  for (const r of (q.error ? [] : q.data ?? []) as any[]) byId.get(r.id)!.quality = fromQualityJson(r.extraction_quality);
  for (const r of (c.error ? [] : c.data ?? []) as any[]) byId.get(r.id)!.collectionId = r.collection_id ?? null;
  return { qualityOn: !q.error, collectionsOn: !c.error, byId };
}

/** Rename one of the person's own materials. */
export async function renameMaterial(admin: Admin, userId: string, id: string, title: string): Promise<"ok" | "not_found" | "failed"> {
  if (!isUuid(id)) return "not_found";
  const { data, error } = await admin.from("individual_scholar_material").update({ title, updated_at: new Date().toISOString() })
    .eq("user_id", userId).eq("id", id).select("id");
  if (error) return "failed";
  return (data ?? []).length ? "ok" : "not_found";
}

export type CollectionRow = { id: string; name: string; createdAt: string };

export async function listCollections(admin: Admin, userId: string): Promise<Read<CollectionRow[]>> {
  const { data, error } = await admin.from("individual_scholar_collection").select("id, name, created_at").eq("user_id", userId).order("name").limit(200);
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(r => ({ id: r.id, name: r.name, createdAt: r.created_at })) };
}

export async function createCollection(admin: Admin, userId: string, name: string): Promise<{ ok: true; id: string } | { ok: false; error: "exists" | "not_provisioned" | "failed" }> {
  const { data, error } = await admin.from("individual_scholar_collection").insert({ user_id: userId, name }).select("id").single();
  if (error) return { ok: false, error: error.code === "23505" ? "exists" : isNotProvisioned(error) ? "not_provisioned" : "failed" };
  return { ok: true, id: data.id };
}

/** Delete one of the person's collections. Its materials are kept: they are taken off the shelf first. */
export async function deleteCollection(admin: Admin, userId: string, id: string): Promise<"ok" | "not_found" | "failed"> {
  if (!isUuid(id)) return "not_found";
  const { data, error } = await admin.from("individual_scholar_collection").select("id").eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) return "failed";
  if (!data) return "not_found";
  const { error: uErr } = await admin.from("individual_scholar_material").update({ collection_id: null }).eq("user_id", userId).eq("collection_id", id);
  if (uErr) return "failed";
  const { error: dErr } = await admin.from("individual_scholar_collection").delete().eq("user_id", userId).eq("id", id);
  return dErr ? "failed" : "ok";
}

/**
 * Put one of the person's materials on one of their collections, or take it off (null). The composite foreign
 * key (407) makes another person's collection unstorable; the lookup here answers it as not found first.
 */
export async function fileMaterial(admin: Admin, userId: string, id: string, collectionId: string | null): Promise<"ok" | "not_found" | "failed"> {
  if (!isUuid(id) || (collectionId !== null && !isUuid(collectionId))) return "not_found";
  if (collectionId) {
    const { data, error } = await admin.from("individual_scholar_collection").select("id").eq("user_id", userId).eq("id", collectionId).maybeSingle();
    if (error) return "failed";
    if (!data) return "not_found";
  }
  const { data, error } = await admin.from("individual_scholar_material").update({ collection_id: collectionId })
    .eq("user_id", userId).eq("id", id).select("id");
  if (error) return "failed";
  return (data ?? []).length ? "ok" : "not_found";
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

type MaterialName = { title: string; unit: "page" | "slide" | "section" };
/** Each material's title and the name of its citable unit (UPLOAD-01: a PowerPoint's is the slide). */
async function titlesOf(admin: Admin, userId: string, ids: string[]): Promise<Map<string, MaterialName>> {
  if (!ids.length) return new Map();
  const { data } = await admin.from("individual_scholar_material").select("id, title, mime_type").eq("user_id", userId).in("id", ids);
  return new Map(((data ?? []) as any[]).map(r => [r.id, { title: r.title, unit: UNIT_OF(r.mime_type) }]));
}
const UNNAMED: MaterialName = { title: "Your material", unit: "page" };

export async function getPassage(admin: Admin, userId: string, chunkId: string): Promise<Passage | null> {
  if (!isUuid(chunkId)) return null;
  const { data } = await admin.from("individual_scholar_chunk").select("id, material_id, ordinal, page_from, page_to, content")
    .eq("user_id", userId).eq("id", chunkId).maybeSingle();
  if (!data) return null;
  const name = (await titlesOf(admin, userId, [data.material_id])).get(data.material_id) ?? UNNAMED;
  return {
    chunkId: data.id, materialId: data.material_id, materialTitle: name.title, unit: name.unit,
    ordinal: data.ordinal, pageFrom: data.page_from, pageTo: data.page_to, content: data.content,
  };
}

/**
 * FTS candidates from the person's OWN chunks: the whole library, one material, chosen materials, or chosen
 * sections (UPLOAD-01 U4). The tsquery is pre-sanitised. Every narrowing is on top of the user_id filter.
 */
export async function searchCandidates(admin: Admin, userId: string, tsquery: string,
  scope?: string | null | { materialIds?: readonly string[]; chunkIds?: readonly string[] }): Promise<Read<CandidateChunk[]>> {
  let q = admin.from("individual_scholar_chunk").select("id, material_id, ordinal, page_from, page_to, content")
    .eq("user_id", userId).textSearch("tsv", tsquery, { config: "english" });
  if (typeof scope === "string") q = q.eq("material_id", scope);
  else if (scope && typeof scope === "object") {
    if (scope.materialIds?.length) q = q.in("material_id", [...scope.materialIds]);
    if (scope.chunkIds) q = q.in("id", scope.chunkIds.length ? [...scope.chunkIds] : ["00000000-0000-0000-0000-000000000000"]);
  }
  const { data, error } = await q.limit(60);
  if (error) return fail(error);
  return { ok: true, data: (data ?? []).map(toCandidate) };
}

const toCandidate = (r: any): CandidateChunk => ({ id: r.id, materialId: r.material_id, ordinal: r.ordinal, pageFrom: r.page_from, pageTo: r.page_to, content: r.content });

/**
 * UPLOAD-01 U4: the person's own sections linked to one competency -- accepted links first, then suggestions by
 * confidence. A rejected link is not a link. [] where nothing is linked (or 388 is absent): never a guess.
 */
export async function competencyChunks(admin: Admin, userId: string, competencyId: string, limit = 40): Promise<Read<CandidateChunk[]>> {
  if (!isUuid(competencyId)) return { ok: true, data: [] };
  const { data: maps, error } = await admin.from("individual_scholar_competency_map").select("id, chunk_id, confidence, source")
    .eq("user_id", userId).eq("competency_id", competencyId).limit(500);
  if (error) return isNotProvisioned(error) ? { ok: true, data: [] } : fail(error);
  if (!maps?.length) return { ok: true, data: [] };
  const { data: d, error: dErr } = await admin.from("individual_scholar_competency_decision").select("map_id, decision, decided_by, created_at")
    .eq("user_id", userId).in("map_id", (maps as any[]).map(m => m.id)).limit(5000);
  if (dErr) return fail(dErr);
  const states = mappingStates(((d ?? []) as any[]).map(x => ({ mappingId: x.map_id, decision: x.decision, decidedBy: x.decided_by, createdAt: x.created_at })));
  const live = (maps as any[]).map(m => ({ chunkId: m.chunk_id as string, state: states.get(m.id)?.state ?? "proposed", confidence: m.source === "ai" ? Number(m.confidence ?? 0) : 1 }))
    .filter(m => m.state !== "rejected")
    .sort((a, b) => (a.state === "accepted" ? 0 : 1) - (b.state === "accepted" ? 0 : 1) || b.confidence - a.confidence)
    .slice(0, limit);
  if (!live.length) return { ok: true, data: [] };
  const { data: chunks, error: cErr } = await admin.from("individual_scholar_chunk").select("id, material_id, ordinal, page_from, page_to, content")
    .eq("user_id", userId).in("id", live.map(m => m.chunkId));
  if (cErr) return fail(cErr);
  const byId = new Map(((chunks ?? []) as any[]).map(r => [r.id, toCandidate(r)]));
  return { ok: true, data: live.map(m => byId.get(m.chunkId)).filter((c): c is CandidateChunk => !!c) };
}

export async function toPassages(admin: Admin, userId: string, chunks: CandidateChunk[]): Promise<Passage[]> {
  const titles = await titlesOf(admin, userId, [...new Set(chunks.map(c => c.materialId))]);
  return chunks.map(c => {
    const name = titles.get(c.materialId) ?? UNNAMED;
    return { chunkId: c.id, materialId: c.materialId, materialTitle: name.title, unit: name.unit, ordinal: c.ordinal, pageFrom: c.pageFrom, pageTo: c.pageTo, content: c.content };
  });
}

// ── QUESTIONS AND ATTEMPTS ─────────────────────────────────────────────────────────────────────────

export type QuestionRow = {
  id: string; materialId: string; chunkId: string; kind: RevisionKind; stem: string; options: string[];
  /** The key of mcq and case. Null for the 416 kinds, whose key is `answer`. */
  correctIndex: number | null; rationale: string; sourceQuote: string; model: string; promptVersion: string; createdAt: string;
  /** REVISION-01 (416): the key of the other kinds, and the difficulty (1-3). Null where 416 is absent or unrecorded. */
  answer: unknown; difficulty: number | null;
  materialTitle: string; ordinal: number | null; pageFrom: number | null; pageTo: number | null;
  /** UPLOAD-01: the material's citable unit, so a question from a PowerPoint cites its slide. */
  unit: "page" | "slide" | "section";
  latest: { correct: boolean; chosenIndex: number | null; answeredAt: string } | null;
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
  const [titles, chunksRes, attRes, extra, revision] = await Promise.all([
    titlesOf(admin, userId, [...new Set(rows.map(r => r.material_id as string))]),
    admin.from("individual_scholar_chunk").select("id, ordinal, page_from, page_to").eq("user_id", userId).in("id", [...new Set(rows.map(r => r.chunk_id as string))]),
    admin.from("individual_scholar_attempt").select("question_id, correct, chosen_index, answered_at").eq("user_id", userId).in("question_id", ids).order("answered_at", { ascending: false }),
    questionExtras(admin, userId, ids),
    revisionExtras(admin, userId, ids),
  ]);
  const chunk = new Map(((chunksRes.data ?? []) as any[]).map(c => [c.id, c]));
  const latest = new Map<string, any>();
  for (const a of (attRes.data ?? []) as any[]) if (!latest.has(a.question_id)) latest.set(a.question_id, a);
  return rows.map(r => {
    const c = chunk.get(r.chunk_id);
    const l = latest.get(r.id);
    return {
      id: r.id, materialId: r.material_id, chunkId: r.chunk_id, kind: r.kind, stem: r.stem, options: r.options,
      correctIndex: r.correct_index ?? null, rationale: r.rationale, sourceQuote: r.source_quote, model: r.model,
      answer: revision.get(r.id)?.answer ?? null, difficulty: revision.get(r.id)?.difficulty ?? null,
      promptVersion: r.prompt_version, createdAt: r.created_at, materialTitle: (titles.get(r.material_id) ?? UNNAMED).title,
      unit: (titles.get(r.material_id) ?? UNNAMED).unit,
      ordinal: c?.ordinal ?? null, pageFrom: c?.page_from ?? null, pageTo: c?.page_to ?? null,
      latest: l ? { correct: l.correct, chosenIndex: l.chosen_index, answeredAt: l.answered_at } : null,
      competencyId: extra.get(r.id)?.competency_id ?? null, caseId: extra.get(r.id)?.case_id ?? null,
      caseStep: extra.get(r.id)?.case_step ?? null, caseTitle: extra.get(r.id)?.case_title ?? null,
    };
  });
}

/** The 416 columns, read apart likewise: where 416 is absent there are none, and only mcq and case exist. */
async function revisionExtras(admin: Admin, userId: string, ids: string[]): Promise<Map<string, { answer: unknown; difficulty: number | null }>> {
  if (!ids.length) return new Map();
  const { data, error } = await admin.from("individual_scholar_question").select("id, answer, difficulty").eq("user_id", userId).in("id", ids);
  if (error) return new Map();
  return new Map(((data ?? []) as any[]).map(r => [r.id, { answer: r.answer ?? null, difficulty: r.difficulty ?? null }]));
}

/** The 388 columns, read apart from the 372 ones so that their absence costs nothing but themselves. */
async function questionExtras(admin: Admin, userId: string, ids: string[]): Promise<Map<string, any>> {
  if (!ids.length) return new Map();
  const { data, error } = await admin.from("individual_scholar_question").select("id, competency_id, case_id, case_step, case_title")
    .eq("user_id", userId).in("id", ids);
  if (error) return new Map();
  return new Map(((data ?? []) as any[]).map(r => [r.id, r]));
}

/**
 * Practice questions and cases (372 kinds). REVISION-01: the 416 kinds are Revision's and are read through
 * revisionPool, so the practice and Apply surfaces, which render four options and one key, never receive them.
 */
export async function listQuestions(admin: Admin, userId: string, opts: { materialId?: string; kind?: QuestionKind } = {}): Promise<Read<QuestionRow[]>> {
  let q = admin.from("individual_scholar_question").select(QUESTION_COLS).eq("user_id", userId);
  if (opts.materialId) q = q.eq("material_id", opts.materialId);
  q = opts.kind ? q.eq("kind", opts.kind) : q.in("kind", ["mcq", "case"]);
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

/**
 * The learner self-grades recall 0..5. SM-2 (imported) reschedules, within the policy's bounds (REVISION-01 R3,
 * revision.ts scheduleReview; the defaults are exactly the earlier rule). Owner-keyed.
 */
export async function reviewCard(admin: Admin, userId: string, cardId: string, quality: number, params: SrsParams = SRS_DEFAULTS) {
  if (!isUuid(cardId)) return { ok: false as const, error: "not_found" };
  const { data: card } = await admin.from("individual_scholar_card").select("id, question_id, material_id, ease_factor, interval_days, repetitions, reviews")
    .eq("user_id", userId).eq("id", cardId).maybeSingle();
  if (!card) return { ok: false as const, error: "not_found" };
  const difficulty = (await revisionExtras(admin, userId, [card.question_id])).get(card.question_id)?.difficulty ?? null;
  const next = scheduleReview({ ease: Number(card.ease_factor ?? 2.5), interval: card.interval_days ?? 0, reps: card.repetitions ?? 0 }, quality, difficulty, params);
  const nextDate = new Date(Date.now() + next.interval * 864e5).toISOString().slice(0, 10);
  // The mastery rule reinforcement.ts applies to its own cards, with the policy's thresholds (five and sixty by default).
  const status = next.status;
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

// ── REVISION ── COMPETEN-SCHOLAR-REVISION-01, migrations 416 and 417 ───────────────────────────────────────────────
//
// The revision questions ARE individual_scholar_question rows (416 kinds), their answers attempts, their schedule the
// 372 card and the 391 log. A session (417) is which questions in what order and where the student is; its answers
// are the attempts that name it. Every statement is keyed on the caller's user id. Where 416 or 417 is absent the
// reads say not provisioned and the workspace offers what exists without them.

export type PoolStats = { misses: number; latestCorrect: boolean | null; lastAnsweredAt: string | null; due: boolean };

/** Questions of the chosen kinds within some sections (or the whole library when none are named), with their stats. */
export async function revisionPool(admin: Admin, userId: string, opts: { chunkIds?: readonly string[] | null; kinds: readonly RevisionKind[] }): Promise<Read<{ questions: QuestionRow[]; stats: Map<string, PoolStats> }>> {
  if (!opts.kinds.length || (opts.chunkIds && !opts.chunkIds.length)) return { ok: true, data: { questions: [], stats: new Map() } };
  let q = admin.from("individual_scholar_question").select(QUESTION_COLS).eq("user_id", userId).in("kind", [...opts.kinds]);
  if (opts.chunkIds) q = q.in("chunk_id", [...opts.chunkIds].slice(0, 200));
  const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
  if (error) return fail(error);
  const questions = await hydrate(admin, userId, data ?? []);
  const ids = questions.map(x => x.id);
  const stats = new Map<string, PoolStats>(ids.map(id => [id, { misses: 0, latestCorrect: null, lastAnsweredAt: null, due: false }]));
  if (ids.length) {
    const [att, cards] = await Promise.all([
      admin.from("individual_scholar_attempt").select("question_id, correct, answered_at").eq("user_id", userId).in("question_id", ids).order("answered_at", { ascending: false }).limit(5000),
      admin.from("individual_scholar_card").select("question_id, next_review_at, status").eq("user_id", userId).in("question_id", ids),
    ]);
    for (const a of (att.data ?? []) as any[]) {
      const s = stats.get(a.question_id)!;
      if (s.lastAnsweredAt === null) { s.lastAnsweredAt = a.answered_at; s.latestCorrect = a.correct; }
      if (!a.correct) s.misses++;
    }
    for (const c of (cards.data ?? []) as any[]) if (c.status === "active" && c.next_review_at <= todayIso()) stats.get(c.question_id)!.due = true;
  }
  return { ok: true, data: { questions, stats } };
}

/**
 * New revision questions of a 416 kind from one passage. private_formative only (416 refuses anything else). A
 * flashcard gets its spaced-review card at once, due today: recall is what it is for.
 */
export async function insertRevisionQuestions(admin: Admin, userId: string, input: {
  passage: Passage; kind: Exclude<RevisionKind, "mcq" | "case">; drafts: RevisionDraft[]; model: string; provider: string; promptVersion: string; competencyId?: string | null;
}): Promise<{ ok: boolean; ids: string[]; notProvisioned?: boolean }> {
  if (!input.drafts.length) return { ok: true, ids: [] };
  const { data, error } = await admin.from("individual_scholar_question").insert(input.drafts.map(d => ({
    user_id: userId, material_id: input.passage.materialId, chunk_id: input.passage.chunkId, kind: input.kind,
    stem: d.stem, options: d.options, correct_index: null, answer: d.answer, difficulty: d.difficulty, review_status: "private_formative",
    rationale: d.rationale, source_quote: d.sourceQuote, model: input.model, provider: input.provider, prompt_version: input.promptVersion,
    ...(input.competencyId ? { competency_id: input.competencyId } : {}),
  }))).select("id");
  if (error) return { ok: false, ids: [], notProvisioned: isNotProvisioned(error) || /check constraint|column/i.test(String((error as any)?.message ?? "")) };
  const ids = ((data ?? []) as any[]).map(r => r.id as string);
  if (input.kind === "flashcard" && ids.length)
    await admin.from("individual_scholar_card").insert(ids.map(id => ({ user_id: userId, question_id: id, material_id: input.passage.materialId, next_review_at: todayIso(), status: "active" })))
      .then((r: unknown) => r, () => {});
  return { ok: true, ids };
}

/** A missed question's card: created due today, or put back to the start of its schedule by SM-2 itself (a lapse). */
async function missCard(admin: Admin, userId: string, q: QuestionRow): Promise<"created" | "reset" | null> {
  const { data: existing } = await admin.from("individual_scholar_card").select("id, ease_factor, interval_days, repetitions")
    .eq("user_id", userId).eq("question_id", q.id).maybeSingle();
  if (!existing) {
    const { error } = await admin.from("individual_scholar_card").insert({ user_id: userId, question_id: q.id, material_id: q.materialId, next_review_at: todayIso(), status: "active" });
    return error ? null : "created";
  }
  const next = sm2({ ease: Number(existing.ease_factor ?? 2.5), interval: existing.interval_days ?? 0, reps: existing.repetitions ?? 0 }, 1);
  const { error } = await admin.from("individual_scholar_card").update({
    ease_factor: next.ease, interval_days: next.interval, repetitions: next.reps, status: "active", next_review_at: todayIso(), updated_at: new Date().toISOString(),
  }).eq("user_id", userId).eq("id", existing.id);
  return error ? null : "reset";
}

/**
 * One revision answer, as an attempt (416 columns, 417 session). A flashcard's answer is its recall grade, which
 * reschedules its card through reviewCard (and the 391 log). Any other missed answer makes or resets a card.
 */
export async function recordRevisionAttempt(admin: Admin, userId: string, q: QuestionRow, a: {
  chosenIndex: number | null; response: Record<string, unknown> | null; correct: boolean; score: number | null;
  marking: "deterministic" | "self_graded" | "ai_evaluation"; evaluator?: { model: string; promptVersion: string } | null; sessionId: string | null;
  quality?: number | null; srs?: SrsParams;
}): Promise<{ ok: boolean; card: "created" | "reset" | "reviewed" | null; nextReviewAt?: string }> {
  const { error } = await admin.from("individual_scholar_attempt").insert({
    user_id: userId, question_id: q.id, chosen_index: a.chosenIndex, response: a.response, correct: a.correct, score: a.score,
    marking: a.marking, evaluator_model: a.evaluator?.model ?? null, evaluator_prompt_version: a.evaluator?.promptVersion ?? null,
    revision_session_id: a.sessionId,
  });
  if (error) return { ok: false, card: null };
  // A flashcard's answer IS its recall grade. Any other question whose card is due is reviewed by the answer: right is
  // a good recall (4), wrong a lapse (1). Otherwise a missed answer makes or resets its card, as practice always has.
  const { data: card } = await admin.from("individual_scholar_card").select("id, next_review_at, status").eq("user_id", userId).eq("question_id", q.id).maybeSingle();
  const quality = q.kind === "flashcard" ? a.quality ?? null : card && card.status === "active" && card.next_review_at <= todayIso() ? (a.correct ? 4 : 1) : null;
  if (card && quality !== null) {
    const r = await reviewCard(admin, userId, card.id, quality, a.srs);
    return { ok: true, card: r.ok ? "reviewed" : null, nextReviewAt: r.ok ? r.nextReviewAt : undefined };
  }
  if (a.correct) return { ok: true, card: null };
  return { ok: true, card: await missCard(admin, userId, q) };
}

export type RevisionSessionRow = {
  id: string; setId: string | null; mode: string; feedback: "immediate" | "end"; status: "active" | "completed";
  position: number; total: number; createdAt: string; lastActiveAt: string; completedAt: string | null;
};
const REV_SESSION_COLS = "id, set_id, mode, feedback, status, position, total, created_at, last_active_at, completed_at";
const toRevSession = (r: any): RevisionSessionRow => ({
  id: r.id, setId: r.set_id ?? null, mode: r.mode, feedback: r.feedback, status: r.status, position: r.position, total: r.total,
  createdAt: r.created_at, lastActiveAt: r.last_active_at, completedAt: r.completed_at ?? null,
});

/** A new revision session and its questions in order (a snapshot). not_provisioned where 417 is absent. */
export async function createRevisionSession(admin: Admin, userId: string, input: { mode: string; feedback: "immediate" | "end"; setId?: string | null; questionIds: readonly string[] }): Promise<{ ok: true; id: string } | { ok: false; notProvisioned: boolean }> {
  const ids = [...new Set(input.questionIds)].slice(0, 50);
  if (!ids.length) return { ok: false, notProvisioned: false };
  const { data, error } = await admin.from("individual_scholar_revision_session")
    .insert({ user_id: userId, set_id: input.setId ?? null, mode: input.mode, feedback: input.feedback, total: ids.length }).select("id").single();
  if (error || !data) return { ok: false, notProvisioned: !!error && isNotProvisioned(error) };
  const { error: iErr } = await admin.from("individual_scholar_revision_session_item").insert(ids.map((question_id, i) => ({ session_id: data.id, user_id: userId, ordinal: i + 1, question_id })));
  if (iErr) { await admin.from("individual_scholar_revision_session").delete().eq("user_id", userId).eq("id", data.id); return { ok: false, notProvisioned: false }; }
  return { ok: true, id: data.id };
}

export type SessionAttempt = { questionId: string; correct: boolean; score: number | null; marking: string; answeredAt: string };
/** 425: a short answer held, unmarked, until the end of its session (end-of-session feedback and Mock). */
export type HeldAnswer = { questionId: string; response: { text: string } };

/**
 * A revision session, its questions in order, its answers so far, and (425) the short answers held unmarked until
 * the end. `holding` is false where 425 is absent: nothing can be held there, and the caller says so. null when it
 * is not the caller's.
 */
export async function getRevisionSession(admin: Admin, userId: string, id: string): Promise<Read<{ session: RevisionSessionRow; questionIds: string[]; attempts: SessionAttempt[]; held: HeldAnswer[]; holding: boolean } | null>> {
  if (!isUuid(id)) return { ok: true, data: null };
  const { data: s, error } = await admin.from("individual_scholar_revision_session").select(REV_SESSION_COLS).eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) return fail(error);
  if (!s) return { ok: true, data: null };
  const itemsOf = (cols: string) => admin.from("individual_scholar_revision_session_item").select(cols).eq("user_id", userId).eq("session_id", id).order("ordinal");
  const [first, att] = await Promise.all([
    itemsOf("ordinal, question_id, held_response"),
    admin.from("individual_scholar_attempt").select("question_id, correct, score, marking, answered_at").eq("user_id", userId).eq("revision_session_id", id).order("answered_at"),
  ]);
  let items = first, holding = true;
  if (first.error && isNotProvisioned(first.error)) { items = await itemsOf("ordinal, question_id"); holding = false; }
  if (items.error || att.error) return fail(items.error ?? att.error);
  const rows = (items.data ?? []) as any[];
  return {
    ok: true,
    data: {
      session: toRevSession(s), questionIds: rows.map(r => r.question_id),
      attempts: ((att.data ?? []) as any[]).map(a => ({ questionId: a.question_id, correct: a.correct, score: a.score === null ? null : Number(a.score), marking: a.marking, answeredAt: a.answered_at })),
      held: rows.filter(r => typeof r.held_response?.text === "string").map(r => ({ questionId: r.question_id, response: { text: r.held_response.text } })),
      holding,
    },
  };
}

/** 425: hold a short answer, unmarked, on its session item until the end. false where it could not be kept (425 absent). Owner-keyed. */
export async function holdRevisionAnswer(admin: Admin, userId: string, sessionId: string, questionId: string, text: string): Promise<boolean> {
  const { data, error } = await admin.from("individual_scholar_revision_session_item").update({ held_response: { text } })
    .eq("user_id", userId).eq("session_id", sessionId).eq("question_id", questionId).select("ordinal");
  return !error && (data ?? []).length > 0;
}

/** 425: the held answer has been graded (its attempt now holds it), so it is held no longer. Owner-keyed. */
export async function clearHeldAnswer(admin: Admin, userId: string, sessionId: string, questionId: string): Promise<void> {
  await admin.from("individual_scholar_revision_session_item").update({ held_response: null })
    .eq("user_id", userId).eq("session_id", sessionId).eq("question_id", questionId);
}

/** Where the student is, and whether they have finished. Owner-keyed. */
export async function updateRevisionSession(admin: Admin, userId: string, id: string, patch: { position?: number; completed?: boolean }): Promise<boolean> {
  const now = new Date().toISOString();
  const { error } = await admin.from("individual_scholar_revision_session").update({
    last_active_at: now, ...(patch.position !== undefined ? { position: patch.position } : {}), ...(patch.completed ? { status: "completed", completed_at: now } : {}),
  }).eq("user_id", userId).eq("id", id);
  return !error;
}

/** The student's recent revision sessions, newest first. */
export async function listRevisionSessions(admin: Admin, userId: string, limit = 10): Promise<Read<RevisionSessionRow[]>> {
  const { data, error } = await admin.from("individual_scholar_revision_session").select(REV_SESSION_COLS).eq("user_id", userId).order("last_active_at", { ascending: false }).limit(limit);
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(toRevSession) };
}

export type RevisionSetRow = {
  id: string; title: string; mode: string; scope: Record<string, unknown>; formats: string[]; quantity: number; difficulty: string; feedback: "immediate" | "end";
  createdAt: string; updatedAt: string; lastUsedAt: string | null; questionIds: string[];
};
const REV_SET_COLS = "id, title, mode, scope, formats, quantity, difficulty, feedback, created_at, updated_at, last_used_at";

/** Save a revision set: how it was built and its questions in order. */
export async function createRevisionSet(admin: Admin, userId: string, input: {
  title: string; mode: string; scope: Record<string, unknown>; formats: readonly string[]; quantity: number; difficulty: string; feedback: "immediate" | "end"; questionIds: readonly string[];
}): Promise<{ ok: true; id: string } | { ok: false; notProvisioned: boolean }> {
  const ids = [...new Set(input.questionIds)].slice(0, 50);
  if (!ids.length) return { ok: false, notProvisioned: false };
  const { data, error } = await admin.from("individual_scholar_revision_set").insert({
    user_id: userId, title: input.title, mode: input.mode, scope: input.scope, formats: [...input.formats], quantity: input.quantity, difficulty: input.difficulty, feedback: input.feedback,
  }).select("id").single();
  if (error || !data) return { ok: false, notProvisioned: !!error && isNotProvisioned(error) };
  const { error: iErr } = await admin.from("individual_scholar_revision_set_item").insert(ids.map((question_id, i) => ({ set_id: data.id, user_id: userId, ordinal: i + 1, question_id })));
  if (iErr) { await admin.from("individual_scholar_revision_set").delete().eq("user_id", userId).eq("id", data.id); return { ok: false, notProvisioned: false }; }
  return { ok: true, id: data.id };
}

/** The student's saved sets, each with its questions in order (those still stored: a deleted material takes its own). */
export async function listRevisionSets(admin: Admin, userId: string, limit = 30): Promise<Read<RevisionSetRow[]>> {
  const { data, error } = await admin.from("individual_scholar_revision_set").select(REV_SET_COLS).eq("user_id", userId).order("updated_at", { ascending: false }).limit(limit);
  if (error) return fail(error);
  const sets = (data ?? []) as any[];
  if (!sets.length) return { ok: true, data: [] };
  const { data: items, error: iErr } = await admin.from("individual_scholar_revision_set_item").select("set_id, ordinal, question_id").eq("user_id", userId).in("set_id", sets.map(s => s.id)).order("ordinal");
  if (iErr) return fail(iErr);
  const by = new Map<string, string[]>();
  for (const i of (items ?? []) as any[]) by.set(i.set_id, [...(by.get(i.set_id) ?? []), i.question_id]);
  return {
    ok: true,
    data: sets.map(s => ({
      id: s.id, title: s.title, mode: s.mode, scope: s.scope ?? {}, formats: Array.isArray(s.formats) ? s.formats : [], quantity: s.quantity, difficulty: s.difficulty, feedback: s.feedback,
      createdAt: s.created_at, updatedAt: s.updated_at, lastUsedAt: s.last_used_at ?? null, questionIds: by.get(s.id) ?? [],
    })),
  };
}

export async function getRevisionSet(admin: Admin, userId: string, id: string): Promise<RevisionSetRow | null> {
  if (!isUuid(id)) return null;
  const all = await listRevisionSets(admin, userId, 200);
  return all.ok ? all.data.find(s => s.id === id) ?? null : null;
}

/** A saved set's last use. Owner-keyed. */
export async function touchRevisionSet(admin: Admin, userId: string, id: string): Promise<void> {
  const now = new Date().toISOString();
  await admin.from("individual_scholar_revision_set").update({ last_used_at: now, updated_at: now }).eq("user_id", userId).eq("id", id).then((r: unknown) => r, () => {});
}

/** Delete a saved set (its items go with it). Its sessions keep their own snapshot. Owner-keyed. */
export async function deleteRevisionSet(admin: Admin, userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const { error } = await admin.from("individual_scholar_revision_set").delete().eq("user_id", userId).eq("id", id);
  return !error;
}

/**
 * The rows Revision intelligence (revision.ts buildRevisionInsights) is built from. Where 416 or 417 is absent the
 * attempts are read with the 372 columns: every one marked by code, none in a session.
 */
export async function revisionInsightRows(admin: Admin, userId: string): Promise<Read<{
  attempts: { questionId: string; correct: boolean; answeredAt: string; marking: string; sessionId: string | null }[];
  questions: { id: string; stem: string; kind: RevisionKind; chunkId: string; materialId: string; competencyId: string | null }[];
  reviews: { quality: number; reviewedAt: string; materialId: string }[] | null;
  cards: { nextReviewAt: string; status: "active" | "mastered" }[];
}>> {
  let att = await admin.from("individual_scholar_attempt").select("question_id, correct, answered_at, marking, revision_session_id").eq("user_id", userId).order("answered_at", { ascending: false }).limit(5000);
  if (att.error) att = await admin.from("individual_scholar_attempt").select("question_id, correct, answered_at").eq("user_id", userId).order("answered_at", { ascending: false }).limit(5000);
  if (att.error) return fail(att.error);
  let qs = await admin.from("individual_scholar_question").select("id, stem, kind, chunk_id, material_id, competency_id").eq("user_id", userId).limit(5000);
  if (qs.error) qs = await admin.from("individual_scholar_question").select("id, stem, kind, chunk_id, material_id").eq("user_id", userId).limit(5000);
  if (qs.error) return fail(qs.error);
  const [reviews, cards] = await Promise.all([reviewRows(admin, userId), admin.from("individual_scholar_card").select("next_review_at, status").eq("user_id", userId).limit(5000)]);
  if (cards.error) return fail(cards.error);
  return {
    ok: true,
    data: {
      attempts: ((att.data ?? []) as any[]).map(a => ({ questionId: a.question_id, correct: a.correct, answeredAt: a.answered_at, marking: a.marking ?? "deterministic", sessionId: a.revision_session_id ?? null })),
      questions: ((qs.data ?? []) as any[]).map(q => ({ id: q.id, stem: q.stem, kind: q.kind, chunkId: q.chunk_id, materialId: q.material_id, competencyId: q.competency_id ?? null })),
      reviews: reviews.ok ? reviews.data : null,
      cards: ((cards.data ?? []) as any[]).map(c => ({ nextReviewAt: c.next_review_at, status: c.status })),
    },
  };
}

// ── CLINICAL REASONING ── COMPETEN-SCHOLAR-CLINICAL-REASONING-01, migrations 435 and 436 ───────────────────────────
//
// A student's PRIVATE cases and their sessions. A LIBRARY case is played only through src/lib/cases/library.ts on
// case_library_session (IND-007's), never here: this file reads that table for the student's own history, and writes
// nothing to it. Every statement is keyed on the caller's user id. Where 435/436 are absent, the reads say not
// provisioned and clinical reasoning is not offered.

export type PrivateCaseRow = {
  id: string; materialId: string; title: string; origin: string; context: string; blueprint: any; blueprintHash: string;
  model: string; promptVersion: string; createdAt: string; chunkIds: string[]; competencyIds: string[];
};
const CASE_COLS = "id, material_id, title, origin, context, blueprint, blueprint_hash, model, prompt_version, created_at";

/** A new private case with its sources and competencies. private_formative only (435 refuses anything else). */
export async function insertPrivateCase(admin: Admin, userId: string, input: {
  materialId: string; title: string; origin: string; context: string; blueprint: unknown; model: string; promptVersion: string; chunkIds: readonly string[]; competencyIds: readonly string[];
}): Promise<{ ok: true; id: string } | { ok: false; notProvisioned: boolean }> {
  const { data, error } = await admin.from("individual_scholar_case").insert({
    user_id: userId, material_id: input.materialId, title: input.title.slice(0, 200), origin: input.origin, context: input.context,
    blueprint: input.blueprint, review_status: "private_formative", model: input.model, prompt_version: input.promptVersion,
  }).select("id").single();
  if (error || !data) return { ok: false, notProvisioned: !!error && isNotProvisioned(error) };
  const chunks = [...new Set(input.chunkIds)].slice(0, 20);
  if (chunks.length) await admin.from("individual_scholar_case_source").insert(chunks.map((chunk_id, i) => ({ case_id: data.id, user_id: userId, ordinal: i + 1, chunk_id })));
  const comps = [...new Set(input.competencyIds)];
  if (comps.length) await admin.from("individual_scholar_case_competency").insert(comps.map(competency_id => ({ case_id: data.id, user_id: userId, competency_id })))
    .then((r: unknown) => r, () => {});
  return { ok: true, id: data.id };
}

const toCase = (r: any, chunkIds: string[] = [], competencyIds: string[] = []): PrivateCaseRow => ({
  id: r.id, materialId: r.material_id, title: r.title, origin: r.origin, context: r.context, blueprint: r.blueprint, blueprintHash: r.blueprint_hash,
  model: r.model, promptVersion: r.prompt_version, createdAt: r.created_at, chunkIds, competencyIds,
});

/** One of the caller's private cases, with its sources and competencies. null when it is not theirs. */
export async function getPrivateCase(admin: Admin, userId: string, id: string): Promise<PrivateCaseRow | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await admin.from("individual_scholar_case").select(CASE_COLS).eq("user_id", userId).eq("id", id).maybeSingle();
  if (error || !data) return null;
  const [src, comp] = await Promise.all([
    admin.from("individual_scholar_case_source").select("chunk_id, ordinal").eq("user_id", userId).eq("case_id", id).order("ordinal"),
    admin.from("individual_scholar_case_competency").select("competency_id").eq("user_id", userId).eq("case_id", id),
  ]);
  return toCase(data, ((src.data ?? []) as any[]).map(r => r.chunk_id), ((comp.data ?? []) as any[]).map(r => r.competency_id));
}

/** The caller's private cases, newest first (no blueprint: a list). */
export async function listPrivateCases(admin: Admin, userId: string, limit = 30): Promise<Read<{ id: string; title: string; context: string; origin: string; materialId: string; createdAt: string }[]>> {
  const { data, error } = await admin.from("individual_scholar_case").select("id, title, context, origin, material_id, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(r => ({ id: r.id, title: r.title, context: r.context, origin: r.origin, materialId: r.material_id, createdAt: r.created_at })) };
}

/** The private cases written from one material: what to withdraw from the shared library when it is deleted (C-e). */
export async function privateCaseIdsOfMaterial(admin: Admin, userId: string, materialId: string): Promise<string[]> {
  if (!isUuid(materialId)) return [];
  const { data } = await admin.from("individual_scholar_case").select("id").eq("user_id", userId).eq("material_id", materialId);
  return ((data ?? []) as any[]).map(r => r.id);
}
/**
 * The caller's cases written from one material (or from all of them): the private cases (435) and the S4 practice
 * cases (388 case_id), by id -- what to withdraw from the shared library before the source is deleted (C-e).
 */
export async function caseSourcesOf(admin: Admin, userId: string, materialId: string | null): Promise<{ cases: string[]; s4: string[] }> {
  if (materialId !== null && !isUuid(materialId)) return { cases: [], s4: [] };
  let c = admin.from("individual_scholar_case").select("id").eq("user_id", userId);
  let q = admin.from("individual_scholar_question").select("case_id").eq("user_id", userId).eq("kind", "case").not("case_id", "is", null);
  if (materialId) { c = c.eq("material_id", materialId); q = q.eq("material_id", materialId); }
  const [cases, steps] = await Promise.all([c.limit(5000), q.limit(5000)]);
  return { cases: ((cases.data ?? []) as any[]).map(r => r.id), s4: [...new Set(((steps.data ?? []) as any[]).map(r => r.case_id as string))] };
}

export type CaseSessionRow = {
  id: string; caseId: string; mode: "guided" | "independent"; status: "active" | "completed"; viewSalt: string; currentStageId: string | null;
  reachedStageIds: string[]; revealedFactIds: string[]; debrief: any; createdAt: string; lastActiveAt: string; completedAt: string | null;
};
export type CaseAnswerRow = {
  decisionPointId: string; chosen: string[]; reasoning: string | null; marking: string; correct: boolean | null; score: number | null;
  safety: string[]; aiFeedback: string | null; evaluatorModel: string | null; createdAt: string;
};
const CASE_SESSION_COLS = "id, private_case_id, mode, status, view_salt, current_stage_id, reached_stage_ids, revealed_fact_ids, debrief, created_at, last_active_at, completed_at";
const toCaseSession = (r: any): CaseSessionRow => ({
  id: r.id, caseId: r.private_case_id, mode: r.mode, status: r.status, viewSalt: r.view_salt, currentStageId: r.current_stage_id ?? null,
  reachedStageIds: Array.isArray(r.reached_stage_ids) ? r.reached_stage_ids : [], revealedFactIds: Array.isArray(r.revealed_fact_ids) ? r.revealed_fact_ids : [],
  debrief: r.debrief ?? null, createdAt: r.created_at, lastActiveAt: r.last_active_at, completedAt: r.completed_at ?? null,
});

/** A new session on one of the caller's private cases, at its first stage. The salt is server-only. */
export async function createPrivateCaseSession(admin: Admin, userId: string, input: { caseId: string; mode: "guided" | "independent"; viewSalt: string; firstStageId: string }): Promise<{ ok: true; id: string } | { ok: false; notProvisioned: boolean }> {
  const { data, error } = await admin.from("individual_scholar_case_session").insert({
    user_id: userId, private_case_id: input.caseId, mode: input.mode, view_salt: input.viewSalt, current_stage_id: input.firstStageId, reached_stage_ids: [input.firstStageId],
  }).select("id").single();
  if (error || !data) return { ok: false, notProvisioned: !!error && isNotProvisioned(error) };
  return { ok: true, id: data.id };
}

/** A private case session with its decisions in order. null when it is not the caller's. */
export async function getPrivateCaseSession(admin: Admin, userId: string, id: string): Promise<{ session: CaseSessionRow; answers: CaseAnswerRow[] } | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await admin.from("individual_scholar_case_session").select(CASE_SESSION_COLS).eq("user_id", userId).eq("id", id).maybeSingle();
  if (error || !data) return null;
  const { data: ans } = await admin.from("individual_scholar_case_answer")
    .select("decision_point_id, chosen_option_ids, reasoning, marking, correct, score, safety_criterion_ids, ai_feedback, evaluator_model, created_at")
    .eq("user_id", userId).eq("session_id", id).order("created_at");
  return {
    session: toCaseSession(data),
    answers: ((ans ?? []) as any[]).map(a => ({
      decisionPointId: a.decision_point_id, chosen: Array.isArray(a.chosen_option_ids) ? a.chosen_option_ids : [], reasoning: a.reasoning ?? null, marking: a.marking,
      correct: a.correct ?? null, score: a.score === null ? null : Number(a.score), safety: Array.isArray(a.safety_criterion_ids) ? a.safety_criterion_ids : [],
      aiFeedback: a.ai_feedback ?? null, evaluatorModel: a.evaluator_model ?? null, createdAt: a.created_at,
    })),
  };
}

/** One decision, as it was made. Append-only (435): it can never be rewritten. */
export async function insertCaseAnswer(admin: Admin, userId: string, sessionId: string, a: {
  decisionPointId: string; chosen: string[] | null; reasoning: string | null; marking: "deterministic" | "self_graded" | "ai_evaluation"; correct: boolean | null; score: number | null;
  safety: string[]; aiFeedback?: string | null; evaluator?: { model: string; promptVersion: string } | null;
}): Promise<boolean> {
  const { error } = await admin.from("individual_scholar_case_answer").insert({
    session_id: sessionId, user_id: userId, decision_point_id: a.decisionPointId, chosen_option_ids: a.chosen, reasoning: a.reasoning, marking: a.marking,
    correct: a.correct, score: a.score, safety_criterion_ids: a.safety, ai_feedback: a.aiFeedback ?? null,
    evaluator_model: a.evaluator?.model ?? null, evaluator_prompt_version: a.evaluator?.promptVersion ?? null,
  });
  return !error;
}

/** Where a private session is: stages reached, facts revealed, the current stage, finished with its debrief. */
export async function updatePrivateCaseSession(admin: Admin, userId: string, id: string, patch: { reached?: string[]; revealed?: string[]; current?: string | null; completed?: boolean; debrief?: unknown }): Promise<boolean> {
  const now = new Date().toISOString();
  const { error } = await admin.from("individual_scholar_case_session").update({
    last_active_at: now,
    ...(patch.reached ? { reached_stage_ids: patch.reached } : {}), ...(patch.revealed ? { revealed_fact_ids: patch.revealed } : {}),
    ...(patch.current !== undefined ? { current_stage_id: patch.current } : {}),
    ...(patch.completed ? { status: "completed", completed_at: now } : {}), ...(patch.debrief !== undefined ? { debrief: patch.debrief } : {}),
  }).eq("user_id", userId).eq("id", id);
  return !error;
}

/** Which library version one of the caller's library plays is on (423, read only). null when it is not theirs. */
export async function librarySessionVersion(admin: Admin, userId: string, sessionId: string): Promise<string | null> {
  if (!isUuid(sessionId)) return null;
  const { data } = await admin.from("case_library_session").select("id, status, started_at, completed_at, version_id").eq("user_id", userId).eq("id", sessionId).maybeSingle();
  return (data as any)?.version_id ?? null;
}

/** The caller's case history: private sessions (435) and library plays (423, read only), newest first. */
export async function caseHistory(admin: Admin, userId: string, limit = 20): Promise<Read<{ kind: "private" | "library"; id: string; title: string | null; versionId: string | null; status: string; startedAt: string; completedAt: string | null }[]>> {
  const [p, l] = await Promise.all([
    admin.from("individual_scholar_case_session").select("id, status, created_at, completed_at, private_case_id").eq("user_id", userId).order("last_active_at", { ascending: false }).limit(limit),
    admin.from("case_library_session").select("id, status, started_at, completed_at, version_id").eq("user_id", userId).order("started_at", { ascending: false }).limit(limit),
  ]);
  if (p.error && !isNotProvisioned(p.error)) return fail(p.error);
  const privateRows = ((p.data ?? []) as any[]);
  const titles = new Map<string, string>();
  if (privateRows.length) {
    const { data } = await admin.from("individual_scholar_case").select("id, title").eq("user_id", userId).in("id", [...new Set(privateRows.map(r => r.private_case_id))]);
    for (const r of (data ?? []) as any[]) titles.set(r.id, r.title);
  }
  // A library play names its version; its title comes from src/lib/cases/library.ts, never a read of the library here.
  const libRows = l.error ? [] : ((l.data ?? []) as any[]);
  return {
    ok: true,
    data: [
      ...privateRows.map(r => ({ kind: "private" as const, id: r.id, title: titles.get(r.private_case_id) ?? "Your case", versionId: null, status: r.status, startedAt: r.created_at, completedAt: r.completed_at ?? null })),
      ...libRows.map(r => ({ kind: "library" as const, id: r.id, title: null, versionId: r.version_id as string, status: r.status === "in_progress" ? "active" : r.status, startedAt: r.started_at, completedAt: r.completed_at ?? null })),
    ].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit),
  };
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
  /** UPLOAD-01 U3: each offered competency's catalogue version, recorded with the proposal (migration 408). */
  versions?: ReadonlyMap<string, string | null>;
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
  // U3 (408): the catalogue version and the named learning outcome. Where 408 is absent the 388 row is written.
  const outcomeOf = new Map(input.sections.flatMap(s => s.proposals.map(p => [`${s.ref}|${p.competencyId}`, p.outcome ?? null] as const)));
  const full = maps.map(r => ({ ...r, user_id: userId, catalogue_version: input.versions?.get(r.competency_id) ?? null, outcome: outcomeOf.get(`${r.chunk_id}|${r.competency_id}`) ?? null }));
  let { error: mErr } = await admin.from("individual_scholar_competency_map").upsert(full.map(r => ({ ...r, user_id: userId })), { onConflict: "chunk_id,competency_id", ignoreDuplicates: true });
  if (mErr && isNotProvisioned(mErr))
    ({ error: mErr } = await admin.from("individual_scholar_competency_map").upsert(maps.map(r => ({ ...r, user_id: userId })), { onConflict: "chunk_id,competency_id", ignoreDuplicates: true }));
  return { ok: !mErr, proposals: mErr ? 0 : maps.length };
}

export type MappingRow = {
  id: string; chunkId: string; materialId: string; competencyId: string; layer: Layer; source: MapSource;
  confidence: number | null; rationale: string | null; model: string | null; promptVersion: string | null; createdAt: string;
  state: MappingState; decidedBy: "student" | "reviewer" | null; decisions: number;
  /** UPLOAD-01 U3 (408). Null: none named, not recorded, or 408 absent. */
  outcome: string | null; catalogueVersion: string | null;
};

/** The 408 columns, read apart so their absence costs nothing but themselves. */
async function mappingExtras(admin: Admin, userId: string, ids: string[]): Promise<Map<string, { outcome: string | null; catalogue_version: string | null }>> {
  if (!ids.length) return new Map();
  const out = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await admin.from("individual_scholar_competency_map").select("id, outcome, catalogue_version").eq("user_id", userId).in("id", ids.slice(i, i + 500));
    if (error) return new Map();
    for (const r of (data ?? []) as any[]) out.set(r.id, r);
  }
  return out;
}

/**
 * The person's mappings (one material, or all), each with its current state, and the concepts per section.
 * UPLOAD-01 U5: where the person corrected a section's topics (408), `concepts` holds THEIR list and `corrected`
 * names the section; `correctionsOn` is false where 408 is absent (correction not offered).
 */
export async function listMappings(admin: Admin, userId: string, materialId?: string | null): Promise<Read<{
  mappings: MappingRow[]; concepts: Map<string, string[]>; corrected: Set<string>; correctionsOn: boolean;
}>> {
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
  const [extras, corrections] = await Promise.all([mappingExtras(admin, userId, ids), topicCorrections(admin, userId, materialId ?? null)]);
  const concepts = new Map<string, string[]>(((analysis.data ?? []) as any[]).map(r => [r.chunk_id, r.concepts ?? []]));
  for (const [chunkId, topics] of corrections.byChunk) concepts.set(chunkId, topics);
  return {
    ok: true,
    data: {
      mappings: ((maps.data ?? []) as any[]).map(r => {
        const s = states.get(r.id);
        return {
          id: r.id, chunkId: r.chunk_id, materialId: r.material_id, competencyId: r.competency_id, layer: r.layer, source: r.source,
          confidence: r.confidence === null ? null : Number(r.confidence), rationale: r.rationale, model: r.model, promptVersion: r.prompt_version,
          createdAt: r.created_at, state: s?.state ?? "proposed", decidedBy: (s?.decidedBy as "student" | "reviewer" | undefined) ?? null, decisions: s?.history ?? 0,
          outcome: extras.get(r.id)?.outcome ?? null, catalogueVersion: extras.get(r.id)?.catalogue_version ?? null,
        };
      }),
      concepts, corrected: new Set(corrections.byChunk.keys()), correctionsOn: corrections.on,
    },
  };
}

// ── UPLOAD-01 U5: THE STUDENT'S OWN TOPICS FOR A SECTION (408) ──────────────────────────────────────────
//
// A correction REPLACES what the student sees for that section. The AI analysis row is kept, untouched, as the
// record of what was suggested. Nothing here reads or writes a shared catalogue.

async function topicCorrections(admin: Admin, userId: string, materialId: string | null): Promise<{ on: boolean; byChunk: Map<string, string[]> }> {
  let chunkIds: string[] | null = null;
  if (materialId) {
    const { data } = await admin.from("individual_scholar_chunk").select("id").eq("user_id", userId).eq("material_id", materialId).limit(2000);
    chunkIds = ((data ?? []) as any[]).map(r => r.id);
    if (!chunkIds.length) chunkIds = null;
  }
  let q = admin.from("individual_scholar_topic_correction").select("chunk_id, topics").eq("user_id", userId);
  if (chunkIds) q = q.in("chunk_id", chunkIds);
  const { data, error } = await q.limit(5000);
  if (error) return { on: false, byChunk: new Map() };
  return { on: true, byChunk: new Map(((data ?? []) as any[]).map(r => [r.chunk_id, r.topics ?? []])) };
}

/**
 * UPLOAD-01 U4: the topics of every section of the person's library, per material -- the student's correction
 * where they made one. Feeds "what this material is about" and related materials. Null where unreadable.
 */
export async function libraryTopics(admin: Admin, userId: string): Promise<Map<string, string[][]> | null> {
  const { data, error } = await admin.from("individual_scholar_chunk_analysis").select("chunk_id, material_id, concepts").eq("user_id", userId).limit(10000);
  if (error) return isNotProvisioned(error) ? new Map() : null;
  const corrections = await topicCorrections(admin, userId, null);
  const out = new Map<string, string[][]>();
  for (const r of (data ?? []) as any[]) {
    const list = out.get(r.material_id) ?? [];
    list.push(corrections.byChunk.get(r.chunk_id) ?? r.concepts ?? []);
    out.set(r.material_id, list);
  }
  return out;
}

// ── STAGE 3: LEARN ── COMPETEN-SCHOLAR-LEARN-01 L1 and L4 (migration 414) ──────────────────────────────
//
// L1 reads only what Stage 2 built: the person's chunks, in order, and their topics. L4 writes STRUCTURE ONLY --
// sessions, steps (the sections each step teaches), events (the action, the step, an informal check verdict) and
// the sections each event used -- never what the AI said or what the student typed. Absent tables (414 not applied)
// read as "history off here", never as an error.

export type SectionRef = { chunkId: string; materialId: string; ordinal: number; pageFrom: number | null; pageTo: number | null; materialTitle: string; unit: "page" | "slide" | "section" };

/** The person's own sections of these materials, in the order given and then document order. */
export async function sectionsOf(admin: Admin, userId: string, materialIds: readonly string[]): Promise<Read<SectionRef[]>> {
  const ids = materialIds.filter(isUuid);
  if (!ids.length) return { ok: true, data: [] };
  const { data, error } = await admin.from("individual_scholar_chunk").select("id, material_id, ordinal, page_from, page_to")
    .eq("user_id", userId).in("material_id", ids).order("ordinal").limit(4000);
  if (error) return fail(error);
  const names = await titlesOf(admin, userId, ids);
  const rank = new Map(ids.map((id, i) => [id, i]));
  return {
    ok: true,
    data: ((data ?? []) as any[]).sort((a, b) => (rank.get(a.material_id)! - rank.get(b.material_id)!) || a.ordinal - b.ordinal).map(r => ({
      chunkId: r.id, materialId: r.material_id, ordinal: r.ordinal, pageFrom: r.page_from, pageTo: r.page_to,
      materialTitle: (names.get(r.material_id) ?? UNNAMED).title, unit: (names.get(r.material_id) ?? UNNAMED).unit,
    })),
  };
}

/** The same shape for sections already chosen (a search, a competency), keeping their order. */
export async function sectionRefs(admin: Admin, userId: string, chunks: readonly CandidateChunk[]): Promise<SectionRef[]> {
  const names = await titlesOf(admin, userId, [...new Set(chunks.map(c => c.materialId))]);
  return chunks.map(c => ({ chunkId: c.id, materialId: c.materialId, ordinal: c.ordinal, pageFrom: c.pageFrom, pageTo: c.pageTo,
    materialTitle: (names.get(c.materialId) ?? UNNAMED).title, unit: (names.get(c.materialId) ?? UNNAMED).unit }));
}

/** Topics per section: the student's correction where they made one, otherwise what topic finding found. */
export async function topicsOfSections(admin: Admin, userId: string, chunkIds: readonly string[]): Promise<Map<string, string[]>> {
  if (!chunkIds.length) return new Map();
  const [a, c] = await Promise.all([
    admin.from("individual_scholar_chunk_analysis").select("chunk_id, concepts").eq("user_id", userId).in("chunk_id", [...chunkIds]),
    admin.from("individual_scholar_topic_correction").select("chunk_id, topics").eq("user_id", userId).in("chunk_id", [...chunkIds]),
  ]);
  const out = new Map<string, string[]>(((a.error ? [] : a.data ?? []) as any[]).map(r => [r.chunk_id, r.concepts ?? []]));
  for (const r of (c.error ? [] : c.data ?? []) as any[]) out.set(r.chunk_id, r.topics ?? []);
  return out;
}

/** The live (not rejected) competency links of these sections, with any outcome named (408). [] where unreadable. */
export async function sectionLinks(admin: Admin, userId: string, chunkIds: readonly string[]): Promise<{ chunkId: string; competencyId: string; outcome: string | null; accepted: boolean }[]> {
  if (!chunkIds.length) return [];
  const { data, error } = await admin.from("individual_scholar_competency_map").select("id, chunk_id, competency_id").eq("user_id", userId).in("chunk_id", [...chunkIds]).limit(500);
  if (error || !data?.length) return [];
  const [{ data: d }, extras] = await Promise.all([
    admin.from("individual_scholar_competency_decision").select("map_id, decision, decided_by, created_at").eq("user_id", userId).in("map_id", (data as any[]).map(r => r.id)).limit(5000),
    mappingExtras(admin, userId, (data as any[]).map(r => r.id)),
  ]);
  const states = mappingStates(((d ?? []) as any[]).map(x => ({ mappingId: x.map_id, decision: x.decision, decidedBy: x.decided_by, createdAt: x.created_at })));
  return (data as any[]).map(r => ({ chunkId: r.chunk_id, competencyId: r.competency_id, outcome: extras.get(r.id)?.outcome ?? null, state: states.get(r.id)?.state ?? "proposed" }))
    .filter(r => r.state !== "rejected").map(r => ({ chunkId: r.chunkId, competencyId: r.competencyId, outcome: r.outcome, accepted: r.state === "accepted" }));
}

export type LearningStep = { step: number; sections: SectionRef[] };
export type LearningSessionRow = {
  id: string; scopeKind: "section" | "document" | "documents" | "topic" | "competency"; title: string; topic: string | null; competencyId: string | null;
  currentStep: number; status: "active" | "completed"; createdAt: string; lastActiveAt: string;
};
const toSession = (r: any): LearningSessionRow => ({
  id: r.id, scopeKind: r.scope_kind, title: r.title, topic: r.topic, competencyId: r.competency_id, currentStep: r.current_step,
  status: r.status, createdAt: r.created_at, lastActiveAt: r.last_active_at,
});
const SESSION_COLS = "id, scope_kind, title, topic, competency_id, current_step, status, created_at, last_active_at";

/** A new session with its steps. "not_provisioned" where 414 is absent: the workspace then teaches without history. */
export async function createLearningSession(admin: Admin, userId: string, input: {
  scopeKind: LearningSessionRow["scopeKind"]; title: string; topic: string | null; competencyId: string | null; steps: LearningStep[];
}): Promise<{ ok: true; id: string } | { ok: false; error: "not_provisioned" | "failed" }> {
  const { data, error } = await admin.from("individual_scholar_learning_session").insert({
    user_id: userId, scope_kind: input.scopeKind, title: input.title.slice(0, 160), topic: input.topic, competency_id: input.competencyId,
  }).select("id").single();
  if (error) return { ok: false, error: isNotProvisioned(error) ? "not_provisioned" : "failed" };
  const rows = input.steps.flatMap(s => s.sections.map(x => ({ session_id: data.id, user_id: userId, step: s.step, chunk_id: x.chunkId, material_id: x.materialId })));
  const { error: sErr } = rows.length ? await admin.from("individual_scholar_learning_step").insert(rows.map(r => ({ ...r, user_id: userId }))) : { error: null };
  if (sErr) { await admin.from("individual_scholar_learning_session").delete().eq("user_id", userId).eq("id", data.id); return { ok: false, error: "failed" }; }
  return { ok: true, id: data.id };
}

/** The person's sessions, most recently active first. Read<[]> with notProvisioned where 414 is absent. */
export async function listLearningSessions(admin: Admin, userId: string, limit = 10): Promise<Read<LearningSessionRow[]>> {
  const { data, error } = await admin.from("individual_scholar_learning_session").select(SESSION_COLS).eq("user_id", userId).order("last_active_at", { ascending: false }).limit(limit);
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(toSession) };
}

/** One of the person's sessions with its steps (sections in document order within a step), or null. */
export async function getLearningSession(admin: Admin, userId: string, id: string): Promise<Read<{ session: LearningSessionRow; steps: LearningStep[] } | null>> {
  if (!isUuid(id)) return { ok: true, data: null };
  const { data, error } = await admin.from("individual_scholar_learning_session").select(SESSION_COLS).eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) return fail(error);
  if (!data) return { ok: true, data: null };
  const { data: st, error: sErr } = await admin.from("individual_scholar_learning_step").select("step, chunk_id").eq("user_id", userId).eq("session_id", id).order("step").limit(200);
  if (sErr) return fail(sErr);
  const ids = [...new Set(((st ?? []) as any[]).map(r => r.chunk_id))];
  const { data: ch } = ids.length ? await admin.from("individual_scholar_chunk").select("id, material_id, ordinal, page_from, page_to").eq("user_id", userId).in("id", ids) : { data: [] };
  const refs = new Map((await sectionRefs(admin, userId, ((ch ?? []) as any[]).map(r => ({ id: r.id, materialId: r.material_id, ordinal: r.ordinal, pageFrom: r.page_from, pageTo: r.page_to, content: "" })))).map(s => [s.chunkId, s]));
  const byStep = new Map<number, SectionRef[]>();
  for (const r of (st ?? []) as any[]) { const s = refs.get(r.chunk_id); if (s) byStep.set(r.step, [...(byStep.get(r.step) ?? []), s]); }
  const steps = [...byStep.entries()].sort((a, b) => a[0] - b[0]).map(([step, sections]) => ({ step, sections: sections.sort((a, b) => a.materialId.localeCompare(b.materialId) || a.ordinal - b.ordinal) }));
  return { ok: true, data: { session: toSession(data), steps } };
}

/** Move the session on (or back): the current step, active or completed, and when it was last used. */
export async function updateLearningSession(admin: Admin, userId: string, id: string, patch: { currentStep?: number; status?: "active" | "completed" }): Promise<"ok" | "not_found" | "failed"> {
  if (!isUuid(id)) return "not_found";
  const { data, error } = await admin.from("individual_scholar_learning_session")
    .update({ ...(patch.currentStep !== undefined ? { current_step: patch.currentStep } : {}), ...(patch.status ? { status: patch.status } : {}), last_active_at: new Date().toISOString() })
    .eq("user_id", userId).eq("id", id).select("id");
  if (error) return "failed";
  return (data ?? []).length ? "ok" : "not_found";
}

/** One learning action, with the sections it used and, for a clarification, the informal verdict. Structure only. */
export async function recordLearningEvent(admin: Admin, userId: string, input: { sessionId: string; step: number; action: string; verdict: string | null; chunkIds: readonly string[] }): Promise<"ok" | "failed"> {
  const { data, error } = await admin.from("individual_scholar_learning_event")
    .insert({ session_id: input.sessionId, user_id: userId, step: input.step, action: input.action, verdict: input.verdict }).select("id").single();
  if (error) return "failed";
  const ids = [...new Set(input.chunkIds.filter(isUuid))];
  if (ids.length) {
    const { error: e2 } = await admin.from("individual_scholar_learning_event_source").insert(ids.map(chunk_id => ({ event_id: data.id, user_id: userId, chunk_id })));
    if (e2) return "failed";
  }
  await admin.from("individual_scholar_learning_session").update({ last_active_at: new Date().toISOString() }).eq("user_id", userId).eq("id", input.sessionId);
  return "ok";
}

export type LearningEventRow = { step: number; action: string; verdict: string | null; createdAt: string };

/** A session's events, in order (what was done, and the informal check outcomes). */
export async function learningEvents(admin: Admin, userId: string, sessionId: string): Promise<Read<LearningEventRow[]>> {
  const { data, error } = await admin.from("individual_scholar_learning_event").select("step, action, verdict, created_at").eq("user_id", userId).eq("session_id", sessionId).order("created_at").limit(2000);
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(r => ({ step: r.step, action: r.action, verdict: r.verdict, createdAt: r.created_at })) };
}

// ── SCH-LEARN-UX-01: SEARCH-FIRST LEARN ── reads only, over what Stages 2 and 3 already store ────────────────
//
// No AI, no index of its own: Postgres full-text search on the chunks' tsv (372), the material titles and file
// names, the topics topic finding wrote (with the student's corrections, 408), and the session titles (414). Every
// statement is keyed on the caller's own id. The one write is a personal topic rename, kept as the student's own
// topic corrections (408) -- never a change to a governed competency or to the AI analysis record.

/** The person's materials matching any term in the title or file name (all of them when no terms), with filters. */
export async function searchMaterialRows(admin: Admin, userId: string, opts: { terms: readonly string[]; mime?: string | null; sinceIso?: string | null; ids?: readonly string[] | null; limit: number }): Promise<Read<MaterialRow[]>> {
  let q = admin.from("individual_scholar_material").select(MATERIAL_COLS).eq("user_id", userId);
  // Terms are letters and digits only (retrieval.searchTerms), so nothing reaches the filter unescaped.
  const like = opts.terms.filter(t => /^[a-z0-9]+$/.test(t)).flatMap(t => [`title.ilike.%${t}%`, `file_name.ilike.%${t}%`]);
  if (opts.ids) q = q.in("id", opts.ids.length ? [...opts.ids] : ["00000000-0000-0000-0000-000000000000"]);
  else if (like.length) q = q.or(like.join(","));
  if (opts.mime) q = q.eq("mime_type", opts.mime);
  if (opts.sinceIso) q = q.gte("created_at", opts.sinceIso);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(opts.limit);
  if (error) return fail(error);
  return { ok: true, data: (data ?? []).map(toMaterial) };
}

/** Full-text candidates over the person's own sections, and how many sections match in all (exact). */
export async function searchSectionRows(admin: Admin, userId: string, tsquery: string, limit: number): Promise<Read<{ rows: CandidateChunk[]; total: number }>> {
  const { data, error, count } = await admin.from("individual_scholar_chunk").select("id, material_id, ordinal, page_from, page_to, content", { count: "exact" })
    .eq("user_id", userId).textSearch("tsv", tsquery, { config: "english" }).limit(limit);
  if (error) return fail(error);
  return { ok: true, data: { rows: (data ?? []).map(toCandidate), total: count ?? (data ?? []).length } };
}

/** Some of the person's own sections, by id (search-selected sources, a topic's sections). */
export async function chunksByIds(admin: Admin, userId: string, ids: readonly string[], withContent = true): Promise<Read<CandidateChunk[]>> {
  const keep = [...new Set(ids.filter(isUuid))];
  if (!keep.length) return { ok: true, data: [] };
  const { data, error } = await admin.from("individual_scholar_chunk").select(withContent ? "id, material_id, ordinal, page_from, page_to, content" : "id, material_id, ordinal, page_from, page_to")
    .eq("user_id", userId).in("id", keep).limit(keep.length);
  if (error) return fail(error);
  return { ok: true, data: (data ?? []).map(toCandidate) };
}

/** Every analysed section's topics (the student's correction where they made one). Read<[]> where 408/388 are absent. */
export async function sectionTopicRows(admin: Admin, userId: string): Promise<Read<{ chunkId: string; materialId: string; topics: string[] }[]>> {
  const { data, error } = await admin.from("individual_scholar_chunk_analysis").select("chunk_id, material_id, concepts").eq("user_id", userId).limit(10000);
  if (error) return isNotProvisioned(error) ? { ok: true, data: [] } : fail(error);
  const corrections = await topicCorrections(admin, userId, null);
  return { ok: true, data: ((data ?? []) as any[]).map(r => ({ chunkId: r.chunk_id, materialId: r.material_id, topics: corrections.byChunk.get(r.chunk_id) ?? r.concepts ?? [] })) };
}

/** The person's sessions, searched on title and topic (all when no terms), sorted, one page, with the exact total. */
export async function searchLearningSessionRows(admin: Admin, userId: string, opts: { terms: readonly string[]; sort: "recent" | "title" | "oldest"; offset: number; limit: number }): Promise<Read<{ rows: LearningSessionRow[]; total: number }>> {
  let q = admin.from("individual_scholar_learning_session").select(SESSION_COLS, { count: "exact" }).eq("user_id", userId);
  const like = opts.terms.filter(t => /^[a-z0-9]+$/.test(t)).flatMap(t => [`title.ilike.%${t}%`, `topic.ilike.%${t}%`]);
  if (like.length) q = q.or(like.join(","));
  q = opts.sort === "title" ? q.order("title", { ascending: true }) : q.order("last_active_at", { ascending: opts.sort === "oldest" });
  const { data, error, count } = await q.range(opts.offset, opts.offset + opts.limit - 1);
  if (error) return fail(error);
  return { ok: true, data: { rows: ((data ?? []) as any[]).map(toSession), total: count ?? (data ?? []).length } };
}

/** Per session: how many steps it has and which of the person's sections and materials its steps use. */
export async function sessionStepSummaries(admin: Admin, userId: string, sessionIds: readonly string[]): Promise<Map<string, { steps: number; chunkIds: string[]; materialIds: string[] }>> {
  const ids = sessionIds.filter(isUuid);
  const out = new Map<string, { steps: number; chunkIds: string[]; materialIds: string[] }>();
  if (!ids.length) return out;
  const { data, error } = await admin.from("individual_scholar_learning_step").select("session_id, step, chunk_id, material_id").eq("user_id", userId).in("session_id", ids).limit(5000);
  if (error) return out;
  const steps = new Map<string, Set<number>>();
  for (const r of (data ?? []) as any[]) {
    const s = out.get(r.session_id) ?? { steps: 0, chunkIds: [], materialIds: [] };
    s.chunkIds.push(r.chunk_id); if (!s.materialIds.includes(r.material_id)) s.materialIds.push(r.material_id);
    out.set(r.session_id, s);
    steps.set(r.session_id, (steps.get(r.session_id) ?? new Set()).add(r.step));
  }
  for (const [id, s] of out) s.steps = steps.get(id)?.size ?? 0;
  return out;
}

/** The person's ACTIVE sessions of one kind and title, most recent first -- the candidates a new start would repeat. */
export async function activeSessionsTitled(admin: Admin, userId: string, scopeKind: LearningSessionRow["scopeKind"], title: string): Promise<Read<LearningSessionRow[]>> {
  const { data, error } = await admin.from("individual_scholar_learning_session").select(SESSION_COLS).eq("user_id", userId)
    .eq("scope_kind", scopeKind).eq("title", title.slice(0, 160)).eq("status", "active").order("last_active_at", { ascending: false }).limit(5);
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(toSession) };
}

/**
 * The student renames one of THEIR topics across their library: every section showing it gets the student's own
 * topic list with the new name (408). The AI analysis stays as the record; nothing reaches a shared catalogue or a
 * competency. `from` is matched case-insensitively. Returns how many sections changed.
 */
export async function renameTopic(admin: Admin, userId: string, from: string, to: string, maxSections = 500): Promise<{ ok: true; sections: number } | { ok: false; error: "not_provisioned" | "failed" }> {
  const rows = await sectionTopicRows(admin, userId);
  if (!rows.ok) return { ok: false, error: rows.notProvisioned ? "not_provisioned" : "failed" };
  const key = from.trim().toLowerCase();
  const now = new Date().toISOString();
  const changes = rows.data.filter(r => r.topics.some(t => t.trim().toLowerCase() === key)).slice(0, maxSections).map(r => {
    const next: string[] = [];
    for (const t of r.topics.map(t => (t.trim().toLowerCase() === key ? to : t))) if (!next.some(x => x.toLowerCase() === t.toLowerCase())) next.push(t);
    return { chunk_id: r.chunkId, user_id: userId, topics: next.slice(0, 12), updated_at: now };
  });
  if (!changes.length) return { ok: true, sections: 0 };
  const { error } = await admin.from("individual_scholar_topic_correction").upsert(changes.map(c => ({ ...c, user_id: userId })), { onConflict: "chunk_id" });
  if (error) return { ok: false, error: isNotProvisioned(error) ? "not_provisioned" : "failed" };
  return { ok: true, sections: changes.length };
}

export type LearningPreference = { depth: "brief" | "standard" | "detailed"; defaultAction: string };

export async function getLearningPreference(admin: Admin, userId: string): Promise<LearningPreference | null> {
  const { data, error } = await admin.from("individual_scholar_learning_preference").select("depth, default_action").eq("user_id", userId).maybeSingle();
  if (error || !data) return null;
  return { depth: data.depth, defaultAction: data.default_action };
}

export async function setLearningPreference(admin: Admin, userId: string, pref: LearningPreference): Promise<"ok" | "not_provisioned" | "failed"> {
  const { error } = await admin.from("individual_scholar_learning_preference")
    .upsert({ user_id: userId, depth: pref.depth, default_action: pref.defaultAction, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) return isNotProvisioned(error) ? "not_provisioned" : "failed";
  return "ok";
}

/**
 * L4: learning activity per competency, for Progress -- the actions taken on sections linked (not rejected) to each
 * competency, and the latest informal check outcome among them. ACTIVITY, NOT EVIDENCE: nothing here is assessment.
 * Null where 414 is absent (not measured).
 */
export async function learningActivityByCompetency(admin: Admin, userId: string): Promise<Map<string, { actions: number; lastVerdict: string | null; lastAt: string }> | null> {
  const { data: src, error } = await admin.from("individual_scholar_learning_event_source").select("event_id, chunk_id").eq("user_id", userId).limit(10000);
  if (error) return isNotProvisioned(error) ? null : new Map();
  if (!src?.length) return new Map();
  const { data: ev } = await admin.from("individual_scholar_learning_event").select("id, verdict, created_at").eq("user_id", userId).in("id", [...new Set((src as any[]).map(r => r.event_id))]).limit(10000);
  const events = new Map(((ev ?? []) as any[]).map(r => [r.id, r]));
  const links = await sectionLinks(admin, userId, [...new Set((src as any[]).map(r => r.chunk_id))]);
  const out = new Map<string, { actions: number; lastVerdict: string | null; lastAt: string; seen: Set<string> }>();
  for (const s of src as any[]) {
    const e = events.get(s.event_id); if (!e) continue;
    for (const l of links.filter(x => x.chunkId === s.chunk_id)) {
      const cur = out.get(l.competencyId) ?? { actions: 0, lastVerdict: null, lastAt: "", seen: new Set<string>() };
      if (!cur.seen.has(e.id)) { cur.seen.add(e.id); cur.actions++; }
      if (e.created_at > cur.lastAt) { cur.lastAt = e.created_at; if (e.verdict) cur.lastVerdict = e.verdict; }
      else if (e.verdict && !cur.lastVerdict) cur.lastVerdict = e.verdict;
      out.set(l.competencyId, cur);
    }
  }
  return new Map([...out].map(([k, v]) => [k, { actions: v.actions, lastVerdict: v.lastVerdict, lastAt: v.lastAt }]));
}

// ── AI-FAIR-USE-01 s8: THE LEARNING ARTEFACT LIBRARY (migration 415) ──────────────────────────────────
//
// A saved explanation or summary: the notes part (cited [S n] to its sources in order), the background and flags
// as shown, the governed references as shown, provenance, and a review status that can only be private_formative.
// One per dedupe key per student: the same request returns the saved one. Absent table (415): nothing is saved.

export type ArtefactRow = {
  id: string; materialId: string; action: string; depth: string; content: string; background: string | null;
  flags: { text: string; cited: number[] }[]; refs: any[]; model: string; promptVersion: string; reviewStatus: "private_formative"; createdAt: string;
  sources: string[];
};
const ARTEFACT_COLS = "id, material_id, action, depth, content, background, flags, refs, model, prompt_version, review_status, created_at";
const toArtefact = (r: any, sources: string[]): ArtefactRow => ({
  id: r.id, materialId: r.material_id, action: r.action, depth: r.depth, content: r.content, background: r.background ?? null,
  flags: Array.isArray(r.flags) ? r.flags : [], refs: Array.isArray(r.refs) ? r.refs : [], model: r.model, promptVersion: r.prompt_version,
  reviewStatus: "private_formative", createdAt: r.created_at, sources,
});

async function artefactSources(admin: Admin, userId: string, ids: string[]): Promise<Map<string, string[]>> {
  if (!ids.length) return new Map();
  const { data } = await admin.from("individual_scholar_artefact_source").select("artefact_id, ordinal, chunk_id").eq("user_id", userId).in("artefact_id", ids).order("ordinal").limit(5000);
  const out = new Map<string, string[]>();
  for (const r of (data ?? []) as any[]) out.set(r.artefact_id, [...(out.get(r.artefact_id) ?? []), r.chunk_id]);
  return out;
}

/** The person's saved artefact for this request, or null (none, or 415 absent). */
export async function findArtefact(admin: Admin, userId: string, dedupeKey: string): Promise<ArtefactRow | null> {
  const { data, error } = await admin.from("individual_scholar_artefact").select(ARTEFACT_COLS).eq("user_id", userId).eq("dedupe_key", dedupeKey).maybeSingle();
  if (error || !data) return null;
  return toArtefact(data, (await artefactSources(admin, userId, [data.id])).get(data.id) ?? []);
}

/** Save (or replace, for the same key) one artefact. "not_provisioned" where 415 is absent. */
export async function saveArtefact(admin: Admin, userId: string, a: {
  materialId: string; action: string; depth: string; content: string; background: string | null; flags: unknown[]; refs: unknown[];
  dedupeKey: string; model: string; promptVersion: string; chunkIds: readonly string[];
}): Promise<"ok" | "not_provisioned" | "failed"> {
  const del = await admin.from("individual_scholar_artefact").delete().eq("user_id", userId).eq("dedupe_key", a.dedupeKey);
  if (del.error) return isNotProvisioned(del.error) ? "not_provisioned" : "failed";
  const { data, error } = await admin.from("individual_scholar_artefact").insert({
    user_id: userId, material_id: a.materialId, action: a.action, depth: a.depth, content: a.content.slice(0, 20000),
    background: a.background ? a.background.slice(0, 2000) : null, flags: a.flags, refs: a.refs, dedupe_key: a.dedupeKey,
    model: a.model.slice(0, 200), prompt_version: a.promptVersion.slice(0, 200), review_status: "private_formative",
  }).select("id").single();
  if (error) return isNotProvisioned(error) ? "not_provisioned" : "failed";
  const rows = a.chunkIds.slice(0, 10).map((chunk_id, i) => ({ artefact_id: data.id, user_id: userId, ordinal: i + 1, chunk_id }));
  const { error: sErr } = rows.length ? await admin.from("individual_scholar_artefact_source").insert(rows.map(r => ({ ...r, user_id: userId }))) : { error: null };
  if (sErr) { await admin.from("individual_scholar_artefact").delete().eq("user_id", userId).eq("id", data.id); return "failed"; }
  return "ok";
}

/** The person's saved artefacts (all, or one material's, or those built on some sections), newest first. */
export async function listArtefacts(admin: Admin, userId: string, opts: { materialId?: string; chunkIds?: readonly string[] } = {}): Promise<Read<ArtefactRow[]>> {
  let ids: string[] | null = null;
  if (opts.chunkIds?.length) {
    const { data, error } = await admin.from("individual_scholar_artefact_source").select("artefact_id").eq("user_id", userId).in("chunk_id", [...opts.chunkIds]).limit(2000);
    if (error) return fail(error);
    ids = [...new Set(((data ?? []) as any[]).map(r => r.artefact_id))];
    if (!ids.length) return { ok: true, data: [] };
  }
  let q = admin.from("individual_scholar_artefact").select(ARTEFACT_COLS).eq("user_id", userId);
  if (opts.materialId) q = q.eq("material_id", opts.materialId);
  if (ids) q = q.in("id", ids);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
  if (error) return fail(error);
  const src = await artefactSources(admin, userId, ((data ?? []) as any[]).map(r => r.id));
  return { ok: true, data: ((data ?? []) as any[]).map(r => toArtefact(r, src.get(r.id) ?? [])) };
}

/**
 * After a material is deleted, what it emptied goes too:
 * - a Learn session with no step left has nothing to teach (414 cascades its steps);
 * - REVISION-01: a saved set or revision session whose questions all went with the material has nothing to replay
 *   (417 cascades its items). Its attempts stay, unlinked (417 sets that one column null).
 * An unreadable child list is not an empty one: nothing is pruned on a failed read.
 */
async function pruneEmptySessions(admin: Admin, userId: string): Promise<void> {
  for (const [parent, items, key] of [["individual_scholar_learning_session", "individual_scholar_learning_step", "session_id"],
    ["individual_scholar_revision_set", "individual_scholar_revision_set_item", "set_id"],
    ["individual_scholar_revision_session", "individual_scholar_revision_session_item", "session_id"]] as const) {
    const { data: rows, error: rErr } = await admin.from(parent).select("id").eq("user_id", userId).limit(1000);
    if (rErr || !rows?.length) continue;
    const { data: kept, error: kErr } = await admin.from(items).select(key).eq("user_id", userId).limit(20000);
    if (kErr) continue;
    const held = new Set(((kept ?? []) as any[]).map(r => r[key]));
    const gone = (rows as any[]).map(r => r.id).filter(id => !held.has(id));
    if (gone.length) await admin.from(parent).delete().eq("user_id", userId).in("id", gone);
  }
}

/** Save the person's own topics for one of their sections. "not_provisioned" where 408 is absent. */
export async function setTopicCorrection(admin: Admin, userId: string, chunkId: string, topics: string[]): Promise<"ok" | "not_found" | "not_provisioned" | "failed"> {
  if (!isUuid(chunkId)) return "not_found";
  const { data: c, error } = await admin.from("individual_scholar_chunk").select("id").eq("user_id", userId).eq("id", chunkId).maybeSingle();
  if (error) return "failed";
  if (!c) return "not_found";
  const { error: uErr } = await admin.from("individual_scholar_topic_correction")
    .upsert({ chunk_id: chunkId, user_id: userId, topics, updated_at: new Date().toISOString() }, { onConflict: "chunk_id" });
  if (uErr) return isNotProvisioned(uErr) ? "not_provisioned" : "failed";
  return "ok";
}

/** Remove the person's correction: the AI topics show again. */
export async function clearTopicCorrection(admin: Admin, userId: string, chunkId: string): Promise<"ok" | "failed"> {
  if (!isUuid(chunkId)) return "ok";
  const { error } = await admin.from("individual_scholar_topic_correction").delete().eq("user_id", userId).eq("chunk_id", chunkId);
  return error && !isNotProvisioned(error) ? "failed" : "ok";
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
export async function addMapping(admin: Admin, userId: string, input: {
  chunkId: string; competencyId: string; layer: Layer; programmeCode: string | null;
  /** UPLOAD-01 U3 (408): the catalogue version, and the outcome the student chose (one of the competency's own). */
  catalogueVersion?: string | null; outcome?: string | null;
}): Promise<"ok" | "exists" | "not_found" | "failed"> {
  if (!isUuid(input.chunkId)) return "not_found";
  const { data: c, error } = await admin.from("individual_scholar_chunk").select("id, material_id").eq("user_id", userId).eq("id", input.chunkId).maybeSingle();
  if (error) return "failed";
  if (!c) return "not_found";
  const row = {
    user_id: userId, material_id: c.material_id, chunk_id: c.id, competency_id: input.competencyId, layer: input.layer,
    source: "student", programme_code: input.programmeCode,
  };
  let { data: m, error: mErr } = await admin.from("individual_scholar_competency_map")
    .insert({ ...row, user_id: userId, catalogue_version: input.catalogueVersion ?? null, outcome: input.outcome ?? null }).select("id").single();
  if (mErr && isNotProvisioned(mErr)) ({ data: m, error: mErr } = await admin.from("individual_scholar_competency_map").insert({ ...row, user_id: userId }).select("id").single());
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
  /** P6: the topics found in each section (chunk id → concepts), for practice by topic. */
  concepts: Map<string, string[]>;
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
      concepts: maps.data.concepts,
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
  const { data, error } = await admin.from("individual_scholar_passport_item").select("id, material_id, achievement, label, included_at")
    .eq("user_id", userId).order("included_at", { ascending: false }).limit(200);
  if (error) return fail(error);
  return {
    ok: true,
    data: ((data ?? []) as any[]).filter(r => isStudyAchievementKind(r.achievement))
      .map(r => ({ itemId: r.id, materialId: r.material_id, achievement: r.achievement, label: r.label, includedAt: r.included_at })),
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

// ── EVALUATION-01 (Stage 6): THE EVIDENCE AN EVALUATION READS, AND THE EVALUATION RECORD (426) ──────────────────
//
// E2: the evidence is READ where it is, never copied: revision answers (372, 416) with the session they came in
// (417), spaced reviews (391) by the question their card is for, Teach Me checks (414 clarify verdicts) with the
// sections their step used, and clinical-case decisions (435) with their case's sections, competencies, context
// and each decision's reasoning dimension. Every read is the caller's own rows. Teach Me explanations are not read.

export type EvaluationEvidenceRows = {
  questions: { id: string; chunkId: string; materialId: string; kind: string; difficulty: number | null; competencyId: string | null; caseId: string | null }[];
  attempts: { id: string; questionId: string; correct: boolean; marking: "deterministic" | "ai_evaluation" | "self_graded"; answeredAt: string; sessionId: string | null; evaluatorModel: string | null }[];
  reviews: { id: string; questionId: string; quality: number; intervalDays: number; reviewedAt: string }[];
  checks: { id: string; chunkIds: string[]; verdict: "understood" | "partly" | "not_yet"; createdAt: string }[];
  decisions: { id: string; caseId: string; decisionPointId: string; dimension: string | null; written: boolean; marking: "deterministic" | "ai_evaluation" | "self_graded";
    correct: boolean | null; safetyMissed: number; createdAt: string; chunkIds: string[]; competencyIds: string[]; context: string }[];
};

/** All of the caller's learning evidence, read in place. A source whose migration is absent reads as none. */
export async function evaluationEvidence(admin: Admin, userId: string): Promise<Read<EvaluationEvidenceRows>> {
  const soft = async (q: PromiseLike<{ data: unknown; error: any }>) => { const r = await q; return r.error && isNotProvisioned(r.error) ? { data: [], error: null } : r; };
  const [q, a, cards, rv, ev, steps, cs, ca] = await Promise.all([
    admin.from("individual_scholar_question").select("id, chunk_id, material_id, kind, difficulty, competency_id, case_id").eq("user_id", userId).limit(5000),
    admin.from("individual_scholar_attempt").select("id, question_id, correct, marking, answered_at, revision_session_id, evaluator_model").eq("user_id", userId).order("answered_at").limit(20000),
    soft(admin.from("individual_scholar_card").select("id, question_id").eq("user_id", userId).limit(5000)),
    soft(admin.from("individual_scholar_review").select("id, card_id, quality, interval_days, reviewed_at").eq("user_id", userId).limit(20000)),
    soft(admin.from("individual_scholar_learning_event").select("id, session_id, step, verdict, created_at").eq("user_id", userId).eq("action", "clarify").not("verdict", "is", null).limit(5000)),
    soft(admin.from("individual_scholar_learning_step").select("session_id, step, chunk_id").eq("user_id", userId).limit(20000)),
    soft(admin.from("individual_scholar_case_session").select("id, private_case_id").eq("user_id", userId).limit(2000)),
    soft(admin.from("individual_scholar_case_answer").select("id, session_id, decision_point_id, chosen_option_ids, marking, correct, safety_criterion_ids, created_at").eq("user_id", userId).limit(20000)),
  ]);
  const err = [q, a, cards, rv, ev, steps, cs, ca].find(r => r.error)?.error;
  if (err) return fail(err);
  const sessions = (cs.data ?? []) as any[];
  const caseIds = [...new Set(sessions.map(s => s.private_case_id).filter(Boolean))];
  const [cases, srcs, comps] = caseIds.length ? await Promise.all([
    soft(admin.from("individual_scholar_case").select("id, context, blueprint").eq("user_id", userId).in("id", caseIds)),
    soft(admin.from("individual_scholar_case_source").select("case_id, chunk_id").eq("user_id", userId).in("case_id", caseIds)),
    soft(admin.from("individual_scholar_case_competency").select("case_id, competency_id").eq("user_id", userId).in("case_id", caseIds)),
  ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  const cErr = [cases, srcs, comps].find(r => r.error)?.error;
  if (cErr) return fail(cErr);
  const cardQ = new Map(((cards.data ?? []) as any[]).map(c => [c.id, c.question_id]));
  const stepChunks = new Map<string, string[]>();
  for (const s of (steps.data ?? []) as any[]) { const k = `${s.session_id}:${s.step}`; stepChunks.set(k, [...(stepChunks.get(k) ?? []), s.chunk_id]); }
  const caseOf = new Map(sessions.map(s => [s.id, s.private_case_id]));
  const caseRow = new Map(((cases.data ?? []) as any[]).map(c => [c.id, c]));
  const caseChunks = new Map<string, string[]>(), caseComps = new Map<string, string[]>();
  for (const s of (srcs.data ?? []) as any[]) caseChunks.set(s.case_id, [...(caseChunks.get(s.case_id) ?? []), s.chunk_id]);
  for (const c of (comps.data ?? []) as any[]) caseComps.set(c.case_id, [...(caseComps.get(c.case_id) ?? []), c.competency_id]);
  return {
    ok: true,
    data: {
      questions: ((q.data ?? []) as any[]).map(r => ({ id: r.id, chunkId: r.chunk_id, materialId: r.material_id, kind: r.kind, difficulty: r.difficulty ?? null, competencyId: r.competency_id ?? null, caseId: r.case_id ?? null })),
      attempts: ((a.data ?? []) as any[]).map(r => ({ id: r.id, questionId: r.question_id, correct: r.correct, marking: r.marking ?? "deterministic", answeredAt: r.answered_at, sessionId: r.revision_session_id ?? null, evaluatorModel: r.evaluator_model ?? null })),
      reviews: ((rv.data ?? []) as any[]).filter(r => cardQ.has(r.card_id)).map(r => ({ id: r.id, questionId: cardQ.get(r.card_id)!, quality: r.quality, intervalDays: r.interval_days, reviewedAt: r.reviewed_at })),
      checks: ((ev.data ?? []) as any[]).map(r => ({ id: r.id, chunkIds: stepChunks.get(`${r.session_id}:${r.step}`) ?? [], verdict: r.verdict, createdAt: r.created_at })),
      decisions: ((ca.data ?? []) as any[]).flatMap(r => {
        const caseId = caseOf.get(r.session_id); const c = caseId ? caseRow.get(caseId) : null;
        if (!caseId || !c) return [];
        const dp = ((c.blueprint?.decisionPoints ?? []) as any[]).find(d => d.id === r.decision_point_id);
        return [{ id: r.id, caseId, decisionPointId: r.decision_point_id, dimension: dp?.dimension ?? null, written: r.chosen_option_ids === null, marking: r.marking,
          correct: r.correct ?? null, safetyMissed: Array.isArray(r.safety_criterion_ids) ? r.safety_criterion_ids.length : 0, createdAt: r.created_at,
          chunkIds: caseChunks.get(caseId) ?? [], competencyIds: caseComps.get(caseId) ?? [], context: c.context ?? "general" }];
      }),
    },
  };
}

export type EvaluationRecord = {
  id: string; kind: "continuous" | "student"; method: "existing" | "fresh" | "combined"; scope: any; context: any;
  freshSessionId: string | null; configVersion: string; criteria: any; results: any; confidence: string; limitations: string[];
  evidenceRefs: any; cfca: any; aiProvenance: any; supersedesId: string | null; createdAt: string;
};
const EVAL_COLS = "id, kind, method, scope, context, fresh_session_id, config_version, criteria, results, confidence, limitations, evidence_refs, cfca, ai_provenance, supersedes_id, created_at";
const toEvaluation = (r: any): EvaluationRecord => ({
  id: r.id, kind: r.kind, method: r.method, scope: r.scope, context: r.context, freshSessionId: r.fresh_session_id, configVersion: r.config_version,
  criteria: r.criteria, results: r.results, confidence: r.confidence, limitations: r.limitations ?? [], evidenceRefs: r.evidence_refs, cfca: r.cfca,
  aiProvenance: r.ai_provenance ?? {}, supersedesId: r.supersedes_id, createdAt: r.created_at,
});

/** E5: keep one evaluation, as it was made (426 refuses any later change). "not_provisioned" where 426 is absent. */
export async function insertEvaluation(admin: Admin, userId: string, e: Omit<EvaluationRecord, "id" | "createdAt">): Promise<{ ok: true; id: string } | { ok: false; notProvisioned: boolean }> {
  const { data, error } = await admin.from("individual_scholar_evaluation").insert({
    user_id: userId, kind: e.kind, method: e.method, scope: e.scope, context: e.context, fresh_session_id: e.freshSessionId, config_version: e.configVersion,
    criteria: e.criteria, results: e.results, confidence: e.confidence, limitations: e.limitations, evidence_refs: e.evidenceRefs, cfca: e.cfca,
    ai_provenance: e.aiProvenance, supersedes_id: e.supersedesId,
  }).select("id").single();
  if (error || !data) return { ok: false, notProvisioned: !!error && isNotProvisioned(error) };
  return { ok: true, id: data.id };
}

/** The caller's evaluations, newest first. */
export async function listEvaluations(admin: Admin, userId: string, limit = 30): Promise<Read<EvaluationRecord[]>> {
  const { data, error } = await admin.from("individual_scholar_evaluation").select(EVAL_COLS).eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(toEvaluation) };
}

/** One of the caller's evaluations. null when it is not theirs. */
export async function getEvaluation(admin: Admin, userId: string, id: string): Promise<Read<EvaluationRecord | null>> {
  if (!isUuid(id)) return { ok: true, data: null };
  const { data, error } = await admin.from("individual_scholar_evaluation").select(EVAL_COLS).eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) return fail(error);
  return { ok: true, data: data ? toEvaluation(data) : null };
}

/** The student removes one of their evaluations: a privacy right, not an edit. A later one that superseded it keeps its own record. */
export async function deleteEvaluation(admin: Admin, userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const { data, error } = await admin.from("individual_scholar_evaluation").delete().eq("user_id", userId).eq("id", id).select("id");
  return !error && (data ?? []).length > 0;
}

// ── PROGRESS-01 P5 (427): EDUCATIONAL EVALUATIONS THE STUDENT CHOSE TO SHOW IN THEIR PASSPORT ──────────────────
//
// The row is the choice; what is shown is derived from the evaluation each time (passport-evaluations.ts).
// "not_provisioned" where 427 is absent: nothing can be shown there, and the Passport says so.

/** The caller's chosen evaluations, derived as the Passport shows them. */
export async function loadPassportEvaluations(admin: Admin, userId: string): Promise<Read<PassportEvaluation[]>> {
  const { data, error } = await admin.from("individual_scholar_passport_evaluation").select("id, evaluation_id, label, included_at").eq("user_id", userId).order("included_at", { ascending: false }).limit(50);
  if (error) return fail(error);
  const rows = (data ?? []) as any[];
  if (!rows.length) return { ok: true, data: [] };
  const { data: ev, error: eErr } = await admin.from("individual_scholar_evaluation").select("id, scope, method, kind, created_at, confidence, results, limitations")
    .eq("user_id", userId).in("id", rows.map(r => r.evaluation_id));
  if (eErr) return fail(eErr);
  const byId = new Map(((ev ?? []) as any[]).map(e => [e.id, e]));
  return { ok: true, data: rows.filter(r => byId.has(r.evaluation_id)).map(r => {
    const e = byId.get(r.evaluation_id);
    return { ...passportEvaluationOf({ id: e.id, scope: e.scope, method: e.method, kind: e.kind, createdAt: e.created_at, confidence: e.confidence, results: e.results, limitations: e.limitations ?? [] }, { label: r.label, includedAt: r.included_at }), itemId: r.id };
  }) };
}

/** Show one of the caller's evaluations in their Passport, with their label. */
export async function addPassportEvaluation(admin: Admin, userId: string, evaluationId: string, label: string): Promise<{ ok: true } | { ok: false; notProvisioned: boolean; notFound?: boolean }> {
  if (!isUuid(evaluationId)) return { ok: false, notProvisioned: false, notFound: true };
  const { data: own, error: oErr } = await admin.from("individual_scholar_evaluation").select("id").eq("user_id", userId).eq("id", evaluationId).maybeSingle();
  if (oErr) return { ok: false, notProvisioned: isNotProvisioned(oErr) };
  if (!own) return { ok: false, notProvisioned: false, notFound: true };
  const { error } = await admin.from("individual_scholar_passport_evaluation").upsert({ user_id: userId, evaluation_id: evaluationId, label }, { onConflict: "user_id,evaluation_id" });
  return error ? { ok: false, notProvisioned: isNotProvisioned(error) } : { ok: true };
}

/** Take one off the Passport: only the choice goes; the evaluation stays. */
export async function removePassportEvaluation(admin: Admin, userId: string, evaluationId: string): Promise<boolean> {
  if (!isUuid(evaluationId)) return false;
  const { error } = await admin.from("individual_scholar_passport_evaluation").delete().eq("user_id", userId).eq("evaluation_id", evaluationId);
  return !error;
}

// ── EXAMINATION PAPERS ── COMPETEN-SCHOLAR-EXAM-PAPERS-01 (570) ─────────────────────────────────────────
//
// Every read and write is scoped by the caller's own user id, and every child row carries a composite key to its paper,
// so another person's ids find nothing. Without migration 570 every read answers notProvisioned, and the feature says it
// is not set up here rather than failing. THE ONE EXCEPTION is the research cache: public web sources only, keyed by a
// hash, with no user id and nothing of a student's (scripts/scholar-learning-harness.ts PUBLIC_TABLES).

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

const EXAM_PAPER_COLS = "material_id, attestation_version, attested_at, extractor, question_count, instructions, flags, created_at";
const toExamPaper = (r: any): ExamPaperRow => ({
  materialId: r.material_id, attestationVersion: r.attestation_version, attestedAt: r.attested_at, extractor: r.extractor,
  questionCount: r.question_count, instructions: r.instructions, flags: Array.isArray(r.flags) ? r.flags : [], createdAt: r.created_at,
});
const EXAM_QUESTION_COLS = "id, material_id, ordinal, number, section, instructions, stem, options, marks, page_from, page_to, chunk_id, source, flags";
const toExamQuestion = (r: any): ExamQuestionRow => ({
  id: r.id, materialId: r.material_id, ordinal: r.ordinal, number: r.number, section: r.section, instructions: r.instructions, stem: r.stem,
  options: Array.isArray(r.options) ? r.options : [], marks: r.marks === null ? null : Number(r.marks), pageFrom: r.page_from, pageTo: r.page_to,
  chunkId: r.chunk_id, source: r.source, flags: Array.isArray(r.flags) ? r.flags : [],
});
const EXAM_ANSWER_COLS = "id, material_id, question_id, kind, attempt, content, evidence, research, model, provider, prompt_version, revision_question_id, created_at";
const toExamAnswer = (r: any): ExamAnswerRow => ({
  id: r.id, materialId: r.material_id, questionId: r.question_id, kind: r.kind, attempt: r.attempt, content: r.content ?? {},
  evidence: Array.isArray(r.evidence) ? r.evidence : [], research: r.research ?? {}, model: r.model, provider: r.provider,
  promptVersion: r.prompt_version, revisionQuestionId: r.revision_question_id, createdAt: r.created_at,
});

export async function getExamPaper(admin: Admin, userId: string, materialId: string): Promise<Read<ExamPaperRow | null>> {
  const { data, error } = await admin.from("individual_scholar_exam_paper").select(EXAM_PAPER_COLS).eq("user_id", userId).eq("material_id", materialId).maybeSingle();
  if (error) return fail(error);
  return { ok: true, data: data ? toExamPaper(data) : null };
}

export async function listExamPapers(admin: Admin, userId: string): Promise<Read<ExamPaperRow[]>> {
  const { data, error } = await admin.from("individual_scholar_exam_paper").select(EXAM_PAPER_COLS).eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(toExamPaper) };
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
  const { data, error } = await admin.from("individual_scholar_exam_question").select(EXAM_QUESTION_COLS).eq("user_id", userId).eq("material_id", materialId).order("ordinal");
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(toExamQuestion) };
}

export async function getExamQuestion(admin: Admin, userId: string, id: string): Promise<ExamQuestionRow | null> {
  const { data } = await admin.from("individual_scholar_exam_question").select(EXAM_QUESTION_COLS).eq("user_id", userId).eq("id", id).maybeSingle();
  return data ? toExamQuestion(data) : null;
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
  const { data, error } = await admin.from("individual_scholar_exam_answer").select(EXAM_ANSWER_COLS).eq("user_id", userId).eq("material_id", materialId).order("created_at", { ascending: false }).limit(500);
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(toExamAnswer) };
}

/** Every saved answer of the person, newest first: Evaluate and Progress read these as formative practice. */
export async function listAllExamAnswers(admin: Admin, userId: string, limit = 500): Promise<Read<ExamAnswerRow[]>> {
  const { data, error } = await admin.from("individual_scholar_exam_answer").select(EXAM_ANSWER_COLS).eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(toExamAnswer) };
}

export async function getExamAnswer(admin: Admin, userId: string, id: string): Promise<ExamAnswerRow | null> {
  const { data } = await admin.from("individual_scholar_exam_answer").select(EXAM_ANSWER_COLS).eq("user_id", userId).eq("id", id).maybeSingle();
  return data ? toExamAnswer(data) : null;
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

// COMPETEN-RESEARCH-01: Learn's Research & Explain. A fresh search writes one audit row (counts only, under its own
// action, so it never spends the hourly AI quota); its AI answers carry their own operation in plat_ai_requests.
export const LEARN_RESEARCH_ENTITY = "individual_scholar_learn_research";
export const LEARN_RESEARCH_AUDIT_ACTION = "scholar_research_search";

/** Fresh Learn research searches the person ran today (UTC). Unreadable: null (refuse). */
export async function learnResearchToday(admin: Admin, userId: string): Promise<number | null> {
  const since = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
  const { count, error } = await admin.from("audit_log").select("id", { count: "exact", head: true })
    .eq("actor_id", userId).eq("action", LEARN_RESEARCH_AUDIT_ACTION).eq("entity_type", LEARN_RESEARCH_ENTITY).gte("created_at", since);
  return error ? null : (count ?? 0);
}

/** Today's recorded AI spend (USD, UTC day) on one operation for the person. Unreadable: null (refuse). */
export async function aiSpendToday(admin: Admin, userId: string, operation: string): Promise<number | null> {
  const since = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
  const { data, error } = await admin.from("plat_ai_requests").select("cost_usd").eq("actor_id", userId).eq("operation", operation).gte("created_at", since).limit(1000);
  if (error) return null;
  return ((data ?? []) as { cost_usd: number | string | null }[]).reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
}

/** The stored original and the extractor of one material (exam-paper transcription reads both). Own rows only. */
export async function materialOriginal(admin: Admin, userId: string, id: string): Promise<{ path: string; extractor: string } | null> {
  const { data } = await admin.from("individual_scholar_material").select("storage_path, extractor").eq("user_id", userId).eq("id", id).maybeSingle();
  return data ? { path: (data as any).storage_path, extractor: (data as any).extractor ?? "" } : null;
}
// ── WHAT THE STUDENT ALREADY HAS, BEFORE ANYTHING NEW IS WRITTEN ── COMPETEN-SCHOLAR-AI-OPT-01 (Wave 2, s6) ─────────
//
// Saved private content is offered again before new AI is paid for: unanswered questions on a section, a step-by-step
// case already written from it, a private case already written from the same sections. Learn's saved explanations
// (learn/act, artefactKey) and Revise's reuse-first pool (revision/sessions) already do this and are not touched.
// The student can always ask for a new one (`fresh`): this offers, it never refuses.
//
// Only the caller's own rows, by user_id, and only at the CURRENT prompt version: content written under an older
// prompt is not offered as if it were what the student would get now. Unreadable is "nothing saved" -- the request
// goes ahead exactly as before.

/** How many of the student's questions of this kind on this section, at this prompt version, they have never answered. */
export async function unansweredQuestions(admin: Admin, userId: string, chunkId: string, kind: "mcq" | "case", promptVersion: string): Promise<number> {
  try {
    const q = await admin.from("individual_scholar_question").select("id")
      .eq("user_id", userId).eq("chunk_id", chunkId).eq("kind", kind).eq("prompt_version", promptVersion).is("case_id", null).limit(50);
    const ids = ((q.data ?? []) as { id: string }[]).map(r => r.id);
    if (q.error || !ids.length) return 0;
    const a = await admin.from("individual_scholar_attempt").select("question_id").eq("user_id", userId).in("question_id", ids);
    if (a.error) return 0;
    const answered = new Set(((a.data ?? []) as { question_id: string }[]).map(r => r.question_id));
    return ids.filter(id => !answered.has(id)).length;
  } catch { return 0; }
}

/** The newest step-by-step case already written from this section at this prompt version, or null. */
export async function storedStepCase(admin: Admin, userId: string, chunkId: string, promptVersion: string): Promise<{ caseId: string; title: string } | null> {
  try {
    const { data, error } = await admin.from("individual_scholar_question").select("case_id, case_title")
      .eq("user_id", userId).eq("chunk_id", chunkId).eq("kind", "case").eq("case_step", 1).eq("prompt_version", promptVersion)
      .not("case_id", "is", null).order("created_at", { ascending: false }).limit(1);
    if (error || !data?.length) return null;
    return { caseId: data[0].case_id, title: data[0].case_title ?? "Practice case" };
  } catch { return null; }
}

/** The newest private case written from exactly these sections, in this clinical context, at this prompt version. */
export async function storedPrivateCase(admin: Admin, userId: string, chunkIds: readonly string[], context: string, promptVersion: string): Promise<{ caseId: string; title: string } | null> {
  try {
    const want = [...new Set(chunkIds)].sort();
    if (!want.length) return null;
    const c = await admin.from("individual_scholar_case").select("id, title")
      .eq("user_id", userId).eq("context", context).eq("prompt_version", promptVersion).order("created_at", { ascending: false }).limit(30);
    const cases = (c.data ?? []) as { id: string; title: string }[];
    if (c.error || !cases.length) return null;
    const s = await admin.from("individual_scholar_case_source").select("case_id, chunk_id").eq("user_id", userId).in("case_id", cases.map(x => x.id));
    if (s.error) return null;
    const by = new Map<string, string[]>();
    for (const r of (s.data ?? []) as { case_id: string; chunk_id: string }[]) by.set(r.case_id, [...(by.get(r.case_id) ?? []), r.chunk_id]);
    const same = cases.find(x => { const got = [...new Set(by.get(x.id) ?? [])].sort(); return got.length === want.length && got.every((v, i) => v === want[i]); });
    return same ? { caseId: same.id, title: same.title } : null;
  } catch { return null; }
}

// ── SCHOLAR-AI-OPT-01: THE OUTPUT BEHIND A LEARNER'S FEEDBACK (feedback.ts) ──

const FEEDBACK_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ResolvedOutput = { kind: import("@/lib/ai/outcomes").AiOutputKind; activity: string; promptVersion: string | null; actionId: string | null };

/** The caller's own output behind a feedback request, or null when it is not theirs (or not readable). */
export async function resolveFeedbackTarget(admin: any, userId: string, target: import("./feedback").FeedbackTarget, ref: string): Promise<ResolvedOutput | null> {
  if (!FEEDBACK_UUID.test(ref)) return null;
  try {
    if (target === "artefact") {
      const { data } = await admin.from("individual_scholar_artefact").select("action, prompt_version").eq("user_id", userId).eq("id", ref).maybeSingle();
      return data ? { kind: "explanation", activity: `learn:${data.action}`, promptVersion: data.prompt_version, actionId: null } : null;
    }
    if (target === "question") {
      const { data } = await admin.from("individual_scholar_question").select("kind, prompt_version").eq("user_id", userId).eq("id", ref).maybeSingle();
      return data ? { kind: "question", activity: data.kind, promptVersion: data.prompt_version, actionId: null } : null;
    }
    if (target === "case") {
      const { data } = await admin.from("individual_scholar_case").select("prompt_version").eq("user_id", userId).eq("id", ref).maybeSingle();
      return data ? { kind: "case", activity: "case_blueprint", promptVersion: data.prompt_version, actionId: null } : null;
    }
    if (target === "step_case") {
      const { data } = await admin.from("individual_scholar_question").select("prompt_version").eq("user_id", userId).eq("case_id", ref).limit(1);
      return data?.length ? { kind: "case", activity: "case_steps", promptVersion: data[0].prompt_version, actionId: null } : null;
    }
    // An unstored explanation: the action that produced it, which must be a Scholar outcome. The feedback key carries the
    // caller's id, so naming someone else's action only ever writes the caller's own single row.
    const { data } = await admin.from("plat_ai_outcomes").select("activity, output_kind, prompt_version").eq("action_id", ref).eq("product", "scholar").maybeSingle();
    return data ? { kind: data.output_kind, activity: data.activity, promptVersion: data.prompt_version, actionId: ref } : null;
  } catch { return null; }
}
