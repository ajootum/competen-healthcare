import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { universalSearch } from "@/lib/practice/patient-workspace";

// GET /api/v1/practice/patients/search?q= -- CPR-V5-006 Universal Search.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// SEPARATE FROM GET /api/v1/practice/patients?q=, WHICH IS LEFT EXACTLY AS IT WAS.
//
// That route calls searchPatients(), which covers identifiers, contacts and names -- and DISCARDS every
// query error (`const { data: idHits } =`). A database that refused the identifier read answers "no
// patient found" for a national ID sitting in the table, and the desk registers a duplicate. This route
// calls universalSearch(), which reports each probe's outcome, adds the parent/guardian phone and email
// routes CPR-V5-006 asks for, and can therefore say "nothing found in what could be searched" rather
// than "nobody matches".
//
// THE CAPABILITY GATE IS patient.list HERE AND patient.view IN THE ENGINE, and the difference is
// deliberate: a caller who may see that people exist is not thereby a caller who may see who they are.
// A patient.list-only caller gets 200 with unavailable:"capability" and no results, which the screen
// renders as "not shown to you" -- not as "nobody matches".
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("patient.list");
  if (isDenied(auth)) return auth;

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const rawLimit = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 20;

  const result = await universalSearch(auth.caller.admin, auth.ctx, q, {
    limit,
    correlationId: auth.caller.traceId,
  });

  return NextResponse.json({ ...result, correlationId: auth.caller.traceId });
}
