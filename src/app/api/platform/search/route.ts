import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { platformSearch } from "@/lib/platform/search";

// Platform Search Service API (PFS-000 Search / PCS-000 Search Index). GET ?q=<term>
// runs one unified cross-entity search over the Postgres store and returns results
// grouped by type, each with a deep link. Super_admin (landlord) scope. Fail-soft.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();

  const q = new URL(req.url).searchParams.get("q") ?? "";
  const result = await platformSearch(c.admin, q);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
