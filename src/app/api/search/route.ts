import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper } from "@/lib/api-auth";
import { hybridSearch } from "@/lib/search/hybrid";

// CAP-006 — hybrid asset search API. Any authenticated user; results are tenant-scoped for non-super
// callers via match_assets' hospital filter. Read-only.

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ hits: [], semantic: false });
  try {
    const r = await hybridSearch(c.admin, q, { hospitalId: c.hospitalId, isSuper: isSuper(c), limit: 24 });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ hits: [], semantic: false, note: e instanceof Error ? e.message : "search failed" });
  }
}
