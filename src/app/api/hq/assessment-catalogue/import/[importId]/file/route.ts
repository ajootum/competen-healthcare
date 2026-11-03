import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { loadImport, signImportFile } from "@/lib/assessment/import/store";
import { isUuid } from "@/lib/assessment/catalogue/filters";

export const dynamic = "force-dynamic";

// GET /api/hq/assessment-catalogue/import/[importId]/file -- the original workbook, the source record of an import, as a
// five-minute signed download. Needs hq.assessment.catalogue.view (the provenance of an instrument is catalogue metadata).

export async function GET(_req: Request, { params }: { params: Promise<{ importId: string }> }) {
  const { importId } = await params;
  if (!isUuid(importId)) return NextResponse.json({ error: "No such import." }, { status: 404 });
  const ctx = await hqApiGate(["hq.assessment.catalogue.view"]);
  if (isHqRefusal(ctx)) return ctx;
  const row = await loadImport(ctx.admin, importId);
  if (!row) return NextResponse.json({ error: "No such import." }, { status: 404 });
  const url = await signImportFile(ctx.admin, row);
  if (!url) return NextResponse.json({ error: "The workbook could not be fetched just now." }, { status: 502 });
  return NextResponse.redirect(url, 307);
}
