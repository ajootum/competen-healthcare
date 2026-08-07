/**
 * Security headers harness — COMP-SECURITY-SURVEY-001 s0.6 / s6.8.
 *
 * ⚠ THIS HARNESS READS THE SERVER'S ACTUAL RESPONSE. IT NEVER IMPORTS next.config.ts.
 *
 * That is the entire point of it. An assertion that reads the config object proves that somebody typed
 * a string into a file; it says nothing about whether Next matched the `source` pattern, whether the
 * build picked the config up, or whether the header reached the wire. Those are the three ways this
 * change fails, and all three are invisible to a config-reading test. So every assertion below is made
 * against a `Response` obtained over HTTP from the running application.
 *
 * ⚠ AND IT PROVES THE FETCH SUCCEEDED BEFORE IT ASSERTS ANYTHING ABOUT THE RESULT.
 * A `fetch` that throws yields `headers.get(x) === undefined` for every x — which, tested with
 * `!== "wrong-value"`, passes. So the first two assertions establish that a real HTTP response came
 * back, and `main()` refuses to run the rest if either failed. A green run with a dead server is the
 * exact failure this file exists to make impossible.
 *
 * WHAT IS ASSERTED
 *   - the five enforcing headers, by exact value, on a PAGE route and on an API route
 *   - `/:path*` really does match the bare `/` as well as a nested path (the pattern choice in
 *     next.config.ts is documented, not obvious, and the i18n footnote in Next's headers doc is a trap)
 *   - the CSP is present as Report-Only and the ENFORCING header is absent — the deliberate state today
 *   - every directive the policy is supposed to carry is actually in the emitted string
 *   - connect-src and img-src name the REAL Supabase project host. This is the one assertion that
 *     proves `process.env.NEXT_PUBLIC_SUPABASE_URL` resolved when next.config.ts was evaluated; the
 *     wildcard fallback in that file would otherwise hide a failed derivation behind a working policy.
 *   - connect-src carries the `wss:` scheme (realtime presence in the framework authoring studio)
 *   - `camera=(self)` and `microphone=(self)` survive. ⚠ REGRESSION GUARD: the Next documentation's own
 *     Permissions-Policy example is `camera=(), microphone=()`, and pasting it disables assessment voice
 *     notes and the barcode scanner in `src/app/assessor/assess/CaptureTools.tsx` with no error anywhere.
 *   - `X-Powered-By` is gone
 *
 * ⚠ RUN AGAINST A PRODUCTION BUILD, NOT `next dev`.
 * The dev branch of the CSP adds 'unsafe-eval' and ws:, so the directive assertions below are written
 * for the production string and a dev server will fail them — correctly.
 *
 *   rm -rf .next && npx next build && npx next start
 *   npx --yes tsx scripts/security-headers-harness.ts
 *
 * BASE_URL overrides the target (default http://localhost:3000).
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

/** A page route and a route handler. Both must carry the headers; only one of them is a React render. */
const PAGE_PATH = "/";
const NESTED_PAGE_PATH = "/login";
// A real Route Handler with a GET export, not a 404. A 404 would still carry the headers (they are
// checked before the filesystem) and would therefore prove less than it appears to.
const API_PATH = "/api/notifications";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

/**
 * The expected enforcing headers, byte-exact.
 *
 * Held here rather than imported so that a change to next.config.ts has to be made in two places by a
 * human who meant it. An expectation imported from the thing under test asserts nothing.
 */
const EXPECTED: Record<string, string> = {
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "permissions-policy":
    "accelerometer=(), autoplay=(), camera=(self), display-capture=(), encrypted-media=(), "
    + "fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(self), midi=(), "
    + "payment=(), publickey-credentials-get=(self), screen-wake-lock=(), usb=(), "
    + "xr-spatial-tracking=(), browsing-topics=()",
};

/** Directives the report-only CSP must carry, as substrings of the emitted header. */
const EXPECTED_CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
];

type Probe = { label: string; res: Response | null; error: string | null };

/**
 * `redirect: "manual"` on purpose. `/api/me` unauthenticated may answer 401 or redirect; either is a
 * real response and both must carry the headers. Following the redirect would assert against a
 * different route than the one named.
 */
