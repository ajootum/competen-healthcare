// SCHOLAR-CE07C: the DECISIONS about an upload in flight (migration 960, individual_scholar_upload). Pure: no database,
// no storage. The statements live in the Scholar store (store.ts, "THE UPLOAD RECORD"), each keyed on the caller's own
// user_id; the hourly platform clean-up lists unfinished uploads in src/lib/individual/scholar-upload-sweep.ts and acts
// through the store.
//
// Times are the app clock on both sides (issued_at, processing_started_at are written by the app). They decide a
// stale claim or an abandoned upload, never a grant.

import type { MaterialMime } from "./config";

/** The finish may run 300 s (materials maxDuration). A claim older than this is taken over. */
export const STALE_CLAIM_MS = 330_000;
/** The TUS upload URL lives up to 24 h: an upload nobody finished in that time is abandoned. */
export const ABANDON_AFTER_MS = 24 * 3600_000;
/** Settled rows are kept a week (a late retry still gets its answer), then removed. */
export const SETTLED_RETENTION_MS = 7 * 24 * 3600_000;

export type UploadState = "issued" | "processing" | "kept" | "refused" | "cancelled" | "abandoned";
export type UploadRow = {
  id: string; user_id: string; mime_type: MaterialMime; byte_size: number; sha256: string; state: UploadState;
  issued_at: string; processing_started_at: string | null; refusal_status: number | null; refusal_message: string | null;
};

export const isSha256 = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

// ── PURE DECISIONS (tested in upload-record.test.ts) ────────────────────────────────────────────────

export type FinishDecision =
  | { kind: "proceed" }
  | { kind: "busy" }
  | { kind: "refused"; status: number; message: string }
  | { kind: "cancelled" }
  | { kind: "abandoned" }
  | { kind: "kept" };

/**
 * What a finish should do given the upload's record (null: no record, i.e. 960 absent or a slot issued before it).
 * The material-exists check comes first in the route, so "kept" here means the record says kept but the material is
 * gone (erased since): answered as not found.
 */
export function finishDecision(row: Pick<UploadRow, "state" | "processing_started_at" | "refusal_status" | "refusal_message"> | null, nowMs: number): FinishDecision {
  if (!row) return { kind: "proceed" };
  switch (row.state) {
    case "issued": return { kind: "proceed" };
    case "processing": {
      const started = row.processing_started_at ? Date.parse(row.processing_started_at) : NaN;
      return Number.isFinite(started) && nowMs - started < STALE_CLAIM_MS ? { kind: "busy" } : { kind: "proceed" };
    }
    case "refused": return { kind: "refused", status: row.refusal_status ?? 422, message: row.refusal_message ?? "That file was not kept." };
    case "cancelled": return { kind: "cancelled" };
    case "abandoned": return { kind: "abandoned" };
    case "kept": return { kind: "kept" };
  }
}

/** May an upload identity be continued with these bytes? Same type, size and sha256, still issued, not abandoned. */
export function reusable(row: Pick<UploadRow, "state" | "mime_type" | "byte_size" | "sha256" | "issued_at">, want: { mime: string; size: number; sha256: string }, nowMs: number): boolean {
  return row.state === "issued" && row.mime_type === want.mime && Number(row.byte_size) === want.size && row.sha256 === want.sha256
    && nowMs - Date.parse(row.issued_at) < ABANDON_AFTER_MS;
}

/**
 * Which objects in one person's folder are abandoned: older than 24 h, not a material's original, not an upload a
 * finish is reading now. Pure: `objects` is the storage listing, `kept` the material storage paths.
 */
export function abandonedObjects(userId: string, objects: { name: string; created_at?: string | null }[], kept: Set<string>, busy: Set<string>, nowMs: number): string[] {
  return objects
    .filter(o => o.name && !o.name.startsWith(".") && o.created_at && nowMs - Date.parse(o.created_at) >= ABANDON_AFTER_MS)
    .map(o => `${userId}/${o.name}`)
    .filter(p => !kept.has(p) && !busy.has(p));
}
