"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-BOOK-EMAIL-001 s10 -- the email channel's switch, at last with a door.
//
// The engine (setChannel) has been ready throughout: permission-guarded, audited, and it refuses a
// channel with no sender identity because "Your code is 481920" from an unnamed sender is
// indistinguishable from a scam. This console is presentation over that one call. EMAIL is the pilot's
// only channel; text messages and WhatsApp appear as a single quiet sentence, never as a warning and
// never as a control (s1).
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function CommunicationsConsole({ email, mayManage }: {
  email: {
    enabled: boolean; senderName: string | null; providerConfigured: boolean; enabledAt: string | null;
  };
  mayManage: boolean;
}) {
  const router = useRouter();
  const [senderName, setSenderName] = useState(email.senderName ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function setEmail(enabled: boolean) {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/patient-communications", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_email", enabled, senderName }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setNotice({ kind: "err", text: `Not changed — ${data.error ?? "the setting was not saved."}` });
      return;
    }
    setNotice({
      kind: "ok",
      text: enabled
        ? "Email is on. Booking codes and confirmations now send, and your booking page becomes bookable as soon as its other checks pass."
        : "Email is off. No code can reach a patient, so online booking is closed until it is on again.",
    });
    router.refresh();
  }

  const active = email.enabled && email.providerConfigured;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-[15px] text-amber-700">◐</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-bold text-gray-900">Email</h2>
          <p className="text-[11px] text-gray-500">
            The channel booking codes and confirmations are sent through.
          </p>
        </div>
        <span className={`rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
          active ? "bg-emerald-100 text-emerald-800"
            : email.providerConfigured ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500"}`}>
          {active ? "Active" : email.providerConfigured ? "Needs setup" : "No provider"}
        </span>
      </div>

      {!email.providerConfigured ? (
        <p className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-3 py-2.5 text-[12px] leading-relaxed text-slate-600">
          This deployment has no email service connected, so this switch would send nothing. That is a
          deployment matter, not a practice setting.
        </p>
      ) : (
        <>
          <p className="mt-3 text-[12px] leading-relaxed text-gray-600">
            {active
              ? "Patients receive their one-time booking code and their confirmation by email."
              : "Turning this on is what lets a patient receive the one-time code that booking requires — without it, your booking page tells patients online booking is not open."}
          </p>
          <label className="mt-3 flex max-w-md flex-col text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Sender name — what the email says it is from
            <input value={senderName} maxLength={80} disabled={!mayManage}
              onChange={e => setSenderName(e.target.value)}
              placeholder="e.g. your practice's name"
              className="mt-0.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] text-gray-900 placeholder:text-gray-400" />
          </label>
          <p className="mt-1 max-w-md text-[10px] leading-relaxed text-gray-500">
            Required before switching on: a code from an unnamed sender is indistinguishable from a
            scam, and teaching patients to trust those is worse than not sending at all.
          </p>

          {!mayManage && (
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
              You can see this setting. Changing it needs the practice settings permission.
            </p>
          )}

          {notice && (
            <p role="status" className={`mt-2 max-w-md rounded-lg px-3 py-2 text-[11.5px] leading-relaxed ${
              notice.kind === "ok" ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
                : "bg-rose-50 text-rose-800 ring-1 ring-rose-200"}`}>
              {notice.text}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {!email.enabled ? (
              <button type="button" disabled={busy || !mayManage} onClick={() => setEmail(true)}
                className="rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
                Turn email on
              </button>
            ) : (
              <button type="button" disabled={busy || !mayManage} onClick={() => setEmail(false)}
                className="rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                Turn email off
              </button>
            )}
          </div>
          {email.enabled && email.enabledAt && (
            <p className="mt-1.5 text-[10px] text-gray-400">
              On since {new Date(email.enabledAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.
            </p>
          )}
        </>
      )}
    </section>
  );
}
