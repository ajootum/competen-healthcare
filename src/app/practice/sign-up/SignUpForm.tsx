"use client";

import { useState } from "react";
import Link from "next/link";
import { PRACTICE_TYPES, PROFESSIONS } from "@/lib/practice/catalogs";

// The real self-service signup (CPR-IAM-001 s8), rendered only when practice_public_signup is on.
//
// TWO STEPS, NOT ONE LONG FORM. s8 collects identity and practice details, and asking a stranger for nine
// fields before anything has happened is how signup flows lose people. Step one is who you are; step two
// is what your practice is, by which point they have committed. Nothing is sent until step two is
// submitted, so abandoning at step one leaves no account behind -- a half-finished person in the identity
// store is worse than no person.
//
// THE TIMEZONE IS READ FROM THE BROWSER, not asked for. PROV-001 s11 requires a valid IANA zone, the
// browser knows it exactly, and a dropdown of 400 zones is a worse answer than the right one. It stays
// editable because a practitioner setting up from a laptop in another country is a real case.

/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--cp-primary)] focus:ring-4 focus:ring-[var(--cp-primary)]/10";
const label = "text-xs font-semibold text-gray-600";

export default function SignUpForm() {
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "err" | "info"; text: string; href?: string; hrefLabel?: string } | null>(null);
  const [form, setForm] = useState({
    fullName: "", email: "", password: "",
    displayName: "", countryCode: "UG", professionCode: "medical_doctor", defaultPracticeType: "independent",
    timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
    acceptedTerms: false,
  });
  const set = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  const stepOneReady = form.fullName.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email) && form.password.length >= 8;
  const stepTwoReady = form.displayName.trim() && /^[A-Z]{2}$/.test(form.countryCode) && form.timezone.trim() && form.acceptedTerms;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/signup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, locale: "en" }),
    });
    const data: any = await res.json().catch(() => ({}));

    if (res.status === 202) {
      // Verification required: no session, so no practice yet. Said plainly rather than spinning.
      setNotice({ kind: "info", text: data.message, href: data.nextUrl, hrefLabel: "Go to sign-in" });
      setBusy(false); return;
    }
    if (!res.ok) {
      setNotice({
        kind: "err", text: data?.error?.message ?? "That did not work.",
        href: data?.nextUrl, hrefLabel: data?.error?.code === "IDENTITY_EXISTS" ? "Sign in instead" : "Continue",
      });
      setBusy(false); return;
    }
    // Hard navigation so the server re-resolves membership and the shell decides the destination.
    window.location.assign(data.nextUrl ?? "/practice/onboarding");
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-gray-200 bg-white p-8">
      <h1 className="text-lg font-bold text-gray-900">Create your Competen Practice</h1>
      <p className="mt-1 text-[13px] text-gray-500">
        Step {step} of 2 — {step === 1 ? "your account" : "your practice"}
      </p>

      {notice && (
        <div className={`mt-4 rounded-xl px-3 py-2.5 text-[13px] ${
          notice.kind === "err"
            ? "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"
            : "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]"}`}>
          <p>{notice.text}</p>
          {notice.href && (
            <Link href={notice.href} className="mt-1 inline-block font-semibold underline underline-offset-2">
              {notice.hrefLabel} →
            </Link>
          )}
        </div>
      )}

      {step === 1 ? (
        <div className="mt-5 flex flex-col gap-3">
          <label className="block">
            <span className={label}>Your full name</span>
            <input required autoComplete="name" value={form.fullName}
              onChange={e => set("fullName", e.target.value)} className={`${input} mt-1`} />
          </label>
          <label className="block">
            <span className={label}>Email</span>
            <input required type="email" autoComplete="email" value={form.email}
              onChange={e => set("email", e.target.value)} className={`${input} mt-1`} />
          </label>
          <label className="block">
            <span className={label}>Password</span>
            <input required type="password" autoComplete="new-password" minLength={8} value={form.password}
              onChange={e => set("password", e.target.value)} className={`${input} mt-1`} />
            <span className="mt-1 block text-[11px] text-gray-400">At least 8 characters.</span>
          </label>
          <button type="button" disabled={!stepOneReady} onClick={() => { setNotice(null); setStep(2); }}
            className="mt-2 w-full rounded-xl bg-[var(--cp-primary)] py-2.5 text-sm font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
            Continue
          </button>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-3">
          <label className="block">
            <span className={label}>What should your practice be called?</span>
            <input required maxLength={120} value={form.displayName}
              onChange={e => set("displayName", e.target.value)} className={`${input} mt-1`} />
            <span className="mt-1 block text-[11px] text-gray-400">This is what your team and your records will show.</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>Your profession</span>
              <select value={form.professionCode} onChange={e => set("professionCode", e.target.value)} className={`${input} mt-1`}>
                {PROFESSIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={label}>How you practise</span>
              <select value={form.defaultPracticeType} onChange={e => set("defaultPracticeType", e.target.value)} className={`${input} mt-1`}>
                {PRACTICE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>Country</span>
              <input required maxLength={2} value={form.countryCode}
                onChange={e => set("countryCode", e.target.value.toUpperCase())} className={`${input} mt-1`} />
              <span className="mt-1 block text-[11px] text-gray-400">Two-letter code, e.g. UG.</span>
            </label>
            <label className="block">
              <span className={label}>Timezone</span>
              <input required value={form.timezone}
                onChange={e => set("timezone", e.target.value)} className={`${input} mt-1`} />
              <span className="mt-1 block text-[11px] text-gray-400">Detected from your device.</span>
            </label>
          </div>
          <label className="mt-1 flex items-start gap-2.5">
            <input type="checkbox" checked={form.acceptedTerms} required
              onChange={e => set("acceptedTerms", e.target.checked)} className="mt-0.5" />
            <span className="text-[12px] leading-relaxed text-gray-600">
              I accept the terms of service and have read the privacy notice.
            </span>
          </label>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => { setNotice(null); setStep(1); }}
              className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              Back
            </button>
            <button type="submit" disabled={busy || !stepTwoReady}
              className="flex-1 rounded-xl bg-[var(--cp-primary)] py-2.5 text-sm font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
              {busy ? "Setting up your practice…" : "Create my practice"}
            </button>
          </div>
        </div>
      )}

      <p className="mt-5 text-center text-[12px] text-gray-500">
        Already have a Competen account?{" "}
        <Link href="/practice/sign-in" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">Sign in</Link>
      </p>
    </form>
  );
}
