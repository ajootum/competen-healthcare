"use client";

import { useState } from "react";
import Link from "next/link";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE BOOKING LINK, AT THE TOP OF THE COMMAND CENTRE. Owner, 2026-08-28: "Where do we find the booking
// link? Can we make it very easy to find." The most-visited screen now answers it without a hunt.
//
// ⚠ THE FOUR STATES ARE THE POINT, AND ONLY ONE OF THEM OFFERS A COPY BUTTON. The identity console's
// own history records why: a share affordance for an address a patient cannot open ends up on a card
// or a poster this product cannot reach to correct. So `live` copies and opens; `claimed_not_open`
// shows the address for recognition and says plainly that it does not open yet, with the one step
// that changes that; `none` points at claiming one; `unreadable` refuses to claim anything.
//
// Copying records the booking.link_shared milestone through the same endpoint the identity console
// uses -- one telemetry vocabulary, and it records an ACT, never a receipt.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function BookingLinkCard({ summary }: {
  summary:
    | { state: "unreadable"; reason: string }
    | { state: "none" }
    | { state: "claimed_not_open"; handle: string; url: string }
    | { state: "live"; handle: string; url: string };
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (summary.state !== "live") return;
    void navigator.clipboard?.writeText(summary.url);
    setCopied(true);
    // Fire and forget, exactly as the identity console does: a milestone nobody could record is not
    // a share that did not happen, and copying must never wait on a write.
    void fetch("/api/v1/practice/identity", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "recordShare", via: "home_copy" }),
    }).catch(() => {});
  };

  if (summary.state === "unreadable")
    return (
      <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-3.5 py-2.5">
        <p className="text-[12px] leading-relaxed text-slate-600">
          <span className="font-bold">Your booking link could not be read just now.</span> This is not
          saying you have none — the read failed, and nothing here will guess an address.
        </p>
      </section>
    );

  if (summary.state === "none")
    return (
      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5">
        <p className="min-w-0 flex-1 text-[12px] text-gray-600">
          <span className="font-bold text-gray-900">You have no booking address yet.</span>{" "}
          Claim one and patients can be given a link to book with you.
        </p>
        <Link href="/practice/setup/identity"
          className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90">
          Claim your address →
        </Link>
      </section>
    );

  if (summary.state === "claimed_not_open")
    return (
      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold text-amber-900">
            Your booking address is claimed, but does not open yet.
          </p>
          <p className="break-all font-mono text-[11.5px] text-amber-800/80">{summary.url}</p>
          <p className="text-[11px] leading-relaxed text-amber-800/90">
            A patient opening it now is told there is no such page — so it is not offered for sharing
            from here until it is live.
          </p>
        </div>
        <Link href="/practice/setup/identity"
          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-amber-900 hover:bg-amber-50">
          Finish publishing →
        </Link>
      </section>
    );

  return (
    <section className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--cp-primary)]/20 bg-[var(--cp-primary)]/[0.05] px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--cp-primary-deep)]">
          Your booking link
        </p>
        <p className="break-all font-mono text-[12.5px] font-semibold text-gray-900">{summary.url}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {/* aria-live so a screen reader hears the confirmation the sighted user reads on the button. */}
        <button type="button" onClick={copy} aria-live="polite"
          className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90">
          {copied ? "Copied — nothing was sent" : "Copy link"}
        </button>
        <a href={summary.url} target="_blank" rel="noopener noreferrer"
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
          Open ↗
        </a>
        <Link href="/practice/setup/identity"
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
          QR &amp; share tools →
        </Link>
      </div>
    </section>
  );
}
