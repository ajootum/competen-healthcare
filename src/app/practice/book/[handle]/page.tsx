import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveHandle } from "@/lib/practice/identity-service";
import { publicBookingProfile } from "@/lib/practice/public-profile";
import ProfileView from "./ProfileView";
import AvailabilityBlock, { AvailabilityPending } from "./AvailabilityBlock";

// /practice/book/@handle -- CPB-002's canonical practitioner URL, CPR-BOOK-PROFILE-001's public profile.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THIS FILE USED TO LIVE AT src/app/[handle]/page.tsx, AT THE ROOT, AND THE MOVE IS THE POINT.
//
// PIS-000 s8 named https://practice.competenhealthcare.com/@handle and this route was built for it. The
// address is now https://competenhealthcare.com/practice/book/@handle: one domain, no subdomain, the
// path carrying the meaning. identity-service.ts records all three candidates and which was chosen.
//
// A root-level dynamic segment matched EVERY unmatched single top-level path, so every 404 on a
// one-segment URL was a dynamic render that opened an admin Supabase client before deciding the segment
// did not begin with '@'. Under /practice/book/ the segment is reachable only beneath a static prefix.
//
// A HIDDEN PRACTITIONER IS A 404, NOT A REFUSAL. "This person exists but will not see you" is a
// disclosure about a named individual; nothing here distinguishes it from a handle never issued.
//
// ---- ⚠ THE PAGE NO LONGER COMPOSES ITSELF FROM WHATEVER THE READS RETURNED --------------------------
//
// It used to hold the identity row's public view AND the booking entry, and render fields from both.
// That is how a patient page came to carry this practitioner's internal CP number, the raw booking URL
// it was already at, and a free-text "consultation types" field whose live value on the owner's own
// profile was the word "All types". None of those was a decision; each was simply in an object this
// file already had.
//
// publicBookingProfile() is now the boundary (CPR-BOOK-PROFILE-001 s14): one allowlisted projection,
// exported as data and asserted by a test, rendered by a component the practitioner's preview also
// mounts. This file's whole job is routing, robots and the four resolution outcomes.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

function handleFrom(segment: string): string | null {
  let decoded = segment;
  try { decoded = decodeURIComponent(segment); } catch { return null; }
  return decoded.startsWith("@") ? decoded.slice(1) : null;
}

export async function generateMetadata({ params }: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const handle = handleFrom((await params).handle);
  if (!handle) return { robots: { index: false, follow: false } };

  const resolved = await resolveHandle(createAdminClient(), handle);
  if (resolved.kind !== "found") return { robots: { index: false, follow: false } };

  // s7: only a practitioner who chose 'public' is indexable. Everybody else is noindex -- the position
  // the site already takes for /verify, where unguessable is not the same as unpublished.
  //
  // ⚠ AC-09: this is the ONLY place that policy is stated now. It used to be printed in the patient
  // footer as well, where it answered a question no patient asked and undermined the page it sat on.
  const listed = resolved.profile.discovery === "public";
  return {
    title: `${resolved.profile.displayName} — Competen Practice`,
    description: resolved.profile.specialties ?? undefined,
    robots: { index: listed, follow: listed },
  };
}

export default async function PractitionerPage({ params }: {
  params: Promise<{ handle: string }>;
}) {
  const handle = handleFrom((await params).handle);
  if (!handle) notFound();

  const resolved = await publicBookingProfile(createAdminClient(), handle);

  // s8: legacy URLs redirect automatically after a handle change, so printed cards keep working.
  if (resolved.kind === "redirect") redirect(resolved.to);

  // ⚠ A DATABASE THAT WOULD NOT ANSWER IS NOT A PRACTITIONER WHO DOES NOT EXIST. This says what actually
  // happened, and says exactly the same thing whether or not the handle exists, so it discloses nothing.
  if (resolved.kind === "unreadable") {
    return (
      <div className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-xl font-bold text-gray-900">This page could not be loaded just now</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
          Nothing could be read about this address, so nothing here is a statement about whether it
          exists. This is a fault at our end rather than anything about the link you followed &mdash;
          please try again shortly.
        </p>
        <p className="mt-8 text-[11px] text-gray-400">
          <Link href="/practice" className="hover:underline">Competen Practice</Link>
        </p>
      </div>
    );
  }
  if (resolved.kind === "none") notFound();

  const p = resolved.profile;

  return (
    <div className="min-h-screen bg-[var(--cp-canvas,#f8fafc)]">
      <ProfileView
        p={p}
        // ⚠ SUSPENDED, SO THE NAME AND THE BUTTON NEVER WAIT FOR A DIARY SCAN (s16). The region is
        // offered only where a patient could act on it -- a next-available time under a page that
        // cannot be booked is a shortcut to a dead end.
        availabilitySlot={p.booking.canBook && p.booking.bookingPath ? (
          <Suspense fallback={<AvailabilityPending />}>
            <AvailabilityBlock
              handle={p.handle}
              types={p.consultationTypes.map(t => t.code)}
              bookingPath={p.booking.bookingPath}
            />
          </Suspense>
        ) : null}
      />
    </div>
  );
}
