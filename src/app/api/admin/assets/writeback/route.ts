import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { writeBackAsset } from "@/lib/assets/writeback";

// CAP-001 Phase 4 (W1) — status/version write-back API. Super-admin only. Writes an asset's status/version
// to its source table in native convention + reflects it on cap_assets. Audited. Read-only types are rejected
// with a governance pointer by the engine.

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Write-back is super-admin only");

  const b = await req.json().catch(() => ({}));
  const objectType = String(b.object_type ?? "");
  const objectId = String(b.object_id ?? "");
  const status = b.status ? String(b.status) : undefined;
  const version = b.version ? String(b.version) : undefined;
  if (!objectType || !objectId) return NextResponse.json({ error: "object_type and object_id are required" }, { status: 400 });
  if (!status && !version) return NextResponse.json({ error: "Provide a status and/or version" }, { status: 400 });

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();
  const r = await writeBackAsset(c.admin, { objectType, objectId, status, version, actor: { id: c.userId, name: me?.full_name ?? null } });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });

  await c.admin.from("audit_log").insert({
    actor_id: c.userId, action: "asset_writeback", entity_type: objectType, entity_id: objectId,
    new_value: { status: r.status ?? null, version: r.version ?? null },
  });
  return NextResponse.json(r);
}
