import Link from "next/link";

// CPR-140's recall queue, kept beside CPR-FUP-001's work queue rather than replaced by it.
//
// THE TWO ANSWER DIFFERENT QUESTIONS. The work queue is a list of OBLIGATIONS, one row each. This is a
// list of PEOPLE TO RING, and three overdue follow-ups on one patient is one phone call. Rendering it
// as rows would make the same afternoon look three times as long as it is.
//
// NOTHING HAS BEEN SENT. There is no email, SMS or messaging channel in this product, so a recall is a
// call somebody makes -- and the panel says so rather than implying a reminder went out.

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
          <li key={p.patientId} className="flex items-baseline gap-2 border-b border-rose-200/60 py-1.5 last:border-0">
            <Link href={`/practice/patients/${p.patientId}?followUp=recall`}
              className="text-[12px] font-semibold text-gray-800 hover:underline">
              {p.name}
            </Link>
            {p.urgent && (
              <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">urgent</span>
            )}
            <span className="ml-auto text-[11px] text-gray-600">{p.followUps.length} overdue</span>
            <span className="w-24 text-right text-[11px] font-bold text-rose-700">{p.worstOverdueDays} days</span>
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
