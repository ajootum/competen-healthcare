import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { notify } from "@/lib/notify";

// Scheduled-reports executor. Invoked by the Vercel cron (vercel.json: daily
// 06:00 UTC) with `Authorization: Bearer ${CRON_SECRET}`. Processes due
// schedules: notifies each recipient with a link that opens the fresh report,
// then advances next_run_at. Delivery is in-app only — email needs an email
// service that isn't configured.

function nextRun(frequency: string, from = new Date()): Date {
  const d = new Date(from);
  d.setUTCHours(6, 0, 0, 0);
  if (frequency === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + (((8 - d.getUTCDay()) % 7) || 7));
  else { d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(1); }
  return d;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: due } = await admin.from("report_schedules")
    .select("id, name, frequency, recipients, definition_id, dataset")
    .eq("active", true).lte("next_run_at", now)
    .order("next_run_at").limit(20);

  let processed = 0;
  for (const s of due ?? []) {
    const href = s.definition_id
      ? `/assessor/reports/builder?run=${s.definition_id}`
      : `/assessor/reports/builder?dataset=${s.dataset ?? "assessments"}`;
    await notify(s.recipients ?? [], {
      type: "report_ready",
      title: `Scheduled report: ${s.name}`,
      body: `Your ${s.frequency} report is ready — open it for live figures and CSV export.`,
      href,
    });
    await admin.from("report_schedules").update({
      last_run_at: now,
      last_status: `delivered to ${(s.recipients ?? []).length}`,
      next_run_at: nextRun(s.frequency).toISOString(),
    }).eq("id", s.id);
    processed++;
  }

  return NextResponse.json({ ok: true, processed });
}
