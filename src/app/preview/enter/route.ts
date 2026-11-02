import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isPreviewHost } from "@/lib/identity/domains";
import {
  PREVIEW_COOKIE, consumePreviewTicket, endPreview, previewAdmin, previewCookieOptions, type PreviewSession,
} from "@/lib/individual/preview/session";

// Request-time only: it reads a ticket, mints a session and sets cookies.
export const dynamic = "force-dynamic";

// GET /preview/enter?t=<ticket> -- HQ-SCHOLAR-PREVIEW-01. The landing of the redirect from HQ.
//
// 1. Preview host only (the proxy already 404s /preview/* on every other host, and this re-checks).
// 2. The ticket is consumed ATOMICALLY and ONCE on the database clock (migration 860): a replayed, expired or
//    ended ticket gets nothing.
// 3. The learner's identity is the designated demonstration learner's own Supabase account. A one-time magic link is
//    generated for THAT account and exchanged for a session by the server client, so the session cookies are set by
//    this response on THIS host (host-only). Nothing here reads, writes or clears a cookie of the main host.
//    The generated user is ASSERTED to be the designated learner before anything is exchanged: generateLink creates an
//    account when the address is unknown, so an unchecked id could sign somebody else in.
// 4. The preview cookie (the 60 minute session token) is set, and the person lands on Scholar.

const ENDED = "/preview/ended";

function back(request: NextRequest, to: string, clear = false) {
  const url = request.nextUrl.clone();
  url.pathname = to;
  url.search = "";
  const res = NextResponse.redirect(url, 303);
  if (clear) res.cookies.set(PREVIEW_COOKIE, "", { ...previewCookieOptions(0), maxAge: 0 });
  return res;
}

export async function GET(request: NextRequest) {
  if (!isPreviewHost(request.headers.get("host"))) return new NextResponse("Not found", { status: 404 });

  const ticket = request.nextUrl.searchParams.get("t") ?? "";
  const svc = await previewAdmin();
  const session: PreviewSession | null = await consumePreviewTicket(svc, ticket);
  if (!session) {
    // A replayed, expired or ended ticket: no session is minted, and whatever this host held is cleared.
    try { await (await createClient()).auth.signOut({ scope: "local" }); } catch { /* the cookies are cleared below regardless */ }
    return back(request, ENDED, true);
  }

  const fail = async (reason: string) => {
    await endPreview(svc, session.token, reason);
    return back(request, ENDED, true);
  };

  // The learner's address, read from Auth by the id the database designated. Never from the request.
  const admin = createAdminClient();
  const found = await admin.auth.admin.getUserById(session.learnerId);
  const email = found.data?.user?.email;
  if (found.error || !email) return fail("identity_unavailable");

  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed || link.data?.user?.id !== session.learnerId) return fail("identity_mismatch");

  const supabase = await createClient();
  const exchanged = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: hashed });
  if (exchanged.error || exchanged.data?.user?.id !== session.learnerId) {
    try { await supabase.auth.signOut({ scope: "local" }); } catch { /* ignore */ }
    return fail("identity_exchange_failed");
  }

  const remaining = Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000);
  (await cookies()).set(PREVIEW_COOKIE, session.token, previewCookieOptions(remaining));

  const to = request.nextUrl.clone();
  to.pathname = "/individual/scholar";
  to.search = "";
  return NextResponse.redirect(to, 303);
}
