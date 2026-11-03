import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { CAP } from "@/lib/assessment/studio/transitions";
import { createImport, importChoices } from "@/lib/assessment/import/store";
import { loadTaxonomy } from "@/lib/assessment/catalogue/classify";
import { plainError } from "@/lib/assessment/catalogue/db";

export const dynamic = "force-dynamic";

// POST /api/hq/assessment-catalogue/import -- step 1 of the guided import (ASMT-CATALOGUE-IMPORT-01): upload a workbook and
// extract its structure. Multipart body with one field, file. Needs hq.assessment.catalogue.manage OR the Checklist authoring
// capability (owner decision 4, 3 Nov 2026: authorised Instrument Authors and Catalogue Managers both import). Nothing is registered: the
// answer is the import record with its draft, which the person corrects and confirms before anything becomes an instrument.
// The parser is deterministic and runs on the server. The workbook is stored unchanged as the source record.

const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.assessment.catalogue.manage", CAP.author]);
  if (isHqRefusal(ctx)) return ctx;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return refuse(400, "Choose an Excel workbook to upload.");
  try {
    const r = await createImport(ctx.admin, ctx.userId, file);
    if (!r.ok) return refuse(r.status, r.error);
    const [choices, taxonomy] = await Promise.all([importChoices(ctx.admin), loadTaxonomy(ctx.admin)]);
    return NextResponse.json({ importId: r.row.id, status: r.row.status, draft: r.row.draft, fileName: r.row.file_name, sha256: r.row.file_sha256, registered: [], ...choices, taxonomy }, { status: 201 });
  } catch (e) {
    return refuse(500, plainError(e));
  }
}
