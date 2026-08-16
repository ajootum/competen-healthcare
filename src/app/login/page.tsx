"use client";
import { useState } from "react";
import Link from "next/link";
import { PatternField } from "@/components/marketing/Pattern";
import { enabledOAuthProviders } from "@/lib/oauth-providers";

// Login. Two-panel enterprise sign-in: brand panel left, form right, matching the approved design.
//
// ⚠ THE SSO FLOW EXISTS NOW (item 15, 2026-08-16) -- this comment used to say truthfully that the
// OAuth sign-in call appeared nowhere in the codebase, and that sentence expired the day the start
// route (/api/auth/oauth/[provider]) and callback (/auth/callback) shipped. (The call's name is not
// written here: the sso-harness scans for it and a comment must not be the needle's haystack.) What has NOT changed is
// the honesty rule the row was built around: with NEXT_PUBLIC_OAUTH_PROVIDERS empty (the default)
// the buttons render DISABLED with the reason stated, and the start route re-checks GoTrue's LIVE
// settings before anybody leaves this origin -- so a drifted env var lands on a sentence here, not
// on a provider error page. A first-time OAuth identity is refused by the signups-closed decision,
// in words, by the callback. "Remember me" and i18n remain unbuilt and unfaked.

// Comma-separated, e.g. "google,azure". Empty (the default) renders the row disabled and explained.
const ENABLED: string[] = enabledOAuthProviders(process.env.NEXT_PUBLIC_OAUTH_PROVIDERS);

const PROVIDERS = [
  { id: "google", label: "Google", mark: <span className="text-[15px] font-bold text-[#4285F4]">G</span> },
  { id: "azure", label: "Microsoft", mark: (
    <span className="grid grid-cols-2 gap-[1.5px] w-3.5 h-3.5" aria-hidden>
      <span className="bg-[#F25022]" /><span className="bg-[#7FBA00]" />
      <span className="bg-[#00A4EF]" /><span className="bg-[#FFB900]" />
    </span>
  ) },
  { id: "apple", label: "Apple", mark: <span className="text-[15px] leading-none"></span> },
];

const field =
  "w-full rounded-xl border border-gray-200 bg-white pl-12 pr-11 py-3 text-sm text-gray-900 placeholder:text-gray-400 " +
  "outline-none focus:border-[var(--cmp-color-primary)] focus:ring-4 focus:ring-[var(--cmp-color-primary)]/10 transition";

const FEATURES = [
  { title: "Enterprise Security", body: "Your data is protected" },
  { title: "Configurable", body: "Built for your organisation" },
  { title: "Scalable", body: "From teams to enterprise" },
  { title: "AI Powered", body: "Intelligence in every workflow" },
];

/**
 * ⚠ THE THREE GATES THAT LEAD TO SITES STILL BEING BUILT — the owner's decision, 2026-08-11.
 *
 * Student and Professional both gate into Competen Individual; Recruiter gates into Competen
 * Recruitment. Neither product exists yet, so a person signing in through those doors must be TOLD
 * that before they type a password — not discover it as a redirect they cannot explain. The notice
 * renders above the form, and after sign-in they land on My Competen, where everything their account
 * DOES hold is waiting. When a product ships, its entry leaves this map and ?next starts working.
 */
const BUILDING: Record<string, { name: string; blurb: string }> = {
  "/individual": {
    name: "Competen Individual",
    blurb: "Your professional record, learning and competency passport — we are building this site now.",
  },
  "/recruitment": {
    name: "Competen Recruitment",
    blurb: "Opportunities, applications and verified hiring — we are building this site now.",
  },
};

