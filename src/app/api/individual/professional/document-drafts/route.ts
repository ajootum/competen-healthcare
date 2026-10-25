import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { audit, readBody, refuse, todayUtc } from "@/lib/individual/professional/api";
import { isUuid } from "@/lib/individual/professional/validate";
import { loadDocumentsConfig, templatesFor } from "@/lib/individual/documents-config";
import { emptyDraft, parseDraft } from "@/lib/individual/documents/model";
import { loadDocumentCatalogue } from "@/lib/individual/professional/document-sources";
import { createDocument, deleteDocument, documentOf, updateDocument } from "@/lib/individual/professional/document-store";
import { draftFromPassport } from "@/lib/individual/professional/document-passport";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/professional/document-drafts -- COMPETEN-PROFESSIONAL-PROGRESS-01 PR7 s10.5, the person's document drafts.
//
// POST creates a draft ({ docType, templateCode?, title?, origin?, passportShareTokenId? }) or duplicates one
// ({ duplicateOf, docType?, title? }). PATCH saves presentation choices ({ id, title?, templateCode?, content?,
// aiAssisted? }): every record key is checked against the person's OWN catalogue, read now from the owners. DELETE ?id=
// removes a draft and its export records. Nothing here writes a source record.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const cfg = await loadDocumentsConfig(ctx.admin);
  if (isUuid(fields.duplicateOf)) {
    const src = await documentOf(ctx.admin, ctx.userId, fields.duplicateOf);
    if (!src) return refuse("That document is not yours.", 404);
    const type = cfg.types.find(t => t.code === (typeof fields.docType === "string" ? fields.docType : src.doc_type));
    if (!type) return refuse("Choose a document type that is offered.");
    const template = templatesFor(cfg, type).find(t => t.code === src.template_code) ?? templatesFor(cfg, type)[0];
    const keep = new Set(type.sections);
    const content = { ...src.content, sections: [...src.content.sections.filter(s => keep.has(s.code)), ...emptyDraft(type).sections.filter(s => !src.content.sections.some(x => x.code === s.code))] };
    const title = typeof fields.title === "string" && fields.title.trim() ? fields.title.trim().slice(0, 200) : `${src.title} (copy)`.slice(0, 200);
    const made = await createDocument(ctx.admin, ctx.userId, { docType: type.code, title, templateCode: template.code, templateVersion: template.version, content, origin: src.origin,
      passportShareTokenId: src.passport_share_token_id, duplicatedFrom: src.id });
    if (!made.ok) return refuse(made.error, made.status);
    await audit(ctx, "individual_professional_document_duplicate", "individual_professional_document", made.id, { from: src.id, doc_type: type.code });
    return NextResponse.json({ ok: true, id: made.id }, { status: 201 });
  }
  const type = cfg.types.find(t => t.code === fields.docType);
  if (!type) return refuse("Choose a document type.");
  const offered = templatesFor(cfg, type);
  const template = offered.find(t => t.code === fields.templateCode) ?? offered[0];
  if (!template) return refuse("No template is offered for this document type.");
  let origin: "progress" | "passport" = "progress", token: string | null = null;
  if (fields.origin === "passport") {
    origin = "passport";
    if (isUuid(fields.passportShareTokenId)) {
      const { data } = await ctx.admin.from("individual_professional_share").select("share_token_id").eq("share_token_id", fields.passportShareTokenId).eq("user_id", ctx.userId).maybeSingle();
      if (!data) return refuse("That Passport link is not yours.", 404);
      token = fields.passportShareTokenId;
    }
  }
  const title = typeof fields.title === "string" && fields.title.trim() ? fields.title.trim().slice(0, 200) : type.label;
  // From a Passport link (Stage 7): its selected records, read once through loadPassportSelection, become the draft's own
  // record keys. The link was checked above to be the caller's own.
  let content = emptyDraft(type), placed = 0, unmatched: string[] = [];
  if (token) {
    const catalogue = await loadDocumentCatalogue(ctx.admin, ctx.userId, ctx.profile, todayUtc());
    const fromLink = await draftFromPassport(ctx.admin, ctx.userId, token, type, catalogue.records, todayUtc());
    ({ content, placed, unmatched } = fromLink);
  }
  const made = await createDocument(ctx.admin, ctx.userId, { docType: type.code, title, templateCode: template.code, templateVersion: template.version, content, origin, passportShareTokenId: token });
  if (!made.ok) return refuse(made.error, made.status);
  await audit(ctx, "individual_professional_document_create", "individual_professional_document", made.id, { doc_type: type.code, template: template.code, origin, from_link: placed, not_placed: unmatched.length });
  return NextResponse.json({ ok: true, id: made.id, fromLink: token ? { placed, notPlaced: unmatched } : null }, { status: 201 });
}

export async function PATCH(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  if (!isUuid(fields.id)) return refuse("Choose a document.");
  const doc = await documentOf(ctx.admin, ctx.userId, fields.id);
  if (!doc) return refuse("That document is not yours.", 404);
  const cfg = await loadDocumentsConfig(ctx.admin);
  const type = cfg.types.find(t => t.code === doc.doc_type);
  if (!type) return refuse("That document type is no longer offered.");
  const patch: Parameters<typeof updateDocument>[3] = {};
  if (typeof fields.title === "string") {
    const t = fields.title.trim();
    if (t.length < 1 || t.length > 200) return refuse("A title is 1 to 200 characters.");
    patch.title = t;
  }
  if (typeof fields.templateCode === "string") {
    const template = templatesFor(cfg, type).find(t => t.code === fields.templateCode);
    if (!template) return refuse("That template is not offered for this document type.");
    patch.templateCode = template.code; patch.templateVersion = template.version;
  }
  if (fields.content !== undefined) {
    const catalogue = await loadDocumentCatalogue(ctx.admin, ctx.userId, ctx.profile, todayUtc());
    const parsed = parseDraft(fields.content, type, new Set(catalogue.records.map(r => r.key)));
    if (!parsed.ok) return refuse(parsed.error);
    patch.content = parsed.value;
  }
  if (fields.aiAssisted === true) patch.aiAssisted = true;
  const out = await updateDocument(ctx.admin, ctx.userId, doc.id, patch);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_document_update", "individual_professional_document", doc.id, { content: fields.content !== undefined, template: patch.templateCode ?? null });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return refuse("Choose a document.");
  const out = await deleteDocument(ctx.admin, ctx.userId, id);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, "individual_professional_document_delete", "individual_professional_document", id);
  return NextResponse.json({ ok: true });
}
