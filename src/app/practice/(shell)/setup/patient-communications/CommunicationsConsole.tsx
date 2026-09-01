"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-SET-COMMS-001 s3 -- the Patient Communications console.
//
// Practitioners configure the patient-facing IDENTITY (sender name, reply-to) and which message types
// send. They never see provider names, credentials, DNS or delivery infrastructure -- email is a
// Competen-managed platform capability (s1), and the one status a practitioner needs is derived
// server-side and handed in as `state`.
//
// ONE PRIMARY ACTION PER EDITABLE CARD (s10): Save settings. Saving valid settings is what activates
// the channel -- there is no separate on/off switch, because email verification is a booking
// dependency, not a marketing opt-in (s2). Message types the workflow requires are locked on and
// rendered as facts, not as disabled toggles that appear actionable.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const EMAIL_SYNTAX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** s3.2's configurable rows, in the order the spec tables them. */
const PREFERENCE_ROWS: { key: string; label: string; detail: string }[] = [
  { key: "booking_confirmation", label: "Booking confirmations", detail: "Sent after a patient books online." },
  { key: "cancellation_notice", label: "Cancellation notices", detail: "Sent when an appointment is cancelled, where the patient agreed to be contacted." },
  { key: "rescheduling_notice", label: "Rescheduling notices", detail: "Sent when an appointment's date or time changes." },
];

const STATE_BADGE: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: "Active", cls: "bg-emerald-100 text-emerald-800" },
  SETUP_REQUIRED: { label: "Setup required", cls: "bg-amber-100 text-amber-800" },
  ACTION_NEEDED: { label: "Action needed", cls: "bg-rose-100 text-rose-800" },
};

