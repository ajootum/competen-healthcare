import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { exportActivityCsv } from "@/lib/practice/reports";

// GET /api/v1/practice/reports/export?from=&to= -- the activity report as CSV.
//
// report.view, not data.export: this is aggregate, and the capability that gates carrying a whole
// patient record out of the product is a stronger thing than the one that gates counting.
//
// THE FILE SAYS IT IS NOT ANONYMISED. Aggregate is not the same as safe -- a count of one in a small
// practice identifies somebody to anyone who knows the practice -- and a CSV travels further than the
// page it came from, so the sentence travels with it in the header rows.
//
// AND THE DOWNLOAD IS LOGGED AS AN EXPORT, which is why this calls exportActivityCsv rather than
// assembling the report and formatting it here: the logging belongs to the act, not to the route, or the
// next surface that offers this file will forget it. See the header on exportActivityCsv.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("report.view");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const days = url.searchParams.get("days");
  const { csv, report } = await exportActivityCsv(auth.caller.admin, auth.ctx, {
    fromDay: url.searchParams.get("from") ?? undefined,
    toDay: url.searchParams.get("to") ?? undefined,
    days: days ? Math.min(Math.max(Number(days) || 30, 1), 366) : undefined,
    correlationId: auth.caller.traceId,
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="practice-activity-${report.period.fromDay}-to-${report.period.toDay}.csv"`,
      "Cache-Control": "no-store, private",
    },
  });
}
