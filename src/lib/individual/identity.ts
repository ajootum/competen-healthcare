/* eslint-disable @typescript-eslint/no-explicit-any */
import { isNotProvisioned } from "./access";
import { sniffImage, stripImageMetadata, type PhotoMime } from "./image-metadata";

// ── THE SHARED IDENTITY PROFILE ── COMPETEN-INDIVIDUAL-IDENTITY-HUB-01, migration 590 ─────────────────────────────
//
// One row per person, shared by Scholar and Professional: preferred name, headline, location, biography and a
// PRIVATE photo. Everything optional and self-declared: none of it is ever verified, and none of it leaves the
// person's own pages unless they select it on a Passport link (the photo, per link: 590 include_photo).
//
// ⚠ PRIVATE BY DEFAULT. The photo lives in the private bucket individual-photos and is served only by short signed
// URLs: to the person, and on a Passport link that carries it. It is NOT profiles.avatar_url, which points at the
// estate's PUBLIC avatars bucket.
// ⚠ BEFORE 590 the hub reads "not set up" and offers nothing here: { provisioned: false }, never a failure.

export const PHOTO_BUCKET = "individual-photos";
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_EXT: Record<PhotoMime, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export type IdentityProfile = {
  preferredName: string | null; headline: string | null; location: string | null; biography: string | null;
  photoPath: string | null; photoUpdatedAt: string | null;
};
export type IdentityRead = { provisioned: false } | { provisioned: true; value: IdentityProfile | null };
const EMPTY: IdentityProfile = { preferredName: null, headline: null, location: null, biography: null, photoPath: null, photoUpdatedAt: null };

export const IDENTITY_FIELDS = { preferred_name: 80, headline: 140, location: 120, biography: 2000 } as const;
export type IdentityField = keyof typeof IDENTITY_FIELDS;
export const IDENTITY_LABEL: Record<IdentityField, string> = { preferred_name: "Preferred name", headline: "Headline", location: "Location", biography: "Biography" };

/** The person's row. null: unreadable (said so, never shown as empty). */
export async function loadIdentity(admin: any, userId: string): Promise<IdentityRead | null> {
  try {
    const { data, error } = await admin.from("individual_identity_profile")
      .select("preferred_name, headline, location, biography, photo_path, photo_updated_at").eq("user_id", userId).maybeSingle();
    if (error) return isNotProvisioned(error) ? { provisioned: false } : null;
    return { provisioned: true, value: data ? {
      preferredName: data.preferred_name, headline: data.headline, location: data.location, biography: data.biography,
      photoPath: data.photo_path, photoUpdatedAt: data.photo_updated_at,
    } : null };
  } catch { return null; }
}

/** Pure: the fields a request may change, cleaned, or why not. Unknown keys never reach the row. */
export function parseIdentityPatch(body: unknown): { ok: true; patch: Partial<Record<IdentityField, string | null>> } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const patch: Partial<Record<IdentityField, string | null>> = {};
  for (const key of Object.keys(IDENTITY_FIELDS) as IdentityField[]) {
    if (!(key in b)) continue;
    const raw = b[key];
    if (raw !== null && raw !== undefined && typeof raw !== "string") return { ok: false, error: `${IDENTITY_LABEL[key]} must be text.` };
    const v = typeof raw === "string" ? (key === "biography" ? raw.replace(/\r\n/g, "\n").trim() : raw.replace(/\s+/g, " ").trim()) : "";
    if (v.length > IDENTITY_FIELDS[key]) return { ok: false, error: `${IDENTITY_LABEL[key]} must be ${IDENTITY_FIELDS[key]} characters or fewer.` };
    patch[key] = v || null;
  }
  if (!Object.keys(patch).length) return { ok: false, error: "Nothing to update." };
  return { ok: true, patch };
}

export async function saveIdentity(admin: any, userId: string, patch: Partial<Record<IdentityField | "photo_path" | "photo_mime" | "photo_updated_at", string | null>>): Promise<"ok" | "not_provisioned" | "failed"> {
  const { error } = await admin.from("individual_identity_profile").upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  return error ? (isNotProvisioned(error) ? "not_provisioned" : "failed") : "ok";
}

/** A short-lived URL for the person's own photo, or for a Passport link that carries it. */
export async function photoUrl(admin: any, path: string | null, seconds = 300): Promise<string | null> {
  if (!path) return null;
  try {
    const { data, error } = await admin.storage.from(PHOTO_BUCKET).createSignedUrl(path, seconds);
    return error ? null : data?.signedUrl ?? null;
  } catch { return null; }
}

/**
 * Store a new photo: the container must be one of the three accepted types (whatever the browser claimed), it is
 * stripped of EXIF, XMP, IPTC and text metadata, written under the person's own folder, and the previous one is
 * removed. Returns why it was refused, or ok.
 */
export async function storePhoto(admin: any, userId: string, file: File, previous: string | null): Promise<{ ok: true; path: string; mime: PhotoMime } | { ok: false; status: number; error: string }> {
  if (file.size === 0 || file.size > PHOTO_MAX_BYTES) return { ok: false, status: 400, error: "Choose a photo under 5 MB." };
  const raw = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImage(raw);
  if (!mime) return { ok: false, status: 400, error: "Use a JPEG, PNG or WebP photo." };
  const clean = stripImageMetadata(raw, mime);
  if (!clean) return { ok: false, status: 400, error: "That photo could not be read. Try saving it again as a JPEG or PNG." };
  const path = `${userId}/photo-${Date.now()}.${PHOTO_EXT[mime]}`;
  const { error } = await admin.storage.from(PHOTO_BUCKET).upload(path, Buffer.from(clean), { contentType: mime, upsert: false });
  if (error) return { ok: false, status: 503, error: "Your photo could not be saved just now. Nothing was changed." };
  const saved = await saveIdentity(admin, userId, { photo_path: path, photo_mime: mime, photo_updated_at: new Date().toISOString() });
  if (saved !== "ok") {
    await admin.storage.from(PHOTO_BUCKET).remove([path]).catch(() => {});
    return { ok: false, status: saved === "not_provisioned" ? 409 : 503, error: saved === "not_provisioned" ? "Profile photos are not set up here yet." : "Your photo could not be saved just now. Nothing was changed." };
  }
  if (previous && previous.startsWith(`${userId}/`)) await admin.storage.from(PHOTO_BUCKET).remove([previous]).catch(() => {});
  return { ok: true, path, mime };
}

export async function removePhoto(admin: any, userId: string, current: string | null): Promise<boolean> {
  const saved = await saveIdentity(admin, userId, { photo_path: null, photo_mime: null, photo_updated_at: null });
  if (saved !== "ok") return false;
  if (current && current.startsWith(`${userId}/`)) await admin.storage.from(PHOTO_BUCKET).remove([current]).catch(() => {});
  return true;
}

export const identityOf = (r: IdentityRead | null): IdentityProfile => (r && r.provisioned && r.value ? r.value : EMPTY);
