import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { favouriteTemplates, setFavouriteTemplate } from "@/lib/practice/report-favourites";

// /api/v1/practice/reports/favourites -- CPR-PI-001 v2 s12's Favourites row.
// The caller's own list; the engine refuses unknown templates and templates whose own capability
// the caller lacks (a shortcut to a door you cannot open is a broken promise).

export async function GET() {
  const auth = await requirePracticeContext("report.view");
  if (isDenied(auth)) return auth;
  return NextResponse.json({ favourites: await favouriteTemplates(auth.caller.admin, auth.ctx) });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("report.view");
  if (isDenied(auth)) return auth;
  const body = await req.json().catch(() => ({}));
  const result = await setFavouriteTemplate(auth.caller.admin, auth.ctx, {
    templateId: String(body.templateId ?? ""), favourite: body.favourite === true,
  });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ favourites: result.favourites });
}
