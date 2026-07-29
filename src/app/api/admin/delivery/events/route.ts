import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { loadEventStream, processEvents } from "@/lib/delivery/consumer";

// CDP-015 — event consumer API. GET returns the outbox stream (pending/processed/dead + recent); POST drains
// pending delivery-relevant events and auto-remediates failed assessments. Super-admin only. A cron does the
// same hourly.

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Event consumer is super-admin only");
  return NextResponse.json(await loadEventStream(c.admin, c.hospitalId, isSuper(c)));
}

export async function POST() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Event consumer is super-admin only");
  const r = await processEvents(c.admin);
  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "event_consumer_run", entity_type: "domain_events", new_value: { processed: r.processed, remediated: r.remediated } });
  return NextResponse.json({ ...r, stream: await loadEventStream(c.admin, c.hospitalId, isSuper(c)) });
}
