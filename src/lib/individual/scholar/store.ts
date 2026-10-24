/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { sm2 } from "@/lib/delivery/reinforcement";
import { isNotProvisioned } from "../access";
import { BUCKET, CONSENT_FEATURE, CONSENT_NOTICE_VERSION, MAX_MATERIALS_PER_PERSON, PPTX_MIME, UNIT_OF, type MaterialMime } from "./config";
import type { Chunk, ExtractionQuality } from "./extract";
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
  return { ok: !cErr || isNotProvisioned(cErr), erased: rows.length };
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
  id: string; materialId: string; chunkId: string; kind: QuestionKind; stem: string; options: string[];
  correctIndex: number; rationale: string; sourceQuote: string; model: string; promptVersion: string; createdAt: string;
  materialTitle: string; ordinal: number | null; pageFrom: number | null; pageTo: number | null;
  /** UPLOAD-01: the material's citable unit, so a question from a PowerPoint cites its slide. */
  unit: "page" | "slide" | "section";
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
      promptVersion: r.prompt_version, createdAt: r.created_at, materialTitle: (titles.get(r.material_id) ?? UNNAMED).title,
      unit: (titles.get(r.material_id) ?? UNNAMED).unit,
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
