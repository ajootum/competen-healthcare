"use client";

import { useState } from "react";
import Link from "next/link";

// COMPETEN-SCHOLAR-JOIN-01: the two client steps of joining Competen Scholar. Mobile-first: one column,
// controls of at least 44px, native inputs with their own labels, and every state carried by text.
// The server re-checks everything these forms send; their validation is a convenience, not the control.

const ACCENT = "#0E7490";
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const input = "mt-1 block w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-[16px] text-gray-900 min-h-[44px] " + focusRing;
const label = "block text-[14px] font-semibold text-gray-900";
const submitCls = `inline-flex min-h-[44px] w-full items-center justify-center rounded-xl px-5 py-2.5 text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-50 sm:w-auto ${focusRing}`;

type ApiError = { error?: { code?: string; message?: string } | string; nextUrl?: string };
const messageOf = (j: ApiError, fallback: string) => typeof j.error === "string" ? j.error : j.error?.message ?? fallback;

async function post(url: string, body: unknown): Promise<{ ok: boolean; json: ApiError & Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, json: await res.json().catch(() => ({})) };
}

export function JoinRegister({ signInHref }: { signInHref: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; nextUrl?: string } | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      const { ok, json } = await post("/api/individual/join/register", { fullName: f.get("fullName"), email: f.get("email"), password: f.get("password") });
      if (!ok) { setError({ text: messageOf(json, "Your account could not be created."), nextUrl: json.nextUrl }); return; }
      if (json.status === "REGISTERED" && typeof json.nextUrl === "string") { window.location.assign(json.nextUrl); return; }
      setSent(String(f.get("email") ?? ""));
    } catch {
      setError({ text: "Your account could not be created. Check your connection and try again." });
    } finally { setBusy(false); }
  }

  if (sent) {
    return (
      <div role="status" className="space-y-2">
        <h2 className="text-[18px] font-bold text-gray-900">Check your email</h2>
        <p className="text-[14.5px] leading-relaxed text-gray-700">We sent a link to <strong>{sent}</strong>. Open it to confirm your address, then sign in to choose your programme and start.</p>
        <p className="text-[13.5px] text-gray-600">No email after a few minutes? Check your spam folder. <Link href={signInHref} className="font-semibold underline">Sign in</Link> once you have confirmed.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate={false}>
      <div><label htmlFor="j-name" className={label}>Your name</label><input id="j-name" name="fullName" autoComplete="name" required maxLength={120} className={input} /></div>
      <div><label htmlFor="j-email" className={label}>Email</label><input id="j-email" name="email" type="email" autoComplete="email" inputMode="email" required className={input} /></div>
      <div>
        <label htmlFor="j-pass" className={label}>Password</label>
        <input id="j-pass" name="password" type="password" autoComplete="new-password" required minLength={8} aria-describedby="j-pass-help" className={input} />
        <p id="j-pass-help" className="mt-1 text-[12.5px] text-gray-600">At least 8 characters.</p>
      </div>
      {error && (
        <p role="alert" className="text-[13.5px] font-medium text-red-700">
          {error.text}{error.nextUrl && <> <Link href={error.nextUrl} className="font-semibold underline">Sign in</Link></>}
        </p>
      )}
      <button type="submit" disabled={busy} className={submitCls} style={{ background: ACCENT }}>{busy ? "Creating your account…" : "Create account"}</button>
    </form>
  );
}

type Option = { code: string; label: string };
type Programme = Option & { levels: Option[] };

