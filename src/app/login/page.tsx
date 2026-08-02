"use client";
import { useState } from "react";
import Link from "next/link";
import { PatternField } from "@/components/marketing/Pattern";

// Login. Two-panel enterprise sign-in: brand panel left, form right, matching the approved design.
//
// WHAT IS DELIBERATELY NOT HERE, and why it matters more on this page than anywhere else.
// The design shows Google / Microsoft / Apple buttons, an SSO link, a language selector and a "Remember me"
// checkbox. None of those exist behind the product: `signInWithOAuth` appears nowhere in the codebase,
// there is no SSO sign-in flow (the control-plane identity screen RECORDS providers for admins, it does not
// authenticate anyone), there is no i18n, and Supabase already persists the session so a "Remember me" tick
// would change nothing.
//
// A dead control is bad anywhere. On a LOGIN page it is worse: someone clicks "Continue with Google",
// nothing happens, and they conclude the product is broken rather than that they should type a password.
// So the social row renders DISABLED with the reason stated, and turns on the moment a provider is
// configured -- see NEXT_PUBLIC_OAUTH_PROVIDERS. The other three are omitted rather than faked.

// Comma-separated, e.g. "google,azure". Empty (the default) renders the row disabled and explained.
const ENABLED = (process.env.NEXT_PUBLIC_OAUTH_PROVIDERS ?? "")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

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

export default function LoginPage() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
      window.location.href = "/dashboard";
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
                      onClick={() => { if (on) window.location.href = `/api/auth/oauth/${p.id}`; }}
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
