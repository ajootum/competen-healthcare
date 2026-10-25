import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { audit, refuse, todayUtc } from "@/lib/individual/professional/api";
import { isUuid } from "@/lib/individual/professional/validate";
import { renderDocx } from "@/lib/individual/documents/docx";
import { renderPdf } from "@/lib/individual/documents/pdf";
import { composeDocument } from "@/lib/individual/professional/document-compose";
import { documentOf, recordExport } from "@/lib/individual/professional/document-store";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";
// Rendering a long portfolio can take a few seconds.
export const maxDuration = 60;

// GET /api/individual/professional/document-drafts/export?id=&format=docx|pdf&hash= -- COMPETEN-PROFESSIONAL-PROGRESS-01 PR7 s10.6.
//
// ⚠ PREVIEW FIRST, BY CONSTRUCTION. `hash` is the sha256 the preview page showed. The document is composed again from
// the draft and the owners' records NOW, and exported only if it hashes the same: if anything changed since the preview
// (a record, a choice, a template version), the export is refused and the person previews again. Both formats render
// the SAME model, so a DOCX and a PDF of one preview say the same thing.
//
// ⚠ ONLY TO THE PERSON. The guard is the person's own session, the draft must be theirs, and the file is streamed back to
// them with no-store. It is never stored, linked or emailed. One append-only metadata row records the export.

export async function GET(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const q = new URL(req.url).searchParams;
  const id = q.get("id"), format = q.get("format"), hash = q.get("hash") ?? "";
  if (!isUuid(id)) return refuse("Choose a document.");
  if (format !== "docx" && format !== "pdf") return refuse("Choose DOCX or PDF.");
  const doc = await documentOf(ctx.admin, ctx.userId, id);
  if (!doc) return refuse("That document is not yours.", 404);
  const c = await composeDocument(ctx.admin, ctx, doc, todayUtc());
  if ("error" in c) return refuse(c.error, 409);
  if (!c.type.formats.includes(format)) return refuse(`${c.type.label} is not exported as ${format.toUpperCase()}.`);
  if (!/^[0-9a-f]{64}$/.test(hash) || hash !== c.hash) return refuse("The document has changed since you previewed it. Preview it again, then export.", 409);
  const file = format === "docx" ? await renderDocx(c.model, c.template) : await renderPdf(c.model, c.template);
  const rec = await recordExport(ctx.admin, ctx.userId, { documentId: doc.id, format, templateCode: c.template.code, templateVersion: c.template.version, contentHash: c.hash, byteSize: file.length, recordCount: c.model.recordCount });
  if (!rec.ok) return refuse(rec.error, rec.status);
  await audit(ctx, "individual_professional_document_export", "individual_professional_document", doc.id, { format, template: c.template.code, version: c.template.version, records: c.model.recordCount });
  const name = `${doc.title.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "document"}.${format}`;
  return new NextResponse(new Uint8Array(file), { headers: {
    "Content-Type": format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf",
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "no-store, private",
    "X-Content-Type-Options": "nosniff",
  } });
}
