import { randomUUID } from "node:crypto";
import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-BOOK-PROFILE-001 s4/s15 -- THE PRACTITIONER PHOTOGRAPH.
//
// A photograph of a named clinician, published to anonymous strangers. Three things follow, and each is
// a control below rather than a note:
//
//   1. THE BYTES ARE NOT TRUSTED. A declared content type is a claim by the uploader; the magic bytes
//      are checked, and anything that is not a JPEG is refused. There is no image library in this
//      deployment (no sharp, no jimp), so nothing here can re-encode -- which is exactly why the format
//      is narrowed to ONE and the file is inspected rather than believed.
//
//   2. METADATA IS STRIPPED SERVER-SIDE, NOT ASKED FOR NICELY. A phone photograph carries EXIF: GPS
//      coordinates, the device, the timestamp. Publishing a clinician's home coordinates because they
//      photographed themselves in their kitchen is a disclosure nobody consented to. The browser
//      re-encodes through a canvas (which drops EXIF), and then this file walks the JPEG segment
//      structure and removes every APPn block anyway -- because a control that only runs in the client
//      is a control an uploader can skip.
//
//   3. REMOVAL REVOKES. The object is deleted BEFORE the column is cleared, so there is no window in
//      which the database says "no photograph" while the bytes are still being served.
//
// ---- WHY A PUBLIC BUCKET, STATED RATHER THAN ASSUMED -----------------------------------------------
//
// Every other bucket in this codebase is private with signed URLs, and that is right for clinical
// documents. This content is DIFFERENT IN KIND: it exists to be shown to anonymous patients on a public
// page. A signed URL would add a storage round trip to the above-the-fold render for an image that is
// published by definition, and it would expire in the middle of somebody reading the page.
//
// The trade is named: while an object exists, anybody holding its URL can open it -- as is true of any
// image a browser has rendered. What the random path buys is that the URLs cannot be ENUMERATED, so the
// bucket is not a directory of which clinicians exist. What delete-then-clear buys is that removal is
// real. Neither pretends the image was ever secret.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const PHOTO_BUCKET = "practitioner-photos";

/** 2MB. A headshot re-encoded by the browser lands far below this; anything above is not a headshot. */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * ⚠ ONE FORMAT, DELIBERATELY. Accepting PNG and WebP as well would mean three metadata strippers to
 * keep correct with no library to lean on, and the client converts everything the browser can decode
 * into JPEG before it is sent. A narrow door is a door with fewer ways through it.
 */
export const PHOTO_CONTENT_TYPE = "image/jpeg";

/** What a rejected upload is told. Each names the fix, and none quotes a library error. */
export const PHOTO_REFUSALS = {
  EMPTY: "No image was received.",
  TOO_LARGE: `That image is larger than ${PHOTO_MAX_BYTES / (1024 * 1024)}MB. Choose a smaller one.`,
  NOT_JPEG: "That file is not a JPEG image. Photographs are saved as JPEG.",
  MALFORMED: "That image could not be read as a JPEG.",
  STORAGE: "The image could not be stored just now. Nothing has been changed.",
} as const;

/**
 * Is this actually a JPEG?
 *
 * ⚠ THE FIRST TWO BYTES, NOT THE FILE NAME AND NOT THE DECLARED TYPE. Both of those are chosen by
 * whoever is uploading. `FF D8` is the Start-of-Image marker; a JPEG cannot begin with anything else.
 */
export function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/**
 * Remove every APPn metadata segment from a JPEG, returning the image bytes.
 *
 * ⚠ WHY THIS IS SAFE TO DO BY HAND. A JPEG is a sequence of segments: `FF <marker> <2-byte length>
 * <payload>`. The APPn markers (0xE0-0xEF) carry JFIF, EXIF, XMP and colour-profile blocks -- EXIF
 * (APP1) is the one holding GPS and device data. Dropping whole segments cannot corrupt the image
 * because no other segment references them, and the decoder reads what remains exactly as before.
 *
 * ⚠ AND WHY IT STOPS AT THE SCAN. After Start-of-Scan (0xDA) the file is entropy-coded image data in
 * which 0xFF bytes are NOT markers -- they are escaped as FF 00. Walking past it looking for segments
 * would misread compressed pixels as structure. So everything from the scan onward is copied verbatim.
 *
 * Returns null when the bytes are not a JPEG this can parse, which the caller reports as a refusal
 * rather than storing something it did not understand.
 */
