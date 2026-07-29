import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { loadDeliveryQueue, runOrchestration } from "@/lib/delivery/orchestrator";

// CDP-001 — delivery orchestration API. GET returns the delivery queue (pending/delivered/overdue); POST runs
// orchestration (materialises pending rule deliveries + emits events). Super-admin only, platform-wide view.

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Delivery orchestration is super-admin only");
  return NextResponse.json(await loadDeliveryQueue(c.admin, c.hospitalId, isSuper(c)));
}

export async function POST() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Delivery orchestration is super-admin only");
  const me = await c.admin.from("profiles").select("full_name").eq("id", c.userId).maybeSingle();
  const r = await runOrchestration(c.admin, c.hospitalId, isSuper(c), { id: c.userId, name: me.data?.full_name ?? null });
  const queue = await loadDeliveryQueue(c.admin, c.hospitalId, isSuper(c));
  return NextResponse.json({ ...r, queue });
}
