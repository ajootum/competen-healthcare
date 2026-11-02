import { NextResponse, type NextRequest } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { openPreview } from "@/lib/individual/preview/session";
import { previewOrigin, returnOriginFor, sameOrigin } from "@/lib/individual/preview/origins";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/hq/individual/scholar-preview -- HQ-SCHOLAR-PREVIEW-01. Form-encoded: mode = read_only | testing.
//
// Opens a preview of the REAL Competen Scholar as the designated demonstration learner, on the separate preview host:
// it mints a single-use ticket (migration 860, 2 minutes) and answers 303 to <preview host>/preview/enter?t=<ticket>.
// The HQ user's own session on this host is not touched: the preview host has its own host-only cookies.
//
// ⚠ GATED BY hqApiGate(["hq.individual.scholar.preview"]). A caller without it gets 401 or 403 and NO session row is
// written (the gate runs before the database is asked for anything).
// ⚠ SAME-ORIGIN ONLY. The Origin header must be this request's own origin: this is a state-changing POST that mints a
// credential, so a form on another site must not be able to submit it for a signed-in HQ user.
// ⚠ THE ORIGINS ARE DERIVED, NEVER SUPPLIED. The preview origin comes from the request host, and the return origin must be
// a registered Competen origin (origins.ts), so neither can be steered by the body.

export async function POST(request: NextRequest) {
  const ctx = await hqApiGate(["hq.individual.scholar.preview"]);
  if (isHqRefusal(ctx)) return ctx;

  const host = request.headers.get("host");
  const proto = (request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(/:$/, "")).split(",")[0].trim();
  if (!sameOrigin(request.headers.get("origin"), host, proto)) {
    return NextResponse.json({ error: "This request did not come from Competen HQ." }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const mode = form?.get("mode");
  if (mode !== "read_only" && mode !== "testing") {
    return NextResponse.json({ error: "Choose a preview mode." }, { status: 400 });
  }

  const opened = await openPreview(ctx.admin as never, ctx.userId, mode, returnOriginFor(host));
  if (!opened.ok) {
    const status = opened.code === "NO_LEARNER" ? 409 : opened.code === "NOT_SET_UP" ? 503 : 502;
    return NextResponse.json({ error: opened.message }, { status });
  }

  const to = `${previewOrigin(host)}/preview/enter?t=${encodeURIComponent(opened.ticket)}`;
  return NextResponse.redirect(to, 303);
}
