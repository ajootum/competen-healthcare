import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { runDueJobs } from "@/lib/platform/jobs";
import { sweepAllUploads } from "@/lib/individual/scholar-upload-sweep";

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
  // SCHOLAR-CE07C: every hour, the files of Scholar uploads nobody finished within 24 h are removed (migration 960; without
  // it nothing happens and each learner's next upload cleans their own folder). Called here, not as a platform job:
  // platform/jobs.ts is reachable from the HQ plane, and this clean-up touches learners' private study files.
  const scholarUploads = await sweepAllUploads(admin, Date.now()).catch((e: unknown) => ({ error: e instanceof Error ? e.message : "failed" }));
  return NextResponse.json({ ran: results.length, failed, results, scholarUploads }, { headers: { "Cache-Control": "no-store" } });
}