export default function LoginPage() {
  const [form, setForm] = useState({ email: "", password: "" });
  // A verdict carried back from the SSO callback rides in on ?error= -- same lazy-initialiser shape
  // as `building` below, for the same lint reason.
  const [error, setError] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("error") ?? "";
  });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // ⚠ A LAZY INITIALISER, NOT AN EFFECT. setState inside an effect body is the cascading-render shape
  // the lint rule rejects, and the URL is known before the first render anyway. The typeof guard is for
  // the one server render a client component still gets, where window does not exist.
  const [building] = useState<{ name: string; blurb: string } | null>(() => {
    if (typeof window === "undefined") return null;
    const next = new URLSearchParams(window.location.search).get("next");
    return next ? BUILDING[next] ?? null : null;
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(data.error ?? "Invalid email or password");
      setLoading(false);
    } else {
      // PW-014 §1 / PW-AC-01 — universal landing: every authenticated user lands in the Personal
      // Workspace, which aggregates their work across all entitled workspaces. Functional portals are
      // reached from there via the Workspace Launcher, not at login.
      //
      // ⚠ UNLESS THEY WERE ON THEIR WAY SOMEWHERE. A gate that redirects here (`/login?next=/enterprise`)
      // used to lose the destination -- the owner typed /enterprise and surfaced on /dashboard with no
      // idea why. `next` restores it, VALIDATED: a single leading slash only, so this cannot become an
      // open redirect ("//evil.example" parses as protocol-relative and is refused by the double-slash
      // test; anything with a scheme fails the leading-slash test).
      const next = new URLSearchParams(window.location.search).get("next");
      // ⚠ A DESTINATION STILL BEING BUILT RESOLVES TO MY COMPETEN, where everything the account DOES
      // hold is one click away. Honouring the next would land them on a marketing page they just left.
      const dest = next && next.startsWith("/") && !next.startsWith("//") && !BUILDING[next] ? next : "/dashboard";
      window.location.href = dest;
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--cmp-neutral-50)] flex flex-col">
      {/* African geometric motifs, drawn not sourced — the same SVG the homepage uses, so the two public
          pages share one visual language instead of each inventing its own. Decorative, so aria-hidden. */}
      <PatternField className="pointer-events-none absolute -top-24 -right-24 w-[36rem] h-[36rem]"
        tone="var(--cmp-color-primary)" opacity={0.14} />
      <PatternField className="pointer-events-none absolute -bottom-32 -right-16 w-[32rem] h-[32rem]"
        tone="var(--cmp-color-warning)" opacity={0.18} />

      <main className="relative flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-6xl grid lg:grid-cols-2 gap-6 lg:gap-8 items-stretch">

          {/* ── BRAND PANEL ────────────────────────────────────────────────── */}
          <section className="relative hidden lg:flex flex-col rounded-3xl overflow-hidden bg-[#08312B] text-white">
            <PatternField className="absolute inset-0" tone="#FFFFFF" opacity={0.10} />

            <div className="relative p-8 pb-6">
              <Link href="/" className="flex items-center gap-3" aria-label="Competen home">
                <span className="w-11 h-11 rounded-2xl bg-[var(--cmp-color-primary)] flex items-center justify-center text-white text-xl font-bold">c</span>
                <span className="leading-tight">
                  <span className="block text-xl font-bold tracking-tight">competen</span>
                  <span className="block text-[11px] text-white/55">Healthcare. Empowered.</span>
                </span>
              </Link>

              <h1 className="mt-8 text-[2rem] xl:text-[2.4rem] font-bold leading-[1.15] tracking-tight text-balance">
                Build <span className="text-[var(--cmp-color-success)]">competent</span> people.<br />
                Deploy <span className="text-[var(--cmp-color-success)]">confident</span> teams.<br />
                Deliver <span className="text-[var(--cmp-color-success)]">safer</span> care.
              </h1>
              {/* Outcome language, not a product list. WEB-STRAT-001 forbids naming internal products on
                  any public page, and /login is public -- the disclosure harness caught the previous copy
                  here, which said "competency management" verbatim. */}
              <p className="mt-4 max-w-md text-[13.5px] leading-relaxed text-white/65">
                Competen helps students, professionals, practices and hospitals build capability,
                deliver better care and improve outcomes.
              </p>
            </div>

            {/* object-top keeps faces in frame when the panel is short; centring would crop to the tablet. */}
            <div className="relative flex-1 min-h-[220px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/home/hero-clinicians.webp" alt="Two nurses reviewing a patient record on a tablet"
                className="absolute inset-0 w-full h-full object-cover object-top" />
              <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-[#08312B] to-transparent" />
            </div>

            <ul className="relative grid grid-cols-4 gap-px bg-white/10 border-t border-white/10">
              {FEATURES.map(f => (
                <li key={f.title} className="bg-[#08312B]/95 px-3 py-4 text-center">
                  <p className="text-[11.5px] font-bold leading-tight">{f.title}</p>
                  <p className="mt-1 text-[10px] leading-snug text-white/50">{f.body}</p>
                </li>
              ))}
            </ul>
          </section>

          {/* ── FORM PANEL ─────────────────────────────────────────────────── */}
          <section className="rounded-3xl bg-white shadow-xl ring-1 ring-black/5 p-6 sm:p-10">
            <div className="flex flex-col items-center text-center">
              <span className="w-14 h-14 rounded-2xl bg-[var(--cmp-color-primary)] flex items-center justify-center text-white text-2xl font-bold">c</span>
              <h2 className="mt-4 text-2xl font-bold tracking-tight text-gray-900">Welcome back</h2>
              <p className="mt-1 text-[13.5px] text-gray-500">Sign in to your Competen account</p>
            </div>

            {/* ⚠ The building notice, ABOVE the password field -- the person must know where this door
                leads before they walk through it, not after. */}
            {building && (
              <div className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
                <p className="text-[13px] font-semibold text-indigo-900">{building.name} is on its way</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-indigo-800">
                  {building.blurb} Sign in and we&apos;ll take you to your Competen workspaces in the
                  meantime — you&apos;ll find {building.name} here the moment it opens.
                </p>
              </div>
            )}
            <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4">
              <div>
                <label htmlFor="email" className="block text-[12.5px] font-semibold text-gray-700 mb-1.5">Email address</label>
                <div className="relative">
                  <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg bg-[var(--cmp-color-primary-light)] text-[var(--cmp-text-success)] text-[12px] flex items-center justify-center">@</span>
                  <input id="email" type="email" required autoComplete="email" placeholder="you@hospital.org"
                    value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                    className={field} />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="password" className="block text-[12.5px] font-semibold text-gray-700">Password</label>
                  <Link href="/forgot-password" className="text-[12.5px] font-medium text-[var(--cmp-text-success)] hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg bg-[var(--cmp-color-primary-light)] text-[var(--cmp-text-success)] text-[12px] flex items-center justify-center">🔒</span>
                  <input id="password" type={showPassword ? "text" : "password"} required autoComplete="current-password"
                    placeholder="••••••••••••"
                    value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                    className={field} />
                  <button type="button" onClick={() => setShowPassword(s => !s)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm">
                    {showPassword ? "🙈" : "👁"}
                  </button>
                </div>
              </div>

              {error && (
                <p role="alert" className="rounded-xl bg-[var(--cmp-surface-critical)] border border-[var(--cmp-color-critical)]/25 px-3 py-2 text-[12.5px] text-[var(--cmp-text-critical)]">
                  {error}
                </p>
              )}

              <button type="submit" disabled={loading}
                className="mt-1 w-full rounded-xl bg-[var(--cmp-color-primary)] py-3.5 text-[15px] font-semibold text-white hover:bg-[var(--cmp-color-primary-dark)] disabled:opacity-60 transition-colors">
                {loading ? "Signing in…" : "Sign in →"}
              </button>
            </form>

            <div className="mt-7">
              <div className="relative text-center">
                <span className="absolute inset-x-0 top-1/2 h-px bg-gray-100" aria-hidden />
                <span className="relative bg-white px-3 text-[12px] text-gray-400">or continue with</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2.5">
                {PROVIDERS.map(p => {
                  const on = ENABLED.includes(p.id);
                  return (
                    <button key={p.id} type="button" disabled={!on}
                      title={on ? `Continue with ${p.label}` : `${p.label} sign-in is not enabled for this deployment`}
                      onClick={() => {
                        if (!on) return;
                        const n = new URLSearchParams(window.location.search).get("next");
                        window.location.href = `/api/auth/oauth/${p.id}${n ? `?next=${encodeURIComponent(n)}` : ""}`;
                      }}
                      className={`flex items-center justify-center gap-2 rounded-xl border py-3 text-[13px] font-medium transition-colors ${
                        on ? "border-gray-200 text-gray-700 hover:bg-gray-50"
                           : "border-gray-100 text-gray-300 cursor-not-allowed"}`}>
                      <span className={on ? "" : "opacity-40"}>{p.mark}</span>{p.label}
                    </button>
                  );
                })}
              </div>
              {ENABLED.length === 0 && (
                <p className="mt-2 text-center text-[11px] text-gray-400">
                  Social sign-in is not enabled for this deployment — please use your email and password.
                </p>
              )}
            </div>

            <p className="mt-6 text-center text-[13px] text-gray-500">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="font-semibold text-[var(--cmp-text-success)] hover:underline">Create one free</Link>
            </p>

            {/* Security note. Says what is actually true of this deployment rather than claiming a
                certification nobody has been audited against. */}
            <div className="mt-6 flex gap-3 rounded-2xl bg-[var(--cmp-color-primary-light)] border border-[var(--cmp-color-primary)]/15 p-4">
              <span aria-hidden className="text-[var(--cmp-text-success)] text-lg leading-none">🛡</span>
              <div>
                <p className="text-[13px] font-bold text-gray-900">Your security is our priority</p>
                <p className="mt-0.5 text-[12px] leading-snug text-gray-600">
                  Your session is encrypted in transit, and access to every workspace is scoped to your role
                  and your organisation.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="relative px-6 py-5 text-center text-[12px] text-gray-400">
        <span>© {new Date().getFullYear()} Competen Healthcare. All rights reserved.</span>
        <span className="mx-2 text-gray-200">|</span>
        <Link href="/" className="hover:text-gray-600 transition-colors">Home</Link>
        <span className="mx-2 text-gray-200">|</span>
        <a href="mailto:gabriel@semacast.com?subject=Competen%20support" className="hover:text-gray-600 transition-colors">Help</a>
      </footer>
    </div>
  );
}
