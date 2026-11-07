/* eslint-disable @typescript-eslint/no-explicit-any */
import { applySlideFacts, pictureReadingInput, type SlideFacts, type SlideSkipReason } from "./slide-classify";
import { parseAskSources } from "./ask-sources";
import { linkColumns, type CreateInput, type PatchInput } from "./personal-notebook";
import { DIFFICULTY_NUMBER } from "./library-meta";
import { createHash } from "node:crypto";
import { cache } from "react";
import { sm2 } from "@/lib/delivery/reinforcement";
import { isNotProvisioned } from "../access";
import { ABANDON_AFTER_MS, SETTLED_RETENTION_MS, STALE_CLAIM_MS, abandonedObjects, finishDecision, reusable, type UploadRow } from "./upload-record";
import { parseLessonTitles } from "./learn-recut";
import { learningPlanSchema } from "../learning-plan/event-store";
import type { GoalType } from "../learning-plan/types";
import { LEARNER_CARD, BUCKET, DOCX_MIME, CONSENT_FEATURE, CONSENT_NOTICE_VERSION, CROSS_EXPERIENCE_FEATURE, CROSS_EXPERIENCE_NOTICE_VERSION, SEARCH_HISTORY_FEATURE, SEARCH_HISTORY_NOTICE_VERSION, MAX_MATERIALS_PER_PERSON, PPTX_MIME, UNIT_OF, type MaterialMime } from "./config";
import type { AiReading, Chunk, ExtractionQuality } from "./extract";
import { planChunkInsertion, type NewChunk } from "./slide-images";
import type { CandidateChunk } from "./retrieval";
import type { DraftQuestion, Passage, QuestionKind } from "./generation";
import { SET_CHECK_KINDS } from "./question-formats";
import { SRS_DEFAULTS, scheduleReview, storedKind, type RevisionDraft, type RevisionKind, type SrsParams } from "./revision";
import { MISTAKES_ROW_CAP, toFixIds, type AttemptMark, type MistakeAttempt, type MistakeQuestion } from "./mistakes";
import type { ProgressAttempt, ProgressCard, ProgressMaterial, ProgressQuestion } from "./progress";
import { isLayer, type Layer, type ProgrammeConfig } from "./catalogue";
import { mappingStates, type LiveMapping, type MappingDecision, type MappingState, type MappingSubject, type SubjectAnalysis } from "@/lib/competency/mapping";

export type MapSource = "ai" | "student" | "reviewer";
import { STUDY_ACHIEVEMENT, countsForAchievement, isStudyAchievementKind, studyAchievementsFrom, type ChoiceRow, type StudyAchievement, type StudyAchievementKind } from "./passport-items";
import { passportEvaluationOf, type PassportEvaluation } from "./passport-evaluations";
import type { ExamOption, PaperFlag, ParsedQuestion, QuestionFlag } from "./exam-paper";
import { stemKey } from "./question-intel";
import { formativeOf, type FormativeFeedback } from "./written-feedback";
import { EXTENDED_POINTS_MAX, EXTENDED_POINTS_MIN } from "./config";
import { parseCheckResponse, type CheckHistoryItem } from "./learn-check-record";
import { servableLibraryVersions, type LibraryPick } from "./library-questions";
import type { ResearchSource } from "./exam-research";
import type { OsceDefinition, OsceItem, OsceSource, OsceStationDraft, OsceTick } from "./osce";
import { guidanceJson, readDefinition } from "./osce";
import type { CardRowExtras, PersonalDeck } from "./flashcards";
import { isStudyLinkKind, isStudySpace, studyFields, type StudyFieldsInput, type StudyLinkKind, type StudySpace } from "./study-session";
import { positionFromRow, type PositionPut, type ServerPosition } from "./learn-position";
import { newestSavedLesson, type LessonRecord } from "./learn-journey";
import { baseKey, keysetFilter, orderVersions, pageOf, supersededKey, type Cursor, type NoteInput, type NoteKind, type NoteTarget } from "./saved-library";
import { readFrameworkProvenance } from "@/lib/competency/framework-provenance";
import { correctionFromRow, provenance990Keys, provenanceOf, snapshotFromRow, snapshotInsertRow, withMappingStatus, type AttemptIntegrity, type CompetencyProvenance, type AttemptSnapshotRow, type CorrectionBasis, type CorrectionRow, type Outcome } from "./attempt-snapshot";
import { HISTORY_ACTIVITIES, HISTORY_PAGE_SIZE, SHOW_ACTIVITIES, markKey, mergeHistoryPages, repeatsLatest, type CaptureInput, type EntryRef, type HistoryActivity, type HistoryEntry, type HistoryQuery } from "./search-history";
import { rangeBounds } from "./saved-library";

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

export type Admin = any;

// ── MIGRATION 710 (SCHOLAR-SQIE-CLOSE-01) ── detected once, and Scholar keeps working without it ──────────────────
//
// 710 lets an mcq or case keep its rubric, stores structured questions, and holds governed library copies. Where it is
// absent all three are simply not done: the rubric is used at generation and not stored, structured is not offered, and
// no library question is reused -- exactly the 416 behaviour. Detected by one read of a 710 column, remembered for the
// process. A 710 refusal seen later (a CHECK or column error on a 710 write) also marks it absent.
let sqie710: boolean | null = null;
/** Whether migration 710 is applied on this environment. A transient read error is "no" for now, and asked again. */
export async function sqieSchema(admin: Admin, userId: string): Promise<boolean> {
  if (sqie710 !== null) return sqie710;
  // Keyed on the caller, as every read here is: it fails only where the 710 column is missing.
  const { error } = await admin.from("individual_scholar_question").select("library_version_id").eq("user_id", userId).limit(1);
  if (!error) return (sqie710 = true);
  if (isNotProvisioned(error)) return (sqie710 = false);
  return false;
}
/** A 710 write was refused: 710 is treated as absent from now on in this process. */
export const markSqieAbsent = () => { sqie710 = false; };
/** Tests only: forget what was detected. */
export const resetSqieSchema = () => { sqie710 = null; };
const isSchemaRefusal = (error: any) => !!error && (String(error.code ?? "") === "23514" || isNotProvisioned(error) || /check constraint|column|schema cache/i.test(String(error.message ?? "")));
export type Read<T> = { ok: true; data: T } | { ok: false; notProvisioned: boolean };
const fail = (error: unknown): { ok: false; notProvisioned: boolean } => ({ ok: false, notProvisioned: isNotProvisioned(error) });
const todayIso = () => new Date().toISOString().slice(0, 10);

// ── CONSENT ────────────────────────────────────────────────────────────────────────────────────────

/** The consents this table holds: uploads (372), the cross-experience context (700) and My Search History (993). */
export type ConsentFeature = typeof CONSENT_FEATURE | typeof CROSS_EXPERIENCE_FEATURE | typeof SEARCH_HISTORY_FEATURE;

/** granted: the person acted to agree. notified (994, My Search History only): they were shown the notice and did nothing else, which is not an agreement. */
export type ConsentState = { granted: boolean; notified: boolean; noticeVersion: string | null; grantedAt: string | null; revokedAt: string | null; updatedAt: string | null };

export async function readConsent(admin: Admin, userId: string, feature: ConsentFeature = CONSENT_FEATURE): Promise<Read<ConsentState>> {
  const { data, error } = await admin.from("individual_scholar_consent")
    .select("status, notice_version, granted_at, revoked_at, updated_at")
    .eq("user_id", userId).eq("feature", feature).maybeSingle();
  if (error) return fail(error);
  return {
    ok: true,
    data: data
      ? { granted: data.status === "granted", notified: data.status === "notified", noticeVersion: data.notice_version, grantedAt: data.granted_at, revokedAt: data.revoked_at, updatedAt: data.updated_at ?? null }
      : { granted: false, notified: false, noticeVersion: null, grantedAt: null, revokedAt: null, updatedAt: null },
  };
}

/** Grant or revoke. A grant records the notice version shown. A revoke keeps it, and says when. */
export async function setConsent(admin: Admin, userId: string, grant: boolean, feature: ConsentFeature = CONSENT_FEATURE): Promise<{ ok: boolean }> {
  const now = new Date().toISOString();
  if (grant) {
    const { error } = await admin.from("individual_scholar_consent").upsert({
      user_id: userId, feature, status: "granted", ...(feature === CONSENT_FEATURE ? { notice_version: CONSENT_NOTICE_VERSION } : { notice_version: feature === SEARCH_HISTORY_FEATURE ? SEARCH_HISTORY_NOTICE_VERSION : CROSS_EXPERIENCE_NOTICE_VERSION }),
      granted_at: now, revoked_at: null, updated_at: now,
    }, { onConflict: "user_id,feature" });
    return { ok: !error };
  }
  // My Search History is on by default, so turning it off must be recorded even by a learner with no row yet (994: with no grant time, as they granted nothing).
  if (feature === SEARCH_HISTORY_FEATURE) {
    const { error: iErr } = await admin.from("individual_scholar_consent").upsert({
      user_id: userId, feature, status: "revoked", notice_version: SEARCH_HISTORY_NOTICE_VERSION, granted_at: null, revoked_at: now, updated_at: now,
    }, { onConflict: "user_id,feature", ignoreDuplicates: true });
    if (iErr) return { ok: false };
  }
  const { error } = await admin.from("individual_scholar_consent")
    .update({ status: "revoked", revoked_at: now, updated_at: now })
    .eq("user_id", userId).eq("feature", feature);
  return { ok: !error };
}

/**
 * The learner was shown the My Search History notice (994). That is what this records: status notified, never a grant. It only ever fills a gap: a
 * learner who has acted, either way, keeps what they did, and a notice seen late cannot overwrite it. A learner who saw an earlier notice moves to this one.
 * "recorded" is a new fact, so the route audits it. "already" is nothing new. "failed": nothing is recorded, so nothing is kept.
 */
export async function recordSearchHistoryNoticeSeen(admin: Admin, userId: string): Promise<"recorded" | "already" | "failed"> {
  const now = new Date().toISOString();
  const { data, error } = await admin.from("individual_scholar_consent").upsert({
    user_id: userId, feature: SEARCH_HISTORY_FEATURE, status: "notified", notice_version: SEARCH_HISTORY_NOTICE_VERSION, granted_at: null, revoked_at: null, updated_at: now,
  }, { onConflict: "user_id,feature", ignoreDuplicates: true }).select("user_id");
  if (error) return "failed";
  if ((data ?? []).length > 0) return "recorded";
  const { data: moved, error: uErr } = await admin.from("individual_scholar_consent")
    .update({ notice_version: SEARCH_HISTORY_NOTICE_VERSION, updated_at: now })
    .eq("user_id", userId).eq("feature", SEARCH_HISTORY_FEATURE).eq("status", "notified").neq("notice_version", SEARCH_HISTORY_NOTICE_VERSION).select("user_id");
  if (uErr) return "failed";
  return (moved ?? []).length > 0 ? "recorded" : "already";
}

/** Migration 700: the cross-experience consent, current only for the notice version now shown. */
export async function crossExperienceConsented(admin: Admin, userId: string): Promise<boolean> {
  const r = await readConsent(admin, userId, CROSS_EXPERIENCE_FEATURE);
  return r.ok && r.data.granted && r.data.noticeVersion === CROSS_EXPERIENCE_NOTICE_VERSION;
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

/** MY PLAN PERF: read once per request (React cache(): a no-op outside a render, so routes always read fresh). Callers must not mutate the result. */
export const listMaterials = cache(async (admin: Admin, userId: string): Promise<Read<MaterialRow[]>> => {
  const { data, error } = await admin.from("individual_scholar_material").select(MATERIAL_COLS)
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(MAX_MATERIALS_PER_PERSON);
  if (error) return fail(error);
  return { ok: true, data: (data ?? []).map(toMaterial) };
});

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

/**
 * A one-time signed upload token for <user_id>/<uploadId>.<ext>. SCHOLAR-CE07C: `existingId` re-issues a token for the
 * SAME path, so an interrupted upload continues under the same identity (the path is still built from the caller's
 * own id, so it can only ever be their own folder).
 */
export async function createUploadSlot(admin: Admin, userId: string, mime: MaterialMime, existingId?: string): Promise<{ uploadId: string; path: string; token: string } | null> {
  const uploadId = existingId && isUuid(existingId) ? existingId : crypto.randomUUID();
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
}): Promise<{ ok: true; id: string; qualityStored: boolean; existing?: boolean } | { ok: false; error: string; detail?: string }> {
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
    // SCHOLAR-CE07C: a second finish of the SAME upload (a retry after a lost response) collides with the material the
    // first one kept, on its id, path or sha256. That object belongs to the kept material: never remove it.
    const { data: kept } = await admin.from("individual_scholar_material").select("id").eq("user_id", userId).eq("id", id).maybeSingle();
    if (kept) return { ok: true, id, qualityStored, existing: true };
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
// SCHOLAR-UPLOAD-FIX: ai_read_units / ai_tried_units are extra keys. 406's CHECK requires the five keys and allows others.
const toQualityJson = (q: ExtractionQuality) => ({
  unit: q.unit, units: q.units, empty_units: q.emptyUnits, chars: q.chars, sections: q.sections,
  ...(q.aiReadUnits ? { ai_read_units: q.aiReadUnits } : {}), ...(q.aiTriedUnits ? { ai_tried_units: q.aiTriedUnits } : {}),
  ...(q.aiProvenance?.length ? { ai_provenance: q.aiProvenance.map(r => ({ units: r.units, model: r.model, prompt_version: r.promptVersion, extracted_at: r.extractedAt })) } : {}),
  // SCHOLAR-PPTX-READING-01: extra keys again, so no migration.
  ...(q.aiSkipped?.length ? { ai_skipped: q.aiSkipped } : {}),
  ...(q.slideFacts ? { slide_facts: q.slideFacts } : {}),
});
const slideFactsOf = (v: any): SlideFacts | undefined => v && typeof v === "object" && Array.isArray(v.blank) && Array.isArray(v.mixed) && Array.isArray(v.review)
  ? { version: Number(v.version), checkedAt: String(v.checkedAt ?? ""), blank: v.blank.map(Number), mixed: v.mixed.map(Number), grouped: Array.isArray(v.grouped) ? v.grouped.map(Number) : [], decorativeOnly: Array.isArray(v.decorativeOnly) ? v.decorativeOnly.map(Number) : [],
      review: v.review.map((r: any) => ({ unit: Number(r.unit), kinds: Array.isArray(r.kinds) ? r.kinds : [], picture: !!r.picture })) }
  : undefined;
const skippedOf = (v: unknown): { unit: number; reason: SlideSkipReason }[] | undefined => Array.isArray(v) ? v.map((s: any) => ({ unit: Number(s?.unit), reason: s?.reason })) : undefined;
const provenance = (v: unknown): AiReading[] | undefined => Array.isArray(v)
  ? v.filter((r: any) => r && Array.isArray(r.units) && typeof r.model === "string").map((r: any) => ({ units: r.units.map(Number).filter(Number.isFinite), model: String(r.model), promptVersion: String(r.prompt_version ?? ""), extractedAt: String(r.extracted_at ?? "") }))
  : undefined;
const numbers = (v: unknown): number[] | undefined => Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : undefined;
export const fromQualityJson = (j: any): ExtractionQuality | null =>
  j && typeof j === "object" && Array.isArray(j.empty_units)
    ? {
      unit: j.unit, units: Number(j.units), emptyUnits: (j.empty_units as unknown[]).map(Number), chars: Number(j.chars), sections: Number(j.sections),
      ...(numbers(j.ai_read_units) ? { aiReadUnits: numbers(j.ai_read_units) } : {}), ...(numbers(j.ai_tried_units) ? { aiTriedUnits: numbers(j.ai_tried_units) } : {}),
      ...(provenance(j.ai_provenance) ? { aiProvenance: provenance(j.ai_provenance) } : {}),
      ...(skippedOf(j.ai_skipped) ? { aiSkipped: skippedOf(j.ai_skipped) } : {}),
      ...(slideFactsOf(j.slide_facts) ? { slideFacts: slideFactsOf(j.slide_facts) } : {}),
    }
    : null;

/**
 * SCHOLAR-CE07C: the kept material with this upload id, for an idempotent finish (the same answer the first finish gave).
 * The id is the caller's own upload id, matched on their own user_id.
 */
export async function keptMaterial(admin: Admin, userId: string, id: string): Promise<{ id: string; mime: MaterialMime; chunks: number; pages: number | null; quality: ExtractionQuality | null } | null | "unreadable"> {
  if (!isUuid(id)) return null;
  const { data, error } = await admin.from("individual_scholar_material").select("*").eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) return "unreadable";
  if (!data) return null;
  return { id: data.id, mime: data.mime_type, chunks: Number(data.chunk_count), pages: data.page_count ?? null, quality: fromQualityJson(data.extraction_quality) };
}

/** SCHOLAR-VISUAL-001 phase 2: the stored images of drawn slides, for erasure. Absent table (1010 not applied): none. Null: could not be read. */
async function renderPaths(admin: Admin, userId: string, materialId?: string): Promise<string[] | null> {
  let q = admin.from("individual_scholar_material_render").select("units").eq("user_id", userId);
  if (materialId) q = q.eq("material_id", materialId);
  const { data, error } = await q;
  if (error) return isNotProvisioned(error) ? [] : null;
  return ((data ?? []) as { units: unknown }[]).flatMap(r => (Array.isArray(r.units) ? r.units as { path?: unknown }[] : []))
    .map(u => u.path).filter((p): p is string => typeof p === "string" && p.startsWith(`${userId}/`));
}

/** Owner erasure of one material: the object, then the row (which cascades to everything derived). */
export async function deleteMaterial(admin: Admin, userId: string, id: string): Promise<{ ok: boolean; found: boolean }> {
  if (!isUuid(id)) return { ok: true, found: false };
  const { data, error } = await admin.from("individual_scholar_material").select("id, storage_path")
    .eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) return { ok: false, found: false };
  if (!data) return { ok: true, found: false };
  const drawn = await renderPaths(admin, userId, id);
  if (drawn === null) return { ok: false, found: true };
  // By its name as well as its record: a job killed part-way, or finishing right now, can have stored an image the record does not name yet.
  const unrecorded = await admin.storage.from(BUCKET).list(userId, { limit: 1000, search: `render-${id}-` });
  if (unrecorded.error) return { ok: false, found: true };
  const rm = await admin.storage.from(BUCKET).remove([data.storage_path, ...drawn, ...((unrecorded.data ?? []) as { name: string }[]).map(o => `${userId}/${o.name}`)]);
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
  // SCHOLAR-VISUAL-001 phase 2: drawn slides by their recorded paths too, since a person can hold more objects than one listing returns.
  const drawn = await renderPaths(admin, userId);
  if (drawn === null) return { ok: false, erased: 0 };
  const paths = [...new Set([...rows.map(r => r.storage_path), ...((listed.data ?? []) as any[]).map(o => `${userId}/${o.name}`), ...drawn])];
  for (let i = 0; i < paths.length; i += 500) {
    const rm = await admin.storage.from(BUCKET).remove(paths.slice(i, i + 500));
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
  // SCHOLAR-PRACTICE-EXAMS-01 (720): OSCE practice stations go too, and their runs by cascade. Stations written from a
  // material already went with it. Absent table: nothing to do.
  const { error: osErr } = await admin.from("individual_scholar_osce_station").delete().eq("user_id", userId);
  // SCHOLAR-FLASHCARDS-01 (730): the flashcard decks go too. Their cards and card marks went with the questions. Absent table: nothing to do.
  const { error: fdErr } = await admin.from("individual_scholar_flashcard_deck").delete().eq("user_id", userId);
  // SCHOLAR-LIBRARY-01 (820): the learner's notes, bookmarks and highlights go too (each also cascades with what it is on). Absent table: nothing to do.
  const { error: ntErr } = await admin.from("individual_scholar_note").delete().eq("user_id", userId);
  // SCHOLAR-CE-2026 CE-04 (880): the simulated-patient conversations go too, library plays included (their sessions are not material, so
  // no cascade reaches them). Private plays also cascade with their case. The function is the guard's one other way out. Absent: nothing to do.
  const { error: cvErr } = await admin.rpc("individual_scholar_case_conversation_erase", { p_user: userId });
  // CHECKLIST STUDIO S3a (893): the learner's own assessments go too -- instances, answers, evidence, comments, outcomes, progression
  // decisions and grants of their own. A DB function does it (the capture guards only let a delete through a trigger level, so the
  // function drives the delete from a receipt insert). It returns the storage paths of uploaded evidence, which the route that stores
  // evidence files removes. Absent function (893 not applied): nothing to do.
  const { error: asErr } = await admin.rpc("asmt_scholar_erase_user", { p_user: userId });
  // SCHOLAR-CE07C (960): the records of uploads in flight go too (they hold a sha256 of the learner's file). Absent: nothing to do.
  const { error: upErr } = await admin.from("individual_scholar_upload").delete().eq("user_id", userId);
  const fine = (e: any) => !e || isNotProvisioned(e);
  return { ok: fine(upErr) && fine(asErr) && fine(cvErr) && fine(cErr) && fine(lErr) && fine(pErr) && fine(rsErr) && fine(rtErr) && fine(evErr) && fine(osErr) && fine(fdErr) && fine(ntErr), erased: rows.length };
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

/**
 * SCHOLAR-LEARN-GAPS-02 item 5: the extraction quality (406) of some of the caller's own materials, in ONE bounded read, keyed
 * on the caller. Absent migration or a failed read: an empty map (nothing is then marked, never an error).
 */
export async function materialQualities(admin: Admin, userId: string, ids: string[]): Promise<Map<string, ExtractionQuality | null>> {
  const out = new Map<string, ExtractionQuality | null>();
  const keep = [...new Set(ids.filter(isUuid))].slice(0, 60);
  if (!keep.length) return out;
  const q = await admin.from("individual_scholar_material").select("id, extraction_quality").eq("user_id", userId).in("id", keep);
  if (q.error) return out;
  for (const r of (q.data ?? []) as any[]) out.set(r.id, fromQualityJson(r.extraction_quality));
  return out;
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
  /**
   * SCHOLAR-SQIE-CLOSE-01 (710): a copy of a governed library question -- its resource, version and approval -- or null
   * for the student's own. A copy whose version is no longer published and approved is not returned at all.
   */
  library?: LibraryProvenance | null;
};
export type LibraryProvenance = {
  resourceId: string; versionId: string; versionNo: number; approval: "clinically_approved";
  /** SCHOLAR-FLASHCARDS-QA-01: the resource's own title and code and the version's publication date, where 442 holds them (cited, never invented). */
  title?: string; code?: string; publishedAt?: string;
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
  // SCHOLAR-SQIE-CLOSE-01 (710): an mcq or case keeps its rubric in `answer` (a rubric only). Without 710 it is not stored.
  let withRubric = input.drafts.some(d => d.rubric) && await sqieSchema(admin, userId);
  const rows = (withDifficulty: boolean) => input.drafts.map((d, i) => ({
    user_id: userId, material_id: input.passage.materialId, chunk_id: input.passage.chunkId, kind: input.kind,
    stem: d.stem, options: d.options, correct_index: d.correctIndex, rationale: d.rationale, source_quote: d.sourceQuote,
    model: input.model, provider: input.provider, prompt_version: input.promptVersion,
    ...(input.competencyId ? { competency_id: input.competencyId } : {}),
    ...(input.caseId ? { case_id: input.caseId, case_step: i + 1, ...(i === 0 ? { case_title: input.caseTitle ?? null } : {}) } : {}),
    // SCHOLAR-QUESTION-INTELLIGENCE-01: its difficulty (416's column, any kind).
    ...(withDifficulty && d.difficulty ? { difficulty: d.difficulty } : {}),
    ...(withRubric && d.rubric ? { answer: { rubric: d.rubric } } : {}),
  }));
  let { data, error } = await admin.from("individual_scholar_question").insert(rows(true).map(r => ({ ...r, user_id: userId }))).select("id");
  // 710 absent after all (or refused the rubric): stored as 416 stores it, without the rubric, and not tried again.
  if (error && withRubric && isSchemaRefusal(error)) {
    markSqieAbsent(); withRubric = false;
    ({ data, error } = await admin.from("individual_scholar_question").insert(rows(true).map(r => ({ ...r, user_id: userId }))).select("id"));
  }
  // Where 416 is absent the column is not there: the question is stored exactly as before.
  if (error && /column|schema cache/i.test(String((error as any)?.message ?? "")) && input.drafts.some(d => d.difficulty))
    ({ data, error } = await admin.from("individual_scholar_question").insert(rows(false).map(r => ({ ...r, user_id: userId }))).select("id"));
  if (error) return { ok: false, ids: [] };
  return { ok: true, ids: ((data ?? []) as any[]).map(r => r.id) };
}

async function hydrate(admin: Admin, userId: string, rows: any[]): Promise<QuestionRow[]> {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [titles, chunksRes, attRes, extra, revision, library] = await Promise.all([
    titlesOf(admin, userId, [...new Set(rows.map(r => r.material_id as string))]),
    admin.from("individual_scholar_chunk").select("id, ordinal, page_from, page_to").eq("user_id", userId).in("id", [...new Set(rows.map(r => r.chunk_id as string))]),
    admin.from("individual_scholar_attempt").select("question_id, correct, chosen_index, answered_at").eq("user_id", userId).in("question_id", ids).order("answered_at", { ascending: false }),
    questionExtras(admin, userId, ids),
    revisionExtras(admin, userId, ids),
    libraryExtras(admin, userId, ids),
  ]);
  const chunk = new Map(((chunksRes.data ?? []) as any[]).map(c => [c.id, c]));
  // A library copy is offered only while its version is still published and clinically approved (library-questions.ts).
  const servable = library.size ? await servableLibraryVersions(admin, [...library.values()].map(l => l.versionId)) : new Map();
  const live = rows.filter(r => !library.has(r.id) || servable.has(library.get(r.id)!.versionId));
  const latest = new Map<string, any>();
  for (const a of (attRes.data ?? []) as any[]) if (!latest.has(a.question_id)) latest.set(a.question_id, a);
  return live.map(r => {
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
      library: library.has(r.id) ? (() => {
        const v = servable.get(library.get(r.id)!.versionId)!;
        return { ...library.get(r.id)!, versionNo: v.versionNo, approval: "clinically_approved" as const, ...(v.title ? { title: v.title } : {}), ...(v.code ? { code: v.code } : {}), ...(v.publishedAt ? { publishedAt: v.publishedAt } : {}) };
      })() : null,
    };
  });
}

/** The 710 library columns, read apart: where 710 is absent there are none (and nothing is read once that is known). */
async function libraryExtras(admin: Admin, userId: string, ids: string[]): Promise<Map<string, { resourceId: string; versionId: string }>> {
  if (!ids.length || sqie710 === false) return new Map();
  const { data, error } = await admin.from("individual_scholar_question").select("id, library_resource_id, library_version_id")
    .eq("user_id", userId).in("id", ids).not("library_version_id", "is", null);
  if (error) return new Map();
  return new Map(((data ?? []) as any[]).map(r => [r.id, { resourceId: r.library_resource_id, versionId: r.library_version_id }]));
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
/** SQIE-LIBRARY-GAPS-01: the ids of every question (any kind) written from one material, read before the material is deleted. null = unreadable. */
export async function questionIdsOfMaterial(admin: Admin, userId: string, materialId: string): Promise<string[] | null> {
  if (!isUuid(materialId)) return [];
  const { data, error } = await admin.from("individual_scholar_question").select("id").eq("user_id", userId).eq("material_id", materialId).limit(5000);
  return error ? null : ((data ?? []) as any[]).map(r => String(r.id));
}

/**
 * SCHOLAR-QUESTION-INTELLIGENCE-01: the stored stems of one material's questions (every kind), reduced for duplicate
 * detection (question-intel.ts stemKey). Empty where unreadable: a repeat then costs a duplicate, never a refusal.
 */
export async function questionStems(admin: Admin, userId: string, materialId: string): Promise<Set<string>> {
  if (!isUuid(materialId)) return new Set();
  const { data, error } = await admin.from("individual_scholar_question").select("stem").eq("user_id", userId).eq("material_id", materialId).limit(2000);
  if (error) return new Set();
  return new Set(((data ?? []) as any[]).map(r => stemKey(String(r.stem ?? ""))).filter(Boolean));
}

export async function listQuestions(admin: Admin, userId: string, opts: { materialId?: string; kind?: QuestionKind } = {}): Promise<Read<QuestionRow[]>> {
  let q = admin.from("individual_scholar_question").select(QUESTION_COLS).eq("user_id", userId);
  if (opts.materialId) q = q.eq("material_id", opts.materialId);
  q = opts.kind ? q.eq("kind", opts.kind) : q.in("kind", ["mcq", "case"]);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(200);
  if (error) return fail(error);
  // A governed library copy is Revision's (710): the practice surfaces, which cite the student's notes, never show it.
  return { ok: true, data: (await hydrate(admin, userId, data ?? [])).filter(x => !x.library) };
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
export async function recordAttempt(admin: Admin, userId: string, q: QuestionRow, chosenIndex: number): Promise<{ ok: boolean; correct: boolean; card: "created" | "reset" | null; attempt?: { id: string; answeredAt: string } }> {
  const correct = chosenIndex === q.correctIndex;
  const { data: made, error } = await admin.from("individual_scholar_attempt").insert({ user_id: userId, question_id: q.id, chosen_index: chosenIndex, correct }).select("id, answered_at").single();
  if (error) return { ok: false, correct, card: null };
  // SCHOLAR-CONTINUITY-01 (791): the attempt's id, so its snapshot can be kept beside it.
  const attempt = made?.id ? { id: String(made.id), answeredAt: String(made.answered_at ?? new Date().toISOString()) } : undefined;
  if (correct) return { ok: true, correct, card: null, attempt };

  const { data: existing } = await admin.from("individual_scholar_card").select("id, ease_factor, interval_days, repetitions")
    .eq("user_id", userId).eq("question_id", q.id).maybeSingle();
  if (!existing) {
    const { error: cErr } = await admin.from("individual_scholar_card").insert({
      user_id: userId, question_id: q.id, material_id: q.materialId, next_review_at: todayIso(), status: "active",
    });
    return { ok: !cErr, correct, card: cErr ? null : "created", attempt };
  }
  const next = sm2({ ease: Number(existing.ease_factor ?? 2.5), interval: existing.interval_days ?? 0, reps: existing.repetitions ?? 0 }, 1);
  const { error: uErr } = await admin.from("individual_scholar_card").update({
    ease_factor: next.ease, interval_days: next.interval, repetitions: next.reps, status: "active",
    next_review_at: todayIso(), updated_at: new Date().toISOString(),
  }).eq("user_id", userId).eq("id", existing.id);
  return { ok: !uErr, correct, card: uErr ? null : "reset", attempt };
}

// ── REVISE: CARDS ──────────────────────────────────────────────────────────────────────────────────

export type CardRow = { id: string; nextReviewAt: string; reviews: number; status: "active" | "mastered"; question: QuestionRow };

export async function dueCards(admin: Admin, userId: string, today: string = todayIso()): Promise<Read<CardRow[]>> {
  const { data, error } = await admin.from("individual_scholar_card").select("id, question_id, next_review_at, reviews, status")
    .eq("user_id", userId).eq("status", "active").lte("next_review_at", today).order("next_review_at").limit(50);
  if (error) return fail(error);
  const rows = (data ?? []) as any[];
  if (!rows.length) return { ok: true, data: [] };
  const qRes = await admin.from("individual_scholar_question").select(QUESTION_COLS).eq("user_id", userId).in("id", rows.map(r => r.question_id));
  if (qRes.error) return fail(qRes.error);
  const qs = new Map((await hydrate(admin, userId, qRes.data ?? [])).filter(q => !q.library).map(q => [q.id, q]));
  return {
    ok: true,
    data: rows.filter(r => qs.has(r.question_id)).map(r => ({ id: r.id, nextReviewAt: r.next_review_at, reviews: r.reviews, status: r.status, question: qs.get(r.question_id)! })),
  };
}

/** How many cards are due now. Null when it could not be counted -- never shown as zero. */
export const countDue = cache(async (admin: Admin, userId: string, today?: string): Promise<number | null> => {
  const { count, error } = await admin.from("individual_scholar_card").select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("status", "active").lte("next_review_at", today ?? todayIso());
  return error ? null : (count ?? 0);
});

/**
 * SCHOLAR-CE-2026 CE-01: the learner's own flashcards on some materials that they last rated badly (last_quality below 3, SM-2's own lapse
 * line), weakest first. Two bounded owner-keyed reads, no hydrate: `id`, `front` (the card's stem) and the quality only. Null where it could
 * not be read (nothing is then said about cards, never "no weak cards"). A governed library copy is not the learner's card and is not read.
 */
export async function weakFlashcards(admin: Admin, userId: string, materialIds: readonly string[], limit = 5): Promise<{ id: string; front: string; chunkId: string; quality: number }[] | null> {
  const ids = materialIds.filter(isUuid).slice(0, 10);
  if (!ids.length) return [];
  try {
    const qs = await admin.from("individual_scholar_question").select("id, stem, chunk_id").eq("user_id", userId).eq("kind", "flashcard").in("material_id", ids).limit(400);
    if (qs.error) return null;
    const rows = (qs.data ?? []) as any[];
    if (!rows.length) return [];
    const cs = await admin.from("individual_scholar_card").select("question_id, last_quality").eq("user_id", userId).eq("status", "active").not("last_quality", "is", null).lt("last_quality", 3).in("question_id", rows.map(r => r.id)).limit(400);
    if (cs.error) return null;
    const by = new Map(rows.map(r => [r.id as string, r]));
    return ((cs.data ?? []) as any[]).flatMap(c => { const q = by.get(c.question_id); return q ? [{ id: q.id as string, front: String(q.stem ?? ""), chunkId: String(q.chunk_id ?? ""), quality: Number(c.last_quality) }] : []; })
      .sort((a, b) => a.quality - b.quality || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, Math.max(0, limit));
  } catch { return null; }
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

export type PoolStats = { misses: number; latestCorrect: boolean | null; lastAnsweredAt: string | null; due: boolean; lastMissAt?: string | null };

/** Questions of the chosen kinds within some sections (or the whole library when none are named), with their stats. */
export async function revisionPool(admin: Admin, userId: string, opts: { chunkIds?: readonly string[] | null; kinds: readonly RevisionKind[]; extraIds?: readonly string[] }): Promise<Read<{ questions: QuestionRow[]; stats: Map<string, PoolStats> }>> {
  const extra = (opts.extraIds ?? []).filter(isUuid).slice(0, 50);
  if (!opts.kinds.length || (opts.chunkIds && !opts.chunkIds.length && !extra.length)) return { ok: true, data: { questions: [], stats: new Map() } };
  // SCHOLAR-COMPANION-01: cloze is a format of the stored `short` kind (cloze.ts), so it is read as short.
  // SCHOLAR-SQIE-LEARNER-01: so are true/false and extended response (formats.ts).
  const dbKinds = [...new Set(opts.kinds.map(k => storedKind(k)))];
  let q = admin.from("individual_scholar_question").select(QUESTION_COLS).eq("user_id", userId).in("kind", dbKinds);
  // SCHOLAR-SQIE-CLOSE-01: library copies this session reuses, wherever they were first filed, beside the sections.
  if (opts.chunkIds && extra.length) q = q.or(`chunk_id.in.(${[...opts.chunkIds].slice(0, 200).join(",")}),id.in.(${extra.join(",")})`);
  else if (opts.chunkIds) q = q.in("chunk_id", [...opts.chunkIds].slice(0, 200));
  const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
  if (error) return fail(error);
  const questions = await hydrate(admin, userId, data ?? []);
  const ids = questions.map(x => x.id);
  const stats = new Map<string, PoolStats>(ids.map(id => [id, { misses: 0, latestCorrect: null, lastAnsweredAt: null, due: false, lastMissAt: null }]));
  if (ids.length) {
    const [att, cards] = await Promise.all([
      admin.from("individual_scholar_attempt").select("question_id, correct, answered_at").eq("user_id", userId).in("question_id", ids).order("answered_at", { ascending: false }).limit(5000),
      admin.from("individual_scholar_card").select("question_id, next_review_at, status").eq("user_id", userId).in("question_id", ids),
    ]);
    for (const a of (att.data ?? []) as any[]) {
      const s = stats.get(a.question_id)!;
      if (s.lastAnsweredAt === null) { s.lastAnsweredAt = a.answered_at; s.latestCorrect = a.correct; }
      if (!a.correct) { s.misses++; if (!s.lastMissAt) s.lastMissAt = a.answered_at; }
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
    user_id: userId, material_id: input.passage.materialId, chunk_id: input.passage.chunkId, kind: storedKind(input.kind),
    stem: d.stem, options: d.options, correct_index: null, answer: d.answer, difficulty: d.difficulty, review_status: "private_formative",
    rationale: d.rationale, source_quote: d.sourceQuote, model: input.model, provider: input.provider, prompt_version: input.promptVersion,
    ...(input.competencyId ? { competency_id: input.competencyId } : {}),
  }))).select("id");
  if (error) {
    // A structured question refused by the schema: 710 is not applied here, so structured is not offered again.
    if (input.kind === "structured" && isSchemaRefusal(error)) markSqieAbsent();
    return { ok: false, ids: [], notProvisioned: isNotProvisioned(error) || /check constraint|column/i.test(String((error as any)?.message ?? "")) };
  }
  const ids = ((data ?? []) as any[]).map(r => r.id as string);
  if (input.kind === "flashcard" && ids.length)
    await admin.from("individual_scholar_card").insert(ids.map(id => ({ user_id: userId, question_id: id, material_id: input.passage.materialId, next_review_at: todayIso(), status: "active" })))
      .then((r: unknown) => r, () => {});
  return { ok: true, ids };
}

/**
 * SCHOLAR-SQIE-CLOSE-01 C (710), SQIE-LIBRARY-EXPANSION-01 (800): the learner's own copy of each picked governed library
 * question -- a row of the version's format (an mcq for a 442 question) naming its
 * resource and version, review_status library_approved, filed under the section it was matched to, practising the
 * competency it matched. One copy per learner and version: one already held is reused. The 710 guard refuses any copy
 * that is not the published, clinically approved content exactly. Returns the ids in pick order ([] where 710 is absent).
 */
export async function insertLibraryCopies(admin: Admin, userId: string, picks: readonly LibraryPick[]): Promise<{ ok: boolean; ids: string[]; copied: number }> {
  if (!picks.length) return { ok: true, ids: [], copied: 0 };
  if (!(await sqieSchema(admin, userId))) return { ok: false, ids: [], copied: 0 };
  const versionIds = picks.map(p => p.question.versionId);
  const held = await admin.from("individual_scholar_question").select("id, library_version_id").eq("user_id", userId).in("library_version_id", versionIds);
  if (held.error) return { ok: false, ids: [], copied: 0 };
  const have = new Map(((held.data ?? []) as any[]).map(r => [r.library_version_id as string, r.id as string]));
  const fresh = picks.filter(p => !have.has(p.question.versionId));
  let copied = 0;
  if (fresh.length) {
    const chunks = await admin.from("individual_scholar_chunk").select("id, material_id").eq("user_id", userId).in("id", [...new Set(fresh.map(p => p.chunkId))]);
    if (chunks.error) return { ok: false, ids: [], copied: 0 };
    const material = new Map(((chunks.data ?? []) as any[]).map(c => [c.id as string, c.material_id as string]));
    // SQIE-LIBRARY-EXPANSION-01 (800): a version of any format is copied as libraryCopyOf made it -- kind, key and answer
    // exactly as the 800 guard rebuilds them from the published content. A 442 question is the mcq row it always was.
    const rows = fresh.filter(p => material.has(p.chunkId)).map(p => ({
      user_id: userId, material_id: material.get(p.chunkId)!, chunk_id: p.chunkId, kind: p.question.copy?.kind ?? "mcq",
      stem: p.question.copy?.stem ?? p.question.stem, options: p.question.copy?.options ?? p.question.options,
      correct_index: p.question.copy ? p.question.copy.correctIndex : p.question.correctIndex, rationale: p.question.rationale,
      ...(p.question.copy?.answer ? { answer: p.question.copy.answer } : {}),
      // Not a quote from the student's notes: the library item is its own source, shown as such (revision-view.ts).
      source_quote: "", model: "competen-library", provider: "competen-library", prompt_version: `library:v${p.question.versionNo}`,
      review_status: "library_approved", library_resource_id: p.question.resourceId, library_version_id: p.question.versionId,
      competency_id: p.competencyId,
      // SQIE-CLOSE-2026-11 WS-E: the item's recorded difficulty (995 meta), so an adaptive exam can target it. Not guarded by 800.
      ...(p.question.meta?.difficulty ? { difficulty: DIFFICULTY_NUMBER[p.question.meta.difficulty] } : {}),
    }));
    // One at a time: a version refused by the guard (unpublished since it was read) costs only itself.
    for (const row of rows) {
      const { data, error } = await admin.from("individual_scholar_question").insert({ ...row, user_id: userId }).select("id").single();
      if (!error && data) { have.set(row.library_version_id, data.id); copied++; }
      else if (error && String(error.code ?? "") === "23505") {
        const again = await admin.from("individual_scholar_question").select("id").eq("user_id", userId).eq("library_version_id", row.library_version_id).maybeSingle();
        if (again.data) have.set(row.library_version_id, again.data.id);
      }
    }
  }
  return { ok: true, ids: versionIds.map(v => have.get(v)).filter((x): x is string => !!x), copied };
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
}): Promise<{ ok: boolean; card: "created" | "reset" | "reviewed" | null; nextReviewAt?: string; attempt?: { id: string; answeredAt: string } }> {
  const { data: made, error } = await admin.from("individual_scholar_attempt").insert({
    user_id: userId, question_id: q.id, chosen_index: a.chosenIndex, response: a.response, correct: a.correct, score: a.score,
    marking: a.marking, evaluator_model: a.evaluator?.model ?? null, evaluator_prompt_version: a.evaluator?.promptVersion ?? null,
    revision_session_id: a.sessionId,
  }).select("id, answered_at").single();
  if (error) return { ok: false, card: null };
  // SCHOLAR-CONTINUITY-01 (791): the attempt's id, so its snapshot can be kept beside it.
  const attempt = made?.id ? { id: String(made.id), answeredAt: String(made.answered_at ?? new Date().toISOString()) } : undefined;
  return { ...(await revisionAttemptCard(admin, userId, q, a)), attempt };
}

