import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { generateReport, reportCsv } from "@/lib/practice/report-engine";
import { reportXlsx } from "@/lib/practice/report-xlsx";

// GET /api/v1/practice/reports/generate?template=&from=&to=&days=&format= -- CPR-PI-001 v2 s12.
//
// report.view at the DOOR; the engine re-checks the template's OWN capability (financial needs
// billing.view), so a link somebody pasted cannot outrank the catalogue. Generation is audited by
// the engine as practice.report_generated -- which is also what feeds the Recent reports list.
//
// format=csv (default) or xlsx -- BOTH render the same GeneratedReport, so the two files cannot
// disagree; an unknown format is refused by name rather than silently defaulted, because a caller
// who asked for pdf and got csv would file the wrong thing.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("report.view");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "csv";
  if (format !== "csv" && format !== "xlsx")
    return NextResponse.json({ error: { code: "UNKNOWN_FORMAT", message: `format must be csv or xlsx; PDF is the print view at /practice/reports/view, not a download` } }, { status: 400 });

  const days = Number(url.searchParams.get("days"));
  const result = await generateReport(auth.caller.admin, auth.ctx, {
    templateId: url.searchParams.get("template") ?? "",
    fromDay: url.searchParams.get("from") ?? undefined,
    toDay: url.searchParams.get("to") ?? undefined,
    days: Number.isFinite(days) && days > 0 ? Math.min(366, Math.round(days)) : undefined,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  const d = result.data.definition;
  if (format === "xlsx") {
    const buf = reportXlsx(result.data);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${d.templateId}-${d.fromDay}-${d.toDay}.xlsx"`,
      },
    });
  }
  return new NextResponse(reportCsv(result.data), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${d.templateId}-${d.fromDay}-${d.toDay}.csv"`,
    },
  });
}
