import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { CAP } from "@/lib/assessment/studio/transitions";
import { discardImport, importChoices, loadImport, registerImport, saveImportDraft } from "@/lib/assessment/import/store";
import { loadTaxonomy } from "@/lib/assessment/catalogue/classify";
import { isUuid } from "@/lib/assessment/catalogue/filters";
import { plainError } from "@/lib/assessment/catalogue/db";

export const dynamic = "force-dynamic";

// /api/hq/assessment-catalogue/import/[importId] -- one import (ASMT-CATALOGUE-IMPORT-01).
// Every method admits a holder of hq.assessment.catalogue.manage OR of the Checklist authoring capability (owner decision 4,
// 3 Nov 2026: authorised Instrument Authors and Catalogue Managers both import and register draft instruments). A platform
// owner is admitted by the gate. Independence is untouched: the registering person is the Draft's author and so can never
// approve or publish it (890 lifecycle guard).
//   GET    the record, its draft and the choice lists (families, purposes, taxonomy)
//   PUT    { draft } the person's corrections and confirmations (titles, prompts, inclusion, column roles, grouping, family,
//          purpose, respondents, classification). Structure stays as extracted.
//   POST   { action: "register" } registers every confirmed group as a Draft instrument with its first version, scale and content.
//          { action: "discard" } closes the import without registering anything.
// The actor is always the signed-in person.

const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });
type Params = { params: Promise<{ importId: string }> };

const ADMITS = ["hq.assessment.catalogue.manage", CAP.author];

export async function GET(_req: Request, { params }: Params) {
  const { importId } = await params;
  if (!isUuid(importId)) return refuse(404, "No such import.");
  const ctx = await hqApiGate(ADMITS);
  if (isHqRefusal(ctx)) return ctx;
  try {
    const row = await loadImport(ctx.admin, importId);
    if (!row) return refuse(404, "No such import.");
    const [choices, taxonomy] = await Promise.all([importChoices(ctx.admin), loadTaxonomy(ctx.admin)]);
    return NextResponse.json({ importId: row.id, status: row.status, draft: row.draft, fileName: row.file_name, sha256: row.file_sha256, registered: row.draft.registered ?? [], ...choices, taxonomy });
  } catch (e) {
    return refuse(500, plainError(e));
  }
}

export async function PUT(req: Request, { params }: Params) {
  const { importId } = await params;
  if (!isUuid(importId)) return refuse(404, "No such import.");
  const ctx = await hqApiGate(ADMITS);
  if (isHqRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if (!body?.draft || typeof body.draft !== "object") return refuse(400, "Send the draft.");
  try {
    const r = await saveImportDraft(ctx.admin, importId, body.draft);
    return r.ok ? NextResponse.json({ ok: true, draft: r.draft }) : refuse(r.status, r.error);
  } catch (e) {
    return refuse(500, plainError(e));
  }
}

export async function POST(req: Request, { params }: Params) {
  const { importId } = await params;
  if (!isUuid(importId)) return refuse(404, "No such import.");
  const ctx = await withOwnAppointments(await hqApiGate(ADMITS));
  if (isHqRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  try {
    if (body?.action === "discard") {
      const r = await discardImport(ctx.admin, importId);
      return r.ok ? NextResponse.json({ ok: true }) : refuse(r.status, r.error);
    }
    if (body?.action !== "register") return refuse(400, "Unknown action.");
    if (!(ctx.isOwner || ctx.capabilities.includes("hq.assessment.catalogue.manage") || ctx.capabilities.includes(CAP.author))) {
      return refuse(403, "Registering an import needs catalogue management or Checklist authoring, held through an appointment. The upload and its corrections are kept.");
    }
    const r = await registerImport(ctx.admin, ctx.userId, importId);
    return r.ok ? NextResponse.json({ ok: true, registered: r.registered, warnings: r.warnings }) : refuse(r.status, r.error);
  } catch (e) {
    return refuse(500, plainError(e));
  }
}
