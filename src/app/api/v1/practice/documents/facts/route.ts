import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { selectableFacts, defaultSelection } from "@/lib/practice/document-facts";

// CPR-DOC-AUTO-001 section 9 -- what this patient's record can offer a document, and what is
// pre-selected. Read-only: offering a fact discloses nothing, so this is document.view rather than
// document.author. The disclosure decision happens at generation.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("document.view");
  if (isDenied(auth)) return auth;

  const patientId = req.nextUrl.searchParams.get("patientId");
  const encounterId = req.nextUrl.searchParams.get("encounterId");
  if (!patientId) return NextResponse.json({ error: "patientId is required" }, { status: 400 });

  const offered = await selectableFacts(auth.caller.admin, auth.ctx, { patientId, encounterId });
  if (!offered) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });

  return NextResponse.json({
    groups: offered.groups,
    encounterId: offered.encounterId,
    defaultSelected: defaultSelection(offered.groups),
    correlationId: auth.caller.traceId,
  });
}
