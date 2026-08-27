"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { recoveryCredentialFromUrl } from "@/lib/auth/recovery-link";

// Landing page for the password-reset email link. The link carries a one-time
// code which is exchanged for a session; the user then sets a new password.

export default function ResetPasswordPage() {
  const [ready, setReady] = useState<"checking" | "ok" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  /** What the provider said, when it said anything. Null means we simply found no credential. */
  const [linkProblem, setLinkProblem] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      // ⚠ TWO LINK SHAPES, AND ONLY ONE USED TO WORK. A reset requested from the browser is PKCE
      // (`?code=`); one requested SERVER-SIDE -- the super-admin reset action, and every
      // inviteUserByEmail -- is implicit, with the token in the FRAGMENT. This page handled only the
      // first, then fell back to getSession() with a comment claiming the client picks the hash up
      // automatically. A PKCE-configured client does not. So administrator resets and all invitations
      // landed on "Link invalid or expired" while self-service resets worked.
      // See src/lib/auth/recovery-link.ts.
      const cred = recoveryCredentialFromUrl(window.location.search, window.location.hash);

      if (cred.kind === "provider_error") {
        // Supabase said why. Showing its reason beats a guess -- "expired" and "already used" are
        // different problems and the person can act on the difference.
        setLinkProblem(cred.description ?? cred.code);
        setReady("invalid");
        return;
      }

      if (cred.kind === "code") {
        const { error } = await supabase.auth.exchangeCodeForSession(cred.code);
        if (!error) { setReady("ok"); return; }
        setLinkProblem(error.message);
        setReady("invalid");
        return;
      }

      if (cred.kind === "tokens") {
        const { error } = await supabase.auth.setSession({
          access_token: cred.accessToken, refresh_token: cred.refreshToken,
        });
        if (!error) { setReady("ok"); return; }
        setLinkProblem(error.message);
        setReady("invalid");
        return;
      }

      // No credential in the URL. An existing session still makes this page usable -- somebody who is
      // already signed in can change their password without a link at all.
      const { data } = await supabase.auth.getSession();
      setReady(data.session ? "ok" : "invalid");
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setLoading(true); setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) { setError(error.message); return; }
    await supabase.auth.signOut();
    setDone(true);
  }

  return (
    <div className="min-h-screen bg-[#0a2e38] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded bg-teal-500 flex items-center justify-center text-white font-bold">C</div>
            <span className="text-white font-semibold">Competen Healthcare</span>
          </Link>
          <h1 className="text-2xl font-bold text-white">Choose a new password</h1>
        </div>

        {ready === "checking" && (
          <div className="bg-white rounded-2xl p-8 text-center text-sm text-gray-500">Verifying your reset link…</div>
        )}

        {ready === "invalid" && (
          <div className="bg-white rounded-2xl p-8 text-center">
            <p className="text-4xl mb-3">⌛</p>
            <h2 className="text-lg font-bold text-gray-900">Link invalid or expired</h2>
            <p className="text-sm text-gray-500 mt-2">
              {linkProblem ?? "Password-reset links only work once and expire quickly."}
            </p>
            <Link href="/forgot-password" className="mt-5 inline-block text-sm font-semibold text-teal-600 hover:underline">
              Request a new link →
            </Link>
          </div>
        )}

        {ready === "ok" && (done ? (
          <div className="bg-white rounded-2xl p-8 text-center">
            <p className="text-4xl mb-3">✅</p>
            <h2 className="text-lg font-bold text-gray-900">Password updated</h2>
            <p className="text-sm text-gray-500 mt-2">You can now sign in with your new password.</p>
            <Link href="/login"
              className="mt-5 inline-block bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors">
              Sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-8 flex flex-col gap-5">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">New password</label>
              <input
                type="password" required placeholder="Min. 8 characters" autoFocus
                value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 transition"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Confirm new password</label>
              <input
                type="password" required placeholder="Repeat the password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 transition"
              />
            </div>
            {error && <p className="text-red-500 text-xs bg-[var(--cmp-surface-critical)] rounded-lg px-3 py-2">{error}</p>}
            <button
              type="submit" disabled={loading}
              className="w-full rounded-lg bg-teal-700 py-3 text-white font-semibold text-sm hover:bg-teal-700 transition-colors disabled:opacity-60"
            >
              {loading ? "Updating…" : "Update password"}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
