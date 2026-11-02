import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS, mintDeviceId, needsDeviceCookie } from "@/lib/practice/device-register";
import { gatewayEntryRewrite } from "@/lib/identity/gateway-entry";
import { isPreviewHost } from "@/lib/identity/domains";
import { classifyPreviewPath, decidePreviewRequest } from "@/lib/individual/preview/host-policy";
import {
  PREVIEW_COOKIE, PREVIEW_EXPIRES_HEADER, PREVIEW_HEADER_PREFIX, PREVIEW_MODE_HEADER, PREVIEW_RETURN_HEADER,
  auditRefusedWrite, endPreview, livePreview, previewAdmin, previewCookieClear, previewReturnOrigin,
} from "@/lib/individual/preview/session";
import { isRegisteredOrigin } from "@/lib/individual/preview/origins";

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

  // ── HQ-SCHOLAR-PREVIEW-01: THE PREVIEW HEADERS ARE SET HERE AND NOWHERE ELSE ─────────────────────────────
  // `x-scholar-preview-*` tells the Individual layout "this render is a staff preview". A client must never be
  // able to say so, on ANY host: every copy a client sent is deleted below, on every request, before the proxy
  // sets its own (only when it has just verified a live session on the preview host). A spoofed header on the main
  // host therefore shows no banner and changes nothing (harness P9).
  const previewInject: Record<string, string> = {};
  const withTrace = (req: NextRequest) => {
    const h = new Headers(req.headers);
    for (const name of [...h.keys()]) if (name.toLowerCase().startsWith(PREVIEW_HEADER_PREFIX)) h.delete(name);
    h.set("x-trace-id", traceId);
    h.set("x-pathname", req.nextUrl.pathname);
    for (const [k, v] of Object.entries(previewInject)) h.set(k, v);
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

  // ── HQ-SCHOLAR-PREVIEW-01: SURFACES THAT DO NOT EXIST ON THIS HOST ARE A 404 BEFORE ANYTHING ELSE RUNS ─────
  // the /preview routes exist only on the preview host, and the preview host serves nothing but what host-policy.ts lists.
  // This needs no session, so it answers before the auth round trip.
  const requestHost = request.headers.get("host");
  const onPreviewHost = isPreviewHost(requestHost);
  if (decidePreviewRequest(requestHost, request.nextUrl.pathname, request.method, null).action === "not_found") {
    return new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

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

  // ── A PRODUCT GATEWAY'S ROOT IS THAT PRODUCT'S DOOR ───────────────────────────────────────────────
  //
  // COMP-HQ-ACCESS-001 s5 established this for one host; COMP-ACCESS-URL-001 s13 step 5 generalised it
  // to all six on 2026-08-26, the day they began resolving. Each subdomain serves this same
  // application, so without the rule every one of them answers with the marketing homepage and the
  // product's own door sits one path away.
  //
  // ⚠ ADDED TO THIS FILE, NEVER SUBSTITUTED FOR IT. Everything above -- the trace id, `x-pathname`,
  // the session refresh and the device cookie -- runs FIRST and rides onto the response either way;
  // only the final construction differs. Written as its own file with its own narrow matcher (the
  // first attempt at this change was), it would have silently disabled all four for every request.
  //
  // ⚠ AND THE MATCHER BELOW IS NOT NARROWED FOR IT. The decision is per-request, not per-route.
  //
  // ⚠ THE OLD NOTE HERE SAID THE RULE WAS INERT -- "the host test returns null for every request this
  // application serves today ... byte-identical until the subdomain exists". That stopped being true on
  // 2026-08-26. It now fires on six live hostnames, and a comment still claiming otherwise would tell
  // the next reader this file cannot affect production when it plainly can.
  //
  // IT STILL AUTHORIZES NOTHING. `gatewayEntryRewrite` reads the route from the registry and rewrites
  // the bare root; s5's principle is that the gateway sets context, never permission. Verified against
  // the live hosts: /super-admin and /practice/home are refused IDENTICALLY on all six.
  // ── HQ-SCHOLAR-PREVIEW-01: THE PREVIEW HOST'S SESSION GATE ────────────────────────────────────────────────
  //
  // On the preview host, an Individual page or API is served only to the demonstration learner's own Supabase session
  // AND a live preview session (migration 860, judged on the database clock) naming that SAME learner. Anything else
  // signs the session out, clears the preview cookie and sends the person to /preview/ended (a JSON 401 for an API).
  // /preview/enter and /preview/ended need no session, and assets are public files.
  //
  // ⚠ THE learner_id CHECK IS THE ONE THAT MATTERS: without it, a live preview token plus ANY Supabase session on
  // this host would be admitted. Read-only and testing rules (host-policy.ts) are applied with the session's mode.
  // ⚠ EVERY EXIT BELOW GOES THROUGH `finish`, so a refreshed-session cookie is never dropped on a refusal.
  const finish = (res: NextResponse) => {
    for (const c of pending) res.cookies.set(c.name, c.value, c.options);
    return res;
  };
  if (onPreviewHost && classifyPreviewPath(request.nextUrl.pathname) === "session") {
    const path = request.nextUrl.pathname;
    const isApi = path.startsWith("/api/");
    const token = request.cookies.get(PREVIEW_COOKIE)?.value;
    const admin = await previewAdmin();
    const session = await livePreview(admin, token);

    if (!session || !user || user.id !== session.learnerId) {
      if (session && user && user.id !== session.learnerId) await endPreview(admin, token, "identity_mismatch");
      const returnOrigin = session?.returnOrigin ?? (await previewReturnOrigin(admin, token));
      try { await supabase.auth.signOut({ scope: "local" }); } catch { void 0; }
      let res: NextResponse;
      if (isApi) {
        res = NextResponse.json({ error: "This preview has ended" }, { status: 401 });
      } else {
        const to = request.nextUrl.clone();
        to.pathname = "/preview/ended";
        to.search = "";
        if (returnOrigin && isRegisteredOrigin(returnOrigin)) to.searchParams.set("r", returnOrigin);
        res = NextResponse.redirect(to, 303);
      }
      res.cookies.set(PREVIEW_COOKIE, "", previewCookieClear());
      return finish(res);
    }

    const decision = decidePreviewRequest(requestHost, path, request.method, session.mode);
    if (decision.action === "not_found") return finish(new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } }));
    if (decision.action === "forbidden") {
      await auditRefusedWrite(admin, session, request.method, path);
      return finish(NextResponse.json({ error: decision.reason, preview: session.mode }, { status: 403 }));
    }
    previewInject[PREVIEW_MODE_HEADER] = session.mode;
    previewInject[PREVIEW_EXPIRES_HEADER] = session.expiresAt;
    if (session.returnOrigin && isRegisteredOrigin(session.returnOrigin)) previewInject[PREVIEW_RETURN_HEADER] = session.returnOrigin;
  }

  const gatewayTarget = gatewayEntryRewrite(request.headers.get("host"), request.nextUrl.pathname);
  let response: NextResponse;
  if (gatewayTarget) {
    const url = request.nextUrl.clone();
    url.pathname = gatewayTarget;
    // A rewrite, not a redirect: the gateway host keeps its own address while showing its own door.
    response = NextResponse.rewrite(url, { request: { headers: withTrace(request) } });
  } else {
    response = NextResponse.next({ request: { headers: withTrace(request) } });
  }
  return finish(response);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
