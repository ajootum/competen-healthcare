"use client";

import { useState } from "react";
import Link from "next/link";
import { enabledOAuthProviders, OAUTH_PROVIDER_LABELS } from "@/lib/oauth-providers";

// The staff door's form -- SHARED sign-in machinery, deliberately. It posts to /api/auth/login (the
// same route /login uses) and offers SSO through the same gate module and start route; no password
// logic is respelled here. What differs is only the DESTINATION: success goes to /staff/workspaces,
// where appointments and roles are resolved and the staff environment is granted or refused in words.
//
// ⚠ WHAT IS DELIBERATELY NOT HERE, each for its own reason (docs/COMP-ACCESS-SURVEY-001.md s7,
// which names the three refused comp controls; their exact wording is not repeated here because the
// access-doors harness needle-scans this file for them, and a comment must not be the needle's
// haystack -- the sso-harness rule):
//   - no recovery-code link: no such codes exist in this product; the link would 404 a locked-out
//     person at the worst moment.
//   - no device-trust checkbox: that machinery exists on the practice plane only; a checkbox that
//     stores nothing is a fake control.
//   - no session-persistence checkbox: the session already persists; the box would claim a control
//     that changes nothing.
//   - no "create account" link: staff accounts are made by an administrator, and signup is closed by
//     the owner's decision -- offering registration at an internal door would be a lie twice over.

export default function StaffSignInForm() {
  const [form, setForm] = useState({ email: "", password: "" });
  // A verdict carried back from the SSO callback rides in on ?error= -- lazy initialiser, never an
  // effect (the cascading-render shape the lint rule rejects; the URL is known before first render).
  const [error, setError] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("error") ?? "";
  });
  const [loading, setLoading] = useState(false);

  const providers = enabledOAuthProviders(process.env.NEXT_PUBLIC_OAUTH_PROVIDERS);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };

    if (!res.ok) {
      // Generic on purpose (spec s13: no account enumeration) -- the API's message is already
      // GoTrue's generic invalid-credentials sentence, never a role or appointment disclosure.
      setError(data.error ?? "Invalid email or password");
      setLoading(false);
    } else {
      // Hard navigation so the SERVER resolves appointments and roles -- this form never guesses
      // what the account holds, the same rule as the practice form.
      //
      // ⚠ AND A DEEP LINK SURVIVES IT (COMP-HQ-ACCESS-001 s14). A staff route that sent somebody
      // here to authenticate gets them back afterwards; without this the destination was dropped and
      // they arrived at the selector wondering where their bookmark went. VALIDATED, never trusted:
      // a single leading slash only, so "//evil.example" -- a valid pathname, and a real open-redirect
      // attack -- is refused, and the destination re-authorises itself on arrival as every staff
      // route does.
      const asked = new URLSearchParams(window.location.search).get("next");
      const dest = asked && asked.startsWith("/") && !asked.startsWith("//") ? asked : "/staff/workspaces";
      window.location.href = dest;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-6 sm:p-8 shadow-xl">
      <h1 className="text-lg font-bold text-gray-900">Staff sign-in</h1>
      <div className="mt-4 flex flex-col gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-gray-600">Email</span>
          <input
            type="email" required autoComplete="email" value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-600">Password</span>
          <input
            type="password" required autoComplete="current-password" value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10"
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-[var(--cmp-surface-critical)] border border-[var(--cmp-color-critical)]/25 px-3 py-2 text-[12.5px] text-[var(--cmp-text-critical)]">
          {error}
        </p>
      )}

      <button type="submit" disabled={loading}
        className="mt-5 w-full rounded-xl bg-teal-700 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50 transition-colors">
        {loading ? "Signing in…" : "Sign in"}
      </button>

      {/* SSO: rendered ONLY when a provider is enabled for this deployment -- like the practice form,
          this door never promised social buttons, so an empty env renders nothing rather than
          disabled furniture. Same identity, same start route; the destination is what makes it staff. */}
      {providers.length > 0 && (
        <div className="mt-4">
          <p className="text-center text-[11px] text-gray-400">or continue with</p>
          <div className="mt-2 grid gap-2">
            {providers.map(p => (
              <button key={p} type="button" disabled={loading}
                onClick={() => window.location.assign(`/api/auth/oauth/${p}?next=${encodeURIComponent("/staff/workspaces")}`)}
                className="w-full rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Continue with {OAUTH_PROVIDER_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* The platform's recovery, not a staff-specific one -- same identity, same reset. Linking out
          rather than duplicating a flow is the same call the practice form records. */}
      <p className="mt-4 text-center text-[12px] text-gray-500">
        <Link href="/forgot-password" className="font-semibold text-teal-700 hover:underline">Forgot your password?</Link>
      </p>
    </form>
  );
}
