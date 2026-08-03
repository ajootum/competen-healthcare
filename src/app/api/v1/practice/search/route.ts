import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { searchPractice, type SearchDomain } from "@/lib/practice/search";

// GET /api/v1/practice/search?q=&domains=notes,documents -- CPR-350.
//
// search.use IS ITS OWN CAPABILITY, and migration 199 s3 gives the reasoning: the RESULTS are things
// the caller could already open, but the ABILITY to go fishing across every note in a practice for a
// name is a different power from opening a record you were handed a link to.
//
// The engine applies the per-domain capability filter itself, before it queries anything. This route
// does not re-derive it -- one place deciding who sees what is the only arrangement where the answer
// cannot differ between the API and a page that calls the engine directly.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("search.use");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const domains = url.searchParams.get("domains");

  const result = await searchPractice(auth.caller.admin, auth.ctx, url.searchParams.get("q") ?? "", {
    domains: domains ? (domains.split(",") as SearchDomain[]) : undefined,
  });
  return NextResponse.json({ ...result, correlationId: auth.caller.traceId });
}
