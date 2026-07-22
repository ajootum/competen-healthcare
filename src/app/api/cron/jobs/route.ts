import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { runDueJobs } from "@/lib/platform/jobs";

// Background-job cron executor. Invoked by the Vercel cron (vercel.json) with
// `Authorization: Bearer ${CRON_SECRET}`. Runs every runnable job and records a
// run row for each, so the Background Jobs widgets reflect real scheduled runs.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const results = await runDueJobs(admin);
  const failed = results.filter(r => !r.ok).length;
  return NextResponse.json({ ran: results.length, failed, results }, { headers: { "Cache-Control": "no-store" } });
}
