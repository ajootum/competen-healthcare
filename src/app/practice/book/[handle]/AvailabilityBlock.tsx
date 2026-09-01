import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { profileAvailability, type PublicProfileAvailability } from "@/lib/practice/public-profile";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-BOOK-PROFILE-001 s6 -- THE NEXT-AVAILABLE SHORTCUT, STREAMED.
//
// ⚠ WHY THIS IS ITS OWN COMPONENT RATHER THAN A FIELD ON THE PROFILE.
//
// A slot scan was measured at ~3s against the live database (and the same for one appointment type as
// for five in parallel, and the same for a 14-day window as for 120 -- the cost is round trips). Awaited
// inline, it put the practitioner's name, specialty and booking button behind a diary scan, which is
// exactly what s16's "optimize above-the-fold profile and booking content for fast first render" is
// about. Suspended, the page paints at once and this arrives when it is known.
//
// ⚠ IT DOES NOT WEAKEN s6. Nothing is cached and nothing is predicted: the time named here is computed
// at request time by the same engine the booking screen books against, and it is still not a
// reservation -- migration 255's exclusion constraint settles the race, as it does for every other path.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** What the region looks like while the scan runs. Never a claim, in either direction. */
export function AvailabilityPending() {
  return (
    <div aria-hidden className="mt-3 h-[58px] animate-pulse rounded-lg border border-dashed border-gray-200 bg-gray-50/70" />
  );
}

/**
 * The three states, rendered. PURE, and exported, because the practitioner's preview shows the same
 * region without the suspense boundary -- and s13's anti-drift rule is only real if there is one copy
 * of these three sentences rather than two that agree today.
 */
export function AvailabilityRegion({ a, bookingPath }: {
  a: PublicProfileAvailability; bookingPath: string | null;
}) {
  // ⚠ A TIME IS NAMED ONLY WHERE THE ENGINE FOUND ONE. The three states are three different sentences
  // on purpose -- see PublicProfileAvailability. In particular `unreadable` says NOTHING about whether
  // times exist, because nothing established that.
  if (a.state === "found" && a.label) {
    return (
      <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-800">Next available</p>
        <p className="mt-0.5 text-[14px] font-bold text-emerald-900">{a.label}</p>
        {bookingPath && (
          <Link href={bookingPath}
            className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-bold text-emerald-800 underline underline-offset-2 hover:text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
            Book this time →
          </Link>
        )}
      </div>
    );
  }

  if (a.state === "none_in_window") {
    return (
      <p className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/70 p-3 text-[11.5px] leading-relaxed text-gray-600">
        There are no online appointment times available at the moment.
      </p>
    );
  }

  // `unreadable`: the calendar is offered and nothing is asserted. Saying "no times available" here
  // would be a claim this state did not establish, and saying "times are available" would be worse.
  return (
    <p className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/70 p-3 text-[11.5px] leading-relaxed text-gray-600">
      Choose a date to see the times this practice has open.
    </p>
  );
}

/** The public route's version: scan, then render the region. Suspended by the page. */
export default async function AvailabilityBlock({ handle, types, bookingPath }: {
  handle: string; types: string[]; bookingPath: string;
}) {
  const a = await profileAvailability(createAdminClient(), { handle, types });
  return <AvailabilityRegion a={a} bookingPath={bookingPath} />;
}
