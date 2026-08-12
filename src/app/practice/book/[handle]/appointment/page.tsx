import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveHandle } from "@/lib/practice/identity-service";
import { publicBookingEntry } from "@/lib/practice/patient-booking";
import BookingWizard from "./BookingWizard";

// /practice/book/@handle/appointment -- CPB-001's "Location -> Service -> Time -> Details -> Verify".
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THE SCREEN A PATIENT USES, AND THE FOUR SENTENCES IT IS ALLOWED TO SAY.
//
// The engines have been proven end to end since Phase 4 and had no caller but a harness. This is the
// caller. It sits OUTSIDE the (shell) segment, exactly as /practice/patient-booking does, so
// resolvePracticeShell's membership, role and capability guards never run for it -- a patient must not be
// a member, and a screen that quietly required one would be a screen no patient can open.
//
// ---- WHAT THIS FILE DECIDES, WHICH IS ALMOST NOTHING ------------------------------------------------
//
// It resolves the handle, asks publicBookingEntry what may be offered, and draws one of four things:
//
//   the practitioner is not there          a 404, identical for hidden and never-issued
//   the check itself failed                an outage, said as one, never as "this practice is closed"
//   booking is open, or a request is       the wizard, told which of the two it may offer
//   neither is                             the practice's own reason, from the store, and no button
//
// ⚠ IT NEVER DECIDES WHETHER A BOOKING MAY BE MADE. Every gate -- the published page, the delivery
// channel, the practice's unverified-request setting, the rules, the diary -- is applied on the server by
// an engine at the moment of the write. What this page controls is only what a person is SHOWN, and the
// wizard failing at its last step would be worse than not offering it.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

function handleFrom(segment: string): string | null {
  let decoded = segment;
  try { decoded = decodeURIComponent(segment); } catch { return null; }
  return decoded.startsWith("@") ? decoded.slice(1) : null;
}

// ⚠ NEVER INDEXED, WHATEVER THE PRACTITIONER'S DISCOVERY SETTING IS. A profile may be listed in search
// because a clinician chose to be findable. A half-completed booking form is not a page anybody was
// asking to have indexed, and a search result pointing at step three of a form is a broken promise.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function BookAppointmentPage({ params }: {
  params: Promise<{ handle: string }>;
}) {
  const handle = handleFrom((await params).handle);
  if (!handle) notFound();

  const admin = createAdminClient();
  const resolved = await resolveHandle(admin, handle);
  if (resolved.kind === "redirect") redirect(`${resolved.to}/appointment`);
  if (resolved.kind === "unreadable") {
    return (
      <Shell handle={handle}>
        <h1 className="text-xl font-bold text-gray-900">This page could not be loaded just now</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
          Nothing could be read about this address, so nothing here is a statement about whether it
          exists. This is a fault at our end rather than anything about the link you followed &mdash;
          please try again shortly.
        </p>
      </Shell>
    );
  }
  if (resolved.kind === "none") notFound();

  const p = resolved.profile;
  if (!p.handle) notFound();

  const entry = await publicBookingEntry(admin, p.handle);

  if (entry.state === "unreadable") {
    return (
      <Shell handle={p.handle} name={p.displayName}>
        <h1 className="text-xl font-bold text-gray-900">Booking could not be checked just now</h1>
        {/* ⚠ THE OUTAGE IS SAID AS AN OUTAGE. Drawing it as "this practice is not taking bookings" would
            send somebody away from a practice that was open, which is the wrong answer to give twice. */}
        <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
          {entry.whyNot} Nothing about this practice has been assumed &mdash; the check itself did not
          complete. Please try again shortly, or contact the practice directly.
        </p>
      </Shell>
    );
  }

  if (!entry.canBook && !entry.canRequestWithoutCode) {
    return (
      <Shell handle={p.handle} name={entry.displayName ?? p.displayName}>
        <h1 className="text-xl font-bold text-gray-900">Booking is not open here</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
          {entry.whyNot ?? "This practice does not take online bookings. Contact them the way you normally would."}
        </p>
        {entry.instructions && (
          <p className="mt-3 whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-3 text-[12.5px] leading-relaxed text-gray-700">
            {entry.instructions}
          </p>
        )}
      </Shell>
    );
  }

  return (
    <Shell handle={p.handle} name={entry.displayName ?? p.displayName}>
      <BookingWizard
        handle={p.handle}
        practitioner={p.displayName}
        displayName={entry.displayName}
        instructions={entry.instructions}
        privacyNotice={entry.privacyNotice}
        locations={entry.locations}
        appointmentTypes={entry.appointmentTypes}
        canBook={entry.canBook}
        canRequestWithoutCode={entry.canRequestWithoutCode}
        requestNote={entry.requestNote}
        fallbackEmail={entry.fallbackEmail}
        fallbackPhone={entry.fallbackPhone}
        bookingWhyNot={entry.whyNot}
      />
    </Shell>
  );
}

function Shell({ handle, name, children }: {
  handle: string; name?: string | null; children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <header className="mb-6">
        <p className="text-[12px] font-semibold text-[var(--cp-primary-deep)]">@{handle}</p>
        {name && <h2 className="mt-0.5 text-[15px] font-bold text-gray-900">{name}</h2>}
      </header>
      {children}
      <p className="mt-10 text-[11px] text-gray-400">
        <Link href={`/practice/book/@${handle}`} className="hover:underline">Back to this page</Link>
        {" · "}
        <Link href="/practice" className="hover:underline">Competen Practice</Link>
      </p>
    </div>
  );
}
