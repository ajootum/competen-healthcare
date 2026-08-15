import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { listCohorts, saveCohort, retireCohort } from "@/lib/practice/cohort-engine";

// /api/v1/practice/cohorts -- CPR-PI-001 v2 s6's create/save cohort controls.
//
// report.view at the door for reading; the engine holds cohort.manage for writes, so a caller who
// can see the counts cannot quietly start saving populations.

export async function GET() {
  const auth = await requirePracticeContext("report.view");
  if (isDenied(auth)) return auth;
  const result = await listCohorts(auth.caller.admin, auth.ctx);
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ cohorts: result.cohorts });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("report.view");
  if (isDenied(auth)) return auth;
  const body = await req.json().catch(() => ({}));
  const base = { actorId: auth.caller.userId, correlationId: auth.caller.traceId };

  if (body.action === "save") {
    const result = await saveCohort(auth.caller.admin, auth.ctx, {
      name: String(body.name ?? ""), description: body.description ? String(body.description) : null,
      segmentIds: Array.isArray(body.segmentIds) ? body.segmentIds.map(String) : [],
      noVisitDays: body.noVisitDays ? Number(body.noVisitDays) : null, ...base,
    });
    if (!result.ok)
      return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
    return NextResponse.json({ id: result.id }, { status: 201 });
  }
  if (body.action === "retire") {
    const result = await retireCohort(auth.caller.admin, auth.ctx, { cohortId: String(body.cohortId ?? ""), ...base });
    if (!result.ok)
      return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: { code: "UNKNOWN_ACTION", message: "action is save or retire" } }, { status: 400 });
}