export function JoinActivate({ programmes, institutions, initial, policyVersion, statement }: {
  programmes: Programme[]; institutions: Option[];
  initial: { programme: string | null; level: string | null; institution: string | null };
  policyVersion: string; statement: string;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [programme, setProgramme] = useState(initial.programme ?? (programmes.length === 1 ? programmes[0].code : ""));
  const [level, setLevel] = useState(initial.level ?? "");
  const [institution, setInstitution] = useState(initial.institution ?? "");
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosen = programmes.find(p => p.code === programme) ?? null;
  const contextReady = !!chosen && (chosen.levels.length === 0 || chosen.levels.some(l => l.code === level));

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { ok, json } = await post("/api/individual/join/activate", {
        programme, level: level || null, institution: institution || null, adultDeclaration: adult, policyVersion,
      });
      if (!ok) { setError(messageOf(json, "Competen Scholar could not be activated.")); return; }
      window.location.assign(typeof json.next === "string" ? json.next : "/individual/welcome?for=scholar");
    } catch {
      setError("Competen Scholar could not be activated. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  if (step === 1) {
    return (
      <form onSubmit={e => { e.preventDefault(); if (contextReady) setStep(2); }} className="space-y-4" aria-labelledby="ctx-h">
        <h2 id="ctx-h" className="text-[18px] font-bold text-gray-900">What are you studying?</h2>
        <p className="text-[13.5px] text-gray-600">Step 1 of 2. You can change this later, and what you studied before keeps its own programme.</p>
        <div>
          <label htmlFor="j-prog" className={label}>Programme</label>
          <select id="j-prog" value={programme} onChange={e => { setProgramme(e.target.value); setLevel(""); }} required className={input}>
            <option value="" disabled>Choose your programme</option>
            {programmes.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
          </select>
        </div>
        {chosen && chosen.levels.length > 0 && (
          <div>
            <label htmlFor="j-level" className={label}>Level</label>
            <select id="j-level" value={level} onChange={e => setLevel(e.target.value)} required className={input}>
              <option value="" disabled>Choose your level</option>
              {chosen.levels.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </div>
        )}
        {institutions.length > 0 && (
          <div>
            <label htmlFor="j-inst" className={label}>Institution <span className="font-normal text-gray-600">(optional)</span></label>
            <select id="j-inst" value={institution} onChange={e => setInstitution(e.target.value)} className={input}>
              <option value="">Prefer not to say</option>
              {institutions.map(i => <option key={i.code} value={i.code}>{i.label}</option>)}
            </select>
          </div>
        )}
        <button type="submit" disabled={!contextReady} className={submitCls} style={{ background: ACCENT }}>Continue</button>
      </form>
    );
  }

  return (
    <form onSubmit={activate} className="space-y-4" aria-labelledby="act-h">
      <h2 id="act-h" className="text-[18px] font-bold text-gray-900">Activate Competen Scholar</h2>
      <p className="text-[13.5px] text-gray-600">Step 2 of 2. {chosen?.label}{chosen?.levels.find(l => l.code === level) ? `, ${chosen.levels.find(l => l.code === level)!.label}` : ""}. <button type="button" onClick={() => setStep(1)} className={`font-semibold underline ${focusRing}`}>Change</button></p>
      <fieldset className="rounded-xl border border-gray-200 bg-white p-4">
        <legend className="px-1 text-[14px] font-semibold text-gray-900">Age</legend>
        <p className="text-[13.5px] text-gray-700">Competen Scholar is for adults. We record your confirmation and when you gave it. We do not ask for documents.</p>
        <label className="mt-3 flex min-h-[44px] items-start gap-3 text-[15px] text-gray-900">
          <input type="checkbox" checked={adult} onChange={e => setAdult(e.target.checked)} className="mt-1 h-5 w-5 shrink-0" style={{ accentColor: ACCENT }} />
          <span>{statement}</span>
        </label>
      </fieldset>
      <p className="text-[13px] text-gray-600">Next you will read and accept the terms of use and privacy notice, then upload your first notes. Your notes are private to you.</p>
      {error && <p role="alert" className="text-[13.5px] font-medium text-red-700">{error}</p>}
      <button type="submit" disabled={busy || !adult} className={submitCls} style={{ background: ACCENT }}>{busy ? "Activating…" : "Activate Competen Scholar"}</button>
    </form>
  );
}
