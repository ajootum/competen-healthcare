import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  // ONE TRACE ID PER REQUEST (XWI P2-15).
  //
  // getCaller() mints its own, which covers the ~230 write paths that go through it but leaves 71 audit
  // writes -- older routes using auth.getUser() + createAdminClient() directly, with no shared door -- with
  // nothing to join them to the events they cause. Minting an id inside each of those would produce 71
  // ids that join nothing, which is decoration rather than tracing.
  //
  // Stamped here instead, where every matched request passes exactly once, so anything server-side can
  // read the SAME id via headers(). It also fixes a latent flaw in the getCaller version: two getCaller
  // calls in one request produced two different ids.
  //
  // The headers are re-derived from `request` INSIDE setAll rather than snapshotted up front, because
  // Supabase's cookie refresh writes to request.cookies and a stale snapshot would drop the refreshed
  // session -- silently logging people out, which is a very expensive way to get a trace id.
  // `x-pathname` rides along for the same reason: something server-side needs to know which URL was asked
  // for, and only this file sees it before routing. The practice shell layout uses it to send an expired
  // session back to the page it was actually trying to open instead of dropping everyone on the home page.
  //
  // A LAYOUT MUST NOT RENDER THIS INTO UI. Next's layout docs are explicit that layouts do not re-render on
  // navigation, so a pathname read here goes stale the moment a client-side navigation happens. It is safe
  // for the redirect guard ONLY because that guard runs during a server render, where the header and the
  // request are the same request by construction.
  const traceId = crypto.randomUUID();
  const withTrace = (req: NextRequest) => {
    const h = new Headers(req.headers);
    h.set("x-trace-id", traceId);
    h.set("x-pathname", req.nextUrl.pathname);
    return h;
  };

  let supabaseResponse = NextResponse.next({ request: { headers: withTrace(request) } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request: { headers: withTrace(request) } });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session so it doesn't expire while the user is active
  await supabase.auth.getUser();

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