/** The card a revision answer reviews, makes or resets (recordRevisionAttempt, after the attempt is stored). */
async function revisionAttemptCard(admin: Admin, userId: string, q: QuestionRow, a: { correct: boolean; quality?: number | null; srs?: SrsParams }): Promise<{ ok: boolean; card: "created" | "reset" | "reviewed" | null; nextReviewAt?: string }> {
  // A flashcard's answer IS its recall grade. Any other question whose card is due is reviewed by the answer: right is
  // a good recall (4), wrong a lapse (1). Otherwise a missed answer makes or resets its card, as practice always has.
  let { data: card } = await admin.from("individual_scholar_card").select("id, next_review_at, status").eq("user_id", userId).eq("question_id", q.id).maybeSingle();
  // SCHOLAR-FLASHCARDS-01: a recall graded on a card that has no schedule yet (a governed library question studied as a
  // card, or a flashcard whose card could not be made when it was written) gets its 372 card first, due today, so the
  // grade is scheduled and logged like every other.
  if (!card && q.kind === "flashcard" && Number.isInteger(a.quality)) {
    const made = await admin.from("individual_scholar_card").insert({ user_id: userId, question_id: q.id, material_id: q.materialId, next_review_at: todayIso(), status: "active" })
      .select("id, next_review_at, status").single();
    card = made.error ? null : made.data;
  }
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

/** `response` is the stored answer (416): the student's own words, and on an ai_evaluation attempt its formative feedback (written-feedback.ts). */
export type SessionAttempt = {
  questionId: string; correct: boolean; score: number | null; marking: string; answeredAt: string; response?: Record<string, unknown> | null;
  /** SCHOLAR-CONTINUITY-01: the attempt's id, and (791, read only where asked for) its snapshot and corrections. */
  id?: string; integrity?: AttemptIntegrity | null;
};
/** 425: a short answer held, unmarked, until the end of its session (end-of-session feedback and Mock). */
export type HeldAnswer = { questionId: string; response: { text: string } };

/**
 * A revision session, its questions in order, its answers so far, and (425) the short answers held unmarked until
 * the end. `holding` is false where 425 is absent: nothing can be held there, and the caller says so. null when it
 * is not the caller's.
 */
export async function getRevisionSession(admin: Admin, userId: string, id: string, opts: { integrity?: boolean } = {}): Promise<Read<{ session: RevisionSessionRow; questionIds: string[]; attempts: SessionAttempt[]; held: HeldAnswer[]; holding: boolean } | null>> {
  if (!isUuid(id)) return { ok: true, data: null };
  const { data: s, error } = await admin.from("individual_scholar_revision_session").select(REV_SESSION_COLS).eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) return fail(error);
  if (!s) return { ok: true, data: null };
  const itemsOf = (cols: string) => admin.from("individual_scholar_revision_session_item").select(cols).eq("user_id", userId).eq("session_id", id).order("ordinal");
  const [first, att] = await Promise.all([
    itemsOf("ordinal, question_id, held_response"),
    admin.from("individual_scholar_attempt").select("id, question_id, correct, score, marking, answered_at, response").eq("user_id", userId).eq("revision_session_id", id).order("answered_at"),
  ]);
  let items = first, holding = true;
  if (first.error && isNotProvisioned(first.error)) { items = await itemsOf("ordinal, question_id"); holding = false; }
  if (items.error || att.error) return fail(items.error ?? att.error);
  const rows = (items.data ?? []) as any[];
  const attRows = (att.data ?? []) as any[];
  // SCHOLAR-CONTINUITY-01 (791): feedback shown again reads what each answer was assessed against, where asked for.
  const integrity = opts.integrity ? await attemptIntegrity(admin, userId, attRows.map(a => a.id)) : null;
  return {
    ok: true,
    data: {
      session: toRevSession(s), questionIds: rows.map(r => r.question_id),
      attempts: attRows.map(a => ({ id: a.id, questionId: a.question_id, correct: a.correct, score: a.score === null ? null : Number(a.score), marking: a.marking, answeredAt: a.answered_at, response: a.response && typeof a.response === "object" ? a.response : null, ...(integrity ? { integrity: integrity.get(a.id) ?? null } : {}) })),
      held: rows.filter(r => typeof r.held_response?.text === "string").map(r => ({ questionId: r.question_id, response: { text: r.held_response.text } })),
      holding,
    },
  };
}

/**
 * SCHOLAR-WRITTEN-FEEDBACK-01. The caller's latest AI-evaluated written answers to these questions that kept formative
 * feedback (written-feedback.ts formativeOf), newest first, at most `limit`. Owner-keyed. Formative only: nothing that
 * makes an evaluation, a verification or a Passport entry calls this.
 */
export async function recentWrittenFeedback(admin: Admin, userId: string, questionIds: readonly string[], limit = 6): Promise<Read<{ id: string; questionId: string; answeredAt: string; formative: FormativeFeedback }[]>> {
  const ids = [...new Set(questionIds)].filter(isUuid).slice(0, 200);
  if (!ids.length) return { ok: true, data: [] };
  const { data, error } = await admin.from("individual_scholar_attempt").select("id, question_id, answered_at, marking, response")
    .eq("user_id", userId).eq("marking", "ai_evaluation").in("question_id", ids).order("answered_at", { ascending: false }).limit(Math.max(1, limit) * 4);
  if (error) return fail(error);
  const out: { id: string; questionId: string; answeredAt: string; formative: FormativeFeedback }[] = [];
  for (const a of (data ?? []) as any[]) {
    const formative = formativeOf(a.response, a.marking);
    if (formative && out.length < limit) out.push({ id: a.id, questionId: a.question_id, answeredAt: a.answered_at, formative });
  }
  return { ok: true, data: out };
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
  // SCHOLAR-PRACTICE-EXAMS-01: an adaptive exam's blueprint set is not a saved revision set (it has no questions to replay).
  const sets = ((data ?? []) as any[]).filter(s => !isAdaptiveScope(s.scope));
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

// ── ADAPTIVE EXAMS (SCHOLAR-PRACTICE-EXAMS-01) ── on 417 as it stands, and on 720 where it is applied ──────────────────
//
// An adaptive exam is a revision session (417) whose questions are added one at a time as they are chosen, naming a
// revision set (417) whose `scope` holds its blueprint under scope.adaptive (adaptive.ts). The set has no items and is
// never listed as a saved set. Migration 720 lets a session say mode 'adaptive': detected by the first insert (a CHECK
// refusal means it is absent), remembered for the process. Without it the session is mode 'mock', and the set's
// scope.adaptive marker is what makes it adaptive.
let adaptive720: boolean | null = null;
const isCheckRefusal = (error: any) => !!error && (String(error.code ?? "") === "23514" || /check constraint/i.test(String(error.message ?? "")));
/** Tests only: forget what was detected. */
export const resetAdaptiveSchema = () => { adaptive720 = null; };
/** Whether a set's scope is an adaptive exam's blueprint (never a saved revision set). */
export const isAdaptiveScope = (scope: unknown) => !!scope && typeof scope === "object" && !!(scope as Record<string, unknown>).adaptive;

/** The blueprint's set: no items, mode 'mock' (417 allows it), its blueprint in scope.adaptive. Owner-keyed. */
export async function createAdaptiveSet(admin: Admin, userId: string, input: { title: string; scope: Record<string, unknown>; formats: readonly string[]; quantity: number; difficulty: string; feedback: "immediate" | "end" }): Promise<{ ok: true; id: string } | { ok: false; notProvisioned: boolean }> {
  // 417's set CHECK names the formats it knew: structured is kept in the blueprint only.
  const formats = input.formats.filter(f => SET_CHECK_KINDS.includes(f));
  const { data, error } = await admin.from("individual_scholar_revision_set").insert({
    user_id: userId, title: input.title.slice(0, 120) || "Adaptive exam", mode: "mock", scope: input.scope, formats: formats.length ? formats : ["mcq"],
    quantity: Math.max(1, Math.min(50, input.quantity)), difficulty: input.difficulty, feedback: input.feedback,
  }).select("id").single();
  if (error || !data) return { ok: false, notProvisioned: !!error && isNotProvisioned(error) };
  return { ok: true, id: data.id };
}

/** A blueprint's set, read by id. null when it is not the caller's or not an adaptive exam's. Owner-keyed. */
export async function getAdaptiveSet(admin: Admin, userId: string, id: string | null): Promise<{ id: string; title: string; scope: Record<string, unknown>; createdAt: string } | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await admin.from("individual_scholar_revision_set").select("id, title, scope, created_at").eq("user_id", userId).eq("id", id).maybeSingle();
  if (error || !data || !isAdaptiveScope(data.scope)) return null;
  return { id: data.id, title: data.title, scope: data.scope, createdAt: data.created_at };
}

