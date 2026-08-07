import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { documentRegister } from "@/lib/practice/documents-workspace";
import { parseDocFilter } from "@/lib/practice/documents-workspace-constants";

// GET /api/v1/practice/documents/register -- CPR-DOC-002 s16's "GET /documents with filters", over all
// three sources rather than over the authored ones alone (which is what /documents already answers).
//
// ⚠ THE SAME PARSER THE PAGES USE. A second interpretation of `?status=draft,approved` is a second
// answer to the same question, and the two would disagree the first time somebody added a status.
//
// ⚠ `unreadable` IS ON THE PAYLOAD AND IS NOT AN EMPTY LIST. A client receiving `rows: []` cannot tell
// an empty practice from a refused query, and it will show the first. Callers must read this field
// before saying "no documents".

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("document.view");
  if (isDenied(auth)) return auth;

  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const register = await documentRegister(auth.caller.admin, auth.ctx.workspaceId, parseDocFilter(sp));

  return NextResponse.json({
    rows: register.rows,
    unreadable: register.unreadable,
    truncated: register.truncated,
    today: register.today,
    correlationId: auth.caller.traceId,
  });
}
