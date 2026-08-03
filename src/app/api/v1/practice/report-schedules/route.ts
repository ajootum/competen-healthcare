import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { createSchedule, listSchedules } from "@/lib/practice/document-generation";

// GET  /api/v1/practice/report-schedules -- CPR-330 scheduled report definitions.
// POST /api/v1/practice/report-schedules -- define one.
//
// EVERY ROW CARRIES fires:false. Not a footnote on the page, a field on the record: a client rendering
// this list cannot show it as an automation without discarding the field that says it is not one.

export async function GET() {
  const auth = await requirePracticeContext("report.view");
  if (isDenied(auth)) return auth;
  const schedules = await listSchedules(auth.caller.admin, auth.ctx.workspaceId);
  return NextResponse.json({
    schedules,
    automated: false,
    correlationId: auth.caller.traceId,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("report.view");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await createSchedule(auth.caller.admin, auth.ctx, {
    name: String(body.name ?? ""),
    reportKind: String(body.reportKind ?? "activity"),
    cadence: String(body.cadence ?? ""),
    correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ schedule: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
