import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveHandle } from "@/lib/practice/identity-service";
import { publicBookingProfile, initialsOf } from "@/lib/practice/public-profile";
import { workspaceClock } from "@/lib/practice/practice-time";
import { publicBookingEntry } from "@/lib/practice/patient-booking";
import ManageConsole from "./ManageConsole";

// /practice/book/@handle/manage -- CPR-BOOK-FLOW-002 s13's management pathway.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THE ENGINES WERE FINISHED AND NOTHING SERVED THEM.
//
// requestManageCode, managedBookings, rescheduleManagedBooking and cancelManagedBooking have been
// harness-proven since the patient-manage arc, and no route mounted any of them. So the booking
// confirmation could not offer "view or change your appointment" without promising a screen that did not
// exist -- which is why it offered nothing, and why s13's "explain that rescheduling can be managed"
// stayed unbuilt rather than being written as a hopeful sentence.
//
// ⚠ IT IS NEVER INDEXED. A page that lists somebody's appointments once they prove an address is not a
// page any search engine was asking for, whatever the practitioner's discovery setting says.
//
// ⚠ AND IT OPENS FOR ANY RESOLVABLE HANDLE, INCLUDING A PRACTICE THAT HAS CLOSED ONLINE BOOKING.
// Somebody who booked last week must still be able to cancel today, and tying this door to whether NEW
// bookings are open would strand exactly the people with an appointment to manage.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

function handleFrom(segment: string): string | null {
  let decoded = segment;
  try { decoded = decodeURIComponent(segment); } catch { return null; }
  return decoded.startsWith("@") ? decoded.slice(1) : null;
}

export default async function ManageBookingPage({ params }: {
  params: Promise<{ handle: string }>;
}) {
  const handle = handleFrom((await params).handle);
  if (!handle) notFound();

  const admin = createAdminClient();
  const resolved = await resolveHandle(admin, handle);
  if (resolved.kind === "redirect") redirect(`${resolved.to}/manage`);
  if (resolved.kind === "unreadable") {
    return (
      <Shell handle={handle}>
        <h1 className="text-xl font-bold text-gray-900">This page could not be loaded just now</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
          Nothing could be read about this address, so nothing here is a statement about whether it
          exists. Please try again shortly.
        </p>
      </Shell>
    );
  }
  if (resolved.kind === "none") notFound();

  const p = resolved.profile;
  if (!p.handle) notFound();

  // The practitioner strip, from the same projection every other patient screen uses. A failed read
  // degrades to what resolveHandle already returned rather than closing a door somebody needs.
  const projected = await publicBookingProfile(admin, p.handle);
  const identity = projected.kind === "found"
    ? {
      displayName: projected.profile.displayName,
      credentials: projected.profile.credentials,
      specialty: projected.profile.specialty,
      initials: projected.profile.initials,
      photoUrl: projected.profile.photoUrl,
    }
    : {
      displayName: p.displayName,
      credentials: p.qualifications ?? null,
      specialty: p.specialties ?? null,
      initials: initialsOf(p.displayName),
      photoUrl: null,
    };

  // Times are shown in the PRACTICE's zone, as everywhere else a patient reads one. The entry carries
  // the workspace; a practice whose page is closed still resolves here, so the clock falls back to UTC
  // rather than the screen guessing the browser's.
  const entry = await publicBookingEntry(admin, p.handle);
  const clock = entry.workspaceId ? await workspaceClock(admin, entry.workspaceId) : null;

  return (
    <Shell handle={p.handle}>
      <ManageConsole handle={p.handle} identity={identity} timezone={clock?.timezone ?? "UTC"} />
    </Shell>
  );
}

function Shell({ handle, children }: { handle: string; children: React.ReactNode }) {
  return (
    // ⚠ §4: "approximately 900-1050 px centered content region rather than a narrow card floating in a
    // wide page" -- §2's first listed defect was the unused desktop space around a 720px column. The
    // support rail below needs somewhere to sit, and at 720 there was nowhere.
    <div className="mx-auto max-w-[1000px] px-4 py-8 md:px-6">
      {children}
      <p className="mt-10 text-[11px] text-gray-400">
        <Link href={`/practice/book/@${handle}`} className="hover:underline">Back to this page</Link>
        {" · "}
        <Link href="/practice" className="hover:underline">Competen Practice</Link>
      </p>
    </div>
  );
}
