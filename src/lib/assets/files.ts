/* eslint-disable @typescript-eslint/no-explicit-any */
// CAP-001 Phase 4 — binary/object storage helpers. Bytes live in the private Supabase Storage bucket
// "asset-files"; downloads go only through short-lived signed URLs issued server-side (mirrors the evidence
// engine). The bucket is auto-created on first use so no manual dashboard step is needed.

export const ASSET_BUCKET = "asset-files";
export const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

// Broad allow-list for a governed asset repository: documents, images, video/audio, office files, archives.
export const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml",
  "video/mp4", "video/webm", "audio/mpeg", "audio/mp4",
  "text/plain", "text/markdown", "text/csv",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
]);

export function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-()+ ]/g, "_").slice(0, 120) || "file";
}

// Ensure the private bucket exists (idempotent). Service-role only.
export async function ensureAssetBucket(admin: any): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: buckets, error } = await admin.storage.listBuckets();
    if (error) return { ok: false, error: error.message };
    if ((buckets ?? []).some((b: any) => b.name === ASSET_BUCKET)) return { ok: true };
    const { error: mkErr } = await admin.storage.createBucket(ASSET_BUCKET, { public: false });
    if (mkErr && !/exist/i.test(mkErr.message)) return { ok: false, error: mkErr.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "storage unavailable" };
  }
}
