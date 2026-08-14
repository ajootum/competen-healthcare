import type { NextConfig } from "next";

/**
 * COMP-SECURITY-SURVEY-001 s0.6 / s6.8 — security response headers.
 *
 * This file was five lines and an empty object. A patient-data application was shipping with no CSP,
 * no HSTS, no frame protection and no referrer policy. Everything below is set through Next's
 * `headers()` config key (next 16.2.9 — see node_modules/next/dist/docs/01-app/03-api-reference/
 * 05-config/01-next-config-js/headers.md), which applies to page routes, route handlers and static
 * assets alike, because it is checked before the filesystem.
 *
 * ⚠ THE SOURCE PATTERN IS `/:path*`, NOT `/(.*)`.
 * The docs' own CSP example uses `/(.*)`, and the headers doc then warns that with i18n configured
 * `/(.*)` "will not match the top-level `/`". There is no i18n here so both would work today, but
 * `/:path*` is documented to match the bare parent path (`/blog/:slug*` matches `/blog`) and does not
 * acquire that footgun if a locale is ever added. Proven against the built server, not assumed —
 * scripts/security-headers-harness.ts fetches `/` itself.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE CSP IS REPORT-ONLY AND THE OTHER FIVE ARE NOT (survey s6.8).
 *
 * The five below cannot break this application: nothing in `src/` renders an `<iframe>`, `<object>`
 * or `<embed>` (grep, case-insensitive, zero hits), no page reads `document.referrer`, and HSTS is
 * inert over plain HTTP so it cannot affect localhost. They enforce from the first request.
 *
 * The CSP cannot enforce yet, and the blocker is concrete rather than cautious:
 *
 *   1. `src/app/layout.tsx` renders a hand-written blocking inline `<script
 *      dangerouslySetInnerHTML>` (the sidebar anti-flash read of localStorage) into `<head>` on every
 *      page in the product.
 *   2. Next's own hydration bootstrap is a series of inline `self.__next_f.push(...)` scripts whose
 *      content differs per route, so no fixed hash covers them.
 *   3. React 19 + Tailwind v4 put `style={{…}}` attributes throughout the tree, and an inline style
 *      ATTRIBUTE needs `'unsafe-inline'` in `style-src` exactly as an inline `<style>` does.
 *
 * So the honest starting policy carries `'unsafe-inline'` on both script-src and style-src, which is
 * worth very little as an XSS control. Its value here is the OTHER directives — connect-src, img-src,
 * form-action, object-src, base-uri, frame-ancestors — which are meaningfully tight and are the ones
 * that need real-world observation before they enforce. Report-only lets them be observed without a
 * white screen. See the file header of the harness for what has to change before this enforces.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */

const isDev = process.env.NODE_ENV === "development";

/**
 * The Supabase origin, derived — NOT assumed.
 *
 * ⚠ A `connect-src` that omits this signs every user out, because the browser Supabase client
 * (`src/lib/supabase/client.ts`, `createBrowserClient`) talks to it directly on every page, and
 * `src/app/educator/studio/frameworks/Authoring.tsx` opens a realtime channel — which is a WebSocket
 * to the same host over `wss:`, a scheme `'self'` does not cover even on the same origin.
 * `img-src` needs it too: avatars are served from Supabase Storage public URLs
 * (`src/app/api/account/avatar/route.ts` calls `getPublicUrl`).
 *
 * Next loads `.env.local` before evaluating this file, so the variable is normally present. The
 * wildcard fallback exists so that a build run without an env file produces a policy that is merely
 * loose rather than one that would break the product — and the harness asserts the emitted header
 * names the REAL project host, which is what proves the derivation actually ran.
 */
const supabaseSources = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return { connect: "https://*.supabase.co wss://*.supabase.co", img: "https://*.supabase.co" };
  try {
    const { origin, host } = new URL(raw);
    return { connect: `${origin} wss://${host}`, img: origin };
  } catch {
    return { connect: "https://*.supabase.co wss://*.supabase.co", img: "https://*.supabase.co" };
  }
})();

/**
 * ⚠ NO EXTERNAL AI / EMAIL / SMS ORIGIN APPEARS BELOW, DELIBERATELY.
 *
 * `api.anthropic.com`, `api.openai.com`, `api.voyageai.com`, `generativelanguage.googleapis.com`,
 * `api.resend.com`, `api.twilio.com` and `api.africastalking.com` are all reached from server modules
 * (`src/lib/ai/embed.ts`, `src/lib/notifications/dispatch.ts`, `src/lib/practice/messaging.ts`) inside
 * route handlers. CSP governs the BROWSER only, so listing them would be decoration that also widened
 * the policy. If any of them is ever called from a client component, `connect-src` must be updated.
 *
 * Fonts likewise: `next/font/google` (Geist, `src/app/layout.tsx`) self-hosts the font files under
 * `/_next/static/media` at build time — there is no request to fonts.gstatic.com, so `font-src 'self'`
 * is correct and `fonts.googleapis.com` must NOT be added.
 */
