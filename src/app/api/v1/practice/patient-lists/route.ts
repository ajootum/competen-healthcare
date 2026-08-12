import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { patientList, patientListCsv } from "@/lib/practice/patient-lists";

// GET /api/v1/practice/patient-lists?view=booked|seen&from=&to=&location=&format=csv
//
// ⚠ patient.view, NOT report.view. These rows are named people, so the gate is the one that governs
// seeing who a patient is -- and patientList() re-checks it itself rather than trusting this route.
//
// The CSV path exists here rather than on the page so the download is one request that the engine logs
// as a patient access, exactly like the read behind the screen.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("patient.view");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const view = url.searchParams.get("view") === "seen" ? "seen" : "booked";
  const result = await patientList(auth.caller.admin, auth.ctx, {
    view,
    fromDate: url.searchParams.get("from") ?? undefined,
    toDate: url.searchParams.get("to") ?? undefined,
    locationId: url.searchParams.get("location"),
    correlationId: auth.caller.traceId,
  });

  if (url.searchParams.get("format") !== "csv")
    return NextResponse.json({ ...result, correlationId: auth.caller.traceId });

  // ⚠ A FAILED READ IS NEVER DOWNLOADED AS AN EMPTY FILE. A spreadsheet with a header and no rows is
  // indistinguishable from a quiet month, and this one would be filed and planned against.
  if (result.unavailable || !result.permitted)
    return NextResponse.json(
      { error: { code: result.permitted ? "READ_FAILED" : "FORBIDDEN", message: result.detail ?? "this list is not available to you" } },
      { status: result.permitted ? 503 : 403 },
    );

  const { data: ws } = await auth.caller.admin.from("practice_workspace")
    .select("name").eq("id", auth.ctx.workspaceId).maybeSingle();
  const csv = patientListCsv(result, ws?.name ?? "This practice");
  const stamp = `${result.fromDate}_to_${result.toDate}`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${view}-patients-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
