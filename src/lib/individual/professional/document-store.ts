/* eslint-disable @typescript-eslint/no-explicit-any */
import { isNotProvisioned } from "../access";
import { ORIGIN } from "./vocabulary";
import type { DraftContent } from "../documents/model";
import type { Format } from "../documents-config";

// ── DOCUMENT DRAFTS AND EXPORT RECORDS ── COMPETEN-PROFESSIONAL-PROGRESS-01 PR7 s10.5, migration 550 ──────────────────────
//
// THE ONE WRITER of 550's document tables, by the person's own id. A draft holds presentation choices and record KEYS,
// never copies (550's CHECK refuses a record entry carrying text). Editing, duplicating or deleting a draft writes this
// table only: no Professional, Learning, Competency, Evidence or Passport record is touched. An export writes one
// append-only metadata row (format, template version, sha256 of the rendered content, size, record count). The file is
// generated for the person and streamed to them: it is never stored.

export type Write = { ok: true; id: string | null } | { ok: false; status: number; error: string };
const failed = (what: string, error?: any): Write => isNotProvisioned(error)
  ? { ok: false, status: 409, error: "The Document Studio is not set up on this environment yet." }
  : { ok: false, status: 500, error: `Your ${what} could not be saved just now. Try again shortly.` };

const COLUMNS = "id, doc_type, title, template_code, template_version, origin, passport_share_token_id, duplicated_from, content, ai_assisted, created_at, updated_at";
export type DocumentRow = {
  id: string; doc_type: string; title: string; template_code: string; template_version: number; origin: "progress" | "passport";
  passport_share_token_id: string | null; duplicated_from: string | null; content: DraftContent; ai_assisted: boolean; created_at: string; updated_at: string;
};
export type ExportRow = { id: string; document_id: string; format: Format; template_code: string; template_version: number; content_hash: string; byte_size: number; record_count: number; exported_at: string };

export async function loadDocuments(admin: any, userId: string): Promise<{ provisioned: boolean; documents: DocumentRow[] | null; exports: ExportRow[] | null }> {
  try {
    const [d, e] = await Promise.all([
      admin.from("individual_professional_document").select(COLUMNS).eq("user_id", userId).order("updated_at", { ascending: false }).limit(200),
      admin.from("individual_professional_document_export").select("id, document_id, format, template_code, template_version, content_hash, byte_size, record_count, exported_at")
        .eq("user_id", userId).order("exported_at", { ascending: false }).limit(500),
    ]);
    if ((d.error && isNotProvisioned(d.error)) || (e.error && isNotProvisioned(e.error))) return { provisioned: false, documents: [], exports: [] };
    return { provisioned: true, documents: d.error ? null : d.data ?? [], exports: e.error ? null : e.data ?? [] };
  } catch { return { provisioned: true, documents: null, exports: null }; }
}

export async function documentOf(admin: any, userId: string, id: string): Promise<DocumentRow | null> {
  try {
    const { data } = await admin.from("individual_professional_document").select(COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle();
    return data ?? null;
  } catch { return null; }
}

export async function createDocument(admin: any, userId: string, v: {
  docType: string; title: string; templateCode: string; templateVersion: number; content: DraftContent; origin: "progress" | "passport"; passportShareTokenId: string | null; duplicatedFrom?: string | null; aiAssisted?: boolean;
}): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_document").insert({
    user_id: userId, experience_code: ORIGIN, doc_type: v.docType, title: v.title, template_code: v.templateCode, template_version: v.templateVersion,
    origin: v.origin, passport_share_token_id: v.origin === "passport" ? v.passportShareTokenId : null, duplicated_from: v.duplicatedFrom ?? null,
    content: v.content, ai_assisted: v.aiAssisted === true,
  }).select("id").single();
  return error || !data ? failed("document", error) : { ok: true, id: data.id };
}

export async function updateDocument(admin: any, userId: string, id: string, patch: { title?: string; templateCode?: string; templateVersion?: number; content?: DraftContent; aiAssisted?: boolean }): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_document").update({
    ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.templateCode !== undefined ? { template_code: patch.templateCode, template_version: patch.templateVersion } : {}),
    ...(patch.content !== undefined ? { content: patch.content } : {}), ...(patch.aiAssisted ? { ai_assisted: true } : {}), updated_at: new Date().toISOString(),
  }).eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (error) return failed("document", error);
  return data ? { ok: true, id } : { ok: false, status: 404, error: "That document is not yours." };
}

/** Delete a draft (retention is the person's): its export records go with it. No source record is touched. */
export async function deleteDocument(admin: any, userId: string, id: string): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_document").delete().eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (error) return failed("document", error);
  return data ? { ok: true, id } : { ok: false, status: 404, error: "That document is not yours." };
}

export async function recordExport(admin: any, userId: string, v: { documentId: string; format: Format; templateCode: string; templateVersion: number; contentHash: string; byteSize: number; recordCount: number }): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_document_export").insert({
    document_id: v.documentId, user_id: userId, experience_code: ORIGIN, format: v.format, template_code: v.templateCode, template_version: v.templateVersion,
    content_hash: v.contentHash, byte_size: v.byteSize, record_count: v.recordCount,
  }).select("id").single();
  return error || !data ? failed("export record", error) : { ok: true, id: data.id };
}
