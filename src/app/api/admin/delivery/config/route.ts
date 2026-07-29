import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { loadDeliveryConfig, saveDeliveryConfig, type DeliveryConfig } from "@/lib/delivery/config";

// CDP-014 — delivery governance config API. GET returns the global delivery policy (+ provenance); POST saves it.
// The engines (orchestrator/reminders/consumer) read this at runtime, so a save immediately changes behaviour.
// Super-admin only — this is platform-wide delivery policy.

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Delivery configuration is super-admin only");
  return NextResponse.json(await loadDeliveryConfig(c.admin));
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Delivery configuration is super-admin only");

  let body: Partial<DeliveryConfig>;
  try { body = await req.json(); } catch { return badRequest("Invalid JSON"); }

  const patch: Partial<DeliveryConfig> = {};
  if (body.reminder_horizon_days !== undefined) patch.reminder_horizon_days = Number(body.reminder_horizon_days);
  if (body.campaign_default_due_days !== undefined) patch.campaign_default_due_days = Number(body.campaign_default_due_days);
  if (body.auto_remediation !== undefined) patch.auto_remediation = Boolean(body.auto_remediation);
  if (body.orchestration_enabled !== undefined) patch.orchestration_enabled = Boolean(body.orchestration_enabled);

  const me = await c.admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();
  const r = await saveDeliveryConfig(c.admin, patch, { id: c.userId, name: me.data?.full_name ?? null });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  return NextResponse.json({ ok: true, ...(await loadDeliveryConfig(c.admin)) });
}
