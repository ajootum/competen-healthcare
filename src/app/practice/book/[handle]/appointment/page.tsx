import Link from "next/link";
import { headers } from "next/headers";
import { recordFunnelStep, deviceClass } from "@/lib/practice/booking-funnel";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveHandle } from "@/lib/practice/identity-service";
import { publicBookingProfile, initialsOf } from "@/lib/practice/public-profile";
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
  // s15: the SAME projection the profile page renders, so the practitioner a patient chose is the
  // practitioner they see through every step rather than a second description of them.
  const resolvedProfile = await publicBookingProfile(admin, p.handle);
  // ⚠ A FAILED PROJECTION MUST NOT CLOSE THE DOOR. The strip is presentation; the booking is the point.
  // resolveHandle has already returned this practitioner's name and qualifications, so a second read
  // that did not answer degrades to those rather than taking the whole page down.
  const identity = resolvedProfile.kind === "found"
    ? {
      displayName: resolvedProfile.profile.displayName,
      credentials: resolvedProfile.profile.credentials,
      specialty: resolvedProfile.profile.specialty,
      initials: resolvedProfile.profile.initials,
      photoUrl: resolvedProfile.profile.photoUrl,
    }
    : {
      displayName: p.displayName,
      credentials: p.qualifications ?? null,
      specialty: p.specialties ?? null,
      initials: initialsOf(p.displayName),
      photoUrl: null,
    };

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

  // s19: the wizard rendering IS the booking start. Same server-render discipline as the profile.
  await recordFunnelStep(admin, {
    workspaceId: entry.workspaceId,
    step: "booking_started",
    device: deviceClass((await headers()).get("user-agent")),
  });

  return (
    <Shell handle={p.handle} name={entry.displayName ?? p.displayName}>
      <BookingWizard
        handle={p.handle}
        practitioner={p.displayName}
        // s3/AC-02: the practitioner strip comes from the SAME projection the public profile renders,
        // so the person a patient chose on the previous screen is the person they see all the way
        // through. It replaced a header showing "@elisham1" over the practice's internal name.
        identity={identity}
        displayName={entry.displayName}
        instructions={entry.instructions}
        // s8.5, from migration 363: the practice's OWN wording, or nothing. Never `instructions`
        // relabelled as a safety warning, and never a sentence composed here -- an emergency instruction
        // naming the wrong service for the country is the kind of copy that gets somebody hurt.
        safetyNote={entry.emergencyNotice}
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
    // s3: a comfortable reading width rather than a narrow column in a wide viewport. The wizard widens
    // itself once the persistent summary appears, so this bound is the form's, not the page's.
    <div className="mx-auto max-w-[880px] px-4 py-8 md:px-6">
      {/* ⚠ NO "@handle" EYEBROW AND NO PRACTICE BRAND NAME HERE (s3/AC-02, AC-03). This header showed
          "@elisham1" in primary colour over "Trial" -- the practice's own internal name -- as the
          strongest identity on a patient's booking screen. The practitioner strip inside the wizard is
          the identity now, and it carries the person a patient actually chose. `name` remains a prop
          because the pre-wizard states (outage, closed) still have nothing else to show. */}
      {children}
      <p className="mt-10 text-[11px] text-gray-400">
        <Link href={`/practice/book/@${handle}`} className="hover:underline">Back to this page</Link>
        {" · "}
        <Link href="/practice" className="hover:underline">Competen Practice</Link>
      </p>
    </div>
  );
}
