import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isPreviewHost } from "@/lib/identity/domains";
import { PREVIEW_COOKIE, endPreview, previewAdmin, previewCookieClear, previewReturnOrigin } from "@/lib/individual/preview/session";
import { isRegisteredOrigin, sameOrigin } from "@/lib/individual/preview/origins";

export const dynamic = "force-dynamic";

// POST /preview/end -- HQ-SCHOLAR-PREVIEW-01. "Return to HQ" and "End preview".
//
// Ends the session in the database (idempotent, audited), signs the learner out of THIS host, clears the preview cookie
// and sends the person back to the HQ screen they started from. The return origin is the one recorded on the session at
// open time and re-validated against the registry here: it is never read from the request.
// Works for an expired or already ended session too: leaving must never be blocked by a session that has lapsed.

export async function POST(request: NextRequest) {
  const host = request.headers.get("host");
  if (!isPreviewHost(host)) return new NextResponse("Not found", { status: 404 });
  const proto = (request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(/:$/, "")).split(",")[0].trim();
  const origin = request.headers.get("origin");
  if (origin && !sameOrigin(origin, host, proto)) return NextResponse.json({ error: "Not a same-origin request." }, { status: 403 });

  const token = request.cookies.get(PREVIEW_COOKIE)?.value;
  const svc = await previewAdmin();
  const returnOrigin = await previewReturnOrigin(svc, token);
  await endPreview(svc, token, "ended_by_user");
  try { await (await createClient()).auth.signOut({ scope: "local" }); } catch { /* cleared below regardless */ }

  let res: NextResponse;
  if (returnOrigin && isRegisteredOrigin(returnOrigin)) {
    res = NextResponse.redirect(new URL("/super-admin/individual/scholar", returnOrigin), 303);
  } else {
    const to = request.nextUrl.clone();
    to.pathname = "/preview/ended";
    to.search = "";
    res = NextResponse.redirect(to, 303);
  }
  res.cookies.set(PREVIEW_COOKIE, "", previewCookieClear());
  return res;
}
