import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS, mintDeviceId, needsDeviceCookie } from "@/lib/practice/device-register";
import { staffEntryRewrite } from "@/lib/identity/staff-host";

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

  // ⚠ THE RESPONSE IS BUILT ONCE, AT THE END, AND EVERY COOKIE IS COLLECTED UNTIL THEN.
  //
  // The previous version rebuilt `supabaseResponse` inside `setAll` and returned whatever the last
  // rebuild produced. That was correct while `setAll` was the only writer, and the comment beside it
  // explained precisely why the headers had to be re-derived from `request` rather than snapshotted: a
  // stale snapshot drops a refreshed session and silently signs people out.
  //
  // A second writer now exists (the device cookie below), and under the old shape it would have had to
  // rebuild the response again -- discarding the Set-Cookie headers the refresh had already written.
  // Collecting instead of rebuilding keeps the original guarantee and removes the trap: `request.cookies`
  // is mutated as each writer decides, the forwarded headers are derived from it after all of them have
  // finished, and every pending cookie is written onto the single response.
  const pending: { name: string; value: string; options?: Record<string, unknown> }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            pending.push({ name, value, options: options as Record<string, unknown> | undefined });
          });
        },
      },
    }
  );

  // Refresh session so it doesn't expire while the user is active
  const { data: { user } } = await supabase.auth.getUser();

  // ── THE PRACTICE DEVICE REGISTER (COMP-SECURITY-SURVEY-001 s0.2) ──────────────────────────────────
  //
  // ⚠ THIS IS THE ONLY PLACE IN THE APPLICATION THAT CAN PLANT THIS COOKIE, and its absence is why the
  // register was broken. `src/lib/practice/shell.ts` tried `cookies().set` inside a Server Component,
  // where that call ALWAYS throws, and fell back to a fresh `crypto.randomUUID()` on every request. Its
  // comment claimed "the cookie is planted by the API the client calls"; no such API existed anywhere.
  // The result was 13,114 `practice_session` rows for 8 memberships, a "sign out this device" button
  // that marked a row nothing would ever present again, and an idle timeout that could never fire.
  //
  // ⚠ AND FIXING IT STARTS TWO CONTROLS THAT HAVE NEVER RUN. A device that persists is a device that can
  // be locked out, and a device that persists is a device that can be found to have been idle. Both are
  // dormant on day one -- the one live security policy carries `session_idle_minutes: null` -- but they
  // are no longer dead code, and `touchSession` was changed in the same pass so that an idle lock-out
  // clears itself when the person signs in again rather than banning their browser for ever.
  //
  // Setting it on `request` as well as on the response is what makes it usable by the render that
  // follows in this very request, rather than only by the next one.
  if (needsDeviceCookie({
    signedIn: !!user,
    pathname: request.nextUrl.pathname,
    existing: request.cookies.get(DEVICE_COOKIE)?.value,
  })) {
    const deviceId = mintDeviceId();
    request.cookies.set(DEVICE_COOKIE, deviceId);
    pending.push({ name: DEVICE_COOKIE, value: deviceId, options: DEVICE_COOKIE_OPTIONS });
  }

  // ── COMP-HQ-ACCESS-001 s5: THE STAFF HOST'S ROOT IS THE STAFF DOOR ────────────────────────────────
  //
  // The landlord entrance is `staff.competenhealthcare.com`, and the subdomain serves this same
  // application -- so without this the address people are told to use would answer with the marketing
  // homepage, the staff door sitting one path away.
  //
  // ⚠ ADDED TO THIS FILE, NEVER SUBSTITUTED FOR IT. Everything above -- the trace id, `x-pathname`,
  // the session refresh and the device cookie -- runs FIRST and rides onto the response either way;
  // only the final construction differs. Written as its own file with its own narrow matcher (the
  // first attempt at this change was), it would have silently disabled all four for every request.
  //
  // ⚠ AND THE MATCHER BELOW IS NOT NARROWED FOR IT. The decision is per-request, not per-route: the
  // host test returns null for every request this application serves today, so the ordinary site is
  // byte-identical until the subdomain exists.
  const staffTarget = staffEntryRewrite(request.headers.get("host"), request.nextUrl.pathname);
  let response: NextResponse;
  if (staffTarget) {
    const url = request.nextUrl.clone();
    url.pathname = staffTarget;
    // A rewrite, not a redirect: the staff host keeps its own address while showing its own door.
    response = NextResponse.rewrite(url, { request: { headers: withTrace(request) } });
  } else {
    response = NextResponse.next({ request: { headers: withTrace(request) } });
  }
  for (const c of pending) response.cookies.set(c.name, c.value, c.options);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
