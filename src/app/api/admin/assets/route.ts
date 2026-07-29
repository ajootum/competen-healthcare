import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { listAssets } from "@/lib/assets/service";

// CAP-001 — unified asset list API (Phase 3). Powers the Asset Browser's filter/search/paginate. Super-admin
// only; reads the cap_assets index built by /api/admin/assets/refresh. Read-only.

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Asset browser is super-admin only");
  const p = new URL(req.url).searchParams;
  try {
    const r = await listAssets(c.admin, {
      type: p.get("type") || undefined,
      status: p.get("status") || undefined,
      q: p.get("q")?.trim() || undefined,
      isSuper: true,
      page: parseInt(p.get("page") || "1", 10) || 1,
      pageSize: parseInt(p.get("pageSize") || "25", 10) || 25,
    });
    return NextResponse.json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "list failed";
    if (/does not exist|schema cache|could not find the table/i.test(msg)) return NextResponse.json({ rows: [], total: 0, migration: true }, { status: 409 });
    return NextResponse.json({ rows: [], total: 0, error: msg }, { status: 500 });
  }
}