/** The blueprint updated (its generation count). Owner-keyed. */
export async function updateAdaptiveScope(admin: Admin, userId: string, id: string, scope: Record<string, unknown>): Promise<boolean> {
  const { error } = await admin.from("individual_scholar_revision_set").update({ scope, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("id", id);
  return !error;
}

/**
 * An adaptive exam's session: mode 'adaptive' where 720 allows it, else 'mock'; its length as its total; its first
 * question as item 1. not_provisioned where 417 is absent.
 */
export async function createAdaptiveSession(admin: Admin, userId: string, input: { setId: string; feedback: "immediate" | "end"; total: number; firstQuestionId: string }): Promise<{ ok: true; id: string; mode: "adaptive" | "mock" } | { ok: false; notProvisioned: boolean }> {
  const insert = (mode: "adaptive" | "mock") => admin.from("individual_scholar_revision_session")
    .insert({ user_id: userId, set_id: input.setId, mode, feedback: input.feedback, total: Math.max(1, Math.min(50, input.total)) }).select("id").single();
  let mode: "adaptive" | "mock" = adaptive720 === false ? "mock" : "adaptive";
  let { data, error } = await insert(mode);
  if (error && mode === "adaptive" && isCheckRefusal(error)) { adaptive720 = false; mode = "mock"; ({ data, error } = await insert(mode)); }
  else if (!error && mode === "adaptive") adaptive720 = true;
  if (error || !data) return { ok: false, notProvisioned: !!error && isNotProvisioned(error) };
  if (!(await appendAdaptiveItem(admin, userId, data.id, 1, input.firstQuestionId))) {
    await admin.from("individual_scholar_revision_session").delete().eq("user_id", userId).eq("id", data.id);
    return { ok: false, notProvisioned: false };
  }
  return { ok: true, id: data.id, mode };
}

/** The next chosen question, as the session's next item. false when it could not be added (a race: taken already). Owner-keyed. */
export async function appendAdaptiveItem(admin: Admin, userId: string, sessionId: string, ordinal: number, questionId: string): Promise<boolean> {
  if (ordinal < 1 || ordinal > 50) return false;
  const { error } = await admin.from("individual_scholar_revision_session_item").insert({ session_id: sessionId, user_id: userId, ordinal, question_id: questionId });
  return !error;
}

/** Questions by id, hydrated as every revision read is (a library copy no longer servable is left out). Owner-keyed. */
export async function questionsByIds(admin: Admin, userId: string, ids: readonly string[]): Promise<Read<QuestionRow[]>> {
  const want = [...new Set(ids)].filter(isUuid).slice(0, 100);
  if (!want.length) return { ok: true, data: [] };
  const { data, error } = await admin.from("individual_scholar_question").select(QUESTION_COLS).eq("user_id", userId).in("id", want);
  if (error) return fail(error);
  return { ok: true, data: await hydrate(admin, userId, data ?? []) };
}

export type AdaptiveExamRow = { session: RevisionSessionRow; setId: string; title: string; scope: Record<string, unknown>; marked: number; scoreSum: number };
/** The student's adaptive exams, newest first: each session with its blueprint and its marked answers so far. Owner-keyed. */
export async function listAdaptiveExams(admin: Admin, userId: string, limit = 20): Promise<Read<AdaptiveExamRow[]>> {
  const { data: sets, error } = await admin.from("individual_scholar_revision_set").select("id, title, scope").eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
  if (error) return fail(error);
  const adaptive = new Map(((sets ?? []) as any[]).filter(s => isAdaptiveScope(s.scope)).map(s => [s.id as string, s]));
  if (!adaptive.size) return { ok: true, data: [] };
  const { data: rows, error: sErr } = await admin.from("individual_scholar_revision_session").select(REV_SESSION_COLS).eq("user_id", userId)
    .in("set_id", [...adaptive.keys()].slice(0, 200)).order("created_at", { ascending: false }).limit(limit);
  if (sErr) return fail(sErr);
  const sessions = ((rows ?? []) as any[]).map(toRevSession);
  const att = sessions.length ? await admin.from("individual_scholar_attempt").select("revision_session_id, correct, score").eq("user_id", userId).in("revision_session_id", sessions.map(s => s.id)).limit(2500) : { data: [], error: null };
  const by = new Map<string, { marked: number; scoreSum: number }>();
  for (const a of (att.error ? [] : att.data ?? []) as any[]) {
    const m = by.get(a.revision_session_id) ?? { marked: 0, scoreSum: 0 };
    m.marked++; m.scoreSum += a.score === null || a.score === undefined ? (a.correct ? 1 : 0) : Math.max(0, Math.min(1, Number(a.score)));
    by.set(a.revision_session_id, m);
  }
  return {
    ok: true,
    data: sessions.filter(s => s.setId && adaptive.has(s.setId)).map(s => {
      const set = adaptive.get(s.setId!)!;
      return { session: s, setId: s.setId!, title: set.title, scope: set.scope, marked: by.get(s.id)?.marked ?? 0, scoreSum: by.get(s.id)?.scoreSum ?? 0 };
    }),
  };
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
  cards: { nextReviewAt: string; status: "active" | "mastered"; materialId: string | null }[];
}>> {
  let att = await admin.from("individual_scholar_attempt").select("question_id, correct, answered_at, marking, revision_session_id").eq("user_id", userId).order("answered_at", { ascending: false }).limit(5000);
  if (att.error) att = await admin.from("individual_scholar_attempt").select("question_id, correct, answered_at").eq("user_id", userId).order("answered_at", { ascending: false }).limit(5000);
  if (att.error) return fail(att.error);
  let qs = await admin.from("individual_scholar_question").select("id, stem, kind, chunk_id, material_id, competency_id").eq("user_id", userId).limit(5000);
  if (qs.error) qs = await admin.from("individual_scholar_question").select("id, stem, kind, chunk_id, material_id").eq("user_id", userId).limit(5000);
  if (qs.error) return fail(qs.error);
  const [reviews, cards] = await Promise.all([reviewRows(admin, userId), admin.from("individual_scholar_card").select("next_review_at, status, material_id").eq("user_id", userId).limit(5000)]);
  if (cards.error) return fail(cards.error);
  return {
    ok: true,
    data: {
      attempts: ((att.data ?? []) as any[]).map(a => ({ questionId: a.question_id, correct: a.correct, answeredAt: a.answered_at, marking: a.marking ?? "deterministic", sessionId: a.revision_session_id ?? null })),
      questions: ((qs.data ?? []) as any[]).map(q => ({ id: q.id, stem: q.stem, kind: q.kind, chunkId: q.chunk_id, materialId: q.material_id, competencyId: q.competency_id ?? null })),
      reviews: reviews.ok ? reviews.data : null,
      cards: ((cards.data ?? []) as any[]).map(c => ({ nextReviewAt: c.next_review_at, status: c.status, materialId: c.material_id ?? null })),
    },
  };
}

// ── MISTAKE NOTEBOOK ── SCHOLAR-COMPANION-01 P1 ── the learner's own wrong attempts, read back (mistakes.ts) ──────────
//
// READS ONLY, the caller's own rows, hard-capped: the latest MISTAKES_ROW_CAP wrong attempts, then the attempt history of
// just those questions (at most ten rows each on average) to say how often each was missed and whether it was corrected.
// No table, column or write is added: a mistake IS an attempt (372, 416).

async function mistakeAttempts(admin: Admin, userId: string): Promise<Read<{ wrong: MistakeAttempt[]; history: AttemptMark[]; capped: boolean }>> {
  const base = (cols: string) => admin.from("individual_scholar_attempt").select(cols).eq("user_id", userId).eq("correct", false);
  // 416 columns first; where they are absent the 372 ones are read (every answer then a choice marked by code).
  let w = await base("question_id, chosen_index, response, correct, score, marking, answered_at").order("answered_at", { ascending: false }).limit(MISTAKES_ROW_CAP);
  if (w.error) w = await base("question_id, chosen_index, correct, answered_at").order("answered_at", { ascending: false }).limit(MISTAKES_ROW_CAP);
  if (w.error) return fail(w.error);
  const rows = (w.data ?? []) as any[];
  const wrong: MistakeAttempt[] = rows.map(a => ({
    questionId: a.question_id, correct: a.correct === true, answeredAt: a.answered_at, chosenIndex: a.chosen_index ?? null,
    response: a.response && typeof a.response === "object" ? a.response : null, marking: a.marking ?? "deterministic", score: a.score === null || a.score === undefined ? null : Number(a.score),
  }));
  const ids = [...new Set(wrong.map(a => a.questionId))];
  if (!ids.length) return { ok: true, data: { wrong, history: [], capped: false } };
  const h = await admin.from("individual_scholar_attempt").select("question_id, correct, answered_at").eq("user_id", userId).in("question_id", ids)
    .order("answered_at", { ascending: false }).limit(MISTAKES_ROW_CAP * 10);
  if (h.error) return fail(h.error);
  return {
    ok: true,
    data: { wrong, history: ((h.data ?? []) as any[]).map(a => ({ questionId: a.question_id, correct: a.correct === true, answeredAt: a.answered_at })), capped: rows.length >= MISTAKES_ROW_CAP },
  };
}

/** How many questions are still to fix (their latest attempt was wrong), within the same cap as the notebook. Owner-keyed. */
export async function mistakeToFixCount(admin: Admin, userId: string): Promise<Read<number>> {
  const r = await mistakeAttempts(admin, userId);
  return r.ok ? { ok: true, data: toFixIds(r.data.history).size } : r;
}

/** Everything the notebook page groups (mistakes.ts buildMistakeNotebook): wrong attempts, history, the questions, their materials' titles and topics. */
export async function mistakeNotebookRows(admin: Admin, userId: string): Promise<Read<{
  wrong: MistakeAttempt[]; history: AttemptMark[]; capped: boolean; questions: Map<string, MistakeQuestion>; titles: Map<string, string>; topics: Map<string, string[]>;
}>> {
  const a = await mistakeAttempts(admin, userId);
  if (!a.ok) return a;
  const ids = [...new Set(a.data.wrong.map(x => x.questionId))];
  if (!ids.length) return { ok: true, data: { ...a.data, questions: new Map(), titles: new Map(), topics: new Map() } };
  const { data, error } = await admin.from("individual_scholar_question").select(QUESTION_COLS).eq("user_id", userId).in("id", ids);
  if (error) return fail(error);
  const rows = await hydrate(admin, userId, data ?? []);
  const topics = await topicsOfSections(admin, userId, [...new Set(rows.map(q => q.chunkId))]);
  return {
    ok: true,
    data: { ...a.data, questions: new Map(rows.map(q => [q.id, q as MistakeQuestion])), titles: new Map(rows.map(q => [q.materialId, q.materialTitle])), topics },
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

/** SCHOLAR-APPLY-CONNECTED-01: which steps of the caller's lessons use which sections. Reached or not is the caller's to work out from the session. */
export async function learnedStepRows(admin: Admin, userId: string): Promise<{ sessionId: string; step: number; chunkId: string; materialId: string | null }[]> {
  const { data, error } = await admin.from("individual_scholar_learning_step").select("session_id, step, chunk_id, material_id").eq("user_id", userId).limit(10000);
  if (error) return [];
  return ((data ?? []) as any[]).map(r => ({ sessionId: r.session_id, step: r.step, chunkId: r.chunk_id, materialId: r.material_id ?? null }));
}
/** SCHOLAR-APPLY-CONNECTED-01: the text of some of the caller's own sections, by id. */
export async function chunkTextRows(admin: Admin, userId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const keep = ids.filter(isUuid);
  if (!keep.length) return new Map();
  const { data, error } = await admin.from("individual_scholar_chunk").select("id, content").eq("user_id", userId).in("id", keep).limit(keep.length);
  if (error) return new Map();
  return new Map(((data ?? []) as any[]).map(r => [r.id as string, String(r.content ?? "")]));
}
/** SCHOLAR-APPLY-CONNECTED-01: the caller's cards that have actually been reviewed. */
export async function reviewedCardRows(admin: Admin, userId: string): Promise<{ questionId: string; lastReviewedAt: string; lastQuality: number | null }[]> {
  const { data, error } = await admin.from("individual_scholar_card").select("question_id, last_reviewed_at, last_quality, reviews").eq("user_id", userId).gt("reviews", 0).limit(5000);
  if (error) return [];
  return ((data ?? []) as any[]).filter(r => r.last_reviewed_at).map(r => ({ questionId: r.question_id, lastReviewedAt: r.last_reviewed_at, lastQuality: r.last_quality ?? null }));
}
/** SCHOLAR-APPLY-CONNECTED-01: what each of the caller's sections is about, with their own corrections. Empty where the analysis is absent. */
export async function chunkConceptRows(admin: Admin, userId: string): Promise<Map<string, string[]>> {
  const [{ data, error }, corrections] = await Promise.all([
    admin.from("individual_scholar_chunk_analysis").select("chunk_id, concepts").eq("user_id", userId).limit(10000),
    topicCorrections(admin, userId, null),
  ]);
  const out = new Map<string, string[]>();
  if (error) return out;
  for (const r of (data ?? []) as any[]) out.set(r.chunk_id, corrections.byChunk.get(r.chunk_id) ?? r.concepts ?? []);
  return out;
}
/** SCHOLAR-APPLY-CONNECTED-01: the caller's stored cases with their sources, competencies and every playing of them. Nothing is written or regenerated. */
export async function practiceCaseRows(admin: Admin, userId: string): Promise<{
  cases: { id: string; title: string; materialId: string; createdAt: string; promptVersion: string; model: string; blueprint: unknown; chunkIds: string[]; sourceMaterialIds: string[]; competencyIds: string[] }[];
  sessions: { id: string; caseId: string; status: string; createdAt: string; lastActiveAt: string; completedAt: string | null; debrief: unknown }[];
}> {
  const empty = { cases: [], sessions: [] };
  const { data: cs, error } = await admin.from("individual_scholar_case").select("id, title, material_id, created_at, prompt_version, model, blueprint").eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
  if (error) return empty;
  const ids = ((cs ?? []) as any[]).map(c => c.id);
  const [sess, sources, comps] = await Promise.all([
    admin.from("individual_scholar_case_session").select("id, private_case_id, status, created_at, last_active_at, completed_at, debrief").eq("user_id", userId).order("created_at", { ascending: false }).limit(1000),
    ids.length ? admin.from("individual_scholar_case_source").select("case_id, chunk_id").eq("user_id", userId).in("case_id", ids) : { data: [] },
    ids.length ? admin.from("individual_scholar_case_competency").select("case_id, competency_id").eq("user_id", userId).in("case_id", ids) : { data: [] },
  ]);
  const chunkIds = [...new Set(((sources.data ?? []) as any[]).map(s => s.chunk_id))];
  const { data: chunks } = chunkIds.length ? await admin.from("individual_scholar_chunk").select("id, material_id").eq("user_id", userId).in("id", chunkIds) : { data: [] };
  const materialOf = new Map(((chunks ?? []) as any[]).map(c => [c.id, c.material_id as string]));
  return {
    cases: ((cs ?? []) as any[]).map(c => {
      const own = ((sources.data ?? []) as any[]).filter(s => s.case_id === c.id).map(s => s.chunk_id as string);
      return {
        id: c.id, title: c.title, materialId: c.material_id, createdAt: c.created_at, promptVersion: c.prompt_version, model: c.model, blueprint: c.blueprint, chunkIds: own,
        sourceMaterialIds: [...new Set([c.material_id as string, ...own.map(id => materialOf.get(id)).filter((x): x is string => !!x)])],
        competencyIds: ((comps.data ?? []) as any[]).filter(x => x.case_id === c.id).map(x => x.competency_id as string),
      };
    }),
    sessions: ((sess.data ?? []) as any[]).map(s => ({ id: s.id, caseId: s.private_case_id, status: s.status, createdAt: s.created_at, lastActiveAt: s.last_active_at, completedAt: s.completed_at ?? null, debrief: s.debrief })),
  };
}
/** Pure. What a stored case is about, for search: its objectives and differentials. Never its answers or how it unfolds. */
export function caseBlueprintLabels(blueprint: unknown): string[] {
  const b = (blueprint ?? {}) as { learningObjectives?: { text?: unknown }[]; differentials?: { label?: unknown }[]; patient?: { presentingComplaint?: unknown } };
  return [...(b.learningObjectives ?? []).map(o => o?.text), ...(b.differentials ?? []).map(d => d?.label), b.patient?.presentingComplaint].filter((x): x is string => typeof x === "string" && !!x.trim());
}
/**
 * SCHOLAR-APPLY-CONNECTED-01, deletion integrity. A case can now draw on several materials, and 435 only cascades from the material it
 * is filed under, so a case using a section of ANOTHER material would otherwise survive that material's deletion with its words still
 * in the stored case. These are the caller's cases drawing on this material through a source section. null when they could not be read.
 */
export async function casesDrawingOn(admin: Admin, userId: string, materialId: string): Promise<string[] | null> {
  if (!isUuid(materialId)) return [];
  const { data: chunks, error } = await admin.from("individual_scholar_chunk").select("id").eq("user_id", userId).eq("material_id", materialId).limit(5000);
  if (error) return isNotProvisioned(error) ? [] : null;
  const ids = ((chunks ?? []) as any[]).map(c => c.id);
  if (!ids.length) return [];
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const r = await admin.from("individual_scholar_case_source").select("case_id").eq("user_id", userId).in("chunk_id", ids.slice(i, i + 200)).limit(5000);
    if (r.error) return isNotProvisioned(r.error) ? [] : null;
    for (const x of (r.data ?? []) as any[]) out.add(x.case_id);
  }
  return [...out];
}
/** Delete the caller's stored cases by id. Their sessions, answers and records go with them by cascade (435, 810). */
export async function deletePrivateCases(admin: Admin, userId: string, ids: readonly string[]): Promise<boolean> {
  if (!ids.length) return true;
  const { error } = await admin.from("individual_scholar_case").delete().eq("user_id", userId).in("id", [...ids]);
  return !error;
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
  const [cases, steps, drawing] = await Promise.all([c.limit(5000), q.limit(5000), materialId ? casesDrawingOn(admin, userId, materialId) : Promise.resolve([] as string[])]);
  return { cases: [...new Set([...((cases.data ?? []) as any[]).map(r => r.id as string), ...(drawing ?? [])])], s4: [...new Set(((steps.data ?? []) as any[]).map(r => r.case_id as string))] };
}

export type CaseSessionRow = {
  id: string; caseId: string; mode: "guided" | "independent"; status: "active" | "completed"; viewSalt: string; currentStageId: string | null;
  reachedStageIds: string[]; revealedFactIds: string[]; debrief: any; createdAt: string; lastActiveAt: string; completedAt: string | null;
};
export type CaseAnswerRow = {
  decisionPointId: string; chosen: string[]; reasoning: string | null; marking: string; correct: boolean | null; score: number | null;
  safety: string[]; aiFeedback: string | null; evaluatorModel: string | null; createdAt: string;
  /** The learner's reason for a CHOICE, where the case asked (810, individual_scholar_case_reason). null when none, or 810 is absent. */
  reason?: string | null;
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
  // 810: the reasons given for choices. Absent (not applied) or unreadable: none, and the case plays as before.
  const { data: why } = await admin.from("individual_scholar_case_reason").select("decision_point_id, reason").eq("user_id", userId).eq("session_id", id);
  const reasons = new Map<string, string>(((why ?? []) as any[]).map(r => [r.decision_point_id, r.reason]));
  return {
    session: toCaseSession(data),
    answers: ((ans ?? []) as any[]).map(a => ({ reason: reasons.get(a.decision_point_id) ?? null,
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
/**
 * D05 (LEARNING-CLOSE-2026-11 CE-04D): delete one of the caller's own private case sessions (an attempt). The database cascades
 * its answers and reasons (435/810), its simulated conversation (880) and its kept attempt record (810). The case stays.
 */
export async function deletePrivateCaseSession(admin: Admin, userId: string, id: string): Promise<"deleted" | "not_found" | "failed"> {
  const { data, error } = await admin.from("individual_scholar_case_session").delete().eq("user_id", userId).eq("id", id).select("id");
  if (error) return "failed";
  return data?.length ? "deleted" : "not_found";
}

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

/**
 * 810: the learner's reason for a choice they have just made in a private case (askReason), kept beside the 435 answer.
 * The database refuses one without that choice, a second one, and any change. Never an error to the learner: false
 * when it was not kept (810 absent included), and the browser still holds it for the debrief.
 */
export async function insertCaseReason(admin: Admin, userId: string, sessionId: string, decisionPointId: string, reason: string): Promise<boolean> {
  const text = reason.trim().slice(0, 1500);
  if (!isUuid(sessionId) || !text) return false;
  const { error } = await admin.from("individual_scholar_case_reason").insert({ session_id: sessionId, user_id: userId, decision_point_id: decisionPointId, reason: text });
  return !error;
}

// -- 810: A COMPLETED CASE ATTEMPT, AS IT WAS (SCHOLAR-CASE-INTEGRITY-01) --
// One immutable snapshot per completed session (private or library), and append-only corrections of its decision
// results. The database checks the session is the caller's own, completed, and of the case as it is held.

export type CaseAttemptCorrectionRow = {
  id: string; decisionPointId: string; previousOutcome: string; previousScore: number | null; correctedOutcome: string; correctedScore: number | null;
  reason: string; basis: string; correctedByKind: string; createdAt: string;
};
export type CaseAttemptSnapshotRow = {
  id: string; kind: "private" | "library"; sessionId: string; caseRef: string; contentHash: string; record: any; rubric: any; rubricHash: string | null;
  standing: "formative"; completedAt: string; createdAt: string; corrections: CaseAttemptCorrectionRow[];
};
const SNAPSHOT_COLS = "id, session_kind, private_session_id, library_session_id, case_ref, content_hash, record, rubric, rubric_hash, standing, completed_at, created_at";
const toSnapshot = (r: any, corrections: CaseAttemptCorrectionRow[]): CaseAttemptSnapshotRow => ({
  id: r.id, kind: r.session_kind, sessionId: r.private_session_id ?? r.library_session_id, caseRef: r.case_ref, contentHash: r.content_hash, record: r.record ?? {},
  rubric: r.rubric ?? null, rubricHash: r.rubric_hash ?? null, standing: "formative", completedAt: r.completed_at, createdAt: r.created_at, corrections,
});

/** Keep the snapshot of a completed attempt. "exists": one is already kept (idempotent on the session). */
export async function insertCaseAttemptSnapshot(admin: Admin, userId: string, input: {
  kind: "private" | "library"; sessionId: string; caseRef: string; contentHash: string; record: unknown; rubric: unknown | null;
}): Promise<{ ok: true; id: string } | { ok: false; reason: "exists" | "not_provisioned" | "refused" }> {
  if (!isUuid(input.sessionId)) return { ok: false, reason: "refused" };
  const { data, error } = await admin.from("individual_scholar_case_attempt_snapshot").insert({
    user_id: userId, session_kind: input.kind, ...(input.kind === "private" ? { private_session_id: input.sessionId } : { library_session_id: input.sessionId }),
    case_ref: input.caseRef, content_hash: input.contentHash, record: input.record, rubric: input.rubric ?? null,
    // completed_at is the session's own: the database guard replaces this placeholder with it.
    completed_at: new Date().toISOString(),
  }).select("id").single();
  if (!error && data) return { ok: true, id: data.id };
  if (String(error?.code ?? "") === "23505") return { ok: false, reason: "exists" };
  return { ok: false, reason: isNotProvisioned(error) ? "not_provisioned" : "refused" };
}

/** The caller's kept snapshot of one session, with its corrections oldest first. data null: none kept. */
export async function getCaseAttemptSnapshot(admin: Admin, userId: string, kind: "private" | "library", sessionId: string): Promise<Read<CaseAttemptSnapshotRow | null>> {
  if (!isUuid(sessionId)) return { ok: true, data: null };
  const { data, error } = await admin.from("individual_scholar_case_attempt_snapshot").select(SNAPSHOT_COLS).eq("user_id", userId)
    .eq(kind === "private" ? "private_session_id" : "library_session_id", sessionId).maybeSingle();
  if (error) return fail(error);
  if (!data) return { ok: true, data: null };
  const { data: cs, error: cErr } = await admin.from("individual_scholar_case_attempt_correction")
    .select("id, decision_point_id, previous_outcome, previous_score, corrected_outcome, corrected_score, reason, basis, corrected_by_kind, created_at")
    .eq("user_id", userId).eq("snapshot_id", data.id).order("created_at");
  if (cErr) return fail(cErr);
  return { ok: true, data: toSnapshot(data, ((cs ?? []) as any[]).map(c => ({
    id: c.id, decisionPointId: c.decision_point_id, previousOutcome: c.previous_outcome, previousScore: c.previous_score === null ? null : Number(c.previous_score),
    correctedOutcome: c.corrected_outcome, correctedScore: c.corrected_score === null ? null : Number(c.corrected_score), reason: c.reason, basis: c.basis,
    correctedByKind: c.corrected_by_kind, createdAt: c.created_at,
  }))) };
}

/** One correction of one decision result in a learner's kept attempt. previous_* is filled by the database. */
export async function insertCaseAttemptCorrection(admin: Admin, userId: string, input: {
  snapshotId: string; decisionPointId: string; correctedOutcome: "correct" | "partial" | "incorrect"; correctedScore: number | null;
  reason: string; basis: "rubric_error" | "key_error" | "marking_error" | "other"; actorId: string | null;
}): Promise<{ ok: true; id: string; previousOutcome: string } | { ok: false; reason: "unchanged" | "not_found" | "not_provisioned" | "refused" }> {
  if (!isUuid(input.snapshotId)) return { ok: false, reason: "not_found" };
  const { data, error } = await admin.from("individual_scholar_case_attempt_correction").insert({
    snapshot_id: input.snapshotId, user_id: userId, decision_point_id: input.decisionPointId,
    previous_outcome: "unmarked", // replaced by the database from the effective result
    corrected_outcome: input.correctedOutcome, corrected_score: input.correctedScore, reason: input.reason.trim(), basis: input.basis,
    corrected_by: input.actorId, corrected_by_kind: input.actorId ? "hq_actor" : "system_rule",
  }).select("id, previous_outcome").single();
  if (!error && data) return { ok: true, id: data.id, previousOutcome: data.previous_outcome };
  const m = String(error?.message ?? "");
  if (/changes nothing/.test(m)) return { ok: false, reason: "unchanged" };
  if (/not this learner own|not in the attempt/.test(m)) return { ok: false, reason: "not_found" };
  return { ok: false, reason: isNotProvisioned(error) ? "not_provisioned" : "refused" };
}

/** Which library version one of the caller's library plays is on (423, read only). null when it is not theirs. */
export async function librarySessionVersion(admin: Admin, userId: string, sessionId: string): Promise<string | null> {
  if (!isUuid(sessionId)) return null;
  const { data } = await admin.from("case_library_session").select("id, status, started_at, completed_at, version_id").eq("user_id", userId).eq("id", sessionId).maybeSingle();
  return (data as any)?.version_id ?? null;
}

/** The caller's case history: private sessions (435) and library plays (423, read only), newest first. */
export async function caseHistory(admin: Admin, userId: string, limit = 20): Promise<Read<{ kind: "private" | "library"; id: string; title: string | null; versionId: string | null; status: string; startedAt: string; completedAt: string | null; kept: boolean }[]>> {
  const [p, l] = await Promise.all([
    admin.from("individual_scholar_case_session").select("id, status, created_at, completed_at, private_case_id").eq("user_id", userId).order("last_active_at", { ascending: false }).limit(limit),
    admin.from("case_library_session").select("id, status, started_at, completed_at, version_id").eq("user_id", userId).order("started_at", { ascending: false }).limit(limit),
  ]);
  if (p.error && !isNotProvisioned(p.error)) return fail(p.error);
  const privateRows = ((p.data ?? []) as any[]);
  // 810: which finished attempts have their record kept. Absent: none is said to be.
  const { data: kept } = await admin.from("individual_scholar_case_attempt_snapshot").select("private_session_id, library_session_id").eq("user_id", userId)
    .order("completed_at", { ascending: false }).limit(200);
  const keptIds = new Set(((kept ?? []) as any[]).map(r => r.private_session_id ?? r.library_session_id));
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
      ...privateRows.map(r => ({ kind: "private" as const, id: r.id, title: titles.get(r.private_case_id) ?? "Your case", versionId: null, status: r.status, startedAt: r.created_at, completedAt: r.completed_at ?? null, kept: keptIds.has(r.id) })),
      ...libRows.map(r => ({ kind: "library" as const, id: r.id, title: null, versionId: r.version_id as string, status: r.status === "in_progress" ? "active" : r.status, startedAt: r.started_at, completedAt: r.completed_at ?? null, kept: keptIds.has(r.id) })),
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
    admin.from("individual_scholar_attempt").select("question_id, correct, answered_at, marking").eq("user_id", userId).order("answered_at", { ascending: false }).limit(10000),
    admin.from("individual_scholar_card").select("material_id, status, next_review_at").eq("user_id", userId).limit(5000),
  ]);
  const err = m.error ?? q.error ?? a.error ?? c.error;
  if (err) return fail(err);
  return {
    ok: true,
    data: {
      materials: (m.data ?? []).map((r: any) => ({ id: r.id, title: r.title, createdAt: r.created_at })),
      questions: (q.data ?? []).map((r: any) => ({ id: r.id, materialId: r.material_id, kind: r.kind })),
      attempts: (a.data ?? []).map((r: any) => ({ questionId: r.question_id, correct: r.correct, answeredAt: r.answered_at, marking: r.marking ?? undefined })),
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

/** SCHOLAR-UPLOAD-FIX: the programme each analysed section of one material was analysed against (null: none). */
export async function analysedProgrammes(admin: Admin, userId: string, materialId: string): Promise<Read<Map<string, string | null>>> {
  const { data, error } = await admin.from("individual_scholar_chunk_analysis").select("chunk_id, programme_code")
    .eq("user_id", userId).eq("material_id", materialId).limit(2000);
  if (error) return fail(error);
  return { ok: true, data: new Map(((data ?? []) as any[]).map(r => [r.chunk_id, r.programme_code ?? null])) };
}

/**
 * SCHOLAR-UPLOAD-FIX: after a re-link, record that these sections are now analysed against `programmeCode`. Only the
 * programme is changed: the concepts found, the model and the prompt version of the analysis row are kept as they are.
 */
export async function markRelinked(admin: Admin, userId: string, materialId: string, chunkIds: readonly string[], programmeCode: string): Promise<boolean> {
  if (!chunkIds.length) return true;
  const { error } = await admin.from("individual_scholar_chunk_analysis").update({ programme_code: programmeCode })
    .eq("user_id", userId).eq("material_id", materialId).in("chunk_id", [...chunkIds]);
  return !error;
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
  // MY PLAN PERF: the corrections do not depend on the mappings, and the decisions and the extras need only their ids, so these are two steps, not four.
  const [maps, analysis, corrections] = await Promise.all([m.order("created_at").limit(5000), a.limit(5000), topicCorrections(admin, userId, materialId ?? null)]);
  const err = maps.error ?? analysis.error;
  if (err) return fail(err);
  const ids = ((maps.data ?? []) as any[]).map(r => r.id);
  const [decided, extras] = await Promise.all([
    ids.length ? admin.from("individual_scholar_competency_decision").select("map_id, decision, decided_by, created_at").eq("user_id", userId).in("map_id", ids).order("created_at").limit(20000) : Promise.resolve(null),
    mappingExtras(admin, userId, ids),
  ]);
  let decisions: MappingDecision[] = [];
  if (decided) {
    if (decided.error) return fail(decided.error);
    decisions = ((decided.data ?? []) as any[]).map(d => ({ mappingId: d.map_id, decision: d.decision, decidedBy: d.decided_by, createdAt: d.created_at }));
  }
  const states = mappingStates(decisions);
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
  // MY PLAN PERF: the learner's corrections do not depend on the analysis rows, so both are read together.
  const [{ data, error }, corrections] = await Promise.all([
    admin.from("individual_scholar_chunk_analysis").select("chunk_id, material_id, concepts").eq("user_id", userId).limit(10000),
    topicCorrections(admin, userId, null),
  ]);
  if (error) return isNotProvisioned(error) ? new Map() : null;
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
  // MY PLAN PERF: the titles do not depend on the sections, so both are read together.
  const [{ data, error }, names] = await Promise.all([
    admin.from("individual_scholar_chunk").select("id, material_id, ordinal, page_from, page_to").eq("user_id", userId).in("material_id", ids).order("ordinal").limit(4000),
    titlesOf(admin, userId, ids),
  ]);
  if (error) return fail(error);
  const rank = new Map(ids.map((id, i) => [id, i]));
  return {
    ok: true,
    data: ((data ?? []) as any[]).sort((a, b) => (rank.get(a.material_id)! - rank.get(b.material_id)!) || a.ordinal - b.ordinal).map(r => ({
      chunkId: r.id, materialId: r.material_id, ordinal: r.ordinal, pageFrom: r.page_from, pageTo: r.page_to,
      materialTitle: (names.get(r.material_id) ?? UNNAMED).title, unit: (names.get(r.material_id) ?? UNNAMED).unit,
    })),
  };
}

/**
 * MY PLAN PERF: the text of exactly these sections (id and content), in parallel batches, for the one line a section is named by when no topic has
 * been found. Only the sections asked for are read, never a whole material. Unreadable batches are simply absent.
 */
export async function chunkContents(admin: Admin, userId: string, chunkIds: readonly string[]): Promise<{ id: string; content: string }[]> {
  const ids = [...new Set(chunkIds)].filter(isUuid);
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
  const reads = await Promise.all(batches.map(async b => {
    const { data, error } = await admin.from("individual_scholar_chunk").select("id, content").eq("user_id", userId).in("id", b);
    return error ? [] : ((data ?? []) as any[]).map(r => ({ id: String(r.id), content: String(r.content ?? "") }));
  }));
  return reads.flat();
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

/**
 * A new session with its steps. "not_provisioned" where 414 is absent: the workspace then teaches without history.
 * SCHOLAR-SESSION-AI-02 (740): connected, objectiveOutcome and objectiveText make it a study session. Left out, the row
 * is written exactly as before (no 740 column named, so it works where 740 is absent). Asked for where 740 is absent:
 * "study_not_provisioned", and nothing is written. Free text is screened by the caller first, as the topic is.
 */
export async function createLearningSession(admin: Admin, userId: string, input: {
  scopeKind: LearningSessionRow["scopeKind"]; title: string; topic: string | null; competencyId: string | null; steps: LearningStep[];
} & StudyFieldsInput): Promise<{ ok: true; id: string } | { ok: false; error: "not_provisioned" | "study_not_provisioned" | "failed" }> {
  const study = studyFields(input, input.competencyId);
  if (study && !(await studySessionSchema(admin, userId))) return { ok: false, error: "study_not_provisioned" };
  const { data, error } = await admin.from("individual_scholar_learning_session").insert({
    user_id: userId, scope_kind: input.scopeKind, title: input.title.slice(0, 160), topic: input.topic, competency_id: input.competencyId, ...(study ?? {}),
  }).select("id").single();
  if (error && study && isMissingColumn(error)) { markStudyAbsent(); return { ok: false, error: "study_not_provisioned" }; }
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

// ── LEARNING-CLOSE-2026-11 D03 / LE-03 (955): re-cutting a session's lessons ──────────────────────────────────────────
// A re-cut is the same sections regrouped (learn-recut.ts). The 955 function rewrites the step rows and re-points the
// events, the 790 position, lesson notes and lesson-linked artefacts in one transaction. Where 955 is absent nothing
// here is called: the probe answers false, getLearningSession reads the 414 columns only and events are read as before.
let recut955: boolean | null = null;
/** Whether migration 955 is applied on this environment. A transient read error is "no" for now, and asked again. */
export async function learningRecutSchema(admin: Admin, userId: string): Promise<boolean> {
  if (recut955 !== null) return recut955;
  try {
    const { error } = await admin.from("individual_scholar_learning_session").select("lesson_titles").eq("user_id", userId).limit(1);
    if (!error) return (recut955 = true);
    if (isMissingColumn(error) || isNotProvisioned(error)) recut955 = false;
    return false;
  } catch { return false; }
}
/** Tests only: forget what was detected. */
export const resetLearningRecutSchema = () => { recut955 = null; };
export type RecutOutcome = { ok: true; summary: Record<string, unknown> } | { ok: false; error: "not_provisioned" | "not_found" | "invalid" | "failed" };
/**
 * Re-cut one of the caller's sessions through the 955 function: `steps` is every section of the session, regrouped,
 * each exactly once (the function refuses anything else: "invalid"); `titles` one name or null per lesson, or null.
 */
export async function recutLearningSession(admin: Admin, userId: string, id: string, steps: readonly (readonly string[])[], titles: readonly (string | null)[] | null): Promise<RecutOutcome> {
  if (!isUuid(id)) return { ok: false, error: "not_found" };
  if (!(await learningRecutSchema(admin, userId))) return { ok: false, error: "not_provisioned" };
  try {
    const { data, error } = await admin.rpc("individual_scholar_learning_session_recut", { p_user_id: userId, p_session_id: id, p_steps: steps, p_titles: titles });
    if (error) {
      if (isMissingRpc(error)) { recut955 = false; return { ok: false, error: "not_provisioned" }; }
      const code = String(error.code ?? "");
      return { ok: false, error: code === "P0002" ? "not_found" : code === "22023" || code === "23514" || code === "23505" ? "invalid" : "failed" };
    }
    return { ok: true, summary: (data && typeof data === "object" ? data : {}) as Record<string, unknown> };
  } catch { return { ok: false, error: "failed" }; }
}

/**
 * One of the person's sessions with its steps (sections in document order within a step), or null.
 * LE-03: and the learner's own lesson names (955 lesson_titles), null where none or where 955 is absent.
 */
export async function getLearningSession(admin: Admin, userId: string, id: string): Promise<Read<{ session: LearningSessionRow; steps: LearningStep[]; lessonTitles: (string | null)[] | null } | null>> {
  if (!isUuid(id)) return { ok: true, data: null };
  const withTitles = await learningRecutSchema(admin, userId);
  const { data, error } = await admin.from("individual_scholar_learning_session").select(withTitles ? `${SESSION_COLS}, lesson_titles` : SESSION_COLS).eq("user_id", userId).eq("id", id).maybeSingle();
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
  return { ok: true, data: { session: toSession(data), steps, lessonTitles: withTitles ? parseLessonTitles((data as any).lesson_titles, steps.length) : null } };
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

// ── CONNECTED STUDY SESSIONS (740, SCHOLAR-SESSION-AI-02) ── a Learn session carried across the four spaces ─────────
//
// Owner D1: a study session IS a 414 Learn session with connected true. 740 adds connected, last_space, objective_outcome
// (held to competency_id) and objective_text, and individual_scholar_study_link, which says that one of the learner's
// own activities belongs to the session. Detected once, as 710, 720 and 730 are: one read of the four 740 columns and
// one of the link table, keyed on the caller. Absent (42703 or PGRST204 column, 42P01 or PGRST205 table): every
// function here answers null, [] or "unavailable", never throws, and the policy gate (isStudySessionsOn) is off.
// A link row is written only after the ref is proved to be the caller's own, in the matching table: 740 has no foreign
// key to the activity tables, so that check is here. Nothing here writes assessment, verification or Passport rows (D5).
let study740: boolean | null = null;
const isMissingColumn = (error: any) => ["PGRST204", "42703"].includes(String(error?.code ?? ""));
/** Whether migration 740 is applied on this environment. A transient read error is "no" for now, and asked again. */
export async function studySessionSchema(admin: Admin, userId: string): Promise<boolean> {
  if (study740 !== null) return study740;
  try {
    const { error } = await admin.from("individual_scholar_learning_session").select("connected, last_space, objective_outcome, objective_text").eq("user_id", userId).limit(1);
    if (error) { if (isNotProvisioned(error)) study740 = false; return false; }
    const { error: lErr } = await admin.from("individual_scholar_study_link").select("id").eq("user_id", userId).limit(1);
    if (!lErr) return (study740 = true);
    if (isNotProvisioned(lErr)) study740 = false;
    return false;
  } catch { return false; }
}
/** A 740 column or table was missing on a later call: 740 is treated as absent from now on in this process. */
const markStudyAbsent = () => { study740 = false; };
/** Tests only: forget what was detected. */
export const resetStudySessionSchema = () => { study740 = null; };

export type StudySessionRow = LearningSessionRow & { connected: true; lastSpace: StudySpace | null; objectiveOutcome: string | null; objectiveText: string | null };
const STUDY_SESSION_COLS = `${SESSION_COLS}, connected, last_space, objective_outcome, objective_text`;
const toStudySession = (r: any): StudySessionRow => ({
  ...toSession(r), connected: true, lastSpace: isStudySpace(r.last_space) ? r.last_space : null,
  objectiveOutcome: r.objective_outcome ?? null, objectiveText: r.objective_text ?? null,
});

/** One of the caller's CONNECTED sessions, or null: not a uuid, not theirs, not connected, unreadable, or 740 absent. */
export async function getConnectedSession(admin: Admin, userId: string, id: string): Promise<StudySessionRow | null> {
  if (!isUuid(id) || !(await studySessionSchema(admin, userId))) return null;
  try {
    const { data, error } = await admin.from("individual_scholar_learning_session").select(STUDY_SESSION_COLS)
      .eq("user_id", userId).eq("id", id).eq("connected", true).maybeSingle();
    if (error) { if (isNotProvisioned(error)) markStudyAbsent(); return null; }
    return data ? toStudySession(data) : null;
  } catch { return null; }
}

/** The caller's most recently used active connected session, for "Continue your study session". Null where none. */
export async function latestConnectedSession(admin: Admin, userId: string): Promise<StudySessionRow | null> {
  if (!(await studySessionSchema(admin, userId))) return null;
  try {
    const { data, error } = await admin.from("individual_scholar_learning_session").select(STUDY_SESSION_COLS)
      .eq("user_id", userId).eq("connected", true).eq("status", "active").order("last_active_at", { ascending: false }).limit(1).maybeSingle();
    if (error) { if (isNotProvisioned(error)) markStudyAbsent(); return null; }
    return data ? toStudySession(data) : null;
  } catch { return null; }
}

/** Record the space the learner is in, on their own connected session (and when it was last used). No AI. */
export async function setLastSpace(admin: Admin, userId: string, id: string, space: StudySpace): Promise<"ok" | "not_found" | "unavailable"> {
  if (!isUuid(id) || !isStudySpace(space)) return "not_found";
  if (!(await studySessionSchema(admin, userId))) return "unavailable";
  try {
    const { data, error } = await admin.from("individual_scholar_learning_session")
      .update({ last_space: space, last_active_at: new Date().toISOString() })
      .eq("user_id", userId).eq("id", id).eq("connected", true).select("id");
    if (error) { if (isNotProvisioned(error)) markStudyAbsent(); return "unavailable"; }
    return (data ?? []).length ? "ok" : "not_found";
  } catch { return "unavailable"; }
}

/** Whether ref is the caller's own activity of this kind. One literal, caller-keyed read per kind (harness A1). */
async function ownsStudyRef(admin: Admin, userId: string, kind: StudyLinkKind, refId: string): Promise<boolean> {
  let q: any;
  switch (kind) {
    case "revision_session": q = admin.from("individual_scholar_revision_session").select("id").eq("user_id", userId).eq("id", refId); break;
    case "osce_attempt": q = admin.from("individual_scholar_osce_attempt").select("id").eq("user_id", userId).eq("id", refId); break;
    case "flashcard_deck": q = admin.from("individual_scholar_flashcard_deck").select("id").eq("user_id", userId).eq("id", refId); break;
    case "case_session": {
      // The learner's own private case session, or (SCHOLAR-INTELLIGENCE-COMPLETE-01) their own governed library play.
      const own = await admin.from("individual_scholar_case_session").select("id").eq("user_id", userId).eq("id", refId).maybeSingle();
      if (!own.error && own.data) return true;
      return (await librarySessionVersion(admin, userId, refId)) !== null;
    }
    case "evaluation": q = admin.from("individual_scholar_evaluation").select("id").eq("user_id", userId).eq("id", refId); break;
    // An exam paper's key is its material (570).
    case "exam_paper": q = admin.from("individual_scholar_exam_paper").select("material_id").eq("user_id", userId).eq("material_id", refId); break;
    default: return false;
  }
  const { data, error } = await q.maybeSingle();
  return !error && !!data;
}

/**
 * Link one of the caller's own activities to one of their own connected sessions. Idempotent on (session, kind, ref):
 * linking twice is "ok" and leaves one row. "not_found" (non-disclosing) where the session is not the caller's
 * connected session or the ref is not the caller's own activity of that kind. "unavailable" where 740 is absent.
 */
export async function addStudyLink(admin: Admin, userId: string, input: { sessionId: string; kind: StudyLinkKind; refId: string }): Promise<"ok" | "not_found" | "unavailable" | "failed"> {
  if (!isUuid(input.sessionId) || !isUuid(input.refId) || !isStudyLinkKind(input.kind)) return "not_found";
  if (!(await studySessionSchema(admin, userId))) return "unavailable";
  try {
    if (!(await getConnectedSession(admin, userId, input.sessionId))) return "not_found";
    if (!(await ownsStudyRef(admin, userId, input.kind, input.refId))) return "not_found";
    const { error } = await admin.from("individual_scholar_study_link")
      .upsert({ session_id: input.sessionId, user_id: userId, kind: input.kind, ref_id: input.refId }, { onConflict: "session_id,kind,ref_id", ignoreDuplicates: true });
    if (error) { if (isNotProvisioned(error)) { markStudyAbsent(); return "unavailable"; } return "failed"; }
    return "ok";
  } catch { return "failed"; }
}

export type StudyLinkRow = { kind: StudyLinkKind; refId: string; createdAt: string };

/** The activities linked to one of the caller's sessions, oldest first. [] where none; null where 740 is absent or unreadable. */
export async function listStudyLinks(admin: Admin, userId: string, sessionId: string): Promise<StudyLinkRow[] | null> {
  if (!isUuid(sessionId)) return [];
  if (!(await studySessionSchema(admin, userId))) return null;
  try {
    const { data, error } = await admin.from("individual_scholar_study_link").select("kind, ref_id, created_at")
      .eq("user_id", userId).eq("session_id", sessionId).order("created_at").limit(500);
    if (error) { if (isNotProvisioned(error)) markStudyAbsent(); return null; }
    return ((data ?? []) as any[]).filter(r => isStudyLinkKind(r.kind)).map(r => ({ kind: r.kind, refId: r.ref_id, createdAt: r.created_at }));
  } catch { return null; }
}

/** One learning action, with the sections it used and, for a clarification, the informal verdict. Structure only. */
export async function recordLearningEvent(admin: Admin, userId: string, input: { sessionId: string; step: number; action: string; verdict: string | null; chunkIds: readonly string[]; attemptId?: string | null }): Promise<"ok" | "failed"> {
  // An event row is structure only (414): session, step, action, verdict and -- LEARNING-CLOSE-2026-11 D01 (950) -- the kept check
  // attempt a clarify event judged, by id. Where 950 is absent the link is dropped and the event is kept as 414 keeps it.
  const row = { session_id: input.sessionId, step: input.step, action: input.action, verdict: input.verdict };
  let { data, error } = await admin.from("individual_scholar_learning_event").insert({ user_id: userId, ...row, ...(input.attemptId ? { attempt_id: input.attemptId } : {}) }).select("id").single();
  if (error && input.attemptId && /column|schema cache/i.test(String((error as any)?.message ?? ""))) ({ data, error } = await admin.from("individual_scholar_learning_event").insert({ user_id: userId, ...row }).select("id").single());
  if (error) return "failed";
  const ids = [...new Set(input.chunkIds.filter(isUuid))];
  if (ids.length) {
    const { error: e2 } = await admin.from("individual_scholar_learning_event_source").insert(ids.map(chunk_id => ({ event_id: data.id, user_id: userId, chunk_id })));
    if (e2) return "failed";
  }
  await admin.from("individual_scholar_learning_session").update({ last_active_at: new Date().toISOString() }).eq("user_id", userId).eq("id", input.sessionId);
  return "ok";
}

// ── LEARNING-CLOSE-2026-11 WS01 (owner decision D01, 4 Nov 2026): A CHECK QUESTION IS A QUESTION ROW, ITS ANSWER AN ATTEMPT ──
//
// REUSE. A Teach Me check question becomes an individual_scholar_question of the lesson's section (416 kind short; the extended
// format where the judgement gave at least EXTENDED_POINTS_MIN key learning points, which are its rubric), once per section and
// stem. Each answer is an individual_scholar_attempt: `response` holds the typed text and the judgement (learn-check-record.ts
// checkResponse) and, for an AI judgement, the written-feedback copy; marking says how it was judged. The clarify learning event
// references the attempt (950 attempt_id). A missed check (not yet) makes or resets the question's 372 card, so Revise and
// My Plan see the gap exactly as they see a missed practice question. FORMATIVE: never assessment, never competence.

export type CheckQuestionInput = {
  materialId: string; chunkId: string; stem: string; keyPoints: readonly string[]; modelAnswer: string | null; sourceQuote: string;
  competencyId: string | null; model: string; provider: string; promptVersion: string;
};

/** The question row of a check (found by section and stem, else written). Null where it could not be kept (fail closed). */
export async function ensureCheckQuestion(admin: Admin, userId: string, q: CheckQuestionInput): Promise<{ id: string; contentVersion: number; created: boolean } | null> {
  const stem = q.stem.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!stem || !isUuid(q.materialId) || !isUuid(q.chunkId)) return null;
  const { data: found } = await admin.from("individual_scholar_question").select("id, content_version").eq("user_id", userId).eq("chunk_id", q.chunkId).eq("kind", "short").eq("stem", stem)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (found?.id) return { id: String(found.id), contentVersion: Number(found.content_version ?? 1), created: false };
  const points = [...new Set(q.keyPoints.map(p => p.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, EXTENDED_POINTS_MAX);
  const model = ((q.modelAnswer ?? points.join(" ")).trim() || stem).slice(0, 1200);
  // The 416 short key (accepted answers, 1 to 8) holds the model answer: a typed answer never matches it by code, so it is judged
  // (AI or the learner's own grade), never guessed. With enough key points it is the extended format (formats.ts extendedSpecOf).
  const answer = points.length >= EXTENDED_POINTS_MIN
    ? { format: "extended", accepted: [model], modelAnswer: model, marks: points.length, partialCredit: { rule: "per_key_point", marksPerPoint: 1 }, rubric: { keyPoints: points }, check: { source: "lesson" } }
    : { accepted: [model], modelAnswer: model, rubric: { keyPoints: points }, check: { source: "lesson" } };
  const row = {
    material_id: q.materialId, chunk_id: q.chunkId, kind: "short", stem, options: [], correct_index: null, answer, difficulty: 2, review_status: "private_formative",
    rationale: model, source_quote: (q.sourceQuote.trim() || stem).slice(0, 1500), model: q.model.slice(0, 200), provider: q.provider.slice(0, 100), prompt_version: q.promptVersion.slice(0, 200),
  };
  let { data, error } = await admin.from("individual_scholar_question").insert({ user_id: userId, ...row, ...(q.competencyId ? { competency_id: q.competencyId } : {}) }).select("id, content_version").single();
  // 388 absent, or the competency unknown here: the question is kept without it.
  if (error && q.competencyId) ({ data, error } = await admin.from("individual_scholar_question").insert({ user_id: userId, ...row }).select("id, content_version").single());
  if (error || !data?.id) return null;
  return { id: String(data.id), contentVersion: Number(data.content_version ?? 1), created: true };
}

export type CheckAttemptInput = {
  questionId: string; contentVersion: number | null; response: Record<string, unknown>; correct: boolean; score: number | null;
  marking: "ai_evaluation" | "self_graded" | "unmarked"; evaluator: { model: string; promptVersion: string } | null;
  /** A missed check (not yet): the question's card is made or reset, due today (Revise, My Plan). */
  missed: boolean;
};

/** One kept answer. Null where it could not be kept (416 or 950 refusing: said to the learner, never silently dropped). */
export async function recordCheckAttempt(admin: Admin, userId: string, a: CheckAttemptInput): Promise<{ id: string; answeredAt: string } | null> {
  const base = {
    question_id: a.questionId, chosen_index: null, response: a.response, correct: a.correct, score: a.score, marking: a.marking,
    evaluator_model: a.evaluator?.model.slice(0, 200) ?? null, evaluator_prompt_version: a.evaluator?.promptVersion.slice(0, 200) ?? null,
  };
  let { data, error } = await admin.from("individual_scholar_attempt").insert({ user_id: userId, ...base, ...(a.contentVersion ? { content_version: a.contentVersion } : {}) }).select("id, answered_at").single();
  // 950 absent: no version column (the attempt is kept without it), and no unmarked marking (such an answer cannot be kept: null).
  if (error && a.contentVersion && /column|schema cache/i.test(String((error as any)?.message ?? ""))) ({ data, error } = await admin.from("individual_scholar_attempt").insert({ user_id: userId, ...base }).select("id, answered_at").single());
  if (error || !data?.id) return null;
  if (a.missed) { const q = await getQuestion(admin, userId, a.questionId); if (q) await missCard(admin, userId, q); }
  return { id: String(data.id), answeredAt: String(data.answered_at ?? new Date().toISOString()) };
}

/**
 * The learner's kept checks, newest first: by session and step (a lesson's history), by session, or the latest overall (Saved
 * learning). Read through the clarify events that reference them (950). Without 950 the column is absent and the list is empty.
 */
export async function listCheckAttempts(admin: Admin, userId: string, opts: { sessionId?: string | null; step?: number | null; limit?: number } = {}): Promise<Read<CheckHistoryItem[]>> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  let ev = admin.from("individual_scholar_learning_event").select("session_id, step, attempt_id, created_at").eq("user_id", userId).not("attempt_id", "is", null).order("created_at", { ascending: false }).limit(limit);
  if (opts.sessionId) ev = ev.eq("session_id", opts.sessionId);
  if (opts.step !== null && opts.step !== undefined) ev = ev.eq("step", opts.step);
  const { data: evs, error } = await ev;
  if (error) return isNotProvisioned(error) || /column|schema cache/i.test(String((error as any)?.message ?? "")) ? { ok: true, data: [] } : fail(error);
  const byAttempt = new Map<string, { session_id: string; step: number }>();
  for (const e of (evs ?? []) as any[]) if (e.attempt_id && !byAttempt.has(e.attempt_id)) byAttempt.set(e.attempt_id, { session_id: e.session_id, step: e.step });
  const ids = [...byAttempt.keys()];
  if (!ids.length) return { ok: true, data: [] };
  const { data: atts, error: aErr } = await admin.from("individual_scholar_attempt").select("id, question_id, answered_at, correct, score, marking, evaluator_model, evaluator_prompt_version, response, content_version").eq("user_id", userId).in("id", ids);
  if (aErr) return fail(aErr);
  const qids = [...new Set(((atts ?? []) as any[]).map(a => a.question_id as string))];
  const { data: qs, error: qErr } = await admin.from("individual_scholar_question").select("id, stem, chunk_id, material_id").eq("user_id", userId).in("id", qids);
  if (qErr) return fail(qErr);
  const qMap = new Map(((qs ?? []) as any[]).map(q => [q.id as string, q]));
  const out: CheckHistoryItem[] = [];
  for (const a of (atts ?? []) as any[]) {
    const response = parseCheckResponse(a.response), q = qMap.get(a.question_id), e = byAttempt.get(a.id);
    if (!response || !q) continue;
    const marking = a.marking === "ai_evaluation" || a.marking === "self_graded" || a.marking === "unmarked" ? a.marking : "deterministic";
    out.push({
      attemptId: a.id, questionId: a.question_id, answeredAt: a.answered_at, question: response.question || q.stem, response, marking, correct: !!a.correct,
      score: a.score === null || a.score === undefined ? null : Number(a.score), model: a.evaluator_model ?? null, promptVersion: a.evaluator_prompt_version ?? null,
      contentVersion: a.content_version === null || a.content_version === undefined ? null : Number(a.content_version),
      sessionId: e?.session_id ?? null, step: e?.step ?? null, chunkId: q.chunk_id, materialId: q.material_id,
    });
  }
  out.sort((x, y) => (x.answeredAt < y.answeredAt ? 1 : x.answeredAt > y.answeredAt ? -1 : 0));
  return { ok: true, data: out };
}

export type LearningEventRow = { step: number; action: string; verdict: string | null; createdAt: string };

/**
 * A session's events, in order (what was done, and the informal check outcomes). LE-03 (955): an event detached by a
 * re-cut (its lesson no longer exists as one) is left out, so it counts as no lesson's progress.
 */
/** One lesson's events, newest first, with the kept check each judged. 950 absent: no links. A failed read is a failure, never an empty trail. */
export async function lessonEventTrail(admin: Admin, userId: string, sessionId: string, step: number): Promise<Read<{ action: string; verdict: string | null; attemptId: string | null }[]>> {
  const detached = await learningRecutSchema(admin, userId);
  const read = (cols: string) => { const q = admin.from("individual_scholar_learning_event").select(cols).eq("user_id", userId).eq("session_id", sessionId).eq("step", step); return (detached ? q.is("detached_at", null) : q).order("created_at", { ascending: false }).limit(500); };
  let { data, error } = await read("action, verdict, attempt_id");
  if (error && /column|schema cache/i.test(String((error as any)?.message ?? ""))) ({ data, error } = await read("action, verdict"));
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(r => ({ action: r.action, verdict: r.verdict ?? null, attemptId: r.attempt_id ?? null })) };
}

export async function learningEvents(admin: Admin, userId: string, sessionId: string): Promise<Read<LearningEventRow[]>> {
  let q = admin.from("individual_scholar_learning_event").select("step, action, verdict, created_at").eq("user_id", userId).eq("session_id", sessionId);
  if (await learningRecutSchema(admin, userId)) q = q.is("detached_at", null);
  const { data, error } = await q.order("created_at").limit(2000);
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(r => ({ step: r.step, action: r.action, verdict: r.verdict, createdAt: r.created_at })) };
}

/**
 * When the caller did anything in a Learn session (any action), newest first: timestamps only, for Progress
 * engagement (study days, last studied). Never an input to an evaluation. A store without 414 reads as none.
 */
export async function learningEventTimes(admin: Admin, userId: string): Promise<Read<string[]>> {
  const { data, error } = await admin.from("individual_scholar_learning_event").select("created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(5000);
  if (error) return isNotProvisioned(error) ? { ok: true, data: [] } : fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(r => r.created_at as string) };
}

/** When the caller made a case decision (an answer to a decision point of a case), newest first: timestamps only, for the shared study-activity day. */
export async function caseDecisionTimes(admin: Admin, userId: string): Promise<Read<string[]>> {
  const { data, error } = await admin.from("individual_scholar_case_answer").select("created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(5000);
  if (error) return isNotProvisioned(error) ? { ok: true, data: [] } : fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(r => r.created_at as string) };
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

/**
 * SCHOLAR-COMPETENCY-EXPLORER-HFE-01: practice done against each competency OUTSIDE practice questions -- finished OSCE
 * runs on a station built for it (720) and completed clinical cases mapped to it (435) -- and the learner's Learn
 * sessions opened on it (414). Counts and the newest moment only, for the Explorer's indicators. PRACTICE, NOT
 * COMPETENCE. A source whose migration is absent reads as none; a failed read is null (unreadable, never "none").
 */
export type PracticeByCompetency = { osceFinished: number; casesCompleted: number; learningSessions: number; lastAt: string | null };
export async function practiceEvidenceByCompetency(admin: Admin, userId: string): Promise<Map<string, PracticeByCompetency> | null> {
  const soft = async (q: PromiseLike<{ data: unknown; error: any }>) => { const r = await q; return r.error && isNotProvisioned(r.error) ? { data: [], error: null } : r; };
  const [osce, sessions, learn] = await Promise.all([
    soft(admin.from("individual_scholar_osce_attempt").select("station_id, finished_at").eq("user_id", userId).eq("status", "finished").not("finished_at", "is", null).limit(1000)),
    soft(admin.from("individual_scholar_case_session").select("private_case_id, completed_at").eq("user_id", userId).eq("status", "completed").limit(2000)),
    soft(admin.from("individual_scholar_learning_session").select("competency_id, last_active_at").eq("user_id", userId).not("competency_id", "is", null).limit(2000)),
  ]);
  if (osce.error || sessions.error || learn.error) return null;
  const out = new Map<string, PracticeByCompetency>();
  const at = (id: string) => { let v = out.get(id); if (!v) { v = { osceFinished: 0, casesCompleted: 0, learningSessions: 0, lastAt: null }; out.set(id, v); } return v; };
  const later = (v: PracticeByCompetency, iso: string | null) => { if (iso && (!v.lastAt || iso > v.lastAt)) v.lastAt = iso; };
  const stationIds = [...new Set(((osce.data ?? []) as any[]).map(r => r.station_id).filter(isUuid))];
  if (stationIds.length) {
    const st = await soft(admin.from("individual_scholar_osce_station").select("id, competency_id").eq("user_id", userId).in("id", stationIds.slice(0, 500)));
    if (st.error) return null;
    const compOf = new Map(((st.data ?? []) as any[]).map(s => [s.id, s.competency_id]));
    for (const r of (osce.data ?? []) as any[]) { const c = compOf.get(r.station_id); if (isUuid(c)) { const v = at(c); v.osceFinished++; later(v, r.finished_at ?? null); } }
  }
  const caseIds = [...new Set(((sessions.data ?? []) as any[]).map(r => r.private_case_id).filter(isUuid))];
  if (caseIds.length) {
    const cc = await soft(admin.from("individual_scholar_case_competency").select("case_id, competency_id").eq("user_id", userId).in("case_id", caseIds.slice(0, 500)));
    if (cc.error) return null;
    const compsOf = new Map<string, string[]>();
    for (const r of (cc.data ?? []) as any[]) compsOf.set(r.case_id, [...(compsOf.get(r.case_id) ?? []), r.competency_id]);
    for (const r of (sessions.data ?? []) as any[]) for (const c of compsOf.get(r.private_case_id) ?? []) { const v = at(c); v.casesCompleted++; later(v, r.completed_at ?? null); }
  }
  for (const r of (learn.data ?? []) as any[]) if (isUuid(r.competency_id)) { const v = at(r.competency_id); v.learningSessions++; later(v, r.last_active_at ?? null); }
  return out;
}

/** The titles of the learner's own materials, by id (for "linked materials" in the Explorer drawer). Unreadable: empty, said by the caller as not read. */
export async function materialTitles(admin: Admin, userId: string, ids: readonly string[]): Promise<Map<string, string> | null> {
  const want = [...new Set(ids.filter(isUuid))].slice(0, 500);
  if (!want.length) return new Map();
  const { data, error } = await admin.from("individual_scholar_material").select("id, title").eq("user_id", userId).in("id", want);
  if (error) return null;
  return new Map(((data ?? []) as any[]).map(r => [r.id, r.title ?? "Untitled material"]));
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
  /** SCHOLAR-LIBRARY-01 (820): the lesson it was saved for (new saves only), and when a refresh replaced it. Absent without 820. */
  sessionId?: string | null; step?: number | null; supersededAt?: string | null; dedupeKey?: string;
};
const ARTEFACT_COLS = "id, material_id, action, depth, content, background, flags, refs, model, prompt_version, review_status, created_at";
const ARTEFACT_COLS_820 = `${ARTEFACT_COLS}, session_id, step, superseded_at, dedupe_key`;
const toArtefact = (r: any, sources: string[]): ArtefactRow => ({
  id: r.id, materialId: r.material_id, action: r.action, depth: r.depth, content: r.content, background: r.background ?? null,
  flags: Array.isArray(r.flags) ? r.flags : [], refs: Array.isArray(r.refs) ? r.refs : [], model: r.model, promptVersion: r.prompt_version,
  reviewStatus: "private_formative", createdAt: r.created_at, sources,
  ...("superseded_at" in r ? { sessionId: r.session_id ?? null, step: Number.isInteger(r.step) ? r.step : null, supersededAt: r.superseded_at ?? null, dedupeKey: r.dedupe_key } : {}),
});

// ── MIGRATION 820 (SCHOLAR-LIBRARY-01) ── detected once, and the library keeps working without it ─────────────────
//
// 820 adds learner notes, artefact full text, the lesson link, kept versions and the library search. Detected by one
// read of a note row and one of an 820 artefact column, keyed on the caller. Absent: notes are not offered, a refresh
// replaces as before, the library lists and filters, and search is the basic match (saved-library.ts basicMatches).
let library820: boolean | null = null;
/** Whether migration 820 is applied on this environment. A transient read error is "no" for now, and asked again. */
export async function librarySchema(admin: Admin, userId: string): Promise<boolean> {
  if (library820 !== null) return library820;
  const [n, a] = await Promise.all([
    admin.from("individual_scholar_note").select("id").eq("user_id", userId).limit(1),
    admin.from("individual_scholar_artefact").select("superseded_at").eq("user_id", userId).limit(1),
  ]);
  if (!n.error && !a.error) return (library820 = true);
  if (isNotProvisioned(n.error) || isNotProvisioned(a.error) || isMissingColumn(a.error)) return (library820 = false);
  return false;
}
/** Tests only: forget what was detected. */
export const resetLibrarySchema = () => { library820 = null; };

// SALE-2026-11 R3 (migration 975): the next_action plan-event kind and the summary note kind are widened CHECKs, which a select
// cannot see, so 975 ships a marker function. True only once it answers; a transient error is "no" for now and asked again.
let workspace975: boolean | null = null;
export async function workspaceSchema(admin: Admin): Promise<boolean> {
  if (workspace975 !== null) return workspace975;
  const { data, error } = await admin.rpc("individual_scholar_workspace_975");
  if (!error) return (workspace975 = data === true);
  if (isMissingRpc(error)) return (workspace975 = false);
  return false;
}
/** Tests only: forget what was detected. */
export const resetWorkspaceSchema = (v: boolean | null = null) => { workspace975 = v; };

async function artefactSources(admin: Admin, userId: string, ids: string[]): Promise<Map<string, string[]>> {
  if (!ids.length) return new Map();
  const out = new Map<string, string[]>();
  // In batches, so a long page of ids never makes one oversized request.
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from("individual_scholar_artefact_source").select("artefact_id, ordinal, chunk_id").eq("user_id", userId).in("artefact_id", ids.slice(i, i + 200)).order("ordinal").limit(2000);
    for (const r of (data ?? []) as any[]) out.set(r.artefact_id, [...(out.get(r.artefact_id) ?? []), r.chunk_id]);
  }
  return out;
}

/** The person's saved artefact for this request, or null (none, or 415 absent). A superseded version has another key. */
export async function findArtefact(admin: Admin, userId: string, dedupeKey: string): Promise<ArtefactRow | null> {
  const { data, error } = await admin.from("individual_scholar_artefact").select(ARTEFACT_COLS).eq("user_id", userId).eq("dedupe_key", dedupeKey).maybeSingle();
  if (error || !data) return null;
  return toArtefact(data, (await artefactSources(admin, userId, [data.id])).get(data.id) ?? []);
}

/**
 * Save one artefact. "not_provisioned" where 415 is absent.
 * SCHOLAR-LIBRARY-01 (820): a refresh KEEPS the earlier version -- the row with the same key is marked superseded (its key
 * becomes key:superseded:id, saved-library.ts supersededKey) and the new one is inserted, with the lesson it was saved
 * for. If the insert then fails the earlier version is restored as current. Without 820 it replaces, as before.
 */
export async function saveArtefact(admin: Admin, userId: string, a: {
  materialId: string; action: string; depth: string; content: string; background: string | null; flags: unknown[]; refs: unknown[];
  dedupeKey: string; model: string; promptVersion: string; chunkIds: readonly string[]; lesson?: { sessionId: string; step: number } | null;
}): Promise<"ok" | "not_provisioned" | "failed"> {
  const keep = await librarySchema(admin, userId);
  let previous: string | null = null;
  if (keep) {
    const { data: cur, error: cErr } = await admin.from("individual_scholar_artefact").select("id").eq("user_id", userId).eq("dedupe_key", a.dedupeKey).maybeSingle();
    if (cErr) return isNotProvisioned(cErr) ? "not_provisioned" : "failed";
    if (cur) {
      const { error: uErr } = await admin.from("individual_scholar_artefact").update({ superseded_at: new Date().toISOString(), dedupe_key: supersededKey(a.dedupeKey, cur.id) })
        .eq("user_id", userId).eq("id", cur.id);
      if (uErr) return "failed";
      previous = cur.id;
    }
  } else {
    const del = await admin.from("individual_scholar_artefact").delete().eq("user_id", userId).eq("dedupe_key", a.dedupeKey);
    if (del.error) return isNotProvisioned(del.error) ? "not_provisioned" : "failed";
  }
  const restore = async () => {
    if (previous) await admin.from("individual_scholar_artefact").update({ superseded_at: null, dedupe_key: a.dedupeKey }).eq("user_id", userId).eq("id", previous);
  };
  const lesson = keep && a.lesson && isUuid(a.lesson.sessionId) && Number.isInteger(a.lesson.step) && a.lesson.step >= 0 && a.lesson.step < 200 ? a.lesson : null;
  const { data, error } = await admin.from("individual_scholar_artefact").insert({
    user_id: userId, material_id: a.materialId, action: a.action, depth: a.depth, content: a.content.slice(0, 20000),
    background: a.background ? a.background.slice(0, 2000) : null, flags: a.flags, refs: a.refs, dedupe_key: a.dedupeKey,
    model: a.model.slice(0, 200), prompt_version: a.promptVersion.slice(0, 200), review_status: "private_formative",
    ...(lesson ? { session_id: lesson.sessionId, step: lesson.step } : {}),
  }).select("id").single();
  if (error) { await restore(); return isNotProvisioned(error) ? "not_provisioned" : "failed"; }
  const rows = a.chunkIds.slice(0, 10).map((chunk_id, i) => ({ artefact_id: data.id, user_id: userId, ordinal: i + 1, chunk_id }));
  const { error: sErr } = rows.length ? await admin.from("individual_scholar_artefact_source").insert(rows.map(r => ({ ...r, user_id: userId }))) : { error: null };
  if (sErr) { await admin.from("individual_scholar_artefact").delete().eq("user_id", userId).eq("id", data.id); await restore(); return "failed"; }
  return "ok";
}

/**
 * The person's CURRENT saved artefacts (all, or one material's, or those built on some sections), newest first, at most
 * `limit` (500 by default -- Learn's own reads). The library reads pages instead (libraryArtefactPage). 820: superseded
 * versions are left out.
 */
export async function listArtefacts(admin: Admin, userId: string, opts: { materialId?: string; chunkIds?: readonly string[]; limit?: number } = {}): Promise<Read<ArtefactRow[]>> {
  let ids: string[] | null = null;
  if (opts.chunkIds?.length) {
    const { data, error } = await admin.from("individual_scholar_artefact_source").select("artefact_id").eq("user_id", userId).in("chunk_id", [...opts.chunkIds]).limit(2000);
    if (error) return fail(error);
    ids = [...new Set(((data ?? []) as any[]).map(r => r.artefact_id))];
    if (!ids.length) return { ok: true, data: [] };
  }
  const v820 = await librarySchema(admin, userId);
  let q = admin.from("individual_scholar_artefact").select(v820 ? ARTEFACT_COLS_820 : ARTEFACT_COLS).eq("user_id", userId);
  if (v820) q = q.is("superseded_at", null);
  if (opts.materialId) q = q.eq("material_id", opts.materialId);
  if (ids) q = q.in("id", ids);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(Math.min(Math.max(opts.limit ?? 500, 1), 1000));
  if (error) return fail(error);
  const src = await artefactSources(admin, userId, ((data ?? []) as any[]).map(r => r.id));
  return { ok: true, data: ((data ?? []) as any[]).map(r => toArtefact(r, src.get(r.id) ?? [])) };
}

// ── SCHOLAR-PERSISTENT-LEARNING-01: SAVED TEACHING AND LESSON RECORDS, WITHOUT AI (learn-journey.ts says the rules) ──

/**
 * The newest saved artefact of `action` for this lesson's own chunk set and material, whatever prompt version, depth or
 * mode it was written under (learn-journey.ts newestSavedLesson). Learn/act's open falls back to it when the exact key
 * finds nothing, so a lesson taught under an older prompt or other settings reopens with no AI call. Keyed on user_id.
 */
export async function findSavedLesson(admin: Admin, userId: string, q: { action: string; materialId: string | null; chunkIds: readonly string[]; lesson?: { sessionId: string; step: number } | null }): Promise<ArtefactRow | null> {
  if (!q.chunkIds.length) return null;
  const r = await listArtefacts(admin, userId, { chunkIds: [q.chunkIds[0]], ...(q.materialId ? { materialId: q.materialId } : {}) });
  return r.ok ? newestSavedLesson(r.data, q) : null;
}

/**
 * Per lesson of a session: its newest saved teaching of `action` (metadata only, never the content) and the attempts on
 * questions from its own sections -- the server records behind the lesson states (learn-journey.ts lessonFacts). Reads
 * only, keyed on user_id. Anything unreadable (415 / 416 absent) is simply not counted: a lesson then shows what the
 * learning events say, never a fabricated state.
 */
export async function learnLessonRecords(admin: Admin, userId: string, steps: readonly LearningStep[], action: string, sessionId: string | null = null): Promise<LessonRecord[]> {
  const all = [...new Set(steps.flatMap(s => s.sections.map(x => x.chunkId)))].slice(0, 400);
  const empty: LessonRecord[] = steps.map(s => ({ step: s.step, saved: null, attempts: 0 }));
  if (!all.length) return empty;
  const [src, qs] = await Promise.all([
    admin.from("individual_scholar_artefact_source").select("artefact_id").eq("user_id", userId).in("chunk_id", all).limit(2000),
    admin.from("individual_scholar_question").select("id, chunk_id").eq("user_id", userId).in("chunk_id", all).limit(2000),
  ]);
  const list = (r: { data?: unknown; error?: unknown } | null): any[] => (r && !r.error && Array.isArray(r.data) ? r.data : []);
  const ids: string[] = [...new Set(list(src).map(r => String(r.artefact_id)))];
  const [arts, sources, att] = await Promise.all([
    // SCHOLAR-GO-DEEPER-001: 820's own record of the lesson a row was saved for, so a lesson over ten sections finds its saved teaching here too (learn-journey.ts coversLesson).
    ids.length ? (async () => { const v820 = await librarySchema(admin, userId); const q = admin.from("individual_scholar_artefact").select(`id, material_id, action, depth, prompt_version, created_at${v820 ? ", session_id, step" : ""}`).eq("user_id", userId).eq("action", action).in("id", ids); return (v820 ? q.is("superseded_at", null) : q).limit(500); })() : null,
    artefactSources(admin, userId, ids),
    list(qs).length ? admin.from("individual_scholar_attempt").select("question_id").eq("user_id", userId).in("question_id", list(qs).map(q => q.id)).limit(5000) : null,
  ]);
  const rows = list(arts).map(r => ({ id: r.id as string, materialId: r.material_id as string, action: r.action as string, depth: r.depth as string, promptVersion: r.prompt_version as string, createdAt: r.created_at as string, sources: sources.get(r.id) ?? [], sessionId: (r.session_id ?? null) as string | null, step: Number.isInteger(r.step) ? (r.step as number) : null }));
  const chunkOf = new Map<string, string>(list(qs).map(q => [String(q.id), String(q.chunk_id)]));
  const perChunk = new Map<string, number>();
  for (const a of list(att)) { const c = chunkOf.get(a.question_id); if (c) perChunk.set(c, (perChunk.get(c) ?? 0) + 1); }
  return steps.map(s => {
    const chunkIds = s.sections.map(x => x.chunkId);
    const best = newestSavedLesson(rows, { action, materialId: s.sections[0]?.materialId ?? null, chunkIds, lesson: sessionId ? { sessionId, step: s.step } : null });
    return { step: s.step, saved: best ? { at: best.createdAt, promptVersion: best.promptVersion, depth: best.depth } : null, attempts: chunkIds.reduce((n, c) => n + (perChunk.get(c) ?? 0), 0) };
  });
}

// ── SCHOLAR-LIBRARY-01: THE PERSONAL LIBRARY (migration 820, saved-library.ts says the rules) ────────────────────────────
//
// Reads for the Saved learning page, the notes route and the export, every statement keyed on the caller's own user_id.
// Pages are keyset (created_at or last_active_at, then id), so a library of any size is read 25 at a time, never capped
// at 500. Learner notes are written only here. Search is one RPC (individual_scholar_library_search, SECURITY INVOKER,
// service role only) called with the caller's id: supabase-js cannot express websearch_to_tsquery with ts_headline and
// ts_rank, and the function keys every branch on p_user_id. No AI anywhere.

/** One page of the caller's saved teaching, newest (or oldest) first, after `cursor`. `ids` narrows to some artefacts. */
export async function libraryArtefactPage(admin: Admin, userId: string, o: {
  materialId?: string | null; ids?: readonly string[] | null; fromIso?: string | null; toIso?: string | null;
  versions: "current" | "earlier"; sort: "newest" | "oldest"; cursor: Cursor | null; limit: number;
}): Promise<Read<{ rows: ArtefactRow[]; next: Cursor | null }>> {
  const v820 = await librarySchema(admin, userId);
  if (o.versions === "earlier" && !v820) return { ok: true, data: { rows: [], next: null } };
  if (o.ids && !o.ids.length) return { ok: true, data: { rows: [], next: null } };
  let q = admin.from("individual_scholar_artefact").select(v820 ? ARTEFACT_COLS_820 : ARTEFACT_COLS).eq("user_id", userId);
  if (v820) q = o.versions === "earlier" ? q.not("superseded_at", "is", null) : q.is("superseded_at", null);
  if (o.materialId && isUuid(o.materialId)) q = q.eq("material_id", o.materialId);
  if (o.ids) q = q.in("id", o.ids.filter(isUuid).slice(0, 300));
  if (o.fromIso) q = q.gte("created_at", o.fromIso);
  if (o.toIso) q = q.lt("created_at", o.toIso);
  if (o.cursor) q = q.or(keysetFilter(o.cursor, o.sort));
  const asc = o.sort === "oldest";
  const { data, error } = await q.order("created_at", { ascending: asc }).order("id", { ascending: asc }).limit(o.limit + 1);
  if (error) return fail(error);
  const rows = (data ?? []) as any[];
  const page = pageOf(rows, o.limit, r => r.created_at);
  const src = await artefactSources(admin, userId, page.items.map(r => r.id));
  return { ok: true, data: { rows: page.items.map(r => toArtefact(r, src.get(r.id) ?? [])), next: page.next } };
}

/** The caller's artefacts built on any of these sections (current and earlier), at most `max`. null when unreadable. */
export async function artefactIdsForChunks(admin: Admin, userId: string, chunkIds: readonly string[], max = 2000): Promise<string[] | null> {
  const ids = [...new Set(chunkIds.filter(isUuid))];
  const out = new Set<string>();
  for (let i = 0; i < ids.length && out.size < max; i += 200) {
    const { data, error } = await admin.from("individual_scholar_artefact_source").select("artefact_id").eq("user_id", userId).in("chunk_id", ids.slice(i, i + 200)).limit(max);
    if (error) return null;
    for (const r of (data ?? []) as any[]) out.add(r.artefact_id);
  }
  return [...out].slice(0, max);
}

/**
 * The caller's sections mapped to one competency (proposed or accepted, never rejected), at most 2000. `acceptedOnly` (CE-02, the
 * library's Competency filter): only the mappings the learner or an approver accepted, never a bare AI proposal.
 */
export async function chunksForCompetency(admin: Admin, userId: string, competencyId: string, o: { acceptedOnly?: boolean } = {}): Promise<string[]> {
  if (!isUuid(competencyId)) return [];
  const { data, error } = await admin.from("individual_scholar_competency_map").select("id, chunk_id").eq("user_id", userId).eq("competency_id", competencyId).limit(2000);
  if (error || !data?.length) return [];
  const { data: d } = await admin.from("individual_scholar_competency_decision").select("map_id, decision, decided_by, created_at").eq("user_id", userId).in("map_id", (data as any[]).map(r => r.id).slice(0, 500)).limit(5000);
  const states = mappingStates(((d ?? []) as any[]).map(x => ({ mappingId: x.map_id, decision: x.decision, decidedBy: x.decided_by, createdAt: x.created_at })));
  return [...new Set((data as any[]).filter(r => (o.acceptedOnly ? states.get(r.id)?.state === "accepted" : states.get(r.id)?.state !== "rejected")).map(r => r.chunk_id as string))];
}

/**
 * CE-02: the caller's sessions that hold saved items -- a current saved lesson or a note recorded against the session (820) -- most
 * recently active first, at most `limit`. Empty without 820. A foreign session id never appears: both reads are keyed on the caller.
 */
export async function sessionsWithSavedItems(admin: Admin, userId: string, limit = 100): Promise<LearningSessionRow[]> {
  if (!(await librarySchema(admin, userId))) return [];
  const [a, n] = await Promise.all([
    admin.from("individual_scholar_artefact").select("session_id").eq("user_id", userId).is("superseded_at", null).not("session_id", "is", null).limit(2000),
    admin.from("individual_scholar_note").select("session_id").eq("user_id", userId).not("session_id", "is", null).limit(2000),
  ]);
  const ids = [...new Set([...(a.error ? [] : (a.data ?? [])), ...(n.error ? [] : (n.data ?? []))].map((r: any) => r.session_id as string))].filter(isUuid);
  const rows = await sessionsByIds(admin, userId, ids);
  return rows.sort((x, y) => y.lastActiveAt.localeCompare(x.lastActiveAt)).slice(0, limit);
}

/**
 * CE-02: the caller's saved lessons that belong to one session: those 820 recorded against it at save, and older ones (no session
 * recorded) whose sections all sit inside the session's own steps. null when unreadable; [] for a session that is not theirs.
 */
export async function artefactIdsForSession(admin: Admin, userId: string, sessionId: string): Promise<string[] | null> {
  if (!isUuid(sessionId)) return [];
  const v820 = await librarySchema(admin, userId);
  const out = new Set<string>();
  if (v820) {
    const { data, error } = await admin.from("individual_scholar_artefact").select("id").eq("user_id", userId).eq("session_id", sessionId).limit(2000);
    if (error) return null;
    for (const r of (data ?? []) as any[]) out.add(r.id);
  }
  const chunks = (await sessionStepSummaries(admin, userId, [sessionId])).get(sessionId)?.chunkIds ?? [];
  if (chunks.length) {
    const inside = new Set(chunks);
    const cand = await artefactIdsForChunks(admin, userId, chunks);
    if (cand === null) return null;
    if (cand.length) {
      const [src, own] = await Promise.all([
        artefactSources(admin, userId, cand),
        v820 ? admin.from("individual_scholar_artefact").select("id, session_id").eq("user_id", userId).in("id", cand.slice(0, 300)).limit(300) : Promise.resolve({ data: null, error: null }),
      ]);
      if (own.error) return null;
      const recorded = new Map(((own.data ?? []) as any[]).map(r => [r.id as string, r.session_id as string | null]));
      for (const id of cand) {
        const sources = src.get(id) ?? [];
        // A lesson recorded against ANOTHER session is that session's; an older one is matched by its sections alone.
        if (sources.length && sources.every(c => inside.has(c)) && !recorded.get(id)) out.add(id);
      }
    }
  }
  return [...out];
}

/** One of the caller's saved teachings by id, current or earlier, with its sources. null: not theirs, or none. */
export async function getArtefact(admin: Admin, userId: string, id: string): Promise<ArtefactRow | null> {
  if (!isUuid(id)) return null;
  const v820 = await librarySchema(admin, userId);
  const { data, error } = await admin.from("individual_scholar_artefact").select(v820 ? ARTEFACT_COLS_820 : ARTEFACT_COLS).eq("user_id", userId).eq("id", id).maybeSingle();
  if (error || !data) return null;
  return toArtefact(data, (await artefactSources(admin, userId, [data.id])).get(data.id) ?? []);
}

/** Some of the caller's saved teachings by id (any version, or current only), with their sources. A foreign id is not found. */
export async function artefactsByIds(admin: Admin, userId: string, ids: readonly string[], o: { currentOnly?: boolean } = {}): Promise<Read<ArtefactRow[]>> {
  const keep = [...new Set(ids.filter(isUuid))];
  if (!keep.length) return { ok: true, data: [] };
  const v820 = await librarySchema(admin, userId);
  const out: any[] = [];
  for (let i = 0; i < keep.length; i += 200) {
    let q = admin.from("individual_scholar_artefact").select(v820 ? ARTEFACT_COLS_820 : ARTEFACT_COLS).eq("user_id", userId).in("id", keep.slice(i, i + 200));
    if (v820 && o.currentOnly) q = q.is("superseded_at", null);
    const { data, error } = await q.limit(200);
    if (error) return fail(error);
    out.push(...((data ?? []) as any[]));
  }
  const src = await artefactSources(admin, userId, out.map(r => r.id));
  return { ok: true, data: out.map(r => toArtefact(r, src.get(r.id) ?? [])).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}

/** Every version of the caller's saved teaching `id` belongs to (the same key), current first, then newest. [] without 820. */
export async function artefactVersions(admin: Admin, userId: string, id: string): Promise<ArtefactRow[]> {
  const one = await getArtefact(admin, userId, id);
  if (!one?.dedupeKey) return one ? [one] : [];
  const key = baseKey(one.dedupeKey);
  if (!/^[0-9a-f]{64}$/.test(key)) return [one];
  const { data, error } = await admin.from("individual_scholar_artefact").select(ARTEFACT_COLS_820).eq("user_id", userId)
    .or(`dedupe_key.eq.${key},dedupe_key.like.${key}:superseded:*`).order("created_at", { ascending: false }).limit(100);
  if (error) return [one];
  const src = await artefactSources(admin, userId, ((data ?? []) as any[]).map(r => r.id));
  return orderVersions(((data ?? []) as any[]).map(r => toArtefact(r, src.get(r.id) ?? [])));
}

/** How many earlier versions each of these current teachings keeps (820), by artefact id. */
export async function earlierVersionCounts(admin: Admin, userId: string, rows: readonly ArtefactRow[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const keyed = rows.filter(r => r.dedupeKey && !r.supersededAt);
  if (!keyed.length) return out;
  const byKey = new Map(keyed.map(r => [r.dedupeKey!, r.id]));
  const ors = keyed.map(r => `dedupe_key.like.${r.dedupeKey}:superseded:*`).join(",");
  const { data, error } = await admin.from("individual_scholar_artefact").select("dedupe_key").eq("user_id", userId).or(ors).limit(2000);
  if (error) return out;
  for (const r of (data ?? []) as any[]) { const id = byKey.get(baseKey(r.dedupe_key)); if (id) out.set(id, (out.get(id) ?? 0) + 1); }
  return out;
}

/** The lessons (session, step and the step's whole chunk set) of the caller's sessions that use any of these sections. */
export async function lessonsForChunks(admin: Admin, userId: string, chunkIds: readonly string[]): Promise<{ sessionId: string; step: number; chunkIds: string[] }[]> {
  const ids = [...new Set(chunkIds.filter(isUuid))].slice(0, 300);
  if (!ids.length) return [];
  const { data, error } = await admin.from("individual_scholar_learning_step").select("session_id").eq("user_id", userId).in("chunk_id", ids).limit(2000);
  if (error || !data?.length) return [];
  const sessions = [...new Set((data as any[]).map(r => r.session_id as string))].slice(0, 200);
  const { data: all, error: aErr } = await admin.from("individual_scholar_learning_step").select("session_id, step, chunk_id").eq("user_id", userId).in("session_id", sessions).limit(10000);
  if (aErr) return [];
  const by = new Map<string, { sessionId: string; step: number; chunkIds: string[] }>();
  for (const r of (all ?? []) as any[]) {
    const k = `${r.session_id}:${r.step}`;
    const l: { sessionId: string; step: number; chunkIds: string[] } = by.get(k) ?? { sessionId: r.session_id, step: r.step, chunkIds: [] };
    l.chunkIds.push(r.chunk_id); by.set(k, l);
  }
  return [...by.values()];
}

/**
 * SCHOLAR-INDEPENDENT-LEARNING-01 P2: the sections the caller has LEARNED on -- any learning event except a skip (a lesson
 * opened, read (920), taught, checked) names them as a source (414 learning_event_source). Reads only, no AI. Empty where
 * unreadable (then only answered questions say a section was started).
 */
export async function learnedChunkIds(admin: Admin, userId: string, chunkIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(chunkIds.filter(isUuid))].slice(0, 2000);
  const out = new Set<string>();
  if (!ids.length) return out;
  const byEvent = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin.from("individual_scholar_learning_event_source").select("event_id, chunk_id").eq("user_id", userId).in("chunk_id", ids.slice(i, i + 200)).limit(10000);
    if (error) return out;
    for (const r of (data ?? []) as any[]) { const l = byEvent.get(r.event_id) ?? []; l.push(r.chunk_id); byEvent.set(r.event_id, l); }
  }
  const eventIds = [...byEvent.keys()];
  for (let i = 0; i < eventIds.length; i += 300) {
    const { data, error } = await admin.from("individual_scholar_learning_event").select("id, action").eq("user_id", userId).in("id", eventIds.slice(i, i + 300)).neq("action", "skip").limit(300);
    if (error) return out;
    for (const r of (data ?? []) as any[]) for (const c of byEvent.get(r.id) ?? []) out.add(c);
  }
  return out;
}

/** Some of the caller's sessions by id (a foreign id simply is not found). */
export async function sessionsByIds(admin: Admin, userId: string, ids: readonly string[]): Promise<LearningSessionRow[]> {
  const keep = [...new Set(ids.filter(isUuid))].slice(0, 200);
  if (!keep.length) return [];
  const { data, error } = await admin.from("individual_scholar_learning_session").select(SESSION_COLS).eq("user_id", userId).in("id", keep).limit(keep.length);
  return error ? [] : ((data ?? []) as any[]).map(toSession);
}

/** One page of the caller's sessions of one status, most recently active first (or oldest), after `cursor`. */
export async function librarySessionPage(admin: Admin, userId: string, o: { status: "active" | "completed"; sort: "newest" | "oldest"; cursor: Cursor | null; limit: number; fromIso?: string | null; toIso?: string | null }): Promise<Read<{ rows: LearningSessionRow[]; next: Cursor | null }>> {
  let q = admin.from("individual_scholar_learning_session").select(SESSION_COLS).eq("user_id", userId).eq("status", o.status);
  if (o.fromIso) q = q.gte("last_active_at", o.fromIso);
  if (o.toIso) q = q.lt("last_active_at", o.toIso);
  if (o.cursor) q = q.or(keysetFilter(o.cursor, o.sort, "last_active_at"));
  const asc = o.sort === "oldest";
  const { data, error } = await q.order("last_active_at", { ascending: asc }).order("id", { ascending: asc }).limit(o.limit + 1);
  if (error) return fail(error);
  const page = pageOf((data ?? []) as any[], o.limit, r => r.last_active_at);
  return { ok: true, data: { rows: page.items.map(toSession), next: page.next } };
}

/** The furthest lesson reached in each of these sessions (790), where a position is kept. Empty where 790 is absent. */
export async function sessionFurthest(admin: Admin, userId: string, sessionIds: readonly string[]): Promise<Map<string, number>> {
  const keep = sessionIds.filter(isUuid).slice(0, 200);
  if (!keep.length || position790 === false) return new Map();
  const { data, error } = await admin.from("individual_scholar_learning_position").select("session_id, furthest_step").eq("user_id", userId).in("session_id", keep).limit(keep.length);
  if (error) { if (isNotProvisioned(error)) position790 = false; return new Map(); }
  return new Map(((data ?? []) as any[]).map(r => [r.session_id as string, Number(r.furthest_step)]));
}

/** Per section: the caller's flashcards, other practice questions, and attempts on questions from it. */
export async function practiceCounts(admin: Admin, userId: string, chunkIds: readonly string[]): Promise<Map<string, { cards: number; questions: number; attempts: number }>> {
  const ids = [...new Set(chunkIds.filter(isUuid))].slice(0, 400);
  const out = new Map<string, { cards: number; questions: number; attempts: number }>();
  if (!ids.length) return out;
  const { data: qs, error } = await admin.from("individual_scholar_question").select("id, chunk_id, kind").eq("user_id", userId).in("chunk_id", ids).limit(5000);
  if (error) return out;
  const chunkOf = new Map<string, string>();
  for (const q of (qs ?? []) as any[]) {
    const c = out.get(q.chunk_id) ?? { cards: 0, questions: 0, attempts: 0 };
    if (q.kind === "flashcard") c.cards++; else c.questions++;
    out.set(q.chunk_id, c); chunkOf.set(q.id, q.chunk_id);
  }
  const qids = [...chunkOf.keys()];
  for (let i = 0; i < qids.length; i += 300) {
    const { data: at } = await admin.from("individual_scholar_attempt").select("question_id").eq("user_id", userId).in("question_id", qids.slice(i, i + 300)).limit(10000);
    for (const a of (at ?? []) as any[]) { const c = chunkOf.get(a.question_id); if (c) out.get(c)!.attempts++; }
  }
  return out;
}

// ── SCHOLAR-INDEPENDENT-LEARNING-01 P1: WHAT ALREADY EXISTS FOR A LESSON'S SECTIONS (reads only, no AI) ──────────────────
/** One existing resource the reader opens directly: a private case or an OSCE station written from these sections. */
export type LessonResource = { id: string; title: string };
export type LessonRelated = {
  cards: number; questions: number; attempts: number;
  /** The caller's own private cases written from any of these sections (435 case_source), newest first, at most 5. */
  cases: LessonResource[];
  /** The caller's own OSCE stations written from one of these sections (720 chunk_id), newest first, at most 5. [] where 720 is absent. */
  stations: LessonResource[];
  /** Saved explanations (current, not superseded) built on these sections, any action. */
  savedLessons: number;
};
/** The caller's existing resources for some sections: counts and the openable cases and stations. Never generates anything. */
export async function lessonRelated(admin: Admin, userId: string, chunkIds: readonly string[]): Promise<LessonRelated> {
  const ids = [...new Set(chunkIds.filter(isUuid))].slice(0, 400);
  const none: LessonRelated = { cards: 0, questions: 0, attempts: 0, cases: [], stations: [], savedLessons: 0 };
  if (!ids.length) return none;
  const soft = async (p: PromiseLike<{ data?: unknown; error?: unknown }>): Promise<any[]> => { try { const r = await p; return r && !r.error && Array.isArray(r.data) ? r.data : []; } catch { return []; } };
  const [counts, caseSrc, stationRows, artefactIds] = await Promise.all([
    practiceCounts(admin, userId, ids),
    soft(admin.from("individual_scholar_case_source").select("case_id").eq("user_id", userId).in("chunk_id", ids).limit(500)),
    soft(admin.from("individual_scholar_osce_station").select("id, title, created_at").eq("user_id", userId).in("chunk_id", ids).order("created_at", { ascending: false }).limit(5)),
    artefactIdsForChunks(admin, userId, ids, 500),
  ]);
  const caseIds = [...new Set(caseSrc.map(r => String(r.case_id)))].slice(0, 50);
  const caseRows = caseIds.length ? await soft(admin.from("individual_scholar_case").select("id, title, created_at").eq("user_id", userId).in("id", caseIds).order("created_at", { ascending: false }).limit(5)) : [];
  let savedLessons = 0;
  if (artefactIds?.length) {
    const q = admin.from("individual_scholar_artefact").select("id", { count: "exact", head: true }).eq("user_id", userId).in("id", artefactIds.slice(0, 300));
    const r = await (await librarySchema(admin, userId) ? q.is("superseded_at", null) : q);
    savedLessons = r.error ? 0 : r.count ?? 0;
  }
  let cards = 0, questions = 0, attempts = 0;
  for (const c of counts.values()) { cards += c.cards; questions += c.questions; attempts += c.attempts; }
  return { cards, questions, attempts, cases: caseRows.map(r => ({ id: String(r.id), title: String(r.title ?? "Your case") })), stations: stationRows.map(r => ({ id: String(r.id), title: String(r.title ?? "Your station") })), savedLessons };
}

/** The caller's materials with a finished OSCE attempt on a station built from them (720). Empty where 720 is absent. */
export async function osceAttemptMaterials(admin: Admin, userId: string): Promise<Set<string>> {
  const { data: at, error } = await admin.from("individual_scholar_osce_attempt").select("station_id").eq("user_id", userId).not("finished_at", "is", null).limit(1000);
  if (error || !at?.length) return new Set();
  const { data: st } = await admin.from("individual_scholar_osce_station").select("material_id").eq("user_id", userId).in("id", [...new Set((at as any[]).map(r => r.station_id))].slice(0, 300)).limit(300);
  return new Set(((st ?? []) as any[]).map(r => r.material_id).filter(isUuid));
}

// ── LEARNER NOTES, BOOKMARKS AND HIGHLIGHTS (820) ──

export type NoteRow = {
  id: string; targetKind: NoteTarget["targetKind"]; kind: NoteKind; artefactId: string | null; materialId: string | null; chunkId: string | null;
  sessionId: string | null; step: number | null; body: string | null; quote: string | null; createdAt: string; updatedAt: string;
};
const NOTE_COLS = "id, target_kind, kind, artefact_id, material_id, chunk_id, session_id, step, body, quote, created_at, updated_at";
const toNote = (r: any): NoteRow => ({
  id: r.id, targetKind: r.target_kind, kind: r.kind, artefactId: r.artefact_id ?? null, materialId: r.material_id ?? null, chunkId: r.chunk_id ?? null,
  sessionId: r.session_id ?? null, step: Number.isInteger(r.step) ? r.step : null, body: r.body ?? null, quote: r.quote ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
});
/** At most this many notes, bookmarks and highlights per learner. */
export const NOTE_MAX_PER_LEARNER = 5000;

/** The caller's notes on some artefacts, lessons (session ids) or materials, or their bookmarks, newest first. */
export async function listNotes(admin: Admin, userId: string, o: {
  artefactIds?: readonly string[]; sessionIds?: readonly string[]; materialIds?: readonly string[]; kinds?: readonly NoteKind[];
  cursor?: Cursor | null; limit?: number;
}): Promise<Read<{ rows: NoteRow[]; next: Cursor | null }>> {
  if (!(await librarySchema(admin, userId))) return { ok: false, notProvisioned: true };
  let q = admin.from("individual_scholar_note").select(NOTE_COLS).eq("user_id", userId);
  const ors = [
    ...(o.artefactIds?.length ? [`artefact_id.in.(${o.artefactIds.filter(isUuid).slice(0, 300).join(",")})`] : []),
    ...(o.sessionIds?.length ? [`session_id.in.(${o.sessionIds.filter(isUuid).slice(0, 200).join(",")})`] : []),
    ...(o.materialIds?.length ? [`material_id.in.(${o.materialIds.filter(isUuid).slice(0, 200).join(",")})`] : []),
  ].filter(f => !f.includes("in.()"));
  if (o.artefactIds || o.sessionIds || o.materialIds) { if (!ors.length) return { ok: true, data: { rows: [], next: null } }; q = q.or(ors.join(",")); }
  if (o.kinds?.length) q = q.in("kind", [...o.kinds]);
  const limit = Math.min(Math.max(o.limit ?? 500, 1), 1000);
  const { data, error } = await (o.cursor ? q.lt("created_at", o.cursor.at) : q).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
  if (error) return fail(error);
  const page = pageOf((data ?? []) as any[], limit, r => r.created_at);
  return { ok: true, data: { rows: page.items.map(toNote), next: page.next } };
}

/**
 * Add one of the caller's notes. Every target is the caller's own: the composite foreign keys refuse anything else
 * (not_found), and a section's chunk is checked here (820 keeps chunk_id as a hint, without a foreign key). A second
 * bookmark on the same target returns the first (existing). The text was screened by the route.
 */
export async function addNote(admin: Admin, userId: string, n: NoteInput): Promise<{ ok: true; id: string; existing: boolean } | { ok: false; error: "not_provisioned" | "not_found" | "limit" | "failed" }> {
  if (!(await librarySchema(admin, userId))) return { ok: false, error: "not_provisioned" };
  const chunkId = "chunkId" in n ? n.chunkId ?? null : null, materialId = "materialId" in n ? n.materialId ?? null : null;
  if (chunkId) {
    const { data, error } = await admin.from("individual_scholar_chunk").select("id").eq("user_id", userId).eq("id", chunkId).eq("material_id", materialId ?? "").maybeSingle();
    if (error) return { ok: false, error: "failed" };
    if (!data) return { ok: false, error: "not_found" };
  }
  const { count, error: cErr } = await admin.from("individual_scholar_note").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (cErr) return { ok: false, error: "failed" };
  if ((count ?? 0) >= NOTE_MAX_PER_LEARNER) return { ok: false, error: "limit" };
  const row = {
    user_id: userId, target_kind: n.targetKind, kind: n.kind, body: n.body, quote: n.quote,
    artefact_id: n.targetKind === "artefact" ? n.artefactId : null, material_id: materialId, chunk_id: chunkId,
    session_id: "sessionId" in n ? n.sessionId ?? null : null, step: "step" in n && Number.isInteger(n.step) ? n.step : null,
  };
  const { data, error } = await admin.from("individual_scholar_note").insert({ ...row, user_id: userId }).select("id").single();
  if (!error) return { ok: true, id: data.id, existing: false };
  const code = String(error.code ?? "");
  if (code === "23505" && n.kind === "bookmark") {
    let q = admin.from("individual_scholar_note").select("id").eq("user_id", userId).eq("kind", "bookmark").eq("target_kind", n.targetKind);
    for (const [col, v] of [["artefact_id", row.artefact_id], ["material_id", row.material_id], ["chunk_id", row.chunk_id], ["session_id", row.session_id], ["step", row.step]] as const)
      q = v === null ? q.is(col, null) : q.eq(col, v);
    const { data: had } = await q.maybeSingle();
    return had ? { ok: true, id: had.id, existing: true } : { ok: false, error: "failed" };
  }
  if (isNotProvisioned(error)) { library820 = false; return { ok: false, error: "not_provisioned" }; }
  return { ok: false, error: code === "23503" ? "not_found" : "failed" };
}

/**
 * Change the text of one of the caller's notes or highlights (a bookmark has none). COMPETEN-NOTEBOOK-001: with `updatedAt` (the copy the form was
 * opened from), a note changed since, in My Notebook or elsewhere, is left alone and answers "conflict", so its newer words are never overwritten.
 */
export async function updateNote(admin: Admin, userId: string, id: string, patch: { body: string | null; updatedAt?: string | null }): Promise<"ok" | "not_found" | "invalid" | "failed" | "conflict" | { updatedAt: string }> {
  if (!isUuid(id) || !(await librarySchema(admin, userId))) return "not_found";
  let q = admin.from("individual_scholar_note").update({ body: patch.body }).eq("user_id", userId).eq("id", id).neq("kind", "bookmark");
  if (patch.updatedAt) q = q.eq("updated_at", patch.updatedAt);
  const { data, error } = await q.select("id, updated_at");
  if (error) return String(error.code ?? "") === "23514" ? "invalid" : "failed";
  if ((data ?? []).length) return { updatedAt: data[0].updated_at };
  if (!patch.updatedAt) return "not_found";
  const { data: had } = await admin.from("individual_scholar_note").select("id").eq("user_id", userId).eq("id", id).neq("kind", "bookmark").maybeSingle();
  return had ? "conflict" : "not_found";
}

/** Remove one of the caller's notes, bookmarks or highlights. Only theirs: another id simply is not found. */
export async function deleteNote(admin: Admin, userId: string, id: string): Promise<"ok" | "not_found" | "failed"> {
  if (!isUuid(id) || !(await librarySchema(admin, userId))) return "not_found";
  const { data, error } = await admin.from("individual_scholar_note").delete().eq("user_id", userId).eq("id", id).select("id");
  if (error) return "failed";
  return (data ?? []).length ? "ok" : "not_found";
}

// ── SEARCH (820) ──

export type LibraryHit = {
  kind: "artefact" | "note" | "lesson" | "flashcard" | "card_note"; id: string; materialId: string | null; sessionId: string | null; step: number | null;
  artefactId: string | null; chunkId: string | null; label: string; headline: string; rank: number; createdAt: string;
};
/** One page of the caller's own deterministic full-text search, and the exact total. notProvisioned where 820 is absent. */
export async function librarySearch(admin: Admin, userId: string, query: string, limit: number, offset: number): Promise<Read<{ rows: LibraryHit[]; total: number }>> {
  if (!(await librarySchema(admin, userId))) return { ok: false, notProvisioned: true };
  const { data, error } = await admin.rpc("individual_scholar_library_search", { p_user_id: userId, p_query: query.slice(0, 200), p_limit: limit, p_offset: offset });
  if (error) { if (isMissingRpc(error)) library820 = false; return fail(error); }
  const rows = ((data ?? []) as any[]).map(r => ({
    kind: r.kind, id: r.id, materialId: r.material_id ?? null, sessionId: r.session_id ?? null, step: Number.isInteger(r.step) ? r.step : null,
    artefactId: r.artefact_id ?? null, chunkId: r.chunk_id ?? null, label: String(r.label ?? ""), headline: String(r.headline ?? ""), rank: Number(r.rank ?? 0), createdAt: r.created_at,
  })) as LibraryHit[];
  return { ok: true, data: { rows, total: Number((data ?? [])[0]?.total ?? 0) } };
}

/** SCHOLAR-ASK-SOURCES-01: a saved teaching or a note of the caller's own that a search found, with its text. Current versions only. */
export type SavedLearningRow = { id: string; kind: "artefact" | "note"; materialId: string | null; createdAt: string; content: string };
export async function savedLearningRows(admin: Admin, userId: string, query: string, limit: number): Promise<Read<SavedLearningRow[]>> {
  const hits = await librarySearch(admin, userId, query, limit * 4, 0);
  if (!hits.ok) return hits;
  const artefactIds = hits.data.rows.filter(h => h.kind === "artefact").map(h => h.artefactId ?? h.id);
  const noteIds = hits.data.rows.filter(h => h.kind === "note").map(h => h.id);
  const artefacts = await artefactsByIds(admin, userId, artefactIds, { currentOnly: true });
  if (!artefacts.ok) return artefacts;
  // COMPETEN-NOTEBOOK-001 (owner, 6 Nov 2026): a note written through the Notebook (1000, client_key set) never reaches a model by this path.
  // Choosing "My saved learning" for a question is not the learner sending that note. A note goes to AI only when they put it in the question themselves.
  // Asked first, so the column is never named while 1000 is absent. A transient error is treated as applied: the filter stays on, and nothing extra is sent.
  const notebook = noteIds.length ? await admin.rpc("individual_scholar_notebook_1000") : null;
  const notebookAbsent = !!notebook?.error && isMissingRpc(notebook.error);
  const notes = noteIds.length
    ? await (notebookAbsent
      ? admin.from("individual_scholar_note").select("id, material_id, body, created_at").eq("user_id", userId).in("id", noteIds)
      : admin.from("individual_scholar_note").select("id, material_id, body, created_at").eq("user_id", userId).in("id", noteIds).is("client_key", null))
    : { data: [], error: null };
  if (notes.error) return fail(notes.error);
  const byArtefact = new Map(artefacts.data.map(a => [a.id, a]));
  const byNote = new Map(((notes.data ?? []) as { id: string; material_id: string | null; body: string | null; created_at: string }[]).map(n => [n.id, n]));
  const out: SavedLearningRow[] = [];
  for (const h of hits.data.rows) {
    if (h.kind === "artefact") {
      const a = byArtefact.get(h.artefactId ?? h.id);
      if (a && !out.some(o => o.id === a.id)) out.push({ id: a.id, kind: "artefact", materialId: a.materialId, createdAt: a.createdAt, content: a.content });
    } else if (h.kind === "note") {
      const n = byNote.get(h.id);
      if (n?.body) out.push({ id: n.id, kind: "note", materialId: n.material_id, createdAt: n.created_at, content: n.body });
    }
  }
  return { ok: true, data: out.slice(0, limit) };
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
async function competencyProgressRowsRead(admin: Admin, userId: string): Promise<Read<{
  mappings: MappingRow[]; questions: { id: string; chunkId: string; competencyId: string | null }[]; attempts: ProgressAttempt[];
  /** P6: the topics found in each section (chunk id → concepts), for practice by topic. */
  concepts: Map<string, string[]>;
}>> {
  // MY PLAN PERF: the questions and attempts do not depend on the mappings, so all three are read together.
  const [maps, q, a] = await Promise.all([
    listMappings(admin, userId),
    admin.from("individual_scholar_question").select("id, chunk_id, competency_id").eq("user_id", userId).limit(5000),
    admin.from("individual_scholar_attempt").select("question_id, correct, answered_at").eq("user_id", userId).order("answered_at", { ascending: false }).limit(10000),
  ]);
  if (!maps.ok) return maps;
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

// ── MASTERY: THE EVIDENCE ROWS (SCHOLAR-COMPANION-01 P1) ─────────────────────────────────────────────

/** A jsonb array of strings read through a select path (the client returns it parsed): the strings, at most 8, else []. */
const jsonStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, 8).map(x => x.trim().slice(0, 300)) : []);

/**
 * SALE-2026-11 R1 (SALE-04): EXPOSURE. The caller's learning actions in the window (newest `maxRows`), each with the sections it used
 * (414 event_source) and those sections' materials. Actions and sections only: no text. A store without 414 reads as none.
 */
export async function learningExposure(admin: Admin, userId: string, o: { sinceIso: string; maxRows: number }): Promise<Read<{ action: string; at: string; chunkId: string; materialId: string }[]>> {
  const { data: evs, error } = await admin.from("individual_scholar_learning_event").select("id, action, created_at").eq("user_id", userId)
    .gte("created_at", o.sinceIso).order("created_at", { ascending: false }).limit(o.maxRows);
  if (error) return isNotProvisioned(error) ? { ok: true, data: [] } : fail(error);
  const byId = new Map(((evs ?? []) as any[]).map(e => [String(e.id), { action: String(e.action), at: String(e.created_at) }]));
  const ids = [...byId.keys()];
  const links: { eventId: string; chunkId: string }[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error: sErr } = await admin.from("individual_scholar_learning_event_source").select("event_id, chunk_id").eq("user_id", userId).in("event_id", ids.slice(i, i + 150));
    if (sErr) return fail(sErr);
    for (const r of (data ?? []) as any[]) links.push({ eventId: String(r.event_id), chunkId: String(r.chunk_id) });
  }
  const chunkIds = [...new Set(links.map(l => l.chunkId))];
  const mat = new Map<string, string>();
  for (let i = 0; i < chunkIds.length; i += 150) {
    const { data, error: cErr } = await admin.from("individual_scholar_chunk").select("id, material_id").eq("user_id", userId).in("id", chunkIds.slice(i, i + 150));
    if (cErr) return fail(cErr);
    for (const r of (data ?? []) as any[]) mat.set(String(r.id), String(r.material_id));
  }
  return { ok: true, data: links.flatMap(l => { const e = byId.get(l.eventId), m = mat.get(l.chunkId); return e && m ? [{ action: e.action, at: e.at, chunkId: l.chunkId, materialId: m }] : []; }) };
}

/** Raw rows for src/lib/individual/scholar/mastery-data.ts. Bounded: the newest `maxRows` of each source within `sinceIso`. */
export type MasteryRaw = {
  questions: { id: string; chunkId: string; materialId: string; kind: string; difficulty: number | null; competencyId: string | null; level: string | null; topic: string | null;
    /** SALE-2026-11 R1: the rubric's misconception tags, and whether it is a lesson check (950 answer.check.source = lesson). */
    misconceptions?: string[]; check?: boolean }[];
  attempts: { questionId: string; correct: boolean | null; score: number | null; marking: "deterministic" | "ai_evaluation" | "self_graded" | "unmarked"; answeredAt: string;
    /** SALE-2026-11 R1: the attempt id, the learner's stated confidence and the misconceptions its judgement named (lesson checks), where present. */
    id?: string; confidence?: string | null; misconceptions?: string[] }[];
  reviews: { cardId: string; quality: number; reviewedAt: string }[];
  cards: { id: string; questionId: string; materialId: string; status: string; nextReviewAt: string }[];
  osce: { stationId: string; score: number; marking: "self_graded" | "ai_evaluation"; at: string }[];
  stations: { id: string; competencyId: string | null; materialId: string | null; chunkId: string | null }[];
  /** A source hit `maxRows`: older rows exist that were not read. */
  truncated: boolean;
};

/**
 * One bounded read of the caller's learning evidence: attempts and spaced reviews in the window (newest `maxRows` each),
 * the cards (to place a review and to know what is due), finished OSCE practice runs with a score, and the questions
 * (id, section, material, level, topic only -- never the key or the stem). A source whose migration is absent reads as
 * none; a source that fails to read fails the whole read (unreadable is not empty).
 */
async function masteryEvidenceRead(admin: Admin, userId: string, o: { sinceIso: string; maxRows: number }): Promise<Read<MasteryRaw>> {
  const soft = async (q: PromiseLike<{ data: unknown; error: any }>) => { const r = await q; return r.error && isNotProvisioned(r.error) ? { data: [], error: null } : r; };
  const base = "id, chunk_id, material_id, kind";
  // 416/388/710 columns may be absent: fall back to the 372 columns, as the other readers here do.
  const readQuestions = async () => {
    let q: { data: any; error: any } = await admin.from("individual_scholar_question")
      .select(`${base}, difficulty, competency_id, rubric_level:answer->rubric->>level, rubric_topic:answer->rubric->>topic, rubric_misconceptions:answer->rubric->misconceptions, check_source:answer->check->>source`).eq("user_id", userId).limit(5000);
    if (q.error) q = await admin.from("individual_scholar_question")
      .select(`${base}, difficulty, competency_id, rubric_level:answer->rubric->>level, rubric_topic:answer->rubric->>topic`).eq("user_id", userId).limit(5000);
    if (q.error) q = await admin.from("individual_scholar_question").select(`${base}, difficulty, competency_id`).eq("user_id", userId).limit(5000);
    if (q.error) q = await admin.from("individual_scholar_question").select(base).eq("user_id", userId).limit(5000);
    return q;
  };
  const readAttempts = async () => {
    let a: { data: any; error: any } = await admin.from("individual_scholar_attempt").select("id, question_id, correct, score, marking, answered_at, stated_confidence:response->>confidence, fb_misconceptions:response->feedback->misconceptions")
      .eq("user_id", userId).gte("answered_at", o.sinceIso).order("answered_at", { ascending: false }).limit(o.maxRows);
    if (a.error) a = await admin.from("individual_scholar_attempt").select("question_id, correct, score, marking, answered_at")
      .eq("user_id", userId).gte("answered_at", o.sinceIso).order("answered_at", { ascending: false }).limit(o.maxRows);
    if (a.error) a =await admin.from("individual_scholar_attempt").select("question_id, correct, answered_at")
      .eq("user_id", userId).gte("answered_at", o.sinceIso).order("answered_at", { ascending: false }).limit(o.maxRows);
    return a;
  };
  // MY PLAN PERF: the six sources are independent, so they are read together (the question and attempt fallbacks stay sequential inside their own read).
  const [q, a, rv, cards, osce, stations] = await Promise.all([
    readQuestions(), readAttempts(),
    soft(admin.from("individual_scholar_review").select("card_id, quality, reviewed_at").eq("user_id", userId).gte("reviewed_at", o.sinceIso).order("reviewed_at", { ascending: false }).limit(o.maxRows)),
    admin.from("individual_scholar_card").select("id, question_id, material_id, status, next_review_at").eq("user_id", userId).limit(5000),
    soft(admin.from("individual_scholar_osce_attempt").select("station_id, score, marking, finished_at").eq("user_id", userId).eq("status", "finished")
      .not("score", "is", null).gte("finished_at", o.sinceIso).order("finished_at", { ascending: false }).limit(Math.min(o.maxRows, 200))),
    soft(admin.from("individual_scholar_osce_station").select("id, competency_id, material_id, chunk_id").eq("user_id", userId).limit(500)),
  ]);
  const err = [q, a, rv, cards, osce, stations].find(r => r.error)?.error;
  if (err) return fail(err);
  return {
    ok: true,
    data: {
      questions: ((q.data ?? []) as any[]).map(r => ({
        id: r.id, chunkId: r.chunk_id, materialId: r.material_id, kind: r.kind, difficulty: r.difficulty ?? null, competencyId: r.competency_id ?? null,
        level: typeof r.rubric_level === "string" ? r.rubric_level : null, topic: typeof r.rubric_topic === "string" && r.rubric_topic.trim() ? r.rubric_topic.trim() : null,
        misconceptions: jsonStrings(r.rubric_misconceptions), check: r.check_source === "lesson",
      })),
      attempts: ((a.data ?? []) as any[]).map(r => ({
        questionId: r.question_id, correct: r.correct ?? null, score: r.score === null || r.score === undefined ? null : Number(r.score),
        marking: r.marking ?? "deterministic", answeredAt: r.answered_at,
        ...(r.id ? { id: String(r.id) } : {}), confidence: typeof r.stated_confidence === "string" ? r.stated_confidence : null, misconceptions: jsonStrings(r.fb_misconceptions),
      })),
      reviews: ((rv.data ?? []) as any[]).map(r => ({ cardId: r.card_id, quality: r.quality, reviewedAt: r.reviewed_at })),
      cards: ((cards.data ?? []) as any[]).map(r => ({ id: r.id, questionId: r.question_id, materialId: r.material_id, status: r.status, nextReviewAt: r.next_review_at })),
      osce: ((osce.data ?? []) as any[]).map(r => ({ stationId: r.station_id, score: Number(r.score), marking: r.marking === "ai_evaluation" ? "ai_evaluation" : "self_graded", at: r.finished_at })),
      stations: ((stations.data ?? []) as any[]).map(r => ({ id: r.id, competencyId: r.competency_id ?? null, materialId: r.material_id ?? null, chunkId: r.chunk_id ?? null })),
      truncated: ((a.data ?? []) as any[]).length >= o.maxRows || ((rv.data ?? []) as any[]).length >= o.maxRows,
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
  const questionKinds = STUDY_ACHIEVEMENT[achievement].questionKinds;
  if (questionKinds.length === 0) {
    const { count, error } = await admin.from("individual_scholar_review").select("id", { count: "exact" })
      .eq("user_id", userId).eq("material_id", materialId).limit(1);
    return error ? null : (count ?? 0);
  }
  const { data: qs, error } = await admin.from("individual_scholar_question").select("id, kind")
    .eq("user_id", userId).eq("material_id", materialId).in("kind", [...questionKinds]).limit(5000);
  if (error) return null;
  const kindOf = new Map(((qs ?? []) as any[]).map(q => [q.id as string, q.kind as string]));
  const ids = [...kindOf.keys()];
  if (!ids.length) return 0;
  const { data: at, error: aErr } = await admin.from("individual_scholar_attempt").select("question_id, marking")
    .eq("user_id", userId).in("question_id", ids).limit(10000);
  if (aErr) return null;
  return new Set(((at ?? []) as any[]).filter(a => countsForAchievement(kindOf.get(a.question_id) ?? "", a.marking)).map(a => a.question_id)).size;
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
  let attempts: { questionId: string; answeredAt: string; marking?: string }[] = [];
  if (ids.length) {
    const { data: at, error: aErr } = await admin.from("individual_scholar_attempt").select("question_id, answered_at, marking")
      .eq("user_id", userId).in("question_id", ids).limit(10000);
    if (aErr) return fail(aErr);
    attempts = ((at ?? []) as any[]).map(a => ({ questionId: a.question_id, answeredAt: a.answered_at, marking: a.marking ?? undefined }));
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
    // LE-03 (955): a clarify outcome detached by a re-cut names a lesson that no longer exists, so it is left out here.
    soft((await learningRecutSchema(admin, userId)) ? admin.from("individual_scholar_learning_event").select("id, session_id, step, verdict, created_at").eq("user_id", userId).eq("action", "clarify").not("verdict", "is", null).is("detached_at", null).limit(5000)
      : admin.from("individual_scholar_learning_event").select("id, session_id, step, verdict, created_at").eq("user_id", userId).eq("action", "clarify").not("verdict", "is", null).limit(5000)),
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

/** SCHOLAR-COMPANION-01 P1: the newest past-paper question stems of ALL the caller's papers (capped), for High-yield's term-overlap count. */
export async function listExamQuestionStems(admin: Admin, userId: string, limit: number): Promise<Read<{ materialId: string; stem: string }[]>> {
  const { data, error } = await admin.from("individual_scholar_exam_question").select("material_id, stem").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(r => ({ materialId: r.material_id, stem: r.stem })) };
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

// SCHOLAR-RESEARCH-TEACH-001: one shared row per subject topic. A row with the building provider says a search is under way.

/** The topic's row if it has not expired, with its provider, so a claim is told from a result. */
export async function readResearchTopic(admin: Admin, key: string, nowIso: string): Promise<{ provider: string; sources: unknown[] } | null> {
  const { data } = await admin.from("individual_scholar_research_cache").select("provider, sources, expires_at").eq("query_hash", key).maybeSingle();
  if (!data || (data as any).expires_at <= nowIso) return null;
  return { provider: (data as any).provider, sources: Array.isArray((data as any).sources) ? (data as any).sources : [] };
}

/**
 * Atomic. True for exactly one caller: the row is new, or the one there has expired. The insert ignores a conflict and an expired
 * row is taken over by a conditional update, so two learners cannot both search. Nothing is deleted. Unreadable: false (no search).
 */
export async function claimResearchTopic(admin: Admin, key: string, row: { provider: string; policyVersion: string; ms: number; nowIso: string }): Promise<boolean> {
  const fields = { provider: row.provider, policy_version: row.policyVersion, sources: [], searches: 0, created_at: row.nowIso, expires_at: new Date(new Date(row.nowIso).getTime() + row.ms).toISOString() };
  const inserted = await admin.from("individual_scholar_research_cache").upsert({ query_hash: key, ...fields }, { onConflict: "query_hash", ignoreDuplicates: true }).select("query_hash");
  if (inserted.error) return false;
  if ((inserted.data ?? []).length) return true;
  const taken = await admin.from("individual_scholar_research_cache").update(fields).eq("query_hash", key).lte("expires_at", row.nowIso).select("query_hash");
  return !taken.error && (taken.data ?? []).length > 0;
}

/** A failed search frees its topic at once, by expiring its own claim. A result already written is left alone. */
export async function releaseResearchTopic(admin: Admin, key: string, provider: string, nowIso: string): Promise<void> {
  await admin.from("individual_scholar_research_cache").update({ created_at: nowIso, expires_at: new Date(new Date(nowIso).getTime() + 1000).toISOString() }).eq("query_hash", key).eq("provider", provider).then((r: unknown) => r, () => {});
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
  const { data, error } = await admin.from("plat_ai_requests").select("cost_usd").eq("actor_id", userId).in("operation", [operation, `${operation}_verify`]).gte("created_at", since).limit(1000);
  if (error) return null;
  return ((data ?? []) as { cost_usd: number | string | null }[]).reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
}

/** The stored original and the extractor of one material (exam-paper transcription reads both). Own rows only. */
export async function materialOriginal(admin: Admin, userId: string, id: string): Promise<{ path: string; extractor: string } | null> {
  const { data } = await admin.from("individual_scholar_material").select("storage_path, extractor").eq("user_id", userId).eq("id", id).maybeSingle();
  return data ? { path: (data as any).storage_path, extractor: (data as any).extractor ?? "" } : null;
}

// ── SCHOLAR-UPLOAD-FIX: SECTIONS READ BY AI FROM PICTURE-ONLY SLIDES ─────────────────────────────────────────────────

/** The stored original file of the caller's OWN material (its path from their own row), or null. */
export async function materialBytes(admin: Admin, userId: string, id: string): Promise<Uint8Array | null> {
  const original = await materialOriginal(admin, userId, id);
  return original?.path ? readUpload(admin, original.path) : null;
}

/**
 * Add the sections an AI reading produced, each on its slide, in slide order among the existing ones, and record the
 * reading on the material: the slides read leave empty_units and join ai_read_units, every slide attempted joins
 * ai_tried_units, and chunk_count, char_count, extraction_quality's chars and sections and the extractor follow.
 *
 * ⚠ EXISTING IDS NEVER CHANGE (questions, cards, mappings and learning history point at them). Where later sections
 * must make room, only their ordinal is raised, last first, so the unique (material_id, ordinal) index never sees two
 * rows on one ordinal (planChunkInsertion). Interrupted part-way, the order is still right, with gaps.
 * ⚠ RE-CHECKED HERE: a slide no longer recorded as empty, or already attempted (a second request running alongside),
 * is dropped before anything is written.
 */
export async function addPictureSlideSections(admin: Admin, userId: string, materialId: string, input: {
  additions: NewChunk[]; read: readonly number[]; tried: readonly number[]; extractorTag: string;
  /** SCHOLAR-PPTX-READING-01: why a slide was not kept, so the learner can be told. */
  skipped?: readonly { unit: number; reason: SlideSkipReason }[];
  /** SCHOLAR-IMAGE-RECOVERY: the model, prompt version and time of this reading, kept on the material (ai_provenance). */
  provenance?: { model: string; promptVersion: string; extractedAt: string } | null;
}): Promise<{ ok: true; added: number; recorded: boolean } | { ok: false; error: string }> {
  const { data: row, error: rErr } = await admin.from("individual_scholar_material").select("extraction_quality, chunk_count, char_count, extractor")
    .eq("user_id", userId).eq("id", materialId).maybeSingle();
  if (rErr || !row) return { ok: false, error: "material" };
  const q = fromQualityJson(row.extraction_quality);
  if (!q || (q.unit !== "slide" && q.unit !== "page")) return { ok: false, error: "quality" };
  const { data: rows, error: cErr } = await admin.from("individual_scholar_chunk").select("id, ordinal, page_from")
    .eq("user_id", userId).eq("material_id", materialId).order("ordinal").limit(2000);
  if (cErr) return { ok: false, error: "chunks" };
  const existing = ((rows ?? []) as any[]).map(r => ({ id: r.id as string, ordinal: Number(r.ordinal), pageFrom: r.page_from as number | null }));
  const haveSection = new Set(existing.map(c => c.pageFrom));
  // SCHOLAR-PPTX-READING-01: a slide with text and a picture has a section already; its picture may still be read, once.
  const reading = pictureReadingInput(q);
  const open = new Set([...reading.emptyUnits.filter(n => !haveSection.has(n)), ...reading.mixedUnits].filter(n => !(q.aiTriedUnits ?? []).includes(n)));
  const additions = input.additions.filter(a => open.has(a.pageFrom));
  const read = input.read.filter(n => open.has(n) && additions.some(a => a.pageFrom === n));
  const tried = input.tried.filter(n => open.has(n));
  if (!tried.length) return { ok: true, added: 0, recorded: false };
  const plan = planChunkInsertion(existing, additions);
  // SCHOLAR-PPTX-READING-01: a slide with text has sections already, so nothing else can show its picture was read. It is recorded BEFORE its
  // section is added: if the last save below fails, it is not read (and charged) again and added twice. A failure before the sections exist undoes this.
  const mixedHere = tried.filter(n => reading.mixedUnits.includes(n));
  const undo = async () => { if (mixedHere.length) await admin.from("individual_scholar_material").update({ extraction_quality: toQualityJson(q) }).eq("user_id", userId).eq("id", materialId); };
  if (mixedHere.length) {
    const { error } = await admin.from("individual_scholar_material").update({ extraction_quality: toQualityJson({
      ...q,
      aiTriedUnits: [...new Set([...(q.aiTriedUnits ?? []), ...mixedHere])].sort((a, b) => a - b),
      aiReadUnits: [...new Set([...(q.aiReadUnits ?? []), ...read.filter(n => mixedHere.includes(n))])].sort((a, b) => a - b),
    }) }).eq("user_id", userId).eq("id", materialId);
    if (error) return { ok: false, error: "record" };
  }
  for (const m of plan.moves) {
    const { error } = await admin.from("individual_scholar_chunk").update({ ordinal: m.to }).eq("user_id", userId).eq("material_id", materialId).eq("id", m.id);
    if (error) { await undo(); return { ok: false, error: "move" }; }
  }
  if (plan.inserts.length) {
    const { error } = await admin.from("individual_scholar_chunk").insert(plan.inserts.map(c => ({
      material_id: materialId, user_id: userId, ordinal: c.ordinal, page_from: c.pageFrom, page_to: c.pageTo, content: c.content,
    })));
    if (error) { await undo(); return { ok: false, error: "insert" }; }
  }
  const chars = plan.inserts.reduce((n, c) => n + c.content.length, 0);
  const quality: ExtractionQuality = {
    ...q, emptyUnits: q.emptyUnits.filter(n => !read.includes(n)), chars: q.chars + chars, sections: q.sections + plan.inserts.length,
    aiReadUnits: [...new Set([...(q.aiReadUnits ?? []), ...read])].sort((a, b) => a - b),
    aiTriedUnits: [...new Set([...(q.aiTriedUnits ?? []), ...tried])].sort((a, b) => a - b),
    ...(input.skipped?.length || q.aiSkipped?.length ? { aiSkipped: [...(q.aiSkipped ?? []), ...(input.skipped ?? []).filter(s => tried.includes(s.unit))] } : {}),
    ...(input.provenance && read.length ? { aiProvenance: [...(q.aiProvenance ?? []), { units: [...read], ...input.provenance }] } : {}),
  };
  const extractor = String(row.extractor ?? "").includes(input.extractorTag) ? row.extractor : `${row.extractor}+${input.extractorTag}`;
  const { error: uErr } = await admin.from("individual_scholar_material").update({
    extraction_quality: toQualityJson(quality), chunk_count: Number(row.chunk_count) + plan.inserts.length, char_count: Number(row.char_count) + chars,
    extractor, updated_at: new Date().toISOString(),
  }).eq("user_id", userId).eq("id", materialId);
  return { ok: true, added: plan.inserts.length, recorded: !uErr };
}
/**
 * SCHOLAR-PPTX-READING-01: record what a stored presentation's slides hold. Only the quality record changes: no section, lesson, plan
 * or AI reading is touched, nothing is added, and it can run again with the same result.
 */
export async function saveSlideFacts(admin: Admin, userId: string, materialId: string, facts: SlideFacts): Promise<{ ok: true; quality: ExtractionQuality } | { ok: false; error: string }> {
  const { data: row, error } = await admin.from("individual_scholar_material").select("extraction_quality").eq("user_id", userId).eq("id", materialId).maybeSingle();
  if (error || !row) return { ok: false, error: "material" };
  const q = fromQualityJson(row.extraction_quality);
  if (!q || q.unit !== "slide") return { ok: false, error: "quality" };
  const { data: rows, error: cErr } = await admin.from("individual_scholar_chunk").select("page_from, page_to").eq("user_id", userId).eq("material_id", materialId).limit(2000);
  if (cErr) return { ok: false, error: "chunks" };
  const withSections = new Set<number>();
  for (const c of (rows ?? []) as any[]) for (let n = Number(c.page_from ?? 0); n > 0 && n <= Number(c.page_to ?? c.page_from); n++) withSections.add(n);
  const quality = applySlideFacts(q, facts, withSections);
  const { error: uErr } = await admin.from("individual_scholar_material").update({ extraction_quality: toQualityJson(quality) }).eq("user_id", userId).eq("id", materialId);
  return uErr ? { ok: false, error: "save" } : { ok: true, quality };
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

// ── OSCE PRACTICE (720 + 721, SCHOLAR-PRACTICE-EXAMS-01, SCHOLAR-OSCE-01) ── simulated stations and their runs ─────
//
// Detected once, as 710 is: one read of a 721 column of the 720 station table, keyed on the caller. Either migration
// absent (42P01 table, 42703 or PGRST204 column, PGRST205): OSCE practice is shown as unavailable with its reason, and
// nothing else changes. 720 and 721 are one unit: the code needs both. A transient error is "no" for now.
// Nothing here is an assessment: no row is copied to assessments, competency_verification_* or the estate osce_* tables.
let osce720: boolean | null = null;
export async function osceSchema(admin: Admin, userId: string): Promise<boolean> {
  if (osce720 !== null) return osce720;
  const { error } = await admin.from("individual_scholar_osce_station").select("id, version").eq("user_id", userId).limit(1);
  if (!error) return (osce720 = true);
  if (isNotProvisioned(error)) return (osce720 = false);
  return false;
}
/** Tests only: forget what was detected. */
export const resetOsceSchema = () => { osce720 = null; };

export type OsceStationRow = OsceDefinition & {
  id: string; title: string; scenario: string; candidateInstructions: string; durationMinutes: number; sections: string[];
  checklist: OsceItem[]; competencyId: string | null; materialId: string | null; chunkId: string | null;
  source: OsceSource; templateKey: string | null; contentStatus: string; reviewStatus: string; model: string | null; promptVersion: string | null; createdAt: string;
  libraryResourceId: string | null; libraryVersionId: string | null;
};
const OSCE_STATION_COLS = "id, title, scenario, candidate_instructions, duration_minutes, sections, checklist, competency_id, material_id, chunk_id, source, template_key, content_status, review_status, model, prompt_version, created_at, profession, programme_code, programme_label, topic, body_system, difficulty, learning_outcomes, objectives, expected_activities, guidance, source_references, version, library_resource_id, library_version_id";
const toOsceStation = (r: any): OsceStationRow => ({
  ...readDefinition(r),
  id: r.id, title: r.title, scenario: r.scenario, candidateInstructions: r.candidate_instructions, durationMinutes: r.duration_minutes,
  sections: Array.isArray(r.sections) ? r.sections : [], checklist: Array.isArray(r.checklist) ? r.checklist : [], competencyId: r.competency_id,
  materialId: r.material_id, chunkId: r.chunk_id, source: r.source, templateKey: r.template_key, contentStatus: r.content_status, reviewStatus: r.review_status ?? "private_formative",
  model: r.model, promptVersion: r.prompt_version, createdAt: r.created_at, libraryResourceId: r.library_resource_id ?? null, libraryVersionId: r.library_version_id ?? null,
});

const listOrNull = (xs: readonly string[]) => (xs.length ? [...xs] : null);

/**
 * One station. A template, or a governed station version, already copied for this learner is returned, not copied twice
 * (720 and 721 unique keys). A governed copy is written exactly as published: the 721 trigger refuses anything else.
 */
/**
 * SCHOLAR-INDEPENDENT-LEARNING-01 P3: the caller's own AI-written station from this material and section at this prompt
 * version, newest first, or null. Read before any generation: the same notes are not written into a station twice.
 */
export async function findOwnAiStation(admin: Admin, userId: string, q: { materialId: string; chunkId: string; promptVersion: string }): Promise<{ id: string; title: string } | null> {
  if (!isUuid(q.materialId) || !isUuid(q.chunkId)) return null;
  try {
    const { data, error } = await admin.from("individual_scholar_osce_station").select("id, title").eq("user_id", userId).eq("source", "ai")
      .eq("material_id", q.materialId).eq("chunk_id", q.chunkId).eq("prompt_version", q.promptVersion).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !data) return null;
    return { id: String(data.id), title: String(data.title ?? "") };
  } catch { return null; }
}

export async function insertOsceStation(admin: Admin, userId: string, d: OsceStationDraft): Promise<{ ok: true; id: string; existing: boolean } | { ok: false; notProvisioned: boolean }> {
  if (d.templateKey || d.libraryVersionId) {
    const q = admin.from("individual_scholar_osce_station").select("id").eq("user_id", userId);
    const { data: had } = await (d.templateKey ? q.eq("template_key", d.templateKey) : q.eq("library_version_id", d.libraryVersionId)).maybeSingle();
    if (had?.id) return { ok: true, id: had.id, existing: true };
  }
  const { data, error } = await admin.from("individual_scholar_osce_station").insert({
    user_id: userId, title: d.title, scenario: d.scenario, candidate_instructions: d.candidateInstructions, duration_minutes: d.durationMinutes,
    sections: d.sections, checklist: d.checklist, competency_id: d.competencyId, material_id: d.materialId, chunk_id: d.chunkId,
    source: d.source, template_key: d.templateKey, content_status: d.contentStatus, model: d.model, prompt_version: d.promptVersion,
    profession: d.profession, programme_code: d.programmeCode, programme_label: d.programmeLabel, topic: d.topic, body_system: d.bodySystem,
    difficulty: d.difficulty, learning_outcomes: listOrNull(d.learningOutcomes), objectives: listOrNull(d.objectives),
    expected_activities: d.exact ? d.exact.expected_activities : listOrNull(d.expectedActivities),
    guidance: d.exact ? d.exact.guidance : guidanceJson(d.guidance), source_references: d.references.length ? d.references : null, version: d.version,
    review_status: d.libraryVersionId ? "library_approved" : "private_formative", library_resource_id: d.libraryResourceId, library_version_id: d.libraryVersionId,
  }).select("id").single();
  if (error || !data) return fail(error);
  return { ok: true, id: data.id, existing: false };
}

export async function listOsceStations(admin: Admin, userId: string): Promise<Read<OsceStationRow[]>> {
  const { data, error } = await admin.from("individual_scholar_osce_station").select(OSCE_STATION_COLS).eq("user_id", userId).order("created_at", { ascending: false }).limit(200);
  if (error) return fail(error);
  return { ok: true, data: (data ?? []).map(toOsceStation) };
}

export async function getOsceStation(admin: Admin, userId: string, id: string): Promise<OsceStationRow | null> {
  if (!isUuid(id)) return null;
  const { data } = await admin.from("individual_scholar_osce_station").select(OSCE_STATION_COLS).eq("user_id", userId).eq("id", id).maybeSingle();
  return data ? toOsceStation(data) : null;
}

/** Deletes the station and, by cascade (720), every run of it. */
export async function deleteOsceStation(admin: Admin, userId: string, id: string): Promise<"ok" | "not_found" | "failed"> {
  if (!isUuid(id)) return "not_found";
  const { data, error } = await admin.from("individual_scholar_osce_station").delete().eq("user_id", userId).eq("id", id).select("id");
  if (error) return "failed";
  return data?.length ? "ok" : "not_found";
}

export type OsceAttemptStatus = "in_progress" | "finished" | "abandoned";
export type OsceAttemptRow = {
  id: string; stationId: string; startedAt: string; finishedAt: string | null; durationSeconds: number | null; timeUp: boolean;
  responses: Record<string, string>; ticks: OsceTick[] | null; score: number | null; criticalMissed: number | null;
  marking: "self_graded" | "ai_evaluation" | null; evaluatorModel: string | null; feedback: Record<string, any> | null;
  status: OsceAttemptStatus; stationVersion: number | null; snapshot: Record<string, unknown> | null; lastSavedAt: string | null;
  gaps: unknown[] | null; revisionSuggestions: unknown[] | null;
};
const OSCE_ATTEMPT_COLS = "id, station_id, started_at, finished_at, duration_seconds, time_up, responses, ticks, score, critical_missed, marking, evaluator_model, feedback, status, station_version, station_snapshot, last_saved_at, gaps, revision_suggestions";
const toOsceAttempt = (r: any): OsceAttemptRow => ({
  id: r.id, stationId: r.station_id, startedAt: r.started_at, finishedAt: r.finished_at, durationSeconds: r.duration_seconds, timeUp: !!r.time_up,
  responses: r.responses && typeof r.responses === "object" ? r.responses : {}, ticks: Array.isArray(r.ticks) ? r.ticks : null,
  score: r.score === null || r.score === undefined ? null : Number(r.score), criticalMissed: r.critical_missed, marking: r.marking,
  evaluatorModel: r.evaluator_model, feedback: r.feedback && typeof r.feedback === "object" ? r.feedback : null,
  status: r.status === "abandoned" || r.status === "finished" ? r.status : r.finished_at ? "finished" : "in_progress",
  stationVersion: Number.isInteger(r.station_version) ? r.station_version : null,
  snapshot: r.station_snapshot && typeof r.station_snapshot === "object" && !Array.isArray(r.station_snapshot) ? r.station_snapshot : null,
  lastSavedAt: r.last_saved_at ?? null, gaps: Array.isArray(r.gaps) ? r.gaps : null, revisionSuggestions: Array.isArray(r.revision_suggestions) ? r.revision_suggestions : null,
});

/** A run begins: the server clock is its start, and the exact station it will be marked against is kept with it (721). */
export async function startOsceAttempt(admin: Admin, userId: string, stationId: string, s: { version: number; snapshot: Record<string, unknown> }): Promise<{ id: string; startedAt: string } | null> {
  const { data, error } = await admin.from("individual_scholar_osce_attempt")
    .insert({ user_id: userId, station_id: stationId, station_version: s.version, station_snapshot: s.snapshot }).select("id, started_at").single();
  return error || !data ? null : { id: data.id, startedAt: data.started_at };
}

export async function getOsceAttempt(admin: Admin, userId: string, id: string): Promise<OsceAttemptRow | null> {
  if (!isUuid(id)) return null;
  const { data } = await admin.from("individual_scholar_osce_attempt").select(OSCE_ATTEMPT_COLS).eq("user_id", userId).eq("id", id).maybeSingle();
  return data ? toOsceAttempt(data) : null;
}

/** The caller's open run of this station, if any (the newest): what a return after navigation or reload resumes. */
export async function openOsceAttempt(admin: Admin, userId: string, stationId: string): Promise<OsceAttemptRow | null> {
  const { data } = await admin.from("individual_scholar_osce_attempt").select(OSCE_ATTEMPT_COLS).eq("user_id", userId).eq("station_id", stationId)
    .eq("status", "in_progress").is("finished_at", null).order("started_at", { ascending: false }).limit(1).maybeSingle();
  return data ? toOsceAttempt(data) : null;
}

/** The caller's runs, newest first: of one station, or of all. */
export async function listOsceAttempts(admin: Admin, userId: string, stationId?: string | null, limit = 50): Promise<Read<OsceAttemptRow[]>> {
  let q = admin.from("individual_scholar_osce_attempt").select(OSCE_ATTEMPT_COLS).eq("user_id", userId);
  if (stationId) q = q.eq("station_id", stationId);
  const { data, error } = await q.order("started_at", { ascending: false }).limit(limit);
  if (error) return fail(error);
  return { ok: true, data: (data ?? []).map(toOsceAttempt) };
}

/** Autosave (721): what is written so far, on an open run only. A finished or abandoned run is never changed by it. */
export async function saveOsceProgress(admin: Admin, userId: string, id: string, responses: Record<string, string>): Promise<boolean> {
  const { data, error } = await admin.from("individual_scholar_osce_attempt")
    .update({ responses, last_saved_at: new Date().toISOString() })
    .eq("user_id", userId).eq("id", id).eq("status", "in_progress").is("finished_at", null).select("id");
  return !error && !!data?.length;
}

/** An open run the learner discards (721): kept as abandoned, with what was written, and never marked. */
export async function abandonOsceAttempt(admin: Admin, userId: string, id: string): Promise<boolean> {
  const { data, error } = await admin.from("individual_scholar_osce_attempt").update({ status: "abandoned" })
    .eq("user_id", userId).eq("id", id).eq("status", "in_progress").is("finished_at", null).select("id");
  return !error && !!data?.length;
}

/** A run ends, once: what was written, and how long it took. A run already finished or abandoned is not changed. */
export async function finishOsceAttempt(admin: Admin, userId: string, id: string, f: { responses: Record<string, string>; finishedAt: string; durationSeconds: number; timeUp: boolean }): Promise<boolean> {
  const { data, error } = await admin.from("individual_scholar_osce_attempt")
    .update({ responses: f.responses, finished_at: f.finishedAt, duration_seconds: f.durationSeconds, time_up: f.timeUp, status: "finished", last_saved_at: f.finishedAt })
    .eq("user_id", userId).eq("id", id).eq("status", "in_progress").is("finished_at", null).select("id");
  return !error && !!data?.length;
}

/** AI feedback on a finished run, kept before the learner confirms their ticks. A marked run is not changed. */
export async function saveOsceFeedback(admin: Admin, userId: string, id: string, feedback: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await admin.from("individual_scholar_osce_attempt").update({ feedback })
    .eq("user_id", userId).eq("id", id).not("finished_at", "is", null).is("ticks", null).select("id");
  return !error && !!data?.length;
}

/** The self-check, once, on a finished run: ticks, practice score, critical misses, how it was checked, gaps and revision suggestions. */
export async function markOsceAttempt(admin: Admin, userId: string, id: string, m: {
  ticks: OsceTick[]; score: number; criticalMissed: number; marking: "self_graded" | "ai_evaluation"; evaluatorModel: string | null; evaluatorPromptVersion: string | null;
  gaps: unknown[]; revisionSuggestions: unknown[];
}): Promise<boolean> {
  const { data, error } = await admin.from("individual_scholar_osce_attempt")
    .update({
      ticks: m.ticks, score: m.score, critical_missed: m.criticalMissed, marking: m.marking, evaluator_model: m.evaluatorModel, evaluator_prompt_version: m.evaluatorPromptVersion,
      gaps: m.gaps, revision_suggestions: m.revisionSuggestions,
    })
    .eq("user_id", userId).eq("id", id).not("finished_at", "is", null).is("ticks", null).select("id");
  return !error && !!data?.length;
}

// ── FLASHCARDS (SCHOLAR-FLASHCARDS-01, migration 730) ── the learner's own cards, decks and card marks ─────────────────
//
// A flashcard IS an individual_scholar_question (416); its schedule the 372 card, its history the 391 log. 730 adds the
// card a learner writes by hand (model and provider learner, bound by its CHECK), decks that REFERENCE cards (moving a
// card never touches its schedule), and per-card marks (bookmark, private note, an issue code). Detected once, as 710
// and 720 are: one read of the 730 deck table keyed on the caller. Absent: hand-written cards, decks and marks are not
// offered, and every other flashcard path works as before.
let flash730: boolean | null = null;
/** Whether migration 730 is applied on this environment. A transient read error is "no" for now, and asked again. */
export async function flashcardSchema(admin: Admin, userId: string): Promise<boolean> {
  if (flash730 !== null) return flash730;
  const { error } = await admin.from("individual_scholar_flashcard_deck").select("id").eq("user_id", userId).limit(1);
  if (!error) return (flash730 = true);
  if (isNotProvisioned(error)) return (flash730 = false);
  return false;
}
/** Tests only: forget what was detected. */
export const resetFlashcardSchema = () => { flash730 = null; };

/** At most this many cards are read for one learner's flashcard views (newest first). */
export const FLASHCARD_READ_MAX = 400;

export type FlashcardRows = {
  /** Flashcards, and governed library copies (recallCardOf decides which of those are cards). Newest first. */
  questions: QuestionRow[];
  extras: Map<string, Omit<CardRowExtras, "competencyTitle">>;
  decks: PersonalDeck[];
  schema730: boolean;
};

/** Every flashcard of the learner (and governed library copies), with schedule, review history, topics, marks and decks. */
export async function flashcardRows(admin: Admin, userId: string): Promise<Read<FlashcardRows>> {
  const sqie = await sqieSchema(admin, userId);
  let q = admin.from("individual_scholar_question").select(QUESTION_COLS).eq("user_id", userId);
  q = sqie ? q.or("kind.eq.flashcard,library_version_id.not.is.null") : q.eq("kind", "flashcard");
  const { data, error } = await q.order("created_at", { ascending: false }).limit(FLASHCARD_READ_MAX);
  if (error) return fail(error);
  const questions = await hydrate(admin, userId, data ?? []);
  const ids = questions.map(x => x.id);
  const schema730 = await flashcardSchema(admin, userId);
  const extras = new Map<string, Omit<CardRowExtras, "competencyTitle">>(ids.map(id => [id, { card: null, history: [], topics: [], mark: null, deckIds: [], contentVersion: 1, updatedAt: null }]));
  if (!ids.length) return { ok: true, data: { questions, extras, decks: schema730 ? await flashcardDecks(admin, userId) : [], schema730 } };
  const [cards, topics] = await Promise.all([
    admin.from("individual_scholar_card").select("id, question_id, next_review_at, last_reviewed_at, last_quality, reviews, interval_days, ease_factor, status").eq("user_id", userId).in("question_id", ids),
    topicsOfSections(admin, userId, [...new Set(questions.map(x => x.chunkId))]),
  ]);
  if (cards.error) return fail(cards.error);
  const cardOf = new Map<string, string>();
  for (const c of (cards.data ?? []) as any[]) {
    cardOf.set(c.id, c.question_id);
    extras.get(c.question_id)!.card = {
      id: c.id, nextReviewAt: c.next_review_at, lastReviewedAt: c.last_reviewed_at ?? null, lastQuality: c.last_quality ?? null, reviews: c.reviews ?? 0,
      intervalDays: c.interval_days ?? 0, ease: Number(c.ease_factor ?? 2.5), status: c.status,
    };
  }
  for (const x of questions) extras.get(x.id)!.topics = topics.get(x.chunkId) ?? [];
  if (cardOf.size) {
    // The 391 log, newest first. Absent (391 not applied): no history, and the page says none is recorded.
    const rv = await admin.from("individual_scholar_review").select("card_id, quality, reviewed_at, interval_days").eq("user_id", userId).in("card_id", [...cardOf.keys()]).order("reviewed_at", { ascending: false }).limit(4000);
    for (const r of (rv.error ? [] : rv.data ?? []) as any[]) {
      const e = extras.get(cardOf.get(r.card_id)!);
      if (e && e.history.length < 20) e.history.push({ quality: r.quality, at: r.reviewed_at, intervalDays: r.interval_days ?? null });
    }
  }
  let decks: PersonalDeck[] = [];
  if (schema730) {
    const [marks, versions, ds] = await Promise.all([
      admin.from("individual_scholar_flashcard_mark").select("question_id, bookmarked, note, issue").eq("user_id", userId).in("question_id", ids),
      admin.from("individual_scholar_question").select("id, content_version, content_updated_at").eq("user_id", userId).in("id", ids),
      flashcardDecks(admin, userId),
    ]);
    for (const m of (marks.error ? [] : marks.data ?? []) as any[]) extras.get(m.question_id)!.mark = { bookmarked: !!m.bookmarked, note: m.note ?? null, issue: m.issue ?? null };
    for (const v of (versions.error ? [] : versions.data ?? []) as any[]) { const e = extras.get(v.id)!; e.contentVersion = v.content_version ?? 1; e.updatedAt = v.content_updated_at ?? null; }
    decks = ds;
    for (const d of decks) for (const id of d.cardIds) extras.get(id)?.deckIds.push(d.id);
  }
  return { ok: true, data: { questions, extras, decks, schema730 } };
}

/**
 * Deck archive (820, SCHOLAR-LEARNING-LIBRARY-01): archived_at on the deck table. Detected like 730: one read of the column
 * keyed on the caller. Absent (42703 or PGRST204 column, 42P01 or PGRST205 table): archive controls are not offered, nothing
 * errors, and every deck reads as not archived. Present is remembered; absent is asked again after half a minute, so
 * applying 820 does not need a restart.
 */
let deckArchive820: { on: boolean; at: number } | null = null;
export async function deckArchiveSchema(admin: Admin, userId: string): Promise<boolean> {
  if (deckArchive820?.on || (deckArchive820 && Date.now() - deckArchive820.at < 30000)) return deckArchive820.on;
  const { error } = await admin.from("individual_scholar_flashcard_deck").select("id, archived_at").eq("user_id", userId).limit(1);
  if (!error) { deckArchive820 = { on: true, at: Date.now() }; return true; }
  if (isNotProvisioned(error) || ["PGRST204", "42703"].includes(String((error as any)?.code ?? ""))) { deckArchive820 = { on: false, at: Date.now() }; return false; }
  return false;
}
/** Tests only: forget what was detected. */
export const resetDeckArchiveSchema = () => { deckArchive820 = null; };

/** The learner's own decks (730), most recently changed first, each with its cards in order. [] where 730 is absent or unreadable. archivedAt where 820 is present. */
export async function flashcardDecks(admin: Admin, userId: string): Promise<PersonalDeck[]> {
  const arch = await deckArchiveSchema(admin, userId);
  const { data, error } = await admin.from("individual_scholar_flashcard_deck").select(`id, title, organise_by, organise_ref, created_at, updated_at, last_studied_at${arch ? ", archived_at" : ""}`).eq("user_id", userId).order("updated_at", { ascending: false }).limit(200);
  if (error || !data?.length) return [];
  const items = await admin.from("individual_scholar_flashcard_deck_card").select("deck_id, question_id, position, added_at").eq("user_id", userId).in("deck_id", (data as any[]).map(d => d.id)).order("position").order("added_at").limit(10000);
  const by = new Map<string, string[]>();
  for (const i of (items.error ? [] : items.data ?? []) as any[]) by.set(i.deck_id, [...(by.get(i.deck_id) ?? []), i.question_id]);
  return (data as any[]).map(d => ({
    id: d.id, title: d.title, organiseBy: d.organise_by, organiseRef: d.organise_ref ?? null, createdAt: d.created_at, updatedAt: d.updated_at,
    lastStudiedAt: d.last_studied_at ?? null, cardIds: by.get(d.id) ?? [], archivedAt: d.archived_at ?? null,
  }));
}

/** Archive or unarchive a deck (820). Only archived_at changes: the deck, its cards, schedules and history all stay. "unavailable" where 820 is absent. */
export async function setDeckArchived(admin: Admin, userId: string, id: string, archived: boolean): Promise<"ok" | "not_found" | "unavailable" | "failed"> {
  if (!isUuid(id)) return "not_found";
  if (!(await deckArchiveSchema(admin, userId))) return "unavailable";
  const { data, error } = await admin.from("individual_scholar_flashcard_deck").update({ archived_at: archived ? new Date().toISOString() : null }).eq("user_id", userId).eq("id", id).select("id");
  if (error) { if (isNotProvisioned(error) || ["PGRST204", "42703"].includes(String((error as any)?.code ?? ""))) { resetDeckArchiveSchema(); return "unavailable"; } return "failed"; }
  return data?.length ? "ok" : "not_found";
}

/** stemKey of each of the learner's flashcard fronts, by card: duplicate detection for a card they write or edit. */
export async function flashcardFronts(admin: Admin, userId: string): Promise<Map<string, string>> {
  const { data, error } = await admin.from("individual_scholar_question").select("id, stem").eq("user_id", userId).eq("kind", "flashcard").limit(5000);
  if (error) return new Map();
  return new Map(((data ?? []) as any[]).map(r => [r.id as string, stemKey(String(r.stem ?? ""))]));
}

/**
 * A card the learner writes by hand (730): filed under one of their materials and a section of it (the first section
 * where none is named), with its 372 card due today. No AI, no notes quote, private_formative: 730 binds it so.
 */
export async function insertLearnerCard(admin: Admin, userId: string, input: { materialId: string; chunkId?: string | null; front: string; back: string; competencyId?: string | null }): Promise<{ ok: true; id: string; chunkId: string } | { ok: false; error: "not_found" | "not_provisioned" | "failed" }> {
  if (!isUuid(input.materialId) || (input.chunkId && !isUuid(input.chunkId))) return { ok: false, error: "not_found" };
  let sq = admin.from("individual_scholar_chunk").select("id").eq("user_id", userId).eq("material_id", input.materialId);
  if (input.chunkId) sq = sq.eq("id", input.chunkId);
  const { data: chunk } = await sq.order("ordinal").limit(1).maybeSingle();
  if (!chunk) return { ok: false, error: "not_found" };
  const { data, error } = await admin.from("individual_scholar_question").insert({
    user_id: userId, material_id: input.materialId, chunk_id: chunk.id, kind: "flashcard", stem: input.front, options: [], correct_index: null,
    answer: { back: input.back }, review_status: "private_formative", rationale: "", source_quote: "",
    model: LEARNER_CARD.model, provider: LEARNER_CARD.provider, prompt_version: LEARNER_CARD.promptVersion,
    ...(input.competencyId ? { competency_id: input.competencyId } : {}),
  }).select("id").single();
  if (error || !data) return { ok: false, error: error && isSchemaRefusal(error) ? "not_provisioned" : "failed" };
  await admin.from("individual_scholar_card").insert({ user_id: userId, question_id: data.id, material_id: input.materialId, next_review_at: todayIso(), status: "active" })
    .then((r: unknown) => r, () => {});
  return { ok: true, id: data.id, chunkId: chunk.id };
}

/** Edit a hand-written card: its front and back, its content version one up. Its schedule and history are untouched. */
export async function updateLearnerCard(admin: Admin, userId: string, id: string, input: { front: string; back: string }): Promise<"ok" | "not_found" | "failed"> {
  if (!isUuid(id)) return "not_found";
  const { data: row } = await admin.from("individual_scholar_question").select("id, content_version").eq("user_id", userId).eq("id", id).eq("model", LEARNER_CARD.model).maybeSingle();
  if (!row) return "not_found";
  const { error } = await admin.from("individual_scholar_question").update({
    stem: input.front, answer: { back: input.back }, content_version: (row.content_version ?? 1) + 1, content_updated_at: new Date().toISOString(),
  }).eq("user_id", userId).eq("id", id).eq("model", LEARNER_CARD.model);
  return error ? "failed" : "ok";
}

/** Remove a hand-written card, with its schedule, history, deck places and marks (cascade). Only the learner's own. */
export async function deleteLearnerCard(admin: Admin, userId: string, id: string): Promise<"ok" | "not_found" | "failed"> {
  if (!isUuid(id)) return "not_found";
  const { data, error } = await admin.from("individual_scholar_question").delete().eq("user_id", userId).eq("id", id).eq("model", LEARNER_CARD.model).select("id");
  if (error) return "failed";
  return data?.length ? "ok" : "not_found";
}

/** A new deck, optionally organised by module, topic, document or competency, with its first cards in order. */
export async function createFlashcardDeck(admin: Admin, userId: string, input: { title: string; organiseBy: PersonalDeck["organiseBy"]; organiseRef: string | null; cardIds: readonly string[] }): Promise<{ ok: true; id: string } | { ok: false; notProvisioned: boolean }> {
  const { data, error } = await admin.from("individual_scholar_flashcard_deck").insert({
    user_id: userId, title: input.title, organise_by: input.organiseBy, organise_ref: input.organiseBy === "personal" ? null : input.organiseRef,
  }).select("id").single();
  if (error || !data) return { ok: false, notProvisioned: !!error && isNotProvisioned(error) };
  if (input.cardIds.length && !(await addDeckCards(admin, userId, data.id, input.cardIds))) {
    await admin.from("individual_scholar_flashcard_deck").delete().eq("user_id", userId).eq("id", data.id);
    return { ok: false, notProvisioned: false };
  }
  return { ok: true, id: data.id };
}

/** Rename a deck, or change how it is organised. */
export async function updateFlashcardDeck(admin: Admin, userId: string, id: string, patch: { title?: string; organiseBy?: PersonalDeck["organiseBy"]; organiseRef?: string | null }): Promise<boolean> {
  if (!isUuid(id)) return false;
  const { data, error } = await admin.from("individual_scholar_flashcard_deck").update({
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.organiseBy !== undefined ? { organise_by: patch.organiseBy, organise_ref: patch.organiseBy === "personal" ? null : patch.organiseRef ?? null } : {}),
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId).eq("id", id).select("id");
  return !error && !!data?.length;
}

/** Remove a deck. Its cards, their schedules and their history stay. */
export async function deleteFlashcardDeck(admin: Admin, userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const { data, error } = await admin.from("individual_scholar_flashcard_deck").delete().eq("user_id", userId).eq("id", id).select("id");
  return !error && !!data?.length;
}

/** Add cards to a deck after its last card. A card already in it stays where it is. The schedule is never copied. */
/**
 * SCHOLAR-FLASHCARDS-QA-01 D1: which of these question ids are the caller's own (keyed on user_id). Read BEFORE a mark
 * or a deck place is written, so another learner's card is a plain 404 rather than a foreign-key refusal (500). null:
 * unreadable (the caller answers 503; nothing is written).
 */
export async function ownedQuestionIds(admin: Admin, userId: string, ids: readonly string[]): Promise<Set<string> | null> {
  const want = [...new Set(ids)].filter(isUuid);
  if (!want.length) return new Set();
  const { data, error } = await admin.from("individual_scholar_question").select("id").eq("user_id", userId).in("id", want);
  if (error) return null;
  return new Set(((data ?? []) as any[]).map(r => r.id as string));
}

export async function addDeckCards(admin: Admin, userId: string, deckId: string, cardIds: readonly string[]): Promise<boolean> {
  const ids = [...new Set(cardIds)].filter(isUuid);
  if (!isUuid(deckId) || !ids.length) return false;
  const { data: last } = await admin.from("individual_scholar_flashcard_deck_card").select("position").eq("user_id", userId).eq("deck_id", deckId).order("position", { ascending: false }).limit(1).maybeSingle();
  const start = (last?.position ?? 0) + 1;
  const { error } = await admin.from("individual_scholar_flashcard_deck_card").upsert(ids.map((question_id, i) => ({ deck_id: deckId, user_id: userId, question_id, position: start + i })), { onConflict: "deck_id,question_id", ignoreDuplicates: true });
  if (!error) await admin.from("individual_scholar_flashcard_deck").update({ updated_at: new Date().toISOString() }).eq("user_id", userId).eq("id", deckId);
  return !error;
}

/** Take cards out of a deck. The cards, their schedules and their history stay. */
export async function removeDeckCards(admin: Admin, userId: string, deckId: string, cardIds: readonly string[]): Promise<boolean> {
  const ids = [...new Set(cardIds)].filter(isUuid);
  if (!isUuid(deckId) || !ids.length) return false;
  const { error } = await admin.from("individual_scholar_flashcard_deck_card").delete().eq("user_id", userId).eq("deck_id", deckId).in("question_id", ids);
  return !error;
}

/** A deck was studied: its last study time. */
export async function touchFlashcardDeck(admin: Admin, userId: string, id: string): Promise<void> {
  if (!isUuid(id)) return;
  await admin.from("individual_scholar_flashcard_deck").update({ last_studied_at: new Date().toISOString() }).eq("user_id", userId).eq("id", id).then((r: unknown) => r, () => {});
}

/**
 * The saved Learn lessons these sections belong to, exactly: one entry per (session, step) whose step holds one of the
 * sections, with its session's title and last use. The caller's own sessions only. [] where unreadable.
 */
export async function learningStepsOfSections(admin: Admin, userId: string, chunkIds: readonly string[]): Promise<{ sessionId: string; title: string; step: number; lastActiveAt: string; chunkIds: string[] }[]> {
  const ids = [...new Set(chunkIds.filter(isUuid))];
  if (!ids.length) return [];
  try {
    const { data, error } = await admin.from("individual_scholar_learning_step").select("session_id, step, chunk_id").eq("user_id", userId).in("chunk_id", ids).limit(3000);
    if (error || !data?.length) return [];
    const sessionIds = [...new Set((data as any[]).map(r => r.session_id as string))];
    const { data: ss, error: sErr } = await admin.from("individual_scholar_learning_session").select("id, title, last_active_at").eq("user_id", userId).in("id", sessionIds);
    if (sErr) return [];
    const meta = new Map(((ss ?? []) as any[]).map(r => [r.id as string, r]));
    const by = new Map<string, { sessionId: string; title: string; step: number; lastActiveAt: string; chunkIds: string[] }>();
    for (const r of data as any[]) {
      const m = meta.get(r.session_id);
      if (!m) continue;
      const k = `${r.session_id}:${r.step}`;
      const e = by.get(k) ?? { sessionId: r.session_id as string, title: m.title as string, step: r.step as number, lastActiveAt: m.last_active_at as string, chunkIds: [] as string[] };
      if (!e.chunkIds.includes(r.chunk_id)) e.chunkIds.push(r.chunk_id);
      by.set(k, e);
    }
    return [...by.values()];
  } catch { return []; }
}

/**
 * The study session each of these decks is linked to (740 study link of kind flashcard_deck), with its title: the newest
 * link wins. The caller's own connected sessions only. Empty where 740 is absent or anything fails.
 */
export async function studySessionsOfDecks(admin: Admin, userId: string, deckIds: readonly string[]): Promise<Map<string, { sessionId: string; title: string }>> {
  const out = new Map<string, { sessionId: string; title: string }>();
  const ids = [...new Set(deckIds.filter(isUuid))];
  if (!ids.length || !(await studySessionSchema(admin, userId))) return out;
  try {
    const { data, error } = await admin.from("individual_scholar_study_link").select("session_id, ref_id, created_at").eq("user_id", userId).eq("kind", "flashcard_deck").in("ref_id", ids).order("created_at", { ascending: false }).limit(1000);
    if (error || !data?.length) return out;
    const { data: ss, error: sErr } = await admin.from("individual_scholar_learning_session").select("id, title").eq("user_id", userId).eq("connected", true).in("id", [...new Set((data as any[]).map(r => r.session_id as string))]);
    if (sErr) return out;
    const title = new Map(((ss ?? []) as any[]).map(r => [r.id as string, r.title as string]));
    for (const r of data as any[]) if (title.has(r.session_id) && !out.has(r.ref_id)) out.set(r.ref_id, { sessionId: r.session_id, title: title.get(r.session_id)! });
  } catch { /* a link is a convenience */ }
  return out;
}

/** A card mark: bookmark, private note, or an issue code (with its time). Only what is given is changed. */
export async function setFlashcardMark(admin: Admin, userId: string, questionId: string, patch: { bookmarked?: boolean; note?: string | null; issue?: string | null }): Promise<boolean> {
  if (!isUuid(questionId)) return false;
  const now = new Date().toISOString();
  const { error } = await admin.from("individual_scholar_flashcard_mark").upsert({
    user_id: userId, question_id: questionId, updated_at: now,
    ...(patch.bookmarked !== undefined ? { bookmarked: patch.bookmarked } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    ...(patch.issue !== undefined ? { issue: patch.issue, issue_at: patch.issue ? now : null } : {}),
  }, { onConflict: "user_id,question_id" });
  return !error;
}

// ── STUDY PLAN SETTINGS (780, SCHOLAR-COMPANION-01) ── what the learner typed, one row each ─────────────────────────
//
// individual_scholar_study_plan holds the exam date and name, the study time, a goal and up to ten priority topics. The
// plan itself is computed from them by study-plan.ts and never stored. Detected once, as 710, 740 and 730 are: one read
// of the table keyed on the caller. Absent (42P01 or PGRST205): get answers { ok: false, notProvisioned: true } and save
// refuses with "not_provisioned", and the policy gate (scholar_study_plan, default off) is off in effect. Nothing here is
// assessment, verification or a Passport row.
let plan780: boolean | null = null;
const STUDY_PLAN_COLS = "exam_date, exam_label, weekly_minutes, days_per_week, goal, priorities, updated_at";
/** goalType and sessionMinutes are 840's (PLP-01..04): null before 840 is applied, and for a plan saved before it. */
export type StudyPlanRow = { examDate: string | null; examLabel: string | null; weeklyMinutes: number; daysPerWeek: number; goal: string | null; priorities: string[]; updatedAt: string; goalType: GoalType | null; sessionMinutes: number | null };
const STUDY_PLAN_COLS_840 = `${STUDY_PLAN_COLS}, goal_type, session_minutes`;
const toStudyPlan = (r: any): StudyPlanRow => ({
  examDate: r.exam_date ?? null, examLabel: r.exam_label ?? null, weeklyMinutes: Number(r.weekly_minutes), daysPerWeek: Number(r.days_per_week),
  goal: r.goal ?? null, priorities: Array.isArray(r.priorities) ? r.priorities.filter((x: unknown): x is string => typeof x === "string") : [], updatedAt: r.updated_at,
  goalType: r.goal_type === "learn" || r.goal_type === "exam" || r.goal_type === "revise" ? r.goal_type : null,
  sessionMinutes: typeof r.session_minutes === "number" ? r.session_minutes : null,
});
/** Whether migration 780 is applied on this environment. A transient read error is "no" for now, and asked again. */
async function studyPlanSchemaRead(admin: Admin, userId: string): Promise<boolean> {
  if (plan780 !== null) return plan780;
  try {
    const { error } = await admin.from("individual_scholar_study_plan").select("user_id").eq("user_id", userId).limit(1);
    if (!error) return (plan780 = true);
    if (isNotProvisioned(error)) plan780 = false;
    return false;
  } catch { return false; }
}
/** Tests only: forget what was detected. */
export const resetStudyPlanSchema = () => { plan780 = null; };

/** The caller's study plan settings: the row, or null with none. Not provisioned (780 absent) and unreadable are told apart from "none". */
async function getStudyPlanRead(admin: Admin, userId: string): Promise<Read<StudyPlanRow | null>> {
  if (plan780 === false) return { ok: false, notProvisioned: true };
  try {
    const with840 = await learningPlanSchema(admin, userId);
    const { data, error } = await admin.from("individual_scholar_study_plan").select(with840 ? STUDY_PLAN_COLS_840 : STUDY_PLAN_COLS).eq("user_id", userId).maybeSingle();
    if (error) { if (isNotProvisioned(error) && !with840) plan780 = false; return fail(error); }
    plan780 = true;
    return { ok: true, data: data ? toStudyPlan(data) : null };
  } catch { return { ok: false, notProvisioned: false }; }
}

/** Save (insert or replace) the caller's settings. The values were validated by cleanStudyPlanInput; the table's CHECKs hold them too. */
export async function saveStudyPlan(
  admin: Admin, userId: string,
  v: { examDate: string | null; examLabel: string | null; weeklyMinutes: number; daysPerWeek: number; goal: string | null; priorities: readonly string[]; goalType?: GoalType | null; sessionMinutes?: number | null },
): Promise<{ ok: true; plan: StudyPlanRow } | { ok: false; error: "not_provisioned" | "failed" }> {
  if (plan780 === false) return { ok: false, error: "not_provisioned" };
  try {
    // goal_type and session_minutes are written only where 840 is present (the columns are not there otherwise).
    const with840 = await learningPlanSchema(admin, userId);
    const { data, error } = await admin.from("individual_scholar_study_plan").upsert({
      user_id: userId, exam_date: v.examDate, exam_label: v.examLabel, weekly_minutes: v.weeklyMinutes, days_per_week: v.daysPerWeek,
      goal: v.goal, priorities: [...v.priorities], updated_at: new Date().toISOString(),
      ...(with840 ? { goal_type: v.goalType ?? null, session_minutes: v.sessionMinutes ?? null } : {}),
    }, { onConflict: "user_id" }).select(with840 ? STUDY_PLAN_COLS_840 : STUDY_PLAN_COLS).single();
    if (error || !data) { if (isNotProvisioned(error)) { plan780 = false; return { ok: false, error: "not_provisioned" }; } return { ok: false, error: "failed" }; }
    plan780 = true;
    return { ok: true, plan: toStudyPlan(data) };
  } catch { return { ok: false, error: "failed" }; }
}

/** Remove the caller's study plan settings. */
export async function clearStudyPlan(admin: Admin, userId: string): Promise<"ok" | "not_provisioned" | "failed"> {
  if (plan780 === false) return "not_provisioned";
  try {
    const { error } = await admin.from("individual_scholar_study_plan").delete().eq("user_id", userId);
    if (error) { if (isNotProvisioned(error)) { plan780 = false; return "not_provisioned"; } return "failed"; }
    return "ok";
  } catch { return "failed"; }
}

// ── SCHOLAR-CONTINUITY-01: THE LEARNING POSITION (790) AND ATTEMPT SNAPSHOTS AND CORRECTIONS (791) ─────────────────────
//
// 790: one position per learner and Learn session, written ONLY through individual_scholar_learning_position_put, which
// applies the stale-write rule (learn-position.ts mirrors it). 791: one immutable snapshot per attempt and an append-only
// trail of corrections. Every statement is keyed on the caller's own user_id. Where 790 or 791 is absent the reads say
// not provisioned and the writes are skipped: Learn stays device-only, and an answer is recorded exactly as before.

let position790: boolean | null = null;
let snapshot791: boolean | null = null;
/** SQIE WS-D: whether 990 (the snapshot's competency_provenance column, unmarked outcomes) is applied. null: not yet known. */
let provenance990: boolean | null = null;
/** SQIE-CLOSE-2026-11 owner decision 3: whether 991 (mapping_status and objective on each provenance element) is applied. */
let provenance991: boolean | null = null;
/** Tests only: forget what was detected. */
export const resetContinuitySchema = () => { position790 = null; snapshot791 = null; provenance990 = null; provenance991 = null; };
/** Whether 990 is known to be absent (the provenance lookup is then skipped: nothing would keep it). */
export const snapshotProvenanceAbsent = () => provenance990 === false || snapshot791 === false;
const isMissingRpc = (error: any) => isNotProvisioned(error) || String(error?.code ?? "") === "42883";

/** The caller's position in one of their Learn sessions, or null (none yet). notProvisioned where 790 is absent. */
export async function getLearningPosition(admin: Admin, userId: string, sessionId: string): Promise<Read<ServerPosition | null>> {
  if (position790 === false) return { ok: false, notProvisioned: true };
  if (!isUuid(sessionId)) return { ok: true, data: null };
  const { data, error } = await admin.from("individual_scholar_learning_position").select("*").eq("user_id", userId).eq("session_id", sessionId).maybeSingle();
  if (error) { if (isNotProvisioned(error)) position790 = false; return fail(error); }
  position790 = true;
  return { ok: true, data: data ? positionFromRow(data) : null };
}

/**
 * One position write for one of the caller's sessions, under 790's stale-write rule. not_found: the session is not the
 * caller's (the composite foreign key refuses it). invalid: a 790 CHECK refused it.
 */
export async function putLearningPosition(admin: Admin, userId: string, sessionId: string, p: PositionPut): Promise<
  { ok: true; accepted: boolean; reason: string; position: ServerPosition | null } | { ok: false; error: "not_provisioned" | "not_found" | "invalid" | "failed" }> {
  if (position790 === false) return { ok: false, error: "not_provisioned" };
  if (!isUuid(sessionId)) return { ok: false, error: "not_found" };
  try {
    const { data, error } = await admin.rpc("individual_scholar_learning_position_put", {
      p_user_id: userId, p_session_id: sessionId, p_device_id: p.deviceId, p_client_seq: p.clientSeq, p_base_revision: p.baseRevision,
      p_client_updated_at: p.clientUpdatedAt, p_step: p.step, p_furthest_step: p.furthestStep, p_card_id: p.cardId, p_section_chunk_id: p.sectionChunkId,
      p_offset_hint: p.offsetHint, p_last_completed_activity: p.lastCompletedActivity, p_last_completed_at: p.lastCompletedAt, p_unfinished: p.unfinished,
    });
    if (error) {
      if (isMissingRpc(error)) { position790 = false; return { ok: false, error: "not_provisioned" }; }
      const code = String(error.code ?? "");
      return { ok: false, error: code === "23503" ? "not_found" : code === "23514" ? "invalid" : "failed" };
    }
    position790 = true;
    return { ok: true, accepted: data?.accepted === true, reason: String(data?.reason ?? ""), position: positionFromRow(data?.position) };
  } catch { return { ok: false, error: "failed" }; }
}

/** The 730 content_version of the caller's own question (1 where 730 is absent or it was never edited). */
export async function questionContentVersion(admin: Admin, userId: string, questionId: string): Promise<number> {
  if (!isUuid(questionId)) return 1;
  const { data, error } = await admin.from("individual_scholar_question").select("content_version").eq("user_id", userId).eq("id", questionId).maybeSingle();
  return error || !Number.isInteger(data?.content_version) ? 1 : data.content_version;
}

/**
 * Keep one attempt's snapshot (791). absent: 791 is not applied (nothing is kept, nothing is wrong). failed: anything else.
 * SQIE WS-D (990): the row carries competency_provenance where the snapshot has it. 990 absent (the column unknown): a snapshot
 * that `needs990` (an understanding check: unmarked is a 990 marking, and today no check keeps a snapshot) is not kept, "absent"
 * -- exactly as before 990 -- and any other is kept as before, without the provenance.
 */
export async function insertAttemptSnapshot(admin: Admin, userId: string, s: AttemptSnapshotRow, opts: { needs990?: boolean } = {}): Promise<"ok" | "absent" | "failed"> {
  if (snapshot791 === false) return "absent";
  if (opts.needs990 && provenance990 === false) return "absent";
  try {
    const full: Record<string, unknown> = { ...snapshotInsertRow(s), user_id: userId };
    // 991 absent: the elements are sent with the four 990 keys only (the 990 CHECK refuses any other key).
    if (provenance991 === false && Array.isArray(full.competency_provenance)) full.competency_provenance = provenance990Keys(full.competency_provenance as CompetencyProvenance[]);
    const { competency_provenance: _p, ...without } = full;
    void _p;
    let withProvenance = "competency_provenance" in full && provenance990 !== false;
    let { error } = await admin.from("individual_scholar_attempt_snapshot").insert({ ...(withProvenance ? full : without), user_id: userId });
    const has991Keys = withProvenance && Array.isArray(full.competency_provenance) && (full.competency_provenance as Record<string, unknown>[]).some(p => "mapping_status" in p || "objective" in p);
    if (error && has991Keys && String((error as any)?.code ?? "") === "23514" && /provenance_check/.test(String((error as any)?.message ?? ""))) {
      provenance991 = false;
      ({ error } = await admin.from("individual_scholar_attempt_snapshot").insert({ ...full, competency_provenance: provenance990Keys(full.competency_provenance as CompetencyProvenance[]), user_id: userId }));
    } else if (!error && has991Keys) provenance991 = true;
    if (error && withProvenance && isMissingColumn(error)) {
      provenance990 = false; withProvenance = false;
      if (opts.needs990) return "absent";
      ({ error } = await admin.from("individual_scholar_attempt_snapshot").insert({ ...without, user_id: userId }));
    }
    if (error) { if (isNotProvisioned(error)) { snapshot791 = false; return "absent"; } return "failed"; }
    snapshot791 = true;
    if (withProvenance) provenance990 = true;
    return "ok";
  } catch { return "failed"; }
}

/**
 * SQIE WS-D (990). What each competency said when the answer was given: its competency_content_hash (395, 761), its framework
 * and that framework's version (012). Never throws: a part it cannot read is null (provenanceOf), never guessed.
 */
export async function competencyProvenance(admin: Admin, competencyIds: readonly string[]): Promise<CompetencyProvenance[]> {
  const ids = [...new Set(competencyIds)].filter(isUuid).slice(0, 20);
  if (!ids.length) return [];
  // The framework tables are read in the competency layer (Scholar reads competencies only through the catalogue, harness K2).
  const read = await readFrameworkProvenance(admin, ids);
  return withMappingStatus(provenanceOf(ids, read), read.statusOf);
}

/** What the caller's attempts were assessed against, and their corrections (oldest first). Empty where 791 is absent or unreadable. */
export async function attemptIntegrity(admin: Admin, userId: string, attemptIds: readonly string[]): Promise<Map<string, AttemptIntegrity>> {
  const ids = [...new Set(attemptIds)].filter(isUuid).slice(0, 200);
  const out = new Map<string, AttemptIntegrity>();
  if (!ids.length || snapshot791 === false) return out;
  const [snaps, corr] = await Promise.all([
    admin.from("individual_scholar_attempt_snapshot").select("*").eq("user_id", userId).in("attempt_id", ids),
    admin.from("individual_scholar_attempt_correction").select("id, attempt_id, previous_score, previous_outcome, corrected_score, corrected_outcome, reason, basis, corrected_by_kind, created_at")
      .eq("user_id", userId).in("attempt_id", ids).order("created_at"),
  ]);
  if (snaps.error && isNotProvisioned(snaps.error)) { snapshot791 = false; return out; }
  const at = (id: string) => { let v = out.get(id); if (!v) { v = { snapshot: null, corrections: [] }; out.set(id, v); } return v; };
  for (const r of (snaps.error ? [] : snaps.data ?? []) as any[]) { const s = snapshotFromRow(r); if (s) at(s.attemptId).snapshot = s; }
  for (const r of (corr.error ? [] : corr.data ?? []) as any[]) { const c = correctionFromRow(r); if (c) at(c.attemptId).corrections.push(c); }
  return out;
}

// ── SQIE-CLOSE-2026-11 WS-I: ONE QUESTION'S HISTORY ACROSS REVISE, CYU AND EXAMS (no new store) ──────────────────────
//
// The rows question-history.ts assembles: every attempt at one of the caller's questions (416/417/950 individual_scholar_attempt),
// the revision session each was made in (417, and its set where 720 is absent, to tell an adaptive exam from a mock), the clarify
// event that kept a check (950), and the exam-paper answers this question was made from (570 revision_question_id). The snapshot
// and corrections come from attemptIntegrity (791/990). Owner-keyed throughout. Every read falls back: a column or table that is
// absent gives what the rest can say, never an error page.

export type HistoryAttemptRow = {
  id: string; questionId: string; answeredAt: string; correct: boolean; score: number | null; chosenIndex: number | null; marking: string;
  response: Record<string, unknown> | null; evaluatorModel: string | null; evaluatorPromptVersion: string | null; contentVersion: number | null;
  revisionSessionId: string | null;
};
export type HistorySessionRow = { id: string; mode: string; adaptive: boolean };
export type HistoryCheckEvent = { attemptId: string; sessionId: string; step: number };
export type HistoryExamAnswer = { id: string; materialId: string; examQuestionId: string | null; examStem: string | null; attempt: Record<string, unknown> | null; model: string; promptVersion: string; createdAt: string };

const HISTORY_ATTEMPT_COLS = "id, question_id, answered_at, correct, score, chosen_index, marking, response, evaluator_model, evaluator_prompt_version, revision_session_id";
const toHistoryAttempt = (a: any): HistoryAttemptRow => ({
  id: a.id, questionId: a.question_id, answeredAt: a.answered_at, correct: !!a.correct, score: a.score === null || a.score === undefined ? null : Number(a.score),
  chosenIndex: Number.isInteger(a.chosen_index) ? a.chosen_index : null, marking: String(a.marking ?? "deterministic"),
  response: a.response && typeof a.response === "object" && !Array.isArray(a.response) ? a.response : null,
  evaluatorModel: a.evaluator_model ?? null, evaluatorPromptVersion: a.evaluator_prompt_version ?? null,
  contentVersion: Number.isInteger(a.content_version) ? a.content_version : null, revisionSessionId: a.revision_session_id ?? null,
});

/** The caller's attempts at one question, newest first (at most `limit`). 950 absent: read without content_version. */
export async function questionAttemptRows(admin: Admin, userId: string, questionId: string, limit = 100): Promise<Read<HistoryAttemptRow[]>> {
  if (!isUuid(questionId)) return { ok: true, data: [] };
  const read = (cols: string) => admin.from("individual_scholar_attempt").select(cols).eq("user_id", userId).eq("question_id", questionId).order("answered_at", { ascending: false }).limit(Math.min(200, Math.max(1, limit)));
  let { data, error } = await read(`${HISTORY_ATTEMPT_COLS}, content_version`);
  if (error && isMissingColumn(error)) ({ data, error } = await read(HISTORY_ATTEMPT_COLS));
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(toHistoryAttempt) };
}

/** The questions the caller most recently answered, newest first (distinct, at most `limit`), with when and how often. */
export async function recentlyAnsweredQuestions(admin: Admin, userId: string, limit = 30): Promise<Read<{ questionId: string; lastAt: string; count: number }[]>> {
  const { data, error } = await admin.from("individual_scholar_attempt").select("question_id, answered_at").eq("user_id", userId).order("answered_at", { ascending: false }).limit(1000);
  if (error) return fail(error);
  const out = new Map<string, { questionId: string; lastAt: string; count: number }>();
  for (const r of (data ?? []) as any[]) {
    const e = out.get(r.question_id);
    if (e) e.count++; else out.set(r.question_id, { questionId: r.question_id, lastAt: r.answered_at, count: 1 });
  }
  return { ok: true, data: [...out.values()].slice(0, Math.max(1, Math.min(100, limit))) };
}

/** A light read of the caller's questions (stem, kind, key and guide): for a history list, never the practice surfaces. */
export async function questionHeads(admin: Admin, userId: string, ids: readonly string[]): Promise<Read<{ id: string; kind: string; stem: string; answer: unknown; materialId: string }[]>> {
  const list = [...new Set(ids)].filter(isUuid).slice(0, 200);
  if (!list.length) return { ok: true, data: [] };
  const { data, error } = await admin.from("individual_scholar_question").select("id, kind, stem, answer, material_id").eq("user_id", userId).in("id", list);
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(q => ({ id: q.id, kind: q.kind, stem: q.stem, answer: q.answer ?? null, materialId: q.material_id })) };
}

/** The revision sessions these attempts were made in: their mode, and whether it is an adaptive exam (720 mode, or the set's marker). */
export async function historySessions(admin: Admin, userId: string, ids: readonly string[]): Promise<Map<string, HistorySessionRow>> {
  const out = new Map<string, HistorySessionRow>();
  const list = [...new Set(ids)].filter(isUuid).slice(0, 200);
  if (!list.length) return out;
  const { data, error } = await admin.from("individual_scholar_revision_session").select("id, mode, set_id").eq("user_id", userId).in("id", list);
  if (error) return out;
  const rows = (data ?? []) as any[];
  const setIds = [...new Set(rows.filter(r => r.mode === "mock" && r.set_id).map(r => r.set_id as string))];
  const adaptiveSets = new Set<string>();
  if (setIds.length) {
    const { data: sets } = await admin.from("individual_scholar_revision_set").select("id, scope").eq("user_id", userId).in("id", setIds);
    for (const st of (sets ?? []) as any[]) if (isAdaptiveScope(st.scope)) adaptiveSets.add(st.id);
  }
  for (const r of rows) out.set(r.id, { id: r.id, mode: String(r.mode ?? ""), adaptive: r.mode === "adaptive" || (!!r.set_id && adaptiveSets.has(r.set_id)) });
  return out;
}

/** The clarify events that kept these attempts as understanding checks (950). Empty without 950. */
export async function historyCheckEvents(admin: Admin, userId: string, attemptIds: readonly string[]): Promise<Map<string, HistoryCheckEvent>> {
  const out = new Map<string, HistoryCheckEvent>();
  const list = [...new Set(attemptIds)].filter(isUuid).slice(0, 200);
  if (!list.length) return out;
  const { data, error } = await admin.from("individual_scholar_learning_event").select("attempt_id, session_id, step").eq("user_id", userId).in("attempt_id", list);
  if (error) return out;
  for (const e of (data ?? []) as any[]) if (e.attempt_id && !out.has(e.attempt_id)) out.set(e.attempt_id, { attemptId: e.attempt_id, sessionId: e.session_id, step: e.step });
  return out;
}

/** The exam-paper answers this practice question was made from (570 revision_question_id), with the printed question. Empty without 570. */
export async function historyExamAnswers(admin: Admin, userId: string, questionId: string): Promise<HistoryExamAnswer[]> {
  if (!isUuid(questionId)) return [];
  const { data, error } = await admin.from("individual_scholar_exam_answer").select("id, material_id, question_id, attempt, model, prompt_version, created_at").eq("user_id", userId).eq("revision_question_id", questionId).order("created_at", { ascending: false }).limit(20);
  if (error || !data?.length) return [];
  const qIds = [...new Set((data as any[]).map(a => a.question_id).filter(Boolean))];
  const { data: qs } = qIds.length ? await admin.from("individual_scholar_exam_question").select("id, stem").eq("user_id", userId).in("id", qIds) : { data: [] };
  const stem = new Map(((qs ?? []) as any[]).map(q => [q.id as string, String(q.stem ?? "")]));
  return (data as any[]).map(a => ({
    id: a.id, materialId: a.material_id, examQuestionId: a.question_id ?? null, examStem: a.question_id ? stem.get(a.question_id) ?? null : null,
    attempt: a.attempt && typeof a.attempt === "object" ? a.attempt : null, model: a.model, promptVersion: a.prompt_version, createdAt: a.created_at,
  }));
}

/**
 * Append one correction to one of the learner's attempts (791). The trigger fills previous_* from the effective result and
 * refuses a correction that changes nothing. `userId` is the learner the attempt belongs to (the HQ caller resolves it).
 */
export async function insertAttemptCorrection(admin: Admin, userId: string, c: {
  attemptId: string; correctedScore: number | null; correctedOutcome: Outcome; reason: string; basis: CorrectionBasis; correctedBy: string | null;
}): Promise<{ ok: true; correction: CorrectionRow } | { ok: false; error: "not_provisioned" | "not_found" | "invalid" | "unchanged" | "failed" }> {
  if (!isUuid(c.attemptId)) return { ok: false, error: "not_found" };
  try {
    // previous_* is filled by the 791 trigger from the effective result; the value sent here is overwritten.
    const { data, error } = await admin.from("individual_scholar_attempt_correction").insert({
      attempt_id: c.attemptId, user_id: userId, previous_outcome: c.correctedOutcome, corrected_score: c.correctedScore, corrected_outcome: c.correctedOutcome,
      reason: c.reason, basis: c.basis, corrected_by: c.correctedBy, corrected_by_kind: c.correctedBy ? "hq_actor" : "system_rule",
    }).select("id, attempt_id, previous_score, previous_outcome, corrected_score, corrected_outcome, reason, basis, corrected_by_kind, created_at").single();
    if (error) {
      if (isNotProvisioned(error)) return { ok: false, error: "not_provisioned" };
      const msg = String(error.message ?? ""), code = String(error.code ?? "");
      return { ok: false, error: /not this learner own/.test(msg) || code === "23503" ? "not_found" : /changes nothing/.test(msg) ? "unchanged" : code === "23514" ? "invalid" : "failed" };
    }
    const row = correctionFromRow(data);
    return row ? { ok: true, correction: row } : { ok: false, error: "failed" };
  } catch { return { ok: false, error: "failed" }; }
}


// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ── SCHOLAR-MONTHLY-REVIEW-01 (owner GO, 1 Nov 2026): THE STUDY CALENDAR ENTRIES (830) AND THE MONTH'S RECORDS ────────
//
// The store is the only Scholar write site, so everything the monthly review and the calendar read or write lives here, keyed
// on the caller's own user_id. The pure rules are in monthly-review.ts and study-calendar.ts, the assembly in
// monthly-review-data.ts and study-calendar-data.ts. A card's schedule is read (to show when it is due) and NEVER written.
//
// 830 keeps three small things the calendar cannot derive: a planned activity moved to another day, a monthly review date
// moved (or a review waiting to resume), and the choice not to be shown monthly review suggestions. FAIL CLOSED: where 830 is
// absent the calendar shows everything it can derive, offers no Move button, hides the opt-out, and the writes answer
// "not provisioned". The monthly review itself needs no migration.

type MonthlyActivityRecords = import("./monthly-review").ActivityRecords;
export type StoredCalendarEntry = { kind: "plan_activity" | "monthly_review" | "preference"; ref: string; originalDate: string | null; scheduledDate: string | null; value: Record<string, unknown> | null };
const CAL_COLS = "kind, ref, original_date, scheduled_date, value";
const toCalendarEntry = (r: any): StoredCalendarEntry => ({
  kind: r.kind, ref: r.ref, originalDate: r.original_date ?? null, scheduledDate: r.scheduled_date ?? null,
  value: r.value && typeof r.value === "object" && !Array.isArray(r.value) ? r.value : null,
});

let cal830: boolean | null = null;
/** Whether migration 830 is applied on this environment. A transient read error is "no" for now, and asked again. */
export async function calendarSchema(admin: Admin, userId: string): Promise<boolean> {
  if (cal830 !== null) return cal830;
  try {
    const { error } = await admin.from("individual_scholar_calendar_entry").select("id").eq("user_id", userId).limit(1);
    if (!error) return (cal830 = true);
    if (isNotProvisioned(error)) cal830 = false;
    return false;
  } catch { return false; }
}
/** Tests only: forget what was detected. */
export const resetCalendarSchema = () => { cal830 = null; };

/** The caller's calendar entries. Not provisioned (830 absent) is told apart from unreadable. */
async function listCalendarEntriesRead(admin: Admin, userId: string): Promise<Read<StoredCalendarEntry[]>> {
  if (cal830 === false) return { ok: false, notProvisioned: true };
  try {
    const { data, error } = await admin.from("individual_scholar_calendar_entry").select(CAL_COLS).eq("user_id", userId).limit(2000);
    if (error) { if (isNotProvisioned(error)) cal830 = false; return { ok: false, notProvisioned: isNotProvisioned(error) }; }
    cal830 = true;
    return { ok: true, data: ((data ?? []) as any[]).map(toCalendarEntry) };
  } catch { return { ok: false, notProvisioned: false }; }
}

export type CalendarEntryPatch = { originalDate?: string | null; scheduledDate?: string | null; value?: Record<string, unknown> | null };
/**
 * Save (insert or change) one entry. A field left out of the patch keeps what the row has, so a review waiting to resume does
 * not lose a moved date, and the other way round. The caller validated the dates (validateMove), the kind and the reference.
 */
export async function putCalendarEntry(admin: Admin, userId: string, kind: StoredCalendarEntry["kind"], ref: string, patch: CalendarEntryPatch): Promise<"ok" | "not_provisioned" | "failed"> {
  if (cal830 === false) return "not_provisioned";
  try {
    const { data: cur, error: rErr } = await admin.from("individual_scholar_calendar_entry").select(CAL_COLS).eq("user_id", userId).eq("kind", kind).eq("ref", ref).maybeSingle();
    if (rErr) { if (isNotProvisioned(rErr)) { cal830 = false; return "not_provisioned"; } return "failed"; }
    const had = cur ? toCalendarEntry(cur) : null;
    const { error } = await admin.from("individual_scholar_calendar_entry").upsert({
      user_id: userId, kind, ref,
      original_date: patch.originalDate !== undefined ? patch.originalDate : had?.originalDate ?? null,
      scheduled_date: patch.scheduledDate !== undefined ? patch.scheduledDate : had?.scheduledDate ?? null,
      value: patch.value !== undefined ? patch.value : had?.value ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,kind,ref" });
    if (error) { if (isNotProvisioned(error)) { cal830 = false; return "not_provisioned"; } return "failed"; }
    cal830 = true;
    return "ok";
  } catch { return "failed"; }
}

/** Remove one entry (put a moved activity back, or turn suggestions back on). */
export async function removeCalendarEntry(admin: Admin, userId: string, kind: StoredCalendarEntry["kind"], ref: string): Promise<"ok" | "not_provisioned" | "failed"> {
  if (cal830 === false) return "not_provisioned";
  try {
    const { error } = await admin.from("individual_scholar_calendar_entry").delete().eq("user_id", userId).eq("kind", kind).eq("ref", ref);
    if (error) { if (isNotProvisioned(error)) { cal830 = false; return "not_provisioned"; } return "failed"; }
    return "ok";
  } catch { return "failed"; }
}

async function inBatchesOf(admin: Admin, table: string, cols: string, col: string, userId: string, ids: readonly string[], size = 150): Promise<any[]> {
  const out: any[] = [];
  const uniq = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < uniq.length; i += size) {
    const r = await admin.from(table).select(cols).eq("user_id", userId).in(col, uniq.slice(i, i + size));
    if (r.error && !isNotProvisioned(r.error)) throw new Error(r.error.message ?? "read failed");
    out.push(...(r.error ? [] : r.data ?? []));
  }
  return out;
}

export type MonthRecords = { records: MonthlyActivityRecords; evaluations: { id: string; scopeKind: string | null; label: string | null; at: string }[] };
/**
 * The caller's own dated records from the first day of `fromMonth` to the last day of `toMonth`: lessons (learning events), answers,
 * spaced reviews, revision and case sessions, materials added and evaluations made, with each section's topics and competency
 * links. Only real dates. null when a core source cannot be read (never a calm empty). `competencies` is handed in by the caller.
 */
export async function monthRecords(admin: Admin, userId: string, fromMonth: string, toMonth: string, competencies: readonly { id: string; title: string }[]): Promise<MonthRecords | null> {
  const nextOf = (m: string) => { const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; };
  const from = `${fromMonth}-01T00:00:00.000Z`, to = `${nextOf(toMonth)}-01T00:00:00.000Z`;
  const soft = async (q: PromiseLike<{ data: any; error: any }>) => { const r = await q; return r.error && isNotProvisioned(r.error) ? { data: [] as any[], error: null } : r; };
  try {
    const [ev, att, rev, rs, cs, mats, evs] = await Promise.all([
      soft(admin.from("individual_scholar_learning_event").select("session_id, step, created_at").eq("user_id", userId).gte("created_at", from).lt("created_at", to).limit(5000)),
      admin.from("individual_scholar_attempt").select("question_id, answered_at, revision_session_id").eq("user_id", userId).gte("answered_at", from).lt("answered_at", to).limit(20000),
      soft(admin.from("individual_scholar_review").select("card_id, reviewed_at").eq("user_id", userId).gte("reviewed_at", from).lt("reviewed_at", to).limit(20000)),
      soft(admin.from("individual_scholar_revision_session").select("id, mode, created_at").eq("user_id", userId).gte("created_at", from).lt("created_at", to).limit(2000)),
      soft(admin.from("individual_scholar_case_session").select("id, private_case_id, created_at").eq("user_id", userId).gte("created_at", from).lt("created_at", to).limit(2000)),
      admin.from("individual_scholar_material").select("id, title, created_at").eq("user_id", userId).gte("created_at", from).lt("created_at", to).limit(500),
      soft(admin.from("individual_scholar_evaluation").select("id, scope, created_at").eq("user_id", userId).gte("created_at", from).lt("created_at", to).limit(500)),
    ]);
    if ([att, mats].some(r => r.error)) return null;
    const events = (ev.data ?? []) as any[];
    const sessionIds = [...new Set(events.map(e => e.session_id as string))];
    const caseIds = [...new Set(((cs.data ?? []) as any[]).map(c => c.private_case_id as string).filter(Boolean))];
    const cardIds = [...new Set(((rev.data ?? []) as any[]).map(r => r.card_id as string))];
    const [sessions, steps, caseSrc, cards] = await Promise.all([
      inBatchesOf(admin, "individual_scholar_learning_session", "id, title", "id", userId, sessionIds),
      inBatchesOf(admin, "individual_scholar_learning_step", "session_id, step, chunk_id, material_id", "session_id", userId, sessionIds),
      inBatchesOf(admin, "individual_scholar_case_source", "case_id, chunk_id", "case_id", userId, caseIds),
      inBatchesOf(admin, "individual_scholar_card", "id, question_id", "id", userId, cardIds),
    ]);
    const qIds = [...((att.data ?? []) as any[]).map(a => a.question_id as string), ...cards.map(c => c.question_id as string)];
    const questions = await inBatchesOf(admin, "individual_scholar_question", "id, chunk_id, material_id", "id", userId, qIds);
    const qChunk = new Map(questions.map(q => [q.id as string, { chunkId: q.chunk_id as string, materialId: q.material_id as string }]));
    const cardQ = new Map(cards.map(c => [c.id as string, c.question_id as string]));
    const chunkMaterial = new Map<string, string>();
    for (const q of questions) chunkMaterial.set(q.chunk_id, q.material_id);
    for (const s of steps) chunkMaterial.set(s.chunk_id, s.material_id);
    const loose = caseSrc.map(c => c.chunk_id as string).filter(id => !chunkMaterial.has(id));
    for (const c of await inBatchesOf(admin, "individual_scholar_chunk", "id, material_id", "id", userId, loose)) chunkMaterial.set(c.id, c.material_id);
    // MY PLAN PERF: the topics and links are read for the sections the records touch while the sections themselves are listed (they used to wait for the list,
    // and the list is only ever filtered to these same sections), so three steps become one.
    const wanted = new Set(chunkMaterial.keys());
    const [refs, topicMap, links] = await Promise.all([
      sectionsOf(admin, userId, [...new Set(chunkMaterial.values())]), topicsOfSections(admin, userId, [...wanted]), sectionLinks(admin, userId, [...wanted]),
    ]);
    if (!refs.ok) return null;
    const sections = refs.data.filter(s => wanted.has(s.chunkId)).map(s => ({ chunkId: s.chunkId, materialId: s.materialId, materialTitle: s.materialTitle, label: s.pageFrom !== null ? `${s.unit} ${s.pageFrom}` : `section ${s.ordinal}` }));

    const title = new Map(sessions.map(s => [s.id as string, String(s.title ?? "A lesson")]));
    const stepChunks = new Map<string, string[]>();
    for (const s of steps) { const k = `${s.session_id}:${s.step}`; stepChunks.set(k, [...(stepChunks.get(k) ?? []), s.chunk_id]); }
    const caseChunks = new Map<string, string[]>();
    for (const c of caseSrc) caseChunks.set(c.case_id, [...(caseChunks.get(c.case_id) ?? []), c.chunk_id]);
    const records: MonthlyActivityRecords = {
      sections,
      lessons: events.map(e => ({ sessionId: e.session_id as string, step: Number(e.step), title: title.get(e.session_id) ?? "A lesson", chunkIds: stepChunks.get(`${e.session_id}:${e.step}`) ?? [], at: e.created_at as string })),
      materials: ((mats.data ?? []) as any[]).map(m => ({ id: m.id, title: m.title, at: m.created_at })),
      answers: ((att.data ?? []) as any[]).flatMap(a => { const q = qChunk.get(a.question_id); return q ? [{ questionId: a.question_id as string, chunkId: q.chunkId, at: a.answered_at as string, sessionId: (a.revision_session_id as string | null) ?? null }] : []; }),
      reviews: ((rev.data ?? []) as any[]).flatMap(r => { const q = qChunk.get(cardQ.get(r.card_id) ?? ""); return q ? [{ chunkId: q.chunkId, at: r.reviewed_at as string }] : []; }),
      revisionSessions: ((rs.data ?? []) as any[]).map(s => ({ id: s.id as string, mode: s.mode as string, at: s.created_at as string })),
      caseSessions: ((cs.data ?? []) as any[]).map(c => ({ id: c.id as string, at: c.created_at as string, chunkIds: caseChunks.get(c.private_case_id) ?? [] })),
      topics: Object.fromEntries([...topicMap.entries()]), links: links.map(l => ({ chunkId: l.chunkId, competencyId: l.competencyId })),
      competencies: [...competencies],
    };
    return { records, evaluations: ((evs.data ?? []) as any[]).map(e => ({ id: e.id, scopeKind: e.scope?.kind ?? null, label: e.scope?.label ?? null, at: e.created_at })) };
  } catch { return null; }
}

/** The caller's active cards by the day their review is due (YYYY-MM-DD -> count). Read only: a card schedule is never written here. null when unreadable. */
async function cardDueDatesRead(admin: Admin, userId: string): Promise<Record<string, number> | null> {
  const { data, error } = await admin.from("individual_scholar_card").select("next_review_at").eq("user_id", userId).eq("status", "active").limit(5000);
  if (error) return isNotProvisioned(error) ? {} : null;
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as any[]) { const d = String(r.next_review_at).slice(0, 10); out[d] = (out[d] ?? 0) + 1; }
  return out;
}

export type MonthlyReviewRecord = { id: string; month: string; createdAt: string; retakeOf: string | null; late: boolean; freshSessionId: string | null; label: string; confidence: string };
/** The caller's monthly reviews (the evaluations whose scope is a month), newest first. Light: no results are read. null when unreadable. */
async function listMonthlyReviewRecordsRead(admin: Admin, userId: string): Promise<MonthlyReviewRecord[] | null> {
  const { data, error } = await admin.from("individual_scholar_evaluation").select("id, scope, context, confidence, fresh_session_id, created_at")
    .eq("user_id", userId).filter("scope->>kind", "eq", "month").order("created_at", { ascending: false }).limit(200);
  if (error) return isNotProvisioned(error) ? [] : null;
  return ((data ?? []) as any[]).flatMap(r => {
    const month = r.scope?.month;
    if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
    const m = r.context?.monthlyReview ?? {};
    return [{ id: r.id, month, createdAt: r.created_at, retakeOf: typeof m.retakeOf === "string" ? m.retakeOf : null, late: m.late === true, freshSessionId: r.fresh_session_id ?? null, label: String(r.scope?.label ?? ""), confidence: r.confidence }];
  });
}

/** The monthly review already made from this sitting, if any: asking twice returns it, never a second "original". */
export async function monthlyReviewForSession(admin: Admin, userId: string, sessionId: string): Promise<string | null> {
  const { data } = await admin.from("individual_scholar_evaluation").select("id").eq("user_id", userId).eq("fresh_session_id", sessionId).filter("scope->>kind", "eq", "month").limit(1);
  return (data ?? [])[0]?.id ?? null;
}

/** The questions of a finished sitting, with the section each belongs to and whether it is a case-step (application) question. */
export async function sittingQuestions(admin: Admin, userId: string, ids: readonly string[]): Promise<{ id: string; chunkId: string; application: boolean }[]> {
  const rows = await inBatchesOf(admin, "individual_scholar_question", "id, chunk_id, kind, case_id", "id", userId, ids);
  const byId = new Map(rows.map(r => [r.id as string, r]));
  return ids.flatMap(id => { const r = byId.get(id); return r ? [{ id, chunkId: r.chunk_id as string, application: r.kind === "case" || !!r.case_id }] : []; });
}

/** Remove an unanswered revision sitting the caller made only to have questions written for it. Owner-keyed. */
export async function discardRevisionSession(admin: Admin, userId: string, id: string): Promise<void> {
  if (!isUuid(id)) return;
  await admin.from("individual_scholar_revision_session").delete().eq("user_id", userId).eq("id", id);
}

// -- 880: WHAT THE AI SAID AROUND A CASE (SCHOLAR-CE-2026 CE-04) --
// Talk to the patient turns, the communication note and the handover note, append-only, beside the attempt.
// Absent 880: nothing is kept and the panel says so (notProvisioned). Formative and simulated: never a fact.

export type ConversationEntryKind = "turn" | "communication_note" | "handover_note";
export type ConversationEntry = {
  id: string; kind: ConversationEntryKind; seq: number; stageId: string | null; decisionPointId: string | null;
  question: string | null; reply: string; screened: boolean; model: string | null; createdAt: string;
};
const CONVERSATION_COLS = "id, entry_kind, seq, stage_id, decision_point_id, question, reply, screened, model, created_at";
const toConversationEntry = (r: any): ConversationEntry => ({
  id: r.id, kind: r.entry_kind, seq: r.seq, stageId: r.stage_id ?? null, decisionPointId: r.decision_point_id ?? null,
  question: r.question ?? null, reply: r.reply, screened: r.screened === true, model: r.model ?? null, createdAt: r.created_at,
});

/** The caller's conversation entries of one session, oldest first. */
export async function listCaseConversation(admin: Admin, userId: string, kind: "private" | "library", sessionId: string): Promise<Read<ConversationEntry[]>> {
  if (!isUuid(sessionId)) return { ok: true, data: [] };
  const { data, error } = await admin.from("individual_scholar_case_conversation").select(CONVERSATION_COLS).eq("user_id", userId)
    .eq(kind === "private" ? "private_session_id" : "library_session_id", sessionId).order("seq", { ascending: true }).limit(500);
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(toConversationEntry) };
}

/** Keep one entry. The database checks the session is the caller's own, the stage reached, and the order (880's guard). */
export async function insertCaseConversation(admin: Admin, userId: string, input: {
  kind: "private" | "library"; sessionId: string; entry: ConversationEntryKind; stageId?: string | null; decisionPointId?: string | null;
  question?: string | null; reply: string; screened?: boolean; model?: string | null; promptVersion?: string | null;
}): Promise<{ ok: true } | { ok: false; reason: "not_provisioned" | "refused" }> {
  if (!isUuid(input.sessionId)) return { ok: false, reason: "refused" };
  const { error } = await admin.from("individual_scholar_case_conversation").insert({
    user_id: userId, session_kind: input.kind, ...(input.kind === "private" ? { private_session_id: input.sessionId } : { library_session_id: input.sessionId }),
    entry_kind: input.entry, stage_id: input.stageId ?? null, decision_point_id: input.decisionPointId ?? null, question: input.question ?? null,
    reply: input.reply, screened: input.screened === true, model: input.model ?? null, prompt_version: input.promptVersion ?? null,
  });
  if (!error) return { ok: true };
  return { ok: false, reason: isNotProvisioned(error) ? "not_provisioned" : "refused" };
}

// ── MY PLAN PERF (scholar/plan-perf-01) ── request-scoped reads ──────────────────────────────────────────────────────────────
// React cache() memoises per server render (the same admin client and user): My Plan's loaders, the layout and the page ask for the same rows
// several times in one request, and now read them once. Outside a render (every route handler, every test) cache() calls straight through, so a
// write is always followed by a fresh read there. Callers treat these results as read-only.
export const competencyProgressRows = cache(competencyProgressRowsRead);
export const studyPlanSchema = cache(studyPlanSchemaRead);
export const getStudyPlan = cache(getStudyPlanRead);
export const listCalendarEntries = cache(listCalendarEntriesRead);
export const cardDueDates = cache(cardDueDatesRead);
export const listMonthlyReviewRecords = cache(listMonthlyReviewRecordsRead);
const masteryEvidenceOnce = cache((admin: Admin, userId: string, sinceIso: string, maxRows: number) => masteryEvidenceRead(admin, userId, { sinceIso, maxRows }));
export const masteryEvidence = (admin: Admin, userId: string, o: { sinceIso: string; maxRows: number }): Promise<Read<MasteryRaw>> => masteryEvidenceOnce(admin, userId, o.sinceIso, o.maxRows);

// ── SCHOLAR-CE07C: THE UPLOAD RECORD (migration 960) ─────────────────────────────────────────────────
//
// One row per upload identity between the signed slot and the material (upload-record.ts holds the decisions).
// Without 960 every function answers "absent" (or does nothing) and the routes behave as before it.

/** Record a new upload identity. "absent": 960 not applied (go on without it). */
export async function issueUpload(admin: Admin, userId: string, u: { id: string; mime: MaterialMime; size: number; sha256: string }, nowMs: number): Promise<"ok" | "absent" | "failed"> {
  const { error } = await admin.from("individual_scholar_upload").insert({ id: u.id, user_id: userId, mime_type: u.mime, byte_size: u.size, sha256: u.sha256, state: "issued", issued_at: new Date(nowMs).toISOString() });
  if (!error) return "ok";
  return isNotProvisioned(error) ? "absent" : "failed";
}

export async function getUpload(admin: Admin, userId: string, id: string): Promise<UploadRow | null | "absent"> {
  if (!isUuid(id)) return null;
  const { data, error } = await admin.from("individual_scholar_upload").select("*").eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) return isNotProvisioned(error) ? "absent" : null;
  return (data as UploadRow) ?? null;
}

/** The newest unfinished upload of exactly these bytes, to continue under the same identity. */
export async function findReusableUpload(admin: Admin, userId: string, want: { mime: string; size: number; sha256: string }, nowMs: number): Promise<UploadRow | null> {
  const { data, error } = await admin.from("individual_scholar_upload").select("*").eq("user_id", userId).eq("sha256", want.sha256).eq("state", "issued")
    .order("issued_at", { ascending: false }).limit(5);
  if (error) return null;
  return ((data ?? []) as UploadRow[]).find(r => reusable(r, want, nowMs)) ?? null;
}

/**
 * Take the single finish claim: issued -> processing, or a stale processing claim taken over. Returns the row when
 * the claim is ours, the current row when it is not, "absent" without 960, null when there is no row.
 */
export async function claimUpload(admin: Admin, userId: string, id: string, nowMs: number): Promise<{ claimed: true; row: UploadRow } | { claimed: false; row: UploadRow } | "absent" | null> {
  if (!isUuid(id)) return null;
  const staleBefore = new Date(nowMs - STALE_CLAIM_MS).toISOString();
  const { data, error } = await admin.from("individual_scholar_upload")
    .update({ state: "processing", processing_started_at: new Date(nowMs).toISOString(), updated_at: new Date(nowMs).toISOString() })
    .eq("user_id", userId).eq("id", id)
    .or(`state.eq.issued,and(state.eq.processing,processing_started_at.lt.${staleBefore})`)
    .select("*");
  if (error) return isNotProvisioned(error) ? "absent" : null;
  if ((data ?? []).length) return { claimed: true, row: data[0] as UploadRow };
  const row = await getUpload(admin, userId, id);
  if (row === "absent") return "absent";
  return row ? { claimed: false, row } : null;
}

/** Settle an upload. A refusal keeps the learner-facing answer for a retried finish. */
export async function settleUpload(admin: Admin, userId: string, id: string, outcome: { state: "kept" | "cancelled" | "abandoned" } | { state: "refused"; status: number; message: string }, nowMs: number): Promise<void> {
  const now = new Date(nowMs).toISOString();
  const patch = outcome.state === "refused"
    ? { state: "refused", refusal_status: outcome.status, refusal_message: outcome.message.slice(0, 600), settled_at: now, updated_at: now }
    : { state: outcome.state, refusal_status: null, refusal_message: null, settled_at: now, updated_at: now };
  await admin.from("individual_scholar_upload").update(patch).eq("user_id", userId).eq("id", id);
}

/** Give a claim back (a transient failure): the same upload can be finished again without sending the file again. */
export async function releaseUpload(admin: Admin, userId: string, id: string, nowMs: number): Promise<void> {
  await admin.from("individual_scholar_upload").update({ state: "issued", processing_started_at: null, updated_at: new Date(nowMs).toISOString() })
    .eq("user_id", userId).eq("id", id).eq("state", "processing");
}

/** Settled records past their retention go (a week: a late retry still gets its answer). */
export async function pruneSettledUploads(admin: Admin, userId: string, nowMs: number): Promise<number> {
  const { data, error } = await admin.from("individual_scholar_upload").delete().eq("user_id", userId).not("settled_at", "is", null)
    .lt("settled_at", new Date(nowMs - SETTLED_RETENTION_MS).toISOString()).select("id");
  return error ? 0 : (data ?? []).length;
}

/** Is this upload id a kept material of this person? null: unreadable. */
export async function materialExists(admin: Admin, userId: string, id: string): Promise<boolean | null> {
  const { data, error } = await admin.from("individual_scholar_material").select("id").eq("user_id", userId).eq("id", id).maybeSingle();
  return error ? null : !!data;
}

/** The object paths an upload id may have (the type is not known without the record). */
const UPLOAD_MIMES: MaterialMime[] = ["application/pdf", DOCX_MIME, PPTX_MIME, "text/plain"] as MaterialMime[];
export const candidatePaths = (userId: string, id: string, mime?: MaterialMime | null) =>
  mime ? [uploadPath(userId, id, mime)] : UPLOAD_MIMES.map(m => uploadPath(userId, id, m));

/**
 * The learner cancels an upload that is not kept. Removes the object if it got there, and records the cancel.
 * "kept": a material exists (delete that instead). "busy": a finish is reading it now.
 */
export async function cancelUpload(admin: Admin, userId: string, id: string, nowMs: number): Promise<"ok" | "kept" | "busy" | "failed"> {
  if (!isUuid(id)) return "ok";
  const exists = await materialExists(admin, userId, id);
  if (exists === null) return "failed";
  if (exists) return "kept";
  const row = await getUpload(admin, userId, id);
  if (row && row !== "absent" && finishDecision(row, nowMs).kind === "busy") return "busy";
  const rm = await admin.storage.from(BUCKET).remove(candidatePaths(userId, id, row && row !== "absent" ? row.mime_type : null));
  if (rm.error) return "failed";
  if (row && row !== "absent" && (row.state === "issued" || row.state === "processing")) await settleUpload(admin, userId, id, { state: "cancelled" }, nowMs);
  return "ok";
}

/**
 * One person's clean-up, run on their next upload (works without 960): objects in their folder older than 24 h that
 * no material uses and no finish is reading are removed, their unfinished records marked abandoned, and their settled
 * records past retention removed. Best effort and bounded (one listing of up to 1000 objects). Returns objects removed.
 */
export async function sweepPersonUploads(admin: Admin, userId: string, nowMs: number): Promise<number> {
  const before = new Date(nowMs - ABANDON_AFTER_MS).toISOString();
  const now = new Date(nowMs).toISOString();
  const { data: rows, error: rErr } = await admin.from("individual_scholar_upload").select("id, mime_type, state, processing_started_at").eq("user_id", userId).eq("state", "processing");
  if (!rErr) {
    await admin.from("individual_scholar_upload").update({ state: "abandoned", settled_at: now, updated_at: now }).eq("user_id", userId).eq("state", "issued").lt("issued_at", before);
    await pruneSettledUploads(admin, userId, nowMs);
  }
  const listed = await admin.storage.from(BUCKET).list(userId, { limit: 1000 });
  if (listed.error) return 0;
  const objects = (listed.data ?? []) as { name: string; created_at?: string | null }[];
  if (!objects.some(o => o.created_at && nowMs - Date.parse(o.created_at) >= ABANDON_AFTER_MS)) return 0;
  const { data: mats, error } = await admin.from("individual_scholar_material").select("storage_path").eq("user_id", userId).limit(5000);
  if (error) return 0;
  // SCHOLAR-VISUAL-001 phase 2: a drawn slide is no abandoned upload. Not knowing which are drawn: nothing is swept this time. An image a killed job
  // never recorded is in no list here, so it does go, once it is a day old.
  const drawn = await renderPaths(admin, userId);
  if (drawn === null) return 0;
  const kept = new Set([...((mats ?? []) as any[]).map(m => m.storage_path as string), ...drawn]);
  const busy = new Set<string>();
  if (!rErr) for (const r of (rows ?? []) as any[]) if (finishDecision(r, nowMs).kind === "busy") busy.add(uploadPath(userId, r.id, r.mime_type));
  const gone = abandonedObjects(userId, objects, kept, busy, nowMs);
  if (!gone.length) return 0;
  const rm = await admin.storage.from(BUCKET).remove(gone);
  return rm.error ? 0 : gone.length;
}

/**
 * The platform clean-up's action on ONE unfinished upload it listed (scholar-upload-sweep.ts): a kept material is
 * recorded kept, anything else has its object removed and is recorded abandoned. Keyed on the upload's own person.
 */
export async function abandonUpload(admin: Admin, userId: string, row: Pick<UploadRow, "id" | "mime_type" | "state" | "processing_started_at" | "refusal_status" | "refusal_message">, nowMs: number): Promise<"kept" | "abandoned" | "skipped"> {
  if (finishDecision(row, nowMs).kind === "busy") return "skipped";
  const exists = await materialExists(admin, userId, row.id);
  if (exists === null) return "skipped";
  if (exists) { await settleUpload(admin, userId, row.id, { state: "kept" }, nowMs); return "kept"; }
  const rm = await admin.storage.from(BUCKET).remove([uploadPath(userId, row.id, row.mime_type)]);
  if (rm.error) return "skipped";
  await settleUpload(admin, userId, row.id, { state: "abandoned" }, nowMs);
  await pruneSettledUploads(admin, userId, nowMs);
  return "abandoned";
}

// ── SALE-2026-11 R2 / SALE-10: TRANSFER CHECKS (migration 970) ──────────────────────────────────────────────────────────
//
// One row per question of a revision session asked as a transfer check: the topic, the lesson context it is outside, and how
// the question is outside it. The answers are the ordinary 416 attempts naming the session (revision_session_id, 417). Before
// 970 is applied the table is absent: listTransferChecks answers not provisioned and recordTransferCheck "not_provisioned",
// so the route offers no transfer check and the learning state reads no transfer evidence (fail closed).
export type TransferCheckRow = { sessionId: string; questionId: string; topic: string; outside: string; source: string; contextChunkIds: string[]; createdAt: string };

export async function listTransferChecks(admin: Admin, userId: string, o: { sinceIso?: string; sessionId?: string; limit?: number } = {}): Promise<Read<TransferCheckRow[]>> {
  let q = admin.from("individual_scholar_transfer_check").select("revision_session_id, question_id, topic, outside, source, context_chunk_ids, created_at").eq("user_id", userId);
  if (o.sinceIso) q = q.gte("created_at", o.sinceIso);
  if (o.sessionId) q = q.eq("revision_session_id", o.sessionId);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(Math.min(2000, o.limit ?? 500));
  if (error) return fail(error);
  return {
    ok: true,
    data: ((data ?? []) as any[]).map(r => ({
      sessionId: String(r.revision_session_id), questionId: String(r.question_id), topic: String(r.topic), outside: String(r.outside), source: String(r.source),
      contextChunkIds: Array.isArray(r.context_chunk_ids) ? r.context_chunk_ids.map(String) : [], createdAt: String(r.created_at),
    })),
  };
}

/** Records a transfer check: one row per question of the session. The 970 foreign keys refuse a question not in that learner's session. */
export async function recordTransferCheck(admin: Admin, userId: string, rows: readonly { sessionId: string; questionId: string; topic: string; outside: string; source: string; contextChunkIds: readonly string[] }[]): Promise<"ok" | "not_provisioned" | "failed"> {
  if (!rows.length) return "failed";
  const { error } = await admin.from("individual_scholar_transfer_check").insert(rows.slice(0, 10).map(r => ({
    user_id: userId, revision_session_id: r.sessionId, question_id: r.questionId, topic: r.topic, outside: r.outside, source: r.source,
    context_chunk_ids: [...new Set(r.contextChunkIds.filter(isUuid))].slice(0, 200),
  })));
  if (!error) return "ok";
  return isNotProvisioned(error) ? "not_provisioned" : "failed";
}

/** The attempts made in these revision sessions (416 revision_session_id): which attempt answered which question in which session. */
export async function sessionAttemptIds(admin: Admin, userId: string, sessionIds: readonly string[]): Promise<Read<{ id: string; questionId: string; sessionId: string; answeredAt: string }[]>> {
  const ids = [...new Set(sessionIds.filter(isUuid))].slice(0, 500);
  if (!ids.length) return { ok: true, data: [] };
  const out: { id: string; questionId: string; sessionId: string; answeredAt: string }[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await admin.from("individual_scholar_attempt").select("id, question_id, revision_session_id, answered_at").eq("user_id", userId).in("revision_session_id", ids.slice(i, i + 150)).limit(2000);
    if (error) return fail(error);
    for (const r of (data ?? []) as any[]) out.push({ id: String(r.id), questionId: String(r.question_id), sessionId: String(r.revision_session_id), answeredAt: String(r.answered_at) });
  }
  return { ok: true, data: out };
}

// ── SALE-2026-11 R4 (SALE-13 / SALE-14): THE ROWS BEHIND APPLICATION EVIDENCE AND THE LEARNING-EVIDENCE VIEW ── read only ──
//
// Owner-keyed throughout, bounded, newest first. Nothing is written. A source whose migration is absent reads as none
// (810 kept case attempts, 720 OSCE, 791/990/991 snapshots); a failed read is not ok (the caller says "could not be read").
// application-evidence-data.ts turns these rows into records; application-evidence.ts holds every rule.

export type ApplicationCaseRow = {
  snapshotId: string; kind: "private" | "library"; sessionId: string; caseRef: string; completedAt: string;
  title: string | null; decisions: any[]; escalations: any[] | null; competencies: any[] | null;
  corrections: { decisionPointId: string; correctedOutcome: string; correctedScore: number | null }[];
};
export type ApplicationRows = {
  cases: ApplicationCaseRow[];
  /** private session id -> its case (material and the competencies the case was made for, 435 individual_scholar_case_competency). */
  privateCases: Map<string, { caseId: string; materialId: string | null; competencyIds: string[] }>;
  osce: { attemptId: string; stationId: string; score: number | null; marking: string | null; finishedAt: string }[];
  stations: Map<string, { title: string; competencyId: string | null; materialId: string | null; chunkId: string | null }>;
};

const noRows = () => Promise.resolve({ data: [] as unknown, error: null as any });

export async function applicationEvidenceRows(admin: Admin, userId: string, o: { maxCases: number; maxOsce: number }): Promise<Read<ApplicationRows>> {
  const soft = async (q: PromiseLike<{ data: unknown; error: any }>) => { const r = await q; return r.error && isNotProvisioned(r.error) ? { data: [], error: null } : r; };
  const [snaps, osce] = await Promise.all([
    soft(admin.from("individual_scholar_case_attempt_snapshot")
      .select("id, session_kind, private_session_id, library_session_id, case_ref, completed_at, title:record->>title, decisions:record->decisions, escalations:record->simulation->escalations, competencies:record->competencies")
      .eq("user_id", userId).order("completed_at", { ascending: false }).limit(Math.min(Math.max(1, o.maxCases), 200))),
    soft(admin.from("individual_scholar_osce_attempt").select("id, station_id, score, marking, finished_at").eq("user_id", userId).eq("status", "finished")
      .not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(Math.min(Math.max(1, o.maxOsce), 200))),
  ]);
  if (snaps.error) return fail(snaps.error);
  if (osce.error) return fail(osce.error);
  const snapRows = (snaps.data ?? []) as any[];
  const osceRows = (osce.data ?? []) as any[];
  const snapIds = snapRows.map(r => r.id).filter(isUuid);
  const privSessions = [...new Set(snapRows.map(r => r.private_session_id).filter(isUuid))];
  const stationIds = [...new Set(osceRows.map(r => r.station_id).filter(isUuid))];
  const [corr, sess, st] = await Promise.all([
    snapIds.length ? soft(admin.from("individual_scholar_case_attempt_correction").select("snapshot_id, decision_point_id, corrected_outcome, corrected_score, created_at")
      .eq("user_id", userId).in("snapshot_id", snapIds).order("created_at")) : noRows(),
    privSessions.length ? soft(admin.from("individual_scholar_case_session").select("id, private_case_id").eq("user_id", userId).in("id", privSessions)) : noRows(),
    stationIds.length ? soft(admin.from("individual_scholar_osce_station").select("id, title, competency_id, material_id, chunk_id").eq("user_id", userId).in("id", stationIds)) : noRows(),
  ]);
  const err = [corr, sess, st].find(r => r.error)?.error;
  if (err) return fail(err);
  const caseOf = new Map(((sess.data ?? []) as any[]).map(r => [r.id as string, r.private_case_id as string]));
  const caseIds = [...new Set([...caseOf.values()].filter(isUuid))];
  const [cases, comps] = await Promise.all([
    caseIds.length ? soft(admin.from("individual_scholar_case").select("id, material_id").eq("user_id", userId).in("id", caseIds)) : noRows(),
    caseIds.length ? soft(admin.from("individual_scholar_case_competency").select("case_id, competency_id").eq("user_id", userId).in("case_id", caseIds)) : noRows(),
  ]);
  const err2 = [cases, comps].find(r => r.error)?.error;
  if (err2) return fail(err2);
  const material = new Map(((cases.data ?? []) as any[]).map(r => [r.id as string, (r.material_id ?? null) as string | null]));
  const compsOf = new Map<string, string[]>();
  for (const r of (comps.data ?? []) as any[]) if (isUuid(r.competency_id)) compsOf.set(r.case_id, [...(compsOf.get(r.case_id) ?? []), r.competency_id]);
  const corrOf = new Map<string, ApplicationCaseRow["corrections"]>();
  for (const r of (corr.data ?? []) as any[]) corrOf.set(r.snapshot_id, [...(corrOf.get(r.snapshot_id) ?? []), { decisionPointId: String(r.decision_point_id), correctedOutcome: String(r.corrected_outcome), correctedScore: r.corrected_score === null || r.corrected_score === undefined ? null : Number(r.corrected_score) }]);
  const privateCases = new Map<string, { caseId: string; materialId: string | null; competencyIds: string[] }>();
  for (const [sid, cid] of caseOf) privateCases.set(sid, { caseId: cid, materialId: material.get(cid) ?? null, competencyIds: compsOf.get(cid) ?? [] });
  return {
    ok: true,
    data: {
      cases: snapRows.map(r => ({
        snapshotId: r.id, kind: r.session_kind === "library" ? "library" as const : "private" as const, sessionId: r.private_session_id ?? r.library_session_id, caseRef: String(r.case_ref ?? ""),
        completedAt: r.completed_at, title: typeof r.title === "string" ? r.title : null, decisions: Array.isArray(r.decisions) ? r.decisions : [],
        escalations: Array.isArray(r.escalations) ? r.escalations : null, competencies: Array.isArray(r.competencies) ? r.competencies : null, corrections: corrOf.get(r.id) ?? [],
      })),
      privateCases,
      osce: osceRows.map(r => ({ attemptId: r.id, stationId: r.station_id, score: r.score === null || r.score === undefined ? null : Number(r.score), marking: r.marking ?? null, finishedAt: r.finished_at })),
      stations: new Map(((st.data ?? []) as any[]).map(r => [r.id as string, { title: String(r.title ?? ""), competencyId: isUuid(r.competency_id) ? r.competency_id as string : null, materialId: r.material_id ?? null, chunkId: r.chunk_id ?? null }])),
    },
  };
}

/**
 * SALE-14: the caller's kept question snapshots that name a competency (791, with 990/991 provenance where present), newest first,
 * with the latest correction of each (an append-only correction replaces the result shown; the original is never overwritten).
 */
export type CompetencySnapshotRow = {
  attemptId: string; questionId: string; stem: string | null; assessedAt: string; outcome: string; score: number | null; marking: string | null;
  competencyIds: string[]; provenance: any[] | null;
};
export async function competencyAttemptSnapshots(admin: Admin, userId: string, limit = 200): Promise<Read<CompetencySnapshotRow[]>> {
  const read = (cols: string) => admin.from("individual_scholar_attempt_snapshot").select(cols).eq("user_id", userId).neq("competency_ids", "{}")
    .order("assessed_at", { ascending: false }).limit(Math.min(Math.max(1, limit), 500));
  const base = "attempt_id, question_id, assessed_at, outcome, score, marking, competency_ids, stem:presented->>stem";
  let { data, error } = await read(`${base}, competency_provenance`);
  if (error && isMissingColumn(error)) ({ data, error } = await read(base));
  if (error) return isNotProvisioned(error) ? { ok: true, data: [] } : fail(error);
  const rows = (data ?? []) as any[];
  const ids = rows.map(r => r.attempt_id).filter(isUuid);
  const latest = new Map<string, { outcome: string; score: number | null }>();
  if (ids.length) {
    const c = await admin.from("individual_scholar_attempt_correction").select("attempt_id, corrected_outcome, corrected_score, created_at").eq("user_id", userId).in("attempt_id", ids).order("created_at");
    if (c.error && !isNotProvisioned(c.error)) return fail(c.error);
    for (const r of (c.data ?? []) as any[]) latest.set(r.attempt_id, { outcome: String(r.corrected_outcome), score: r.corrected_score === null || r.corrected_score === undefined ? null : Number(r.corrected_score) });
  }
  return {
    ok: true,
    data: rows.map(r => {
      const fix = latest.get(r.attempt_id);
      return {
        attemptId: r.attempt_id, questionId: String(r.question_id ?? r.attempt_id), stem: typeof r.stem === "string" ? r.stem : null, assessedAt: r.assessed_at,
        outcome: fix?.outcome ?? String(r.outcome ?? "unmarked"), score: fix ? fix.score : r.score === null || r.score === undefined ? null : Number(r.score),
        marking: r.marking ?? null, competencyIds: Array.isArray(r.competency_ids) ? (r.competency_ids as unknown[]).filter(isUuid) as string[] : [],
        provenance: Array.isArray(r.competency_provenance) ? r.competency_provenance : null,
      };
    }),
  };
}

// ── SCHOLAR-SEARCH-HISTORY-01: MY SEARCH HISTORY (migration 992) ── owner directive 4 Nov 2026, P1 ──────────────────────────
//
// The learner's own history (search-history.ts is the model). Every statement keyed on the caller's id, and 992's composite
// foreign keys refuse a reference to another learner's material, saved teaching or lesson. Captured entries keep the
// learner's submitted words and references, never an answer; recovered records are read at request time and only MARKED
// (pinned, removed), never changed. Idempotent: one row per (learner, request key). Fails closed without 992
// (historySchema false: the page says so, the route answers 409, a capture keeps nothing). Never read by Personal AI,
// Professional, an employer, an educator or the HQ plane (search-history.test.ts and the plane-boundary scan hold that).
const SH_TABLE = "individual_scholar_search_history";
const SH_LIST = "individual_scholar_search_history_list";
const SH_CLEAR = "individual_scholar_search_history_clear";
const SH_NIL = "00000000-0000-0000-0000-000000000000";

let history992: boolean | null = null;
/** True once 992's list function answers. Missing is remembered; a transient error is "no" for now and asked again. */
export async function historySchema(admin: Admin): Promise<boolean> {
  if (history992 !== null) return history992;
  const { error } = await admin.rpc(SH_LIST, { p_user_id: SH_NIL, p_query: null, p_activity: null, p_material: null, p_topic: null, p_from: null, p_to: null, p_pinned: false, p_limit: 1, p_offset: 0 });
  if (!error) return (history992 = true);
  if (isMissingRpc(error)) return (history992 = false);
  return false;
}
/** Tests only: forget what was detected. */
export const resetSearchHistorySchema = (v: boolean | null = null) => { history992 = v; };

/* eslint-disable @typescript-eslint/no-explicit-any */
const shEntry = (r: any): HistoryEntry => ({
  key: String(r.entry_key), origin: r.origin === "captured" ? "captured" : "recovered",
  activity: ((HISTORY_ACTIVITIES as readonly string[]).includes(r.activity) ? r.activity : "teaching") as HistoryActivity,
  query: r.query ?? null, topic: r.topic ?? null, materialId: r.material_id ?? null, chunkId: r.chunk_id ?? null, artefactId: r.artefact_id ?? null,
  sessionId: r.session_id ?? null, step: Number.isInteger(r.step) ? r.step : null, resultCount: Number.isInteger(r.result_count) ? r.result_count : null,
  label: String(r.label ?? ""), headline: r.headline ?? null, pinnedAt: r.pinned_at ?? null, createdAt: String(r.created_at),
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/** SCHOLAR-ASK-SOURCES-01: where each captured question looked, on the entries shown. Reading aid only: unreadable or before 999, none. */
export async function withHistorySources(admin: Admin, userId: string, entries: HistoryEntry[]): Promise<HistoryEntry[]> {
  const ids = entries.filter(e => e.origin === "captured" && e.activity === "ask" && e.key.startsWith("h:")).map(e => e.key.slice(2));
  if (!ids.length) return entries;
  const { data, error } = await admin.from(SH_TABLE).select("id, sources").eq("user_id", userId).in("id", ids);
  if (error) return entries;
  const by = new Map(((data ?? []) as { id: string; sources: unknown }[]).map(r => [`h:${r.id}`, parseAskSources(r.sources)]));
  return entries.map(e => by.get(e.key)?.length ? { ...e, sources: by.get(e.key) } : e);
}

/** One page of the caller's history, newest first, with the total that matches. */
export async function listSearchHistory(admin: Admin, userId: string, q: HistoryQuery, opts: { pinnedOnly?: boolean; limit?: number } = {}): Promise<Read<{ entries: HistoryEntry[]; total: number }>> {
  if (!(await historySchema(admin))) return { ok: false, notProvisioned: true };
  const { fromIso, toIso } = rangeBounds(q.from, q.to);
  const limit = Math.min(Math.max(opts.limit ?? HISTORY_PAGE_SIZE, 1), 50);
  const offset = opts.pinnedOnly ? 0 : (q.page - 1) * limit;
  const read = async (activity: HistoryActivity | null, size: number, from: number): Promise<Read<{ entries: HistoryEntry[]; total: number }>> => {
    const { data, error } = await admin.rpc(SH_LIST, {
      p_user_id: userId, p_query: q.q || null, p_activity: activity, p_material: q.material, p_topic: q.topic,
      p_from: fromIso, p_to: toIso, p_pinned: opts.pinnedOnly ?? q.pinned, p_limit: size, p_offset: from,
    });
    if (error) { if (isMissingRpc(error)) history992 = false; return { ok: false, notProvisioned: isMissingRpc(error) }; }
    const rows = (data ?? []) as unknown[];
    return { ok: true, data: { entries: rows.map(shEntry), total: Number((rows[0] as { total?: unknown } | undefined)?.total ?? 0) } };
  };
  const activities = q.show ? SHOW_ACTIVITIES[q.show] : null;
  if (!activities || activities.length === 1) return read(activities?.[0] ?? null, limit, offset);
  // A chip across two activities: 992 lists one at a time, so read each list as far as this page needs and merge them (50 a read, the
  // function's own limit; the page number is capped, so this is bounded).
  const lists: HistoryEntry[][] = [];
  let total = 0;
  for (const activity of activities) {
    const rows: HistoryEntry[] = [];
    for (let from = 0; from < offset + limit; from += 50) {
      const r = await read(activity, 50, from);
      if (!r.ok) return r;
      rows.push(...r.data.entries);
      if (from === 0) total += r.data.total;
      if (r.data.entries.length < 50) break;
    }
    lists.push(rows);
  }
  return { ok: true, data: { entries: mergeHistoryPages(lists, offset, limit), total } };
}

/** The topics the caller's history can be filtered by: the topics of their captured entries and of their lessons. */
export async function searchHistoryTopics(admin: Admin, userId: string): Promise<string[]> {
  const [h, s] = await Promise.all([
    admin.from(SH_TABLE).select("topic").eq("user_id", userId).eq("origin", "captured").not("topic", "is", null).limit(1000),
    admin.from("individual_scholar_learning_session").select("topic").eq("user_id", userId).not("topic", "is", null).limit(1000),
  ]);
  const seen = new Map<string, string>();
  for (const r of [...((h.data ?? []) as { topic: string }[]), ...((s.data ?? []) as { topic: string }[])]) {
    const t = String(r.topic ?? "").trim();
    if (t.length >= 2 && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b)).slice(0, 200);
}

export type SearchCaptureOutcome = "kept" | "existing" | "repeat" | "not_provisioned" | "error";

/**
 * Keep one submitted search or question. References that are not the caller's own are DROPPED (no disclosure, nothing
 * stored about them). The topic is the request's, else the lesson's. Idempotent: a retry with the same key is "existing";
 * the same words of the same activity within two minutes are "repeat" (one entry).
 */
export async function recordSearchCapture(admin: Admin, userId: string, e: CaptureInput, nowIso: string): Promise<SearchCaptureOutcome> {
  if (!(await historySchema(admin))) return "not_provisioned";
  const [session, material, chunk, artefact, latest] = await Promise.all([
    e.sessionId ? admin.from("individual_scholar_learning_session").select("id, topic").eq("user_id", userId).eq("id", e.sessionId).maybeSingle() : null,
    e.materialId ? admin.from("individual_scholar_material").select("id").eq("user_id", userId).eq("id", e.materialId).maybeSingle() : null,
    e.chunkId ? admin.from("individual_scholar_chunk").select("id, material_id").eq("user_id", userId).eq("id", e.chunkId).maybeSingle() : null,
    e.artefactId ? admin.from("individual_scholar_artefact").select("id").eq("user_id", userId).eq("id", e.artefactId).maybeSingle() : null,
    admin.from(SH_TABLE).select("activity, query, created_at, request_key").eq("user_id", userId).eq("origin", "captured").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (latest?.error && isNotProvisioned(latest.error)) { history992 = false; return "not_provisioned"; }
  const last = latest?.data as { activity: string; query: string | null; created_at: string; request_key: string } | null;
  if (last?.request_key === e.requestKey) return "existing";
  if (repeatsLatest(last ? { activity: last.activity, query: last.query, createdAt: last.created_at } : null, e, nowIso)) {
    // SCHOLAR-ASK-SOURCES-01: the same words asked of different sources are a new question, not a double submit. Unreadable or before 999: a repeat, as before.
    const was = e.sources?.length && last ? await admin.from(SH_TABLE).select("sources").eq("user_id", userId).eq("request_key", last.request_key).maybeSingle() : null;
    const before = was && !was.error ? parseAskSources((was.data as { sources?: unknown } | null)?.sources) : [];
    if (!(before.length && before.join() !== (e.sources ?? []).join())) return "repeat";
  }
  const s = session?.data as { id: string; topic: string | null } | null;
  const c = chunk?.data as { id: string; material_id: string } | null;
  const materialId = (material?.data as { id: string } | null)?.id ?? c?.material_id ?? null;
  const topic = e.topic ?? (s?.topic && s.topic.trim().length >= 2 ? s.topic.trim().slice(0, 120) : null);
  const row = {
    user_id: userId, origin: "captured", activity: e.activity, query: e.query, topic, material_id: materialId,
    chunk_id: c?.id ?? null, artefact_id: (artefact?.data as { id: string } | null)?.id ?? null, session_id: s?.id ?? null,
    step: s ? e.step : null, result_count: e.resultCount, request_key: e.requestKey,
  };
  // SCHOLAR-ASK-SOURCES-01: where the question looked (999). Before 999 is applied the question is still kept, without them.
  let { data, error } = await admin.from(SH_TABLE).upsert(e.sources?.length ? { ...row, sources: e.sources } : row, { onConflict: "user_id,request_key", ignoreDuplicates: true }).select("id");
  if (error && e.sources?.length && /sources/i.test(String(error.message ?? ""))) ({ data, error } = await admin.from(SH_TABLE).upsert(row, { onConflict: "user_id,request_key", ignoreDuplicates: true }).select("id"));
  if (error) { if (isNotProvisioned(error)) history992 = false; return isNotProvisioned(error) ? "not_provisioned" : "error"; }
  return (data ?? []).length ? "kept" : "existing";
}

type ShChange = "ok" | "not_found" | "error";

/** Is the recovered record the caller's own (current saved teaching, or a lesson)? */
async function shOwnsRecord(admin: Admin, userId: string, ref: { kind: "artefact" | "lesson"; id: string }): Promise<boolean | null> {
  const { data, error } = ref.kind === "artefact"
    ? await admin.from("individual_scholar_artefact").select("id").eq("user_id", userId).eq("id", ref.id).maybeSingle()
    : await admin.from("individual_scholar_learning_session").select("id").eq("user_id", userId).eq("id", ref.id).maybeSingle();
  return error ? null : !!data;
}
const shMarkRow = (userId: string, ref: { kind: "artefact" | "lesson"; id: string }) => ({
  user_id: userId, origin: "recovered", activity: ref.kind === "artefact" ? "teaching" : "lesson",
  artefact_id: ref.kind === "artefact" ? ref.id : null, session_id: ref.kind === "lesson" ? ref.id : null, request_key: markKey(ref),
});

/** Pin or unpin one entry. A recovered record is pinned by a mark (created on demand, removed again when nothing is left on it). */
export async function setSearchHistoryPinned(admin: Admin, userId: string, ref: EntryRef, pinned: boolean, nowIso: string): Promise<ShChange> {
  if (ref.kind === "captured") {
    const { data, error } = await admin.from(SH_TABLE).update({ pinned_at: pinned ? nowIso : null }).eq("user_id", userId).eq("origin", "captured").eq("id", ref.id).select("id");
    return error ? "error" : (data ?? []).length ? "ok" : "not_found";
  }
  const owns = await shOwnsRecord(admin, userId, ref);
  if (owns === null) return "error";
  if (!owns) return "not_found";
  const { data: mark, error: mErr } = await admin.from(SH_TABLE).select("id, hidden_at").eq("user_id", userId).eq("request_key", markKey(ref)).maybeSingle();
  if (mErr) return "error";
  if (mark?.hidden_at) return "not_found";
  if (pinned) {
    const { error } = await admin.from(SH_TABLE).upsert({ ...shMarkRow(userId, ref), pinned_at: nowIso, hidden_at: null }, { onConflict: "user_id,request_key" });
    return error ? "error" : "ok";
  }
  if (!mark) return "ok";
  const { error } = await admin.from(SH_TABLE).delete().eq("user_id", userId).eq("id", mark.id);
  return error ? "error" : "ok";
}

/** Remove one entry: a captured one is deleted, a recovered record is marked removed (the record itself is untouched). */
export async function removeSearchHistoryEntry(admin: Admin, userId: string, ref: EntryRef, nowIso: string): Promise<ShChange> {
  if (ref.kind === "captured") {
    const { data, error } = await admin.from(SH_TABLE).delete().eq("user_id", userId).eq("origin", "captured").eq("id", ref.id).select("id");
    return error ? "error" : (data ?? []).length ? "ok" : "not_found";
  }
  const owns = await shOwnsRecord(admin, userId, ref);
  if (owns === null) return "error";
  if (!owns) return "not_found";
  const { error } = await admin.from(SH_TABLE).upsert({ ...shMarkRow(userId, ref), pinned_at: null, hidden_at: nowIso }, { onConflict: "user_id,request_key" });
  return error ? "error" : "ok";
}

/** Clear the caller's whole history in one statement (992 clear). Returns how many entries went. */
export async function clearSearchHistory(admin: Admin, userId: string): Promise<{ ok: true; cleared: number } | { ok: false }> {
  if (!(await historySchema(admin))) return { ok: false };
  const { data, error } = await admin.rpc(SH_CLEAR, { p_user_id: userId });
  return error ? { ok: false } : { ok: true, cleared: Number(data ?? 0) };
}

// ── COMPETEN-NOTEBOOK-001 P1: THE NOTEBOOK'S READS AND WRITES (migration 1000) ────────────────────────────────────────────
//
// The same table as the library's notes (820), read with the columns 1000 added. Every statement is keyed on the caller's id, and the
// composite foreign keys refuse another learner's material, session or study session. Learner text only: nothing here calls a model.
// The audit rows (in the route) hold codes only, never a note's words.

export type NotebookNote = {
  id: string; kind: "note" | "highlight" | "summary" | "bookmark"; targetKind: "free" | "topic" | "material" | "section" | "lesson" | "artefact";
  title: string | null; body: string | null; quote: string | null; tags: string[]; pinnedAt: string | null; revision: number;
  /** Written through the Notebook. An older note keeps its 820 rules: it can move between targets, but it cannot be free-standing. */
  viaNotebook: boolean;
  artefactId: string | null; materialId: string | null; chunkId: string | null; sessionId: string | null; step: number | null;
  sectionLabel: string | null; sectionAnchor: string | null; capturedIn: string | null; competencyId: string | null; studyId: string | null; wasOn: string | null;
  /** The topic it is linked to (1001), in the words of the topic. */
  topic: string | null;
  createdAt: string; updatedAt: string;
};

const NOTEBOOK_COLS = "id, kind, target_kind, title, body, quote, tags, pinned_at, revision, client_key, artefact_id, material_id, chunk_id, session_id, step, section_label, section_anchor, captured_in, competency_id, study_id, was_on, topic, created_at, updated_at";
/* eslint-disable @typescript-eslint/no-explicit-any */
const toNotebookNote = (r: any): NotebookNote => ({
  id: r.id, kind: r.kind, targetKind: r.target_kind, title: r.title ?? null, body: r.body ?? null, quote: r.quote ?? null, tags: Array.isArray(r.tags) ? r.tags : [],
  pinnedAt: r.pinned_at ?? null, revision: Number(r.revision), viaNotebook: !!r.client_key,
  artefactId: r.artefact_id ?? null, materialId: r.material_id ?? null, chunkId: r.chunk_id ?? null, sessionId: r.session_id ?? null, step: Number.isInteger(r.step) ? r.step : null,
  sectionLabel: r.section_label ?? null, sectionAnchor: r.section_anchor ?? null, capturedIn: r.captured_in ?? null, competencyId: r.competency_id ?? null, studyId: r.study_id ?? null, wasOn: r.was_on ?? null, topic: r.topic ?? null,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

let notebook1000: boolean | null = null;
/** Whether migrations 1000 and 1001 are applied on this environment (1001 depends on 1000). A transient error is "no" for now, and asked again. */
export async function notebookSchema(admin: Admin): Promise<boolean> {
  if (notebook1000 !== null) return notebook1000;
  const { data, error } = await admin.rpc("individual_scholar_notebook_1001");
  if (!error) return (notebook1000 = data === true);
  if (isMissingRpc(error)) return (notebook1000 = false);
  return false;
}
/** Tests only: forget what was detected. */
export const resetNotebookSchema = (v: boolean | null = null) => { notebook1000 = v; };

/** Policy and schema together: the one question every page, route and shell asks. Any failure is off. */
export function notebookOffered(policy: { scholarPersonalNotebook: "on" | "off"; scholarLearningLibrary: "on" | "off" }, schema: boolean): boolean {
  return policy.scholarPersonalNotebook === "on" && policy.scholarLearningLibrary === "on" && schema;
}

const ownChunk = async (admin: Admin, userId: string, materialId: string, chunkId: string): Promise<"ok" | "not_found" | "failed"> => {
  const { data, error } = await admin.from("individual_scholar_chunk").select("id").eq("user_id", userId).eq("id", chunkId).eq("material_id", materialId).maybeSingle();
  if (error) return "failed";
  return data ? "ok" : "not_found";
};

export type CreateResult =
  | { ok: true; id: string; revision: number; existing: boolean; stored?: { body: string | null; title: string | null; tags: string[] } }
  | { ok: false; error: "not_found" | "limit" | "failed" };

/**
 * The first save of a note. A retry with the same client key finds the note it already made and says what it holds, so the page can send
 * only what is newer. Never a second note.
 */
export async function createNotebookNote(admin: Admin, userId: string, n: CreateInput): Promise<CreateResult> {
  const link = n.context.link;
  if ((link.targetKind === "section" || link.targetKind === "lesson") && link.chunkId) {
    const own = await ownChunk(admin, userId, link.materialId!, link.chunkId);
    if (own !== "ok") return { ok: false, error: own };
  }
  const { count, error: cErr } = await admin.from("individual_scholar_note").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (cErr) return { ok: false, error: "failed" };
  if ((count ?? 0) >= NOTE_MAX_PER_LEARNER) return { ok: false, error: "limit" };
  const row = {
    user_id: userId, kind: "note", body: n.body, quote: null, client_key: n.clientKey, title: n.title, tags: n.tags,
    ...linkColumns(link),
    section_label: n.context.sectionLabel, section_anchor: n.context.sectionAnchor, captured_in: n.context.capturedIn, study_id: n.context.studyId,
  };
  const { data, error } = await admin.from("individual_scholar_note").insert({ ...row, user_id: userId }).select("id, revision").single();
  if (!error) return { ok: true, id: data.id, revision: Number(data.revision), existing: false };
  const code = String(error.code ?? "");
  if (code === "23505") {
    const { data: had, error: hErr } = await admin.from("individual_scholar_note").select("id, revision, body, title, tags").eq("user_id", userId).eq("client_key", n.clientKey).maybeSingle();
    if (hErr || !had) return { ok: false, error: "failed" };
    return { ok: true, id: had.id, revision: Number(had.revision), existing: true, stored: { body: had.body ?? null, title: had.title ?? null, tags: had.tags ?? [] } };
  }
  return { ok: false, error: code === "23503" ? "not_found" : "failed" };
}

export type UpdateResult =
  | { ok: true; id: string; revision: number }
  /** not_found: the note. target: what it was being linked to. The page treats them very differently. */
  | { ok: false; error: "not_found" | "target" | "invalid" | "failed" }
  | { ok: false; error: "conflict"; current: { body: string | null; title: string | null; tags: string[]; revision: number } };

/** A change to one of the caller's notes, made from the revision they hold. A different revision changes nothing and returns the stored copy. */
export async function updateNotebookNote(admin: Admin, userId: string, id: string, p: PatchInput, now: Date = new Date()): Promise<UpdateResult> {
  if (!isUuid(id)) return { ok: false, error: "not_found" };
  const set: Record<string, unknown> = {};
  if (p.body !== undefined) set.body = p.body;
  if (p.title !== undefined) set.title = p.title;
  if (p.tags !== undefined) set.tags = p.tags;
  if (p.pinned !== undefined) set.pinned_at = p.pinned ? now.toISOString() : null;
  if (p.competencyId !== undefined) set.competency_id = p.competencyId;
  if (p.studyId !== undefined) set.study_id = p.studyId;
  if (p.link) {
    if ((p.link.targetKind === "section" || p.link.targetKind === "lesson") && p.link.chunkId) {
      const own = await ownChunk(admin, userId, p.link.materialId!, p.link.chunkId);
      if (own !== "ok") return { ok: false, error: own === "not_found" ? "target" : "failed" };
    }
    Object.assign(set, linkColumns(p.link), { section_label: p.sectionLabel ?? null, section_anchor: p.sectionAnchor ?? null, was_on: null });
  }
  if (!Object.keys(set).length) return { ok: false, error: "invalid" };
  const { data, error } = await admin.from("individual_scholar_note").update(set).eq("user_id", userId).eq("id", id).eq("revision", p.expectedRevision).neq("kind", "bookmark").select("id, revision");
  if (error) {
    const code = String(error.code ?? "");
    return { ok: false, error: code === "23514" ? "invalid" : code === "23503" ? "target" : "failed" };
  }
  if ((data ?? []).length) return { ok: true, id: data[0].id, revision: Number(data[0].revision) };
  const { data: had, error: hErr } = await admin.from("individual_scholar_note").select("kind, revision, body, title, tags").eq("user_id", userId).eq("id", id).maybeSingle();
  if (hErr) return { ok: false, error: "failed" };
  if (!had || had.kind === "bookmark") return { ok: false, error: "not_found" };
  return { ok: false, error: "conflict", current: { body: had.body ?? null, title: had.title ?? null, tags: had.tags ?? [], revision: Number(had.revision) } };
}

/** One of the caller's notes (never a bookmark, which has no words). */
export async function getNotebookNote(admin: Admin, userId: string, id: string): Promise<Read<NotebookNote | null>> {
  if (!isUuid(id)) return { ok: true, data: null };
  const { data, error } = await admin.from("individual_scholar_note").select(NOTEBOOK_COLS).eq("user_id", userId).eq("id", id).neq("kind", "bookmark").maybeSingle();
  if (error) return fail(error);
  return { ok: true, data: data ? toNotebookNote(data) : null };
}

export type NotebookFilter = { pinned?: boolean; tag?: string | null; materialId?: string | null; free?: boolean; topic?: string | null };

/** The caller's notes, last changed first, or pinned first-pinned-newest. A page of `limit`, and whether there is more. */
export async function listNotebookNotes(admin: Admin, userId: string, o: NotebookFilter & { limit: number; offset?: number }): Promise<Read<{ rows: NotebookNote[]; more: boolean }>> {
  const offset = Math.max(o.offset ?? 0, 0);
  let q = admin.from("individual_scholar_note").select(NOTEBOOK_COLS).eq("user_id", userId).neq("kind", "bookmark");
  if (o.pinned) q = q.not("pinned_at", "is", null);
  if (o.tag) q = q.contains("tags", [o.tag]);
  if (o.materialId && isUuid(o.materialId)) q = q.eq("material_id", o.materialId);
  if (o.free) q = q.eq("target_kind", "free");
  if (o.topic) q = q.eq("topic", o.topic);
  q = o.pinned ? q.order("pinned_at", { ascending: false }) : q.order("updated_at", { ascending: false });
  const { data, error } = await q.order("id", { ascending: false }).range(offset, offset + o.limit);
  if (error) return fail(error);
  const rows = (data ?? []) as any[];
  return { ok: true, data: { rows: rows.slice(0, o.limit).map(toNotebookNote), more: rows.length > o.limit } };
}

/** Notes written on one lesson of a session, or on any of its sections from elsewhere. Oldest first, so they read in the order they were written. */
export async function lessonNotes(admin: Admin, userId: string, o: { sessionId: string; step: number; chunkIds: readonly string[] }): Promise<Read<NotebookNote[]>> {
  if (!isUuid(o.sessionId)) return { ok: true, data: [] };
  const chunks = o.chunkIds.filter(isUuid).slice(0, 100);
  const filter = [`and(session_id.eq.${o.sessionId},step.eq.${o.step})`, ...(chunks.length ? [`chunk_id.in.(${chunks.join(",")})`] : [])].join(",");
  const { data, error } = await admin.from("individual_scholar_note").select(NOTEBOOK_COLS).eq("user_id", userId).in("kind", ["note", "summary"]).or(filter).order("created_at", { ascending: true }).limit(200);
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(toNotebookNote) };
}

export type NotebookHit = { note: NotebookNote; headline: string };
/** Deterministic full-text search over the caller's own notes (1000): each word as a prefix, best first. No AI. */
export async function searchNotebook(admin: Admin, userId: string, query: string, limit: number, offset: number): Promise<Read<{ hits: NotebookHit[]; total: number }>> {
  const { data, error } = await admin.rpc("individual_scholar_notebook_search", { p_user_id: userId, p_query: query.slice(0, 200), p_limit: limit, p_offset: offset });
  if (error) return fail(error);
  const found = (data ?? []) as { id: string; headline: string; total: number | string }[];
  if (!found.length) return { ok: true, data: { hits: [], total: 0 } };
  const { data: rows, error: rErr } = await admin.from("individual_scholar_note").select(NOTEBOOK_COLS).eq("user_id", userId).in("id", found.map(f => f.id));
  if (rErr) return fail(rErr);
  const byId = new Map(((rows ?? []) as any[]).map(r => [r.id, toNotebookNote(r)]));
  return { ok: true, data: { total: Number(found[0].total ?? 0), hits: found.flatMap(f => { const note = byId.get(f.id); return note ? [{ note, headline: String(f.headline ?? "") }] : []; }) } };
}

/** The topics the caller has linked notes to, for the page's filter. */
export async function notebookTopics(admin: Admin, userId: string): Promise<string[]> {
  const { data, error } = await admin.from("individual_scholar_note").select("topic").eq("user_id", userId).eq("target_kind", "topic").order("updated_at", { ascending: false }).limit(500);
  if (error) return [];
  return [...new Set(((data ?? []) as { topic: string }[]).map(r => r.topic))].slice(0, 30);
}

/** The tags the caller has used, most used first (read from their newest notes). */
export async function notebookTags(admin: Admin, userId: string): Promise<string[]> {
  const { data, error } = await admin.from("individual_scholar_note").select("tags").eq("user_id", userId).neq("tags", "{}").order("updated_at", { ascending: false }).limit(1000);
  if (error) return [];
  const count = new Map<string, number>();
  for (const r of (data ?? []) as { tags: string[] }[]) for (const t of r.tags ?? []) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t).slice(0, 40);
}

/** Every note and highlight of the caller's, for their own export. In pages, so a large notebook is not cut off. */
export async function allNotebookNotes(admin: Admin, userId: string, max = 5000): Promise<Read<NotebookNote[]>> {
  const out: NotebookNote[] = [];
  for (let from = 0; from < max; from += 500) {
    const { data, error } = await admin.from("individual_scholar_note").select(NOTEBOOK_COLS).eq("user_id", userId).neq("kind", "bookmark").order("updated_at", { ascending: false }).order("id", { ascending: false }).range(from, from + 499);
    if (error) return fail(error);
    const rows = (data ?? []) as any[];
    out.push(...rows.map(toNotebookNote));
    if (rows.length < 500) break;
  }
  return { ok: true, data: out };
}
