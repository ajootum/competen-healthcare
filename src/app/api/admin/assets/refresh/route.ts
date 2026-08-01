import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { refreshAssets, assetIndexStatus } from "@/lib/assets/registry";

// CAP-001 — unified asset index admin. GET reports the cap_assets index status (per-type counts + last
// refresh); POST rebuilds the index from all 12 source tables. Super-admin only. Pure DB work — no external
// calls. Returns 409 if the cap_assets table isn't migrated yet (run migration 139).

function needsMigration(msg: string) {
  return /does not exist|schema cache|could not find the table/i.test(msg);
}

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Asset index is super-admin only");
  try {
    return NextResponse.json(await assetIndexStatus(c.admin));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "status failed";
    if (needsMigration(msg)) return NextResponse.json({ error: "cap_assets not migrated — run migration 139", migration: true }, { status: 409 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Refreshing the asset index is super-admin only");
  try {
    const r = await refreshAssets(c.admin);
    await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, action: "cap_assets_refresh", entity_type: "cap_assets", new_value: { total: r.total, byType: r.byType, errors: r.errors } });
    return NextResponse.json({ ...r, status: await assetIndexStatus(c.admin) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "refresh failed";
    if (needsMigration(msg)) return NextResponse.json({ error: "cap_assets not migrated — run migration 139", migration: true }, { status: 409 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