const csp = [
  "default-src 'self'",
  // 'unsafe-inline' for the reasons in the header above. 'unsafe-eval' is dev-only: React uses eval
  // in development to reconstruct server error stacks, and Turbopack's HMR client needs it too.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // data: — QR codes (`src/lib/practice/identity-service.ts`, QRCode.toDataURL) and the canvas
  // signature pad (`CaptureTools.tsx`, toDataURL). blob: — object URLs built for downloads.
  `img-src 'self' data: blob: ${supabaseSources.img}`,
  "font-src 'self' data:",
  // MediaRecorder output is replayed from a blob: URL (CaptureTools voice notes).
  "media-src 'self' blob: data:",
  // ws: in dev only, for the Turbopack HMR socket.
  `connect-src 'self' ${supabaseSources.connect}${isDev ? " ws: http://localhost:*" : ""}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  // Every <form action> in src/ targets a same-origin path; the logout POST goes to /api/auth/logout.
  "form-action 'self'",
  // ⚠ Ignored while the policy is report-only — the CSP spec requires user agents to drop this
  // directive from a Report-Only policy. Kept so the enforcing switch is a one-word change.
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  /**
   * Clickjacking. DENY rather than SAMEORIGIN because nothing in this application frames anything:
   * a case-insensitive grep for "iframe" across `src/` returns zero hits, as does `<object`/`<embed`.
   * If a same-origin embed is ever genuinely needed, SAMEORIGIN is the smaller step, not removal.
   * `frame-ancestors 'none'` above says the same thing to browsers that prefer CSP — but it is
   * report-only today, so THIS header is the one actually enforcing it.
   */
  { key: "X-Frame-Options", value: "DENY" },
  /** MIME sniffing. The only valid value. Matters here because the product serves user uploads
   *  (evidence files, avatars) through signed Storage URLs. */
  { key: "X-Content-Type-Options", value: "nosniff" },
  /**
   * Referrer. `strict-origin-when-cross-origin` is the modern browser default, but stating it stops a
   * differently-configured browser leaking a full path. That matters more than usual here: workspace
   * URLs carry patient and practitioner identifiers in the path
   * (e.g. /practice/patients/<uuid>, /assessor/assess/<id>), so a leaked path is a leaked identifier.
   */
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  /**
   * ⚠ camera AND microphone ARE ALLOWED, and the copy-paste default would have broken a live feature.
   *
   * `src/app/assessor/assess/CaptureTools.tsx` calls `navigator.mediaDevices.getUserMedia({audio:true})`
   * for assessment voice notes and `{video:{facingMode:"environment"}}` for the QR/barcode scanner,
   * both rendered by `ConductCockpit.tsx`. The Next docs' own example is
   * `camera=(), microphone=(), geolocation=()`, which would have silently disabled evidence capture
   * for every assessor. `(self)` permits this origin and nothing embedded in it.
   *
   * `publickey-credentials-get=(self)` is also permissive-for-self on purpose: WebAuthn is not built
   * yet, but MFA enrolment is the next item on the survey's roadmap (s6.3) and a denial here would
   * surface later as an unexplained passkey failure.
   *
   * Everything genuinely unused is denied outright. Only well-supported feature tokens are listed —
   * an unrecognised token makes the browser log a console warning for every response.
   */
  {
    key: "Permissions-Policy",
    value: [
      "accelerometer=()",
      "autoplay=()",
      "camera=(self)",
      "display-capture=()",
      "encrypted-media=()",
      "fullscreen=(self)",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=(self)",
      "midi=()",
      "payment=()",
      "publickey-credentials-get=(self)",
      "screen-wake-lock=()",
      "usb=()",
      "xr-spatial-tracking=()",
      "browsing-topics=()",
    ].join(", "),
  },
  /**
   * HSTS. Two years, all subdomains — practice.competenhealthcare.com and www.competenhealthcare.com
   * are both this product and both HTTPS.
   *
   * ⚠ NO `preload`. That token is a submission to a list baked into browser binaries; it is slow and
   * awkward to reverse, and it would commit EVERY current and future subdomain of the apex — including
   * any internal or staging host nobody has thought about yet — to HTTPS-only, permanently. It is a
   * deployment decision with a one-way door in it, not a code change, so it is left for whoever owns
   * DNS to make deliberately. Browsers ignore this header entirely over plain HTTP, which is why it is
   * safe to send unconditionally and why it does nothing on localhost.
   */
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  /** Report-only. See the file header for the three blockers to enforcement. */
  { key: "Content-Security-Policy-Report-Only", value: csp },
];

const nextConfig: NextConfig = {
  /**
   * ⚠ VERIFICATION BUILDS MUST NOT SHARE `.next` WITH THE DEV SERVER — THIS HAS COST THE OWNER TWO
   * SITTINGS.
   *
   * `next build` and `next dev` both write here. A day of verifying each commit with `npx next build`
   * — a dozen production builds into the directory the running dev server was reading — left `.next` at
   * 1.5 GB of mixed output, and localhost served an OLDER Treatment tab than the deployed site twice,
   * with correct source on disk and a clean `git status` both times. Nothing looks wrong; the source
   * cannot be stale, because Turbopack dev compiles per request. The stale thing is the directory.
   *
   * So verification builds go somewhere else:
   *
   *     NEXT_BUILD_DIR=.next-verify npx next build
   *
   * The default is unchanged, so `next dev`, `next build` on Vercel, and every existing script behave
   * exactly as before — Vercel does not set this variable, and a deployment must keep using `.next`.
   * The override is opt-in and local only.
   */
  distDir: process.env.NEXT_BUILD_DIR || ".next",

  /**
   * Drops `X-Powered-By: Next.js`. Version disclosure only, but it is free to remove and it is the
   * kind of thing a scanner flags. Asserted absent by the harness.
   */
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
