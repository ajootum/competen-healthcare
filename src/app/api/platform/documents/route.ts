import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { loadDocuments } from "@/lib/platform/documents";

// Unified Document Service API (PCS-000 Document). GET → the normalised document index
// aggregated across the evidence and assessment-evidence stores. Optional ?source= and
// ?limit=. Super_admin (landlord) platform scope. Read-only aggregation; fail-soft.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();

  const url = new URL(req.url);
  const source = url.searchParams.get("source") ?? undefined;
  const limit = Number(url.searchParams.get("limit")) || undefined;
  const result = await loadDocuments(c.admin, { source, limit });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
