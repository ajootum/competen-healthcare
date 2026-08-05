import { NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { dashboardReadModel } from "@/lib/practice/dashboard";

// GET /api/v1/practice/dashboard -- CPR-CORE-001 s10's `GET /practice/dashboard`, CORE-08.
//
// "Return assembled dashboard read model for selected day/session."
//
// THE SAME ASSEMBLER THE PAGE USES, not a second implementation of it. The command centre renders on the
// server and calls `dashboardReadModel` directly, so this route exists for the OTHER consumers the spec
// anticipates -- s12's polling fallback ("every 30-60 seconds"), a mobile surface, and the eventual
// event-driven refresh in s7. If it assembled the payload itself there would immediately be two answers
// to every figure on the dashboard, which is the precise thing s16 forbids.
//
// NO CACHING HEADER. s12 allows calendar data to be cached for up to five minutes but requires
// operational items to be near-real-time, and this payload is mostly the latter. Caching the assembled
// whole to suit its slowest-changing part would make the queue stale, so the parts that can be cached
// must be cached in their own feeders rather than here.

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requirePracticeContext("practice.home.view");
  if (isDenied(auth)) return auth;

  const model = await dashboardReadModel(auth.caller.admin, auth.ctx);

  // 200 EVEN WHEN FEEDERS FAILED. s16: "a failure in one feeder does not make the entire dashboard
  // unusable" -- the per-feeder state is IN the payload, so a caller renders what it has and retries the
  // rest. A 500 here would throw away eleven working cards because one query timed out.
  return NextResponse.json({ ...model, correlationId: auth.caller.traceId });
}
