"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { enabledOAuthProviders, OAUTH_PROVIDER_LABELS } from "@/lib/oauth-providers";

// The real Practice sign-in form. Renders ONLY when the practice_sign_in flag is on (the server page
// decides) -- see the page component for why. Central Competen identity (IAM-ADR-01): this signs into
// the same Supabase auth as every other workspace; what makes it "Practice" is the destination routing,
// not the credential store.
//
// return_to is validated to a RELATIVE /practice path (IAM-001 s6.1 redirect safety: allow-listed
// destinations only, never an arbitrary URL).

export default function SignInForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // A verdict carried back from the SSO callback rides in on ?error= (lazy initialiser, never an effect).
  const [error, setError] = useState(() => params.get("error") ?? "");

  const returnTo = (() => {
    const raw = params.get("return_to") ?? "";
    return raw.startsWith("/practice") && !raw.includes("//") ? raw : "/practice/home";
  })();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) { setError("Sign-in failed. Check your email and password."); setBusy(false); return; }
    // Hard navigation so the server re-resolves membership and routes per IAM s7.1 (the shell decides
    // between home, onboarding, chooser and access-status -- this form never guesses).
    window.location.assign(returnTo);
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-gray-200 bg-white p-8">
      <h1 className="text-lg font-bold text-gray-900">Sign in to your Practice</h1>
      <div className="mt-5 flex flex-col gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-gray-600">Email</span>
          <input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--cp-primary)] focus:ring-4 focus:ring-[var(--cp-primary)]/10" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-600">Password</span>
          <input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--cp-primary)] focus:ring-4 focus:ring-[var(--cp-primary)]/10" />
        </label>
      </div>
      {error && <p className="mt-3 text-xs text-[var(--cmp-text-critical)] bg-[var(--cmp-surface-critical)] rounded-lg px-3 py-2">{error}</p>}
      <button type="submit" disabled={busy}
        className="mt-5 w-full rounded-xl bg-[var(--cp-primary)] py-2.5 text-sm font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {/* SSO (item 15): rendered ONLY when a provider is enabled for this deployment -- an empty env
          renders nothing here at all, because unlike /login this form never promised social buttons
          and a disabled row would be furniture. Same identity, same start route, same callback; what
          makes it Practice is return_to, carried through the flow and validated at both ends. */}
      {enabledOAuthProviders(process.env.NEXT_PUBLIC_OAUTH_PROVIDERS).length > 0 && (
        <div className="mt-4">
          <p className="text-center text-[11px] text-gray-400">or continue with</p>
          <div className="mt-2 grid gap-2">
            {enabledOAuthProviders(process.env.NEXT_PUBLIC_OAUTH_PROVIDERS).map(p => (
              <button key={p} type="button" disabled={busy}
                onClick={() => window.location.assign(`/api/auth/oauth/${p}?next=${encodeURIComponent(returnTo)}`)}
                className="w-full rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Continue with {OAUTH_PROVIDER_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* IAM-001 s14 lists recovery among the routes that must be deployed before cutover. It is the
          PLATFORM's recovery, not a Practice-specific one -- same identity, same reset -- which is why
          this links out rather than duplicating a flow that would then drift from the original. */}
      <p className="mt-4 text-center text-[12px] text-gray-500">
        <Link href="/forgot-password" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">Forgot your password?</Link>
      </p>
      <p className="mt-1.5 text-center text-[12px] text-gray-500">
        New here? <Link href="/practice/sign-up" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">Create your Practice</Link>
      </p>
    </form>
  );
}
