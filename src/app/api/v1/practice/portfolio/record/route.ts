import { NextRequest, NextResponse } from "next/server";
import { getCaller, isResponse } from "@/lib/api-auth";
import { buildProfessionalRecord, exportProfessionalRecord } from "@/lib/practice/portfolio";

// GET /api/v1/practice/portfolio/record             -- your own professional record
// GET /api/v1/practice/portfolio/record?view=export -- the same, shaped for a document
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THIS ROUTE DELIBERATELY DOES NOT CALL requirePracticeContext, AND THAT IS THE WHOLE REASON IT EXISTS.
//
// requirePracticeContext resolves a workspace, and resolveWorkspaceContext refuses one that is ARCHIVED,
// SUSPENDED, CLOSING or CLOSED. So every other portfolio path -- including the export, which is meant to
// be the escape hatch -- becomes unreachable at exactly the moment somebody needs their own record most:
// they archived the practice, or it was suspended, or they closed it and opened another.
//
// AUTHENTICATION IS THE WHOLE GATE, AND IT IS SUFFICIENT because the answer is scoped to the caller by
// construction. There is no parameter for whose record to read: `getCaller()` supplies the user id and
// nothing in the body or the query can name a different one. A practitioner with no Practice membership
// at all still gets their own record.
//
// NO CAPABILITY, for the reason the sibling route gives: a portfolio is an account of your own work, and
// nobody grants you permission to keep one. Capabilities live on a membership, and requiring one here
// would make the record depend on the very thing it must survive.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const c = await getCaller();
  if (isResponse(c)) return c;

  if (new URL(req.url).searchParams.get("view") === "export") {
    const result = await exportProfessionalRecord(c.admin, c.userId, { correlationId: c.traceId });
    if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
    return NextResponse.json({ ...result.data, correlationId: c.traceId });
  }

  const record = await buildProfessionalRecord(c.admin, c.userId);
  return NextResponse.json({ ...record, correlationId: c.traceId });
}
