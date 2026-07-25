import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { resolveRuntime, composeRuntime } from "@/lib/config/runtime";

// Configuration Runtime & Resolution Engine (NCP-015) — GET /config/runtime?object=&tenant=&hospital=&unit=&roles=
// resolves an object's effective settings for that context, with a full precedence trace + cache key. Without an
// object it returns the engine version. POST refresh-cache is a marker until a distributed cache is wired.
// Super-admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = (c as any).admin;
  const u = new URL(req.url);
  const object = u.searchParams.get("object");
  if (!object) return NextResponse.json({ engine: "ncp-015", schema_version: "1.0.0", precedence: ["platform", "tenant", "hospital", "unit", "role", "user"] });
  const ctx = {
    tenantId: u.searchParams.get("tenant") || null,
    hospitalId: u.searchParams.get("hospital") || null,
    unitId: u.searchParams.get("unit") || null,
    roles: (u.searchParams.get("roles") || "").split(",").map(s => s.trim()).filter(Boolean),
    userId: u.searchParams.get("user") || null,
  };
  // ?compose=1 assembles the executable runtime model (page/dashboard/navigation) for this context.
  if (u.searchParams.get("compose") === "1") {
    const cm = await composeRuntime(admin, object, ctx);
    if (!(cm as any).provisioned) return NextResponse.json({ error: "Configuration registry not provisioned" }, { status: 409 });
    if (!(cm as any).found) return badRequest("Object not found in the registry");
    return NextResponse.json(cm);
  }
  const r = await resolveRuntime(admin, object, ctx);
  if (!(r as any).provisioned) return NextResponse.json({ error: "Configuration registry not provisioned" }, { status: 409 });
  if (!(r as any).found) return badRequest("Object not found in the registry");
  return NextResponse.json(r);
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (b.action === "refresh_cache") return NextResponse.json({ ok: true, note: "Resolution is computed live; a distributed cache is next-phase.", invalidated: b.object ?? "all" });
  return badRequest("Unknown action — use refresh_cache");
}