export function stripJpegMetadata(input: Uint8Array): Uint8Array | null {
  if (!looksLikeJpeg(input)) return null;

  const out: number[] = [0xff, 0xd8];
  let i = 2;

  while (i < input.length) {
    // Segments begin with FF. Fill bytes (FF FF) are legal padding between them.
    if (input[i] !== 0xff) return null;
    let marker = input[i + 1];
    let markerAt = i + 1;
    while (marker === 0xff && markerAt + 1 < input.length) { markerAt += 1; marker = input[markerAt]; }
    if (marker === undefined) return null;

    // Start of Scan: the rest is compressed image data (plus any trailing EOI). Copy it untouched.
    if (marker === 0xda) {
      for (let k = markerAt - 1; k < input.length; k++) out.push(input[k]);
      return Uint8Array.from(out);
    }

    // Standalone markers carry no length. Nothing here needs to be dropped, so they are copied.
    if (marker === 0xd9) { out.push(0xff, 0xd9); return Uint8Array.from(out); }
    if (marker >= 0xd0 && marker <= 0xd7) { out.push(0xff, marker); i = markerAt + 1; continue; }

    const lengthAt = markerAt + 1;
    if (lengthAt + 1 >= input.length) return null;
    const length = (input[lengthAt] << 8) | input[lengthAt + 1];
    // A segment length includes its own two bytes, so anything under two is malformed.
    if (length < 2 || lengthAt + length > input.length) return null;

    const isMetadata = marker >= 0xe0 && marker <= 0xef;
    if (!isMetadata) {
      out.push(0xff, marker);
      for (let k = lengthAt; k < lengthAt + length; k++) out.push(input[k]);
    }
    i = lengthAt + length;
  }

  // Ran out of bytes without reaching a scan: not an image this understood.
  return null;
}

/** Ensure the bucket exists. Idempotent, service-role only. */
async function ensurePhotoBucket(admin: any): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: buckets, error } = await admin.storage.listBuckets();
    if (error) return { ok: false, error: error.message };
    if ((buckets ?? []).some((b: any) => b.name === PHOTO_BUCKET)) return { ok: true };
    const { error: mkErr } = await admin.storage.createBucket(PHOTO_BUCKET, {
      // Public: see the header. The content is published to anonymous patients by definition.
      public: true,
      allowedMimeTypes: [PHOTO_CONTENT_TYPE],
      fileSizeLimit: PHOTO_MAX_BYTES,
    });
    if (mkErr && !/exist/i.test(mkErr.message)) return { ok: false, error: mkErr.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "storage unavailable" };
  }
}

/**
 * The public address of a stored photograph.
 *
 * ⚠ COMPOSED FROM THE CONFIGURED SUPABASE URL, never typed as a literal. A second spelling of this
 * address is a second thing to keep correct, and this codebase has already paid for that once with the
 * booking link.
 */
