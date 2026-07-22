/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getLandlordCaller, landlordCan, landlordAudit } from "@/lib/platform/landlord";
import { emitPlatformEvent } from "@/lib/platform/events";

// POST /api/platform/deployments — record a platform release (LCP-001 §7).
const CHANNELS = ["stable", "staged", "canary"];
export async function POST(req: Request) {
  const caller = await getLandlordCaller();
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!landlordCan(caller, "platform_operations", "platform_super_admin", "engineer")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  if (!b?.version?.trim()) return NextResponse.json({ error: "version is required" }, { status: 400 });
  const channel = CHANNELS.includes(b.channel) ? b.channel : "stable";

  const { data, error } = await caller.admin.from("plat_deployments").insert({
    version: String(b.version).trim(), channel, status: "released", notes: b.notes ? String(b.notes) : null,
    git_commit: b.git_commit ? String(b.git_commit).slice(0, 60) : null,
    build_number: b.build_number ? String(b.build_number).slice(0, 40) : null,
    released_at: new Date().toISOString(), created_by: caller.userId,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await landlordAudit(caller.admin, caller, { action: "deployment_released", entity_type: "deployment", entity_id: data.id, entity_name: b.version, new_value: { channel } });
  await emitPlatformEvent(caller.admin, { event_type: "deployment.released", severity: "info", payload: { version: b.version, channel } });
  return NextResponse.json({ ok: true, id: data.id });
}
