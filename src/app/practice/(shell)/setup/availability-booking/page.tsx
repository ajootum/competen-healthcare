import { redirect } from "next/navigation";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-SETUP-HFE-001 -- THE OLD THREE-LAYER CONSOLE, NOW A REDIRECT (SET-HFE-10).
//
// This route carried My Regular Practice, Changes & Exceptions and Patient Booking as ?layer=1..3 of
// one page. The spec split them into two destinations with distinct responsibilities:
//
//   ?layer=1  ->  /practice/setup/availability-changes            (Regular week)
//   ?layer=2  ->  /practice/setup/availability-changes?tab=changes (Changes & exceptions)
//   ?layer=3  ->  /practice/setup/patient-booking                  (Patient Booking, six tabs)
//
// The route stays because bookmarks, in-product links and muscle memory point at it; a practitioner
// following any of them lands on the surface that owns what they were looking for. The workspace
// components still live in this directory and are mounted by the new pages -- this file owns nothing
// but the forwarding.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function LegacyAvailabilityBookingRedirect({ searchParams }: {
  searchParams: Promise<{ layer?: string }>;
}) {
  const { layer } = await searchParams;
  const n = Number(layer);
  redirect(
    n === 3 ? "/practice/setup/patient-booking"
      : n === 2 ? "/practice/setup/availability-changes?tab=changes"
        : "/practice/setup/availability-changes",
  );
}
