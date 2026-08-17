import Link from "next/link";

// CPR-140's recall queue, kept beside CPR-FUP-001's work queue rather than replaced by it.
//
// THE TWO ANSWER DIFFERENT QUESTIONS. The work queue is a list of OBLIGATIONS, one row each. This is a
// list of PEOPLE TO RING, and three overdue follow-ups on one patient is one phone call. Rendering it
// as rows would make the same afternoon look three times as long as it is.
//
// NOTHING HAS BEEN SENT. There is no email, SMS or messaging channel in this product, so a recall is a
// call somebody makes -- and the panel says so rather than implying a reminder went out.
//
// CPR-MOB-001 s11 row 4 -- "Care gaps: summary card -> filtered detail list". THIS PANEL IS ALREADY
// THAT SHAPE and it is the only care-gap producer this workspace has: a summary line (how many people,
// how many obligations) over a detail list whose every row opens that patient filtered to their recall
// (?followUp=recall). Below md nothing is added or hidden -- the rows simply stop being a table-shaped
// baseline row: the name becomes a 44px full-width target and the two figures move under it in words,
// because "3 overdue" and "12 days" pressed together at 360px read as one number.
//
// ⚠ AND IT IS NOT CROSS-LINKED TO THE OVERDUE TAB. recallQueue() reads status=OPEN and due_on < today
// grouped by person; the board's Overdue card is a derived predicate over the read the header's filters
// left. The two sets are usually the same people and are NOT the same rule, so a "see these in the
// queue" button would be a claim this panel cannot keep.

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function RecallQueue({ recall }: { recall: any }) {
  if (!recall || recall.patients.length === 0) return null;

  return (
    <section className="rounded-2xl border border-rose-300 bg-rose-50/60 p-4">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100 text-[13px] text-rose-700">☎</span>
        <h2 className="text-[13px] font-bold text-gray-900">Recall queue</h2>
        <span className="text-[11px] text-gray-500">
          {recall.patients.length} {recall.patients.length === 1 ? "patient" : "patients"},{" "}
          {recall.total} overdue {recall.total === 1 ? "follow-up" : "follow-ups"}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-gray-500">
        Overdue with nothing booked, worst first &mdash; grouped by the person to contact, not the row to
        tick. Nothing has been sent: there is no email, SMS or messaging channel in this product.
      </p>
      <ul className="mt-2 flex flex-col">
        {recall.patients.slice(0, 8).map((p: any) => (
          <li key={p.patientId} className="flex items-baseline gap-2 border-b border-rose-200/60 py-1.5 last:border-0 max-md:flex-wrap max-md:items-center max-md:gap-x-2 max-md:py-1">
            <Link href={`/practice/patients/${p.patientId}?followUp=recall`}
              className="text-[12px] font-semibold text-gray-800 hover:underline max-md:flex max-md:min-h-[var(--cp-touch)] max-md:flex-1 max-md:items-center max-md:text-[13.5px]">
              {p.name}
            </Link>
            {p.urgent && (
              <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">urgent</span>
            )}
            <span className="ml-auto text-[11px] text-gray-600 max-md:ml-0">{p.followUps.length} overdue</span>
            {/* The desktop column's heading is its alignment; once it wraps under the name, the figure
                needs the word or "3 overdue 12 days" reads as one measurement. */}
            <span className="w-24 text-right text-[11px] font-bold text-rose-700 max-md:w-auto max-md:text-left">
              <span className="md:hidden">longest wait </span>{p.worstOverdueDays} days
            </span>
          </li>
        ))}
      </ul>
      {recall.patients.length > 8 && (
        <p className="mt-1 text-[10px] text-gray-500">
          Showing the eight longest waiting of {recall.patients.length}.
        </p>
      )}
    </section>
  );
}
