import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { requestQueue } from "@/lib/practice/booking-request-unverified";
import RequestQueueBoard from "./RequestQueueBoard";

// /practice/booking-requests -- what patients asked for, and which of them proved who they are.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THIS SCREEN EXISTS BECAUSE THE SENTENCE ON THE PATIENT'S CONFIRMATION HAS TO BE TRUE.
//
// A patient sending an unverified request is told "the practice can see your request and will contact
// you". Before this page, practice_booking_request had NO practice-facing reader at all -- every read of
// it in this product was patient-facing -- so that sentence would have been false and the request would
// have gone into a table nobody opens. A store nothing looks at is a request nobody answers.
//
// ---- ⚠ WHAT THIS PAGE DOES NOT DO -----------------------------------------------------------------
//
// IT DOES NOT BOOK. There is no button here that turns a request into an appointment, and that is
// deliberate rather than unfinished: a booking goes through the diary, where the rules, checkPlacement
// and migration 255's exclusion constraint all apply. A "confirm" here would be a second booking path
// and the first one's guards would stop being the ones that matter. What a practice does here is read a
// message, ring the person, and record that it did.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

export default async function BookingRequestsPage({ searchParams }: {
  searchParams: Promise<{ all?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "appointment.manage")) redirect("/practice/home");

  const includeHandled = (await searchParams).all === "1";
  const queue = await requestQueue(createAdminClient(), shell.ctx, { includeHandled });

  return (
    <div className="max-w-4xl">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">Booking requests</h1>
        <Link href={includeHandled ? "/practice/booking-requests" : "/practice/booking-requests?all=1"}
          className="text-[11.5px] font-semibold text-[var(--cp-primary)] hover:underline">
          {includeHandled ? "Show only open ones" : "Show closed ones too"}
        </Link>
      </div>
      <p className="mt-0.5 text-[13px] leading-relaxed text-gray-500">
        What people asked for through your booking page. A request is not an appointment &mdash; nothing
        here holds a time, and two people may have asked for the same one. Book the ones you want in the{" "}
        <Link href="/practice/calendar" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">planner</Link>.
      </p>

      {/* ⚠ A FAILED READ IS NOT AN EMPTY QUEUE, AND IT IS DRAWN AS THE OUTAGE IT IS. "You have no
          requests" when the truth is that nobody could tell is how a practice stops looking. */}
      {!queue.ok ? (
        <p className="mt-4 rounded-xl border border-slate-300 bg-slate-50 p-4 text-[12.5px] leading-relaxed text-slate-700">
          <span className="font-bold">Your booking requests could not be read.</span> {queue.message}
          {" "}That is not the same as having none. Nothing has been assumed either way.
        </p>
      ) : (
        <RequestQueueBoard
          requests={queue.data.requests}
          listIncomplete={queue.data.listIncomplete}
          includeHandled={includeHandled}
        />
      )}
    </div>
  );
}
