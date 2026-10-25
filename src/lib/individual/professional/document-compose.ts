/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadDocumentsConfig, templatesFor, type DocType, type DocumentsConfig, type Template } from "../documents-config";
import { buildDocModel, modelHash, type DocModel } from "../documents/model";
import { loadDocumentCatalogue, type Catalogue } from "./document-sources";
import type { DocumentRow } from "./document-store";

// ── ONE DRAFT, COMPOSED NOW ── COMPETEN-PROFESSIONAL-PROGRESS-01 PR7 ─────────────────────────────────────────────────────
//
// The preview page and the export route both call this, so what is previewed is what is exported: the draft's choices,
// the published type and template, and the records as their owners hold them today. The template a draft names is used at
// its CURRENT published version; when that is newer than the draft recorded, `templateChanged` says so before export.

export type Composed = {
  cfg: DocumentsConfig; type: DocType; template: Template; model: DocModel; hash: string; catalogue: Catalogue;
  templateChanged: { from: number; to: number } | null;
};

export async function composeDocument(admin: any, ctx: { userId: string; profile: { fullName: string | null; email: string | null } }, doc: DocumentRow, today: string): Promise<Composed | { error: string }> {
  const [cfg, catalogue] = await Promise.all([loadDocumentsConfig(admin), loadDocumentCatalogue(admin, ctx.userId, ctx.profile, today)]);
  const type = cfg.types.find(t => t.code === doc.doc_type);
  if (!type) return { error: "That document type is no longer offered. Duplicate the draft as another type." };
  const offered = templatesFor(cfg, type);
  const template = offered.find(t => t.code === doc.template_code) ?? null;
  if (!template) return { error: "That template is no longer offered for this document type. Choose another template." };
  const records = new Map(catalogue.records.map(r => [r.key, r]));
  const model = buildDocModel({ type, template, title: doc.title, draft: doc.content, records, person: catalogue.person, today });
  return { cfg, type, template, model, hash: modelHash(model), catalogue,
    templateChanged: template.version !== doc.template_version ? { from: doc.template_version, to: template.version } : null };
}
