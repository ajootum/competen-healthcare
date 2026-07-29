import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden } from "@/lib/api-auth";
import { loadReminderStatus, scanReminders } from "@/lib/delivery/reminders";

// CDP-011 — reminders admin API. GET returns reminder status (sent + upcoming due); POST runs the scan (fires
// deduped expiry reminders as in-app notifications). Super-admin only. A daily cron does the same automatically.

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Reminders are super-admin only");
  return NextResponse.json(await loadReminderStatus(c.admin, c.hospitalId, isSuper(c)));
}

export async function POST() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Reminders are super-admin only");
  const r = await scanReminders(c.admin);
  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "reminder_scan", entity_type: "cdp_reminders", new_value: { sent: r.sent, by_kind: r.byKind } });
  return NextResponse.json({ ...r, status: await loadReminderStatus(c.admin, c.hospitalId, isSuper(c)) });
}
