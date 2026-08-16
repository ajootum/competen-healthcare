"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// The TOTP enrolment and step-up console, against GoTrue's own MFA API -- the ONE place in this
// product allowed to call `auth.mfa.*` besides the shell's read-only check.
//
// ⚠ EVERY FAILURE IS SHOWN, NEVER SWALLOWED. This screen exists because of a survey full of
// discarded errors in the security path; a silent failure HERE would strand somebody mid-enrolment
// with half a factor. And unenrolment is drawn only at aal2, because GoTrue refuses it below that --
// a button that always fails is worse than a sentence saying why it is not offered.

/* eslint-disable @typescript-eslint/no-explicit-any */

type Factor = { id: string; friendly_name?: string | null; status: string; factor_type: string };

export default function TwoFactorConsole() {
  const supabase = createClient();
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [aal, setAal] = useState<{ current: string; next: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Enrolment in flight: the QR + secret GoTrue returned, waiting for the first code.
  const [enrolling, setEnrolling] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  // Step-up in flight: verifying an EXISTING factor to lift this session to aal2.
  const [stepUp, setStepUp] = useState<string | null>(null);

  async function refresh() {
    const [{ data: f, error: fe }, { data: a, error: ae }] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    if (fe || ae) { setError((fe ?? ae)!.message); return; }
    setFactors((f?.totp ?? []) as Factor[]);
    setAal(a ? { current: a.currentLevel ?? "aal1", next: a.nextLevel ?? "aal1" } : null);
  }
  // Kicked from a callback, not the effect body -- the PracticeSessionGuard pattern the lint rule wants.
  useEffect(() => { const t = setTimeout(() => { void refresh(); }, 0); return () => clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function beginEnrol() {
    setBusy(true); setError(null); setNotice(null);
    const { data, error: e } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
    setBusy(false);
    if (e) { setError(e.message); return; }
    setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setCode("");
  }

  async function confirmEnrol() {
    if (!enrolling || code.trim().length < 6) return;
    setBusy(true); setError(null);
    const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolling.factorId, code: code.trim() });
    setBusy(false);
    if (e) { setError(e.message); return; }
    setEnrolling(null); setCode("");
    setNotice("Two-factor is set up, and this session is verified with it. Practices that require a second factor will open for you now.");
    await refresh();
  }

  async function verifyNow(factorId: string) {
    if (code.trim().length < 6) { setStepUp(factorId); return; }
    setBusy(true); setError(null);
    const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false);
    if (e) { setError(e.message); return; }
    setStepUp(null); setCode("");
    setNotice("Verified. This session now carries your second factor.");
    await refresh();
  }

  async function unenrol(factorId: string) {
    setBusy(true); setError(null);
    const { error: e } = await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);
    if (e) { setError(e.message); return; }
    setNotice("Authenticator removed. Any practice that requires a second factor will refuse this account until a new one is set up.");
    await refresh();
  }

  const verified = (factors ?? []).filter(f => f.status === "verified");
  const atAal2 = aal?.current === "aal2";

  return (
    <div className="flex flex-col gap-4">
      {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-800">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">{notice}</p>}

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">This account</h2>
        {factors === null ? (
          <p className="mt-1 text-[12px] text-gray-500">{error ? "Could not be read." : "Reading your account…"}</p>
        ) : (
          <>
            <p className="mt-1 text-[12.5px] text-gray-700">
              {verified.length === 0
                ? "No authenticator is set up."
                : `${verified.length} authenticator${verified.length === 1 ? "" : "s"} set up.`}
              {" "}This session is {atAal2 ? "verified with a second factor." : "not yet verified with one."}
            </p>
            {verified.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {verified.map(f => (
                  <li key={f.id} className="flex items-center gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5 text-[12px]">
                    <span className="text-gray-800">{f.friendly_name ?? "Authenticator"}</span>
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">active</span>
                    {!atAal2 && (
                      <button type="button" disabled={busy} onClick={() => setStepUp(stepUp === f.id ? null : f.id)}
                        className="ml-auto rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">
                        Verify now
                      </button>
                    )}
                    {atAal2 && (
                      <button type="button" disabled={busy} onClick={() => unenrol(f.id)}
                        className="ml-auto rounded border border-rose-200 px-2 py-0.5 text-[11px] text-rose-700 hover:bg-rose-50">
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {verified.length > 0 && !atAal2 && (
              <p className="mt-1.5 text-[10px] text-gray-500">
                Removing an authenticator needs a session already verified with it &mdash; verify first,
                then the remove control appears. That is the platform&apos;s rule, and it is the right one.
              </p>
            )}
            {stepUp && (
              <div className="mt-2 flex items-center gap-2">
                <input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" maxLength={8}
                  placeholder="6-digit code" className="w-32 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] tabular-nums outline-none focus:border-[var(--cp-primary)]" />
                <button type="button" disabled={busy || code.trim().length < 6} onClick={() => verifyNow(stepUp)}
                  className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
                  {busy ? "Verifying…" : "Verify"}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {!enrolling ? (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Add an authenticator</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
            You will scan a QR code with an authenticator app and type the first code it shows. Keep
            the app: losing it locks this factor, and this product cannot recover it.
          </p>
          <button type="button" disabled={busy || factors === null} onClick={beginEnrol}
            className="mt-2 rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {busy ? "Preparing…" : "Set up two-factor"}
          </button>
        </section>
      ) : (
        <section className="rounded-xl border border-[var(--cp-primary)]/30 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Scan, then confirm</h2>
          <div className="mt-2 flex flex-wrap items-start gap-4">
            {/* GoTrue returns the QR as an SVG data URI -- rendered as an image, never dangerouslySet. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enrolling.qr} alt="TOTP enrolment QR code" className="h-40 w-40 rounded border border-gray-200" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-gray-600">
                Cannot scan? Enter this secret by hand:
              </p>
              <code className="mt-1 block break-all rounded bg-gray-50 px-2 py-1 text-[11px] text-gray-800">{enrolling.secret}</code>
              <div className="mt-3 flex items-center gap-2">
                <input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" maxLength={8}
                  placeholder="First 6-digit code" autoFocus
                  className="w-40 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] tabular-nums outline-none focus:border-[var(--cp-primary)]" />
                <button type="button" disabled={busy || code.trim().length < 6} onClick={confirmEnrol}
                  className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
                  {busy ? "Confirming…" : "Confirm"}
                </button>
                <button type="button" disabled={busy} onClick={() => { setEnrolling(null); setCode(""); }}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
              </div>
              <p className="mt-2 text-[10px] text-gray-500">
                Nothing is active until the first code confirms. Cancelling here leaves your account
                exactly as it was.
              </p>
            </div>
          </div>
        </section>
      )}

      <p className="text-[11px] text-gray-500">
        Done here? <Link href="/practice/home" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">Continue to your practice &rarr;</Link>
        {" "}A practice that requires two-factor opens once this session is verified.
      </p>
    </div>
  );
}
