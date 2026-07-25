import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, badRequest, isSuper } from "@/lib/api-auth";
import { loadRegistry, syncRegistryFromCatalog } from "@/lib/config/registry";

// Platform Configuration Registry (WCE-002) API. Super-admin gated (platform registry definitions are not
// tenant-editable — tenants configure instances through WCE-001/003).
//   GET                       → read API: the registered objects + dashboard stats (§24.1)
//   POST { action: "sync" }   → seed/refresh the registry from the in-code WORKSPACE_CATALOG
// Writes are audited inside the loader. 401 unauth / 403 non-super / 409 migration hint until 092 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Registry is platform super-admin only");
  const reg = await loadRegistry((c as any).admin);
  if (!reg.provisioned) return NextResponse.json({ error: "Registry not provisioned — run migration 092" }, { status: 409 });
  return NextResponse.json({ objects: reg.objects, stats: reg.stats });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Registry is platform super-admin only");
  const body = await req.json().catch(() => ({}));
  if (body?.action !== "sync") return badRequest("Unknown action");

  const admin = (c as any).admin;
  const probe = await admin.from("configuration_registry_objects").select("object_key").limit(1);
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message ?? "")) return NextResponse.json({ error: "Registry not provisioned — run migration 092" }, { status: 409 });

  const { data: me } = await admin.from("profiles").select("full_name").eq("id", (c as any).userId).single();
  const result = await syncRegistryFromCatalog(admin, (c as any).userId, me?.full_name ?? null);
  return NextResponse.json({ ok: true, ...result });
}