async function probe(label: string, path: string): Promise<Probe> {
  try {
    const res = await fetch(BASE + path, { redirect: "manual" });
    return { label, res, error: null };
  } catch (e) {
    return { label, res: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Print the real header lines so a report can quote the wire rather than the source. */
function dump(label: string, res: Response) {
  console.log(`\n  --- ${label} (HTTP ${res.status}) ---`);
  for (const k of [...Object.keys(EXPECTED), "content-security-policy-report-only", "content-security-policy", "x-powered-by"]) {
    const v = res.headers.get(k);
    console.log(`  ${k}: ${v ?? "(absent)"}`);
  }
}

function assertHeadersOn(routeLabel: string, res: Response) {
  for (const [key, expected] of Object.entries(EXPECTED)) {
    const actual = res.headers.get(key);
    ok(`${routeLabel}: ${key} == expected`, actual === expected,
      `got ${actual === null ? "(absent)" : `"${actual}"`}`);
  }
  ok(`${routeLabel}: CSP present as Report-Only`,
    (res.headers.get("content-security-policy-report-only") ?? "").length > 0);
  // Deliberate, and the survey's instruction (s6.8). If this ever fails it should be because someone
  // decided to enforce, updated this line, and read the enforcement notes in next.config.ts first.
  ok(`${routeLabel}: enforcing CSP deliberately absent`,
    res.headers.get("content-security-policy") === null,
    `got "${res.headers.get("content-security-policy")}"`);
}

async function main() {
  console.log(`\nSecurity headers harness -- ${BASE}\n`);

  const page = await probe("page route", PAGE_PATH);
  const api = await probe("api route", API_PATH);
  const nested = await probe("nested page route", NESTED_PAGE_PATH);

  // ── Gate: prove the server answered, before believing anything about what it said ────────────────
  ok(`page route ${PAGE_PATH} reachable and 200`,
    page.res !== null && page.res.status === 200,
    page.error ?? `status ${page.res?.status}`);
  // Any HTTP status is fine here: an unauthenticated 401 proves the server answered just as well as a
  // 200 does, and asserting 200 would make this harness depend on a session it has no business holding.
  ok(`api route ${API_PATH} reachable (any HTTP status)`,
    api.res !== null, api.error ?? "");
  ok(`nested page route ${NESTED_PAGE_PATH} reachable`,
    nested.res !== null, nested.error ?? "");

  if (!page.res || !api.res || !nested.res) {
    console.log("\n  ⚠ ABORTING -- the application did not answer. Every header assertion below would");
    console.log("    have been vacuous, so none was run. Start the BUILT app first:");
    console.log("      rm -rf .next && npx next build && npx next start");
    return report();
  }

  dump(PAGE_PATH, page.res);
  dump(API_PATH, api.res);
  console.log("");

  // ── The five enforcing headers, on both kinds of route ───────────────────────────────────────────
  assertHeadersOn(`page ${PAGE_PATH}`, page.res);
  assertHeadersOn(`api ${API_PATH}`, api.res);

  /**
   * `poweredByHeader: false`. Asserted on the PAGE route only, and that is deliberate.
   *
   * ⚠ The same assertion against `/api/notifications` was written first and then deleted, because it
   * cannot fail: Next never emits `X-Powered-By` on a Route Handler response, so the API version
   * passed even in a build with `poweredByHeader: true` — a green tick that proved nothing about the
   * setting it named. The page-route assertion DOES fail in that build (it reads "Next.js"), so this
   * is the one that carries the meaning.
   */
  ok("page /: X-Powered-By removed", page.res.headers.get("x-powered-by") === null,
    `got "${page.res.headers.get("x-powered-by")}"`);

  // `/:path*` must match the bare root AND a nested path. The root case is the one Next's headers doc
  // warns can silently stop matching, and it is the busiest route in the product.
  ok(`nested ${NESTED_PAGE_PATH}: X-Frame-Options present`,
    nested.res.headers.get("x-frame-options") === EXPECTED["x-frame-options"],
    `got ${nested.res.headers.get("x-frame-options") ?? "(absent)"}`);

  // ── The CSP string itself ────────────────────────────────────────────────────────────────────────
  const csp = page.res.headers.get("content-security-policy-report-only") ?? "";
  for (const directive of EXPECTED_CSP_DIRECTIVES) {
    ok(`csp: carries "${directive}"`, csp.includes(directive));
  }
  ok("csp: no 'unsafe-eval' in a production build", !csp.includes("unsafe-eval"),
    "this harness must be run against `next build && next start`, not `next dev`");

  // ── Supabase derivation. Proves next.config.ts read the env var rather than falling back. ────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  ok("env: NEXT_PUBLIC_SUPABASE_URL is set (harness precondition)", !!supabaseUrl);
  if (supabaseUrl) {
    const { origin, host } = new URL(supabaseUrl);
    ok(`csp: connect-src names the real Supabase origin (${origin})`, csp.includes(`connect-src 'self' ${origin}`),
      "if this fails the config fell back to https://*.supabase.co, i.e. the env var did not resolve at build time");
    ok(`csp: connect-src carries wss://${host} for realtime`, csp.includes(`wss://${host}`),
      "the framework authoring studio opens a Supabase realtime channel; 'self' does not cover wss:");
    ok(`csp: img-src names the Supabase origin (Storage avatars)`, csp.includes(`img-src 'self' data: blob: ${origin}`));
    ok("csp: img-src allows data: and blob: (QR codes, signature pad, downloads)",
      csp.includes("img-src 'self' data: blob:"));
    ok("csp: no wildcard Supabase fallback leaked into the policy", !csp.includes("*.supabase.co"));
  }

  // ── ⚠ The regression guard that matters most. See the file header. ───────────────────────────────
  const pp = page.res.headers.get("permissions-policy") ?? "";
  ok("permissions-policy: camera=(self) -- the barcode scanner needs it", pp.includes("camera=(self)"));
  ok("permissions-policy: microphone=(self) -- assessment voice notes need it", pp.includes("microphone=(self)"));
  ok("permissions-policy: geolocation denied", pp.includes("geolocation=()"));
  ok("permissions-policy: payment denied", pp.includes("payment=()"));

  // ── HSTS: two years, subdomains, and NOT preload (a one-way door, see next.config.ts) ────────────
  const hsts = page.res.headers.get("strict-transport-security") ?? "";
  ok("hsts: max-age is at least one year", /max-age=(\d+)/.test(hsts)
    && Number(/max-age=(\d+)/.exec(hsts)![1]) >= 31536000, hsts);
  ok("hsts: includeSubDomains", hsts.includes("includeSubDomains"));
  ok("hsts: no preload token (deliberate -- see next.config.ts)", !hsts.includes("preload"), hsts);

  report();
}

function report() {
  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} passed, ${fails.length} failed`);
  fails.forEach(f => console.log(`  - ${f}`));
  if (fails.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
