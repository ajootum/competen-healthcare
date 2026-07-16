"use client";
import { useState } from "react";
import Link from "next/link";

export default function SignupPage() {
  const [form, setForm] = useState({ full_name: "", email: "", password: "", role: "nurse" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || data.message || "Sign up failed — please try again");
        setLoading(false);
      } else if (data.needsConfirmation) {
        setConfirmSent(true);
        setLoading(false);
      } else {
        const portals: Record<string, string> = {
          nurse:    "/dashboard",
          assessor: "/assessor",
          educator: "/educator",
        };
        window.location.href = portals[data.role] ?? "/dashboard";
      }
    } catch (err) {
      setError("Network error: " + String(err));
      setLoading(false);
    }
  }

  if (confirmSent) {
    return (
      <div className="min-h-screen bg-[#0a2e38] flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-md bg-white rounded-2xl p-8 text-center">
          <p className="text-4xl mb-3">📬</p>
          <h1 className="text-lg font-bold text-gray-900">Check your email</h1>
          <p className="text-sm text-gray-500 mt-2">
            We sent a confirmation link to <b>{form.email}</b>. Click it to activate your account, then sign in.
          </p>
          <Link href="/login" className="mt-5 inline-block text-sm font-semibold text-teal-600 hover:underline">
            Go to sign in →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a2e38] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded bg-teal-500 flex items-center justify-center text-white font-bold">C</div>
            <span className="text-white font-semibold">Competen Healthcare</span>
          </Link>
          <h1 className="text-2xl font-bold text-white">Create your account</h1>
          <p className="text-teal-300/70 text-sm mt-1">East Africa&apos;s clinical competency platform</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-8 flex flex-col gap-5">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Full name</label>
            <input
              type="text" required placeholder="Jane Namwocha"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 transition"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Email address</label>
            <input
              type="email" required placeholder="jane@hospital.co.ke"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 transition"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Password</label>
            <input
              type="password" required placeholder="Min. 8 characters"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 transition"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">I am a</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 transition bg-white"
            >
              <option value="nurse">Nurse / Clinical Staff</option>
              <option value="assessor">Assessor / Clinical Supervisor</option>
              <option value="educator">Nurse Educator</option>
            </select>
            <p className="text-[10px] text-gray-400 mt-1">
              Administrator accounts are created by your organisation&apos;s admin or Competen.
            </p>
          </div>

          {error && (
            <p className="text-red-500 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full rounded-lg bg-teal-600 py-3 text-white font-semibold text-sm hover:bg-teal-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? "Creating account..." : "Create free account"}
          </button>

          <p className="text-center text-xs text-gray-400">
            Already have an account?{" "}
            <Link href="/login" className="text-teal-600 font-medium hover:underline">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