export function photoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`;
}

/**
 * Store a photograph for one practitioner, replacing any previous one.
 *
 * ⚠ THE CALLER HAS ALREADY PROVED WHO IT IS. This takes a userId that the route resolved from the
 * session -- never one from the request body -- so there is no path by which somebody sets another
 * clinician's photograph.
 */
export async function savePractitionerPhoto(admin: any, args: {
  userId: string; bytes: Uint8Array; declaredType?: string | null; correlationId: string;
}): Promise<EngineResult<{ path: string; url: string | null; bytes: number }>> {
  if (!args.bytes || args.bytes.length === 0)
    return { ok: false, status: 400, code: "EMPTY", message: PHOTO_REFUSALS.EMPTY };
  if (args.bytes.length > PHOTO_MAX_BYTES)
    return { ok: false, status: 413, code: "TOO_LARGE", message: PHOTO_REFUSALS.TOO_LARGE };
  // The declared type is checked as well as the bytes -- not instead of them. A mismatch means the
  // uploader is confused or lying, and neither is a reason to store the file.
  if (args.declaredType && args.declaredType !== PHOTO_CONTENT_TYPE)
    return { ok: false, status: 415, code: "NOT_JPEG", message: PHOTO_REFUSALS.NOT_JPEG };
  if (!looksLikeJpeg(args.bytes))
    return { ok: false, status: 415, code: "NOT_JPEG", message: PHOTO_REFUSALS.NOT_JPEG };

  const clean = stripJpegMetadata(args.bytes);
  if (!clean)
    return { ok: false, status: 415, code: "MALFORMED", message: PHOTO_REFUSALS.MALFORMED };

  const { data: identity, error: idErr } = await admin.from("practice_practitioner_identity")
    .select("id, photo_path").eq("user_id", args.userId).maybeSingle();
  if (idErr)
    return { ok: false, status: 503, code: "IDENTITY_UNREADABLE", message: `your profile could not be read: ${idErr.message}` };
  if (!identity)
    return { ok: false, status: 404, code: "NO_IDENTITY", message: "no practitioner identity has been issued" };

  const bucket = await ensurePhotoBucket(admin);
  if (!bucket.ok)
    return { ok: false, status: 503, code: "STORAGE_UNAVAILABLE", message: PHOTO_REFUSALS.STORAGE };

  // ⚠ A RANDOM PATH, NOT THE USER ID OR THE HANDLE. See migration 362: a predictable path in a public
  // bucket is an enumerable directory of which clinicians exist.
  const path = `${randomUUID()}.jpg`;
  const { error: upErr } = await admin.storage.from(PHOTO_BUCKET)
    .upload(path, clean, { contentType: PHOTO_CONTENT_TYPE, upsert: false });
  if (upErr)
    return { ok: false, status: 503, code: "STORAGE_FAILED", message: PHOTO_REFUSALS.STORAGE };

  const { error: rowErr } = await admin.from("practice_practitioner_identity")
    .update({ photo_path: path, photo_updated_at: new Date().toISOString() })
    .eq("id", identity.id);
  if (rowErr) {
    // ⚠ THE ORPHAN IS CLEANED UP RATHER THAN LEFT. The row was not changed, so an object nothing points
    // at is a published image with no owner and no way to remove it from any screen.
    await admin.storage.from(PHOTO_BUCKET).remove([path]).catch(() => {});
    return { ok: false, status: 400, code: "NOT_SAVED", message: `the image was not saved: ${rowErr.message}` };
  }

  // Only now is the previous one removed: the new photograph is live, so there is no moment with none.
  const previous = identity.photo_path as string | null;
  if (previous && previous !== path)
    await admin.storage.from(PHOTO_BUCKET).remove([previous]).catch(() => {});

  await audit(admin, {
    workspaceId: null, actorId: args.userId,
    eventType: "practice.photo_set",
    // The path, the size and whether one was replaced -- never the image, and never a caption.
    payload: { bytes: clean.length, replaced: !!previous, strippedBytes: args.bytes.length - clean.length },
    correlationId: args.correlationId,
  });

  return { ok: true, data: { path, url: photoUrl(path), bytes: clean.length } };
}

/**
 * Remove a practitioner's photograph.
 *
 * ⚠ THE OBJECT FIRST, THE COLUMN SECOND. If the delete fails the column stays, so a screen never says
 * "removed" over an image that is still being served. The reverse order would be a lie with a URL.
 */
export async function removePractitionerPhoto(admin: any, args: {
  userId: string; correlationId: string;
}): Promise<EngineResult<{ removed: boolean }>> {
  const { data: identity, error: idErr } = await admin.from("practice_practitioner_identity")
    .select("id, photo_path").eq("user_id", args.userId).maybeSingle();
  if (idErr)
    return { ok: false, status: 503, code: "IDENTITY_UNREADABLE", message: `your profile could not be read: ${idErr.message}` };
  if (!identity)
    return { ok: false, status: 404, code: "NO_IDENTITY", message: "no practitioner identity has been issued" };

  const path = identity.photo_path as string | null;
  if (!path) return { ok: true, data: { removed: false } };

  const { error: rmErr } = await admin.storage.from(PHOTO_BUCKET).remove([path]);
  if (rmErr)
    return {
      ok: false, status: 503, code: "NOT_REMOVED",
      message: `your photograph is still published, because it could not be deleted: ${rmErr.message}`,
    };

  const { error: rowErr } = await admin.from("practice_practitioner_identity")
    .update({ photo_path: null, photo_updated_at: null }).eq("id", identity.id);
  if (rowErr)
    return { ok: false, status: 400, code: "NOT_CLEARED", message: `the image was deleted and your profile still refers to it: ${rowErr.message}` };

  await audit(admin, {
    workspaceId: null, actorId: args.userId,
    eventType: "practice.photo_removed", payload: {}, correlationId: args.correlationId,
  });

  return { ok: true, data: { removed: true } };
}
