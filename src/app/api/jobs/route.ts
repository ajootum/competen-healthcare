import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { loadJobs, runJob, isRunnable } from "@/lib/platform/jobs";

// POS-001F Background Job Runner API. GET → job registry + recent runs + summary
// (the spec's /api/jobs/summary feed). POST ?key=<job> → run a job now. Super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const data = await loadJobs(c.admin as any);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return badRequest("key required");
  if (!isRunnable(key)) return badRequest("Job is not runnable on demand");
  const r = await runJob(c.admin as any, key, "manual", c.userId);
  if (!r.ok && r.error === "migration_required") return NextResponse.json({ error: "Run migration 054 to enable the job runner" }, { status: 409 });
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
