"use client";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) { setError(error.message); return; }
    setSent(true);
  }

  return (
    <div className="min-h-screen bg-[#0a2e38] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded bg-teal-500 flex items-center justify-center text-white font-bold">C</div>
            <span className="text-white font-semibold">Competen Healthcare</span>
          </Link>
          <h1 className="text-2xl font-bold text-white">Reset your password</h1>
          <p className="text-teal-300/70 text-sm mt-1">We&apos;ll email you a secure reset link</p>
        </div>

        {sent ? (
          <div className="bg-white rounded-2xl p-8 text-center">
            <p className="text-4xl mb-3">📬</p>
            <h2 className="text-lg font-bold text-gray-900">Check your email</h2>
            <p className="text-sm text-gray-500 mt-2">
              If an account exists for <b>{email}</b>, a password-reset link is on its way.
              The link expires after a short time, so use it soon.
            </p>
            <Link href="/login" className="mt-5 inline-block text-sm font-semibold text-teal-600 hover:underline">
              ← Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-8 flex flex-col gap-5">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Email address</label>
              <input
                type="email" required placeholder="jane@hospital.co.ke" autoFocus
                value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 transition"
              />
            </div>
            {error && <p className="text-red-500 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            <button
              type="submit" disabled={loading || !email}
              className="w-full rounded-lg bg-teal-600 py-3 text-white font-semibold text-sm hover:bg-teal-700 transition-colors disabled:opacity-60"
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
            <p className="text-center text-xs text-gray-400">
              Remembered it?{" "}
              <Link href="/login" className="text-teal-600 font-medium hover:underline">Sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
