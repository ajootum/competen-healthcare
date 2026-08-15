import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { financialReportCsv } from "@/lib/practice/billing";

// GET /api/v1/practice/billing/export?from=&to= -- the financial report pack as CSV.
//
// billing.export at the DOOR as well as in the engine: a money report inherits the money permission
// (PAY-001 s18), and the export is audited by the engine as practice.report_exported.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("billing.export");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const result = await financialReportCsv(auth.caller.admin, auth.ctx, {
    fromDay: url.searchParams.get("from") ?? undefined,
    toDay: url.searchParams.get("to") ?? undefined,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return new NextResponse(result.data.csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${result.data.filename}"`,
    },
  });
}
