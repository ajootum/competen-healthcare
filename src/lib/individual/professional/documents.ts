/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { DOCUMENT_BUCKET, DOCUMENT_MAX_BYTES, DOCUMENT_MAX_LABEL, DOCUMENT_MIME } from "./vocabulary";
import { documentPath } from "./validate";

// ── DOCUMENTS ATTACHED TO THE PERSON'S OWN RECORDS ── migration 373 s7 ───────────────────────────────────
//
// ⚠ NOT THE ESTATE `evidence` BUCKET OR TABLE. An `evidence` row carries hospital_id, and the estate's
// evidence route lets a verifier in that hospital list it and sign a download. A certificate kept in
// Competen Professional must not be one consent-free join away from an employer, so it lives in its own
// private bucket, named on the person's own row, and the ONLY download path is the Professional
// documents route, after the owner check.
//
// ⚠ ATTACHING A DOCUMENT MAKES AN ITEM `source_linked`, NEVER VERIFIED. Nothing reads the document's
// contents, and nothing here claims it is genuine.

export type StoredDocument = { document_path: string; document_name: string; document_mime: string; document_bytes: number };

/** Pure: why a file cannot be attached, or null when it can. */
export function documentProblem(file: { type: string; size: number }): string | null {
  if (!(DOCUMENT_MIME as readonly string[]).includes(file.type)) return "Attach a PDF, PNG, JPEG or WebP file.";
  if (file.size <= 0 || file.size > DOCUMENT_MAX_BYTES) return `The document must be between 1 byte and ${DOCUMENT_MAX_LABEL}.`;
  return null;
}

export async function storeDocument(admin: any, userId: string, file: File): Promise<{ ok: true; doc: StoredDocument } | { ok: false; error: string }> {
  const problem = documentProblem(file);
  if (problem) return { ok: false, error: problem };
  const { path, name } = documentPath(userId, file.name, randomUUID());
  const { error } = await admin.storage.from(DOCUMENT_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
  if (error) return { ok: false, error: "The document could not be stored just now. Try again shortly." };
  return { ok: true, doc: { document_path: path, document_name: name, document_mime: file.type, document_bytes: file.size } };
}

export async function removeDocument(admin: any, path: string | null | undefined): Promise<void> {
  if (!path) return;
  try { await admin.storage.from(DOCUMENT_BUCKET).remove([path]); } catch { /* the row is gone; an orphan object is recoverable */ }
}

/** A five-minute signed download URL. The caller has already proved the row is the caller's own. */
export async function signDocument(admin: any, path: string): Promise<string | null> {
  try {
    const { data, error } = await admin.storage.from(DOCUMENT_BUCKET).createSignedUrl(path, 300);
    return error ? null : (data?.signedUrl ?? null);
  } catch { return null; }
}
