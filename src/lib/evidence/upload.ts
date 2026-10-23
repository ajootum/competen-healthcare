// The evidence upload rules (§E), in one place, for both ways a file reaches the private "evidence" bucket:
//
//   1. multipart POST /api/evidence -- the original path. The file passes through the route handler.
//   2. direct upload -- POST /api/evidence (JSON) mints a one-time signed upload URL for a path the SERVER
//      chooses, the browser uploads straight to storage, and PUT /api/evidence records the row.
//
// ⚠ WHY THE SECOND PATH EXISTS. Vercel caps a function's request body at about 4.5 MB, so path 1 cannot
// carry the 10 MB documents and 50 MB audio/video this route has always accepted: on the deployed site a
// large voice note or recording was cut off before the handler saw it, while it worked locally. Path 2
// keeps the advertised limits real. The limits, types, messages, ownership rules, row and audit entry are
// the same on both paths -- they are defined here and nowhere else.
//
// ⚠ THE PATH IS NEVER TAKEN FROM THE REQUEST. It is rebuilt from the caller's own id and a server-issued
// upload id, so a caller cannot record, or overwrite, an object under anybody else's folder.

export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // video/audio evidence (voice notes, recordings)
export const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
export const MEDIA_MIME = new Set([
  "video/mp4", "video/webm",
  "audio/mpeg", "audio/mp4", "audio/webm", "audio/wav", "audio/ogg",
]);
export const BUCKET = "evidence";

export const TYPE_ERROR = "Accepted: PDF, PNG, JPEG, WebP, MP4/WebM video, or MP3/M4A/WAV/OGG/WebM audio";

/** Why a file of this type and size cannot be evidence, or null when it can. The route's original messages. */
export function fileProblem(file: { type: string; size: number }): string | null {
  const isMedia = MEDIA_MIME.has(file.type);
  if (!ALLOWED_MIME.has(file.type) && !isMedia) return TYPE_ERROR;
  if (!(file.size > 0) || file.size > (isMedia ? MAX_MEDIA_BYTES : MAX_BYTES)) {
    return isMedia ? "Media files must be between 1 byte and 50 MB" : "File must be between 1 byte and 10 MB";
  }
  return null;
}

export function safeFileName(name: string): string {
  return name.replace(/[^\w.\-()+ ]/g, "_").slice(0, 120) || "file";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUploadId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** The object name: the owner's folder, then the upload id, then the cleaned file name -- as path 1 always wrote it. */
export function evidencePath(ownerId: string, uploadId: string, safeName: string): string {
  return `${ownerId}/${uploadId}-${safeName}`;
}