export default function CommunicationsConsole({ email, senderNameDefault, mayManage }: {
  email: {
    state: "SETUP_REQUIRED" | "ACTIVE" | "ACTION_NEEDED";
    senderName: string | null;
    replyTo: string | null;
    messagePreferences: Record<string, boolean>;
  };
  /** From the Practice Profile (s3.1): what the sender-name field offers before anything is saved. */
  senderNameDefault: string;
  mayManage: boolean;
}) {
  const router = useRouter();
  const [senderName, setSenderName] = useState(email.senderName ?? senderNameDefault);
  const [replyTo, setReplyTo] = useState(email.replyTo ?? "");
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() => {
    const p: Record<string, boolean> = {};
    for (const row of PREFERENCE_ROWS) p[row.key] = email.messagePreferences[row.key] !== false;
    return p;
  });
  const [fieldError, setFieldError] = useState<{ field: "sender" | "replyTo"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const badge = STATE_BADGE[email.state] ?? STATE_BADGE.SETUP_REQUIRED;

  async function save() {
    setNotice(null); setFieldError(null);

    // s5's replacement copy, verbatim. The engine refuses an unnamed sender too (its own pinned
    // sentence) -- this validation exists so the practitioner reads the practitioner-facing reason.
    if (!senderName.trim()) {
      setFieldError({ field: "sender", text: "Sender name is required. It helps patients recognise messages from your practice." });
      return;
    }
    if (replyTo.trim() && !EMAIL_SYNTAX.test(replyTo.trim())) {
      setFieldError({ field: "replyTo", text: "Enter a valid email address, like reception@example.com, or leave it empty." });
      return;
    }

    setBusy(true);
    const res = await fetch("/api/v1/practice/patient-communications", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_email", senderName: senderName.trim(), replyTo: replyTo.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setNotice({
        kind: "err",
        text: data.code === "SENDER_REQUIRED"
          ? "Sender name is required. It helps patients recognise messages from your practice."
          : `Not saved — ${data.error ?? "the settings were not saved."} Your entries are kept above.`,
      });
      return;
    }

    // Preferences ride the same Save (s10: one primary action) -- sent only where changed.
    const changed: Record<string, boolean> = {};
    for (const row of PREFERENCE_ROWS)
      if (prefs[row.key] !== (email.messagePreferences[row.key] !== false)) changed[row.key] = prefs[row.key];
    if (Object.keys(changed).length > 0) {
      const pres = await fetch("/api/v1/practice/patient-communications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_preferences", preferences: changed }),
      });
      const pdata = await pres.json().catch(() => ({}));
      if (!pres.ok) {
        setBusy(false);
        setNotice({ kind: "err", text: `Your email settings were saved, but the message preferences were not — ${pdata.error ?? "they could not be saved."}` });
        router.refresh();
        return;
      }
    }

    setBusy(false);
    setNotice({ kind: "ok", text: "Settings saved. Your booking readiness has been re-checked with them." });
    router.refresh();
  }

  const input = "mt-0.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] text-gray-900 placeholder:text-gray-400 disabled:bg-gray-50 disabled:text-gray-500";
  const label = "flex flex-col text-[10px] font-semibold uppercase tracking-wide text-gray-500";

  return (
    <div className="flex flex-col gap-4">
      {/* ── EMAIL: the one live channel ──────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cp-primary)]/10 text-[15px] text-[var(--cp-primary)]">✉</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-bold text-gray-900">Email</h2>
            <p className="text-[11px] text-gray-500">
              Email is used for booking verification and appointment communications.
            </p>
          </div>
          <span className={`rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${badge.cls}`}>
            {badge.label}
          </span>
        </div>

        {email.state === "ACTION_NEEDED" && (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2.5 text-[12px] leading-relaxed text-rose-900">
            Email messages cannot be sent right now. Your settings are kept, and this is a service
            matter on our side rather than something to fix here — patient verification and online
            booking resume as soon as the service is restored.
          </p>
        )}

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <label className={label}>
              Sender name <span className="normal-case font-normal text-gray-400">— required</span>
              <input value={senderName} maxLength={80} disabled={!mayManage}
                onChange={e => setSenderName(e.target.value)}
                placeholder="e.g. your practice's name"
                aria-invalid={fieldError?.field === "sender" || undefined}
                className={input} />
            </label>
            <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
              Patients will see this name on emails from your practice.
            </p>
            {fieldError?.field === "sender" && (
              <p role="alert" className="mt-1 text-[10.5px] font-semibold text-rose-700">{fieldError.text}</p>
            )}
          </div>
          <div>
            <label className={label}>
              Reply-to email <span className="normal-case font-normal text-gray-400">— optional</span>
              <input value={replyTo} maxLength={120} disabled={!mayManage} type="email"
                onChange={e => setReplyTo(e.target.value)}
                placeholder="e.g. reception@yourpractice.com"
                aria-invalid={fieldError?.field === "replyTo" || undefined}
                className={input} />
            </label>
            <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
              Where a patient&apos;s reply is directed. Leave empty to use the standard address.
            </p>
            {fieldError?.field === "replyTo" && (
              <p role="alert" className="mt-1 text-[10.5px] font-semibold text-rose-700">{fieldError.text}</p>
            )}
          </div>
        </div>

        {/* ── s3.2: which messages send. Required types are facts, not toggles. ─────────────────── */}
        <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-600">Appointment communications</h3>
          <ul className="mt-2 divide-y divide-gray-100">
            <li className="flex items-start gap-2.5 py-2">
              <span aria-hidden className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[var(--cp-primary)] text-[9px] font-bold text-white">✓</span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-gray-900">
                  Booking verification codes
                  <span className="ml-2 rounded bg-[var(--cp-primary)]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--cp-primary)]">Required</span>
                </p>
                <p className="text-[10.5px] leading-relaxed text-gray-500">
                  One-time codes patients enter to verify their email. Required for online booking, so
                  they cannot be switched off.
                </p>
              </div>
            </li>
            {PREFERENCE_ROWS.map(row => (
              <li key={row.key} className="flex items-start gap-2.5 py-2">
                <input id={`pref-${row.key}`} type="checkbox" checked={prefs[row.key]}
                  disabled={!mayManage || busy}
                  onChange={e => setPrefs(p => ({ ...p, [row.key]: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--cp-primary)]" />
                <div className="min-w-0 flex-1">
                  <label htmlFor={`pref-${row.key}`} className="block text-[12px] font-semibold text-gray-900">
                    {row.label}
                    <span className={`ml-2 text-[10px] font-bold ${prefs[row.key] ? "text-emerald-700" : "text-gray-400"}`}>
                      {prefs[row.key] ? "On" : "Off"}
                    </span>
                  </label>
                  <p className="text-[10.5px] leading-relaxed text-gray-500">{row.detail}</p>
                </div>
              </li>
            ))}
            {/* s3.2: no fake toggle for a reminder engine that does not exist. A sentence, dimmed. */}
            <li className="flex items-start gap-2.5 py-2 opacity-60">
              <span aria-hidden className="mt-0.5 h-4 w-4 shrink-0 rounded border border-dashed border-gray-300" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-gray-700">
                  Appointment reminders
                  <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">Coming later</span>
                </p>
                <p className="text-[10.5px] leading-relaxed text-gray-500">
                  Reminders before an appointment are not yet available.
                </p>
              </div>
            </li>
          </ul>
        </div>

        {!mayManage && (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            You can see these settings. Changing them needs the practice settings permission.
          </p>
        )}

        {notice && (
          <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-[11.5px] leading-relaxed ${
            notice.kind === "ok" ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
              : "bg-rose-50 text-rose-800 ring-1 ring-rose-200"}`}>
            {notice.text}
          </p>
        )}

        <div className="mt-3">
          <button type="button" disabled={busy || !mayManage} onClick={save}
            className="rounded-lg bg-[var(--cp-primary)] px-3.5 py-2 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {busy ? "Saving…" : "Save settings"}
          </button>
        </div>
      </section>

      {/* ── s3.3: future channels. A badge and a sentence -- no setup button, no field, no link. ─── */}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-[15px] text-sky-600">▤</span>
            <h2 className="flex-1 text-[13px] font-bold text-gray-900">SMS</h2>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">Coming soon</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
            Send verification codes, appointment reminders and important booking updates by text message.
          </p>
        </section>
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-[15px] text-emerald-600">◉</span>
            <h2 className="flex-1 text-[13px] font-bold text-gray-900">WhatsApp</h2>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">Coming soon</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
            Communicate with patients through your practice&apos;s WhatsApp channel.
          </p>
        </section>
      </div>
    </div>
  );
}
